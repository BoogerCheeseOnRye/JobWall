import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from './lib/analyze.js';
import { fetchFeed } from './lib/jobs.js';

const PORT = Number(process.env.PORT || 8999);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function sendJson(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

async function readBody(req, limit = 8 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('Request body too large.'), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Body was not valid JSON.'), { status: 400 });
  }
}

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = normalize(join(PUBLIC, rel));
  if (!target.startsWith(PUBLIC + sep) && target !== join(PUBLIC, 'index.html')) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const file = await readFile(target);
    res.writeHead(200, {
      'Content-Type': MIME[extname(target)] || 'application/octet-stream',
      'Content-Length': file.length,
      'Cache-Control': 'no-cache',
    });
    res.end(file);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404 — not on the wall.');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  try {
    if (pathname === '/api/health') {
      const feed = await fetchFeed().catch(() => ({ jobs: [], sources: [] }));
      return sendJson(res, 200, {
        ok: true,
        port: PORT,
        feeds: feed.sources,
        openingsInMemory: feed.jobs.length,
        uptimeSec: Math.round(process.uptime()),
      });
    }

    if (pathname === '/api/analyze') {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST a JSON body: {"url": "..."}' });
      const body = await readBody(req);
      const input = body.url || body.target || body.q || '';
      const t0 = Date.now();
      const result = await analyze(input);
      result.tookMs = Date.now() - t0;
      return sendJson(res, 200, result);
    }

    if (pathname === '/api/feed') {
      const feed = await fetchFeed({ force: url.searchParams.get('refresh') === '1' });
      return sendJson(res, 200, { ok: true, sources: feed.sources, count: feed.jobs.length });
    }

    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { ok: false, error: `No route ${pathname}` });
    }

    return await serveStatic(req, res, pathname);
  } catch (err) {
    const status = err.status || 502;
    const message = err.name === 'AbortError' || /timeout/i.test(err.message || '') ? 'Upstream request timed out. Try again.' : err.message || 'Unknown failure.';
    if (!res.headersSent) sendJson(res, status, { ok: false, error: message, hint: status >= 500 ? 'Upstream (GitHub or a job feed) is unhappy. The wall will still come up.' : undefined });
    else res.end();
    console.error(`[${new Date().toISOString()}] ${req.method} ${pathname} -> ${status}: ${err.message}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`JobWall is up: http://localhost:${PORT}`);
  console.log(`POST http://localhost:${PORT}/api/analyze  {"url":"https://github.com/BoogerCheeseOnRye/SecMesh"}`);
});
