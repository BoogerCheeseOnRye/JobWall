// The builder: editing the semantic model, not the file that produced it.
//
// Every export format is rendered from the model, so an edit here shows up in
// all ten at once. That is the whole reason this module works on the model and
// not on the parser's output: there is one source of truth and no re-parse.
//
// Nothing in here touches the DOM. The fields are described as data
// (`editorTree`) and applied by path (`setField`), so the editing rules -- what
// happens when a date string changes, what a blank entry looks like, what
// happens when a contact is deleted -- are testable without a browser, and the
// page is left with nothing but markup and event wiring.
//
// Paths are arrays of keys, e.g. ['sections', 0, 'entries', 2, 'bullets'].
// They survive JSON, which is what lets a <input> carry its own address in a
// data-path attribute.

// Fields that mean "not stated" when blank. An empty string would print as an
// empty line in half the formats, which reads as a formatting mistake rather
// than an omission.
const OPTIONAL = new Set(['where', 'url', 'note', 'subtitle', 'headline']);

const ITEM_FIELD = {
  // label: the field name, kind: how the input behaves, hint: placeholder text.
  entries: [
    { label: 'Title', field: 'title', kind: 'text', hint: 'Engineer' },
    { label: 'Organisation', field: 'subtitle', kind: 'text', hint: 'Corp' },
    { label: 'Dates', field: 'when', kind: 'when', hint: 'Jan 2020 - Present' },
    { label: 'Location', field: 'where', kind: 'text', hint: 'Seattle, WA' },
    { label: 'Link', field: 'url', kind: 'url', hint: 'https://github.com/you/thing' },
    { label: 'Note', field: 'note', kind: 'text', rows: 2, hint: 'One sentence of context' },
    { label: 'Bullets', field: 'bullets', kind: 'lines', hint: 'One achievement per line' },
  ],
  groups: [
    { label: 'Group', field: 'label', kind: 'text', hint: 'Languages' },
    { label: 'Items', field: 'items', kind: 'lines', hint: 'One skill per line, or comma separated' },
  ],
  runs: [
    { label: 'Group', field: 'label', kind: 'text', hint: 'Leave blank for a plain list' },
    { label: 'Items', field: 'items', kind: 'lines', hint: 'One line per line' },
  ],
};

export const SECTIONS_FOR_KIND = { entries: 'entries', groups: 'groups', runs: 'runs' };

// A skill group reads better as one line of comma separated skills than as a
// list of one-item rows, and that is what the parser produces, so the default
// is a blank group rather than a blank item.
export function newItem(kind) {
  if (kind === 'groups') return { label: '', items: [] };
  if (kind === 'runs') return { label: '', items: [] };
  return {
    title: '',
    subtitle: '',
    when: '',
    where: null,
    url: null,
    note: null,
    start: null,
    end: null,
    current: false,
    bullets: [],
  };
}

export function newSection(kind = 'runs', title) {
  const id = `${kind}-${Math.random().toString(36).slice(2, 8)}`;
  return { id, title: title || kind.replace(/s$/, ''), kind, [SECTIONS_FOR_KIND[kind]]: [newItem(kind)] };
}

export function cloneModel(model) {
  return typeof structuredClone === 'function'
    ? structuredClone(model)
    : JSON.parse(JSON.stringify(model));
}

// ------------------------------------------------------------------- paths

export function getAt(root, path) {
  let node = root;
  for (const key of path) {
    if (node == null) return undefined;
    node = node[key];
  }
  return node;
}

function parentOf(root, path) {
  return path.length ? getAt(root, path.slice(0, -1)) : root;
}

// "Jan 2020 - Present" has to become start/end/iso as well as the text, because
// the text formatters print the string while JSON Resume reads the fields. If
// only the string were updated, the two would disagree and the JSON would keep
// reporting the dates the résumé had before the edit.
const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
};

