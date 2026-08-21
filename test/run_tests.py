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
            # Every field #dg-form itself marks required, not just a
            # handful -- isProfilingComplete() (dg-agent-portal.html)
            # gates the Agent File tab on all of them being non-empty,
            # so a fixture missing any of these would silently redirect
            # every test below expecting to land on Agent File back to
            # Profiling instead.
            fake_data = {
                "char_name": "Mock Loaded Agent", "codename": "TESTCASE",
                "age_range": "30s", "sex": "Female", "nationality": "American",
                "face_shape": "oval", "eye_color": "brown", "eye_shape": "almond",
                "nose": "straight", "lips": "thin", "skin": "tan",
                "facial_hair": "clean-shaven", "hair_color": "brown",
                "hair_style": "short", "hair_texture": "straight",
                "build": "average", "posture": "upright",
                "expression": "neutral", "vibe": "unremarkable",
                "jacket": "coat", "shirt": "shirt",
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

    hub_link = page.get_attribute("a[href='../agent-hub.html']", "href") if page.locator("a[href='../agent-hub.html']").count() else None
    record("stats-terminal", "Agent Hub nav link goes to the player's own agent list, not the clearance chooser",
           hub_link == "../agent-hub.html", str(hub_link))

    # Theme, Live Play, Load by Code, and Export now live in the settings
    # cog (top-right) rather than inline on the page.
    page.click("#settings-cog-btn")
    page.wait_for_timeout(200)

    # All five themes must switch without throwing (field-doc retired --
    # Live Play is now a mode layered on any theme, not a theme itself)
    theme_options = page.eval_on_selector_all("#cs-theme-select option", "els => els.map(e=>e.value)")
    record("stats-terminal", "theme selector has all 5 themes",
           set(theme_options) == {"xfiles","modern","son-of-sam","field-notes","mobile"}, str(theme_options))
    for t in theme_options:
        page.select_option("#cs-theme-select", t)
        page.wait_for_timeout(200)
    record("stats-terminal", "cycling through every theme throws no JS exceptions", len(errs)==0, "; ".join(errs))
    page.select_option("#cs-theme-select", "xfiles")
    page.wait_for_timeout(200)
    page.click("#settings-panel-close")
    page.wait_for_timeout(150)

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

    # Regression: Random Bio used to silently overwrite an already-named,
    # in-use character's whole identity in place, under the same Cloud
    # Save code, with zero warning -- a real report (a player's actual
    # character got replaced by a fresh random one). Clicking it again
    # now that cs-name holds a real name (from the click above) must
    # gate behind dgConfirm() instead of overwriting immediately.
    page.click("#random-bio-button")
    page.wait_for_timeout(200)
    record("stats-terminal", "Random Bio on an already-named character asks for confirmation instead of overwriting immediately",
           page.eval_on_selector("#dg-confirm-backdrop", "el => el.classList.contains('dg-confirm-open')")
           and bio_name in page.inner_text("#dg-confirm-message"), "")

    page.click("#dg-confirm-cancel")
    page.wait_for_timeout(150)
    record("stats-terminal", "Cancelling the confirmation leaves the existing name untouched",
           page.input_value("#cs-name") == bio_name, page.input_value("#cs-name"))

    page.click("#random-bio-button")
    page.wait_for_timeout(200)
    page.click("#dg-confirm-ok")
    page.wait_for_timeout(200)
    bio_name_2 = page.input_value("#cs-name")
    record("stats-terminal", "Confirming proceeds and actually generates a new name",
           bool(bio_name_2) and bio_name_2 != "Agent" and bio_name_2 != bio_name, bio_name_2)

    # Wizard opens to step 1
    page.click("#wiz-toggle-btn")
    page.wait_for_timeout(200)
    wiz_heading = page.text_content("text=STEP 1 OF") if page.locator("text=STEP 1 OF").count() else None
    record("stats-terminal", "Character Creation Wizard opens to step 1", bool(wiz_heading), wiz_heading or "not found")
    page.click("#wiz-toggle-btn")
    page.wait_for_timeout(150)

    # Dice roller widget: toggled via #dr-arrow. It starts collapsed on a
    # fresh load, but switching Live Play mode on auto-opens it and that
    # state can persist across switching back, so check current state
    # rather than assuming collapsed.
    d20 = page.locator("button[data-die='d20']")
    if not d20.is_visible():
        # Call the toggle directly rather than clicking #dr-arrow: moving
        # Import/Wizard to the top of the page pushed it to a scroll
        # position that can land under the position:fixed Table Radio
        # "Tune In" pill -- both are legitimately visible/clickable
        # widgets, just momentarily co-located after scrollIntoView at
        # this viewport size, and a force-click there doesn't reliably
        # land on the actual button underneath.
        page.evaluate("window.dgDice?._toggle?.()")
        page.wait_for_timeout(150)
    d20_visible = d20.is_visible()
    if d20_visible:
        d20.click()
        page.wait_for_timeout(150)
    record("stats-terminal", "dice roller widget opens and rolls without throwing",
           d20_visible and len(errs)==0, f"visible={d20_visible}")

    # Mobile theme: verify no horizontal overflow specifically (see test_mobile_no_overflow
    # for why the other 5 themes are excluded from that general sweep)
    page.click("#settings-cog-btn")
    page.wait_for_timeout(200)
    page.select_option("#cs-theme-select", "mobile")
    page.wait_for_timeout(200)
    page.click("#settings-panel-close")
    page.wait_for_timeout(150)
    record("stats-terminal", "no JS exceptions across the whole run", len(errs)==0, "; ".join(errs))

    page.close()
    return errs

def test_stat_generator_agent_file_nav(p):
    """The "Open Agent File" button above the theme selector on
    stats/index.html (replacing the old Foundry-VTT-mentioning intro
    paragraph -- this hub doesn't use Foundry). One click exports the
    current character (same path as the Export to Agent File button
    further down the page) and lands on the Agent Portal. With only a
    name typed in here, that auto-export is real but partial (see
    agent-portal-export.js's run() -- name/sex/nationality/profession/
    build/outfit only, everything else #dg-form marks required is still
    blank), so isProfilingComplete() keeps this on the Profiling tab
    rather than the Agent File tab -- there's nothing worth showing on
    the Agent File side yet."""
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
    record("stats-terminal", "Open Agent File button is present in the settings cog",
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
    page.click("#settings-cog-btn")
    page.wait_for_timeout(200)
    page.click("#site-intro-agent-file-btn")
    for _ in range(20):
        if page.url.endswith("dg-agent-portal.html#agent"):
            break
        page.wait_for_timeout(300)

    cover_tab_active = False
    for _ in range(20):
        cover_tab_active = "active" in (page.eval_on_selector("#tw-cover", "el => el.className") or "")
        if cover_tab_active:
            break
        page.wait_for_timeout(300)

    record("stats-terminal", "Open Agent File button navigates to the Portal, landing on Profiling (name-only export is incomplete)",
           page.url.endswith("dg-agent-portal.html#agent") and cover_tab_active,
           page.url)
    record("stats-terminal", "the Agent File tab is NOT shown for this still-incomplete export",
           not page.eval_on_selector("#tw-agent", "el => el.classList.contains('active')"), "")

    char_name_val = ""
    for _ in range(15):
        char_name_val = page.eval_on_selector("#dg-form [name=char_name]", "el => el.value") if page.locator("#dg-form [name=char_name]").count() else ""
        if char_name_val == "Priya Anand":
            break
        page.wait_for_timeout(300)
    record("stats-terminal", "the just-exported character's name is already on the Profiling form",
           char_name_val == "Priya Anand", char_name_val)

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
    page.click("#settings-cog-btn")
    page.wait_for_timeout(200)

    with page.expect_download(timeout=15000) as dl_info:
        page.click("#export-sheets")
    dl = dl_info.value
    record("stats-terminal", "Export Google Sheet downloads an .xlsx (template asset present, not 404ing)",
           dl.suggested_filename.endswith(".xlsx"), dl.suggested_filename)
    xlsx_path = os.path.join(HERE, "results-tmp-exported.xlsx")
    dl.save_as(xlsx_path)
    page.click("#settings-panel-close")
    page.wait_for_timeout(150)

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

def test_kappablack_toml_import_unmatched_profession(p):
    """Regression test for a real bug: Kappa Black lets a player type ANY
    free-text profession, with no fixed list behind it -- a real report
    used "Prosecutor", which has no matching title or "X or Y" synonym
    anywhere in professions.js. Before this fix, matchProfessionKey()
    correctly returned null, but applyImportedAgentData() then set
    profSelect.value to the raw unmatched string, which silently failed
    (not a valid <option>) and left the dropdown on whatever was
    selected before -- reading as "profession didn't load" with the
    actual imported title lost entirely. Now falls back to the built-in
    "Building a New Profession" catch-all and keeps the original title
    visible in Personal Details instead of dropping it."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.route("**/script.google.com/**", lambda r: r.fulfill(status=200, content_type="application/json", body='{"status":"OK"}'))

    page.goto(f"{BASE}/stats/index.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(500)
    page.evaluate("document.getElementById('advanced-options-details').open = true")
    page.wait_for_timeout(200)

    toml_path = os.path.join(HERE, "fixtures", "kappablack-export.toml")
    toml_text = open(toml_path, encoding="utf-8").read().replace('profession = "Pilot"', 'profession = "Prosecutor"')
    assert 'profession = "Prosecutor"' in toml_text, "fixture's profession line didn't match the expected format to substitute"
    page.fill("#kappablack-import-area", toml_text)
    page.click("#kappablack-to-editor-button")
    page.wait_for_timeout(600)

    prof_val = page.eval_on_selector("#cs-profession-select", "el => el.value")
    record("stats-terminal", "an unmatched profession ('Prosecutor') falls back to 'Building a New Profession' instead of failing to select anything",
           prof_val == "new_profession", f"value={prof_val!r}")

    notes_val = page.eval_on_selector("#cs-personal-details", "el => el.value")
    record("stats-terminal", "the original unmatched profession title is preserved in Personal Details, not silently dropped",
           "Prosecutor" in notes_val, f"value={notes_val!r}")

    record("stats-terminal", "no JS exceptions", len(errs)==0, "; ".join(errs))
    page.close()
    return errs

def test_kappablack_toml_import_triggers_cloud_save(p):
    """Regression test for a real bug: applyImportedAgentData() sets
    every field via el.value = ... directly, which never fires 'input'
    or 'change' -- so cloud-sync.js's own document-level listeners (the
    only thing that ever calls ensureCloudCode()/pushToCloud()) never
    saw an import at all. A real report: an imported character showed
    up fine in this browser's own local roster but never reached the
    Characters sheet -- invisible to A-Cell Admin/Sheet -- until some
    unrelated later edit happened to trigger a real sync. Now dispatches
    a synthetic change event at the end of the import so it goes
    through the normal save pipeline immediately."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    posts = []
    def capture(route):
        req = route.request
        if req.method == "POST":
            try:
                posts.append(json.loads(req.post_data or "{}"))
            except Exception:
                pass
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
    page.wait_for_timeout(1000)

    save_posts = [p_ for p_ in posts if p_.get("action") == "save_character"]
    record("stats-terminal", "importing a Kappa Black .toml triggers a Cloud Save (save_character) without any further manual edit",
           len(save_posts) >= 1, str(save_posts))
    if save_posts:
        char_json = json.loads(save_posts[0].get("character_json") or "{}")
        record("stats-terminal", "the auto-triggered save actually carries the imported character's name, not a blank/default one",
               char_json.get("bio", {}).get("name") == "Alistair Islay Lagavulin",
               char_json.get("bio", {}).get("name"))

    record("stats-terminal", "no JS exceptions", len(errs) == 0, "; ".join(errs))
    page.close()
    return errs

def test_import_agent_paste_text(p):
    """The primary Import Agent drop zone (stats/index.html) only ever
    accepted files -- unusable on a phone for Kappa Black exports, since
    Kappa Black's mobile flow shows the character as on-screen text to
    copy, not a file a phone can save and hand back to a file input. This
    covers the "Can't drop a file? Paste text instead" fallback
    (importAgentText() in scripts.js), reusing the same real Kappa Black
    .toml fixture as test_kappablack_toml_import, and also a plain JSON
    paste, without ever touching the Advanced section's own textarea."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.route("**/script.google.com/**", lambda r: r.fulfill(status=200, content_type="application/json", body='{"status":"OK"}'))

    page.goto(f"{BASE}/stats/index.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(500)

    record("stats-terminal", "the paste fallback is collapsed by default (not cluttering the primary drop zone)",
           page.eval_on_selector("#agent-paste-details", "el => el.open") == False)

    toml_path = os.path.join(HERE, "fixtures", "kappablack-export.toml")
    toml_text = open(toml_path, encoding="utf-8").read()
    page.evaluate("document.getElementById('agent-paste-details').open = true")
    page.fill("#agent-paste-area", toml_text)
    page.click("#agent-paste-details button")
    page.wait_for_timeout(600)

    name_val = page.eval_on_selector("#cs-name", "el => el.value")
    record("stats-terminal", "pasting a Kappa Black .toml into the primary paste box loads the character name",
           name_val == "Alistair Islay Lagavulin", f"value={name_val!r}")
    prof_val = page.eval_on_selector("#cs-profession-select", "el => el.value")
    record("stats-terminal", "pasting a Kappa Black .toml into the primary paste box resolves the profession",
           prof_val == "pilot_sailor", f"value={prof_val!r}")

    # A real name is now on the sheet, which relocates #new-recruit-block
    # (and #agent-paste-details inside it) from the top of the page into
    # the settings cog's New Recruit section -- see dgCharacterMode
    # (scripts.js). Open the cog to keep using it for the rest of this test.
    page.click("#settings-cog-btn")
    page.wait_for_timeout(200)

    # A plain JSON paste (this site's own native export shape) should also
    # route correctly, proving the paste box isn't TOML-only.
    page.evaluate("document.getElementById('cs-name').value = ''")
    own_json = json.dumps({"v": 1, "bio": {"name": "Pasted JSON Agent"}})
    page.fill("#agent-paste-area", own_json)
    page.click("#agent-paste-details button")
    page.wait_for_timeout(400)
    name_val2 = page.eval_on_selector("#cs-name", "el => el.value")
    record("stats-terminal", "pasting this site's own JSON export into the primary paste box also works",
           name_val2 == "Pasted JSON Agent", f"value={name_val2!r}")

    # Garbage text should fail cleanly with a toast, not a silent no-op or a
    # thrown exception -- matches importAgentAuto()'s own unrecognized-file
    # handling, including its deliberate console.error (filtered out of the
    # exception check below, same as that test does for its own case).
    page.fill("#agent-paste-area", "not a character export")
    page.click("#agent-paste-details button")
    page.wait_for_timeout(300)
    record("stats-terminal", "unrecognized pasted text fails with a toast, not a silent no-op",
           "Couldn't recognize" in (page.eval_on_selector("#dg-toast", "el => el.textContent") or ""))

    real_errs = [e for e in errs if "Unrecognized text format" not in e]
    record("stats-terminal", "no JS exceptions", len(real_errs) == 0, "; ".join(real_errs))
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

    # Minting a cloud code (any path into stats/index.html -- typing a name,
    # or an importer applying state) must also register the agent in
    # dg_agent_roster, the ONLY key agent-hub.html's player-facing roster
    # reads. Without this, an imported/typed-in character syncs fine to the
    # Handler's cloud roster but never appears in the player's own Hub.
    roster = page.evaluate("JSON.parse(localStorage.getItem('dg_agent_roster') || '{}')")
    record("stats-terminal", "auto-minting a cloud code also registers the agent in the local Hub roster",
           code in roster and roster[code].get("char_name") == "Priya Anand", f"roster={roster}")

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
    roster_after_load = page.evaluate("JSON.parse(localStorage.getItem('dg_agent_roster') || '{}')")
    record("stats-terminal", "Load by Code also registers the pulled-down agent in the local Hub roster",
           "TESTCODE" in roster_after_load and roster_after_load["TESTCODE"].get("char_name") == "Cloud Loaded Character",
           f"roster={roster_after_load}")

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

    # textContent, not inner_text() -- .tw span is CSS text-transform:uppercase,
    # so inner_text() would return the rendered "FIELD IDS", not the markup.
    tw_ids_text = page.eval_on_selector("#tw-ids span", "el => el.textContent")
    record("cover-ids-tab", "the tab reads Field IDs, not the old Cover IDs name (now Cover Identity means something else)",
           tw_ids_text == "Field IDs", repr(tw_ids_text))

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
           action_hrefs[0] == "stats/index.html?load=OWEN-CS12&live=1", str(action_hrefs))
    record("hub", "Agent File links to the Agent Portal's Agent File tab for that exact agent",
           action_hrefs[1] == "dg-agent-portal.html?code=OWEN-CS12#agent", str(action_hrefs))
    record("hub", "Field ID links to the Agent Portal's Field IDs tab for that exact agent",
           action_hrefs[2] == "dg-agent-portal.html?code=OWEN-CS12#ids", str(action_hrefs))
    action_labels = page.eval_on_selector_all(
        "#panel-OWEN-CS12 .paper-btn", "els => els.map(e => e.textContent)")
    record("hub", "the button reads Field ID, not the old Cover ID name (now Cover Identity means something else)",
           action_labels[2] == "Field ID", str(action_labels))
    record("hub", "Notes links to the Notes app with ?code= for that exact agent",
           action_hrefs[3] == "notes/index.html?code=OWEN-CS12", str(action_hrefs))

    # Clicking a tab switches the active panel.
    page.click('.tw[data-tab="PRIY-AN34"]')
    page.wait_for_timeout(150)
    record("hub", "clicking a tab activates that Agent's panel and deactivates the others",
           "active" in page.eval_on_selector("#panel-PRIY-AN34", "el => el.className")
           and "active" not in page.eval_on_selector("#panel-OWEN-CS12", "el => el.className"), "")

    errs_all.extend(errs)
    page.close()
    return errs_all

def test_agent_hub_cover_identity(p):
    """Cover Identity (the ci-row in agent-hub.html's header): a player's
    real name, not the Agent's -- looks up every Agent tied to that name
    via the find_by_player_name backend action and REPLACES this
    browser's local roster with exactly that set (not a merge -- an
    Agent this device touched before but that isn't tied to the
    searched name should not survive the search), so a fresh
    device/cleared browser isn't a dead end. See
    lookupCoverIdentity()/renderRoster() in agent-hub.html."""
    errs_all = []

    def mock_lookup(agents_response):
        def handler(route):
            url = route.request.url
            if "action=find_by_player_name" not in url:
                route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
                return
            cb = url.split("callback=")[1].split("&")[0]
            body = json.dumps({"status": "OK", "agents": agents_response})
            route.fulfill(status=200, content_type="application/javascript", body=f"{cb}({body})")
        return handler

    # Entering a name and finding 2 Agents replaces the *claimed* part of
    # the roster (which starts out seeded with two locally-added Agents:
    # one already tied to a different real name, one nobody's claimed
    # yet) -- only the one already claimed by someone else should be
    # dropped; the unclaimed one survives regardless, since there's
    # nothing yet distinguishing it from "belongs to this identity" and
    # dropping it would just be silent local data loss.
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.route("**/script.google.com/**", mock_lookup([
        {"code": "GERG-P001", "char_name": "Patrick Montgomery", "codename": "", "sex": "Male",
         "age_range": "Mid 30s", "nationality": "American", "saved_at": 1000},
        {"code": "GERG-D002", "char_name": "Danielle Mitchell", "codename": "", "sex": "Female",
         "age_range": "Late 20s", "nationality": "American", "saved_at": 2000},
    ]))
    stray_roster = json.dumps({
        "STRY-X001": {"code": "STRY-X001", "char_name": "Claimed By Someone Else",
                      "player_name": "Not Gergo", "saved_at": 500},
        "STRY-X002": {"code": "STRY-X002", "char_name": "Unclaimed Local Draft", "saved_at": 600},
    })
    page.add_init_script(f"localStorage.setItem('dg_agent_roster', '{stray_roster}');")
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)
    record("hub", "starts with both stray Agents already in the roster before any lookup",
           set(page.eval_on_selector_all(".tw span", "els => els.map(e=>e.textContent)"))
           == {"+ New Recruit", "Claimed By Someone Else", "Unclaimed Local Draft"}, "")

    page.fill("#cover-identity-input", "Gergo")
    page.click("#cover-identity-btn")
    page.wait_for_timeout(500)
    tab_labels = page.eval_on_selector_all(".tw span", "els => els.map(e=>e.textContent)")
    record("hub", "a Cover Identity lookup with matches adds the returned Agents",
           {"Patrick Montgomery", "Danielle Mitchell"}.issubset(set(tab_labels)), str(tab_labels))
    record("hub", "the stray Agent already claimed by a different real name is gone",
           "Claimed By Someone Else" not in tab_labels, str(tab_labels))
    record("hub", "the unclaimed local draft survives the search -- nobody's said it isn't Gergo's yet",
           "Unclaimed Local Draft" in tab_labels, str(tab_labels))
    record("hub", "the status line confirms how many Agents were loaded",
           "2" in page.inner_text("#ci-status"), page.inner_text("#ci-status"))
    record("hub", "the entered Cover Identity is remembered for next time",
           page.evaluate("() => localStorage.getItem('dg_cover_identity')") == "Gergo", "")
    errs_all.extend(errs)
    page.close()

    # A name with no matches shows a clear status, not a silent no-op.
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.route("**/script.google.com/**", mock_lookup([]))
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)
    page.fill("#cover-identity-input", "Nobody Real")
    page.click("#cover-identity-btn")
    page.wait_for_timeout(500)
    record("hub", "a Cover Identity lookup with no matches shows a clear status instead of doing nothing",
           "No Agents found" in page.inner_text("#ci-status"), page.inner_text("#ci-status"))
    record("hub", "a no-match lookup leaves the roster empty, not a phantom entry",
           page.eval_on_selector_all(".tw span", "els => els.map(e=>e.textContent)") == ["+ New Recruit"], "")
    errs_all.extend(errs)
    page.close()

    # A returning visit with a stored Cover Identity re-runs the lookup
    # automatically, silently, with no user input at all.
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    lookup_calls = []
    def counting_mock(route):
        url = route.request.url
        if "action=find_by_player_name" in url:
            lookup_calls.append(url)
        mock_lookup([{"code": "GERG-P001", "char_name": "Patrick Montgomery", "codename": "", "sex": "Male",
                       "age_range": "Mid 30s", "nationality": "American", "saved_at": 1000}])(route)
    page.route("**/script.google.com/**", counting_mock)
    page.add_init_script("localStorage.setItem('dg_cover_identity', 'Gergo');")
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(500)
    record("hub", "a stored Cover Identity re-runs the lookup on its own, no click needed",
           len(lookup_calls) >= 1, str(lookup_calls))
    record("hub", "the returning player's Agent shows up without any input",
           "Patrick Montgomery" in page.eval_on_selector_all(".tw span", "els => els.map(e=>e.textContent)"), "")
    record("hub", "the input is pre-filled with the remembered Cover Identity",
           page.input_value("#cover-identity-input") == "Gergo", "")
    errs_all.extend(errs)
    page.close()

    # A returned Agent that has a Face Plate on file (findByPlayerName on
    # the backend must actually include face_plate_url -- it silently
    # dropped this field for a while, so an Agent with a generated plate
    # showed up in Agent File but never in the Agent Hub roster card)
    # should load and render that image via the imgdata proxy.
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    def mock_with_face_plate(route):
        url = route.request.url
        if "action=imgdata" in url:
            cb = url.split("callback=")[1].split("&")[0]
            body = json.dumps({"status": "OK", "dataUri": "data:image/png;base64,ZmFrZQ=="})
            route.fulfill(status=200, content_type="application/javascript", body=f"{cb}({body})")
            return
        mock_lookup([
            {"code": "DEMO-Q5MD", "char_name": "DeMore, \"Mastery\", André", "codename": "", "sex": "Male",
             "age_range": "50s", "nationality": "American", "saved_at": 1000,
             "face_plate_url": "gdrive:fake-drive-id"},
        ])(route)
    page.route("**/script.google.com/**", mock_with_face_plate)
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)
    page.fill("#cover-identity-input", "Gergo")
    page.click("#cover-identity-btn")
    page.wait_for_timeout(600)
    photo_html = page.eval_on_selector("#ah-photo-DEMO-Q5MD", "el => el.innerHTML")
    record("hub", "an Agent's Face Plate (face_plate_url from the Cover Identity lookup) renders in the roster panel",
           "<img" in photo_html and "data:image/png" in photo_html, photo_html)
    errs_all.extend(errs)
    page.close()
    return errs_all

def test_agent_hub_erase_agent(p):
    """Erase Agent: a player self-service delete for accidental duplicate
    Agents (previously only a Handler could clean these up via A-Cell
    Admin). Gated on typing the Agent's own Cover Identity back in --
    the Confirm button must stay disabled for a wrong/blank name and
    only enable for a correct (case-insensitive) match, and the actual
    delete_character POST must only fire after that."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    delete_posts = []
    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            try:
                body = json.loads(req.post_data or "{}")
            except Exception:
                body = {}
            if body.get("action") == "delete_character":
                delete_posts.append(body)
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" not in url:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        cb = url.split("callback=")[1].split("&")[0]
        route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({{"status":"OK"}})')
    page.route("**/script.google.com/**", fake_apps_script)

    roster = json.dumps({
        "GERG-E001": {"code": "GERG-E001", "char_name": "Duplicate Owen",
                      "player_name": "Gergo", "saved_at": 1000},
    })
    page.add_init_script(f"localStorage.setItem('dg_agent_roster', '{roster}');")
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)

    page.click('.ah-erase-link')
    page.wait_for_timeout(150)
    record("hub", "the Erase Agent overlay opens and names the Agent",
           page.is_visible("#ah-erase-overlay") and "Duplicate Owen" in page.inner_text("#ah-erase-name"), "")
    record("hub", "the Confirm button starts disabled",
           page.eval_on_selector("#ah-erase-confirm-btn", "el => el.disabled"), "")

    page.fill("#ah-erase-input", "Not Gergo")
    page.wait_for_timeout(100)
    record("hub", "a wrong Cover Identity leaves Confirm disabled",
           page.eval_on_selector("#ah-erase-confirm-btn", "el => el.disabled"), "")

    page.fill("#ah-erase-input", "gergo")
    page.wait_for_timeout(100)
    record("hub", "the correct Cover Identity (case-insensitive) enables Confirm",
           not page.eval_on_selector("#ah-erase-confirm-btn", "el => el.disabled"), "")

    page.click("#ah-erase-confirm-btn")
    page.wait_for_timeout(400)
    record("hub", "confirming sends a delete_character request for the right Agent",
           len(delete_posts) == 1 and delete_posts[0].get("agent_code") == "GERG-E001", str(delete_posts))
    record("hub", "the overlay closes after confirming",
           not page.is_visible("#ah-erase-overlay"), "")
    record("hub", "the erased Agent is gone from the roster/tab strip",
           "Duplicate Owen" not in page.eval_on_selector_all(".tw span", "els => els.map(e=>e.textContent)"), "")

    record("hub", "no JS exceptions", len(errs) == 0, "; ".join(errs))
    page.close()
    return errs

