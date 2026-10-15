# Routine

The whole pipeline is one scheduled run. Every other day at about 2 AM Central a fresh Claude
Code cloud session clones GitLab `main`, crawls, discovers, refreshes, validates, commits once and
pushes. The push is the deploy: Cloudflare Pages rebuilds https://breast-cancer-grants.pages.dev/
from GitLab `main` within minutes. This file is the order of operations, complete enough to run
from top to bottom. Why each step works the way it does is in [PIPELINE.md](PIPELINE.md); step 3
is [REFRESH.md](REFRESH.md).

It replaces three jobs that ran in the Claude desktop app on the owner's PC:
`bc-grants-daily-watch` (daily), `bc-grants-refresh` (Mon/Thu) and `bc-grants-discovery` (Wed).
They are retired. If one still exists in the desktop app, delete it there, or two writers will race
for `main`.

## The scheduled task

- **Where:** Claude Code on the web, a fresh session on every firing, about 02:00
  America/Chicago, every other day. A `*/2` day-of-month schedule fires on the 31st and again on
  the 1st; that is harmless (see Cadence).
- **Network:** the open web — sponsor pages, Grants.gov, WebSearch. A trusted-hosts allowlist is
  not enough; sponsors live on a hundred domains.
- **GitLab write access:** `GITLAB_TOKEN`, a personal access token with `write_repository`, as an
  environment variable. Or a network secret for gitlab.com, in which case `GITLAB_TOKEN` is empty
  and the proxy authenticates plain `https://gitlab.com/...` requests.
