// Dependency-free PDF text extraction.
//
// Why hand-rolled: JobWall runs as a static site with no backend, and a resume
// parser that needs pdf.js drags in ~300 KB and a build step. Modern browsers
// and Node both ship DecompressionStream, which is the only genuinely hard part
// (Flate). Everything else here is spec-following bookkeeping.
//
// Scope: text-layer PDFs like the ones people actually export from Word, Google
// Docs, or a resume builder. Scanned pages (image-only) yield no text and are
// reported as such rather than silently returning an empty resume.

const inflateCache = new Map();

async function inflate(bytes) {
  if (inflateCache.size > 64) inflateCache.clear();
  for (const format of ['deflate', 'deflate-raw']) {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      /* try the next framing */
    }
  }
  return null;
}

const decoder = new TextDecoder('latin1');

// Scans for "N G obj" rather than walking the xref table. A malformed xref is
// common in the wild (Word writes broken ones constantly) and the object bodies
// are still where they claim to be.
function scanObjects(bytes) {
  const src = decoder.decode(bytes);
  const objects = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(src))) {
    const num = Number(m[1]);
    const start = m.index + m[0].length;
    let end = src.indexOf('endobj', start);
    if (end < 0) continue;
    const body = src.slice(start, end);
    const si = body.indexOf('stream');
    const dict = si < 0 ? body : body.slice(0, si);
    let streamStart = -1;
    let length = -1;
    if (si >= 0) {
      const after = body.slice(si + 6);
      const nl = after.indexOf('\n');
      streamStart = start + si + 6 + (nl + 1);
      // /Length is authoritative when it is a direct integer; lastIndexOf picks
      // up trailing whitespace and corrupts the inflate.
      const lm = /\/Length\s+(\d+)/.exec(dict);
      length = lm ? Number(lm[1]) : -1;
      // Compressed bytes routinely contain the literal text "N 0 obj". Scanning
      // through them invents objects and can shadow the real page dictionary.
      // Resume after this stream instead of trusting the first "endobj".
      const streamTail = src.indexOf('endstream', streamStart);
      if (streamTail >= 0) {
        end = src.indexOf('endobj', streamTail);
        if (end < 0) end = streamTail + 9;
      }
    }
    objects.set(num, { num, dict, streamStart, length, src, bytes });
    // Skip the body: only the top level contains object headers.
    re.lastIndex = end + 6;
  }
  return objects;
}

// PDF 1.5+ packs small objects (page trees, font dictionaries, annotations)
// into a compressed /ObjStm stream instead of writing "N G obj" bodies. The
// scanner above only sees the outer streams, so without this step a perfectly
// valid LaTeX or Word export has *zero* pages and looks like a scan. Embedded
// objects carry no stream of their own, which is fine: PDF forbids streams
// inside an object stream, so every page's /Contents still lives at top level.
async function expandObjectStreams(objects, bytes) {
  for (const object of [...objects.values()]) {
    if (!/\/Type\s*\/ObjStm\b/.test(object.dict)) continue;
    const raw = streamBytes(objects, object);
    if (!raw || !raw.length) continue;
    const inflated = /\/FlateDecode/.test(object.dict) ? await inflate(raw) : raw;
    if (!inflated) continue;
    const text = decoder.decode(inflated);
    const count = Number(/\/N\s+(\d+)/.exec(object.dict)?.[1] || 0);
    const first = Number(/\/First\s+(\d+)/.exec(object.dict)?.[1] || 0);
    if (!count || first > text.length) continue;
    const header = text.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < count; i++) {
      const num = header[i * 2];
      const offset = header[i * 2 + 1];
      if (!Number.isFinite(num) || !Number.isFinite(offset)) break;
      const start = first + offset;
      const nextOffset = i + 1 < count ? header[(i + 1) * 2 + 1] : null;
      const end = nextOffset == null ? text.length : first + nextOffset;
      if (start < 0 || start >= text.length) continue;
      const body = text.slice(start, Math.min(end, text.length)).trim();
      if (!body) continue;
      // Never overwrite a top-level object: an ObjStm copy is the same object
      // and the uncompressed one may include a stream this one cannot have.
      if (!objects.has(num)) {
        objects.set(num, { num, dict: body, streamStart: -1, length: -1, src: object.src, bytes });
      }
    }
  }
}

