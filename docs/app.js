import { analyze as runAnalyze, analyzeMany, analyzeResume, probe, isBrowserMode } from './api.js';
import { readError } from './lib/resume-source.js';
import { buildModel, exportResume, FORMATS } from './lib/resume-export.js';
import { resumePreview, draftModel, manifestRows } from './lib/export-preview.js';
import { SCOPES, DEFAULT_SCOPE } from './lib/geo.js';
import { boardLinks, whereForScope } from './lib/search.js';

const $ = (sel) => document.querySelector(sel);

// The URL row holds one input by default and grows with the + button. Reading
// through this helper (rather than document.querySelectorAll directly) keeps the
// single-target test path working too: the tests drive one #url field, and a
// page with no .url-input class still resolves to it.
function urlInputs() {
  const all = [...document.querySelectorAll('.url-input')];
  if (all.length) return all;
  const one = $('#url');
  return one ? [one] : [];
}

function addUrlField(value = '') {
  const wrap = $('#url-multi');
  if (!wrap) return null;
  const row = document.createElement('div');
  row.className = 'url-row';
  const input = document.createElement('input');
  input.className = 'url-input';
  input.type = 'text';
  input.spellcheck = false;
  input.placeholder = 'https://github.com/owner/repo or user/repo';
  input.value = value;
  const rm = document.createElement('button');
  rm.type = 'button';
  rm.className = 'url-remove';
  rm.setAttribute('aria-label', 'Remove this entry');
  rm.textContent = '−';
  rm.addEventListener('click', () => {
    row.remove();
    updateUrlRemoveButtons();
  });
  row.appendChild(input);
  row.appendChild(rm);
  wrap.appendChild(row);
  updateUrlRemoveButtons();
  return input;
}

function updateUrlRemoveButtons() {
  const rows = document.querySelectorAll('#url-multi .url-row');
  rows.forEach((r) => {
    const rm = r.querySelector('.url-remove');
    if (rm) rm.style.display = rows.length > 1 ? '' : 'none';
  });
}
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const num = (n) => Number(n || 0).toLocaleString();
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;
const ago = (iso) => {
  if (!iso) return 'unknown date';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
};

// Dates in the source are ISO timestamps; the card wants the day and the
// message wants one line. Neither function invents a value for a missing field.
const dateShort = (iso) => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const clipText = (text, max = 90) => {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

const VERDICT_PILL = {
  strong: 'pill-good',
  likely: 'pill-good',
  stretch: 'pill-mid',
  reach: 'pill-warn',
};

let lastResult = null;
let activeView = 'dossier';

// The deck is one surface, not a page of cards. Tabs only change which readout
// is visible; the parsed subject stays loaded in all three.
function showView(name) {
  activeView = ['dossier', 'market', 'export'].includes(name) ? name : 'dossier';
  for (const view of ['dossier', 'market', 'export']) {
    const tab = $(`#tab-${view}`);
    const panel = $(`#view-${view}`);
    if (tab) {
      tab.classList.toggle('is-active', view === activeView);
      tab.setAttribute('aria-selected', view === activeView ? 'true' : 'false');
    }
    if (panel) panel.hidden = view !== activeView;
  }
}

// Exported so the wiring can be exercised against a stub DOM in tests, and so
// nothing runs twice if the page is ever mounted again.
export function mount() {
  $('#form').addEventListener('submit', onSubmit);
  $('#export').addEventListener('click', onExportClick);
  $('#add-url').addEventListener('click', () => {
    const input = addUrlField();
    if (input && input.focus) input.focus();
  });
  for (const name of ['dossier', 'market', 'export']) {
    $(`#tab-${name}`).addEventListener('click', () => showView(name));
  }

  $('#form-resume').addEventListener('submit', (e) => {
    e.preventDefault();
    onResumeSubmit();
  });
  $('#resume').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    $('#resume-hint').textContent = file
      ? `${file.name} — ${(file.size / 1024).toFixed(0)} KB, ready to read`
      : 'PDF, Word, or plain text. Parsed on this page — no account, no upload, nothing stored.';
  });
  for (const chip of document.querySelectorAll('[data-fill]')) {
    chip.addEventListener('click', () => {
      const inputs = urlInputs();
      const last = inputs[inputs.length - 1];
      if (last && !last.value) last.value = chip.dataset.fill;
      else addUrlField(chip.dataset.fill);
      $('#form').requestSubmit();
    });
  }
  $('#realistic').addEventListener('change', () => lastResult && renderJobs(lastResult));
  $('#remote').addEventListener('change', () => lastResult && renderJobs(lastResult));
  $('#paid').addEventListener('change', () => lastResult && renderJobs(lastResult));
  $('#scope').value = DEFAULT_SCOPE;
  // ensure first URL row can be removed if multiple exist later
  const first = document.querySelector('#url-multi .url-input');
  if (first && !first.closest('.url-row')) {
    const row = document.createElement('div');
    row.className = 'url-row';
    const input = first;
    const parent = first.parentElement;
    if (parent) parent.insertBefore(row, input); else $('#url-multi')?.appendChild(row);
    row.appendChild(input);
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'url-remove';
    rm.setAttribute('aria-label', 'Remove this entry');
    rm.textContent = '−';
    rm.addEventListener('click', () => { row.remove(); updateUrlRemoveButtons(); });
    row.appendChild(rm);
    updateUrlRemoveButtons();
  } else {
    updateUrlRemoveButtons();
  }

  // Scope changes the openings *and* the hand-built search links, so both
  // sections are re-rendered. Built at analysis time they would still point at
  // the location chosen before the reader touched the dropdown.
  $('#scope').addEventListener('change', () => {
    if (!lastResult) return;
    renderJobs(lastResult);
    renderSearch(lastResult);
  });

  // Health check on load so the page never lies about what's working. Picks the
  // backend once: the Node server when there is one, the in-browser engine when
  // the page is being served statically.
  probe()
    .then((feeds) => {
      $('#hud-engine').textContent = isBrowserMode() ? 'BROWSER' : 'NODE';
      $('#foot-feeds').textContent = isBrowserMode()
        ? (feeds.length ? `${feeds.map((s) => `${s.name} (${s.ok ? s.count : 'down'})`).join(' · ')} · in your browser` : 'feeds unavailable in your browser')
        : feeds.map((s) => `${s.name} ${s.ok ? `(${s.count})` : `(down)`}`).join(' · ');
    })
    .catch(() => {
      $('#foot-feeds').textContent = 'feed status unavailable';
    });
}

