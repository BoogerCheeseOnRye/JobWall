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
    const end = src.indexOf('endobj', start);
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
    }
    objects.set(num, { num, dict, streamStart, length, src, bytes });
  }
  return objects;
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
      let j = i;
      while (j < n && !/[\s()[\]<>]/.test(content[j])) j++;
      const word = content.slice(i, j);
      tokens.push({ type: /^[+-.\d]/.test(word) ? 'number' : 'name', value: word.replace(/^\//, '') });
      i = j;
      continue;
    }
    let j = i;
    while (j < n && /[^\s()[\]<>]/.test(content[j])) j++;
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

export async function extractPdfText(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const objects = scanObjects(bytes);
  if (!objects.size) return { text: '', pages: 0, hasText: false, reason: 'no readable objects' };
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

    const contentsRef = page.dict.match(/\/Contents\s+(\d+)\s+\d+\s+R/);
    let contentObj = contentsRef ? objects.get(Number(contentsRef[1])) : null;
    if (!contentObj) continue;
    const text = await objectStreamText(objects, contentObj);
    if (!text) continue;
    // Blank lines survive on purpose: the vertical gaps between sections are
    // the only reliable boundary a resume has, and dropping them costs the
    // parser its section detection.
    pagesOut.push(runsToLines(renderContent(text, lookup)));
  }

  const pageCount = pageList.length || pagesOut.length;
  const all = pagesOut.map((lines) => lines.join('\n')).filter(Boolean);
  const text = all.join('\n\n');
  return { text, pages: pageCount, hasText: text.trim().length > 0, reason: text.trim() ? null : 'no text layer (scanned image?)' };
}
