#!/usr/bin/env node
// Offline resume reader. No network, no dependencies.
//
//   node tools/resume-cli.mjs <file.pdf|docx|txt|md> [--json] [--text] [--claims]
//
// Used to iterate on the parser against real resumes without booting the site.

import fs from 'node:fs';
import path from 'node:path';
import { readResume } from '../docs/lib/resume-source.js';

const line = (label, value) => `${label.padEnd(18)}${value}`;

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const files = args.filter((a) => !a.startsWith('--'));
  if (!files.length) {
    console.error('usage: node tools/resume-cli.mjs <file> [--json] [--text] [--claims]');
    process.exit(2);
  }

  for (const file of files) {
    let read;
    try {
      read = await readResume(new Uint8Array(fs.readFileSync(file)), path.basename(file));
    } catch (err) {
      console.error(`${path.basename(file)}: unreadable (${err.message})`);
      continue;
    }

    if (flags.has('--text')) {
      console.log(`===== ${path.basename(file)} (${read.format}) =====`);
      console.log(read.text);
      console.log();
      continue;
    }

    const resume = read.resume;

    if (flags.has('--json')) {
      console.log(JSON.stringify({ file, ...read, resume }, null, 2));
      continue;
    }

    const s = resume.stats;
    console.log(`\n\x1b[1m${path.basename(file)}\x1b[0m  \x1b[2m${read.format}${read.pages ? ` / ${read.pages}p` : ''}\x1b[0m`);
    if (read.reason) console.log(line('  !', `\x1b[33m${read.reason}\x1b[0m`));
    console.log(line('  chars', s.chars) + `  \x1b[2msections=${s.sections} skills=${s.skills} exp=${s.experience} proj=${s.projects}\x1b[0m`);
    console.log(line('  name', resume.name || '\x1b[33m—\x1b[0m'));
    console.log(line('  contact', [resume.contact.email, resume.contact.phone, resume.contact.location].filter(Boolean).join('  ') || '—'));
    console.log(line('  links', Object.entries(resume.contact.links).map(([k, v]) => `${k}: ${v}`).join('  ') || '—'));
    if (resume.summary) console.log(line('  summary', resume.summary.slice(0, 150) + (resume.summary.length > 150 ? '…' : '')));

    for (const g of resume.skills) {
      console.log(line(`  skills/${g.category.toLowerCase().replace(/\s+/g, '-')}`, `${g.items.length}: ${g.items.slice(0, 6).join(', ')}${g.items.length > 6 ? ', …' : ''}`));
    }

    for (const e of resume.experience) {
      const when = [e.start?.raw, e.end?.raw].filter(Boolean).join(' - ') || '—';
      if (e.kicker) {
        console.log(line('  note', `${e.kicker} \x1b[2m${e.bullets.join(' ').slice(0, 80)}\x1b[0m`));
        continue;
      }
      const where = e.org || e.location || '?';
      console.log(line('  role', `${e.title || '?'} \x1b[2mat ${where}${e.org && e.location ? ` (${e.location})` : ''} (${when}) ${e.bullets.length} bullets\x1b[0m`));
    }

    for (const p of resume.projects) {
      console.log(line('  project', `${p.name} \x1b[2m${p.url || ''} ${(p.description || p.bullets.join(' ')).slice(0, 70)}\x1b[0m`));
    }

    for (const e of resume.education) {
      console.log(line(`  edu/${(e.type || 'x').toLowerCase().replace(/\s+/g, '-')}`, (e.detail || e.bullets.join(' ')).slice(0, 90)));
    }

    if (flags.has('--claims')) {
      const claims = read.claims;
      console.log(line('  repo claims', claims.length ? claims.map((c) => `${c.owner}/${c.repo} (${c.sources.join('+')})`).join('  ') : '—'));
      const profile = read.profile;
      console.log(line('  languages', Object.entries(profile.languages).map(([k, v]) => `${k}:${v}`).join(' ') || '—'));
    }

    for (const w of resume.warnings) console.log(line('  warn', `\x1b[33m${w}\x1b[0m`));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
