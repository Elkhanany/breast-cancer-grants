# How the database keeps itself current

Three scheduled jobs, each cheap where it can be and careful where it must be. Deterministic
code notices change; a model interprets change and decides; a human sees every decision in git.

```
            daily 06:30              Mon + Thu 07:00                weekly Wed 07:00
   ┌──────────────────────┐   ┌──────────────────────────┐   ┌──────────────────────────┐
   │  bc-grants-daily-    │   │  bc-grants-refresh       │   │  bc-grants-discovery     │
   │  watch               │   │  (definitive update)     │   │  (find what we lack)     │
   │                      │   │                          │   │                          │
   │ tools/watch.py       │──►│ reads signals.json       │◄──│ 7 search lenses, each    │
   │  · ~60 sponsor pages │   │  + candidates.json       │   │ blind to the others      │
   │  · Grants.gov API    │   │                          │   │  · BCM intramural        │
   │  · date-set diff     │   │ fan-out: parallel agents │   │  · Rice / MDACC / TMC    │
   │                      │   │ re-read primary sources, │   │  · quiet national funders│
   │ model only on deltas │   │ enrich, re-score         │   │  · industry IIS + data   │
   │                      │   │                          │   │  · consortia / coop grps │
   │ writes signals.json  │   │ promotes verified        │   │  · physician-scientist   │
   │ may fix a clear date │   │ candidates into grants   │   │  · federal-adjacent      │
   └──────────┬───────────┘   └────────────┬─────────────┘   │                          │
              │                            │                 │ every find verified on   │
              │                            │                 │ its primary page, then a │
              │                            │                 │ critic asks what the     │
              │                            │                 │ local lenses missed      │
              │                            │                 │                          │
              │                            │                 │ writes candidates.json   │
              │                            │                 └────────────┬─────────────┘
              └──────────────► git commit + push ◄──────────────────────┘
                                       │
                          tools/validate.py gates the deploy
                                       │
                            GitHub Pages redeploys
```

## Files and who owns them

| File | Written by | Read by | Meaning |
|---|---|---|---|
| `data/grants.json` | refresh; daily watch for unambiguous date moves | site, everything | The curated set. Only records that passed a primary-source check live here. |
| `data/changelog.json` | any job that changes grants.json | site | Newest first. `entries[0]` is "Last update". |
| `data/fingerprints.json` | `tools/watch.py` | `tools/watch.py` | Per-URL date sets and the Grants.gov numbers already seen. State, not content. |
| `data/signals.json` | `tools/watch.py` | daily watch (model step), refresh | What changed since the last look. Overwritten each run. |
| `data/candidates.json` | discovery | site ("Newly surfaced"), refresh | Finds awaiting promotion. Each carries a full grant-shaped `record`, its `provenance`, its `verification`, and a `decision`. |

## 1. Daily watch — notice, do not decide

`tools/watch.py` fetches the pages of records that earn a daily look (deadline within 75 days,
every DOD BCRP and CPRIT record, every industry portal in the trial-funding bucket, anything
still projected or unverified in the federal or state buckets), reduces each page to the set of
calendar dates on it, and diffs that set against yesterday's. Industry portals are rolling and
carry no deadline, so for every page it also keeps the set of short passages around RFP-ish
phrases — "request for proposals", "areas of interest", "now accepting", a drug name in a call —
and reports a new passage as `rfp_changed`. That is how a Merck sac-TMT call or a Gilead
Trodelvy RFP surfaces the day it is posted. It also asks the Grants.gov `search2` API for federal opportunities mentioning
breast cancer and reports any opportunity number it has never seen. No model runs for a page
whose dates did not change.

The model step then reads `signals.json`. For a `dates_changed` signal it opens the page and
decides whether a posted deadline actually moved. If a deadline is stated plainly on the primary
page, it applies the change to `grants.json` (dates, `deadline_status`, `confidence`,
`last_verified`, a re-scored `fit`), prepends a changelog entry, validates, commits and pushes.
Anything ambiguous, and every `blocked` (403) or `unreachable` page, is left in `signals.json`
for the definitive pass. `new_federal_opportunity` signals are triaged in one line each: relevant
→ left for the refresh to record; irrelevant → ignored (the number stays in `fingerprints.json`
so it is never reported twice).

