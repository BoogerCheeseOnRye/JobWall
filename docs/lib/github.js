const API = 'https://api.github.com';
const TTL_MS = 10 * 60 * 1000;
const cache = new Map();

// This module runs in Node (server.js) and in the browser (Pages). A browser
// has no `process`, and merely mentioning it throws ReferenceError — which is
// not the same as undefined, so `typeof` is the only safe way to ask.
const env = () => (typeof process !== 'undefined' && process.env) || {};

const headers = (accept) => {
  const h = {
    Accept: accept || 'application/vnd.github+json',
    'User-Agent': 'jobwall',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  // Optional, and server-side only — the browser cannot hold a secret, and
  // anything shipped to a page is public. Lifts the 60/hr anonymous limit to
  // 5000/hr if you happen to have a token in the environment. Not required.
  if (env().GITHUB_TOKEN) h.Authorization = `Bearer ${env().GITHUB_TOKEN}`;
  return h;
};

class RateLimitError extends Error {
  constructor(reset) {
    super(
      'GitHub rate limit hit (60 requests/hour anonymous). Set GITHUB_TOKEN in the environment and restart to raise it to 5000/hour.'
    );
    this.name = 'RateLimitError';
    this.status = 429;
    this.resetAt = reset;
  }
}

// GitHub's contents endpoint answers JSON unless you ask for the raw media
// type. Asking for JSON and calling .text() hands back the *envelope* —
// {"name":"readme.md","sha":...,"content":"<base64>"} — which is why every
// README used to arrive as a sha hash and every package.json parsed into an
// object with no dependencies in it.
const RAW_ACCEPT = 'application/vnd.github.raw';

async function api(path, { raw = false } = {}) {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const key = `${url}|${raw}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const res = await fetch(url, { headers: headers(raw ? RAW_ACCEPT : null), signal: AbortSignal.timeout(12_000) });
  if (res.status === 403 && /rate limit/i.test(res.headers.get('x-ratelimit-remaining') === '0' ? 'rate limit' : 'rate limit')) {
    throw new RateLimitError(Number(res.headers.get('x-ratelimit-reset')) * 1000);
  }
  if (res.status === 404) {
    const err = new Error(`Not found on GitHub: ${path}`);
    err.status = 404;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`GitHub responded ${res.status} for ${path}`);
    err.status = res.status;
    throw err;
  }
  const value = raw ? await res.text() : await res.json();
  cache.set(key, { at: Date.now(), value });
  return value;
}

// Accepts: full URL, github.com/user/repo(.git), user/repo, bare username.
export function parseTarget(input) {
  let s = String(input || '').trim();
  if (!s) throw badInput('Paste a GitHub URL or username.');
  s = s.replace(/^git\+/, '').replace(/\.git$/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  if (s.startsWith('http://')) s = s.replace(/^http:\/\//, 'https://');
  if (!/^https?:\/\//.test(s)) s = `https://github.com/${s.replace(/^github\.com\//, '')}`;

  let u;
  try {
    u = new URL(s);
  } catch {
    throw badInput(`Could not read "${input}" as a GitHub link.`);
  }
  if (!/(^|\.)github\.com$/i.test(u.hostname)) {
    throw badInput(`Only github.com links work right now (got ${u.hostname}).`);
  }
  const seg = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (seg.length === 0 || !seg[0]) throw badInput('That link has no user in it.');

  const owner = seg[0];
  if (seg.length === 1) return { kind: 'profile', owner, repo: null };
  // Drop non-repo path noise like /tree/main or /blob/main/x.js
  const repo = seg[1];
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
    throw badInput('Could not find "owner/repo" in that link.');
  }
  return { kind: 'repo', owner, repo };
}

function badInput(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}

async function readme(owner, repo) {
  try {
    return await api(`/repos/${owner}/${repo}/readme`, { raw: true });
  } catch {
    return '';
  }
}

