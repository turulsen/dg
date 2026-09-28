/* ══════════════════════════════════════════════
   LIVE PLAY — Cell initiative order (lp-initiative.js)

   A slim row above the Live Play tracker bar listing every Agent in this
   Agent's Cell in DEX order, highest first (Delta Green's initiative
   order), with this Agent highlighted. Only shown when the Cell has at
   least one other player -- a solo Agent, or one not in a Cell yet, sees
   nothing. Replaces the bare DEX readout that used to sit in the tracker
   bar itself.

   Reads cells and characters/{code} straight from Firestore -- both are
   public-read (see firestore.rules), so no sign-in is needed, same as
   lp-tracker-photo.js and a-cell.html's own Initiative Tracker. This
   Agent's own row uses the live values on the sheet instead, so editing
   DEX or the name updates the order immediately, before any save lands.

   Called from lpSyncBar() (scripts.js), the same hook lp-tracker-photo.js
   uses: it already fires whenever the sheet's stats change and whenever
   a Cloud Save code first appears.
   ══════════════════════════════════════════════ */
(function () {
  "use strict";
  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyBiFBvgmrjtacxXvh7FHa9a28BbwV0LnDQ',
    authDomain: 'dg-app-b3447.firebaseapp.com',
    projectId: 'dg-app-b3447',
    storageBucket: 'dg-app-b3447.firebasestorage.app',
    messagingSenderId: '464997490443',
    appId: '1:464997490443:web:dad47a347ae7a64a9e4c0e'
  };

  // Same on-demand loader as lp-tracker-photo.js (duplicated, not shared,
  // per this app's standalone-script convention) -- a no-op once any other
  // widget on the page has loaded Firestore already.
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
    if (window.firebase && window.firebase.firestore) { cb(); return; }
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

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  let code = '';
  let cellsUnsub = null;
  let members = [];            // Agent Codes in this Agent's Cell, this one included
  const memberUnsubs = {};     // code -> unsubscribe for characters/{code}
  const memberData = {};       // code -> { name, dex }

  function ownRow() {
    const name = (document.getElementById('cs-name')?.value || '').trim();
    const dex = parseInt(document.getElementById('DEX-value')?.textContent, 10);
    return { name: name && name !== 'Agent' ? name : 'You', dex: isNaN(dex) ? null : dex };
  }

  function hide(el) {
    document.body.classList.remove('lp-has-initiative');
    document.body.style.removeProperty('--lp-init-h');
    if (el) el.innerHTML = '';
  }

  function render() {
    const el = document.getElementById('lp-initiative');
    if (!el) return;
    if (!code || !members.some(m => m !== code)) { hide(el); return; }
    const rows = members.map(m => {
      if (m === code) return Object.assign({ me: true }, ownRow());
      const d = memberData[m];
      return { me: false, name: d ? d.name : '…', dex: d ? d.dex : null };
    });
    rows.sort((a, b) => {
      const ad = typeof a.dex === 'number', bd = typeof b.dex === 'number';
      if (ad !== bd) return ad ? -1 : 1;         // unknown DEX last
      if (ad && b.dex !== a.dex) return b.dex - a.dex;
      return a.name.localeCompare(b.name);
    });
    el.innerHTML = '<span class="lp-init-label">Initiative</span><ol class="lp-init-list">' +
      rows.map((r, i) => {
        const first = r.name.split(/\s+/)[0];
        return '<li class="lp-init-row' + (r.me ? ' lp-init-me' : '') + '" title="' + escapeHtml(r.name) + '">' +
          '<span class="lp-init-ord">' + (i + 1) + '</span>' +
          '<span class="lp-init-name">' + escapeHtml(first) + '</span>' +
          '<span class="lp-init-dex">' + (typeof r.dex === 'number' ? r.dex : '—') + '</span></li>';
      }).join('') + '</ol>';
    document.body.classList.add('lp-has-initiative');
    // The tracker bar sticks right under this row -- see #lp-tracker-bar's top.
    document.body.style.setProperty('--lp-init-h', el.offsetHeight + 'px');
  }

  // Friendly pregens (friendly.html) sit in a Cell under their pregen id
  // with no characters/ doc -- their name and DEX come from the pregen
  // file instead, so a walk-in player still gets a place in the order.
  let friendliesPromise = null;
  function friendlyFor(m) {
    if (!friendliesPromise) {
      friendliesPromise = fetch('../friendly/pregens.json')
        .then(r => (r.ok ? r.json() : { pregens: [] }))
        .catch(() => ({ pregens: [] }));
    }
    return friendliesPromise.then(data => (data.pregens || []).filter(p => p.id === m)[0] || null);
  }

  function watchMember(m) {
    if (memberUnsubs[m]) return;
    if (m.indexOf('FR-') === 0) {
      memberUnsubs[m] = () => {};
      friendlyFor(m).then(p => {
        if (!memberUnsubs[m]) return; // left the Cell meanwhile
        memberData[m] = p ? { name: p.name, dex: p.stats.DEX.value } : { name: m, dex: null };
        render();
      });
      return;
    }
    memberUnsubs[m] = window.firebase.firestore().collection('characters').doc(m).onSnapshot(doc => {
      let name = m, dex = null;
      try {
        const parsed = JSON.parse((doc.data() || {}).character_json || '{}');
        const bio = parsed.bio || {};
        const stats = parsed.csStats || parsed.stats || {};
        name = (bio.name && bio.name !== 'Agent') ? bio.name : (bio.codename || m);
        if (typeof stats.DEX === 'number') dex = stats.DEX;
      } catch (e) { /* unparsable -- keep the code as the label */ }
      memberData[m] = { name, dex };
      render();
    }, () => { memberData[m] = { name: m, dex: null }; render(); });
  }

  function setMembers(next) {
    Object.keys(memberUnsubs).forEach(m => {
      if (next.indexOf(m) === -1) { memberUnsubs[m](); delete memberUnsubs[m]; delete memberData[m]; }
    });
    members = next;
    members.forEach(m => { if (m !== code) watchMember(m); });
    render();
  }

  function teardown() {
    if (cellsUnsub) { cellsUnsub(); cellsUnsub = null; }
    setMembers([]);
  }

  // Row height changes with width once it wraps -- keep the tracker bar's
  // sticky offset in step.
  window.addEventListener('resize', () => { if (document.body.classList.contains('lp-has-initiative')) render(); });

  window.dgSyncInitiative = function () {
    const next = (window.dgCloudSave && window.dgCloudSave.getCloudCode && window.dgCloudSave.getCloudCode()) || '';
    if (next !== code) {
      teardown();
      code = next;
      if (code) {
        const watching = code;
        ensureFirebaseApi(() => {
          if (watching !== code) return; // a newer code arrived while Firebase was loading
          cellsUnsub = window.firebase.firestore().collection('cells').onSnapshot(snap => {
            // Same "first Cell that lists this Agent" rule as dice-roller.js's
            // resolveRollContext(), so the roll feed and this row agree.
            let found = null;
            snap.forEach(doc => {
              if (found) return;
              const mc = doc.data().member_codes || [];
              if (mc.indexOf(code) !== -1) found = mc;
            });
            setMembers(found ? Array.from(new Set(found)) : []);
          }, () => setMembers([]));
        }, () => setMembers([]));
      }
    }
    render(); // this Agent's own DEX/name may have just changed on the sheet
  };
})();
