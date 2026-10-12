// The builder's rules, tested without a browser.
//
// Every case here is one that a person would hit in the first minute of using
// the editor: typing in a date field, deleting the last entry in a section,
// adding a contact. If a rule is wrong the export is wrong in ten formats at
// once, which is exactly why these are pinned down here rather than in the page.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseResume } from '../docs/lib/resume.js';
import { buildModel, exportResume } from '../docs/lib/resume-export.js';
import {
  addContact, addItem, addSection, cloneModel, editorTree, getAt, moveItem,
  moveSection, newItem, parseWhen, removeContact, removeItem, removeSection,
  setField,
} from '../docs/lib/resume-editor.js';

const SOURCE = `JANE Q. SAMPLE
jane.sample@example.com | (555) 010-1234 | github.com/sampleuser | Seattle, WA

SUMMARY
Engineer who builds offline tooling for edge devices.

EXPERIENCE
Engineer | Corp | Jan 2020 - Present
- Built the thing that mattered.
- Cut the p99 from 900ms to 120ms.

Designer | Studio | 2018 - 2020
- Shipped it.

PROJECTS
SecMesh
- Post-quantum mesh console.
- https://github.com/sampleuser/SecMesh

SKILLS
Languages: TypeScript, Go, Python
`;

const draft = () => cloneModel(buildModel(parseResume(SOURCE)));

test('the tree covers the whole model and nothing hangs off it', () => {
  const tree = editorTree(draft());
  assert.deepEqual(tree.meta.map((f) => f.label), ['Name', 'Headline', 'Summary']);
  assert.equal(tree.contacts.length, 4, 'email, phone, location and one link');
  assert.deepEqual(tree.sections.map((s) => s.kind), ['entries', 'entries', 'groups']);
  assert.deepEqual(tree.sections.map((s) => s.count), [2, 1, 1]);
  for (const field of tree.meta) assert.ok(field.value !== undefined);
});

test('every field path resolves to the value the tree shows', () => {
  // A path that points somewhere harmless is the failure mode here: the editor
  // would look right and silently drop every edit.
  const model = draft();
  const tree = editorTree(model);
  const paths = [
    ...tree.meta,
    ...tree.contacts.flatMap((c) => c.fields),
    ...tree.sections.flatMap((s) => s.items.flatMap((i) => i.fields)),
  ];
  assert.ok(paths.length > 20, `only ${paths.length} fields`);
  for (const field of paths) {
    const actual = getAt(model, field.path);
    assert.notEqual(actual, undefined, `${field.label}: ${field.path.join('.')} does not resolve`);
    const shown = field.kind === 'lines' && Array.isArray(actual) ? actual.join('\n') : actual ?? '';
    assert.equal(field.value, shown, `${field.label} shows something other than the model`);
  }
});

test('editing a name reaches all ten formats', async () => {
  const model = draft();
  setField(model, ['meta', 'name'], 'Ada Lovelace');
  for (const id of ['txt', 'md', 'html', 'html-ats', 'json', 'yaml', 'rtf', 'tex']) {
    const out = await exportResume(model, id);
    const text = new TextDecoder().decode(out.data);
    assert.match(text, /ada lovelace/i, `${id} did not pick up the new name`);
    assert.doesNotMatch(text, /Jane Q\. Sample/, `${id} still shows the old name`);
  }
});

test('editing dates updates the text and the JSON together', async () => {
  const model = draft();
  const tree = editorTree(model);
  const whenPath = tree.sections[0].items[0].fields.find((f) => f.field === 'when').path;
  setField(model, whenPath, 'Mar 2019 - Dec 2021');

  const entry = model.sections[0].entries[0];
  assert.equal(entry.when, 'Mar 2019 - Dec 2021');
  assert.deepEqual(entry.start, { raw: 'Mar 2019', iso: '2019-03' });
  assert.deepEqual(entry.end, { raw: 'Dec 2021', iso: '2021-12' });
  assert.equal(entry.current, false, 'a finished role is not current');

  // JSON Resume reads start/end, so it must agree with what the text says.
  const json = JSON.parse(new TextDecoder().decode((await exportResume(model, 'json')).data));
  assert.equal(json.work[0].startDate, '2019-03');
  assert.equal(json.work[0].endDate, '2021-12');
});

