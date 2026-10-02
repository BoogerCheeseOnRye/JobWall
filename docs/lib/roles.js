import { label } from './skills.js';

// A role is a weighted basket of skills. fit% = how much of that basket your
// evidence actually covers. A role with a 9% fit is noise; we cut at 18%.
// core  = you cannot do the job without it
// bonus = makes you a better candidate than the next applicant
export const ROLES = [
  {
    id: 'graphics-webgl',
    title: 'Graphics / WebGL Engineer',
    family: 'Graphics',
    blurb: 'Real-time rendering in the browser: shaders, scene graphs, frame budgets.',
    query: 'WebGL engineer three.js',
    core: [
      ['webgl', 3], ['threejs', 3], ['glsl', 2.5], ['javascript', 1.5], ['canvas', 1], ['perf', 1.2],
    ],
    bonus: [
      ['gameengine', 2], ['physics', 2], ['webgpu', 1.5], ['wasm', 1], ['typescript', 1],
      ['d3', 1], ['testing', 1], ['linux', 0.5],
    ],
    titleTokens: ['graphics', 'webgl', 'rendering', 'render', 'shader', 'shaders', 'visualization', 'creative', 'three', 'canvas', 'vfx', 'frontend', 'front', 'web'],
    searches: ['WebGL engineer three.js remote', 'shader graphics programmer job'],
  },
  {
    id: 'frontend',
    title: 'Frontend Engineer',
    family: 'Web',
    blurb: 'Interfaces people actually use: HTML, CSS, JS, state, accessibility.',
    query: 'frontend engineer',
    core: [
      ['javascript', 3], ['html', 2.5], ['css', 2], ['dom', 2], ['responsive', 1.5], ['a11y', 1],
    ],
    bonus: [
      ['react', 2.2], ['typescript', 2], ['next', 2], ['tailwind', 1.5], ['svelte', 1.5],
      ['vue', 1.5], ['testing', 1.2], ['ux', 1], ['offline', 1], ['a11y', 1.5], ['buildtools', 1],
    ],
    titleTokens: ['frontend', 'front', 'web', 'ui', 'javascript', 'react', 'interface', 'product'],
    searches: ['frontend engineer remote', 'javascript UI engineer job'],
  },
  {
    id: 'fullstack',
    title: 'Full-Stack Engineer',
    family: 'Web',
    blurb: 'Ship the whole thing: UI, API, storage, deployment.',
    query: 'full stack engineer',
    core: [
      ['javascript', 2.5], ['node', 2.5], ['api', 2], ['html', 1.5], ['sql', 1.5], ['fullstack', 1],
    ],
    bonus: [
      ['react', 1.8], ['next', 1.8], ['express', 1.8], ['postgres', 1.5], ['typescript', 1.5],
      ['websockets', 1.2], ['docker', 1], ['gitops', 1], ['devtools', 1], ['redis', 1],
    ],
    titleTokens: ['fullstack', 'full', 'stack', 'software', 'product', 'web', 'engineer'],
    searches: ['full stack engineer remote', 'javascript backend engineer job'],
  },
  {
    id: 'backend-node',
    title: 'Backend Engineer (Node)',
    family: 'Backend',
    blurb: 'APIs, services, sockets, and the boring reliability nobody sees.',
    query: 'node.js backend engineer',
    core: [
      ['node', 3], ['api', 2.5], ['http', 2], ['javascript', 1.5], ['express', 1],
    ],
    bonus: [
      ['typescript', 2], ['websockets', 1.8], ['postgres', 1.5], ['redis', 1.2], ['nosql', 1],
      ['perf', 1.2], ['gitops', 1.2], ['observability', 1.5], ['testing', 1.2], ['concurrency', 1],
    ],
    titleTokens: ['backend', 'back', 'server', 'api', 'platform', 'node', 'systems', 'service'],
    searches: ['node.js backend engineer remote', 'API engineer job'],
  },
  {
    id: 'security-appsec',
    title: 'Application / Product Security Engineer',
    family: 'Security',
    blurb: 'Defend real systems: crypto, auth, network abuse, hardening.',
    query: 'application security engineer',
    core: [
      ['security', 3], ['crypto', 2.5], ['linux', 1.5], ['networking', 1.5], ['testing', 1],
    ],
    bonus: [
      ['pqc', 2.5], ['pentest', 2.5], ['threatmodel', 2], ['tcpudp', 1.8], ['iam', 1.8],
      ['privacy', 1.5], ['os', 1.5], ['reverseng', 1.5], ['observability', 1], ['python', 1],
      ['concurrency', 1],
    ],
    titleTokens: ['security', 'appsec', 'product', 'cyber', 'infosec', 'defense', 'defence', 'soc', 'hardening'],
    searches: ['application security engineer remote', 'product security engineer job'],
  },
  {
    id: 'systems-network',
    title: 'Systems / Network Engineer',
    family: 'Systems',
    blurb: 'Sockets, daemons, mesh networks, embedded devices, supervision.',
    query: 'systems engineer linux networking',
    core: [
      ['linux', 3], ['networking', 2.5], ['tcpudp', 2], ['shell', 1.2], ['node', 1],
    ],
    bonus: [
      ['concurrency', 2.2], ['embedded', 2], ['os', 2], ['observability', 1.5], ['perf', 1.5],
      ['python', 1.2], ['security', 1.2], ['c', 1.2], ['cpp', 1.2], ['devtools', 1],
    ],
    titleTokens: ['systems', 'system', 'network', 'networking', 'infrastructure', 'infra', 'platform', 'devops', 'sre', 'reliability', 'linux'],
    searches: ['systems engineer linux remote', 'network engineer job'],
  },
  {
    id: 'python-dev',
    title: 'Python Engineer',
    family: 'Languages',
    blurb: 'Automation, tooling, data, and services written in Python.',
    query: 'python developer',
    core: [['python', 3]],
    bonus: [
      ['numpy', 2], ['ml', 2], ['llm', 2], ['cli', 1.5], ['testing', 1.2], ['api', 1.2],
      ['data', 1.5], ['security', 1], ['linux', 1],
    ],
    titleTokens: ['python', 'developer', 'engineer', 'automation', 'data', 'software'],
    searches: ['python developer remote', 'python automation engineer job'],
  },
  {
    id: 'platform-devtools',
    title: 'Developer Platform / DevTools Engineer',
    family: 'Tooling',
    blurb: 'Build the thing developers and your own future self use every day.',
    query: 'developer tools engineer',
    core: [
      ['devtools', 3], ['cli', 2.2], ['buildtools', 2], ['node', 1.2], ['javascript', 1.2],
    ],
    bonus: [
      ['typescript', 1.8], ['testing', 2], ['docs', 2], ['gitops', 1.8], ['api', 1.2],
      ['ux', 1.2], ['perf', 1.2], ['observability', 1], ['indie', 1],
    ],
    titleTokens: ['platform', 'devtools', 'developer', 'tooling', 'productivity', 'sdk', 'ide', 'infrastructure'],
    searches: ['developer tools engineer remote', 'platform engineer job'],
  },
  {
    id: 'simulation',
    title: 'Simulation / Scientific Computing Engineer',
    family: 'Graphics',
    blurb: 'Physics, agents, and math you can see: sims, quanta, orbits.',
    query: 'simulation engineer physics',
    core: [
      ['physics', 3], ['python', 1.5], ['javascript', 1], ['numpy', 1.5], ['viz', 1.2],
    ],
    bonus: [
      ['threejs', 1.8], ['webgl', 1.8], ['quantum', 2], ['llm', 1.5], ['quant', 2],
      ['perf', 1.5], ['typescript', 1], ['ml', 1.5], ['glsl', 1],
    ],
    titleTokens: ['simulation', 'simulator', 'scientific', 'quant', 'physics', 'research', 'graphics', 'visualization', 'modeling'],
    searches: ['simulation engineer remote', 'scientific computing developer job'],
  },
  {
    id: 'ml-inference',
    title: 'ML / Inference Engineer',
    family: 'Data',
    blurb: 'Make models small, fast, and runnable on hardware you control.',
    query: 'machine learning engineer inference',
    core: [
      ['ml', 3], ['python', 2], ['numpy', 1.5], ['quant', 1.5], ['llm', 1.5],
    ],
    bonus: [
      ['quant', 2.5], ['llm', 2], ['perf', 2], ['cuda', 1.5], ['c', 1.2], ['cpp', 1.2],
      ['viz', 1], ['linux', 1.2], ['wasm', 1],
    ],
    titleTokens: ['ml', 'machine', 'learning', 'ai', 'inference', 'data', 'scientist', 'research', 'model', 'llm'],
    searches: ['machine learning engineer inference remote', 'AI engineer job'],
  },
];

