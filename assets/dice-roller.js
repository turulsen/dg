/**
 * Animated Multi-Die Roller
 *
 * Dice: d4, d6, d8, d10, d12, d20, d% (percentile)
 * Percentile mode shows two d10 faces + DG result tiers.
 * All other dice show a single animated face.
 * Draggable, collapsible, theme-aware.
 *
 * Included on every player-reachable Hub page (same treatment Table
 * Radio already got in Phase 2), backed by a live Firestore history --
 * dice_rolls/{cellId}/rolls/{rollId}, no existing Sheets data to
 * migrate (rolling was never persisted anywhere before this). Every
 * roll from EITHER entry point (a skill/stat tap on the Agent File via
 * dgDice.roll, or the manual panel -- percentile target OR a dice expression
 * like 2d6+3) writes one history entry once its animation lands; see
 * recordRoll() below, called from rollDie()'s and rollExpr()'s own
 * onDone(). An Agent's own rolls always work regardless of Firestore
 * (recordRoll() is fire-and-forget, same tolerance the rest of this
 * migration uses -- a failed/skipped write never blocks the roll
 * itself from animating and showing a result).
 *
 * Identity: an Agent Code is read from the current Agent
 * (dg_stats_cloud_code), else the most recently active entry in the
 * shared Cover Identity roster -- never a new prompt. A-Cell has no single "current Agent"
 * (it's the Handler's own page), so it gets a read-only Live Rolls
 * feed across every Cell instead of roll controls tied to one Agent;
 * see isHandlerContext() below. Signing into Firestore for an Agent is
 * automatic (exchangeAgentToken needs only the Agent Code, no
 * password -- see functions/index.js's own comment on why that's not
 * a new hole); the Handler feed is opt-in behind one button + the same
 * Handler password A-Cell already gates on, entered once and cached by
 * Firebase Auth's own session persistence from then on -- deliberately
 * NOT wired into A-Cell's existing login form, to avoid touching that
 * already-critical, actively-used code path for a secondary viewing
 * feature.
 *
 * Friendly (friendly.html, one-shot pregens): the page marks itself with
 * <html data-dice-friendly> and says who is rolling through
 * dgDice.setIdentity({ code, name, cellId }) -- never this device's own
 * roster, which may belong to someone else entirely. With a cellId (the
 * Handler put that pregen in a Cell) rolls go to that Cell's feed like
 * any Agent's; without one they stay on this device (session only).
 */
