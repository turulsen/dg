/* A-Cell on a phone, Agents (v3.13.0): the Cell's Agents as the Play
   desk's dossiers, highest DEX first, each with File · Sheet · Bonds ·
   History. The file is their player file in the vault (Players/<name>.md);
   Sheet is the Players tab's read-only paper; "As <player> sees it" and
   Edit sheet open their Agent File (assets/acell-players.js), where
   saving asks what changed and why and can tell the player. */
(function () {
  'use strict';
  var A = window.dgAc, C = window.dgAcm;
  if (!A || !C || window.dgAcmAgents) return;
  var esc = A.esc, I = C.icon, btn = C.btn, lab = C.lab;
  function V() { return window.dgVault; }
  function P() { return window.dgAcPlayers; }

  var pick = { cell: null };
  function cellsWithAgents() { return A.cells().filter(function (c) { return c.member_codes.length; }); }
  function dossier(a, k, on) {
    var rot = [-0.6, 0.5, -0.3, 0.7][k % 4];
    return '<div class="acm-dos" style="--r:' + rot + 'deg"><button type="button" class="acm-doshd" data-acm="agent-tab" data-code="' + esc(a.code) + '" data-tab="file">' + C.photo(a.code) +
      '<span class="acm-g"><b>' + esc(a.name) + '</b><small>' + esc([a.profession, a.player].filter(Boolean).join(' · ')) + '</small></span><span class="acm-dex">DEX ' + (a.dex == null ? '—' : a.dex) + '</span></button>' +
      '<div class="acm-qn">' + [['file', 'File'], ['sheet', 'Sheet'], ['bonds', 'Bonds'], ['history', 'History']].map(function (t) {
        return '<button type="button" class="' + (on === t[0] ? 'on' : '') + '" data-acm="agent-tab" data-code="' + esc(a.code) + '" data-tab="' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</div></div>';
  }
  C.screen('agents', {
    mode: 'prep', tab: 'agents',
    render: function () {
      var s = A.session(), cs = cellsWithAgents();
      if (pick.cell == null) pick.cell = s && s.cell_id ? s.cell_id : (cs[0] ? cs[0].cell_id : '');
      var c = A.cell(pick.cell), ms = (c ? A.members(c.cell_id) : []).slice().sort(function (a, b) { return (b.dex || 0) - (a.dex || 0) || a.name.localeCompare(b.name); });
      return {
        bar: { title: 'Agents', sub: (c ? c.name || c.cell_id : 'No Cell') + ' · by DEX', right: [['search', 'agents-find', 'Find an Agent']] },
        html: '<div class="acm-fold"><div class="acm-chips">' + cs.map(function (x) { return '<button type="button" class="acm-chip' + (x.cell_id === pick.cell ? ' on' : '') + '" data-acm="agents-cell" data-id="' + esc(x.cell_id) + '">' + esc(x.name || x.cell_id) + '</button>'; }).join('') + '</div>' +
          (ms.length ? ms.map(function (a, k) { return dossier(a, k); }).join('') : '<p class="acm-none">' + (c ? 'No Agents in this Cell yet.' : 'No Cells yet.') + '</p>') + '</div>'
      };
    }
  });

  function fileSection(md, title) {
    var r = V().sectionRange(md, title);
    if (!r) return [];
    return md.split('\n').slice(r.from + 1, r.to).filter(function (l) { return l.trim(); });
  }
  C.screen('agent', {
    mode: 'prep', tab: 'agents',
    render: function (arg) {
      var code = typeof arg === 'string' ? arg : arg && arg.code, tab = (arg && arg.tab) || 'file';
      var a = code && A.agent(code);
      if (!a) return { bar: { title: 'Agent', back: true }, html: '<div class="acm-fold"><p class="acm-none">Loading the Agent…</p></div>' };
      var path = A.playerPath(a.name), note = V() && V().get(path), md = note ? note.content || '' : '';
      var body = '';
      if (tab === 'file') {
        body = note ? lab('Handler notes') + list(fileSection(md, 'Handler notes'), 'No notes yet.') + lab('Quick notes from play') + list(fileSection(md, 'Quick notes from play'), 'None yet.') +
          '<form class="acm-form acm-inline" data-form="anote"><input name="t" placeholder="Add a note on ' + esc(a.name.split(' ')[0]) + '…" autocomplete="off"><button class="acm-btn k s">Add</button></form>' +
          btn('Open the whole file', 'open-file', 'w', 'data-path="' + esc(path) + '"')
          : '<p class="acm-none">No player file yet. It keeps your notes on this Agent, the changes you make to their sheet, and the quick notes from play, in your vault.</p>' + btn('Start the player file', 'start-file', 'k w', 'data-code="' + esc(code) + '"');
      } else if (tab === 'bonds') {
        var bonds = ((a.state && a.state.bonds) || []).filter(Boolean);
        body = bonds.length ? '<div class="acm-card">' + bonds.map(function (b) {
          var sc = +b.score || 0;
          return '<div class="acm-row"><span class="acm-g"><b' + (sc <= 0 ? ' class="broken"' : '') + '>' + esc(b.name) + '</b><small>' + esc(b.relationship || '') + '</small></span><span class="acm-score">' + sc + '</span></div>';
        }).join('') + '</div><p class="acm-note">Change a Bond with Edit sheet; during play, on their Agent File.</p>' : '<p class="acm-none">No Bonds yet.</p>';
      } else if (tab === 'history') {
        var played = window.dgSessions.list().filter(function (s) { return s.start && s.start[code]; });
        body = lab('Sheet changes') + list(fileSection(md, 'Sheet changes'), 'No changes logged yet.') +
          lab('Sessions') + (played.length ? '<div class="acm-card">' + played.map(function (s) { var v = s.start[code]; return '<div class="acm-row"><span class="acm-g"><b>' + esc(s.name) + '</b><small>' + esc((s.date || '') + ' · at the start: HP ' + v.hp + ' · WP ' + v.wp + ' · SAN ' + v.san) + '</small></span></div>'; }).join('') + '</div>' : '<p class="acm-none">Not in a played session yet.</p>');
      }
      return {
        bar: { title: a.name, sub: [a.profession, a.player ? 'played by ' + a.player : ''].filter(Boolean).join(' · '), back: true },
        html: '<div class="acm-fold">' + dossier(a, 0, tab) + '<div class="acm-g2 acm-agbtns">' + btn(I('eye') + 'As ' + esc(a.player || 'they') + ' see' + (a.player ? 's' : '') + ' it', 'as-player', '', 'data-code="' + esc(code) + '"') + btn(I('edit') + 'Edit sheet', 'edit-sheet', 'k', 'data-code="' + esc(code) + '"') + '</div>' + body + '</div>',
        after: function (el) {
          var f = el.querySelector('[data-form="anote"]');
          if (!f) return;
          f.addEventListener('submit', function (e) {
            e.preventDefault();
            var t = f.t.value.trim();
            if (!t) return;
            f.t.value = '';
            P().ensureFile(code).then(function (p) { return P().append(p, 'Handler notes', ['- ' + P().stamp(A.session()) + ' · ' + t]); }).then(function () { C.toast('Saved in their file.'); });
          });
        }
      };
    }
  });
  function list(lines, none) {
    return lines.length ? '<div class="acm-card">' + lines.map(function (l) {
      var t = l.replace(/^\s*-\s*/, ''), m = /^(\d{4}-\d\d-\d\d(?: · [^·]+)?) · (.*)$/.exec(t);
      return '<div class="acm-row"><span class="acm-g"><b>' + esc(m ? m[2] : t) + '</b>' + (m ? '<small>' + esc(m[1]) + '</small>' : '') + '</span></div>';
    }).join('') + '</div>' : '<p class="acm-none">' + esc(none) + '</p>';
  }

  var X = C.actions;
  X['agents-cell'] = function (b) { pick.cell = b.getAttribute('data-id'); C.refresh(); };
  X['agents-find'] = function () {
    var all = [];
    A.cells().forEach(function (c) { A.members(c.cell_id).forEach(function (a) { all.push([a, c]); }); });
    var w = C.sheet('<h2 class="acm-h">Find an Agent</h2><input class="acm-in" placeholder="Name, player or code" data-q><div class="acm-card" data-res></div>', { hold: true });
    var q = w.querySelector('[data-q]'), res = w.querySelector('[data-res]');
    function draw() {
      var v = q.value.trim().toLowerCase();
      res.innerHTML = all.filter(function (x) { return !v || (x[0].name + ' ' + x[0].player + ' ' + x[0].code).toLowerCase().indexOf(v) >= 0; }).slice(0, 30).map(function (x) {
        return '<button type="button" class="acm-row" data-code="' + esc(x[0].code) + '">' + C.photo(x[0].code) + '<span class="acm-g"><b>' + esc(x[0].name) + '</b><small>' + esc((x[1].name || x[1].cell_id) + (x[0].player ? ' · ' + x[0].player : '')) + '</small></span></button>';
      }).join('');
    }
    q.addEventListener('input', draw); draw();
    setTimeout(function () { q.focus(); }, 60);
    res.addEventListener('click', function (e) { var b = e.target.closest('[data-code]'); if (b) { w.close(); C.go('agent', { code: b.getAttribute('data-code'), tab: 'file' }); } });
  };
  X['agent-tab'] = function (b) {
    var code = b.getAttribute('data-code'), tab = b.getAttribute('data-tab');
    if (tab === 'sheet') { C.go('agent-sheet', code); return; }
    C.go('agent', { code: code, tab: tab }, { replace: C.current() === 'agent' });
  };
  X['as-player'] = function (b) { P().editSheet(b.getAttribute('data-code'), { view: true, asPlayer: true }); };
  X['edit-sheet'] = function (b) { P().editSheet(b.getAttribute('data-code')); };
  X['start-file'] = function (b) { P().ensureFile(b.getAttribute('data-code')).then(function () { C.refresh(); }); };
  X['open-file'] = function (b) { var p = b.getAttribute('data-path'); C.go('vault'); setTimeout(function () { A.openNote(p); }, 0); };

  window.dgAcmAgents = {};
})();