const ENTRY_TOKENS = ['junior', 'jr', 'associate', 'intern', 'internship', 'entry', 'new grad', 'graduate', 'apprentice', 'trainee', 'student', 'early career', 'no experience'];

export function isEntryFriendly(text) {
  const t = text.toLowerCase();
  return ENTRY_TOKENS.some((tok) => t.includes(tok));
}

export function seniorityOf(text) {
  const t = text.toLowerCase();
  if (/principal|staff|distinguished|head of|director|vp\b/.test(t)) return 'lead';
  if (/senior|sr\.?\b|lead\b/.test(t)) return 'senior';
  if (ENTRY_TOKENS.some((tok) => t.includes(tok))) return 'entry';
  return 'unspecified';
}

// Core coverage is what decides a role; bonuses move it. A basket half
// covered in bonuses is not the same as a job you can actually do.
export function scoreRoles(skills, { limit = 8, floor = 0.16 } = {}) {
  const byId = new Map(skills.map((s) => [s.id, s]));
  const conf = new Map();
  for (const s of skills) conf.set(s.id, s.confidence ?? 0);

  const scored = ROLES.map((role) => {
    let num = 0;
    let den = 0;
    let bonusNum = 0;
    let bonusDen = 0;
    const hits = [];
    const misses = [];

    for (const [id, w] of role.core) {
      const v = conf.get(id) || 0;
      num += v * w;
      den += w;
      if (v >= 0.3) {
        const s = byId.get(id);
        hits.push({ id, label: label(id), w, evidence: s?.why?.[0]?.text || null, confidence: v });
      } else {
        misses.push({ id, label: label(id), w });
      }
    }
    for (const [id, w] of role.bonus) {
      const v = conf.get(id) || 0;
      bonusNum += v * w;
      bonusDen += w;
      num += v * w * 0.85;
      den += w * 0.85;
      if (v >= 0.35) {
        const s = byId.get(id);
        hits.push({ id, label: label(id), w: w * 0.85, evidence: s?.why?.[0]?.text || null, confidence: v });
      }
    }

    const coreFit = den ? (bonusDen ? (num - bonusNum * 0.85) / (den - bonusDen * 0.85) : 1) : 0;
    const bonusFit = bonusDen ? bonusNum / bonusDen : 0;
    const fit = Math.min(1, 0.78 * coreFit + 0.22 * bonusFit);
    hits.sort((a, b) => b.w - a.w);
    misses.sort((a, b) => b.w - a.w);

    return {
      id: role.id,
      title: role.title,
      family: role.family,
      blurb: role.blurb,
      query: role.query,
      searches: role.searches,
      fit: Math.round(fit * 100),
      coreFit: Math.round(coreFit * 100),
      bonusFit: Math.round(bonusFit * 100),
      verdict: verdictFor(fit, coreFit),
      matched: hits.slice(0, 8).map((h) => ({ label: h.label, evidence: h.evidence, confidence: Math.round(h.confidence * 100) })),
      gaps: misses.filter((m) => m.w >= 1.5).slice(0, 5).map((m) => m.label),
      titleTokens: role.titleTokens,
      core: role.core,
      bonus: role.bonus,
    };
  });

  return scored
    .filter((r) => r.fit >= floor * 100)
    .sort((a, b) => b.fit - a.fit)
    .slice(0, limit);
}

function verdictFor(fit, coreFit) {
  if (fit >= 0.6 && coreFit >= 0.55) return 'strong';
  if (fit >= 0.42) return 'likely';
  if (fit >= 0.25) return 'stretch';
  return 'reach';
}

export const VERDICT_COPY = {
  strong: 'You have the evidence. Apply today.',
  likely: 'Most of the stack is in your repos. Worth applying.',
  stretch: 'You cover part of this. Lead the application with the projects that do match.',
  reach: 'Thin. Only worth it if the team cares more about projects than résumés.',
};
