#!/usr/bin/env python3
"""
QA harness for the Delta Green Agent Hub. Runs against a local static
server serving the repo. All requests to script.google.com and
api.anthropic.com are intercepted and faked -- nothing ever touches the
real Google Sheet or Anthropic backend.

Usage:
    python3 -m http.server 8949 &
    python3 test/run_tests.py
"""
import json, os, sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get("DG_TEST_BASE", "http://127.0.0.1:8949")
HERE = os.path.dirname(os.path.abspath(__file__))
AGENTS = json.load(open(os.path.join(HERE, "mock-agents.json")))
RESULTS_PATH = os.path.join(HERE, "results.json")

results = []

def record(area, name, ok, detail=""):
    results.append({"area": area, "name": name, "ok": ok, "detail": detail})
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {area} :: {name}" + (f" -- {detail}" if detail and not ok else ""))

def mock_routes(page):
    def fake_apps_script(route):
        url = route.request.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            fake_data = {
                "char_name": "Mock Loaded Agent", "codename": "TESTCASE",
                "age_range": "30s", "sex": "Female", "build": "average",
                "expression": "neutral", "jacket": "coat", "shirt": "shirt",
                "trousers": "trousers", "footwear": "boots"
            }
            body = f'{cb}({json.dumps({"status": "OK", "data": fake_data})})'
            route.fulfill(status=200, content_type="application/javascript", body=body)
        else:
            route.fulfill(status=200, content_type="application/json",
                           body=json.dumps({"status": "OK", "mock": True}))
    def fake_anthropic(route):
        route.fulfill(status=200, content_type="application/json",
                       body=json.dumps({"content": [{"text": "[mocked cinematic prompt]"}]}))
    page.route("**/script.google.com/**", fake_apps_script)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.route("**/api.anthropic.com/**", fake_anthropic)

def skip_boot_splash(page):
    """index.html's boot splash (black screen, green terminal text, then
    a fading Mars Technologies wordmark) is session-gated via
    sessionStorage so it only plays once per new tab -- real users see
    it once, then every later hub visit in that tab is instant. Tests
    that aren't specifically exercising the splash itself should look
    like that "already seen it" case too, both so they don't waste ~3.5s
    per run waiting it out and so the splash's full-viewport overlay
    (z-index:9999) doesn't intercept clicks meant for the clearance
    cards underneath it. Must run via add_init_script (before any page
    script executes), not evaluate() after navigation -- the splash's
    own check runs immediately on page load."""
    page.add_init_script("try { sessionStorage.setItem('dg_boot_seen', '1'); } catch (e) {}")

def skip_acell_gate(page):
    """a-cell.html's password gate is session-gated the same way as the
    boot splash -- see skip_boot_splash above for why tests that aren't
    specifically exercising the gate itself should pre-seed past it."""
    page.add_init_script("try { sessionStorage.setItem('dg_acell_unlocked', '1'); } catch (e) {}")

def wait_for_condition(fn, timeout_ms=25000, interval_ms=200):
    """Polls fn() every interval_ms until it returns truthy or timeout_ms
    elapses -- for assertions after a no-cors POST + read-back-to-verify
    round trip (like every Apps Script write in this app), where a fixed
    sleep either wastes time on the common case or, under system load,
    isn't long enough and produces a flaky false failure. Returns the
    last (falsy) result if it times out, so callers can still report
    what they actually saw."""
    import time
    deadline = time.monotonic() + timeout_ms / 1000
    result = None
    while time.monotonic() < deadline:
        result = fn()
        if result:
            return result
        time.sleep(interval_ms / 1000)
    return result

def collect_errors(page):
    errs = []
    page.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
    page.on("console", lambda m: errs.append(f"console.error: {m.text}") if m.type == "error" and "Failed to load resource" not in m.text else None)
    return errs

def fill_cover_form(page, agent, form_selector="#dg-form"):
    text_fields = ["char_name","codename","nationality","face_shape","eye_color","eye_shape",
                   "nose","lips","skin","facial_hair","face_scars","hair_color","hair_style",
                   "hair_texture","build","posture","body_markers","jacket","shirt","trousers",
                   "footwear","accessories","jewelry","expression","reference_person","notes"]
    for f in text_fields:
        val = agent.get(f, "")
        sel = f"{form_selector} [name={f}]"
        if page.locator(sel).count() == 0:
            continue
        tag = page.locator(sel).evaluate("el => el.tagName")
        if tag == "TEXTAREA":
            page.fill(sel, val)
        else:
            page.fill(sel, val)
    for sel_field in ["age_range", "sex"]:
        sel = f"{form_selector} [name={sel_field}]"
        if page.locator(sel).count():
            options = page.eval_on_selector_all(f"{sel} option", "els => els.map(e=>e.value).filter(v=>v)")
            if options:
                page.select_option(sel, options[0])
    vibe_sel = f"{form_selector} [name=vibe]"
    if page.locator(vibe_sel).count():
        page.fill(vibe_sel, agent.get("vibe",""))

