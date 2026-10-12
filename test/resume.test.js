import test from 'node:test';
import assert from 'node:assert/strict';
import { parseResume, resumeRepoClaims, resumeToProfile } from '../docs/lib/resume.js';
import { extractPdfText } from '../docs/lib/pdf.js';
import { extractDocxText } from '../docs/lib/docx.js';

// Fixtures are synthetic. Real resumes never enter the repository: this repo is
// public and the parser is tested on the layouts that broke, not on one
// person's data. "Jane Q. Sample" and "Sample Corp" exist to be forgettable.

// ---------------------------------------------------------------- experience
// Layout A: title line, then "Org | Dates", then bulleted achievements.
const BLOCK = `JANE Q. SAMPLE
jane.sample@example.com | (555) 010-1234 | github.com/sampleuser

SUMMARY
Sample engineer who builds offline tooling.

EXPERIENCE
Staff Engineer
Sample Corp | Jan 2022 - Present
- Shipped the ingestion pipeline that cut batch time in half.
- Owned the on-call rotation for three services.

Team Lead
Widget Labs | Mar 2019 - Dec 2021
- Managed a team of four.

SKILLS
Languages & Frameworks: Python, JavaScript (vanilla + Node.js), HTML/CSS
Other: Git, Docker (selected projects)

PROJECTS
Sample Tool | github.com/sampleuser/sample-tool
A single-purpose utility that does one thing well, with a documented CLI.

EDUCATION
BSc Computer Science
State University | 2015 - 2019
`;

// Layout B: everything on one line, blurb after an em dash.
const INLINE = `JANE Q. SAMPLE
jane.sample@example.com | (555) 010-1234 | github.com/sampleuser

EXPERIENCE
Paid Tutor | Seattle | 2025-Present - Tutored working engineers on local models.
Shift Manager | Grocery Co | Sept 2023-Jan 2026 - City-wide coverage. Led teams,
scheduling, and inventory.
Earlier roles: Dishwasher, Prep Cook, Maintenance, etc.
`;

// Layout C: "City | Dates" must not be mistaken for an employer.
const PLACE_VS_ORG = `JANE Q. SAMPLE
jane.sample@example.com

EXPERIENCE
Paid Tutor
Seattle | 2025 - Present
Shift Manager
Grocery Co | Sept 2023 - Jan 2026
`;

test('block layout reads title, employer, dates and bullets', () => {
  const r = parseResume(BLOCK);
  assert.equal(r.name, 'Jane Q. Sample');
  assert.equal(r.experience.length, 2);

  const [first] = r.experience;
  assert.equal(first.title, 'Staff Engineer');
  assert.equal(first.org, 'Sample Corp');
  assert.equal(first.start.raw, 'Jan 2022');
  assert.equal(first.end.raw, 'Present');
  assert.equal(first.current, true);
  assert.equal(first.bullets.length, 2);
  assert.match(first.bullets[0], /^Shipped the ingestion pipeline/);
});

test('a wrapped bullet keeps its count instead of splitting mid-sentence', () => {
  const r = parseResume(BLOCK);
  assert.equal(r.experience[1].bullets.length, 1);
  assert.equal(r.experience[1].bullets[0], 'Managed a team of four.');
});

test('one-line layout pulls the blurb off the date line', () => {
  const r = parseResume(INLINE);
  const tutor = r.experience.find((e) => e.title === 'Paid Tutor');
  assert.ok(tutor, 'tutor entry exists');
  assert.equal(tutor.location, 'Seattle');
  assert.equal(tutor.end.raw, 'Present');
  assert.match(tutor.bullets.join(' '), /Tutored working engineers/);

  const shift = r.experience.find((e) => e.title === 'Shift Manager');
  assert.equal(shift.org, 'Grocery Co');
  assert.match(shift.bullets.join(' '), /City-wide coverage/);
  assert.match(shift.bullets.join(' '), /inventory/);
});

