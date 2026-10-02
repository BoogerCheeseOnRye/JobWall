// Skill lexicon. Maps real signals (languages, dependencies, prose in your own
// words) onto named skills. Everything here has to be defensible: if a skill
// lights up, it is because something in the submitted code or profile said so.

export const CATEGORIES = {
  language: 'Languages',
  graphics: 'Graphics & Simulation',
  web: 'Web Platform',
  backend: 'Backend & APIs',
  systems: 'Systems & Networking',
  security: 'Security',
  data: 'Data & Math',
  tooling: 'Tooling & DX',
  product: 'Product & Craft',
};

// id -> display label
export const SKILL_LABELS = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  html: 'HTML',
  css: 'CSS',
  shell: 'Shell / Bash',
  c: 'C',
  cpp: 'C++',
  rust: 'Rust',
  go: 'Go',
  java: 'Java',
  csharp: 'C#',
  ruby: 'Ruby',
  php: 'PHP',
  sql: 'SQL',
  wasm: 'WebAssembly',
  mobile: 'Mobile',
  graphics: '2D/3D Graphics',

  threejs: 'three.js',
  webgl: 'WebGL',
  glsl: 'GLSL / Shaders',
  webgpu: 'WebGPU',
  canvas: 'Canvas 2D',
  d3: 'D3 / Data Viz',
  physics: 'Physics Simulation',
  gameengine: 'Game Engines',
  blender: 'Blender',

  react: 'React',
  next: 'Next.js',
  vue: 'Vue',
  svelte: 'Svelte',
  angular: 'Angular',
  tailwind: 'Tailwind',
  dom: 'DOM Manipulation',
  a11y: 'Accessibility',
  responsive: 'Responsive UI',
  offline: 'Offline-first / PWA',

  node: 'Node.js',
  express: 'Express',
  api: 'REST / API Design',
  websockets: 'WebSockets / Realtime',
  http: 'HTTP Internals',
  postgres: 'PostgreSQL',
  nosql: 'NoSQL',
  redis: 'Redis',
  serverless: 'Serverless',

  linux: 'Linux',
  networking: 'Networking',
  tcpudp: 'TCP / UDP',
  concurrency: 'Concurrent Systems',
  perf: 'Performance',
  embedded: 'Embedded / Devices',
  reverseng: 'Reverse Engineering',
  os: 'Operating Systems',

  security: 'Application Security',
  crypto: 'Cryptography',
  pqc: 'Post-Quantum Crypto',
  pentest: 'Penetration Testing',
  threatmodel: 'Threat Modeling',
  iam: 'Identity / Auth',
  privacy: 'Privacy Engineering',

  ml: 'Machine Learning',
  quant: 'Quantization / Model Compression',
  numpy: 'NumPy',
  llm: 'LLM / Local Models',
  viz: 'Data Visualization',
  quantum: 'Quantum Computing',
  data: 'Data Analysis',
  search: 'Search & Ranking',

  cli: 'CLI Tools',
  buildtools: 'Build Tooling',
  testing: 'Automated Testing',
  devtools: 'Developer Tools',
  gitops: 'CI / CD',
  docs: 'Technical Writing',
  observability: 'Observability',

  ux: 'UI / UX Design',
  prototyping: 'Rapid Prototyping',
  fullstack: 'Full-Stack Delivery',
  indie: 'Indie / Solo Shipping',
};

// GitHub language -> skill ids. Ordered by signal strength.
export const LANGUAGE_MAP = {
  JavaScript: ['javascript', 'dom'],
  TypeScript: ['typescript', 'javascript'],
  'TSX': ['react', 'typescript', 'javascript'],
  'JSX': ['react', 'javascript'],
  Python: ['python'],
  HTML: ['html', 'dom'],
  CSS: ['css', 'responsive'],
  SCSS: ['css'],
  Shell: ['shell', 'linux'],
  'Jupyter Notebook': ['python', 'numpy'],
  C: ['c', 'os'],
  'C++': ['cpp', 'os'],
  'C#': ['csharp'],
  Rust: ['rust', 'perf'],
  Go: ['go', 'backend'],
  Java: ['java'],
  Ruby: ['ruby'],
  PHP: ['php'],
  'Jupyter': ['python'],
  Swift: ['embedded'],
  Kotlin: ['java'],
  Dart: ['mobile'],
  Lua: ['gameengine'],
  Assembly: ['reverseng', 'os'],
  Zig: ['systems'],
  Julia: ['numpy'],
  R: ['data'],
  'Jupyter Notebook ': ['python'],
};