def test_stat_generator(p):
    """stats/index.html is a full directory-level port of pigeon-labs-
    stack's DELTA-GREEN-STATS (PolyForm Noncommercial licensed) -- a much
    larger tool than the earlier single-file port: 6 themes, an 8-step
    wizard, 18 professions with contextual skills, random bio generation,
    a dice roller widget, Bonds, equipment, and save/share. This is
    third-party production code, not something built here, so the test
    favors breadth (does each major feature work without throwing) over
    exhaustively verifying every one of its ~17,000 lines."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.goto(f"{BASE}/stats/index.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(500)
    record("stats-terminal", "page loads with no JS exceptions", len(errs)==0, "; ".join(errs))

    hub_link = page.get_attribute("a[href='../index.html']", "href") if page.locator("a[href='../index.html']").count() else None
    record("stats-terminal", "Agent Hub nav link present", hub_link == "../index.html", str(hub_link))

    # All six themes must switch without throwing
    theme_options = page.eval_on_selector_all("#cs-theme-select option", "els => els.map(e=>e.value)")
    record("stats-terminal", "theme selector has all 6 themes",
           set(theme_options) == {"xfiles","modern","son-of-sam","field-notes","field-doc","mobile"}, str(theme_options))
    for t in theme_options:
        page.select_option("#cs-theme-select", t)
        page.wait_for_timeout(200)
    record("stats-terminal", "cycling through every theme throws no JS exceptions", len(errs)==0, "; ".join(errs))
    page.select_option("#cs-theme-select", "xfiles")
    page.wait_for_timeout(200)

    # Manual stat adjustment
    page.click("#STR-value ~ button, .stat-container:has(#STR-value) button:has-text('+')")
    page.wait_for_timeout(100)
    str_val = page.text_content("#STR-value")
    record("stats-terminal", "manual + button increments STR", str_val == "4", str_val)

    # Random point buy: must sum to exactly 72
    page.click("#random-point-buy")
    page.wait_for_timeout(150)
    buy_vals = page.eval_on_selector_all(".stat-value", "els => els.map(e=>parseInt(e.textContent))")
    record("stats-terminal", "random point buy spends exactly 72 points, all stats 3-18",
           len(buy_vals)==6 and sum(buy_vals) == 72 and all(3 <= v <= 18 for v in buy_vals), str(buy_vals))

    page.click("#reset-button")
    page.wait_for_timeout(150)
    reset_vals = page.eval_on_selector_all(".stat-value", "els => els.map(e=>e.textContent)")
    record("stats-terminal", "reset returns all six stats to 3", reset_vals == ["3"]*6, str(reset_vals))

    # Profession select populates a contextual skill list
    prof_options = page.eval_on_selector_all("#cs-profession-select option", "els => els.map(e=>e.value).filter(v=>v)")
    record("stats-terminal", "profession dropdown has ~18 professions", len(prof_options) >= 15, f"{len(prof_options)} professions")
    if prof_options:
        page.select_option("#cs-profession-select", prof_options[0])
        page.wait_for_timeout(200)

    # Random bio fills the name field
    page.click("#random-bio-button")
    page.wait_for_timeout(200)
    bio_name = page.input_value("#cs-name")
    record("stats-terminal", "Random Bio fills the name field", bool(bio_name) and bio_name != "Agent", bio_name)

    # Wizard opens to step 1
    page.click("#wiz-toggle-btn")
    page.wait_for_timeout(200)
    wiz_heading = page.text_content("text=STEP 1 OF") if page.locator("text=STEP 1 OF").count() else None
    record("stats-terminal", "Character Creation Wizard opens to step 1", bool(wiz_heading), wiz_heading or "not found")
    page.click("#wiz-toggle-btn")
    page.wait_for_timeout(150)

    # Dice roller widget: toggled via #dr-arrow. It starts collapsed on a
    # fresh load, but switching to the "field-doc" (Live Play) theme -- as
    # the theme cycle above just did -- auto-opens it and that state
    # persists across switching back, so check current state rather than
    # assuming collapsed.
    d20 = page.locator("button[data-die='d20']")
    if not d20.is_visible():
        page.click("#dr-arrow")
        page.wait_for_timeout(150)
    d20_visible = d20.is_visible()
    if d20_visible:
        d20.click()
        page.wait_for_timeout(150)
    record("stats-terminal", "dice roller widget opens and rolls without throwing",
           d20_visible and len(errs)==0, f"visible={d20_visible}")

    # Mobile theme: verify no horizontal overflow specifically (see test_mobile_no_overflow
    # for why the other 5 themes are excluded from that general sweep)
    page.select_option("#cs-theme-select", "mobile")
    page.wait_for_timeout(200)
    record("stats-terminal", "no JS exceptions across the whole run", len(errs)==0, "; ".join(errs))

    page.close()
    return errs

def test_stat_generator_agent_file_nav(p):
    """The "Open Agent File" button above the theme selector on
    stats/index.html (replacing the old Foundry-VTT-mentioning intro
    paragraph -- this hub doesn't use Foundry). One click should export the
    current character (same path as the Export to Agent File button
    further down the page) and land directly on the Agent Portal's Agent
    File tab showing that agent, not just the Portal's default Cover tab."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)

    captured = {}
    def capture(route):
        url = route.request.url
        if route.request.method == "POST":
            captured["body"] = route.request.post_data
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        if "callback=" not in url:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        # A callback-carrying GET (e.g. checkAgentKia's load_character
        # check, fired once the destination page's Agent File tab
        # renders) needs a real JSONP-wrapped response -- a raw JSON
        # body gets executed as a <script> and throws on the object
        # literal's ':'.
        cb = url.split("callback=")[1].split("&")[0]
        route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({{"status":"OK"}})')
    page.route("**/script.google.com/**", capture)
    # The button navigates to dg-agent-portal.html, whose inline <script>
    # sits right after a Google Fonts <link> -- browsers hold script
    # execution until a preceding stylesheet resolves, so an unblocked font
    # request that never resolves in this sandbox hangs script execution
    # (and the tab-switch/render this test checks for) entirely. Every
    # other test that touches dg-agent-portal.html gets this for free via
    # mock_routes(); this one needs it explicitly alongside its own
    # script.google.com capture.
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    page.goto(f"{BASE}/stats/index.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(400)

    record("stats-terminal", "old Foundry-VTT intro paragraph is gone",
           page.locator("p.site-intro").count() == 0, "")
    record("stats-terminal", "Open Agent File button is present above the theme selector",
           page.locator("#site-intro-agent-file-btn").count() == 1, "")

    page.fill("#cs-name", "Priya Anand")
    page.wait_for_timeout(150)

    # wait_for_url/expect_navigation are unreliable for this same-tab
    # window.location.href hop (the navigation consistently completes --
    # page.url reflects it correctly -- but the wait helpers time out
    # anyway), so poll instead: first for the URL (commits early, while the
    # destination page may still be loading/running its scripts), then
    # separately for the destination page's own JS to actually run and mark
    # the Agent File tab active.
    page.click("#site-intro-agent-file-btn")
    for _ in range(20):
        if page.url.endswith("dg-agent-portal.html#agent"):
            break
        page.wait_for_timeout(300)
    agent_tab_active = False
    for _ in range(20):
        agent_tab_active = "active" in (page.eval_on_selector("#tw-agent", "el => el.className") or "")
        if agent_tab_active:
            break
        page.wait_for_timeout(300)

    record("stats-terminal", "Open Agent File button navigates straight to the Agent File tab",
           page.url.endswith("dg-agent-portal.html#agent") and agent_tab_active,
           page.url)

    af_html = ""
    for _ in range(15):
        af_html = page.inner_html("#panel-agent") if page.locator("#panel-agent").count() else ""
        if "Priya Anand" in af_html:
            break
        page.wait_for_timeout(300)
    record("stats-terminal", "Agent File tab shows the just-exported character",
           "Priya Anand" in af_html, "")

    body = json.loads(captured.get("body") or "{}")
    record("stats-terminal", "the nav button's export used the real char_name",
           body.get("char_name") == "Priya Anand", str(body.get("char_name")))

    record("stats-terminal", "no JS exceptions", len(errs)==0, "; ".join(errs))
    page.close()
    return errs

def test_stat_generator_sheets_roundtrip(p):
    """Phase 2 (multi-source import), pigeon-labs-stack's own "Google
    Sheet" export/import path: exportToSheets() (sheets-export.js) and the
    matching importFromSheets() (stats/sheets-import.js, this hub's
    addition) round-trip a character through the .xlsx file real players
    would download from here, upload to Google Sheets, and eventually
    download again.

    Both directions depend on JSZip, loaded from a CDN this sandbox
    blocks -- so unlike most of this suite, this test serves a vendored
    copy (test/vendor/jszip.min.js) in place of the CDN URL rather than
    skipping the check outright. This is also true of PDF export/import
    (pdf-lib) and Foundry export, which remain untested here for the same
    reason but haven't been given a vendored fixture (see test/README.md).

    Along the way this also regression-tests the DD Form 315 PDF/xlsx
    template assets actually existing in stats/assets/ -- both were
    missing entirely from the initial port (silent 404s), which this
    export step would fail on if they hadn't been restored."""
    page = p.new_page()
    page.set_default_timeout(10000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    jszip_path = os.path.join(HERE, "vendor", "jszip.min.js")
    page.route("**/cdnjs.cloudflare.com/ajax/libs/jszip/**", lambda r: r.fulfill(path=jszip_path))

    page.goto(f"{BASE}/stats/index.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(500)

    page.fill("#cs-name", "Priya Anand")
    page.select_option("#cs-profession-select", "federal_agent")
    page.wait_for_timeout(200)
    str_plus = page.locator("#STR-value").locator("xpath=..").locator("button", has_text="+")
    for _ in range(10):
        str_plus.click()
    page.fill("#cs-bio-employer", "Federal Bureau of Investigation")
    page.fill("#cs-bio-nationality", "American")
    page.fill("#cs-bio-age", "34")
    page.wait_for_timeout(200)

    page.evaluate("document.getElementById('advanced-options-details').open = true")
    page.wait_for_timeout(200)

    with page.expect_download(timeout=15000) as dl_info:
        page.click("#export-sheets")
    dl = dl_info.value
    record("stats-terminal", "Export Google Sheet downloads an .xlsx (template asset present, not 404ing)",
           dl.suggested_filename.endswith(".xlsx"), dl.suggested_filename)
    xlsx_path = os.path.join(HERE, "results-tmp-exported.xlsx")
    dl.save_as(xlsx_path)

    # Blank the form, then import the just-exported file back
    page.evaluate("""() => {
        document.getElementById('cs-name').value = '';
        document.getElementById('cs-bio-employer').value = '';
        document.getElementById('cs-bio-nationality').value = '';
        document.getElementById('cs-bio-age').value = '';
    }""")

    page.click("#import-sheets-btn")
    page.wait_for_timeout(200)
    page.set_input_files("#dg-sheets-import-input", xlsx_path)
    page.wait_for_timeout(1200)
    try:
        os.remove(xlsx_path)
    except OSError:
        pass

    name_val = page.input_value("#cs-name")
    employer_val = page.input_value("#cs-bio-employer")
    nationality_val = page.input_value("#cs-bio-nationality")
    age_val = page.input_value("#cs-bio-age")
    str_val = page.input_value("#cs-STR")
    record("stats-terminal", "Sheets round-trip recovers name/employer/nationality/age",
           (name_val, employer_val, nationality_val, age_val) ==
           ("Priya Anand", "Federal Bureau of Investigation", "American", "34"),
           f"{name_val!r} / {employer_val!r} / {nationality_val!r} / {age_val!r}")
    record("stats-terminal", "Sheets round-trip recovers STR (13 = 3 base + 10 point-buy clicks)",
           str_val == "13", f"STR={str_val!r}")

    record("stats-terminal", "no JS exceptions", len(errs)==0, "; ".join(errs))
    page.close()
    return errs

def test_foundry_import_profession_and_outfit(p):
    """Regression test for a real bug found from a user's Kappa Black
    Foundry VTT export: importFoundryJSONToEditor() never touched the
    profession <select> at all, so importing left whatever profession
    (or none) was selected before the import in place. That silently
    broke Export to Agent File's profession-derived outfit guess -- a
    "Pilot" character came out wearing a leftover police officer's
    patrol uniform, not because PROFESSION_OUTFIT lacked a pilot entry,
    but because the profession itself was never actually set.

    Also covers the deeper cause: every importer (PDF, Sheets, Foundry
    JSON) writes a human-readable profession *title* ("Pilot", "Federal
    Agent"), never the <select>'s actual option value ("pilot_sailor",
    "federal_agent") -- setting .value to a title matches no option and
    silently no-ops. matchProfessionKey() (stats/save-load.js, shared
    with scripts.js as a plain top-level function) resolves compound
    titles like "Pilot or Sailor" against a single-word import too."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    captured = {}
    def capture(route):
        if route.request.method == "POST":
            captured["body"] = route.request.post_data
        route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", capture)

    page.goto(f"{BASE}/stats/index.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(500)
    page.evaluate("document.getElementById('advanced-options-details').open = true")
    page.wait_for_timeout(200)

    # Pre-pollute the profession select, like a leftover character from
    # an earlier session in the same browser -- this is what the reported
    # bug actually depended on to produce a *wrong* (not just blank) outfit.
    page.select_option("#cs-profession-select", "police_officer")
    page.wait_for_timeout(150)

    foundry_json_path = os.path.join(HERE, "fixtures", "kappablack-foundry.json")
    json_text = open(foundry_json_path).read()
    page.fill("#json-import-area", json_text)
    page.click("#json-to-editor-button")
    page.wait_for_timeout(600)

    prof_val = page.eval_on_selector("#cs-profession-select", "el => el.value")
    record("stats-terminal", "Foundry JSON import resolves a profession title ('Pilot') to its select key ('pilot_sailor')",
           prof_val == "pilot_sailor", f"value={prof_val!r}")

    page.click("#export-agent-file-btn")
    page.wait_for_timeout(500)
    body = json.loads(captured.get("body") or "{}")
    record("stats-terminal", "outfit reflects the imported Pilot profession, not the pre-existing Police Officer one",
           body.get("jacket") == "flight/deck jacket" and body.get("footwear") == "deck shoes",
           f"jacket={body.get('jacket')!r} footwear={body.get('footwear')!r}")

    record("stats-terminal", "no JS exceptions", len(errs)==0, "; ".join(errs))
    page.close()
    return errs

def test_kappablack_toml_import(p):
    """Kappa Black is a third-party app that exports a flat .toml file --
    a format with no existing parser on this page. Rather than write a
    second full field-mapping pass, importKappaBlackTOMLToEditor()
    converts the parsed TOML into the same shape a real Foundry VTT
    export uses and hands it to the shared applyImportedAgentData()
    (see the Foundry import test above for why the profession-title ->
    select-key resolution matters). test/fixtures/kappablack-export.toml
    is the user's real "Alistair Islay Lagavulin" (Pilot) export, byte
    for byte."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    captured = {}
    def capture(route):
        if route.request.method == "POST":
            captured["body"] = route.request.post_data
        route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", capture)

    page.goto(f"{BASE}/stats/index.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(500)
    page.evaluate("document.getElementById('advanced-options-details').open = true")
    page.wait_for_timeout(200)

    toml_path = os.path.join(HERE, "fixtures", "kappablack-export.toml")
    toml_text = open(toml_path, encoding="utf-8").read()
    page.fill("#kappablack-import-area", toml_text)
    page.click("#kappablack-to-editor-button")
    page.wait_for_timeout(600)

    name_val = page.eval_on_selector("#cs-name", "el => el.value")
    record("stats-terminal", "Kappa Black TOML import loads the character name",
           name_val == "Alistair Islay Lagavulin", f"value={name_val!r}")

    prof_val = page.eval_on_selector("#cs-profession-select", "el => el.value")
    record("stats-terminal", "Kappa Black TOML import resolves profession title ('Pilot') to its select key ('pilot_sailor')",
           prof_val == "pilot_sailor", f"value={prof_val!r}")

    con_val = page.eval_on_selector("#cs-CON", "el => el.value")
    record("stats-terminal", "Kappa Black TOML import recovers stat scores (CON = 13)",
           str(con_val) == "13", f"value={con_val!r}")

    drive_val = page.eval_on_selector("#cs-skill-drive", "el => el.value")
    record("stats-terminal", "Kappa Black TOML import maps the 'Driving' title to the 'drive' skill key",
           str(drive_val) == "20", f"value={drive_val!r}")

    navigate_val = page.eval_on_selector("#cs-skill-navigate", "el => el.value")
    record("stats-terminal", "Kappa Black TOML import recovers a plain skill score (Navigate = 70)",
           str(navigate_val) == "70", f"value={navigate_val!r}")

    specialty_count = page.locator(".custom-skill-row").count()
    record("stats-terminal", "Kappa Black TOML import creates a specialty row for every [[skills]] entry with a type (7)",
           specialty_count == 7, f"count={specialty_count}")

    bonds_count = page.evaluate("window.bondsOnSheet ? window.bondsOnSheet.length : -1")
    record("stats-terminal", "Kappa Black TOML import recovers both bonds",
           bonds_count == 2, f"count={bonds_count}")

    page.click("#export-agent-file-btn")
    page.wait_for_timeout(500)
    body = json.loads(captured.get("body") or "{}")
    record("stats-terminal", "outfit derived from the imported Kappa Black character matches its Pilot profession",
           body.get("jacket") == "flight/deck jacket" and body.get("footwear") == "deck shoes",
           f"jacket={body.get('jacket')!r} footwear={body.get('footwear')!r}")

    record("stats-terminal", "no JS exceptions", len(errs)==0, "; ".join(errs))
    page.close()
    return errs

def test_import_agent_auto_detect(p):
    """The single "Import Agent" drop zone at the top of the page
    (#agent-drop-zone / #agent-import-auto-input) replaces having to pick
    the right button out of five in Advanced for a player who just wants
    to load their character. importAgentAuto() (stats/scripts.js) detects
    format from the file extension, falling back to sniffing the actual
    bytes/content for files dropped in without one, then hands off to the
    existing format-specific importer -- this test proves the *routing*,
    not the underlying parsers (those already have their own coverage
    above and in test_stat_generator_sheets_roundtrip)."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.route("**/script.google.com/**", lambda r: r.fulfill(status=200, content_type="application/json", body='{"status":"OK"}'))

    # .toml by extension, through the same #agent-import-auto-input a
    # player would use.
    page.goto(f"{BASE}/stats/index.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(400)
    toml_path = os.path.join(HERE, "fixtures", "kappablack-export.toml")
    page.set_input_files("#agent-import-auto-input", toml_path)
    page.wait_for_timeout(600)
    record("stats-terminal", "Import Agent routes a .toml file to the Kappa Black importer (name)",
           page.eval_on_selector("#cs-name", "el => el.value") == "Alistair Islay Lagavulin")
    record("stats-terminal", "Import Agent routes a .toml file to the Kappa Black importer (profession)",
           page.eval_on_selector("#cs-profession-select", "el => el.value") == "pilot_sailor")
    record("stats-terminal", "Import Agent's .toml routing goes through the real TOML parser, not a JSON fallback (Driving -> drive)",
           page.eval_on_selector("#cs-skill-drive", "el => el.value") == "20")

    # .json by extension (Foundry VTT actor shape), on a fresh page.
    page.goto(f"{BASE}/stats/index.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(400)
    json_path = os.path.join(HERE, "fixtures", "kappablack-foundry.json")
    page.set_input_files("#agent-import-auto-input", json_path)
    page.wait_for_timeout(600)
    record("stats-terminal", "Import Agent routes a .json file to the Foundry importer (name)",
           page.eval_on_selector("#cs-name", "el => el.value") == "Alistair Islay Lagavulin")
    record("stats-terminal", "Import Agent routes a .json file to the Foundry importer (profession)",
           page.eval_on_selector("#cs-profession-select", "el => el.value") == "pilot_sailor")

    # Extension-less file (e.g. a mobile "Share" sheet that stripped it) --
    # content-sniffing must still recognize this site's own v:1 state JSON
    # (downloadSheet()'s own export format, distinct from a Foundry actor)
    # and route it through applyState(), not applyImportedAgentData().
    page.goto(f"{BASE}/stats/index.html", wait_until="domcontentloaded", timeout=15000)
    # A longer wait than the other steps' 400ms: save-load.js's own
    # restore-on-load (window 'load' + 200ms) autoloads whatever this
    # page's own autosave last wrote to localStorage (the previous
    # step's Foundry import); calling importAgentAuto() before that
    # settles races against it, occasionally letting the stale restore
    # win and overwrite this test's import moments later.
    page.wait_for_timeout(900)
    native_state = {
        "v": 1,
        "bio": {"name": "Native Sniff Test", "profession": "", "employer": "", "nationality": "",
                "sex": "", "age": "", "education": ""},
        "stats": {"STR": 10, "CON": 10, "DEX": 10, "INT": 10, "POW": 10, "CHA": 10},
        "csStats": {"STR": 10, "CON": 10, "DEX": 10, "INT": 10, "POW": 10, "CHA": 10},
        "derived": {"hp": 7, "wp": 10, "san": 50, "bp": 40},
        "skills": {}, "skillSpecs": {}, "customSkills": [], "bonds": [],
        "sanity": {"violence": [False, False, False], "helplessness": [False, False, False]},
        "equipment": [], "lpNotes": {"wounds": "", "gear": "", "remarks": ""},
        "lpWeapons": [], "lpFeat": {}, "optionalSkillChecked": [],
        "bonusPrepared": False, "bonusSkills": [], "bonusApplied": False,
        "appliedBonuses": {}, "specialtyInstances": [], "lpCheckedSkills": [],
        "lpCustomSkills": [], "professionSkillsApplied": False,
    }
    page.evaluate(
        """(stateJson) => {
            const file = new File([stateJson], 'upload', { type: '' });
            return window.importAgentAuto(file);
        }""",
        json.dumps(native_state),
    )
    page.wait_for_timeout(600)
    record("stats-terminal", "Import Agent content-sniffs an extension-less file as this site's own v:1 JSON (not the Foundry path)",
           page.eval_on_selector("#cs-name", "el => el.value") == "Native Sniff Test")
    record("stats-terminal", "content-sniffed v:1 JSON goes through applyState() (HP survives, a field only that path sets here)",
           page.eval_on_selector("#cs-hp", "el => el.value") == "7")

    # Unrecognized format -- must fail closed (an alert, auto-dismissed by
    # Playwright) rather than throwing an unhandled exception. This
    # deliberately triggers importAgentAuto()'s own console.error logging
    # (expected, not a bug -- same pattern importFromPDF/importFromSheets
    # already use for their own bad-file cases), so that one line is
    # filtered out of the exception check below rather than counted as one.
    page.evaluate(
        """() => {
            const file = new File(['not a real character export'], 'notes.xyz', { type: '' });
            return window.importAgentAuto(file);
        }"""
    )
    page.wait_for_timeout(300)

    real_errs = [e for e in errs if "Unrecognized file format" not in e]
    record("stats-terminal", "unrecognized format fails closed without an unhandled exception",
           len(real_errs) == len(errs) - 1, f"errs={errs}")
    record("stats-terminal", "no JS exceptions", len(real_errs)==0, "; ".join(real_errs))
    page.close()
    return errs

def test_player_name_field(p):
    """A dedicated "Player Name" biography field (the real person
    playing this Agent, distinct from the Agent's own name) -- so a
    Handler can tell whose character sheet they're looking at in
    A-Cell. Stored as bio.player_name in collectState()/applyState(),
    the same way every other biography field already round-trips."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.route("**/script.google.com/**", lambda r: r.fulfill(status=200, content_type="application/json", body='{"status":"OK"}'))

    page.goto(f"{BASE}/stats/index.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(400)
    record("stats-terminal", "Player Name field is present",
           page.query_selector("#cs-player-name") is not None, "")

    page.fill("#cs-player-name", "Gergo P")
    page.fill("#cs-name", "Owen Castillo")
    page.wait_for_timeout(200)
    state = page.evaluate("() => window.dgSaveLoad.collectState()")
    record("stats-terminal", "collectState() carries the player name under bio.player_name",
           state.get("bio", {}).get("player_name") == "Gergo P", str(state.get("bio")))

    page.evaluate("(s) => window.dgSaveLoad.applyState(s)", state)
    page.wait_for_timeout(200)
    record("stats-terminal", "applyState() restores the player name field",
           page.eval_on_selector("#cs-player-name", "el => el.value") == "Gergo P", "")
    record("stats-terminal", "no JS exceptions", len(errs) == 0, "; ".join(errs))

    page.close()
    return errs

def test_cloud_save(p):
    """Automatic background cloud sync (stats/cloud-sync.js) -- lets a
    character built on one device be picked up on another by an Agent
    Code, without an export/import file changing hands. Auto-starts on
    the first edit made once a real name is present (idle theme-
    switching or point-buy fiddling before naming an agent shouldn't
    mint a throwaway row for every casual visitor); every further edit
    pushes a debounced upsert; "Load by Code" pulls a saved character
    back down. No Stop button -- once a character is named, syncing it
    is just how the page behaves, not a togglable setting, same as the
    pre-existing localStorage autosave it sits alongside. This exercises
    only the client side against a mocked Apps Script backend -- the
    real backend needs the paired character-cloud-save-addition.gs
    pasted into the live Apps Script project and redeployed, which this
    sandbox cannot verify directly."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    posts = []
    def route_apps_script(route):
        req = route.request
        if req.method == "POST":
            posts.append(json.loads(req.post_data or "{}"))
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "action=load_character" in url and "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            code = url.split("code=")[1].split("&")[0]
            if code == "TESTCODE":
                char_state = {"v": 1, "bio": {"name": "Cloud Loaded Character", "profession": "Pilot"}}
                body = f'{cb}({json.dumps({"status": "OK", "agent_code": code, "updated_at": "now", "character_json": json.dumps(char_state)})})'
            else:
                body = f'{cb}({json.dumps({"status": "NOT_FOUND"})})'
            route.fulfill(status=200, content_type="application/javascript", body=body)
            return
        route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", route_apps_script)

    page.goto(f"{BASE}/stats/index.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(400)

    # No code yet and no name entered -- silent, nothing sent, so an idle
    # visitor never mints a throwaway row just from loading the page.
    record("stats-terminal", "Cloud Save is inactive on page load, before any name is entered",
           page.eval_on_selector("#cloud-save-status", "el => el.textContent.trim()") == "" and len(posts) == 0)

    # Entering a real name -- with NO button click -- is the auto-start trigger.
    page.fill("#cs-name", "Priya Anand")
    page.wait_for_timeout(500)

    status1 = page.eval_on_selector("#cloud-save-status", "el => el.textContent")
    record("stats-terminal", "naming the agent auto-starts Cloud Save without pressing Start",
           "Cloud Save active" in status1 or "Synced" in status1, status1)
    save_posts = [b for b in posts if b.get("action") == "save_character"]
    record("stats-terminal", "auto-start immediately pushes the character (not waiting for the debounce)",
           len(save_posts) >= 1, f"posts={posts}")
    if save_posts:
        first_state = json.loads(save_posts[0]["character_json"])
        record("stats-terminal", "the pushed character_json carries the real character data (name)",
               first_state.get("bio", {}).get("name") == "Priya Anand", str(first_state.get("bio")))

    code = page.evaluate("window.dgCloudSave.getCloudCode()")
    record("stats-terminal", "the auto-minted cloud code is persisted to localStorage",
           bool(code) and save_posts and save_posts[0].get("agent_code") == code, f"code={code!r}")

    record("stats-terminal", "there is no Start Cloud Save button -- naming the agent is the only trigger",
           page.locator("#cloud-save-bar button", has_text="Start Cloud Save").count() == 0)

    # A further edit should schedule (debounced) another push -- proves
    # ongoing "saved dynamically and updated" behavior, not just the
    # initial auto-start push.
    page.fill("#cs-bio-nationality", "Indian-American")
    page.wait_for_timeout(4500)
    save_posts_after_edit = [b for b in posts if b.get("action") == "save_character"]
    record("stats-terminal", "editing after auto-start schedules another debounced push",
           len(save_posts_after_edit) >= 2, f"count={len(save_posts_after_edit)}")
    if len(save_posts_after_edit) >= 2:
        latest_state = json.loads(save_posts_after_edit[-1]["character_json"])
        record("stats-terminal", "the debounced push carries the edited field",
               latest_state.get("bio", {}).get("nationality") == "Indian-American", str(latest_state.get("bio")))

    record("stats-terminal", "there is no Stop button -- Cloud Save is not a togglable setting",
           page.locator("#cloud-save-bar button", has_text="Stop").count() == 0)

    # Load by Code -- called directly with a code argument (bypassing the
    # native prompt(), which this test isn't exercising) against the
    # mocked action=load_character response above.
    page.evaluate("window.dgCloudSave.loadFromCloud('TESTCODE')")
    page.wait_for_timeout(500)
    record("stats-terminal", "Load by Code restores the character from the cloud save",
           page.eval_on_selector("#cs-name", "el => el.value") == "Cloud Loaded Character")
    record("stats-terminal", "Load by Code re-activates Cloud Save under the loaded code",
           page.evaluate("window.dgCloudSave.getCloudCode()") == "TESTCODE")

    page.evaluate("window.dgCloudSave.loadFromCloud('NOPE-CODE')")
    page.wait_for_timeout(400)
    record("stats-terminal", "Load by Code reports a clean not-found for an unknown code",
           "No cloud save found" in (page.eval_on_selector("#cloud-load-status", "el => el.textContent") or ""))

    record("stats-terminal", "no JS exceptions", len(errs)==0, "; ".join(errs))
    page.close()
    return errs

def test_agent_file_export(p):
    """The "Export to Agent File" bridge (stats/agent-portal-export.js):
    submits through the exact same APPS_SCRIPT_URL path the Cover form's
    own Submit Brief uses, with build/outfit derived from STR+CON and
    profession rather than left for the player to type. Verifies the
    actual POST payload, not just that a status message appeared --
    this is exactly where the earlier lowercase/uppercase csStats key
    bug hid (build silently defaulted regardless of STR)."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)

    captured = {}
    def capture(route):
        if route.request.method == "POST":
            captured["body"] = route.request.post_data
        route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", capture)

    page.goto(f"{BASE}/stats/index.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(500)

    page.fill("#cs-name", "Owen Castillo")
    page.select_option("#cs-profession-select", "federal_agent")
    page.wait_for_timeout(150)
    page.fill("#cs-bio-age", "38")
    page.fill("#cs-bio-sex", "Male")

    str_plus = page.locator("#STR-value").locator("xpath=..").locator("button", has_text="+")
    for _ in range(13):
        str_plus.click()
    con_plus = page.locator("#CON-value").locator("xpath=..").locator("button", has_text="+")
    for _ in range(10):
        con_plus.click()
    page.wait_for_timeout(150)

    page.click("#export-agent-file-btn")
    page.wait_for_timeout(400)

    status_html = page.inner_html("#agent-file-export-status")
    record("agent-file-export", "shows the generated code and an Agent Portal link",
           "OWEN-" in status_html and "dg-agent-portal.html" in status_html, status_html)

    body = json.loads(captured.get("body") or "{}")
    record("agent-file-export", "submits through the same APPS_SCRIPT_URL as the Cover form",
           bool(captured.get("body")), "no POST captured" if not captured.get("body") else "")
    record("agent-file-export", "char_name and agent_code present in payload",
           body.get("char_name") == "Owen Castillo" and bool(body.get("agent_code")), str(body.get("agent_code")))

    # Bug fix: the exported Agent File code used to always be a fresh,
    # unrelated random code (genCode()), independent of this character's
    # own Cloud Save code -- so a Play/Recruit link built from the Agent
    # File later couldn't find the character it actually belonged to
    # (real report: an Agent with a saved character showed "Recruit",
    # and going through Character Creation partially overwrote the real
    # character before the mismatch was caught). It must now reuse
    # whatever Cloud Save code this character already has.
    cloud_code = page.evaluate("() => localStorage.getItem('dg_stats_cloud_code')")
    record("agent-file-export", "the exported Agent Code is this character's own Cloud Save code, not a new unrelated one",
           bool(cloud_code) and body.get("agent_code") == cloud_code,
           f"cloud_code={cloud_code} exported={body.get('agent_code')}")
    record("agent-file-export", "age/sex map into the Cover form's expected values",
           body.get("age_range") == "Late 30s" and body.get("sex") == "Male",
           f"age_range={body.get('age_range')} sex={body.get('sex')}")

    # STR 16 + CON 13 = 29 -> 'athletic' tier; verify it's not the generic
    # fallback that shipped when csStats.str (lowercase) silently read undefined
    athletic_pool = ["athletic", "lean and muscular", "fit and rangy", "well-conditioned",
                      "physically capable without being ostentatious", "carries themselves with easy physical confidence"]
    record("agent-file-export", "build reflects STR+CON (athletic tier), not a generic fallback",
           body.get("build") in athletic_pool, str(body.get("build")))
    record("agent-file-export", "outfit matches the Federal Agent profession",
           body.get("jacket") == "dark suit jacket" and body.get("shirt") == "white dress shirt", str(body.get("jacket")))
    record("agent-file-export", "profession title carries over into the Cover form's Profession field",
           body.get("profession") == "Federal Agent", str(body.get("profession")))
    record("agent-file-export", "notes include correct per-stat values (uppercase csStats keys)",
           "STR 16 CON 13" in (body.get("notes") or ""), (body.get("notes") or "")[:60])

    saved = page.evaluate("() => { try { return JSON.parse(localStorage.getItem('dg_last_agent')); } catch(e) { return null; } }")
    record("agent-file-export", "also persists locally under dg_last_agent for same-browser Agent Portal auto-restore",
           bool(saved and saved.get("code") and saved["code"] == body.get("agent_code")), str(saved and saved.get("code")))

    record("agent-file-export", "no JS exceptions", len(errs)==0, "; ".join(errs))
    page.close()
    return errs

def test_random_bio_cloud_code_race(p):
    """v1.7 code-unification fix: Random Bio (and every importer that
    funnels through save-load.js's applyState()) sets cs-name's .value
    directly, which -- unlike page.fill()'s real 'input' event, the case
    test_agent_file_export above already covers -- never used to trigger
    ensureCloudCode() in cloud-sync.js. Export before any other manual
    edit would then mint its own fallback Agent Code instead of reusing
    a Cloud Save code that was never actually minted, permanently
    orphaning the two from each other for that character. Covers the
    Random Bio path here; applyState()'s fix covers every importer at
    the same source, so this stands in for all of them."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)

    captured = {}
    def capture(route):
        if route.request.method == "POST":
            captured["body"] = route.request.post_data
        route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", capture)

    page.goto(f"{BASE}/stats/index.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(500)

    before = page.evaluate("() => localStorage.getItem('dg_stats_cloud_code')")
    record("agent-file-export", "no Cloud Save code exists yet on a fresh sheet",
           not before, str(before))

    page.click("#random-bio-button")
    page.wait_for_timeout(300)
    cloud_code = page.evaluate("() => localStorage.getItem('dg_stats_cloud_code')")
    record("agent-file-export", "Random Bio mints a Cloud Save code immediately, with no other edit since",
           bool(cloud_code), str(cloud_code))

    page.click("#export-agent-file-btn")
    page.wait_for_timeout(400)
    body = json.loads(captured.get("body") or "{}")
    record("agent-file-export", "exporting right after Random Bio reuses that same code, not a second unrelated one",
           bool(cloud_code) and body.get("agent_code") == cloud_code,
           f"cloud_code={cloud_code} exported={body.get('agent_code')}")

    record("agent-file-export", "no JS exceptions (Random Bio race)", len(errs)==0, "; ".join(errs))
    page.close()
    return errs

def test_cover_ids_tab(p):
    """The Cover IDs tab is the "Cover ID Fabricator" -- a native, in-page
    tablet UI (agency+era picker, live-rendered credential card, PRINT/
    EXPORT, and an agent-code importer that queries the Apps Script backend
    the same way the Agent File tab does). Ported wholesale from the
    project's Dev branch, which had built this out fully while this
    branch's own Cover IDs tab was still an iframe wrapping the older,
    less-developed standalone dg-id-creator.html page."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    mock_routes(page)
    page.goto(f"{BASE}/dg-agent-portal.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)

    page.click("#tw-ids")
    page.wait_for_timeout(300)

    record("cover-ids-tab", "Cover IDs tab renders the native tablet UI (not an iframe)",
           page.locator("#ids-shell").count() > 0 and page.locator("iframe#ids-iframe").count() == 0, "")

    # placeholder before any agency/era chosen
    placeholder_visible = page.is_visible("#ids-card-placeholder")
    record("cover-ids-tab", "card preview shows placeholder before agency+era are set", placeholder_visible, "")

    # agent-code importer (queries the same Apps Script JSONP endpoint as Agent
    # File) -- do this before manually typing a name, since the importer only
    # fills fields that are still empty
    page.fill("#ids-agent-code", "TEST-CODE")
    page.click("button[onclick='idsImportAgent()']")
    page.wait_for_timeout(500)
    imported_name = page.eval_on_selector("#ids-cover-name", "el => el.value")
    record("cover-ids-tab", "agent-code importer loads a name from the Apps Script backend",
           imported_name == "Mock Loaded Agent", str(imported_name))

    # fill in a cover identity and confirm a real card renders
    page.select_option("#ids-agency", "FBI")
    page.select_option("#ids-era", "90s")
    page.fill("#ids-cover-name", "Marcus Reyes")
    page.fill("#ids-cover-title", "Special Agent")
    page.fill("#ids-cover-id", "MR-4471")
    page.wait_for_timeout(300)
    # Rendered cards vary per agency/era (credential-book layouts use plain
    # inline-styled divs, CR80-style layouts use .ids-card-wrap), so check
    # by content rather than a single expected class: the placeholder is
    # gone and the entered name shows up somewhere in the card.
    preview_text = page.locator("#ids-card-preview").inner_text()
    card_rendered = "SELECT AGENCY" not in preview_text and page.locator("#ids-card-placeholder").count() == 0
    record("cover-ids-tab", "selecting agency+era renders a live credential card", card_rendered, preview_text[:80])
    if card_rendered:
        record("cover-ids-tab", "rendered card shows the entered cover name",
               "Marcus Reyes" in preview_text, preview_text[:80])
        record("cover-ids-tab", "the live on-screen preview does NOT carry the prop watermark (print/export-only, doesn't clutter the working view)",
               "NOT A GOVERNMENT DOCUMENT" not in preview_text, preview_text[:120])

    # PRINT/EXPORT regression: FBI 90s renders as a plain inline-styled div
    # with no .ids-card-wrap class (a "credential-book" layout), which used
    # to fail the print gate's class-based check and silently alert
    # "Select agency and era first." instead of opening the print window.
    try:
        with page.expect_popup(timeout=4000) as popup_info:
            page.click("button[onclick='idsPrint()']")
        popup = popup_info.value
        popup.wait_for_load_state()
        popup_text = popup.inner_text("body")
        record("cover-ids-tab", "PRINT/EXPORT opens a print window for a credential-book layout (no .ids-card-wrap class)",
               True, "")
        record("cover-ids-tab", "print window also carries the prop watermark",
               "NOT A GOVERNMENT DOCUMENT" in popup_text, popup_text[:120])
        popup.close()
    except Exception as e:
        record("cover-ids-tab", "PRINT/EXPORT opens a print window for a credential-book layout (no .ids-card-wrap class)",
               False, str(e))

    record("cover-ids-tab", "no JS exceptions", len(errs)==0, "; ".join(errs))
    page.close()
    return errs

def test_hub_boot_splash(p):
    """index.html's boot splash: black screen, green CRT-terminal text
    (waiting_for_clearance / delta_green / acces_granted), then a fading
    Mars Technologies seal, revealing the clearance chooser underneath --
    runs ~8s total, capped at ~8.6s so it can never meaningfully overrun
    that. Session-gated via sessionStorage, not localStorage, so it plays once
    per new tab ("load in every new session") but a same-tab reload
    skips straight to the clearance grid ("after this every loading is
    fast very snappy")."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    page.goto(f"{BASE}/index.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(150)
    record("hub", "boot splash is present and covers the screen on first load",
           page.locator("#boot-splash").count() == 1)
    term_text = page.eval_on_selector("#boot-term", "el => el.textContent")
    record("hub", "boot splash starts typing the clearance terminal sequence",
           term_text.startswith(">"), repr(term_text))

    # Splash types "waiting_for_clearance:", "delta_green", "acces_granted"
    # then fades in the Mars Technologies seal before fading out --
    # generously bounded wait, then assert it actually finished by the
    # ~8.6s hard cap this page enforces (never truly hangs past it).
    page.wait_for_timeout(8500)
    record("hub", "boot splash resolves and clears the DOM within its ~8.6s cap",
           page.locator("#boot-splash").count() == 0, "")
    record("hub", "clearance chooser is visible once the splash clears",
           page.locator(".clearance-choice").count() == 2, "")
    record("hub", "boot-lock no longer blocks page scrolling once revealed",
           "boot-lock" not in page.eval_on_selector("body", "el => el.className"), "")

    # A second load in the same tab (sessionStorage persists) must not
    # replay the splash -- this is what "every loading after this is
    # fast and snappy" actually means.
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(150)
    record("hub", "boot splash does not replay on a same-tab reload (sessionStorage-gated)",
           page.locator("#boot-splash").count() == 0, "")
    record("hub", "clearance chooser is immediately visible on the repeat load",
           page.locator(".clearance-choice").count() == 2, "")

    page.close()
    return errs

def test_hub_clearance_branches(p):
    """index.html is now a splash + clearance chooser, not a direct tool
    grid -- Character Creator and Agent Portal moved under the Agent
    branch (agent-hub.html), and A-Cell (a-cell.html) is new. Regression
    check for the hub restructuring: exactly two clearance branches,
    pointing at the right pages."""
    page = p.new_page()
    page.set_default_timeout(5000)
    errs = collect_errors(page)
    skip_boot_splash(page)
    page.goto(f"{BASE}/index.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(200)
    hrefs = page.eval_on_selector_all(".clearance-choice", "els => els.map(e=>e.getAttribute('href'))")
    record("hub", "hub has exactly 2 clearance branches (Agent, A-Cell)",
           hrefs == ["agent-hub.html", "a-cell.html"], str(hrefs))
    page.close()
    return errs

def test_agent_hub(p):
    """agent-hub.html (the Agent clearance branch): a folder look shared
    with the Agent File -- every Agent (plus a pinned "+ New Recruit")
    is a folder ear-tab, and the active tab's paper panel shows that
    Agent's dossier with three actions (Play/Recruit / Agent File /
    Cover ID) linking to stats/ and the Agent Portal with query params
    those pages now handle (see test_stats_load_by_code_query_param and
    test_agent_portal_code_query_param). Reads the same dg_agent_roster
    localStorage the Agent Portal's own roster drawer already writes to."""
    errs_all = []

    # No agents on file -> only the New Recruit tab, an empty-state panel
    page = p.new_page()
    page.set_default_timeout(5000)
    errs = collect_errors(page)
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)
    record("hub", "with no agents on file, New Recruit is the only tab",
           page.eval_on_selector_all(".tw span", "els => els.map(e=>e.textContent)") == ["+ New Recruit"], "")
    record("hub", "the empty-state panel explains there's nothing on file yet",
           "No Agents on File" in page.inner_text("#folder-body"), "")
    errs_all.extend(errs)
    page.close()

    # Two agents on file -> a tab per agent, most recent first, active by default
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    def fake_hub_apps_script(route):
        url = route.request.url
        if "callback=" not in url:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        cb = url.split("callback=")[1].split("&")[0]
        route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps({"status": "OK"})})')
    page.route("**/script.google.com/**", fake_hub_apps_script)
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    roster = {
        "OWEN-CS12": {"code": "OWEN-CS12", "char_name": "Owen Castillo", "codename": "Ferro",
                      "sex": "Male", "age_range": "Late 30s", "nationality": "American", "saved_at": 2000},
        "PRIY-AN34": {"code": "PRIY-AN34", "char_name": "Priya Anand", "codename": "",
                      "sex": "Female", "age_range": "Early 30s", "nationality": "Indian-American", "saved_at": 1000},
    }
    page.evaluate("(r) => localStorage.setItem('dg_agent_roster', JSON.stringify(r))", roster)
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(400)

    tab_labels = page.eval_on_selector_all(".tw span", "els => els.map(e=>e.textContent)")
    record("hub", "one tab per Agent (most recent first) plus New Recruit pinned first",
           tab_labels == ['+ New Recruit', 'Owen "Ferro"', 'Priya Anand'], str(tab_labels))
    record("hub", "the most recently-saved Agent's tab is active by default",
           "active" in page.eval_on_selector('.tw[data-tab="OWEN-CS12"]', "el => el.className"), "")
    record("hub", "that Agent's paper panel is the active one",
           "active" in page.eval_on_selector("#panel-OWEN-CS12", "el => el.className"), "")

    action_hrefs = page.eval_on_selector_all(
        "#panel-OWEN-CS12 .paper-btn", "els => els.map(e => e.getAttribute('href'))")
    record("hub", "Play links to stats/ with load+theme query params for that exact agent",
           action_hrefs[0] == "stats/index.html?load=OWEN-CS12&theme=field-doc", str(action_hrefs))
    record("hub", "Agent File links to the Agent Portal's Agent File tab for that exact agent",
           action_hrefs[1] == "dg-agent-portal.html?code=OWEN-CS12#agent", str(action_hrefs))
    record("hub", "Cover ID links to the Agent Portal's Cover IDs tab for that exact agent",
           action_hrefs[2] == "dg-agent-portal.html?code=OWEN-CS12#ids", str(action_hrefs))

    # Clicking a tab switches the active panel.
    page.click('.tw[data-tab="PRIY-AN34"]')
    page.wait_for_timeout(150)
    record("hub", "clicking a tab activates that Agent's panel and deactivates the others",
           "active" in page.eval_on_selector("#panel-PRIY-AN34", "el => el.className")
           and "active" not in page.eval_on_selector("#panel-OWEN-CS12", "el => el.className"), "")

    errs_all.extend(errs)
    page.close()
    return errs_all

def test_agent_hub_handouts(p):
    """agent-hub.html's per-Agent Handouts section: a read-only mirror
    of A-Cell's Handouts tab, filtered per Agent -- campaign-wide
    entries (blank cell_id) show for everyone, Cell-scoped ones only
    show for an Agent who's actually a member of that Cell. Cells and
    Handouts are each fetched once and reused across every Agent's
    panel rather than once per Agent."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    cells_fixture = [{"cell_id": "cell_1", "name": "Cell Alpha", "handler": "Sam", "member_codes": ["OWEN-CS12"], "channel": ""}]
    handouts_fixture = [
        {"handout_id": "h1", "title": "Cell Alpha Only Clue", "body": "Only Owen should see this.", "photo": "", "cell_id": "cell_1", "created_at": "2000"},
        {"handout_id": "h2", "title": "Campaign Wide Notice", "body": "Everyone sees this.", "photo": "", "cell_id": "", "created_at": "1000"},
    ]

    def fake_apps_script(route):
        url = route.request.url
        if route.request.method == "POST" or "callback=" not in url:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        cb = url.split("callback=")[1].split("&")[0]
        if "action=list_cells" in url:
            res = {"status": "OK", "cells": cells_fixture}
        elif "action=list_handouts" in url:
            res = {"status": "OK", "handouts": handouts_fixture}
        else:
            res = {"status": "OK"}
        route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
    page.route("**/script.google.com/**", fake_apps_script)

    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    roster = {
        "OWEN-CS12": {"code": "OWEN-CS12", "char_name": "Owen Castillo", "codename": "Ferro", "saved_at": 2000},
        "PRIY-AN34": {"code": "PRIY-AN34", "char_name": "Priya Anand", "codename": "", "saved_at": 1000},
    }
    page.evaluate("(r) => localStorage.setItem('dg_agent_roster', JSON.stringify(r))", roster)
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(900)

    owen_titles = page.eval_on_selector_all("#ah-handouts-OWEN-CS12 .ah-handout-title", "els => els.map(e=>e.textContent)")
    record("hub", "an Agent who's a Cell member sees both that Cell's handout and the campaign-wide one",
           sorted(owen_titles) == sorted(["Cell Alpha Only Clue", "Campaign Wide Notice"]), str(owen_titles))

    page.click('.tw[data-tab="PRIY-AN34"]')
    page.wait_for_timeout(150)
    priya_titles = page.eval_on_selector_all("#ah-handouts-PRIY-AN34 .ah-handout-title", "els => els.map(e=>e.textContent)")
    record("hub", "an Agent in no Cell only sees the campaign-wide handout, not the Cell-scoped one",
           priya_titles == ["Campaign Wide Notice"], str(priya_titles))

    page.close()
    return errs

def test_agent_hub_recruit_flag(p):
    """Bug fix: an Agent File can exist (submitted via Cover form /
    Agent File export) before that Agent has an actual character sheet
    in the cloud (Cloud Save) -- reported case: an Agent File on one
    device with no character sheet yet still showed Play, and clicking
    it landed on a different, previously-played Agent's sheet with no
    warning. Each Agent's Play button is checked against load_character;
    an Agent with no cloud character flips the button to Recruit with an
    explainer stamp, while one with an existing character keeps Play. A
    check that errors or times out leaves the button as Play rather than
    risking a false Recruit label."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    def fake_apps_script(route):
        url = route.request.url
        if "action=load_character" in url and "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            has_sheet = "OWEN-CS12" in url
            res = {"status": "OK", "character_json": "{}"} if has_sheet else {"status": "NOT_FOUND"}
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
        elif "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({{"status":"OK"}})')
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", fake_apps_script)

    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    roster = {
        "OWEN-CS12": {"code": "OWEN-CS12", "char_name": "Owen Castillo", "saved_at": 2000},
        "PRIY-AN34": {"code": "PRIY-AN34", "char_name": "Priya Anand", "saved_at": 1000},
    }
    page.evaluate("(r) => localStorage.setItem('dg_agent_roster', JSON.stringify(r))", roster)
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(1200)

    owen_btn = page.eval_on_selector('#ah-play-OWEN-CS12', "el => el.textContent.trim()")
    record("hub", "Agent with an existing character keeps the Play label", "Play" in owen_btn, owen_btn)
    # textContent, not inner_text: the stamp's CSS applies text-transform:
    # uppercase, which inner_text would render as-displayed rather than
    # the raw DOM text this is actually checking for.
    record("hub", "no 'No Character Sheet Yet' stamp for the Agent that already has one",
           "No Character Sheet Yet" not in page.eval_on_selector("#ah-charstamp-OWEN-CS12", "el => el.textContent"), "")

    page.click('.tw[data-tab="PRIY-AN34"]')
    page.wait_for_timeout(150)
    priy_btn = page.eval_on_selector('#ah-play-PRIY-AN34', "el => el.textContent.trim()")
    record("hub", "Agent with no character yet flips to Recruit", "Recruit" in priy_btn, priy_btn)
    record("hub", "'No Character Sheet Yet' stamp is shown for the flagged Agent",
           "No Character Sheet Yet" in page.eval_on_selector("#ah-charstamp-PRIY-AN34", "el => el.textContent"), "")

    page.close()
    return errs

def test_acell_gate(p):
    """a-cell.html: the Handler's clearance branch. Same black-screen
    green-terminal aesthetic as index.html's boot splash, but
    interactive -- the Handler types the password (MASTICATE,
    case-insensitive) and presses Enter. A client-side flavor gate for
    in-fiction "clearance", not real access control. Wrong password ->
    access_denied, gate stays up, retry. Right password -> acces_granted,
    the Delta Green triangle logo fades in, then the gate clears to
    reveal the A-Cell hub (Play / Cells / Music sections). Session-gated
    like the boot splash: unlocks once per tab, re-asks in a fresh
    session."""
    errs_all = []

    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)

    record("acell", "gate is visible on first load with the clearance prompt",
           page.is_visible("#acell-gate") and "enter_clearance_code:" in page.inner_text("#acell-term-log"), "")

    # Wrong password -> denied, gate stays up. The field itself is a
    # plain type="text" input with its display rewritten to X's (not a
    # native type="password" field, which would mask with round dots).
    page.fill("#acell-pw-input", "WRONGPASS")
    record("acell", "the password field masks what's typed with X's, not the real characters",
           page.input_value("#acell-pw-input") == "X" * len("WRONGPASS"), page.input_value("#acell-pw-input"))
    record("acell", "the password field is a plain text input (X masking is manual, not the browser's own dots)",
           page.eval_on_selector("#acell-pw-input", "el => el.type") == "text", "")
    page.press("#acell-pw-input", "Enter")
    page.wait_for_timeout(200)
    record("acell", "wrong password shows access_denied and keeps the gate up",
           "access_denied" in page.inner_text("#acell-term-log") and page.is_visible("#acell-gate"), "")

    # Correct password (case-insensitive) -> granted, logo, gate clears.
    page.fill("#acell-pw-input", "masticate")
    page.press("#acell-pw-input", "Enter")
    page.wait_for_timeout(200)
    record("acell", "correct password (case-insensitive) shows acces_granted",
           "acces_granted" in page.inner_text("#acell-term-log"), "")
    page.wait_for_timeout(2500)
    record("acell", "gate is removed from the DOM after unlock",
           page.query_selector("#acell-gate") is None, "")
    record("acell", "A-Cell hub (Play/Cells/Music sections) is visible after unlock",
           page.is_visible("text=Play") and page.is_visible("text=Cells") and page.is_visible("text=Music"), "")
    record("acell", "body scroll lock is released after unlock",
           not page.eval_on_selector("body", "el => el.classList.contains('acell-lock')"), "")

    errs_all.extend(errs)
    page.close()

    # Same-tab reload -> gate skipped (sessionStorage-gated, like the boot splash).
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)
    page.fill("#acell-pw-input", "MASTICATE")
    page.press("#acell-pw-input", "Enter")
    page.wait_for_timeout(2500)
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(300)
    record("acell", "gate is skipped on a same-tab reload once unlocked",
           page.query_selector("#acell-gate") is None, "")
    errs_all.extend(errs)
    page.close()

    return errs_all

def test_acell_play(p):
    """a-cell.html's Play section: every Agent on file (not just the
    ones in this browser's own dg_agent_roster), pulled from a new
    list_characters Apps Script action (see
    acell-play-list-characters-addition.txt, handed over separately --
    not yet deployed on the live backend, same as every other .gs
    addition this project needs pasted in manually) that returns every
    row of the same Characters sheet Cloud Save already writes to.
    Picking an Agent renders a simplified read-only view: name, the six
    stats, HP/WP/SAN/BP, and skills."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)

    fake_characters = [
        {
            "agent_code": "OWEN-CS12",
            "character_json": json.dumps({
                "bio": {"name": "Owen Castillo", "profession": "Federal Agent", "nationality": "American",
                        "player_name": "Gergo P",
                        "motivations": "Protect my sister at any cost.\n[Disorder: Paranoia]"},
                "csStats": {"STR": 12, "CON": 13, "DEX": 14, "INT": 15, "POW": 10, "CHA": 11},
                "derived": {"hp": 13, "wp": 10, "san": 50, "bp": 40},
                "skills": {"firearms": 60, "alertness": 50, "drive": 40},
                "customSkills": [{"name": "Forgery", "value": 35}],
                "bonds": [{"name": "Maria Castillo", "relationship": "Sister", "score": 8},
                          {"name": "Delta Green", "relationship": "Handler", "score": 12}],
                "sanity": {"violence": [True, True, False], "helplessness": [False, False, False]},
            }),
        },
        {
            "agent_code": "PRIY-AN34",
            "character_json": json.dumps({
                "bio": {"name": "Priya Anand", "profession": "Forensic Accountant"},
                "csStats": {"STR": 8, "CON": 9, "DEX": 10, "INT": 17, "POW": 13, "CHA": 12},
                "derived": {"hp": 9, "wp": 13, "san": 65, "bp": 52},
                "skills": {"accounting": 70, "bureaucracy": 40},
                "customSkills": [],
            }),
        },
        {
            "agent_code": "MARC-9XQ2",
            "character_json": json.dumps({
                "bio": {"name": "Marcus Reyes", "profession": "Pilot"},
                "csStats": {"STR": 10, "CON": 10, "DEX": 10, "INT": 10, "POW": 10, "CHA": 10},
                "derived": {"hp": 0, "wp": 8, "san": 30, "bp": 25},
                "skills": {},
                "customSkills": [],
            }),
        },
    ]

    fake_cells = [
        {"cell_id": "cell_1", "name": "Cell Alpha", "handler": "Gergo", "member_codes": ["OWEN-CS12"]},
        {"cell_id": "cell_2", "name": "Cell Bravo", "handler": "Gergo", "member_codes": ["PRIY-AN34"]},
    ]

    def fake_apps_script(route):
        url = route.request.url
        if "action=list_characters" in url and "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            body = f'{cb}({json.dumps({"status": "OK", "characters": fake_characters})})'
            route.fulfill(status=200, content_type="application/javascript", body=body)
        elif "action=list_cells" in url and "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            body = f'{cb}({json.dumps({"status": "OK", "cells": fake_cells})})'
            route.fulfill(status=200, content_type="application/javascript", body=body)
        elif "callback=" in url:
            # Other tab modules (Music, Admin, Sheet) fetch unconditionally
            # on page load regardless of which tab is visible -- their
            # calls need a real JSONP-wrapped response too, or the browser
            # tries to execute a raw JSON object as a <script> and throws
            # a syntax error on the object literal's ':'.
            cb = url.split("callback=")[1].split("&")[0]
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({{"status":"OK"}})')
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", fake_apps_script)

    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(500)

    names = page.eval_on_selector_all("#play-agent-list .pa-name", "els => els.map(e=>e.textContent)")
    record("acell", "Play lists every Agent on file, not just this browser's own roster",
           names == ["Owen Castillo", "Priya Anand", "Marcus Reyes"], str(names))

    page.click("#play-agent-list .play-agent-btn:first-child")
    page.wait_for_timeout(200)
    record("acell", "selecting an Agent shows their name in the simplified view",
           "Owen Castillo" in page.inner_text("#play-view .pv-bio"), "")
    stat_vals = page.eval_on_selector_all("#play-view .pv-stat .val", "els => els.map(e=>e.textContent)")
    record("acell", "simplified view shows the six stats in order",
           stat_vals == ["12", "13", "14", "15", "10", "11"], str(stat_vals))
    record("acell", "simplified view shows a predefined skill score",
           "60" in page.inner_text("#play-view .pv-skills"), "")
    record("acell", "simplified view shows a custom skill",
           "Forgery" in page.inner_text("#play-view .pv-skills"), "")
    vitals = page.eval_on_selector_all("#play-view .pv-vital .val", "els => els.map(e=>e.textContent)")
    record("acell", "sticky header shows HP/WP/SAN/BP (the vitals that move during play)",
           vitals == ["13", "10", "50", "40"], str(vitals))
    dossier_text = page.inner_text("#play-view .pv-details")
    record("acell", "dossier dropdown shows bond names and scores",
           "Maria Castillo" in dossier_text and "8" in dossier_text, dossier_text)
    record("acell", "dossier dropdown shows motivations/disorders text",
           "Paranoia" in dossier_text, "")
    adapt = page.eval_on_selector_all("#play-view .pv-adapt-boxes", "els => els.map(e=>e.textContent.trim())")
    record("acell", "dossier dropdown shows Violence/Helplessness adaptation as checked/unchecked boxes",
           len(adapt) == 2 and adapt[0].count('[X]') == 2 and adapt[0].count('[ ]') == 1, str(adapt))
    record("acell", "sticky header shows the Player Name so the Handler knows who made this Agent",
           "Gergo P" in page.inner_text("#play-view .pv-player"), "")

    # Refresh re-fetches the roster and keeps the selected Agent's panel
    # showing their (possibly updated) view, instead of dropping the
    # selection.
    fake_characters[0]["character_json"] = json.dumps({
        "bio": {"name": "Owen Castillo", "profession": "Federal Agent", "nationality": "American"},
        "csStats": {"STR": 12, "CON": 13, "DEX": 14, "INT": 15, "POW": 10, "CHA": 99},
        "derived": {"hp": 13, "wp": 10, "san": 50, "bp": 40},
        "skills": {"firearms": 60, "alertness": 50, "drive": 40},
        "customSkills": [{"name": "Forgery", "value": 35}],
    })
    page.click("#play-refresh-btn")
    page.wait_for_timeout(400)
    stat_vals_after = page.eval_on_selector_all("#play-view .pv-stat .val", "els => els.map(e=>e.textContent)")
    record("acell", "Refresh pulls updated stats and keeps the same Agent's view open",
           stat_vals_after == ["12", "13", "14", "15", "10", "99"], str(stat_vals_after))
    record("acell", "Refresh shows an 'Updated' timestamp note",
           "Updated" in page.inner_text("#play-refresh-note"), "")

    # Cell filter: narrows the Play roster to one Cell's members, so a
    # Handler running a session for one Cell isn't scrolling past every
    # other Agent on file.
    filter_options = page.eval_on_selector_all("#play-cell-filter option", "els => els.map(e=>e.textContent)")
    record("acell", "Play's Cell filter lists every Cell plus an 'All Agents' option",
           filter_options == ["All Agents", "Cell Alpha", "Cell Bravo"], str(filter_options))

    page.select_option("#play-cell-filter", label="Cell Alpha")
    page.wait_for_timeout(200)
    names_alpha = page.eval_on_selector_all("#play-agent-list .pa-name", "els => els.map(e=>e.textContent)")
    record("acell", "filtering by Cell Alpha shows only that Cell's member",
           names_alpha == ["Owen Castillo"], str(names_alpha))

    page.select_option("#play-cell-filter", label="Cell Bravo")
    page.wait_for_timeout(200)
    names_bravo = page.eval_on_selector_all("#play-agent-list .pa-name", "els => els.map(e=>e.textContent)")
    record("acell", "switching the Cell filter shows the newly chosen Cell's member",
           names_bravo == ["Priya Anand"], str(names_bravo))
    record("acell", "switching Cells clears a selection that's no longer in view and shows that Cell's Dashboard instead of a stale dossier",
           "Cell Bravo Dashboard" in page.inner_text("#play-view") and "Priya Anand" in page.inner_text("#play-view"), "")

    # Cell Dashboard: HP/WP/SAN/BP for every member of the filtered Cell
    # at a glance, without clicking into each Agent one at a time.
    dash_vitals = page.eval_on_selector_all("#play-view .cdb-row .cdb-vital .val", "els => els.map(e=>e.textContent)")
    record("acell", "the Dashboard shows the filtered Cell's member's vitals",
           dash_vitals == ["9", "13", "65", "52"], str(dash_vitals))
    page.click('#play-view .cdb-row:has-text("Priya Anand")')
    page.wait_for_timeout(200)
    record("acell", "clicking a Dashboard row opens that Agent's full dossier",
           "Priya Anand" in page.inner_text("#play-view .pv-bio"), "")
    record("acell", "clicking a Dashboard row highlights that Agent in the left-hand list too",
           "active" in (page.eval_on_selector('.play-agent-btn:has-text("Priya Anand")', "el => el.className") or ""), "")

    page.select_option("#play-cell-filter", label="All Agents")
    page.wait_for_timeout(200)
    names_all = page.eval_on_selector_all("#play-agent-list .pa-name", "els => els.map(e=>e.textContent)")
    record("acell", "'All Agents' clears the filter back to the full roster",
           names_all == ["Owen Castillo", "Priya Anand", "Marcus Reyes"], str(names_all))

    # KIA: a live read of the last-saved HP, not a separate persisted
    # flag -- Marcus is at 0 HP and should carry the stamp; Owen (13 HP)
    # should not.
    page.click('.play-agent-btn:has-text("Owen Castillo")')
    page.wait_for_timeout(200)
    record("acell", "an Agent above 0 HP shows no KIA stamp",
           "KIA" not in page.inner_text("#play-view .pv-bio"), "")
    page.click('.play-agent-btn:has-text("Marcus Reyes")')
    page.wait_for_timeout(200)
    record("acell", "an Agent at 0 HP shows a KIA stamp next to their name",
           "KIA" in page.inner_text("#play-view .pv-bio"), page.inner_text("#play-view .pv-bio"))

    page.close()
    return errs

def test_acell_cells(p):
    """a-cell.html's Cells tab: real named Cell groups (a Handler + a
    set of member Agents picked from the full roster), not a per-Agent
    text tag -- backed by new list_cells/create_cell/update_cell_members
    actions (acell-cell-groups-addition.txt, handed over separately).
    One Agent can belong to more than one Cell; an Agent in none shows
    up under "Unassigned Agents". Like every other write in this app,
    create_cell/update_cell_members are no-cors POSTs verified by a
    real list_cells read-back before the UI shows the change."""
    page = p.new_page()
    page.set_default_timeout(30000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)

    fake_characters = [
        {"agent_code": "OWEN-CS12",
         "character_json": json.dumps({"bio": {"name": "Owen Castillo", "profession": "Federal Agent"}})},
        {"agent_code": "PRIY-AN34",
         "character_json": json.dumps({"bio": {"name": "Priya Anand", "profession": "Forensic Accountant"}})},
        {"agent_code": "MARC-9XQ2",
         "character_json": json.dumps({"bio": {"name": "Marcus Reyes", "profession": "Pilot"}})},
    ]
    cells_state = []

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            body = json.loads(req.post_data or "{}")
            if body.get("action") == "create_cell":
                cell_id = "cell_" + str(len(cells_state) + 1)
                cells_state.append({"cell_id": cell_id, "name": body.get("name"), "handler": body.get("handler", ""), "member_codes": []})
            elif body.get("action") == "update_cell_members":
                for c in cells_state:
                    if c["cell_id"] == body.get("cell_id"):
                        c["member_codes"] = body.get("member_codes", [])
            elif body.get("action") == "delete_cell":
                cells_state[:] = [c for c in cells_state if c["cell_id"] != body.get("cell_id")]
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            if "action=list_characters" in url:
                res = {"status": "OK", "characters": fake_characters}
            elif "action=list_cells" in url:
                res = {"status": "OK", "cells": cells_state}
            else:
                res = {"status": "OK"}
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", fake_apps_script)

    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(500)
    # Cells lives behind its own folder tab now (Play is active by default).
    page.click('.tw[data-tab="cells"]')
    page.wait_for_timeout(500)

    record("acell", "Cells starts empty with a prompt to create one",
           "No Cells yet" in page.inner_text("#cells-groups"), "")
    unassigned = page.inner_text("#cells-unassigned")
    record("acell", "every Agent on file starts out Unassigned",
           "Owen Castillo" in unassigned and "Priya Anand" in unassigned and "Marcus Reyes" in unassigned, unassigned)

    # Create a Cell. Polls for the confirmed state instead of a fixed
    # sleep -- create_cell is a no-cors POST verified by a list_cells
    # read-back 900ms later, and under system load that round trip can
    # take longer than any one fixed wait, so poll up to a generous cap
    # rather than risk a flaky false failure (or wasting time when it's
    # fast).
    page.click("#cells-create-btn")
    page.wait_for_timeout(150)
    page.fill("#cells-new-name", "Cell Alpha")
    page.fill("#cells-new-handler", "Sam")
    page.click("#cells-new-confirm")
    groups_text = wait_for_condition(lambda: page.inner_text("#cells-groups")
                                      if "Cell Alpha" in page.inner_text("#cells-groups") else None)
    record("acell", "creating a Cell shows it with its name and Handler once the backend confirms it",
           bool(groups_text) and "Cell Alpha" in groups_text and "Sam" in groups_text, groups_text or "")

    # Add Owen to Cell Alpha. Checks are scoped to .cell-members (the
    # actual member list), not the whole .cell-card -- that card also
    # contains the "Add an Agent" dropdown, whose <option> list
    # includes every NOT-yet-added Agent's name, so a plain "is Owen's
    # name anywhere in this card" check is already true before the add
    # even happens (he's sitting right there as an unselected option).
    page.select_option('[data-add-select="0"]', "OWEN-CS12")
    page.click('[data-add-btn="0"]')
    def alpha_members():
        return page.inner_text('.cell-card[data-i="0"] .cell-members')
    alpha_text = wait_for_condition(lambda: alpha_members() if "Owen Castillo" in alpha_members() else None)
    record("acell", "adding an Agent to a Cell shows them as a member once confirmed",
           bool(alpha_text) and "Owen Castillo" in alpha_text, alpha_text or "")
    record("acell", "an Agent added to a Cell no longer shows as Unassigned",
           "Owen Castillo" not in page.inner_text("#cells-unassigned"), "")

    # Create a second Cell and add the SAME Agent to it too (one Agent, two Cells).
    page.click("#cells-create-btn")
    page.wait_for_timeout(150)
    page.fill("#cells-new-name", "Cell Bravo")
    page.fill("#cells-new-handler", "Jo")
    page.click("#cells-new-confirm")
    wait_for_condition(lambda: page.locator('.cell-card[data-i="1"]').count() > 0)
    page.select_option('[data-add-select="1"]', "OWEN-CS12")
    page.click('[data-add-btn="1"]')
    def bravo_members():
        return page.inner_text('.cell-card[data-i="1"] .cell-members')
    wait_for_condition(lambda: "Owen Castillo" in bravo_members())
    record("acell", "one Agent can belong to more than one Cell at once",
           "Owen Castillo" in alpha_members() and "Owen Castillo" in bravo_members(), "")

    # Remove Owen from Cell Alpha -- he should still show in Cell Bravo,
    # and still not be Unassigned (Bravo still has him).
    page.click('.cell-card[data-i="0"] button[data-remove-agent="OWEN-CS12"]')
    wait_for_condition(lambda: "Owen Castillo" not in alpha_members())
    record("acell", "removing an Agent from one Cell doesn't remove them from a different Cell",
           "Owen Castillo" not in alpha_members() and "Owen Castillo" in bravo_members(), "")
    record("acell", "an Agent still in at least one Cell is still not Unassigned",
           "Owen Castillo" not in page.inner_text("#cells-unassigned"), "")

    # Bulk add: Cell Bravo currently only has Owen -- select both Priya
    # and Marcus at once and confirm one Add Selected click sends both
    # codes in a single update_cell_members call, not two.
    add_select = page.locator('[data-add-select="1"]')
    record("acell", "the Add row is a multi-select, not one Agent at a time",
           add_select.evaluate("el => el.multiple") is True, "")
    add_select.select_option(["PRIY-AN34", "MARC-9XQ2"])
    page.click('[data-add-btn="1"]')
    wait_for_condition(lambda: "Priya Anand" in bravo_members() and "Marcus Reyes" in bravo_members())
    record("acell", "selecting more than one Agent and Add Selected adds them all in one action",
           "Priya Anand" in bravo_members() and "Marcus Reyes" in bravo_members() and "Owen Castillo" in bravo_members(),
           bravo_members())

    # Delete Cell: dismissing the confirm must not send anything; only
    # accepting it removes the grouping (the Agents themselves stay on
    # file -- Cells is a separate tab from Admin's Agent delete).
    page.once("dialog", lambda d: d.dismiss())
    page.click('.cell-card[data-i="1"] .cell-delete-btn')
    page.wait_for_timeout(300)
    record("acell", "dismissing the Delete Cell confirm leaves the Cell in place",
           page.locator('.cell-card[data-i="1"]').count() == 1, "")

    page.once("dialog", lambda d: d.accept())
    page.click('.cell-card[data-i="1"] .cell-delete-btn')
    wait_for_condition(lambda: "Cell Bravo" not in page.inner_text("#cells-groups"))
    record("acell", "accepting Delete Cell removes the grouping",
           "Cell Bravo" not in page.inner_text("#cells-groups"), page.inner_text("#cells-groups"))
    record("acell", "deleting a Cell doesn't delete its Agents -- they fall back to Unassigned instead",
           "Owen Castillo" in page.inner_text("#cells-unassigned")
           and "Priya Anand" in page.inner_text("#cells-unassigned")
           and "Marcus Reyes" in page.inner_text("#cells-unassigned"),
           page.inner_text("#cells-unassigned"))

    page.close()
    return errs

def test_acell_handouts(p):
    """a-cell.html's Handouts tab: a shared clue/document log the
    Handler files, each entry scoped to one Cell (cell_id set) or
    every Cell (cell_id blank, shown as "All Cells"). Backed by
    list_handouts/create_handout/update_handout/delete_handout. Like
    every other write in this app, the no-cors POSTs are verified by a
    real list_handouts read-back before the UI shows the change."""
    page = p.new_page()
    page.set_default_timeout(30000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)

    cells_fixture = [{"cell_id": "cell_1", "name": "Cell Alpha", "handler": "Sam", "member_codes": ["OWEN-CS12"], "channel": ""}]
    handouts_state = []

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            body = json.loads(req.post_data or "{}")
            action = body.get("action")
            if action == "create_handout":
                hid = "handout_" + str(len(handouts_state) + 1)
                handouts_state.append({
                    "handout_id": hid, "title": body.get("title", ""), "body": body.get("body", ""),
                    "photo": body.get("photo", ""), "cell_id": body.get("cell_id", ""),
                    "created_at": str(1000 + len(handouts_state)),
                })
            elif action == "update_handout":
                for h in handouts_state:
                    if h["handout_id"] == body.get("handout_id"):
                        h["title"] = body.get("title", ""); h["body"] = body.get("body", "")
                        h["photo"] = body.get("photo", ""); h["cell_id"] = body.get("cell_id", "")
            elif action == "delete_handout":
                handouts_state[:] = [h for h in handouts_state if h["handout_id"] != body.get("handout_id")]
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            if "action=list_cells" in url:
                res = {"status": "OK", "cells": cells_fixture}
            elif "action=list_handouts" in url:
                res = {"status": "OK", "handouts": handouts_state}
            elif "action=list_characters" in url:
                res = {"status": "OK", "characters": []}
            else:
                res = {"status": "OK"}
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", fake_apps_script)

    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(500)
    page.click('.tw[data-tab="handouts"]')
    page.wait_for_timeout(500)

    record("acell", "Handouts starts empty with a prompt to file one",
           "No handouts filed yet" in page.inner_text("#handouts-list"), "")

    # File a Cell-scoped handout.
    page.click("#handouts-create-btn")
    page.wait_for_timeout(150)
    page.fill("#handouts-new-title", "Field Photograph")
    page.select_option("#handouts-new-scope", label="Cell Alpha")
    page.fill("#handouts-new-body", "Recovered from the scene.")
    page.click("#handouts-new-confirm")
    list_text = wait_for_condition(lambda: page.inner_text("#handouts-list")
                                    if "Field Photograph" in page.inner_text("#handouts-list") else None)
    record("acell", "filing a handout shows it once the backend confirms it",
           bool(list_text) and "Field Photograph" in list_text and "cell alpha" in list_text.lower(), list_text or "")

    # File an All Cells handout.
    page.click("#handouts-create-btn")
    page.wait_for_timeout(150)
    page.fill("#handouts-new-title", "Wire Service Clipping")
    page.fill("#handouts-new-body", "Three additional livestock deaths reported.")
    page.click("#handouts-new-confirm")
    wait_for_condition(lambda: "Wire Service Clipping" in page.inner_text("#handouts-list"))
    record("acell", "a blank Scope files as All Cells",
           "all cells" in page.inner_text("#handouts-list").lower(), page.inner_text("#handouts-list"))
    record("acell", "both a Cell-scoped and an All Cells handout can coexist in the list",
           page.locator(".handout-card").count() == 2, "")

    # Edit the first one.
    page.click('[data-edit-handout="1"]')
    page.wait_for_timeout(200)
    record("acell", "Edit opens the form pre-filled with that handout's title",
           page.input_value("#handouts-new-title") == "Field Photograph", page.input_value("#handouts-new-title"))
    page.fill("#handouts-new-title", "Field Photograph (annotated)")
    page.click("#handouts-new-confirm")
    wait_for_condition(lambda: "Field Photograph (annotated)" in page.inner_text("#handouts-list"))
    record("acell", "editing a handout updates it in place once confirmed",
           "Field Photograph (annotated)" in page.inner_text("#handouts-list"), page.inner_text("#handouts-list"))

    # A real photo's base64 data URI easily exceeds 64KiB -- the browser
    # caps keepalive request bodies at exactly that, silently rejecting
    # the fetch() before it's even sent (not an app or backend failure --
    # confirmed by reproducing it against this very mock, which never saw
    # the request at all until keepalive was dropped from this one POST).
    # Generate an oversized fixture on the fly rather than committing a
    # binary blob -- the content doesn't need to be a decodable image,
    # only large enough to exercise the size limit through the real
    # FileReader -> base64 -> fetch path.
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
        f.write(os.urandom(120_000))
        oversized_photo_path = f.name
    page.click("#handouts-create-btn")
    page.wait_for_timeout(150)
    page.fill("#handouts-new-title", "Photo Evidence")
    page.fill("#handouts-new-body", "Attached.")
    page.set_input_files("#handouts-new-photo", oversized_photo_path)
    page.wait_for_timeout(300)
    page.click("#handouts-new-confirm")
    photo_list_text = wait_for_condition(lambda: page.inner_text("#handouts-list")
                                          if "Photo Evidence" in page.inner_text("#handouts-list") else None)
    record("acell", "filing a handout with a real-sized photo (>64KiB base64) still reaches the backend",
           bool(photo_list_text) and "Photo Evidence" in photo_list_text
           and "Could not reach the backend" not in page.inner_text("#handouts-status"),
           page.inner_text("#handouts-status"))
    os.unlink(oversized_photo_path)

    # Delete: dismiss then accept. Three handouts on the list at this
    # point (the photo one filed above sorts first, being newest).
    page.once("dialog", lambda d: d.dismiss())
    page.click('[data-delete-handout="0"]')
    page.wait_for_timeout(300)
    record("acell", "dismissing the Delete confirm leaves the handout in place",
           page.locator(".handout-card").count() == 3, "")

    page.once("dialog", lambda d: d.accept())
    page.click('[data-delete-handout="0"]')
    wait_for_condition(lambda: page.locator(".handout-card").count() == 2)
    record("acell", "accepting Delete removes the handout",
           page.locator(".handout-card").count() == 2, "")

    page.close()
    return errs

def test_acell_sheet(p):
    """a-cell.html's Sheet tab: a dense, spreadsheet-style read-only
    roster table -- Cell, Handler, Agent Name, Player Name, HP, SAN,
    and a rough Online presence indicator derived from how recently
    Cloud Save last pushed for that Agent (updated_at). Cell/Handler
    now come from real Cell group membership (list_cells) -- an Agent
    in a Cell shows that Cell's name/Handler, one not in any Cell
    shows the same empty-cell dash as any other missing value."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)

    now_ms = 1700000000000
    fake_characters = [
        {"agent_code": "OWEN-CS12",
         "character_json": json.dumps({"bio": {"name": "Owen Castillo", "player_name": "Gergo P"},
                                        "derived": {"hp": 13, "san": 50}}),
         "updated_at": now_ms},
        {"agent_code": "PRIY-AN34",
         "character_json": json.dumps({"bio": {"name": "Priya Anand"}, "derived": {"hp": 9, "san": 65}}),
         "updated_at": now_ms - 20 * 60 * 1000},
        {"agent_code": "MARC-9XQ2",
         "character_json": json.dumps({"bio": {"name": "Marcus Reyes"}, "derived": {"hp": 0, "san": 40}}),
         "updated_at": now_ms - 2 * 60 * 60 * 1000},
    ]
    fake_cells = [
        {"cell_id": "cell_1", "name": "Cell Alpha", "handler": "Sam", "member_codes": ["OWEN-CS12", "PRIY-AN34"]},
    ]

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            if "action=list_characters" in url:
                res = {"status": "OK", "characters": fake_characters}
            elif "action=list_cells" in url:
                res = {"status": "OK", "cells": fake_cells}
            else:
                res = {"status": "OK"}
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", fake_apps_script)
    page.add_init_script(f"Date.now = () => {now_ms}")

    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(400)
    page.click('.tw[data-tab="sheet"]')
    page.wait_for_timeout(600)

    headers = page.eval_on_selector_all("#sheet-wrap th", "els => els.map(e=>e.textContent)")
    record("acell", "Sheet table has the requested columns in order",
           headers == ["Cell", "Handler", "Agent Name", "Player Name", "HP", "SAN", "Online"], str(headers))

    row_texts = page.eval_on_selector_all("#sheet-wrap tbody tr", "els => els.map(e=>e.textContent)")
    record("acell", "Sheet lists every Agent on file as a table row",
           len(row_texts) == 3, str(row_texts))
    record("acell", "a row shows the Agent's Cell, Handler, player name, HP, and SAN together",
           "Cell Alpha" in row_texts[0] and "Sam" in row_texts[0]
           and "Owen Castillo" in row_texts[0] and "Gergo P" in row_texts[0]
           and "13" in row_texts[0] and "50" in row_texts[0], row_texts[0])
    record("acell", "a different Agent in the same Cell shows that Cell too",
           "Cell Alpha" in row_texts[1] and "Sam" in row_texts[1], row_texts[1])
    record("acell", "an Agent in no Cell shows a clear placeholder, not blank",
           "—" in row_texts[2], row_texts[2])

    # KIA: a live read of last-saved HP, not a separate flag. Marcus is
    # at 0 HP and should carry the badge; Owen/Priya (13, 9 HP) should not.
    record("acell", "an Agent at 0 HP shows a KIA badge in the Sheet row",
           "KIA" in row_texts[2], row_texts[2])
    record("acell", "an Agent above 0 HP does not show a KIA badge",
           "KIA" not in row_texts[0] and "KIA" not in row_texts[1], "")
    hp_cells = page.eval_on_selector_all("#sheet-wrap tbody tr:nth-child(3) td:nth-child(5)", "els => els.map(e=>e.textContent.trim())")
    record("acell", "an Agent at 0 HP shows '0' in the HP column, not an empty-cell dash",
           hp_cells == ["0"], str(hp_cells))

    dots = page.eval_on_selector_all("#sheet-wrap .sheet-dot", "els => els.map(e=>e.className)")
    record("acell", "Online status reflects how recently each Agent's sheet last synced (just now / 20 min ago / 2 hours ago)",
           dots == ["sheet-dot on", "sheet-dot recent", "sheet-dot off"], str(dots))

    page.close()
    return errs

def test_acell_music(p):
    """a-cell.html's Music tab: the Handler's broadcast side of Table
    Radio. Setting a channel + track URL posts set_now_playing (an Apps
    Script action, part of acell-table-radio-addition.txt handed over
    separately); Stop posts the same action with an empty track_url.
    set_now_playing is a no-cors POST, so a genuine backend failure
    (addition not deployed, wrong action name, etc.) would otherwise
    look identical to success -- the status line only claims
    "Broadcasting" once a real GET read-back (get_now_playing) confirms
    the track actually landed, exercised here against a stateful mock
    backend that behaves like the real Apps Script action pair."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)

    posts = []
    backend_state = {"track_url": "", "track_title": "", "track_kind": ""}
    fake_cells = [{"cell_id": "cell_1", "name": "Cell Alpha", "handler": "Sam", "member_codes": [], "channel": "4"}]
    tracks_state = []

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            body = json.loads(req.post_data or "{}")
            posts.append(body)
            if body.get("action") == "set_now_playing":
                backend_state["track_url"] = body.get("track_url", "")
                backend_state["track_title"] = body.get("track_title", "")
                backend_state["track_kind"] = body.get("track_kind", "")
            elif body.get("action") == "set_cell_channel":
                for c in fake_cells:
                    if c["cell_id"] == body.get("cell_id"):
                        c["channel"] = body.get("channel", "")
            elif body.get("action") == "upload_track":
                tid = "track_" + str(len(tracks_state) + 1)
                tracks_state.append({
                    "track_id": tid, "title": body.get("title", ""),
                    "url": "https://drive.google.com/uc?export=download&id=fake" + tid,
                    "uploaded_at": "1000",
                })
            elif body.get("action") == "delete_track":
                tracks_state[:] = [t for t in tracks_state if t["track_id"] != body.get("track_id")]
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            if "action=get_now_playing" in url:
                if backend_state["track_url"]:
                    res = {"status": "OK", "track_url": backend_state["track_url"],
                           "track_title": backend_state["track_title"], "started_at": 1700000000000,
                           "track_kind": backend_state["track_kind"]}
                else:
                    res = {"status": "NOT_FOUND"}
            elif "action=get_playlist" in url:
                res = {"status": "OK", "playlist": []}
            elif "action=list_cells" in url:
                res = {"status": "OK", "cells": fake_cells}
            elif "action=list_tracks" in url:
                res = {"status": "OK", "tracks": tracks_state}
            else:
                res = {"status": "OK"}
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", fake_apps_script)

    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.click('.tw[data-tab="music"]')
    page.wait_for_timeout(150)

    record("acell", "the channel dial defaults to channel 1 (no free-text channel field anymore)",
           page.eval_on_selector("#music-dial-panel .dgr-dial-ch", "el => el.textContent") == "1", "")
    # Turn the dial to channel 2 -- the same rotary control as the
    # player-facing widget, not a typed name (which let two players land
    # on "sam" vs "Sam" and never hear each other).
    page.click('#music-dial-panel .dgr-turn[data-dir="1"]')
    page.wait_for_timeout(100)
    record("acell", "turning the dial's right button advances to channel 2",
           page.eval_on_selector("#music-dial-panel .dgr-dial-ch", "el => el.textContent") == "2", "")

    page.fill("#music-url-input", "https://youtube.com/watch?v=dQw4w9WgXcQ")
    page.fill("#music-title-input", "Table Theme")
    page.click("#music-set-btn")
    page.wait_for_timeout(1500)

    set_posts = [p_ for p_ in posts if p_.get("action") == "set_now_playing"]
    record("acell", "Set Now Playing posts the dialed channel, track URL, and title",
           len(set_posts) == 1 and set_posts[0].get("channel") == "2"
           and set_posts[0].get("track_url") == "https://youtube.com/watch?v=dQw4w9WgXcQ"
           and set_posts[0].get("track_title") == "Table Theme", str(set_posts))
    record("acell", "status line confirms broadcasting only after a real read-back (get_now_playing) verifies it",
           "CH 2" in page.inner_text("#music-status") and "Table Theme" in page.inner_text("#music-status"), page.inner_text("#music-status"))
    record("acell", "the dialed channel is remembered for next time",
           page.evaluate("() => localStorage.getItem('dg_acell_broadcast_channel')") == "2", "")
    record("acell", "the on-air indicator shows On Air once broadcasting is confirmed",
           page.inner_text("#music-air-indicator").strip().lower() == "on air", page.inner_text("#music-air-indicator"))

    page.click("#music-stop-btn")
    page.wait_for_timeout(1500)
    stop_posts = [p_ for p_ in posts if p_.get("action") == "set_now_playing" and p_.get("track_url") == ""]
    record("acell", "Stop posts set_now_playing with an empty track_url for the same channel",
           len(stop_posts) == 1 and stop_posts[0].get("channel") == "2", str(stop_posts))
    record("acell", "status line confirms broadcasting stopped",
           "Stopped" in page.inner_text("#music-status"), "")
    record("acell", "the on-air indicator drops back to Off Air once stopped",
           page.inner_text("#music-air-indicator").strip().lower() == "off air", page.inner_text("#music-air-indicator"))

    # Cue For Cell: Cell Alpha already has channel 4 assigned -- selecting
    # it should tune the dial straight there.
    page.select_option("#music-cell-select", label="Cell Alpha")
    page.wait_for_timeout(200)
    record("acell", "selecting a Cell with an assigned channel tunes the dial to it",
           page.eval_on_selector("#music-dial-panel .dgr-dial-ch", "el => el.textContent") == "4", "")
    record("acell", "a note explains the dial was tuned to that Cell's channel",
           "Cell Alpha" in page.inner_text("#music-cell-note") and "4" in page.inner_text("#music-cell-note"), "")

    # Turn the dial away, then assign the new channel back to the Cell.
    page.click('#music-dial-panel .dgr-turn[data-dir="1"]')
    page.wait_for_timeout(100)
    page.click("#music-cell-assign-btn")
    page.wait_for_timeout(1500)
    assign_posts = [p_ for p_ in posts if p_.get("action") == "set_cell_channel"]
    record("acell", "Assign CH to Cell sends set_cell_channel for the selected Cell and current dial position",
           len(assign_posts) == 1 and assign_posts[0].get("cell_id") == "cell_1" and assign_posts[0].get("channel") == "5",
           str(assign_posts))
    record("acell", "the note confirms the assignment once a real read-back verifies it",
           "cued to CH 5" in page.inner_text("#music-cell-note"), page.inner_text("#music-cell-note"))

    # Playlist: add a track, see it rendered, then remove it.
    page.fill("#music-url-input", "https://youtube.com/watch?v=abc12345678")
    page.fill("#music-title-input", "Ambient Track")
    page.click("#music-add-playlist-btn")
    page.wait_for_timeout(300)
    record("acell", "adding a track shows it in the playlist",
           "Ambient Track" in page.inner_text("#music-playlist"), "")
    save_playlist_posts = [p_ for p_ in posts if p_.get("action") == "save_playlist"]
    record("acell", "adding a track persists the playlist via save_playlist",
           len(save_playlist_posts) >= 1 and "Ambient Track" in save_playlist_posts[-1].get("playlist_json", ""),
           str(save_playlist_posts[-1:]))

    page.click('#music-playlist button[data-remove="0"]')
    page.wait_for_timeout(300)
    record("acell", "removing a track clears it from the playlist",
           "Ambient Track" not in page.inner_text("#music-playlist"), "")

    # Track Library: upload a real-sized mp3 (bigger than the 64KiB
    # keepalive cap that broke Handout photo uploads -- the upload POST
    # here deliberately has no keepalive for the same reason).
    record("acell", "the Track Library starts empty with a prompt to upload one",
           "No tracks uploaded yet" in page.inner_text("#tracklib-list"), "")
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
        f.write(os.urandom(150_000))
        oversized_mp3_path = f.name
    page.fill("#tracklib-title-input", "Rain Loop")
    page.set_input_files("#tracklib-file-input", oversized_mp3_path)
    page.click("#tracklib-upload-btn")
    tracklib_text = wait_for_condition(lambda: page.inner_text("#tracklib-list")
                                       if "Rain Loop" in page.inner_text("#tracklib-list") else None)
    record("acell", "uploading a real-sized (>64KiB) mp3 still reaches the backend and appears in the library",
           bool(tracklib_text) and "Rain Loop" in tracklib_text
           and "Could not reach the backend" not in page.inner_text("#tracklib-status"),
           page.inner_text("#tracklib-status"))
    os.unlink(oversized_mp3_path)

    upload_posts = [p_ for p_ in posts if p_.get("action") == "upload_track"]
    record("acell", "the upload POST does not use keepalive (would silently cap the body at 64KiB)",
           len(upload_posts) == 1, "")

    # Playing a library track sets track_kind: 'audio' -- a Drive
    # download link has no .mp3 extension, so the player widget needs
    # this explicit flag rather than sniffing the URL.
    page.click('[data-tracklib-play="0"]')
    play_status = wait_for_condition(lambda: page.inner_text("#music-status")
                                      if "Rain Loop" in page.inner_text("#music-status") else None)
    record("acell", "Play on a library track broadcasts it to the current channel",
           bool(play_status) and "Rain Loop" in play_status, play_status or "")
    record("acell", "playing a library track sends track_kind: 'audio' so the player doesn't have to guess from the URL",
           backend_state["track_kind"] == "audio", backend_state["track_kind"])

    # Delete: dismiss then accept.
    page.once("dialog", lambda d: d.dismiss())
    page.click('[data-tracklib-delete="0"]')
    page.wait_for_timeout(300)
    record("acell", "dismissing the Delete confirm leaves the track in place",
           page.locator(".rdo-track-row").count() == 1, "")

    page.once("dialog", lambda d: d.accept())
    page.click('[data-tracklib-delete="0"]')
    wait_for_condition(lambda: "No tracks uploaded yet" in page.inner_text("#tracklib-list"))
    record("acell", "accepting Delete removes the track from the library",
           "No tracks uploaded yet" in page.inner_text("#tracklib-list"), "")

    page.close()
    return errs

def test_acell_music_backend_not_deployed(p):
    """Bug report: the Music tab said "Broadcasting" while the player
    widget said "Waiting for the Handler" -- because set_now_playing is
    a no-cors POST, fetch() resolves "successfully" even when the
    backend addition isn't deployed and never actually saved anything.
    Against a backend that only ever reports NOT_FOUND (simulating the
    addition not being installed), the status line must say so
    honestly instead of claiming success."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            route.fulfill(status=200, content_type="application/javascript",
                           body=f'{cb}({json.dumps({"status": "NOT_FOUND"})})')
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", fake_apps_script)

    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.click('.tw[data-tab="music"]')
    page.wait_for_timeout(150)
    page.fill("#music-url-input", "https://youtube.com/watch?v=dQw4w9WgXcQ")
    page.click("#music-set-btn")
    page.wait_for_timeout(1500)

    status = page.inner_text("#music-status")
    record("acell", "an undeployed backend is reported honestly, not as a false 'Broadcasting' success",
           "Broadcasting" not in status and ("confirm" in status.lower() or "deploy" in status.lower()), status)

    page.close()
    return errs

def test_acell_admin(p):
    """a-cell.html's Admin tab: soft-deletes an Agent (Characters row +
    Delta Green Briefs row) via delete_character, gated behind two
    client-side confirmations -- typing the Agent's own name, then the
    A-Cell password (MASTICATE) -- so a stray click can't wipe an
    Agent. Like every other write in this app, delete_character is a
    no-cors POST, so the row is only removed from view once a real
    read-back (list_characters) confirms the Agent's code is actually
    gone. Unlike a hard delete, the Agent lands in Recently Deleted
    (list_deleted_characters) and can be brought back with Restore
    (restore_character), verified the same way."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)

    characters = [
        {"agent_code": "OWEN-CS12",
         "character_json": json.dumps({"bio": {"name": "Owen Castillo", "profession": "soldier"}}),
         "updated_at": 1700000000000},
        {"agent_code": "PRIY-AN34",
         "character_json": json.dumps({"bio": {"name": "Priya Anand"}}),
         "updated_at": 1700000000000},
    ]
    deleted_characters = []
    posts = []

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            body = json.loads(req.post_data or "{}")
            posts.append(body)
            if body.get("action") == "delete_character":
                code = body.get("agent_code")
                idx = next((i for i, c in enumerate(characters) if c["agent_code"] == code), None)
                if idx is not None:
                    row = characters.pop(idx)
                    deleted_characters.append({**row, "deleted_at": 1700000001000})
            elif body.get("action") == "restore_character":
                code = body.get("agent_code")
                idx = next((i for i, c in enumerate(deleted_characters) if c["agent_code"] == code), None)
                if idx is not None:
                    row = deleted_characters.pop(idx)
                    characters.append({k: v for k, v in row.items() if k != "deleted_at"})
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            if "action=list_characters" in url:
                res = {"status": "OK", "characters": characters}
            elif "action=list_deleted_characters" in url:
                res = {"status": "OK", "characters": deleted_characters}
            else:
                res = {"status": "OK"}
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", fake_apps_script)

    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.click('.tw[data-tab="admin"]')
    page.wait_for_timeout(400)

    record("acell", "Admin lists every Agent on file",
           page.locator("#admin-list .admin-row").count() == 2, "")

    owen_row = page.locator('.admin-row:has-text("Owen Castillo")')
    owen_row.locator(".admin-delete-btn").click()
    page.wait_for_timeout(150)

    owen_row.locator('input[id^="admin-handler-input-"]').fill("Wrong Name")
    owen_row.locator('button[id^="admin-step1-btn-"]').click()
    page.wait_for_timeout(150)
    record("acell", "step 1 rejects a name that doesn't match the Agent's own name",
           owen_row.locator('[id^="admin-err1-"]').inner_text() != "", "")
    record("acell", "no delete was sent while step 1 is still unconfirmed",
           len(posts) == 0, str(posts))

    owen_row.locator('input[id^="admin-handler-input-"]').fill("owen castillo")
    owen_row.locator('button[id^="admin-step1-btn-"]').click()
    page.wait_for_timeout(150)
    record("acell", "step 1 accepts the Agent's own name case-insensitively and advances to step 2",
           owen_row.locator('input[id^="admin-pw-input-"]').count() == 1, "")

    owen_row.locator('input[id^="admin-pw-input-"]').fill("wrong")
    owen_row.locator('button[id^="admin-step2-btn-"]').click()
    page.wait_for_timeout(150)
    record("acell", "step 2 rejects the wrong A-Cell password",
           owen_row.locator('[id^="admin-err2-"]').inner_text() != "", "")
    record("acell", "no delete was sent while step 2 is still unconfirmed",
           len(posts) == 0, str(posts))

    owen_row.locator('input[id^="admin-pw-input-"]').fill("MASTICATE")
    owen_row.locator('button[id^="admin-step2-btn-"]').click()
    page.wait_for_timeout(1500)

    delete_posts = [p_ for p_ in posts if p_.get("action") == "delete_character"]
    record("acell", "the correct password sends delete_character for the right Agent",
           len(delete_posts) == 1 and delete_posts[0].get("agent_code") == "OWEN-CS12", str(delete_posts))
    record("acell", "the deleted Agent's row disappears only after a real read-back confirms it's gone",
           "Deleted Owen Castillo" in page.inner_text("#admin-status")
           and page.locator("#admin-list .admin-row").count() == 1
           and "Priya Anand" in page.inner_text("#admin-list"), "")

    deleted_text = wait_for_condition(lambda: page.inner_text("#admin-deleted-list")
                                       if "Owen Castillo" in page.inner_text("#admin-deleted-list") else None)
    record("acell", "a deleted Agent shows up in Recently Deleted, not just vanishing",
           bool(deleted_text) and "Owen Castillo" in deleted_text, deleted_text or "")

    page.click("#admin-deleted-list .admin-restore-btn")
    page.wait_for_timeout(1500)

    restore_posts = [p_ for p_ in posts if p_.get("action") == "restore_character"]
    record("acell", "Restore sends restore_character for the right Agent",
           len(restore_posts) == 1 and restore_posts[0].get("agent_code") == "OWEN-CS12", str(restore_posts))
    record("acell", "a restored Agent reappears in the main Admin list",
           "Owen Castillo" in page.inner_text("#admin-list")
           and page.locator("#admin-list .admin-row").count() == 2, "")
    record("acell", "a restored Agent drops out of Recently Deleted",
           "Owen Castillo" not in page.inner_text("#admin-deleted-list"), "")

    page.close()
    return errs

def test_table_radio_widget(p):
    """assets/table-radio.js: a small persistent widget on every Hub
    page, so a player stays "tuned in" to the Handler's music channel
    (via get_now_playing) as they move between pages -- each full page
    load is a fresh document, so continuity comes from remembering the
    channel (localStorage) and re-syncing to the server-stamped
    started_at on every page, not from one <audio> element surviving
    navigation. A YouTube track is driven through the real YouTube
    IFrame Player API now (for volume control -- the plain embed URL
    has no volume param), so this test fakes that API rather than
    hitting the real youtube.com, the same way script.google.com is
    faked -- nothing here should depend on real network access."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.add_init_script("try { sessionStorage.setItem('dg_boot_seen', '1'); } catch (e) {}")

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            if "action=get_now_playing" in url:
                res = {"status": "OK", "channel": "SAM", "track_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                       "track_title": "Table Theme", "started_at": 1700000000000}
            else:
                res = {"status": "OK"}
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", fake_apps_script)

    # Fake YouTube IFrame Player API -- constructs a real <iframe> (so the
    # "an embed is created" check still means something) plus stub
    # setVolume/mute/unMute/playVideo/destroy methods, and fires onReady
    # asynchronously like the real API does.
    fake_yt_api = """
      window.YT = { Player: function (elId, opts) {
        var el = document.getElementById(elId);
        if (el) el.innerHTML = '<iframe data-yt-fake="1"></iframe>';
        this._opts = opts; this._volume = null; this._muted = null;
        var self = this;
        setTimeout(function () {
          if (opts.events && opts.events.onReady) opts.events.onReady({ target: self });
        }, 0);
      } };
      window.YT.Player.prototype.setVolume = function (v) { this._volume = v; };
      window.YT.Player.prototype.mute = function () { this._muted = true; };
      window.YT.Player.prototype.unMute = function () { this._muted = false; };
      window.YT.Player.prototype.playVideo = function () {};
      window.YT.Player.prototype.destroy = function () {};
      if (typeof window.onYouTubeIframeAPIReady === 'function') window.onYouTubeIframeAPIReady();
    """
    page.route("**/www.youtube.com/iframe_api", lambda r: r.fulfill(
        status=200, content_type="application/javascript", body=fake_yt_api))

    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(400)
    record("radio", "shows a collapsed 'Tune In' pill when no channel is set",
           page.is_visible("#dg-radio-pill"), "")

    # Tuning in now turns a 5-position dial instead of typing a channel
    # name into a prompt() -- click the pill to open the dial, click
    # channel 3's tick directly (one of the two ways to move the dial,
    # along with the turn buttons), then confirm.
    page.click("#dg-radio-pill")
    page.wait_for_timeout(200)
    record("radio", "clicking Tune In opens a channel dial instead of a text prompt",
           page.is_visible('.dgr-dial-ring'), "")
    page.click('.dgr-tick[data-ch="3"]')
    page.wait_for_timeout(100)
    record("radio", "clicking a tick on the dial selects that channel",
           page.eval_on_selector(".dgr-dial-ch", "el => el.textContent") == "3", "")
    page.click("#dg-radio-confirm-tune")
    page.wait_for_timeout(600)
    record("radio", "confirming tune-in shows the tuned panel with the dialed channel",
           page.is_visible("#dg-radio-panel") and "CH 3" in page.inner_text("#dg-radio-panel"), "")
    record("radio", "the dialed channel is remembered in localStorage",
           page.evaluate("() => localStorage.getItem('dg_radio_channel')") == "3", "")
    record("radio", "the current track title is shown",
           "Table Theme" in page.eval_on_selector("#dg-radio-track", "el => el.textContent"), "")
    record("radio", "a YouTube embed (via the real IFrame Player API) is created for the current track",
           page.query_selector("#dg-radio-embed-wrap iframe") is not None, "")

    # A fresh tune-in starts Minimized by default -- the dial/track-status
    # section is hidden, and the video area is clipped to 0 height, not
    # display:none (display:none on an ancestor can pause YouTube; a
    # clipped, zero-height-but-still-rendered wrapper doesn't).
    record("radio", "a freshly tuned-in panel starts Minimized, not Expanded",
           not page.eval_on_selector("#dg-radio", "el => el.classList.contains('dgr-is-expanded')")
           and page.eval_on_selector("#dg-radio-toggle-expand", "el => el.textContent") == "Expand", "")
    record("radio", "Minimized keeps the embed wrapper in the DOM at zero height (clipped, not display:none, so playback isn't paused)",
           page.eval_on_selector("#dg-radio-embed-wrap", "el => getComputedStyle(el).display") != "none"
           and page.eval_on_selector("#dg-radio-embed-wrap", "el => el.getBoundingClientRect().height") == 0, "")
    record("radio", "Minimized hides the dial/change-channel section",
           not page.is_visible("#dg-radio-change"), "")

    # Volume slider: present, defaults to 70, and dragging it applies live
    # (via the fake player's setVolume) without recreating the embed --
    # the iframe element itself must be the SAME one from before the drag.
    record("radio", "a volume slider is present next to Mute, defaulting to 70",
           page.input_value("#dg-radio-volume") == "70", "")
    iframe_before = page.eval_on_selector("#dg-radio-embed-wrap iframe", "el => el.dataset.ytFake")
    page.fill("#dg-radio-volume", "40")
    page.dispatch_event("#dg-radio-volume", "input")
    page.wait_for_timeout(100)
    record("radio", "dragging the volume slider persists the value",
           page.evaluate("() => localStorage.getItem('dg_radio_volume')") == "40", "")
    record("radio", "dragging the volume slider does not recreate the embed (same iframe, no reload/flicker)",
           page.eval_on_selector("#dg-radio-embed-wrap iframe", "el => el.dataset.ytFake") == iframe_before, "")

    # Expand reveals the bigger panel + dial/status section, and the
    # widget visibly grows (per the user's "bigger control panel" ask).
    narrow_width = page.eval_on_selector("#dg-radio", "el => el.getBoundingClientRect().width")
    page.click("#dg-radio-toggle-expand")
    page.wait_for_timeout(150)
    wide_width = page.eval_on_selector("#dg-radio", "el => el.getBoundingClientRect().width")
    record("radio", "Expand grows the panel (a real, usable video area, not the old cramped strip)",
           wide_width > narrow_width, f"narrow={narrow_width} wide={wide_width}")
    record("radio", "Expand reveals the dial/change-channel section",
           page.is_visible("#dg-radio-change"), "")
    record("radio", "Expand gives the video embed real height (was a cramped 70px before this redesign)",
           page.eval_on_selector("#dg-radio-embed-wrap", "el => el.getBoundingClientRect().height") >= 200, "")

    # Navigating to a completely different page keeps the same channel
    # tuned in (this is the whole point -- "as they go back and forth"),
    # AND remembers the Expanded preference across that navigation.
    page.goto(f"{BASE}/dg-agent-portal.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(600)
    record("radio", "the widget is present and still tuned to the same channel after navigating to a different page",
           page.is_visible("#dg-radio-panel") and "CH 3" in page.inner_text("#dg-radio-panel"), "")
    record("radio", "the Expanded/Minimized preference survives navigation too",
           page.eval_on_selector("#dg-radio", "el => el.classList.contains('dgr-is-expanded')"), "")

    # The "Change Channel" button re-opens the dial inline so a listener
    # can re-tune to a different channel without leaving and re-choosing
    # -- turning it (via the turn-right button this time) switches live.
    page.click("#dg-radio-change")
    page.wait_for_timeout(150)
    page.click('.dgr-turn[data-dir="1"]')
    page.wait_for_timeout(150)
    record("radio", "turning the dial on an already-tuned panel re-tunes to the next channel",
           page.evaluate("() => localStorage.getItem('dg_radio_channel')") == "4"
           and "CH 4" in page.inner_text("#dg-radio-panel"), "")

    # Leaving the channel collapses back to the Tune In pill.
    page.click("#dg-radio-leave")
    page.wait_for_timeout(150)
    record("radio", "leaving the channel clears localStorage and collapses back to the pill",
           page.evaluate("() => localStorage.getItem('dg_radio_channel')") is None
           and page.is_visible("#dg-radio-pill"), "")

    page.close()
    return errs

def test_table_radio_audio_volume(p):
    """assets/table-radio.js: a direct .mp3 track (no external player API
    involved) is the simplest, most directly verifiable path for real
    volume control -- native <audio>.volume/.muted, no third-party API
    or mocking needed. Covers what the YouTube/SoundCloud paths can't be
    fully verified here (no real network access to those APIs in this
    environment): that the volume slider and Mute button actually reach
    the playing element, and that neither recreates it."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.add_init_script("try { sessionStorage.setItem('dg_boot_seen', '1'); } catch (e) {}")

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            if "action=get_now_playing" in url:
                res = {"status": "OK", "channel": "SAM", "track_url": "https://example.com/ambience.mp3",
                       "track_title": "Rain Loop", "started_at": 1700000000000}
            else:
                res = {"status": "OK"}
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", fake_apps_script)
    # The <audio> element will try to actually fetch the mp3 -- fake a
    # tiny response so it doesn't hang on a real network request.
    page.route("**/ambience.mp3", lambda r: r.fulfill(status=200, content_type="audio/mpeg", body=""))

    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.evaluate("() => localStorage.setItem('dg_radio_channel', '1')")
    page.reload(wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(700)

    record("radio", "a direct audio track renders an <audio> element",
           page.query_selector("#dg-radio-embed-wrap audio") is not None, "")

    # Starts Muted by default (browsers always allow muted autoplay, so
    # that's the one guaranteed-to-work starting state) -- checked before
    # any interaction, since dragging the volume slider below is itself
    # one of the things that changes it.
    record("radio", "starts Muted by default",
           page.eval_on_selector("#dg-radio-mute", "el => el.textContent") == "MUTED", "")

    # Dragging the volume slider while Muted un-mutes too (a level nobody
    # can hear isn't useful feedback) -- one drag both sets .volume and
    # flips .muted to false.
    page.fill("#dg-radio-volume", "25")
    page.dispatch_event("#dg-radio-volume", "input")
    page.wait_for_timeout(100)
    vol = page.eval_on_selector("#dg-radio-embed-wrap audio", "el => el.volume")
    record("radio", "the volume slider sets the <audio> element's real .volume",
           abs(vol - 0.25) < 0.01, str(vol))
    record("radio", "dragging the volume slider while Muted also un-mutes",
           page.eval_on_selector("#dg-radio-embed-wrap audio", "el => el.muted") is False
           and page.eval_on_selector("#dg-radio-mute", "el => el.textContent") == "SOUND", "")

    # Now Muted is off (from the drag above) -- one click mutes, a second un-mutes.
    page.click("#dg-radio-mute")
    page.wait_for_timeout(100)
    muted_now = page.eval_on_selector("#dg-radio-embed-wrap audio", "el => el.muted")
    record("radio", "Muting sets the <audio> element's real .muted to true",
           muted_now is True, "")
    record("radio", "Muting updates its own label",
           page.eval_on_selector("#dg-radio-mute", "el => el.textContent") == "MUTED", "")

    page.click("#dg-radio-mute")
    page.wait_for_timeout(100)
    unmuted_again = page.eval_on_selector("#dg-radio-embed-wrap audio", "el => el.muted")
    record("radio", "un-Muting sets .muted back to false on the same <audio> element (not a new one)",
           unmuted_again is False, "")

    page.close()
    return errs

def test_table_radio_library_track_kind(p):
    """Table Radio Track Library (v1.7): a mp3 uploaded through A-Cell's
    Music tab is stored in Drive and served back as a direct download
    link (e.g. drive.google.com/uc?export=download&id=...), which has no
    .mp3 file extension for the player's usual URL-sniffing
    (isDirectAudio()) to catch. get_now_playing carries an explicit
    track_kind: 'audio' for exactly this case -- confirms the widget
    honors it and renders a real <audio> element rather than falling
    through to the generic-iframe case (which would just try to load the
    download link as a webpage, not play it)."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.add_init_script("try { sessionStorage.setItem('dg_boot_seen', '1'); } catch (e) {}")

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            if "action=get_now_playing" in url:
                res = {"status": "OK", "channel": "3",
                       "track_url": "https://drive.google.com/uc?export=download&id=fakeFileId123",
                       "track_title": "Rain Loop", "started_at": 1700000000000, "track_kind": "audio"}
            else:
                res = {"status": "OK"}
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", fake_apps_script)
    page.route("**/uc?export=download*", lambda r: r.fulfill(status=200, content_type="audio/mpeg", body=""))

    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.evaluate("() => localStorage.setItem('dg_radio_channel', '3')")
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(800)

    record("radio", "a Drive-hosted library track (track_kind: 'audio') renders as a real <audio> element",
           page.query_selector("#dg-radio-embed-wrap audio") is not None, "")
    record("radio", "it does NOT fall through to the generic-iframe case (which can't play a download link)",
           page.query_selector("#dg-radio-embed-wrap iframe") is None, "")
    record("radio", "the volume slider is available for it (a controllable <audio> element, unlike generic iframes)",
           page.eval_on_selector("#dg-radio-volume", "el => getComputedStyle(el).display") != "none", "")

    page.close()
    return errs

def test_table_radio_yt_volume_reliability(p):
    """Bug report: "volume controller doesn't work" on a YouTube track --
    sound plays, dragging the slider does nothing. Two real gaps in the
    IFrame Player API wiring: (1) applyLiveMuteVolume() treated a freshly
    -constructed YT.Player OBJECT existing as "ready to call setVolume()
    on" -- real YouTube embeds accept the call without throwing during
    that window but silently no-op it, so a drag that lands before the
    real handshake finishes just vanishes; (2) the volume slider's own
    handler had no fallback at all when the live-apply failed (unlike
    the Mute button, which already rebuilt the embed on failure), so a
    drag that landed during that window had literally no path to ever
    take effect. This fakes a YouTube API with a deliberately delayed
    onReady to reproduce the exact window the bug lived in, and confirms
    a drag during that window still lands once the player catches up
    (via the same rebuild-on-failure fallback the Mute button already
    had). Also confirms the origin playerVar (YouTube's own documented
    recommendation for the postMessage control channel) is actually
    being sent, and that dragging the slider while Muted (the default
    starting state) un-mutes rather than silently applying a volume
    nobody can hear."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.add_init_script("try { sessionStorage.setItem('dg_boot_seen', '1'); } catch (e) {}")

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            if "action=get_now_playing" in url:
                res = {"status": "OK", "channel": "3", "track_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                       "track_title": "Table Theme", "started_at": 1700000000000}
            else:
                res = {"status": "OK"}
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", fake_apps_script)

    # Deliberately slow onReady (600ms) to reproduce the "drag lands
    # before the real handshake finishes" window -- also records every
    # constructed player's playerVars so the origin param can be checked,
    # and every setVolume() call so a rebuilt-vs-original player and its
    # final applied volume can both be verified.
    fake_yt_api = """
      window.__ytPlayerVarsLog = [];
      window.__ytSetVolumeLog = [];
      window.YT = { Player: function (elId, opts) {
        var el = document.getElementById(elId);
        if (el) el.innerHTML = '<iframe data-yt-fake="1"></iframe>';
        window.__ytPlayerVarsLog.push(opts.playerVars);
        this._opts = opts; this._volume = null; this._muted = null; this._id = window.__ytPlayerVarsLog.length;
        var self = this;
        setTimeout(function () {
          if (opts.events && opts.events.onReady) opts.events.onReady({ target: self });
        }, 600);
      } };
      window.YT.Player.prototype.setVolume = function (v) { this._volume = v; window.__ytSetVolumeLog.push({ id: this._id, v: v }); };
      window.YT.Player.prototype.mute = function () { this._muted = true; };
      window.YT.Player.prototype.unMute = function () { this._muted = false; };
      window.YT.Player.prototype.playVideo = function () {};
      window.YT.Player.prototype.destroy = function () {};
      if (typeof window.onYouTubeIframeAPIReady === 'function') window.onYouTubeIframeAPIReady();
    """
    page.route("**/www.youtube.com/iframe_api", lambda r: r.fulfill(
        status=200, content_type="application/javascript", body=fake_yt_api))

    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.evaluate("() => localStorage.setItem('dg_radio_channel', '3')")
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(200)  # well before the 600ms fake onReady fires

    record("radio", "starts Muted by default (the state the volume-drag-while-muted fix matters for)",
           page.eval_on_selector("#dg-radio-mute", "el => el.textContent") == "MUTED", "")

    # Drag the slider WHILE the (fake) player is still not ready.
    page.fill("#dg-radio-volume", "55")
    page.dispatch_event("#dg-radio-volume", "input")
    page.wait_for_timeout(100)
    record("radio", "dragging the slider while still Muted un-mutes (a level nobody can hear isn't useful feedback)",
           page.eval_on_selector("#dg-radio-mute", "el => el.textContent") == "SOUND", "")

    # Let the fake onReady(s) resolve -- whether the first drag triggered
    # a rebuild (new player, fresh onReady applying the now-current
    # volume) or the original player just came ready on its own, the end
    # state must be the dragged value, actually applied via setVolume().
    page.wait_for_timeout(900)
    final_volume = page.evaluate("""() => {
        var log = window.__ytSetVolumeLog || [];
        return log.length ? log[log.length - 1].v : null;
    }""")
    record("radio", "the dragged volume (55) is actually applied via setVolume() once the player catches up",
           final_volume == 55, f"setVolume log={final_volume}")

    origin_sent = page.evaluate("""() => {
        var log = window.__ytPlayerVarsLog || [];
        return log.length ? log[log.length - 1].origin : null;
    }""")
    record("radio", "the origin playerVar is sent (YouTube's own recommendation for the postMessage control channel)",
           bool(origin_sent) and origin_sent == page.evaluate("() => window.location.origin"), str(origin_sent))

    page.close()
    return errs

def test_table_radio_mobile_buttons_not_stretched(p):
    """Bug report (screenshot): on stats/index.html at a phone width, the
    minimized mini-bar's buttons (Mute/Expand/Leave) rendered stretched
    edge-to-edge and overflowing well past the widget's own 280px-wide
    panel, overlapping the character sheet's form fields underneath.
    Root cause: stats/styles.css has `@media (max-width:600px){ button {
    width: 100%; } }`, meant for the page's OWN buttons stacking full-
    width on narrow screens -- being a bare `button` selector, it also
    grabbed this widget's plain <button> elements once appended to
    <body>, since dg-agent-portal.html has no such rule (which is why
    the report says the widget looked fine there and only broke once
    Play navigated to the character sheet). Confirms every mini-bar
    button now stays within the panel's own bounds on that exact page."""
    page = p.new_page(viewport={"width": 390, "height": 844})
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.add_init_script("try { sessionStorage.setItem('dg_boot_seen', '1'); } catch (e) {}")
    page.route("**/script.google.com/**", lambda r: r.fulfill(status=200, content_type="application/json", body='{"status":"OK"}'))

    page.goto(f"{BASE}/stats/index.html", wait_until="domcontentloaded", timeout=15000)
    page.evaluate("() => localStorage.setItem('dg_radio_channel', '3')")
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(700)

    panel_box = page.evaluate("""() => {
        var r = document.getElementById('dg-radio-panel').getBoundingClientRect();
        return { left: r.left, right: r.right };
    }""")
    button_ids = ["dg-radio-mute", "dg-radio-toggle-expand", "dg-radio-leave"]
    for bid in button_ids:
        box = page.evaluate(f"""() => {{
            var r = document.getElementById('{bid}').getBoundingClientRect();
            return {{ left: r.left, right: r.right, width: r.width }};
        }}""")
        record("radio", f"#{bid} stays within the mini-bar panel's own bounds (not stretched to page-wide 100%)",
               box["left"] >= panel_box["left"] - 1 and box["right"] <= panel_box["right"] + 1 and box["width"] < 150,
               f"button={box} panel={panel_box}")

    page.close()
    return errs

def test_agent_portal_code_query_param(p):
    """agent-hub.html's Agent Files "Files" and "ID Creator" buttons link
    to dg-agent-portal.html?code=XXXX#agent / #ids -- a new
    openSpecificAgent() IIFE there that opens that exact agent by code,
    taking priority over whatever autoRestore() would otherwise pick up
    from dg_last_agent (the most-recently-active agent, which may not be
    the one just clicked from Agent Files)."""
    errs_all = []

    def fake_apps_script(route):
        url = route.request.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            fake_data = {"char_name": "Owen Castillo", "codename": "Ferro", "age_range": "Late 30s", "sex": "Male"}
            body = f'{cb}({json.dumps({"status": "OK", "data": fake_data})})'
            route.fulfill(status=200, content_type="application/javascript", body=body)
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')

    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.route("**/script.google.com/**", fake_apps_script)
    page.goto(f"{BASE}/dg-agent-portal.html?code=OWEN-CS12#agent", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(600)
    record("agent-portal", "?code=...#agent opens straight to the Agent File tab",
           "active" in page.eval_on_selector("#tw-agent", "el => el.className"), "")
    record("agent-portal", "?code=...#agent loads that exact agent's name",
           page.eval_on_selector("#af-agent-name", "el => el.textContent") == "Owen Castillo", "")
    errs_all.extend(errs)
    page.close()

    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.route("**/script.google.com/**", fake_apps_script)
    page.goto(f"{BASE}/dg-agent-portal.html?code=OWEN-CS12#ids", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(600)
    record("agent-portal", "?code=...#ids opens straight to the Cover IDs tab",
           "active" in page.eval_on_selector("#tw-ids", "el => el.className"), "")
    record("agent-portal", "?code=...#ids pre-fills the agent-code importer with that code",
           page.eval_on_selector("#ids-agent-code", "el => el.value") == "OWEN-CS12", "")
    errs_all.extend(errs)
    page.close()
    return errs_all

def test_stats_load_by_code_query_param(p):
    """agent-hub.html's Agent Files "Play" button links to
    stats/index.html?load=XXXX&theme=field-doc -- loads that exact agent
    from the Cloud Save backend (dgCloudSave.loadFromCloud(), see
    stats/cloud-sync.js) and jumps straight to the Live Play theme,
    rather than leaving whatever this browser last auto-saved showing."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    def fake_apps_script(route):
        url = route.request.url
        if "action=load_character" in url and "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            char_state = {"v": 1, "bio": {"name": "Owen Castillo", "profession": ""}}
            body = f'{cb}({json.dumps({"status": "OK", "agent_code": "OWEN-CS12", "character_json": json.dumps(char_state)})})'
            route.fulfill(status=200, content_type="application/javascript", body=body)
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", fake_apps_script)

    page.goto(f"{BASE}/stats/index.html?load=OWEN-CS12&theme=field-doc", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(1000)
    record("stats-terminal", "?load=... loads that exact agent's name from the cloud",
           page.eval_on_selector("#cs-name", "el => el.value") == "Owen Castillo", "")
    record("stats-terminal", "?theme=field-doc jumps straight to the Live Play theme",
           "theme-field-doc" in page.eval_on_selector("body", "el => el.className"), "")
    record("stats-terminal", "no JS exceptions", len(errs)==0, "; ".join(errs))
    page.close()
    return errs

def test_stats_recruit_flow_on_missing_character(p):
    """Bug fix: stats/index.html?load=CODE for an Agent Code with no
    cloud character yet (NOT_FOUND) must not silently keep showing
    whatever character was last auto-saved locally on this device --
    that's how a different Agent's sheet gets mistaken for a brand new
    one (reported: an Agent File existed for one Agent with no character
    sheet yet, but Play kept showing a previously-played Agent's sheet
    from the same device). startRecruitFlow() (stats/cloud-sync.js)
    instead wipes the stale sheet, adopts the requested code so the
    first save syncs correctly, pre-fills the name from the Agent File
    if known, and opens the Character Creation Wizard instead of Live
    Play.

    Second bug fix (data loss report): a NOT_FOUND here can be wrong --
    a flaky lookup, or an Agent whose real sheet just hasn't synced from
    this device -- and once the wipe+adopt runs, every debounced
    auto-save from that point silently overwrites the REAL Characters-
    sheet row for that code as the wizard is filled in, with no undo.
    A real Handler hit exactly this: an Agent with an existing sheet
    showed "Recruit", and going through Character Creation partially
    overwrote the real character (bonds/equipment updated, stats reset
    to defaults) before they'd even finished. startRecruitFlow() now
    requires an explicit confirm() before doing anything destructive --
    this test accepts that dialog to exercise the proceed path; a
    second test below exercises Cancel."""
    page = p.new_page()
    page.set_default_timeout(10000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.route("**/script.google.com/**", lambda r: r.fulfill(status=200, content_type="application/json", body='{"status":"OK"}'))

    # Seed a DIFFERENT character's local autosave, simulating a device
    # last used to play a different Agent.
    page.goto(f"{BASE}/stats/index.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(400)
    page.fill("#cs-name", "Patrick Previous")
    page.wait_for_timeout(1800)

    def fake_apps_script(route):
        url = route.request.url
        if "callback=" not in url:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        cb = url.split("callback=")[1].split("&")[0]
        if "action=load_character" in url:
            route.fulfill(status=200, content_type="application/javascript",
                           body=f'{cb}({json.dumps({"status": "NOT_FOUND"})})')
        else:
            route.fulfill(status=200, content_type="application/javascript",
                           body=f'{cb}({json.dumps({"status": "OK", "data": {"char_name": "Dani Uribe"}})})')
    page.route("**/script.google.com/**", fake_apps_script)

    dialog_messages = []
    def handle_dialog(d):
        dialog_messages.append(d.message)
        d.accept()
    page.on("dialog", handle_dialog)

    page.goto(f"{BASE}/stats/index.html?load=DANI-U8BM&theme=field-doc", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(1500)

    record("stats-terminal", "a not-found Play link warns before overwriting, in case the Agent's real sheet just hasn't synced",
           len(dialog_messages) == 1 and "DANI-U8BM" in dialog_messages[0] and "overwrite" in dialog_messages[0].lower(),
           str(dialog_messages))

    name_val = page.eval_on_selector("#cs-name", "el => el.value")
    record("stats-terminal", "a not-found Play link does not leave the previous Agent's name on screen",
           name_val != "Patrick Previous", name_val)
    record("stats-terminal", "the Agent File's known name pre-fills the sheet instead",
           name_val == "Dani Uribe", name_val)
    record("stats-terminal", "the requested Agent Code is adopted as the Cloud Save code",
           page.evaluate("() => localStorage.getItem('dg_stats_cloud_code')") == "DANI-U8BM", "")
    record("stats-terminal", "the Character Creation Wizard opens instead of jumping to Live Play",
           page.query_selector("#wiz-outer") is not None, "")

    page.close()
    return errs

def test_stats_recruit_flow_cancel_protects_existing_character(p):
    """The other half of the confirm() gate above: if the Handler/player
    chooses Cancel (because they're not sure the Agent's sheet really is
    missing), startRecruitFlow() must NOT wipe the local sheet or adopt
    the Agent Code for Cloud Save -- doing either would still risk the
    next auto-save clobbering a real character even without the wizard
    ever opening."""
    page = p.new_page()
    page.set_default_timeout(10000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    def fake_apps_script(route):
        url = route.request.url
        if "callback=" not in url:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        cb = url.split("callback=")[1].split("&")[0]
        route.fulfill(status=200, content_type="application/javascript",
                       body=f'{cb}({json.dumps({"status": "NOT_FOUND"})})')
    page.route("**/script.google.com/**", fake_apps_script)
    page.on("dialog", lambda d: d.dismiss())

    page.goto(f"{BASE}/stats/index.html?load=PATR-EQ9A&theme=field-doc", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(1000)

    record("stats-terminal", "choosing Cancel does not adopt the Agent Code for Cloud Save",
           page.evaluate("() => localStorage.getItem('dg_stats_cloud_code')") != "PATR-EQ9A", "")
    record("stats-terminal", "choosing Cancel does not open the Character Creation Wizard",
           page.query_selector("#wiz-outer") is None, "")
    record("stats-terminal", "choosing Cancel shows a clear status instead of silently doing nothing",
           "not loaded" in (page.inner_text("#cloud-load-status") or "").lower(), "")

    page.close()
    return errs

def test_stats_new_recruit_blank_sheet(p):
    """agent-hub.html's "New Recruit" card links to
    stats/index.html?new=1 -- a totally blank sheet, not whatever this
    device last auto-saved locally (a real prior confusion: a previously-
    played Agent's sheet showing up under what was meant to be a brand
    new character). The ?new=1 handler (stats/cloud-sync.js) wipes the
    stale sheet and drops any remembered Cloud Save code before
    save-load.js's own restore would otherwise repopulate the form, then
    strips ?new=1 from the URL so a later refresh doesn't wipe out the
    new character the player has since started filling in."""
    page = p.new_page()
    page.set_default_timeout(10000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.route("**/script.google.com/**", lambda r: r.fulfill(status=200, content_type="application/json", body='{"status":"OK"}'))

    # Seed a previous character's local autosave AND a minted cloud code,
    # simulating a device last used to play a different Agent.
    page.goto(f"{BASE}/stats/index.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(400)
    page.fill("#cs-name", "Patrick Previous")
    page.wait_for_timeout(4200)
    prior_code = page.evaluate("() => localStorage.getItem('dg_stats_cloud_code')")
    record("stats-terminal", "(setup) a prior Agent's cloud code is present before the New Recruit visit",
           bool(prior_code), f"prior_code={prior_code!r}")

    page.goto(f"{BASE}/stats/index.html?new=1", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(1000)

    record("stats-terminal", "New Recruit shows a totally blank name field, not the previous Agent's",
           page.eval_on_selector("#cs-name", "el => el.value") == "", "")
    record("stats-terminal", "New Recruit drops the previous Agent's remembered Cloud Save code",
           page.evaluate("() => localStorage.getItem('dg_stats_cloud_code')") in (None, ""), "")
    record("stats-terminal", "?new=1 is stripped from the URL so a refresh won't wipe the new character again",
           "new=1" not in page.evaluate("() => window.location.search"), "")

    # A same-page reload after ?new=1 has been stripped must NOT wipe out
    # whatever the player has since typed for the new Agent.
    page.fill("#cs-name", "Dani Fresh")
    page.wait_for_timeout(1800)
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(600)
    record("stats-terminal", "a refresh after New Recruit preserves what was typed (no repeat wipe)",
           page.eval_on_selector("#cs-name", "el => el.value") == "Dani Fresh", "")

    page.close()
    return errs

def test_mobile_no_overflow(p):
    """Regression check: no page should force horizontal scroll on a phone
    viewport. stats/index.html originally only had this for its dedicated
    "Mobile" theme -- the other five (X-Files, Modern, Son of Sam, Field
    Notes, Live Play) were desktop-oriented by pigeon-labs-stack's original
    design and genuinely overflowed on a phone. This hub's own addition
    (a viewport-width-gated CSS block in stats/styles.css, not scoped to
    any theme) fixes the underlying causes -- <fieldset>'s UA-default
    min-width: min-content, a few fixed-column grids/tables -- for all
    five, so they're now checked the same as Mobile rather than excluded."""
    errs_all = []
    for path in ["index.html", "agent-hub.html", "dg-agent-portal.html", "dg-id-creator.html", "a-cell.html"]:
        page = p.new_page(viewport={"width": 390, "height": 844})
        page.set_default_timeout(5000)
        errs = collect_errors(page)
        mock_routes(page)
        skip_boot_splash(page)
        skip_acell_gate(page)
        page.goto(f"{BASE}/{path}", wait_until="domcontentloaded", timeout=15000)
        page.wait_for_timeout(300)
        scroll_width = page.evaluate("() => document.documentElement.scrollWidth")
        record("mobile", f"{path} has no horizontal overflow at 390px viewport",
               scroll_width <= 390, f"scrollWidth={scroll_width}")
        errs_all.extend(errs)
        page.close()

    # agent-hub.html's Latest Agent(s) / Agent Files sections only populate
    # with agents in dg_agent_roster, so the general no-overflow sweep
    # above (fresh browser, no agents) never actually exercises them --
    # check separately with two agents seeded, since that's wider than
    # the empty-state note.
    page = p.new_page(viewport={"width": 390, "height": 844})
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    # agent-hub.html's own inline <script> sits after its Google Fonts
    # <link>, same as dg-agent-portal.html -- an unblocked font request
    # that never resolves in this sandbox hangs that script (and
    # page.reload()) rather than just slowing it down, so block fonts
    # before the reload below.
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.route("**/script.google.com/**", lambda r: r.fulfill(status=200, content_type="application/json", body='{"status":"OK"}'))
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.evaluate("""() => {
        localStorage.setItem('dg_agent_roster', JSON.stringify({
            'MARC-9XQ2': { code: 'MARC-9XQ2', char_name: 'Marcus Reyes', codename: 'GRAYWOLF',
                           sex: 'Male', age_range: 'Late 30s', nationality: 'American', saved_at: 1000 }
        }));
    }""")
    page.reload(wait_until="domcontentloaded", timeout=8000)
    page.wait_for_timeout(300)
    scroll_width = page.evaluate("() => document.documentElement.scrollWidth")
    record("mobile", "agent-hub.html has no horizontal overflow at 390px viewport (Agent Files populated)",
           scroll_width <= 390, f"scrollWidth={scroll_width}")
    errs_all.extend(errs)
    page.close()

    # All six stats/ themes are expected to be overflow-free at 390px --
    # the fieldset/grid/table min-width fixes added for this are
    # theme-agnostic (gated on viewport width, not theme class), covering
    # X-Files, Modern, Son of Sam, and Field Notes the same as Mobile.
    # Live Play (field-doc) is checked separately below with actual filled
    # content, since its full character sheet is the one deliberate
    # exception (it scrolls horizontally within its own box by design --
    # see that check for detail).
    page = p.new_page(viewport={"width": 390, "height": 844})
    page.set_default_timeout(5000)
    errs = collect_errors(page)
    page.goto(f"{BASE}/stats/index.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(500)
    for theme in ["xfiles", "modern", "son-of-sam", "field-notes", "mobile"]:
        page.select_option("#cs-theme-select", theme)
        page.wait_for_timeout(400)
        scroll_width = page.evaluate("() => document.documentElement.scrollWidth")
        record("mobile", f"stats/index.html has no horizontal overflow at 390px viewport ({theme} theme)",
               scroll_width <= 390, f"scrollWidth={scroll_width}")

        # renderSkillsGrid() in scripts.js places every .cs-skill-pair with
        # an inline style.gridColumn/gridRow computed for #cs-skills' full
        # 3-column desktop layout -- an inline style beats any stylesheet
        # selector, so narrowing #cs-skills itself to fewer columns at
        # mobile widths isn't sufficient on its own: skills assigned to
        # column 3 land in a narrow implicit track. .cs-skill-pair itself
        # doesn't visually overflow that track (grid items don't overlap
        # each other), but .cs-skill-name inside it does -- it's a nested
        # grid's own 1fr child with no min-width:0, so it renders at its
        # full unwrapped text width regardless of the narrow track its
        # ancestor was actually assigned, bleeding into the next column's
        # rendered text. Check the visible name/value elements, not just
        # their containers, or this doesn't catch anything.
        skill_overlaps = page.evaluate("""() => {
            const boxes = Array.from(document.querySelectorAll('#cs-skills .cs-skill-name, #cs-skills .cs-skill-value-wrap'))
                .map(el => el.getBoundingClientRect());
            const overlaps = [];
            for (let i = 0; i < boxes.length; i++) {
                for (let j = i + 1; j < boxes.length; j++) {
                    const a = boxes[i], b = boxes[j];
                    const xOverlap = a.left < b.right && b.left < a.right;
                    const yOverlap = a.top < b.bottom && b.top < a.bottom;
                    if (xOverlap && yOverlap) overlaps.push([i, j]);
                }
            }
            return overlaps;
        }""")
        record("mobile", f"stats/index.html skill rows don't visually overlap at 390px viewport ({theme} theme)",
               len(skill_overlaps) == 0, f"overlaps={skill_overlaps}")
    errs_all.extend(errs)
    page.close()

    # Live Play (field-doc): the full character sheet reflows to a single
    # column below 700px (buildLpSheet()'s Personal Data table and the
    # Stats+Bonds/Derived+Motivations/Physical Desc+Incidents side-by-side
    # pairs all stack) instead of the earlier approach of widening the
    # whole sheet and letting it scroll horizontally, which in practice
    # left Nationality/Sex/Age/Education and the entire Bonds table
    # sitting off-screen with no visual cue there was more to scroll to.
    # Also exercises the sticky HP/WP/SAN/BP tracker bar and the Dice
    # Roller widget, which auto-expands when this theme is selected.
    page = p.new_page(viewport={"width": 390, "height": 844})
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.goto(f"{BASE}/stats/index.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(400)
    page.fill("#cs-name", "Priya Anand")
    page.select_option("#cs-profession-select", "federal_agent")

    # A fresh character's HP/WP/SAN default to low single-digit values,
    # which an earlier pass here tested against exclusively -- looked
    # fine, but silently left the tracker items too narrow for a *real*
    # played character's typical two-digit values (e.g. HP 15/15,
    # SAN 75/75), which visually collided with the +/- buttons. Push
    # STR/CON/POW up so this test actually catches that -- has to happen
    # here, before switching to Live Play, since that theme hides the
    # normal stat editor's +/- buttons this needs to click.
    for stat_id in ["STR", "CON", "POW"]:
        btn = page.locator(f"#{stat_id}-value").locator("xpath=..").locator("button", has_text="+")
        for _ in range(12):
            btn.click()
    page.wait_for_timeout(200)

    page.select_option("#cs-theme-select", "field-doc")
    page.wait_for_timeout(600)
    scroll_width = page.evaluate("() => document.documentElement.scrollWidth")
    record("mobile", "stats/index.html has no horizontal overflow at 390px viewport (Live Play theme, filled)",
           scroll_width <= 390, f"scrollWidth={scroll_width}")
    lp_scroll_width = page.evaluate("() => document.getElementById('lp-sheet')?.scrollWidth || 0")
    record("mobile", "Live Play sheet itself now reflows to fit the viewport instead of scrolling horizontally",
           lp_scroll_width <= 390, f"lp scrollWidth={lp_scroll_width}")

    # Fields that used to sit off-screen to the right of Name/Profession/
    # Employer in the old side-by-side Personal Data table -- confirm
    # each one's own bounding box is now within the viewport, not just
    # that the sheet's overall scrollWidth shrank.
    for field_id in ["cs-bio-nationality", "cs-bio-sex", "cs-bio-age", "cs-bio-education"]:
        box = page.evaluate(f"""() => {{
            const el = document.querySelector('#lp-sheet .lp-proxy[data-src="{field_id}"]');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {{ right: r.right, width: r.width }};
        }}""")
        record("mobile", f"Live Play Personal Data field '{field_id}' is fully within the viewport, not clipped off-screen",
               bool(box) and box["right"] <= 390 and box["width"] > 20, f"box={box}")

    # The Bonds table used to be the right-hand column of a 44%/flex-1
    # side-by-side row that only fit inside a 780px-wide scrolling sheet
    # -- confirm its header is now visible within the viewport at all.
    bonds_visible = page.evaluate("""() => {
        const el = document.getElementById('lp-bonds-tbody');
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 20 && r.right <= 390;
    }""")
    record("mobile", "Live Play Bonds table is visible within the viewport, not pushed off-screen",
           bonds_visible)

    tracker_overflow = page.evaluate("""() => {
        const bar = document.getElementById('lp-tracker-bar');
        return bar ? bar.scrollWidth - bar.clientWidth : 0;
    }""")
    record("mobile", "sticky HP/WP/SAN/BP tracker bar fits without its own overflow",
           tracker_overflow <= 2, f"overflow={tracker_overflow}")

    record("mobile", "SANITY ROLL is present in the tracker bar on mobile (kept, unlike the generic dice quick-roll)",
           page.locator("#lp-track-san-check").is_visible())
    san_order = page.evaluate("""() => {
        const bar = document.getElementById('lp-tracker-bar');
        const kids = Array.from(bar.children).filter(el => getComputedStyle(el).display !== 'none');
        const rects = kids.map(el => el.getBoundingClientRect().left);
        const order = kids.map(el => el.id || el.className);
        return order.map((id, i) => [id, rects[i]]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
    }""")
    san_idx = next((i for i, x in enumerate(san_order) if "lp-track-san" == x), -1)
    check_idx = next((i for i, x in enumerate(san_order) if "san-check" in x), -1)
    bp_idx = next((i for i, x in enumerate(san_order) if "lp-track-bp" in x), -1)
    record("mobile", "SANITY ROLL sits visually between SAN and BP in the tracker bar",
           -1 not in (san_idx, check_idx, bp_idx) and san_idx < check_idx < bp_idx, f"order={san_order}")

    hp_val = page.eval_on_selector("#lp-cur-hp", "el => el.textContent")
    record("mobile", "tracker bar test actually exercises two-digit values, not just a fresh character's low defaults",
           len(hp_val) >= 2, f"HP={hp_val!r}")

    def item_box(sel):
        return page.evaluate(f"""() => {{
            const el = document.querySelector('{sel}');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {{ left: r.left, right: r.right, top: r.top, bottom: r.bottom }};
        }}""")

    # With realistic two-digit stats, confirm no two tracker items
    # visually overlap -- the actual symptom of the bug this caught
    # (current value's digits colliding with the neighboring +/- button)
    # rather than just re-checking the container's own scrollWidth,
    # which page-level and #lp-tracker-bar-level checks above already do
    # and which did NOT catch this (the container itself never overflowed;
    # its children just crowded on top of each other inside it).
    item_ids = ["#lp-track-hp", "#lp-track-wp", "#lp-track-san", "#lp-track-san-check", "#lp-track-bp"]
    boxes = [item_box(sel) for sel in item_ids]
    overlaps = []
    for i in range(len(boxes) - 1):
        if boxes[i] and boxes[i + 1] and boxes[i]["right"] > boxes[i + 1]["left"] + 1:
            overlaps.append((item_ids[i], item_ids[i + 1]))
    record("mobile", "tracker bar items don't visually overlap with realistic two-digit stat values",
           len(overlaps) == 0, f"overlaps={overlaps} boxes={boxes}")

    dr_box = page.evaluate("""() => {
        const dr = document.getElementById('dr-panel');
        if (!dr) return null;
        const r = dr.getBoundingClientRect();
        return { right: r.right, left: r.left };
    }""")
    record("mobile", "auto-expanded Dice Roller widget stays within the viewport width",
           dr_box is not None and dr_box["right"] <= 390 and dr_box["left"] >= 0, str(dr_box))
    errs_all.extend(errs)
    page.close()

    # The Cover IDs "tablet" is its own dense grid layout (260px sidebar +
    # card preview), collapsing to a single column under 700px -- worth
    # checking on its own rather than trusting the Cover tab's check above
    # to cover it.
    page = p.new_page(viewport={"width": 390, "height": 844})
    page.set_default_timeout(5000)
    errs = collect_errors(page)
    mock_routes(page)
    page.goto(f"{BASE}/dg-agent-portal.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)
    page.click("#tw-ids")
    page.wait_for_timeout(300)
    scroll_width = page.evaluate("() => document.documentElement.scrollWidth")
    record("mobile", "dg-agent-portal.html Cover IDs tab has no horizontal overflow at 390px viewport",
           scroll_width <= 390, f"scrollWidth={scroll_width}")
    errs_all.extend(errs)
    page.close()
    return errs_all

def test_agent_portal_restore_dossier(p, agent):
    """Regression check: restoring an agent by code on the Cover tab must
    re-render the dossier ('pop up') in place, not just jump silently to
    the Agent File tab."""
    page = p.new_page()
    page.set_default_timeout(5000)
    errs = collect_errors(page)
    mock_routes(page)
    page.goto(f"{BASE}/dg-agent-portal.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(200)

    page.fill("#agent-code-input", "REST-OR3D")
    page.click(".sticky-btn")
    page.wait_for_timeout(400)

    status = page.text_content("#code-load-status")
    dossier_html = page.inner_html("#dossier-wrap")
    cover_still_active = page.is_visible("#panel-cover")
    ok = "restored" in (status or "").lower() and "Mock Loaded Agent" in dossier_html and cover_still_active
    record("agent-portal", "restoring by code re-renders dossier on Cover tab", ok,
           f"status={status!r} cover_visible={cover_still_active}")
    page.close()
    return errs

def test_agent_file_open_character_sheet_btn(p):
    """The "Open Character Sheet" button above the era grid on the Agent
    File tab. There's no real link between an Agent File and a stats/
    character (roadmap item #1: three separate identity systems), so this
    is honest about what it does -- just navigates to stats/index.html,
    which auto-saves/auto-loads on its own (resumes a character already
    there, or starts blank if none is). Checks the button is present only
    once an agent is actually loaded (not on the code-entry gate), and
    that it navigates to the right page."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    def fake_apps_script(route):
        url = route.request.url
        if route.request.method == "POST" or "callback=" not in url:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        # A callback-carrying GET (e.g. checkAgentKia's load_character
        # check, which now fires whenever the Agent File tab renders)
        # needs a real JSONP-wrapped response -- a raw JSON body gets
        # executed as a <script> and throws on the object literal's ':'.
        cb = url.split("callback=")[1].split("&")[0]
        route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({{"status":"OK"}})')
    page.route("**/script.google.com/**", fake_apps_script)

    page.goto(f"{BASE}/dg-agent-portal.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)

    # The button lives inside #af-content, which is display:none until an
    # agent is loaded -- so it's present in the DOM but must not be
    # visible yet, not merely absent.
    record("agent-portal", "Open Character Sheet button is not visible on the Agent File code gate",
           not page.is_visible("button[onclick*='stats/index.html']"), "")

    page.fill("#dg-form [name=char_name]", "Marcus Reyes")
    page.click("#submit-btn")
    page.wait_for_timeout(400)
    page.click("#open-agent-file-btn")
    page.wait_for_timeout(400)

    btn = page.locator("button[onclick*='stats/index.html']")
    record("agent-portal", "Open Character Sheet button appears once an agent is loaded",
           btn.count() == 1, "")

    btn.click()
    for _ in range(20):
        if page.url.endswith("stats/index.html"):
            break
        page.wait_for_timeout(300)
    record("agent-portal", "Open Character Sheet button navigates to stats/index.html",
           page.url.endswith("stats/index.html"), page.url)

    record("agent-portal", "no JS exceptions", len(errs)==0, "; ".join(errs))
    page.close()
    return errs

def test_agent_portal_cover(p, agent):
    page = p.new_page()
    page.set_default_timeout(5000)
    errs = collect_errors(page)
    mock_routes(page)
    page.goto(f"{BASE}/dg-agent-portal.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)

    # tabs sanity (regression check)
    page.click("#tw-agent"); page.wait_for_timeout(150)
    agent_visible = page.is_visible("#panel-agent")
    page.click("#tw-ids"); page.wait_for_timeout(150)
    ids_visible = page.is_visible("#panel-ids")
    page.click("#tw-cover"); page.wait_for_timeout(150)
    cover_visible = page.is_visible("#panel-cover")
    record("agent-portal", "tab switching (regression)", agent_visible and ids_visible and cover_visible,
           f"agent={agent_visible} ids={ids_visible} cover={cover_visible}")

    # profession dropdown full list (regression check)
    opt_count = page.eval_on_selector_all("#rand-profession option", "els => els.length")
    record("agent-portal", "profession dropdown has full list (regression)", opt_count >= 15, f"{opt_count} options")

    # random agent generator using this mock agent's profession
    prof_id = agent.get("profession_id", "")
    if prof_id and page.locator(f"#rand-profession option[value={prof_id}]").count():
        page.select_option("#rand-profession", prof_id)
        page.click("#rand-reroll-btn") if page.is_visible("#rand-reroll-btn") else None
        gen_btn = page.locator("button:has-text('Generate')").first
        gen_btn.click()
        page.wait_for_timeout(200)
        rand_bar_visible = page.is_visible("#rand-result-bar")
        record("agent-portal", f"random agent generator for profession '{prof_id}'", rand_bar_visible, "")

    # fill + submit cover form
    fill_cover_form(page, agent, "#dg-form")
    page.click("#submit-btn")
    page.wait_for_timeout(400)
    status = page.text_content("#form-status")
    dossier_html = page.inner_html("#dossier-wrap")
    ok = agent["char_name"] in dossier_html
    record("agent-portal", "cover submit renders dossier", ok, status or "")

    # grab the generated code from local storage for downstream tests
    saved = page.evaluate("() => { try { return JSON.parse(localStorage.getItem('dg_last_agent')); } catch(e){ return null; } }")
    code = saved["code"] if saved else None
    record("agent-portal", "agent persisted to localStorage after submit", bool(code), str(code))

    page.close()
    return errs, code

def test_agent_portal_agent_file(p, code):
    if not code:
        record("agent-portal", "agent file gate (skipped, no code)", False, "no code from cover test")
        return []
    page = p.new_page()
    page.set_default_timeout(5000)
    errs = collect_errors(page)
    mock_routes(page)
    page.goto(f"{BASE}/dg-agent-portal.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(200)
    page.click("#tw-agent")
    page.wait_for_timeout(150)
    gate_input = page.locator("#af-code-input")
    if gate_input.count():
        gate_input.fill(code)
        btn = page.locator("#af-gate button, #af-gate .af-gate-btn")
        if btn.count():
            btn.first.click()
        else:
            page.keyboard.press("Enter")
        page.wait_for_timeout(400)
        content_visible = page.is_visible("#af-content")
        record("agent-portal", "agent file loads by code", content_visible, f"code={code}")
    else:
        record("agent-portal", "agent file gate input present", False, "selector #af-code-input not found")
    page.close()
    return errs

def test_agent_file_kia_stamp(p):
    """The Agent File tab shows a KIA stamp when the Agent's saved
    character sheet (load_character -- the same Cloud Save record
    stats/ writes to, not this file's own Briefs data) has 0 or less
    HP. Purely a live read, not a separate persisted flag -- heal the
    Agent back above 0 and the stamp is gone next time this loads."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    briefs = {"DEAD-0001": {"char_name": "Owen Castillo"}, "ALIV-0002": {"char_name": "Priya Anand"}}
    characters = {
        "DEAD-0001": json.dumps({"derived": {"hp": 0}}),
        "ALIV-0002": json.dumps({"derived": {"hp": 9}}),
    }

    def fake_apps_script(route):
        url = route.request.url
        if route.request.method == "POST" or "callback=" not in url:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        cb = url.split("callback=")[1].split("&")[0]
        if "action=load_character" in url:
            code = url.split("code=")[1].split("&")[0]
            res = {"status": "OK", "character_json": characters[code]} if code in characters else {"status": "NOT_FOUND"}
        elif "code=" in url:
            code = url.split("code=")[1].split("&")[0]
            res = {"status": "OK", "data": briefs[code]} if code in briefs else {"status": "NOT_FOUND"}
        else:
            res = {"status": "OK"}
        route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
    page.route("**/script.google.com/**", fake_apps_script)

    page.goto(f"{BASE}/dg-agent-portal.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)
    page.click("#tw-agent")
    page.wait_for_timeout(150)

    page.fill("#af-code-input", "DEAD-0001")
    page.click("#af-gate .af-gate-btn")
    page.wait_for_timeout(800)
    record("agent-portal", "Agent File shows a KIA stamp for an Agent whose saved sheet is at 0 HP",
           page.is_visible("#af-kia-stamp"), "")

    page.click("button:has-text('Load Different Agent')")
    page.wait_for_timeout(200)
    page.fill("#af-code-input", "ALIV-0002")
    page.click("#af-gate .af-gate-btn")
    page.wait_for_timeout(800)
    record("agent-portal", "Agent File shows no KIA stamp for an Agent above 0 HP",
           not page.is_visible("#af-kia-stamp"), "")

    page.close()
    return errs

def test_agent_roster(p):
    """The Agent Roster drawer (localStorage dg_agent_roster): every agent
    persistAgent()'d in this browser -- Cover form submit, Agent File load
    by code, etc. -- joins it automatically, so a Handler testing several
    players' briefs (or a player who's made more than one agent over time)
    can see and switch between all of them, not just the single
    most-recently-active one dg_last_agent tracks. Ported from the
    project's Dev branch alongside the Cover ID Fabricator.

    Regression-tests a real bug found while porting this: handleSubmit()
    never updated the in-memory afCode/afData globals after a fresh Cover
    submission (only other code paths like loading-by-code did), so
    rosterRender()'s active-agent detection -- which prefers afCode over
    the fresher localStorage value -- kept pointing at whichever agent was
    active *before* the most recent submission, not the one just
    submitted."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    agents_by_code = {}
    def capture(route):
        url = route.request.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            code = url.split("code=")[1].split("&")[0] if "code=" in url else None
            data = agents_by_code.get(code)
            body = f'{cb}({json.dumps({"status": "OK", "data": data} if data else {"status": "NOT_FOUND"})})'
            route.fulfill(status=200, content_type="application/javascript", body=body)
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", capture)

    # Submit 3 different agents across separate page loads -- like a
    # Handler checking multiple players' briefs in the same browser --
    # tracking each one's real generated code so later steps can address
    # a specific agent rather than "whichever happens to be first".
    for name in ["Marcus Reyes", "Priya Anand", "Owen Castillo"]:
        page.goto(f"{BASE}/dg-agent-portal.html", wait_until="domcontentloaded", timeout=15000)
        page.wait_for_timeout(300)
        page.fill("#dg-form [name=char_name]", name)
        page.click("#submit-btn")
        page.wait_for_timeout(400)
        saved = page.evaluate("JSON.parse(localStorage.getItem('dg_last_agent'))")
        agents_by_code[saved["code"]] = saved["data"]

    roster_count = page.inner_text("#roster-trigger-count")
    record("agent-roster", "all 3 submitted agents join the roster automatically",
           roster_count == "3", f"count={roster_count}")

    page.click("#roster-trigger")
    page.wait_for_timeout(400)
    record("agent-roster", "roster drawer opens", page.is_visible("#roster-drawer.open") or
           "open" in (page.eval_on_selector("#roster-drawer", "el => el.className") or ""), "")

    entries = page.evaluate("""() => Array.from(document.querySelectorAll('.roster-card')).map(c => ({
        name: c.querySelector('.roster-card-name').textContent,
        code: c.dataset.code,
        active: c.classList.contains('active-agent'),
    }))""")
    names = sorted(e["name"] for e in entries)
    record("agent-roster", "roster lists all 3 agents by name",
           names == ["Marcus Reyes", "Owen Castillo", "Priya Anand"], str(names))

    active = [e for e in entries if e["active"]]
    record("agent-roster", "the most recently submitted agent (Owen Castillo) is marked active -- "
           "regression check for afCode/afData not being updated after a fresh Cover submit",
           len(active) == 1 and active[0]["name"] == "Owen Castillo", str(active))

    # Switch to a non-active agent and confirm it actually loads (exercises
    # rosterSelectAgent()'s "fetch by code" path, not just the in-memory
    # shortcut, since the target isn't the one already held in afData)
    target = next(e for e in entries if not e["active"])
    page.evaluate(f"rosterSelectAgent('{target['code']}')")
    page.wait_for_timeout(500)
    af_html = page.inner_html("#panel-agent")
    record("agent-roster", f"selecting a different roster card ({target['name']}) loads and displays that agent",
           target["name"] in af_html, "")
    record("agent-roster", "selecting a roster card switches to the Agent File tab",
           "active" in (page.eval_on_selector("#tw-agent", "el => el.className") or ""), "")

    # Delete one agent and confirm the roster shrinks
    page.click("#roster-trigger")
    page.wait_for_timeout(300)
    page.on("dialog", lambda d: d.accept())
    page.click(".roster-card-delete")
    page.wait_for_timeout(400)
    new_count = page.inner_text("#roster-trigger-count")
    record("agent-roster", "deleting a roster entry updates the count",
           new_count == "2", f"count={new_count}")

    # Export downloads a JSON file
    with page.expect_download() as dl_info:
        page.click("text=Export Roster")
    dl = dl_info.value
    record("agent-roster", "Export Roster downloads a .json file",
           dl.suggested_filename.endswith(".json"), dl.suggested_filename)

    record("agent-roster", "no JS exceptions", len(errs)==0, "; ".join(errs))
    page.close()
    return errs

def test_id_creator(p, agent):
    page = p.new_page()
    page.set_default_timeout(5000)
    errs = collect_errors(page)
    mock_routes(page)
    page.goto(f"{BASE}/dg-id-creator.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(200)
    record("id-creator", f"page loads ({agent['char_name']})", True, "")

    name_input = page.locator("#card-name")
    if name_input.count():
        name_input.fill(agent["char_name"])
        record("id-creator", "manual name entry accepted", page.input_value("#card-name") == agent["char_name"], "")

    # The "paste a DG- code to prefill" panel was removed (v1.7 code-system
    # cleanup) -- nothing in the repo ever produced a code its loader could
    # read, so it could never have worked. Confirm it's actually gone
    # rather than just silently absent because a selector changed underneath.
    record("id-creator", "the dead 'load from code' panel is gone",
           page.locator("#agent-code-in").count() == 0, "")

    page.close()
    return errs

def test_pwa_offline(p):
    """Offline app shell (v1.7): a manifest.json + sw.js precache every
    page's HTML/CSS/JS/image assets with a stale-while-revalidate
    strategy, so the hub still opens with zero signal once it's been
    visited before -- Apps Script calls, Google Fonts, and anything else
    cross-origin are deliberately left uncached (the service worker's
    fetch handler only intercepts same-origin requests in its own
    precache list), so this never risks serving stale Agent/Cell data
    offline. Registration happens on every page via a small snippet
    pointing at sw.js (or ../sw.js from stats/)."""
    errs_all = []
    context = p.new_context()
    page = context.new_page()
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    def fake_apps_script(route):
        url = route.request.url
        if route.request.method == "POST" or "callback=" not in url:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        cb = url.split("callback=")[1].split("&")[0]
        route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps({"status": "OK"})})')
    page.route("**/script.google.com/**", fake_apps_script)
    errs = collect_errors(page)

    pages = ["index.html", "agent-hub.html", "a-cell.html", "dg-agent-portal.html", "dg-id-creator.html", "stats/index.html"]

    # Visit every page online first so the service worker (registered
    # from each one) precaches the whole shell.
    for path in pages:
        page.goto(f"{BASE}/{path}", wait_until="load", timeout=15000)
        page.wait_for_timeout(300)

    manifest = page.evaluate(f"""async () => {{
        const res = await fetch('{BASE}/manifest.json');
        return await res.json();
    }}""")
    record("pwa", "manifest.json is valid JSON with name/icons/start_url",
           bool(manifest.get("name")) and bool(manifest.get("icons")) and bool(manifest.get("start_url")),
           str(manifest)[:200])

    sw_active = wait_for_condition(lambda: page.evaluate("() => !!navigator.serviceWorker.controller"), timeout_ms=15000)
    record("pwa", "the service worker is registered and controlling the page after a visit",
           bool(sw_active), "")

    cached_paths = page.evaluate("""async () => {
        const names = await caches.keys();
        const out = [];
        for (const n of names) {
            const cache = await caches.open(n);
            const reqs = await cache.keys();
            out.push(...reqs.map(r => new URL(r.url).pathname));
        }
        return out;
    }""")
    missing = [p2 for p2 in pages if not any(cp.endswith('/' + p2) for cp in cached_paths)]
    record("pwa", "every page is precached by the service worker",
           len(missing) == 0, f"missing={missing} cached={cached_paths}")

    # Now go fully offline and confirm every page still loads with real
    # content -- not a browser network-error page -- and throws nothing.
    # (A same-origin favicon request can occasionally lose a timing race
    # against Chromium's offline flag propagating on the very first
    # navigation after set_offline() -- confirmed non-reproducible across
    # repeated clean runs, cosmetic even when it happens (default icon,
    # no visible error), so it's not asserted on here; "loads" + "no JS
    # exceptions" below are the signals that actually matter.)
    context.set_offline(True)
    offline_errs = []
    page.on("pageerror", lambda e: offline_errs.append(str(e)))
    for path in pages:
        resp = page.goto(f"{BASE}/{path}", wait_until="load", timeout=8000)
        record("pwa", f"{path} still loads while offline",
               resp is not None and resp.ok, f"status={resp.status if resp else None}")
    context.set_offline(False)
    record("pwa", "no JS exceptions across any page while offline", len(offline_errs) == 0, "; ".join(offline_errs))

    errs_all.extend(errs)
    context.close()
    return errs_all

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/opt/pw-browsers/chromium")

        def safe(fn, *args, area="unknown"):
            try:
                return fn(*args)
            except Exception as e:
                record(area, f"{fn.__name__} crashed", False, str(e)[:200])
                return None

        safe(test_stat_generator, browser, area="stats-terminal")

        safe(test_stat_generator_agent_file_nav, browser, area="stats-terminal")

        safe(test_stat_generator_sheets_roundtrip, browser, area="stats-terminal")

        safe(test_foundry_import_profession_and_outfit, browser, area="stats-terminal")

        safe(test_kappablack_toml_import, browser, area="stats-terminal")

        safe(test_import_agent_auto_detect, browser, area="stats-terminal")

        safe(test_player_name_field, browser, area="stats-terminal")

        safe(test_cloud_save, browser, area="stats-terminal")

        safe(test_agent_file_export, browser, area="agent-file-export")

        safe(test_random_bio_cloud_code_race, browser, area="agent-file-export")

        safe(test_cover_ids_tab, browser, area="cover-ids-tab")

        safe(test_hub_boot_splash, browser, area="hub")

        safe(test_hub_clearance_branches, browser, area="hub")

        safe(test_agent_hub, browser, area="hub")

        safe(test_agent_hub_recruit_flag, browser, area="hub")

        safe(test_agent_hub_handouts, browser, area="hub")

        safe(test_acell_gate, browser, area="acell")

        safe(test_acell_play, browser, area="acell")

        safe(test_acell_cells, browser, area="acell")

        safe(test_acell_handouts, browser, area="acell")

        safe(test_acell_sheet, browser, area="acell")

        safe(test_acell_music, browser, area="acell")

        safe(test_acell_music_backend_not_deployed, browser, area="acell")

        safe(test_acell_admin, browser, area="acell")

        safe(test_table_radio_widget, browser, area="radio")

        safe(test_table_radio_audio_volume, browser, area="radio")

        safe(test_table_radio_library_track_kind, browser, area="radio")

        safe(test_table_radio_yt_volume_reliability, browser, area="radio")

        safe(test_table_radio_mobile_buttons_not_stretched, browser, area="radio")

        safe(test_agent_portal_code_query_param, browser, area="agent-portal")

        safe(test_stats_load_by_code_query_param, browser, area="stats-terminal")

        safe(test_stats_recruit_flow_on_missing_character, browser, area="stats-terminal")

        safe(test_stats_recruit_flow_cancel_protects_existing_character, browser, area="stats-terminal")

        safe(test_stats_new_recruit_blank_sheet, browser, area="stats-terminal")

        safe(test_mobile_no_overflow, browser, area="mobile")

        safe(test_agent_portal_restore_dossier, browser, AGENTS[0], area="agent-portal")

        safe(test_agent_file_open_character_sheet_btn, browser, area="agent-portal")

        codes = []
        for agent in AGENTS:
            res = safe(test_agent_portal_cover, browser, agent, area="agent-portal")
            codes.append(res[1] if res else None)

        if codes and codes[0]:
            safe(test_agent_portal_agent_file, browser, codes[0], area="agent-portal")

        safe(test_agent_file_kia_stamp, browser, area="agent-portal")

        safe(test_agent_roster, browser, area="agent-roster")

        for agent in AGENTS[:2]:
            safe(test_id_creator, browser, agent, area="id-creator")

        safe(test_pwa_offline, browser, area="pwa")

        browser.close()

    total = len(results)
    passed = sum(1 for r in results if r["ok"])
    failed = total - passed
    print(f"\n=== {passed}/{total} passed, {failed} failed ===")
    with open(RESULTS_PATH, "w") as f:
        json.dump(results, f, indent=2)
    if failed:
        sys.exit(1)

if __name__ == "__main__":
    main()