// GitHub gives anonymous browser callers 60 requests/hour per IP, and a
// profile scan spends several. Say so plainly instead of showing "403".
function rateLimitHint(err) {
  const msg = String(err && err.message || '');
  if (/rate limit|403|API rate/i.test(msg)) {
    return `GitHub allows 60 requests/hour per IP for anonymous callers, and a profile scan spends several. Try a single <strong>repo link</strong> instead of a whole profile, or run <code>node server.js</code> with a token.`;
  }
  return 'JobWall stays up — fix the link or try again.';
}

async function onSubmit(e) {
  e.preventDefault();
  const urls = urlInputs().map((i) => i.value.trim()).filter(Boolean);
  if (!urls.length) return setStatus('err', 'Paste a link or a username first.');

  $('#go').disabled = true;
  const reading = urls.length > 1 ? `${urls.length} profiles` : 'the code';
  setStatus('busy', `<span class="bar"></span>Reading ${reading}, then pulling live openings…`);
  try {
    const data = urls.length > 1 ? await analyzeMany(urls) : await runAnalyze(urls[0]);
    lastResult = data;
    render(data);
    setStatus('', `Done in ${(data.tookMs / 1000).toFixed(1)}s. ${data.jobs.count} openings matched from ${num(data.jobs.scanned)} scanned.${data.cached ? ' (cached)' : ''}`);
    $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    setStatus('err', `${esc(err.message)} <span class="dim">${rateLimitHint(err)}</span>`);
  } finally {
    $('#go').disabled = false;
  }
}

async function onResumeSubmit() {
  const input = $('#resume');
  const file = input.files && input.files[0];
  if (!file) return setStatus('err', 'Choose a file first — PDF, Word, or plain text.');

  $('#go-resume').disabled = true;
  $('#go').disabled = true;
  setStatus('busy', `<span class="bar"></span>Reading <strong>${esc(file.name)}</strong> in your browser…`);
  try {
    const data = await analyzeResume(file);
    lastResult = data;
    render(data);
    const warned = data.resume?.warnings?.length
      ? ` <span class="dim">${data.resume.warnings.length} line${data.resume.warnings.length > 1 ? 's' : ''} I could not place — check section 1.</span>`
      : '';
    setStatus('', `Parsed ${data.resumeSource.format.toUpperCase()} in ${(data.tookMs / 1000).toFixed(1)}s. ${data.jobs.count} openings matched from ${num(data.jobs.scanned)} scanned.${warned}`);
    $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    const read = err.read;
    setStatus('err', `${esc(readError(read))} <span class="dim">Nothing was uploaded — the file never left this page.</span>`);
  } finally {
    $('#go-resume').disabled = false;
    $('#go').disabled = false;
  }
}

function setStatus(kind, html) {
  const el = $('#status');
  el.className = `status ${kind}`;
  el.innerHTML = html;
}

function render(data) {
  renderEvidence(data);
  renderRoles(data);
  renderJobs(data);
  renderSearch(data);
  renderExport(data);
  $('#results').hidden = false;
  $('#boot').hidden = true;
  $('#hud-mode').textContent = data.resume ? 'RESUME LOCK' : 'PROFILE LINK';
  $('#deck-subject').textContent = data.resume
    ? `${data.resume.name || 'Résumé'} // DOCUMENT`
    : `${data.profile?.name || 'Subject'}${data.profile?.repo ? ` // ${data.profile.repo}` : ' // PROFILE'}`;
  showView('dossier');
  $('#foot-feeds').textContent = data.sources
    .map((s) => `${s.name} ${s.ok ? `(${s.count})` : `(down: ${esc(s.error || 'error')})`}`)
    .join(' · ');
  $('#foot-pay').textContent = data.fx
    ? `${data.fx.date} ECB rates`
    : 'no fx today — ranges shown in their own currency';
}

// --------------------------------------------------------------- 5. export
// Every format is built here, in the page, from the same parse shown above.
// The download is a Blob, so the resume never touches a network again.
let exportModel = null;

function formatButtons() {
  const groups = [...new Set(FORMATS.map((f) => f.group))];
  return groups
    .map((group) => {
      const specs = FORMATS.filter((f) => f.group === group);
      return `<div class="export-group">
        <div class="export-group-label">${esc(group)}</div>
        <div class="export-grid">
          ${specs
            .map(
              (f) => `<button type="button" class="export-btn" data-format="${esc(f.id)}" title="${esc(f.blurb)}">
                <b>${esc(f.label)}</b><span>${esc(f.blurb)}</span>
              </button>`
            )
            .join('')}
        </div>
      </div>`;
    })
    .join('');
}

function sectionCount(section) {
  if (section.kind === 'entries') {
    return `${section.entries.length} ${section.entries.length === 1 ? 'entry' : 'entries'}`;
  }
  if (section.kind === 'groups') {
    const items = section.groups.reduce((n, group) => n + group.items.length, 0);
    return `${section.groups.length} ${section.groups.length === 1 ? 'group' : 'groups'} · ${items} items`;
  }
  return `${section.runs.reduce((n, run) => n + run.items.length, 0)} lines`;
}

