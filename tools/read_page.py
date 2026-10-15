#!/usr/bin/env python3
"""Read a page the way a browser sees it: headless Chromium, JavaScript run, visible text out.

    python3 tools/read_page.py URL                     # visible text of the rendered page
    python3 tools/read_page.py URL --links             # ... followed by every link, text -> href
    python3 tools/read_page.py URL --click "United States" --click "Continue"

For the pages a plain fetch cannot read: sponsors that answer 403 to scripts (CPRIT's landing
page, Komen, PCORI), portals that build their tables in JavaScript, and gates that ask for a
country before showing anything (Merck MISP). Each --click runs in order once the page settles.
It matches a button, link, tab, radio, label or visible text containing the words; a <select>
option is chosen rather than clicked. Run once without --click to read the gate's own labels.

Exit status: 0 the page loaded; 1 it loaded with HTTP 400 or above (the text is still printed,
because a refusal page usually says why); 2 it did not load, or a --click target was not found.
A page that exits 2 is unreachable, not empty: never edit a record on the strength of it.

Uses the Chromium already in PLAYWRIGHT_BROWSERS_PATH (/opt/pw-browsers in the cloud session).
If the Python playwright module is missing it pip-installs the release that drives that build,
quietly, and never runs `playwright install`: a browser download is slow, and the wrong build
would not match the preinstalled one anyway.
"""
import argparse
import os
import re
import subprocess
import sys

# Playwright 1.56 drives chromium-1194, the build preinstalled in /opt/pw-browsers.
# Bump the two together or the launch fails with "Executable doesn't exist".
PLAYWRIGHT_VERSION = "1.56.0"
DEFAULT_BROWSERS = "/opt/pw-browsers"
# Headless Chromium announces itself as HeadlessChrome, which some sponsor sites refuse.
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/141.0.0.0 Safari/537.36")
SETTLE_MS = 15000