function streamBytes(objects, object) {
  if (object.streamStart < 0) return null;
  const { bytes, length, src } = object;
  if (length >= 0 && object.streamStart + length <= bytes.length) {
    return bytes.subarray(object.streamStart, object.streamStart + length);
  }
  const tail = src.indexOf('endstream', object.streamStart);
  if (tail < 0) return null;
  return bytes.subarray(object.streamStart, tail);
}

// /Length is often an indirect reference ("/Length 34 0 R"), and the trailing
// newline before "endstream" is enough to make DecompressionStream reject the
// whole stream as junk. Read the indirect number when we can.
function streamLength(objects, dict) {
  const m = /\/Length\s+(\d+)(?:\s+(\d+)\s+R)?/.exec(dict);
  if (!m) return -1;
  if (!m[2]) return Number(m[1]);
  const target = objects.get(Number(m[1]));
  const value = target && /^\s*(\d+)\s*$/.exec(target.dict)?.[1];
  return value ? Number(value) : -1;
}

async function objectStreamText(objects, object) {
  const raw = streamBytes(objects, object);
  if (!raw || raw.length === 0) return null;
  if (!/\/FlateDecode/.test(object.dict)) return decoder.decode(raw);
  const out = await inflate(raw);
  return out ? decoder.decode(out) : null;
}

// Resolves "7 0 R" against the scanned object table, plus inline dicts.
function resolve(objects, token) {
  if (token == null) return null;
  const ref = /^(\d+)\s+\d+\s+R$/.exec(token.trim());
  if (ref) return objects.get(Number(ref[1])) || null;
  return { dict: token, num: null };
}

function dictValue(dict, key) {
  const i = dict.indexOf(key);
  if (i < 0) return null;
  let j = i + key.length;
  while (j < dict.length && /\s/.test(dict[j])) j++;
  if (dict[j] === '<') {
    let depth = 0;
    let k = j;
    for (; k < dict.length; k++) {
      if (dict[k] === '<') depth++;
      else if (dict[k] === '>') {
        depth--;
        if (depth === 0) return dict.slice(j, k + 1);
      }
    }
  }
  const rest = dict.slice(j);
  const ref = /^(\d+)\s+\d+\s+R\b/.exec(rest);
  if (ref) return `${ref[1]} 0 R`;
  return /^[\w.+-]+/.exec(rest)?.[0] || null;
}

function refOf(dict, key) {
  const v = dictValue(dict, key);
  return v && /\d+\s+\d+\s+R$/.test(v) ? v : null;
}

// A key can hold either an indirect reference or an inline dictionary, and
// generators disagree about which they use for /Resources and /Font. Accept
// both rather than silently losing every font when it is inline.
function dictObject(objects, obj, key) {
  if (!obj) return null;
  const v = dictValue(obj.dict, key);
  if (!v) return null;
  if (/^\d+\s+\d+\s+R$/.test(v)) return objects.get(Number(v.split(/\s+/)[0])) || null;
  return { dict: v, num: null };
}

