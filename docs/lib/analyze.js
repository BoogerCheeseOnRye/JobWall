import { parseTarget, analyzeRepo, analyzeProfile } from './github.js';
import { detect } from './extract.js';
import { scoreRoles, VERDICT_COPY } from './roles.js';
import { fetchFeed, rankJobs } from './jobs.js';
import { usdRates, formatWage, describeWageStats } from './wages.js';
import { searchBlock } from './search.js';

function summarize(profile, target) {
  const base = {
    kind: profile.kind,
    name: profile.name,
    handle: profile.name,
    url: profile.url,
    description: profile.description || profile.bio || '',
    stars: profile.stars,
    forks: profile.forks,
    languages: profile.languages,
    topics: profile.topics || [],
    deps: Object.keys(profile.deps || {}).slice(0, 40),
    files: profile.files || [],
    tools: profile.tools || null,
    pushedAt: profile.pushedAt || null,
    createdAt: profile.createdAt,
  };
  if (target.kind === 'repo') {
    return {
      ...base,
      repo: profile.repo,
      sizeKb: profile.sizeKb,
      license: profile.license,
      openIssues: profile.openIssues,
      defaultBranch: profile.defaultBranch,
      fileCount: profile.paths.length,
      notablePaths: profile.paths
        .filter((p) => /\.(mjs|js|ts|tsx|py|glsl|frag|vert|html|c|cpp|rs|sh)$/i.test(p))
        .slice(0, 60),
      readmeChars: profile.readme.length,
      links: [profile.url, `${profile.url}/blob/${profile.defaultBranch}/README.md`],
      repoTotal: 1,
      publicRepos: 1,
      sampledRepos: [profile.repo],
      // One repo is still a project. The dossier registry and the draft export
      // read the same field as a profile, so the card has the same metadata.
      repos: [{
        name: profile.repo,
        url: profile.url,
        description: profile.description || '',
        language: Object.keys(profile.languages || {})[0] || null,
        stars: profile.stars || 0,
        forks: profile.forks || 0,
        watchers: profile.watchers || 0,
        pushedAt: profile.pushedAt || null,
        createdAt: profile.createdAt || null,
        updatedAt: profile.updatedAt || null,
        topics: profile.topics || [],
        sizeKb: profile.sizeKb || 0,
        openIssues: profile.openIssues ?? null,
        license: profile.license || null,
        homepage: profile.homepage || null,
        defaultBranch: profile.defaultBranch || null,
        fork: Boolean(profile.fork),
        archived: Boolean(profile.archived),
        commits: profile.commits ?? null,
        lastCommit: profile.lastCommit || null,
        lastCommitMessage: profile.lastCommitMessage || null,
        lastCommitSha: profile.lastCommitSha || null,
        sampled: true,
      }],
    };
  }
  return {
    ...base,
    // summarize() rebuilds the profile from a fixed field list, so anything
    // else the caller attached has to be named here or it is dropped.
    fromResume: profile.fromResume || false,
    realName: profile.realName,
    followers: profile.followers,
    publicRepos: profile.publicRepos,
    location: profile.location,
    blog: profile.blog,
    sampledRepos: profile.sampledRepos || [],
    repoTotal: profile.repoTotal || 0,
    repos: profile.repos,
    links: [profile.url],
  };
}

export async function analyze(input) {
  const target = parseTarget(input);
  const raw =
    target.kind === 'repo'
      ? await analyzeRepo(target.owner, target.repo)
      : await analyzeProfile(target.owner);
  return score(target, raw);
}

// More than one profile is still one person, so the evidence is merged before
// it is scored rather than scored separately and added up. Scoring each source
// alone and combining the results would double-count shared skills and let a
// second repo "outvote" the first on roles neither of them supports on its own.
//
// The merge is deliberately shallow per source but complete across them: every
// language byte, dependency, README, topic, path and file from every source is
// present in the one raw the scorer sees.
function mergeCounts(list) {
  const out = {};
  for (const counts of list) {
    for (const [key, value] of Object.entries(counts || {})) {
      out[key] = (out[key] || 0) + (typeof value === 'number' && Number.isFinite(value) ? value : 1);
    }
  }
  return out;
}

const mergeUnique = (list) => [...new Set(list.flat().filter(Boolean))];

