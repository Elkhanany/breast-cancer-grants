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
- **Permissions:** nobody is awake at 2 AM to approve a prompt. The task's permission mode must let
  Bash, Write and Edit work in `/tmp/bc-grants` and `/tmp/bc-grants-run`, which are outside the
  session's own checkout, without asking. It must also let the Workflow tool's agents run Bash:
  their fallback to curl and read_page.py depends on it. Fire the task once by hand and read its
  report before trusting the schedule. A run that stalls on a prompt, or whose report lists every
  403 sponsor as unreadable, has a permission problem, not a data problem.
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
  `cd /tmp/bc-grants || exit 1; export TZ=America/Chicago TODAY=$(TZ=America/Chicago date +%F)`, so
  watch.py, validate.py, the scripts below and the commit all agree on the owner's date. The
  `|| exit 1` matters: if the clone is gone (a recycled container), the rest of the block would
  otherwise run in the session's own GitHub checkout, and `git checkout`, `commit` or `push` there
  would touch GitHub. A block that exits there means: run step 0a again, then resume.
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
  retirement, not its `confidence`. If WebFetch, curl and read_page.py all fail, the record waits
  for the next run and the page goes in the report. A datacenter IP is refused more often than the
  desktop's in-app browser was, so a mark set on one refused read would flip blocked sponsors
  between verified and unverified on every run. The past runs kept `verified` when a page could
  not be re-read. One exception: the crawler's signal for the page says it has failed three or
  more runs in a row (`Failed N run(s) in a row`, the page's `fail_streak` in `fingerprints.json`),
  and nothing this run could read it either. Then set `confidence: "unverified"`, because nobody
  has read that date for about a week. The other edit such a record can get is step 4's: a
  lapsed `next_deadline` derived from its own dates.
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
cd /tmp/bc-grants || exit 1; export TZ=America/Chicago TODAY=$(TZ=America/Chicago date +%F)
git config user.name "Elkhanany" && git config user.email "Elkhanany@users.noreply.github.com"
git remote get-url origin | grep -qx "https://gitlab.com/a.elkhanany/breast-cancer-grants.git" || { echo "origin is not GitLab: stop"; exit 1; }
git status -sb | head -1                 # expect: ## main...origin/main
git push --dry-run origin HEAD:main      # expect: Everything up-to-date
```

The identity is the one every past data commit carries, so `git log` reads as one history.

### 0c. The open web

```bash
cd /tmp/bc-grants || exit 1; export TZ=America/Chicago TODAY=$(TZ=America/Chicago date +%F)
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
cd /tmp/bc-grants || exit 1; export TZ=America/Chicago TODAY=$(TZ=America/Chicago date +%F)
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
Step 3 does not send them to the fan-out again. Nothing is committed yet; every step's changes go
into step 5's one commit.

## 2. Discover

Run `tools/discovery.workflow.js` with the Workflow tool, passing `args` as a JSON object:

```
scriptPath: /tmp/bc-grants/tools/discovery.workflow.js
args:       {"today": "<TODAY>", "root": "/tmp/bc-grants"}
```

Write the object it returns, unchanged, to `/tmp/bc-grants-run/discovery.json`. If the tool result
says it was saved to a file, copy the JSON from that file rather than retyping it. Then merge:

```bash
cd /tmp/bc-grants || exit 1; export TZ=America/Chicago TODAY=$(TZ=America/Chicago date +%F)
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

STOP = {"the", "a", "an", "of", "for", "and", "to", "in", "on", "with", "program", "programme"}
def words(s):  # "Seed Grants" and "Seed Grant" match
    return {w[:-1] if len(w) > 3 and w.endswith("s") else w for w in norm(s).split()} - STOP
def same_program(a, b):
    """Two records on one URL: the same call reworded, or two calls? Program words without the
    sponsor's, compared whole. Among the records already sharing a URL it picks out the five
    pairs that are one award entered twice (four are in REFRESH.md's reconciliation task, the
    fifth is the BCRF-AACR NextGen pair) and no distinct pair; the closest distinct pair,
    "V Clinical Scholar Grant" and "V Scholar Grant", scores 0.67."""
    wa, wb = words(a["program"]) - words(a["sponsor"]), words(b["program"]) - words(b["sponsor"])
    na, nb = {w for w in wa if re.search(r"\d", w)}, {w for w in wb if re.search(r"\d", w)}
    if na and nb and na != nb:  # "Cycle 1 2027" and "Cycle 2 2027": a different year or cycle
        return False
    wa, wb = wa - na, wb - nb
    return bool(wa and wb) and len(wa & wb) / len(wa | wb) >= 0.75

# Identity is sponsor + program, or an id one of the agents named. A URL is not: a portal page
# carries many calls (PCORI's four cycles, ARPA-H, Pfizer Competitive Grants beside its
# atirmociclib RFP, the DLDCCC list), so a shared URL is a note for step 3, never a merge.
by_id = {g["id"]: g for g in held}
held_prog, held_url = {}, {}
for g in held:
    held_prog.setdefault(norm(g["sponsor"] + " " + g["program"]), g["id"])
    held_url.setdefault(norm(g.get("url")), []).append(g["id"])
cand_by_id = {c["id"]: c for c in cands}
cand_prog, cand_url = {}, {}
for c in cands:
    r = c.get("record") or {}
    cand_prog.setdefault(norm((r.get("sponsor") or "") + " " + (r.get("program") or "")), c)
    cand_url.setdefault(norm(r.get("url")), []).append(c)
taken = set(by_id) | set(cand_by_id)
VFIELDS = ("focus", "breast_specific", "er_her2_fit", "award_usd", "award_text", "duration_years", "indirects",
           "loi_deadline", "full_deadline", "next_deadline", "deadline_status", "cycle", "typical_month",
           "verdict", "flags", "track_gate", "career_cap", "limited_submission", "eligibility", "notes",
           "confidence", "evidence")
MATERIAL = ("loi_deadline", "full_deadline", "next_deadline", "deadline_status", "confidence")

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

def fit_of(v):
    return max(0, min(140, v["fit"] if isinstance(v.get("fit"), (int, float)) else 0))

def verification(v, note=""):
    return {"real": v["real"], "active": v["active"], "eligible_plausible": v["eligible_plausible"],
            "duplicate_of": None, "reason": note + v["reason"]}

added, enrich, reverified, flagged, skipped = [], [], [], [], []
for x in res.get("candidates") or []:
    c, v = x["candidate"], x["v"]
    name = f'{c["sponsor"]}: {c["program"]}'
    if not v.get("real"):
        skipped.append(f"not real: {name}"); continue
    kp, ku = norm(c["sponsor"] + " " + c["program"]), norm(c["url"])
    named = [i for i in (v.get("duplicate_of_held_id"), c.get("overlaps_existing_id")) if i]
    hits = [i for i in named + [held_prog.get(kp)] if i in by_id]
    hid = next((i for i in hits if by_id[i]["status"] == "active"), hits[0] if hits else None)
    if hid and by_id[hid]["status"] == "active":
        # The same mechanism as a held record: the whole find goes to step 3, which reads it.
        enrich.append({"held_id": hid, "lens": x["lens"], "candidate": c, "v": v}); continue
    rep = (next((cand_by_id[i] for i in named if i in cand_by_id), None) or cand_prog.get(kp)
           or next((o for o in cand_url.get(ku, []) if same_program(o["record"], c)), None))
    if rep:
        # Never resurrect a reject, never re-add a promotion. A pending one takes today's verdict
        # when the verifier read the page and reached a different one, so a call that has opened
        # since it was found can be promoted instead of waiting on a stale verification.
        r, old = rep["record"], rep["verification"]
        changed = (any(old.get(k) != v.get(k) for k in ("active", "eligible_plausible"))
                   or any(r.get(k) != v.get(k) for k in MATERIAL))
        if (rep["decision"] == "pending" and v.get("confidence") != "unverified" and changed
                and rep["id"] not in reverified):
            for k in VFIELDS:
                r[k] = v.get(k)
            r["fit"], r["last_verified"] = fit_of(v), today
            rep["verification"] = verification(v)
            reverified.append(rep["id"])
        else:
            skipped.append(f'repeat of candidate {rep["id"]} ({rep["decision"]}): {name}')
        continue
    note = ""
    if hid:  # sponsor and program, or an agent, name a retired record: it may be running again
        note = f"Possible revival of retired record {hid}; promote only if its page shows a current cycle. "
    elif held_url.get(ku):
        note = (f"Shares its URL with held record(s) {', '.join(held_url[ku])}, but neither agent called it the "
                "same mechanism; step 3 checks it is a distinct call before promoting. ")
    elif cand_url.get(ku):
        note = (f"Shares its URL with candidate(s) {', '.join(o['id'] for o in cand_url[ku])} under a different "
                "program name; step 3 checks it is a distinct call before promoting. ")
    elif named:
        note = f"An agent named {', '.join(named)}, which is not a held or candidate id. "
    cid = slug(c["sponsor"], c["program"])
    rec = {"id": cid, "sponsor": c["sponsor"], "sponsor_full": c["sponsor_full"], "program": c["program"],
           "url": c["url"], "status": "active", "first_seen": today, "last_verified": today,
           "retired_on": None, "retired_reason": None, "category": c["category"], "tier": c["tier"]}
    for k in VFIELDS:
        rec[k] = v.get(k)
    rec["fit"] = fit_of(v)
    new = {"id": cid, "decision": "pending", "provides": c["provides"],
           "provenance": {"lens": x["lens"], "found_on": today, "run": "discovery",
                          "finder_summary": c["why_relevant"], "proven": c["proven"]},
           "verification": verification(v, note), "record": rec}
    cands.append(new)
    cand_by_id[cid] = new
    cand_prog.setdefault(kp, new)
    cand_url.setdefault(ku, []).append(new)
    added.append(cid)
    if note:
        flagged.append(f"{cid}: {note.strip()}")

C["generated"] = today
with open("data/candidates.json", "w", encoding="utf-8") as fh:
    json.dump(C, fh, indent=1, ensure_ascii=False)
with open(f"{RUN}/enrich.json", "w", encoding="utf-8") as fh:
    json.dump(enrich, fh, indent=1, ensure_ascii=False)
print(f"+{len(added)} candidates:", ", ".join(added) or "none")
print(f"{len(enrich)} enrichments for held records (step 3 reads each):",
      ", ".join(sorted({e['held_id'] for e in enrich})) or "none")
print(f"{len(reverified)} pending candidates re-verified:", ", ".join(reverified) or "none")
for s in flagged:
    print("flagged", s)
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
- **Identity.** The old merges were made by a model that judged identity; `duplicate_of` is null on
  every candidate they wrote. Here two things establish it: an id the verifier
  (`duplicate_of_held_id`) or the finder (`overlaps_existing_id`) names, or the same sponsor and
  program. A URL does not. Nineteen URLs in `grants.json` each carry several distinct records,
  because a portal page lists many calls. A new Pfizer RFP on the Competitive Grants page, a new
  PCORI cycle or a new DLDCCC listing is a new find, not news about the record that happens to
  share the page.
- **Not added: enrichments.** A find tied to an active held record. The whole find, the finder's
  `candidate` and the verifier's `v`, goes to `/tmp/bc-grants-run/enrich.json`, and step 3 reads
  each one.
- **Not added: repeats.** A repeat of an existing candidate, whatever its decision, by a named id,
  sponsor and program, or the same URL with much the same program name (`same_program`: at least
  three quarters of the words in common once the sponsor's are set aside, and no conflicting year
  or cycle number). A `"reject"` is never resurrected and a `"promoted"` never
  re-added. A `"pending"` one is re-verified in place when today's verifier read the page (its
  `confidence` is not `unverified`) and changed `active`, `eligible_plausible`, a date,
  `deadline_status` or `confidence`. The record's verifier fields, `fit`, `last_verified` and
  `verification` are replaced. `id`, `first_seen`, `provenance` and the finder's fields stay. That
  way a candidate found while its call was closed can be promoted once the call opens, and does
  not wait on its first verdict forever. A repeat with nothing new is skipped, so the file does
  not churn every run.
- **Added with a note** at the front of `verification.reason`, for step 3. A find that shares a
  held record's or a candidate's URL without being the same mechanism, and a find that matches a
  *retired* record ("Possible revival of retired record ..."). A retired match is never dropped:
  the program may be running again.
- **Kept as pending** even when `active` or `eligible_plausible` is false, as before. The site
  shows them as awaiting promotion, and step 3 promotes only what passes.
- **Ids** are a slug of sponsor and program, at most 60 characters, unique across both files.
  Rename one that reads badly before the commit; nothing else refers to it yet.
- **Placement.** Appended at the end, with `candidates.json`'s `generated` set to today.

If the workflow fails or returns nothing, skip the merge, say so in the report and go on to step 3.

## 3. Refresh

Follow [REFRESH.md](REFRESH.md) steps 1 to 8, with these specifics.

**Snapshot first.** Everything steps 1 and 2 kept, before step 3 writes anything. If step 3 does
not finish, the run falls back to this (see "When a step fails midway").

```bash
cd /tmp/bc-grants || exit 1; mkdir -p /tmp/bc-grants-run/snap && cp data/grants.json data/candidates.json /tmp/bc-grants-run/snap/
```

**Due list.** Step 2 of REFRESH.md, built by code. Pass the ids step 1 settled as one
comma-separated argument; the discovery enrichments are read from `/tmp/bc-grants-run/enrich.json`.

```bash
cd /tmp/bc-grants || exit 1; export TZ=America/Chicago TODAY=$(TZ=America/Chicago date +%F)
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
  nothing (Ground rules, for the one exception) and goes in the report.
- `failed`: those batches' records wait for the next run.

**Signals the fan-out cannot settle.** `coverage_gap`, `new_federal_opportunity` and the passages
an `rfp_changed` signal added are for you, not the fan-out; handle them as REFRESH.md step 2
item 0 says. A time-limited RFP becomes its own posted-cycle record.

**Enrichments.** The fan-out re-reads each enriched record's own page, which may not be where
discovery found the news. So read every entry in `/tmp/bc-grants-run/enrich.json` yourself: the
held record beside the find's `candidate` (what the finder saw, its `url`) and `v` (the
verifier's complete record, `evidence` quoting the page). It is one of two things.

- **News about that record:** a date, an award change, a contact, terms. A date is written only
  if the fan-out's two reads confirmed it. A date the find gives that the fan-out did not confirm
  is reported as disputed. Other fields the find's evidence quotes from the primary page (award,
  eligibility, `program_contact`, a notes addendum) are applied where the fan-out did not
  contradict them.
