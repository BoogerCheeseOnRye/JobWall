// A very small PDF writer: one column, Helvetica, real page breaks, real links.
//
// It exists so a resume can be exported to a genuine PDF offline, in Node and
// in the browser, with no library. The layout is deliberately plain because
// that is what parses reliably on the far side of an applicant tracking system.
// Base-14 fonts are used, so nothing needs embedding.
//
// Widths are the real Adobe AFM values for Helvetica and Helvetica-Bold rather
// than an average-character guess: wrapping with a guess puts the last word of
// every line outside the margin.

const HELVETICA = {
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  0: 556, 1: 556, 2: 556, 3: 556, 4: 556, 5: 556, 6: 556, 7: 556, 8: 556, 9: 556,
  ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
  K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611, '[': 278, '\\': 278, ']': 278,
  '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500, '{': 334, '|': 260, '}': 334, '~': 584,
};

const HELVETICA_BOLD = {
  ' ': 278, '!': 333, '"': 474, '#': 556, $: 556, '%': 889, '&': 722, "'": 238,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  0: 556, 1: 556, 2: 556, 3: 556, 4: 556, 5: 556, 6: 556, 7: 556, 8: 556, 9: 556,
  ':': 333, ';': 333, '<': 584, '=': 584, '>': 584, '?': 611, '@': 975,
  A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556,
  K: 722, L: 611, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611, '[': 333, '\\': 278, ']': 333,
  '^': 584, _: 556, '`': 333,
  a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278,
  k: 556, l: 278, m: 889, n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333,
  u: 611, v: 556, w: 778, x: 556, y: 556, z: 500, '{': 389, '|': 280, '}': 389, '~': 584,
};

// WinAnsi has no room for typographic characters. Substituting them is not just
// a rendering decision: an ATS that reads bytes sees "?" where a curly quote
// used to be, and a page of question marks reads as a corrupt file.
const SUBSTITUTIONS = [
  [/ﬀ/g, 'ff'], [/ﬁ/g, 'fi'], [/ﬂ/g, 'fl'], [/ﬃ/g, 'ffi'], [/ﬄ/g, 'ffl'],
  [/ﬅ|ﬆ/g, 'st'],
  [/[‘’‚‛′]/g, "'"],
  [/[“”„‟″]/g, '"'],
  [/[‐‑‒–—―]/g, '-'],
  [/…/g, '...'],
  [/[     ]/g, ' '],
  [/•/g, String.fromCharCode(0x95)], // WinAnsi bullet
  [/·/g, String.fromCharCode(0xb7)], // middle dot
  [/©/g, '(c)'],
  [/®/g, '(r)'],
  [/™/g, '(tm)'],
  [/→/g, '->'],
  [/≥/g, '>='],
  [/≤/g, '<='],
  [/×/g, 'x'],
];

export function toWinAnsi(text) {
  let out = String(text ?? '');
  for (const [re, to] of SUBSTITUTIONS) out = out.replace(re, to);
  // Anything still outside Latin-1 becomes a space rather than a broken byte.
  return out.replace(/[^ -ÿ -ÿ]/g, (ch) => (ch.codePointAt(0) < 256 ? ch : ' ')).replace(/[ \t]+/g, ' ');
}

const widthOf = (text, font) => {
  const table = font === 'bold' ? HELVETICA_BOLD : HELVETICA;
  let w = 0;
  for (const ch of text) w += table[ch] ?? 556;
  return w / 1000;
};

