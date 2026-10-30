// Print previews for the export deck.
//
// A resume source previews the exact semantic model that feeds all ten export
// formats. A GitHub profile has no parsed document yet, so it produces a draft
// model from the evidence: a real summary, real skills, and real repositories.
// Nothing invents employment or education, but the draft is exportable and can
// be completed later by reading a document.

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const bare = (url) => String(url || '').replace(/^https?:\/\//i, '').replace(/\/$/, '');
const href = (url) => (/^https?:\/\//i.test(url) ? url : `https://${bare(url)}`);
const cap = (s) => String(s || '').replace(/^./, (c) => c.toUpperCase());
const trimEnd = (s) => String(s || '').trim().replace(/[.\s]+$/, '');
const sentence = (s) => {
  const value = String(s || '').trim();
  if (!value) return '';
  return /[.!?]$/.test(value) ? value : `${value}.`;
};

function dateOnly(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function clip(text, max = 90) {
  const value = String(text || '').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function contactLine(contacts) {
  return contacts
    .map((c) => (c.href ? `<a href="${esc(c.href)}" target="_blank" rel="noopener">${esc(c.value)}</a>` : esc(c.value)))
    .join('<span class="paper-sep">·</span>');
}

function entry(e) {
  const left = [e.subtitle, e.where].filter(Boolean).join(' · ');
  return `<div class="paper-entry">
    <div class="paper-entry-head">
      <div class="paper-entry-main">
        <span class="paper-entry-title">${esc(e.title)}</span>
        ${left ? `<span class="paper-entry-sub">${esc(left)}</span>` : ''}
      </div>
      ${e.when ? `<span class="paper-entry-when">${esc(e.when)}</span>` : ''}
    </div>
    ${e.url ? `<a class="paper-entry-url" href="${esc(e.url)}" target="_blank" rel="noopener">${esc(bare(e.url))}</a>` : ''}
    ${e.note ? `<p class="paper-note">${esc(e.note)}</p>` : ''}
    ${(e.bullets || []).length ? `<ul>${e.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

function sectionBody(section) {
  if (section.kind === 'entries') return section.entries.map(entry).join('');
  if (section.kind === 'groups') {
    // A group label identical to the section heading ("Skills" under SKILLS)
    // repeats what the heading already said; the items are still all printed.
    const same = (label) => String(label || '').trim().toLowerCase() === String(section.title || '').trim().toLowerCase();
    return section.groups
      .map(
        (g) =>
          `<div class="paper-group">${g.label && !same(g.label) ? `<b>${esc(g.label)}</b>` : ''}<span>${g.items
            .map(esc)
            .join(', ')}</span></div>`
      )
      .join('');
  }
  return section.runs
    .map((run) =>
      run.label
        ? `<div class="paper-group"><b>${esc(run.label)}</b><span>${run.items.map(esc).join(', ')}</span></div>`
        : run.items.map((item) => `<p class="paper-run">${esc(item)}</p>`).join('')
    )
    .join('');
}

// The sheet mirrors buildModel(): same name, contacts, summary and section
// order that the PDF, DOCX, HTML and flat formats receive.
export function resumePreview(model) {
  const parts = [];
  parts.push(`<article class="paper" id="export-preview" aria-label="${model.draft ? 'Draft resume print preview' : 'Resume print preview'}">`);
  parts.push(
    `<div class="paper-mark"><span>${model.draft ? 'Working draft // public evidence' : 'Document preview'}</span><span>${
      model.sections.length
    } section${model.sections.length === 1 ? '' : 's'}</span></div>`
  );
  parts.push('<header class="paper-head">');
  parts.push(`<h1>${esc(model.meta.name)}</h1>`);
  if (model.meta.headline) parts.push(`<p class="paper-headline">${esc(model.meta.headline)}</p>`);
  if (model.meta.contacts.length) parts.push(`<p class="paper-contact">${contactLine(model.meta.contacts)}</p>`);
  parts.push('</header>');
  if (model.draft) {
    parts.push(
      '<p class="paper-draft-note">Draft built from public repository evidence. Target roles and skills are inferred; experience and education are not included.</p>'
    );
  }
  if (model.summary) parts.push(`<section class="paper-section"><h2>Summary</h2><p>${esc(model.summary)}</p></section>`);
  for (const section of model.sections) {
    parts.push(
      `<section class="paper-section"><h2>${esc(section.title)}</h2>${sectionBody(section)}</section>`
    );
  }
  parts.push('</article>');
  return parts.join('');
}

function profileContact(profile) {
  const contacts = [];
  const seen = new Set();
  const add = (label, value, link = null) => {
    const key = bare(value).toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    contacts.push({ label, value: bare(value), href: link });
  };
  if (profile.location) add('location', profile.location, null);
  for (const url of [profile.url, profile.blog, ...(profile.links || [])]) {
    if (!url) continue;
    // A repo summary includes a README link as evidence, not as a contact.
    if (/\/readme\.md$/i.test(String(url))) continue;
    const lower = String(url).toLowerCase();
    const label = lower.includes('github.com')
      ? 'github'
      : lower.includes('linkedin.com')
        ? 'linkedin'
        : lower.includes('x.com') || lower.includes('twitter.com')
          ? 'x'
          : 'website';
    add(label, url, href(url));
  }
  return contacts;
}

// A summary built only from facts the profile actually carries. The role and
// skill lines are marked as inference in their sections, and the prose says
// "reads as" rather than claiming a job title the person has held.
export function profileSummary({ profile = {}, roles = [], skills = [] } = {}) {
  const parts = [];
  const bio = sentence(profile.description || profile.bio || '');
  if (bio) parts.push(bio);

  const roleNames = roles.slice(0, 2).map((r) => r.title).filter(Boolean);
  const topSkills = [...skills]
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
    .slice(0, 4)
    .map((s) => s.label)
    .filter(Boolean);
  if (roleNames.length) {
    parts.push(
      `Public work reads as ${roleNames.join(' or ')}${topSkills.length ? `, with strongest evidence in ${topSkills.join(', ')}` : ''}.`
    );
  } else if (topSkills.length) {
    parts.push(`Strongest evidence: ${topSkills.join(', ')}.`);
  }

  const repos = profile.repos || [];
  const langs = Object.entries(profile.languages || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);
  if (repos.length) {
    const sampled = (profile.sampledRepos || []).length;
    parts.push(
      `The evidence spans ${repos.length} public repositor${repos.length === 1 ? 'y' : 'ies'}${
        sampled && sampled < repos.length ? `, ${sampled} read in full` : ''
      }${langs.length ? `, primarily ${langs.join(' and ')}` : ''}.`
    );
  }

  const recent = [...repos]
    .filter((r) => r.pushedAt || r.lastCommit)
    .sort((a, b) => String(b.lastCommit || b.pushedAt).localeCompare(String(a.lastCommit || a.pushedAt)))[0];
  if (recent) {
    const when = recent.lastCommit
      ? `last commit ${dateOnly(recent.lastCommit)}`
      : recent.pushedAt
        ? `last push ${dateOnly(recent.pushedAt)}`
        : '';
    parts.push(
      `Most recent work is ${recent.name}${recent.description ? ` — ${trimEnd(recent.description)}` : ''}${
        when ? `, ${when}` : ''
      }.`
    );
  }

  return parts.join(' ') || 'Working draft built from public repository evidence.';
}

function repoEntry(repo) {
  const facts = [];
  const created = dateOnly(repo.createdAt);
  if (created) facts.push(`created ${created}`);
  if (repo.sizeKb) facts.push(`${Number(repo.sizeKb).toLocaleString()} KB`);
  if (repo.stars) facts.push(`${repo.stars} star${repo.stars === 1 ? '' : 's'}`);
  if (repo.forks) facts.push(`${repo.forks} fork${repo.forks === 1 ? '' : 's'}`);
  if (repo.commits != null) facts.push(`${Number(repo.commits).toLocaleString()} commits`);
  if (repo.license) facts.push(repo.license);
  if (repo.fork) facts.push('fork');
  if (repo.archived) facts.push('archived');

  const bullets = [];
  if (facts.length) bullets.push(facts.join(' · '));
  if ((repo.topics || []).length) bullets.push(`Topics: ${repo.topics.join(', ')}`);
  if (repo.lastCommitMessage) {
    bullets.push(
      `Last commit${repo.lastCommitSha ? ` ${repo.lastCommitSha}` : ''}${
        repo.lastCommit ? ` ${dateOnly(repo.lastCommit)}` : ''
      }: ${clip(repo.lastCommitMessage)}`
    );
  }

  return {
    title: repo.name,
    subtitle: repo.language || null,
    when: repo.pushedAt ? `pushed ${dateOnly(repo.pushedAt)}` : repo.lastCommit ? `committed ${dateOnly(repo.lastCommit)}` : null,
    where: null,
    url: repo.url || null,
    note: repo.description || null,
    bullets,
  };
}

// A complete model for the evidence that exists, not a placeholder. It can be
// exported today and improved later by adding a parsed document.
export function draftModel(data = {}) {
  const { profile = {}, roles = [], skills = [] } = data;
  const name = profile.realName || profile.name || profile.handle || 'Candidate';
  const sections = [];

  const roleItems = roles
    .slice(0, 6)
    .map((r) => `${r.title}${Number.isFinite(r.fit) ? ` — ${r.fit}% fit` : ''}`)
    .filter(Boolean);
  if (roleItems.length) {
    sections.push({
      id: 'roles',
      title: 'Target roles (inferred)',
      kind: 'groups',
      groups: [{ label: '', items: roleItems }],
    });
  }

  const groups = new Map();
  for (const skill of [...skills].sort((a, b) => (b.confidence || 0) - (a.confidence || 0))) {
    const category = skill.category || 'signal';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(skill.label);
  }
  if (groups.size) {
    sections.push({
      id: 'skills',
      title: 'Skills (inferred from code)',
      kind: 'groups',
      groups: [...groups].map(([label, items]) => ({ label: cap(label), items })),
    });
  }

  const projects = (profile.repos || []).map(repoEntry);
  if (projects.length) {
    sections.push({ id: 'projects', title: 'Public repositories', kind: 'entries', entries: projects });
  }

  return {
    meta: { name, headline: null, contacts: profileContact(profile) },
    summary: profileSummary(data),
    sections,
    draft: true,
    generatedBy: 'JobWall',
  };
}

// A compact list of what is actually in the export, used beside the sheet.
export function manifestRows(rows) {
  return rows
    .map(
      ([label, value]) =>
        `<div class="manifest-row"><span>${esc(label)}</span><b>${esc(value)}</b></div>`
    )
    .join('');
}
