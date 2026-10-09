/* ══════════════════════════════════════════════
   dgStore -- the one place player-facing pages read and write their
   data, straight to Firestore. Replaces every Apps Script call these
   pages used to make (load_character, save_character, the ?code= brief
   lookup, update_field/update_medical/update_aar/save_plate, the brief
   submission, find_by_player_name, handout notes, Notes identities and
   "seen" marks, AI prompt/image generation) -- the Google Sheet behind
   that backend is retired (see BUGFIXES.md "Sheet retired").

   Also owns the page's Firebase SDK loading: loadScript() reuses a
   script tag another widget on the page already added (loaded or still
   loading) instead of adding a second copy. Two copies of
   firebase-app-compat.js on one page ("Firebase is already defined in
   the global scope") left every Firestore call on that page hanging --
   see BUGFIXES.md.

   Data shapes (document id in braces):
     characters/{code}   agent_code, character_json (string), updated_at (ISO),
                         player_name, player_name_lc
     briefs/{code}       the Agent File / Profiling fields, keyed exactly as the
                         old ?code= lookup returned them (char_name, codename,
                         face_plate_url, era_90s_face_url, medical_log, ...),
                         plus player_name_lc
     handout_notes/{code}_{handoutId}   agent_code, handout_id, note, updated_at
     agent_identity/{code}              agent_code, color, font, updated_at
     evidence_seen/{code}_{evidenceId}  agent_code, evidence_id, seen_at
   ══════════════════════════════════════════════ */
