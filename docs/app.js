import { analyze as runAnalyze, probe, isBrowserMode } from './api.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const num = (n) => Number(n || 0).toLocaleString();
const ago = (iso) => {
  if (!iso) return 'unknown date';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
};

const VERDICT_PILL = {
  strong: 'pill-good',
  likely: 'pill-good',
  stretch: 'pill-mid',
  reach: 'pill-warn',
};

let lastResult = null;

// Exported so the wiring can be exercised against a stub DOM in tests, and so
// nothing runs twice if the page is ever mounted again.
export function mount() {
  $('#form').addEventListener('submit', onSubmit);
  for (const chip of document.querySelectorAll('[data-fill]')) {
    chip.addEventListener('click', () => {
      $('#url').value = chip.dataset.fill;
      $('#form').requestSubmit();
    });
  }
  $('#realistic').addEventListener('change', () => lastResult && renderJobs(lastResult));
  $('#remote').addEventListener('change', () => lastResult && renderJobs(lastResult));
  $('#paid').addEventListener('change', () => lastResult && renderJobs(lastResult));

  // Health check on load so the page never lies about what's working. Picks the
  // backend once: the Node server when there is one, the in-browser engine when
  // the page is being served statically.
  probe()
    .then((feeds) => {
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
  const url = $('#url').value.trim();
  if (!url) return setStatus('err', 'Paste a link or a username first.');

  $('#go').disabled = true;
  setStatus('busy', `<span class="bar"></span>Reading the code, then pulling live openings…`);
  try {
    const data = await runAnalyze(url);
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
  $('#results').hidden = false;
  $('#foot-feeds').textContent = data.sources
    .map((s) => `${s.name} ${s.ok ? `(${s.count})` : `(down: ${esc(s.error || 'error')})`}`)
    .join(' · ');
  $('#foot-pay').textContent = data.fx
    ? `${data.fx.date} ECB rates`
    : 'no fx today — ranges shown in their own currency';
}

// ------------------------------------------------------------- 1. evidence
function renderEvidence({ profile, skills, tookMs }) {
  $('#evidence-time').textContent = `${num(profile.fileCount || profile.publicRepos || 0)} items read in ${(tookMs / 1000).toFixed(1)}s`;

  const langs = Object.entries(profile.languages || {}).sort((a, b) => b[1] - a[1]);
  const total = langs.reduce((a, [, v]) => a + v, 0) || 1;

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
  if (profile.sizeKb) facts.push(`<span class="pill">${num(profile.sizeKb)} KB</span>`);
  if (profile.tools?.bundler) facts.push(`<span class="pill">${esc(profile.tools.bundler)}</span>`);
  if (profile.tools?.test) facts.push(`<span class="pill">${esc(profile.tools.test)}</span>`);

  const notable = (profile.notablePaths || []).slice(0, 30);
  const deps = (profile.deps || []).slice(0, 30);

  $('#evidence').innerHTML = `
    <div class="profile-head">
      <div>
        <div class="profile-title">
          <a href="${esc(profile.url)}" target="_blank" rel="noopener">${esc(profile.name)}</a>
          ${profile.repo ? `<span class="dim"> / ${esc(profile.repo)}</span>` : ''}
        </div>
        <p class="profile-desc">${esc(profile.description || 'No description written. Fine — the code did the talking.')}</p>
      </div>
      <div class="facts">${facts.join('')}</div>
    </div>

    ${langs.length ? `<div class="langs">${langs
      .slice(0, 8)
      .map(([name, bytes]) => {
        const pct = (bytes / total) * 100;
        return `<div class="lang">
          <span class="lang-name" title="${esc(name)}">${esc(name)}</span>
          <span class="lang-track"><span class="lang-fill" style="width:${pct.toFixed(1)}%"></span></span>
          <span class="lang-pct">${pct.toFixed(0)}%</span>
        </div>`;
      })
      .join('')}</div>` : ''}

    <div class="skill-groups">
      ${[...groups.entries()]
        .map(([cat, items]) => {
          const name = cat.charAt(0).toUpperCase() + cat.slice(1);
          return `<div class="skill-group">
            <h3>${esc(name)}</h3>
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
          </div>`;
        })
        .join('')}
    </div>

    ${deps.length ? `<h3 style="margin:1.2rem 0 .5rem;font:600 .78rem/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--dim)">Manifests read</h3>
      <div class="files">${deps.map((d) => `<span class="file">${esc(d)}</span>`).join('')}</div>` : ''}

    ${notable.length ? `<h3 style="margin:1.2rem 0 .5rem;font:600 .78rem/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--dim)">Files that shaped the read</h3>
      <div class="files">${notable.map((p) => `<span class="file">${esc(p)}</span>`).join('')}</div>` : ''}

    ${profile.repos?.length
      ? `<h3 style="margin:1.2rem 0 .5rem;font:600 .78rem/1 var(--mono);letter-spacing:.12em;text-transform:uppercase;color:var(--dim)">Projects sampled</h3>
         <div class="repo-grid">${profile.repos
           .slice(0, 12)
           .map(
             (r) => `<div class="repo">
               <a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>
               <p>${esc(r.description || '—')}</p>
               <small>${esc(r.language || '—')} · ${num(r.sizeKb || 0)} KB · ${ago(r.pushedAt)}</small>
             </div>`
           )
           .join('')}</div>`
      : ''}
  `;
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

// ----------------------------------------------------------------- 3. jobs
function renderJobs({ jobs, roles }) {
  $('#feed-status').textContent = `${num(jobs.scanned)} scanned · ${jobs.count} above threshold`;

  const hideSenior = $('#realistic').checked;
  const remoteOnly = $('#remote').checked;
  const paidOnly = $('#paid').checked;
  let list = jobs.results;
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
          ${j.remote ? '<span class="pill pill-good">remote</span>' : `<span class="pill">${esc(j.location || 'location unknown')}</span>`}
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
  const byRole = search.byRole
    .map(
      (r) => `<div class="search-block">
        <h3>${esc(r.title)} <span class="dim">· ${r.fit}% fit</span></h3>
        <div class="links">${r.links.map((l) => `<a class="link" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.name)} ↗</a>`).join('')}</div>
      </div>`
    )
    .join('');
  const combos = search.combos
    .map(
      (c) => `<div class="search-block">
        <h3>Stack search: <code>${esc(c.query)}</code></h3>
        <div class="links">${c.links.map((l) => `<a class="link" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.name)} ↗</a>`).join('')}</div>
      </div>`
    )
    .join('');
  $('#searches').innerHTML = byRole + combos;
}

if (typeof document !== 'undefined') mount();
