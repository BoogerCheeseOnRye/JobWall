// Resume text -> structured record.
//
// The hard part of a resume is not the words, it is the layout. A PDF has no
// paragraphs, only glyphs at coordinates, so the text arrives hard-wrapped at
// whatever column the author was typing into, section headers look like
// ordinary sentences, and a job entry can be "Title" on one line with
// "Org | City | Dates" on the next. Everything here is about recovering the
// author's intent from that.
//
// The output is deliberately not a guess at one canonical resume schema. It is
// a record of what was actually found, with per-field confidence, so the UI can
// show a person what it read and let them correct it.

export const SECTION_ALIASES = [
  { key: 'summary', re: /^(professional\s+)?(summary|profile|objective|about|overview|summary of|profile\s+summary)\b/i },
  { key: 'skills', re: /^(technical\s+)?(skills?|technologies|tech\s+stack|competencies|technical\s+competencies|toolbox|areas?\s+of\s+expertise)\b/i },
  { key: 'experience', re: /^(professional\s+|work\s+|relevant\s+)?(experience|employment|work\s+history|career\s+history|background)\b/i },
  { key: 'projects', re: /^(selected\s+|key\s+|featured\s+|notable\s+|personal\s+|side\s+|additional\s+)?(projects?|portfolio|selected\s+work|side\s+projects?|personal\s+projects?)\b/i },
  { key: 'education', re: /^(education|education\s*&?\s*(additional|certifications?)|academic|training|certifications?|coursework)\b/i },
  { key: 'awards', re: /^(awards?|honors?|achievements?|recognition|publications?)\b/i },
  // Not parsed into their own shapes, but an unrecognised heading is swallowed
  // by the section above it, so they need a key to survive the round trip.
  { key: 'volunteer', re: /^(volunteer(ing|\s+experience)?|community\s+(work|involvement)|service\s+&\s+learning)\b/i },
  { key: 'talks', re: /^(talks?|speaking|presentations?|conferences?|workshops?|lectures?)\b/i },
  { key: 'research', re: /^(research|research\s*&\s*publications?|patents?|papers?|lab\s+work)\b/i },
  { key: 'activities', re: /^(activities|interests?|hobbies|memberships?|affiliations?|organizations?|associations?|boards?|committees?)\b/i },
  { key: 'teaching', re: /^(teaching|instructing|mentoring|tutoring)\b/i },
  { key: 'press', re: /^(press|media|media\s+mentions|appearances?|features?|articles?\s+about)\b/i },
];

const LIGATURES = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };
const DASHES = { '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-' };
const QUOTES = { '‘': "'", '’': "'", '“': '"', '”': '"' };

export function normalize(text) {
  let out = String(text ?? '');
  out = out.replace(/[ﬀ-ﬆ]/g, (c) => LIGATURES[c] || c);
  out = out.replace(/[‐-―−]/g, (c) => DASHES[c] || c);
  out = out.replace(/[‘’]/g, (c) => QUOTES[c] || c);
  out = out.replace(/[“”]/g, (c) => QUOTES[c] || c);
  out = out
    .replace(/\r\n?/g, '\n')
    .replace(/[   ]/g, ' ')
    .replace(/­/g, '')
    .replace(/[•·◦▪‣●○]/g, '•')
    .replace(/\t+/g, ' ')
    .replace(/ +\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
// "City, ST" or "City, State", delimited by a bullet/pipe or the end of the
// line so it cannot eat into the next field.
const LOCATION = /(?:^|[\s,•|;])\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)?,\s*(?:[A-Z]{2}\b|[A-Z][a-z]+))(?=\s*(?:[•|,;]|$))/;
const URLISH = /\b((?:https?:\/\/)?(?:www\.)?(?:github\.com|linkedin\.com|x\.com|twitter\.com|[a-z0-9-]+\.(?:com|dev|io|me|net|org|xyz|page|site|so|sh))\/\S+|[a-z0-9-]+\.(?:dev|io|me|page|site|xyz|so|sh)\b)/gi;

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec';
const DATE_RANGE = new RegExp(
  `((?:${MONTHS})?\\s*\\d{4}|present|current|now)\\s*(?:-|to|–|—)\\s*((?:${MONTHS})?\\s*\\d{4}|present|current|now)`,
  'i'
);
const SINGLE_DATE = new RegExp(`\\b((?:${MONTHS})\\.?\\s*\\d{4}|\\d{4})\\b`, 'i');

const MONTH_INDEX = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