// ------------------------------------------------------- ToUnicode CMaps
function parseCMap(text) {
  const map = new Map();
  const hexToStr = (hex) => {
    const clean = hex.replace(/[^0-9a-fA-F]/g, '');
    let out = '';
    for (let i = 0; i + 3 < clean.length + 1; i += 4) {
      const unit = clean.slice(i, i + 4);
      if (unit.length === 4) out += String.fromCharCode(parseInt(unit, 16));
    }
    return out;
  };

  for (const block of text.match(/beginbfchar([\s\S]*?)endbfchar/g) || []) {
    for (const [, src, dst] of block.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) {
      map.set(parseInt(src, 16), hexToStr(dst));
    }
  }

  for (const block of text.match(/beginbfrange([\s\S]*?)endbfrange/g) || []) {
    for (const m of block.matchAll(
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]*)>|\[([\s\S]*?)\])/g
    )) {
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      if (m[3] != null) {
        const base = hexToStr(m[3]);
        if (!base) continue;
        const start = base.charCodeAt(base.length - 1);
        const width = m[3].replace(/[^0-9a-fA-F]/g, '').length;
        for (let c = lo; c <= hi && c - lo < 65535; c++) {
          const head = width > 4 ? base.slice(0, -1) : '';
          map.set(c, head + String.fromCharCode(start + (c - lo)));
        }
      } else {
        const items = m[4].match(/<([0-9a-fA-F]*)>/g) || [];
        for (let c = lo; c <= hi && c - lo < items.length; c++) {
          map.set(c, hexToStr(items[c - lo]));
        }
      }
    }
  }
  return map;
}

