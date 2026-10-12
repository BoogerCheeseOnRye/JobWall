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

## The résumé path

The second door on the page reads a résumé instead of a repo, then hands you
back a rewritten one. The file is read **in your browser** — there is no upload
endpoint, no account, and nothing written to disk on the server. In the browser
it is parsed by `docs/lib/resume.js`; the same file runs under Node for the CLI.

### What it accepts

| Input | Read by | Notes |
|---|---|---|
| `.pdf` | `docs/lib/pdf.js` | Text-layer PDFs only, including compressed streams |
| `.docx` | `docs/lib/docx.js` | `word/document.xml`, no third-party dependency |
| `.txt`, `.md` | plain text | The section headings do the work |

Not supported, and it says so instead of guessing: legacy `.doc`, PDFs with an
encryption dictionary, and scanned or image-only PDFs (no text layer to read).

Sections are matched by heading, with aliases — `Summary`/`Profile`/`Objective`,
`Experience`/`Work History`/`Employment`, `Education`/`Qualifications`, and so
on. Entries under `Certifications` fold into education and `Publications` into
awards, because that is where a reader expects to find them.

### The ten export formats

Every format is written from the same semantic model, so none of them is a
text-dump of another. The panel groups them by what you are doing with the file.

| Group | Formats | For |
|---|---|---|
| Ready to send | `pdf`, `docx`, `html` | What an employer actually reads |
| ATS-safe | `txt`, `html-ats`, `md`, `rtf` | Feeding a form or a tracker that mangles layout |
| Structured | `json`, `yaml`, `tex` | Importers that read fields, or your own typesetter |

- **`pdf`** — written by `docs/lib/pdf-write.js`: real Helvetica, word-wrapped,
  paginated, with clickable project links. No headless browser involved.
- **`docx`** — a real OOXML package (`docs/lib/zip.js` writes the zip). Validated
  by opening it in LibreOffice; every hyperlink's `r:id` is asserted against
  `word/_rels/document.xml.rels`, because a link with no relationship still
  *looks* fine and silently dies when clicked.
- **`json`** — JSON Resume shape (`basics`, `work`, `skills`, `projects`, …).
- **`yaml`** — the same structure, nested.
- **`tex`** — a single self-contained document; no preamble assumptions.

The writers are checked against the readers, not just against their own
expectations: the test suite extracts the text back out of the generated PDF and
DOCX and compares it, so a writer cannot drift from the parser it feeds.

### Offline

```bash
# what does the parser see?
node tools/resume-cli.mjs path/to/resume.pdf

# every format at once, then open the PDF and the styled HTML
node tools/resume-export.mjs path/to/resume.pdf --out ./out --open

# just two of them
node tools/resume-export.mjs path/to/resume.pdf --format json,md --out ./out

# one text format to stdout, with nothing but the document on it
node tools/resume-export.mjs path/to/resume.docx --format json --out - | jq .basics.name

# the parsed model, for debugging the parser
node tools/resume-export.mjs path/to/resume.pdf --pretty
```

Progress, warnings and file paths go to **stderr**, so `--out -` gives you a
clean document to pipe. Binary formats (`pdf`, `docx`) are refused there —
point `--out` at a directory for those. `--open` hands the finished files to the
desktop; it only ever opens what it just wrote.

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
minutes. That wall is why `test/browser-globals.test.js` is the only test that
talks to GitHub — it **skips with a reason** rather than failing when the limit
is spent or the network is gone. Set a token to keep it running:

```bash
GITHUB_TOKEN=ghp_xxx npm test
```

To raise the app's own limit to 5000/hour:

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

---

## Proposal: Local ADB/Termux hosting (documentation only)

**Status:** proposal. Not implemented. This must not be started without explicit
user approval.

### Why

Sometimes a device is generating or editing the files you want to inspect (e.g. a
Termux session on an Android phone). A reverse-tunnel from that device to the
dev box keeps it local-only — no third-party relay — while letting `server.js`
serve the same static build it already serves from `docs/`.

### Topology

- Termux runs `node server.js` on the phone (or just serves the `docs/` build via
  a tiny static server) bound to `127.0.0.1:8999`.
- `adb reverse tcp:8999 tcp:8999` exposes that port to the host while the USB
  connection is present.
- The browser on the host hits `http://127.0.0.1:8999` as it does today — no
  changes to the app, and no code ever reaches the internet except what GitHub
  jobs already fetch anonymously.

### Security

- Local loopback only. No public port is opened.
- Requires physical USB access to run `adb` (the trust gate). No SSH/HTTP auth
  is added unless the user explicitly asks for it.
- The existing "nothing stored" promise is unaffected: resumes stay in the
  browser.

### Known constraints

- **Termux process lifecycle:** Android kills background Termux processes
  aggressively (especially on Doze/App Standby). Long-lived servers need to stay
  in the foreground or use a wake-lock (`termux-wake-lock`). This is the single
  biggest operational point, not a code problem.
- **ADB connectivity:** `adb` can hang on a wedged adbd; recovery is `adb
  kill-server && adb start-server && adb reverse ...` — documented, not automated
  here.
- **Network path:** entirely offline from the user's LAN except localhost. No
  Cloudflare tunnel is proposed.
- **Port conflicts:** only one instance of `server.js` can bind to 8999 on a
  given host/phone.

### Implementation (minimal, if approved)

1. `tools/adb-termux.mjs` (optional) — prints the three commands to run, checks
   that `adb` and `node` exist, and verifies the reverse tunnel. No shell exec of
   long-running daemons.
2. README addition only: this section. No `package.json` script that spawns ADB
   without explicit consent.
3. No cluster watchdogs, no stack startup hooks. The Guard Rails from the
   environment (cluster OFF by default) are honoured.

### When to use it

Only when the user explicitly says to expose the local build over ADB. Until
then this remains documentation only. The static build (`docs/`) is the
deployment path for GitHub Pages; this is purely for local device-host
development.
