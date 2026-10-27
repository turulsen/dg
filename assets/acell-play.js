/* A-Cell's Play desk (v3.12.0): the session in the top bar, laid out on a
   desk for the table.

   The objects: the Agents' dossiers (vitals, warnings, quick notes on a
   sticky), initiative cards (the Cell by DEX and the session's NPCs),
   the notebook (the session's notes on one wide page, a tab per ##
   scene -- or the uploaded HTML page, docked), the quick-notes pad, the
   tape deck (the session's tape and the broadcast's transport), the
   effect pads, the evidence box (release with a tap) and the Dice Roller
   -- the real panel, open, moved onto the desk.

   ✥ Arrange: drag an object by its grip onto another to swap them, or
   onto the foot of a column to move it there; ✕ puts it away in the
   drawer (and back from there); the sliders set the side columns'
   widths. The layout is kept on this device (dg_acell_desk_v2).

   Entering Play the first time for a session notes the Agents' vitals
   (session.start) so Debrief can say what the night cost them. */
(function () {
  'use strict';
  var A = window.dgAc;
  if (!A || window.dgAcPlay) return;
  var esc = A.esc;
  var KEY = 'dg_acell_desk_v2';
  var panel = document.getElementById('panel-desk');
  var tools = document.getElementById('ac-tools');
  function S() { return window.dgSessions; }
  function M() { return window.dgAcellMusic; }
  function V() { return window.dgVault; }

  var OBJ = {
    dossiers: 'Dossiers', initiative: 'Initiative', dice: 'Dice Roller', notebook: 'Notebook',
    deck: 'Tape deck', pad: 'Quick notes', evidence: 'Evidence box', pads: 'Effect pads'
  };
  var DEFAULT = { cols: [['dossiers', 'initiative', 'dice'], ['notebook'], ['deck', 'pad', 'evidence', 'pads']], w: [290, 320], away: [] };
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  var L = (function () {
    var l = A.store(KEY, null);
    if (!l || !Array.isArray(l.cols) || l.cols.length !== 3) return clone(DEFAULT);
    var seen = {};
    l.cols = l.cols.map(function (c) { return (c || []).filter(function (id) { if (!OBJ[id] || seen[id]) return false; seen[id] = true; return true; }); });
    l.away = (l.away || []).filter(function (id) { return OBJ[id] && !seen[id] && (seen[id] = true); });
    Object.keys(OBJ).forEach(function (id) { if (!seen[id]) l.cols[DEFAULT.cols.findIndex(function (c) { return c.indexOf(id) >= 0; })].push(id); });
    l.w = Array.isArray(l.w) && l.w.length === 2 ? l.w : DEFAULT.w.slice();
    return l;
  })();
  function save() { A.keep(KEY, L); }

  var st = { open: false, arrange: false, built: '', ed: null, edFor: '', scene: null, edit: false, turn: 0, htmlFor: '', jot: '' };

  /* ── Building the desk ── */
  function build() {
    var s = A.session();
    var key = (s ? s.id : '') + '|' + JSON.stringify([L.cols, L.away]) + '|' + st.arrange;
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
    panel.innerHTML = '<div class="pd-desk' + (st.arrange ? ' pd-arranging' : '') + '" style="--pd-l:' + L.w[0] + 'px;--pd-r:' + L.w[1] + 'px">' +
      (st.arrange ? drawerHtml() : '') +
      '<div class="pd-cols">' + L.cols.map(function (c, ci) {
        return '<div class="pd-col pd-c' + ci + '" data-col="' + ci + '">' + c.map(function (id) {
          return '<section class="pd-o pd-' + id + '" data-o="' + id + '">' +
            (st.arrange ? '<div class="pd-oh"><span class="pd-grip" aria-hidden="true">⋮⋮</span>' + esc(OBJ[id]) + '<button type="button" class="pd-x" data-pd="away" aria-label="Put it away">✕</button></div>' : '') +
            '<div class="pd-ob" data-ob="' + id + '"></div></section>';
        }).join('') + (st.arrange ? '<div class="pd-foot" data-foot="' + ci + '">drop here</div>' : '') + '</div>';
      }).join('') + '</div></div>';
    drawAll();
  }
  function drawerHtml() {
    return '<div class="pd-drawer"><span class="pd-dl">Arrange · drag ⋮⋮ onto another object to swap, or onto a column\'s foot to move it</span>' +
      (L.away.length ? '<span class="pd-dl">Put away:</span>' + L.away.map(function (id) { return '<button type="button" class="pd-back" data-pd="back" data-id="' + id + '">+ ' + esc(OBJ[id]) + '</button>'; }).join('') : '') +
      '<label class="pd-dl">Left <input type="range" min="220" max="440" step="10" value="' + L.w[0] + '" data-w="0"></label>' +
      '<label class="pd-dl">Right <input type="range" min="240" max="460" step="10" value="' + L.w[1] + '" data-w="1"></label>' +
      '<button type="button" class="pd-back" data-pd="reset">Reset layout</button></div>';
  }
  function ob(id) { return panel.querySelector('[data-ob="' + id + '"]'); }
  function drawAll() {
    var s = A.session();
    if (!s || !panel.querySelector('.pd-cols')) return;
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
  function drawInitiative(s) {
    var el = ob('initiative');
    if (!el) return;
    var rows = inits(s), turn = rows.length ? st.turn % rows.length : 0;
    el.innerHTML = '<div class="pd-inits">' + rows.map(function (r, i) {
      return '<button type="button" class="pd-ic' + (i === turn ? ' now' : '') + (r.npc != null ? ' npc' : '') + '" data-pd="turn" data-i="' + i + '">' + esc(r.name) + '<b>' + (r.dex == null ? '—' : r.dex) + '</b>' +
        (r.npc != null ? '<span class="pd-icx" data-pd="rm-npc" data-n="' + r.npc + '" aria-label="Remove">✕</span>' : '') + '</button>';
    }).join('') + '<button type="button" class="pd-ic add" data-pd="add-npc" title="Add an NPC">+</button></div>' +
      (rows.length ? '<button type="button" class="pd-next" data-pd="next">Next ▸</button>' : '') +
      (st.npcForm ? '<form class="pd-npcf"><input name="n" placeholder="NPC" required><input name="d" type="number" min="1" max="30" placeholder="DEX" required><button class="ac-btn">Add</button></form>' : '');
    var f = el.querySelector('.pd-npcf');
    if (f) {
      f.n.focus();
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        st.npcForm = false;
        S().update(s.id, { npcs: s.npcs.concat([{ name: f.n.value.trim(), dex: +f.d.value }]) });
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
      s.pads.concat([].concat.apply([], m.stingerGroups().map(function (g) { return g.stingers.map(function (x) { return x.id; }); })))
        .some(function (id) { if (like(m.label('stinger', id))) { hit = id; return true; } return false; });
      if (hit) { m.fire(hit); done = 'fired'; }
    } else if (kind === '♪' && m) {
      var t = s.tracks.filter(function (x) { return like(x.title); })[0];
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
  function playTape(t) {
    var m = M();
    if (t.kind === 'ambient') { m.setAmbient(t.ref, !(m.state().ambient || []).some(function (x) { return x.id === t.ref; })); return; }
    var url = t.kind === 'track' ? (A.trackById(t.ref) || {}).url : t.ref;
    if (url) m.play({ url: url, title: t.title, kind: 'audio', loop: false });
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
      (s.tracks.length ? '<div class="pd-tape">' + s.tracks.map(function (t, i) {
        var on = t.kind === 'ambient' ? amb.some(function (x) { return x.id === t.ref; }) : (cur.track_title === t.title && !!cur.track_url);
        return '<button type="button" class="pd-tt' + (on ? ' on' : '') + '" data-pd="tape" data-i="' + i + '">' + (t.kind === 'ambient' ? '≈ ' : '♪ ') + esc(t.title) + '</button>';
      }).join('') + '</div>' : '<div class="pd-hint light">The session\'s tape is empty (Prep → Music).</div>');
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
    el.innerHTML = '<div class="pd-padgrid">' + s.pads.map(function (id) {
      return '<button type="button" class="pd-fx" data-pd="fire" data-id="' + esc(id) + '">' + esc(m.label('stinger', id)) + '</button>';
    }).join('') + '<button type="button" class="pd-fx stop" data-pd="stopall" title="Stop every effect and loop">STOP</button></div>' +
      (s.pads.length ? '' : '<div class="pd-hint light">No pads yet (Prep → Music → a cartridge).</div>');
  }

  /* ── The Dice Roller: the real panel, open, in its slot ── */
  var dice = { moved: false, opened: false };
  function placeDice() {
    var slot = ob('dice'), p = document.getElementById('dr-panel');
    if (!slot || !p || window.innerWidth <= 720) { if (slot && !p) slot.innerHTML = '<div class="pd-hint light">Dice Roller loading…</div>'; return; }
    if (p.parentNode !== slot) { slot.innerHTML = ''; slot.appendChild(p); }
    dice.moved = true;
    p.classList.add('pd-docked');
    if (p.classList.contains('dr-collapsed') && window.dgDice && window.dgDice._toggle) { window.dgDice._toggle(); dice.opened = true; }
  }
  function releaseDice() {
    var p = document.getElementById('dr-panel');
    if (!p || !dice.moved) return;
    p.classList.remove('pd-docked');
    document.body.appendChild(p);
    if (dice.opened && !p.classList.contains('dr-collapsed') && window.dgDice) window.dgDice._toggle();
    dice.moved = false; dice.opened = false;
  }

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
      case 'rm-npc': e.stopPropagation(); S().update(s.id, { npcs: s.npcs.filter(function (x, i) { return i !== +b.getAttribute('data-n'); }) }); return;
      case 'scene': setScene(b.getAttribute('data-t')); return;
      case 'edit': st.edit = !st.edit; if (st.ed) st.ed.setMode(st.edit ? 'edit' : 'read'); drawNotebook(s); return;
      case 'pick-note': A.setMode('prep'); window.dgAcellTab('session'); return;
      case 'rm-q': S().removeQuickNote(s.id, +b.getAttribute('data-at')); return;
      case 'restart': m.restart(); return;
      case 'pause': m.togglePause(); return;
      case 'stop': m.stop(); return;
      case 'loop': m.toggleLoop(); return;
      case 'tape': playTape(s.tracks[+b.getAttribute('data-i')]); return;
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
        L.cols = L.cols.map(function (c) { return c.filter(function (x) { return x !== oid; }); });
        L.away.push(oid); save(); build(); return;
      }
      case 'back': {
        var bid = b.getAttribute('data-id');
        L.away = L.away.filter(function (x) { return x !== bid; });
        L.cols[DEFAULT.cols.findIndex(function (c) { return c.indexOf(bid) >= 0; })].push(bid);
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
  panel.addEventListener('input', function (e) {
    var w = e.target.getAttribute && e.target.getAttribute('data-w');
    if (w == null) return;
    L.w[+w] = +e.target.value;
    panel.querySelector('.pd-desk').style.setProperty(w === '0' ? '--pd-l' : '--pd-r', e.target.value + 'px');
  });
  panel.addEventListener('change', function (e) { if (e.target.getAttribute && e.target.getAttribute('data-w') != null) save(); });

  var drag = null;
  panel.addEventListener('pointerdown', function (e) {
    var g = e.target.closest('.pd-grip');
    if (!g || !st.arrange) return;
    e.preventDefault();
    drag = { id: g.closest('[data-o]').getAttribute('data-o'), el: g.closest('[data-o]'), over: null };
    drag.el.classList.add('pd-lift');
    try { g.setPointerCapture(e.pointerId); } catch (err) { /* old Safari */ }
  });
  function targetAt(x, y) {
    var hit = null;
    Array.prototype.forEach.call(panel.querySelectorAll('[data-o],[data-foot]'), function (el) {
      var r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && el !== drag.el) hit = el;
    });
    return hit;
  }
  panel.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var over = targetAt(e.clientX, e.clientY);
    if (drag.over && drag.over !== over) drag.over.classList.remove('pd-drop');
    if (over) over.classList.add('pd-drop');
    drag.over = over;
  });
  panel.addEventListener('pointerup', function () {
    if (!drag) return;
    var d = drag; drag = null;
    d.el.classList.remove('pd-lift');
    if (!d.over) return;
    d.over.classList.remove('pd-drop');
    var where = function (id) { for (var c = 0; c < 3; c++) { var i = L.cols[c].indexOf(id); if (i >= 0) return [c, i]; } return null; };
    var from = where(d.id);
    if (d.over.hasAttribute('data-foot')) {
      L.cols[from[0]].splice(from[1], 1);
      L.cols[+d.over.getAttribute('data-foot')].push(d.id);
    } else {
      var to = where(d.over.getAttribute('data-o'));
      L.cols[from[0]][from[1]] = d.over.getAttribute('data-o');
      L.cols[to[0]][to[1]] = d.id;
    }
    save(); build();
  });

  /* ── The top bar's tools, while playing ── */
  function drawTools() {
    tools.innerHTML = st.open ? '<button type="button" data-tool="arrange" class="' + (st.arrange ? 'on' : '') + '">✥ Arrange</button>' +
      '<button type="button" data-tool="prep">☰ Prep</button>' : '';
  }
  tools.addEventListener('click', function (e) {
    var b = e.target.closest('[data-tool]');
    if (!b) return;
    if (b.getAttribute('data-tool') === 'arrange') { st.arrange = !st.arrange; drawTools(); build(); }
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
  ['dg-sessions', 'dg-acell-roster', 'dg-acell-evidence', 'dg-acell-music', 'dg-acell-seen'].forEach(function (ev) {
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