function toIso(text) {
  const t = String(text || '').trim().replace(/[.,]$/, '');
  if (!t) return null;
  let m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(t);
  if (m) return t;
  m = /^([A-Za-z]+)\.?\s+(\d{4})$/.exec(t);
  if (m) {
    const month = MONTHS[m[1].toLowerCase().replace(/\.$/, '')];
    if (month) return `${m[2]}-${String(month).padStart(2, '0')}`;
  }
  m = /^(\d{1,2})[/](\d{4})$/.exec(t);
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  m = /^(\d{4})$/.exec(t);
  if (m) return t;
  return null;
}

// "Present", "current", "now" or a bare start mean an open-ended role.
const isOpenEnded = (t) => /^(present|current|now|today|ongoing)\.?$/i.test(String(t || '').trim());

export function parseWhen(text) {
  const raw = String(text || '').trim();
  if (!raw) return { when: '', start: null, end: null, current: false };
  // Split on a dash with something either side of it, so a date range written
  // "2020-06" is not torn in half.
  const parts = raw.split(/\s+[-–—]\s+|\s+to\s+/i).map((p) => p.trim()).filter(Boolean);
  const head = parts[0] || '';
  const tail = parts.slice(1).join(' - ');
  const current = isOpenEnded(tail) || (parts.length === 1 && isOpenEnded(head));
  const startText = current && parts.length === 1 ? null : head;
  const endText = current ? null : tail || null;
  return {
    when: raw,
    start: startText ? { raw: startText, iso: toIso(startText) } : null,
    end: endText ? { raw: endText, iso: toIso(endText) } : null,
    current: Boolean(current),
  };
}

// The list fields are edited as one line per item, but skills groups come in
// comma separated, so both are accepted. The rule is deliberately forgiving: the
// cost of a stray comma is a slightly odd skill list, and the cost of refusing
// input is a person who cannot fix their résumé here.
const toList = (text) =>
  String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => (line.includes(',') ? line.split(',') : [line]))
    .map((item) => item.trim())
    .filter(Boolean);

