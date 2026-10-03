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

`docs/` is the whole front-end, and it is what GitHub Pages publishes. It holds
`lib/` too, so the page and the server run the *same* engine from one copy —
there is no build step and nothing to keep in sync.

Pages runs no Node, so there is no `/api/*` there. The page handles that: it
probes `/api/health` once and picks a backend.

- **Server** — `node server.js`. The API is real and the page uses it.
- **In-browser** — no backend at all. Every upstream (Arbeitnow, Remotive,
  Remote OK, Jobicy, GitHub, Frankfurter) sends `Access-Control-Allow-Origin: *`,
  and `lib/` is plain ES modules with no node builtins, so the engine simply
  runs in the page against the same sources.

A failed probe is never surfaced as `res.json()` throwing `Unexpected token '<'`
— responses are read as text and parsed, so an HTML error page becomes a
readable message instead of a syntax error.

### The 60/hour wall

GitHub gives anonymous callers **60 requests/hour per IP**, and a profile scan
spends several of them. Results are cached in `localStorage` for 30 minutes, so
revisits and back-and-forth on the same link cost nothing. To raise the ceiling,
run the server with a token:

```bash
GITHUB_TOKEN=ghp_xxx node server.js
```

If you need this to hold up under traffic, put a real backend behind the same
`lib/` — a Cloudflare Worker is a ~40-line adapter, because none of the engine
touches node builtins.

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

**Section 1 is written for a recruiter, not a dashboard.** It leads with the
finding — the two roles the evidence actually supports, and the strongest
signals behind them — before any of the machinery. Then language mix, then
skills with their evidence, then the projects.

Projects are ranked by **size, then stars, then recency**, never by GitHub's
default "most recently pushed" order. Recency order reads as a ranking of
importance and is wrong: it used to cut the grid at 12 entries, which dropped a
7.9 MB game while keeping an 8 KB scratch repo, making the largest project on the
profile look like it did not exist. Every repo is now listed, and the ones read
down to their README and `package.json` are marked. A language with a real but
tiny byte share says `<1%` and keeps a visible sliver instead of rendering as
`0.0%` beside an empty bar.

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

Live, no key, refreshed every 10 minutes: **The Muse**, Arbeitnow, Remotive,
Remote OK, Jobicy. Cross-posted duplicates are collapsed. Every result links to
the actual posting, and the search section builds deep links to LinkedIn,
Indeed, We Work Remotely, Wellfound, Remote OK, Dice, Built In and HN
"Who is hiring?" so nothing is lost when a feed is down or thin.

## Where — locations

The feeds are geographically lopsided. Arbeitnow is German, the remote boards
often say only "Remote", and until The Muse was added a Seattle reader had
**zero** local postings: 85 rows literally labelled `USA` were indistinguishable
from rows with no location at all. So `lib/geo.js` reads the string every board
gives us and works out the country, US state and Seattle metro.

The **Where** control then narrows the results:

| Scope | Shows |
|-------|-------|
| **US + remote** (default) | US postings and anything remote. Drops the ones we can be *sure* are elsewhere. |
| **Seattle area** | Seattle, Bellevue, Redmond, Kirkland, Tacoma and the eastside, plus remote roles. |
| **Worldwide** | Everything the feeds carry. |

A location we cannot place is never hidden. Only openings the text positively
identifies as elsewhere — `London`, `Berlin`, `Paris` — are dropped from the US
view, because filing an unrecognised city as "overseas" would hide a US job from
the person who most needs it. `"USA"`, `"Remote"` and `"Worldwide"` all stay in.

Switching scope re-aims the hand-built search links too: LinkedIn, Indeed, Dice
and Built In follow your choice, so "Seattle area" points at Built In Seattle
rather than a nationwide board.

Note that The Muse bot-filters the bare `curl` User-Agent and answers `403`.
Both paths that matter are fine — Chrome (what a browser sends, because `fetch`
cannot set `User-Agent`) and this project's own string — and both return
`Access-Control-Allow-Origin: *`.

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