test('"Earlier roles:" is a footnote, not a job with a 60 character title', () => {
  const r = parseResume(INLINE);
  const note = r.experience.find((e) => e.kicker);
  assert.ok(note, 'kicker entry exists');
  assert.equal(note.kicker, 'Earlier roles');
  assert.equal(note.title, null);
  assert.equal(r.experience.length, 3);
  assert.ok(
    r.experience.every((e) => (e.title || '').length < 70),
    'no entry grew a sentence as its title',
  );
});

test('a city and an employer have identical shapes but opposite meanings', () => {
  const r = parseResume(PLACE_VS_ORG);
  const [tutor, shift] = r.experience;
  assert.equal(tutor.title, 'Paid Tutor');
  assert.equal(tutor.org, null, 'Seattle is a location, not an employer');
  assert.equal(tutor.location, 'Seattle');
  assert.equal(shift.title, 'Shift Manager');
  assert.equal(shift.org, 'Grocery Co');
});

test('a blank line inside a wrapped bullet is not an entry boundary', () => {
  const wrapped = `JANE Q. SAMPLE
jane.sample@example.com

EXPERIENCE
Shift Manager | Grocery Co | Sept 2023-Jan 2026 - City-wide coverage. Led teams on
high-volume

shifts, and coached new hires.

SKILLS
`;
  const r = parseResume(wrapped);
  assert.equal(r.experience.length, 1);
  assert.match(r.experience[0].bullets.join(' '), /coached new hires\./);
});

// ------------------------------------------------------------------ projects
test('"Name | url" plus a wrapped description keeps url and prose apart', () => {
  const r = parseResume(BLOCK);
  assert.equal(r.projects.length, 1);
  assert.equal(r.projects[0].name, 'Sample Tool');
  assert.equal(r.projects[0].url, 'github.com/sampleuser/sample-tool');
  assert.match(r.projects[0].description, /single-purpose utility/);
});

test('"Name (url) - blurb" splits on the sentence, not on the dash in the name', () => {
  const text = `JANE Q. SAMPLE
jane.sample@example.com

PROJECTS
Sample - Offline Tools (github.com/sampleuser/sample) — An offline workspace with
editors, live preview and local model support.
Bare - Harness - A plug-and-play cluster built from low cost hardware.
`;
  const r = parseResume(text);
  const first = r.projects[0];
  assert.equal(first.name, 'Sample - Offline Tools');
  assert.equal(first.url, 'github.com/sampleuser/sample');
  assert.match(first.description, /^An offline workspace/);

  const second = r.projects[1];
  assert.equal(second.name, 'Bare - Harness');
  assert.match(second.description, /^A plug-and-play cluster/);
});

test('a url on its own continuation line is attached to the entry above it', () => {
  const text = `JANE Q. SAMPLE
jane.sample@example.com

PROJECTS
Sample Tool
github.com/sampleuser/sample-tool
Python pipeline for extreme compression.
`;
  const r = parseResume(text);
  assert.equal(r.projects[0].name, 'Sample Tool');
  assert.equal(r.projects[0].url, 'github.com/sampleuser/sample-tool');
  assert.match(r.projects[0].description, /Python pipeline/);
});

test('a word split across a physical line break is rejoined', () => {
  const text = `JANE Q. SAMPLE
jane.sample@example.com

PROJECTS
Replacer | github.com/sampleuser/replacer — Offline workspace with a Repl-
style editor and live preview.
`;
  const r = parseResume(text);
  assert.equal(r.projects[0].name, 'Replacer');
  assert.match(r.projects[0].description, /Repl-style editor/);
});

test('a bullet run under a sub-heading is a list, not a fake project', () => {
  const text = `JANE Q. SAMPLE
jane.sample@example.com

PROJECTS
Sample Tool | github.com/sampleuser/sample-tool
Does the one thing.
Others: GameEngine (voxel/shaders) • Physics sims • VoidScream
`;
  const r = parseResume(text);
  const run = r.projects.find((p) => p.name === 'Others');
  assert.ok(run, 'run entry exists');
  assert.deepEqual(run.bullets, ['GameEngine (voxel/shaders)', 'Physics sims', 'VoidScream']);
  assert.ok(
    !r.projects.some((p) => p.name === 'Physics sims'),
    'individual run items are not promoted to projects',
  );
});