// ------------------------------------------------------ content tokenizer
function tokenize(content) {
  const tokens = [];
  let i = 0;
  const n = content.length;
  while (i < n) {
    const ch = content[i];
    if (ch === '%') {
      while (i < n && content[i] !== '\n') i++;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '(') {
      let depth = 1;
      let j = i + 1;
      let out = '';
      while (j < n && depth > 0) {
        const c = content[j];
        if (c === '\\') {
          const esc = content[j + 1];
          const simple = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };
          if (esc in simple) {
            out += simple[esc];
            j += 2;
          } else if (esc >= '0' && esc <= '7') {
            const oct = /^[0-7]{1,3}/.exec(content.slice(j + 1, j + 4))[0];
            out += String.fromCharCode(parseInt(oct, 8));
            j += 1 + oct.length;
          } else {
            out += esc;
            j += 2;
          }
          continue;
        }
        if (c === '(') depth++;
        if (c === ')') {
          depth--;
          if (depth === 0) break;
        }
        out += c;
        j++;
      }
      tokens.push({ type: 'string', value: out });
      i = j + 1;
      continue;
    }
    if (ch === '<' && content[i + 1] !== '<') {
      const close = content.indexOf('>', i);
      const hex = content.slice(i + 1, close < 0 ? n : close).replace(/[^0-9a-fA-F]/g, '');
      let out = '';
      for (let k = 0; k + 1 < hex.length; k += 2) out += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16));
      tokens.push({ type: 'string', value: out });
      i = (close < 0 ? n : close) + 1;
      continue;
    }
    if (ch === '[' || ch === ']') {
      tokens.push({ type: ch === '[' ? 'arrayStart' : 'arrayEnd' });
      i++;
      continue;
    }
    if (ch === '/' || ch === '+' || ch === '-' || ch === '.' || /[0-9]/.test(ch)) {
      let j = ch === '/' ? i + 1 : i;
      while (j < n && !/[\s()[\]<>/]/.test(content[j])) j++;
      const word = content.slice(i, j);
      tokens.push({ type: /^[+-.\d]/.test(word) ? 'number' : 'name', value: word.replace(/^\//, '') });
      i = j;
      continue;
    }
    let j = i;
    while (j < n && /[^\s()[\]<>/]/.test(content[j])) j++;
    if (j === i) {
      // '<<', '>>' and stray '<'/'>' land here. Always advance, or the loop
      // spins forever and the token array eats the heap.
      j = i + 1;
      tokens.push({ type: 'op', value: content.slice(i, j) });
      i = j;
      continue;
    }
    tokens.push({ type: 'op', value: content.slice(i, j) });
    i = j;
  }
  return tokens;
}

const mul = (m, n) => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function decodeString(raw, font) {
  if (!font?.map) return raw;
  const two = font.twoByte;
  let out = '';
  if (two) {
    for (let i = 0; i + 1 < raw.length; i += 2) {
      const code = (raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1);
      out += font.map.get(code) ?? String.fromCharCode(code);
    }
    if (raw.length % 2) out += raw[raw.length - 1];
  } else {
    for (let i = 0; i < raw.length; i++) {
      const code = raw.charCodeAt(i);
      out += font.map.get(code) ?? raw[i];
    }
  }
  return out;
}

function renderContent(content, fontFor) {
  const tokens = tokenize(content);
  const runs = [];
  let stack = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  let tm = [1, 0, 0, 1, 0, 0];
  let tlm = tm;
  let leading = 0;
  let font = null;
  let fontSize = 1;
  const operands = [];

  const line = () => {
    tlm = mul([1, 0, 0, 1, 0, -leading], tlm);
    tm = tlm;
  };

  for (const t of tokens) {
    if (t.type !== 'op') {
      operands.push(t);
      continue;
    }
    const op = t.value;
    const nums = operands.filter((o) => o.type === 'number').map((o) => Number(o.value));
    const lastString = [...operands].reverse().find((o) => o.type === 'string')?.value;

    if (op === 'q') stack = [...stack, ctm];
    else if (op === 'Q') ctm = stack.pop() || ctm;
    else if (op === 'cm' && nums.length >= 6) ctm = mul(nums.slice(-6), ctm);
    else if (op === 'BT') {
      tm = [1, 0, 0, 1, 0, 0];
      tlm = tm;
    } else if (op === 'TL' && nums.length) leading = nums.at(-1);
    else if (op === 'Tf') {
      const name = operands.filter((o) => o.type === 'name').at(-1)?.value;
      fontSize = nums.at(-1) || fontSize;
      font = fontFor(name);
    } else if (op === 'Td' && nums.length >= 2) {
      tlm = mul([1, 0, 0, 1, nums.at(-2), nums.at(-1)], tlm);
      tm = tlm;
    } else if (op === 'TD' && nums.length >= 2) {
      leading = -nums.at(-1);
      tlm = mul([1, 0, 0, 1, nums.at(-2), nums.at(-1)], tlm);
      tm = tlm;
    } else if (op === 'Tm' && nums.length >= 6) {
      tlm = nums.slice(-6);
      tm = tlm;
    } else if (op === 'T*') line();

    if (op === 'Tj' || op === "'" || op === '"') {
      if (op !== 'Tj') line();
      const text = decodeString(lastString ?? '', font);
      const p = apply(mul(tm, ctm), 0, 0);
      runs.push({ x: p[0], y: p[1], size: fontSize * Math.abs(ctm[3] || 1), text });
    } else if (op === 'TJ') {
      const buf = [];
      for (const o of operands) {
        if (o.type === 'string') {
          buf.push(decodeString(o.value, font));
        } else if (o.type === 'number' && o.value < -180) {
          buf.push(' ');
        }
      }
      const text = buf.join('');
      if (text) {
        const p = apply(mul(tm, ctm), 0, 0);
        runs.push({ x: p[0], y: p[1], size: fontSize * Math.abs(ctm[3] || 1), text });
      }
    }
    operands.length = 0;
  }
  return runs;
}

function runsToLines(runs) {
  if (!runs.length) return [];
  const sizes = runs.map((r) => r.size).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] || 10;
  const tol = Math.max(1.2, median * 0.35);

  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  let current = null;
  for (const run of sorted) {
    if (!current || Math.abs(current.y - run.y) > tol) {
      current = { y: run.y, items: [run] };
      lines.push(current);
    } else {
      current.items.push(run);
      current.y = (current.y * (current.items.length - 1) + run.y) / current.items.length;
    }
  }

  return lines.map((line) => {
    line.items.sort((a, b) => a.x - b.x);
    let out = '';
    let prev = null;
    for (const item of line.items) {
      if (prev) {
        const gap = item.x - prev.x - prev.size * 0.42 * estimateWidth(prev.text);
        if (gap > prev.size * 0.22) out += ' ';
      }
      out += item.text;
      prev = item;
    }
    return out.replace(/[ \t]+/g, ' ').trimEnd();
  });
}