test('Present marks a role current and clears its end date', () => {
  assert.deepEqual(parseWhen('Jan 2020 - Present'), {
    when: 'Jan 2020 - Present',
    start: { raw: 'Jan 2020', iso: '2020-01' },
    end: null,
    current: true,
  });
  assert.equal(parseWhen('present').current, true);
  assert.equal(parseWhen('ongoing').current, true);
});

test('a lone year is not mistaken for a range', () => {
  // "2020-06" is one date. Splitting on the dash would produce a start of 2020
  // and an end of 06, which is worse than not understanding it at all.
  const when = parseWhen('2020-06');
  assert.equal(when.start.iso, '2020-06');
  assert.equal(when.end, null);
});

test('a date the parser cannot read is kept verbatim rather than guessed at', () => {
  const when = parseWhen('Summer of last year');
  assert.equal(when.start.raw, 'Summer of last year');
  assert.equal(when.start.iso, null);
});

test('clearing a date clears both halves', () => {
  const model = draft();
  setField(model, ['sections', 0, 'entries', 0, 'when'], '');
  assert.equal(model.sections[0].entries[0].start, null);
  assert.equal(model.sections[0].entries[0].end, null);
  assert.equal(model.sections[0].entries[0].current, false);
});

test('bullets are edited one per line', () => {
  const model = draft();
  setField(model, ['sections', 0, 'entries', 0, 'bullets'], 'First.\n\n  Second.  \nThird');
  assert.deepEqual(model.sections[0].entries[0].bullets, ['First.', 'Second.', 'Third']);
});

test('a skill line may be comma separated, because that is how people type it', () => {
  const model = draft();
  setField(model, ['sections', 2, 'groups', 0, 'items'], 'Rust, Zig\nElixir');
  assert.deepEqual(model.sections[2].groups[0].items, ['Rust', 'Zig', 'Elixir']);
});

test('an empty string becomes null for optional fields, not an empty line', () => {
  const model = draft();
  setField(model, ['sections', 0, 'entries', 0, 'where'], '');
  assert.equal(model.sections[0].entries[0].where, null);
  setField(model, ['sections', 1, 'entries', 0, 'url'], '');
  assert.equal(model.sections[1].entries[0].url, null);
  // A title is not optional the same way: blanking it leaves a blank string so
  // the field keeps its shape in the tree.
  setField(model, ['sections', 0, 'entries', 0, 'title'], '');
  assert.equal(model.sections[0].entries[0].title, '');
});

test('typing an address updates the link it labels', () => {
  const model = draft();
  setField(model, ['meta', 'contacts', 0, 'value'], 'ada@example.com');
  assert.equal(model.meta.contacts[0].href, 'mailto:ada@example.com');

  const link = model.meta.contacts.findIndex((c) => c.href && c.href.startsWith('http'));
  setField(model, ['meta', 'contacts', link, 'value'], 'example.org/ada');
  assert.equal(model.meta.contacts[link].href, 'https://example.org/ada');

  // A phone number is not a link, whatever is typed into it.
  const phone = model.meta.contacts.findIndex((c) => c.label === 'phone');
  setField(model, ['meta', 'contacts', phone, 'value'], '555 0100');
  assert.equal(model.meta.contacts[phone].href, null);
});

test('a project link becomes a real link in the docx', async () => {
  const model = draft();
  setField(model, ['sections', 1, 'entries', 0, 'url'], 'https://github.com/sampleuser/other');
  const out = await exportResume(model, 'docx');
  const { inflateRawSync } = await import('node:zlib');
  const buf = Buffer.from(out.data);
  let text = '';
  for (let p = 0; p + 30 <= buf.length; ) {
    if (buf.readUInt32LE(p) !== 0x04034b50) break;
    const method = buf.readUInt16LE(p + 8);
    const size = buf.readUInt32LE(p + 18);
    const nameLen = buf.readUInt16LE(p + 26);
    const extraLen = buf.readUInt16LE(p + 28);
    const name = buf.subarray(p + 30, p + 30 + nameLen).toString();
    const at = p + 30 + nameLen + extraLen;
    if (name === 'word/_rels/document.xml.rels') {
      text = method === 8
        ? inflateRawSync(buf.subarray(at, at + size)).toString()
        : buf.subarray(at, at + size).toString();
    }
    p = at + size;
  }
  assert.match(text, /https:\/\/github\.com\/sampleuser\/other/);
  assert.doesNotMatch(text, /SecMesh/, 'the old project link is gone');
});