// ----------------------------------------------------------------- education
test('labelled education lines and a dangling-word wrap stay separate entries', () => {
  const text = `JANE Q. SAMPLE
jane.sample@example.com

EDUCATION & ADDITIONAL
Programming Coursework: Python, C/C++, JavaScript
Languages: English (primary), German (conversational); introductory studies in
French, Spanish
`;
  const r = parseResume(text);
  assert.equal(r.education.length, 2);
  assert.equal(r.education[0].type, 'Programming Coursework');
  assert.equal(r.education[1].type, 'Languages');
  assert.match(r.education[1].detail, /French, Spanish$/);
});

test('a bullet run carrying its own labels is three logical entries', () => {
  const text = `JANE Q. SAMPLE
jane.sample@example.com

EDUCATION & ADDITIONAL
Programming coursework: Python, C/C++ • Languages: English, German + intro studies
in several others • CPR & Food Handling (current)
`;
  const r = parseResume(text);
  assert.deepEqual(
    r.education.map((e) => e.type),
    ['Programming coursework', 'Languages', 'Certifications'],
  );
});

test('an unlabelled certification is inferred rather than filed as a degree', () => {
  const text = `JANE Q. SAMPLE
jane.sample@example.com

EDUCATION
Languages: English
CPR & Food Handling (current)
`;
  const r = parseResume(text);
  assert.equal(r.education.length, 2);
  assert.equal(r.education[1].type, 'Certifications');
});

test('a degree line followed by its school and dates is one entry', () => {
  const r = parseResume(BLOCK);
  assert.equal(r.education.length, 1);
  const degree = r.education[0];
  assert.equal(degree.detail, 'BSc Computer Science');
  assert.equal(degree.school, 'State University');
  assert.equal(degree.start.raw, '2015');
  assert.equal(degree.end.raw, '2019');
});

// -------------------------------------------------------------------- skills
test('skill groups survive commas inside parentheses and bracket depth', () => {
  const r = parseResume(BLOCK);
  const groups = Object.fromEntries(r.skills.map((g) => [g.category, g.items]));
  assert.deepEqual(groups['Languages & Frameworks'], [
    'Python',
    'JavaScript (vanilla + Node.js)',
    'HTML/CSS',
  ]);
  assert.deepEqual(groups.Other, ['Git', 'Docker (selected projects)']);
});

// ------------------------------------------------------------------- contact
test('contact details and links are pulled from the header line', () => {
  const r = parseResume(BLOCK);
  assert.equal(r.contact.email, 'jane.sample@example.com');
  assert.equal(r.contact.phone, '(555) 010-1234');
  assert.equal(r.contact.links.github, 'github.com/sampleuser');
});

// ------------------------------------------------------------------- exports
test('repo claims are harvested from project urls', () => {
  const claims = resumeRepoClaims(parseResume(BLOCK));
  assert.equal(claims.length, 1);
  assert.equal(claims[0].owner, 'sampleuser');
  assert.equal(claims[0].repo, 'sample-tool');
  assert.ok(claims[0].sources.length);
});

test('a resume converts into the profile shape the app already renders', () => {
  const profile = resumeToProfile(parseResume(BLOCK));
  assert.ok(profile.fromResume, 'flagged as resume-derived');
  assert.ok(profile.topics.includes('python'), 'skills carried into topics');
  assert.ok(Object.keys(profile.languages).includes('Python'), 'a mentioned language is weighted');
  assert.ok(profile.languages.Python > 0, 'with non-zero weight');
  assert.ok(profile.files.includes('Sample Tool'), 'projects carried over');
});

