import test from 'node:test';
import assert from 'node:assert/strict';
import { score } from '../docs/lib/analyze.js';
import { mount } from '../docs/app.js';
import { probe, isBrowserMode } from '../docs/api.js';

// A stand-in for a fetched repo: same shape analyze() receives from GitHub, no
// network and no API quota. Live job data is still used, so the rendering is
// exercised against real postings.
const FIXTURE_REPO = {
  kind: 'repo',
  owner: 'fixture',
  repo: 'SecMesh',
  name: 'fixture/SecMesh',
  url: 'https://github.com/fixture/SecMesh',
  description: 'Post Quantum On-Device Security UI',
  topics: [],
  stars: 1,
  forks: 1,
  sizeKb: 17031,
  license: null,
  createdAt: '2026-09-16T01:43:25Z',
  pushedAt: '2026-10-01T16:54:28Z',
  openIssues: 2,
  defaultBranch: 'main',
  languages: { JavaScript: 8_203_198, HTML: 656_668, Shell: 43_675, Python: 2_982 },
  deps: { three: 'vendored' },
  files: ['package.json'],
  tools: { bundler: null, test: null, types: false, lint: false },
  scripts: [],
  paths: [
    'app/lib/three.module.js',
    'app/serve.js',
    'app/launch-serve.sh',
    'app/crosslab/physics_simulator.html',
    'node-tests/defense-tool.mjs',
    'node-tests/selfcheck.mjs',
    'README.md',
  ],
  readme: 'Post-quantum mesh defense console. WebGL via three.js r160, node static server, headless self-check suite, TCP/UDP mesh peers, Linux IceWM tray.',
};

// A DOM small enough to read, big enough to run app.js. This is how the render
// path gets tested without a browser: if app.js ever reads a field that does not
// exist or throws on real data, this fails instead of a blank page.
function makeDom() {
  const els = new Map();
  const make = (key) => ({
    key,
    _html: '',
    _text: '',
    innerHTML: '',
    textContent: '',
    className: '',
    value: '',
    hidden: false,
    checked: false,
    disabled: false,
    dataset: {},
    handlers: new Map(),
    style: {},
    addEventListener(type, fn) {
      if (!this.handlers.has(type)) this.handlers.set(type, []);
      this.handlers.get(type).push(fn);
    },
    scrollIntoView() {},
    requestSubmit() {
      for (const fn of this.handlers.get('submit') || []) fn({ preventDefault() {} });
    },
    fire(type, ev = {}) {
      for (const fn of this.handlers.get(type) || []) fn(ev);
    },
  });
  const get = (sel) => {
    if (!els.has(sel)) {
      const el = make(sel);
      Object.defineProperty(el, 'innerHTML', {
        get() { return this._html; },
        set(v) { this._html = String(v); },
      });
      Object.defineProperty(el, 'textContent', {
        get() { return this._text; },
        set(v) { this._text = String(v); },
      });
      els.set(sel, el);
    }
    return els.get(sel);
  };
  return {
    els,
    get,
    document: {
      querySelector: get,
      querySelectorAll: () => [],
      addEventListener() {},
    },
  };
}

// A stand-in for Response: the shim reads .text() and parses it itself, so
// that a host answering with an HTML error page can never reach res.json() and
// surface as "Unexpected token '<'".
function stubResponse(body, { ok = true, status = 200 } = {}) {
  const text = async () => (typeof body === 'string' ? body : JSON.stringify(body));
  return { ok, status, statusText: '', text, json: async () => JSON.parse(await text()) };
}