def test_agent_hub_kia_stamp(p):
    """Regression test for a real report: 'Kia and scoring should also be
    on Agent file, not just in A-Cell' -- clarified to mean KIA status
    specifically, visible right on the Agent Hub roster (tab strip and
    panel), not only after clicking through to Agent File. checkAgentKia()
    does the same load_character read dg-agent-portal.html's own KIA
    stamp already uses, then marks both the tab label and panel title
    struck-through and adds a KIA stamp -- purely a live read, not a
    persisted flag."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

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
        else:
            res = {"status": "OK"}
        route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
    page.route("**/script.google.com/**", fake_apps_script)

    roster = json.dumps({
        "DEAD-0001": {"code": "DEAD-0001", "char_name": "Owen Castillo", "saved_at": 1000},
        "ALIV-0002": {"code": "ALIV-0002", "char_name": "Priya Anand", "saved_at": 2000},
    })
    page.add_init_script(f"localStorage.setItem('dg_agent_roster', '{roster}');")
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(800)

    record("hub", "the dead Agent's tab label is struck through",
           "kia-name" in page.eval_on_selector("#ah-tablabel-DEAD-0001", "el => el.className"), "")
    record("hub", "the dead Agent's panel title is struck through",
           "kia-name" in page.eval_on_selector("#ah-title-DEAD-0001", "el => el.className"), "")
    record("hub", "the dead Agent's panel shows a KIA stamp",
           "KIA" in page.inner_text("#ah-charstamp-DEAD-0001"), page.inner_text("#ah-charstamp-DEAD-0001"))

    record("hub", "the living Agent's tab label is not struck through",
           "kia-name" not in page.eval_on_selector("#ah-tablabel-ALIV-0002", "el => el.className"), "")
    record("hub", "the living Agent's panel does not show a KIA stamp",
           "KIA" not in page.inner_text("#ah-charstamp-ALIV-0002"), page.inner_text("#ah-charstamp-ALIV-0002"))

    record("hub", "no JS exceptions", len(errs) == 0, "; ".join(errs))
    page.close()
    return errs

def test_agent_hub_handouts(p):
    """agent-hub.html's per-Agent Handouts section (visible label:
    "Evidence"): a read-only mirror of A-Cell's Evidence tab, filtered
    per Agent -- campaign-wide entries (blank cell_id) show for
    everyone, Cell-scoped ones only show for an Agent who's actually a
    member of that Cell, and an item restricted to specific Agents only
    shows for those Agents. Cells is fetched once; Evidence is fetched
    ONCE PER AGENT (not one shared fetch reused for everyone) -- a real
    live bug report traced restricted items never showing up on the one
    Agent they were restricted to back to the old shared, anonymous
    fetch: listEvidence() in Code.gs filters restricted items out
    entirely when no agent_code is on the request at all, regardless of
    who they're restricted to, so every restricted item was invisible
    to everyone via that path. The mock's own list_evidence handler
    below re-implements that same real server-side filter (cell
    membership + restricted_to, keyed off the request's own
    agent_code) rather than trusting the client to filter -- exactly
    the thing that was broken."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    photo_data_uri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    cells_fixture = [{"cell_id": "cell_1", "name": "Cell Alpha", "handler": "Sam", "member_codes": ["OWEN-CS12"], "channel": ""}]
    evidence_fixture = [
        {"evidence_id": "ev1", "title": "Cell Alpha Only Clue", "body": "Only Owen should see this.", "photo": "", "cell_id": "cell_1", "restricted_to": [], "created_at": "2000"},
        {"evidence_id": "ev2", "title": "Campaign Wide Notice", "body": "Everyone sees this.", "photo": photo_data_uri, "cell_id": "", "restricted_to": [], "created_at": "1000"},
        {"evidence_id": "ev3", "title": "Priya Eyes Only", "body": "Restricted to Priya specifically.", "photo": "", "cell_id": "", "restricted_to": ["PRIY-AN34"], "created_at": "1500"},
    ]

    def fake_apps_script(route):
        url = route.request.url
        if route.request.method == "POST" or "callback=" not in url:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        cb = url.split("callback=")[1].split("&")[0]
        if "action=list_cells" in url:
            res = {"status": "OK", "cells": cells_fixture}
        elif "action=list_evidence" in url:
            requester = url.split("agent_code=")[1].split("&")[0] if "agent_code=" in url else ""
            my_cells = [c["cell_id"] for c in cells_fixture if requester in c["member_codes"]]
            visible = []
            for h in evidence_fixture:
                if h["cell_id"] and h["cell_id"] not in my_cells:
                    continue
                restricted = h.get("restricted_to") or []
                if restricted and requester not in restricted:
                    continue
                visible.append(h)
            res = {"status": "OK", "evidence": visible}
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

    record("hub", "the section label reads Evidence, not Handouts",
           page.locator(".ah-section-divider").first.inner_text().strip().upper() == "EVIDENCE", "")

    owen_titles = page.eval_on_selector_all("#ah-handouts-OWEN-CS12 .ah-handout-title", "els => els.map(e=>e.textContent)")
    record("hub", "an Agent who's a Cell member sees both that Cell's evidence and the campaign-wide one",
           sorted(owen_titles) == sorted(["Cell Alpha Only Clue", "Campaign Wide Notice"]), str(owen_titles))
    record("hub", "an item restricted to a different Agent never shows for this Agent",
           "Priya Eyes Only" not in owen_titles, str(owen_titles))

    page.click("#ah-handouts-OWEN-CS12 .ah-handout-photo")
    page.wait_for_timeout(200)
    record("hub", "clicking a handout photo opens it in a full-size lightbox",
           page.is_visible(".ah-handout-lightbox"), "")
    page.click(".ah-handout-lightbox-close")
    page.wait_for_timeout(200)
    record("hub", "closing the lightbox hides it again",
           not page.is_visible(".ah-handout-lightbox"), "")

    page.click('.tw[data-tab="PRIY-AN34"]')
    page.wait_for_timeout(150)
    priya_titles = page.eval_on_selector_all("#ah-handouts-PRIY-AN34 .ah-handout-title", "els => els.map(e=>e.textContent)")
    record("hub", "an Agent in no Cell only sees the campaign-wide evidence, not the Cell-scoped one",
           "Cell Alpha Only Clue" not in priya_titles and "Campaign Wide Notice" in priya_titles, str(priya_titles))
    record("hub", "an item restricted specifically to this Agent DOES show up on their own page",
           "Priya Eyes Only" in priya_titles, str(priya_titles))

    page.close()
    return errs

