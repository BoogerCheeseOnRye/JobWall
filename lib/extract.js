import {
  LANGUAGE_MAP,
  DEP_MAP,
  TEXT_SIGNALS,
  PATH_SIGNALS,
  label,
  categoryOf,
} from './skills.js';

const MAX_TEXT = 60_000; // README prose only gets so much attention

// Evidence comes in four channels with different ceilings. Nothing you can
// write in a README outranks bytes you committed; nothing you can vendor
// outranks declaring it. Within a channel, evidence combines as noisy-OR (each
// new signal raises confidence but with diminishing returns), and across
// channels the channels multiply out independently.
export const CHANNELS = {
  language: { ceiling: 1.0, name: 'bytes committed' },
  manifest: { ceiling: 0.8, name: 'declared dependency' },
  path: { ceiling: 0.75, name: 'file you wrote' },
  prose: { ceiling: 0.6, name: 'your own description' },
};

// Noisy-OR: each new independent signal raises confidence, with diminishing
// returns. (1 - Π(1 - s_i)). Returns the *failure* product, not the confidence.
const product = (strengths) =>
  strengths.reduce((acc, s) => acc * (1 - Math.min(0.99, Math.max(0, s))), 1);
const or = (strengths) => (strengths.length ? 1 - product(strengths) : 0);

class Evidence {
  constructor() {
    this.skills = new Map();
  }

  #slot(id) {
    if (!this.skills.has(id)) this.skills.set(id, { id, channels: new Map(), why: new Map() });
    return this.skills.get(id);
  }

  // strength: 0..1 contribution from this single observation.
  add(id, strength, note, channel) {
    if (!id || !(strength > 0)) return;
    const s = this.#slot(id);
    const list = s.channels.get(channel) || [];
    list.push(strength);
    s.channels.set(channel, list);
    if (note) s.why.set(note, (s.why.get(note) || 0) + strength);
  }

  confidence(id) {
    const s = this.skills.get(id);
    if (!s) return 0;
    const perChannel = [...s.channels.entries()].map(([ch, list]) => {
      const ceiling = CHANNELS[ch]?.ceiling ?? 0.6;
      return Math.min(ceiling, or(list));
    });
    return Math.min(1, or(perChannel));
  }

  top(n = 24) {
    return [...this.skills.values()]
      .map((s) => ({
        id: s.id,
        label: label(s.id),
        category: categoryOf(s.id),
        confidence: round(this.confidence(s.id)),
        // Raw magnitude, used only for ranking and bar widths.
        score: round([...s.channels.values()].flat().reduce((a, b) => a + b, 0)),
        channels: [...s.channels.entries()]
          .filter(([, list]) => list.length)
          .map(([ch]) => ({ id: ch, name: CHANNELS[ch]?.name || ch })),
        why: [...s.why.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([text, w]) => ({ text, w: round(w) })),
      }))
      .sort((a, b) => b.confidence - a.confidence || b.score - a.score)
      .slice(0, n);
  }
}

const round = (n) => Math.round(n * 1000) / 1000;

export function languagesInto(ev, languages, prefix = 'language') {
  const total = Object.values(languages || {}).reduce((a, b) => a + b, 0) || 1;
  for (const [lang, bytes] of Object.entries(languages || {})) {
    const share = bytes / total;
    const ids = LANGUAGE_MAP[lang] || [lang.toLowerCase().replace(/[^a-z+#]/g, '')];
    // A little of a language proves you can write it; most of it proves you
    // think in it.
    const strength = 0.3 + 0.7 * share;
    for (const id of ids) {
      ev.add(id, strength, `${prefix}: ${lang} (${Math.round(share * 100)}% of bytes)`, 'language');
    }
  }
}

export function depsInto(ev, deps) {
  for (const [name, version] of Object.entries(deps || {})) {
    const key = name.toLowerCase();
    const ids = DEP_MAP[key] || DEP_MAP[key.replace(/^@[^/]+\//, '')];
    if (!ids) continue;
    const vendored = version === 'vendored';
    for (const id of ids) {
      ev.add(id, vendored ? 0.6 : 0.8, `${vendored ? 'vendored' : 'dependency'}: ${name}${vendored ? '' : `@${version}`}`, 'manifest');
    }
  }
}

// Vendored code is not your code. A file called LightProbeHelper.js inside
// three.js's own addons directory is not evidence that you do security work,
// and meshopt_decoder.js is not evidence that you do networking.
const VENDOR_PATH = /(^|\/)(node_modules|vendor|vendored|addons|third_party|thirdparty|dist|build|out|coverage|bower_components|cdn|\.yarn)\//i;

export function isVendored(p) {
  if (VENDOR_PATH.test(p)) return true;
  const base = p.slice(p.lastIndexOf('/') + 1);
  if (/\.min\.(js|css)$/i.test(base)) return true;
  if (/^(three|OrbitControls)(\.min)?\.js$/i.test(base)) return true;
  if (/\.d\.ts$/.test(base)) return true;
  return false;
}

export function textInto(ev, text, prefix, strengthScale = 1) {
  if (!text) return;
  const body = text.slice(0, MAX_TEXT);
  for (const sig of TEXT_SIGNALS) {
    const re = new RegExp(sig.re.source, sig.re.flags.includes('g') ? sig.re.flags : `${sig.re.flags}g`);
    const matches = body.match(re);
    if (!matches) continue;
    const count = new Set(matches.map((m) => m.toLowerCase())).size;
    // Repetition adds a little, but the channel ceiling stops it from running
    // away: 40 mentions of "mesh" is a documentation habit, not 40x the skill.
    const strength = sig.w * strengthScale * (1 + Math.log2(count)) * 0.5;
    ev.add(sig.id, Math.min(0.55, strength), `${prefix}: "${matches[0].trim()}"`, 'prose');
  }
}

export function pathsInto(ev, paths, strengthScale = 1) {
  for (const p of paths || []) {
    if (isVendored(p)) continue;
    for (const sig of PATH_SIGNALS) {
      if (sig.re.test(p)) ev.add(sig.id, 0.6 * strengthScale, `file: ${p}`, 'path');
    }
  }
}

export function detect({ languages, deps, readme, descriptions, topics, paths }) {
  const ev = new Evidence();
  languagesInto(ev, languages);
  depsInto(ev, deps);
  if (topics?.length) textInto(ev, topics.map((t) => t.replace(/-/g, ' ')).join(' '), 'topic', 1.15);
  if (descriptions?.length) textInto(ev, descriptions.join('\n'), 'project description', 0.85);
  if (readme) textInto(ev, readme, 'README', 1);
  pathsInto(ev, paths, 0.8);
  return ev;
}

export { Evidence };