Pages that block scripts (CPRIT's landing page, Komen and PCORI return 403 to plain fetches)
are still watched: the signal says so, and the model reads them in the in-app browser, which
renders JavaScript and is not refused. When a blocked page becomes readable again the signal is
`now_readable`, not a diff, so a first full read is never mistaken for a change.

## 2. Mon/Thu refresh — verify, enrich, promote

Follows [REFRESH.md](REFRESH.md) exactly. Two things it does now that it did not before:

**Fan-out.** Records due for re-verification are split into batches, and one agent per batch
re-reads the primary sources and returns a structured diff — dates, award, eligibility, plus
enrichment fields when the sponsor posts them: awards made per cycle, success rate, program
contact, a recent relevant awardee. A date that moved is re-read by a second, independent agent
before it is written; a disagreement is reported rather than resolved.

**Promotion.** Each entry in `candidates.json` with `decision: "pending"` whose verification
shows `real`, `active` and `eligible_plausible` and whose `confidence` is not `unverified` is
copied into `grants.json` with `first_seen` set to today, and its `decision` becomes
`"promoted"`. Entries marked `"reject"` are left alone forever. To stop a promotion, set
`decision` to `"reject"` in `candidates.json` before Monday or Thursday; to force one, set it
to `"promote"`.

## 3. Weekly discovery — find what the set lacks

Seven lenses search independently, each told what the database already holds so it does not
return it, each required to fetch a primary page before naming a find, each capped at eight.
Every candidate then goes to a separate verifying agent that re-derives every field from the
primary page and fills a complete grant-shaped record, in the database's voice. A final critic
looks only at the two local lenses — BCM intramural and Texas Medical Center collaboration —
and searches for what both missed, because those are the least indexed and the most valuable.

Verified finds land in `candidates.json`. They appear on the site the same day under
"Newly surfaced", marked as awaiting promotion, so nothing is hidden while it waits for the
Mon/Thu pass.

The lenses, in the order they matter to this profile:

1. **BCM intramural** — Duncan Cancer Center pilots, Smith Breast Center SPORE DRP/CEP, ICTR/CTSA
   pilots and KL2, Office of Research seed and bridge funds, named institutional awards, the
   InfoReady limited-submission portal.
2. **Texas Medical Center and Houston** — Rice seed funds and institutes, MD Anderson programs with
   an external-collaborator route, TMC Innovation and Health Policy, Gulf Coast Consortia,
   UTHealth and Methodist joint programs, Houston philanthropy that funds investigators.
3. **Quiet national funders** — small and mid-size foundations with a multi-year award record and
   little marketing.
4. **Industry investigator-initiated and data partners** — HER2/ADC/endocrine-therapy sponsors and
   the ctDNA/MRD and real-world-data companies whose research programs are rarely listed anywhere.
5. **Cooperative groups and consortia** — TBCRC, ECOG-ACRIN, SWOG/Hope, NRG, Alliance, I-SPY, and
   whether BCM is a member site where membership is by site.
6. **Physician-scientist career awards** — built for an MD with clinical duties at year 7+, including
   the NIH Loan Repayment Program.
7. **Federal-adjacent** — AIM-AHEAD, NIMHD, FDA real-world-evidence BAAs, Moonshot RFAs, PCORI cycles
   not yet held. Grants.gov is the source of truth for anything federal.

## Guardrails that apply to every job

- Primary sources only. A sponsor's own page, the announcement PDF, or Grants.gov. Never an
  aggregator, never a news article, never memory.
- Nothing enters `grants.json` without a fetched primary page and a second look.
- Nothing is deleted. Programs that stop are retired with a date and reason.
- The repository is public. Records are written in neutral third person ("the PI") and never
  carry personal career detail.
- `python tools/validate.py` must exit 0 before any commit. The push is the deploy.
- Every run reports in a few lines: what closes within 30 days, what moved (old → new), what is
  new, what was promoted. If nothing, it says so in two lines.
