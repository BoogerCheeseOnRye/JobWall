// Re-read the four public resume samples and snapshot the real analysis.
// Run from the repo root: node research/collect.mjs
//
// This spends network time on the live job feed (and GitHub quota only for the
// profile control case). The paper build reads the snapshots, so it does not
// need the network again.

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readResume } from '../docs/lib/resume-source.js';
import { score } from '../docs/lib/analyze.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const samples = join(root, 'research', 'samples');
const outDir = join(root, 'research', 'data');

const CASES = [
  ['sourabh-bajaj', 'sourabh-bajaj.pdf'],
  ['deedy-das', 'deedy-das.pdf'],
  ['lawrence-du', 'lawrence-du.docx'],
  ['sebastian-villa-cuellar', 'sebastian-villa-cuellar.docx'],
];

await mkdir(outDir, { recursive: true });

for (const [id, file] of CASES) {
  const bytes = await readFile(join(samples, file));
  const t0 = Date.now();
  const read = await readResume(bytes, file);
  if (!read.resume) {
    console.error(`${id}: ${read.reason || 'could not read'}`);
    continue;
  }
  const result = await score({ kind: 'resume', owner: read.resume.name || 'resume' }, read.profile);
  result.tookMs = Date.now() - t0;
  result.resume = read.resume;
  result.resumeSource = read;
  await writeFile(join(outDir, `${id}.json`), JSON.stringify(result));
  console.log(
    `${id}: ${result.tookMs}ms · ${result.skills.length} skills · ${result.roles
      .slice(0, 3)
      .map((r) => `${r.title} ${r.fit}`)
      .join(', ')} · ${read.resume.warnings.length} warnings`
  );
}