- **Browser:** headless Chromium is preinstalled (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`,
  chromium-1194). Never run `playwright install`.
- **The session's own checkout** may be a stale GitHub copy. It is never read, edited or pushed,
  and it may not contain this file, so the task's prompt carries the clone itself:

> Breast cancer grants routine. Ignore the repository checked out in this session: it may be a
> stale GitHub copy, and nothing is ever pushed to GitHub. Run step 0a of ROUTINE.md, quoted
> below, then read /tmp/bc-grants/ROUTINE.md and follow it from step 0b through step 6. End with
> the step 6 report.
>
> (paste the step 0a block here)

## Ground rules

- **Where things live.** The clone is `/tmp/bc-grants`; scratch files go in `/tmp/bc-grants-run`.
  Nothing is written inside the clone except the files the steps name: `tools/validate.py` refuses
  to publish while any untracked file is present.
- **Shell state does not persist between Bash calls.** Start every command with the prelude
  `cd /tmp/bc-grants && export TZ=America/Chicago TODAY=$(TZ=America/Chicago date +%F)`, so
  watch.py, validate.py, the scripts below and the commit all agree on the owner's date.
- **Secrets.** Never print `GITLAB_TOKEN`, `.git/config` or a remote URL. Step 0a keeps the token
  out of `.git/config` altogether: git asks a credential helper, which reads the environment only
  when GitLab asks for a password.
- **Data files** are written the way every past run wrote them:
  `json.dump(obj, fh, indent=1, ensure_ascii=False)`, no trailing newline. Anything else rewrites
  the whole file in the diff and buries the real change.
- **Reading pages.** WebFetch can fail in this container (DNS). Fall back in this order:
  `curl -sSL --max-time 30 <url>`; then `python3 tools/read_page.py <url>` — headless Chromium,
  which renders JavaScript tables and is not refused by CPRIT's landing page, Komen or PCORI
  (`--links` lists the page's links, for the announcement one level down). A PDF:
  `curl -sSL -o /tmp/bc-grants-run/doc.pdf <url> && pdftotext /tmp/bc-grants-run/doc.pdf -`.
  The workflow agents are told the same. The sponsor quirks in REFRESH.md step 3 apply:
  - Merck MISP shows nothing until a country is chosen. Read the gate's labels first, then
    `python3 tools/read_page.py https://misp-investigator-studies.com/areas-of-interest --click "United States" --click "<its confirm button>" --click "Oncology"`.
  - Gilead's oncology RFP page saying "No current opportunities" under both headings means nothing
    is open. That sentence disappearing is the signal.
- **A page that failed to load changes nothing.** Not its dates, not its status, not its
  retirement. If WebFetch, curl and read_page.py all fail, the record waits for the next run, and
  the only mark it may get is the one REFRESH.md step 4 allows.
- **Primary sources only**, as everywhere in this repository.

## Cadence

Runs are every other day, not daily, and nothing in `tools/watch.py` assumes a day. It diffs each
page against the state the previous run committed, whenever that was, so a skipped or doubled
night costs nothing; its 75-day watch horizon and 30-day coverage-gap interval are measured in
days and are unaffected. Two consequences:

- `data/fingerprints.json` is the crawler's only memory, and a fresh session's only state is git.
  So it is committed on every run. The desktop jobs kept it in a local clone between commits.
- A fail streak counts runs. REFRESH.md's rule of three consecutive 404s now spans about five days.

## 0. Preflight

Nothing is changed until all of this passes.

### 0a. Clone GitLab main

```bash
rm -rf /tmp/bc-grants /tmp/bc-grants-run && mkdir -p /tmp/bc-grants-run
REPO=https://gitlab.com/a.elkhanany/breast-cancer-grants.git
if [ -n "$GITLAB_TOKEN" ]; then
  # oauth2:$GITLAB_TOKEN, handed over by a helper so the token is never written to disk
  HELPER='!f() { test "$1" = get || return 0; echo username=oauth2; echo "password=$GITLAB_TOKEN"; }; f'
  git -c "credential.https://gitlab.com.helper=$HELPER" clone --branch main "$REPO" /tmp/bc-grants &&
    git -C /tmp/bc-grants config "credential.https://gitlab.com.helper" "$HELPER"
else
  git clone --branch main "$REPO" /tmp/bc-grants   # the proxy's network secret authenticates it
fi
```

### 0b. Identity and write access

```bash
cd /tmp/bc-grants && export TZ=America/Chicago TODAY=$(TZ=America/Chicago date +%F)
git config user.name "Elkhanany" && git config user.email "Elkhanany@users.noreply.github.com"
git status -sb | head -1                 # expect: ## main...origin/main
git push --dry-run origin HEAD:main      # expect: Everything up-to-date
```

The identity is the one every past data commit carries, so `git log` reads as one history.

### 0c. The open web

```bash
cd /tmp/bc-grants && export TZ=America/Chicago TODAY=$(TZ=America/Chicago date +%F)
curl -sS -o /dev/null -w 'grants.nih.gov %{http_code}\n' --max-time 30 https://grants.nih.gov/
curl -sS -o /dev/null -w 'api.grants.gov %{http_code}\n' --max-time 30 -X POST \
  -H 'Content-Type: application/json' -d '{"keyword":"breast cancer","rows":1}' \
  https://api.grants.gov/v1/api/search2
python3 tools/read_page.py https://grants.nih.gov/ > /tmp/bc-grants-run/nih.txt  # installs playwright once
echo "read_page exit $?"; head -5 /tmp/bc-grants-run/nih.txt
```

Both curls must print a status the site itself sent (200, or any 3xx/4xx). `000`, or `CONNECT
tunnel failed, response 403`, means the session's network policy blocks the host. The read_page.py
line is not fatal: if the browser path fails, the run continues on WebFetch and curl, and the
report says so.

### If preflight fails

Change nothing, commit nothing, and report exactly what is missing in two or three lines, then
stop:

- GitLab answers 401 or 403, `HTTP Basic: Access denied`, or `Authentication failed` on the clone
  or the dry run: `GITLAB_TOKEN` is unset, expired or lacks `write_repository`, or the gitlab.com
  network secret is missing.
- `You are not allowed to push code`: the token's user cannot push to `main`.
- `CONNECT tunnel failed, response 403` for gitlab.com or either web check: the environment's
  network access does not reach that host. It needs the open web.

## 1. Crawl

```bash
cd /tmp/bc-grants && export TZ=America/Chicago TODAY=$(TZ=America/Chicago date +%F)
python3 tools/watch.py
```

Then the model step, exactly as PIPELINE.md §1 describes it, reading `data/signals.json`:

- `dates_changed` and `document_changed`: open the page and decide whether a posted deadline
  actually moved. If the new deadline is stated plainly on the primary page, apply it to
  `data/grants.json`: the dates, `next_deadline`, `deadline_status`, `confidence`,
  `last_verified`, and a re-scored `fit`. Note old → new for the changelog. A page's own date
  stamp, a press-release date and a date ageing out of the crawler's window are not moves; past
  runs met all three.
- Anything ambiguous, and every `blocked`, `unreachable`, `not_found`, `now_readable`,
  `rfp_changed` and `coverage_gap`: leave it for step 3.
- `new_federal_opportunity`: one line of triage each. Relevant: step 3 records it. Irrelevant:
  ignore it; `fingerprints.json` already holds the number, so it is never reported twice.

Keep the ids whose signals this step settled completely, applied or dismissed as boilerplate.
Step 3 does not send them to the fan-out again. Nothing is committed yet; every step's changes go into step 5's one
commit.

## 2. Discover

Run `tools/discovery.workflow.js` with the Workflow tool, passing `args` as a JSON object:

```
scriptPath: /tmp/bc-grants/tools/discovery.workflow.js
args:       {"today": "<TODAY>", "root": "/tmp/bc-grants"}
```

Write the object it returns, unchanged, to `/tmp/bc-grants-run/discovery.json`. If the tool result
says it was saved to a file, copy the JSON from that file rather than retyping it. Then merge:

```bash
cd /tmp/bc-grants && export TZ=America/Chicago TODAY=$(TZ=America/Chicago date +%F)
python3 - /tmp/bc-grants-run/discovery.json <<'EOF'
import json, os, re, sys
from datetime import date

RUN = os.environ.get("RUN", "/tmp/bc-grants-run")
res = json.load(open(sys.argv[1], encoding="utf-8"))
today = res.get("today") or date.today().isoformat()
G = json.load(open("data/grants.json", encoding="utf-8"))
C = json.load(open("data/candidates.json", encoding="utf-8"))
held, cands = G["grants"], C["candidates"]

def norm(s):  # the workflow's own normaliser
    s = re.sub(r"https?://(www\.)?", "", (s or "").lower(), count=1)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()

held_ids = {g["id"] for g in held}
held_key = {}  # url and sponsor+program; not watch_urls, where a new call is its own record
for g in held:
    for k in (norm(g.get("url")), norm(g["sponsor"] + " " + g["program"])):
        if k:
            held_key.setdefault(k, g["id"])
cand_key = {}
for c in cands:
    r = c.get("record") or {}
    for k in (norm(r.get("url")), norm((r.get("sponsor") or "") + " " + (r.get("program") or ""))):
        if k:
            cand_key.setdefault(k, f'{c["id"]} ({c["decision"]})')
taken = held_ids | {c["id"] for c in cands}

def slug(sponsor, program):
    words = []
    for w in re.sub(r"\([^)]*\)", " ", f"{sponsor} {program}").lower().replace("&", " and ").split():
        w = re.sub(r"[^a-z0-9]+", "-", w).strip("-")
        if w and w not in ("the", "a", "an", "of", "for", "and", "to", "in", "on", "with") and w not in words:
            words.append(w)
    base = ""
    for w in words:  # whole words, at most 60 characters
        if base and len(base) + 1 + len(w) > 60:
            break
        base = f"{base}-{w}" if base else w
    out, i = base, 2
    while out in taken:
        out, i = f"{base}-{i}", i + 1
    taken.add(out)
    return out

added, enrich, skipped = [], [], []
for x in res.get("candidates") or []:
    c, v = x["candidate"], x["v"]
    name = f'{c["sponsor"]}: {c["program"]}'
    if not v.get("real"):
        skipped.append(f"not real: {name}"); continue
    dup = v.get("duplicate_of_held_id") or c.get("overlaps_existing_id") or ""
    hit = dup if dup in held_ids else held_key.get(norm(c["url"])) or held_key.get(norm(c["sponsor"] + " " + c["program"]))
    if hit:  # new information about a held record: step 3 re-reads it
        enrich.append({"held_id": hit, "lens": x["lens"], "url": c["url"], "evidence": v.get("evidence", "")})
        continue
    rep = cand_key.get(norm(c["url"])) or cand_key.get(norm(c["sponsor"] + " " + c["program"]))
    if rep:  # never resurrect a reject, never re-add a promotion
        skipped.append(f"repeat of candidate {rep}: {name}"); continue
    cid = slug(c["sponsor"], c["program"])
    fit = v["fit"] if isinstance(v.get("fit"), (int, float)) else 0
    rec = {"id": cid, "sponsor": c["sponsor"], "sponsor_full": c["sponsor_full"], "program": c["program"],
           "url": c["url"], "status": "active", "first_seen": today, "last_verified": today,
           "retired_on": None, "retired_reason": None, "category": c["category"], "tier": c["tier"]}
    for k in ("focus", "breast_specific", "er_her2_fit", "award_usd", "award_text", "duration_years", "indirects",
              "loi_deadline", "full_deadline", "next_deadline", "deadline_status", "cycle", "typical_month",
              "verdict", "flags", "track_gate", "career_cap", "limited_submission", "eligibility", "notes",
              "confidence", "evidence"):
        rec[k] = v.get(k)
    rec["fit"] = max(0, min(140, fit))
    cands.append({"id": cid, "decision": "pending", "provides": c["provides"],
                  "provenance": {"lens": x["lens"], "found_on": today, "run": "discovery",
                                 "finder_summary": c["why_relevant"], "proven": c["proven"]},
                  "verification": {"real": v["real"], "active": v["active"],
                                   "eligible_plausible": v["eligible_plausible"], "duplicate_of": None,
                                   "reason": v["reason"]},
                  "record": rec})
    cand_key[norm(c["url"])] = cand_key[norm(c["sponsor"] + " " + c["program"])] = f"{cid} (pending)"
    added.append(cid)

C["generated"] = today
with open("data/candidates.json", "w", encoding="utf-8") as fh:
    json.dump(C, fh, indent=1, ensure_ascii=False)
with open(f"{RUN}/enrich.json", "w", encoding="utf-8") as fh:
    json.dump(enrich, fh, indent=1, ensure_ascii=False)
print(f"+{len(added)} candidates:", ", ".join(added) or "none")
print(f"{len(enrich)} enrichments for held records (step 3 re-reads them):",
      ", ".join(sorted({e['held_id'] for e in enrich})) or "none")
for s in skipped:
    print("skipped", s)
EOF
```

The merge follows every discovery commit so far:

- **Shape.** Each find becomes `{id, decision: "pending", provides, provenance: {lens, found_on,
  run: "discovery", finder_summary, proven}, verification: {real, active, eligible_plausible,
  duplicate_of: null, reason}, record}`. `record` is a complete grant-shaped record in
  `grants.json`'s field order, with `status: "active"` and `first_seen` and `last_verified` set to
  today. The finder supplies sponsor, sponsor_full, program, url, category, tier, provides,
  `finder_summary` (its `why_relevant`) and `proven`. The verifier supplies everything else,
  `evidence` and `reason` included. `fit` is clamped to 0–140.
- **Not added.** A find the verifier calls not real. A find tied to a held record, by
  `duplicate_of_held_id`, by `overlaps_existing_id`, or by a URL or sponsor-and-program match with
  `grants.json`: that is an enrichment, written to `/tmp/bc-grants-run/enrich.json` for step 3 to
  re-read. A repeat of any existing candidate, by URL or sponsor and program, whatever its
  decision: a `"reject"` is never resurrected and a `"promoted"` never re-added.
- **Kept as pending** even when `active` or `eligible_plausible` is false, as before. The site
  shows them as awaiting promotion, and step 3 promotes only what passes.
- **Ids** are a slug of sponsor and program, at most 60 characters, unique across both files.
  Rename one that reads badly before the commit; nothing else refers to it yet.
- **Placement.** Appended at the end, with `candidates.json`'s `generated` set to today.

If the workflow fails or returns nothing, skip the merge, say so in the report and go on to step 3.

## 3. Refresh

Follow [REFRESH.md](REFRESH.md) steps 1 to 8, with these specifics.

**Due list.** Step 2 of REFRESH.md, built by code. Pass the ids step 1 settled as one
comma-separated argument; the discovery enrichments are read from `/tmp/bc-grants-run/enrich.json`.

```bash
cd /tmp/bc-grants && export TZ=America/Chicago TODAY=$(TZ=America/Chicago date +%F)
python3 - "<ids settled in step 1, comma-separated, or empty>" <<'EOF'
import json, os, sys
from datetime import date, timedelta

RUN = os.environ.get("RUN", "/tmp/bc-grants-run")
today = date.fromisoformat(os.environ.get("TODAY") or date.today().isoformat())
resolved = set(filter(None, (sys.argv[1] if len(sys.argv) > 1 else "").split(",")))
grants = json.load(open("data/grants.json", encoding="utf-8"))["grants"]
signals = json.load(open("data/signals.json", encoding="utf-8"))["signals"]
try:
    enrich = json.load(open(f"{RUN}/enrich.json", encoding="utf-8"))
except FileNotFoundError:
    enrich = []
iso = lambda d: d.isoformat()
months = ["january", "february", "march", "april", "may", "june", "july", "august", "september",
          "october", "november", "december"]
this_m, last_m = months[today.month - 1], months[today.month - 2]
why = {}
for s in signals:                       # item 0: every signal step 1 did not settle
    for i in s.get("ids") or []:
        if i not in resolved:
            why.setdefault(i, []).append(s["kind"])
for e in enrich:                        # new information discovery found about a held record
    why.setdefault(e["held_id"], []).append("discovery")
for g in grants:
    if g.get("status") != "active":
        continue
    nd, lv = g.get("next_deadline"), g.get("last_verified") or "0000-00-00"
    r = []
    # A date that has passed: watch.py stops reading the page once next_deadline is behind
    # today, so no signal will ever bring the record back, and REFRESH.md step 6 forbids leaving it.
    lapsed = bool(nd) and nd < iso(today)
    if lapsed:
        r.append("lapsed")                                                    # item 1
    if nd and iso(today) <= nd <= iso(today + timedelta(days=60)):
        r.append("deadline<60d")                                              # item 1
    tm = (g.get("typical_month") or "").lower()
    if g.get("confidence") in ("projected", "unverified") and (this_m in tm or last_m in tm):
        r.append("typical-month")                                             # item 2
    if lv < iso(today - timedelta(days=60)):
        r.append("stale>60d")                                                 # item 3
    if g.get("sponsor") in ("DOD CDMRP BCRP", "CPRIT"):
        r.append(g["sponsor"])                                                # items 4-5
    # Read on the previous run and nowhere near its deadline: nothing has had time to change,
    # and the crawler still reads its page every run. A lapsed record is never fresh: it stays
    # due on every run until its date is rolled forward or cleared.
    fresh = (not lapsed and lv > iso(today - timedelta(days=3))
             and not (nd and iso(today) <= nd <= iso(today + timedelta(days=14))))
    if r and not fresh:
        why.setdefault(g["id"], []).extend(r)
FIELDS = ("id", "sponsor", "program", "url", "loi_deadline", "full_deadline", "next_deadline",
          "deadline_status", "confidence", "status")
by_id = {g["id"]: g for g in grants}
due = sorted(({k: by_id[i].get(k) for k in FIELDS} for i in why if by_id.get(i, {}).get("status") == "active"),
             key=lambda d: (d["url"], d["id"]))   # records sharing a page land in the same batch
with open(f"{RUN}/due.json", "w", encoding="utf-8") as fh:
    json.dump(due, fh, ensure_ascii=False, separators=(",", ":"))
counts = {}
for i in why:
    for k in set(why[i]):
        counts[k] = counts.get(k, 0) + 1
print(f"{len(due)} records due:", counts)
print("not in grants.json (ignored):", sorted(i for i in why if i not in by_id) or "none")
EOF
```

**Fan-out.** Run `tools/refresh.workflow.js` with the Workflow tool, passing the contents of
`/tmp/bc-grants-run/due.json` as the `due` array itself, not as a string. Skip the call when the
list is empty.

```
scriptPath: /tmp/bc-grants/tools/refresh.workflow.js
args:       {"today": "<TODAY>", "due": [ ...due.json... ], "root": "/tmp/bc-grants"}
```

**Apply** what it returns, as REFRESH.md says:

- `confirmed`: two independent reads agree; write the dates, `next_deadline`, `deadline_status`,
  `confidence`, `last_verified`, a re-scored `fit`, and the retirement fields if retired.
- `disputed` and `unconfirmed`: write nothing; report each, both readings side by side.
- `unchanged` (posted dates as held): set `last_verified` to today and apply what else the reader
  established — `deadline_status`, `confidence`, a changed `award_text` or eligibility, a lapsed
  `next_deadline` cleared per REFRESH.md step 6 — plus the enrichment the sponsor posts
  (`awards_per_cycle`, `success_rate`, `program_contact`, `notes_addendum`) where it is new.
- `unreachable`: read it yourself once, curl then read_page.py. If that fails too, it changes
  nothing but what REFRESH.md step 4 allows.
- `failed`: those batches' records wait for the next run.

**Signals the fan-out cannot settle.** `coverage_gap`, `new_federal_opportunity` and the passages
an `rfp_changed` signal added are for you, not the fan-out; handle them as REFRESH.md step 2
item 0 says. A time-limited RFP becomes its own posted-cycle record.

**New opportunities.** REFRESH.md step 5's search is what step 2 just did. Skip it.

**Promotion.** REFRESH.md step 5b, for candidates whose `provenance.found_on` is before today
only. A find spends at least one run on the site under "Newly surfaced", so the owner can set
`"reject"` before it enters the curated set. The desktop pipeline gave the same window between
Wednesday's sweep and Thursday's refresh.

**Top-level fields and changelog.** REFRESH.md steps 7 and 8. `generated` is today and `count`
is exact on every run, with README.md's count updated when it moves. Prepend one changelog entry
for the whole run, `"kind": "update"`, covering step 1's date moves and this step's changes. Write
it even when nothing changed: "N records re-verified; no deadline moved."

## 4. Validate

```bash
cd /tmp/bc-grants && export TZ=America/Chicago TODAY=$(TZ=America/Chicago date +%F)
python3 tools/validate.py && node --check app.js
```

Both must exit 0. This is the command Cloudflare's build runs, so a run that passes here deploys.
Fix the data, never the validator.

Warnings do not block the build, but one blocks this commit. `next_deadline ... has passed` means
a record missed REFRESH.md step 6: the due list sent it to the fan-out and nothing rolled it
forward. Resolve each one before committing. If a read this run confirmed the next posted cycle,
write it. Otherwise set `next_deadline` to whichever of the record's own `loi_deadline` and
`full_deadline` is still in the future, or `null`. Then keep `deadline_status` in step (an `open`
whose dates have all passed becomes `closed-projected`, as the 2026-10-08 refresh did) and
re-score `fit`. That needs no page: it derives from dates the record already holds, so it is the
one edit a record whose page failed to load still gets. Name each one in the changelog
("lapsed; no new cycle confirmed"). Other warnings go in the report.

## 5. Commit and push

```bash
cd /tmp/bc-grants && export TZ=America/Chicago TODAY=$(TZ=America/Chicago date +%F)
git status --short     # data/*.json, and README.md when the count moved; nothing else
git add -A
git commit -m "update $TODAY: +N added, N changed, N retired, +N candidates"
git push origin HEAD:main
```

- **Counts.** `added`: records new in `grants.json`, promotions and records recorded from
  signals. `changed`: records whose content changed; a `last_verified` bump alone is not a change.
  `retired`. `candidates`: entries step 2 appended. End the message with the attribution trailer
  the session's instructions give, as past data commits do.
- **Commit every run,** even when only `fingerprints.json`, `signals.json` and `generated` moved.
  The crawler's memory lives in git.
- **Rejected because `main` moved:** `git pull --rebase origin main`, run step 4 again, push once
  more. If the rebase conflicts, `git rebase --abort` and report it: nothing is deployed, and the
  next run does the work again from a fresh clone. Never force-push. Never push anywhere but
  GitLab `main`.
- **The push is the deploy.** Cloudflare Pages builds GitLab `main` on every push with
  `python3 tools/validate.py && node --check app.js` and publishes
  https://breast-cancer-grants.pages.dev/ within minutes. A failed build publishes nothing, and the
  site stays on the previous deploy.

## 6. Report

The session's last message, in a few lines, as PIPELINE.md's guardrails require:

- What closes within 30 days, soonest first.
- What moved, old → new.
- What is new: records recorded from signals, and candidates added (by lens).
- What was promoted.
- Then only if any: disputed readings, pages nothing could read, enrichments queued, coverage
  gaps, steps that failed or were skipped, and whether the browser path worked.
- The commit's short hash and "pushed to GitLab main", or why nothing was pushed.

If nothing changed and nothing closes within 30 days, say exactly that in two lines.

```bash
cd /tmp/bc-grants && export TZ=America/Chicago TODAY=$(TZ=America/Chicago date +%F)
python3 - <<'EOF'
import json, os
from datetime import date, timedelta
today = date.fromisoformat(os.environ["TODAY"])
end = (today + timedelta(days=30)).isoformat()
grants = json.load(open("data/grants.json", encoding="utf-8"))["grants"]
for g in sorted(grants, key=lambda g: g.get("next_deadline") or ""):
    nd = g.get("next_deadline")
    if g["status"] == "active" and nd and today.isoformat() <= nd <= end:
        print(nd, f"({(date.fromisoformat(nd) - today).days} days)", g["id"])
EOF
```

## When a step fails midway

- **Never commit anything that fails step 4.** If the data cannot be fixed, discard the edits that
  broke it (`git checkout -- data/grants.json data/changelog.json README.md`), validate what is
  left, and commit that.
- **Step 2 fails:** no candidates this run. Go on.
- **Step 3 does not finish, or the Workflow tool is unavailable:** first restore the crawler's
  memory, `git checkout -- data/fingerprints.json data/signals.json`, so the next run raises the
  same signals again. A signal raised twice costs one look; a signal lost is a deadline nobody
  reads. Step 1's date moves and step 2's candidates are still worth keeping if they validate:
  commit them with "(refresh incomplete)" at the end of the subject line, and report what failed.
  Never try to do the fan-out by hand; it is a configuration problem to fix, not to work around.
- **Nothing worth keeping is left:** commit nothing, and report why.
