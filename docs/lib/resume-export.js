// Resume export: one semantic model, many output formats.
//
// Everything downstream of the parser is a "model": a name, a contact line, and
// an ordered list of sections. Each formatter renders that model, so a fix to
// the model changes every format at once and the formats cannot drift apart.
//
// Two families of output, on purpose:
//   - designed formats (pdf, docx, html) for a human reading or printing them
//   - flat formats (txt, json, yaml, md, tex, rtf) that an applicant tracking
//     system, a job board uploader, or a parser can read without guessing
// LaTeX and RTF sit in the second family despite being printable, because they
// are machine-reconstructible and survive copy-paste far better than a PDF.

import { renderPdf, toWinAnsi } from './pdf-write.js';
import { createZip } from './zip.js';

// ---------------------------------------------------------------- the model
// entries: { title, subtitle, when, where, url, bullets, note }
// groups:  { label, items }
// runs:    { label, items }

const span = (start, end, current) => ({
  start: start ? { raw: start.raw || null, iso: start.iso || null } : null,
  end: end ? { raw: end.raw || null, iso: end.iso || null } : end ? null : null,
  current: Boolean(current),
});

const whenText = (start, end, current) => {
  if (!start && !end) return null;
  const a = start?.raw || start?.iso || '';
  const b = current ? 'Present' : end?.raw || end?.iso || '';
  if (a && b) return `${a} - ${b}`;
  return a || b || null;
};

