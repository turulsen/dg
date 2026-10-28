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

  /* ════════ Music: the tape shelf ════════ */
  var muPanel = document.getElementById('panel-music');
  var shelf = document.createElement('div');
  shelf.className = 'ac-music';
  shelf.id = 'ac-shelf';
  // Under the control center (assets/acell-console.js), over the classic desk.
  var consoleEl = document.getElementById('ac-console');
  muPanel.insertBefore(shelf, consoleEl ? consoleEl.nextSibling : muPanel.firstChild);
  var mu = { q: '', f: 'all', pop: null };
  var TINTS = ['#d9ccaa', '#c9d6c0', '#e2c6b8', '#d6d0e6', '#e8dca8', '#c6d8e2', '#e6c8c8', '#cfd9c0', '#e2d6c0', '#c8c0d8'];
  var CART = ['#7a2a22', '#4a3a6a', '#2a4a6a', '#4a4a4a', '#6a5a2a', '#3a5a3a', '#6a3a5a', '#5a2a2a'];
  function hash(s) { var h = 0; s = String(s); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function tapeKey(t) { return t.kind + ':' + t.ref; }
  function onTape(s, kind, ref) { return !!s && (kind === 'stinger' ? s.pads.indexOf(ref) >= 0 : s.tracks.some(function (t) { return t.kind === kind && t.ref === ref; })); }
  function drawShelf() {
    var m = M();
    if (!m) { shelf.innerHTML = ''; return; }
    var s = A.session(), q = mu.q.toLowerCase();
    function hit(label) { return !q || String(label).toLowerCase().indexOf(q) >= 0; }
    var tape = s ? (s.tracks.length || s.pads.length ? s.tracks.map(function (t, i) {
      var url = A.soundUrl(t.kind, t.ref);
      return '<div class="ac-row" data-i="' + i + '"><span class="ac-ic ac-glyph">' + (t.kind === 'ambient' ? '≈' : '♪') + '</span><span class="ac-t">' + esc(t.title) + '<small>' + (t.kind === 'ambient' ? 'ambient loop' : 'track') + '</small></span>' +
        (i > 0 ? '<button type="button" class="ac-ic" data-mu="up" title="Earlier on the tape" aria-label="Earlier">↑</button>' : '') +
        (url ? '<button type="button" class="ac-ic" data-mu="hear-tape" title="Listen here" aria-label="Listen here">' + (A.previewing() === url ? '❚❚' : '🎧') + '</button>' : '') +
        '<button type="button" class="ac-ic" data-mu="rm" title="Take it off" aria-label="Take it off">✕</button></div>';
    }).join('') + (s.pads.length ? '<div class="ac-sub">Effect pads · on the desk</div>' + s.pads.map(function (id, i) {
      return '<div class="ac-row" data-pad="' + esc(id) + '"><span class="ac-ic ac-glyph">' + (i + 1) + '</span><span class="ac-t">' + esc(m.label('stinger', id)) + '</span><button type="button" class="ac-ic" data-mu="rm-pad" title="Take it off" aria-label="Take it off">✕</button></div>';
    }).join('') : '') : '<div class="ac-none">Nothing on the tape yet. Tap a tape or a cartridge on the shelf.</div>')
      : '<div class="ac-none">Choose a session (top bar) to put music on its tape. The shelf still plays on the table.</div>';
    var tracks = m.tracks().filter(function (t) { return hit(t.title || t.url); });
    var loops = m.ambientList().filter(function (a) { return hit(a.label); });
    var carts = [];
    m.stingerGroups().forEach(function (g) { g.stingers.forEach(function (x) { if (hit(x.label)) carts.push(x); }); });
    function spine(kind, ref, label, small, i) {
      var tint = TINTS[hash(ref) % TINTS.length], h = kind === 'ambient' ? 112 : 118 + hash(label) % 28;
      return '<button type="button" class="ac-spn' + (onTape(s, kind, ref) ? ' used' : '') + (mu.pop === kind + ':' + ref ? ' on' : '') + '" style="--c:' + tint + ';--h:' + h + 'px" data-kind="' + kind + '" data-ref="' + esc(ref) + '" title="' + esc(label) + '">' +
        '<span>' + esc(label) + '</span><small>' + esc(small) + '</small></button>';
    }
    var html = '<div class="ac-mucols"><section class="ac-pn"><div class="ac-ph"><span class="ac-pt">' + (s ? esc(s.name) + ' · tape' : 'Session tape') + '</span></div><div class="ac-pb">' + tape + '</div></section>' +
      '<section class="ac-rack"><div class="ac-rs"><input type="search" class="ac-rq" placeholder="⌕ Search tapes…" value="' + esc(mu.q) + '">' +
      ['all', 'Tracks', 'Loops', 'Effects'].map(function (f) { var k = f.toLowerCase(); return '<button type="button" class="ac-rf' + (mu.f === k ? ' on' : '') + '" data-rf="' + k + '">' + (f === 'all' ? 'All' : f) + '</button>'; }).join('') + '</div>';
    if (mu.f === 'all' || mu.f === 'tracks') html += '<div class="ac-shelf"><div class="ac-spines">' + (tracks.length ? tracks.map(function (t) { return spine('track', t.track_id, t.title || t.url, 'track'); }).join('') : '<span class="ac-rnone">' + (q ? 'No track matches.' : 'No tracks yet — upload one in the broadcast desk below.') + '</span>') + '</div><span class="ac-sl">Tracks · uploaded</span></div>';
    if (mu.f === 'all' || mu.f === 'loops') html += '<div class="ac-shelf"><div class="ac-spines ac-loops">' + loops.map(function (a) { return spine('ambient', a.id, a.label, 'loop'); }).join('') + '</div><span class="ac-sl">Ambience · loops</span></div>';
    if (mu.f === 'all' || mu.f === 'effects') html += '<div class="ac-carts">' + carts.map(function (x) {
      return '<button type="button" class="ac-cart' + (onTape(s, 'stinger', x.id) ? ' used' : '') + (mu.pop === 'stinger:' + x.id ? ' on' : '') + '" style="--c:' + CART[hash(x.id) % CART.length] + '" data-kind="stinger" data-ref="' + esc(x.id) + '">' + esc(x.label) + '</button>';
    }).join('') + '</div><div class="ac-sl2">Effects · cartridges</div>';
    html += '<div class="ac-blank"><label class="ac-bt">⇪ Upload an .mp3<input type="file" accept="audio/mpeg,.mp3" hidden data-mu-file></label>' +
      '<button type="button" class="ac-bt" data-mu="link">＋ Blank tape: a YouTube / SoundCloud link</button></div>' +
      (mu.upload ? '<form class="ac-upf" data-mu-upf><b>' + esc(mu.upload.name) + '</b><input placeholder="Title" value="' + esc(mu.upload.name.replace(/\.mp3$/i, '')) + '" data-mu-uptitle><button type="submit" class="ac-btn p">Upload</button><button type="button" class="ac-btn" data-mu="upcancel">Cancel</button></form>' : '') +
      (M().uploadStatus() ? '<div class="ac-upst">' + esc(M().uploadStatus()) + '</div>' : '');
    html += '</section></div>';
    shelf.innerHTML = html;
    if (mu.pop) drawPop();
  }
  function drawPop() {
    var m = M(), s = A.session(), at = mu.pop.indexOf(':'), kind = mu.pop.slice(0, at), ref = mu.pop.slice(at + 1);
    var el = shelf.querySelector('[data-kind="' + kind + '"][data-ref="' + CSS.escape(ref) + '"]');
    if (!el) { mu.pop = null; return; }
    var t = kind === 'track' ? A.trackById(ref) : null;
    var label = kind === 'track' ? (t ? t.title || t.url : ref) : m.label(kind, ref);
    var used = onTape(s, kind, ref), url = A.soundUrl(kind, ref);
    var pop = document.createElement('div');
    pop.className = 'ac-pop';
    pop.innerHTML = '<b>' + esc(label) + '</b><small>' + (kind === 'track' ? 'uploaded track' : kind === 'ambient' ? 'ambient loop' : 'effect') + '</small>' +
      (s ? '<button type="button" class="ac-btn' + (used ? '' : ' p') + '" data-mu="tape">' + (used ? '✓ On the tape — take it off' : '＋ Add to ' + esc(s.name)) + '</button>' : '<button type="button" class="ac-btn" disabled>Choose a session to add it</button>') +
      (url ? '<button type="button" class="ac-btn" data-mu="hear">' + (A.previewing() === url ? '❚❚ Stop listening' : '🎧 Listen here') + '</button>' : '') +
      '<button type="button" class="ac-btn" data-mu="table">' + (kind === 'stinger' ? '⚡ Fire on the table' : kind === 'ambient' ? '≈ Layer on the table' : '▶ Play on the table') + '</button>' +
      (kind === 'track' && t ? '<button type="button" class="ac-btn" data-mu="queue">+ Cue list</button>' +
        (mu.renaming ? '<input class="vn-search" data-mu-name value="' + esc(t.title || '') + '"><button type="button" class="ac-btn p" data-mu="rename-ok">Save name</button>'
          : '<button type="button" class="ac-btn" data-mu="rename">✎ Rename</button>') +
        '<button type="button" class="ac-btn ac-del" data-mu="delete">✕ Delete</button>' : '');
    var box = el.getBoundingClientRect(), host = shelf.getBoundingClientRect();
    pop.style.left = Math.max(0, Math.min(box.left - host.left, host.width - 250)) + 'px';
    pop.style.top = (box.bottom - host.top + 6) + 'px';
    shelf.appendChild(pop);
  }
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
    var m = M(), s = A.session();
    var rf = e.target.closest('[data-rf]');
    if (rf) { mu.f = rf.getAttribute('data-rf'); mu.pop = null; drawShelf(); return; }
    var item = e.target.closest('[data-kind]');
    if (item) { var k = item.getAttribute('data-kind') + ':' + item.getAttribute('data-ref'); mu.pop = mu.pop === k ? null : k; mu.renaming = false; drawShelf(); return; }
    var b = e.target.closest('[data-mu]');
    if (!b) { if (mu.pop && !e.target.closest('.ac-pop')) { mu.pop = null; drawShelf(); } return; }
    var a = b.getAttribute('data-mu'), row = b.closest('[data-i]');
    if (a === 'rm' && s) { S().update(s.id, { tracks: s.tracks.filter(function (x, i) { return i !== +row.getAttribute('data-i'); }) }); return; }
    if (a === 'up' && s) { var i = +row.getAttribute('data-i'), tr = s.tracks.slice(); tr.splice(i - 1, 0, tr.splice(i, 1)[0]); S().update(s.id, { tracks: tr }); return; }
    if (a === 'rm-pad' && s) { S().toggleIn(s.id, 'pads', b.closest('[data-pad]').getAttribute('data-pad')); return; }
    if (a === 'hear-tape' && s) { var tt = s.tracks[+row.getAttribute('data-i')]; A.preview(A.soundUrl(tt.kind, tt.ref)); return; }
    if (a === 'link') { var u = document.querySelector('#ac-console [data-cc="url"]'); if (u) { u.scrollIntoView({ block: 'center' }); u.focus(); } return; }
    if (a === 'upcancel') { mu.upload = null; drawShelf(); return; }
    if (!mu.pop) return;
    var at = mu.pop.indexOf(':'), kind = mu.pop.slice(0, at), ref = mu.pop.slice(at + 1);
    if (a === 'hear') { A.preview(A.soundUrl(kind, ref)); return; }
    if (a === 'queue') { var qt = A.trackById(ref); if (qt) m.cue({ url: qt.url, title: qt.title, kind: 'audio' }); mu.pop = null; drawShelf(); return; }
    if (a === 'rename') { mu.renaming = true; drawShelf(); var ni = shelf.querySelector('[data-mu-name]'); if (ni) ni.focus(); return; }
    if (a === 'rename-ok') { var nv = shelf.querySelector('[data-mu-name]').value.trim(); if (nv) m.rename(ref, nv); mu.renaming = false; mu.pop = null; drawShelf(); return; }
    if (a === 'delete') { A.ask('Delete this track from the library? This cannot be undone.', 'Delete', 'Keep it').then(function (yes) { if (yes) { window.__acNoConfirm = true; m.remove(ref); window.__acNoConfirm = false; } }); mu.pop = null; drawShelf(); return; }
    if (a === 'tape' && s) {
      if (kind === 'stinger') S().toggleIn(s.id, 'pads', ref);
      else {
        var t = kind === 'track' ? A.trackById(ref) : null;
        var entry = { kind: kind, ref: ref, title: kind === 'track' ? (t ? t.title || t.url : ref) : m.label('ambient', ref) };
        S().toggleIn(s.id, 'tracks', entry, function (x, y) { return x.kind === y.kind && x.ref === y.ref; });
      }
      mu.pop = null;
      return;
    }
    if (a === 'table') {
      if (kind === 'stinger') m.fire(ref);
      else if (kind === 'ambient') m.setAmbient(ref, !(m.state().ambient || []).some(function (x) { return (x.id || x) === ref; }));
      else { var tk = A.trackById(ref); if (tk) m.play({ url: tk.url, title: tk.title, kind: 'audio' }); }
      mu.pop = null; drawShelf();
    }
  });
  var muOpen = false, muT = null;
  function muSoon() { if (!muOpen) return; clearTimeout(muT); muT = setTimeout(drawShelf, 30); }
  document.addEventListener('dg-acell-tab', function (e) { muOpen = e.detail.tab === 'music'; if (muOpen) drawShelf(); else mu.pop = null; });
  ['dg-sessions', 'dg-acell-music', 'dg-acell-preview'].forEach(function (ev) { document.addEventListener(ev, muSoon); });

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
  var vs = { q: '', path: '', ed: null, loaded: false, err: '', open: {} };
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
    if (acts) acts.innerHTML = s ? (s.note_path === vs.path ? '<span class="ac-chips-note">These are the notes for <b>' + esc(s.name) + '</b></span>'
      : '<button type="button" class="ac-link" data-vv="use">Use as the notes for ' + esc(s.name) + '</button>') : '';
  }
  function openNote(path) { vs.path = path; drawVault(); }
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
    else if (a === 'use' && s) S().update(s.id, { note_path: vs.path, html_note: null });
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

  window.dgAcLibrary = { drawShelf: drawShelf, drawChips: drawChips, openNote: openNote };
})();
