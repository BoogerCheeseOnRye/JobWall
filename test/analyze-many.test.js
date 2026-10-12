// Merging several profiles into one analysis.
//
// The rule that matters: more than one source is still one person, so the
// evidence is combined before scoring, not scored separately and added up.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mergeRaws } from '../docs/lib/analyze.js';

const repoRaw = {
  kind: 'repo',
  owner: 'sampleuser',
  repo: 'SecMesh',
  name: 'sampleuser/SecMesh',
  url: 'https://github.com/sampleuser/SecMesh',
  description: 'Mesh console',
  topics: ['mesh', 'security'],
  stars: 12,
  forks: 2,
  sizeKb: 800,
  languages: { JavaScript: 800000, GLSL: 40000 },
  deps: { three: 1, express: 1 },
  files: ['package.json'],
  tools: { node: true },
  paths: ['index.html', 'main.js', 'shader.frag'],
  readme: '# SecMesh\\nA mesh console.',
};

const profileRaw = {
  kind: 'profile',
  owner: 'sampleuser',
  name: 'sampleuser',
  realName: 'Jane Sample',
  url: 'https://github.com/sampleuser',
  bio: 'edge tooling',
  location: 'Seattle, WA',
  blog: 'https://example.org',
  followers: 30,
  stars: 40,
  forks: 5,
  languages: { JavaScript: 200000, Python: 90000 },
  deps: { express: 3, flask: 1 },
  topics: ['security', 'offline'],
  paths: ['other-proj'],
  files: ['app.py', 'package.json'],
  tools: { python: true },
  repos: [
    { name: 'other-proj', url: 'https://github.com/sampleuser/other-proj', description: 'cli', language: 'Python', stars: 4, forks: 0, pushedAt: '2024-01-01', topics: [], sizeKb: 100, sampled: true },
  ],
  sampledRepos: ['other-proj'],
  repoTotal: 1,
  readme: '# other-proj',
};

test('language bytes are summed across sources', () => {
  const merged = mergeRaws([repoRaw, profileRaw]);
  assert.equal(merged.languages.JavaScript, 1000000);
  assert.equal(merged.languages.Python, 90000);
  assert.equal(merged.languages.GLSL, 40000);
});

test('dependencies are summed, not deduplicated away', () => {
  const merged = mergeRaws([repoRaw, profileRaw]);
  // express appears in both, so its evidence is the sum, not one of the two.
  assert.equal(merged.deps.express, 4);
  assert.equal(merged.deps.three, 1);
});

test('topics, paths and files are unioned without repeats', () => {
  const merged = mergeRaws([repoRaw, profileRaw]);
  assert.deepEqual(merged.topics.sort(), ['mesh', 'offline', 'security']);
  assert.deepEqual(merged.paths.sort(), ['index.html', 'main.js', 'other-proj', 'shader.frag']);
  assert.deepEqual(merged.files.sort(), ['app.py', 'package.json']);
});

test('a bare repo and a profile project both appear, once each', () => {
  const merged = mergeRaws([repoRaw, profileRaw, { ...repoRaw }]);
  const urls = merged.repos.map((r) => r.url);
  assert.equal(new Set(urls).size, urls.length, 'no duplicate project cards');
  assert.ok(urls.includes('https://github.com/sampleuser/SecMesh'));
  assert.ok(urls.includes('https://github.com/sampleuser/other-proj'));
});

test('the members are listed so section 1 can name what was read', () => {
  const merged = mergeRaws([repoRaw, profileRaw]);
  assert.equal(merged.sources.length, 2);
  assert.deepEqual(merged.sources.map((s) => s.kind), ['repo', 'profile']);
  assert.equal(merged.sources[0].fromRepo, 'sampleuser/SecMesh');
  assert.equal(merged.sources[1].fromRepo, null);
});

test('personal details come from whichever source has them', () => {
  const merged = mergeRaws([repoRaw, profileRaw]);
  assert.equal(merged.realName, 'Jane Sample');
  assert.equal(merged.location, 'Seattle, WA');
  assert.equal(merged.blog, 'https://example.org');
  assert.equal(merged.followers, 30);
});

test('a single source merges to itself', () => {
  const merged = mergeRaws([repoRaw]);
  assert.equal(merged.kind, 'multi');
  assert.deepEqual(merged.languages, repoRaw.languages);
  assert.equal(merged.repos.length, 1);
});

test('analyzeMany with one target is the ordinary analysis', async () => {
  // One target must not take the merge path, or adding multi-profile support
  // would change single-profile behaviour.
  const { analyzeMany } = await import('../docs/lib/analyze.js');
  await assert.rejects(() => analyzeMany([]), /no target/);
  await assert.rejects(() => analyzeMany('   '), /no target/);
});
