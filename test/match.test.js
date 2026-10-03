import test from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

import { parseTarget } from '../docs/lib/github.js';
import { detect } from '../docs/lib/extract.js';
import { scoreRoles, seniorityOf, isEntryFriendly } from '../docs/lib/roles.js';
import { scoreJob, fetchFeed } from '../docs/lib/jobs.js';
import { boardLinks, combinationQueries } from '../docs/lib/search.js';

test('parseTarget understands every shape a person might paste', () => {
  assert.deepEqual(parseTarget('https://github.com/BoogerCheeseOnRye/SecMesh'), {
    kind: 'repo', owner: 'BoogerCheeseOnRye', repo: 'SecMesh',
  });
  assert.deepEqual(parseTarget('github.com/a/b.git'), { kind: 'repo', owner: 'a', repo: 'b' });
  assert.deepEqual(parseTarget('a/b'), { kind: 'repo', owner: 'a', repo: 'b' });
  assert.deepEqual(parseTarget('BoogerCheeseOnRye'), { kind: 'profile', owner: 'BoogerCheeseOnRye', repo: null });
  assert.deepEqual(parseTarget('  https://github.com/a/b/tree/main  '), { kind: 'repo', owner: 'a', repo: 'b' });
  assert.throws(() => parseTarget('https://gitlab.com/a/b'), /github/);
  assert.throws(() => parseTarget(''), /Paste/);
});

test('repo bytes become the dominant skills', () => {
  const ev = detect({
    languages: { JavaScript: 8_000_000, HTML: 600_000, Shell: 40_000, Python: 3_000 },
    deps: { three: '0.160.0' },
    readme: 'GLSL vertex shader pass, post-quantum Kyber mesh defense. WebGL via three.js r160.',
    paths: ['app/lib/shaders/main.vert', 'node-tests/selfcheck.mjs', 'app/serve.js'],
  });
  const skills = ev.top(30);
  const ids = skills.map((s) => s.id);
  assert.ok(ids.includes('threejs'), 'vendored three.js should register');
  assert.ok(ids.includes('glsl'), 'shader filenames + prose should register');
  assert.ok(ids.includes('pqc'), 'post-quantum/kyber should register');
  assert.ok(ids.includes('shell'));

  const js = skills.find((s) => s.id === 'javascript');
  const py = skills.find((s) => s.id === 'python');
  assert.ok(js.score > py.score, 'JavaScript outranks Python when bytes say so');
  assert.ok(js.why[0].text.includes('JavaScript'), 'every skill carries its evidence');
});

test('prose cannot outrank a dependency, no matter how loud it is', () => {
  const shouted = detect({ readme: 'three.js webgl shaders '.repeat(80), languages: {} }).top(10);
  const actual = detect({
    deps: { three: '0.160.0' },
    languages: { JavaScript: 1_000_000 },
  }).top(10);
  const a = shouted.find((s) => s.id === 'threejs');
  const b = actual.find((s) => s.id === 'threejs');
  assert.ok(a && b, 'both detect three.js');
  assert.ok(a.confidence <= 0.6, `prose is capped at the prose ceiling, got ${a.confidence}`);
  assert.ok(b.confidence > a.confidence, `declared dependency (${b.confidence}) beats 80 README mentions (${a.confidence})`);
});

test('vendored library files are not read as your own work', () => {
  const ev = detect({
    languages: { JavaScript: 500_000 },
    paths: [
      'node_modules/three/build/three.module.js',
      'app/lib/addons/physics/AmmoPhysics.js',
      'app/lib/addons/libs/meshopt_decoder.module.js',
      'app/lib/addons/helpers/LightProbeHelper.js',
      'public/app.min.js',
    ],
  });
  const byId = new Map(ev.top(20).map((s) => [s.id, s]));
  assert.equal(byId.has('gameengine'), false, 'AmmoPhysics.js is three.js, not your game engine');
  assert.equal(byId.has('networking'), false, 'meshopt_decoder.js is a vendored decoder');
  assert.equal(byId.has('security'), false, 'LightProbeHelper.js contains "Probe" but is a helper');
  assert.equal(byId.has('threejs'), false, 'three.js itself is vendored, only the manifest counts it');
});