// npm/pypi dependency name -> skill ids. Matching is on package name or on
// "@scope/name" root, so a vendored three.js in a subfolder still counts.
export const DEP_MAP = {
  three: ['threejs', 'webgl'],
  '@react-three/fiber': ['threejs', 'react'],
  '@react-three/drei': ['threejs', 'react'],
  babylonjs: ['gameengine', 'webgl'],
  '@babylonjs/core': ['gameengine', 'webgl'],
  pixi: ['canvas', 'gameengine'],
  phaser: ['gameengine'],
  'playcanvas': ['webgl', 'gameengine'],
  regl: ['webgl'],
  gl: ['webgl'],
  'gl-matrix': ['graphics'],

  react: ['react'],
  'react-dom': ['react'],
  next: ['next', 'react', 'fullstack'],
  vue: ['vue'],
  svelte: ['svelte'],
  '@sveltejs/kit': ['svelte', 'fullstack'],
  '@angular/core': ['angular'],
  solid: ['react'],
  preact: ['react'],

  express: ['express', 'node', 'api'],
  fastify: ['node', 'api'],
  koa: ['node', 'api'],
  '@nestjs/core': ['node', 'api'],
  socket: ['websockets'],
  'socket.io': ['websockets'],
  ws: ['websockets'],
  'ws.js': ['websockets'],
  axios: ['http'],
  'node-fetch': ['http'],
  undici: ['http'],
  prisma: ['postgres'],
  pg: ['postgres'],
  mysql2: ['sql'],
  sqlite3: ['sql'],
  mongoose: ['nosql'],
  redis: ['redis'],

  d3: ['d3', 'viz'],
  chart: ['viz'],
  plotly: ['viz'],
  cytoscape: ['viz'],

  vite: ['buildtools'],
  webpack: ['buildtools'],
  rollup: ['buildtools'],
  esbuild: ['buildtools', 'perf'],
  parcel: ['buildtools'],
  typescript: ['typescript'],
  esm: ['node'],
  tailwindcss: ['tailwind'],

  vitest: ['testing'],
  jest: ['testing'],
  mocha: ['testing'],
  playwright: ['testing'],
  cypress: ['testing'],
  '@playwright/test': ['testing'],
  supertest: ['testing'],

  'socket.io-client': ['websockets'],

  numpy: ['numpy'],
  torch: ['ml'],
  pytorch: ['ml'],
  tensorflow: ['ml'],
  transformers: ['llm', 'ml'],
  'llama-cpp-python': ['llm'],
  vllm: ['llm'],
  sklearn: ['ml'],
  'scikit-learn': ['ml'],
  pandas: ['data'],

  'fuse.js': ['search'],
  commander: ['cli'],
  yargs: ['cli'],
  'ink': ['cli'],
  chalk: ['cli'],
  ora: ['cli'],

  'node-forge': ['crypto'],
  'libsodium-wrappers': ['crypto'],
  tweetnacl: ['crypto'],
  'elliptic': ['crypto'],
  'openpgp': ['crypto'],
  'jose': ['crypto', 'iam'],

  'qrcode-terminal': ['cli'],
  'qr-image': ['cli'],
};

