/* ══════════════════════════════════════════════
   CLOUD SAVE (this hub's addition, not part of the upstream character
   creator)

   Automatic background sync of the current character to the Agent
   Portal's Google Apps Script backend, keyed by an Agent Code -- so a
   character built on one device can be picked up on another without an
   export/import file changing hands. Auto-starts on the first edit made
   once the agent has a real name (the same "is this actually a
   character yet" threshold agent-portal-export.js already uses) -- not
   on literally any interaction, so idle theme-switching or point-buy
   fiddling before naming an agent doesn't mint a throwaway row in the
   Characters tab for every casual visitor. Once a code exists, every
   debounced edit pushes an upsert (same code overwrites its own row --
   not a new one each time, unlike a Cover-form brief submission).

   No manual start or stop button: once a character is named, syncing
   it is just how this page behaves now, same as the pre-existing
   localStorage autosave it sits alongside -- not a togglable setting.
   Only loadFromCloud() (below) is still an explicit action, since
   pulling a character down inherently needs a code from the player.

   Uses the exact same APPS_SCRIPT_URL and no-cors/keepalive POST pattern
   agent-portal-export.js already uses for Export to Agent File -- not a
   new backend integration, just a new `action` on the same endpoint.
   Requires a matching addition to the Apps Script project itself (see
   character-cloud-save-addition.gs, handed over separately) -- deployed
   and confirmed working.
   ══════════════════════════════════════════════ */
