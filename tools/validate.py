#!/usr/bin/env python3
"""Validate the dataset before it is published.

Run locally exactly as CI runs it:

    python tools/validate.py

Every check here corresponds to a way the site renders wrong rather than erroring, which is
the failure mode worth catching: a bad `fit` blanks a row, an unknown `verdict` shows an
"unknown" pill, and a stale `count` blocks the deploy.
"""
import json
import re
import sys
from datetime import date

DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
DATE_FIELDS = ("first_seen", "last_verified", "loi_deadline",
               "full_deadline", "next_deadline", "retired_on")

STATUS = {"active", "retired"}
VERDICT = {"eligible", "needs-check", "track-gated", "ruled-out"}
CONFIDENCE = {"verified", "projected", "unverified"}
CATEGORY = {"government", "state", "institutional",
            "foundation", "trial-funding", "organization"}
TIER = {"early-career", "mid-size", "program-large"}

errors = []
warnings = []


def err(msg):
    errors.append(msg)


def warn(msg):
    warnings.append(msg)


def main():
    with open("data/grants.json", encoding="utf-8") as fh:
        doc = json.load(fh)

    grants = doc["grants"]

    # Top-level fields. A stale count is the most likely way to break the deploy.
    if len(grants) != doc.get("count"):
        err(f"count is {doc.get('count')} but there are {len(grants)} records "
            f"(REFRESH.md step 7)")
    if not DATE.match(str(doc.get("generated", ""))):
        err(f"generated is not YYYY-MM-DD: {doc.get('generated')!r}")

    ids = [g["id"] for g in grants]
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        err(f"duplicate ids: {sorted(dupes)}")

    for g in grants:
        gid = g["id"]

        if g.get("status") not in STATUS:
            err(f"{gid}: status {g.get('status')!r}")
        if g.get("verdict") not in VERDICT:
            err(f"{gid}: verdict {g.get('verdict')!r} is not one the site can render")
        if g.get("confidence") not in CONFIDENCE:
            err(f"{gid}: confidence {g.get('confidence')!r}")
        if g.get("category") not in CATEGORY:
            err(f"{gid}: category {g.get('category')!r} has no chip")
        if g.get("tier") not in TIER:
            err(f"{gid}: tier {g.get('tier')!r} is not selectable")

        fit = g.get("fit")
        if not isinstance(fit, (int, float)) or not 0 <= fit <= 140:
            err(f"{gid}: fit {fit!r} outside 0-140, the row will render blank")

        for field in DATE_FIELDS:
            value = g.get(field)
            if value is not None and not DATE.match(str(value)):
                err(f"{gid}: {field} is not YYYY-MM-DD: {value!r}")

        if not isinstance(g.get("focus"), list):
            err(f"{gid}: focus must be a list")
        if not isinstance(g.get("flags"), list):
            err(f"{gid}: flags must be a list")

        url = g.get("url") or ""
        if not url.startswith(("http://", "https://")):
            err(f"{gid}: url is not absolute: {url!r}")

        for extra in g.get("watch_urls") or []:
            if not str(extra).startswith("https://"):
                err(f"{gid}: watch_urls entry is not https: {extra!r}")

        if g.get("status") == "retired" and not g.get("retired_on"):
            err(f"{gid}: retired without retired_on")

        # Warnings: wrong, but they do not justify blocking a deploy.
        nxt = g.get("next_deadline")
        if nxt and DATE.match(str(nxt)) and nxt < str(date.today()):
            warn(f"{gid}: next_deadline {nxt} has passed (REFRESH.md step 6)")
        if g.get("verdict") == "track-gated" and not g.get("track_gate"):
            warn(f"{gid}: track-gated but track_gate is empty, the toggle cannot resolve it")

    with open("data/changelog.json", encoding="utf-8") as fh:
        log = json.load(fh)
    entries = log.get("entries", [])
    if not entries:
        err("changelog has no entries")
    dates = [e.get("date", "") for e in entries]
    if dates != sorted(dates, reverse=True):
        err("changelog entries are not newest-first; the site reads entries[0] "
            "as the last update (REFRESH.md step 8)")

    # Optional pipeline files: absent is fine, malformed is not.
    import os
    if os.path.exists("data/candidates.json"):
        with open("data/candidates.json", encoding="utf-8") as fh:
            cand = json.load(fh)
        for c in cand.get("candidates", []):
            if c.get("decision") not in ("pending", "promote", "reject", "promoted"):
                err(f"candidate {c.get('id')}: decision {c.get('decision')!r}")
            if not isinstance(c.get("record"), dict) or not c["record"].get("url"):
                err(f"candidate {c.get('id')}: record missing or has no url")
            if c.get("decision") in ("pending", "promote") and c.get("id") in ids:
                warn(f"candidate {c.get('id')}: id already exists in grants.json")
    if os.path.exists("data/signals.json"):
        with open("data/signals.json", encoding="utf-8") as fh:
            sig = json.load(fh)
        if not isinstance(sig.get("signals"), list):
            err("signals.json has no signals list")

    # Agents sometimes leave scratch files inside the repository. Refuse to publish with any
    # untracked file present, so `git add -A` in a scheduled run cannot sweep one in.
    import subprocess
    try:
        untracked = subprocess.run(["git", "ls-files", "--others", "--exclude-standard"],
                                   capture_output=True, text=True, check=True).stdout.split()
    except Exception:
        untracked = []   # not a git checkout (CI artifact); nothing to guard
    for f in untracked:
        err(f"untracked file {f}: delete it or add it deliberately with a .gitignore rule")

    for w in warnings:
        print(f"warning: {w}")
    for e in errors:
        print(f"ERROR: {e}", file=sys.stderr)

    if errors:
        print(f"\n{len(errors)} error(s); refusing to publish.", file=sys.stderr)
        return 1

    retired = sum(1 for g in grants if g["status"] == "retired")
    print(f"{len(grants)} records valid, {retired} retired, "
          f"generated {doc['generated']}, {len(warnings)} warning(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
