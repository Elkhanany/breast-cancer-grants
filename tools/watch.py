#!/usr/bin/env python3
"""Daily watch: notice change without spending a model on pages that have not changed.

    python tools/watch.py          # compare against data/fingerprints.json, write data/signals.json
    python tools/watch.py --seed   # record today's state as the baseline, emit no change signals

Two sources, both deterministic:

1. Sponsor pages for the records worth watching (near deadlines, DOD BCRP, CPRIT, anything still
   projected or unverified in the federal and state buckets). Each page is fetched, stripped to
   text, and reduced to the set of calendar dates it mentions. A changed date set is a signal.
   A page that blocks scripts (403) or times out is also a signal, routed to the model tier,
   because a page that cannot be read is not evidence of anything.

2. Grants.gov search2 API for federal opportunities mentioning breast cancer. Any opportunity
   number not seen before is a signal. Keyword search there is noisy, so the diff is the point:
   only genuinely new numbers surface, a handful a week.

Signals are data for the next model pass, never edits to data/grants.json. This script always
exits 0; failing to reach a page is recorded, not raised.
"""
import argparse
import hashlib
import json
import re
import ssl
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta

GRANTS = "data/grants.json"
FINGERPRINTS = "data/fingerprints.json"
SIGNALS = "data/signals.json"

UA = "Mozilla/5.0 (compatible; bc-grants-watch/1.0; +https://github.com/Elkhanany/breast-cancer-grants)"
TIMEOUT = 25
WATCH_HORIZON_DAYS = 75
ALWAYS_WATCH_SPONSORS = ("DOD CDMRP BCRP", "CPRIT")
# Industry portals are rolling, so they never carry a deadline and would never be watched.
# Their pages change when a sponsor posts an asset-specific RFP; that is what the RFP-line
# fingerprint below is for.
ALWAYS_WATCH_CATEGORIES = ("trial-funding",)
# Compounds and topics this portfolio cares about. A sponsor listing one of these on a watched
# page is worth a look even when no RFP wording surrounds it.
WATCH_TERMS = (
    "sacituzumab", "tirumotecan", "sac-TMT", "MK-2870", "Trodelvy", "Enhertu", "trastuzumab deruxtecan",
    "Dato-DXd", "datopotamab", "tucatinib", "imlunestrant", "camizestrant", "vepdegestrant",
    "giredestrant", "elacestrant", "palazestrant", "ribociclib", "abemaciclib", "atirmociclib",
    "zanidatamab", "breast", "HER2", "TROP-2", "TROP2", "antibody-drug conjugate", "ctDNA",
    "minimal residual disease", "real-world",
)
# Bump when RFP_RE or WATCH_TERMS change: the first run after a change re-baselines every page
# instead of reporting the whole watchlist as changed.
RFP_VERSION = 2
RFP_RE = re.compile(
    r"(request for proposals?|RFPs?|call for proposals?|areas? of (?:research )?interest|"
    r"funding opportunit\w*|now accepting|actively accepting|accepting submissions|"
    r"submission (?:deadline|window)|competitive grant|research grant program|letter of intent|"
    r"applications? (?:open|close|due)|" + "|".join(re.escape(t) for t in WATCH_TERMS) + r")", re.I)
# Companies whose assets touch this portfolio. The routine checks that each is represented by at
# least one record and raises coverage_gap for any that is not, because industry programs come and
# go: a company with no record today may have opened a portal since anyone last looked. Matching is
# by URL domain, so a foundation award bearing a company's name never counts as coverage of its
# investigator-research programme. Re-reported at most every COVERAGE_GAP_DAYS.
COVERAGE_GAP_DAYS = 30
PHARMA_WATCHLIST = (
    ("AstraZeneca", ("astrazeneca.com",), "Enhertu, Dato-DXd, camizestrant, Truqap"),
    ("Daiichi Sankyo", ("daiichisankyo-esr.com", "daiichisankyo.com"), "Enhertu, Dato-DXd"),
    ("Merck", ("misp-investigator-studies.com", "merck.com"), "sac-TMT (MK-2870), pembrolizumab"),
    ("Gilead", ("gilead.com",), "Trodelvy"),
    ("Pfizer / Seagen", ("pfizer.com",), "tucatinib, vepdegestrant, atirmociclib"),
    ("Lilly", ("lilly.com", "lillyinvestigatorresearch.com"), "Verzenio, imlunestrant"),
    ("Novartis", ("novartis.com",), "Kisqali"),
    ("Genentech / Roche", ("gene.com", "roche.com"), "giredestrant, Phesgo, Kadcyla"),
    ("Menarini / Stemline", ("menarinistemline.com",), "Orserdu (elacestrant)"),
    ("AbbVie", ("abbvie.com",), "ADC platform"),
    ("Boehringer Ingelheim", ("boehringer-ingelheim.com",), "HER2 programme"),
    ("Puma Biotechnology", ("pumabiotechnology.com",), "neratinib, HER2-mutant"),
    ("Olema", ("olema.com",), "palazestrant"),
    ("Arvinas", ("arvinas.com",), "vepdegestrant"),
    ("Sermonix", ("sermonixpharma.com",), "lasofoxifene, ESR1-mutant"),
    ("Bristol Myers Squibb", ("bms.com",), "ISR programme, moved to RFP cycles"),
    ("Eisai", ("eisaigrants.com", "eisai.com"), "eribulin (Halaven)"),
    ("Zymeworks", ("zymeworks.com",), "zanidatamab, HER2 bispecific"),
    ("Jazz Pharmaceuticals", ("jazzpharmaceuticals.com", "jazzpharma.com"), "Ziihera (zanidatamab)"),
    ("Bayer", ("bayer.com",), "elinzanetant, endocrine-therapy supportive care"),
    ("Exact Sciences", ("exactsciences.com",), "Oncotype DX, OncoExTra"),
    ("Agendia", ("agendia.com",), "MammaPrint, BluePrint, FLEX registry"),
    ("Guardant Health", ("guardanthealth.com",), "ctDNA"),
    ("Natera", ("natera.com",), "Signatera MRD"),
    ("Tempus", ("tempus.com",), "real-world data, sequencing"),
    ("Caris Life Sciences", ("carislifesciences.com",), "Precision Oncology Alliance"),
    ("Foundation Medicine", ("foundationmedicine.com",), "CGP, real-world data"),
)

