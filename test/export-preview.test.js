import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, exportResume, FORMATS } from '../docs/lib/resume-export.js';
import { resumePreview, draftModel, profileSummary, manifestRows } from '../docs/lib/export-preview.js';

const RESUME = {
  name: 'JANE Q. SAMPLE',
  contact: {
    email: 'jane.sample@example.com',
    phone: '(555) 010-1234',
    location: 'Seattle, WA',
    links: { github: 'github.com/sampleuser' },
  },
  summary: 'Sample engineer who builds offline tooling.',
  experience: [
    {
      title: 'Staff Engineer',
      org: 'Sample Corp',
      location: 'Seattle, WA',
      start: { raw: 'Jan 2022', iso: '2022-01' },
      end: null,
      current: true,
      bullets: ['Built the ingestion pipeline.', 'Cut read time in half.'],
    },
  ],
  projects: [{ name: 'Sample Tool', description: 'A tiny utility with a documented CLI.', bullets: [], tech: ['TypeScript'] }],
  education: [
    { school: 'State University', detail: 'B.S. Computer Science', type: 'degree', start: { raw: '2014' }, end: null, bullets: [] },
  ],
  skills: [{ category: 'Languages', items: ['Python', 'TypeScript'] }],
  skillItems: ['Python', 'TypeScript'],
};

const PROFILE = {
  profile: {
    name: 'Sample User',
    handle: 'sampleuser',
    url: 'https://github.com/sampleuser',
    description: 'Builds small tools.',
    repoTotal: 4,
    sampledRepos: ['sample-tool'],
    languages: { Rust: 40_000, JavaScript: 8_000 },
    repos: [
      {
        name: 'sample-tool',
        description: 'A utility.',
        url: 'https://github.com/sampleuser/sample-tool',
        language: 'Rust',
        stars: 12,
        forks: 3,
        sizeKb: 40,
        createdAt: '2024-02-03T00:00:00Z',
        pushedAt: '2026-09-01T00:00:00Z',
        commits: 1_204,
        topics: ['cli', 'tooling'],
        license: 'MIT',
        defaultBranch: 'main',
        lastCommit: '2026-09-01T12:00:00Z',
        lastCommitMessage: 'Harden the parser against nested groups',
        lastCommitSha: 'abc1234',
        sampled: true,
      },
      {
        name: 'other-tool',
        description: '',
        url: 'https://github.com/sampleuser/other-tool',
        language: 'JavaScript',
        sizeKb: 8,
        createdAt: '2025-01-01T00:00:00Z',
        pushedAt: '2025-06-01T00:00:00Z',
        sampled: false,
      },
    ],
  },
  roles: [
    { title: 'Systems / Network Engineer', fit: 61 },
    { title: 'Backend Engineer', fit: 44 },
  ],
  skills: [
    { label: 'Rust', category: 'language', confidence: 0.72 },
    { label: 'Docker', category: 'tool', confidence: 0.4 },
  ],
};

test('a resume preview shows the exact model the exports are built from', () => {
  const html = resumePreview(buildModel(RESUME));
  assert.match(html, /id="export-preview"/);
  assert.match(html, /JANE Q\. SAMPLE/);
  assert.match(html, /Sample engineer who builds offline tooling/);
  assert.match(html, /Staff Engineer/);
  assert.match(html, /Sample Corp/);
  assert.match(html, /Built the ingestion pipeline/);
  assert.match(html, /Sample Tool/);
  assert.match(html, /State University/);
  assert.match(html, /Python, TypeScript/);
  assert.match(html, /github\.com\/sampleuser/);
});

test('the preview escapes content instead of injecting it', () => {
  const html = resumePreview(
    buildModel({
      ...RESUME,
      name: '<script>alert(1)</script>',
      projects: [{ name: '"><img src=x onerror=alert(2)>', description: null, bullets: [] }],
    })
  );
  assert.ok(!html.includes('<script>'), 'a name cannot open a script tag');
  assert.ok(!html.includes('<img src=x'), 'a project name cannot open an image tag');
  assert.match(html, /&lt;script&gt;/);
});