test('roles rank by coverage and say why', () => {
  const skills = detect({
    languages: { JavaScript: 8_000_000, HTML: 600_000 },
    deps: { three: '0.160.0' },
    readme: 'WebGL shaders, three.js, post-quantum Kyber, mesh defense, self-check test suite.',
    paths: ['app/main.vert', 'node-tests/selfcheck.mjs'],
  }).top(26);
  const roles = scoreRoles(skills);
  assert.ok(roles.length, 'at least one role clears the floor');
  assert.ok(roles[0].fit >= roles[roles.length - 1].fit, 'sorted descending');
  const top = roles[0];
  assert.ok(['Graphics / WebGL Engineer', 'Application / Product Security Engineer', 'Frontend Engineer'].includes(top.title));
  assert.ok(top.matched.every((m) => m.label), 'matched entries are labelled');
  assert.ok(top.coreFit <= 100 && top.coreFit >= 0);
  // No role may be advertised while its core skills are absent.
  for (const r of roles) assert.ok(r.coreFit > 0 || r.fit < 45, `${r.title} cannot claim fit without core evidence`);
});

test('an empty submission produces no confident nonsense', () => {
  const roles = scoreRoles(detect({ languages: {}, deps: {}, readme: '' }).top(10));
  assert.equal(roles.length, 0);
});

test('seniority and gates are read from the posting, not guessed', () => {
  assert.equal(seniorityOf('Senior Frontend Engineer'), 'senior');
  assert.equal(seniorityOf('Junior Developer'), 'entry');
  assert.equal(seniorityOf('Software Engineer'), 'unspecified');
  assert.ok(isEntryFriendly('Internship 2026'));

  const skills = detect({
    languages: { JavaScript: 9_000_000, HTML: 700_000 },
    deps: { three: '0.160.0' },
    readme: 'WebGL, three.js, GLSL shaders, JavaScript, HTML, node http server.',
    paths: ['app/main.vert'],
  }).top(26);
  const roles = scoreRoles(skills);

  const base = {
    title: 'WebGL Graphics Engineer',
    company: 'Testco',
    url: 'https://example.com/job/1',
    location: 'Remote',
    remote: true,
    tags: ['webgl', 'three.js', 'shaders'],
    category: 'Graphics',
    level: '',
    description: 'You will build real-time WebGL scenes with three.js and GLSL shaders. JavaScript and HTML.',
    publishedAt: new Date().toISOString(),
  };
  const gated = { ...base, description: `${base.description} Requires 7+ years of experience and a Bachelor's degree in Computer Science. Must have TS/SCI clearance.`, level: 'Senior' };

  const a = scoreJob(base, { skills, roles });
  const b = scoreJob(gated, { skills, roles });

  assert.ok(a.match >= 70, `well-matched posting should score high, got ${a.match}`);
  assert.equal(a.role.id, 'graphics-webgl');
  assert.ok(a.matched.some((m) => m.label === 'GLSL / Shaders'), 'GLSL matched via alias terms');
  assert.equal(a.gates.length, 0);

  assert.ok(b.gates.length >= 3, 'years, degree and clearance all flagged');
  assert.ok(b.gates.some((g) => /years/.test(g.text)));
  assert.ok(b.gates.some((g) => /degree/.test(g.text)));
  assert.ok(b.realistic < b.match, 'realistic score must be lower than raw evidence score');
  assert.ok(b.match < a.match, 'gated posting scores lower than the clean one');
});

test('gaps are reported: the job asks for things the code does not show', () => {
  const skills = detect({ languages: { JavaScript: 5_000_000 }, readme: 'three.js webgl', deps: { three: '1' } }).top(20);
  const roles = scoreRoles(skills);
  const j = scoreJob({
    title: 'Frontend Engineer',
    company: 'React Shop',
    url: 'https://example.com/job/2',
    location: 'Remote',
    remote: true,
    tags: ['react', 'typescript', 'graphql', 'terraform'],
    category: 'Engineering',
    level: '',
    description: 'React and TypeScript required. GraphQL, Terraform and Kubernetes experience. Kafka.',
    publishedAt: new Date().toISOString(),
  }, { skills, roles });
  assert.ok(j.wants.length > 0, 'unproven asks get surfaced');
  assert.ok(j.wants.some((w) => /terraform|kubernetes|kafka/i.test(`${w.label} ${w.asks.join(' ')}`)), 'infra asks surfaced');
});

