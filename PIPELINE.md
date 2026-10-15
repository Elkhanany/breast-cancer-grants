# How the database keeps itself current

One scheduled routine, every other day at about 2 AM Central, in a fresh cloud session. It runs
three steps in order, each cheap where it can be and careful where it must be. Deterministic code
notices change; a model interprets change and decides; a human sees every decision in git. The
order of operations, command by command, is [ROUTINE.md](ROUTINE.md).

```
          every other day, ~02:00 Central · one fresh cloud session · ROUTINE.md

   0 preflight: fresh clone of GitLab main · push --dry-run · open web reachable?
                 │ yes                                  no ──► change nothing, report, stop
                 ▼
   ┌──────────────────────┐   ┌──────────────────────────┐   ┌──────────────────────────┐
   │ 1 crawl              │   │ 2 discover               │   │ 3 refresh                │
   │   notice, not decide │   │   find what we lack      │   │   the definitive update  │
   │                      │   │                          │   │                          │
   │ tools/watch.py       │──►│ 8 search lenses, each    │──►│ REFRESH.md: reads        │
   │  · ~100 sponsor pages│   │ blind to the others      │   │ signals.json and         │
   │  · Grants.gov API    │   │  · BCM intramural        │   │ candidates.json          │
   │  · date-set diff     │   │  · Rice / MDACC / TMC    │   │                          │
   │  · RFP-line diff     │   │  · quiet national funders│   │ fan-out: parallel agents │
   │                      │   │  · industry IIS + data   │   │ re-read primary sources, │
   │ model only on deltas │   │  · pharma RFPs open now  │   │ enrich, re-score; a moved│
   │                      │   │  · consortia / coop grps │   │ date is read twice       │
   │ writes signals.json  │   │  · physician-scientist   │   │                          │
   │ may fix a clear date │   │  · federal-adjacent      │   │ promotes verified finds  │
   │                      │   │                          │   │ from earlier runs        │
   │                      │   │ every find verified on   │   │                          │
   │                      │   │ its primary page, then a │   │ retires what stopped     │
   │                      │   │ critic asks what the     │   │                          │
   │                      │   │ local lenses missed      │   │                          │
   │                      │   │                          │   │                          │
   │                      │   │ writes candidates.json   │   │ writes grants.json       │
   └──────────────────────┘   └──────────────────────────┘   └────────────┬─────────────┘
                                                                          │
                              4  tools/validate.py gates the commit ◄─────┘
                                            │
                              5  one commit, pushed to GitLab main
                                            │
                              Cloudflare Pages rebuilds (validate.py && node --check app.js)
                                            │
                              breast-cancer-grants.pages.dev, minutes later
```

## Where it runs

A Claude Code scheduled task on the web fires every other day at about 02:00 America/Chicago and
starts a fresh session each time. The session clones GitLab `main` into a scratch directory,
ignoring whatever checkout it was started with, and pushes back to GitLab `main` only. Cloudflare
Pages builds every push to `main` with `python3 tools/validate.py && node --check app.js` and
serves the result at https://breast-cancer-grants.pages.dev/; a failed build publishes nothing,
so the site stays on the last good deploy. Pages that refuse plain fetches are read with
`tools/read_page.py`, headless Chromium. The session needs the open web and a GitLab token with
`write_repository`; ROUTINE.md step 0 checks both before anything changes.

Until October 2026 this was three jobs in the Claude desktop app on the owner's PC — a daily
watch, a Monday/Thursday refresh and a Wednesday discovery sweep — deploying to GitHub Pages.
One run that does all three in order is simpler to reason about, and a finding from one step
reaches the next step in minutes rather than days.

## Files and who owns them

