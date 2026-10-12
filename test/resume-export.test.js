// Export tests. Everything here is offline and synthetic.
//
// The point of these is not "the file has bytes" -- it is that each format is
// something a real consumer can read: our own PDF and DOCX readers must get the
// text back out, the JSON must parse as JSON Resume, the RTF groups must balance,
// the HTML must not contain stray tags.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseResume } from '../docs/lib/resume.js';
import { buildModel, exportResume, FORMATS } from '../docs/lib/resume-export.js';
import { extractPdfText } from '../docs/lib/pdf.js';
import { extractDocxText } from '../docs/lib/docx.js';

// Unpack with node:zlib rather than the project's own reader, so a bug in
// zip.js and a bug in the docx writer cannot cancel each other out into a
// passing test.
async function unzip(bytes) {
  const { inflateRawSync } = await import('node:zlib');
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = new Map();
  const dec = new TextDecoder();
  const text = (start, len) => dec.decode(buf.subarray(start, start + len));
  for (let p = 0; p + 30 <= buf.length; ) {
    if (view.getUint32(p, true) !== 0x04034b50) break;
    const method = view.getUint16(p + 8, true);
    const size = view.getUint32(p + 18, true);
    const nameLen = view.getUint16(p + 26, true);
    const extraLen = view.getUint16(p + 28, true);
    const name = text(p + 30, nameLen);
    const at = p + 30 + nameLen + extraLen;
    out.set(name, method === 8 ? dec.decode(inflateRawSync(buf.subarray(at, at + size))) : text(at, size));
    p = at + size;
  }
  return out;
}

const RESUME_TEXT = `JANE Q. SAMPLE
jane.sample@example.com | (555) 010-1234 | github.com/sampleuser | Seattle, WA

SUMMARY
Sample engineer who builds offline tooling for edge devices and small teams.

EXPERIENCE
Staff Engineer
Sample Corp | Seattle, WA | Jan 2022 - Present
- Shipped the ingestion pipeline that cut batch time in half.
- Cut the build from nine minutes to forty seconds & kept it green.

PROJECTS
Sample Tool | github.com/sampleuser/sample-tool
A single-purpose utility that does one thing well.
- No dependencies, no network calls

EDUCATION
BSc Computer Science
State University | 2015 - 2019

SKILLS
Languages & Frameworks: Python, JavaScript, HTML/CSS
Systems: Docker, Git
`;

const resume = parseResume(RESUME_TEXT);
const model = buildModel(resume);
const dec = new TextDecoder();

const exported = {};
const exportAll = async () => {
  if (exported.done) return exported;
  for (const spec of FORMATS) exported[spec.id] = await exportResume(model, spec.id);
  exported.done = true;
  return exported;
};

// ------------------------------------------------------------------- model
test('the model carries the contact line, sections and entries', () => {
  assert.equal(model.meta.name, 'Jane Q. Sample');
  assert.equal(model.summary.includes('offline tooling'), true);
  const labels = model.meta.contacts.map((c) => c.label);
  for (const label of ['email', 'phone', 'location', 'github']) {
    assert.ok(labels.includes(label), `contact ${label} missing`);
  }
  const ids = model.sections.map((s) => s.id);
  assert.deepEqual(ids, ['experience', 'projects', 'education', 'skills']);
  const exp = model.sections[0].entries[0];
  assert.equal(exp.title, 'Staff Engineer');
  assert.equal(exp.subtitle, 'Sample Corp');
  assert.equal(exp.when, 'Jan 2022 - Present');
  assert.equal(exp.bullets.length, 2);
  assert.equal(model.sections[1].entries[0].url, 'https://github.com/sampleuser/sample-tool');
});

test('the summary is not printed twice as a headline', () => {
  assert.equal(model.meta.headline, null);
  const noSummary = buildModel(parseResume('JANE Q. SAMPLE\njane.sample@example.com'));
  assert.equal(noSummary.meta.headline, null, 'no summary means nothing to promote');
  const forced = buildModel(parseResume('JANE Q. SAMPLE\njane.sample@example.com'), { headline: 'Edge tooling engineer' });
  assert.equal(forced.meta.headline, 'Edge tooling engineer', 'an explicit headline is honoured');
});

