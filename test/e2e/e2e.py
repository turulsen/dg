"""End-to-end scenarios: the real pages, real Firestore/Storage rules and
Cloud Functions (emulators), several browsers at once as Handler and
players. Started by test/e2e/run.sh, which brings the emulators up.

Every scenario runs on its own Agent Codes, so they don't lean on each
other. After each one the shared checks run: no page errors, no request
to a production Google/Firebase host, no NaN/undefined on screen, and
every saved character readable and within its maximums.

Never talks to the live campaign: production hosts are aborted in the
browser, and the emulators run on 127.0.0.1 only."""
import json, math, os, re, sys, time, traceback, urllib.request, urllib.error
from playwright.sync_api import sync_playwright

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(REPO, "test", "e2e", "out")
TOOLS = os.environ.get("E2E_TOOLS", os.path.expanduser("~/.cache/dg-e2e"))
NM = os.path.join(TOOLS, "node_modules")
BASE = os.environ.get("E2E_BASE", "http://127.0.0.1:8952")
ENGINE = os.environ.get("E2E_ENGINE", "chromium")
ONLY = set(filter(None, os.environ.get("E2E_ONLY", "").split(",")))
FS = "http://127.0.0.1:8080/v1/projects/dg-app-b3447/databases/(default)/documents"
HANDLER_PW = "testpw"
RUN = str(int(time.time()) % 100000)

# Points every Firebase app the pages make at the emulators.
EMU_PATCH = r"""
;(function(){
  var fb = window.firebase; if (!fb) return;
  function patchApp(app){
    try { if (fb.auth && !app.__dgAuthEmu) { app.__dgAuthEmu = 1; app.auth().useEmulator('http://127.0.0.1:9099', {disableWarnings:true}); } } catch(e){}
    try { if (fb.firestore && !app.__dgFsEmu) { app.__dgFsEmu = 1; app.firestore().useEmulator('127.0.0.1', 8080); } } catch(e){}
    try { if (fb.functions && !app.__dgFnEmu) { app.__dgFnEmu = 1; app.functions().useEmulator('127.0.0.1', 5001); } } catch(e){}
    try { if (fb.storage && !app.__dgStEmu) { app.__dgStEmu = 1; app.storage().useEmulator('127.0.0.1', 9199); } } catch(e){}
  }
  if (!fb.__dgInitWrapped) {
    fb.__dgInitWrapped = 1;
    var orig = fb.initializeApp;
    fb.initializeApp = function(){ var a = orig.apply(this, arguments); patchApp(a); return a; };
  }
  (fb.apps || []).forEach(patchApp);
})();
"""
PROD_HOSTS = ["firestore.googleapis.com", "identitytoolkit.googleapis.com", "securetoken.googleapis.com",
              "cloudfunctions.net", "firebasestorage.googleapis.com", "www.googleapis.com",
              "firebaseinstallations.googleapis.com", "firebase.googleapis.com", "script.google.com",
              "generativelanguage.googleapis.com", "api.anthropic.com", "googleusercontent.com"]
CDN = {r"^https://unpkg\.com/pdf-lib.*": "pdf-lib/dist/pdf-lib.min.js",
       r"^https://cdnjs\.cloudflare\.com/ajax/libs/jszip/.*": "jszip/dist/jszip.min.js"}