test('deleting the last entry in a section deletes the section', () => {
  // An empty heading would have to mean something in ten formatters, and they
  // would not agree on what.
  const model = draft();
  removeItem(model, 2, 0);
  assert.equal(model.sections.length, 2);
  assert.ok(!model.sections.some((s) => s.kind === 'groups'));
});

test('entries move, and refuse to move off the end', () => {
  const model = draft();
  moveItem(model, 0, 1, -1);
  assert.equal(model.sections[0].entries[0].title, 'Designer');
  assert.equal(model.sections[0].entries[1].title, 'Engineer');
  moveItem(model, 0, 0, -1);
  assert.equal(model.sections[0].entries[0].title, 'Designer', 'a move past the start is a no-op');
  moveItem(model, 0, 1, 1);
  assert.equal(model.sections[0].entries[1].title, 'Engineer', 'a move past the end is a no-op');
});

test('sections move too', () => {
  const model = draft();
  moveSection(model, 0, 1);
  assert.deepEqual(model.sections.map((s) => s.title), ['Projects', 'Experience', 'Skills']);
  moveSection(model, 0, -1);
  assert.deepEqual(model.sections.map((s) => s.title), ['Projects', 'Experience', 'Skills'], 'a section cannot move before the first');
  moveSection(model, 1, -1);
  assert.deepEqual(model.sections.map((s) => s.title), ['Experience', 'Projects', 'Skills']);
});

test('new entries and sections are shaped for their kind', () => {
  assert.deepEqual(newItem('entries').bullets, []);
  assert.deepEqual(newItem('groups').items, []);
  const model = draft();
  addItem(model, 0, 'entries');
  assert.equal(model.sections[0].entries.length, 3);
  assert.equal(model.sections[0].entries[2].title, '');
  addSection(model, 'runs');
  const added = model.sections[model.sections.length - 1];
  assert.equal(added.kind, 'runs');
  assert.equal(added.runs.length, 1);
  // A new section has to render in the tree without a second pass of fixes.
  const tree = editorTree(model);
  for (const field of tree.sections[3].items[0].fields) {
    assert.notEqual(getAt(model, field.path), undefined, `${field.label} in a new section resolves`);
  }
});

test('a blank entry exports without breaking the format', async () => {
  const model = draft();
  addItem(model, 0, 'entries');
  for (const id of ['txt', 'html', 'json', 'yaml', 'rtf', 'tex', 'md', 'html-ats']) {
    const out = await exportResume(model, id);
    assert.ok(out.data.length > 100, `${id} produced almost nothing`);
  }
  // Binary writers are the ones that care about page geometry.
  const pdf = await exportResume(model, 'pdf');
  assert.ok(pdf.data.length > 500);
  const docx = await exportResume(model, 'docx');
  assert.ok(docx.data.length > 800);
});

test('contacts can be added and removed', () => {
  const model = draft();
  const before = model.meta.contacts.length;
  addContact(model);
  assert.equal(model.meta.contacts.length, before + 1);
  assert.equal(model.meta.contacts.at(-1).href, null, 'a blank contact has no link');
  removeContact(model, 0);
  assert.equal(model.meta.contacts.length, before);
  assert.ok(!model.meta.contacts.some((c) => c.label === 'email'));
});

test('a setField path that does not exist changes nothing', () => {
  const model = draft();
  const before = JSON.stringify(model);
  setField(model, ['sections', 99, 'entries', 0, 'title'], 'x');
  setField(model, ['nope', 'nothing'], 'x');
  setField(model, ['meta', 'contacts', 99, 'value'], 'x');
  assert.equal(JSON.stringify(model), before);
});

test('the draft is a copy: the parsed resume is never mutated', () => {
  const resume = parseResume(SOURCE);
  const model = buildModel(resume);
  const draftModel = cloneModel(model);
  setField(draftModel, ['meta', 'name'], 'Someone Else');
  addSection(draftModel, 'runs');
  assert.equal(model.meta.name, 'Jane Q. Sample');
  assert.equal(model.sections.length, 3);
  assert.equal(buildModel(resume).meta.name, 'Jane Q. Sample');
});