// "Sept 2023" and "September 2023" both mean 2023-09; a bare year means January,
// which is only ever used for ordering, never shown back to the reader.
function normalizeDate(raw) {
  if (!raw) return null;
  const source = String(raw).trim();
  const text = source.toLowerCase();
  if (/^(present|current|now)$/.test(text)) return { raw: source, iso: null, current: true };
  const m = new RegExp(`^(${MONTHS})\\.?\\s*(\\d{4})$`).exec(text);
  if (m) return { raw: source, iso: `${m[2]}-${String(MONTH_INDEX[m[1]] + 1).padStart(2, '0')}`, current: false };
  const y = /^(\d{4})$/.exec(text);
  if (y) return { raw: source, iso: `${y[1]}-01`, current: false };
  return { raw: source, iso: null, current: false };
}

function parseDates(text) {
  const range = DATE_RANGE.exec(text);
  if (range) {
    return { start: normalizeDate(range[1]), end: normalizeDate(range[2]), raw: range[0].trim() };
  }
  const single = SINGLE_DATE.exec(text);
  if (single) return { start: normalizeDate(single[1]), end: null, raw: single[1].trim() };
  return { start: null, end: null, raw: null };
}

const looksLikeUrl = (s) => /^(https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,}\/)/i.test(s.trim());
const splitOnPipes = (s) => s.split(/\s*[|•·]\s*/).map((x) => x.trim()).filter(Boolean);

// Skill lists separate entries with commas as often as bullets, and commas also
// appear inside entries ("JavaScript (vanilla + Node.js)"). Only separators at
// bracket depth zero are real breaks.
function splitItems(text) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (const ch of String(text)) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (depth === 0 && /[,;•]/.test(ch)) {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  out.push(buf);
  return out.map((x) => x.replace(/[\s,;•]+$/, '').trim()).filter(Boolean);
}

function sectionKeyFor(line, style) {
  const text = line.trim();
  if (!text || text.length > 46) return null;
  if (style && /^heading/i.test(style)) {
    const hit = SECTION_ALIASES.find((a) => a.re.test(text));
    return hit ? hit.key : null;
  }
  const shouty = text === text.toUpperCase() && /[A-Z]/.test(text) && text.length <= 46;
  if (!shouty) return null;
  return SECTION_ALIASES.find((a) => a.re.test(text))?.key || null;
}

// Splits the document into sections. Unlabelled trailing content is kept under
// "other" rather than dropped, so nothing silently disappears.
function splitSections(text, paragraphs) {
  const lines = normalize(text).split('\n');
  const styleByLine = new Map();
  if (paragraphs) {
    let i = 0;
    for (const p of paragraphs) {
      for (const l of normalize(p.text).split('\n')) {
        if (l.trim() || i === 0) styleByLine.set(i, p.style || '');
        i++;
      }
    }
  }
  const sections = [{ key: 'header', lines: [] }];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const key = sectionKeyFor(line, styleByLine.get(i));
    if (key) sections.push({ key, lines: [] });
    else sections.at(-1).lines.push(line);
  }
  const used = new Set(sections.map((s) => s.key));
  return sections.map((s) => ({ ...s, lines: s.lines.map((l) => l.trim()) })).filter((s) => used.has(s.key) || s.lines.some((l) => l));
}

// ---------------------------------------------------------------- contact
// First sentence, trimmed to a whole word. Cutting at 160 characters mid-word
// produces a headline that reads like a truncation bug.
function firstSentence(text, limit) {
  const flat = text.replace(/\s+/g, ' ').trim();
  const stop = flat.search(/[.!?](?=\s|$)/);
  let sentence = stop === -1 ? flat : flat.slice(0, stop + 1);
  if (sentence.length > limit) {
    const cut = sentence.slice(0, limit);
    const space = cut.lastIndexOf(' ');
    sentence = (space > limit * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '') + '\u2026';
  }
  return sentence;
}

