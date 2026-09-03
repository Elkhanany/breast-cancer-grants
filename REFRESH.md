# Refresh procedure

Runs Mondays and Thursdays. Every step below exists because skipping it has a specific failure mode.

## 1. Read current state

Load `data/grants.json` and `data/changelog.json`.

## 2. Decide what to re-verify

Priority order:

1. Anything with a `next_deadline` inside the next 60 days.
2. Anything `confidence: "projected"` or `"unverified"` whose `typical_month` has now arrived.
3. Anything whose `last_verified` is more than 60 days old.
4. **DOD CDMRP BCRP** every run. As of 2026-09-03 FY27 was unappropriated, and the FY26
   Breakthrough L1/L2 and Clinical Research Extension announcements
   (`HT942526BCRPBTA122`, `HT942526BCRPCREA2`) had unconfirmed dates.
   Check `cdmrp.health.mil/funding/bcrp` and Grants.gov.
5. **CPRIT** every run at `cprit.texas.gov/funding-opportunities`. The FY2028 IIRA cycle is
   expected around January 2027 with an April deadline.

The dated items above are state, not scripture. When one resolves, rewrite it here.

## 3. Verify against primary sources only

The sponsor's own page, the program announcement PDF, or Grants.gov. Never an aggregator.
A landing page often does not carry dates; the announcement PDF usually does.

Set `last_verified` on every record you actually checked, whether or not it changed.

## 4. Detect programs that stopped

A program is retired when the sponsor says so, the grants page is gone with no successor, or
two consecutive cycles pass with no announcement. Do not delete it. Set:

```json
"status": "retired", "retired_on": "YYYY-MM-DD", "retired_reason": "one sentence"
```

A page that merely fails to load is **not** evidence a program stopped. Mark it
`confidence: "unverified"` and try again next run.

## 5. Look for new opportunities

Search Grants.gov, PCORI, AACR, Conquer Cancer/ASCO, Komen, METAVIVOR, Gateway, Rising Tide,
and the Mary Kay Ash Foundation for: breast cancer, HER2, endocrine resistance, ctDNA/MRD,
antibody-drug conjugates, real-world evidence in oncology, cancer health disparities.

A new record needs **every field an existing record has** — copy one and fill it in. `first_seen`
is today and `status` is `active`. A record missing `fit` renders a blank row rather than an
error, and a record whose `verdict` is not one of the four known values shows an "unknown"
eligibility pill, so neither mistake announces itself.

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
