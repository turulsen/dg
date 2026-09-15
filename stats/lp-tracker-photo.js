/* ══════════════════════════════════════════════
   LIVE PLAY TRACKER BAR — Face Plate photo box (lp-tracker-photo.js)

   Shows this Agent's Face Plate (briefs/{code}.face_plate_url) in the
   sticky tracker bar's photo item -- a live, public-read Firestore
   read, same posture as a-cell.html's own Play tab and agent-hub.html's
   Initiative post-it (no per-Agent sign-in needed: briefs is
   public-read, see firestore.rules). No character-sheet backend action
   involved at all; this is purely an overlay on top of whatever Cloud
   Save code the sheet already has.

   Called from lpSyncBar() (scripts.js) on every sync, not just once at
   load -- that's the only hook that already fires whenever a fresh
   Cloud Save code gets minted (a brand-new character has none until
   named), so re-checking there is simpler than inventing a second event
   just for this.
   ══════════════════════════════════════════════ */
(function () {
  "use strict";
  const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxF32nCIUfXDcTaKntKkt8az_7mwy8aOAKPD0mtaEZHcUEKmq0AF2b2k4V6FJNEzbIJZQ/exec';
  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyBiFBvgmrjtacxXvh7FHa9a28BbwV0LnDQ',
    authDomain: 'dg-app-b3447.firebaseapp.com',
    projectId: 'dg-app-b3447',
    storageBucket: 'dg-app-b3447.firebasestorage.app',
    messagingSenderId: '464997490443',
    appId: '1:464997490443:web:dad47a347ae7a64a9e4c0e'
  };

  const MISSING_HTML = '<a class="lp-tracker-photo-missing" href="#" onclick="dgGoToAgentFile(); return false;" title="Open this Agent\'s File to take a photo">Take Photo</a>';

  // Same on-demand Firebase script loading pattern as every other widget
  // on this page (dice-roller.js's own copy, notes/notes.js, a-cell.html)
  // -- a plain check of window.firebase first means this is a no-op the
  // instant another widget on the page has already finished loading it.
  let firebaseApiLoading = false;
  let firebaseApiCallbacks = [];
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
    document.head.appendChild(s);
  }
  function ensureFirebaseApi(cb, onerror) {
    const ready = () => window.firebase && window.firebase.firestore;
    if (ready()) { cb(); return; }
    firebaseApiCallbacks.push({ ok: cb, err: onerror || (() => {}) });
    if (firebaseApiLoading) return;
    firebaseApiLoading = true;
    const base = 'https://www.gstatic.com/firebasejs/12.18.0/';
    function fail(err) {
      firebaseApiLoading = false;
      const cbs = firebaseApiCallbacks; firebaseApiCallbacks = [];
      cbs.forEach(pair => pair.err(err));
    }
    loadScript(base + 'firebase-app-compat.js', () => {
      loadScript(base + 'firebase-firestore-compat.js', () => {
        if (!window.firebase.apps.length) window.firebase.initializeApp(FIREBASE_CONFIG);
        const cbs = firebaseApiCallbacks; firebaseApiCallbacks = [];
        cbs.forEach(pair => pair.ok());
      }, fail);
    }, fail);
  }

  // Legacy Drive-hosted face plates (uploaded before Phase 4) are stored
  // as gdrive:FILE_ID, not a direct URL -- same imgdata JSONP proxy
  // a-cell.html's resolveFacePlateInto() already uses for the exact same
  // reason (Drive's own access rules don't allow a plain <img src>).
  function resolvePhoto(url, box) {
    if (!url) { box.innerHTML = MISSING_HTML; return; }
    if (/^https?:\/\//.test(url)) { box.innerHTML = '<img src="' + url + '" alt="">'; return; }
    const m = url.match(/^gdrive:(.+)$/);
    if (!m) { box.innerHTML = MISSING_HTML; return; }
    const cbName = '_lpTrackerFace_' + Date.now();
    window[cbName] = function (json) {
      delete window[cbName];
      const s = document.getElementById('s-' + cbName);
      if (s) s.remove();
      if (json && json.status === 'OK' && json.dataUri) box.innerHTML = '<img src="' + json.dataUri + '" alt="">';
      else box.innerHTML = MISSING_HTML;
    };
    const s = document.createElement('script');
    s.id = 's-' + cbName;
    s.src = APPS_SCRIPT_URL + '?action=imgdata&id=' + encodeURIComponent(m[1]) + '&callback=' + cbName;
    document.head.appendChild(s);
  }

  let currentCode = null;
  let currentUnsub = null;
  window.dgSyncTrackerPhoto = function () {
    const box = document.getElementById('lp-tracker-photo-box');
    if (!box) return;
    const code = (window.dgCloudSave && window.dgCloudSave.getCloudCode && window.dgCloudSave.getCloudCode()) || '';
    if (code === currentCode) return; // already watching the right (or the still-absent) code
    currentCode = code;
    if (currentUnsub) { currentUnsub(); currentUnsub = null; }
    if (!code) { box.innerHTML = MISSING_HTML; return; }
    box.innerHTML = '';
    ensureFirebaseApi(function () {
      if (code !== currentCode) return; // a newer code arrived while Firebase was loading
      currentUnsub = window.firebase.firestore().collection('briefs').doc(code).onSnapshot(function (doc) {
        resolvePhoto((doc.data() || {}).face_plate_url || '', box);
      }, function () { box.innerHTML = MISSING_HTML; });
    }, function () { box.innerHTML = MISSING_HTML; });
  };
})();