test('a flattering description cannot rescue an unrelated job title', () => {
  const skills = detect({
    languages: { JavaScript: 9_000_000, HTML: 600_000 },
    deps: { three: '0.160.0' },
    readme: 'WebGL, three.js, JavaScript, security defense.',
    paths: ['app/main.vert'],
  }).top(26);
  const roles = scoreRoles(skills);
  const mk = (title, description) => ({
    title, company: 'C', url: `https://e.com/${title}`, location: 'Remote', remote: true,
    tags: [], category: '', level: '', description, publishedAt: new Date().toISOString(),
  });

  const relevant = scoreJob(mk('WebGL Graphics Engineer', 'Real-time WebGL with three.js and JavaScript.'), { skills, roles });
  const pm = scoreJob(mk('Product Manager', 'Our quantum networking security platform needs a Product Manager to own the roadmap and coordinate the security engineering team.'), { skills, roles });
  const assistant = scoreJob(mk('Remote Office Assistant', 'Support our JavaScript, three.js and WebGL engineering team with scheduling and office tasks.'), { skills, roles });

  assert.ok(relevant.match > pm.match, `relevant ${relevant.match} must beat product manager ${pm.match}`);
  assert.ok(relevant.match > assistant.match, `relevant ${relevant.match} must beat assistant ${assistant.match}`);
  assert.ok(pm.gates.some((g) => g.id === 'nondev'), 'product manager flagged as non-engineering');
  assert.ok(assistant.gates.some((g) => g.id === 'nondev'), 'office assistant flagged as non-engineering');
  assert.ok(pm.realistic < pm.match, 'and its realistic score reflects that');
});

test('generic title words are not evidence', () => {
  const skills = detect({ languages: { JavaScript: 8_000_000 }, readme: 'react html css frontend' }).top(26);
  const roles = scoreRoles(skills);
  const j = scoreJob({
    title: 'Software Engineer, Product Team',
    company: 'C', url: 'https://e.com/x', location: 'Remote', remote: true, tags: [], category: '',
    level: '', description: 'Work with our product team on software.', publishedAt: new Date().toISOString(),
  }, { skills, roles });
  assert.ok(j.role?.titleScore <= 0.34, `only generic words matched, got ${j.role?.titleScore}`);
});

test('years gates scale with the number asked for', () => {
  const skills = detect({ languages: { JavaScript: 8_000_000 }, readme: 'javascript html frontend react' }).top(26);
  const roles = scoreRoles(skills);
  const mk = (years) => ({
    title: 'Frontend Developer', company: 'C', url: `https://e.com/${years}`, location: 'Remote', remote: true,
    tags: ['react'], category: '', level: '',
    description: `You have ${years} years of experience building React interfaces in JavaScript and HTML.`,
    publishedAt: new Date().toISOString(),
  });
  const one = scoreJob(mk(1), { skills, roles });
  const eight = scoreJob(mk(8), { skills, roles });
  assert.ok(one.gates.some((g) => g.id === 'years' && /1\+ years/.test(g.text)));
  assert.ok(eight.gates.some((g) => g.id === 'years' && /8\+ years/.test(g.text)));
  assert.ok(one.realistic - one.match > eight.realistic - eight.match, 'asking 1 year costs less than asking 8');
  assert.ok(!/undefined/.test(one.gates.map((g) => g.text).join(' ')), 'capture groups survive');
});

test('the UI only references element ids that exist in the page', async () => {
  const html = await readFile(new URL('../docs/index.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../docs/app.js', import.meta.url), 'utf8');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const referenced = [...js.matchAll(/\$\('#([\w-]+)'\)/g)].map((m) => m[1]);
  assert.ok(referenced.length > 8, `sanity: found ${referenced.length} id lookups`);
  const missing = [...new Set(referenced)].filter((id) => !ids.has(id));
  assert.deepEqual(missing, [], `app.js references ids absent from index.html: ${missing.join(', ')}`);

  // Every role/job field the renderer reads must survive the API contract.
  const { scoreJob } = await import('../docs/lib/jobs.js');
  const skills = detect({ languages: { JavaScript: 9_000_000 }, readme: 'javascript html css', deps: {} }).top(26);
  const roles = scoreRoles(skills);
  const scored = scoreJob({
    title: 'Frontend Developer', company: 'C', url: 'https://e.com/1', location: 'Remote', remote: true,
    tags: ['react'], category: '', level: 'Junior',
    description: 'React and JavaScript and HTML and CSS required. 5+ years of experience.',
    publishedAt: new Date().toISOString(),
    sourceName: 'Test', sourceUrl: 'https://e.com', salary: '$100k',
  }, { skills, roles });
  for (const field of ['title', 'company', 'url', 'location', 'remote', 'salary', 'level', 'match', 'realistic', 'gates', 'matched', 'wants', 'publishedAt', 'sourceName', 'sourceUrl', 'role', 'alsoOn']) {
    assert.ok(field in scored, `job payload must carry "${field}"`);
  }
  const { SOURCES } = await import('../docs/lib/jobs.js');
  for (const s of SOURCES) {
    const job = s.map({ title: 'x', company: 'y', url: 'https://e.com/2', location: '', remote: true, tags: [], job_types: [], created_at: 0 });
    assert.ok(job === null || job.url, `${s.id} mapper produces an apply link`);
  }
});