def test_agent_hub_handout_notes(p):
    """agent-hub.html: an Agent's private notes on a Handout, synced via
    the backend (list_handout_notes / save_handout_note) so they survive
    clearing browser data and follow the Agent across devices. Scoped to
    (handout_id, agent_code) -- never surfaced to the Handler. A
    pre-existing note pre-fills the textarea; editing debounce-saves
    (1200ms) and posts the exact handout_id/agent_code/note."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    evidence_fixture = [
        {"evidence_id": "h1", "title": "Field Photo", "body": "evidence", "photo": "", "cell_id": "", "created_at": "1000"},
    ]
    notes_fixture = {"OWEN-CS12": [{"handout_id": "h1", "note": "Existing note text"}]}
    saved_bodies = []

    def fake_apps_script(route):
        req = route.request
        url = req.url
        if req.method == "POST":
            body = req.post_data or "{}"
            saved_bodies.append(json.loads(body))
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        if "callback=" not in url:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        cb = url.split("callback=")[1].split("&")[0]
        if "action=list_cells" in url:
            res = {"status": "OK", "cells": []}
        elif "action=list_evidence" in url:
            res = {"status": "OK", "evidence": evidence_fixture}
        elif "action=list_handout_notes" in url:
            code = url.split("agent_code=")[1].split("&")[0]
            res = {"status": "OK", "notes": notes_fixture.get(code, [])}
        else:
            res = {"status": "OK"}
        route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
    page.route("**/script.google.com/**", fake_apps_script)

    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    roster = {"OWEN-CS12": {"code": "OWEN-CS12", "char_name": "Owen Castillo", "codename": "Ferro", "saved_at": 2000}}
    page.evaluate("(r) => localStorage.setItem('dg_agent_roster', JSON.stringify(r))", roster)
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(900)

    note_input = page.query_selector('.ah-handout-notes-input[data-note-handout="h1"]')
    record("hub", "a pre-existing note pre-fills the textarea",
           note_input is not None and note_input.input_value() == "Existing note text",
           note_input.input_value() if note_input else "no textarea found")

    note_input.fill("Updated note from the Agent")
    status_el = page.query_selector('[data-note-status="h1"]')
    page.wait_for_timeout(200)
    record("hub", "typing shows a 'Typing…' status before the debounce fires",
           "Typing" in (status_el.text_content() or ""), status_el.text_content() if status_el else "")

    page.wait_for_timeout(1600)
    record("hub", "editing a note posts save_handout_note with the right handout_id/agent_code/note",
           any(b.get("action") == "save_handout_note" and b.get("handout_id") == "h1"
               and b.get("agent_code") == "OWEN-CS12" and b.get("note") == "Updated note from the Agent"
               for b in saved_bodies),
           str(saved_bodies))
    record("hub", "status flips to 'Saved' after the debounced save resolves",
           status_el.text_content() == "Saved", status_el.text_content() if status_el else "")

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

    # Real character-by-character typing (not page.fill(), which sets the
    # whole value in one shot like a paste and would not have caught this)
    # -- regression test for a real bug where the X-masking handler read
    # input.value AFTER it had already been overwritten with X's from the
    # previous keystroke, so every keystroke past the first corrupted the
    # tracked real value. Typing the password character by character
    # always denied access; only pasting it worked. See a-cell.html's
    # beforeinput handler for the fix.
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)
    page.locator("#acell-pw-input").press_sequentially("MASTICATE", delay=30)
    page.press("#acell-pw-input", "Enter")
    page.wait_for_timeout(200)
    record("acell", "typing the password character-by-character (not pasting) still grants access",
           "acces_granted" in page.inner_text("#acell-term-log"), page.inner_text("#acell-term-log"))
    errs_all.extend(errs)
    page.close()

    # Mid-string backspace while typing -- the beforeinput fix tracks edits
    # by selection position, not just appends at the end, so this needs its
    # own check: type "MASTICATT", backspace out the wrong "TT" and the
    # correct char before it, then finish with the right ending.
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)
    pw_input = page.locator("#acell-pw-input")
    pw_input.press_sequentially("MASTICATT", delay=20)
    for _ in range(3):
        page.press("#acell-pw-input", "Backspace")
    pw_input.press_sequentially("ATE", delay=20)
    page.press("#acell-pw-input", "Enter")
    page.wait_for_timeout(200)
    record("acell", "typing with a mid-entry correction (backspace) still resolves to the right value",
           "acces_granted" in page.inner_text("#acell-term-log"), page.inner_text("#acell-term-log"))
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
    ones in this browser's own dg_agent_roster), pulled from
    list_characters. That action now sends a flat summary per Agent
    (name/profession/player_name/vitals), not each one's entire
    character sheet -- see listCharacters()'s own comment in
    backend/Code.gs. Picking an Agent (or a Cell Dashboard row) fetches
    that one Agent's full character sheet on demand via load_character
    (a targeted single-row read, the same one that already fixed the
    ?load= 8-10s lag elsewhere) and renders the full simplified view:
    name, the six stats, HP/WP/SAN/BP, and skills."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)

    fake_order = ["OWEN-CS12", "PRIY-AN34", "MARC-9XQ2"]
    fake_full = {
        "OWEN-CS12": {
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
        },
        "PRIY-AN34": {
            "bio": {"name": "Priya Anand", "profession": "Forensic Accountant"},
            "csStats": {"STR": 8, "CON": 9, "DEX": 10, "INT": 17, "POW": 13, "CHA": 12},
            "derived": {"hp": 9, "wp": 13, "san": 65, "bp": 52},
            "skills": {"accounting": 70, "bureaucracy": 40},
            "customSkills": [],
        },
        "MARC-9XQ2": {
            "bio": {"name": "Marcus Reyes", "profession": "Pilot"},
            "csStats": {"STR": 10, "CON": 10, "DEX": 10, "INT": 10, "POW": 10, "CHA": 10},
            "derived": {"hp": 0, "wp": 8, "san": 30, "bp": 25},
            "skills": {},
            "customSkills": [],
        },
    }

    def summary_for(code):
        st = fake_full[code]
        bio = st.get("bio", {})
        derived = st.get("derived", {})
        return {
            "agent_code": code, "name": bio.get("name", ""), "profession": bio.get("profession", ""),
            "nationality": bio.get("nationality", ""), "player_name": bio.get("player_name", ""),
            "hp": derived.get("hp"), "wp": derived.get("wp"), "san": derived.get("san"), "bp": derived.get("bp"),
            "updated_at": "",
        }

    fake_cells = [
        {"cell_id": "cell_1", "name": "Cell Alpha", "handler": "Gergo", "member_codes": ["OWEN-CS12"]},
        {"cell_id": "cell_2", "name": "Cell Bravo", "handler": "Gergo", "member_codes": ["PRIY-AN34"]},
    ]

    def fake_apps_script(route):
        url = route.request.url
        if "action=list_characters" in url and "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            chars = [summary_for(c) for c in fake_order]
            body = f'{cb}({json.dumps({"status": "OK", "characters": chars})})'
            route.fulfill(status=200, content_type="application/javascript", body=body)
        elif "action=load_character" in url and "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            code = url.split("code=")[1].split("&")[0]
            st = fake_full.get(code)
            if st:
                body = f'{cb}({json.dumps({"status": "OK", "agent_code": code, "character_json": json.dumps(st)})})'
            else:
                body = f'{cb}({json.dumps({"status": "NOT_FOUND"})})'
            route.fulfill(status=200, content_type="application/javascript", body=body)
        elif "action=list_cells" in url and "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            body = f'{cb}({json.dumps({"status": "OK", "cells": fake_cells})})'
            route.fulfill(status=200, content_type="application/javascript", body=body)
        elif "callback=" in url:
            # Other tab modules (Music, Sheet) fetch unconditionally on
            # page load regardless of which tab is visible -- their
            # calls need a real JSONP-wrapped response too, or the
            # browser tries to execute a raw JSON object as a <script>
            # and throws a syntax error on the object literal's ':'.
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
    page.wait_for_timeout(300)
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

    # Refresh re-fetches the roster (and, since the selected Agent's full
    # sheet is now fetched on demand rather than sitting in the initial
    # list payload, drops the cached copy so it re-fetches too) and
    # keeps the selected Agent's panel showing their updated view,
    # instead of dropping the selection.
    fake_full["OWEN-CS12"]["csStats"]["CHA"] = 99
    page.click("#play-refresh-btn")
    page.wait_for_timeout(500)
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
    # at a glance, without clicking into each Agent one at a time --
    # comes straight from the list_characters summary, no per-Agent
    # full-sheet fetch needed just to show the Dashboard.
    dash_vitals = page.eval_on_selector_all("#play-view .cdb-row .cdb-vital .val", "els => els.map(e=>e.textContent)")
    record("acell", "the Dashboard shows the filtered Cell's member's vitals",
           dash_vitals == ["9", "13", "65", "52"], str(dash_vitals))
    page.click('#play-view .cdb-row:has-text("Priya Anand")')
    page.wait_for_timeout(300)
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
    page.wait_for_timeout(300)
    record("acell", "an Agent above 0 HP shows no KIA stamp",
           "KIA" not in page.inner_text("#play-view .pv-bio"), "")
    page.click('.play-agent-btn:has-text("Marcus Reyes")')
    page.wait_for_timeout(300)
    record("acell", "an Agent at 0 HP shows a KIA stamp next to their name",
           "KIA" in page.inner_text("#play-view .pv-bio"), page.inner_text("#play-view .pv-bio"))

    page.close()
    return errs

def test_acell_handler_session_race(p):
    """Regression test for a real race: if a Handler already has
    dg_acell_pw saved from a previous visit, the Handler-password
    module's silent re-login (attempt(savedPw, true)) is still an
    in-flight fetch when Play/Cells/Evidence's own <script> blocks run
    moments later in the same page load and fire their first data fetch
    using whatever (possibly stale/expired) dg_acell_session is already in
    sessionStorage. Play/Cells used to just show the resulting 'invalid or
    expired Handler session' error and sit there forever, even after the
    silent re-login landed a valid new session a moment later; Evidence's
    listEvidence() doesn't even error on an invalid session, it silently
    degrades to the released-only player view, which is worse -- no
    indication anything's missing. Fixed by having the Handler-password
    module dispatch a 'dg-acell-handler-ready' event once it lands a
    session, which Play/Cells/Evidence (and Sheet, covered by its own
    render path) now listen for to retry. (Deliberately checks only the
    end state, not an intermediate 'still showing the stale error' snapshot -- this
    app's Playwright route mocking runs on a single dispatch thread, so
    an artificial delay meant to widen the race window ends up
    serializing every in-flight request behind it instead, making any
    fixed-timeout snapshot of the intermediate state inherently
    unreliable. The property that actually matters -- and that a
    regression here would break -- is that it recovers at all.)"""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)
    # Seed a saved Handler password + a stale session, exactly like a
    # returning tab whose 6h server-side session has since expired.
    page.add_init_script("""
        try {
          sessionStorage.setItem('dg_acell_pw', 'letmein');
          sessionStorage.setItem('dg_acell_session', 'stale-session-token');
        } catch (e) {}
    """)

    chars_fixture = [{"agent_code": "OWEN-CS12", "name": "Owen Castillo", "profession": "Federal Agent",
                       "nationality": "", "player_name": "", "hp": 10, "wp": 10, "san": 50, "bp": 40, "updated_at": ""}]
    cells_fixture = [{"cell_id": "cell_1", "name": "Cell Alpha", "handler": "Sam", "member_codes": [], "channel": ""}]
    # Unreleased -- only visible to an authenticated Handler (isHandler in
    # listEvidence()), same as the real backend. A stale/invalid session
    # doesn't error like list_characters does; it silently degrades to the
    # released-only player view, which for this one unreleased item means
    # an empty list -- exactly the "no error, just quietly wrong" gap
    # Evidence's own retry-on-ready listener exists to close.
    evidence_fixture = [{"evidence_id": "ev1", "title": "Confidential Photo", "body": "", "photo": "",
                          "cell_id": "", "operation_id": "", "released": False, "restricted_to": [], "created_at": "1000"}]
    login_calls = []

    def fake_apps_script(route):
        req = route.request
        url = req.url
        if req.method == "POST":
            body = json.loads(req.post_data or "{}")
            if body.get("action") == "handler_login":
                login_calls.append(body)
                route.fulfill(status=200, content_type="application/json",
                               body=json.dumps({"status": "OK", "session": "fresh-session-token"}))
                return
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        if "callback=" not in url:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        cb = url.split("callback=")[1].split("&")[0]
        if "action=list_characters" in url:
            session = url.split("handler_session=")[1].split("&")[0] if "handler_session=" in url else ""
            if session == "fresh-session-token":
                res = {"status": "OK", "characters": chars_fixture}
            else:
                res = {"status": "ERROR", "message": "invalid or expired Handler session -- reload A-Cell"}
        elif "action=list_cells" in url:
            res = {"status": "OK", "cells": cells_fixture}
        elif "action=list_evidence" in url:
            session = url.split("handler_session=")[1].split("&")[0] if "handler_session=" in url else ""
            res = {"status": "OK", "evidence": evidence_fixture if session == "fresh-session-token" else []}
        elif "action=list_operations" in url:
            res = {"status": "OK", "operations": []}
        else:
            res = {"status": "OK"}
        route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
    page.route("**/script.google.com/**", fake_apps_script)

    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)

    wait_for_condition(lambda: any(c.get("handler_password") == "letmein" for c in login_calls), timeout_ms=6000)
    record("acell", "a saved Handler password silently re-logs in on page load",
           any(c.get("handler_password") == "letmein" for c in login_calls), str(login_calls))

    names = wait_for_condition(lambda: page.eval_on_selector_all("#play-agent-list .pa-name", "els => els.map(e=>e.textContent)")
                                if "Owen Castillo" in page.inner_text("#play-agent-list") else None)
    record("acell", "Play recovers and shows the roster once a fresh session lands, "
                    "instead of getting stuck on whatever (possibly stale) session was already saved",
           names == ["Owen Castillo"], page.inner_text("#play-agent-list"))

    # Cells' own list_characters call (for the "add Agent" picker) needs
    # the same valid session -- it's a second, independent tab module
    # racing the same silent re-login, and was missed the first time
    # this fix went in.
    page.click('.tw[data-tab="cells"]')
    cells_text = wait_for_condition(lambda: page.inner_text("#cells-groups")
                                     if "Cell Alpha" in page.inner_text("#cells-groups") else None)
    record("acell", "Cells recovers and shows the roster too, instead of 'Could not load Cells' forever",
           bool(cells_text) and "Cell Alpha" in cells_text, page.inner_text("#cells-groups"))

    # Evidence's list_evidence doesn't error on an invalid session like
    # list_characters does -- it silently degrades to the released-only
    # player view, which for an unreleased item means it's simply missing,
    # no error shown at all. Without its own retry-on-ready listener the
    # Handler would be stuck looking at an incomplete Locker with nothing
    # telling them so.
    page.click('.tw[data-tab="evidence"]')
    evidence_text = wait_for_condition(lambda: page.inner_text("#evidence-list")
                                        if "Confidential Photo" in page.inner_text("#evidence-list") else None)
    record("acell", "Evidence recovers and shows an unreleased item once the fresh (Handler) session lands, "
                    "instead of silently sitting on the released-only player view forever",
           bool(evidence_text) and "Confidential Photo" in evidence_text, page.inner_text("#evidence-list"))

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
        {"agent_code": "OWEN-CS12", "name": "Owen Castillo", "profession": "Federal Agent"},
        {"agent_code": "PRIY-AN34", "name": "Priya Anand", "profession": "Forensic Accountant"},
        {"agent_code": "MARC-9XQ2", "name": "Marcus Reyes", "profession": "Pilot"},
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

def test_acell_evidence(p):
    """a-cell.html's Evidence tab (evolved from the former Handouts tab):
    a shared evidence locker the Handler files, each item scoped to one
    Cell (cell_id set) or every Cell (blank, shown as "All Cells") and,
    within that Cell, an optional Operation folder. Backed by
    list_evidence/create_evidence/update_evidence/delete_evidence plus
    list_operations/create_operation/delete_operation. Like every other
    write in this app, the no-cors POSTs are verified by a real
    list_evidence/list_operations read-back before the UI shows the
    change. Also covers the Released toggle and the per-Agent
    restricted_to checklist added this round."""
    page = p.new_page()
    page.set_default_timeout(30000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)

    cells_fixture = [{"cell_id": "cell_1", "name": "Cell Alpha", "handler": "Sam", "member_codes": ["OWEN-CS12", "PRIY-AN34"], "channel": ""}]
    evidence_state = []
    operations_state = []

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            body = json.loads(req.post_data or "{}")
            action = body.get("action")
            if action == "create_evidence":
                eid = "evidence_" + str(len(evidence_state) + 1)
                evidence_state.append({
                    "evidence_id": eid, "title": body.get("title", ""), "body": body.get("body", ""),
                    "photo": body.get("photo", ""), "cell_id": body.get("cell_id", ""),
                    "operation_id": body.get("operation_id", ""), "released": bool(body.get("released")),
                    "restricted_to": json.loads(body.get("restricted_to") or "[]"),
                    "created_at": str(1000 + len(evidence_state)),
                })
            elif action == "update_evidence":
                for h in evidence_state:
                    if h["evidence_id"] == body.get("evidence_id"):
                        h["title"] = body.get("title", ""); h["body"] = body.get("body", "")
                        h["photo"] = body.get("photo", ""); h["cell_id"] = body.get("cell_id", "")
                        h["operation_id"] = body.get("operation_id", ""); h["released"] = bool(body.get("released"))
                        h["restricted_to"] = json.loads(body.get("restricted_to") or "[]")
            elif action == "delete_evidence":
                evidence_state[:] = [h for h in evidence_state if h["evidence_id"] != body.get("evidence_id")]
            elif action == "create_operation":
                oid = "op_" + str(len(operations_state) + 1)
                operations_state.append({"operation_id": oid, "cell_id": body.get("cell_id", ""), "name": body.get("name", ""), "created_at": str(len(operations_state))})
            elif action == "delete_operation":
                operations_state[:] = [o for o in operations_state if o["operation_id"] != body.get("operation_id")]
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            if "action=list_cells" in url:
                res = {"status": "OK", "cells": cells_fixture}
            elif "action=list_evidence" in url:
                res = {"status": "OK", "evidence": evidence_state}
            elif "action=list_operations" in url:
                res = {"status": "OK", "operations": operations_state}
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
    page.click('.tw[data-tab="evidence"]')
    page.wait_for_timeout(500)

    record("acell", "Evidence starts empty with a prompt to file one",
           "No evidence filed here yet" in page.inner_text("#evidence-list"), "")
    record("acell", "the folder sidebar is empty until a Cell is picked",
           page.inner_text("#evidence-folders").strip() == "", page.inner_text("#evidence-folders"))

    # Pick Cell Alpha in the sidebar -- folders (All/Unfiled) should
    # appear and "+ New Operation" should become available.
    page.select_option("#evidence-cell-filter", label="Cell Alpha")
    page.wait_for_timeout(200)
    record("acell", "picking a Cell reveals the All/Unfiled pseudo-folders",
           "All" in page.inner_text("#evidence-folders") and "Unfiled" in page.inner_text("#evidence-folders"),
           page.inner_text("#evidence-folders"))
    record("acell", "picking a Cell reveals + New Operation",
           page.is_visible("#evidence-new-op-btn"), "")

    # Create an Operation folder.
    page.click("#evidence-new-op-btn")
    page.wait_for_timeout(150)
    page.fill("#evidence-op-new-name", "Operation Nightshade")
    page.click("#evidence-op-new-confirm")
    wait_for_condition(lambda: "Operation Nightshade" in page.inner_text("#evidence-folders"))
    record("acell", "creating an Operation adds it to the folder list",
           "Operation Nightshade" in page.inner_text("#evidence-folders"), page.inner_text("#evidence-folders"))

    # File evidence into that Operation, released, restricted to one Agent.
    page.click("#evidence-create-btn")
    page.wait_for_timeout(150)
    page.fill("#evidence-new-title", "Field Photograph")
    page.select_option("#evidence-new-scope", label="Cell Alpha")
    page.select_option("#evidence-new-op", label="Operation Nightshade")
    page.fill("#evidence-new-body", "Recovered from the scene.")
    page.check("#evidence-new-released")
    page.check('#evidence-new-restrict-wrap input[value="OWEN-CS12"]')
    page.click("#evidence-new-confirm")
    list_text = wait_for_condition(lambda: page.inner_text("#evidence-list")
                                    if "Field Photograph" in page.inner_text("#evidence-list") else None)
    record("acell", "filing evidence into an Operation, released and restricted, shows it once confirmed",
           bool(list_text) and "Field Photograph" in list_text and "cell alpha" in list_text.lower()
           and "operation nightshade" in list_text.lower() and "restricted to: owen-cs12" in list_text.lower(),
           list_text or "")
    record("acell", "a released item's card doesn't carry the unreleased (staged) styling",
           "unreleased" not in (page.get_attribute(".evidence-card", "class") or ""), "")

    # File a second, unfiled, unreleased, unrestricted item in the same Cell.
    page.click("#evidence-create-btn")
    page.wait_for_timeout(150)
    page.fill("#evidence-new-title", "Wire Service Clipping")
    page.select_option("#evidence-new-scope", label="Cell Alpha")
    page.fill("#evidence-new-body", "Three additional livestock deaths reported.")
    page.click("#evidence-new-confirm")
    wait_for_condition(lambda: "Wire Service Clipping" in page.inner_text("#evidence-list"))
    record("acell", "an unfiled, unreleased item shows the staged (unreleased) styling",
           page.locator(".evidence-card.unreleased").count() == 1, "")

    # Folder filtering: "Unfiled" should show only the second item.
    page.click('[data-op="UNFILED"]')
    page.wait_for_timeout(200)
    record("acell", "the Unfiled folder filters to only items with no Operation",
           "Wire Service Clipping" in page.inner_text("#evidence-list")
           and "Field Photograph" not in page.inner_text("#evidence-list"), page.inner_text("#evidence-list"))
    page.click('[data-op=""]')
    page.wait_for_timeout(200)
    record("acell", "the All folder shows every item filed under this Cell again",
           page.locator(".evidence-card").count() == 2, "")

    # Toggle Released off on the Field Photograph card specifically --
    # it sorts second (Wire Service Clipping is newer and renders first,
    # already unreleased by default).
    fp_card = page.locator(".evidence-card", has_text="Field Photograph")
    fp_card.locator('[data-toggle-released]').uncheck()
    wait_for_condition(lambda: page.locator(".evidence-card.unreleased").count() == 2)
    record("acell", "unchecking the Released toggle on a card marks it staged again",
           page.locator(".evidence-card.unreleased").count() == 2, "")

    # Edit the Field Photograph item (index 1 -- Wire Service Clipping is
    # newer and sorts at index 0), confirm the Operation dropdown and
    # restriction checklist come back pre-filled from what was saved.
    page.click('[data-edit-evidence="1"]')
    page.wait_for_timeout(200)
    record("acell", "Edit opens the form pre-filled with that item's title",
           page.input_value("#evidence-new-title") == "Field Photograph", page.input_value("#evidence-new-title"))
    record("acell", "Edit pre-fills the Operation dropdown",
           page.eval_on_selector("#evidence-new-op", "el => el.options[el.selectedIndex].text") == "Operation Nightshade", "")
    record("acell", "Edit pre-checks the previously restricted Agent",
           page.is_checked('#evidence-new-restrict-wrap input[value="OWEN-CS12"]'), "")
    page.fill("#evidence-new-title", "Field Photograph (annotated)")
    page.click("#evidence-new-confirm")
    wait_for_condition(lambda: "Field Photograph (annotated)" in page.inner_text("#evidence-list"))
    record("acell", "editing evidence updates it in place once confirmed",
           "Field Photograph (annotated)" in page.inner_text("#evidence-list"), page.inner_text("#evidence-list"))

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
    page.click("#evidence-create-btn")
    page.wait_for_timeout(150)
    page.fill("#evidence-new-title", "Photo Evidence")
    page.fill("#evidence-new-body", "Attached.")
    page.set_input_files("#evidence-new-photo", oversized_photo_path)
    page.wait_for_timeout(300)
    page.click("#evidence-new-confirm")
    photo_list_text = wait_for_condition(lambda: page.inner_text("#evidence-list")
                                          if "Photo Evidence" in page.inner_text("#evidence-list") else None)
    record("acell", "filing evidence with a real-sized photo (>64KiB base64) still reaches the backend",
           bool(photo_list_text) and "Photo Evidence" in photo_list_text
           and "Could not reach the backend" not in page.inner_text("#evidence-status"),
           page.inner_text("#evidence-status"))
    os.unlink(oversized_photo_path)

    # A fixed 96x96 thumbnail is fine for "there's a photo here" but
    # useless for actually reading a filed document -- click it to see
    # it at real size in a lightbox overlay.
    page.click(".evidence-photo")
    page.wait_for_timeout(200)
    record("acell", "clicking an evidence photo opens it in a full-size lightbox",
           page.is_visible(".evidence-lightbox"), "")
    page.click(".evidence-lightbox-close")
    page.wait_for_timeout(200)
    record("acell", "closing the lightbox hides it again",
           not page.is_visible(".evidence-lightbox"), "")

    # Delete: dismiss then accept. Three items on the list at this
    # point (the photo one filed above sorts first, being newest).
    page.once("dialog", lambda d: d.dismiss())
    page.click('[data-delete-evidence="0"]')
    page.wait_for_timeout(300)
    record("acell", "dismissing the Delete confirm leaves the item in place",
           page.locator(".evidence-card").count() == 3, "")

    page.once("dialog", lambda d: d.accept())
    page.click('[data-delete-evidence="0"]')
    wait_for_condition(lambda: page.locator(".evidence-card").count() == 2)
    record("acell", "accepting Delete removes the item",
           page.locator(".evidence-card").count() == 2, "")

    # Deleting an Operation folder doesn't delete evidence filed under
    # it -- it just becomes Unfiled (no cascade, per the backend design).
    page.once("dialog", lambda d: d.accept())
    page.click('[data-del-op="op_1"]')
    wait_for_condition(lambda: "Operation Nightshade" not in page.inner_text("#evidence-folders"))
    record("acell", "deleting an Operation removes it from the folder list",
           "Operation Nightshade" not in page.inner_text("#evidence-folders"), page.inner_text("#evidence-folders"))
    page.click('[data-op=""]')
    page.wait_for_timeout(200)
    record("acell", "evidence that was filed under a deleted Operation is not itself deleted",
           page.locator(".evidence-card").count() == 2, "")

    page.close()
    return errs

def test_acell_evidence_pdf(p):
    """Regression coverage for a real live report: the Evidence photo
    field's accept="image/*" only labels the file picker, it doesn't
    stop a browser from actually letting a PDF through -- handlePhoto()
    then set an <img>'s src to a data:application/pdf URI, which never
    renders (a silently broken preview), and the same unrecognized-type
    data URI still got sent to create_evidence. Fixed by properly
    detecting a PDF and giving it its own preview/card treatment (a
    small labeled box that opens the PDF in a new tab, since a PDF can't
    be an <img> and this app's photo lightbox only knows how to display
    one) instead of pretending it's a photo. Also covers the file-size
    guard added alongside this -- a picked file over 8MB is rejected
    with a clear message before FileReader even starts, converting what
    was a silent hang/failure risk on a large file into a visible one."""
    page = p.new_page()
    page.set_default_timeout(15000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)
    # Recording window.open calls -- clicking a PDF box opens it in a new
    # tab via window.open() rather than this app's own photo lightbox;
    # patched before any page script runs so the real call is captured.
    page.add_init_script("""
        window.__openCalls = [];
        window.open = function (url) { window.__openCalls.push(url); return null; };
    """)

    evidence_state = []
    posts = []

    def fake_apps_script(route):
        req = route.request
        url = req.url
        if req.method == "POST":
            body = json.loads(req.post_data or "{}")
            posts.append(body)
            if body.get("action") == "create_evidence":
                evidence_state.append({
                    "evidence_id": "ev1", "title": body.get("title", ""), "body": body.get("body", ""),
                    "photo": body.get("photo", ""), "cell_id": "", "operation_id": "",
                    "released": False, "restricted_to": [], "created_at": "1000",
                })
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            if "action=list_evidence" in url:
                res = {"status": "OK", "evidence": evidence_state}
            elif "action=list_cells" in url:
                res = {"status": "OK", "cells": []}
            elif "action=list_operations" in url:
                res = {"status": "OK", "operations": []}
            else:
                res = {"status": "OK"}
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", fake_apps_script)

    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(400)
    page.click('.tw[data-tab="evidence"]')
    page.wait_for_timeout(300)
    page.click("#evidence-create-btn")
    page.wait_for_timeout(300)
    page.fill("#evidence-new-title", "Case File 12")

    # A too-large file is rejected before FileReader even starts, with a
    # clear message -- not a silent hang.
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(os.urandom(9 * 1024 * 1024))
        oversized_path = f.name
    page.set_input_files("#evidence-new-photo", oversized_path)
    page.wait_for_timeout(200)
    record("acell", "a file over the 8MB cap is rejected with a clear error instead of silently attempted",
           "too large" in page.inner_text("#evidence-new-error").lower(), page.inner_text("#evidence-new-error"))
    os.unlink(oversized_path)

    # A real PDF under the cap: preview shows a labeled box, not a broken <img>.
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(b"%PDF-1.4\n%test pdf content\n" + os.urandom(2000))
        pdf_path = f.name
    page.set_input_files("#evidence-new-photo", pdf_path)
    page.wait_for_timeout(200)
    record("acell", "attaching a PDF under the cap shows a labeled preview box, not a broken image",
           "evidence-photo-pdf-note" in page.inner_html("#evidence-new-photo-prev-wrap"),
           page.inner_html("#evidence-new-photo-prev-wrap"))
    record("acell", "picking a valid PDF clears any earlier error",
           page.inner_text("#evidence-new-error").strip() == "", page.inner_text("#evidence-new-error"))

    page.click("#evidence-new-confirm")
    wait_for_condition(lambda: "Case File 12" in page.inner_text("#evidence-list"))
    record("acell", "creating evidence with a PDF attached sends its data URI to create_evidence",
           any(b.get("action") == "create_evidence" and str(b.get("photo", "")).startswith("data:application/pdf")
               for b in posts), str([{k: v for k, v in b.items() if k != "photo"} for b in posts]))
    record("acell", "the card shows a PDF box (not a broken <img>) once created",
           "evidence-photo-pdf-note" in page.inner_html("#evidence-list"), page.inner_html("#evidence-list"))

    page.click(".evidence-photo-pdf-note")
    page.wait_for_timeout(200)
    open_calls = page.evaluate("() => window.__openCalls")
    record("acell", "clicking the PDF box opens it in a new tab (window.open), not this app's photo lightbox",
           len(open_calls) == 1 and open_calls[0].startswith("data:application/pdf"), str(open_calls))
    record("acell", "clicking a PDF box never opens the photo lightbox",
           not page.is_visible(".evidence-lightbox"), "")

    os.unlink(pdf_path)
    page.close()
    return errs

def test_acell_evidence_create_verify_retries(p):
    """Regression test for a real live report: 'Evidence will not create'.
    Root cause -- create_evidence's read-back verification checked
    list_evidence exactly once, 900ms after the POST. resolveEvidencePhoto_()
    has to actually upload the photo/PDF to Google Drive server-side before
    the new row exists, which for anything beyond a tiny image can genuinely
    take longer than 900ms -- so the fixed-delay check saw the item wasn't
    there YET and showed a false 'Sent, but the backend didn't confirm it',
    even though the write would have landed a moment later. Fixed by
    polling list_evidence over several increasing delays (verifyEvidenceWrite_)
    instead of checking once. This mock simulates exactly that: the create
    POST lands immediately, but list_evidence doesn't actually include the
    new item until its second read after the POST -- proving the retry,
    not just the create, is what's under test here."""
    page = p.new_page()
    page.set_default_timeout(20000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)

    evidence_state = []
    created = {"flag": False}
    reads_since_create = {"n": 0}

    def fake_apps_script(route):
        req = route.request
        url = req.url
        if req.method == "POST":
            body = json.loads(req.post_data or "{}")
            if body.get("action") == "create_evidence":
                evidence_state.append({
                    "evidence_id": "ev1", "title": body.get("title", ""), "body": body.get("body", ""),
                    "photo": body.get("photo", ""), "cell_id": "", "operation_id": "",
                    "released": False, "restricted_to": [], "created_at": "1000",
                })
                created["flag"] = True
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            if "action=list_evidence" in url:
                if created["flag"]:
                    reads_since_create["n"] += 1
                # The very first list_evidence read after the create POST
                # simulates the Drive upload not having landed yet -- an
                # empty list even though evidence_state already has the row,
                # exactly like the backend's own row not existing yet mid-
                # upload. Every read after that (and every read before any
                # create happened) reflects the real state.
                if created["flag"] and reads_since_create["n"] == 1:
                    res = {"status": "OK", "evidence": []}
                else:
                    res = {"status": "OK", "evidence": evidence_state}
            elif action_from(url) == "list_cells":
                res = {"status": "OK", "cells": []}
            elif action_from(url) == "list_operations":
                res = {"status": "OK", "operations": []}
            else:
                res = {"status": "OK"}
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')

    def action_from(url):
        return url.split("action=")[1].split("&")[0] if "action=" in url else ""

    page.route("**/script.google.com/**", fake_apps_script)

    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(400)
    page.click('.tw[data-tab="evidence"]')
    page.wait_for_timeout(300)
    page.click("#evidence-create-btn")
    page.wait_for_timeout(300)
    page.fill("#evidence-new-title", "Slow Upload Memo")
    page.click("#evidence-new-confirm")

    # The first poll (900ms) sees the simulated empty read and must not
    # give up -- it should retry and pick the item up on a later poll
    # instead of showing NOT_DEPLOYED_MSG.
    result = wait_for_condition(lambda: "Slow Upload Memo" in page.inner_text("#evidence-list") or "backend didn't confirm" in page.inner_text("#evidence-status"), timeout_ms=12000)
    record("acell", "a create whose first read-back comes back empty still succeeds via retry, instead of a false 'backend didn't confirm'",
           "Slow Upload Memo" in page.inner_text("#evidence-list"), page.inner_text("#evidence-list") + " | status: " + page.inner_text("#evidence-status"))
    record("acell", "the retry actually polled more than once before succeeding",
           reads_since_create["n"] >= 2, str(reads_since_create["n"]))

    page.close()
    return errs

