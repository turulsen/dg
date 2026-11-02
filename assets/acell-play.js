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
    dossiers: 'Initiative', dice: 'Dice Roller', notebook: 'Notebook',
    deck: 'Tape deck', pad: 'Quick notes', evidence: 'Evidence box', pads: 'Effect pads'
  };
  // A 12-column grid of 58px rows: each object { x, y, w, h } in cells.
  // Kept on this device (dg_acell_desk_v3); objects put away sit in `away`.
  var KEY3 = 'dg_acell_desk_v3', COLS = 12, ROW = 58, GAP = 12;
  var MIN = { dossiers: [3, 4], dice: [2, 4], notebook: [3, 4], deck: [3, 7], pad: [2, 2], evidence: [2, 2], pads: [2, 2] };
  var DEFAULT = { items: {
    deck: { x: 0, y: 0, w: 4, h: 9 }, pads: { x: 4, y: 0, w: 5, h: 3 }, pad: { x: 9, y: 0, w: 3, h: 4 },
    notebook: { x: 4, y: 3, w: 5, h: 15 }, evidence: { x: 9, y: 4, w: 3, h: 4 }, dossiers: { x: 9, y: 8, w: 3, h: 10 }, dice: { x: 0, y: 9, w: 4, h: 6 }
  }, away: [] };
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  var L = (function () {
    var l = A.store(KEY3, null);
    if (!l || !l.items) return clone(DEFAULT);
    l.away = (l.away || []).filter(function (id) { return OBJ[id]; });
    Object.keys(OBJ).forEach(function (id) { if (!l.items[id] && l.away.indexOf(id) < 0) l.items[id] = clone(DEFAULT.items[id]); });
    Object.keys(l.items).forEach(function (id) { if (!OBJ[id] || l.away.indexOf(id) >= 0) delete l.items[id]; else fit(l.items[id], id); });
    // The deck holds the compact player since 2026-10-30 (9 rows): a layout
    // the earlier version stretched to 13 comes back to 9 once; a saved
    // deck smaller than the player's least grows, what it covers moves down.
    if (l.items.deck && !l.deck9) { if (l.items.deck.h >= 13) l.items.deck.h = 9; l.deck9 = true; }
    if (l.items.deck) setTimeout(function () { settle('deck'); save(); }, 0);
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
    if (window.dgAcConsole && window.dgAcConsole.lent && window.dgAcConsole.lent() && panel.contains(document.getElementById('ac-console'))) window.dgAcConsole.detach();
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
    drawDossiers(s); drawNotebook(s); drawPad(s); drawDeck(s); drawEvidence(s); drawPads(s); placeDice();
  }

  /* ── Initiative: the phone's post-its on the desk (2026-11-02, replacing
     the dossier folders and the DEX row). Highest DEX first; an Agent's
     post-it keeps what the dossier had (warnings, vitals, quick notes,
     their Agent File); an NPC's has − / + for HP, WP, SAN, hide and out.
     The order, the turn and the NPC changes are the phone's
     (window.dgAcmInit, assets/acell-mobile-play.js), so both agree. ── */
  function warns(a) {
    var w = [];
    if (a.hp != null && a.hp <= 0) w.push(['r', 'down']);
    else if (a.hpMax && a.hp <= a.hpMax / 2) w.push(['o', 'wounded']);
    if (a.san != null && a.bp != null && a.san - a.bp <= 3) w.push(['r', a.san - a.bp <= 0 ? 'at BP' : (a.san - a.bp) + ' from BP']);
    a.disorders.forEach(function (d) { w.push(['dis', d]); });
    return w.length ? '<span class="pd-warns">' + w.map(function (x) { return '<span class="pd-w ' + x[0] + '">' + esc(x[1]) + '</span>'; }).join('') + '</span>' : '';
  }
  function agentIp(s, a, k, on, out) {
    var rot = [-0.6, 0.5, -0.3, 0.4, -0.5, 0.6, -0.2];
    var notes = s.quick_notes.filter(function (q) { return q.code === a.code; }).slice(-2);
    return '<div class="acm-ip c-y pd-ag' + (on ? ' now' : '') + (out ? ' out' : '') + '" style="--r:' + rot[k % rot.length] + 'deg" data-code="' + esc(a.code) + '">' +
      '<span class="d">' + (a.dex == null ? '—' : a.dex) + '</span><span class="acm-g">' +
      '<button type="button" class="pd-name" data-pd="sheet" title="Their Agent File (vitals ±, Roll SAN)">' + esc(a.name) + (out ? ' <i>' + out + '</i>' : '') + '</button>' +
      '<small>' + A.vitalsHtml(a, true) + (a.bp != null ? ' · BP ' + a.bp : '') + '</small>' + warns(a) +
      notes.map(function (q) { return '<span class="pd-q" title="' + esc(new Date(q.at).toLocaleTimeString()) + '">' + esc(q.text) + '</span>'; }).join('') +
      (st.jot === a.code ? '<input class="pd-qin" data-jot="' + esc(a.code) + '" placeholder="Quick note on ' + esc(a.name.split(' ')[0]) + '… (Enter)">'
        : '<button type="button" class="pd-q add" data-pd="jot">+ quick note</button>') + '</span>' +
      '<button type="button" class="pd-file" data-pd="sheet">File</button></div>';
  }
  function drawDossiers(s) {
    var el = ob('dossiers');
    if (!el) return;
    // The phone layout has its own Initiative tab: one set of post-its.
    if (document.body.classList.contains('acm')) { el.innerHTML = ''; return; }
    if (!A.cell(s.cell_id)) { el.innerHTML = '<div class="pd-hint">No Cell chosen for this session (Prep → Session prep).</div>'; return; }
    var J = window.dgAcmInit;
    if (!J) { el.innerHTML = '<div class="pd-hint">Initiative is loading…</div>'; return; }
    var rows = J.order(s), lv = J.live(rows), ts = J.turn(s), now = lv.length ? lv[ts.turn % lv.length] : null;
    var rot = [-0.6, 0.5, -0.3, 0.4, -0.5, 0.6, -0.2];
    var outs = A.members(s.cell_id).filter(function (a) { return s.away.indexOf(a.code) >= 0 || (a.hp != null && a.hp <= 0); });
    var up = s.npcs.map(function (n, i) { return { n: n, i: i }; }).filter(function (x) { return x.n.init === false; });
    var hold = el.scrollTop;
    el.innerHTML = '<div class="pd-init acm-desk"><div class="acm-g3 acm-initbar">' +
      '<button type="button" class="acm-btn cream" data-acm="next-turn">Next turn</button><button type="button" class="acm-btn dark" data-acm="new-round">New round</button><button type="button" class="acm-btn dark" data-acm="new-npc-init">+ NPC</button></div>' +
      '<div class="acm-round"><b>Round ' + ts.round + '</b><span>' + esc(now ? (now.agent ? now.agent.name : now.npc.name) + '\'s turn' : 'no one in the order') + '</span>' + (ts.round > 1 || ts.turn ? '<button type="button" data-acm="round-reset">Start over</button>' : '') + '</div>' +
      (rows.length ? rows.map(function (r, k) {
        if (r.agent) return agentIp(s, r.agent, k, r === now, '');
        var n = r.npc;
        return '<div class="acm-ip c-pu pd-npc' + (r === now ? ' now' : '') + (n.hidden ? ' hid' : '') + '" style="--r:' + rot[k % rot.length] + 'deg"><span class="d">' + (n.dex || '—') + '</span><span class="acm-g"><b data-acm="npc-open" data-i="' + r.i + '" title="Vitals, note, remove">' + esc(n.name) + (n.hidden ? ' <i>hidden</i>' : '') + '</b><span class="acm-vit">' + J.vit('hp', n.hp, r.i) + J.vit('wp', n.wp, r.i) + (n.san != null && n.san !== '' ? J.vit('san', n.san, r.i) : '') + '</span></span>' +
          '<span class="acm-xs"><button type="button" data-acm="npc-hide" data-i="' + r.i + '" title="' + (n.hidden ? 'Show' : 'Hide') + '" aria-label="' + (n.hidden ? 'Show' : 'Hide') + '">' + (window.dgIcons ? window.dgIcons.svg(n.hidden ? 'eye' : 'hide', 's') : (n.hidden ? 'show' : 'hide')) + '</button><button type="button" data-acm="npc-out" data-i="' + r.i + '" title="Take out of the order" aria-label="Take out of the order">' + (window.dgIcons ? window.dgIcons.svg('close', 's') : '✕') + '</button></span></div>';
      }).join('') : '<p class="acm-none light">No one in the order yet.</p>') +
      outs.map(function (a, k) { return agentIp(s, a, k + rows.length, false, s.away.indexOf(a.code) >= 0 ? 'away' : 'down'); }).join('') +
      (up.length ? '<div class="acm-lab">Upcoming · not in the order yet</div><div class="acm-chips">' + up.map(function (x) { return '<button type="button" class="acm-chip c-pu" data-acm="npc-in" data-i="' + x.i + '">+ ' + esc(x.n.name) + ' · ' + (x.n.dex || '—') + '</button>'; }).join('') + '</div>' : '') + '</div>';
    el.scrollTop = hold;
    var inp = el.querySelector('.pd-qin');
    if (inp) inp.focus();
  }

  /* ── The notebook: a tab per note the session keeps (2026-10-30), and
     in a vault note one wide page, a tab per scene ── */
  function noteTitle(n) {
    if (n.kind === 'vault') return V().title(n.path);
    if (n.kind === 'gdoc') return n.title || 'Google Doc';
    return ((((window.dgSessionNotes && window.dgSessionNotes.notes()) || []).filter(function (h) { return h.id === n.id; })[0]) || {}).title || 'HTML page';
  }
  function drawNotebook(s) {
    var box = ob('notebook');
    if (!box) return;
    var list = window.dgSessions.notesOf(s);
    if (st.noteFor !== s.id) { st.noteFor = s.id; st.note = +((A.store('dg_acell_nbnote', {}))[s.id] || 0); }
    if (!(st.note < list.length)) st.note = 0;
    var n = list[st.note];
    if (!box.querySelector('.pd-nbody')) { if (st.ed) { st.ed.destroy(); st.ed = null; } st.edFor = ''; st.htmlFor = ''; box.innerHTML = '<div class="pd-ntabs"></div><div class="pd-nbody"></div>'; }
    var nt = box.querySelector('.pd-ntabs');
    nt.innerHTML = list.length > 1 ? list.map(function (x, k) { return '<button type="button" class="pd-ntab' + (k === st.note ? ' on' : '') + '" data-pd="note" data-i="' + k + '">' + esc(noteTitle(x)) + '</button>'; }).join('') : '';
    nt.style.display = list.length > 1 ? '' : 'none';
    var el = box.querySelector('.pd-nbody');
    if (!n || n.kind !== 'vault') { if (st.ed) { st.ed.destroy(); st.ed = null; } st.edFor = ''; }
    if (n && n.kind === 'html' && window.dgSessionNotes) {
      if (st.htmlFor === 'h' + n.id + n.lang && el.querySelector('.sn-viewer, iframe')) return;
      st.htmlFor = 'h' + n.id + n.lang;
      el.innerHTML = '<div class="pd-page pd-html"><div class="pd-wait">Opening…</div></div>';
      var host = el.querySelector('.pd-html');
      window.dgSessionNotes.load().then(function () {
        host.innerHTML = '';
        if (!window.dgSessionNotes.open(n.id, n.lang, host)) host.innerHTML = '<div class="pd-hint">That HTML page is gone.</div>';
      });
      return;
    }
    if (n && n.kind === 'gdoc') {
      if (st.htmlFor === 'g' + n.url && el.querySelector('.pd-gdoc')) return;
      if (window.dgSessionNotes && window.dgSessionNotes.current() && window.dgSessionNotes.current().docked) window.dgSessionNotes.close();
      st.htmlFor = 'g' + n.url;
      var src = window.dgSessions.gdocEmbed(n.url);
      el.innerHTML = '<div class="pd-page pd-gdoc"><div class="pd-gdoc-hd"><span>' + esc(n.title || 'Google Doc') + ' · Google Doc, read-only here</span><a class="ac-btn" href="' + esc(n.url) + '" target="_blank" rel="noopener">Open in Google Docs</a></div>' +
        (src ? '<iframe src="' + esc(src) + '" title="' + esc(n.title || 'Google Doc') + '" loading="lazy"></iframe>' : '<div class="pd-hint">This link can\'t be shown here; open it in Google Docs.</div>') + '</div>';
      return;
    }
    if (st.htmlFor && window.dgSessionNotes && window.dgSessionNotes.current() && window.dgSessionNotes.current().docked) window.dgSessionNotes.close();
    st.htmlFor = '';
    if (!n) {
      el.innerHTML = '<div class="pd-page"><div class="pd-hint">No notes for this session yet. Add them in Prep, under Notes.</div><div class="ac-acts">' +
        '<button type="button" class="ac-btn" data-pd="pick-note">Pick from the vault…</button></div></div>';
      return;
    }
    var path = n.path, note = V().get(path);
    var md = note ? note.content || '' : '';
    var hs = V().headings(md, 2);
    var intro = V().sectionRange(md, '');
    var hasIntro = intro && md.split('\n').slice(intro.from, intro.to).some(function (l) { return l.trim() && !/^#\s/.test(l) && !/^---/.test(l); });
    var tabs = (hasIntro ? [{ title: '', label: 'Opening' }] : []).concat(hs.map(function (h) { return { title: h.title, label: h.title }; }));
    var memo = A.store('dg_acell_scene', {}), mk = st.note ? s.id + '|' + path : s.id;
    if (st.scene == null) st.scene = memo[mk] != null ? memo[mk] : (tabs[0] ? tabs[0].title : '');
    if (st.scene !== '*' && !tabs.some(function (t) { return t.title === st.scene; })) st.scene = tabs[0] ? tabs[0].title : '*';
    var bar = '<div class="pd-tabs">' + tabs.map(function (t) {
      return '<button type="button" class="pd-tab' + (st.scene === t.title ? ' on' : '') + '" data-pd="scene" data-t="' + esc(t.title) + '">' + esc(t.label) + '</button>';
    }).join('') + '<button type="button" class="pd-tab' + (st.scene === '*' ? ' on' : '') + '" data-pd="scene" data-t="*">Whole note</button>' +
      '<span class="pd-tr">' + esc(V().title(path)) + ' · <button type="button" class="pd-edit' + (st.edit ? ' on' : '') + '" data-pd="edit">' + (st.edit ? '✓ done' : '✎ edit') + '</button></span></div>';
    var page = el.querySelector('.pd-page');
    if (!page || !el.querySelector('.pd-ed') || st.edFor !== path) {
      if (st.ed) st.ed.destroy();
      el.innerHTML = '<div class="pd-page"><div class="pd-bar"></div><div class="pd-ed"></div></div>';
      st.edFor = path;
      st.ed = V().editor(el.querySelector('.pd-ed'), path, {
        hideHead: true, mode: st.edit ? 'edit' : 'read', grow: true,
        scene: st.scene === '*' ? null : { title: st.scene },
        emptyText: note ? 'Nothing in this scene yet — ✎ edit to write.' : 'Loading the note…',
        onLink: function (p) { A.setMode('prep'); A.openNote(p); },
        onCue: cue
      });
    }
    el.querySelector('.pd-bar').innerHTML = bar;
  }
  function setNote(i) {
    var s = A.session();
    st.note = i; st.scene = null; st.edit = false;
    var memo = A.store('dg_acell_nbnote', {}); memo[s.id] = i; A.keep('dg_acell_nbnote', memo);
    drawNotebook(s);
  }
  function setScene(t) {
    var s = A.session();
    st.scene = t;
    var memo = A.store('dg_acell_scene', {}), n = window.dgSessions.notesOf(s)[st.note || 0];
    memo[st.note && n ? s.id + '|' + n.path : s.id] = t;
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
    // The deck's tape only when it's one of this session's (2026-10-30).
    var t = deckTape();
    if (t && !tapesFor(s).some(function (x) { return x.id === t.id; })) t = null;
    return t ? { tape: t, tracks: t.tracks, pads: t.pads } : { tape: null, tracks: s.tracks, pads: s.pads };
  }
  function tapesFor(s) { var D = window.dgTapes; return D ? D.forOperation(s.operation_id).concat(D.forCell(s.cell_id)) : []; }
  function playTape(t) {
    var m = M();
    if (t.kind === 'ambient') { m.setAmbient(t.ref, !(m.state().ambient || []).some(function (x) { return x.id === t.ref; })); return; }
    var url = t.kind === 'track' ? (A.trackById(t.ref) || {}).url : t.ref;
    if (url) m.play({ url: url, title: t.title, kind: 'audio' });
  }
  // The Music tab's own player, lent to the desk (2026-10-30), under the
  // session's tapes: tap a tape and it's in the dialed channel's deck,
  // its tracks on the player's screen and its pads on the Effect pads.
  function drawDeck(s) {
    var el = ob('deck'), m = M(), P = window.dgAcConsole;
    if (!el) return;
    // On a phone the Pads screen has the player; this desk sits hidden
    // behind it and must not take it back (2026-10-30: the player vanished
    // from Pads on every change to the broadcast).
    if (document.body.classList.contains('acm')) {
      if (P && P.detach && el.contains(document.getElementById('ac-console'))) P.detach();
      return;
    }
    if (!m || !P || !P.attach) { el.innerHTML = '<div class="pd-hint">The broadcast isn\'t available.</div>'; return; }
    if (!el.querySelector('.pd-cxhost')) { el.innerHTML = '<div class="pd-cxtapes"></div><div class="pd-cxhost"></div>'; }
    var host = el.querySelector('.pd-cxhost');
    if (!host.querySelector('#ac-console')) P.attach(host, 'desk');
    var D = window.dgTapes, t = deckTape(), cur = (m.state().current || {}), list = tapesFor(s), playing = !!cur.track_url && !cur.paused;
    var key = list.map(function (x) { return x.id + x.name + x.color; }).join() + '|' + (t ? t.id : '') + playing + m.channel();
    var strip = el.querySelector('.pd-cxtapes');
    if (strip.getAttribute('data-k') === key) return;
    strip.setAttribute('data-k', key);
    strip.innerHTML = '<div class="pd-cxl">Tapes · tap one to play it on CH ' + esc(m.channel()) + '</div>' + (list.length ? '<div class="pd-cxrow">' + list.map(function (x) {
      var on = t && t.id === x.id;
      return '<button type="button" class="pd-cxt' + (on ? ' on' : '') + '" data-pd="' + (on ? 'noop' : 'insert') + '" data-id="' + esc(x.id) + '" title="' + esc(x.name) + '">' + D.svg(x, { spin: on && playing }) + '<span>' + esc(x.name) + (on ? '<em>in the deck</em>' : '') + '</span></button>';
    }).join('') + '</div>' : '<div class="pd-hint light">No tapes for this session yet (Prep → Music → Tapes).</div>');
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
    // Laid over the desk from the Hub's page, it would float above any
    // A-Cell pop-up (2026-11-02: over an open Agent File): hidden while one
    // is open.
    var covered = !!document.querySelector('.vn-modal');
    ps.visibility = visible && r.top >= -4 && !covered ? '' : 'hidden';
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
    // Initiative: the phone's own actions; then the post-its again (the
    // turn is kept on this device, an NPC change comes back as dg-sessions).
    var ab = e.target.closest('.pd-dossiers [data-acm]');
    if (ab) {
      var fn = window.dgAcm && window.dgAcm.actions[ab.getAttribute('data-acm')];
      if (fn) { fn(ab, e); drawDossiers(A.session()); }
      return;
    }
    var b = e.target.closest('[data-pd]');
    if (!b) return;
    var a = b.getAttribute('data-pd'), s = A.session(), m = M();
    var holder = b.closest('[data-code]'), code = holder ? holder.getAttribute('data-code') : '';
    switch (a) {
      case 'pick': S().setCurrent(b.getAttribute('data-id')); return;
      case 'new': A.editSession(null); return;
      case 'sheet': if (window.dgAcPlayers) { var w = window.dgAcPlayers.editSheet(code, { view: true }); w.classList.add('pd-sheet'); } return;
      case 'jot': st.jot = code; drawDossiers(s); return;
      case 'scene': setScene(b.getAttribute('data-t')); return;
      case 'note': setNote(+b.getAttribute('data-i')); return;
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
      case 'fire': b.classList.add('hit'); setTimeout(function () { b.classList.remove('hit'); }, 250); (window.dgAcConsole && window.dgAcConsole.fire ? window.dgAcConsole.fire(b.getAttribute('data-id')) : m.fire(b.getAttribute('data-id'))); return;
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
      if (window.dgAcConsole && panel.contains(document.getElementById('ac-console'))) window.dgAcConsole.detach();
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

  window.dgAcPlay = { layout: function () { return clone(L); }, build: build, cue: cue, markStart: markStart, arrange: function (on) { st.arrange = !!on; drawTools(); build(); } };
})();
