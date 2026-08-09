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

# Stubs XLSX (loaded from cdnjs in the real page) so the export button's
# wiring can be verified even when that CDN is unreachable -- as it is
# from this sandbox's egress proxy, same as fonts.googleapis.com.
XLSX_STUB = """
window.XLSX = {
  utils: {
    book_new: () => ({sheets:{}}),
    aoa_to_sheet: (data) => ({__data: data}),
    book_append_sheet: (wb, ws, name) => { wb.sheets[name] = ws; }
  },
  writeFile: (wb, filename) => { window.__lastExport = {wb, filename}; }
};
"""

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
    """stat-generator.html is a ported copy of pigeon-labs-stack's
    DELTA-GREEN-STATS (MIT licensed) plus a small "Send to Agent Portal"
    addition -- exercises stat adjustment, both random modes, reset, the
    Bond generator, the XLSX export wiring, and the handoff."""
    page = p.new_page()
    page.set_default_timeout(5000)
    errs = collect_errors(page)
    page.add_init_script(XLSX_STUB)
    page.goto(f"{BASE}/stat-generator.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)
    record("stat-generator", "page loads", len(errs)==0, "; ".join(errs))

    initial_vals = page.eval_on_selector_all(".stat-value", "els => els.map(e=>e.textContent)")
    initial_remaining = page.text_content("#totalPoints")
    record("stat-generator", "starts with six stats at 3, 54 points remaining",
           initial_vals == ["3"]*6 and initial_remaining == "54",
           f"vals={initial_vals} remaining={initial_remaining}")

    # bond-categories checkboxes must actually be inside the <form> --
    # regression check for the unclosed-tag fix made when porting
    checkbox_count = page.eval_on_selector_all("#bond-categories input[type=checkbox]", "els => els.length")
    record("stat-generator", "all 5 bond-category checkboxes are inside the form (unclosed-tag fix)",
           checkbox_count == 5, f"{checkbox_count} checkboxes")

    # manual stat adjustment
    str_plus = page.locator("#STR-value").locator("xpath=..").locator("button", has_text="+")
    for _ in range(3):
        str_plus.click()
    str_val = page.text_content("#STR-value")
    str_x5 = page.text_content("#STR-x5-value")
    remaining_after_adjust = page.text_content("#totalPoints")
    record("stat-generator", "manual +/- adjusts value, x5, and remaining points",
           str_val == "6" and str_x5 == "30" and remaining_after_adjust == "51",
           f"str={str_val} x5={str_x5} remaining={remaining_after_adjust}")

    # random point buy: must sum to exactly 72, every stat 3-18
    page.click("#random-point-buy")
    page.wait_for_timeout(100)
    buy_vals = page.eval_on_selector_all(".stat-value", "els => els.map(e=>parseInt(e.textContent))")
    record("stat-generator", "random point buy spends exactly 72 points, all stats 3-18",
           sum(buy_vals) == 72 and all(3 <= v <= 18 for v in buy_vals), str(buy_vals))

    # random dice roll: 4d6 drop lowest per stat, so each stat in 3-18
    page.click("#random-dice-roll")
    page.wait_for_timeout(100)
    dice_vals = page.eval_on_selector_all(".stat-value", "els => els.map(e=>parseInt(e.textContent))")
    record("stat-generator", "random dice roll produces 6 stats in 3-18", all(3 <= v <= 18 for v in dice_vals), str(dice_vals))

    # reset
    page.click("#reset-button")
    page.wait_for_timeout(100)
    reset_vals = page.eval_on_selector_all(".stat-value", "els => els.map(e=>e.textContent)")
    reset_remaining = page.text_content("#totalPoints")
    record("stat-generator", "reset returns to six 3s and 54 remaining",
           reset_vals == ["3"]*6 and reset_remaining == "54", f"{reset_vals} remaining={reset_remaining}")

    # Bond generator (default category is DELTA_GREEN, pre-checked)
    default_checked = page.eval_on_selector("#DELTA_GREEN", "el => el.checked")
    page.click("#bonds-button")
    page.wait_for_timeout(1500)  # typing effect
    bond_text = (page.text_content("#bondText") or "").strip()
    record("stat-generator", "Bond generator produces text with a default category checked",
           default_checked and len(bond_text) > 0, bond_text[:80])

    # XLSX export wiring (library itself is stubbed -- see XLSX_STUB)
    page.click("#export-button")
    page.wait_for_timeout(100)
    export_filename = page.evaluate("() => window.__lastExport ? window.__lastExport.filename : null")
    record("stat-generator", "export button invokes XLSX.writeFile with expected filename",
           export_filename == "DeltaGreenCharacterSheet.xlsx", str(export_filename))

    # Send to Agent Portal handoff
    with page.context.expect_page() as new_page_info:
        page.click("#send-to-portal")
    portal_page = new_page_info.value
    portal_page.wait_for_load_state("domcontentloaded")
    portal_page.wait_for_timeout(300)
    portal_errs = collect_errors(portal_page)
    portal_notes = portal_page.input_value("#dg-form [name=notes]")
    record("stat-generator", "handoff prefills Agent Portal notes with stats and Bond text",
           "DELTA GREEN" in portal_notes and "Bond" in portal_notes, portal_notes[:120])
    cleared = portal_page.evaluate("() => localStorage.getItem('dg_handoff_agent')")
    record("stat-generator", "handoff key clears after use", cleared is None, str(cleared))
    record("stat-generator", "no JS exceptions on handoff receiving page", len(portal_errs)==0, "; ".join(portal_errs))
    portal_page.close()

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

        safe(test_stat_generator, browser, area="stat-generator")

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