test('a resume with no recognisable headings still yields a name and sections', () => {
  const r = parseResume('Jane Q. Sample\njane.sample@example.com\n\nJust some prose.');
  assert.equal(r.name, 'Jane Q. Sample');
  assert.ok(Array.isArray(r.experience));
  assert.ok(Array.isArray(r.projects));
});

// ------------------------------------------------------------------ extractors
// A minimal, uncompressed PDF. Enough to prove the object scan, content-stream
// tokenizer and line reconstruction work without shipping a real document.
function buildPdf(lines) {
  const ops = lines
    .map((line, i) => `BT /F1 12 Tf 72 ${720 - i * 16} Td (${line.replace(/[()\\]/g, '\\$&')}) Tj ET`)
    .join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

test('the pdf extractor pulls text out of an uncompressed content stream', async () => {
  const bytes = buildPdf(['JANE Q. SAMPLE', 'Staff Engineer', 'Sample Corp']);
  const out = await extractPdfText(bytes);
  assert.equal(out.hasText, true);
  assert.equal(out.pages, 1);
  assert.match(out.text, /JANE Q\. SAMPLE/);
  assert.match(out.text, /Staff Engineer/);
  // Vertical order must survive: the name is above the job.
  assert.ok(out.text.indexOf('JANE') < out.text.indexOf('Staff'));
});

test('a pdf with no objects reports a reason instead of throwing', async () => {
  const out = await extractPdfText(new TextEncoder().encode('not a pdf at all'));
  assert.equal(out.hasText, false);
  assert.ok(out.reason);
});

test('a non-docx zip reports a reason instead of throwing', async () => {
  const out = await extractDocxText(new TextEncoder().encode('PK nothing here'));
  assert.equal(out.hasText, false);
  assert.ok(out.reason);
});

// ------------------------------------------------------------ resume upload
// The upload path runs entirely on the page, so it is exercised here the same
// way a browser would: a real File handed to the real handler.
const RESUME_TEXT = `JANE Q. SAMPLE
jane.sample@example.com | (555) 010-1234 | github.com/sampleuser

SUMMARY
Sample engineer who builds offline tooling.

EXPERIENCE
Staff Engineer
Sample Corp | Jan 2022 - Present
- Shipped the ingestion pipeline that cut batch time in half.

SKILLS
Languages & Frameworks: Python, JavaScript, HTML/CSS

PROJECTS
Sample Tool | github.com/sampleuser/sample-tool
A single-purpose utility that does one thing well.

EDUCATION
BSc Computer Science
State University | 2015 - 2019
`;

test('the shared reader takes a File and returns a parsed resume', async () => {
  const { readResume } = await import('../docs/lib/resume-source.js');
  const file = new File([RESUME_TEXT], 'resume.txt', { type: 'text/plain' });
  const read = await readResume(file);
  assert.equal(read.format, 'txt');
  assert.equal(read.name, 'resume.txt');
  assert.equal(read.resume.name, 'Jane Q. Sample');
  assert.equal(read.claims.length, 1);
  assert.equal(read.profile.fromResume, true);
});

test('a pdf is detected by its bytes even when the name says otherwise', async () => {
  const { readResume } = await import('../docs/lib/resume-source.js');
  const bytes = buildPdf(['JANE Q. SAMPLE', 'Staff Engineer']);
  const read = await readResume(new File([bytes], 'not-really-a-pdf.txt'));
  assert.equal(read.format, 'pdf');
  assert.match(read.text, /Staff Engineer/);
});

test('an unreadable file explains itself instead of failing blank', async () => {
  const { readResume, readError } = await import('../docs/lib/resume-source.js');
  const read = await readResume(new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])], 'old.doc'));
  assert.equal(read.resume, null);
  assert.match(readError(read), /not supported/i);
});