test('a section the parser could not structure is still exported', () => {
  const withExtras = buildModel(
    parseResume(`JANE Q. SAMPLE
jane.sample@example.com

VOLUNTEER
Taught a Saturday robotics workshop.

CERTIFICATIONS
CPR & Food Handling
`)
  );
  const titles = withExtras.sections.map((s) => s.title);
  assert.ok(titles.includes('Volunteer'), `got ${titles.join(', ')}`);
  const volunteer = withExtras.sections.find((s) => s.title === 'Volunteer');
  assert.equal(volunteer.kind, 'runs');
  assert.match(volunteer.runs[0].items[0], /robotics/);
  // Certifications belong with education rather than in a pile of loose lines.
  assert.equal(withExtras.sections.find((s) => s.id === 'education').entries.length, 1);
  assert.equal(withExtras.sections.find((s) => s.id === 'education').entries[0].title, 'CPR & Food Handling');
});

// ------------------------------------------------------------------- every format
test('every advertised format produces bytes with the right name and type', async () => {
  const all = await exportAll();
  for (const spec of FORMATS) {
    const out = all[spec.id];
    assert.ok(out, `${spec.id} produced nothing`);
    assert.ok(out.data.length > 400, `${spec.id} is suspiciously small: ${out.data.length}`);
    assert.equal(out.mime, spec.mime);
    assert.ok(out.filename.endsWith(spec.ext), `${spec.id} filename ${out.filename} vs ${spec.ext}`);
    assert.match(out.filename, /^jane-q-sample/, `${spec.id} filename ${out.filename}`);
  }
});

test('an unknown format is rejected rather than silently producing text', async () => {
  await assert.rejects(() => exportResume(model, 'doc'), /unknown format/);
});

test('a resume can be exported from a model that was built once', async () => {
  const out = await exportResume(model, 'txt');
  assert.equal(out.text, (await exportAll()).txt.text, 'exporting from a model matches exporting from a resume');
});

// ------------------------------------------------------------------- pdf
test('the pdf is readable back, on every page, with its links intact', async () => {
  const out = await exportResume(model, 'pdf');
  const back = await extractPdfText(out.data);
  const text = back.text;
  assert.equal(back.pages >= 1, true);
  assert.match(text, /Jane Q\. Sample/);
  assert.match(text, /jane\.sample@example\.com/);
  assert.match(text, /Staff Engineer/);
  assert.match(text, /Shipped the ingestion pipeline/);
  assert.match(text, /State University/);
  assert.match(text, /Docker/);
  // The project link is a real annotation, not just text on the page.
  assert.match(dec.decode(out.data), /\/URI \(https:\/\/github\.com\/sampleuser\/sample-tool\)/);
});

test('the pdf escapes characters that would otherwise corrupt it', async () => {
  const tricky = buildModel(
    parseResume(`JANE Q. SAMPLE
jane.sample@example.com

EXPERIENCE
Engineer (C++) \\ Backend
Sample Corp | Jan 2020 - Present
- Halved p99 latency (from 900ms to 45ms) with a (clever) cache \\ rewrite.
`)
  );
  const out = await exportResume(tricky, 'pdf');
  const back = await extractPdfText(out.data);
  assert.match(back.text, /Halved p99 latency/);
  assert.match(back.text, /clever\) cache/, 'a closing paren survives');
  assert.equal(dec.decode(out.data).includes('\\'), true, 'backslashes are escaped in the content stream');
});

test('the pdf page count grows with the content', async () => {
  const long = buildModel({
    name: 'Jane Q. Sample',
    contact: {},
    experience: Array.from({ length: 40 }, (_, i) => ({
      title: `Role number ${i + 1}`,
      org: 'Some Employer',
      start: { raw: 'Jan 2020' },
      end: { raw: 'Jan 2021' },
      bullets: ['A line of achievement text long enough to fill a good part of the column.'],
    })),
    projects: [],
    education: [],
    skills: [],
    sections: [],
  });
  const out = await exportResume(long, 'pdf');
  const back = await extractPdfText(out.data);
  assert.ok(back.pages > 1, `expected more than one page, got ${back.pages}`);
  assert.match(back.text, /Role number 40/);
});