test('a profile becomes a writable draft instead of a not-a-resume sheet', () => {
  const model = draftModel(PROFILE);
  const html = resumePreview(model);
  assert.match(html, /id="export-preview"/);
  assert.match(html, /Sample User/);
  assert.match(html, /Builds small tools/);
  assert.match(html, /Target roles \(inferred\)/);
  assert.match(html, /Working draft \/\/ public evidence/);
  assert.match(html, /Draft built from public repository evidence/);
  assert.match(html, /Systems \/ Network Engineer — 61% fit/);
  assert.match(html, /Skills \(inferred from code\)/);
  assert.match(html, /Rust/);
  assert.match(html, /Public repositories/);
  assert.ok(!/not a résumé/i.test(html), 'the draft is presented as a resume draft');
  assert.ok(!/<h2>Experience<\/h2>/.test(html), 'no experience section is invented');
  assert.ok(!/<h2>Education/i.test(html), 'no education section is invented');
});

test('the draft summarises only what the evidence supports', () => {
  const summary = profileSummary({
    ...PROFILE,
    profile: {
      ...PROFILE.profile,
      repos: [{ name: 'sample-tool', description: 'A utility.', pushedAt: '2026-09-01T00:00:00Z' }],
    },
  });
  assert.match(summary, /Builds small tools/);
  assert.match(summary, /reads as Systems \/ Network Engineer or Backend Engineer/);
  assert.match(summary, /strongest evidence in Rust/);
  assert.match(summary, /sample-tool/);
  assert.match(summary, /last push 2026-09-01/);
});

test('repo cards in the draft keep dates, commit counts and the last commit', () => {
  const html = resumePreview(draftModel(PROFILE));
  assert.match(html, /created 2024-02-03/);
  assert.match(html, /pushed 2026-09-01/);
  assert.match(html, /1,204 commits/);
  assert.match(html, /MIT/);
  assert.match(html, /Topics: cli, tooling/);
  assert.match(html, /Last commit abc1234 2026-09-01: Harden the parser against nested groups/);
  assert.match(html, /abc1234/);
  assert.match(html, /12 stars/);
  assert.match(html, /3 forks/);
});

test('a draft exports in every format', async () => {
  const model = draftModel(PROFILE);
  for (const format of FORMATS) {
    const out = await exportResume(model, format.id);
    assert.ok(out.data.length > 0, `${format.id} produced bytes`);
    assert.match(out.filename, /\./, `${format.id} produced a filename`);
  }
});

test('manifest rows count what the export contains', () => {
  const html = manifestRows([['experience', '3 entries'], ['contact', '2 details']]);
  assert.match(html, /experience/);
  assert.match(html, /3 entries/);
  assert.match(html, /contact/);
  assert.match(html, /2 details/);
});

test('the export deck previews and exports a profile without a resume upload', async () => {
  const { makeDom, stubResponse } = await import('./helpers/dom.js');
  const dom = makeDom();
  globalThis.document = dom.document;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => stubResponse(JSON.stringify({ sources: [] }));
  try {
    const { renderExport } = await import('../docs/app.js');
    // Importing the app auto-mounts it and starts a feed probe; let that settle
    // before the test removes the stub document.
    await new Promise((r) => setTimeout(r, 25));
    renderExport(PROFILE);
    assert.equal(dom.get('#export-section').hidden, false, 'the export deck opens for a profile');
    assert.equal(dom.get('#export-empty').hidden, true);
    const html = dom.get('#export').innerHTML;
    assert.match(html, /id="export-preview"/);
    assert.match(html, /Target roles \(inferred\)/);
    assert.match(html, /Print \/ Save PDF/);
    assert.match(html, /Draft \/\/ evidence only/);
    assert.equal(
      (html.match(/class="export-btn"/g) || []).length,
      FORMATS.length,
      'every resume format is downloadable from the draft'
    );
    assert.ok(!/Résumé formats \/\/ locked/.test(html), 'the formats are not locked');

    const realWindow = globalThis.window;
    let printed = 0;
    globalThis.window = { print: () => { printed += 1; } };
    try {
      dom.get('#export').fire('click', {
        target: { closest: (sel) => (sel === '.print-preview' ? {} : null) },
      });
      assert.equal(printed, 1, 'the sheet opens the browser print dialog');
    } finally {
      if (realWindow === undefined) delete globalThis.window;
      else globalThis.window = realWindow;
    }
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.document;
  }
});