export function renderExport(data) {
  const section = $('#export-section');
  const empty = $('#export-empty');
  if (!data) {
    section.hidden = true;
    if (empty) empty.hidden = false;
    exportModel = null;
    return;
  }
  section.hidden = false;
  if (empty) empty.hidden = true;

  // A resume is the only source that can honestly produce a resume document.
  // It previews the exact model every download uses.
  if (data.resume) {
    const model = buildModel(data.resume);
    exportModel = model;
    const warnings = (data.resume.warnings || []).length
      ? `<p class="hint export-hint">${
          data.resume.warnings.length === 1
            ? 'One line could not be placed, so it is not in these files.'
            : `${data.resume.warnings.length} lines could not be placed, so they are not in these files.`
        } Fix it in the source and read the file again.</p>`
      : '';
    const rows = [
      ['name', model.meta.name],
      ['contact', `${model.meta.contacts.length} detail${model.meta.contacts.length === 1 ? '' : 's'}`],
      ...(model.summary ? [['summary', 'included']] : []),
      ...model.sections.map((s) => [s.title, sectionCount(s)]),
    ];
    $('#export').innerHTML = `
      <div class="export-head">
        <div>
          <div class="profile-title">${esc(model.meta.name)}</div>
          <div class="dim">${model.sections.length} section${model.sections.length === 1 ? '' : 's'} · ${num(
            model.meta.contacts.length
          )} contact detail${model.meta.contacts.length === 1 ? '' : 's'}</div>
        </div>
        <div class="facts">
          <span class="pill pill-good">print preview</span>
          <button type="button" class="print-preview">Print / Save PDF</button>
        </div>
      </div>
      <p class="hint export-hint">This sheet is the document, before it becomes a file. The downloads below carry the same names, sections and order.</p>
      <div class="export-layout">
        <div class="export-preview-col">${resumePreview(model)}</div>
        <aside class="export-rail">
          <div class="export-rail-label">Included in this export</div>
          <div class="export-manifest">${manifestRows(rows)}</div>
          ${warnings}
          <div class="export-rail-label" style="margin-top:.8rem">Download formats</div>
          ${formatButtons()}
        </aside>
      </div>`;
    return;
  }

  // A profile has no parsed document yet, so it becomes a working draft built
  // from the evidence that does exist: identity, inferred target roles,
  // inferred skills, and public repositories with their real metadata. Nothing
  // claims a job or a degree the profile cannot support.
  const model = draftModel(data);
  exportModel = model;
  const { profile = {}, roles = [], skills = [] } = data;
  const sampled = (profile.sampledRepos || []).length;
  const total = profile.repoTotal || profile.publicRepos || 0;
  const commits = (profile.repos || []).reduce((n, r) => n + (r.commits || 0), 0);
  const rows = [
    ['name', model.meta.name],
    ['contact', `${model.meta.contacts.length} detail${model.meta.contacts.length === 1 ? '' : 's'}`],
    ['summary', 'generated from evidence'],
    ...model.sections.map((s) => [s.title, sectionCount(s)]),
    ['repos read', `${num(sampled)} of ${num(total)}`],
    ...(commits ? [['commits seen', num(commits)]] : []),
  ];
  $('#export').innerHTML = `
    <div class="export-head">
      <div>
        <div class="profile-title">${esc(model.meta.name)}</div>
        <div class="dim">Draft résumé · built from public evidence</div>
      </div>
      <div class="facts">
        <span class="pill pill-mid">working draft</span>
        <button type="button" class="print-preview">Print / Save PDF</button>
      </div>
    </div>
    <p class="hint export-hint">This is a real résumé draft, not a placeholder: the summary, roles and skills are derived from ${num(
      (profile.repos || []).length
    )} public repositor${(profile.repos || []).length === 1 ? 'y' : 'ies'}. Add a parsed document later to replace the inferred sections with your own experience and education.</p>
    <div class="export-layout">
      <div class="export-preview-col">${resumePreview(model)}</div>
      <aside class="export-rail">
        <div class="export-rail-label">Included in this draft</div>
        <div class="export-manifest">${manifestRows(rows)}</div>
        <div class="export-note">
          <b>Draft // evidence only</b>
          <p>Target roles and skills are inferred and labelled as such. Experience and education are left out because this source has none — not because they were dropped. Every download carries the same draft.</p>
        </div>
        <div class="export-rail-label" style="margin-top:.8rem">Download formats</div>
        ${formatButtons()}
      </aside>
    </div>`;
}

async function onExportClick(event) {
  const print = event.target.closest('.print-preview');
  if (print) {
    if (typeof window !== 'undefined' && typeof window.print === 'function') {
      setStatus('', 'Opening the print dialog. Choose <strong>Save as PDF</strong> to keep a copy.');
      window.print();
    }
    return;
  }
  const button = event.target.closest('.export-btn');
  if (!button) return;
  if (!exportModel) return;
  const format = button.dataset.format;
  const label = button.querySelector('b').textContent;
  button.disabled = true;
  button.classList.add('busy');
  try {
    const out = await exportResume(exportModel, format);
    // A Blob URL keeps the file local. It is revoked on a delay because Safari
    // and Firefox can still be reading it when click() returns.
    const url = URL.createObjectURL(new Blob([out.data], { type: out.mime }));
    const link = document.createElement('a');
    link.href = url;
    link.download = out.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setStatus('', `Wrote <strong>${esc(out.filename)}</strong> — ${(out.data.length / 1024).toFixed(1)}kB, ${esc(label)}.`);
  } catch (err) {
    setStatus('err', `Could not build ${esc(label)}: ${esc(err.message)}`);
  } finally {
    button.disabled = false;
    button.classList.remove('busy');
  }
}

// ------------------------------------------------------------- 1. evidence
function tile(className, label, meta, body) {
  return `<section class="tile ${className}">
    <div class="tile-head">
      <span class="tile-label">${esc(label)}</span>
      ${meta ? `<span class="tile-meta">${esc(meta)}</span>` : ''}
    </div>
    ${body}
  </section>`;
}

