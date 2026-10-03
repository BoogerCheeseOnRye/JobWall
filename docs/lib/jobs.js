import { ALIASES, termWeight, stem } from './skills.js';
import { isEntryFriendly, seniorityOf } from './roles.js';
import { parseWage, wageStats, formatWage } from './wages.js';
import { geoOf } from './geo.js';

const TTL_MS = 10 * 60 * 1000;
let feedCache = { at: 0, jobs: [], sources: [] };

// Some feeds hand back escaped-escaped markup ("&lt;p&gt;"), so entities have to
// be decoded before tags can be stripped, or the tags come back as text.
const unescape = (s) =>
  String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

const strip = (html = '') =>
  unescape(
    unescape(String(html))
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();

const arr = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? (() => { try { const p = JSON.parse(v); return Array.isArray(p) ? p : v ? [v] : []; } catch { return v ? [v] : []; } })() : []);

const iso = (v) => {
  if (!v) return null;
  const n = Number(v);
  if (Number.isFinite(n) && String(v).length <= 12) return new Date(n * 1000).toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export const SOURCES = [
  {
    id: 'arbeitnow',
    name: 'Arbeitnow',
    homepage: 'https://www.arbeitnow.com',
    url: 'https://www.arbeitnow.com/api/job-board-api',
    map(raw) {
      return {
        title: raw.title,
        company: raw.company_name || '',
        url: raw.url,
        location: raw.location || '',
        remote: String(raw.remote) === 'True' || /remote/i.test(raw.location || ''),
        tags: arr(raw.tags),
        category: '',
        level: arr(raw.job_types).join(', '),
        description: strip(raw.description),
        publishedAt: iso(raw.created_at),
      };
    },
  },
  {
    id: 'remotive',
    name: 'Remotive',
    homepage: 'https://remotive.com',
    url: 'https://remotive.com/api/remote-jobs',
    map(raw) {
      return {
        title: raw.title,
        company: raw.company_name || '',
        url: raw.url,
        location: raw.candidate_required_location || 'Remote',
        remote: true,
        tags: arr(raw.tags),
        category: raw.category || '',
        level: (raw.job_type || '').replace(/_/g, ' '),
        salary: raw.salary || '',
        description: strip(raw.description),
        publishedAt: iso(raw.publication_date),
      };
    },
  },
  {
    id: 'remoteok',
    name: 'Remote OK',
    homepage: 'https://remoteok.com',
    url: 'https://remoteok.com/api',
    map(raw) {
      if (!raw.position || !raw.url) return null; // legal-notice preamble rows
      const salary = Array.isArray(raw.salary) ? raw.salary.filter(Boolean).join(' - ') : raw.salary || '';
      return {
        title: raw.position,
        company: raw.company || '',
        url: raw.url,
        location: raw.location || 'Remote',
        remote: true,
        tags: [...arr(raw.tags), ...arr(raw.languages)],
        category: raw.tags?.[0] || '',
        level: raw.seniority || raw.experience || '',
        salary,
        description: strip(raw.description),
        publishedAt: iso(raw.date) || iso(raw.last_updated),
      };
    },
  },
  {
    id: 'jobicy',
    name: 'Jobicy',
    homepage: 'https://jobicy.com',
    url: 'https://jobicy.com/api/v2/remote-jobs',
    map(raw) {
      return {
        title: raw.jobTitle,
        company: raw.companyName || '',
        url: raw.url,
        location: raw.jobGeo || 'Remote',
        remote: true,
        tags: [...arr(raw.jobIndustry), ...arr(raw.jobType)],
        category: arr(raw.jobIndustry)[0] || '',
        level: raw.jobLevel || '',
        salary: raw.salaryMin ? `${raw.salaryMin}-${raw.salaryMax || '?'} ${raw.salaryCurrency || ''} ${raw.salaryPeriod || ''}`.trim() : '',
        description: strip(raw.jobDescription || raw.jobExcerpt),
        publishedAt: iso(raw.pubDate),
      };
    },
  },
  {
    // Every other feed here is either EU-heavy (Arbeitnow) or remote-first with
    // geography left unsaid (Remotive, Remote OK, Jobicy), which left a Seattle
    // reader with zero local postings. The Muse is a US board and it says where
    // each role is: "Sarasota, FL". CORS-open, no key, and ~20% of its software
    // engineering rows are in Washington. Its public API caps a page at 20 rows,
    // so breadth comes from paging rather than page_size.
    // Gotcha: the board bot-filters the bare `curl` UA and answers 403. Both
    // paths that matter are fine — Chrome (what a browser sends, since fetch
    // cannot set User-Agent) and our own `jobwall` string — and both come back
    // with Access-Control-Allow-Origin: *. Don't be fooled by a curl 403.
    id: 'muse',
    name: 'The Muse',
    homepage: 'https://www.themuse.com',
    url: 'https://www.themuse.com/api/public/jobs',
    categoryFilter: 'Software Engineering',
    pages: 6,
    map(raw) {
      const locations = (raw.locations || []).map((l) => l?.name || '').filter(Boolean);
      const levels = (raw.levels || []).map((l) => l?.name || '').filter(Boolean);
      return {
        title: raw.name,
        company: raw.company?.name || '',
        url: raw.refs?.landing_page || raw.url || (raw.id ? `https://www.themuse.com/jobs/${raw.id}` : ''),
        location: locations.join(', ') || 'Remote',
        remote: locations.length === 0,
        tags: [...(raw.categories || []).map((c) => c?.name || ''), ...(raw.tags || []).map((t) => t || '')].filter(Boolean),
        category: (raw.categories || [])[0]?.name || '',
        level: levels.join(', '),
        description: strip(raw.contents),
        publishedAt: iso(raw.publication_date),
      };
    },
  },
];

// Feeds that ship salary as numbers give us exact figures; no parsing needed.
function structuredWage(srcId, raw) {
  if (srcId !== 'jobicy' || !raw.salaryMin) return null;
  const min = Number(raw.salaryMin);
  const max = Number(raw.salaryMax || raw.salaryMin);
  if (!Number.isFinite(min) || min <= 0) return null;
  const currency = (raw.salaryCurrency || 'USD').toUpperCase().slice(0, 3);
  const period = /hour/i.test(raw.salaryPeriod || '') ? 'hour' : 'year';
  const bounds = period === 'hour' ? [3, 800] : [8_000, 1_500_000];
  if (min < bounds[0] || max > bounds[1] || max / min > 6) return null; // broken feed row
  return {
    min,
    max: Number.isFinite(max) && max >= min ? max : min,
    currency,
    period,
    raw: `${raw.salaryMin}-${raw.salaryMax || raw.salaryMin} ${raw.salaryCurrency || ''} ${raw.salaryPeriod || ''}`.trim(),
    stated: true,
  };
}

// Each board wraps its payload differently.
const listFor = (srcId, body) => {
  if (srcId === 'arbeitnow') return body.data;
  if (srcId === 'remotive') return body.jobs;
  if (srcId === 'jobicy') return body.jobs;
  if (srcId === 'muse') return body.results;
  return body;
};

const urlsFor = (src) => {
  if (!src.pages) return [src.url];
  const q = new URLSearchParams({ category: src.categoryFilter });
  return Array.from({ length: src.pages }, (_, i) => `${src.url}?${q}&page=${i + 1}`);
};

async function loadSource(src) {
  const settled = await Promise.allSettled(
    urlsFor(src).map((url) =>
      fetch(url, {
        headers: { 'User-Agent': 'jobwall/1.0 (+local)', Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      }).then((res) => {
        if (!res.ok) throw new Error(`${src.name} HTTP ${res.status}`);
        return res.json();
      })
    )
  );

  const good = settled.filter((r) => r.status === 'fulfilled');
  // One flaky page must not cost the whole board, but if every page failed the
  // source is genuinely down and the UI should say so rather than show 0 jobs.
  if (!good.length) {
    const first = settled.find((r) => r.status === 'rejected');
    throw first?.reason || new Error(`${src.name}: no response`);
  }

  const out = [];
  for (const r of good) {
    const list = listFor(src.id, r.value);
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      let job;
      try {
        job = src.map(raw);
      } catch {
        continue;
      }
      if (!job || !job.title || !job.url) continue;
      // The board's own salary field first (structured beats guessed), then the
      // prose. Never invented: null means the posting did not say.
      job.wage =
        structuredWage(src.id, raw) ||
        parseWage(job.salary) ||
        parseWage(job.description);
      job.geo = geoOf(job.location, { remote: job.remote });
      out.push({
        ...job,
        id: `${src.id}:${job.url}`,
        alsoOn: null,
        source: src.id,
        sourceName: src.name,
        sourceUrl: src.homepage,
      });
    }
  }
  return out;
}

export async function fetchFeed({ force = false } = {}) {
  if (!force && Date.now() - feedCache.at < TTL_MS && feedCache.jobs.length) {
    return feedCache;
  }
  const settled = await Promise.allSettled(SOURCES.map(loadSource));
  const jobs = [];
  const sources = [];
  settled.forEach((r, i) => {
    const src = SOURCES[i];
    if (r.status === 'fulfilled') {
      jobs.push(...r.value);
      sources.push({ id: src.id, name: src.name, ok: true, count: r.value.length, url: src.homepage });
    } else {
      sources.push({ id: src.id, name: src.name, ok: false, count: 0, url: src.homepage, error: r.reason?.message });
    }
  });

  // Same job posted to three boards is one job, not three.
  const seen = new Map();
  for (const j of jobs) {
    const key = `${j.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ')}|${j.company.toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, j);
      continue;
    }
    prev.alsoOn = [...new Set([...(prev.alsoOn || []), prev.sourceName])];    if ((j.description?.length || 0) > (prev.description?.length || 0)) prev.description = j.description;
  }

  feedCache = { at: Date.now(), jobs: [...seen.values()], sources };
  return feedCache;
}

// ---------------------------------------------------------------- scoring ---

function tokenSet(str) {
  return new Set(
    String(str || '')
      .toLowerCase()
      .split(/[^a-z0-9+#]+/)
      .filter(Boolean)
      .map((t) => stem(t))
      .filter(Boolean)
  );
}

// Which job-posting terms does this text speak to, for a given skill?
function skillHits(text, skillId, tokens) {
  const terms = ALIASES[skillId];
  if (!terms) return { weight: 0, terms: [] };
  const padded = ` ${String(text).toLowerCase()} `;
  let weight = 0;
  const found = [];
  for (const term of terms) {
    const t = term.toLowerCase();
    const w = termWeight(t);
    if (t.includes(' ')) {
      if (padded.includes(` ${t} `)) {
        weight += w;
        found.push(t);
      }
    } else if (tokens.has(stem(t))) {
      weight += w;
      found.push(t);
    } else if (/[.#+\d]/.test(t) && padded.includes(t)) {
      // node.js, three.js, c++, c#, sveltekit, next.js: punctuation survives
      // tokenization badly, so these fall back to a literal scan.
      weight += w;
      found.push(t);
    }
  }
  return { weight, terms: found };
}

// Words that appear in almost every software job title. Matching one of these
// is not evidence that the job is for you: "Product Manager" at a quantum
// company scores badly on "product" alone.
const GENERIC_TITLE = new Set([
  'engineer', 'engineering', 'software', 'product', 'web', 'developer', 'development',
  'team', 'tech', 'technical', 'full', 'remote', 'digital', 'it', 'system', 'systems',
  'staff', 'principal', 'senior', 'sr', 'ii', 'work', 'services', 'service', 'group',
  'solutions', 'technology', 'computing', 'computer', 'programmer', 'program',
]);

function titleAffinity(role, jobTitleTokens) {
  const strong = (role.titleTokens || []).filter((t) => !GENERIC_TITLE.has(stem(t)));
  const hits = strong.filter((t) => jobTitleTokens.has(stem(t)));
  if (!hits.length) return { score: 0, hits };
  // One discriminating word ("frontend", "security", "graphics") is a real
  // match. Two is a certainty.
  return { score: Math.min(1, hits.length / 1.5), hits };
}

// A portfolio cannot get you a job whose deliverable is not code.
const NON_ENGINEERING_TITLE =
  /\b(manager|assistant|specialists?|account executives?|sales|recruiters?|trainers?|representatives?|coordinators?|administrators?|nurses?|teachers?|interns?|apprentices?|consultants?|analysts?)\b/i;
const ENGINEERING_TITLE = /\b(engineer|developer|programmer|architect|scientist|researcher|devops|sre)\b/i;
const ENTRY_TITLE = /\b(intern|internship|entry|graduate|new grad|junior|jr\.?|associate|apprentice|trainee|student)\b/i;

const GATE_RULES = [
  { id: 'years', re: /(\d{1,2})\s*\+?\s*(?:-|to)?\s*\d?\s*years?/i, severity: (m) => Math.min(16, 4 + Number(m[1]) * 1.5), scope: 'body', build: (m) => `asks for ${m[1]}+ years of experience` },
  { id: 'senior', re: /\b(senior|sr\.?|staff|principal|distinguished|lead|head of|director)\b/i, severity: 9, scope: 'title', build: () => 'senior/lead title' },
  { id: 'grad', re: /\b(bachelor'?s?|b\.?s\.?|master'?s?|m\.?s\.?|ph\.?d|doctorate|degree in (?:computer science|cs|math|physics|engineering))\b/i, severity: 7, scope: 'body', build: () => 'asks for a degree' },
  { id: 'clearance', re: /\b(security clearance|ts\/sci|public trust|top secret)\b/i, severity: 12, scope: 'body', build: () => 'needs security clearance' },
  { id: 'onsite', re: /\b(on-?site|in-?office|relocation required|relocating)\b/i, severity: 6, scope: 'body', build: () => 'on-site / relocation' },
  { id: 'sponsor', re: /\b(no sponsorship|does not sponsor|unable to sponsor|h-?1b sponsorship required|authorized to work)\b/i, severity: 8, scope: 'body', build: () => 'work-authorization / sponsorship hurdle' },
];

function detectGates(job, bodyText) {
  const gates = [];
  const title = ` ${job.title} `;
  const body = ` ${job.title} ${bodyText.slice(0, 1800)} `;
  if (NON_ENGINEERING_TITLE.test(job.title) && !ENGINEERING_TITLE.test(job.title)) {
    gates.push({ id: 'nondev', severity: 22, text: 'not an engineering role — your portfolio is not the deliverable' });
  }
  for (const rule of GATE_RULES) {
    // exec, not match: match() drops capture groups and every rule here has one.
    const m = new RegExp(rule.re.source, 'i').exec(rule.scope === 'title' ? title : body);
    if (!m) continue;
    if (gates.some((g) => g.id === rule.id)) continue;
    let sev = typeof rule.severity === 'function' ? rule.severity(m) : rule.severity;
    if (rule.id === 'senior' && (isEntryFriendly(title) || ENTRY_TITLE.test(job.title))) sev = 3;
    gates.push({ id: rule.id, severity: sev, text: rule.build(m) });
  }
  return gates.sort((a, b) => b.severity - a.severity);
}

function freshness(publishedAt) {
  if (!publishedAt) return 0.4;
  const days = (Date.now() - new Date(publishedAt).getTime()) / 86_400_000;
  if (days < 7) return 1;
  if (days < 21) return 0.8;
  if (days < 45) return 0.55;
  return 0.3;
}

const strengthOf = (s) => s.confidence ?? 0;

const prettyTerm = (t) =>
  String(t || '').replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b\w+\.js\b/g, (m) => m);

export function scoreJob(job, { skills, roles, topN = 40 }) {
  const headline = ` ${[job.title, job.company, job.tags.join(' '), job.category, job.level].join(' ').toLowerCase()} `;
  const desc = ` ${job.description.slice(0, 3000).toLowerCase()} `;
  const full = `${headline} ${desc}`;
  const tokens = tokenSet(`${job.title} ${job.tags.join(' ')} ${job.category} ${job.level} ${job.description.slice(0, 1200)}`);

  const topSkills = skills.slice(0, 14);

  // Everything this posting speaks to, whether or not you have proven it.
  const mentioned = new Set();
  const askedTerms = new Map();
  for (const id of Object.keys(ALIASES)) {
    const h = skillHits(full, id, tokens);
    if (h.weight > 0) {
      mentioned.add(id);
      askedTerms.set(id, h.terms);
    }
  }

  // Share of your actual strengths this posting speaks to, weighted by how
  // strong each one is. Naming a skill in the headline counts double.
  const have = [];
  const strengthDen = topSkills.reduce((a, s) => a + strengthOf(s), 0) || 1;
  let coverageNum = 0;
  const headlineTokens = tokenSet(headline);
  for (const s of topSkills) {
    const h = skillHits(full, s.id, tokens);
    if (h.weight <= 0) continue;
    const inHeadline = skillHits(headline, s.id, headlineTokens).weight > 0;
    coverageNum += strengthOf(s) * (inHeadline ? 1 : 0.55);
    have.push({
      id: s.id,
      label: s.label,
      strength: strengthOf(s),
      inHeadline,
      asks: [...new Set(h.terms)].slice(0, 3),
    });
  }
  have.sort((a, b) => b.strength - a.strength);
  const skillCoverage = coverageNum / strengthDen;

  // What does the job want that your submitted work does not show?
  const owned = new Set(skills.map((s) => s.id));
  const wants = [];
  for (const id of mentioned) {
    if (owned.has(id)) continue;
    const terms = askedTerms.get(id) || [];
    if (terms.reduce((a, t) => a + termWeight(t), 0) < 4) continue;
    wants.push({ id, label: prettyTerm(terms[0]), asks: terms.slice(0, 2) });
  }
  wants.sort((a, b) => b.asks.length - a.asks.length);

  const haveIds = new Set(have.map((h) => h.id));
  let bestRole = null;
  for (const role of roles) {
    // A role skill the posting never mentions barely counts against you; one it
    // insists on and you can't show counts fully. That is what makes this score
    // about the posting instead of about the job family.
    let num = 0;
    let den = 0;
    const W = (id, w) => (mentioned.has(id) ? w : w * 0.3);
    for (const [id, w] of role.core ?? []) {
      den += W(id, w);
      if (haveIds.has(id)) num += W(id, w);
    }
    for (const [id, w] of role.bonus ?? []) {
      den += W(id, w * 0.85);
      if (haveIds.has(id)) num += W(id, w * 0.85);
    }
    const coverage = den ? num / den : 0;
    const { score: titleScore } = titleAffinity(role, tokenSet(job.title));
    // The title is a gate, not a garnish. A posting whose title never names
    // anything you do cannot score highly just because the company writes a
    // flattering description.
    const value = (0.7 * coverage + 0.3 * titleScore) * (0.35 + 0.65 * titleScore);
    if (!bestRole || value > bestRole.value) {
      bestRole = { id: role.id, title: role.title, value, coverage, titleScore };
    }
  }

  const titleTokens = tokenSet(job.title);
  const titleMatch = have.some((h) => skillHits(` ${job.title.toLowerCase()} `, h.id, titleTokens).weight > 0) ? 1 : 0;
  const gates = detectGates(job, desc);
  const gatePenalty = Math.min(40, gates.reduce((a, g) => a + g.severity, 0));
  const level = seniorityOf(`${job.title} ${job.level}`);
  const entry = isEntryFriendly(`${job.title} ${job.level} ${job.description.slice(0, 600)}`);

  // The title gates the whole score: if no role name appears in it, the posting
  // cannot outrank one whose title names the work you can already do.
  const titleFactor = 0.4 + 0.6 * (bestRole?.titleScore || 0);
  const evidence =
    titleFactor * (0.5 * (bestRole?.value || 0) + 0.25 * Math.min(1, skillCoverage * 1.8) + 0.1 * titleMatch) +
    0.1 * freshness(job.publishedAt);
  const match = Math.max(1, Math.round(evidence * 100));
  const realistic = Math.max(1, match - gatePenalty);

  return {
    ...job,
    // The renderer must never have to guard against a missing field.
    title: job.title || 'Untitled role',
    company: job.company || '',
    location: job.location || '',
    salary: job.salary || '',
    description: job.description || '',
    wage: job.wage || null,
    alsoOn: job.alsoOn ?? null,
    tags: job.tags || [],
    match,
    realistic,
    role: bestRole
      ? { id: bestRole.id, title: bestRole.title, score: Math.round(bestRole.value * 100), titleScore: Math.round(bestRole.titleScore * 100) }
      : null,
    matched: have.slice(0, 6).map((h) => ({ label: h.label, asks: h.asks, inHeadline: h.inHeadline })),
    wants: wants.slice(0, 4),
    gates,
    level,
    entryFriendly: entry,
    sourceKind: 'api',
  };
}

export function rankJobs({ jobs, skills, roles, rates = null, perRole = 6, total = 36 }) {
  const enriched = jobs
    .map((j) => scoreJob(j, { skills, roles }))
    .filter((j) => j.match >= 12)
    // Rendering-ready pay label; FX lives here so scoring stays pure.
    .map((j) => ({ ...j, wageLabel: j.wage ? formatWage(j.wage, rates)?.label || null : null, wageUsd: formatWage(j.wage, rates)?.usdLabel || null }));

  // True counts, before the display cap: "6 openings" and "47 openings" are
  // very different answers to which title the market wants.
  const counts = new Map();
  for (const j of enriched) {
    if (!j.role) continue;
    counts.set(j.role.id, (counts.get(j.role.id) || 0) + 1);
  }

  const byRole = new Map();
  const pay = [];
  for (const role of roles) {
    const pool = enriched.filter((j) => j.role?.id === role.id).sort((a, b) => b.realistic - a.realistic);
    if (!pool.length) continue;
    byRole.set(role.id, pool.slice(0, perRole));
    // What the market is actually paying for this title, from the postings that
    // match it and state their own terms. Never modelled, never guessed.
    pay.push({ roleId: role.id, ...wageStats(pool, rates) });
  }

  const all = enriched.sort((a, b) => b.realistic - a.realistic).slice(0, total);
  return {
    all,
    counts: [...counts.entries()].map(([roleId, n]) => ({ roleId, count: n })),
    byRole: [...byRole.entries()].map(([roleId, list]) => ({ roleId, jobs: list })),
    pay,
  };
}
