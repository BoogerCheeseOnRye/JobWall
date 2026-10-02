import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);

// docs/lib runs unchanged in a browser, so it must not touch a Node global.
// A browser has no `process` at all, and merely mentioning it throws
// ReferenceError rather than evaluating to undefined — so a Node test run
// cannot catch this class of bug on its own. These tests run the real analysis
// in a child process with `process` deleted from the global scope.
//
// Buffer is deliberately left alone: Node's own fetch implementation needs it,
// and browsers have a native fetch. Nothing in docs/ uses Buffer anyway, which
// the scan below enforces.

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const BROWSER_RUN = `
const TARGET = process.env.TEST_TARGET;   // read before process is gone
delete globalThis.process;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.endsWith('/api/health')) {
    return { ok: false, status: 404, statusText: 'Not Found',
             text: async () => '<html>404</html>',
             json: async () => { throw new SyntaxError('x'); } };
  }
  return realFetch(url, init);
};
const api = await import(${JSON.stringify(new URL('../docs/api.js', import.meta.url).href)});
const { probe, analyze } = api;
await probe();
const r = await analyze(TARGET);
console.log(JSON.stringify({
  scanned: r.jobs.scanned,
  matched: r.jobs.results.length,
  roles: r.roles.length,
}));
`;

test('a full analysis runs with no `process` global, as in a browser', async () => {
  const { stdout } = await run(
    process.execPath,
    ['--input-type=module', '--eval', BROWSER_RUN],
    { cwd: ROOT, env: { ...process.env, TEST_TARGET: 'BoogerCheeseOnRye/SecMesh' } },
  );
  const out = JSON.parse(stdout.trim().split('\n').pop());
  assert.ok(out.scanned > 0, 'the job feeds answered');
  assert.ok(out.matched > 0, 'openings were scored');
  assert.ok(out.roles > 0, 'roles were bucketed');
});

test('no browser-shipped file reaches for a Node global', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const files = [
    'docs/app.js',
    'docs/api.js',
    ...(await readdir(new URL('../docs/lib/', import.meta.url))).map((f) => `docs/lib/${f}`),
  ];
  // `process` is only a bug when it is read unguarded. `typeof process !==
  // 'undefined' && process.env` is the correct way to ask, and a browser needs
  // it — the runtime test above is the real guarantee, this catches the rest.
  const alwaysWrong = [
    /(^|[^.\w])Buffer\s*\./,
    /(^|[^.\w])require\s*\(/,
    /(^|[^\w])(__dirname|__filename)\b/,
  ];
  const processRef = /(^|[^.\w])process\s*\./;
  const offenders = [];
  for (const rel of files) {
    if (!rel.endsWith('.js')) continue;
    const src = await readFile(new URL(`../${rel}`, import.meta.url), 'utf8');
    // Ignore comments so prose about process.env does not trip the scan.
    const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const re of alwaysWrong) {
      if (re.test(code)) offenders.push(`${rel}: ${re}`);
    }
    if (processRef.test(code) && !/typeof\s+process\b/.test(code)) {
      offenders.push(`${rel}: process read without a typeof guard`);
    }
  }
  assert.deepEqual(offenders, [], `Node globals in browser-shipped code: ${offenders.join(', ')}`);
});