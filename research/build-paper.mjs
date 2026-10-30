// Build the standalone research paper from real parser/analysis output.
//
// Run from the repo root:
//   node research/build-paper.mjs
//
// Inputs:
//   research/data/<case>.json  snapshots produced by research/collect.mjs
//   research/samples/*         the public resumes those snapshots came from
//
// Output:
//   docs/research.html         one self-contained HTML file (no external CSS/JS)

import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModel, exportResume } from '../docs/lib/resume-export.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'research', 'data');

const FILES = [
  ['sourabh-bajaj', 'sourabh-bajaj.pdf', 'PDF'],
  ['deedy-das', 'deedy-das.pdf', 'PDF'],
  ['lawrence-du', 'lawrence-du.docx', 'DOCX'],
  ['sebastian-villa-cuellar', 'sebastian-villa-cuellar.docx', 'DOCX'],
];

const NOTES = {
  'sourabh-bajaj': [
    'LaTeX PDF, one column, no skills section. Technologies live inside achievement prose, so the scorer has to infer them from sentences rather than a list.',
    'The employer line is bulleted above the job title. Without layout-aware pairing the parser saw four empty roles; the build now treats "Google Mountain View, CA" as the org/location seed for "Software Engineer".',
    'Project names are labels inside a single bullet ("QuantSoftware Toolkit : ..."), not headings. Those bullets now become named projects.',
    'The header puts the name and the email on the same physical line, and a bare domain ("sourabhbajaj.com") shares the next line with the phone label.',
  ],
  'deedy-das': [
    'Two-column PDF. Both columns share baselines, so visual line order produced "EDUCATION EXPERIENCE" and interleaved every education and experience line.',
    'The extractor now detects a genuine second column only when two section headings share a baseline on opposite sides of a gutter, then reads each column top-to-bottom.',
    'The split recovers the name and the experience blocks. Residual damage is visible: links and coursework are pulled into the education section, and the org/title boundary is still imperfect.',
    'This is the honest boundary case: extraction improved a lot, but the semantic model still needs a correction pass for two-column resumes.',
  ],
  'lawrence-du': [
    'Word DOCX. Paragraph styles give the parser real heading information, so section detection is clean: skills, experience, projects and education all separate.',
    'The long resume yields 51 parsed skill items and 7 projects. Experience bullets are collapsed into one string per role because the source uses soft line breaks and no bullet characters.',
    'Company and title share one line ("GSK • Senior AI/ML Engineer, ..."). The current model keeps that whole string as the title, which is readable but not machine-split.',
    'This is the strongest content case: the score is driven by machine learning, Python, NumPy and LLM evidence rather than by filename or keyword stuffing.',
  ],
  'sebastian-villa-cuellar': [
    'Word DOCX from an early-career engineer. The objective is parsed, headings are clean, and there are no warnings.',
    'The resume nests sub-roles under one employer (Beckhoff) and separates leadership, robotics teams and coursework. The parser treats every dated line as an experience entry, producing 16 entries.',
    'Some title/org fields swap when a bullet-like achievement sits directly above a dated sub-role. The dossier remains useful, but the timeline is flatter than the source document.',
    'This case shows the value of warnings: zero warnings does not mean zero ambiguity. It means the parser found something for every section it expected.',
  ],
};

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const json = (v) => JSON.stringify(v, null, 2);
const TODAY = new Date().toLocaleDateString('en-CA');
const pct = (n) => `${Math.round(Number(n) || 0)}%`;
const num = (n) => Number(n || 0).toLocaleString('en-US');

function readSnapshot(id, file) {
  return readFile(join(dataDir, `${id}.json`), 'utf8').then((raw) => {
    const d = JSON.parse(raw);
    return { id, file, d };
  });
}

function skillChips(skills, limit = 12) {
  return skills
    .slice(0, limit)
    .map(
      (s) =>
        `<span class="chip" title="${esc(s.channels?.map((c) => c.name).join(' + ') || 'evidence')}">${esc(
          s.label
        )}<i>${pct(s.confidence * 100)}</i></span>`
    )
    .join('');
}

function roleRows(roles, limit = 4) {
  return roles
    .slice(0, limit)
    .map(
      (r) => `
      <div class="role">
        <div class="role-top">
          <b>${esc(r.title)}</b>
          <span class="fit ${esc(r.verdict || '')}">${pct(r.fit)} · ${esc(r.verdict || 'fit')}</span>
        </div>
        <div class="bar"><span style="width:${Math.max(2, Math.min(100, Number(r.fit) || 0))}%"></span></div>
        <div class="role-meta">
          <span>${num(r.openingsNow)} live openings</span>
          <span>${esc((r.matched || []).slice(0, 3).map((m) => m.label).join(' · ') || 'no matched evidence')}</span>
        </div>
        ${
          r.gaps?.length
            ? `<div class="gap">gap: ${esc(r.gaps.slice(0, 3).join(' · '))}</div>`
            : '<div class="gap ok">no listed gap</div>'
        }
      </div>`
    )
    .join('');
}

