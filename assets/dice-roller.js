/**
 * DELTA GREEN STATS — Animated Multi-Die Roller
 *
 * Dice: d4, d6, d8, d10, d12, d20, d% (percentile)
 * Percentile mode shows two d10 faces + DG result tiers.
 * All other dice show a single animated face.
 * Draggable, collapsible, theme-aware.
 *
 * Firebase migration Phase 3: moved here from stats/dice-roller.js and
 * included on every player-reachable Hub page (same treatment Table
 * Radio already got in Phase 2), backed by a live Firestore history --
 * dice_rolls/{cellId}/rolls/{rollId}, no existing Sheets data to
 * migrate (rolling was never persisted anywhere before this). Every
 * roll from EITHER entry point (a skill/stat click on the character
 * sheet, or the manual panel -- percentile target OR a dice expression
 * like 2d6+3) writes one history entry once its animation lands; see
 * recordRoll() below, called from rollDie()'s and rollExpr()'s own
 * onDone(). An Agent's own rolls always work regardless of Firestore
 * (recordRoll() is fire-and-forget, same tolerance the rest of this
 * migration uses -- a failed/skipped write never blocks the roll
 * itself from animating and showing a result).
 *
 * Identity: an Agent Code is read from whatever this page already uses
 * for it (stats/index.html's own Cloud Save code, or the most recently
 * active entry in the shared Cover Identity roster on every other
 * page) -- never a new prompt. A-Cell has no single "current Agent"
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
 */