test('search links are real, absolute, and per-board', () => {
  const links = boardLinks('WebGL engineer three.js');
  assert.equal(links.length, 8);
  for (const l of links) assert.ok(l.url.startsWith('https://'), `${l.name} must be https`);
  const li = links.find((l) => l.id === 'linkedin');
  assert.ok(li.url.includes('keywords=WebGL%20engineer%20three.js'));
  // Default is aimed at the reader's city, not "anywhere".
  const indeed = links.find((l) => l.id === 'indeed').url;
  assert.ok(indeed.includes('Seattle'), `Indeed should target Seattle, got ${indeed}`);
  assert.ok(links.find((l) => l.id === 'builtin').url.includes('builtinseattle.com'));
});

test('combination queries are built from real skills, deduplicated', () => {
  const skills = detect({ languages: { JavaScript: 5_000_000, Python: 90_000 }, deps: { three: '1', react: '18' }, readme: 'webgl shaders' }).top(20);
  const roles = scoreRoles(skills);
  const combos = combinationQueries(skills, roles);
  assert.ok(combos.length >= 2);
  assert.equal(new Set(combos.map((c) => c.toLowerCase())).size, combos.length, 'no duplicate queries');
  assert.ok(combos.some((c) => /three|react|webgl/i.test(c)), 'combination query reflects the actual stack');
});

test('live feeds parse and normalize into comparable jobs', async (t) => {
  const feed = await fetchFeed();
  const ok = feed.sources.filter((s) => s.ok);
  assert.ok(ok.length >= 1, `at least one live feed worked: ${JSON.stringify(feed.sources)}`);
  assert.ok(feed.jobs.length > 100, `feed has volume, got ${feed.jobs.length}`);
  for (const j of feed.jobs.slice(0, 50)) {
    assert.ok(j.title && j.url.startsWith('https://'), 'every job has a title and an https url');
    assert.ok(j.source && j.sourceName);
    assert.ok(!/<[a-z]/i.test(j.description.slice(0, 200)), 'HTML stripped from description');
  }
  const keys = new Set(feed.jobs.map((j) => `${j.title}|${j.company}`.toLowerCase()));
  assert.equal(keys.size, feed.jobs.length, 'cross-board duplicates collapsed');
});

// ------------------------------------------------------------------- wages
test('wage ranges come from the posting, not from a guess', async () => {
  const { parseWage, formatWage } = await import('../docs/lib/wages.js');

  assert.deepEqual(parseWage('Salary Range €117.200 &mdash; €146.500 EUR'), {
    min: 117200, max: 146500, currency: 'EUR', period: 'year', raw: '€117.200 – €146.500',
  });
  assert.equal(parseWage('Pay Range: (GBP) £81,000 - £100,000').min, 81000);
  assert.equal(parseWage('Day rate: £500-£750').period, 'day');
  assert.equal(parseWage('Rate is $90 - $150 /hour').period, 'hour');
  assert.equal(parseWage('€1,200 – €1,400 per month').period, 'month');
  assert.equal(parseWage('Rate 60-80 per hour').max, 80, 'k-scaled hourly must be undone');
  assert.equal(parseWage('base salary 120k-150k').currency, null, 'a bare range gets no invented currency');

  assert.equal(formatWage({ min: 95000, max: 180000, currency: 'USD', period: 'year' }).label, '$95k–$180k/yr');
  assert.equal(formatWage({ min: 60000, max: 120000, currency: 'GBP', period: 'year' }, { rates: { GBP: 0.75 } }).usdLabel, '$80k–$160k/yr');
});

test('money that is not pay is not read as pay', async () => {
  const { parseWage } = await import('../docs/lib/wages.js');
  // Every one of these mentions a pay-shaped number in a non-pay context.
  for (const text of [
    'Over $200B in annualized spend flows through us',
    'we raised $100M in a Series B round',
    'annual budget of $2,000,000 across the team',
    'OTE of $20M - $50M per year',
    'processed $4M in revenue last quarter',
  ]) {
    assert.equal(parseWage(text), null, `should not read a wage from: ${text}`);
  }
});

test('a broken feed salary field is dropped rather than shown', async () => {
  const { fetchFeed } = await import('../docs/lib/jobs.js');
  const feed = await fetchFeed();
  const out = feed.jobs.filter((j) => {
    const g = j.wage;
    if (!g) return false;
    const lo = { year: 8e3, hour: 3, day: 40, month: 200 }[g.period];
    const hi = { year: 1.5e6, hour: 800, day: 2e4, month: 6e4 }[g.period];
    return g.min < lo || g.max > hi || g.max / g.min > 6;
  });
  assert.deepEqual(out.map((j) => j.title), [], 'no card may show an implausible wage');
});