function skillGroupsBlock(groups) {
  return `<div class="skill-groups scroll-area">${[...groups.entries()]
    .map(
      ([cat, items]) => `<div class="skill-group">
        <h3>${esc(cat.charAt(0).toUpperCase() + cat.slice(1))}</h3>
        ${items
          .map(
            (s) => `<div class="skill">
              <span class="skill-name">${esc(s.label)}</span>
              <span class="skill-why">${(s.why || [])
                .map((w) => `<span title="${esc(w.text)}">${esc(w.text.replace(/^(language|dependency|README|topic|project description|file):\s*/, ''))}</span>`)
                .join('') || '<span>—</span>'}</span>
            </div>`
          )
          .join('')}
      </div>`
    )
    .join('')}</div>`;
}

function renderEvidence(data) {
  if (data.resume) return renderResumeEvidence(data);
  const { profile, skills, roles, tookMs } = data;
  const sampled = profile.sampledRepos || [];
  const totalRepos = profile.repoTotal || profile.publicRepos || 0;
  const repos = profile.repos || [];
  const isProfile = !profile.repo;

  // The read is the product, so say what it was before anything else.
  $('#evidence-time').textContent = isProfile
    ? `${num(sampled.length || totalRepos)} of ${num(totalRepos)} repos read · ${(tookMs / 1000).toFixed(1)}s`
    : `${num(profile.fileCount || 0)} files · ${(tookMs / 1000).toFixed(1)}s`;

  const groups = new Map();
  for (const s of skills) {
    if (!groups.has(s.category)) groups.set(s.category, []);
    groups.get(s.category).push(s);
  }

  const facts = [];
  if (profile.stars) facts.push(`<span class="pill">${profile.stars} stars</span>`);
  if (profile.forks) facts.push(`<span class="pill">${profile.forks} forks</span>`);
  if (profile.followers) facts.push(`<span class="pill">${profile.followers} followers</span>`);
  if (profile.pushedAt) facts.push(`<span class="pill">pushed ${ago(profile.pushedAt)}</span>`);
  if (profile.license) facts.push(`<span class="pill">${esc(profile.license)}</span>`);
  if (profile.tools?.bundler) facts.push(`<span class="pill">${esc(profile.tools.bundler)}</span>`);
  if (profile.tools?.test) facts.push(`<span class="pill">${esc(profile.tools.test)}</span>`);

  // Lead with the conclusion. A recruiter reads the first line and decides
  // whether to keep reading, so the first line has to be the finding.
  const topRoles = (roles || []).slice(0, 2).map((r) => r.title);
  const topSkills = [...skills]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 4)
    .map((s) => s.label);
  const verdict =
    (topRoles.length || topSkills.length) &&
    `<div class="verdict">
       ${
         topRoles.length
           ? `You come across as a <b>${topRoles.join('</b> or <b>')}</b>.`
           : 'This reads as general software work.'
       }
       ${
         topSkills.length
           ? `Strongest evidence: ${topSkills.map((l) => `<b>${esc(l)}</b>`).join(', ')}.`
           : ''
       }
       ${
         isProfile
           ? `That came out of ${num(totalRepos)} public repos${sampled.length && sampled.length < totalRepos ? `, ${num(sampled.length)} of them read down to their README and package.json` : ', all read in full'}.`
           : ''
       }
     </div>`;

  // Language mix. A repo with 21 KB of Python inside 74 MB is 0.03% of the
  // bytes, and "0.0%" next to an empty bar reads as a bug rather than a fact.
  const langs = Object.entries(profile.languages || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const bytes = langs.reduce((a, [, v]) => a + v, 0) || 1;
  const langBlock = langs.length
    ? `<div class="langs">${langs
        .map(([name, n]) => {
          const pct = (n / bytes) * 100;
          const text = pct > 0 && pct < 1 ? '&lt;1%' : `${pct.toFixed(0)}%`;
          const width = Math.min(100, Math.max(pct, 1.4)); // keep a real sliver visible
          return `<div class="lang">
            <span class="lang-name" title="${esc(name)}">${esc(name)}</span>
            <span class="lang-track"><span class="lang-fill" style="width:${width.toFixed(2)}%"></span></span>
            <span class="lang-pct">${text}</span>
          </div>`;
        })
        .join('')}</div>`
    : '<p class="resume-summary">No language bytes reported for this source.</p>';

  const deps = (profile.deps || []).slice(0, 30);
  const notable = (profile.notablePaths || []).slice(0, 30);
  const biggest = repos[0] ? repos[0].sizeKb || 0 : 1;

  // Every repo is listed with everything the source actually returned: dates,
  // counts, topics, license and the last commit. Missing fields are omitted
  // rather than filled in, so an incomplete API answer stays visible.
  const repoGrid = repos.length
    ? `<div class="repo-grid scroll-area tall">${repos
        .map((r) => {
          const facts = [];
          const fact = (label, value) => {
            if (value !== null && value !== undefined && value !== '') facts.push([label, value]);
          };
          if (r.stars) fact('stars', num(r.stars));
          if (r.forks) fact('forks', num(r.forks));
          fact('created', dateShort(r.createdAt));
          fact('pushed', r.pushedAt ? `${dateShort(r.pushedAt)} · ${ago(r.pushedAt)}` : null);
          if (r.commits != null) fact('commits', num(r.commits));
          if (r.openIssues) fact('issues', num(r.openIssues));
          fact('license', r.license);
          fact('branch', r.defaultBranch);
          return `<div class="repo${r.sampled ? ' repo-read' : ''}">
            <div class="repo-top">
              <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>
              <span class="repo-badges">
                ${r.sampled ? '<span class="pill pill-good">read in full</span>' : ''}
                ${r.archived ? '<span class="pill pill-warn">archived</span>' : ''}
                ${r.fork ? '<span class="pill pill-quiet">fork</span>' : ''}
              </span>
            </div>
            <p>${esc(r.description || '—')}</p>
            <div class="repo-size">
              <span class="lang-track"><span class="lang-fill" style="width:${Math.min(100, ((r.sizeKb || 0) / biggest) * 100).toFixed(1)}%"></span></span>
              <small>${esc(r.language || '—')} · ${num(r.sizeKb || 0)} KB</small>
            </div>
            ${facts.length ? `<div class="repo-meta">${facts
              .map(([label, value]) => `<span><b>${esc(label)}</b>${esc(value)}</span>`)
              .join('')}</div>` : ''}
            ${(r.topics || []).length ? `<div class="repo-topics">${r.topics
              .map((t) => `<span class="file">${esc(t)}</span>`)
              .join('')}</div>` : ''}
            ${r.lastCommitMessage ? `<div class="repo-commit">${r.lastCommitSha ? `<code>${esc(r.lastCommitSha)}</code>` : ''}<span>${esc(clipText(r.lastCommitMessage, 72))}</span></div>` : ''}
          </div>`;
        })
        .join('')}</div>`
    : '<p class="resume-summary">No project metadata was returned.</p>';

  const roleChips = (roles || [])
    .slice(0, 4)
    .map((r) => `<span class="skill-chip">${esc(r.title)} <b>${r.fit}%</b></span>`)
    .join('');
  const topSkillChips = [...skills]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10)
    .map((s) => `<span class="skill-chip">${esc(s.label)} <b>${Math.round((s.confidence || 0) * 100)}%</b></span>`)
    .join('');

  const sourceMeta = isProfile ? `${num(totalRepos)} public repos` : `${num(profile.fileCount || 0)} files`;
  const diagnostics = `
    <div class="diag-grid">
      <div class="diag"><b>Source</b><span>${isProfile ? 'GitHub profile' : 'GitHub repo'} · ${esc(profile.handle || profile.name)}</span></div>
      <div class="diag"><b>Deep read</b><span>${esc(sampled.length ? sampled.join(', ') : 'metadata only')}</span></div>
      <div class="diag"><b>Language bytes</b><span>${esc(langs.map(([n]) => n).join(', ') || 'none reported')}</span></div>
      <div class="diag"><b>Observed</b><span>${esc(sourceMeta)} · ${num(deps.length)} dependencies · ${num(notable.length)} notable files</span></div>
    </div>`;

  const identity = `
    <div class="profile-head">
      <div>
        <div class="profile-title">
          <a href="${esc(profile.url)}" target="_blank" rel="noopener">${esc(profile.name)}</a>
          ${profile.repo ? `<span class="dim"> / ${esc(profile.repo)}</span>` : ''}
        </div>
        ${profile.description || profile.bio ? `<p class="profile-desc">${esc(profile.description || profile.bio)}</p>` : ''}
      </div>
      <div class="facts">${facts.join('')}</div>
    </div>
    <div class="stat-grid">
      <div class="stat"><b>${num(totalRepos)}</b><span>public repos</span></div>
      <div class="stat"><b>${num(sampled.length)}</b><span>read in full</span></div>
      <div class="stat"><b>${num(profile.stars || 0)}</b><span>stars</span></div>
      <div class="stat"><b>${num(profile.followers || 0)}</b><span>followers</span></div>
    </div>`;

  const signal = `${verdict}
    <div class="skill-chips">${roleChips || '<span class="skill-chip">No role cleared the bar</span>'}</div>
    <div class="skill-chips" style="margin-top:.4rem">${topSkillChips || '<span class="skill-chip">No skill evidence</span>'}</div>`;

  const filesBlock = `${deps.length ? `<div class="tile-head"><span class="tile-label">Declared dependencies</span><span class="tile-meta">manifest</span></div>
      <div class="files">${deps.map((d) => `<span class="file">${esc(d)}</span>`).join('')}</div>` : ''}
    ${notable.length ? `<div class="tile-head" style="margin-top:.6rem"><span class="tile-label">Files that shaped the read</span><span class="tile-meta">${num(notable.length)}</span></div>
      <div class="files">${notable.map((p) => `<span class="file">${esc(p)}</span>`).join('')}</div>` : ''}`;

  $('#evidence').innerHTML = `<div class="dossier">
    ${tile('tile-id', `Identity // ${isProfile ? 'profile' : 'repository'}`, sourceMeta, identity)}
    ${tile('tile-signal', 'Best-fit signal', 'evidence only', signal)}
    ${tile('tile-langs', 'Language mix', 'committed bytes', langBlock)}
    ${tile('tile-skills', 'Skill evidence', `${groups.size} groups`, skillGroupsBlock(groups))}
    ${tile('tile-diagnostics', 'Diagnostics', `${(tookMs / 1000).toFixed(1)}s read`, diagnostics)}
    ${tile('tile-projects', 'Project registry', 'size → stars → recency', repoGrid)}
    ${tile('tile-files', 'Raw material', 'manifest + paths', filesBlock)}
  </div>`;
}

// A resume is evidence too, so it gets the same first slot: what I read, before
// anything else. Rendered from the parsed sections rather than the raw text so
// a reader can check the parse against what they sent.
function renderResumeEvidence({ skills, roles, tookMs, resume, resumeSource }) {
  const contact = resume?.contact || {};
  const facts = [];
  if (contact.email) facts.push(`<span class="pill">${esc(contact.email)}</span>`);
  if (contact.phone) facts.push(`<span class="pill">${esc(contact.phone)}</span>`);
  if (contact.location) facts.push(`<span class="pill">${esc(contact.location)}</span>`);
  for (const [kind, url] of Object.entries(contact.links || {})) {
    if (!url) continue;
    const href = /^https?:/i.test(url) ? url : `https://${url}`;
    facts.push(`<a class="pill" href="${esc(href)}" target="_blank" rel="noopener">${esc(kind)}</a>`);
  }

  $('#evidence-time').textContent = `${esc(resumeSource?.format?.toUpperCase() || 'file')} · ${num(
    resumeSource?.text?.length || 0
  )} characters · ${(tookMs / 1000).toFixed(1)}s`;

  const topRoles = (roles || []).slice(0, 2).map((r) => r.title);
  const topSkills = [...skills].sort((a, b) => b.confidence - a.confidence).slice(0, 4).map((s) => s.label);
  const verdict =
    (topRoles.length || topSkills.length) &&
    `<div class="verdict">
      ${
        topRoles.length
          ? `This resume reads as a <b>${topRoles.join('</b> or <b>')}</b>.`
          : 'This resume reads as general software work.'
      }
      ${
        topSkills.length
          ? `Strongest evidence: ${topSkills.map((l) => `<b>${esc(l)}</b>`).join(', ')}.`
          : ''
      }
      ${(resume?.experience?.length || resume?.projects?.length)
        ? `From ${resume.experience.length} role${resume.experience.length === 1 ? '' : 's'} and ${resume.projects.length} project${resume.projects.length === 1 ? '' : 's'} I recognised.`
        : 'I could not find an experience or projects section in it.'}
    </div>`;

  const when = (e) =>
    [e.start?.raw, e.end?.raw].filter(Boolean).join(' - ') ||
    (e.start?.iso ? e.start.iso.slice(0, 4) : '');

  const rolesBlock = (resume?.experience || []).length
    ? `<div class="timeline scroll-area tall">${resume.experience
        .map((e) => {
          if (e.kicker) {
            return `<div class="resume-note"><span class="pill pill-quiet">${esc(e.kicker)}</span> ${esc(
              e.bullets.join(' ')
            )}</div>`;
          }
          const org = e.org || e.location || '';
          return `<div class="tl-entry">
            <div class="tl-top">
              <span class="tl-title">${esc(e.title || org)}</span>
              <span class="tl-when">${esc(when(e))}</span>
            </div>
            ${e.org && e.title ? `<div class="tl-org">${esc(e.org)}${e.location ? ` · ${esc(e.location)}` : ''}</div>` : (e.location && !e.org ? `<div class="tl-org">${esc(e.location)}</div>` : '')}
            ${e.bullets.length ? `<ul class="tl-bullets">${e.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
          </div>`;
        })
        .join('')}</div>`
    : '<p class="resume-summary">No experience section was recognised. The raw text is still available through the export formats.</p>';

  const projectsBlock = (resume?.projects || []).length
    ? `<div class="repo-grid scroll-area tall">${resume.projects
        .map((p) => {
          const href = p.url ? (/^https?:/i.test(p.url) ? p.url : `https://${p.url}`) : null;
          return `<div class="repo">
            <div class="repo-top">
              ${href
                ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(p.name)}</a>`
                : `<span>${esc(p.name)}</span>`}
              ${p.url ? '<span class="pill pill-good">linked</span>' : ''}
            </div>
            ${p.description ? `<p>${esc(p.description)}</p>` : ''}
            ${(p.bullets || []).length ? `<ul class="repo-bullets">${p.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
            ${p.tech?.length ? `<div class="repo-topics">${p.tech.map((t) => `<span class="file">${esc(t)}</span>`).join('')}</div>` : ''}
          </div>`;
        })
        .join('')}</div>`
    : '<p class="resume-summary">No project section was recognised.</p>';

  const eduBlock = (resume?.education || []).length
    ? `<div class="resume-list scroll-area">${resume.education
        .map(
          (e) =>
            `<div class="resume-row"><div class="resume-when">${esc(
              e.start?.raw || ''
            )}</div><div><div class="resume-what"><b>${esc(e.type)}</b></div><div class="dim">${esc(
              [e.detail, e.school].filter(Boolean).join(' — ')
            )}</div></div></div>`
        )
        .join('')}</div>`
    : '<p class="resume-summary">No education section was recognised.</p>';

  const warnings = (resume?.warnings || []).length
    ? `<div class="resume-warn">${resume.warnings
        .slice(0, 8)
        .map((w) => `<div><code>${esc(typeof w === 'string' ? w : w.text || JSON.stringify(w))}</code></div>`)
        .join('')}</div>`
    : '<div class="diag"><b>Parse status</b><span>All major sections recognised.</span></div>';

  // Resume skills come from the score, which carries the same evidence shape as
  // a repo scan. When the parser also found explicit skill groups, show those
  // categories rather than flattening them into one anonymous list.
  const groups = new Map();
  for (const s of skills) {
    if (!groups.has(s.category)) groups.set(s.category, []);
    groups.get(s.category).push(s);
  }
  const parsedSkillGroups = (resume?.skills || []).length
    ? resume.skills.map((g) => `<div class="skill-group">
        <h3>${esc(g.category || 'Skills')}</h3>
        <div class="skill-chips">${g.items.map((item) => `<span class="skill-chip">${esc(item)}</span>`).join('')}</div>
      </div>`).join('')
    : '';
  const skillBlock = parsedSkillGroups
    ? `<div class="scroll-area tall">${parsedSkillGroups}</div>`
    : skillGroupsBlock(groups);
  // A resume with no skills section still produces scored skills. Calling that
  // "as stated" would be a lie, so name the tile for what it is: inference.
  const declaredSkills = resume?.skillItems?.length || 0;
  const skillTileTitle = declaredSkills ? 'Skills as stated' : 'Skills // inferred';
  const skillTileMeta = declaredSkills
    ? plural(declaredSkills, 'item', 'items')
    : plural((skills || []).length, 'signal', 'signals');

  const roleChips = (roles || [])
    .slice(0, 4)
    .map((r) => `<span class="skill-chip">${esc(r.title)} <b>${r.fit}%</b></span>`)
    .join('');
  const topSkillChips = [...skills]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10)
    .map((s) => `<span class="skill-chip">${esc(s.label)} <b>${Math.round((s.confidence || 0) * 100)}%</b></span>`)
    .join('');

  const identity = `
    <div class="profile-head">
      <div>
        <div class="profile-title">${esc(resume?.name || 'Your resume')}</div>
        ${resume?.headline ? `<p class="profile-desc">${esc(resume.headline)}</p>` : ''}
      </div>
      <div class="facts">${facts.join('')}</div>
    </div>
    ${resume?.summary ? `<p class="resume-summary" style="margin-top:.55rem">${esc(resume.summary)}</p>` : ''}
    <div class="stat-grid">
      <div class="stat"><b>${num(resume?.experience?.length || 0)}</b><span>roles</span></div>
      <div class="stat"><b>${num(resume?.projects?.length || 0)}</b><span>projects</span></div>
      <div class="stat"><b>${num(resume?.skillItems?.length || 0)}</b><span>declared skills</span></div>
      <div class="stat"><b>${num(resume?.education?.length || 0)}</b><span>education</span></div>
    </div>`;

  const signal = `${verdict}
    <div class="skill-chips">${roleChips || '<span class="skill-chip">No role cleared the bar</span>'}</div>
    <div class="skill-chips" style="margin-top:.4rem">${topSkillChips || '<span class="skill-chip">No skill evidence</span>'}</div>`;

  const diagnostics = `
    <div class="diag-grid">
      <div class="diag"><b>Source</b><span>${esc(resumeSource?.format?.toUpperCase() || 'file')} · ${num(resumeSource?.text?.length || 0)} characters</span></div>
      <div class="diag"><b>Extracted</b><span>${num(resume?.stats?.sections || 0)} sections · ${num(resume?.stats?.skills || 0)} skills · ${num(resume?.stats?.experience || 0)} roles · ${num(resume?.stats?.projects || 0)} projects</span></div>
      <div class="diag"><b>Read time</b><span>${(tookMs / 1000).toFixed(1)}s · parsed in this tab</span></div>
      <div class="diag ${(resume?.warnings || []).length ? 'warn' : ''}"><b>Warnings</b><span>${esc((resume?.warnings || []).length ? `${resume.warnings.length} section${resume.warnings.length === 1 ? '' : 's'} need attention` : 'none')}</span></div>
    </div>
    ${warnings}`;

  $('#evidence').innerHTML = `<div class="dossier">
    ${tile('tile-id', 'Identity // résumé', resumeSource?.format?.toUpperCase() || 'file', identity)}
    ${tile('tile-signal', 'Best-fit signal', 'evidence only', signal)}
    ${tile('tile-skills', skillTileTitle, skillTileMeta, skillBlock)}
    ${tile('tile-exp', 'Experience timeline', plural(resume?.experience?.length || 0, 'role', 'roles'), rolesBlock)}
    ${tile('tile-projects', 'Project registry', plural(resume?.projects?.length || 0, 'entry', 'entries'), projectsBlock)}
    ${tile('tile-diagnostics', 'Diagnostics', `${(tookMs / 1000).toFixed(1)}s`, diagnostics)}
    ${tile('tile-edu', 'Education & additional', plural(resume?.education?.length || 0, 'entry', 'entries'), eduBlock)}
  </div>`;
}

// ---------------------------------------------------------------- 2. roles
function renderRoles({ roles }) {
  if (!roles.length) {
    $('#roles').innerHTML = `<div class="empty">Nothing cleared the bar. The code I could read doesn't point at a common job title yet — that is a real answer, not a failure.</div>`;
    return;
  }
  $('#roles').innerHTML = roles
    .map(
      (r) => `<div class="role">
        <div class="role-top">
          <span class="role-title">${esc(r.title)}<small>${esc(r.family)}</small></span>
          <span class="fit">${r.fit}% <span class="score-label">fit</span></span>
        </div>
        <div class="fit-track"><div class="fit-fill" style="width:${r.fit}%"></div></div>
        <p class="role-blurb">${esc(r.blurb)}</p>
        <div class="tagline">
          <span class="pill ${VERDICT_PILL[r.verdict]}">${esc(r.verdict)}</span>
          <span class="pill pill-quiet">core skills ${r.coreFit}% covered</span>
          <span class="pill ${r.openingsNow ? 'pill-good' : 'pill-quiet'}">${r.openingsNow} live opening${r.openingsNow === 1 ? '' : 's'}</span>
          ${
            r.pay?.label
              ? `<span class="pill pill-pay" title="Aggregated from the ${r.pay.stating} of ${r.pay.openings} matching openings that state their own pay">${esc(r.pay.label)}</span>`
              : r.openingsNow
                ? '<span class="pill pill-quiet">no pay stated</span>'
                : ''
          }
        </div>
        <div class="tagline">
          ${r.matched.map((m) => `<span class="tag">${esc(m.label)}</span>`).join('')}
          ${r.gaps.map((g) => `<span class="tag tag-gap">no ${esc(g)}</span>`).join('')}
        </div>
        <ul class="why-list">
          ${r.matched
            .filter((m) => m.evidence)
            .slice(0, 4)
            .map((m) => `<li>${esc(m.label)} — <code>${esc(m.evidence)}</code></li>`)
            .join('')}
        </ul>
        ${
          r.bestOpenings?.length
            ? `<div class="job-actions" style="margin-top:.7rem">${r.bestOpenings
                .map(
                  (j) => `<a class="link" href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.title)} · ${esc(j.company || '—')}${j.wage ? ` · ${esc(j.wage.label)}` : ''} · ${j.match}% ↗</a>`
                )
                .join('')}</div>`
            : ''
        }
        <p class="role-blurb" style="margin-top:.6rem"><b>${esc(r.verdictCopy)}</b></p>
      </div>`
    )
    .join('');
}

