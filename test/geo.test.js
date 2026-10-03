import test from 'node:test';
import assert from 'node:assert/strict';
import { geoOf, reachableFromUS, SCOPES, DEFAULT_SCOPE, jobGeo } from '../docs/lib/geo.js';
import { WHERE, whereForScope, boardLinks } from '../docs/lib/search.js';

test('"USA" is recognised as US even though no state is named', () => {
  // 85 rows across the feeds carry exactly this string and used to be
  // indistinguishable from a posting with no location at all.
  const g = geoOf('USA');
  assert.equal(g.country, 'US');
  assert.equal(g.known, true);
});

test('"City, ST" resolves the state', () => {
  const g = geoOf('Sarasota, FL');
  assert.equal(g.region, 'FL');
  assert.equal(g.regionName, 'Florida');
  assert.equal(g.city, 'Sarasota');
});

test('a state name without a comma still counts', () => {
  const g = geoOf('Washington');
  assert.equal(g.country, 'US');
  assert.equal(g.region, 'WA');
});

test('the Seattle metro is found, by comma and without one', () => {
  for (const loc of ['Seattle, WA', 'Seattle WA', 'Bellevue, WA', 'Redmond, WA', 'Kirkland, WA']) {
    assert.equal(geoOf(loc).metro, 'seattle', `${loc} should read as Seattle metro`);
  }
});

test('a Seattle-area city in another state is not Seattle', () => {
  // Auburn and Kent are in Washington, but they are also towns in Alabama and
  // Ohio. The name alone must not do it.
  assert.equal(geoOf('Auburn, AL').metro, null);
  assert.equal(geoOf('Kent, OH').metro, null);
  assert.equal(geoOf('Auburn, WA').metro, 'seattle');
});

test('remote and worldwide are open to a Seattle resident, not foreign', () => {
  for (const loc of ['Remote', 'Worldwide', 'Homeoffice', '']) {
    const g = geoOf(loc);
    assert.equal(g.remoteOnly, true, `${loc} should be remote`);
    assert.ok(reachableFromUS(g), `${loc} must stay visible to a US reader`);
  }
});

test('"Remote - Seattle, WA" is both remote and local', () => {
  const g = geoOf('Remote - Seattle, WA');
  assert.equal(g.remoteOnly, true);
  assert.equal(g.metro, 'seattle');
  assert.equal(g.region, 'WA');
});

test('openings we can place elsewhere are identified, not guessed', () => {
  for (const [loc, country] of [['London', 'United Kingdom'], ['Paris, France', 'France'], ['Berlin', 'Germany'], ['Munich, Bavaria', 'Germany']]) {
    const g = geoOf(loc);
    assert.equal(g.known, true, `${loc} should be placed`);
    assert.ok(!reachableFromUS(g), `${loc} must drop out of a US-only view`);
    assert.equal(g.countryName, country);
  }
});

test('an unrecognised city stays visible rather than being filed as foreign', () => {
  // The whole point of "known": absence of evidence is not evidence that a
  // posting is overseas, and hiding it would hide a US job from a US reader.
  const g = geoOf('Quimper');
  assert.equal(g.known, false);
  assert.ok(reachableFromUS(g));
});

test('the US scope keeps US and remote, and drops known-foreign', () => {
  const us = SCOPES.us;
  assert.ok(us.test({ geo: geoOf('Seattle, WA') }));
  assert.ok(us.test({ geo: geoOf('Remote') }));
  assert.ok(us.test({ geo: geoOf('Quimper') }), 'unknown must not be blocked');
  assert.ok(!us.test({ geo: geoOf('Berlin') }));
  assert.ok(!us.test({ geo: geoOf('Paris, France') }));
});

test('the Seattle scope is metro or remote, not the whole country', () => {
  assert.ok(SCOPES.seattle.test({ geo: geoOf('Bellevue, WA') }));
  assert.ok(SCOPES.seattle.test({ geo: geoOf('Remote') }));
  assert.ok(!SCOPES.seattle.test({ geo: geoOf('Portland, OR') }));
  assert.ok(!SCOPES.seattle.test({ geo: geoOf('USA') }));
});

test('scope filters accept a job or a bare geo, so a mix-up cannot pass everything', () => {
  const job = { location: 'Berlin', remote: false };
  assert.ok(!SCOPES[DEFAULT_SCOPE].test(job), 'a job with a foreign location must not slip through');
  assert.ok(!SCOPES[DEFAULT_SCOPE].test(geoOf('Berlin')));
  assert.equal(jobGeo(job).countryName, 'Germany');
});

test('every board is aimed at the reader, and remote-only flags follow the ask', () => {
  const local = boardLinks('react engineer', { where: WHERE.seattle });
  for (const l of local) assert.ok(l.url.startsWith('https://'), `${l.name} must be https`);
  assert.ok(local.find((l) => l.id === 'linkedin').url.includes('Seattle'));
  assert.ok(local.find((l) => l.id === 'indeed').url.includes('Seattle'));
  assert.ok(local.find((l) => l.id === 'builtin').url.includes('builtinseattle.com'));

  const remote = boardLinks('react engineer', { where: WHERE.remote });
  assert.ok(remote.find((l) => l.id === 'linkedin').url.includes('f_WT=2'), 'remote ask keeps the remote filter');

  const us = boardLinks('react engineer', { where: WHERE.us });
  assert.ok(us.find((l) => l.id === 'linkedin').url.includes('United%20States'));
});

test('scopes map to the right search location', () => {
  assert.equal(whereForScope('seattle'), 'Seattle, WA');
  assert.equal(whereForScope('us'), 'United States');
  assert.equal(whereForScope('worldwide'), 'Remote');
});