GRANTSGOV_KEYWORDS = ("breast cancer", "metastatic breast")
GRANTSGOV_AGENCY_PREFIXES = ("DOD-AMRAA", "HHS-NIH", "HHS-AHRQ", "HHS-FDA", "NSF")

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
DATE_RE = re.compile(
    r"\b(?P<mon1>jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(?P<d1>\d{1,2})(?:st|nd|rd|th)?,?\s+(?P<y1>20\d{2})\b"
    r"|\b(?P<d2>\d{1,2})\s+(?P<mon2>jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+(?P<y2>20\d{2})\b"
    r"|\b(?P<y3>20\d{2})-(?P<m3>\d{2})-(?P<d3>\d{2})\b"
    r"|\b(?P<m4>\d{1,2})/(?P<d4>\d{1,2})/(?P<y4>20\d{2})\b",
    re.I)

ctx = ssl.create_default_context()


def iso(m):
    g = m.groupdict()
    try:
        if g["mon1"]:
            return date(int(g["y1"]), MONTHS[g["mon1"][:3].lower()], int(g["d1"])).isoformat()
        if g["mon2"]:
            return date(int(g["y2"]), MONTHS[g["mon2"][:3].lower()], int(g["d2"])).isoformat()
        if g["y3"]:
            return date(int(g["y3"]), int(g["m3"]), int(g["d3"])).isoformat()
        if g["y4"]:
            return date(int(g["y4"]), int(g["m4"]), int(g["d4"])).isoformat()
    except ValueError:
        return None
    return None


