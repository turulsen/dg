/* ══════════════════════════════════════════════
   FIELD NOTES -- the leather notebook every player page carries
   (docs/field-notes-widget/SPEC.md). It replaces the floating Table
   Radio pill and Dice Roller panel, and folds Agent File, Field ID,
   Requisition, Radio, Dice, Notes, Evidence, Rules and Settings into
   one place. Not on A-Cell (the Handler keeps its own tools there).

   Hosting, same rule table-radio.js and dice-roller.js already follow:
   exactly ONE notebook per tab, on the outermost page.
     - hub.html (the app shell) hosts it; pages loaded into the shell's
       #dg-shell-content iframe run this file as a "guest": no notebook
       of their own, window.dgFieldNotes proxies to the shell's.
     - A page visited on its own hosts its own.
     - Pages embedded INSIDE the notebook (Requisition, desktop Notes --
       iframes marked data-dg-embed) are guests too.

   Engines are reused, never duplicated:
     - Radio: table-radio.js keeps playing (its chrome is clipped away
       by field-notes.css); the pager face and quick-tune chip drive it
       through window.dgRadio.
     - Dice: dice-roller.js's own #dr-panel is MOVED onto the Dice page
       (it has no embedded players, so moving it is safe); skill clicks,
       Cell-shared history and Friendly identity keep working as-is.

   Data: only reads what the app already stores, and only writes what
   the existing pages already write (note blocks, handout notes, brief
   fields via dgStore). The one new field, briefs/{code}
   .standing_orders_ack_at, is additive.
   ══════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.dgFieldNotes) return;

  var SCRIPT = document.currentScript;
  var ROOT_URL = (SCRIPT && SCRIPT.src) ? SCRIPT.src.replace(/assets\/field-notes\.js(\?.*)?$/, '') : '';
  function url(path) { return ROOT_URL + path; }

  var frame = null;
  try { frame = window.frameElement; } catch (e) { frame = null; }
  var GUEST = !!(frame && (frame.id === 'dg-shell-content' || frame.id === 'dg-split-sheet-frame' ||
    (frame.hasAttribute && frame.hasAttribute('data-dg-embed'))));
  var EMBEDDED_IN_NOTEBOOK = !!(frame && frame.hasAttribute && frame.hasAttribute('data-dg-embed'));

  var ROSTER_KEY = 'dg_agent_roster';
  var CLOUD_CODE_KEY = 'dg_stats_cloud_code';
  var ORDERS_PENDING_KEY = 'dg_fn_orders_pending';
  var ORDERS_ACK_KEY = 'dg_fn_orders_ack';
  var ONBOARD_KEY = 'dg_fn_onboard';
  var VIEW_KEY = 'dg_fn_view';
  var OPEN_ON_ARRIVAL_KEY = 'dg_fn_open';
  var BOOT_OFF_KEY = 'dg_boot_splash_off';
  var APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxF32nCIUfXDcTaKntKkt8az_7mwy8aOAKPD0mtaEZHcUEKmq0AF2b2k4V6FJNEzbIJZQ/exec';

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* private mode */ } }
  function lsJson(k, dflt) { try { return JSON.parse(localStorage.getItem(k) || 'null') || dflt; } catch (e) { return dflt; } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function onStatsPage(win) {
    try { return (win || window).location.pathname.indexOf('/stats/') !== -1; } catch (e) { return false; }
  }

  /* ── Standing Orders: arming (runs on the character sheet, host or guest) ── */
  // Armed when the wizard finishes or an Agent is imported onto the sheet;
  // shown the next time the player lands on any page that isn't the sheet.
  function ordersAck() { return lsJson(ORDERS_ACK_KEY, {}); }
  function armOrders(code, name) {
    code = String(code || '').trim().toUpperCase();
    if (!code || ordersAck()[code]) return;
    lsSet(ORDERS_PENDING_KEY, JSON.stringify({ code: code, name: name || '', at: Date.now() }));
  }
  function sheetName() {
    var el = document.getElementById('cs-name');
    return el ? String(el.value || '').trim() : '';
  }
  function wireSheetArming() {
    if (!onStatsPage()) return;
    window.addEventListener('dg-wizard-finished', function () {
      armOrders(lsGet(CLOUD_CODE_KEY), sheetName());
    });
    // Imports: the drop zone and the paste box both funnel through these
    // two globals (stats/scripts.js). Wrapped, not edited, so every
    // format's own importer stays untouched; armed once the imported
    // Agent's name actually lands on the sheet.
    function watchImport() {
      var before = sheetName();
      var started = Date.now();
      var iv = setInterval(function () {
        var now = sheetName();
        if (now && now !== before) { clearInterval(iv); armOrders(lsGet(CLOUD_CODE_KEY), now); }
        else if (Date.now() - started > 15000) clearInterval(iv);
      }, 400);
    }
    ['importAgentAuto', 'importAgentText'].forEach(function (fn) {
      var orig = window[fn];
      if (typeof orig !== 'function' || orig._fnWrapped) return;
      var wrapped = function () { watchImport(); return orig.apply(this, arguments); };
      wrapped._fnWrapped = true;
      window[fn] = wrapped;
    });
  }

  /* ── Guest mode: a page inside the shell or inside the notebook ── */
  function hostApi() {
    try {
      var t = window.top;
      if (t && t !== window && t.dgFieldNotes && t.dgFieldNotes.isHost) return t.dgFieldNotes;
    } catch (e) { /* cross-origin top -- can't happen on this site */ }
    return null;
  }
  if (GUEST) {
    var guestStyle = document.createElement('style');
    guestStyle.textContent = 'html.dg-fn-host #settings-cog-btn,html.dg-fn-host #notes-widget-btn{display:none!important}';
    document.head.appendChild(guestStyle);
    if (hostApi()) document.documentElement.classList.add('dg-fn-host');
    // Phone: leave room under the page for the closed notebook's buttons
    // (the shell's own copy floats over this page's bottom edge).
    guestStyle.textContent += '@media (max-width:759px){html.dg-fn-host:not(.dg-fn-embedded) body{padding-bottom:calc(env(safe-area-inset-bottom,0px) + 76px)!important}}';
    if (EMBEDDED_IN_NOTEBOOK) document.documentElement.classList.add('dg-fn-embedded');
    window.dgFieldNotes = {
      isHost: false,
      open: function (view) { var h = hostApi(); if (h) h.open(view); },
      close: function () { var h = hostApi(); if (h) h.close(); },
      armOrders: armOrders,
      refresh: function () { var h = hostApi(); if (h) h.refresh(); },
      go: function (path) { var h = hostApi(); if (h && h.go) h.go(path); else location.href = url(path); }
    };
    // Escape inside an embedded page (focus is in the iframe, so the
    // host never sees the key) or on a shell page under the open notebook.
    document.addEventListener('keydown', function (e) {
      var h = hostApi();
      if (!h) return;
      // The Standing Orders terminal lives on the host page; if focus is
      // still in this page, its Y / N / Escape have to be passed up.
      if (h.ordersKey && h.ordersKey(e.key)) { e.preventDefault(); e.stopPropagation(); return; }
      if (e.key === 'Escape' && h.isOpen && h.isOpen()) h.close();
    }, true);
    // A tap on this page puts the host's roll slip away.
    document.addEventListener('pointerdown', function () {
      var h = hostApi();
      if (h && h.pagePointer) h.pagePointer();
    }, true);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireSheetArming);
    else wireSheetArming();
    return;
  }

  /* ════════════════════════════ HOST ════════════════════════════ */

  // Stylesheet + fonts (both no-ops if the page already has them).
  (function injectCss() {
    if (!document.querySelector('link[data-fn-css]')) {
      var l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = url('assets/field-notes.css'); l.setAttribute('data-fn-css', '1');
      document.head.appendChild(l);
    }
    var hasFonts = Array.prototype.some.call(document.querySelectorAll('link[href*="fonts.googleapis.com"]'), function (x) {
      return /Special\+Elite/.test(x.href) && /Courier\+Prime/.test(x.href);
    });
    if (!hasFonts) {
      var f = document.createElement('link');
      f.rel = 'stylesheet';
      f.href = 'https://fonts.googleapis.com/css2?family=Special+Elite&family=Courier+Prime:wght@400;700&family=JetBrains+Mono:wght@400;700&display=swap';
      document.head.appendChild(f);
    }
  })();

  var shellFrame = document.getElementById('dg-shell-content');
  var IS_SHELL = !!shellFrame;

  // The page the player is actually looking at: the shell's content page,
  // or this page itself.
  function contentWin() {
    if (!IS_SHELL) return window;
    try { return shellFrame.contentWindow || null; } catch (e) { return null; }
  }
  function contentPath() {
    var w = contentWin();
    try { return w ? w.location.pathname : ''; } catch (e) { return ''; }
  }
  function contentIs(name) { return contentPath().indexOf(name) !== -1; }
  function friendlyActive() {
    if (document.documentElement.hasAttribute('data-dice-friendly')) return true;
    return IS_SHELL && contentIs('friendly.html');
  }

  function navigate(target) {
    close();
    if (IS_SHELL) {
      if (window.dgShellShowLoadingVeil && /a-cell\.html|agent-hub\.html/.test(target)) window.dgShellShowLoadingVeil();
      shellFrame.src = target;
    } else {
      location.href = target;
    }
  }

  /* ── Who is the current Agent ── */
  // Same precedence dice-roller.js uses, so the notebook and the dice
  // always agree: this tab's character-sheet code, else the Cover
  // Identity roster's most recently active Agent. Friendly: the pregen.
  function roster() { return lsJson(ROSTER_KEY, {}); }
  function currentAgent() {
    if (friendlyActive()) {
      var id = window.dgDiceIdentity;
      if (!id) {
        try { id = contentWin() && contentWin().dgDiceIdentity; } catch (e) { id = null; }
      }
      return id && id.code ? { code: id.code, name: id.name || id.code, friendly: true, cellId: id.cellId || '' } : null;
    }
    var r = roster();
    var code = lsGet(CLOUD_CODE_KEY) || '';
    if (!code) {
      var list = Object.keys(r).map(function (k) { return r[k]; })
        .sort(function (a, b) { return (b.saved_at || 0) - (a.saved_at || 0); });
      code = (list[0] && list[0].code) || '';
    }
    code = String(code || '').trim().toUpperCase();
    if (!code) return null;
    var e = r[code] || {};
    return {
      code: code, name: e.char_name || '', codename: e.codename || '', face: e.face_plate_url || '',
      era: e.campaign_era || e.active_eras || '', friendly: false
    };
  }

  /* ── Data (read-only, cached per Agent) ── */
  var data = { code: '', loading: null, ready: false, char: null, state: null, brief: null, cells: [], ops: [], cell: null, members: [], error: '' };
  // Pages like the Clearance chooser, Rules Reference and Friendly don't
  // load the data layer themselves; the notebook brings it when needed.
  var storePromise = null;
  function ensureStore() {
    if (window.dgStore) return Promise.resolve(window.dgStore);
    if (storePromise) return storePromise;
    storePromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = url('assets/dg-store.js');
      s.onload = function () { if (window.dgStore) resolve(window.dgStore); else reject(new Error('dgStore missing')); };
      s.onerror = function () { storePromise = null; reject(new Error('Could not load the data layer -- check the connection.')); };
      document.head.appendChild(s);
    });
    return storePromise;
  }
  function fb() { return ensureStore().then(function (st) { return st.ready(); }); }
  function loadData(force) {
    var a = currentAgent();
    var code = a && !a.friendly ? a.code : '';
    if (!force && data.code === code && data.loading) return data.loading;
    data = { code: code, loading: null, ready: false, char: null, state: null, brief: null, cells: [], ops: [], cell: null, members: [], error: '' };
    if (!code) { data.ready = true; data.loading = Promise.resolve(data); return data.loading; }
    var d = data;
    d.loading = ensureStore().then(function () { return Promise.all([
      window.dgStore.getCharacter(code).catch(function () { return null; }),
      window.dgStore.getBrief(code).catch(function () { return null; }),
      fb().then(function (f) { return f.firestore().collection('cells').get(); }).catch(function () { return null; }),
      fb().then(function (f) { return f.firestore().collection('operations').get(); }).catch(function () { return null; })
    ]).then(function (res) {
      if (d !== data) return d;
      d.char = res[0];
      try { d.state = res[0] && res[0].character_json ? JSON.parse(res[0].character_json) : null; } catch (e) { d.state = null; }
      d.brief = res[1];
      if (res[2]) res[2].forEach(function (doc) { d.cells.push(Object.assign({ cell_id: doc.id }, doc.data())); });
      if (res[3]) res[3].forEach(function (doc) { var o = doc.data() || {}; d.ops.push(Object.assign({}, o, { operation_id: o.operation_id || doc.id })); });
      d.cell = d.cells.filter(function (c) { return (c.member_codes || []).indexOf(code) !== -1; })[0] || null;
      var others = d.cell ? (d.cell.member_codes || []).filter(function (c) { return c !== code; }) : [];
      return Promise.all(others.map(function (c) {
        return window.dgStore.getBrief(c).then(function (b) { return { code: c, brief: b }; }, function () { return { code: c, brief: null }; });
      })).then(function (m) {
        var names = (d.cell && d.cell.member_names) || {};
        d.members = m.map(function (x) {
          var b = x.brief || {};
          return { code: x.code, name: b.char_name || names[x.code] || x.code, codename: b.codename || '' };
        });
        return d;
      });
    }); }).catch(function (err) { d.error = String(err && err.message || err); return d; })
      .then(function (x) { d.ready = true; return x; });
    return d.loading;
  }
  function cellIdFor(a) {
    if (!a) return '';
    if (a.friendly) return a.cellId || '';
    return data.code === a.code && data.cell ? data.cell.cell_id : 'solo:' + a.code;
  }
  function agentName(a) {
    a = a || currentAgent();
    if (!a) return 'No Agent yet';
    var bio = data.code === a.code && data.state && data.state.bio;
    return (bio && bio.name) || (data.code === a.code && data.brief && data.brief.char_name) || a.name || a.code;
  }
  function professionLabel() {
    var bio = data.state && data.state.bio;
    var key = bio && bio.profession;
    if (!key) return (data.brief && data.brief.profession) || '';
    try {
      var p = window.professions || (contentWin() && contentWin().professions);
      if (p && p[key] && p[key].title) return p[key].title;
    } catch (e) { /* not on the sheet */ }
    return String(key).replace(/[_-]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function faceUrl(a) {
    var b = data.brief;
    var fromBrief = b ? (window.dgStore && window.dgStore.mainPhoto ? window.dgStore.mainPhoto(b) : b.face_plate_url) : '';
    return fromBrief || (a && a.face) || '';
  }
  // Face Plates: newer ones are public https:// Storage links; a legacy
  // gdrive:ID still goes through the Apps Script image proxy (the one
  // Apps Script call the app still makes -- see agent-hub.html's
  // loadFacePlate()).
  var imgCache = {};
  function setImage(el, src) {
    if (!el || !src) return;
    if (/^(https?:|data:)/.test(src)) { el.innerHTML = '<img src="' + esc(src) + '" alt="">'; return; }
    var m = String(src).match(/^gdrive:(.+)$/);
    if (!m) return;
    if (imgCache[m[1]]) { el.innerHTML = '<img src="' + imgCache[m[1]] + '" alt="">'; return; }
    var cb = '_fnImg_' + m[1].replace(/[^a-zA-Z0-9]/g, '_') + '_' + Date.now();
    window[cb] = function (json) {
      delete window[cb];
      if (json && json.status === 'OK' && json.dataUri) {
        imgCache[m[1]] = json.dataUri;
        if (el.isConnected) el.innerHTML = '<img src="' + json.dataUri + '" alt="">';
      }
    };
    var s = document.createElement('script');
    s.src = APPS_SCRIPT_URL + '?action=imgdata&id=' + encodeURIComponent(m[1]) + '&callback=' + cb;
    s.onerror = function () { delete window[cb]; };
    document.head.appendChild(s);
  }

  /* ── DOM ── */
  var TRI = url('assets/delta-green-triangle.png');
  var TABS = [
    { view: 'notes', label: 'Notes' }, { view: 'evidence', label: 'Evidences' },
    { view: 'rules', label: 'Rules' }, { view: 'settings', label: 'Settings' }
  ];
  var VIEWS = ['agentfile', 'fieldid', 'req', 'dice', 'notes', 'evidence', 'rules', 'settings'];

  // The Agent File paper (assets/agent-sheet.js + .css) is shared with
  // the Agent Hub roster; pages that don't load it get it from here.
  var sheetLibPromise = null;
  function ensureSheetLib() {
    if (!document.querySelector('link[data-as-css]')) {
      var l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = url('assets/agent-sheet.css'); l.setAttribute('data-as-css', '1');
      document.head.appendChild(l);
    }
    if (window.dgAgentSheet) return Promise.resolve(window.dgAgentSheet);
    if (sheetLibPromise) return sheetLibPromise;
    sheetLibPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = url('assets/agent-sheet.js');
      s.onload = function () { resolve(window.dgAgentSheet); };
      s.onerror = function () { sheetLibPromise = null; reject(new Error('agent-sheet.js')); };
      document.head.appendChild(s);
    });
    return sheetLibPromise;
  }

  var root = document.createElement('div');
  root.id = 'fn-root';
  root.innerHTML =
    '<div id="fn-closed">' +
      '<button type="button" class="fn-chip" data-fn="chip" title="Table Radio"></button>' +
      '<button type="button" class="fn-cover fn-leather" data-fn="open" title="Open Field Notes" aria-label="Open Field Notes">' +
        '<span class="fn-stitch"></span><span class="fn-cover-spine"></span><span class="fn-cover-pages"></span>' +
        '<span class="fn-cover-band"></span><span class="fn-cover-title">Field<br>Notes</span>' +
        '<span class="fn-cover-dice" data-fn="dice" role="button" title="Roll dice" aria-label="Roll dice"><img class="fn-tri" src="' + TRI + '" alt=""></span>' +
      '</button>' +
    '</div>' +
    '<div id="fn-closed-phone">' +
      '<button type="button" class="fn-chip fn-chip-phone" data-fn="chip" title="Table Radio"></button>' +
      '<button type="button" class="fn-phone-dice fn-leather" data-fn="dice" title="Roll dice" aria-label="Roll dice"><img class="fn-tri" src="' + TRI + '" alt=""></button>' +
      '<button type="button" class="fn-phone-book fn-leather" data-fn="open" title="Open Field Notes"><span class="fn-cover-pages"></span><span class="fn-phone-band"></span><span class="fn-phone-title">Field<br>Notes</span></button>' +
    '</div>' +
    '<div id="fn-pager" hidden></div>' +
    '<div id="fn-veil" hidden>' +
      '<div class="fn-veil-hit" data-fn="close"></div>' +
      '<div class="fn-book fn-leather" role="dialog" aria-label="Field Notes">' +
        '<span class="fn-stitch"></span>' +
        '<button type="button" class="fn-close" data-fn="close" title="Close" aria-label="Close">X</button>' +
        '<div class="fn-phone-head">' +
          '<div class="fn-phone-head-t"><div class="fn-phone-head-k">Field Notes</div><div class="fn-phone-head-n" data-fn-slot="phone-name"></div></div>' +
          '<button type="button" data-fn="dice" title="Dice roller" aria-label="Dice roller"><img class="fn-tri" src="' + TRI + '" alt=""></button>' +
          '<button type="button" data-fn="close" title="Close" aria-label="Close">X</button>' +
        '</div>' +
        '<div class="fn-spine"></div>' +
        '<div class="fn-left"><div class="fn-holder">' +
          '<div class="fn-slot" data-view="agentfile" role="button" tabindex="0" aria-label="Agent File">' +
            '<div class="fn-card fn-card-photo"><div class="fn-card-ph" data-fn-slot="card-photo"></div>' +
              '<div class="fn-card-txt"><div class="fn-card-k">Delta Green — Agent File</div><div class="fn-card-n" data-fn-slot="card-name"></div>' +
              '<div class="fn-card-s" data-fn-slot="card-meta"></div></div></div>' +
            '<div class="fn-slot-lip"></div></div>' +
          '<div class="fn-slot" data-view="fieldid" role="button" tabindex="0" aria-label="Field ID">' +
            '<div class="fn-card fn-card-biz" data-fn-slot="card-biz"></div><div class="fn-slot-lip"></div></div>' +
          '<div class="fn-slot" data-view="req" role="button" tabindex="0" aria-label="Requisition">' +
            '<div class="fn-card fn-card-req"><div class="fn-card-k">Program Office</div><div class="fn-card-n">Requisition</div>' +
            '<div class="fn-card-s">Materiel &amp; Disbursement Desk · Form 27-R</div></div><div class="fn-slot-lip"></div></div>' +
        '</div></div>' +
        '<div class="fn-right">' +
          '<div class="fn-booklet"><div class="fn-paper">' +
            '<div class="fn-page-head"><div class="fn-page-kicker"><span data-fn-slot="kicker"></span><span data-fn-slot="meta"></span></div>' +
            '<div class="fn-page-title" data-fn-slot="title"></div></div>' +
            '<div class="fn-page-body" data-fn-slot="body"></div>' +
            '<div class="fn-page-body" data-fn-slot="dice" hidden><div class="fn-dice-host" data-fn-slot="dice-host"></div></div>' +
            '<div class="fn-page-body fn-flush" data-fn-slot="embed-req" hidden></div>' +
          '</div></div>' +
          '<div class="fn-tabs">' +
            TABS.map(function (t) { return '<button type="button" class="fn-tab" data-view="' + t.view + '"><span>' + t.label + '</span></button>'; }).join('') +
          '</div>' +
        '</div>' +
        '<div class="fn-spread" data-fn-slot="spread" hidden></div>' +
        '<button type="button" class="fn-dice-strap fn-leather" data-fn="dice" title="Dice Roller"><img class="fn-tri" src="' + TRI + '" alt=""><span>Dice</span></button>' +
      '</div>' +
    '</div>';

  function slot(name) { return root.querySelector('[data-fn-slot="' + name + '"]'); }

  var state = { open: false, view: lsGet(VIEW_KEY) || 'agentfile', suspended: false, notesMode: 'spread', evOp: '' };
  if (VIEWS.indexOf(state.view) === -1) state.view = 'agentfile';
  var narrowMq = window.matchMedia ? window.matchMedia('(max-width:759px)') : { matches: false, addListener: function () {} };
  function narrow() { return !!narrowMq.matches; }

  function mount() {
    document.body.appendChild(root);
    document.documentElement.classList.add('dg-fn-host');
    if (IS_SHELL) document.documentElement.classList.add('dg-fn-shell');
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('fn-slot')) { e.preventDefault(); show(e.target.getAttribute('data-view')); }
    });
    document.addEventListener('keydown', onKey);
    window.addEventListener('dg-radio-state', renderChip);
    window.addEventListener('dg-dice-roll-start', onRollStart);
    var mqHandler = function () { if (state.open) render(); };
    if (narrowMq.addEventListener) narrowMq.addEventListener('change', mqHandler); else narrowMq.addListener(mqHandler);
    window.addEventListener('storage', function (e) {
      if (e.key === ROSTER_KEY || e.key === CLOUD_CODE_KEY || e.key === null) refresh();
    });
    renderChip();
    setInterval(renderChip, 5000);
    renderChrome();
    loadData().then(renderChrome);
    if (IS_SHELL) {
      shellFrame.addEventListener('load', onShellPageChange);
      onShellPageChange();
    } else {
      afterPageArrival();
    }
    wireSheetArming();
  }

  function onClick(e) {
    var t = e.target.closest('[data-fn],[data-view]');
    if (!t || !root.contains(t)) return;
    var act = t.getAttribute('data-fn');
    if (act === 'open') { if (e.target.closest('[data-fn="dice"]')) return; open(); return; }
    if (act === 'dice') { e.stopPropagation(); open('dice'); return; }
    if (act === 'close') { close(); return; }
    if (act === 'chip') { togglePager(); return; }
    var v = t.getAttribute('data-view');
    if (!v) return;
    if (t.classList.contains('fn-tab') && v === 'notes' && state.view === 'notes' && !narrow()) {
      // Notes is the one tab that takes both pages; tapping it again
      // folds back to the quick notes, with the card holder on the left.
      state.notesMode = state.notesMode === 'spread' ? 'quick' : 'spread';
      render();
      return;
    }
    if (t.classList.contains('fn-tab') && v === 'notes') state.notesMode = 'spread';
    if (t.classList.contains('fn-slot') || t.classList.contains('fn-tab')) show(v);
  }
  function onKey(e) {
    if (e.key !== 'Escape' || document.getElementById('fn-orders')) return;
    if (!root.querySelector('#fn-pager').hidden) { closePager(); return; }
    if (state.open) close();
  }

  function open(view) {
    if (state.suspended) return;
    if (view && VIEWS.indexOf(view) !== -1) state.view = view;
    state.open = true;
    closePager();
    hidePeek();
    root.querySelector('#fn-veil').hidden = false;
    if (narrow()) document.body.style.overflow = 'hidden';
    loadData().then(function () { renderChrome(); if (state.open) render(); });
    renderChrome();
    render();
  }
  function close() {
    state.open = false;
    root.querySelector('#fn-veil').hidden = true;
    document.body.style.overflow = '';
  }
  function show(view) {
    state.view = view;
    lsSet(VIEW_KEY, view === 'dice' ? 'agentfile' : view);
    render();
  }
  function refresh() {
    data.code = '__stale__';
    loadData(true).then(function () { renderChrome(); renderChip(); if (state.open) render(); });
  }

  function setSuspended(on) {
    if (state.suspended === on) return;
    state.suspended = on;
    if (on) {
      close();
      closePager();
      hidePeek();
      root.hidden = true;
      document.documentElement.classList.remove('dg-fn-host');
      // Hand the Dice panel back to the page, collapsed, where A-Cell's
      // Handler feed expects it.
      var p = document.getElementById('dr-panel');
      if (p && p.parentNode !== document.body) {
        document.body.appendChild(p);
        if (!p.classList.contains('dr-collapsed') && window.dgDice && window.dgDice._toggle) window.dgDice._toggle();
      }
    } else {
      root.hidden = false;
      document.documentElement.classList.add('dg-fn-host');
    }
  }

  /* ── Field ID: the Agent's agency, from their workplace ── */
  // The Agent File's own Field ID agencies (dg-agent-portal.html #ids-agency).
  var AGENCIES = [
    { code: 'FBI', name: 'Federal Bureau of Investigation', title: 'Special Agent' },
    { code: 'DEA', name: 'Drug Enforcement Administration', title: 'Special Agent' },
    { code: 'ATF', name: 'Bureau of Alcohol, Tobacco, Firearms and Explosives', title: 'Special Agent' },
    { code: 'USMS', name: 'U.S. Marshals Service', title: 'Deputy U.S. Marshal', alias: ['marshal'] },
    { code: 'DOJIG', name: 'DOJ Office of Inspector General', title: 'Special Agent', alias: ['inspector general'] },
    { code: 'SECRET', name: 'U.S. Secret Service', title: 'Special Agent', alias: ['secret service', 'usss'] },
    { code: 'ICE', name: 'Immigration and Customs Enforcement', title: 'Special Agent', alias: ['immigration'] },
    { code: 'CBP', name: 'Customs and Border Protection', title: 'Officer', alias: ['border patrol', 'customs'] },
    { code: 'NCIS', name: 'Naval Criminal Investigative Service', title: 'Special Agent' },
    { code: 'FINCEN', name: 'Financial Crimes Enforcement Network', title: 'Analyst' },
    { code: 'USPI', name: 'U.S. Postal Inspection Service', title: 'Postal Inspector', alias: ['postal'] },
    { code: 'NYPD', name: 'New York City Police Department', title: 'Detective', alias: ['new york police'] },
    { code: 'SCSO', name: "Shelby County Sheriff's Office", title: 'Deputy', alias: ['shelby county'] },
    { code: 'MEPIC', name: 'M-EPIC Environmental Policy Impact Commission', title: 'Investigator', alias: ['m-epic', 'environmental policy'] }
  ];
  var DG_AGENCY = { code: 'DG', name: 'Delta Green — Directorate', title: 'Agent', dg: true };
  function agencyFor(text) {
    var t = String(text || '').toLowerCase();
    if (!t) return DG_AGENCY;
    for (var i = 0; i < AGENCIES.length; i++) {
      var a = AGENCIES[i];
      if (new RegExp('\\b' + a.code.toLowerCase() + '\\b').test(t) || t.indexOf(a.name.toLowerCase()) !== -1) return a;
      if ((a.alias || []).some(function (x) { return t.indexOf(x) !== -1; })) return a;
    }
    return DG_AGENCY;
  }
  function agentAgency() {
    var bio = (data.state && data.state.bio) || {};
    var brief = data.brief || {};
    return agencyFor(brief.cover_agency || bio.employer || brief.employer || '');
  }
  function bizCardHtml(big) {
    var a = currentAgent();
    var ag = agentAgency();
    var name = a ? agentName(a) : 'Agent';
    return '<div class="fn-biz' + (ag.dg ? ' fn-biz-dg' : '') + (big ? ' fn-biz-big' : '') + '">' +
      (ag.dg ? '<img class="fn-biz-mark" src="' + TRI + '" alt="">' : '<div class="fn-biz-code">' + esc(ag.code) + '</div>') +
      '<div class="fn-biz-agency">' + esc(ag.dg ? 'Delta Green' : ag.name) + '</div>' +
      '<div class="fn-biz-name">' + esc(name) + '</div>' +
      '<div class="fn-biz-title">' + esc(ag.title) + (ag.dg ? '' : ' · ' + esc(ag.code)) + '</div>' +
      (big ? '<div class="fn-biz-line">' + esc(a ? a.code : '') + '</div>' : '') +
      '</div>';
  }

  /* ── Chrome: the card holder, tabs, page head ── */
  var META = {
    agentfile: ['Delta Green — Agent Roster', 'Agent File'],
    fieldid: ['Cover Credential', 'Field ID'],
    req: ['Request for Materiel & Disbursement', 'Requisition'],
    dice: ['Percentile & Dice', 'Dice Roller'],
    notes: ['Your Tab', 'Notes'],
    evidence: ['Evidence Locker — Read Only', 'Evidences'],
    rules: ['Quick Lookup', 'Rules Reference'],
    settings: ['This Device', 'Settings']
  };
  function renderChrome() {
    var a = currentAgent();
    var name = agentName(a);
    slot('phone-name').textContent = name;
    slot('card-name').textContent = name;
    var brief = data.brief || {};
    slot('card-meta').textContent = a ? [a.code, (brief.codename || a.codename) ? '“' + (brief.codename || a.codename) + '”' : ''].filter(Boolean).join(' · ') : 'Pick your Agent in the Agent Hub';
    var ph = slot('card-photo');
    var f = faceUrl(a);
    if (f) { if (ph.getAttribute('data-src') !== f) { ph.setAttribute('data-src', f); ph.textContent = ''; setImage(ph, f); } }
    else { ph.removeAttribute('data-src'); ph.innerHTML = '<span>No photo</span>'; }
    slot('card-biz').innerHTML = bizCardHtml(false);
  }
  function renderHead(view, metaText) {
    var m = META[view] || ['', ''];
    slot('kicker').textContent = m[0];
    slot('title').textContent = m[1];
    slot('meta').textContent = metaText || '';
    Array.prototype.forEach.call(root.querySelectorAll('.fn-slot,.fn-tab'), function (b) {
      b.classList.toggle('fn-active', b.getAttribute('data-view') === view);
    });
  }

  /* ── Page router ── */
  var PERSISTENT = { dice: 'dice', req: 'embed-req' };
  function render() {
    if (!state.open) return;
    var view = state.view;
    var book = root.querySelector('.fn-book');
    var spread = view === 'notes' && !narrow() && state.notesMode === 'spread';
    book.classList.toggle('fn-spreading', spread);
    slot('spread').hidden = !spread;
    var persistentSlot = PERSISTENT[view] || null;
    ['dice', 'embed-req'].forEach(function (s) { slot(s).hidden = s !== persistentSlot; });
    slot('body').hidden = !!persistentSlot;
    renderHead(view, '');
    var body = slot('body');
    if (!persistentSlot) { body.innerHTML = ''; body.scrollTop = 0; }
    if (spread) { pageNotesSpread(); return; }
    var fn = {
      agentfile: pageAgentFile, fieldid: pageFieldId, req: pageRequisition, dice: pageDice,
      notes: pageQuickNotes, evidence: pageEvidence, rules: pageRules, settings: pageSettings
    }[view];
    if (fn) fn(body);
  }

  function needAgent(body, what) {
    var a = currentAgent();
    if (a && !a.friendly) return a;
    body.innerHTML = '<p class="fn-p">' + (a && a.friendly
      ? esc(what) + ' belongs to a campaign Agent. Friendly pregens don\'t have one.'
      : 'No Agent on this device yet. ' + esc(what) + ' opens once you pick your Agent in the Agent Hub.') + '</p>' +
      '<div class="fn-actions"><button type="button" class="fn-btn fn-red" data-go="hub">Open Agent Hub</button></div>';
    body.querySelector('[data-go="hub"]').addEventListener('click', function () { navigate(url('agent-hub.html')); });
    return null;
  }
  function loadingThen(body, fn) {
    if (data.code && !data.ready) {
      body.innerHTML = '<p class="fn-muted">Pulling the file…</p>';
      var view = state.view;
      data.loading.then(function () { if (state.open && state.view === view) render(); });
      return;
    }
    if (data.code && !data.char && !data.brief) {
      body.innerHTML = '<p class="fn-p">Couldn\'t pull this Agent\'s file just now — check the connection.</p>' +
        '<div class="fn-actions"><button type="button" class="fn-btn fn-red" data-go="retry">Try again</button></div>';
      body.querySelector('[data-go="retry"]').addEventListener('click', function () { refresh(); render(); });
      return;
    }
    fn();
  }
  function cellOps() {
    return data.ops.filter(function (o) { return data.cell && (!o.cell_id || o.cell_id === data.cell.cell_id); })
      .sort(function (x, y) { return Number(y.created_at || 0) - Number(x.created_at || 0); });
  }
  function activeOp(ops) { return ops.filter(function (o) { return o.active === true; })[0] || ops[0] || null; }

  /* ── Agent File: the shared Agent File paper ── */
  function pageAgentFile(body) {
    var a = needAgent(body, 'The Agent File');
    if (!a) return;
    renderHead('agentfile', a.code);
    loadingThen(body, function () {
      body.innerHTML = '<p class="fn-muted">Opening the file…</p>';
      ensureSheetLib().then(function (AS) {
        if (!state.open || state.view !== 'agentfile') return;
        var brief = data.brief || {};
        var sheet = data.state ? AS.fromState(data.state) : { name: agentName(a), profession: professionLabel() };
        if (!sheet.name) sheet.name = agentName(a);
        if (data.state && data.state.bio && data.state.bio.profession) sheet.profession = professionLabel();
        var ops = cellOps(), act = activeOp(ops);
        var opsHtml = data.cell ? '<div class="as-ops"><div class="as-sec-hd">Operations</div>' + (ops.length ? ops.map(function (o) {
          var on = act && o.operation_id === act.operation_id;
          return '<div class="as-op' + (on ? ' as-op-active' : '') + '"><span>' + esc(o.name || o.operation_id) + '</span>' + (on ? '<span class="as-stamp">Active</span>' : '') + '</div>';
        }).join('') : '<p class="as-text as-k">None filed yet.</p>') + '</div>' : '';
        body.innerHTML = AS.render(sheet, {
          photoHtml: AS.photoHtml('data-go="photo"'),
          subtitle: [sheet.profession, brief.codename ? 'Cover “' + brief.codename + '”' : ''].filter(Boolean).join(' · '),
          physical: AS.physical(brief, sheet.physical),
          cellName: data.cell ? (data.cell.name || data.cell.cell_id) : '',
          members: data.members, opsHtml: opsHtml,
          actionsHtml: '<button type="button" class="fn-btn fn-red" data-go="play">Play (Live) ↗</button>' +
            '<button type="button" class="fn-btn fn-ink" data-go="file">Open Agent File ↗</button>',
          emptySheetHtml: data.state ? '' : '<p class="as-text as-k" style="margin-top:14px">No character sheet yet — Play opens character creation.</p>'
        });
        var ph = body.querySelector('[data-as-photo]');
        var f = faceUrl(a);
        if (f && ph) { ph.classList.add('as-has-photo'); var holder = document.createElement('div'); holder.style.cssText = 'position:absolute;inset:0'; ph.appendChild(holder); setImage(holder, f); }
        AS.wireRolls(body);
        body.querySelector('[data-go="play"]').addEventListener('click', function () { navigate(url('stats/index.html?load=' + encodeURIComponent(a.code))); });
        body.querySelector('[data-go="file"]').addEventListener('click', function () { navigate(url('dg-agent-portal.html?code=' + encodeURIComponent(a.code) + '#agent')); });
        var photoBtn = body.querySelector('[data-go="photo"]');
        if (photoBtn) photoBtn.addEventListener('click', function () { navigate(url('dg-agent-portal.html?code=' + encodeURIComponent(a.code) + '#cover')); });
      }, function () { body.innerHTML = '<p class="fn-muted">Could not open the file — check the connection.</p>'; });
    });
  }

  /* ── Field ID: the business card for the Agent's agency ── */
  function pageFieldId(body) {
    var a = needAgent(body, 'The Field ID');
    if (!a) return;
    renderHead('fieldid', agentAgency().code);
    loadingThen(body, function () {
      var ag = agentAgency();
      body.innerHTML = '<div class="fn-biz-stage">' + bizCardHtml(true) + '</div>' +
        '<p class="fn-p">' + (ag.dg ? 'No agency on this Agent\'s file yet, so it carries the Program\'s own card.' : 'From the workplace on this Agent\'s file.') + '</p>' +
        '<div class="fn-actions"><button type="button" class="fn-btn fn-red" data-go="fab">Make Field ID ↗</button>' +
        '<button type="button" class="fn-btn fn-ink" data-go="blank">Blank ID Creator ↗</button></div>';
      body.querySelector('[data-go="fab"]').addEventListener('click', function () { navigate(url('dg-agent-portal.html?code=' + encodeURIComponent(a.code) + '#ids')); });
      body.querySelector('[data-go="blank"]').addEventListener('click', function () { navigate(url('dg-id-creator.html')); });
    });
  }

  /* ── Requisition: the full form, and it only lives here ── */
  function pageRequisition() {
    var host = slot('embed-req');
    var a = currentAgent();
    var code = a && !a.friendly ? a.code : '';
    var src = url('requisition.html?embed=1' + (code ? '&code=' + encodeURIComponent(code) : ''));
    renderHead('req', 'Program Manager');
    var f = host.querySelector('iframe');
    if (!f || f.getAttribute('data-src') !== src) {
      host.innerHTML = '';
      f = document.createElement('iframe');
      f.className = 'fn-embed';
      f.setAttribute('data-dg-embed', 'requisition');
      f.setAttribute('data-src', src);
      f.title = 'Requisition';
      f.src = src;
      host.appendChild(f);
    }
  }

  /* ── Notes: both pages (index + Evidence | editor); again = quick notes ── */
  function pageNotesSpread() {
    var host = slot('spread');
    var a = currentAgent();
    if (!a || a.friendly) {
      host.innerHTML = '<div class="fn-spread-msg"></div>';
      needAgent(host.firstChild, 'Notes');
      return;
    }
    var src = url('notes/index.html?embed=spread&code=' + encodeURIComponent(a.code));
    var f = host.querySelector('iframe');
    if (!f || f.getAttribute('data-src') !== src) {
      host.innerHTML = '<button type="button" class="fn-btn fn-ink fn-small fn-spread-quick" data-spread="quick" title="Or click the Notes tab again">Quick notes</button>';
      f = document.createElement('iframe');
      f.className = 'fn-embed';
      f.setAttribute('data-dg-embed', 'notes');
      f.setAttribute('data-src', src);
      f.title = 'Player Notes';
      f.src = src;
      host.appendChild(f);
      host.querySelector('[data-spread="quick"]').addEventListener('click', function () { state.notesMode = 'quick'; render(); });
    }
  }

  var TAG_TYPES = [{ id: 'npc', label: 'NPC' }, { id: 'location', label: 'Location' }, { id: 'clue', label: 'Clue' }];
  var quick = { tag: 'clue', shared: false, blocks: null, code: '', status: '' };
  function htmlToText(html) {
    var doc = new DOMParser().parseFromString('<div>' + String(html || '').replace(/<br\s*\/?>/gi, '\n') + '</div>', 'text/html');
    return doc.body.textContent || '';
  }
  function blockText(b) {
    var d = b.data || {};
    if (b.type === 'list') return (d.items || []).map(function (it) { return '• ' + htmlToText(typeof it === 'string' ? it : (it && it.content) || ''); }).join('\n');
    return htmlToText(d.text || '');
  }
  function pageQuickNotes(body) {
    var a = needAgent(body, 'Notes');
    if (!a) return;
    renderHead('notes', 'Quick capture');
    loadingThen(body, function () {
      var cellId = cellIdFor(a);
      body.innerHTML =
        '<textarea class="fn-input" rows="3" data-q="text" placeholder="New note — what did the table just find out?"></textarea>' +
        '<div class="fn-row" style="margin-top:10px">' + TAG_TYPES.map(function (t) {
          return '<button type="button" class="fn-chipbtn' + (quick.tag === t.id ? ' fn-on' : '') + '" data-type="' + t.id + '" data-q="tag">' + t.label + '</button>';
        }).join('') + '</div>' +
        '<div class="fn-row" style="margin-top:10px">' +
          '<button type="button" class="fn-chipbtn' + (quick.shared ? ' fn-on' : '') + '" data-q="shared">' + (quick.shared ? 'Shared with the Cell' : 'Private to you') + '</button>' +
          '<button type="button" class="fn-btn fn-red" style="flex:1" data-q="add">Add Note</button>' +
        '</div>' +
        '<div class="fn-q-status" data-q="status">' + esc(quick.status) + '</div>' +
        '<div class="fn-q-list" data-q="list"><p class="fn-muted">Loading your notes…</p></div>' +
        '<div class="fn-actions" style="margin-top:14px"><button type="button" class="fn-btn" style="flex:1;text-align:center" data-q="full">' + (narrow() ? 'Open Player Notes ↗' : 'Open the full notes') + '</button></div>';
      var ta = body.querySelector('[data-q="text"]');
      body.addEventListener('click', function (e) {
        var b = e.target.closest('[data-q]');
        if (!b) return;
        var q = b.getAttribute('data-q');
        if (q === 'tag') { quick.tag = b.getAttribute('data-type'); Array.prototype.forEach.call(body.querySelectorAll('[data-q="tag"]'), function (x) { x.classList.toggle('fn-on', x === b); }); }
        else if (q === 'shared') { quick.shared = !quick.shared; b.classList.toggle('fn-on', quick.shared); b.textContent = quick.shared ? 'Shared with the Cell' : 'Private to you'; }
        else if (q === 'add') addQuickNote(a, cellId, ta, body);
        else if (q === 'full') {
          // Desktop: back to the two-page spread in place; phone: the page.
          if (!narrow()) { state.notesMode = 'spread'; render(); }
          else navigate(url('notes/index.html?code=' + encodeURIComponent(a.code)));
        }
      });
      loadQuickNotes(a, cellId, body);
    });
  }
  function notesCol(cellId) { return window.firebase.firestore().collection('cells').doc(cellId).collection('notes'); }
  function loadQuickNotes(a, cellId, body) {
    window.dgStore.signInAgent(a.code).then(function () {
      return notesCol(cellId).where('agent_code', '==', a.code).get();
    }).then(function (snap) {
      var list = [];
      snap.forEach(function (doc) {
        var row = doc.data() || {};
        if (row.block_type === 'evidence_remark') return;
        var d; try { d = JSON.parse(row.text || '{}'); } catch (e) { d = { text: esc(row.text || '') }; }
        var tags; try { tags = typeof row.tags === 'string' ? JSON.parse(row.tags || '[]') : (row.tags || []); } catch (e) { tags = []; }
        list.push({ id: doc.id, type: row.block_type, data: d, shared: !!row.shared, tags: tags, sort_order: Number(row.sort_order) || 0, created_at: Number(row.created_at) || 0 });
      });
      quick.blocks = list;
      quick.code = a.code;
      renderQuickList(body);
    }).catch(function (err) {
      var el = body.querySelector('[data-q="list"]');
      if (el) el.innerHTML = '<p class="fn-muted">Could not load your notes — check the connection. (' + esc(err && (err.code || err.message) || err) + ')</p>';
    });
  }
  function renderQuickList(body) {
    var el = body.querySelector('[data-q="list"]');
    if (!el) return;
    var list = (quick.blocks || []).slice().sort(function (x, y) { return (y.created_at || 0) - (x.created_at || 0); });
    if (!list.length) { el.innerHTML = '<p class="fn-muted">Nothing written down yet.</p>'; return; }
    el.innerHTML = list.slice(0, 40).map(function (b) {
      var tag = (b.tags || [])[0];
      var when = b.created_at ? new Date(b.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
      return '<div class="fn-card-q"><div class="fn-card-head">' +
        (tag ? '<span class="fn-tag" data-type="' + esc(tag.type) + '">' + esc(tag.label || tag.type) + '</span>' : '') +
        (b.shared ? '<span class="fn-stamp fn-green">Shared</span>' : '') +
        (b.pending ? '<span class="fn-stamp fn-red">Unsynced</span>' : '') +
        '<span class="fn-card-date">' + esc(when) + '</span></div>' +
        '<div class="fn-card-body"' + (b.type === 'header' ? ' style="font-family:var(--fn-type);font-size:15px;color:#1c1608"' : '') + '>' + esc(blockText(b)) + '</div></div>';
    }).join('');
  }
  function addQuickNote(a, cellId, ta, body) {
    var text = String(ta.value || '').trim();
    if (!text) { ta.focus(); return; }
    var status = body.querySelector('[data-q="status"]');
    var now = Date.now();
    var blockId = 'blk_' + now.toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    var tt = TAG_TYPES.filter(function (t) { return t.id === quick.tag; })[0];
    var tags = tt ? [{ type: tt.id, label: tt.label }] : [];
    var maxSort = (quick.blocks || []).reduce(function (m, b) { return Math.max(m, b.sort_order || 0); }, 0);
    var dataObj = { text: esc(text).replace(/\n/g, '<br>') };
    var block = { id: blockId, type: 'paragraph', data: dataObj, shared: quick.shared, tags: tags, sort_order: maxSort + 1000, created_at: now, pending: true };
    quick.blocks = [block].concat(quick.blocks || []);
    ta.value = '';
    renderQuickList(body);
    if (status) status.textContent = 'Saving…';
    // Same document shape notes/notes.js writes (saveNoteBlockFirestore_),
    // so the note shows up in the full Player Notes on every device.
    window.dgStore.signInAgent(a.code).then(function () {
      return notesCol(cellId).doc(blockId).set({
        agent_code: a.code, block_type: 'paragraph', text: JSON.stringify(dataObj),
        shared: !!block.shared, sort_order: block.sort_order, created_at: now, updated_at: now,
        pinned: false, tags: JSON.stringify(tags)
      });
    }).then(function () {
      block.pending = false;
      quick.status = 'Saved to your notes.';
      if (status) status.textContent = quick.status;
      renderQuickList(body);
    }).catch(function (err) {
      quick.status = 'Could not save — kept on screen only. (' + (err && (err.code || err.message) || err) + ')';
      if (status) status.textContent = quick.status;
      ta.value = text;
    });
  }

  /* ── Evidences, filtered by Operation ── */
  function pageEvidence(body) {
    var a = needAgent(body, 'Evidence');
    if (!a) return;
    loadingThen(body, function () {
      body.innerHTML = '<p class="fn-muted">Opening the locker…</p>';
      var cellsById = {}; data.cells.forEach(function (c) { cellsById[c.cell_id] = c; });
      var opsById = {}; data.ops.forEach(function (o) { opsById[o.operation_id] = o; });
      window.dgStore.signInAgent(a.code).then(function () {
        return Promise.all([
          window.firebase.firestore().collection('evidence').where('visible_to', 'array-contains-any', [a.code, 'ALL']).get(),
          window.dgStore.listHandoutNotes(a.code).catch(function () { return []; })
        ]);
      }).then(function (res) {
        if (!state.open || state.view !== 'evidence') return;
        var items = [];
        res[0].forEach(function (doc) { var d = doc.data() || {}; items.push(Object.assign({ evidence_id: doc.id }, d)); });
        items.sort(function (x, y) { return Number(y.created_at || 0) - Number(x.created_at || 0); });
        var notes = {}; res[1].forEach(function (n) { notes[n.handout_id] = n.note; });
        renderHead('evidence', items.length + ' filed');
        if (!items.length) { body.innerHTML = '<p class="fn-muted">Nothing filed for this Agent yet.</p>'; return; }
        var opIds = [], hasUnfiled = false;
        items.forEach(function (h) { if (h.operation_id) { if (opIds.indexOf(h.operation_id) === -1) opIds.push(h.operation_id); } else hasUnfiled = true; });
        if (state.evOp && state.evOp !== 'UNFILED' && opIds.indexOf(state.evOp) === -1) state.evOp = '';
        var opName = function (id) { return (opsById[id] && opsById[id].name) || id; };
        body.innerHTML = '<div class="fn-filter"><label>Operation</label><select class="fn-select" data-ev-filter>' +
          '<option value="">All operations</option>' +
          opIds.map(function (id) { return '<option value="' + esc(id) + '"' + (state.evOp === id ? ' selected' : '') + '>' + esc(opName(id)) + '</option>'; }).join('') +
          (hasUnfiled ? '<option value="UNFILED"' + (state.evOp === 'UNFILED' ? ' selected' : '') + '>Unfiled</option>' : '') +
          '</select></div><div data-ev-list></div>';
        function draw() {
          var shown = items.filter(function (h) { return !state.evOp || (state.evOp === 'UNFILED' ? !h.operation_id : h.operation_id === state.evOp); });
          var list = body.querySelector('[data-ev-list]');
          list.innerHTML = shown.length ? shown.map(function (h) {
            var scope = h.cell_id ? ((cellsById[h.cell_id] && cellsById[h.cell_id].name) || h.cell_id) : 'All Cells';
            var when = h.created_at ? new Date(Number(h.created_at)).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';
            return '<div class="fn-card-sheet"><div class="fn-card-head">' +
              '<span class="fn-stamp ' + (h.cell_id ? 'fn-red' : 'fn-green') + '">' + esc(scope) + '</span>' +
              '<span class="fn-tag" style="background:rgba(28,22,8,.08)">' + esc(h.operation_id ? opName(h.operation_id) : 'Unfiled') + '</span>' +
              '<span class="fn-card-date">' + esc(when ? 'Filed ' + when : '') + '</span></div>' +
              '<div class="fn-card-title">' + esc(h.title || 'Untitled') + '</div>' +
              (h.photo ? '<div data-ev-photo="' + esc(h.evidence_id) + '"></div>' : '') +
              '<div class="fn-card-body">' + esc(h.body || '') + '</div>' +
              '<div class="fn-remark"><div class="fn-label" style="margin:0 0 5px">Your private remarks</div>' +
                '<textarea class="fn-input" rows="2" placeholder="Only you see these." data-ev="' + esc(h.evidence_id) + '">' + esc(notes[h.evidence_id] || '') + '</textarea>' +
                '<div class="fn-remark-status" data-ev-status="' + esc(h.evidence_id) + '"></div></div></div>';
          }).join('') : '<p class="fn-muted">Nothing filed under this Operation.</p>';
          shown.forEach(function (h) {
            if (!h.photo) return;
            var holder = list.querySelector('[data-ev-photo="' + h.evidence_id + '"]');
            if (!holder) return;
            var box = document.createElement('div');
            holder.appendChild(box);
            var mo = new MutationObserver(function () { var img = box.querySelector('img'); if (img) { img.className = 'fn-ev-photo'; mo.disconnect(); } });
            mo.observe(box, { childList: true });
            setImage(box, h.photo);
            var img0 = box.querySelector('img'); if (img0) img0.className = 'fn-ev-photo';
          });
          var timers = {};
          Array.prototype.forEach.call(list.querySelectorAll('textarea[data-ev]'), function (ta) {
            ta.addEventListener('input', function () {
              var id = ta.getAttribute('data-ev');
              notes[id] = ta.value;
              var st = list.querySelector('[data-ev-status="' + id + '"]');
              if (st) st.textContent = 'Unsaved…';
              clearTimeout(timers[id]);
              timers[id] = setTimeout(function () {
                window.dgStore.saveHandoutNote(a.code, id, ta.value).then(function () {
                  if (st) st.textContent = 'Saved.';
                }, function () { if (st) st.textContent = 'Could not save — check the connection.'; });
              }, 900);
            });
          });
        }
        body.querySelector('[data-ev-filter]').addEventListener('change', function (e) { state.evOp = e.target.value; draw(); });
        draw();
      }).catch(function (err) {
        body.innerHTML = '<p class="fn-muted">Could not open the locker — check the connection. (' + esc(err && (err.code || err.message) || err) + ')</p>';
      });
    });
  }

  /* ── Radio: a pager on the desk beside the notebook ── */
  var pagerTimer = null, pagerPick = '';
  function radioState() { return window.dgRadio ? window.dgRadio.state() : null; }
  function renderChip() {
    var s = radioState();
    Array.prototype.forEach.call(root.querySelectorAll('[data-fn="chip"]'), function (chip) {
      if (!s) { chip.hidden = true; return; }
      chip.hidden = false;
      chip.classList.toggle('fn-live', !!s.live);
      var label = !s.tuned ? 'Radio' : (s.resumeNeeded ? 'Tap for sound' : (s.live ? (s.muted ? 'Muted' : 'On air') : 'Waiting'));
      chip.innerHTML = '<span class="fn-chip-dot"></span>' + (s.tuned ? '<b>CH ' + esc(s.channel) + '</b> ' : '') + esc(label);
      chip.title = s.tuned && s.track ? 'Now playing: ' + s.track : 'Table Radio';
    });
    if (s && s.channel) lsSet('dg_fn_last_channel', s.channel);
    if (!root.querySelector('#fn-pager').hidden) updatePager();
  }
  function togglePager() { if (root.querySelector('#fn-pager').hidden) openPager(); else closePager(); }
  function closePager() {
    var p = root.querySelector('#fn-pager');
    if (!p || p.hidden) return;
    p.hidden = true;
    if (pagerTimer) { clearInterval(pagerTimer); pagerTimer = null; }
  }
  function openPager() {
    var r = window.dgRadio;
    if (!r) return;
    hidePeek();
    var p = root.querySelector('#fn-pager');
    var chans = r.channels;
    pagerPick = lsGet('dg_fn_last_channel') || chans[0];
    p.innerHTML =
      '<div class="fn-pg-case">' +
        '<span class="fn-pg-screw fn-pg-s1"></span><span class="fn-pg-screw fn-pg-s2"></span><span class="fn-pg-screw fn-pg-s3"></span><span class="fn-pg-screw fn-pg-s4"></span>' +
        '<button type="button" class="fn-pg-x" data-p="x" aria-label="Put the radio away">×</button>' +
        '<div class="fn-pg-screen"><div class="fn-pg-row"><b data-p="ch">CH —</b><span data-p="st"></span></div>' +
          '<div class="fn-pg-track" data-p="track"></div>' +
          '<div class="fn-pg-bar"><div class="fn-pg-fill" data-p="fill"></div></div><div class="fn-pg-time" data-p="time"></div></div>' +
        '<div class="fn-pg-controls">' +
          '<div class="fn-dial"><div class="fn-dial-ring"></div><div class="fn-dial-knob" data-p="knob"></div>' +
            chans.map(function (c, i) {
              var ang = (i * 360 / chans.length - 90) * Math.PI / 180;
              return '<button type="button" class="fn-dial-tick" data-ch="' + c + '" style="left:calc(50% + ' + (36 * Math.cos(ang)).toFixed(1) + 'px);top:calc(50% + ' + (36 * Math.sin(ang)).toFixed(1) + 'px)">' + c + '</button>';
            }).join('') +
          '</div>' +
          '<div class="fn-pg-keys">' +
            '<button type="button" class="fn-pg-key fn-pg-tune" data-p="tune">Tune In</button>' +
            '<button type="button" class="fn-pg-key" data-p="mute">Sound</button>' +
            '<label class="fn-pg-vol"><span>Vol</span><input type="range" min="0" max="100" step="1" data-p="vol" aria-label="Volume"></label>' +
            '<button type="button" class="fn-pg-key fn-pg-resume" data-p="resume" hidden>Tap for sound</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    p.onclick = function (e) {
      var t = e.target.closest('[data-ch],[data-p]');
      if (!t) return;
      var s = r.state();
      if (t.hasAttribute('data-ch')) {
        pagerPick = t.getAttribute('data-ch');
        lsSet('dg_fn_last_channel', pagerPick);
        if (s.tuned) r.tune(pagerPick);
      } else {
        var k = t.getAttribute('data-p');
        if (k === 'x') { closePager(); return; }
        if (k === 'tune') { if (s.tuned) r.leave(); else { r.tune(pagerPick); if (r.state().muted) r.setMuted(false); } }
        else if (k === 'mute') r.setMuted(!s.muted);
        else if (k === 'resume') r.resume();
      }
      updatePager();
      renderChip();
    };
    p.querySelector('[data-p="vol"]').addEventListener('input', function (e) { r.setVolume(e.target.value); });
    p.hidden = false;
    updatePager();
    if (pagerTimer) clearInterval(pagerTimer);
    pagerTimer = setInterval(updatePager, 1000);
  }
  function updatePager() {
    var p = root.querySelector('#fn-pager');
    var s = radioState();
    if (!s || !p || p.hidden || !p.querySelector('.fn-pg-case')) return;
    var q = function (k) { return p.querySelector('[data-p="' + k + '"]'); };
    var ch = s.tuned ? s.channel : pagerPick;
    var idx = window.dgRadio.channels.indexOf(ch);
    q('knob').style.transform = 'rotate(' + (Math.max(0, idx) * 360 / window.dgRadio.channels.length) + 'deg)';
    Array.prototype.forEach.call(p.querySelectorAll('[data-ch]'), function (b) { b.classList.toggle('fn-on', b.getAttribute('data-ch') === ch); });
    q('ch').textContent = 'CH ' + ch;
    q('st').textContent = !s.tuned ? 'Off' : (s.live ? (s.muted ? 'Muted' : 'On air') : (s.paused ? 'Paused' : 'Waiting'));
    q('track').textContent = s.tuned ? (s.track || '—') : '—';
    var pct = s.duration ? Math.max(0, Math.min(100, (s.elapsed / s.duration) * 100)) : 0;
    q('fill').style.width = pct + '%';
    q('time').textContent = s.duration ? s.formatTime(s.elapsed) + ' / ' + s.formatTime(s.duration) : '';
    q('tune').textContent = s.tuned ? 'Leave' : 'Tune In';
    q('tune').classList.toggle('fn-on', !!s.tuned);
    q('mute').textContent = s.muted ? 'Muted' : 'Sound';
    q('mute').classList.toggle('fn-on', !s.muted);
    var vol = q('vol'); if (document.activeElement !== vol) vol.value = String(s.volume);
    q('resume').hidden = !s.resumeNeeded;
  }

  /* ── Roll slip: a roll started from the page itself (a skill tap on the
     sheet, Friendly's skill and weapon buttons) shows its result in a
     small card above the closed notebook -- no veil, so the next tap on
     the sheet still lands. The notebook itself only opens when asked. ── */
  var peekEl = null, peekTimer = null, peekHover = false;
  function onRollStart() {
    if (state.suspended) return;
    if (state.open) { if (state.view !== 'dice') show('dice'); return; }
    showPeek();
  }
  function showPeek() {
    var panel = document.getElementById('dr-panel');
    if (!panel) return;
    if (!peekEl) {
      peekEl = document.createElement('div');
      peekEl.id = 'fn-peek';
      peekEl.innerHTML = '<div class="fn-peek-head"><span>Dice Roller</span>' +
        '<button type="button" data-peek="open" title="Open the Dice page">Open</button>' +
        '<button type="button" data-peek="x" title="Close" aria-label="Close">×</button></div><div class="fn-peek-body"></div>';
      root.appendChild(peekEl);
      peekEl.addEventListener('click', function (e) {
        var b = e.target.closest('[data-peek]');
        if (!b) return;
        if (b.getAttribute('data-peek') === 'open') { hidePeek(); open('dice'); } else hidePeek();
      });
      peekEl.addEventListener('pointerenter', function () { peekHover = true; });
      peekEl.addEventListener('pointerleave', function () { peekHover = false; armPeekHide(); });
    }
    var body = peekEl.querySelector('.fn-peek-body');
    if (panel.parentNode !== body) body.appendChild(panel);
    if (panel.classList.contains('dr-collapsed') && window.dgDice && window.dgDice._toggle) window.dgDice._toggle();
    peekEl.hidden = false;
    armPeekHide();
  }
  function armPeekHide() {
    clearTimeout(peekTimer);
    peekTimer = setTimeout(function () { if (peekHover) armPeekHide(); else hidePeek(); }, 9000);
  }
  function hidePeek() {
    clearTimeout(peekTimer);
    if (peekEl) peekEl.hidden = true;
  }
  // A tap anywhere else on the page puts the slip away (same as the old
  // dice panel collapsing on a sheet tap). The tap that starts a roll
  // lands before the roll does, so it never hides its own result.
  function pagePointer(target) {
    if (!peekEl || peekEl.hidden) return;
    if (target && peekEl.contains(target)) return;
    hidePeek();
  }
  document.addEventListener('pointerdown', function (e) { pagePointer(e.target); }, true);
  /* ── Dice: the engine's own panel, moved onto this page ── */
  function pageDice() {
    hidePeek();
    var a = currentAgent();
    renderHead('dice', a ? agentName(a) : '');
    var host = slot('dice-host');
    var panel = document.getElementById('dr-panel');
    if (!panel) { host.innerHTML = '<p class="fn-muted" style="color:#c8c1a8;padding:10px">The dice roller isn\'t available on this page.</p>'; return; }
    if (panel.parentNode !== host) { host.innerHTML = ''; host.appendChild(panel); }
    if (panel.classList.contains('dr-collapsed') && window.dgDice && window.dgDice._toggle) window.dgDice._toggle();
  }
  /* ── Rules: the Rules Reference page itself, read inline ── */
  var rules = { loading: null, sections: null, q: '', reading: null, open: {} };
  function loadRules() {
    if (rules.loading) return rules.loading;
    rules.loading = fetch(url('rules-reference.html'), { credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      rules.sections = Array.prototype.map.call(doc.querySelectorAll('section.ref-section'), function (sec) {
        var h2 = sec.querySelector('h2');
        var blocks = Array.prototype.map.call(sec.querySelectorAll('.ref-block'), function (b, i) {
          var h3 = b.querySelector('h3');
          return { i: i, h: h3 ? h3.textContent.trim() : (h2 ? h2.textContent.trim() : ''), html: b.innerHTML, text: b.textContent.toLowerCase() };
        });
        return { id: sec.id, h: h2 ? h2.textContent.trim() : sec.id, blocks: blocks, html: sec.innerHTML };
      });
      return rules.sections;
    }).catch(function (err) { rules.loading = null; throw err; });
    return rules.loading;
  }
  // The five tenets again, as the oath at the head of the Rules -- the
  // same text as the new-Agent clearance briefing (ORDERS_TEXT below).
  function oathHtml() {
    return '<div class="fn-oath"><div class="fn-oath-k">The Agent\'s Oath</div><ol>' +
      ORDERS_TEXT.filter(function (l) { return /^\d\./.test(l[1]); }).map(function (l) {
        var m = /^\d\.\s*([^.]+\.)\s*(.*)$/.exec(l[1]);
        return '<li><b>' + esc(m ? m[1] : l[1]) + '</b> ' + esc(m ? m[2] : '') + '</li>';
      }).join('') + '</ol><div class="fn-oath-foot">We need your silence.</div></div>';
  }
  function pageRules(body) {
    renderHead('rules', '');
    body.innerHTML = '<p class="fn-muted">Opening the reference…</p>';
    loadRules().then(function (secs) {
      if (!state.open || state.view !== 'rules') return;
      renderHead('rules', secs.length + ' sections');
      if (rules.reading) { renderRuleRead(body); return; }
      body.innerHTML = oathHtml() +
        '<input class="fn-input fn-search" type="search" data-r="q" placeholder="Search the rules" value="' + esc(rules.q) + '">' +
        '<div data-r="list"></div>';
      var qi = body.querySelector('[data-r="q"]');
      qi.addEventListener('input', function () { rules.q = qi.value; renderRuleList(body); });
      body.querySelector('[data-r="list"]').addEventListener('click', function (e) {
        var tog = e.target.closest('[data-toggle]');
        if (tog) { var id = tog.getAttribute('data-toggle'); rules.open[id] = !rules.open[id]; renderRuleList(body); return; }
        var b = e.target.closest('[data-sec]');
        if (!b) return;
        rules.reading = { sec: b.getAttribute('data-sec'), block: b.hasAttribute('data-block') ? Number(b.getAttribute('data-block')) : null };
        renderRuleRead(body);
      });
      renderRuleList(body);
    }).catch(function () {
      body.innerHTML = '<p class="fn-muted">Could not open the Rules Reference — check the connection.</p>';
    });
  }
  function renderRuleList(body) {
    var list = body.querySelector('[data-r="list"]');
    var q = rules.q.trim().toLowerCase();
    var html = rules.sections.map(function (s) {
      var secHit = !q || s.h.toLowerCase().indexOf(q) !== -1;
      var blocks = s.blocks.filter(function (b) { return secHit || b.h.toLowerCase().indexOf(q) !== -1 || b.text.indexOf(q) !== -1; });
      if (!secHit && !blocks.length) return '';
      var isOpen = q ? true : !!rules.open[s.id];
      return '<div class="fn-rule' + (isOpen ? ' fn-open' : '') + '">' +
        '<button type="button" class="fn-rule-h" data-toggle="' + esc(s.id) + '"><span>' + esc(s.h) + '</span><span class="fn-rule-n">' + blocks.length + '</span></button>' +
        (isOpen ? '<ul class="fn-rule-subs">' + blocks.map(function (b) {
          return '<li><button type="button" data-sec="' + esc(s.id) + '" data-block="' + b.i + '">' + esc(b.h) + '</button></li>';
        }).join('') + '</ul>' : '') + '</div>';
    }).join('');
    list.innerHTML = html || '<p class="fn-muted">No section matches that.</p>';
  }
  function renderRuleRead(body) {
    var s = rules.sections.filter(function (x) { return x.id === rules.reading.sec; })[0];
    if (!s) { rules.reading = null; render(); return; }
    var inner = rules.reading.block != null && s.blocks[rules.reading.block] ? s.blocks[rules.reading.block].html : s.html;
    body.innerHTML = '<div class="fn-actions" style="margin-bottom:10px"><button type="button" class="fn-btn fn-ink" data-r="back">← All rules</button>' +
      '<button type="button" class="fn-btn" data-r="full">Open full page ↗</button></div>' +
      '<div class="fn-rules-read">' + (rules.reading.block != null ? '<h2>' + esc(s.h) + '</h2>' : '') + inner + '</div>';
    var q = rules.q.trim();
    if (q.length > 2) highlight(body.querySelector('.fn-rules-read'), q);
    body.querySelector('[data-r="back"]').addEventListener('click', function () { rules.reading = null; render(); });
    body.querySelector('[data-r="full"]').addEventListener('click', function () { navigate(url('rules-reference.html#' + s.id)); });
    body.scrollTop = 0;
  }
  function highlight(el, q) {
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    var lower = q.toLowerCase(), nodes = [], n;
    while ((n = walker.nextNode())) if (n.nodeValue.toLowerCase().indexOf(lower) !== -1) nodes.push(n);
    nodes.slice(0, 60).forEach(function (node) {
      var i = node.nodeValue.toLowerCase().indexOf(lower);
      var mid = node.splitText(i); mid.splitText(q.length);
      var mark = document.createElement('mark'); mark.textContent = mid.nodeValue;
      mid.parentNode.replaceChild(mark, mid);
    });
  }

  /* ── Settings ── */
  // The character sheet's own cog (stats/index.html #settings-panel) is
  // the source of truth for its settings: these buttons press the sheet's
  // real controls, so every confirm/prompt and edge case stays theirs.
  var EXPORTS = [
    { id: 'export-printable', label: 'Printable sheet' },
    { id: 'export-pdf', label: 'PDF (DD Form 315)' },
    { id: 'export-sheets', label: 'Google Sheet (.xlsx)' },
    { id: 'export-agent-file-btn', label: 'To the Agent File' }
  ];
  var SHEET_ACTIONS = [
    { id: 'download-sheet-btn', label: 'Download Sheet' },
    { id: 'upload-sheet-btn', label: 'Upload Sheet' },
    { id: 'copy-link-btn', label: 'Copy Share Link' }
  ];
  function sheetWin() {
    var w = contentWin();
    return w && onStatsPage(w) && w.document.getElementById('settings-panel') ? w : null;
  }
  function pageSettings(body) {
    renderHead('settings', '');
    var a = currentAgent();
    var sw = sheetWin();
    var ci = lsGet('dg_cover_identity') || '';
    var bootOff = lsGet(BOOT_OFF_KEY) === '1';
    var html = '';
    if (sw) {
      var themeSel = sw.document.getElementById('cs-theme-select');
      html += '<div class="fn-set-row"><div><div class="fn-set-t">Theme</div><div class="fn-set-s">How the character sheet looks on this device.</div></div>' +
        '<select class="fn-select" data-s="theme">' + (themeSel ? Array.prototype.map.call(themeSel.options, function (o) {
          return '<option value="' + esc(o.value) + '"' + (o.value === themeSel.value ? ' selected' : '') + '>' + esc(o.textContent) + '</option>';
        }).join('') : '') + '</select></div>';
    }
    html += '<div class="fn-set-row fn-set-col"><div class="fn-set-t">Cover Identity</div>' +
        '<div class="fn-set-s">Your real name — how this device finds your Agents.</div>' +
        '<div class="fn-row" style="margin-top:6px"><input class="fn-input" style="flex:1;min-width:0" data-s="ci" value="' + esc(ci) + '" placeholder="e.g. Gergo">' +
        '<button type="button" class="fn-btn fn-red" data-s="reload">Save &amp; Reload My Agents</button></div>' +
        '<div class="fn-set-status" data-s="ci-status"></div></div>';
    if (sw) {
      var has = function (id) { return !!sw.document.getElementById(id); };
      html += (has('creation-tools-unlocked-btn') ? '<div class="fn-set-row"><div><div class="fn-set-t">Fix a Creation Mistake</div><div class="fn-set-s">Brings back the Bonus Points panel and Bond generator until your next visit.</div></div>' +
          '<button type="button" class="fn-btn fn-ink" data-s-btn="creation-tools-unlocked-btn">Fix</button></div>' : '') +
        '<div class="fn-set-row"><div><div class="fn-set-t">Export</div><div class="fn-set-s">A copy of this character, in the format you pick.</div></div>' +
          '<div class="fn-menu"><button type="button" class="fn-btn fn-red" data-s="export">Export ▾</button>' +
          '<div class="fn-menu-list" data-s="export-list" hidden>' + EXPORTS.filter(function (x) { return has(x.id); }).map(function (x) {
            return '<button type="button" data-s-btn="' + x.id + '">' + esc(x.label) + '</button>';
          }).join('') + '</div></div></div>' +
        '<div class="fn-set-row fn-set-col"><div class="fn-set-t">Backup</div>' +
          '<div class="fn-set-grid">' + SHEET_ACTIONS.filter(function (x) { return has(x.id); }).map(function (x, i) {
            return '<button type="button" class="fn-btn ' + (i % 2 ? 'fn-ink' : 'fn-red') + '" data-s-btn="' + x.id + '">' + esc(x.label) + '</button>';
          }).join('') + '</div></div>' +
        '<div class="fn-set-row fn-set-col"><div class="fn-set-t">Load by Agent Code</div>' +
          '<div class="fn-row" style="margin-top:6px"><input class="fn-input" style="flex:1;min-width:0;text-transform:uppercase" data-s="code" placeholder="AGENT CODE">' +
          '<button type="button" class="fn-btn fn-ink" data-s="load">Load</button></div></div>' +
        '<div class="fn-actions" style="margin:10px 0 4px"><button type="button" class="fn-btn" data-s="more">Import &amp; more sheet settings…</button></div>';
    } else if (a && !a.friendly) {
      html += '<div class="fn-set-row"><div><div class="fn-set-t">Character sheet</div><div class="fn-set-s">Theme, exports, backups and imports for ' + esc(agentName(a)) + '.</div></div>' +
        '<button type="button" class="fn-btn fn-ink" data-s="gosheet">Open sheet ↗</button></div>';
    }
    html += '<div class="fn-set-row"><div><div class="fn-set-t">Boot splash</div><div class="fn-set-s">Plays the clearance terminal once per session. Off skips the animation; the same screen still shows while a page loads.</div></div>' +
        '<button type="button" class="fn-toggle' + (bootOff ? '' : ' fn-on') + '" data-s="boot">' + (bootOff ? 'OFF' : 'ON') + '</button></div>';
    body.innerHTML = html;
    body.addEventListener('click', function (e) {
      var b = e.target.closest('[data-s],[data-s-btn]');
      if (!b) return;
      var id = b.getAttribute('data-s-btn');
      if (id && sw) { var el = sw.document.getElementById(id); if (el) { close(); el.click(); } return; }
      var k = b.getAttribute('data-s');
      if (k === 'export') { var m = body.querySelector('[data-s="export-list"]'); m.hidden = !m.hidden; }
      else if (k === 'load' && sw && sw.dgCloudSave) { var v = body.querySelector('[data-s="code"]').value; close(); sw.dgCloudSave.loadFromCloud(v); }
      else if (k === 'more' && sw && sw.dgSettingsPanel) { close(); sw.dgSettingsPanel.open(); }
      else if (k === 'gosheet' && a) { try { sessionStorage.setItem(OPEN_ON_ARRIVAL_KEY, 'settings'); } catch (err) { /* private mode */ } navigate(url('stats/index.html?load=' + encodeURIComponent(a.code))); }
      else if (k === 'boot') { var off = lsGet(BOOT_OFF_KEY) !== '1'; lsSet(BOOT_OFF_KEY, off ? '1' : '0'); b.classList.toggle('fn-on', !off); b.textContent = off ? 'OFF' : 'ON'; }
      else if (k === 'reload') reloadMyAgents(body);
    });
    var sel = body.querySelector('[data-s="theme"]');
    if (sel && sw) sel.addEventListener('change', function () {
      var t = sw.document.getElementById('cs-theme-select');
      if (t) { t.value = sel.value; t.dispatchEvent(new Event('change', { bubbles: true })); }
    });
  }
  // Same merge hub.html's Cover Identity preload does: this identity's
  // Agents replace the roster's, keeping entries with no player name.
  function reloadMyAgents(body) {
    var input = body.querySelector('[data-s="ci"]');
    var st = body.querySelector('[data-s="ci-status"]');
    var name = String(input.value || '').trim();
    if (!name) { st.textContent = 'Type your real name first.'; return; }
    lsSet('dg_cover_identity', name);
    st.textContent = 'Looking up your Agents…';
    ensureStore().then(function (st) { return st.findByPlayerName(name); }).then(function (agents) {
      var prior = roster(), next = {};
      Object.keys(prior).forEach(function (c) { if (!prior[c].player_name) next[c] = prior[c]; });
      (agents || []).forEach(function (a) {
        if (!a.code) return;
        next[a.code] = {
          code: a.code, char_name: a.char_name || '', codename: a.codename || '', sex: a.sex || '',
          age_range: a.age_range || '', nationality: a.nationality || '', active_eras: a.active_eras || '',
          face_plate_url: a.face_plate_url || '', campaign_era: a.campaign_era || '',
          player_name: a.player_name || name.toLowerCase(), saved_at: a.saved_at || Date.now()
        };
      });
      lsSet(ROSTER_KEY, JSON.stringify(next));
      st.textContent = (agents || []).length ? 'Found ' + agents.length + ' Agent' + (agents.length === 1 ? '' : 's') + '.' : 'No Agents found for that name.';
      refresh();
      if (contentIs('agent-hub.html')) { try { contentWin().location.reload(); } catch (e) { /* best effort */ } }
    }, function () { st.textContent = 'Could not reach the roster — check the connection.'; });
  }

  /* ── Page arrival: A-Cell suspends; onboarding; ?fn= deep links ── */
  function onShellPageChange() {
    var p = contentPath();
    setSuspended(p.indexOf('a-cell.html') !== -1);
    refresh();
    afterPageArrival();
  }
  function afterPageArrival() {
    if (state.suspended) return;
    var w = contentWin();
    var onSheet = onStatsPage(w);
    if (!onSheet) maybeShowOrders();
    onboardingNudge();
    // ?fn=VIEW on the page (or the shell) opens the notebook there --
    // how requisition.html visited directly forwards into it.
    var want = '';
    try { want = new URLSearchParams(location.search).get('fn') || ''; } catch (e) { want = ''; }
    try { if (!want && w && w !== window) want = new URLSearchParams(w.location.search).get('fn') || ''; } catch (e) { /* ignore */ }
    try { if (!want) { want = sessionStorage.getItem(OPEN_ON_ARRIVAL_KEY) || ''; sessionStorage.removeItem(OPEN_ON_ARRIVAL_KEY); } } catch (e) { /* ignore */ }
    if (want && VIEWS.indexOf(want) !== -1 && !document.getElementById('fn-orders')) setTimeout(function () { open(want); }, 300);
  }

  /* ── Public API ── */
  window.dgFieldNotes = {
    isHost: true,
    open: open, close: close, refresh: refresh, armOrders: armOrders,
    isOpen: function () { return state.open; },
    // A page inside the notebook (desktop Notes) going somewhere else: it
    // goes in the page under the notebook, not inside the notebook's own
    // frame -- where it used to strand the player (no way back to Notes).
    go: function (path) { navigate(url(path)); },
    ordersKey: function (key) { return ordersKeyHandler ? ordersKeyHandler(key) : false; },
    pagePointer: function () { pagePointer(null); },
    view: function () { return state.view; }
  };

  /* ── Standing Orders: the five tenets, new-Agent onboarding ── */
  // Our own simplified wording of the Program's priorities -- NOT the
  // rulebook's text (the repo and site are public).
  // The recruitment briefing a new Agent gets after signing the
  // clearance agreement, in our own words. The briefing's closing ask
  // (silence, and whether they can call on you) is the Y/N prompt below.
  var ORDERS_TEXT = [
    ['fn-o-head', 'CLEARANCE BRIEFING — NEED TO KNOW'],
    ['', ''],
    ['', '1. IT HAS HAPPENED BEFORE. Unnatural incursions are real, and they kill.'],
    ['', '2. KNOWING SPREADS IT. Exposure does the damage; only a cover-up stops it.'],
    ['', '3. WE ARE FEW. A small, secret task force exists to stop them.'],
    ['', '4. THE WORK IS NECESSARY. It is also clandestine, and not always legal.'],
    ['', '5. ASK NOTHING. Explanations don\'t come. Looking into us is forbidden; you learn only what you need to know.'],
    ['', ''],
    ['', 'We need your silence.']
  ];
  var BRIEFING_WORDS = [['PALE', 'IRON', 'QUIET', 'BITTER', 'HOLLOW', 'GRAY', 'NORTHERN', 'SILENT', 'BURNT', 'WINTER'],
    ['LANTERN', 'ORCHARD', 'HARBOR', 'MERIDIAN', 'CISTERN', 'THRESHOLD', 'LEDGER', 'SPARROW', 'CANTICLE', 'FATHOM']];
  function briefingCodename() {
    var r = function (a) { return a[Math.floor(Math.random() * a.length)]; };
    return r(BRIEFING_WORDS[0]) + ' ' + r(BRIEFING_WORDS[1]);
  }
  var ordersKeyHandler = null;
  function maybeShowOrders() {
    if (document.getElementById('fn-orders')) return;
    var p = lsJson(ORDERS_PENDING_KEY, null);
    if (!p || !p.code) return;
    if (ordersAck()[p.code]) { lsDel(ORDERS_PENDING_KEY); return; }
    showOrders(p);
  }
  function showOrders(p) {
    close();
    var who = p.name ? p.name + ' (' + p.code + ')' : p.code;
    var lines = [['fn-o-dim', '>clearance_agreement: signed'], ['fn-o-dim', '>briefing_codename: ' + briefingCodename()],
      ['fn-o-dim', '>recruit: ' + who], ['', '']].concat(ORDERS_TEXT);
    var ov = document.createElement('div');
    ov.id = 'fn-orders';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-label', 'Clearance briefing');
    ov.innerHTML = '<div class="fn-orders-term"><div data-o="log"></div><div data-o="prompt" hidden>' +
      '<div>CAN WE CALL ON YOU? [Y/N]<span class="fn-cursor"></span></div>' +
      '<div class="fn-orders-prompt"><button type="button" class="fn-orders-key" data-o="y">Y — you can call on me</button>' +
      '<button type="button" class="fn-orders-key" data-o="n">N — not now</button></div></div></div>';
    root.appendChild(ov);
    ov.tabIndex = -1;
    try { ov.focus(); } catch (e) { /* best effort */ }
    var log = ov.querySelector('[data-o="log"]');
    var prompt = ov.querySelector('[data-o="prompt"]');
    var li = 0, ci = 0, cur = null, timer = null, done = false, answered = false;
    function finishTyping() {
      if (done) return;
      done = true;
      clearInterval(timer);
      log.innerHTML = lines.map(function (l) { return '<div class="' + l[0] + '">' + esc(l[1]) + '&nbsp;</div>'; }).join('');
      prompt.hidden = false;
      var yb = ov.querySelector('[data-o="y"]'); if (yb) yb.focus();
    }
    timer = setInterval(function () {
      if (li >= lines.length) { finishTyping(); return; }
      if (!cur) { cur = document.createElement('div'); cur.className = lines[li][0]; log.appendChild(cur); }
      var text = lines[li][1];
      ci = Math.min(text.length, ci + 3);
      cur.innerHTML = esc(text.slice(0, ci)) + '&nbsp;';
      if (ci >= text.length) { li++; ci = 0; cur = null; }
    }, 16);
    function say(t) { var d = document.createElement('div'); d.className = 'fn-o-dim'; d.textContent = t; log.appendChild(d); }
    function decline() {
      if (answered) return;
      answered = true;
      cleanup();
      ov.remove();
    }
    function accept() {
      if (answered) return;
      if (!done) { finishTyping(); return; }
      answered = true;
      prompt.hidden = true;
      var ack = ordersAck(); ack[p.code] = Date.now();
      lsSet(ORDERS_ACK_KEY, JSON.stringify(ack));
      lsDel(ORDERS_PENDING_KEY);
      lsSet(ONBOARD_KEY, JSON.stringify({ code: p.code, step: 'photo', at: Date.now() }));
      say('>understood. we\'ll be in touch.');
      say('>filing_clearance…');
      // Recorded on the Agent's own brief so the Handler has it too --
      // only when that brief already exists: creating a stray, nameless
      // brief here would show up as a blank Agent in A-Cell.
      var saved = ensureStore().then(function (st) {
        return st.getBrief(p.code).then(function (b) {
          if (!b) return 'local';
          return st.updateBrief(p.code, { standing_orders_ack_at: new Date().toISOString() }).then(function () { return 'ok'; });
        });
      });
      var timeout = new Promise(function (res) { setTimeout(function () { res('slow'); }, 6000); });
      Promise.race([saved, timeout]).then(function (r) {
        say(r === 'ok' ? '>filed.' : '>noted_on_this_device.');
      }, function () { say('>noted_on_this_device.'); }).then(function () {
        say('>opening_agent_file: take_your_photo');
        setTimeout(function () {
          cleanup();
          ov.remove();
          navigate(url('dg-agent-portal.html?code=' + encodeURIComponent(p.code) + '#cover'));
        }, 900);
      });
    }
    function handleKey(key) {
      if (key === 'Escape' || key === 'n' || key === 'N') { if (key === 'Escape' || done) decline(); return true; }
      if (key === 'y' || key === 'Y') { accept(); return true; }
      if (!done && (key === 'Enter' || key === ' ')) { finishTyping(); return true; }
      return false;
    }
    function onKeyOrders(e) {
      if (handleKey(e.key)) { e.preventDefault(); e.stopPropagation(); }
    }
    ordersKeyHandler = handleKey;
    function cleanup() { clearInterval(timer); document.removeEventListener('keydown', onKeyOrders, true); ordersKeyHandler = null; }
    document.addEventListener('keydown', onKeyOrders, true);
    ov.addEventListener('click', function (e) {
      var b = e.target.closest('[data-o]');
      var k = b && b.getAttribute('data-o');
      if (k === 'y') accept();
      else if (k === 'n') decline();
      else if (!done) finishTyping();
    });
  }

  /* ── After the orders: photo, then Field ID ── */
  var nudgePoll = null;
  function onboardingNudge() {
    var old = root.querySelector('.fn-nudge');
    if (old) old.remove();
    if (nudgePoll) { clearInterval(nudgePoll); nudgePoll = null; }
    var ob = lsJson(ONBOARD_KEY, null);
    if (!ob || !ob.code || ob.step === 'done') return;
    if (Date.now() - (ob.at || 0) > 14 * 86400000) { lsDel(ONBOARD_KEY); return; }
    function draw() {
      var n = root.querySelector('.fn-nudge');
      if (!n) { n = document.createElement('div'); n.className = 'fn-nudge'; root.appendChild(n); }
      var photo = ob.step === 'photo';
      n.innerHTML = (photo
        ? '<b>Next:</b> take your Face Plate photo on the Agent File\'s Profiling tab.'
        : '<b>Photo on file.</b> Next: make your Field ID.') +
        '<div class="fn-row" style="margin-top:8px"><button type="button" class="fn-btn" style="padding:5px 9px" data-nudge="go">' +
        (photo ? (contentIs('dg-agent-portal.html') ? 'Show me' : 'Open Agent File') : 'Open Field ID') + '</button>' +
        '<button type="button" class="fn-btn" style="padding:5px 9px;border-color:transparent" data-nudge="x" title="Dismiss">×</button></div>';
      n.onclick = function (e) {
        var b = e.target.closest('[data-nudge]');
        if (!b) return;
        if (b.getAttribute('data-nudge') === 'x') { ob.step = 'done'; lsSet(ONBOARD_KEY, JSON.stringify(ob)); onboardingNudge(); return; }
        if (photo) {
          if (contentIs('dg-agent-portal.html')) {
            try { var w = contentWin(); w.location.hash = 'cover'; } catch (err) { /* best effort */ }
          } else navigate(url('dg-agent-portal.html?code=' + encodeURIComponent(ob.code) + '#cover'));
        } else {
          ob.step = 'done'; lsSet(ONBOARD_KEY, JSON.stringify(ob));
          onboardingNudge();
          navigate(url('dg-agent-portal.html?code=' + encodeURIComponent(ob.code) + '#ids'));
        }
      };
    }
    function check() {
      if (ob.step !== 'photo') return;
      ensureStore().then(function (st) { return st.getBrief(ob.code); }).then(function (b) {
        if (b && (window.dgStore.mainPhoto ? window.dgStore.mainPhoto(b) : b.face_plate_url) && ob.step === 'photo') {
          ob.step = 'fieldid'; lsSet(ONBOARD_KEY, JSON.stringify(ob));
          if (nudgePoll) { clearInterval(nudgePoll); nudgePoll = null; }
          draw();
          refresh();
        }
      }, function () { /* try again next tick */ });
    }
    draw();
    if (ob.step === 'photo') { check(); nudgePoll = setInterval(check, 15000); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