export function mergeRaws(raws) {
  const sources = raws.map((r) => ({
    kind: r.kind,
    name: r.name,
    url: r.url,
    description: r.description || r.bio || '',
    stars: r.stars || 0,
    fromRepo: r.kind === 'repo' ? `${r.owner}/${r.repo}` : null,
  }));

  // Every repo a profile sampled, plus a stand-in for each bare repo, so the
  // project list in section 1 is populated whichever shape the sources are.
  const repos = raws.flatMap((r) =>
    r.kind === 'repo'
      ? [{
          name: r.repo,
          url: r.url,
          description: r.description || '',
          language: Object.keys(r.languages || {})[0] || null,
          stars: r.stars || 0,
          forks: r.forks || 0,
          watchers: r.watchers || 0,
          pushedAt: r.pushedAt || null,
          createdAt: r.createdAt || null,
          updatedAt: r.updatedAt || null,
          topics: r.topics || [],
          sizeKb: r.sizeKb || 0,
          openIssues: r.openIssues ?? null,
          license: r.license || null,
          homepage: r.homepage || null,
          defaultBranch: r.defaultBranch || null,
          fork: Boolean(r.fork),
          archived: Boolean(r.archived),
          commits: r.commits ?? null,
          lastCommit: r.lastCommit || null,
          lastCommitMessage: r.lastCommitMessage || null,
          lastCommitSha: r.lastCommitSha || null,
          sampled: true,
        }]
      : r.repos || []
  );
  const seenRepo = new Set();
  const uniqueRepos = repos.filter((r) => {
    const key = r.url || r.name;
    if (!key || seenRepo.has(key)) return false;
    seenRepo.add(key);
    return true;
  });

  const descriptions = raws.flatMap((r) =>
    r.kind === 'repo'
      ? [r.description || '']
      : (r.repos || []).map((x) => `${x.name} ${x.description || ''}`)
  );

  return {
    kind: 'multi',
    owner: raws.map((r) => r.owner).join('+'),
    name: raws.map((r) => r.name).join(' + '),
    url: raws[0]?.url || '',
    description: sources.map((s) => s.description).filter(Boolean).join(' · '),
    bio: raws.map((r) => r.bio).filter(Boolean).join(' · '),
    realName: raws.find((r) => r.realName)?.realName || null,
    location: raws.find((r) => r.location)?.location || '',
    blog: raws.find((r) => r.blog)?.blog || '',
    followers: raws.reduce((n, r) => n + (r.followers || 0), 0),
    stars: raws.reduce((n, r) => n + (r.stars || 0), 0),
    forks: raws.reduce((n, r) => n + (r.forks || 0), 0),
    publicRepos: uniqueRepos.length,
    repoTotal: uniqueRepos.length,
    languages: mergeCounts(raws.map((r) => r.languages)),
    deps: mergeCounts(raws.map((r) => r.deps)),
    topics: mergeUnique(raws.map((r) => r.topics || [])),
    paths: mergeUnique(raws.map((r) => r.paths || [])),
    files: mergeUnique(raws.map((r) => r.files || [])),
    tools: Object.assign({}, ...raws.map((r) => r.tools || {})),
    readme: raws.map((r) => r.readme || '').join('\n\n'),
    repos: uniqueRepos,
    sampledRepos: uniqueRepos.filter((r) => r.sampled).map((r) => r.name),
    sources,
    createdAt: raws.map((r) => r.createdAt).filter(Boolean).sort()[0] || null,
    pushedAt: raws.map((r) => r.pushedAt).filter(Boolean).sort().at(-1) || null,
  };
}

// Accepts one target or many. One target keeps the old code path exactly, so a
// single-profile analysis cannot change behaviour because a feature was added
// beside it.
export async function analyzeMany(inputs) {
  const list = (Array.isArray(inputs) ? inputs : [inputs]).map((i) => String(i).trim()).filter(Boolean);
  if (!list.length) throw new Error('no target given');
  if (list.length === 1) return analyze(list[0]);

  const targets = list.map(parseTarget);
  const raws = [];
  for (const target of targets) {
    // Sequential on purpose: the anonymous GitHub limit is 60 requests/hour and
    // each source costs many, so firing them all at once buys a rate-limit
    // failure instead of a faster answer.
    raws.push(
      target.kind === 'repo'
        ? await analyzeRepo(target.owner, target.repo)
        : await analyzeProfile(target.owner)
    );
  }
  const merged = mergeRaws(raws);
  const result = await score({ kind: 'multi', owner: merged.owner }, merged);
  result.profile.members = merged.sources;
  return result;
}

// Split out from analyze() so the scoring half can be exercised without spending
// GitHub API quota.
export async function score(target, raw) {
  const ev = detect({
    languages: raw.languages,
    deps: raw.deps,
    readme: raw.readme,
    descriptions: target.kind === 'repo' ? [raw.description] : raw.repos.map((r) => `${r.name} ${r.description}`),
    topics: raw.topics,
    paths: raw.paths,
    fromResume: Boolean(raw.fromResume),
  });

  const skills = ev.top(26);
  const roles = scoreRoles(skills);

  const feed = await fetchFeed();
  const rates = await usdRates();
  const ranked = rankJobs({ jobs: feed.jobs, skills, roles, rates });

  // A role with no live openings is still a role, but the person should know
  // which of their titles the market is actually paying for today.
  const openCounts = new Map(ranked.counts.map((c) => [c.roleId, c.count]));
  const payByRole = new Map(ranked.pay.map((p) => [p.roleId, p]));
  const withCounts = roles.map((r) => {
    const pay = payByRole.get(r.id);
    return {
      ...r,
      verdictCopy: VERDICT_COPY[r.verdict],
      openingsNow: openCounts.get(r.id) || 0,
      // Aggregated from postings that state their own terms. A role where nobody
      // publishes pay says so instead of borrowing a number from elsewhere.
      pay: pay && pay.stating
        ? { ...pay, label: describeWageStats(pay), median: pay.annual?.usdMedian || pay.hourly?.usdMedian || null }
        : pay
          ? { openings: pay.openings, stating: 0, label: null }
          : { openings: 0, stating: 0, label: null },
      bestOpenings: (ranked.byRole.find((b) => b.roleId === r.id)?.jobs || []).slice(0, 3).map((j) => ({
        title: j.title,
        company: j.company,
        url: j.url,
        match: j.match,
        realistic: j.realistic,
        location: j.location,
        remote: j.remote,
        sourceName: j.sourceName,
        wage: j.wage ? formatWage(j.wage, rates) : null,
      })),
    };
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    target,
    profile: summarize(raw, target),
    skills,
    roles: withCounts,
    jobs: {
      count: ranked.all.length,
      scanned: feed.jobs.length,
      results: ranked.all,
      byRole: ranked.byRole,
    },
    search: searchBlock(withCounts, skills),
    sources: feed.sources,
    fx: rates.date ? { date: rates.date, note: 'non-USD ranges converted at ECB reference rates' } : null,
  };
}
