// Dependency-free DOCX text extraction.
//
// A .docx is a ZIP holding word/document.xml. Browsers and Node both ship
// DecompressionStream, so the only work here is walking the ZIP container by
// hand — enough of it to pull one entry out, not a general-purpose archive
// library.

const decoder = new TextDecoder('utf-8');

async function inflateRaw(bytes) {
  for (const format of ['deflate-raw', 'deflate']) {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      /* try the next framing */
    }
  }
  return null;
}

function findEocd(view) {
  // The end-of-central-directory record sits in the last 64 KB plus the 22-byte
  // record itself, and can be followed by a comment of arbitrary length.
  const max = Math.min(view.byteLength, 0xffff + 22);
  for (let i = view.byteLength - 22; i >= view.byteLength - max; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  return -1;
}

export async function readZipEntry(bytes, wanted) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view);
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) return null;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    offset += 46 + nameLen + extraLen + commentLen;

    if (name !== wanted) continue;

    // The local header repeats the name and may carry different extra data, so
    // the payload does not start where the central directory says it does.
    if (view.getUint32(localOffset, true) !== 0x04034b50) return null;
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const payload = bytes.subarray(start, start + compressedSize);
    if (method === 0) return decoder.decode(payload);
    const out = await inflateRaw(payload);
    return out ? decoder.decode(out) : null;
  }
  return null;
}

const unescapeXml = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');

export async function extractDocxText(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const xml = await readZipEntry(bytes, 'word/document.xml');
  if (!xml) return { text: '', paragraphs: [], hasText: false, reason: 'not a readable .docx (no word/document.xml)' };

  const paragraphs = [];
  // Paragraphs, not lines: Word styles the resume, and the style tells us
  // which strings are section headers instead of us guessing from capitals.
  for (const p of xml.match(/<w:p\b[\s\S]*?<\/w:p>|<w:p\b[^>]*\/>/g) || []) {
    const style = /<w:pStyle\s+w:val="([^"]+)"/.exec(p)?.[1] || '';
    let out = '';
    const parts = p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>|<w:cr\b[^>]*\/?>/g);
    for (const part of parts) {
      if (part[1] != null) out += unescapeXml(part[1]);
      else if (part[0].startsWith('<w:tab')) out += '\t';
      else out += '\n';
    }
    paragraphs.push({ text: out, style });
  }

  const text = paragraphs.map((p) => p.text).join('\n');
  return {
    text,
    paragraphs,
    hasText: text.trim().length > 0,
    reason: text.trim() ? null : 'empty document body',
  };
}
