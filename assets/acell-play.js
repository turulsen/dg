/* A-Cell's Play desk (v3.12.0): the session in the top bar, laid out on a
   desk for the table.

   The objects: the Agents' dossiers (vitals, warnings, quick notes on a
   sticky), initiative cards (the Cell by DEX and the session's NPCs),
   the notebook (the session's notes on one wide page, a tab per ##
   scene -- or the uploaded HTML page, docked), the quick-notes pad, the
   tape deck (the session's tape and the broadcast's transport), the
   effect pads, the evidence box (release with a tap) and the Dice Roller
   -- the real panel, open, moved onto the desk.

   ✥ Arrange: the desk is a 12-column grid. Drag an object by its title
   bar to move it (or tap the bar, then a spot), drag its corner to size
   it -- each object has a smallest size, and anything it lands on moves
   down. ✕ puts it away in the drawer (and back from there).

   Entering Play the first time for a session notes the Agents' vitals
   (session.start) so Debrief can say what the night cost them. */
(function () {
  'use strict';
  var A = window.dgAc;
  if (!A || window.dgAcPlay) return;
  var esc = A.esc;
  var panel = document.getElementById('panel-desk');
  var tools = document.getElementById('ac-tools');
  function S() { return window.dgSessions; }
  function M() { return window.dgAcellMusic; }
  function V() { return window.dgVault; }

  var OBJ = {
    dossiers: 'Dossiers', initiative: 'Initiative', dice: 'Dice Roller', notebook: 'Notebook',
    deck: 'Tape deck', pad: 'Quick notes', evidence: 'Evidence box', pads: 'Effect pads'
  };
  // A 12-column grid of 58px rows: each object { x, y, w, h } in cells.
  // Kept on this device (dg_acell_desk_v3); objects put away sit in `away`.
  var KEY3 = 'dg_acell_desk_v3', COLS = 12, ROW = 58, GAP = 12;
  var MIN = { dossiers: [2, 3], initiative: [2, 2], dice: [2, 4], notebook: [3, 4], deck: [2, 2], pad: [2, 2], evidence: [2, 2], pads: [2, 2] };
  var DEFAULT = { items: {
    deck: { x: 0, y: 0, w: 3, h: 3 }, pads: { x: 3, y: 0, w: 2, h: 3 }, initiative: { x: 5, y: 0, w: 4, h: 3 }, pad: { x: 9, y: 0, w: 3, h: 4 },
    dossiers: { x: 0, y: 3, w: 3, h: 8 }, notebook: { x: 3, y: 3, w: 6, h: 12 }, evidence: { x: 9, y: 4, w: 3, h: 4 }, dice: { x: 0, y: 11, w: 3, h: 6 }
  }, away: [] };
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  var L = (function () {
    var l = A.store(KEY3, null);
    if (!l || !l.items) return clone(DEFAULT);
    l.away = (l.away || []).filter(function (id) { return OBJ[id]; });
    Object.keys(OBJ).forEach(function (id) { if (!l.items[id] && l.away.indexOf(id) < 0) l.items[id] = clone(DEFAULT.items[id]); });
    Object.keys(l.items).forEach(function (id) { if (!OBJ[id] || l.away.indexOf(id) >= 0) delete l.items[id]; else fit(l.items[id], id); });
    return l;
  })();
  function fit(r, id) {
    var mn = MIN[id] || [2, 2];
    r.w = Math.max(mn[0], Math.min(COLS, Math.round(r.w) || mn[0]));
    r.h = Math.max(mn[1], Math.min(30, Math.round(r.h) || mn[1]));
    r.x = Math.max(0, Math.min(COLS - r.w, Math.round(r.x) || 0));
    r.y = Math.max(0, Math.round(r.y) || 0);
    return r;
  }
  function overlap(a, b) { return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; }
  // The object just moved or sized keeps its place; whatever it now covers
  // moves down until it's clear.
  function settle(fixedId) {
    var ids = Object.keys(L.items).filter(function (k) { return k !== fixedId; }).sort(function (a, b) { return L.items[a].y - L.items[b].y || L.items[a].x - L.items[b].x; });
    var placed = fixedId ? [L.items[fixedId]] : [];
    ids.forEach(function (k) {
      var r = L.items[k];
      while (placed.some(function (p) { return overlap(p, r); })) r.y += 1;
      placed.push(r);
    });
  }
  function save() { A.keep(KEY3, L); }

  var st = { open: false, arrange: false, built: '', ed: null, edFor: '', scene: null, edit: false, turn: 0, htmlFor: '', jot: '', pick: '' };

  /* ── Building the desk ── */
  function place(id) { var r = L.items[id]; return 'grid-column:' + (r.x + 1) + ' / span ' + r.w + ';grid-row:' + (r.y + 1) + ' / span ' + r.h; }
  function build() {
    var s = A.session();
    var key = (s ? s.id : '') + '|' + JSON.stringify(L) + '|' + st.arrange;
    if (st.built === key) return;
    releaseDice();
    if (st.ed) { st.ed.destroy(); st.ed = null; st.edFor = ''; }
    st.htmlFor = '';
    st.built = key;
    if (!s) {
      panel.innerHTML = '<div class="pd-desk pd-nosess"><div class="pd-card"><b>Which session?</b><p>The desk lays out a session: its Cell, notes, evidence and music.</p>' +
        (S().list().length ? S().list().slice(0, 8).map(function (x) { return '<button type="button" class="ac-btn" data-pd="pick" data-id="' + esc(x.id) + '">' + esc(x.name) + '</button>'; }).join('') : '') +
        '<button type="button" class="ac-btn p" data-pd="new">+ New session</button></div></div>';
      return;
    }
    var ids = Object.keys(L.items).sort(function (a, b) { return L.items[a].y - L.items[b].y || L.items[a].x - L.items[b].x; });
    panel.innerHTML = '<div class="pd-desk' + (st.arrange ? ' pd-arranging' : '') + '">' +
      (st.arrange ? drawerHtml() : '') +
      '<div class="pd-grid" style="--pd-row:' + ROW + 'px;--pd-gap:' + GAP + 'px">' + ids.map(function (id) {
        return '<section class="pd-o pd-' + id + '" data-o="' + id + '" style="' + place(id) + '">' +
          (st.arrange ? '<div class="pd-oh"><span class="pd-grip" aria-hidden="true">⋮⋮</span>' + esc(OBJ[id]) + '<button type="button" class="pd-x" data-pd="away" aria-label="Put it away">✕</button></div>' : '') +
          '<div class="pd-ob" data-ob="' + id + '"></div>' +
          (st.arrange ? '<span class="pd-rz" data-rz="' + id + '" title="Drag to size it" aria-label="Size"></span>' : '') + '</section>';
      }).join('') + (st.arrange ? '<div class="pd-ghost" hidden></div>' : '') + '</div></div>';
    markPick();
    drawAll();
  }
  function drawerHtml() {
    return '<div class="pd-drawer"><span class="pd-dl">✥ Drag a title bar anywhere on the grid · ◢ drag the yellow corner to size it · or tap a bar, then tap where it goes</span><span class="pd-dl pd-pickt"></span>' +
      (L.away.length ? '<span class="pd-dl">Put away:</span>' + L.away.map(function (id) { return '<button type="button" class="pd-back" data-pd="back" data-id="' + id + '">+ ' + esc(OBJ[id]) + '</button>'; }).join('') : '') +
      '<button type="button" class="pd-back" data-pd="reset">Reset layout</button></div>';
  }
  function ob(id) { return panel.querySelector('[data-ob="' + id + '"]'); }
  function drawAll() {
    var s = A.session();
    if (!s || !panel.querySelector('.pd-grid')) return;
    drawDossiers(s); drawInitiative(s); drawNotebook(s); drawPad(s); drawDeck(s); drawEvidence(s); drawPads(s); placeDice();
  }

  /* ── Dossiers ── */
  function present(s) { return A.members(s.cell_id).filter(function (a) { return s.away.indexOf(a.code) < 0; }); }
  function drawDossiers(s) {
    var el = ob('dossiers');
    if (!el) return;
    var ms = A.members(s.cell_id);
    if (!A.cell(s.cell_id)) { el.innerHTML = '<div class="pd-hint">No Cell chosen for this session (Prep → Session prep).</div>'; return; }
    el.innerHTML = ms.map(function (a, i) {
      var away = s.away.indexOf(a.code) >= 0;
      var warn = [];
      if (a.hp != null && a.hp <= 0) warn.push(['r', 'down']);
      else if (a.hpMax && a.hp <= a.hpMax / 2) warn.push(['o', 'wounded']);
      if (a.san != null && a.bp != null && a.san - a.bp <= 3) warn.push(['r', a.san - a.bp <= 0 ? 'at BP' : (a.san - a.bp) + ' from BP']);
      a.disorders.forEach(function (d) { warn.push(['d', d]); });
      var notes = s.quick_notes.filter(function (q) { return q.code === a.code; }).slice(-2);
      return '<div class="pd-dos' + (away ? ' away' : '') + '" style="--r:' + ((i % 2 ? 0.7 : -0.8) + (i % 3) * 0.2) + 'deg" data-code="' + esc(a.code) + '">' +
        '<div class="pd-dn"><button type="button" class="pd-name" data-pd="sheet" title="Their Agent File (vitals ±, Roll SAN)">' + esc(a.name) + '</button><i>' + (away ? 'away' : 'DEX ' + (a.dex == null ? '—' : a.dex)) + '</i></div>' +
        (warn.length ? '<div class="pd-warns">' + warn.map(function (w) { return '<span class="pd-w ' + w[0] + '">' + esc(w[1]) + '</span>'; }).join('') + '</div>' : '') +
        '<div class="pd-v">' + A.vitalsHtml(a, true) + (a.bp != null ? ' · BP ' + a.bp : '') + '</div>' +
        notes.map(function (q) { return '<div class="pd-q" title="' + esc(new Date(q.at).toLocaleTimeString()) + '">' + esc(q.text) + '</div>'; }).join('') +
        (st.jot === a.code ? '<input class="pd-qin" data-jot="' + esc(a.code) + '" placeholder="Quick note on ' + esc(a.name.split(' ')[0]) + '… (Enter)">'
          : '<button type="button" class="pd-q add" data-pd="jot">+ quick note</button>') + '</div>';
    }).join('') || '<div class="pd-hint">No Agents in this Cell yet.</div>';
    var inp = el.querySelector('.pd-qin');
    if (inp) inp.focus();
  }

  /* ── Initiative ── */
  function inits(s) {
    var rows = present(s).filter(function (a) { return !(a.hp != null && a.hp <= 0); }).map(function (a) { return { name: a.name.split(' ').pop(), dex: a.dex, code: a.code }; });
    s.npcs.forEach(function (n, i) { rows.push({ name: n.name, dex: +n.dex || 0, npc: i }); });
    return rows.sort(function (a, b) { return (b.dex || 0) - (a.dex || 0) || (a.npc != null) - (b.npc != null); });
  }
  // NPCs: { name, dex, hp, wp, san } -- the vitals are optional; the ones
  // given show on the card, and its ✎ opens − / + for them during play.
  var NPCV = ['hp', 'wp', 'san'];
  function npcVitals(n) { return NPCV.filter(function (k) { return n[k] !== '' && n[k] != null && !isNaN(+n[k]); }).map(function (k) { return k.toUpperCase() + ' ' + n[k]; }).join(' · '); }
  function drawInitiative(s) {
    var el = ob('initiative');
    if (!el) return;
    var rows = inits(s), turn = rows.length ? st.turn % rows.length : 0;
    var ed = st.npcEdit != null ? s.npcs[st.npcEdit] : null;
    el.innerHTML = '<div class="pd-inits">' + rows.map(function (r, i) {
      var n = r.npc != null ? s.npcs[r.npc] : null, v = n ? npcVitals(n) : '';
      return '<button type="button" class="pd-ic' + (i === turn ? ' now' : '') + (n ? ' npc' : '') + (n && st.npcEdit === r.npc ? ' editing' : '') + '" data-pd="turn" data-i="' + i + '">' + esc(r.name) + '<b>' + (r.dex == null ? '—' : r.dex) + '</b>' +
        (v ? '<small>' + esc(v) + '</small>' : '') +
        (n ? '<span class="pd-icx" data-pd="rm-npc" data-n="' + r.npc + '" aria-label="Remove">✕</span><span class="pd-ice" data-pd="npc-edit" data-n="' + r.npc + '" aria-label="Vitals">✎</span>' : '') + '</button>';
    }).join('') + '<button type="button" class="pd-ic add" data-pd="add-npc" title="Add an NPC">+</button></div>' +
      (rows.length ? '<button type="button" class="pd-next" data-pd="next">Next ▸</button>' : '') +
      (ed ? '<div class="pd-npced"><b>' + esc(ed.name) + '</b>' + NPCV.map(function (k) {
        var has = ed[k] !== '' && ed[k] != null && !isNaN(+ed[k]);
        return '<span class="pd-npcv">' + k.toUpperCase() + ' <button type="button" data-pd="npc-v" data-k="' + k + '" data-d="-1" aria-label="' + k + ' down">−</button><i>' + (has ? ed[k] : '—') + '</i><button type="button" data-pd="npc-v" data-k="' + k + '" data-d="1" aria-label="' + k + ' up">+</button></span>';
      }).join('') + '<button type="button" class="pd-next" data-pd="npc-edit" data-n="' + st.npcEdit + '">done</button></div>' : '') +
      (st.npcForm ? '<form class="pd-npcf"><label>Name<input name="n" required></label><label>DEX<input name="d" type="number" min="1" max="30" required></label>' +
        '<label>HP<input name="hp" type="number" min="0" max="99"></label><label>WP<input name="wp" type="number" min="0" max="99"></label><label>SAN<input name="san" type="number" min="0" max="99"></label><button class="ac-btn">Add</button></form>' : '');
    var f = el.querySelector('.pd-npcf');
    if (f) {
      f.n.focus();
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        st.npcForm = false;
        var npc = { name: f.n.value.trim(), dex: +f.d.value };
        NPCV.forEach(function (k) { if (f[k].value !== '') npc[k] = +f[k].value; });
        S().update(s.id, { npcs: s.npcs.concat([npc]) });
      });
    }
  }

  /* ── The notebook: one wide page, a tab per scene ── */
  function drawNotebook(s) {
    var el = ob('notebook');
    if (!el) return;
    if (s.html_note && window.dgSessionNotes) {
      if (st.htmlFor === s.html_note.id + s.html_note.lang && el.querySelector('.sn-viewer, iframe')) return;
      st.htmlFor = s.html_note.id + s.html_note.lang;
      el.innerHTML = '<div class="pd-page pd-html"><div class="pd-wait">Opening…</div></div>';
      var host = el.querySelector('.pd-html');
      window.dgSessionNotes.load().then(function () {
        host.innerHTML = '';
        if (!window.dgSessionNotes.open(s.html_note.id, s.html_note.lang, host)) host.innerHTML = '<div class="pd-hint">That HTML page is gone.</div>';
      });
      return;
    }
    if (!s.note_path) {
      el.innerHTML = '<div class="pd-page"><div class="pd-hint">No notes for this session yet.</div><div class="ac-acts">' +
        '<button type="button" class="ac-btn" data-pd="pick-note">Pick from the vault…</button></div></div>';
      return;
    }
    var note = V().get(s.note_path);
    var md = note ? note.content || '' : '';
    var hs = V().headings(md, 2);
    var intro = V().sectionRange(md, '');
    var hasIntro = intro && md.split('\n').slice(intro.from, intro.to).some(function (l) { return l.trim() && !/^#\s/.test(l) && !/^---/.test(l); });
    var tabs = (hasIntro ? [{ title: '', label: 'Opening' }] : []).concat(hs.map(function (h) { return { title: h.title, label: h.title }; }));
    var memo = A.store('dg_acell_scene', {});
    if (st.scene == null) st.scene = memo[s.id] != null ? memo[s.id] : (tabs[0] ? tabs[0].title : '');
    if (st.scene !== '*' && !tabs.some(function (t) { return t.title === st.scene; })) st.scene = tabs[0] ? tabs[0].title : '*';
    var bar = '<div class="pd-tabs">' + tabs.map(function (t) {
      return '<button type="button" class="pd-tab' + (st.scene === t.title ? ' on' : '') + '" data-pd="scene" data-t="' + esc(t.title) + '">' + esc(t.label) + '</button>';
    }).join('') + '<button type="button" class="pd-tab' + (st.scene === '*' ? ' on' : '') + '" data-pd="scene" data-t="*">Whole note</button>' +
      '<span class="pd-tr">' + esc(V().title(s.note_path)) + ' · <button type="button" class="pd-edit' + (st.edit ? ' on' : '') + '" data-pd="edit">' + (st.edit ? '✓ done' : '✎ edit') + '</button></span></div>';
    var page = el.querySelector('.pd-page');
    if (!page || st.edFor !== s.note_path) {
      if (st.ed) st.ed.destroy();
      el.innerHTML = '<div class="pd-page"><div class="pd-bar"></div><div class="pd-ed"></div></div>';
      st.edFor = s.note_path;
      st.ed = V().editor(el.querySelector('.pd-ed'), s.note_path, {
        hideHead: true, mode: st.edit ? 'edit' : 'read', grow: true,
        scene: st.scene === '*' ? null : { title: st.scene },
        emptyText: note ? 'Nothing in this scene yet — ✎ edit to write.' : 'Loading the note…',
        onLink: function (p) { A.setMode('prep'); A.openNote(p); },
        onCue: cue
      });
    }
    el.querySelector('.pd-bar').innerHTML = bar;
  }
  function setScene(t) {
    var s = A.session();
    st.scene = t;
    var memo = A.store('dg_acell_scene', {});
    memo[s.id] = t;
    A.keep('dg_acell_scene', memo);
    if (st.ed) st.ed.setScene(t === '*' ? null : { title: t });
    drawNotebook(s);
  }
  // A cue in the notes: ⚡ an effect, ♪ a track or loop, ◫ evidence to release.
  function cue(text, el) {
    var m = M(), s = A.session(), kind = text.charAt(0), name = text.slice(1).trim().toLowerCase();
    function like(label) { label = String(label || '').toLowerCase(); return label === name || label.indexOf(name) >= 0 || name.indexOf(label) >= 0; }
    var done = '';
    if (kind === '⚡' && m) {
      var hit = null;
      music(s).pads.concat([].concat.apply([], m.stingerGroups().map(function (g) { return g.stingers.map(function (x) { return x.id; }); })))
        .some(function (id) { if (like(m.label('stinger', id))) { hit = id; return true; } return false; });
      if (hit) { m.fire(hit); done = 'fired'; }
    } else if (kind === '♪' && m) {
      var t = music(s).tracks.filter(function (x) { return like(x.title); })[0];
      if (t) { playTape(t); done = 'playing'; }
      else {
        var lib = m.tracks().filter(function (x) { return like(x.title); })[0];
        if (lib) { m.play({ url: lib.url, title: lib.title, kind: 'audio' }); done = 'playing'; }
      }
    } else if (kind === '◫' && window.dgAcellEvidence) {
      var ev = window.dgAcellEvidence.items().filter(function (h) { return like(h.title); })[0];
      if (ev && !ev.released) { window.dgAcellEvidence.release(ev.evidence_id, true); done = 'released'; }
    }
    if (el) { el.classList.add(done ? 'pd-cued' : 'pd-miss'); el.setAttribute('data-done', done || 'not found'); setTimeout(function () { el.classList.remove('pd-cued', 'pd-miss'); }, 1600); }
  }

  /* ── Quick notes pad ── */
  function drawPad(s) {
    var el = ob('pad');
    if (!el) return;
    var names = {};
    A.members(s.cell_id).forEach(function (a) { names[a.code] = a.name.split(' ').pop(); });
    var qs = s.quick_notes.slice(-14);
    el.innerHTML = '<h3>Quick notes</h3>' + qs.map(function (q) {
      return '<div class="pd-qn"><small>' + esc(new Date(q.at).toTimeString().slice(0, 5)) + '</small>' + (q.code ? '<b>' + esc(names[q.code] || q.code) + ':</b> ' : '') + esc(q.text) +
        '<button type="button" class="pd-qx" data-pd="rm-q" data-at="' + q.at + '" aria-label="Remove">✕</button></div>';
    }).join('') + '<input class="pd-in" data-jot="" placeholder="✎ jot a quick note… (Enter)">';
  }

  /* ── Tape deck ── */
  // What's playable: the tape in the deck (assets/acell-tapes.js); before
  // tapes, a session kept its own tracks and pads.
  function deckTape() { var D = window.dgTapes, t = D && D.inDeck(); return t && t.tracks ? t : null; }
  function music(s) {
    var t = deckTape();
    return t ? { tape: t, tracks: t.tracks, pads: t.pads } : { tape: null, tracks: s.tracks, pads: s.pads };
  }
  function tapesFor(s) { var D = window.dgTapes; return D ? D.forOperation(s.operation_id).concat(D.forCell(s.cell_id)) : []; }
  function playTape(t) {
    var m = M();
    if (t.kind === 'ambient') { m.setAmbient(t.ref, !(m.state().ambient || []).some(function (x) { return x.id === t.ref; })); return; }
    var url = t.kind === 'track' ? (A.trackById(t.ref) || {}).url : t.ref;
    if (url) m.play({ url: url, title: t.title, kind: 'audio' });
  }
  function drawDeck(s) {
    var el = ob('deck'), m = M();
    if (!el) return;
    if (!m) { el.innerHTML = '<div class="pd-hint">The broadcast isn\'t available.</div>'; return; }
    var now = m.state(), cur = now.current || {}, amb = now.ambient || [];
    var lines = [];
    if (cur.track_url) lines.push((cur.paused ? '❚❚ ' : '▶ ') + (cur.track_title || 'a track').toUpperCase() + (cur.loop ? ' (loop)' : ''));
    amb.forEach(function (x) { lines.push('≈ ' + m.label('ambient', x.id).toUpperCase()); });
    if (!lines.length) lines.push('— SILENCE —');
    el.innerHTML = '<div class="pd-scr"><span class="pd-ch">CH ' + esc(m.channel()) + '</span>' + lines.map(esc).join('<br>') + '</div>' +
      '<div class="pd-reels' + (cur.track_url && !cur.paused ? ' spin' : '') + '"><i></i><i></i></div>' +
      '<div class="pd-keys"><button type="button" data-pd="restart" title="From the top">◀◀</button><button type="button" data-pd="pause" title="Play / pause">▶ ❚❚</button>' +
      '<button type="button" data-pd="stop" title="Stop the track">■</button><button type="button" data-pd="loop" class="' + (cur.loop ? 'on' : '') + '" title="Loop">LOOP</button></div>' +
      (function () {
        var mu = music(s), D = window.dgTapes;
        if (mu.tape) return '<div class="pd-tapename">⏏ <b>' + esc(mu.tape.name) + '</b><button type="button" data-pd="eject" title="Take the tape out">eject</button></div>' +
          '<div class="pd-tape">' + mu.tracks.map(function (t, i) {
            var on = cur.track_title === t.title && !!cur.track_url;
            return '<button type="button" class="pd-tt' + (on ? ' on' : '') + '" data-pd="tape" data-i="' + i + '">♪ ' + esc(t.title) + '<small>' + esc(D.fmt(t.dur)) + '</small></button>';
          }).join('') + '</div>';
        var list = tapesFor(s);
        if (list.length) return '<div class="pd-tape"><div class="pd-hint light">Put a tape in:</div>' + list.map(function (t) {
          return '<button type="button" class="pd-tt" data-pd="insert" data-id="' + esc(t.id) + '">▶ ' + esc(t.name) + '</button>';
        }).join('') + '</div>';
        return mu.tracks.length ? '<div class="pd-tape">' + mu.tracks.map(function (t, i) {
          var on = t.kind === 'ambient' ? amb.some(function (x) { return x.id === t.ref; }) : (cur.track_title === t.title && !!cur.track_url);
          return '<button type="button" class="pd-tt' + (on ? ' on' : '') + '" data-pd="tape" data-i="' + i + '">' + (t.kind === 'ambient' ? '≈ ' : '♪ ') + esc(t.title) + '</button>';
        }).join('') + '</div>' : '<div class="pd-hint light">No tape yet (Prep → Music → Tapes).</div>';
      })();
  }

  /* ── Evidence box ── */
  function drawEvidence(s) {
    var el = ob('evidence'), E = window.dgAcellEvidence;
    if (!el) return;
    if (E) E.start();
    el.innerHTML = '<div class="pd-lid">Evidence · ' + esc(s.name) + '</div>' + (s.evidence.length ? s.evidence.map(function (id) {
      var h = E && E.find(id);
      if (!h) return '<div class="pd-f"><span>' + (E && E.items().length ? '(deleted)' : 'Loading…') + '</span></div>';
      var es = A.evidenceState(h);
      return '<div class="pd-f" data-ev="' + esc(id) + '"><span>' + esc(h.title || 'Untitled') + '</span>' +
        (es.released ? '<i class="ok">released' + (es.unseen.length ? ' · unseen: ' + esc(es.unseen.join(', ')) : '') + '</i>' : '<button type="button" data-pd="release">release ▸</button>') + '</div>';
    }).join('') : '<div class="pd-hint">Nothing in the box (Prep → Evidence → + Add to session).</div>');
  }

  /* ── Effect pads ── */
  function drawPads(s) {
    var el = ob('pads'), m = M();
    if (!el || !m) return;
    var pads = music(s).pads;
    el.innerHTML = '<div class="pd-padgrid">' + pads.map(function (id) {
      return '<button type="button" class="pd-fx" data-pd="fire" data-id="' + esc(id) + '">' + esc(m.label('stinger', id)) + '</button>';
    }).join('') + '<button type="button" class="pd-fx stop" data-pd="stopall" title="Stop every effect and loop">STOP</button></div>' +
      (pads.length ? '' : '<div class="pd-hint light">No pads yet (Prep → Music → a tape\'s pads).</div>');
  }

  /* ── The Dice Roller: the real panel, open, in its slot ──
     On its own page A-Cell has the panel and moves it onto the desk. In
     the Hub's app shell (hub.html) the one panel belongs to the shell's
     page, outside this frame: it's laid over the slot instead, following
     it while the desk scrolls, and hidden while the slot is off screen. */
  var dice = { moved: false, opened: false, outer: null, raf: 0, h: 0 };
  function outerPanel() {
    try {
      if (window.frameElement && window.parent !== window) return window.parent.document.getElementById('dr-panel');
    } catch (e) { /* not ours */ }
    return null;
  }
  function placeDice() {
    var slot = ob('dice');
    if (!slot) { releaseDice(); return; }
    var own = document.getElementById('dr-panel');
    if (window.innerWidth <= 720) { releaseDice(); slot.innerHTML = ''; return; }
    if (own) {
      if (own.parentNode !== slot) { slot.innerHTML = ''; slot.appendChild(own); }
      dice.moved = true;
      own.classList.add('pd-docked');
      if (own.classList.contains('dr-collapsed') && window.dgDice && window.dgDice._toggle) { window.dgDice._toggle(); dice.opened = true; }
      return;
    }
    var p = outerPanel();
    if (!p) { slot.innerHTML = '<div class="pd-hint light">Dice Roller loading…</div>'; return; }
    var pw = window.parent;
    if (!dice.outer) {
      dice.outer = p;
      if (p.classList.contains('dr-collapsed') && pw.dgDice && pw.dgDice._toggle) { pw.dgDice._toggle(); dice.opened = true; }
      slot.innerHTML = '<div class="pd-diceslot"></div>';
      follow();
    }
  }
  function follow() {
    cancelAnimationFrame(dice.raf);
    var p = dice.outer;
    if (!p || !st.open) return;
    var slot = ob('dice'), frame = window.frameElement;
    var hold = slot && slot.querySelector('.pd-diceslot');
    if (!slot || !hold || !frame) { releaseDice(); return; }
    var h = p.offsetHeight || 260;
    if (Math.abs(h - dice.h) > 2) { dice.h = h; hold.style.height = h + 'px'; }
    var r = hold.getBoundingClientRect(), fr = frame.getBoundingClientRect();
    var visible = r.bottom > 0 && r.top < window.innerHeight;
    var ps = p.style;
    ps.setProperty('position', 'fixed', 'important');
    ps.setProperty('left', Math.round(fr.left + r.left) + 'px', 'important');
    ps.setProperty('top', Math.round(fr.top + r.top) + 'px', 'important');
    ps.setProperty('right', 'auto', 'important');
    ps.setProperty('bottom', 'auto', 'important');
    ps.setProperty('width', Math.round(r.width) + 'px', 'important');
    ps.visibility = visible && r.top >= -4 ? '' : 'hidden';
    dice.raf = requestAnimationFrame(follow);
  }
  function releaseDice() {
    cancelAnimationFrame(dice.raf);
    var own = document.getElementById('dr-panel');
    if (own && dice.moved) {
      own.classList.remove('pd-docked');
      document.body.appendChild(own);
      if (dice.opened && !own.classList.contains('dr-collapsed') && window.dgDice) window.dgDice._toggle();
    }
    var p = dice.outer;
    if (p) {
      ['position', 'left', 'top', 'right', 'bottom', 'width'].forEach(function (k) { p.style.removeProperty(k); });
      p.style.visibility = '';
      try { if (dice.opened && !p.classList.contains('dr-collapsed') && window.parent.dgDice) window.parent.dgDice._toggle(); } catch (e) { /* gone */ }
    }
    dice.moved = false; dice.opened = false; dice.outer = null; dice.h = 0;
  }
  window.addEventListener('pagehide', releaseDice);

  /* ── Clicks, keys, dragging ── */
  panel.addEventListener('click', function (e) {
    var b = e.target.closest('[data-pd]');
    if (!b) return;
    var a = b.getAttribute('data-pd'), s = A.session(), m = M();
    var holder = b.closest('[data-code]'), code = holder ? holder.getAttribute('data-code') : '';
    switch (a) {
      case 'pick': S().setCurrent(b.getAttribute('data-id')); return;
      case 'new': A.editSession(null); return;
      case 'sheet': if (window.dgAcPlayers) { var w = window.dgAcPlayers.editSheet(code, { view: true }); w.classList.add('pd-sheet'); } return;
      case 'jot': st.jot = code; drawDossiers(s); return;
      case 'turn': st.turn = +b.getAttribute('data-i'); drawInitiative(s); return;
      case 'next': st.turn++; drawInitiative(s); return;
      case 'add-npc': st.npcForm = !st.npcForm; drawInitiative(s); return;
      case 'rm-npc': e.stopPropagation(); st.npcEdit = null; S().update(s.id, { npcs: s.npcs.filter(function (x, i) { return i !== +b.getAttribute('data-n'); }) }); return;
      case 'npc-edit': { e.stopPropagation(); var ni = +b.getAttribute('data-n'); st.npcEdit = st.npcEdit === ni ? null : ni; drawInitiative(s); return; }
      case 'npc-v': {
        var k = b.getAttribute('data-k'), list = s.npcs.map(function (x) { return Object.assign({}, x); }), n = list[st.npcEdit];
        if (!n) return;
        n[k] = Math.max(0, (isNaN(+n[k]) || n[k] === '' || n[k] == null ? 0 : +n[k]) + +b.getAttribute('data-d'));
        S().update(s.id, { npcs: list }); return;
      }
      case 'scene': setScene(b.getAttribute('data-t')); return;
      case 'edit': st.edit = !st.edit; if (st.ed) st.ed.setMode(st.edit ? 'edit' : 'read'); drawNotebook(s); return;
      case 'pick-note': A.setMode('prep'); window.dgAcellTab('session'); return;
      case 'rm-q': S().removeQuickNote(s.id, +b.getAttribute('data-at')); return;
      case 'restart': m.restart(); return;
      case 'pause': m.togglePause(); return;
      case 'stop': m.stop(); return;
      case 'loop': m.toggleLoop(); return;
      case 'tape': { var mt = music(s); if (mt.tape) m.playCue(+b.getAttribute('data-i')); else playTape(mt.tracks[+b.getAttribute('data-i')]); return; }
      case 'insert': window.dgTapes.insert(b.getAttribute('data-id')); return;
      case 'eject': window.dgTapes.eject(); return;
      case 'release': {
        var id = b.closest('[data-ev]').getAttribute('data-ev');
        b.disabled = true; b.textContent = 'releasing…';
        window.dgAcellEvidence.release(id, true).catch(function (err) { b.disabled = false; b.textContent = 'release ▸'; b.title = (err && err.message) || String(err); });
        return;
      }
      case 'fire': b.classList.add('hit'); setTimeout(function () { b.classList.remove('hit'); }, 250); m.fire(b.getAttribute('data-id')); return;
      case 'stopall': m.stopAll(); return;
      case 'away': {
        var oid = b.closest('[data-o]').getAttribute('data-o');
        delete L.items[oid];
        L.away.push(oid); st.pick = ''; save(); build(); return;
      }
      case 'back': {
        var bid = b.getAttribute('data-id');
        L.away = L.away.filter(function (x) { return x !== bid; });
        var bottom = 0;
        Object.keys(L.items).forEach(function (k) { bottom = Math.max(bottom, L.items[k].y + L.items[k].h); });
        L.items[bid] = fit(Object.assign(clone(DEFAULT.items[bid]), { x: 0, y: bottom }), bid);
        save(); build(); return;
      }
      case 'reset': L = clone(DEFAULT); save(); build(); return;
    }
  });
  panel.addEventListener('keydown', function (e) {
    var t = e.target;
    if (!t.hasAttribute || !t.hasAttribute('data-jot')) return;
    if (e.key === 'Escape') { st.jot = ''; drawDossiers(A.session()); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    var s = A.session(), text = t.value.trim(), code = t.getAttribute('data-jot');
    t.value = '';
    if (code) st.jot = '';
    if (text) S().addQuickNote(s.id, text, code);
    else if (code) drawDossiers(s);
  });
  // Arranging: drag a title bar to any cell of the grid, drag the yellow
  // corner to size it -- or, on a touch screen, tap a bar, then tap the
  // cell it should start at. What it lands on moves down out of its way.
  var drag = null;
  function gridEl() { return panel.querySelector('.pd-grid'); }
  function cellAt(x, y) {
    var g = gridEl(), r = g.getBoundingClientRect(), cw = (r.width - GAP * (COLS - 1)) / COLS;
    return { x: Math.max(0, Math.min(COLS - 1, Math.floor((x - r.left + GAP / 2) / (cw + GAP)))), y: Math.max(0, Math.floor((y - r.top + GAP / 2) / (ROW + GAP))), cw: cw };
  }
  function ghost(rect) {
    var gh = panel.querySelector('.pd-ghost');
    if (!gh) return;
    if (!rect) { gh.hidden = true; return; }
    gh.hidden = false;
    gh.style.gridColumn = (rect.x + 1) + ' / span ' + rect.w;
    gh.style.gridRow = (rect.y + 1) + ' / span ' + rect.h;
    gh.textContent = rect.w + ' × ' + rect.h;
  }
  function apply(id, rect) {
    L.items[id] = fit(rect, id);
    settle(id);
    st.pick = '';
    save(); build();
  }
  panel.addEventListener('pointerdown', function (e) {
    if (!st.arrange) return;
    var rz = e.target.closest('[data-rz]');
    var h = e.target.closest('.pd-oh');
    if (!rz && (!h || e.target.closest('.pd-x'))) return;
    e.preventDefault();
    var el = (rz || h).closest('[data-o]'), id = el.getAttribute('data-o'), c = cellAt(e.clientX, e.clientY), r = L.items[id];
    drag = { id: id, el: el, size: !!rz, x: e.clientX, y: e.clientY, moved: false, dx: c.x - r.x, dy: c.y - r.y, rect: null };
    try { (rz || h).setPointerCapture(e.pointerId); } catch (err) { /* old Safari */ }
  });
  panel.addEventListener('pointermove', function (e) {
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 8) return;
    drag.moved = true;
    drag.el.classList.add('pd-lift');
    var c = cellAt(e.clientX, e.clientY), r = L.items[drag.id];
    drag.rect = drag.size ? fit({ x: r.x, y: r.y, w: c.x - r.x + 1, h: c.y - r.y + 1 }, drag.id)
      : fit({ x: c.x - drag.dx, y: c.y - drag.dy, w: r.w, h: r.h }, drag.id);
    ghost(drag.rect);
  });
  panel.addEventListener('pointerup', function (e) {
    if (drag) {
      var d = drag; drag = null;
      d.el.classList.remove('pd-lift');
      ghost(null);
      if (d.moved) { if (d.rect) apply(d.id, d.rect); return; }
      if (d.size) return;
      // A tap on a bar: pick it up (tap it again to put it down) …
      st.pick = st.pick === d.id ? '' : d.id;
      markPick();
      return;
    }
    // … then a tap on the grid puts it there, its top-left corner at that cell.
    if (st.arrange && st.pick && gridEl() && !e.target.closest('button, input, a') && e.target.closest('.pd-grid')) {
      var c = cellAt(e.clientX, e.clientY), r = L.items[st.pick];
      apply(st.pick, { x: c.x, y: c.y, w: r.w, h: r.h });
    }
  });
  panel.addEventListener('pointercancel', function () { if (drag) { drag.el.classList.remove('pd-lift'); ghost(null); drag = null; } });
  function markPick() {
    Array.prototype.forEach.call(panel.querySelectorAll('[data-o]'), function (el) { el.classList.toggle('pd-picked', el.getAttribute('data-o') === st.pick); });
    var tip = panel.querySelector('.pd-pickt');
    if (tip) tip.textContent = st.pick ? 'Now tap where ' + OBJ[st.pick] + ' starts: its top-left corner goes there.' : '';
  }

  /* ── The top bar's tools, while playing ── */
  function drawTools() {
    tools.innerHTML = st.open ? '<button type="button" data-tool="arrange" class="' + (st.arrange ? 'on' : '') + '">✥ Arrange</button>' +
      '<button type="button" data-tool="prep">☰ Prep</button>' : '';
  }
  tools.addEventListener('click', function (e) {
    var b = e.target.closest('[data-tool]');
    if (!b) return;
    if (b.getAttribute('data-tool') === 'arrange') { st.arrange = !st.arrange; st.pick = ''; drawTools(); build(); }
    else A.setMode('prep');
  });

  // The first time a session reaches the desk: the Agents' vitals now.
  function markStart(s) {
    if (!s || s.start || !A.cell(s.cell_id)) return;
    var ms = A.members(s.cell_id);
    if (!ms.length) return;
    var start = {};
    ms.forEach(function (a) { start[a.code] = { hp: a.hp, wp: a.wp, san: a.san, bp: a.bp, name: a.name }; });
    var patch = { start: start, started_at: Date.now() };
    if (s.state === 'prep') patch.state = 'played';
    S().update(s.id, patch);
    // The Cell's own channel, so the deck plays where the table listens.
    var c = A.cell(s.cell_id);
    if (c && c.channel && M()) M().setChannel(c.channel);
  }

  var t0 = null;
  function soon() { if (!st.open) return; clearTimeout(t0); t0 = setTimeout(function () { build(); drawAll(); }, 25); }
  document.addEventListener('dg-acell-tab', function (e) {
    var was = st.open;
    st.open = e.detail.tab === 'desk';
    drawTools();
    if (st.open) {
      st.built = ''; st.scene = null;
      var s = A.session();
      if (s) { markStart(s); if (A.loadSeen) A.loadSeen(); }
      if (V()) V().load().then(soon, function () {});
      build();
    } else if (was) {
      releaseDice();
      if (st.ed) { st.ed.destroy(); st.ed = null; st.edFor = ''; }
      if (window.dgSessionNotes && window.dgSessionNotes.current() && window.dgSessionNotes.current().docked) window.dgSessionNotes.close();
      st.htmlFor = '';
      panel.innerHTML = '';
      st.built = '';
    }
  });
  ['dg-sessions', 'dg-acell-roster', 'dg-acell-evidence', 'dg-acell-music', 'dg-acell-seen', 'dg-tapes'].forEach(function (ev) {
    document.addEventListener(ev, function () {
      if (!st.open) return;
      if (ev === 'dg-sessions') { var s = A.session(); if (s && st.built.indexOf(s.id + '|') !== 0) st.scene = null; }
      soon();
    });
  });
  document.addEventListener('dg-vault', function () { if (st.open && A.session() && !st.ed) soon(); else if (st.open) { var s = A.session(); if (s) drawNotebook(s); } });
  window.addEventListener('resize', function () { if (st.open) placeDice(); });

  window.dgAcPlay = { layout: function () { return clone(L); }, build: build, cue: cue, arrange: function (on) { st.arrange = !!on; drawTools(); build(); } };
})();
