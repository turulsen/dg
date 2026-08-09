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
import json, os, sys, time
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

def test_stat_generator(p, agent):
    """Drives the full 7-step wizard end to end, then checks Play Mode."""
    page = p.new_page()
    page.set_default_timeout(5000)
    errs = collect_errors(page)
    page.goto(f"{BASE}/stat-generator.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)
    record("stat-generator", f"page loads ({agent['char_name']})", len(errs)==0, "; ".join(errs))

    # Step 1: Identity
    page.fill("#f-name", agent["char_name"])
    page.fill("#f-codename", agent.get("codename",""))
    prof_id = agent.get("profession_id","")
    if prof_id and page.locator(f"#f-profession option[value={prof_id}]").count():
        page.select_option("#f-profession", prof_id)
    page.click("#wiz-next")
    page.wait_for_timeout(100)

    # Step 2: Characteristics -- exercise all three creation paths
    page.click("[onclick=\"setPath('buy')\"]")
    page.wait_for_timeout(100)
    pool_text_before = page.text_content("#pool-bar")
    first_stat_input = page.locator(".stat-row input[type=number]").first
    first_stat_input.fill("18")
    first_stat_input.dispatch_event("change")
    page.wait_for_timeout(100)
    pool_text_after = page.text_content("#pool-bar")
    record("stat-generator", "point-buy pool updates on edit", pool_text_after != pool_text_before,
           f"{pool_text_before} -> {pool_text_after}")

    page.click("[onclick=\"setPath('random')\"]")
    page.wait_for_timeout(100)
    vals_random = page.eval_on_selector_all(".stat-row input[type=number]", "els => els.map(e=>parseInt(e.value))")
    ok = len(vals_random) == 6 and all(3 <= v <= 18 for v in vals_random)
    record("stat-generator", "random roll produces 6 stats in 3-18", ok, str(vals_random))

    page.click("[onclick=\"setPath('quick')\"]")
    page.wait_for_timeout(100)
    vals_quick = page.eval_on_selector_all(".stat-row input[type=number]", "els => els.map(e=>parseInt(e.value))")
    record("stat-generator", "quick path also produces 6 valid stats",
           len(vals_quick) == 6 and all(3 <= v <= 18 for v in vals_quick), str(vals_quick))
    page.click("#wiz-next")
    page.wait_for_timeout(100)

    # Step 3: Derived
    derived_html = page.inner_html("#wiz-panel")
    record("stat-generator", "derived step shows HP/WP/Sanity/Breaking Point",
           all(k in derived_html for k in ["Hit Points","Willpower","Sanity","Breaking Point"]), "")
    page.click("#wiz-next")
    page.wait_for_timeout(100)

    # Step 4: Skills -- apply profession bias if available, check pool math
    if prof_id and page.locator("[onclick=\"applySkillBias()\"]").count():
        page.click("[onclick=\"applySkillBias()\"]")
        page.wait_for_timeout(100)
    spent = page.text_content("#skill-spent")
    record("stat-generator", "skill points spent counter is numeric", (spent or "").strip().isdigit(), spent or "")
    dodge_val = page.eval_on_selector("input[disabled]", "el => el.value")
    dex_val = vals_quick[2]  # STR,CON,DEX,...
    record("stat-generator", "Dodge stays locked to DEX x2", int(dodge_val) == dex_val*2, f"dodge={dodge_val} dex={dex_val}")
    page.click("#wiz-next")
    page.wait_for_timeout(100)

    # Step 5: Bonds
    page.fill("#new-bond-name", "Handler — Test Contact")
    page.click("[onclick=\"addBond()\"]")
    page.wait_for_timeout(100)
    bond_count = page.eval_on_selector_all(".bond-row", "els => els.length")
    record("stat-generator", "bond can be added", bond_count == 1, f"{bond_count} bonds")
    page.click("#wiz-next")
    page.wait_for_timeout(100)

    # Step 6: Equipment
    page.fill("#new-equip-name", "Sidearm")
    page.fill("#new-equip-note", "issued")
    page.click("[onclick=\"addEquip()\"]")
    page.wait_for_timeout(100)
    equip_count = page.eval_on_selector_all(".equip-row", "els => els.length")
    record("stat-generator", "equipment item can be added", equip_count == 1, f"{equip_count} items")
    page.click("#wiz-next")
    page.wait_for_timeout(100)

    # Step 7: Finish
    page.click("[onclick=\"finishCharacter()\"]")
    page.wait_for_timeout(150)
    code_text = page.text_content("#finish-code")
    summary = page.eval_on_selector("#finish-summary", "el => el.value")
    ok = bool(code_text) and agent["char_name"] in summary and "Bonds" in summary and "Equipment" in summary
    record("stat-generator", "finish produces code + full summary (skills/bonds/equipment)", ok, code_text or "")

    saved_code = page.evaluate("() => character.code")

    # Play Mode (the finish-step button, not the header mode-switch or any
    # char-list chip -- scope to #finish-out so it's unambiguous even once
    # earlier test iterations have populated the character list)
    page.click("#finish-out [onclick*=\"playLoadCharacter\"]")
    page.wait_for_timeout(200)
    play_header = page.text_content(".play-hdr h2") or ""
    record("stat-generator", "Play Mode opens with correct character loaded", agent["char_name"] in play_header, play_header)

    hp_before = page.text_content("#m-hp")
    page.click(".meter button >> nth=0")
    page.wait_for_timeout(100)
    hp_after = page.text_content("#m-hp")
    record("stat-generator", "Play Mode HP adjuster changes value", hp_before != hp_after, f"{hp_before} -> {hp_after}")

    page.select_option("#san-die", "6")
    page.click("[onclick=\"rollSanLoss()\"]")
    page.wait_for_timeout(100)
    san_result = page.text_content("#san-roll-result")
    record("stat-generator", "Play Mode SAN roll produces a result", "SAN" in (san_result or ""), san_result or "")

    if page.locator(".bond-play-row").count():
        bond_val_before = page.text_content(".bond-play-row .val")
        page.click(".bond-play-row button >> nth=0")
        page.wait_for_timeout(100)
        bond_val_after = page.text_content(".bond-play-row .val")
        record("stat-generator", "Play Mode Bond adjuster changes score", bond_val_before != bond_val_after, f"{bond_val_before} -> {bond_val_after}")

    page.fill("#field-notes", "Session 1: made contact, nothing unnatural yet.")
    page.wait_for_timeout(200)
    reloaded = page.evaluate(f"() => {{ try {{ return JSON.parse(localStorage.getItem('dg_char_{saved_code}')).notes; }} catch(e) {{ return null; }} }}")
    record("stat-generator", "Play Mode field notes persist to localStorage",
           reloaded == "Session 1: made contact, nothing unnatural yet.", str(reloaded))

    # Theme switching
    for theme in ["terminal", "redacted", "classified"]:
        page.select_option("#theme-select", theme)
        page.wait_for_timeout(80)
        attr = page.get_attribute("html", "data-theme")
        record("stat-generator", f"theme switch applies '{theme}'", attr == theme, attr or "")
    stored_theme = page.evaluate("() => localStorage.getItem('dg_theme')")
    record("stat-generator", "theme choice persists to localStorage", stored_theme == "classified", str(stored_theme))

    page.close()
    return errs

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

        for agent in AGENTS:
            safe(test_stat_generator, browser, agent, area="stat-generator")

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
