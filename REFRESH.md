# Refresh procedure

Runs Mondays and Thursdays. Every step below exists because skipping it has a specific failure mode.
This is the definitive pass; the daily watcher and the weekly discovery sweep feed it. How the
three fit together is in [PIPELINE.md](PIPELINE.md).

## 1. Read current state

Load `data/grants.json`, `data/changelog.json`, `data/signals.json` (what the daily crawl
noticed) and `data/candidates.json` (what the discovery sweep found).

## 2. Decide what to re-verify

Priority order:

0. Every entry in `data/signals.json`. `dates_changed` means the sponsor page's set of dates
   moved since the last look — open the page and find out why. `rfp_changed` means an industry
   portal now says something new about a call for proposals; read the added passages, and if a
   time-limited RFP is open, record it as its own record (posted-cycle style) rather than
   editing the standing portal record. `coverage_gap` names a company on the pharma watchlist
   that no record cites — go and find out whether it runs an investigator-research programme
   now; if it does, add it, and if it plainly does not, add a record anyway with
   `confidence: "unverified"` and a note saying so, so the question is not reasked from scratch
   every month. `not_found` is a page returning 404 or 410; see step 4. `blocked` or `unreachable` means
   the script could not read the page — read it yourself. `new_federal_opportunity` is a
   Grants.gov number never seen before — one line of triage each, and record the relevant ones.
1. Anything with a `next_deadline` inside the next 60 days.
2. Anything `confidence: "projected"` or `"unverified"` whose `typical_month` has now arrived.
3. Anything whose `last_verified` is more than 60 days old.
4. **DOD CDMRP BCRP** every run. As of 2026-09-10 FY27 is still unappropriated (no FY27
   number on Grants.gov). The FY26 Breakthrough L1/L2 and Clinical Research Extension
   round-2 dates (LOI 2026-11-04, application 2026-11-18) are confirmed on the CDMRP page
   and Grants.gov. Check `cdmrp.health.mil/funding/bcrp` and Grants.gov.
5. **CPRIT** every run at `cprit.texas.gov/funding-opportunities`. FY27 Cycle 2
   academic-research RFAs accept applications 2026-09-16 to 2026-11-18 in the new grants
   management platform; recruitment RFAs close monthly on the 20th (next 2026-10-20). No
   IIRA cycle is posted; the FY2028 IIRA cycle is expected around January 2027 with an April
   deadline.

The dated items above are state, not scripture. When one resolves, rewrite it here.

## 3. Verify against primary sources only

The sponsor's own page, the program announcement PDF, or Grants.gov. Never an aggregator.
A landing page often does not carry dates; the announcement PDF usually does.

