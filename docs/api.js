// One API surface, two backends.
//
// `node server.js` exposes /api/health, /api/analyze and /api/feed. GitHub
// Pages serves the same front-end but runs no Node, and lib/ is plain ES
// modules with no node builtins — so in the browser the engine just runs
// locally against the same CORS-open upstreams.
//
// probe() decides once which backend is in play; the page never has to guess,
// and a static host never fires a request it knows will fail.

const API_BASE = ''; // same-origin: works at / and under a /<repo>/ Pages path

let mode = 'unknown';

export const isBrowserMode = () => mode === 'browser';

// GitHub allows 60 requests/hour anonymously, per IP. A profile scan spends
// several. Cache answers so a repeat visit — or a back-and-forth while
// tweaking the same link — costs nothing.
const CACHE_KEY = 'jobwall.cache.v1';
const CACHE_TTL_MS = 30 * 60 * 1000;

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeCache(key, value) {
  try {
    const all = readAll();
    all[key] = { at: Date.now(), value };
    // Keep it small: a handful of recent scans is plenty.
    const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(0,12);
    const trimmed = Object.fromEntries(keys.map((k) => [k, all[k]]));
    localStorage.setItem(CACHE_KEY, JSON.stringify(trimmed));
  } catch {
    /* private mode, quota, whatever — the cache is an optimisation only */
  }
}

function readCache(key) {
  const hit = readAll()[key];
  if (!hit) return undefined;
  return Date.now() - hit.at < CACHE_TTL_MS ? hit.value : undefined;
}

// A host that answers with an HTML error page must never reach res.json() —
// that surfaces as "Unexpected token '<'", which tells the user nothing.
async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const err = new Error(
      res.ok
        ? 'The server sent something that was not JSON.'
        : `The server answered ${res.status} ${res.statusText || ''}`.trim() + '.'
    );
    err.status = res.status;
    throw err;
  }
}

async function serverFetch(path, init) {
  const res = await fetch(API_BASE + path, init);
  const data = await readJson(res);
  if (!res.ok || data.ok === false) {
    throw Object.assign(new Error(data.error || `Request failed (${res.status})`), {
      status: res.status,
    });
  }
  return data;
}

async function browserAnalyze(input) {
  const { analyze } = await import('./lib/analyze.js');
  const t0 = Date.now();
  const result = await analyze(input);
  result.tookMs = Date.now() - t0;
  return result;
}

async function browserHealth() {
  const { fetchFeed } = await import('./lib/jobs.js');
  const feed = await fetchFeed().catch(() => ({ jobs: [], sources: [] }));
  return { ok: true, feeds: feed.sources, openingsInMemory: feed.jobs.length };
}

// Which backend is live? Probing /api/health is the honest test: on a static
// host it 404s with HTML, which readJson rejects, and we fall through.
export async function probe() {
  if (typeof fetch !== 'function') return (mode = 'browser');
  try {
    const res = await fetch(API_BASE + '/api/health', { cache: 'no-store' });
    if (!res.ok) throw new Error('no api');
    const data = await readJson(res);
    mode = 'server';
    return data.feeds || [];
  } catch {
    mode = 'browser';
    try {
      const h = await browserHealth();
      return h.feeds || [];
    } catch {
      return [];
    }
  }
}

export async function analyze(input) {
  if (mode === 'browser') {
    const key = `a:${input.trim().toLowerCase()}`;
    const hit = readCache(key);
    if (hit) return { ...hit, cached: true };
    const result = await browserAnalyze(input);
    writeCache(key, result);
    return result;
  }
  const res = await serverFetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: input }),
  });
  return res;
}