// Prose patterns -> skill ids. Word-boundary matched, case-insensitive.
// weight is how much one distinct mention contributes.
export const TEXT_SIGNALS = [
  // graphics / simulation
  { id: 'threejs', re: /\bthree\.?js\b|\bthreejs\b/i, w: 1.4 },
  { id: 'webgl', re: /\bwebgl\b|\bwebgl2\b/i, w: 1.2 },
  { id: 'glsl', re: /\bglsl\b|\bshader(?:s)?\b|\bvertex shader\b|\bfragment shader\b/i, w: 1.2 },
  { id: 'webgpu', re: /\bwebgpu\b|\bwgpu\b/i, w: 1.2 },
  { id: 'canvas', re: /\bcanvas\b|\b2d rendering\b/i, w: 0.6 },
  { id: 'physics', re: /\bphysics\b|\bsimulation\b|\bsimulator\b|\bverlet\b|\bcollision\b|\bn-body\b/i, w: 1.0 },
  { id: 'gameengine', re: /\bgame engine\b|\bvoxel\b|\bgameplay\b|\bsprite sheet\b/i, w: 1.0 },
  { id: 'blender', re: /\bblender\b/i, w: 0.8 },
  { id: 'viz', re: /\bvisualiz(?:er|ation|ing)\b|\bdata viz\b|\bplotting\b/i, w: 0.9 },
  { id: 'd3', re: /\bd3(?:\.js)?\b/i, w: 1.0 },

  // security / crypto
  { id: 'crypto', re: /\bcryptograph\w*\b|\bencryption\b|\bcipher\b|\bkyber\b|\bml-?kem\b|\bsecp256k1\b/i, w: 1.2 },
  { id: 'pqc', re: /\bpost[- ]quantum\b|\bpqc\b|\bkyber\b|\bml-?kem\b|\bblake3\b|\bdilithium\b|\bharvest\b/i, w: 1.6 },
  { id: 'security', re: /\bsecurity\b|\bdefen[cs]e\b|\bhardening\b|\bmitigation\b|\bvulnerab\w*\b|\bexploit\b|\battack surface\b/i, w: 1.0 },
  { id: 'pentest', re: /\bpenetration test\w*\b|\bpen-?test\w*\b|\bred team\b|\bfuzz\w*\b|\bexploit\b|\bscanner\b|\bscan\b|\bnmap\b|\bsniff\w*\b/i, w: 1.1 },
  { id: 'threatmodel', re: /\bthreat model\w*\b|\battack surface\b|\bsecurity posture\b/i, w: 1.1 },
  { id: 'networking', re: /\bmesh network\w*\b|\bnetworking\b|\bnode discovery\b|\bpeer[- ]to[- ]peer\b|\bp2p\b|\bgateway\b|\brouting\b/i, w: 1.0 },
  { id: 'tcpudp', re: /\b(?:tcp|udp)\b|\bsocket\b|\bport scan\w*\b|\bsyn flood\b|\bamplification\b/i, w: 1.1 },
  { id: 'iam', re: /\bdecentralized identit\w*\b|\bdid\b|\boauth\b|\bjwt\b|\bsso\b|\bauthentication\b|\bauth(?:z|n)\b/i, w: 0.9 },
  { id: 'privacy', re: /\bprivacy\b|\bon-?device\b|\boffline[- ]first\b|\blocal[- ]only\b|\bno[- ]cloud\b/i, w: 0.9 },

  // systems / backend
  { id: 'node', re: /\bnode(?:\.js|js)?\b|\bnpm\b/i, w: 0.8 },
  { id: 'linux', re: /\blinux\b|\bdebian\b|\barch\b|\btermux\b|\budev\b|\bsystemd\b|\bicem\.wm\b/i, w: 0.9 },
  { id: 'embedded', re: /\bembedded\b|\bios tray\b|\bdesktop integration\b|\bstreamdeck\b|\bdevice farm\b/i, w: 0.9 },
  { id: 'perf', re: /\bperformance\b|\b60 ?fps\b|\bframe budget\b|\boptimi[sz]\w*\b|\bprofiling\b/i, w: 0.9 },
  { id: 'concurrency', re: /\bconcurren\w*\b|\bmultithread\w*\b|\bworker pool\b|\bself-?healing\b|\bsupervisor\b|\bfabric\b/i, w: 1.0 },
  { id: 'os', re: /\bkernel\b|\bsystem call\w*\b|\bdevice driver\w*\b/i, w: 0.8 },
  { id: 'api', re: /\bhttp api\b|\brest\b|\bapi\b|\bendpoint\w*\b/i, w: 0.7 },
  { id: 'http', re: /\bhttp\b|\bwebsocket\w*\b|\bsse\b|\bstreaming\b/i, w: 0.6 },
  { id: 'websockets', re: /\bwebsocket\w*\b|\brealtime\b|\blive update\w*\b/i, w: 0.9 },
  { id: 'serverless', re: /\bserverless\b|\blambda\b|\bedge function\w*\b/i, w: 0.9 },

  // tooling
  { id: 'cli', re: /\bcli\b|\bcommand[- ]line\b|\bterminal (?:ui|app)\b|\btui\b/i, w: 1.0 },
  { id: 'buildtools', re: /\bbuild (?:step|tool|system)\w*\b|\bno build step\b|\bbundl\w*\b|\bzero[- ]dep\w*\b|\bvanilla\b/i, w: 0.9 },
  { id: 'testing', re: /\bself-?check\b|\btest (?:suite|run|harness|probe)\w*\b|\bheadless\b|\bfake (?:dom|document|webgl)\b|\bassert\w*\b|\bunit test\w*\b/i, w: 1.1 },
  { id: 'devtools', re: /\bdev ?tools?\b|\bdeveloper tools\b|\breplit\b|\bide\b|\bscratchpad\b/i, w: 1.0 },
  { id: 'gitops', re: /\bci\/?cd\b|\bgithub actions\b|\bpipeline\w*\b|\bdeploy\w*\b/i, w: 0.9 },
  { id: 'docs', re: /\bdocumentation\b|\breadme\b|\btechnical (?:writing|docs)\b|\bguide\b|\btutorial\b/i, w: 0.7 },
  { id: 'observability', re: /\bmonitoring\b|\bobservability\b|\btelemetry\b|\bmetrics\b|\bstatus endpoint\w*\b|\bhealth check\w*\b/i, w: 0.9 },

  // data / ml
  { id: 'ml', re: /\bmachine learning\b|\bneural\b|\bmodel training\b|\btraining\b/i, w: 0.8 },
  { id: 'quant', re: /\bquantiz\w*\b|\bquantiz\w*er\b|\bmodel compression\b|\bint8\b|\bfp8\b|\bint4\b/i, w: 1.4 },
  { id: 'llm', re: /\bllm\b|\blarge language model\w*\b|\bmixture[- ]of[- ]experts\b|\bmoe\b|\bgpt\b|\btransformer\w*\b|\binference\b|\bcluster\b/i, w: 1.0 },
  { id: 'numpy', re: /\bnumpy\b|\bnumerical\b|\bmatrix math\b|\blinear algebra\b/i, w: 0.9 },
  { id: 'quantum', re: /\bquantum\b|\bqubit\w*\b|\bentang\w*\b|\bsuperposition\b/i, w: 1.0 },
  { id: 'search', re: /\bfuzzy search\b|\bsearch engine\b|\branking\b/i, w: 0.8 },

  // product / craft
  { id: 'ux', re: /\bui\b|\bux\b|\bdesign\b|\binterface\b|\bconsole\b|\bdashboard\b/i, w: 0.6 },
  { id: 'prototyping', re: /\bprototype\w*\b|\bprototype\b|\bpoC\b|\bproof[- ]of[- ]concept\b|\bexperiment\w*\b/i, w: 0.9 },
  { id: 'responsive', re: /\bresponsive\b|\bmobile[- ]first\b|\bmedia quer\w*\b/i, w: 0.9 },
  { id: 'a11y', re: /\baccessib\w*\b|\ba11y\b|\bscreen reader\w*\b|\bwcag\b|\bkeyboard[- ]only\b/i, w: 1.0 },
  { id: 'offline', re: /\boffline\b|\bno internet\b|\bair[- ]?gap\w*\b|\bon-?device\b/i, w: 1.0 },
  { id: 'fullstack', re: /\bfull[- ]stack\b|\bend[- ]to[- ]end\b/i, w: 1.0 },
  { id: 'indie', re: /\bsolo\b|\bindie\b|\bone[- ]person\b|\bpet project\w*\b|\bhackathon\w*\b/i, w: 0.8 },
];

