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
    };
  }
  return {
    ...base,
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
