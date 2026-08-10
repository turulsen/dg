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
        if route.request.method == "POST":
            captured["body"] = route.request.post_data
        route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
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
    page.wait_for_timeout(400)
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

def test_cloud_save(p):
    """Opt-in background cloud sync (stats/cloud-sync.js) -- lets a
    character built on one device be picked up on another by an Agent
    Code, without an export/import file changing hands. Off by default
    (no code, no requests); "Start Cloud Save" mints a code and starts a
    debounced push on every edit; "Load by Code" pulls a saved character
    back down. This exercises only the client side against a mocked
    Apps Script backend -- the real backend needs the paired
    character-cloud-save-addition.gs pasted into the live Apps Script
    project and redeployed, which this sandbox cannot verify directly."""
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

    # No code yet -- silent, nothing sent, matching the app's local-by-default posture.
    record("stats-terminal", "Cloud Save is inactive until explicitly started",
           page.eval_on_selector("#cloud-save-status", "el => el.textContent.trim()") == "")

    page.fill("#cs-name", "Priya Anand")
    page.click("#cloud-save-bar button:has-text('Start Cloud Save')")
    page.wait_for_timeout(500)

    status1 = page.eval_on_selector("#cloud-save-status", "el => el.textContent")
    record("stats-terminal", "Start Cloud Save shows an active code in the status line",
           "Cloud Save active" in status1 or "Synced" in status1, status1)
    save_posts = [b for b in posts if b.get("action") == "save_character"]
    record("stats-terminal", "Start Cloud Save immediately pushes the character",
           len(save_posts) >= 1, f"posts={posts}")
    if save_posts:
        first_state = json.loads(save_posts[0]["character_json"])
        record("stats-terminal", "the pushed character_json carries the real character data (name)",
               first_state.get("bio", {}).get("name") == "Priya Anand", str(first_state.get("bio")))

    code = page.evaluate("window.dgCloudSave.getCloudCode()")
    record("stats-terminal", "the minted cloud code is persisted to localStorage",
           bool(code) and save_posts and save_posts[0].get("agent_code") == code, f"code={code!r}")

    # An edit after Start Cloud Save should schedule (debounced) another
    # push -- proves the ongoing "saved dynamically and updated" behavior,
    # not just a one-shot save on the button click.
    page.fill("#cs-bio-nationality", "Indian-American")
    page.wait_for_timeout(4500)
    save_posts_after_edit = [b for b in posts if b.get("action") == "save_character"]
    record("stats-terminal", "editing after Start Cloud Save schedules another debounced push",
           len(save_posts_after_edit) >= 2, f"count={len(save_posts_after_edit)}")
    if len(save_posts_after_edit) >= 2:
        latest_state = json.loads(save_posts_after_edit[-1]["character_json"])
        record("stats-terminal", "the debounced push carries the edited field",
               latest_state.get("bio", {}).get("nationality") == "Indian-American", str(latest_state.get("bio")))

    # Stop Cloud Save -- gated behind a confirm() dialog.
    page.on("dialog", lambda d: d.accept())
    page.click("#cloud-save-bar button:has-text('Stop')")
    page.wait_for_timeout(300)
    record("stats-terminal", "Stop Cloud Save clears the local code",
           page.evaluate("window.dgCloudSave.getCloudCode()") == "")
    record("stats-terminal", "Stop Cloud Save clears the status line",
           page.eval_on_selector("#cloud-save-status", "el => el.textContent.trim()") == "")

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
        record("cover-ids-tab", "rendered card carries the 'not a government document' prop watermark",
               "NOT A GOVERNMENT DOCUMENT" in preview_text, preview_text[:120])

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