(function () {
    'use strict';

    // Same reasoning as table-radio.js's own guard, right next to it in
    // every page that includes both -- inside the app shell (hub.html),
    // the shell owns one hoisted copy of this widget outside
    // #dg-shell-content entirely; a page loaded *into* that iframe must
    // not also mount its own (this widget's #dr-panel is also
    // position:fixed, landing on top of the shell's real one). Null on
    // every standalone visit and for any other embedding -- same-origin
    // only, so this can't misfire cross-origin. A suppressed instance
    // still relays its rolls (dgDice.roll) up to the page that has the
    // panel, via postMessage -- see rollPercent().
    const FRIENDLY_PAGE_OWN = document.documentElement.hasAttribute('data-dice-friendly');
    // A frame marked data-dg-embed is one of the Field Notes notebook's
    // own embedded pages (Requisition, desktop Notes) -- same rule as the
    // shell: the page that hosts the notebook owns the one Dice panel.
    const SUPPRESS_OWN_PANEL = !!(window.frameElement &&
        (window.frameElement.id === 'dg-shell-content' || window.frameElement.hasAttribute('data-dg-embed')));
    // Friendly (friendly.html) loaded INSIDE the Hub shell: that page's
    // own copy of this script is suppressed, so it relays its pregen
    // identity up here (see setIdentity()) and this, the shell's copy,
    // rolls as that pregen until the shell navigates elsewhere.
    let _relayedFriendly = false;
    function isFriendly() { return FRIENDLY_PAGE_OWN || _relayedFriendly; }

    /* ── Dice config ──────────────────────────────────────────────── */
    const DICE = [
        { id: 'd4', sides: 4, label: 'D4' },
        { id: 'd6', sides: 6, label: 'D6' },
        { id: 'd8', sides: 8, label: 'D8' },
        { id: 'd10', sides: 10, label: 'D10' },
        { id: 'd12', sides: 12, label: 'D12' },
        { id: 'd20', sides: 20, label: 'D20' },
        { id: 'dpct', sides: 100, label: 'D%' },
    ];

    // O(1) die config lookup — avoids Array.find() on every roll/selection
    const DICE_MAP = new Map(DICE.map(d => [d.id, d]));

    // Hoisted constant — avoids per-selectDie array allocation
    const SHAPE_CLASSES = ['dr-shape-d4', 'dr-shape-d6', 'dr-shape-d8', 'dr-shape-d10', 'dr-shape-d12', 'dr-shape-d20'];

    /* ── Die wireframe SVGs (stroke='currentColor' picks up theme colour) ── */
    const DIE_SVGS = {
        d4: `<svg viewBox='0 0 100 100' fill='none' xmlns='http://www.w3.org/2000/svg'><polygon points='50,5 95,90 5,90' stroke='currentColor' stroke-width='5' stroke-linejoin='round'/><line x1='50' y1='5' x2='50' y2='90' stroke='currentColor' stroke-width='1.5' stroke-opacity='0.45'/></svg>`,
        d6: `<svg viewBox='0 0 100 100' fill='none' xmlns='http://www.w3.org/2000/svg'><polygon points='50,5 91,28 91,72 50,95 9,72 9,28' stroke='currentColor' stroke-width='5' stroke-linejoin='round'/><line x1='50' y1='5' x2='50' y2='50' stroke='currentColor' stroke-width='1.5' stroke-opacity='0.5'/><line x1='91' y1='28' x2='50' y2='50' stroke='currentColor' stroke-width='1.5' stroke-opacity='0.5'/><line x1='9' y1='28' x2='50' y2='50' stroke='currentColor' stroke-width='1.5' stroke-opacity='0.5'/></svg>`,
        d8: `<svg viewBox='0 0 100 100' fill='none' xmlns='http://www.w3.org/2000/svg'><polygon points='50,4 96,50 50,96 4,50' stroke='currentColor' stroke-width='5' stroke-linejoin='round'/><line x1='4' y1='50' x2='96' y2='50' stroke='currentColor' stroke-width='1.5' stroke-opacity='0.5'/></svg>`,
        d10: `<svg viewBox='0 0 100 100' fill='none' xmlns='http://www.w3.org/2000/svg'><polygon points='50,4 93,38 74,96 26,96 7,38' stroke='currentColor' stroke-width='5' stroke-linejoin='round'/><line x1='7' y1='38' x2='93' y2='38' stroke='currentColor' stroke-width='1.5' stroke-opacity='0.5'/><line x1='50' y1='4' x2='50' y2='38' stroke='currentColor' stroke-width='1.5' stroke-opacity='0.4'/></svg>`,
        d12: `<svg viewBox='0 0 100 100' fill='none' xmlns='http://www.w3.org/2000/svg'><polygon points='50,4 96,36 78,93 22,93 4,36' stroke='currentColor' stroke-width='5' stroke-linejoin='round'/><polygon points='50,28 74,46 66,73 34,73 26,46' stroke='currentColor' stroke-width='1.5' stroke-opacity='0.55' stroke-linejoin='round'/></svg>`,
        d20: `<svg viewBox='0 0 100 100' fill='none' xmlns='http://www.w3.org/2000/svg'><polygon points='50,4 91,27 91,73 50,96 9,73 9,27' stroke='currentColor' stroke-width='5' stroke-linejoin='round'/><polygon points='50,4 91,73 9,73' stroke='currentColor' stroke-width='1.5' stroke-opacity='0.6' stroke-linejoin='round'/></svg>`,
    };

    let _activeDie = 'dpct';   // default to percentile
    let _rolling = false;
    // True while the face shows an expression roll (rollExpr: "D10+1",
    // weapon damage) rather than _activeDie. rollExpr swaps the face
    // without changing _activeDie, so the next plain roll has to put the
    // selected die's face back first -- otherwise a d% roll animates
    // into the hidden percentile face and the stale d10 stays on screen.
    let _exprShown = false;
    let _e = null;     // cached DOM nodes, populated after buildPanel

    /* ── Percentile result tiers (Delta Green Agent's Handbook pp.44-45) ── */
    // Critical Success: 01 always, OR matching dice (11,22,33,44) on a success
    // Fumble:           00/100 always, OR matching dice (55,66,77,88,99) on a failure
    function evaluate(roll, target) {
        if (!target || target <= 0) return null;
        if (roll === 1) return { tier: 'critical', label: 'CRITICAL SUCCESS', color: '#ffd700' };
        if (roll === 100) return { tier: 'fumble', label: 'FUMBLE', color: '#ff1744' };
        const tens = Math.floor(roll / 10);
        const units = roll % 10;
        if (tens === units) {
            if (roll <= target) return { tier: 'critical', label: 'CRITICAL SUCCESS', color: '#ffd700' };
            return { tier: 'fumble', label: 'FUMBLE', color: '#ff1744' };
        }
        if (roll <= target) return { tier: 'success', label: 'SUCCESS', color: '#69f0ae' };
        return { tier: 'failure', label: 'FAILURE', color: '#ff6d00' };
    }

    /* ── Animation helpers ────────────────────────────────────────── */
    const FRAMES = 16, FAST = 38, SLOW = 75;

    // Accepts a cached element reference directly — no querySelector inside tick loop
    function animateSingle(el, sides, finalVal, onDone) {
        if (!el) { onDone?.(); return; }
        const numEl = el.querySelector('.dr-face-num') || el;
        let f = 0;
        function step() {
            if (f < FRAMES) {
                numEl.textContent = Math.floor(Math.random() * sides) + 1;
                el.classList.add('dr-spin');
                setTimeout(() => el.classList.remove('dr-spin'), FAST - 8);
                f++;
                setTimeout(step, f > FRAMES - 4 ? SLOW : FAST);
            } else {
                numEl.textContent = finalVal;
                el.classList.add('dr-land');
                setTimeout(() => el.classList.remove('dr-land'), 420);
                onDone?.();
            }
        }
        step();
    }

    function animatePercent(finalRoll, onDone) {
        const { tens, units, tensNum, unitsNum } = _e;
        if (!tens || !units) { onDone?.(); return; }
        let f = 0;
        const fTens = finalRoll === 100 ? '00' : String(Math.floor(finalRoll / 10) * 10).padStart(2, '0');
        const fUnits = finalRoll === 100 ? '0' : String(finalRoll % 10);
        function step() {
            if (f < FRAMES) {
                const r = Math.floor(Math.random() * 100) + 1;
                tensNum.textContent = r === 100 ? '00' : String(Math.floor(r / 10) * 10).padStart(2, '0');
                unitsNum.textContent = r === 100 ? '0' : String(r % 10);
                tens.classList.add('dr-spin');
                units.classList.add('dr-spin');
                // One combined timeout instead of two (halves timer callbacks per frame)
                setTimeout(() => { tens.classList.remove('dr-spin'); units.classList.remove('dr-spin'); }, FAST - 8);
                f++;
                setTimeout(step, f > FRAMES - 4 ? SLOW : FAST);
            } else {
                tensNum.textContent = fTens;
                unitsNum.textContent = fUnits;
                tens.classList.add('dr-land');
                units.classList.add('dr-land');
                setTimeout(() => { tens.classList.remove('dr-land'); units.classList.remove('dr-land'); }, 420);
                onDone?.();
            }
        }
        step();
    }

    /* ── Switch active die ────────────────────────────────────────── */
    function selectDie(id) {
        _activeDie = id;
        _exprShown = false;
        _e.dieBtns.forEach(b => b.classList.toggle('dr-die-btn-active', b.dataset.die === id));
        const isPct = id === 'dpct';
        _e.faceSingle.style.display = isPct ? 'none' : 'flex';
        _e.facePct.style.display = isPct ? 'flex' : 'none';
        const cfg = DICE_MAP.get(id);
        if (_e.faceLabel) _e.faceLabel.textContent = cfg ? cfg.label : '';
        resetResult();
        const shapeId = isPct ? 'd10' : id;
        _e.faceDivs.forEach(el => {
            el.classList.remove(...SHAPE_CLASSES);
            el.classList.add(`dr-shape-${shapeId}`);
            const svgWrap = el.querySelector('.dr-die-svg-wrap');
            if (svgWrap) svgWrap.innerHTML = DIE_SVGS[shapeId] || DIE_SVGS.d10;
        });
        if (_e.nameEl) _e.nameEl.textContent = '';
        if (_e.manualEl && id !== 'dpct') _e.manualEl.value = '';
    }

    function resetResult() {
        const { resultLabel, resultBox, targetDisp, singleNum, tensNum, unitsNum, breakdownEl } = _e;
        if (resultLabel) { resultLabel.textContent = ''; resultLabel.style.color = ''; }
        if (resultBox) resultBox.className = 'dr-result-box';
        if (targetDisp) targetDisp.textContent = '';
        if (singleNum) singleNum.textContent = '--';
        if (tensNum) tensNum.textContent = '--';
        if (unitsNum) unitsNum.textContent = '--';
        if (breakdownEl) breakdownEl.textContent = '';
    }

    /* ════════════════════════════════════════════════════════════════
       Firebase / history bridge (Phase 3). Everything in this block is
       additive and best-effort -- nothing here can prevent a die from
       rolling or a result from showing, even if Firestore is fully
       unreachable. See this file's own header comment for the design.
       ════════════════════════════════════════════════════════════════ */
    const FIREBASE_SDK_VERSION = '12.18.0';
    const FIREBASE_CONFIG = {
        apiKey: 'AIzaSyBiFBvgmrjtacxXvh7FHa9a28BbwV0LnDQ',
        authDomain: 'dg-app-b3447.firebaseapp.com',
        projectId: 'dg-app-b3447',
        storageBucket: 'dg-app-b3447.firebasestorage.app',
        messagingSenderId: '464997490443',
        appId: '1:464997490443:web:dad47a347ae7a64a9e4c0e'
    };
    const ROSTER_KEY = 'dg_agent_roster';
    const CLOUD_CODE_KEY = 'dg_stats_cloud_code';
    // Was 'dg_acell_session' -- the old Apps Script Handler session token,
    // removed by the Handler auth unification (see BUGFIXES.md). Nothing
    // has set it since, so isHandlerContext() was false everywhere: the
    // Handler's Live Rolls feed never started, and a Handler's own rolls
    // were treated as whichever Agent that device last opened. A-Cell's
    // Clearance gate IS the Handler login now, and it sets
    // dg_acell_unlocked only after handlerLogin succeeds.
    const ACELL_SESSION_KEY = 'dg_acell_unlocked';
    // Set alongside dg_acell_unlocked by a-cell.html's own login success
    // handler -- reused here to sign into Live Rolls silently, same
    // pattern a-cell.html's own ensureHandlerSignedIn() already uses for
    // Evidence/Track Library (see attemptSilentHandlerSignIn() below).
    const ACELL_PW_KEY = 'dg_acell_pw';
    const HISTORY_LIMIT = 25;

    /* ── On-demand Firebase script loading -- same pattern as the
       YouTube/SoundCloud API loaders in table-radio.js. Loads app+
       firestore only if some other widget on this page (Table Radio)
       hasn't already; always ensures auth+functions on top, since
       neither of those is something Table Radio needs. ── */
    let firebaseApiLoading = false;
    let firebaseApiCallbacks = []; // { ok, err } pairs
    // s.onload with no s.onerror at all meant a script that failed to
    // load -- blocked, a dropped mobile connection, a flaky CDN response
    // -- left this whole chain hung forever, neither resolved nor
    // rejected: no error, no retry, this widget stuck mid-render with
    // whatever it had drawn so far. Real live report, 2026-09-11:
    // repeating cross-origin-obscured "Script error." on a mobile
    // connection, this exact widget stuck mid-screen. Same fix as
    // a-cell.html's own loadScriptTag(). crossOrigin is set so a real
    // future throw from inside this script shows its actual message
    // instead of the generic one that report saw.
    function loadScript(src, cb, onerror) {
        const s = document.createElement('script');
        s.crossOrigin = 'anonymous';
        s.src = src;
        let done = false;
        const timer = setTimeout(() => {
            if (done) return; done = true;
            onerror(new Error('Timed out loading ' + src + ' (15s) -- check network connection.'));
        }, 15000);
        s.onload = () => { if (done) return; done = true; clearTimeout(timer); cb(); };
        s.onerror = () => { if (done) return; done = true; clearTimeout(timer); onerror(new Error('Failed to load ' + src + ' -- check network connection.')); };
        // One copy of each Firebase SDK file per page: reuse a tag another
        // widget already added (loaded, or still loading) instead of adding
        // a second -- two copies of firebase-app-compat.js left every
        // Firestore call on the page hanging (BUGFIXES.md, Sheet retired).
        var dgPrev = Array.prototype.filter.call(document.scripts, function (x) { return x !== s && x.src === s.src && x.dataset.dgFailed !== '1'; })[0];
        if (dgPrev) {
          if (dgPrev.dataset.dgLoaded === '1') { if (s.onload) s.onload(); return; }
          dgPrev.addEventListener('load', function () { if (s.onload) s.onload(); }, { once: true });
          dgPrev.addEventListener('error', function () { if (s.onerror) s.onerror(); }, { once: true });
          return;
        }
        s.addEventListener('load', function () { s.dataset.dgLoaded = '1'; });
        s.addEventListener('error', function () { s.dataset.dgFailed = '1'; });
        document.head.appendChild(s);
    }
    function ensureFirebaseApi(cb, onerror) {
        const ready = () => window.firebase && window.firebase.firestore && window.firebase.auth && window.firebase.functions;
        if (ready()) { cb(); return; }
        firebaseApiCallbacks.push({ ok: cb, err: onerror || (() => {}) });
        if (firebaseApiLoading) return;
        firebaseApiLoading = true;
        const base = 'https://www.gstatic.com/firebasejs/' + FIREBASE_SDK_VERSION + '/';
        const needApp = !(window.firebase && window.firebase.firestore);
        function fail(err) {
            firebaseApiLoading = false; // lets a later call actually retry once the network recovers
            const cbs = firebaseApiCallbacks; firebaseApiCallbacks = [];
            cbs.forEach(pair => pair.err(err));
        }
        const afterCore = () => {
            if (!window.firebase.apps.length) {
                window.firebase.initializeApp(FIREBASE_CONFIG);
                // Brave (and some ad-blocker extensions) silently blocks
                // Firestore's default streaming transport (WebChannel) --
                // it looks like a long-lived tracking connection -- which
                // leaves every onSnapshot() listener permanently stuck
                // with zero data and no error at all. Falls back to
                // plain HTTP long-polling, which isn't blocked. See
                // a-cell.html's own copy of this comment for the full
                // report that traced this down (worked in Safari,
                // silently empty in Brave).
                //
                // REVERTED 2026-09-14, mid-live-session: see
                // agent-hub.html's matching comment -- forcing
                // long-polling for everyone caused ~44s to start audio
                // and ~10s to pause on Table Radio, badly outweighing the
                // rare Brave/ad-blocker case it was meant to fix.
                window.firebase.firestore().settings({ experimentalAutoDetectLongPolling: true });
            }
            loadScript(base + 'firebase-auth-compat.js', () => {
                // Real live report: Handler-gated reads/writes started
                // failing with "Missing or insufficient permissions"
                // mid-session, as often as every couple of minutes --
                // root cause: Firebase Auth's DEFAULT persistence
                // (browserLocalPersistence) is shared across every open
                // tab of this origin via IndexedDB, so any tab signing
                // in as an Agent (this page) silently evicts a Handler
                // session signed in from a-cell.html in another tab, and
                // vice versa. SESSION persistence keeps each tab's
                // sign-in local to that tab. Must be set before any
                // sign-in call -- see a-cell.html's own copy of this
                // comment for the full mechanism.
                window.firebase.auth().setPersistence(window.firebase.auth.Auth.Persistence.SESSION).catch(err => {
                    console.error('dice-roller: could not set SESSION auth persistence (falling back to default, cross-tab-shared behavior)', err);
                }).then(() => {
                    loadScript(base + 'firebase-functions-compat.js', () => {
                        const cbs = firebaseApiCallbacks; firebaseApiCallbacks = [];
                        cbs.forEach(pair => pair.ok());
                    }, fail);
                });
            }, fail);
        };
        if (needApp) {
            loadScript(base + 'firebase-app-compat.js', () => loadScript(base + 'firebase-firestore-compat.js', afterCore, fail), fail);
        } else {
            afterCore();
        }
    }

    function friendlyIdentity() {
        return isFriendly() ? (window.dgDiceIdentity || null) : null;
    }
    const LOCAL_HISTORY_KEY = 'dg_friendly_rolls';
    function readLocalHistory() {
        try { return JSON.parse(sessionStorage.getItem(LOCAL_HISTORY_KEY) || '[]'); } catch (e) { return []; }
    }
    function pushLocalHistory(entry) {
        const list = [entry].concat(readLocalHistory()).slice(0, HISTORY_LIMIT);
        try { sessionStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(list)); } catch (e) { /* private mode */ }
        renderHistoryList(list);
    }

    function isHandlerContext() {
        // A table's shared tablet can still hold the Handler's A-Cell
        // session in this tab -- the Friendly page is never the Handler's feed.
        if (isFriendly()) return false;
        let signedIn = false;
        try { signedIn = !!sessionStorage.getItem(ACELL_SESSION_KEY); } catch (e) { return false; }
        return signedIn && onHandlerPage();
    }
    // The Handler's feed (every Cell's rolls, no dice) belongs on A-Cell
    // only. A tab that once logged into A-Cell used to turn the roller
    // into it on every page: on a shared tablet the players' own Field
    // Notes then showed all tables' rolls and no dice. Anywhere else
    // the roller is the current Agent's, Handler session or not. In the
    // Hub shell this copy lives in the outer page, so it asks what the
    // content frame is showing (the mode watcher re-asks as it changes).
    function onHandlerPage() {
        const isACell = p => /(^|\/)a-cell\.html$/.test(p || '');
        if (isACell(location.pathname)) return true;
        try {
            const f = document.getElementById('dg-shell-content');
            if (f && f.contentWindow) return isACell(f.contentWindow.location.pathname);
        } catch (e) { /* not same-origin: not ours */ }
        return false;
    }

    // A-Cell's real login flow is: the page loads (this panel builds
    // itself immediately, before anyone has signed in, so isHandlerContext()
    // reads false and the panel renders as a normal Agent panel) *then*
    // the Handler types the A-Cell password into A-Cell's own login card,
    // which only afterwards sets dg_acell_unlocked. Nothing here ever
    // re-checked that after the panel had already been built once --
    // rechecking it here on a light poll and rebuilding from scratch
    // when it flips is simpler and more robust than trying to hook into
    // A-Cell's own login success callback (which this file deliberately
    // stays out of -- see this file's header comment).
    let _lastHandlerMode = null;
    function watchHandlerModeChange() {
        setInterval(() => {
            if (!_e || !_e.panel || !_e.panel.isConnected) return;
            const nowHandler = isHandlerContext();
            if (nowHandler === _lastHandlerMode) return;
            stopHistoryFeed();
            _rollContext = null;
            _rollContextPromise = null;
            _authPromise = null;
            _e.panel.remove();
            buildPanel();
            initHistory();
        }, 1500);
    }

    // Highest priority: the current Agent (dg_stats_cloud_code, set by the
    // notebook's Agent card and by New Recruit). Falls back to the shared
    // Cover Identity roster's most-recently-active Agent -- same
    // precedence notes/index.html uses for the same "who am I on this
    // page" question.
    function currentAgentCode() {
        if (isFriendly()) return (friendlyIdentity() || {}).code || '';
        try {
            const direct = localStorage.getItem(CLOUD_CODE_KEY);
            if (direct) return direct;
        } catch (e) { /* best effort */ }
        try {
            const roster = JSON.parse(localStorage.getItem(ROSTER_KEY) || '{}');
            const agents = Object.values(roster).sort((a, b) => (b.saved_at || 0) - (a.saved_at || 0));
            return (agents[0] && agents[0].code) || '';
        } catch (e) { return ''; }
    }

    function soloCellId(agentCode) {
        return 'solo:' + agentCode;
    }

    // The current Agent's name, from the roster (kept in sync on every save).
    function currentAgentName() {
        if (isFriendly()) return (friendlyIdentity() || {}).name || '';
        try {
            const code = currentAgentCode();
            const roster = JSON.parse(localStorage.getItem(ROSTER_KEY) || '{}');
            return (code && roster[code] && roster[code].char_name) || '';
        } catch (e) { return ''; }
    }

    // Resolved once per page load and cached -- an Agent's Cell doesn't
    // change mid-session, and re-querying on every single roll would be
    // wasteful. { mode: 'agent', agentCode, cellId } | { mode: 'handler' }
    // | { mode: 'none' } (no Agent Code known yet on this device --
    // rolling still works, just isn't persisted).
    //
    // Used to resolve this via the legacy list_cells JSONP action (Sheet-
    // backed) -- live report: "Roll not saved: permission-denied" for an
    // Agent actually in a real, current Cell. Root cause: Cells now
    // create/delete straight in Firestore (a-cell.html's
    // createCellFirestore_(), Phase 2 Sheets-removal) with no Sheet row
    // at all, so list_cells (which only ever reads the Sheet) can't see
    // them -- findCellForAgent() came back null for any Cell made since
    // that migration, and for an OLDER Sheet-only cell_id that no longer
    // has a matching Firestore doc, isCellMember()'s own get() on that
    // doc throws inside the security rule, which Firestore treats as a
    // denied rule, not a fallthrough -- permission-denied, not just a
    // wrong cellId. firestore.rules already makes `cells` public-read
    // (see isCellMember()'s own comment there), so reading it directly
    // needs no Handler/Agent session either, same as list_cells never did.
    // An 'agent'/'handler' outcome is safe to cache for the session (an
    // Agent's own identity and Cell don't change mid-visit) but 'none'
    // only ever means "not resolvable YET" (the current Agent can be set
    // moments after page load), not "never" -- so it's deliberately
    // excluded from the cache and retried fresh on every call, cheap
    // since it's just two synchronous localStorage reads.
    let _rollContext = null;
    let _rollContextPromise = null;
    let _rollContextFor = ''; // the Agent Code the current/in-flight resolution is for
    function resolveRollContext() {
        if (_rollContextPromise) return _rollContextPromise;
        if (isFriendly()) {
            const id = friendlyIdentity();
            if (!id || !id.code || !id.cellId) {
                _rollContext = { mode: 'local' };
                return Promise.resolve(_rollContext);
            }
            _rollContextFor = id.code;
            _rollContext = { mode: 'agent', agentCode: id.code, cellId: id.cellId, pinned: true };
            _rollContextPromise = Promise.resolve(_rollContext);
            return _rollContextPromise;
        }
        if (!isHandlerContext() && !currentAgentCode()) {
            _rollContext = { mode: 'none' };
            return Promise.resolve(_rollContext);
        }
        _rollContextFor = isHandlerContext() ? '' : currentAgentCode();
        _rollContextPromise = new Promise(resolve => {
            if (isHandlerContext()) {
                _rollContext = { mode: 'handler' };
                resolve(_rollContext);
                return;
            }
            const agentCode = currentAgentCode();
            const finish = cellId => {
                _rollContext = { mode: 'agent', agentCode: agentCode, cellId: cellId || soloCellId(agentCode) };
                resolve(_rollContext);
            };
            ensureFirebaseApi(() => {
                window.firebase.firestore().collection('cells').get().then(snap => {
                    let found = null;
                    snap.forEach(doc => {
                        if (found) return;
                        const members = doc.data().member_codes || [];
                        if (members.indexOf(agentCode) !== -1) found = doc.id;
                    });
                    finish(found);
                }).catch(() => finish(null));
            }, () => finish(null));
        });
        return _rollContextPromise;
    }

    /* ── Firebase sign-in. Agent side is fully automatic (no password
       -- exchangeAgentToken mints a token from the Agent Code alone,
       see functions/index.js). Handler side is opt-in, prompted once
       from the History section's own "Show Live Rolls" button -- kept
       deliberately separate from A-Cell's existing password gate
       rather than hooking into that already-critical login flow. ── */
    let _authPromise = null;
    let _authedCode = null;
    function ensureAgentSignedIn(agentCode) {
        // Was cached with no per-Agent key at all -- once ANY agent
        // signed in via this widget, every later call (even for a
        // different agentCode, e.g. this same page embedded for a
        // different Agent) resolved with that first identity instead
        // of re-authenticating. Same class of bug as the `uid` check
        // just below: both let a stale/wrong identity silently stand
        // in for the one actually being requested.
        // Cached, but the page's own saves (dg-store.js) share this one
        // Firebase sign-in and may have switched it to another Agent since:
        // check who is signed in now, or the roll is refused by the rules.
        if (_authPromise && _authedCode === agentCode) {
            return _authPromise.then(u => {
                const cur = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;
                if (cur && (cur.uid === agentCode || cur.uid === 'handler')) return cur;
                _authPromise = null;
                return ensureAgentSignedIn(agentCode);
            });
        }
        _authedCode = agentCode;
        _authPromise = new Promise((resolve, reject) => {
            ensureFirebaseApi(() => {
                const auth = window.firebase.auth();
                function reauth() {
                    window.firebase.functions().httpsCallable('exchangeAgentToken')({ agent_code: agentCode })
                        .then(result => auth.signInWithCustomToken(result.data.token))
                        .then(cred => resolve(cred.user))
                        .catch(err => { _authPromise = null; reject(err); });
                }
                // Firebase Auth sessions persist per-origin across page
                // loads (IndexedDB, not per-page) -- a bare
                // `if (auth.currentUser)` trusted whoever happened to
                // already be signed in (a different Agent, or the
                // Handler, from this same browser having viewed another
                // page earlier). exchangeAgentToken sets the token's uid
                // to the Agent Code itself, so checking it costs nothing
                // and catches exactly this case.
                //
                // uid alone isn't enough, though -- same root cause as
                // a-cell.html's ensureHandlerSignedIn() (see that
                // function's own comment): this fast path can keep being
                // taken indefinitely once a device has ever signed in as
                // this Agent Code even once, since Firebase Auth's own
                // session persists across page loads independent of
                // anything this app tracks. If that first sign-in
                // happened before functions/index.js's
                // ensurePersistedClaims_() existed, the agentCode claim
                // was never actually persisted, and every silent token
                // refresh since then regenerates from that same
                // claims-less record -- permission-denied on every
                // claim-gated write (recordRoll() below, the Live Rolls
                // feed), with no reload ever reaching the fix.
                // getIdTokenResult() reads the already-cached token's
                // decoded claims locally (no extra round trip), and
                // self-heals permanently the first time it forces one
                // real exchangeAgentToken() call.
                if (auth.currentUser && auth.currentUser.uid === agentCode) {
                    auth.currentUser.getIdTokenResult().then(result => {
                        if (result.claims && result.claims.agentCode === agentCode) { resolve(auth.currentUser); return; }
                        reauth();
                    }).catch(reauth);
                    return;
                }
                reauth();
            }, err => { _authPromise = null; reject(err); });
        });
        return _authPromise;
    }
    function signInAsHandler(password) {
        return new Promise((resolve, reject) => {
            ensureFirebaseApi(() => {
                const auth = window.firebase.auth();
                window.firebase.functions().httpsCallable('handlerLogin')({ handler_password: password })
                    .then(result => auth.signInWithCustomToken(result.data.token))
                    .then(cred => resolve(cred.user))
                    .catch(reject);
            }, reject);
        });
    }

    // Every finished roll, to this page and to the pages framed in it (the
    // Agent File marks a failed skill, takes a rolled SAN loss): a
    // 'dg-dice-result' event with the roll as its detail.
    function announceResult(rollData) {
        try { window.dispatchEvent(new CustomEvent('dg-dice-result', { detail: rollData })); } catch (e) { /* old engine */ }
        try {
            document.querySelectorAll('iframe').forEach(f => {
                try { if (f.contentWindow) f.contentWindow.postMessage({ type: 'dg-dice-result', detail: rollData }, location.origin); } catch (e) { /* gone */ }
            });
        } catch (e) { /* no frames */ }
    }
    // A framed page whose rolls go up to the top page's roller hears the
    // results back from it.
    window.addEventListener('message', e => {
        if (e.origin !== location.origin || window.top === window) return;
        if (e.data && e.data.type === 'dg-dice-result') announceResult(e.data.detail);
    });

    // Best-effort: any failure anywhere in this chain (no context yet,
    // sign-in rejected, Firestore write rejected) is swallowed -- the
    // roll already happened and already showed its result on screen
    // before this is even called; history is a nice-to-have layered on
    // top, never a gate on rolling itself.
    function recordRoll(rollData) {
        announceResult(rollData);
        resolveRollContext().then(ctx => {
            if (ctx.mode === 'local') {
                pushLocalHistory(Object.assign({ agent_name: currentAgentName() || 'Friendly', created_at: Date.now() }, rollData));
                return;
            }
            if (ctx.mode !== 'agent') return;
            const doc = Object.assign({
                agent_code: ctx.agentCode,
                agent_name: currentAgentName(),
                created_at: Date.now(),
            }, rollData);
            const write = () => ensureAgentSignedIn(ctx.agentCode).then(() =>
                window.firebase.firestore().collection('dice_rolls').doc(ctx.cellId).collection('rolls').add(doc));
            // Refused once (signed in as another Agent a moment ago): sign in again, try again.
            return write().catch(err => {
                if (!err || err.code !== 'permission-denied') throw err;
                _authPromise = null;
                return write();
            });
        }).catch(err => {
            showHistoryError('Roll not saved', err);
        });
    }

    /* ── History feed rendering ──────────────────────────────────────
       Agent mode: live onSnapshot on this Agent's own Cell subcollection.
       Handler mode: live onSnapshot on a collectionGroup('rolls') query
       across every Cell (isHandler() grants that read -- see
       firestore.rules), opt-in behind the button below. ── */
    let _historyUnsubscribe = null;
    function relativeTime(ms) {
        const diff = Math.max(0, Date.now() - ms);
        const s = Math.floor(diff / 1000);
        if (s < 60) return 'just now';
        const m = Math.floor(s / 60);
        if (m < 60) return m + 'm ago';
        const h = Math.floor(m / 60);
        if (h < 24) return h + 'h ago';
        return Math.floor(h / 24) + 'd ago';
    }
    function tierColor(tier) {
        if (tier === 'critical') return '#ffd700';
        if (tier === 'fumble') return '#ff1744';
        if (tier === 'success') return '#69f0ae';
        if (tier === 'failure') return '#ff6d00';
        return '';
    }
    function rollSummaryText(r) {
        if (r.roll_type === 'percent') {
            const tierPart = r.tier ? ' — ' + r.tier.toUpperCase() : '';
            return (r.label || 'Roll') + ': ' + r.value + (r.target ? '/' + r.target : '') + tierPart;
        }
        if (r.roll_type === 'expr') {
            return (r.label ? r.label + ': ' : '') + r.expr + ' = ' + r.value;
        }
        return (r.label ? r.label + ': ' : '') + r.value;
    }
    function renderHistoryList(entries) {
        const list = _e.historyList;
        if (!list) return;
        if (!entries.length) {
            list.innerHTML = '<div class="dr-history-empty">No rolls yet.</div>';
            return;
        }
        list.innerHTML = entries.map(r => {
            const color = r.tier ? tierColor(r.tier) : '';
            const cellTag = r.cellName ? ' <span class="dr-history-cell">[' + escapeHtml(r.cellName) + ']</span>' : '';
            return '<div class="dr-history-row">' +
                '<span class="dr-history-agent">' + escapeHtml(r.agent_name || r.agent_code || '?') + '</span>' + cellTag +
                '<span class="dr-history-summary"' + (color ? ' style="color:' + color + '"' : '') + '>' + escapeHtml(rollSummaryText(r)) + '</span>' +
                '<span class="dr-history-time">' + relativeTime(r.created_at) + '</span>' +
                '</div>';
        }).join('');
    }
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
    }
    // A phone has no DevTools console within easy reach -- surfacing the
    // actual error code/message right in the history panel (instead of
    // only console.error) turns "still doesn't work" reports into
    // something actionable without needing a tethered debugger session.
    function showHistoryError(context, err) {
        console.error('dice-roller: ' + context, err);
        if (!_e || !_e.historyList) return;
        const detail = (err && (err.code || err.message)) || String(err);
        _e.historyList.innerHTML = '<div class="dr-history-empty">' + escapeHtml(context + ': ' + detail) + '</div>';
    }
    function stopHistoryFeed() {
        if (_historyUnsubscribe) { _historyUnsubscribe(); _historyUnsubscribe = null; }
    }
    function startAgentHistoryFeed(ctx) {
        stopHistoryFeed();
        const db = window.firebase.firestore();
        let rollsUnsub = null;
        const listenRolls = () => {
            if (rollsUnsub) rollsUnsub();
            rollsUnsub = db.collection('dice_rolls').doc(ctx.cellId).collection('rolls')
                .orderBy('created_at', 'desc').limit(HISTORY_LIMIT)
                .onSnapshot(snap => {
                    const entries = [];
                    snap.forEach(doc => entries.push(doc.data()));
                    renderHistoryList(entries);
                }, err => showHistoryError('History feed error', err));
        };
        listenRolls();
        if (ctx.pinned) { _historyUnsubscribe = () => { if (rollsUnsub) rollsUnsub(); }; return; }
        // The Cell was looked up once, when this context resolved -- so a
        // player the Handler added to a Cell mid-session (the normal way a
        // new player joins) kept rolling into, and reading, their solo
        // feed until they happened to reload. Follow cells live instead
        // (public read, same "first Cell that lists this Agent" rule as
        // resolveRollContext()); ctx is the
        // shared _rollContext object, so recordRoll() follows too.
        const cellsUnsub = db.collection('cells').onSnapshot(snap => {
            let found = null;
            snap.forEach(doc => {
                if (found) return;
                if ((doc.data().member_codes || []).indexOf(ctx.agentCode) !== -1) found = doc.id;
            });
            const next = found || soloCellId(ctx.agentCode);
            if (next !== ctx.cellId) { ctx.cellId = next; listenRolls(); }
        }, () => { /* keep the Cell resolved at start */ });
        _historyUnsubscribe = () => { if (rollsUnsub) rollsUnsub(); cellsUnsub(); };
    }
    // Cell docs' own `name` field ("Test", "H-Cell"...) vs. the id doc
    // path segments actually are (cell_<timestamp>_<rand>) -- fetched
    // once and cached rather than per-row, since a campaign realistically
    // has a handful of Cells, not thousands; cells/{cellId} is public
    // read (see firestore.rules) so no extra auth is needed for this.
    let _cellNameMap = null;
    let _cellHandlerMap = {};
    /* Which Cells this device's Handler feed shows. The Handler password is
       shared, so with two Handlers running separate tables (each with
       their own Cells) every Handler -- and a shared table tablet logged
       into A-Cell -- saw every table's rolls. A filter in the feed's
       header picks All Cells, one Handler's Cells (the Cell's own
       `handler` field), or a single Cell; remembered on this device. */
    const CELL_FILTER_KEY = 'dg_dice_cell_filter';
    let _handlerEntries = [];
    function readCellFilter() {
        try { return localStorage.getItem(CELL_FILTER_KEY) || ''; } catch (e) { return ''; }
    }
    function rollMatchesFilter(cellId, filter) {
        if (!filter) return true;
        if (filter.indexOf('c:') === 0) return cellId === filter.slice(2);
        if (filter.indexOf('h:') === 0) return (_cellHandlerMap[cellId] || '') === filter.slice(2);
        return true;
    }
    function renderHandlerHistory() {
        const filter = readCellFilter();
        renderHistoryList(_handlerEntries.filter(e => rollMatchesFilter(e.__cellId, filter)).slice(0, HISTORY_LIMIT));
    }
    function buildCellFilter() {
        const sel = _e && _e.cellFilter;
        if (!sel) return;
        const handlers = [];
        Object.keys(_cellHandlerMap).forEach(id => {
            const h = _cellHandlerMap[id];
            if (h && handlers.indexOf(h) === -1) handlers.push(h);
        });
        handlers.sort((a, b) => a.localeCompare(b));
        const cells = Object.keys(_cellNameMap || {}).sort((a, b) => String(_cellNameMap[a]).localeCompare(String(_cellNameMap[b])));
        const opt = (v, t) => '<option value="' + escapeHtml(v) + '">' + escapeHtml(t) + '</option>';
        sel.innerHTML = opt('', 'Live rolls: all Cells') +
            (handlers.length > 1 ? '<optgroup label="By Handler">' + handlers.map(h => opt('h:' + h, h + '\u2019s Cells')).join('') + '</optgroup>' : '') +
            '<optgroup label="One Cell">' + cells.map(id => opt('c:' + id, _cellNameMap[id])).join('') + '</optgroup>';
        const want = readCellFilter();
        sel.value = want;
        if (sel.value !== want) sel.value = ''; // a Cell or Handler that no longer exists
        sel.style.display = '';
    }
    function startHandlerHistoryFeed() {
        stopHistoryFeed();
        const db = window.firebase.firestore();
        const attachListener = () => {
            buildCellFilter();
            // Read more than one screenful, so a filtered view still fills up
            // when other tables are rolling a lot.
            _historyUnsubscribe = db.collectionGroup('rolls')
                .orderBy('created_at', 'desc').limit(HISTORY_LIMIT * 6)
                .onSnapshot(snap => {
                    const entries = [];
                    snap.forEach(doc => {
                        const data = doc.data();
                        const cellId = doc.ref.parent.parent ? doc.ref.parent.parent.id : '';
                        // solo:<code> is the internal pseudo-Cell for an Agent in
                        // no Cell -- show that, not the raw id.
                        data.cellName = (_cellNameMap && _cellNameMap[cellId]) || (cellId.indexOf('solo:') === 0 ? 'No Cell' : cellId);
                        data.__cellId = cellId;
                        entries.push(data);
                    });
                    _handlerEntries = entries;
                    renderHandlerHistory();
                }, err => showHistoryError('Live Rolls feed error', err));
        };
        if (_cellNameMap) { attachListener(); return; }
        db.collection('cells').get().then(snap => {
            _cellNameMap = {};
            _cellHandlerMap = {};
            snap.forEach(doc => {
                _cellNameMap[doc.id] = doc.data().name || doc.id;
                _cellHandlerMap[doc.id] = String(doc.data().handler || '').trim();
            });
            attachListener();
        }).catch(() => { _cellNameMap = {}; attachListener(); });
    }

    // Same password A-Cell's own login already put in sessionStorage
    // (dg_acell_pw) -- reused here transparently, exactly the pattern
    // a-cell.html's own ensureHandlerSignedIn() already uses for
    // Evidence/Track Library. A real player report: this widget used to
    // require its OWN separate password entry on top of A-Cell's
    // already-critical gate ("still need double log in for handler
    // dice") even though the password is identical and already sitting
    // right there in sessionStorage. Only falls back to the manual
    // button+prompt if this genuinely fails (stale/wrong password, a
    // network error) -- isHandlerContext() being true (the only way
    // this function gets called) guarantees the key is present, but the
    // Cloud Function call behind signInAsHandler() can still fail on
    // its own.
    function attemptSilentHandlerSignIn() {
        let password = '';
        try { password = sessionStorage.getItem(ACELL_PW_KEY) || ''; } catch (e) { /* best effort */ }
        if (!password) { if (_e.handlerGate) _e.handlerGate.style.display = ''; return; }
        signInAsHandler(password).then(() => {
            if (_e.handlerGate) _e.handlerGate.style.display = 'none';
            startHandlerHistoryFeed();
        }).catch(() => { if (_e.handlerGate) _e.handlerGate.style.display = ''; });
    }
    // Kicks off the right feed for this page's context. Agent mode
    // starts automatically (no password needed); Handler mode first
    // checks for a Firebase Auth session already persisted on this
    // device from an earlier sign-in -- the JS SDK's default persistence
    // (IndexedDB) survives page reloads on its own -- and otherwise
    // attempts the silent sign-in above before ever falling back to the
    // button+prompt.
    function checkExistingHandlerSession() {
        ensureFirebaseApi(() => {
            const auth = window.firebase.auth();
            const unsub = auth.onAuthStateChanged(user => {
                unsub();
                if (!user) { attemptSilentHandlerSignIn(); return; }
                user.getIdTokenResult().then(res => {
                    if (res.claims && res.claims.handler) {
                        if (_e.handlerGate) _e.handlerGate.style.display = 'none';
                        startHandlerHistoryFeed();
                    } else {
                        attemptSilentHandlerSignIn();
                    }
                }).catch(attemptSilentHandlerSignIn);
            });
        }, err => showHistoryError('Could not load Firebase', err));
    }
    function initHistory() {
        resolveRollContext().then(ctx => {
            if (ctx.mode === 'agent') {
                ensureAgentSignedIn(ctx.agentCode).then(() => startAgentHistoryFeed(ctx))
                    .catch(err => showHistoryError('Sign-in failed', err));
            } else if (ctx.mode === 'local' && _e.historyList) {
                renderHistoryList(readLocalHistory());
            } else if (ctx.mode === 'handler' && _e.handlerGate) {
                checkExistingHandlerSession();
            } else if (ctx.mode === 'none' && _e.historyList) {
                // No Agent Code known on this device yet (no current
                // Agent, no Cover Identity roster entry) -- rolls still
                // work, they just can't be attributed to anyone, so
                // recordRoll() no-ops for this mode. Say so instead of
                // leaving the initial "No rolls yet." placeholder up
                // forever, which reads as broken rather than as "nothing
                // to save to."
                _e.historyList.innerHTML = '<div class="dr-history-empty">Load your Cover Identity on this device to save roll history.</div>';
            }
        });
    }

    /* ── Core roll ────────────────────────────────────────────────── */
    // The Field Notes notebook (assets/field-notes.js) hosts this panel
    // on its Dice page and opens to it when a roll starts from anywhere
    // (a skill click on the sheet, Friendly's weapon buttons).
    function signalRollStart() {
        try { window.dispatchEvent(new CustomEvent('dg-dice-roll-start')); } catch (e) { /* old engine */ }
    }

    function rollDie(targetOverride, skillName) {
        if (_rolling) return;
        if (_exprShown) selectDie(_activeDie);
        _rolling = true;
        signalRollStart();

        const cfg = DICE_MAP.get(_activeDie);
        const sides = cfg?.sides ?? 100;
        const rawVal = Math.floor(Math.random() * sides) + 1;
        const isPct = _activeDie === 'dpct';

        const { resultLabel, resultBox, targetDisp, nameEl, manualEl, panel, singleFace } = _e;

        if (nameEl) nameEl.textContent = skillName || '';
        if (_e.breakdownEl) _e.breakdownEl.textContent = '';
        if (resultLabel) { resultLabel.textContent = ''; resultLabel.style.color = ''; }
        if (resultBox) resultBox.className = 'dr-result-box dr-rolling';

        const target = typeof targetOverride === 'number' && targetOverride > 0
            ? targetOverride
            : (isPct ? parseInt(manualEl?.value) || 0 : 0);
        if (manualEl && target > 0 && isPct) manualEl.value = target;
        if (targetDisp) targetDisp.textContent = (isPct && target > 0) ? `TARGET: ${target}` : '';

        function onDone() {
            let tier = null;
            if (isPct) {
                const result = evaluate(rawVal, target);
                if (result && resultLabel) {
                    resultLabel.textContent = result.label;
                    resultLabel.style.color = result.color;
                    if (resultBox) resultBox.className = `dr-result-box dr-result-${result.tier}`;
                    tier = result.tier;
                } else {
                    if (resultLabel) resultLabel.textContent = `ROLLED ${rawVal}`;
                    if (resultBox) resultBox.className = 'dr-result-box';
                }
            } else {
                if (resultLabel) { resultLabel.textContent = String(rawVal); resultLabel.style.color = ''; }
                if (resultBox) resultBox.className = 'dr-result-box';
            }
            _rolling = false;
            recordRoll({
                roll_type: isPct ? 'percent' : 'die',
                label: skillName || null,
                value: rawVal,
                target: isPct && target > 0 ? target : null,
                tier: tier,
                sides: isPct ? null : sides,
                expr: null,
                breakdown: null,
            });
        }

        if (isPct) {
            animatePercent(rawVal, onDone);
        } else {
            animateSingle(singleFace, sides, rawVal, onDone);
        }

        if (panel?.classList.contains('dr-collapsed')) togglePanel();
    }

    /* ── Skill-click entry point (always uses d%) ─────────────────── */
    function rollPercent(target, skillName) {
        // No panel was ever built here (SUPPRESS_OWN_PANEL -- inside the
        // app shell's #dg-shell-content or the notebook's embedded pages),
        // so there's nothing local to animate into and rollDie() would
        // throw on a null _e. Relay to window.top, the one frame that has
        // a real, visible panel to animate into.
        if (SUPPRESS_OWN_PANEL) {
            if (window.top !== window) {
                try {
                    window.top.postMessage({ type: 'dg-dice-roll', target, skillName }, location.origin);
                } catch (e) { }
            }
            return;
        }
        if (_activeDie !== 'dpct') selectDie('dpct');
        rollDie(target, skillName);
    }

    /* ── Dice expression parser ─────────────────────────────────────── */
    // Accepts: d6, 2d6, 3d8+2, d4-1, 4d6, d20, etc. (1–20 dice, d2–d100)
    function parseExpr(str) {
        if (!str) return null;
        const m = str.trim().replace(/\s+/g, '').match(/^(\d*)d(\d+)([+-]\d+)?$/i);
        if (!m) return null;
        const count = m[1] === '' ? 1 : parseInt(m[1], 10);
        const sides = parseInt(m[2], 10);
        const modifier = m[3] ? parseInt(m[3], 10) : 0;
        if (!count || count < 1 || count > 20 || sides < 2 || sides > 100) return null;
        return { count, sides, modifier };
    }

    /* ── Expression roll ─────────────────────────────────────────────── */
    function rollExpr(expr, label) {
        if (_rolling) return;
        _rolling = true;
        signalRollStart();

        const rolls = Array.from({ length: expr.count }, () => Math.floor(Math.random() * expr.sides) + 1);
        const total = rolls.reduce((a, b) => a + b, 0) + expr.modifier;

        const { resultLabel, resultBox, targetDisp, nameEl,
            faceSingle, facePct, faceLabel, breakdownEl } = _e;

        if (facePct) facePct.style.display = 'none';
        if (faceSingle) faceSingle.style.display = 'flex';
        _exprShown = true;
        _e.dieBtns.forEach(b => b.classList.remove('dr-die-btn-active'));

        if (nameEl) nameEl.textContent = label || '';
        if (targetDisp) targetDisp.textContent = '';
        if (resultLabel) { resultLabel.textContent = ''; resultLabel.style.color = ''; }
        if (resultBox) resultBox.className = 'dr-result-box dr-rolling';
        if (breakdownEl) breakdownEl.textContent = '';

        // Update die shape to match the expression die sides
        const shapeId = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']
            .find(key => DICE_MAP.get(key)?.sides === expr.sides) || 'd10';
        _e.faceDivs.forEach(el => {
            el.classList.remove(...SHAPE_CLASSES);
            el.classList.add(`dr-shape-${shapeId}`);
            const svgWrap = el.querySelector('.dr-die-svg-wrap');
            if (svgWrap) svgWrap.innerHTML = DIE_SVGS[shapeId] || DIE_SVGS.d10;
        });
        if (faceLabel) {
            const mod = expr.modifier > 0 ? `+${expr.modifier}` : expr.modifier < 0 ? `${expr.modifier}` : '';
            faceLabel.textContent = `${expr.count > 1 ? expr.count : ''}D${expr.sides}${mod}`;
        }

        let exprStr = '';
        {
            const mod = expr.modifier > 0 ? `+${expr.modifier}` : expr.modifier < 0 ? `${expr.modifier}` : '';
            exprStr = `${expr.count > 1 ? expr.count : ''}d${expr.sides}${mod}`;
        }

        animateSingle(_e.singleFace, expr.count * expr.sides, total, () => {
            if (resultLabel) { resultLabel.textContent = String(total); resultLabel.style.color = ''; }
            if (resultBox) resultBox.className = 'dr-result-box';
            let breakdownText = '';
            if (breakdownEl && (expr.count > 1 || expr.modifier !== 0)) {
                const rollStr = expr.count > 1 ? `[${rolls.join(', ')}]` : `${rolls[0]}`;
                const modStr = expr.modifier > 0 ? ` + ${expr.modifier}`
                    : expr.modifier < 0 ? ` − ${Math.abs(expr.modifier)}` : '';
                breakdownText = `${rollStr}${modStr}`;
                breakdownEl.textContent = breakdownText;
            }
            _rolling = false;
            recordRoll({
                roll_type: 'expr',
                label: label || null,
                value: total,
                target: null,
                tier: null,
                sides: expr.sides,
                expr: exprStr,
                breakdown: breakdownText || null,
            });
        });

        if (_e.panel?.classList.contains('dr-collapsed')) togglePanel();
    }

    // A dice expression from page code ("1d10", "2d6+1") -- friendly.html's
    // weapon damage buttons. Returns false for anything parseExpr() won't
    // take (a lethality rating, say) so the page can fall back.
    function rollExpression(str, label) {
        const expr = parseExpr(String(str || ''));
        if (!expr) return false;
        if (SUPPRESS_OWN_PANEL) {
            if (window.top === window) return false;
            try { window.top.postMessage({ type: 'dg-dice-expr', expr: String(str), label: label || '' }, location.origin); } catch (e) { return false; }
            return true;
        }
        if (_e && _e.panel && _e.panel.classList.contains('dr-collapsed')) togglePanel();
        rollExpr(expr, label);
        return true;
    }
    function setIdentity(id) {
        window.dgDiceIdentity = id || null;
        if (SUPPRESS_OWN_PANEL) {
            if (window.top !== window) {
                try { window.top.postMessage({ type: 'dg-dice-identity', id: id || null }, location.origin); } catch (e) { }
            }
            return;
        }
        stopHistoryFeed();
        _rollContext = null;
        _rollContextPromise = null;
        if (_e && _e.panel) initHistory();
    }

    /* ── Manual roll button ───────────────────────────────────────── */
    function rollManual() {
        const val = _e.manualEl?.value?.trim() || '';
        const expr = parseExpr(val);
        if (expr) { rollExpr(expr); return; }
        rollDie(parseInt(val) || 0);
    }

    /* ── Panel toggle ─────────────────────────────────────────────── */
    function togglePanel() {
        if (!_e) {
            // Suppressed copy (inside the shell): nothing of its own to
            // toggle -- ask the page that owns the panel to show it.
            if (SUPPRESS_OWN_PANEL && window.top !== window) {
                try { window.top.postMessage({ type: 'dg-dice-show' }, location.origin); } catch (e) { }
            }
            return;
        }
        const { panel, body, arrow } = _e;
        if (!panel) return;
        const collapsed = panel.classList.toggle('dr-collapsed');
        if (body) body.style.display = collapsed ? 'none' : '';
        if (arrow) arrow.textContent = collapsed ? '▲' : '▼';
    }

    /* ── Drag ─────────────────────────────────────────────────────── */
    // The phone layout (the @media rule in injectStyles) docks the panel
    // as a full-width bottom sheet.
    function isDocked() { return window.matchMedia('(max-width:600px)').matches; }
    function undock(panel) { ['left', 'top', 'right', 'bottom'].forEach(k => { panel.style[k] = ''; }); }
    function initDrag(handle, panel) {
        let ox = 0, oy = 0, sx = 0, sy = 0;
        handle.addEventListener('mousedown', e => {
            if (e.target.closest('button, input')) return;
            e.preventDefault();
            ox = panel.offsetLeft; oy = panel.offsetTop;
            sx = e.clientX; sy = e.clientY;
            function onMove(e) {
                panel.style.left = `${Math.max(0, Math.min(ox + e.clientX - sx, window.innerWidth - panel.offsetWidth))}px`;
                panel.style.top = `${Math.max(0, Math.min(oy + e.clientY - sy, window.innerHeight - panel.offsetHeight))}px`;
                panel.style.right = 'auto';
                panel.style.bottom = 'auto';
            }
            function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
        // On a phone the panel is a bottom sheet docked full width, so it
        // isn't dragged at all: a finger scrolling the page that happened
        // to start on its bar used to drag it up and leave it stuck
        // mid-screen (reported 2026-10-20 on A-Cell, and very likely the
        // "frozen mid-screen" reports this file's reflow fixes chased).
        // Elsewhere a touch has to move a little before it drags.
        let dragging = false;
        handle.addEventListener('touchstart', e => {
            dragging = false;
            if (e.target.closest('button, input') || isDocked()) { sx = null; return; }
            const t = e.touches[0]; ox = panel.offsetLeft; oy = panel.offsetTop; sx = t.clientX; sy = t.clientY;
        }, { passive: true });
        handle.addEventListener('touchmove', e => {
            if (sx === null || isDocked()) return;
            const t = e.touches[0];
            if (!dragging && Math.abs(t.clientX - sx) + Math.abs(t.clientY - sy) < 10) return;
            dragging = true;
            panel.style.left = `${Math.max(0, Math.min(ox + t.clientX - sx, window.innerWidth - panel.offsetWidth))}px`;
            panel.style.top = `${Math.max(0, Math.min(oy + t.clientY - sy, window.innerHeight - panel.offsetHeight))}px`;
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        }, { passive: true });
    }

    /* ── Styles ───────────────────────────────────────────────────── */
    // Self-contained, same treatment table-radio.js gives its own widget:
    // injected once as a real <style> tag, so it looks the same on every
    // page it lives on.
    function injectStyles() {
        if (document.getElementById('dr-style')) return;
        const style = document.createElement('style');
        style.id = 'dr-style';
        style.textContent = [
            // Widget chrome color language: the same fixed --dg-widget-*
            // tokens as Table Radio (assets/table-radio.js), so docked
            // widgets never clash with each other whatever the page's theme.
            ':root{--dg-widget-bg:#161a14;--dg-widget-ink:#c9d4b8;--dg-widget-border:#3a4432;',
            '--dg-widget-accent:#8fae5a;--dg-widget-accent-bright:#a8c890;',
            '--dg-widget-font:\'JetBrains Mono\',ui-monospace,monospace;}',
            // GPU-layer promotion (translateZ(0) + backface-visibility)
            // on top of position:fixed -- iOS Safari has a long-standing
            // bug where a fixed element can freeze at a stale
            // scroll-relative spot instead of tracking the real
            // viewport (see buildPanel()'s own visibilitychange
            // handler, which only papers over the tab-switch/lock case
            // by forcing a reflow after the fact). Promoting the panel
            // onto its own compositing layer up front means WebKit
            // re-evaluates its fixed position against the real
            // viewport continuously, instead of needing an event to
            // notice and correct it -- the same fix already used for
            // Notes' block-picker popover (notes/notes.css) for the
            // identical WebKit quirk.
            '#dr-panel{position:fixed;bottom:58px;right:24px;width:270px;',
            'transform:translateZ(0);-webkit-transform:translateZ(0);',
            '-webkit-backface-visibility:hidden;backface-visibility:hidden;',
            'background:var(--dg-widget-bg);border:1px solid color-mix(in srgb,var(--dg-widget-accent) 45%,transparent);',
            'border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.5);',
            // z-index above table-radio.js's own #dg-radio (9998, see
            // assets/table-radio.js) -- that widget's mobile offset
            // (bottom:78px) only clears THIS panel's collapsed handle bar,
            // not its full expanded sheet, so when both are on the same
            // page and this panel is open, it needs to render on top
            // rather than have the radio pill float mid-sheet over the
            // roll controls. Collapsing this panel (▲) always restores
            // the radio pill's normal spot.
            'font-family:var(--dg-widget-font);color:var(--dg-widget-accent);z-index:9999;user-select:none;}',
            '#dr-handle{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;cursor:grab;',
            'border-bottom:1px solid color-mix(in srgb,var(--dg-widget-accent) 30%,transparent);',
            'background:color-mix(in srgb,var(--dg-widget-accent) 6%,transparent);border-radius:8px 8px 0 0;}',
            '#dr-handle:active{cursor:grabbing;}',
            '#dr-title{font-size:10px;letter-spacing:.12em;font-weight:bold;flex:1;}',
            '.dr-handle-controls button{background:transparent;border:none;color:inherit;cursor:pointer;',
            'font-size:12px;padding:0 3px;width:auto;min-width:0;opacity:.6;transition:opacity .15s;line-height:1;}',
            '.dr-handle-controls button:hover{opacity:1;}',
            '#dr-body{padding:12px;display:flex;flex-direction:column;gap:10px;}',
            '#dr-die-pills{display:flex;gap:4px;flex-wrap:wrap;justify-content:center;}',
            '.dr-die-btn{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;',
            'padding:5px 2px;text-align:center;font-size:10px;font-family:inherit;letter-spacing:.05em;font-weight:bold;',
            'background:transparent;border:1px solid rgba(128,128,128,.35);border-radius:4px;color:inherit;cursor:pointer;',
            'opacity:.55;transition:opacity .15s,border-color .15s,background .15s;min-width:0;width:auto;flex:1;max-width:42px;}',
            '.dr-die-btn:hover{opacity:.85;border-color:var(--dg-widget-accent);}',
            '.dr-die-btn-active{opacity:1!important;border-color:var(--dg-widget-accent)!important;',
            'background:color-mix(in srgb,var(--dg-widget-accent) 12%,transparent)!important;}',
            '#dr-face-area{display:flex;justify-content:center;min-height:84px;align-items:center;}',
            '.dr-face-wrap{display:flex;flex-direction:column;align-items:center;gap:4px;width:100%;}',
            '#dr-face-single .dr-die-face{width:70px;height:70px;font-size:28px;}',
            '.dr-face-type{font-size:9px;letter-spacing:.12em;opacity:.45;margin-top:2px;}',
            '.dr-pct-pair{display:flex;align-items:center;gap:8px;}',
            '.dr-pct-die{display:flex;flex-direction:column;align-items:center;gap:3px;}',
            '.dr-pct-lbl{font-size:8px;letter-spacing:.1em;opacity:.45;}',
            '.dr-pct-sep{font-size:16px;opacity:.3;margin-bottom:14px;}',
            '.dr-die-face{width:58px;height:58px;border:none;border-radius:0;display:flex;align-items:center;',
            'justify-content:center;font-size:20px;font-weight:bold;letter-spacing:-1px;background:transparent;',
            'box-shadow:none;position:relative;overflow:visible;color:var(--dg-widget-accent);}',
            '.dr-face-num{position:relative;z-index:1;}',
            '.dr-die-face::before{content:"";position:absolute;inset:0;opacity:.18;background-color:currentColor;',
            '-webkit-mask-size:80%;mask-size:80%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;',
            '-webkit-mask-position:center;mask-position:center;pointer-events:none;}',
            '.dr-die-face.dr-shape-d4::before{-webkit-mask-image:url(\'https://api.iconify.design/game-icons/d4.svg\');mask-image:url(\'https://api.iconify.design/game-icons/d4.svg\');}',
            '.dr-die-face.dr-shape-d6::before{-webkit-mask-image:url(\'https://api.iconify.design/game-icons/perspective-dice-six.svg\');mask-image:url(\'https://api.iconify.design/game-icons/perspective-dice-six.svg\');}',
            '.dr-die-face.dr-shape-d8::before{-webkit-mask-image:url(\'https://api.iconify.design/game-icons/dice-eight-faces-eight.svg\');mask-image:url(\'https://api.iconify.design/game-icons/dice-eight-faces-eight.svg\');}',
            '.dr-die-face.dr-shape-d10::before{-webkit-mask-image:url(\'https://api.iconify.design/game-icons/d10.svg\');mask-image:url(\'https://api.iconify.design/game-icons/d10.svg\');}',
            '.dr-die-face.dr-shape-d12::before{-webkit-mask-image:url(\'https://api.iconify.design/game-icons/d12.svg\');mask-image:url(\'https://api.iconify.design/game-icons/d12.svg\');}',
            '.dr-die-face.dr-shape-d20::before{-webkit-mask-image:url(\'https://api.iconify.design/game-icons/dice-twenty-faces-twenty.svg\');mask-image:url(\'https://api.iconify.design/game-icons/dice-twenty-faces-twenty.svg\');}',
            '.dr-die-icon{display:block;width:24px;height:24px;background-color:currentColor;-webkit-mask-size:contain;',
            'mask-size:contain;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;',
            'mask-position:center;flex-shrink:0;}',
            '.dr-die-lbl{font-size:8px;font-weight:bold;letter-spacing:.05em;line-height:1;}',
            '.dr-die-btn[data-die="d4"] .dr-die-icon{-webkit-mask-image:url(\'https://api.iconify.design/game-icons/d4.svg\');mask-image:url(\'https://api.iconify.design/game-icons/d4.svg\');}',
            '.dr-die-btn[data-die="d6"] .dr-die-icon{-webkit-mask-image:url(\'https://api.iconify.design/game-icons/perspective-dice-six.svg\');mask-image:url(\'https://api.iconify.design/game-icons/perspective-dice-six.svg\');}',
            '.dr-die-btn[data-die="d8"] .dr-die-icon{-webkit-mask-image:url(\'https://api.iconify.design/game-icons/dice-eight-faces-eight.svg\');mask-image:url(\'https://api.iconify.design/game-icons/dice-eight-faces-eight.svg\');}',
            '.dr-die-btn[data-die="d10"] .dr-die-icon{-webkit-mask-image:url(\'https://api.iconify.design/game-icons/d10.svg\');mask-image:url(\'https://api.iconify.design/game-icons/d10.svg\');}',
            '.dr-die-btn[data-die="d12"] .dr-die-icon{-webkit-mask-image:url(\'https://api.iconify.design/game-icons/d12.svg\');mask-image:url(\'https://api.iconify.design/game-icons/d12.svg\');}',
            '.dr-die-btn[data-die="d20"] .dr-die-icon{-webkit-mask-image:url(\'https://api.iconify.design/game-icons/dice-twenty-faces-twenty.svg\');mask-image:url(\'https://api.iconify.design/game-icons/dice-twenty-faces-twenty.svg\');}',
            '.dr-die-btn[data-die="dpct"] .dr-die-icon{-webkit-mask-image:url(\'https://api.iconify.design/game-icons/d10.svg\');mask-image:url(\'https://api.iconify.design/game-icons/d10.svg\');}',
            '@keyframes dr-spin-anim{0%{transform:rotateX(0deg) scale(1);opacity:1;}40%{transform:rotateX(90deg) scale(.82);opacity:.35;}',
            '60%{transform:rotateX(270deg) scale(.82);opacity:.35;}100%{transform:rotateX(360deg) scale(1);opacity:1;}}',
            '@keyframes dr-land-anim{0%{transform:scale(1.22);opacity:.5;}60%{transform:scale(.94);}100%{transform:scale(1);opacity:1;}}',
            '.dr-die-face.dr-spin{animation:dr-spin-anim .08s linear;}',
            '.dr-die-face.dr-land{animation:dr-land-anim .42s cubic-bezier(.175,.885,.32,1.275) forwards;}',
            '.dr-result-box{width:100%;min-height:44px;border:1px solid rgba(128,128,128,.25);border-radius:5px;',
            'display:flex;flex-direction:column;align-items:center;justify-content:center;padding:6px 6px;gap:1px;',
            'transition:border-color .25s,background .25s,box-shadow .25s;}',
            '#dr-target-display{font-size:9px;opacity:.45;letter-spacing:.08em;}',
            '#dr-result-label{font-size:15px;font-weight:bold;letter-spacing:.05em;text-align:center;transition:color .25s;}',
            '.dr-result-box.dr-rolling{border-color:rgba(128,128,128,.3);}',
            '.dr-result-box.dr-result-critical{border-color:#ffd700;background:rgba(255,215,0,.07);box-shadow:0 0 14px rgba(255,215,0,.3);}',
            '.dr-result-box.dr-result-success{border-color:#69f0ae;background:rgba(105,240,174,.05);}',
            '.dr-result-box.dr-result-failure{border-color:#ff6d00;background:rgba(255,109,0,.07);}',
            '.dr-result-box.dr-result-fumble{border-color:#ff1744;background:rgba(255,23,68,.10);box-shadow:0 0 16px rgba(255,23,68,.3);}',
            '#dr-breakdown{font-size:9px;opacity:.55;text-align:center;letter-spacing:.03em;min-height:11px;margin-top:2px;',
            'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%;}',
            '#dr-skill-name{font-size:9px;letter-spacing:.1em;text-align:center;opacity:.5;text-transform:uppercase;',
            'min-height:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%;}',
            '#dr-manual-row{display:flex;gap:6px;}',
            '#dr-manual-target{flex:1;padding:5px 8px;background:transparent;border:1px solid rgba(128,128,128,.35);',
            'border-radius:4px;color:inherit;font-family:inherit;font-size:12px;text-align:center;min-width:0;}',
            '#dr-manual-target:focus{outline:none;border-color:var(--dg-widget-accent);}',
            // Real bug, not just a style tweak: this only ever set layout
            // (padding/font/width), no color/border/background at all --
            // so this one button, unlike every other control in the
            // panel, fell through to whatever generic `button` rule the
            // embedding PAGE happened to define (reported as "the roll
            // button looks purple" -- some page's own theme accent
            // bleeding through here, not this panel's).
            '#dr-manual-row button{padding:5px 14px;font-size:11px;letter-spacing:.08em;width:auto;flex-shrink:0;',
            'background:transparent;color:var(--dg-widget-accent);border:1px solid var(--dg-widget-accent);border-radius:4px;',
            'font-family:inherit;cursor:pointer;}',
            '#dr-manual-row button:hover{background:color-mix(in srgb,var(--dg-widget-accent) 12%,transparent);}',
            '#dr-hint{font-size:8px;opacity:.3;text-align:center;line-height:1.4;letter-spacing:.03em;}',
            // ── Live history feed, styled to match the rest of this panel ──
            '#dr-history-section{border-top:1px solid rgba(128,128,128,.25);padding-top:8px;display:flex;flex-direction:column;gap:5px;}',
            '#dr-history-head{font-size:9px;letter-spacing:.12em;opacity:.5;text-transform:uppercase;text-align:center;}',
            '#dr-cell-filter{width:100%;padding:4px 6px;font-size:10px;letter-spacing:.06em;background:transparent;color:inherit;',
            'border:1px solid rgba(128,128,128,.35);border-radius:4px;font-family:inherit;cursor:pointer;}',
            '#dr-cell-filter option,#dr-cell-filter optgroup{color:#111;background:#fff;}',
            '#dr-handler-gate{width:100%;padding:6px;font-size:10px;letter-spacing:.06em;background:transparent;',
            'border:1px solid rgba(128,128,128,.35);border-radius:4px;color:inherit;font-family:inherit;cursor:pointer;}',
            '#dr-handler-gate:hover{border-color:var(--dg-widget-accent);}',
            '#dr-handler-gate:disabled{opacity:.5;cursor:default;}',
            '#dr-history-list{display:flex;flex-direction:column;gap:4px;max-height:160px;overflow-y:auto;}',
            '.dr-history-empty{font-size:9px;opacity:.35;text-align:center;padding:4px 0;}',
            '.dr-history-row{display:flex;flex-wrap:wrap;align-items:baseline;gap:0 6px;font-size:10px;',
            'padding:3px 4px;border-radius:3px;background:color-mix(in srgb,var(--dg-widget-accent) 4%,transparent);}',
            '.dr-history-agent{font-weight:bold;opacity:.85;}',
            '.dr-history-cell{font-size:8px;opacity:.4;letter-spacing:.03em;}',
            '.dr-history-summary{flex:1;min-width:60px;opacity:.9;}',
            '.dr-history-time{font-size:8px;opacity:.4;flex-shrink:0;}',
            '@media (max-width:600px){#dr-panel{right:0;bottom:0;left:0;width:100%;border-radius:12px 12px 0 0;',
            'border-left:none;border-right:none;border-bottom:none;max-height:60vh;overflow-y:auto;}',
            // A tall bar, its words and arrow clear of the screen's bottom
            // edge (and the home bar, where the page reaches under it).
            '#dr-handle{min-height:46px;box-sizing:border-box;cursor:pointer;padding-bottom:max(8px, env(safe-area-inset-bottom));}',
            '#dr-arrow{min-width:44px;min-height:36px;font-size:14px;}',
            '#dr-die-pills{gap:5px;}.dr-die-btn{max-width:none;flex:1;}}',
        ].join('');
        document.head.appendChild(style);
    }

    /* ── Build DOM ────────────────────────────────────────────────── */
    function buildPanel() {
        injectStyles();
        const panel = document.createElement('div');
        panel.id = 'dr-panel';

        // No inline onclick — all events wired via addEventListener below
        const diePills = DICE.map(d =>
            `<button type="button" class="dr-die-btn${d.id === 'dpct' ? ' dr-die-btn-active' : ''}" data-die="${d.id}" title="Roll a ${d.label}"><span class="dr-die-icon" aria-hidden="true"></span><span class="dr-die-lbl">${d.label}</span></button>`
        ).join('');

        const handlerMode = isHandlerContext();
        _lastHandlerMode = handlerMode;

        panel.innerHTML = `
<div id="dr-handle" title="Drag to move">
  <span id="dr-title">&#9861;&nbsp;DICE ROLLER</span>
  <div class="dr-handle-controls">
    <button type="button" id="dr-arrow" title="Collapse / expand">▼</button>
  </div>
</div>
<div id="dr-body">
  ${handlerMode ? '' : `
  <div id="dr-die-pills">${diePills}</div>
  <div id="dr-face-area">
    <div id="dr-face-single" style="display:none;" class="dr-face-wrap">
      <div class="dr-die-face dr-shape-d10" id="dr-single-face"><span class="dr-face-num">--</span></div>
      <div class="dr-face-type" id="dr-face-label">D6</div>
    </div>
    <div id="dr-face-percent" class="dr-face-wrap">
      <div class="dr-pct-pair">
        <div class="dr-pct-die">
          <div class="dr-die-face dr-shape-d10" id="dr-tens"><span class="dr-face-num">--</span></div>
          <div class="dr-pct-lbl">TENS</div>
        </div>
        <div class="dr-pct-sep">&times;</div>
        <div class="dr-pct-die">
          <div class="dr-die-face dr-shape-d10" id="dr-units"><span class="dr-face-num">--</span></div>
          <div class="dr-pct-lbl">UNITS</div>
        </div>
      </div>
    </div>
  </div>
  <div id="dr-result-box" class="dr-result-box">
    <div id="dr-target-display"></div>
    <div id="dr-result-label"></div>
  </div>
  <div id="dr-breakdown"></div>
  <div id="dr-skill-name"></div>
  <div id="dr-manual-row">
    <input type="text" id="dr-manual-target" placeholder="target %, 2d6+3" title="Enter a target % to roll D% against, or a dice expression like 2d6+3 or d4-1">
    <button type="button" id="dr-roll-btn" title="Roll the selected die">ROLL</button>
  </div>
  <div id="dr-hint">Click a skill value to roll D% · type 2d6+3 for custom rolls</div>
  `}
  <div id="dr-history-section">
    ${handlerMode ? '<select id="dr-cell-filter" aria-label="Which Cells\u2019 rolls to show" style="display:none;"></select>' : '<div id="dr-history-head">RECENT ROLLS</div>'}
    ${handlerMode ? '<button type="button" id="dr-handler-gate" style="display:none;">Show Live Rolls (Handler)</button>' : ''}
    <div id="dr-history-list"><div class="dr-history-empty">${handlerMode ? '' : 'No rolls yet.'}</div></div>
  </div>
</div>`;

        document.body.appendChild(panel);

        // Cache all DOM node references once — avoids repeated getElementById on every roll
        const $ = id => document.getElementById(id);
        _e = {
            panel,
            body: $('dr-body'),
            arrow: $('dr-arrow'),
            resultLabel: $('dr-result-label'),
            resultBox: $('dr-result-box'),
            targetDisp: $('dr-target-display'),
            nameEl: $('dr-skill-name'),
            breakdownEl: $('dr-breakdown'),
            manualEl: $('dr-manual-target'),
            faceSingle: $('dr-face-single'),
            facePct: $('dr-face-percent'),
            faceLabel: $('dr-face-label'),
            singleFace: $('dr-single-face'),
            singleNum: $('dr-single-face')?.querySelector('.dr-face-num'),
            tens: $('dr-tens'),
            tensNum: $('dr-tens')?.querySelector('.dr-face-num'),
            units: $('dr-units'),
            unitsNum: $('dr-units')?.querySelector('.dr-face-num'),
            dieBtns: panel.querySelectorAll('.dr-die-btn'),
            faceDivs: panel.querySelectorAll('.dr-die-face'),
            historyList: $('dr-history-list'),
            cellFilter: $('dr-cell-filter'),
            handlerGate: $('dr-handler-gate'),
        };

        // Wire events via addEventListener — no global dgDice dependency in markup
        _e.arrow.addEventListener('click', togglePanel);
        // On a phone the bar is docked (nothing to drag), and its little ▲
        // sat in the screen's bottom edge, where iOS keeps taps for its own
        // gestures: the whole bar opens and closes it there.
        $('dr-handle').addEventListener('click', e => {
            if (!isDocked() || e.target.closest('button, input')) return;
            togglePanel();
        });
        if (!handlerMode) {
            _e.dieBtns.forEach(b => b.addEventListener('click', () => selectDie(b.dataset.die)));
            $('dr-roll-btn').addEventListener('click', rollManual);
            _e.manualEl.addEventListener('keydown', e => { if (e.key === 'Enter') rollManual(); });
        }
        if (_e.cellFilter) {
            _e.cellFilter.addEventListener('change', () => {
                try { localStorage.setItem(CELL_FILTER_KEY, _e.cellFilter.value); } catch (e) { /* this view only */ }
                renderHandlerHistory();
            });
        }
        if (_e.handlerGate) {
            _e.handlerGate.addEventListener('click', () => {
                const password = window.prompt('Handler password (same as A-Cell):');
                if (!password) return;
                _e.handlerGate.disabled = true;
                _e.handlerGate.textContent = 'Signing in…';
                signInAsHandler(password).then(() => {
                    _e.handlerGate.style.display = 'none';
                    startHandlerHistoryFeed();
                }).catch(err => {
                    _e.handlerGate.disabled = false;
                    _e.handlerGate.textContent = 'Show Live Rolls (Handler)';
                    console.error('dice-roller: Handler sign-in failed', err);
                    const detail = (err && (err.code || err.message)) || String(err);
                    window.alert('Wrong password, or Live Rolls is temporarily unreachable.\n\n(' + detail + ')');
                });
            });
        }

        // Start collapsed by default
        panel.classList.add('dr-collapsed');
        _e.body.style.display = 'none';
        _e.arrow.textContent = '▲';
        initDrag($('dr-handle'), panel);

        // iOS Safari has a long-standing quirk where position:fixed
        // elements can freeze at a stale scroll-relative spot -- appearing
        // to float mid-page instead of staying docked -- after the screen
        // locks and unlocks while the tab stays open. Most noticeable at
        // the table, where a page stays open through a lock/unlock. Forcing a reflow when the tab becomes visible
        // again snaps it back to its real fixed position.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible' || !panel.isConnected) return;
            const prevDisplay = panel.style.display;
            panel.style.display = 'none';
            void panel.offsetHeight;
            panel.style.display = prevDisplay;
        });

        // Same underlying iOS Safari position:fixed freeze, a second real
        // trigger: live report, 2026-09-13 -- tapping an Agent from
        // Clearance and scrolling while the new page is still settling
        // left this panel stuck floating mid-screen instead of docked at
        // its real fixed spot, same as the lock/unlock case above but
        // without ever backgrounding the tab. Re-runs the same reflow
        // trick once scrolling actually stops (debounced -- this must
        // NOT run on every scroll tick, forcing layout that often would
        // reintroduce the jank this panel is supposed to avoid).
        // A position left over from a drag (or from before the window
        // became phone-sized) is dropped, so the sheet is docked again.
        if (isDocked()) undock(panel);
        window.addEventListener('resize', () => { if (isDocked()) undock(panel); });
        let scrollReflowTimer = null;
        window.addEventListener('scroll', () => {
            clearTimeout(scrollReflowTimer);
            scrollReflowTimer = setTimeout(() => {
                if (!panel.isConnected) return;
                const prevDisplay = panel.style.display;
                panel.style.display = 'none';
                void panel.offsetHeight;
                panel.style.display = prevDisplay;
            }, 150);
        }, { passive: true });
    }

    /* ── Public API ───────────────────────────────────────────────── */
    // recordRoll is exposed separately from roll() -- a page with its own
    // already-computed result (e.g. requisition.html's own paper-form
    // percentile roll) logs that exact roll into the shared history here
    // without triggering a second, independent roll of its own the way
    // roll()/rollPercent() would (which animates and rolls fresh dice).
    window.dgDice = {
        roll: rollPercent, rollManual, recordRoll, rollExpr: rollExpression, setIdentity,
        firebase: ensureFirebaseApi, _toggle: togglePanel, _select: selectDie,
    };

    /* ── Relay listener: only an instance with a real panel of its own
       should listen -- a SUPPRESS_OWN_PANEL instance has no built _e to
       roll into (see rollPercent() above) and only ever relays UP, never
       receives. Same-origin only, both ways. */
    if (!SUPPRESS_OWN_PANEL) {
        window.addEventListener('message', e => {
            if (e.origin !== location.origin) return;
            const data = e.data;
            if (data && data.type === 'dg-dice-roll') {
                rollPercent(data.target, data.skillName);
            } else if (data && data.type === 'dg-dice-expr') {
                rollExpression(data.expr, data.label);
            } else if (data && data.type === 'dg-dice-identity') {
                _relayedFriendly = !!data.id;
                setIdentity(data.id || null);
            } else if (data && data.type === 'dg-dice-show') {
                if (window.dgFieldNotes && window.dgFieldNotes.open) window.dgFieldNotes.open('dice');
                else if (_e && _e.panel && _e.panel.classList.contains('dr-collapsed')) togglePanel();
            }
        });
    }

    /* ── Init ─────────────────────────────────────────────────────── */
    // On DOMContentLoaded, not 'load': buildPanel() only needs the DOM, and
    // 'load' waits for every subresource (Table Radio's stream included).
    const dgInitDiceRoller = () => {
        if (SUPPRESS_OWN_PANEL) return;
        buildPanel(); initHistory(); watchHandlerModeChange();
        // See resolveRollContext()'s own comment: the current Agent can be
        // set after page load (New Recruit, the notebook's Agent card, both
        // firing 'dg-cloud-code-set'). Re-running initHistory() then starts
        // the history feed for that Agent.
        function reresolve() {
            stopHistoryFeed();
            _rollContext = null;
            _rollContextPromise = null;
            initHistory();
        }
        window.addEventListener('dg-cloud-code-set', reresolve);
        // Inside the Hub shell this panel lives on the outer page and so
        // survives every page change -- a roll auto-expands it, and it then
        // stayed open over ~60% of a phone's screen on whatever page the
        // player went to next (tapping "Agent Hub" after a roll left the
        // Hub's own buttons under it). Collapse it when the shell's content
        // page changes; the player's roll history is still one tap away.
        const shellFrame = document.getElementById('dg-shell-content');
        if (shellFrame) shellFrame.addEventListener('load', () => {
            if (_e.panel && !_e.panel.classList.contains('dr-collapsed')) togglePanel();
            let onFriendly = false;
            try { onFriendly = shellFrame.contentWindow.location.pathname.indexOf('friendly.html') !== -1; } catch (e) { }
            if (_relayedFriendly && !onFriendly) { _relayedFriendly = false; setIdentity(null); }
        });
        // Inside the Hub shell this widget lives on the OUTER page, while
        // the Agent's code gets set by the page inside the iframe -- and
        // 'dg-cloud-code-set' only fires on the iframe's own window. On a
        // brand-new device (nothing in localStorage when hub.html first
        // loaded) the shell's roller therefore stayed on "Load your Cover
        // Identity on this device to save roll history" for the whole
        // visit, and never saved a roll. A same-origin iframe's
        // localStorage write does fire 'storage' here, so follow that:
        // re-resolve whenever the code this widget would now pick differs
        // from the one it's using (first code, or Play on another Agent).
        window.addEventListener('storage', e => {
            if (e.key !== CLOUD_CODE_KEY && e.key !== ROSTER_KEY && e.key !== null) return;
            if (isHandlerContext() || isFriendly()) return;
            const code = currentAgentCode();
            const using = _rollContextPromise ? _rollContextFor : '';
            if (code !== using) reresolve();
        });
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', dgInitDiceRoller);
    } else {
        dgInitDiceRoller();
    }
})();