// ----------------------------------------------------------------- location

// Say where the job actually is, in the words the posting used. A Seattle-area
// role earns a badge; a remote role says so; everything else stays quiet and
// falls back to the raw string the board gave us.
function geoBadge(j) {
  const g = j.geo || {};
  if (g.metro) {
    const where = g.city && g.city !== g.label ? g.city : g.label;
    return `<span class="pill pill-good" title="Lists a Seattle-area location">seattle area${where ? ` · ${esc(where)}` : ''}</span>`;
  }
  if (j.remote) return '<span class="pill pill-good">remote</span>';
  if (g.region) return `<span class="pill">${esc(g.regionName || g.region)}</span>`;
  if (g.countryName && g.countryName !== 'United States')
    return `<span class="pill pill-quiet" title="Outside the US">${esc(g.countryName)}</span>`;
  return `<span class="pill">${esc(j.location || 'location unknown')}</span>`;
}

function scopeLabelFor(id) {
  return (SCOPES[id] || SCOPES[DEFAULT_SCOPE]).label.toLowerCase();
}

// ----------------------------------------------------------------- 3. jobs
function renderJobs({ jobs, roles }) {
  const inScope = jobs.results.filter((j) => (SCOPES[$('#scope').value] || SCOPES[DEFAULT_SCOPE]).test(j)).length;
  $('#feed-status').textContent =
    `${num(jobs.scanned)} scanned · ${num(inScope)} ${scopeLabelFor($('#scope').value)} · ${jobs.count} above threshold`;

  const hideSenior = $('#realistic').checked;
  const remoteOnly = $('#remote').checked;
  const paidOnly = $('#paid').checked;
  const scopeId = $('#scope').value || DEFAULT_SCOPE;
  const scope = SCOPES[scopeId] || SCOPES[DEFAULT_SCOPE];
  $('#scope-hint').textContent = scope.hint;

  let list = jobs.results;
  list = list.filter((j) => scope.test(j));
  if (hideSenior) list = list.filter((j) => j.level !== 'senior' && j.level !== 'lead');
  if (remoteOnly) list = list.filter((j) => j.remote);
  if (paidOnly) list = list.filter((j) => j.wage);

  if (!list.length) {
    $('#jobs').innerHTML = `<div class="empty">No live opening crossed the bar with these filters on. That is what the data says — loosen the filter, or use the search links below, which reach boards these feeds don't.</div>`;
    return;
  }

  const roleTitle = new Map(roles.map((r) => [r.id, r.title]));

  $('#jobs').innerHTML = `<div class="jobs">${list
    .map((j) => {
      const gated = j.gates.length;
      const ask = j.matched.slice(0, 4).map((m) => esc(m.label)).join(', ');
      const wants = j.wants.slice(0, 3).map((w) => esc(w.label)).join(', ');
      const devGate = j.gates.find((g) => g.id === 'nondev');
      return `<article class="job">
        <div class="job-top">
          <div>
            <div class="job-title">${esc(j.title)}</div>
            <div class="job-company"><b>${esc(j.company || 'company not listed')}</b> · ${esc(roleTitle.get(j.role?.id) || 'general software')}</div>
          </div>
          <div class="job-score">
            <span class="score-big">${j.match}%</span>
            <span class="score-label">evidence</span>
            ${gated ? `<span class="score-big" style="color:var(--warn)">${j.realistic}%</span><span class="score-label">realistic</span>` : ''}
          </div>
        </div>
        <div class="job-meta">
          ${geoBadge(j)}
          ${j.wageLabel ? `<span class="pill pill-pay" title="Stated in the posting">${esc(j.wageLabel)}${j.wageUsd ? ` <span class="dim">≈ ${esc(j.wageUsd)}</span>` : ''}</span>` : '<span class="pill pill-quiet">pay not stated</span>'}
          ${j.level && j.level !== 'unspecified' ? `<span class="pill ${j.level === 'entry' ? 'pill-good' : j.level === 'unspecified' ? 'pill-quiet' : 'pill-warn'}">${esc(j.level)}</span>` : ''}
          <span class="sep">·</span><span>${esc(j.location || 'remote')}</span>
          <span class="sep">·</span><span>posted ${ago(j.publishedAt)}</span>
          ${j.alsoOn ? `<span class="sep">·</span><span>also on ${esc(j.alsoOn.join(', '))}</span>` : ''}
        </div>
        ${ask ? `<div class="job-why">Asks for <b>${ask}</b> — you have all of it.</div>` : ''}
        ${wants ? `<div class="job-why">Also wants <i>${wants}</i>, which your submission does not show.</div>` : ''}
        ${gated ? `<div class="job-why"><i>${devGate ? esc(devGate.text) : 'Gates you cannot show on GitHub'}:</i> ${esc(j.gates.filter((g) => !g.id || g.id !== 'nondev').map((g) => g.text).join('; ') || 'see above')}.</div>` : ''}
        <div class="job-actions">
          <a class="apply" href="${esc(j.url)}" target="_blank" rel="noopener">Open posting ↗</a>
          <a class="src" href="${esc(j.sourceUrl)}" target="_blank" rel="noopener">via ${esc(j.sourceName)}</a>
        </div>
      </article>`;
    })
    .join('')}</div>`;
}

// -------------------------------------------------------------- 4. searches
function renderSearch({ search }) {
  const where = whereForScope($('#scope').value);
  const aim = (item) => {
    const links = item.query ? boardLinks(item.query, { where }) : item.links;
    return links
      .map((l) => `<a class="link" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.name)} ↗</a>`)
      .join('');
  };
  const byRole = search.byRole
    .map(
      (r) => `<div class="search-block">
        <h3>${esc(r.title)} <span class="dim">· ${r.fit}% fit</span></h3>
        <div class="links">${aim(r)}</div>
      </div>`
    )
    .join('');
  const combos = search.combos
    .map(
      (c) => `<div class="search-block">
        <h3>Stack search: <code>${esc(c.query)}</code></h3>
        <div class="links">${aim(c)}</div>
      </div>`
    )
    .join('');
  $('#searches').innerHTML = byRole + combos;
}

if (typeof document !== 'undefined') mount();