// Filename/path patterns -> skill ids. Strong signal: if you wrote shaders.glsl
// you know GLSL regardless of what the README says.
export const PATH_SIGNALS = [
  { id: 'glsl', re: /\.(glsl|vert|frag|hlsl|wgsl)$/i, w: 1.5 },
  { id: 'threejs', re: /(^|\/)(three(\.min)?\.js|OrbitControls\.js)$/i, w: 1.6 },
  { id: 'gameengine', re: /(^|\/|[._-])(voxel|game|gameplay|player|physics|renderer|engine)[._-]?[^/]*\.(js|mjs|ts|html)$/i, w: 0.8 },
  { id: 'testing', re: /(^|\/)(test|tests|spec|__tests__|selfcheck|verify|node-tests)(\/|\.|$)/i, w: 1.0 },
  { id: 'cli', re: /(^|\/)(bin|cli)\/|\.(sh|bash|zsh)$/i, w: 1.0 },
  { id: 'networking', re: /(^|\/|[._-])(mesh|peer|gateway|supervisor|fabric|network)[._-]?[^/]*\.(js|mjs|ts)$/i, w: 0.8 },
  { id: 'security', re: /(^|\/)(security|defense|defence|guardian|harden|attacker|flood)[^/]*\.(js|mjs|ts|py)$/i, w: 0.8 },
  { id: 'docs', re: /\.(md|mdx|rst)$/i, w: 0.2 },
];