def test_acell_sheet(p):
    """a-cell.html's Sheet tab: merged with the former separate Admin tab
    -- one dense, spreadsheet-style roster table (Cell, Handler, Agent
    Name, Player Name, HP, SAN, Online) that also deletes an Agent right
    from its own row, plus an Agent File / Profiling brief with no
    character sheet yet (list_agent_file_only) as its own row, plus
    Recently Deleted underneath, restorable for 24 hours before the
    backend permanently purges it. list_characters itself is now a flat
    summary (name/player_name/hp/san), not each Agent's entire
    character_json -- see listCharacters()'s own comment in
    backend/Code.gs for why sending that in full was the real cause of
    this tab feeling slow as the roster grows."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)

    now_ms = 1700000000000
    # Deliberately ISO strings, not raw epoch millis -- that's what the
    # real backend actually sends (saveCharacter() in backend/Code.gs
    # writes new Date().toISOString()). A raw-epoch-millis fixture here
    # would silently mask the exact bug this test exists to catch:
    # onlineCell() used to do Number(updatedAt), which is always NaN on
    # a real ISO string, so every Agent showed as permanently offline
    # regardless of how recently they'd actually synced.
    def iso(ms):
        return page.evaluate(f"new Date({ms}).toISOString()")
    fake_characters = [
        {"agent_code": "OWEN-CS12", "name": "Owen Castillo", "player_name": "Gergo P",
         "hp": 13, "san": 50, "updated_at": iso(now_ms)},
        {"agent_code": "PRIY-AN34", "name": "Priya Anand", "player_name": "",
         "hp": 9, "san": 65, "updated_at": iso(now_ms - 20 * 60 * 1000)},
        {"agent_code": "MARC-9XQ2", "name": "Marcus Reyes", "player_name": "",
         "hp": 0, "san": 40, "updated_at": iso(now_ms - 2 * 60 * 60 * 1000)},
    ]
    fake_cells = [
        {"cell_id": "cell_1", "name": "Cell Alpha", "handler": "Sam", "member_codes": ["OWEN-CS12", "PRIY-AN34"]},
    ]
    briefs_only = [
        {"agent_code": "DEMO-Q5MD", "char_name": 'DeMore, "Mastery", André', "codename": "Mastery"},
    ]
    deleted_characters = []
    deleted_briefs_only = []
    posts = []

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            try:
                body = json.loads(req.post_data or "{}")
            except Exception:
                body = {}
            posts.append(body)
            if body.get("action") == "update_character_field" and body.get("field") == "player_name":
                for c in fake_characters:
                    if c["agent_code"] == body.get("agent_code"):
                        c["player_name"] = body.get("value", "")
                        break
            elif body.get("action") == "update_field" and body.get("field") == "player_name":
                pass  # briefs-only Player Name edit isn't exercised here
            elif body.get("action") == "delete_character":
                code = body.get("agent_code")
                idx = next((i for i, c in enumerate(fake_characters) if c["agent_code"] == code), None)
                if idx is not None:
                    row = fake_characters.pop(idx)
                    deleted_characters.append({"agent_code": row["agent_code"],
                                                "character_json": json.dumps({"bio": {"name": row["name"]}}),
                                                "deleted_at": 1700000001000})
                idx2 = next((i for i, a in enumerate(briefs_only) if a["agent_code"] == code), None)
                if idx2 is not None:
                    row = briefs_only.pop(idx2)
                    deleted_briefs_only.append({"agent_code": row["agent_code"], "char_name": row["char_name"],
                                                 "deleted_at": 1700000001000})
            elif body.get("action") == "restore_character":
                code = body.get("agent_code")
                idx = next((i for i, c in enumerate(deleted_characters) if c["agent_code"] == code), None)
                if idx is not None:
                    row = deleted_characters.pop(idx)
                    bio = json.loads(row["character_json"]).get("bio", {})
                    fake_characters.append({"agent_code": row["agent_code"], "name": bio.get("name", ""),
                                             "player_name": "", "hp": None, "san": None, "updated_at": iso(now_ms)})
                idx2 = next((i for i, a in enumerate(deleted_briefs_only) if a["agent_code"] == code), None)
                if idx2 is not None:
                    row = deleted_briefs_only.pop(idx2)
                    briefs_only.append({"agent_code": row["agent_code"], "char_name": row["char_name"], "codename": ""})
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            if "action=list_characters" in url:
                res = {"status": "OK", "characters": fake_characters}
            elif "action=list_cells" in url:
                res = {"status": "OK", "cells": fake_cells}
            elif "action=list_agent_file_only" in url:
                res = {"status": "OK", "agents": briefs_only}
            elif "action=list_deleted_characters" in url:
                chars = deleted_characters + deleted_briefs_only
                res = {"status": "OK", "characters": chars}
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
    page.wait_for_timeout(700)

    headers = page.eval_on_selector_all("#sheet-wrap th", "els => els.map(e=>e.textContent)")
    record("acell", "Sheet table has the requested columns in order",
           headers[:7] == ["Cell", "Handler", "Agent Name", "Player Name", "HP", "SAN", "Online"], str(headers))

    row_texts = page.eval_on_selector_all("#sheet-wrap tbody tr", "els => els.map(e=>e.textContent)")
    record("acell", "Sheet lists every Agent on file plus every Agent-File-only entry as rows",
           len(row_texts) == 4, str(row_texts))
    record("acell", "a row shows the Agent's Cell, Handler, player name, HP, and SAN together",
           "Cell Alpha" in row_texts[0] and "Sam" in row_texts[0]
           and "Owen Castillo" in row_texts[0] and "Gergo P" in row_texts[0]
           and "13" in row_texts[0] and "50" in row_texts[0], row_texts[0])
    record("acell", "an Agent File-only entry (no character sheet) shows as its own row in the same table",
           any("Mastery" in t for t in row_texts), str(row_texts))

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
           dots[:3] == ["sheet-dot on", "sheet-dot recent", "sheet-dot off"], str(dots))

    # Player Name is click-to-edit -- the Handler's fallback for an Agent
    # saved before that field existed (Priya has none set, per
    # fake_characters above), since it's also the Cover Identity lookup
    # key (agent-hub.html) an Agent with no player_name can't be found by.
    priya_row = page.locator("#sheet-wrap tbody tr").nth(1)
    record("acell", "an Agent with no Player Name shows a click-to-set placeholder",
           "click to set" in priya_row.locator(".sheet-pn-display").inner_text(), "")
    priya_row.locator(".sheet-pn-display").click()
    page.wait_for_timeout(100)
    record("acell", "clicking the Player Name cell swaps in an editable input",
           priya_row.locator(".sheet-pn-input").count() == 1, "")
    priya_row.locator(".sheet-pn-input").fill("Alex R")
    priya_row.locator(".sheet-pn-input").press("Enter")
    page.wait_for_timeout(400)
    save_posts = [pp for pp in posts if pp.get("action") == "update_character_field" and pp.get("agent_code") == "PRIY-AN34"]
    record("acell", "committing the edit posts a single targeted update_character_field, not the whole character_json",
           len(save_posts) == 1 and save_posts[0].get("field") == "player_name" and save_posts[0].get("value") == "Alex R",
           str(save_posts))
    page.wait_for_timeout(300)
    record("acell", "the cell reflects the new Player Name after the Sheet re-fetches",
           "Alex R" in page.locator("#sheet-wrap tbody tr").nth(1).inner_text(), "")

    # Delete -- now lives on the Agent's own Sheet row instead of a
    # separate Admin tab, gated behind the same single A-Cell password
    # confirmation as before.
    owen_row = page.locator('#sheet-wrap tbody tr:has-text("Owen Castillo")')
    owen_row.locator(".sheet-delete-btn").click()
    page.wait_for_timeout(150)
    owen_row.locator('input[id^="sheet-pw-input-"]').fill("wrong")
    owen_row.locator('button[id^="sheet-delete-confirm-btn-"]').click()
    page.wait_for_timeout(150)
    record("acell", "the wrong A-Cell password is rejected on delete",
           owen_row.locator('[id^="sheet-confirm-err-"]').inner_text() != "", "")
    record("acell", "no delete was sent while the password is still unconfirmed",
           len([pp for pp in posts if pp.get("action") == "delete_character"]) == 0, str(posts))

    owen_row.locator('input[id^="sheet-pw-input-"]').fill("MASTICATE")
    owen_row.locator('button[id^="sheet-delete-confirm-btn-"]').click()
    page.wait_for_timeout(1500)
    delete_posts = [pp for pp in posts if pp.get("action") == "delete_character"]
    record("acell", "the correct password sends delete_character for the right Agent",
           len(delete_posts) == 1 and delete_posts[0].get("agent_code") == "OWEN-CS12", str(delete_posts))
    row_texts_after = page.eval_on_selector_all("#sheet-wrap tbody tr", "els => els.map(e=>e.textContent)")
    record("acell", "the deleted Agent's row disappears only after a real read-back confirms it's gone",
           not any("Owen Castillo" in t for t in row_texts_after) and len(row_texts_after) == 3, str(row_texts_after))

    deleted_text = wait_for_condition(lambda: page.inner_text("#admin-deleted-list")
                                       if "Owen Castillo" in page.inner_text("#admin-deleted-list") else None)
    record("acell", "a deleted Agent shows up in Recently Deleted below the table, not just vanishing",
           bool(deleted_text) and "Owen Castillo" in deleted_text, deleted_text or "")

    page.click("#admin-deleted-list .admin-restore-btn >> nth=0")
    page.wait_for_timeout(1500)
    restore_posts = [pp for pp in posts if pp.get("action") == "restore_character"]
    record("acell", "Restore sends restore_character for the right Agent",
           len(restore_posts) == 1 and restore_posts[0].get("agent_code") == "OWEN-CS12", str(restore_posts))
    row_texts_restored = page.eval_on_selector_all("#sheet-wrap tbody tr", "els => els.map(e=>e.textContent)")
    record("acell", "a restored Agent reappears in the Sheet table",
           any("Owen Castillo" in t for t in row_texts_restored), str(row_texts_restored))
    record("acell", "a restored Agent drops out of Recently Deleted",
           "Owen Castillo" not in page.inner_text("#admin-deleted-list"), "")

    # Agent File Only delete/restore -- exercises the parallel
    # list_agent_file_only-backed row end to end: delete, confirm it
    # lands in Recently Deleted (via char_name, since there's no
    # character_json to read a name out of), then restore.
    demo_row = page.locator('#sheet-wrap tbody tr:has-text("Mastery")')
    demo_row.locator(".sheet-delete-btn").click()
    page.wait_for_timeout(150)
    demo_row.locator('input[id^="sheet-pw-input-"]').fill("MASTICATE")
    demo_row.locator('button[id^="sheet-delete-confirm-btn-"]').click()
    page.wait_for_timeout(1500)
    demo_delete_posts = [pp for pp in posts if pp.get("action") == "delete_character" and pp.get("agent_code") == "DEMO-Q5MD"]
    record("acell", "deleting an Agent-File-only row sends delete_character for the right code",
           len(demo_delete_posts) == 1, str(demo_delete_posts))
    row_texts_after_demo = page.eval_on_selector_all("#sheet-wrap tbody tr", "els => els.map(e=>e.textContent)")
    record("acell", "the deleted Agent-File-only row disappears after a real read-back confirms it",
           not any("Mastery" in t for t in row_texts_after_demo), str(row_texts_after_demo))

    demo_deleted_text = wait_for_condition(lambda: page.inner_text("#admin-deleted-list")
                                            if "Mastery" in page.inner_text("#admin-deleted-list") else None)
    record("acell", "a deleted Agent-File-only entry shows up in Recently Deleted too",
           bool(demo_deleted_text) and "Mastery" in demo_deleted_text, demo_deleted_text or "")

    # Restore whichever Recently Deleted row is the Agent-File-only one --
    # by this point it's the only entry left.
    page.click("#admin-deleted-list .admin-restore-btn")
    page.wait_for_timeout(1500)
    demo_restore_posts = [pp for pp in posts if pp.get("action") == "restore_character" and pp.get("agent_code") == "DEMO-Q5MD"]
    record("acell", "restoring an Agent-File-only entry sends restore_character for the right code",
           len(demo_restore_posts) == 1, str(demo_restore_posts))

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
    backend_state = {"track_url": "", "track_title": "", "track_kind": "", "paused": False, "loop": False}
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
                backend_state["loop"] = body.get("loop") == "1"
                backend_state["paused"] = False
            elif body.get("action") == "pause_now_playing":
                backend_state["paused"] = True
            elif body.get("action") == "resume_now_playing":
                backend_state["paused"] = False
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
                           "track_kind": backend_state["track_kind"],
                           "paused": backend_state["paused"], "paused_at": 1700000000000 if backend_state["paused"] else 0,
                           "loop": backend_state["loop"]}
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
    record("acell", "Set Now Playing defaults to loop off when the checkbox is unchecked",
           set_posts[0].get("loop") == "0", str(set_posts))

    # Pause/Resume: freezes the current track in place for everyone tuned
    # in without restarting it from 0:00, unlike a fresh Set Now Playing.
    page.click("#music-pause-btn")
    page.wait_for_timeout(1200)
    pause_posts = [p_ for p_ in posts if p_.get("action") == "pause_now_playing"]
    record("acell", "Pause posts pause_now_playing for the dialed channel",
           len(pause_posts) == 1 and pause_posts[0].get("channel") == "2", str(pause_posts))
    record("acell", "status line confirms Paused once a read-back verifies it",
           "Paused" in page.inner_text("#music-status"), page.inner_text("#music-status"))
    record("acell", "the Pause button flips to Resume once paused",
           page.eval_on_selector("#music-pause-btn", "el => el.textContent") == "Resume", "")

    page.click("#music-pause-btn")
    page.wait_for_timeout(1200)
    resume_posts = [p_ for p_ in posts if p_.get("action") == "resume_now_playing"]
    record("acell", "clicking the same button again (now labeled Resume) posts resume_now_playing",
           len(resume_posts) == 1 and resume_posts[0].get("channel") == "2", str(resume_posts))
    record("acell", "the button flips back to Pause once resumed",
           page.eval_on_selector("#music-pause-btn", "el => el.textContent") == "Pause", "")

    # Restart: re-broadcasts the currently confirmed track from 0:00 even
    # with the form fields cleared -- it works off the last known
    # now-playing state, not whatever happens to be typed in the boxes.
    page.fill("#music-url-input", "")
    page.fill("#music-title-input", "")
    page.click("#music-restart-btn")
    page.wait_for_timeout(1500)
    restart_posts = [p_ for p_ in posts if p_.get("action") == "set_now_playing"
                      and p_.get("track_url") == "https://youtube.com/watch?v=dQw4w9WgXcQ"]
    record("acell", "Restart re-broadcasts the currently playing track with the form fields cleared",
           len(restart_posts) == 2, str(restart_posts))

    # Loop: checked before Set Now Playing sends loop:'1'.
    page.check("#music-loop-input")
    page.fill("#music-url-input", "https://youtube.com/watch?v=anotherid1234")
    page.fill("#music-title-input", "Looping Ambience")
    page.click("#music-set-btn")
    page.wait_for_timeout(1500)
    loop_posts = [p_ for p_ in posts if p_.get("action") == "set_now_playing"
                  and p_.get("track_url") == "https://youtube.com/watch?v=anotherid1234"]
    record("acell", "checking Loop before Set Now Playing sends loop: '1'",
           len(loop_posts) == 1 and loop_posts[0].get("loop") == "1", str(loop_posts))
    page.uncheck("#music-loop-input")

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

    # Bug: the upload UI used to be nested inside .acell-radio-display,
    # the second column of a grid that collapses to a single stacked
    # column on mobile -- burying it 1000px+ down the page below the
    # whole Tune Channel/Cue For Cell/Broadcast section with no visual
    # cue. It must be a full-width section immediately after that grid
    # instead, not a descendant of either of its columns.
    tracklib_placement = page.evaluate("""() => {
        const lib = document.querySelector('.acell-radio-tracklib');
        const display = document.querySelector('.acell-radio-display');
        const body = document.querySelector('.acell-radio-body');
        return {
            nestedInDisplay: !!(lib && display && display.contains(lib)),
            isSiblingAfterBody: !!(lib && body && lib.previousElementSibling === body),
        };
    }""")
    record("acell", "the Track Library is not buried inside the Cue List column",
           not tracklib_placement["nestedInDisplay"], str(tracklib_placement))
    record("acell", "the Track Library is a full-width section directly after the dial/broadcast/cue-list panel",
           tracklib_placement["isSiblingAfterBody"], str(tracklib_placement))
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
    record("acell", "Play on a library track defaults to loop off",
           backend_state["loop"] is False, backend_state["loop"])

    # Regression test: looping an uploaded track technically worked
    # before this (Play already read the shared #music-loop-input
    # checkbox), but that checkbox lives in section 03's paste-a-URL
    # flow, nowhere near this list's own Play button -- a per-row
    # checkbox here is what a Handler would actually expect to find.
    page.check('[data-tracklib-loop="0"]')
    page.click('[data-tracklib-play="0"]')
    page.wait_for_timeout(300)
    record("acell", "checking a library track's own Loop box before Play sends loop: '1'",
           backend_state["loop"] is True, backend_state["loop"])

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

def test_table_radio_pause_and_loop(p):
    """Table Radio: the Handler can Pause/Resume a broadcast in place
    (set_now_playing always restarts a track from 0:00, which isn't the
    right tool for "hold on a second") and mark a track to Loop (for
    ambience tracks that should keep repeating instead of the Handler
    re-cueing it every time it ends). get_now_playing carries paused/
    paused_at/loop; the widget must reflect a paused broadcast by NOT
    autoplaying the <audio> element, and a looping one by setting its
    real .loop property."""
    # A real (if tiny) playable WAV, not an empty body -- an empty
    # response has no decodable audio, so .play() rejects and .paused
    # snaps back to true regardless of pause state, which would make the
    # "not paused when playing" assertion below meaningless.
    import wave, io
    wav_buf = io.BytesIO()
    w = wave.open(wav_buf, "wb")
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
    w.writeframes(b"\x00\x00" * 8000)
    w.close()
    wav_bytes = wav_buf.getvalue()

    # Headless Chromium's autoplay policy can block .play() even on a
    # valid, muted <audio> element in this sandbox, which would make
    # asserting on the real post-decode .paused state flaky regardless of
    # whether renderEmbed() called .play() at all. Instrument .play()
    # itself instead -- it's synchronously invoked (or not) the instant
    # renderEmbed() decides to call it, independent of whether the
    # browser's autoplay policy then lets that call actually succeed.
    play_probe = """
        window.__dgPlayCalls = [];
        var orig = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () {
            if (this.id === 'dg-radio-audio') window.__dgPlayCalls.push(Date.now());
            var p = orig.call(this);
            if (p && p.catch) p.catch(function () { /* autoplay policy, not our bug */ });
            return p;
        };
    """

    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.add_init_script("try { sessionStorage.setItem('dg_boot_seen', '1'); } catch (e) {}")
    page.add_init_script(play_probe)
    page.route("**/ambience.mp3", lambda r: r.fulfill(status=200, content_type="audio/wav", body=wav_bytes))

    # Scenario 1: broadcasting normally, with Loop on. started_at is "now"
    # (not a fixed past timestamp) -- the widget seeks the <audio>
    # element to the elapsed time since started_at, and seeking past a
    # short fixture track's actual duration snaps it straight to
    # "ended" (paused), which would make this scenario's "actually
    # playing" assertion meaningless.
    now_ms = int(__import__("time").time() * 1000)
    def fake_playing_looped(route):
        req = route.request
        if req.method == "POST":
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            if "action=get_now_playing" in url:
                res = {"status": "OK", "channel": "1", "track_url": "https://example.com/ambience.mp3",
                       "track_title": "Rain Loop", "started_at": now_ms,
                       "paused": False, "paused_at": 0, "loop": True}
            else:
                res = {"status": "OK"}
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", fake_playing_looped)

    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.evaluate("() => localStorage.setItem('dg_radio_channel', '1')")
    page.reload(wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(700)

    audio_el = page.query_selector("#dg-radio-embed-wrap audio")
    record("radio", "a Loop-flagged track sets the <audio> element's real .loop",
           audio_el is not None and page.eval_on_selector("#dg-radio-embed-wrap audio", "el => el.loop") is True, "")
    record("radio", "a normally-playing (not paused) broadcast calls .play() on the <audio> element",
           page.evaluate("() => (window.__dgPlayCalls || []).length") > 0, "")
    record("radio", "status shows On air for a playing, non-paused broadcast",
           page.eval_on_selector("#dg-radio-status", "el => el.textContent") == "On air", "")
    page.close()

    # Scenario 2: the Handler has paused the broadcast -- a fresh listener
    # tuning in should see it frozen, not autoplaying.
    def fake_playing_paused(route):
        req = route.request
        if req.method == "POST":
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            if "action=get_now_playing" in url:
                res = {"status": "OK", "channel": "1", "track_url": "https://example.com/ambience.mp3",
                       "track_title": "Rain Loop", "started_at": now_ms,
                       "paused": True, "paused_at": now_ms, "loop": False}
            else:
                res = {"status": "OK"}
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page2 = p.new_page()
    page2.set_default_timeout(8000)
    errs2 = collect_errors(page2)
    page2.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page2.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page2.add_init_script("try { sessionStorage.setItem('dg_boot_seen', '1'); } catch (e) {}")
    page2.add_init_script(play_probe)
    page2.route("**/ambience.mp3", lambda r: r.fulfill(status=200, content_type="audio/wav", body=wav_bytes))
    page2.route("**/script.google.com/**", fake_playing_paused)

    page2.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page2.evaluate("() => localStorage.setItem('dg_radio_channel', '1')")
    page2.reload(wait_until="domcontentloaded", timeout=15000)
    page2.wait_for_timeout(700)

    record("radio", "a Handler-paused broadcast does not call .play() for a listener tuning in",
           page2.evaluate("() => (window.__dgPlayCalls || []).length") == 0, "")
    record("radio", "a Handler-paused broadcast leaves the <audio> element paused in the DOM",
           page2.eval_on_selector("#dg-radio-embed-wrap audio", "el => el.paused") is True, "")
    record("radio", "status tells the listener the Handler paused it, not that it's dead air",
           page2.eval_on_selector("#dg-radio-status", "el => el.textContent") == "Paused by the Handler", "")
    page2.close()
    return errs + errs2

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

def test_table_radio_theme_consistent_style(p):
    """Bug report (screenshots): the Tune In panel's dial arrows and
    Confirm button looked different across themes -- a plain border box
    in Modern, nearly invisible (flat, theme-primary-colored fill) in
    Son of Sam. Root cause: .dgr-turn/.dgr-confirm/.dgr-volume were bare
    class selectors in table-radio.js's injected CSS, losing on
    specificity to each theme's own blanket `button`/`input` rules in
    stats/styles.css (e.g. .theme-son-of-sam button, .theme-modern
    input) -- same class of bug .dgr-btn was already protected against
    (see its #dg-radio-panel prefix and comment). Confirms the dial's
    computed border/background now stay identical across two themes
    with very different generic button treatments."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.add_init_script("try { sessionStorage.setItem('dg_boot_seen', '1'); } catch (e) {}")
    page.route("**/script.google.com/**", lambda r: r.fulfill(status=200, content_type="application/json", body='{"status":"OK"}'))

    def dial_styles(theme):
        page.evaluate(f"() => window.setTheme && window.setTheme('{theme}')")
        page.wait_for_timeout(200)
        page.click("#dg-radio-pill")
        page.wait_for_timeout(300)
        styles = page.evaluate("""() => {
            var turn = document.querySelector('.dgr-turn');
            var confirm = document.getElementById('dg-radio-confirm-tune');
            var cs1 = getComputedStyle(turn), cs2 = getComputedStyle(confirm);
            return {
                turnBorder: cs1.borderColor, turnBg: cs1.backgroundColor,
                confirmBorder: cs2.borderColor, confirmBg: cs2.backgroundColor,
            };
        }""")
        page.click("#dg-radio-cancel")
        page.wait_for_timeout(150)
        return styles

    page.goto(f"{BASE}/stats/index.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(500)
    modern_styles = dial_styles("modern")
    sam_styles = dial_styles("son-of-sam")

    record("radio", "the dial turn buttons keep the same border color across Modern and Son of Sam themes",
           modern_styles["turnBorder"] == sam_styles["turnBorder"], f"{modern_styles} vs {sam_styles}")
    record("radio", "the dial turn buttons keep the same background across Modern and Son of Sam themes",
           modern_styles["turnBg"] == sam_styles["turnBg"], f"{modern_styles} vs {sam_styles}")
    record("radio", "the Tune In confirm button keeps the same border color across Modern and Son of Sam themes",
           modern_styles["confirmBorder"] == sam_styles["confirmBorder"], f"{modern_styles} vs {sam_styles}")
    record("radio", "the Tune In confirm button keeps the same background across Modern and Son of Sam themes",
           modern_styles["confirmBg"] == sam_styles["confirmBg"], f"{modern_styles} vs {sam_styles}")
    record("radio", "no JS exceptions", len(errs) == 0, "; ".join(errs))
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
            # Every #dg-form [required] field, not just a few -- a
            # partial profile (see the dedicated incomplete-profile test
            # below) is exactly the case isProfilingComplete() bounces
            # back to Profiling instead of showing the Agent File tab.
            fake_data = {
                "char_name": "Owen Castillo", "codename": "Ferro", "age_range": "Late 30s",
                "sex": "Male", "profession": "Pilot", "nationality": "American",
                "face_shape": "square", "eye_color": "hazel", "eye_shape": "narrow",
                "nose": "broad", "lips": "full", "skin": "olive",
                "facial_hair": "goatee", "hair_color": "black", "hair_style": "buzzed",
                "hair_texture": "coarse", "build": "athletic", "posture": "alert",
                "jacket": "flight jacket", "shirt": "uniform shirt", "trousers": "uniform trousers",
                "footwear": "deck shoes", "expression": "focused", "vibe": "quietly capable",
            }
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
    record("agent-portal", "?code=...#agent opens straight to the Agent File tab (Profiling is complete)",
           "active" in page.eval_on_selector("#tw-agent", "el => el.className"), "")
    record("agent-portal", "?code=...#agent loads that exact agent's name",
           page.eval_on_selector("#af-agent-name", "el => el.textContent") == "Owen Castillo", "")

    # Bug fix: loadAgentFile() (the ?code=...#agent path) used to only
    # render the read-only Agent File dossier -- switching over to the
    # Profiling tab afterward showed a blank form instead of this same
    # Agent's data, since only the separate "Restore by code" flow
    # (loadAgentCode()) populated it. Both now share populateCoverForm().
    page.click("#tw-cover")
    page.wait_for_timeout(200)
    record("agent-portal", "switching to the Profiling tab after ?code=...#agent shows that Agent's name, not a blank form",
           page.eval_on_selector("#dg-form [name=char_name]", "el => el.value") == "Owen Castillo", "")
    # profession has no form field on Profiling (removed -- the character
    # sheet's own profession dropdown is the real source of this data),
    # so check the underlying restored data carries it rather than a
    # form value.
    record("agent-portal", "switching to the Cover tab after ?code=...#agent still has that Agent's profession in afData",
           page.evaluate("() => afData && afData.profession") == "Pilot", "")
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

def test_agent_portal_profiling_gate(p):
    """The Agent File tab (dg-agent-portal.html) is gated behind Profiling
    actually being "filled out totally and submitted" -- defined as every
    #dg-form [required] field having a real value (isProfilingComplete()),
    not just "a Delta Green Briefs row exists for this code". That
    distinction matters because stats/'s "Open Agent File" button
    auto-exports a real but partial row (name/sex/nationality/profession/
    build/outfit only -- see agent-portal-export.js's run()) straight to
    the backend, bypassing this form's own required-field validation
    entirely. Covers both directions: an incomplete profile bounces the
    Agent File tab back to Profiling (whether reached via ?code=...#agent
    or a direct tab click), and the Random Agent Generator on Profiling
    skips rerolling fields that already carry real Agent data instead of
    clobbering them."""
    errs_all = []

    def partial_fake_apps_script(route):
        url = route.request.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            # Deliberately shaped like stats/'s auto-export payload --
            # only the handful of fields it actually sets, everything
            # else #dg-form marks required is missing.
            fake_data = {"char_name": "Mark Delacroix", "age_range": "30s", "sex": "Male",
                         "nationality": "American", "profession": "Federal Agent", "build": "muscular",
                         "jacket": "dark suit jacket", "shirt": "white dress shirt",
                         "trousers": "dark slacks", "footwear": "polished oxfords"}
            body = f'{cb}({json.dumps({"status": "OK", "data": fake_data})})'
            route.fulfill(status=200, content_type="application/javascript", body=body)
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')

    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.route("**/script.google.com/**", partial_fake_apps_script)
    page.goto(f"{BASE}/dg-agent-portal.html?code=MARK-DL01#agent", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(600)
    record("agent-portal", "an incomplete profile (auto-export shape) bounces ?code=...#agent back to Profiling",
           "active" in page.eval_on_selector("#tw-cover", "el => el.className"), "")
    record("agent-portal", "the Agent File tab is NOT shown for an incomplete profile",
           not page.eval_on_selector("#tw-agent", "el => el.classList.contains('active')"), "")
    # profession has no form field on Profiling (removed) -- checked via
    # afData instead, same as the other two occurrences below.
    record("agent-portal", "the already-known fields carry over into Profiling despite the bounce",
           page.eval_on_selector("#dg-form [name=char_name]", "el => el.value") == "Mark Delacroix"
           and page.eval_on_selector("#dg-form [name=build]", "el => el.value") == "muscular"
           and page.evaluate("() => afData && afData.profession") == "Federal Agent", "")

    # Clicking the Agent File tab directly (not just the ?code= route)
    # bounces back too, for the same still-incomplete Agent.
    page.click("#tw-agent")
    page.wait_for_timeout(200)
    record("agent-portal", "clicking the Agent File tab directly also bounces back to Profiling while incomplete",
           "active" in page.eval_on_selector("#tw-cover", "el => el.className"), "")

    # Random Generate must not reroll the fields the (auto-)export
    # already established -- only fill in the rest of the blank brief.
    page.evaluate("randomizeAgent(null)")
    page.wait_for_timeout(200)
    record("agent-portal", "Random Generate leaves the already-known name untouched",
           page.eval_on_selector("#dg-form [name=char_name]", "el => el.value") == "Mark Delacroix", "")
    record("agent-portal", "Random Generate leaves the already-known build (from STR) untouched",
           page.eval_on_selector("#dg-form [name=build]", "el => el.value") == "muscular", "")
    record("agent-portal", "Random Generate leaves the already-known sex untouched",
           page.eval_on_selector("#dg-form [name=sex]", "el => el.value") == "Male", "")
    record("agent-portal", "Random Generate DOES fill in a field that was genuinely still blank (face_shape)",
           page.eval_on_selector("#dg-form [name=face_shape]", "el => el.value") != "", "")

    errs_all.extend(errs)
    page.close()
    return errs_all

def test_stats_load_by_code_query_param(p):
    """agent-hub.html's Agent Files "Play" button links to
    stats/index.html?load=XXXX&live=1 -- loads that exact agent from the
    Cloud Save backend (dgCloudSave.loadFromCloud(), see
    stats/cloud-sync.js) and switches Live Play mode on over whichever
    theme this device last used, rather than leaving whatever this
    browser last auto-saved showing. Also covers a real, previously-
    undiscovered race: scripts.js builds the stat/skill DOM (and has its
    own defensive "reset stats again 50ms later" timer) inside its own
    window.onload handler -- a cloud response landing before or during
    that window used to have its writes silently dropped or immediately
    reset back to defaults (see the onApplied-chained deferral in
    cloud-sync.js's loadFromCloud())."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    def fake_apps_script(route):
        url = route.request.url
        if "action=load_character" in url and "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            char_state = {"v": 1, "bio": {"name": "Owen Castillo", "profession": ""},
                          "stats": {"STR": 14, "CON": 12, "DEX": 10, "INT": 16, "POW": 13, "CHA": 11},
                          "csStats": {"STR": 14, "CON": 12, "DEX": 10, "INT": 16, "POW": 13, "CHA": 11}}
            body = f'{cb}({json.dumps({"status": "OK", "agent_code": "OWEN-CS12", "character_json": json.dumps(char_state)})})'
            route.fulfill(status=200, content_type="application/javascript", body=body)
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", fake_apps_script)

    page.goto(f"{BASE}/stats/index.html?load=OWEN-CS12&live=1", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(1800)
    record("stats-terminal", "?load=... loads that exact agent's name from the cloud",
           page.eval_on_selector("#cs-name", "el => el.value") == "Owen Castillo", "")
    record("stats-terminal", "?live=1 switches Live Play mode on",
           "live-play" in page.eval_on_selector("body", "el => el.className"), "")
    str_val = page.eval_on_selector("#STR-value", "el => el.textContent")
    record("stats-terminal", "the loaded agent's stats survive scripts.js's window.onload + defensive 50ms reset timer",
           str_val == "14", f"STR={str_val!r}")
    record("stats-terminal", "no JS exceptions", len(errs)==0, "; ".join(errs))
    page.close()
    return errs

def test_stats_loading_terminal(p):
    """The ?load=CODE gate (body.dg-agent-loading, see the inline script
    at the top of stats/index.html's <body>) used to show plain gray
    "Loading Agent..." text -- replaced with a typed green-terminal
    sequence matching index.html's boot splash. The mock here never
    fulfills the load_character route, so the gate stays up for the
    whole test and the typing animation can be inspected mid-flight."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.route("**/script.google.com/**", lambda route: None)  # never fulfilled -- load hangs

    page.goto(f"{BASE}/stats/index.html?load=OWEN-CS12&live=1", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)
    record("stats-terminal", "the loading gate is up while the cloud fetch is still pending",
           "dg-agent-loading" in page.eval_on_selector("body", "el => el.className"), "")
    record("stats-terminal", "the sheet underneath stays hidden while gated",
           page.eval_on_selector("#app-main", "el => getComputedStyle(el).visibility") == "hidden", "")
    term_text = page.eval_on_selector("#dg-loading-term", "el => el.textContent")
    record("stats-terminal", "a green terminal line is typing, not the old plain 'Loading Agent...' text",
           term_text.startswith(">") and "Loading Agent" not in term_text, repr(term_text))
    record("stats-terminal", "a blinking terminal cursor is rendered",
           page.locator(".dg-loading-cursor").count() == 1, "")

    # A fixed sleep here used to have only ~250ms of slack over the
    # animation's own ~3050ms nominal duration -- fine in isolation, but
    # dgInitStatsSheet() (stats/scripts.js) now runs its DOM construction
    # on DOMContentLoaded instead of the much-later window.onload (see
    # its own comment for why), so it now shares the main thread with
    # this typing loop's early setInterval ticks instead of running
    # well after they've finished. That's a real product improvement
    # (it's what fixed a reported 8-10s character-load lag), but it
    # means this animation can now visibly land a beat later under CPU
    # load. Poll instead of a fixed sleep so the test tracks actual
    # completion rather than a margin that any future timing shift can
    # silently eat into again.
    final_text = wait_for_condition(
        lambda: (page.eval_on_selector("#dg-loading-term", "el => el.textContent") or "").startswith(">decrypting_dossier"),
        timeout_ms=6000)
    record("stats-terminal", "the full sequence has typed out and settled on its last line",
           bool(final_text), repr(page.eval_on_selector("#dg-loading-term", "el => el.textContent")))
    record("stats-terminal", "no JS exceptions", len(errs) == 0, "; ".join(errs))
    page.close()
    return errs

def test_stats_load_error_reveals_gate_quickly(p):
    """Regression test for a real report: the ?load=CODE loading gate
    consistently sat for the full 8-10s -- matching setTimeout(revealGate,
    8000)'s safety timeout to the second, not variable network/backend
    latency. Root cause: loadFromCloud()'s JSONP callback (cloud-sync.js)
    only ever notified the caller on a clean success or a clean
    NOT_FOUND -- a genuine backend error (status: 'ERROR'), an empty
    response, or a JSON parse failure all fell through with no callback
    at all, so the ?load= handler's gate had no way to hear the load had
    settled and just sat there until the safety timeout finally fired.
    Fixes it via a new onSettled callback that fires on every outcome.
    This mocks load_character returning a backend error and confirms the
    gate lifts almost immediately, not after ~8 seconds."""
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
        body = json.dumps({"status": "ERROR", "message": "Something went wrong server-side"})
        route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({body})')
    page.route("**/script.google.com/**", fake_apps_script)

    import time
    start = time.monotonic()
    page.goto(f"{BASE}/stats/index.html?load=BROK-EN01&live=1", wait_until="domcontentloaded", timeout=15000)
    wait_for_condition(lambda: "dg-agent-loading" not in (page.eval_on_selector("body", "el => el.className") or ""),
                        timeout_ms=6000)
    elapsed = time.monotonic() - start
    record("stats-terminal", "a backend error lifts the loading gate quickly, not after the full 8s safety timeout",
           elapsed < 6, f"elapsed={elapsed:.1f}s")
    record("stats-terminal", "the sheet is visible again once the gate lifts",
           page.eval_on_selector("#app-main", "el => getComputedStyle(el).visibility") != "hidden", "")

    record("stats-terminal", "no JS exceptions", len(errs) == 0, "; ".join(errs))
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

    page.goto(f"{BASE}/stats/index.html?load=DANI-U8BM&live=1", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(1500)

    # startRecruitFlow() now gates behind dgConfirm() (save-load.js), an
    # in-page dialog, not window.confirm() -- confirm() is silently
    # disabled in an iOS standalone PWA, so this is the real, working
    # equivalent of what a player actually sees.
    dialog_text = page.eval_on_selector("#dg-confirm-message", "el => el.textContent") \
        if page.query_selector("#dg-confirm-message") else ""
    record("stats-terminal", "a not-found Play link warns before overwriting, in case the Agent's real sheet just hasn't synced",
           "DANI-U8BM" in dialog_text and "overwrite" in dialog_text.lower(),
           dialog_text)

    page.click("#dg-confirm-ok")
    page.wait_for_timeout(500)

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

    page.goto(f"{BASE}/stats/index.html?load=PATR-EQ9A&live=1", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(1500)
    page.click("#dg-confirm-cancel")
    page.wait_for_timeout(500)

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

    # a-cell.html's Evidence tab: the general sweep above never opens the
    # sidebar+form layout (.evidence-layout is a flex ROW with a fixed-
    # width sidebar, unwrapped below 720px until its own media query --
    # a real bug once reported live: the create form got pushed off the
    # right edge of a phone screen). Check with the Evidence tab active
    # and its create form open, since that's the widest state.
    page = p.new_page(viewport={"width": 390, "height": 844})
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.route("**/script.google.com/**", lambda r: r.fulfill(status=200, content_type="application/json", body='{"status":"OK"}'))
    skip_acell_gate(page)
    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(400)
    page.click('.tw[data-tab="evidence"]')
    page.wait_for_timeout(300)
    page.click("#evidence-create-btn")
    page.wait_for_timeout(300)
    scroll_width = page.evaluate("() => document.documentElement.scrollWidth")
    record("mobile", "a-cell.html's Evidence tab (sidebar + open create form) has no horizontal overflow at 390px viewport",
           scroll_width <= 390, f"scrollWidth={scroll_width}")
    errs_all.extend(errs)
    page.close()

    # All six stats/ themes are expected to be overflow-free at 390px --
    # the fieldset/grid/table min-width fixes added for this are
    # theme-agnostic (gated on viewport width, not theme class), covering
    # X-Files, Modern, Son of Sam, and Field Notes the same as Mobile.
    # Live Play mode is checked separately below with actual filled
    # content, since its full character sheet is the one deliberate
    # exception (it scrolls horizontally within its own box by design --
    # see that check for detail).
    page = p.new_page(viewport={"width": 390, "height": 844})
    page.set_default_timeout(5000)
    errs = collect_errors(page)
    page.goto(f"{BASE}/stats/index.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(500)
    page.click("#settings-cog-btn")
    page.wait_for_timeout(200)
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

    # Live Play mode: the full character sheet reflows to a single
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

    page.evaluate("setLivePlay(true)")
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

def test_agent_portal_autorestore_prefills_cover(p):
    """Bug fix: a bare visit to dg-agent-portal.html (no ?code=, no
    #agent/#ids hash -- e.g. a bookmark, or a generic "Agent File" nav
    link) lands on the Cover tab by default (panel-cover is the markup's
    default-active panel). autoRestore() picked up the last-active Agent
    from dg_last_agent into afData/afCode, but only pushed it into the
    Cover form when the hash happened to be #agent (which calls
    openInAgentFile() -> populateCoverForm()) -- the far more common
    plain-visit case left the Cover form blank even though this browser
    already knew this Agent's data. populateCoverForm() is now called
    unconditionally in autoRestore()."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.route("**/script.google.com/**", lambda r: r.fulfill(status=200, content_type="application/json", body='{"status":"OK"}'))
    saved = {"code": "OWEN-CS12", "data": {"char_name": "Owen Castillo", "profession": "Pilot", "codename": "Ferro"}}
    page.add_init_script(f"localStorage.setItem('dg_last_agent', '{json.dumps(saved)}');")
    page.goto(f"{BASE}/dg-agent-portal.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(400)
    record("agent-portal", "a bare visit lands on the Cover tab by default",
           "active" in page.eval_on_selector("#tw-cover", "el => el.className"), "")
    record("agent-portal", "the last-active Agent's name is already in the Cover form, not blank",
           page.eval_on_selector("#dg-form [name=char_name]", "el => el.value") == "Owen Castillo", "")
    record("agent-portal", "the last-active Agent's profession is still in afData (no form field for it anymore)",
           page.evaluate("() => afData && afData.profession") == "Pilot", "")
    record("agent-portal", "no JS exceptions", len(errs) == 0, "; ".join(errs))
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
           not page.is_visible("#open-character-sheet-btn"), "")

    # A complete brief, not just a name -- isProfilingComplete() now
    # gates the Agent File tab behind every #dg-form [required] field
    # actually being filled in, so a name-only submission (as this used
    # to be) wouldn't even get past that gate to reach the button this
    # test is actually about. A complete submit now opens the Agent File
    # tab directly (no more "click Open Agent File on the dossier card"
    # step in between).
    fill_cover_form(page, {
        "char_name": "Marcus Reyes", "nationality": "American", "face_shape": "square",
        "eye_color": "brown", "eye_shape": "narrow", "nose": "broad", "lips": "thin",
        "skin": "tan", "facial_hair": "goatee", "hair_color": "black", "hair_style": "short",
        "hair_texture": "coarse", "build": "stocky", "posture": "alert", "jacket": "windbreaker",
        "shirt": "t-shirt", "trousers": "jeans", "footwear": "boots", "expression": "wary",
        "vibe": "coiled and watchful",
    }, "#dg-form")
    page.click("#submit-btn")
    page.wait_for_timeout(400)

    btn = page.locator("#open-character-sheet-btn")
    record("agent-portal", "Open Character Sheet button appears once an agent is loaded",
           btn.count() == 1, "")

    # Submitting the Cover form mints an Agent Code (afCode) -- the button
    # now carries that code through as ?load=, so stats/'s own cloud
    # lookup can try to resume this exact Agent instead of blindly
    # opening whatever was last saved locally on this device (see
    # dgOpenCharacterSheet() in dg-agent-portal.html).
    btn.click()
    for _ in range(20):
        if "stats/index.html" in page.url:
            break
        page.wait_for_timeout(300)
    record("agent-portal", "Open Character Sheet button navigates to stats/index.html",
           "stats/index.html" in page.url, page.url)
    record("agent-portal", "Open Character Sheet carries the Agent's known code through as ?load=",
           "load=" in page.url, page.url)

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

    # fill + submit cover form -- a complete submission now opens
    # straight into the Agent File tab instead of showing the old
    # inline printable dossier card underneath Profiling.
    fill_cover_form(page, agent, "#dg-form")
    page.click("#submit-btn")
    page.wait_for_timeout(400)
    status = page.text_content("#form-status")
    agent_tab_active = "active" in page.eval_on_selector("#tw-agent", "el => el.className")
    af_name = page.text_content("#af-agent-name") or ""
    ok = agent_tab_active and agent["char_name"] in af_name
    record("agent-portal", "cover submit opens straight into the Agent File tab", ok, status or "")

    # grab the generated code from local storage for downstream tests
    saved = page.evaluate("() => { try { return JSON.parse(localStorage.getItem('dg_last_agent')); } catch(e){ return null; } }")
    code = saved["code"] if saved else None
    record("agent-portal", "agent persisted to localStorage after submit", bool(code), str(code))

    page.close()
    return errs, code

def test_agent_portal_random_generator_matches_sex(p):
    """Regression test for an older request: the Profiling page's Random
    Agent Generator (generateAgent() in dg-agent-portal.html) rolls a
    random sex but drew facial_hair and hair_style from flat, unisex
    tables regardless of it -- a Female agent could be randomly assigned
    a handlebar mustache or a buzzcut. facial_hair/hair_style are now
    drawn from sex-specific tables. Forces Math.random() to a fixed value
    for the whole call (not just the sex roll) so the result is
    deterministic without caring which exact array index gets picked --
    only that it lands in the correct list for whichever sex the same
    forced roll produced."""
    FACIAL_HAIR_FEMALE = {'none', 'none, meticulous about it', 'faint, barely visible — never remarked on'}
    FACIAL_HAIR_MALE = {
        'clean-shaven, always', 'heavy five-o-clock shadow, never fully shaved',
        'full beard, unkempt', 'neat mustache', 'handlebar mustache, well-maintained',
        'thin goatee', 'stubble that never grows into a beard',
        'clean-shaven with a visible nick scar', 'mutton chops', 'week-old stubble',
    }
    HAIR_STYLE_FEMALE = {
        'shoulder-length, worn loose', 'long, tied back in a practical braid',
        'chin-length bob, no-nonsense', 'pulled back in a tight, functional bun',
        'short and practical, choppy layers', 'high ponytail, functional',
        'pixie cut, easy to maintain', 'long, usually pinned up out of the way',
        'undercut, longer on top', 'natural curls, kept short for practicality',
    }
    HAIR_STYLE_MALE = {
        'short back and sides, slightly grown out', 'military cut, fading at sides',
        'side-swept, needs cutting', 'close-cropped, nearly shaved',
        'slicked back with something greasy',
        'thinning on top, compensated for', 'short and practical, no styling',
        'buzzcut', 'mid-length, pushed behind the ears',
    }

    errs_all = []
    for forced_roll, expected_sex, facial_set, hair_set in [
        (0.1, 'Female', FACIAL_HAIR_FEMALE, HAIR_STYLE_FEMALE),
        (0.9, 'Male', FACIAL_HAIR_MALE, HAIR_STYLE_MALE),
    ]:
        page = p.new_page()
        page.set_default_timeout(8000)
        errs = collect_errors(page)
        page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
        page.route("**/script.google.com/**", lambda r: r.fulfill(status=200, content_type="application/json", body='{"status":"OK"}'))
        page.add_init_script(f"Math.random = () => {forced_roll};")
        page.goto(f"{BASE}/dg-agent-portal.html", wait_until="domcontentloaded", timeout=15000)
        page.wait_for_timeout(300)

        page.click("button:has-text('Generate')")
        page.wait_for_timeout(200)

        sex_val = page.input_value('#dg-form [name="sex"]')
        facial_val = page.input_value('#dg-form [name="facial_hair"]')
        hair_val = page.input_value('#dg-form [name="hair_style"]')
        record("agent-portal", f"forced roll {forced_roll} produces sex={expected_sex}",
               sex_val == expected_sex, sex_val)
        record("agent-portal", f"a {expected_sex} agent's facial hair comes from the {expected_sex.lower()} table",
               facial_val in facial_set, facial_val)
        record("agent-portal", f"a {expected_sex} agent's hair style comes from the {expected_sex.lower()} table",
               hair_val in hair_set, hair_val)

        record("agent-portal", "no JS exceptions", len(errs) == 0, "; ".join(errs))
        errs_all.extend(errs)
        page.close()
    return errs_all

def test_agent_portal_incomplete_submit_blocked(p):
    """Regression test for a real bug: #dg-form's [required] attributes
    were purely decorative -- the submit button is type="submit" inside a
    form with onsubmit="return false", so handleSubmit() fired
    unconditionally on click regardless of which required fields were
    still blank. A brief could submit successfully that way and then
    permanently fail isProfilingComplete()'s gate on the Agent File tab
    later, with no indication to the player of what was actually missing
    (a real report: 'agent file won't open even though it's been
    created'). handleSubmit() now calls form.reportValidity() first and
    bails out if the form is invalid, so a blocked submission always
    comes with the browser's own pointer at the empty field."""
    page = p.new_page()
    page.set_default_timeout(5000)
    errs = collect_errors(page)
    mock_routes(page)
    page.goto(f"{BASE}/dg-agent-portal.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)

    # Fill only char_name -- every other [required] field left blank.
    page.fill("#dg-form [name=char_name]", "Incomplete Ivy")
    page.click("#submit-btn")
    page.wait_for_timeout(300)

    saved = page.evaluate("() => { try { return JSON.parse(localStorage.getItem('dg_last_agent')); } catch(e){ return null; } }")
    record("agent-portal", "submitting with required fields blank does not submit (no code minted)",
           saved is None, str(saved))

    invalid_count = page.eval_on_selector_all("#dg-form [required]:invalid", "els => els.length")
    record("agent-portal", "the browser flags at least one blank required field as invalid",
           invalid_count > 0, f"invalid_count={invalid_count}")

    record("agent-portal", "no JS exceptions", len(errs)==0, "; ".join(errs))
    page.close()
    return errs

def test_agent_portal_submit_reuses_roster_code(p):
    """Regression test for a real report: a character built or imported
    on stats/index.html mints and stores its own Agent Code independently
    (dg_agent_roster, written by stats/cloud-sync.js) before this page
    ever sees it. Submitting a Profiling brief for that same Agent from a
    fresh visit here (no ?code= in the URL, so afCode is never restored)
    used to only check the in-memory afCode for a same-name match, never
    the roster -- so it minted a brand new, disconnected code instead of
    reusing the one the character sheet already had: two separate files
    (a Characters row and a Briefs row) for what should have been one
    Agent. handleSubmit() now also checks the roster by char_name."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    submit_posts = []
    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            try:
                body = json.loads(req.post_data or "{}")
            except Exception:
                body = {}
            if body.get("char_name"):
                submit_posts.append(body)
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" not in url:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        cb = url.split("callback=")[1].split("&")[0]
        route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({{"status":"NOT_FOUND"}})')
    page.route("**/script.google.com/**", fake_apps_script)

    agent = AGENTS[0]
    roster = json.dumps({"ROST-X001": {"code": "ROST-X001", "char_name": agent["char_name"], "saved_at": 1000}})
    page.add_init_script(f"localStorage.setItem('dg_agent_roster', '{roster}');")
    page.goto(f"{BASE}/dg-agent-portal.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)

    fill_cover_form(page, agent, "#dg-form")
    page.click("#submit-btn")
    page.wait_for_timeout(400)

    record("agent-portal", "a fresh Profiling submission for an Agent the roster already knows by name reuses its code",
           len(submit_posts) == 1 and submit_posts[0].get("agent_code") == "ROST-X001", str(submit_posts))

    record("agent-portal", "no JS exceptions", len(errs) == 0, "; ".join(errs))
    page.close()
    return errs

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

def test_agent_file_era_prompt_includes_era(p):
    """Regression test for a real bug: autoGenerateEraPrompts(era) built
    its generate_prompt POST payload without ever including era, even
    though the backend's generateAppearancePrompt() already has era-
    specific wardrobe styling logic (eraOutfitContext) waiting for it --
    so every era's Field Portrait/Field Reference prompt was generated
    with no period cue at all, and adding a new era later never actually
    changed the described clothing's styling. Confirms the actual POST
    body for both mode: base and mode: outfit carries the right era."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    complete_extra = {
        "age_range": "40s", "sex": "Female", "nationality": "Hispanic American",
        "face_shape": "oval", "eye_color": "brown", "eye_shape": "round",
        "nose": "straight", "lips": "thin", "skin": "tan", "facial_hair": "none",
        "hair_color": "black", "hair_style": "short", "hair_texture": "straight",
        "build": "average", "posture": "upright", "jacket": "coat", "shirt": "shirt",
        "trousers": "trousers", "footwear": "boots", "expression": "neutral", "vibe": "calm",
        "active_eras": json.dumps(["00s"]), "mode0_prompt": "", "mode1_prompt": "",
    }
    briefs = {"DANI-U8BM": {"char_name": "Daniela Martinez", **complete_extra}}
    prompt_posts = []

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            body = json.loads(req.post_data or "{}")
            if body.get("action") == "generate_prompt":
                prompt_posts.append(body)
                route.fulfill(status=200, content_type="application/json",
                               body=json.dumps({"status": "OK", "prompt": "[mock prompt]"}))
            else:
                route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" not in url:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        cb = url.split("callback=")[1].split("&")[0]
        if "code=" in url:
            code = url.split("code=")[1].split("&")[0]
            res = {"status": "OK", "data": briefs[code]} if code in briefs else {"status": "NOT_FOUND"}
        else:
            res = {"status": "OK"}
        route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
    page.route("**/script.google.com/**", fake_apps_script)

    page.goto(f"{BASE}/dg-agent-portal.html?code=DANI-U8BM#agent", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(1200)

    base_posts = [p_ for p_ in prompt_posts if p_.get("mode") == "base"]
    outfit_posts = [p_ for p_ in prompt_posts if p_.get("mode") == "outfit"]
    record("agent-portal", "the Field Portrait (mode: base) prompt request carries the Agent's actual era",
           len(base_posts) >= 1 and base_posts[0].get("era") == "00s", str(base_posts))
    record("agent-portal", "the Field Reference (mode: outfit) prompt request carries the Agent's actual era too",
           len(outfit_posts) >= 1 and outfit_posts[0].get("era") == "00s", str(outfit_posts))

    record("agent-portal", "no JS exceptions", len(errs) == 0, "; ".join(errs))
    page.close()
    return errs

def test_agent_file_outfit_plate_requires_face_first(p):
    """Regression test for a real bug: generating an Outfit Plate image
    read whatever the in-page <img id="img-face-ERA"> happened to hold as
    its Face Plate reference -- but saveGeneratedPlate() replaces that
    element wholesale (dropping its id) every time a Face Plate is
    generated or uploaded, so the very first Outfit Plate generated right
    after generating a Face Plate in the same session (the normal order
    of operations) silently went out with NO reference at all, producing
    a different-looking face. generatePlateImage() now (a) refuses to
    generate an Outfit Plate until a Face Plate exists, and (b) sources
    the reference from an in-memory cache of the just-generated Face
    Plate data URI (afRecentFacePlateDataUri) rather than DOM state."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    complete_extra = {
        "age_range": "30s", "sex": "Male", "nationality": "American",
        "face_shape": "oval", "eye_color": "brown", "eye_shape": "round",
        "nose": "straight", "lips": "thin", "skin": "tan", "facial_hair": "none",
        "hair_color": "brown", "hair_style": "short", "hair_texture": "straight",
        "build": "average", "posture": "upright", "jacket": "coat", "shirt": "shirt",
        "trousers": "trousers", "footwear": "boots", "expression": "neutral", "vibe": "calm",
        "active_eras": json.dumps(["00s"]), "mode0_prompt": "portrait prompt", "mode1_prompt": "outfit prompt",
    }
    briefs = {"NOFA-CE01": {"char_name": "No Face Yet", **complete_extra}}
    plate_posts = []

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            body = json.loads(req.post_data or "{}")
            if body.get("action") == "generate_plate_image":
                plate_posts.append(body)
                is_face = body.get("prompt") == "portrait prompt"
                img = "data:image/png;base64,RkFDRURBVEE=" if is_face else "data:image/png;base64,T1VURklUREFUQQ=="
                route.fulfill(status=200, content_type="application/json",
                               body=json.dumps({"status": "OK", "image_base64": img}))
            else:
                route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" not in url:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        cb = url.split("callback=")[1].split("&")[0]
        if "code=" in url:
            code = url.split("code=")[1].split("&")[0]
            res = {"status": "OK", "data": briefs[code]} if code in briefs else {"status": "NOT_FOUND"}
        else:
            res = {"status": "OK"}
        route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
    page.route("**/script.google.com/**", fake_apps_script)

    page.goto(f"{BASE}/dg-agent-portal.html?code=NOFA-CE01#agent", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(800)

    # Outfit Plate button should refuse before any Face Plate exists.
    page.click('button[data-mode="mode1"]:has-text("Generate Image")')
    page.wait_for_timeout(300)
    record("agent-portal", "generating an Outfit Plate before any Face Plate exists is blocked with a clear message",
           "Face Plate first" in page.inner_text("#prompt-mode1-status-00s"), page.inner_text("#prompt-mode1-status-00s"))
    record("agent-portal", "no generate_plate_image request was sent for the blocked Outfit Plate attempt",
           len(plate_posts) == 0, str(plate_posts))

    # Generate the Face Plate.
    page.click('button[data-mode="mode0"]:has-text("Generate Image")')
    page.wait_for_timeout(500)
    face_posts = [p_ for p_ in plate_posts if p_.get("prompt") == "portrait prompt"]
    record("agent-portal", "generating the Face Plate sends a generate_plate_image request",
           len(face_posts) == 1, str(face_posts))

    # Now Outfit Plate generation should go through, referencing the
    # just-generated Face Plate -- no reload, no round trip to Drive.
    page.click('button[data-mode="mode1"]:has-text("Generate Image")')
    page.wait_for_timeout(500)
    outfit_posts = [p_ for p_ in plate_posts if p_.get("prompt") == "outfit prompt"]
    record("agent-portal", "generating the Outfit Plate after the Face Plate exists sends a generate_plate_image request",
           len(outfit_posts) == 1, str(outfit_posts))
    record("agent-portal", "the Outfit Plate request carries the just-generated Face Plate as its reference image",
           len(outfit_posts) == 1 and outfit_posts[0].get("reference_image_base64") == "data:image/png;base64,RkFDRURBVEE=",
           str(outfit_posts))

    record("agent-portal", "no JS exceptions", len(errs) == 0, "; ".join(errs))
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

    # Complete profiles (every #dg-form [required] field set) -- this
    # test is about the KIA stamp on the Agent File tab, which only
    # renders once isProfilingComplete() lets the gate through.
    complete_extra = {
        "age_range": "30s", "sex": "Male", "nationality": "American",
        "face_shape": "oval", "eye_color": "brown", "eye_shape": "round",
        "nose": "straight", "lips": "thin", "skin": "tan", "facial_hair": "none",
        "hair_color": "brown", "hair_style": "short", "hair_texture": "straight",
        "build": "average", "posture": "upright", "jacket": "coat", "shirt": "shirt",
        "trousers": "trousers", "footwear": "boots", "expression": "neutral", "vibe": "calm",
    }
    briefs = {
        "DEAD-0001": {"char_name": "Owen Castillo", **complete_extra},
        "ALIV-0002": {"char_name": "Priya Anand", **complete_extra},
    }
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

def test_agent_file_vitals_and_bonds(p):
    """Vitals (HP/WP/SAN/BP) and Bond scores -- previously only visible
    to a Handler in A-Cell's Play view -- now also show on the Agent
    File tab, read from the same load_character record the KIA stamp
    already uses. Also regression-tests a bug caught while building
    this: reusing eraDataField() for Bond rows would have hidden any
    Bond whose score is legitimately 0, since that helper treats a
    falsy value as "nothing to show"."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    complete_extra = {
        "age_range": "30s", "sex": "Male", "nationality": "American",
        "face_shape": "oval", "eye_color": "brown", "eye_shape": "round",
        "nose": "straight", "lips": "thin", "skin": "tan", "facial_hair": "none",
        "hair_color": "brown", "hair_style": "short", "hair_texture": "straight",
        "build": "average", "posture": "upright", "jacket": "coat", "shirt": "shirt",
        "trousers": "trousers", "footwear": "boots", "expression": "neutral", "vibe": "calm",
    }
    briefs = {"VITL-0001": {"char_name": "Nora Kessler", **complete_extra}}
    characters = {
        "VITL-0001": json.dumps({
            "derived": {"hp": 11, "wp": 9, "san": 55, "bp": 20},
            "bonds": [
                {"name": "Marcus Webb", "relationship": "Partner", "score": 0},
                {"name": "Delta Green", "relationship": "Handler", "score": 12},
            ],
        }),
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
    page.fill("#af-code-input", "VITL-0001")
    page.click("#af-gate .af-gate-btn")
    page.wait_for_timeout(800)

    record("agent-portal", "the Vitals section becomes visible once the Agent's saved sheet loads",
           page.is_visible("#af-vitals-section"), "")
    record("agent-portal", "HP/WP/SAN/BP all show the saved sheet's actual values",
           (page.inner_text("#af-vital-hp"), page.inner_text("#af-vital-wp"),
            page.inner_text("#af-vital-san"), page.inner_text("#af-vital-bp")) == ("11", "9", "55", "20"),
           str((page.inner_text("#af-vital-hp"), page.inner_text("#af-vital-wp"),
                page.inner_text("#af-vital-san"), page.inner_text("#af-vital-bp"))))

    bonds_text = page.inner_text("#af-bonds-list")
    record("agent-portal", "both Bonds show up with their names",
           "Marcus Webb" in bonds_text and "Delta Green" in bonds_text, bonds_text)
    record("agent-portal", "a Bond with a legitimate score of 0 still shows 0, not hidden as if it had no score",
           "0" in bonds_text, bonds_text)
    record("agent-portal", "the other Bond's non-zero score also shows",
           "12" in bonds_text, bonds_text)

    record("agent-portal", "no JS exceptions", len(errs) == 0, "; ".join(errs))
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
    # Complete profiles, not just a name -- isProfilingComplete() now
    # gates the Agent File view behind every #dg-form [required] field
    # actually being filled in, so a name-only submission would bounce
    # rosterSelectAgent()'s "fetch by code" lookup (below) back to
    # Profiling instead of the roster-switching behavior this test is
    # actually about.
    for name in ["Marcus Reyes", "Priya Anand", "Owen Castillo"]:
        page.goto(f"{BASE}/dg-agent-portal.html", wait_until="domcontentloaded", timeout=15000)
        page.wait_for_timeout(300)
        fill_cover_form(page, {
            "char_name": name, "nationality": "American", "face_shape": "oval",
            "eye_color": "brown", "eye_shape": "round", "nose": "straight", "lips": "thin",
            "skin": "tan", "facial_hair": "clean-shaven", "hair_color": "brown",
            "hair_style": "short", "hair_texture": "straight", "build": "average",
            "posture": "upright", "jacket": "coat", "shirt": "shirt", "trousers": "trousers",
            "footwear": "boots", "expression": "neutral", "vibe": "unremarkable",
        }, "#dg-form")
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

def test_noindex(p):
    """The site is meant to be link-only, not search-indexable -- every
    top-level page carries <meta name="robots" content="noindex,
    nofollow"> and the repo root has a robots.txt disallowing everything.
    Not an access-control mechanism (no auth behind either signal, and
    a page already linked from elsewhere can still be crawled/indexed
    despite robots.txt) -- just an opt-out of search engines listing
    the site on their own."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    # JSONP-aware, not a plain JSON body -- these pages request Apps
    # Script data via <script src=...&callback=NAME>, so the response has
    # to come back as NAME({...}) or the browser trying to execute a bare
    # {"status":"OK"} as a <script> tag's JS throws "Unexpected token ':'"
    # (same mock shape as fake_apps_script in test_pwa_offline below).
    def fake_apps_script(route):
        url = route.request.url
        if route.request.method == "POST" or "callback=" not in url:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        cb = url.split("callback=")[1].split("&")[0]
        route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps({"status": "OK"})})')
    page.route("**/script.google.com/**", fake_apps_script)

    pages = ["index.html", "agent-hub.html", "a-cell.html", "dg-agent-portal.html", "dg-id-creator.html", "stats/index.html"]
    for path in pages:
        page.goto(f"{BASE}/{path}", wait_until="domcontentloaded", timeout=15000)
        content = page.eval_on_selector('meta[name="robots"]', "el => el && el.getAttribute('content')")
        record("noindex", f"{path} carries a noindex robots meta tag",
               content is not None and "noindex" in content, repr(content))

    robots_txt = page.evaluate(f"""async () => {{
        const res = await fetch('{BASE}/robots.txt');
        return await res.text();
    }}""")
    record("noindex", "robots.txt disallows crawling the whole site",
           "Disallow: /" in robots_txt, repr(robots_txt))
    record("noindex", "no JS exceptions", len(errs) == 0, "; ".join(errs))
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

def test_pwa_update_banner(p):
    """Update-available banner (assets/sw-update.js): sw.js activates a
    new version immediately (skipWaiting + clients.claim), but a tab left
    open across a deploy keeps running the JS already in memory until it
    reloads. sw-update.js listens for the service worker's
    'controllerchange' event -- the reliable signal that a new worker has
    taken control of this tab -- and shows a dismissible banner with a
    Reload button, instead of silently running stale code. A real
    cross-deploy service worker update can't be forced within a single
    Playwright run, so this dispatches that event directly and asserts
    the banner logic reacts correctly."""
    context = p.new_context()
    page = context.new_page()
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    errs = collect_errors(page)

    page.goto(f"{BASE}/index.html", wait_until="load", timeout=15000)
    wait_for_condition(lambda: page.evaluate("() => !!navigator.serviceWorker.controller"), timeout_ms=15000)

    record("pwa", "no update banner present before any controllerchange",
           page.query_selector("#dg-update-banner") is None, "")

    page.evaluate("() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange'))")
    page.wait_for_timeout(200)

    banner = page.query_selector("#dg-update-banner")
    record("pwa", "update banner appears after a controllerchange event", banner is not None, "")

    reload_btn = page.query_selector("#dg-update-banner button")
    record("pwa", "banner has a visible Reload button",
           reload_btn is not None and "Reload" in (reload_btn.inner_text() or ""), "")


def test_notes_v2_editorjs(p):
    """Player Notes v2: the editing engine was swapped from a hand-rolled
    textarea + custom markup syntax to Editor.js (vendored under
    notes/vendor/), motivated by two things the user asked for that the
    old engine couldn't give: real WYSIWYG (no more raw **markup** while
    typing) and easy paste-import from other note apps (Google Docs,
    Notion, Apple Notes -- none of which offer an API path suitable for
    this unauthenticated fan tool, so paste is the actual mechanism, and
    Editor.js's per-tool pasteConfig auto-splitting rich clipboard HTML
    into real Header/Paragraph/List blocks is what makes that good).

    Architecture note this test exists to verify: Editor.js is one
    editable document per instance, with no supported way to mix "my
    own editable blocks" with "someone else's read-only blocks" in one
    instance. So only your own tab ever mounts a live Editor.js
    instance; the combined Shared feed is a hand-rendered read-only HTML
    feed built straight from the same stored block data -- see notes.js's
    file header comment. There used to be a third kind of view (a
    per-member read-only tab for every other Cell member) but it was
    removed: it only ever showed that member's SHARED blocks, which is
    exactly the Shared feed's own content, just split per-author with
    an extra click to get to. Only Shared and your own tab remain now.

    The mock below stands in for the real Apps Script backend's
    server-side privacy filter (see listCellNotes() in backend/Code.gs)
    -- it only ever returns the requester's own blocks in full, others'
    filtered to shared==True, exactly like the real handler does. The
    critical assertion throughout is that a private block belonging to
    someone else never appears anywhere in page.content(), not just
    that the UI hides it -- a leak in the raw response would still show
    up in that check even if the UI happened to hide it.
    """
    page = p.new_page()
    page.set_default_timeout(25000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    cell = {"cell_id": "cell_1", "name": "Cell Alpha", "handler": "Sam",
            "member_codes": ["OWEN-CS12", "PRIY-AN34"]}
    # (block_id, owner, type, data, shared) -- `text` on the wire is a
    # JSON-stringified Editor.js block `data` object as of this v2 schema.
    blocks_state = [
        {"block_id": "b1", "agent_code": "PRIY-AN34", "block_type": "paragraph",
         "text": json.dumps({"text": "Priya's shared note"}), "shared": True, "sort_order": 1000, "created_at": 1, "updated_at": 1},
        {"block_id": "b2", "agent_code": "PRIY-AN34", "block_type": "paragraph",
         "text": json.dumps({"text": "Priya's PRIVATE note -- must never leak"}), "shared": False, "sort_order": 2000, "created_at": 1, "updated_at": 1},
        # A second shared block from a wildly different calendar date
        # (not just a different time same day) -- Timeline grouping
        # should split these two into separate date sections regardless
        # of the test runner's local timezone.
        {"block_id": "b3", "agent_code": "PRIY-AN34", "block_type": "paragraph",
         "text": json.dumps({"text": "Priya's second-day update"}), "shared": True, "sort_order": 3000, "created_at": 1700000000000, "updated_at": 1700000000000},
    ]
    identities = {"PRIY-AN34": {"color": "#2f855a", "font": "kalam"}}
    posts = []
    next_id = [3]

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            body = json.loads(req.post_data or "{}")
            posts.append(body)
            if body.get("action") == "save_note_block":
                bid = body.get("block_id") or ""
                existing = next((b for b in blocks_state if b["block_id"] == bid), None)
                if existing:
                    existing.update({"block_type": body.get("block_type"), "text": body.get("text"),
                                      "shared": bool(body.get("shared")), "sort_order": body.get("sort_order")})
                else:
                    bid = bid or ("b" + str(next_id[0])); next_id[0] += 1
                    blocks_state.append({"block_id": bid, "agent_code": body.get("agent_code"),
                                          "block_type": body.get("block_type"), "text": body.get("text"),
                                          "shared": bool(body.get("shared")), "sort_order": body.get("sort_order"),
                                          "created_at": 1, "updated_at": 1})
            elif body.get("action") == "save_agent_identity":
                identities[body.get("agent_code")] = {"color": body.get("color"), "font": body.get("font")}
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            if "action=list_cells" in url:
                res = {"status": "OK", "cells": [cell]}
            elif "action=list_cell_notes" in url:
                requester = url.split("agent_code=")[1].split("&")[0] if "agent_code=" in url else ""
                notes = {}
                for b in blocks_state:
                    if b["agent_code"] != requester and not b["shared"]:
                        continue  # private, not the requester's -- must never be included
                    notes.setdefault(b["agent_code"], []).append({
                        "block_id": b["block_id"], "agent_code": b["agent_code"], "block_type": b["block_type"],
                        "text": b["text"], "shared": b["shared"], "sort_order": b["sort_order"],
                        "created_at": b["created_at"], "updated_at": b["updated_at"],
                    })
                res = {"status": "OK", "notes": notes, "identities": identities}
            else:
                res = {"status": "OK"}
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", fake_apps_script)

    # Seeds the same localStorage roster agent-hub.html's own Cover
    # Identity flow writes to -- Notes should auto-load this Agent and
    # auto-resolve their Cell with zero manual entry, no Cell picker
    # ever shown (players don't choose Cells; a Handler assigns them).
    page.add_init_script("""
        try {
            localStorage.setItem('dg_agent_roster', JSON.stringify({
                'OWEN-CS12': { code: 'OWEN-CS12', char_name: 'Owen Castillo', saved_at: Date.now() }
            }));
        } catch (e) {}
    """)
    page.goto(f"{BASE}/notes/index.html", wait_until="domcontentloaded", timeout=15000)
    wait_for_condition(lambda: page.query_selector(".dg-notes-identity-modal") is not None or page.query_selector("#dg-notes-editor-mount") is not None, timeout_ms=6000)
    record("notes", "a Cover Identity on this device auto-opens Notes with no manual Agent Code or Cell entry",
           page.query_selector("#picker-wrap.hidden") is not None, "")
    record("notes", "no Cell picker is ever shown to players",
           page.query_selector("#picker-cell") is None, "")

    # A first-time-here Agent is prompted to pick a color + handwriting
    # font before anything else.
    wait_for_condition(lambda: page.query_selector(".dg-notes-identity-modal") is not None, timeout_ms=6000)
    record("notes", "a first-time viewer is prompted to pick an identity color/font",
           page.query_selector(".dg-notes-identity-modal") is not None, "")
    page.click(".dg-notes-color-swatch")
    page.click(".dg-notes-identity-confirm")
    wait_for_condition(lambda: page.query_selector(".dg-notes-identity-modal") is None, timeout_ms=6000)

    wait_for_condition(lambda: page.query_selector("#dg-notes-editor-mount .ce-block") is not None, timeout_ms=6000)
    record("notes", "your own tab mounts a live Editor.js instance", page.query_selector("#dg-notes-editor-mount") is not None, "")

    # Type a paragraph and confirm the debounced save posts the right
    # per-block JSON shape (block_type is Editor.js's own tool name;
    # text is a JSON-stringified block data object, not our old custom
    # markup string).
    page.click(".ce-block [contenteditable]")
    page.keyboard.type("Session 3 Notes")
    saved = wait_for_condition(lambda: (page.evaluate("1"), next((x for x in posts if x.get("action") == "save_note_block" and x.get("agent_code") == "OWEN-CS12"), None))[1], timeout_ms=25000)
    record("notes", "typing fires a debounced save_note_block with the right per-block JSON shape",
           bool(saved) and saved.get("cell_id") == "cell_1" and saved.get("block_type") == "paragraph"
           and json.loads(saved.get("text") or "{}").get("text") == "Session 3 Notes" and saved.get("shared") is False,
           json.dumps(saved) if saved else "no POST captured")

    # No per-member tabs -- only Shared and your own. A member's own
    # tab only ever showed their SHARED blocks anyway (their private
    # ones are never sent to anyone else), which is exactly the Shared
    # feed's content, just split per-author for no real benefit; it
    # also meant clicking around the whole Cell before finding anything
    # worth reading. Their contributions still show up on Shared,
    # individually attributed via the author badge.
    record("notes", "no per-member tabs are rendered, only Shared and your own",
           page.locator('[data-tab="PRIY-AN34"]').count() == 0, "")

    # The combined Shared feed: read-only (not a second live editor),
    # shows another member's shared block,
    # never leaks their private one.
    page.click('.dg-notes-tab-shared')
    page.wait_for_timeout(300)
    record("notes", "the Shared tab is a read-only feed, not a second live editor",
           page.query_selector("#dg-notes-editor-mount") is None, "")
    shared_html = page.content()
    record("notes", "the combined Shared feed shows another member's shared block",
           "Priya's shared note" in shared_html, "")
    record("notes", "the combined Shared feed never leaks another member's private block",
           "must never leak" not in shared_html, "")

    # Timeline: regroups the same Shared feed by calendar date instead
    # of one flat chronological list -- only ever offered on the Shared
    # tab (a single member's own tab is already their personal
    # chronological view, grouping it wouldn't add anything).
    record("notes", "the Timeline toggle only appears on the Shared tab",
           page.locator(".dg-notes-timeline-btn").count() == 1, "")
    page.click(".dg-notes-timeline-btn")
    page.wait_for_timeout(200)
    record("notes", "Group by date splits shared blocks from different days into separate date sections",
           page.locator(".dg-notes-timeline-group").count() == 2, str(page.locator(".dg-notes-timeline-group").count()))
    record("notes", "each Timeline date section shows a date header",
           page.locator(".dg-notes-timeline-date").count() == 2, "")
    timeline_html = page.content()
    record("notes", "Timeline view still shows every shared block's content, just regrouped",
           "Priya's shared note" in timeline_html and "Priya's second-day update" in timeline_html, "")
    page.click(".dg-notes-timeline-btn")
    page.wait_for_timeout(200)
    record("notes", "toggling back to flat view removes the date grouping",
           page.locator(".dg-notes-timeline-group").count() == 0, "")

    # The Shared feed is read-only with no controls of its own (see the
    # notes.js file header comment) -- without an explicit way out of
    # it, tapping over to look at Shared was a total dead end that read
    # as "totally buggy, can't do anything" to a real user, even though
    # the own-tab editor worked fine the whole time one tab over. This
    # button is that way out, always shown (not just on the empty
    # state) -- also doubles as the "back to your own tab" step here.
    record("notes", "the Shared feed always offers a way back to your own (writable) tab",
           page.locator(".dg-notes-goto-own-btn").count() > 0, "")
    page.click(".dg-notes-goto-own-btn")
    wait_for_condition(lambda: page.query_selector("#dg-notes-editor-mount .ce-block") is not None, timeout_ms=6000)
    record("notes", "your own tab still shows what you typed after switching away and back",
           "Session 3 Notes" in page.content(), "")

    # Circulate: a toolbar button that acts on whichever block your
    # cursor is in (not an Editor.js Block Tune -- see notes.js's
    # mountEditor() comment for why: verified hands-on that a custom
    # tune's render() output never reaches this pinned version's
    # settings popover, a confirmed still-open rough edge in Editor.js
    # itself, not a bug in this app). Disabled until you've clicked into
    # a block; a single click toggles and saves shared:true immediately.
    circulate = page.locator(".dg-notes-circulate-btn")
    record("notes", "the Circulate button starts disabled (no block focused yet)",
           circulate.get_attribute("disabled") is not None, "")
    page.click(".ce-block [contenteditable]")
    # Nudged the same way every other post-event wait in this suite is:
    # this sandbox can leave an already-fired event's handler (here,
    # the focusin listener that enables the button) unprocessed for
    # real seconds until something forces the renderer to tick.
    wait_for_condition(lambda: (page.evaluate("1"), circulate.get_attribute("disabled") is None)[1], timeout_ms=8000)
    record("notes", "clicking into a block enables the Circulate button",
           circulate.get_attribute("disabled") is None, "")
    posts.clear()
    circulate.click()
    toggled = wait_for_condition(lambda: (page.evaluate("1"), next((x for x in posts if x.get("action") == "save_note_block" and x.get("agent_code") == "OWEN-CS12"), None))[1], timeout_ms=25000)
    record("notes", "toggling Circulate on the focused block saves shared:true",
           bool(toggled) and toggled.get("shared") is True, json.dumps(toggled) if toggled else "no POST captured")
    record("notes", "the Circulate button shows an active state once toggled on",
           "active" in (circulate.get_attribute("class") or ""), "")

    # Pin: same "acts on the focused block" toggle mechanism as
    # Circulate. Pinned blocks get their own section in the sidebar,
    # above the normal Index.
    pin_btn = page.locator(".dg-notes-pin-btn")
    record("notes", "the Pin button is enabled once a block is focused",
           pin_btn.get_attribute("disabled") is None, "")
    posts.clear()
    pin_btn.click()
    pinned_post = wait_for_condition(lambda: (page.evaluate("1"), next((x for x in posts if x.get("action") == "save_note_block" and x.get("agent_code") == "OWEN-CS12"), None))[1], timeout_ms=25000)
    record("notes", "toggling Pin on the focused block saves pinned:true",
           bool(pinned_post) and pinned_post.get("pinned") is True, json.dumps(pinned_post) if pinned_post else "no POST captured")
    record("notes", "the Pin button shows an active state once toggled on",
           "active" in (pin_btn.get_attribute("class") or ""), "")
    # .dg-notes-toc-subhead is CSS-uppercased, same as .dg-notes-toc-label.
    toc_pinned = wait_for_condition(lambda: (page.evaluate("1"), "pinned" in (page.locator("#dg-notes-toc-mount").inner_text() or "").lower())[1], timeout_ms=8000)
    record("notes", "a pinned block gets its own Pinned section in the Index sidebar",
           bool(toc_pinned), page.locator("#dg-notes-toc-mount").inner_text())

    # Tag: opens a popover on the focused block instead of a plain
    # toggle -- three type chips (NPC/Location/Clue) plus a text field.
    tag_btn = page.locator(".dg-notes-tag-btn")
    record("notes", "the Tag button is enabled once a block is focused",
           tag_btn.get_attribute("disabled") is None, "")
    tag_btn.click()
    page.wait_for_timeout(200)
    record("notes", "the Tag popover offers NPC/Location/Clue type chips",
           page.locator(".dg-notes-tag-type-chip").count() == 3, "")
    page.click('.dg-notes-tag-type-chip[data-type="location"]')
    page.fill(".dg-notes-tag-input", "Old Lighthouse")
    posts.clear()
    page.click(".dg-notes-tag-add-btn")
    tag_post = wait_for_condition(lambda: (page.evaluate("1"), next((x for x in posts if x.get("action") == "save_note_block" and x.get("agent_code") == "OWEN-CS12"), None))[1], timeout_ms=25000)
    record("notes", "adding a tag saves it as {type, label} in the block's tags field",
           bool(tag_post) and json.loads(tag_post.get("tags") or "[]") == [{"type": "location", "label": "Old Lighthouse"}],
           json.dumps(tag_post) if tag_post else "no POST captured")
    record("notes", "the added tag shows as a chip in the popover",
           "Old Lighthouse" in (page.locator(".dg-notes-tag-current").inner_text() or ""), "")
    record("notes", "the Tag button shows an active state once the block has a tag",
           "active" in (tag_btn.get_attribute("class") or ""), "")
    tag_btn.click()  # close the popover -- same as a real user tapping Tag again when done
    page.wait_for_timeout(150)

    # Cross-tab search: normally the search box only filters whichever
    # tab is active -- "Search everywhere" widens the sidebar into a
    # combined Search Results list spanning your own blocks (any
    # privacy) plus everyone else's shared blocks, each tagged with
    # which tab it came from.
    page.fill(".dg-notes-search", "shared note")
    page.check(".dg-notes-search-everywhere")
    page.wait_for_timeout(300)
    record("notes", "'Search everywhere' relabels the sidebar to Search Results",
           page.inner_text(".dg-notes-toc-label").lower() == "search results", page.inner_text(".dg-notes-toc-label"))
    record("notes", "Search Results includes a match from another member's shared block",
           "PRIY-AN34" in (page.locator("#dg-notes-toc-mount").inner_text() or ""), page.locator("#dg-notes-toc-mount").inner_text())
    page.click('#dg-notes-toc-mount .dg-notes-toc-item')
    page.wait_for_timeout(300)
    # The matched hit (b1) is a SHARED block -- the existing TOC-jump
    # logic (wireTocEvents()) already routes any shared block to the
    # combined Shared tab rather than the author's own individual tab,
    # matching how it's normally viewed; Search Results reuses that
    # same jump mechanism unchanged, not its own new routing rule.
    record("notes", "clicking a Search Results hit for a shared block jumps to the Shared tab",
           page.locator('[data-tab="__shared__"].active').count() == 1, "")
    page.fill(".dg-notes-search", "")
    page.uncheck(".dg-notes-search-everywhere")
    page.wait_for_timeout(200)
    record("notes", "clearing the search and unchecking 'Search everywhere' restores the normal Index",
           page.inner_text(".dg-notes-toc-label").lower() == "index", page.inner_text(".dg-notes-toc-label"))
    page.click('[data-tab="OWEN-CS12"]')
    page.wait_for_timeout(300)

    # Paste import -- the actual motivation for this migration. A
    # synthetic paste shaped like Google Docs' clipboard HTML (real
    # <h1>/<p>/<ul><li> tags) should auto-split into real Header/
    # Paragraph/List blocks via Editor.js's own per-tool pasteConfig,
    # not land as one undifferentiated blob.
    page.evaluate("""() => {
        const dt = new DataTransfer();
        dt.setData('text/html', '<h1>Investigation Log</h1><p>Found a torn photograph.</p><ul><li>Shows a lighthouse</li><li>Dated 1987</li></ul>');
        dt.setData('text/plain', 'Investigation Log\\nFound a torn photograph.\\nShows a lighthouse\\nDated 1987');
        const evt = new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true});
        const target = document.querySelector('#dg-notes-editor-mount [contenteditable]');
        target.focus();
        target.dispatchEvent(evt);
    }""")
    wait_for_condition(lambda: page.locator(".ce-header").count() > 0 and page.locator(".cdx-list").count() > 0, timeout_ms=6000)
    record("notes", "pasting Docs-shaped HTML auto-splits into a real Header block",
           page.locator(".ce-header").count() > 0 and "Investigation Log" in page.content(), "")
    record("notes", "pasting Docs-shaped HTML auto-splits into a real List block",
           page.locator(".cdx-list").count() > 0 and "Shows a lighthouse" in page.content(), "")

    # Native Enter-to-continue on the pasted list -- this is Editor.js's
    # own List tool behavior (no custom code in this app implements it),
    # replacing v1's "Pressing return doesnt yield more numbers" gap.
    list_item = page.locator(".cdx-list [contenteditable]").last
    list_item.click()
    page.keyboard.press("End")
    page.keyboard.press("Enter")
    page.keyboard.type("Third clue")
    page.wait_for_timeout(300)
    record("notes", "pressing Enter inside a list continues it with a new item",
           "Third clue" in page.content(), "")

    # TOC reflects header blocks -- only refreshed once the pasted
    # header's own debounced save lands (refreshChrome() runs after
    # syncBlock()), so give it a moment, nudging each poll the same way
    # every other post-debounce wait in this suite does.
    def toc_has_heading():
        page.evaluate("1")
        text = page.locator("#dg-notes-toc-mount").inner_text() or ""
        return text if "Investigation Log" in text else None
    toc_text = wait_for_condition(toc_has_heading, timeout_ms=8000) or ""
    record("notes", "the index lists heading blocks from your own tab",
           "Investigation Log" in toc_text, toc_text)

    # The Shared tab's own Index is scoped to what's actually shown
    # there -- "Investigation Log" is a private header on your own tab
    # (never circulated), so it must NOT bleed into the Shared tab's
    # sidebar just because allVisibleBlocks() would technically include
    # it too.
    page.click('.dg-notes-tab-shared')
    page.wait_for_timeout(300)
    shared_toc_text = page.locator("#dg-notes-toc-mount").inner_text() or ""
    record("notes", "the Shared tab's Index only lists shared headings, not your own private ones",
           "Investigation Log" not in shared_toc_text, shared_toc_text)

    record("notes", "no JS exceptions", len(errs) == 0, "; ".join(errs))
    page.close()

    # Fallback: a device/browser with no Cover Identity roster yet
    # (fresh install, cleared storage) still gets a manual Agent Code
    # entry -- Notes shouldn't be unreachable just because Cover
    # Identity hasn't been used on this device before -- but still
    # never a Cell picker.
    page2 = p.new_page()
    page2.set_default_timeout(10000)
    page2.route("**/script.google.com/**", fake_apps_script)
    page2.goto(f"{BASE}/notes/index.html", wait_until="domcontentloaded", timeout=15000)
    wait_for_condition(lambda: page2.query_selector("#picker-agent-code") is not None and page2.query_selector("#picker-fallback-row.hidden") is None, timeout_ms=6000)
    record("notes", "with no Cover Identity on this device, a manual Agent Code fallback is offered instead of blocking Notes",
           page2.query_selector("#picker-agent-code") is not None, "")
    record("notes", "the fallback never offers a Cell picker either",
           page2.query_selector("#picker-cell") is None, "")
    page2.close()
    return errs


def test_notes_evidence_integration(p):
    """Evidence Locker Stage 3: Evidence surfaced inside Notes. Backend
    support (mark_evidence_seen / EvidenceSeen sheet / listEvidence()
    bundling a `seen` map, and evidence_remark as just another opaque
    CellNotes block_type) was already built in an earlier round; this
    is the client-side piece -- an "Evidence" section in the sidebar
    (red dot = unseen, synced server-side across devices, not a local-
    only flag) and a detail modal (title/body/photo-or-PDF, reused
    exactly as A-Cell/Agent Hub already resolve a gdrive: link) with a
    Remarks thread reusing the same private/Circulated privacy model as
    regular notes. Also verifies evidence_remark blocks stay fully out
    of the places they'd otherwise leak into or break: the live
    Editor.js document (unknown block_type, never registered as a
    tool), the general Shared feed, and cross-tab search."""
    page = p.new_page()
    page.set_default_timeout(10000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    cell = {"cell_id": "cell_1", "name": "Cell Alpha", "handler": "Sam", "member_codes": ["OWEN-CS12", "PRIY-AN34"],
            "member_names": {"OWEN-CS12": "Owen Castillo", "PRIY-AN34": "Priya Anand"}}
    notes_blocks = [
        {"block_id": "b1", "agent_code": "OWEN-CS12", "block_type": "header",
         "text": json.dumps({"text": "Meadowbrook", "level": 1}), "shared": False, "sort_order": 100, "created_at": 1, "updated_at": 1},
        {"block_id": "rem1", "agent_code": "PRIY-AN34", "block_type": "evidence_remark",
         "text": json.dumps({"evidence_id": "ev1", "text": "The blood spatter doesn't match a fall."}),
         "shared": True, "sort_order": 200, "created_at": 500, "updated_at": 500},
    ]
    evidence_fixture = [
        {"evidence_id": "ev1", "title": "Coroner's Report", "body": "Cause of death listed as accidental.",
         "photo": "gdrive:fake123", "cell_id": "", "operation_id": "", "created_at": "2000"},
        {"evidence_id": "ev2", "title": "Torn Photograph", "body": "Shows a lighthouse.",
         "photo": "", "cell_id": "", "operation_id": "", "created_at": "1000"},
    ]
    identities = {"PRIY-AN34": {"color": "#2f855a", "font": "kalam"}}
    seen_map = {"ev2": True}
    posts = []
    fake_png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

    def fake_apps_script(route):
        req = route.request
        url = req.url
        if req.method == "POST":
            body = json.loads(req.post_data or "{}")
            posts.append(body)
            action = body.get("action")
            if action == "save_note_block":
                bid = body.get("block_id") or ""
                existing = next((b for b in notes_blocks if b["block_id"] == bid), None)
                if existing:
                    existing.update({"block_type": body.get("block_type"), "text": body.get("text"), "shared": bool(body.get("shared"))})
                else:
                    notes_blocks.append({
                        "block_id": bid, "agent_code": body.get("agent_code"), "block_type": body.get("block_type"),
                        "text": body.get("text"), "shared": bool(body.get("shared")),
                        "sort_order": body.get("sort_order", 0), "created_at": 9000, "updated_at": 9000,
                    })
            elif action == "delete_note_block":
                bid = body.get("block_id")
                notes_blocks[:] = [b for b in notes_blocks if b["block_id"] != bid]
            elif action == "mark_evidence_seen":
                seen_map[body.get("evidence_id")] = True
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        if "action=imgdata" in url:
            cb = url.split("callback=")[1].split("&")[0]
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps({"status": "OK", "dataUri": fake_png})})')
            return
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            if "action=list_cells" in url:
                res = {"status": "OK", "cells": [cell]}
            elif "action=list_cell_notes" in url:
                requester = url.split("agent_code=")[1].split("&")[0] if "agent_code=" in url else ""
                notes = {}
                for b in notes_blocks:
                    if b["agent_code"] != requester and not b["shared"]:
                        continue
                    notes.setdefault(b["agent_code"], []).append(b)
                res = {"status": "OK", "notes": notes, "identities": identities}
            elif "action=list_evidence" in url:
                res = {"status": "OK", "evidence": evidence_fixture, "seen": dict(seen_map)}
            else:
                res = {"status": "OK"}
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", fake_apps_script)

    page.add_init_script("""
        try {
            localStorage.setItem('dg_agent_roster', JSON.stringify({
                'OWEN-CS12': { code: 'OWEN-CS12', char_name: 'Owen Castillo', saved_at: Date.now() }
            }));
        } catch (e) {}
    """)
    page.goto(f"{BASE}/notes/index.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_selector(".dg-notes-identity-modal, #dg-notes-editor-mount", timeout=10000)
    if page.query_selector(".dg-notes-identity-modal"):
        page.click(".dg-notes-color-swatch")
        page.click(".dg-notes-identity-confirm")
    page.wait_for_selector("#dg-notes-editor-mount .ce-block", timeout=10000)
    page.wait_for_timeout(500)

    record("notes", "the sidebar lists an Evidence section with both visible items",
           page.locator(".dg-notes-evidence-item").count() == 2, "")
    unseen_dots = page.eval_on_selector_all(".dg-notes-evidence-dot", "els => els.map(e => e.className)")
    record("notes", "an item never opened shows the unseen dot",
           any("unseen" in c for c in unseen_dots), str(unseen_dots))
    record("notes", "an item already marked seen server-side does NOT show the unseen dot",
           not all("unseen" in c for c in unseen_dots), str(unseen_dots))
    record("notes", "your own tab's live editor still works normally alongside the Evidence sidebar",
           "Meadowbrook" in page.content(), "")

    page.click('[data-evidence-id="ev1"]')
    page.wait_for_timeout(600)
    record("notes", "clicking an Evidence item opens a detail modal with its title and body",
           page.is_visible(".dg-notes-evidence-modal") and "Coroner's Report" in page.inner_text(".dg-notes-evidence-body")
           and "Cause of death" in page.inner_text(".dg-notes-evidence-body"), "")
    record("notes", "a Cell-mate's existing Circulated remark shows in the Remarks thread, attributed to them",
           "blood spatter" in page.inner_text(".dg-notes-evidence-body") and "Priya Anand" in page.inner_text(".dg-notes-evidence-body"), "")
    record("notes", "opening it posts mark_evidence_seen for this Agent and this item",
           any(x.get("action") == "mark_evidence_seen" and x.get("evidence_id") == "ev1" and x.get("agent_code") == "OWEN-CS12" for x in posts), str(posts))
    record("notes", "its gdrive-backed photo resolves and renders as a real image",
           page.locator(".dg-notes-evidence-photo-img").count() == 1, "")

    posts.clear()
    page.fill(".dg-notes-evidence-remark-input", "Check the neighbor's alibi.")
    page.click(".dg-notes-evidence-remark-add")
    page.wait_for_timeout(300)
    record("notes", "adding a remark (Share unchecked) posts save_note_block as a private evidence_remark",
           any(x.get("action") == "save_note_block" and x.get("block_type") == "evidence_remark"
               and json.loads(x.get("text") or "{}").get("evidence_id") == "ev1" and x.get("shared") is False
               for x in posts), str(posts))
    record("notes", "the new remark appears in the thread immediately, marked Private",
           "Check the neighbor's alibi" in page.inner_text(".dg-notes-evidence-remarks-list")
           and "PRIVATE" in page.inner_text(".dg-notes-evidence-remarks-list").upper(), "")

    del_btn = page.locator(".dg-notes-evidence-remark-del")
    record("notes", "only your own remark shows a delete control, not a Cell-mate's",
           del_btn.count() == 1, "")
    posts.clear()
    del_btn.click()
    page.wait_for_timeout(300)
    record("notes", "deleting your own remark posts delete_note_block",
           any(x.get("action") == "delete_note_block" for x in posts), str(posts))
    record("notes", "the deleted remark is gone from the thread, the Cell-mate's stays",
           "Check the neighbor's alibi" not in page.inner_text(".dg-notes-evidence-remarks-list")
           and "blood spatter" in page.inner_text(".dg-notes-evidence-remarks-list"), "")

    page.click(".dg-notes-evidence-close")
    page.wait_for_timeout(200)
    record("notes", "closing the modal removes it",
           page.locator(".dg-notes-evidence-modal").count() == 0, "")
    sidebar_dots_after = page.eval_on_selector_all(".dg-notes-evidence-dot", "els => els.map(e => e.className)")
    record("notes", "the sidebar's unseen dot clears once its item has been opened",
           not any("unseen" in c for c in sidebar_dots_after), str(sidebar_dots_after))

    page.click('.dg-notes-tab-shared')
    page.wait_for_timeout(300)
    shared_html = page.inner_html("#dg-notes-readonly-feed")
    record("notes", "a Circulated evidence_remark never leaks into the general Shared feed",
           "blood spatter" not in shared_html, "")

    record("notes", "no JS exceptions", len(errs) == 0, "; ".join(errs))
    page.close()
    return errs


def test_notes_reload_shows_own_previous_blocks(p):
    """Regression test for a bug caught while building the Timeline
    view: mountEditor() necessarily mounts your own tab's live Editor.js
    instance BEFORE the first list_cell_notes fetch can possibly have
    returned (render() runs synchronously in init(), the fetch is
    async) -- so on every fresh page load, the editor briefly exists
    empty. fetchNotes()'s "don't let a poll overwrite what you're
    actively typing" guard used to fire on that very first fetch too,
    silently discarding the real fetched data for your own agent_code
    and leaving your own tab empty for the rest of the session -- your
    already-saved notes were still safe server-side (and still visible
    to every OTHER Cell member's own client), just never shown again on
    the one screen a returning player actually looks at. Separate,
    small standalone test rather than folded into test_notes_v2_editorjs
    above, since that test's later steps depend on starting from a
    single default empty block; seeding a pre-existing block into that
    same fixture would collide with its typing-into-the-first-block
    assertions."""
    page = p.new_page()
    page.set_default_timeout(15000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    cell = {"cell_id": "cell_1", "name": "Cell Alpha", "handler": "Sam", "member_codes": ["OWEN-CS12"]}
    blocks_state = [
        {"block_id": "b0", "agent_code": "OWEN-CS12", "block_type": "paragraph",
         "text": json.dumps({"text": "Notes from last session, saved before this page ever loaded"}),
         "shared": False, "sort_order": 500, "created_at": 1, "updated_at": 1},
    ]

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            if "action=list_cells" in url:
                res = {"status": "OK", "cells": [cell]}
            elif "action=list_cell_notes" in url:
                requester = url.split("agent_code=")[1].split("&")[0] if "agent_code=" in url else ""
                notes = {}
                for b in blocks_state:
                    if b["agent_code"] != requester and not b["shared"]:
                        continue
                    notes.setdefault(b["agent_code"], []).append(b)
                res = {"status": "OK", "notes": notes, "identities": {"OWEN-CS12": {"color": "#2b6cb0", "font": "caveat"}}}
            else:
                res = {"status": "OK"}
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", fake_apps_script)

    page.add_init_script("""
        try {
            localStorage.setItem('dg_agent_roster', JSON.stringify({
                'OWEN-CS12': { code: 'OWEN-CS12', char_name: 'Owen Castillo', saved_at: Date.now() }
            }));
        } catch (e) {}
    """)
    page.goto(f"{BASE}/notes/index.html", wait_until="domcontentloaded", timeout=15000)
    wait_for_condition(lambda: page.query_selector(".dg-notes-identity-modal") is not None, timeout_ms=6000)
    page.click(".dg-notes-color-swatch")
    page.click(".dg-notes-identity-confirm")

    wait_for_condition(lambda: "Notes from last session" in page.content(), timeout_ms=8000)
    record("notes", "a block saved before this page load reappears in your own tab on a fresh open",
           "Notes from last session, saved before this page ever loaded" in page.content(), page.content()[:2000])

    page.close()
    return errs


def test_notes_code_url_param(p):
    """agent-hub.html's per-Agent Notes button links to
    notes/index.html?code=AGENT-CODE (same convention dg-agent-portal.html
    already uses for Agent File/Field ID) so it opens straight into that
    specific Agent's notes -- not just whichever Agent this browser's
    roster last had active -- since a roster can hold more than one
    Agent and the player picked a specific one from the Hub. Also
    checks that "Change Agent" isn't defeated by the URL forcing the
    same Agent back open every time it's clicked."""
    page = p.new_page()
    page.set_default_timeout(15000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    cells = [
        {"cell_id": "cell_1", "name": "Cell Alpha", "handler": "Sam", "member_codes": ["OWEN-CS12"]},
        {"cell_id": "cell_2", "name": "Cell Bravo", "handler": "Sam", "member_codes": ["PRIY-AN34"]},
    ]

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            if "action=list_cells" in url:
                res = {"status": "OK", "cells": cells}
            elif "action=list_cell_notes" in url:
                res = {"status": "OK", "notes": {}, "identities": {}}
            else:
                res = {"status": "OK"}
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", fake_apps_script)

    # Two Agents in this browser's roster, OWEN-CS12 the more recently
    # active one (would normally auto-open by default) -- ?code= should
    # still force PRIY-AN34 open instead.
    page.add_init_script("""
        try {
            localStorage.setItem('dg_agent_roster', JSON.stringify({
                'OWEN-CS12': { code: 'OWEN-CS12', char_name: 'Owen Castillo', saved_at: Date.now() },
                'PRIY-AN34': { code: 'PRIY-AN34', char_name: 'Priya Anand', saved_at: Date.now() - 60000 }
            }));
        } catch (e) {}
    """)
    page.goto(f"{BASE}/notes/index.html?code=PRIY-AN34", wait_until="domcontentloaded", timeout=15000)
    wait_for_condition(lambda: page.query_selector(".dg-notes-identity-modal") is not None, timeout_ms=6000)
    page.click(".dg-notes-color-swatch")
    page.click(".dg-notes-identity-confirm")
    wait_for_condition(lambda: page.query_selector('[data-tab="PRIY-AN34"].active') is not None, timeout_ms=6000)
    record("notes", "?code= opens that specific Agent's notes, not the roster's most-recently-active one",
           page.locator('[data-tab="PRIY-AN34"].active').count() == 1, "")

    # Change Agent should still work afterward -- the URL forcing PRIY-AN34
    # open once must not turn every subsequent proceed() call into a
    # loop back to the same Agent.
    page.click("#change-context-btn")
    page.wait_for_timeout(300)
    record("notes", "Change Agent still returns to the picker instead of re-forcing the URL's Agent open again",
           page.locator("#picker-wrap:not(.hidden)").count() == 1, "")

    page.close()
    return errs


def main():
    with sync_playwright() as p:
        # Chrome's own background-tab timer throttling policy applies to a
        # non-foregrounded page regardless of headless status -- without
        # disabling it, a test that waits across several chained
        # setTimeout/setInterval cycles (an autosave debounce landing
        # during a poll interval, say) can see real, multi-second-scale
        # delays that have nothing to do with system load and everything
        # to do with Chrome deciding this page isn't the one the user is
        # looking at. Real players' foregrounded tabs never hit this;
        # only this offscreen test browser does.
        browser = p.chromium.launch(executable_path="/opt/pw-browsers/chromium", args=[
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
        ])

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

        safe(test_kappablack_toml_import_unmatched_profession, browser, area="stats-terminal")

        safe(test_kappablack_toml_import_triggers_cloud_save, browser, area="stats-terminal")

        safe(test_import_agent_paste_text, browser, area="stats-terminal")

        safe(test_import_agent_auto_detect, browser, area="stats-terminal")

        safe(test_player_name_field, browser, area="stats-terminal")

        safe(test_cloud_save, browser, area="stats-terminal")

        safe(test_agent_file_export, browser, area="agent-file-export")

        safe(test_random_bio_cloud_code_race, browser, area="agent-file-export")

        safe(test_cover_ids_tab, browser, area="cover-ids-tab")

        safe(test_hub_boot_splash, browser, area="hub")

        safe(test_hub_clearance_branches, browser, area="hub")

        safe(test_agent_hub, browser, area="hub")

        safe(test_agent_hub_cover_identity, browser, area="hub")

        safe(test_agent_hub_erase_agent, browser, area="hub")

        safe(test_agent_hub_kia_stamp, browser, area="hub")

        safe(test_agent_hub_recruit_flag, browser, area="hub")

        safe(test_agent_hub_handouts, browser, area="hub")

        safe(test_agent_hub_handout_notes, browser, area="hub")

        safe(test_acell_gate, browser, area="acell")

        safe(test_acell_play, browser, area="acell")
        safe(test_acell_handler_session_race, browser, area="acell")

        safe(test_acell_cells, browser, area="acell")

        safe(test_acell_evidence, browser, area="acell")
        safe(test_acell_evidence_pdf, browser, area="acell")
        safe(test_acell_evidence_create_verify_retries, browser, area="acell")

        safe(test_acell_sheet, browser, area="acell")

        safe(test_acell_music, browser, area="acell")

        safe(test_acell_music_backend_not_deployed, browser, area="acell")

        safe(test_table_radio_widget, browser, area="radio")

        safe(test_table_radio_audio_volume, browser, area="radio")

        safe(test_table_radio_pause_and_loop, browser, area="radio")

        safe(test_table_radio_library_track_kind, browser, area="radio")

        safe(test_table_radio_yt_volume_reliability, browser, area="radio")

        safe(test_table_radio_mobile_buttons_not_stretched, browser, area="radio")

        safe(test_table_radio_theme_consistent_style, browser, area="radio")

        safe(test_agent_portal_code_query_param, browser, area="agent-portal")

        safe(test_agent_portal_profiling_gate, browser, area="agent-portal")

        safe(test_agent_portal_autorestore_prefills_cover, browser, area="agent-portal")

        safe(test_stats_load_by_code_query_param, browser, area="stats-terminal")

        safe(test_stats_loading_terminal, browser, area="stats-terminal")

        safe(test_stats_load_error_reveals_gate_quickly, browser, area="stats-terminal")

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

        safe(test_agent_portal_random_generator_matches_sex, browser, area="agent-portal")

        safe(test_agent_portal_incomplete_submit_blocked, browser, area="agent-portal")

        safe(test_agent_portal_submit_reuses_roster_code, browser, area="agent-portal")

        safe(test_agent_file_kia_stamp, browser, area="agent-portal")

        safe(test_agent_file_vitals_and_bonds, browser, area="agent-portal")

        safe(test_agent_file_era_prompt_includes_era, browser, area="agent-portal")

        safe(test_agent_file_outfit_plate_requires_face_first, browser, area="agent-portal")

        safe(test_agent_roster, browser, area="agent-roster")

        for agent in AGENTS[:2]:
            safe(test_id_creator, browser, agent, area="id-creator")

        safe(test_noindex, browser, area="noindex")

        safe(test_pwa_offline, browser, area="pwa")

        safe(test_pwa_update_banner, browser, area="pwa")

        safe(test_notes_v2_editorjs, browser, area="notes")
        safe(test_notes_evidence_integration, browser, area="notes")

        safe(test_notes_reload_shows_own_previous_blocks, browser, area="notes")
        safe(test_notes_code_url_param, browser, area="notes")

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