Some sponsors refuse plain fetches (CPRIT's landing page, Komen, PCORI return 403). Open those in
the in-app browser — `mcp__Claude_Browser__navigate`, then `get_page_text` — which renders the
JavaScript tables a fetch never sees. A refused fetch is not a reason to skip a record.

Sponsor quirks worth knowing before you conclude a page is empty:

- **Merck MISP** (`misp-investigator-studies.com/areas-of-interest`) forces a country selection
  before it renders anything. In the browser choose United States and continue, then open the
  Oncology therapeutic area; the compound and areas-of-interest list only appears after that. A
  plain fetch sees navigation labels and nothing else, so the crawler's RFP-line diff on this page
  detects new server-rendered text only; the list itself is a browser read.
- **Gilead** (`.../oncology-rfp-opportunities`) prints "No current opportunities" under both
  "RFP Programs" and "RFP Topics of Interest" when nothing is open. That sentence disappearing is
  the signal that an oncology RFP has been posted.
- **Pfizer Competitive Grants** lists calls in a paginated table on the page itself; the ISR page
  carries only areas of interest and an alert sign-up.

Set `last_verified` on every record you actually checked, whether or not it changed.

## 4. Detect programs that stopped

A program is retired when the sponsor says so, the grants page is gone with no successor, or
two consecutive cycles pass with no announcement. Do not delete it. Set:

```json
"status": "retired", "retired_on": "YYYY-MM-DD", "retired_reason": "one sentence"
```

A page that merely fails to load is **not** evidence a program stopped. Mark it
`confidence: "unverified"` and try again next run.

**Rolling industry portals need their own rule.** They have no cycle to miss, so "two consecutive
cycles with no announcement" can never fire. Retire one when its page has returned 404 or 410 on
three consecutive daily runs (the `not_found` signal carries the streak, and
`data/fingerprints.json` records it) *and* a search finds no successor page. A 403 is not a 404 —
blocked is not gone. Companies are acquired and programmes get folded into the acquirer's, so
before retiring, check the acquirer: Seagen's programme now sits inside Pfizer's, for example.

## 5. Look for new opportunities

Search Grants.gov, PCORI, AACR, Conquer Cancer/ASCO, Komen, METAVIVOR, Gateway, Rising Tide,
and the Mary Kay Ash Foundation for: breast cancer, HER2, endocrine resistance, ctDNA/MRD,
antibody-drug conjugates, real-world evidence in oncology, cancer health disparities.

A new record needs **every field an existing record has** — copy one and fill it in. `first_seen`
is today and `status` is `active`. A record missing `fit` renders a blank row rather than an
error, and a record whose `verdict` is not one of the four known values shows an "unknown"
eligibility pill, so neither mistake announces itself.

## 5b. Promote what discovery found

For each entry in `data/candidates.json`:

- `decision: "reject"` — leave it. Never promote, never delete; it stops the same find being
  re-surfaced.
- `decision: "promote"`, or `"pending"` with `verification.real`, `verification.active` and
  `verification.eligible_plausible` all true and `record.confidence` not `"unverified"` — open
  `record.url` yourself once more, then copy `record` into `grants.json` with `first_seen` set to
  today and `status: "active"`. Set the candidate's `decision` to `"promoted"` and add
  `promoted_on`. Count it in the changelog's `added`.
- anything else stays `"pending"` and is re-examined next pass.

Batch the re-verification: split records due for a check into groups and run one agent per group
against primary sources, returning a structured diff. Any date that moved is re-read by a second,
independent agent before it is written. While there, capture enrichment the sponsor posts —
awards made per cycle, success rate, program contact, a recent relevant awardee — into `notes`
or the optional fields `awards_per_cycle`, `success_rate`, `program_contact`.

## 6. Keep derived fields in step

When a date moves, two derived values go stale and nothing recomputes them:

- `deadline_status` — must still describe the new dates.
- `fit` — its deadline-proximity term changes when `next_deadline` changes. Re-score the record.

`next_deadline` is the earlier of `loi_deadline` and `full_deadline` **that is still in the
future**. Set it to `null` when both have passed and no new cycle is posted; the site renders
that as "not posted", which is correct. Do not leave a lapsed date in `next_deadline`.

## 7. Update the two top-level fields

Before committing, in `data/grants.json`:

- Set `generated` to today's date. Do this **on every run, even one where nothing changed** — it
  is the only source of the "Data refreshed" date in the site header, so leaving it stale makes a
  freshness-focused site advertise a stale date.
- Set `count` to the exact length of the `grants` array.

CI asserts `count == len(grants)` and fails the deploy before the Pages steps run if they
disagree. This is the single most likely way to break the site.

The site header and footer read their totals from the data, so they need no edit. `README.md`
states the record count in prose, though — update it there when the count changes.

## 8. Record the change

**Prepend** one entry to the `entries` array in `data/changelog.json` — newest first. The site
renders `entries[0]` as "Last update" and shows only the first fourteen, so appending would pin
the site to the original build date forever.

```json
{ "entries": [
  { "date":"YYYY-MM-DD", "kind":"refresh", "summary":"one sentence",
    "added":0, "changed":0, "retired":0,
    "details":["specific change, old value to new value"] },
  ...
] }
```

State old and new values for any date that moved, so `git log` is readable on its own.

## 9. Commit and push

```bash
git add -A
git commit -m "refresh YYYY-MM-DD: +N added, N changed, N retired"
git push
```

**The push is the deploy.** The Pages workflow triggers on push to `main`; a commit that is never
pushed changes nothing that anyone can see.

## 10. Report

Anything closing within 30 days. Any date that changed, old and new. Anything newly posted.
Anything previously projected that is now confirmed. If nothing changed and nothing closes
within 30 days, say exactly that in two lines.

---

## Open reconciliation task

Five mechanisms are entered twice. Each pair is the same award captured at two levels — one
record describes the standing program, the other a specific posted cycle — and the two carry
different analysis, so neither is safely deletable without reading both.

| Standing-program record | Posted-cycle record |
|---|---|
| `susan-g-komen-career-catalyst-research-grants` | `komen-career-catalyst-research-fy27` |
| `bcrf-aacr-career-development-award` | `bcrf-aacr-career-development-awards` |
| `bcrf-lbca-aacr-cda-lobular` | `bcrf-lbca-aacr-cda` |
| `aacr-hope-scarves-mbc-innovation-discovery` | `aacr-hope-scarves-mbc-innovation-discovery-grant` |
| `aacr-lbca-ilc-innovation-discovery` | `aacr-lbca-ilc-innovation-discovery-grants` |

The Komen pair is the one that matters most: `komen-career-catalyst-research-fy27` is
`track-gated` on tenure-track and carries the 2026-10-05 date, while
`susan-g-komen-career-catalyst-research-grants` is `needs-check` with no date. Setting the track
toggle to non-tenure hides the dated record and leaves the undated one visible, so the same
$450,000 award reads as having no deadline.

Decide per pair: merge into one record keeping both sets of notes, or keep both and make the
relationship explicit in `notes`. Then update `count` per step 7.

## Open scoring question

`nih-standard-due-dates-reference` is a calendar of NIH standard due dates, not a fundable
mechanism, but it carries `verdict: "eligible"` and `fit: 91`, which ranks it above most real
opportunities under the default best-fit sort. It is genuinely useful as a reference, so it
should not simply be deleted. Either drop its `fit` so it stops competing for the top of the
table, or give reference rows a category of their own. Left as-is pending that call.