// Manifests are rarely at the root. Look one and two levels down so a monorepo
// or a project with app/ + node-tests/ still reports its real dependencies.
async function manifest(owner, repo, paths = []) {
  const out = { deps: {}, scripts: [], packageName: null, frameworks: [], files: [] };
  const candidates = ['package.json'];
  for (const p of paths) {
    if (/^[^/]+\/package\.json$/.test(p) || /^[^/]+\/[^/]+\/package\.json$/.test(p)) candidates.push(p);
    if (candidates.length > 7) break;
  }

  for (const file of candidates) {
    let text = '';
    try {
      text = await api(`/repos/${owner}/${repo}/contents/${file}`, { raw: true });
    } catch {
      continue;
    }
    out.files.push(file);
    if (file.endsWith('package.json')) {
      try {
        const pkg = JSON.parse(text);
        out.packageName = out.packageName || pkg.name || null;
        Object.assign(out.deps, pkg.dependencies || {}, pkg.devDependencies || {}, pkg.peerDependencies || {});
        out.scripts = [...new Set([...out.scripts, ...Object.keys(pkg.scripts || {})])].slice(0, 12);
        out.tools = {
          ...out.tools,
          bundler: out.tools?.bundler || ['webpack', 'vite', 'rollup', 'esbuild', 'parcel', 'browserify'].find((b) => pkg.devDependencies?.[b] || pkg.dependencies?.[b]),
          test: out.tools?.test || ['vitest', 'jest', 'mocha', 'playwright', 'cypress', 'ava'].find((b) => pkg.devDependencies?.[b] || pkg.dependencies?.[b]),
          types: Boolean(out.tools?.types || pkg.devDependencies?.typescript || pkg.dependencies?.typescript),
          lint: Boolean(out.tools?.lint || pkg.eslintConfig || pkg.devDependencies?.eslint),
        };
      } catch {
        /* not actually JSON, ignore */
      }
      continue;
    }
    if (file.endsWith('requirements.txt') || file.endsWith('pyproject.toml')) {
      for (const line of text.split('\n')) {
        const m = line.match(/^\s*["']?([A-Za-z0-9_.-]+)/);
        if (m && !/^(python|requires|project|name|version|dependencies)$/i.test(m[1])) out.deps[m[1].toLowerCase()] = 'py';
      }
    }
    if (file.endsWith('Cargo.toml') || file.endsWith('go.mod')) {
      for (const m of text.matchAll(/"([a-z0-9_-]+)"/g)) out.deps[m[1]] = 'toml';
      for (const m of text.matchAll(/^\s*([a-z][\w-]*)\/(\S+)/gm)) out.deps[m[1]] = 'mod';
    }
  }
  return out;
}

// Vendored libraries are dependencies too, and a tree listing proves they are
// installed rather than merely wished for.
function vendoredDeps(paths) {
  const deps = {};
  for (const p of paths) {
    const m = p.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//);
    if (m) deps[m[1].toLowerCase()] = 'vendored';
  }
  return deps;
}

async function tree(owner, repo, branch) {
  try {
    const t = await api(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch || 'HEAD')}?recursive=1`);
    return (t.tree || []).filter((n) => n.type === 'blob').map((n) => n.path);
  } catch {
    return [];
  }
}

export async function analyzeRepo(owner, repo) {
  const meta = await api(`/repos/${owner}/${repo}`);
  const paths = await tree(owner, repo, meta.default_branch);
  const [languages, readmeText, manifestInfo] = await Promise.all([
    api(`/repos/${owner}/${repo}/languages`).catch(() => ({})),
    readme(owner, repo),
    manifest(owner, repo, paths),
  ]);

  return {
    kind: 'repo',
    owner,
    repo,
    name: meta.full_name,
    url: meta.html_url,
    description: meta.description || '',
    topics: meta.topics || [],
    stars: meta.stargazers_count,
    forks: meta.forks_count,
    watchers: meta.subscribers_count || 0,
    sizeKb: meta.size,
    license: meta.license?.spdx_id || null,
    createdAt: meta.created_at,
    pushedAt: meta.pushed_at,
    openIssues: meta.open_issues_count,
    defaultBranch: meta.default_branch,
    languages,
    deps: { ...vendoredDeps(paths), ...manifestInfo.deps },
    files: manifestInfo.files || [],
    tools: manifestInfo.tools || {},
    scripts: manifestInfo.scripts,
    paths,
    readme: readmeText,
    sources: [readmeText, ...paths.slice(0, 400)],
  };
}

export async function analyzeProfile(owner) {
  const user = await api(`/users/${owner}`);
  const repos = await api(`/users/${owner}/repos?per_page=100&sort=pushed`);
  if (!Array.isArray(repos)) throw badInput(`No public repositories for ${owner}.`);

  const languages = {};
  const paths = [];
  const descriptions = [];
  const topics = [];
  let stars = 0;
  let forks = 0;

  for (const r of repos) {
    stars += r.stargazers_count || 0;
    forks += r.forks_count || 0;
    if (r.description) descriptions.push(`${r.name} ${r.description}`);
    if (r.language) languages[r.language] = (languages[r.language] || 0) + (r.size || 1) * 1024;
    topics.push(...(r.topics || []));
    paths.push(r.name);
  }

  // Read the real files of the most substantive projects. Profile metadata
  // alone is marketing copy; code is evidence.
  //
  // Six was too few: a profile of 17 repos silently ignored two thirds of the
  // work, and the omissions looked like the projects did not exist. Every repo
  // still contributes its description and path names, so nothing is invisible —
  // but the deep read is what turns a game into a "three.js, WebGL" claim.
  // Forks and empty repos are skipped: they cost two requests and prove
  // nothing the owner did not already prove elsewhere.
  const ranked = [...repos]
    .filter((r) => !r.fork && !r.archived && (r.size || 0) > 0)
    .sort(
      (a, b) =>
        (b.size || 0) - (a.size || 0) ||
        (b.stargazers_count || 0) - (a.stargazers_count || 0) ||
        String(b.pushed_at || '').localeCompare(String(a.pushed_at || ''))
    )
    .slice(0, 12);
  const deps = {};
  let readmeText = '';
  const fileHits = [];
  for (const r of ranked) {
    const [rm, mf] = await Promise.all([readme(owner, r.name), manifest(owner, r.name).catch(() => ({ deps: {} }))]);
    readmeText += `\n\n### ${r.name}\n${rm}`;
    Object.assign(deps, mf.deps);
    fileHits.push(...(mf.files || []));
  }

  return {
    kind: 'profile',
    owner,
    name: user.login,
    realName: user.name,
    url: user.html_url,
    bio: user.bio || '',
    blog: user.blog || '',
    location: user.location || '',
    company: user.company || '',
    followers: user.followers,
    following: user.following,
    publicRepos: user.public_repos,
    createdAt: user.created_at,
    stars,
    forks,
    languages,
    deps,
    topics,
    paths,
    // Ranked by the same measure as the deep read, not by GitHub's default of
    // "most recently pushed". A project card ordered by recency reads as a
    // ranking of importance, and that reading is simply wrong: it put an 8 KB
    // scratch repo beside a 7.9 MB game while dropping the game entirely.
    repos: [...repos]
      .sort(
        (a, b) =>
          (b.size || 0) - (a.size || 0) ||
          (b.stargazers_count || 0) - (a.stargazers_count || 0) ||
          String(b.pushed_at || '').localeCompare(String(a.pushed_at || ''))
      )
      .map((r) => ({
        name: r.name,
        url: r.html_url,
        description: r.description || '',
        language: r.language,
        stars: r.stargazers_count,
        forks: r.forks_count,
        pushedAt: r.pushed_at,
        topics: r.topics || [],
        sizeKb: r.size,
        sampled: ranked.some((x) => x.name === r.name),
      })),
    readme: readmeText,
    sources: [readmeText, descriptions.join('\n'), topics.join(' ')],
    sampledRepos: ranked.map((r) => r.name),
    repoTotal: repos.length,
    files: [...new Set(fileHits)],
  };
}

export { api as githubApi };