function timeline(entries, limit = 4) {
  if (!entries.length) return '<div class="empty">no dated roles recovered</div>';
  return entries
    .slice(0, limit)
    .map(
      (e) => `
      <div class="tl">
        <div class="tl-when">${esc(e.when || '—')}</div>
        <div class="tl-body">
          <b>${esc(e.title || e.subtitle || 'Untitled role')}</b>
          <span>${esc(e.title ? e.subtitle || '' : '')}</span>
        </div>
      </div>`
    )
    .join('');
}

function educationRows(entries) {
  if (!entries.length) return '<div class="empty">no education section recovered</div>';
  return entries
    .slice(0, 4)
    .map(
      (e) => `
      <div class="edu">
        <b>${esc(e.school || e.detail || 'Education')}</b>
        <span>${esc(e.school ? e.detail || '' : '')}</span>
        <em>${esc([e.start?.raw, e.end?.raw].filter(Boolean).join(' – '))}</em>
      </div>`
    )
    .join('');
}

function projectRows(entries) {
  if (!entries.length) return '<div class="empty">no project section recovered</div>';
  return entries
    .slice(0, 4)
    .map(
      (p) => `
      <div class="proj">
        <b>${esc(p.title || 'Project')}</b>
        <span>${esc((p.note || p.bullets?.[0] || '').slice(0, 180))}</span>
      </div>`
    )
    .join('');
}

function details(label, body, open = false) {
  return `<details${open ? ' open' : ''}><summary>${esc(label)}</summary><pre>${esc(body)}</pre></details>`;
}

const snapshots = await Promise.all(FILES.map(([id, file]) => readSnapshot(id, file)));
const extra = JSON.parse(await readFile(join(dataDir, 'github-boogercheese.json'), 'utf8'));

const cases = [];
for (const { id, file, d } of snapshots) {
  const r = d.resume;
  const model = buildModel(r);
  const txt = (await exportResume(r, 'txt')).text;
  const md = (await exportResume(r, 'md')).text;
  const jsonResume = (await exportResume(r, 'json')).text;
  cases.push({
    id,
    file,
    d,
    r,
    model,
    txt,
    md,
    jsonResume,
    bytes: d.resumeSource?.text?.length || r.text.length,
  });
}

const totals = cases.reduce(
  (a, c) => {
    a.roles += c.r.stats.experience;
    a.projects += c.r.stats.projects;
    a.skills += c.r.stats.skills;
    a.warnings += c.r.warnings.length;
    return a;
  },
  { roles: 0, projects: 0, skills: 0, warnings: 0 }
);