- **A distinct mechanism on that record's page:** a new cycle, a time-limited RFP, a
  sub-program. Open its page once more yourself, then record it as its own posted-cycle record
  (REFRESH.md step 2 item 0, every field per step 5, built from `v`) and count it in `added`. The
  standing record keeps its own dates.

**Retired records.** The due list ignores retired ids. A find that names one was added as a
candidate with a "Possible revival" note, so it is judged at promotion, below.

**New opportunities.** REFRESH.md step 5's search is what step 2 just did. Skip it.

**Promotion.** REFRESH.md step 5b, for candidates whose `provenance.found_on` is before today
only. A find spends at least one run on the site under "Newly surfaced", so the owner can set
`"reject"` before it enters the curated set. The desktop pipeline gave the same window between
Wednesday's sweep and Thursday's refresh. A candidate whose `verification.reason` begins with a
note from the merge needs one more check before promotion:

- "Shares its URL with ...": read both. If it is the held record or candidate after all, fold
  anything new into that record as an enrichment would be, set this candidate's `decision` to
  `"reject"` and `verification.duplicate_of` to the id it duplicates, so it is never surfaced
  again. If it is a distinct call, promote it as usual.
- "Possible revival of retired record ...": promote only if its own page shows a current or
  announced cycle, and name the retired id in the promoted record's `notes`. The retired record
  stays retired, because nothing is deleted and its history stands.