export function setField(model, path, value) {
  // Write through the parent rather than by matching the path shape against the
  // model. The earlier version dispatched on path[0] and fell through to
  // `model[head] = value`, so typing in the name field replaced the whole meta
  // object with a string and every export came out nameless.
  const parent = parentOf(model, path);
  const key = path[path.length - 1];
  if (parent == null || typeof parent !== 'object') return model;

  if (path[0] === 'meta' && path[1] === 'contacts') {
    const contact = getAt(model, path.slice(0, 3));
    if (!contact) return model;
    contact[key] = key === 'href' ? value || null : value;
    // Keep the link honest with the text it labels. Typing a new address and
    // leaving a stale mailto behind is the sort of thing that only shows up in
    // the finished file.
    if (key === 'value') {
      if (contact.label === 'email') contact.href = value ? `mailto:${value}` : null;
      else if (contact.label !== 'phone' && contact.label !== 'location') {
        const bare = String(value || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
        contact.href = /^https?:\/\//i.test(value || '') ? value : bare ? `https://${bare}` : null;
      }
    }
    return model;
  }

  if (path[0] === 'sections') {
    if (path.length === 2) {
      const section = parent[key];
      if (section) section.title = value;
      return model;
    }
    if (path.length === 5) {
      // parent is the item itself here; the path's last step names the field.
      const item = parent;
      if (!item || typeof item !== 'object') return model;
      if (key === 'when') Object.assign(item, parseWhen(value));
      else if (key === 'items' || key === 'bullets') item[key] = toList(value);
      else item[key] = value === '' && OPTIONAL.has(key) ? null : value;
      return model;
    }
    return model;
  }

  if (path.length === 1) parent[key] = key === 'summary' ? value || null : value;
  else parent[key] = value === '' && OPTIONAL.has(key) ? null : value;
  return model;
}

// ------------------------------------------------------------- structure

export function addItem(model, sectionIndex, kind) {
  const section = model.sections[sectionIndex];
  if (!section) return model;
  const bucket = SECTIONS_FOR_KIND[section.kind];
  section[bucket] = section[bucket] || [];
  section[bucket].push(newItem(section.kind || kind));
  return model;
}

export function removeItem(model, sectionIndex, itemIndex) {
  const section = model.sections[sectionIndex];
  if (!section) return model;
  const bucket = SECTIONS_FOR_KIND[section.kind];
  const items = section[bucket] || [];
  items.splice(itemIndex, 1);
  // A section with nothing in it is worse than no section: every formatter has
  // to decide what an empty heading means, and they would not all agree.
  if (!items.length) model.sections.splice(sectionIndex, 1);
  return model;
}

export function moveItem(model, sectionIndex, itemIndex, delta) {
  const section = model.sections[sectionIndex];
  if (!section) return model;
  const items = section[SECTIONS_FOR_KIND[section.kind]] || [];
  const to = itemIndex + delta;
  if (to < 0 || to >= items.length) return model;
  const [moved] = items.splice(itemIndex, 1);
  items.splice(to, 0, moved);
  return model;
}

export function addSection(model, kind = 'runs') {
  model.sections.push(newSection(kind));
  return model;
}

export function removeSection(model, sectionIndex) {
  model.sections.splice(sectionIndex, 1);
  return model;
}

export function moveSection(model, sectionIndex, delta) {
  const to = sectionIndex + delta;
  if (to < 0 || to >= model.sections.length) return model;
  const [moved] = model.sections.splice(sectionIndex, 1);
  model.sections.splice(to, 0, moved);
  return model;
}

export function addContact(model) {
  model.meta.contacts = model.meta.contacts || [];
  model.meta.contacts.push({ label: 'link', value: '', href: null });
  return model;
}

export function removeContact(model, index) {
  model.meta.contacts.splice(index, 1);
  return model;
}

// ---------------------------------------------------------------- the tree
// What the page renders. Every leaf carries the path it writes to, so adding a
// field to the model means adding it to ITEM_FIELD and nowhere else.

const asLines = (list) => (Array.isArray(list) ? list.join('\n') : '');

export function editorTree(model) {
  return {
    meta: [
      { path: ['meta', 'name'], label: 'Name', kind: 'text', value: model.meta.name || '', hint: 'Your Name' },
      {
        path: ['meta', 'headline'],
        label: 'Headline',
        kind: 'text',
        value: model.meta.headline || '',
        hint: 'Systems engineer',
      },
      {
        path: ['summary'],
        label: 'Summary',
        kind: 'lines',
        value: model.summary || '',
        hint: 'A few sentences on what you are good at',
      },
    ],
    contacts: (model.meta.contacts || []).map((contact, index) => ({
      index,
      fields: [
        { path: ['meta', 'contacts', index, 'label'], label: 'Kind', kind: 'text', value: contact.label || '', hint: 'link' },
        {
          path: ['meta', 'contacts', index, 'value'],
          label: 'Value',
          kind: 'text',
          value: contact.value || '',
          hint: 'github.com/you',
        },
        {
          path: ['meta', 'contacts', index, 'href'],
          label: 'Link',
          kind: 'text',
          value: contact.href || '',
          hint: 'https://...',
        },
      ],
    })),
    sections: model.sections.map((section, index) => {
      const bucket = SECTIONS_FOR_KIND[section.kind] || 'runs';
      return {
        index,
        id: section.id,
        title: section.title,
        kind: section.kind,
        count: (section[bucket] || []).length,
        items: (section[bucket] || []).map((item, itemIndex) => ({
          index: itemIndex,
          fields: (ITEM_FIELD[section.kind] || ITEM_FIELD.runs).map((spec) => ({
            ...spec,
            path: ['sections', index, bucket, itemIndex, spec.field],
            value: spec.kind === 'lines' ? asLines(item[spec.field]) : item[spec.field] ?? '',
          })),
        })),
      };
    }),
  };
}