const estimateWidth = (s) => (s.length * 0.5);

// Two-column resumes put unrelated sections side by side. Reading runs in
// visual line order interleaves them ("EDUCATION EXPERIENCE"), so detect a
// genuine second column and read each column top-to-bottom before joining.
// Right-aligned dates on a one-column resume are not a column: the right side
// must carry a meaningful share of the page's text and several distinct lines.
const HEADING_WORD = /^(education|experience|skills|projects|links|coursework|awards|publications|research|activities|summary|profile|objective|certifications?|honors?|languages?|interests?|volunteer(?:ing)?|employment|work(?:\s+experience)?|technical(?:\s+skills)?|selected\s+projects|additional\s+information|leadership|affiliations?)$/i;

function splitColumns(runs) {
  const chars = (list) => list.reduce((n, r) => n + r.text.trim().length, 0);
  const textRuns = runs.filter((r) => r.text.trim());
  const xs = textRuns.map((r) => r.x);
  if (xs.length < 20) return null;
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  if (max - min < 180) return null;

  // Only trust a split when two section headings share a baseline, one in each
  // column. A one-column resume also has right-aligned dates, and treating
  // those as a column shreds every bullet line.
  const byLine = new Map();
  for (const run of textRuns) {
    if (!HEADING_WORD.test(run.text.trim())) continue;
    const key = Math.round(run.y / 3);
    if (!byLine.has(key)) byLine.set(key, []);
    byLine.get(key).push(run);
  }
  let headingY = null;
  let headingXs = [];
  for (const group of byLine.values()) {
    const xs = group.map((r) => r.x);
    if (group.length >= 2 && Math.max(...xs) - Math.min(...xs) > 80) {
      headingY = Math.max(...group.map((r) => r.y));
      headingXs = xs;
    }
  }
  if (headingY == null) return null;

  const header = textRuns.filter((r) => r.y > headingY + 1);
  const body = textRuns.filter((r) => r.y <= headingY + 1);
  const bodyXs = [...new Set(body.map((r) => r.x))].sort((a, b) => a - b);
  let best = null;
  for (let i = 0; i + 1 < bodyXs.length; i++) {
    const gap = bodyXs[i + 1] - bodyXs[i];
    if (gap < 12 || (best && gap <= best.gap)) continue;
    const cut = (bodyXs[i] + bodyXs[i + 1]) / 2;
    const left = body.filter((r) => r.x < cut);
    const right = body.filter((r) => r.x >= cut);
    const leftChars = chars(left);
    const rightChars = chars(right);
    if (leftChars < 200 || rightChars < 200) continue;
    if (rightChars / (leftChars + rightChars) < 0.22) continue;
    if (new Set(right.map((r) => Math.round(r.y))).size < 6) continue;
    if (Math.min(...headingXs) >= cut || Math.max(...headingXs) < cut) continue;
    best = { gap, cut };
  }
  if (!best) return null;
  return {
    header,
    left: body.filter((r) => r.x < best.cut),
    right: body.filter((r) => r.x >= best.cut),
  };
}