**Top-level fields and changelog.** REFRESH.md steps 7 and 8. `generated` is today and `count`
is exact on every run, with README.md's count updated when it moves. Prepend one changelog entry
for the whole run, `"kind": "update"`, covering step 1's date moves and this step's changes. Write
it even when nothing changed: "N records re-verified; no deadline moved."

## 4. Validate

```bash
cd /tmp/bc-grants || exit 1; export TZ=America/Chicago TODAY=$(TZ=America/Chicago date +%F)
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
cd /tmp/bc-grants || exit 1; export TZ=America/Chicago TODAY=$(TZ=America/Chicago date +%F)
git status --short     # data/*.json; README.md when the count moved; REFRESH.md when its dated
                       # DOD/CPRIT state was rewritten (REFRESH.md step 2); nothing else
git add -A
git commit -m "update $TODAY: +N added, N changed, N retired, +N candidates"
git remote get-url origin | grep -qx "https://gitlab.com/a.elkhanany/breast-cancer-grants.git" || { echo "origin is not GitLab: stop"; exit 1; }
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
cd /tmp/bc-grants || exit 1; export TZ=America/Chicago TODAY=$(TZ=America/Chicago date +%F)
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

- **Never commit anything that fails step 4.** Fix the record that fails. If it cannot be fixed,
  take the step 3 path below, which drops everything step 3 wrote. If validation still fails,
  step 1's moves are the cause. Drop them, and with them the crawler's memory and the changelog
  entry that described them, so the signals that found them come back next run:
  `git checkout -- data/grants.json data/fingerprints.json data/signals.json data/changelog.json README.md`.
  Commit step 2's candidates alone if they validate.
- **Step 2 fails:** no candidates this run. Go on.
- **Step 3 does not finish, or the Workflow tool is unavailable:** go back to the snapshot taken
  at the start of step 3, and restore the crawler's memory.

  ```bash
  cd /tmp/bc-grants || exit 1; cp /tmp/bc-grants-run/snap/grants.json /tmp/bc-grants-run/snap/candidates.json data/
  git checkout -- data/fingerprints.json data/signals.json data/changelog.json README.md
  ```

  The snapshot drops whatever step 3 had half-applied, promotions included, so no candidate says
  `"promoted"` without its record; the next run redoes it. The memory goes back so the next run
  raises the same signals again. A signal raised twice costs one look; a signal lost is a deadline
  nobody reads. What is left, step 1's date moves and step 2's candidates, is worth keeping if it
  validates. Set `generated` to today and `count` exact, and prepend one changelog entry
  (`"kind": "update"`, step 1's moves old → new in `details`, a summary ending "refresh
  incomplete"), so the site's "Last update" says what happened. Commit with "(refresh incomplete)"
  at the end of the subject line, and report what failed. Never try to do the fan-out by hand;
  it is a configuration problem to fix, not to work around.
- **Nothing worth keeping is left:** commit nothing, and report why.
