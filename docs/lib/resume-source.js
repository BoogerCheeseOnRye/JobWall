// One resume reader for every caller: the CLI, the browser upload, the tests.
// Sniffs the bytes rather than trusting the extension, because a .pdf that is
// really a .docx (or a text file named .pdf) is common enough to break on.

import { extractPdfText } from './pdf.js';
import { extractDocxText } from './docx.js';
import { parseResume, resumeRepoClaims, resumeToProfile } from './resume.js';

export const ACCEPTED = '.pdf,.docx,.txt,.md,application/pdf,text/plain,text/markdown';

function sniff(buf) {
  return {
    pdf: buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46, // %PDF
    zip: buf[0] === 0x50 && buf[1] === 0x4b, // PK
    doc: buf[0] === 0xd0 && buf[1] === 0xcf, // legacy OLE2 .doc
  };
}

const extOf = (name = '') => String(name).toLowerCase().split('.').pop() || '';

// Takes bytes, not a path: the browser has no filesystem, and the CLI is the
// only caller that reads files itself.
export async function extractResumeText(input, name = '') {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const ext = extOf(name);
  const kind = sniff(bytes);

  if (kind.pdf || ext === 'pdf') {
    const r = await extractPdfText(bytes);
    return { text: r.text, paragraphs: null, format: 'pdf', pages: r.pages, hasText: r.hasText, reason: r.reason };
  }
  if (kind.zip || ext === 'docx') {
    const r = await extractDocxText(bytes);
    return { text: r.text, paragraphs: r.paragraphs, format: 'docx', pages: null, hasText: r.hasText, reason: r.reason };
  }
  if (kind.doc) {
    return {
      text: '',
      paragraphs: null,
      format: 'doc',
      pages: null,
      hasText: false,
      reason: 'legacy .doc (Word 97-2003) is not supported — save it as .docx or PDF',
    };
  }
  const text = new TextDecoder('utf-8').decode(bytes);
  return {
    text,
    paragraphs: null,
    format: ext || 'txt',
    pages: null,
    hasText: text.trim().length > 0,
    reason: text.trim() ? null : 'file is empty',
  };
}

// File/Blob in, parsed resume out. Works in Node too, which is what lets the
// browser path be tested without a browser.
export async function readResume(input, name = '') {
  const label = name || (input && input.name) || '';
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(await input.arrayBuffer());
  const source = await extractResumeText(bytes, label);
  if (!source.hasText) return { ...source, name: label, resume: null, claims: [], profile: null };
  const resume = parseResume(source.text, { paragraphs: source.paragraphs });
  return {
    ...source,
    name: label,
    resume,
    claims: resumeRepoClaims(resume),
    profile: resumeToProfile(resume),
  };
}

// Human sentence for a failed read, phrased as an instruction.
export function readError(source) {
  if (!source) return 'That file could not be read.';
  if (source.format === 'doc') return source.reason;
  if (/no text layer/i.test(source.reason || '')) {
    return 'That PDF has no text layer — it is probably a scan or an image. Export a text-based PDF and try again.';
  }
  if (/encrypted/i.test(source.reason || '')) return 'That PDF is password protected. Remove the password and try again.';
  return source.reason || 'That file could not be read as a resume.';
}
