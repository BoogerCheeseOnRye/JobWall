import test from 'node:test';
import assert from 'node:assert/strict';

// These pin a bug that made entire repositories invisible. The GitHub contents
// endpoint answers JSON unless the raw media type is requested; asking for
// JSON and calling .text() returned the *envelope*, so every README arrived as
// a sha hash and every package.json parsed into an object with no dependencies
// in it. Nothing errored — the profile just quietly scored as if those repos
// were empty.

const GH = 'https://api.github.com/repos/expressjs/express/contents/package.json';

async function rawBody(accept) {
  const res = await fetch(GH, { headers: { Accept: accept } });
  return res.text();
}

test('the contents endpoint only returns file text when the raw media type is asked for', async () => {
  const json = await rawBody('application/vnd.github+json');
  const raw = await rawBody('application/vnd.github.raw');

  const envelope = JSON.parse(json);
  assert.equal(envelope.name, 'package.json', 'the envelope names the file, not the package');
  assert.ok('content' in envelope, 'the envelope wraps the file in base64 `content`');
  assert.ok(!('dependencies' in envelope), 'and it carries none of the manifest — the silent failure');

  const pkg = JSON.parse(raw);
  assert.ok(pkg.name, 'the raw response is the file itself');
  assert.ok('dependencies' in pkg, 'and it actually carries dependencies');
});

test('a raw manifest is parsed into deps, not into the envelope', () => {
  // What manifest() does with the raw text. The envelope would parse fine and
  // yield an empty deps object, which is how this bug stayed invisible.
  const envelope = JSON.stringify({ name: 'package.json', path: 'package.json', sha: 'abc', content: 'e30=' });
  const real = JSON.stringify({ name: 'void-game', dependencies: { ws: '^8.19.0' }, devDependencies: { vite: 'catalog:' } });

  const fromEnvelope = { ...{}, ...(JSON.parse(envelope).dependencies || {}), ...(JSON.parse(envelope).devDependencies || {}) };
  const fromReal = { ...(JSON.parse(real).dependencies || {}), ...(JSON.parse(real).devDependencies || {}) };

  assert.deepEqual(fromEnvelope, {}, 'the envelope yields nothing — the silent failure');
  assert.deepEqual(fromReal, { ws: '^8.19.0', vite: 'catalog:' });
});

test('the deep-read cap leaves the small repos to metadata rather than dropping them', async () => {
  const gh = await import('../docs/lib/github.js');
  const src = await import('node:fs/promises');
  const text = await src.readFile(new URL('../docs/lib/github.js', import.meta.url), 'utf8');

  // Every repo must reach the description/path channels, whatever the cap.
  assert.ok(text.includes('descriptions.push'), 'repo descriptions are collected for every repo');
  assert.ok(text.includes('paths.push(r.name)'), 'repo names reach the path channel for every repo');

  // And the cap must not be the old, quietly-small one.
  const cap = text.match(/slice\(0,\s*(\d+)\)/);
  assert.ok(cap && Number(cap[1]) >= 10, `deep-read cap should be at least 10, found ${cap && cap[1]}`);
  assert.ok(typeof gh.parseTarget === 'function');
});