def strip_html(html):
    html = re.sub(r"<(script|style|noscript)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
    html = re.sub(r"<[^>]+>", " ", html)
    html = re.sub(r"&nbsp;|&#160;", " ", html)
    return re.sub(r"\s+", " ", html)


def fetch(url):
    """Return (status, text_or_none, raw_bytes, content_type)."""
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/pdf,*/*"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx) as r:
            raw = r.read()
            ctype = (r.headers.get("Content-Type") or "").lower()
            return r.status, raw.decode("utf-8", "replace"), raw, ctype
    except urllib.error.HTTPError as e:
        return e.code, "", b"", ""
    except Exception as e:  # timeouts, DNS, TLS
        return 0, str(e), b"", ""


GRANTSGOV_DETAIL = re.compile(r"grants\.gov/search-results-detail/(\d+)")


def grantsgov_opportunity(opp_id):
    """Grants.gov detail pages render in JavaScript; the API holds the dates."""
    body = json.dumps({"opportunityId": int(opp_id)}).encode()
    req = urllib.request.Request(
        "https://api.grants.gov/v1/api/fetchOpportunity", data=body,
        headers={"Content-Type": "application/json", "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx) as r:
        d = json.load(r).get("data", {}) or {}
    syn = d.get("synopsis") or d.get("forecast") or {}
    text = " ".join(str(v) for v in syn.values() if isinstance(v, (str, int, float)))
    text += " " + str(d.get("opportunityTitle", ""))
    return text, (syn.get("responseDate") or syn.get("closeDate") or syn.get("forecastedCloseDate"))


def rfp_lines(text):
    """Short windows of text around RFP-ish phrases. A new window means the page now says
    something about a call it did not say before; that is the signal for rolling portals."""
    out = set()
    for m in RFP_RE.finditer(text):
        a = max(0, m.start() - 60)
        w = re.sub(r"\s+", " ", text[a:m.end() + 90]).strip()
        out.add(w)
    return sorted(out)


def watchlist(grants, today):
    """Which records earn a daily look. Dedupe by URL; many records share a landing page."""
    horizon = (today + timedelta(days=WATCH_HORIZON_DAYS)).isoformat()
    by_url = {}
    for g in grants:
        if g.get("status") != "active" or not g.get("url"):
            continue
        near = g.get("next_deadline") and today.isoformat() <= g["next_deadline"] <= horizon
        always = (g.get("sponsor") in ALWAYS_WATCH_SPONSORS
                  or g.get("category") in ALWAYS_WATCH_CATEGORIES)
        shaky = (g.get("confidence") in ("projected", "unverified")
                 and g.get("category") in ("government", "state"))
        if near or always or shaky:
            by_url.setdefault(g["url"], []).append(g["id"])
            # A record may name extra pages worth watching: the RFP list behind a portal's
            # landing page, an announcement PDF, a sponsor's "areas of interest" page.
            for extra in g.get("watch_urls") or []:
                by_url.setdefault(extra, []).append(g["id"])
    return by_url


def grantsgov():
    """Return {opportunity_number: summary} for the configured keywords."""
    found = {}
    for kw in GRANTSGOV_KEYWORDS:
        body = json.dumps({"keyword": kw, "oppStatuses": "forecasted|posted", "rows": 300}).encode()
        req = urllib.request.Request(
            "https://api.grants.gov/v1/api/search2", data=body,
            headers={"Content-Type": "application/json", "User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx) as r:
                hits = json.load(r).get("data", {}).get("oppHits", [])
        except Exception as e:
            print(f"warning: grants.gov query {kw!r} failed: {e}", file=sys.stderr)
            continue
        for h in hits:
            agency = h.get("agencyCode") or ""
            if not agency.startswith(GRANTSGOV_AGENCY_PREFIXES):
                continue
            found[h["number"]] = {
                "title": h.get("title"), "agency": agency, "status": h.get("oppStatus"),
                "open": h.get("openDate"), "close": h.get("closeDate"),
                "url": f"https://www.grants.gov/search-results-detail/{h.get('id')}",
            }
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", action="store_true", help="record baseline, emit no change signals")
    args = ap.parse_args()
    today = date.today()
    now = datetime.now().isoformat(timespec="seconds")

    with open(GRANTS, encoding="utf-8") as fh:
        grants = json.load(fh)["grants"]
    try:
        with open(FINGERPRINTS, encoding="utf-8") as fh:
            fp = json.load(fh)
    except FileNotFoundError:
        fp = {"pages": {}, "grantsgov_seen": {}}

    signals = []
    pages = fp.setdefault("pages", {})
    targets = watchlist(grants, today)
    print(f"watching {len(targets)} pages for {sum(len(v) for v in targets.values())} records")

    for url, ids in sorted(targets.items()):
        prev = pages.get(url, {})
        m = GRANTSGOV_DETAIL.search(url)
        if m:
            # federal: ask the API rather than scrape a JS-rendered page
            try:
                text, close = grantsgov_opportunity(m.group(1))
                status, body, raw, ctype = 200, text, b"", "api/grants.gov"
            except Exception as e:
                status, body, raw, ctype = 0, str(e), b"", ""
        else:
            status, body, raw, ctype = fetch(url)
        entry = {"ids": ids, "checked": now, "status": status}
        if status != 200:
            if status in (401, 403, 429):
                kind = "blocked"
            elif status in (404, 410):
                # A rolling portal that has gone is how an industry programme ends: there is no
                # closing date to observe, the page simply stops existing.
                kind = "not_found"
            else:
                kind = "unreachable"
            entry["dates"] = prev.get("dates", [])
            entry["fail_streak"] = prev.get("fail_streak", 0) + 1
            pages[url] = entry
            if not args.seed:
                signals.append({"kind": kind, "ids": ids, "url": url, "http": status,
                                "detail": f"{kind} ({status}); a model must read this page. "
                                          f"Failed {entry['fail_streak']} run(s) in a row."})
            print(f"  {status:>3}  {url}")
            continue

        is_pdf = "application/pdf" in ctype or raw[:5] == b"%PDF-" or url.lower().endswith(".pdf")
        if is_pdf:
            # No PDF parser in the standard library; a changed document is the signal instead.
            digest = hashlib.sha256(raw).hexdigest()[:16]
            entry.update({"dates": prev.get("dates", []), "sha": digest, "bytes": len(raw), "fail_streak": 0})
            pages[url] = entry
            print(f"  200  {url}  (pdf {len(raw)} bytes)")
            if not args.seed and prev.get("sha") and prev["sha"] != digest:
                signals.append({"kind": "document_changed", "ids": ids, "url": url,
                                "detail": f"PDF bytes changed since {prev.get('checked', '?')[:10]} "
                                          f"({prev.get('bytes')} -> {len(raw)} bytes); read it for a date change."})
            continue

        text = strip_html(body)
        dates = sorted({d for d in (iso(m) for m in DATE_RE.finditer(text)) if d})
        # keep only dates that could be a deadline: not more than a year in the past
        floor = (today - timedelta(days=365)).isoformat()
        dates = [d for d in dates if d >= floor]
        entry["dates"] = dates
        entry["rfp"] = rfp_lines(text)
        entry["rfp_v"] = RFP_VERSION
        entry["fail_streak"] = 0
        pages[url] = entry
        print(f"  200  {url}  ({len(dates)} dates, {len(entry['rfp'])} rfp lines)")

        if args.seed or "dates" not in prev:
            continue
        if prev.get("status") != 200:
            # Yesterday it was blocked or down; today it reads. That is news, but it is not a diff.
            signals.append({"kind": "now_readable", "ids": ids, "url": url, "dates": dates,
                            "detail": f"readable again after {prev.get('fail_streak', '?')} failed run(s); "
                                      f"{len(dates)} dates on the page, no baseline to compare."})
            continue
        added = sorted(set(dates) - set(prev["dates"]))
        removed = sorted(set(prev["dates"]) - set(dates))
        if added or removed:
            signals.append({"kind": "dates_changed", "ids": ids, "url": url,
                            "dates_added": added, "dates_removed": removed,
                            "detail": f"+{len(added)} / -{len(removed)} dates since {prev.get('checked', '?')[:10]}"})
        # RFP text is compared only once a baseline exists, so an upgraded crawler never
        # reports every page as changed on its first run.
        if "rfp" in prev and prev.get("rfp_v") == RFP_VERSION:
            r_added = sorted(set(entry["rfp"]) - set(prev["rfp"]))
            r_removed = sorted(set(prev["rfp"]) - set(entry["rfp"]))
            if r_added or r_removed:
                signals.append({"kind": "rfp_changed", "ids": ids, "url": url,
                                "lines_added": r_added[:12], "lines_removed": r_removed[:12],
                                "detail": f"+{len(r_added)} / -{len(r_removed)} RFP-related passages since {prev.get('checked', '?')[:10]}"})

    # Coverage: is every company on the pharma watchlist represented at all?
    urls = " ".join((g.get("url") or "") + " " + " ".join(g.get("watch_urls") or [])
                    for g in grants if g.get("status") == "active").lower()
    reported = fp.setdefault("coverage_reported", {})
    stale = (today - timedelta(days=COVERAGE_GAP_DAYS)).isoformat()
    gaps = 0
    for company, domains, why in PHARMA_WATCHLIST:
        if any(d in urls for d in domains):
            reported.pop(company, None)
            continue
        gaps += 1
        if args.seed or reported.get(company, "") > stale:
            continue
        reported[company] = today.isoformat()
        signals.append({"kind": "coverage_gap", "ids": [], "url": "",
                        "company": company, "domains": list(domains), "why": why,
                        "detail": f"no record cites {' or '.join(domains)}; {company} is relevant for "
                                  f"{why}. Check whether it runs an investigator-research or RFP "
                                  f"programme now, and record it or note that it does not."})
    print(f"pharma coverage: {len(PHARMA_WATCHLIST) - gaps}/{len(PHARMA_WATCHLIST)} companies represented")

    seen = fp.setdefault("grantsgov_seen", {})
    current = grantsgov()
    print(f"grants.gov: {len(current)} opportunities across keywords, {len(seen)} previously seen")
    for num, info in current.items():
        if num in seen:
            continue
        seen[num] = {"first_seen": today.isoformat(), **info}
        if not args.seed:
            signals.append({"kind": "new_federal_opportunity", "ids": [], "url": info["url"],
                            "opportunity": num, "agency": info["agency"], "title": info["title"],
                            "close": info["close"], "status": info["status"],
                            "detail": f"{num} ({info['agency']}, {info['status']}) not previously seen"})

    fp["updated"] = now
    with open(FINGERPRINTS, "w", encoding="utf-8") as fh:
        json.dump(fp, fh, indent=1, ensure_ascii=False)

    out = {"generated": today.isoformat(), "seeded": bool(args.seed),
           "pages_watched": len(targets), "signals": signals}
    with open(SIGNALS, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1, ensure_ascii=False)

    by_kind = {}
    for s in signals:
        by_kind[s["kind"]] = by_kind.get(s["kind"], 0) + 1
    print("signals:", by_kind or "none")
    return 0


if __name__ == "__main__":
    sys.exit(main())