(function () {
    'use strict';

    // Same reasoning as table-radio.js's own guard, right next to it in
    // every page that includes both -- inside the app shell (hub.html),
    // the shell owns one hoisted copy of this widget outside
    // #dg-shell-content entirely; a page loaded *into* that iframe must
    // not also mount its own (this widget's #dr-panel is also
    // position:fixed, landing on top of the shell's real one). Same for
    // stats/index.html's own #dg-split-sheet-frame -- Split View's sheet
    // pane is a real second copy of that same page (self-referencing
    // iframe), so its own include would otherwise mount a second Dice
    // Roller too. Null on every standalone visit and for any other
    // embedding -- same-origin only, so this can't misfire cross-origin.
    //
    // This ONLY suppresses this instance's own floating #dr-panel --
    // it must NOT bail out of the whole script early the way it used to
    // (a bare `return` here), because wireSkillInputs() below attaches
    // its click listener to THIS document, and the character sheet's
    // own skill/stat inputs only ever exist in THIS document (the one
    // actually showing the sheet, inside the iframe) -- never in the
    // shell's own hub.html, which has no sheet markup at all. An early
    // return here meant NOTHING ever listened for a skill click at all
    // once a sheet was loaded through the shell (or through Split
    // View's own sheet pane, once that was added to this same guard) --
    // clicking a skill value did nothing but let the input become an
    // editable text field, its ordinary default behavior, since nothing
    // was left to intercept the click and treat it as a roll instead.
    // rollPercent() below relays the roll to whichever ancestor DOES
    // have a visible panel (the shell's hoisted copy, or Split View's
    // own outer/non-embedded page) via postMessage, same mechanism this
    // file already used for Split View alone before this fix widened it
    // to also cover the shell.
    const SUPPRESS_OWN_PANEL = !!(window.frameElement &&
        (window.frameElement.id === 'dg-shell-content' || window.frameElement.id === 'dg-split-sheet-frame'));

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
    const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxF32nCIUfXDcTaKntKkt8az_7mwy8aOAKPD0mtaEZHcUEKmq0AF2b2k4V6FJNEzbIJZQ/exec';
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
    const ACELL_SESSION_KEY = 'dg_acell_session';
    // Set alongside dg_acell_session by a-cell.html's own login success
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
    let firebaseApiCallbacks = [];
    function loadScript(src, cb) {
        const s = document.createElement('script');
        s.src = src;
        s.onload = cb;
        document.head.appendChild(s);
    }
    function ensureFirebaseApi(cb) {
        const ready = () => window.firebase && window.firebase.firestore && window.firebase.auth && window.firebase.functions;
        if (ready()) { cb(); return; }
        firebaseApiCallbacks.push(cb);
        if (firebaseApiLoading) return;
        firebaseApiLoading = true;
        const base = 'https://www.gstatic.com/firebasejs/' + FIREBASE_SDK_VERSION + '/';
        const needApp = !(window.firebase && window.firebase.firestore);
        const afterCore = () => {
            if (!window.firebase.apps.length) window.firebase.initializeApp(FIREBASE_CONFIG);
            loadScript(base + 'firebase-auth-compat.js', () => {
                loadScript(base + 'firebase-functions-compat.js', () => {
                    const cbs = firebaseApiCallbacks; firebaseApiCallbacks = [];
                    cbs.forEach(fn => fn());
                });
            });
        };
        if (needApp) {
            loadScript(base + 'firebase-app-compat.js', () => loadScript(base + 'firebase-firestore-compat.js', afterCore));
        } else {
            afterCore();
        }
    }

    /* ── list_cells JSONP, same helper shape notes/index.html already
       uses for the same "which Cell is this Agent in" lookup. ── */
    function jsonpGet(action, params, cb) {
        const cbName = '_dgDiceJsonp_' + action + '_' + Date.now();
        const timer = setTimeout(() => { delete window[cbName]; cb(null); }, 7000);
        window[cbName] = function (res) {
            clearTimeout(timer);
            delete window[cbName];
            cb(res);
        };
        const s = document.createElement('script');
        let qs = 'action=' + action + '&callback=' + cbName;
        Object.keys(params || {}).forEach(k => { qs += '&' + k + '=' + encodeURIComponent(params[k]); });
        s.src = APPS_SCRIPT_URL + '?' + qs;
        document.head.appendChild(s);
    }

    function isHandlerContext() {
        try { return !!sessionStorage.getItem(ACELL_SESSION_KEY); } catch (e) { return false; }
    }

    // A-Cell's real login flow is: the page loads (this panel builds
    // itself immediately, before anyone has signed in, so isHandlerContext()
    // reads false and the panel renders as a normal Agent panel) *then*
    // the Handler types the A-Cell password into A-Cell's own login card,
    // which only afterwards sets dg_acell_session. Nothing here ever
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

    // Highest priority: this exact page's own Cloud Save code (only
    // ever set on stats/index.html). Falls back to the shared Cover
    // Identity roster's most-recently-active Agent -- same precedence
    // notes/index.html already uses for the same "who am I on this
    // page" question.
    function currentAgentCode() {
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
    function findCellForAgent(cellsList, agentCode) {
        return cellsList.find(c => (c.member_codes || []).indexOf(agentCode) !== -1) || null;
    }

    // window.dgSaveLoad only exists on stats/index.html itself (the one
    // page that loads stats/save-load.js) -- on every other Hub page this
    // panel now also lives on, that check always misses and recordRoll()
    // fell back to showing the bare Agent Code in history instead of the
    // character's name. The roster's own char_name (kept in sync by
    // rosterUpsert() on every save, cloud-sync.js) works from any page,
    // so it's the fallback; dgSaveLoad's live value is still preferred
    // when available since it reflects an unsaved in-progress edit.
    function currentAgentName() {
        try {
            const s = window.dgSaveLoad && window.dgSaveLoad.collectState && window.dgSaveLoad.collectState();
            const live = s && s.bio && s.bio.name;
            if (live) return live;
        } catch (e) { /* best effort */ }
        try {
            const code = currentAgentCode();
            const roster = JSON.parse(localStorage.getItem(ROSTER_KEY) || '{}');
            return (code && roster[code] && roster[code].char_name) || '';
        } catch (e) { return ''; }
    }

    // Resolved once per page load and cached -- an Agent's Cell doesn't
    // change mid-session, and re-fetching list_cells on every single
    // roll would be wasteful. { mode: 'agent', agentCode, cellId } |
    // { mode: 'handler' } | { mode: 'none' } (no Agent Code known yet
    // on this device -- rolling still works, just isn't persisted).
    let _rollContext = null;
    let _rollContextPromise = null;
    function resolveRollContext() {
        if (_rollContextPromise) return _rollContextPromise;
        _rollContextPromise = new Promise(resolve => {
            if (isHandlerContext()) {
                _rollContext = { mode: 'handler' };
                resolve(_rollContext);
                return;
            }
            const agentCode = currentAgentCode();
            if (!agentCode) {
                _rollContext = { mode: 'none' };
                resolve(_rollContext);
                return;
            }
            jsonpGet('list_cells', {}, res => {
                const cellsList = (res && res.status === 'OK') ? (res.cells || []) : [];
                const cell = findCellForAgent(cellsList, agentCode);
                _rollContext = {
                    mode: 'agent',
                    agentCode: agentCode,
                    cellId: cell ? cell.cell_id : soloCellId(agentCode),
                };
                resolve(_rollContext);
            });
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
    function ensureAgentSignedIn(agentCode) {
        if (_authPromise) return _authPromise;
        _authPromise = new Promise((resolve, reject) => {
            ensureFirebaseApi(() => {
                const auth = window.firebase.auth();
                if (auth.currentUser) { resolve(auth.currentUser); return; }
                window.firebase.functions().httpsCallable('exchangeAgentToken')({ agent_code: agentCode })
                    .then(result => auth.signInWithCustomToken(result.data.token))
                    .then(cred => resolve(cred.user))
                    .catch(err => { _authPromise = null; reject(err); });
            });
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
            });
        });
    }

    // Best-effort: any failure anywhere in this chain (no context yet,
    // sign-in rejected, Firestore write rejected) is swallowed -- the
    // roll already happened and already showed its result on screen
    // before this is even called; history is a nice-to-have layered on
    // top, never a gate on rolling itself.
    function recordRoll(rollData) {
        resolveRollContext().then(ctx => {
            if (ctx.mode !== 'agent') return;
            return ensureAgentSignedIn(ctx.agentCode).then(() => {
                const db = window.firebase.firestore();
                const doc = Object.assign({
                    agent_code: ctx.agentCode,
                    agent_name: currentAgentName(),
                    created_at: Date.now(),
                }, rollData);
                return db.collection('dice_rolls').doc(ctx.cellId).collection('rolls').add(doc);
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
        _historyUnsubscribe = db.collection('dice_rolls').doc(ctx.cellId).collection('rolls')
            .orderBy('created_at', 'desc').limit(HISTORY_LIMIT)
            .onSnapshot(snap => {
                const entries = [];
                snap.forEach(doc => entries.push(doc.data()));
                renderHistoryList(entries);
            }, err => showHistoryError('History feed error', err));
    }
    // Cell docs' own `name` field ("Test", "H-Cell"...) vs. the id doc
    // path segments actually are (cell_<timestamp>_<rand>) -- fetched
    // once and cached rather than per-row, since a campaign realistically
    // has a handful of Cells, not thousands; cells/{cellId} is public
    // read (see firestore.rules) so no extra auth is needed for this.
    let _cellNameMap = null;
    function startHandlerHistoryFeed() {
        stopHistoryFeed();
        const db = window.firebase.firestore();
        const attachListener = () => {
            _historyUnsubscribe = db.collectionGroup('rolls')
                .orderBy('created_at', 'desc').limit(HISTORY_LIMIT)
                .onSnapshot(snap => {
                    const entries = [];
                    snap.forEach(doc => {
                        const data = doc.data();
                        const cellId = doc.ref.parent.parent ? doc.ref.parent.parent.id : '';
                        data.cellName = (_cellNameMap && _cellNameMap[cellId]) || cellId;
                        entries.push(data);
                    });
                    renderHistoryList(entries);
                }, err => showHistoryError('Live Rolls feed error', err));
        };
        if (_cellNameMap) { attachListener(); return; }
        db.collection('cells').get().then(snap => {
            _cellNameMap = {};
            snap.forEach(doc => { _cellNameMap[doc.id] = doc.data().name || doc.id; });
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
        });
    }
    function initHistory() {
        resolveRollContext().then(ctx => {
            if (ctx.mode === 'agent') {
                ensureAgentSignedIn(ctx.agentCode).then(() => startAgentHistoryFeed(ctx))
                    .catch(err => showHistoryError('Sign-in failed', err));
            } else if (ctx.mode === 'handler' && _e.handlerGate) {
                checkExistingHandlerSession();
            } else if (ctx.mode === 'none' && _e.historyList) {
                // No Agent Code known on this device yet (no Cloud Save
                // code, no Cover Identity roster entry) -- rolls still
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
    function rollDie(targetOverride, skillName) {
        if (_rolling) return;
        _rolling = true;

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
        // app shell's #dg-shell-content, or Split View's own
        // #dg-split-sheet-frame), so there's nothing local to animate
        // into and rollDie() would throw trying to destructure a null
        // _e. Relay to whichever ancestor DOES have a visible panel
        // instead -- the shell's hoisted copy, or Split View's own
        // outer/non-embedded page -- same postMessage this file already
        // used for Split View alone before SUPPRESS_OWN_PANEL widened
        // to also cover the shell.
        if (SUPPRESS_OWN_PANEL) {
            if (window.parent !== window) {
                try {
                    window.parent.postMessage({ type: 'dg-dice-roll', target, skillName }, location.origin);
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
    function rollExpr(expr) {
        if (_rolling) return;
        _rolling = true;

        const rolls = Array.from({ length: expr.count }, () => Math.floor(Math.random() * expr.sides) + 1);
        const total = rolls.reduce((a, b) => a + b, 0) + expr.modifier;

        const { resultLabel, resultBox, targetDisp, nameEl,
            faceSingle, facePct, faceLabel, breakdownEl } = _e;

        if (facePct) facePct.style.display = 'none';
        if (faceSingle) faceSingle.style.display = 'flex';

        if (nameEl) nameEl.textContent = '';
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
                label: null,
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

    /* ── Manual roll button ───────────────────────────────────────── */
    function rollManual() {
        const val = _e.manualEl?.value?.trim() || '';
        const expr = parseExpr(val);
        if (expr) { rollExpr(expr); return; }
        rollDie(parseInt(val) || 0);
    }

    /* ── Panel toggle ─────────────────────────────────────────────── */
    function togglePanel() {
        const { panel, body, arrow } = _e;
        if (!panel) return;
        const collapsed = panel.classList.toggle('dr-collapsed');
        if (body) body.style.display = collapsed ? 'none' : '';
        if (arrow) arrow.textContent = collapsed ? '▲' : '▼';
    }

    /* ── Drag ─────────────────────────────────────────────────────── */
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
        handle.addEventListener('touchstart', e => {
            if (e.target.closest('button, input')) return;
            const t = e.touches[0]; ox = panel.offsetLeft; oy = panel.offsetTop; sx = t.clientX; sy = t.clientY;
        }, { passive: true });
        handle.addEventListener('touchmove', e => {
            const t = e.touches[0];
            panel.style.left = `${Math.max(0, Math.min(ox + t.clientX - sx, window.innerWidth - panel.offsetWidth))}px`;
            panel.style.top = `${Math.max(0, Math.min(oy + t.clientY - sy, window.innerHeight - panel.offsetHeight))}px`;
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        }, { passive: true });
    }

    /* ── Styles ───────────────────────────────────────────────────── */
    // Self-contained, same treatment table-radio.js already gives its own
    // widget in Phase 2 -- this panel now lives on 6 pages, only one of
    // which (stats/index.html) loads stats/styles.css, so the original
    // rules there can't be relied on to reach the other 5. Injected once
    // as a real <style> tag (not inline styles) so stats/index.html's own
    // per-theme overrides (.theme-son-of-sam .dr-die-btn-active etc.),
    // which are more specific than any bare .dr-* selector here, still
    // win on that page exactly as before.
    function injectStyles() {
        if (document.getElementById('dr-style')) return;
        const style = document.createElement('style');
        style.id = 'dr-style';
        style.textContent = [
            '#dr-panel{position:fixed;bottom:58px;right:24px;width:270px;',
            'background:var(--bg-color,#0a0a0a);border:1px solid var(--primary-color,#00b521);',
            'border-radius:8px;box-shadow:0 0 28px color-mix(in srgb,var(--primary-color) 20%,transparent),0 6px 20px rgba(0,0,0,.7);',
            // z-index above table-radio.js's own #dg-radio (9998, see
            // assets/table-radio.js) -- that widget's mobile offset
            // (bottom:78px) only clears THIS panel's collapsed handle bar,
            // not its full expanded sheet, so when both are on the same
            // page and this panel is open, it needs to render on top
            // rather than have the radio pill float mid-sheet over the
            // roll controls. Collapsing this panel (▲) always restores
            // the radio pill's normal spot.
            'font-family:"JetBrains Mono",monospace;color:var(--primary-color,#00b521);z-index:9999;user-select:none;}',
            '#dr-handle{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;cursor:grab;',
            'border-bottom:1px solid color-mix(in srgb,var(--primary-color) 30%,transparent);',
            'background:color-mix(in srgb,var(--primary-color) 6%,transparent);border-radius:8px 8px 0 0;}',
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
            '.dr-die-btn:hover{opacity:.85;border-color:var(--primary-color,#00b521);}',
            '.dr-die-btn-active{opacity:1!important;border-color:var(--primary-color,#00b521)!important;',
            'background:color-mix(in srgb,var(--primary-color) 12%,transparent)!important;}',
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
            'box-shadow:none;position:relative;overflow:visible;color:var(--primary-color,#00b521);}',
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
            '#dr-manual-target:focus{outline:none;border-color:var(--primary-color,#00b521);}',
            '#dr-manual-row button{padding:5px 14px;font-size:11px;letter-spacing:.08em;width:auto;flex-shrink:0;}',
            '#dr-hint{font-size:8px;opacity:.3;text-align:center;line-height:1.4;letter-spacing:.03em;}',
            // ── Live history feed (new in Phase 3 -- no stats/styles.css
            // precedent, styled to match the rest of this panel) ──
            '#dr-history-section{border-top:1px solid rgba(128,128,128,.25);padding-top:8px;display:flex;flex-direction:column;gap:5px;}',
            '#dr-history-head{font-size:9px;letter-spacing:.12em;opacity:.5;text-transform:uppercase;text-align:center;}',
            '#dr-handler-gate{width:100%;padding:6px;font-size:10px;letter-spacing:.06em;background:transparent;',
            'border:1px solid rgba(128,128,128,.35);border-radius:4px;color:inherit;font-family:inherit;cursor:pointer;}',
            '#dr-handler-gate:hover{border-color:var(--primary-color,#00b521);}',
            '#dr-handler-gate:disabled{opacity:.5;cursor:default;}',
            '#dr-history-list{display:flex;flex-direction:column;gap:4px;max-height:160px;overflow-y:auto;}',
            '.dr-history-empty{font-size:9px;opacity:.35;text-align:center;padding:4px 0;}',
            '.dr-history-row{display:flex;flex-wrap:wrap;align-items:baseline;gap:0 6px;font-size:10px;',
            'padding:3px 4px;border-radius:3px;background:color-mix(in srgb,var(--primary-color) 4%,transparent);}',
            '.dr-history-agent{font-weight:bold;opacity:.85;}',
            '.dr-history-cell{font-size:8px;opacity:.4;letter-spacing:.03em;}',
            '.dr-history-summary{flex:1;min-width:60px;opacity:.9;}',
            '.dr-history-time{font-size:8px;opacity:.4;flex-shrink:0;}',
            '@media (max-width:600px){#dr-panel{right:0;bottom:0;left:0;width:100%;border-radius:12px 12px 0 0;',
            'border-left:none;border-right:none;border-bottom:none;}#dr-die-pills{gap:5px;}.dr-die-btn{max-width:none;flex:1;}}',
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
    <div id="dr-history-head">${handlerMode ? 'LIVE ROLLS -- ALL CELLS' : 'RECENT ROLLS'}</div>
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
            handlerGate: $('dr-handler-gate'),
        };

        // Wire events via addEventListener — no global dgDice dependency in markup
        _e.arrow.addEventListener('click', togglePanel);
        if (!handlerMode) {
            _e.dieBtns.forEach(b => b.addEventListener('click', () => selectDie(b.dataset.die)));
            $('dr-roll-btn').addEventListener('click', rollManual);
            _e.manualEl.addEventListener('keydown', e => { if (e.key === 'Enter') rollManual(); });
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
        // locks and unlocks while the tab stays open. Not specific to this
        // panel or to Live Play, just more likely to be noticed there since
        // that's the mode people leave open through a lock/unlock during
        // an actual session. Forcing a reflow when the tab becomes visible
        // again snaps it back to its real fixed position.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible' || !panel.isConnected) return;
            const prevDisplay = panel.style.display;
            panel.style.display = 'none';
            void panel.offsetHeight;
            panel.style.display = prevDisplay;
        });
    }

    /* ── Wire skill inputs ────────────────────────────────────────── */
    function wireSkillInputs() {
        document.addEventListener('click', e => {
            const el = e.target;
            if (el.matches?.('#cs-skills input.cs-skill-input')) {
                const key = el.id.replace('cs-skill-', '');
                // el.previousElementSibling is the nameSpan directly preceding each input in the grid
                const label = el.previousElementSibling?.textContent?.replace(':', '').trim()
                    || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                rollPercent(parseInt(el.value) || 0, label);
                return;
            }
            if (el.matches?.('#cs-custom-skills .custom-skill-value')) {
                const row = el.closest('.custom-skill-row');
                const ni = row?.querySelector('.custom-skill-name');
                const lbl = row?.querySelector('label');
                const spec = row?.querySelector('select');
                let name = lbl ? lbl.textContent.replace(':', '').trim() : (ni ? ni.value : 'Skill');
                if (spec?.value) name += ` (${spec.value})`;
                rollPercent(parseInt(el.value) || 0, name);
                return;
            }
            if (el.matches?.('#lp-sheet .lp-skill-val')) {
                const row = el.closest('tr');
                const nameTd = row?.querySelector('td:nth-child(2)');
                const name = nameTd?.textContent?.trim() || 'Skill';
                const pct = parseInt(el.value) || 0;
                rollPercent(pct, name);
                return;
            }
            if (el.matches?.('#lp-weapons-tbody .lp-weapon-pct')) {
                const pct = parseInt(el.dataset.pct) || 0;
                const name = el.dataset.name || 'Weapon';
                rollPercent(pct, name);
                return;
            }
            if (el.matches?.('#lp-weapons-tbody .lp-weapon-skill-inp')) {
                const pct = parseInt(el.value) || 0;
                const row = el.closest('tr');
                const name = row?.querySelector('.lp-weapon-name-inp')?.value || 'Weapon';
                rollPercent(pct, name);
                return;
            }
            if (el.matches?.('#cs-stats input.stat-input')) {
                const stat = el.id.replace('cs-', '');
                rollPercent((parseInt(el.value) || 0) * 5, `${stat} × 5`);
                return;
            }
            if (el.matches?.('#stats .x5-value')) {
                const stat = (el.id || '').replace('-x5-value', '');
                const val = parseInt(el.textContent) || 0;
                rollPercent(val, `${stat} ×5`);
                return;
            }
            // LP sheet stat x5 spans (id pattern: lp-stat-STR-x5)
            if (el.matches?.('#lp-sheet span[id^="lp-stat-"][id$="-x5"]')) {
                const stat = (el.id || '').replace('lp-stat-', '').replace('-x5', '');
                const val = parseInt(el.textContent) || 0;
                if (val > 0) rollPercent(val, `${stat} ×5`);
                return;
            }
        });
    }

    /* ── Public API ───────────────────────────────────────────────── */
    window.dgDice = { roll: rollPercent, rollManual, _toggle: togglePanel, _select: selectDie };

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
            }
        });
    }

    /* ── Init ─────────────────────────────────────────────────────── */
    // Was window's 'load' event -- but buildPanel() only creates its own
    // fresh DOM nodes and appends them to <body>, and wireSkillInputs()
    // only wires a document-level click listener (matched by selector at
    // click time, not by looking anything up now) -- neither needs
    // external resources loaded, just the DOM itself. 'load' doesn't
    // fire until every subresource on the page finishes, including
    // whatever Table Radio (on every page) is currently streaming into
    // an iframe, which is what made this panel visibly take as long to
    // appear as the character-load lag fixed elsewhere on this same
    // page (see stats/scripts.js's dgInitStatsSheet() comment).
    const dgInitDiceRoller = () => {
        // Skill-click wiring runs regardless of SUPPRESS_OWN_PANEL --
        // this document is the one actually showing the sheet, so it's
        // the only place a skill click could ever be caught at all.
        // Everything else below is specifically about this instance's
        // OWN floating panel, which a suppressed instance never builds.
        wireSkillInputs();
        if (SUPPRESS_OWN_PANEL) return;
        buildPanel(); initHistory(); watchHandlerModeChange();
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', dgInitDiceRoller);
    } else {
        dgInitDiceRoller();
    }
})();
