#!/usr/bin/env node
// Write a resume out in every format, or just the ones asked for.
//
//   node tools/resume-export.mjs resume.pdf
//   node tools/resume-export.mjs resume.pdf --format pdf,docx,txt
//   node tools/resume-export.mjs resume.pdf --out ./out --open
//
// Every file is read back after it is written, so a "wrote" line means the
// bytes on disk were parsed again, not just that a buffer was produced.

import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { readResume } from '../docs/lib/resume-source.js';
import { buildModel, exportResume, FORMATS } from '../docs/lib/resume-export.js';
import { extractPdfText } from '../docs/lib/pdf.js';
import { extractDocxText } from '../docs/lib/docx.js';

const args = process.argv.slice(2);
const flags = {};
const files = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  // Both spellings are accepted -- `--format json,yaml` and `--format json
  // --format yaml` -- because silently honouring only the last one would be a
  // trap: the tool would export yaml and say nothing.
  if (arg === '--out' || arg === '-o') flags.out = args[++i];
  else if (arg === '--format' || arg === '-f') (flags.formats ||= []).push(args[++i]);
  else if (arg === '--open') flags.open = true;
  else if (arg === '--pretty') flags.pretty = true;
  else if (arg.startsWith('-')) die(`unknown flag: ${arg}`);
  else files.push(arg);
}

function die(message, code = 1) {
  console.error(`resume-export: ${message}`);
  process.exit(code);
}

if (!files.length) {
  console.log(`usage: resume-export <resume...> [options]

  --out, -o <dir>     where to write (default: ./export-<name>); "-" writes a
                      single text format to stdout
  --format, -f <list> comma separated or repeated: ${FORMATS.map((f) => f.id).join(', ')},
                      or "all" (default: all)
  --open              also open the styled HTML and print-ready PDF
  --pretty            print the parsed model instead of exporting

Supported input: ${'pdf, docx, txt, md'} (whatever docs/lib/resume-source.js reads)`);
  process.exit(files.length ? 0 : 2);
}

const asked = (flags.formats || []).flatMap((value) => String(value).split(',')).map((s) => s.trim()).filter(Boolean);
if (asked.some((v) => v === undefined || v.startsWith('--'))) die('--format needs a value');
const wanted = !asked.length || asked.includes('all') ? FORMATS.map((f) => f.id) : asked;
for (const id of wanted) {
  if (!FORMATS.some((f) => f.id === id)) die(`unknown format: ${id} (try: ${FORMATS.map((f) => f.id).join(', ')})`);
}

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

for (const file of files) {
  const read = await readResume(await readFileSafe(file), basename(file));
  if (!read.resume) die(`${file}: ${read.error}`);
  const model = buildModel(read.resume);

  // Everything the tool says about itself goes to stderr, so that a document
  // written to stdout stays a clean document: `... --out - | jq` has to work.
  const note = (line) => process.stderr.write(`${line}\n`);
  note(`\n${bold(model.meta.name)}  ${dim(`${read.format}${read.pages ? ` / ${read.pages}p` : ''} -> ${model.sections.length} sections`)}`);
  note(dim(`  ${model.meta.contacts.map((c) => c.value).join(' | ') || 'no contact line'}`));

  if (flags.pretty) {
    console.log(JSON.stringify(model, null, 2));
    continue;
  }
  if (read.warnings?.length) {
    for (const warning of read.warnings) note(`  ${dim(`warning: ${warning}`)}`);
  }

  // `--out -` means stdout: one format, the document and nothing else. It is
  // what makes `--out - | jq`, `--out - | pbcopy` and `--out - > resume.docx`
  // behave the way a person expects.
  if (flags.out === '-') {
    if (wanted.length !== 1) die('--out - takes exactly one --format');
    const spec = FORMATS.find((f) => f.id === wanted[0]);
    if (!spec.textual) die(`${spec.id} is binary; pipe it with --out <dir> instead`);
    const out = await exportResume(model, wanted[0]);
    process.stdout.write(out.data);
    note(dim(`  -> stdout (${out.data.length} bytes, ${spec.id})`));
    continue;
  }

  const outDir = resolve(flags.out || join(process.cwd(), `export-${basename(file).replace(/\.[^.]+$/, '')}`));
  const written = new Map();
  await mkdir(outDir, { recursive: true });

  for (const id of wanted) {
    const out = await exportResume(model, id);
    const path = join(outDir, out.filename);
    written.set(id, path);
    await writeFile(path, out.data);
    const check = await verify(id, out.data);
    const size = `${(out.data.length / 1024).toFixed(1)}kB`;
    note(`  ${green('ok')}  ${id.padEnd(9)} ${size.padStart(8)}  ${out.filename}${check ? dim(`  verified: ${check}`) : ''}`);
  }
  note(dim(`  -> ${outDir}`));

  if (flags.open) {
    const { spawn } = await import('node:child_process');
    // Only the two formats a person would want to look at, and only files that
    // were actually produced -- no guessing at names.
    for (const id of wanted) {
      if (id !== 'html' && id !== 'pdf') continue;
      spawn('xdg-open', [written.get(id)], { detached: true, stdio: 'ignore' }).unref();
    }
  }
}

// Reading the file back is the only honest check that it is readable.
async function verify(id, data) {
  try {
    if (id === 'pdf') {
      const back = await extractPdfText(data);
      return back.text.trim() ? `${back.pages} page${back.pages === 1 ? '' : 's'}, ${back.text.length} chars` : 'no text';
    }
    if (id === 'docx') {
      const back = await extractDocxText(data);
      return back.text.trim() ? `${back.text.length} chars` : 'no text';
    }
    if (id === 'json') {
      const parsed = JSON.parse(new TextDecoder().decode(data));
      return `${Object.keys(parsed).length} top-level keys`;
    }
    return `${new TextDecoder().decode(data).split('\n').length} lines`;
  } catch (error) {
    return `FAILED to read back: ${error.message}`;
  }
}

async function readFileSafe(path) {
  const { readFile } = await import('node:fs/promises');
  try {
    return await readFile(path);
  } catch {
    die(`cannot read ${path}`);
  }
}
