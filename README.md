# JobWall

Submit a GitHub project or a whole profile. It reads the actual code, works out
what you can demonstrably do, names the job titles that fit, and lists live
openings that match — with a link to every one.

```bash
cd JobWall
node server.js        # or ./run.sh
# → http://localhost:8999
node --test "test/*.test.js"
```

No dependencies, no build step, no API keys required.

## The GitHub Pages build

`docs/` is the front-end — the same directory the Node server serves, so there is
one copy of it rather than two that drift. It is published as a static site.

Pages runs no Node, so the published page is the interface only: submitting a
link there tells you the host has no API behind it. The matching, the feed pulls
and the wage parsing all need the server:

```bash
node server.js        # the real thing, on :8999
```

## What it accepts

- `https://github.com/owner/repo` — one project
- `owner/repo`, `owner`, or `github.com/owner`
- a profile reads your top projects' READMEs and manifests too, not just metadata

## How the matching works

**Evidence, four channels, each with a ceiling.** Nothing you can write in a
README outranks bytes you committed.

| channel | ceiling | example |
| --- | --- | --- |
| bytes committed | 1.00 | language share of the repo |
| declared dependency | 0.80 | `three` in a manifest or vendored |
| file you wrote | 0.75 | `app/shaders/main.vert` |
| your own description | 0.60 | README, topics, descriptions |

Within a channel, signals combine as noisy-OR, so repetition has diminishing
returns. Vendored code is excluded — `three`'s own `LightProbeHelper.js` is not
evidence that you do security work.

**Roles are weighted baskets** of those skills. Core skills decide the fit;
bonuses move it. Each role reports what you proved, what it could not find, and
the exact evidence string ("file: node-tests/defense-tool.mjs").

**Openings are scored against your evidence**, not against keywords. The job
title is a gate, not a garnish: a posting whose title never names something you
can do cannot score highly on the strength of a flattering description. Generic
title words ("product", "software", "web") are ignored, and non-engineering
titles are marked as such.

**Two scores per opening.** `evidence %` is how much of your proven work the
posting speaks to. `realistic %` subtracts gates a portfolio cannot show:
required years, senior/lead titles, degrees, security clearance, on-site,
sponsorship. Neither number is a person.

**Wage ranges are quoted, never modelled.** Each posting is read for its own
terms: the board's structured salary field first, then the prose — with a
currency-and-period grammar that reads `€117.200 &mdash; €146.500 EUR` and
`Day rate: £500-£750` correctly and refuses to read a wage out of "over $200B
in annualized spend" or a Series B round. Figures outside plausible bounds for
their unit are dropped rather than displayed. Where the posting said nothing,
the card says *pay not stated*; there is no estimate anywhere.

Role cards carry a **market band**: the interquartile range, in USD, of the
matching openings that state their pay, annotated with how many of them did
(`26 of 84 state pay`). Non-USD ranges are converted at ECB reference rates
(Frankfurter, free and keyless, cached 6 hours) and shown alongside the original.

## Feeds

Live, no key, refreshed every 10 minutes: Arbeitnow, Remotive, Remote OK,
Jobicy. Cross-posted duplicates are collapsed. Every result links to the actual
posting, and the search section builds deep links to LinkedIn, Indeed, We Work
Remotely, Wellfound, Remote OK, Dice and HN "Who is hiring?" so nothing is lost
when a feed is down or thin.

## Note on GitHub rate limits

Anonymous GitHub API access is 60 requests/hour and results are cached for 10
minutes. To raise it to 5000/hour:

```bash
GITHUB_TOKEN=ghp_xxx node server.js
```

## API

```bash
curl -s localhost:8999/api/health
curl -s -X POST localhost:8999/api/analyze \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://github.com/BoogerCheeseOnRye/SecMesh"}' | jq .roles
```