def test_hub_two_cards(p):
    """Regression check for the hub restructuring: the standalone Cover ID
    Creator card is gone (it's reachable via the Agent Portal's Cover IDs
    tab instead), leaving Character Creator + Agent Portal."""
    page = p.new_page()
    page.set_default_timeout(5000)
    errs = collect_errors(page)
    page.goto(f"{BASE}/index.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)
    hrefs = page.eval_on_selector_all("a.card", "els => els.map(e=>e.getAttribute('href'))")
    record("hub", "hub has exactly 2 cards (Character Creator, Agent Portal)",
           hrefs == ["stats/index.html", "dg-agent-portal.html"], str(hrefs))
    page.close()
    return errs

def test_hub_latest_agent_panel(p):
    """The hub's "Continue Playing" panel: shows the most recently saved
    agent (localStorage dg_last_agent, the same key the Cover form and
    stats/'s Export to Agent File button both write) with a photo if one
    was uploaded, and links straight to the Agent Portal's Agent File tab
    for it. Must stay hidden entirely -- not show an empty/broken preview
    -- in a fresh browser with no saved agent yet."""
    errs_all = []

    # No saved agent -> panel must not appear at all
    page = p.new_page()
    page.set_default_timeout(5000)
    errs = collect_errors(page)
    page.goto(f"{BASE}/index.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)
    record("hub", "Continue Playing panel is hidden with no saved agent",
           not page.is_visible("#latest-agent-panel"), "")
    errs_all.extend(errs)
    page.close()

    # Saved agent with a photo -> panel shows a populated preview and links
    # to the Agent File tab
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.goto(f"{BASE}/index.html", wait_until="domcontentloaded", timeout=15000)
    tiny_png = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1"
                "HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
    page.evaluate("""(photo) => {
        localStorage.setItem('dg_last_agent', JSON.stringify({
            code: 'MARC-9XQ2',
            data: {
                char_name: 'Marcus Reyes', codename: 'GRAYWOLF',
                submitted_at: '2026-08-01T12:00:00Z', ref_image_base64: photo
            }
        }));
    }""", tiny_png)
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(400)

    record("hub", "Continue Playing panel appears with a saved agent",
           page.is_visible("#latest-agent-panel"), "")
    record("hub", "panel shows the saved agent's name",
           page.inner_text("#latest-agent-name") == "Marcus Reyes", "")
    meta = page.inner_text("#latest-agent-meta")
    record("hub", "panel meta line shows code, codename, and updated date",
           "MARC-9XQ2" in meta and "GRAYWOLF" in meta, meta)
    record("hub", "panel shows the agent's uploaded photo",
           page.locator("#latest-agent-photo img").count() == 1, "")

    page.click("#latest-agent-panel")
    for _ in range(20):
        if page.url.endswith("dg-agent-portal.html#agent"):
            break
        page.wait_for_timeout(300)
    record("hub", "panel links straight to the Agent Portal's Agent File tab",
           page.url.endswith("dg-agent-portal.html#agent"), page.url)

    errs_all.extend(errs)
    page.close()
    return errs_all

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
    for path in ["index.html", "dg-agent-portal.html", "dg-id-creator.html"]:
        page = p.new_page(viewport={"width": 390, "height": 844})
        page.set_default_timeout(5000)
        errs = collect_errors(page)
        mock_routes(page)
        page.goto(f"{BASE}/{path}", wait_until="domcontentloaded", timeout=15000)
        page.wait_for_timeout(300)
        scroll_width = page.evaluate("() => document.documentElement.scrollWidth")
        record("mobile", f"{path} has no horizontal overflow at 390px viewport",
               scroll_width <= 390, f"scrollWidth={scroll_width}")
        errs_all.extend(errs)
        page.close()

    # index.html's "Continue Playing" panel only appears with a saved agent
    # in localStorage, so the general no-overflow sweep above (fresh
    # browser, no agent) never actually exercises it -- check it separately
    # with an agent seeded, including a photo, since that's the widest the
    # panel gets.
    page = p.new_page(viewport={"width": 390, "height": 844})
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    # index.html's own inline <script> sits after its Google Fonts <link>,
    # same as dg-agent-portal.html -- an unblocked font request that never
    # resolves in this sandbox hangs that script (and page.reload()) rather
    # than just slowing it down, so block fonts before the reload below.
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.goto(f"{BASE}/index.html", wait_until="domcontentloaded", timeout=15000)
    page.evaluate("""() => {
        localStorage.setItem('dg_last_agent', JSON.stringify({
            code: 'MARC-9XQ2',
            data: { char_name: 'Marcus Reyes', codename: 'GRAYWOLF', submitted_at: '2026-08-01T12:00:00Z' }
        }));
    }""")
    page.reload(wait_until="domcontentloaded", timeout=8000)
    page.wait_for_timeout(300)
    scroll_width = page.evaluate("() => document.documentElement.scrollWidth")
    record("mobile", "index.html has no horizontal overflow at 390px viewport (Continue Playing panel shown)",
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
    page.route("**/script.google.com/**", lambda r: r.fulfill(status=200, content_type="application/json", body='{"status":"OK"}'))

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

    # code format check: BRAD-K7X2 style code from stat-generator/agent-portal
    fake_agent_portal_code = "TEST-AB12"
    code_in = page.locator("#agent-code-in")
    if code_in.count():
        code_in.fill(fake_agent_portal_code)
        page.click(".code-btn")
        page.wait_for_timeout(200)
        status = page.text_content("#code-status")
        record("id-creator", "rejects agent-portal-style code (known schema mismatch)",
               "Invalid" in (status or ""), status or "")

    page.close()
    return errs

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

        safe(test_cloud_save, browser, area="stats-terminal")

        safe(test_agent_file_export, browser, area="agent-file-export")

        safe(test_cover_ids_tab, browser, area="cover-ids-tab")

        safe(test_hub_two_cards, browser, area="hub")

        safe(test_hub_latest_agent_panel, browser, area="hub")

        safe(test_mobile_no_overflow, browser, area="mobile")

        safe(test_agent_portal_restore_dossier, browser, AGENTS[0], area="agent-portal")

        safe(test_agent_file_open_character_sheet_btn, browser, area="agent-portal")

        codes = []
        for agent in AGENTS:
            res = safe(test_agent_portal_cover, browser, agent, area="agent-portal")
            codes.append(res[1] if res else None)

        if codes and codes[0]:
            safe(test_agent_portal_agent_file, browser, codes[0], area="agent-portal")

        safe(test_agent_roster, browser, area="agent-roster")

        for agent in AGENTS[:2]:
            safe(test_id_creator, browser, agent, area="id-creator")

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
