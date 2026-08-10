/* ══════════════════════════════════════════════
   CLOUD SAVE (this hub's addition, not part of the upstream character
   creator)

   Opt-in, silent background sync of the current character to the Agent
   Portal's Google Apps Script backend, keyed by an Agent Code -- so a
   character built on one device can be picked up on another without an
   export/import file changing hands. Off by default: until a code
   exists (via "Start Cloud Save" or loading an existing code), nothing
   is sent anywhere, matching this app's existing all-local-by-default
   behavior. Once a code exists, every debounced edit pushes an upsert
   (same code overwrites its own row -- not a new one each time, unlike
   a Cover-form brief submission).

   Uses the exact same APPS_SCRIPT_URL and no-cors/keepalive POST pattern
   agent-portal-export.js already uses for Export to Agent File -- not a
   new backend integration, just a new `action` on the same endpoint.
   Requires a matching addition to the Apps Script project itself (see
   character-cloud-save-addition.gs, handed over separately) -- until
   that is pasted in and redeployed, saves/loads simply fail silently or
   return NOT_FOUND, the same graceful-degradation behavior this app
   already has for every other Apps Script call, so this feature is
   safe to ship ahead of that step.
   ══════════════════════════════════════════════ */
(function () {
    "use strict";

    const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxF32nCIUfXDcTaKntKkt8az_7mwy8aOAKPD0mtaEZHcUEKmq0AF2b2k4V6FJNEzbIJZQ/exec';
    const CLOUD_CODE_KEY = 'dg_stats_cloud_code';
    const SYNC_DEBOUNCE_MS = 4000;

    function genCloudCode(name) {
        const prefix = (name || 'AGNT').replace(/[^A-Za-z]/g, '').substring(0, 4).toUpperCase() || 'AGNT';
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let s = ''; for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
        return prefix + '-' + s;
    }

    function getCloudCode() {
        try { return localStorage.getItem(CLOUD_CODE_KEY) || ''; } catch (e) { return ''; }
    }
    function setCloudCode(code) {
        try { localStorage.setItem(CLOUD_CODE_KEY, code); } catch (e) { /* best effort */ }
        renderStatus();
    }
    function clearCloudCode() {
        try { localStorage.removeItem(CLOUD_CODE_KEY); } catch (e) { /* best effort */ }
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
        fetch(APPS_SCRIPT_URL, {
            method: 'POST', mode: 'no-cors', keepalive: true,
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({
                action: 'save_character',
                agent_code: code,
                character_json: JSON.stringify(state),
            }),
        }).then(() => renderStatus('☁ Synced — code ' + code))
          .catch(() => { /* silent, same as every other Apps Script call in this app */ });
    }

    let _syncDebounce;
    function scheduleCloudSync() {
        if (!getCloudCode()) return;
        clearTimeout(_syncDebounce);
        _syncDebounce = setTimeout(pushToCloud, SYNC_DEBOUNCE_MS);
    }
    document.addEventListener('input', scheduleCloudSync);
    document.addEventListener('change', scheduleCloudSync);

    function startCloudSave() {
        if (getCloudCode()) { renderStatus(); return; }
        const name = document.getElementById('cs-name')?.value || '';
        setCloudCode(genCloudCode(name));
        pushToCloud();
    }

    function stopCloudSave() {
        if (!getCloudCode()) return;
        if (!confirm('Stop cloud saving this character on this device? The last synced cloud copy is kept and can still be loaded by its code -- this only stops further updates from this browser.')) return;
        clearCloudCode();
    }

    function loadFromCloud(codeArg) {
        const code = (codeArg || prompt('Enter the Agent Code to load:') || '').trim().toUpperCase();
        if (!code) return;
        const status = document.getElementById('cloud-load-status');
        if (status) status.textContent = 'Loading…';

        const cbName = '_dgCloudLoadCb' + Date.now();
        window[cbName] = function (res) {
            delete window[cbName];
            const s = document.getElementById('_dg_cloud_load_script');
            if (s) s.remove();

            if (!res || res.status !== 'OK' || !res.character_json) {
                if (status) status.textContent = (res && res.status === 'NOT_FOUND')
                    ? 'No cloud save found for that code.'
                    : 'Could not load that character.';
                return;
            }
            let state;
            try { state = JSON.parse(res.character_json); }
            catch (e) { if (status) status.textContent = 'Could not read that cloud save.'; return; }

            window.dgSaveLoad.applyState(state);
            setTimeout(() => {
                window.dgSaveLoad.save?.();
                if (typeof syncLpFromForm === 'function') syncLpFromForm();
            }, 300);
            setCloudCode(code);
            if (status) status.textContent = 'Loaded!';
        };

        const script = document.createElement('script');
        script.id = '_dg_cloud_load_script';
        script.src = APPS_SCRIPT_URL + '?action=load_character&code=' + encodeURIComponent(code) + '&callback=' + cbName;
        document.head.appendChild(script);
    }

    window.dgCloudSave = { startCloudSave, stopCloudSave, loadFromCloud, getCloudCode };
    document.addEventListener('DOMContentLoaded', () => renderStatus());
})();
