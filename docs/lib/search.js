// Direct, hand-built search URLs. The live APIs only cover a slice of the
// market (mostly remote); these links cover the rest, and they never break.

const enc = (s) => encodeURIComponent(s);

export const BOARDS = [
  {
    id: 'linkedin',
    name: 'LinkedIn Jobs',
    build: (q) => `https://www.linkedin.com/jobs/search/?keywords=${enc(q)}&location=Remote&f_WT=2`,
  },
  {
    id: 'indeed',
    name: 'Indeed',
    build: (q) => `https://www.indeed.com/jobs?q=${enc(`${q} remote`)}&fromage=14&l=Remote`,
  },
  {
    id: 'wwr',
    name: 'We Work Remotely',
    build: (q) => `https://weworkremotely.com/remote-jobs/search?term=${enc(q)}`,
  },
  {
    id: 'wellfound',
    name: 'Wellfound',
    build: (q) => `https://wellfound.com/jobs?role=${enc(q)}&remote=true`,
  },
  {
    id: 'remoteok',
    name: 'Remote OK',
    build: (q) => `https://remoteok.com/remote-${enc(q.replace(/\s+/g, '-'))}-jobs`,
  },
  {
    id: 'dice',
    name: 'Dice',
    build: (q) => `https://www.dice.com/job-search?q=${enc(q)}`,
  },
  {
    id: 'hn',
    name: 'Hacker News "Ask HN: Who is hiring?"',
    build: (q) => `https://hn.algolia.com/?q=${enc(`"${q}"`)}&sort=byDate&dateRange=pastMonth&type=story`,
  },
];

export function boardLinks(query, { include = BOARDS.map((b) => b.id) } = {}) {
  return BOARDS.filter((b) => include.includes(b.id)).map((b) => ({ id: b.id, name: b.name, url: b.build(query) }));
}

// Skill-combination queries beat generic role queries: "React TypeScript
// three.js" finds the job your repo actually qualifies for, "frontend
// engineer" finds 4,000 people with degrees.
export function combinationQueries(skills, roles) {
  const byId = new Map(skills.map((s) => [s.id, s]));
  const out = [];
  const seen = new Set();
  const push = (q) => {
    const k = String(q).toLowerCase();
    if (!q || seen.has(k)) return;
    seen.add(k);
    out.push(q);
  };

  for (const role of roles.slice(0, 3)) {
    push(role.query);
    const parts = (role.matched || [])
      .slice(0, 3)
      .map((m) => {
        const s = skills.find((x) => x.label === m.label);
        return byId.get(s?.id) ? labelToQuery(byId.get(s.id).id) : null;
      })
      .filter(Boolean);
    if (parts.length >= 2) push(parts.join(' '));
  }

  const ids = new Set(skills.map((s) => s.id));
  for (const group of DISTINCTIVE) {
    const hit = group.filter((p) => ids.has(p)).map(labelToQuery).filter(Boolean);
    if (hit.length >= 2) push(hit.join(' '));
  }

  return out.slice(0, 10);
}

// Only skills whose names a job posting would actually use. "DOM" and
// "Technical Writing" are real evidence but useless as search terms.
const DISTINCTIVE = [
  ['threejs', 'webgl', 'glsl'],
  ['react', 'typescript', 'next'],
  ['node', 'websockets', 'api'],
  ['python', 'numpy', 'ml'],
  ['security', 'crypto', 'pqc'],
  ['linux', 'networking', 'tcpudp'],
  ['quant', 'llm'],
  ['physics', 'threejs'],
  ['cli', 'devtools'],
  ['rust', 'cpp'],
];

const QUERY_TERMS = {
  threejs: 'three.js', webgl: 'WebGL', glsl: 'GLSL shaders', webgpu: 'WebGPU', canvas: 'canvas',
  react: 'React', next: 'Next.js', vue: 'Vue', svelte: 'Svelte', tailwind: 'Tailwind',
  typescript: 'TypeScript', node: 'Node.js', express: 'Express', python: 'Python', numpy: 'NumPy',
  ml: 'machine learning', llm: 'LLM', quant: 'quantization', physics: 'physics simulation',
  gameengine: 'game engine', security: 'security', crypto: 'cryptography', pqc: 'post-quantum',
  pentest: 'penetration testing', threatmodel: 'threat modeling', networking: 'networking',
  tcpudp: 'sockets', linux: 'Linux', concurrency: 'concurrent systems', embedded: 'embedded',
  cli: 'CLI', devtools: 'developer tools', testing: 'testing', api: 'REST API',
  websockets: 'WebSocket', perf: 'performance', rust: 'Rust', cpp: 'C++', c: 'C',
  docker: 'Docker', cloud: 'AWS', observability: 'observability', wasm: 'WebAssembly',
  offline: 'PWA', ios: 'iOS', wasm_: 'WebAssembly', fullstack: 'full stack', postgres: 'PostgreSQL',
};

function labelToQuery(id) {
  return QUERY_TERMS[id] || null;
}

export function searchBlock(roles, skills) {
  return {
    byRole: roles.map((role) => ({
      id: role.id,
      title: role.title,
      fit: role.fit,
      links: boardLinks(role.query),
    })),
    combos: combinationQueries(skills, roles).map((q) => ({ query: q, links: boardLinks(q) })),
  };
}