// ------------------------------------------------------------------- docx
test('the docx is a real office package that reads back with its links', async () => {
  const out = await exportResume(model, 'docx');
  // Zip signature, then the part Word requires to open it.
  assert.deepEqual([...out.data.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const back = await extractDocxText(out.data);
  assert.match(back.text, /Jane Q\. Sample/);
  assert.match(back.text, /Staff Engineer/);
  assert.match(back.text, /Sample Tool/);
  const rels = dec.decode(out.data);
  assert.match(rels, /word\/_rels\/document\.xml\.rels/);
  assert.match(rels, /Target="https:\/\/github\.com\/sampleuser\/sample-tool"[^>]*TargetMode="External"/);
});

test('the docx escapes xml and drops characters wordprocessingml forbids', async () => {
  const tricky = buildModel(
    parseResume(`JANE Q. SAMPLE
jane.sample@example.com

EXPERIENCE
Engineer <Web> & "Systems"
Sample Corp | Jan 2020 - Present
- Fixed a <div> bug in a > comparison & kept the API stable.
`)
  );
  const out = await exportResume(tricky, 'docx');
  const xml = dec.decode(out.data);
  assert.ok(!/<w:t[^>]*>[^<]*<(?!\/?w:)/.test(xml), 'no raw angle brackets inside a text run');
  const back = await extractDocxText(out.data);
  assert.match(back.text, /Engineer <Web> & "Systems"/);
  assert.match(back.text, /Fixed a <div> bug/);
});

// ------------------------------------------------------------------- text
test('plain text keeps every field and adds no markup', async () => {
  const out = await exportResume(model, 'txt');
  const text = out.text;
  assert.match(text, /JANE Q\. SAMPLE/);
  assert.match(text, /jane\.sample@example\.com {2}\| {2}\(555\) 010-1234/);
  assert.match(text, /EXPERIENCE/);
  assert.match(text, /Staff Engineer, Sample Corp/);
  assert.match(text, /Jan 2022 - Present/);
  assert.match(text, /  - Shipped the ingestion pipeline/);
  assert.equal(text.split('Sample Corp').length - 1, 1, 'the employer is named once, not on two lines');
  assert.match(text, /Languages & Frameworks: Python, JavaScript, HTML\/CSS/);
  assert.ok(!/[<>{}]/.test(text), 'no markup leaks into the plain text version');
  assert.ok(!/\n{3,}/.test(text), 'no runs of blank lines');
});

test('markdown is valid enough to render and links are real', async () => {
  const out = await exportResume(model, 'md');
  assert.match(out.text, /^# Jane Q\. Sample$/m);
  assert.match(out.text, /^## Experience$/m);
  assert.match(out.text, /^### Staff Engineer — Sample Corp _\(Jan 2022 - Present\)_$/m);
  assert.match(out.text, /^- Shipped the ingestion pipeline/m);
  assert.match(out.text, /\[github\.com\/sampleuser\]\(https:\/\/github\.com\/sampleuser\)/);
});

test('rtf groups balance and keep the space between runs', async () => {
  const out = await exportResume(model, 'rtf');
  const text = out.text;
  assert.match(text, /^\{\\rtf1/);
  let depth = 0;
  for (const ch of text) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    assert.ok(depth >= 0, 'a group closes before it opens');
  }
  assert.equal(depth, 0, 'every rtf group is closed');
  // A single space after a control word is eaten as a delimiter, so the
  // separator between the bold title and the sub run needs two.
  assert.match(text, /\\b Staff Engineer\{\\i0\\b0\\cf2\\fs20 {2}Sample Corp\}/);
  assert.match(text, /\\u8226\?/, 'bullets are unicode escapes, not literal backslashes');
  assert.ok(!/\\\\u/.test(text), 'no double-escaped control sequences');
});

// ------------------------------------------------------------------- html
test('styled html is self-contained and prints cleanly', async () => {
  const out = await exportResume(model, 'html');
  const html = out.text;
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<style>/);
  assert.ok(!/<script/i.test(html), 'no script in an exported resume');
  assert.ok(!/https?:\/\/[^"']*\.css/.test(html), 'no external stylesheet');
  assert.match(html, /@page/);
  assert.match(html, /@media print/);
  assert.match(html, /<a href="https:\/\/github\.com\/sampleuser\/sample-tool"/);
  const opens = (html.match(/<div/g) || []).length;
  const closes = (html.match(/<\/div>/g) || []).length;
  assert.equal(opens, closes, 'divs balance');
});

test('the ats html drops the layout tricks that break parsers', async () => {
  const out = await exportResume(model, 'html-ats');
  const html = out.text;
  assert.ok(!html.includes('<table'), 'no tables');
  assert.ok(!html.includes('display: flex'), 'no flexbox');
  assert.ok(!html.includes('float:'), 'no floats');
  assert.ok(!html.includes('position: absolute'), 'no absolute positioning');
  assert.match(html, /Staff Engineer/);
  assert.match(html, /Shipped the ingestion pipeline/);
});

test('html escapes the five characters that would break a page', async () => {
  const tricky = buildModel(
    parseResume(`Jane Q. Sample <QA>
jane@example.com

EXPERIENCE
Engineer & "Specialist"
Sample <Corp> | Jan 2020 - Present
- Compared a<b and c>d before shipping.
`)
  );
  const out = await exportResume(tricky, 'html');
  assert.match(out.text, /Jane Q\. Sample &lt;QA&gt;/);
  assert.match(out.text, /Engineer &amp; &quot;Specialist&quot;/);
  assert.ok(!/<title>[^<]*<QA>/.test(out.text), 'the title is escaped too');
});

// ------------------------------------------------------------------- structured
test('json resume parses and has the shape importers expect', async () => {
  const out = await exportResume(model, 'json');
  const data = JSON.parse(out.text);
  assert.equal(data.$schema, 'https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json');
  assert.equal(data.basics.name, 'Jane Q. Sample');
  assert.equal(data.basics.email, 'jane.sample@example.com');
  assert.equal(data.basics.phone, '(555) 010-1234');
  assert.deepEqual(data.basics.location, { city: 'Seattle', region: 'WA' });
  assert.equal(data.basics.summary, model.summary);
  assert.deepEqual(
    data.basics.profiles.map((p) => p.network),
    ['github']
  );
  assert.equal(data.basics.profiles[0].url, 'https://github.com/sampleuser');
  assert.equal(data.basics.profiles[0].username, 'sampleuser');
  assert.equal(data.work.length, 1);
  assert.equal(data.work[0].position, 'Staff Engineer');
  assert.equal(data.work[0].name, 'Sample Corp');
  assert.equal(data.work[0].highlights.length, 2);
  assert.equal(data.work[0].startDate, '2022-01');
  assert.equal(data.work[0].endDate, null, 'a current role has no end date');
  assert.equal(data.projects[0].name, 'Sample Tool');
  assert.equal(data.projects[0].url, 'https://github.com/sampleuser/sample-tool');
  assert.equal(data.education[0].institution, 'State University');
  assert.equal(data.education[0].endDate, '2019-01');
  assert.deepEqual(
    data.skills.map((s) => s.name),
    ['Languages & Frameworks', 'Systems']
  );
});

test('yaml is valid, quoted and free of tabs', async () => {
  const out = await exportResume(model, 'yaml');
  const yaml = out.text;
  assert.ok(!yaml.includes('\t'), 'no tabs');
  const lines = yaml.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  for (const line of lines) {
    const indent = line.length - line.trimStart().length;
    assert.equal(indent % 2, 0, `odd indent: ${line}`);
  }
  assert.match(yaml, /^basics:$/m);
  assert.match(yaml, /^ {2}name: Jane Q\. Sample$/m);
  assert.match(yaml, /^ {2}email: jane\.sample@example\.com$/m);
  assert.match(yaml, /^ {2}summary: /m);
  assert.match(yaml, /^work:$/m);
  assert.match(yaml, /^ {2}- position: Staff Engineer$/m);
  assert.match(yaml, /^ {4}name: Sample Corp$/m);
  assert.match(yaml, /^skills:$/m);
  assert.match(yaml, /^ {4}keywords: \[Python, JavaScript, HTML\/CSS\]$/m);
  // A value that YAML would read as something else has to be quoted.
  // A sentence has to be quoted: plain scalars cannot contain ": " and a value
  // that starts with a digit would be read as a number.
  assert.match(yaml, /^ {2}summary: Sample engineer who builds offline tooling for edge devices and small teams\.$/m);
  assert.match(yaml, /^ {6}url: 'https:\/\/github\.com\/sampleuser'$/m);
  // "position: X name: Y" parses as one scalar, and a sequence at the same
  // indent as its key is not YAML at all.
  for (const line of yaml.split('\n')) {
    assert.ok((line.match(/(^|\s)\w+:/g) || []).length <= 1, `two keys on one line: ${line}`);
  }
  assert.match(yaml, /^ {4}startDate: '2022-01'$/m);
  assert.match(yaml, /^ {4}highlights:$/m);
  assert.match(yaml, /^ {6}- Shipped the ingestion pipeline that cut batch time in half\.$/m);
});

test('latex nests its environments and escapes the specials', async () => {
  const out = await exportResume(model, 'tex');
  const tex = out.text;
  assert.equal((tex.match(/\{/g) || []).length - (tex.match(/\}/g) || []).length, 0, 'braces balance');
  const envs = [...tex.matchAll(/\\(begin|end)\{(\w+\*?)\}/g)].map((m) => `${m[1]}:${m[2]}`);
  const stack = [];
  for (const env of envs) {
    const [kind, name] = env.split(':');
    if (kind === 'begin') stack.push(name);
    else assert.equal(stack.pop(), name, `\\end{${name}} closes the wrong environment`);
  }
  assert.deepEqual(stack, [], 'no environment is left open');
  assert.match(tex, /\\begin\{document\}[\s\S]*\\end\{document\}/);
  assert.match(tex, /\\section\*\{Experience\}/);
  assert.match(tex, /\\href\{https:\/\/github\.com\/sampleuser\/sample-tool\}/);
  const body = tex.slice(tex.indexOf('\\begin{document}'));
  const unescaped = body.match(/(?<!\\)[#&]/g) || [];
  assert.deepEqual(unescaped, [], 'no unescaped # or & in the body');
});

// The bug this guards against: a link in the document whose r:id has no
// matching entry in document.xml.rels renders as plain text and looks fine, so
// nothing else in the suite notices.
test('every docx hyperlink r:id resolves to a relationship', async () => {
  const out = await exportResume(model, 'docx');
  const files = await unzip(out.data);
  const doc = files.get('word/document.xml');
  const rels = files.get('word/_rels/document.xml.rels');
  assert.ok(doc && rels, 'the docx has a document and its relationships part');

  const used = [...doc.matchAll(/<w:hyperlink r:id="([^"]+)"/g)].map((m) => m[1]);
  // One for the github handle in the contact line, one for the project link.
  assert.equal(used.length, 2, `expected the contact and project links, found ${used.length}`);
  const declared = new Set([...rels.matchAll(/<Relationship Id="([^"]+)"/g)].map((m) => m[1]));
  for (const id of used) {
    assert.ok(declared.has(id), `${id} is used in the document but not declared`);
  }
  // And nothing declared that the document never points at.
  for (const id of declared) {
    assert.ok(used.includes(id), `${id} is declared but unused`);
  }
  // rId numbering starts at 1 in this part and never reuses a number.
  assert.deepEqual(used, [...new Set(used)], 'ids are unique');
  assert.ok(!used.includes('rId0'), 'rId0 is never a real relationship');
});

test('the docx declares each link target once, with the URL intact', async () => {
  const files = await unzip((await exportResume(model, 'docx')).data);
  const rels = files.get('word/_rels/document.xml.rels');
  const targets = [...rels.matchAll(/Target="([^"]+)"[^>]*TargetMode="External"/g)].map((m) => m[1]);
  assert.ok(targets.every((t) => /^https?:\/\//.test(t)), `a target is not a URL: ${targets}`);
  assert.equal(new Set(targets).size, targets.length, 'no duplicate targets');
  const project = targets.find((t) => /github\.com/.test(t));
  assert.ok(project, `the repository link is missing from the docx: ${targets.join(' ')}`);
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(rels), 'the URL is not raw-ampersanded into the XML');
});