export function label(id) {
  return SKILL_LABELS[id] || id;
}

export function categoryOf(id) {
  if (CATEGORIES.language) {
    if (/^(javascript|typescript|python|html|css|shell|c|cpp|rust|go|java|csharp|ruby|php|sql|wasm|mobile)$/.test(id)) return 'language';
  }
  if (/^(threejs|webgl|glsl|webgpu|canvas|d3|physics|gameengine|blender|quantum|graphics)$/.test(id)) return 'graphics';
  if (/^(react|next|vue|svelte|angular|tailwind|dom|a11y|responsive|offline)$/.test(id)) return 'web';
  if (/^(node|express|api|websockets|http|postgres|nosql|redis|serverless|fullstack|search)$/.test(id)) return 'backend';
  if (/^(linux|networking|tcpudp|concurrency|perf|embedded|reverseng|os|security|crypto|pqc|pentest|threatmodel|iam|privacy)$/.test(id)) return 'security';
  if (/^(ml|quant|numpy|llm|viz|data)$/.test(id)) return 'data';
  if (/^(cli|buildtools|testing|devtools|gitops|docs|observability)$/.test(id)) return 'tooling';
  return 'product';
}

// The bridge between what a repo proves and what a job posting says.
// Job ads use hiring language; repos use engineering language. These aliases
// let a posting that asks for "WebGL/shaders" match evidence of glsl work.
export const ALIASES = {
  javascript: ['javascript', 'js', 'es6', 'ecmascript', 'front end', 'frontend'],
  typescript: ['typescript', 'ts'],
  python: ['python', 'py3', 'pytest', 'django', 'flask', 'fastapi', 'pandas'],
  html: ['html', 'html5', 'semantic'],
  css: ['css', 'css3', 'scss', 'sass', 'stylus', 'tailwind'],
  shell: ['bash', 'shell', 'zsh', 'shell scripting'],
  c: ['c', 'embedded c', 'systems programming'],
  cpp: ['c++', 'cpp', 'cplusplus'],
  rust: ['rust'],
  go: ['golang', 'go lang'],
  java: ['java', 'spring'],
  csharp: ['c#', '.net', 'dotnet'],
  sql: ['sql', 'postgres', 'mysql', 'sqlite', 'database'],
  wasm: ['webassembly', 'wasm'],

  threejs: ['three.js', 'threejs', 'three js', '3d', 'webgl'],
  webgl: ['webgl', 'webgl2', 'opengl', 'gpu', 'real-time rendering', 'realtime rendering'],
  glsl: ['glsl', 'shader', 'shaders', 'vertex shader', 'fragment shader', 'hlsl'],
  webgpu: ['webgpu', 'wgpu'],
  canvas: ['canvas', '2d rendering', 'pixi'],
  d3: ['d3', 'd3.js', 'dataviz', 'chart', 'charts'],
  physics: ['physics', 'physics engine', 'simulation', 'simulator', 'collision detection', 'numerical'],
  gameengine: ['game engine', 'gameplay', 'voxel', 'unity', 'unreal', 'gamedev'],
  blender: ['blender'],
  quantum: ['quantum', 'qubit', 'quantum computing'],

  react: ['react', 'reactjs', 'react.js'],
  next: ['next.js', 'nextjs', 'next'],
  vue: ['vue', 'vue.js', 'nuxt'],
  svelte: ['svelte', 'sveltekit'],
  angular: ['angular'],
  tailwind: ['tailwind', 'tailwindcss'],
  dom: ['dom', 'browser api', 'front end', 'frontend'],
  a11y: ['accessibility', 'a11y', 'wcag', 'aria', 'section 508'],
  responsive: ['responsive', 'mobile', 'mobile-first', 'adaptive'],
  offline: ['offline', 'pwa', 'service worker', 'installable'],

  node: ['node', 'node.js', 'nodejs'],
  express: ['express', 'express.js', 'fastify', 'nestjs'],
  api: ['api', 'rest', 'restful', 'graphql', 'endpoint'],
  websockets: ['websocket', 'websockets', 'realtime', 'real-time', 'sse', 'socket'],
  http: ['http', 'https', 'tcp', 'protocol', 'load balancer', 'proxy'],
  postgres: ['postgres', 'postgresql', 'supabase'],
  nosql: ['mongodb', 'dynamodb', 'nosql', 'firebase', 'cassandra'],
  redis: ['redis', 'memcached', 'cache'],
  serverless: ['serverless', 'lambda', 'edge', 'cloudflare workers'],

  linux: ['linux', 'unix', 'ubuntu', 'debian', 'systemd'],
  networking: ['networking', 'network', 'mesh', 'tcp/ip', 'bgp', 'firewall', 'lan'],
  tcpudp: ['tcp', 'udp', 'sockets', 'raw socket', 'packet'],
  concurrency: ['concurrency', 'concurrent', 'multithreading', 'async', 'event loop', 'worker pool'],
  perf: ['performance', 'optimization', 'optimisation', 'latency', 'profiling', 'throughput', 'benchmark'],
  embedded: ['embedded', 'firmware', 'iot', 'device', 'rtos', 'hardware'],
  reverseng: ['reverse engineering', 'reversing', 'binary', 'disassembly', 'malware'],
  os: ['kernel', 'operating system', 'syscall', 'driver'],

  security: ['security', 'secure', 'hardening', 'appsec', 'owasp', 'threat', 'vulnerability', 'cve'],
  crypto: ['cryptography', 'encryption', 'cipher', 'tls', 'ssl', 'hashing', 'key management'],
  pqc: ['post-quantum', 'post quantum', 'pqc', 'kyber', 'ml-kem', 'lattice', 'nist', 'harvest now'],
  pentest: ['penetration testing', 'pentest', 'pen test', 'red team', 'fuzzing', 'burp', 'offensive security', 'exploit'],
  threatmodel: ['threat model', 'threat modeling', 'attack surface', 'security posture'],
  iam: ['iam', 'identity', 'authentication', 'oauth', 'jwt', 'sso', 'auth', 'did'],
  privacy: ['privacy', 'on-device', 'offline', 'local-first', 'data protection'],

  ml: ['machine learning', 'ml', 'deep learning', 'neural', 'training', 'pytorch', 'tensorflow'],
  quant: ['quantization', 'quantisation', 'pruning', 'distillation', 'model compression', 'int8', 'int4', 'gguf'],
  numpy: ['numpy', 'pandas', 'scientific computing', 'linear algebra', 'numerical'],
  llm: ['llm', 'large language model', 'transformer', 'inference', 'rag', 'fine-tuning', 'moe', 'vllm', 'ollama'],
  viz: ['visualization', 'visualisation', 'dataviz', 'plotting', 'dashboard'],
  data: ['data', 'analytics', 'etl', 'pipeline'],
  search: ['search', 'fuzzy', 'ranking', 'recommendation'],

  cli: ['cli', 'command line', 'terminal', 'tui', 'argparse'],
  buildtools: ['build', 'bundler', 'webpack', 'vite', 'rollup', 'tooling', 'zero-dependency'],
  testing: ['testing', 'tests', 'unit test', 'vitest', 'jest', 'playwright', 'cypress', 'qa', 'test harness'],
  devtools: ['developer tools', 'devtools', 'developer experience', 'dx', 'ide', 'sdk', 'replit'],
  gitops: ['ci/cd', 'ci', 'cd', 'github actions', 'pipeline', 'deployment', 'infrastructure as code'],
  docs: ['documentation', 'technical writing', 'docs', 'guides'],
  observability: ['observability', 'monitoring', 'telemetry', 'metrics', 'logging', 'alerting'],

  ux: ['ux', 'ui', 'design', 'product design', 'user experience', 'figma', 'interface'],
  prototyping: ['prototype', 'prototyping', 'mvp', 'proof of concept'],
  responsive: ['responsive', 'mobile', 'mobile-first', 'adaptive'],
  fullstack: ['full stack', 'fullstack', 'end to end', 'end-to-end'],
  indie: ['indie', 'solo', 'zero to one', '0 to 1', 'founder', 'early stage', 'startup'],
  docker: ['docker', 'kubernetes', 'k8s', 'container'],
  cuda: ['cuda', 'gpu', 'nvidia', 'triton'],
};