function parseContact(headerLines) {
  const blob = headerLines.filter(Boolean).join('\n');
  const out = {
    name: null,
    email: blob.match(EMAIL)?.[0] || null,
    phone: blob.match(PHONE)?.[0]?.trim() || null,
    location: null,
    links: {},
  };

  for (const m of blob.matchAll(URLISH)) {
    let u = m[1].replace(/[),.;]+$/, '');
    if (!u.includes('/') && !/\.[a-z]{2,}$/i.test(u)) continue;
    const lower = u.toLowerCase();
    if (lower.includes('github.com')) out.links.github = u.replace(/^https?:\/\//, '');
    else if (lower.includes('linkedin.com')) out.links.linkedin = u.replace(/^https?:\/\//, '');
    else if (lower.includes('twitter.com') || lower.includes('x.com')) out.links.x = u.replace(/^https?:\/\//, '');
    else if (!out.links.website) out.links.website = u.replace(/^https?:\/\//, '');
  }
  const handle = /(^|\s)@([A-Za-z0-9_]{2,})\b/.exec(blob);
  if (handle && !out.links.x) out.links.x = `@${handle[2]}`;

  for (const line of headerLines) {
    const bare = line.trim();
    if (!bare) continue;
    // Email, phone and URLs are removed rather than skipping the whole line:
    // "jane@x.com | (555) 010-1234 | Seattle, WA" still has a location on it,
    // and resumes put all four on one line all the time.
    const probe = bare
      .replace(EMAIL, ' ')
      .replace(PHONE, ' ')
      .replace(/[@#]?\b(?:https?:\/\/|www\.)?\w[\w.-]*\.(?:com|net|org|dev|io|me|ai|app|xyz|co)\b\/?/gi, ' ')
      .replace(/[@#][A-Za-z0-9_]{2,}/g, ' ')
      .replace(/\s*[|,;]\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!probe) continue;
    if (/^(github|linkedin|x|twitter|email|phone|site|website)\b\s*[:：]/i.test(probe)) continue;

    const loc = LOCATION.exec(line.trim());
    if (loc && !out.location && !/\d{4}/.test(loc[1])) {
      out.location = loc[1].replace(/\s+/g, ' ').trim();
      continue;
    }
    const words = probe.split(/\s+/);
    const nameish =
      words.length >= 2 &&
      words.length <= 4 &&
      words.every((w) => /^[A-Z][A-Za-z'’-]*[.,]?$/.test(w)) &&
      !/•/.test(probe);
    if (nameish && !out.name) {
      out.name = tidyName(probe);
      continue;
    }
    if (!out.name && words.length <= 6 && !/\d/.test(probe) && /^[A-Z]/.test(probe) && probe.length < 40 && !out.location) {
      out.name = tidyName(probe);
    }
  }
  out.name = out.name ? tidyName(out.name) : null;
  return out;
}

// ----------------------------------------------------------------- skills
// Two shapes appear in the wild: "Languages: a, b, c" (labelled, often wrapped
// across lines) and one long "a • b • c" run (unlabelled). Both are handled,
// because half of these three resumes use each.
function parseSkills(lines) {
  const groups = [];
  const items = [];
  let current = null;
  let endedOnSeparator = false;

  const pushItem = (text) => {
    const t = text.replace(/[•,;]\s*$/, '').trim();
    if (!t) return;
    if (current) current.items.push(t);
    else items.push(t);
  };

  const handle = (line) => {
    const labeled = /^([A-Za-z][A-Za-z /&+]{2,28}?)\s*[:：]\s*(.+)$/.exec(line);
    if (labeled && !looksLikeUrl(labeled[1])) {
      current = { category: labeled[1].trim(), items: [] };
      groups.push(current);
      for (const part of splitItems(labeled[2])) pushItem(part);
      return;
    }
    // A wrapped continuation line belongs to whatever was last being collected.
    // When it starts lowercase and the previous line did not stop on a separator
    // it is finishing the previous item rather than starting one: "1-bit
    // quantization + pruning + weight" / "sharing, Ollama / Llama.cpp, ..." must
    // not produce an item called "sharing". Meanwhile "coaching," /
    // "prioritization, attention to detail" really is two items. This has to be
    // checked before the comma-split below, or the list-shaped continuation
    // never gets here.
    if (/^[a-z]/.test(line) && !endedOnSeparator && current?.items.length && !current.items.at(-1).match(/[).]$/)) {
      const [first, ...rest] = splitItems(line);
      current.items[current.items.length - 1] += ` ${first}`;
      for (const part of rest) current.items.push(part);
      return;
    }
    const parts = splitItems(line);
    if (parts.length > 1) {
      for (const part of parts) pushItem(part);
      return;
    }
    pushItem(line);
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    handle(line);
    // Assigned here rather than inside handle() so that every early return still
    // leaves the flag describing the line that was just consumed.
    endedOnSeparator = /[,;]\s*$/.test(line);
  }

  const normalized = groups
    .map((g) => ({ category: g.category, items: dedupe(g.items) }))
    .filter((g) => g.items.length);
  const loose = dedupe(items);
  if (loose.length) normalized.push({ category: 'Skills', items: loose });
  return normalized;
}

const dedupe = (list) => {
  const seen = new Set();
  return list.filter((s) => {
    const k = s.toLowerCase().replace(/[.\s]/g, '');
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

// A PDF line break in the middle of a word leaves a trailing dash. Joining
// without the space repairs "Replit-\nstyle" and "fine-\ntuning" alike.
function joinWrapped(text, next) {
  const t = String(text || '').trim();
  const n = String(next || '').trim();
  if (!t) return n;
  if (!n) return t;
  return /[–—-]$/.test(t) && /^[a-z]/.test(n) ? `${t}${n}` : `${t} ${n}`;
}

// ------------------------------------------------------------- experience
// Three layouts are in the wild and all three appear in one set of resumes:
//   "Title" / "Org | Dates" on the next line          (block layout)
//   "Title | Org | Dates - description" on one line   (inline layout)
//   "Title" / "Location | Dates" / bullets           (bullet layout)
// Splitting on the pipe and then guessing which part is the place is the whole
// trick: "Seattle | 2025-Present" and "Domino's Pizza | Sept 2023 - Jan 2026"
// have identical shapes and opposite meanings.

const PLACE_HINT = /^(remote|hybrid|on-?site|anywhere|worldwide|wfh|area|city)$/i;
function isPlaceLike(text) {
  const t = String(text).trim();
  if (!t || /\d/.test(t) || t.length > 34) return false;
  if (/,\s*[A-Z]{2}\b/.test(t)) return true;
  if (PLACE_HINT.test(t)) return true;
  const words = t.split(/\s+/);
  if (words.length !== 1) return false;
  // A lone capitalised word is a city far more often than it is an employer.
  return /^[A-Z][a-z]{2,}$/.test(words[0]);
}

const KICKER = /^(earlier|additional|previous|prior|other|remaining)\b[^:]*:/i;

function parseExperience(lines) {
  const entries = [];
  let current = null;
  let closed = true;

  const start = (fields) => {
    current = {
      title: null,
      org: null,
      location: null,
      start: null,
      end: null,
      current: false,
      kicker: null,
      bullets: [],
      raw: [],
      ...fields,
    };
    entries.push(current);
    closed = false;
  };

  const looksLikeTitle = (body) => body.length < 70 && !/[.!?,;:]$/.test(body) && /^[A-Z0-9]/.test(body);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      closed = true;
      continue;
    }
    const bullet = /^[•*\-–]\s+(.*)$/.exec(line);
    const body = bullet ? bullet[1].trim() : line;

    if (bullet) {
      if (!current || closed) start();
      current.bullets.push(body);
      current.raw.push(line);
      continue;
    }

    // "Earlier roles: Assistant Manager (Jack in the Box), Lead Dishwasher, ..."
    // is a footnote, not a job, and it must not become a role with a 90-character
    // title.
    const kicker = KICKER.exec(body);
    if (kicker) {
      start({ kicker: body.slice(0, body.indexOf(':')).trim() });
      current.bullets.push(body.slice(body.indexOf(':') + 1).trim());
      current.raw.push(line);
      continue;
    }

    const dates = parseDates(body);
    const parts = splitOnPipes(body);
    const dateIdx = parts.findIndex((p) => p.includes(dates.raw || '\u0000'));

    if (dates.raw && dateIdx >= 0 && (dates.start || dates.end)) {
      if (!current || closed || current.bullets.length || current.org) start();

      // "2025-Present - In-person tutoring on local LLMs" carries the first
      // achievement of the job on the same line as the dates.
      const datePart = parts[dateIdx];
      const tail = datePart
        .slice(datePart.indexOf(dates.raw) + dates.raw.length)
        .replace(/^[\s\-–—:|,]+/, '')
        .trim();
      if (tail.length > 25) current.bullets.push(tail);

      const head = parts.slice(0, dateIdx).filter(Boolean);
      let place = null;
      if (head.length >= 2 && isPlaceLike(head.at(-1))) place = head.pop();
      else if (head.length === 1 && isPlaceLike(head[0]) && !current.org) place = head.shift();
      if (place) current.location = place;

      if (head.length) {
        if (!current.title) current.title = head[0];
        if (!current.org) {
          const candidate = head.length > 1 ? head.slice(1).join(' / ') : head[0];
          if (candidate !== current.title) current.org = candidate;
        }
      }
      current.start = dates.start;
      current.end = dates.end;
      current.current = !!(dates.end?.current || dates.start?.current);
      current.raw.push(line);
      continue;
    }

    // A blank line mid-sentence is a layout artefact, not an entry boundary.
    if (closed && entries.length && /^[a-z(]/.test(body) && entries.at(-1).bullets.length) {
      const prev = entries.at(-1);
      prev.bullets[prev.bullets.length - 1] = joinWrapped(prev.bullets[prev.bullets.length - 1], body);
      prev.raw.push(line);
      continue;
    }

    if (
      !current ||
      closed ||
      (current.bullets.length && looksLikeTitle(body)) ||
      (current.start && !current.org && !current.bullets.length && looksLikeTitle(body))
    ) {
      start();
    }
    if (!current.title && !current.org && !current.bullets.length) current.title = body;
    else if (current.bullets.length && !looksLikeTitle(body)) {
      // Bullet text hard-wraps across lines. Appending keeps it one bullet
      // instead of inflating the count and cutting every achievement in half.
      current.bullets[current.bullets.length - 1] = joinWrapped(current.bullets[current.bullets.length - 1], body);
    } else if (!current.org && body.length < 70 && looksLikeTitle(body)) current.org = body;
    else current.bullets.push(body);
    current.raw.push(line);
  }

  return entries
    .map((e) => ({ ...e, raw: e.raw.join(' ') }))
    .filter((e) => e.title || e.org || e.bullets.length);
}

// --------------------------------------------------------------- projects
// Four shapes show up across one set of resumes:
//   "Name | github.com/x/y" + wrapped description   (block)
//   "Name | github.com/x/y" on its own continuation line (block, split)
//   "Name (github.com/x/y) - description"           (inline)
//   "Name - description"                           (inline, no url)
// plus inline runs ("GameEngine (...) - Physics sims - VoidScream") under a
// sub-heading ("Additional Projects", "Others:"). Splitting the name from the
// blurb is the hard part: names themselves contain dashes ("ODT - Offline Dev
// Tools"), so the sentence-length test is applied to the LAST dash segment.

const PROJECT_URL =
  /((?:https?:\/\/)?(?:www\.)?(?:github\.com|gitlab\.com|bitbucket\.org|codeberg\.org|[a-z0-9][\w-]*(?:\.[a-z0-9-]+)+\.[a-z]{2,})\/\S+)/i;

function tidyUrl(u) {
  return String(u)
    .replace(/^https?:\/\//i, '')
    .replace(/\s+/g, '')
    .replace(/[)\]}>.,;:!?'"]+$/, '');
}

// Pull a candidate heading apart into name / url / description.
function splitProjectHeading(body) {
  const urlMatch = body.match(PROJECT_URL);
  const url = urlMatch ? tidyUrl(urlMatch[1]) : null;

  // "Name (github.com/x/y) - blurb" / "Name | url | blurb": anything after the
  // url on the same line is the blurb, however short. When the url ends the
  // line there is nothing here and the wrapped-line rules below take over.
  if (urlMatch) {
    const before = body.slice(0, urlMatch.index).replace(/[\s()[\]}>–—•|,:–-]+$/, '').trim();
    const after = body.slice(urlMatch.index + urlMatch[0].length).replace(/^[\s()[\]}>–—•|,:–-]+/, '').trim();
    if (after.length && before && /[A-Za-z]/.test(before)) {
      return { name: before, url, description: after };
    }
  }

  let rest = body;
  if (urlMatch) {
    rest = `${body.slice(0, urlMatch.index)} ${body.slice(urlMatch.index + urlMatch[0].length)}`;
    rest = rest.replace(/\(\s*\)/g, '').replace(/\[\s*\]/g, '');
  }
  rest = rest.replace(/\s*[|•·]\s*$/, '').trim();
  // A line that is nothing but a url belongs to the entry above it.
  if (url && rest.replace(/[()\s]/g, '') === '') return { name: '', url, description: '' };
  if (url && rest === url) return { name: '', url, description: '' };
  // "(url) - Python pipeline for ...": what follows a url on its own line is a
  // description, not another name, however short it looks.
  if (/^[\s|•·–—-]/.test(rest) && rest.replace(/^[\s|•·–—-]+/, '').trim().length) {
    return { name: '', url, description: rest.replace(/^[\s|•·–—-]+/, '').trim() };
  }

  const segments = rest.split(/\s[–—-]\s/);
  if (segments.length > 1) {
    const tail = segments[segments.length - 1];
    const wrapped = /[–—-]$/.test(rest.trim());
    if (tail.trim().length >= 40 || wrapped || rest.length > 55) {
      return {
        name: segments.slice(0, -1).join(' - ').trim(),
        url,
        description: tail.trim(),
      };
    }
  }
  return { name: rest, url, description: '' };
}

const PLAIN_TECH = /^(python|javascript|typescript|java|rust|c\+\+|c|c#|go|golang|ruby|php|swift|kotlin|dart|scala|perl|bash|shell|sql|html|css|scss|tailwind|react|vue|svelte|angular|node|nodejs|deno|django|flask|fastapi|express|nextjs|next|vite|webpack|docker|kubernetes|terraform|ansible|aws|gcp|azure|linux|ubuntu|git|github|gitlab|sqlite|postgres|postgresql|mysql|mongodb|redis|websocket|webgl|three|threejs|opencv|pytorch|tensorflow|numpy|scipy|onnx|llama|ollama|llamacpp|webllm|openai|api|cli|docker|nix|make|cmake|qt|unity|godot|blender|pandas|numpy)$/i;

function parseProjects(lines) {
  const entries = [];
  let current = null;
  let listEntry = null;
  let closed = true;

  const start = (fields) => {
    current = { name: null, url: null, description: '', bullets: [], tech: [], raw: [], ...fields };
    entries.push(current);
    closed = false;
    return current;
  };

  const isSubHeading = (text) =>
    SECTION_ALIASES.some((a) => a.re.test(text)) && text.split(/\s+/).length <= 3;
  const looksLikeHeading = (text) =>
    text.length < 80 && !/[.!?:;,]$/.test(text) && /^[A-Z0-9"'(]/.test(text);

  const addRun = (entry, text) => {
    for (const part of splitOnPipes(text)) {
      const t = part.replace(/[,;]+$/, '').trim();
      if (t) entry.bullets.push(t);
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      listEntry = null;
      closed = true;
      continue;
    }
    const bullet = /^[•*]\s+(.*)$/.exec(line);
    const body = bullet ? bullet[1].trim() : line;

    // "Others: GameEngine (voxel/shaders) - Physics & galaxy sims - VoidScream"
    // is a single labelled run, and it wraps across lines.
    const labelled = /^([A-Z][A-Za-z &]{1,24}):\s+(.+)$/.exec(body);
    if (labelled && /•/.test(labelled[2]) && !PROJECT_URL.test(labelled[2].split('•')[0] || '')) {
      const entry = start({ name: labelled[1].trim(), isRun: true });
      addRun(entry, labelled[2]);
      listEntry = entry;
      entry.raw.push(line);
      continue;
    }

    if (listEntry) {
      addRun(listEntry, body);
      listEntry.raw.push(line);
      continue;
    }

    if (bullet) {
      if (!current || closed) start();
      current.bullets.push(body);
      current.raw.push(line);
      continue;
    }

    const urlOnly =
      current && PROJECT_URL.test(body) && !body.replace(PROJECT_URL, '').replace(/[\s()[\]]/g, '');
    if (urlOnly) {
      if (!current.url) current.url = tidyUrl(body.match(PROJECT_URL)[1]);
      current.raw.push(line);
      continue;
    }

    // A lowercase line continues the previous one. Layout engines break prose at
    // width, so this holds with or without a blank line in between. A line
    // holding a url is never a wrap, even when it opens with a bracket.
    if (current && /^[a-z(]/.test(body) && !PROJECT_URL.test(body)) {
      if (current.bullets.length) {
        current.bullets[current.bullets.length - 1] = joinWrapped(current.bullets[current.bullets.length - 1], body);
      } else {
        current.description = joinWrapped(current.description, body);
      }
      current.raw.push(line);
      continue;
    }

    if (isSubHeading(body)) {
      const entry = start({ name: body, isRun: true });
      listEntry = entry;
      entry.raw.push(line);
      continue;
    }

    const cand = splitProjectHeading(body);
  if (cand.description && PROJECT_URL.test(cand.description)) {
    cand.description = cand.description
      .replace(PROJECT_URL, cand.url ? '' : '$1')
      .replace(/\(\s*\)|\[\s*\]/g, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s*[–—-]\s*$/, '')
      .trim();
    if (!cand.url) cand.url = tidyUrl(body.match(PROJECT_URL)[1]);
  }

    if (
      !current ||
      closed ||
      (cand.url && current.url) ||
      (cand.description && (current.description || current.bullets.length)) ||
      (looksLikeHeading(body) && (current.bullets.length || current.description))
    ) {
      start();
    }

    if (cand.url && !cand.name) {
      current.url = current.url || cand.url;
      if (cand.description) {
        current.description = current.description
          ? `${current.description} ${cand.description}`
          : cand.description;
      }
    } else if (!current.name && cand.name) {
      current.name = cand.name;
      if (cand.url) current.url = cand.url;
      if (cand.description) current.description = cand.description;
    } else if (cand.url && !current.url) {
      current.url = cand.url;
      if (cand.description && !current.description) current.description = cand.description;
    } else if (cand.description && !current.description) {
      current.description = cand.description;
    } else if (body) {
      current.description = joinWrapped(
        current.description || (current.bullets.length ? '' : ''),
        cand.description || body
      );
      if (!current.description && current.bullets.length) {
        current.bullets.pop();
        current.description = cand.description || body;
      }
    }
    current.raw.push(line);
  }

  return entries
    .map((e) => {
      const prose = [e.description, ...(e.bullets || [])].filter(Boolean).join(' ');
      const tokens = prose.match(/[A-Za-z][\w+.#]*(?:\.[A-Za-z][\w+]*)*/g) || [];
      const tech = dedupe(
        tokens
          .map((t) => t.replace(/\.$/, ''))
          .filter((t) => !PROJECT_URL.test(t) && (/[+#.]/.test(t) || PLAIN_TECH.test(t)))
      );
      const { raw, isRun, ...rest } = e;
      return { ...rest, tech, raw: raw.join(' ') };
    })
    .filter((e) => e.name);
}

// -------------------------------------------------------------- education
// "EDUCATION & ADDITIONAL" is one section holding three different label sets,
// and the same physical line can carry all three when the author used bullets
// instead of newlines ("Programming coursework: ... - Languages: ... - CPR & ...").
// A wrap is only a wrap when the previous line stopped on a dangling word
// ("...introductory studies in"); otherwise the next line is a new item.
const DANGLING =
  /[,;:\-–—/(&]\s*$|\b(?:and|or|with|for|in|on|at|of|to|from|by|the|a|an|that|which|via|plus|including|as|is|was|using|into|across|than|then|but)\s*$/i;

const EDU_TYPE_HINTS = [
  [/certif|\bcpr\b|first aid|food handling|food safety|licen[cs]e|permit|welding|driver/i, 'Certifications'],
  [/coursework|program\s*work|cs\s*course/i, 'Programming Coursework'],
  [/\blanguage/i, 'Languages'],
  [/\bvolunteer|\bhonou?rs?\b|\baward/i, 'Honors'],
];

function inferEducationType(text) {
  for (const [re, type] of EDU_TYPE_HINTS) if (re.test(text)) return type;
  return null;
}

function parseEducation(lines) {
  const out = [];
  let open = null;

  const isLabeled = (text) => {
    const m = /^([A-Za-z][A-Za-z /&+]{2,30}?)\s*[:：]\s*(.+)$/.exec(text);
    return m && !looksLikeUrl(m[1]) ? m : null;
  };

  const handle = (line, body, bullet) => {
    const labeled = isLabeled(body);
    if (labeled) {
      open = { type: labeled[1].trim(), detail: labeled[2].trim(), raw: line };
      out.push(open);
      return;
    }
    const dates = parseDates(body);
    if (dates.raw && !bullet) {
      if (open && open.type === 'education' && !open.start && !open.end && open.detail) {
        const school = body
          .replace(dates.raw, '')
          .replace(/[|•·]/g, '')
          .replace(/\s{2,}/g, ' ')
          .trim();
        if (school) open.school = school;
        open.start = dates.start;
        open.end = dates.end;
        open.raw += ` ${line}`;
        return;
      }
      open = { type: 'education', detail: body, start: dates.start, end: dates.end, raw: line };
      out.push(open);
      return;
    }
    if (
      open &&
      !bullet &&
      !dates.raw &&
      (/^[a-z(]/.test(body) || DANGLING.test(open.detail))
    ) {
      open.detail = joinWrapped(open.detail, body);
      open.raw += ` ${line}`;
      return;
    }
    const inferred = !bullet && !dates.raw ? inferEducationType(body) : null;
    open = {
      type: inferred || 'education',
      detail: bullet ? '' : body,
      bullets: bullet ? [body] : [],
      raw: line,
    };
    out.push(open);
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      open = null;
      continue;
    }
    const bullet = /^[•*\-–]\s+(.*)$/.exec(line);
    const body = bullet ? bullet[1].trim() : line;

    // Bulleted runs that carry their own labels are three logical lines.
    const parts = body.split(/\s*•\s*/).map((x) => x.trim()).filter(Boolean);
    if (parts.length > 1) {
      for (const part of parts) handle(part, part, false);
      continue;
    }
    handle(line, body, !!bullet);
  }

  return out.filter((e) => e.detail || (e.bullets && e.bullets.length) || e.type !== 'education');
}

// ------------------------------------------------------------------- api
// "JANE Q. SAMPLE" is how the line was set, not how the person signs it.
function tidyName(raw) {
  const name = String(raw || '').trim().replace(/\s{2,}/g, ' ');
  const letters = name.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return name;
  if (letters !== letters.toUpperCase()) return name;
  return name
    .toLowerCase()
    .replace(/(^|[\s'’-])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase())
    .replace(/\b(md|phd|mba|bsc|ba|bs|ms|ma)\b/g, (m) => m.toUpperCase());
}

export function parseResume(rawText, { paragraphs } = {}) {
  const text = normalize(rawText);
  const sections = splitSections(text, paragraphs);
  const byKey = (key) => sections.filter((s) => s.key === key).flatMap((s) => s.lines);

  const headerLines = sections.filter((s) => s.key === 'header').flatMap((s) => s.lines);
  const contact = parseContact(headerLines);
  const summary = byKey('summary').filter(Boolean).join(' ').trim();

  const skills = parseSkills(byKey('skills'));
  const experience = parseExperience(byKey('experience'));
  const projects = parseProjects(byKey('projects'));
  const education = parseEducation(byKey('education'));
  const awards = byKey('awards').filter(Boolean);

  const skillItems = skills.flatMap((g) => g.items);
  const warnings = [];
  if (!contact.name) warnings.push('no name line found in the header');
  if (!contact.email && !contact.phone) warnings.push('no email or phone found');
  if (!skills.length) warnings.push('no skills section recognised');
  if (!summary) warnings.push('no summary section recognised');

  return {
    name: contact.name,
    contact,
    summary,
    headline: summary ? firstSentence(summary, 160) : null,
    skills,
    skillItems,
    experience,
    projects,
    education,
    awards,
    sections: sections.map((s) => ({ key: s.key, lines: s.lines.filter(Boolean) })),
    stats: {
      chars: text.length,
      sections: sections.filter((s) => s.key !== 'header').length,
      skills: skillItems.length,
      experience: experience.length,
      projects: projects.length,
    },
    warnings,
    text,
  };
}

// GitHub handles named in the resume, which is what makes the cross-check worth
// doing: a project the resume claims and the profile actually contains is
// evidence the resume is telling the truth about itself.
export function resumeRepoClaims(resume) {
  const claims = new Map();
  const add = (url, name, source) => {
    if (!url) return;
    const m = /github\.com\/([\w.-]+)\/([\w.-]+)/i.exec(url);
    if (!m) return;
    const repo = m[2].replace(/\.git$/, '');
    const key = `${m[1]}/${repo}`.toLowerCase();
    if (!claims.has(key)) claims.set(key, { owner: m[1], repo, name: name || repo, sources: [] });
    if (source && !claims.get(key).sources.includes(source)) claims.get(key).sources.push(source);
  };

  for (const p of resume.projects || []) add(p.url, p.name, 'project');
  const blob = [resume.summary, ...(resume.projects || []).map((p) => p.raw), ...(resume.experience || []).map((e) => e.raw)]
    .filter(Boolean)
    .join(' ');
  for (const m of blob.matchAll(/github\.com\/([\w.-]+)\/([\w.-]+)/gi)) add(m[0], m[2], 'mention');
  for (const l of Object.values(resume.contact?.links || {})) add(l, null, 'contact');
  return [...claims.values()];
}

// Flattens a resume into the loose token shape analyze.js already understands,
// so a resume can be scored with the same machinery as a repository.
export function resumeToProfile(resume) {
  const tokens = [
    resume.summary,
    ...(resume.skillItems || []),
    ...(resume.projects || []).map((p) => `${p.name} ${p.description} ${(p.bullets || []).join(' ')}`),
    ...(resume.experience || []).map((e) => `${e.title || ''} ${e.org || ''} ${e.bullets.join(' ')}`),
  ]
    .filter(Boolean)
    .join('\n');

  const languages = {};
  const langNames = ['JavaScript', 'TypeScript', 'Python', 'HTML', 'CSS', 'C', 'C++', 'C#', 'Java', 'Go', 'Rust', 'Ruby', 'PHP', 'Swift', 'Kotlin', 'SQL', 'Shell'];
  for (const [name, hits] of langNames.map((l) => {
    // "C/C++" is C++ with a C for old readers; counting it as C too would make
    // a C++ claim outrank a Python one. Only a standalone C counts as C.
    const re = l === 'C' ? /(?<![\w/+#])C(?![\w/+#])/g : new RegExp(`\\b${l.replace('+', '\\+')}\\b`, 'g');
    return [l, (tokens.match(re) || []).length];
  })) {
    if (hits) languages[name] = hits * 1000;
  }

  return {
    kind: 'resume',
    handle: resume.name || 'resume',
    repos: [],
    name: resume.name || 'resume',
    url: resume.contact?.links?.website || resume.contact?.links?.github || null,
    description: resume.headline,
    languages,
    deps: Object.fromEntries((resume.skillItems || []).map((s) => [s, 'resume'])),
    topics: (resume.skillItems || []).map((s) => s.replace(/\s+/g, '-').toLowerCase()),
    files: (resume.projects || []).map((p) => p.name),
    readme: tokens,
    sources: [tokens],
    fromResume: true,
  };
}