test('the evidence card renders the resume sections, not the raw text', async () => {
  const { makeDom, stubResponse } = await import('./helpers/dom.js');
  const dom = makeDom();
  globalThis.document = dom.document;
  const realFetch = globalThis.fetch;
  const payload = { ok: true, sources: [{ name: 'fixture', ok: true, count: 3 }] };
  globalThis.fetch = async (url) =>
    stubResponse(String(url).endsWith('/api/health') ? payload : payload);

  try {
    const { mount } = await import('../docs/app.js');
    mount();
    await new Promise((r) => setTimeout(r, 25));

    const file = new File([RESUME_TEXT], 'resume.txt', { type: 'text/plain' });
    dom.get('#resume').files = [file];
    dom.get('#form-resume').fire('submit', { preventDefault() {} });
    // The feed fetch and the render are both async.
    for (let i = 0; i < 60 && !dom.get('#evidence').innerHTML.includes('resume'); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }

    const html = dom.get('#evidence').innerHTML;
    assert.match(html, /Jane Q\. Sample/, 'name rendered');
    assert.match(html, /jane\.sample@example\.com/, 'contact rendered');
    assert.match(html, /Staff Engineer/, 'experience rendered');
    assert.match(html, /Sample Tool/, 'projects rendered');
    assert.match(html, /State University/, 'education rendered');
    assert.match(html, /<a[^>]*href="https:\/\/github\.com\/sampleuser/, 'github link is clickable');
    assert.ok(!/^\s*JANE Q\. SAMPLE\s*$/m.test(html), 'raw name line is not dumped into the page');
    assert.equal(dom.get('#results').hidden, false, 'results revealed');
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.document;
  }
});

test('the export panel offers every format and builds one on click', async () => {
  const { makeDom, stubResponse } = await import('./helpers/dom.js');
  const dom = makeDom();
  globalThis.document = dom.document;
  const realFetch = globalThis.fetch;
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  const payload = { ok: true, sources: [{ name: 'fixture', ok: true, count: 3 }] };
  globalThis.fetch = async () => stubResponse(JSON.stringify(payload));
  const downloads = [];
  URL.createObjectURL = (blob) => {
    downloads.push(blob);
    return 'blob:stub';
  };
  URL.revokeObjectURL = () => {};

  try {
    const { mount } = await import('../docs/app.js');
    mount();
    await new Promise((r) => setTimeout(r, 25));

    dom.get('#resume').files = [new File([RESUME_TEXT], 'resume.txt', { type: 'text/plain' })];
    dom.get('#form-resume').fire('submit', { preventDefault() {} });
    // Wait for the buttons, not for the hidden flag: the stub element has no
    // `hidden` attribute, so that would resolve before anything rendered.
    for (let i = 0; i < 80 && !dom.get('#export').innerHTML.includes('export-btn'); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }

    assert.equal(dom.get('#export-section').hidden, false, 'the export card is revealed for a resume');
    const html = dom.get('#export').innerHTML;
    const { FORMATS } = await import('../docs/lib/resume-export.js');
    for (const spec of FORMATS) {
      assert.match(html, new RegExp(`data-format="${spec.id}"`), `no button for ${spec.id}`);
    }
    assert.equal((html.match(/class="export-btn"/g) || []).length, FORMATS.length, 'one button per format');

    // The stub does not parse innerHTML, so the clicked button is stood in for
    // with the attributes the delegated handler reads.
    const clicked = dom.get('.export-btn');
    clicked.dataset.format = 'pdf';
    dom.get('#export').fire('click', { target: clicked });
    for (let i = 0; i < 60 && !downloads.length; i++) await new Promise((r) => setTimeout(r, 50));

    assert.equal(downloads.length, 1, 'clicking a format produces exactly one file');
    assert.ok(downloads[0].size > 400, `the file is empty: ${downloads[0].size}`);
    assert.equal(downloads[0].type, 'application/pdf');
    assert.deepEqual([...new Uint8Array(await downloads[0].arrayBuffer()).slice(0, 5)], [0x25, 0x50, 0x44, 0x46, 0x2d]);
    assert.match(dom.get('#status').innerHTML, /wrote/i, 'the status line reports what was written');
  } finally {
    globalThis.fetch = realFetch;
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
    delete globalThis.document;
  }
});