| File | Written by | Read by | Meaning |
|---|---|---|---|
| `data/grants.json` | step 3 (refresh); step 1 (crawl) for unambiguous date moves | site, everything | The curated set. Only records that passed a primary-source check live here. |
| `data/changelog.json` | step 3, one entry per run | site | Newest first. `entries[0]` is "Last update". |
| `data/fingerprints.json` | `tools/watch.py` | `tools/watch.py` | Per-URL date sets and the Grants.gov numbers already seen. State, not content; committed every run, because a fresh session's only memory is git. |
| `data/signals.json` | `tools/watch.py` | step 1 (model triage), step 3 | What changed since the last run. Overwritten each run. |
| `data/candidates.json` | step 2 (discovery) | site ("Newly surfaced"), step 3 | Finds awaiting promotion. Each carries a full grant-shaped `record`, its `provenance`, its `verification`, and a `decision`. |

## 1. Crawl — notice, do not decide

`tools/watch.py` fetches the pages of records that earn a look every run (deadline within 75 days,
every DOD BCRP and CPRIT record, every industry portal in the trial-funding bucket, anything
still projected or unverified in the federal or state buckets), reduces each page to the set of
calendar dates on it, and diffs that set against the previous run's. Industry portals are rolling
and carry no deadline, so for every page it also keeps the set of short passages around RFP-ish
phrases — "request for proposals", "areas of interest", "now accepting", a drug name in a call —
and reports a new passage as `rfp_changed`. That is how a Merck sac-TMT call or a Gilead
Trodelvy RFP surfaces within two days of being posted. A record may list extra pages in
`watch_urls` — the Merck record watches its areas-of-interest list, the Gilead record its oncology
RFP page — because the list behind a portal's landing page is where a call actually appears. It also asks
the Grants.gov `search2` API for federal opportunities mentioning breast cancer and reports any
opportunity number it has never seen. No model runs for a page whose dates did not change.

The model step then reads `signals.json`. For a `dates_changed` signal it opens the page and
decides whether a posted deadline actually moved. If a deadline is stated plainly on the primary
page, it applies the change to `grants.json` (dates, `deadline_status`, `confidence`,
`last_verified`, a re-scored `fit`) and notes old → new for the run's changelog entry. Anything
ambiguous, and every `blocked` (403) or `unreachable` page, is left in `signals.json` for step 3,
which runs minutes later. `new_federal_opportunity` signals are triaged in one line each:
relevant → left for step 3 to record; irrelevant → ignored (the number stays in
`fingerprints.json` so it is never reported twice).

**Coverage audit.** Industry programmes come and go, and a company with no record raises no
signal simply by being absent. So the crawler also carries a watchlist of pharma and diagnostics
companies whose assets touch this portfolio, matches each against the URLs of active records by
domain, and raises `coverage_gap` for any company nothing cites — at most once every 30 days, so
a known absence is a monthly question rather than noise on every run. Matching is by domain on
purpose: a foundation award carrying a company's name never counts as coverage of its
investigator-research programme. Companies represented today: 19 of 27.