def ensure_playwright():
    try:
        import playwright.sync_api  # noqa: F401
        return
    except ImportError:
        pass
    if os.environ.get("READ_PAGE_INSTALLED"):
        print("read_page: playwright installed but still not importable", file=sys.stderr)
        sys.exit(2)
    base = [sys.executable, "-m", "pip", "install", "--quiet", "--disable-pip-version-check",
            f"playwright=={PLAYWRIGHT_VERSION}"]
    # Debian-style Pythons refuse a system-wide install without the second flag.
    for extra in ([], ["--break-system-packages"], ["--user", "--break-system-packages"]):
        r = subprocess.run(base + extra, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        if r.returncode == 0:
            break
    else:
        print(r.stderr[-1500:], file=sys.stderr)
        print(f"read_page: could not pip install playwright=={PLAYWRIGHT_VERSION}", file=sys.stderr)
        sys.exit(2)
    # A fresh install can land in a site directory this interpreter did not scan at startup.
    os.environ["READ_PAGE_INSTALLED"] = "1"
    os.execv(sys.executable, [sys.executable] + sys.argv)


def proxy_settings():
    """Chromium ignores HTTPS_PROXY unless told; the cloud session reaches the web only through it."""
    server = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    if not server:
        return None
    bypass = os.environ.get("NO_PROXY") or os.environ.get("no_proxy") or ""
    # Playwright otherwise sends even localhost through the proxy, which refuses plain http.
    os.environ.setdefault("PLAYWRIGHT_DISABLE_FORCED_CHROMIUM_PROXIED_LOOPBACK", "1")
    return {"server": server, "bypass": ",".join(filter(None, ["localhost", "127.0.0.1", bypass]))}


def settle(page, ms, timeout_error):
    try:
        page.wait_for_load_state("networkidle", timeout=ms)
    except timeout_error:
        pass  # long-polling pages never go idle; what has rendered by now is what there is


def click(page, text, ms):
    select = page.locator("select").filter(has=page.locator("option", has_text=text))
    if select.count():
        value = select.first.locator("option", has_text=text).first.evaluate("o => o.value")
        select.first.select_option(value=value, timeout=ms)
        return "chose"
    for loc in (page.get_by_role("button", name=text), page.get_by_role("link", name=text),
                page.get_by_role("tab", name=text), page.get_by_role("menuitem", name=text),
                page.get_by_role("radio", name=text), page.get_by_role("option", name=text),
                page.get_by_label(text), page.get_by_text(text, exact=True), page.get_by_text(text)):
        loc = loc.filter(visible=True)
        if loc.count():
            loc.first.click(timeout=ms)
            return "clicked"
    return None


def visible_text(page):
    parts = [page.inner_text("body")]
    for frame in page.frames[1:]:
        try:
            t = frame.inner_text("body", timeout=5000)
        except Exception:
            continue
        if t.strip():
            parts.append(f"--- frame {frame.url} ---\n{t}")
    return re.sub(r"\n[ \t]*(\n[ \t]*)+", "\n\n", "\n\n".join(parts)).strip()


def links(page):
    pairs = page.eval_on_selector_all(
        "a[href]", "els => els.map(a => [(a.innerText || a.title || '').replace(/\\s+/g, ' ').trim(), a.href])")
    seen, out = set(), []
    for text, href in pairs:
        if href.startswith(("http://", "https://")) and (text, href) not in seen:
            seen.add((text, href))
            out.append(f"{text or '(no text)'} -> {href}")
    return out


def main():
    ap = argparse.ArgumentParser(description="Print the visible text of a page rendered in headless Chromium.")
    ap.add_argument("url")
    ap.add_argument("--click", action="append", default=[], metavar="TEXT",
                    help="click (or choose) the element with this text once the page settles; repeatable, in order")
    ap.add_argument("--links", action="store_true", help="also print every link on the page, text -> href")
    ap.add_argument("--html", action="store_true", help="print the rendered HTML instead of the visible text")
    ap.add_argument("--timeout", type=float, default=45, help="seconds allowed for the first load (default 45)")
    args = ap.parse_args()

    if not os.environ.get("PLAYWRIGHT_BROWSERS_PATH") and os.path.isdir(DEFAULT_BROWSERS):
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = DEFAULT_BROWSERS
    ensure_playwright()
    from playwright.sync_api import Error, TimeoutError, sync_playwright

    proxy = proxy_settings()  # before the driver starts: it reads the environment once
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(headless=True, proxy=proxy)
        except Error as e:
            msg = str(e).splitlines()[0]
            print(f"read_page: browser did not start: {msg}", file=sys.stderr)
            if "Executable doesn't exist" in str(e):
                print(f"read_page: playwright {PLAYWRIGHT_VERSION} expects a Chromium build that "
                      f"{os.environ.get('PLAYWRIGHT_BROWSERS_PATH')} does not hold; pin PLAYWRIGHT_VERSION "
                      "to the release matching the installed chromium-NNNN. Do not run playwright install.",
                      file=sys.stderr)
            return 2
        page = browser.new_context(user_agent=UA, locale="en-US",
                                   viewport={"width": 1366, "height": 900}).new_page()
        try:
            resp = page.goto(args.url, wait_until="domcontentloaded", timeout=args.timeout * 1000)
        except Error as e:
            msg = str(e).splitlines()[0]
            print(f"read_page: did not load {args.url}: {msg}", file=sys.stderr)
            if "Download is starting" in msg:
                print("read_page: this URL is a file, not a page; fetch it with curl -sSL -o FILE "
                      "(a PDF then reads with pdftotext FILE -)", file=sys.stderr)
            elif "ERR_CERT" in msg:
                print("read_page: the browser does not trust this network's TLS proxy; see "
                      "/root/.ccr/README.md. Never disable certificate checks.", file=sys.stderr)
            browser.close()
            return 2
        status = resp.status if resp else 0
        settle(page, SETTLE_MS, TimeoutError)

        for text in args.click:
            try:
                done = click(page, text, 10000)
            except Error as e:
                done = None
                print(f"read_page: --click {text!r} failed: {str(e).splitlines()[0]}", file=sys.stderr)
            if not done:
                print(f"read_page: nothing visible matches --click {text!r}; the page as it stands:",
                      file=sys.stderr)
                print(visible_text(page))
                browser.close()
                return 2
            settle(page, 10000, TimeoutError)
            page.wait_for_timeout(500)

        body = page.content() if args.html else visible_text(page)
        print(body)
        if args.links:
            print("\n--- links ---")
            print("\n".join(links(page)))
        print(f"read_page: HTTP {status} {page.url} ({len(body)} chars)", file=sys.stderr)
        browser.close()
        return 1 if status >= 400 else 0


if __name__ == "__main__":
    sys.exit(main())