// Greedy wrap. Splits on spaces, and on hyphens when a single token is still too
// wide, so a long URL or identifier cannot run off the page.
export function wrapText(text, font, size, maxWidth) {
  const words = toWinAnsi(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  const pushWord = (word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (widthOf(candidate, font) * size <= maxWidth || !line) {
      if (widthOf(candidate, font) * size <= maxWidth) {
        line = candidate;
        return;
      }
      if (!line) {
        line = word; // unbreakable token wider than the column: keep it whole
        return;
      }
    }
    lines.push(line);
    line = word;
  };
  for (const word of words) {
    if (widthOf(word, font) * size > maxWidth && !line) {
      let chunk = '';
      for (const ch of word) {
        if (widthOf(chunk + ch, font) * size > maxWidth && chunk) {
          lines.push(chunk);
          chunk = ch;
        } else chunk += ch;
      }
      line = chunk;
      continue;
    }
    pushWord(word);
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

const escapePdf = (s) => s.replace(/([\\()])/g, '\\$1');
const latin1Bytes = (s) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

export const PAGE_SIZES = {
  letter: [612, 792],
  legal: [612, 1008],
  a4: [595, 842],
};

// blocks: [{ text, font, size, gap, indent, rule, bullet, link }]
export function renderPdf(blocks, options = {}) {
  const [pageW, pageH] = PAGE_SIZES[options.pageSize || 'letter'] || PAGE_SIZES.letter;
  const margin = options.margin ?? 54;
  const colWidth = pageW - margin * 2;
  const baseSize = options.size ?? 10.5;
  const lineHeight = options.lineHeight ?? 1.32;
  const pages = [];
  let ops = [];
  let y = pageH - margin;
  const links = [];

  const space = (h) => {
    y -= h;
    if (y < margin + 24) newPage();
  };
  const newPage = () => {
    pages.push({ ops: ops.join(''), links: [...links] });
    ops = [];
    links.length = 0;
    y = pageH - margin;
  };

  for (const block of blocks) {
    const size = block.size ?? baseSize;
    const font = block.font === 'bold' || block.font === 'italic' ? block.font : 'regular';
    const indent = block.indent ?? 0;
    const width = colWidth - indent;
    const lh = size * lineHeight;

    if (block.gap) space(block.gap);
    if (block.rule) {
      space(3);
      ops.push(`q 0.75 0.75 0.75 RG 0.6 w ${margin} ${y.toFixed(2)} m ${(pageW - margin).toFixed(2)} ${y.toFixed(2)} l S Q\n`);
      space(4);
    }
    const lines = block.text === null || block.text === undefined ? [''] : wrapText(block.text, font, size, width);
    for (const line of lines) {
      space(lh);
      const x = margin + indent + (block.bullet ? 10 : 0);
      const text = block.bullet ? line : line;
      const prefix = block.bullet ? '-  ' : '';
      const fontRef = font === 'bold' ? '/F2' : font === 'italic' ? '/F3' : '/F1';
      ops.push(
        `BT ${fontRef} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${(y + size * 0.28).toFixed(2)} Tm (${escapePdf(prefix + text)}) Tj ET\n`
      );
      if (block.link && lines.indexOf(line) === 0) {
        links.push({
          rect: [x, y - 2, x + Math.min(width, widthOf(prefix + text, font) * size), y + size],
          uri: block.link,
        });
      }
    }
    if (block.gapAfter) space(block.gapAfter);
  }
  pages.push({ ops: ops.join(''), links: [...links] });

  // ---- assemble
  const objects = [];
  const add = (body) => objects.push(body);

  const catalogNum = 1;
  const pagesNum = 2;
  const fontNums = { regular: 3, bold: 4, italic: 5 };
  add(`<< /Type /Catalog /Pages ${pagesNum} 0 R >>`);
  add(''); // placeholder for /Pages, filled once page numbers are known
  for (const [key, num] of Object.entries(fontNums)) {
    const base = key === 'regular' ? 'Helvetica' : key === 'bold' ? 'Helvetica-Bold' : 'Helvetica-Oblique';
    add(`<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`);
  }

  // Pass one: hand out object numbers. A page contributes 2 objects plus one per
  // link, so numbering has to be known before any body can reference it.
  let next = objects.length + 1;
  const layout = pages.map((page) => {
    const pageNum = next++;
    const contentNum = next++;
    const annotNums = page.links.map(() => next++);
    return { page, pageNum, contentNum, annotNums };
  });

  for (const { page, pageNum, contentNum, annotNums } of layout) {
    const annots = annotNums.length ? ` /Annots [${annotNums.map((n) => `${n} 0 R`).join(' ')}]` : '';
    add(
      `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 ${fontNums.regular} 0 R /F2 ${fontNums.bold} 0 R /F3 ${fontNums.italic} 0 R >> >> /Contents ${contentNum} 0 R${annots} >>`
    );
    add(`<< /Length ${latin1Bytes(page.ops).length} >>\nstream\n${page.ops}endstream`);
    page.links.forEach((l, j) => {
      add(
        `<< /Type /Annot /Subtype /Link /Rect [${l.rect.map((n) => n.toFixed(2)).join(' ')}] /Border [0 0 0] /A << /Type /Action /S /URI /URI (${escapePdf(l.uri)}) >> >>`
      );
    });
  }
  const pageNums = layout.map((l) => l.pageNum);
  objects[pagesNum - 1] = `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`;

  let out = '%PDF-1.4\n%âãÏÓ\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(latin1Bytes(out).length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = latin1Bytes(out).length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNum} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(latin1Bytes(out));
}