(function () {
    "use strict";

    const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxF32nCIUfXDcTaKntKkt8az_7mwy8aOAKPD0mtaEZHcUEKmq0AF2b2k4V6FJNEzbIJZQ/exec';
    const CLOUD_CODE_KEY = 'dg_stats_cloud_code';
    const SYNC_DEBOUNCE_MS = 4000;
    const ROSTER_KEY = 'dg_agent_roster';

    // agent-hub.html's player-facing roster reads only this key, written
    // only by dg-agent-portal.html's "New Recruit" flow -- a character
    // built or imported straight here (any importer, or a Cloud Save code
    // typed in) never touched it, so it existed in the cloud/Handler view
    // but was invisible in this browser's own Agent Hub. Mirror just
    // enough of rosterAddAgent()'s shape (dg-agent-portal.html) to show up
    // there; merge rather than overwrite so a codename/face plate set
    // later via the Agent Portal's Cover form isn't clobbered.
    function rosterUpsert(code, name, playerName) {
        if (!code) return;
        try {
            const roster = JSON.parse(localStorage.getItem(ROSTER_KEY) || '{}');
            const existing = roster[code] || {};
            roster[code] = Object.assign({}, existing, {
                code: code,
                char_name: name || existing.char_name || '',
                // See rosterAddAgent()'s matching comment in
                // dg-agent-portal.html -- lets a Cover Identity search
                // there tell an unclaimed Agent from one already tied to
                // a different real name.
                player_name: (playerName || existing.player_name || '').trim(),
                saved_at: Date.now(),
            });
            localStorage.setItem(ROSTER_KEY, JSON.stringify(roster));
        } catch (e) { /* best effort, same as every other localStorage write here */ }
    }

    // Shared with dg-agent-portal.html and stats/agent-portal-export.js
    // via assets/agent-code.js -- was its own independent copy of the
    // same algorithm before this file existed.
    function genCloudCode(name) {
        return window.dgAgentCode.gen(name);
    }

    function getCloudCode() {
        try { return localStorage.getItem(CLOUD_CODE_KEY) || ''; } catch (e) { return ''; }
    }
    function setCloudCode(code) {
        try { localStorage.setItem(CLOUD_CODE_KEY, code); } catch (e) { /* best effort */ }
        renderStatus();
    }

    function renderStatus(msg) {
        const el = document.getElementById('cloud-save-status');
        if (!el) return;
        const code = getCloudCode();
        if (!code) { el.textContent = ''; return; }
        el.textContent = msg || ('☁ Cloud Save active — code ' + code);
    }

    function pushToCloud() {
        const code = getCloudCode();
        if (!code || !window.dgSaveLoad?.collectState) return;
        const state = window.dgSaveLoad.collectState();
        rosterUpsert(code, state.bio?.name, state.bio?.player_name);
        fetch(APPS_SCRIPT_URL, {
            method: 'POST', mode: 'no-cors', keepalive: true,
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'save_character',
                agent_code: code,
                character_json: JSON.stringify(state),
                // Also sent as its own top-level field (not just buried in
                // character_json) so the backend can write it to its own
                // queryable column -- see the Cover Identity addition,
                // which looks characters up by this field directly rather
                // than scanning and JSON-parsing every row's blob.
                player_name: state.bio?.player_name || '',
            }),
        }).then(() => renderStatus('☁ Synced — code ' + code))
          .catch(() => { /* silent, same as every other Apps Script call in this app */ });
    }

    // Mints a code on first meaningful edit (a real name present) if one
    // doesn't already exist, and pushes right away for immediate feedback
    // rather than leaving the player staring at a status line for up to
    // SYNC_DEBOUNCE_MS. Returns '' when there's nothing to name yet,
    // which scheduleCloudSync() below treats as "nothing to do."
    function ensureCloudCode() {
        const existing = getCloudCode();
        if (existing) return existing;
        const name = (document.getElementById('cs-name')?.value || '').trim();
        if (!name || name === 'Agent') return '';
        const code = genCloudCode(name);
        setCloudCode(code);
        rosterUpsert(code, name);
        pushToCloud();
        return code;
    }

    let _syncDebounce;
    function scheduleCloudSync() {
        const code = ensureCloudCode();
        if (!code) return;
        clearTimeout(_syncDebounce);
        _syncDebounce = setTimeout(pushToCloud, SYNC_DEBOUNCE_MS);
    }
    document.addEventListener('input', scheduleCloudSync);
    document.addEventListener('change', scheduleCloudSync);

    function loadFromCloud(codeArg, opts) {
        opts = opts || {};
        const code = (codeArg || '').trim().toUpperCase();
        const status = document.getElementById('cloud-load-status');
        if (!code) {
            if (status) status.textContent = 'Enter an Agent Code above, then press Load.';
            if (typeof opts.onSettled === 'function') opts.onSettled();
            return;
        }
        if (status) status.textContent = 'Loading…';

        const cbName = '_dgCloudLoadCb' + Date.now();
        window[cbName] = function (res) {
            delete window[cbName];
            const s = document.getElementById('_dg_cloud_load_script');
            if (s) s.remove();
            // Fired the instant the JSONP response actually arrives, before
            // any JSON.parse/applyState work -- lets a caller (the ?load=
            // deep-link handler below) tell "the network round trip was
            // slow" apart from "the response came back fast but applying
            // it took a while", which otherwise isn't distinguishable from
            // the outside (a real report of an unexplained multi-second
            // load with no visible cause in Apps Script's own Executions
            // log -- this makes it visible without needing DevTools).
            if (typeof opts.onResponseReceived === 'function') opts.onResponseReceived();

            if (!res || res.status !== 'OK' || !res.character_json) {
                if (res && res.status === 'NOT_FOUND' && opts.onNotFound) {
                    opts.onNotFound();
                    return;
                }
                if (status) status.textContent = (res && res.status === 'NOT_FOUND')
                    ? 'No cloud save found for that code.'
                    : 'Could not load that character.';
                // Every other outcome here -- a genuinely empty response, or
                // a real backend error (status: 'ERROR', or an OK row with
                // somehow no character_json) -- used to just return with no
                // callback at all. A caller with its own "reveal once
                // settled, whichever way" gate (the ?load= deep-link handler
                // below) had no way to hear about it, so that gate sat stuck
                // until its own hardcoded safety timeout finally fired --
                // which, on a consistently-erroring code, looked exactly
                // like a consistent multi-second lag on every single load,
                // regardless of how fast the backend actually responded.
                if (typeof opts.onSettled === 'function') opts.onSettled();
                return;
            }
            let state;
            try { state = JSON.parse(res.character_json); }
            catch (e) {
                if (status) status.textContent = 'Could not read that cloud save.';
                if (typeof opts.onSettled === 'function') opts.onSettled();
                return;
            }

            const applyLoadedState = () => {
                // skipCloudCodeMint: this load already knows its own code (the
                // one just fetched by) -- letting applyState() mint one of its
                // own from the name it's about to write would race a fresh,
                // wrong code into place a moment before the line below
                // overwrites it with the right one, needlessly pushing a
                // throwaway save under an orphaned code first.
                window.dgSaveLoad.applyState(state, { skipCloudCodeMint: true });
                setTimeout(() => {
                    window.dgSaveLoad.save?.();
                    if (typeof syncLpFromForm === 'function') syncLpFromForm();
                }, 300);
                // Only now is it safe for a caller to act on the applied
                // state (e.g. switching on Live Play) -- an independent
                // timer of its own could still land inside the same init
                // hazard window this just waited out, or run before this
                // state was actually applied at all.
                if (typeof opts.onApplied === 'function') opts.onApplied();
            };
            // scripts.js builds the stat/skill DOM (#STR-value etc.) inside
            // its own window.onload handler -- much later than the
            // DOMContentLoaded this JSONP fetch started on -- and that same
            // handler has its own defensive "reset stats again 50ms later
            // to override any DOM mutations" timer (see the setTimeout
            // right after resetStats() in scripts.js's window.onload). A
            // fast cloud response landing in either gap (before the DOM
            // exists at all, or in that 50ms window) gets silently
            // stomped: applyState()'s writes land on nothing or get reset
            // right back to defaults a moment later. save-load.js's own
            // local-restore already knows to wait "window.load + 200ms" to
            // clear both hazards (see its own INIT comment) -- match that
            // exact convention here instead of only checking readyState,
            // which is satisfied at window.load, before the 50ms timer.
            const runPastInitHazards = () => setTimeout(applyLoadedState, 250);
            if (document.readyState === 'complete') {
                runPastInitHazards();
            } else {
                window.addEventListener('load', runPastInitHazards, { once: true });
            }
            setCloudCode(code);
            rosterUpsert(code, state.bio?.name, state.bio?.player_name);
            if (status) status.textContent = 'Loaded!';
            const codeInput = document.getElementById('cloud-load-code-input');
            if (codeInput) codeInput.value = '';
        };

        const script = document.createElement('script');
        script.id = '_dg_cloud_load_script';
        script.src = APPS_SCRIPT_URL + '?action=load_character&code=' + encodeURIComponent(code) + '&callback=' + cbName;
        script.onerror = () => {
            delete window[cbName];
            if (status) status.textContent = 'Connection error. Try again.';
            if (typeof opts.onSettled === 'function') opts.onSettled();
        };
        document.head.appendChild(script);
    }

    // Called when a `?load=` deep link's Agent Code has no cloud character
    // yet (a real case: an Agent File was submitted, but that Agent hasn't
    // been through Character Creation). Without this, the page would just
    // keep showing whatever character was last auto-saved locally on this
    // device -- e.g. a *different* Agent from a previous session -- with
    // no indication anything was wrong, silently misattributing edits to
    // the wrong Agent. Instead: wipe the stale sheet, adopt this Agent's
    // code so the very first save syncs under it (not a new random code),
    // and open the Character Creation Wizard so the Handler/player can
    // build this Agent's sheet right away.
    //
    // A "not found" here is a genuine, deliberate ground truth as far as
    // this page can tell -- but being wrong about it is catastrophic:
    // once resetSheet()+setCloudCode() run, every subsequent edit's
    // debounced auto-save (scheduleCloudSync(), wired to input/change
    // events all over the page) silently overwrites whatever the real
    // Characters-sheet row for this exact code holds, field by field, as
    // the wizard is filled in -- there is no undo on this page. A backend
    // lookup that's flaky, or a genuinely-existing Agent whose sheet just
    // hasn't synced from this device yet, both look identical to "doesn't
    // exist" from here. So this requires an explicit human confirmation
    // before doing anything destructive, the same way clearSheet() (the
    // manual "Clear Sheet" button) already does -- this path just reaches
    // the same wipe automatically instead of via a button click.
    async function startRecruitFlow(code) {
        // dgConfirm (save-load.js), not window.confirm() -- confirm() is
        // silently disabled in an iOS standalone PWA, which made this whole
        // flow look like a dead end (no dialog, sheet just stays blank).
        const proceed = window.dgConfirm
            ? await window.dgConfirm(
                'No cloud-saved character sheet was found for Agent Code ' + code + '.\n\n' +
                'If this Agent already HAS a character sheet, continuing will start a BLANK one under the same code -- and every change you make from here will overwrite the real one as you go, with no undo.\n\n' +
                'Only continue if you\'re sure this Agent has never been through Character Creation yet. Choose Cancel if you\'re not sure -- check with your Handler first.'
            )
            : confirm(
                'No cloud-saved character sheet was found for Agent Code ' + code + '.\n\n' +
                'If this Agent already HAS a character sheet, continuing will start a BLANK one under the same code -- and every change you make from here will overwrite the real one as you go, with no undo.\n\n' +
                'Only continue if you\'re sure this Agent has never been through Character Creation yet. Choose Cancel if you\'re not sure -- check with your Handler first.'
            );
        if (!proceed) {
            const status = document.getElementById('cloud-load-status');
            if (status) status.textContent = 'Not loaded -- no cloud character was found, and you chose not to start a blank one.';
            return;
        }
        if (window.dgSaveLoad?.resetSheet) window.dgSaveLoad.resetSheet();
        setCloudCode(code);
        // skipSave: true -- otherwise setTheme() immediately re-saves the
        // sheet to localStorage exactly as it stands right now (still
        // blank, since the Agent File name fetch below hasn't resolved
        // yet), and that blank snapshot then wins when save-load.js's own
        // restore runs moments later, wiping out the pre-filled name.
        if (typeof setTheme === 'function') setTheme('modern', { skipSave: true });
        setTimeout(() => { if (window.dgWizard?.activate) window.dgWizard.activate(); }, 200);

        // Best-effort: the Agent File (submitted separately, via the Cover
        // form or Agent File export) may already know this Agent's name --
        // pre-fill it so the wizard doesn't open on a totally blank sheet.
        const cbName = '_dgRecruitAgentFileCb' + Date.now();
        window[cbName] = function (res) {
            delete window[cbName];
            const s = document.getElementById('_dg_recruit_af_script');
            if (s) s.remove();
            const nameEl = document.getElementById('cs-name');
            if (res && res.status === 'OK' && res.data?.char_name && nameEl && !nameEl.value) {
                nameEl.value = res.data.char_name;
            }
        };
        const script = document.createElement('script');
        script.id = '_dg_recruit_af_script';
        script.src = APPS_SCRIPT_URL + '?code=' + encodeURIComponent(code) + '&callback=' + cbName;
        document.head.appendChild(script);
    }

    window.dgCloudSave = { loadFromCloud, getCloudCode, ensureCloudCode };
    document.addEventListener('DOMContentLoaded', () => renderStatus());

    // agent-hub.html's Agent Files "Play" button links here as
    // `?load=XXXX-YYYY&live=1` -- load that exact agent from the cloud and
    // jump straight to Live Play (over whichever theme this device last
    // used -- Live Play is a mode, not a theme of its own), rather than
    // leaving whatever was last auto-saved in this browser showing. If
    // that Agent Code has no cloud character yet, startRecruitFlow() takes
    // over instead (see above) rather than silently leaving a stale
    // character on screen.
    document.addEventListener('DOMContentLoaded', () => {
        const params = new URLSearchParams(window.location.search);
        const loadCode = params.get('load');
        if (!loadCode) return;
        const wantLive = params.get('live') === '1';
        // Matches the inline script at the top of <body> that gated
        // #app-main behind body.dg-agent-loading the instant it saw this
        // same ?load= param -- lift the gate once this load has actually
        // settled, whichever way it settles, so the sheet only ever
        // becomes visible already showing its final state (never a blank
        // flash first). onSettled is loadFromCloud()'s catch-all -- covers
        // every outcome that isn't a clean success or a clean NOT_FOUND (a
        // backend error, an empty/malformed response, a JSON parse
        // failure, a network error). Before onSettled existed, none of
        // those called back at all, so this gate sat stuck until the 8s
        // safety timeout below -- on a code that consistently errored,
        // that looked exactly like a consistent multi-second lag on every
        // single load, no matter how fast the backend actually responded
        // (a real report). The safety timeout is now a true last resort,
        // for a request that never resolves at all (connection just hangs
        // with no error event).
        let revealed = false;
        const revealGate = () => {
            if (revealed) return;
            revealed = true;
            document.body.classList.remove('dg-agent-loading');
        };
        // On-screen load-timing badge. Added after two shipped fixes (a
        // backend read-speed fix, then this same gate's error-handling)
        // were each individually reported as NOT fixing a real "8-10s
        // before the sheet appears" lag -- with no DevTools available
        // (iPad Safari) there was no way to see WHERE the time was
        // actually going. This makes that visible directly on the
        // device that's slow, no tooling required. Deliberately built
        // as its own fixed-position element, outside
        // #dg-agent-loading-notice -- that overlay is entirely gated by
        // body.dg-agent-loading (see stats/styles.css) and disappears
        // the instant revealGate() fires, which would erase the numbers
        // before they could be read. Left on screen (not
        // auto-dismissed) so there's time to read and report it back.
        const loadStart = performance.now();
        const badge = document.createElement('div');
        badge.id = 'dg-load-timing-badge';
        badge.style.cssText = 'position:fixed;bottom:10px;right:10px;z-index:9999;' +
            'font-family:"JetBrains Mono",monospace;font-size:11px;color:#3ef07a;' +
            'background:rgba(10,10,10,.85);border:1px solid #1f3d2a;border-radius:4px;' +
            'padding:5px 8px;pointer-events:none;white-space:pre;';
        badge.textContent = 'load: 0.0s';
        document.body.appendChild(badge);
        const tick = setInterval(() => {
            badge.textContent = 'load: ' + ((performance.now() - loadStart) / 1000).toFixed(1) + 's';
        }, 100);
        let responseAt = null;
        const onResponseReceived = () => {
            responseAt = performance.now() - loadStart;
        };
        const finishBadge = () => {
            clearInterval(tick);
            const total = (performance.now() - loadStart) / 1000;
            badge.textContent = responseAt !== null
                ? 'response: ' + (responseAt / 1000).toFixed(1) + 's · total: ' + total.toFixed(1) + 's'
                : 'total: ' + total.toFixed(1) + 's (no response)';
        };
        setTimeout(() => { revealGate(); finishBadge(); }, 8000);

        loadFromCloud(loadCode, {
            onResponseReceived,
            onNotFound: () => { revealGate(); finishBadge(); startRecruitFlow(loadCode); },
            // Chained to fire only once the loaded state has actually been
            // applied (past the same page-init hazard window
            // applyLoadedState() itself waits out) -- an independent timer
            // here could still land before the state was applied, or
            // inside that same hazard window, and get its own effects
            // (buildLpSheet() reading stats that are still default 3s)
            // silently stomped right along with it.
            onApplied: () => { revealGate(); finishBadge(); if (wantLive && typeof setLivePlay === 'function') setLivePlay(true); },
            onSettled: () => { revealGate(); finishBadge(); },
        });
    });

    // agent-hub.html's "New Recruit" card links here as `?new=1` -- a
    // totally blank sheet, not whatever this device last auto-saved
    // locally (which could be a different, already-played Agent). Runs
    // on DOMContentLoaded, which always fires before save-load.js's own
    // restore (window 'load' + 200ms), so the wipe is guaranteed to land
    // before loadLocal() would otherwise repopulate the form. Also drops
    // any remembered Cloud Save code so the new character mints its own
    // fresh code on first save, instead of silently overwriting whatever
    // Agent that old code belonged to.
    document.addEventListener('DOMContentLoaded', () => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('new') !== '1') return;
        if (window.dgSaveLoad?.resetSheet) window.dgSaveLoad.resetSheet();
        try { localStorage.removeItem(CLOUD_CODE_KEY); } catch (e) { /* best effort */ }
        renderStatus();
        // Strip ?new=1 so a later refresh (after the player has started
        // filling in this new Agent) doesn't wipe it out a second time.
        params.delete('new');
        const clean = window.location.pathname + (params.toString() ? '?' + params.toString() : '') + window.location.hash;
        history.replaceState(null, '', clean);
    });
})();