Pages that block scripts (CPRIT's landing page, Komen and PCORI return 403 to plain fetches)
are still watched: the signal says so, and the model reads them with `tools/read_page.py`,
headless Chromium, which renders JavaScript and is not refused (on a desktop run the in-app
browser does the same job). When a blocked page becomes readable again the signal is
`now_readable`, not a diff, so a first full read is never mistaken for a change.

## 2. Discover — find what the set lacks

Eight lenses search independently, each told what the database already holds so it does not
return it, each required to fetch a primary page before naming a find, each capped at eight.
Every candidate then goes to a separate verifying agent that re-derives every field from the
primary page and fills a complete grant-shaped record, in the database's voice. A final critic
looks only at the two local lenses — BCM intramural and Texas Medical Center collaboration —
and searches for what both missed, because those are the least indexed and the most valuable.

Verified finds land in `candidates.json`. They appear on the site as soon as the run's push
deploys, under "Newly surfaced", marked as awaiting promotion, so nothing is hidden while it waits
for the refresh of a later run. A find that is really news about a held record is not added:
step 3 reads it beside that record, and either applies it or records a new posted cycle. "The same
mechanism" means an agent named the held record, or sponsor and program match. A shared URL does
not count, because one portal page lists many calls. So a new Pfizer RFP or PCORI cycle on a page
a held record already cites becomes a candidate, with a note that step 3 checks before promoting.
A find that is already a candidate is never added twice. If it is still pending and today's
verifier reads it differently (it has opened, say), its verification is brought up to date.

The lenses, in the order they matter to this profile:

1. **BCM intramural** — Duncan Cancer Center pilots, Smith Breast Center SPORE DRP/CEP, ICTR/CTSA
   pilots and KL2, Office of Research seed and bridge funds, named institutional awards, the
   InfoReady limited-submission portal. It always starts with the cancer center's own curated
   list of external opportunities (`bcm.edu/.../dan-l-duncan-comprehensive-cancer-center/new-funding-opportunities`),
   which the DLDCCC grants office keeps current with deadlines; the critic checks it too.
2. **Texas Medical Center and Houston** — Rice seed funds and institutes, MD Anderson programs with
   an external-collaborator route, TMC Innovation and Health Policy, Gulf Coast Consortia,
   UTHealth and Methodist joint programs, Houston philanthropy that funds investigators.
3. **Quiet national funders** — small and mid-size foundations with a multi-year award record and
   little marketing.
4. **Industry investigator-initiated and data partners** — HER2/ADC/endocrine-therapy sponsors and
   the ctDNA/MRD and real-world-data companies whose research programs are rarely listed anywhere.
8. **Pharma RFPs open now** — the time-limited, asset-specific calls sponsors post on top of their
   standing portal, which are the ones with a real deadline and the ones nobody advertises.
5. **Cooperative groups and consortia** — TBCRC, ECOG-ACRIN, SWOG/Hope, NRG, Alliance, I-SPY, and
   whether BCM is a member site where membership is by site.
6. **Physician-scientist career awards** — built for an MD with clinical duties at year 7+, including
   the NIH Loan Repayment Program.
7. **Federal-adjacent** — AIM-AHEAD, NIMHD, FDA real-world-evidence BAAs, Moonshot RFAs, PCORI cycles
   not yet held. Grants.gov is the source of truth for anything federal.

## 3. Refresh — verify, enrich, promote

Follows [REFRESH.md](REFRESH.md) exactly. Two things matter most:

**Fan-out.** Records due for re-verification are split into batches, and one agent per batch
re-reads the primary sources and returns a structured diff — dates, award, eligibility, plus
enrichment fields when the sponsor posts them: awards made per cycle, success rate, program
contact, a recent relevant awardee. A date that moved is re-read by a second, independent agent
before it is written; a disagreement is reported rather than resolved.

**Promotion.** Each entry in `candidates.json` with `decision: "pending"` whose verification
shows `real`, `active` and `eligible_plausible` and whose `confidence` is not `unverified` is
copied into `grants.json` with `first_seen` set to today, and its `decision` becomes
`"promoted"`. A find is never promoted by the run that found it, so it spends at least two days
on the site first. Entries marked `"reject"` are left alone forever. To stop a promotion, set
`decision` to `"reject"` in `candidates.json` on GitLab `main` before the next run; to force
one, set it to `"promote"`.

## Guardrails that apply to every step

- Primary sources only. A sponsor's own page, the announcement PDF, or Grants.gov. Never an
  aggregator, never a news article, never memory.
- Nothing enters `grants.json` without a fetched primary page and a second look.
- Nothing is deleted. Programs that stop are retired with a date and reason.
- The repository is public. Records are written in neutral third person ("the PI") and never
  carry personal career detail.
- `python3 tools/validate.py` must exit 0 before any commit. The push is the deploy: Cloudflare
  Pages rebuilds the site from GitLab `main`, running the same validator first.
- Every run reports in a few lines: what closes within 30 days, what moved (old → new), what is
  new, what was promoted. If nothing, it says so in two lines.
