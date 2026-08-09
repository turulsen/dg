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

def test_mobile_no_overflow(p):
    """Regression check: no page should force horizontal scroll on a phone
    viewport. stats/index.html is the one exception with an asterisk: it's
    pigeon-labs-stack's own multi-theme tool, and only its dedicated
    "Mobile" theme is meant to be responsive -- the other five (X-Files,
    Modern, Son of Sam, Field Notes, Live Play) are desktop-oriented by the
    original design, so they're checked separately with that theme
    selected rather than folded into the general no-overflow sweep."""
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

    page = p.new_page(viewport={"width": 390, "height": 844})
    page.set_default_timeout(5000)
    errs = collect_errors(page)
    page.goto(f"{BASE}/stats/index.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(500)
    page.select_option("#cs-theme-select", "mobile")
    page.wait_for_timeout(400)
    scroll_width = page.evaluate("() => document.documentElement.scrollWidth")
    record("mobile", "stats/index.html has no horizontal overflow at 390px viewport (Mobile theme)",
           scroll_width <= 390, f"scrollWidth={scroll_width}")
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

        safe(test_agent_file_export, browser, area="agent-file-export")

        safe(test_cover_ids_tab, browser, area="cover-ids-tab")

        safe(test_hub_two_cards, browser, area="hub")

        safe(test_mobile_no_overflow, browser, area="mobile")

        safe(test_agent_portal_restore_dossier, browser, AGENTS[0], area="agent-portal")

        codes = []
        for agent in AGENTS:
            res = safe(test_agent_portal_cover, browser, agent, area="agent-portal")
            codes.append(res[1] if res else None)

        if codes and codes[0]:
            safe(test_agent_portal_agent_file, browser, codes[0], area="agent-portal")

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
