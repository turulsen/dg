/* A-Cell's Prep libraries (v3.12.0): what Session prep picks from.

   Evidence: filters (Not released · Not seen yet · Released · All) over
   the evidence locker, and "+ Add to session" on each item.
   Music: the tape shelf over the broadcast desk -- the session's tape on
   the left, the library on the right (uploaded tracks as cassette spines,
   ambient loops on their own shelf, effects as cartridges). Tap one to
   add it to the session, listen to it here, or play it on the table.
   Notes: the vault (assets/acell-vault.js) -- browse, read, write, and
   the iCloud sync settings -- above the uploaded HTML pages. */
(function () {
  'use strict';
  var A = window.dgAc;
  if (!A || window.dgAcLibrary) return;
  var esc = A.esc;
  function S() { return window.dgSessions; }
  function M() { return window.dgAcellMusic; }

  /* ════════ Evidence ════════ */
  var evPanel = document.getElementById('panel-evidence');
  var evFilter = 'all';
  var chips = document.createElement('div');
  chips.className = 'ac-chips';
  chips.id = 'ac-ev-chips';
  var evToolbar = evPanel.querySelector('.evidence-toolbar');
  evToolbar.parentNode.insertBefore(chips, evToolbar.nextSibling);
  function evMatch(h, f) {
    var st = A.evidenceState(h);
    if (f === 'held') return !st.released;
    if (f === 'unseen') return st.released && st.unseen.length > 0;
    if (f === 'released') return st.released;
    return true;
  }
  window.dgEvidenceFilter = function (h) { return evFilter === 'all' || evMatch(h, evFilter); };
  window.dgEvidenceRowExtra = function (h) {
    var s = A.session();
    if (!s) return '';
    var on = s.evidence.indexOf(h.evidence_id) >= 0;
    return '<button type="button" class="paper-btn ac-ev-add' + (on ? ' on' : '') + '" data-ac-ev="' + esc(h.evidence_id) + '" title="' + esc(on ? 'Take it off ' + s.name : 'Add it to ' + s.name) + '">' + (on ? '✓ In session' : '+ Add to session') + '</button>';
  };
  function drawChips() {
    var E = window.dgAcellEvidence, items = E ? E.items() : [];
    var count = function (f) { return items.filter(function (h) { return evMatch(h, f); }).length; };
    var s = A.session();
    chips.innerHTML = [['held', 'Not released'], ['unseen', 'Not seen yet'], ['released', 'Released'], ['all', 'All']].map(function (c) {
      return '<button type="button" class="ac-chip' + (evFilter === c[0] ? ' on' : '') + '" data-f="' + c[0] + '">' + c[1] + (c[0] === 'all' ? '' : ' · ' + count(c[0])) + '</button>';
    }).join('') + '<span class="ac-chips-note">' + (s ? 'Adding to <b>' + esc(s.name) + '</b>' : 'Choose a session (top bar) to add evidence to it') + '</span>';
  }
  chips.addEventListener('click', function (e) {
    var b = e.target.closest('[data-f]');
    if (!b) return;
    evFilter = b.getAttribute('data-f');
    if (evFilter === 'unseen') A.loadSeen(true);
    drawChips();
    if (window.dgAcellEvidence) window.dgAcellEvidence.rerender();
  });
  evPanel.addEventListener('click', function (e) {
    var b = e.target.closest('[data-ac-ev]');
    if (!b) return;
    var s = A.session();
    if (!s) return;
    S().toggleIn(s.id, 'evidence', b.getAttribute('data-ac-ev')).then(function () { if (window.dgAcellEvidence) window.dgAcellEvidence.rerender(); });
    var on = !b.classList.contains('on');
    b.classList.toggle('on', on);
    b.textContent = on ? '✓ In session' : '+ Add to session';
  });
  var evOpen = false;
  document.addEventListener('dg-acell-tab', function (e) {
    evOpen = e.detail.tab === 'evidence';
    if (evOpen) { A.loadSeen(); drawChips(); }
  });
  ['dg-acell-evidence', 'dg-acell-seen', 'dg-sessions'].forEach(function (ev) {
    document.addEventListener(ev, function () {
      if (!evOpen) return;
      drawChips();
      if (ev !== 'dg-acell-evidence' && window.dgAcellEvidence) window.dgAcellEvidence.rerender();
    });
  });

  /* ════════ Music: tapes, and the library to fill them from ════════
     A tape (assets/acell-tapes.js) is an operation's -- or a Cell's -- music:
     tracks in order, loops under them, effect pads. The racks show the
     operation's tapes and the Cell's; the open tape is edited on the right;
     the library shelves (spines with each track's time, loops, effect
     cartridges) add to the open tape. The control center sits under it. */
  var muPanel = document.getElementById('panel-music');
  var consoleEl = document.getElementById('ac-console');
  var tapesEl = document.createElement('div');
  tapesEl.className = 'ac-tapes';
  tapesEl.id = 'ac-tapes';
  var shelf = document.createElement('div');
  shelf.className = 'ac-music';
  shelf.id = 'ac-shelf';
  muPanel.insertBefore(tapesEl, consoleEl || muPanel.firstChild);
  muPanel.insertBefore(shelf, consoleEl || muPanel.firstChild);
  var mu = { q: '', f: 'all', pop: null, open: '', op: '', linking: false, naming: false };
  var CART = ['#7a2a22', '#4a3a6a', '#2a4a6a', '#4a4a4a', '#6a5a2a', '#3a5a3a', '#6a3a5a', '#5a2a2a'];
  var CASE = ['#7a2a22', '#2d3d4a', '#3a3a3a', '#5b2a24', '#2c3a22', '#4a3a6a', '#6a5a2a', '#1f3a4a'];
  function hash(s) { var h = 0; s = String(s); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function T() { return window.dgTapes; }
  function openTape() { return mu.open ? T().get(mu.open) : null; }
  function onTape(t, kind, ref) {
    if (!t) return false;
    if (kind === 'stinger') return t.pads.indexOf(ref) >= 0;
    if (kind === 'ambient') return t.loops.indexOf(ref) >= 0;
    return t.tracks.some(function (x) { return x.kind === kind && x.ref === ref; });
  }
  // The operation the tapes are for: the session's, else the one picked here.
  function curOp() {
    var s = A.session();
    if (mu.op) return mu.op;
    if (s && s.operation_id) return s.operation_id;
    var ops = T().operations().filter(function (o) { return !s || !s.cell_id || o.cell_id === s.cell_id; });
    return ops[0] ? ops[0].operation_id : '';
  }
  function curCell() { var s = A.session(); return s ? s.cell_id : ''; }

  function drawTapes() {
    var D = T(), m = M();
    if (!D || !m) return;
    var opId = curOp(), op = D.operation(opId), cell = A.cell(curCell()), deck = m.state().tape, ch = m.channel();
    var s = A.session();
    var opSel = '<select class="ac-opsel" data-mu-op><option value="">— an operation —</option>' + D.operations().filter(function (o) { return !cell || !o.cell_id || o.cell_id === cell.cell_id; }).map(function (o) {
      return '<option value="' + esc(o.operation_id) + '"' + (o.operation_id === opId ? ' selected' : '') + '>' + esc(o.name) + '</option>';
    }).join('') + '</select>';
    function card(t) {
      var inDeck = deck && deck.id === t.id;
      return '<div class="ac-tcard' + (mu.open === t.id ? ' on' : '') + '" data-tape="' + esc(t.id) + '">' +
        D.cassette(t, { chip: inDeck ? 'IN DECK · CH ' + ch : '' }) +
        // Tapping the tape opens it; Play tape plays it and goes to the console (v3.13.0).
        '<div class="ac-tacts">' + (inDeck ? '<button type="button" class="ac-btn" data-mu="eject">Take tape out</button>' : '<button type="button" class="ac-btn p" data-mu="insert">▶ Play tape</button>') + '</div></div>';
    }
    function rack(list, scope, label) {
      return '<div class="ac-track">' + list.map(card).join('') +
        '<button type="button" class="ac-tnew" data-mu="new" data-scope="' + scope + '">＋ New blank tape<br><small>' + esc(label) + '</small></button></div>';
    }
    var html = '<div class="ac-tcols"><section class="ac-tleft"><h2 class="ac-h1">Tapes</h2>' +
      '<p class="ac-lede">A tape is everything one channel plays: its tracks in order, the loops under them and the effect pads. Make one for an operation and play it across its sessions; put it in the deck and the players on that channel hear it.</p>' +
      '<div class="ac-sub ac-tsub">Operation ' + opSel + (op ? '' : '') + '</div>' +
      (opId ? rack(D.forOperation(opId), 'operation', 'for ' + (op ? op.name : 'this operation')) : '<div class="ac-none">Pick the operation (above). Operations are made on the Evidence tab.</div>') +
      (cell ? '<div class="ac-sub ac-tsub">Cell <b>' + esc(cell.name || cell.cell_id) + '</b> · tapes for any operation</div>' + rack(D.forCell(cell.cell_id), 'cell', 'for Cell ' + (cell.name || '')) : '') +
      (!s ? '<div class="ac-none">Choose a session in the top bar to see its Cell\'s tapes too.</div>' : '') +
      '</section><aside class="ac-topen">' + openHtml() + '</aside></div>';
    // Keep what's being typed (the tape's name, a link) across a redraw.
    var keep = {}, focus = document.activeElement && tapesEl.contains(document.activeElement) ? document.activeElement : null;
    ['data-mu-tname', 'data-mu-lurl', 'data-mu-ltitle'].forEach(function (k) { var el = tapesEl.querySelector('[' + k + ']'); if (el) keep[k] = el.value; });
    var focusKey = focus ? ['data-mu-tname', 'data-mu-lurl', 'data-mu-ltitle'].filter(function (k) { return focus.hasAttribute(k); })[0] : '';
    tapesEl.innerHTML = html;
    Object.keys(keep).forEach(function (k) { var el = tapesEl.querySelector('[' + k + ']'); if (el) el.value = keep[k]; });
    if (focusKey) { var f = tapesEl.querySelector('[' + focusKey + ']'); if (f) f.focus(); }
  }
  function openHtml() {
    var D = T(), m = M(), t = openTape();
    if (!t) return '<div class="ac-none">Open a tape to fill it: tap a track, a loop or an effect on the shelves below.</div>';
    var rt = D.runtime(t);
    return '<div class="ac-sub" style="margin-top:0">Open tape</div>' +
      (mu.naming ? '<form class="ac-tname" data-mu-name-form><input class="vn-search" data-mu-tname value="' + esc(t.name) + '"><button class="ac-btn p">Save</button></form>'
        : '<h3 class="ac-ttitle">' + esc(t.name) + ' <button type="button" class="ac-link" data-mu="rename-tape">✎</button></h3>') +
      '<div class="ac-tcolors">' + D.COLORS.map(function (c) { return '<button type="button" class="ac-sw' + (t.color === c ? ' on' : '') + '" style="background:' + c + '" data-mu="color" data-c="' + c + '" aria-label="Colour"></button>'; }).join('') + '</div>' +
      partHd('tracks', 'Side A · tracks <b>' + esc(D.fmt(rt) || '—') + '</b> · plays through, then back to 1') +
      (t.tracks.length ? t.tracks.map(function (x, i) {
        return '<div class="ac-row" data-ti="' + i + '"><span class="ac-tn">' + (i + 1) + '</span><span class="ac-t">' + esc(x.title) + (x.kind === 'link' ? '<small>link</small>' : '') + '</span><span class="ac-dur">' + esc(D.fmt(x.dur) || '') + '</span>' +
          (i > 0 ? '<button type="button" class="ac-ic" data-mu="t-up" aria-label="Earlier">↑</button>' : '') +
          '<button type="button" class="ac-ic" data-mu="t-rm" aria-label="Take it off">✕</button></div>';
      }).join('') : '<div class="ac-none">No tracks yet — tap a spine below.</div>') +
      (mu.linking ? '<form class="ac-tlink" data-mu-link-form><input class="vn-search" type="url" placeholder="YouTube / SoundCloud / .mp3 link" data-mu-lurl required><input class="vn-search" placeholder="Title" data-mu-ltitle><button class="ac-btn p">Add</button></form>'
        : '<button type="button" class="ac-link" data-mu="link">＋ a link (YouTube, SoundCloud)</button>') +
      partHd('loops', 'Loops under it') + '<div class="ac-pads">' + (t.loops.length ? t.loops.map(function (id) {
        return '<span class="ac-padchip">≈ ' + esc(m.label('ambient', id)) + '<button type="button" data-mu="l-rm" data-id="' + esc(id) + '" aria-label="Take it off">✕</button></span>';
      }).join('') : '<span class="ac-none">None — tap a loop below.</span>') + '</div>' +
      partHd('effects', 'Effect pads') + '<div class="ac-tpads">' + t.pads.map(function (id) {
        return '<span class="ac-tpad">' + esc(m.label('stinger', id)) + '<button type="button" data-mu="p-rm" data-id="' + esc(id) + '" aria-label="Take it off">✕</button></span>';
      }).join('') + (t.pads.length ? '' : '<span class="ac-none">None — tap a cartridge below.</span>') + '</div>' +
      // Save and Save & play (2026-10-30): edits already save as they're
      // made; Save says so (and keeps a half-typed name or link), Save &
      // play also puts this version of the tape in the deck.
      '<div class="ac-acts ac-tsave"><button type="button" class="ac-btn" data-mu="save-tape">Save</button><button type="button" class="ac-btn p" data-mu="save-play">▶ Save &amp; play</button><span class="ac-sp"></span><button type="button" class="ac-link ac-del" data-mu="del-tape">Delete tape</button></div>';
  }

  // A part of the open tape with its own Add: the shelf below, showing that kind.
  // After Play tape: the control center, where the tape now plays.
  function showConsole() {
    var c = document.getElementById('ac-console');
    if (c && c.scrollIntoView) setTimeout(function () { c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 120);
  }
  // Tapping a tape opens it; where the open tape sits below the racks
  // (a phone, a narrow window), go down to it, so it's plain it opened.
  function showOpen() {
    if (!window.matchMedia('(max-width: 980px)').matches) return;
    var o = tapesEl.querySelector('.ac-topen');
    if (o && o.scrollIntoView) setTimeout(function () { o.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
  }
  function saved(msg) {
    if (window.dgAcm && document.body.classList.contains('acm')) { window.dgAcm.toast(msg); return; }
    var b = tapesEl.querySelector('[data-mu=save-tape]');
    if (b) { b.textContent = 'Saved'; setTimeout(function () { var x = tapesEl.querySelector('[data-mu=save-tape]'); if (x) x.textContent = 'Save'; }, 1600); }
  }
  // Whatever is half-typed on the open tape (its name, a link), then the
  // whole tape written once more.
  function saveOpen(t) {
    var D = T(), patch = { name: t.name, color: t.color, tracks: t.tracks.slice(), loops: t.loops.slice(), pads: t.pads.slice() };
    var ni = tapesEl.querySelector('[data-mu-tname]'), lu = tapesEl.querySelector('[data-mu-lurl]'), lt = tapesEl.querySelector('[data-mu-ltitle]');
    if (ni && ni.value.trim()) patch.name = ni.value.trim();
    if (lu && lu.value.trim()) patch.tracks.push({ kind: 'link', ref: lu.value.trim(), title: (lt && lt.value.trim()) || lu.value.trim(), dur: 0 });
    mu.naming = false; mu.linking = false;
    return D.update(t.id, patch);
  }
  function partHd(part, html) {
    return '<div class="ac-sub ac-parthd"><span>' + html + '</span><button type="button" class="ac-btn ac-add" data-mu="add-part" data-part="' + part + '">+ Add</button></div>';
  }
  function drawShelf() {
    var m = M();
    if (!m) { shelf.innerHTML = ''; return; }
    var t = openTape(), q = mu.q.toLowerCase();
    function hit(label) { return !q || String(label).toLowerCase().indexOf(q) >= 0; }
    var tracks = m.tracks().filter(function (x) { return hit(x.title || x.url); });
    tracks.forEach(function (x) { m.measure(x); });
    var loops = m.ambientList().filter(function (a) { return hit(a.label); });
    var carts = [];
    m.stingerGroups().forEach(function (g) { g.stingers.forEach(function (x) { if (hit(x.label)) carts.push(x); }); });
    function spine(kind, ref, label, foot) {
      var c = CASE[hash(ref) % CASE.length], h = kind === 'ambient' ? 120 : 132 + hash(label) % 22;
      return '<button type="button" class="ac-spn' + (onTape(t, kind, ref) ? ' used' : '') + (mu.pop === kind + ':' + ref ? ' on' : '') + '" style="--c:' + c + ';--h:' + h + 'px" data-kind="' + kind + '" data-ref="' + esc(ref) + '" title="' + esc(label) + '">' +
        '<span>' + esc(label) + '</span><em>' + esc(foot) + '</em></button>';
    }
    var html = '<section class="ac-rack"><div class="ac-rs"><span class="ac-rlabel">Library</span><input type="search" class="ac-rq" placeholder="⌕ Search…" value="' + esc(mu.q) + '">' +
      ['all', 'Tracks', 'Loops', 'Effects'].map(function (f) { var k = f.toLowerCase(); return '<button type="button" class="ac-rf' + (mu.f === k ? ' on' : '') + '" data-rf="' + k + '">' + (f === 'all' ? 'All' : f) + '</button>'; }).join('') +
      '<span class="ac-rhint">' + (t ? 'Adding to <b>' + esc(t.name) + '</b>' : 'Open a tape to add to it') + '</span></div>';
    if (mu.f === 'all' || mu.f === 'tracks') html += '<div class="ac-shelf"><div class="ac-spines">' + (tracks.length ? tracks.map(function (x) { return spine('track', x.track_id, x.title || x.url, T().fmt(x.duration) || '·:··'); }).join('') : '<span class="ac-rnone">' + (q ? 'No track matches.' : 'No tracks yet — upload one below.') + '</span>') + '</div><span class="ac-sl">Tracks</span></div>';
    if (mu.f === 'all' || mu.f === 'loops') html += '<div class="ac-shelf"><div class="ac-spines ac-loops">' + loops.map(function (a) { return spine('ambient', a.id, a.label, '∞'); }).join('') + '</div><span class="ac-sl">Ambience · loops</span></div>';
    if (mu.f === 'all' || mu.f === 'effects') html += '<div class="ac-carts">' + carts.map(function (x) {
      return '<button type="button" class="ac-cart' + (onTape(t, 'stinger', x.id) ? ' used' : '') + (mu.pop === 'stinger:' + x.id ? ' on' : '') + '" style="--c:' + CART[hash(x.id) % CART.length] + '" data-kind="stinger" data-ref="' + esc(x.id) + '">' + esc(x.label) + '</button>';
    }).join('') + '</div><div class="ac-sl2">Effects · cartridges</div>';
    html += '<div class="ac-blank"><label class="ac-bt">⇪ Upload an .mp3 to the library<input type="file" accept="audio/mpeg,.mp3" hidden data-mu-file></label></div>' +
      (mu.upload ? '<form class="ac-upf" data-mu-upf><b>' + esc(mu.upload.name) + '</b><input placeholder="Title" value="' + esc(mu.upload.name.replace(/\.mp3$/i, '')) + '" data-mu-uptitle><button type="submit" class="ac-btn p">Upload</button><button type="button" class="ac-btn" data-mu="upcancel">Cancel</button></form>' : '') +
      (m.uploadStatus() ? '<div class="ac-upst">' + esc(m.uploadStatus()) + '</div>' : '');
    html += '</section>';
    shelf.innerHTML = html;
    if (mu.pop) drawPop();
  }
  function drawPop() {
    var m = M(), t = openTape(), at = mu.pop.indexOf(':'), kind = mu.pop.slice(0, at), ref = mu.pop.slice(at + 1);
    var el = shelf.querySelector('[data-kind="' + kind + '"][data-ref="' + CSS.escape(ref) + '"]');
    if (!el) { mu.pop = null; return; }
    var tr = kind === 'track' ? A.trackById(ref) : null;
    var label = kind === 'track' ? (tr ? tr.title || tr.url : ref) : m.label(kind, ref);
    var used = onTape(t, kind, ref), url = A.soundUrl(kind, ref);
    var pop = document.createElement('div');
    pop.className = 'ac-pop';
    pop.innerHTML = '<b>' + esc(label) + '</b><small>' + (kind === 'track' ? 'track' + (tr && tr.duration ? ' · ' + T().fmt(tr.duration) : '') : kind === 'ambient' ? 'ambient loop' : 'effect') + '</small>' +
      (t ? '<button type="button" class="ac-btn' + (used ? '' : ' p') + '" data-mu="tape">' + (used ? '✓ On ' + esc(t.name) + ' — take it off' : '＋ Add to ' + esc(t.name)) + '</button>' : '<button type="button" class="ac-btn" disabled>Open a tape to add it</button>') +
      (url ? '<button type="button" class="ac-btn" data-mu="hear">' + (A.previewing() === url ? '❚❚ Stop listening' : '🎧 Listen here') + '</button>' : '') +
      '<button type="button" class="ac-btn" data-mu="table">' + (kind === 'stinger' ? '⚡ Fire on the table' : kind === 'ambient' ? '≈ Layer on the table' : '▶ Play on the table') + '</button>' +
      (kind === 'track' && tr ? (mu.renaming ? '<input class="vn-search" data-mu-name value="' + esc(tr.title || '') + '"><button type="button" class="ac-btn p" data-mu="rename-ok">Save name</button>'
          : '<button type="button" class="ac-btn" data-mu="rename">✎ Rename</button>') +
        '<button type="button" class="ac-btn ac-del" data-mu="delete">✕ Delete from the library</button>' : '');
    var box = el.getBoundingClientRect(), host = shelf.getBoundingClientRect();
    pop.style.left = Math.max(0, Math.min(box.left - host.left, host.width - 250)) + 'px';
    pop.style.top = (box.bottom - host.top + 6) + 'px';
    shelf.appendChild(pop);
  }
  function addToOpen(kind, ref) {
    var t = openTape(), m = M(), D = T();
    if (!t) return;
    if (kind === 'stinger') { D.update(t.id, { pads: onTape(t, kind, ref) ? t.pads.filter(function (x) { return x !== ref; }) : t.pads.concat([ref]) }); return; }
    if (kind === 'ambient') { D.update(t.id, { loops: onTape(t, kind, ref) ? t.loops.filter(function (x) { return x !== ref; }) : t.loops.concat([ref]) }); return; }
    if (onTape(t, kind, ref)) { D.update(t.id, { tracks: t.tracks.filter(function (x) { return !(x.kind === kind && x.ref === ref); }) }); return; }
    var tr = A.trackById(ref);
    D.update(t.id, { tracks: t.tracks.concat([{ kind: 'track', ref: ref, title: tr ? tr.title || tr.url : ref, dur: tr && tr.duration ? tr.duration : 0 }]) });
  }

  tapesEl.addEventListener('change', function (e) {
    if (e.target.hasAttribute('data-mu-op')) { mu.op = e.target.value; drawTapes(); }
  });
  tapesEl.addEventListener('submit', function (e) {
    e.preventDefault();
    var t = openTape(), D = T();
    if (!t) return;
    if (e.target.hasAttribute('data-mu-name-form')) { var nv = e.target.querySelector('[data-mu-tname]').value.trim(); mu.naming = false; if (nv) D.update(t.id, { name: nv }); else drawTapes(); return; }
    if (e.target.hasAttribute('data-mu-link-form')) {
      var u = e.target.querySelector('[data-mu-lurl]').value.trim(), ti = e.target.querySelector('[data-mu-ltitle]').value.trim();
      mu.linking = false;
      if (u) D.update(t.id, { tracks: t.tracks.concat([{ kind: 'link', ref: u, title: ti || u, dur: 0 }]) }); else drawTapes();
    }
  });
  tapesEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-mu]');
    if (!b) { var c = e.target.closest('.ac-tcard .cas'); if (c) { mu.open = c.closest('[data-tape]').getAttribute('data-tape'); drawTapes(); drawShelf(); showOpen(); } return; }
    var D = T(), m = M(), a = b.getAttribute('data-mu'), card = b.closest('[data-tape]'), id = card ? card.getAttribute('data-tape') : mu.open, t = D.get(id);
    switch (a) {
      case 'open': mu.open = mu.open === id ? '' : id; mu.naming = false; mu.linking = false; drawTapes(); drawShelf(); return;
      case 'insert': case 'insert-open': D.insert(id).then(showConsole, function (err) { A.ask((err && err.message) || String(err), 'OK', 'Close'); }); return;
      case 'save-tape': if (t) saveOpen(t).then(function () { drawTapes(); saved('Tape saved.'); }); return;
      case 'save-play': if (t) saveOpen(t).then(function () { drawTapes(); return D.insert(t.id); }).then(function () { saved('Saved. Playing on CH ' + m.channel() + '.'); showConsole(); }, function (err) { A.ask((err && err.message) || String(err), 'OK', 'Close'); }); return;
      case 'add-part': {
        mu.f = b.getAttribute('data-part'); mu.pop = null; drawShelf();
        if (shelf.scrollIntoView) shelf.scrollIntoView({ behavior: 'smooth', block: 'start' });
        var q = shelf.querySelector('.ac-rq'); if (q && window.matchMedia('(min-width: 761px)').matches) q.focus();
        return;
      }
      case 'eject': D.eject(); return;
      case 'new': {
        var scope = b.getAttribute('data-scope'), op = D.operation(curOp()), cell = A.cell(curCell());
        var name = scope === 'cell' ? (cell ? (cell.name || 'Cell') + ' · tape' : 'New tape') : (op ? op.name + ' · tape ' + (D.forOperation(op.operation_id).length + 1) : 'New tape');
        D.create({ name: name, scope: scope, operation_id: scope === 'operation' ? curOp() : '', cell_id: scope === 'cell' ? curCell() : (op ? op.cell_id : curCell()) })
          .then(function (nt) { mu.open = nt.id; mu.naming = true; drawTapes(); drawShelf(); var inp = tapesEl.querySelector('[data-mu-tname]'); if (inp) { inp.focus(); inp.select(); } });
        return;
      }
      case 'rename-tape': mu.naming = true; drawTapes(); var ni = tapesEl.querySelector('[data-mu-tname]'); if (ni) { ni.focus(); ni.select(); } return;
      case 'color': D.update(t.id, { color: b.getAttribute('data-c') }); return;
      case 'link': mu.linking = true; drawTapes(); var li = tapesEl.querySelector('[data-mu-lurl]'); if (li) li.focus(); return;
      case 't-up': { var i = +b.closest('[data-ti]').getAttribute('data-ti'), tr = t.tracks.slice(); tr.splice(i - 1, 0, tr.splice(i, 1)[0]); D.update(t.id, { tracks: tr }); return; }
      case 't-rm': { var k = +b.closest('[data-ti]').getAttribute('data-ti'); D.update(t.id, { tracks: t.tracks.filter(function (x, n) { return n !== k; }) }); return; }
      case 'l-rm': D.update(t.id, { loops: t.loops.filter(function (x) { return x !== b.getAttribute('data-id'); }) }); return;
      case 'p-rm': D.update(t.id, { pads: t.pads.filter(function (x) { return x !== b.getAttribute('data-id'); }) }); return;
      case 'del-tape': A.ask('Delete the tape “' + t.name + '”? The tracks stay in the library.', 'Delete', 'Keep it').then(function (yes) { if (yes) { if ((m.state().tape || {}).id === t.id) D.eject(); D.remove(t.id); mu.open = ''; drawTapes(); drawShelf(); } }); return;
    }
  });

  shelf.addEventListener('change', function (e) {
    if (!e.target.hasAttribute('data-mu-file')) return;
    mu.upload = e.target.files[0] || null;
    drawShelf();
  });
  shelf.addEventListener('submit', function (e) {
    if (!e.target.hasAttribute('data-mu-upf')) return;
    e.preventDefault();
    var f = mu.upload;
    if (!f) return;
    M().upload(f, e.target.querySelector('[data-mu-uptitle]').value.trim());
    mu.upload = null;
    drawShelf();
    var poll = setInterval(function () { drawShelf(); if (!/upload|sav/i.test(M().uploadStatus() || '') || /done|added|uploaded\.|fail|could/i.test(M().uploadStatus())) clearInterval(poll); }, 1500);
    setTimeout(function () { clearInterval(poll); }, 120000);
  });
  shelf.addEventListener('input', function (e) {
    if (!e.target.classList.contains('ac-rq')) return;
    mu.q = e.target.value; mu.pop = null;
    var pos = e.target.selectionStart;
    drawShelf();
    var q = shelf.querySelector('.ac-rq'); q.focus(); try { q.setSelectionRange(pos, pos); } catch (err) { /* search inputs */ }
  });
  shelf.addEventListener('click', function (e) {
    var m = M();
    var rf = e.target.closest('[data-rf]');
    if (rf) { mu.f = rf.getAttribute('data-rf'); mu.pop = null; drawShelf(); return; }
    var item = e.target.closest('[data-kind]');
    if (item) { var k = item.getAttribute('data-kind') + ':' + item.getAttribute('data-ref'); mu.pop = mu.pop === k ? null : k; mu.renaming = false; drawShelf(); return; }
    var b = e.target.closest('[data-mu]');
    if (!b) { if (mu.pop && !e.target.closest('.ac-pop')) { mu.pop = null; drawShelf(); } return; }
    var a = b.getAttribute('data-mu');
    if (a === 'upcancel') { mu.upload = null; drawShelf(); return; }
    if (!mu.pop) return;
    var at = mu.pop.indexOf(':'), kind = mu.pop.slice(0, at), ref = mu.pop.slice(at + 1);
    if (a === 'hear') { A.preview(A.soundUrl(kind, ref)); return; }
    if (a === 'rename') { mu.renaming = true; drawShelf(); var ni = shelf.querySelector('[data-mu-name]'); if (ni) ni.focus(); return; }
    if (a === 'rename-ok') { var nv = shelf.querySelector('[data-mu-name]').value.trim(); if (nv) m.rename(ref, nv); mu.renaming = false; mu.pop = null; drawShelf(); return; }
    if (a === 'delete') { A.ask('Delete this track from the library? This cannot be undone.', 'Delete', 'Keep it').then(function (yes) { if (yes) { window.__acNoConfirm = true; m.remove(ref); window.__acNoConfirm = false; } }); mu.pop = null; drawShelf(); return; }
    if (a === 'tape') { addToOpen(kind, ref); mu.pop = null; return; }
    if (a === 'table') {
      if (kind === 'stinger') m.fire(ref);
      else if (kind === 'ambient') m.setAmbient(ref, !(m.state().ambient || []).some(function (x) { return (x.id || x) === ref; }));
      else { var tk = A.trackById(ref); if (tk) m.play({ url: tk.url, title: tk.title, kind: 'audio' }); }
      mu.pop = null; drawShelf();
    }
  });
  var muOpen = false, muT = null;
  function muDraw() { drawTapes(); drawShelf(); }
  function muSoon() { if (!muOpen) return; clearTimeout(muT); muT = setTimeout(muDraw, 30); }
  document.addEventListener('dg-acell-tab', function (e) {
    muOpen = e.detail.tab === 'music';
    if (!muOpen) { mu.pop = null; return; }
    T().load().then(function () {
      if (!mu.open) { var first = T().forOperation(curOp())[0] || T().forCell(curCell())[0]; if (first) mu.open = first.id; }
      muDraw();
    }, function (err) { tapesEl.innerHTML = '<div class="ac-none">Could not load the tapes: ' + esc((err && err.message) || err) + '</div>'; });
    muDraw();
  });
  ['dg-sessions', 'dg-acell-music', 'dg-acell-preview', 'dg-tapes'].forEach(function (ev) { document.addEventListener(ev, muSoon); });

  /* ════════ Notes: the vault ════════ */
  var noPanel = document.getElementById('panel-notes');
  var vault = document.createElement('div');
  vault.className = 'ac-vault';
  vault.id = 'ac-vault';
  noPanel.insertBefore(vault, noPanel.firstChild);
  var htmlHd = document.createElement('div');
  htmlHd.className = 'ac-sub ac-deskhd';
  htmlHd.textContent = 'HTML pages (uploaded)';
  noPanel.insertBefore(htmlHd, vault.nextSibling);
  var vs = { q: '', path: '', ed: null, loaded: false, err: '', open: {}, back: [], fwd: [] };
  function drawVault() {
    var V = window.dgVault;
    if (!V) return;
    var q = vs.q.toLowerCase();
    var ns = V.notes().filter(function (n) { return !q || n.path.toLowerCase().indexOf(q) >= 0 || (q.length > 2 && String(n.content || '').toLowerCase().indexOf(q) >= 0); });
    // Folders fold: open when searching, or the one holding the open note,
    // or the ones the Handler opened.
    var groups = {};
    ns.forEach(function (n) { var d = V.folderLabel(V.dirOf(n.path)); (groups[d] = groups[d] || []).push(n); });
    var s = A.session(), curDir = vs.path ? V.folderLabel(V.dirOf(vs.path)) : '';
    function item(n) {
      return '<button type="button" class="vn-pi' + (n.path === vs.path ? ' on' : '') + '" data-vp="' + esc(n.path) + '" title="' + esc(n.path) + '">' + esc(V.title(n.path)) +
        (s && s.note_path === n.path ? '<small class="ac-pi-sub">notes for ' + esc(s.name) + '</small>' : '') + '</button>';
    }
    function sorted(list) { return list.slice().sort(function (a, b) { return V.byName(V.title(a.path), V.title(b.path)); }); }
    var list = vs.err ? '<div class="ac-none">Could not load the vault: ' + esc(vs.err) + '</div>' : !vs.loaded ? '<div class="ac-none">Loading the vault…</div>' :
      !V.notes().length ? '<div class="ac-none">No notes yet. Set up the iCloud sync (⚙ Vault sync), import .md files, or make a new note.</div>' :
      Object.keys(groups).sort(V.byName).map(function (d) {
        if (!d) return sorted(groups[d]).map(item).join('');
        var open = !!q || d === curDir || !!vs.open[d];
        return '<div class="ac-vdir' + (open ? ' open' : '') + '"><button type="button" class="ac-vdh" data-vdir="' + esc(d) + '"><i>' + (open ? '▾' : '▸') + '</i>' + esc(d) + '<small>' + groups[d].length + '</small></button>' +
          (open ? '<div class="ac-vdb">' + sorted(groups[d]).map(item).join('') + '</div>' : '') + '</div>';
      }).join('') || '<div class="ac-none">Nothing matches.</div>';
    var listEl = vault.querySelector('.ac-vlist');
    if (!listEl) {
      vault.innerHTML = '<div class="ac-vbar"><input type="search" class="ac-vq" placeholder="⌕ Search the vault…"><button type="button" class="ac-btn" data-vv="new">+ New note</button><button type="button" class="ac-btn" data-vv="sync">⚙ Vault sync</button></div>' +
        '<div class="ac-vcols"><div class="ac-vlist"></div><div class="ac-vnote"></div></div>';
      listEl = vault.querySelector('.ac-vlist');
    }
    listEl.innerHTML = list;
    var noteEl = vault.querySelector('.ac-vnote');
    if (!vs.path) {
      if (vs.ed) { vs.ed.destroy(); vs.ed = null; }
      noteEl.innerHTML = '<div class="ac-none">Pick a note on the left.</div>';
    } else if (!vs.ed || vs.ed.path() !== vs.path) {
      if (vs.ed) vs.ed.destroy();
      noteEl.innerHTML = '<div class="ac-vacts"></div><div class="ac-ved"></div>';
      vs.ed = V.editor(noteEl.querySelector('.ac-ved'), vs.path, { onLink: function (p) { openNote(p); } });
    }
    var acts = noteEl.querySelector('.ac-vacts');
    // Back / Forward through the notes opened here (2026-10-30), then
    // whether this note is one the session keeps for Play.
    var inS = s && S().notesOf(s).some(function (n) { return n.kind === 'vault' && n.path === vs.path; });
    if (acts) acts.innerHTML = '<span class="ac-vnav"><button type="button" class="ac-btn" data-vv="back"' + (vs.back.length ? ' title="' + esc(V.title(vs.back[vs.back.length - 1])) + '"' : ' disabled') + '>&larr; Back</button>' +
      '<button type="button" class="ac-btn" data-vv="fwd"' + (vs.fwd.length ? ' title="' + esc(V.title(vs.fwd[vs.fwd.length - 1])) + '"' : ' disabled') + '>Forward &rarr;</button></span>' +
      (s ? (inS ? '<span class="ac-chips-note">One of the notes for <b>' + esc(s.name) + '</b></span>'
        : '<button type="button" class="ac-link" data-vv="use">Add to the notes for ' + esc(s.name) + '</button>') : '');
  }
  function openNote(path, how) {
    if (path && vs.path && path !== vs.path && how !== 'nav') { vs.back.push(vs.path); if (vs.back.length > 50) vs.back.shift(); vs.fwd = []; }
    vs.path = path; drawVault();
  }
  vault.addEventListener('input', function (e) {
    if (!e.target.classList.contains('ac-vq')) return;
    vs.q = e.target.value; drawVault();
  });
  vault.addEventListener('click', function (e) {
    var V = window.dgVault;
    var p = e.target.closest('[data-vp]');
    if (p) { openNote(p.getAttribute('data-vp')); return; }
    var dh = e.target.closest('[data-vdir]');
    if (dh) {
      var d = dh.getAttribute('data-vdir'), V2 = window.dgVault;
      var shown = !!vs.q || d === (vs.path ? V2.folderLabel(V2.dirOf(vs.path)) : '') || !!vs.open[d];
      vs.open[d] = !shown;
      drawVault();
      return;
    }
    var b = e.target.closest('[data-vv]');
    if (!b) return;
    var a = b.getAttribute('data-vv'), s = A.session();
    if (a === 'sync') V.settings();
    else if (a === 'new') V.picker({ title: 'New note', newPath: vs.path && vs.path.indexOf('/') > 0 ? vs.path.slice(0, vs.path.lastIndexOf('/') + 1) : '', onPick: openNote });
    else if (a === 'use' && s) S().addNote(s.id, { kind: 'vault', path: vs.path }).then(drawVault);
    else if (a === 'back' && vs.back.length) { vs.fwd.push(vs.path); openNote(vs.back.pop(), 'nav'); }
    else if (a === 'fwd' && vs.fwd.length) { vs.back.push(vs.path); openNote(vs.fwd.pop(), 'nav'); }
  });
  document.addEventListener('dg-acell-open-note', function (e) { openNote(e.detail.path); });
  var noOpen = false;
  document.addEventListener('dg-acell-tab', function (e) {
    noOpen = e.detail.tab === 'notes';
    if (!noOpen) return;
    if (!vs.path) { var s = A.session(); if (s && s.note_path) vs.path = s.note_path; }
    drawVault();
    window.dgVault.load().then(function () { vs.loaded = true; vs.err = ''; drawVault(); }, function (err) { vs.err = (err && err.message) || String(err); drawVault(); });
  });
  document.addEventListener('dg-vault', function () { if (noOpen) { vs.loaded = true; drawVault(); } });
  document.addEventListener('dg-sessions', function () { if (noOpen) drawVault(); });

  window.dgAcLibrary = { drawShelf: drawShelf, drawTapes: drawTapes, openTape: function (id) { mu.open = id; muDraw(); showOpen(); }, drawChips: drawChips, openNote: openNote };
})();