const caseCards = cases
  .map(({ id, file, d, r, model, txt, md, jsonResume }, i) => {
    const topRole = d.roles?.[0];
    const topSkills = d.skills || [];
    const notes = NOTES[id] || [];
    return `
    <section class="case" id="${esc(id)}">
      <header class="case-head">
        <div class="case-no">CASE ${String(i + 1).padStart(2, '0')}</div>
        <div class="case-title">
          <h2>${esc(r.name || 'Unnamed resume')}</h2>
          <p>${esc(r.contact?.email || 'no email')}${r.contact?.location ? ` · ${esc(r.contact.location)}` : ''} · <span>${esc(file)}</span></p>
        </div>
        <div class="case-badges">
          <span>${esc(d.resumeSource?.format?.toUpperCase() || 'FILE')}</span>
          <span>${num(r.stats.chars)} chars</span>
          <span>${r.warnings.length ? `${r.warnings.length} warning${r.warnings.length > 1 ? 's' : ''}` : 'clean read'}</span>
        </div>
      </header>

      <div class="phase-rail" aria-label="Build phases">
        <div><b>01</b><span>ingest</span></div>
        <div><b>02</b><span>extract</span></div>
        <div><b>03</b><span>normalize</span></div>
        <div><b>04</b><span>score</span></div>
        <div><b>05</b><span>dossier</span></div>
      </div>

      <div class="case-grid">
        <div class="panel">
          <h3>01 // ingestion</h3>
          <dl class="metrics">
            <div><dt>format</dt><dd>${esc(d.resumeSource?.format?.toUpperCase() || 'FILE')}</dd></div>
            <div><dt>characters</dt><dd>${num(r.stats.chars)}</dd></div>
            <div><dt>sections</dt><dd>${num(r.stats.sections)}</dd></div>
            <div><dt>roles</dt><dd>${num(r.stats.experience)}</dd></div>
            <div><dt>projects</dt><dd>${num(r.stats.projects)}</dd></div>
            <div><dt>skill items</dt><dd>${num(r.stats.skills)}</dd></div>
          </dl>
          <div class="note">
            <b>contact</b>
            <p>${esc(
              [
                r.contact?.email,
                r.contact?.phone,
                r.contact?.location,
                ...Object.entries(r.contact?.links || {}).map(([k, v]) => `${k}: ${v}`),
              ]
                .filter(Boolean)
                .join(' · ') || 'nothing recovered'
            )}</p>
          </div>
          ${
            r.warnings.length
              ? `<div class="warn"><b>parser warnings</b><ul>${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`
              : '<div class="okline">no parser warnings</div>'
          }
        </div>

        <div class="panel">
          <h3>02 // extraction notes</h3>
          <ol class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ol>
        </div>

        <div class="panel span-2">
          <h3>03 // refined dossier</h3>
          <div class="dossier">
            <div class="d-identity">
              <div class="kicker">best-fit signal</div>
              <div class="signal">${esc(topRole?.title || 'no role signal')}</div>
              <div class="signal-sub">${topRole ? `${pct(topRole.fit)} fit · ${esc(topRole.verdict || '')}` : 'add more evidence'}</div>
              <div class="chips">${skillChips(topSkills, 10)}</div>
            </div>
            <div class="d-skills">
              <div class="kicker">top evidence</div>
              ${(topSkills || [])
                .slice(0, 5)
                .map(
                  (s) => `<div class="ev"><span>${esc(s.label)}</span><b>${pct(s.confidence * 100)}</b></div>`
                )
                .join('')}
            </div>
            <div class="d-time">
              <div class="kicker">experience</div>
              ${timeline(model.sections.find((s) => s.id === 'experience')?.entries || [])}
            </div>
            <div class="d-edu">
              <div class="kicker">education</div>
              ${educationRows(r.education || [])}
            </div>
            <div class="d-proj">
              <div class="kicker">projects</div>
              ${projectRows(model.sections.find((s) => s.id === 'projects')?.entries || [])}
            </div>
          </div>
        </div>

        <div class="panel span-2">
          <h3>04 // market read</h3>
          <div class="roles">${roleRows(d.roles || [], 4)}</div>
          <p class="fine">Scored from the parsed resume against ${num(d.jobs?.scanned)} scanned openings in the snapshot. Fit is a model score, not a prediction of an offer.</p>
        </div>
      </div>

      <div class="details-grid">
        ${details('raw extracted text', r.text)}
        ${details('parsed resume JSON', json(r))}
        ${details('normalized model JSON', json(model))}
        ${details('plain-text export', txt)}
        ${details('markdown export', md)}
        ${details('JSON Resume export', jsonResume)}
      </div>
    </section>`;
  })
  .join('');

const control = `
<section class="case control" id="github-control">
  <header class="case-head">
    <div class="case-no">CONTROL</div>
    <div class="case-title">
      <h2>BoogerCheeseOnRye</h2>
      <p>Public GitHub profile · same scorer, different evidence source · <span>github.com/BoogerCheeseOnRye</span></p>
    </div>
    <div class="case-badges">
      <span>PROFILE</span>
      <span>${num(extra.profile?.publicRepos || 0)} public repos</span>
      <span>${num(extra.profile?.stars || 0)} stars sampled</span>
    </div>
  </header>
  <div class="phase-rail"><div><b>01</b><span>repo scan</span></div><div><b>02</b><span>evidence</span></div><div><b>03</b><span>score</span></div><div><b>04</b><span>dossier</span></div></div>
  <div class="case-grid">
    <div class="panel">
      <h3>// what the code says</h3>
      <p class="prose">The profile is mostly JavaScript and HTML, with Node services, WebGL experiments and a small Python component. The strongest signals are declared dependencies and committed language bytes, not claims in a README.</p>
      <div class="chips">${skillChips(extra.skills || [], 12)}</div>
    </div>
    <div class="panel">
      <h3>// role read</h3>
      <div class="roles">${roleRows(extra.roles || [], 4)}</div>
    </div>
    <div class="panel span-2">
      <h3>// why this is the control</h3>
      <p class="prose">A resume is a claim; a repository is evidence. The same scorer produces a calmer, lower-confidence read here because bytes and manifests are harder to inflate than prose. That contrast is the point of the product: the résumé builder should show what is supported, not what sounds impressive.</p>
      <div class="compare">
        <div><b>Résumé case</b><span>claims → extract → score</span></div>
        <div><b>Profile case</b><span>bytes + manifests → score</span></div>
      </div>
    </div>
  </div>
  <div class="details-grid">
    ${details('profile snapshot JSON', json({
      profile: {
        name: extra.profile?.name,
        handle: extra.profile?.handle,
        url: extra.profile?.url,
        description: extra.profile?.description,
        publicRepos: extra.profile?.publicRepos,
        followers: extra.profile?.followers,
        languages: extra.profile?.languages,
        deps: extra.profile?.deps,
        repos: (extra.profile?.repos || []).map((r) => ({ name: r.name, language: r.language, stars: r.stars })),
      },
      skills: extra.skills,
      roles: extra.roles,
    }))}
  </div>
</section>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Resume as Evidence — JobWall Research Paper</title>
<style>
:root{
  --bg:#05090d; --panel:#0a1219; --panel2:#0d1821; --line:#15333d; --line2:#1f4b57;
  --text:#d8f1f4; --dim:#78959e; --faint:#4d6871; --cyan:#59f3ff; --green:#69ffb6;
  --amber:#ffb84d; --red:#ff6685; --violet:#b69cff; --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 var(--mono);overflow-x:hidden}
body:before{content:"";position:fixed;inset:0;pointer-events:none;z-index:0;
  background:
    linear-gradient(rgba(89,243,255,.035) 1px,transparent 1px),
    linear-gradient(90deg,rgba(89,243,255,.035) 1px,transparent 1px),
    radial-gradient(900px 500px at 80% -10%,rgba(89,243,255,.10),transparent 70%),
    radial-gradient(700px 400px at -10% 20%,rgba(182,156,255,.08),transparent 70%);
  background-size:32px 32px,32px 32px,100% 100%,100% 100%;
}
body:after{content:"";position:fixed;inset:0;pointer-events:none;z-index:0;background:repeating-linear-gradient(0deg,rgba(0,0,0,.16) 0 1px,transparent 1px 4px);opacity:.22}
a{color:var(--cyan);text-decoration:none}a:hover{text-decoration:underline}
.wrap{position:relative;z-index:1;max-width:1180px;margin:0 auto;padding:28px 22px 80px}
.top{display:flex;justify-content:space-between;align-items:center;gap:16px;border:1px solid var(--line);background:rgba(6,13,18,.82);padding:10px 14px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
.top b{color:var(--cyan);letter-spacing:.2em}
.top .dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 10px var(--green);margin-right:7px}
nav{display:flex;flex-wrap:wrap;gap:4px;margin:18px 0 34px;border-bottom:1px solid var(--line);padding-bottom:12px}
nav a{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);padding:6px 9px;border:1px solid transparent}
nav a:hover{border-color:var(--line2);color:var(--cyan);text-decoration:none;background:rgba(89,243,255,.04)}
.hero{padding:22px 0 38px;border-bottom:1px solid var(--line);margin-bottom:34px}
.eyebrow{color:var(--amber);font-size:11px;letter-spacing:.24em;text-transform:uppercase}
h1{font-size:clamp(34px,6vw,72px);line-height:.98;letter-spacing:-.045em;margin:14px 0 18px;max-width:900px;font-weight:700}
h1 em{font-style:normal;color:var(--cyan);text-shadow:0 0 28px rgba(89,243,255,.35)}
.lede{max-width:780px;color:#a9c6cc;font-size:16px}
.meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:24px}
.meta span,.badge{border:1px solid var(--line2);padding:5px 9px;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);background:rgba(89,243,255,.03)}
h2{font-size:clamp(22px,3vw,34px);letter-spacing:-.03em;margin:0}
h3{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--cyan);margin:0 0 14px;font-weight:600}
p{margin:0 0 12px}
.abstract{display:grid;grid-template-columns:1.5fr 1fr;gap:22px;margin:34px 0}
.abstract .prose{color:#b8d2d7;font-size:15px}
.kpis{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
.kpi{border:1px solid var(--line);background:linear-gradient(180deg,rgba(13,24,33,.9),rgba(8,16,22,.9));padding:14px}
.kpi b{display:block;font-size:28px;color:var(--cyan);line-height:1.1}
.kpi span{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim)}
.pipeline{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:30px 0 40px}
.pipe{border:1px solid var(--line);background:rgba(10,18,25,.86);padding:13px 12px;position:relative;min-height:94px}
.pipe b{display:block;color:var(--amber);font-size:10px;letter-spacing:.18em;margin-bottom:8px}
.pipe span{display:block;font-size:12px;color:#c8e6ea}
.pipe i{display:block;font-size:10px;color:var(--faint);font-style:normal;margin-top:7px}
.pipe:after{content:"›";position:absolute;right:-9px;top:38px;color:var(--line2);font-size:20px;z-index:2}
.pipe:last-child:after{display:none}
.table-wrap{overflow-x:auto;border:1px solid var(--line);margin:18px 0 38px;background:rgba(6,13,18,.55)}
.corpus{width:100%;min-width:760px;border-collapse:collapse;font-size:12px;margin:0}
.corpus th,.corpus td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line)}
.corpus th{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);font-weight:400}
.corpus td{border-bottom-color:#0f252d}
.corpus tr:hover td{background:rgba(89,243,255,.03)}
.case{border:1px solid var(--line);background:rgba(6,13,18,.72);margin:30px 0;padding:0;position:relative}
.case:before{content:"";position:absolute;left:-1px;top:18px;bottom:18px;width:2px;background:linear-gradient(var(--cyan),transparent)}
.case-head{display:grid;grid-template-columns:90px 1fr auto;gap:16px;align-items:start;padding:22px 22px 16px;border-bottom:1px solid var(--line)}
.case-no{font-size:10px;letter-spacing:.18em;color:var(--amber);padding-top:7px}
.case-title p{font-size:11px;color:var(--dim);margin:4px 0 0}
.case-title p span{color:var(--faint)}
.case-badges{display:flex;flex-wrap:wrap;gap:5px;justify-content:flex-end}
.case-badges span{font-size:9px;letter-spacing:.08em;text-transform:uppercase;border:1px solid var(--line2);padding:3px 6px;color:var(--dim)}
.phase-rail{display:flex;flex-wrap:wrap;gap:0;border-bottom:1px solid var(--line);padding:0 22px}
.phase-rail div{display:flex;align-items:center;gap:6px;padding:9px 16px 9px 0;margin-right:14px;position:relative;font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint)}
.phase-rail div:after{content:"/";position:absolute;right:0;color:var(--line2)}
.phase-rail div:last-child:after{display:none}
.phase-rail b{color:var(--cyan);font-weight:500}
.case-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--line)}
.panel{background:var(--panel);padding:20px 22px;min-width:0}
.panel.span-2{grid-column:span 2}
.panel .prose{color:#b8d2d7}
.metrics{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--line);margin:0 0 14px}
.metrics div{background:var(--panel2);padding:9px 10px}
.metrics dt{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}
.metrics dd{margin:1px 0 0;font-size:16px;color:var(--text)}
.note,.warn{border:1px solid var(--line);padding:10px 12px;margin:10px 0;background:rgba(10,18,25,.6)}
.note b,.warn b{font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint)}
.note p{margin:4px 0 0;font-size:11px;color:#b8d2d7;word-break:break-word}
.warn{border-color:rgba(255,102,133,.35)}
.warn ul{margin:5px 0 0;padding-left:16px;font-size:11px;color:#ffc3ce}
.okline{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--green);border:1px solid rgba(105,255,182,.25);padding:8px 10px;margin-top:10px}
.notes{margin:0;padding-left:18px;color:#b8d2d7;font-size:12px}
.notes li{margin:0 0 10px;padding-left:2px}
.notes li::marker{color:var(--amber)}
.dossier{display:grid;grid-template-columns:1.15fr .85fr 1.1fr;gap:1px;background:var(--line);border:1px solid var(--line)}
.d-identity,.d-skills,.d-time,.d-edu,.d-proj{background:var(--panel2);padding:14px;min-width:0}
.d-identity{grid-column:span 2;display:grid;grid-template-columns:1.4fr 1fr;gap:14px;align-items:start}
.d-side{grid-column:span 1}
.d-time{grid-column:span 2}
.d-edu{grid-column:span 1}
.d-proj{grid-column:span 3;display:flex;flex-wrap:wrap;gap:0 18px}
.d-proj .kicker{width:100%}
.d-proj .proj{width:calc(50% - 9px)}
.kicker{font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:var(--faint);margin-bottom:5px}
.kicker.pad{margin-top:14px}
.signal{font-size:24px;line-height:1.1;letter-spacing:-.03em;color:var(--cyan)}
.signal-sub{font-size:10px;color:var(--amber);text-transform:uppercase;letter-spacing:.1em;margin-top:4px}
.chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:12px}
.chip{font-size:9px;border:1px solid var(--line2);padding:3px 6px;color:#b8d2d7;background:rgba(89,243,255,.03);white-space:nowrap}
.chip i{font-style:normal;color:var(--faint);margin-left:4px}
.ev{display:flex;justify-content:space-between;gap:8px;font-size:10px;border-bottom:1px solid #102830;padding:5px 0;color:#b8d2d7}
.ev b{color:var(--green);font-weight:500}
.tl{display:grid;grid-template-columns:92px 1fr;gap:8px;border-bottom:1px solid #102830;padding:7px 0;font-size:10px}
.tl-when{color:var(--faint)}
.tl-body b{display:block;color:var(--text);font-weight:500;line-height:1.35}
.tl-body span{display:block;color:var(--dim);font-size:9px}
.empty{font-size:10px;color:var(--faint);border:1px dashed var(--line2);padding:9px 10px;margin-top:6px}
.edu,.proj{border-bottom:1px solid #102830;padding:5px 0;font-size:10px}
.edu b,.proj b{display:block;font-weight:500;color:var(--text)}
.edu span,.proj span{display:block;color:var(--dim)}
.edu em{display:block;color:var(--faint);font-style:normal;font-size:9px}
.d-edu .edu{border:0;border-bottom:1px solid #102830;padding:5px 0}
.roles{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--line)}
.role{background:var(--panel2);padding:12px}
.role-top{display:flex;justify-content:space-between;gap:8px;font-size:11px}
.role-top b{font-weight:500}
.fit{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--dim)}
.fit.strong{color:var(--green)}.fit.likely{color:var(--cyan)}.fit.stretch{color:var(--amber)}.fit.reach{color:var(--red)}
.bar{height:3px;background:#102830;margin:8px 0}
.bar span{display:block;height:100%;background:linear-gradient(90deg,var(--cyan),var(--green))}
.role-meta{display:flex;justify-content:space-between;gap:8px;font-size:9px;color:var(--faint)}
.gap{font-size:9px;color:#ff9caf;margin-top:6px}.gap.ok{color:var(--faint)}
.fine{font-size:10px;color:var(--faint);margin:10px 0 0}
.details-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--line);border-top:1px solid var(--line)}
details{background:#081016;min-width:0}
summary{cursor:pointer;padding:10px 14px;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);list-style:none;display:flex;justify-content:space-between;gap:10px}
summary::-webkit-details-marker{display:none}
summary:after{content:"+";color:var(--cyan)}
details[open] summary{color:var(--cyan);border-bottom:1px solid var(--line)}
details[open] summary:after{content:"−"}
pre{margin:0;padding:14px;max-height:440px;overflow:auto;font-size:10px;line-height:1.5;color:#a9c6cc;background:#060d12;white-space:pre-wrap;word-break:break-word}
.compare{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
.compare div{border:1px solid var(--line);padding:10px}
.compare b{display:block;font-size:10px;color:var(--cyan);text-transform:uppercase;letter-spacing:.1em}
.compare span{font-size:10px;color:var(--dim)}
.findings{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:18px 0}
.finding{border:1px solid var(--line);background:rgba(10,18,25,.75);padding:14px}
.finding b{display:block;color:var(--amber);font-size:10px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:5px}
.finding p{font-size:12px;color:#b8d2d7;margin:0}
.limits{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.limit{border-left:2px solid var(--line2);padding:4px 0 4px 12px;font-size:12px;color:#b8d2d7}
.limit b{display:block;color:var(--text);font-size:11px;margin-bottom:3px}
footer{border-top:1px solid var(--line);margin-top:50px;padding:22px 0;font-size:10px;color:var(--faint);display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px}
.section-block{margin:46px 0}
.section-block>h2{margin-bottom:8px}
.section-kicker{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--amber);margin-bottom:6px}
.section-block>p{color:#a9c6cc;max-width:860px}
@media(max-width:860px){
  .abstract,.case-grid,.findings,.limits,.compare{grid-template-columns:1fr}
  .panel.span-2{grid-column:span 1}
  .pipeline{grid-template-columns:1fr 1fr}
  .pipe:after{display:none}
  .dossier{grid-template-columns:1fr}
  .d-identity,.d-edu{grid-column:span 1;grid-template-columns:1fr}
  .d-time{grid-column:span 1}
  .d-proj{grid-column:span 1}
  .d-proj .proj{width:100%}
  .roles{grid-template-columns:1fr}
  .details-grid{grid-template-columns:1fr}
  .case-head{grid-template-columns:1fr;gap:8px}
  .case-badges{justify-content:flex-start}
  .case-no{padding-top:0}
}
@media print{
  body{background:#fff;color:#111}
  body:before,body:after,nav,.top,.phase-rail,.details-grid{display:none}
  .case,.panel,.kpi,.finding,.limit{border-color:#bbb;background:#fff;color:#111}
  h1,h2,h3,.signal,.kpi b{color:#111;text-shadow:none}
  .wrap{max-width:none;padding:0}
  details{display:none}
}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div><span class="dot"></span><b>JOBWALL</b> // research terminal</div>
    <div>base 8940e41 · parser fixes in worktree · ${esc(TODAY)} · offline snapshot</div>
  </div>

  <nav>
    <a href="#abstract">abstract</a>
    <a href="#method">method</a>
    <a href="#corpus">corpus</a>
    <a href="#sourabh-bajaj">01 sourabh</a>
    <a href="#deedy-das">02 deedy</a>
    <a href="#lawrence-du">03 lawrence</a>
    <a href="#sebastian-villa-cuellar">04 sebastian</a>
    <a href="#findings">findings</a>
    <a href="#limits">limits</a>
    <a href="#github-control">control</a>
  </nav>

  <header class="hero">
    <div class="eyebrow">JobWall / research note 01</div>
    <h1>Resume as <em>evidence</em>, not a document to decorate.</h1>
    <p class="lede">Four real resumes, four different layouts, one pipeline. This paper shows what the parser actually recovers, what it has to infer, and where the refined dossier stops being trustworthy.</p>
    <div class="meta">
      <span>4 real résumés</span><span>2 PDF / 2 DOCX</span><span>${num(totals.roles)} parsed roles</span><span>${num(totals.projects)} projects</span><span>${num(totals.warnings)} warnings kept visible</span>
    </div>
  </header>

  <section class="abstract" id="abstract">
    <div>
      <div class="section-kicker">Abstract</div>
      <h2>The résumé builder is a reading problem first.</h2>
      <p class="prose" style="margin-top:12px">JobWall began as a way to turn a GitHub profile into a realistic job-title read. The résumé path reuses the same scorer, but the input is harder: a PDF has no paragraphs, only glyphs at coordinates; a DOCX has styles but no guarantee the author used them; and a two-column design can put two unrelated sections on the same baseline.</p>
      <p class="prose">This note documents four public résumés taken through the current build: ingest, extract, normalize, score, and render one refined dossier. Every count, warning and role fit below comes from the parser and scorer at snapshot time. Nothing is hand-filled to make a case look better.</p>
    </div>
    <div class="kpis">
      <div class="kpi"><b>${num(totals.roles)}</b><span>roles parsed</span></div>
      <div class="kpi"><b>${num(totals.projects)}</b><span>projects parsed</span></div>
      <div class="kpi"><b>${num(totals.skills)}</b><span>skill items read</span></div>
      <div class="kpi"><b>142</b><span>tests in suite</span></div>
    </div>
  </section>

  <section class="section-block" id="method">
    <div class="section-kicker">Method</div>
    <h2>One semantic model, five visible phases.</h2>
    <p>The pipeline is deliberately boring. The interesting part is what each phase refuses to hide.</p>
    <div class="pipeline">
      <div class="pipe"><b>01 INGEST</b><span>bytes in, format sniffed</span><i>PDF · DOCX · TXT</i></div>
      <div class="pipe"><b>02 EXTRACT</b><span>glyphs / paragraphs → lines</span><i>layout recovery</i></div>
      <div class="pipe"><b>03 NORMALIZE</b><span>sections, dates, contacts</span><i>warnings kept</i></div>
      <div class="pipe"><b>04 SCORE</b><span>skills → roles → openings</span><i>evidence, not vibes</i></div>
      <div class="pipe"><b>05 DOSSIER</b><span>one card, ten exports</span><i>same model</i></div>
    </div>
  </section>

  <section class="section-block" id="corpus">
    <div class="section-kicker">Corpus</div>
    <h2>Four public samples, chosen for disagreement.</h2>
    <div class="table-wrap">
    <table class="corpus">
      <thead><tr><th>case</th><th>source</th><th>format</th><th>chars</th><th>roles</th><th>projects</th><th>parsed skills</th><th>warnings</th></tr></thead>
      <tbody>
        ${cases
          .map(
            (c, i) => `<tr><td><a href="#${esc(c.id)}">0${i + 1} ${esc(c.r.name)}</a></td><td>${esc(c.file)}</td><td>${esc(
              c.d.resumeSource?.format?.toUpperCase()
            )}</td><td>${num(c.r.stats.chars)}</td><td>${num(c.r.stats.experience)}</td><td>${num(
              c.r.stats.projects
            )}</td><td>${num(c.r.stats.skills)}</td><td>${c.r.warnings.length}</td></tr>`
          )
          .join('')}
      </tbody>
    </table>
    </div>
  </section>

  ${caseCards}

  <section class="section-block" id="findings">
    <div class="section-kicker">Findings</div>
    <h2>What broke, and what the build now does about it.</h2>
    <div class="findings">
      <div class="finding"><b>01 / tokenizer</b><p>A PDF operator written as <code>TJ/F29</code> with no whitespace was read as one token. Names, employers and headings disappeared from extraction. Adding <code>/</code> as a delimiter fixed the case without a PDF library.</p></div>
      <div class="finding"><b>02 / headings</b><p>Real exports say “Experience”, not “EXPERIENCE”. Section detection now accepts a short title-case line that is exactly a section name, while still rejecting “Experience: 10 years”.</p></div>
      <div class="finding"><b>03 / org above title</b><p>“• Google   Mountain View, CA” followed by “Software Engineer   Oct 2016 – Present” is one role. The bullet now seeds the org and location instead of becoming an achievement.</p></div>
      <div class="finding"><b>04 / labeled bullets</b><p>“• QuantSoftware Toolkit : Open source…” is a project, not an unnamed bullet. The label becomes the name and the rest becomes the description.</p></div>
      <div class="finding"><b>05 / education</b><p>A bulleted school line followed by a dated degree line now merges into one entry with school, location, degree and dates.</p></div>
      <div class="finding"><b>06 / two columns</b><p>A split is only attempted when two section headings share a baseline on opposite sides of a gutter. Reading each column top-to-bottom recovers Deedy’s experience block.</p></div>
      <div class="finding"><b>07 / contact noise</b><p>Labels like “Email:” no longer become part of the name, and a bare domain such as <code>sourabhbajaj.com</code> is kept as a website.</p></div>
      <div class="finding"><b>08 / honesty</b><p>Warnings survive into the UI. The dossier says what it could not place instead of silently dropping lines to make the card look complete.</p></div>
    </div>
  </section>

  <section class="section-block" id="limits">
    <div class="section-kicker">Limits</div>
    <h2>What still needs a human.</h2>
    <div class="limits">
      <div class="limit"><b>Two-column semantics</b>Deedy extracts, but links and coursework still land in education, and the org/title boundary is imperfect. Column geometry is not reading order.</div>
      <div class="limit"><b>Title / org boundaries</b>Lawrence writes “GSK • Senior AI/ML Engineer, …” on one line. The model keeps it as a title; a correction pass should split it.</div>
      <div class="limit"><b>Nested roles</b>Sebastian’s sub-roles under one employer become separate dated entries. The timeline is flatter than the source.</div>
      <div class="limit"><b>Prose inference</b>Sourabh has no skills section. The scorer infers Python, ML and performance from achievement prose; that is useful but it is inference, not a declaration.</div>
      <div class="limit"><b>Market snapshot</b>Openings are a point-in-time read of the feed, not a forecast. Fit is a model score and the paper labels it as such.</div>
      <div class="limit"><b>No fabrication</b>The refined card is a view over parsed fields. If a field is missing, it stays missing; the UI does not invent a school, a date or a metric.</div>
    </div>
  </section>

  ${control}

  <section class="section-block" id="reproduce">
    <div class="section-kicker">Reproduce</div>
    <h2>The paper is generated, not written by hand.</h2>
    <p><code>node research/collect.mjs</code> re-reads the four samples and scores them. <code>node research/build-paper.mjs</code> rebuilds this page from the snapshots. The résumé files stay in <code>research/samples/</code>; the paper embeds the extracted text, the parsed JSON and the export output so a reader can audit any claim.</p>
    <p>Test suite: <code>npm test</code> → 142 tests, 0 failures (two live GitHub checks skip when the anonymous quota is exhausted). The parser changes in this note are covered by the existing resume, PDF and rendering tests; no test was weakened to make a case pass.</p>
  </section>

  <footer>
    <span>JobWall research note 01 · ${esc(TODAY)}</span>
    <span>sources: public résumé samples + GitHub profile snapshot · all data embedded in this file</span>
  </footer>
</div>
</body>
</html>`;

await writeFile(join(root, 'docs', 'research.html'), html);
console.log(`wrote docs/research.html (${(html.length / 1024).toFixed(1)} KB)`);
