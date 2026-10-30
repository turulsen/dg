/* A-Cell on a phone, Play (v3.13.0): Pads · Initiative · (+) · Notes ·
   Dice, and what the add button does during the game. Registers its
   screens with window.dgAcm (assets/acell-mobile.js).

   Initiative: post-its, yellow for Agents, purple for NPCs, highest DEX
   first. An NPC can be hidden (stays in the order, skipped and faded
   until they show up) or taken out (back to Upcoming: the session's NPCs
   not in the order yet). Whose turn it is is kept per session on this
   device (dg_acm_init). NPC numbers change the session and the NPC's
   note in the vault.

   Also here: window.dgAcmCass (the tape, drawn by dgTapes.svg) and the Live
   Rolls feed the Dice tab and the dashboard share (window.dgAcmRolls). */
(function () {
  'use strict';
  var A = window.dgAc, C = window.dgAcm;
  if (!A || !C || window.dgAcmPlay) return;
  var esc = A.esc, I = C.icon, btn = C.btn, sw = C.sw, lab = C.lab;
  function S() { return window.dgSessions; }
  function V() { return window.dgVault; }
  function M() { return window.dgAcellMusic; }
  function T() { return window.dgTapes; }
  function E() { return window.dgAcellEvidence; }
  function R() { return window.dgAcellRoster; }

  /* ── A cassette, drawn to scale (assets/acell-tapes.js) ── */
  function cass(t, opts) { return T() ? T().svg(t, opts) : ''; }
  window.dgAcmCass = cass;

  /* ── Live rolls, as the Dice Roller shows them to the Handler ── */
  var rolls = { list: [], unsub: null, cells: {}, filter: A.store('dg_acm_rollcell', '') };
  function tierColor(t) { return t === 'critical' ? '#ffd700' : t === 'fumble' ? '#ff1744' : t === 'success' ? '#69f0ae' : t === 'failure' ? '#ff6d00' : ''; }
  function summary(r) {
    if (r.roll_type === 'percent') return (r.label || 'Roll') + ': ' + r.value + (r.target ? '/' + r.target : '') + (r.tier ? ' — ' + String(r.tier).toUpperCase() : '');
    if (r.roll_type === 'expr') return (r.label ? r.label + ': ' : '') + r.expr + ' = ' + r.value;
    return (r.label ? r.label + ': ' : '') + r.value;
  }
  function when(t) {
    var ms = t && t.toMillis ? t.toMillis() : +t || 0, s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago';
  }
  function rollRow(r) {
    var c = tierColor(r.tier);
    return '<div class="acm-roll"><b>' + esc(r.agent_name || r.agent_code || '?') + '</b><em>[' + esc(r.cellName || '') + ']</em><span' + (c ? ' style="color:' + c + '"' : '') + '>' + esc(summary(r)) + '</span><em>' + esc(when(r.created_at)) + '</em></div>';
  }
  function startRolls() {
    if (rolls.unsub) return;
    rolls.unsub = true;
    window.dgAcellApi.handler().then(function (f) {
      var db = f.firestore();
      db.collection('cells').get().then(function (snap) { snap.forEach(function (d) { rolls.cells[d.id] = (d.data() || {}).name || d.id; }); });
      rolls.unsub = db.collectionGroup('rolls').orderBy('created_at', 'desc').limit(60).onSnapshot(function (snap) {
        var out = [];
        snap.forEach(function (doc) {
          var d = doc.data() || {}, cid = doc.ref.parent && doc.ref.parent.parent ? doc.ref.parent.parent.id : '';
          d.cellId = cid; d.cellName = rolls.cells[cid] || (cid.indexOf('solo:') === 0 ? 'No Cell' : cid);
          out.push(d);
        });
        rolls.list = out;
        if (C.current() === 'dice' || C.current() === 'session') C.refresh();
      }, function (err) { rolls.err = (err && err.message) || String(err); C.refresh(); });
    }).catch(function (err) { rolls.unsub = null; rolls.err = (err && err.message) || String(err); });
  }
  function shownRolls() { return rolls.list.filter(function (r) { return !rolls.filter || r.cellId === rolls.filter; }); }
  window.dgAcmRolls = { start: startRolls, latest: function (n) { return shownRolls().slice(0, n); }, row: rollRow };

  /* ── What's playable: the tape in the deck, else the session's own ── */
  function deckTape() { var D = T(), t = D && D.inDeck(); return t && t.tracks ? t : null; }
  function tapesFor(s) { var D = T(); return D && s ? D.forOperation(s.operation_id).concat(D.forCell(s.cell_id)) : []; }

  /* ── The console (2026-10-30): Play opens on it. The deck of the dialed
     channel (its cassette, what plays, the transport), the channels, one
     button that puts the session's next tape in, then the pads. ── */
  function playingAt(m) {
    var cur = m.state().current || {}, at = -1;
    if (cur.track_url) m.cueList().forEach(function (c, i) { if (at < 0 && (c.url === cur.track_url || c.title === cur.track_title)) at = i; });
    return at;
  }
  // The compact brown player (2026-10-30), as on the computer's desk: the
  // Music tab's player, lent, with the session's tapes as small cassettes
  // under the channels (tap one: it's in this channel's deck, playing).
  function consoleHtml(s, m) {
    var t = deckTape(), cur = m.state().current || {}, ch = m.channel(), list = tapesFor(s), playing = !!cur.track_url && !cur.paused;
    var tapes = '<div class="pd-cxtapes"><div class="pd-cxl">Tapes · tap one to play it on CH ' + esc(ch) + '</div>' + (list.length ? '<div class="pd-cxrow">' + list.map(function (x) {
      var on = t && t.id === x.id;
      return '<button type="button" class="pd-cxt' + (on ? ' on' : '') + '" data-acm="' + (on ? 'deck' : 'tape-in') + '" data-id="' + esc(x.id) + '">' + cass(x, { spin: on && playing }) + '<span>' + esc(x.name) + (on ? '<em>in the deck</em>' : '') + '</span></button>';
    }).join('') + '</div>' : '<div class="pd-cxl">No tapes for this session yet (the Music tab).</div>') + '</div>';
    return '<div class="acm-cxbox">' + tapes + '<div class="pd-cxhost acm-cxhost"></div></div>';
  }

  /* ── Pads ── */
  C.screen('pads', {
    mode: 'play', tab: 'pads',
    // Redrawn only when what it shows changes; the player keeps itself live.
    sig: function () {
      var s = A.session(), m = M(), t = deckTape();
      if (!m) return '';
      return (s ? s.id + s.pads.join() : '') + '|' + (t ? t.id + t.pads.join() + t.loops.join() : '') + '|' + tapesFor(s).map(function (x) { return x.id + x.name + x.color; }).join() + '|' + m.channel() + '|' +
        (m.state().ambient || []).map(function (x) { return x.id || x; }).join() + '|' + !!(m.state().current || {}).track_url + !!(m.state().current || {}).paused;
    },
    render: function () {
      var s = A.session(), m = M();
      if (!m) return { bar: { title: 'Pads' }, html: '<p class="acm-none">The broadcast isn\'t available.</p>' };
      var t = deckTape(), mine = t ? t.pads : (s ? s.pads : []), cur = m.state().current || {}, amb = (m.state().ambient || []).map(function (x) { return x.id || x; });
      var seen = {};
      mine.forEach(function (id) { seen[id] = true; });
      function pad(id, on) { return '<button type="button" class="acm-pad' + (on ? ' on' : '') + '" data-acm="fire" data-id="' + esc(id) + '">' + esc(m.label('stinger', id)) + '</button>'; }
      var loops = (t ? t.loops : []).concat(m.ambientList().map(function (x) { return x.id; }).filter(function (id) { return !t || t.loops.indexOf(id) < 0; }));
      return {
        bar: { title: 'Pads', sub: (t ? t.name + ' · ' : '') + 'CH ' + m.channel() + (cur.track_title ? ' · ' + cur.track_title : ''), back: false, right: [['back', 'to-prep', 'Back to Prep'], ['tape', 'deck', 'The tape deck']] },
        html: '<div class="acm-desk">' + consoleHtml(s, m) + (mine.length ? lab((t ? 'This tape' : 'This session') + ' · ' + mine.length + ' pad' + (mine.length === 1 ? '' : 's')) + '<div class="acm-pads">' + mine.map(function (id) { return pad(id); }).join('') + '</div>' : '<p class="acm-none light">No pads on the tape yet. Every effect is below.</p>') +
          '<div class="acm-stoprow">' + btn('Stop all sound', 'stopall', 'sr') + '</div>' +
          lab('Loops') + '<div class="acm-chips">' + loops.map(function (id) { return '<button type="button" class="acm-chip loop' + (amb.indexOf(id) >= 0 ? ' on' : '') + '" data-acm="loop" data-id="' + esc(id) + '">' + esc(m.label('ambient', id)) + '</button>'; }).join('') + '</div>' +
          m.stingerGroups().map(function (g) {
            var ids = (g.stingers || []).map(function (x) { return x.id; }).filter(function (id) { return !seen[id]; });
            return ids.length ? lab(g.label || g.name || 'Effects') + '<div class="acm-pads sm">' + ids.map(function (id) { return pad(id); }).join('') + '</div>' : '';
          }).join('') + '</div>',
        after: function (el) {
          var P = window.dgAcConsole;
          if (!P || !P.attach) return null;
          P.attach(el.querySelector('.acm-cxhost'), 'desk');
          return function () { P.detach(); };
        }
      };
    }
  });

  /* ── Initiative ── */
  function turnState(s) { var all = A.store('dg_acm_init', {}); return all[s.id] || { turn: 0, round: 1 }; }
  function saveTurn(s, v) { var all = A.store('dg_acm_init', {}); all[s.id] = v; A.keep('dg_acm_init', all); }
  function order(s) {
    var rows = A.members(s.cell_id).filter(function (a) { return s.away.indexOf(a.code) < 0 && !(a.hp != null && a.hp <= 0); }).map(function (a) { return { agent: a, dex: a.dex || 0 }; });
    s.npcs.forEach(function (n, i) { if (n.init !== false) rows.push({ npc: n, i: i, dex: +n.dex || 0 }); });
    return rows.sort(function (a, b) { return b.dex - a.dex || (a.npc ? 1 : 0) - (b.npc ? 1 : 0); });
  }
  function live(rows) { return rows.filter(function (r) { return !(r.npc && r.npc.hidden); }); }
  function vit(k, v, i) { return '<span class="acm-v"><button type="button" data-acm="npcv" data-i="' + i + '" data-k="' + k + '" data-d="-1" aria-label="' + k + ' down">−</button><em>' + k.toUpperCase() + '</em><strong>' + (v == null || v === '' ? '—' : v) + '</strong><button type="button" data-acm="npcv" data-i="' + i + '" data-k="' + k + '" data-d="1" aria-label="' + k + ' up">+</button></span>'; }
  C.screen('initiative', {
    mode: 'play', tab: 'initiative',
    render: function () {
      var s = A.session();
      if (!s) return { bar: { title: 'Initiative' }, html: '<p class="acm-none light">Choose a session first.</p>' };
      var rows = order(s), lv = live(rows), ts = turnState(s), now = lv.length ? lv[ts.turn % lv.length] : null;
      var rot = [-0.6, 0.5, -0.3, 0.4, -0.5, 0.6, -0.2];
      var up = s.npcs.map(function (n, i) { return { n: n, i: i }; }).filter(function (x) { return x.n.init === false; });
      return {
        bar: { title: 'Initiative · round ' + ts.round, sub: 'Tap a post-it for the Agent or NPC', right: [['back', 'to-prep', 'Back to Prep']] },
        html: '<div class="acm-desk"><div class="acm-g3 acm-initbar">' + btn('Next turn', 'next-turn', 'cream') + btn('New round', 'new-round', 'dark') + btn(I('add') + 'NPC', 'new-npc-init', 'dark') + '</div>' +
          (rows.length ? rows.map(function (r, k) {
            var on = r === now, cls = r.npc ? 'c-pu' : 'c-y';
            if (r.agent) {
              var a = r.agent;
              return '<div class="acm-ip ' + cls + (on ? ' now' : '') + '" style="--r:' + rot[k % rot.length] + 'deg" data-acm="agent-read" data-code="' + esc(a.code) + '"><span class="d">' + (a.dex == null ? '—' : a.dex) + '</span><span class="acm-g"><b>' + esc(a.name) + '</b><small>' + A.vitalsHtml(a, true) + '</small></span></div>';
            }
            var n = r.npc;
            return '<div class="acm-ip ' + cls + (on ? ' now' : '') + (n.hidden ? ' hid' : '') + '" style="--r:' + rot[k % rot.length] + 'deg"><span class="d">' + (n.dex || '—') + '</span><span class="acm-g"><b data-acm="npc-open" data-i="' + r.i + '">' + esc(n.name) + (n.hidden ? ' <i>hidden</i>' : '') + '</b><span class="acm-vit">' + vit('hp', n.hp, r.i) + vit('wp', n.wp, r.i) + (n.san != null && n.san !== '' ? vit('san', n.san, r.i) : '') + '</span></span>' +
              '<span class="acm-xs"><button type="button" data-acm="npc-hide" data-i="' + r.i + '" aria-label="' + (n.hidden ? 'Show' : 'Hide') + '">' + I(n.hidden ? 'eye' : 'hide', 's') + '</button><button type="button" data-acm="npc-out" data-i="' + r.i + '" aria-label="Take out of the order">' + I('close', 's') + '</button></span></div>';
          }).join('') : '<p class="acm-none light">No one in the order yet.</p>') +
          (up.length ? lab('Upcoming · in this session, not in the order yet') + '<div class="acm-chips">' + up.map(function (x) { return '<button type="button" class="acm-chip c-pu" data-acm="npc-in" data-i="' + x.i + '">+ ' + esc(x.n.name) + ' · ' + (x.n.dex || '—') + '</button>'; }).join('') + '</div>' : '') + '</div>'
      };
    }
  });
  var npcSave = {};
  function setNpc(s, i, patch) {
    var list = s.npcs.map(function (x) { return Object.assign({}, x); });
    if (!list[i]) return;
    Object.assign(list[i], patch);
    S().update(s.id, { npcs: list });
    var n = list[i];
    if (n.path && ('hp' in patch || 'wp' in patch || 'san' in patch || 'dex' in patch)) {
      clearTimeout(npcSave[n.path]);
      npcSave[n.path] = setTimeout(function () { C.npcNote(n, s).catch(function () {}); }, 1200);
    }
  }
  function npcSheet(s, i) {
    var n = s.npcs[i];
    if (!n) return;
    var w = C.sheet('<h2 class="acm-h">' + esc(n.name) + '</h2>' + ['hp', 'wp', 'san', 'dex'].map(function (k) {
      return '<div class="acm-step"><b>' + k.toUpperCase() + '</b><span><button type="button" data-sv="' + k + '" data-d="-1">−</button><strong data-v="' + k + '">' + (n[k] == null || n[k] === '' ? '—' : n[k]) + '</strong><button type="button" data-sv="' + k + '" data-d="1">+</button></span></div>';
    }).join('') + '<div class="acm-g3">' + (n.path ? '<button type="button" class="acm-btn" data-sx="note">Note</button>' : '<span></span>') + '<button type="button" class="acm-btn" data-sx="hide">' + (n.hidden ? 'Show' : 'Hide') + '</button><button type="button" class="acm-btn red" data-sx="rm">Remove</button></div>');
    w.addEventListener('click', function (e) {
      var b = e.target.closest('[data-sv]'), s2 = A.session(), cur = s2 && s2.npcs[i];
      if (b && cur) {
        var k = b.getAttribute('data-sv'), v = Math.max(0, Math.min(99, (+cur[k] || 0) + +b.getAttribute('data-d')));
        var p = {}; p[k] = v; setNpc(s2, i, p);
        w.querySelector('[data-v="' + k + '"]').textContent = v;
        return;
      }
      var x = e.target.closest('[data-sx]');
      if (!x || !cur) return;
      var a = x.getAttribute('data-sx');
      w.close();
      if (a === 'note') { C.go('vault'); setTimeout(function () { A.openNote(cur.path); }, 0); }
      else if (a === 'hide') setNpc(s2, i, { hidden: !cur.hidden });
      else if (a === 'rm') S().update(s2.id, { npcs: s2.npcs.filter(function (z, k2) { return k2 !== i; }) });
    });
  }

  /* ── An Agent, read only: the Players tab's paper ── */
  C.screen('agent-sheet', {
    panel: 'play', tab: 'initiative',
    render: function (code) {
      var a = code && A.agent(code);
      return { bar: { title: a ? a.name : 'Agent', sub: a ? [a.profession, a.dex != null ? 'DEX ' + a.dex : ''].filter(Boolean).join(' · ') : '', back: true, right: [['edit', 'agent-note:' + (code || ''), 'Add a note']] } };
    },
    after: function (code) {
      if (!code || !R()) return;
      var tries = 0;
      (function open() { if (!R().open(code) && ++tries < 20) setTimeout(open, 300); })();
    }
  });

  /* ── The notebook: a tab per note the session keeps (2026-10-30), and
     in a vault note a tab per scene ── */
  var nb = { scene: null, edit: false, note: null, sid: '' };
  function nbNote(s, list) {
    if (nb.sid !== s.id) { nb.sid = s.id; nb.note = null; nb.scene = null; }
    if (nb.note == null) nb.note = +((A.store('dg_acm_nbnote', {}))[s.id] || 0);
    if (!(nb.note < list.length)) nb.note = 0;
    return list[nb.note];
  }
  C.screen('notebook', {
    mode: 'play', tab: 'notebook',
    // Redrawn when the notes, the open one, or (in a vault note) its scenes change.
    sig: function () {
      var s = A.session();
      if (!s) return '';
      var list = window.dgSessions.notesOf(s), n = list[nb.note || 0];
      return s.id + JSON.stringify(list) + nb.note + nb.edit + nb.scene + (n && n.kind === 'vault' ? V().headings(((V().get(n.path)) || {}).content || '', 2).map(function (h) { return h.title; }).join('|') : '') +
        (n && n.kind === 'html' ? ((window.dgSessionNotes && window.dgSessionNotes.notes()) || []).length : '');
    },
    render: function () {
      var s = A.session();
      if (!s) return { bar: { title: 'Notes' }, html: '<p class="acm-none light">Choose a session first.</p>' };
      var list = window.dgSessions.notesOf(s), n = list.length ? nbNote(s, list) : null, vault = n && n.kind === 'vault';
      var bar = { title: s.name, sub: vault ? (nb.edit ? 'Editing · saves itself' : 'Reading · tap a cue to fire it') : n ? (n.kind === 'gdoc' ? 'Google Doc · read-only' : 'Uploaded HTML page') : '', right: (vault ? [[nb.edit ? 'check' : 'edit', 'nb-edit', nb.edit ? 'Done' : 'Edit']] : []).concat([['back', 'to-prep', 'Back to Prep']]) };
      if (!n) return { bar: bar, html: '<div class="acm-fold"><p class="acm-none">No notes for this session. Add them in Prep, under Notes.</p></div>' };
      var tabs = list.length > 1 ? '<div class="acm-chips acm-scenetabs acm-notetabs">' + list.map(function (x, i) {
        var t = x.kind === 'vault' ? V().title(x.path) : x.kind === 'gdoc' ? (x.title || 'Google Doc') : ((((window.dgSessionNotes && window.dgSessionNotes.notes()) || []).filter(function (h) { return h.id === x.id; })[0] || {}).title || 'HTML page');
        return '<button type="button" class="acm-chip' + (i === nb.note ? ' on' : '') + '" data-acm="nb-note" data-i="' + i + '">' + esc(t) + '</button>';
      }).join('') + '</div>' : '';
      if (n.kind === 'html') return { bar: bar, html: '<div class="acm-fold">' + tabs + '<div class="acm-htmlnote"></div></div>', after: function (el) { var h = el.querySelector('.acm-htmlnote'); if (window.dgSessionNotes) window.dgSessionNotes.load().then(function () { if (!window.dgSessionNotes.open(n.id, n.lang, h)) h.innerHTML = '<p class="acm-none">That HTML page is gone.</p>'; }); } };
      if (n.kind === 'gdoc') {
        var src = window.dgSessions.gdocEmbed(n.url);
        return { bar: bar, html: '<div class="acm-fold">' + tabs + '<div class="acm-gdoc"><div class="acm-gdoc-hd"><span>' + esc(n.title || 'Google Doc') + '</span><a class="acm-btn s" href="' + esc(n.url) + '" target="_blank" rel="noopener">Open in Google Docs</a></div>' +
          (src ? '<iframe src="' + esc(src) + '" title="' + esc(n.title || 'Google Doc') + '" loading="lazy"></iframe>' : '<p class="acm-none" style="padding:12px">This link can\'t be shown here; open it in Google Docs.</p>') + '</div></div>' };
      }
      var md = ((V().get(n.path)) || {}).content || '', hs = V().headings(md, 2);
      if (nb.scene == null) nb.scene = (A.store('dg_acell_scene', {})[s.id + '|' + n.path]) || (hs[0] ? hs[0].title : '*');
      if (nb.scene !== '*' && !hs.some(function (h) { return h.title === nb.scene; })) nb.scene = hs[0] ? hs[0].title : '*';
      return {
        bar: bar,
        html: '<div class="acm-fold">' + tabs + '<div class="acm-chips acm-scenetabs">' + hs.map(function (h) { return '<button type="button" class="acm-chip' + (nb.scene === h.title ? ' on' : '') + '" data-acm="nb-scene" data-t="' + esc(h.title) + '">' + esc(h.title) + '</button>'; }).join('') +
          '<button type="button" class="acm-chip' + (nb.scene === '*' ? ' on' : '') + '" data-acm="nb-scene" data-t="*">Whole note</button></div><div class="acm-ed acm-paperpage"></div></div>',
        after: function (el) {
          var ed = V().editor(el.querySelector('.acm-ed'), n.path, {
            hideHead: true, mode: nb.edit ? 'edit' : 'read', grow: true, scene: nb.scene === '*' ? null : { title: nb.scene },
            emptyText: 'Nothing in this scene yet.', onLink: function (p) { C.go('vault'); setTimeout(function () { A.openNote(p); }, 0); },
            onCue: function (text, cel) { if (window.dgAcPlay) window.dgAcPlay.cue(text, cel); }
          });
          return function () { ed.destroy(); };
        }
      };
    }
  });

  /* ── Dice ── */
  C.screen('dice', {
    mode: 'play', tab: 'dice',
    render: function () {
      startRolls();
      var names = {};
      A.cells().forEach(function (c) { names[c.cell_id] = c.name || c.cell_id; });
      return {
        bar: { title: 'Dice', sub: 'Live rolls', right: [['back', 'to-prep', 'Back to Prep']] },
        html: '<div class="acm-desk"><div class="acm-drp"><div class="acm-drh">DICE ROLLER</div><div class="acm-drb"><select class="acm-drsel" data-acm-rollcell aria-label="Which Cells’ rolls"><option value="">Live rolls: all Cells</option>' +
          A.cells().map(function (c) { return '<option value="' + esc(c.cell_id) + '"' + (rolls.filter === c.cell_id ? ' selected' : '') + '>Live rolls: ' + esc(c.name || c.cell_id) + '</option>'; }).join('') + '</select>' +
          (rolls.err ? '<div class="acm-roll"><span>' + esc(rolls.err) + '</span></div>' : '') +
          (shownRolls().length ? shownRolls().slice(0, 30).map(rollRow).join('') : '<div class="acm-roll empty">No rolls yet.</div>') + '</div></div></div>',
        after: function (el) {
          var sel = el.querySelector('[data-acm-rollcell]');
          sel.addEventListener('change', function () { rolls.filter = sel.value; A.keep('dg_acm_rollcell', sel.value); C.refresh(); });
        }
      };
    }
  });

  /* ── Quick notes ── */
  var qn = { who: '' };
  C.screen('quick', {
    mode: 'play', tab: 'notebook',
    render: function () {
      var s = A.session();
      if (!s) return { bar: { title: 'Quick notes', back: true }, html: '' };
      var names = {};
      A.members(s.cell_id).forEach(function (a) { names[a.code] = a.name.split(' ').pop(); });
      return {
        bar: { title: 'Quick notes', sub: 'They go into the debrief', back: true },
        html: '<div class="acm-fold">' + s.quick_notes.slice(-20).map(function (q, k) {
          return '<div class="acm-sticky" style="--r:' + (k % 2 ? 0.7 : -0.6) + 'deg">' + esc(q.text) + '<small>' + esc((q.code ? names[q.code] || q.code : 'session') + ' · ' + new Date(q.at).toTimeString().slice(0, 5)) + '</small><button type="button" data-acm="rm-q" data-at="' + q.at + '" aria-label="Remove">' + I('close', 's') + '</button></div>';
        }).join('') + quickForm(s) + '</div>',
        after: function (el) { wireQuick(el, s); }
      };
    }
  });
  function quickForm(s) {
    return '<form class="acm-form acm-qform"><input name="t" placeholder="Jot a quick note… (Enter)" autocomplete="off"><div class="acm-chips acm-who">' +
      A.members(s.cell_id).map(function (a) { return '<button type="button" class="acm-chip' + (qn.who === a.code ? ' on' : '') + '" data-who="' + esc(a.code) + '">' + esc(a.name.split(' ').pop()) + '</button>'; }).join('') +
      '<button type="button" class="acm-chip' + (!qn.who ? ' on' : '') + '" data-who="">Session</button></div></form>';
  }
  function wireQuick(el, s, done) {
    var f = el.querySelector('.acm-qform');
    f.addEventListener('click', function (e) {
      var b = e.target.closest('[data-who]');
      if (!b) return;
      qn.who = b.getAttribute('data-who');
      Array.prototype.forEach.call(f.querySelectorAll('[data-who]'), function (x) { x.classList.toggle('on', x === b); });
    });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var t = f.t.value.trim();
      if (!t) return;
      f.t.value = '';
      S().addQuickNote(s.id, t, qn.who).then(function () { if (done) done(); });
    });
  }

  /* ── The tape deck ── */
  function deckSheet() {
    var m = M(), D = T(), s = A.session();
    if (!m || !D) return;
    var t = deckTape(), cur = m.state().current || {}, cues = m.cueList();
    var at = -1;
    cues.forEach(function (c, i) { if (c.title === cur.track_title && cur.track_url) at = i; });
    var html = '<div class="acm-lab">In the deck · CH ' + esc(m.channel()) + '</div>';
    if (t) {
      html += '<div class="acm-deckcas">' + cass(t, { spin: !!cur.track_url && !cur.paused }) + '</div><div class="acm-card">' + t.tracks.map(function (x, i) {
        return '<button type="button" class="acm-row' + (i === at ? ' on' : '') + '" data-dk="cue" data-i="' + i + '"><b class="n">' + (i + 1) + '</b><span class="acm-g"><b>' + esc(x.title) + '</b><small>' + (i === at ? 'playing' : '') + '</small></span><span class="acm-note">' + esc(D.fmt(x.dur)) + '</span></button>';
      }).join('') + '</div>';
    } else {
      var list = tapesFor(s);
      html += list.length ? '<div class="acm-card">' + list.map(function (x) { return '<button type="button" class="acm-row" data-dk="insert" data-id="' + esc(x.id) + '"><span class="acm-g"><b>' + esc(x.name) + '</b><small>' + esc(D.fmt(D.runtime(x))) + '</small></span>' + I('play') + '</button>'; }).join('') + '</div>' : '<p class="acm-none">No tapes for this session yet.</p>';
    }
    html += '<div class="acm-transport">' + [['prev', 'prev', 'From the top'], [cur.paused || !cur.track_url ? 'play' : 'pause', 'pause', 'Play or pause'], ['stop', 'stop', 'Stop'], ['next', 'next', 'Next track'], ['loop', 'loop', 'Loop']].map(function (b) {
      return '<button type="button" class="' + (b[1] === 'loop' && cur.loop ? 'on' : '') + '" data-dk="' + b[1] + '" aria-label="' + b[2] + '">' + I(b[0]) + '</button>';
    }).join('') + '</div><div class="acm-deckfoot"><span class="acm-note">' + (cur.loop ? 'Loop on: the track repeats' : 'Loop off: the tape plays on') + '</span>' + (t ? '<button type="button" class="acm-btn s" data-dk="eject">' + I('eject', 's') + 'Take tape out</button>' : '') + '</div>';
    var w = C.sheet(html, { cls: 'acm-decksheet' });
    w.addEventListener('click', function (e) {
      var b = e.target.closest('[data-dk]');
      if (!b) return;
      var k = b.getAttribute('data-dk'), m2 = M(), cur2 = m2.state().current || {};
      if (k === 'cue') m2.playCue(+b.getAttribute('data-i'));
      else if (k === 'insert') D.insert(b.getAttribute('data-id'));
      else if (k === 'prev') m2.restart();
      else if (k === 'pause') { if (cur2.track_url) m2.togglePause(); else m2.playCue(0); }
      else if (k === 'stop') m2.stop();
      else if (k === 'next') { var c2 = m2.cueList(); m2.playCue(c2.length ? (at + 1) % c2.length : 0); }
      else if (k === 'loop') m2.toggleLoop();
      else if (k === 'eject') D.eject();
      w.close();
      setTimeout(deckSheet, 250);
    });
  }

  /* ── Clicks ── */
  var X = C.actions;
  X['to-prep'] = function () { C.setMode('prep'); };
  X.deck = function () { deckSheet(); };
  X.fire = function (b) { M().fire(b.getAttribute('data-id')); b.classList.add('on'); setTimeout(function () { b.classList.remove('on'); }, 900); };
  X.loop = function (b) { var on = !b.classList.contains('on'); b.classList.toggle('on', on); M().setAmbient(b.getAttribute('data-id'), on); };
  X.stopall = function () { M().stopAll(); C.toast('Every effect and loop stopped.'); };
  X['cx-ch'] = function (b) { var m = M(); if (m) m.setChannel(b.getAttribute('data-ch')); C.refresh(); };
  X['cx'] = function (b) {
    var m = M(), k = b.getAttribute('data-k'), cur = m.state().current || {}, cues = m.cueList();
    if (k === 'prev') m.restart();
    else if (k === 'pause') { if (cur.track_url) m.togglePause(); else if (cues.length) m.playCue(0); else deckSheet(); }
    else if (k === 'stop') m.stop();
    else if (k === 'next') { if (cues.length) m.playCue((playingAt(m) + 1) % cues.length); }
    else if (k === 'loop') m.toggleLoop();
  };
  X['tape-in'] = function (b) {
    var id = b.getAttribute('data-id'), t = T().get(id);
    T().insert(id).then(function () { C.toast((t ? t.name : 'The tape') + ' is in CH ' + M().channel() + '.'); C.refresh(); });
  };
  X['tape-toggle'] = function () { var m = M(), cur = m.state().current || {}; if (cur.track_url) m.togglePause(); else if (m.cueList().length) m.playCue(0); else deckSheet(); };
  X['next-turn'] = function () { var s = A.session(), ts = turnState(s), n = live(order(s)).length; if (!n) return; ts.turn = (ts.turn + 1) % n; if (ts.turn === 0) ts.round++; saveTurn(s, ts); C.refresh(); };
  X['new-round'] = function () { var s = A.session(); saveTurn(s, { turn: 0, round: turnState(s).round + 1 }); C.refresh(); };
  X['new-npc-init'] = function () { C.npcSheet(); };
  X['agent-read'] = function (b) { C.go('agent-sheet', b.getAttribute('data-code')); };
  X['npc-open'] = function (b) { npcSheet(A.session(), +b.getAttribute('data-i')); };
  X.npcv = function (b, e) { e.stopPropagation(); var s = A.session(), i = +b.getAttribute('data-i'), k = b.getAttribute('data-k'), n = s.npcs[i]; if (!n) return; var p = {}; p[k] = Math.max(0, Math.min(99, (+n[k] || 0) + +b.getAttribute('data-d'))); setNpc(s, i, p); };
  X['npc-hide'] = function (b) { var s = A.session(), i = +b.getAttribute('data-i'); setNpc(s, i, { hidden: !s.npcs[i].hidden }); };
  X['npc-out'] = function (b) { var s = A.session(); setNpc(s, +b.getAttribute('data-i'), { init: false, hidden: false }); };
  X['npc-in'] = function (b) { var s = A.session(); setNpc(s, +b.getAttribute('data-i'), { init: true }); };
  X['nb-scene'] = function (b) {
    var s = A.session(), n = window.dgSessions.notesOf(s)[nb.note || 0];
    nb.scene = b.getAttribute('data-t');
    var memo = A.store('dg_acell_scene', {}); memo[s.id + '|' + (n ? n.path : '')] = nb.scene; A.keep('dg_acell_scene', memo);
    C.go('notebook', nb.scene, { replace: true });
  };
  X['nb-note'] = function (b) {
    var s = A.session();
    nb.note = +b.getAttribute('data-i'); nb.scene = null; nb.edit = false;
    var memo = A.store('dg_acm_nbnote', {}); memo[s.id] = nb.note; A.keep('dg_acm_nbnote', memo);
    C.go('notebook', 'n' + nb.note, { replace: true });
  };
  X['nb-edit'] = function () { nb.edit = !nb.edit; C.go('notebook', (nb.edit ? 'e' : 'r') + nb.scene, { replace: true }); };
  X['rm-q'] = function (b) { S().removeQuickNote(A.session().id, +b.getAttribute('data-at')); };
  // The app bar's right-hand buttons carry their argument after a colon.
  var _click = function (e) {
    var b = e.target.closest('[data-acm^="agent-note:"]');
    if (b) { C.agentNoteSheet(b.getAttribute('data-acm').split(':')[1]); e.stopPropagation(); }
  };
  document.addEventListener('click', _click, true);

  /* ── The add button, during the game ── */
  C.add.qnote = function () {
    var s = A.session();
    if (!s) return;
    var w = C.sheet('<h2 class="acm-h">Quick note</h2>' + quickForm(s) + '<p class="acm-note">Goes into the debrief; on an Agent, into their file after.</p>', { hold: true });
    wireQuick(w, s, function () { w.close(); C.toast('Noted.'); });
    setTimeout(function () { var i = w.querySelector('input'); if (i) i.focus(); }, 60);
  };
  C.add.qev = function () {
    var s = A.session();
    C.go('evidence');
    setTimeout(function () { if (E()) E().newItem(s ? { cell_id: s.cell_id, operation_id: s.operation_id } : null); }, 80);
  };
  // Release evidence (2026-10-30): the session's evidence first, then the
  // Cell's other unreleased items, each with its switch.
  C.add.rel = function () {
    var s = A.session();
    if (!E()) return;
    E().start();
    var w = C.sheet('<h2 class="acm-h">Release evidence</h2><div data-rel></div>');
    function draw() {
      var box = w.querySelector('[data-rel]');
      if (!box) return;
      var items = E().items(), inS = s ? s.evidence : [];
      function row(h) { return '<div class="acm-row"><span class="acm-g"><b>' + esc(h.title || 'Untitled') + '</b><small>' + (h.released ? 'released' : 'not released') + '</small></span>' + sw(h.released, 'data-acm="release" data-id="' + esc(h.evidence_id) + '"') + '</div>'; }
      var mine = inS.map(function (id) { return E().find(id); }).filter(Boolean);
      var more = items.filter(function (h) { return !h.released && inS.indexOf(h.evidence_id) < 0 && (!s || !s.cell_id || h.cell_id === s.cell_id); });
      box.innerHTML = (mine.length ? lab('In this session') + '<div class="acm-card">' + mine.map(row).join('') + '</div>' : '') +
        (more.length ? lab('The Cell\'s, not released yet') + '<div class="acm-card">' + more.map(row).join('') + '</div>' : '') +
        (mine.length || more.length ? '' : '<p class="acm-none">' + (items.length ? 'Nothing left to release.' : 'Loading the evidence…') + '</p>');
    }
    draw();
    function again() { if (!w.isConnected) { document.removeEventListener('dg-acell-evidence', again); return; } draw(); }
    document.addEventListener('dg-acell-evidence', again);
  };
  C.add.agent = function () {
    var s = A.session(), ms = C.agentsByDex(s);
    var w = C.sheet('<h2 class="acm-h">Which Agent?</h2><div class="acm-faces">' + ms.map(function (a) { return '<button type="button" class="acm-face" data-code="' + esc(a.code) + '">' + C.photo(a.code) + '<span>' + esc(a.name.split(' ').pop()) + '</span></button>'; }).join('') + '</div>');
    w.addEventListener('click', function (e) { var b = e.target.closest('[data-code]'); if (b) { w.close(); C.go('agent-sheet', b.getAttribute('data-code')); } });
  };

  window.dgAcmPlay = { deck: deckSheet, cass: cass };
})();