// aliases[id] = the set of job-posting terms that prove a job wants id.
export function aliasTerms(id) {
  return ALIASES[id] || [];
}

// Term specificity: a 2-token phrase like "post-quantum" is a far stronger
// signal than "js". Longer and rarer terms get more weight.
export function termWeight(term) {
  if (!term) return 0;
  const t = term.trim();
  if (!t) return 0;
  const spaces = t.split(/\s+/).length;
  return t.length * (spaces > 1 ? 1.35 : 1);
}

export function stem(token) {
  if (token.length > 5 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith('es') && !token.endsWith('ses')) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

// Infra and platform asks. Without these the "what else does the job want" line
// silently omits the exact things a self-taught applicant lacks.
Object.assign(ALIASES, {
  docker: ['docker', 'kubernetes', 'k8s', 'container', 'containers', 'pod', 'helm'],
  cloud: ['aws', 'gcp', 'azure', 'cloud', 's3', 'ec2', 'cloudformation', 'infrastructure'],
  iac: ['terraform', 'pulumi', 'infrastructure as code', 'ansible', 'crossplane'],
  streaming: ['kafka', 'rabbitmq', 'pubsub', 'event stream', 'message queue', 'celery', 'sqs'],
  queues: ['redis', 'memcached', 'celery', 'sidekiq', 'bull', 'queue', 'job queue'],
});
Object.assign(SKILL_LABELS, {
  cloud: 'Cloud Platforms',
  iac: 'Infrastructure as Code',
  streaming: 'Event Streaming',
});