const linkOf = (url) => {
  if (!url) return null;
  const bare = String(url).replace(/^https?:\/\//, '').replace(/\/$/, '');
  return { text: bare, href: /^https?:\/\//i.test(url) ? url : `https://${bare}` };
};

export function buildModel(resume, options = {}) {
  const r = resume || {};
  const contact = r.contact || {};
  const name = options.name || r.name || 'Your Name';

  const contacts = [];
  if (contact.email) contacts.push({ label: 'email', value: contact.email, href: `mailto:${contact.email}` });
  if (contact.phone) contacts.push({ label: 'phone', value: contact.phone, href: null });
  if (contact.location) contacts.push({ label: 'location', value: contact.location, href: null });
  for (const [label, value] of Object.entries(contact.links || {})) {
    if (!value) continue;
    const link = linkOf(value);
    if (link) contacts.push({ label, value: link.text, href: link.href });
  }
  for (const extra of contact.extra || []) {
    if (!extra?.value) continue;
    contacts.push({ label: extra.label || 'link', value: extra.value, href: extra.href || linkOf(extra.value)?.href || null });
  }

  const sections = [];
  const experience = (r.experience || [])
    .map((e) => ({
      title: e.title || '',
      subtitle: e.org || '',
      when: whenText(e.start, e.end, e.current),
      where: e.location && e.location !== contact.location ? e.location : null,
      url: null,
      note: e.kicker || null,
      ...span(e.start, e.end, e.current),
      bullets: (e.bullets || []).filter(Boolean),
    }))
    .filter((e) => e.title || e.subtitle || e.bullets.length);
  if (experience.length) sections.push({ id: 'experience', title: 'Experience', kind: 'entries', entries: experience });

  const projects = (r.projects || [])
    .map((p) => ({
      title: p.name || '',
      subtitle: (p.tech || []).join(', ') || null,
      when: null,
      where: null,
      url: p.url ? linkOf(p.url).href : null,
      note: p.description || null,
      ...span(null, null, false),
      bullets: (p.bullets || []).filter(Boolean),
    }))
    .filter((p) => p.title || p.note);
  if (projects.length) sections.push({ id: 'projects', title: 'Projects', kind: 'entries', entries: projects });

  const education = (r.education || [])
    .map((e) => ({
      title: e.school || e.detail || '',
      subtitle: e.school && e.detail ? e.detail : null,
      when: whenText(e.start, e.end, false),
      where: null,
      url: null,
      note: null,
      ...span(e.start, e.end, false),
      bullets: (e.bullets || []).filter(Boolean),
    }))
    .filter((e) => e.title || e.subtitle);
  if (education.length) sections.push({ id: 'education', title: 'Education & Certifications', kind: 'entries', entries: education });

  const awards = (r.awards || []).filter(Boolean);
  if (awards.length) sections.push({ id: 'awards', title: 'Awards', kind: 'runs', runs: [{ label: '', items: awards }] });

  const skills = (r.skills || [])
    .map((g) => ({ label: g.category || '', items: (g.items || []).filter(Boolean) }))
    .filter((g) => g.items.length);
  if (skills.length) sections.push({ id: 'skills', title: 'Skills', kind: 'groups', groups: skills });

  // Anything the parser found but could not structure is still worth keeping.
  const used = new Set(['summary', 'experience', 'projects', 'education', 'skills', 'awards', 'header', 'languages', 'certifications']);
  for (const section of r.sections || []) {
    if (used.has(section.key) || !section.lines?.length) continue;
    sections.push({
      id: section.key,
      title: section.key.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      kind: 'runs',
      runs: [{ label: '', items: section.lines }],
    });
  }

  const summary = options.summary ?? r.summary ?? null;
  return {
    meta: { name, headline: options.headline ?? (summary ? null : r.headline ?? null), contacts },
    summary,
    sections,
    generatedBy: 'JobWall',
  };
}

// ------------------------------------------------------------------ helpers
const escHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const escLatex = (s) =>
  String(s ?? '')
    .replace(/[\\{}$&#^_~%]/g, (c) => `\\${c}`)
    .replace(/~/g, '\\~{}')
    .replace(/--/g, '\\textendash{}')
    .replace(/—/g, '\\textemdash{}')
    .replace(/[‘’]/g, '`')
    .replace(/[“”]/g, "''");

const escRtf = (s) =>
  String(s ?? '')
    .replace(/[\\{}]/g, (c) => `\\${c}`)
    .replace(/[^\x20-\x7e]/g, (c) => {
      const cp = c.codePointAt(0);
      return cp <= 0xffff ? `\\u${cp}?` : `\\u${cp - 0x10000}?\\u${0xd800 + ((cp - 0x10000) >> 10)}?\\u${0xdc00 + ((cp - 0x10000) & 0x3ff)}?`;
    });

// YAML plain scalars are only unsafe when they start with an indicator, contain
// ": " or " #", or would be read as a different type. Quoting every value makes
// the file unreadable, so the rules are applied properly instead of bluntly.
const yamlScalar = (s) => {
  const text = String(s ?? '');
  if (text === '') return "''";
  const unsafe =
    /^[\-?:,\[\]{}#&*!|>'"%@`]/.test(text) ||
    text !== text.trim() ||
    /: /.test(text) ||
    text.includes(' #') ||
    /:$/.test(text) ||
    text.includes(':') ||
    /^(true|false|null|yes|no|on|off|~)$/i.test(text) ||
    /^[+-]?(\.\d+|\d)/.test(text) ||
    /^0x/.test(text);
  return unsafe ? `'${text.replace(/'/g, "''")}'` : text;
};

const NETWORKS = new Set(['github', 'gitlab', 'linkedin', 'x', 'twitter', 'website', 'mastodon', 'bluesky', 'stackoverflow', 'dribbble', 'behance', 'medium', 'dev']);
const isProfile = (c) => NETWORKS.has(String(c.label).toLowerCase()) && /^https?:/i.test(c.href || '');

const slug = (s) =>
  String(s || 'resume').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'resume';

const contactLine = (model) =>
  model.meta.contacts
    .map((c) => String(c.value || '').trim())
    .filter(Boolean)
    .join('  |  ');

const entryHeadline = (e) => {
  const bits = [];
  if (e.subtitle) bits.push(e.subtitle);
  if (e.where) bits.push(e.where);
  const head = bits.join(' · ');
  return { left: head, right: e.when || '' };
};

// -------------------------------------------------------------------- plain
function toText(model) {
  const out = [];
  out.push(model.meta.name.toUpperCase());
  if (model.meta.headline) out.push(model.meta.headline);
  if (model.meta.contacts.length) out.push(contactLine(model));
  out.push('');
  if (model.summary) out.push(model.summary, '');
  for (const section of model.sections) {
    out.push(section.title.toUpperCase());
    out.push('-'.repeat(Math.min(section.title.length, 60)));
    if (section.kind === 'entries') {
      for (const e of section.entries) {
        const { left, right } = entryHeadline(e);
        out.push([e.title, left].filter(Boolean).join(e.title && left ? ', ' : ' '));
        if (right) out.push(right);
        if (e.url) out.push(e.url);
        if (e.note) out.push(e.note);
        for (const b of e.bullets) out.push(`  - ${b}`);
        out.push('');
      }
    } else if (section.kind === 'groups') {
      for (const g of section.groups) out.push(g.label ? `${g.label}: ${g.items.join(', ')}` : g.items.join(', '));
      out.push('');
    } else {
      for (const run of section.runs) out.push(run.label ? `${run.label}: ${run.items.join(', ')}` : run.items.join('\n'));
      out.push('');
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// -------------------------------------------------------------------- html
const STYLE = (accent, ats) => `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0;
    font: 10.5pt/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif;
    color: #14161a; background: ${ats ? '#fff' : '#fff'};
  }
  .page { max-width: 46rem; margin: 0 auto; padding: 2.6rem 2.4rem 3rem; }
  header { border-bottom: 2px solid ${accent}; padding-bottom: .85rem; margin-bottom: 1.1rem; }
  h1 { font-size: 1.7rem; letter-spacing: -.02em; margin: 0 0 .2rem; font-weight: 650; }
  .headline { color: #454b55; margin: 0 0 .5rem; font-size: .95rem; }
  .contact { color: #454b55; font-size: .87rem; word-spacing: .1em; }
  .contact a { color: inherit; }
  h2 {
    font-size: .78rem; letter-spacing: .14em; text-transform: uppercase; color: ${accent};
    margin: 1.5rem 0 .55rem; padding-bottom: .25rem; border-bottom: 1px solid #e3e6ea;
  }
  .entry { margin: 0 0 .95rem; break-inside: avoid; }
  .entry-head { display: ${ats ? 'block' : 'flex'}; ${ats ? '' : 'justify-content: space-between; align-items: baseline; gap: 1rem;'} }
  .entry-title { font-weight: 640; }
  .entry-sub { color: #454b55; }
  .entry-when { color: #6b7280; font-size: .85rem; white-space: nowrap; ${ats ? '' : 'text-align: right;'} }
  .entry-note { color: #454b55; margin: .2rem 0 .3rem; }
  ul { margin: .3rem 0 0; padding-left: 1.15rem; }
  li { margin: .12rem 0; }
  a { color: #14509b; text-decoration: none; }
  .skills { margin: 0; }
  .skill-group { margin: 0 0 .5rem; break-inside: avoid; }
  .skill-label { font-weight: 640; }
  .skill-label::after { content: ":"; font-weight: 400; }
  .runs p { margin: .2rem 0; }
  @page { size: ${ats ? 'letter' : 'auto'}; margin: 14mm 15mm; }
  @media print { body { background: #fff; } .page { padding: 0; max-width: none; } h2 { break-after: avoid; } }
`;

function toHtml(model, { accent = '#1f6feb', ats = false } = {}) {
  const parts = [];
  parts.push('<header>');
  parts.push(`<h1>${escHtml(model.meta.name)}</h1>`);
  if (model.meta.headline) parts.push(`<p class="headline">${escHtml(model.meta.headline)}</p>`);
  if (model.meta.contacts.length) {
    const links = model.meta.contacts
      .map((c) => (c.href ? `<a href="${escHtml(c.href)}">${escHtml(c.value)}</a>` : escHtml(c.value)))
      .join(' &nbsp;·&nbsp; ');
    parts.push(`<p class="contact">${links}</p>`);
  }
  parts.push('</header>');

  if (model.summary) parts.push(`<h2>Summary</h2><p>${escHtml(model.summary)}</p>`);

  for (const section of model.sections) {
    parts.push(`<h2>${escHtml(section.title)}</h2>`);
    if (section.kind === 'entries') {
      for (const e of section.entries) {
        const { left, right } = entryHeadline(e);
        parts.push('<div class="entry">');
        parts.push('<div class="entry-head">');
        parts.push(
          `<div><span class="entry-title">${escHtml(e.title)}</span>${left ? ` <span class="entry-sub">${escHtml(left)}</span>` : ''}</div>`
        );
        parts.push(`<div class="entry-when">${escHtml(right)}</div>`);
        parts.push('</div>');
        if (e.url) parts.push(`<div><a href="${escHtml(e.url)}">${escHtml(e.url.replace(/^https?:\/\//, ''))}</a></div>`);
        if (e.note) parts.push(`<p class="entry-note">${escHtml(e.note)}</p>`);
        if (e.bullets.length) parts.push(`<ul>${e.bullets.map((b) => `<li>${escHtml(b)}</li>`).join('')}</ul>`);
        parts.push('</div>');
      }
    } else if (section.kind === 'groups') {
      parts.push('<div class="skills">');
      for (const g of section.groups) {
        parts.push(
          `<div class="skill-group">${g.label ? `<span class="skill-label">${escHtml(g.label)}</span> ` : ''}${escHtml(g.items.join(', '))}</div>`
        );
      }
      parts.push('</div>');
    } else {
      parts.push('<div class="runs">');
      for (const run of section.runs) {
        parts.push(run.label ? `<p><b>${escHtml(run.label)}:</b> ${escHtml(run.items.join(', '))}</p>` : run.items.map((i) => `<p>${escHtml(i)}</p>`).join(''));
      }
      parts.push('</div>');
    }
  }

  const title = `${model.meta.name} — Resume`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title>
<style>${STYLE(accent, ats)}</style>
</head>
<body>
<main class="page">
${parts.join('\n')}
</main>
</body>
</html>
`;
}

// ---------------------------------------------------------------- markdown
function toMarkdown(model) {
  const out = [`# ${model.meta.name}`, ''];
  if (model.meta.headline) out.push(`*${model.meta.headline}*`, '');
  if (model.meta.contacts.length) {
    out.push(model.meta.contacts.map((c) => (c.href ? `[${c.value}](${c.href})` : c.value)).join(' · '), '');
  }
  if (model.summary) out.push('## Summary', '', model.summary, '');
  for (const section of model.sections) {
    out.push(`## ${section.title}`, '');
    if (section.kind === 'entries') {
      for (const e of section.entries) {
        const { left, right } = entryHeadline(e);
        out.push(`### ${e.title}${left ? ` — ${left}` : ''}${right ? ` _(${right})_` : ''}`, '');
        if (e.url) out.push(`<${e.url}>`, '');
        if (e.note) out.push(e.note, '');
        for (const b of e.bullets) out.push(`- ${b}`);
        out.push('');
      }
    } else if (section.kind === 'groups') {
      for (const g of section.groups) out.push(`- **${g.label || 'Skills'}:** ${g.items.join(', ')}`);
      out.push('');
    } else {
      for (const run of section.runs) out.push(run.label ? `- **${run.label}:** ${run.items.join(', ')}` : run.items.map((i) => `- ${i}`).join('\n'));
      out.push('');
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// -------------------------------------------------------------------- rtf
function toRtf(model) {
  const body = [];
  const para = (text, { bold = false, size = 22, color = null, space = 0 } = {}) => {
    const props = [`\\fs${size}`, bold ? '\\b' : '\\i0', `\\sa${space}`];
    if (color) props.push(`\\cf${color}`);
    body.push(`{\\pard ${props.join(' ')} ${escRtf(text)}\\par}`);
  };
  const colorTable = '{\\colortbl;\\cf1\\red20\\green22\\blue26;\\cf2\\red69\\green75\\blue85;\\cf3\\red31\\green111\\blue235;}';

  para(model.meta.name, { bold: true, size: 34, space: 40 });
  if (model.meta.headline) para(model.meta.headline, { size: 21, color: 2, space: 30 });
  if (model.meta.contacts.length) para(contactLine(model), { size: 19, color: 2, space: 140 });

  if (model.summary) {
    para('SUMMARY', { bold: true, size: 19, color: 3, space: 20 });
    para(model.summary, { size: 21 });
  }
  for (const section of model.sections) {
    para(section.title.toUpperCase(), { bold: true, size: 19, color: 3, space: 20 });
    if (section.kind === 'entries') {
      for (const e of section.entries) {
        const { left, right } = entryHeadline(e);
        // Two spaces after the last control word: RTF eats a single space there
        // as a delimiter. The sub run also has to clear bold explicitly or it
        // inherits it from the title run.
        body.push(`{\\pard\\fs22\\b ${escRtf(e.title)}${left ? `{\\i0\\b0\\cf2\\fs20  ${escRtf(left)}}` : ''}\\par}`);
        if (right) para(right, { size: 19, color: 2 });
        if (e.url) para(e.url, { size: 19, color: 2 });
        if (e.note) para(e.note, { size: 21 });
        for (const b of e.bullets) para(`\u2022  ${b}`, { size: 21, space: 20 });
        body.push('{\\pard\\fs6\\par}');
      }
    } else if (section.kind === 'groups') {
      for (const g of section.groups) {
        body.push(`{\\pard\\fs21\\b ${escRtf(g.label ? g.label + ':' : '')}\\b0  ${escRtf(g.items.join(', '))}\\par}`);
      }
    } else {
      for (const run of section.runs) para(run.label ? `${run.label}: ${run.items.join(', ')}` : run.items.join('  '), { size: 21 });
    }
  }

  return `{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fswiss Helvetica;}}\\margl1080\\margr1080\\margt1080\\margb1080${colorTable}
${body.join('\n')}
}`;
}

// "Seattle, WA" is a city and a region code; anything else stays whole.
function locationParts(text) {
  if (!text) return null;
  const split = /^(.+?),\s*([A-Z]{2}|[A-Z][a-z]+)?$/.exec(text.trim());
  if (split) {
    const out = { city: split[1].trim() };
    if (split[2]) out.region = split[2].trim();
    return out;
  }
  return { city: text.trim() };
}

// "https://github.com/BoogerCheeseOnRye" -> "BoogerCheeseOnRye"
const handleFrom = (url) => {
  // Query and fragment first: stripping the scheme first would leave a "/" that
  // the path-stripping step then mistakes for the start of the query.
  const path = String(url || '')
    .replace(/[?#].*$/, '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '');
  const segments = path.split('/').filter(Boolean);
  return (segments.length > 1 ? segments.at(-1) : segments[0] || path).replace(/^@/, '');
};

// -------------------------------------------------------------------- json
// JSON Resume (https://jsonresume.org) is the one structured format that a
// dozen job boards already accept, so it is worth emitting properly.
function toJsonResume(model) {
  const find = (id) => model.sections.find((s) => s.id === id);
  const contactOf = (label) => model.meta.contacts.find((c) => c.label === label)?.value || null;

  const basics = {
    name: model.meta.name,
    label: model.meta.headline || null,
    email: contactOf('email'),
    phone: contactOf('phone'),
    url: contactOf('website') || contactOf('github') || null,
    location: locationParts(contactOf('location')),
    profiles: model.meta.contacts
      .filter(isProfile)
      .map((c) => ({ network: c.label, url: c.href, username: handleFrom(c.href) })),
    summary: model.summary || null,
  };

  const experience = (find('experience')?.entries || []).map((e) => ({
    name: e.subtitle || null,
    position: e.title,
    url: e.url || null,
    startDate: e.start?.iso || null,
    endDate: e.end?.iso || (e.current ? null : e.end?.raw || null),
    summary: e.note || null,
    highlights: e.bullets,
    location: e.where || null,
  }));

  const projectsOut = (find('projects')?.entries || []).map((p) => ({
    name: p.title,
    description: p.note || null,
    highlights: p.bullets,
    keywords: p.subtitle ? p.subtitle.split(',').map((k) => k.trim()) : [],
    url: p.url || null,
  }));

  const educationOut = (find('education')?.entries || []).map((e) => ({
    institution: e.title,
    url: e.url || null,
    studyType: e.subtitle || null,
    startDate: e.start?.iso || null,
    endDate: e.end?.iso || null,
    summary: e.note || null,
  }));

  const skillsOut = (find('skills')?.groups || []).map((g) => ({ name: g.label || 'Skills', keywords: g.items }));

  return JSON.stringify({ $schema: 'https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json', basics, work: experience, projects: projectsOut, education: educationOut, skills: skillsOut, languages: [], references: [], interests: [], projects_others: [], awards: [] }, null, 2) + '\n';
}

// -------------------------------------------------------------------- yaml
function toYaml(model) {
  const out = [];
  const key = (s) => (/^[\w][\w .'-]*$/.test(s) ? s : `'${s.replace(/'/g, "''")}'`);
  const find = (id) => model.sections.find((s) => s.id === id);
  const contactOf = (label) => model.meta.contacts.find((c) => c.label === label)?.value || null;

  out.push(`# Generated by ${model.generatedBy}`);
  out.push('basics:');
  out.push(`  name: ${yamlScalar(model.meta.name)}`);
  if (model.meta.headline) out.push(`  label: ${yamlScalar(model.meta.headline)}`);
  if (contactOf('email')) out.push(`  email: ${yamlScalar(contactOf('email'))}`);
  if (contactOf('phone')) out.push(`  phone: ${yamlScalar(contactOf('phone'))}`);
  if (contactOf('location')) out.push(`  location: ${yamlScalar(contactOf('location'))}`);
  if (model.meta.contacts.some(isProfile)) {
    out.push('  profiles:');
    for (const c of model.meta.contacts.filter(isProfile)) {
      out.push(`    - network: ${yamlScalar(c.label)}`);
      out.push(`      url: ${yamlScalar(c.href)}`);
    }
  }
  if (model.summary) out.push(`  summary: ${yamlScalar(model.summary)}`);

  // One mapping per entry with nested sequences: putting two keys on one line,
  // or a sequence under a mapping key at the same level, is not valid YAML.
  const emitEntries = (id, field, shape) => {
    const section = find(id);
    if (!section) return;
    out.push(`${field}:`);
    for (const e of section.entries) {
      const pairs = shape(e).filter(Boolean);
      pairs.forEach(([k, v], i) => out.push(`  ${i === 0 ? '- ' : '  '}${k}: ${v}`));
      const extras = [];
      if (e.where) extras.push(['location', yamlScalar(e.where)]);
      if (e.url) extras.push(['url', yamlScalar(e.url)]);
      if (e.note) extras.push(['summary', yamlScalar(e.note)]);
      for (const [k, v] of extras) out.push(`    ${k}: ${v}`);
      if (e.bullets.length) {
        out.push('    highlights:');
        for (const b of e.bullets) out.push(`      - ${yamlScalar(b)}`);
      }
    }
  };
  emitEntries('experience', 'work', (e) => [
    ['position', yamlScalar(e.title)],
    ['name', yamlScalar(e.subtitle)],
    ['startDate', e.start?.iso ? yamlScalar(e.start.iso) : null],
    ['endDate', e.end?.iso ? yamlScalar(e.end.iso) : e.current ? "'Present'" : null],
  ]);
  emitEntries('projects', 'projects', (e) => [
    ['name', yamlScalar(e.title)],
    ['keywords', e.subtitle ? `[${e.subtitle.split(',').map((k) => yamlScalar(k.trim())).join(', ')}]` : null],
  ]);
  emitEntries('education', 'education', (e) => [
    ['institution', yamlScalar(e.title)],
    ['studyType', e.subtitle ? yamlScalar(e.subtitle) : null],
    ['endDate', e.end?.iso ? yamlScalar(e.end.iso) : null],
  ]);

  const skillsSection = find('skills');
  if (skillsSection) {
    out.push('skills:');
    for (const g of skillsSection.groups) {
      out.push(`  - name: ${yamlScalar(g.label || 'Skills')}`);
      out.push(`    keywords: [${g.items.map(yamlScalar).join(', ')}]`);
    }
  }
  for (const section of model.sections) {
    if (['experience', 'projects', 'education', 'skills'].includes(section.id)) continue;
    out.push(`${key(section.title.toLowerCase().replace(/\W+/g, '_'))}:`);
    if (section.kind === 'entries') {
      for (const e of section.entries) out.push(`  - ${yamlScalar([e.title, e.subtitle, e.when].filter(Boolean).join(', '))}`);
    } else {
      for (const run of section.runs) for (const item of run.items) out.push(`  - ${yamlScalar(item)}`);
    }
  }
  return out.join('\n') + '\n';
}

// ------------------------------------------------------------------- latex
function toLatex(model) {
  const find = (id) => model.sections.find((s) => s.id === id);
  const contactOf = (label) => model.meta.contacts.find((c) => c.label === label)?.value || null;
  const out = [];
  out.push('% Generated by ' + model.generatedBy);
  out.push('\\documentclass[11pt,a4paper]{article}');
  out.push('\\usepackage[margin=0.75in]{geometry}');
  out.push('\\usepackage{enumitem}');
  out.push('\\usepackage{titlesec}');
  out.push('\\usepackage{hyperref}');
  out.push('\\usepackage{xcolor}');
  out.push('\\pagestyle{empty}');
  out.push('\\setlength{\\parindent}{0pt}');
  out.push('\\setlist[itemize]{leftmargin=1.2em,itemsep=1pt,topsep=2pt}');
  out.push('\\titleformat{\\section}{\\large\\bfseries\\color{blue!50!black}}{}{0pt}{}');
  out.push('\\newcommand{\\entry}[4]{\\vspace{4pt}{\\bfseries #1}\\\\ {\\small #2}\\hfill {\\small #3}\\\\ #4\\vspace{2pt}}');
  out.push('\\begin{document}');
  out.push('{\\LARGE\\bfseries ' + escLatex(model.meta.name) + '} \\\\');
  if (model.meta.headline) out.push('{\\small ' + escLatex(model.meta.headline) + '} \\\\');
  if (model.meta.contacts.length) {
    out.push('{\\footnotesize ' + model.meta.contacts.map((c) => escLatex(c.value)).join(' $\\vert$ ') + '} \\\\');
  }
  out.push('\\vspace{6pt}\\hrule\\vspace{8pt}');
  if (model.summary) {
    out.push('\\section*{Summary}');
    out.push(escLatex(model.summary));
  }
  const section = (title, id) => {
    const s = find(id);
    if (!s) return;
    out.push('\\section*{' + escLatex(title) + '}');
    if (s.kind === 'entries') {
      for (const e of s.entries) {
        const left = [e.subtitle, e.where].filter(Boolean).join(' $\\cdot$ ');
        const bits = [];
        if (e.url) bits.push('\\href{' + e.url + '}{' + escLatex(e.url.replace(/^https?:\/\//, '')) + '}');
        if (e.note) bits.push(escLatex(e.note));
        if (e.bullets.length) {
          out.push('\\entry{' + escLatex(e.title) + '}{' + escLatex(left) + '}{' + escLatex(e.when || '') + '}{' + bits.join(' ') + '}');
          out.push('\\begin{itemize}');
          for (const b of e.bullets) out.push('  \\item ' + escLatex(b));
          out.push('\\end{itemize}');
        } else {
          out.push('\\entry{' + escLatex(e.title) + '}{' + escLatex(left) + '}{' + escLatex(e.when || '') + '}{' + bits.join(' ') + '}');
        }
      }
    } else if (s.kind === 'groups') {
      for (const g of s.groups) {
        out.push('\\textbf{' + escLatex(g.label ? g.label + ':' : '') + '} ' + g.items.map(escLatex).join(', '));
      }
    } else {
      for (const run of s.runs) for (const item of run.items) out.push(escLatex(item) + ' \\\\');
    }
  };
  for (const s of model.sections) section(s.title, s.id);
  out.push('\\end{document}');
  return out.join('\n') + '\n';
}

// -------------------------------------------------------------------- docx
const docxEscape = (s) =>
  String(s ?? '')
    // WordprocessingML cannot carry control characters, and a stray one makes
    // Word refuse the whole document.
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[‘’]/g, '&#8217;')
    .replace(/[^\x20-\uffff]/g, '');

const w = (text, { bold = false, size = 22, color = null, after = 0, italic = false } = {}) =>
  `<w:p><w:pPr><w:spacing w:after="${after}"/></w:pPr><w:r><w:rPr>${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}<w:sz w:val="${size}"/>${color ? `<w:color w:val="${color}"/>` : ''}</w:rPr><w:t xml:space="preserve">${docxEscape(text)}</w:t></w:r></w:p>`;

const hyperlinkRels = [];

// Registering the relationship and emitting the markup happen together on
// purpose. Splitting them let the two drift apart, and a link with an r:id that
// is not in document.xml.rels is a link Word silently drops -- it still renders
// the text, so the damage only shows up when somebody clicks it.
const wHyperlink = (url, text, { size = 20 } = {}) => {
  const id = `rId${hyperlinkRels.length + 1}`;
  hyperlinkRels.push({ id, url });
  return `<w:hyperlink r:id="${id}"><w:r><w:rPr><w:color w:val="14509B"/><w:u w:val="single"/><w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${docxEscape(text)}</w:t></w:r></w:hyperlink>`;
};

async function toDocx(model) {
  hyperlinkRels.length = 0;
  const body = [];
  body.push(w(model.meta.name, { bold: true, size: 40, after: 40 }));
  if (model.meta.headline) body.push(w(model.meta.headline, { size: 22, color: '454B55', after: 40 }));
  for (const c of model.meta.contacts) {
    if (c.href && /^https?:/i.test(c.href)) body.push(`<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${wHyperlink(c.href, c.value)}</w:p>`);
    else body.push(w(c.value, { size: 20, color: '454B55', after: 0 }));
  }
  body.push(w('', { size: 12, after: 200 }));

  if (model.summary) {
    body.push(w('SUMMARY', { bold: true, size: 20, color: '1F6FEB', after: 40 }));
    body.push(w(model.summary, { size: 22, after: 160 }));
  }
  for (const section of model.sections) {
    body.push(w(section.title.toUpperCase(), { bold: true, size: 20, color: '1F6FEB', after: 40 }));
    if (section.kind === 'entries') {
      for (const e of section.entries) {
        const { left, right } = entryHeadline(e);
        body.push(w(`${e.title}${left ? `  ·  ${left}` : ''}`, { bold: true, size: 22, after: 0 }));
        if (right) body.push(w(right, { size: 19, color: '6B7280', after: e.note || e.url || e.bullets.length ? 20 : 140 }));
        if (e.url) {
          body.push(`<w:p><w:pPr><w:spacing w:after="20"/></w:pPr>${wHyperlink(e.url, e.url.replace(/^https?:\/\//, ''))}</w:p>`);
        }
        if (e.note) body.push(w(e.note, { size: 21, color: '454B55', after: 20 }));
        for (const b of e.bullets) body.push(w(`•  ${b}`, { size: 21, after: 20 }));
        body.push(w('', { size: 10, after: 60 }));
      }
    } else if (section.kind === 'groups') {
      for (const g of section.groups) {
        body.push(`<w:p><w:pPr><w:spacing w:after="20"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="21"/></w:rPr><w:t xml:space="preserve">${docxEscape(g.label ? `${g.label}: ` : '')}</w:t></w:r><w:r><w:rPr><w:sz w:val="21"/></w:rPr><w:t xml:space="preserve">${docxEscape(g.items.join(', '))}</w:t></w:r></w:p>`);
      }
    } else {
      for (const run of section.runs) {
        body.push(w(run.label ? `${run.label}: ${run.items.join(', ')}` : run.items.join('  '), { size: 21, after: 20 }));
      }
    }
  }

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080"/></w:sectPr></w:body></w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hyperlinkRels
    .map((h) => `<Relationship Id="${h.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${docxEscape(h.url)}" TargetMode="External"/>`)
    .join('')}</Relationships>`;

  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${docxEscape(model.meta.name)} Resume</dc:title><dc:creator>${docxEscape(model.meta.name)}</dc:creator></cp:coreProperties>`;

  return createZip([
    { name: '[Content_Types].xml', data: contentTypes, store: true },
    { name: '_rels/.rels', data: rels, store: true },
    { name: 'docProps/core.xml', data: core },
    { name: 'word/document.xml', data: document },
    { name: 'word/_rels/document.xml.rels', data: docRels, store: true },
  ]);
}

// --------------------------------------------------------------------- pdf
function modelToBlocks(model, options = {}) {
  const accent = options.accent === 'black' ? '000000' : null;
  const blocks = [
    { text: model.meta.name, font: 'bold', size: 19, rule: accent === null },
    { text: contactLine(model), size: 9.5, gap: 2 },
  ];
  if (model.meta.headline) blocks.push({ text: model.meta.headline, size: 10.5, gap: 4 });

  if (model.summary) {
    blocks.push({ text: 'Summary', font: 'bold', size: 11, gap: 10 });
    blocks.push({ text: model.summary, gap: 3 });
  }
  for (const section of model.sections) {
    blocks.push({ text: section.title, font: 'bold', size: 11, gap: 11, rule: true });
    if (section.kind === 'entries') {
      for (const e of section.entries) {
        const { left, right } = entryHeadline(e);
        blocks.push({ text: `${e.title}${left ? `  ·  ${left}` : ''}${right ? `   (${right})` : ''}`, font: 'bold', size: 10.5, gap: 5 });
        if (e.url) blocks.push({ text: e.url.replace(/^https?:\/\//, ''), size: 9.5, link: e.url, indent: 10 });
        if (e.note) blocks.push({ text: e.note, size: 10, indent: 10, gap: 2 });
        for (const b of e.bullets) blocks.push({ text: b, bullet: true, indent: 10, gap: 1 });
      }
    } else if (section.kind === 'groups') {
      for (const g of section.groups) {
        blocks.push({ text: `${g.label ? `${g.label}: ` : ''}${g.items.join(', ')}`, size: 10, gap: 3 });
      }
    } else {
      for (const run of section.runs) {
        for (const item of run.items) blocks.push({ text: run.label ? `${run.label}: ${item}` : item, size: 10, gap: 2 });
      }
    }
  }
  return blocks;
}

// ------------------------------------------------------------------ formats
export const FORMATS = [
  { id: 'pdf', label: 'PDF', ext: 'pdf', mime: 'application/pdf', group: 'ready to send', blurb: 'One column, Helvetica, real page breaks and clickable links.' },
  { id: 'docx', label: 'Word (.docx)', ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', group: 'ready to send', blurb: 'A real Office file with working hyperlinks.' },
  { id: 'html', label: 'Styled HTML', ext: 'html', textual: true, mime: 'text/html', group: 'ready to send', blurb: 'Self-contained and print-ready — open it and hit print.' },
  { id: 'txt', label: 'Plain text', ext: 'txt', textual: true, mime: 'text/plain', group: 'ATS-safe', blurb: 'The format an applicant tracking system is least likely to mangle.' },
  { id: 'html-ats', label: 'ATS HTML', ext: 'ats.html', textual: true, mime: 'text/html', group: 'ATS-safe', blurb: 'Same content, flattened to a single column with no layout tricks.' },
  { id: 'md', label: 'Markdown', ext: 'md', textual: true, mime: 'text/markdown', group: 'ATS-safe', blurb: 'For job boards that want text, and for your own notes.' },
  { id: 'rtf', label: 'RTF', ext: 'rtf', textual: true, mime: 'application/rtf', group: 'ATS-safe', blurb: 'The old fallback that Word and every tracker still open.' },
  { id: 'json', label: 'JSON Resume', ext: 'json', textual: true, mime: 'application/json', group: 'structured', blurb: 'jsonresume.org schema, for importers that read fields instead of pixels.' },
  { id: 'yaml', label: 'YAML', ext: 'yaml', textual: true, mime: 'text/yaml', group: 'structured', blurb: 'The same data for pipelines and config-driven tools.' },
  { id: 'tex', label: 'LaTeX', ext: 'tex', textual: true, mime: 'application/x-tex', group: 'structured', blurb: 'Compiles to a clean two-page PDF with pdflatex.' },
];

const text = (model, options) => {
  switch (options.format) {
    case 'txt': return toText(model);
    case 'md': return toMarkdown(model);
    case 'rtf': return toRtf(model);
    case 'json': return toJsonResume(model);
    case 'yaml': return toYaml(model);
    case 'tex': return toLatex(model);
    case 'html': return toHtml(model, { ...options, ats: false });
    case 'html-ats': return toHtml(model, { ...options, ats: true });
    default: throw new Error(`unknown format: ${options.format}`);
  }
};

// resume | model -> { filename, mime, ext, format, data, text? }
export async function exportResume(input, format, options = {}) {
  const spec = FORMATS.find((f) => f.id === format);
  if (!spec) throw new Error(`unknown format: ${format}`);
  const model = input?.meta?.name ? input : buildModel(input, options);
  const base = slug(model.meta.name);
  const opts = { ...options, format };

  if (format === 'pdf') {
    const data = renderPdf(modelToBlocks(model, opts), { pageSize: options.pageSize || 'letter', size: options.size || 10.5 });
    return { format, filename: `${base}.${spec.ext}`, mime: spec.mime, data };
  }
  if (format === 'docx') {
    const data = await toDocx(model);
    return { format, filename: `${base}.${spec.ext}`, mime: spec.mime, data };
  }
  const body = text(model, opts);
  return {
    format,
    filename: `${base}.${spec.ext}`,
    mime: spec.mime,
    data: new TextEncoder().encode(body),
    text: body,
  };
}

export const asText = toText;
export const modelToPdfBlocks = modelToBlocks;
export { toWinAnsi };
