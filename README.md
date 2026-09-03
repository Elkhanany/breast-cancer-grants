# Breast Cancer Grant Runway

A continuously refreshed database of funding for breast cancer translational and clinical
research, weighted toward ER+/HER2+ disease, computational and real-world-data work, and
investigator-initiated trials.

**→ [elkhanany.github.io/breast-cancer-grants](https://elkhanany.github.io/breast-cancer-grants/)**

228 mechanisms across six funder buckets: government, state, institutional, foundation,
trial funding, and professional organizations.

## Why this exists

Grant deadlines move, programs quietly stop, and new calls post off-cycle. A static list of
deadlines is wrong within weeks. This repository is refreshed on a schedule and every change is
committed, so the git history is the audit trail:

```bash
git log -p --follow data/grants.json      # every deadline that ever moved
git log --oneline data/changelog.json     # a readable summary of each refresh
```

## Using the site

Search covers sponsor, program, eligibility, notes, source URL, award text, and announcement
numbers — `HT942526BCRPBTA122` finds the DOD record directly. Everything else is a filter:

| Control | What it does |
|---|---|
| **Urgency tiles** | Filter to a deadline band. The tiles always sum to the visible set. |
| **Timeline** | Click any dot to filter to that month. |
| **Bucket / angle chips** | Counts are faceted — they show what you would get, given your other filters. |
| **BCM track** | Resolves the 20 track-gated awards in both directions. Stored in your browser only. |
| **Column headers** | Click or press Enter to sort. The sort menu stays in step. |

Every active filter appears as a removable token above the table, so an empty result always
explains itself. Rows expand for eligibility, source line, and the sponsor link.

## How it updates

Refreshed **Mondays and Thursdays**. The research step is not automated scraping. Each refresh
re-reads the sponsor's own page, program announcement PDF, or Grants.gov, because judging
whether a deadline moved or a program ended is not something a scraper can do reliably.

Programs that stop are marked `"status": "retired"` with a date and reason. They are never
deleted, so a discontinued mechanism is not researched again from scratch.

See [REFRESH.md](REFRESH.md) for the exact procedure each refresh follows.

## Data

`data/grants.json` — one object per mechanism under `grants`, plus top-level `generated` and
`count`, which every refresh must update.

| Field | Meaning |
|---|---|
| `status` | `active` or `retired` |
| `first_seen` / `last_verified` | when the mechanism entered the set, and when its terms were last confirmed |
| `retired_on` / `retired_reason` | set when a program stops |
| `loi_deadline` / `full_deadline` | the two dates as posted; either may be null |
| `next_deadline` | the next actionable date, LOI or full application, whichever comes first. `null` means nothing is currently posted — the majority case |
| `confidence` | `verified` (read on a primary source), `projected` (inferred from the prior cycle), `unverified` (page unreachable) |
| `verdict` | eligibility screen: `eligible`, `needs-check`, `track-gated`, `ruled-out` |
| `track_gate` | why an award is track-gated; the site keys on `requires tenure-track` / `requires NON-tenure-track` |
| `flags` | the specific disqualifying or cautionary criterion |
| `category` | funder bucket, drives the chips |
| `tier` | `early-career`, `mid-size`, `program-large` |
| `focus` | research-angle tags; four are filterable as chips |
| `er_her2_fit` | `high` / `medium` / `low` disease relevance |
| `fit` | composite score, 0–140: disease relevance, research-angle overlap, award size, deadline proximity, eligibility |

**Always open the `url` before committing effort.** `confidence` records how the date was
obtained, not a guarantee that it still holds.

## Running locally

The page fetches its data over http, so opening `index.html` from disk will not work. Serve the
repository root:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>. On Windows use `py -m http.server 8000` if `python` is not on
your PATH.

## Caveats

- Federal timing is unusually unstable right now. FY27 DOD BCRP is not appropriated. NCI no
  longer publishes paylines. NIH stopped posting notices to the NIH Guide in FY2026, so
  Grants.gov is the single official source.
- Records marked `unverified` are usually behind an institutional login. The mechanism is real;
  the timing is not established.
- Five mechanisms are currently entered twice, once as a standing program and once as a specific
  posted cycle. They carry different analysis rather than being straight duplicates. See the
  reconciliation note in [REFRESH.md](REFRESH.md).

## Your eligibility profile is private

The appointment-track toggle is stored in your browser's `localStorage` under `bcgr.profile.v1`
and is never committed. The data in this repository is public funding information only.