(function () {
  "use strict";
  if (window.dgStore) return;

  const SDK_VERSION = '12.18.0';
  const CONFIG = {
    apiKey: 'AIzaSyBiFBvgmrjtacxXvh7FHa9a28BbwV0LnDQ',
    authDomain: 'dg-app-b3447.firebaseapp.com',
    projectId: 'dg-app-b3447',
    storageBucket: 'dg-app-b3447.firebasestorage.app',
    messagingSenderId: '464997490443',
    appId: '1:464997490443:web:dad47a347ae7a64a9e4c0e'
  };
  const BASE = 'https://www.gstatic.com/firebasejs/' + SDK_VERSION + '/';

  // A Firebase SDK script, added once per page no matter how many
  // widgets ask for it. Exposed as window.dgLoadFirebaseScript so the
  // older per-widget loaders (a-cell, dice roller, radio, agent hub,
  // notes) share it.
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      let s = Array.from(document.scripts).find(x => x.src === src);
      if (s && s.dataset.dgLoaded === '1') { resolve(); return; }
      if (s && s.dataset.dgFailed === '1') { s.remove(); s = null; }
      const timer = setTimeout(() => reject(new Error('Timed out loading ' + src + ' (15s) -- check network connection.')), 15000);
      const ok = () => { clearTimeout(timer); resolve(); };
      const bad = () => { clearTimeout(timer); reject(new Error('Failed to load ' + src + ' -- check network connection.')); };
      if (s) {
        s.addEventListener('load', ok, { once: true });
        s.addEventListener('error', bad, { once: true });
        return;
      }
      s = document.createElement('script');
      s.crossOrigin = 'anonymous';
      s.src = src;
      s.addEventListener('load', () => { s.dataset.dgLoaded = '1'; ok(); }, { once: true });
      s.addEventListener('error', () => { s.dataset.dgFailed = '1'; bad(); }, { once: true });
      document.head.appendChild(s);
    });
  }
  window.dgLoadFirebaseScript = window.dgLoadFirebaseScript || loadScript;

  let readyPromise = null;
  function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      const fb = () => window.firebase;
      if (!(fb() && fb().initializeApp)) await window.dgLoadFirebaseScript(BASE + 'firebase-app-compat.js');
      const firstInit = !fb().apps.length;
      if (firstInit) fb().initializeApp(CONFIG);
      if (!fb().auth) await window.dgLoadFirebaseScript(BASE + 'firebase-auth-compat.js');
      // Same per-tab sign-in as every other page (see BUGFIXES.md's
      // shared-persistence eviction entry) -- only on the page's first
      // init, before any sign-in.
      if (firstInit) {
        try { await fb().auth().setPersistence(fb().auth.Auth.Persistence.SESSION); } catch (e) { /* default persistence */ }
      }
      if (!fb().firestore) await window.dgLoadFirebaseScript(BASE + 'firebase-firestore-compat.js');
      if (!fb().functions) await window.dgLoadFirebaseScript(BASE + 'firebase-functions-compat.js');
      return fb();
    })();
    readyPromise.catch(() => { readyPromise = null; }); // a later call retries
    return readyPromise;
  }

  function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Timed out: ' + label + ' (' + Math.round(ms / 1000) + 's) -- check network connection.')), ms);
      promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
  }

  function norm(code) { return String(code || '').trim().toUpperCase(); }

  // Signs this tab in as an Agent (exchangeAgentToken mints a token for
  // the code -- knowing the code is the credential, as it always was).
  // The Handler's own session is left alone: a Handler may write any
  // Agent's data under the rules, so there's nothing to switch.
  const signInFor = {};
  function signInAgent(code) {
    code = norm(code);
    if (!code) return Promise.reject(new Error('No Agent Code.'));
    return ready().then(fb => {
      const auth = fb.auth();
      const u = auth.currentUser;
      if (u && (u.uid === code || u.uid === 'handler')) {
        return u.getIdTokenResult().then(r => {
          const c = r.claims || {};
          if (c.handler === true || c.agentCode === code) return u;
          return fresh();
        }, fresh);
      }
      return fresh();
      function fresh() {
        if (signInFor[code]) return signInFor[code];
        signInFor[code] = withTimeout(fb.functions().httpsCallable('exchangeAgentToken')({ agent_code: code }), 20000, 'exchangeAgentToken')
          .then(res => withTimeout(auth.signInWithCustomToken(res.data.token), 20000, 'sign-in'))
          .then(cred => cred.user)
          .finally(() => { delete signInFor[code]; });
        return signInFor[code];
      }
    });
  }

  function db() { return window.firebase.firestore(); }
  function docData(snap) { return snap && snap.exists ? snap.data() : null; }
  // A one-shot get() that fails (it can on a phone whose connection is
  // still coming up: "client is offline", or the 15s timeout) is tried
  // once more through a listener, which waits for the connection the way
  // the pages' live listeners do; the first answer from the server (or a
  // cached copy that exists) settles it.
  function getDoc(coll, id) {
    return ready().then(() => {
      const ref = db().collection(coll).doc(id);
      return withTimeout(ref.get(), 15000, 'reading ' + coll).catch(err => {
        // Only a connection that isn't there yet; any other error is final.
        const offline = err && (err.code === 'unavailable' || /offline|timed out/i.test(String(err.message || '')));
        if (!offline) throw err;
        return viaListener(ref, 12000, err);
      });
    }).then(docData);
  }
  function viaListener(ref, ms, firstErr) {
    return new Promise((resolve, reject) => {
      let done = false, unsub = null;
      const finish = () => { done = true; clearTimeout(t); if (unsub) unsub(); };
      const t = setTimeout(() => { finish(); reject(firstErr); }, ms);
      unsub = ref.onSnapshot(snap => {
        if (done) return;
        if (snap && snap.metadata && snap.metadata.fromCache && !snap.exists) return; // wait for the server
        finish(); resolve(snap);
      }, err => { if (done) return; finish(); reject(err || firstErr); });
      if (done && unsub) unsub();
    });
  }

  // ── Characters ──────────────────────────────────────────────
  function getCharacter(code) {
    code = norm(code);
    if (!code) return Promise.resolve(null);
    return getDoc('characters', code).then(d => (d && d.character_json ? d : null));
  }
  function saveCharacter(code, state) {
    code = norm(code);
    const playerName = String((state && state.bio && state.bio.player_name) || '').trim();
    return signInAgent(code).then(() => withTimeout(db().collection('characters').doc(code).set({
      agent_code: code,
      character_json: JSON.stringify(state || {}),
      updated_at: new Date().toISOString(),
      player_name: playerName,
      player_name_lc: playerName.toLowerCase()
    }, { merge: true }), 20000, 'saving character'));
  }

  // The Incursion (assets/incursion.js) on the Agent's own record, beside
  // character_json rather than inside it: saveCharacter() merges, so the
  // sheet's autosave never undoes a Handler's amendment. `by` is 'player'
  // or 'handler'. A-Cell writes through its own Handler session.
  function saveIncursion(code, value, by) {
    code = norm(code);
    const v = window.dgIncursion ? window.dgIncursion.normalize(value) : value;
    return signInAgent(code).then(() => withTimeout(db().collection('characters').doc(code).set({
      agent_code: code,
      incursion: Object.assign({}, v, { by: by || 'player', updated_at: new Date().toISOString() })
    }, { merge: true }), 20000, 'saving the Incursion'));
  }

  // ── Briefs (Agent File / Profiling) ─────────────────────────
  function getBrief(code) {
    code = norm(code);
    if (!code) return Promise.resolve(null);
    return getDoc('briefs', code);
  }
  function briefPatch(fields) {
    const patch = Object.assign({}, fields);
    delete patch.action; delete patch.token; delete patch.id_token;
    if (Object.prototype.hasOwnProperty.call(patch, 'player_name')) {
      patch.player_name_lc = String(patch.player_name || '').trim().toLowerCase();
    }
    return patch;
  }
  // Partial update of one Agent's brief -- only the named fields change.
  function updateBrief(code, fields) {
    code = norm(code);
    return signInAgent(code).then(() => withTimeout(
      db().collection('briefs').doc(code).set(briefPatch(fields), { merge: true }), 20000, 'saving Agent File'));
  }
  // A Profiling submission. With a code: an update of that Agent's brief.
  // Without one: mints a fresh code (retrying on the rare collision) and
  // creates the brief. Resolves with the Agent Code.
  function submitBrief(fields) {
    const given = norm(fields && fields.agent_code);
    const now = new Date().toISOString();
    if (given) {
      const patch = Object.assign({}, fields, { agent_code: given, submitted_at: now });
      // A blank Player Name never overwrites one already on file.
      if (!String(patch.player_name || '').trim()) delete patch.player_name;
      return updateBrief(given, patch).then(() => given);
    }
    const gen = (window.dgAgentCode && window.dgAgentCode.gen) || (n => 'AGNT-' + Math.random().toString(36).slice(2, 6).toUpperCase());
    let attempts = 0;
    function tryOnce() {
      const code = norm(gen(fields && fields.char_name));
      attempts++;
      return signInAgent(code).then(() => {
        const ref = db().collection('briefs').doc(code);
        return db().runTransaction(tx => tx.get(ref).then(snap => {
          if (snap.exists) return false;
          tx.set(ref, briefPatch(Object.assign({}, fields, { agent_code: code, submitted_at: now })));
          return true;
        }));
      }).then(created => {
        if (created) return code;
        if (attempts >= 5) throw new Error('Could not mint a free Agent Code -- try again.');
        return tryOnce();
      });
    }
    return tryOnce();
  }

  // The Agent's main photo (Hub card, Live Play tracker, A-Cell, Field ID
  // card, Field Notes). Each era keeps its own Face Plate
  // (era_<era>_face_url, the source of truth since the per-era fix) and
  // face_plate_url was only a copy of the Active Era's, set in a few
  // narrow cases -- an Agent with two era photos and an Active Era could
  // still have none there. Same rule the Agent File's own era stack uses:
  // the Active Era's Plate (none yet means no photo -- never another
  // era's); with no Active Era chosen, the first era's. face_plate_url
  // stands in for that first era only (a pre-per-era Agent's one photo).
  const ERA_KEYS = ['90s', '00s', '10s', '20s'];
  function eraKey(era) {
    const e = String(era || '').trim().toLowerCase();
    const m = e.match(/^(?:19|20)?(\d0s)$/);
    return m ? m[1] : e;
  }
  // A Drive share/uc link becomes gdrive:ID, the form every photo loader
  // sends through the imgdata proxy (a raw Drive link won't load in an <img>).
  function photoRef(u) {
    u = String(u || '').trim();
    if (!u || !/drive\.google\.com|docs\.google\.com/.test(u)) return u;
    const m = u.match(/\/file\/d\/([^\/?]+)/) || u.match(/[?&]id=([^&]+)/);
    return m ? 'gdrive:' + m[1] : u;
  }
  function mainPhoto(b) {
    if (!b) return '';
    let order = [];
    try { order = Array.isArray(b.active_eras) ? b.active_eras : JSON.parse(b.active_eras || '[]'); } catch (e) { order = [b.active_eras]; }
    order = (Array.isArray(order) ? order : []).map(eraKey).filter(e => ERA_KEYS.indexOf(e) !== -1);
    const first = order[0] || '';
    const era = eraKey(b.campaign_era) || first;
    if (!era) return photoRef(b.face_plate_url);
    // No era list at all (an Agent File from before per-era photos): the
    // portal shows face_plate_url as its one era's photo (parseEras()), so
    // it counts here too, whatever campaign_era says.
    return photoRef(b['era_' + era + '_face_url'] || (era === first || !first ? b.face_plate_url : '') || '');
  }

  // "Load My Agents": every Agent whose brief or character sheet carries
  // this player name -- same merged shape find_by_player_name returned.
  function findByPlayerName(name) {
    const needle = String(name || '').trim().toLowerCase();
    if (!needle) return Promise.resolve([]);
    return ready().then(() => Promise.all([
      withTimeout(db().collection('briefs').where('player_name_lc', '==', needle).get(), 15000, 'searching Agent Files'),
      withTimeout(db().collection('characters').where('player_name_lc', '==', needle).get(), 15000, 'searching characters')
    ])).then(([briefs, chars]) => {
      // A character found by name whose Agent File doesn't carry the name
      // (yet) still brings that Agent File's photo, codename and eras.
      const have = {};
      briefs.forEach(d => { have[d.id] = true; });
      const missing = [];
      chars.forEach(d => { if (!have[d.id]) missing.push(d.id); });
      return Promise.all(missing.map(code => withTimeout(db().collection('briefs').doc(code).get(), 15000, 'reading Agent Files')
        .catch(() => null)))
        .then(extra => [briefs, chars, extra.filter(s => s && s.exists)]);
    }).then(([briefs, chars, extraBriefs]) => {
      const byCode = {};
      briefs.docs.concat(extraBriefs).forEach(d => {
        const b = d.data();
        byCode[d.id] = {
          code: d.id, char_name: b.char_name || '', codename: b.codename || '', sex: b.sex || '',
          age_range: b.age_range || '', nationality: b.nationality || '', face_plate_url: mainPhoto(b),
          active_eras: b.active_eras || '', campaign_era: b.campaign_era || '', saved_at: Date.now()
        };
      });
      chars.forEach(d => {
        const c = d.data();
        let bio = {};
        try { bio = (JSON.parse(c.character_json || '{}') || {}).bio || {}; } catch (e) { /* unparsable */ }
        const ex = byCode[d.id] || {};
        const t = c.updated_at ? new Date(c.updated_at).getTime() : NaN;
        byCode[d.id] = {
          code: d.id, char_name: bio.name || ex.char_name || '', codename: ex.codename || '',
          sex: bio.sex || ex.sex || '', age_range: bio.age || ex.age_range || '',
          nationality: bio.nationality || ex.nationality || '', face_plate_url: ex.face_plate_url || '',
          active_eras: ex.active_eras || '', campaign_era: ex.campaign_era || '',
          saved_at: isNaN(t) ? Date.now() : t
        };
      });
      return Object.values(byCode);
    });
  }

  // ── Handout notes (Agent Hub) ───────────────────────────────
  function listHandoutNotes(code) {
    code = norm(code);
    return signInAgent(code).then(() => withTimeout(
      db().collection('handout_notes').where('agent_code', '==', code).get(), 15000, 'reading handout notes'))
      .then(snap => { const out = []; snap.forEach(d => { const n = d.data(); if (n.note) out.push({ handout_id: n.handout_id, note: n.note }); }); return out; });
  }
  function saveHandoutNote(code, handoutId, note) {
    code = norm(code);
    return signInAgent(code).then(() => withTimeout(db().collection('handout_notes').doc(code + '_' + handoutId).set({
      agent_code: code, handout_id: String(handoutId), note: note || '', updated_at: Date.now()
    }), 15000, 'saving handout note'));
  }

  // ── Notes: identity (color/font) and Evidence "seen" marks ─────
  function getIdentities(codes) {
    const list = Array.from(new Set((codes || []).map(norm).filter(Boolean)));
    return ready().then(() => Promise.all(list.map(c => withTimeout(db().collection('agent_identity').doc(c).get(), 15000, 'reading identities'))))
      .then(snaps => { const out = {}; snaps.forEach(s => { if (s.exists) { const d = s.data(); out[s.id] = { color: d.color || '', font: d.font || '' }; } }); return out; });
  }
  function saveIdentity(code, color, font) {
    code = norm(code);
    return signInAgent(code).then(() => withTimeout(db().collection('agent_identity').doc(code).set({
      agent_code: code, color: color || '', font: font || '', updated_at: Date.now()
    }), 15000, 'saving identity'));
  }
  function listSeen(code) {
    code = norm(code);
    return ready().then(() => withTimeout(db().collection('evidence_seen').where('agent_code', '==', code).get(), 15000, 'reading seen marks'))
      .then(snap => { const out = {}; snap.forEach(d => { out[d.data().evidence_id] = true; }); return out; });
  }
  function markSeen(code, evidenceId) {
    code = norm(code);
    return ready().then(() => withTimeout(db().collection('evidence_seen').doc(code + '_' + evidenceId).set({
      agent_code: code, evidence_id: String(evidenceId), seen_at: Date.now()
    }), 15000, 'saving seen mark'));
  }

  // ── Erase Agent (Agent Hub) ─────────────────────────────────
  // The Agent's own session moves its character and Agent File into
  // deleted_agents/{code} -- the same record A-Cell's Handler delete
  // makes, so a Handler can restore it from Recently Deleted within 24h.
  function deleteOwnAgent(code) {
    code = norm(code);
    return signInAgent(code).then(() => {
      const cRef = db().collection('characters').doc(code);
      const bRef = db().collection('briefs').doc(code);
      return withTimeout(db().runTransaction(tx => Promise.all([tx.get(cRef), tx.get(bRef)]).then(([c, b]) => {
        if (!c.exists && !b.exists) return false;
        tx.set(db().collection('deleted_agents').doc(code), {
          agent_code: code, deleted_at: Date.now(), deleted_by: 'agent',
          character: c.exists ? c.data() : null, brief: b.exists ? b.data() : null
        });
        if (c.exists) tx.delete(cRef);
        if (b.exists) tx.delete(bRef);
        return true;
      })), 15000, 'deleting Agent');
    });
  }

  // ── AI (Cloud Functions; the API keys live there) ────────────
  function callFunction(code, name, payload, ms) {
    return signInAgent(code).then(() => withTimeout(
      window.firebase.functions().httpsCallable(name, { timeout: ms })(payload), ms + 5000, name))
      .then(res => res.data);
  }
  function generatePrompt(code, payload) { return callFunction(code, 'generatePrompt', payload, 120000); }
  function generatePlateImage(code, payload) { return callFunction(code, 'generatePlateImage', payload, 180000); }

  window.dgStore = {
    ready, loadScript, signInAgent,
    getCharacter, saveCharacter, saveIncursion,
    getBrief, updateBrief, submitBrief, findByPlayerName,
    listHandoutNotes, saveHandoutNote,
    getIdentities, saveIdentity, listSeen, markSeen, deleteOwnAgent, mainPhoto, photoRef,
    generatePrompt, generatePlateImage
  };
})();