# ── the emulator, read and written as its owner (bypasses the rules) ──
def _req(url, data=None, method="GET"):
    r = urllib.request.Request(url, data=data, method=method,
                               headers={"Authorization": "Bearer owner", "Content-Type": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(r, timeout=20).read() or b"{}")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise

def _val(v):
    if v is None: return {"nullValue": None}
    if isinstance(v, bool): return {"booleanValue": v}
    if isinstance(v, int): return {"integerValue": str(v)}
    if isinstance(v, float): return {"doubleValue": v}
    if isinstance(v, (list, tuple)): return {"arrayValue": {"values": [_val(x) for x in v]}}
    if isinstance(v, dict): return {"mapValue": {"fields": {k: _val(x) for k, x in v.items()}}}
    return {"stringValue": str(v)}

def _py(v):
    if v is None: return None
    for k in ("stringValue", "booleanValue", "doubleValue", "timestampValue"):
        if k in v: return v[k]
    if "integerValue" in v: return int(v["integerValue"])
    if "arrayValue" in v: return [_py(x) for x in v["arrayValue"].get("values", [])]
    if "mapValue" in v: return {k: _py(x) for k, x in v["mapValue"].get("fields", {}).items()}
    return None

def doc(path):
    d = _req(f"{FS}/{path}")
    return {k: _py(v) for k, v in d.get("fields", {}).items()} if d else None

def docs(coll):
    out, tok = {}, ""
    while True:
        d = _req(f"{FS}/{coll}?pageSize=300" + (f"&pageToken={tok}" if tok else "")) or {}
        for x in d.get("documents", []):
            out[x["name"].split("/")[-1]] = {k: _py(v) for k, v in x.get("fields", {}).items()}
        tok = d.get("nextPageToken")
        if not tok:
            return out

def put(path, fields):
    _req(f"{FS}/{path}", json.dumps({"fields": {k: _val(v) for k, v in fields.items()}}).encode(), "PATCH")

def character(path_code):
    d = doc(f"characters/{path_code}")
    try:
        return json.loads(d["character_json"]) if d and d.get("character_json") else None
    except ValueError:
        return None

def wait_for(fn, timeout=20.0, step=0.4):
    end = time.time() + timeout
    while time.time() < end:
        try:
            v = fn()
            if v:
                return v
        except Exception:
            pass
        time.sleep(step)
    return None


def seed_agent(code, name, player="e2e player", stats=None, derived=None, extra=None, committed=True):
    """An Agent already made: their brief and saved character."""
    st = {"v": 1, "creationCommitted": committed,
          "bio": {"name": name, "profession": "federal_agent", "player_name": player, "employer": "FBI"},
          "stats": stats or {"STR": 11, "CON": 12, "DEX": 13, "INT": 14, "POW": 12, "CHA": 11},
          "skills": {"firearms": 50, "alertness": 40, "bureaucracy": 30},
          "bonds": [{"name": "Lena", "relationship": "Sister", "score": 11}],
          "derived": derived or {"hp": 12, "wp": 12, "san": 60, "bp": 48}}
    st["csStats"] = st["stats"]
    if extra:
        st.update(extra)
    put(f"briefs/{code}", {"agent_code": code, "char_name": name, "player_name": player,
                           "player_name_lc": player.lower(), "sex": "Female", "nationality": "American",
                           "standing_orders_ack_at": "2026-10-01T07:00:00.000Z"})
    put(f"characters/{code}", {"agent_code": code, "character_json": json.dumps(st), "player_name": player,
                               "player_name_lc": player.lower(), "updated_at": "2026-10-01T07:00:00.000Z"})
    return st


# ── a device: one browser context, one person ──
class Device:
    def __init__(self, run, name, width=1280, height=860, mobile=False, cover="e2e player",
                 private=False, standalone=False, service_workers=False, code=None):
        self.run, self.name = run, name
        self.errors, self.prod, self.console_err = [], [], []
        self.ctx = run.browser.new_context(viewport={"width": width, "height": height}, is_mobile=mobile and ENGINE == "chromium",
                                           has_touch=mobile, device_scale_factor=2 if mobile else 1, accept_downloads=True,
                                           service_workers="allow" if service_workers else "block")
        self.ctx.route(re.compile(r"^https?://(?!127\.0\.0\.1|localhost).*"), self._block)
        for pat, path in CDN.items():
            self.ctx.route(re.compile(pat), lambda route, *_, path=path: route.fulfill(path=os.path.join(NM, path), content_type="application/javascript"))
        self.ctx.route(re.compile(r"^https://www\.gstatic\.com/firebasejs/.*"), self._fb)
        self.ctx.route(re.compile(r"^https://fonts\.(googleapis|gstatic)\.com/.*"), lambda r: r.abort())
        init = ["sessionStorage.setItem('dg_boot_seen', '1');"]
        if cover:
            init.append("if (!localStorage.getItem('dg_cover_identity')) localStorage.setItem('dg_cover_identity', %s);" % json.dumps(cover))
        if code:
            init.append("localStorage.setItem('dg_stats_cloud_code', %s);" % json.dumps(code))
        # Player tours (assets/tour.js) stay off: they'd start over the pages.
        init.append("localStorage.setItem('dg_tours_off', '1');")
        script = "try {" + " ".join(init) + "} catch (e) {}"
        if private:
            # Private mode on some browsers: storage throws on every call.
            script = ("(() => { const t = () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); };"
                      " for (const s of ['localStorage', 'sessionStorage']) { try { const o = window[s];"
                      " ['getItem', 'setItem', 'removeItem', 'clear', 'key'].forEach(m => { o[m] = t; }); } catch (e) {} } })();")
        self.ctx.add_init_script(script)
        if standalone:
            # An iOS home-screen app: native dialogs show nothing and say no.
            self.ctx.add_init_script("window.confirm = () => false; window.alert = () => {}; window.prompt = () => null; window.__dgStandalone = true;")
        self.page = self.ctx.new_page()
        self.page.set_default_timeout(15000)
        self._wire(self.page)

    def _wire(self, page):
        page.on("pageerror", lambda e: self.errors.append(f"{page.url.rsplit('/', 1)[-1][:50]}: {e}"))
        page.on("console", lambda m: self.console_err.append(m.text[:300]) if m.type == "error" else None)
        page.on("dialog", lambda d: (self.errors.append("native dialog shown: " + d.message[:80]), d.dismiss()))

    def _block(self, route):
        u = route.request.url
        # Replayed live Agents carry photo links to the live bucket: a
        # blocked image load there is expected, not a leak.
        if self.run.quiet_photos and route.request.resource_type == "image" and "firebasestorage.googleapis.com" in u:
            return route.abort()
        if any(h in u for h in PROD_HOSTS):
            self.prod.append(u[:160])
        route.abort()

    def _fb(self, route):
        fname = route.request.url.rsplit("/", 1)[1].split("?")[0]
        path = os.path.join(NM, "firebase", fname)
        if not os.path.exists(path):
            self.errors.append("missing Firebase SDK file " + fname)
            return route.abort()
        body = re.sub(r"//# sourceMappingURL=.*", "", open(path, encoding="utf8").read()) + EMU_PATCH
        route.fulfill(status=200, content_type="application/javascript", body=body, headers={"Access-Control-Allow-Origin": "*"})

    def go(self, path, wait="domcontentloaded"):
        self.page.goto(f"{BASE}/{path}", wait_until=wait, timeout=30000)

    def js(self, expr, arg=None):
        return self.page.evaluate(expr, arg)

    def until(self, expr, arg=None, timeout=20000):
        self.page.wait_for_function(expr, arg=arg, timeout=timeout)

    def screen_text(self):
        try:
            return self.page.inner_text("body")
        except Exception:
            return ""

    def shot(self, label):
        os.makedirs(os.path.join(OUT, "shots"), exist_ok=True)
        try:
            self.page.screenshot(path=os.path.join(OUT, "shots", f"{label}_{self.name}.png"), full_page=False)
        except Exception:
            pass

    def close(self):
        try:
            self.ctx.close()
        except Exception:
            pass


# ── the shared checks after every scenario ──
JUNK = re.compile(r"\bNaN\b|\bundefined\b|\[object Object\]|Infinity")

def maxes(st):
    s = st.get("csStats") or st.get("stats") or {}
    num = lambda k: s.get(k) if isinstance(s.get(k), (int, float)) else 0
    unnat = (st.get("skills") or {}).get("unnatural") or 0
    # SAN can be restored past POW x 5, up to 99 - Unnatural (agent-rules.js).
    return {"hp": math.ceil((num("STR") + num("CON")) / 2), "wp": num("POW"), "san": 99 - (unnat if isinstance(unnat, (int, float)) else 0)}

def check_characters(codes):
    bad = []
    for c in codes:
        d = doc(f"characters/{c}")
        if not d:
            continue
        try:
            st = json.loads(d.get("character_json") or "")
        except ValueError:
            bad.append(f"{c}: character_json is not JSON")
            continue
        dv, mx = st.get("derived") or {}, maxes(st)
        for k in ("hp", "wp", "san", "bp"):
            v = dv.get(k)
            if v is None:
                continue
            if not isinstance(v, (int, float)) or (isinstance(v, float) and not math.isfinite(v)):
                bad.append(f"{c}: derived.{k} = {v!r}")
            elif k in mx and mx[k] and v > mx[k]:
                bad.append(f"{c}: derived.{k} {v} above its maximum {mx[k]}")
    return bad


class Run:
    def __init__(self, p):
        exe = os.environ.get("DG_TEST_CHROMIUM_PATH", "/opt/pw-browsers/chromium")
        if ENGINE == "webkit":
            self.browser = p.webkit.launch()
        else:
            self.browser = p.chromium.launch(executable_path=exe if os.path.exists(exe) else None)
        self.results = []

    def scenario(self, sid, title, fn):
        if ONLY and sid not in ONLY:
            return
        self.devices, self.checks, self.codes = [], [], []
        self.quiet_photos = False
        t0 = time.time()
        crash = ""
        try:
            fn(self)
        except Exception as e:
            crash = f"{type(e).__name__}: {e}".split("\n")[0][:300]
            self.checks.append((False, "crashed: " + crash, traceback.format_exc().splitlines()[-3:]))
        for d in self.devices:
            for e in d.errors:
                self.checks.append((False, f"[{d.name}] page error / native dialog", e))
            for u in d.prod:
                self.checks.append((False, f"[{d.name}] request to a production host", u))
            junk = JUNK.findall(d.screen_text())
            if junk:
                self.checks.append((False, f"[{d.name}] junk on screen ({', '.join(sorted(set(junk)))})", d.page.url))
            denied = [m for m in d.console_err if "permission" in m.lower() or "denied" in m.lower()]
            if denied:
                self.checks.append((False, f"[{d.name}] a Firestore/Storage rule refused a request", denied[0]))
        for b in check_characters(self.codes):
            self.checks.append((False, "saved character out of shape", b))
        failed = [c for c in self.checks if not c[0]]
        if failed:
            for d in self.devices:
                d.shot(sid)
        for d in self.devices:
            d.close()
        self.results.append({"id": sid, "title": title, "ok": not failed, "secs": round(time.time() - t0, 1),
                             "checks": [{"ok": c[0], "what": c[1], "detail": str(c[2])[:400]} for c in self.checks]})
        print(("PASS " if not failed else "FAIL ") + f"{sid} {title} ({len(self.checks) - len(failed)}/{len(self.checks)})")
        for c in failed:
            print("     x", c[1], "--", str(c[2])[:220])

    # helpers for scenarios
    def device(self, name, **kw):
        d = Device(self, name, **kw)
        self.devices.append(d)
        return d

    def check(self, ok, what, detail=""):
        self.checks.append((bool(ok), what, detail))
        return bool(ok)

    def code(self, prefix):
        c = f"{prefix}-{RUN}"[:16].upper()
        self.codes.append(c)
        return c


# ── shared flows ──
def handler_sign_in(h):
    h.go("a-cell.html")
    h.page.wait_for_selector("#acell-pw-input", timeout=20000)
    h.page.fill("#acell-pw-input", HANDLER_PW)
    h.page.press("#acell-pw-input", "Enter")
    h.until("""() => { const g = document.getElementById('acell-gate');
        return !g || getComputedStyle(g).display === 'none' || g.classList.contains('hidden') || g.getBoundingClientRect().height === 0; }""", timeout=30000)

def handler_make_cell(h, name, codes):
    h.page.click('.tw[data-tab="cells"]')
    h.page.click("#cells-create-btn")
    h.page.fill("#cells-new-name", name)
    h.page.fill("#cells-new-handler", "Sam")
    h.page.click("#cells-new-confirm")
    cid = wait_for(lambda: next((k for k, v in docs("cells").items() if v.get("name") == name), None), 20)
    if not cid:
        return None
    for code in codes:
        i = wait_for(lambda: h.js("""(n) => { const c = [...document.querySelectorAll('.cell-card')].find(x => x.textContent.includes(n));
            return c ? c.getAttribute('data-i') : null; }""", name), 15)
        h.until("([i, c]) => { const s = document.querySelector(`[data-add-select=\"${i}\"]`); return s && [...s.options].some(o => o.value === c); }", [i, code])
        h.js("""([i, c]) => { const s = document.querySelector(`[data-add-select="${i}"]`); [...s.options].forEach(o => { o.selected = o.value === c; });
            s.dispatchEvent(new Event('change', { bubbles: true })); }""", [i, code])
        h.page.click(f'[data-add-btn="{i}"]')
        wait_for(lambda: code in ((doc(f"cells/{cid}") or {}).get("member_codes") or []), 20)
    return cid

def open_agent(d, code):
    d.go(f"agent-hub.html?code={code}")
    d.page.wait_for_selector(f"#ah-sheet-{code} .as-paper.ap .ap-vitals", timeout=30000)


# ── scenarios ──
def s01_new_recruit(r):
    """A new player on a phone builds an Agent with New Recruit and signs the Contract, under the real rules."""
    d = r.device("player-phone", width=390, height=844, mobile=True, cover="Nadia Player")
    d.go("agent-hub.html#new")
    R = "#nr-root "
    d.page.click(R + "[data-a=begin]")
    for k in ["STR"]:
        d.page.click(R + f"[data-a=st][data-k={k}][data-d='-1']")
    d.page.click(R + "[data-a=st][data-k=INT][data-d='1']")
    d.page.click(R + "[data-a=next]")
    d.page.click(R + "[data-a=prof][data-src=cx][data-key=cbp_marine]")
    d.page.click(R + "[data-a=next]")
    for k in ["firearms", "first_aid", "stealth", "occult"]:
        d.page.click(R + f"[data-a=bonus][data-id='key:{k}'][data-d='1']")
    d.page.click(R + "[data-a=next]")
    d.page.click(R + "[data-a=next]")  # no Damaged Veteran
    d.page.fill(R + "[data-f='bio.name']", "Nadia Kerr")
    d.page.fill(R + "[data-f='bio.codename']", "Sparrow")
    d.page.fill(R + "[data-f='bio.age']", "34")
    d.page.select_option(R + "[data-f='bio.sex']", "Female")
    d.page.click(R + "[data-a=next]")
    d.until("() => (window.dgRecruit._w() || {}).step === 6", timeout=20000)
    code = d.js("() => dgRecruit._w().code")
    r.codes.append(code)
    brief = wait_for(lambda: doc(f"briefs/{code}"), 15) or {}
    r.check(brief.get("char_name") == "Nadia Kerr" and brief.get("player_name") == "Nadia Player",
            "Personal data makes the Agent Code and files the brief under the real rules", json.dumps(brief)[:200])
    r.check((character(code) or {}).get("creationCommitted") is False, "the draft is saved to the cloud, not committed yet")
    d.page.click(R + "[data-a=bond-gen]")
    for i in range(1, d.page.locator(R + ".nr-bondc").count()):
        d.page.fill(R + f"[data-f='bonds.{i}.name']", f"Bond {i}")
        d.page.fill(R + f"[data-f='bonds.{i}.relationship']", "Friend")
    d.page.click(R + "[data-a=bond-ai]")
    got = wait_for(lambda: (lambda v: v if v.startswith("EMULATOR BOND") else None)(
        d.js("() => (document.querySelector(\"#nr-root [data-f='bonds.0.description']\") || {}).value || ''")), 20) or ""
    r.check(got.startswith("EMULATOR BOND"), "the Bond's AI description comes back from the Cloud Function", got)
    for want in (7, 8, 9, 10, 11):  # Motivations, Incursion, Equipment, Profiling, Review
        if want == 8 and d.page.locator(R + "[data-f='motivations.0']").count():
            d.page.fill(R + "[data-f='motivations.0']", "Keep my mother out of this")
        d.page.click(R + "[data-a=next]")
        try:
            d.until("(n) => (window.dgRecruit._w() || {}).step === n", want, timeout=20000)
        except Exception:
            err = d.js("() => { const e = document.querySelector('#nr-root [data-err]'); return e ? e.textContent : ''; }")
            raise RuntimeError(f"the wizard stopped before step {want}: {err!r}")
    d.page.click(R + "[data-a=sign]")
    d.page.wait_for_selector("#fn-orders.fn-contract", timeout=10000)
    d.page.keyboard.press("Enter")
    d.page.keyboard.press("y")
    d.page.wait_for_selector(f".tw.active[data-tab='{code}']", timeout=20000)
    st = wait_for(lambda: (lambda c: c if c and c.get("creationCommitted") else None)(character(code)), 15) or {}
    r.check(st.get("creationCommitted") is True, "signing files the Agent: the character is committed")
    r.check(bool((doc(f"briefs/{code}") or {}).get("standing_orders_ack_at")), "…and the Contract is recorded on the brief")
    d.page.wait_for_selector(f"#ah-sheet-{code} .ap-vitals", timeout=20000)
    r.check("Nadia Kerr" in d.screen_text(), "their Agent File opens")


def s02_handler_cell_live(r):
    """The Handler signs in, makes a Cell and adds two Agents; an open player page shows the Cell without a reload."""
    a, b = r.code("E2CA"), r.code("E2CB")
    seed_agent(a, "Ana Reyes", player="cell player")
    seed_agent(b, "Ben Ortiz", player="cell player")
    p = r.device("player", cover="cell player", code=a)
    open_agent(p, a)
    h = r.device("handler", width=1360, height=900, cover=None)
    handler_sign_in(h)
    r.check(True, "the Handler signs in to A-Cell (handlerLogin Cloud Function)")
    cid = handler_make_cell(h, f"E2E Table {RUN}", [a, b])
    r.check(bool(cid) and set([a, b]) <= set((doc(f"cells/{cid}") or {}).get("member_codes") or []), "a Cell is created with both Agents in it", cid)
    p.js(f"() => document.getElementById('ah-sheet-{a}')._ap.toggleCell(true)")
    shown = wait_for(lambda: "Ben Ortiz" in p.js(f"() => (document.querySelector('#ah-sheet-{a} .ap-init') || {{}}).innerText || ''"), 25)
    r.check(shown, "the player's open Agent File lists the new Cell member without a reload")


def s03_play_san_kia_oath(r):
    """In play: SAN loss to 0 (INSANE), HP to 0 (KIA), Edit with Oath N then Y -- all saved under the real rules."""
    c = r.code("E2PL")
    seed_agent(c, "Paul Lind", derived={"hp": 2, "wp": 12, "san": 3, "bp": 0})
    d = r.device("player", code=c)
    open_agent(d, c)
    S = f"#ah-sheet-{c} "
    for _ in range(3):
        d.page.click(S + "[data-a='san-']")
    r.check(wait_for(lambda: (character(c) or {}).get("derived", {}).get("san") == 0, 15), "SAN − to 0 is saved")
    r.check(wait_for(lambda: d.js(f"() => !!document.querySelector('#ah-charstamp-{c} .stamp[data-fate=insane]')"), 10), "…and INSANE is stamped")
    for _ in range(2):
        d.page.click(S + "[data-a='hp-']")
    r.check(wait_for(lambda: (character(c) or {}).get("derived", {}).get("hp") == 0, 15), "HP − to 0 is saved")
    r.check(wait_for(lambda: d.js(f"() => !!document.querySelector('#ah-charstamp-{c} .stamp[data-fate=kia]')"), 10), "…and KIA is stamped")
    d.page.click(S + "[data-a=edit]")
    # v3.9.0: Employer is the agencies drop-down (assets/agencies.js).
    d.page.select_option(S + "[data-emp=sel]", "DEA")
    d.page.click(S + "[data-a=save]")
    d.page.wait_for_selector("#fn-orders", timeout=10000)
    d.page.keyboard.press("Enter")
    d.page.keyboard.press("n")
    time.sleep(2)
    r.check((character(c) or {}).get("bio", {}).get("employer") == "FBI", "Oath N: the edit isn't saved")
    d.page.click(S + "[data-a=save]")
    d.page.wait_for_selector("#fn-orders", timeout=10000)
    d.page.keyboard.press("Enter")
    d.page.keyboard.press("y")
    r.check(wait_for(lambda: (character(c) or {}).get("bio", {}).get("employer") == "Drug Enforcement Administration", 15), "Oath Y: the edit is saved")


def s04_two_devices_same_agent(r):
    """The same Agent open on a phone and a laptop: each one's change lands, neither undoes the other."""
    c = r.code("E2TW")
    seed_agent(c, "Tess Wynn")
    a = r.device("laptop", code=c)
    b = r.device("phone", width=390, height=844, mobile=True, code=c)
    open_agent(a, c)
    open_agent(b, c)
    a.page.click(f"#ah-sheet-{c} [data-a='hp-']")
    b.page.click(f"#ah-sheet-{c} [data-a='san-']")
    ok = wait_for(lambda: (lambda d: d.get("hp") == 11 and d.get("san") == 59)((character(c) or {}).get("derived", {})), 15)
    r.check(ok, "HP from the laptop and SAN from the phone are both saved", (character(c) or {}).get("derived"))
    seen = wait_for(lambda: "59" in b.js(f"() => document.querySelector('#ah-sheet-{c} .ap-vitals').innerText") and
                    "11" in a.js(f"() => document.querySelector('#ah-sheet-{c} .ap-vitals').innerText"), 15)
    r.check(seen, "each device shows the other's change live")
    for _ in range(3):  # quick taps on both at once
        a.page.click(f"#ah-sheet-{c} [data-a='wp-']")
        b.page.click(f"#ah-sheet-{c} [data-a='wp-']")
    ok = wait_for(lambda: (character(c) or {}).get("derived", {}).get("wp") == 6, 15)
    r.check(ok, "six quick WP taps split across two devices all count (12 → 6)", (character(c) or {}).get("derived"))


def s05_offline_mid_save(r):
    """The connection drops while playing; the change saves once it's back."""
    c = r.code("E2OF")
    seed_agent(c, "Omar Fell")
    d = r.device("player", code=c)
    open_agent(d, c)
    d.ctx.set_offline(True)
    d.page.click(f"#ah-sheet-{c} [data-a='hp-']")
    d.page.click(f"#ah-sheet-{c} [data-a='hp-']")
    time.sleep(3)
    shown = d.js(f"() => document.querySelector('#ah-sheet-{c} .ap-vitals').innerText")
    r.check("10" in shown, "offline, the page still shows the change", shown[:80])
    d.ctx.set_offline(False)
    r.check(wait_for(lambda: (character(c) or {}).get("derived", {}).get("hp") == 10, 30), "back online, it saves", (character(c) or {}).get("derived"))


def s06_evidence_restricted(r):
    """The Handler releases one Evidence item to the Cell and restricts another to one Agent; the rules keep it from the other."""
    a, b = r.code("E2EA"), r.code("E2EB")
    seed_agent(a, "Ava Stone", player="ev ava")
    seed_agent(b, "Bo Keene", player="ev bo")
    cid = f"cell_e2e_{RUN}"
    put(f"cells/{cid}", {"name": f"E2E Evidence {RUN}", "handler": "Sam", "member_codes": [a, b]})
    put(f"evidence/ev_all_{RUN}", {"title": "Morgue Photographs", "body": "-", "cell_id": cid, "visible_to": [a, b], "released": True, "created_at": 1})
    put(f"evidence/ev_one_{RUN}", {"title": "Ava's Letter", "body": "-", "cell_id": cid, "visible_to": [a], "released": True, "created_at": 2})
    pa = r.device("ava", code=a, cover="ev ava")
    pb = r.device("bo", code=b, cover="ev bo")
    for p, code in ((pa, a), (pb, b)):
        open_agent(p, code)
        p.js("() => window.dgFieldNotes.open('evidence')")
    ta = wait_for(lambda: (lambda t: t if "Morgue Photographs" in t else None)(pa.js("() => document.querySelector('#fn-veil').innerText")), 20) or ""
    tb = wait_for(lambda: (lambda t: t if "Morgue Photographs" in t else None)(pb.js("() => document.querySelector('#fn-veil').innerText")), 20) or ""
    r.check("Ava's Letter" in ta, "the Agent it was released to sees the restricted item")
    r.check(tb and "Ava's Letter" not in tb, "the other Agent sees the Cell's item but not the restricted one")
    refused = pb.js(f"""async () => {{ try {{ await firebase.firestore().collection('evidence').doc('ev_one_{RUN}').get(); return 'read'; }}
        catch (e) {{ return e.code || String(e); }} }}""")
    r.check(refused == "permission-denied", "reading it directly is refused by the rules", refused)
    pb.console_err[:] = [m for m in pb.console_err if "permission" not in m.lower()]  # the refusal above is the point


def s07_handler_deletes_open_agent(r):
    """The Handler deletes an Agent while their player has them open and keeps playing; then restores them."""
    c = r.code("E2DL")
    seed_agent(c, "Dina Lowe")
    p = r.device("player", code=c)
    open_agent(p, c)
    h = r.device("handler", width=1360, height=900, cover=None)
    handler_sign_in(h)
    res = h.js("""(c) => window.__dgGetHandlerIdToken().then(t => window.dgAcellApi.post({ action: 'delete_character', agent_code: c, id_token: t }))
        .then(x => 'done', e => String(e))""", c)
    r.check(res == "done" and not doc(f"characters/{c}") and doc(f"deleted_agents/{c}"), "the Handler deletes the Agent (to Recently Deleted)", res)
    p.page.click(f"#ah-sheet-{c} [data-a='hp-']")
    time.sleep(4)
    r.check(not doc(f"characters/{c}"), "a tap on the player's still-open page doesn't bring the deleted Agent back")
    status = p.js(f"() => (document.querySelector('[data-ap-status=\"{c}\"]') || {{}}).textContent || ''")
    r.check("deleted" in status.lower(), "…and the page says why it isn't saving", status)
    res = h.js("""(c) => window.__dgGetHandlerIdToken().then(t => window.dgAcellApi.post({ action: 'restore_character', agent_code: c, id_token: t }))
        .then(x => 'done', e => String(e))""", c)
    r.check(res == "done" and wait_for(lambda: doc(f"characters/{c}"), 10), "the Handler restores them", res)
    time.sleep(2)
    p.page.click(f"#ah-sheet-{c} [data-a='san-']")
    r.check(wait_for(lambda: (character(c) or {}).get("derived", {}).get("san") == 59, 20), "after the restore, the open page saves again", (character(c) or {}).get("derived"))


def _recruit_import(r, fname, mime, buf, want_name):
    d = r.device("import-" + fname.split(".")[-1], cover="import player")
    d.go("agent-hub.html#new")
    d.page.wait_for_selector("#nr-root [data-file]", state="attached", timeout=20000)
    d.page.set_input_files("#nr-root [data-file]", files=[{"name": fname, "mimeType": mime, "buffer": buf}])
    try:
        d.until("() => (window.dgRecruit._w() || {}).step === 5", timeout=20000)
    except Exception:
        return r.check(False, f"{fname}: import lands at Personal data", d.js("() => (document.querySelector('#nr-root [data-err]') || {}).textContent || ''"))
    # What a file can't carry (Kappa Black has no Sex) the player fills in.
    for sel, val in (("[data-f='bio.sex']", "Male"), ("[data-f='bio.age']", "40")):
        loc = d.page.locator("#nr-root " + sel)
        if loc.count() and not (loc.input_value() or "").strip():
            loc.select_option(val) if sel.endswith("sex']") else loc.fill(val)
    d.page.click("#nr-root [data-a=next]")
    try:
        d.until("() => (window.dgRecruit._w() || {}).step === 6", timeout=20000)
    except Exception:
        return r.check(False, f"{fname}: Personal data goes on", d.js("() => (document.querySelector('#nr-root [data-err]') || {}).textContent || ''"))
    code = d.js("() => dgRecruit._w().code")
    r.codes.append(code)
    st = wait_for(lambda: character(code), 15) or {}
    return r.check((st.get("bio") or {}).get("name") == want_name and (doc(f"briefs/{code}") or {}).get("char_name") == want_name,
                   f"{fname}: imported and saved under the real rules (character and brief)", f"{code} {json.dumps(st)[:160]}")


def s08_imports_real_rules(r):
    """Every import format through New Recruit, saved for real: Kappa Black .toml, the Google Sheets .xlsx, and a DD Form 315 the notebook exported."""
    fx = os.path.join(REPO, "test", "fixtures")
    _recruit_import(r, "kappa.toml", "text/plain", open(os.path.join(fx, "kappablack-export.toml"), "rb").read(), "Alistair Islay Lagavulin")
    _recruit_import(r, "agent.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    open(os.path.join(fx, "agent-sheet.xlsx"), "rb").read(), "Priya Anand")
    c = r.code("E2PD")
    seed_agent(c, "Pia Dorn", player="import player")
    e = r.device("exporter", cover="import player", code=c)
    open_agent(e, c)
    e.js("() => window.dgFieldNotes.open('settings')")
    e.page.wait_for_selector("#fn-veil [data-s=pdf]", timeout=15000)
    with e.page.expect_download(timeout=30000) as dl:
        e.page.click("#fn-veil [data-s=pdf]")
    path = os.path.join(OUT, f"e2e-{c}.pdf")
    dl.value.save_as(path)
    r.check(dl.value.suggested_filename == "Pia Dorn - DD Form 315.pdf", "the notebook exports a DD Form 315 for a saved Agent", dl.value.suggested_filename)
    buf = open(path, "rb").read()
    os.remove(path)
    _recruit_import(r, "pia.pdf", "application/pdf", buf, "Pia Dorn")


def s09_old_links(r):
    """Old bookmarks to the removed character sheet forward to Agent Hub."""
    c = r.code("E2OL")
    seed_agent(c, "Olga Lind")
    d = r.device("player", code=c)
    d.go(f"stats/index.html?load={c}&live=1")
    d.page.wait_for_url(f"**/agent-hub.html?code={c}", timeout=15000)
    d.page.wait_for_selector(f"#ah-sheet-{c} .ap-vitals", timeout=30000)
    r.check("Olga Lind" in d.screen_text(), "stats/index.html?load=CODE opens that Agent on Agent Hub", d.page.url)
    d.go("stats/index.html?new=1")
    d.page.wait_for_url("**/agent-hub.html#new", timeout=15000)
    r.check(d.page.locator("#nr-root").count() == 1, "stats/index.html?new=1 opens New Recruit", d.page.url)
    d.go("no-such-page.html")
    r.check("FILE NOT FOUND" in d.screen_text(), "any other missing address shows the not-found page")


def s10_private_mode(r):
    """A browser whose storage throws on every call (some private modes): the pages still work."""
    c = r.code("E2PM")
    seed_agent(c, "Pim Moss")
    d = r.device("private", private=True)
    open_agent(d, c)
    d.page.click(f"#ah-sheet-{c} [data-a='hp-']")
    r.check(wait_for(lambda: (character(c) or {}).get("derived", {}).get("hp") == 11, 20), "the Agent File plays and saves", (character(c) or {}).get("derived"))
    d.js("() => window.dgFieldNotes.open('agentfile')")
    r.check(wait_for(lambda: d.js("() => !!document.querySelector('#fn-veil .as-paper')"), 15), "the notebook opens on the Agent File")
    d.go("agent-hub.html#new")
    d.page.wait_for_selector("#nr-root [data-a=begin]", timeout=20000)
    d.page.click("#nr-root [data-a=begin]")
    r.check(d.js("() => (window.dgRecruit._w() || {}).step") == 1, "New Recruit starts")


def s11_ios_standalone(r):
    """An iPhone home-screen app, where confirm() shows nothing and says no: Cancel an edit and Discard a draft still work."""
    c = r.code("E2IS")
    seed_agent(c, "Ivy Shaw")
    d = r.device("iphone-app", width=390, height=844, mobile=True, standalone=True, code=c)
    d.ctx.add_init_script("window.__native = 0; ['confirm', 'alert', 'prompt'].forEach(k => { const f = window[k]; window[k] = function () { window.__native++; return f.apply(this, arguments); }; });")
    open_agent(d, c)
    S = f"#ah-sheet-{c} "
    d.page.click(S + "[data-a=edit]")
    d.page.select_option(S + "[data-emp=sel]", "__other")
    d.page.fill(S + "[data-emp=other]", "NSA")
    d.page.click(S + "[data-a=cancel]")
    d.page.wait_for_selector("#fn-confirm [data-cf=ok]", timeout=8000)
    d.page.click("#fn-confirm [data-cf=ok]")
    r.check(wait_for(lambda: d.js(f"() => !document.querySelector('{S}.ap-editbar')"), 8), "Cancel asks in the page and leaves Edit")
    d.js("() => localStorage.setItem('dg_recruit_draft', JSON.stringify({ v: 1, step: 3, bio: { name: 'Draft Doe' }, savedAt: Date.now() }))")
    d.go("agent-hub.html#new")
    d.page.wait_for_selector("#nr-root [data-a=discard]", timeout=20000)
    d.page.click("#nr-root [data-a=discard]")
    d.page.wait_for_selector("#fn-confirm [data-cf=ok]", timeout=8000)
    d.page.click("#fn-confirm [data-cf=ok]")
    r.check(wait_for(lambda: d.js("() => !localStorage.getItem('dg_recruit_draft')"), 8), "Discard asks in the page and discards the draft")
    r.check(d.js("() => window.__native") == 0, "no native dialog was used", d.js("() => window.__native"))


def s12_returning_device(r):
    """A player who last visited on the previous release (its app cached by the service worker) comes back after this one ships."""
    old, root_file = os.environ.get("E2E_OLD_ROOT", ""), os.environ.get("E2E_ROOT_FILE", "")
    if not old or not os.path.exists(os.path.join(old, "agent-hub.html")) or not root_file:
        return r.check(False, "the previous release is available to serve", old)
    c = r.code("E2RD")
    seed_agent(c, "Rafe Dunn")
    try:
        open(root_file, "w").write(old)
        d = r.device("returning", service_workers=True, code=c)
        open_agent(d, c)
        r.check(wait_for(lambda: d.js("() => !!(navigator.serviceWorker && navigator.serviceWorker.controller)"), 20), "the previous release's service worker is installed")
        old_cache = d.js("() => caches.keys()")
        open(root_file, "w").write(REPO)
        new_ok = False
        for _ in range(6):  # the worker refreshes in the background; a few visits pick it up
            try:
                d.page.reload(wait_until="domcontentloaded", timeout=30000)
            except Exception:
                pass  # a reload overtaken by the worker taking over: just look again
            d.page.wait_for_timeout(2500)
            if d.js("() => !!(window.dgStore && window.dgStore.saveCharacterMerged)"):
                new_ok = True
                break
        r.check(new_ok, "within a few visits the device runs this release, not the cached one", old_cache)
        # The new worker clears the old cache as it takes over; give it a moment.
        keys = wait_for(lambda: (lambda k: k if not any(o in k for o in old_cache) else None)(d.js("() => caches.keys()")), 20)
        if not keys:
            try:
                d.page.reload(wait_until="domcontentloaded", timeout=30000)
            except Exception:
                pass
            keys = wait_for(lambda: (lambda k: k if not any(o in k for o in old_cache) else None)(d.js("() => caches.keys()")), 20)
        r.check(bool(keys), "the previous release's cache is gone", d.js("() => caches.keys()"))
        d.page.wait_for_selector(f"#ah-sheet-{c} .ap-vitals", timeout=30000)
        d.page.click(f"#ah-sheet-{c} [data-a='hp-']")
        r.check(wait_for(lambda: (character(c) or {}).get("derived", {}).get("hp") == 11, 20), "the Agent File plays and saves after the update")
        d.go(f"stats/index.html?load={c}")
        d.page.wait_for_url(f"**/agent-hub.html?code={c}", timeout=20000)
        r.check(True, "an old sheet link isn't served from the old cache; it forwards to Agent Hub")
    finally:
        open(root_file, "w").write(REPO)


def s13_dice_to_cell_and_handler(r):
    """A player's roll lands in their Cell's feed (real rules) and shows on the Handler's Live Rolls."""
    c = r.code("E2DR")
    seed_agent(c, "Dara Reed", player="dice player")
    cid = f"cell_dice_{RUN}"
    put(f"cells/{cid}", {"name": f"E2E Dice {RUN}", "handler": "Sam", "member_codes": [c]})
    h = r.device("handler", width=1360, height=900, cover=None)
    handler_sign_in(h)
    p = r.device("player", code=c, cover="dice player")
    open_agent(p, c)
    p.page.wait_for_function("() => window.dgDice && window.dgDice.roll", timeout=15000)
    p.page.wait_for_timeout(1500)
    p.js("() => window.dgDice.roll(50, 'Firearms')")
    got = wait_for(lambda: docs(f"dice_rolls/{cid}/rolls"), 20) or {}
    r.check(any("Firearms" in json.dumps(v) for v in got.values()), "the roll is saved in the Cell's feed", list(got)[:2])
    r.check(not docs(f"dice_rolls/solo:{c}/rolls"), "…not misfiled under the Agent's solo feed")
    # The Live Rolls list sits in the Dice Roller panel, which may be folded away.
    seen = wait_for(lambda: "Firearms" in (h.js("() => (document.getElementById('dr-history-list') || {}).textContent || ''") or ""), 30)
    r.check(seen, "the Handler's A-Cell shows it in Live Rolls", h.js("() => (document.getElementById('dr-history-section') || {}).textContent || 'no Live Rolls section'")[:200])


def s14_replay_live_data(r):
    """Every real Agent from a read-only snapshot of the live campaign, opened on Agent Hub, in A-Cell, and through the PDF export."""
    path = os.environ.get("E2E_REPLAY", "")
    if not path or not os.path.exists(path):
        return r.check(True, "no snapshot given (E2E_REPLAY): skipped")
    snap = json.load(open(path))
    r.quiet_photos = True
    for coll in ("characters", "briefs", "cells", "operations"):
        for d in snap.get(coll, []):
            _req(f"{FS}/{coll}/{d['id']}", json.dumps({"fields": d["fields"]}).encode(), "PATCH")
    codes = [d["id"] for d in snap.get("characters", [])]
    r.codes += codes
    p = r.device("player", cover=None)
    p.ctx.route(re.compile(r"^https://unpkg\.com/pdf-lib.*"), lambda route, *_: route.fulfill(path=os.path.join(NM, "pdf-lib/dist/pdf-lib.min.js"), content_type="application/javascript"))
    broken = []
    for c in codes:
        n0 = len(p.errors)
        try:
            p.go(f"agent-hub.html?code={c}")
            p.page.wait_for_selector(f"#ah-sheet-{c} .as-paper, #ah-sheet-{c} .as-text", timeout=25000)
            p.page.wait_for_timeout(800)
            junk = JUNK.findall(p.js(f"() => (document.getElementById('ah-sheet-{c}') || document.body).innerText"))
            if junk:
                broken.append(f"{c}: {sorted(set(junk))} on the Agent File")
            pdf = p.js("""(c) => new Promise(res => {
                const go = () => window.dgFieldNotes && dgStore.getCharacter(c).then(d => {
                    const st = d && d.character_json ? JSON.parse(d.character_json) : null;
                    if (!st) return res('no sheet');
                    return window.dgSheetPdf.build(st).then(b => res(b && b.length > 1000 ? 'ok' : 'empty'), e => res('PDF failed: ' + e));
                }).catch(e => res('read failed: ' + e));
                if (window.dgSheetPdf) go(); else { const s = document.createElement('script'); s.src = 'assets/sheet-io/pdf-export.js'; s.onload = go; document.head.appendChild(s); }
            })""", c)
            if pdf not in ("ok", "no sheet"):
                broken.append(f"{c}: {pdf}")
        except Exception as e:
            broken.append(f"{c}: {str(e).splitlines()[0][:120]}")
        if len(p.errors) > n0:
            broken.append(f"{c}: page error {p.errors[n0][:160]}")
    r.check(not broken, f"all {len(codes)} live Agents open on the Agent File and export to PDF", "; ".join(broken)[:900])
    h = r.device("handler", width=1360, height=900, cover=None)
    handler_sign_in(h)
    h.page.wait_for_timeout(3000)
    names = h.js("() => [...document.querySelectorAll('#play-agent-list .play-agent-btn')].length")
    bad = []
    for i in range(names or 0):
        n0 = len(h.errors)
        h.js("(i) => document.querySelectorAll('#play-agent-list .play-agent-btn')[i].click()", i)
        h.page.wait_for_timeout(400)
        junk = JUNK.findall(h.js("() => (document.getElementById('play-view') || document.body).innerText"))
        if junk or len(h.errors) > n0:
            bad.append(f"#{i}: {sorted(set(junk))} {h.errors[n0:n0 + 1]}")
    r.check(names and not bad, f"A-Cell's dossier opens for all {names} Agents", "; ".join(bad)[:600])


# ── music (Table Radio) ──
AUDIO_STATE = """(needle) => [...document.querySelectorAll('audio')].filter(a => (a.currentSrc || a.src || '').includes(needle))
    .map(a => ({ src: (a.currentSrc || a.src).split('/').pop(), paused: a.paused, t: Math.round(a.currentTime * 10) / 10, vol: a.volume, muted: a.muted }))"""

def _handler_music(r, ch="1"):
    h = r.device("handler", width=1360, height=900, cover=None)
    h.ctx.add_init_script("try { localStorage.setItem('dg_acell_broadcast_channel', %s); } catch (e) {}" % json.dumps(ch))
    handler_sign_in(h)
    h.page.click('.tw[data-tab="music"]')
    h.page.wait_for_selector("#music-url-input", state="visible", timeout=15000)
    return h

def _player_radio(r, name, ch="1", path=None, **kw):
    c = r.code("E2M" + name[:2].upper())
    seed_agent(c, f"{name} Radio", player=f"radio {name}")
    p = r.device(name, code=c, cover=f"radio {name}", **kw)
    p.go(path or f"agent-hub.html?code={c}")
    p.page.wait_for_function("() => window.dgRadio && window.dgRadio.tune", timeout=20000)
    p.page.mouse.click(5, 5)  # the player's first tap on the page (lets audio start)
    p.js("(ch) => window.dgRadio.tune(ch)", ch)
    return p

def _playing(p, needle, timeout=20):
    """An <audio> for this file is playing: not paused and its time moving."""
    def moving():
        a = p.js(AUDIO_STATE, needle)
        if not a or a[0]["paused"]:
            return None
        t0 = a[0]["t"]
        time.sleep(1.2)
        b = p.js(AUDIO_STATE, needle)
        return b if b and not b[0]["paused"] and b[0]["t"] > t0 else None
    return wait_for(moving, timeout)


def s15_music_broadcast(r):
    """The Handler broadcasts a track: a tuned-in player hears it, pause and resume follow, a late joiner lands in sync, another channel stays silent, Stop ends it."""
    track = f"{BASE}/assets/ambient/haunted.mp3?e2e={RUN}"
    h = _handler_music(r, "1")
    a = _player_radio(r, "ann", "1")
    other = _player_radio(r, "oscar", "2")
    h.page.fill("#music-url-input", track)
    h.page.fill("#music-title-input", "E2E Theme")
    h.page.click("#music-set-btn")
    rd = wait_for(lambda: (doc("radio/1") or {}).get("track_url") == track and doc("radio/1"), 20) or {}
    r.check(rd.get("track_title") == "E2E Theme", "the broadcast is written to radio/1 (Handler-only rule)", json.dumps(rd)[:200])
    st = wait_for(lambda: (lambda s: s if s.get("track") == "E2E Theme" and s.get("live") else None)(a.js("() => window.dgRadio.state()")), 20) or {}
    r.check(bool(st), "the tuned-in player's radio shows the track, live", json.dumps(st)[:200])
    r.check(_playing(a, "haunted.mp3"), "…and it actually plays (time moving)", a.js(AUDIO_STATE, "haunted.mp3"))
    # A new device starts with its sound off until the player turns it on.
    r.check(a.js("() => window.dgRadio.state().muted") is True, "a new device starts with the radio's sound off (the player's choice)")
    a.js("() => window.dgRadio.setMuted(false)")
    r.check(wait_for(lambda: (lambda x: x if x and not x[0]["muted"] and x[0]["vol"] > 0 else None)(a.js(AUDIO_STATE, "haunted.mp3")), 10),
            "turning the sound on unmutes the playing track", a.js(AUDIO_STATE, "haunted.mp3"))
    time.sleep(1)
    r.check(not other.js(AUDIO_STATE, "haunted.mp3") and other.js("() => window.dgRadio.state().track") == "", "a player on channel 2 hears nothing")
    late = _player_radio(r, "lou", "1")
    lt = wait_for(lambda: (lambda x: x if x and x[0]["t"] > 3 else None)(late.js(AUDIO_STATE, "haunted.mp3")), 25)
    r.check(lt, "a player tuning in late joins mid-track, not from zero", late.js(AUDIO_STATE, "haunted.mp3"))
    h.page.click("#music-pause-btn")
    r.check(wait_for(lambda: a.js("() => window.dgRadio.state().paused") and all(x["paused"] for x in a.js(AUDIO_STATE, "haunted.mp3")), 15),
            "Pause on A-Cell pauses the player's audio", a.js(AUDIO_STATE, "haunted.mp3"))
    h.page.click("#music-pause-btn")
    r.check(_playing(a, "haunted.mp3"), "Resume plays it again", a.js(AUDIO_STATE, "haunted.mp3"))
    h.page.click("#music-stop-btn")
    r.check(wait_for(lambda: a.js("() => window.dgRadio.state().track") == "" and not any(not x["paused"] for x in a.js(AUDIO_STATE, "haunted.mp3")), 15),
            "Stop ends it on the player's side", a.js("() => window.dgRadio.state()"))


def s16_music_ambient_stinger_mix(r):
    """Ambient layers and stingers reach the player; the Handler's Music mix to 0 silences the track; the player's own mute holds."""
    h = _handler_music(r, "3")
    p = _player_radio(r, "amy", "3")
    h.page.fill("#music-url-input", f"{BASE}/assets/ambient/drone-low.mp3?e2e={RUN}")
    h.page.fill("#music-title-input", "Drone")
    h.page.click("#music-set-btn")
    r.check(_playing(p, "drone-low.mp3"), "the track plays")
    layer = h.js("() => { const b = document.querySelector('#music-ambient-grid [data-layer]'); if (!b) return null; b.click(); return b.getAttribute('data-layer'); }")
    r.check(layer and _playing(p, layer + ".mp3"), "an ambient layer the Handler starts plays for the player", layer)
    sting = h.js("() => { const b = document.querySelector('#music-stinger-groups [data-stinger]'); if (!b) return null; b.click(); return b.getAttribute('data-stinger'); }")
    r.check(sting and wait_for(lambda: p.js(AUDIO_STATE, sting + ".mp3"), 15), "a stinger the Handler fires reaches the player", sting)
    h.js("() => { const s = document.getElementById('music-mix-track'); s.value = 0; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); }")
    zero = wait_for(lambda: (lambda x: x if x and all(a["vol"] == 0 or a["muted"] for a in x) else None)(p.js(AUDIO_STATE, "drone-low.mp3")), 15)
    dbg = p.js("() => (document.getElementById('dg-radio-debug') || {}).textContent || ''")
    r.check(zero or "mix track=0" in dbg, "the Music mix at 0 silences the track on the player's side", f"{p.js(AUDIO_STATE, 'drone-low.mp3')} {dbg[:120]}")


def s17_music_survives_navigation(r):
    """In the Hub shell the radio keeps playing while the player moves between pages."""
    h = _handler_music(r, "4")
    p = _player_radio(r, "nav", "4", path="hub.html")
    h.page.fill("#music-url-input", f"{BASE}/assets/ambient/howling-city-bells.mp3?e2e={RUN}")
    h.page.fill("#music-title-input", "Bells")
    h.page.click("#music-set-btn")
    r.check(_playing(p, "howling-city-bells.mp3"), "the track plays in the Hub shell")
    t0 = p.js(AUDIO_STATE, "howling-city-bells.mp3")[0]["t"]
    for path in ("friendly.html", "agent-hub.html", "rules-reference.html"):
        p.js("(u) => { document.getElementById('dg-shell-content').src = u; }", path)
        time.sleep(2)
    a = p.js(AUDIO_STATE, "howling-city-bells.mp3")
    r.check(len(a) == 1 and not a[0]["paused"] and a[0]["t"] > t0 + 4, "after three page changes it's still the one track, still playing, not restarted", a)


def s18_character_deep_play(r):
    """A session's worth of character play on the Agent File, followed live by the Handler's A-Cell dossier."""
    c = r.code("E2CP")
    seed_agent(c, "Cora Pike", extra={"lpCheckedSkills": [{"type": "key", "key": "firearms"}]})
    p = r.device("player", code=c)
    open_agent(p, c)
    S = f"#ah-sheet-{c} "
    h = r.device("handler", width=1360, height=900, cover=None)
    handler_sign_in(h)
    h.page.wait_for_timeout(2500)
    h.js("(n) => { const b = [...document.querySelectorAll('#play-agent-list .play-agent-btn')].find(x => x.textContent.includes(n)); if (b) b.click(); }", "Cora Pike")
    # SAN loss through the post-it flow: 1D6 Violence.
    p.page.click(S + "[data-a=pop][data-pop=san]")
    p.page.click(S + "[data-a=san-go]")
    st = wait_for(lambda: (lambda x: x if x and x["derived"]["san"] < 60 else None)(character(c)), 20) or {}
    loss = 60 - st.get("derived", {}).get("san", 60)
    r.check(1 <= loss <= 6, "SAN loss 1D6 is rolled and taken off SAN", loss)
    viol = (st.get("sanity") or {}).get("violence") or []
    r.check(loss >= 5 or any(viol), "a loss under 5 ticks a Violence incident box", viol)
    if loss >= 5:
        r.check(wait_for(lambda: p.js("() => !!document.querySelector('#ap-posts > *')"), 10), "…a loss of 5+ brings the temporary-insanity post-it")
    p.js("() => document.querySelectorAll('#ap-posts button').forEach(b => b.click())")
    # Improvement roll on the marked skill.
    p.page.click(S + "[data-a=improve]")
    imp = wait_for(lambda: (lambda x: x if x and (x.get("skills") or {}).get("firearms", 50) > 50 else None)(character(c)), 20) or {}
    gain = (imp.get("skills") or {}).get("firearms", 50) - 50
    r.check(1 <= gain <= 4 and not (imp.get("lpCheckedSkills") or []), "Roll improvements adds 1D4 to the marked skill and clears the mark", gain)
    p.js("() => document.querySelectorAll('#ap-posts button').forEach(b => b.click())")
    # Bonds: − and a new one at CHA.
    p.page.click(S + "[data-a='bond-']")
    p.page.click(S + "[data-a=pop][data-pop=bond]")
    p.page.fill(S + "[data-u=bond-name]", "Father Ruiz")
    p.page.fill(S + "[data-u=bond-rel]", "Priest")
    p.page.click(S + "[data-a=bond-add]")
    bonds = wait_for(lambda: (lambda b: b if len(b) == 2 else None)((character(c) or {}).get("bonds") or []), 20) or []
    r.check(bonds and bonds[0]["score"] == 10 and bonds[1]["name"] == "Father Ruiz" and bonds[1]["score"] == 11, "a Bond − and a new Bond at CHA are saved",
            {"saved": (character(c) or {}).get("bonds"), "local": p.js(f"() => dgAgentLive.get('{c}').state.bonds"),
             "status": p.js(f"() => dgAgentLive.get('{c}').status"), "posts": p.js("() => (document.getElementById('ap-posts') || {}).innerText || ''")[:120]})
    # Edit: CON up raises max HP; the Oath files it.
    p.page.click(S + "[data-a=edit]")
    p.page.fill(S + "[data-e='stat:CON']", "16")
    p.page.press(S + "[data-e='stat:CON']", "Tab")
    p.page.click(S + "[data-a=save]")
    p.page.wait_for_selector("#fn-orders", timeout=10000)
    p.page.keyboard.press("Enter")
    p.page.keyboard.press("y")
    wait_for(lambda: (character(c) or {}).get("stats", {}).get("CON") == 16, 15)
    r.check((character(c) or {}).get("stats", {}).get("CON") == 16, "Edit: a statistic changed and filed with the Oath")
    # HP − on the player's side shows on the Handler's dossier.
    p.page.click(S + "[data-a='hp-']")
    hp = (character(c) or {}).get("derived", {}).get("hp")
    seen = wait_for(lambda: "Cora Pike" in h.screen_text() and str((character(c) or {}).get("derived", {}).get("hp")) in h.js("() => (document.getElementById('play-view') || {}).innerText || ''"), 20)
    r.check(seen, "the Handler's A-Cell dossier follows the player's HP live", hp)
    # The notebook's Agent File on the same page shows the same state.
    p.js("() => window.dgFieldNotes.open('agentfile')")
    nb = wait_for(lambda: p.js("() => { const v = document.querySelector('#fn-veil .ap-vitals'); return v ? v.innerText : ''; }"), 15) or ""
    r.check(str((character(c) or {}).get("derived", {}).get("san")) in nb, "the notebook's Agent File shows the same SAN as Agent Hub", nb[:80])


SCENARIOS = [
    ("s01", "New player builds an Agent on a phone and signs the Contract", s01_new_recruit),
    ("s02", "Handler makes a Cell; an open player page follows live", s02_handler_cell_live),
    ("s03", "In play: SAN to 0, HP to 0, Edit with Oath N and Y", s03_play_san_kia_oath),
    ("s04", "One Agent on two devices at once", s04_two_devices_same_agent),
    ("s05", "The connection drops mid-play", s05_offline_mid_save),
    ("s06", "Restricted Evidence stays with its Agent", s06_evidence_restricted),
    ("s07", "The Handler deletes an Agent their player has open", s07_handler_deletes_open_agent),
    ("s08", "Every import format, saved for real", s08_imports_real_rules),
    ("s09", "Old character-sheet bookmarks", s09_old_links),
    ("s10", "Private mode: storage throws", s10_private_mode),
    ("s11", "iPhone home-screen app: no native dialogs", s11_ios_standalone),
    ("s12", "A returning device with the previous release cached", s12_returning_device),
    ("s13", "A roll reaches the Cell's feed and the Handler", s13_dice_to_cell_and_handler),
    ("s15", "Music: broadcast, pause/resume, late joiner, channels, Stop", s15_music_broadcast),
    ("s16", "Music: ambient layers, stingers, the mix", s16_music_ambient_stinger_mix),
    ("s17", "Music keeps playing across Hub page changes", s17_music_survives_navigation),
    ("s18", "Character: a session's play, followed live by the Handler", s18_character_deep_play),
    # Last: it loads real Agents (with photo links to the live bucket) into the emulator.
    ("s14", "Every live Agent replayed (read-only snapshot)", s14_replay_live_data),
]


def report(results):
    os.makedirs(OUT, exist_ok=True)
    json.dump(results, open(os.path.join(OUT, "report.json"), "w"), indent=1)
    lines = [f"# E2E report ({ENGINE}, run {RUN})", "",
             f"{sum(1 for x in results if x['ok'])}/{len(results)} scenarios passed.", ""]
    for x in results:
        lines.append(f"## {'PASS' if x['ok'] else 'FAIL'} {x['id']} {x['title']} ({x['secs']}s)")
        for c in x["checks"]:
            lines.append(f"- {'ok' if c['ok'] else '**FAIL**'} {c['what']}" + (f" -- `{c['detail'][:200]}`" if not c["ok"] and c["detail"] else ""))
        lines.append("")
    open(os.path.join(OUT, "report.md"), "w").write("\n".join(lines))


def main():
    with sync_playwright() as p:
        run = Run(p)
        for sid, title, fn in SCENARIOS:
            run.scenario(sid, title, fn)
        report(run.results)
        run.browser.close()
    bad = [x for x in run.results if not x["ok"]]
    print(f"=== {len(run.results) - len(bad)}/{len(run.results)} scenarios passed ===")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
