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
import json
from types import SimpleNamespace
import re, os, sys, time, subprocess
from playwright.sync_api import sync_playwright

BASE = os.environ.get("DG_TEST_BASE", "http://127.0.0.1:8949")
HERE = os.path.dirname(os.path.abspath(__file__))
AGENTS = json.load(open(os.path.join(HERE, "mock-agents.json")))
RESULTS_PATH = os.path.join(HERE, "results.json")

results = []

def record(area, name, ok, detail=""):
    # A detail that isn't plain JSON (e.g. a re.Match) used to crash the
    # results.json write at the very end of a full run.
    if not isinstance(detail, (str, int, float, bool, type(None))):
        detail = str(detail)
    ok = bool(ok)
    results.append({"area": area, "name": name, "ok": ok, "detail": detail})
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {area} :: {name}" + (f" -- {detail}" if detail and not ok else ""))

# Every field #dg-form itself marks required, not just a handful --
# isProfilingComplete() (dg-agent-portal.html) gates the Agent File tab on
# all of them being non-empty, so a fixture missing any of these would
# silently redirect every test expecting to land on Agent File back to
# Profiling instead.
MOCK_BRIEF = {
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

def mock_routes(page):
    def fake_apps_script(route):
        url = route.request.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            body = f'{cb}({json.dumps({"status": "OK", "data": MOCK_BRIEF})})'
            route.fulfill(status=200, content_type="application/javascript", body=body)
        else:
            route.fulfill(status=200, content_type="application/json",
                           body=json.dumps({"status": "OK", "mock": True}))
    def fake_anthropic(route):
        route.fulfill(status=200, content_type="application/json",
                       body=json.dumps({"content": [{"text": "[mocked cinematic prompt]"}]}))
    # The Agent File reads briefs/{code} from Firestore now: any code a
    # test types in answers with the same Mock Loaded Agent (unless the
    # test seeded or wrote a real doc there), and the AI functions give
    # the same canned prompt.
    install_notes_firestore_stub(page)
    page.add_init_script("""
        (function () {
          var FAKE = %s;
          window.__dgBackendHook = function (kind, arg) {
            if (kind === 'get') {
              if (arg.indexOf('briefs/') === 0 && !(arg in (window.__dgFirestoreDocs || {}))) return FAKE;
              return '__local__';
            }
            if (kind === 'call') {
              (window.__dgFunctionCalls = window.__dgFunctionCalls || []).push(arg);
              return arg.name === 'generatePrompt'
                ? { status: 'OK', prompt: '[mocked cinematic prompt]' }
                : { status: 'OK', image_base64: 'data:image/png;base64,iVBORw0KGgo=' };
            }
          };
        })();
    """ % json.dumps(MOCK_BRIEF))
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
    # v3.12.0: the classic broadcast desk is folded under the Music tab's
    # control center; the older radio tests drive its controls, so unfold it.
    page.add_init_script("try { if (localStorage.getItem('dg_acell_classic_open') === null) localStorage.setItem('dg_acell_classic_open', '1'); } catch (e) {}")

def route_apps_script_ok(page):
    """A catch-all "**/script.google.com/** always says OK" mock for
    tests that don't care about backend content at all, just that
    nothing errors -- JSONP-aware, unlike a bare
    `lambda r: r.fulfill(..., body='{"status":"OK"}')` (14 near-
    identical copies of that used to be scattered across this file). A
    JSONP call is a <script src=...&callback=X> tag whose response gets
    parsed and RUN as JavaScript, not fetched as data -- a bare JSON
    body loaded that way throws "Unexpected token ':'" the instant the
    parser hits the first key's colon (`{"status":...` parses as a
    block statement containing the expression statement "status",
    followed by an unexpected `:`). Silently wrong in this sandbox,
    which fails such calls before they'd ever reach a route handler
    that no page actually needed here -- surfaces as a real pageerror
    in CI, on whichever of these 14 call sites happens to have a page
    that actually makes one."""
    def handler(route):
        url = route.request.url
        if route.request.method == "POST" or "callback=" not in url:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        cb = url.split("callback=")[1].split("&")[0]
        route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps({"status": "OK"})})')
    page.route("**/script.google.com/**", handler)

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

# ── Field Notes notebook (assets/field-notes.js) ─────────────────────
# The notebook holds the Dice Roller panel and the Table Radio on every
# player page. The helper below reaches those controls the way the older
# widget tests expect.
def notebook_aside(page):
    """Puts the page's legacy floating widgets (Table Radio pill, Dice
    panel) back on screen, exactly as the notebook does on A-Cell -- for
    tests of those widgets' own behavior, which the notebook reuses."""
    page.wait_for_function("() => !!window.dgFieldNotes", timeout=10000)
    page.evaluate("""() => {
      document.documentElement.classList.remove('dg-fn-host');
      const root = document.getElementById('fn-root'); if (root) root.hidden = true;
      const p = document.getElementById('dr-panel'); if (p && p.parentNode !== document.body) document.body.appendChild(p);
    }""")

# ── Table Radio's Firestore listener (assets/table-radio.js, Firebase
# migration Phase 2) -- a minimal in-page fake of the compat SDK surface
# table-radio.js actually calls (firebase.firestore().collection('radio')
# .doc(ch).onSnapshot(success, error)), installed via add_init_script so
# it's already in place, with window.firebase.apps already non-empty,
# before ensureFirebaseApi() runs -- that makes it take the "already
# initialized" branch and call its callback synchronously, so no real
# network request to gstatic.com ever happens. Registers each listener
# into window.__dgRadioListeners keyed by channel but does NOT auto-fire
# a snapshot on subscribe (unlike a real Firestore listener's immediate
# first callback) -- tests instead deliver data on their own schedule via
# push_radio_now_playing()/push_radio_listener_error() below, which is
# what actually lets a test simulate "nothing has arrived yet" or "an
# error came back" without racing a real listener's timing.
RADIO_FIRESTORE_STUB = """
(function () {
  window.__dgRadioListeners = {};
  window.firebase = {
    apps: [{}],
    initializeApp: function () {},
    firestore: function () {
      return {
        collection: function () {
          return {
            doc: function (id) {
              return {
                onSnapshot: function (success, error) {
                  window.__dgRadioListeners[id] = { success: success, error: error };
                  return function () { delete window.__dgRadioListeners[id]; };
                }
              };
            }
          };
        }
      };
    }
  };
})();
"""

def install_radio_firestore_stub(page):
    page.add_init_script(RADIO_FIRESTORE_STUB)

def push_radio_now_playing(page, channel, data):
    """Delivers a fake radio/{channel} Firestore snapshot to whichever
    listener table-radio.js currently has registered for that channel
    (must be called after the widget has actually subscribed -- e.g.
    after the page/reload that tunes it in, or after a live in-page
    channel change). data=None means the document doesn't exist (no
    broadcast on that channel yet)."""
    page.evaluate(
        """([channel, data]) => {
            var l = window.__dgRadioListeners && window.__dgRadioListeners[channel];
            if (!l) throw new Error('no radio listener registered for channel ' + channel);
            l.success({ exists: data != null, data: function () { return data; } });
        }""",
        [channel, data],
   )

def push_radio_listener_error(page, channel):
    """Delivers a fake Firestore listener error (a transient miss --
    network hiccup, permission blip, whatever) to the given channel's
    listener, same as push_radio_now_playing but down the error path."""
    page.evaluate(
        """(channel) => {
            var l = window.__dgRadioListeners && window.__dgRadioListeners[channel];
            if (!l) throw new Error('no radio listener registered for channel ' + channel);
            l.error(new Error('fake transient listener error'));
        }""",
        channel,
   )

# ── Notes/Evidence-in-Notes Firestore listeners (notes/notes.js,
# Firebase migration Phase 5) -- a more general stub than
# RADIO_FIRESTORE_STUB above: content here is a COLLECTION query
# (cells/{cellId}/notes with a .where() clause, or evidence with its
# own .where()), not one fixed document, and startNotesListeners()/
# startEvidenceListener() both sit behind a fake Auth+Functions
# sign-in (ensureAgentSignedIn() -- exchangeAgentToken) neither of
# Radio's listeners need. This was missing entirely until diagnosed as
# the real cause of ~35 CI failures in the Notes area: the old mock
# only faked the Apps Script JSONP endpoint, but notes.js's own code
# comment says it plainly -- list_cell_notes is "reused purely for its
# bundled identities map, discarding res.notes now that the two
# [Firestore] listeners above own note content." The JSONP mock's note/
# evidence data was silently never reaching the app at all.
#
# Also covers a-cell.html's Handler-side Evidence listener (orderBy(),
# not where()) and Handler auth (handlerLogin), plus agent-hub.html's
# per-Agent Handouts/Evidence listener -- same Phase 5 migration, same
# gap, different UI surfaces, diagnosed later than the Notes one above.
# Storage is Phase 4's own separate migration (Track Library / Evidence
# photo direct-to-Storage uploads) but reuses this same stub/install
# function since every affected test needs both.
#
# window.__dgFirestoreListeners is a flat list (not keyed by a single
# id like Radio's) since a listener here is identified by its full
# collection path plus its exact .where()/.orderBy() chain, not one
# channel name.
NOTES_FIRESTORE_STUB = """
(function () {
  window.__dgFirestoreListeners = [];
  window.__dgFirestoreAuthUser = null;
  window.__dgStorageUploads = [];
  // Doc-level writes (set/update/delete) a test can inspect the same
  // way `posts` inspects Apps Script POSTs -- for surfaces that write
  // straight to Firestore from the client instead of going through
  // Apps Script at all (Track Library, ambient/stinger soundboard).
  // Doesn't feed a listener automatically: a test still calls
  // push_firestore_snapshot() itself to simulate the write having
  // landed and the listener having picked it up, same as every other
  // use of this stub.
  window.__dgFirestoreWrites = [];

  function makeQuery(path, wheres) {
    return {
      where: function (field, op, value) { return makeQuery(path, wheres.concat([[field, op, value]])); },
      orderBy: function () { return makeQuery(path, wheres); },
      limit: function () { return makeQuery(path, wheres); },
      // One-time read (assets/dice-roller.js's resolveRollContext() reads
      // `cells` this way, not via onSnapshot) -- reads straight off the
      // same in-memory doc store docRef.set()/runTransaction() already
      // write to, so a test can seed a Cell via push_firestore_snapshot()
      // OR via a plain docRef.set() and have .get() see either. Ignores
      // `wheres` (no test needs a real filtered query yet).
      // '==' and 'array-contains-any' where() clauses are honoured
      // (dgStore's Load My Agents / handout notes / seen-mark queries).
      get: function () {
        // Every query read, so a test can count lookups (retries etc.).
        (window.__dgFsQueries = window.__dgFsQueries || []).push({ path: path, wheres: wheres });
        if (window.__dgFsHang) return new Promise(function () {});
        if (window.__dgFsFail) return Promise.reject(new Error('stub: Firestore unavailable'));
        var prefix = path + '/';
        var docs = Object.keys(window.__dgFirestoreDocs || {})
          .filter(function (p) { return p.indexOf(prefix) === 0 && p.slice(prefix.length).indexOf('/') === -1; })
          .filter(function (p) {
            var d = window.__dgFirestoreDocs[p] || {};
            return wheres.every(function (w) {
              if (w[1] === '==') return d[w[0]] === w[2];
              if (w[1] === 'array-contains-any') return Array.isArray(d[w[0]]) && d[w[0]].some(function (x) { return w[2].indexOf(x) !== -1; });
              return true;
            });
          })
          .map(function (p) { return { id: p.slice(prefix.length), ref: makeCollectionRef(path).doc(p.slice(prefix.length)), data: function () { return window.__dgFirestoreDocs[p]; } }; });
        return Promise.resolve({ forEach: function (fn) { docs.forEach(fn); }, docs: docs, empty: docs.length === 0 });
      },
      onSnapshot: function (success, error) {
        var entry = { path: path, wheres: wheres, success: success, error: error };
        window.__dgFirestoreListeners.push(entry);
        return function () {
          var i = window.__dgFirestoreListeners.indexOf(entry);
          if (i !== -1) window.__dgFirestoreListeners.splice(i, 1);
        };
      }
    };
  }
  // Tiny in-memory doc store, keyed by full path -- backs plain
  // docRef.get()/.set() AND runTransaction()'s tx.get()/tx.set() below
  // with the SAME state, so a-cell.html's read-modify-write soundboard
  // transactions (ambient/stinger toggle/fire/pause/resume/seek/loop/
  // stop) see their own previous write on the next call, the same way
  // real Firestore would. No real transactional isolation (single-
  // threaded JS test, nothing else can interleave) -- just persistence.
  window.__dgFirestoreDocs = {};
  function docSnapshot(docPath) {
    var exists = Object.prototype.hasOwnProperty.call(window.__dgFirestoreDocs, docPath);
    return { exists: exists, id: docPath.split('/').pop(), data: function () { return window.__dgFirestoreDocs[docPath]; } };
  }
  // Real Firestore refuses an Array or object made in another frame (a
  // notebook page's iframe handing data to the parent's SDK): "Unsupported
  // field value: a custom Array object". The stub refuses it too.
  function foreign(v, path) {
    if (Array.isArray(v)) {
      if (!(v instanceof Array)) return path || '(root)';
      for (var i = 0; i < v.length; i++) { var f = foreign(v[i], path + '[' + i + ']'); if (f) return f; }
    } else if (v && typeof v === 'object' && !(v instanceof Date)) {
      var proto = Object.getPrototypeOf(v);
      if (proto && proto !== Object.prototype && Object.getPrototypeOf(proto) === null && proto.constructor && proto.constructor.name === 'Object') return path || '(root)';
      for (var k in v) { if (Object.prototype.hasOwnProperty.call(v, k)) { var g = foreign(v[k], path ? path + '.' + k : k); if (g) return g; } }
    }
    return '';
  }
  function writeDoc(op, docPath, data, opts) {
    var bad = op === 'delete' ? '' : foreign(data, '');
    if (bad) throw new Error('Function DocumentReference.set() called with invalid data. Unsupported field value: a custom Array object (found in field ' + bad + ' in document ' + docPath + ')');
    window.__dgFirestoreWrites.push({ op: op, path: docPath, data: data, opts: opts });
    if (op === 'delete') { delete window.__dgFirestoreDocs[docPath]; }
    else if (op === 'update' || (opts && opts.merge)) {
      window.__dgFirestoreDocs[docPath] = Object.assign({}, window.__dgFirestoreDocs[docPath] || {}, data);
    } else {
      window.__dgFirestoreDocs[docPath] = data;
    }
    if (window.__dgBackendHook) {
      try { window.__dgBackendHook('write', { op: op, path: docPath, data: data || null }); } catch (e) {}
    }
    // install_firestore_backend(): the store outlives a navigation in
    // this tab, like a real backend would.
    if (window.__dgFsPersist) {
      try { sessionStorage.setItem('__dgFsDocs', JSON.stringify(window.__dgFirestoreDocs)); } catch (e) {}
    }
  }
  var _dgAutoIdCounter = 0;
  function makeCollectionRef(path) {
    var q = makeQuery(path, []);
    // Auto-ID create -- assets/dice-roller.js's recordRoll() is the only
    // caller of this today (dice_rolls/{cellId}/rolls), a plain
    // Firestore addDoc()-equivalent that mints its own id rather than
    // the caller picking one via .doc(id).set(). Deterministic per-page
    // counter is enough for a test to find what it wrote afterward.
    q.add = function (data) {
      var id = 'auto_' + (++_dgAutoIdCounter);
      var docPath = path + '/' + id;
      writeDoc('set', docPath, data);
      return Promise.resolve({ id: id });
    };
    q.doc = function (id) {
      var docPath = path + '/' + id;
      return {
        __path: docPath,
        collection: function (name) { return makeCollectionRef(docPath + '/' + name); },
        get: function () {
          // __dgFsHang / __dgFsFail: a test can make every read never
          // answer, or fail, to exercise loading gates and error paths.
          if (window.__dgFsHang) return new Promise(function () {});
          if (window.__dgFsFail) return Promise.reject(new Error('stub: Firestore unavailable'));
          // __dgFsFailGet(path): only this one-shot read fails (a phone's
          // "client is offline"); its listeners still work.
          if (window.__dgFsFailGet && window.__dgFsFailGet(docPath)) return Promise.reject(new Error('Failed to get document because the client is offline.'));
          // _route_backend(): a test's Python respond() answers reads of
          // characters/ and briefs/ ('__local__' = use this store).
          if (window.__dgBackendHook) {
            return Promise.resolve(window.__dgBackendHook('get', docPath)).then(function (r) {
              if (r === '__local__') return docSnapshot(docPath);
              return { exists: r != null, id: docPath.split('/').pop(), data: function () { return r; } };
            });
          }
          return Promise.resolve(docSnapshot(docPath));
        },
        set: function (data, opts) {
          try { writeDoc('set', docPath, data, opts); } catch (e) { return Promise.reject(e); }
          return Promise.resolve();
        },
        update: function (data) {
          writeDoc('update', docPath, data);
          return Promise.resolve();
        },
        delete: function () {
          writeDoc('delete', docPath);
          return Promise.resolve();
        },
        // Single-doc listener (agent-hub.html's characters/{code} DEX
        // post-it, etc.) -- a different shape from the collection-query
        // listeners above (a lone doc snapshot has .exists/.data(), not
        // .forEach()), so tracked separately via isDoc rather than
        // reusing the collection entry shape.
        onSnapshot: function (success, error) {
          var entry = { path: docPath, isDoc: true, success: success, error: error };
          window.__dgFirestoreListeners.push(entry);
          // __dgFsListenNow: answer a new doc listener with what's stored,
          // as the real SDK does; __dgFsListenError(path): fail it instead.
          if (window.__dgFsListenError && window.__dgFsListenError(docPath)) setTimeout(function () { if (error) error(new Error('stub: listener failed')); }, 0);
          else if (window.__dgFsListenNow) setTimeout(function () { if (window.__dgFirestoreListeners.indexOf(entry) !== -1) success(docSnapshot(docPath)); }, 0);
          return function () {
            var i = window.__dgFirestoreListeners.indexOf(entry);
            if (i !== -1) window.__dgFirestoreListeners.splice(i, 1);
          };
        }
      };
    };
    return q;
  }

  window.firebase = {
    apps: [{}],
    initializeApp: function () {},
    // a-cell.html's canonicalTrackUrl_() reads options.storageBucket off
    // this to rebuild a Storage-hosted track's URL -- see Track
    // Library's own self-heal comment there.
    app: function () { return { options: { storageBucket: 'fake-bucket.appspot.com' } }; },
    firestore: function () {
      return {
        settings: function () {},
        collection: function (name) { return makeCollectionRef(name); },
        // Handler Live Rolls (dice-roller.js): every Cell's rolls at once.
        collectionGroup: function (name) { return makeQuery('group:' + name, []); },
        // a-cell.html's soundboard writes straight to Firestore via
        // db.runTransaction(fn(tx) => tx.get(docRef).then(...tx.set...)) --
        // no real transactional isolation here (see docSnapshot/writeDoc
        // above), just the same read-then-write shape against the same
        // backing store a plain docRef.get()/.set() would use.
        runTransaction: function (updateFn) {
          var tx = {
            get: function (docRef) { return Promise.resolve(docSnapshot(docRef.__path)); },
            set: function (docRef, data, opts) { writeDoc('set', docRef.__path, data, opts); },
            update: function (docRef, data) { writeDoc('update', docRef.__path, data); },
            delete: function (docRef) { writeDoc('delete', docRef.__path); }
          };
          return Promise.resolve(updateFn(tx));
        },
        batch: function () {
          var ops = [];
          return {
            set: function (ref, data, opts) { ops.push(['set', ref.__path, data, opts]); },
            update: function (ref, data) { ops.push(['update', ref.__path, data]); },
            delete: function (ref) { ops.push(['delete', ref.__path]); },
            commit: function () { ops.forEach(function (o) { writeDoc(o[0], o[1], o[2], o[3]); }); return Promise.resolve(); }
          };
        }
      };
    },
    auth: function () {
      return {
        get currentUser() { return window.__dgFirestoreAuthUser; },
        // dice-roller.js's Handler mode (checkExistingHandlerSession) --
        // reachable in tests only since that mode's session key was fixed.
        onAuthStateChanged: function (cb) {
          setTimeout(function () { cb(window.__dgFirestoreAuthUser || null); }, 0);
          return function () {};
        },
        signInWithCustomToken: function (token) {
          // getIdToken() is real code's only way to get the id_token it
          // now sends on every Handler-gated Apps Script write (see
          // getHandlerIdToken_() in a-cell.html) -- without this mock
          // method, that call throws "getIdToken is not a function" and
          // every such write silently never fires under test.
          //
          // getIdTokenResult() is ensureHandlerSignedIn()'s/
          // ensureAgentSignedIn()'s own re-check that an already-cached
          // session still actually carries its claim (see either
          // function's own comment on the stale-claims regression this
          // guards against) -- a real signInWithCustomToken() always
          // mints a token carrying whatever claims the custom token
          // had, so this mock reports the claim matching whichever
          // identity actually signed in, same as a genuinely fresh
          // sign-in would.
          window.__dgFirestoreAuthUser = {
            uid: token,
            getIdToken: function () { return Promise.resolve('fake-id-token-' + token); },
            getIdTokenResult: function () {
              return Promise.resolve({ claims: token === 'handler' ? { handler: true } : { agentCode: token } });
            }
          };
          return Promise.resolve({ user: window.__dgFirestoreAuthUser });
        }
      };
    },
    functions: function () {
      return {
        httpsCallable: function (name) {
          return function (payload) {
            if (name === 'exchangeAgentToken') return Promise.resolve({ data: { token: payload.agent_code } });
            // Actually checks the password now (real handlerLogin does
            // too, see functions/index.js) rather than always succeeding
            // -- needed once the Clearance gate itself started calling
            // this directly (see BUGFIXES.md), so a wrong-password test
            // has something real to fail against. 'testpw' is the value
            // every test's own add_init_script pre-seeds dg_acell_pw
            // with.
            if (name === 'handlerLogin') {
              if (payload && payload.handler_password === 'testpw') return Promise.resolve({ data: { token: 'handler' } });
              return Promise.reject({ message: 'invalid Handler password' });
            }
            // The Agent File's AI (Cloud Functions now) -- canned replies,
            // recorded so a test can see what was asked.
            if ((name === 'generatePrompt' || name === 'generatePlateImage') && window.__dgBackendHook) {
              return Promise.resolve(window.__dgBackendHook('call', { name: name, payload: payload })).then(function (r) { return { data: r }; });
            }
            if (name === 'generatePrompt' || name === 'generatePlateImage') {
              (window.__dgFunctionCalls = window.__dgFunctionCalls || []).push({ name: name, payload: payload });
              return Promise.resolve({ data: name === 'generatePrompt'
                ? { status: 'OK', prompt: 'STUB PROMPT' }
                : { status: 'OK', image_base64: 'data:image/png;base64,iVBORw0KGgo=' } });
            }
            // A-Cell's Evidence translation (canned like the emulator's).
            if (name === 'translateEvidence') {
              (window.__dgFunctionCalls = window.__dgFunctionCalls || []).push({ name: name, payload: payload });
              return Promise.resolve({ data: { status: 'OK', title: '[' + payload.to + '] ' + payload.title, body: payload.body ? '[' + payload.to + '] ' + payload.body : '' } });
            }
            // The New Recruit wizard's Bond description (canned, recorded).
            if (name === 'generateBondDescription') {
              (window.__dgFunctionCalls = window.__dgFunctionCalls || []).push({ name: name, payload: payload });
              return Promise.resolve({ data: { status: 'OK', description: 'STUB BOND: ' + ((payload && payload.bond && payload.bond.name) || '') } });
            }
            return Promise.resolve({ data: {} });
          };
        }
      };
    },
    storage: function () {
      // Objects "in the bucket": tests may seed window.__dgStorageFiles
      // (paths); uploads land there too. listAll() lists a folder.
      function files() { return (window.__dgStorageFiles = window.__dgStorageFiles || []); }
      function mk(path) {
        return { fullPath: path, name: path.split('/').pop(), getDownloadURL: function () { return Promise.resolve('https://fake-storage.example/' + path); } };
      }
      return {
        ref: function (path) {
          return {
            fullPath: path, name: String(path).split('/').pop(),
            put: function (file, opts) {
              // A dropped connection: tests set __dgStorageFail to fail the next N uploads.
              if ((window.__dgStorageFail || 0) > 0) { window.__dgStorageFail--; return Promise.reject(new Error('storage/retry-limit-exceeded')); }
              if (files().indexOf(path) === -1) files().push(path);
              window.__dgStorageUploads.push({ path: path, file: file, opts: opts });
              return Promise.resolve({
                ref: { getDownloadURL: function () { return Promise.resolve('https://fake-storage.example/' + path); } }
              });
            },
            delete: function () { return Promise.resolve(); },
            // syncOrphanedStorageTracks_() in a-cell.html calls this on
            // every Music tab load to find a Storage object with no
            // Firestore doc -- empty by default (no test currently
            // exercises the recovery path itself), just enough surface
            // for that call to resolve instead of throwing.
            listAll: function () {
              var pre = String(path).replace(/\/$/, '') + '/', items = [], subs = {};
              files().forEach(function (f) {
                if (f.indexOf(pre) !== 0) return;
                var rest = f.slice(pre.length);
                if (rest.indexOf('/') === -1) items.push(mk(f)); else subs[rest.split('/')[0]] = 1;
              });
              var self = this;
              return Promise.resolve({ items: items, prefixes: Object.keys(subs).map(function (n) { return window.firebase.storage().ref(pre + n); }) });
            },
            getDownloadURL: function () { return Promise.resolve('https://fake-storage.example/' + path); }
          };
        }
      };
    }
  };
})();
"""

def install_notes_firestore_stub(page):
    # Once per page: a second copy would re-create an empty doc store
    # (and a fresh window.firebase) after anything seeded in between.
    if getattr(page, "_dg_fs_stub", False):
        return
    page._dg_fs_stub = True
    page.add_init_script(NOTES_FIRESTORE_STUB)

def install_firestore_backend(page, docs=None):
    """The app's backend is Firestore now (the Sheet is retired): installs
    the in-page Firestore stub and seeds documents, keyed by full path
    ('characters/CODE', 'briefs/CODE', ...). Call before page.goto().
    What pages write persists across navigations in this tab (seeds are
    applied once), like a real backend."""
    install_notes_firestore_stub(page)
    page.add_init_script("""
        window.__dgFsPersist = true;
        try {
          var kept = JSON.parse(sessionStorage.getItem('__dgFsDocs') || 'null');
          if (kept) Object.assign(window.__dgFirestoreDocs, kept);
          else Object.assign(window.__dgFirestoreDocs, %s);
          sessionStorage.setItem('__dgFsDocs', JSON.stringify(window.__dgFirestoreDocs));
        } catch (e) { Object.assign(window.__dgFirestoreDocs, %s); }
    """ % (json.dumps(docs or {}), json.dumps(docs or {})))

def tap_acell_posts(page, on_post):
    """A-Cell's Handler writes go through window.dgAcellApi.post(payload)
    (Firestore now, not an Apps Script POST). Calls on_post(payload) in
    Python for each one, before the real write runs -- so a test keeps
    its old `posts` list and any state it mutates per action."""
    def _cb(payload):
        try:
            on_post(payload)
        except Exception as e:
            print("tap_acell_posts: on_post raised", e)
    page.expose_function("__dgPyAcellPost", _cb)
    page.add_init_script("""
        (function () {
          var real;
          Object.defineProperty(window, 'dgAcellApi', {
            configurable: true,
            get: function () { return real; },
            set: function (api) {
              var post = api.post;
              api.post = function (payload) {
                var args = arguments, self = this;
                var copy = JSON.parse(JSON.stringify(payload || {}));
                delete copy.id_token;
                return Promise.resolve(window.__dgPyAcellPost(copy)).then(function () {
                  return post.apply(self, args);
                });
              };
              real = api;
            }
          });
        })();
    """)

def character_doc(code, state, player_name=None):
    """A characters/{code} document the way dgStore.saveCharacter writes it."""
    pn = player_name if player_name is not None else (state.get("bio", {}) or {}).get("player_name", "")
    return {"agent_code": code, "character_json": json.dumps(state), "updated_at": "2026-09-01T00:00:00.000Z",
            "player_name": pn, "player_name_lc": (pn or "").strip().lower()}

def fs_writes(page, prefix):
    """Every stubbed Firestore write whose path starts with prefix, oldest first."""
    return page.evaluate("(pfx) => (window.__dgFirestoreWrites || []).filter(w => w.path.indexOf(pfx) === 0)", prefix)

def fs_doc(page, path):
    """The stubbed Firestore document at path, or None."""
    return page.evaluate("(p) => (window.__dgFirestoreDocs || {})[p] || null", path)

def seed_cells_docs(page, cells_list):
    """Seeds the `cells/{cellId}` doc store directly (window.__dgFirestoreDocs),
    for notes/notes.js's getAllCellsOnce() -- a one-time .get() on the
    `cells` collection, not an onSnapshot -- to see on page load. Must be
    called before page.goto() (uses add_init_script); install_notes_firestore_stub()
    must have already been called on this same page so __dgFirestoreDocs
    exists for this to populate. cells_list is a list of dicts each
    needing a 'cell_id' key plus whatever fields a real Cell doc has
    (name/handler/member_codes/channel)."""
    docs = {}
    for c in cells_list:
        data = dict(c)
        cell_id = data.pop("cell_id")
        docs["cells/" + cell_id] = data
    page.add_init_script(
        "window.__dgFirestoreDocs = Object.assign(window.__dgFirestoreDocs || {}, " + json.dumps(docs) + ");"
   )

def seed_characters_docs(page, characters_list):
    """Seeds the `characters/{agentCode}` doc store directly, for
    notes/notes.js's getAllCellsOnce() -- a one-time .get() on the
    `characters` collection (used purely for Cell member_names/display-
    name resolution), not an onSnapshot. Must be called after
    install_notes_firestore_stub() on this page, before page.goto().
    characters_list is a list of dicts with 'agent_code' and 'name'."""
    docs = {}
    for c in characters_list:
        docs["characters/" + c["agent_code"]] = {"character_json": json.dumps({"bio": {"name": c["name"]}})}
    page.add_init_script(
        "window.__dgFirestoreDocs = Object.assign(window.__dgFirestoreDocs || {}, " + json.dumps(docs) + ");"
   )

def notes_firestore_listener_count(page):
    return page.evaluate("() => (window.__dgFirestoreListeners || []).length")

def firestore_writes(page, path_prefix=None):
    """Returns every doc-level Firestore write (set/update/delete) the
    page has made through the stub above, optionally filtered to paths
    starting with path_prefix (e.g. 'tracks/'). For surfaces that write
    straight to Firestore instead of going through Apps Script."""
    writes = page.evaluate("() => window.__dgFirestoreWrites || []")
    if path_prefix is None:
        return writes
    return [w for w in writes if w["path"].startswith(path_prefix)]

def clear_firestore_writes(page):
    """Empties window.__dgFirestoreWrites -- same role as a plain Python
    `posts.clear()` on an Apps Script `posts` list, for a test that wants
    to isolate "the write my NEXT action makes" from everything already
    accumulated (writes never expire from the stub's own list otherwise,
    unlike a fresh Apps Script POST capture per test)."""
    page.evaluate("() => { window.__dgFirestoreWrites = []; }")

def get_firestore_doc(page, path):
    """Reads the stub's own in-memory doc store (window.__dgFirestoreDocs)
    at the given full path (e.g. 'radio/1') -- the same backing store
    docRef.get()/.set() and runTransaction()'s tx.get()/tx.set() share,
    so this sees whatever the page's own code last wrote via either.
    None if the doc doesn't exist."""
    return page.evaluate("(path) => (window.__dgFirestoreDocs || {})[path]", path)

def push_firestore_snapshot(page, path, wheres, docs):
    """Delivers a fake Firestore snapshot (the full current result set,
    same as a real listener's first callback) to whichever registered
    listener matches the given collection path and .where() chain
    exactly. Delivers to EVERY listener that matches, not just the
    first -- two independent tabs (e.g. a-cell.html's Play tab and its
    Cells tab both now listen to plain 'characters'/'cells' with no
    where() at all) can each hold their own separate onSnapshot on the
    exact same query, same as real Firestore fanning one write out to
    every matching listener; a test would otherwise silently starve
    whichever tab's listener didn't happen to be first in the list.
    Must be called after the app has actually subscribed -- poll
    notes_firestore_listener_count() first, same reasoning as
    push_radio_now_playing()'s own "must be called after the widget has
    actually subscribed" note. docs is a list of dicts, each needing an
    'id' key plus whatever fields the real CellNotes/Evidence row has."""
    page.evaluate(
        """([path, wheres, docs]) => {
            var matches = (window.__dgFirestoreListeners || []).filter(function (l) {
                return l.path === path && JSON.stringify(l.wheres) === JSON.stringify(wheres);
            });
            if (!matches.length) throw new Error('no Firestore listener registered for ' + path + ' where=' + JSON.stringify(wheres));
            var wrapped = docs.map(function (d) {
                var id = d.id;
                var data = Object.assign({}, d);
                delete data.id;
                return { id: id, data: function () { return data; } };
            });
            matches.forEach(function (match) {
                match.success({
                    docChanges: function () { return wrapped.map(function (d) { return { type: 'added', doc: d }; }); },
                    forEach: function (fn) { wrapped.forEach(fn); }
                });
            });
        }""",
        [path, wheres, docs],
   )

def push_firestore_doc_snapshot(page, path, exists, data=None):
    """Delivers a fake single-document Firestore snapshot (characters/{code}
    DEX post-it, etc.) to whichever registered doc-level listener matches
    the given full doc path exactly -- see the stub's onSnapshot on doc()
    above. Must be called after the app has actually subscribed, same
    reasoning as push_firestore_snapshot()."""
    page.evaluate(
        """([path, exists, data]) => {
            // Every listener on the document, like the real thing.
            var matches = (window.__dgFirestoreListeners || []).filter(function (l) {
                return l.isDoc && l.path === path;
            });
            if (!matches.length) throw new Error('no Firestore doc listener registered for ' + path);
            matches.forEach(function (match) { match.success({ exists: exists, data: function () { return data; } }); });
        }""",
        [path, exists, data],
   )

def _open_appearance(page):
    """v2: on Agent Hub the Appearance form drops down from the button
    under the Agent's photo; open it (if it's there and folded) before a
    test works the form."""
    try:
        page.evaluate("""() => { const f = document.getElementById('af-appear'); const d = f && f.closest('.ah-appear-drop');
            if (d && d.hidden) { const b = document.querySelector('[data-ah-appear="' + d.id.replace('ah-appear-', '') + '"]'); if (b) b.click(); } }""")
    except Exception:
        pass

def _open_era(page):
    """The era photos drop down from their button under the photo on Agent
    Hub; open them (if folded) before a test works them."""
    try:
        page.evaluate("""() => { const f = document.getElementById('af-photos'); const d = f && f.closest('.ah-era-drop');
            if (d && d.hidden) { const b = document.querySelector('[data-ah-era="' + d.id.replace('ah-era-', '') + '"]'); if (b) b.click(); } }""")
    except Exception:
        pass

def fill_cover_form(page, agent, form_selector="#dg-form"):
    _open_appearance(page)
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

def test_cover_ids_tab(p):
    """The Field ID Fabricator (field-id.html) since v3.9.0: a forger's
    terminal. The start screen offers the three protocols (Mirror
    credential, Spoof a local office, Fabricate an entity); Mirror draws
    the agency card with the shared card module; Print opens over the page
    (no new tab, a phone had no way back from one) with the PROP line on
    the paper only, and Done closes it."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    mock_routes(page)
    page.goto(f"{BASE}/field-id.html?embed=1", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function("() => window.dgFabricator", timeout=8000)
    record("cover-ids-tab", "the Fabricator is the terminal, with the three forgery protocols",
           page.locator("#ids-shell .topt").count() == 3 and "SELECT FORGERY PROTOCOL" in page.inner_text("#fx-body"), page.inner_text("#fx-body")[:160])
    page.keyboard.press("1")
    page.wait_for_selector("#ids-agency")
    page.select_option("#ids-agency", "FBI")
    page.click("[data-x=era][data-v='90s']")
    page.fill("#ids-cover-name", "Marcus Reyes")
    page.fill("#ids-cover-id", "MR-4471")
    page.wait_for_timeout(200)
    prev = page.inner_text("#fx-prev")
    record("cover-ids-tab", "1 / Mirror: the agency credential renders live with the typed name", "Marcus Reyes" in prev and "INVESTIGATION" in prev.upper(), prev[:100])
    record("cover-ids-tab", "the live preview carries no PROP line", "PROP" not in prev, prev[:120])
    page.click("[data-x=file]")
    page.wait_for_selector("text=FORGERY COMPLETE")
    pops = []
    page.on("popup", lambda pg: pops.append(pg))
    page.click("[data-x=print]")
    page.wait_for_selector("#dgf-print", timeout=4000)
    record("cover-ids-tab", "Print opens over the page, not in a new tab", len(pops) == 0 and page.locator("#dgf-print .sheet").count() == 1, str(len(pops)))
    record("cover-ids-tab", "the printed card carries the PROP line", "PROP" in page.inner_text("#dgf-print .sheet"), "")
    page.click("#dgf-print [data-p=done]")
    record("cover-ids-tab", "Done closes it, back on the tablet", page.locator("#dgf-print").count() == 0 and page.is_visible("#ids-shell"), "")
    # The templates live in assets/field-id-cards.js, shared with the
    # notebook: every agency on file, in every era, finds a template.
    sweep = page.evaluate("""() => {
        const C = window.dgFieldIdCards, out = { drawn: 0, missing: [] };
        const agencies = window.dgAgencies.list.map(a => a.code).concat(['DG']);
        ['90s', '00s', '10s', '20s'].forEach(era => agencies.forEach(ag => {
            const t = C.template(ag, era);
            if (!t) { out.missing.push(ag + '_' + era); return; }
            if ((C.render(t, { name: 'Test Agent', era: era }, '') || '').length > 100) out.drawn++;
        }));
        return out; }""")
    record("cover-ids-tab", "every agency/era template is drawn by the shared Field ID card module",
           sweep["drawn"] > 40 and all(m.split("_")[0] in ("ICE", "CBP", "DHS", "FINCEN") for m in sweep["missing"]), str(sweep))
    nb = page.evaluate("""() => { const C = window.dgFieldIdCards, out = {};
        ['NASA', 'NSA', 'USCG', 'DHS', 'IRSCI'].forEach(k => ['90s', '00s', '10s', '20s'].forEach(e => {
            const t = C.template(k, e); const h = t && !t.is_no_card ? C.render(t, { name: 'Test' }, '') : '';
            out[k + '_' + e] = t && t.is_no_card ? 'none' : (/<img src="data:image\/png/.test(h) ? 'seal' : 'no seal') + (/TRANSPORTATION/.test(h) ? '+DOT' : '');
        })); return out; }""")
    record("cover-ids-tab", "batch 1 agencies draw a card with their seal in every era (DHS from 2003; Coast Guard under Transportation in the 90s)",
           all(v.startswith("seal") for k, v in nb.items() if k != "DHS_90s") and nb["DHS_90s"] == "none" and nb["USCG_90s"] == "seal+DOT" and nb["USCG_20s"] == "seal", str(nb))
    nb = page.evaluate("""() => { const C = window.dgFieldIdCards, out = {};
        ['CIA', 'DIA', 'NGA', 'NRO', 'ONI'].forEach(k => ['90s', '00s', '10s', '20s'].forEach(e => {
            const t = C.template(k, e); const h = t && !t.is_no_card ? C.render(t, { name: 'Test' }, '') : '';
            out[k + '_' + e] = (/<img src="data:image\\/png/.test(h) ? 'seal' : 'no seal') + (/IMAGERY AND/.test(h) ? '+NIMA' : '');
        })); return out; }""")
    record("cover-ids-tab", "batch 2 agencies draw a card with their seal in every era (NGA reads NIMA on the 90s and 00s cards)",
           all(v.startswith("seal") for v in nb.values()) and nb["NGA_90s"] == "seal+NIMA" and nb["NGA_00s"] == "seal+NIMA" and nb["NGA_10s"] == "seal", str(nb))
    nb = page.evaluate("""() => { const C = window.dgFieldIdCards, out = {};
        ['FEMA', 'NCTC', 'NNSA', 'DARPA', 'NPS'].forEach(k => ['90s', '00s', '10s', '20s'].forEach(e => {
            const t = C.template(k, e); const h = t && !t.is_no_card ? C.render(t, { name: 'Test' }, '') : '';
            out[k + '_' + e] = t && t.is_no_card ? 'none' : (/<img src="data:image\\/png/.test(h) ? 'seal' : 'no seal') + (/HOMELAND/.test(h) ? '+DHS' : '');
        })); out.wide = /width="\\d+" height="(\\d+)"/.exec(C.render(C.template('DARPA', '20s'), { name: 'T' }, '')).slice(0); return out; }""")
    record("cover-ids-tab", "batch 3 agencies draw a card with their seal (NCTC and NNSA from the 2000s; FEMA under DHS from 2003; wide logos get a wide slot)",
           all(v.startswith("seal") for k, v in nb.items() if k not in ("NCTC_90s", "NNSA_90s", "wide")) and nb["NCTC_90s"] == "none" and nb["NNSA_90s"] == "none"
           and nb["FEMA_90s"] == "seal" and nb["FEMA_20s"] == "seal+DHS", str(nb))
    nb = page.evaluate("""() => { const C = window.dgFieldIdCards, out = {};
        ['ARMY', 'NAVY', 'USAF', 'USMC', 'AFOSI'].forEach(k => ['90s', '20s'].forEach(e => {
            const t = C.template(k, e); const h = t && !t.is_no_card ? C.render(t, { name: 'Test' }, '') : '';
            out[k + '_' + e] = /<img src="data:image\\/png/.test(h) ? 'seal' : 'no seal';
        })); return out; }""")
    record("cover-ids-tab", "batch 5 (military) cards draw their seal",
           all(v == "seal" for v in nb.values()), str(nb))
    page.click("[data-x=home]"); page.click("[data-x=p-mirror]")
    page.fill("[data-q=agency]", "nasa")
    page.wait_for_timeout(300)
    record("cover-ids-tab", "Mirror: searching 'nasa' picks NASA and draws its card", page.eval_on_selector("#ids-agency", "e => e.value") == "NASA" and "AERONAUTICS" in page.inner_text("#fx-prev").upper(), page.inner_text("#fx-prev")[:80])
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
           page.locator(".clearance-choice").count() == 3, "")
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
           page.locator(".clearance-choice").count() == 3, "")

    page.close()
    return errs

def test_hub_clearance_branches(p):
    """index.html is now a splash + clearance chooser, not a direct tool
    grid -- Character Creator and Agent Portal moved under the Agent
    branch (agent-hub.html), and A-Cell (a-cell.html) is new. Regression
    check for the hub restructuring: exactly two clearance branches.
    Both are routed through the app shell (hub.html) now, Phase 4 of the
    shell plan -- Agent opens the shell at its default (Agent Hub),
    A-Cell opens it with ?start=a-cell.html so the shell's content
    iframe goes straight there instead of Agent Hub first. Friendly (the
    third branch) deliberately skips the shell: a one-shot player has no
    Cover Identity for the shell's opening prompt to ask about."""
    page = p.new_page()
    page.set_default_timeout(5000)
    errs = collect_errors(page)
    skip_boot_splash(page)
    page.goto(f"{BASE}/index.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(200)
    hrefs = page.eval_on_selector_all(".clearance-choice", "els => els.map(e=>e.getAttribute('href'))")
    record("hub", "hub has exactly 3 clearance branches: Agent and A-Cell through the shell, Friendly direct",
           hrefs == ["hub.html", "friendly.html", "hub.html?start=a-cell.html"], str(hrefs))
    page.close()
    return errs

def test_hub_clearance_lands_in_shell(p):
    """End-to-end proof that index.html's two Clearance choices actually
    land in the app shell correctly, not just that their href attributes
    look right: clicking Agent opens hub.html with its content iframe on
    Agent Hub (the default); clicking A-Cell (a fresh visit, since the
    first navigation already left index.html) opens hub.html with the
    content iframe going straight to a-cell.html via ?start=, not Agent
    Hub first. Also checks the ?start= allowlist actually rejects
    anything unexpected rather than blindly trusting it -- a crafted
    ?start= pointing anywhere else must still fall back to Agent Hub."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    # Lands in a-cell.html via the shell, whose own Evidence listener
    # (Phase 5) starts unconditionally on load, independent of anything
    # this test is actually proving -- see the shell content-swap
    # test's own comment on the same fix.
    install_notes_firestore_stub(page)
    page.add_init_script("try { sessionStorage.setItem('dg_acell_pw', 'testpw'); } catch (e) {}")
    # hub.html's shell now asks for a Cover Identity on its loading veil
    # before booting the iframe to Agent Hub, UNLESS one's already
    # remembered (a returning player) -- pre-seeding it here keeps this
    # test's own concern (does the shell route to the right page?)
    # decoupled from that separate prompt, which has its own coverage
    # in test_hub_cover_identity_veil below.
    page.add_init_script("try { localStorage.setItem('dg_cover_identity', 'Test Player'); } catch (e) {}")
    skip_boot_splash(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    page.goto(f"{BASE}/index.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(200)
    page.click(".clearance-choice.cc-agent")
    page.wait_for_function(
        "() => { var f = document.getElementById('dg-shell-content'); "
        "return f && f.contentDocument && f.contentDocument.readyState === 'complete'; }",
        timeout=10000)
    record("hub", "clicking Agent lands on hub.html with the shell chrome present",
           "hub.html" in page.url and page.locator("#dg-shell-nav").count() == 1, page.url)
    record("hub", "the content iframe opened to Agent Hub (the default, no ?start=)",
           "agent-hub.html" in page.eval_on_selector("#dg-shell-content", "el => el.contentWindow.location.href"), "")

    page.goto(f"{BASE}/index.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(200)
    page.click(".clearance-choice.cc-acell")
    page.wait_for_function(
        "() => { var f = document.getElementById('dg-shell-content'); "
        "return f && f.contentDocument && f.contentDocument.readyState === 'complete' "
        "&& /a-cell\\.html/.test(f.contentWindow.location.href); }",
        timeout=10000)
    record("hub", "clicking A-Cell lands on hub.html with the content iframe going straight to a-cell.html",
           "a-cell.html" in page.eval_on_selector("#dg-shell-content", "el => el.contentWindow.location.href"), "")

    page.goto(f"{BASE}/hub.html?start=https://evil.example", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function(
        "() => { var f = document.getElementById('dg-shell-content'); "
        "return f && f.contentDocument && f.contentDocument.readyState === 'complete'; }",
        timeout=10000)
    record("hub", "a ?start= value outside the allowlist falls back to Agent Hub, not whatever was requested",
           "agent-hub.html" in page.eval_on_selector("#dg-shell-content", "el => el.contentWindow.location.href"),
           page.eval_on_selector("#dg-shell-content", "el => el.contentWindow.location.href"))

    record("hub", "no JS exceptions", len(errs) == 0, "; ".join(errs))
    page.close()
    return errs

def test_hub_cover_identity_veil(p):
    """hub.html's loading veil (black-screen/green-terminal, same
    aesthetic as index.html's boot splash and a-cell.html's own gate --
    a real report asked for that look specifically, after a first pass
    used the destination page's own paper look instead) doubles as a
    Cover Identity prompt for the Agent Hub branch only, so a player's
    agents preload during the wait instead of after Agent Hub itself has
    already painted an empty roster. A brand-new device (no remembered
    identity) is actually asked and the iframe boot waits for that
    input -- Enter with a name kicks off the preload and proceeds;
    Enter with nothing just proceeds. A returning device (identity
    already remembered) skips the prompt and preloads immediately,
    matching "always preloads" without asking again every visit. The
    A-Cell branch gets a plain loading line, no prompt -- it has its own
    real password gate once it loads."""
    errs_all = []
    fake_agents = [{"code": "DANI-U8BM", "char_name": "Daniela Martinez", "codename": "", "sex": "female",
                     "age_range": "41", "nationality": "Swedish", "saved_at": 1000, "player_name": "gergo"}]

    # Agents tied to a Cover Identity are a Firestore query now (briefs
    # where player_name_lc == the name).
    def fake_backend(page):
        docs = {}
        for a_ in fake_agents:
            d = {k: v for k, v in a_.items() if k not in ("code", "saved_at")}
            d["player_name_lc"] = d["player_name"].lower()
            docs["briefs/" + a_["code"]] = d
        install_firestore_backend(page, docs)

    # Branch 1: no remembered identity -- prompt shows, boot waits for Enter.
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    fake_backend(page)
    page.goto(f"{BASE}/hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)
    record("hub", "a brand-new device is actually asked for a Cover Identity on the veil",
           "enter_cover_identity" in page.inner_text("#dg-shell-loading-log"), page.inner_text("#dg-shell-loading-log"))
    record("hub", "the iframe boot waits for that input instead of loading Agent Hub right away",
           page.get_attribute("#dg-shell-content", "src") is None, "")
    page.fill("#dg-shell-loading-ci-input", "Gergo")
    page.press("#dg-shell-loading-ci-input", "Enter")
    page.wait_for_function(
        "() => { var f = document.getElementById('dg-shell-content'); "
        "return f.contentDocument && f.contentDocument.readyState === 'complete'; }", timeout=10000)
    record("hub", "typing a name and pressing Enter boots the iframe to Agent Hub",
           "agent-hub.html" in (page.get_attribute("#dg-shell-content", "src") or ""), "")
    wait_for_condition(lambda: "Daniela Martinez" in json.dumps(
        json.loads(page.evaluate("localStorage.getItem('dg_agent_roster')") or "{}")), timeout_ms=5000)
    record("hub", "the typed name's Agents are preloaded into dg_agent_roster during that wait",
           "Daniela Martinez" in json.dumps(json.loads(page.evaluate("localStorage.getItem('dg_agent_roster')") or "{}")), "")
    errs_all.extend(errs)
    page.close()

    # Branch 2: Enter with nothing typed just proceeds (not a real gate).
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    fake_backend(page)
    page.goto(f"{BASE}/hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)
    page.press("#dg-shell-loading-ci-input", "Enter")
    page.wait_for_function(
        "() => { var f = document.getElementById('dg-shell-content'); "
        "return f.contentDocument && f.contentDocument.readyState === 'complete'; }", timeout=10000)
    record("hub", "pressing Enter with nothing typed still proceeds -- not a real access gate",
           "agent-hub.html" in (page.get_attribute("#dg-shell-content", "src") or ""), "")
    errs_all.extend(errs)
    page.close()

    # Branch 3: a remembered identity skips the prompt and preloads immediately.
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    fake_backend(page)
    page.add_init_script("try { localStorage.setItem('dg_cover_identity', 'Gergo'); } catch (e) {}")
    page.goto(f"{BASE}/hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(200)
    record("hub", "a returning device (remembered identity) skips the prompt and boots right away",
           "agent-hub.html" in (page.get_attribute("#dg-shell-content", "src") or ""), "")
    wait_for_condition(lambda: "Daniela Martinez" in json.dumps(
        json.loads(page.evaluate("localStorage.getItem('dg_agent_roster')") or "{}")), timeout_ms=5000)
    record("hub", "the remembered identity's Agents are still preloaded, without asking again",
           "Daniela Martinez" in json.dumps(json.loads(page.evaluate("localStorage.getItem('dg_agent_roster')") or "{}")), "")
    errs_all.extend(errs)
    page.close()

    # Branch 4: A-Cell branch gets no identity prompt at all.
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    # a-cell.html's own Evidence listener (Phase 5) starts unconditionally
    # on load and otherwise tries to reach the real gstatic.com Firebase
    # SDK, unreachable from this sandbox -- same reasoning as the shell
    # content-swap test's own copy of this comment/fix.
    install_notes_firestore_stub(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    fake_backend(page)
    page.add_init_script("try { sessionStorage.setItem('dg_acell_pw', 'testpw'); } catch (e) {}")
    page.goto(f"{BASE}/hub.html?start=a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)
    record("hub", "the A-Cell branch shows a plain loading line, no Cover Identity prompt",
           page.locator("#dg-shell-loading-input-line").is_visible() == False, "")
    record("hub", "the A-Cell branch boots immediately regardless",
           "a-cell.html" in (page.get_attribute("#dg-shell-content", "src") or ""), "")
    errs_all.extend(errs)
    page.close()

    # Branch 5: live report -- the veil never cleared at all on a real
    # device even though the Cover Identity preload itself succeeded
    # (agents_loaded showed in its own log), meaning the iframe's load
    # event apparently never fired. Held indefinitely here to prove the
    # hard-cap safety timeout (armVeil() in hub.html, same "never hold
    # past ~Ns" reasoning as index.html's own boot splash) actually
    # clears the veil on its own instead of trapping the page forever.
    page = p.new_page()
    page.set_default_timeout(20000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    fake_backend(page)
    held = []
    page.route("**/agent-hub.html", lambda route: held.append(route))
    page.add_init_script("try { localStorage.setItem('dg_cover_identity', 'Gergo'); } catch (e) {}")
    page.goto(f"{BASE}/hub.html", wait_until="domcontentloaded", timeout=15000)
    wait_for_condition(lambda: len(held) >= 1, timeout_ms=5000)
    veil_hidden_class = lambda: "dg-shell-loading-hidden" in (page.get_attribute("#dg-shell-loading", "class") or "")
    record("hub", "the veil stays up while the iframe's request is still held (not an instant no-op timeout)",
           not veil_hidden_class(), "")
    wait_for_condition(veil_hidden_class, timeout_ms=15000)
    record("hub", "a held/never-loading iframe still gets the veil cleared by the hard-cap safety timeout",
           veil_hidden_class(), "")
    errs_all.extend(errs)
    page.close()

    # Branch 6: the interactive prompt itself has no ticking clock --
    # only an actual iframe.src assignment (bootIframe()) arms the
    # safety timeout, so a player who's slow to type is never rushed
    # or skipped past.
    page = p.new_page()
    page.set_default_timeout(10000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    fake_backend(page)
    page.goto(f"{BASE}/hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)
    page.wait_for_timeout(3500)
    record("hub", "the prompt itself never auto-times-out while genuinely waiting on input",
           page.get_attribute("#dg-shell-content", "src") is None
           and "dg-shell-loading-hidden" not in (page.get_attribute("#dg-shell-loading", "class") or ""), "")
    errs_all.extend(errs)
    page.close()

    record("hub", "no JS exceptions", len(errs_all) == 0, "; ".join(errs_all))
    return errs_all

def test_agent_hub(p):
    """agent-hub.html (the Agent clearance branch): every Agent (plus a
    pinned "+ New Recruit") is a folder ear-tab, and the active tab is
    that Agent's whole file -- the hub's header and sheet, Appearance and
    the era photos (assets/agent-file.js, moved into whichever tab is
    open) and Evidence. Play is the one button left under the Agent's
    line; Agent File, Field ID, Notes and the rest live in the Field
    Notes notebook. Reads the dg_agent_roster localStorage."""
    errs_all = []

    # No agents on file -> only the New Recruit tab, an empty-state panel
    page = p.new_page()
    page.set_default_timeout(5000)
    errs = collect_errors(page)
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)
    record("hub", "with no agents on file, New Recruit is the only tab",
           page.eval_on_selector_all(".tw:not(.tw-switch) > span", "els => els.map(e=>e.textContent)") == ["+ New Recruit"], "")
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
    # Both Agents have an Agent File on the backend (an Agent with none
    # and no character is purged from the roster as deleted).
    install_firestore_backend(page, {"briefs/OWEN-CS12": {"char_name": "Owen Castillo", "codename": "Ferro"},
                                     "briefs/PRIY-AN34": {"char_name": "Priya Anand"}})
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

    tab_labels = page.eval_on_selector_all(".tw:not(.tw-switch) > span", "els => els.map(e=>e.textContent)")
    record("hub", "one tab per Agent (most recent first) plus New Recruit pinned first",
           tab_labels == ['+ New Recruit', 'Owen "Ferro"', 'Priya Anand'], str(tab_labels))
    record("hub", "the most recently-saved Agent's tab is active by default",
           "active" in page.eval_on_selector('.tw[data-tab="OWEN-CS12"]', "el => el.className"), "")
    record("hub", "that Agent's paper panel is the active one",
           "active" in page.eval_on_selector("#panel-OWEN-CS12", "el => el.className"), "")

    action_hrefs = page.eval_on_selector_all(
        "#panel-OWEN-CS12 .paper-actions .paper-btn", "els => els.map(e => e.getAttribute('href'))")
    record("hub", "Recruit is the only button under the Agent's line, opening New Recruit for that exact agent (the rest lives in the notebook)",
           action_hrefs == ["agent-hub.html?recruit=OWEN-CS12#new"], str(action_hrefs))
    af = _af_state(page)
    record("hub", "the active Agent's tab carries their Agent File (Appearance, era photos), loaded for them",
           af.get("inTab") and af.get("code") == "OWEN-CS12", json.dumps(af))
    record("hub", "an Agent with an unfinished Appearance brief gets the callout under Play, with how much is left",
           page.eval_on_selector("#ah-callout-OWEN-CS12", "el => !el.hidden && /still to fill in/.test(el.textContent)"), "")

    # Clicking a tab switches the active panel -- and the one Agent File
    # moves into it and loads that Agent.
    page.click('.tw[data-tab="PRIY-AN34"] > span')
    page.wait_for_timeout(150)
    record("hub", "clicking a tab activates that Agent's panel and deactivates the others",
           "active" in page.eval_on_selector("#panel-PRIY-AN34", "el => el.className")
           and "active" not in page.eval_on_selector("#panel-OWEN-CS12", "el => el.className"), "")
    page.wait_for_function("() => window.dgAgentFile.code() === 'PRIY-AN34'", timeout=5000)
    af = _af_state(page)
    form_name = page.eval_on_selector("#dg-form [name=char_name]", "el => el.value")
    record("hub", "…and the Agent File follows, now Priya's (her name on the Appearance brief)",
           af.get("inTab") and af.get("code") == "PRIY-AN34" and form_name == "Priya Anand", json.dumps(af) + " " + form_name)

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

    # The lookup is a Firestore query now (briefs + characters where
    # player_name_lc == the name): each Agent is seeded as a briefs/ doc.
    def briefs_for(player, agents):
        docs = {}
        for a in agents:
            d = dict(a)
            code = d.pop("code")
            d["player_name"] = player
            d["player_name_lc"] = player.lower()
            docs["briefs/" + code] = d
        return docs
    PATRICK = {"code": "GERG-P001", "char_name": "Patrick Montgomery", "codename": "", "sex": "Male",
               "age_range": "Mid 30s", "nationality": "American"}

    # Entering a name and finding 2 Agents replaces the whole roster
    # (which starts out seeded with two locally-added Agents: one already
    # tied to a different real name, one nobody's claimed yet). Both
    # strays go: unnamed Agents used to be kept, which on a home-screen
    # app piled up every Agent ever opened by a link or by looking up
    # another player (2026-10-12, the user's choice: matching name only).
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    install_firestore_backend(page, dict(briefs_for("Gergo", [
        PATRICK,
        {"code": "GERG-D002", "char_name": "Danielle Mitchell", "codename": "", "sex": "Female",
         "age_range": "Late 20s", "nationality": "American"},
    ]), **briefs_for("Not Gergo", [{"code": "STRY-X001", "char_name": "Claimed By Someone Else"}]),
        # An Agent File nobody has put a Player Name on yet. (A roster
        # entry with no Agent File AND no character is purged as deleted.)
        **{"briefs/STRY-X002": {"char_name": "Unclaimed Local Draft"}}))
    page.add_init_script("""
        const now = Date.now();
        localStorage.setItem('dg_agent_roster', JSON.stringify({
            'STRY-X001': { code: 'STRY-X001', char_name: 'Claimed By Someone Else',
                           player_name: 'Not Gergo', saved_at: 500 },
            'STRY-X002': { code: 'STRY-X002', char_name: 'Unclaimed Local Draft', saved_at: now - 40 * 60 * 60 * 1000 },
        }));
    """)
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)
    record("hub", "starts with both stray Agents already in the roster before any lookup",
           set(page.eval_on_selector_all(".tw:not(.tw-switch) > span", "els => els.map(e=>e.textContent)"))
           == {"+ New Recruit", "Claimed By Someone Else", "Unclaimed Local Draft"}, "")

    page.fill("#cover-identity-input", "Gergo")
    page.click("#cover-identity-btn")
    page.wait_for_timeout(500)
    tab_labels = page.eval_on_selector_all(".tw:not(.tw-switch) > span", "els => els.map(e=>e.textContent)")
    record("hub", "a Cover Identity lookup with matches adds the returned Agents",
           {"Patrick Montgomery", "Danielle Mitchell"}.issubset(set(tab_labels)), str(tab_labels))
    record("hub", "the stray Agent already claimed by a different real name is gone",
           "Claimed By Someone Else" not in tab_labels, str(tab_labels))
    record("hub", "an unnamed Agent from earlier doesn't stay either: only that name's Agents remain",
           "Unclaimed Local Draft" not in tab_labels, str(tab_labels))
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
    install_firestore_backend(page, briefs_for("Gergo", [PATRICK]))
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)
    page.fill("#cover-identity-input", "Nobody Real")
    page.click("#cover-identity-btn")
    page.wait_for_timeout(500)
    record("hub", "a Cover Identity lookup with no matches shows a clear status instead of doing nothing",
           "No Agents found" in page.inner_text("#ci-status"), page.inner_text("#ci-status"))
    record("hub", "a no-match lookup leaves the roster empty, not a phantom entry",
           page.eval_on_selector_all(".tw:not(.tw-switch) > span", "els => els.map(e=>e.textContent)") == ["+ New Recruit"], "")
    errs_all.extend(errs)
    page.close()

    # A returning visit with a stored Cover Identity re-runs the lookup
    # automatically, silently, with no user input at all.
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    install_firestore_backend(page, briefs_for("Gergo", [PATRICK]))
    page.add_init_script("localStorage.setItem('dg_cover_identity', 'Gergo');")
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(500)
    lookup_calls = page.evaluate("() => (window.__dgFsQueries || []).filter(q => "
                                 "q.wheres.some(w => w[0] === 'player_name_lc' && w[2] === 'gergo'))")
    record("hub", "a stored Cover Identity re-runs the lookup on its own, no click needed",
           len(lookup_calls) >= 1, str(lookup_calls))
    record("hub", "the returning player's Agent shows up without any input",
           "Patrick Montgomery" in page.eval_on_selector_all(".tw:not(.tw-switch) > span", "els => els.map(e=>e.textContent)"), "")
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
    # A gdrive: link the Drive move couldn't carry over still loads
    # through the Apps Script image proxy (the one call left there).
    def mock_imgdata(route):
        url = route.request.url
        if "action=imgdata" in url:
            cb = url.split("callback=")[1].split("&")[0]
            body = json.dumps({"status": "OK", "dataUri": "data:image/png;base64,ZmFrZQ=="})
            route.fulfill(status=200, content_type="application/javascript", body=f"{cb}({body})")
            return
        route.fulfill(status=404, body="")
    page.route("**/script.google.com/**", mock_imgdata)
    install_firestore_backend(page, briefs_for("Gergo", [
        {"code": "DEMO-Q5MD", "char_name": "DeMore, \"Mastery\", André", "codename": "", "sex": "Male",
         "age_range": "50s", "nationality": "American", "face_plate_url": "gdrive:fake-drive-id"},
    ]))
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

    # Regression: a live report showed the exact same player name
    # working, then failing, then working again minutes later with no
    # code change in between -- traced to this campaign's shared Apps
    # Script backend being genuinely busy under concurrent live-session
    # traffic (autosave/radio-poll/notes-poll from other open tabs),
    # something this read path had never been hardened against. A
    # malformed/error response (not a well-formed "found nothing")
    # now retries with increasing delays instead of immediately
    # reporting failure -- exercised here via two bad responses before
    # a real one lands, since simulating the 8s hard timeout itself
    # would make this test needlessly slow.
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    install_firestore_backend(page, briefs_for("Gergo", [PATRICK]))
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)
    # Firestore failing (offline, overloaded) for the first two attempts.
    page.evaluate("() => { window.__dgFsFail = true; }")
    page.fill("#cover-identity-input", "Gergo")
    page.click("#cover-identity-btn")
    # First attempt fails near-instantly (a malformed response, not a
    # real timeout), then waits CI_LOOKUP_RETRY_DELAYS_MS[0] (2s) before
    # the retry itself starts and updates the status line -- wait past
    # that before checking for it.
    page.wait_for_timeout(2300)
    record("hub", "a busy-backend response shows a retrying status instead of a false failure",
           "busy" in page.inner_text("#ci-status").lower(), page.inner_text("#ci-status"))
    page.evaluate("() => { window.__dgFsFail = false; }")
    tab_labels = wait_for_condition(
        lambda: page.eval_on_selector_all(".tw:not(.tw-switch) > span", "els => els.map(e=>e.textContent)")
        if "Patrick Montgomery" in page.eval_on_selector_all(".tw:not(.tw-switch) > span", "els => els.map(e=>e.textContent)") else None,
        timeout_ms=10000)
    record("hub", "the search self-heals and loads the Agent once the backend actually answers, with no user retry",
           bool(tab_labels) and "Patrick Montgomery" in tab_labels, str(tab_labels))
    attempts = page.evaluate("() => (window.__dgFsQueries || []).filter(q => q.path === 'briefs').length")
    record("hub", "it took more than one attempt to get there (proves the retry path actually ran)",
           attempts >= 3, attempts)
    errs_all.extend(errs)
    page.close()
    return errs_all

def test_player_name_survives_profiling_and_load_my_agents(p):
    """Found in the full-journey run: a Profiling submit made before the
    form had filled in (a quick player) sent an empty "Your Name" and
    wiped the Agent File's Player Name. Load My Agents on another device
    then found the character but not its Agent File, so the Face Plate
    and codename never showed. An empty name now never overwrites a
    known one, and Load My Agents also pulls a matched character's own
    Agent File even when that file lacks the name."""
    errs_all = []
    page = p.new_page()
    page.set_default_timeout(10000)
    errs = collect_errors(page)
    _block_fonts(page)
    brief = dict(MOCK_BRIEF, char_name="Nora Vance", player_name="Mara Player", player_name_lc="mara player")
    install_firestore_backend(page, {"briefs/NORA-VX01": brief})
    page.goto(f"{BASE}/agent-hub.html?code=NORA-VX01#appearance", wait_until="domcontentloaded", timeout=15000)
    wait_for_condition(lambda: page.input_value("#dg-form [name=char_name]") == "Nora Vance", timeout_ms=8000)
    page.wait_for_function("() => document.getElementById('af-appear').classList.contains('af-open')", timeout=8000)
    page.click('button[onclick^="randomizeAgent"]')  # fills the rest of the form
    page.wait_for_timeout(300)
    # (the fixture's age "30s" isn't one of the dropdown's options)
    page.evaluate("() => { const s = document.querySelector('#dg-form [name=age_range]'); if (s && !s.checkValidity()) { s.selectedIndex = 1; } }")
    page.fill("#dg-form [name=player_name]", "")
    page.click("#submit-btn")
    wait_for_condition(lambda: (fs_doc(page, "briefs/NORA-VX01") or {}).get("submitted_at"), timeout_ms=8000)
    saved = fs_doc(page, "briefs/NORA-VX01") or {}
    record("agent-file", "submitting Appearance with an empty Your Name keeps the Player Name already on file",
           bool(saved.get("submitted_at")) and saved.get("player_name") == "Mara Player" and saved.get("player_name_lc") == "mara player",
           str({k: saved.get(k) for k in ("submitted_at", "player_name", "player_name_lc")}) + " status=" + page.inner_text("#form-status") if page.locator("#form-status").count() else "")
    errs_all.extend(errs)
    page.close()

    page = p.new_page()
    page.set_default_timeout(10000)
    errs = collect_errors(page)
    _block_fonts(page)
    install_firestore_backend(page, {
        "characters/NORA-VX02": character_doc("NORA-VX02", {"bio": {"name": "Nora Vance"}}, "Mara Player"),
        "briefs/NORA-VX02": {"char_name": "Nora Vance", "codename": "Lantern", "face_plate_url": "https://example.test/face.png"},
    })
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.fill("#cover-identity-input", "Mara Player")
    page.click("#cover-identity-btn")
    roster = wait_for_condition(lambda: (json.loads(page.evaluate("localStorage.getItem('dg_agent_roster')") or "{}").get("NORA-VX02")), timeout_ms=8000) or {}
    record("hub", "Load My Agents brings a found character's own Agent File (photo, codename) even when that file lacks the name",
           roster.get("face_plate_url") == "https://example.test/face.png" and roster.get("codename") == "Lantern", str(roster))
    errs_all.extend(errs)
    page.close()
    record("hub", "no JS exceptions", len(errs_all) == 0, "; ".join(errs_all))
    return errs_all

def test_agent_hub_erase_agent(p):
    """Erase Agent: a player self-service delete for accidental duplicate
    Agents (previously only a Handler could clean these up via A-Cell
    Admin). Gated on typing the Agent's own Cover Identity back in --
    the Confirm button must stay disabled for a wrong/blank name and
    only enable for a correct (case-insensitive) match, and the actual
    delete (into deleted_agents) must only happen after that."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    install_firestore_backend(page, {
        "briefs/GERG-E001": {"char_name": "Duplicate Owen", "player_name": "Gergo", "player_name_lc": "gergo"},
    })

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
    # A real delete into deleted_agents (restorable by a Handler for 24h).
    # It used to POST delete_character, which the backend always refused.
    deleted = fs_doc(page, "deleted_agents/GERG-E001") or {}
    record("hub", "confirming moves the Agent into Recently Deleted (deleted_agents)",
           fs_doc(page, "briefs/GERG-E001") is None and (deleted.get("brief") or {}).get("char_name") == "Duplicate Owen",
           str(deleted))
    record("hub", "the overlay closes after confirming",
           not page.is_visible("#ah-erase-overlay"), "")
    record("hub", "the erased Agent is gone from the roster/tab strip",
           "Duplicate Owen" not in page.eval_on_selector_all(".tw:not(.tw-switch) > span", "els => els.map(e=>e.textContent)"), "")

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

    install_firestore_backend(page, {
        "characters/DEAD-0001": character_doc("DEAD-0001", {"derived": {"hp": 0}}, ""),
        "characters/ALIV-0002": character_doc("ALIV-0002", {"derived": {"hp": 9}}, ""),
    })

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
    install_notes_firestore_stub(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    photo_data_uri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    cells_fixture = [{"cell_id": "cell_1", "name": "Cell Alpha", "handler": "Sam", "member_codes": ["OWEN-CS12"], "channel": ""}]
    # visible_to is the server-side denormalization startEvidenceListenerFor()
    # actually queries against now (Phase 5, .where('visible_to',
    # 'array-contains-any', [code, 'ALL'])) -- not something this mock
    # computes itself, since a real Firestore query filters server-side
    # before delivery; this stub has to pre-filter per listener instead.
    evidence_fixture = [
        {"evidence_id": "ev1", "title": "Cell Alpha Only Clue", "body": "Only Owen should see this.", "photo": "", "cell_id": "cell_1", "restricted_to": [], "created_at": "2000", "visible_to": ["OWEN-CS12"]},
        {"evidence_id": "ev2", "title": "Campaign Wide Notice", "body": "Everyone sees this.", "photo": photo_data_uri, "cell_id": "", "restricted_to": [], "created_at": "1000", "visible_to": ["ALL"]},
        {"evidence_id": "ev3", "title": "Priya Eyes Only", "body": "Restricted to Priya specifically.", "photo": "", "cell_id": "", "restricted_to": ["PRIY-AN34"], "created_at": "1500", "visible_to": ["PRIY-AN34"]},
    ]

    install_firestore_backend(page, {
        "cells/cell_1": {k: v for k, v in cells_fixture[0].items() if k != "cell_id"},
        "briefs/OWEN-CS12": {"char_name": "Owen Castillo", "codename": "Ferro"},
        "briefs/PRIY-AN34": {"char_name": "Priya Anand"},
    })

    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    roster = {
        "OWEN-CS12": {"code": "OWEN-CS12", "char_name": "Owen Castillo", "codename": "Ferro", "saved_at": 2000},
        "PRIY-AN34": {"code": "PRIY-AN34", "char_name": "Priya Anand", "codename": "", "saved_at": 1000},
    }
    page.evaluate("(r) => localStorage.setItem('dg_agent_roster', JSON.stringify(r))", roster)
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(900)

    wait_for_condition(lambda: notes_firestore_listener_count(page) >= 2, timeout_ms=8000)
    for code in ("OWEN-CS12", "PRIY-AN34"):
        visible = [dict(h, id=h["evidence_id"]) for h in evidence_fixture if code in h["visible_to"] or "ALL" in h["visible_to"]]
        push_firestore_snapshot(page, "evidence", [["visible_to", "array-contains-any", [code, "ALL"]]], visible)

    record("hub", "the section label reads Evidence, not Handouts",
           page.locator(".ah-section-divider").first.inner_text().strip().upper() == "EVIDENCE", "")

    owen_titles = page.eval_on_selector_all("#ah-handouts-OWEN-CS12 .ah-handout-title", "els => els.map(e=>e.textContent)")
    record("hub", "an Agent who's a Cell member sees both that Cell's evidence and the campaign-wide one",
           sorted(owen_titles) == sorted(["Cell Alpha Only Clue", "Campaign Wide Notice"]), str(owen_titles))
    record("hub", "an item restricted to a different Agent never shows for this Agent",
           "Priya Eyes Only" not in owen_titles, str(owen_titles))

    page.click("#ah-handouts-OWEN-CS12 .ah-handout-photo")
    page.wait_for_timeout(200)
    record("hub", "clicking a handout photo opens it full-screen in the zoomable Evidence viewer",
           page.is_visible(".dg-ev-viewer") and "Campaign Wide Notice" in page.inner_text(".dg-ev-viewer .dg-ev-title"), "")
    page.click(".dg-ev-viewer [data-ev-close]")
    page.wait_for_timeout(200)
    record("hub", "closing the viewer hides it again",
           not page.is_visible(".dg-ev-viewer"), "")

    page.click('.tw[data-tab="PRIY-AN34"] > span')
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
    install_notes_firestore_stub(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    evidence_fixture = [
        {"evidence_id": "h1", "title": "Field Photo", "body": "evidence", "photo": "", "cell_id": "", "created_at": "1000", "visible_to": ["ALL"]},
    ]
    install_firestore_backend(page, {
        "briefs/OWEN-CS12": {"char_name": "Owen Castillo", "codename": "Ferro"},
        "handout_notes/OWEN-CS12_h1": {"agent_code": "OWEN-CS12", "handout_id": "h1", "note": "Existing note text"},
    })

    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    roster = {"OWEN-CS12": {"code": "OWEN-CS12", "char_name": "Owen Castillo", "codename": "Ferro", "saved_at": 2000}}
    page.evaluate("(r) => localStorage.setItem('dg_agent_roster', JSON.stringify(r))", roster)
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(900)

    wait_for_condition(lambda: notes_firestore_listener_count(page) >= 1, timeout_ms=8000)
    push_firestore_snapshot(page, "evidence", [["visible_to", "array-contains-any", ["OWEN-CS12", "ALL"]]],
                             [dict(h, id=h["evidence_id"]) for h in evidence_fixture])
    wait_for_condition(lambda: page.query_selector('.ah-handout-notes-input[data-note-handout="h1"]') is not None)

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
    saved = fs_doc(page, "handout_notes/OWEN-CS12_h1") or {}
    record("hub", "editing a note saves it under the right handout_id/agent_code",
           saved.get("handout_id") == "h1" and saved.get("agent_code") == "OWEN-CS12"
           and saved.get("note") == "Updated note from the Agent", str(saved))
    record("hub", "status flips to 'Saved' after the debounced save resolves",
           status_el.text_content() == "Saved", status_el.text_content() if status_el else "")

    page.close()
    return errs

def test_agent_hub_dex_postit(p):
    """v2: the Agent's DEX is in the Agent File's Cell section, the
    initiative list (it replaced the yellow DEX post-it in the dossier
    header), and follows the Agent's characters/{code} document live. A
    Cell member with no character sheet yet is listed without a DEX ("—")."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    st = {"v": 1, "stats": {"DEX": 14, "STR": 10, "CON": 10, "POW": 10}, "csStats": {"DEX": 14, "STR": 10, "CON": 10, "POW": 10},
          "derived": {"hp": 10, "wp": 10, "san": 50, "bp": 40}, "bio": {"name": "Owen Castillo"}}
    install_firestore_backend(page, {
        "briefs/OWEN-CS12": {"char_name": "Owen Castillo", "codename": "Ferro"},
        "briefs/PRIY-AN34": {"char_name": "Priya Anand"},
        "characters/OWEN-CS12": character_doc("OWEN-CS12", st),
        "cells/cell_1": {"name": "Cell Alpha", "member_codes": ["OWEN-CS12", "PRIY-AN34"]},
    })
    page.add_init_script("localStorage.setItem('dg_agent_roster', JSON.stringify(%s));" % json.dumps({
        "OWEN-CS12": {"code": "OWEN-CS12", "char_name": "Owen Castillo", "codename": "Ferro", "saved_at": 2000}}))
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    _open_cell(page, code="OWEN-CS12")
    page.wait_for_selector("#ah-sheet-OWEN-CS12 .ap-init", timeout=10000)
    rows = page.eval_on_selector_all("#ah-sheet-OWEN-CS12 .ap-init li", "els => els.map(e => e.innerText.replace(/\\s+/g, ' ').trim())")
    record("hub", "the Agent's DEX leads their line in the Cell's initiative list (no DEX post-it any more)",
           len(rows) == 2 and rows[0].startswith("14") and "Owen Castillo" in rows[0] and page.locator("#ah-dex-OWEN-CS12").count() == 0, str(rows))
    record("hub", "a Cell member with no character sheet is listed without a DEX",
           rows[1].startswith("—") and "Priya Anand" in rows[1], str(rows))
    wait_for_condition(lambda: any(l["path"] == "characters/OWEN-CS12" for l in page.evaluate("() => window.__dgFirestoreListeners || []")), timeout_ms=8000)
    st2 = dict(st, csStats=dict(st["csStats"], DEX=16), stats=dict(st["stats"], DEX=16))
    push_firestore_doc_snapshot(page, "characters/OWEN-CS12", True, {"character_json": json.dumps(st2)})
    live = wait_for_condition(lambda: (lambda t: t if t.startswith("16") else None)(page.inner_text("#ah-sheet-OWEN-CS12 .ap-init li:first-child")), timeout_ms=6000)
    record("hub", "…and follows a change to the Agent's sheet live", bool(live), str(live))
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

    # Owen has a character; Priya only an Agent File.
    install_firestore_backend(page, {
        "characters/OWEN-CS12": character_doc("OWEN-CS12", {}, ""),
        "briefs/OWEN-CS12": {"char_name": "Owen Castillo"},
        "briefs/PRIY-AN34": {"char_name": "Priya Anand"},
    })

    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    roster = {
        "OWEN-CS12": {"code": "OWEN-CS12", "char_name": "Owen Castillo", "saved_at": 2000},
        "PRIY-AN34": {"code": "PRIY-AN34", "char_name": "Priya Anand", "saved_at": 1000},
    }
    page.evaluate("(r) => localStorage.setItem('dg_agent_roster', JSON.stringify(r))", roster)
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(1200)

    # v2: the Agent File is the character sheet -- no Play button; Recruit
    # only for an Agent with no sheet yet.
    owen_hidden = page.eval_on_selector('#ah-play-OWEN-CS12', "el => el.hidden")
    record("hub", "an Agent with a character sheet gets no Play/Recruit button (the Agent File is the sheet)", owen_hidden, str(owen_hidden))
    # textContent, not inner_text: the stamp's CSS applies text-transform:
    # uppercase, which inner_text would render as-displayed rather than
    # the raw DOM text this is actually checking for.
    record("hub", "no 'No Character Sheet Yet' stamp for the Agent that already has one",
           "No Character Sheet Yet" not in page.eval_on_selector("#ah-charstamp-OWEN-CS12", "el => el.textContent"), "")

    page.click('.tw[data-tab="PRIY-AN34"] > span')
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
    interactive -- the Handler types the REAL Handler password (used to
    be a separate, client-side-only, hardcoded public flavor password
    here, MASTICATE, with a second real-password prompt further down the
    page -- collapsed into one on request, see BUGFIXES.md) and presses
    Enter, which calls the real (mocked) handlerLogin Cloud Function.
    Wrong password -> shows the real handlerLogin rejection reason
    (e.g. "invalid Handler password"), gate stays up, retry. Right
    password -> acces_granted, the Delta Green triangle logo fades in,
    then the gate clears to reveal the A-Cell hub (Play / Cells / Music
    sections) ALREADY Handler-signed-in, no second prompt anywhere.
    Session-gated like the boot splash: unlocks once per tab, re-asks in
    a fresh session. The mock's handlerLogin only accepts 'testpw' now
    (see NOTES_FIRESTORE_STUB's own comment) -- unlike the old flavor
    gate, this is a real credential check, so it is deliberately NOT
    case-insensitive."""
    errs_all = []

    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    install_notes_firestore_stub(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)

    record("acell", "gate is visible on first load with the clearance prompt",
           page.is_visible("#acell-gate") and "enter_clearance_code:" in page.inner_text("#acell-term-log"), "")

    # Wrong password -> denied, gate stays up. The field is a plain
    # type="text" input showing the real typed value directly -- X
    # masking was deliberately removed (see a-cell.html's own comment on
    # grantAccess(): it was hiding real mistyped-password mistakes with
    # no way to proofread before hitting Enter).
    page.fill("#acell-pw-input", "WRONGPASS")
    record("acell", "the password field shows the real typed value, not masked",
           page.input_value("#acell-pw-input") == "WRONGPASS", page.input_value("#acell-pw-input"))
    record("acell", "the password field is a plain text input, not the browser's own type=password dots",
           page.eval_on_selector("#acell-pw-input", "el => el.type") == "text", "")
    page.press("#acell-pw-input", "Enter")
    page.wait_for_timeout(300)
    # Shows the real handlerLogin rejection reason now (e.g. "invalid
    # Handler password") rather than a generic "access_denied" -- more
    # useful for a real Handler troubleshooting a real credential than
    # the old flavor gate's fixed string ever was.
    record("acell", "wrong password shows the real rejection reason and keeps the gate up",
           "invalid Handler password" in page.inner_text("#acell-term-log") and page.is_visible("#acell-gate"), "")
    record("acell", "the input is re-enabled after a wrong password so the Handler can retry",
           not page.eval_on_selector("#acell-pw-input", "el => el.disabled"), "")

    # Correct password -> granted, logo, gate clears, AND the same action
    # signed the Handler in (no separate password box left anywhere).
    page.fill("#acell-pw-input", "testpw")
    page.press("#acell-pw-input", "Enter")
    page.wait_for_timeout(300)
    record("acell", "correct password shows acces_granted",
           "acces_granted" in page.inner_text("#acell-term-log"), "")
    page.wait_for_timeout(2500)
    record("acell", "gate is removed from the DOM after unlock",
           page.query_selector("#acell-gate") is None, "")
    record("acell", "A-Cell hub (Play/Cells/Music sections) is visible after unlock",
           page.is_visible("text=Play") and page.is_visible("text=Cells") and page.is_visible("text=Music"), "")
    record("acell", "body scroll lock is released after unlock",
           not page.eval_on_selector("body", "el => el.classList.contains('acell-lock')"), "")
    record("acell", "no separate Handler-password box exists anywhere on the page",
           page.query_selector("#acell-handler-auth") is None, "")
    record("acell", "the gate's own password sign-in already authenticated as Handler (a-cell.html's shared Firebase Auth mock)",
           page.evaluate("() => window.__dgFirestoreAuthUser && window.__dgFirestoreAuthUser.uid") == "handler", "")

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
    install_notes_firestore_stub(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)
    page.locator("#acell-pw-input").press_sequentially("testpw", delay=30)
    page.press("#acell-pw-input", "Enter")
    page.wait_for_timeout(300)
    record("acell", "typing the password character-by-character (not pasting) still grants access",
           "acces_granted" in page.inner_text("#acell-term-log"), page.inner_text("#acell-term-log"))
    errs_all.extend(errs)
    page.close()

    # Mid-string backspace while typing -- the beforeinput fix tracks edits
    # by selection position, not just appends at the end, so this needs its
    # own check: type "testpww", backspace out the wrong trailing "w"s,
    # then finish with the right ending.
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    install_notes_firestore_stub(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)
    pw_input = page.locator("#acell-pw-input")
    pw_input.press_sequentially("testpww", delay=20)
    page.press("#acell-pw-input", "Backspace")
    page.press("#acell-pw-input", "Enter")
    page.wait_for_timeout(300)
    record("acell", "typing with a mid-entry correction (backspace) still resolves to the right value",
           "acces_granted" in page.inner_text("#acell-term-log"), page.inner_text("#acell-term-log"))
    errs_all.extend(errs)
    page.close()

    # Same-tab reload -> gate skipped (sessionStorage-gated, like the boot
    # splash), and the Handler session itself is silently re-established
    # from the password the gate cached (see the Handler Auth block's own
    # "Same-tab reload once already unlocked" comment) -- no re-prompt of
    # any kind.
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    install_notes_firestore_stub(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)
    page.fill("#acell-pw-input", "testpw")
    page.press("#acell-pw-input", "Enter")
    page.wait_for_timeout(2500)
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(300)
    record("acell", "gate is skipped on a same-tab reload once unlocked",
           page.query_selector("#acell-gate") is None, "")
    record("acell", "the Handler session is silently re-established on reload, no re-prompt",
           page.evaluate("() => window.__dgFirestoreAuthUser && window.__dgFirestoreAuthUser.uid") == "handler", "")
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

    fake_cells = [
        {"cell_id": "cell_1", "name": "Cell Alpha", "handler": "Gergo", "member_codes": ["OWEN-CS12"]},
        {"cell_id": "cell_2", "name": "Cell Bravo", "handler": "Gergo", "member_codes": ["PRIY-AN34"]},
    ]

    # Play's own roster/Cell-filter now come from live Firestore reads
    # (characters/briefs/cells, all public-read) instead of
    # list_characters/list_cells JSONP -- see startCharacterListeners()/
    # startCellsListener() in a-cell.html. 
    install_notes_firestore_stub(page)

    # Opening an Agent reads their full sheet from characters/{code}.
    install_firestore_backend(page, {"characters/" + c: character_doc(c, st) for c, st in fake_full.items()})

    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)

    def char_doc(code):
        st = fake_full[code]
        bio = st.get("bio", {})
        return {"id": code, "character_json": json.dumps({"bio": bio, "derived": st.get("derived", {}), "csStats": st.get("csStats", {})}),
                "updated_at": "", "player_name": bio.get("player_name", "")}

    wait_for_condition(lambda: any(l["path"] == "characters" for l in page.evaluate("() => window.__dgFirestoreListeners || []")), timeout_ms=8000)
    push_firestore_snapshot(page, "characters", [], [char_doc(c) for c in fake_order])
    push_firestore_snapshot(page, "briefs", [], [])
    push_firestore_snapshot(page, "cells", [], [dict(c, id=c["cell_id"]) for c in fake_cells])

    names = wait_for_condition(lambda: page.eval_on_selector_all("#play-agent-list .pa-name", "els => els.map(e=>e.textContent)")
                                if "Owen Castillo" in page.inner_text("#play-agent-list") else None)
    record("acell", "Play lists every Agent on file, not just this browser's own roster",
           names == ["Owen Castillo", "Priya Anand", "Marcus Reyes"], str(names))

    page.click("#acell-tab-strip .tw[data-tab=play]")  # v3.12.0: A-Cell opens on Session prep
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

    # A live update (someone else's save landing in Firestore) now
    # arrives automatically via the onSnapshot listener -- no Refresh
    # click needed. renderList() re-opens the currently-selected Agent
    # on every listener update (dropping their cached full sheet so it
    # re-fetches), keeping the selected panel showing their updated view
    # instead of going stale underneath an unrelated roster refresh.
    fake_full["OWEN-CS12"]["csStats"]["CHA"] = 99
    page.evaluate("(d) => { window.__dgFirestoreDocs['characters/OWEN-CS12'] = d; }",
                  character_doc("OWEN-CS12", fake_full["OWEN-CS12"]))
    push_firestore_snapshot(page, "characters", [], [char_doc(c) for c in fake_order])
    stat_vals_after = wait_for_condition(
        lambda: (lambda v: v if v == ["12", "13", "14", "15", "10", "99"] else None)(
            page.eval_on_selector_all("#play-view .pv-stat .val", "els => els.map(e=>e.textContent)")))
    record("acell", "a live Firestore update refreshes an open Agent's view automatically, no Refresh click needed",
           stat_vals_after == ["12", "13", "14", "15", "10", "99"], str(stat_vals_after))

    page.click("#play-refresh-btn")
    page.wait_for_timeout(200)
    record("acell", "Refresh (now just a re-render from already-live state) still shows an 'Updated' timestamp note",
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

    # Cell-wide Initiative Tracker: a yellow post-it above the vitals
    # rows, everyone in the filtered Cell ranked by DEX descending
    # (Delta Green's own initiative order) -- reads the same csStats.DEX
    # rebuildAllCharacters() already pulled out of the live characters/
    # snapshot, no extra fetch. A Cell with 2+ members actually exercises
    # the sort; deliberately excludes Priya (still selected from the
    # click above) so the filter switch clears the stale selection and
    # actually shows the Dashboard instead of her still-in-view dossier
    # (see renderList()'s own "still there" comment in a-cell.html).
    # Plus a walk-in Friendly (friendly.html): no characters/ doc, its
    # DEX comes from friendly/pregens.json.
    fr = json.load(open(os.path.join(HERE, "..", "friendly", "pregens.json")))["pregens"][0]
    fake_cells_with_charlie = fake_cells + [
        {"cell_id": "cell_3", "name": "Cell Charlie", "handler": "Gergo",
         "member_codes": ["OWEN-CS12", "MARC-9XQ2", fr["id"]]}
    ]
    push_firestore_snapshot(page, "cells", [], [dict(c, id=c["cell_id"]) for c in fake_cells_with_charlie])
    wait_for_condition(lambda: "Cell Charlie" in (page.eval_on_selector_all(
        "#play-cell-filter option", "els => els.map(e=>e.textContent)") or []))
    page.select_option("#play-cell-filter", label="Cell Charlie")
    page.wait_for_timeout(200)
    initiative_names = page.eval_on_selector_all("#play-view .cdb-initiative-row .nm", "els => els.map(e=>e.textContent)")
    initiative_dex = page.eval_on_selector_all("#play-view .cdb-initiative-row .dx", "els => els.map(e=>e.textContent)")
    # Marcus Reyes is KIA (0 HP) and takes no more turns.
    expected = sorted([("Owen Castillo", 14), (fr["name"] + " (Friendly)", fr["stats"]["DEX"]["value"])],
                      key=lambda r: -r[1])
    record("acell", "Cell Dashboard shows an Initiative Tracker ranked by DEX descending, Friendlies included, KIA Agents left out",
           initiative_names == [r[0] for r in expected] and initiative_dex == [str(r[1]) for r in expected],
           str((initiative_names, initiative_dex)))

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

def watch_apps_script(page):
    """Every request this page (or its frames) makes to Apps Script. The
    Sheet is retired: only the Drive image proxy (action=imgdata) is
    still expected there."""
    seen = []
    page.on("request", lambda r: seen.append(r.url) if "script.google.com" in r.url else None)
    return seen

def fs_queries(page, path):
    """How many stubbed Firestore query reads hit this collection path."""
    return page.evaluate("(p) => (window.__dgFsQueries || []).filter(q => q.path === p).length", path)

def test_acell_sheet_loads_once_when_opened(p):
    """Live report: Friendly -> A-Cell Music -> Agent Hub -> back to
    A-Cell, and the Sheet tab sat on "Loading agents..." then showed
    "Could not load the roster". Every A-Cell page load used to load the
    Sheet tab (and Evidence's folder lists) at load AND again on
    dg-acell-handler-ready, whether or not either tab was opened. Now:
    nothing from the Sheet until its tab is opened, then exactly one
    load; Evidence's folder lists once; the Cell column reads Firestore
    Cells. All of it from Firestore -- no Apps Script call at all."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)
    page.add_init_script("""
        try { sessionStorage.setItem('dg_acell_pw', 'testpw'); } catch (e) {}
    """)
    install_firestore_backend(page, {
        "characters/OWEN-CS12": character_doc("OWEN-CS12", {"bio": {"name": "Owen Castillo"}, "derived": {"hp": 12, "san": 50}}, ""),
        "cells/cell_fs": {"name": "Firestore Table", "handler": "Sam", "member_codes": ["OWEN-CS12"]},
    })
    apps_script = watch_apps_script(page)

    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    wait_for_condition(lambda: page.evaluate("() => window.__dgFirestoreAuthUser && window.__dgFirestoreAuthUser.uid") == "handler", timeout_ms=6000)
    page.wait_for_timeout(1500)
    # The stub's sign-in resolves before the later tab blocks even
    # register their listeners; a real one takes seconds and lands after
    # them. Fire the event again the way that real ordering would.
    page.evaluate("() => window.dispatchEvent(new Event('dg-acell-handler-ready'))")
    page.wait_for_timeout(800)
    # deleted_agents is read only by the Sheet tab (Recently Deleted).
    record("acell", "an A-Cell page load sends none of the Sheet tab's reads until the Sheet is opened",
           fs_queries(page, "deleted_agents") == 0, fs_queries(page, "deleted_agents"))
    # Two readers, once each: Evidence's folders and the tapes (dgTapes.load).
    record("acell", "Evidence's folder lists load once per A-Cell visit, not again after the silent Handler sign-in",
           fs_queries(page, "operations") == 2, fs_queries(page, "operations"))
    page.click('.tw[data-tab="sheet"]')
    wait_for_condition(lambda: "Owen Castillo" in page.inner_text("#sheet-wrap"), timeout_ms=6000)
    row = page.inner_text("#sheet-wrap")
    record("acell", "opening the Sheet tab loads it exactly once",
           fs_queries(page, "deleted_agents") == 1, fs_queries(page, "deleted_agents"))
    record("acell", "the Sheet's Cell and Handler columns read Firestore Cells (made on the Cells tab)",
           "Firestore Table" in row and "Sam" in row, row[:200])
    page.click('.tw[data-tab="play"]'); page.click('.tw[data-tab="sheet"]'); page.wait_for_timeout(500)
    record("acell", "re-opening an already-loaded Sheet tab doesn't re-fetch it (Refresh does)",
           fs_queries(page, "deleted_agents") == 1, fs_queries(page, "deleted_agents"))
    page.click("#sheet-refresh-btn")
    wait_for_condition(lambda: fs_queries(page, "deleted_agents") == 2, timeout_ms=8000)
    record("acell", "the Sheet's Refresh button still re-fetches",
           fs_queries(page, "deleted_agents") == 2, fs_queries(page, "deleted_agents"))
    record("acell", "A-Cell makes no Apps Script call at all (the Sheet is retired)",
           apps_script == [], str(apps_script))
    record("acell", "no JS errors across the lazy Sheet load", not errs, str(errs))
    page.close()


def test_acell_evidence_folders_read_firestore(p):
    """A-Cell's Evidence folders (Cells + Operations) read Firestore --
    Cells made on the Cells tab exist only there. An item filed under an
    Operation that no longer exists just shows as unfiled; nothing asks
    Apps Script any more."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)
    page.add_init_script("try { sessionStorage.setItem('dg_acell_pw', 'testpw'); } catch (e) {}")
    install_firestore_backend(page, {
        "cells/cell_fs": {"name": "Firestore Table", "handler": "Sam", "member_codes": []},
        "operations/op_fs": {"operation_id": "op_fs", "cell_id": "cell_fs", "name": "Mirrored Op", "created_at": 2},
    })
    apps_script = watch_apps_script(page)

    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    wait_for_condition(lambda: page.evaluate("() => window.__dgFirestoreAuthUser && window.__dgFirestoreAuthUser.uid") == "handler", timeout_ms=6000)
    page.click('.tw[data-tab="evidence"]')
    wait_for_condition(lambda: "Firestore Table" in page.inner_text("#evidence-cell-filter"))
    record("acell", "Evidence's Cell picker lists a Cell that exists only in Firestore (made on the Cells tab)",
           "Firestore Table" in page.inner_text("#evidence-cell-filter"), page.inner_text("#evidence-cell-filter"))
    page.select_option("#evidence-cell-filter", "cell_fs")
    wait_for_condition(lambda: "Mirrored Op" in page.inner_text("#evidence-folders"))
    record("acell", "Evidence's Operation folders come from Firestore",
           "Mirrored Op" in page.inner_text("#evidence-folders"), page.inner_text("#evidence-folders"))
    wait_for_condition(lambda: any(l["path"] == "evidence" for l in page.evaluate("() => window.__dgFirestoreListeners || []")))
    push_firestore_snapshot(page, "evidence", [], [
        {"id": "ev2", "title": "Orphaned Item", "body": "", "photo": "", "cell_id": "cell_fs",
         "operation_id": "op_gone", "created_at": 6, "released": True, "restricted_to": []}])
    page.click('[data-op=""]')
    wait_for_condition(lambda: "Orphaned Item" in page.inner_text("#evidence-list"))
    record("acell", "an item filed under a deleted Operation shows as Unfiled",
           "Orphaned Item" in page.inner_text("#evidence-list"), page.inner_text("#evidence-list"))
    page.wait_for_timeout(600)
    record("acell", "the Evidence tab makes no Apps Script call (the Sheet is retired)",
           apps_script == [], str(apps_script))
    record("acell", "no JS errors reading Evidence folders from Firestore", not errs, str(errs))
    page.close()

def test_agent_hub_checks_read_firestore(p):
    """Agent Hub's per-Agent "has a sheet?" and KIA checks read
    characters/{code} from Firestore (one read shared by both). Firestore
    is the only backend now, so a missing doc means no sheet yet (Recruit)
    -- but a read that FAILS must never mark an Agent as having no sheet,
    or purge it from the roster."""
    roster = json.dumps({
        "DEAD-0001": {"code": "DEAD-0001", "char_name": "Owen Castillo", "saved_at": 1000},
        "ALIV-0002": {"code": "ALIV-0002", "char_name": "Priya Anand", "saved_at": 2000},
    })
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    install_firestore_backend(page, {
        "characters/DEAD-0001": character_doc("DEAD-0001", {"derived": {"hp": 0}}, ""),
        "briefs/ALIV-0002": {"char_name": "Priya Anand"},
        "operations/op_fs": {"operation_id": "op_fs", "cell_id": "cell_x", "name": "Mirrored Op", "created_at": 1},
    })
    apps_script = watch_apps_script(page)
    page.add_init_script(f"localStorage.setItem('dg_agent_roster', '{roster}');")
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    wait_for_condition(lambda: "KIA" in page.inner_text("#ah-charstamp-DEAD-0001"))
    page.wait_for_timeout(800)
    record("hub", "an Agent's KIA stamp comes from its Firestore character doc",
           "KIA" in page.inner_text("#ah-charstamp-DEAD-0001"), page.inner_text("#ah-charstamp-DEAD-0001"))
    record("hub", "an Agent with an Agent File but no character doc shows No Character Sheet Yet",
           "No Character Sheet Yet" in page.eval_on_selector("#ah-charstamp-ALIV-0002", "el => el.textContent"), "")
    record("hub", "Agent Hub makes no Apps Script call (the Sheet is retired)", apps_script == [], str(apps_script))
    record("hub", "no JS errors reading Agent Hub checks from Firestore", not errs, str(errs))
    page.close()

    # Firestore unreachable: nothing is marked "no sheet", nothing purged.
    page = p.new_page()
    page.set_default_timeout(8000)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    install_firestore_backend(page)
    page.add_init_script("window.__dgFsFail = true;")
    page.add_init_script(f"localStorage.setItem('dg_agent_roster', '{roster}');")
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(1500)
    labels = page.eval_on_selector_all(".tw:not(.tw-switch) > span", "els => els.map(e=>e.textContent)")
    record("hub", "a failed Firestore read never marks an Agent as having no sheet",
           "No Character Sheet Yet" not in page.eval_on_selector("#ah-charstamp-ALIV-0002", "el => el.textContent")
           and page.eval_on_selector("#ah-play-ALIV-0002", "el => el.hidden"), "")
    record("hub", "a failed Firestore read never purges an Agent from this device's roster",
           any("Priya" in l for l in labels) and any("Owen" in l for l in labels), str(labels))
    page.close()


def test_acell_handler_session_race(p):
    """Regression test, updated for the Handler-auth unification: this
    used to cover a race around the old handler_login Apps Script
    action's opaque dg_acell_session token going stale before Play/
    Cells/Evidence's own reads landed. That whole backend (handler_login
    action, dg_acell_session, requireHandlerSession_()) is gone --
    Handler auth is now ONE Firebase sign-in (handlerLogin Cloud
    Function -> ID token, see the shared Handler-auth block near the
    top of a-cell.html), and Play/Cells/Evidence's own reads are public
    Firestore listeners that never depended on a Handler session at all
    (see each assertion's own comment below for why). What's still
    worth testing here: (1) a saved dg_acell_pw from a previous visit
    silently re-authenticates via that same Firebase flow on page load,
    with no user interaction, and (2) a Handler-gated write made after
    that silent re-login actually carries a real id_token end to end
    (window.__dgGetHandlerIdToken() -> the Apps Script POST body), not
    just that sign-in succeeded in isolation."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    install_notes_firestore_stub(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)
    # Seed a saved Handler password, exactly like a returning tab that
    # signed in earlier this same browser session. Must be 'testpw' --
    # the shared Firebase mock's handlerLogin now actually checks the
    # password (see NOTES_FIRESTORE_STUB's own comment) instead of
    # always succeeding, and only accepts that one value.
    page.add_init_script("""
        try { sessionStorage.setItem('dg_acell_pw', 'testpw'); } catch (e) {}
    """)

    chars_fixture = [{"agent_code": "OWEN-CS12", "name": "Owen Castillo", "profession": "Federal Agent",
                       "nationality": "", "player_name": "", "hp": 10, "wp": 10, "san": 50, "bp": 40, "updated_at": ""}]
    cells_fixture = [{"cell_id": "cell_1", "name": "Cell Alpha", "handler": "Sam", "member_codes": [], "channel": ""}]
    evidence_fixture = [{"evidence_id": "ev1", "title": "Confidential Photo", "body": "", "photo": "",
                          "cell_id": "", "operation_id": "", "released": False, "restricted_to": [], "created_at": "1000"}]

    def fake_apps_script(route):
        req = route.request
        url = req.url
        if req.method == "POST":
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        if "callback=" not in url:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        cb = url.split("callback=")[1].split("&")[0]
        if "action=list_cells" in url:
            res = {"status": "OK", "cells": cells_fixture}
        elif "action=list_operations" in url:
            res = {"status": "OK", "operations": []}
        else:
            res = {"status": "OK"}
        route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
    page.route("**/script.google.com/**", fake_apps_script)

    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)

    wait_for_condition(lambda: page.evaluate("() => window.__dgFirestoreAuthUser && window.__dgFirestoreAuthUser.uid") == "handler", timeout_ms=6000)
    record("acell", "a saved Handler password silently signs into Firebase on page load, no interaction needed",
           page.evaluate("() => window.__dgFirestoreAuthUser && window.__dgFirestoreAuthUser.uid") == "handler",
           str(page.evaluate("() => window.__dgFirestoreAuthUser")))

    # Play's roster is a public-read Firestore listener -- it never
    # depended on any Handler session at all, so it's immune to this
    # whole class of race by construction. Checked on the default tab,
    # before switching away below.
    wait_for_condition(lambda: any(l["path"] == "characters" for l in page.evaluate("() => window.__dgFirestoreListeners || []")), timeout_ms=8000)
    push_firestore_snapshot(page, "characters", [], [dict(c, id=c["agent_code"], character_json=json.dumps({"bio": {"name": c["name"]}, "derived": {}})) for c in chars_fixture])
    push_firestore_snapshot(page, "briefs", [], [])
    push_firestore_snapshot(page, "cells", [], [dict(c, id=c["cell_id"]) for c in cells_fixture])
    names = wait_for_condition(lambda: page.eval_on_selector_all("#play-agent-list .pa-name", "els => els.map(e=>e.textContent)")
                                if "Owen Castillo" in page.inner_text("#play-agent-list") else None)
    record("acell", "Play shows the roster immediately via its own public-read Firestore listener, no Handler session involved",
           names == ["Owen Castillo"], page.inner_text("#play-agent-list"))

    # Cells' own reads are the same public-read characters/cells
    # listeners Play uses -- the push above already reached this tab's
    # own listeners too (registered at page load, not gated on the tab
    # being clicked), well before this click.
    page.click('.tw[data-tab="cells"]')
    cells_text = wait_for_condition(lambda: page.inner_text("#cells-groups")
                                     if "Cell Alpha" in page.inner_text("#cells-groups") else None)
    record("acell", "Cells shows the roster immediately too, no Handler session involved in the read",
           bool(cells_text) and "Cell Alpha" in cells_text, page.inner_text("#cells-groups"))

    # Prove the SAME silent sign-in confirmed above is what authorizes
    # the one thing on this tab that's Handler-gated: a write (Delete Cell,
    # a direct Firestore delete via ensureHandlerSignedIn() -- see the
    # Cells tab's own header comment in a-cell.html). No id_token/
    # handler_password Apps Script POST is involved at all anymore; the
    # race this test exists for would show up here as either the delete
    # never landing (a second, failed sign-in attempt) or a permission-
    # denied error (the wrong/no auth.currentUser by the time it fires).
    page.once("dialog", lambda d: d.accept())
    page.click("[data-delete-cell]")
    delete_write = wait_for_condition(lambda: next((w for w in firestore_writes(page, "cells/") if w["path"] == "cells/cell_1" and w["op"] == "delete"), None), timeout_ms=6000)
    record("acell", "a Handler write after silent re-login succeeds via the same cached Firebase sign-in",
           bool(delete_write), str(delete_write))

    # Evidence itself reads from its own live Firestore listener too,
    # gated on isHandler() server-side for the id_token it now sends
    # (see jsonpGet()'s own comment), not any session staleness here.
    page.click('.tw[data-tab="evidence"]')
    wait_for_condition(lambda: notes_firestore_listener_count(page) >= 1, timeout_ms=8000)
    push_firestore_snapshot(page, "evidence", [], [dict(e, id=e["evidence_id"]) for e in evidence_fixture])
    evidence_text = wait_for_condition(lambda: page.inner_text("#evidence-list")
                                        if "Confidential Photo" in page.inner_text("#evidence-list") else None)
    record("acell", "Evidence renders correctly via its own Firestore listener on this page too",
           bool(evidence_text) and "Confidential Photo" in evidence_text, page.inner_text("#evidence-list"))

    page.close()
    return errs

def test_acell_cells(p):
    """a-cell.html's Cells tab: real named Cell groups (a Handler + a
    set of member Agents picked from the full roster), not a per-Agent
    text tag. One Agent can belong to more than one Cell; an Agent in
    none shows up under "Unassigned Agents". Reads (cells/characters)
    are now live, public-read Firestore listeners -- same pattern as
    the Play tab -- so this test pushes snapshots instead of mocking
    list_cells/list_characters JSONP. Create/Delete Cell write straight
    to Firestore now (no server-side side effect beyond that one doc);
    simulated here by reading the write back off the stub and re-pushing
    a cells/ snapshot, same as create_cell/delete_cell's real dual-write
    landing. update_cell_members deliberately stays Apps Script-mediated
    (it also carries forward solo Notes and recomputes Evidence
    visibility -- see the Cells tab's own header comment in a-cell.html)
    -- still a no-cors POST simulated the same way as before."""
    page = p.new_page()
    page.set_default_timeout(30000)
    errs = collect_errors(page)
    install_notes_firestore_stub(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)
    # Cell writes (create/update_cell_members/delete_cell) are Handler-
    # gated -- window.__dgGetHandlerIdToken() needs a signed-in Handler,
    # which needs a saved password to silently sign in on load.
    page.add_init_script("try { sessionStorage.setItem('dg_acell_pw', 'testpw'); } catch (e) {}")

    fake_characters = [
        {"agent_code": "OWEN-CS12", "name": "Owen Castillo", "profession": "Federal Agent"},
        {"agent_code": "PRIY-AN34", "name": "Priya Anand", "profession": "Forensic Accountant"},
        {"agent_code": "MARC-9XQ2", "name": "Marcus Reyes", "profession": "Pilot"},
    ]
    cells_state = []
    posts = []

    def on_post(body):
        # Mutate cells_state BEFORE appending to posts -- wait_post_and_sync()
        # polls `posts` from a separate loop and calls sync_cells() the
        # instant it sees a match, so if the append happened first, a poll
        # landing between these two lines could push a snapshot still
        # missing this very mutation.
        if body.get("action") == "update_cell_members":
            for c in cells_state:
                if c["cell_id"] == body.get("cell_id"):
                    c["member_codes"] = body.get("member_codes", [])
        posts.append(body)
    tap_acell_posts(page, on_post)

    def sync_cells():
        push_firestore_snapshot(page, "cells", [], [dict(c, id=c["cell_id"]) for c in cells_state])

    def wait_post_and_sync(predicate, timeout_ms=75000):
        # Real bug found running this under a loaded full suite (not a
        # one-off): the previous version called wait_for_condition() once
        # (default 25s) then called sync_cells() unconditionally --
        # including on a timeout, silently pushing whatever cells_state
        # already held (possibly still missing the write this call was
        # waiting for) with no signal that the wait had actually failed.
        # Every later DOM-level wait_for_condition() then had nothing left
        # to ever succeed on, so this failure surfaced tens of seconds
        # later on an unrelated-looking assertion. Retries in its own
        # loop instead of a single wait+sync, so a POST landing anywhere
        # up to timeout_ms still gets picked up; only gives up (leaving
        # the caller's own DOM check to report the real failure) after
        # that.
        #
        # 40s wasn't actually the fix -- confirmed live by instrumenting
        # every hop (click handler, ensureHandlerSignedIn/getIdToken,
        # fetch(), and this route interception itself) with wall-clock
        # timestamps and re-running until it reproduced: every hop DOES
        # complete correctly and near-instantly (sub-second) in the
        # common case, but under real load this whole chain -- Handler
        # auth + a real browser fetch() + Playwright's own route
        # interception -- occasionally stalls for well over a minute
        # before delivering, with no error or hang at any single step
        # (this isn't the app silently failing, it's this sandboxed
        # Chromium+CDP round trip occasionally taking far longer than
        # 40s under load). 75s gives real headroom without costing
        # anything on the near-universal fast path.
        import time
        deadline = time.monotonic() + timeout_ms / 1000
        while time.monotonic() < deadline:
            if any(predicate(b) for b in posts):
                sync_cells()
                return
            time.sleep(0.2)

    # Same "poll instead of one wait+sync" discipline as wait_post_and_sync
    # above, for Create/Delete Cell's direct Firestore write instead of an
    # Apps Script POST -- match_write identifies the one top-level
    # cells/{cellId} write (create: a 'set'; delete: a 'delete') this
    # particular action produced, out of everything firestore_writes()
    # has accumulated so far. Mutates cells_state to reflect it (merging
    # a create's fields in, or dropping a deleted cell_id) and re-pushes,
    # same as sync_cells() above. Returns the cell_id found, or None on
    # timeout.
    def wait_cell_write_and_sync(match_write, timeout_ms=40000):
        import time
        deadline = time.monotonic() + timeout_ms / 1000
        while time.monotonic() < deadline:
            top_level_writes = [w for w in firestore_writes(page, "cells/") if w["path"].count("/") == 1]
            match = next((w for w in top_level_writes if match_write(w)), None)
            if match:
                cell_id = match["path"].split("/")[-1]
                if match["op"] == "delete":
                    cells_state[:] = [c for c in cells_state if c["cell_id"] != cell_id]
                else:
                    existing = next((c for c in cells_state if c["cell_id"] == cell_id), None)
                    if existing:
                        existing.update(match["data"])
                    else:
                        cells_state.append(dict({"cell_id": cell_id, "name": "", "handler": "", "member_codes": [], "channel": ""}, **match["data"]))
                sync_cells()
                return cell_id
            time.sleep(0.2)
        return None

    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    wait_for_condition(lambda: any(l["path"] == "characters" for l in page.evaluate("() => window.__dgFirestoreListeners || []"))
                        and any(l["path"] == "cells" for l in page.evaluate("() => window.__dgFirestoreListeners || []")),
                        timeout_ms=8000)
    push_firestore_snapshot(page, "characters", [],
                             [{"id": c["agent_code"], "character_json": json.dumps({"bio": {"name": c["name"]}})} for c in fake_characters])
    sync_cells()
    # Cells lives behind its own folder tab now (Play is active by default).
    page.click('.tw[data-tab="cells"]')
    page.wait_for_timeout(300)

    record("acell", "Cells starts empty with a prompt to create one",
           "No Cells yet" in page.inner_text("#cells-groups"), "")
    unassigned = wait_for_condition(lambda: (page.inner_text("#cells-unassigned")
                                              if "Owen Castillo" in page.inner_text("#cells-unassigned") else None))
    record("acell", "every Agent on file starts out Unassigned",
           bool(unassigned) and "Priya Anand" in unassigned and "Marcus Reyes" in unassigned, unassigned or "")

    # Clicking an Unassigned Agent chip before any Cell exists should
    # open the assign popup with a clear "create one first" message,
    # not an empty or broken list.
    page.click('[data-assign-code="OWEN-CS12"]')
    page.wait_for_timeout(150)
    record("acell", "the assign popup, with no Cells yet, tells the Handler to create one first",
           "No Cells exist yet" in page.inner_text("#cell-assign-backdrop"), page.inner_text("#cell-assign-backdrop"))
    page.click("[data-assign-cancel]")
    page.wait_for_timeout(100)
    record("acell", "Cancel closes the assign popup without sending anything",
           page.locator("#cell-assign-backdrop").count() == 0, "")

    # Create a Cell. Polls for the confirmed state instead of a fixed
    # sleep -- a direct Firestore write under system load can still take
    # longer than any one fixed wait, so poll up to a generous cap rather
    # than risk a flaky false failure (or wasting time when it's fast).
    page.click("#cells-create-btn")
    page.wait_for_timeout(150)
    page.fill("#cells-new-name", "Cell Alpha")
    page.fill("#cells-new-handler", "Sam")
    page.click("#cells-new-confirm")
    alpha_id = wait_cell_write_and_sync(lambda w: w["data"].get("name") == "Cell Alpha")
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
    wait_post_and_sync(lambda b: b.get("action") == "update_cell_members" and b.get("cell_id") == alpha_id
                        and set(b.get("member_codes", [])) == {"OWEN-CS12"})
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
    bravo_id = wait_cell_write_and_sync(lambda w: w["data"].get("name") == "Cell Bravo")
    wait_for_condition(lambda: page.locator('.cell-card[data-i="1"]').count() > 0)
    page.select_option('[data-add-select="1"]', "OWEN-CS12")
    page.click('[data-add-btn="1"]')
    wait_post_and_sync(lambda b: b.get("action") == "update_cell_members" and b.get("cell_id") == bravo_id
                        and set(b.get("member_codes", [])) == {"OWEN-CS12"})
    def bravo_members():
        return page.inner_text('.cell-card[data-i="1"] .cell-members')
    wait_for_condition(lambda: "Owen Castillo" in bravo_members())
    record("acell", "one Agent can belong to more than one Cell at once",
           "Owen Castillo" in alpha_members() and "Owen Castillo" in bravo_members(), "")

    # Remove Owen from Cell Alpha -- he should still show in Cell Bravo,
    # and still not be Unassigned (Bravo still has him).
    page.click('.cell-card[data-i="0"] button[data-remove-agent="OWEN-CS12"]')
    wait_post_and_sync(lambda b: b.get("action") == "update_cell_members" and b.get("cell_id") == alpha_id
                        and set(b.get("member_codes", [])) == set())
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
    wait_post_and_sync(lambda b: b.get("action") == "update_cell_members" and b.get("cell_id") == bravo_id
                        and set(b.get("member_codes", [])) == {"OWEN-CS12", "PRIY-AN34", "MARC-9XQ2"})
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
    wait_cell_write_and_sync(lambda w: w["path"] == "cells/" + bravo_id and w["op"] == "delete")
    wait_for_condition(lambda: "Cell Bravo" not in page.inner_text("#cells-groups"))
    record("acell", "accepting Delete Cell removes the grouping",
           "Cell Bravo" not in page.inner_text("#cells-groups"), page.inner_text("#cells-groups"))
    record("acell", "deleting a Cell doesn't delete its Agents -- they fall back to Unassigned instead",
           "Owen Castillo" in page.inner_text("#cells-unassigned")
           and "Priya Anand" in page.inner_text("#cells-unassigned")
           and "Marcus Reyes" in page.inner_text("#cells-unassigned"),
           page.inner_text("#cells-unassigned"))

    # Now Cell Alpha exists again and Priya is Unassigned -- the popup
    # should list it as a one-click destination.
    page.click('[data-assign-code="PRIY-AN34"]')
    page.wait_for_timeout(150)
    record("acell", "the assign popup lists existing Cells as options once at least one exists",
           "Cell Alpha" in page.inner_text("#cell-assign-backdrop"), page.inner_text("#cell-assign-backdrop"))
    page.click('#cell-assign-backdrop [data-assign-cell-i="0"]')
    wait_post_and_sync(lambda b: b.get("action") == "update_cell_members" and b.get("cell_id") == alpha_id
                        and set(b.get("member_codes", [])) == {"PRIY-AN34"})
    wait_for_condition(lambda: "Priya Anand" in alpha_members())
    record("acell", "picking a Cell from the assign popup adds the Agent to it",
           "Priya Anand" in alpha_members(), alpha_members())
    record("acell", "the assigned Agent no longer shows as Unassigned",
           "Priya Anand" not in page.inner_text("#cells-unassigned"), "")
    record("acell", "the assign popup closes itself after a successful assignment",
           page.locator("#cell-assign-backdrop").count() == 0, "")

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
    install_notes_firestore_stub(page)
    page.add_init_script("try { sessionStorage.setItem('dg_acell_pw', 'testpw'); } catch (e) {}")
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)

    cells_fixture = [{"cell_id": "cell_1", "name": "Cell Alpha", "handler": "Sam", "member_codes": ["OWEN-CS12", "PRIY-AN34"], "channel": ""}]
    # The backend is the Firestore stub: A-Cell writes evidence/ and
    # operations/ docs itself; this reads them back.
    install_firestore_backend(page, {"cells/cell_1": {k: v for k, v in cells_fixture[0].items() if k != "cell_id"},
                                     "briefs/OWEN-CS12": {"agent_code": "OWEN-CS12", "char_name": "Owen Castillo"}})
    def evidence_state():
        return page.evaluate("() => Object.entries(window.__dgFirestoreDocs || {})"
                             ".filter(([k]) => k.indexOf('evidence/') === 0 && k.split('/').length === 2)"
                             ".map(([k, v]) => Object.assign({}, v, { evidence_id: k.split('/')[1] }))")

    # a-cell.html's Evidence tab reads content from a live Firestore
    # onSnapshot listener now (Phase 5), not from list_evidence -- only
    # create/update go through it (verifyEvidenceWrite_ polls the
    # listener-fed evidenceItems array directly); Released-toggle and
    # Delete still do their own separate list_evidence JSONP read-back,
    # unmigrated, so those two don't need a push. Waits on evidence_state
    # (the backend-side truth) rather than the DOM, since the POST lands
    # asynchronously relative to the click that fired it. The real
    # listener queries .orderBy('created_at', 'desc') and the app trusts
    # the snapshot's own delivery order (no client-side re-sort) --
    # this stub's orderBy() is a no-op, so the docs must already be
    # sorted before pushing to land data-*-evidence="0"-style index
    # selectors on the same item a real backend would put there.
    def push_evidence():
        wait_for_condition(lambda: notes_firestore_listener_count(page) >= 1, timeout_ms=8000)
        ordered = sorted(evidence_state(), key=lambda e: int(e["created_at"]), reverse=True)
        push_firestore_snapshot(page, "evidence", [],
                                 [dict(e, id=e["evidence_id"]) for e in ordered])


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
    owen = wait_for_condition(lambda: page.evaluate("""() => { const i = document.querySelector('#evidence-new-restrict-wrap input[value="OWEN-CS12"]');
        return i && /Owen Castillo/.test(i.parentNode.textContent) ? i.parentNode.textContent.trim() : null; }"""), timeout_ms=8000)
    record("acell", "the restriction checklist names each Agent (from their Agent File), not their code",
           owen == "Owen Castillo", str(owen))
    page.click('#evidence-new-restrict-wrap summary')  # v3.13.0: Only for is a drop-down of names
    page.check('#evidence-new-restrict-wrap input[value="OWEN-CS12"]')
    page.click("#evidence-new-confirm")
    wait_for_condition(lambda: len(evidence_state()) >= 1)
    push_evidence()
    list_text = wait_for_condition(lambda: page.inner_text("#evidence-list")
                                    if "Field Photograph" in page.inner_text("#evidence-list") else None)
    record("acell", "filing evidence into an Operation, released and restricted, shows it once confirmed",
           bool(list_text) and "Field Photograph" in list_text and "cell alpha" in list_text.lower()
           and "operation nightshade" in list_text.lower() and "restricted to: owen castillo" in list_text.lower(),
           list_text or "")
    record("acell", "a released item's card doesn't carry the unreleased (staged) styling",
           "unreleased" not in (page.get_attribute(".evidence-card", "class") or ""), "")

    # showForm()'s own create-button toggle closes the form only once
    # verifyEvidenceWrite_'s *own* delayed polling of evidenceItems
    # confirms the write (up to several seconds) -- a separate, slower
    # path than the live listener push above, which already updated the
    # list. Clicking "+ New Evidence" again before that polling closes
    # the still-open form just toggles it shut instead of opening a
    # fresh one (showForm(null) closes on childNodes.length -- see its
    # own guard), same race that push_evidence() would otherwise cause
    # here since it resolves the list far faster than a real Firestore
    # round-trip would.
    wait_for_condition(lambda: page.query_selector("#evidence-new-confirm") is None)

    # File a second, unfiled, unreleased, unrestricted item in the same Cell.
    page.click("#evidence-create-btn")
    page.wait_for_timeout(150)
    page.fill("#evidence-new-title", "Wire Service Clipping")
    page.select_option("#evidence-new-scope", label="Cell Alpha")
    page.fill("#evidence-new-body", "Three additional livestock deaths reported.")
    page.click("#evidence-new-confirm")
    wait_for_condition(lambda: len(evidence_state()) >= 2)
    push_evidence()
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
    wait_for_condition(lambda: any(e["title"] == "Field Photograph (annotated)" for e in evidence_state()))
    push_evidence()
    wait_for_condition(lambda: "Field Photograph (annotated)" in page.inner_text("#evidence-list"))
    record("acell", "editing evidence updates it in place once confirmed",
           "Field Photograph (annotated)" in page.inner_text("#evidence-list"), page.inner_text("#evidence-list"))
    # Same create-button-toggle race as after the first create above --
    # wait for verifyEvidenceWrite_'s own delayed polling to close this
    # edit's form before the next "+ New Evidence" click.
    wait_for_condition(lambda: page.query_selector("#evidence-new-confirm") is None)

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
    wait_for_condition(lambda: any(e["title"] == "Photo Evidence" for e in evidence_state()))
    push_evidence()
    photo_list_text = wait_for_condition(lambda: page.inner_text("#evidence-list")
                                          if "Photo Evidence" in page.inner_text("#evidence-list") else None)
    record("acell", "filing evidence with a real-sized photo (>64KiB base64) still reaches the backend",
           bool(photo_list_text) and "Photo Evidence" in photo_list_text
           and "Could not reach the backend" not in page.inner_text("#evidence-status"),
           page.inner_text("#evidence-status"))
    os.unlink(oversized_photo_path)
    # Same create-button-toggle race as above -- until this closes, the
    # form's own leftover photo preview (also class="evidence-photo",
    # see renderPhotoPreview()) is still in the DOM and would be the
    # first match instead of the real list item's.
    wait_for_condition(lambda: page.query_selector("#evidence-new-confirm") is None)

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
    # (The page mints the Operation's id itself now.)
    nightshade_id = page.evaluate("() => { var d = Object.entries(window.__dgFirestoreDocs || {}).find(([k, v]) =>"
                                  " k.indexOf('operations/') === 0 && v.name === 'Operation Nightshade'); return d ? d[0].split('/')[1] : ''; }")
    page.click('[data-del-op="%s"]' % nightshade_id)
    wait_for_condition(lambda: "Operation Nightshade" not in page.inner_text("#evidence-folders"))
    record("acell", "deleting an Operation removes it from the folder list",
           "Operation Nightshade" not in page.inner_text("#evidence-folders"), page.inner_text("#evidence-folders"))
    page.click('[data-op=""]')
    page.wait_for_timeout(200)
    record("acell", "evidence that was filed under a deleted Operation is not itself deleted",
           page.locator(".evidence-card").count() == 2, "")

    page.close()
    return errs

def test_acell_evidence_share_languages_format(p):
    """A-Cell Evidence, v3.6.0: one item shared with several Cells as
    linked copies, each read in its Cell's language (H-Cell in Magyar,
    B-Cell in English; Agents never get a switch), Translate filling one
    language from the other, the formatting toolbar and its rendering,
    a body box that grows with the text, Edit opening where the card is
    (not at the top of the list), and Duplicate."""
    page = p.new_page(viewport={"width": 1280, "height": 900})
    page.set_default_timeout(15000)
    errs = collect_errors(page)
    page.add_init_script("try { sessionStorage.setItem('dg_acell_pw', 'testpw'); } catch (e) {}")
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)
    install_firestore_backend(page, {
        "cells/cell_h": {"name": "H-Cell", "handler": "Sam", "member_codes": ["OWEN-CS12", "PRIY-AN34"]},
        "cells/cell_b": {"name": "B-Cell", "handler": "Sam", "member_codes": ["TOMH-AL11"]},
        "operations/op_h": {"operation_id": "op_h", "cell_id": "cell_h", "name": "Okkult", "created_at": 1},
        "operations/op_b": {"operation_id": "op_b", "cell_id": "cell_b", "name": "Black Orchard", "created_at": 2},
        **{f"evidence/old{i}": {"title": f"Old item {i}", "body": "Plain text\nsecond line", "cell_id": "cell_h", "operation_id": "op_h",
                                "released": True, "restricted_to": [], "visible_to": ["OWEN-CS12", "PRIY-AN34"], "created_at": 1000 + i} for i in range(6)},
    })
    def ev():
        return page.evaluate("() => Object.entries(window.__dgFirestoreDocs || {})"
                             ".filter(([k]) => k.indexOf('evidence/') === 0 && k.split('/').length === 2)"
                             ".map(([k, v]) => Object.assign({}, v, { evidence_id: k.split('/')[1] }))")
    def push():
        wait_for_condition(lambda: notes_firestore_listener_count(page) >= 1, timeout_ms=8000)
        ordered = sorted(ev(), key=lambda e: int(e["created_at"]), reverse=True)
        push_firestore_snapshot(page, "evidence", [], [dict(e, id=e["evidence_id"]) for e in ordered])
        page.wait_for_timeout(300)
    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(500)
    page.evaluate("() => document.querySelector('.tw[data-tab=evidence]').click()")
    page.wait_for_timeout(500)
    push()

    # New, shared with two Cells: H-Cell in Magyar, B-Cell in English.
    page.click("#evidence-create-btn")
    page.fill("#evidence-new-title", "Field Memo")
    page.fill("#evidence-new-body", "# Report\n**Bold** words\n\n- one\n- two")
    page.select_option("#evidence-new-scope", label="H-Cell")
    page.select_option("#evidence-new-op", label="Okkult")
    page.select_option(".ev-row[data-row='0'] .ev-row-lang", "hu")
    page.click("#evidence-add-row")
    page.select_option(".ev-row[data-row='1'] .ev-row-cell", label="B-Cell")
    page.select_option(".ev-row[data-row='1'] .ev-row-op", label="Black Orchard")
    page.select_option(".ev-row[data-row='1'] .ev-row-lang", "en")
    record("evidence-v36", "a second Share-with row makes it two copies",
           "2 copies" in page.inner_text("#evidence-new-confirm").lower(), page.inner_text("#evidence-new-confirm"))
    page.click("#evidence-new-confirm")
    record("evidence-v36", "saving without the Magyar text says H-Cell needs it",
           "H-Cell reads Magyar" in page.inner_text("#evidence-new-error"), page.inner_text("#evidence-new-error"))
    page.click(".ev-lang[data-lang=hu]")
    page.click("[data-translate=en]")
    wait_for_condition(lambda: page.input_value("#evidence-new-title").startswith("[hu]") or None, timeout_ms=5000)
    calls = page.evaluate("() => (window.__dgFunctionCalls || []).filter(c => c.name === 'translateEvidence')")
    record("evidence-v36", "Translate asks translateEvidence for English -> Magyar and fills the Magyar tab",
           len(calls) == 1 and calls[0]["payload"]["from"] == "en" and calls[0]["payload"]["to"] == "hu"
           and page.input_value("#evidence-new-body").startswith("[hu] # Report"), str(calls))
    page.check("#evidence-new-released")
    page.click("#evidence-new-confirm")
    wait_for_condition(lambda: len([e for e in ev() if e.get("share_group")]) == 2 or None, timeout_ms=8000)
    pair = {e["cell_id"]: e for e in ev() if e.get("share_group")}
    h, b = pair.get("cell_h", {}), pair.get("cell_b", {})
    record("evidence-v36", "two linked copies, one per Cell, same share_group",
           bool(h) and bool(b) and h["share_group"] == b["share_group"] and b.get("operation_id") == "op_b", str(pair)[:400])
    record("evidence-v36", "each copy's text is in its Cell's language (no switch for Agents)",
           h.get("lang") == "hu" and h.get("title") == "[hu] Field Memo" and b.get("lang") == "en" and b.get("title") == "Field Memo",
           f"{h.get('lang')} {h.get('title')} / {b.get('lang')} {b.get('title')}")
    record("evidence-v36", "both texts are kept on every copy, and each Cell's Agents only see their copy",
           set((h.get("texts") or {}).keys()) == {"en", "hu"} and h.get("texts") == b.get("texts")
           and sorted(h.get("visible_to") or []) == ["OWEN-CS12", "PRIY-AN34"] and b.get("visible_to") == ["TOMH-AL11"], str(h.get("visible_to")))
    push()
    card = page.locator(f".evidence-card[data-eid='{b['evidence_id']}']")
    record("evidence-v36", "the card says which Cell it's linked with, and has Duplicate and Share",
           "linked with h-cell · okkult" in card.inner_text().lower() and card.locator("[data-dup-evidence]").count() == 1
           and card.locator("[data-share-evidence]").count() == 1, card.inner_text()[:400])
    record("evidence-v36", "the text is drawn formatted (heading, bold, list)",
           card.locator(".evidence-text h3").inner_text() == "Report" and card.locator(".evidence-text b").count() == 1
           and card.locator(".evidence-text li").count() == 2, card.inner_html()[:300])
    record("evidence-v36", "a Magyar copy is tagged HU",
           page.locator(f".evidence-card[data-eid='{h['evidence_id']}'] .evidence-lang-tag").inner_text() == "HU", "")

    # Edit a card far down the list: the form opens where that card is.
    last = page.locator(".evidence-card[data-eid='old0']")
    last.locator("[data-edit-evidence]").click()
    page.wait_for_timeout(300)
    record("evidence-v36", "Edit opens the form in the card's place, not at the top of the list",
           page.evaluate("""() => { const f = document.querySelector('#evidence-list .evidence-create-form');
               return !!f && document.getElementById('evidence-create-form-slot').childNodes.length === 0
                 && f.nextElementSibling && f.nextElementSibling.dataset.eid === 'old0' && f.nextElementSibling.style.display === 'none'; }"""), "")
    push()
    record("evidence-v36", "...and stays there when the list redraws", page.locator("#evidence-list .evidence-create-form").count() == 1, "")
    page.fill("#evidence-new-body", "\n".join(f"Line {i}" for i in range(40)))
    page.dispatch_event("#evidence-new-body", "input")
    hgt = page.evaluate("() => document.getElementById('evidence-new-body').getBoundingClientRect().height")
    no_scroll = page.evaluate("() => { const t = document.getElementById('evidence-new-body'); return t.scrollHeight <= t.clientHeight + 2; }")
    record("evidence-v36", "the body box grows with the text (no scrolling inside it)", hgt > 600 and no_scroll, str(hgt))
    page.click("#evidence-new-cancel")
    record("evidence-v36", "Cancel puts the card back", page.locator(".evidence-card[data-eid='old0']").is_visible(), "")

    # Toolbar: H2 on the current line, bold around the selection.
    page.locator(".evidence-card[data-eid='old1'] [data-edit-evidence]").click()
    page.fill("#evidence-new-body", "Title line\nword")
    page.evaluate("() => { const t = document.getElementById('evidence-new-body'); t.focus(); t.setSelectionRange(0, 2); }")
    page.click(".ev-tb [data-md=h2]")
    page.evaluate("() => { const t = document.getElementById('evidence-new-body'); const i = t.value.indexOf('word'); t.setSelectionRange(i, i + 4); }")
    page.click(".ev-tb [data-md=b]")
    record("evidence-v36", "the toolbar marks headings and bold", page.input_value("#evidence-new-body") == "## Title line\n**word**",
           page.input_value("#evidence-new-body"))
    page.click(".ev-tb [data-mode=preview]")
    record("evidence-v36", "Preview shows it formatted", page.locator("#evidence-new-preview h4").inner_text() == "Title line", "")
    page.click("#evidence-new-cancel")

    # Editing one copy saves the shared text to both.
    page.locator(f".evidence-card[data-eid='{b['evidence_id']}'] [data-edit-evidence]").click()
    record("evidence-v36", "editing a linked copy lists both Cells",
           page.locator(".ev-row").count() == 2 and page.input_value(".ev-row[data-row='0'] .ev-row-cell") == "cell_b", "")
    page.fill("#evidence-new-body", "Updated English text.")
    page.click("#evidence-new-confirm")
    wait_for_condition(lambda: all(((e.get("texts") or {}).get("en") or {}).get("body") == "Updated English text." for e in ev() if e.get("share_group")) or None, timeout_ms=8000)
    after = {e["cell_id"]: e for e in ev() if e.get("share_group")}
    record("evidence-v36", "a text change is saved to every linked copy; the Magyar copy keeps its Magyar text",
           after["cell_b"]["body"] == "Updated English text." and after["cell_h"]["texts"]["en"]["body"] == "Updated English text."
           and after["cell_h"]["body"].startswith("[hu]"), str(after)[:300])
    push()

    # Duplicate: a new item, filled in, on top.
    n0 = len(ev())
    page.locator(".evidence-card[data-eid='old2'] [data-dup-evidence]").click()
    record("evidence-v36", "Duplicate opens a new item filled in from it",
           page.input_value("#evidence-new-title") == "Old item 2" and page.locator("#evidence-create-form-slot .evidence-create-form").count() == 1, "")
    page.fill("#evidence-new-title", "Old item 2 (copy)")
    page.click("#evidence-new-confirm")
    wait_for_condition(lambda: len(ev()) == n0 + 1 or None, timeout_ms=8000)
    record("evidence-v36", "...and saves it as a new item (the original unchanged)",
           len(ev()) == n0 + 1 and any(e["title"] == "Old item 2" for e in ev()) and any(e["title"] == "Old item 2 (copy)" for e in ev()), "")
    record("evidence-v36", "no JS exceptions (share, languages, format)", not errs, str(errs[:3]))
    page.close()

    # The renderer itself: escapes HTML, keeps old plain text readable.
    page = p.new_page()
    page.goto(f"{BASE}/rules-reference.html", wait_until="domcontentloaded")
    page.add_script_tag(url=f"{BASE}/assets/evidence-md.js")
    out = page.evaluate("""() => [dgEvidenceMd.render('<img src=x onerror=alert(1)> **b**'), dgEvidenceMd.render('Plain\\nline\\n\\nNext'),
        dgEvidenceMd.render('2 * 3 * 4'), dgEvidenceMd.render('> quoted\\n---\\n1. a\\n2. b'), dgEvidenceMd.render('1. One\\n\\nText\\n\\n2. Two')]""")
    record("evidence-v36", "the renderer escapes HTML", "<img" not in out[0] and "&lt;img" in out[0] and "<b>b</b>" in out[0], out[0])
    record("evidence-v36", "old plain text keeps its lines and paragraphs", out[1] == "<p>Plain<br>line</p><p>Next</p>", out[1])
    record("evidence-v36", "a lone asterisk isn't taken for italics", out[2] == "<p>2 * 3 * 4</p>", out[2])
    record("evidence-v36", "quote, rule and numbered list", out[3] == "<blockquote>quoted</blockquote><hr><ol><li>a</li><li>b</li></ol>", out[3])
    record("evidence-v36", "a numbered item after a paragraph keeps its number (2., not 1.)",
           out[4] == '<ol><li>One</li></ol><p>Text</p><ol start="2"><li>Two</li></ol>', out[4])
    page.close()

    # An Agent's notebook draws it formatted too.
    docs = _field_notes_docs()
    docs["evidence/ev_fn_1"]["body"] = "## Autopsy\n- **Two** pages\n- redacted"
    page, errs = _field_notes_page(p, docs=docs)
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function("() => window.dgFieldNotes && window.dgFieldNotes.isHost", timeout=10000)
    page.evaluate("() => window.dgFieldNotes.open('evidence')")
    page.wait_for_selector("#fn-veil .fn-card-body", timeout=10000)
    record("evidence-v36", "the notebook's Evidences draw the formatting (heading, list, bold)",
           page.locator("#fn-veil .fn-card-body h4").inner_text() == "Autopsy" and page.locator("#fn-veil .fn-card-body li").count() == 2
           and page.locator("#fn-veil .fn-card-body b").count() == 1, page.inner_html("#fn-veil .fn-card-body")[:200])
    record("evidence-v36", "no JS exceptions (notebook Evidences)", not errs, str(errs[:3]))
    page.close()

def test_evidence_gallery(p):
    """Evidence gallery (v3.7.0): a List | Gallery switch, a pinboard of
    taped polaroids (a photo shows the picture, a PDF a stamp, a text-only
    item its first lines), remembered per device. A-Cell: a tap goes to
    that card in the list; unreleased tiles are stamped. Players (the
    notebook's Evidences, Agent Hub, Notes): a tap opens that one
    Evidence with its private remarks, and Back returns to the board."""
    img = "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='30'%3E%3Crect width='40' height='30' fill='%23543'/%3E%3C/svg%3E"
    def ev(cell, vis, rel=True):
        return {
            "evidence/g_photo": {"title": "Cellar photo", "body": "Stain.", "photo": img, "cell_id": cell, "operation_id": "", "released": rel, "restricted_to": [], "visible_to": vis, "created_at": 3000},
            "evidence/g_pdf": {"title": "Coroner PDF", "body": "", "photo": "https://firebasestorage.googleapis.com/v0/b/x/o/evidence%2Fa.pdf?alt=media", "cell_id": cell, "operation_id": "", "released": True, "restricted_to": [], "visible_to": vis, "created_at": 2000},
            "evidence/g_text": {"title": "Memo", "body": "## Step one\n**Check** the cellar.", "photo": "", "cell_id": cell, "operation_id": "", "released": True, "restricted_to": [], "visible_to": vis, "created_at": 1000},
        }
    # A-Cell
    page = p.new_page(viewport={"width": 1280, "height": 900})
    page.set_default_timeout(15000)
    errs = collect_errors(page)
    page.add_init_script("try { sessionStorage.setItem('dg_acell_pw', 'testpw'); } catch (e) {}")
    _block_fonts(page)
    skip_acell_gate(page)
    docs = {"cells/cell_1": {"name": "Cell Alpha", "handler": "Sam", "member_codes": ["OWEN-CS12"]}}
    docs.update(ev("cell_1", ["OWEN-CS12"], rel=False))
    install_firestore_backend(page, docs)
    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(500)
    page.evaluate("() => document.querySelector('.tw[data-tab=evidence]').click()")
    wait_for_condition(lambda: notes_firestore_listener_count(page) >= 1, timeout_ms=8000)
    push_firestore_snapshot(page, "evidence", [], [dict(v, id=k.split("/")[1]) for k, v in sorted(docs.items(), key=lambda kv: -kv[1].get("created_at", 0)) if k.startswith("evidence/")])
    page.wait_for_timeout(400)
    record("gallery", "A-Cell starts in List, with a List | Gallery switch", page.locator(".evidence-card").count() == 3 and page.locator("#evidence-view-switch [data-gv-view=gallery]").count() == 1, "")
    page.click("#evidence-view-switch [data-gv-view=gallery]")
    tiles = page.locator("#evidence-list .dg-gv-t")
    record("gallery", "Gallery shows a tile per item: the photo, a PDF stamp, the text's first lines",
           tiles.count() == 3 and page.locator(".dg-gv-t[data-gv-id=g_photo] img.dg-gv-ph").count() == 1
           and page.locator(".dg-gv-t[data-gv-id=g_pdf] .dg-gv-doc").inner_text().strip().upper() == "PDF"
           and page.locator(".dg-gv-t[data-gv-id=g_text] .dg-gv-txt").inner_text().startswith("Step one Check the cellar"), page.inner_html("#evidence-list")[:300])
    record("gallery", "an unreleased item is stamped in the Handler's gallery", page.locator(".dg-gv-t[data-gv-id=g_photo] .dg-gv-unrel").count() == 1, "")
    record("gallery", "the choice is remembered on the device (A-Cell's own key)",
           page.evaluate("() => localStorage.getItem('dg_acell_evidence_view')") == "gallery", "")
    page.click(".dg-gv-t[data-gv-id=g_text]")
    page.wait_for_timeout(300)
    record("gallery", "a tap goes to that card in the list (Edit, Duplicate... are there)",
           page.locator(".evidence-card[data-eid=g_text]").is_visible() and page.locator(".evidence-card[data-eid=g_text] [data-edit-evidence]").count() == 1, "")
    record("gallery", "no JS exceptions (A-Cell gallery)", not errs, str(errs[:3]))
    page.close()

    # The notebook's Evidences
    fd = _field_notes_docs()
    fd.update(ev(FN_CELL, [FN_CODE]))
    page, errs = _field_notes_page(p, docs=fd)
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function("() => window.dgFieldNotes && window.dgFieldNotes.isHost", timeout=10000)
    page.evaluate("() => window.dgFieldNotes.open('evidence')")
    page.wait_for_selector("#fn-veil .fn-card-sheet", timeout=10000)
    page.click("#fn-veil [data-gv-view=gallery]")
    record("gallery", "notebook: Gallery shows the pinboard (every item visible to the Agent)", page.locator("#fn-veil .dg-gv-t").count() == 4, str(page.locator("#fn-veil .dg-gv-t").count()))
    page.click("#fn-veil .dg-gv-t[data-gv-id=g_text]")
    record("gallery", "notebook: a tap opens that Evidence, formatted, with its private remarks",
           page.locator("#fn-veil .fn-card-sheet").count() == 1 and page.locator("#fn-veil .fn-card-body h4").inner_text() == "Step one"
           and page.locator("#fn-veil textarea[data-ev=g_text]").count() == 1, "")
    page.click("#fn-veil [data-ev-back]")
    record("gallery", "notebook: Back returns to the gallery", page.locator("#fn-veil .dg-gv-t").count() == 4, "")
    page.evaluate("() => window.dgFieldNotes.close()")
    record("gallery", "players' choice is kept on the device", page.evaluate("() => localStorage.getItem('dg_evidence_view')") == "gallery", "")

    # Agent Hub (the same device: opens in Gallery)
    page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_selector(f"#ah-handouts-{FN_CODE}", state="attached", timeout=15000)
    page.wait_for_timeout(1200)
    evs = sorted([dict(v, id=k.split("/")[1]) for k, v in fd.items() if k.startswith("evidence/")], key=lambda e: -e["created_at"])
    push_firestore_snapshot(page, "evidence", [["visible_to", "array-contains-any", [FN_CODE, "ALL"]]], evs)
    page.wait_for_selector(f"#ah-handouts-{FN_CODE} .dg-gv-t", timeout=10000)
    record("gallery", "Agent Hub opens in Gallery too (the same choice)", page.locator(f"#ah-handouts-{FN_CODE} .dg-gv-t").count() == 4, "")
    page.click(f"#ah-handouts-{FN_CODE} .dg-gv-t[data-gv-id=g_pdf]")
    record("gallery", "Agent Hub: a tap opens that Evidence (its PDF link and Your Notes)",
           page.locator(f"#ah-handouts-{FN_CODE} .ah-handout-card").count() == 1 and page.locator(f"#ah-handouts-{FN_CODE} .ah-handout-pdf").count() == 1
           and page.locator(f"#ah-handouts-{FN_CODE} .ah-handout-notes-input").count() == 1, "")
    page.click(f"#ah-handouts-{FN_CODE} [data-ev-back]")
    record("gallery", "Agent Hub: Back returns to the gallery", page.locator(f"#ah-handouts-{FN_CODE} .dg-gv-t").count() == 4, "")
    page.click(f"#ah-handouts-filter-{FN_CODE} [data-gv-view=list]")
    record("gallery", "Agent Hub: List brings the cards back", page.locator(f"#ah-handouts-{FN_CODE} .ah-handout-card").count() == 4, "")
    record("gallery", "no JS exceptions (notebook, Agent Hub)", not errs, str(errs[:3]))
    page.close()

    # Notes: small tiles on the Evidence list; a tap opens it.
    page = p.new_page(viewport={"width": 1280, "height": 900})
    errs = collect_errors(page)
    install_notes_firestore_stub(page)
    _block_fonts(page)
    seed_cells_docs(page, [{"cell_id": "cell_1", "name": "Cell Alpha", "handler": "Sam", "member_codes": ["OWEN-CS12"]}])
    page.route("**/script.google.com/**", lambda r: r.fulfill(status=200, content_type="application/json", body='{"status":"OK"}'))
    page.add_init_script("""try { localStorage.setItem('dg_agent_roster', JSON.stringify({'OWEN-CS12': {code: 'OWEN-CS12', char_name: 'Owen Castillo', saved_at: Date.now()}}));
      localStorage.setItem('dg_notes_identity_OWEN-CS12', JSON.stringify({color: '#2b6cb0', font: 'kalam'})); localStorage.setItem('dg_evidence_view', 'gallery'); } catch (e) {}""")
    page.goto(f"{BASE}/notes/index.html", wait_until="domcontentloaded", timeout=15000)
    wait_for_condition(lambda: notes_firestore_listener_count(page) >= 2, timeout_ms=8000)
    nev = ev("cell_1", ["OWEN-CS12"])
    for _ in range(20):
        push_firestore_snapshot(page, "evidence", [["visible_to", "array-contains-any", ["OWEN-CS12", "ALL"]]],
                                sorted([dict(v, id=k.split("/")[1]) for k, v in nev.items()], key=lambda e: -e["created_at"]))
        if page.locator("#dg-notes-evidence-mount .dg-gv-t").count(): break
        page.wait_for_timeout(250)
    record("gallery", "Notes: the Evidence list shows small tiles in Gallery", page.locator("#dg-notes-evidence-mount .dg-gv.compact .dg-gv-t").count() == 3,
           page.inner_html("#dg-notes-evidence-mount")[:300] if page.query_selector("#dg-notes-evidence-mount") else "no mount")
    if page.locator("#dg-notes-evidence-mount .dg-gv-t").count():
        page.click("#dg-notes-evidence-mount .dg-gv-t[data-gv-id=g_text]")
        page.wait_for_timeout(300)
    record("gallery", "Notes: a tap opens the Evidence", page.locator(".dg-notes-evidence-modal .dg-notes-identity-title").count() == 1
           and "Memo" in (page.text_content(".dg-notes-evidence-modal .dg-notes-identity-title") or ""), "")
    record("gallery", "no JS exceptions (Notes gallery)", not errs, str(errs[:3]))
    page.close()

def test_evidence_tags(p):
    """Evidence tags (v3.7.0): the Handler's labels (A-Cell, on every copy,
    kept by the Released toggle, stamped for the Agents and not removable
    by them) and each Agent's own private tags (saved beside the remarks
    without wiping them), with a Tags filter in the notebook (list and
    gallery), on Agent Hub and in Notes."""
    docs_of = lambda page, prefix: page.evaluate("(p) => Object.entries(window.__dgFirestoreDocs || {}).filter(([k]) => k.indexOf(p) === 0)"
                                                 ".map(([k, v]) => Object.assign({ _id: k }, v))", prefix)
    # A-Cell: labels
    page = p.new_page(viewport={"width": 1280, "height": 900})
    page.set_default_timeout(15000)
    errs = collect_errors(page)
    page.add_init_script("try { sessionStorage.setItem('dg_acell_pw', 'testpw'); } catch (e) {}")
    _block_fonts(page)
    skip_acell_gate(page)
    install_firestore_backend(page, {"cells/cell_1": {"name": "Cell Alpha", "handler": "Sam", "member_codes": ["OWEN-CS12"]}})
    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(500)
    page.evaluate("() => document.querySelector('.tw[data-tab=evidence]').click()")
    wait_for_condition(lambda: notes_firestore_listener_count(page) >= 1, timeout_ms=8000)
    page.click("#evidence-create-btn")
    page.fill("#evidence-new-title", "Autopsy notes")
    page.select_option("#evidence-new-scope", label="Cell Alpha")
    page.fill("#evidence-new-labels", " Autopsy,  Witness , autopsy,")
    page.check("#evidence-new-released")
    page.click("#evidence-new-confirm")
    wait_for_condition(lambda: any(d.get("title") == "Autopsy notes" for d in docs_of(page, "evidence/")) or None, timeout_ms=8000)
    d = next(d for d in docs_of(page, "evidence/") if d.get("title") == "Autopsy notes")
    record("evidence-tags", "A-Cell saves the Handler's labels, tidied (no repeats, no blanks)", d.get("htags") == ["Autopsy", "Witness"], str(d.get("htags")))
    push_firestore_snapshot(page, "evidence", [], [dict(v, id=v["_id"].split("/")[1]) for v in docs_of(page, "evidence/")])
    page.wait_for_timeout(400)
    record("evidence-tags", "...and stamps them on the card", page.locator(".evidence-card .evidence-label-tag").count() == 2, "")
    page.uncheck("[data-toggle-released]")
    wait_for_condition(lambda: next(x for x in docs_of(page, "evidence/") if x.get("title") == "Autopsy notes").get("released") is False or None, timeout_ms=6000)
    d = next(x for x in docs_of(page, "evidence/") if x.get("title") == "Autopsy notes")
    record("evidence-tags", "the Released toggle keeps the labels", d.get("htags") == ["Autopsy", "Witness"], str(d))
    record("evidence-tags", "no JS exceptions (A-Cell labels)", not errs, str(errs[:3]))
    page.close()

    # The notebook: own tags beside the Handler's labels, the Tags filter
    fd = _field_notes_docs()
    fd["evidence/ev_fn_1"]["htags"] = ["Autopsy"]
    fd["evidence/ev_fn_2"] = {"title": "Clipping", "body": "Livestock deaths.", "cell_id": FN_CELL, "operation_id": "op_fn_a",
                              "visible_to": [FN_CODE], "released": True, "created_at": 2500}
    fd[f"handout_notes/{FN_CODE}_ev_fn_2"] = {"agent_code": FN_CODE, "handout_id": "ev_fn_2", "note": "Check the dates.", "updated_at": 1}
    page, errs = _field_notes_page(p, docs=fd)
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function("() => window.dgFieldNotes && window.dgFieldNotes.isHost", timeout=10000)
    page.evaluate("() => window.dgFieldNotes.open('evidence')")
    page.wait_for_selector("#fn-veil .dg-et[data-et-id=ev_fn_1]", timeout=10000)
    record("evidence-tags", "notebook: the Handler's label is stamped, with no way for the Agent to remove it",
           page.locator("#fn-veil .dg-et[data-et-id=ev_fn_1] .dg-et-h").inner_text().strip().lower() == "autopsy"
           and page.locator("#fn-veil .dg-et[data-et-id=ev_fn_1] [data-et-del]").count() == 0, "")
    page.fill("#fn-veil .dg-et[data-et-id=ev_fn_2] .dg-et-in", "Hale farm")
    page.press("#fn-veil .dg-et[data-et-id=ev_fn_2] .dg-et-in", "Enter")
    wait_for_condition(lambda: (docs_of(page, f"handout_notes/{FN_CODE}_ev_fn_2") or [{}])[0].get("tags") == ["Hale farm"] or None, timeout_ms=6000)
    hn = (docs_of(page, f"handout_notes/{FN_CODE}_ev_fn_2") or [{}])[0]
    record("evidence-tags", "notebook: an own tag saves privately, beside the remarks (the remark kept)",
           hn.get("tags") == ["Hale farm"] and hn.get("note") == "Check the dates.", str(hn))
    record("evidence-tags", "notebook: the tag shows with a remove button", page.locator("#fn-veil .dg-et[data-et-id=ev_fn_2] [data-et-del]").count() == 1, "")
    page.select_option("#fn-veil [data-et-filter]", "Hale farm")
    record("evidence-tags", "notebook: the Tags filter shows only what carries the tag",
           page.locator("#fn-veil .fn-card-sheet").count() == 1 and "Clipping" in page.inner_text("#fn-veil .fn-card-sheet"), "")
    page.select_option("#fn-veil [data-et-filter]", "Autopsy")
    record("evidence-tags", "notebook: ...and a Handler's label filters too", page.locator("#fn-veil .fn-card-sheet").count() == 1, "")
    page.click("#fn-veil [data-gv-view=gallery]")
    record("evidence-tags", "notebook: the gallery follows the Tags filter", page.locator("#fn-veil .dg-gv-t").count() == 1, "")
    page.click("#fn-veil [data-gv-view=list]")
    page.select_option("#fn-veil [data-et-filter]", "")
    page.click("#fn-veil .dg-et[data-et-id=ev_fn_2] [data-et-del]")
    wait_for_condition(lambda: (docs_of(page, f"handout_notes/{FN_CODE}_ev_fn_2") or [{}])[0].get("tags") == [] or None, timeout_ms=6000)
    record("evidence-tags", "notebook: × removes the own tag", (docs_of(page, f"handout_notes/{FN_CODE}_ev_fn_2") or [{}])[0].get("tags") == [], "")
    page.evaluate("() => window.dgFieldNotes.close()")

    # Agent Hub: the same tags, its own Tags filter
    page.evaluate(f"() => {{ window.__dgFirestoreDocs['handout_notes/{FN_CODE}_ev_fn_2'].tags = ['Hale farm']; sessionStorage.setItem('__dgFsDocs', JSON.stringify(window.__dgFirestoreDocs)); }}")
    page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_selector(f"#ah-handouts-{FN_CODE}", state="attached", timeout=15000)
    page.wait_for_timeout(1200)
    evs = sorted([dict(v, id=k.split("/")[1]) for k, v in fd.items() if k.startswith("evidence/")], key=lambda e: -e["created_at"])
    push_firestore_snapshot(page, "evidence", [["visible_to", "array-contains-any", [FN_CODE, "ALL"]]], evs)
    page.wait_for_selector(f"#ah-handouts-{FN_CODE} .dg-et", timeout=10000)
    wait_for_condition(lambda: page.locator(f"#ah-handouts-{FN_CODE} .dg-et-o").count() >= 1 or None, timeout_ms=5000)
    record("evidence-tags", "Agent Hub: the Agent's own tag and the Handler's label are on the cards",
           page.locator(f"#ah-handouts-{FN_CODE} .dg-et-o").count() == 1 and page.locator(f"#ah-handouts-{FN_CODE} .dg-et-h").count() == 1, "")
    page.select_option(f"#ah-handouts-filter-{FN_CODE} [data-et-filter]", "Hale farm")
    record("evidence-tags", "Agent Hub: the Tags filter", page.locator(f"#ah-handouts-{FN_CODE} .ah-handout-card").count() == 1, "")
    record("evidence-tags", "no JS exceptions (notebook, Agent Hub)", not errs, str(errs[:3]))
    page.close()

    # Notes: tag from the Evidence window; the sidebar filter
    page = p.new_page(viewport={"width": 1280, "height": 900})
    errs = collect_errors(page)
    install_notes_firestore_stub(page)
    _block_fonts(page)
    seed_cells_docs(page, [{"cell_id": "cell_1", "name": "Cell Alpha", "handler": "Sam", "member_codes": ["OWEN-CS12"]}])
    page.route("**/script.google.com/**", lambda r: r.fulfill(status=200, content_type="application/json", body='{"status":"OK"}'))
    page.add_init_script("""try { localStorage.setItem('dg_agent_roster', JSON.stringify({'OWEN-CS12': {code: 'OWEN-CS12', char_name: 'Owen Castillo', saved_at: Date.now()}}));
      localStorage.setItem('dg_notes_identity_OWEN-CS12', JSON.stringify({color: '#2b6cb0', font: 'kalam'})); } catch (e) {}""")
    page.goto(f"{BASE}/notes/index.html", wait_until="domcontentloaded", timeout=15000)
    wait_for_condition(lambda: notes_firestore_listener_count(page) >= 2, timeout_ms=8000)
    nev = [{"id": "n1", "title": "Memo", "body": "x", "cell_id": "cell_1", "operation_id": "", "visible_to": ["OWEN-CS12"], "released": True, "created_at": 2, "htags": ["Witness"]},
           {"id": "n2", "title": "Map", "body": "y", "cell_id": "cell_1", "operation_id": "", "visible_to": ["OWEN-CS12"], "released": True, "created_at": 1}]
    for _ in range(20):
        push_firestore_snapshot(page, "evidence", [["visible_to", "array-contains-any", ["OWEN-CS12", "ALL"]]], nev)
        if page.locator("#dg-notes-evidence-mount [data-evidence-id]").count(): break
        page.wait_for_timeout(250)
    page.click("#dg-notes-evidence-mount [data-evidence-id=n2]")
    page.wait_for_selector(".dg-notes-evidence-modal .dg-et", timeout=5000)
    page.fill(".dg-notes-evidence-modal .dg-et-in", "Hale farm")
    page.press(".dg-notes-evidence-modal .dg-et-in", "Enter")
    wait_for_condition(lambda: any((w.get("data") or {}).get("tags") == ["Hale farm"] for w in firestore_writes(page, "handout_notes/OWEN-CS12_n2")) or None, timeout_ms=6000)
    record("evidence-tags", "Notes: an own tag added in the Evidence window saves",
           any((w.get("data") or {}).get("tags") == ["Hale farm"] for w in firestore_writes(page, "handout_notes/OWEN-CS12_n2")), "")
    page.click(".dg-notes-evidence-close")
    page.select_option("#dg-notes-evidence-mount [data-et-filter]", "Hale farm")
    record("evidence-tags", "Notes: the Evidence list filters by tag",
           page.locator("#dg-notes-evidence-mount [data-evidence-id]").count() == 1 and page.locator("#dg-notes-evidence-mount [data-evidence-id=n2]").count() == 1, "")
    record("evidence-tags", "no JS exceptions (Notes)", not errs, str(errs[:3]))
    page.close()

def test_player_tours(p):
    """Player tours (v3.8.0, assets/tour.js): one starts by itself the first
    time its place is on screen (one a page load), and can be left at any
    moment: ✕ Exit tour, Esc, or a tap on the dimmed page; a left or
    finished tour doesn't come back by itself. Next / Back / Done; the
    "New · N tours" stamp on the notebook and Settings → Tours list them;
    a tour started from the list opens its notebook page; a step inside
    the Notes page (an iframe) is framed where it is."""
    stats = {"STR": 10, "CON": 12, "DEX": 11, "INT": 14, "POW": 11, "CHA": 13}
    state = {"v": 1, "stats": stats, "csStats": dict(stats), "derived": {"hp": 11, "wp": 11, "san": 52, "bp": 44},
             "bio": {"name": "Mara Voss", "player_name": "fn tester", "profession": "federal_agent"}, "skills": {"alertness": 60}}
    fd = _field_notes_docs()
    fd[f"characters/{FN_CODE}"] = character_doc(FN_CODE, state, "fn tester")
    extra = ("sessionStorage.setItem('dg_tours_test_on', '1'); localStorage.removeItem('dg_tours_off');"
             "localStorage.setItem('dg_fn_orders_ack', JSON.stringify({'%s': 1790000000000}));"
             "localStorage.setItem('dg_notes_identity_%s', JSON.stringify({color:'#2b6cb0', font:'kalam'}));") % (FN_CODE, FN_CODE)
    class P:
        def new_page(self, **kw): return p.new_page(tours=True, **kw)
    page, errs = _field_notes_page(P(), 1300, 860, docs=fd, extra_init=extra)
    page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_selector("#dg-tour .dg-tour-post", timeout=10000)
    record("tours", "a tour starts by itself the first time (New Recruit, on Agent Hub)",
           "new recruit" in page.inner_text("#dg-tour .dg-tour-post").lower() and page.evaluate("() => window.dgTour.active()") == "newrecruit", page.inner_text("#dg-tour .dg-tour-post")[:120])
    hole = page.evaluate("() => { const h = document.querySelector('.dg-tour-hole').getBoundingClientRect(), t = document.querySelector('#tab-strip .tw-new').getBoundingClientRect(); return [h.left <= t.left, h.right >= t.right, h.top <= t.top, h.bottom >= t.bottom]; }")
    record("tours", "the thing explained is framed, with an arrow to it", all(hole) and page.locator("#dg-tour svg path").count() == 2, str(hole))
    record("tours", "Back is off on the first post-it; Next moves on", page.is_disabled("#dg-tour [data-tour=back]"), "")
    page.click("#dg-tour [data-tour=next]")
    record("tours", "...to post-it 2 of 2, with Done", "2/2" in page.inner_text("#dg-tour .dg-tour-top") and page.inner_text("#dg-tour .dg-tour-next").strip() == "Done", "")
    page.click("#dg-tour [data-tour=back]")
    record("tours", "Back returns", "1/2" in page.inner_text("#dg-tour .dg-tour-top"), "")
    page.click("#dg-tour .dg-tour-exit")
    record("tours", "✕ Exit tour leaves it at once, and it's marked seen",
           page.locator("#dg-tour").count() == 0 and "newrecruit" in page.evaluate("() => window.dgTour.seen()"), "")
    page.wait_for_timeout(2600)
    record("tours", "only one tour a page load (no second one right after)", page.locator("#dg-tour").count() == 0, "")
    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector("#dg-tour .dg-tour-post", timeout=10000)
    record("tours", "the next page load starts the next one (Taking a photo), not the one left",
           page.evaluate("() => window.dgTour.active()") == "photos", page.evaluate("() => window.dgTour.active()"))
    page.keyboard.press("Escape")
    record("tours", "Esc leaves it", page.locator("#dg-tour").count() == 0, "")
    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector("#dg-tour .dg-tour-post", timeout=10000)
    page.mouse.click(15, 15)
    record("tours", "a tap on the dimmed page leaves it", page.locator("#dg-tour").count() == 0, "")
    # The stamp lists what's left; a tour from the list opens its page.
    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector("#dg-tour .dg-tour-post", timeout=10000)
    page.click("#dg-tour [data-tour=exit]")
    page.wait_for_selector("#dg-tour-new", timeout=5000)
    n_unseen = len(page.evaluate("() => window.dgTour.tours()")) - len(page.evaluate("() => window.dgTour.seen()"))
    record("tours", "a \"New · N tours\" stamp on the notebook counts the ones not seen",
           page.inner_text("#dg-tour-new").lower().replace("\n", " ") == f"new · {n_unseen} tours", page.inner_text("#dg-tour-new"))
    page.click("#dg-tour-new")
    record("tours", "the stamp opens the list, seen ones marked", page.locator("#dg-tour [data-tour-start]").count() == len(page.evaluate("() => window.dgTour.tours()"))
           and page.locator("#dg-tour .dg-tour-list em").count() >= 3, "")
    page.click("#dg-tour [data-tour-start=evidence]")
    page.wait_for_function("() => window.dgTour.active() === 'evidence'", timeout=8000)
    record("tours", "a tour from the list opens its notebook page and starts",
           page.evaluate("() => window.dgFieldNotes.view()") == "evidence" and page.locator("#dg-tour .dg-tour-post").count() == 1, page.inner_text("#dg-tour .dg-tour-post")[:100])
    page.click("#dg-tour .dg-tour-exit")
    # A step inside the Notes page (iframe): framed where it is.
    page.evaluate("() => window.dgTour.run('notes')")
    page.wait_for_function("() => window.dgTour.active() === 'notes'", timeout=10000)
    record("tours", "Notes: the first post-it is Split (desktop)", "split" in page.inner_text("#dg-tour .dg-tour-t").lower(), "")
    page.click("#dg-tour [data-tour=next]")
    inside = page.evaluate("""() => { const f = document.querySelector('iframe[data-dg-embed=notes]').getBoundingClientRect(), h = document.querySelector('.dg-tour-hole').getBoundingClientRect();
        return h.left >= f.left - 10 && h.right <= f.right + 10 && h.top >= f.top - 10 && h.width > 40; }""")
    record("tours", "Notes: a step inside the Notes page is framed inside it", inside and "tag" in page.inner_text("#dg-tour .dg-tour-t").lower(), page.inner_text("#dg-tour .dg-tour-t"))
    page.keyboard.press("Escape")
    record("tours", "Esc leaves it here too (the notebook stays open)", page.locator("#dg-tour").count() == 0 and page.evaluate("() => window.dgFieldNotes.isOpen()"), "")
    # Settings → Tours
    page.evaluate("() => window.dgFieldNotes.open('settings')")
    page.wait_for_selector("#fn-veil [data-s=tours]", timeout=5000)
    page.wait_for_timeout(1500)
    if page.locator("#dg-tour").count(): page.click("#dg-tour [data-tour=exit]")
    page.click("#fn-veil [data-s=tours]")
    record("tours", "Settings → Tours opens the list", page.locator("#dg-tour [data-tour-start]").count() == len(page.evaluate("() => window.dgTour.tours()")), "")
    page.click("#dg-tour .dg-tour-exit")
    record("tours", "...and ✕ Close closes it", page.locator("#dg-tour").count() == 0, "")
    # With the notebook open, the tour frames the notebook's own button,
    # not the same button on the page underneath.
    page.evaluate("() => window.dgTour.run('sanity')")
    page.wait_for_function("() => window.dgTour.active() === 'sanity'", timeout=10000)
    page.click("#dg-tour [data-tour=next]")
    page.wait_for_timeout(500)
    framed = page.evaluate("""() => { const h = document.querySelector('.dg-tour-hole').getBoundingClientRect();
        const b = [...document.querySelectorAll('[data-pop="san"]')].find(x => x.closest('#fn-veil')).getBoundingClientRect();
        return Math.abs((h.left + h.width / 2) - (b.left + b.width / 2)) < 3 && Math.abs((h.top + h.height / 2) - (b.top + b.height / 2)) < 3; }""")
    record("tours", "inside the notebook it frames the notebook's SAN loss, not the page's underneath", framed, "")
    page.click("#dg-tour [data-tour=next]"); page.click("#dg-tour [data-tour=next]")
    page.wait_for_timeout(600)
    adapt = page.evaluate("""() => { const h = document.querySelector('.dg-tour-hole').getBoundingClientRect();
        const b = [...document.querySelectorAll('.ap-adapts')].find(x => x.closest('#fn-veil')).getBoundingClientRect();
        return [document.querySelector('.dg-tour-t').textContent, h.left <= b.left + 1 && h.right >= b.right - 1 && h.top <= b.top + 1 && h.bottom >= b.bottom - 1]; }""")
    record("tours", "Sanity: Adaptation frames the Violence and Helplessness boxes (not + Incident)",
           adapt[0].lower() == "adaptation" and adapt[1], str(adapt))
    page.keyboard.press("Escape")
    # Never over another window: a SAN post-it up, no tour starts.
    page.evaluate("() => { window.dgTour.reset(); const d = document.createElement('div'); d.id = 'ap-posts'; d.style.cssText = 'position:fixed;inset:0;background:#0006'; document.body.appendChild(d); }")
    page.wait_for_timeout(2800)
    record("tours", "no tour starts while another window is up (a SAN post-it)", page.locator("#dg-tour").count() == 0, "")
    page.evaluate("() => document.getElementById('ap-posts').remove()")
    page.wait_for_selector("#dg-tour .dg-tour-post", timeout=6000)
    record("tours", "...and one starts once it's closed", page.locator("#dg-tour .dg-tour-post").count() == 1, "")
    page.click("#dg-tour .dg-tour-exit")
    record("tours", "no JS exceptions (tours)", not errs, str(errs[:3]))
    page.close()

    # Phone: a post-it fits the screen and the Exit button is reachable.
    page, errs = _field_notes_page(P(), 390, 844, docs=fd, extra_init=extra)
    page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_selector("#dg-tour .dg-tour-post", timeout=10000)
    box = page.evaluate("() => { const r = document.querySelector('.dg-tour-post').getBoundingClientRect(), x = document.querySelector('.dg-tour-exit').getBoundingClientRect(); return [r.left >= 0, r.right <= innerWidth, r.top >= 0, r.bottom <= innerHeight, x.width >= 60]; }")
    record("tours", "phone: the post-it fits the screen and ✕ Exit tour is there", all(box), str(box))
    page.click("#dg-tour .dg-tour-exit")
    record("tours", "phone: ✕ Exit tour leaves it", page.locator("#dg-tour").count() == 0, "")
    record("tours", "no JS exceptions (phone)", not errs, str(errs[:3]))
    page.close()

    # In the Hub shell (hub.html), where the pages sit in a frame: the
    # tour finds and frames the buttons inside it (reported 2026-10-22:
    # "they just reload the page and nothing happens").
    page, errs = _field_notes_page(P(), 1300, 860, docs=fd, extra_init=extra)
    page.goto(f"{BASE}/hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_selector("#dg-tour .dg-tour-post", timeout=20000)
    shell_hole = page.evaluate("""() => { const f = document.getElementById('dg-shell-content'), fr = f.getBoundingClientRect();
        const t = f.contentDocument.querySelector('#tab-strip .tw-new').getBoundingClientRect(), h = document.querySelector('.dg-tour-hole').getBoundingClientRect();
        return [window.dgTour.active(), Math.abs((h.left + h.width / 2) - (fr.left + t.left + t.width / 2)) < 3, Math.abs((h.top + h.height / 2) - (fr.top + t.top + t.height / 2)) < 3]; }""")
    record("tours", "Hub shell: New Recruit starts by itself and frames the tab inside the page frame",
           shell_hole == ["newrecruit", True, True], str(shell_hole))
    page.click("#dg-tour .dg-tour-exit")
    src0 = page.evaluate("() => document.getElementById('dg-shell-content').contentWindow.location.href")
    page.evaluate("() => window.dgTour.run('photos')")
    page.wait_for_function("() => window.dgTour.active() === 'photos'", timeout=8000)
    record("tours", "Hub shell: a tour from the list starts in place, without reloading the page",
           page.evaluate("() => document.getElementById('dg-shell-content').contentWindow.location.href") == src0
           and "photo" in page.inner_text("#dg-tour .dg-tour-t").lower(), page.inner_text("#dg-tour .dg-tour-t"))
    page.keyboard.press("Escape")
    page.evaluate("() => window.dgFieldNotes.open('evidence')")
    page.wait_for_timeout(800)
    page.evaluate("() => window.dgTour.run('settings')")
    page.wait_for_function("() => window.dgTour.active() === 'settings'", timeout=8000)
    record("tours", "Hub shell: notebook tours run too", page.evaluate("() => window.dgFieldNotes.view()") == "settings", "")
    page.keyboard.press("Escape")
    page.evaluate("() => window.dgFieldNotes.close()")
    page.evaluate("() => { const f = document.getElementById('dg-shell-content'); f.src = 'friendly.html'; }")
    page.wait_for_timeout(1500)
    page.evaluate("() => window.dgTour.run('newrecruit')")
    page.wait_for_function("() => window.dgTour.active() === 'newrecruit'", timeout=15000)
    record("tours", "Hub shell: from another page, the tour goes to Agent Hub in the frame and starts there",
           "agent-hub.html" in page.evaluate("() => document.getElementById('dg-shell-content').contentWindow.location.href"), "")
    page.keyboard.press("Escape")
    # From Settings → Tours (notebook open), a tour of the page closes the
    # notebook first (reported 2026-10-21: the first three did nothing).
    page.evaluate("() => window.dgFieldNotes.open('settings')")
    page.wait_for_selector("#fn-veil [data-s=tours]", timeout=5000)
    page.click("#fn-veil [data-s=tours]")
    page.click("#dg-tour [data-tour-start=photos]")
    page.wait_for_function("() => window.dgTour.active() === 'photos'", timeout=8000)
    record("tours", "Hub shell: from Settings → Tours, Taking a photo closes the notebook and starts",
           not page.evaluate("() => window.dgFieldNotes.isOpen()"), "")
    page.keyboard.press("Escape")
    # Friendly with no dossier open: it says what to open, and starts once one is.
    page.evaluate("() => window.dgTour.run('friendly')")
    page.wait_for_function("() => /friendly\\.html/.test(document.getElementById('dg-shell-content').contentWindow.location.href)", timeout=8000)
    page.wait_for_selector("#dg-tour .dg-tour-post", timeout=12000)
    record("tours", "Hub shell: Friendly with no dossier open says to open one (not a silent reload)",
           "dossier" in page.inner_text("#dg-tour .dg-tour-post").lower() and page.evaluate("() => window.dgTour.active()") == "", page.inner_text("#dg-tour .dg-tour-post")[:120])
    page.click("#dg-tour .dg-tour-exit")
    record("tours", "no JS exceptions (Hub shell)", not errs, str(errs[:3]))
    page.close()

    # Everywhere else in the suite tours are off: no tour, no stamp.
    page = p.new_page(viewport={"width": 1300, "height": 860})
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(2500)
    record("tours", "with tours off on the device: none starts, no stamp", page.locator("#dg-tour, #dg-tour-new").count() == 0, "")
    page.close()

def test_edit_cancel_after_live_update(p):
    """Agent File, Edit → Cancel: a save landing while Edit is open (an HP
    tap just before, a snapshot from another device) updated the live
    sheet, and Cancel then asked "Throw away these edits?" with nothing
    edited. Found by test_agent_file_parts_and_looks flaking (2026-10-21)."""
    stats = {"STR": 10, "CON": 12, "DEX": 11, "INT": 14, "POW": 11, "CHA": 13}
    state = {"v": 1, "stats": stats, "csStats": dict(stats), "derived": {"hp": 11, "wp": 11, "san": 52, "bp": 44},
             "bio": {"name": "Mara Voss", "player_name": "fn tester", "profession": "federal_agent"}, "skills": {"alertness": 60}}
    fd = _field_notes_docs()
    fd[f"characters/{FN_CODE}"] = character_doc(FN_CODE, state, "fn tester")
    page, errs = _field_notes_page(p, docs=fd)
    page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function(f"() => window.dgAgentLive && window.dgAgentLive.get('{FN_CODE}') && window.dgAgentLive.get('{FN_CODE}').state", timeout=15000)
    r = page.evaluate(f"""() => {{ const s = window.dgAgentLive.get('{FN_CODE}');
        s.beginEdit();
        const before = s.editDirty();
        s.state = JSON.parse(JSON.stringify(s.state)); s.state.derived.hp = 9;   // a save landing meanwhile
        const afterLive = s.editDirty();
        s.edit.bio.name = 'Mara V.';
        const afterEdit = s.editDirty();
        s.cancelEdit();
        return [before, afterLive, afterEdit, s.editDirty()]; }}""")
    record("agent-file", "Edit: nothing changed is not dirty, even after a save lands meanwhile",
           r[0] is False and r[1] is False, str(r))
    record("agent-file", "...a real edit is dirty, and Cancel clears it", r[2] is True and r[3] is False, str(r))
    record("agent-file", "no JS exceptions (edit / cancel)", not errs, str(errs[:3]))
    page.close()

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
    install_notes_firestore_stub(page)
    page.add_init_script("try { sessionStorage.setItem('dg_acell_pw', 'testpw'); } catch (e) {}")
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

    posts = []
    install_firestore_backend(page)
    tap_acell_posts(page, lambda b: posts.append(b))
    def evidence_state():
        return page.evaluate("() => Object.entries(window.__dgFirestoreDocs || {})"
                             ".filter(([k]) => k.indexOf('evidence/') === 0 && k.split('/').length === 2)"
                             ".map(([k, v]) => Object.assign({}, v, { evidence_id: k.split('/')[1] }))")

    def push_evidence():
        wait_for_condition(lambda: notes_firestore_listener_count(page) >= 1, timeout_ms=8000)
        push_firestore_snapshot(page, "evidence", [],
                                 [dict(e, id=e["evidence_id"]) for e in evidence_state()])


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
    wait_for_condition(lambda: len(evidence_state()) >= 1)
    push_evidence()
    wait_for_condition(lambda: "Case File 12" in page.inner_text("#evidence-list"))
    # PDFs upload to Storage the same as photos now (Phase 4,
    # uploadEvidencePhotoIfNeeded_() doesn't discriminate by file type) --
    # a plain download URL ending in the original extension, not a
    # base64 data: URI riding in the POST body directly.
    record("acell", "creating evidence with a PDF attached sends its Storage download URL to create_evidence",
           any(b.get("action") == "create_evidence" and str(b.get("photo", "")).endswith(".pdf")
               for b in posts), str([{k: v for k, v in b.items() if k != "photo"} for b in posts]))
    record("acell", "the card shows a PDF box (not a broken <img>) once created",
           "evidence-photo-pdf-note" in page.inner_html("#evidence-list"), page.inner_html("#evidence-list"))
    wait_for_condition(lambda: page.query_selector("#evidence-new-confirm") is None)

    page.click(".evidence-photo-pdf-note")
    page.wait_for_timeout(200)
    open_calls = page.evaluate("() => window.__openCalls")
    # dataUriToBlobUrl() only converts an actual data: URI to a blob: URL
    # (its whole point: window.open/target=_blank on a data:application/pdf
    # URI reliably shows a blank "about:blank" tab in Safari instead of the
    # PDF, a real live report, since that's a blocked top-level navigation
    # to an untrusted data: URI) -- a Storage https:// URL fails that parse
    # and falls through its own try/catch fallback unchanged, which is
    # exactly the right outcome here: opening the real URL directly needs
    # no blob: conversion in the first place.
    record("acell", "clicking the PDF box opens it in a new tab (window.open), not this app's photo lightbox",
           len(open_calls) == 1 and open_calls[0].endswith(".pdf") and not open_calls[0].startswith("blob:"),
           str(open_calls))
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
    even though the write would have landed a moment later. Originally fixed
    by polling list_evidence over several increasing delays; verifyEvidenceWrite_
    was later rewritten (Phase 5) to poll the live Firestore-fed evidenceItems
    array directly instead of its own separate list_evidence fetch -- same
    "don't give up on the very first check" mechanism, just reading the
    listener's own state instead of the network. Since that leaves no
    per-attempt network request to intercept or count from here, this
    simulates a slow-landing write (the write completing considerably later
    than the very next check-in-progress) by deliberately holding back the
    Firestore push for longer than verifyEvidenceWrite_'s first delay
    (400ms), then confirming both that the false-negative window (item not
    yet visible, but also not yet given up on) actually happens, and that
    the item still shows up correctly once the push lands."""
    page = p.new_page()
    page.set_default_timeout(20000)
    errs = collect_errors(page)
    install_notes_firestore_stub(page)
    page.add_init_script("try { sessionStorage.setItem('dg_acell_pw', 'testpw'); } catch (e) {}")
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)

    install_firestore_backend(page)
    def evidence_state():
        return page.evaluate("() => Object.entries(window.__dgFirestoreDocs || {})"
                             ".filter(([k]) => k.indexOf('evidence/') === 0 && k.split('/').length === 2)"
                             ".map(([k, v]) => Object.assign({}, v, { evidence_id: k.split('/')[1] }))")


    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(400)
    page.click('.tw[data-tab="evidence"]')
    page.wait_for_timeout(300)
    wait_for_condition(lambda: notes_firestore_listener_count(page) >= 1, timeout_ms=8000)
    page.click("#evidence-create-btn")
    page.wait_for_timeout(300)
    page.fill("#evidence-new-title", "Slow Upload Memo")
    page.click("#evidence-new-confirm")
    wait_for_condition(lambda: len(evidence_state()) >= 1)

    # Deliberately held back past verifyEvidenceWrite_'s first delay
    # (400ms) but well inside its ~12.4s total retry budget -- long
    # enough that a single fixed-delay check (the original bug) would
    # have already given up, not so long it risks tripping onGiveUp().
    import time
    time.sleep(1.2)
    record("acell", "the item isn't visible yet, and no false 'backend didn't confirm' has fired -- still mid-retry",
           "Slow Upload Memo" not in page.inner_text("#evidence-list")
           and "backend didn't confirm" not in page.inner_text("#evidence-status"),
           page.inner_text("#evidence-list") + " | status: " + page.inner_text("#evidence-status"))

    push_firestore_snapshot(page, "evidence", [], [dict(e, id=e["evidence_id"]) for e in evidence_state()])
    wait_for_condition(lambda: "Slow Upload Memo" in page.inner_text("#evidence-list")
                        or "backend didn't confirm" in page.inner_text("#evidence-status"), timeout_ms=12000)
    record("acell", "a create whose write lands later than the first check still succeeds via retry, instead of a false 'backend didn't confirm'",
           "Slow Upload Memo" in page.inner_text("#evidence-list"), page.inner_text("#evidence-list") + " | status: " + page.inner_text("#evidence-status"))

    page.close()
    return errs

def test_stinger_files_exist(p):
    """Every stinger on A-Cell's soundboard (STINGER_GROUPS) has its
    assets/stingers/<id>.mp3, served as audio, and every file there is on
    the soundboard -- a stinger added to one but not the other would play
    silence for the whole table, or never be fireable."""
    import re
    src = open(os.path.join(HERE, "..", "a-cell.html"), encoding="utf-8").read()
    block = src[src.index("var STINGER_GROUPS"):]
    block = block[:block.index("];") + 2]
    ids = re.findall(r"id: '([a-z0-9-]+)'", block)
    files = sorted(f[:-4] for f in os.listdir(os.path.join(HERE, "..", "assets", "stingers")) if f.endswith(".mp3"))
    record("radio", "every soundboard stinger has its .mp3, and every .mp3 is on the soundboard",
           sorted(ids) == files and len(ids) == len(set(ids)), f"board-only={sorted(set(ids) - set(files))} file-only={sorted(set(files) - set(ids))}")
    page = p.new_page()
    bad = []
    for sid in ids:
        r = page.request.get(f"{BASE}/assets/stingers/{sid}.mp3")
        head = r.body()[:3]
        if r.status != 200 or not (head == b"ID3" or head[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2")):
            bad.append(f"{sid}:{r.status}:{head!r}")
    record("radio", "each stinger file is served and is an MP3 (iOS-safe)", not bad, ", ".join(bad))
    page.close()
    return []

def test_handler_rolls_filter_by_cell(p):
    """Two Handlers each running their own table (one shared A-Cell
    password) both saw every table's rolls in the Handler's Live Rolls, as
    did a shared tablet logged into A-Cell. The feed now has a filter: all
    Cells, one Handler's Cells (each Cell's `handler`), or one Cell --
    remembered on the device."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)
    page.add_init_script("try { sessionStorage.setItem('dg_acell_pw', 'testpw'); } catch (e) {}")
    install_firestore_backend(page, {
        "cells/c_imp": {"name": "Impossible", "handler": "Gergo", "member_codes": ["AGEN-1"]},
        "cells/c_test": {"name": "Test", "handler": "Gergo", "member_codes": ["DANI-1"]},
        "cells/c_s16": {"name": "Sweet 16", "handler": "Zuzu", "member_codes": ["SAND-1"]},
    })
    push = """(rows) => {
        var l = (window.__dgFirestoreListeners || []).filter(x => x.path === 'group:rolls');
        if (!l.length) throw new Error('no rolls listener');
        var docs = rows.map(r => ({ id: r.id, ref: { parent: { parent: { id: r.cell } } },
            data: () => ({ agent_name: r.who, roll_type: 'percent', label: 'Alertness', value: 42, target: 50, tier: 'success', created_at: Date.now() - r.ago }) }));
        l.forEach(x => x.success({ forEach: fn => docs.forEach(fn), docChanges: () => [] }));
    }"""
    rows = [{"id": "r1", "cell": "c_imp", "who": "Agent Imp", "ago": 1000},
            {"id": "r2", "cell": "c_s16", "who": "Sandra", "ago": 2000},
            {"id": "r3", "cell": "c_test", "who": "Daniela", "ago": 3000}]
    def agents():
        return page.eval_on_selector_all("#dr-history-list .dr-history-agent", "els => els.map(e => e.textContent)")
    def open_and_feed():
        page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
        _pump_until(page, lambda: page.evaluate("() => (window.__dgFirestoreListeners || []).some(x => x.path === 'group:rolls')"), timeout_ms=10000)
        page.evaluate(push, rows)
        page.wait_for_timeout(200)
        if not page.locator("#dr-cell-filter").is_visible():
            page.click("#dr-arrow")  # open the Dice Roller panel
            page.wait_for_timeout(300)
    open_and_feed()
    opts = page.eval_on_selector_all("#dr-cell-filter option", "els => els.map(e => [e.value, e.textContent])")
    record("dice", "the Handler's Live Rolls offer All Cells, each Handler's Cells, and each Cell",
           [o[0] for o in opts] == ["", "h:Gergo", "h:Zuzu", "c:c_imp", "c:c_s16", "c:c_test"], str(opts))
    record("dice", "by default every Cell's rolls show, tagged with the Cell",
           agents() == ["Agent Imp", "Sandra", "Daniela"], str(agents()))
    page.select_option("#dr-cell-filter", "h:Gergo")
    record("dice", "one Handler's Cells: only that Handler's tables' rolls",
           agents() == ["Agent Imp", "Daniela"], str(agents()))
    page.select_option("#dr-cell-filter", "h:Zuzu")
    open_and_feed()
    record("dice", "the choice is remembered on this device after a reload",
           page.eval_on_selector("#dr-cell-filter", "el => el.value") == "h:Zuzu" and agents() == ["Sandra"], str(agents()))
    page.select_option("#dr-cell-filter", "c:c_test")
    record("dice", "a single Cell shows only that Cell",
           agents() == ["Daniela"], str(agents()))
    record("dice", "no JS exceptions", len(errs) == 0, "; ".join(errs))
    page.close()
    return errs

def test_player_pages_never_get_the_handler_feed(p):
    """A shared tablet where the Handler logged into A-Cell, then players
    played on: the tab's A-Cell session turned the Dice Roller into the
    Handler's feed on every page, so the players' own Field Notes showed
    every table's rolls (and no dice). Handler mode is now A-Cell's only:
    on any other page the roller is the current Agent's, with their own
    Cell's feed -- in the Hub shell too, switching as the content changes."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.add_init_script("""try {
        sessionStorage.setItem('dg_boot_seen', '1'); sessionStorage.setItem('dg_acell_unlocked', '1');
        sessionStorage.setItem('dg_acell_pw', 'testpw'); localStorage.setItem('dg_cover_identity', 'Ann');
        localStorage.setItem('dg_stats_cloud_code', 'AGEN-1');
    } catch (e) {}""")
    install_firestore_backend(page, {
        "cells/c_imp": {"name": "Impossible", "handler": "Gergo", "member_codes": ["AGEN-1"]},
        "cells/c_s16": {"name": "Sweet 16", "handler": "Zuzu", "member_codes": ["SAND-1"]},
        "characters/AGEN-1": character_doc("AGEN-1", {"v": 1, "bio": {"name": "Ann Agent"}}),
    })
    listens = lambda: page.evaluate("() => (window.__dgFirestoreListeners || []).filter(l => !l.isDoc).map(l => l.path)")
    page.goto(f"{BASE}/hub.html", wait_until="domcontentloaded", timeout=15000)
    _pump_until(page, lambda: "dice_rolls/c_imp/rolls" in listens() or "group:rolls" in listens(), timeout_ms=12000)
    page.wait_for_timeout(500)
    ls = listens()
    record("dice", "a tab logged into A-Cell, on a player page in the Hub: the roller reads the Agent's own Cell, not every Cell",
           "dice_rolls/c_imp/rolls" in ls and "group:rolls" not in ls, str(ls))
    record("dice", "...and players can roll (dice shown, no Handler-only filter)",
           page.locator("#dr-panel .dr-die-btn").count() > 0 and page.locator("#dr-cell-filter").count() == 0, "")
    page.evaluate("() => { document.getElementById('dg-shell-content').src = 'a-cell.html'; }")
    _pump_until(page, lambda: "group:rolls" in listens(), timeout_ms=10000)
    record("dice", "switching the Hub to A-Cell turns it into the Handler's feed (all Cells, with the filter)",
           "group:rolls" in listens() and page.locator("#dr-cell-filter").count() == 1, str(listens()))
    record("dice", "no JS exceptions", len(errs) == 0, "; ".join(errs))
    page.close()
    return errs

def _tick_in_sealed_frame(frame_locator, sel, tries=5):
    """Ticks a checkbox inside a session note's sealed (sandboxed srcdoc)
    frame. The automated browser sometimes drops the first click into a
    freshly opened out-of-process frame (on the pre-Desk page too); a
    person tapping a moment later isn't affected. Clicks until it's
    ticked, a few tries at most."""
    box = frame_locator.locator(sel)
    for _ in range(tries):
        if box.is_checked():
            return True
        box.click()
        try:
            frame_locator.locator(sel + ":checked").wait_for(timeout=600)
            return True
        except Exception:
            pass
    return box.is_checked()

# ── v3.12.0: A-Cell's Prep / Play / Debrief ──
def acell_cell_fixture():
    """A Cell of four Agents, a session for them, a vault note with
    scenes, evidence and a library track: the seed the A-Cell shell tests
    (and their screenshots) share."""
    def agent(code, name, prof, stats, derived, player, extra=None):
        st = {"v": 1, "stats": stats, "csStats": stats, "derived": derived,
              "bio": {"name": name, "profession": prof, "disorders": []},
              "skills": {"alertness": 40, "search": 50, "firearms": 40, "medicine": 30, "persuade": 35, "unnatural": 4},
              "bonds": [{"name": "Sam (partner)", "score": 10}]}
        if extra: st["bio"].update(extra)
        return character_doc(code, st, player)
    docs = {
        "characters/MARA-KS01": agent("MARA-KS01", "Mara Kessler", "FBI Special Agent", {"STR": 11, "CON": 12, "DEX": 15, "INT": 14, "POW": 12, "CHA": 11}, {"hp": 11, "wp": 9, "san": 48, "bp": 36}, "Anna"),
        "characters/TOMA-RY02": agent("TOMA-RY02", "Tomas Reyes", "Army CID", {"STR": 13, "CON": 13, "DEX": 13, "INT": 12, "POW": 11, "CHA": 10}, {"hp": 6, "wp": 10, "san": 31, "bp": 24}, "Bence"),
        "characters/ILSE-VR03": agent("ILSE-VR03", "Ilse Varga", "CDC Epidemiologist", {"STR": 9, "CON": 11, "DEX": 11, "INT": 16, "POW": 13, "CHA": 10}, {"hp": 10, "wp": 4, "san": 22, "bp": 20}, "Dora", {"disorders": ["Paranoia"]}),
        "characters/WEND-PR04": agent("WEND-PR04", "Wendell Price", "County Deputy", {"STR": 15, "CON": 13, "DEX": 10, "INT": 10, "POW": 12, "CHA": 12}, {"hp": 14, "wp": 12, "san": 55, "bp": 43}, "Gabor"),
        "briefs/MARA-KS01": {"char_name": "Mara Kessler"}, "briefs/TOMA-RY02": {"char_name": "Tomas Reyes"},
        "briefs/ILSE-VR03": {"char_name": "Ilse Varga", "codename": "Kite", "face_plate_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="}, "briefs/WEND-PR04": {"char_name": "Wendell Price"},
        "cells/cell_osiris": {"name": "Osiris", "member_codes": ["MARA-KS01", "TOMA-RY02", "ILSE-VR03", "WEND-PR04"], "channel": "3"},
        "sessions/sess_4": {"name": "Session 4 — The lighthouse", "cell_id": "cell_osiris", "operation_id": "op_pl", "date": "2026-11-01", "state": "prep",
                            "note_path": "Pale Lantern/Session 4.md", "evidence": ["ev_log"], "tracks": [{"kind": "ambient", "ref": "drone-low", "title": "Drone: Low"}],
                            "pads": ["scream-01", "impact-ghost"], "npcs": [{"name": "Keeper", "dex": 14}], "quick_notes": [], "away": [], "created_at": 1, "updated_at": 1},
        "vault/" + "UGFsZSBMYW50ZXJuL1Nlc3Npb24gNC5tZA": {"path": "Pale Lantern/Session 4.md", "content":
            "# Session 4 — The lighthouse\n\nOpening: the causeway at low tide.\n\n## Scene 3 · The harbour\n\n- [x] Meet [[Ruth Ainsley]]\n\n## Scene 4 · The keeper's log\n\n- [x] Agents reach the lighthouse before high tide\n- [ ] The log's last entry is dated after his death\n> [!danger] Handler only\n> The Keeper is still in the lamp room.\n- [ ] SAN 0/1D4 on the final page\n- [ ] The lamp lights itself `⚡ Whispers`\n\n## Scene 5 · The lamp room\n\n- [ ] \n", "synced": None, "pending": None},
        "evidence/ev_log": {"evidence_id": "ev_log", "title": "Keeper's log", "body": "14 March. Fog again.", "cell_id": "cell_osiris", "operation_id": "", "released": False, "restricted_to": []},
        "evidence/ev_tide": {"evidence_id": "ev_tide", "title": "Tide chart", "body": "", "cell_id": "cell_osiris", "operation_id": "", "released": True, "restricted_to": []},
        "evidence/ev_ledger": {"evidence_id": "ev_ledger", "title": "Ainsley's ledger", "body": "", "cell_id": "cell_osiris", "operation_id": "", "released": False, "restricted_to": []},
        "evidence_seen/MARA-KS01_ev_tide": {"agent_code": "MARA-KS01", "evidence_id": "ev_tide", "seen_at": 1},
        "tracks/trk_1": {"track_id": "trk_1", "title": "Tension Rising", "url": "https://example.invalid/t.mp3", "uploaded_at": 1, "duration": 182},
        "tracks/trk_2": {"track_id": "trk_2", "title": "Lighthouse at Dusk", "url": "https://example.invalid/d.mp3", "uploaded_at": 2, "duration": 381},
        "operations/op_pl": {"operation_id": "op_pl", "name": "Pale Lantern", "cell_id": "cell_osiris", "created_at": 1, "vault_folder": "Pale Lantern"},
        "tapes/tape_dread": {"name": "Lighthouse · dread", "color": "#2a2a2a", "scope": "operation", "operation_id": "op_pl", "cell_id": "cell_osiris",
                             "tracks": [{"kind": "track", "ref": "trk_2", "title": "Lighthouse at Dusk", "dur": 381}, {"kind": "track", "ref": "trk_1", "title": "Tension Rising", "dur": 182}],
                             "loops": ["drone-low"], "pads": ["scream-01", "impact-ghost", "whispers-dark"], "created_at": 1, "updated_at": 1},
    }
    return docs

def push_collection(page, coll):
    """Every live listener on a whole collection gets the seeded docs (the
    stub's collection listeners don't fire on their own)."""
    page.evaluate(
        """(coll) => {
            var docs = window.__dgFirestoreDocs || {};
            var wrapped = Object.keys(docs).filter(function (k) { return k.indexOf(coll + '/') === 0 && k.split('/').length === 2; }).map(function (k) {
                var data = docs[k];
                return { id: k.split('/')[1], exists: true, data: function () { return data; } };
            });
            (window.__dgFirestoreListeners || []).filter(function (l) { return !l.isDoc && l.path === coll; }).forEach(function (l) {
                l.success({ docChanges: function () { return wrapped.map(function (d) { return { type: 'added', doc: d }; }); }, forEach: function (fn) { wrapped.forEach(fn); }, size: wrapped.length, empty: !wrapped.length });
            });
        }""", coll)

def open_acell_shell(p, docs=None, width=1440, height=950, storage=None, session="sess_4", touch=False):
    """a-cell.html past the gate, signed in as Handler, with the Cell
    fixture's roster, Cells and evidence delivered to their listeners."""
    if touch:
        page = p.new_context(viewport={"width": width, "height": height}, has_touch=True, is_mobile=True).new_page()
    else:
        page = p.new_page(viewport={"width": width, "height": height})
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)
    st = dict(storage or {})
    if session: st.setdefault("dg_acell_session", session)
    page.add_init_script("try { sessionStorage.setItem('dg_acell_pw', 'testpw'); var S = %s; Object.keys(S).forEach(function (k) { localStorage.setItem(k, S[k]); }); } catch (e) {}" % json.dumps(st))
    install_firestore_backend(page, acell_cell_fixture() if docs is None else docs)
    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    wait_for_condition(lambda: page.evaluate("() => window.__dgFirestoreAuthUser && window.__dgFirestoreAuthUser.uid") == "handler", timeout_ms=6000)
    wait_for_condition(lambda: page.evaluate("() => (window.__dgFirestoreListeners || []).some(l => l.path === 'cells') && (window.__dgFirestoreListeners || []).some(l => l.path === 'characters')"), timeout_ms=6000)
    for c in ("characters", "briefs", "cells"):
        push_collection(page, c)
    page.wait_for_timeout(150)
    return page, errs

def acell_feed_evidence(page):
    """The evidence listener starts on demand; deliver the seeded docs once it has."""
    if wait_for_condition(lambda: page.evaluate("() => (window.__dgFirestoreListeners || []).some(l => l.path === 'evidence')"), timeout_ms=6000):
        push_collection(page, "evidence")
        page.wait_for_timeout(100)

def _sess(page, sid="sess_4"):
    return fs_doc(page, "sessions/" + sid) or {}

def _vault_doc(page, path):
    return page.evaluate("(p) => { var d = window.__dgFirestoreDocs || {}; var k = Object.keys(d).filter(k => k.indexOf('vault/') === 0 && d[k] && d[k].path === p)[0]; return k ? d[k] : null; }", path)

def test_acell_shell(p):
    """v3.12.0, A-Cell's shell: PREP / PLAY / DEBRIEF in the top bar, the
    folder's index down the left (Session prep first, no Desk tab), the
    session pill, and Session prep's panels -- the session's Cell and its
    Agents (away tonight), its notes (the vault note, ticks save), the
    evidence to hand out (and more to load in), its music and pads; the
    panels swap by their grips and the order is kept; a new session from
    the picker."""
    page, errs = open_acell_shell(p)
    tabs = page.eval_on_selector_all("#acell-tab-strip .tw", "els => els.map(e => e.dataset.tab)")
    record("acell-shell", "the index: Session prep, Players, Evidence, Music, Notes, Sheet, Cells, ID Creator (no Desk tab)",
           tabs == ["session", "play", "evidence", "music", "notes", "sheet", "cells", "ids"], str(tabs))
    record("acell-shell", "A-Cell opens in PREP on Session prep",
           page.evaluate("() => document.body.dataset.acMode") == "prep" and page.is_visible("#panel-session") and page.is_visible("#ac-modes [data-mode=prep].on"), "")
    wait_for_condition(lambda: "Session 4" in page.inner_text("#ac-session-pill"), timeout_ms=5000)
    record("acell-shell", "the top bar's pill names the session and its Cell",
           "Session 4 — The lighthouse" in page.inner_text("#ac-session-pill") and "Osiris" in page.inner_text("#ac-session-pill"), page.inner_text("#ac-session-pill"))
    wait_for_condition(lambda: page.locator("[data-pb=players] .ac-row").count() == 4, timeout_ms=5000)
    rows = page.eval_on_selector_all("[data-pb=players] .ac-row", "els => els.map(e => e.innerText.replace(/\\s+/g, ' '))")
    record("acell-shell", "Players lists the Cell's four Agents with their vitals",
           len(rows) == 4 and "Tomas Reyes" in rows[1] and "HP 6" in rows[1] and "WP 10" in rows[1], str(rows))
    record("acell-shell", "a disorder shows on the Agent's row", "Paranoia" in rows[2], rows[2] if len(rows) > 2 else "")
    page.click("[data-pb=players] .ac-row[data-code=WEND-PR04] [data-ac=away]")
    wait_for_condition(lambda: _sess(page).get("away") == ["WEND-PR04"], timeout_ms=4000)
    record("acell-shell", "☾ marks an Agent away tonight (sessions/{id}.away)", _sess(page).get("away") == ["WEND-PR04"], str(_sess(page).get("away")))
    wait_for_condition(lambda: "away tonight" in page.inner_text("[data-pb=players] .ac-row[data-code=WEND-PR04]"), timeout_ms=3000)
    record("acell-shell", "…and their row says so", "away tonight" in page.inner_text("[data-pb=players] .ac-row[data-code=WEND-PR04]"), "")

    wait_for_condition(lambda: page.locator("[data-pb=notes] .vn-body").count() > 0 and "keeper" in page.inner_text("[data-pb=notes]").lower(), timeout_ms=5000)
    record("acell-shell", "Notes shows the session's vault note, rendered", "Scene 4" in page.inner_text("[data-pb=notes]") and page.locator("[data-pb=notes] .vn-call").count() == 1, page.inner_text("[data-pb=notes]")[:200])
    page.locator("[data-pb=notes] .vn-ck:not(.on)").first.click()
    wait_for_condition(lambda: "- [x] The log's last entry" in ((_vault_doc(page, "Pale Lantern/Session 4.md") or {}).get("content") or ""), timeout_ms=4000)
    record("acell-shell", "ticking a box in the note saves the note",
           "- [x] The log's last entry" in ((_vault_doc(page, "Pale Lantern/Session 4.md") or {}).get("content") or ""), "")

    acell_feed_evidence(page)
    wait_for_condition(lambda: "Keeper's log" in page.inner_text("[data-pb=evidence]"), timeout_ms=5000)
    ev = page.inner_text("[data-pb=evidence]")
    record("acell-shell", "Evidence: the session's item, not released yet (ready), and more to load in from the Cell",
           "Keeper's log" in ev and "ready" in ev and "Ainsley's ledger" in ev, ev[:300])
    page.click("[data-pb=evidence] .ac-row[data-ev=ev_ledger] [data-ac=ev]")
    wait_for_condition(lambda: "ev_ledger" in (_sess(page).get("evidence") or []), timeout_ms=4000)
    record("acell-shell", "ticking a suggestion adds it to the session", _sess(page).get("evidence") == ["ev_log", "ev_ledger"], str(_sess(page).get("evidence")))
    wait_for_condition(lambda: "unseen" in page.inner_text("[data-pb=evidence]") or "not seen by" in page.inner_text("[data-pb=evidence]"), timeout_ms=4000)
    record("acell-shell", "released evidence says who hasn't seen it (evidence_seen)",
           "not seen by Reyes, Varga, Price" in page.inner_text("[data-pb=evidence]"), page.inner_text("[data-pb=evidence]")[:400])
    mu = page.inner_text("[data-pb=music]")
    record("acell-shell", "Music & effects: the operation's tapes, one tap from the deck", "Lighthouse · dread" in mu and "2 tracks · 9:23" in mu and page.locator("[data-pb=music] [data-ac=tape-in]").count() == 1, mu[:200])

    # Swap the Players and Notes panels by dragging Players' grip onto Notes.
    page.evaluate("() => window.scrollTo(0, 0)")
    page.wait_for_timeout(200)
    g = page.locator("[data-pn=players] .ac-grip").bounding_box()
    t = page.locator("[data-pn=notes]").bounding_box()
    page.mouse.move(g["x"] + 4, g["y"] + 4); page.mouse.down()
    page.mouse.move(t["x"] + t["width"] / 2, t["y"] + 40, steps=6); page.mouse.up()
    order = page.eval_on_selector_all("#panel-session [data-pn]", "els => els.map(e => e.dataset.pn)")
    kept = page.evaluate("() => JSON.parse(localStorage.getItem('dg_acell_prep_v1') || '{}').order")
    record("acell-shell", "dragging a panel's grip onto another swaps them, and the order is kept on the device",
           order[:2] == ["notes", "players"] and kept[:2] == ["notes", "players"], str(order) + " " + str(kept))
    page.click("[data-pn=evidence] [data-ac=wide]")
    record("acell-shell", "⤢ makes a panel full width", "wide" in page.get_attribute("[data-pn=evidence]", "class"), "")

    page.select_option("[data-ac=pick-session]", "__new")
    page.wait_for_selector(".ac-form", timeout=4000)
    page.fill(".ac-form input[name=name]", "Session 5 — The lamp room")
    page.click(".ac-form button[type=submit]")
    wait_for_condition(lambda: "Session 5" in page.inner_text("#ac-session-pill"), timeout_ms=4000)
    new = [w for w in fs_writes(page, "sessions/") if (w.get("data") or {}).get("name") == "Session 5 — The lamp room"]
    record("acell-shell", "+ New session writes sessions/{id} with the name and the Cell, and makes it the current one",
           bool(new) and new[0]["data"].get("cell_id") == "cell_osiris" and "Session 5" in page.inner_text("#ac-session-pill"), str(new[:1]))

    page.click("#ac-modes [data-mode=play]")
    record("acell-shell", "PLAY: the desk, the index tabs hidden, Arrange in the top bar",
           page.evaluate("() => document.body.dataset.acMode") == "play" and page.is_visible("#panel-desk") and not page.is_visible("#acell-tab-strip") and page.is_visible("#ac-tools [data-tool=arrange]"), "")
    page.click("#ac-modes [data-mode=prep]")
    record("acell-shell", "PREP goes back to the tab you left", page.is_visible("#panel-session") and page.is_visible("#acell-tab-strip"), "")
    record("acell-shell", "no JS errors in Prep", not errs, str(errs))

def test_acell_library(p):
    """v3.12.0, the Prep libraries: Evidence's filters (Not released / Not
    seen yet / Released) and + Add to session; the Music tab's tape shelf
    (tracks, loops, effect cartridges: add to the session's tape, fire on
    the table); the Notes tab's vault browser with a new note."""
    page, errs = open_acell_shell(p)
    page.click("#acell-tab-strip .tw[data-tab=evidence]")
    acell_feed_evidence(page)
    wait_for_condition(lambda: "Not released · 2" in page.inner_text("#ac-ev-chips"), timeout_ms=5000)
    chips = page.inner_text("#ac-ev-chips")
    wait_for_condition(lambda: "Not seen yet · 1" in page.inner_text("#ac-ev-chips"), timeout_ms=4000)
    record("acell-library", "Evidence filters count Not released, Not seen yet and Released",
           "Not released · 2" in chips and "Not seen yet · 1" in page.inner_text("#ac-ev-chips") and "Released · 1" in chips, chips)
    page.click("#ac-ev-chips [data-f=held]")
    page.wait_for_timeout(200)
    titles = page.eval_on_selector_all("#evidence-list .evidence-title, #evidence-list h3, #evidence-list .ev-title", "els => els.map(e => e.innerText)")
    listed = page.inner_text("#evidence-list")
    record("acell-library", "Not released shows only what's still held", "Keeper's log" in listed and "Ainsley's ledger" in listed and "Tide chart" not in listed, listed[:300])
    record("acell-library", "an item already in the session says so", page.locator("#evidence-list [data-ac-ev=ev_log].on").count() == 1, "")
    page.click("#evidence-list [data-ac-ev=ev_ledger]")
    wait_for_condition(lambda: "ev_ledger" in (_sess(page).get("evidence") or []), timeout_ms=4000)
    record("acell-library", "+ Add to session adds the evidence to the session", "ev_ledger" in (_sess(page).get("evidence") or []), str(_sess(page).get("evidence")))

    page.click("#acell-tab-strip .tw[data-tab=music]")
    push_collection(page, "tracks") if page.evaluate("() => (window.__dgFirestoreListeners || []).some(l => l.path === 'tracks')") else None
    wait_for_condition(lambda: page.locator("#ac-shelf .ac-spn[data-kind=track]").count() == 2, timeout_ms=5000)
    record("acell-library", "the shelf: tracks (their time on the spine), the seven loops, effects as cartridges",
           page.locator("#ac-shelf .ac-spn[data-kind=ambient]").count() == 7 and page.locator("#ac-shelf .ac-cart").count() > 10
           and page.inner_text("#ac-shelf .ac-spn[data-ref=trk_1] em") == "3:02", page.inner_text("#ac-shelf .ac-spn[data-ref=trk_1]"))
    wait_for_condition(lambda: page.locator("#ac-tapes .ac-tcard").count() == 1, timeout_ms=5000)
    record("acell-library", "Tapes: the session's operation's tape, opened, on its rack",
           "Lighthouse · dread" in page.inner_text("#ac-tapes .ac-tcard") and "Lighthouse · dread" in page.inner_text("#ac-tapes .ac-topen") and "9:23" in page.inner_text("#ac-tapes .ac-topen"), page.inner_text("#ac-tapes")[:300])
    record("acell-library", "what's on the open tape is marked on the shelf",
           "used" in page.get_attribute("#ac-shelf .ac-spn[data-ref=drone-low]", "class") and "used" in page.get_attribute("#ac-shelf .ac-cart[data-ref=scream-01]", "class"), "")
    page.click("#ac-tapes [data-mu=new][data-scope=operation]")
    page.wait_for_selector("#ac-tapes [data-mu-tname]", timeout=4000)
    page.fill("#ac-tapes [data-mu-tname]", "Harbour · calm")
    page.press("#ac-tapes [data-mu-tname]", "Enter")
    wait_for_condition(lambda: any((w.get("data") or {}).get("name") == "Harbour · calm" for w in fs_writes(page, "tapes/")), timeout_ms=4000)
    wait_for_condition(lambda: "Harbour · calm" in page.inner_text("#ac-tapes .ac-topen"), timeout_ms=3000)
    new = [w for w in fs_writes(page, "tapes/") if (w.get("data") or {}).get("scope") == "operation" and w["path"] != "tapes/tape_dread"]
    record("acell-library", "+ New blank tape makes a tape for the operation, named, and opens it",
           bool(new) and new[0]["data"].get("operation_id") == "op_pl" and "Harbour · calm" in page.inner_text("#ac-tapes .ac-topen"), str(new[:1])[:300])
    tid = new[0]["path"].split("/")[1] if new else ""
    page.click("#ac-shelf .ac-spn[data-ref=trk_1]")
    page.click("#ac-shelf .ac-pop [data-mu=tape]")
    wait_for_condition(lambda: any(t.get("ref") == "trk_1" for t in (fs_doc(page, "tapes/" + tid) or {}).get("tracks") or []), timeout_ms=4000)
    tr = (fs_doc(page, "tapes/" + tid) or {}).get("tracks") or []
    record("acell-library", "a track from the shelf goes on the open tape, with its time", tr and tr[0].get("title") == "Tension Rising" and tr[0].get("dur") == 182, str(tr))
    page.click("#ac-shelf .ac-spn[data-ref=haunted]")
    page.click("#ac-shelf .ac-pop [data-mu=tape]")
    page.click("#ac-shelf .ac-cart[data-ref=scream-02]")
    page.click("#ac-shelf .ac-pop [data-mu=tape]")
    wait_for_condition(lambda: "scream-02" in ((fs_doc(page, "tapes/" + tid) or {}).get("pads") or []), timeout_ms=4000)
    d = fs_doc(page, "tapes/" + tid) or {}
    record("acell-library", "a loop goes under it, a cartridge becomes one of its pads", d.get("loops") == ["haunted"] and d.get("pads") == ["scream-02"], str(d)[:300])
    page.click("#ac-shelf .ac-cart[data-ref=impact-ghost]")
    page.click("#ac-shelf .ac-pop [data-mu=table]")
    wait_for_condition(lambda: any(any(s.get("id") == "impact-ghost" for s in (w.get("data") or {}).get("stingers") or []) for w in fs_writes(page, "radio/")), timeout_ms=4000)
    record("acell-library", "⚡ Fire on the table fires the effect on the broadcast",
           any(any(s.get("id") == "impact-ghost" for s in (w.get("data") or {}).get("stingers") or []) for w in fs_writes(page, "radio/")), "")

    page.click("#acell-tab-strip .tw[data-tab=notes]")
    wait_for_condition(lambda: page.locator("#ac-vault .vn-pi[data-vp]").count() == 1, timeout_ms=5000)
    record("acell-library", "the Notes tab lists the vault and opens the session's note (the vault's one top folder isn't repeated)",
           "Session 4" in page.inner_text("#ac-vault .ac-vlist") and "PALE LANTERN" not in page.inner_text("#ac-vault .ac-vlist").upper() and "Scene 4" in page.inner_text("#ac-vault .ac-vnote"), page.inner_text("#ac-vault")[:200])
    # Paths as iOS sends them, and folders with number prefixes: readable names, folders that fold.
    page.evaluate("""() => Promise.all(['Delta Green/01_Session notes/Lover in the Ice - 27-01.md', 'Delta Green/02_NPCs/Ruth_Ainsley.md',
        'iCloudDrive:Obsidian:Delta Green:Delta Green:04_Handouts:Keepers log.txt.md'].map(p => window.dgVault.save(p, 'x')))""")
    wait_for_condition(lambda: page.locator("#ac-vault .ac-vdh").count() >= 3, timeout_ms=4000)
    heads = page.eval_on_selector_all("#ac-vault .ac-vdh", "els => els.map(e => e.innerText.replace(/\\s+/g, ' ').trim())")
    record("acell-library", "folders read plainly (no number prefixes or underscores, an iOS colon path too) and start folded",
           any(h.startswith("▸ Delta Green › Session notes") for h in heads) and any("Delta Green › Handouts" in h for h in heads) and all(h.startswith("▸") for h in heads if "Delta Green" in h), str(heads))
    page.click("#ac-vault .ac-vdh[data-vdir='Delta Green › NPCs']")
    record("acell-library", "a folder opens on a tap, its notes by plain name", "Ruth Ainsley" in page.inner_text("#ac-vault .ac-vlist"), page.inner_text("#ac-vault .ac-vlist"))
    page.click("#ac-vault [data-vv=new]")
    page.fill(".vn-newpath", "NPCs/Ruth Ainsley")
    page.click("[data-vnew]")
    wait_for_condition(lambda: _vault_doc(page, "NPCs/Ruth Ainsley.md") is not None, timeout_ms=4000)
    record("acell-library", "+ New note makes the note in the vault and opens it",
           (_vault_doc(page, "NPCs/Ruth Ainsley.md") or {}).get("content", "").startswith("# Ruth Ainsley") and "Ruth Ainsley" in page.inner_text("#ac-vault .ac-vnote"), "")
    record("acell-library", "the HTML pages (Session Notes) are still below the vault", page.is_visible("#sn-add-btn"), "")
    record("acell-library", "no JS errors in the libraries", not errs, str(errs))

def test_acell_players_file(p):
    """v3.12.0, Players: beside an Agent's stats, their player file in the
    vault (Players/<name>.md); ✎ Edit sheet opens the Agent File paper in
    Edit, and saving asks the Handler for the reason, logged in the file."""
    page, errs = open_acell_shell(p)
    page.click("[data-pb=players] .ac-row[data-code=ILSE-VR03] [data-ac=open-agent]")
    wait_for_condition(lambda: page.is_visible("#ac-pfile [data-pf=start]"), timeout_ms=6000)
    record("acell-players", "✎ on Session prep opens the Agent on the Players tab, with no player file yet",
           page.is_visible("#panel-play") and "Ilse Varga" in page.inner_text("#play-view") and page.is_visible("#ac-pfile [data-pf=start]"), "")
    page.click("#ac-pfile [data-pf=start]")
    wait_for_condition(lambda: _vault_doc(page, "Players/Ilse Varga.md") is not None, timeout_ms=4000)
    c = (_vault_doc(page, "Players/Ilse Varga.md") or {}).get("content", "")
    record("acell-players", "Start the player file makes Players/<name>.md with its three sections",
           "agent code: ILSE-VR03" in c and "## Handler notes" in c and "## Sheet changes" in c and "## Quick notes from play" in c, c[:300])
    page.click("#ac-pfile [data-pf=edit]")
    page.wait_for_selector(".ac-sheetmodal .ap-name-in", timeout=10000)
    record("acell-players", "✎ Edit sheet opens the Agent File paper straight into Edit", page.is_visible(".ac-sheetmodal .ap-name-in"), "")
    page.click(".ac-sheetmodal [data-a=save]")
    page.wait_for_selector(".ac-reason .ac-why", timeout=4000)
    record("acell-players", "Save asks the Handler what happened instead of the players' Oath",
           page.is_visible(".ac-reason") and page.locator("#fn-orders").count() == 0, "")
    page.fill(".ac-reason .ac-why", "pushed through the fog")
    page.click(".ac-reason [data-yes]")
    wait_for_condition(lambda: "pushed through the fog" in ((_vault_doc(page, "Players/Ilse Varga.md") or {}).get("content") or ""), timeout_ms=5000)
    c = (_vault_doc(page, "Players/Ilse Varga.md") or {}).get("content", "")
    sec = c.split("## Sheet changes")[1].split("## Quick notes")[0] if "## Sheet changes" in c else ""
    record("acell-players", "the reason is logged under Sheet changes, dated, with the session",
           "by Handler" in sec and "pushed through the fog" in sec and "Session 4" in sec, sec)
    record("acell-players", "no JS errors on the Players tab", not errs, str(errs))

def test_acell_play_desk(p):
    """v3.12.0, the Play desk: dossiers with vitals and warnings, quick
    notes on them and on the pad, initiative (Cell by DEX and the
    session's NPCs), the notebook a scene at a time with its cues, the
    evidence box, the effect pads and STOP, the Dice Roller moved into its
    slot (and back), the vitals noted when Play begins, Arrange, and the
    desk coming back after a reload."""
    page, errs = open_acell_shell(p)
    acell_feed_evidence(page)
    page.click("#ac-modes [data-mode=play]")
    wait_for_condition(lambda: page.locator(".pd-dos").count() == 4, timeout_ms=5000)
    start = _sess(page).get("start") or {}
    record("acell-play", "entering Play notes every Agent's vitals once (session.start)",
           start.get("TOMA-RY02", {}).get("hp") == 6 and start.get("ILSE-VR03", {}).get("san") == 22 and len(start) == 4, str(start)[:200])
    reyes = page.inner_text(".pd-dos[data-code=TOMA-RY02]")
    ilse = page.inner_text(".pd-dos[data-code=ILSE-VR03]")
    record("acell-play", "a dossier: name, DEX, HP/WP of their max, SAN, BP, and the warnings",
           "Tomas Reyes" in reyes and "DEX 13" in reyes and "HP 6/13" in reyes and "wounded" in reyes and "2 from BP" in ilse and "Paranoia" in ilse, reyes + " | " + ilse)
    cards = page.eval_on_selector_all(".pd-ic:not(.add)", "els => els.map(e => e.innerText.replace(/\\s+/g, ' ').trim())")
    record("acell-play", "initiative: the Cell and the session's NPC by DEX",
           [c.split(" ")[0] for c in cards] == ["KESSLER", "KEEPER", "REYES", "VARGA", "PRICE"], str(cards))
    page.click(".pd-next")
    record("acell-play", "Next ▸ moves the turn on", "REYES" not in page.inner_text(".pd-ic.now") and "KEEPER" in page.inner_text(".pd-ic.now"), page.inner_text(".pd-ic.now"))
    page.click(".pd-ic.add")
    page.fill(".pd-npcf input[name=n]", "Ruth")
    page.fill(".pd-npcf input[name=d]", "9")
    page.fill(".pd-npcf input[name=hp]", "10")
    page.fill(".pd-npcf input[name=wp]", "8")
    page.click(".pd-npcf button")
    wait_for_condition(lambda: any(n.get("name") == "Ruth" for n in _sess(page).get("npcs") or []), timeout_ms=4000)
    ruth = [n for n in _sess(page).get("npcs") or [] if n.get("name") == "Ruth"]
    record("acell-play", "an NPC is added with DEX, HP and WP (SAN left blank)", ruth and ruth[0] == {"name": "Ruth", "dex": 9, "hp": 10, "wp": 8}, str(ruth))
    wait_for_condition(lambda: "HP 10 · WP 8" in page.inner_text(".pd-initiative"), timeout_ms=3000)
    record("acell-play", "the NPC's card shows the vitals given", "HP 10 · WP 8" in page.inner_text(".pd-initiative"), page.inner_text(".pd-initiative"))
    page.locator(".pd-ic.npc").filter(has_text="RUTH").locator("[data-pd=npc-edit]").click()
    page.click(".pd-npced [data-k=hp][data-d='-1']")
    wait_for_condition(lambda: any(n.get("name") == "Ruth" and n.get("hp") == 9 for n in _sess(page).get("npcs") or []), timeout_ms=4000)
    record("acell-play", "✎ on the card, then − takes a point of HP off", any(n.get("name") == "Ruth" and n.get("hp") == 9 for n in _sess(page).get("npcs") or []), str(_sess(page).get("npcs")))

    tabs = page.eval_on_selector_all(".pd-tab", "els => els.map(e => e.innerText)")
    record("acell-play", "the notebook has a tab per ## scene (and the opening, and the whole note)",
           "Scene 4 · The keeper's log" in tabs and tabs[0] == "Opening" and tabs[-1] == "Whole note", str(tabs))
    page.click(".pd-tab[data-t=\"Scene 4 · The keeper's log\"]")
    body = page.inner_text(".pd-notebook .vn-body")
    record("acell-play", "a scene tab shows just that scene", "The Keeper is still in the lamp room" in body and "Meet" not in body, body[:200])
    page.click(".pd-notebook .vn-cue")
    wait_for_condition(lambda: any(any("whisper" in s.get("id", "") for s in (w.get("data") or {}).get("stingers") or []) for w in fs_writes(page, "radio/")), timeout_ms=4000)
    record("acell-play", "tapping a ⚡ cue in the notes fires that effect",
           any(any("whisper" in s.get("id", "") for s in (w.get("data") or {}).get("stingers") or []) for w in fs_writes(page, "radio/")), "")

    page.fill(".pd-pad .pd-in", "Reyes found the boat key")
    page.press(".pd-pad .pd-in", "Enter")
    page.click(".pd-dos[data-code=MARA-KS01] [data-pd=jot]")
    page.fill(".pd-dos[data-code=MARA-KS01] .pd-qin", "Wants to call Sam")
    page.press(".pd-dos[data-code=MARA-KS01] .pd-qin", "Enter")
    wait_for_condition(lambda: len(_sess(page).get("quick_notes") or []) == 2, timeout_ms=4000)
    q = _sess(page).get("quick_notes") or []
    record("acell-play", "quick notes: on the pad (the session's) and on a dossier (that Agent's)",
           len(q) == 2 and q[0]["code"] == "" and q[1]["code"] == "MARA-KS01" and q[1]["text"] == "Wants to call Sam", str(q))
    wait_for_condition(lambda: "Wants to call Sam" in page.inner_text(".pd-dos[data-code=MARA-KS01]"), timeout_ms=3000)
    record("acell-play", "the Agent's quick note sits on their dossier", "Wants to call Sam" in page.inner_text(".pd-dos[data-code=MARA-KS01]"), "")

    page.click(".pd-f[data-ev=ev_log] [data-pd=release]")
    wait_for_condition(lambda: (fs_doc(page, "evidence/ev_log") or {}).get("released") is True, timeout_ms=5000)
    record("acell-play", "release ▸ in the evidence box releases it", (fs_doc(page, "evidence/ev_log") or {}).get("released") is True, str(fs_doc(page, "evidence/ev_log"))[:200])
    page.click(".pd-fx[data-id=scream-01]")
    wait_for_condition(lambda: any(any(s.get("id") == "scream-01" for s in (w.get("data") or {}).get("stingers") or []) for w in fs_writes(page, "radio/")), timeout_ms=4000)
    record("acell-play", "an effect pad fires its effect", any(any(s.get("id") == "scream-01" for s in (w.get("data") or {}).get("stingers") or []) for w in fs_writes(page, "radio/")), "")
    page.click(".pd-fx.stop")
    wait_for_condition(lambda: any((w.get("data") or {}).get("stingers") == [] and (w.get("data") or {}).get("stinger_stops") for w in fs_writes(page, "radio/")), timeout_ms=4000)
    record("acell-play", "STOP clears every effect and loop for everyone (stinger_stops)",
           any((w.get("data") or {}).get("stingers") == [] and (w.get("data") or {}).get("ambient_layers") == [] for w in fs_writes(page, "radio/")), "")

    wait_for_condition(lambda: page.evaluate("() => !!document.querySelector('.pd-dice #dr-panel')"), timeout_ms=4000)
    record("acell-play", "the Dice Roller sits in its slot on the desk, open",
           page.evaluate("() => { var p = document.querySelector('.pd-dice #dr-panel'); return !!p && !p.classList.contains('dr-collapsed') && getComputedStyle(p).position !== 'fixed'; }"), "")

    page.click("#ac-tools [data-tool=arrange]")
    record("acell-play", "✥ Arrange shows the drawer and each object's grip", page.is_visible(".pd-drawer") and page.locator(".pd-grip").count() == 8, "")
    def cell_xy(cx, cy):
        g = page.locator(".pd-grid").bounding_box()
        cw = (g["width"] - 12 * 11) / 12
        return g["x"] + cx * (cw + 12) + cw / 2, g["y"] + cy * (58 + 12) + 29
    lay3 = lambda: page.evaluate("() => JSON.parse(localStorage.getItem('dg_acell_desk_v3') || '{}')").get("items", {})
    # Drag the pads by their title bar to an empty spot lower down.
    b = page.locator(".pd-o[data-o=pads] .pd-oh").bounding_box()
    tx, ty = cell_xy(10, 9)
    page.mouse.move(b["x"] + 10, b["y"] + 8); page.mouse.down()
    page.mouse.move(tx, ty, steps=8)
    record("acell-play", "while dragging, a green outline shows where it lands", page.is_visible(".pd-ghost"), "")
    page.mouse.up()
    it = lay3()
    record("acell-play", "dragging a title bar puts the object at that spot on the grid, kept on the device (a small object stays small)",
           it.get("pads", {}).get("y", 0) >= 8 and it.get("pads", {}).get("w") == 5 and it.get("pads", {}).get("h") == 3, str(it.get("pads")))
    # Size the tape deck from its yellow corner: two columns wider, a row taller.
    p0 = it["deck"]
    page.locator(".pd-o[data-o=deck] .pd-rz").scroll_into_view_if_needed()
    page.evaluate("() => window.scrollBy(0, 250)")
    page.wait_for_timeout(100)
    rz = page.locator(".pd-o[data-o=deck] .pd-rz").bounding_box()
    ex, ey = cell_xy(p0["x"] + p0["w"] + 1, p0["y"] + p0["h"])
    page.mouse.move(rz["x"] + 8, rz["y"] + 8); page.mouse.down(); page.mouse.move(ex, ey, steps=8); page.mouse.up()
    it = lay3()
    record("acell-play", "dragging the corner sizes it (what it now covers moves down)", it["deck"]["w"] == p0["w"] + 2 and it["deck"]["h"] == p0["h"] + 1, str(it["deck"]))
    record("acell-play", "nothing overlaps after a move or a resize",
           not any(a != c and it[a]["x"] < it[c]["x"] + it[c]["w"] and it[c]["x"] < it[a]["x"] + it[a]["w"] and it[a]["y"] < it[c]["y"] + it[c]["h"] and it[c]["y"] < it[a]["y"] + it[a]["h"] for a in it for c in it), str(it))
    # On a touch screen: tap a title bar, then tap the cell it should start at.
    page.click(".pd-o[data-o=evidence] .pd-oh")
    record("acell-play", "tapping an object's title bar picks it up", "pd-picked" in page.get_attribute(".pd-o[data-o=evidence]", "class") and "tap where" in page.inner_text(".pd-pickt"), "")
    ev0 = lay3()["evidence"]
    gx, gy = cell_xy(0, 20) if False else cell_xy(9, ev0["y"] + 6)
    page.mouse.click(gx, gy)
    it = lay3()
    record("acell-play", "…and tapping the grid puts it there", it["evidence"]["y"] == ev0["y"] + 6, str(ev0) + " -> " + str(it.get("evidence")))
    page.click(".pd-o[data-o=initiative] [data-pd=away]")
    record("acell-play", "✕ puts an object away; the drawer brings it back",
           page.locator(".pd-o[data-o=initiative]").count() == 0 and page.locator(".pd-drawer [data-id=initiative]").count() == 1, "")
    page.click(".pd-drawer [data-id=initiative]")
    record("acell-play", "…and back it comes", page.locator(".pd-o[data-o=initiative]").count() == 1, "")
    page.click("#ac-tools [data-tool=arrange]")

    page.click(".pd-dos[data-code=ILSE-VR03] [data-pd=sheet]")
    page.wait_for_selector(".ac-sheetmodal .ap-head", timeout=10000)
    record("acell-play", "a dossier's name opens their Agent File as it is (vitals ±, Roll SAN), with their photo",
           page.locator(".ac-sheetmodal .ap-name-in").count() == 0 and page.locator(".ac-sheetmodal [data-a=rollsan]").count() == 1
           and page.locator(".ac-sheetmodal .as-photo img").count() == 1, "")
    page.click(".ac-sheetmodal [data-vclose]")
    page.click("#ac-modes [data-mode=prep]")
    record("acell-play", "leaving Play puts the Dice Roller back where it was, folded",
           page.evaluate("() => { var p = document.getElementById('dr-panel'); return p.parentNode === document.body && p.classList.contains('dr-collapsed'); }"), "")
    page.click("#ac-modes [data-mode=play]")
    page.reload(wait_until="domcontentloaded")
    wait_for_condition(lambda: page.evaluate("() => document.body.dataset.acMode") == "play", timeout_ms=6000)
    record("acell-play", "a reload mid-game comes back to the desk", page.evaluate("() => document.body.dataset.acMode") == "play", "")
    record("acell-play", "no JS errors on the desk", not errs, str(errs))

def test_acell_debrief(p):
    """v3.12.0, Debrief: a new vault note "<session> · debrief.md" beside
    the session's notes -- To do (who to catch up), the quick notes from
    Play, Additional notes; Done files each Agent's quick notes and what
    the night cost them (vitals now against Play's start) in their player
    files and marks the session debriefed."""
    page, errs = open_acell_shell(p)
    page.click("[data-pb=players] .ac-row[data-code=WEND-PR04] [data-ac=away]")
    page.click("#ac-modes [data-mode=play]")
    wait_for_condition(lambda: bool(_sess(page).get("start")), timeout_ms=5000)
    page.fill(".pd-pad .pd-in", "Reyes found the boat key")
    page.press(".pd-pad .pd-in", "Enter")
    page.click(".pd-dos[data-code=ILSE-VR03] [data-pd=jot]")
    page.fill(".pd-dos[data-code=ILSE-VR03] .pd-qin", "Trusts nobody with the log")
    page.press(".pd-dos[data-code=ILSE-VR03] .pd-qin", "Enter")
    wait_for_condition(lambda: len(_sess(page).get("quick_notes") or []) == 2, timeout_ms=4000)
    # The night costs Varga 3 SAN (her sheet changes live).
    st = json.loads(fs_doc(page, "characters/ILSE-VR03")["character_json"])
    st["derived"]["san"] = 19
    page.evaluate("(s) => { window.__dgFirestoreDocs['characters/ILSE-VR03'].character_json = s; }", json.dumps(st))
    push_collection(page, "characters")
    page.click("#ac-modes [data-mode=debrief]")
    page.wait_for_selector("[data-db=start]", timeout=5000)
    record("acell-debrief", "Debrief offers the new note and what the night cost them", "SAN 22 → 19" in page.inner_text("#panel-debrief"), page.inner_text("#panel-debrief")[:300])
    page.click("[data-db=start]")
    path = "Pale Lantern/Session 4 — The lighthouse · debrief.md"
    wait_for_condition(lambda: _vault_doc(page, path) is not None, timeout_ms=4000)
    c = (_vault_doc(page, path) or {}).get("content", "")
    record("acell-debrief", "the debrief note: beside the session's notes, To do / Quick notes / Additional notes",
           "# Session 4 — The lighthouse · debrief" in c and "## To do" in c and "## Quick notes" in c and "## Additional notes" in c, c[:400])
    record("acell-debrief", "the quick notes are imported (an Agent's linked to their file) and the away Agent is on the To do",
           "Reyes found the boat key" in c and "[[Ilse Varga]] Trusts nobody with the log" in c and "Catch Wendell Price up" in c, c)
    record("acell-debrief", "it opens for writing", page.is_visible("#panel-debrief .vn-ta"), "")
    page.click("[data-db=done]")
    wait_for_condition(lambda: _sess(page).get("state") == "debriefed", timeout_ms=6000)
    pf = (_vault_doc(page, "Players/Ilse Varga.md") or {}).get("content", "")
    record("acell-debrief", "Done files the cost and the quick note in the Agent's player file",
           "SAN 22 → 19" in pf.split("## Sheet changes")[1] and "[[Session 4 — The lighthouse · debrief]] Trusts nobody with the log" in pf, pf)
    wait_for_condition(lambda: "Debriefed" in page.inner_text("#panel-debrief"), timeout_ms=3000)
    record("acell-debrief", "…and marks the session debriefed", _sess(page).get("state") == "debriefed" and "Debriefed" in page.inner_text("#panel-debrief"), "")
    record("acell-debrief", "no JS errors in Debrief", not errs, str(errs))

def test_acell_phone(p):
    """v3.13.0: on a phone A-Cell opens in its own phone layout (the
    Field kit, tests below); More → Computer layout gives the folder back
    -- the index tabs in one button, Session prep's panels stacked, the desk
    one column -- with a Phone layout button to return."""
    page, errs = open_acell_shell(p, width=390, height=844, touch=True, storage={"dg_acm_desktop": "true"})
    wait_for_condition(lambda: page.locator("[data-pb=players] .ac-row").count() == 4, timeout_ms=5000)
    record("acell-phone", "the computer layout on a phone: no phone frame, a way back to it", not page.is_visible("#acm-tabs") and page.is_visible(".acm-back"), "")
    wide = page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")
    record("acell-phone", "Prep fits the phone's width", wide, str(page.evaluate("() => [document.documentElement.scrollWidth, window.innerWidth]")))
    boxes = page.eval_on_selector_all("#panel-session [data-pn]", "els => els.map(e => Math.round(e.getBoundingClientRect().left))")
    record("acell-phone", "Session prep's panels stack", len(set(boxes)) == 1, str(boxes))
    record("acell-phone", "the tabs fold into one button for the tab you're on", page.is_visible("#ac-index-btn") and not page.is_visible("#acell-tab-strip") and "SESSION PREP" in page.inner_text("#ac-index-btn").upper(), "")
    page.click("#ac-index-btn")
    page.click("#acell-tab-strip .tw[data-tab=music]")
    record("acell-phone", "picking one opens it", page.is_visible("#ac-console .cc-deck") and "MUSIC" in page.inner_text("#ac-index-btn").upper(), "")
    page.click("#ac-modes [data-mode=play]")
    wait_for_condition(lambda: page.locator(".pd-dos").count() == 4, timeout_ms=5000)
    d = page.locator(".pd-o[data-o=dossiers]").bounding_box()
    n = page.locator(".pd-o[data-o=notebook]").bounding_box()
    record("acell-phone", "the desk: dossiers first, then the notebook", d["y"] < n["y"], str([d, n]))
    record("acell-phone", "the desk fits the phone's width", page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), str(page.evaluate("() => document.documentElement.scrollWidth")))
    page.click(".acm-back")
    wait_for_condition(lambda: page.is_visible("#acm-tabs"), timeout_ms=3000)
    record("acell-phone", "Phone layout brings the phone frame back", page.is_visible("#acm-tabs") and not page.is_visible(".acm-back"), "")
    record("acell-phone", "no JS errors on the phone", not errs, str(errs))

EMOJI_RE = "[\\u2600-\\u27BF\\u2B00-\\u2BFF\\u23E9-\\u23FA\\u2190-\\u21FF\\u25A0-\\u25FF]|[\\uD83C-\\uDBFF][\\uDC00-\\uDFFF]"

def open_phone(p, docs=None, storage=None, mode="prep"):
    """A-Cell on a phone (390 × 844, touch): the Field kit layout."""
    st = dict(storage or {})
    if mode != "prep": st["dg_acell_mode"] = json.dumps(mode)
    page, errs = open_acell_shell(p, docs=docs, width=390, height=844, touch=True, storage=st)
    wait_for_condition(lambda: page.evaluate("() => !!(window.dgAcm && window.dgAcm.on())"), timeout_ms=4000)
    if wait_for_condition(lambda: page.evaluate("() => (window.__dgFirestoreListeners || []).some(l => l.path === 'sessions')"), timeout_ms=3000):
        push_collection(page, "sessions")
    if wait_for_condition(lambda: page.evaluate("() => (window.__dgFirestoreListeners || []).some(l => l.path === 'tapes')"), timeout_ms=3000):
        push_collection(page, "tapes")
    page.wait_for_timeout(250)
    return page, errs

def acm(page, js):
    page.evaluate("() => { " + js + " }")
    page.wait_for_timeout(250)

def test_acell_mobile_shell(p):
    """v3.13.0, A-Cell on a phone: the app bar, the tab bar (Session ·
    Agents · + · Evidence · More), the round add button with its post-its,
    the More and Sessions sheets, the Session dashboard and its Customise,
    a new operation (with its vault folder) and no emoji anywhere."""
    page, errs = open_phone(p)
    record("acell-mobile", "a phone gets the phone frame: app bar, tab bar, the add button; the folder is hidden",
           page.is_visible("#acm-bar") and page.is_visible("#acm-tabs") and page.is_visible("#acm-fab") and not page.is_visible(".folder-wrap") and not page.is_visible("#ac-top"), "")
    tabs = page.eval_on_selector_all("#acm-tabs .acm-tab", "els => els.map(e => e.textContent.trim())")
    record("acell-mobile", "Prep's tabs: Session · Agents · Evidence · More (the add button between)", tabs == ["Session", "Agents", "Evidence", "More"], str(tabs))
    record("acell-mobile", "the add button is round, the switches are round",
           page.evaluate("() => getComputedStyle(document.getElementById('acm-fab')).borderRadius") == "50%", "")
    record("acell-mobile", "the bar names the session", "Session 4" in page.inner_text("#acm-bar"), page.inner_text("#acm-bar"))
    wait_for_condition(lambda: page.locator(".acm-blk").count() >= 3, timeout_ms=4000)
    blk = page.eval_on_selector_all(".acm-blk", "els => els.map(e => e.getAttribute('data-blk'))")
    record("acell-mobile", "the Session dashboard: Waiting on you, the Cell, this session, shortcuts", blk == ["waiting", "cell", "session", "shortcuts"], str(blk))
    record("acell-mobile", "…the Cell by DEX, with rectangular photos", page.locator(".acm-blk[data-blk=cell] .acm-face .acm-ph").count() == 4
           and page.eval_on_selector_all(".acm-blk[data-blk=cell] .acm-face span:last-child", "els => els.map(e => e.textContent)") == ["Kessler", "Reyes", "Varga", "Price"], "")
    record("acell-mobile", "…the session's checklist from its note, as plain words", "Meet Ruth Ainsley" in page.inner_text(".acm-blk[data-blk=session]") and "[[" not in page.inner_text(".acm-blk[data-blk=session]"), page.inner_text(".acm-blk[data-blk=session]")[:200])
    page.click("[data-acm='go:customise']")
    page.click(".acm-wid[data-k=tape] .acm-sw")
    page.click(".acm-chip[data-k=vault]")
    stored = json.loads(page.evaluate("() => localStorage.getItem('dg_acm_dash')") or "{}")
    record("acell-mobile", "Customise: a block on, a shortcut picked (kept on the device)", stored.get("on", {}).get("tape") is True and "vault" in stored.get("shortcuts", []) and len(stored.get("shortcuts", [])) == 4, str(stored))
    page.click("[data-acm=back]")
    wait_for_condition(lambda: page.locator(".acm-blk[data-blk=tape]").count() == 1, timeout_ms=3000)
    record("acell-mobile", "…and the dashboard shows it", page.locator(".acm-blk[data-blk=tape]").count() == 1 and "VAULT" in page.inner_text(".acm-blk[data-blk=shortcuts]").upper(), "")
    page.click("#acm-fab")
    names = page.eval_on_selector_all(".acm-pi b", "els => els.map(e => e.textContent)")
    record("acell-mobile", "the add button: post-its with the Handler's names",
           names == ["Add Evidence", "Add Cell", "Add Operation", "Agent Notes", "Session Notes", "NPCs", "Tape", "New Session"] and "Soundtrack (for session)" in page.inner_text(".acm-pi.c-wh"), str(names))
    page.click(".acm-pi[data-add=op]")
    page.fill(".acm-form input[name=name]", "Hollow Hill")
    page.click(".acm-form button.acm-btn.k")
    wait_for_condition(lambda: any((w.get("data") or {}).get("vault_folder") == "Hollow Hill" for w in fs_writes(page, "operations/")), timeout_ms=5000)
    ops = [w for w in fs_writes(page, "operations/") if (w.get("data") or {}).get("name") == "Hollow Hill"]
    vault = [((w.get("data") or {}).get("path")) for w in fs_writes(page, "vault/")]
    record("acell-mobile", "Add Operation makes the operation (in the Cell)…", bool(ops) and ops[0]["data"].get("cell_id") == "cell_osiris", str(ops[:1])[:200])
    record("acell-mobile", "…and its vault folder: an overview, Sessions, NPCs, Locations",
           all(x in vault for x in ["Hollow Hill/Hollow Hill.md", "Hollow Hill/Sessions/Sessions.md", "Hollow Hill/NPCs/NPCs.md", "Hollow Hill/Locations/Locations.md"]), str(vault))
    page.click("#acm-tabs [data-acm-go='@more']")
    more = page.inner_text(".acm-more")
    record("acell-mobile", "More: the modes and every other section", all(x.upper() in more.upper() for x in ["Prep", "Play", "Debrief", "Music", "Notes", "Sheet", "Cells", "ID creator", "Computer layout"]), more[:300])
    page.evaluate("() => dgAcm.closeSheets()")
    page.click("[data-acm=sessions]")
    record("acell-mobile", "the Sessions sheet, by operation, with New session and New operation",
           "PALE LANTERN · OPERATION" in page.inner_text(".acm-sheet").upper() and page.locator(".acm-sheet [data-acm=new-op]").count() == 1, page.inner_text(".acm-sheet")[:200])
    page.evaluate("() => dgAcm.closeSheets()")
    bad = page.evaluate("(re) => { var t = document.getElementById('acm').innerText; var m = t.match(new RegExp(re, 'g')); return m || []; }", EMOJI_RE)
    record("acell-mobile", "no emoji or symbol icons in the phone frame (the icons are drawn)", not bad, str(bad))
    record("acell-mobile", "nothing scrolls sideways", page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "")
    record("acell-mobile", "no JS errors", not errs, str(errs))
    page.close()

def test_acell_mobile_backfill(p):
    """v3.13.0: an operation from before this version gets its vault folder
    once (old ones too); one that has it is left alone."""
    docs = acell_cell_fixture()
    docs["operations/op_hh"] = {"operation_id": "op_hh", "name": "Quiet Ward", "cell_id": "cell_osiris", "created_at": 2}
    page, errs = open_phone(p, docs=docs)
    wait_for_condition(lambda: (fs_doc(page, "operations/op_hh") or {}).get("vault_folder") == "Quiet Ward", timeout_ms=6000)
    vault = [((w.get("data") or {}).get("path")) for w in fs_writes(page, "vault/")]
    record("acell-mobile", "an old operation gets its vault folder, once", (fs_doc(page, "operations/op_hh") or {}).get("vault_folder") == "Quiet Ward" and "Quiet Ward/Quiet Ward.md" in vault, str(vault))
    record("acell-mobile", "an operation that has one is left alone (moved files stay moved)", not any(str(v).startswith("Pale Lantern/Pale Lantern") for v in vault), str(vault))
    record("acell-mobile", "no JS errors (backfill)", not errs, str(errs))
    page.close()

def test_acell_mobile_sessions(p):
    """v3.13.0: New session from a template / a copy, Save as template, the
    session desk's scenes (## headings in the note), Add a scene, the
    scene editor's bar (Evidence · NPC · [[ ]] · New scene · Done), and a
    new NPC kept as a note in the operation's NPCs folder."""
    page, errs = open_phone(p)
    acm(page, "dgAcm.go('new-session')")
    page.fill(".acm-form input[name=name]", "Session 5 — The lamp room")
    record("acell-mobile", "New session: from a template by default, its scenes shown, the note's place said",
           "Briefing" in page.inner_text("[data-tplscenes]") and "Pale Lantern/Sessions/Session 5" in page.inner_text("[data-where]"), page.inner_text(".acm-form")[:300])
    page.click(".acm-form button.acm-btn.k")
    wait_for_condition(lambda: any((w.get("data") or {}).get("name") == "Session 5 — The lamp room" for w in fs_writes(page, "sessions/")), timeout_ms=5000)
    new = [w for w in fs_writes(page, "sessions/") if (w.get("data") or {}).get("name") == "Session 5 — The lamp room"]
    note = [w for w in fs_writes(page, "vault/") if (w.get("data") or {}).get("path") == "Pale Lantern/Sessions/Session 5 — The lamp room.md"]
    record("acell-mobile", "…makes the session and its note from the template",
           bool(new) and new[0]["data"].get("note_path") == "Pale Lantern/Sessions/Session 5 — The lamp room.md" and bool(note) and "## Briefing" in note[0]["data"].get("content", ""), str(note[:1])[:200])
    record("acell-mobile", "…and opens its session desk", page.evaluate("() => dgAcm.current()") == "desk", page.evaluate("() => dgAcm.current()"))
    page.evaluate("() => dgSessions.setCurrent('sess_4')")
    # 2026-10-30: the desk's Notes (not Scenes): vault notes, Google Docs
    # and uploaded HTML pages the session keeps for Play; Remove takes one off.
    acm(page, "dgAcm.go('desk', {seg: 'notes'})")
    nt = page.eval_on_selector_all(".acm-snote b", "els => els.map(e => e.textContent)")
    record("acell-mobile", "the desk's Notes: the session note first (an older session's note_path)", nt == ["Session 4"] and "NOTES 1" in page.inner_text(".acm-seg").upper(), str(nt))
    page.click("[data-acm=note-add]")
    page.click(".acm-sheet [data-nt] [data-k=gdoc]")
    page.fill(".acm-sheet [data-gdoc] input[name=url]", "https://docs.google.com/document/d/abcDEF_123/edit")
    page.fill(".acm-sheet [data-gdoc] input[name=title]", "Harbour timeline")
    page.click(".acm-sheet [data-gdoc] button")
    wait_for_condition(lambda: len((_sess(page) or {}).get("notes") or []) == 2, timeout_ms=4000)
    s4 = _sess(page) or {}
    record("acell-mobile", "Add a note → Google Doc: added after the session note, which stays note_path",
           (s4.get("notes") or [{}])[-1:] == [{"kind": "gdoc", "url": "https://docs.google.com/document/d/abcDEF_123/edit", "title": "Harbour timeline"}] and s4.get("note_path") == "Pale Lantern/Session 4.md", str(s4.get("notes")))
    page.click("[data-acm=note-add]")
    wait_for_condition(lambda: page.locator(".acm-sheet [data-res] [data-n]").count() > 0, timeout_ms=4000)
    page.fill(".acm-sheet [data-q]", "")
    page.wait_for_timeout(200)
    page.click(".acm-sheet [data-res] [data-n]:not([disabled])")
    wait_for_condition(lambda: len((_sess(page) or {}).get("notes") or []) == 3, timeout_ms=4000)
    record("acell-mobile", "Add a note → Vault: search, tap, added (and marked Added)", (_sess(page).get("notes") or [{}])[-1].get("kind") == "vault" and page.locator(".acm-sheet [data-res] [disabled]").count() >= 1, str(_sess(page).get("notes")))
    page.evaluate("() => dgAcm.closeSheets()")
    page.wait_for_timeout(200)
    page.click("[data-acm=note-up][data-i='1']")
    wait_for_condition(lambda: ((_sess(page) or {}).get("notes") or [{}])[0].get("kind") == "gdoc", timeout_ms=4000)
    s4 = _sess(page) or {}
    record("acell-mobile", "↑ moves a note earlier; the first is what Play opens (note_path follows)", (s4.get("notes") or [{}])[0].get("kind") == "gdoc" and s4.get("note_path") == "", str(s4.get("notes"))[:200])
    acm(page, "dgAcm.go('notebook')")
    tabs = page.eval_on_selector_all(".acm-notetabs .acm-chip", "els => els.map(e => e.textContent)")
    src = page.get_attribute(".acm-gdoc iframe", "src") if page.locator(".acm-gdoc iframe").count() else ""
    record("acell-mobile", "Play's notes: a tab per note; a Google Doc embeds read-only, with Open in Google Docs",
           len(tabs) == 3 and tabs[0] == "Harbour timeline" and src == "https://docs.google.com/document/d/abcDEF_123/preview" and page.locator(".acm-gdoc a[href*='docs.google.com']").count() == 1, f"{tabs} {src}")
    page.click(".acm-notetabs [data-i='1']")
    page.wait_for_timeout(300)
    record("acell-mobile", "…a vault note opens with its scenes", page.locator(".acm-notetabs + .acm-scenetabs .acm-chip").count() >= 2 and page.locator(".acm-ed").count() == 1, "")
    acm(page, "dgAcm.go('desk', {seg: 'notes'})")
    page.click("[data-acm=note-rm][data-i='2']")
    wait_for_condition(lambda: len((_sess(page) or {}).get("notes") or []) == 2, timeout_ms=4000)
    record("acell-mobile", "× takes a note off the session; the vault note itself stays", len(_sess(page).get("notes") or []) == 2 and page.evaluate("() => !!dgVault.get('Pale Lantern/Session 4.md')"), str(_sess(page).get("notes")))
    page.evaluate("() => dgSessions.setNotes('sess_4', [{kind: 'vault', path: 'Pale Lantern/Session 4.md'}])")
    page.wait_for_timeout(200)
    acm(page, "dgAcm.go('desk', {seg: 'npcs'})")
    page.click("[data-acm=new-npc]")
    page.fill(".acm-form input[name=name]", "Sheriff Dunn")
    page.click(".acm-step [data-st=dex][data-d='1']")
    page.click(".acm-form button[data-go=save]")
    wait_for_condition(lambda: any((w.get("data") or {}).get("path") == "Pale Lantern/NPCs/Sheriff Dunn.md" for w in fs_writes(page, "vault/")), timeout_ms=5000)
    n = [w for w in fs_writes(page, "vault/") if (w.get("data") or {}).get("path") == "Pale Lantern/NPCs/Sheriff Dunn.md"]
    record("acell-mobile", "a new NPC is a note in the operation's NPCs folder, numbers at the top", bool(n) and "type: npc" in n[0]["data"]["content"] and "dex: 11" in n[0]["data"]["content"], str(n[:1])[:200])
    wait_for_condition(lambda: any(x.get("name") == "Sheriff Dunn" for x in (_sess(page) or {}).get("npcs", [])), timeout_ms=4000)
    s4 = _sess(page) or {}
    record("acell-mobile", "…and in the session, linked to its note", any(x.get("name") == "Sheriff Dunn" and x.get("path") == "Pale Lantern/NPCs/Sheriff Dunn.md" for x in s4.get("npcs", [])), str(s4.get("npcs")))
    acm(page, "dgAcm.go('desk', {seg: 'notes'})")
    page.click("#acm-bar [data-acm=session-actions]")
    page.click("[data-sa=tpl]")
    page.fill(".acm-form input[name=v]", "Lighthouse night")
    page.click(".acm-form button.acm-btn.k")
    wait_for_condition(lambda: any((w.get("data") or {}).get("path") == "Templates/Session — Lighthouse night.md" for w in fs_writes(page, "vault/")), timeout_ms=4000)
    t = [w for w in fs_writes(page, "vault/") if (w.get("data") or {}).get("path") == "Templates/Session — Lighthouse night.md"]
    record("acell-mobile", "Save as template: its headings and an unticked checklist, as a vault note",
           bool(t) and "## Scene 3 · The harbour" in t[0]["data"]["content"] and "- [ ] Meet [[Ruth Ainsley]]" in t[0]["data"]["content"] and "Opening: the causeway" not in t[0]["data"]["content"], str(t[:1])[:300])
    page.click("#acm-bar [data-acm=session-actions]")
    page.click("[data-sa=dup]")
    record("acell-mobile", "Duplicate: New session as a copy, named after it", "on" in (page.get_attribute("button[data-how=copy]", "class") or "") and page.input_value(".acm-form input[name=name]").endswith("(copy)"), "")
    page.click(".acm-form button.acm-btn.k")
    wait_for_condition(lambda: any(str((w.get("data") or {}).get("name", "")).endswith("(copy)") for w in fs_writes(page, "sessions/")), timeout_ms=5000)
    cp = [w for w in fs_writes(page, "sessions/") if str((w.get("data") or {}).get("name", "")).endswith("(copy)")]
    record("acell-mobile", "…with its evidence and NPCs, not what happened in play", bool(cp) and cp[0]["data"].get("evidence") == ["ev_log"] and any(x.get("name") == "Keeper" for x in cp[0]["data"].get("npcs", [])) and "start" not in cp[0]["data"], str(cp[:1])[:300])
    record("acell-mobile", "no JS errors (sessions)", not errs, str(errs))
    page.close()

def test_acell_mobile_play(p):
    """v3.13.0: Play on a phone: Pads (every effect, Stop all sound), the
    initiative as post-its (hide, out to Upcoming, back in, Next skips the
    hidden), an Agent read only, the notebook, Dice, the tape deck, and the
    add button's quick note and quick evidence."""
    page, errs = open_phone(p, mode="play")
    if wait_for_condition(lambda: page.evaluate("() => (window.__dgFirestoreListeners || []).some(l => l.path === 'tracks')"), timeout_ms=3000):
        push_collection(page, "tracks")
    tabs = page.eval_on_selector_all("#acm-tabs .acm-tab", "els => els.map(e => e.textContent.trim())")
    record("acell-mobile-play", "Play's tabs: Pads · Initiative · Notes · Dice", tabs == ["Pads", "Initiative", "Notes", "Dice"], str(tabs))
    wait_for_condition(lambda: bool((_sess(page) or {}).get("start")), timeout_ms=4000)
    record("acell-mobile-play", "entering Play notes the Agents' vitals for the debrief", bool((_sess(page) or {}).get("start")), "")
    record("acell-mobile-play", "Pads: the session's, then every effect (not just nine)", page.locator(".acm-pad").count() > 9, str(page.locator(".acm-pad").count()))
    page.click(".acm-pad[data-id=scream-01]")
    wait_for_condition(lambda: any(any(x.get("id") == "scream-01" for x in (w.get("data") or {}).get("stingers") or []) for w in fs_writes(page, "radio/")), timeout_ms=4000)
    record("acell-mobile-play", "a pad fires on the broadcast", any(any(x.get("id") == "scream-01" for x in (w.get("data") or {}).get("stingers") or []) for w in fs_writes(page, "radio/")), "")
    record("acell-mobile-play", "the back arrow returns to Prep (no house)", page.locator("#acm-bar [data-acm=to-prep]").count() == 1, "")
    page.click("#acm-tabs [data-acm-go=initiative]")
    names = page.eval_on_selector_all(".acm-ip .acm-g > b", "els => els.map(e => e.textContent.replace(/ hidden$/, ''))")
    record("acell-mobile-play", "initiative: post-its by DEX, NPCs among the Agents", names == ["Mara Kessler", "Keeper", "Tomas Reyes", "Ilse Varga", "Wendell Price"], str(names))
    record("acell-mobile-play", "yellow for Agents, purple for NPCs", page.locator(".acm-ip.c-y").count() == 4 and page.locator(".acm-ip.c-pu").count() == 1, "")
    page.click(".acm-ip.c-pu [data-acm=npc-hide]")
    wait_for_condition(lambda: ((_sess(page) or {}).get("npcs") or [{}])[0].get("hidden") is True, timeout_ms=3000)
    page.wait_for_timeout(250)
    record("acell-mobile-play", "an NPC can be hidden (stays, faded)", ((_sess(page) or {}).get("npcs") or [{}])[0].get("hidden") is True and page.locator(".acm-ip.hid").count() == 1, "")
    page.click("[data-acm=next-turn]")
    page.wait_for_timeout(250)
    now = page.inner_text(".acm-ip.now .acm-g > b")
    record("acell-mobile-play", "Next turn skips the hidden NPC", now == "Tomas Reyes", now)
    page.click(".acm-ip.c-pu [data-acm=npc-out]")
    wait_for_condition(lambda: page.locator("[data-acm=npc-in]").count() == 1, timeout_ms=3000)
    record("acell-mobile-play", "× takes an NPC out of the order, into Upcoming", page.locator(".acm-ip.c-pu").count() == 0 and "Keeper" in page.inner_text("[data-acm=npc-in]"), "")
    page.click("[data-acm=npc-in]")
    wait_for_condition(lambda: page.locator(".acm-ip.c-pu").count() == 1, timeout_ms=3000)
    page.click(".acm-ip.c-pu [data-acm=npc-hide]")
    page.wait_for_timeout(200)
    page.click(".acm-ip.c-pu .acm-v button[data-k=hp][data-d='1']")
    wait_for_condition(lambda: ((_sess(page) or {}).get("npcs") or [{}])[0].get("hp") == 1, timeout_ms=3000)
    record("acell-mobile-play", "back in from Upcoming; HP −/+ right on the post-it", ((_sess(page) or {}).get("npcs") or [{}])[0].get("hp") == 1, str((_sess(page) or {}).get("npcs")))
    page.click(".acm-ip.c-y[data-code=ILSE-VR03]")
    wait_for_condition(lambda: page.is_visible("#play-view") and "Ilse Varga" in page.inner_text("#play-view"), timeout_ms=5000)
    record("acell-mobile-play", "an Agent's post-it opens their sheet, read only (the Players tab's paper, no list)",
           page.is_visible("#play-view") and not page.is_visible("#play-agent-list") and "Ilse Varga" in page.inner_text("#acm-bar"), page.inner_text("#acm-bar"))
    page.click("#acm-bar [data-acm=back]")
    page.click("#acm-tabs [data-acm-go=notebook]")
    record("acell-mobile-play", "Notes: the session note by scene", "Scene 4 · The keeper's log" in page.inner_text(".acm-scenetabs"), "")
    page.click("#acm-tabs [data-acm-go=dice]")
    record("acell-mobile-play", "Dice: the Dice Roller's Live Rolls", "DICE ROLLER" in page.inner_text(".acm-drp") and page.locator(".acm-drsel").count() == 1, "")
    page.click("#acm-fab")
    play_add = page.eval_on_selector_all(".acm-pi b", "els => els.map(e => e.textContent)")
    record("acell-mobile-play", "the add button in Play: quick note, Add evidence, Release evidence, NPC, Agent, Tape, End the game", play_add == ["Quick note", "Add evidence", "Release evidence", "NPC", "Agent", "Tape", "End the game"], str(play_add))
    page.click(".acm-pi[data-add=qnote]")
    page.click(".acm-qform [data-who='TOMA-RY02']")
    page.fill(".acm-qform input[name=t]", "Lied about the boat")
    page.press(".acm-qform input[name=t]", "Enter")
    wait_for_condition(lambda: any(q.get("text") == "Lied about the boat" for q in (_sess(page) or {}).get("quick_notes", [])), timeout_ms=3000)
    q = [x for x in (_sess(page) or {}).get("quick_notes", []) if x.get("text") == "Lied about the boat"]
    record("acell-mobile-play", "a quick note, on an Agent", bool(q) and q[0].get("code") == "TOMA-RY02", str(q))
    page.click("#acm-fab")
    page.click(".acm-pi[data-add=qev]")
    acell_feed_evidence(page)
    wait_for_condition(lambda: page.locator("#evidence-create-form-slot select").count() > 0, timeout_ms=5000)
    cell_val = page.evaluate("() => { var s = document.querySelector('#evidence-create-form-slot select'); return s ? s.value : ''; }")
    record("acell-mobile-play", "Add evidence in Play: the full form, already on the session's Cell", cell_val == "cell_osiris", cell_val)
    acm(page, "dgAcm.go('pads')")
    page.click("#acm-bar [data-acm=deck]")
    page.click(".acm-decksheet [data-dk=insert]")
    wait_for_condition(lambda: any(((w.get("data") or {}).get("tape") or {}).get("id") == "tape_dread" for w in fs_writes(page, "radio/")), timeout_ms=4000)
    record("acell-mobile-play", "the tape deck puts a tape in", any(((w.get("data") or {}).get("tape") or {}).get("id") == "tape_dread" for w in fs_writes(page, "radio/")), "")
    wait_for_condition(lambda: page.locator(".acm-decksheet .acm-transport [data-dk=loop]").count() == 1 and page.locator(".acm-decksheet [data-dk=eject]").count() == 1, timeout_ms=3000)
    record("acell-mobile-play", "…with Loop in the transport and Take tape out", page.locator(".acm-decksheet .acm-transport [data-dk=loop]").count() == 1 and "TAKE TAPE OUT" in page.inner_text(".acm-decksheet").upper(), "")
    record("acell-mobile-play", "no JS errors (play)", not errs, str(errs))
    page.close()

def test_acell_mobile_agents(p):
    """v3.13.0: Agents on a phone: the desk's dossiers by DEX with File ·
    Sheet · Bonds · History; a note into their player file; Tell the
    player writes a note they see on their Agent File."""
    page, errs = open_phone(p)
    page.click("#acm-tabs [data-acm-go=agents]")
    names = page.eval_on_selector_all(".acm-dos .acm-doshd .acm-g b", "els => els.map(e => e.textContent)")
    record("acell-mobile-agents", "Agents: dossiers, highest DEX first", names == ["Mara Kessler", "Tomas Reyes", "Ilse Varga", "Wendell Price"], str(names))
    record("acell-mobile-agents", "…each with File · Sheet · Bonds · History, and no vitals", page.eval_on_selector_all(".acm-dos .acm-qn", "els => Array.prototype.map.call(els[0].querySelectorAll('button'), e => e.textContent)") == ["File", "Sheet", "Bonds", "History"]
           and "HP" not in page.inner_text(".acm-dos"), "")
    page.click(".acm-dos [data-code=TOMA-RY02][data-tab=bonds]")
    record("acell-mobile-agents", "Bonds", "Sam (partner)" in page.inner_text(".acm-fold"), "")
    page.click(".acm-qn [data-tab=file]")
    page.click("[data-acm=start-file]")
    wait_for_condition(lambda: page.locator("[data-form=anote]").count() == 1, timeout_ms=4000)
    page.fill("[data-form=anote] input", "Owes Ainsley a favour")
    page.press("[data-form=anote] input", "Enter")
    wait_for_condition(lambda: "Owes Ainsley a favour" in str(page.evaluate("() => (dgVault.get('Players/Tomas Reyes.md') || {}).content")), timeout_ms=4000)
    md = page.evaluate("() => (dgVault.get('Players/Tomas Reyes.md') || {}).content") or ""
    record("acell-mobile-agents", "a note goes under Handler notes in their player file", "## Handler notes" in md and "Owes Ainsley a favour" in md.split("## Sheet changes")[0], md[:300])
    page.click(".acm-qn [data-tab=history]")
    record("acell-mobile-agents", "History: sheet changes and sessions", "Sheet changes" in page.inner_text(".acm-fold").title() or "SHEET CHANGES" in page.inner_text(".acm-fold").upper(), "")
    page.evaluate("() => dgAcPlayers.tellPlayer('TOMA-RY02', 'HP 6 → 8: rested a week.')")
    wait_for_condition(lambda: bool((fs_doc(page, "characters/TOMA-RY02") or {}).get("handler_notes")), timeout_ms=3000)
    hn = (fs_doc(page, "characters/TOMA-RY02") or {}).get("handler_notes") or []
    record("acell-mobile-agents", "Tell the player: a note on their character, for their Agent File", bool(hn) and hn[-1].get("text") == "HP 6 → 8: rested a week.", str(hn))
    record("acell-mobile-agents", "no JS errors (agents)", not errs, str(errs))
    page.close()

def test_acell_mobile_notes(p):
    """v3.13.0: the vault on a phone, the way Notebook Navigator and
    Omnisearch have it: folders one level at a time, previews and dates,
    Recent, Pinned, Tags; ranked search that forgives a typo; tap a note's
    text to write there."""
    docs = acell_cell_fixture()
    def vdoc(path, content):
        import base64
        return "vault/" + base64.urlsafe_b64encode(path.encode()).decode().rstrip("="), {"path": path, "content": content, "updated_at": 5}
    for path, content in [("Pale Lantern/NPCs/The keeper.md", "---\ntype: npc\ndex: 14\nhp: 9\n---\n# The keeper\n\nOld Elias Marsh kept the light. #npc #lighthouse\n"),
                          ("Rules/Sanity tables.md", "# Sanity\n\nViolence, helplessness, the unnatural.\n")]:
        k, v = vdoc(path, content); docs[k] = v
    page, errs = open_phone(p, docs=docs)
    if wait_for_condition(lambda: page.evaluate("() => (window.__dgFirestoreListeners || []).some(l => l.path === 'vault')"), timeout_ms=3000):
        push_collection(page, "vault")
    acm(page, "dgAcm.go('vault')")
    tops = page.eval_on_selector_all(".acm-fold .acm-row[data-acm=vdir] .acm-g b", "els => els.map(e => e.textContent)")
    record("acell-mobile-notes", "the navigator: the vault's top folders", "Pale Lantern" in tops and "Rules" in tops, str(tops))
    page.click(".acm-row[data-d='Pale Lantern']")
    page.wait_for_timeout(300)
    record("acell-mobile-notes", "a folder: its subfolders, then its notes with a preview", "NPCs" in page.inner_text(".acm-fold") and "Opening: the causeway at low tide." in page.inner_text(".acm-fold"), page.inner_text(".acm-fold")[:300])
    page.click("[data-acm=vseg][data-s=tags]")
    page.wait_for_timeout(300)
    record("acell-mobile-notes", "Tags", "#npc" in page.inner_text(".acm-fold") and "#lighthouse" in page.inner_text(".acm-fold"), "")
    page.click(".acm-searchbox")
    page.fill(".acm-vq", "keepr")
    page.wait_for_timeout(400)
    res = page.eval_on_selector_all(".acm-vres .acm-nrow .acm-g > b", "els => els.map(e => e.textContent)")
    record("acell-mobile-notes", "search forgives a typo and ranks the title first", bool(res) and res[0] == "The keeper", str(res))
    page.fill(".acm-vq", "causeway")
    page.wait_for_timeout(400)
    record("acell-mobile-notes", "…and shows the matching line, marked", page.locator(".acm-vres mark").count() >= 1 and "causeway" in page.inner_text(".acm-vres").lower(), page.inner_text(".acm-vres")[:200])
    page.click(".acm-vres .acm-nrow")
    record("acell-mobile-notes", "a note opens to read", page.locator(".acm-vnote .vn-body").count() == 1 and page.locator(".acm-vnote .vn-ta").count() == 0, "")
    page.click(".acm-vnote .vn-body")
    wait_for_condition(lambda: page.locator(".acm-vnote .vn-ta").count() == 1, timeout_ms=3000)
    record("acell-mobile-notes", "a tap on the text: writing, right there, with a bar over the keyboard",
           page.locator(".acm-vnote .vn-ta").count() == 1 and page.eval_on_selector_all(".acm-ktool button", "els => els.map(e => e.textContent)") == ["B", "I", "H", "List", "[[ ]]", "#tag", "Done"], "")
    page.click(".acm-ktool [data-kt=done]")
    record("acell-mobile-notes", "Done: back to reading", page.locator(".acm-vnote .vn-ta").count() == 0, "")
    page.click("#acm-bar [data-acm=vmenu]")
    page.click("[data-vm=pin]")
    record("acell-mobile-notes", "Pin (kept on the device)", "Pale Lantern/Session 4.md" in (page.evaluate("() => localStorage.getItem('dg_acm_pins')") or ""), "")
    acm(page, "dgAcm.go('vnote', 'Pale Lantern/NPCs/The keeper.md')")
    record("acell-mobile-notes", "Make NPC shows on an NPC's note…", page.locator("[data-acm=vmake-npc]").count() == 1, "")
    acm(page, "dgAcm.go('vnote', 'Rules/Sanity tables.md')")
    record("acell-mobile-notes", "…and not on other notes", page.locator("[data-acm=vmake-npc]").count() == 0, "")
    record("acell-mobile-notes", "no JS errors (notes)", not errs, str(errs))
    page.close()

def test_acell_mobile_panels(p):
    """v3.13.0: the computer's panels in the phone frame, made for it:
    Evidence (New evidence + one Filter sheet; Only for by name), the
    Sheet (cards, Filter, Columns you order, Select → Move to Cell /
    Delete), Cells (up to three channels each), Music (Play tape; Add at
    each part), the ID creator (fits)."""
    page, errs = open_phone(p)
    page.click("#acm-tabs [data-acm-go=evidence]")
    acell_feed_evidence(page)
    record("acell-mobile-panels", "Evidence: New evidence and Filter instead of the toolbar, chips and sidebar",
           page.is_visible("#acm-evbar") and not page.is_visible("#panel-evidence .evidence-toolbar") and not page.is_visible("#ac-ev-chips") and not page.is_visible(".evidence-sidebar"), "")
    page.click("#acm-evbar [data-ev=filter]")
    page.click(".acm-sheet [data-f=released]")
    wait_for_condition(lambda: "on" in (page.get_attribute("#ac-ev-chips [data-f=released]", "class") or ""), timeout_ms=3000)
    record("acell-mobile-panels", "Filter: the status chips work the list", "on" in (page.get_attribute("#ac-ev-chips [data-f=released]", "class") or "") and "Released" in page.inner_text("#acm-evbar"), page.inner_text("#acm-evbar"))
    page.evaluate("() => dgAcm.closeSheets()")
    page.click("#acm-evbar [data-ev=new]")
    wait_for_condition(lambda: page.locator("#evidence-new-restrict-wrap summary").count() == 1, timeout_ms=4000)
    record("acell-mobile-panels", "New evidence: Only for is a drop-down of the Cell's members by name",
           "everyone in the Cell" in page.inner_text("#evidence-new-restrict-wrap summary"), page.inner_text("#evidence-new-restrict-wrap")[:200])
    page.click("#evidence-new-restrict-wrap summary")
    page.check('#evidence-new-restrict-wrap input[value="MARA-KS01"]')
    record("acell-mobile-panels", "…and names who it's for", "Mara Kessler" in page.inner_text("#evidence-new-restrict-wrap summary"), page.inner_text("#evidence-new-restrict-wrap summary"))
    acm(page, "dgAcm.go('sheet')")
    if wait_for_condition(lambda: page.locator(".sheet-card, .sheet-table").count() > 0, timeout_ms=6000):
        pass
    record("acell-mobile-panels", "Sheet on a phone: cards", page.locator(".sheet-card").count() >= 4, str(page.locator(".sheet-card").count()))
    page.click(".sheet-viewbar [data-sv=table]")
    page.click(".sheet-viewbar [data-sa=cols]")
    page.uncheck(".sheet-viewbar [data-sc=code]")
    ink = page.evaluate("() => getComputedStyle(document.querySelector('.sv-col label')).color")
    record("acell-mobile-panels", "Columns: the column names are ink on the paper, not the folder's light text", ink in ("rgb(28, 22, 8)",), ink)
    heads = page.eval_on_selector_all(".sheet-table th", "els => els.map(e => e.textContent)")
    record("acell-mobile-panels", "Columns: untick one and the table drops it", "Agent Code" not in heads and "Agent Name" in heads, str(heads))
    order = page.evaluate("() => JSON.parse(localStorage.getItem('dg_acell_sheet_view') || '{}')")
    record("acell-mobile-panels", "…kept on the device, in an order you can drag", order.get("hide", {}).get("code") is True and len(order.get("order", [])) == 8 and page.locator(".sv-col .sv-handle").count() == 8, str(order))
    page.click(".sheet-viewbar [data-sa=cols]")
    page.click(".sheet-viewbar [data-sa=filter]")
    page.fill(".sheet-viewbar [data-sq]", "tomas")
    page.wait_for_timeout(250)
    record("acell-mobile-panels", "Filter by name", page.locator(".sheet-table tbody tr").count() == 1, str(page.locator(".sheet-table tbody tr").count()))
    page.check(".sheet-table .sheet-select-cb")
    record("acell-mobile-panels", "Select: a batch bar with Move to Cell and Delete", page.is_visible(".sv-batch") and "1 selected" in page.inner_text(".sv-batch") and "DELETE 1" in page.inner_text(".sv-batch").upper(), "")
    page.click(".sv-batch [data-sa=delete]")
    record("acell-mobile-panels", "Delete asks for the password and keeps them 24 hours", page.is_visible("#sheet-bulk-pw-input") and "24 hours" in page.inner_text("#sheet-bulk-confirm-slot"), "")
    acm(page, "dgAcm.go('cells')")
    wait_for_condition(lambda: page.locator(".cell-ch").count() >= 5, timeout_ms=5000)
    record("acell-mobile-panels", "Cells: the Cell's channels", "on" in (page.get_attribute(".cell-ch[data-ch='3']", "class") or ""), "")
    page.click(".cell-ch[data-ch='1']")
    wait_for_condition(lambda: (fs_doc(page, "cells/cell_osiris") or {}).get("channels") == ["3", "1"], timeout_ms=3000)
    record("acell-mobile-panels", "…a second channel for the same Cell", (fs_doc(page, "cells/cell_osiris") or {}).get("channels") == ["3", "1"] and (fs_doc(page, "cells/cell_osiris") or {}).get("channel") == "3", str(fs_doc(page, "cells/cell_osiris")))
    acm(page, "dgAcm.go('music')")
    if wait_for_condition(lambda: page.locator("#ac-tapes .ac-tcard").count() > 0, timeout_ms=5000):
        record("acell-mobile-panels", "Music: a tape has Play tape (no Open, no Into CH)", "PLAY TAPE" in page.inner_text("#ac-tapes .ac-tcard").upper() and page.locator("#ac-tapes .ac-tcard [data-mu=open]").count() == 0, page.inner_text("#ac-tapes .ac-tcard")[:120])
        record("acell-mobile-panels", "…drawn to the real cassette's shape", abs(page.evaluate("() => { var r = document.querySelector('#ac-tapes .ac-tcard .cas-svg').getBoundingClientRect(); return r.width / r.height; }") - 1005 / 638) < 0.02, "")
        record("acell-mobile-panels", "…the open tape has an Add at Tracks, Loops and Pads", page.locator("#ac-tapes .ac-topen [data-mu=add-part]").count() == 3, "")
        # Reported 2026-10-30: tapping a tape opened it out of sight, below the racks.
        page.evaluate("() => { window.scrollTo(0, 0); document.querySelectorAll('.folder-wrap, #acm-main').forEach(function (e) { e.scrollTop = 0; }); }")
        page.click("#ac-tapes .ac-tcard .cas")
        page.wait_for_timeout(900)
        top = page.evaluate("() => document.querySelector('#ac-tapes .ac-topen').getBoundingClientRect().top")
        record("acell-mobile-panels", "tapping a tape takes the phone to the open tape, below the top bar", page.evaluate("() => document.getElementById('acm-bar') ? document.getElementById('acm-bar').getBoundingClientRect().bottom : 50") <= top < 400, str(top))
        record("acell-mobile-panels", "the open tape has Save and Save & play", page.locator("#ac-tapes .ac-topen [data-mu=save-tape]").count() == 1 and page.locator("#ac-tapes .ac-topen [data-mu=save-play]").count() == 1, "")
        n0 = len(fs_writes(page, "tapes/tape_dread"))
        page.click("#ac-tapes .ac-topen [data-mu=save-tape]")
        wait_for_condition(lambda: len(fs_writes(page, "tapes/tape_dread")) > n0, timeout_ms=3000)
        record("acell-mobile-panels", "Save writes the tape and says so", len(fs_writes(page, "tapes/tape_dread")) > n0 and "saved" in page.inner_text("body").lower(), "")
        page.click("#ac-tapes .ac-topen [data-mu=save-play]")
        wait_for_condition(lambda: any(((w.get("data") or {}).get("tape") or {}).get("id") == "tape_dread" for w in fs_writes(page, "radio/")), timeout_ms=4000)
        record("acell-mobile-panels", "Save & play puts the tape in the deck", any(((w.get("data") or {}).get("tape") or {}).get("id") == "tape_dread" for w in fs_writes(page, "radio/")), "")
    acm(page, "dgAcm.go('ids')")
    page.wait_for_timeout(800)
    record("acell-mobile-panels", "the ID creator fits the phone, its three kinds one switch", page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1") and page.locator("#idc-root .idc-kinds .paper-btn").count() == 3, "")
    record("acell-mobile-panels", "no JS errors (panels)", not errs, str(errs))
    page.close()

def test_acell_tape_steps_once(p):
    """Reported 2026-10-30: a tape of two tracks flipped between them. A
    track only steps the tape on when it is the live one and really ran,
    and the step is from that exact broadcast, so a stale 'ended' (a
    second device, a seek parked at the end) changes nothing."""
    import time as _t
    page, errs = open_acell_shell(p)
    page.click("#acell-tab-strip .tw[data-tab=music]")
    push_collection(page, "tracks")
    page.evaluate("() => window.dgTapes.insert('tape_dread')")
    wait_for_condition(lambda: any(l.get("isDoc") and l["path"].startswith("radio/") for l in page.evaluate("() => window.__dgFirestoreListeners || []")) or None, timeout_ms=5000)
    ch = page.evaluate("() => window.dgAcellMusic.channel()")
    path = "radio/" + ch
    url1 = page.evaluate("() => window.dgAcellMusic.cueList()[0].url")
    url2 = page.evaluate("() => window.dgAcellMusic.cueList()[1].url")
    def deliver(d):
        page.evaluate("(a) => { window.__dgFirestoreDocs[a[0]] = Object.assign({}, window.__dgFirestoreDocs[a[0]] || {}, a[1]); }", [path, d])
        push_firestore_doc_snapshot(page, path, True, fs_doc(page, path))
        page.wait_for_timeout(150)
    def track(): return (fs_doc(page, path) or {}).get("track_url")
    now = int(_t.time() * 1000)
    # Track 1 just started: an 'ended' a second in is not the track finishing.
    deliver({"track_url": url1, "track_title": "Lighthouse at Dusk", "track_kind": "audio", "started_at": now - 1000, "paused": False, "paused_at": "", "loop": False})
    page.evaluate("() => document.getElementById('music-preview-audio').dispatchEvent(new Event('ended'))")
    page.wait_for_timeout(400)
    record("acell-tapes", "an 'ended' seconds after the track started doesn't step the tape", track() == url1, str(track())[:60])
    # Track 1 ran its length: one step to track 2.
    deliver({"started_at": now - 400000})
    page.evaluate("() => document.getElementById('music-preview-audio').dispatchEvent(new Event('ended'))")
    wait_for_condition(lambda: track() == url2, timeout_ms=3000)
    record("acell-tapes", "a finished track steps the tape to the next", track() == url2, str(track())[:60])
    # A late 'ended' for the same broadcast from before the step (another
    # device, seen through this tab's stale state) must not step it again.
    d2 = fs_doc(page, path)
    page.evaluate("(a) => { window.__dgFirestoreDocs[a[0]] = Object.assign({}, window.__dgFirestoreDocs[a[0]], { track_url: a[1], started_at: 1 }); }", [path, url2])
    page.evaluate("() => document.getElementById('music-preview-audio').dispatchEvent(new Event('ended'))")
    page.wait_for_timeout(500)
    record("acell-tapes", "a stale 'ended' doesn't step the tape back", track() == url2, str(track())[:60])
    record("acell-tapes", "no JS errors (tape steps)", not errs, str(errs))
    page.close()

def test_acell_session_notes_desk(p):
    """2026-10-30, the computer layout: Prep's Notes panel lists every note
    the session keeps (vault, Google Doc, uploaded page), adds a Google Doc
    by its link, takes one off; the Play desk's notebook has a tab per note
    and embeds a Doc read-only."""
    page, errs = open_acell_shell(p)
    wait_for_condition(lambda: page.locator("[data-pb=notes] .ac-nrow").count() == 1, timeout_ms=5000)
    record("acell-notes", "Prep: the session note is note 1, open below to write", page.locator("[data-pb=notes] .ac-nrow.on").count() == 1 and page.locator("[data-pb=notes] .ac-note").count() == 1, page.inner_text("[data-pb=notes] .ac-nlist"))
    page.click("[data-pb=notes] [data-ac=gdoc]")
    page.fill("[data-pb=notes] [data-gurl]", "https://docs.google.com/spreadsheets/d/XYZ789/edit#gid=0")
    page.fill("[data-pb=notes] [data-gtitle]", "Tide table")
    page.click("[data-pb=notes] [data-ac-gdoc] button.p")
    wait_for_condition(lambda: len(_sess(page).get("notes") or []) == 2, timeout_ms=4000)
    wait_for_condition(lambda: page.locator("[data-pb=notes] .ac-nrow").count() == 2, timeout_ms=3000)
    record("acell-notes", "+ Google Doc adds it by its link, after the session note", (_sess(page).get("notes") or [{}])[-1].get("title") == "Tide table" and "Tide table" in page.inner_text("[data-pb=notes] .ac-nlist"), str(_sess(page).get("notes")))
    page.click("#ac-modes [data-mode=play]")
    wait_for_condition(lambda: page.locator(".pd-ntab").count() == 2, timeout_ms=5000)
    page.click(".pd-ntab[data-i='1']")
    page.wait_for_timeout(300)
    src = page.get_attribute(".pd-gdoc iframe", "src") if page.locator(".pd-gdoc iframe").count() else ""
    record("acell-notes", "Play desk: a tab per note; the Doc embeds read-only, Open in Google Docs beside it", src == "https://docs.google.com/spreadsheets/d/XYZ789/preview" and page.locator(".pd-gdoc a[href*='docs.google.com']").count() == 1, src)
    page.click(".pd-ntab[data-i='0']")
    page.wait_for_timeout(300)
    record("acell-notes", "…and back to the vault note, its scenes as tabs", page.locator(".pd-nbody .pd-tab").count() >= 2 and page.locator(".pd-nbody .pd-ed").count() == 1, "")
    page.click("#ac-modes [data-mode=prep]")
    wait_for_condition(lambda: page.locator("[data-pb=notes] [data-ac=note-rm]").count() == 2, timeout_ms=4000)
    page.click("[data-pb=notes] [data-ac=note-rm][data-i='0']")
    wait_for_condition(lambda: len(_sess(page).get("notes") or []) == 1, timeout_ms=4000)
    s4 = _sess(page)
    record("acell-notes", "✕ takes a note off the session (the session note too); the vault keeps it", s4.get("note_path") == "" and (s4.get("notes") or [{}])[0].get("kind") == "gdoc" and page.evaluate("() => !!dgVault.get('Pale Lantern/Session 4.md')"), str(s4.get("notes")))
    record("acell-notes", "no JS errors (session notes)", not errs, str(errs))
    page.close()

def test_acell_mobile_decks(p):
    """2026-10-30: the dashboard's Tapes in the decks shows every channel
    with a tape in its deck (not only the dialed one), each as its own
    cassette in its colour, with an x that takes it out of that deck."""
    page, errs = open_phone(p)
    page.evaluate("() => { dgTapes.create({ name: 'Spooner Ave', scope: 'cell', cell_id: 'cell_osiris', color: '#7a2a24' }).then(function (t) { window.__t2 = t.id; }); }")
    page.wait_for_timeout(300)
    page.evaluate("() => dgTapes.decks()")
    wait_for_condition(lambda: sum(1 for l in page.evaluate("() => window.__dgFirestoreListeners || []") if l.get("isDoc") and l["path"].startswith("radio/")) >= 5, timeout_ms=5000)
    t2 = page.evaluate("() => window.__t2")
    push_firestore_doc_snapshot(page, "radio/1", True, {"tape": {"id": t2, "name": "Spooner Ave", "color": "#7a2a24"}, "track_title": "Any Human Heart"})
    push_firestore_doc_snapshot(page, "radio/3", True, {"tape": {"id": "tape_dread", "name": "Lighthouse · dread", "color": "#2a2a2a"}, "track_title": "Lighthouse at Dusk"})
    acm(page, "dgAcm.go('customise')")
    blk = page.locator("[data-acm=blk][data-k=tape]")
    if blk.count() and "on" not in (blk.get_attribute("class") or ""): blk.click()
    acm(page, "dgAcm.go('session')")
    wait_for_condition(lambda: page.locator(".acm-deckrow").count() == 2, timeout_ms=3000)
    rows = page.eval_on_selector_all(".acm-deckrow .acm-g", "els => els.map(e => e.innerText.replace(/\\s+/g, ' '))")
    fills = page.eval_on_selector_all(".acm-deckrow .acm-deckmini svg", "els => els.map(e => e.innerHTML.indexOf('#7a2a24') >= 0)")
    record("acell-mobile", "Tapes in the decks: every channel's tape (CH 1 and CH 3), not only the dialed one", len(rows) == 2 and "Spooner Ave" in rows[0] and "CH 1" in rows[0] and "CH 3" in rows[1], str(rows))
    record("acell-mobile", "…each drawn as its cassette, in its own colour", len(fills) == 2 and fills[0] is True, str(fills))
    page.click(".acm-deckrow [data-acm=deck-out][data-ch='1']")
    wait_for_condition(lambda: (fs_doc(page, "radio/1") or {}).get("tape", 1) is None, timeout_ms=3000)
    wait_for_condition(lambda: page.locator(".acm-deckrow").count() == 1, timeout_ms=3000)
    record("acell-mobile", "…x takes that tape out of its deck", (fs_doc(page, "radio/1") or {}).get("tape", 1) is None and page.locator(".acm-deckrow").count() == 1, str(fs_doc(page, "radio/1")))
    page.click(".acm-deckrow [data-acm=deck-console]")
    wait_for_condition(lambda: page.evaluate("() => dgAcm.current()") == "music", timeout_ms=3000)
    record("acell-mobile", "…tapping a tape opens the console on its channel", page.evaluate("() => dgAcm.current() === 'music' && dgAcellMusic.channel() === '3'"), page.evaluate("() => dgAcellMusic.channel()"))
    record("acell-mobile", "no JS errors (decks)", not errs, str(errs))
    page.close()

def test_acell_mobile_release(p):
    """2026-10-30: in Play, the big + has a Release evidence post-it: the
    session's evidence, then the Cell's other unreleased items, each with
    its switch."""
    page, errs = open_phone(p, mode="play")
    acell_feed_evidence(page)
    acm(page, "dgAcm.go('pads')")
    page.click("#acm-fab")
    page.wait_for_timeout(300)
    names = [x.strip() for x in page.eval_on_selector_all(".acm-pi b", "els => els.map(e => e.textContent)")]
    record("acell-mobile-play", "the big + in Play has Release evidence", "Release evidence" in names, str(names))
    page.click(".acm-pi[data-add=rel]")
    page.wait_for_timeout(400)
    record("acell-mobile-play", "…the session's evidence first, then the Cell's unreleased", "IN THIS SESSION" in page.inner_text(".acm-sheet").upper() and "Keeper" in page.inner_text(".acm-sheet"), page.inner_text(".acm-sheet")[:200])
    page.click(".acm-sheet [data-acm=release][data-id=ev_log]")
    wait_for_condition(lambda: any((w.get("data") or {}).get("released") is True for w in fs_writes(page, "evidence/ev_log")), timeout_ms=4000)
    record("acell-mobile-play", "…its switch releases it", any((w.get("data") or {}).get("released") is True for w in fs_writes(page, "evidence/ev_log")), "")
    page.evaluate("() => dgAcm.closeSheets()")
    page.click("#acm-fab")
    page.click(".acm-pi[data-add=console]")
    wait_for_condition(lambda: page.evaluate("() => dgAcm.current()") == "music", timeout_ms=3000)
    page.wait_for_timeout(500)
    top = page.evaluate("() => { var c = document.getElementById('ac-console'); return c ? c.getBoundingClientRect().top : -999; }")
    record("acell-mobile-play", "Tape (instead of Fire a pad) goes to the console", page.evaluate("() => dgAcm.current()") == "music" and -5 <= top < 400, str(top))
    # 2026-10-30: Pads, top to bottom: the session's tapes, the player, the pads.
    acm(page, "dgAcm.go('pads')")
    order = page.evaluate("() => { var t = document.querySelector('.acm-cxbox .pd-cxtapes'), p = document.querySelector('.acm-cxhost #ac-console'), d = document.querySelector('.acm-pads'); return !!(t && p && d) && !!(t.compareDocumentPosition(p) & 4) && !!(p.compareDocumentPosition(d) & 4); }")
    record("acell-mobile-play", "Pads: the session's tapes on top, the Music tab's player under them, then the pads", order and page.locator(".acm-cxhost .cc-keys button").count() == 4 and page.locator(".acm-cxhost .cc-ch").count() == 5, "")
    acm(page, "dgAcm.go('music')")
    push_collection(page, "tracks")
    acm(page, "dgAcm.go('pads')")
    page.click(".pd-cxt[data-id=tape_dread]")
    wait_for_condition(lambda: any(((w.get("data") or {}).get("tape") or {}).get("id") == "tape_dread" for w in fs_writes(page, "radio/")), timeout_ms=4000)
    record("acell-mobile-play", "…tapping a tape puts it in the deck", any(((w.get("data") or {}).get("tape") or {}).get("id") == "tape_dread" for w in fs_writes(page, "radio/")), "")
    wait_for_condition(lambda: page.locator(".acm-cxhost .cc-scr-t").count() == 2, timeout_ms=4000)
    page.click(".acm-cxhost .cc-scr-t[data-i='1']")
    wait_for_condition(lambda: any((w.get("data") or {}).get("track_title") == "Tension Rising" for w in fs_writes(page, "radio/")), timeout_ms=4000)
    record("acell-mobile-play", "…the green screen lists the tape's tracks; tapping one plays it", any((w.get("data") or {}).get("track_title") == "Tension Rising" for w in fs_writes(page, "radio/")), str(page.eval_on_selector_all(".acm-cxhost .cc-scr-t", "els => els.map(e => e.textContent)")))
    acm(page, "dgAcm.go('music')")
    record("acell-mobile-play", "…and the player goes back to the Music tab after", page.evaluate("() => !!document.querySelector('#panel-music #ac-console') && !document.querySelector('.acm-cxhost #ac-console')"), "")
    # Reported 2026-10-30: an NPC made from Initiative never showed there.
    acm(page, "dgAcm.go('initiative')")
    for name, go_btn, toggle in (("Sheriff Dunn", "save", False), ("Deputy Cole", "init", True)):
        page.click("[data-acm=new-npc-init]")
        page.fill(".acm-sheet .acm-form input[name=name]", name)
        if toggle: page.click(".acm-sheet [data-in]")
        page.click(".acm-sheet .acm-form button[data-go=%s]" % go_btn)
        wait_for_condition(lambda: name in page.inner_text("#acm-view"), timeout_ms=5000)
        record("acell-mobile-play", "Initiative: a new NPC (%s) shows up there at once" % ("Save" if go_btn == "save" else "Save + into initiative, switch off"),
               name in page.inner_text("#acm-view") and any(n.get("name") == name for n in (_sess(page).get("npcs") or [])), page.inner_text("#acm-view")[:200])
    # 2026-10-30: New round looked like it did nothing (the turn was already on top).
    acm(page, "dgAcm.go('initiative')")
    r0 = page.inner_text(".acm-round b")
    page.click("[data-acm=new-round]")
    page.wait_for_timeout(300)
    record("acell-mobile-play", "New round: the round marker counts up and says so", page.inner_text(".acm-round b") != r0 and "ROUND" in page.inner_text("#acm-toast, .acm-toast").upper() if page.locator("#acm-toast, .acm-toast").count() else page.inner_text(".acm-round b") != r0, page.inner_text(".acm-round"))
    page.click("[data-acm=round-reset]")
    page.wait_for_timeout(300)
    record("acell-mobile-play", "…Start over goes back to round 1", page.inner_text(".acm-round b") == "Round 1", page.inner_text(".acm-round"))
    record("acell-mobile-play", "no JS errors (release)", not errs, str(errs))
    page.close()

def test_acell_link_suggest(p):
    """2026-10-30: [[ in any vault note lists the vault's notes under the
    cursor, as in Obsidian; Enter or a tap writes the link and its ]]."""
    SEED = "() => Promise.all([dgVault.save('Pale Lantern/NPCs/Ruth Ainsley.md', '# Ruth'), dgVault.save('Pale Lantern/Lore/Tide tables.md', 'x'), dgVault.save('Other/NPCs/Ruth Ainsley.md', 'y'), dgVault.save('Pale Lantern/Lighthouse.md', 'z')])"
    page, errs = open_acell_shell(p)
    wait_for_condition(lambda: page.locator("[data-pb=notes] .ac-note").count() == 1, timeout_ms=5000)
    page.evaluate(SEED)
    page.wait_for_timeout(300)
    page.click("[data-pb=notes] [data-vmode=edit]")
    page.click("[data-pb=notes] .vn-ta")
    page.keyboard.press("Control+End")
    page.keyboard.type("\nSee [[ruth")
    wait_for_condition(lambda: page.locator(".vn-sug .vn-sugi").count() > 0, timeout_ms=3000)
    items = page.eval_on_selector_all(".vn-sug .vn-sugi", "els => els.map(e => e.innerText.replace(/\\s+/g, ' '))")
    record("acell-links", "[[ lists matching vault notes, the note's own folder first", len(items) == 2 and items[0].startswith("Ruth Ainsley") and "Pale Lantern" in items[0], str(items))
    page.keyboard.press("Enter")
    wait_for_condition(lambda: page.input_value("[data-pb=notes] .vn-ta").endswith("]]"), timeout_ms=3000)
    v = page.input_value("[data-pb=notes] .vn-ta")
    record("acell-links", "Enter writes the link and its ]] (a shared name gets its folder)", v.endswith("See [[Pale Lantern/NPCs/Ruth Ainsley]]") and page.locator(".vn-sug").count() == 0, repr(v[-50:]))
    page.wait_for_timeout(900)
    record("acell-links", "…and it saves", "[[Pale Lantern/NPCs/Ruth Ainsley]]" in (page.evaluate("() => (dgVault.get('Pale Lantern/Session 4.md') || {}).content") or ""), "")
    page.keyboard.type(" and [[lig")
    wait_for_condition(lambda: page.locator(".vn-sug .vn-sugi").count() > 0, timeout_ms=3000)
    page.keyboard.press("Escape")
    record("acell-links", "Esc closes the list", page.locator(".vn-sug").count() == 0, "")
    record("acell-links", "no JS errors (links, computer)", not errs, str(errs))
    page.close()
    page, errs = open_phone(p, mode="play")
    page.evaluate(SEED)
    acm(page, "dgAcm.go('notebook')")
    page.click("#acm-bar [data-acm=nb-edit]")
    page.wait_for_selector(".acm-ed .vn-ta", timeout=4000)
    page.click(".acm-ed .vn-ta")
    page.keyboard.press("Control+End")
    page.keyboard.type(" [[tide")
    wait_for_condition(lambda: page.locator(".vn-sug .vn-sugi").count() == 1, timeout_ms=3000)
    box = page.evaluate("() => { var r = document.querySelector('.vn-sug').getBoundingClientRect(); return [r.left, r.right, window.innerWidth]; }")
    page.tap(".vn-sug .vn-sugi")
    wait_for_condition(lambda: "[[Tide tables]]" in page.input_value(".acm-ed .vn-ta"), timeout_ms=3000)
    record("acell-links", "on a phone: the list fits the screen, a tap writes the link", box[0] >= 0 and box[1] <= box[2] and "[[Tide tables]]" in page.input_value(".acm-ed .vn-ta"), str(box))
    record("acell-links", "no JS errors (links, phone)", not errs, str(errs))
    page.close()

def test_acell_desk_player(p):
    """2026-10-30, the computer's Play desk: the Music tab's player under
    the session's tapes. Pick a tape for the dialed channel, any track on
    it, the music / loops / effects levels, stop a loop; links are added
    on the tape, not in the player."""
    page, errs = open_acell_shell(p)
    page.click("#acell-tab-strip .tw[data-tab=music]")
    push_collection(page, "tracks")
    page.wait_for_timeout(300)
    page.click("#ac-modes [data-mode=play]")
    wait_for_condition(lambda: page.locator(".pd-deck .pd-cxhost #ac-console").count() == 1, timeout_ms=5000)
    record("acell-desk-player", "the desk's deck is the Music tab's player, compact: no reels, no effects pads in it",
           page.locator(".pd-deck .pd-cxt").count() >= 1 and page.locator(".pd-deck .cc-ch").count() == 5 and page.locator(".pd-deck [data-cc=mix-effects]").count() == 1 and page.is_visible(".pd-deck [data-cc=stopall]") and page.locator(".pd-deck .cc-reels:visible, .pd-deck .cc-pads:visible").count() == 0, "")
    record("acell-desk-player", "…no link box in the player (links go on the tape)", page.locator(".pd-deck .cc-link").count() == 0, "")
    page.click(".pd-deck .cc-ch[data-ch='2']")
    page.click(".pd-cxt[data-id=tape_dread]")
    wait_for_condition(lambda: ((fs_doc(page, "radio/2") or {}).get("tape") or {}).get("id") == "tape_dread", timeout_ms=4000)
    record("acell-desk-player", "a channel, then a tape: the tape is in that channel's deck, track 1 playing", (fs_doc(page, "radio/2") or {}).get("track_title") == "Lighthouse at Dusk", str(fs_doc(page, "radio/2"))[:200])
    push_firestore_doc_snapshot(page, "radio/2", True, fs_doc(page, "radio/2"))
    wait_for_condition(lambda: page.locator(".pd-deck .cc-scr-t").count() == 2, timeout_ms=4000)
    page.click(".pd-deck .cc-scr-t[data-i='1']")
    wait_for_condition(lambda: (fs_doc(page, "radio/2") or {}).get("track_title") == "Tension Rising", timeout_ms=4000)
    record("acell-desk-player", "any track on the tape, from the player's screen", (fs_doc(page, "radio/2") or {}).get("track_title") == "Tension Rising", "")
    record("acell-desk-player", "the tape's pads are on the Effect pads", "Scream 01" in page.inner_text(".pd-pads"), page.inner_text(".pd-pads")[:100])
    page.eval_on_selector(".pd-deck [data-cc=mix-effects]", "el => { el.value = 30; el.dispatchEvent(new Event('input', { bubbles: true })); }")
    wait_for_condition(lambda: (fs_doc(page, "radio/2") or {}).get("effects_volume") == 30, timeout_ms=4000)
    record("acell-desk-player", "the effects level, for everyone on the channel", (fs_doc(page, "radio/2") or {}).get("effects_volume") == 30, "")
    push_firestore_doc_snapshot(page, "radio/2", True, fs_doc(page, "radio/2"))
    wait_for_condition(lambda: page.locator(".pd-deck [data-cc=live] .cc-row[data-kind=ambient]").count() == 1, timeout_ms=4000)
    page.click(".pd-deck [data-cc=live] .cc-row[data-kind=ambient] [data-cc=s-stop]")
    wait_for_condition(lambda: not (fs_doc(page, "radio/2") or {}).get("ambient_layers"), timeout_ms=4000)
    record("acell-desk-player", "a loop stops from On air now", not (fs_doc(page, "radio/2") or {}).get("ambient_layers"), "")
    page.click("#ac-modes [data-mode=prep]")
    page.click("#acell-tab-strip .tw[data-tab=music]")
    page.wait_for_timeout(300)
    record("acell-desk-player", "leaving Play, the player is back on the Music tab", page.evaluate("() => !!document.querySelector('#panel-music #ac-console') && !document.getElementById('ac-console').classList.contains('cc-lent')"), "")
    record("acell-desk-player", "no JS errors (desk player)", not errs, str(errs))
    page.close()

def test_acell_vault_format(p):
    """2026-10-30: in vault notes, **bold** is bold (the page's light
    weight made it plain), links are red, editing has Undo / Redo, and the
    computer's Notes tab goes Back / Forward through the notes opened."""
    MD = "# Ruth\n\nThe **keeper's** sister, *never* seen. See [[Lighthouse]] and <u>this</u>.\n"
    page, errs = open_acell_shell(p)
    page.evaluate("(md) => Promise.all([dgVault.save('T/Ruth.md', md), dgVault.save('T/Lighthouse.md', '# Lighthouse\\n\\nBack to [[Ruth]].')])", MD)
    page.click("#acell-tab-strip .tw[data-tab=notes]")
    page.evaluate("() => window.dgAcLibrary.openNote('T/Ruth.md')")
    page.wait_for_selector(".ac-vnote .vn-p b", timeout=4000)
    st = page.evaluate("() => [getComputedStyle(document.querySelector('.ac-vnote .vn-p b')).fontWeight, getComputedStyle(document.querySelector('.ac-vnote .vn-link')).color, !!document.querySelector('.ac-vnote .vn-p u')]")
    record("acell-vault-fmt", "bold is bold, links are red, <u> shows", st[0] == "700" and st[1] == "rgb(163, 34, 28)" and st[2], str(st))
    page.click(".ac-vnote .vn-link")
    wait_for_condition(lambda: "Lighthouse" in page.inner_text(".ac-vnote .vn-file"), timeout_ms=3000)
    page.click(".ac-vnote [data-vmode=edit]")
    page.click(".ac-vnote .vn-ta"); page.keyboard.press("Control+End"); page.keyboard.type(" New words.")
    before = page.input_value(".ac-vnote .vn-ta")
    page.click(".ac-vnote [data-vur=undo]")
    undone = page.input_value(".ac-vnote .vn-ta")
    page.click(".ac-vnote [data-vur=redo]")
    redone = page.input_value(".ac-vnote .vn-ta")
    record("acell-vault-fmt", "Undo takes the typing back, Redo puts it back", before.endswith("New words.") and not undone.endswith("New words.") and redone == before, repr([before[-15:], undone[-15:], redone[-15:]]))
    page.keyboard.press("Control+z")
    record("acell-vault-fmt", "…Ctrl+Z too", not page.input_value(".ac-vnote .vn-ta").endswith("New words."), "")
    page.click(".ac-vnote [data-vv=back]")
    wait_for_condition(lambda: "Ruth" in page.inner_text(".ac-vnote .vn-file"), timeout_ms=3000)
    record("acell-vault-fmt", "Back goes to the note before; Forward returns", "Ruth" in page.inner_text(".ac-vnote .vn-file") and page.is_enabled(".ac-vnote [data-vv=fwd]"), page.inner_text(".ac-vnote .vn-file"))
    page.click(".ac-vnote [data-vv=fwd]")
    wait_for_condition(lambda: "Lighthouse" in page.inner_text(".ac-vnote .vn-file"), timeout_ms=3000)
    record("acell-vault-fmt", "…Forward", "Lighthouse" in page.inner_text(".ac-vnote .vn-file"), "")
    # 2026-10-31: numbering kept, Tab stays in the note, Enter continues a
    # list, and Evidence's formatting bar.
    page.evaluate("() => dgVault.save('T/Steps.md', '# Steps\\n\\n1. First\\n\\nBetween.\\n\\n2. Second')")
    page.evaluate("() => window.dgAcLibrary.openNote('T/Steps.md')")
    page.wait_for_selector(".ac-vnote .vn-list li", timeout=4000)
    nums = page.eval_on_selector_all(".ac-vnote .vn-list li", "e => e.map(x => x.value)")
    record("acell-vault-fmt", "a numbered list keeps its numbers across a paragraph", nums == [1, 2], str(nums))
    page.evaluate("() => dgVault.save('T/Lazy.md', '# Lazy\\n\\n1. a\\n1. b\\n\\n1. c\\n\\nA note.\\n\\n1. d\\n\\n## Next\\n\\n1. e\\n\\nText.\\n\\n4. f')")
    page.evaluate("() => window.dgAcLibrary.openNote('T/Lazy.md')")
    page.wait_for_function("() => document.querySelectorAll('.ac-vnote .vn-list li').length === 6", timeout=4000)
    lz = page.eval_on_selector_all(".ac-vnote .vn-list li", "e => e.map(x => x.value)")
    record("acell-vault-fmt", "'1.' on every item counts 1, 2, 3 (blank lines and a note between carry on; a heading starts over; 4. stays 4)", lz == [1, 2, 3, 4, 1, 4], str(lz))
    page.evaluate("() => window.dgAcLibrary.openNote('T/Steps.md')")
    page.wait_for_selector(".ac-vnote .vn-list li", timeout=4000)
    page.click(".ac-vnote [data-vmode=edit]")
    record("acell-vault-fmt", "editing has Evidence's formatting bar (and a checklist, [[ ]])", page.locator(".ac-vnote .vn-tb [data-vmd]").count() == 10, "")
    page.click(".ac-vnote .vn-ta"); page.keyboard.press("Control+End")
    page.keyboard.press("Enter")
    page.keyboard.type("Third")
    page.keyboard.press("Tab")
    page.keyboard.press("Enter"); page.keyboard.press("Enter"); page.keyboard.type("end")
    v = page.input_value(".ac-vnote .vn-ta")
    record("acell-vault-fmt", "Enter carries the numbering on, Tab indents and stays in the note, Enter on an empty item ends the list",
           "\n  3. Third\nend" in v and page.evaluate("() => document.activeElement.classList.contains('vn-ta')"), repr(v[-40:]))
    page.click(".ac-vnote [data-vmd=task]")
    record("acell-vault-fmt", "…the bar's Tasks marks the line", page.input_value(".ac-vnote .vn-ta").endswith("- [ ] end"), repr(page.input_value(".ac-vnote .vn-ta")[-20:]))
    record("acell-vault-fmt", "no JS errors (vault format)", not errs, str(errs))
    page.close()

def test_acell_hear_here(p):
    """2026-10-30: on a phone in Play, the player's progress bar showed
    nothing (the phone never loads the audio, so no length); and hearing it
    meant opening Tune In. The bar takes the length the tape knows, and
    Hear it here tunes the Hub's radio to the player's channel, unmuted,
    and follows it when the channel changes."""
    import time as _t
    ctx = p.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
    page = ctx.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    _block_fonts(page)
    skip_acell_gate(page)
    page.add_init_script("try { sessionStorage.setItem('dg_acell_pw', 'testpw'); localStorage.setItem('dg_acell_session', 'sess_4'); localStorage.setItem('dg_acell_mode', JSON.stringify('play')); } catch (e) {}")
    # The phone: the preview element is never allowed to start.
    page.add_init_script("HTMLMediaElement.prototype.play = function () { return Promise.reject(new DOMException('blocked', 'NotAllowedError')); };")
    install_firestore_backend(page, acell_cell_fixture())
    page.goto(f"{BASE}/hub.html?start=a-cell.html", wait_until="domcontentloaded", timeout=15000)
    wait_for_condition(lambda: any(f.name == "dg-shell-content" and "a-cell.html" in f.url for f in page.frames), timeout_ms=10000)
    fr = [f for f in page.frames if f.name == "dg-shell-content"][0]
    wait_for_condition(lambda: fr.evaluate("() => !!window.dgAcm && (window.__dgFirestoreListeners || []).some(l => l.path === 'cells')"), timeout_ms=10000)
    for c in ("characters", "briefs", "cells", "tracks"):
        push_collection(fr, c)
    fr.evaluate("() => dgAcm.go('pads')")
    wait_for_condition(lambda: fr.locator(".acm-cxbox [data-cc=hear]").count() == 1, timeout_ms=5000)
    fr.click(".acm-cxbox .pd-cxt[data-id=tape_dread]")
    ch = fr.evaluate("() => dgAcellMusic.channel()")
    wait_for_condition(lambda: (fs_doc(fr, "radio/" + ch) or {}).get("track_title") == "Lighthouse at Dusk", timeout_ms=4000)
    d = dict(fs_doc(fr, "radio/" + ch)); d["started_at"] = int(_t.time() * 1000) - 65000
    push_firestore_doc_snapshot(fr, "radio/" + ch, True, d)
    page.wait_for_timeout(1500)
    du = fr.inner_text(".acm-cxbox [data-cc=du]")
    el = fr.inner_text(".acm-cxbox [data-cc=el]")
    record("acell-hear", "on a phone the progress bar has the track's length (from the tape) and moves", du == "6:21" and el in ("1:05", "1:06", "1:07"), f"{el} / {du}")
    fr.click(".acm-cxbox [data-cc=hear]")
    page.wait_for_timeout(400)
    r = page.evaluate("() => window.dgRadio.state()")
    record("acell-hear", "Hear it here: the Hub's radio, tuned to the player's channel, unmuted", r.get("channel") == ch and r.get("muted") is False and fr.get_attribute(".acm-cxbox [data-cc=hear]", "aria-pressed") == "true" and fr.locator(".acm-cxbox [data-cc=hear].on svg").count() == 1, str(r)[:200])
    # 2026-10-30: pads fired here start the effect on this device inside
    # the tap (iOS), before the broadcast's snapshot gets back.
    # The radio's first snapshot of the channel, as a real tune-in gets at once.
    page.evaluate("(a) => { window.__dgFirestoreDocs = window.__dgFirestoreDocs || {}; window.__dgFirestoreDocs[a[0]] = a[1]; }", ["radio/" + ch, fs_doc(fr, "radio/" + ch) or {"channel": ch}])
    push_firestore_doc_snapshot(page, "radio/" + ch, True, fs_doc(fr, "radio/" + ch) or {"channel": ch})
    page.wait_for_timeout(300)
    n0 = page.evaluate("() => document.querySelectorAll('audio[src*=\\'stingers/\\']').length")
    fr.click(".acm-pads .acm-pad >> nth=0")
    page.wait_for_timeout(150)
    n1 = page.evaluate("() => document.querySelectorAll('audio[src*=\\'stingers/\\']').length")
    fired = [x for x in ((fs_doc(fr, "radio/" + ch) or {}).get("stingers") or [])]
    record("acell-hear", "a pad fired while playing here starts its effect on this device at once (and goes on air)", n1 == n0 + 1 and len(fired) >= 1, f"{n0}->{n1} {fired[-1:]}")
    if fired:
        page.evaluate("(a) => { window.__dgFirestoreDocs = window.__dgFirestoreDocs || {}; window.__dgFirestoreDocs[a[0]] = a[1]; }", ["radio/" + ch, fs_doc(fr, "radio/" + ch)])
        push_firestore_doc_snapshot(page, "radio/" + ch, True, fs_doc(fr, "radio/" + ch))
        page.wait_for_timeout(300)
        n2 = page.evaluate("() => document.querySelectorAll('audio[src*=\\'stingers/\\']').length")
        record("acell-hear", "…and the broadcast bringing the same fire doesn't start it twice", n2 == n1, f"{n1}->{n2}")
    other = "2" if ch != "2" else "4"
    fr.click(".acm-cxbox .cc-ch[data-ch='%s']" % other)
    wait_for_condition(lambda: page.evaluate("() => window.dgRadio.state().channel") == other, timeout_ms=3000)
    record("acell-hear", "…it follows the player to another channel", page.evaluate("() => window.dgRadio.state().channel") == other, "")
    fr.click(".acm-cxbox [data-cc=hear]")
    page.wait_for_timeout(300)
    record("acell-hear", "…and a second tap mutes it again", page.evaluate("() => window.dgRadio.state().muted") is True, "")
    # 2026-10-30: the player vanished from Pads on every change to the
    # broadcast (the hidden computer desk took it back on each update).
    ch2 = fr.evaluate("() => dgAcellMusic.channel()")
    push_firestore_doc_snapshot(fr, "radio/" + ch2, True, fs_doc(fr, "radio/" + ch2) or {"channel": ch2})
    page.wait_for_timeout(700)
    record("acell-hear", "the player stays on Pads after a change to the broadcast", fr.evaluate("() => !!document.querySelector('.acm-cxbox #ac-console')"), "")
    record("acell-hear", "the rest of the library is folded under the tape's pads and loops", fr.locator(".acm-lib").count() == 1 and not fr.evaluate("() => document.querySelector('.acm-lib').open"), "")
    # A tape from another Cell left in the channel's deck isn't this game's.
    fr.evaluate("() => dgTapes.create({ name: 'Elsewhere', scope: 'cell', cell_id: 'cell_other', pads: ['manic-laugh-02', 'bells-distant', 'cat-whimper-01'], loops: [], tracks: [] }).then(function (t) { window.__other = t.id; })")
    page.wait_for_timeout(300)
    oid = fr.evaluate("() => window.__other")
    push_firestore_doc_snapshot(fr, "radio/" + ch2, True, {"channel": ch2, "tape": {"id": oid, "name": "Elsewhere", "color": "#333"}})
    page.wait_for_timeout(700)
    labs = fr.inner_text("#acm-view")
    record("acell-hear", "a tape from another Cell in the deck doesn't load its pads on Pads", "THIS SESSION" in labs.upper() and "THIS TAPE · 3" not in labs.upper(), labs[:300])
    record("acell-hear", "no JS errors (hear it here)", not errs, str(errs))
    ctx.close()

def test_acell_mobile_waiting(p):
    """2026-10-30: "Alfred is dead, long dead" stayed in Waiting on you as
    wounded. An Agent at HP 0 is KIA, not wounded; and any row can be
    dismissed for the session with its x, until what it says changes."""
    docs = acell_cell_fixture()
    cj = json.loads(docs["characters/MARA-KS01"]["character_json"])
    cj.setdefault("live", {})
    s = json.dumps(cj).replace('"hp": 11', '"hp": 0')
    docs["characters/MARA-KS01"] = dict(docs["characters/MARA-KS01"], character_json=s)
    page, errs = open_phone(p, docs=docs)
    acm(page, "dgAcm.go('session')")
    wait_for_condition(lambda: "wounded" in page.inner_text("#acm-view"), timeout_ms=5000)
    txt = page.inner_text("#acm-view")
    record("acell-mobile", "Waiting on you: a wounded Agent, but not one at HP 0 (KIA)", "Reyes is wounded" in txt and "Kessler is wounded" not in txt, txt[:300])
    page.click("[data-acm=w-x][data-k^='agent:TOMA']")
    page.wait_for_timeout(300)
    record("acell-mobile", "…x dismisses a row for this session", "Reyes is wounded" not in page.inner_text("#acm-view"), "")
    record("acell-mobile", "no JS errors (waiting)", not errs, str(errs))
    page.close()

def test_acell_mobile_typing_kept(p):
    """2026-10-31, iPhone: writing a session note, the keyboard closed every
    few letters. Each pause saved the note and the vault's change redrew
    the phone screen, text box and all. While a note is being written the
    screen doesn't redraw; it catches up when the text box is left."""
    page, errs = open_phone(p)
    page.evaluate("() => dgVault.save('T/Typing.md', '# Typing\\n\\n')")
    page.wait_for_timeout(300)
    page.evaluate("() => window.dgAcmNotes.open('T/Typing.md')")
    page.wait_for_timeout(500)
    page.evaluate("() => dgAcm.actions.vedit ? null : null")
    page.click("#acm-view .vn-body, #acm-view .acm-ed")
    page.wait_for_selector("#acm-view .vn-ta", timeout=4000)
    page.click("#acm-view .vn-ta")
    page.keyboard.press("Control+End")
    page.evaluate("() => { window.__ta = document.querySelector('#acm-view .vn-ta'); }")
    page.keyboard.type("First words")
    page.wait_for_timeout(1500)   # the save, and the vault's change event
    page.keyboard.type(" and more")
    page.wait_for_timeout(1500)
    same = page.evaluate("() => document.querySelector('#acm-view .vn-ta') === window.__ta && document.activeElement === window.__ta")
    saved = page.evaluate("() => (dgVault.get('T/Typing.md') || {}).content || ''")
    record("acell-mobile", "writing a note on a phone: the save doesn't redraw the text box (the keyboard stays)", same and "First words and more" in saved, repr(saved[-40:]))
    record("acell-mobile", "no JS errors (typing)", not errs, str(errs))
    page.close()

def test_acell_console(p):
    """v3.12.0, the Music tab's control center: the broadcast on a tape
    deck -- channels, the Cell's channel, a link to play or cue, the
    transport, the mixer, what's on air (stop one, STOP ALL), the
    session's tape and pads; the classic desk folded underneath."""
    page, errs = open_acell_shell(p, storage={"dg_acell_classic_open": "0"})
    page.click("#acell-tab-strip .tw[data-tab=music]")
    page.wait_for_selector("#ac-console .cc-deck", timeout=6000)
    if wait_for_condition(lambda: page.evaluate("() => (window.__dgFirestoreListeners || []).some(l => l.path === 'tracks')"), timeout_ms=4000):
        push_collection(page, "tracks")
    record("acell-console", "the Music tab: tapes, then the library shelves, then the control center; the classic desk folded at the foot",
           page.is_visible("#ac-console .cc-scr") and not page.evaluate("() => document.getElementById('ac-classic').open")
           and page.evaluate("() => { var t = document.getElementById('ac-tapes'), sh = document.getElementById('ac-shelf'), c = document.getElementById('ac-console'), d = document.getElementById('ac-classic'); return !!(t.compareDocumentPosition(sh) & 4) && !!(sh.compareDocumentPosition(c) & 4) && !!(c.compareDocumentPosition(d) & 4); }"), "")
    wait_for_condition(lambda: "on" in (page.get_attribute("#ac-console .cc-ch[data-ch='3']", "class") or ""), timeout_ms=4000)
    record("acell-console", "it tunes to the session's Cell's channel", "on" in (page.get_attribute("#ac-console .cc-ch[data-ch='3']", "class") or ""), "")
    page.click("#ac-console .cc-ch[data-ch='2']")
    wait_for_condition(lambda: page.evaluate("() => window.dgAcellMusic.channel()") == "2", timeout_ms=3000)
    record("acell-console", "a channel button tunes the broadcast", page.evaluate("() => window.dgAcellMusic.channel()") == "2", "")
    wait_for_condition(lambda: page.is_visible("#ac-console [data-cc=assign]"), timeout_ms=3000)
    record("acell-console", "it offers to make that the Cell's channel", page.is_visible("#ac-console [data-cc=assign]") and "CH 2" in page.inner_text("#ac-console [data-cc=assign]"), "")
    page.click("#ac-console [data-cc=assign]")
    # v3.13.0: a Cell has up to three channels -- assigning adds one.
    wait_for_condition(lambda: "2" in ((fs_doc(page, "cells/cell_osiris") or {}).get("channels") or []), timeout_ms=4000)
    record("acell-console", "…and does (one of the Cell's channels, the first stays its main one)", (fs_doc(page, "cells/cell_osiris") or {}).get("channels") == ["3", "2"] and (fs_doc(page, "cells/cell_osiris") or {}).get("channel") == "3", str(fs_doc(page, "cells/cell_osiris")))
    # 2026-10-30: links go on a tape (the tape editor), not in the player.
    record("acell-console", "the player has no link box (links go on a tape)", page.locator("#ac-console .cc-link, #ac-console [data-cc=url]").count() == 0, "")
    page.evaluate("() => window.dgAcellMusic.playLink('https://example.invalid/fog.mp3', 'Fog Signal')")
    wait_for_condition(lambda: (fs_doc(page, "radio/2") or {}).get("track_url") == "https://example.invalid/fog.mp3", timeout_ms=4000)
    push_firestore_doc_snapshot(page, "radio/2", True, fs_doc(page, "radio/2"))
    wait_for_condition(lambda: "FOG SIGNAL" in page.inner_text("#ac-console .cc-scr"), timeout_ms=4000)
    record("acell-console", "the deck's screen shows it, on air, with the seek bar", "FOG SIGNAL" in page.inner_text("#ac-console .cc-scr") and "ON AIR" in page.inner_text("#ac-console .cc-air") and page.is_visible("#ac-console [data-cc=seek]"), "")
    record("acell-console", "a track starts on loop (the default)", (fs_doc(page, "radio/2") or {}).get("loop") is True, "")
    page.click("#ac-console [data-cc=loop]")
    wait_for_condition(lambda: (fs_doc(page, "radio/2") or {}).get("loop") is False, timeout_ms=4000)
    record("acell-console", "LOOP turns the loop off (and on)", (fs_doc(page, "radio/2") or {}).get("loop") is False, "")
    page.eval_on_selector("#ac-console [data-cc=mix-ambient]", "el => { el.value = 40; el.dispatchEvent(new Event('input', { bubbles: true })); }")
    wait_for_condition(lambda: (fs_doc(page, "radio/2") or {}).get("ambient_volume") == 40, timeout_ms=4000)
    record("acell-console", "the mixer sets the loops level for everyone", (fs_doc(page, "radio/2") or {}).get("ambient_volume") == 40, "")
    page.eval_on_selector("#ac-console [data-cc=mix-effects]", "el => { el.value = 25; el.dispatchEvent(new Event('input', { bubbles: true })); }")
    wait_for_condition(lambda: (fs_doc(page, "radio/2") or {}).get("effects_volume") == 25, timeout_ms=4000)
    record("acell-console", "…and the effects level, on its own (2026-10-30)", (fs_doc(page, "radio/2") or {}).get("effects_volume") == 25 and (fs_doc(page, "radio/2") or {}).get("ambient_volume") == 40, "")
    page.click("#ac-console [data-cc=insert][data-id=tape_dread]")
    wait_for_condition(lambda: any(l.get("id") == "drone-low" for l in (fs_doc(page, "radio/2") or {}).get("ambient_layers") or []), timeout_ms=4000)
    r2 = fs_doc(page, "radio/2") or {}
    record("acell-console", "putting the operation's tape in: it's named on the channel, track 1 plays (no loop: the list carries on), its loop comes in",
           (r2.get("tape") or {}).get("id") == "tape_dread" and r2.get("track_title") == "Lighthouse at Dusk" and r2.get("loop") is False
           and any(l.get("id") == "drone-low" for l in r2.get("ambient_layers") or []), str(r2)[:300])
    wait_for_condition(lambda: "Lighthouse at Dusk" in page.inner_text("#ac-console [data-cc=cues]"), timeout_ms=3000)
    record("acell-console", "its tracks become the cue list, auto-advance on", "Lighthouse at Dusk" in page.inner_text("#ac-console [data-cc=cues]") and "Tension Rising" in page.inner_text("#ac-console [data-cc=cues]") and page.is_checked("#ac-console [data-cc=auto]"), page.inner_text("#ac-console [data-cc=cues]"))
    push_firestore_doc_snapshot(page, "radio/2", True, fs_doc(page, "radio/2"))
    wait_for_condition(lambda: page.locator("#ac-console [data-cc=live] .cc-row[data-kind=ambient]").count() == 1, timeout_ms=4000)
    record("acell-console", "On air now lists it", "Drone: Low" in page.inner_text("#ac-console [data-cc=live]"), page.inner_text("#ac-console [data-cc=live]"))
    page.click("#ac-console [data-cc=live] .cc-row[data-kind=ambient] [data-cc=s-stop]")
    wait_for_condition(lambda: not (fs_doc(page, "radio/2") or {}).get("ambient_layers"), timeout_ms=4000)
    record("acell-console", "✕ stops that loop", not (fs_doc(page, "radio/2") or {}).get("ambient_layers"), "")
    page.click("#ac-console [data-cc=pad][data-id=scream-01]")
    wait_for_condition(lambda: any(x.get("id") == "scream-01" for x in (fs_doc(page, "radio/2") or {}).get("stingers") or []), timeout_ms=4000)
    record("acell-console", "a pad on the tape fires its effect", True, "")
    page.click("#ac-console [data-cc=stopall]")
    wait_for_condition(lambda: (fs_doc(page, "radio/2") or {}).get("stingers") == [], timeout_ms=4000)
    record("acell-console", "STOP ALL silences every effect and loop", (fs_doc(page, "radio/2") or {}).get("stingers") == [] and (fs_doc(page, "radio/2") or {}).get("ambient_layers") == [], "")
    page.evaluate("() => window.dgAcellMusic.cue({ url: 'https://example.invalid/next.mp3' })")
    record("acell-console", "auto-advance is on by default", page.is_checked("#ac-console [data-cc=auto]") and page.evaluate("() => window.dgAcellMusic.autoAdvance()") is True, "")
    record("acell-console", "a track on the cue list doesn't loop (the list carries on); any other track does",
           page.evaluate("() => window.dgAcellMusic.defaultLoop('https://example.invalid/next.mp3')") is False and page.evaluate("() => window.dgAcellMusic.defaultLoop('https://example.invalid/other.mp3')") is True, "")
    page.click("#ac-console [data-cc=stop]")
    wait_for_condition(lambda: (fs_doc(page, "radio/2") or {}).get("track_url") == "", timeout_ms=4000)
    record("acell-console", "■ stops the track", (fs_doc(page, "radio/2") or {}).get("track_url") == "", "")
    page.click("#ac-classic > summary")
    page.wait_for_timeout(300)
    wait_for_condition(lambda: page.is_visible("#music-set-btn"), timeout_ms=3000)
    record("acell-console", "the classic desk unfolds, and stays so on this device",
           page.is_visible("#music-set-btn") and page.evaluate("() => localStorage.getItem('dg_acell_classic_open')") == "1", "")
    record("acell-console", "no JS errors in the control center", not errs, str(errs))

def test_acell_in_shell(p):
    """v3.12.0: A-Cell inside the Hub's app shell (hub.html). The shell
    owns the one Dice Roller (its page, outside A-Cell's frame): on the
    desk it's laid over the dice slot, open, and given back folded when
    Play ends."""
    page = p.new_page(viewport={"width": 1440, "height": 950})
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)
    page.add_init_script("try { sessionStorage.setItem('dg_acell_pw', 'testpw'); localStorage.setItem('dg_acell_session', 'sess_4'); } catch (e) {}")
    install_firestore_backend(page, acell_cell_fixture())
    page.goto(f"{BASE}/hub.html?start=a-cell.html", wait_until="domcontentloaded", timeout=15000)
    wait_for_condition(lambda: any(f.name == "dg-shell-content" and "a-cell.html" in f.url for f in page.frames), timeout_ms=10000)
    fr = [f for f in page.frames if f.name == "dg-shell-content"][0]
    wait_for_condition(lambda: fr.evaluate("() => !!window.dgAcellRoster && (window.__dgFirestoreListeners || []).some(l => l.path === 'cells')"), timeout_ms=10000)
    for c in ("characters", "briefs", "cells"):
        push_collection(fr, c)
    wait_for_condition(lambda: page.evaluate("() => !!document.getElementById('dr-panel')"), timeout_ms=8000)
    record("acell-shell-hub", "in the shell, A-Cell's frame has no Dice Roller of its own (the shell's is the one)",
           fr.evaluate("() => !document.getElementById('dr-panel')"), "")
    fr.click("#ac-modes [data-mode=play]")
    wait_for_condition(lambda: fr.evaluate("() => !!document.querySelector('.pd-diceslot')"), timeout_ms=6000)
    page.wait_for_timeout(300)
    geo = page.evaluate("""() => {
        var p = document.getElementById('dr-panel'), f = document.getElementById('dg-shell-content');
        var s = f.contentDocument.querySelector('.pd-diceslot').getBoundingClientRect(), fr = f.getBoundingClientRect(), r = p.getBoundingClientRect();
        return { open: !p.classList.contains('dr-collapsed'), dx: Math.abs(r.left - (fr.left + s.left)), dy: Math.abs(r.top - (fr.top + s.top)), w: Math.abs(r.width - s.width) };
    }""")
    record("acell-shell-hub", "on the desk, the shell's Dice Roller sits open over the dice slot",
           geo["open"] and geo["dx"] < 3 and geo["dy"] < 3 and geo["w"] < 3, str(geo))
    record("acell-shell-hub", "no 'Dice Roller loading…' left on the desk", "Dice Roller loading" not in fr.inner_text("#panel-desk"), "")
    fr.click("#ac-modes [data-mode=prep]")
    page.wait_for_timeout(200)
    back = page.evaluate("() => { var p = document.getElementById('dr-panel'); return { collapsed: p.classList.contains('dr-collapsed'), left: p.style.left, top: p.style.top }; }")
    record("acell-shell-hub", "leaving Play gives it back to the shell, folded, where it was",
           back["collapsed"] and not back["left"] and not back["top"], str(back))
    record("acell-shell-hub", "no JS errors in the shell", not errs, str(errs))

def test_vault_sync_rules(p):
    """functions/vault-sync.js: who wins when the iCloud vault and
    A-Cell's copy disagree (test/vault_sync_test.js, run with node)."""
    try:
        out = subprocess.run(["node", os.path.join(os.path.dirname(__file__), "vault_sync_test.js")], capture_output=True, text=True, timeout=60)
        rows = json.loads(out.stdout or "[]")
    except Exception as e:
        record("vault-sync", "the vault sync checks ran", False, str(e))
        return
    record("vault-sync", "the vault sync checks ran", len(rows) >= 13, out.stderr[-300:])
    for r in rows:
        record("vault-sync", r["name"], r["ok"], r.get("detail", ""))

def test_acell_session_notes(p):
    """A-Cell's Session Notes tab: the Handler's links to a scenario's
    prep pages (Hungarian and/or English), kept in Firestore
    session_notes/ (Handler-only), opened in a new tab. Only https links
    are accepted; edit keeps the same document; delete takes two taps."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)
    page.add_init_script("try { sessionStorage.setItem('dg_acell_pw', 'testpw'); } catch (e) {}")
    install_firestore_backend(page, {
        "session_notes/sn1": {"title": "Music From a Darkened Room", "url_hu": "https://example.org/mfdr-hu", "url_en": "", "description": "Op IAGO"},
    })
    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    wait_for_condition(lambda: page.evaluate("() => window.__dgFirestoreAuthUser && window.__dgFirestoreAuthUser.uid") == "handler", timeout_ms=6000)
    record("acell-notes", "nothing is read from session_notes until the tab is opened",
           page.inner_text("#sn-list").startswith("Open this tab"), page.inner_text("#sn-list"))
    page.click("#acell-tab-strip .tw[data-tab=notes]")
    page.wait_for_selector("#sn-list .sn-card", timeout=8000)
    links = page.eval_on_selector_all("#sn-list .sn-card a", "els => els.map(a => [a.textContent.trim(), a.getAttribute('href'), a.target, a.rel])")
    record("acell-notes", "a saved scenario shows its name, note and a Magyar link opening in a new tab (no English link yet)",
           "Music From a Darkened Room" in page.inner_text("#sn-list") and "Op IAGO" in page.inner_text("#sn-list")
           and links == [["Magyar \u2197", "https://example.org/mfdr-hu", "_blank", "noopener noreferrer"]], str(links))

    page.click("#sn-add-btn")
    page.fill("#sn-form input[name=title]", "Last Things Last")
    page.fill("#sn-form input[name=url_hu]", "javascript:alert(1)")
    page.click("#sn-form button[type=submit]")
    page.wait_for_timeout(300)
    record("acell-notes", "a non-https link is refused, nothing written",
           "https://" in page.inner_text("#sn-status") and not fs_writes(page, "session_notes/"), page.inner_text("#sn-status"))
    page.fill("#sn-form input[name=url_hu]", "https://example.org/ltl-hu")
    page.fill("#sn-form input[name=url_en]", "https://example.org/ltl-en")
    page.click("#sn-form button[type=submit]")
    _pump_until(page, lambda: page.locator("#sn-list .sn-card").count() == 2, timeout_ms=5000)
    titles = page.eval_on_selector_all("#sn-list .sn-title", "els => els.map(e => e.textContent)")
    w = fs_writes(page, "session_notes/")
    record("acell-notes", "+ Add Session Notes saves both links and lists it (sorted by name)",
           titles == ["Last Things Last", "Music From a Darkened Room"] and len(w) == 1
           and w[0]["data"].get("url_hu") == "https://example.org/ltl-hu" and w[0]["data"].get("url_en") == "https://example.org/ltl-en",
           f"{titles} {w}")

    page.click(".sn-card[data-id=sn1] [data-sn=edit]")
    page.fill("#sn-form input[name=url_en]", "https://example.org/mfdr-en")
    page.click("#sn-form button[type=submit]")
    _pump_until(page, lambda: page.locator(".sn-card[data-id=sn1] a").count() == 2, timeout_ms=5000)
    doc = fs_doc(page, "session_notes/sn1") or {}
    record("acell-notes", "Edit adds the English link to the same entry",
           doc.get("url_en") == "https://example.org/mfdr-en" and doc.get("url_hu") == "https://example.org/mfdr-hu"
           and page.locator(".sn-card[data-id=sn1] a").count() == 2, str(doc))

    page.click(".sn-card[data-id=sn1] [data-sn=delete]")
    page.wait_for_timeout(200)
    still = fs_doc(page, "session_notes/sn1") is not None
    page.click(".sn-card[data-id=sn1] [data-sn=delete]")
    _pump_until(page, lambda: page.locator(".sn-card[data-id=sn1]").count() == 0, timeout_ms=5000)
    record("acell-notes", "Delete asks once more, then removes it",
           still and fs_doc(page, "session_notes/sn1") is None and page.locator("#sn-list .sn-card").count() == 1, "")

    # An uploaded page: opened in a sealed frame, its localStorage saves
    # (ticks) kept in Firestore and restored on the next open.
    import tempfile
    html = ("<!doctype html><html><head><title>Prep</title></head><body>"
            "<input type='checkbox' id='c1'><label for='c1'>Clue found</label>"
            "<script>var S={};try{S=JSON.parse(localStorage.getItem('prep-v1')||'{}');}catch(e){}"
            "document.getElementById('c1').checked=!!S.c1;"
            "var own='?';try{own=String(window.parent.document.title);}catch(e){own='blocked';}document.body.dataset.parent=own;"
            "document.getElementById('c1').addEventListener('change',function(e){S.c1=e.target.checked;localStorage.setItem('prep-v1',JSON.stringify(S));});"
            "</script></body></html>")
    tmp = tempfile.NamedTemporaryFile("w", suffix=".html", delete=False)
    tmp.write(html); tmp.close()
    page.click("#sn-add-btn")
    page.fill("#sn-form input[name=title]", "Prep Page")
    page.set_input_files("#sn-form input[name=file_hu]", tmp.name)
    page.click("#sn-form button[type=submit]")
    _pump_until(page, lambda: page.locator(".sn-card button[data-sn=view]").count() == 1, timeout_ms=6000)
    main_w = [w_ for w_ in fs_writes(page, "session_notes/") if (w_.get("data") or {}).get("title") == "Prep Page"]
    nid = main_w[-1]["path"].split("/")[1] if main_w else ""
    filed = fs_doc(page, f"session_notes/{nid}/files/hu") or {}
    record("acell-notes", "an uploaded .html page is stored (Handler-only Firestore) and the card opens it in A-Cell",
           bool(nid) and filed.get("html") == html and (fs_doc(page, f"session_notes/{nid}") or {}).get("file_hu", {}).get("name", "").endswith(".html"),
           f"{nid} {list(filed.keys())}")
    page.click(".sn-card button[data-sn=view]")
    page.wait_for_selector(".sn-viewer .sn-v-frame", timeout=6000)
    fr = page.frame_locator(".sn-v-frame")
    fr.locator("#c1").wait_for(timeout=6000)
    sandbox = page.get_attribute(".sn-v-frame", "sandbox") or ""
    record("acell-notes", "the page runs sealed: sandboxed without allow-same-origin, can't reach A-Cell",
           "allow-scripts" in sandbox and "allow-same-origin" not in sandbox
           and fr.locator("body").get_attribute("data-parent") == "blocked", sandbox)
    # The page restores its ticks in a script after the box: let it run
    # first (its last line marks the body).
    fr.locator("body[data-parent]").wait_for(timeout=6000)
    _tick_in_sealed_frame(fr, "#c1")
    _pump_until(page, lambda: "c1" in ((fs_doc(page, f"session_notes/{nid}/state/hu") or {}).get("items") or {}).get("prep-v1", ""), timeout_ms=5000)
    st = (fs_doc(page, f"session_notes/{nid}/state/hu") or {}).get("items") or {}
    record("acell-notes", "ticking a box in the page saves it to Firestore (not just this browser)",
           st.get("prep-v1") == '{"c1":true}', str(st))
    page.click(".sn-viewer [data-sn=close]")
    page.click(".sn-card button[data-sn=view]")
    page.frame_locator(".sn-v-frame").locator("#c1").wait_for(timeout=6000)
    record("acell-notes", "reopening restores the ticks",
           page.frame_locator(".sn-v-frame").locator("#c1").is_checked(), "")
    page.click(".sn-viewer [data-sn=close]")
    os.unlink(tmp.name)
    record("acell-notes", "no JS exceptions", len(errs) == 0, "; ".join(errs))
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
    install_notes_firestore_stub(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)
    # Sheet's own writes (delete/restore_character, update_character_field)
    # are Handler-gated -- window.__dgGetHandlerIdToken() needs a signed-in
    # Handler, which needs a saved password to silently sign in on load
    # (and a real window.firebase mock, hence the stub above).
    page.add_init_script("try { sessionStorage.setItem('dg_acell_pw', 'testpw'); } catch (e) {}")

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
    posts = []
    # The Firestore docs the Sheet tab reads (characters, cells, briefs);
    # delete/restore/Player Name edits are real writes to that store.
    docs = {}
    for c in fake_characters:
        docs["characters/" + c["agent_code"]] = {
            "agent_code": c["agent_code"], "player_name": c["player_name"],
            "player_name_lc": c["player_name"].lower(), "updated_at": c["updated_at"],
            "character_json": json.dumps({"bio": {"name": c["name"]}, "derived": {"hp": c["hp"], "san": c["san"]}})}
    for c in fake_cells:
        docs["cells/" + c["cell_id"]] = {k: v for k, v in c.items() if k != "cell_id"}
    for bo in briefs_only:
        docs["briefs/" + bo["agent_code"]] = {k: v for k, v in bo.items() if k != "agent_code"}
    install_firestore_backend(page, docs)
    # The Created column reads each doc's createTime from Firestore's REST
    # API (the web SDK doesn't expose it): answer with fixed times.
    created_iso = {"OWEN-CS12": "2026-09-01T10:05:00Z", "PRIY-AN34": "2026-09-02T11:00:00Z",
                   "MARC-9XQ2": "2026-09-03T12:00:00Z", "DEMO-Q5MD": "2026-09-04T13:00:00Z"}
    def fake_rest(route):
        coll = route.request.url.split("/documents/")[1].split("?")[0]
        docs_out = [{"name": f"projects/dg-app-b3447/databases/(default)/documents/{coll}/{c}", "createTime": t,
                     "updateTime": "2026-09-20T08:30:00Z" if (c == "OWEN-CS12" and coll == "briefs") else t}
                    for c, t in created_iso.items() if c == "OWEN-CS12" or (coll == "characters") != (c == "DEMO-Q5MD")]
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"documents": docs_out}))
    page.route("**/firestore.googleapis.com/v1/**", fake_rest)
    tap_acell_posts(page, lambda body: posts.append(body))
    page.add_init_script(f"Date.now = () => {now_ms}")

    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(400)
    page.click('.tw[data-tab="sheet"]')
    page.wait_for_timeout(700)

    headers = page.eval_on_selector_all("#sheet-wrap th", "els => els.map(e=>e.textContent)")
    # headers[0] is the bulk-select checkbox column's blank header (see
    # the bulk-delete addition to renderSheet() -- a real report of
    # hundreds of dummy/test rows needing deletion made the old one-row-
    # at-a-time Delete button impractical).
    record("acell", "Sheet table has the requested columns in order (Agent Code, Created, Last Updated; no HP or SAN)",
           headers[1:9] == ["Cell", "Handler", "Agent Name", "Agent Code", "Player Name", "Created", "Last Updated", "Online"], str(headers))

    row_texts = page.eval_on_selector_all("#sheet-wrap tbody tr", "els => els.map(e=>e.textContent)")
    record("acell", "Sheet lists every Agent on file plus every Agent-File-only entry as rows",
           len(row_texts) == 4, str(row_texts))
    record("acell", "a row shows the Agent's Cell, Handler, name, Agent Code and player name together",
           "Cell Alpha" in row_texts[0] and "Sam" in row_texts[0]
           and "Owen Castillo" in row_texts[0] and "OWEN-CS12" in row_texts[0] and "Gergo P" in row_texts[0], row_texts[0])
    created = wait_for_condition(lambda: page.evaluate("""() => { const t = document.querySelector('#sheet-wrap tbody tr:nth-child(1) td:nth-child(7)');
        return t && /2026-09-0\\d/.test(t.textContent) ? t.textContent.trim() : null; }"""), timeout_ms=8000)
    expect = page.evaluate("""() => { const d = new Date('2026-09-01T10:05:00Z'), p = n => (n < 10 ? '0' : '') + n;
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }""")
    record("acell", "the Created column shows when each Agent was created", created == expect, f"{created} vs {expect}")
    upd = page.evaluate("() => (document.querySelector('#sheet-wrap tbody tr:nth-child(1) td:nth-child(8)') || {}).textContent")
    expect_upd = page.evaluate("""() => { const d = new Date('2026-09-20T08:30:00Z'), p = n => (n < 10 ? '0' : '') + n;
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }""")
    record("acell", "Last Updated shows the latest save of the Agent's sheet or Agent File", (upd or "").strip() == expect_upd, f"{upd} vs {expect_upd}")
    record("acell", "an Agent File-only entry (no character sheet) shows as its own row in the same table",
           any("Mastery" in t for t in row_texts), str(row_texts))

    # KIA: a live read of last-saved HP, not a separate flag. Marcus is
    # at 0 HP and should carry the badge; Owen/Priya (13, 9 HP) should not.
    record("acell", "an Agent at 0 HP shows a KIA badge in the Sheet row",
           "KIA" in row_texts[2], row_texts[2])
    record("acell", "an Agent above 0 HP does not show a KIA badge",
           "KIA" not in row_texts[0] and "KIA" not in row_texts[1], "")
    code_cells = page.eval_on_selector_all("#sheet-wrap tbody tr:nth-child(3) td:nth-child(5)", "els => els.map(e=>e.textContent.trim())")
    record("acell", "the Agent Code column shows the row's code", code_cells == ["MARC-9XQ2"], str(code_cells))

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
    record("acell", "the deleted Agent's row disappears once the delete succeeds",
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
    record("acell", "the deleted Agent-File-only row disappears once the delete succeeds",
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
    Radio. Setting a channel + track URL, pausing/resuming, restarting,
    looping, and stopping now all write STRAIGHT to radio/{channel} via
    a client-side Firestore transaction (see startNowPlayingListener_/
    setNowPlaying/sendTransportAction_/sendLoopToggle_ in a-cell.html) --
    no Apps Script POST or GET read-back involved at all anymore, same
    architecture as the Active Sounds panel (test_acell_soundboard).
    Cue For Cell also writes straight to cells/{cellId} now (a plain
    merge, not a transaction) -- only the Cue List (get_playlist/
    save_playlist) and the Cell list itself (list_cells) are still
    Apps-Script-mediated on this tab, exercised here unchanged. This had
    NO coverage at all against the new architecture before now: nothing
    had exercised startNowPlayingListener_'s own onSnapshot actually
    driving the panel's UI (on-air indicator, Pause/Resume label) off a
    pushed snapshot, the same way it does in production -- a plain
    write-then-read-back assertion wouldn't have caught a broken
    listener wire-up at all."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    # Track Library uploads go straight to Firebase Storage (Phase 4),
    # then straight to Firestore for the {title, url} doc itself (see
    # a-cell.html's startTracksListener()'s own comment) -- no Apps
    # Script involved in a track's write path at all anymore, reads
    # included. install_notes_firestore_stub gives both the Storage mock
    # and the tracks/{trackId} AND radio/{channel} onSnapshot/set/
    # runTransaction surface this test needs.
    install_notes_firestore_stub(page)
    page.add_init_script("try { sessionStorage.setItem('dg_acell_pw', 'testpw'); } catch (e) {}")
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)

    posts = []
    fake_cells = [{"cell_id": "cell_1", "name": "Cell Alpha", "handler": "Sam", "member_codes": [], "channel": "4"}]

    install_firestore_backend(page, {"cells/cell_1": {k: v for k, v in fake_cells[0].items() if k != "cell_id"}})
    tap_acell_posts(page, lambda body: posts.append(body))

    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.click('.tw[data-tab="music"]')
    page.wait_for_timeout(150)

    def sync_radio(ch):
        """Simulates startNowPlayingListener_'s live radio/{channel}
        listener picking up the doc's current state -- a real Firestore
        write fires the SAME tab's own onSnapshot almost immediately, but
        the stub's runTransaction()/set() don't feed a listener
        automatically (see NOTES_FIRESTORE_STUB's own comment), so any
        assertion driven by the panel's UI (rather than a direct
        get_firestore_doc read) needs this pushed by hand first."""
        wait_for_condition(lambda: any(l.get("isDoc") and l["path"] == "radio/" + ch
                                        for l in page.evaluate("() => window.__dgFirestoreListeners || []")) or None)
        doc = get_firestore_doc(page, "radio/" + ch)
        push_firestore_doc_snapshot(page, "radio/" + ch, doc is not None, doc)

    # startTracksListener() shows "Loading..." until the first snapshot
    # (even an empty one) actually arrives -- deliver it now, same as
    # every other Firestore-backed listener's tests do.
    wait_for_condition(lambda: any(l["path"] == "tracks" for l in page.evaluate("() => window.__dgFirestoreListeners || []")), timeout_ms=8000)
    push_firestore_snapshot(page, "tracks", [], [])

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
    doc = wait_for_condition(lambda: get_firestore_doc(page, "radio/2") or None)
    record("acell", "Set Now Playing writes the dialed channel, track URL, and title straight to radio/{channel}",
           doc.get("channel") == "2" and doc.get("track_url") == "https://youtube.com/watch?v=dQw4w9WgXcQ"
           and doc.get("track_title") == "Table Theme", str(doc))
    record("acell", "Set Now Playing sends no Apps Script POST at all",
           not any(pp.get("action") == "set_now_playing" for pp in posts), str(posts))
    record("acell", "status line confirms broadcasting once the write resolves",
           "CH 2" in page.inner_text("#music-status") and "Table Theme" in page.inner_text("#music-status"), page.inner_text("#music-status"))
    record("acell", "the dialed channel is remembered for next time",
           page.evaluate("() => localStorage.getItem('dg_acell_broadcast_channel')") == "2", "")
    record("acell", "Set Now Playing defaults to loop off when the checkbox is unchecked",
           doc.get("loop") is False, str(doc))

    # `current` (and the on-air indicator, which only startNowPlayingListener_
    # itself sets) is only kept in sync by the live listener -- push the
    # write's own result back through it now, same as production's own
    # near-instant local-write echo.
    sync_radio("2")
    record("acell", "the on-air indicator shows On Air once the live listener confirms it",
           wait_for_condition(lambda: page.inner_text("#music-air-indicator").strip().lower() == "on air" or None), "")

    # Pause/Resume: freezes the current track in place for everyone tuned
    # in without restarting it from 0:00, unlike a fresh Set Now Playing.
    # sendTransportAction_ decides pause-vs-resume off `current.paused`,
    # so each click below only sends the action it should because the
    # prior sync_radio() call already brought `current` up to date --
    # without it, a second click here would re-send the SAME action.
    page.click("#music-pause-btn")
    paused_doc = wait_for_condition(lambda: (get_firestore_doc(page, "radio/2") or {})
                                     if (get_firestore_doc(page, "radio/2") or {}).get("paused") else None)
    record("acell", "Pause writes paused:true directly to radio/{channel} via a transaction",
           bool(paused_doc), str(paused_doc))
    record("acell", "no pause_now_playing Apps Script POST was sent either",
           not any(pp.get("action") == "pause_now_playing" for pp in posts), str(posts))
    sync_radio("2")
    record("acell", "status line confirms Paused once the write resolves",
           "Paused" in page.inner_text("#music-status"), page.inner_text("#music-status"))
    # An icon-only SVG button now (no visible text) -- Pause/Resume state
    # is reflected in its title/aria-label instead, see syncTransportUI_.
    record("acell", "the Pause button flips to Resume once the live listener confirms it's paused",
           wait_for_condition(lambda: page.get_attribute("#music-pause-btn", "title") == "Resume" or None), "")

    started_before = paused_doc["started_at"]
    page.click("#music-pause-btn")
    resumed_doc = wait_for_condition(lambda: (get_firestore_doc(page, "radio/2") or {})
                                      if not (get_firestore_doc(page, "radio/2") or {}).get("paused") else None)
    record("acell", "clicking the same button again (now labeled Resume) shifts started_at forward instead of resetting position",
           bool(resumed_doc) and resumed_doc["started_at"] >= started_before, str(resumed_doc))
    sync_radio("2")
    record("acell", "the button flips back to Pause once resumed",
           wait_for_condition(lambda: page.get_attribute("#music-pause-btn", "title") == "Pause" or None), "")

    # Restart: re-broadcasts the currently confirmed track from 0:00 even
    # with the form fields cleared -- it works off the last known
    # now-playing state (`current`, kept in sync by the live listener via
    # the sync_radio() call above), not whatever happens to be typed in
    # the boxes.
    page.fill("#music-url-input", "")
    page.fill("#music-title-input", "")
    page.click("#music-restart-btn")
    restart_writes = wait_for_condition(lambda: [w for w in firestore_writes(page, "radio/2")
                                                  if w["data"].get("track_url") == "https://youtube.com/watch?v=dQw4w9WgXcQ"] or None)
    record("acell", "Restart re-broadcasts the currently playing track with the form fields cleared",
           len(restart_writes) == 2, str(restart_writes))

    # Loop: checked before Set Now Playing writes loop: true. (Doesn't
    # depend on `current` -- reads the checkbox/inputs directly -- so no
    # sync_radio() needed before this click.)
    page.check("#music-loop-input")
    page.fill("#music-url-input", "https://youtube.com/watch?v=anotherid1234")
    page.fill("#music-title-input", "Looping Ambience")
    page.click("#music-set-btn")
    loop_doc = wait_for_condition(lambda: (get_firestore_doc(page, "radio/2") or {})
                                   if (get_firestore_doc(page, "radio/2") or {}).get("track_url") == "https://youtube.com/watch?v=anotherid1234" else None)
    record("acell", "checking Loop before Set Now Playing writes loop: true",
           bool(loop_doc) and loop_doc.get("loop") is True, str(loop_doc))
    page.uncheck("#music-loop-input")

    page.click("#music-stop-btn")
    stop_doc = wait_for_condition(lambda: (get_firestore_doc(page, "radio/2") or {})
                                   if (get_firestore_doc(page, "radio/2") or {}).get("track_url") == "" else None)
    record("acell", "Stop writes an empty track_url for the same channel directly",
           bool(stop_doc) and stop_doc.get("channel") == "2", str(stop_doc))
    record("acell", "status line confirms broadcasting stopped",
           "Stopped" in page.inner_text("#music-status"), "")
    sync_radio("2")
    record("acell", "the on-air indicator drops back to Off Air once stopped",
           wait_for_condition(lambda: page.inner_text("#music-air-indicator").strip().lower() == "off air" or None), "")

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
    assign_write = next((w for w in firestore_writes(page, "cells/") if w["path"] == "cells/cell_1"), None)
    record("acell", "Assign CH to Cell writes the new channel straight to cells/{cellId}",
           bool(assign_write) and assign_write["data"].get("channel") == "5",
           str(assign_write))
    record("acell", "the note confirms the assignment once the write's own Promise resolves",
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
    upload_write = wait_for_condition(lambda: (firestore_writes(page, "tracks/") or [None])[-1])
    record("acell", "uploading a track writes straight to Firestore (tracks/{trackId}), no Apps Script involved",
           bool(upload_write) and upload_write["op"] == "set" and upload_write["data"].get("title") == "Rain Loop",
           str(upload_write))
    os.unlink(oversized_mp3_path)
    track_id = upload_write["path"].split("/")[-1]

    upload_posts = [p_ for p_ in posts if p_.get("action") == "upload_track"]
    record("acell", "no legacy upload_track Apps Script POST is sent anymore",
           len(upload_posts) == 0, str(posts))

    # onSnapshot picking up that write is simulated here (same as every
    # other Firestore-backed surface's tests) -- push the live listener a
    # snapshot containing the just-uploaded track.
    push_firestore_snapshot(page, "tracks", [], [{
        "id": track_id, "title": "Rain Loop",
        "url": upload_write["data"].get("url"), "uploaded_at": upload_write["data"].get("uploaded_at"),
    }])
    tracklib_text = wait_for_condition(lambda: page.inner_text("#tracklib-list")
                                       if "Rain Loop" in page.inner_text("#tracklib-list") else None)
    record("acell", "once the listener delivers the write, the track appears in the library",
           bool(tracklib_text) and "Rain Loop" in tracklib_text, page.inner_text("#tracklib-status"))

    # Playing a library track sets track_kind: 'audio' -- a Drive
    # download link has no .mp3 extension, so the player widget needs
    # this explicit flag rather than sniffing the URL. Checked directly
    # against the Firestore doc (radio/5 -- the Cue For Cell assignment
    # above left the dial there), not the UI: an 'audio'-kind snapshot
    # would drive a real preview <audio> element, which this test has no
    # need to exercise (see test_table_radio_widget for actual playback).
    page.click('[data-tracklib-play="0"]')
    play_status = wait_for_condition(lambda: page.inner_text("#music-status")
                                      if "Rain Loop" in page.inner_text("#music-status") else None)
    record("acell", "Play on a library track broadcasts it to the current channel",
           bool(play_status) and "Rain Loop" in play_status, play_status or "")
    doc5 = wait_for_condition(lambda: (get_firestore_doc(page, "radio/5") or {})
                               if (get_firestore_doc(page, "radio/5") or {}).get("track_kind") == "audio" else None)
    record("acell", "playing a library track writes track_kind: 'audio' so the player doesn't have to guess from the URL",
           bool(doc5), str(doc5))
    record("acell", "Play on a library track defaults to loop off",
           bool(doc5) and doc5.get("loop") is False, str(doc5))

    # Regression test: looping an uploaded track technically worked
    # before this (Play already read the shared #music-loop-input
    # checkbox), but that checkbox lives in section 03's paste-a-URL
    # flow, nowhere near this list's own Play button -- a per-row
    # checkbox here is what a Handler would actually expect to find.
    page.check('[data-tracklib-loop="0"]')
    page.click('[data-tracklib-play="0"]')
    looped_doc5 = wait_for_condition(lambda: (get_firestore_doc(page, "radio/5") or {})
                                      if (get_firestore_doc(page, "radio/5") or {}).get("loop") is True else None)
    record("acell", "checking a library track's own Loop box before Play writes loop: true",
           bool(looped_doc5), str(looped_doc5))

    # Rename: live report -- "Abyss" (an upload interrupted before its
    # Firestore doc write, recovered by syncOrphanedStorageTracks_()'s
    # orphan-sync path with no way to know its real title) stayed stuck
    # under an unreadable generated name (its raw Storage filename)
    # indefinitely, because the Track Library had no rename control at
    # all. Uses an inline input + Save, not window.prompt() (already
    # known dead entirely in an installed standalone iOS PWA).
    page.click('[data-tracklib-rename="0"]')
    page.fill("#tracklib-rename-input", "Abyss")
    page.click("#tracklib-rename-save")
    renamed_doc = wait_for_condition(lambda: (get_firestore_doc(page, "tracks/" + track_id) or {})
                                      if (get_firestore_doc(page, "tracks/" + track_id) or {}).get("title") == "Abyss" else None)
    record("acell", "Rename writes the new title straight to tracks/{trackId}, no Apps Script POST",
           bool(renamed_doc), str(renamed_doc))
    push_firestore_snapshot(page, "tracks", [], [dict(get_firestore_doc(page, "tracks/" + track_id) or {}, id=track_id)])
    record("acell", "the renamed title shows in the Track Library once the listener delivers it",
           wait_for_condition(lambda: "Abyss" in page.inner_text("#tracklib-list") or None), page.inner_text("#tracklib-list"))

    # Delete: dismiss then accept.
    page.once("dialog", lambda d: d.dismiss())
    page.click('[data-tracklib-delete="0"]')
    page.wait_for_timeout(300)
    record("acell", "dismissing the Delete confirm leaves the track in place",
           page.locator(".rdo-track-row").count() == 1, "")

    page.once("dialog", lambda d: d.accept())
    page.click('[data-tracklib-delete="0"]')
    delete_write = wait_for_condition(lambda: next((w for w in firestore_writes(page, "tracks/") if w["op"] == "delete"), None))
    record("acell", "accepting Delete writes a Firestore delete for that track, no Apps Script POST",
           bool(delete_write) and delete_write["path"] == "tracks/" + track_id, str(delete_write))
    delete_posts = [p_ for p_ in posts if p_.get("action") == "delete_track"]
    record("acell", "no legacy delete_track Apps Script POST is sent anymore",
           len(delete_posts) == 0, str(posts))

    push_firestore_snapshot(page, "tracks", [], [])
    wait_for_condition(lambda: "No tracks uploaded yet" in page.inner_text("#tracklib-list"))
    record("acell", "once the listener delivers the deletion, the track is gone from the library",
           "No tracks uploaded yet" in page.inner_text("#tracklib-list"), "")

    page.close()
    return errs

def test_acell_music_scrubber_follows_broadcast(p):
    """Reported 2026-10-27 (iPhone): music playing at the table, A-Cell's
    Music scrubber stuck at 0:00. It only followed this tab's own preview
    <audio>, which on a phone often never starts (iOS needs a tap to make
    sound; it's muted besides). Now, while that element isn't playing,
    the scrubber reads the broadcast's position off its clock."""
    import io, wave, time as _t
    buf = io.BytesIO()
    w = wave.open(buf, "wb"); w.setnchannels(1); w.setsampwidth(1); w.setframerate(8000)
    w.writeframes(b"\x80" * 8000 * 120); w.close()
    wav = buf.getvalue()
    page = p.new_page(viewport={"width": 390, "height": 844})
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    _block_fonts(page)
    skip_acell_gate(page)
    install_notes_firestore_stub(page)
    # The phone: the preview element is never allowed to start.
    page.add_init_script("HTMLMediaElement.prototype.play = function () { return Promise.reject(new DOMException('blocked', 'NotAllowedError')); };")
    page.route("**/dgtest-silence.wav", lambda r: r.fulfill(status=200, body=wav, headers={"Content-Type": "audio/wav", "Accept-Ranges": "bytes"}))
    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.evaluate("() => window.dgAcm.go('music')")  # v3.13.0: on a phone, More → Music
    wait_for_condition(lambda: any(l.get("isDoc") and l["path"] == "radio/1" for l in page.evaluate("() => window.__dgFirestoreListeners || []")) or None, timeout_ms=8000)
    now = int(_t.time() * 1000)
    push_firestore_doc_snapshot(page, "radio/1", True, {"channel": "1", "track_url": f"{BASE}/dgtest-silence.wav", "track_title": "Lowell Road",
                                                        "track_kind": "audio", "loop": False, "paused": False, "started_at": now - 30000, "paused_at": 0})
    page.wait_for_timeout(2500)
    a = page.evaluate("() => [parseFloat(document.getElementById('music-preview-slider').value), document.getElementById('music-preview-elapsed').textContent, document.getElementById('music-preview-duration') ? document.getElementById('music-preview-duration').textContent : '']")
    page.wait_for_timeout(2100)
    b = page.evaluate("() => parseFloat(document.getElementById('music-preview-slider').value)")
    record("acell", "Music: with the preview unable to play (a phone), the scrubber still shows the broadcast's position and moves",
           30 <= a[0] <= 36 and a[1] in ("0:30", "0:31", "0:32", "0:33", "0:34", "0:35", "0:36") and b >= a[0] + 1.5, f"{a} -> {b}")
    record("acell", "Music scrubber: no JS exceptions", len(errs) == 0, "; ".join(errs[:3]))
    page.close()
    return errs

def test_acell_music_broadcast_error_not_clobbered(p):
    """Live report: a legacy Google-Drive-hosted track (Combat/The
    Conspiracy/The Schism/Phantom) had gone permanently unplayable --
    confirmed directly against the real Firestore data and the actual
    Drive API response ("API key expired. Please renew the API key.") --
    yet the Handler's own Music tab showed a confident "Currently
    broadcasting" with a live Pause icon and no error anywhere. The
    preview <audio>'s own 'error' listener (added for an earlier,
    similar-looking "frozen playback" bug -- see BUGFIXES.md) DOES fire
    and DOES set #music-status to "Playback failed...". The bug was that
    startNowPlayingListener_'s onSnapshot callback unconditionally
    overwrote that same element with "Currently broadcasting..." on
    EVERY write to the channel's radio/{ch} doc, including ones totally
    unrelated to the track itself (an ambient layer toggle, a stinger, a
    volume drag) -- and that doc gets touched constantly during real
    play, so the real error was visible for at most a moment before
    being silently re-hidden. previewAudioBroken is what fixes this."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    install_notes_firestore_stub(page)
    page.add_init_script("try { sessionStorage.setItem('dg_acell_pw', 'testpw'); } catch (e) {}")
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    # Simulates the real failure mode confirmed live: a request for the
    # track's own URL comes back as an error instead of audio bytes
    # (there, an expired Drive API key's HTTP 400; here, a generic
    # abort) -- either way the <audio> element's own 'error' event fires.
    page.route("**/broken-track.mp3", lambda r: r.abort())
    skip_acell_gate(page)

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            if "action=get_playlist" in url:
                res = {"status": "OK", "playlist": []}
            elif "action=list_cells" in url:
                res = {"status": "OK", "cells": []}
            else:
                res = {"status": "OK"}
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", fake_apps_script)

    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.click('.tw[data-tab="music"]')
    page.wait_for_timeout(150)
    wait_for_condition(lambda: any(l["path"] == "tracks" for l in page.evaluate("() => window.__dgFirestoreListeners || []")), timeout_ms=8000)
    push_firestore_snapshot(page, "tracks", [], [])

    page.fill("#music-url-input", "https://example.com/broken-track.mp3")
    page.fill("#music-title-input", "Old Broadcast")
    page.click("#music-set-btn")
    wait_for_condition(lambda: get_firestore_doc(page, "radio/1") or None)

    def sync_radio():
        doc = get_firestore_doc(page, "radio/1")
        push_firestore_doc_snapshot(page, "radio/1", doc is not None, doc)

    sync_radio()
    record("acell", "an unreachable track's 'error' event surfaces a failure message",
           wait_for_condition(lambda: "Playback failed" in page.inner_text("#music-status") or None, timeout_ms=6000) is not None,
           page.inner_text("#music-status"))

    # An UNRELATED write to the same doc -- an ambient layer toggle here,
    # a stinger or a volume drag in production -- is exactly what
    # startNowPlayingListener_'s onSnapshot fires on. Before the fix, this
    # re-ran the unconditional "Currently broadcasting" line and silently
    # erased the real error underneath it.
    doc = get_firestore_doc(page, "radio/1")
    doc["ambient_layers"] = [{"id": "amb1", "started_at": 111, "paused": False, "paused_at": 0, "loop": True}]
    push_firestore_doc_snapshot(page, "radio/1", True, doc)
    page.wait_for_timeout(200)
    record("acell", "an unrelated write to the same doc does not clobber a real playback failure back to 'Currently broadcasting'",
           "Playback failed" in page.inner_text("#music-status"), page.inner_text("#music-status"))

    page.close()
    return errs

def test_acell_soundboard(p):
    """a-cell.html's Music tab Soundboard: ambient-loop toggle, one-shot
    stinger fire, and the Active Sounds panel's own per-instance
    transport (pause/resume/seek/loop/stop) for an already-active
    loop/stinger. All of these write straight to Firestore (radio/
    {channel}) via a client-side transaction -- no Apps Script POST at
    all, unlike every other Handler write in this file -- see the
    Soundboard header comment in a-cell.html for why (the ~8s latency
    Apps Script's own dispatch/cold-start added was audible). This had
    no test coverage at all before: db.runTransaction() wasn't even
    mocked, so a click on the ambient toggle would have thrown
    "db.runTransaction is not a function" under test the moment anyone
    tried."""
    page = p.new_page()
    # Not actually asserting anything about the soundboard's own latency
    # (no test below measures elapsed time) -- this used to be 8000, which
    # just made every plain UI click on this page share the exact 8s
    # actionability ceiling as a real production latency, so any of the
    # same rare CI-load stalls proven elsewhere in this suite (see
    # wait_post_and_sync's own comment in test_acell_cells) turned into a
    # hard crash here (Page.click: Timeout 8000ms exceeded) instead of
    # just taking a bit longer, live report: run 35118177417. A generic
    # default belongs here; nothing in this test relies on 8s specifically.
    page.set_default_timeout(30000)
    errs = collect_errors(page)
    install_notes_firestore_stub(page)
    page.add_init_script("try { sessionStorage.setItem('dg_acell_pw', 'testpw'); } catch (e) {}")
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)

    posts = []
    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            posts.append(json.loads(req.post_data or "{}"))
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            if "action=get_now_playing" in url:
                res = {"status": "NOT_FOUND"}
            elif "action=get_playlist" in url:
                res = {"status": "OK", "playlist": []}
            elif "action=list_cells" in url:
                res = {"status": "OK", "cells": []}
            else:
                res = {"status": "OK"}
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", fake_apps_script)

    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    # a-cell.html's own radio/{channel} listener (startNowPlayingListener_)
    # subscribes unconditionally at load, independent of which tab is
    # active -- but renderAmbientGrid()/renderActiveSounds_() only ever
    # run from INSIDE that listener's callback, so the ambient toggle
    # buttons (including [data-layer="alien-lunch"] below) don't exist in
    # the DOM at all until a first snapshot is delivered. Every real
    # Firestore listener always delivers one almost immediately -- this
    # stub never does on its own, so this test has to seed it itself, the
    # same way every other a-cell.html test seeds its own Firestore state
    # before interacting. Missing this seed is the actual cause of this
    # test's long-reported "click timeout" -- not CI load, not a flake.
    wait_for_condition(lambda: any(l.get("isDoc") and l.get("path") == "radio/1"
                                    for l in page.evaluate("() => window.__dgFirestoreListeners || []")))
    push_firestore_doc_snapshot(page, "radio/1", False)
    page.click('.tw[data-tab="music"]')
    page.wait_for_timeout(150)

    # Ambient toggle: turn a loop on -- straight Firestore write to
    # radio/1 (channel dial defaults to 1), no Apps Script POST.
    page.click('[data-layer="alien-lunch"]')
    wait_for_condition(lambda: get_firestore_doc(page, "radio/1") is not None)
    doc = get_firestore_doc(page, "radio/1")
    layers = (doc or {}).get("ambient_layers", [])
    record("soundboard", "toggling an ambient layer on writes it to radio/{channel} directly",
           any(l.get("id") == "alien-lunch" for l in layers), str(doc))
    record("soundboard", "the ambient toggle sends no Apps Script POST at all",
           len(posts) == 0, str(posts))
    wait_for_condition(lambda: page.locator('[data-layer="alien-lunch"]').get_attribute("class") and
                        "active" in page.locator('[data-layer="alien-lunch"]').get_attribute("class"))
    record("soundboard", "the ambient grid button shows active once the write lands",
           "active" in (page.locator('[data-layer="alien-lunch"]').get_attribute("class") or ""), "")

    # Active Sounds panel should now show a row for it.
    active_row = wait_for_condition(lambda: page.locator(".rdo-active-row").first
                                     if page.locator(".rdo-active-row").count() > 0 else None)
    record("soundboard", "the Active Sounds panel shows a row for the active ambient loop",
           active_row is not None and "Alien Lunch" in page.inner_text(".rdo-active-row"), page.inner_text("#soundboard-active-list"))

    # Pause it from the Active Sounds row.
    page.click('.rdo-active-row [data-action="playpause"]')
    def paused_state():
        d = get_firestore_doc(page, "radio/1")
        l = next((x for x in (d or {}).get("ambient_layers", []) if x.get("id") == "alien-lunch"), None)
        return l if (l and l.get("paused")) else None
    paused_layer = wait_for_condition(paused_state)
    record("soundboard", "pausing an active ambient loop sets paused:true directly in Firestore",
           bool(paused_layer), str(get_firestore_doc(page, "radio/1")))
    record("soundboard", "no Apps Script POST was sent for pause_ambient_layer either",
           not any(pp.get("action") == "pause_ambient_layer" for pp in posts), str(posts))

    # Resume it -- started_at should shift forward by roughly the paused
    # duration (preserving position), not reset to now.
    started_before = paused_layer["started_at"]
    paused_at_before = paused_layer["paused_at"]
    page.click('.rdo-active-row [data-action="playpause"]')
    def resumed_state():
        d = get_firestore_doc(page, "radio/1")
        l = next((x for x in (d or {}).get("ambient_layers", []) if x.get("id") == "alien-lunch"), None)
        return l if (l and not l.get("paused")) else None
    resumed_layer = wait_for_condition(resumed_state)
    record("soundboard", "resuming clears paused and shifts started_at instead of resetting position",
           bool(resumed_layer) and resumed_layer["started_at"] >= started_before and resumed_layer["paused_at"] == 0,
           str(resumed_layer))

    # Loop toggle on the Active Sounds row.
    page.click('.rdo-active-row [data-action="loop"]')
    def loop_off():
        d = get_firestore_doc(page, "radio/1")
        l = next((x for x in (d or {}).get("ambient_layers", []) if x.get("id") == "alien-lunch"), None)
        return l if (l and l.get("loop") is False) else None
    unlooped = wait_for_condition(loop_off)
    record("soundboard", "toggling Loop off on the Active Sounds row writes loop:false directly",
           bool(unlooped), str(get_firestore_doc(page, "radio/1")))

    # Stop it -- same write path the grid's own toggle-off button uses,
    # not a separate one for the identical "turn this loop off" action.
    page.click('.rdo-active-row [data-action="stop"]')
    def layer_gone():
        d = get_firestore_doc(page, "radio/1")
        return d if (d and not any(x.get("id") == "alien-lunch" for x in d.get("ambient_layers", []))) else None
    stopped_doc = wait_for_condition(layer_gone)
    record("soundboard", "Stop on an ambient row removes it from ambient_layers via the same path as the grid toggle",
           stopped_doc is not None, str(stopped_doc))
    record("soundboard", "the ambient grid button drops back to inactive once the row is stopped",
           "active" not in (page.locator('[data-layer="alien-lunch"]').get_attribute("class") or ""), "")

    # Stinger: fire one, then pause/seek/loop/stop it the same way.
    page.click('[data-stinger="scream-01"]')
    wait_for_condition(lambda: len((get_firestore_doc(page, "radio/1") or {}).get("stingers", [])) > 0)
    stingers = (get_firestore_doc(page, "radio/1") or {}).get("stingers", [])
    record("soundboard", "firing a stinger appends it to radio/{channel}'s stingers array directly",
           any(s.get("id") == "scream-01" for s in stingers), str(stingers))
    record("soundboard", "firing a stinger sends no Apps Script POST either",
           not any(pp.get("action") == "trigger_stinger" for pp in posts), str(posts))

    stinger_row = wait_for_condition(lambda: page.locator(".rdo-active-row", has_text="Scream 01")
                                      if page.locator(".rdo-active-row", has_text="Scream 01").count() > 0 else None)
    record("soundboard", "the fired stinger shows its own Active Sounds row",
           stinger_row is not None, page.inner_text("#soundboard-active-list"))

    page.locator(".rdo-active-row", has_text="Scream 01").locator('[data-action="playpause"]').click()
    def stinger_paused():
        d = get_firestore_doc(page, "radio/1")
        s = next((x for x in (d or {}).get("stingers", []) if x.get("id") == "scream-01"), None)
        return s if (s and s.get("paused")) else None
    record("soundboard", "pausing an active stinger sets paused:true directly, matched by its fired_at identity",
           bool(wait_for_condition(stinger_paused)), str(get_firestore_doc(page, "radio/1")))

    page.locator(".rdo-active-row", has_text="Scream 01").locator('[data-action="stop"]').click()
    def stinger_gone():
        d = get_firestore_doc(page, "radio/1")
        return d if (d and not any(x.get("id") == "scream-01" for x in d.get("stingers", []))) else None
    record("soundboard", "Stop on a stinger row removes it entirely (no on/off toggle the way ambient has)",
           wait_for_condition(stinger_gone) is not None, "")
    record("soundboard", "...and lists it in stinger_stops, so players cut it at once (a tidy-up lets it play out)",
           len((get_firestore_doc(page, "radio/1") or {}).get("stinger_stops", [])) == 1, str(get_firestore_doc(page, "radio/1")))

    # GitHub issue #4: "I pressed Scream 03 once, and it plays [visually]
    # again every ~15 seconds, though I could only hear it the first
    # time." Root cause: the Active Sounds row's own 'ended' handler only
    # ever cleaned up LOCAL state, never writing the removal back to
    # Firestore the way Stop does -- so a naturally-finished stinger sat
    # in radio/{channel}'s stingers array forever, and the next unrelated
    # write to that same doc (anything on the Music tab) resurrected its
    # row via the live listener. Fire a fresh one and let it finish on
    # its own (dispatching 'ended' on its own preview <audio>, same as a
    # real short stinger reaching the end of its own runtime) instead of
    # Stop, to cover the path Stop was never exercising.
    page.click('[data-stinger="scream-01"]')
    wait_for_condition(lambda: len((get_firestore_doc(page, "radio/1") or {}).get("stingers", [])) > 0)
    wait_for_condition(lambda: page.locator(".rdo-active-row", has_text="Scream 01").count() > 0)
    page.evaluate("""() => {
        var row = Array.from(document.querySelectorAll('.rdo-active-row')).find(r => r.textContent.includes('Scream 01'));
        var audioEl = row && row.querySelector('audio');
        if (audioEl) audioEl.dispatchEvent(new Event('ended'));
    }""")
    # ...but not straight away: this muted preview ends before players'
    # devices do, and removing it then cut a 2-second whimper off before
    # anyone heard it. It stays on the doc a few seconds, its row gone.
    page.wait_for_timeout(1000)
    still_there = any(x.get("id") == "scream-01" for x in (get_firestore_doc(page, "radio/1") or {}).get("stingers", []))
    record("soundboard", "a stinger that finished in the preview stays on the channel a few seconds for players still playing it",
           still_there, str(get_firestore_doc(page, "radio/1")))
    record("soundboard", "its Active Sounds row goes at once, even though it is still on the doc",
           page.locator(".rdo-active-row", has_text="Scream 01").count() == 0, "")
    def stinger_gone_after_natural_end():
        d = get_firestore_doc(page, "radio/1")
        return d if (d and not any(x.get("id") == "scream-01" for x in d.get("stingers", []))) else None
    record("soundboard", "a stinger finishing naturally also removes it from Firestore, not just local state",
           wait_for_condition(stinger_gone_after_natural_end) is not None, str(get_firestore_doc(page, "radio/1")))

    page.close()
    return errs

def test_acell_music_backend_not_deployed(p):
    """Bug report, revisited for the direct-Firestore architecture: the
    Music tab used to say "Broadcasting" while the player widget said
    "Waiting for the Handler", because the old set_now_playing was a
    no-cors POST -- fetch() resolved "successfully" even when the Apps
    Script addition wasn't deployed, and only a separate GET read-back
    could ever catch that the write hadn't actually landed. setNowPlaying()
    writes straight to Firestore via a real Promise now (see
    a-cell.html), so the equivalent failure mode is that Promise
    rejecting -- exercised here by deliberately never seeding a Handler
    session (dg_acell_pw), which makes ensureHandlerSignedIn() reject
    immediately with "No A-Cell session...". The status line must report
    that honestly instead of claiming success."""
    page = p.new_page()
    page.set_default_timeout(30000)
    errs = collect_errors(page)
    install_notes_firestore_stub(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)
    # Deliberately NOT seeding dg_acell_pw -- ensureHandlerSignedIn()
    # rejects the moment anything tries to write, simulating a write that
    # never reaches Firestore at all. get_playlist/list_cells still fire
    # on tab load regardless, so route_apps_script_ok keeps those quiet.
    route_apps_script_ok(page)

    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.click('.tw[data-tab="music"]')
    page.wait_for_timeout(150)
    page.fill("#music-url-input", "https://youtube.com/watch?v=dQw4w9WgXcQ")
    page.click("#music-set-btn")

    status = wait_for_condition(lambda: page.inner_text("#music-status")
                                 if ("Broadcasting" in page.inner_text("#music-status")
                                     or "Could not reach" in page.inner_text("#music-status")) else None)
    record("acell", "a write that never reaches Firestore (not signed in as Handler) is reported honestly, not as a false 'Broadcasting' success",
           bool(status) and "Broadcasting" not in status and "Could not reach" in status, status or page.inner_text("#music-status"))

    page.close()
    return errs


def test_table_radio_widget(p):
    """assets/table-radio.js: a small persistent widget on every Hub
    page, so a player stays "tuned in" to the Handler's music channel
    (via a live Firestore radio/{channel} onSnapshot listener, Firebase
    migration Phase 2) as they move between pages -- each full page
    load is a fresh document, so continuity comes from remembering the
    channel (localStorage) and re-subscribing on every page, not from
    one <audio> element surviving navigation. Firestore itself is faked
    via install_radio_firestore_stub()/push_radio_now_playing() (see
    their definitions) rather than hit the real project. A YouTube
    track is driven through the real YouTube IFrame Player API now (for
    volume control -- the plain embed URL has no volume param), so this
    test fakes that API rather than hitting the real youtube.com --
    nothing here should depend on real network access."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.add_init_script("try { sessionStorage.setItem('dg_boot_seen', '1'); } catch (e) {}")
    install_radio_firestore_stub(page)

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps({"status": "OK"})})')
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
    notebook_aside(page)
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
    page.wait_for_timeout(200)
    push_radio_now_playing(page, "3", {
        "channel": "3", "track_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "track_title": "Table Theme", "started_at": 1700000000000,
    })
    page.wait_for_timeout(400)
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
    notebook_aside(page)
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

def test_table_radio_transient_miss_no_flicker(p):
    """Regression (predates the Firestore cutover, still applies to it):
    a transient miss reading the Handler's now-playing state must never
    flicker a live broadcast to "Waiting for the Handler" and back --
    under the old Apps Script poll loop this meant tolerating a
    malformed intermediate response; under the live Firestore
    radio/{channel} onSnapshot listener (Firebase migration Phase 2) the
    equivalent failure mode is a transient listener error (network
    hiccup, Firestore's own client reconnecting, etc.) -- see
    table-radio.js's onSnapshot error callback, which only logs and
    deliberately never touches on-screen state. Confirms that directly:
    a real snapshot lands, a listener error follows, the last-known
    track must survive it untouched, then a fresh good snapshot must
    still land correctly afterward."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.add_init_script("try { sessionStorage.setItem('dg_boot_seen', '1'); } catch (e) {}")
    install_radio_firestore_stub(page)

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps({"status": "OK"})})')
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", fake_apps_script)
    page.route("**/uc?export=download*", lambda r: r.fulfill(status=200, content_type="audio/mpeg", body=""))

    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    notebook_aside(page)
    page.evaluate("() => localStorage.setItem('dg_radio_channel', '3')")
    page.reload(wait_until="domcontentloaded")
    notebook_aside(page)
    page.wait_for_timeout(300)
    push_radio_now_playing(page, "3", {
        "channel": "3", "track_url": "https://drive.google.com/uc?export=download&id=fakeFileId123",
        "track_title": "Rain Loop", "started_at": 1700000000000, "track_kind": "audio",
    })
    page.wait_for_timeout(400)
    # Checked via window._dgRadioLast (handleNowPlaying()'s own record
    # of the last real track it saw) rather than the visible
    # status/track text -- this fake audio: URL can't actually decode
    # in a real browser, so the widget's own (unrelated) playback-error
    # handling overwrites the status line regardless of listener
    # behavior. _dgRadioLast is untouched by that and directly reflects
    # whether the listener itself reset track state, which is the
    # actual thing under test here.
    record("radio", "the first (real) snapshot records the track as the last known state",
           page.evaluate("() => window._dgRadioLast && window._dgRadioLast.track_title") == "Rain Loop", "")

    push_radio_listener_error(page, "3")
    page.wait_for_timeout(300)
    record("radio", "a transient listener error mid-broadcast does not clear the last-known track (no flicker to 'nothing playing')",
           page.evaluate("() => window._dgRadioLast && window._dgRadioLast.track_title") == "Rain Loop", "")
    record("radio", "the status/track text also never flipped to the 'nothing playing' strings",
           "Waiting for the Handler" not in page.inner_text("#dg-radio-status")
           and "No signal yet" not in page.inner_text("#dg-radio-track"), page.inner_text("#dg-radio-status"))

    # Recovery: a fresh good snapshot (a new started_at, as a real re-cue
    # would carry) lands and is actually applied -- proves the listener
    # error didn't leave the subscription itself in some stuck state,
    # not just that old data survived untouched.
    push_radio_now_playing(page, "3", {
        "channel": "3", "track_url": "https://drive.google.com/uc?export=download&id=fakeFileId123",
        "track_title": "Rain Loop (recue)", "started_at": 1700000099000, "track_kind": "audio",
    })
    page.wait_for_timeout(300)
    record("radio", "a fresh snapshot after the listener error is actually applied (new started_at picked up)",
           page.evaluate("() => window._dgRadioLast && window._dgRadioLast.track_title") == "Rain Loop (recue)", "")

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
    install_radio_firestore_stub(page)

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps({"status": "OK"})})')
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", fake_apps_script)
    # The <audio> element will try to actually fetch the mp3 -- fake a
    # tiny response so it doesn't hang on a real network request.
    page.route("**/ambience.mp3", lambda r: r.fulfill(status=200, content_type="audio/mpeg", body=""))

    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    notebook_aside(page)
    page.evaluate("() => localStorage.setItem('dg_radio_channel', '1')")
    page.reload(wait_until="domcontentloaded", timeout=15000)
    notebook_aside(page)
    page.wait_for_timeout(300)
    push_radio_now_playing(page, "1", {
        "channel": "1", "track_url": "https://example.com/ambience.mp3",
        "track_title": "Rain Loop", "started_at": 1700000000000,
    })
    page.wait_for_timeout(400)

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

def test_table_radio_mix_debug_readout(p):
    """Live report: a Handler set the broadcast-wide Music mix to 0 and
    still heard the track at full volume. The Firestore write and the
    mix arithmetic both checked out fine in isolation, but there was no
    way to see the real, live numbers on the reporter's own device (no
    Mac available for iOS Safari's Web Inspector). This readout puts the
    actual live mix/volume numbers directly on screen instead of
    requiring devtools -- confirms the readout is accurate and reflects
    the real <audio> element's real .volume, not just what the UI
    sliders claim.

    Originally gated behind a ?radiodebug=1 URL flag, persisted via
    localStorage -- but a live report of the flag still not taking
    effect even after a full close-Safari-and-reopen cycle (ruling out
    caching) meant the URL-param mechanism itself was an unverifiable
    point of failure on the reporter's own device. Simplified to
    always-on (see isDebugOn_()'s own comment) -- this test now just
    confirms the readout is present unconditionally and stays accurate."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.add_init_script("try { sessionStorage.setItem('dg_boot_seen', '1'); } catch (e) {}")
    install_radio_firestore_stub(page)
    page.route("**/script.google.com/**", lambda r: r.fulfill(status=200, content_type="application/json", body='{"status":"OK"}'))
    page.route("**/ambience.mp3", lambda r: r.fulfill(status=200, content_type="audio/mpeg", body=""))

    record("radio", "the debug readout is present on a plain load, no query param or prior opt-in needed",
           (lambda: (page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000),
                     page.evaluate("() => localStorage.setItem('dg_radio_channel', '1')"),
                     page.reload(wait_until="domcontentloaded", timeout=15000),
                     notebook_aside(page),
                     page.wait_for_timeout(300))
            and page.query_selector("#dg-radio-debug") is not None)(), "")

    push_radio_now_playing(page, "1", {
        "channel": "1", "track_url": "https://example.com/ambience.mp3",
        "track_title": "The Void", "started_at": 1700000000000, "track_volume": 0, "ambient_volume": 100,
    })
    page.wait_for_timeout(400)
    debug_text = page.inner_text("#dg-radio-debug")
    record("radio", "a channel without its own effects level: effects follow the loops' level", "effects=ambient" in debug_text, debug_text)
    real_volume = page.eval_on_selector("#dg-radio-embed-wrap audio", "el => el.volume")
    record("radio", "the readout's stated mix matches the doc that was actually pushed",
           "mix track=0 ambient=100" in debug_text, debug_text)
    record("radio", "the readout's track.volume figure matches the real <audio> element's real .volume",
           real_volume == 0 and "track.volume=0.00" in debug_text, debug_text + " / real=" + str(real_volume))

    page.click("#dg-radio-mute")
    page.wait_for_timeout(150)
    record("radio", "the readout updates live when Mute is toggled, without needing a fresh snapshot",
           "(el.muted)" not in page.inner_text("#dg-radio-debug"), page.inner_text("#dg-radio-debug"))
    push_radio_now_playing(page, "1", {
        "channel": "1", "track_url": "https://example.com/ambience.mp3",
        "track_title": "The Void", "started_at": 1700000000000, "track_volume": 0, "ambient_volume": 100, "effects_volume": 30,
    })
    page.wait_for_timeout(400)
    record("radio", "effects_volume (2026-10-30): the effects' own level", "effects=30" in page.inner_text("#dg-radio-debug"), page.inner_text("#dg-radio-debug"))

    page.close()
    return errs

def test_table_radio_debug_readout_shows_ambient_and_stinger_state(p):
    """Real blind spot found from a live report of "no volume control is
    working, on any channel": ambientAudioEls/stingerAudioEls are
    appended straight to document.body (see applyAmbientLayers_/
    applyStingers_), entirely outside #dg-radio-embed-wrap -- the debug
    readout only ever reported the MAIN TRACK's own element, completely
    blind to an ambient loop or stinger actually playing. Ambient's own
    mix defaults to 100 (full, unreduced) unless a Handler explicitly
    lowers it, so a live ambient loop left running on a channel would be
    exactly as loud as "no volume control works" sounds like, regardless
    of what the Music mix or main track's own volume says. Confirms the
    readout now surfaces ambient layer state (id + real .volume) that it
    previously omitted entirely."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.add_init_script("try { sessionStorage.setItem('dg_boot_seen', '1'); } catch (e) {}")
    install_radio_firestore_stub(page)
    page.route("**/script.google.com/**", lambda r: r.fulfill(status=200, content_type="application/json", body='{"status":"OK"}'))

    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    notebook_aside(page)
    page.click("#dg-radio-pill")
    page.wait_for_timeout(150)
    page.click('.dgr-tick[data-ch="3"]')
    page.wait_for_timeout(150)
    page.click("#dg-radio-confirm-tune")
    page.wait_for_timeout(300)

    record("radio", "no ambient/stinger section shown when nothing is active",
           "ambient x" not in page.inner_text("#dg-radio-debug") and "stinger x" not in page.inner_text("#dg-radio-debug"),
           page.inner_text("#dg-radio-debug"))

    # Music silenced, Ambient left at the default 100 (untouched), with a
    # real ambient loop active -- the exact reported live scenario.
    push_radio_now_playing(page, "3", {
        "channel": "3", "track_url": "", "track_volume": 0, "ambient_volume": 100,
        "ambient_layers": [{"id": "alien-lunch", "started_at": 1700000000000, "paused": False, "paused_at": 0, "loop": True}],
    })
    page.wait_for_timeout(500)
    debug_text = page.inner_text("#dg-radio-debug")
    real_ambient_volume = page.evaluate("() => { var els = document.body.querySelectorAll('audio'); for (var i = 0; i < els.length; i++) { if (els[i].src.indexOf('alien-lunch') !== -1) return els[i].volume; } return null; }")
    record("radio", "the readout now surfaces the active ambient layer's id and its real .volume",
           "ambient x1=alien-lunch:" in debug_text, debug_text)
    record("radio", "the readout's stated ambient volume matches the actual <audio> element's real .volume",
           real_ambient_volume is not None and abs(real_ambient_volume - 0.70) < 0.01
           and ("alien-lunch:" + format(real_ambient_volume, ".2f")) in debug_text,
           debug_text + " / real=" + str(real_ambient_volume))

    page.close()
    return errs

def test_table_radio_short_stinger_plays_from_its_start(p):
    """Live report: "The new creature sound effects cannot be heard at
    all." The whimpers are 2 seconds long, all their sound in the first
    1.5. applyStingers_ seeked a fresh fire to (now - started_at), by the
    Handler's clock, so the snapshot, the file load and any difference
    between the two devices' clocks skipped the whole clip. A fire this
    device watched arrive now plays from its start."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.add_init_script("try { sessionStorage.setItem('dg_boot_seen', '1'); } catch (e) {}")
    # The test server can't serve byte ranges, so Chromium can't actually
    # seek an MP3 here (it plays from 0 whatever is asked): record the
    # position the radio asks for instead.
    page.add_init_script("""(() => { var d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
        Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { configurable: true, get: d.get,
            set: function (v) { this.__dgAsked = v; d.set.call(this, v); } }); })()""")
    install_radio_firestore_stub(page)
    page.route("**/script.google.com/**", lambda r: r.fulfill(status=200, content_type="application/json", body='{"status":"OK"}'))
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    notebook_aside(page)
    page.click("#dg-radio-pill")
    page.wait_for_timeout(150)
    page.click('.dgr-tick[data-ch="3"]')
    page.wait_for_timeout(150)
    page.click("#dg-radio-confirm-tune")
    page.wait_for_timeout(300)
    push_radio_now_playing(page, "3", {"channel": "3", "track_url": "", "stingers": []})
    page.wait_for_timeout(300)
    # Fired by a Handler whose clock reads 3 seconds behind this one.
    fired = page.evaluate("() => Date.now() - 3000")
    push_radio_now_playing(page, "3", {"channel": "3", "track_url": "", "stingers": [
        {"id": "dog-whimper", "fired_at": fired, "started_at": fired, "paused": False, "paused_at": 0, "loop": False}]})
    probe = """() => { var a = Array.from(document.querySelectorAll('audio')).find(e => e.src.indexOf('dog-whimper') !== -1);
        return a ? { asked: a.__dgAsked, ready: a.readyState } : null; }"""
    wait_for_condition(lambda: (page.evaluate(probe) or {}).get("ready", 0) >= 1 or None, timeout_ms=5000)
    page.wait_for_timeout(200)
    st = page.evaluate(probe)
    record("radio", "a 2-second stinger fired by a Handler with a skewed clock plays from its start, not skipped past its end",
           st is not None and st["ready"] >= 1 and st.get("asked") is not None and st["asked"] < 1.0, str(st))
    # "Screams also stopped before time": A-Cell tidying a finished
    # preview (or the history trim) took the fire off the doc, and that
    # cut the players' sound. Only the Handler's Stop may.
    has = lambda name: page.evaluate("(n) => Array.from(document.querySelectorAll('audio')).some(e => e.src.indexOf(n) !== -1)", name)
    push_radio_now_playing(page, "3", {"channel": "3", "track_url": "", "stingers": []})
    page.wait_for_timeout(200)
    record("radio", "a playing stinger taken off the doc by tidying up (not Stop) plays to its end",
           has("dog-whimper"), "")
    now = page.evaluate("() => Date.now()")
    push_radio_now_playing(page, "3", {"channel": "3", "track_url": "", "stingers": [
        {"id": "scream-01", "fired_at": now, "started_at": now, "paused": False, "paused_at": 0, "loop": False}]})
    wait_for_condition(lambda: has("scream-01") or None, timeout_ms=4000)
    push_radio_now_playing(page, "3", {"channel": "3", "track_url": "", "stingers": [], "stinger_stops": [now]})
    page.wait_for_timeout(200)
    record("radio", "the Handler's Stop still cuts it at once", not has("scream-01"), "")
    page.close()
    return errs

def test_table_radio_plays_while_audio_context_locked(p):
    """Live, the evening of a session: after the Storage bucket got its
    CORS config, players heard nothing -- tracks showed as playing but
    stalled (Abyss stuck at 1:19), stingers were silent even on A-Cell.
    iOS keeps an AudioContext created before any tap suspended, and every
    element wired into it (main track via CORS, ambient, stingers) plays
    silence. Here the context is held "suspended" until a pointerdown:
    while locked, sounds must play as plain <audio> (no gain node); after
    any tap on the page the next track goes through the gain node again.
    Also: ambient/stinger files resolve next to the script, not against a
    subfolder page (notes/)."""
    lock = """(() => {
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      window.__ctxUnlocked = false;
      document.addEventListener('pointerdown', () => { window.__ctxUnlocked = true; }, true);
      Object.defineProperty(C.prototype, 'state', { configurable: true, get() { return window.__ctxUnlocked ? 'running' : 'suspended'; } });
      C.prototype.resume = function () { return Promise.resolve(); };
    })();"""
    errs = []
    def fresh(path):
        page = p.new_page()
        page.set_default_timeout(8000)
        e = collect_errors(page)
        page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
        page.add_init_script("try { sessionStorage.setItem('dg_boot_seen', '1'); localStorage.setItem('dg_radio_channel', '1'); } catch (e) {}")
        page.add_init_script(lock)
        install_radio_firestore_stub(page)
        page.route("**/script.google.com/**", lambda r: r.fulfill(status=200, content_type="application/json", body='{"status":"OK"}'))
        page.goto(f"{BASE}/{path}", wait_until="domcontentloaded", timeout=15000)
        notebook_aside(page)
        page.wait_for_timeout(400)
        return page, e
    clip = sorted(os.listdir(os.path.join(HERE, "..", "assets", "stingers")))[0]
    track = f"{BASE}/assets/stingers/{clip}"
    page, e = fresh("agent-hub.html"); errs += e
    push_radio_now_playing(page, "1", {"channel": "1", "track_url": track, "track_title": "Abyss", "started_at": 1700000000000,
        "track_volume": 50, "ambient_volume": 100, "track_kind": "audio",
        "ambient_layers": [{"id": "alien-lunch", "started_at": 1700000000000, "paused": False, "paused_at": 0, "loop": True}]})
    _pump_until(page, lambda: "route=" in page.inner_text("#dg-radio-debug"), timeout_ms=6000)
    page.wait_for_timeout(600)
    dbg = page.inner_text("#dg-radio-debug")
    record("radio", "locked audio context: the main track plays as plain <audio>, not into a silent gain node",
           "route=element" in dbg, dbg)
    record("radio", "locked audio context: the ambient layer plays without a gain node too",
           "ambient x1=alien-lunch:" in dbg and "/gain=" not in dbg.split("ambient x1=")[1].split(" | ")[0], dbg)
    page.mouse.click(5, 5)  # any tap on the page unlocks it
    page.wait_for_timeout(200)
    push_radio_now_playing(page, "1", {"channel": "1", "track_url": track + "?next", "track_title": "Schism", "started_at": 1700000005000,
        "track_volume": 50, "ambient_volume": 100, "track_kind": "audio"})
    _pump_until(page, lambda: "route=webaudio" in page.inner_text("#dg-radio-debug"), timeout_ms=6000)
    record("radio", "after any tap on the page, the next track goes through the gain node again (iOS volume works)",
           "route=webaudio" in page.inner_text("#dg-radio-debug"), page.inner_text("#dg-radio-debug"))
    page.close()

    page, e = fresh("notes/index.html"); errs += e
    push_radio_now_playing(page, "1", {"channel": "1", "track_url": "", "track_volume": 0, "ambient_volume": 100,
        "ambient_layers": [{"id": "alien-lunch", "started_at": 1700000000000, "paused": False, "paused_at": 0, "loop": True}]})
    src = None
    for _ in range(30):
        src = page.evaluate("() => { const a = [...document.querySelectorAll('audio')].find(x => /alien-lunch/.test(x.src)); return a ? a.src : null; }")
        if src: break
        page.wait_for_timeout(200)
    record("radio", "on a page in a subfolder (notes/), ambient files load from the site's assets/, not notes/assets/",
           bool(src) and src.startswith(f"{BASE}/assets/ambient/"), str(src))
    page.close()
    return errs

def test_table_radio_new_track_starts_without_a_tap(p):
    """Live, on an iPad in the hub shell: every song change needed the
    player to tap Resume, sound effects never played, and the volume
    slider did nothing. Safari lets an <audio> element start by itself
    only once that same element was played (or loaded) inside a tap, and
    the widget built a fresh element for every track and every stinger.
    Worse, in hub.html the widget sits in the outer page while nearly
    every tap lands inside #dg-shell-content, which the widget never
    heard. Chromium is made to behave the same way here: play() without
    a tap is refused unless the element was unlocked by one, and the
    AudioContext stays suspended until the page has had a tap."""
    # Taps are tracked from real (trusted) input events -- not
    # navigator.userActivation, which Playwright's evaluate() switches on.
    ios = """(() => {
      const top = window.top;
      const mark = (e) => { if (!e.isTrusted) return; top.__inTap = true; top.__tapped = true; setTimeout(() => { top.__inTap = false; }, 0); };
      ['click', 'touchend', 'keydown'].forEach((t) => window.addEventListener(t, mark, true));
      const active = () => !!top.__inTap;
      const realPlay = HTMLMediaElement.prototype.play, realLoad = HTMLMediaElement.prototype.load;
      window.__refused = 0;
      HTMLMediaElement.prototype.load = function () { if (active()) this.__unlocked = true; return realLoad.call(this); };
      HTMLMediaElement.prototype.play = function () {
        if (active()) this.__unlocked = true;
        if (!this.__unlocked) { window.__refused++; return Promise.reject(new DOMException('needs a tap', 'NotAllowedError')); }
        return realPlay.call(this);
      };
      const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
      Object.defineProperty(C.prototype, 'state', { configurable: true, get() {
        return window.top.__tapped ? 'running' : 'suspended'; } });
      C.prototype.resume = function () { return Promise.resolve(); };
    })();"""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.add_init_script("try { sessionStorage.setItem('dg_boot_seen', '1'); localStorage.setItem('dg_radio_channel', '1'); localStorage.setItem('dg_cover_identity', 'Gergo'); } catch (e) {}")
    page.add_init_script(ios)
    install_radio_firestore_stub(page)
    page.goto(f"{BASE}/hub.html", wait_until="domcontentloaded", timeout=15000)
    notebook_aside(page)
    # Content frame loaded and the boot veil gone from where we tap.
    _pump_until(page, lambda: page.evaluate("""() => { try {
        const f = document.getElementById('dg-shell-content'); if (f.contentDocument.readyState !== 'complete') return false;
        const r = f.getBoundingClientRect(); const el = document.elementFromPoint(r.left + 20, r.top + r.height * 0.5);
        return el === f; } catch (e) { return false; } }"""), timeout_ms=12000)
    page.wait_for_timeout(300)
    clips = sorted(os.listdir(os.path.join(HERE, "..", "assets", "stingers")))
    track = f"{BASE}/assets/stingers/{clips[0]}"
    np = {"channel": "1", "track_url": track, "track_title": "Abyss", "started_at": 1700000000000,
          "track_volume": 50, "ambient_volume": 100, "track_kind": "audio", "loop": True}
    push_radio_now_playing(page, "1", np)
    main_state = """() => { const a = document.getElementById('dg-radio-audio'); const r = document.getElementById('dg-radio-resume');
        return a ? { src: a.src, paused: a.paused, resume: !!r && r.style.display === 'block' } : null; }"""
    _pump_until(page, lambda: (page.evaluate(main_state) or {}).get("resume"), timeout_ms=6000)
    before = page.evaluate(main_state)
    record("radio", "before any tap (iOS-like), a new track is refused and Resume shows",
           bool(before) and before["paused"] and before["resume"], str(before))

    # One tap inside the shell's content frame -- not on the radio.
    page.evaluate("""() => { const d = document.getElementById('dg-shell-content').contentDocument;
        const t = d.createElement('div'); t.id = 'tap-target';
        t.style.cssText = 'position:fixed;left:8px;top:45%;width:40px;height:40px;z-index:2147483647;background:transparent';
        d.body.appendChild(t); }""")
    page.frame_locator("#dg-shell-content").locator("#tap-target").click()
    # play() flips .paused at once; Resume hides when its promise resolves
    # and the gain node is wired a tick later -- wait for all three.
    def settled():
        st = page.evaluate(main_state) or {"paused": True, "resume": True}
        return not st["paused"] and not st["resume"] and "route=webaudio" in page.inner_text("#dg-radio-debug")
    _pump_until(page, settled, timeout_ms=6000)
    after = page.evaluate(main_state)
    dbg = page.inner_text("#dg-radio-debug")
    record("radio", "a tap anywhere in the shell's content frame starts the refused track and hides Resume",
           bool(after) and not after["paused"] and not after["resume"], str(after))
    record("radio", "the same tap wires the already-playing track into the gain node (volume works mid-track)",
           "route=webaudio" in dbg, dbg)

    refused = page.evaluate("() => window.__refused")
    np2 = dict(np, track_url=track + "?schism", track_title="Schism", started_at=1700000009000)
    push_radio_now_playing(page, "1", np2)
    _pump_until(page, lambda: (page.evaluate(main_state) or {}).get("src", "").endswith("?schism")
                and not page.evaluate(main_state)["paused"], timeout_ms=6000)
    s2 = page.evaluate(main_state)
    record("radio", "the Handler changes the song: the next track starts by itself, no tap, no Resume",
           bool(s2) and s2["src"].endswith("?schism") and not s2["paused"] and not s2["resume"]
           and page.evaluate("() => window.__refused") == refused, f"{s2} refused {refused}->{page.evaluate('() => window.__refused')}")
    record("radio", "the next track goes through the gain node too",
           "route=webaudio" in page.inner_text("#dg-radio-debug"), page.inner_text("#dg-radio-debug"))

    now = page.evaluate("() => Date.now()")
    sid = clips[0].rsplit(".", 1)[0]
    np3 = dict(np2, stingers=[{"id": sid, "fired_at": now, "started_at": now, "paused": False, "paused_at": 0, "loop": False}])
    push_radio_now_playing(page, "1", np3)
    stinger = """(id) => { const a = [...document.querySelectorAll('audio')].find(x => x.src.indexOf('/stingers/' + id) !== -1 && x.id !== 'dg-radio-audio');
        return a ? { paused: a.paused, t: a.currentTime } : null; }"""
    _pump_until(page, lambda: (page.evaluate(stinger, sid) or {"paused": True})["paused"] is False, timeout_ms=4000)
    st = page.evaluate(stinger, sid)
    record("radio", "a sound effect fired after that tap plays on its own (no tap needed)",
           bool(st) and st["paused"] is False and page.evaluate("() => window.__refused") == refused, str(st))
    page.close()
    return errs

def test_table_radio_main_track_gain_only_with_cors(p):
    """Issue #39. The main track only goes through Web Audio (the gain
    node, the one volume control iOS honours) when that is audible:
    WebKit plays a cross-origin, non-CORS file routed through
    createMediaElementSource as pure silence (the live "ctx=running,
    gain=0.94, nothing audible" report), and crossorigin="anonymous" on a
    host that sends no CORS headers stops the file loading at all. Both
    verified on WebKitGTK with a two-origin test. So the widget asks the
    track's URL first:
      no CORS headers -> plain <audio>, exactly the old behaviour;
      CORS headers    -> crossorigin="anonymous" + gain node, gain follows
                         the mix; the "yes" is remembered for the bucket;
      same origin     -> gain node, no crossorigin needed;
      a remembered "yes" that no longer holds -> the load error drops it
                         back to plain <audio> instead of silence.
    Ambient layers keep their own gain nodes throughout."""
    # Two real media origins (other ports on this machine): Playwright's own
    # route.fulfill() skips the browser's CORS check, so it can't stand in
    # for a host that does or doesn't send the headers.
    import threading, http.server, functools, socket
    stingers = os.path.join(HERE, "..", "assets", "stingers")
    clip_name = sorted(os.listdir(stingers))[0]
    probes = []
    cors_mode_audio = []  # <audio> fetches made in CORS mode (they carry Origin)

    def media_server(send_cors):
        class H(http.server.SimpleHTTPRequestHandler):
            def end_headers(self):
                if send_cors:
                    self.send_header("Access-Control-Allow-Origin", "*")
                super().end_headers()
            def do_GET(self):
                if self.headers.get("Sec-Fetch-Dest") == "empty":
                    probes.append(self.path)
                elif self.headers.get("Origin") and not send_cors:
                    cors_mode_audio.append(self.path)
                return super().do_GET()
            def log_message(self, *a):
                pass
        sock = socket.socket(); sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]; sock.close()
        srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(H, directory=stingers))
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        return srv, f"http://127.0.0.1:{port}"
    cors_srv, CORS = media_server(True)
    nocors_srv, NOCORS = media_server(False)

    def fresh_page():
        page = p.new_page()
        page.set_default_timeout(8000)
        errs = collect_errors(page)
        page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
        page.add_init_script("try { sessionStorage.setItem('dg_boot_seen', '1'); } catch (e) {}")
        install_radio_firestore_stub(page)
        page.route("**/script.google.com/**", lambda r: r.fulfill(status=200, content_type="application/json", body='{"status":"OK"}'))
        page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
        notebook_aside(page)
        page.evaluate("() => localStorage.setItem('dg_radio_channel', '1')")
        page.reload(wait_until="domcontentloaded", timeout=15000)
        notebook_aside(page)
        page.wait_for_timeout(300)
        return page, errs

    starts = [1700000000000]
    def play(page, url, extra=None):
        # A new started_at per track: the widget treats a repeat of the
        # same started_at as the same broadcast and doesn't rebuild.
        starts[0] += 1000
        np = {"channel": "1", "track_url": url, "track_title": "The Void", "started_at": starts[0],
              "track_volume": 50, "ambient_volume": 100, "track_kind": "audio"}
        np.update(extra or {})
        push_radio_now_playing(page, "1", np)
        _pump_until(page, lambda: page.evaluate("(u) => { const a = document.querySelector('#dg-radio-embed-wrap audio'); return !!a && a.src === new URL(u, location.href).href; }", url)
                    and "route=" in page.inner_text("#dg-radio-debug"), timeout_ms=5000)
        page.wait_for_timeout(300)
        dbg = page.inner_text("#dg-radio-debug")
        seg = next((x for x in dbg.split(" | ") if x.startswith("track.volume=")), "")
        return dbg, seg, page.eval_on_selector("#dg-radio-embed-wrap audio", "el => el.getAttribute('crossorigin')")

    errs = []
    page, e = fresh_page(); errs += e
    dbg, seg, xo = play(page, f"{NOCORS}/{clip_name}", {
        "ambient_layers": [{"id": "alien-lunch", "started_at": 1700000000000, "paused": False, "paused_at": 0, "loop": True}]})
    real_volume = page.eval_on_selector("#dg-radio-embed-wrap audio", "el => el.volume")
    record("radio", "#39: a host without CORS headers keeps the plain <audio> -- no gain node, no crossorigin",
           "route=element" in dbg and "gain=" not in seg and xo is None and abs(real_volume - 0.35) < 0.01, dbg)
    record("radio", "#39: the widget asks before loading -- a no-CORS track is never fetched in CORS mode",
           not cors_mode_audio and probes, f"cors-mode audio fetches={cors_mode_audio} probes={probes}")
    record("radio", "#39: an ambient layer on the same channel still gets its own gain node",
           "ambient x1=alien-lunch:" in dbg and "/gain=" in dbg, dbg)

    dbg, seg, xo = play(page, f"{CORS}/{clip_name}")
    page.click("#dg-radio-mute")  # SOUND: the gain should now follow the mix (my vol 70 x track 50%)
    page.wait_for_timeout(200)
    dbg = page.inner_text("#dg-radio-debug")
    seg = next((x for x in dbg.split(" | ") if x.startswith("track.volume=")), "")
    gains = [x for x in dbg.split(" | ") if x.startswith("gain=")]
    record("radio", "#39: a host that sends CORS headers gets crossorigin + the gain node, gain = the mix",
           "route=webaudio" in dbg and gains == ["gain=0.35"] and xo == "anonymous", dbg + " crossorigin=" + str(xo))
    n = len(probes)
    dbg, seg, xo = play(page, f"{CORS}/{clip_name}?second")
    record("radio", "#39: the CORS answer is remembered per host -- the next track doesn't ask again",
           len(probes) == n and "route=webaudio" in dbg, f"probes before={n} after={len(probes)}")

    dbg, seg, xo = play(page, f"{BASE}/assets/stingers/" + sorted(os.listdir(os.path.join(HERE, "..", "assets", "stingers")))[0])
    record("radio", "#39: a same-origin file goes through the gain node without needing crossorigin",
           "route=webaudio" in dbg and xo is None, dbg)
    page.close()

    # A remembered "yes" that no longer holds (the bucket's CORS config was
    # removed): the load fails in CORS mode, and the widget falls back to
    # plain <audio> rather than going silent.
    page, e = fresh_page(); errs += e
    del cors_mode_audio[:]
    page.evaluate("(o) => sessionStorage.setItem('dg_radio_cors_ok', JSON.stringify({[o]: true}))", NOCORS)
    push_radio_now_playing(page, "1", {"channel": "1", "track_url": f"{NOCORS}/{clip_name}",
                                       "track_title": "The Void", "started_at": 1700000000000, "track_volume": 50, "track_kind": "audio"})
    _pump_until(page, lambda: "route=element" in page.inner_text("#dg-radio-debug"), timeout_ms=6000)
    xo = page.eval_on_selector("#dg-radio-embed-wrap audio", "el => el.getAttribute('crossorigin')")
    remembered = page.evaluate("() => sessionStorage.getItem('dg_radio_cors_ok')")
    record("radio", "#39: a stale remembered CORS 'yes' falls back to plain <audio> and is forgotten",
           "route=element" in page.inner_text("#dg-radio-debug") and xo is None and NOCORS not in (remembered or ""),
           page.inner_text("#dg-radio-debug") + " / " + str(remembered))
    page.close()
    cors_srv.shutdown(); nocors_srv.shutdown()
    return errs

def test_table_radio_finished_track_does_not_restart_from_beginning(p):
    """Live report: "if the song is over in a cell but i tap on resume
    play, the radio widget starts to play the song from the start only
    in the widget." Direct reproduction confirmed the mechanism: a
    broadcast that's simply run past its (short) track's own real
    duration hits seekAudioToLive_()'s existing overrun clamp, which
    sets currentTime to EXACTLY audioEl.duration -- landing precisely on
    the media element's own "effective end". Calling .play() from there
    makes the browser itself seek back to position 0 first, per the
    HTMLMediaElement play() algorithm ("if the current playback position
    is the same as the effective end of the media resource, seek to the
    earliest possible position") -- so a late tune-in OR a Handler
    Pause-then-Resume on a track that's already finished both restarted
    it audibly from the beginning instead of leaving it silent, as a
    finished non-looping track should be. Uses a real, short (~2.9s)
    repo-bundled stinger file so a genuine finite .duration is available
    to overrun against -- the other radio tests' fake empty-body mp3
    responses never load real metadata, so this exact path was
    completely untested until now."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.add_init_script("try { sessionStorage.setItem('dg_boot_seen', '1'); } catch (e) {}")
    install_radio_firestore_stub(page)
    page.route("**/script.google.com/**", lambda r: r.fulfill(status=200, content_type="application/json", body='{"status":"OK"}'))

    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    notebook_aside(page)
    page.evaluate("() => localStorage.setItem('dg_radio_channel', '1')")
    page.reload(wait_until="domcontentloaded", timeout=15000)
    notebook_aside(page)
    page.wait_for_timeout(300)

    now = int(time.time() * 1000)
    # manic-laugh-01.mp3's real duration is ~2.93s -- started a full
    # minute ago, so plainly, unambiguously over.
    started_at = now - 60000
    push_radio_now_playing(page, "1", {
        "channel": "1", "track_url": "assets/stingers/manic-laugh-01.mp3",
        "track_title": "Manic Laugh", "track_kind": "audio",
        "started_at": started_at, "paused": False, "paused_at": "",
        "track_volume": 100, "ambient_volume": 100,
    })
    page.wait_for_timeout(800)
    state = page.evaluate("""() => {
        var el = document.querySelector('#dg-radio-embed-wrap audio');
        return el ? { paused: el.paused, duration: el.duration } : null;
    }""")
    record("radio", "a late tune-in to an already-finished, non-looping broadcast does not play at all",
           state is not None and state["paused"] is True, state)

    # The exact reported sequence: Handler pauses (started_at untouched),
    # then resumes shortly after (started_at shifted forward by only the
    # few seconds the pause lasted -- sendTransportAction_()'s real math
    # in a-cell.html) -- still nowhere near catching up to the real
    # overrun, so still genuinely over.
    paused_at = now
    push_radio_now_playing(page, "1", {
        "channel": "1", "track_url": "assets/stingers/manic-laugh-01.mp3",
        "track_title": "Manic Laugh", "track_kind": "audio",
        "started_at": started_at, "paused": True, "paused_at": paused_at,
        "track_volume": 100, "ambient_volume": 100,
    })
    page.wait_for_timeout(200)
    resume_now = paused_at + 3000
    shifted_started_at = started_at + (resume_now - paused_at)
    push_radio_now_playing(page, "1", {
        "channel": "1", "track_url": "assets/stingers/manic-laugh-01.mp3",
        "track_title": "Manic Laugh", "track_kind": "audio",
        "started_at": shifted_started_at, "paused": False, "paused_at": "",
        "track_volume": 100, "ambient_volume": 100,
    })
    page.wait_for_timeout(800)
    state = page.evaluate("""() => {
        var el = document.querySelector('#dg-radio-embed-wrap audio');
        return el ? { paused: el.paused } : null;
    }""")
    record("radio", "a Handler Pause-then-Resume on a track that finished long ago does not restart it either",
           state is not None and state["paused"] is True, state)

    # Loop is the one case that's SUPPOSED to keep playing past a single
    # play-through -- confirms the fix didn't just make every overrun
    # broadcast go silent regardless of loop.
    push_radio_now_playing(page, "1", {
        "channel": "1", "track_url": "assets/stingers/manic-laugh-01.mp3",
        "track_title": "Manic Laugh", "track_kind": "audio", "loop": True,
        "started_at": now - 7000, "paused": False, "paused_at": "",
        "track_volume": 100, "ambient_volume": 100,
    })
    page.wait_for_timeout(500)
    state = page.evaluate("""() => {
        var el = document.querySelector('#dg-radio-embed-wrap audio');
        return el ? { paused: el.paused, loop: el.loop } : null;
    }""")
    record("radio", "a looped track that's overrun a single play-through keeps playing, not silenced",
           state is not None and state["paused"] is False and state["loop"] is True, state)

    page.close()
    return errs

def test_table_radio_debug_readout_present_before_tuning_in(p):
    """A completely fresh device with no channel ever tuned in yet (e.g.
    right after clearing all site data) boots into renderCollapsed()'s
    "Tune In" pill, not renderTuned() -- the debug readout only exists
    inside renderTuned()'s own template, so confirms it shows up as soon
    as a channel is picked, on a device with no prior state at all."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.add_init_script("try { sessionStorage.setItem('dg_boot_seen', '1'); } catch (e) {}")
    install_radio_firestore_stub(page)

    # No pre-set localStorage channel -- a genuinely fresh device.
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    notebook_aside(page)
    page.wait_for_timeout(300)
    record("radio", "no debug element exists yet while still on the collapsed Tune In pill (nothing to show)",
           page.query_selector("#dg-radio-debug") is None, "")

    page.click("#dg-radio-pill")
    page.wait_for_timeout(150)
    page.click("#dg-radio-confirm-tune")
    page.wait_for_timeout(300)
    record("radio", "the debug readout appears immediately once tuned in, no query param or prior state needed",
           page.query_selector("#dg-radio-debug") is not None, "")

    page.close()
    return errs

def test_table_radio_pause_and_loop(p):
    """Table Radio: the Handler can Pause/Resume a broadcast in place
    (set_now_playing always restarts a track from 0:00, which isn't the
    right tool for "hold on a second") and mark a track to Loop (for
    ambience tracks that should keep repeating instead of the Handler
    re-cueing it every time it ends). The radio/{channel} Firestore
    document (Firebase migration Phase 2) carries paused/paused_at/loop;
    the widget must reflect a paused broadcast by NOT autoplaying the
    <audio> element, and a looping one by setting its real .loop
    property."""
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
    install_radio_firestore_stub(page)
    page.route("**/ambience.mp3", lambda r: r.fulfill(status=200, content_type="audio/wav", body=wav_bytes))

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps({"status": "OK"})})')
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", fake_apps_script)

    # Scenario 1: broadcasting normally, with Loop on. started_at is "now"
    # (not a fixed past timestamp) -- the widget seeks the <audio>
    # element to the elapsed time since started_at, and seeking past a
    # short fixture track's actual duration snaps it straight to
    # "ended" (paused), which would make this scenario's "actually
    # playing" assertion meaningless.
    now_ms = int(__import__("time").time() * 1000)

    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    notebook_aside(page)
    page.evaluate("() => localStorage.setItem('dg_radio_channel', '1')")
    page.reload(wait_until="domcontentloaded", timeout=15000)
    notebook_aside(page)
    page.wait_for_timeout(300)
    push_radio_now_playing(page, "1", {
        "channel": "1", "track_url": "https://example.com/ambience.mp3",
        "track_title": "Rain Loop", "started_at": now_ms,
        "paused": False, "paused_at": 0, "loop": True,
    })
    page.wait_for_timeout(400)

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
    page2 = p.new_page()
    page2.set_default_timeout(8000)
    errs2 = collect_errors(page2)
    page2.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page2.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page2.add_init_script("try { sessionStorage.setItem('dg_boot_seen', '1'); } catch (e) {}")
    page2.add_init_script(play_probe)
    install_radio_firestore_stub(page2)
    page2.route("**/ambience.mp3", lambda r: r.fulfill(status=200, content_type="audio/wav", body=wav_bytes))
    page2.route("**/script.google.com/**", fake_apps_script)

    page2.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    notebook_aside(page2)
    page2.evaluate("() => localStorage.setItem('dg_radio_channel', '1')")
    page2.reload(wait_until="domcontentloaded", timeout=15000)
    notebook_aside(page2)
    page2.wait_for_timeout(300)
    push_radio_now_playing(page2, "1", {
        "channel": "1", "track_url": "https://example.com/ambience.mp3",
        "track_title": "Rain Loop", "started_at": now_ms,
        "paused": True, "paused_at": now_ms, "loop": False,
    })
    page2.wait_for_timeout(400)

    record("radio", "a Handler-paused broadcast does not call .play() for a listener tuning in",
           page2.evaluate("() => (window.__dgPlayCalls || []).length") == 0, "")
    record("radio", "a Handler-paused broadcast leaves the <audio> element paused in the DOM",
           page2.eval_on_selector("#dg-radio-embed-wrap audio", "el => el.paused") is True, "")
    record("radio", "status tells the listener the Handler paused it, not that it's dead air",
           page2.eval_on_selector("#dg-radio-status", "el => el.textContent") == "Paused by the Handler", "")
    page2.close()
    return errs + errs2

def test_table_radio_unprompted_pause_auto_resumes(p):
    """Regression test for a real player report: after the Phase 2 shell
    dedup fix (only one hoisted Table Radio widget, so the swap test
    could actually exercise the right one), a Track Library file was
    still playing, tapping the shell's content-swap test button still
    stopped it, and it stayed stopped. #dg-radio-audio lives entirely in
    the shell's own document, outside #dg-shell-content -- a sibling
    iframe navigating can't reach it directly -- so this points at a
    known WebKit quirk: iOS Safari can pause tab-wide <audio>/<video>
    playback on ANY iframe navigation elsewhere on the page, unrelated
    to whether that element is inside the navigating iframe at all. Not
    reproducible in this suite's Chromium (same class of gap as the
    position:fixed iOS backdrop bug documented in notes/index.html's own
    section of the QA README) -- but the FIX (auto-resume on an
    unprompted 'pause' event) is directly testable: simulate the
    browser's own uncommanded pause by calling audioEl.pause() from here,
    exactly what an external interruption looks like from the element's
    own perspective regardless of what triggered it, and confirm
    table-radio.js resumes it. A REAL Handler-paused broadcast (pushed
    via a fresh radio/{channel} snapshot, same as Scenario 2 above) must
    NOT be auto-resumed -- intentionalPause is the flag that tells the
    two apart."""
    import wave, io
    wav_buf = io.BytesIO()
    w = wave.open(wav_buf, "wb")
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
    w.writeframes(b"\x00\x00" * 8000)
    w.close()
    wav_bytes = wav_buf.getvalue()

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
    install_radio_firestore_stub(page)
    page.route("**/ambience.mp3", lambda r: r.fulfill(status=200, content_type="audio/wav", body=wav_bytes))
    route_apps_script_ok(page)

    now_ms = int(__import__("time").time() * 1000)
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    notebook_aside(page)
    page.evaluate("() => localStorage.setItem('dg_radio_channel', '1')")
    page.reload(wait_until="domcontentloaded", timeout=15000)
    notebook_aside(page)
    page.wait_for_timeout(300)
    push_radio_now_playing(page, "1", {
        "channel": "1", "track_url": "https://example.com/ambience.mp3",
        "track_title": "Rain Loop", "started_at": now_ms,
        "paused": False, "paused_at": 0, "loop": True,
    })
    page.wait_for_timeout(400)
    initial_play_calls = page.evaluate("() => (window.__dgPlayCalls || []).length")
    record("radio", "sanity check: the track actually started playing before simulating an interruption",
           initial_play_calls > 0, str(initial_play_calls))

    # Simulate the browser's own uncommanded pause -- same event shape
    # an iOS Safari iframe-navigation interruption produces, regardless
    # of cause.
    page.evaluate("() => { var el = document.getElementById('dg-radio-audio'); if (el) el.pause(); }")
    page.wait_for_timeout(300)
    record("radio", "an unprompted pause (not a real Handler pause) is auto-resumed",
           page.evaluate("() => (window.__dgPlayCalls || []).length") > initial_play_calls,
           str(page.evaluate("() => (window.__dgPlayCalls || []).length")))
    record("radio", "the <audio> element is actually playing again after the auto-resume",
           page.eval_on_selector("#dg-radio-embed-wrap audio", "el => el.paused") is False, "")

    resumed_play_calls = page.evaluate("() => (window.__dgPlayCalls || []).length")
    # Now a REAL Handler pause, via a fresh broadcast snapshot -- must
    # stick, not get auto-resumed by the same listener.
    push_radio_now_playing(page, "1", {
        "channel": "1", "track_url": "https://example.com/ambience.mp3",
        "track_title": "Rain Loop", "started_at": now_ms,
        "paused": True, "paused_at": now_ms + 1000, "loop": True,
    })
    page.wait_for_timeout(400)
    record("radio", "a real Handler-paused broadcast stays paused (not auto-resumed by the same listener)",
           page.eval_on_selector("#dg-radio-embed-wrap audio", "el => el.paused") is True, "")
    record("radio", "a real Handler pause does not trigger another .play() call",
           page.evaluate("() => (window.__dgPlayCalls || []).length") == resumed_play_calls,
           str(page.evaluate("() => (window.__dgPlayCalls || []).length")))

    record("radio", "no JS exceptions", len(errs) == 0, "; ".join(errs))
    page.close()
    return errs

def test_table_radio_audio_syncs_to_live_position(p):
    """Regression test for a real player report: tuning in to a Track
    Library broadcast always started the <audio> element from 0:00
    instead of syncing to where the Handler actually started it. Root
    cause was setting audioEl.currentTime immediately after creating the
    element, before it has loaded enough to know its own duration
    (readyState 0 / HAVE_NOTHING) -- Chrome queues that assignment and
    applies it once ready, but iOS Safari can silently drop it, which is
    exactly the "always restarts from the beginning" shape of bug. The
    fix (seekAudioToLive_()) defers the assignment to loadedmetadata
    when the element isn't ready yet. Not reproducible as a Safari-vs-
    Chrome behavioral difference in this suite's Chromium (same class of
    gap as the unprompted-pause quirk above), but the actual seek target
    -- landing on the live elapsed position, not 0 -- is directly
    testable and would already have failed against the pre-fix code path
    that computed but never re-applied it after a deferred load.

    A second scenario covers the other half of the same player report:
    after the WebKit interruption + auto-resume from the test above,
    'stops and restarts from the beginning' rather than resuming where
    it left off -- simulated here by corrupting currentTime to 0 (as if
    the browser evicted the buffered audio) immediately before firing an
    unprompted 'pause' event, confirming the auto-resume path reseeks to
    the live position rather than resuming from wherever iOS left it."""
    # Needs a fixture genuinely longer than the elapsed offset being
    # seeked to -- a 1s clip would just clamp/loop back near 0 and the
    # test couldn't tell a real seek from a no-op.
    import wave, io
    wav_buf = io.BytesIO()
    w = wave.open(wav_buf, "wb")
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000)
    w.writeframes(b"\x00\x00" * 8000 * 90)  # 90s of silence
    w.close()
    wav_bytes = wav_buf.getvalue()

    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.add_init_script("try { sessionStorage.setItem('dg_boot_seen', '1'); } catch (e) {}")
    install_radio_firestore_stub(page)
    # Accept-Ranges is required for Chromium to treat this as a genuinely
    # seekable resource in this synthetic test setup -- without it,
    # currentTime assignments were silently reverting (an artifact of the
    # mock response, confirmed by a currentTime-setter probe against this
    # exact fixture; not a real-world seeking distinction, since a real
    # Drive-hosted download link does advertise range support).
    page.route("**/ambience.mp3", lambda r: r.fulfill(status=200, content_type="audio/wav", body=wav_bytes,
                headers={"Accept-Ranges": "bytes"}))
    route_apps_script_ok(page)

    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    notebook_aside(page)
    page.evaluate("() => localStorage.setItem('dg_radio_channel', '1')")
    page.reload(wait_until="domcontentloaded", timeout=15000)
    notebook_aside(page)
    page.wait_for_timeout(300)

    # A broadcast that "started" 45s ago -- a fresh tune-in should land
    # roughly there, not at 0:00.
    started_45s_ago = int(__import__("time").time() * 1000) - 45000
    push_radio_now_playing(page, "1", {
        "channel": "1", "track_url": "https://example.com/ambience.mp3",
        "track_title": "Rain Loop", "started_at": started_45s_ago,
        "paused": False, "paused_at": 0, "loop": False,
    })
    page.wait_for_timeout(1000)
    current_time = page.eval_on_selector("#dg-radio-embed-wrap audio", "el => el.currentTime")
    record("radio", "tuning in to an already-running broadcast seeks near the live elapsed position, not 0:00",
           43 <= current_time <= 52, f"currentTime={current_time}")

    # Now simulate the other half of the report: an unprompted pause
    # where the browser also silently reset the position (as iOS can do
    # when it evicts buffered audio) -- corrupt currentTime to 0 right
    # before the 'pause' event fires, same shape an external interruption
    # takes from the element's own perspective.
    page.evaluate("""() => {
        var el = document.getElementById('dg-radio-audio');
        el.currentTime = 0;
        el.dispatchEvent(new Event('pause'));
    }""")
    page.wait_for_timeout(500)
    resumed_time = page.eval_on_selector("#dg-radio-embed-wrap audio", "el => el.currentTime")
    record("radio", "an auto-resume after a simulated position reset reseeks to the live position, not 0:00",
           resumed_time >= 44, f"currentTime={resumed_time}")

    record("radio", "no JS exceptions", len(errs) == 0, "; ".join(errs))
    page.close()
    return errs

def test_table_radio_library_track_kind(p):
    """Table Radio Track Library (v1.7): a mp3 uploaded through A-Cell's
    Music tab is stored in Drive and served back as a direct download
    link (e.g. drive.google.com/uc?export=download&id=...), which has no
    .mp3 file extension for the player's usual URL-sniffing
    (isDirectAudio()) to catch. The radio/{channel} Firestore document
    (Firebase migration Phase 2) carries an explicit track_kind: 'audio'
    for exactly this case -- confirms the widget honors it and renders a
    real <audio> element rather than falling through to the
    generic-iframe case (which would just try to load the download link
    as a webpage, not play it)."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.add_init_script("try { sessionStorage.setItem('dg_boot_seen', '1'); } catch (e) {}")
    install_radio_firestore_stub(page)

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps({"status": "OK"})})')
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", fake_apps_script)
    page.route("**/uc?export=download*", lambda r: r.fulfill(status=200, content_type="audio/mpeg", body=""))

    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    notebook_aside(page)
    page.evaluate("() => localStorage.setItem('dg_radio_channel', '3')")
    page.reload(wait_until="domcontentloaded")
    notebook_aside(page)
    page.wait_for_timeout(300)
    push_radio_now_playing(page, "3", {
        "channel": "3", "track_url": "https://drive.google.com/uc?export=download&id=fakeFileId123",
        "track_title": "Rain Loop", "started_at": 1700000000000, "track_kind": "audio",
    })
    page.wait_for_timeout(500)

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
    install_radio_firestore_stub(page)

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps({"status": "OK"})})')
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
    notebook_aside(page)
    page.evaluate("() => localStorage.setItem('dg_radio_channel', '3')")
    page.reload(wait_until="domcontentloaded")
    notebook_aside(page)
    push_radio_now_playing(page, "3", {
        "channel": "3", "track_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "track_title": "Table Theme", "started_at": 1700000000000,
    })
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

def test_shell_content_swap_preserves_hoisted_widgets(p):
    """hub.html (Phase 2 of the app-shell plan, docs/firebase-migration/
    on this branch) hoists Table Radio and Dice Roller into the outer
    document once, for the tab's whole lifetime, and loads each real
    page into #dg-shell-content instead of doing a real page navigation
    -- the entire point being that swapping the iframe's src can never
    touch the outer document's own widgets, so audio playing there is
    never interrupted (a real page navigation, by contrast, always
    destroys and recreates them -- see table-radio.js's own header
    comment). Proves that structurally, without needing a real Firestore
    connection: tag the outer widgets' DOM nodes, swap the content
    iframe (via the real persistent shell nav, assets/shell-nav.js --
    the same tappable path a player actually has), and confirm the exact
    same nodes (not same-looking rebuilt ones) are still there
    afterward -- also checks the nav itself highlights whichever
    destination is actually loaded. Both widgets start in their default
    collapsed/no-channel
    state here (no localStorage channel set), which never opens a
    Firestore connection in the first place (see table-radio.js's
    startPolling()) -- so this needs no Firestore mocking to be a
    meaningful proof.

    Also confirms the dedup guard actually works: table-radio.js and
    dice-roller.js both bail out immediately when
    window.frameElement.id === 'dg-shell-content' (both widgets are
    position:fixed, so an un-suppressed inner copy would render right on
    top of the shell's real one, at bottom-right of the iframe's own
    viewport rather than the window's -- close enough on screen that a
    tester can't reliably tell which pill they're tapping, and only the
    inner one -- which a real iframe navigation destroys -- would
    actually be reachable). Regression coverage for exactly that: before
    this guard existed, Agent Hub's own copies rendered inside the
    content iframe alongside the shell's, making "does Table Radio
    survive a swap" impossible to verify by tapping the visible pill."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    # Table Radio's own Firestore usage really is conditional on a
    # channel being set (see this test's own docstring above), but the
    # content iframe swaps into a-cell.html too, and its own Evidence
    # listener starts unconditionally on load (Phase 5) regardless of
    # anything this test is actually proving -- without a stub, that's
    # a real network call reaching the real backend in CI (this sandbox
    # silently fails unmocked external calls instead, which is why this
    # never showed up locally). Also seeding a Handler session so sign-in
    # actually succeeds instead of a benign-but-noisy local "No A-Cell
    # session" rejection -- this test isn't about Handler auth at all,
    # so a clean sign-in is the least surprising simulated state.
    install_notes_firestore_stub(page)
    page.add_init_script("try { sessionStorage.setItem('dg_acell_pw', 'testpw'); } catch (e) {}")
    # hub.html's loading veil now asks for a Cover Identity before
    # booting the iframe to Agent Hub, unless one's already remembered
    # -- pre-seeding it here keeps this test's own concern (does the
    # shell preserve its hoisted widgets across a page swap?) decoupled
    # from that separate prompt.
    page.add_init_script("try { localStorage.setItem('dg_cover_identity', 'Test Player'); } catch (e) {}")
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    page.goto(f"{BASE}/hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)

    record("shell", "the shell page shows its own (hoisted, outside the content iframe) Table Radio pill",
           page.is_visible("#dg-radio-pill"), "")
    record("shell", "the shell page shows its own (hoisted, outside the content iframe) Dice Roller panel",
           page.locator("#dr-panel").count() == 1, "")
    record("shell", "the shell's content iframe defaults to Agent Hub",
           "agent-hub.html" in (page.get_attribute("#dg-shell-content", "src") or ""), "")

    page.wait_for_function(
        "() => { var f = document.getElementById('dg-shell-content'); "
        "return f.contentDocument && f.contentDocument.readyState === 'complete'; }")
    page.wait_for_timeout(200)

    record("shell", "Agent Hub's own copy of the Table Radio pill did NOT also mount inside the content iframe (dedup guard)",
           page.eval_on_selector("#dg-shell-content", "el => el.contentDocument.getElementById('dg-radio-pill')") is None, "")
    record("shell", "Agent Hub's own copy of the Dice Roller panel did NOT also mount inside the content iframe (dedup guard)",
           page.eval_on_selector("#dg-shell-content", "el => el.contentDocument.getElementById('dr-panel')") is None, "")

    record("shell", "the real nav starts with Agent Hub highlighted (the iframe's initial page)",
           "dg-shell-nav-active" in (page.get_attribute('#dg-shell-nav button[data-target="agent-hub.html"]', "class") or ""), "")
    record("shell", "A-Cell is not highlighted yet",
           "dg-shell-nav-active" not in (page.get_attribute('#dg-shell-nav button[data-target="a-cell.html"]', "class") or ""), "")

    page.evaluate("""() => {
        document.getElementById('dg-radio-pill').dataset.dgTestTag = 'radio-still-here';
        document.getElementById('dr-panel').dataset.dgTestTag = 'dice-still-here';
    }""")

    # The real persistent nav (#dg-shell-nav), not a raw iframe.src
    # assignment -- proving the actual UI path a player has.
    page.click('#dg-shell-nav button[data-target="a-cell.html"]')
    page.wait_for_function(
        "() => { var f = document.getElementById('dg-shell-content'); "
        "return f.contentDocument && f.contentDocument.readyState === 'complete' "
        "&& /a-cell\\.html/.test(f.contentWindow.location.href); }")
    page.wait_for_timeout(200)

    record("shell", "the content iframe actually swapped to the new page",
           "a-cell.html" in page.eval_on_selector("#dg-shell-content", "el => el.contentWindow.location.href"), "")
    record("shell", "the outer Table Radio pill is the exact same DOM node after the swap (not rebuilt) -- any audio it owns was never touched",
           page.eval_on_selector("#dg-radio-pill", "el => el.dataset.dgTestTag") == "radio-still-here", "")
    record("shell", "the outer Dice Roller panel is the exact same DOM node after the swap (not rebuilt)",
           page.eval_on_selector("#dr-panel", "el => el.dataset.dgTestTag") == "dice-still-here", "")
    record("shell", "A-Cell's own copy of the Table Radio pill also did NOT mount inside the content iframe (dedup guard, second page)",
           page.eval_on_selector("#dg-shell-content", "el => el.contentDocument.getElementById('dg-radio-pill')") is None, "")
    record("shell", "the nav now highlights A-Cell instead",
           "dg-shell-nav-active" in (page.get_attribute('#dg-shell-nav button[data-target="a-cell.html"]', "class") or ""), "")
    record("shell", "Agent Hub is no longer highlighted",
           "dg-shell-nav-active" not in (page.get_attribute('#dg-shell-nav button[data-target="agent-hub.html"]', "class") or ""), "")
    record("shell", "no JS exceptions", len(errs) == 0, "; ".join(errs))
    page.close()
    return errs

def test_shell_nav_tracks_in_page_navigation(p):
    """The persistent shell nav (assets/shell-nav.js) only offers two
    top-level buttons (Agent Hub, A-Cell) -- deeper pages (Character
    Sheet, Agent File, Notes) are reached the normal way, by clicking a
    link inside whichever page is currently loaded, which just navigates
    the iframe on its own (same-origin, no extra plumbing). This proves
    that actually works end to end: click Agent Hub's own "Agent File"
    Play button (real in-page markup, not the shell's nav) for a known Agent,
    confirm the iframe followed it to the character sheet WITHOUT the
    outer shell page navigating at all (Table Radio/Dice Roller survive,
    same proof as the swap test above), and that the nav still reads
    this as "Agent Hub" territory rather than going blank."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    # Agent Hub's own Evidence listener (Phase 5) starts unconditionally
    # for every roster agent on load -- this test seeds one (OWEN-CS12)
    # to have something to click, which otherwise reaches the real
    # backend in CI and produces a real console error this test's own
    # "no JS exceptions" check flags.
    install_notes_firestore_stub(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    # OWEN-CS12 needs a backend record (an Agent File), or Agent Hub
    # purges it from the roster as deleted.
    install_firestore_backend(page, {"briefs/OWEN-CS12": {"char_name": "Owen Castillo", "codename": "Ferro"}})
    # add_init_script runs in every same-origin document this page
    # loads, the content iframe included -- needed so Agent Hub's own
    # roster (and its per-Agent "Agent File" link) actually renders
    # something to click, same localStorage key test_agent_hub uses.
    roster = {"OWEN-CS12": {"code": "OWEN-CS12", "char_name": "Owen Castillo", "codename": "Ferro",
                             "sex": "Male", "age_range": "Late 30s", "nationality": "American", "saved_at": 2000}}
    page.add_init_script(f"try {{ localStorage.setItem('dg_agent_roster', {json.dumps(json.dumps(roster))}); }} catch (e) {{}}")
    # hub.html's loading veil now asks for a Cover Identity before
    # booting the iframe to Agent Hub, unless one's already remembered --
    # pre-seeding it here so the iframe actually loads instead of sitting
    # on that prompt (this test is about in-page nav tracking, not that
    # prompt, which has its own coverage in test_hub_cover_identity_veil).
    page.add_init_script("try { localStorage.setItem('dg_cover_identity', 'Test Player'); } catch (e) {}")

    page.goto(f"{BASE}/hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function(
        "() => { var f = document.getElementById('dg-shell-content'); "
        "return f.contentDocument && f.contentDocument.readyState === 'complete'; }")
    page.evaluate("""() => {
        document.getElementById('dg-radio-pill').dataset.dgTestTag = 'radio-still-here';
    }""")

    # A real Play link, from inside the loaded Agent Hub page --
    # any known agent code works, this is only proving the iframe
    # follows a same-origin relative link on its own.
    agent_file_href = page.eval_on_selector(
        "#dg-shell-content",
        "el => { var a = el.contentDocument.querySelector('a[href*=\"?recruit=\"]'); "
        "if (a) { a.target = ''; } return a && a.getAttribute('href'); }"
   )
    if not agent_file_href:
        record("shell", "found an in-page Recruit link to click (roster has at least one Agent)", False, "no roster link found")
        record("shell", "no JS exceptions", len(errs) == 0, "; ".join(errs))
        page.close()
        return errs

    page.eval_on_selector("#dg-shell-content", "el => { var a = el.contentDocument.querySelector('a[href*=\"?recruit=\"]'); a.click(); }")
    page.wait_for_function(
        "() => { var f = document.getElementById('dg-shell-content'); "
        "return f.contentDocument && f.contentDocument.readyState === 'complete' "
        "&& /recruit=/.test(f.contentWindow.location.href); }")
    page.wait_for_timeout(200)

    record("shell", "clicking an in-page link (not the shell's own nav) still navigates the content iframe",
           "recruit=OWEN-CS12" in page.eval_on_selector("#dg-shell-content", "el => el.contentWindow.location.href"), "")
    record("shell", "the outer Table Radio pill is untouched by an in-page navigation too",
           page.eval_on_selector("#dg-radio-pill", "el => el.dataset.dgTestTag") == "radio-still-here", "")
    record("shell", "the nav still reads this as Agent Hub territory, not blank",
           "dg-shell-nav-active" in (page.get_attribute('#dg-shell-nav button[data-target="agent-hub.html"]', "class") or ""), "")
    record("shell", "no JS exceptions", len(errs) == 0, "; ".join(errs))
    page.close()
    return errs

def test_shell_back_link_hidden_inside_shell(p):
    """A page's own "back to Clearance" link (href="index.html") is
    redundant once inside hub.html's shell -- the shell's own persistent
    nav (assets/shell-nav.js) already covers switching between Agent Hub
    and A-Cell directly, with no need to ever route through index.html
    at all. Two earlier approaches (target="_top" breaking out of the
    shell entirely, then a script making index.html redirect back
    through the parent's existing iframe) both got replaced by simply
    hiding the link inside the shell -- it stays for a standalone visit
    (a bookmark, a search result), where window.frameElement is null and
    the check below never fires. Checks both agent-hub.html's own
    back-link and, after swapping to A-Cell via the shell's nav,
    a-cell.html's (there are two there -- the pre-login gate's and the
    post-login header's, both hidden the same way)."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    # Swaps the content iframe into a-cell.html, whose own Evidence
    # listener (Phase 5) starts unconditionally on load, independent of
    # anything this test is actually proving -- see the swap test's own
    # comment on the same fix.
    install_notes_firestore_stub(page)
    page.add_init_script("try { sessionStorage.setItem('dg_acell_pw', 'testpw'); } catch (e) {}")
    # hub.html's loading veil now asks for a Cover Identity before
    # booting the iframe to Agent Hub, unless one's already remembered --
    # pre-seeding it here so the iframe actually loads for this test's
    # own concern (are back-links hidden inside the shell?).
    page.add_init_script("try { localStorage.setItem('dg_cover_identity', 'Test Player'); } catch (e) {}")
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    page.goto(f"{BASE}/hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function(
        "() => { var f = document.getElementById('dg-shell-content'); "
        "return f.contentDocument && f.contentDocument.readyState === 'complete'; }")

    record("shell", "Agent Hub's own back-link is hidden inside the shell",
           page.eval_on_selector("#dg-shell-content", "el => el.contentDocument.getElementById('hub-back-link').style.display") == "none", "")

    page.click('#dg-shell-nav button[data-target="a-cell.html"]')
    page.wait_for_function(
        "() => { var f = document.getElementById('dg-shell-content'); "
        "return f.contentDocument && f.contentDocument.readyState === 'complete' "
        "&& /a-cell\\.html/.test(f.contentWindow.location.href); }")

    record("shell", "A-Cell's pre-login gate back-link is hidden inside the shell too",
           page.eval_on_selector("#dg-shell-content", "el => { var b = el.contentDocument.getElementById('acell-back'); return b && b.style.display; }") == "none", "")
    record("shell", "A-Cell's post-login header back-link is also hidden",
           page.eval_on_selector("#dg-shell-content", "el => { var b = el.contentDocument.getElementById('acell-header-back-link'); return b && b.style.display; }") == "none", "")

    # The shell's own nav is the real replacement for the hidden
    # link -- confirm it actually still gets a player back to Agent Hub.
    page.click('#dg-shell-nav button[data-target="agent-hub.html"]')
    page.wait_for_function(
        "() => { var f = document.getElementById('dg-shell-content'); "
        "return f.contentDocument && f.contentDocument.readyState === 'complete' "
        "&& /agent-hub\\.html/.test(f.contentWindow.location.href); }")
    record("shell", "the shell's own nav still gets a player back to Agent Hub with the link gone",
           "agent-hub.html" in page.eval_on_selector("#dg-shell-content", "el => el.contentWindow.location.href"), "")
    record("shell", "no JS exceptions", len(errs) == 0, "; ".join(errs))
    page.close()
    return errs

def test_page_back_link_visible_standalone(p):
    """The flip side of test_shell_back_link_hidden_inside_shell -- a
    standalone visit (window.frameElement is null, not inside the shell
    at all) must still show the "back to Clearance" link normally on
    each of the three pages that have one. Regression coverage for
    accidentally hiding it unconditionally instead of only inside the
    shell."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    # JSONP-aware -- both pages load some data via a <script src=...
    # &callback=...> tag, which executes the response as raw JS; a bare
    # JSON body (not wrapped in the callback call) throws "Unexpected
    # token ':'".
    def fake_apps_script(route):
        url = route.request.url
        if "callback=" not in url:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        cb = url.split("callback=")[1].split("&")[0]
        route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps({"status": "OK"})})')
    page.route("**/script.google.com/**", fake_apps_script)

    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    record("shell", "Agent Hub's back-link is visible on a standalone visit",
           page.eval_on_selector("#hub-back-link", "el => getComputedStyle(el).display") != "none", "")

    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    record("shell", "A-Cell's pre-login gate back-link is visible on a standalone visit",
           page.eval_on_selector("#acell-back", "el => getComputedStyle(el).display") != "none", "")

    record("shell", "no JS exceptions", len(errs) == 0, "; ".join(errs))
    page.close()
    return errs

def test_shell_hides_widgets_for_notes_popover(p):
    """Real player report: Notes' own block-type picker (Editor.js's
    mobile bottom sheet, opened via a block's own "+" button) was
    rendering correctly but sitting BEHIND the shell's hoisted Table
    Radio/Dice Roller -- both are position:fixed in hub.html's own
    document (outside the content iframe entirely), so they paint over
    the ENTIRE iframe unconditionally; no z-index used inside Notes can
    ever get above them, since an iframe boundary blocks CSS stacking
    context, not just this popover's own. Fixed with a small explicit
    API (hub.html's window.dgShellSetWidgetsHidden) that Notes calls
    into via window.parent when its own popover-open MutationObserver
    (lockBodyScrollWhilePopoverOpen) fires -- same-origin, so reaching
    into the parent directly is safe. Loads Notes for real inside the
    shell (not a standalone visit), gets a live Editor.js instance up,
    and clicks a block's own real "+" button to open the REAL popover
    (not a simulated class toggle) -- proving the actual code path, not
    just the plumbing around it."""
    page = p.new_page()
    page.set_default_timeout(15000)
    errs = collect_errors(page)
    # The shell's content iframe defaults to agent-hub.html before this
    # test swaps it to Notes -- agent-hub.html's own Evidence listener
    # (Phase 5) starts unconditionally for every roster agent during
    # that brief initial load, reaching the real backend in CI without
    # a stub (this sandbox silently fails unmocked external calls
    # instead, which is why this never showed up locally).
    install_notes_firestore_stub(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            if "action=list_cells" in url:
                res = {"status": "OK", "cells": []}  # unassigned -> solo mode, reaches a live editor fastest
            elif "action=list_cell_notes" in url:
                res = {"status": "OK", "notes": {}, "identities": {}}
            else:
                res = {"status": "OK"}
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", fake_apps_script)
    page.add_init_script("""
        try {
            localStorage.setItem('dg_agent_roster', JSON.stringify({
                'ELVI-HENC': { code: 'ELVI-HENC', char_name: 'Elvis Shantings', saved_at: Date.now() }
            }));
            // hub.html's loading veil now asks for a Cover Identity before
            // booting the iframe to Agent Hub, unless one's already
            // remembered -- pre-seeding it here so the iframe actually
            // loads for this test's own concern (do the hoisted widgets
            // hide for a Notes popover?).
            localStorage.setItem('dg_cover_identity', 'Test Player');
        } catch (e) {}
    """)

    page.goto(f"{BASE}/hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function(
        "() => { var f = document.getElementById('dg-shell-content'); "
        "return f.contentDocument && f.contentDocument.readyState === 'complete'; }")
    # Load Notes into the shell's own content iframe -- same mechanism a
    # real "Notes" link click uses, just driven directly here rather
    # than clicking through Agent Hub's roster first.
    page.evaluate("() => { document.getElementById('dg-shell-content').src = 'notes/index.html?code=ELVI-HENC'; }")
    page.wait_for_function(
        "() => { var f = document.getElementById('dg-shell-content'); "
        "return f.contentDocument && f.contentDocument.readyState === 'complete' "
        "&& /notes\\/index\\.html/.test(f.contentWindow.location.href); }")

    frame = page.frame_locator("#dg-shell-content")
    wait_for_condition(lambda: page.eval_on_selector(
        "#dg-shell-content", "el => !!(el.contentDocument && el.contentDocument.querySelector('.dg-notes-identity-modal'))"
    ), timeout_ms=8000)
    frame.locator(".dg-notes-color-swatch").first.click()
    frame.locator(".dg-notes-identity-confirm").click()
    wait_for_condition(lambda: page.eval_on_selector(
        "#dg-shell-content", "el => !!(el.contentDocument && el.contentDocument.querySelector('#dg-notes-editor-mount .ce-block'))"
    ), timeout_ms=8000)

    record("shell", "the shell's own widgets start out visible (not hidden before any popover ever opened)",
           page.eval_on_selector("#dg-radio", "el => el.style.visibility") != "hidden", "")

    # A real block's own "+" button, not a simulated class toggle --
    # exercises Editor.js's actual popover-open code path.
    frame.locator(".ce-block").first.hover()
    frame.locator(".ce-toolbar__plus").click()
    wait_for_condition(lambda: page.eval_on_selector(
        "#dg-shell-content", "el => !!(el.contentDocument && el.contentDocument.querySelector('.ce-popover--opened'))"
    ), timeout_ms=6000)

    record("shell", "opening the real block-type picker hides the shell's Table Radio widget",
           page.eval_on_selector("#dg-radio", "el => el.style.visibility") == "hidden", "")
    record("shell", "opening the real block-type picker hides the shell's Dice Roller widget",
           page.eval_on_selector("#dr-panel", "el => el.style.visibility") == "hidden", "")

    # Close it by clicking elsewhere in the document.
    frame.locator("body").click(position={"x": 5, "y": 5})
    wait_for_condition(lambda: page.eval_on_selector(
        "#dg-shell-content", "el => !(el.contentDocument && el.contentDocument.querySelector('.ce-popover--opened'))"
    ), timeout_ms=6000)

    record("shell", "closing the picker restores the shell's Table Radio widget",
           page.eval_on_selector("#dg-radio", "el => el.style.visibility") != "hidden", "")
    record("shell", "closing the picker restores the shell's Dice Roller widget",
           page.eval_on_selector("#dr-panel", "el => el.style.visibility") != "hidden", "")

    record("shell", "no JS exceptions", len(errs) == 0, "; ".join(errs))
    page.close()
    return errs

def test_agent_portal_code_query_param(p):
    """One Agent by code: agent-hub.html?code=CODE opens that Agent's tab
    with their whole file loaded -- looked up and added when they aren't
    on this device yet -- and the retired three-tab Agent Portal's old
    addresses forward to the right place (dg-agent-portal.html is only a
    forwarding page now): ?code=#agent -> the Agent's file, #cover -> its
    photos, #ids -> the Field ID Fabricator, which lives in the notebook."""
    errs_all = []

    def fake_apps_script(route):
        url = route.request.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            # Every #dg-form [required] field: a complete Appearance brief.
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
    _block_fonts(page)
    jsonp_backend(page, fake_apps_script)
    page.goto(f"{BASE}/agent-hub.html?code=OWEN-CS12", wait_until="domcontentloaded", timeout=15000)
    af = _af_state(page)
    record("agent-file", "?code= opens that Agent's tab with their file, even when they weren't on this device yet",
           af.get("inTab") and af.get("code") == "OWEN-CS12"
           and "active" in (page.eval_on_selector('.tw[data-tab="OWEN-CS12"]', "el => el.className") or ""), json.dumps(af))
    record("agent-file", "…and adds them to this device's roster",
           "OWEN-CS12" in json.loads(page.evaluate("localStorage.getItem('dg_agent_roster')") or "{}"), "")
    record("agent-file", "a complete Appearance brief shows folded ('On file') with the era photos open",
           af.get("state") == "On file" and not af.get("open") and af.get("photosLocked") is False, json.dumps(af))
    record("agent-file", "the Appearance brief carries that Agent's data (name on the form, profession on file)",
           page.eval_on_selector("#dg-form [name=char_name]", "el => el.value") == "Owen Castillo"
           and page.evaluate("() => window.dgAgentFile.data() && window.dgAgentFile.data().profession") == "Pilot", "")
    errs_all.extend(errs)
    page.close()

    for old, want in (("#agent", "/agent-hub.html?code=OWEN-CS12"), ("#cover", "/agent-hub.html?code=OWEN-CS12#photos"),
                      ("#ids", "/hub.html?fn=fab")):
        page = p.new_page()
        page.set_default_timeout(8000)
        _block_fonts(page)
        jsonp_backend(page, fake_apps_script)
        page.route("**/hub.html*", lambda r: r.fulfill(status=200, content_type="text/html", body="<!doctype html><title>hub</title>"))
        page.goto(f"{BASE}/dg-agent-portal.html?code=OWEN-CS12{old}", wait_until="domcontentloaded", timeout=15000)
        wait_for_condition(lambda: want in page.url, timeout_ms=8000)
        record("agent-file", "the retired Agent Portal address ?code=…%s forwards to %s" % (old, want), want in page.url, page.url)
        if old == "#ids":
            record("agent-file", "…with that Agent set as the notebook's, for the Fabricator",
                   page.evaluate("localStorage.getItem('dg_stats_cloud_code')") == "OWEN-CS12", "")
        page.close()
    return errs_all

def test_agent_portal_profiling_gate(p):
    """Era photos are made from the Appearance brief, so they only open
    once it is "filled out totally" -- every #dg-form [required] field has
    a real value (isProfilingComplete()), not just "an Agent File exists".
    a carry-over from the character sheet writes a real but partial one (name/sex/nationality/
    profession/build/outfit only, agent-portal-export.js's run()). Such
    an Agent's file shows Appearance open, with how much is left, the
    already-known fields carried over, and no photos yet; the Random
    Agent Generator fills only the rest, never rerolling what's known."""
    errs_all = []

    def partial_fake_apps_script(route):
        url = route.request.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            # Shaped like the carry-over's partial brief.
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
    _block_fonts(page)
    jsonp_backend(page, partial_fake_apps_script)
    page.goto(f"{BASE}/agent-hub.html?code=MARK-DL01", wait_until="domcontentloaded", timeout=15000)
    af = _af_state(page)
    record("agent-file", "an incomplete brief (auto-export shape) shows Appearance open, with how many details are left",
           af.get("open") and af.get("state") == "13 of 22 still to fill in", json.dumps(af))
    record("agent-file", "no era photos for an incomplete brief",
           af.get("photosLocked") is True and page.eval_on_selector("#af-content", "el => el.style.display") == "none", json.dumps(af))
    record("agent-file", "the callout under Play says the same",
           page.eval_on_selector("#ah-callout-MARK-DL01", "el => !el.hidden && el.textContent.indexOf('13 of 22') !== -1"), "")
    record("agent-file", "no Edit/Close toggle while it's incomplete (it stays open)",
           page.eval_on_selector("#af-appear-toggle", "el => el.hidden"), "")
    record("agent-file", "the already-known fields carry over into Appearance",
           page.eval_on_selector("#dg-form [name=char_name]", "el => el.value") == "Mark Delacroix"
           and page.eval_on_selector("#dg-form [name=build]", "el => el.value") == "muscular"
           and page.evaluate("() => window.dgAgentFile.data().profession") == "Federal Agent", "")

    # Random Generate must not reroll the fields the (auto-)export
    # already established -- only fill in the rest of the blank brief.
    page.evaluate("randomizeAgent(null)")
    page.wait_for_timeout(200)
    record("agent-file", "Random Generate leaves the already-known name untouched",
           page.eval_on_selector("#dg-form [name=char_name]", "el => el.value") == "Mark Delacroix", "")
    record("agent-file", "Random Generate leaves the already-known build (from STR) untouched",
           page.eval_on_selector("#dg-form [name=build]", "el => el.value") == "muscular", "")
    record("agent-file", "Random Generate leaves the already-known sex untouched",
           page.eval_on_selector("#dg-form [name=sex]", "el => el.value") == "Male", "")
    record("agent-file", "Random Generate DOES fill in a field that was genuinely still blank (face_shape)",
           page.eval_on_selector("#dg-form [name=face_shape]", "el => el.value") != "", "")

    errs_all.extend(errs)
    page.close()
    return errs_all

def test_mobile_no_overflow(p):
    """Regression check: no page should force horizontal scroll on a phone
    viewport."""
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
    route_apps_script_ok(page)
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
    route_apps_script_ok(page)
    skip_acell_gate(page)
    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(400)
    # v3.13.0: at 390px A-Cell is its phone layout (Evidence from the tabs,
    # New evidence from its own bar), not the computer's tab strip.
    page.evaluate("() => window.dgAcm && window.dgAcm.go('evidence')")
    page.wait_for_timeout(400)
    page.click("#acm-evbar [data-ev=new]")
    page.wait_for_timeout(400)
    scroll_width = page.evaluate("() => document.documentElement.scrollWidth")
    record("mobile", "a-cell.html's Evidence tab (sidebar + open create form) has no horizontal overflow at 390px viewport",
           scroll_width <= 390, f"scrollWidth={scroll_width}")
    errs_all.extend(errs)
    page.close()

    # The Field ID Fabricator "tablet" is its own dense grid layout (260px sidebar +
    # card preview), collapsing to a single column under 700px -- worth
    # checking on its own rather than trusting the Cover tab's check above
    # to cover it.
    page = p.new_page(viewport={"width": 390, "height": 844})
    page.set_default_timeout(5000)
    errs = collect_errors(page)
    mock_routes(page)
    page.goto(f"{BASE}/field-id.html?embed=1", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(300)
    scroll_width = page.evaluate("() => document.documentElement.scrollWidth")
    record("mobile", "the Field ID Fabricator (field-id.html) has no horizontal overflow at 390px viewport",
           scroll_width <= 390, f"scrollWidth={scroll_width}")
    errs_all.extend(errs)
    page.close()
    return errs_all

def test_agent_portal_cover(p, agent):
    """Appearance (the Profiling brief) on an Agent's Agent Hub tab: an
    Agent with only a started brief gets it open; the Random Agent
    Generator offers every profession; filling it in and submitting saves
    it under that Agent's own code, folds Appearance to "On file" and
    opens the era photos."""
    code = (re.sub(r"[^A-Z]", "", agent["char_name"].upper()) + "XXXX")[:4] + "-AP01"
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    _block_fonts(page)
    install_firestore_backend(page, {"briefs/" + code: {"char_name": agent["char_name"], "agent_code": code}})
    page.goto(f"{BASE}/agent-hub.html?code={code}", wait_until="domcontentloaded", timeout=15000)
    af = _af_state(page)
    record("agent-file", "an Agent with a started brief opens with Appearance unfolded and no photos yet",
           af.get("code") == code and af.get("open") and af.get("photosLocked") is True, json.dumps(af))

    opt_count = page.eval_on_selector_all("#rand-profession option", "els => els.length")
    record("agent-file", "profession dropdown has full list (regression)", opt_count >= 15, f"{opt_count} options")
    prof_id = agent.get("profession_id", "")
    if prof_id and page.locator(f"#rand-profession option[value={prof_id}]").count():
        _open_appearance(page)
        page.select_option("#rand-profession", prof_id)
        page.locator("button:has-text('Generate')").first.click()
        page.wait_for_timeout(200)
        record("agent-file", f"random agent generator for profession '{prof_id}'", page.is_visible("#rand-result-bar"), "")

    fill_cover_form(page, agent, "#dg-form")
    page.click("#submit-btn")
    wait_for_condition(lambda: (fs_doc(page, "briefs/" + code) or {}).get("submitted_at"), timeout_ms=8000)
    saved = fs_doc(page, "briefs/" + code) or {}
    af = _af_state(page)
    record("agent-file", "submitting saves the brief under this Agent's own code",
           saved.get("face_shape") == agent.get("face_shape") and saved.get("agent_code") == code, str({k: saved.get(k) for k in ("agent_code", "face_shape")}))
    record("agent-file", "…folds Appearance to 'On file' and opens the era photos",
           af.get("state") == "On file" and not af.get("open") and af.get("photosLocked") is False, json.dumps(af))
    record("agent-file", "…and the callout under Play is gone",
           page.eval_on_selector("#ah-callout-" + code, "el => el.hidden"), "")
    page.close()
    return errs, code

def test_agent_portal_random_generator_matches_sex(p):
    """Regression test for an older request: the Random Agent Generator
    (generateAgent(), assets/appearance-gen.js) rolls a
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
        route_apps_script_ok(page)
        page.add_init_script(f"Math.random = () => {forced_roll};")
        page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
        page.wait_for_timeout(300)
        # The generator is shared now (assets/appearance-gen.js): Agent
        # Hub's Appearance brief and the sheet's Appearance step both use it.
        a = page.evaluate("() => window.dgAppearanceGen.generate(null)")
        sex_val, facial_val, hair_val = a.get("sex"), a.get("facial_hair"), a.get("hair_style")
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
    were purely decorative (the submit button is type="submit" in a form
    with onsubmit="return false"), so a brief could be submitted with
    blanks and then never open the era photos, with no pointer at what
    was missing. handleSubmit() calls form.reportValidity() first and
    bails out if anything required is blank."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    _block_fonts(page)
    install_firestore_backend(page, {"briefs/IVYI-NC01": {"char_name": "Incomplete Ivy", "agent_code": "IVYI-NC01"}})
    page.goto(f"{BASE}/agent-hub.html?code=IVYI-NC01", wait_until="domcontentloaded", timeout=15000)
    _af_state(page)
    _open_appearance(page)
    page.click("#submit-btn")
    page.wait_for_timeout(400)
    saved = fs_doc(page, "briefs/IVYI-NC01") or {}
    record("agent-file", "submitting with required fields blank does not save the brief",
           not saved.get("submitted_at"), str(saved))
    invalid_count = page.eval_on_selector_all("#dg-form [required]:invalid", "els => els.length")
    record("agent-file", "the browser flags the blank required fields as invalid",
           invalid_count > 0, f"invalid_count={invalid_count}")
    record("agent-file", "no JS exceptions", len(errs)==0, "; ".join(errs))
    page.close()
    return errs

def test_agent_portal_submit_reuses_roster_code(p):
    """The Appearance brief always describes the Agent whose Agent Hub tab
    it is in, so it saves under that Agent's code -- renaming them renames
    them. (On the standalone Agent Portal the code was guessed from the
    name or the roster, and a renamed or freshly typed Agent got a second,
    disconnected code: two files for one Agent.) The hub's tab and title
    follow the new name."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    _block_fonts(page)
    install_firestore_backend(page, {"briefs/ROST-X001": dict(MOCK_BRIEF, char_name="Rosa Stone", agent_code="ROST-X001")})
    page.goto(f"{BASE}/agent-hub.html?code=ROST-X001#appearance", wait_until="domcontentloaded", timeout=15000)
    _af_state(page)
    page.wait_for_function("() => document.getElementById('af-appear').classList.contains('af-open')", timeout=8000)
    page.evaluate("() => { const s = document.querySelector('#dg-form [name=age_range]'); if (s && !s.checkValidity()) s.selectedIndex = 1; }")
    page.fill("#dg-form [name=char_name]", "Rosa Stern")
    page.click("#submit-btn")
    wait_for_condition(lambda: (fs_doc(page, "briefs/ROST-X001") or {}).get("char_name") == "Rosa Stern", timeout_ms=8000)
    briefs = page.evaluate("() => Object.keys(window.__dgFirestoreDocs || {}).filter(k => k.indexOf('briefs/') === 0)")
    record("agent-file", "renaming an Agent in Appearance saves under their own code, never a second Agent",
           (fs_doc(page, "briefs/ROST-X001") or {}).get("char_name") == "Rosa Stern" and briefs == ["briefs/ROST-X001"], str(briefs))
    wait_for_condition(lambda: page.text_content("#ah-title-ROST-X001") == "Rosa Stern", timeout_ms=4000)
    record("agent-file", "…and the Agent's tab and title follow the new name",
           page.text_content("#ah-title-ROST-X001") == "Rosa Stern" and "Rosa" in page.text_content("#ah-tablabel-ROST-X001"),
           page.text_content("#ah-title-ROST-X001") + " / " + page.text_content("#ah-tablabel-ROST-X001"))
    record("agent-file", "no JS exceptions", len(errs) == 0, "; ".join(errs))
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
    jsonp_backend(page, fake_apps_script)

    page.goto(f"{BASE}/agent-hub.html?code=DANI-U8BM", wait_until="domcontentloaded", timeout=15000)
    # Condition-based, not a fixed 1.2s: the prompt requests are staggered
    # by setTimeout and could miss a fixed window under full-suite load.
    _pump_until(page, lambda: {p_.get("mode") for p_ in prompt_posts} >= {"base", "outfit"}, 6000)

    base_posts = [p_ for p_ in prompt_posts if p_.get("mode") == "base"]
    outfit_posts = [p_ for p_ in prompt_posts if p_.get("mode") == "outfit"]
    record("agent-portal", "the Field Portrait (mode: base) prompt request carries the Agent's actual era",
           len(base_posts) >= 1 and base_posts[0].get("era") == "00s", str(base_posts))
    record("agent-portal", "the Field Reference (mode: outfit) prompt request carries the Agent's actual era too",
           len(outfit_posts) >= 1 and outfit_posts[0].get("era") == "00s", str(outfit_posts))


def test_agent_file_era_prompts_isolated_per_era(p):
    """Regression test for a real player-reported bug: 'When I add an
    era, lets say I had 1990s, then I add 2000s, all the info moves to
    2000s and 1990s comes up as empty on agent file.' Root cause: every
    era's Field Portrait/Reference prompt (and Face/Outfit Plate) shared
    the same four flat sheet columns (mode0_prompt/mode1_prompt/
    face_plate_url/outfit_plate_url) regardless of which era was being
    edited, so generating a second era's prompt silently overwrote the
    first era's. Fixed by writing era-specific columns
    (era_<era>_mode0/mode1/face_url/outfit_url) instead. Sets up two
    active eras -- 90s already has both prompts saved, 00s has neither
    (so renderEraStack()'s auto-generate only fires for 00s) -- and
    checks the resulting update_field POST targets era_00s_mode0/mode1
    (not the shared flat fields, and not 90s's own era-specific fields),
    and that 90s's displayed prompt is completely unchanged afterward."""
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
        "active_eras": json.dumps(["90s", "00s"]),
        # 90s already has both prompts -- renderEraStack()'s
        # `if (!mode0 || !mode1)` auto-generate guard must skip it.
        "era_90s_mode0": "Existing 90s portrait prompt, do not touch.",
        "era_90s_mode1": "Existing 90s reference prompt, do not touch.",
        # 00s has neither -- must auto-generate.
        "era_00s_mode0": "", "era_00s_mode1": "",
        # Legacy flat columns intentionally left populated too, mirroring
        # a real pre-fix Agent -- must never be touched by this fix
        # either (write-side only stops using them; the columns
        # themselves aren't cleared).
        "mode0_prompt": "Stale legacy flat value.", "mode1_prompt": "Stale legacy flat value.",
    }
    briefs = {"DANI-U8BM": {"char_name": "Daniela Martinez", **complete_extra}}
    prompt_posts = []
    field_posts = []

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            body = json.loads(req.post_data or "{}")
            action = body.get("action")
            if action == "generate_prompt":
                prompt_posts.append(body)
                mock_prompt = "[mock 00s prompt for mode " + body.get("mode", "?") + "]"
                route.fulfill(status=200, content_type="application/json",
                               body=json.dumps({"status": "OK", "prompt": mock_prompt}))
            elif action == "update_field":
                field_posts.append(body)
                route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
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
    jsonp_backend(page, fake_apps_script)

    page.goto(f"{BASE}/agent-hub.html?code=DANI-U8BM", wait_until="domcontentloaded", timeout=15000)
    # Auto-generate is staggered (500ms + idx*200ms per era in
    # renderEraStack()) and 00s is the second era rendered -- give it
    # real headroom to actually fire and its mocked round trip to land.
    page.wait_for_timeout(2000)

    era00_field_posts = [b for b in field_posts if b.get("field") in ("era_00s_mode0", "era_00s_mode1")]
    record("agent-portal", "auto-generating 00s's missing prompts writes to era-specific fields, not the shared flat ones",
           len(era00_field_posts) == 2, str(field_posts))

    stale_field_posts = [b for b in field_posts if b.get("field") in
                          ("mode0_prompt", "mode1_prompt", "era_90s_mode0", "era_90s_mode1")]
    record("agent-portal", "generating 00s's prompts never writes to 90s's fields or the shared flat fields",
           len(stale_field_posts) == 0, str(stale_field_posts))

    era90_mode0_val = page.input_value("#prompt-mode0-90s")
    era90_mode1_val = page.input_value("#prompt-mode1-90s")
    record("agent-portal", "90s's own displayed prompts are completely unchanged after 00s auto-generates",
           era90_mode0_val == "Existing 90s portrait prompt, do not touch."
           and era90_mode1_val == "Existing 90s reference prompt, do not touch.",
           f"mode0={era90_mode0_val!r} mode1={era90_mode1_val!r}")

    era00_mode0_val = page.input_value("#prompt-mode0-00s")
    era00_mode1_val = page.input_value("#prompt-mode1-00s")
    record("agent-portal", "00s's displayed prompts are populated with the newly generated values",
           era00_mode0_val.startswith("[mock 00s prompt") and era00_mode1_val.startswith("[mock 00s prompt"),
           f"mode0={era00_mode0_val!r} mode1={era00_mode1_val!r}")

    record("agent-portal", "no console errors on the era-isolation flow", len(errs) == 0, str(errs))
    page.close()


def test_agent_file_era_age_adjusts_per_era(p):
    """Regression test for a real player-reported follow-up: an Agent
    registered as (say) Late 40s in the 2020s era should read as
    noticeably younger in an earlier era's portrait -- specifically
    "if an agent registers 40s in 2020s, the 2000s should be in her
    20s". ageRangeForEra_() (dg-agent-portal.html) computes this from
    the reference era (eras[0]/afEraPages[0] -- wherever age_range was
    actually entered) and a fixed decade-year map (90s/00s/10s/20s ->
    1990/2000/2010/2020), floored at Early 20s so nobody reads as a
    literal child. Three active eras -- 20s (reference, Late 40s),
    00s, and 90s -- checks the generate_prompt request for each
    non-reference era carries the correctly age-shifted character.age_range,
    not the flat, unadjusted value."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    complete_extra = {
        "age_range": "Late 40s", "sex": "Female", "nationality": "Hispanic American",
        "face_shape": "oval", "eye_color": "brown", "eye_shape": "round",
        "nose": "straight", "lips": "thin", "skin": "tan", "facial_hair": "none",
        "hair_color": "black", "hair_style": "short", "hair_texture": "straight",
        "build": "average", "posture": "upright", "jacket": "coat", "shirt": "shirt",
        "trousers": "trousers", "footwear": "boots", "expression": "neutral", "vibe": "calm",
        "active_eras": json.dumps(["20s", "00s", "90s"]),
        "era_20s_mode0": "Existing 20s portrait.", "era_20s_mode1": "Existing 20s reference.",
        "era_00s_mode0": "", "era_00s_mode1": "", "era_90s_mode0": "", "era_90s_mode1": "",
    }
    briefs = {"AGED-E20A": {"char_name": "Daniela Martinez", **complete_extra}}
    prompt_posts = []

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            body = json.loads(req.post_data or "{}")
            if body.get("action") == "generate_prompt":
                prompt_posts.append(body)
                route.fulfill(status=200, content_type="application/json",
                               body=json.dumps({"status": "OK", "prompt": "[mock]"}))
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
    jsonp_backend(page, fake_apps_script)

    page.goto(f"{BASE}/agent-hub.html?code=AGED-E20A", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(2500)

    ages_by_era = {}
    for pp in prompt_posts:
        ages_by_era.setdefault(pp.get("era"), pp.get("character", {}).get("age_range"))

    record("agent-portal", "the 2000s era's prompt age is shifted 20 years younger than the 2020s reference (Late 40s -> Late 20s)",
           ages_by_era.get("00s") == "Late 20s", str(ages_by_era))
    record("agent-portal", "the 1990s era's prompt age is floored at Early 20s rather than going unrealistically young",
           ages_by_era.get("90s") == "Early 20s", str(ages_by_era))

    record("agent-portal", "no console errors on the age-adjustment flow", len(errs) == 0, str(errs))
    page.close()
    return errs

def test_agent_file_medical_aar_archived(p):
    """Medical History and After-Action Reports were archived (not
    removed) from the Agent File at the requester's ask -- everything
    backing them (medical_log/aar_log sheet columns, Code.gs's
    update_medical/update_aar actions, the render/save JS) is untouched,
    only the two lines that ever flipped #af-medical/#af-aar to
    display:block were pulled. Loads an Agent with real entries in both
    logs (so there'd be visible content if the sections showed at all)
    and confirms neither section is visible."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    complete_extra = {
        "age_range": "30s", "sex": "Female", "nationality": "American",
        "face_shape": "oval", "eye_color": "brown", "eye_shape": "almond",
        "nose": "straight", "lips": "thin", "skin": "tan", "facial_hair": "clean-shaven",
        "hair_color": "brown", "hair_style": "short", "hair_texture": "straight",
        "build": "average", "posture": "upright", "expression": "neutral", "vibe": "calm",
        "jacket": "coat", "shirt": "shirt", "trousers": "trousers", "footwear": "boots",
        "medical_log": json.dumps([{"date": "2026-01-01", "severity": "moderate",
                                     "body_part": "Left arm", "injury": "Laceration", "description": "Knife wound."}]),
        "aar_log": json.dumps([{"date": "2026-01-02", "operation": "Operation Nightfall",
                                 "location": "Abandoned warehouse", "scene": "Something bad happened."}]),
    }
    briefs = {"MEDX-AR01": {"char_name": "Test Agent", **complete_extra}}

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
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

    page.goto(f"{BASE}/agent-hub.html?code=MEDX-AR01", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(800)

    record("agent-portal", "Medical History is not visible even though this Agent has a real entry on file",
           page.locator("#af-medical").is_visible() is False, "")
    record("agent-portal", "After-Action Reports is not visible even though this Agent has a real entry on file",
           page.locator("#af-aar").is_visible() is False, "")
    record("agent-portal", "no console errors from an Agent carrying archived-feature data", len(errs) == 0, str(errs))
    page.close()
    return errs

def test_agent_file_active_era_toggle(p):
    """New feature: an explicit toggle for which era's Face Plate is the
    Agent's "preview" photo (the one every OTHER surface -- roster tray,
    Field ID card -- shows, since none of them know about the per-era
    columns). Two active eras, both with a Face Plate on file -- the
    first/oldest era (afEraPages[0]) should read as the Active Era by
    default (matching what face_plate_url already held before this
    feature existed), with a "Make Active Era" button on the other one.
    Clicking it must: flip which era shows the "Active Era" badge, and
    persist BOTH campaign_era (the new field) and face_plate_url (so
    every existing preview surface picks up the new photo with no
    changes of its own) via update_field. A third era with no Face
    Plate yet must still offer the toggle -- an earlier pass at this
    hid it whenever there was no photo yet, but marking an era active
    ahead of generating its photo is a real, useful order of
    operations, not just a display choice."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    complete_extra = {
        "age_range": "30s", "sex": "Female", "nationality": "American",
        "face_shape": "oval", "eye_color": "brown", "eye_shape": "almond",
        "nose": "straight", "lips": "thin", "skin": "tan", "facial_hair": "clean-shaven",
        "hair_color": "brown", "hair_style": "short", "hair_texture": "straight",
        "build": "average", "posture": "upright", "expression": "neutral", "vibe": "calm",
        "jacket": "coat", "shirt": "shirt", "trousers": "trousers", "footwear": "boots",
        "active_eras": json.dumps(["90s", "00s", "10s"]),
        "era_90s_face_url": "https://drive.google.com/uc?id=fake90sface",
        "era_90s_mode0": "existing", "era_90s_mode1": "existing",
        "era_00s_face_url": "https://drive.google.com/uc?id=fake00sface",
        "era_00s_mode0": "existing", "era_00s_mode1": "existing",
        # No era_10s_face_url -- this era has no Face Plate yet.
        "era_10s_mode0": "", "era_10s_mode1": "",
    }
    briefs = {"ERAT-OGL01": {"char_name": "Test Agent", **complete_extra}}
    field_posts = []

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            body = json.loads(req.post_data or "{}")
            if body.get("action") == "update_field":
                field_posts.append(body)
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
    jsonp_backend(page, fake_apps_script)
    # Real Drive photo URLs would normally load through loadDriveImage()'s
    # own JSONP proxy -- irrelevant to this test (only the toggle's own
    # logic/network calls matter), and no route is registered for it, so
    # nothing here needs to intercept it.

    page.goto(f"{BASE}/agent-hub.html?code=ERAT-OGL01", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(800)
    _open_era(page)

    # text-transform:uppercase is CSS-only -- Playwright's inner_text()
    # returns the rendered text, so this compares case-insensitively
    # rather than against the literal "Active Era" HTML content.
    record("agent-portal", "the first/oldest era (90s) reads as the Active Era by default",
           "active era" in page.inner_text("#era-preview-90s").lower(), page.inner_text("#era-preview-90s"))
    record("agent-portal", "the other era (00s) offers a Make Active Era button instead",
           page.locator("#era-preview-00s button").count() == 1, "")
    # This Agent's stored main-photo copy is empty although its default
    # Active Era (90s) has a Plate: opening the Agent File repairs it
    # (healMainPhoto(), see test_main_photo_from_active_era).
    load_posts = [b for b in field_posts if b.get("field") == "face_plate_url"]
    record("agent-portal", "opening the Agent File fills the empty main-photo copy with the default Active Era's Plate",
           len(load_posts) == 1 and load_posts[0].get("value") == "gdrive:fake90sface", str(load_posts))
    del field_posts[:]

    page.click("#era-preview-00s button")
    page.wait_for_timeout(300)

    record("agent-portal", "clicking it flips the badge to the 00s era",
           "active era" in page.inner_text("#era-preview-00s").lower(), page.inner_text("#era-preview-00s"))
    record("agent-portal", "the 90s era now offers Make Active Era instead (no longer the active one)",
           page.locator("#era-preview-90s button").count() == 1, "")

    campaign_era_posts = [b for b in field_posts if b.get("field") == "campaign_era"]
    record("agent-portal", "campaign_era was persisted with the newly-chosen era",
           len(campaign_era_posts) == 1 and campaign_era_posts[0].get("value") == "00s", str(field_posts))

    face_plate_posts = [b for b in field_posts if b.get("field") == "face_plate_url"]
    record("agent-portal", "face_plate_url (the flat field every other preview surface reads) was updated to the 00s era's photo",
           len(face_plate_posts) == 1 and face_plate_posts[0].get("value") == "https://drive.google.com/uc?id=fake00sface",
           str(field_posts))

    # A third era with no Face Plate yet -- the toggle must still work.
    record("agent-portal", "an era with no Face Plate yet still offers the Make Active Era button",
           page.locator("#era-preview-10s button").count() == 1, "")
    page.click("#era-preview-10s button")
    page.wait_for_timeout(300)
    record("agent-portal", "clicking it flips the badge to the photo-less era too",
           "active era" in page.inner_text("#era-preview-10s").lower(), page.inner_text("#era-preview-10s"))
    campaign_era_posts_2 = [b for b in field_posts if b.get("field") == "campaign_era"]
    record("agent-portal", "campaign_era was persisted with the photo-less era",
           campaign_era_posts_2[-1].get("value") == "10s" if campaign_era_posts_2 else False, str(field_posts))
    face_plate_posts_2 = [b for b in field_posts if b.get("field") == "face_plate_url"]
    record("agent-portal", "face_plate_url was set to empty (no photo to show yet), not left stale on the 00s era's photo",
           face_plate_posts_2[-1].get("value") == "" if face_plate_posts_2 else False, str(field_posts))

    record("agent-portal", "no console errors on the active-era toggle flow", len(errs) == 0, str(errs))
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
    jsonp_backend(page, fake_apps_script)

    page.goto(f"{BASE}/agent-hub.html?code=NOFA-CE01", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(800)
    _open_era(page)

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
    # The prompt sent is no longer the bare textarea value: when a Face
    # Plate reference image is attached, generatePlateImage() appends an
    # explicit override telling Gemini to use the reference for facial
    # identity only, not framing -- otherwise Gemini's image-to-image
    # generation anchors on the reference's own tight headshot crop and
    # the "full body" instructions above get ignored (see that fix's
    # commit). Match on startswith rather than equality for that reason.
    page.click('button[data-mode="mode1"]:has-text("Generate Image")')
    page.wait_for_timeout(500)
    outfit_posts = [p_ for p_ in plate_posts if (p_.get("prompt") or "").startswith("outfit prompt")]
    record("agent-portal", "generating the Outfit Plate after the Face Plate exists sends a generate_plate_image request",
           len(outfit_posts) == 1, str(outfit_posts))
    record("agent-portal", "the Outfit Plate request carries the just-generated Face Plate as its reference image",
           len(outfit_posts) == 1 and outfit_posts[0].get("reference_image_base64") == "data:image/png;base64,RkFDRURBVEE=",
           str(outfit_posts))
    record("agent-portal", "the Outfit Plate prompt tells Gemini to ignore the reference image's framing, not just its face",
           len(outfit_posts) == 1 and "ignore its framing" in outfit_posts[0].get("prompt", ""),
           str(outfit_posts[0].get("prompt") if outfit_posts else None))
    # The function sizes the image by this: 9:16 full body for an Outfit
    # Plate, 3:4 for a Face Plate (functions/index.js generatePlateImage).
    record("agent-portal", "plate requests say which plate they are (outfit -> tall full-body frame on the server)",
           len(outfit_posts) == 1 and outfit_posts[0].get("plate_type") == "outfit"
           and len(face_posts) == 1 and face_posts[0].get("plate_type") == "face",
           f"{[x.get('plate_type') for x in face_posts]} {[x.get('plate_type') for x in outfit_posts]}")

    record("agent-portal", "no JS exceptions", len(errs) == 0, "; ".join(errs))
    page.close()
    return errs

def test_agent_file_vitals_and_bonds(p):
    """Vitals (HP/WP/SAN/BP) and Bond scores -- once only visible to a
    Handler in A-Cell's Play view -- show on the Agent's file in Agent Hub
    (the sheet in their tab, assets/agent-sheet.js), read from the Agent's
    saved character. Also regression-tests a bug caught while building
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
    jsonp_backend(page, fake_apps_script)

    page.goto(f"{BASE}/agent-hub.html?code=VITL-0001", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_selector("#ah-sheet-VITL-0001 .ap-vitals", timeout=10000)
    vit = page.inner_text("#ah-sheet-VITL-0001 .ap-vitals").upper()
    record("agent-file", "HP/WP/SAN/BP show the saved sheet's actual values on the Agent's file",
           all(re.search(lab + r"\D*" + val + r"\b", vit) for lab, val in (("HP", "11"), ("WP", "9"), ("SAN", "55"), ("BP", "20"))), vit)
    bonds_text = page.inner_text("#ah-sheet-VITL-0001")
    record("agent-file", "both Bonds show up with their names",
           "Marcus Webb" in bonds_text and "Delta Green" in bonds_text, bonds_text[:400])
    zero = page.evaluate("""() => [].some.call(document.querySelectorAll('#ah-sheet-VITL-0001 .ap-bond'), r => /Marcus Webb/.test(r.textContent) && (r.querySelector('.ap-bscore') || {}).textContent === '0')""")
    record("agent-file", "a Bond with a legitimate score of 0 still shows 0, not hidden as if it had no score", zero, "")
    record("agent-file", "the other Bond's non-zero score also shows",
           page.evaluate("""() => [].some.call(document.querySelectorAll('#ah-sheet-VITL-0001 .ap-bond'), r => /Delta Green/.test(r.textContent) && (r.querySelector('.ap-bscore') || {}).textContent === '12')"""), "")

    record("agent-file", "no JS exceptions", len(errs) == 0, "; ".join(errs))
    page.close()
    return errs

def test_agent_roster(p):
    """Several Agents on one device (dg_agent_roster -- the Hub's tabs; the
    Agent Portal's old roster drawer is gone with the portal). Agent Hub
    has ONE Agent File, moved into whichever tab is open: filling in and
    saving each Agent's Appearance in turn must always load and save the
    open tab's Agent (afCode/afData never left on the previous one), and
    the roster keeps all of them -- agentToken(), dice-roller.js's
    currentAgentCode() and the Cover Identity search all read it."""
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    _block_fonts(page)
    names = {"MARC-RS01": "Marcus Reyes", "PRIY-AN02": "Priya Anand", "OWEN-CS03": "Owen Castillo"}
    install_firestore_backend(page, {"briefs/" + c: {"char_name": n, "agent_code": c} for c, n in names.items()})
    roster = {c: {"code": c, "char_name": n, "saved_at": 1000 + i} for i, (c, n) in enumerate(names.items())}
    page.add_init_script("try { if (!sessionStorage.getItem('__seeded')) { localStorage.setItem('dg_agent_roster', %s); sessionStorage.setItem('__seeded', '1'); } } catch (e) {}" % json.dumps(json.dumps(roster)))
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    for code, name in names.items():
        page.click('.tw[data-tab="%s"] > span' % code)
        page.wait_for_function("(c) => window.dgAgentFile.code() === c", arg=code, timeout=5000)
        af = _af_state(page)
        record("agent-roster", f"opening {name}'s tab loads their file into it, Appearance open",
               af.get("inTab") and af.get("code") == code and af.get("open")
               and page.eval_on_selector("#dg-form [name=char_name]", "el => el.value") == name, json.dumps(af))
        fill_cover_form(page, {
            "char_name": name, "nationality": "American", "face_shape": "oval",
            "eye_color": "brown", "eye_shape": "round", "nose": "straight", "lips": "thin",
            "skin": "tan", "facial_hair": "clean-shaven", "hair_color": "brown",
            "hair_style": "short", "hair_texture": "straight", "build": "average",
            "posture": "upright", "jacket": "coat", "shirt": "shirt", "trousers": "trousers",
            "footwear": "boots", "expression": "neutral", "vibe": "unremarkable",
        }, "#dg-form")
        page.click("#submit-btn")
        wait_for_condition(lambda: (fs_doc(page, "briefs/" + code) or {}).get("submitted_at"), timeout_ms=8000)
        record("agent-roster", f"afCode/afData reflect the just-submitted Agent ({name}), not a stale prior one",
               page.evaluate("() => afCode") == code and page.evaluate("() => afData && afData.char_name") == name
               and (fs_doc(page, "briefs/" + code) or {}).get("face_shape") == "oval", "")

    kept = page.evaluate("() => JSON.parse(localStorage.getItem('dg_agent_roster') || '{}')")
    record("agent-roster", "all 3 Agents stay in the roster store (agentToken()/dice-roller.js's currentAgentCode() read it)",
           sorted(kept.keys()) == sorted(names.keys()), f"keys={sorted(kept.keys())}")
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

    pages = ["index.html", "agent-hub.html", "a-cell.html", "dg-agent-portal.html", "dg-id-creator.html", "404.html"]
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
    pointing at sw.js (or ../sw.js from notes/)."""
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

    # notes/index.html included: it's in SHELL_FILES and registers the
    # service worker via assets/sw-update.js same as every other page
    # (a real gap this app once had -- Notes silently had no offline
    # support or update-check registration at all, see the sw-update.js
    # comment on this file).
    pages = ["index.html", "agent-hub.html", "a-cell.html", "dg-agent-portal.html", "dg-id-creator.html", "notes/index.html"]

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


def test_notes_pwa_update_banner(p):
    """Regression test for a real live report: a player (Levi) opened
    Notes on an iPad and saw a long-since-removed old screen -- Notes
    was the one page in the app that never included assets/sw-update.js,
    so a tab left open there (exactly the kind of "always on" tab this
    app expects for Notes, same as Table Radio) had no service worker
    registration call of its own and no way to notice or prompt a
    reload when a new version had already taken over the tab. Same
    check as test_pwa_update_banner above, pointed at notes/index.html."""
    context = p.new_context()
    page = context.new_page()
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    errs = collect_errors(page)

    page.goto(f"{BASE}/notes/index.html", wait_until="load", timeout=15000)
    wait_for_condition(lambda: page.evaluate("() => !!navigator.serviceWorker.controller"), timeout_ms=15000)

    record("pwa", "Notes registers the service worker same as every other page",
           page.evaluate("() => !!navigator.serviceWorker.controller"), "")

    page.evaluate("() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange'))")
    page.wait_for_timeout(200)

    banner = page.query_selector("#dg-update-banner")
    record("pwa", "Notes shows the update banner after a controllerchange event",
           banner is not None, "")

    record("pwa", "no JS exceptions", len(errs) == 0, "; ".join(errs))
    page.close()


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
    install_notes_firestore_stub(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    cell = {"cell_id": "cell_1", "name": "Cell Alpha", "handler": "Sam",
            "member_codes": ["OWEN-CS12", "PRIY-AN34"]}
    # notes.js's getAllCellsOnce() reads this straight from Firestore
    # now, not list_cells (see that function's own comment) -- the
    # list_cells mock below is kept for other unrelated JSONP actions
    # this page still uses, but Cell resolution itself needs this seed.
    seed_cells_docs(page, [cell])
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

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            body = json.loads(req.post_data or "{}")
            posts.append(body)
            if body.get("action") == "save_agent_identity":
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

    # Deliver the initial Firestore snapshots -- notes.js's real content
    # listeners (see NOTES_FIRESTORE_STUB's own comment) only exist once
    # startNotesListeners() actually subscribes, which happens async
    # behind ensureAgentSignedIn()'s fake sign-in, so wait for both to
    # register before pushing. Only PRIY-AN34's two SHARED blocks go to
    # the shared listener (b2 is private -- a real Firestore query with
    # `.where('shared','==',true)` would never return it, same privacy
    # boundary the old JSONP mock enforced manually); OWEN has written
    # nothing yet, so the own listener's first snapshot is empty.
    wait_for_condition(lambda: notes_firestore_listener_count(page) >= 2, timeout_ms=8000)
    push_firestore_snapshot(page, "cells/cell_1/notes", [["shared", "==", True]],
                             [dict(blocks_state[0], id="b1"), dict(blocks_state[2], id="b3")])
    push_firestore_snapshot(page, "cells/cell_1/notes", [["agent_code", "==", "OWEN-CS12"]], [])

    wait_for_condition(lambda: page.query_selector("#dg-notes-editor-mount .ce-block") is not None, timeout_ms=6000)
    record("notes", "your own tab mounts a live Editor.js instance", page.query_selector("#dg-notes-editor-mount") is not None, "")

    # Type a paragraph and confirm the debounced save posts the right
    # per-block JSON shape (block_type is Editor.js's own tool name;
    # text is a JSON-stringified block data object, not our old custom
    # markup string).
    page.click(".ce-block [contenteditable]")
    page.keyboard.type("Session 3 Notes")
    saved = wait_for_condition(lambda: next((w for w in firestore_writes(page, "cells/cell_1/notes/") if w["data"].get("agent_code") == "OWEN-CS12"), None), timeout_ms=25000)
    record("notes", "typing fires a debounced save writing the right per-block shape straight to Firestore",
           bool(saved) and saved["data"].get("block_type") == "paragraph"
           and json.loads(saved["data"].get("text") or "{}").get("text") == "Session 3 Notes" and saved["data"].get("shared") is False,
           json.dumps(saved) if saved else "no Firestore write captured")

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
    # A fixed short sleep here raced on a slower/colder CI runner --
    # same "renderer needs a nudge to tick" latency this suite's other
    # post-event waits already work around (see the Circulate wait
    # below), just not applied here originally. Poll for the actual
    # content instead of guessing a sleep long enough.
    wait_for_condition(lambda: (page.evaluate("1"), "Priya's shared note" in page.content())[1], timeout_ms=8000)
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
    wait_for_condition(lambda: (page.evaluate("1"), page.locator(".dg-notes-timeline-group").count() == 2)[1], timeout_ms=8000)
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
    clear_firestore_writes(page)
    circulate.click()
    toggled = wait_for_condition(lambda: next((w for w in firestore_writes(page, "cells/cell_1/notes/") if w["data"].get("agent_code") == "OWEN-CS12"), None), timeout_ms=25000)
    record("notes", "toggling Circulate on the focused block saves shared:true",
           bool(toggled) and toggled["data"].get("shared") is True, json.dumps(toggled) if toggled else "no Firestore write captured")
    record("notes", "the Circulate button shows an active state once toggled on",
           "active" in (circulate.get_attribute("class") or ""), "")

    # Pin: same "acts on the focused block" toggle mechanism as
    # Circulate. Pinned blocks get their own section in the sidebar,
    # above the normal Index.
    pin_btn = page.locator(".dg-notes-pin-btn")
    record("notes", "the Pin button is enabled once a block is focused",
           pin_btn.get_attribute("disabled") is None, "")
    clear_firestore_writes(page)
    pin_btn.click()
    pinned_post = wait_for_condition(lambda: next((w for w in firestore_writes(page, "cells/cell_1/notes/") if w["data"].get("agent_code") == "OWEN-CS12"), None), timeout_ms=25000)
    record("notes", "toggling Pin on the focused block saves pinned:true",
           bool(pinned_post) and pinned_post["data"].get("pinned") is True, json.dumps(pinned_post) if pinned_post else "no Firestore write captured")
    record("notes", "the Pin button shows an active state once toggled on",
           "active" in (pin_btn.get_attribute("class") or ""), "")
    # .dg-notes-toc-subhead is CSS-uppercased, same as .dg-notes-toc-label.
    toc_pinned = wait_for_condition(lambda: (page.evaluate("1"), "pinned" in (page.locator("#dg-notes-toc-mount").inner_text() or "").lower())[1], timeout_ms=8000)
    record("notes", "a pinned block gets its own Pinned section in the Index sidebar",
           bool(toc_pinned), page.locator("#dg-notes-toc-mount").inner_text())

    # The toolbar's Tag button (whole-block tags) was retired in v3.5.2:
    # tagging is by highlighting words (test_notes_tags_quick_and_arrange).
    record("notes", "the toolbar has no Tag button (tagging is by highlighting words)",
           page.locator(".dg-notes-tag-btn").count() == 0, "")

    # Cross-tab search: normally the search box only filters whichever
    # tab is active -- "Search everywhere" widens the sidebar into a
    # combined Search Results list spanning your own blocks (any
    # privacy) plus everyone else's shared blocks, each tagged with
    # which tab it came from.
    page.fill(".dg-notes-search", "shared note")
    page.check(".dg-notes-search-everywhere")
    wait_for_condition(lambda: (page.evaluate("1"), "PRIY-AN34" in (page.locator("#dg-notes-toc-mount").inner_text() or ""))[1], timeout_ms=8000)
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
    install_notes_firestore_stub(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    cell = {"cell_id": "cell_1", "name": "Cell Alpha", "handler": "Sam", "member_codes": ["OWEN-CS12", "PRIY-AN34"],
            "member_names": {"OWEN-CS12": "Owen Castillo", "PRIY-AN34": "Priya Anand"}}
    seed_cells_docs(page, [cell])
    seed_characters_docs(page, [{"agent_code": "OWEN-CS12", "name": "Owen Castillo"}, {"agent_code": "PRIY-AN34", "name": "Priya Anand"}])
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
    imgdata_calls = {"n": 0}

    def fake_apps_script(route):
        req = route.request
        url = req.url
        if req.method == "POST":
            body = json.loads(req.post_data or "{}")
            posts.append(body)
            action = body.get("action")
            if action == "mark_evidence_seen":
                seen_map[body.get("evidence_id")] = True
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        if "action=imgdata" in url:
            imgdata_calls["n"] += 1
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
    page.route("**/script.google.com/**", fake_apps_script)  # the Drive image proxy
    # Seen marks are Firestore evidence_seen/{code}_{id} docs now.
    install_firestore_backend(page, {"evidence_seen/OWEN-CS12_" + k: {"agent_code": "OWEN-CS12", "evidence_id": k}
                                     for k in seen_map})

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

    # Deliver the initial Firestore snapshots -- see
    # NOTES_FIRESTORE_STUB's own comment for why the old list_cell_notes/
    # list_evidence JSONP mock data above no longer reaches the app at
    # all (both are live Firestore listeners now). Three listeners:
    # Notes own (b1, OWEN's private header), Notes shared (rem1, Priya's
    # Circulated evidence_remark), and Evidence itself (ev1/ev2).
    wait_for_condition(lambda: notes_firestore_listener_count(page) >= 3, timeout_ms=8000)
    push_firestore_snapshot(page, "cells/cell_1/notes", [["agent_code", "==", "OWEN-CS12"]],
                             [dict(notes_blocks[0], id="b1")])
    push_firestore_snapshot(page, "cells/cell_1/notes", [["shared", "==", True]],
                             [dict(notes_blocks[1], id="rem1")])
    push_firestore_snapshot(page, "evidence", [["visible_to", "array-contains-any", ["OWEN-CS12", "ALL"]]],
                             [dict(e, id=e["evidence_id"]) for e in evidence_fixture])

    page.wait_for_selector("#dg-notes-editor-mount .ce-block", timeout=10000)
    wait_for_condition(lambda: (page.evaluate("1"), page.locator(".dg-notes-evidence-item").count() == 2)[1], timeout_ms=8000)

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
    wait_for_condition(lambda: (page.evaluate("1"), page.is_visible(".dg-notes-evidence-modal"))[1], timeout_ms=8000)
    record("notes", "clicking an Evidence item opens a detail modal with its title and body",
           page.is_visible(".dg-notes-evidence-modal") and "Coroner's Report" in page.inner_text(".dg-notes-evidence-body")
           and "Cause of death" in page.inner_text(".dg-notes-evidence-body"), "")
    record("notes", "a Cell-mate's existing Circulated remark shows in the Remarks thread, attributed to them",
           "blood spatter" in page.inner_text(".dg-notes-evidence-body") and "Priya Anand" in page.inner_text(".dg-notes-evidence-body"), "")
    record("notes", "opening it saves a seen mark for this Agent and this item",
           (fs_doc(page, "evidence_seen/OWEN-CS12_ev1") or {}).get("evidence_id") == "ev1",
           str(fs_writes(page, "evidence_seen/")))
    record("notes", "its gdrive-backed photo resolves and renders as a real image",
           page.locator(".dg-notes-evidence-photo-img").count() == 1, "")

    # Regression: a live report described the Evidence photo flickering
    # in and out in the popup -- traced to the poll tick (POLL_MS)
    # unconditionally rebuilding an open modal, including re-blanking
    # the photo to its loading placeholder and re-fetching it from
    # Drive every single tick, even though the photo never changed. A
    # real network round trip makes that blank gap visible; this mock
    # resolves near-instantly, so the reliable signature to check for
    # is the redundant re-fetch itself, not a DOM-visibility sample
    # that could miss a sub-poll-interval blink. Wait past two full
    # poll ticks and confirm imgdata was only ever fetched once -- POLL_MS
    # is now 8000 + up to 2000 jitter (was a flat 5000), so worst case
    # two ticks take up to 20s.
    calls_after_first_resolve = imgdata_calls["n"]
    page.wait_for_timeout(21000)
    record("notes", "the resolved Evidence photo is not re-fetched from Drive on later poll ticks",
           imgdata_calls["n"] == calls_after_first_resolve,
           f"calls after first resolve={calls_after_first_resolve}, calls now={imgdata_calls['n']}")
    record("notes", "the resolved Evidence photo is still showing after two poll ticks, not blanked back to loading",
           page.locator(".dg-notes-evidence-photo-img").count() == 1, "")

    clear_firestore_writes(page)
    page.fill(".dg-notes-evidence-remark-input", "Check the neighbor's alibi.")
    page.click(".dg-notes-evidence-remark-add")
    remark_write = wait_for_condition(lambda: next((w for w in firestore_writes(page, "cells/cell_1/notes/")
                                                      if w["data"].get("block_type") == "evidence_remark"), None))
    record("notes", "adding a remark (Share unchecked) writes a private evidence_remark block straight to Firestore",
           bool(remark_write) and json.loads(remark_write["data"].get("text") or "{}").get("evidence_id") == "ev1"
           and remark_write["data"].get("shared") is False, str(remark_write))
    record("notes", "the new remark appears in the thread immediately, marked Private",
           "Check the neighbor's alibi" in page.inner_text(".dg-notes-evidence-remarks-list")
           and "PRIVATE" in page.inner_text(".dg-notes-evidence-remarks-list").upper(), "")

    del_btn = page.locator(".dg-notes-evidence-remark-del")
    record("notes", "only your own remark shows a delete control, not a Cell-mate's",
           del_btn.count() == 1, "")
    clear_firestore_writes(page)
    del_btn.click()
    delete_write = wait_for_condition(lambda: next((w for w in firestore_writes(page, "cells/cell_1/notes/") if w["op"] == "delete"), None))
    record("notes", "deleting your own remark deletes it straight from Firestore",
           bool(delete_write), str(delete_write))
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


def test_notes_operations_read_firestore(p):
    """Notes' Evidence Operation tags read Firestore operations -- no
    Apps Script call."""
    page = p.new_page()
    page.set_default_timeout(10000)
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    install_firestore_backend(page, {
        "cells/cell_1": {"name": "Cell Alpha", "handler": "Sam", "member_codes": ["OWEN-CS12"],
                         "member_names": {"OWEN-CS12": "Owen Castillo"}},
        "characters/OWEN-CS12": character_doc("OWEN-CS12", {"bio": {"name": "Owen Castillo"}}, ""),
        "agent_identity/OWEN-CS12": {"agent_code": "OWEN-CS12", "color": "#2f855a", "font": "kalam"},
        "operations/op_fs": {"operation_id": "op_fs", "cell_id": "cell_1", "name": "Mirrored Op", "created_at": 2},
    })
    apps_script = watch_apps_script(page)
    page.add_init_script("""
        try { localStorage.setItem('dg_agent_roster', JSON.stringify({
            'OWEN-CS12': { code: 'OWEN-CS12', char_name: 'Owen Castillo', saved_at: Date.now() } })); } catch (e) {}
    """)
    page.goto(f"{BASE}/notes/index.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_selector(".dg-notes-identity-modal, #dg-notes-editor-mount", timeout=10000)
    if page.query_selector(".dg-notes-identity-modal"):
        page.click(".dg-notes-color-swatch")
        page.click(".dg-notes-identity-confirm")
    wait_for_condition(lambda: notes_firestore_listener_count(page) >= 3, timeout_ms=8000)
    push_firestore_snapshot(page, "evidence", [["visible_to", "array-contains-any", ["OWEN-CS12", "ALL"]]], [
        {"id": "ev1", "evidence_id": "ev1", "title": "Mirrored Item", "body": "", "photo": "", "cell_id": "cell_1", "operation_id": "op_fs", "created_at": "2000"}])
    wait_for_condition(lambda: "Mirrored Op" in page.inner_text("#dg-notes-evidence-mount"), timeout_ms=8000)
    txt = page.inner_text("#dg-notes-evidence-mount")
    record("notes", "an Operation from Firestore labels its Evidence", "Mirrored Op" in txt, txt[:200])
    page.wait_for_timeout(500)
    record("notes", "Notes makes no Apps Script call (the Sheet is retired)", apps_script == [], str(apps_script))
    record("notes", "no JS errors reading Operations from Firestore", not errs, str(errs))
    page.close()

def test_notes_evidence_photo_loading_indicator(p):
    """Live report: opening an Evidence item "feels slow" -- the actual
    cause is the imgdata proxy round-trip (Code.gs fetching the Drive
    file server-side and re-encoding it as base64) taking a real couple
    of seconds, during which the photo slot used to just sit there as a
    blank div. Added a flavor-text loading placeholder
    (.dg-notes-evidence-loading) so that wait has something to look at.
    Holds the imgdata response back deliberately (unlike the near-instant
    mock in test_notes_evidence_integration above) and releases it
    explicitly, so the loading state is actually observable rather than
    resolving before the first assertion runs."""
    page = p.new_page()
    page.set_default_timeout(10000)
    errs = collect_errors(page)
    install_notes_firestore_stub(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    cell = {"cell_id": "cell_1", "name": "Cell Alpha", "handler": "Sam", "member_codes": ["OWEN-CS12"],
            "member_names": {"OWEN-CS12": "Owen Castillo"}}
    seed_cells_docs(page, [cell])
    evidence_fixture = [
        {"evidence_id": "ev1", "title": "Coroner's Report", "body": "Cause of death listed as accidental.",
         "photo": "gdrive:fake123", "cell_id": "", "operation_id": "", "created_at": "2000"},
    ]
    fake_png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    # Held back rather than fulfilled synchronously, and released later
    # from the main thread (see the wait_for_timeout below) -- calling
    # route.fulfill() from a background Timer hits Playwright sync API's
    # "Cannot switch to a different thread" greenlet error, since it
    # isn't safe to drive the connection from anywhere but the thread
    # that owns it.
    held_imgdata_routes = []

    def fake_apps_script(route):
        req = route.request
        url = req.url
        if req.method == "POST":
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        if "action=imgdata" in url:
            held_imgdata_routes.append(route)
            return
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            if "action=list_cells" in url:
                res = {"status": "OK", "cells": [cell]}
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

    wait_for_condition(lambda: notes_firestore_listener_count(page) >= 3, timeout_ms=8000)
    push_firestore_snapshot(page, "cells/cell_1/notes", [["agent_code", "==", "OWEN-CS12"]], [])
    push_firestore_snapshot(page, "cells/cell_1/notes", [["shared", "==", True]], [])
    push_firestore_snapshot(page, "evidence", [["visible_to", "array-contains-any", ["OWEN-CS12", "ALL"]]],
                             [dict(e, id=e["evidence_id"]) for e in evidence_fixture])

    wait_for_condition(lambda: page.locator(".dg-notes-evidence-item").count() == 1, timeout_ms=8000)
    page.click('[data-evidence-id="ev1"]')
    wait_for_condition(lambda: page.is_visible(".dg-notes-evidence-modal"), timeout_ms=8000)
    wait_for_condition(lambda: len(held_imgdata_routes) >= 1, timeout_ms=8000)

    record("notes", "opening an Evidence item with a slow-to-resolve photo shows a loading placeholder, not a blank box",
           page.is_visible(".dg-notes-evidence-loading") and page.inner_text(".dg-notes-evidence-loading").strip() != "",
           page.inner_html(".dg-notes-evidence-body"))

    # Release the held imgdata request now, simulating the real proxy's
    # round-trip finally landing.
    route = held_imgdata_routes.pop()
    cb = route.request.url.split("callback=")[1].split("&")[0]
    route.fulfill(status=200, content_type="application/javascript",
                   body=f'{cb}({json.dumps({"status": "OK", "dataUri": fake_png})})')

    wait_for_condition(lambda: page.locator(".dg-notes-evidence-photo-img").count() == 1, timeout_ms=8000)
    record("notes", "the loading placeholder is gone once the photo actually resolves",
           page.locator(".dg-notes-evidence-loading").count() == 0, "")

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
    install_notes_firestore_stub(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    cell = {"cell_id": "cell_1", "name": "Cell Alpha", "handler": "Sam", "member_codes": ["OWEN-CS12"]}
    seed_cells_docs(page, [cell])
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

    # Notes content is delivered via live Firestore onSnapshot listeners
    # now (Firebase migration Phase 5), not the JSONP list_cell_notes
    # response above -- that fixture is only reused for its bundled
    # identities map. Feed the pre-existing block through the stub once
    # both listeners have actually subscribed.
    wait_for_condition(lambda: notes_firestore_listener_count(page) >= 2, timeout_ms=8000)
    push_firestore_snapshot(page, "cells/cell_1/notes", [["agent_code", "==", "OWEN-CS12"]],
                             [dict(blocks_state[0], id="b0")])
    push_firestore_snapshot(page, "cells/cell_1/notes", [["shared", "==", True]], [])

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

    # Stale assertion removed: this used to click a "Change Agent"
    # button (#change-context-btn) that returned to the picker. That
    # button no longer exists -- notes/index.html's own code comment
    # ("Split View/Character Sheet need to know which Agent's sheet to
    # open, replacing the old 'Change Agent' button that lived in the
    # same spot") documents its deliberate removal in favor of direct
    # navigation to the character sheet. What actually replaced it: the
    # change-context row (Split View / Character Sheet buttons) becomes
    # visible once notes are open for the URL-forced Agent.
    record("notes", "the old Change Agent button's replacement (Character Sheet; Split View is retired) is shown for the URL-forced Agent",
           page.is_visible("#change-context-row") and page.is_visible("#character-sheet-btn") and not page.is_visible("#split-view-btn"), "")

    page.close()
    return errs


def test_notes_solo_mode_for_unassigned_agent(p):
    """Regression test for a real live report: a fresh Kappa Black import
    (not yet placed in any Cell by the Handler) opened Notes and hit a
    dead end -- 'Your Agent isn't assigned to a Cell yet -- ask your
    Handler.' The player asked for a graceful fallback instead: open
    Notes and let them write today, using a synthesized per-Agent
    pseudo-cell ('solo:'+agentCode -- see notes/index.html's
    soloCellId()) so all the existing Cell-scoped save/list plumbing
    works unchanged; only the Shared tab is hidden, since nobody else is
    in this pseudo-cell to share with. When a Handler later actually
    assigns the Agent to a real Cell, updateCellMembers() (Code.gs)
    migrates these rows onto the real cell_id server-side -- covered
    separately by the Node-level verification in this session, not here
    (Code.gs isn't exercised by this Playwright suite)."""
    page = p.new_page()
    page.set_default_timeout(15000)
    errs = collect_errors(page)
    install_notes_firestore_stub(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

    posts = []

    def fake_apps_script(route):
        req = route.request
        if req.method == "POST":
            posts.append(json.loads(req.post_data or "{}"))
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
            return
        url = req.url
        if "callback=" in url:
            cb = url.split("callback=")[1].split("&")[0]
            if "action=list_cells" in url:
                # No Cell anywhere lists this Agent as a member.
                res = {"status": "OK", "cells": [{"cell_id": "cell_1", "name": "Cell Alpha",
                                                    "handler": "Sam", "member_codes": ["OTHR-CODE"]}]}
            elif "action=list_cell_notes" in url:
                res = {"status": "OK", "notes": {}, "identities": {}}
            else:
                res = {"status": "OK"}
            route.fulfill(status=200, content_type="application/javascript", body=f'{cb}({json.dumps(res)})')
        else:
            route.fulfill(status=200, content_type="application/json", body='{"status":"OK"}')
    page.route("**/script.google.com/**", fake_apps_script)

    page.add_init_script("""
        try {
            localStorage.setItem('dg_agent_roster', JSON.stringify({
                'ELVI-HENC': { code: 'ELVI-HENC', char_name: 'Elvis Shantings', saved_at: Date.now() }
            }));
        } catch (e) {}
    """)
    page.goto(f"{BASE}/notes/index.html", wait_until="domcontentloaded", timeout=15000)

    wait_for_condition(lambda: page.query_selector(".dg-notes-identity-modal") is not None, timeout_ms=6000)
    page.click(".dg-notes-color-swatch")
    page.click(".dg-notes-identity-confirm")
    wait_for_condition(lambda: page.query_selector(".dg-notes-identity-modal") is None, timeout_ms=6000)
    # Wait for Editor.js's own block to actually be there, not just the
    # mount div -- clicking/typing before Editor.js's async init settles
    # (or before the first fetchNotes() poll's own re-render lands) races
    # against a remount that would drop the keystrokes.
    wait_for_condition(lambda: page.query_selector("#dg-notes-editor-mount .ce-block") is not None, timeout_ms=6000)

    record("notes", "an unassigned Agent gets a live, editable Notes panel instead of the old blocking 'ask your Handler' message",
           page.query_selector("#dg-notes-editor-mount") is not None and page.locator("#picker-wrap:not(.hidden)").count() == 0,
           page.inner_text("#picker-status") if page.locator("#picker-wrap:not(.hidden)").count() else "(picker hidden, panel shown)")

    record("notes", "solo mode hides the Shared tab -- there's nobody else in this pseudo-cell to share with",
           page.locator('[data-tab="__shared__"]').count() == 0, "")
    record("notes", "solo mode still shows the Agent's own tab",
           page.locator('[data-tab="ELVI-HENC"]').count() == 1, "")

    page.click(".ce-block [contenteditable]")
    page.keyboard.type("Working alone for now")
    saved = wait_for_condition(
        lambda: next((w for w in firestore_writes(page, "cells/solo:ELVI-HENC/notes/") if w["data"].get("agent_code") == "ELVI-HENC"), None),
        timeout_ms=25000)
    record("notes", "writing in solo mode actually saves straight to Firestore, keyed under the synthesized solo:<code> pseudo-cell",
           bool(saved) and json.loads(saved["data"].get("text") or "{}").get("text") == "Working alone for now",
           json.dumps(saved) if saved else "no Firestore write captured")

    record("notes", "no JS exceptions", len(errs) == 0, "; ".join(errs))
    page.close()
    return errs


def test_split_view_retired(p):
    """Notes' own Split View button stays hidden wherever the notebook
    runs, standalone and inside the Hub shell: the notebook's Split mode
    puts the Agent File beside Notes instead."""
    errs_all = []
    for path, btn in ((f"notes/index.html?code={FN_CODE}", "#split-view-btn"),):
        page, errs = _field_notes_page(p)
        page.goto(f"{BASE}/{path}", wait_until="domcontentloaded", timeout=15000)
        page.wait_for_function("() => window.dgFieldNotes && window.dgFieldNotes.isHost", timeout=10000)
        page.wait_for_timeout(800)
        record("notebook", f"{path.split('?')[0]}: no Split View button", page.locator(btn).count() == 0 or not page.is_visible(btn), "")
        errs_all.extend(errs)
        page.close()
    page, errs = _field_notes_page(p)
    page.goto(f"{BASE}/hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function("() => window.dgFieldNotes && window.dgFieldNotes.isHost", timeout=10000)
    page.evaluate("(c) => { document.getElementById('dg-shell-content').src = 'notes/index.html?code=' + c; }", FN_CODE)
    page.wait_for_timeout(3000)
    fr = page.frame_locator("#dg-shell-content")
    record("notebook", "inside the Hub shell: no Split View button on Notes",
           fr.locator("#split-view-btn").count() == 0 or not fr.locator("#split-view-btn").is_visible(), "")
    errs_all.extend(errs)
    page.close()
    return errs_all

def test_cell_members_by_name_and_kia(p):
    """The Cell on an Agent's paper (Agent Hub and the notebook's Agent
    File) lists each member by name, never by Agent Code: the Agent File's
    name, else the name on their character sheet; a member whose sheet is
    at 0 HP is marked KIA."""
    errs_all = []
    docs = _field_notes_docs()
    docs[f"cells/{FN_CELL}"]["member_codes"] = [FN_CODE, FN_MATE, "NONA-0001", "DEAD-0002"]
    docs["briefs/NONA-0001"] = {"agent_code": "NONA-0001"}  # an Agent File with no name on it
    docs["characters/NONA-0001"] = character_doc("NONA-0001", {"v": 1, "bio": {"name": "Ruth Okafor"}, "derived": {"hp": 11}}, "x")
    docs["characters/DEAD-0002"] = character_doc("DEAD-0002", {"v": 1, "bio": {"name": "Sam Doyle"}, "derived": {"hp": 0}}, "y")
    extra = "localStorage.setItem('dg_fn_orders_ack', JSON.stringify({'%s': 1790000000000}));" % FN_CODE
    page, errs = _field_notes_page(p, docs=docs, extra_init=extra)
    page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
    _open_cell(page, code=FN_CODE)
    page.wait_for_selector(f"#ah-sheet-{FN_CODE} .ap-init li", timeout=15000)
    page.wait_for_timeout(500)
    rows = page.eval_on_selector_all(f"#ah-sheet-{FN_CODE} .ap-init li", "els => els.map(e => [e.querySelector('.as-mname').textContent, e.classList.contains('as-kia'), !!e.querySelector('.as-stamp')])")
    names = [r[0] for r in rows]
    # The Cell is the initiative list now: this Agent included, by DEX,
    # with KIA members last.
    record("hub", "Agent Hub's Cell lists members by name (Agent File, else character sheet), not by code",
           sorted(names) == sorted(["Mara Voss", "Tom Hale", "Ruth Okafor", "Sam Doyle"]) and names[-1] == "Sam Doyle", str(rows))
    record("hub", "…and a member at 0 HP is marked KIA (only them)",
           [r[1] and r[2] for r in rows] == [False, False, False, True], str(rows))
    page.evaluate("() => window.dgFieldNotes.open('agentfile')")
    nbp = page.locator("#fn-veil .as-paper.ap").filter(visible=True).first
    nbp.wait_for(timeout=15000)
    _open_cell(page, nbp)
    page.wait_for_selector("#fn-veil .ap-init li", timeout=15000)
    nb = page.eval_on_selector_all("#fn-veil .ap-init li", "els => els.map(e => [e.querySelector('.as-mname').textContent, e.classList.contains('as-kia')])")
    record("notebook", "the notebook's Agent File lists the same Cell by name, with KIA marked",
           nb == [[r[0], r[1]] for r in rows], str(nb))
    page.evaluate("() => window.dgFieldNotes.open('fieldid')")
    page.wait_for_selector("#fn-veil [data-go=fab]", timeout=10000)
    record("notebook", "Field ID offers the Fabricator only (no Blank ID Creator)",
           page.locator("#fn-veil [data-go=blank]").count() == 0 and "Blank ID" not in page.inner_text("#fn-veil"), "")
    errs_all.extend(errs)
    page.close()
    return errs_all

def test_add_bond_in_play(p):
    """At the table: + Bond on the Agent File (Agent Hub and the notebook)
    adds a Bond to an Agent already in play, score = CHA, saved straight
    away; a Cell member picked from the list is a Delta Green Bond."""
    errs_all = []
    docs = _field_notes_docs()
    st = json.loads(docs[f"characters/{FN_CODE}"]["character_json"])
    st["stats"] = st["csStats"] = {"STR": 10, "CON": 10, "DEX": 10, "INT": 10, "POW": 10, "CHA": 13}
    docs[f"characters/{FN_CODE}"] = character_doc(FN_CODE, st, "fn tester")
    page, errs = _field_notes_page(p, docs=docs, extra_init="localStorage.setItem('dg_fn_orders_ack', JSON.stringify({'%s': 1790000000000}));" % FN_CODE)
    page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_selector(f"#ah-sheet-{FN_CODE} [data-pop=bond]", timeout=15000)
    page.click(f"#ah-sheet-{FN_CODE} [data-pop=bond]")
    page.fill(f"#ah-sheet-{FN_CODE} [data-u=bond-name]", "Father Ruiz")
    page.fill(f"#ah-sheet-{FN_CODE} [data-u=bond-rel]", "Priest")
    page.click(f"#ah-sheet-{FN_CODE} [data-a=bond-add]")
    saved = wait_for_condition(lambda: [b for b in json.loads((fs_doc(page, f"characters/{FN_CODE}") or {}).get("character_json") or "{}").get("bonds", []) if b.get("name") == "Father Ruiz"] or None, timeout_ms=8000)
    record("bonds", "Agent Hub's Agent File: + Bond adds one with score = CHA, saved to the Agent's record",
           bool(saved) and saved[0]["score"] == 13 and saved[0]["relationship"] == "Priest", str(saved))
    record("bonds", "…and it shows on the paper with − / + for its score",
           "Father Ruiz" in page.inner_text(f"#ah-sheet-{FN_CODE} .as-sheet") and page.locator(f"#ah-sheet-{FN_CODE} [data-a='bond+']").count() == 2, "")
    # A Cell member, picked from the list, is a Delta Green Bond.
    page.click(f"#ah-sheet-{FN_CODE} [data-pop=bond]")
    opts = page.eval_on_selector_all(f"#ah-sheet-{FN_CODE} [data-u=bond-cell] option", "els => els.map(e => e.value)")
    page.select_option(f"#ah-sheet-{FN_CODE} [data-u=bond-cell]", "Tom Hale")
    filled = [page.input_value(f"#ah-sheet-{FN_CODE} [data-u=bond-name]"), page.input_value(f"#ah-sheet-{FN_CODE} [data-u=bond-rel]")]
    page.click(f"#ah-sheet-{FN_CODE} [data-a=bond-add]")
    tom = wait_for_condition(lambda: [b for b in json.loads((fs_doc(page, f"characters/{FN_CODE}") or {}).get("character_json") or "{}").get("bonds", []) if b.get("name") == "Tom Hale"] or None, timeout_ms=8000)
    record("bonds", "+ Bond offers the Cell's members; picking one makes a Delta Green Bond",
           "Tom Hale" in opts and filled == ["Tom Hale", "Delta Green"] and bool(tom) and tom[0]["relationship"] == "Delta Green", str(opts) + str(filled))
    page.evaluate("() => window.dgFieldNotes.open('agentfile')")
    page.wait_for_selector("#fn-veil .as-paper [data-pop=bond]", timeout=15000)
    record("bonds", "the notebook's Agent File has the same + Bond (no link to the sheet)",
           page.locator("#fn-veil [data-go=addbond]").count() == 0 and "Father Ruiz" in page.inner_text("#fn-veil .as-paper"), "")
    errs_all.extend(errs)
    page.close()
    return errs_all

def test_agent_file_san_roll_and_member_cards(p):
    """The Agent File (the notebook's quick look and Agent Hub's paper):
    a Roll SAN button by the key stats (d100 against current SAN), and each
    Cell member shown with their photo; tapping a member opens their card
    with photo, name, cover and HP/WP/SAN/BP."""
    errs_all = []
    png = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
    docs = _field_notes_docs()
    stats = {"STR": 10, "CON": 12, "DEX": 11, "INT": 14, "POW": 11, "CHA": 13}
    docs[f"characters/{FN_CODE}"] = character_doc(FN_CODE, {"v": 1, "bio": {"name": "Mara Voss", "player_name": "fn tester"},
        "stats": stats, "csStats": stats, "derived": {"hp": 11, "wp": 11, "san": 55, "bp": 44}}, "fn tester")
    docs[f"briefs/{FN_MATE}"]["face_plate_url"] = png
    docs[f"characters/{FN_MATE}"] = character_doc(FN_MATE, {"v": 1, "bio": {"name": "Tom Hale"},
        "derived": {"hp": 9, "wp": 10, "san": 45, "bp": 36}}, "x")
    extra = "localStorage.setItem('dg_fn_orders_ack', JSON.stringify({'%s': 1790000000000}));" % FN_CODE
    spy = "() => { window.__rolls = []; const r = window.dgDice.roll; window.dgDice.roll = function (t, l) { window.__rolls.push([t, l]); return r.apply(this, arguments); }; }"

    def check(page, root, where):
        # The notebook keeps more than one copy of a page; use the one on screen.
        paper = page.locator(root + " .as-paper").filter(visible=True).first
        paper.locator("[data-a=rollsan]").wait_for(timeout=15000)
        _open_cell(page, paper, FN_CODE)
        paper = page.locator(root + " .as-paper").filter(visible=True).first
        paper.locator(".as-mthumb img").first.wait_for(timeout=8000)
        record("agent-file", where + ": a Cell member shows with their photo",
               paper.locator(".as-mthumb img").first.get_attribute("src") == png, "")
        paper.locator(".as-mbtn[data-a=card]").first.click()
        card = paper.locator(".as-mcard").inner_text()
        record("agent-file", where + ": tapping a member opens their card (name, cover, HP/WP/SAN/BP)",
               "Tom Hale" in card and "Cover “TIN CUP”" in card and all(x in card for x in ("9", "10", "45", "36"))
               and paper.locator(".as-mcard img").count() == 1, card)
        paper.locator(".as-mbtn[data-a=card]").first.click()
        record("agent-file", where + ": tapping again closes it", paper.locator(".as-mcard").is_hidden(), "")
        # Last: in the notebook a roll turns to the Dice Roller page.
        page.evaluate(spy)
        paper.locator("[data-a=rollsan]").click()
        rolls = page.evaluate("() => window.__rolls")
        record("agent-file", where + ": Roll SAN by the key stats rolls d100 against current SAN",
               rolls[:1] == [[55, "SAN"]], str(rolls))

    page, errs = _field_notes_page(p, docs=docs, extra_init=extra)
    page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
    check(page, f"#ah-sheet-{FN_CODE}", "Agent Hub")
    page.evaluate("() => window.dgFieldNotes.open('agentfile')")
    check(page, "#fn-veil", "Field Notes")
    errs_all.extend(errs)
    page.close()
    return errs_all

def test_agent_file_v2_play_and_edit(p):
    """v2: the Agent File is the character sheet (assets/agent-paper.js,
    agent-rules.js, agent-live.js). Played at the table with every change
    saved to the Agent's record: HP/WP/SAN − / +, SAN loss as the Handler
    announced it (no d100 inside) and the post-its it sets off -- a
    disorder that triggers on losing 2+ SAN, temporary insanity at 5+,
    Breaking Point with a new disorder and BP reset to SAN − POW, an
    incident ticked and the third one adapting the Agent (Violence: −1D6
    CHA and from every Bond) -- a failed skill roll marking the skill red,
    Roll improvements (+1D4 each, marks cleared), Bonds. Edit mode works
    on a copy: Save asks for the Oath (N: back to editing, nothing saved;
    Y: saved), Cancel throws the copy away. The Rules page opens with the
    Mission & Standing Orders, not the Oath."""
    errs_all = []
    stats = {"STR": 10, "CON": 12, "DEX": 11, "INT": 14, "POW": 11, "CHA": 13}
    state = {"v": 1, "stats": stats, "csStats": dict(stats), "derived": {"hp": 9, "wp": 8, "san": 52, "bp": 44},
             "bio": {"name": "Mara Voss", "player_name": "fn tester", "profession": "federal_agent", "employer": "FBI",
                     "motivations": "Protect my sister", "disorders": ["Paranoia"]},
             "skills": {"alertness": 60, "firearms": 50, "accounting": 10},
             "bonds": [{"id": "b1", "name": "Lena Voss", "relationship": "Sister", "score": 11},
                       {"id": "b2", "name": "Dr. Paul Ames", "relationship": "Therapist", "score": 13}],
             "sanity": {"violence": [True, False, False], "helplessness": [False, False, False]},
             "lpCheckedSkills": [{"type": "key", "key": "firearms"}],
             "lpWeapons": [{"name": "Glock 17", "skillPct": "50", "damage": "1D10"}]}
    docs = _field_notes_docs()
    docs[f"characters/{FN_CODE}"] = character_doc(FN_CODE, state, "fn tester")
    extra = "localStorage.setItem('dg_fn_orders_ack', JSON.stringify({'%s': 1790000000000}));" % FN_CODE
    page, errs = _field_notes_page(p, docs=docs, extra_init=extra)
    page.on("dialog", lambda d: d.accept())
    page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
    root = f"#ah-sheet-{FN_CODE}"
    page.wait_for_selector(root + " .ap-vitals", timeout=15000)

    def saved():
        return json.loads((fs_doc(page, f"characters/{FN_CODE}") or {}).get("character_json") or "{}")
    def until(fn, ms=8000):
        return wait_for_condition(lambda: (lambda v: v if v else None)(fn(saved())), timeout_ms=ms)
    def posts():
        return page.eval_on_selector_all("#ap-posts .ap-pt", "els => els.map(e => e.textContent)")
    def clear_posts():
        while page.locator("#ap-posts .ap-x").count():
            page.locator("#ap-posts .ap-x").first.click()
    def san_loss(amount, kind):
        page.click(root + " [data-a=pop][data-pop=san]")
        if amount in ("1", "2", "3"):
            page.click(root + f" [data-a=san-amt][data-v='{amount}']")
        else:
            page.click(root + " [data-a=san-amt][data-v=other]")
            page.fill(root + " [data-u=san-other]", amount)
        page.click(root + f" [data-a=san-kind][data-v={kind}]")
        page.click(root + " [data-a=san-go]")

    # − / + : saved straight away.
    page.click(root + " [data-a='hp-']")
    record("agent-file-v2", "HP − takes one off and saves it to the Agent's record", bool(until(lambda st: st.get("derived", {}).get("hp") == 8)), str(saved().get("derived")))
    record("agent-file-v2", "there is no Play button (Edit takes its place)",
           page.locator(f"#ah-play-{FN_CODE}").is_hidden() and page.locator(root + " [data-a=edit]").is_visible(), "")

    # SAN loss 3 (Violence): Paranoia triggers on losing 2+ SAN; an incident box ticks.
    san_loss("3", "violence")
    page.wait_for_selector("#ap-posts .ap-postit", timeout=8000)
    p1 = posts()
    record("agent-file-v2", "SAN loss takes the announced amount off SAN, with no d100 test",
           bool(until(lambda st: st["derived"]["san"] == 49)), str(saved().get("derived")))
    record("agent-file-v2", "a loss of 2+ with a disorder that triggers on it shows the 'Disorder triggered' post-it over the page",
           p1 == ["Disorder triggered — Paranoia"] and page.evaluate("() => { const r = document.getElementById('ap-posts').getBoundingClientRect(); return r.width >= innerWidth - 1 && r.height >= innerHeight - 1; }"), str(p1))
    dis_actions = page.locator("#ap-posts .ap-postit", has_text="Disorder triggered").locator("[data-pa]").all_inner_texts()
    record("agent-file-v2", "…the disorder takes hold: its post-it offers projection onto a Bond, not a free SAN roll",
           any("Project onto a Bond" in a for a in dis_actions) and not any("Roll SAN" in a for a in dis_actions)
           and "takes hold" in page.inner_text("#ap-posts .ap-postit"), str(dis_actions))
    record("agent-file-v2", "…the episode is logged, and a Violence loss without insanity ticks an incident box",
           bool(until(lambda st: st.get("sanity", {}).get("violence") == [True, True, False] and st.get("sanLog", [{}])[-1].get("triggered") == ["Paranoia"])), str(saved().get("sanity")))
    clear_posts()

    # SAN loss 6 (Helplessness): temporary insanity, and SAN 43 is at or below BP 44.
    san_loss("6", "helplessness")
    page.wait_for_function("() => document.querySelectorAll('#ap-posts .ap-postit').length >= 3", timeout=8000)
    p2 = posts()
    record("agent-file-v2", "a loss of 5+ shows Temporary insanity, and reaching the Breaking Point shows its post-it",
           "Temporary insanity" in p2 and "Breaking Point" in p2, str(p2))
    page.select_option("#ap-posts [data-pp=dis]", "Amnesia")
    page.locator("#ap-posts .ap-postit", has_text="Breaking Point").locator("[data-pa]").click()
    record("agent-file-v2", "Breaking Point asks for a Motivation to cross off before it closes",
           page.locator("#ap-posts .ap-postit", has_text="Breaking Point").count() == 1, "")
    page.select_option("#ap-posts [data-pp=mot]", "Protect my sister")
    page.locator("#ap-posts .ap-postit", has_text="Breaking Point").locator("[data-pa]").click()
    record("agent-file-v2", "Breaking Point: the picked disorder is added, the Motivation crossed off, and BP resets to SAN − POW",
           bool(until(lambda st: "Amnesia" in st["bio"]["disorders"] and st["derived"]["san"] == 43 and st["derived"]["bp"] == 32
                      and st["bio"].get("motivationsCrossed") == ["Protect my sister"])), str(saved().get("derived")) + str(saved().get("bio", {})))
    clear_posts()

    # The third Violence incident: adapted, −1D6 CHA and from each Bond (a 4 here).
    page.evaluate("() => { Math.random = () => 0.5; }")
    page.click(root + " [data-a=pop][data-pop=inc]")
    page.click(root + " [data-a=inc][data-k=violence]")
    page.wait_for_selector("#ap-posts .ap-postit", timeout=10000)
    record("agent-file-v2", "the third incident adapts the Agent: −1D6 CHA and the same from every Bond (rolled in the Dice Roller)",
           bool(until(lambda st: st.get("adapted", {}).get("violence") and st["csStats"]["CHA"] == 9 and [b["score"] for b in st["bonds"]] == [7, 9], 12000))
           and posts() == ["Adapted to Violence"], str(saved().get("csStats")) + str([b.get("score") for b in saved().get("bonds", [])]))
    clear_posts()

    # A failed skill roll marks the skill red; Roll improvements adds 1D4 to each.
    page.evaluate("() => { Math.random = () => 0.995; }")
    page.locator(root + " [data-a=skill]", has_text="Alertness").click()
    record("agent-file-v2", "a failed roll marks the skill (bold red) until the improvement roll",
           bool(until(lambda st: {"type": "key", "key": "alertness"} in st.get("lpCheckedSkills", []), 10000))
           and bool(wait_for_condition(lambda: page.locator(root + " .ap-skill.ap-marked", has_text="Alertness").count() or None, timeout_ms=5000)), "")
    page.evaluate("() => { Math.random = () => 0.5; }")
    page.click(root + " [data-a=improve]")
    record("agent-file-v2", "Roll improvements: +1D4 to each marked skill, then the marks are cleared",
           bool(until(lambda st: st["skills"].get("alertness") == 63 and st["skills"].get("firearms") == 53 and not st.get("lpCheckedSkills"), 15000)),
           str(saved().get("skills")) + str(saved().get("lpCheckedSkills")))
    clear_posts()

    # Edit mode: Save asks for the Oath. N keeps editing, nothing saved; Y saves.
    page.click(root + " [data-a=edit]")
    page.wait_for_selector(root + " .ap-editbar", timeout=5000)
    record("agent-file-v2", "Edit mode lists every skill, 0% ones too",
           page.locator(root + " .ap-skills-e .ap-sk").count() >= 36, str(page.locator(root + " .ap-skills-e .ap-sk").count()))
    page.fill(root + " [data-e='stat:STR']", "12")
    page.dispatch_event(root + " [data-e='stat:STR']", "change")
    page.fill(root + " [data-e='skill:key:accounting']", "20")
    page.click(root + " [data-a=pop][data-pop=spec]")
    page.select_option(root + " [data-u=spec-key]", "craft")
    page.fill(root + " [data-u=spec-name]", "Locksmith")
    page.fill(root + " [data-u=spec-val]", "20")
    page.click(root + " [data-a=spec-add]")
    page.click(root + " [data-a=save]")
    page.wait_for_selector("#fn-orders.fn-oath-save", timeout=5000)
    page.keyboard.press("Enter")
    oath_txt = page.inner_text("#fn-orders")
    page.keyboard.press("n")
    page.wait_for_timeout(1000)
    record("agent-file-v2", "Save shows the Mission & Standing Orders (priorities in caps) and CAN WE CALL ON YOU?",
           "THE MISSION & STANDING ORDERS" in oath_txt and "FIRST PRIORITY: Stop the incursion" in oath_txt and "SECOND PRIORITY:" in oath_txt
           and "CAN WE CALL ON YOU?" in oath_txt and "IT HAS HAPPENED BEFORE" not in oath_txt, oath_txt[:400])
    record("agent-file-v2", "Save lists the changes; N goes back to editing and saves nothing",
           "STR 10→12" in oath_txt and "Accounting 10→20" in oath_txt and page.locator("#fn-orders").count() == 0
           and page.locator(root + " .ap-editbar").count() == 1 and saved()["csStats"]["STR"] == 10, oath_txt[:300])
    page.click(root + " [data-a=save]")
    page.wait_for_selector("#fn-orders.fn-oath-save", timeout=5000)
    page.keyboard.press("Enter")
    page.keyboard.press("y")
    record("agent-file-v2", "…and Y files the edits (statistics, skills, a new specialty)",
           bool(until(lambda st: st["csStats"]["STR"] == 12 and st["skills"]["accounting"] == 20
                      and any(i.get("key") == "craft" and i.get("specialty") == "Locksmith" and i.get("value") == 20 for i in st.get("specialtyInstances", []))))
           and bool(wait_for_condition(lambda: page.locator(root + " .ap-editbar").count() == 0 or None, timeout_ms=4000)), str(saved().get("csStats")))
    page.click(root + " [data-a=edit]")
    page.select_option(root + " [data-emp=sel]", "DEA")
    page.click(root + " [data-a=cancel]")
    page.wait_for_selector("#fn-confirm [data-cf=ok]", timeout=5000)
    asked = page.inner_text("#fn-confirm")
    page.click("#fn-confirm [data-cf=ok]")
    page.wait_for_timeout(1000)
    record("agent-file-v2", "Cancel asks in the page (no native dialog, so it works in a home-screen app) and throws the edit away",
           "Throw away these edits?" in asked and page.locator(root + " .ap-editbar").count() == 0 and saved()["bio"]["employer"] == "FBI", saved()["bio"].get("employer"))

    # The Rules page: the Mission card, no Oath.
    page.evaluate("() => window.dgFieldNotes.open('rules')")
    page.wait_for_selector("#fn-veil .fn-mission", timeout=10000)
    mt = page.inner_text("#fn-veil .fn-mission")
    record("agent-file-v2", "the Rules page opens with the Mission & Standing Orders instead of the Oath",
           "MISSION" in mt.upper() and "disinformation" in mt and "Oath" not in page.inner_text("#fn-veil [data-fn-slot=body]"), mt[:200])
    errs_all.extend(errs)
    page.close()

    # Phone: the notebook's Agent File fits, nothing sideways.
    page, errs = _field_notes_page(p, width=390, height=844, docs=docs, extra_init=extra)
    page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function("() => window.dgFieldNotes && window.dgFieldNotes.isHost", timeout=10000)
    page.evaluate("() => window.dgFieldNotes.open('agentfile')")
    page.locator("#fn-veil .as-paper.ap").filter(visible=True).first.wait_for(timeout=10000)
    record("agent-file-v2", "phone: the notebook's Agent File has its controls and no sideways scroll",
           page.evaluate("() => document.documentElement.scrollWidth <= innerWidth") and page.locator("#fn-veil [data-a=pop][data-pop=san]").filter(visible=True).count() >= 1, "")
    errs_all.extend(errs)
    page.close()
    return errs_all

def _open_cell(page, paper=None, code=None):
    """The Cell is a drop-down beside Appearance: the notebook's paper has
    its own Cell ▾ button, Agent Hub's is under the photo."""
    if paper is not None and paper.locator("[data-a=cell]").count():
        if not paper.locator(".ap-celldrop").count():
            paper.locator("[data-a=cell]").first.click()
        return
    btn = f"[data-ah-cell={code}]"
    page.wait_for_selector(f"#ah-sheet-{code} .ap-vitals", timeout=15000)
    if not page.locator(f"#ah-sheet-{code} .ap-celldrop").count():
        page.click(btn)


def test_field_notes_split(p):
    """Field Notes' Split mode (desktop): the Split brown tab puts the
    Agent File on the left page, in place of the card holder, and the
    brown tabs' pages -- Notes (the whole Notes page), Evidences, Rules,
    Settings -- on the right. A roll from the left turns the right page to
    the Dice Roller. Remembered on the device; never on a phone."""
    extra = "localStorage.setItem('dg_fn_orders_ack', JSON.stringify({'%s': 1790000000000}));" % FN_CODE
    page, errs = _field_notes_page(p, extra_init=extra)
    page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function("() => window.dgFieldNotes && window.dgFieldNotes.isHost", timeout=10000)
    page.evaluate("() => window.dgFieldNotes.open('agentfile')")
    page.locator("#fn-veil .as-paper.ap").filter(visible=True).first.wait_for(timeout=10000)
    page.click("#fn-veil .fn-tab-split")
    left = "#fn-veil [data-fn-slot=split-body] .as-paper.ap"
    page.wait_for_selector(left, timeout=10000)
    st = page.evaluate("""() => ({ holder: getComputedStyle(document.querySelector('#fn-veil .fn-holder')).display,
        right: document.querySelector('#fn-veil [data-fn-slot=title]').textContent,
        active: [...document.querySelectorAll('#fn-veil .fn-tab.fn-active')].map(t => t.textContent),
        pressed: document.querySelector('#fn-veil .fn-tab-split').getAttribute('aria-pressed') })""")
    record("notebook", "Split: the Agent File takes the left page (the card holder goes), Evidences on the right",
           page.is_visible(left) and st["holder"] == "none" and st["right"] == "Evidences" and st["pressed"] == "true", str(st))
    page.locator(left).evaluate("el => el.__mark = 1")
    page.click("#fn-veil .fn-tab[data-view=rules]")
    page.wait_for_selector("#fn-veil .fn-mission", timeout=5000)
    record("notebook", "Split: Rules on the right, the same Agent File still on the left (not redrawn)",
           page.locator(left).evaluate("el => el.__mark === 1"), "")
    page.click("#fn-veil .fn-tab[data-view=notes]")
    page.wait_for_selector("#fn-veil [data-fn-slot=embed-notes] iframe", timeout=5000)
    src = page.get_attribute("#fn-veil [data-fn-slot=embed-notes] iframe", "src") or ""
    record("notebook", "Split: Notes is the whole Notes page on the right, not the two-page spread",
           "embed=notebook" in src and page.is_hidden("#fn-veil [data-fn-slot=spread]") and page.is_visible(left), src)
    page.click("#fn-veil .fn-tab[data-view=evidence]")
    page.locator(left + " .as-stat[data-a=pct]").first.click()
    ok = wait_for_condition(lambda: (page.text_content("#fn-veil [data-fn-slot=title]") or "") == "Dice Roller", timeout_ms=5000)
    record("notebook", "Split: a roll from the left page turns the right page to the Dice Roller, still split",
           bool(ok) and page.is_visible(left) and page.get_attribute("#fn-veil .fn-tab-split", "aria-pressed") == "true"
           and "fn-active" in (page.get_attribute("#fn-veil .fn-tab-split", "class") or ""), "")
    page.evaluate("() => window.dgFieldNotes.close && window.dgFieldNotes.close()")
    page.reload(wait_until="domcontentloaded")
    page.wait_for_function("() => window.dgFieldNotes && window.dgFieldNotes.isHost", timeout=10000)
    page.evaluate("() => window.dgFieldNotes.open('agentfile')")
    page.wait_for_selector(left, timeout=10000)
    record("notebook", "Split is remembered on this device (and Agent File opens it, Evidences on the right)",
           page.is_visible(left) and (page.text_content("#fn-veil [data-fn-slot=title]") or "") == "Evidences", "")
    page.click("#fn-veil .fn-tab-split")
    page.wait_for_timeout(300)
    record("notebook", "Split again: back to the card holder",
           page.is_hidden("#fn-veil [data-fn-slot=split-left]") and page.is_visible("#fn-veil .fn-holder"), "")
    record("notebook", "no JS exceptions (Split)", not errs, str(errs[:3]))
    page.close()
    # A phone never splits, even with it remembered.
    page, errs = _field_notes_page(p, width=390, height=844, extra_init=extra + "localStorage.setItem('dg_fn_split', '1');")
    page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function("() => window.dgFieldNotes && window.dgFieldNotes.isHost", timeout=10000)
    page.evaluate("() => window.dgFieldNotes.open('agentfile')")
    page.locator("#fn-veil .as-paper.ap").filter(visible=True).first.wait_for(timeout=10000)
    record("notebook", "phone: no Split tab, and no split even when it's remembered",
           page.is_hidden("#fn-veil .fn-tab-split") and page.is_hidden("#fn-veil [data-fn-slot=split-left]")
           and (page.text_content("#fn-veil [data-fn-slot=title]") or "") == "Agent File", "")
    # The browser's storage is shared by later tests: leave Split off.
    page.evaluate("() => { localStorage.removeItem('dg_fn_split'); localStorage.removeItem('dg_fn_split_view'); }")
    page.close()


def test_agent_file_brief_read_recovers(p):
    """Reported 2026-10-09 on an iPhone: Agent Hub's Appearance said
    "Could not load -- check your connection." and Era photos "Finish the
    Appearance brief" for an Agent whose brief was complete -- the one-shot
    read of briefs/{code} failed once (while the sheet's live listener
    worked) and nothing ever tried again. Now a failed get() is retried
    through a listener (dgStore.getDoc), and if that fails too the file
    says so, offers Try again, and retries by itself."""
    brief = dict(_PROFILE_FIELDS, agent_code=FN_CODE, char_name="Mara Voss", active_eras='["90s"]',
                 era_90s_mode0="portrait prompt", era_90s_mode1="reference prompt")
    def setup(init):
        docs = _field_notes_docs()
        docs[f"briefs/{FN_CODE}"] = brief
        extra = ("localStorage.setItem('dg_fn_orders_ack', JSON.stringify({'%s': 1790000000000}));" % FN_CODE) + init
        page, errs = _field_notes_page(p, docs=docs, extra_init=extra)
        page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
        _open_appearance(page)
        return page, errs
    on_file = lambda page: (page.text_content("#af-appear-state") or "").strip() == "On file"
    # 1. get() fails ("client is offline"), the listener answers: loaded.
    page, errs = setup("window.__dgFsFailGet = function (p) { return p === 'briefs/%s'; }; window.__dgFsListenNow = true;" % FN_CODE)
    ok = wait_for_condition(lambda: on_file(page), timeout_ms=10000)
    _open_era(page)
    record("agent-file", "a failed one-shot read of the brief falls back to a listener: Appearance is On file",
           bool(ok), page.text_content("#af-appear-state") or "")
    record("agent-file", "…and the era photos show, not \"Finish the Appearance brief\"",
           page.is_hidden("#af-photos-locked"), page.text_content("#af-photos-locked") or "")
    page.close()
    # 2. Both fail: the file says it's still loading, offers Try again,
    #    and loads once the connection is back.
    page, errs = setup("window.__dgFsFailGet = function (p) { return p === 'briefs/%s'; }; window.__dgFsListenError = function (p) { return p === 'briefs/%s'; };" % (FN_CODE, FN_CODE))
    shown = wait_for_condition(lambda: page.locator("#af-appear-state .af-retry").count() == 1, timeout_ms=10000)
    st = page.text_content("#af-appear-state") or ""
    _open_era(page)
    record("agent-file", "when every read fails the file says it's still loading, with Try again (not a dead end)",
           bool(shown) and "Still loading" in st and "Could not load" not in st, st)
    record("agent-file", "…and the era photos wait for it instead of saying the brief is unfinished",
           "Waiting for the Agent File" in (page.text_content("#af-photos-locked") or ""), page.text_content("#af-photos-locked") or "")
    page.evaluate("() => { window.__dgFsFailGet = null; window.__dgFsListenError = null; }")
    page.click("#af-appear-state .af-retry")
    ok = wait_for_condition(lambda: on_file(page), timeout_ms=8000)
    record("agent-file", "Try again loads it once the connection is back", bool(ok), page.text_content("#af-appear-state") or "")
    page.close()
    # 3. …and without a tap: the automatic retry.
    page, errs = setup("window.__dgFsFailGet = function (p) { return p === 'briefs/%s'; }; window.__dgFsListenError = function (p) { return p === 'briefs/%s'; };" % (FN_CODE, FN_CODE))
    wait_for_condition(lambda: page.locator("#af-appear-state .af-retry").count() == 1, timeout_ms=10000)
    page.evaluate("() => { window.__dgFsFailGet = null; window.__dgFsListenError = null; }")
    ok = wait_for_condition(lambda: on_file(page), timeout_ms=9000)
    record("agent-file", "the file retries by itself (within a few seconds) and loads", bool(ok), page.text_content("#af-appear-state") or "")
    record("agent-file", "no JS exceptions (brief read recovery)", not errs, str(errs[:3]))
    page.close()


def test_new_recruit_wizard(p):
    """M2: Agent Hub's + New Recruit is a twelve-step wizard
    (assets/recruit-wizard.js). A whole run -- point buy, one of The
    Complex's professions (Marine Interdiction Agent: 2 Bonds, Pilot (Boat)
    60%, its suggested bonus skills pre-placed), Damaged Veteran (Extreme
    Violence + Hard Experience), personal data (the Agent Code is made
    here, filed under the Cover Identity), a generated Bond with an AI
    description, Motivations, the Incursion, the kit, Profiling (the Agent
    File's own brief, the play era written), the review -- then the
    Contract: N goes back with nothing lost, Y files the Agent
    (creationCommitted, standing_orders_ack_at) and opens their tab. The
    saved character is the sheet's own v1 shape. Fake backend only."""
    page, errs = _field_notes_page(p, width=1180, height=900,
                                   extra_init="localStorage.setItem('dg_fn_orders_ack', JSON.stringify({'%s': 1790000000000}));" % FN_CODE)
    page.goto(f"{BASE}/agent-hub.html#new", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_selector("#nr-root [data-a=begin]", timeout=15000)
    R = "#nr-root "
    def err():
        return (page.text_content(R + "[data-err]") or "").strip() if page.locator(R + "[data-err]").count() else ""
    def step():
        return page.evaluate("() => (window.dgRecruit._w() || {}).step")
    page.click(R + "[data-a=begin]")
    record("recruit", "+ New Recruit opens the wizard at Statistics, with what each statistic means",
           step() == 1 and "Physical power" in (page.text_content(R + ".nr-stats") or ""), str(step()))
    # Point buy: 72 exactly; over budget is refused.
    record("recruit", "point buy: + is refused once all 72 points are spent",
           page.is_disabled(R + "[data-a=st][data-k=INT][data-d='1']") and page.text_content(R + "[data-left]").strip() == "0", page.text_content(R + "[data-left]"))
    page.click(R + "[data-a=st][data-k=STR][data-d='-1']")
    page.click(R + "[data-a=next]")
    record("recruit", "point buy: going on with points unspent is refused, saying how many",
           step() == 1 and "1 left" in err(), err())
    page.click(R + "[data-a=st][data-k=INT][data-d='1']")
    page.click(R + "[data-a=feat][data-k=STR]")
    feat = page.input_value(R + "[data-f='feat.STR']")
    record("recruit", "a distinguishing feature is suggested from the score, and stays editable", bool(feat), feat)
    page.fill(R + "[data-f='feat.STR']", "Ex-rower's shoulders")
    page.click(R + "[data-a=next]")
    # Profession: The Complex.
    page.click(R + "[data-a=prof][data-src=cx][data-key=cbp_marine]")
    det = page.inner_html(R + "[data-detail]")
    record("recruit", "profession detail: every skill with its value, profession skills red bold, suggested bonus skills black bold",
           'class="pro"><span>Pilot (Boat)</span><span>60%' in det and 'class="bon"><span>SIGINT' in det and "Stealth" in det, det[:200])
    page.click(R + "[data-a=next]")
    used = page.evaluate("() => Object.values(dgRecruit._w().bonus).reduce((a, b) => a + b, 0)")
    record("recruit", "the profession's suggested bonus skills are pre-placed on Bonus skills", used == 4, str(used))
    page.click(R + "[data-a=next]")
    record("recruit", "bonus skills: all eight boosts must be placed", step() == 3 and "4 left" in err(), err())
    for k in ["firearms", "first_aid", "stealth", "occult"]:
        page.click(R + "[data-a=bonus][data-id='key:%s'][data-d='1']" % k)
    page.click(R + "[data-a=next]")
    # Damaged Veteran.
    page.click(R + "[data-a=vet][data-k=violence]")
    page.click(R + "[data-a=vet][data-k=hard]")
    for i, k in enumerate(["key:search", "key:swim", "key:law", "key:drive"]):
        page.select_option(R + "[data-u=vet-hard][data-i='%d']" % i, k)
    diff = page.text_content(R + ".nr-diff") or ""
    record("recruit", "Damaged Veteran is applied and shown (Occult +20, CHA −3, SAN −10)",
           "Occult 30% → 50%" in diff and "Search 70% → 80%" in diff and "CHA 12 → 9" in diff and "SAN 60 → 50" in diff, diff)
    page.click(R + "[data-a=next]")
    # Personal data: the code.
    page.fill(R + "[data-f='bio.name']", "Nadia Kerr")
    page.fill(R + "[data-f='bio.codename']", "Sparrow")
    page.fill(R + "[data-f='bio.pastEmployer']", "Miami-Dade PD")
    page.fill(R + "[data-f='bio.age']", "34")
    page.select_option(R + "[data-f='bio.sex']", "Female")
    page.click(R + "[data-a=randbio]")
    page.click(R + "[data-a=next]")
    page.wait_for_function("() => (window.dgRecruit._w() || {}).step === 6", timeout=10000)
    code = page.evaluate("() => dgRecruit._w().code")
    brief = page.evaluate("(c) => window.__dgFirestoreDocs['briefs/' + c]", code)
    record("recruit", "the Agent Code is made at Personal data: brief filed under the Cover Identity, codename and age range",
           bool(code) and brief and brief.get("char_name") == "Nadia Kerr" and brief.get("player_name") == "fn tester"
           and brief.get("codename") == "Sparrow" and brief.get("age_range") == "Mid 30s", json.dumps(brief)[:300] if brief else str(code))
    draft = page.evaluate("(c) => { const d = window.__dgFirestoreDocs['characters/' + c]; return d ? JSON.parse(d.character_json) : null; }", code)
    record("recruit", "…and the draft is saved to the cloud, not yet committed",
           bool(draft) and draft.get("creationCommitted") is False, str(draft and draft.get("creationCommitted")))
    # Bonds: Marine Interdiction has 2, Hard Experience takes one.
    n = page.locator(R + ".nr-bondc").count()
    record("recruit", "Bonds: the profession's count less Hard Experience's one (2 → 1)", n == 1, str(n))
    record("recruit", "Bond categories: Family and Friends apart, Other Governments, no LGBTQ",
           all(t in (page.text_content(R + ".nr-chips") or "") for t in ["Family", "Friends", "Delta Green", "Other Governments", "Underworld"])
           and "LGBTQ" not in (page.text_content(R) or ""), page.text_content(R + ".nr-chips"))
    page.click(R + "[data-a=bond-gen]")
    gen_name = page.input_value(R + "[data-f='bonds.0.name']")
    record("recruit", "Generate a Bond fills a Bond from the generator, with ⚄ Another", bool(gen_name) and page.locator(R + "[data-a=bond-another]").count() == 1, gen_name)
    page.fill(R + "[data-f='bonds.0.name']", "Ruth Kerr")
    page.fill(R + "[data-f='bonds.0.relationship']", "Mother")
    record("recruit", "the description button is a plain Generate", (page.text_content(R + "[data-a=bond-ai]") or "").strip() == "Generate", page.text_content(R + "[data-a=bond-ai]"))
    page.click(R + "[data-a=bond-ai]")
    page.wait_for_function("() => (document.querySelector(\"#nr-root [data-f='bonds.0.description']\") || {}).value === 'STUB BOND: Ruth Kerr'", timeout=8000)
    record("recruit", "Generate drafts the Bond's description (Cloud Function), still editable", True, "")
    page.click(R + "[data-a=next]")
    page.fill(R + "[data-f='motivations.0']", "Keep my mother out of this")
    page.click(R + "[data-a=next]")
    page.wait_for_timeout(300)
    page.locator(R + "[data-inc] textarea").first.fill("A boat came back from the Keys with no crew.") if page.locator(R + "[data-inc] textarea").count() else None
    page.click(R + "[data-a=next]")
    kit = page.text_content(R + ".nr-kit") or ""
    record("recruit", "Equipment: the profession's kit, catalog items with their numbers",
           "Medium pistol" in kit and "1D10" in kit and "Water survival gear" in kit, kit[:200])
    page.click(R + "[data-a=next]")
    page.wait_for_selector(R + "[data-afslot] #dg-form", timeout=10000)
    page.wait_for_function("(c) => { const b = window.__dgFirestoreDocs['briefs/' + c]; return b && b.active_eras === '[\"20s\"]'; }", arg=code, timeout=8000)
    record("recruit", "Profiling: the Agent File's own Appearance brief, the play era written (2020s)",
           page.input_value(R + "[data-afslot] [name=char_name]") == "Nadia Kerr", page.input_value(R + "[data-afslot] [name=char_name]"))
    page.click(R + "[data-era] [data-e='90s']") if page.locator(R + "[data-era]").count() else page.click(R + "[data-a=era][data-e='90s']")
    page.wait_for_function("(c) => { const b = window.__dgFirestoreDocs['briefs/' + c]; return b && /^\\[\"90s\"/.test(b.active_eras) && b.campaign_era === '90s'; }", arg=code, timeout=8000)
    record("recruit", "changing the play era rewrites it on the brief", True, "")
    page.click(R + "[data-a=next]")
    rv = page.text_content(R + ".nr-review") or ""
    record("recruit", "Review: everything in one place", all(t in rv for t in ["Nadia Kerr", "Marine Interdiction Agent", "Ruth Kerr (Mother)", "Keep my mother out of this", "Medium pistol"]), rv[:300])
    # The Contract: N, then Y.
    page.click(R + "[data-a=sign]")
    page.wait_for_selector("#fn-orders.fn-contract", timeout=8000)
    page.keyboard.press("Enter")
    txt = page.text_content("#fn-orders") or ""
    record("recruit", "the Contract is the full clearance briefing, with the second sentences, and \"We need your silence.\"",
           "IT HAS HAPPENED BEFORE. Unnatural incursions are real, and they kill." in txt and "We need your silence." in txt and "CAN WE CALL ON YOU?" in txt, txt[:300])
    page.keyboard.press("n")
    page.wait_for_timeout(300)
    record("recruit", "N goes back to the review with nothing lost (and nothing filed)",
           page.locator("#fn-orders").count() == 0 and step() == 11 and page.evaluate("(c) => JSON.parse(window.__dgFirestoreDocs['characters/' + c].character_json).creationCommitted", code) is False, "")
    page.click(R + "[data-a=sign]")
    page.wait_for_selector("#fn-orders.fn-contract", timeout=8000)
    page.keyboard.press("Enter")
    page.keyboard.press("y")
    page.wait_for_selector(f".tw.active[data-tab='{code}']", timeout=10000)
    st = page.evaluate("(c) => JSON.parse(window.__dgFirestoreDocs['characters/' + c].character_json)", code)
    brief = page.evaluate("(c) => window.__dgFirestoreDocs['briefs/' + c]", code)
    record("recruit", "Y files the Agent: committed, the Contract recorded on the brief, their tab opened",
           st.get("creationCommitted") is True and bool(brief.get("standing_orders_ack_at")) and page.evaluate("() => !localStorage.getItem('dg_recruit_draft')"), str(st.get("creationCommitted")))
    sp = {(i["key"], i["specialty"]): i["value"] for i in st.get("specialtyInstances", [])}
    sk = st.get("skills", {})
    record("recruit", "saved skills: profession, bonus (80% cap), Damaged Veteran (+10 Occult each, Hard Experience +10)",
           sp.get(("pilot", "Boat")) == 60 and sp.get(("foreign_language", "Spanish")) == 50 and sk.get("alertness") == 70
           and sk.get("firearms") == 70 and sk.get("occult") == 50 and sk.get("search") == 80 and sk.get("unarmed_combat") == 60,
           json.dumps({k: sk.get(k) for k in ["alertness", "firearms", "occult", "search", "swim"]}) + str(sp))
    record("recruit", "saved stats, derived, Bonds at CHA, Violence adapted",
           st["stats"]["CHA"] == 9 and st["derived"]["san"] == 50 and st["derived"]["bp"] == 38 and st["bonds"][0]["score"] == 9
           and st["bonds"][0]["description"] == "STUB BOND: Ruth Kerr" and st["sanity"]["violence"] == [True, True, True] and st["adapted"].get("violence") is True,
           json.dumps({"stats": st["stats"], "derived": st["derived"]}))
    record("recruit", "saved bio: name, codename, past employer, Complex profession key, features",
           st["bio"]["name"] == "Nadia Kerr" and st["bio"]["codename"] == "Sparrow" and st["bio"]["pastEmployer"] == "Miami-Dade PD"
           and st["bio"]["profession"] == "cbp_marine" and st["lpFeat"]["STR"] == "Ex-rower's shoulders" and st["bio"]["motivations"] == "Keep my mother out of this", json.dumps(st["bio"])[:300])
    record("recruit", "saved kit: the pistol on the weapons table with its Firearms %, gear as items",
           any(w["name"] == "Medium pistol" and w["skillPct"] == "70" for w in st["lpWeapons"]) and "Kevlar vest" in st["equipment"], json.dumps(st["lpWeapons"])[:200])
    page.wait_for_selector(f"#ah-sheet-{code} .ap-vitals", timeout=10000)
    record("recruit", "the new Agent's tab shows their Agent File, profession from The Complex",
           "Marine Interdiction Agent" in (page.text_content(f"#panel-{code}") or ""), "")
    record("recruit", "no JS exceptions (New Recruit wizard)", not errs, str(errs[:3]))
    page.close()


def test_new_recruit_imports_and_links(p):
    """M2: bringing an Agent in through New Recruit's one drop zone
    (assets/agent-import.js) -- Kappa Black .toml, a Foundry VTT actor,
    this site's own save, the printable sheet -- lands at Personal data
    with what the file carried; Recruit for an Agent with no sheet opens
    the wizard under that Agent's own code; the notebook's Settings export
    a DD Form 315 from the saved character (assets/sheet-io/pdf-export.js).
    Fake backend only."""
    errs_all = []
    toml = 'name = "Hollis, Ray"\nprofession = "Pilot"\nemployer = "USAF"\nhp = 12\nwp = 11\nsan = 50\nviolenceAdaptation = 2\nmotivationsAndDisorders = "Flying\\nMy daughter"\n' \
           '[strength]\nscore = 12\n[constitution]\nscore = 12\n[dexterity]\nscore = 14\n[intelligence]\nscore = 11\n[power]\nscore = 11\n[charisma]\nscore = 12\n' \
           '[[skills]]\nskill = "Pilot"\ntype = "Airplane"\nscore = 60\n[[skills]]\nskill = "Alertness"\nscore = 55\n[[bonds]]\nbond = "Ann Hollis (daughter)"\nscore = 12\n'
    foundry = {"name": "Vera Lind", "system": {"statistics": {"str": {"value": 9}, "con": {"value": 11}, "dex": {"value": 13}, "int": {"value": 16}, "pow": {"value": 14}, "cha": {"value": 10, "distinguishing_feature": "Quiet"}},
               "skills": {"search": {"proficiency": 60}, "occult": {"proficiency": 45}}, "biography": {"profession": "Anthropologist or Historian", "employer": "Smithsonian"},
               "sanity": {"value": 66}, "typedSkills": {"a": {"group": "Foreign Language", "label": "Latin", "proficiency": 50}}},
               "items": [{"type": "bond", "name": "Paul Lind", "system": {"relationship": "Brother", "score": 10}}, {"type": "motivation", "name": "Truth"}]}
    native = {"v": 1, "bio": {"name": "Ines Moreau", "profession": "physician"}, "stats": {"STR": 10, "CON": 10, "DEX": 10, "INT": 15, "POW": 12, "CHA": 13},
              "skills": {"medicine": 70}, "bonds": [{"name": "Luc", "relationship": "Husband", "score": 13}]}
    html = '<html><body><script id="dg-state-blob" type="application/json">' + json.dumps(native).replace("Ines", "Odile") + '</script></body></html>'
    cases = [("ray.toml", toml, "Hollis, Ray", lambda st: st["csStats"]["DEX"] == 14 and any(i["key"] == "pilot" and i["specialty"] == "Airplane" and i["value"] == 60 for i in st["specialtyInstances"])
                 and st["skills"].get("alertness") == 55 and st["bio"]["profession"] == "pilot_sailor" and st["sanity"]["violence"] == [True, True, False]),
             ("vera.json", json.dumps(foundry), "Vera Lind", lambda st: st["skills"].get("occult") == 45 and st["lpFeat"].get("CHA") == "Quiet" and st["bio"]["profession"] == "anthropologist"
                 and any(i["specialty"] == "Latin" for i in st["specialtyInstances"]) and st["bonds"][0]["name"] == "Paul Lind"),
             ("ines.json", json.dumps(native), "Ines Moreau", lambda st: st["skills"].get("medicine") == 70),
             ("odile.html", html, "Odile Moreau", lambda st: st["bonds"][0]["name"] == "Luc")]
    for fname, content, who, check in cases:
        page, errs = _field_notes_page(p, width=1180, height=900)
        page.goto(f"{BASE}/agent-hub.html#new", wait_until="domcontentloaded", timeout=15000)
        page.wait_for_selector("#nr-root [data-file]", state="attached", timeout=15000)
        page.set_input_files("#nr-root [data-file]", files=[{"name": fname, "mimeType": "text/plain", "buffer": content.encode()}])
        ok = wait_for_condition(lambda: page.evaluate("() => { const w = window.dgRecruit._w(); return w && w.step === 5 ? 1 : null; }"), timeout_ms=10000)
        nm = page.input_value("#nr-root [data-f='bio.name']") if ok else ""
        st = page.evaluate("() => { const w = window.dgRecruit._w(); return w ? window.dgRecruit.build(w) : null; }") if ok else None
        good = False
        try: good = bool(st) and check(st)
        except Exception as e: good = False
        record("recruit-import", f"{fname}: lands at Personal data with the Agent's name, stats, skills and Bonds", bool(ok) and nm == who and good, f"{nm!r} {json.dumps(st)[:240] if st else page.text_content('#nr-root [data-err]')}")
        errs_all.extend(errs)
        page.close()
    # A bad file says so, and stays on Start.
    page, errs = _field_notes_page(p, width=1180, height=900)
    page.goto(f"{BASE}/agent-hub.html#new", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_selector("#nr-root [data-file]", state="attached", timeout=15000)
    page.set_input_files("#nr-root [data-file]", files=[{"name": "junk.txt", "mimeType": "text/plain", "buffer": b"hello there"}])
    msg = wait_for_condition(lambda: (page.text_content("#nr-root [data-err]") or "").strip() if "Could not read" in (page.text_content("#nr-root [data-err]") or "") else None, timeout_ms=8000)
    record("recruit-import", "an unreadable file says why and stays on Start", bool(msg) and page.evaluate("() => !window.dgRecruit._w()"), str(msg))
    errs_all.extend(errs)
    page.close()
    # Recruit for an Agent already on file with no sheet: the wizard, same code.
    docs = _field_notes_docs()
    del docs[f"characters/{FN_CODE}"]
    page, errs = _field_notes_page(p, width=1180, height=900, docs=docs)
    page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
    btn = f"#panel-{FN_CODE} .paper-actions a.paper-btn"
    page.wait_for_selector(btn, state="visible", timeout=15000)
    href = page.get_attribute(btn, "href") or ""
    page.click(btn)
    page.wait_for_function("() => window.dgRecruit && window.dgRecruit._w() && window.dgRecruit._w().code", timeout=15000)
    w = page.evaluate("() => window.dgRecruit._w()")
    named = wait_for_condition(lambda: page.evaluate("() => window.dgRecruit._w().bio.name") or None, timeout_ms=8000)
    record("recruit-import", "Recruit (an Agent with no sheet) opens New Recruit under that Agent's own code, name from their brief",
           "recruit=" + FN_CODE in href and w["code"] == FN_CODE and named == "Mara Voss" and page.is_visible("#panel-new.active"), href + " " + str(named))
    errs_all.extend(errs)
    page.close()
    # Settings: Export builds the DD Form 315 from the saved character.
    page, errs = _field_notes_page(p, width=1300, height=860,
                                   extra_init="window.dgSheetPdf = { download: function (st) { window.__pdfState = st; return Promise.resolve(); } };")
    page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function("() => window.dgFieldNotes && window.dgFieldNotes.isHost", timeout=10000)
    page.evaluate("() => window.dgFieldNotes.open('settings')")
    page.click("#fn-veil [data-s=pdf]")
    got = wait_for_condition(lambda: page.evaluate("() => window.__pdfState || null"), timeout_ms=8000)
    record("recruit-import", "notebook Settings: PDF (DD Form 315) is built from the Agent's saved character, profession written out",
           bool(got) and got["bio"]["name"] == "Mara Voss" and got["bio"]["profession"] == "Federal Agent"
           and "Downloaded" in (page.text_content("#fn-veil [data-s=pdf-status]") or ""), json.dumps(got)[:200] if got else "")
    errs_all.extend(errs)
    record("recruit-import", "no JS exceptions (imports and links)", not errs_all, str(errs_all[:3]))
    page.close()


def test_sheet_io_real_files(p):
    """The old sheet (stats/) is gone; its file readers live on in
    assets/sheet-io/ and are exercised end to end here with real files:
    a Kappa Black .toml and its Foundry .json, a Google Sheets .xlsx the
    old sheet exported (test/fixtures/agent-sheet.xlsx), and a DD Form 315
    built by the notebook's Settings -> PDF and read straight back through
    New Recruit. pdf-lib and JSZip come from test/vendor/ in place of
    their CDNs. Also: an old stats/index.html link, served the site's
    404.html as GitHub Pages does, forwards to that Agent on Agent Hub."""
    errs_all = []
    pdflib = os.path.join(HERE, "vendor", "pdf-lib.min.js")
    jszip = os.path.join(HERE, "vendor", "jszip.min.js")
    def vendor(page):
        page.route("**/unpkg.com/pdf-lib@*/**", lambda r: r.fulfill(path=pdflib, content_type="application/javascript"))
        page.route("**/cdnjs.cloudflare.com/ajax/libs/jszip/**", lambda r: r.fulfill(path=jszip, content_type="application/javascript"))
    def recruit_import(name, mime, buf):
        page, errs = _field_notes_page(p, width=1180, height=900)
        vendor(page)
        page.goto(f"{BASE}/agent-hub.html#new", wait_until="domcontentloaded", timeout=15000)
        page.wait_for_selector("#nr-root [data-file]", state="attached", timeout=15000)
        page.set_input_files("#nr-root [data-file]", files=[{"name": name, "mimeType": mime, "buffer": buf}])
        ok = wait_for_condition(lambda: page.evaluate("() => { const w = window.dgRecruit._w(); return w && w.step === 5 ? 1 : null; }"), timeout_ms=15000)
        st = page.evaluate("() => { const w = window.dgRecruit._w(); return w ? window.dgRecruit.build(w) : null; }") if ok else None
        err = "" if ok else (page.text_content("#nr-root [data-err]") or "")
        page.close()
        return st, err, errs
    fx = os.path.join(HERE, "fixtures")

    st, err, errs = recruit_import("kappa.toml", "text/plain", open(os.path.join(fx, "kappablack-export.toml"), "rb").read())
    record("sheet-io", "a real Kappa Black .toml imports through New Recruit (name, profession)",
           bool(st) and st["bio"]["name"] == "Alistair Islay Lagavulin" and st["bio"]["profession"] == "pilot_sailor", err or json.dumps(st)[:200])
    errs_all.extend(errs)
    st, err, errs = recruit_import("kappa.json", "application/json", open(os.path.join(fx, "kappablack-foundry.json"), "rb").read())
    record("sheet-io", "a real Kappa Black Foundry .json imports through New Recruit",
           bool(st) and st["bio"]["name"] == "Alistair Islay Lagavulin" and len(st.get("skills") or {}) > 5, err or json.dumps(st)[:200])
    errs_all.extend(errs)
    st, err, errs = recruit_import("agent.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", open(os.path.join(fx, "agent-sheet.xlsx"), "rb").read())
    record("sheet-io", "a Google Sheets .xlsx the old sheet exported still imports (name, employer, age, STR 13)",
           bool(st) and st["bio"]["name"] == "Priya Anand" and st["bio"]["employer"] == "Federal Bureau of Investigation"
           and st["bio"]["age"] == "34" and st["csStats"]["STR"] == 13, err or json.dumps(st)[:240])
    errs_all.extend(errs)

    # DD Form 315: built from the saved character, then read back.
    docs = _field_notes_docs()
    saved = json.loads(docs[f"characters/{FN_CODE}"]["character_json"])
    saved["stats"] = saved["csStats"] = {"STR": 11, "CON": 14, "DEX": 9, "INT": 16, "POW": 12, "CHA": 13}
    saved["skills"] = dict(saved.get("skills") or {}, firearms=50, bureaucracy=45)
    docs[f"characters/{FN_CODE}"] = character_doc(FN_CODE, saved, "fn tester")
    page, errs = _field_notes_page(p, docs=docs, extra_init="localStorage.setItem('dg_fn_orders_ack', JSON.stringify({'%s': 1790000000000}));" % FN_CODE)
    vendor(page)
    page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(1200)
    page.evaluate("() => window.dgFieldNotes.open('settings')")
    page.wait_for_selector("#fn-veil [data-s=pdf]", timeout=10000)
    record("sheet-io", "notebook Settings: no way back to the old sheet any more",
           page.locator("#fn-veil [data-s=gosheet]").count() == 0 and "Old character sheet" not in page.inner_text("#fn-veil"), "")
    with page.expect_download(timeout=20000) as dl_info:
        page.click("#fn-veil [data-s=pdf]")
    dl = dl_info.value
    pdf_path = os.path.join(HERE, "results-tmp-dd315.pdf")
    dl.save_as(pdf_path)
    record("sheet-io", "Settings -> PDF downloads a filled DD Form 315 (the template is found next to the script)",
           dl.suggested_filename == "Mara Voss - DD Form 315.pdf" and os.path.getsize(pdf_path) > 50000, dl.suggested_filename)
    errs_all.extend(errs)
    page.close()
    buf = open(pdf_path, "rb").read()
    try:
        os.remove(pdf_path)
    except OSError:
        pass
    st, err, errs = recruit_import("mara.pdf", "application/pdf", buf)
    want = saved["csStats"]
    record("sheet-io", "that PDF reads straight back through New Recruit: name, all six statistics, skills",
           bool(st) and st["bio"]["name"] == "Mara Voss" and all(st["csStats"].get(k) == want[k] for k in want)
           and st["skills"].get("firearms") == 50 and st["skills"].get("bureaucracy") == 45,
           err or json.dumps({"got": (st or {}).get("csStats"), "skills": (st or {}).get("skills"), "want": want}))
    errs_all.extend(errs)

    # Old links: GitHub Pages serves 404.html for the missing stats/ page.
    page = p.new_page()
    errs = collect_errors(page)
    _block_fonts(page)
    route_apps_script_ok(page)
    install_firestore_backend(page, _field_notes_docs())
    body404 = open(os.path.join(HERE, "..", "404.html"), "rb").read()
    page.route("**/stats/**", lambda r: r.fulfill(status=404, content_type="text/html", body=body404))
    page.goto(f"{BASE}/stats/index.html?load={FN_CODE}&live=1", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_url("**/agent-hub.html?code=*", timeout=10000)
    record("sheet-io", "an old stats/index.html?load=CODE link forwards to that Agent on Agent Hub",
           page.url.endswith(f"/agent-hub.html?code={FN_CODE}"), page.url)
    page.goto(f"{BASE}/stats/index.html?new=1", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_url("**/agent-hub.html#new", timeout=10000)
    record("sheet-io", "…and stats/index.html?new=1 opens New Recruit", page.url.endswith("/agent-hub.html#new"), page.url)
    errs_all.extend(errs)
    page.close()
    # The old sheet's in-page confirm (dgConfirm) lives on in the notebook:
    # New Recruit's Discard asks in the page, so it works in a home-screen
    # app (where confirm() just answers no without showing anything).
    dialogs = []
    page, errs = _field_notes_page(p, width=1180, height=900,
                                   extra_init="localStorage.setItem('dg_recruit_draft', JSON.stringify({v: 1, step: 3, bio: {name: 'Draft Doe'}, savedAt: 1790000000000}));")
    page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
    page.goto(f"{BASE}/agent-hub.html#new", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_selector("#nr-root [data-a=discard]", timeout=15000)
    page.click("#nr-root [data-a=discard]")
    page.wait_for_selector("#fn-confirm [data-cf=ok]", timeout=5000)
    page.click("#fn-confirm [data-cf=ok]")
    gone = wait_for_condition(lambda: page.evaluate("() => !localStorage.getItem('dg_recruit_draft')") or None, timeout_ms=5000)
    record("sheet-io", "New Recruit's Discard asks in the page, not a native dialog, and discards the draft",
           bool(gone) and not dialogs, str(dialogs))
    errs_all.extend(errs)
    page.close()
    record("sheet-io", "no JS exceptions (sheet files)", not errs_all, str(errs_all[:3]))
    return errs_all


def test_recruit_play_test_round1(p):
    """Play-test fixes for M2 (2026-10-10): on a phone the terminal (the
    Contract, and saving an edit) scrolls and has big Y / N buttons, which
    file it; Profiling's generator lists The Complex's professions grouped
    by agency and starts on the Agent's own profession; the image prompts
    carry the Agent's age (functions/ai-prompts.js)."""
    errs_all = []
    # 1. Phone: the save terminal scrolls to a tappable Y.
    page, errs = _field_notes_page(p, width=390, height=640)
    page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function("() => window.dgFieldNotes && window.dgFieldNotes.isHost", timeout=10000)
    page.evaluate("() => { window.__oath = 'pending'; window.dgFieldNotes.contract({ code: 'FNRT-0001', name: 'Mara Voss', profession: 'Federal Agent', incursion: 'A long night in a quiet town that nobody would talk about afterwards, twice over.' }).then(v => { window.__oath = v; }); }")
    page.wait_for_selector("#fn-orders", timeout=5000)
    page.click("#fn-orders")
    tap = "#fn-orders .fn-orders-tap [data-o=y]"
    page.wait_for_selector(tap, state="visible", timeout=5000)
    page.wait_for_timeout(700)
    inview = page.evaluate("(s) => { const r = document.querySelector(s).getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.height >= 44; }", tap)
    scrolls = page.evaluate("() => { const o = document.getElementById('fn-orders'); return getComputedStyle(o).overflowY === 'auto'; }")
    page.click(tap)
    ok = wait_for_condition(lambda: page.evaluate("() => window.__oath === true"), timeout_ms=4000)
    record("recruit-fix", "phone: the Contract scrolls, its big Y is on screen and tappable, and Y signs", bool(inview) and bool(scrolls) and bool(ok), f"inview={inview} scrolls={scrolls} ok={ok}")
    errs_all.extend(errs)
    page.close()
    # 2. Profiling's generator: grouped, The Complex included, preset from the brief.
    docs = _field_notes_docs()
    docs[f"briefs/{FN_CODE}"]["profession"] = "Protective Detail Agent"
    page, errs = _field_notes_page(p, width=1180, height=900, docs=docs)
    page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function("() => document.querySelectorAll('#rand-profession optgroup').length > 3", timeout=10000)
    groups = page.eval_on_selector_all("#rand-profession optgroup", "els => els.map(e => e.label)")
    val = wait_for_condition(lambda: page.evaluate("() => document.getElementById('rand-profession').value") or None, timeout_ms=8000)
    record("recruit-fix", "Profiling's generator: the Handbook, then The Complex by agency, starting on the Agent's own profession",
           groups[0] == "Agent's Handbook" and "The Complex — Secret Service" in groups and "The Complex — NSA" in groups and val == "usss_ppd", f"{groups} {val}")
    look = page.evaluate("() => { for (let i = 0; i < 30; i++) { const a = window.dgAppearanceGen.generate('nsa_tao'); if (a.jacket) return a.jacket; } return ''; }")
    record("recruit-fix", "a Complex profession has its own clothing (over the closest Handbook look)",
           look in ["black hoodie", "conference-swag zip-up"], look)
    errs_all.extend(errs)
    page.close()
    # 3. The age reaches the image prompt instructions.
    try:
        out = subprocess.run(["node", "-e", "const {buildAppearancePrompt}=require('./functions/ai-prompts.js');"
                              "const c={age_range:'Late 40s',sex:'Female',nationality:'American',build:'lean'};"
                              "console.log(['base','outfit'].every(m=>{const t=buildAppearancePrompt({character:c,injuries:[],mode:m,era:'20s'});return /Apparent age: late 40s/.test(t)&&/in her late 40s/.test(t);}))"],
                             capture_output=True, text=True, timeout=30, cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        record("recruit-fix", "image prompts: the age is labelled and required, Face and Outfit Plate alike", out.stdout.strip() == "true", out.stdout + out.stderr[:200])
    except FileNotFoundError:
        record("recruit-fix", "image prompts: the age is labelled and required (node not installed; skipped)", True, "")
    record("recruit-fix", "no JS exceptions (play-test fixes)", not errs_all, str(errs_all[:3]))


def test_agent_file_wear(p):
    """M3: the Agent File's paper wears as SAN falls (assets/agent-wear.css,
    built by scripts/agent-wear/build.py; agent-paper.js sets the stage).
    50+ clean; 49-40, 39-30, 29-20, 19-10 stages 1-4; 9-1 stage 5 with a torn
    margin and the INSANE stamp (worn, filling in from SAN 5); 0 stage 6, the
    stamp solid. Dropping SAN in play moves the stage with a fade; the
    notebook's Settings switch it off on this device."""
    errs_all = []
    def page_at(san, width=1180):
        docs = _field_notes_docs()
        st = {"v": 1, "stats": {"STR": 10, "CON": 12, "DEX": 11, "INT": 14, "POW": 12, "CHA": 13},
              "derived": {"hp": 11, "wp": 12, "san": san, "bp": 43}, "bio": {"name": "Mara Voss", "profession": "federal_agent", "player_name": "fn tester"}}
        docs[f"characters/{FN_CODE}"] = character_doc(FN_CODE, st, "fn tester")
        page, errs = _field_notes_page(p, width=width, docs=docs,
                                       extra_init="localStorage.setItem('dg_fn_orders_ack', JSON.stringify({'%s': 1790000000000}));" % FN_CODE)
        page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
        page.wait_for_selector(f"#ah-sheet-{FN_CODE} .as-paper.ap .ap-vitals", timeout=15000)
        return page, errs
    sel = f"#ah-sheet-{FN_CODE} .as-paper.ap"
    # The stamp sits on the header's name (photo and name), not over the buttons.
    # The wear is on the whole page (Agent Hub's .paper), not the Agent File inside it.
    probe = """(s) => { const el = document.querySelector(s), pg = el.closest('.paper'), b = getComputedStyle(pg, '::before'),
              h = document.getElementById('ah-title-%s'), a = getComputedStyle(h, '::after');
        return { tier: el.getAttribute('data-sanity-tier') || '0', insane: getComputedStyle(h).getPropertyValue('--insane').trim(),
                 fill: getComputedStyle(h).getPropertyValue('--fill').trim(), bg: b.backgroundImage !== 'none' && b.content !== 'none',
                 host: h.hasAttribute('data-wear-stamp'), paperStamp: getComputedStyle(el, '::after').content,
                 stamp: a.content, stampOp: a.opacity, mask: getComputedStyle(pg).maskImage || getComputedStyle(pg).webkitMaskImage || 'none',
                 ownWear: getComputedStyle(el, '::before').backgroundImage, op: b.opacity }; }""" % FN_CODE
    want = {55: ("0", False), 45: ("1", False), 35: ("2", False), 25: ("3", False), 15: ("4", False), 9: ("5", True), 5: ("5", True), 2: ("5", True), 0: ("6", True)}
    page, errs = page_at(55)
    got = {}
    for san in want:
        page.close(); errs_all.extend(errs)
        page, errs = page_at(san)
        page.wait_for_timeout(1500)
        got[san] = page.evaluate(probe, sel)
    ok = all(got[s]["tier"] == want[s][0] and (got[s]["bg"] == (want[s][0] != "0")) and (('INSANE' in got[s]["stamp"]) == want[s][1]) and got[s]["host"] == want[s][1] and 'INSANE' not in got[s]["paperStamp"] and got[s]["ownWear"] == 'none' for s in want)
    record("wear", "the stage follows SAN, worn over the whole page: clean at 50+, stages 1-4 by tens, 5 from 9, 6 at 0; INSANE only from 9, on the header name",
           ok, json.dumps({s: [got[s]["tier"], got[s]["bg"], 'INSANE' in got[s]["stamp"]] for s in got}))
    # The user's curve: 49-40 1-5%, 39-30 6-10%, 29-20 11-25%, 19-10 26-50%, 9-0 51-100%.
    want_op = {45: .028, 35: .078, 25: .172, 15: .367, 9: .51, 5: .728, 2: .891, 0: 1}
    record("wear", "the wear's opacity follows SAN point by point (1-5% at 49-40 ... 51-100% at 9-0, 100% at SAN 0)",
           all(abs(float(got[t]["op"]) - want_op[t]) < .006 for t in want_op), json.dumps({t: got[t]["op"] for t in want_op}))
    record("wear", "the stamp: worn from 9 (no fill), filling in from 5, solid at 0",
           got[9]["fill"] == "0" and float(got[9]["insane"]) >= .3 and got[5]["fill"] == "0" and float(got[2]["fill"]) > 0 and got[0]["fill"] == "1" and got[0]["insane"] == "1",
           json.dumps({s: [got[s]["insane"], got[s]["fill"]] for s in (9, 5, 2, 0)}))
    record("wear", "the page's own edge tears from SAN 9 (inside its padding): edge mask on stages 5-6 only",
           "url(" in got[5]["mask"] and "url(" in got[0]["mask"] and got[15]["mask"] in ("none", ""), got[5]["mask"][:60])
    page.close(); errs_all.extend(errs)
    # Dropping SAN in play: 50 -> 49 moves to stage 1, with the fade.
    page, errs = page_at(50)
    page.click(f"{sel} [data-a='san-']")
    page.wait_for_function("(s) => document.querySelector(s).getAttribute('data-sanity-tier') === '1'", arg=sel, timeout=6000)
    record("wear", "losing SAN in play moves the paper to the next stage, fading in", page.evaluate("(s) => document.querySelector(s).classList.contains('ap-wear-change')", sel), "")
    # Settings: off, on this device.
    page.evaluate("() => window.dgFieldNotes.open('settings')")
    page.click("#fn-veil [data-s=wear]")
    off = page.evaluate("(s) => { const pg = document.querySelector(s).closest('.paper'); return document.documentElement.classList.contains('dg-no-wear') && getComputedStyle(pg, '::before').backgroundImage === 'none' && (getComputedStyle(pg).maskImage || 'none') === 'none' && localStorage.getItem('dg_paper_wear') === 'off'; }", sel)
    page.click("#fn-veil [data-s=wear]")
    on = page.evaluate("() => !document.documentElement.classList.contains('dg-no-wear') && localStorage.getItem('dg_paper_wear') === 'on'")
    record("wear", "the notebook's Settings switch the wear off and on again, on this device", bool(off) and bool(on), f"off={off} on={on}")
    errs_all.extend(errs)
    record("wear", "no JS exceptions (paper wear)", not errs_all, str(errs_all[:3]))
    page.close()


def test_agent_file_disorder_stamps(p):
    """A small rubber stamp per Mental Disorder, scattered over the header
    (agent-paper.js placeDisorders): on Agent Hub's .paper-header and the
    notebook's .as-head; never on a button, the name or the vitals, nor on
    each other; the same spots after a reload; a new disorder thumps in; the
    wear switch in Settings hides them."""
    dis = ["PTSD", "Paranoia", "Sleep Disorder"]
    errs_all = []
    def page_at(width):
        docs = _field_notes_docs()
        st = {"v": 1, "stats": {"STR": 10, "CON": 12, "DEX": 11, "INT": 14, "POW": 12, "CHA": 13},
              "derived": {"hp": 11, "wp": 12, "san": 25, "bp": 43},
              "bio": {"name": "Mara Voss", "profession": "federal_agent", "player_name": "fn tester", "disorders": dis}}
        docs[f"characters/{FN_CODE}"] = character_doc(FN_CODE, st, "fn tester")
        page, errs = _field_notes_page(p, width=width, docs=docs,
                                       extra_init="localStorage.setItem('dg_fn_orders_ack', JSON.stringify({'%s': 1790000000000}));" % FN_CODE)
        page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
        page.wait_for_selector(f"#ah-sheet-{FN_CODE} .as-paper.ap .ap-vitals", timeout=15000)
        # The stamps are placed again once the typewriter font is in (their widths change).
        page.evaluate("() => document.fonts.ready")
        page.wait_for_timeout(800)
        return page, errs
    probe = """(area) => { const a = document.querySelector(area), st = [...a.querySelectorAll('.ap-dis-stamp')];
        const R = e => e.getBoundingClientRect(), hit = (x, y) => !(x.right <= y.left || x.left >= y.right || x.bottom <= y.top || x.top >= y.bottom);
        const keep = [...a.querySelectorAll('button, input, select, .ap-vitals, .paper-title, .ah-prof, .paper-meta, .as-name')].map(R).filter(r => r.width);
        return { n: st.length, names: st.map(e => e.textContent), inks: [...new Set(st.map(e => getComputedStyle(e).color))].length,
                 clash: st.some(e => keep.some(k => hit(R(e), k))) || st.some((e, i) => st.some((f, j) => j > i && hit(R(e), R(f)))),
                 why: st.filter(e => keep.some(k => hit(R(e), k))).map(e => e.textContent + ':' + e.className + ':' + getComputedStyle(e).transform),
                 spots: st.map(e => e.style.left + ',' + e.style.top + ',' + e.style.getPropertyValue('--rot')) }; }"""
    hub_area = f"#panel-{FN_CODE} .paper-header"
    for width in (1180, 390):
        page, errs = page_at(width)
        a = page.evaluate(probe, hub_area)
        page.close(); errs_all.extend(errs)
        page, errs = page_at(width)
        b = page.evaluate(probe, hub_area)
        record("disorders", f"one stamp per disorder on Agent Hub's header, clear of buttons, name, vitals and each other ({width}px)",
               a["n"] == 3 and sorted(a["names"]) == sorted(dis) and not a["clash"], json.dumps(a))
        record("disorders", f"the stamps land in the same spots after a reload ({width}px)", a["spots"] == b["spots"], f"{a['spots']} / {b['spots']}")
        if width == 1180:
            record("disorders", "the stamps come in more than one ink", a["inks"] >= 2, str(a["inks"]))
            # A new disorder from the paper's + Disorder: its stamp thumps in, the others stay put.
            b = page.evaluate(probe, hub_area)
            page.click(f"#ah-sheet-{FN_CODE} [data-a='pop'][data-pop='dis']")
            page.select_option(f"#ah-sheet-{FN_CODE} [data-u='dis']", "Obsession")
            page.click(f"#ah-sheet-{FN_CODE} [data-a='dis-add']")
            page.wait_for_function("(a) => document.querySelectorAll(a + ' .ap-dis-stamp').length === 4", arg=hub_area, timeout=6000)
            # Past the thump (it lands scaled up).
            page.wait_for_function("(a) => [...document.querySelectorAll(a + ' .ap-dis-stamp')].every(e => e.getAnimations().every(a => a.playState !== 'running'))", arg=hub_area, timeout=6000)
            c = page.evaluate(probe, hub_area)
            new = page.evaluate("(a) => [...document.querySelectorAll(a + ' .ap-dis-stamp.ap-dis-new')].map(e => e.textContent)", hub_area)
            record("disorders", "a new disorder adds its stamp with a thump; the earlier stamps don't move",
                   new == ["Obsession"] and c["spots"][:3] == b["spots"] and not c["clash"], f"new={new} {c['spots']} was {b['spots']} why={c['why']}")
            # The notebook's Agent File: on its own header.
            page.evaluate("() => window.dgFieldNotes.open('agentfile')")
            page.wait_for_selector("#fn-veil .as-paper.ap .as-head .ap-dis-stamp", timeout=8000)
            nb = page.evaluate(probe, "#fn-veil .as-paper.ap .as-head")
            record("disorders", "the notebook's Agent File stamps its own header the same way", nb["n"] == 4 and not nb["clash"], json.dumps(nb))
            page.evaluate("() => window.dgFieldNotes.open('settings')")
            page.click("#fn-veil [data-s=wear]")
            hidden = page.evaluate("(a) => [...document.querySelectorAll(a + ' .ap-dis-stamp')].every(e => getComputedStyle(e).display === 'none')", hub_area)
            page.click("#fn-veil [data-s=wear]")
            record("disorders", "the wear switch in Settings hides the stamps too", hidden, "")
        page.close(); errs_all.extend(errs)
    record("disorders", "no JS exceptions (disorder stamps)", not errs_all, str(errs_all[:3]))


def test_appearance_carries_over_from_sheet(p):
    """The Appearance brief picks up what the character sheet already knows
    (agent-file.js afCarryFromCharacter_): sex, age range and nationality
    from the Biography, a build from STR+CON and clothes that fit the
    profession -- into empty fields only, saved to the brief so the count
    goes down. Found play-testing: a New Recruit Agent showed "20 of 22
    still to fill in" with sex and age blank. Random Generate keeps the
    sheet's sex."""
    docs = _field_notes_docs()
    st = {"v": 1, "stats": {"STR": 15, "CON": 16, "DEX": 11, "INT": 14, "POW": 12, "CHA": 13},
          "csStats": {"STR": 15, "CON": 16, "DEX": 11, "INT": 14, "POW": 12, "CHA": 13},
          "derived": {"hp": 16, "wp": 12, "san": 60, "bp": 48},
          "bio": {"name": "Alistair Lagavulin", "profession": "pilot_sailor", "player_name": "fn tester",
                  "sex": "male", "age": "52", "nationality": "Scottish"}}
    docs[f"characters/{FN_CODE}"] = character_doc(FN_CODE, st, "fn tester")
    docs[f"briefs/{FN_CODE}"] = {"agent_code": FN_CODE, "char_name": "Alistair Lagavulin", "nationality": "Scottish",
                                 "profession": "Pilot or Sailor", "player_name": "fn tester", "player_name_lc": "fn tester",
                                 "shirt": "his own grey wool jumper"}
    page, errs = _field_notes_page(p, docs=docs,
                                   extra_init="localStorage.setItem('dg_fn_orders_ack', JSON.stringify({'%s': 1790000000000}));" % FN_CODE)
    page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
    _af_state(page)
    page.wait_for_function("() => { const f = document.getElementById('dg-form'); return f && f.elements['build'] && f.elements['build'].value; }", timeout=10000)
    form = page.evaluate("""() => { const f = document.getElementById('dg-form'), v = k => f.elements[k].value;
        return { sex: v('sex'), age: v('age_range'), build: v('build'), jacket: v('jacket'), shirt: v('shirt'), trousers: v('trousers'),
                 footwear: v('footwear'), locked: ['sex', 'age_range', 'build'].every(k => f.elements[k].dataset.locked === '1'),
                 state: document.getElementById('af-appear-state').textContent }; }""")
    record("appearance", "sex and age range come over from the sheet's Biography (\"male\", 52 -> Male, Early 50s)",
           form["sex"] == "Male" and form["age"] == "Early 50s", json.dumps(form))
    record("appearance", "a build from STR+CON (15+16: athletic) and clothes for a Pilot or Sailor",
           form["build"] in ("athletic", "lean and muscular", "fit and rangy", "well-conditioned") and all(form[k] for k in ("jacket", "trousers", "footwear")), json.dumps(form))
    record("appearance", "what the player already wrote stays (the shirt is untouched)", form["shirt"] == "his own grey wool jumper", form["shirt"])
    _pump_until(page, lambda: (fs_doc(page, f"briefs/{FN_CODE}") or {}).get("build"), timeout_ms=6000)
    b = fs_doc(page, f"briefs/{FN_CODE}") or {}
    record("appearance", "the carried values are saved to the brief, and the count goes down",
           b.get("sex") == "Male" and b.get("age_range") == "Early 50s" and b.get("build") == form["build"] and b.get("jacket") == form["jacket"]
           and b.get("shirt") == "his own grey wool jumper" and form["state"] == "13 of 22 still to fill in", json.dumps({k: b.get(k) for k in ("sex", "age_range", "build", "jacket", "shirt")}) + " " + form["state"])
    # Random Generate fills the rest, keeps the sheet's facts, and its facial hair fits a man.
    page.evaluate("() => randomizeAgent(document.getElementById('rand-profession').value || null)")
    after = page.evaluate("""() => { const f = document.getElementById('dg-form'), v = k => f.elements[k].value;
        return { sex: v('sex'), age: v('age_range'), build: v('build'), face: v('face_shape'), fh: v('facial_hair') }; }""")
    female_fh = page.evaluate("() => (window.dgAppearanceGen.RAND_TABLES.facial_hair_female || [])")
    male_fh = page.evaluate("() => (window.dgAppearanceGen.RAND_TABLES.facial_hair_male || [])")
    record("appearance", "Random Generate fills the rest but keeps sex, age and build, and rolls facial hair for the Agent's own sex",
           after["sex"] == "Male" and after["age"] == "Early 50s" and after["build"] == form["build"] and after["face"]
           and (after["fh"] in male_fh or after["fh"] not in female_fh), json.dumps(after))
    record("appearance", "no JS exceptions (carry-over)", not errs, str(errs[:3]))
    page.close()


def test_insane_struck_like_kia(p):
    """SAN 0 is marked the way KIA is: the Agent's name struck through on
    Agent Hub's tab and header, a small INSANE stamp in the stamp row, and
    in the Agent File's Cell list the name struck with an INSANE stamp.
    Live as SAN reaches 0 in play (agent-paper.js onFate ->
    setAgentFate), and on a fresh load."""
    errs_all = []
    def page_at(san, width=None, two=False):
        docs = _field_notes_docs()
        extra = ""
        if two:   # six more Agents, so the strip shows the Agents (N) menu (past six)
            roster = {FN_CODE: {"code": FN_CODE, "char_name": "Mara Voss", "player_name": "fn tester", "saved_at": 9}}
            for k in range(6):
                c = "ANAR-%04d" % (k + 2)
                docs[f"briefs/{c}"] = {"agent_code": c, "char_name": "Ana Reyes %d" % k, "player_name": "fn tester", "player_name_lc": "fn tester"}
                roster[c] = {"code": c, "char_name": "Ana Reyes %d" % k, "player_name": "fn tester", "saved_at": 4 - k}
            extra = "localStorage.setItem('dg_agent_roster', %s);" % json.dumps(json.dumps(roster))
        st = {"v": 1, "stats": {"STR": 10, "CON": 12, "DEX": 11, "INT": 14, "POW": 12, "CHA": 13},
              "derived": {"hp": 11, "wp": 12, "san": san, "bp": 0}, "bio": {"name": "Mara Voss", "profession": "federal_agent", "player_name": "fn tester"}}
        docs[f"characters/{FN_CODE}"] = character_doc(FN_CODE, st, "fn tester")
        page, errs = _field_notes_page(p, docs=docs, **({'width': width} if width else {}),
                                       extra_init="localStorage.setItem('dg_fn_orders_ack', JSON.stringify({'%s': 1790000000000}));" % FN_CODE + extra)
        page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
        page.wait_for_selector(f"#ah-sheet-{FN_CODE} .as-paper.ap .ap-vitals", timeout=15000)
        page.wait_for_timeout(600)
        return page, errs
    probe = """(c) => { const st = document.getElementById('ah-charstamp-' + c), me = document.querySelector('#ah-sheet-' + c + ' .ap-init li.ap-me');
        return { tab: document.getElementById('ah-tablabel-' + c).classList.contains('kia-name'),
                 title: document.getElementById('ah-title-' + c).classList.contains('kia-name'),
                 stamp: !!(st && st.querySelector('.stamp[data-fate="insane"]')), kiaStamp: !!(st && st.querySelector('.stamp[data-fate="kia"]')),
                 cell: !!(me && me.classList.contains('as-kia') && /INSANE/.test(me.textContent)) }; }"""
    page, errs = page_at(1)
    before = page.evaluate(probe, FN_CODE)
    record("insane", "at SAN 1 nothing is struck and there's no INSANE stamp",
           not any(before.values()), json.dumps(before))
    page.click(f"#ah-sheet-{FN_CODE} [data-a='san-']")
    page.wait_for_function("(c) => !!document.querySelector('#ah-charstamp-' + c + ' .stamp[data-fate=\"insane\"]')", arg=FN_CODE, timeout=6000)
    live = page.evaluate(probe, FN_CODE)
    record("insane", "losing the last SAN point in play strikes the name on the tab and header and stamps INSANE, at once",
           live["tab"] and live["title"] and live["stamp"] and not live["kiaStamp"], json.dumps(live))
    page.close(); errs_all.extend(errs)
    page, errs = page_at(0)
    page.wait_for_function("(c) => !!document.querySelector('#ah-charstamp-' + c + ' .stamp[data-fate=\"insane\"]')", arg=FN_CODE, timeout=6000)
    page.evaluate("(c) => document.getElementById('ah-sheet-' + c)._ap.toggleCell(true)", FN_CODE)   # the Cell drop-down
    page.wait_for_selector(f"#ah-sheet-{FN_CODE} .ap-init li.ap-me", timeout=6000)
    loaded = page.evaluate(probe, FN_CODE)
    record("insane", "an Agent saved at SAN 0 opens struck through and stamped INSANE, the Cell list too",
           loaded["tab"] and loaded["title"] and loaded["stamp"] and loaded["cell"], json.dumps(loaded))
    look = page.evaluate("""(c) => { const me = document.querySelector('#ah-sheet-' + c + ' .ap-init li.ap-me'), n = getComputedStyle(me.querySelector('.as-mname')), st = getComputedStyle(me.querySelector('.as-stamp'));
        return { deco: n.textDecorationLine, color: n.color, border: st.borderTopStyle, stampColor: st.color }; }""", FN_CODE)
    record("insane", "in the Cell list the INSANE Agent's name is struck through in red, with a bordered red stamp",
           "line-through" in look["deco"] and look["color"] == look["stampColor"] and look["border"] == "solid", json.dumps(look))
    page.close(); errs_all.extend(errs)
    # Past six Agents, on a phone: the Agents menu shows the struck name and its INSANE stamp.
    page, errs = page_at(0, width=390, two=True)
    page.wait_for_function("(c) => !!document.querySelector('#ah-charstamp-' + c + ' .stamp[data-fate=\"insane\"]')", arg=FN_CODE, timeout=6000)
    page.click("#tab-strip .tw-switch > span")
    page.wait_for_selector(".ah-agent-menu:not([hidden]) button[data-code]", timeout=6000)
    menu = page.evaluate("""(c) => { const b = document.querySelector('.ah-agent-menu button[data-code="' + c + '"]');
        return { struck: !!b.querySelector('.kia-name'), stamps: [...b.querySelectorAll('.ah-menu-stamp')].map(e => e.textContent), fits: b.scrollWidth <= b.clientWidth + 1 }; }""", FN_CODE)
    record("insane", "on a phone the Agents menu shows the INSANE Agent struck through with an INSANE stamp that fits",
           menu["struck"] and menu["stamps"] == ["INSANE"] and menu["fits"], json.dumps(menu))
    page.close(); errs_all.extend(errs)
    record("insane", "no JS exceptions (INSANE like KIA)", not errs_all, str(errs_all[:3]))


def test_bond_at_zero_struck(p):
    """A Bond whose score reaches 0 is struck through in red on the Agent
    File; − to 0 in play strikes it at once, + brings it back."""
    docs = _field_notes_docs()
    st = {"v": 1, "stats": {"STR": 10, "CON": 12, "DEX": 11, "INT": 14, "POW": 12, "CHA": 13},
          "derived": {"hp": 11, "wp": 12, "san": 60, "bp": 48}, "bio": {"name": "Mara Voss", "profession": "federal_agent", "player_name": "fn tester"},
          "bonds": [{"name": "Lena Voss", "relationship": "Sister", "score": 0}, {"name": "Tom Hale", "relationship": "Partner", "score": 1}]}
    docs[f"characters/{FN_CODE}"] = character_doc(FN_CODE, st, "fn tester")
    page, errs = _field_notes_page(p, docs=docs,
                                   extra_init="localStorage.setItem('dg_fn_orders_ack', JSON.stringify({'%s': 1790000000000}));" % FN_CODE)
    page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_selector(f"#ah-sheet-{FN_CODE} .ap-bond", timeout=15000)
    broken = lambda: page.evaluate("(c) => [...document.querySelectorAll('#ah-sheet-' + c + ' .ap-bond')].map(b => b.classList.contains('ap-bond-broken'))", FN_CODE)
    first = broken()
    sel = f"#ah-sheet-{FN_CODE} .ap-bond"
    deco = page.evaluate("(s) => getComputedStyle(document.querySelector(s + '.ap-bond-broken .ap-bn')).textDecorationLine", sel)
    record("bonds", "a Bond at 0 is struck through in red; one above 0 isn't", first == [True, False] and "line-through" in deco, f"{first} {deco}")
    page.click(f"{sel} >> nth=1 >> [data-a='bond-']")
    page.wait_for_function("(c) => document.querySelectorAll('#ah-sheet-' + c + ' .ap-bond.ap-bond-broken').length === 2", arg=FN_CODE, timeout=6000)
    page.click(f"{sel} >> nth=0 >> [data-a='bond+']")
    page.wait_for_function("(c) => !document.querySelector('#ah-sheet-' + c + ' .ap-bond').classList.contains('ap-bond-broken')", arg=FN_CODE, timeout=6000)
    record("bonds", "taking a Bond to 0 in play strikes it at once, and + brings it back", True, "")
    record("bonds", "no JS exceptions (broken Bonds)", not errs, str(errs[:3]))
    page.close()


def test_notebook_flip_agents(p):
    """The notebook's Agent File card flips through this player's Agents:
    ‹ n of N › on the pocket (a second card peeks behind), the same in the
    phone's header; a flip makes that Agent the current one (the Dice
    Roller's key) and the card and pages follow."""
    ANA = "ANAR-0002"
    docs = _field_notes_docs()
    docs[f"briefs/{ANA}"] = {"agent_code": ANA, "char_name": "Ana Reyes", "player_name": "fn tester", "player_name_lc": "fn tester"}
    roster = {FN_CODE: {"code": FN_CODE, "char_name": "Mara Voss", "codename": "PARADE", "player_name": "fn tester", "saved_at": 5},
              ANA: {"code": ANA, "char_name": "Ana Reyes", "player_name": "fn tester", "saved_at": 4}}
    extra = ("localStorage.setItem('dg_fn_orders_ack', JSON.stringify({'%s': 1790000000000, '%s': 1790000000000}));" % (FN_CODE, ANA) +
             "localStorage.setItem('dg_agent_roster', %s); if (!sessionStorage.getItem('fl_seeded')) { sessionStorage.setItem('fl_seeded', '1'); localStorage.setItem('dg_stats_cloud_code', '%s'); }" % (json.dumps(json.dumps(roster)), FN_CODE))
    errs_all = []
    for width in (1300, 390):
        page, errs = _field_notes_page(p, width=width, docs=docs, extra_init=extra)
        page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
        page.wait_for_timeout(1500)
        page.evaluate("() => window.dgFieldNotes.open('agentfile')")
        page.wait_for_timeout(1200)
        cnt = "#fn-root [data-fn-slot=flip-count]" if width > 600 else "#fn-root [data-fn-slot=phone-flip-count]"
        before = page.evaluate("(c) => ({ count: document.querySelector(c).textContent, name: document.querySelector('#fn-root [data-fn-slot=card-name]').textContent, behind: !document.querySelector('#fn-root [data-fn-slot=card-behind]').hidden })", cnt)
        record("flip", f"the Agent File card shows 2 of 2 for Mara Voss (by name), with a card behind ({width}px)",
               before["count"] == "2 of 2" and before["name"] == "Mara Voss" and before["behind"], json.dumps(before))
        btn = "#fn-root .fn-flip [data-fn=flip-next]" if width > 600 else "#fn-root .fn-phone-flip [data-fn=flip-next]"
        page.click(btn)
        page.wait_for_function("(c) => document.querySelector(c).textContent === '1 of 2'", arg=cnt, timeout=6000)
        after = page.evaluate("() => ({ name: document.querySelector('#fn-root [data-fn-slot=card-name]').textContent, phone: document.querySelector('#fn-root [data-fn-slot=phone-name]').textContent, code: localStorage.getItem('dg_stats_cloud_code') })")
        record("flip", f"› turns to Ana Reyes: the card, the header and the current Agent follow ({width}px)",
               after["code"] == ANA and "Ana Reyes" in (after["name"] + after["phone"]), json.dumps(after))
        if width > 600:
            record("flip", "flipping doesn't open the Agent File page by itself (the arrows aren't the card)",
                   page.evaluate("() => !document.getElementById('fn-veil').hidden"), "")
        page.close(); errs_all.extend(errs)
    # One Agent: no arrows.
    page, errs = _field_notes_page(p, width=1300, extra_init="localStorage.setItem('dg_fn_orders_ack', JSON.stringify({'%s': 1790000000000}));" % FN_CODE)
    page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(1200)
    page.evaluate("() => window.dgFieldNotes.open('agentfile')"); page.wait_for_timeout(800)
    record("flip", "with only one Agent there's nothing to flip: no arrows, no card behind",
           page.evaluate("() => document.querySelector('#fn-root [data-fn-slot=flip]').hidden && document.querySelector('#fn-root [data-fn-slot=card-behind]').hidden"), "")
    page.close(); errs_all.extend(errs)
    record("flip", "no JS exceptions (flip Agents)", not errs_all, str(errs_all[:3]))


def test_evidence_sort(p):
    """Evidence on the player side sorts by date or title -- Newest first
    (default), Oldest first, A -> Z, Z -> A -- in the notebook's Evidence
    page and on Agent Hub, remembered on this device (one key for both)."""
    docs = _field_notes_docs()
    for i, (title, when) in enumerate([("Morgue Photographs", 3000), ("Harbour Master's Log", 1000), ("Coroner's Preliminary", 2000)]):
        docs[f"evidence/ev_s{i}"] = {"title": title, "body": "-", "cell_id": FN_CELL, "operation_id": "op_fn_a", "visible_to": [FN_CODE], "released": True, "created_at": when}
    docs.pop("evidence/ev_fn_1", None)
    page, errs = _field_notes_page(p, docs=docs, extra_init="localStorage.setItem('dg_fn_orders_ack', JSON.stringify({'%s': 1790000000000}));" % FN_CODE)
    page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(1500)
    page.evaluate("() => window.dgFieldNotes.open('evidence')")
    page.wait_for_selector("#fn-veil [data-ev-sort]", timeout=10000)
    titles = lambda: page.evaluate("() => [...document.querySelectorAll('#fn-veil .fn-card-sheet .fn-card-title')].map(e => e.textContent)")
    wait_for_condition(lambda: len(titles()) == 3 or None, timeout_ms=8000)
    got = {"new": titles()}
    for how in ("old", "az", "za"):
        page.select_option("#fn-veil [data-ev-sort]", how)
        got[how] = titles()
    want = {"new": ["Morgue Photographs", "Coroner's Preliminary", "Harbour Master's Log"],
            "old": ["Harbour Master's Log", "Coroner's Preliminary", "Morgue Photographs"],
            "az": ["Coroner's Preliminary", "Harbour Master's Log", "Morgue Photographs"],
            "za": ["Morgue Photographs", "Harbour Master's Log", "Coroner's Preliminary"]}
    record("evidence", "the notebook's Evidence sorts Newest first by default, then Oldest first, A -> Z, Z -> A", got == want, json.dumps(got))
    errs_all = list(errs)
    page.close()
    # Agent Hub's list: the same Sort, and the same remembered choice.
    page = p.new_page()
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    install_notes_firestore_stub(page)
    _block_fonts(page)
    install_firestore_backend(page, {"cells/cell_1": {"name": "Cell Alpha", "member_codes": ["OWEN-CS12"]},
                                     "briefs/OWEN-CS12": {"char_name": "Owen Castillo"}})
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.evaluate("() => { localStorage.setItem('dg_agent_roster', JSON.stringify({'OWEN-CS12': {code: 'OWEN-CS12', char_name: 'Owen Castillo', saved_at: 1}})); localStorage.setItem('dg_evidence_sort', 'za'); }")
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(900)
    wait_for_condition(lambda: notes_firestore_listener_count(page) >= 1, timeout_ms=8000)
    ev = [{"id": f"ev{i}", "evidence_id": f"ev{i}", "title": t, "body": "-", "photo": "", "cell_id": "", "created_at": str(w), "visible_to": ["ALL"]}
          for i, (t, w) in enumerate([("Morgue Photographs", 3000), ("Harbour Master's Log", 1000), ("Coroner's Preliminary", 2000)])]
    push_firestore_snapshot(page, "evidence", [["visible_to", "array-contains-any", ["OWEN-CS12", "ALL"]]], ev)
    hub = "#ah-handouts-OWEN-CS12 .ah-handout-title"
    page.wait_for_selector(hub, timeout=8000)
    hub_t = page.evaluate("(s) => [...document.querySelectorAll(s)].map(e => e.textContent)", hub)
    sel = page.evaluate("() => (document.querySelector('#ah-handouts-filter-OWEN-CS12 select[data-ev-sort]') || {}).value")
    record("evidence", "Agent Hub's Evidence list has the same Sort, and remembers the choice (Z -> A)", hub_t == want["za"] and sel == "za", f"{hub_t} {sel}")
    page.select_option("#ah-handouts-filter-OWEN-CS12 select[data-ev-sort]", "az")
    record("evidence", "...and sorting there works too (A -> Z), saved for the notebook as well",
           page.evaluate("(s) => [...document.querySelectorAll(s)].map(e => e.textContent)", hub) == want["az"]
           and page.evaluate("() => localStorage.getItem('dg_evidence_sort')") == "az", "")
    errs_all.extend(errs)
    errs = errs_all
    record("evidence", "no JS exceptions (evidence sort)", not errs, str(errs[:3]))
    page.close()


def test_notes_tags_quick_and_arrange(p):
    """Notes, as play-tested (2026-10-12: "tagging doesn't work" -- a tag
    was saved but shown nowhere): highlight words -> "Tag as" NPC /
    Location / Clue / Operation wraps them in a tag, saved in the block
    (tags list marked inline); the sidebar's Tags list counts them and a
    tap filters the page; the search finds tags; the notebook's Quick
    notes (quick:true) wait in the sidebar, not on the page, until "Add to
    page"; ✎ Arrange hides and orders the sidebar's lists, per device."""
    page = p.new_page(viewport={"width": 1280, "height": 900})
    page.set_default_timeout(15000)
    errs = collect_errors(page)
    install_notes_firestore_stub(page)
    _block_fonts(page)
    cell = {"cell_id": "cell_1", "name": "Cell Alpha", "handler": "Sam", "member_codes": ["OWEN-CS12"]}
    seed_cells_docs(page, [cell])
    page.route("**/script.google.com/**", lambda r: r.fulfill(status=200, content_type="application/json", body='{"status":"OK"}'))
    page.add_init_script("""try { localStorage.setItem('dg_agent_roster', JSON.stringify({'OWEN-CS12': {code: 'OWEN-CS12', char_name: 'Owen Castillo', saved_at: Date.now()}}));
      localStorage.setItem('dg_notes_identity_OWEN-CS12', JSON.stringify({color: '#2b6cb0', font: 'kalam'})); } catch (e) {}""")
    page.goto(f"{BASE}/notes/index.html", wait_until="domcontentloaded", timeout=15000)
    wait_for_condition(lambda: page.query_selector(".dg-notes-identity-modal") is not None or page.query_selector("#dg-notes-editor-mount") is not None, timeout_ms=8000)
    if page.query_selector(".dg-notes-identity-modal"):
        page.click(".dg-notes-color-swatch"); page.click(".dg-notes-identity-confirm")
    wait_for_condition(lambda: notes_firestore_listener_count(page) >= 2, timeout_ms=8000)
    own = [
        {"id": "blk1", "agent_code": "OWEN-CS12", "block_type": "paragraph", "text": json.dumps({"text": "We met Dr Hale at the Old Lighthouse."}), "shared": False, "sort_order": 1000, "created_at": 1, "updated_at": 1, "tags": "[]"},
        {"id": "blk2", "agent_code": "OWEN-CS12", "block_type": "paragraph", "text": json.dumps({"text": "The weather turned."}), "shared": False, "sort_order": 2000, "created_at": 2, "updated_at": 2, "tags": "[]"},
        {"id": "q1", "agent_code": "OWEN-CS12", "block_type": "paragraph", "text": json.dumps({"text": "Hale lied about the 14th."}), "shared": False, "sort_order": 3000, "created_at": 3, "updated_at": 3,
         "tags": json.dumps([{"type": "clue", "label": "Clue"}]), "quick": True},
    ]
    push_firestore_snapshot(page, "cells/cell_1/notes", [["shared", "==", True]], [])
    push_firestore_snapshot(page, "cells/cell_1/notes", [["agent_code", "==", "OWEN-CS12"]], own)
    wait_for_condition(lambda: page.locator("#dg-notes-editor-mount .ce-block").count() >= 2 or None, timeout_ms=8000)
    blocks = lambda: page.evaluate("() => [...document.querySelectorAll('#dg-notes-editor-mount .ce-block')].map(b => b.innerText.trim())")
    record("notes-tags", "a Quick note waits in the sidebar's Quick notes, not on the page",
           "Hale lied about the 14th." not in " ".join(blocks()) and "Hale lied" in (page.text_content("#dg-notes-quick-mount") or ""), json.dumps(blocks()))
    # Highlight "Dr Hale" and tag it NPC.
    page.evaluate("""() => { const el = document.querySelector('#dg-notes-editor-mount .ce-block [contenteditable]'); const tn = el.firstChild;
        const i = tn.textContent.indexOf('Dr Hale'); el.focus(); const r = document.createRange(); r.setStart(tn, i); r.setEnd(tn, i + 7);
        const s = document.getSelection(); s.removeAllRanges(); s.addRange(r); }""")
    page.wait_for_selector(".dg-notes-tagbar:not([hidden])", timeout=5000)
    record("notes-tags", "highlighting words shows \"Tag as\" NPC / Location / Clue / Operation under them",
           page.locator(".dg-notes-tagbar [data-tagtype]").count() == 4, "")
    clear_firestore_writes(page)
    page.click(".dg-notes-tagbar [data-tagtype=npc]")
    w = wait_for_condition(lambda: next((x for x in firestore_writes(page, "cells/cell_1/notes/blk1") if "dg-tag" in (x["data"].get("text") or "")), None), timeout_ms=20000)
    tags = json.loads((w or {}).get("data", {}).get("tags") or "[]")
    record("notes-tags", "the words are wrapped in a tag in the note itself, and the block's tags list carries it",
           bool(w) and 'data-tag=\\"npc\\"' in w["data"]["text"] and {"type": "npc", "label": "Dr Hale", "inline": True} in tags, json.dumps(w)[:400] if w else "no write")
    record("notes-tags", "the tagged words are marked on the page", page.locator("#dg-notes-editor-mount .dg-tag.dg-tag-npc").count() == 1, "")
    wait_for_condition(lambda: "Dr Hale" in (page.text_content("#dg-notes-tags-mount") or "") or None, timeout_ms=6000)
    record("notes-tags", "the sidebar's Tags list shows it under NPC with a count", "NPC" in (page.text_content("#dg-notes-tags-mount") or "") and "Dr Hale 1" in (page.text_content("#dg-notes-tags-mount") or ""),
           page.text_content("#dg-notes-tags-mount") or "")
    page.click("#dg-notes-tags-mount [data-tagfilter]")
    hidden = page.evaluate("() => [...document.querySelectorAll('#dg-notes-editor-mount .ce-block')].map(b => b.classList.contains('dg-notes-filtered-out'))")
    record("notes-tags", "tapping a tag shows only the notes with it (the others are hidden, not changed)", hidden == [False, True], str(hidden))
    page.click("[data-tag-clear]")
    record("notes-tags", "...and the filter clears", page.locator("#dg-notes-editor-mount .ce-block.dg-notes-filtered-out").count() == 0, "")
    page.fill(".dg-notes-search", "#npc")
    page.check(".dg-notes-search-everywhere")
    wait_for_condition(lambda: "We met" in (page.text_content("#dg-notes-toc-mount") or "") or None, timeout_ms=6000)
    record("notes-tags", "the search finds tags too (\"#npc\" finds the note tagged NPC)",
           "We met" in (page.text_content("#dg-notes-toc-mount") or "") and "weather" not in (page.text_content("#dg-notes-toc-mount") or ""), page.text_content("#dg-notes-toc-mount") or "")
    page.uncheck(".dg-notes-search-everywhere"); page.fill(".dg-notes-search", "")
    # Quick note -> Add to page.
    wait_for_condition(lambda: page.locator("[data-qn-add]").count() == 1 or None, timeout_ms=6000)
    clear_firestore_writes(page)
    page.click("[data-qn-add]")
    w = wait_for_condition(lambda: next((x for x in firestore_writes(page, "cells/cell_1/notes/q1") if x["data"].get("quick") is False), None), timeout_ms=20000)
    record("notes-tags", "\"Add to page\" puts the Quick note on the page (saved, no longer waiting) and out of the list",
           bool(w) and "Hale lied about the 14th." in " ".join(blocks()) and page.locator("[data-qn-add]").count() == 0, json.dumps(blocks()))
    # ✎ Arrange: hide Tags, move Evidence up -- remembered.
    page.click("[data-arrange]")
    page.uncheck(".dg-notes-arrange [data-arr-on=tags]")
    record("notes-tags", "✎ Arrange hides a list (Tags)", page.evaluate("() => document.querySelector('.dg-notes-side[data-side=tags]').hidden"), "")
    page.click(".dg-notes-arrange [data-arr-up='3']")
    order = page.evaluate("() => [...document.querySelectorAll('.dg-notes-side')].map(e => e.dataset.side)")
    saved = page.evaluate("() => JSON.parse(localStorage.getItem('dg_notes_sidebar') || '[]')")
    record("notes-tags", "...and orders them (Evidence up one), remembered on this device",
           order == ["index", "tags", "evidence", "quick"] and [x["id"] for x in saved] == order and not [x for x in saved if x["id"] == "tags"][0]["on"], f"{order} {saved}")
    record("notes-tags", "no JS exceptions (tags, quick notes, arrange)", not errs, str(errs[:3]))
    page.close()


def test_notes_tags_headings_and_quick(p):
    """Notes, play-tested 2026-10-19: a heading tagged by highlighting
    ("Meadowbrook") didn't show in the Tags list; the toolbar's Tag button
    did nothing and is gone; a Quick note written in the notebook while the
    Notes page was open never showed under Quick notes; and a Quick note's
    tag (NPC / Location / Clue / Operation) didn't count as a tag the way a
    tag on the page does."""
    page = p.new_page(viewport={"width": 1280, "height": 900})
    page.set_default_timeout(15000)
    errs = collect_errors(page)
    install_notes_firestore_stub(page)
    _block_fonts(page)
    cell = {"cell_id": "cell_1", "name": "Cell Alpha", "handler": "Sam", "member_codes": ["OWEN-CS12"]}
    seed_cells_docs(page, [cell])
    page.route("**/script.google.com/**", lambda r: r.fulfill(status=200, content_type="application/json", body='{"status":"OK"}'))
    page.add_init_script("""try { localStorage.setItem('dg_agent_roster', JSON.stringify({'OWEN-CS12': {code: 'OWEN-CS12', char_name: 'Owen Castillo', saved_at: Date.now()}}));
      localStorage.setItem('dg_notes_identity_OWEN-CS12', JSON.stringify({color: '#2b6cb0', font: 'kalam'})); } catch (e) {}""")
    page.goto(f"{BASE}/notes/index.html", wait_until="domcontentloaded", timeout=15000)
    wait_for_condition(lambda: page.query_selector(".dg-notes-identity-modal") is not None or page.query_selector("#dg-notes-editor-mount") is not None, timeout_ms=8000)
    if page.query_selector(".dg-notes-identity-modal"):
        page.click(".dg-notes-color-swatch"); page.click(".dg-notes-identity-confirm")
    wait_for_condition(lambda: notes_firestore_listener_count(page) >= 2, timeout_ms=8000)
    own = [
        {"id": "h1", "agent_code": "OWEN-CS12", "block_type": "header", "text": json.dumps({"text": "Meadowbrook", "level": 2}), "shared": False, "sort_order": 1000, "created_at": 1, "updated_at": 1, "tags": "[]"},
        {"id": "p1", "agent_code": "OWEN-CS12", "block_type": "paragraph", "text": json.dumps({"text": "We went to the pub."}), "shared": False, "sort_order": 2000, "created_at": 2, "updated_at": 2, "tags": "[]"},
        # an older Quick note already on the page, tagged by type only
        {"id": "old", "agent_code": "OWEN-CS12", "block_type": "paragraph", "text": json.dumps({"text": "Fuller college"}), "shared": False, "sort_order": 3000, "created_at": 3, "updated_at": 3,
         "tags": json.dumps([{"type": "location", "label": "Location"}])},
    ]
    push_firestore_snapshot(page, "cells/cell_1/notes", [["shared", "==", True]], [])
    push_firestore_snapshot(page, "cells/cell_1/notes", [["agent_code", "==", "OWEN-CS12"]], own)
    wait_for_condition(lambda: page.locator("#dg-notes-editor-mount .ce-block").count() >= 3 or None, timeout_ms=8000)
    record("notes-tags", "the toolbar has no Tag button any more (tagging is by highlighting)", page.locator(".dg-notes-tag-btn").count() == 0, "")
    tags = lambda: page.text_content("#dg-notes-tags-mount") or ""
    record("notes-tags", "a note tagged by its type alone (an older Quick note) counts in Tags under its own words",
           "Fuller college 1" in tags(), tags())
    # Tag the heading as a Location by highlighting it.
    page.evaluate("""() => { const el = document.querySelector('#dg-notes-editor-mount .ce-block .ce-header'); const tn = el.firstChild;
        el.focus(); const r = document.createRange(); r.setStart(tn, 0); r.setEnd(tn, tn.textContent.length);
        const s = document.getSelection(); s.removeAllRanges(); s.addRange(r); }""")
    page.wait_for_selector(".dg-notes-tagbar:not([hidden])", timeout=5000)
    clear_firestore_writes(page)
    page.click(".dg-notes-tagbar [data-tagtype=location]")
    w = wait_for_condition(lambda: next((x for x in firestore_writes(page, "cells/cell_1/notes/h1") if "dg-tag" in (x["data"].get("text") or "")), None), timeout_ms=20000)
    record("notes-tags", "a heading tagged by highlighting is saved with its tag",
           bool(w) and {"type": "location", "label": "Meadowbrook", "inline": True} in json.loads((w or {}).get("data", {}).get("tags") or "[]"), json.dumps(w)[:300] if w else "no write")
    wait_for_condition(lambda: "Meadowbrook" in tags() or None, timeout_ms=6000)
    record("notes-tags", "...and shows in the Tags list under Location", "Meadowbrook 1" in tags(), tags())
    # A Quick note from the notebook arrives while the page is open (new format: the words are the tag).
    own2 = own + [{"id": "q2", "agent_code": "OWEN-CS12", "block_type": "paragraph",
                   "text": json.dumps({"text": '<span class="dg-tag dg-tag-npc" data-tag="npc">The coroner</span>'}), "shared": False, "sort_order": 4000, "created_at": 9, "updated_at": 9,
                   "tags": json.dumps([{"type": "npc", "label": "The coroner", "inline": True}]), "quick": True}]
    push_firestore_snapshot(page, "cells/cell_1/notes", [["agent_code", "==", "OWEN-CS12"]], own2)
    wait_for_condition(lambda: "The coroner" in (page.text_content("#dg-notes-quick-mount") or "") or None, timeout_ms=6000)
    record("notes-tags", "a Quick note written while the page is open shows under Quick notes (not on the page)",
           "The coroner" in (page.text_content("#dg-notes-quick-mount") or "") and "The coroner" not in (page.text_content("#dg-notes-editor-mount") or ""),
           page.text_content("#dg-notes-quick-mount") or "")
    record("notes-tags", "...and its tag counts in the Tags list like a tag on the page", "The coroner 1" in tags(), tags())
    record("notes-tags", "the heading's tag survives the new note arriving", "Meadowbrook 1" in tags(), tags())
    record("notes-tags", "no JS exceptions (headings, quick notes)", not errs, str(errs[:3]))
    page.close()

def test_agent_file_parts_and_looks(p):
    """The Agent File in numbered parts (Statistics, Skills, Psyche, Combat
    & gear, Cell, Record) with a jump index; Find a skill (kept across a
    redraw); the physical description with Appearance -- in Agent Hub's
    drop-down under the photo, a fold under the photo in the notebook, and
    Edit's Personal data & appearance part; the parts' look picked per
    device in the notebook's Settings (Typed form by default, Folder tabs,
    Rubber stamps)."""
    stats = {"STR": 10, "CON": 12, "DEX": 11, "INT": 14, "POW": 11, "CHA": 13}
    state = {"v": 1, "stats": stats, "csStats": dict(stats), "derived": {"hp": 9, "wp": 8, "san": 52, "bp": 44},
             "bio": {"name": "Mara Voss", "player_name": "fn tester", "profession": "federal_agent",
                     "physicalDesc": "Lean, ash-brown hair tied back; watchful grey eyes."},
             "skills": {"alertness": 60, "firearms": 50, "accounting": 10},
             "bonds": [{"id": "b1", "name": "Lena Voss", "relationship": "Sister", "score": 11}]}
    docs = _field_notes_docs()
    docs[f"characters/{FN_CODE}"] = character_doc(FN_CODE, state, "fn tester")
    extra = "localStorage.setItem('dg_fn_orders_ack', JSON.stringify({'%s': 1790000000000}));" % FN_CODE
    page, errs = _field_notes_page(p, docs=docs, extra_init=extra)
    page.on("dialog", lambda d: d.accept())
    page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
    root = f"#ah-sheet-{FN_CODE}"
    page.wait_for_selector(root + " .ap-part", timeout=15000)
    parts = page.eval_on_selector_all(root + " .ap-part", "els => els.map(e => e.getAttribute('data-part'))")
    record("agent-file-parts", "the file is in five numbered parts (the Cell is a drop-down now)",
           parts == ["stats", "skills", "psyche", "kit", "record"], str(parts))
    record("agent-file-parts", "Typed form is the default look",
           page.evaluate(f"() => document.querySelector('{root} .as-paper.ap').classList.contains('ap-look-form')"), "")
    page.click(root + " [data-a=jump][data-part=psyche]")
    ok = wait_for_condition(lambda: page.evaluate(f"""() => {{ const r = document.querySelector('{root} .ap-part[data-part=psyche]').getBoundingClientRect();
        return r.top >= -2 && r.top < 160; }}"""), timeout_ms=4000)
    record("agent-file-parts", "the index's Psyche button scrolls to Psyche", bool(ok), "")
    # Era photos and Cell drop down from beside Appearance: on a desktop
    # the three buttons sit in a row to the right of the name.
    geo = page.evaluate(f"""() => {{ const t = document.getElementById('ah-title-{FN_CODE}') || document.querySelector('#panel-{FN_CODE} .paper-title');
        const b = document.querySelector('[data-ah-appear="{FN_CODE}"]'), c = document.querySelector('[data-ah-cell="{FN_CODE}"]');
        const tr = t.getBoundingClientRect(), br = b.getBoundingClientRect(), cr = c.getBoundingClientRect();
        return [br.left >= tr.right - 1, cr.left > br.right, Math.abs(cr.top - br.top) < 2]; }}""")
    record("agent-file-parts", "desktop: Appearance / Era photos / Cell in a row beside the name", all(geo), str(geo))
    record("agent-file-parts", "Agent Hub: Era photos and Cell start folded", page.is_hidden(f"#ah-era-{FN_CODE}") and page.locator(root + " .ap-celldrop").count() == 0, "")
    page.click(f"[data-ah-cell={FN_CODE}]")
    page.wait_for_selector(root + " .ap-celldrop .ap-init li", timeout=5000)
    page.click(f"[data-ah-era={FN_CODE}]")
    record("agent-file-parts", "Cell ▾ drops down the initiative list, Era photos ▾ the era photos",
           page.locator(root + " .ap-celldrop .ap-init li").count() >= 1 and page.is_visible(f"#ah-era-{FN_CODE} #af-photos"), "")
    page.click(root + " [data-a='wp-']")
    page.wait_for_timeout(300)
    record("agent-file-parts", "the Cell stays open when the sheet redraws", page.locator(root + " .ap-celldrop").count() == 1, "")
    page.click(f"[data-ah-cell={FN_CODE}]")
    page.click(f"[data-ah-era={FN_CODE}]")
    record("agent-file-parts", "both fold again", page.is_hidden(f"#ah-era-{FN_CODE}") and page.locator(root + " .ap-celldrop").count() == 0, "")
    page.fill(root + " [data-u=skill-find]", "fir")
    vis = lambda: page.eval_on_selector_all(root + " .ap-part[data-part=skills] .as-skills > *", "els => els.filter(e => !e.hidden).map(e => e.querySelector('.as-sn').textContent)")
    v1 = vis()
    record("agent-file-parts", "Find a skill leaves only the matching skills", "Firearms" in v1 and "First Aid" in v1 and "Accounting" not in v1, str(v1))
    page.click(root + " [data-a='hp-']")
    page.wait_for_timeout(300)
    v2 = vis()
    record("agent-file-parts", "the search survives a redraw (after HP −)", v2 == v1 and page.input_value(root + " [data-u=skill-find]") == "fir", str(v2))
    body_txt = page.inner_text(root + " .as-paper.ap")
    record("agent-file-parts", "the physical description is not in the sheet's body on Agent Hub", "watchful grey eyes" not in body_txt, "")
    page.click(f"[data-ah-appear={FN_CODE}]")
    desc = page.inner_text(f"#ah-desc-{FN_CODE}")
    record("agent-file-parts", "it opens with Appearance, under the photo", "watchful grey eyes" in desc and page.is_visible(f"#ah-desc-{FN_CODE}"), desc[:80])
    page.click(f"[data-ah-appear={FN_CODE}]")
    page.click(root + " [data-a=edit]")
    page.wait_for_selector(root + " .ap-part[data-part=personal]")
    eparts = page.eval_on_selector_all(root + " .ap-part", "els => els.map(e => e.getAttribute('data-part'))")
    record("agent-file-parts", "Edit opens with Personal data & appearance (the description there) and has no Record",
           eparts[0] == "personal" and "record" not in eparts and "watchful" in page.input_value(root + " .ap-part[data-part=personal] [data-e='bio.physicalDesc']"), str(eparts))
    page.click(root + " [data-a=cancel]")
    # The notebook: the Appearance fold under the photo, and the look in Settings.
    page.evaluate("() => window.dgFieldNotes.open('agentfile')")
    V = page.locator("#fn-veil .as-paper.ap").filter(visible=True).first
    V.wait_for(timeout=10000)
    V.locator("[data-a=appear]").click()
    record("agent-file-parts", "the notebook's Appearance fold under the photo shows the description",
           "watchful grey eyes" in V.locator(".ap-appear").first.inner_text(), "")
    V.locator("[data-a=cell]").click()
    record("agent-file-parts", "the notebook's Cell fold sits beside it", V.locator(".ap-celldrop .ap-init li").count() >= 1, "")
    V.locator("[data-a=era]").click()
    record("agent-file-parts", "…and Era photos, with the way to make them on Agent Hub",
           V.locator(".ap-eradrop").count() == 1 and V.locator(".ap-eradrop [data-go=photo]").count() == 1, "")
    page.evaluate("() => window.dgFieldNotes.open('settings')")
    page.wait_for_selector("[data-s=paper-look]")
    opts = page.eval_on_selector_all("[data-s=paper-look] option", "els => els.map(e => e.value)")
    page.select_option("[data-s=paper-look]", "folder")
    page.wait_for_timeout(200)
    on_hub = page.evaluate(f"() => document.querySelector('{root} .as-paper.ap').classList.contains('ap-look-folder')")
    record("agent-file-parts", "Settings offers the three looks; Folder tabs applies at once and is kept on this device",
           opts == ["form", "folder", "stamp"] and on_hub and page.evaluate("() => localStorage.getItem('dg_paper_look')") == "folder", str(opts))
    page.select_option("[data-s=paper-look]", "stamp")
    page.evaluate("() => window.dgFieldNotes.open('agentfile')")
    V = page.locator("#fn-veil .as-paper.ap").filter(visible=True).first
    V.wait_for(timeout=10000)
    record("agent-file-parts", "a paper drawn later (the notebook's) takes the chosen look", "ap-look-stamp" in (V.get_attribute("class") or ""), V.get_attribute("class") or "")
    record("agent-file-parts", "no JS exceptions", not errs, str(errs[:3]))
    page.close()
    # On a phone the buttons stack under the photo instead.
    page, errs = _field_notes_page(p, width=390, height=844, docs=docs, extra_init=extra)
    page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_selector(f"#ah-sheet-{FN_CODE} .ap-vitals", timeout=15000)
    geo = page.evaluate(f"""() => {{ const ph = document.getElementById('ah-photo-{FN_CODE}').getBoundingClientRect();
        const b = document.querySelector('[data-ah-appear="{FN_CODE}"]').getBoundingClientRect();
        return [b.top >= ph.bottom - 1, b.left < ph.right]; }}""")
    record("agent-file-parts", "phone: the buttons stack under the photo", all(geo), str(geo))
    page.close()


def test_agent_rules_unit(p):
    """assets/agent-rules.js on its own: derived maximums, − / + limits,
    BP stepped by POW and reset to SAN − POW, SAN loss events (a disorder
    that triggers on 2+ only for a loss of 2+, insanity at 5+ clearing that
    kind's marks, the Breaking Point only when crossed, SAN 0), Unnatural
    never marked by a failed roll, adaptation costs, and an old sheet's
    disorders split out of its Motivations."""
    page = p.new_page()
    errs = collect_errors(page)
    _block_fonts(page)
    install_firestore_backend(page, {})
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function("() => window.dgRules && window.dgDisorders", timeout=10000)
    r = page.evaluate("""async () => {
      const R = window.dgRules, out = {};
      const base = () => ({ v: 1, csStats: { STR: 10, CON: 13, DEX: 10, INT: 10, POW: 12, CHA: 11 }, derived: { hp: 12, wp: 12, san: 50, bp: 45 },
        skills: { unnatural: 5, alertness: 40 }, bio: { disorders: ['Depression', 'Paranoia'] }, bonds: [{ name: 'A', score: 11 }] });
      let s = base();
      out.max = R.maxes(s);
      R.adjust(s, 'hp', +5); out.hpCap = s.derived.hp;
      R.adjust(s, 'wp', -20); out.wpFloor = s.derived.wp;
      R.stepBp(s, 1); out.bpUp = s.derived.bp; R.resetBp(s); out.bpReset = s.derived.bp;
      s = base(); out.loss1 = R.sanLoss(s, 1, 'violence').events.map(e => e.type);
      s = base(); out.loss2 = R.sanLoss(s, 2, 'violence').events;
      s = base(); s.sanity = { violence: [true, true, false], helplessness: [false, false, false] };
      out.loss5 = R.sanLoss(s, 5, 'violence').events.map(e => e.type); out.marks5 = s.sanity.violence;
      s = base(); out.bp1 = R.sanLoss(s, 6, 'unnatural').events.map(e => e.type);
      s = base(); s.derived.san = 40; out.bpAgain = R.sanLoss(s, 2, 'unnatural').events.map(e => e.type);
      s = base(); s.derived.san = 3; out.zero = R.sanLoss(s, 9, 'unnatural').events.map(e => e.type); out.zeroSan = s.derived.san;
      s = base(); out.unnat = R.markFailed(s, 'key:unnatural'); out.alert = R.markFailed(s, 'key:alertness');
      s = base(); const fixed = () => Promise.resolve(3);
      await R.adapt(s, 'violence', fixed); out.vio = [s.csStats.CHA, s.bonds[0].score, s.adapted.violence];
      s = base(); await R.adapt(s, 'helplessness', fixed); out.help = [s.csStats.POW, s.csStats.CHA];
      const old = { bio: { motivations: 'Keep the family safe\\nDisorder: PTSD' } };
      R.normalizeBio(old); out.split = [old.bio.motivations, old.bio.disorders];
      // The old sheet's mis-seeded features (the lowest band for every stat).
      out.feat = R.features({ csStats: { STR: 11, CON: 11, DEX: 15, INT: 14, POW: 12, CHA: 9 },
        lpFeat: { STR: 'Feeble', CON: 'Bedridden', DEX: 'Barely Mobile', INT: 'Hates mornings', POW: 'Strong willed', CHA: 'Unbearable' } });
      out.featLow = R.features({ csStats: { STR: 4 }, lpFeat: { STR: 'Feeble' } }).STR;
      return out;
    }""")
    record("rules", "maximums: HP ⌈(STR+CON)/2⌉, WP POW, SAN POW×5, SAN cap 99 − Unnatural",
           r["max"] == {"hp": 12, "wp": 12, "san": 60, "sanCap": 94}, str(r["max"]))
    record("rules", "− / + never go past the maximum or below 0", r["hpCap"] == 12 and r["wpFloor"] == 0, f"{r['hpCap']} {r['wpFloor']}")
    record("rules", "BP steps by POW and resets to SAN − POW", r["bpUp"] == 57 and r["bpReset"] == 38, f"{r['bpUp']} {r['bpReset']}")
    record("rules", "a loss of 1 sets off no disorder; a loss of 2 sets off only the disorder that triggers on losing 2+ SAN",
           r["loss1"] == ["incident"] and r["loss2"][0]["type"] == "disorder" and r["loss2"][0]["names"] == ["Paranoia"], str(r["loss1"]) + str(r["loss2"]))
    record("rules", "a loss of 5 is temporary insanity, clears that kind's incident marks, ticks none",
           "insanity" in r["loss5"] and "incident" not in r["loss5"] and r["marks5"] == [False, False, False], str(r["loss5"]) + str(r["marks5"]))
    record("rules", "the Breaking Point fires when SAN crosses it, not again once below",
           "breaking" in r["bp1"] and "breaking" not in r["bpAgain"], str(r["bp1"]) + str(r["bpAgain"]))
    record("rules", "SAN 0 is its own event, and SAN never goes below 0", "zero" in r["zero"] and r["zeroSan"] == 0, str(r["zero"]))
    record("rules", "a failed roll marks a skill, never Unnatural", r["unnat"] is False and r["alert"] is True, str([r["unnat"], r["alert"]]))
    record("rules", "adapting to Violence: −1D6 CHA and each Bond; to Helplessness: −1D6 POW",
           r["vio"] == [8, 8, True] and r["help"] == [9, 11], str(r["vio"]) + str(r["help"]))
    record("rules", "an old sheet's disorders come out of its Motivations text", r["split"] == ["Keep the family safe", ["PTSD"]], str(r["split"]))
    record("rules", "an old sheet's descriptor that doesn't fit the score shows the one that does (Bedridden for CON 11 is Average, Barely Mobile for DEX 15 Nimble); written features stay",
           r["feat"] == {"STR": "Average", "CON": "Average", "DEX": "Nimble", "INT": "Hates mornings", "POW": "Average", "CHA": "Average"} and r["featLow"] == "Feeble", str(r["feat"]) + " " + str(r["featLow"]))
    page.close()
    return errs

def test_evidence_attachments_open_and_zoom(p):
    """Evidence attachments for players (reported from Safari: couldn't
    open one, couldn't zoom to read it). In the Field Notes notebook a
    photo was a fixed-size <img> with nothing to tap and a PDF showed as a
    broken image. Now a photo opens full-screen in assets/evidence-viewer.js
    (its own pinch / double-tap / +/- zoom, since pinching the notebook
    zoomed the whole page instead) and a PDF is a link Safari's PDF viewer
    opens. Agent Hub's Evidence gets the same."""
    errs_all = []
    svg = ("data:image/svg+xml;charset=utf-8," + "%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='600'%3E"
           "%3Crect width='800' height='600' fill='%23c9b98a'/%3E%3C/svg%3E")
    pdf_url = "https://firebasestorage.googleapis.com/v0/b/x/o/evidence%2Fev_fn_pdf.pdf?alt=media&token=t"
    pdf_data = "data:application/pdf;base64,JVBERi0xLjQKJSVFT0YK"
    docs = _field_notes_docs()
    docs["evidence/ev_fn_1"]["photo"] = svg
    docs["evidence/ev_fn_pdf"] = {"title": "Autopsy Report", "body": "PDF.", "cell_id": FN_CELL, "operation_id": "op_fn_a",
                                  "visible_to": [FN_CODE], "released": True, "created_at": 1400, "photo": pdf_url}
    docs["evidence/ev_fn_pdf2"] = {"title": "Old Scan", "body": "Legacy.", "cell_id": FN_CELL, "operation_id": "op_fn_a",
                                   "visible_to": [FN_CODE], "released": True, "created_at": 1300, "photo": pdf_data}
    extra = "localStorage.setItem('dg_fn_orders_ack', JSON.stringify({'%s': 1790000000000}));" % FN_CODE
    for width, height, where in ((1300, 860, "desktop"), (390, 844, "phone")):
        page, errs = _field_notes_page(p, width=width, height=height, docs=docs, extra_init=extra)
        page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
        page.wait_for_function("() => window.dgFieldNotes && window.dgFieldNotes.isHost", timeout=10000)
        page.evaluate("() => window.dgFieldNotes.open('evidence')")
        photo = page.locator("#fn-veil .fn-ev-zoom").filter(visible=True).first
        photo.wait_for(timeout=10000)
        links = page.eval_on_selector_all("#fn-veil a.fn-ev-pdf", "els => els.map(a => [a.getAttribute('href'), a.target])")
        record("evidence", where + ": a filed PDF is an Open PDF link (not a broken image) that opens in a new tab",
               [pdf_url, "_blank"] in links and any(h.startswith("blob:") for h, _ in links)
               and page.locator("#fn-veil img.fn-ev-photo[src^='data:application/pdf'], #fn-veil img[src*='.pdf']").count() == 0, str(links))
        photo.click()
        viewer = page.locator(".dg-ev-viewer")
        viewer.wait_for(timeout=5000)
        page.wait_for_function("() => document.querySelector('.dg-ev-viewer').getAttribute('data-zoom') === '1.00'", timeout=5000)
        record("evidence", where + ": tapping a filed photo opens it full-screen, titled",
               "Coroner's Preliminary" in page.inner_text(".dg-ev-title")
               and page.evaluate("() => { const r = document.querySelector('.dg-ev-stage').getBoundingClientRect(); return r.width >= innerWidth - 1; }"), "")
        zoom = lambda: float(page.get_attribute(".dg-ev-viewer", "data-zoom"))
        page.locator(".dg-ev-stage").dblclick()
        z_dbl = zoom()
        page.click(".dg-ev-viewer [data-ev-z=fit]")
        z_fit = zoom()
        # A two-finger pinch, as Safari reports it: pointer events.
        page.evaluate("""() => {
          const st = document.querySelector('.dg-ev-stage'), r = st.getBoundingClientRect();
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          const ev = (t, id, x) => st.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: 'touch', clientX: x, clientY: cy, bubbles: true, cancelable: true }));
          ev('pointerdown', 1, cx - 20); ev('pointerdown', 2, cx + 20);
          for (let i = 1; i <= 10; i++) { ev('pointermove', 1, cx - 20 - i * 8); ev('pointermove', 2, cx + 20 + i * 8); }
          ev('pointerup', 1, cx - 100); ev('pointerup', 2, cx + 100);
        }""")
        z_pinch = zoom()
        page.click(".dg-ev-viewer [data-ev-z=in]")
        z_in = zoom()
        record("evidence", where + ": the photo zooms in the viewer (double-tap, pinch, +) and Fit resets it",
               z_dbl > 2 and z_fit == 1 and z_pinch > 2 and z_in > z_pinch, str([z_dbl, z_fit, z_pinch, z_in]))
        page.click(".dg-ev-viewer [data-ev-close]")
        record("evidence", where + ": Close shuts the viewer", page.locator(".dg-ev-viewer").count() == 0, "")
        errs_all.extend(errs)
        page.close()

    # Agent Hub's Evidence: a PDF is a link too; a photo opens the same viewer.
    page, errs = _field_notes_page(p, docs=docs, extra_init=extra)
    page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
    # The Hub's Evidence is a live query listener: the stub delivers what's pushed.
    wait_for_condition(lambda: notes_firestore_listener_count(page) >= 1, timeout_ms=8000)
    page.wait_for_timeout(600)
    ev = [dict(docs[k], id=k.split("/")[1]) for k in docs if k.startswith("evidence/")]
    push_firestore_snapshot(page, "evidence", [["visible_to", "array-contains-any", [FN_CODE, "ALL"]]], ev)
    page.locator(f"#ah-handouts-{FN_CODE} .ah-handout-photo").wait_for(timeout=10000)
    hrefs = page.eval_on_selector_all(f"#ah-handouts-{FN_CODE} a.ah-handout-pdf", "els => els.map(a => a.getAttribute('href'))")
    record("evidence", "Agent Hub: a filed PDF is an Open PDF link, not a broken image",
           pdf_url in hrefs and any(h.startswith("blob:") for h in hrefs), str(hrefs))
    page.click(f"#ah-handouts-{FN_CODE} .ah-handout-photo")
    record("evidence", "Agent Hub: a filed photo opens in the zoomable viewer",
           page.locator(".dg-ev-viewer").is_visible(), "")
    errs_all.extend(errs)
    page.close()
    return errs_all

def test_motivations_and_disorders_split(p):
    """Motivations and Mental Disorders used to share one free-text box.
    Now Mental Disorders are their own list (bio.disorders), each picked
    from the Rules reference's disorders (or "Other…"), with its trigger
    and effect shown. An older sheet's combined text is read apart; the
    PDF export, whose printed form has one box for both, gets both back
    ("Disorder: …" lines, which a re-import splits again); A-Cell shows
    them apart."""
    errs_all = []
    code = "DISO-0001"
    old_state = {"v": 1, "bio": {"name": "Ada Kerr", "player_name": "dis tester",
                                 "motivations": "Protect my sister\nDisorder: PTSD\nParanoia (since the Vegas op)\nFind the truth"}}
    # The Agent File: an older sheet's combined box is read apart, each
    # disorder with its trigger and effect from the rules.
    docs = _field_notes_docs()
    st0 = json.loads(docs[f"characters/{FN_CODE}"]["character_json"])
    st0["bio"]["motivations"] = old_state["bio"]["motivations"]
    st0["bio"].pop("disorders", None)
    docs[f"characters/{FN_CODE}"] = character_doc(FN_CODE, st0, "fn tester")
    page, errs = _field_notes_page(p, docs=docs, extra_init="localStorage.setItem('dg_fn_orders_ack', JSON.stringify({'%s': 1790000000000}));" % FN_CODE)
    page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_selector(f"#ah-sheet-{FN_CODE} .as-paper.ap .ap-vitals", timeout=15000)
    split = page.evaluate("(st) => { const b = window.dgRules.normalizeBio(JSON.parse(JSON.stringify(st))).bio; return { m: b.motivations, d: b.disorders }; }", st0)
    record("disorders", "an older sheet's combined box is read apart: disorders out of Motivations, into their own list",
           split["m"] == "Protect my sister\nFind the truth" and split["d"] == ["PTSD", "Paranoia (since the Vegas op)"], json.dumps(split))
    paper = page.inner_text(f"#ah-sheet-{FN_CODE} .as-sheet")
    record("disorders", "the Agent File lists them apart, a known disorder with its trigger and effect from the rules",
           "Paranoia (since the Vegas op)" in paper and "Reminders of past traumas" in paper and "Disorder: PTSD" not in paper, paper[:300])
    # Exports: one box for both on the printed form; a re-import splits them.
    combined = page.evaluate("() => window.dgDisorders.combine('Protect my sister\\nFind the truth', ['Fear of mirrors', 'Ligyrophobia', 'Depression'])")
    back = page.evaluate("(t) => window.dgDisorders.splitText(t)", combined)
    record("disorders", "the printed form's single box gets both, and splits back the same on import",
           combined.endswith("Disorder: Fear of mirrors\nDisorder: Ligyrophobia\nDisorder: Depression")
           and back == {"motivations": "Protect my sister\nFind the truth", "disorders": ["Fear of mirrors", "Ligyrophobia", "Depression"]}, combined)
    errs_all.extend(errs)
    page.close()

    # A-Cell's dossier: Motivations and Mental Disorders apart, with the rules' summary.
    page = p.new_page(viewport={"width": 1300, "height": 900})
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)
    page.add_init_script("try { sessionStorage.setItem('dg_acell_pw', 'testpw'); } catch (e) {}")
    install_notes_firestore_stub(page)
    st = {"bio": {"name": "Ada Kerr", "motivations": "Protect my sister", "disorders": ["PTSD", "Fear of mirrors"]}, "csStats": {"STR": 10}, "derived": {"hp": 10}}
    install_firestore_backend(page, {f"characters/{code}": dict(character_doc(code, st))})
    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    wait_for_condition(lambda: any(l["path"] == "characters" for l in page.evaluate("() => window.__dgFirestoreListeners || []")), timeout_ms=8000)
    push_firestore_snapshot(page, "characters", [], [{"id": code, "character_json": json.dumps(st), "updated_at": "", "player_name": ""}])
    push_firestore_snapshot(page, "briefs", [], [{"id": code, "agent_code": code, "char_name": "Ada Kerr"}])
    push_firestore_snapshot(page, "cells", [], [])
    wait_for_condition(lambda: "Ada Kerr" in page.inner_text("#play-agent-list") or None, timeout_ms=8000)
    page.click("#acell-tab-strip .tw[data-tab=play]")  # v3.12.0: A-Cell opens on Session prep
    page.click("#play-agent-list .play-agent-btn:first-child")
    page.wait_for_selector("#play-view .pv-disorders", timeout=8000)
    txt = page.inner_text("#play-view .pv-disorders")
    record("disorders", "A-Cell's dossier lists Mental Disorders apart from Motivations, with each one's trigger",
           "PTSD" in txt and "Reminders of past traumas" in txt and "Fear of mirrors" in txt
           and "PTSD" not in page.inner_text("#play-view .pv-motivations"), txt)
    errs_all.extend(errs)
    page.close()
    return errs_all

def test_dice_roller_firestore_native_cell(p):
    """GitHub issue live report: "Roll not saved: permission-denied" for
    an Agent actually in a real, current Cell. Root cause:
    resolveRollContext() (assets/dice-roller.js) used to resolve "which
    Cell is this Agent in" via the legacy list_cells JSONP action, which
    only ever reads the Sheet -- but Cells now create/delete straight in
    Firestore (a-cell.html's createCellFirestore_(), Phase 2 Sheets-
    removal), so any Cell made since that migration has no Sheet row at
    all and was invisible to that lookup, silently misfiling every roll
    under a 'solo:<agentCode>' pseudo-cell instead of the Agent's real
    one (or, for a stale Sheet-only cell_id with no matching Firestore
    doc, throwing inside firestore.rules' isCellMember() and denying the
    write outright). Fixed by reading the `cells` collection straight
    from Firestore (already public-read) instead of the Sheet. This
    covers the "real Cell, no Sheet row" case; solo-fallback behavior
    itself is exercised implicitly by every other Dice Roller-touching
    test that never seeds a `cells` doc at all."""
    page = p.new_page()
    errs = collect_errors(page)
    install_notes_firestore_stub(page)
    page.add_init_script("try { localStorage.setItem('dg_stats_cloud_code', 'OWEN-CS12'); } catch (e) {}")
    # Runs after install_notes_firestore_stub()'s own init script, so
    # window.__dgFirestoreDocs already exists -- seeds a Cell with no
    # Sheet counterpart at all, present before dgInitDiceRoller() ever
    # calls resolveRollContext() on load.
    page.add_init_script("""
        window.__dgFirestoreDocs = window.__dgFirestoreDocs || {};
        window.__dgFirestoreDocs['cells/cell_firestore_native_1'] = { member_codes: ['OWEN-CS12'], name: 'Cell Alpha' };
    """)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_boot_splash(page)
    page.goto(f"{BASE}/rules-reference.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function("() => window.dgDice && window.dgDice.roll", timeout=10000)
    page.wait_for_timeout(500)

    page.evaluate("() => window.dgDice.roll(50, 'Accounting')")
    wait_for_condition(lambda: len(page.evaluate("() => window.__dgFirestoreWrites || []")) > 0, timeout_ms=6000)
    writes = page.evaluate("() => (window.__dgFirestoreWrites || []).map(w => w.path)")
    record("dice-roller", "a roll from an Agent in a Firestore-native Cell (no Sheet row) saves under that Cell's real id",
           any(w.startswith("dice_rolls/cell_firestore_native_1/rolls/") for w in writes), str(writes))
    record("dice-roller", "the roll is NOT misfiled under the solo: pseudo-cell fallback",
           not any("solo:" in w for w in writes), str(writes))
    record("dice-roller", "no JS exceptions", len(errs) == 0, "; ".join(errs))
    page.close()
    return errs


# ── New-player journey regressions (found by walking the whole player
# journey against the real Code.gs + Firebase emulators, in Chromium and
# WebKit, phone and desktop -- see BUGFIXES.md) ─────────────────────────

def _pump_until(page, fn, timeout_ms=6000):
    """Like wait_for_condition, but waits with page.wait_for_timeout so
    Playwright keeps servicing routed requests while it waits (time.sleep
    doesn't -- a route-backed condition could never become true)."""
    waited = 0
    while waited < timeout_ms:
        try:
            if fn():
                return True
        except Exception:
            pass
        page.wait_for_timeout(150)
        waited += 150
    return bool(fn())

def _route_backend(page, respond, posts=None):
    """A test's backend, answered by respond(method, params, body), which
    returns the reply the old Apps Script used to give (None -> OK).
    The Sheet is retired -- the pages talk to Firestore -- so this
    installs the Firestore stub and connects respond() to it:
      reading characters/{code}  -> respond('GET', {action: load_character, code})
      reading briefs/{code}      -> respond('GET', {code})
      writing characters/{code}  -> a save_character payload
      writing briefs/{code}      -> a brief submission (has submitted_at),
                                    update_medical / update_aar, or one
                                    update_field per field
      generatePrompt / generatePlateImage -> generate_prompt /
                                    generate_plate_image, answered by respond()
    Every translated payload is appended to posts, as before."""
    install_notes_firestore_stub(page)
    def _post(body):
        if posts is not None:
            posts.append(body)
        return respond("POST", {}, body) or {"status": "OK"}
    def hook(kind, arg):
        if kind == "get":
            coll, _, code = arg.partition("/")
            if coll == "characters" and "/" not in code:
                res = respond("GET", {"action": "load_character", "code": code}, None) or {}
                if res.get("status") == "OK" and res.get("character_json"):
                    return {"agent_code": code, "character_json": res["character_json"], "updated_at": res.get("updated_at", "")}
                return None
            if coll == "briefs" and "/" not in code:
                res = respond("GET", {"code": code}, None) or {}
                return res.get("data") if res.get("status") == "OK" and res.get("data") else None
            return "__local__"
        if kind == "write":
            coll, _, code = arg["path"].partition("/")
            data = arg.get("data") or {}
            if arg.get("op") == "delete" or "/" in code:
                return None
            if coll == "characters":
                _post({"action": "save_character", "agent_code": code, "character_json": data.get("character_json", ""),
                       "player_name": data.get("player_name", "")})
            elif coll == "briefs":
                fields = {k: v for k, v in data.items() if k != "player_name_lc"}
                if "submitted_at" in fields:
                    _post(dict(fields, agent_code=code))
                elif set(fields) == {"medical_log"}:
                    _post({"action": "update_medical", "agent_code": code, "medical_log": fields["medical_log"]})
                elif set(fields) == {"aar_log"}:
                    _post({"action": "update_aar", "agent_code": code, "aar_log": fields["aar_log"]})
                else:
                    for k, v in fields.items():
                        _post({"action": "update_field", "agent_code": code, "field": k, "value": v})
            return None
        if kind == "call":
            action = "generate_prompt" if arg["name"] == "generatePrompt" else "generate_plate_image"
            return _post(dict(arg.get("payload") or {}, action=action))
        return None
    page.expose_function("__dgPyBackend", hook)
    page.add_init_script("window.__dgBackendHook = function (kind, arg) { return window.__dgPyBackend(kind, arg); };")

class _FakeRoute:
    """Stands in for a Playwright route so an old Apps Script fake can
    be asked a question directly (see jsonp_backend)."""
    def __init__(self, method, url, body):
        self.request = SimpleNamespace(method=method, url=url, post_data=body)
        self.result = None
    def fulfill(self, status=200, content_type=None, body="", **kw):
        self.result = body
    def abort(self, *a, **kw):
        self.result = None
    def continue_(self, *a, **kw):
        self.result = None
    fallback = continue_

def _af_state(page, timeout_ms=12000):
    """The Agent File in Agent Hub's open tab (assets/agent-file.js), once
    it has loaded its Agent: which Agent, the Appearance state line, whether
    Appearance is unfolded, and whether the era photos are still locked."""
    try:
        page.wait_for_function("""() => { const s = document.getElementById('af-appear-state');
            return !!(s && s.textContent && s.textContent !== 'Loading…'); }""", timeout=timeout_ms)
    except Exception:
        pass
    return page.evaluate("""() => { const s = document.getElementById('af-appear-state'); if (!s) return {};
        return { code: window.dgAgentFile && window.dgAgentFile.code(), state: s.textContent,
                 open: document.getElementById('af-appear').classList.contains('af-open'),
                 photosLocked: !document.getElementById('af-photos-locked').hidden,
                 inTab: !!document.querySelector('.tab-panel.active #af-root') }; }""")

def jsonp_backend(page, handler, posts=None):
    """A test's old Apps Script fake (a page.route handler answering JSONP
    GETs / POSTs) now answers the Firestore reads and writes that replaced
    those calls, via _route_backend. It also still serves the one request
    left on Apps Script, the Drive image proxy (action=imgdata)."""
    page.route("**/script.google.com/**", handler)
    def respond(method, q, body):
        if method == "GET":
            qs = "&".join("%s=%s" % (k, v) for k, v in q.items()) + "&callback=cbTest"
            r = _FakeRoute("GET", "https://script.google.com/macros/s/TEST/exec?" + qs, None)
        else:
            r = _FakeRoute("POST", "https://script.google.com/macros/s/TEST/exec", json.dumps(body))
        handler(r)
        text = (r.result or "").strip()
        if not text:
            return None
        m = re.match(r"^[\w$.]+\((.*)\)\s*;?$", text, re.S)
        try:
            return json.loads(m.group(1) if m else text)
        except Exception:
            return None
    _route_backend(page, respond, posts)

def _block_fonts(page):
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())

def test_player_pages_use_in_page_dialogs(p):
    """alert()/confirm() show nothing in an iOS home-screen install (confirm()
    just returns false) -- validation notices vanished. Requisition and the
    Appearance brief explain an unfinished form in-page instead."""
    dialogs = []
    errs = []
    page = p.new_page(viewport={"width": 390, "height": 844})
    errs += collect_errors(page)
    page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
    install_notes_firestore_stub(page)
    _block_fonts(page)
    route_apps_script_ok(page)
    # The form as the Field Notes notebook embeds it (a direct visit
    # forwards into the notebook; see test_field_notes_shell).
    page.goto(f"{BASE}/requisition.html?embed=1", wait_until="load", timeout=15000)
    page.wait_for_timeout(500)
    page.click("#rollBtn"); page.wait_for_timeout(300)
    record("journey", "Requisition: submitting an unfinished form explains itself in-page",
           not dialogs and page.is_visible("#req-toast") and "not complete" in page.text_content("#req-toast"), str(dialogs))
    page.close()

    page = p.new_page(viewport={"width": 390, "height": 844})
    errs += collect_errors(page)
    page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
    install_firestore_backend(page, {"briefs/MARA-0001": {"char_name": "Robert Wright", "agent_code": "MARA-0001"}})
    _block_fonts(page)
    route_apps_script_ok(page)
    page.add_init_script("try { localStorage.setItem('dg_agent_roster', JSON.stringify({'MARA-0001': {code: 'MARA-0001', char_name: 'Robert Wright', saved_at: 1}})); } catch (e) {}")
    page.goto(f"{BASE}/agent-hub.html?code=MARA-0001", wait_until="load", timeout=15000)
    _af_state(page)
    page.evaluate("() => window.dgAgentFile.focus('appearance')"); page.wait_for_timeout(300)
    page.fill("#dg-form [name=face_shape]", "")
    page.click("#submit-btn"); page.wait_for_timeout(300)
    record("journey", "an incomplete Appearance brief points at the blank field in-page, no native dialog",
           not dialogs and page.eval_on_selector_all("#dg-form [required]:invalid", "els => els.length") > 0, str(dialogs))
    record("journey", "no JS exceptions (dialogs)", len(errs) == 0, "; ".join(errs))
    page.close()
    return errs

def test_dice_roller_phone_not_dragged_by_scroll(p):
    """Reported 2026-10-20 (iPhone, home-screen A-Cell): the Dice Roller
    bar stuck mid-screen. On a phone the bar is a full-width bottom sheet,
    and a finger scroll that started on it dragged it up (touchmove set an
    inline top) and left it there -- the earlier "iOS freeze" reflow fixes
    could never undo that. Docked on a phone it isn't dragged; elsewhere a
    touch has to move 10px first."""
    swipe = """([x0, y0, x1, y1]) => { const h = document.getElementById('dr-handle');
        const mk = (x, y) => new Touch({identifier: 1, target: h, clientX: x, clientY: y});
        h.dispatchEvent(new TouchEvent('touchstart', {touches: [mk(x0, y0)], bubbles: true}));
        h.dispatchEvent(new TouchEvent('touchmove', {touches: [mk(x1, y1)], bubbles: true}));
        h.dispatchEvent(new TouchEvent('touchend', {touches: [], bubbles: true}));
        const r = document.getElementById('dr-panel').getBoundingClientRect(); return [r.left, r.top, r.bottom, innerHeight]; }"""
    for vw, vh in ((390, 844), (1280, 900)):
        ctx = p.new_context(viewport={"width": vw, "height": vh}, has_touch=True, is_mobile=vw < 600)
        page = ctx.new_page()
        errs = collect_errors(page)
        install_notes_firestore_stub(page)
        _block_fonts(page)
        # v3.13.0: A-Cell's phone layout has Dice as a tab (no floating bar);
        # the bar's own behaviour is checked in the computer layout.
        page.add_init_script("try { localStorage.setItem('dg_acm_desktop', 'true'); } catch (e) {}")
        page.goto(f"{BASE}/a-cell.html", wait_until="load", timeout=20000)
        page.wait_for_selector("#dr-handle", state="attached", timeout=10000)
        before = page.evaluate("() => { const r = document.getElementById('dr-panel').getBoundingClientRect(); return [r.left, r.top]; }")
        if vw < 600:
            r = page.evaluate(swipe, [200, vh - 20, 200, vh - 400])
            record("dice-roller", "phone: a scroll that starts on the Dice Roller bar leaves it docked at the bottom",
                   abs(r[2] - r[3]) < 1 and page.evaluate("() => document.getElementById('dr-panel').style.top") == "", str(r))
            # Reported 2026-10-27: on a phone the bar couldn't be opened -- only
            # its tiny arrow did it, in the screen's bottom edge iOS keeps.
            col = lambda: page.evaluate("() => document.getElementById('dr-panel').classList.contains('dr-collapsed')")
            c0 = col(); page.tap("#dr-title"); c1 = col(); page.tap("#dr-title"); c2 = col()
            hh = page.evaluate("() => document.getElementById('dr-handle').getBoundingClientRect().height")
            record("dice-roller", "phone: tapping anywhere on the Dice Roller bar opens and closes it; the bar is a finger tall",
                   c1 != c0 and c2 == c0 and hh >= 46, f"{c0}->{c1}->{c2} h={hh}")
        else:
            r = page.evaluate(swipe, [before[0] + 40, before[1] + 10, before[0] + 44, before[1] + 13])
            record("dice-roller", "desktop: a small touch wobble doesn't move the panel", abs(r[1] - before[1]) < 1, f"{before} -> {r}")
            r = page.evaluate(swipe, [before[0] + 40, before[1] + 10, before[0] - 200, before[1] - 300])
            record("dice-roller", "desktop: a real touch drag still moves it", r[1] < before[1] - 100, f"{before} -> {r}")
        record("dice-roller", f"no JS exceptions (drag, {vw}px)", not errs, str(errs[:3]))
        ctx.close()

def test_hub_dice_roller_learns_agent_from_iframe(p):
    """In the Hub the Dice Roller lives on the OUTER page, but the Agent's
    code gets set by the sheet inside the iframe -- and PR #44's
    'dg-cloud-code-set' event only fires on the iframe's window. On a
    brand-new device the shell's roller stayed on "Load your Cover Identity
    on this device to save roll history" all visit and saved nothing (the
    earlier fix was only ever exercised on the standalone sheet). Also: the
    Cell was looked up once, so a player the Handler added to a Cell
    mid-session kept rolling into their solo feed."""
    ctx = p.new_context(viewport={"width": 390, "height": 844})
    page = ctx.new_page()
    errs = collect_errors(page)
    install_notes_firestore_stub(page)
    _block_fonts(page)
    _route_backend(page, lambda m, q, b: {"status": "OK", "agents": [], "cells": [], "operations": [], "notes": []})
    page.add_init_script("try { localStorage.setItem('dg_cover_identity', 'Mara Voss'); sessionStorage.setItem('dg_boot_seen', '1'); } catch (e) {}")
    page.goto(f"{BASE}/hub.html", wait_until="load", timeout=20000)
    page.wait_for_timeout(1500)
    hist = lambda: page.evaluate("() => (document.getElementById('dr-panel') || {}).textContent || ''")
    record("dice-roller", "Hub on a fresh device: roller starts with no Agent", "Load your Cover Identity" in hist(), hist()[-120:])
    inner = next(f for f in page.frames if f != page.main_frame)
    inner.evaluate("() => localStorage.setItem('dg_stats_cloud_code', 'ROBE-KKUL')")
    listens = lambda: page.evaluate("() => (window.__dgFirestoreListeners || []).map(l => l.path)")
    _pump_until(page, lambda: "dice_rolls/solo:ROBE-KKUL/rolls" in listens(), 6000)
    record("dice-roller", "the shell's roller picks up the Agent the embedded sheet just loaded",
           "dice_rolls/solo:ROBE-KKUL/rolls" in listens(), str(listens()))
    push_firestore_snapshot(page, "cells", [], [{"id": "cell_night", "member_codes": ["ALIS-EGSE", "ROBE-KKUL"], "name": "Night Shift"}])
    _pump_until(page, lambda: "dice_rolls/cell_night/rolls" in listens(), 4000)
    record("dice-roller", "added to a Cell mid-session: history follows the Cell without a reload",
           "dice_rolls/cell_night/rolls" in listens() and "dice_rolls/solo:ROBE-KKUL/rolls" not in listens(), str(listens()))
    page.evaluate("() => window.dgDice.recordRoll({roll_type: 'percent', label: 'DEX x5', value: 12, target: 60, tier: 'success'})")
    _pump_until(page, lambda: any(w["path"].startswith("dice_rolls/") for w in firestore_writes(page)), 4000)
    writes = [w["path"] for w in firestore_writes(page)]
    record("dice-roller", "and the next roll is saved to the Cell", any(w.startswith("dice_rolls/cell_night/rolls/") for w in writes), str(writes))
    # A roll pops the panel open over ~60% of a phone; it then stayed open
    # on every page the player moved to inside the Hub.
    page.evaluate("() => { const p = document.getElementById('dr-panel'); if (p.classList.contains('dr-collapsed')) window.dgDice._toggle(); }")
    page.evaluate("() => { document.getElementById('dg-shell-content').src = 'agent-hub.html?again=1'; }")
    _pump_until(page, lambda: page.evaluate("() => document.getElementById('dr-panel').classList.contains('dr-collapsed')"), 5000)
    record("dice-roller", "the open roller collapses when the player moves to another Hub page",
           page.evaluate("() => document.getElementById('dr-panel').classList.contains('dr-collapsed')"), "")
    record("dice-roller", "no JS exceptions (hub roller)", len(errs) == 0, "; ".join(errs))
    ctx.close()
    return errs

_PROFILE_FIELDS = {
    "char_name": "Robert Wright", "codename": "PARISH", "player_name": "Mara Voss",
    "age_range": "Mid 30s", "sex": "Male", "nationality": "American",
    "face_shape": "oval", "eye_color": "brown", "eye_shape": "almond",
    "nose": "straight", "lips": "thin", "skin": "tan",
    "facial_hair": "clean-shaven", "hair_color": "brown",
    "hair_style": "short", "hair_texture": "straight",
    "build": "average", "posture": "upright",
    "expression": "neutral", "vibe": "unremarkable",
    "jacket": "coat", "shirt": "shirt", "trousers": "trousers", "footwear": "boots",
}

def test_agent_file_storage_plates_and_refresh(p):
    """Returning to an Agent File rendered the stale local dg_last_agent
    snapshot and never refetched -- a Face Plate generated since showed as
    "No face plate on file". And every Plate uploaded since the Firebase
    Storage move (an https download URL) never displayed at all: the page
    only knew gdrive: links. An Outfit Plate generated in a later session
    also went out with no face reference (Storage sends no CORS headers,
    so the page can't read the bytes) -- it now passes the URL for the
    backend to fetch. And right after generating a Face Plate, the era
    header still said "No Photo Yet" with the Outfit button dimmed."""
    face = "https://firebasestorage.googleapis.com/v0/b/dg-app-b3447.firebasestorage.app/o/agent-plates%2FMARA-0001-face-90s.png?alt=media&token=t"
    local = dict(_PROFILE_FIELDS, agent_code="MARA-0001", submitted_at="2026-09-27T19:00:00.000Z",
                 active_eras='["90s"]', era_90s_mode0="portrait prompt", era_90s_mode1="reference prompt")
    server = dict(local, era_90s_face_url=face)
    page = p.new_page(viewport={"width": 390, "height": 844})
    errs = collect_errors(page)
    install_notes_firestore_stub(page)
    _block_fonts(page)
    posts = []
    def respond(method, q, body):
        if method == "GET" and q.get("code"):
            return {"status": "OK", "data": server}
        if body and body.get("action") == "generate_plate_image":
            return {"status": "OK", "image_base64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="}
        return None
    _route_backend(page, respond, posts)
    png = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000")
    # Real Storage download URLs send no CORS headers: an <img> loads them,
    # a fetch() can't read them. Model exactly that.
    page.route("**/firebasestorage.googleapis.com/**",
               lambda r: r.abort() if r.request.resource_type == "fetch" else r.fulfill(status=200, content_type="image/png", body=png))
    page.add_init_script("try { localStorage.setItem('dg_last_agent', " + json.dumps(json.dumps({"code": "MARA-0001", "data": local})) + "); } catch (e) {}")
    page.goto(f"{BASE}/agent-hub.html?code=MARA-0001", wait_until="load", timeout=15000)
    _pump_until(page, lambda: page.evaluate("() => { const i = document.getElementById('img-face-90s'); return !!(i && i.getAttribute('src')); }"), 6000)
    img = page.evaluate("() => { const i = document.getElementById('img-face-90s'); return i ? [i.getAttribute('src'), i.style.display] : null; }")
    record("journey", "a return visit refreshes the stale local copy and shows the Storage-hosted Face Plate",
           bool(img) and img[0] == face and img[1] == "block", str(img))
    record("journey", "the era header says Photo On File", "Photo On File" in (page.text_content("#era-photo-90s") or ""), page.text_content("#era-photo-90s") or "")
    btn = 'button[data-era="90s"][data-mode="mode1"][onclick^="generatePlateImage"]'
    _open_era(page)
    page.locator(btn).click()
    _pump_until(page, lambda: any(b.get("action") == "generate_plate_image" for b in posts), 6000)
    gen = [b for b in posts if b.get("action") == "generate_plate_image"]
    record("journey", "a later-session Outfit Plate hands the backend the Face Plate's URL as its reference",
           bool(gen) and gen[0].get("reference_image_url") == face, str({k: (v[:60] if isinstance(v, str) else v) for k, v in (gen[0] if gen else {}).items() if k != 'prompt'}))
    page.close()

    # Same era, no Face Plate yet: generating one updates the header + Outfit button in place.
    page = p.new_page(viewport={"width": 390, "height": 844})
    errs += collect_errors(page)
    install_notes_firestore_stub(page)
    _block_fonts(page)
    server = dict(local)
    _route_backend(page, respond, posts)
    page.goto(f"{BASE}/agent-hub.html?code=MARA-0001", wait_until="load", timeout=15000)
    page.wait_for_timeout(1500)
    _open_era(page)
    page.locator('button[data-era="90s"][data-mode="mode0"][onclick^="generatePlateImage"]').click()
    _pump_until(page, lambda: "Photo On File" in (page.text_content("#era-photo-90s") or ""), 6000)
    record("journey", "generating a Face Plate flips the era header to Photo On File right away",
           "Photo On File" in (page.text_content("#era-photo-90s") or ""), page.text_content("#era-photo-90s") or "")
    record("journey", "...and un-dims the Outfit Plate's Generate Image",
           page.evaluate(f"() => getComputedStyle(document.querySelector('{btn}')).opacity") == "1", "")
    _pump_until(page, lambda: any(b.get("action") == "update_field" and b.get("field") == "face_plate_url" for b in posts), 5000)
    record("journey", "a Face Plate for the Active Era also becomes the Agent's main photo (Hub card, Live Play, A-Cell)",
           any(b.get("action") == "update_field" and b.get("field") == "face_plate_url" and b.get("value") for b in posts),
           str([(b.get("field"), str(b.get("value"))[:40]) for b in posts if b.get("action") == "update_field"]))
    page.evaluate("() => showEraSelect()")
    picker = page.evaluate("() => [document.querySelector('#af-era-select .af-sub').textContent, Array.from(document.querySelectorAll('#af-era-select .era-option')).filter(o => o.style.display !== 'none').map(o => o.getAttribute('onclick'))]")
    record("journey", "+ Add Era offers only eras not already on file, and says so",
           "another era" in picker[0] and not any("'90s'" in o for o in picker[1]) and len(picker[1]) == 3, str(picker))
    record("journey", "no JS exceptions (agent file plates)", len(errs) == 0, "; ".join(errs))
    page.close()
    return errs

def test_plate_save_survives_a_dropped_connection(p):
    """A Plate generated or uploaded on a shaky connection: the photo showed
    on screen while the save failed, and the upload button went back to
    "Replace Face Plate", so it looked saved and wasn't (Richard Phaucet,
    Milk). The save now retries by itself (3 tries), and if it still fails
    says so on the photo -- "Not saved" with Save again, which keeps the
    image -- and the button says "Not saved -- try again"."""
    local = dict(_PROFILE_FIELDS, agent_code="MARA-0001", submitted_at="2026-09-27T19:00:00.000Z",
                 active_eras='["90s"]', era_90s_mode0="portrait prompt", era_90s_mode1="reference prompt")
    page = p.new_page(viewport={"width": 390, "height": 844})
    errs = collect_errors(page)
    install_notes_firestore_stub(page)
    _block_fonts(page)
    posts = []
    def respond(method, q, body):
        if method == "GET" and q.get("code"):
            return {"status": "OK", "data": local}
        if body and body.get("action") == "generate_plate_image":
            return {"status": "OK", "image_base64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="}
        return None
    _route_backend(page, respond, posts)
    page.goto(f"{BASE}/agent-hub.html?code=MARA-0001", wait_until="load", timeout=15000)
    page.wait_for_timeout(1500)
    _open_era(page)
    # (the brief write of the Plate's link -- _route_backend reports it as update_field)
    saves = lambda: [b for b in posts if b.get("action") == "update_field" and b.get("field") == "era_90s_face_url" and b.get("value")]
    # Two drops, then it goes through: saved, by itself.
    page.evaluate("() => { window.__dgStorageFail = 2; }")
    page.locator('button[data-era="90s"][data-mode="mode0"][onclick^="generatePlateImage"]').click()
    _pump_until(page, lambda: len(saves()) >= 1, 15000)
    st = page.text_content("#prompt-mode0-status-90s") or ""
    record("plates", "a generated Face Plate is saved after two dropped uploads, with no help",
           len(saves()) == 1 and page.locator("#plate-face-90s .af-plate-unsaved").count() == 0 and "saved" in st, st)
    # Upload by hand on a dead connection: the photo says Not saved, the button too.
    page.evaluate("() => { window.__dgStorageFail = 99; }")
    import tempfile
    tmp = tempfile.NamedTemporaryFile("wb", suffix=".png", delete=False)
    tmp.write(bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5c8d5d40000000049454e44ae426082")); tmp.close()
    page.set_input_files("#upload-face-90s", tmp.name)
    page.wait_for_selector("#plate-face-90s .af-plate-unsaved", timeout=15000)
    lbl = page.evaluate("() => document.getElementById('upload-face-90s').previousElementSibling.textContent")
    note = page.text_content("#plate-face-90s .af-plate-unsaved") or ""
    record("plates", "a failed upload says Not saved on the photo, and the button says so too (not \"Replace\")",
           "Not saved" in note and "Save again" in note and "Not saved" in lbl and len(saves()) == 1, f"{note!r} {lbl!r}")
    # Back online: Save again stores that same photo.
    page.evaluate("() => { window.__dgStorageFail = 0; }")
    page.click("#plate-face-90s .af-plate-unsaved button")
    _pump_until(page, lambda: len(saves()) >= 2, 10000)
    record("plates", "Save again stores the same photo once the connection is back, and the note goes",
           len(saves()) == 2 and page.locator("#plate-face-90s .af-plate-unsaved").count() == 0
           and page.evaluate("() => document.getElementById('upload-face-90s').previousElementSibling.textContent") == "Replace Face Plate", str(len(saves())))
    os.unlink(tmp.name)
    errs = [e for e in errs if "Plate save:" not in e]   # the failed save logs on purpose
    record("plates", "no JS exceptions (plate save retries)", len(errs) == 0, "; ".join(errs))
    page.close()
    return errs

def test_profiling_edit_keeps_agent_file(p):
    """Editing Profiling ("Update Brief") after building an Agent File sent
    only the form's own fields, and the brief upsert blanked every other
    column -- the eras, every era's Plates and prompts, the Active Era,
    medical/AAR logs, the Profession. The page itself then showed "choose
    the first era" again. (backend v96 also stops blanking absent columns;
    this covers the page side, which works before that redeploy.)"""
    face = "https://firebasestorage.googleapis.com/v0/b/dg-app-b3447.firebasestorage.app/o/agent-plates%2FMARA-0001-face-90s.png?alt=media"
    data = dict(_PROFILE_FIELDS, agent_code="MARA-0001", submitted_at="2026-09-27T19:00:00.000Z",
                active_eras='["90s","00s"]', campaign_era="00s", era_90s_face_url=face,
                era_90s_mode0="p0", era_90s_mode1="p1", era_00s_mode0="q0", era_00s_mode1="q1",
                profession="Police Officer", medical_log='[{"note":"broken arm"}]')
    page = p.new_page(viewport={"width": 390, "height": 844})
    errs = collect_errors(page)
    install_notes_firestore_stub(page)
    _block_fonts(page)
    posts = []
    _route_backend(page, lambda m, q, b: {"status": "OK", "data": data} if (m == "GET" and q.get("code")) else None, posts)
    page.route("**/firebasestorage.googleapis.com/**", lambda r: r.abort())
    page.goto(f"{BASE}/agent-hub.html?code=MARA-0001", wait_until="load", timeout=15000)
    page.wait_for_timeout(1500)
    # v2: the Appearance form drops down from the button under the photo.
    if page.locator("#ah-appear-MARA-0001[hidden]").count():
        page.click("[data-ah-appear=MARA-0001]")
    page.evaluate("() => window.dgAgentFile.focus('appearance')")  # Edit
    page.fill("#dg-form [name=eye_color]", "storm grey")
    page.evaluate("() => handleSubmit()")
    _pump_until(page, lambda: any(b.get("eye_color") == "storm grey" for b in posts), 5000)
    brief = next((b for b in posts if b.get("eye_color") == "storm grey"), {})
    keep = ["active_eras", "campaign_era", "era_90s_face_url", "era_00s_mode0", "profession", "medical_log"]
    record("journey", "Update Brief carries the Agent File's eras, Plates, prompts, Active Era, logs and Profession",
           all(brief.get(k) == data[k] for k in keep), str({k: brief.get(k) for k in keep}))
    page.wait_for_timeout(800)
    record("journey", "...and the Agent File still shows its eras afterwards (not 'choose the first era')",
           page.evaluate("() => document.getElementById('af-pages-wrap').style.display") == "block"
           and page.evaluate("() => document.getElementById('af-era-select').style.display") != "block", "")
    record("journey", "no JS exceptions (profiling edit)", len(errs) == 0, "; ".join(errs))
    page.close()
    return errs

# Firestore rules deny a read of a note doc that doesn't exist yet
# (resource is null) -- the stub has no rules, so emulate that one.
_NOTES_READ_RULE_EMULATION = r"""
(function () {
  const base = window.firebase.firestore;
  window.firebase.firestore = function () {
    const db = base();
    const rt = db.runTransaction;
    db.runTransaction = function (fn) {
      return rt.call(db, function (tx) {
        const get = tx.get;
        tx.get = function (ref) {
          if (/^cells\/[^/]+\/notes\//.test(ref.__path) && !Object.prototype.hasOwnProperty.call(window.__dgFirestoreDocs || {}, ref.__path)) {
            return Promise.reject({ code: 'permission-denied', message: 'Missing or insufficient permissions.' });
          }
          return get.call(tx, ref);
        };
        return fn(tx);
      });
    };
    return db;
  };
})();
"""

def test_notes_first_block_saves_under_rules(p):
    """Since Notes writes moved to Firestore (backend v93), saving a brand-
    new block read the not-yet-existing doc inside a transaction first --
    and the notes read rule can't be evaluated on a missing doc, so
    Firestore denied the read and the whole save. Every new note was lost
    on reload (found against the real rules in the Firebase emulator; the
    test stub has no rules, which is how it went unnoticed)."""
    page = p.new_page(viewport={"width": 390, "height": 844})
    page.set_default_timeout(15000)
    errs = collect_errors(page)
    install_notes_firestore_stub(page)
    page.add_init_script(_NOTES_READ_RULE_EMULATION)
    _block_fonts(page)
    cell = {"cell_id": "cell_1", "name": "Cell Alpha", "handler": "Sam", "member_codes": ["OWEN-CS12", "PRIY-AN34"]}
    seed_cells_docs(page, [cell])
    ident = {"OWEN-CS12": {"color": "#2b6cb0", "font": "nycd"}}
    _route_backend(page, lambda m, q, b: {"status": "OK", "notes": {}, "identities": ident, "cells": [cell], "evidence": [], "seen": {}, "operations": []})
    page.add_init_script("try { localStorage.setItem('dg_agent_roster', JSON.stringify({'OWEN-CS12': {code: 'OWEN-CS12', char_name: 'Owen Castillo', saved_at: Date.now()}})); } catch (e) {}")
    page.goto(f"{BASE}/notes/index.html?code=OWEN-CS12", wait_until="load", timeout=15000)
    _pump_until(page, lambda: page.locator(".ce-paragraph").count() > 0, 8000)
    if page.locator("text=Start Writing").count():  # a new player picks their ink first
        page.locator("[data-color]").first.click()
        page.click("text=Start Writing")
        page.wait_for_timeout(800)
    page.locator(".ce-paragraph").first.click()
    page.keyboard.type("The motel clerk lied about room 12.")
    _pump_until(page, lambda: any(w["path"].startswith("cells/cell_1/notes/") for w in firestore_writes(page)), 6000)
    writes = [w for w in firestore_writes(page) if w["path"].startswith("cells/cell_1/notes/")]
    record("notes", "a brand-new note block saves even though Firestore denies reading a doc that doesn't exist yet",
           any("motel clerk" in json.dumps(w.get("data")) for w in writes), str([w["path"] for w in writes]))
    record("notes", "no JS exceptions (first note block)", len(errs) == 0, "; ".join(errs))
    page.close()
    return errs

def test_auto_created_brief_uses_titles_and_player(p):
    """The Agent File auto-creates a missing brief from the character sheet.
    It sent the internal profession key ("federal_agent", printed raw
    on the dossier) and dropped the player's name."""
    page = p.new_page(viewport={"width": 390, "height": 844})
    errs = collect_errors(page)
    install_notes_firestore_stub(page)
    _block_fonts(page)
    posts = []
    char = {"v": 1, "bio": {"name": "Robert Wright", "profession": "federal_agent", "player_name": "Mara Voss", "sex": "Male", "nationality": "American"}}
    def respond(method, q, body):
        if method == "GET" and q.get("code") and not q.get("action"):
            return {"status": "NOT_FOUND"}
        if q.get("action") == "load_character":
            return {"status": "OK", "agent_code": q.get("code"), "character_json": json.dumps(char)}
        return None
    _route_backend(page, respond, posts)
    page.goto(f"{BASE}/agent-hub.html?code=ROBE-KKUL", wait_until="load", timeout=15000)
    _pump_until(page, lambda: any(b.get("char_name") for b in posts), 6000)
    brief = next((b for b in posts if b.get("char_name")), {})
    record("journey", "auto-created brief carries the profession title, not the internal key",
           brief.get("profession") == "Federal Agent", str(brief.get("profession")))
    record("journey", "auto-created brief carries the player's name", brief.get("player_name") == "Mara Voss", str(brief.get("player_name")))
    record("journey", "no JS exceptions (auto brief)", len(errs) == 0, "; ".join(errs))
    page.close()
    return errs


FN_CODE, FN_MATE, FN_CELL = "FNRT-0001", "FNRT-0002", "cell_fnrt"

def _field_notes_docs():
    state = {"v": 1, "bio": {"name": "Mara Voss", "profession": "federal_agent", "player_name": "fn tester"},
             "bonds": [{"name": "Lena Voss", "relationship": "Sister", "score": 11}]}
    return {
        f"characters/{FN_CODE}": character_doc(FN_CODE, state, "fn tester"),
        f"briefs/{FN_CODE}": {"agent_code": FN_CODE, "char_name": "Mara Voss", "codename": "PARADE",
                              "player_name": "fn tester", "player_name_lc": "fn tester"},
        f"briefs/{FN_MATE}": {"agent_code": FN_MATE, "char_name": "Tom Hale", "codename": "TIN CUP"},
        f"cells/{FN_CELL}": {"name": "Night Shift", "member_codes": [FN_CODE, FN_MATE]},
        "operations/op_fn_a": {"operation_id": "op_fn_a", "cell_id": FN_CELL, "name": "Operation FULL MOON", "created_at": 1000, "active": True},
        "operations/op_fn_b": {"operation_id": "op_fn_b", "cell_id": FN_CELL, "name": "Operation LOW TIDE", "created_at": 2000},
        "evidence/ev_fn_1": {"title": "Coroner's Preliminary", "body": "Two pages, redacted.", "cell_id": FN_CELL,
                             "operation_id": "op_fn_a", "visible_to": [FN_CODE], "released": True, "created_at": 1500},
    }

def _field_notes_page(p, width=1300, height=860, extra_init="", docs=None):
    page = p.new_page(viewport={"width": width, "height": height})
    page.set_default_timeout(10000)
    errs = collect_errors(page)
    _block_fonts(page)
    route_apps_script_ok(page)
    install_firestore_backend(page, docs or _field_notes_docs())
    roster = {FN_CODE: {"code": FN_CODE, "char_name": "Mara Voss", "codename": "PARADE", "player_name": "fn tester", "saved_at": 5}}
    page.add_init_script("""try {
      sessionStorage.setItem('dg_boot_seen', '1');
      if (!sessionStorage.getItem('fn_seeded')) {
        sessionStorage.setItem('fn_seeded', '1');
        localStorage.setItem('dg_agent_roster', %s);
        localStorage.setItem('dg_cover_identity', 'fn tester');
      }
      %s
    } catch (e) {}""" % (json.dumps(json.dumps(roster)), extra_init))
    return page, errs

def _notebook_text(page):
    return page.evaluate("() => { const b = document.querySelector('#fn-veil [data-fn-slot=body]'); return b && !b.hidden ? b.innerText : ''; }")

def test_field_notes_notebook(p):
    """The Field Notes notebook (assets/field-notes.js, see
    docs/field-notes-widget/SPEC.md) replaces the floating Table Radio pill
    and Dice panel on player pages, and every pocket and tab shows the
    current Agent's real data: Agent File quick look (Play and Open first,
    then Cell, members, Bonds, Operations with the Active one), the full
    Requisition form, Evidence with private remarks, Rules, Settings. On a
    phone, Notes is the quick strip and writes the same note blocks the
    full Player Notes page does."""
    errs_all = []
    page, errs = _field_notes_page(p)
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function("() => window.dgFieldNotes && window.dgFieldNotes.isHost", timeout=10000)
    record("notebook", "the closed notebook is on the page, replacing the radio pill and dice panel",
           page.is_visible("#fn-closed .fn-cover")
           and page.evaluate("() => getComputedStyle(document.getElementById('dg-radio')).opacity === '0'")
           and not page.is_visible("#dr-panel"), "")
    page.click("#fn-closed .fn-cover")
    page.click("#fn-veil .fn-slot[data-view=agentfile]")
    txt = wait_for_condition(lambda: (_notebook_text(page) if "Operation FULL MOON" in _notebook_text(page) else None), timeout_ms=10000) or ""
    _open_cell(page, page.locator("#fn-veil .as-paper.ap").filter(visible=True).first)
    txt = wait_for_condition(lambda: (_notebook_text(page) if "Tom Hale" in _notebook_text(page) else None), timeout_ms=6000) or txt
    record("notebook", "Agent File has Edit and Whole Agent File, and no Play (the Agent File is the sheet)",
           page.evaluate("() => { const r = document.querySelector('#fn-veil [data-fn-slot=body] .as-paper'); return !!r && !!r.querySelector('[data-a=edit]') && !!r.querySelector('[data-go=file]') && !r.querySelector('[data-go=play]'); }"), "")
    record("notebook", "Agent File quick look: name, Cell, Cell members, Bonds, Operations",
           all(s.lower() in txt.lower() for s in ["Mara Voss", "Night Shift", "Tom Hale", "Lena Voss", "Operation FULL MOON", "Operation LOW TIDE"]), txt[:300])
    record("notebook", "the Handler's Active operation is the one marked Active",
           page.evaluate("() => { const r = document.querySelector('#fn-veil .as-op-active'); return !!r && r.textContent.indexOf('FULL MOON') !== -1; }"), "")
    page.click("#fn-veil .fn-slot[data-view=req]")
    rsrc = page.get_attribute("#fn-veil iframe[data-dg-embed=requisition]", "src") or ""
    record("notebook", "Requisition shows the full form inside the notebook, for this Agent",
           "requisition.html?embed=1" in rsrc and FN_CODE in rsrc, rsrc)
    page.click("#fn-veil .fn-tab[data-view=evidence]")
    page.wait_for_selector("#fn-veil textarea[data-ev=ev_fn_1]", timeout=10000)
    record("notebook", "Evidences lists what was released to this Agent", "Coroner's Preliminary" in _notebook_text(page), _notebook_text(page)[:200])
    page.fill("#fn-veil textarea[data-ev=ev_fn_1]", "Check the tissue log.")
    remark = wait_for_condition(lambda: (fs_doc(page, f"handout_notes/{FN_CODE}_ev_fn_1") or {}).get("note"), timeout_ms=8000)
    record("notebook", "an Evidence remark saves as the Agent's own private note", remark == "Check the tissue log.", str(remark))
    page.click("#fn-veil .fn-tab[data-view=rules]")
    rules = wait_for_condition(lambda: (_notebook_text(page) if "Skill Tests" in _notebook_text(page) else None), timeout_ms=8000) or ""
    record("notebook", "Rules reads the Rules Reference inline", "Skill Tests" in rules and "Sanity" in rules, rules[:120])
    page.click("#fn-veil .fn-tab[data-view=settings]")
    record("notebook", "Settings: Cover Identity, Boot splash, Export as PDF, and no way back to the removed old sheet",
           page.input_value("#fn-veil [data-s=ci]") == "fn tester" and page.is_visible("#fn-veil [data-s=boot]")
           and page.is_visible("#fn-veil [data-s=pdf]") and page.locator("#fn-veil [data-s=gosheet]").count() == 0, "")
    page.keyboard.press("Escape")
    record("notebook", "Escape closes the notebook", page.evaluate("() => !window.dgFieldNotes.isOpen()"), "")
    errs_all.extend(errs)
    page.close()

    # Phone: the quick strip writes a real note block.
    page, errs = _field_notes_page(p, 390, 844)
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function("() => window.dgFieldNotes && window.dgFieldNotes.isHost", timeout=10000)
    record("notebook", "phone: closed notebook shows the dice and notebook buttons (no radio chip: the radio is in the notebook)",
           page.locator("#fn-closed-phone [data-fn=chip]").count() == 0 and page.is_visible("#fn-closed-phone .fn-phone-dice")
           and page.is_visible("#fn-closed-phone .fn-phone-book"), "")
    page.click("#fn-closed-phone .fn-phone-book")
    page.click("#fn-veil .fn-tab[data-view=notes]")
    page.wait_for_selector("#fn-veil [data-q=text]", timeout=10000)
    page.fill("#fn-veil [data-q=text]", "The janitor lied about the keys.")
    page.click("#fn-veil [data-q=tag][data-type=npc]")
    page.click("#fn-veil [data-q=shared]")
    page.click("#fn-veil [data-q=add]")
    w = wait_for_condition(lambda: next((x for x in fs_writes(page, f"cells/{FN_CELL}/notes/") if "janitor" in json.dumps(x)), None), timeout_ms=8000) or {}
    d = w.get("data") or {}
    record("notebook", "phone: a quick note saves as a note block in the Agent's Cell, shared and tagged",
           d.get("agent_code") == FN_CODE and d.get("shared") is True and d.get("block_type") == "paragraph" and "npc" in (d.get("tags") or ""), str(w)[:300])
    qtags = json.loads(d.get("tags") or "[]")
    record("notebook", "phone: a tagged quick note is tagged like words on the page (inline span, named by its text)",
           qtags == [{"type": "npc", "label": "The janitor lied about the keys.", "inline": True}]
           and 'class=\\"dg-tag dg-tag-npc\\"' in (d.get("text") or ""), str(d)[:300])
    record("notebook", "phone: the open notebook adds no sideways scrolling",
           page.evaluate("() => document.documentElement.scrollWidth <= innerWidth"), "")
    errs_all.extend(errs)
    page.close()
    return errs_all

def test_agent_hub_one_page_file(p):
    """Agent Hub's tab is the Agent's whole file (assets/agent-file.js, one
    instance moved into the open tab): a stale Agent the hub drops while
    the file sits in their tab must not take the file with them; the
    "Describe them" callout opens Appearance; ?code=…#photos and the
    header's Take Photo go straight to the era photos, in the page; a save
    in Appearance refreshes the Agent's line in the header."""
    errs_all = []
    page = p.new_page(viewport={"width": 1280, "height": 900})
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    _block_fonts(page)
    install_firestore_backend(page, {
        "briefs/ADAM-AF01": dict(MOCK_BRIEF, char_name="Adam Fell", agent_code="ADAM-AF01"),
        "briefs/CORA-AF03": {"char_name": "Cora Lind", "agent_code": "CORA-AF03"},
    })
    # GONE-AF02 has neither an Agent File nor a sheet: the hub drops it.
    # It is the most recent, so its tab is the one open (with the file).
    roster = {"ADAM-AF01": {"code": "ADAM-AF01", "char_name": "Adam Fell", "saved_at": 10},
              "GONE-AF02": {"code": "GONE-AF02", "char_name": "Gone Agent", "saved_at": 30},
              "CORA-AF03": {"code": "CORA-AF03", "char_name": "Cora Lind", "saved_at": 20}}
    page.add_init_script("try { if (!sessionStorage.getItem('__s')) { sessionStorage.setItem('__s', '1'); localStorage.setItem('dg_agent_roster', %s); } } catch (e) {}" % json.dumps(json.dumps(roster)))
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    gone = wait_for_condition(lambda: page.evaluate("() => !document.getElementById('panel-GONE-AF02')") or None, timeout_ms=10000)
    af = _af_state(page)
    record("hub", "an Agent dropped from the roster while the file is in their tab doesn't take the file with them",
           bool(gone) and af.get("inTab") and af.get("code") in ("ADAM-AF01", "CORA-AF03")
           and page.evaluate("() => !!document.getElementById('dg-form')"), json.dumps(af))

    page.click('.tw[data-tab="CORA-AF03"] > span')
    page.wait_for_function("() => window.dgAgentFile.code() === 'CORA-AF03'")
    _af_state(page)
    page.click("#ah-callout-CORA-AF03 [data-ah-focus=appearance]")
    page.wait_for_timeout(900)
    record("hub", "'Describe them' under Play opens the Appearance brief and brings it into view",
           page.evaluate("() => { const r = document.getElementById('af-appear').getBoundingClientRect(); return document.getElementById('af-appear').classList.contains('af-open') && r.top < innerHeight && r.bottom > 0; }"), "")
    page.evaluate("randomizeAgent(null)")
    page.select_option("#dg-form [name=age_range]", "Late 40s")
    page.select_option("#dg-form [name=sex]", "Female")
    page.fill("#dg-form [name=nationality]", "Swedish")
    page.click("#submit-btn")
    wait_for_condition(lambda: "Swedish" in (page.text_content("#ah-meta-CORA-AF03") or ""), timeout_ms=6000)
    record("hub", "saving Appearance refreshes the Agent's line in the header (age, sex, nationality)",
           page.text_content("#ah-meta-CORA-AF03").replace("\xa0", " ").strip() == "Late 40s · Female · Swedish", page.text_content("#ah-meta-CORA-AF03"))
    errs_all.extend(errs)
    page.close()

    page = p.new_page(viewport={"width": 1280, "height": 700})
    page.set_default_timeout(8000)
    errs = collect_errors(page)
    _block_fonts(page)
    install_firestore_backend(page, {"briefs/ADAM-AF01": dict(MOCK_BRIEF, char_name="Adam Fell", agent_code="ADAM-AF01")})
    page.goto(f"{BASE}/agent-hub.html?code=ADAM-AF01#photos", wait_until="domcontentloaded", timeout=15000)
    _af_state(page)
    in_view = "() => { const r = document.getElementById('af-photos').getBoundingClientRect(); return r.top < innerHeight * 0.6 && r.bottom > 0; }"
    record("hub", "?code=…#photos lands on that Agent's era photos",
           bool(wait_for_condition(lambda: page.evaluate(in_view) or None, timeout_ms=4000)), "")
    page.evaluate("() => scrollTo(0, 0)")
    url0 = page.url
    page.click("#panel-ADAM-AF01 [data-ah-focus=photos]")
    record("hub", "the header's Take Photo goes to the era photos in the page (no other page)",
           bool(wait_for_condition(lambda: page.evaluate(in_view) or None, timeout_ms=4000)) and page.url == url0, page.url)
    record("hub", "no JS exceptions", len(errs_all + errs) == 0, "; ".join(errs_all + errs))
    page.close()
    return errs_all + errs

def test_field_id_fabricator_in_notebook(p):
    """The Field ID Fabricator (field-id.html; the Agent Portal's third tab)
    lives in the notebook: Make Field ID on the Field ID page opens it
    across both pages on a desktop and as the page on a phone, loaded with
    the notebook's Agent; Back to the card (or the Field ID tab/pocket)
    returns. Opened any other way, field-id.html forwards into the notebook."""
    errs_all = []
    for width, height in ((1300, 860), (390, 844)):
        where = "desktop" if width > 700 else "phone"
        page, errs = _field_notes_page(p, width=width, height=height)
        page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
        page.wait_for_function("() => window.dgFieldNotes && window.dgFieldNotes.isHost", timeout=10000)
        page.evaluate("() => window.dgFieldNotes.open('fieldid')")
        page.wait_for_selector("#fn-veil [data-go=fab]", timeout=8000)
        page.click("#fn-veil [data-go=fab]")
        f = page.wait_for_selector("#fn-veil iframe[data-dg-embed=fieldid]", timeout=8000)
        src = f.get_attribute("src") or ""
        frame = f.content_frame()
        frame.wait_for_load_state("domcontentloaded")
        loaded = wait_for_condition(lambda: frame.evaluate("() => { const s = window.dgFabricator && window.dgFabricator.state(); return s && s.brief ? s.brief.char_name : null; }"), timeout_ms=8000)
        record("notebook", f"{where}: Make Field ID opens the Fabricator in the notebook, on this Agent", ("code=" + FN_CODE) in src and loaded == "Mara Voss", src + " " + str(loaded))
        spread = page.evaluate("() => !document.querySelector('#fn-veil [data-fn-slot=spread]').hidden")
        record("notebook", f"{where}: " + ("across both pages" if where == "desktop" else "as the page"),
               spread if where == "desktop" else (not spread and page.evaluate("() => !document.querySelector('#fn-veil [data-fn-slot=embed-fab]').hidden")), "")
        page.click("#fn-veil [data-fab=card]")
        record("notebook", f"{where}: Back to the card", bool(wait_for_condition(lambda: page.evaluate("() => !!document.querySelector('#fn-veil [data-fn-idc]')") or None, timeout_ms=4000)), "")
        errs_all.extend(errs)
        page.close()
    page = p.new_page()
    _block_fonts(page)
    page.route("**/hub.html*", lambda r: r.fulfill(status=200, content_type="text/html", body="<!doctype html><title>hub</title>"))
    page.goto(f"{BASE}/field-id.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
    wait_for_condition(lambda: "hub.html?fn=fab" in page.url, timeout_ms=6000)
    record("notebook", "field-id.html opened on its own forwards into the notebook's Fabricator for that Agent",
           "hub.html?fn=fab" in page.url and page.evaluate("localStorage.getItem('dg_stats_cloud_code')") == FN_CODE, page.url)
    page.close()
    record("notebook", "no JS exceptions (Fabricator)", len(errs_all) == 0, "; ".join(errs_all))
    return errs_all

# A plain stand-in for each evidence-pack picture (the real ones are paid
# products: never in this repo), served as the Storage stub's files.
_STOCK_PNG = __import__("base64").b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
def _route_stock(page):
    page.route("**/fake-storage.example/**", lambda r: r.fulfill(status=200, body=_STOCK_PNG, headers={"content-type": "image/png", "access-control-allow-origin": "*"}))
    page.route("**/cdnjs.cloudflare.com/ajax/libs/html2canvas/**", lambda r: r.fulfill(path=os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor", "html2canvas.min.js"), content_type="application/javascript"))
_STOCK_FILES = ["id-templates/" + f for f in ["sheriff.jpg", "sheriff-az.jpg", "oakgrove.jpg", "fire.jpg", "nps.jpg", "fbi.jpg", "tow.jpg", "ewrail.jpg", "podcast.jpg",
                                              "faith.jpg", "titan.jpg", "badge-oregon.png", "badge-arizona.png", "badge-nebraska.png", "badge-alabama.png", "badge-montana.png"]] + \
               ["id-templates/faces/face-01.jpg", "id-templates/faces/face-02.jpg"]

def test_field_id_forgery(p):
    """v3.9.0, the Field ID Fabricator as a forger's terminal and the
    Agent's wallet: (1) Mirror credential, (2) Spoof a local office on the
    evidence-pack stock (Storage id-templates/, never in the repo), and
    (3) Fabricate an entity (a name, a drawn logo, six layouts), each in a
    few taps, each card carrying the Agent's photo and filed to a private
    wallet (wallets/{code}, own session only). The notebook's Field ID
    pocket and page flip through it with ‹ › and show the card carried.
    Every card style keeps its words clear of each other, the photo and
    the edge, with long words too."""
    stats = {"STR": 10, "CON": 12, "DEX": 11, "INT": 14, "POW": 11, "CHA": 13}
    state = {"v": 1, "stats": stats, "csStats": dict(stats), "derived": {"hp": 11, "wp": 11, "san": 52, "bp": 44},
             "bio": {"name": "Mara Voss", "player_name": "fn tester", "profession": "federal_agent", "employer": "Federal Bureau of Investigation"}, "skills": {"alertness": 60}}
    fd = _field_notes_docs()
    fd[f"characters/{FN_CODE}"] = character_doc(FN_CODE, state, "fn tester")
    fd[f"briefs/{FN_CODE}"] = dict(fd.get(f"briefs/{FN_CODE}", {}), face_plate_url="https://fake-storage.example/agent-plates/face.png")
    extra = "localStorage.setItem('dg_fn_orders_ack', JSON.stringify({'%s': 1790000000000}));window.__dgStorageFiles=%s;" % (FN_CODE, json.dumps(_STOCK_FILES))
    errs_all = []
    for width, height in ((1300, 860), (390, 844)):
        where = "desktop" if width > 700 else "phone"
        page, errs = _field_notes_page(p, width=width, height=height, docs=fd, extra_init=extra)
        _route_stock(page)
        page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
        page.wait_for_function("() => window.dgFieldNotes && window.dgFieldNotes.isHost", timeout=10000)
        page.evaluate("() => window.dgFieldNotes.open('fab')")
        f = page.wait_for_selector("#fn-veil iframe[data-dg-embed=fieldid]", timeout=8000).content_frame()
        f.wait_for_function("() => { const s = window.dgFabricator && window.dgFabricator.state(); return s && s.stock && s.brief && s.photo; }", timeout=10000)
        start = f.inner_text("#fx-body")
        record("forgery", f"{where}: the terminal knows the operator, the cover employer and the stock", "MARA VOSS" in start and "FBI" in start and "stock on file: 16" in start, start[:200])
        def wal():
            return page.evaluate("() => window.__dgFirestoreDocs['wallets/%s'] || null" % FN_CODE)
        def photo_on(sel="#fx-prev"):
            return f.evaluate("(s) => [...document.querySelectorAll(s + ' .dgf-photo, ' + s + ' img')].some(e => /agent-plates/.test(e.getAttribute('style') || '') || /agent-plates/.test(e.getAttribute('src') || ''))", sel)
        # (1) Mirror: one tap to file.
        f.click("[data-x=p-mirror]")
        record("forgery", f"{where}: 1 / Mirror credential opens on the cover employer, with the Agent's photo",
               f.eval_on_selector("#ids-agency", "e => e.value") == "FBI" and photo_on(), "")
        f.click("[data-x=file]")
        f.wait_for_selector("text=FORGERY COMPLETE")
        w = wait_for_condition(lambda: (wal() or {}).get("cards") and wal(), timeout_ms=5000)
        record("forgery", f"{where}: ...Print to wallet files it to wallets/{{code}}", bool(w) and w["cards"][0]["proto"] == "mirror" and w["agent_code"] == FN_CODE, str(w)[:160])
        # (2) Office: pick the sheriff, roll a county, file.
        f.click("[data-x=home]"); f.click("[data-x=p-office]")
        f.click("[data-x=tpl][data-v=sheriff]"); f.click("[data-x=next]")
        f.click("[data-x=roll][data-k=place]")
        place = f.eval_on_selector("[data-in='f.place']", "e => e.value")
        prev = f.inner_text("#fx-prev")
        record("forgery", f"{where}: 2 / Office: the sheriff's card fills with the rolled county and the Agent's name and photo",
               place.endswith("County") and place in prev and "Mara Voss" in prev and photo_on(), prev[:120])
        f.fill("[data-in='f.rank']", "Undersheriff")
        record("forgery", f"{where}: ...a rank of your own next to the usual ones goes on the card (no chip lit)",
               "Undersheriff" in f.inner_text("#fx-prev") and f.locator(".chip.on[data-k=rank]").count() == 0, f.inner_text("#fx-prev")[:80])
        f.click("[data-x=opt][data-k=rank][data-v=Sergeant]")
        record("forgery", f"{where}: ...and a chip fills the field again", f.eval_on_selector("[data-in='f.rank']", "e => e.value") == "Sergeant", "")
        f.click("[data-x=file]")
        f.wait_for_selector("text=FORGERY COMPLETE")
        # (3) Entity: name it, take a logo, a layout, file.
        f.click("[data-x=home]"); f.click("[data-x=p-entity]")
        f.click("[data-x=next]")
        record("forgery", f"{where}: 3 / Entity: a front needs a name first", "Name the front" in f.inner_text("#fx-err"), "")
        f.fill("[data-in=org]", "Meadowbrook Gasworks")
        f.click("[data-x=next]")
        record("forgery", f"{where}: ...six drawn insignia for it", f.locator(".logo svg").count() == 6, "")
        f.click("[data-x=logo][data-i='2']"); f.click("[data-x=next]")
        record("forgery", f"{where}: ...six layouts, each with the photo", f.locator(".pick .dgf-card").count() == 6 and f.locator(".pick .dgf-photo").count() == 6, "")
        f.click("[data-x=layout][data-v=letterhead]"); f.click("[data-x=next]")
        f.click("[data-x=roll-phone]")
        f.fill("[data-in=title]", "Night Shift Gas Leak Inspector")
        record("forgery", f"{where}: ...a job title of your own next to the kind's", "Night Shift Gas Leak Inspector" in f.inner_text("#fx-prev"), "")
        f.click("[data-x=file]")
        f.wait_for_selector("text=FORGERY COMPLETE")
        w = wait_for_condition(lambda: len((wal() or {}).get("cards") or []) == 3 and wal(), timeout_ms=5000) or wal()
        ent = (w or {}).get("cards", [{}])[-1]
        record("forgery", f"{where}: ...filed with its words, logo and layout", ent.get("proto") == "entity" and ent.get("org") == "Meadowbrook Gasworks" and ent.get("layout") == "letterhead" and ent.get("logo", {}).get("shape") and ent.get("title"), str(ent)[:200])
        f.click("[data-x=carry]")
        record("forgery", f"{where}: Carry this one sets the carried card", wait_for_condition(lambda: (wal() or {}).get("carried") == ent.get("id"), timeout_ms=4000), str((wal() or {}).get("carried")))
        # The notebook: the pocket shows it, ‹ › flips and saves.
        page.click("#fn-veil [data-fab=card]")
        page.wait_for_selector("#fn-veil [data-fn-walbar]:not([hidden])", timeout=8000)
        cnt = page.text_content("#fn-veil [data-fn-walcount]")
        pocket = page.evaluate("() => document.querySelector('[data-fn-slot=card-biz]').getAttribute('data-template')")
        record("forgery", f"{where}: the Field ID page and pocket show the carried card, 4 of 4", cnt == "4 of 4" and (pocket or "").startswith("forged_entity"), cnt + " " + str(pocket))
        page.click("#fn-veil [data-fn-walbar] [data-fn=wal-next]")
        record("forgery", f"{where}: ‹ › flips the wallet and the one on top is carried", page.text_content("#fn-veil [data-fn-walcount]") == "1 of 4"
               and wait_for_condition(lambda: (wal() or {}).get("carried") == "auto", timeout_ms=4000), str((wal() or {}).get("carried")))
        record("forgery", f"{where}: other cards' corners show behind", page.evaluate("() => getComputedStyle(document.querySelector('#fn-veil .fn-idc-back.b1')).display") == "block", "")
        if where == "phone":
            sw = f.evaluate("() => document.documentElement.scrollWidth") if False else page.evaluate("() => document.documentElement.scrollWidth")
            record("forgery", "phone: nothing reaches past the screen", sw <= 392, str(sw))
        errs_all.extend(errs)
        page.close()

    # Every card style, short and long words: nothing overlaps or leaves the card.
    page = p.new_page(viewport={"width": 1400, "height": 1000})
    _route_stock(page)
    page.goto(f"{BASE}/field-id.html?embed=1", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function("() => window.dgForge", timeout=8000)
    bad = page.evaluate("""() => {
      const F = window.dgForge, out = document.createElement('div'), bad = [];
      document.body.appendChild(out);
      [['David Blake', 'Meadowbrook Gasworks', 0], ['Maximilian Featherstonehaugh', 'Halvorsen & Pike Insurance Company', 1]].forEach(([name, org, long]) => {
        const cards = F.REFS.map(r => { const f = {}; r.fields.forEach(x => { f[x.k] = x.k === 'name' ? name : x.opts ? x.opts[long ? x.opts.length - 1 : 0] : x.roll ? (long ? 'Craters of the Moon N.M.'.slice(0, x.roll === 'phone' ? 14 : 30) : F.roll[x.roll](name)) : 'x'; }); return { proto: 'office', tpl: r.key, fields: f }; })
          .concat(F.LAYOUTS.map((L, i) => ({ proto: 'entity', layout: L.key, org, kind: 'finance', tag: long ? 'Protecting what matters since 1924' : 'Est. 1924', logo: F.logoChoices(org, 'finance', 0, 0)[i], name, title: long ? 'Senior Loss Investigator' : 'Adjuster', phone: '(608) 555-0172', mail: long ? 'mfeatherstonehaugh@halvorsenpike.com' : 'db@hp.com' })));
        cards.forEach(c => {
          out.innerHTML = F.render(c, { photo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', refUrl: f => 'https://fake-storage.example/id-templates/' + f });
          const card = out.firstChild, cr = card.getBoundingClientRect(), key = (c.tpl || c.layout) + (long ? '/long' : '');
          const els = [...card.querySelectorAll('.dgf-t,.dgf-photo')].map(e => ({ r: e.getBoundingClientRect(), k: (e.textContent || 'photo').slice(0, 16) }));
          els.forEach(a => { if (a.r.right > cr.right + 1 || a.r.left < cr.left - 1 || a.r.bottom > cr.bottom + 1) bad.push(key + ' OUT ' + a.k); });
          for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
            const a = els[i].r, b = els[j].r, ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ox > 1 && oy > 1) bad.push(key + ' OVERLAP ' + els[i].k + ' | ' + els[j].k);
          }
          if (!card.querySelector('.dgf-photo')) bad.push(key + ' NO PHOTO');
        });
      });
      return bad; }""")
    record("forgery", "every card style (16 designs, 6 layouts; short and long words) keeps its words clear and carries a photo", not bad, str(bad[:6]))
    page.close()

    # Only the Agent's own session reads or writes a wallet; the stock is
    # signed-in reads, Handler writes.
    rules = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "firestore.rules")).read()
    srules = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "storage.rules")).read()
    m = re.search(r"match /wallets/\{code\} \{(.*?)\}", rules, re.S)
    sm = re.search(r"match /id-templates/\{allPaths=\*\*\} \{(.*?)\}", srules, re.S)
    record("forgery", "rules: a wallet is the Agent's own (no Handler, no one else)", bool(m) and "agentCode() == code" in m.group(1) and "isHandler" not in m.group(1), m.group(1).strip() if m else "missing")
    record("forgery", "rules: the evidence-pack stock is signed-in read, Handler write", bool(sm) and "request.auth != null" in sm.group(1) and "isHandler()" in sm.group(1), sm.group(1).strip() if sm else "missing")
    record("forgery", "no evidence-pack pictures are in the repo", not any(os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", n)) for n in ["sheriff.jpg", "faith.jpg", "titan.jpg", "badge-oregon.png"]), "")
    record("forgery", "no JS exceptions", not errs_all, str(errs_all[:3]))
    return errs_all

def test_agent_file_profession_employer_line(p):
    """v3.10.1: under the Agent's name the Agent File shows profession ·
    employer · Cover, on Agent Hub and in Field Notes alike; an Agent whose
    sheet has no profession or employer takes them from the brief."""
    errs_all = []
    for where, fallback in (("hub", False), ("notebook", False), ("hub", True)):
        fd = _field_notes_docs()
        st = json.loads(fd[f"characters/{FN_CODE}"]["character_json"])
        if fallback:
            st["bio"].pop("profession", None); st["bio"].pop("employer", None)
            fd[f"briefs/{FN_CODE}"] = dict(fd[f"briefs/{FN_CODE}"], profession="Photographer", employer="The Coos Bay Clarion")
        else:
            st["bio"]["employer"] = "Federal Bureau of Investigation — Kansas City Field Office"
        fd[f"characters/{FN_CODE}"] = character_doc(FN_CODE, st, "fn tester")
        page, errs = _field_notes_page(p, docs=fd)
        page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
        if where == "hub":
            sel = f"#ah-sheet-{FN_CODE} .ap-head .as-sub"
        else:
            page.wait_for_function("() => window.dgFieldNotes && window.dgFieldNotes.isHost", timeout=10000)
            page.evaluate("() => window.dgFieldNotes.open('agentfile')")
            sel = "#fn-root .ap-head .as-sub"
        page.wait_for_selector(sel, state="attached", timeout=10000)
        line = wait_for_condition(lambda: (lambda t: t if "Cover" in t and ("Kansas" in t or "Clarion" in t) else None)(page.text_content(sel) or ""), timeout_ms=6000) or page.text_content(sel)
        if fallback:
            ok = line == "Photographer · The Coos Bay Clarion · Cover “PARADE”"
            label = "hub: with none on the sheet, profession and employer come from the brief"
        else:
            ok = line.startswith("Federal Agent · Federal Bureau of Investigation — Kansas City Field Office · Cover “PARADE”")
            label = f"{where}: profession · employer · Cover under the name"
        record("agent-file", label, ok, line)
        if where == "hub":
            want = "Photographer · The Coos Bay Clarion" if fallback else "Federal Agent · Federal Bureau of Investigation — Kansas City Field Office"
            hd = wait_for_condition(lambda: (lambda t: t if t == want else None)(page.text_content(f"#ah-prof-{FN_CODE}") or ""), timeout_ms=5000)
            record("agent-file", "hub: the folder's header shows profession · employer under the name" + (" (from the brief)" if fallback else ""),
                   bool(hd), page.text_content(f"#ah-prof-{FN_CODE}") or "")
        if fallback:
            # Edit mode's Personal data starts from the same words, and Save
            # files them onto the sheet.
            root = f"#ah-sheet-{FN_CODE}"
            page.locator(root + " [data-a=edit]").first.click()
            page.wait_for_selector(root + " .ap-editbar", timeout=5000)
            shown = [page.eval_on_selector(root + " [data-e='bio.profession']", "e => e.value"), page.eval_on_selector(root + " [data-emp=other]", "e => e.value")]
            page.locator(root + " [data-a=save]").first.click()
            page.wait_for_selector("#fn-orders.fn-oath-save", timeout=5000)
            page.keyboard.press("Enter"); page.keyboard.press("y")
            def bio_saved():
                b = json.loads(page.evaluate("() => window.__dgFirestoreDocs['characters/%s'].character_json" % FN_CODE)).get("bio", {})
                return b if b.get("profession") == "Photographer" and b.get("employer") == "The Coos Bay Clarion" else None
            got = wait_for_condition(bio_saved, timeout_ms=6000)
            record("agent-file", "hub: Edit mode's Personal data starts from them, and Save files them on the sheet",
                   shown == ["Photographer", "The Coos Bay Clarion"] and bool(got), str(shown))
        errs_all += errs
        page.close()
    record("agent-file", "profession line: no JS exceptions", len(errs_all) == 0, "; ".join(errs_all))
    return errs_all

def test_fabricate_civic_kinds(p):
    """v3.10.0: Fabricate an entity also covers universities, libraries,
    city and county government, law offices and counseling. Each kind
    draws its own insignia, rolls a fitting name, and gives an e-mail on
    the domain it would really use (.edu, .gov, .org)."""
    page = p.new_page()
    errs = collect_errors(page)
    page.goto(f"{BASE}/field-id.html?embed=1", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function("() => window.dgForge", timeout=8000)
    r = page.evaluate("""() => { const F = window.dgForge, keys = ['university', 'library', 'municipal', 'county', 'legal', 'counsel'], out = {};
        keys.forEach(k => { const kd = F.kind(k), org = F.roll.company(k);
            out[k] = { found: kd.key === k, label: kd.label, titles: kd.titles.length, org: org,
                       motif: /<path|<rect|<circle/.test(F.logo({ shape: 'tile', pal: F.PALS[0], name: org, kind: k }).split('scale(')[1] || '')
                              && F.logo({ shape: 'tile', pal: F.PALS[0], name: org, kind: k }) !== F.logo({ shape: 'tile', pal: F.PALS[0], name: org, kind: 'energy' }),
                       mail: F.roll.mail(org, 'Mara Voss', k) }; });
        out.energyMail = F.roll.mail('Meadowbrook Gasworks', 'Mara Voss', 'energy');
        out.count = F.KINDS.length; return out; }""")
    keys = ["university", "library", "municipal", "county", "legal", "counsel"]
    record("fabricate-kinds", "six new kinds, each with titles, a rolled name and its own insignia",
           r["count"] == 14 and all(r[k]["found"] and r[k]["titles"] >= 5 and r[k]["org"] and r[k]["motif"] for k in keys), str(r)[:400])
    tlds = {k: r[k]["mail"].rsplit(".", 1)[-1] for k in keys}
    record("fabricate-kinds", "e-mail domains fit the kind (.edu, .gov, .org; a law office and old kinds stay .com)",
           tlds == {"university": "edu", "library": "org", "municipal": "gov", "county": "gov", "legal": "com", "counsel": "org"}
           and r["energyMail"].endswith(".com") and r["university"]["mail"].startswith("mvoss@"), str(tlds) + " " + r["energyMail"])
    page.click("[data-x=p-entity]")
    page.wait_for_selector("[data-x=kind][data-v=university]", timeout=5000)
    labels = page.evaluate("() => [...document.querySelectorAll('[data-x=kind]')].map(b => b.textContent)")
    record("fabricate-kinds", "the Fabricate step offers them as chips",
           all(r[k]["label"] in labels for k in keys), str(labels))
    record("fabricate-kinds", "no JS exceptions", len(errs) == 0, "; ".join(errs))
    page.close()
    return errs

def test_employer_dropdown(p):
    """v3.9.0: Employer is a drop-down of the agencies with a Field ID card
    on file, plus Other…, with an optional Office / unit (New Recruit's
    Personal data and the Agent File's Edit mode). An employer saved
    before (free text) opens on its agency, or as Other with its words."""
    page = p.new_page()
    page.goto(f"{BASE}/field-id.html?embed=1", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function("() => window.dgAgencies", timeout=8000)
    r = page.evaluate("""() => { const A = window.dgAgencies; return [
        A.split('ATF Special Response Team'), A.split('Federal Bureau of Investigation — Kansas City Field Office'), A.split('Tennessee Valley Authority'),
        A.split('CBP Border Patrol (BORTAC)'), A.compose('USMS', '', 'Eastern District'), A.compose('', 'NASA', ''), A.match('U.S. Postal Inspection Service').code ]; }""")
    record("employer", "an old free-text employer opens on its agency, with the rest as the unit",
           r[0] == {"code": "ATF", "other": "", "unit": "Special Response Team"} and r[1] == {"code": "FBI", "other": "", "unit": "Kansas City Field Office"} and r[3]["code"] == "CBP", str(r[:4]))
    record("employer", "...one not on file opens as Other with its words", r[2] == {"code": "", "other": "Tennessee Valley Authority", "unit": ""}, str(r[2]))
    nb = page.evaluate("""() => { const A = window.dgAgencies; return ['NASA Kennedy Space Center', 'U.S. Coast Guard (HITRON)', 'National Security Agency (TAO)', 'IRS Criminal Investigation', 'Department of Homeland Security'].map(e => A.split(e).code); }""")
    record("employer", "batch 1 (NASA, NSA, Coast Guard, DHS, IRS-CI): the professions' employers find their agency", nb == ["NASA", "USCG", "NSA", "IRSCI", "DHS"], str(nb))
    nb = page.evaluate("""() => { const A = window.dgAgencies; return ['CIA Directorate of Operations', 'DIA HUMINT', 'NGA', 'National Reconnaissance Office', 'Office of Naval Intelligence', 'Media relations', 'Special projects'].map(e => A.split(e).code); }""")
    record("employer", "batch 2 (CIA, DIA, NGA, NRO, ONI): the professions' employers find their agency, and words like 'Media'/'Special' don't",
           nb == ["CIA", "DIA", "NGA", "NRO", "ONI", "", ""], str(nb))
    nb = page.evaluate("""() => { const A = window.dgAgencies; return ['FEMA Region IV', 'National Counterterrorism Center', 'NNSA Office of Secure Transportation', 'DARPA', 'National Park Service ranger', 'Female choir'].map(e => A.split(e).code); }""")
    record("employer", "batch 3 (FEMA, NCTC, NNSA, DARPA, NPS) find their agency, and 'Female' isn't FEMA",
           nb == ["FEMA", "NCTC", "NNSA", "DARPA", "NPS", ""], str(nb))
    nb = page.evaluate("""() => { const A = window.dgAgencies; return ["U.S. Attorney's Office, Southern District of New York", 'Department of Justice', 'DOJ Office of Inspector General', 'Federal Bureau of Investigation'].map(e => A.split(e).code); }""")
    record("employer", "batch 4: a U.S. Attorney finds the Department of Justice, while DOJ OIG and the FBI keep their own cards",
           nb == ["DOJ", "DOJ", "DOJIG", "FBI"], str(nb))
    nb = page.evaluate("""() => { const A = window.dgAgencies; return ['Office of the Director of National Intelligence', 'NCTC (ODNI)', 'CDC Epidemic Intelligence Service', 'NIH', 'State Department, Bureau of Diplomatic Security', 'Tennessee State Police', 'State of Tennessee'].map(e => A.split(e).code); }""")
    record("employer", "batch 4 (ODNI, CDC, NIH, State) find their agency; NCTC beats ODNI; 'State Police' isn't the State Department",
           nb == ["ODNI", "NCTC", "CDC", "NIH", "DOS", "", ""], str(nb))
    nb = page.evaluate("""() => { const A = window.dgAgencies; return ['U.S. Army Special Forces', 'Army CID', 'U.S. Navy SEALs', 'Department of the Navy', 'USAF Pararescue', 'Air Force Office of Special Investigations', 'AFOSI Det 101', 'Marine Corps Force Reconnaissance', 'USMC', 'Office of Naval Intelligence', 'Naval Criminal Investigative Service', 'Acme USA'].map(e => A.split(e).code); }""")
    record("employer", "batch 5 (military): the services and AFOSI find their card; ONI and NCIS keep theirs; no bare 'USA' match",
           nb == ["ARMY", "ARMY", "NAVY", "NAVY", "USAF", "AFOSI", "AFOSI", "USMC", "USMC", "ONI", "NCIS", ""], str(nb))
    order = page.evaluate("() => [...new DOMParser().parseFromString('<select>' + window.dgAgencies.optionsHtml('', '') + '</select>', 'text/html').querySelectorAll('optgroup')].map(g => g.label)")
    record("employer", "...the drop-down shows Military right after Intelligence",
           order[:3] == ["Federal law enforcement", "Intelligence", "Military"] and len(order) == 7, str(order))
    record("employer", "agency + unit saves as one employer line the Field ID still matches", r[4] == "U.S. Marshals Service — Eastern District" and r[5] == "NASA" and r[6] == "USPI", str(r[4:]))
    page.close()
    # In New Recruit: the drop-down, the note, the hidden field.
    page = p.new_page(viewport={"width": 1280, "height": 900})
    errs = collect_errors(page)
    page.add_init_script("try{sessionStorage.setItem('dg_boot_seen','1');localStorage.setItem('dg_cover_identity','g');localStorage.setItem('dg_tours_off','1');}catch(e){}")
    install_firestore_backend(page, {})
    page.goto(f"{BASE}/agent-hub.html#new", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function("() => window.dgRecruit && window.dgRecruitData && window.dgAgencies", timeout=15000)
    page.evaluate("""() => { const w = window.dgRecruit.freshDraft(); w.step = 5; w.reached = 5; w.prof = Object.assign(w.prof, {src:'cx', key:'atf_tactical'}); w.bio.employer = 'ATF Special Response Team'; window.dgRecruit._set(w); }""")
    page.wait_for_selector("[data-emp=sel]")
    record("employer", "New Recruit: Employer is the agencies drop-down, on the profession's agency", page.eval_on_selector("[data-emp=sel]", "e => e.value") == "ATF"
           and page.eval_on_selector("[data-emp=unit]", "e => e.value") == "Special Response Team" and "credential" in page.inner_text(".dg-emp-note"), "")
    page.select_option("[data-emp=sel]", "__other")
    page.fill("[data-emp=other]", "Tennessee Valley Authority")
    page.wait_for_timeout(200)
    record("employer", "...Other… asks which agency, says there's no card on file (quietly), and saves the words",
           page.evaluate("() => window.dgRecruit._w().bio.employer") == "Tennessee Valley Authority" and "No ID card on file" in page.inner_text(".dg-emp-note")
           and page.is_hidden("[data-emp=unit]"), page.evaluate("() => window.dgRecruit._w().bio.employer"))
    page.select_option("[data-emp=sel]", "USMS")
    page.fill("[data-emp=unit]", "Eastern District")
    page.wait_for_timeout(200)
    record("employer", "...an agency and its unit save as one line", page.evaluate("() => window.dgRecruit._w().bio.employer") == "U.S. Marshals Service — Eastern District", page.evaluate("() => window.dgRecruit._w().bio.employer"))
    # v3.9.4: grouped and searchable; the batch-1 agencies are on file.
    groups = page.evaluate("() => [...document.querySelectorAll('[data-emp=sel] optgroup')].map(g => g.label)")
    record("employer", "the drop-down is grouped (law enforcement, intelligence, military, homeland security, science, state & local)",
           groups[:6] == ["Federal law enforcement", "Intelligence", "Military", "Homeland security & response", "Science & civil", "State & local"], str(groups))
    page.fill("[data-emp=q]", "coast")
    page.wait_for_timeout(200)
    record("employer", "typing 'coast' in the search picks the Coast Guard", page.eval_on_selector("[data-emp=sel]", "e => e.value") == "USCG"
           and page.evaluate("() => window.dgRecruit._w().bio.employer").startswith("U.S. Coast Guard"), page.evaluate("() => window.dgRecruit._w().bio.employer"))
    page.fill("[data-emp=q]", "intel")
    page.wait_for_timeout(200)
    record("employer", "...'intel' narrows it to the Intelligence group", page.evaluate("() => [...document.querySelectorAll('[data-emp=sel] optgroup')].map(g => g.label).filter(l => l !== 'Homeland security & response')") == ["Intelligence"], str(page.evaluate("() => [...document.querySelectorAll('[data-emp=sel] option')].map(o => o.value)")))
    record("employer", "no JS exceptions", not errs, str(errs[:3]))
    page.close()
    return errs

def test_acell_id_creator(p):
    """v3.9.0, A-Cell's ID Creator: the evidence-pack stock (Storage
    id-templates/) listed and uploadable, an NPC's badge built from it
    with a stock face, and filed to a Cell as unreleased Evidence: a PNG
    in evidence/ and an Evidence item pointing at it."""
    page = p.new_page(viewport={"width": 1280, "height": 900})
    page.set_default_timeout(15000)
    errs = collect_errors(page)
    page.add_init_script("try { sessionStorage.setItem('dg_acell_pw', 'testpw'); window.__dgStorageFiles = %s; } catch (e) {}" % json.dumps(_STOCK_FILES))
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    _route_stock(page)
    skip_acell_gate(page)
    install_firestore_backend(page, {"cells/cell_h": {"name": "Night Shift", "handler": "Sam", "member_codes": ["OWEN-CS12"]},
                                     "operations/op_h": {"operation_id": "op_h", "cell_id": "cell_h", "name": "Cold Harbor", "created_at": 1}})
    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(500)
    page.evaluate("() => document.querySelector('.tw[data-tab=ids]').click()")
    page.wait_for_selector(".idc-stock:has-text('16 of 16 designs')", timeout=10000)
    record("id-creator", "the stock lists what's uploaded (16 designs, 2 faces)", "2 faces" in page.inner_text(".idc-stock"), page.inner_text(".idc-stock")[:120])
    page.set_input_files("[data-a=upload]", files=[{"name": "face-03.jpg", "mimeType": "image/jpeg", "buffer": _STOCK_PNG}])
    page.wait_for_selector(".idc-stock:has-text('3 faces')", timeout=8000)
    record("id-creator", "an uploaded face lands in id-templates/faces/", "id-templates/faces/face-03.jpg" in page.evaluate("() => window.__dgStorageUploads.map(u => u.path)"), "")
    page.select_option("[data-k=tpl]", "badge-oregon")
    page.fill("[data-f=name]", "Elena Vargas")
    page.fill("[data-f=title]", "Trace Evidence Examiner")
    record("id-creator", "a title of your own, the usual ones offered as suggestions", "Trace Evidence Examiner" in page.inner_text("[data-idc-prev]") and page.locator("#idc-dl-title option").count() >= 4, "")
    page.click("[data-a=face][data-v='faces/face-01.jpg']")
    page.select_option("[data-k=op]", "op_h")
    record("id-creator", "the badge shows the NPC's name and the chosen face", "Elena Vargas" in page.inner_text("[data-idc-prev]") and page.locator("[data-idc-prev] .dgf-photo").count() == 1, "")
    page.click("[data-a=file]")
    page.wait_for_selector(".idc-msg:has-text('Filed')", timeout=15000)
    ev = page.evaluate("() => Object.entries(window.__dgFirestoreDocs).filter(([k]) => /^evidence\\//.test(k)).map(([k, v]) => v)")
    up = page.evaluate("() => window.__dgStorageUploads.map(u => u.path)")
    record("id-creator", "File as Evidence: a PNG in evidence/ and an unreleased item in the Cell and Operation",
           len(ev) == 1 and ev[0]["cell_id"] == "cell_h" and ev[0]["operation_id"] == "op_h" and ev[0]["released"] is False and ev[0]["photo"].endswith(".png")
           and any(u.startswith("evidence/") and u.endswith(".png") for u in up), str(ev)[:200])
    record("id-creator", "no JS exceptions", not errs, str(errs[:3]))
    page.close()
    return errs

def test_hub_folder_switches_notebook_agent(p):
    """v3.9.2: opening another Agent's folder on Agent Hub (a tab or the
    Agents menu) makes them the notebook's Agent: Agent File, Field ID
    and the Fabricator follow. Reported: "I load an Agent from a different
    player but their Field Notes still have the other Agent's sheet"."""
    docs = _field_notes_docs()
    docs[f"briefs/{FN_MATE}"] = {"agent_code": FN_MATE, "char_name": "Tom Hale", "codename": "TIN CUP", "player_name": "other player"}
    docs[f"characters/{FN_MATE}"] = character_doc(FN_MATE, {"v": 1, "bio": {"name": "Tom Hale"}}, "other player")
    roster = {FN_CODE: {"code": FN_CODE, "char_name": "Mara Voss", "player_name": "fn tester", "saved_at": 9},
              FN_MATE: {"code": FN_MATE, "char_name": "Tom Hale", "player_name": "other player", "saved_at": 5}}
    extra = "localStorage.removeItem('dg_cover_identity'); localStorage.setItem('dg_agent_roster', %s); localStorage.setItem('dg_stats_cloud_code', '%s'); localStorage.setItem('dg_fn_orders_ack', JSON.stringify({'%s': 1, '%s': 1}));" % (
        json.dumps(json.dumps(roster)), FN_CODE, FN_CODE, FN_MATE)
    page, errs = _field_notes_page(p, docs=docs, extra_init=extra)
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function("() => window.dgFieldNotes && window.dgFieldNotes.isHost", timeout=10000)
    page.wait_for_selector(f"#tab-strip .tw[data-tab='{FN_MATE}']", timeout=10000)
    before = page.evaluate("() => localStorage.getItem('dg_stats_cloud_code')")
    page.click(f"#tab-strip .tw[data-tab='{FN_MATE}'] > span")
    page.wait_for_timeout(400)
    after = page.evaluate("() => localStorage.getItem('dg_stats_cloud_code')")
    page.evaluate("() => window.dgFieldNotes.open('agentfile')")
    shown = wait_for_condition(lambda: "Tom Hale" in (page.text_content("#fn-veil [data-fn-slot=card-name]") or "") or None, timeout_ms=8000)
    record("notebook", "opening another Agent's folder on Agent Hub makes them the notebook's Agent", before == FN_CODE and after == FN_MATE and bool(shown),
           f"{before} -> {after}, card: {page.text_content('#fn-veil [data-fn-slot=card-name]')}")
    # The roster replaced by another player's Agents (a Cover Identity
    # lookup) while the notebook was on one of yours: it moves to theirs.
    page.evaluate("""(r) => { localStorage.setItem('dg_agent_roster', JSON.stringify(r)); localStorage.setItem('dg_stats_cloud_code', '%s'); window.dgFieldNotes.refresh(); }""" % FN_CODE,
                  {FN_MATE: roster[FN_MATE]})
    page.evaluate("() => window.dgFieldNotes.open('agentfile')")
    moved = wait_for_condition(lambda: "Tom Hale" in (page.text_content("#fn-veil [data-fn-slot=card-name]") or "") or None, timeout_ms=8000)
    record("notebook", "an Agent no longer on the device isn't the notebook's: the roster's is", bool(moved), page.text_content("#fn-veil [data-fn-slot=card-name]"))
    record("notebook", "no JS exceptions (folder → notebook)", not errs, str(errs[:3]))
    page.close()
    return errs

def test_field_notes_page_taps_act_once(p):
    """The notebook's page body is one element reused by every page, and
    quick notes and Settings each added a click listener per render: after
    a re-render (the Agent's data arriving, or opening Settings again) one
    tap ran twice -- Shared flipped on and straight back off, a Settings
    toggle did nothing. Seen intermittently in the phone flow."""
    page, errs = _field_notes_page(p, width=390, height=844)
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function("() => window.dgFieldNotes && window.dgFieldNotes.isHost", timeout=10000)
    page.evaluate("() => window.dgFieldNotes.open('settings')")
    page.wait_for_selector("#fn-veil [data-s=boot]")
    page.evaluate("() => { window.dgFieldNotes.open('rules'); window.dgFieldNotes.open('settings'); }")
    page.wait_for_selector("#fn-veil [data-s=boot]")
    # Count how many times one tap runs: each run writes the setting once.
    page.evaluate("""() => { window.__bootWrites = 0; const o = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) { if (/boot/i.test(k)) window.__bootWrites++; return o.apply(this, arguments); }; }""")
    page.click("#fn-veil [data-s=boot]")
    writes = page.evaluate("() => window.__bootWrites")
    record("notebook", "Settings opened twice: one tap on a toggle runs once", writes == 1, f"runs={writes}")
    page.click("#fn-veil [data-s=boot]")  # put it back
    page.evaluate("() => { window.dgFieldNotes.open('notes'); window.dgFieldNotes.refresh(); }")
    page.wait_for_timeout(600)
    page.evaluate("() => window.dgFieldNotes.open('notes')")
    page.wait_for_selector("#fn-veil [data-q=shared]")
    page.wait_for_timeout(400)
    page.evaluate("""() => { window.__sharedRuns = 0; const b = document.querySelector('#fn-veil [data-q=shared]');
        new MutationObserver(() => window.__sharedRuns++).observe(b, { childList: true }); }""")
    page.click("#fn-veil [data-q=shared]")
    page.wait_for_timeout(100)
    runs = page.evaluate("() => window.__sharedRuns")
    record("notebook", "quick notes after a re-render: one tap on Private runs once and turns it Shared",
           runs == 1 and page.text_content("#fn-veil [data-q=shared]") == "Shared with the Cell", f"runs={runs} " + page.text_content("#fn-veil [data-q=shared]"))
    record("notebook", "no JS exceptions (taps act once)", len(errs) == 0, "; ".join(errs))
    page.close()
    return errs

def test_field_notes_popup_pager(p):
    """The radio, now that the closed notebook has no radio chip beside it
    (retired with Split View): on a phone, the open notebook's header
    radio pops the pager up (position:fixed -- its face was once filtered
    out of every refresh by an offsetParent check, so a channel tap never
    turned the knob and Tune In never became Leave); on a desktop, the
    radio sits under the card pockets in the open notebook."""
    errs_all = []
    for width, height in ((390, 844), (1300, 860)):
        page, errs = _field_notes_page(p, width=width, height=height)
        page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
        page.wait_for_function("() => window.dgFieldNotes && window.dgFieldNotes.isHost && window.dgRadio", timeout=10000)
        phone = width < 700
        where = "phone" if phone else "desktop"
        record("notebook", f"{where}: no radio chip beside the closed notebook",
               page.evaluate("() => document.querySelectorAll('#fn-root .fn-chip').length") == 0, "")
        page.evaluate("() => window.dgFieldNotes.open('agentfile')")
        if phone:
            page.click("#fn-root .fn-ph-radio")
            box = "#fn-pager"
        else:
            box = "#fn-root .fn-kit-radio"
        shown = wait_for_condition(lambda: page.evaluate("(sel) => { const p = document.querySelector(sel); return p && p.getClientRects().length && p.querySelector('.fn-pg-case') ? 1 : null; }", box), timeout_ms=5000)
        record("notebook", f"{where}: the radio is there in the open notebook", bool(shown), "")
        page.click(f"{box} [data-ch='3']")
        knob = wait_for_condition(lambda: page.evaluate("""(sel) => { const k = document.querySelector(sel + ' [data-p=knob]'); return /rotate\\(144deg\\)/.test(k.style.transform) && document.querySelector(sel + ' [data-ch="3"]').classList.contains('fn-on') ? k.style.transform : null; }""", box), timeout_ms=3000)
        record("notebook", f"{where}: tapping a channel turns the radio's knob", bool(knob), str(knob))
        page.click(f"{box} [data-p=tune]")
        key = wait_for_condition(lambda: page.evaluate("(sel) => { const t = document.querySelector(sel + ' [data-p=tune]'); return /leave/i.test(t.textContent) && t.classList.contains('fn-on') ? t.textContent : null; }", box), timeout_ms=4000)
        record("notebook", f"{where}: …and Tune In becomes Leave once tuned", bool(key) and page.evaluate("() => window.dgRadio.state().channel === '3'"), str(key))
        page.click(f"{box} [data-p=tune]")
        errs_all.extend(errs)
        page.close()
    return errs_all

def test_field_notes_round3(p):
    """Field Notes, third round of feedback: the Field ID pocket carries a
    business card for the Agent's agency; Evidences filter by Operation;
    on a desktop Notes spans both pages (index + Evidence left, editor
    right), the Notes tab again drops to quick notes and back, and the
    spread's Character Sheet button leaves for the sheet rather than
    loading it inside the notebook; Friendly's "Make this my Agent" turns
    a pregen into a real, saved character sheet."""
    errs_all = []
    docs = _field_notes_docs()
    docs[f"characters/{FN_CODE}"] = character_doc(FN_CODE, {"v": 1, "bio": {"name": "Mara Voss", "employer": "DEA", "player_name": "fn tester"}}, "fn tester")
    docs["evidence/ev_fn_2"] = {"title": "Voicemail Transcript", "body": "Static.", "cell_id": "", "operation_id": "",
                                "visible_to": ["ALL"], "released": True, "created_at": 1600}
    page, errs = _field_notes_page(p, docs=docs, extra_init="localStorage.setItem('dg_notes_identity_%s', JSON.stringify({color:'#2b6cb0', font:'Nothing You Could Do'})); localStorage.setItem('dg_fn_orders_ack', JSON.stringify({'%s': 1790000000000}));" % (FN_CODE, FN_CODE))
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function("() => window.dgFieldNotes && window.dgFieldNotes.isHost", timeout=10000)
    # Accepted on this device before the Agent had an Agent File: filed on
    # the Agent File once there is one, for the Handler.
    ack = wait_for_condition(lambda: (fs_doc(page, f"briefs/{FN_CODE}") or {}).get("standing_orders_ack_at"), timeout_ms=8000)
    record("notebook", "a clearance briefing accepted before the Agent File existed is filed on it later", bool(ack), str(ack))
    pad = page.evaluate("() => parseInt(getComputedStyle(document.body).paddingBottom, 10)")
    record("notebook", "desktop pages leave room under them for the closed notebook (a wizard's Next is never stuck under it)", pad >= 180, str(pad))
    # Radio and dice live in the notebook: under the card pockets.
    page.evaluate("() => window.dgFieldNotes.open('agentfile')")
    kit = wait_for_condition(lambda: page.evaluate("() => { const k = document.querySelector('#fn-veil [data-fn-slot=kit-radio] .fn-pg-case'); return k && k.offsetParent ? 1 : null; }"), timeout_ms=8000)
    record("notebook", "the radio sits on the notebook's left page, under the card pockets", bool(kit), "")
    if kit and page.evaluate("() => !!window.dgRadio"):
        page.click("#fn-veil [data-fn-slot=kit-radio] [data-p=tune]")
        tuned = wait_for_condition(lambda: page.evaluate("() => window.dgRadio.state().tuned") or None, timeout_ms=6000)
        record("notebook", "…and tunes the Table Radio from there", bool(tuned), "")
        page.click("#fn-veil [data-fn-slot=kit-radio] [data-p=tune]")
    page.click("#fn-veil .fn-kit-dice")
    record("notebook", "the dice tin under the radio opens the Dice page",
           bool(wait_for_condition(lambda: page.evaluate("() => window.dgFieldNotes.view() === 'dice' && !!document.querySelector('#fn-veil #dr-panel')") or None, timeout_ms=6000)), "")
    halves = page.evaluate("() => { const l = document.querySelector('#fn-veil .fn-left').getBoundingClientRect(), r = document.querySelector('#fn-veil .fn-right').getBoundingClientRect(); return [l.width, r.width]; }")
    record("notebook", "the open notebook's two halves are the same width, like a real book", abs(halves[0] - halves[1]) < 2, str(halves))
    page.click("#fn-veil .fn-tab[data-view=rules]")
    record("notebook", "changing pages turns the page (a leaf hinged at the spine)",
           page.evaluate("() => !!document.querySelector('#fn-veil .fn-leaf-wrap .fn-leaf .fn-leaf-back')"), "")
    gone = wait_for_condition(lambda: page.evaluate("() => !document.querySelector('#fn-veil .fn-leaf-wrap')") or None, timeout_ms=3000)
    record("notebook", "…and the turned leaf is cleared away afterwards", bool(gone), "")
    page.emulate_media(reduced_motion="reduce")
    page.click("#fn-veil .fn-tab[data-view=settings]")
    record("notebook", "no page turn when the device asks for reduced motion",
           page.evaluate("() => !document.querySelector('#fn-veil .fn-leaf-wrap')"), "")
    page.emulate_media(reduced_motion="no-preference")
    page.evaluate("() => window.dgFieldNotes.open('fieldid')")
    card = wait_for_condition(lambda: page.evaluate("() => { const c = document.querySelector('#fn-veil [data-fn-idc]'); return c && c.innerText.trim() ? c.getAttribute('data-template') + '|' + c.innerText : null; }"), timeout_ms=8000) or ""
    record("notebook", "Field ID draws the Agent's agency card from the Field IDs templates (DEA)",
           card.startswith("DEA_") and "DRUG ENFORCEMENT" in card.upper() and "Mara Voss" in card, card[:160])
    pocket = page.evaluate("() => { const c = document.querySelector('#fn-veil [data-fn-slot=card-biz]'); return c ? c.getAttribute('data-template') : null; }")
    record("notebook", "…and the same card sits in the Field ID pocket", (pocket or "").startswith("DEA_"), str(pocket))
    page.evaluate("() => window.dgFieldNotes.open('evidence')")
    page.wait_for_selector("#fn-veil [data-ev-filter]", timeout=10000)
    count = lambda: page.evaluate("() => document.querySelectorAll('#fn-veil .fn-card-sheet').length")
    n_all = wait_for_condition(lambda: count() if count() == 2 else None, timeout_ms=8000)
    page.select_option("#fn-veil [data-ev-filter]", "op_fn_a")
    n_op = count()
    page.select_option("#fn-veil [data-ev-filter]", "UNFILED")
    n_un = count()
    record("notebook", "Evidences filter by Operation (all 2 / FULL MOON 1 / Unfiled 1)", (n_all, n_op, n_un) == (2, 1, 1), str((n_all, n_op, n_un)))
    page.evaluate("() => window.dgFieldNotes.open('notes')")
    src = wait_for_condition(lambda: page.get_attribute("#fn-veil .fn-spread iframe", "src") if page.locator("#fn-veil .fn-spread iframe").count() else None, timeout_ms=8000) or ""
    record("notebook", "desktop Notes spans both pages as the full notes (embed=spread)",
           "embed=spread" in src and page.evaluate("() => !!document.querySelector('#fn-veil .fn-book.fn-spreading')"), src)
    page.click("#fn-veil .fn-tab[data-view=notes]")
    record("notebook", "the Notes tab again drops to quick notes",
           page.evaluate("() => !document.querySelector('#fn-veil .fn-book.fn-spreading') && !!document.querySelector('#fn-veil [data-q=full]')"), "")
    page.click("#fn-veil [data-q=full]")
    record("notebook", "…and quick notes' button goes back to the spread", page.evaluate("() => !!document.querySelector('#fn-veil .fn-book.fn-spreading')"), "")
    fr = None
    for _ in range(40):
        fr = next((f for f in page.frames if "embed=spread" in f.url), None)
        if fr: break
        page.wait_for_timeout(250)
    try:
        fr.wait_for_selector("#dg-notes-panel .dg-notes-toc", timeout=10000)
        lay = fr.evaluate("""() => { const q = s => document.querySelector('#dg-notes-panel ' + s).getBoundingClientRect();
            const tabs = q('.dg-notes-tab-strip'), tools = q('.dg-notes-toolbar'), toc = q('.dg-notes-toc'), main = q('.dg-notes-main');
            const tab = document.querySelector('#dg-notes-panel .dg-notes-tab').getBoundingClientRect();
            return { tabsTop: tabs.top < 40, tabsAboveIndex: tabs.bottom <= toc.top + 1, rulesLevel: Math.abs(tabs.bottom - tools.bottom) < 2,
                     indexLeft: toc.right <= main.left, toolsOverEditor: tools.bottom <= main.top + 1,
                     tabsOnPaperEdge: tab.top < 28 && tab.bottom >= 27 && tab.bottom <= 30, tabBox: [tab.top, tab.bottom] }; }""")
        record("notebook", "Notes spread: tabs stand on the paper's top edge over Index/Evidence; tools over the editor on the right, head rules level",
               all(lay.values()), str(lay))
    except Exception as e:
        record("notebook", "Notes spread: tabs stand on the paper's top edge over Index/Evidence; tools over the editor on the right, head rules level", False, str(e)[:200])
    try:
        fr.wait_for_selector("#character-sheet-btn", state="visible", timeout=10000)
        fr.click("#character-sheet-btn")
        page.wait_for_url("**/agent-hub.html?code=**", timeout=10000)
        record("notebook", "the spread's Agent File button leaves for the Agent File (no trap inside the notebook)", True, page.url)
    except Exception as e:
        record("notebook", "the spread's Agent File button leaves for the Agent File (no trap inside the notebook)", False, str(e)[:200])
    errs_all.extend(errs)
    page.close()

    # Phone: the open notebook's header has the radio; its pager comes up over the book
    page, errs = _field_notes_page(p, width=390, height=844)
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function("() => window.dgFieldNotes && window.dgFieldNotes.isHost && !!window.dgRadio", timeout=10000)
    page.evaluate("() => window.dgFieldNotes.open('agentfile')")
    page.click("#fn-veil .fn-phone-head [data-fn=radio]")
    on_top = wait_for_condition(lambda: page.evaluate("""() => { const p = document.getElementById('fn-pager'); if (!p || p.hidden) return null;
        const r = p.querySelector('[data-p=tune]').getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return el && el.closest('#fn-pager') ? 1 : null; }"""), timeout_ms=6000)
    record("notebook", "phone: the notebook header's radio button brings the pager up over the open book", bool(on_top), "")
    errs_all.extend(errs)
    page.close()

    # Friendly -> "Make this my Agent" -> a real sheet, saved with its stats
    page, errs = _field_notes_page(p, docs={})
    page.goto(f"{BASE}/friendly.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_selector(".fr-card[data-id]", timeout=15000)
    first = page.locator(".fr-card[data-id]").first
    name = first.locator(".fc-name").inner_text().strip()
    first.click()
    page.click("#fr-keep")
    page.wait_for_url("**/agent-hub.html?recruit=friendly**", timeout=15000)
    got = wait_for_condition(lambda: page.evaluate("() => { const n = document.querySelector(\"#nr-root [data-f='bio.name']\"); return n && n.value ? n.value : null; }"), timeout_ms=12000)
    record("friendly", "Make this my Agent opens New Recruit with the pregen filled in (at Personal data)", got == name, f"{got!r} vs {name!r}")
    page.click("#nr-root [data-a=next]")
    code = wait_for_condition(lambda: page.evaluate("() => (window.dgRecruit._w() || {}).code || null"), timeout_ms=10000) or ""
    def saved_stats():
        d = fs_doc(page, f"characters/{code}") if code else None
        if not d: return None
        st = json.loads(d.get("character_json") or "{}").get("csStats") or {}
        return st if any(v != 3 for v in st.values()) else None
    st = wait_for_condition(saved_stats, timeout_ms=12000)
    record("friendly", "…saved under its own new Agent Code with the pregen's real stats (not the blank 3s)", bool(st), f"{code} {st}")
    record("friendly", "…not filed until the Contract is signed",
           (json.loads((fs_doc(page, f"characters/{code}") or {}).get("character_json") or "{}")).get("creationCommitted") is False, "")
    errs_all.extend(errs)
    page.close()
    return errs_all

def test_incursion(p):
    """The Incursion -- what brought the Agent to Delta Green -- as a part
    of the Agent, like Motivations: the standalone page and New Recruit
    share one picker (assets/incursion.js: roll all, roll or choose any
    line, or write it freehand); the copy on the Agent's own record
    (characters/{code}.incursion) wins, so a Handler's amendment from
    A-Cell is what the player sees on the Agent File; A-Cell shows it and
    lets the Handler amend it."""
    errs_all = []
    code = "INCU-0001"
    # 1. The standalone page: mix and match, then freehand.
    page = p.new_page(viewport={"width": 1200, "height": 900})
    errs = collect_errors(page)
    _block_fonts(page)
    route_apps_script_ok(page)
    page.add_init_script("try { sessionStorage.setItem('dg_boot_seen', '1'); } catch (e) {}")
    page.goto(f"{BASE}/the-incursion.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_selector("#incursion-picker [data-inc-all]", timeout=10000)
    page.click("#incursion-picker [data-inc-all]")
    txt = page.input_value("#incursion-picker [data-inc-text]")
    record("incursion", "the Incursion page rolls all five lines into one account", "Delta Green covered it up as" in txt and txt.startswith("In a"), txt)
    page.select_option("#incursion-picker [data-inc=cover]", "2")
    txt2 = page.input_value("#incursion-picker [data-inc-text]")
    record("incursion", "choosing one line by hand changes just that part (mix and match)",
           "covered it up as terrorism" in txt2 and txt2.split("Delta Green")[0] == txt.split("Delta Green")[0], txt2)
    record("incursion", "the chosen row lights up in its table",
           page.evaluate("() => document.getElementById('table-cover-row-2').classList.contains('rolled')"), "")
    page.fill("#incursion-picker [data-inc-text]", "My own words about the night at the quarry.")
    page.click("#incursion-picker [data-inc-roll=environment]")
    record("incursion", "freehand words are kept when a line is re-rolled afterwards",
           page.input_value("#incursion-picker [data-inc-text]") == "My own words about the night at the quarry.", "")
    page.click("#incursion-picker [data-inc-rebuild]")
    record("incursion", "…and 'Rewrite from the lines above' brings the rolled account back",
           "Delta Green covered it up as terrorism" in page.input_value("#incursion-picker [data-inc-text]"), "")
    errs_all.extend(errs)
    page.close()

    # 2. The Agent File: the copy on the Agent's own record
    # (characters/{code}.incursion -- a Handler's amendment from A-Cell)
    # wins over the older copy saved inside the character.
    docs = _field_notes_docs()
    st0 = json.loads(docs[f"characters/{FN_CODE}"]["character_json"])
    st0["bio"]["incursion"] = {"picks": {"environment": 3}, "text": "Old sheet copy.", "custom": True}
    docs[f"characters/{FN_CODE}"] = dict(character_doc(FN_CODE, st0, "fn tester"),
                                         incursion={"text": "The Handler says: the lighthouse keeper's ledger.", "custom": True, "by": "handler"})
    page, errs = _field_notes_page(p, docs=docs, extra_init="localStorage.setItem('dg_fn_orders_ack', JSON.stringify({'%s': 1790000000000}));" % FN_CODE)
    page.goto(f"{BASE}/agent-hub.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(1200)
    page.evaluate("() => window.dgFieldNotes.open('agentfile')")
    af = wait_for_condition(lambda: page.evaluate("() => { const el = document.querySelector('#fn-veil .as-incursion'); return el ? el.innerText : null; }"), timeout_ms=10000) or ""
    record("incursion", "the Agent File shows the record's Incursion (the Handler's amendment), not the character's older copy",
           "lighthouse keeper" in af and "Old sheet copy" not in af, af[:160])
    errs_all.extend(errs)
    page.close()

    # 3. A-Cell: the Handler sees it and can amend it.
    page = p.new_page(viewport={"width": 1300, "height": 900})
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    skip_acell_gate(page)
    # A Handler signed in earlier this session (the shared Firebase mock's
    # handlerLogin checks for 'testpw').
    page.add_init_script("try { sessionStorage.setItem('dg_acell_pw', 'testpw'); } catch (e) {}")
    posts = []
    tap_acell_posts(page, lambda pl: posts.append(pl))
    install_notes_firestore_stub(page)
    st = {"bio": {"name": "Ines Cutter", "profession": "Federal Agent"}, "csStats": {"STR": 10}, "derived": {"hp": 10}}
    install_firestore_backend(page, {f"characters/{code}": dict(character_doc(code, st), incursion={"text": "Player wrote: the quarry.", "by": "player"})})
    page.goto(f"{BASE}/a-cell.html", wait_until="domcontentloaded", timeout=15000)
    wait_for_condition(lambda: any(l["path"] == "characters" for l in page.evaluate("() => window.__dgFirestoreListeners || []")), timeout_ms=8000)
    push_firestore_snapshot(page, "characters", [], [{"id": code, "character_json": json.dumps(st), "updated_at": "", "player_name": ""}])
    push_firestore_snapshot(page, "briefs", [], [{"id": code, "agent_code": code, "char_name": "Ines Cutter", "standing_orders_ack_at": "2026-10-01T07:00:00.000Z"}])
    push_firestore_snapshot(page, "cells", [], [])
    wait_for_condition(lambda: "Ines Cutter" in page.inner_text("#play-agent-list") or None, timeout_ms=8000)
    page.click("#acell-tab-strip .tw[data-tab=play]")  # v3.12.0: A-Cell opens on Session prep
    page.click("#play-agent-list .play-agent-btn:first-child")
    shown = wait_for_condition(lambda: page.evaluate("(c) => { const el = document.getElementById('pv-incursion-' + c); return el ? el.innerText : null; }", code), timeout_ms=8000) or ""
    record("incursion", "A-Cell's dossier shows the Agent's Incursion", "the quarry" in shown, shown)
    clr = page.evaluate("() => [].map.call(document.querySelectorAll('#play-view .pv-player'), e => e.textContent).join(' | ')")
    record("incursion", "A-Cell's dossier shows when the Agent accepted the clearance briefing", "accepted 2026-10-01" in clr, clr)
    page.click(f"#play-view [data-inc-edit='{code}']")
    page.fill(f"#pv-incursion-{code} [data-inc-text]", "Handler: it was the lighthouse, not the quarry.")
    page.click(f"#pv-incursion-{code} .pv-inc-save")
    after = wait_for_condition(lambda: (lambda t: t if "lighthouse" in t else None)(page.inner_text(f"#pv-incursion-{code}")), timeout_ms=8000) or ""
    record("incursion", "the Handler can amend it from A-Cell (set_incursion), marked as the Handler's",
           any(x.get("action") == "set_incursion" for x in posts) and "set by the Handler" in after, f"{after!r} {[x.get('action') for x in posts]}")
    rec = (fs_doc(page, f"characters/{code}") or {}).get("incursion") or {}
    record("incursion", "…written beside the sheet, so the player's autosave can't undo it",
           rec.get("by") == "handler" and "lighthouse" in rec.get("text", "") and json.loads((fs_doc(page, f"characters/{code}") or {}).get("character_json") or "{}").get("bio", {}).get("name") == "Ines Cutter", str(rec)[:160])
    errs_all.extend(errs)
    page.close()
    return errs_all

def test_main_photo_from_active_era(p):
    """A real report (Daniella Martinez): an Agent with two era Face
    Plates and an Active Era chosen showed no photo outside the Agent
    File's own era stack. Every other surface read only face_plate_url,
    a copy that was set in a few narrow cases. They now take the Active
    Era's own Plate (dgStore.mainPhoto), and opening the Agent File
    repairs the stored copy."""
    errs_all = []
    code = "DANI-0001"
    brief = {"agent_code": code, "char_name": "Daniella Martinez", "codename": "LARK",
             "player_name": "dani player", "player_name_lc": "dani player",
             "active_eras": '["90s","20s"]', "campaign_era": "20s", "face_plate_url": "",
             "era_90s_face_url": "https://example.test/dani-90s.png", "era_20s_face_url": "https://example.test/dani-20s.png"}
    # An Agent File from before per-era photos: an era label but no era
    # list, and its one photo only in face_plate_url. The rule above must
    # not read that as "Active Era has no photo" -- the portal's heal
    # would then wipe the only copy.
    legacy = "LEGA-0001"
    legacy_brief = {"agent_code": legacy, "char_name": "Lee Gacy", "codename": "OLDER",
                    "player_name": "legacy player", "player_name_lc": "legacy player",
                    "campaign_era": "1990s", "face_plate_url": "https://example.test/legacy.png"}
    docs = {f"briefs/{code}": brief, f"briefs/{legacy}": legacy_brief,
            f"characters/{code}": character_doc(code, {"v": 1, "bio": {"name": "Daniella Martinez", "player_name": "dani player"}}, "dani player")}
    page = p.new_page(viewport={"width": 1300, "height": 860})
    page.set_default_timeout(10000)
    errs = collect_errors(page)
    _block_fonts(page)
    route_apps_script_ok(page)
    page.route("https://example.test/**", lambda r: r.fulfill(status=200, content_type="image/png", body=b""))
    install_firestore_backend(page, docs)
    page.add_init_script("try { sessionStorage.setItem('dg_boot_seen', '1'); } catch (e) {}")
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.fill("#cover-identity-input", "dani player")
    page.click("#cover-identity-btn")
    roster = wait_for_condition(lambda: (json.loads(page.evaluate("localStorage.getItem('dg_agent_roster')") or "{}").get(code)), timeout_ms=8000) or {}
    record("photo", "Load My Agents takes the Active Era's Face Plate as the main photo when the flat copy is empty",
           roster.get("face_plate_url") == "https://example.test/dani-20s.png", str(roster.get("face_plate_url")))
    card = wait_for_condition(lambda: page.evaluate("() => { const i = document.querySelector('.paper-photo img'); return i ? i.getAttribute('src') : null; }"), timeout_ms=8000)
    record("photo", "the Agent Hub card shows that photo instead of 'Take Photo'", card == "https://example.test/dani-20s.png", str(card))
    page.evaluate("(c) => localStorage.setItem('dg_stats_cloud_code', c)", code)
    page.evaluate("() => { window.dgFieldNotes.refresh(); window.dgFieldNotes.open('agentfile'); }")
    nb = wait_for_condition(lambda: page.evaluate("() => { const i = document.querySelector('#fn-veil [data-as-photo] img'); return i ? i.getAttribute('src') : null; }"), timeout_ms=8000)
    record("photo", "the Field Notes Agent File shows it too", nb == "https://example.test/dani-20s.png", str(nb))
    errs_all.extend(errs)
    page.goto(f"{BASE}/dg-agent-portal.html?code={code}#cover", wait_until="domcontentloaded", timeout=15000)
    healed = wait_for_condition(lambda: (fs_doc(page, f"briefs/{code}") or {}).get("face_plate_url") or None, timeout_ms=10000)
    record("photo", "opening the Agent File repairs the stored main photo to the Active Era's Plate",
           healed == "https://example.test/dani-20s.png", str(healed))
    record("photo", "a pre-era-photos Agent File keeps face_plate_url as its main photo",
           page.evaluate("(b) => window.dgStore.mainPhoto(b)", legacy_brief) == "https://example.test/legacy.png", "")
    page.goto(f"{BASE}/dg-agent-portal.html?code={legacy}#cover", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_timeout(3500)
    kept = (fs_doc(page, f"briefs/{legacy}") or {}).get("face_plate_url")
    record("photo", "opening that Agent File leaves its only photo alone", kept == "https://example.test/legacy.png", str(kept))
    page.close()
    return errs_all

def test_agent_hub_folder_stack(p):
    """Agent Hub's tabs are a stack of manila folders (v3.4.0): up to six
    Agents, every Agent's folder stands in the stack, each tab in a
    different place from the one before it (thirds on a desktop, halves
    on a phone), the open one at the front; tapping a folder's tab opens
    it. Past six, the strip is + New Recruit, an "Agents (N)" folder that
    opens a list of every Agent, and the open Agent's folder -- at any
    width."""
    errs_all = []
    def setup(n, width):
        names = ["Charles Ward", "Daniela Martinez", "Eli Filagree", "Fay Orr", "Gus Lee", "Hana Ito", "Ivo Petrov"]
        roster = {}
        docs = _field_notes_docs()
        for k in range(n):
            c = "MENU-%04d" % (k + 1)
            roster[c] = {"code": c, "char_name": names[k], "codename": "SPARROW", "player_name": "g", "saved_at": n - k}
            docs["briefs/" + c] = {"agent_code": c, "char_name": names[k], "codename": "SPARROW", "player_name": "g", "player_name_lc": "g"}
        init = ("localStorage.removeItem('dg_cover_identity'); localStorage.setItem('dg_agent_roster', %s); "
                "localStorage.setItem('dg_fn_orders_ack', %s);") % (json.dumps(json.dumps(roster)), json.dumps(json.dumps({c: 1 for c in roster})))
        page, errs = _field_notes_page(p, width, 860, extra_init=init, docs=docs)
        last = "MENU-%04d" % n
        page.goto(f"{BASE}/agent-hub.html?code={last}", wait_until="domcontentloaded", timeout=15000)
        page.wait_for_selector(f'#tab-strip .tw.active[data-tab="{last}"]', state="attached", timeout=15000)
        page.wait_for_timeout(500)
        return page, errs
    # the visible folders' tabs, top of the stack first (the front one last)
    shown = """() => [...document.querySelectorAll('#tab-strip .tw')].filter(t => t.getClientRects().length).map(t => {
        const s = t.querySelector('span'), r = s.getBoundingClientRect();
        return { text: s.textContent.trim(), x: getComputedStyle(t).getPropertyValue('--x').trim(), active: t.classList.contains('active'),
                 l: r.left, r: r.right, t: r.top, b: r.bottom }; }).sort((a, b) => a.t - b.t)"""
    for width in (390, 1100):
        page, errs = setup(3, width)
        tabs = page.evaluate(shown)
        texts = [t["text"] for t in tabs]
        record("hub", f"{width}px, 3 Agents: every Agent's folder stands in the stack, the open one at the front, no menu",
               texts == ["+ New Recruit", 'Charles "SPARROW"', 'Daniela "SPARROW"', 'Eli "SPARROW"'] and tabs[-1]["active"]
               and not page.evaluate("() => !!document.querySelector('#tab-strip .tw-switch')"), str(texts))
        xs = [t["x"] for t in tabs]
        record("hub", f"{width}px: each tab stands in a different place from the one before it ({'halves' if width < 560 else 'thirds'})",
               all(a != b for a, b in zip(xs, xs[1:])) and set(xs) == ({"0%", "50%"} if width < 560 else {"0%", "33.3%", "66.6%"}), str(xs))
        overlap = any(a["l"] < b["r"] and b["l"] < a["r"] and a["t"] < b["b"] and b["t"] < a["b"] for i, a in enumerate(tabs) for b in tabs[i + 1:])
        record("hub", f"{width}px: no two handwritten tab labels overlap, and the page doesn't scroll sideways",
               not overlap and page.evaluate("() => document.documentElement.scrollWidth <= innerWidth"), "")
        page.click('#tab-strip .tw[data-tab="MENU-0001"] > span')
        page.wait_for_timeout(300)
        tabs = page.evaluate(shown)
        record("hub", f"{width}px: tapping a folder's tab opens that Agent and brings their folder to the front",
               tabs[-1]["text"] == 'Charles "SPARROW"' and tabs[-1]["active"]
               and page.evaluate("() => document.getElementById('panel-MENU-0001').classList.contains('active')"), str([t["text"] for t in tabs]))
        # + New Recruit open: it stands at the front, the stack stays one
        # piece (each tab 32px below the last), nothing rides up the page
        page.click('#tab-strip .tw-new > span')
        page.wait_for_timeout(300)
        tabs = page.evaluate(shown)
        steps = [round(b["t"] - a["t"]) for a, b in zip(tabs, tabs[1:])]
        strip_top = page.evaluate("() => document.getElementById('tab-strip').getBoundingClientRect().top")
        record("hub", f"{width}px: with + New Recruit open it stands at the front and the folders stay together",
               tabs[-1]["text"] == "+ New Recruit" and all(abs(d - 32) <= 2 for d in steps) and tabs[0]["t"] >= strip_top - 1, str(steps))
        errs_all.extend(errs); page.close()
    page, errs = setup(6, 390)
    record("hub", "six Agents still stand as a stack (no menu)",
           len(page.evaluate(shown)) == 7 and not page.evaluate("() => !!document.querySelector('#tab-strip .tw-switch')"), "")
    errs_all.extend(errs); page.close()
    for width in (390, 1280):
        page, errs = setup(7, width)
        texts = [t["text"] for t in page.evaluate(shown)]
        record("hub", f"{width}px, 7 Agents: the strip is + New Recruit, Agents (7) and the open Agent",
               texts == ["+ New Recruit", "Agents (7) ▾", 'Ivo "SPARROW"'], str(texts))
        page.click("#tab-strip .tw-switch > span")
        items = page.eval_on_selector_all(".ah-agent-menu button", "els => els.map(e => e.textContent + (e.getAttribute('aria-current') ? '*' : ''))")
        record("hub", f"{width}px: the Agents menu lists every Agent (the open one ticked) and + New Recruit",
               len(items) == 8 and items[6] == 'Ivo "SPARROW"*' and items[-1] == "+ New Recruit", str(items))
        page.click('.ah-agent-menu button[data-code="MENU-0002"]')
        page.wait_for_timeout(300)
        after = page.evaluate("() => [document.querySelector('#tab-strip .tw.active').dataset.tab, document.querySelector('.ah-agent-menu').hidden]")
        record("hub", f"{width}px: picking an Agent in the menu opens their file and closes the menu",
               after == ["MENU-0002", True] and page.evaluate(shown)[-1]["text"] == 'Daniela "SPARROW"', str(after))
        page.click("#tab-strip .tw-switch > span")
        page.keyboard.press("Escape")
        record("hub", f"{width}px: Escape closes the Agents menu", page.evaluate("() => document.querySelector('.ah-agent-menu').hidden"), "")
        errs_all.extend(errs); page.close()
    return errs_all

def test_physical_description_punctuation(p):
    """Agent Hub's short physical description (dgAgentSheet.physical)
    joins the Appearance answers into a sentence; an answer typed with
    its own full stop read "nearly black., eyes very pale blue-gray.."."""
    page = p.new_page()
    errs = collect_errors(page)
    page.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    page.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    page.goto(f"{BASE}/agent-hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function("() => window.dgAgentSheet && window.dgAgentSheet.physical", timeout=10000)
    got = page.evaluate("""() => window.dgAgentSheet.physical({ age_range: 'Early 40s', sex: 'Male', nationality: 'British.',
        build: 'extremely thin and elongated.', hair_color: 'dark brown to nearly black.', eye_color: 'very pale blue-gray.' })""")
    record("hub", "the physical description never doubles punctuation from answers that end in a full stop",
           got == "Early 40s male British. Build extremely thin and elongated, hair dark brown to nearly black, eyes very pale blue-gray.", got)
    got2 = page.evaluate("""() => window.dgAgentSheet.physical({ age_range: 'Mid 40s', sex: 'Male', nationality: 'American',
        build: 'Average build', hair_color: 'salt-and-pepper', eye_color: 'near-black eyes' })""")
    record("hub", "an answer that already names its noun ('Average build', 'near-black eyes') isn't given it twice",
           got2 == "Mid 40s male American. Average build, salt-and-pepper hair, near-black eyes.", got2)
    page.close()
    return errs

def test_field_notes_shell(p):
    """Inside the Hub shell: one notebook for the whole tab; the nav gains
    Friendly; on A-Cell the notebook steps aside and the Handler gets the
    radio pill and dice panel back; Requisition, opened directly, forwards
    into the notebook."""
    errs_all = []
    page, errs = _field_notes_page(p)
    skip_acell_gate(page)
    page.goto(f"{BASE}/hub.html", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_function("() => window.dgFieldNotes && window.dgFieldNotes.isHost", timeout=10000)
    labels = page.eval_on_selector_all("#dg-shell-nav button", "els => els.map(e => e.textContent.trim())")
    record("notebook-shell", "the Hub nav has Agent Hub, A-Cell and Friendly", labels == ["Agent Hub", "A-Cell", "Friendly"], str(labels))
    hub = None
    for _ in range(40):
        hub = next((f for f in page.frames if "agent-hub.html" in f.url), None)
        if hub: break
        page.wait_for_timeout(250)
    # The frame's URL shows before its scripts have run: wait for them, or
    # a busy run reads window.dgFieldNotes too early.
    if hub is not None:
        try: hub.wait_for_function("() => !!window.dgFieldNotes", timeout=10000)
        except Exception: pass
    record("notebook-shell", "no second notebook inside the shell's page",
           hub is not None and hub.evaluate("() => !document.getElementById('fn-root') && !!window.dgFieldNotes && !window.dgFieldNotes.isHost"), "")
    page.click("#dg-shell-nav button[data-nav-id=a-cell]")
    wait_for_condition(lambda: page.evaluate("() => document.getElementById('fn-root').hidden") or None, timeout_ms=10000)
    record("notebook-shell", "on A-Cell the notebook steps aside and the radio pill and dice panel come back",
           page.evaluate("() => document.getElementById('fn-root').hidden && getComputedStyle(document.getElementById('dg-radio')).opacity !== '0' && document.getElementById('dr-panel').parentNode === document.body"), "")
    page.click("#dg-shell-nav button[data-nav-id=friendly]")
    wait_for_condition(lambda: (not page.evaluate("() => document.getElementById('fn-root').hidden")) or None, timeout_ms=10000)
    record("notebook-shell", "Friendly gets the notebook", not page.evaluate("() => document.getElementById('fn-root').hidden"), "")
    errs_all.extend(errs)
    page.close()

    page, errs = _field_notes_page(p)
    page.goto(f"{BASE}/requisition.html?code={FN_CODE}", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_url("**/hub.html?fn=req", timeout=10000)
    opened = wait_for_condition(lambda: page.evaluate("() => !!(window.dgFieldNotes && window.dgFieldNotes.isOpen && window.dgFieldNotes.isOpen() && window.dgFieldNotes.view() === 'req')") or None, timeout_ms=10000)
    record("notebook-shell", "Requisition opened directly forwards into the notebook's Requisition pocket", bool(opened), page.url)
    errs_all.extend(errs)
    page.close()
    return errs_all

def test_friendly_clearance(p):
    """Friendly: a one-shot player picks a pregen and plays. Out of the box
    it must be at most three clicks from Clearance to a roll (it's two:
    the card, then an Agent), rolls must never be filed under whatever
    Agent this device's own roster happens to hold, and a pregen the
    Handler put in a Cell rolls into that Cell's feed."""
    errs = []
    page = p.new_page(viewport={"width": 390, "height": 844})
    errs += collect_errors(page)
    install_notes_firestore_stub(page)
    _block_fonts(page)
    route_apps_script_ok(page)
    page.add_init_script("""try {
      sessionStorage.setItem('dg_boot_seen', '1');
      localStorage.setItem('dg_agent_roster', JSON.stringify({'MARA-0001': {code: 'MARA-0001', char_name: 'Robert Wright', saved_at: 1}}));
    } catch (e) {}""")
    page.goto(f"{BASE}/index.html", wait_until="load", timeout=15000)
    clicks = 0
    page.click("a.cc-friendly"); clicks += 1
    page.wait_for_url("**/friendly.html", timeout=10000)
    _pump_until(page, lambda: page.locator(".fr-card").count() > 0)
    record("friendly", "Friendly card on Clearance opens the pregen picker", page.locator(".fr-card").count() > 0,
           page.inner_text("#fr-grid")[:120])
    record("friendly", "no Cell filter shown while no Cell holds a Friendly", not page.is_visible("#fr-toolbar"), "")
    page.locator(".fr-card").first.click(); clicks += 1
    page.wait_for_timeout(300)
    record("friendly", "an Agent is playable within three clicks of Clearance",
           clicks <= 3 and page.is_visible("#fr-view .pv-bio") and page.locator("#fr-skills .roll").count() > 10,
           f"clicks={clicks}")
    name = page.inner_text("#fr-view .pv-bio")
    zero = page.eval_on_selector_all("#fr-skills .sv", "els => els.filter(e => e.textContent === '0%').length")
    record("friendly", "0% skills are left off the sheet", zero == 0 and page.locator("#fr-skills .roll").count() > 10, str(zero))
    # The closed Field Notes notebook (dice, notebook) docks bottom-right
    # on a phone; the playable sheet must end above it.
    fit = page.evaluate("""() => {
      const bar = document.getElementById('fn-closed-phone').getBoundingClientRect();
      const more = document.querySelector('.fr-more > summary').getBoundingClientRect();
      const book = document.querySelector('#fn-closed-phone .fn-phone-book');
      const pr = book.getBoundingClientRect();
      const hit = document.elementFromPoint(pr.left + pr.width / 2, pr.top + pr.height / 2);
      return { moreBottom: more.bottom, barTop: bar.top, bookOnTop: !!hit && book.contains(hit),
               scrollX: document.documentElement.scrollWidth <= innerWidth };
    }""")
    record("friendly", "on a phone the whole playable sheet (stats, skills, weapons, Bonds) fits the first screen",
           fit["moreBottom"] <= fit["barTop"] and fit["scrollX"], str(fit))
    record("friendly", "on a phone the closed notebook is reachable, not under the sheet",
           fit["bookOnTop"], str(fit))
    page.click('#fr-skills .roll[data-label="Alertness"]')
    _pump_until(page, lambda: "Alertness" in page.inner_text("#dr-history-list"))
    hist = page.inner_text("#dr-history-list")
    record("friendly", "a skill tap rolls and lists under the pregen's name", "Alertness" in hist and name in hist, hist[:160])
    writes = page.evaluate("window.__dgFirestoreWrites.map(w => w.path + ':' + JSON.stringify(w.data || {}))")
    record("friendly", "a Friendly roll outside a Cell is never filed under this device's own Agent",
           not any("MARA-0001" in w or "dice_rolls" in w for w in writes), str(writes)[:200])
    record("friendly", "the roll shows in the roll slip, without covering the sheet with the notebook",
           page.evaluate("() => !document.getElementById('fn-peek').hidden && !window.dgFieldNotes.isOpen()"), "")
    page.click("#fr-view .pv-bio"); page.wait_for_timeout(200)
    record("friendly", "on a phone, tapping the sheet puts the roll slip away again",
           page.evaluate("() => document.getElementById('fn-peek').hidden"), "")
    dmg = page.locator("[data-damage]").first
    label = dmg.get_attribute("data-label")
    dmg.click()
    _pump_until(page, lambda: label in page.inner_text("#dr-history-list"))
    record("friendly", "weapon damage rolls its dice expression", label in page.inner_text("#dr-history-list"), page.inner_text("#dr-history-list")[:160])
    # A d% roll right after a damage roll must show on the dice, not just
    # in the history: rollExpr swapped the face to a d10 without changing
    # the selected die, so the next stat roll animated into the hidden
    # percentile face and left the damage d10 on screen.
    page.click('#fr-view .pv-stat[data-label^="POW"]')
    _pump_until(page, lambda: "POW" in page.inner_text("#dr-history-list"))
    page.wait_for_timeout(1200)
    face = page.evaluate("""() => {
      const pct = document.getElementById('dr-face-percent'), one = document.getElementById('dr-face-single');
      const top = document.querySelector('#dr-history-list').innerText.split('\\n').find(l => l.indexOf('POW') >= 0) || '';
      const m = top.match(/(\\d+)\\/\\d+/);
      const t = document.querySelector('#dr-tens .dr-face-num').textContent, u = document.querySelector('#dr-units .dr-face-num').textContent;
      return { pctShown: getComputedStyle(pct).display !== 'none', singleHidden: getComputedStyle(one).display === 'none',
               faceLabel: document.getElementById('dr-face-label').textContent, rolled: m ? +m[1] : null,
               shown: (t === '00' && u === '0') ? 100 : (+t + +u), activeBtn: (document.querySelector('.dr-die-btn-active') || {}).dataset?.die || null };
    }""")
    record("friendly", "a stat roll after a weapon damage roll shows its result on the percentile dice",
           face["pctShown"] and face["singleHidden"] and face["rolled"] == face["shown"] and face["activeBtn"] == "dpct", str(face))
    page.reload(wait_until="load")
    _pump_until(page, lambda: page.is_visible("#fr-view .pv-bio"))
    record("friendly", "a reload keeps this tab's Agent and its roll history",
           page.is_visible("#fr-view .pv-bio") and "Alertness" in page.inner_text("#dr-history-list"), "")
    record("friendly", "HP/WP/SAN are shown as starting values for the paper sheet, not editable",
           page.locator("#fr-view input").count() == 0 and "paper" in page.inner_text(".fr-paper-note"), "")
    page.close()

    # A Cell holding a Friendly: the filter appears preselected from the
    # Cell link, only that Cell's Friendlies show, and the roll lands in
    # dice_rolls/{cell}/rolls attributed to the pregen.
    pregens = json.load(open(os.path.join(HERE, "..", "friendly", "pregens.json")))["pregens"]
    pid = pregens[0]["id"]
    page = p.new_page(viewport={"width": 1280, "height": 900})
    errs += collect_errors(page)
    install_notes_firestore_stub(page)
    seed_cells_docs(page, [
        {"cell_id": "cell_oneshot", "name": "One-Shot Table", "handler": "H", "member_codes": [pid], "channel": ""},
        {"cell_id": "cell_regular", "name": "Night Shift", "handler": "H", "member_codes": ["MARA-0001"], "channel": ""},
    ])
    _block_fonts(page)
    route_apps_script_ok(page)
    page.goto(f"{BASE}/friendly.html?cell=cell_oneshot", wait_until="load", timeout=15000)
    _pump_until(page, lambda: page.is_visible("#fr-toolbar"))
    opts = page.eval_on_selector_all("#fr-cell-filter option", "os => os.map(o => o.textContent)")
    record("friendly", "the Cell filter lists only Cells that hold a Friendly, preselected from ?cell=",
           page.input_value("#fr-cell-filter") == "cell_oneshot" and "Night Shift" not in opts, str(opts))
    page.locator(".fr-card").first.click(); page.wait_for_timeout(300)
    record("friendly", "the dossier says rolls go to the Cell", "One-Shot Table" in page.inner_text(".pv-cell"), page.inner_text(".pv-cell"))
    page.locator("#fr-skills .roll").first.click()
    _pump_until(page, lambda: page.evaluate("window.__dgFirestoreWrites.some(w => w.path.indexOf('dice_rolls/cell_oneshot/rolls/') === 0)"))
    w = page.evaluate("(window.__dgFirestoreWrites.filter(w => w.path.indexOf('dice_rolls/') === 0)[0] || {}).data || null")
    record("friendly", "a Friendly in a Cell rolls into that Cell's feed as the pregen",
           bool(w) and w.get("agent_code") == pid, str(w)[:200])
    page.close()

    # Slow connection: pregens.json landing before dice-roller.js (a later
    # script) had downloaded used to skip the Cells read entirely, so the
    # Cell filter never appeared. Serve dice-roller.js 2.5s late.
    import threading, http.server, functools, socket
    class _Slow(http.server.SimpleHTTPRequestHandler):
        def do_GET(self):
            time.sleep(2.5)
            return super().do_GET()
        def log_message(self, *a):
            pass
    sock = socket.socket(); sock.bind(("127.0.0.1", 0)); slow_port = sock.getsockname()[1]; sock.close()
    slow = http.server.ThreadingHTTPServer(("127.0.0.1", slow_port), functools.partial(_Slow, directory=os.path.join(HERE, "..")))
    threading.Thread(target=slow.serve_forever, daemon=True).start()
    try:
        page = p.new_page(viewport={"width": 1280, "height": 900})
        errs += collect_errors(page)
        install_notes_firestore_stub(page)
        seed_cells_docs(page, [{"cell_id": "cell_oneshot", "name": "One-Shot Table", "handler": "H", "member_codes": [pid], "channel": ""}])
        _block_fonts(page)
        route_apps_script_ok(page)
        page.route("**/assets/dice-roller.js*", lambda r: r.fulfill(response=r.fetch(
            url=f"http://127.0.0.1:{slow_port}/assets/dice-roller.js")))
        page.goto(f"{BASE}/friendly.html?cell=cell_oneshot", wait_until="load", timeout=20000)
        _pump_until(page, lambda: page.is_visible("#fr-toolbar"))
        record("friendly", "the Cell filter still appears when dice-roller.js loads after the pregens",
               page.is_visible("#fr-toolbar") and page.input_value("#fr-cell-filter") == "cell_oneshot", "")
        page.close()
    finally:
        slow.shutdown()

    # A-Cell: a Handler can add Friendlies to a Cell, and gets its table link.
    page = p.new_page(viewport={"width": 1280, "height": 900})
    errs += collect_errors(page)
    install_notes_firestore_stub(page)
    _block_fonts(page)
    route_apps_script_ok(page)
    page.add_init_script("try { sessionStorage.setItem('dg_acell_unlocked', '1'); sessionStorage.setItem('dg_acell_pw', 'testpw'); } catch (e) {}")
    page.goto(f"{BASE}/a-cell.html", wait_until="load", timeout=15000)
    page.click('.tw[data-tab="cells"]')
    page.wait_for_timeout(500)
    _pump_until(page, lambda: page.evaluate(
        "(window.__dgFirestoreListeners || []).filter(l => l.path === 'cells' || l.path === 'characters').length >= 2"))
    push_firestore_snapshot(page, "characters", [], [])
    push_firestore_snapshot(page, "cells", [], [
        {"id": "cell_oneshot", "name": "One-Shot Table", "handler": "H", "member_codes": [pid], "channel": ""},
        {"id": "cell_new", "name": "Next Week", "handler": "H", "member_codes": [], "channel": ""},
    ])
    _pump_until(page, lambda: page.locator(".cell-card").count() == 2)
    one = page.locator(".cell-card", has_text="One-Shot Table")
    nxt = page.locator(".cell-card", has_text="Next Week")
    record("friendly", "A-Cell names a Friendly member instead of showing its raw code",
           "Friendly:" in one.inner_text() and pregens[0]["name"] in one.inner_text(), one.inner_text()[:160])
    record("friendly", "A-Cell shows the Cell's Friendly table link",
           one.locator('a[href*="friendly.html?cell=cell_oneshot"]').count() == 1, "")
    record("friendly", "A-Cell offers Friendlies in a Cell's add list",
           nxt.locator('optgroup[label^="Friendlies"] option[value="' + pid + '"]').count() == 1, "")
    page.close()

    # 62 dossiers: category chips narrow the picker, "Hand me a dossier"
    # deals from what's showing, and a damage entry that isn't dice or a
    # lethality % ("Stun") is text, not a button that does nothing.
    shipped = json.load(open(os.path.join(HERE, "..", "friendly", "pregens.json")))["pregens"]
    medics = [q for q in shipped if q["group"] == "Medical & Rescue"]
    page = p.new_page(viewport={"width": 390, "height": 844})
    errs += collect_errors(page)
    install_notes_firestore_stub(page)
    _block_fonts(page)
    route_apps_script_ok(page)
    page.goto(f"{BASE}/friendly.html", wait_until="load", timeout=15000)
    _pump_until(page, lambda: page.locator(".fr-chip").count() > 1)
    page.click('.fr-chip[data-group="Medical & Rescue"]')
    page.wait_for_timeout(150)
    record("friendly", "a category chip narrows the picker to that kind of Agent",
           page.locator(".fr-card").count() == len(medics) > 0, str(page.locator(".fr-card").count()))
    page.click("#fr-deal")
    page.wait_for_timeout(300)
    dealt = page.inner_text("#fr-view .pv-bio")
    record("friendly", "Hand me a dossier deals one Agent from the chosen category, in one tap",
           dealt in [q["name"] for q in medics], dealt)
    stun = next((q["id"] for q in shipped if any((w.get("damage") or "").lower() == "stun" for w in q["weapons"])), None)
    if stun:
        page.goto(f"{BASE}/friendly.html?agent={stun}", wait_until="load", timeout=15000)
        _pump_until(page, lambda: page.is_visible("#fr-view .pv-bio"))
        record("friendly", "a 'Stun' weapon shows its effect as text, not a button that rolls nothing",
               page.locator('[data-damage="stun"], [data-damage="Stun"]').count() == 0
               and "Stun" in page.inner_text(".fr-weapons").title(), "")
    page.close()

    # One page, every Agent: on a 390x844 phone, everything the player
    # rolls (stats, skills, weapons) must sit above the closed Field Notes
    # notebook's buttons without scrolling -- checked for all 62 so a data rebuild can't
    # quietly push one off the screen.
    page = p.new_page(viewport={"width": 390, "height": 844})
    errs += collect_errors(page)
    install_notes_firestore_stub(page)
    _block_fonts(page)
    route_apps_script_ok(page)
    over = []
    for q in shipped:
        page.goto(f"{BASE}/friendly.html?agent={q['id']}", wait_until="load", timeout=15000)
        _pump_until(page, lambda: page.is_visible("#fr-view .pv-bio"))
        m = page.evaluate("""() => {
          const q = s => document.querySelector(s);
          const wpn = q('.fr-weapons') || q('.fr-col-side .pv-text');
          return { bottom: Math.max(q('.fr-col-main').getBoundingClientRect().bottom, wpn ? wpn.getBoundingClientRect().bottom : 0),
                   bar: q('#fn-closed-phone').getBoundingClientRect().top, sw: document.documentElement.scrollWidth };
        }""")
        if m["bottom"] > m["bar"] or m["sw"] > 390:
            over.append((q["id"], round(m["bottom"] - m["bar"])))
    record("friendly", "on a phone, every Agent's rollable sheet fits the first screen (all 62)", not over, str(over[:6]))
    page.close()

    record("friendly", "no JS errors across the Friendly flow", not errs, "; ".join(errs)[:300])


def test_friendly_case_files(p):
    """The Friendly picker as open dossiers (v3.5.0): every pregen is a
    folder with its profession first on the typed sheet, the MORS ET
    SCIENTIA seal stamped in its group's ink on the flap, the group as a
    tab touching the folder's edge, and a pencilled remark on only some
    files. While choosing, the folder frame and its tabs are hidden; after
    a pick, "Back to ...'s file" returns to the dossier."""
    errs = []
    shipped = json.load(open(os.path.join(HERE, "..", "friendly", "pregens.json")))["pregens"]
    for width in (1280, 390):
        page = p.new_page(viewport={"width": width, "height": 900})
        errs += collect_errors(page)
        install_notes_firestore_stub(page)
        _block_fonts(page)
        route_apps_script_ok(page)
        page.goto(f"{BASE}/friendly.html", wait_until="load", timeout=15000)
        _pump_until(page, lambda: page.locator(".fr-card").count() == len(shipped))
        info = page.evaluate("""() => [...document.querySelectorAll('.fr-card')].map(c => {
            const seal = getComputedStyle(c.querySelector('.fc-seal')), tab = getComputedStyle(c.querySelector('.fc-right'), '::after');
            const right = c.querySelector('.fc-right').getBoundingClientRect();
            return { id: c.dataset.id, title: c.querySelector('.fc-title').firstChild.textContent, name: c.querySelector('.fc-name').textContent,
                     mask: (seal.webkitMaskImage || seal.maskImage || ''), ink: seal.backgroundColor, tab: tab.content, tabLeft: tab.left,
                     rightW: right.width, note: !!c.querySelector('.fc-note'), sr: c.style.getPropertyValue('--sr') }; })""")
        by = {q["id"]: q for q in shipped}
        record("friendly", f"{width}px: every pregen is a file with its profession heading the sheet and its name below",
               all(i["name"] == by[i["id"]]["name"] and i["title"] and i["title"] in by[i["id"]]["title"] for i in info), str(info[:1]))
        record("friendly", f"{width}px: the flap carries the MORS ET SCIENTIA seal, stamped in the group's ink",
               all("mors-scientia-seal.png" in i["mask"] for i in info) and len({i["ink"] for i in info}) == 6, str({i["ink"] for i in info}))
        record("friendly", f"{width}px: the seals don't all sit at the same angle",
               len({i["sr"] for i in info}) > 5, str({i["sr"] for i in info}))
        record("friendly", f"{width}px: the group tab touches the folder's edge",
               all(i["tab"] != "none" and abs(float(i["tabLeft"].rstrip("px")) - i["rightW"]) < 1 for i in info), str(info[0]["tabLeft"]) + " / " + str(info[0]["rightW"]))
        notes = sum(i["note"] for i in info)
        record("friendly", f"{width}px: a pencilled remark on only some files (about one in three)",
               8 <= notes <= len(info) // 2, f"{notes} of {len(info)}")
        record("friendly", f"{width}px: while choosing, no folder tabs above the files, and the page doesn't scroll sideways",
               page.evaluate("() => document.body.classList.contains('fr-picking') && !document.getElementById('fr-tab-strip').getClientRects().length && document.documentElement.scrollWidth <= innerWidth"), "")
        chips = page.eval_on_selector_all(".fr-chip", "els => els.map(e => e.firstChild.textContent)")
        record("friendly", f"{width}px: the group filter uses short names",
               chips == ["All", "Federal", "Tactical", "Military", "Intelligence", "Medical", "Civilian"], str(chips))
        if width == 390:
            first = page.locator(".fr-card").first
            name = first.locator(".fc-name").inner_text().strip()
            first.click()
            page.wait_for_selector("#fr-view .pv-bio", timeout=6000)
            look = page.evaluate("""() => { const t = document.querySelector('#fr-tab-strip .tw.active'), sp = t.querySelector('span');
                return { label: sp.textContent, font: getComputedStyle(sp).fontFamily, ink: getComputedStyle(sp).color,
                         body: getComputedStyle(document.querySelector('.folder-body')).backgroundImage }; }""")
            record("friendly", "the dossier stands in a manila folder: the Agent's surname handwritten on its tab in the group's ink",
                   look["label"] == name.split(" ")[-1] and "Reenie" in look["font"] and look["ink"] != "rgb(106, 92, 63)" and "url(" in look["body"], json.dumps(look)[:200])
            page.click("#fr-change")
            back = page.locator("#fr-back-dossier")
            record("friendly", "after a pick, 'Choose a different Agent' shows the files with a way back to the dossier",
                   back.is_visible() and name.split(" ")[-1] in back.inner_text(), back.inner_text())
            back.click()
            record("friendly", "...which goes back to that Agent's dossier",
                   page.evaluate("() => document.getElementById('panel-dossier').classList.contains('active') && !document.body.classList.contains('fr-picking')"), "")
        page.close()
    record("friendly", "no JS exceptions (case files)", not errs, "; ".join(errs[:3]))
    return errs

def test_friendly_pregen_builder(p=None):
    """scripts/pregens/build.js follows each Dossier's own notes: exactly
    the "Choose N" picks and the number of +20% bonus picks they allow
    (never past 80, never Unnatural), names the form's blank "Language"
    lines, picks an employer from the sheet's own dropdown, repairs the
    Unnatural/Unarmed Combat slip, leaves a sheet with no instructions as
    printed, stays deterministic, and publishes none of the notes' prose.
    The notes below are written for this test in the sheets' format."""
    import re, subprocess, tempfile

    def sheet(title, sid, notes, skills, **extra):
        rec = {
            "file": "x.pdf", "title": title, "id": sid, "profession": "Federal Agent",
            "employer": "", "employer_options": [], "name": "", "nationality": "", "sex": "", "age_dob": "",
            "education": "", "physical": "", "motivations": "", "wounds": "",
            "gear": "Badge and ID card, medium pistol in a belt holster, handcuffs, body armor.",
            "notes": notes, "developments": "",
            "stats": {"STR": 11, "CON": 12, "DEX": 10, "INT": 13, "POW": 12, "CHA": 11},
            "features": {k: "" for k in ["STR", "CON", "DEX", "INT", "POW", "CHA"]},
            "bonds": [{"name": "", "score": 11}, {"name": "", "score": 11}],
            "derived": {"hp": 12, "wp": 12, "san_max": 99, "san": 60, "bp": 48},
            "skills": [{"name": n, "base": b, "value": v} for n, b, v in skills],
            "specialties": [], "other_skills": [],
            "weapons": [{"name": "Pistol", "skill": 50, "range": "15 m", "damage": "1d10",
                         "ap": "", "kill_damage": "", "kill_radius": "", "ammo": "15"}],
            "special_training": [], "missing": ["name", "sex"],
        }
        rec.update(extra)
        return rec
    base_skills = [("Alertness", 20, 50), ("Criminology", 10, 50), ("Firearms", 20, 50), ("Forensics", 0, 30),
                   ("Law", 0, 30), ("Search", 20, 50), ("Accounting", 10, 10), ("Bureaucracy", 10, 40),
                   ("Computer Science", 0, 0), ("Pharmacy", 0, 0), ("Unarmed Combat", 40, 40), ("Unnatural", 0, 60)]
    notes_a = ("A test paragraph about the job. UNIQUE-VERBATIM-NOTES-TEXT\n\n"
               "Choose one additional skill from this list:\n» Accounting 60%\n» Computer Science 50%\n"
               "» Foreign Language (choose one) 50%\n\n"
               "Bonus skill points: Add +20% to each of any three skills (up to a maximum of 80%).")
    raw = [
        sheet("Federal Agent", "FR-FA", notes_a, base_skills,
              employer_options=["DOS - Bureau of Diplomatic Security", "FBI - Criminal Investigative Division"],
              other_skills=[{"name": "Language", "value": 40, "slot": 1}]),
        sheet("USSS - Personal Protective Detail", "FR-USSS-PPD", "Only a description, no instructions.",
              [("Alertness", 20, 60), ("HUMINT", 10, 80), ("Firearms", 20, 60)], employer="U.S. Secret Service"),
    ]
    root = os.path.join(HERE, "..")
    with tempfile.TemporaryDirectory() as d:
        src = os.path.join(d, "raw.json"); json.dump(raw, open(src, "w"))
        outs = []
        for i in range(2):
            out = os.path.join(d, f"out{i}.json")
            r = subprocess.run(["node", os.path.join(root, "scripts", "pregens", "build.js"), src, "-o", out],
                               capture_output=True, text=True, timeout=60)
            if r.returncode != 0:
                record("friendly", "pregen builder runs", False, r.stderr[:300]); return
            outs.append(open(out).read())
    data = json.loads(outs[0])
    pg = next(q for q in data["pregens"] if q["id"] == "FR-FA")
    ppd = next(q for q in data["pregens"] if q["id"] == "FR-USSS-PPD")
    record("friendly", "pregen builder is deterministic", outs[0] == outs[1], "")
    record("friendly", "pregen builder fills name, sex, age, nationality, education, physical, bonds, motivations",
           all([pg["name"], pg["sex"], pg["age"], pg["dob"], pg["nationality"], pg["education"], pg["physical"],
                len(pg["bonds"]) == 2 and all(b["name"] and b["relationship"] for b in pg["bonds"]), len(pg["motivations"]) == 3]),
           json.dumps({k: pg[k] for k in ("name", "sex", "age", "nationality", "bonds", "motivations")})[:300])
    record("friendly", "pregen builder keeps the sheet's own numbers",
           pg["derived"] == {"hp": 12, "wp": 12, "san": 60, "san_max": 99, "bp": 48} and pg["stats"]["INT"]["value"] == 13
           and all(b["score"] == 11 for b in pg["bonds"]), str(pg["derived"]))
    skills = {s["name"]: s["value"] for s in pg["skills"]}
    record("friendly", "pregen builder takes exactly one option from the sheet's 'Choose one' list",
           len(pg["chose"]) == 1 and re.match(r"^(Accounting 60%|Computer Science 50%|Foreign Language \(\w[\w ]*\) 50%)$", pg["chose"][0]),
           str(pg["chose"]))
    raised = {n: v for n, v in skills.items() if n in dict((x[0], x[2]) for x in base_skills) and v > dict((x[0], x[2]) for x in base_skills)[n]}
    record("friendly", "pregen builder adds exactly the three +20% bonus picks the notes allow, max 80, never Unnatural",
           len(pg["bonus"]["applied"]) == 3 and "Unnatural" not in pg["bonus"]["applied"]
           and all(v <= 80 for v in skills.values()), str(pg["bonus"]))
    record("friendly", "pregen builder repairs Unnatural typed into the sheet's Unarmed Combat line",
           skills.get("Unnatural") == 0 and skills.get("Unarmed Combat", 0) >= 60 and pg["fixes"], str(pg["fixes"]))
    langs = [n for n in skills if n.startswith("Foreign Language (")]
    record("friendly", "pregen builder names the form's blank 'Language' line",
           "Language" not in skills and any(skills[n] >= 40 for n in langs) and pg["filled"], str(langs))
    record("friendly", "pregen builder picks the employer from the sheet's own dropdown",
           pg["employer"] in ("DOS - Bureau of Diplomatic Security", "FBI - Criminal Investigative Division"), pg["employer"])
    record("friendly", "a sheet whose notes say nothing stays exactly as printed",
           {s["name"]: s["value"] for s in ppd["skills"]} == {"Alertness": 60, "HUMINT": 80, "Firearms": 60}
           and not ppd["chose"] and not ppd["bonus"]["applied"], str(ppd["bonus"]))
    record("friendly", "pregen builder never gives two Agents the same first name",
           pg["name"].split()[0] != ppd["name"].split()[0], pg["name"] + " / " + ppd["name"])
    record("friendly", "pregen builder publishes no verbatim sheet notes",
           "UNIQUE-VERBATIM-NOTES-TEXT" not in outs[0] and "Bonus skill points" not in outs[0], "")
    record("friendly", "pregen builder lists the catalog's unextracted sheets as pending",
           "Federal Agent" not in data["pending"] and len(data["pending"]) == 60, str(len(data["pending"])))
    # The shipped data itself: every pregen carries what the page reads.
    shipped = json.load(open(os.path.join(root, "friendly", "pregens.json")))
    bad = [q["id"] for q in shipped["pregens"] if not (q["name"] and q["skills"] and q["stats"] and q["bonds"]
                                                       and re.match(r"^[A-Z0-9-]{3,32}$", q["id"]))]
    record("friendly", "friendly/pregens.json: every pregen is complete and its id is a valid Agent Code",
           shipped["pregens"] and not bad, str(bad))
    record("friendly", "friendly/pregens.json carries all 62 Agent Dossiers, none pending",
           len(shipped["pregens"]) == 62 and not shipped["pending"], str(len(shipped["pregens"])))
    over = [(q["id"], s["name"], s["value"]) for q in shipped["pregens"] for s in q["skills"]
            if s["value"] > 80 or (s["name"] == "Unnatural" and s["value"])]
    record("friendly", "friendly/pregens.json: no skill above 80% and no Unnatural on any pregen", not over, str(over[:5]))


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
        #
        # executable_path is opt-in via DG_TEST_CHROMIUM_PATH, not
        # hardcoded -- a fixed sandbox path (e.g. /opt/pw-browsers/chromium,
        # this file's previous value) only exists in the specific dev
        # environment it was written for. Every CI run failed on this
        # exact line for that reason: `playwright install` puts Chromium
        # in Playwright's own default cache location, which isn't that
        # path, so leaving executable_path unset and letting Playwright
        # resolve its own install is what actually works both there and
        # in any environment that ran `playwright install` normally.
        launch_kwargs = {"args": [
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
        ]}
        chromium_path = os.environ.get("DG_TEST_CHROMIUM_PATH", "")
        if chromium_path:
            launch_kwargs["executable_path"] = chromium_path
        browser = p.chromium.launch(**launch_kwargs)

        # Real bug found via a live report: ~30 of the test functions below
        # never set up their own page.route("**/script.google.com/**", ...)
        # mock. Any of those that name-fills a character (most do, using
        # shared fixture names like "Priya Anand") triggers cloud-sync.js's
        # real debounced auto-save, which happily hits the ACTUAL production
        # Apps Script backend and writes a real row into the live
        # Characters sheet. Harmless in this sandbox, where that hostname is
        # already unreachable by network policy (confirmed: those same
        # unmocked tests already pass today against a blocked network) --
        # but GitHub Actions CI has full internet access and runs this exact
        # suite on every push to main/firebase-migration, so it's been
        # doing this for real on every single CI run, which is almost
        # certainly the actual source of the "hundreds of dummy agents"
        # reported live. Patching new_page() here, once, for every test's
        # page -- rather than fixing 30 individual call sites -- so this
        # can never regress if a 31st test is added without its own mock.
        # A test that DOES set up its own more specific route later simply
        # overrides this: Playwright resolves the most-recently-registered
        # handler first, and none of the existing per-test mocks below call
        # route.fallback(), so they fully take over instead of chaining.
        # Same, for Firebase: the pages read and write Firestore (and call
        # Cloud Functions) directly now that the Sheet is retired, so an
        # unstubbed page in CI would otherwise sign in to and write the
        # LIVE project. Every production Firebase/Google API host is
        # aborted for every test page; tests use the in-page Firestore
        # stub (install_notes_firestore_stub) instead.
        LIVE_FIREBASE_HOSTS = re.compile(
            r"^https://([a-z0-9-]+\.)?(firestore\.googleapis\.com|identitytoolkit\.googleapis\.com|"
            r"securetoken\.googleapis\.com|firebasestorage\.googleapis\.com|firebaseinstallations\.googleapis\.com|"
            r"cloudfunctions\.net|storage\.googleapis\.com)/")
        _real_new_page = browser.new_page
        # And every page gets the in-page Firestore stub by default: the
        # pages talk to Firestore from their first second now, so an
        # unstubbed page would load the real SDK (unreachable from a
        # sandbox) and then fail against the blocked hosts above -- a
        # console error in every test that never cared about Firebase.
        # new_page(real_firebase=True) opts out.
        # Player tours (assets/tour.js) would start by themselves over
        # every test's page: off unless a test asks for them (tours=True).
        TOURS_OFF = "try { if (!sessionStorage.getItem('dg_tours_test_on')) localStorage.setItem('dg_tours_off', '1'); } catch (e) {}"
        def _new_page_blocking_live_backend(*a, **kw):
            real_firebase = kw.pop("real_firebase", False)
            tours = kw.pop("tours", False)
            page = _real_new_page(*a, **kw)
            if not tours:
                page.add_init_script(TOURS_OFF)
            page.route("**/script.google.com/**", lambda route: route.abort())
            page.route(LIVE_FIREBASE_HOSTS, lambda route: route.abort())
            if not real_firebase:
                install_notes_firestore_stub(page)
            return page
        browser.new_page = _new_page_blocking_live_backend
        # Same for pages opened from a test's own browser context.
        _real_new_context = browser.new_context
        def _new_context_blocking_live_backend(*a, **kw):
            ctx = _real_new_context(*a, **kw)
            _ctx_new_page = ctx.new_page
            def _ctx_page(*pa, **pkw):
                real_firebase = pkw.pop("real_firebase", False)
                tours = pkw.pop("tours", False)
                page = _ctx_new_page(*pa, **pkw)
                if not tours:
                    page.add_init_script(TOURS_OFF)
                page.route("**/script.google.com/**", lambda route: route.abort())
                page.route(LIVE_FIREBASE_HOSTS, lambda route: route.abort())
                if not real_firebase:
                    install_notes_firestore_stub(page)
                return page
            ctx.new_page = _ctx_page
            return ctx
        browser.new_context = _new_context_blocking_live_backend

        # DG_TEST_ONLY=test_a,test_b runs just those tests (same browser
        # setup, same live-backend blocking as a full run).
        only = set(filter(None, os.environ.get("DG_TEST_ONLY", "").split(",")))
        def safe(fn, *args, area="unknown"):
            if only and fn.__name__ not in only:
                return None
            try:
                return fn(*args)
            except Exception as e:
                record(area, f"{fn.__name__} crashed", False, str(e)[:200])
                return None


        safe(test_player_pages_use_in_page_dialogs, browser, area="journey")
        safe(test_field_id_forgery, browser, area="forgery")
        safe(test_employer_dropdown, browser, area="employer")
        safe(test_fabricate_civic_kinds, browser, area="fabricate-kinds")
        safe(test_agent_file_profession_employer_line, browser, area="agent-file")
        safe(test_acell_id_creator, browser, area="id-creator")
        safe(test_hub_folder_switches_notebook_agent, browser, area="notebook")
        safe(test_friendly_clearance, browser, area="friendly")
        safe(test_friendly_case_files, browser, area="friendly")
        safe(test_field_notes_notebook, browser, area="notebook")
        safe(test_field_notes_round3, browser, area="notebook")
        safe(test_field_notes_popup_pager, browser, area="notebook")
        safe(test_field_notes_page_taps_act_once, browser, area="notebook")
        safe(test_field_id_fabricator_in_notebook, browser, area="notebook")
        safe(test_agent_hub_one_page_file, browser, area="hub")
        safe(test_incursion, browser, area="incursion")
        safe(test_physical_description_punctuation, browser, area="hub")
        safe(test_agent_hub_folder_stack, browser, area="hub")
        safe(test_main_photo_from_active_era, browser, area="photo")
        safe(test_field_notes_shell, browser, area="notebook-shell")
        safe(test_friendly_pregen_builder, browser, area="friendly")
        safe(test_dice_roller_phone_not_dragged_by_scroll, browser, area="dice-roller")
        safe(test_hub_dice_roller_learns_agent_from_iframe, browser, area="dice-roller")
        safe(test_agent_file_storage_plates_and_refresh, browser, area="journey")
        safe(test_auto_created_brief_uses_titles_and_player, browser, area="journey")
        safe(test_profiling_edit_keeps_agent_file, browser, area="journey")
        safe(test_notes_first_block_saves_under_rules, browser, area="notes")


        safe(test_cover_ids_tab, browser, area="cover-ids-tab")

        safe(test_hub_boot_splash, browser, area="hub")

        safe(test_hub_clearance_branches, browser, area="hub")

        safe(test_hub_clearance_lands_in_shell, browser, area="hub")

        safe(test_hub_cover_identity_veil, browser, area="hub")

        safe(test_agent_hub, browser, area="hub")

        safe(test_agent_hub_cover_identity, browser, area="hub")

        safe(test_agent_hub_erase_agent, browser, area="hub")
        safe(test_player_name_survives_profiling_and_load_my_agents, browser, area="hub")

        safe(test_agent_hub_kia_stamp, browser, area="hub")

        safe(test_agent_hub_recruit_flag, browser, area="hub")

        safe(test_agent_hub_handouts, browser, area="hub")

        safe(test_agent_hub_handout_notes, browser, area="hub")

        safe(test_agent_hub_dex_postit, browser, area="hub")

        safe(test_acell_gate, browser, area="acell")

        safe(test_acell_play, browser, area="acell")
        safe(test_acell_handler_session_race, browser, area="acell")
        safe(test_acell_sheet_loads_once_when_opened, browser, area="acell")
        safe(test_acell_evidence_folders_read_firestore, browser, area="acell")
        safe(test_agent_hub_checks_read_firestore, browser, area="hub")
        safe(test_notes_operations_read_firestore, browser, area="notes")

        safe(test_acell_cells, browser, area="acell")

        safe(test_acell_evidence, browser, area="acell")
        safe(test_acell_evidence_share_languages_format, browser, area="acell")
        safe(test_evidence_gallery, browser, area="gallery")
        safe(test_evidence_tags, browser, area="evidence-tags")
        safe(test_player_tours, browser, area="tours")
        safe(test_edit_cancel_after_live_update, browser, area="agent-file")
        safe(test_acell_evidence_pdf, browser, area="acell")
        safe(test_acell_evidence_create_verify_retries, browser, area="acell")

        safe(test_acell_sheet, browser, area="acell")
        safe(test_acell_session_notes, browser, area="acell-notes")
        safe(test_acell_shell, browser, area="acell-shell")
        safe(test_acell_library, browser, area="acell-library")
        safe(test_acell_players_file, browser, area="acell-players")
        safe(test_acell_play_desk, browser, area="acell-play")
        safe(test_acell_debrief, browser, area="acell-debrief")
        safe(test_acell_phone, browser, area="acell-phone")
        safe(test_acell_mobile_shell, browser, area="acell-mobile")
        safe(test_acell_mobile_backfill, browser, area="acell-mobile")
        safe(test_acell_mobile_sessions, browser, area="acell-mobile")
        safe(test_acell_mobile_play, browser, area="acell-mobile-play")
        safe(test_acell_mobile_agents, browser, area="acell-mobile-agents")
        safe(test_acell_mobile_notes, browser, area="acell-mobile-notes")
        safe(test_acell_mobile_panels, browser, area="acell-mobile-panels")
        safe(test_vault_sync_rules, browser, area="vault-sync")
        safe(test_acell_console, browser, area="acell-console")
        safe(test_acell_mobile_typing_kept, browser, area="acell-mobile")
        safe(test_acell_mobile_waiting, browser, area="acell-mobile")
        safe(test_acell_hear_here, browser, area="acell-hear")
        safe(test_acell_vault_format, browser, area="acell-vault-fmt")
        safe(test_acell_desk_player, browser, area="acell-desk-player")
        safe(test_acell_link_suggest, browser, area="acell-links")
        safe(test_acell_mobile_release, browser, area="acell-mobile-play")
        safe(test_acell_mobile_decks, browser, area="acell-mobile")
        safe(test_acell_session_notes_desk, browser, area="acell-notes")
        safe(test_acell_tape_steps_once, browser, area="acell-tapes")
        safe(test_acell_in_shell, browser, area="acell-shell-hub")
        safe(test_player_pages_never_get_the_handler_feed, browser, area="dice")
        safe(test_handler_rolls_filter_by_cell, browser, area="dice")
        safe(test_stinger_files_exist, browser, area="radio")

        safe(test_acell_music, browser, area="acell")

        safe(test_acell_music_broadcast_error_not_clobbered, browser, area="acell")
        safe(test_acell_music_scrubber_follows_broadcast, browser, area="acell")

        safe(test_acell_soundboard, browser, area="acell")

        safe(test_acell_music_backend_not_deployed, browser, area="acell")

        safe(test_table_radio_widget, browser, area="radio")

        safe(test_table_radio_audio_volume, browser, area="radio")

        safe(test_table_radio_mix_debug_readout, browser, area="radio")

        safe(test_table_radio_debug_readout_shows_ambient_and_stinger_state, browser, area="radio")
        safe(test_table_radio_short_stinger_plays_from_its_start, browser, area="radio")

        safe(test_table_radio_plays_while_audio_context_locked, browser, area="radio")
        safe(test_table_radio_new_track_starts_without_a_tap, browser, area="radio")
        safe(test_table_radio_main_track_gain_only_with_cors, browser, area="radio")

        safe(test_table_radio_finished_track_does_not_restart_from_beginning, browser, area="radio")

        safe(test_table_radio_debug_readout_present_before_tuning_in, browser, area="radio")

        safe(test_table_radio_pause_and_loop, browser, area="radio")

        safe(test_table_radio_unprompted_pause_auto_resumes, browser, area="radio")

        safe(test_table_radio_audio_syncs_to_live_position, browser, area="radio")

        safe(test_table_radio_library_track_kind, browser, area="radio")

        safe(test_table_radio_yt_volume_reliability, browser, area="radio")


        safe(test_shell_content_swap_preserves_hoisted_widgets, browser, area="shell")

        safe(test_shell_nav_tracks_in_page_navigation, browser, area="shell")

        safe(test_shell_back_link_hidden_inside_shell, browser, area="shell")

        safe(test_page_back_link_visible_standalone, browser, area="shell")

        safe(test_shell_hides_widgets_for_notes_popover, browser, area="shell")

        safe(test_agent_portal_code_query_param, browser, area="agent-portal")

        safe(test_agent_portal_profiling_gate, browser, area="agent-portal")


        safe(test_mobile_no_overflow, browser, area="mobile")

        codes = []
        for agent in AGENTS:
            res = safe(test_agent_portal_cover, browser, agent, area="agent-portal")
            codes.append(res[1] if res else None)

        safe(test_agent_portal_random_generator_matches_sex, browser, area="agent-portal")

        safe(test_agent_portal_incomplete_submit_blocked, browser, area="agent-portal")

        safe(test_agent_portal_submit_reuses_roster_code, browser, area="agent-portal")

        safe(test_agent_file_vitals_and_bonds, browser, area="agent-portal")

        safe(test_agent_file_era_prompt_includes_era, browser, area="agent-portal")

        safe(test_agent_file_era_prompts_isolated_per_era, browser, area="agent-portal")

        safe(test_agent_file_era_age_adjusts_per_era, browser, area="agent-portal")

        safe(test_agent_file_medical_aar_archived, browser, area="agent-portal")

        safe(test_agent_file_active_era_toggle, browser, area="agent-portal")

        safe(test_agent_file_outfit_plate_requires_face_first, browser, area="agent-portal")

        safe(test_agent_roster, browser, area="agent-roster")

        for agent in AGENTS[:2]:
            safe(test_id_creator, browser, agent, area="id-creator")

        safe(test_noindex, browser, area="noindex")

        safe(test_pwa_offline, browser, area="pwa")

        safe(test_pwa_update_banner, browser, area="pwa")

        safe(test_notes_pwa_update_banner, browser, area="pwa")

        safe(test_notes_v2_editorjs, browser, area="notes")
        safe(test_notes_evidence_integration, browser, area="notes")

        safe(test_notes_evidence_photo_loading_indicator, browser, area="notes")

        safe(test_notes_reload_shows_own_previous_blocks, browser, area="notes")
        safe(test_notes_code_url_param, browser, area="notes")
        safe(test_notes_solo_mode_for_unassigned_agent, browser, area="notes")

        safe(test_split_view_retired, browser, area="notebook")
        safe(test_cell_members_by_name_and_kia, browser, area="hub")
        safe(test_add_bond_in_play, browser, area="bonds")
        safe(test_agent_file_san_roll_and_member_cards, browser, area="agent-file")
        safe(test_agent_file_v2_play_and_edit, browser, area="agent-file-v2")
        safe(test_field_notes_split, browser, area="notebook")
        safe(test_agent_file_brief_read_recovers, browser, area="agent-file")
        safe(test_agent_file_parts_and_looks, browser, area="agent-file-parts")
        safe(test_new_recruit_wizard, browser, area="recruit")
        safe(test_new_recruit_imports_and_links, browser, area="recruit-import")
        safe(test_sheet_io_real_files, browser, area="sheet-io")
        safe(test_recruit_play_test_round1, browser, area="recruit-fix")
        safe(test_agent_file_wear, browser, area="wear")
        safe(test_agent_file_disorder_stamps, browser, area="disorders")
        safe(test_appearance_carries_over_from_sheet, browser, area="appearance")
        safe(test_insane_struck_like_kia, browser, area="insane")
        safe(test_plate_save_survives_a_dropped_connection, browser, area="plates")
        safe(test_bond_at_zero_struck, browser, area="bonds")
        safe(test_notebook_flip_agents, browser, area="flip")
        safe(test_evidence_sort, browser, area="evidence")
        safe(test_notes_tags_quick_and_arrange, browser, area="notes-tags")
        safe(test_notes_tags_headings_and_quick, browser, area="notes-tags")
        safe(test_agent_rules_unit, browser, area="rules")
        safe(test_evidence_attachments_open_and_zoom, browser, area="evidence")
        safe(test_motivations_and_disorders_split, browser, area="disorders")


        safe(test_dice_roller_firestore_native_cell, browser, area="dice-roller")

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