export async function extractPdfText(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const objects = scanObjects(bytes);
  if (!objects.size) return { text: '', pages: 0, hasText: false, reason: 'no readable objects' };
  // The object table is complete now, so indirect /Length references can be
  // resolved before any stream is inflated.
  for (const object of objects.values()) {
    if (object.streamStart >= 0) object.length = streamLength(objects, object.dict);
  }
  await expandObjectStreams(objects, bytes);
  // The trailer names /Encrypt when the document is password protected. Its
  // streams decrypt into noise, so bail out rather than emit garbage text.
  const tail = decoder.decode(bytes.subarray(Math.max(0, bytes.length - 4096)));
  if (/\/Encrypt\b/.test(tail)) {
    return { text: '', pages: 0, hasText: false, reason: 'encrypted' };
  }

  const cmaps = new Map();
  const fonts = new Map();
  const getFont = async (fontObj) => {
    if (!fontObj) return null;
    if (fonts.has(fontObj.num)) return fonts.get(fontObj.num);
    const twoByte = /\/Subtype\s*\/Type0/.test(fontObj.dict) || /Identity-[HV]/.test(fontObj.dict);
    let entry = { map: null, twoByte };
    const tu = refOf(fontObj.dict, '/ToUnicode');
    if (tu) {
      const cm = objects.get(Number(tu.split(/\s+/)[0]));
      const text = cm ? await objectStreamText(objects, cm) : null;
      if (text) entry = { map: parseCMap(text), twoByte };
    }
    fonts.set(fontObj.num, entry);
    return entry;
  };

  const pages = [...objects.values()].filter((o) => /\/Type\s*\/Page[^s]/.test(o.dict));
  const pageList = pages.length ? pages : [];

  const pagesOut = [];
  for (const page of pageList) {
    const resObj = dictObject(objects, page, '/Resources');
    const fontObj = dictObject(objects, resObj, '/Font');
    const fontDict = fontObj ? fontObj.dict : '';
    const fontRefs = new Map();
    for (const m of fontDict.matchAll(/\/([^\s/]+)\s+(\d+)\s+\d+\s+R/g)) {
      fontRefs.set(m[1], objects.get(Number(m[2])));
    }
    if (!fontRefs.size) {
      // Resources were not reachable through the page dict (some generators only
      // put them in the /Pages node). Fall back to any font in the file, keyed
      // by the name each font object actually uses.
      for (const o of objects.values()) {
        if (!/\/Type\s*\/Font/.test(o.dict)) continue;
        const nm = /\/BaseFont\s*\/([^\s/>]+)/.exec(o.dict)?.[1];
        if (nm && !fontRefs.has(nm)) fontRefs.set(nm, o);
      }
    }
    // CMaps have to be inflated, so every font is resolved up front. Handing
    // renderContent a promise instead of a font entry silently decodes every
    // string as raw bytes.
    const resolved = new Map();
    for (const [name, obj] of fontRefs) {
      if (obj) resolved.set(name, await getFont(obj));
    }
    const lookup = (name) => resolved.get(name) || null;

    const contentsRef = /\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(page.dict);
    if (!contentsRef) continue;
    const contentRefs = [...contentsRef[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));
    const contents = [];
    for (const ref of contentRefs) {
      const contentObj = objects.get(ref);
      if (!contentObj) continue;
      const text = await objectStreamText(objects, contentObj);
      if (text) contents.push(text);
    }
    const text = contents.join('\n');
    if (!text) continue;
    // Blank lines survive on purpose: the vertical gaps between sections are
    // the only reliable boundary a resume has, and dropping them costs the
    // parser its section detection.
    const pageRuns = renderContent(text, lookup);
    const columns = splitColumns(pageRuns);
    const lines = columns
      ? [
          ...runsToLines(columns.header),
          ...runsToLines(columns.left),
          ...runsToLines(columns.right),
        ]
      : runsToLines(pageRuns);
    pagesOut.push(lines.filter(Boolean));
  }

  const pageCount = pageList.length || pagesOut.length;
  const all = pagesOut.map((lines) => lines.join('\n')).filter(Boolean);
  const text = all.join('\n\n');
  return { text, pages: pageCount, hasText: text.trim().length > 0, reason: text.trim() ? null : 'no text layer (scanned image?)' };
}