test('the page renders real results from a real submission', async () => {
  const dom = makeDom();
  const payload = await score({ kind: 'repo', owner: 'fixture', repo: 'SecMesh' }, FIXTURE_REPO);
  payload.tookMs = 1234;

  globalThis.document = dom.document;
  globalThis.fetch = async (url) =>
    stubResponse(url === '/api/analyze' ? payload : { ok: true, feeds: payload.sources });

  await mount();
  dom.get('#url').value = 'BoogerCheeseOnRye/SecMesh';
  dom.get('#form').fire('submit', { preventDefault() {} });
  await new Promise((r) => setTimeout(r, 50));

  const ev = dom.get('#evidence').innerHTML;
  const roles = dom.get('#roles').innerHTML;
  const jobs = dom.get('#jobs').innerHTML;
  const searches = dom.get('#searches').innerHTML;
  const status = dom.get('#status').innerHTML;

  assert.ok(dom.get('#results').hidden === false, 'results section is revealed');
  assert.match(status, /Done in/, 'status reports completion');
  assert.match(ev, /SecMesh/, 'names the repo that was read');
  assert.match(ev, /JavaScript/, 'shows the language evidence');
  assert.match(roles, /Engineer/, 'names at least one role');
  assert.match(roles, /live opening/, 'shows live opening counts per role');
  assert.match(jobs, /Open posting/, 'every opening is actionable');
  assert.match(jobs, /https?:\/\//, 'openings carry real links');
  assert.match(searches, /linkedin/i, 'search links are present');

  // Every opening states its pay or admits it does not. No card may imply a wage
  // the posting never gave, and none may show a half-formatted one.
  const cards = jobs.split('<article class="job">').slice(1);
  assert.ok(cards.length > 0, 'at least one opening card rendered');
  for (const card of cards) {
    const hasRange = /class="pill pill-pay"[^>]*>[^<]*\d/.test(card);
    assert.ok(hasRange !== /pay not stated/.test(card), 'a card shows a range or says pay is unstated, never neither and never both');
  }
  assert.ok(!/\$\$|–k|\$-|\bNaN\b/.test(jobs + roles), 'no half-formatted wage leaks into a card');
  // Roles carry a market band derived only from postings that state their terms.
  const payPills = [...roles.matchAll(/class="pill pill-pay"[^>]*>(.*?)<\/span>/gs)].map((m) => m[1].replace(/<[^>]+>/g, ''));
  for (const pill of payPills) assert.match(pill, /\/(yr|hr|day|mo)/, `role band "${pill}" names its period`);

  // No unresolved template placeholders and no undefined leaking into the page.
  for (const [name, html] of Object.entries({ evidence: ev, roles, jobs, searches })) {
    assert.ok(!/\$\{/.test(html), `${name} has no unrendered template literals`);
    assert.ok(!/>undefined</.test(html), `${name} has no stray undefined`);
    assert.ok(!/NaN/.test(html), `${name} has no NaN`);
  }

  // Filters must narrow the list, not break it.
  const before = dom.get('#jobs').innerHTML.match(/Open posting/g).length;
  dom.get('#remote').checked = true;
  dom.get('#remote').fire('change');
  const after = dom.get('#jobs').innerHTML.match(/Open posting/g)?.length ?? 0;
  assert.ok(after <= before, 'remote-only filter never widens results');

  dom.get('#realistic').checked = true;
  dom.get('#realistic').fire('change');
  assert.ok(dom.get('#jobs').innerHTML.length > 0, 'still renders with both filters on');

  dom.get('#paid').checked = true;
  dom.get('#paid').fire('change');
  const paidOnly = dom.get('#jobs').innerHTML;
  assert.ok(!/pay not stated/.test(paidOnly), 'the pay filter removes every card whose pay was never stated');
});

test('an upstream failure surfaces as readable text, not a blank page', async () => {
  const dom = makeDom();
  globalThis.document = dom.document;
  globalThis.fetch = async () =>
    stubResponse({ ok: false, error: 'Not found on GitHub: /users/nope' }, { ok: false, status: 404 });
  await mount();

  dom.get('#url').value = 'nope';
  dom.get('#form').fire('submit', { preventDefault() {} });
  await new Promise((r) => setTimeout(r, 30));

  const status = dom.get('#status');
  assert.match(status.innerHTML, /Not found on GitHub/, 'the actual reason is shown');
  assert.match(status.className, /err/, 'styled as an error');
  assert.equal(dom.get('#go').disabled, false, 'the button is usable again');
});

test('a static host answering /api/health with HTML does not surface a SyntaxError', async () => {
  globalThis.document = makeDom().document;
  // Exactly what GitHub Pages does: 404 with an HTML body, not JSON.
  globalThis.fetch = async () =>
    stubResponse('<!DOCTYPE html><html><body>404</body></html>', { ok: false, status: 404 });

  const feeds = await probe();

  assert.ok(Array.isArray(feeds), 'probe resolves instead of throwing');
  assert.equal(isBrowserMode(), true, 'falls back to the in-browser engine');
});
