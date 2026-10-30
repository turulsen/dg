/* A-Cell on a phone (v3.13.0): the Field kit layout. Below 761px wide
   A-Cell gets its own frame -- an app bar on top, a tab bar at the thumb
   and one round add button -- instead of the folder and its index tabs.

     PREP   Session · Agents · (+) · Evidence · More
     PLAY   Pads · Initiative · (+) · Notes · Dice

   Screens drawn here (and in acell-mobile-play.js / -agents.js, which
   register through window.dgAcm.screen) sit in #acm-view; the rest are
   the desktop's own tab panels, shown full-screen in the same frame
   (Evidence, Music, Notes, Sheet, Cells, ID creator, Debrief), so every
   function the computer has is here too.

   This file: the frame, the More and Sessions sheets, the add sheet's
   post-its, the Session dashboard (blocks the Handler picks and orders,
   kept per device in dg_acm_dash), new / duplicate / template sessions,
   the session desk (its scenes are the ## headings of the session note)
   and an operation's vault folder (made once, operations/{id}.vault_folder
   remembers it, so moving the files afterwards is safe).

   window.dgAcm = { go(name, arg), back(), screen(name, def), sheet(html, opts),
     closeSheets(), refresh(), mode(), on(), icon(name, cls), photo(code),
     agentsByDex(s), opOf(s), npcNote(npc, s), toast(text), enable() } */
(function () {
  'use strict';
  var A = window.dgAc;
  if (!A || window.dgAcm) return;
  var esc = A.esc;
  var MQ = window.matchMedia('(max-width: 760px)');
  function I(n, c) { return window.dgIcons ? window.dgIcons.svg(n, c) : ''; }
  function S() { return window.dgSessions; }
  function V() { return window.dgVault; }
  function M() { return window.dgAcellMusic; }
  function E() { return window.dgAcellEvidence; }
  function T() { return window.dgTapes; }
  function R() { return window.dgAcellRoster; }

  /* ── The frame ── */
  var root = document.createElement('div');
  root.id = 'acm';
  root.innerHTML = '<header class="acm-bar" id="acm-bar"></header><main class="acm-view" id="acm-view"></main>' +
    '<nav class="acm-tabs" id="acm-tabs" aria-label="Sections"></nav>' +
    '<button type="button" class="acm-fab" id="acm-fab" aria-label="Add">' + I('add') + '</button><div id="acm-layer"></div><div class="acm-toast" id="acm-toast" hidden></div>';
  var barEl = root.querySelector('#acm-bar'), view = root.querySelector('#acm-view'), tabsEl = root.querySelector('#acm-tabs'),
    fab = root.querySelector('#acm-fab'), layer = root.querySelector('#acm-layer'), toastEl = root.querySelector('#acm-toast');

  var SCREENS = {};
  var st = { on: false, mode: 'prep', name: '', arg: null, hist: [], drawn: '' };
  function screen(name, def) { SCREENS[name] = def; }

  var TABS = {
    prep: [['session', 'Session', 'session'], ['agents', 'Agents', 'agents'], null, ['evidence', 'Evidence', 'evidence'], ['more', 'More', '@more']],
    play: [['pads', 'Pads', 'pads'], ['initiative', 'Initiative', 'initiative'], null, ['notes', 'Notes', 'notebook'], ['dice', 'Dice', 'dice']]
  };
  function drawTabs() {
    var def = SCREENS[st.name] || {}, cur = def.tab || st.name;
    var set = TABS[st.mode === 'play' ? 'play' : 'prep'];
    tabsEl.innerHTML = set.map(function (t) {
      if (!t) return '<span class="acm-tgap" aria-hidden="true"></span>';
      return '<button type="button" class="acm-tab' + (cur === t[2] || cur === t[0] ? ' on' : '') + '" data-acm-go="' + t[2] + '">' + I(t[0]) + '<span>' + t[1] + '</span></button>';
    }).join('');
  }
  // The app bar: { title, sub, back: true | route, right: [[icon, action, label]] }
  function drawBar(b) {
    b = b || {};
    var left = b.back ? '<button type="button" class="acm-ib" data-acm="back" aria-label="Back">' + I('back') + '</button>'
      : '<span class="acm-seal" aria-hidden="true">A</span>';
    barEl.innerHTML = left + '<div class="acm-t"><b>' + esc(b.title || 'A-Cell') + '</b>' + (b.sub ? '<small>' + esc(b.sub) + '</small>' : '') + '</div>' +
      (b.right || []).map(function (r) { return '<button type="button" class="acm-ib" data-acm="' + esc(r[1]) + '" aria-label="' + esc(r[2] || r[1]) + '">' + I(r[0]) + '</button>'; }).join('');
  }

  function go(name, arg, opts) {
    opts = opts || {};
    if (name === '@more') { moreSheet(); return; }
    var def = SCREENS[name];
    if (!def) return;
    closeSheets();
    if (!opts.replace && st.name && (st.name !== name || st.arg !== arg)) st.hist.push([st.name, st.arg]);
    if (st.hist.length > 30) st.hist.shift();
    if (def.mode) setMode(def.mode, true);
    st.name = name; st.arg = arg == null ? null : arg;
    render();
    window.scrollTo(0, 0);
  }
  function back() {
    var h = st.hist.pop();
    if (h) { st.name = h[0]; st.arg = h[1]; if (SCREENS[h[0]].mode) setMode(SCREENS[h[0]].mode, true); render(); }
    else go(st.mode === 'play' ? 'pads' : 'session', null, { replace: true });
  }
  // Back in Play from the last visit: the start-of-game vitals, once the session's loaded.
  function markStartSoon() {
    var tries = 0;
    (function again() {
      var s = A.session();
      if (s && A.cell(s.cell_id) && A.members(s.cell_id).length) { if (window.dgAcPlay && window.dgAcPlay.markStart) window.dgAcPlay.markStart(s); return; }
      if (++tries < 40) setTimeout(again, 250);
    })();
  }
  function setMode(m, quiet) {
    if (st.mode === m) return;
    st.mode = m;
    document.body.setAttribute('data-ac-mode', m);
    A.keep('dg_acell_mode', m);
    if (m === 'play') {
      var s = A.session();
      if (s && window.dgAcPlay && window.dgAcPlay.markStart) window.dgAcPlay.markStart(s);
      if (A.loadSeen) A.loadSeen();
    }
    if (!quiet) go(m === 'play' ? 'pads' : m === 'debrief' ? 'debrief' : 'session', null, { replace: true });
  }
  var panelShown = '';
  function render() {
    if (!st.on) return;
    var def = SCREENS[st.name];
    if (!def) return;
    var out = def.render ? def.render(st.arg) || {} : {};
    st.sig = def.sig ? def.sig(st.arg) : '';
    drawBar(out.bar || def.bar || {});
    drawTabs();
    document.body.classList.toggle('acm-panel', !!def.panel);
    // Writing: the keyboard's bar takes the foot of the screen.
    document.body.classList.toggle('acm-writing', !!out.writing);
    document.body.setAttribute('data-acm-screen', st.name);
    if (def.panel) {
      view.innerHTML = '';
      if (window.dgAcellTab() !== def.panel || panelShown !== st.name) { panelShown = st.name; window.dgAcellTab(def.panel); }
      if (def.after) def.after(st.arg);
    } else {
      panelShown = '';
      if (out.keep && view.getAttribute('data-for') === st.name + '|' + st.arg) { if (out.update) out.update(view); }
      else {
        if (st.cleanup) { try { st.cleanup(); } catch (e) { /* gone */ } st.cleanup = null; }
        view.innerHTML = out.html || '';
        view.setAttribute('data-for', st.name + '|' + st.arg);
        if (out.after) st.cleanup = out.after(view) || null;
      }
    }
  }
  var rT = null;
  function refresh() { if (!st.on || layer.querySelector('.acm-sheet[data-hold]')) return; clearTimeout(rT); rT = setTimeout(render, 30); }

  /* ── Sheets: slide up over a dim, close on the dim or [data-x] ── */
  function sheet(html, opts) {
    opts = opts || {};
    var w = document.createElement('div');
    w.className = 'acm-sheetwrap' + (opts.cls ? ' ' + opts.cls : '');
    w.innerHTML = '<div class="acm-dim" data-x></div><div class="acm-sheet"' + (opts.hold ? ' data-hold' : '') + ' role="dialog"><div class="acm-grab"></div>' + html + '</div>';
    layer.appendChild(w);
    document.body.classList.add('acm-sheet-open');
    w.addEventListener('click', function (e) {
      if (e.target.closest('[data-x]')) { close(); return; }
    });
    function close() { w.remove(); if (!layer.children.length) document.body.classList.remove('acm-sheet-open'); if (opts.onClose) opts.onClose(); }
    w.close = close;
    return w;
  }
  function closeSheets() { Array.prototype.slice.call(layer.children).forEach(function (w) { if (w.close) w.close(); else w.remove(); }); document.body.classList.remove('acm-sheet-open'); }
  function toast(t) { toastEl.textContent = t; toastEl.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { toastEl.hidden = true; }, 2600); }

  /* ── Shared bits ── */
  function sess() { return A.session(); }
  function cellOf(s) { return s ? A.cell(s.cell_id) : null; }
  function operations() { var o = (T() && T().operations()) || []; return o.length ? o : ((E() && E().operations && E().operations()) || []); }
  function opOf(s) { return s && s.operation_id ? operations().filter(function (o) { return o.operation_id === s.operation_id; })[0] || null : null; }
  function agentsByDex(s) {
    return (s ? A.members(s.cell_id) : []).slice().sort(function (a, b) { return (b.dex || 0) - (a.dex || 0) || a.name.localeCompare(b.name); });
  }
  function initials(n) { return String(n || '?').split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase(); }
  var photoN = 0;
  // A rectangular photo; the Agent's main photo, or their initials.
  function photo(code, cls) {
    var a = A.agent(code) || { name: code };
    var brief = (R() && R().briefs && R().briefs()[code]) || {};
    var url = (window.dgMainPhoto ? window.dgMainPhoto(brief) : '') || brief.face_plate_url || '';
    var id = 'acm-ph-' + (++photoN);
    if (/^(https?:|data:)/.test(url)) return '<span class="acm-ph ' + (cls || '') + '" id="' + id + '"><img src="' + esc(url) + '" alt=""></span>';
    if (url && R() && R().photoInto) setTimeout(function () { R().photoInto(url, id); }, 0);
    return '<span class="acm-ph ' + (cls || '') + '" id="' + id + '">' + esc(initials(a.name)) + '</span>';
  }
  function sw(on, attrs) { return '<button type="button" class="acm-sw' + (on ? ' on' : '') + '" role="switch" aria-checked="' + !!on + '" ' + (attrs || '') + '><i></i></button>'; }
  function lab(t) { return '<div class="acm-lab">' + esc(t) + '</div>'; }
  function btn(t, act, cls, extra) { return '<button type="button" class="acm-btn ' + (cls || '') + '" data-acm="' + esc(act) + '" ' + (extra || '') + '>' + t + '</button>'; }
  // A line of Markdown as plain words: [[a|b]] -> b, no ** ` > callouts or cue marks.
  function plain(t) {
    return String(t || '').replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/\[![a-z-]+\][+-]?\s*/gi, '')
      .replace(/[*_`]+/g, '').replace(/^>\s*/, '').replace(/[⚡♪◫]\s*/g, '').trim();
  }
  function fileName(t) { return String(t || '').replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled'; }

  /* ── An operation's vault folder ──
     <Operation>/<Operation>.md (overview), Sessions/, NPCs/, Locations/
     (each with its own folder note). Made once per operation; its path
     is kept on the operation, so files moved afterwards stay moved. */
  function opFolder(o) { return o && o.vault_folder ? o.vault_folder : ''; }
  var opDocs = {};
  // The operations as the tapes store already read them (no second read).
  function loadOpDocs() {
    var D = T();
    return (D ? D.load() : Promise.resolve()).then(function () {
      (D ? D.operations() : []).forEach(function (o) { opDocs[o.operation_id] = Object.assign(opDocs[o.operation_id] || {}, o); });
      return opDocs;
    });
  }
  function folderOf(opId) { var d = opDocs[opId]; return d && d.vault_folder ? d.vault_folder : ''; }
  function ensureOpFolder(op) {
    if (!op || folderOf(op.operation_id)) return Promise.resolve(folderOf(op && op.operation_id));
    var base = fileName(op.name), c = A.cell(op.cell_id);
    var files = [
      [base + '/' + base + '.md', '# ' + op.name + '\n\nOperation' + (c ? ' of Cell ' + (c.name || c.cell_id) : '') + '.\n\n- [[Sessions]]\n- [[NPCs]]\n- [[Locations]]\n'],
      [base + '/Sessions/Sessions.md', '# Sessions\n\nThe sessions of ' + op.name + '.\n'],
      [base + '/NPCs/NPCs.md', '# NPCs\n\nThe people of ' + op.name + '. Each NPC is a note here, with DEX, HP, WP and SAN at the top.\n'],
      [base + '/Locations/Locations.md', '# Locations\n\nThe places of ' + op.name + '.\n']
    ];
    return V().load().catch(function () {}).then(function () {
      return files.reduce(function (p, f) { return p.then(function () { return V().get(f[0]) ? null : V().save(f[0], f[1]); }); }, Promise.resolve());
    }).then(function () {
      return window.dgAcellApi.handler().then(function (f) { return f.firestore().collection('operations').doc(op.operation_id).set({ vault_folder: base }, { merge: true }); });
    }).then(function () { opDocs[op.operation_id] = Object.assign(opDocs[op.operation_id] || {}, { vault_folder: base }); return base; });
  }
  // Every operation that doesn't have its folder yet (old ones too).
  var backfilled = false;
  function backfillOps() {
    if (backfilled) return;
    backfilled = true;
    loadOpDocs().then(function () {
      var todo = operations().filter(function (o) { return !folderOf(o.operation_id); });
      return todo.reduce(function (p, o) { return p.then(function () { return ensureOpFolder(o).catch(function (e) { console.error('a-cell: operation folder', o.name, e); }); }); }, Promise.resolve());
    }).catch(function (e) { backfilled = false; console.error('a-cell: operation folders', e); });
  }
  function createOperation(name, cellId) {
    return window.dgAcellApi.post({ action: 'create_operation', name: name, cell_id: cellId }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || j.status !== 'OK') throw new Error((j && j.message) || 'Could not make the operation.');
      var op = { operation_id: j.operation_id, name: name, cell_id: cellId };
      return ensureOpFolder(op).catch(function () {}).then(function () {
        if (T() && T().reloadOps) T().reloadOps();
        return op;
      });
    });
  }
  function sessionsDir(s) { var f = folderOf(s && s.operation_id); return f ? f + '/Sessions' : 'Sessions'; }
  function npcDir(s) { var f = folderOf(s && s.operation_id); return f ? f + '/NPCs' : 'NPCs'; }

  /* ── NPCs: a note each, in the operation's NPCs folder ── */
  function npcMd(n) {
    return '---\ntype: npc\ndex: ' + (n.dex || '') + '\nhp: ' + (n.hp == null ? '' : n.hp) + '\nwp: ' + (n.wp == null ? '' : n.wp) + '\nsan: ' + (n.san == null ? '' : n.san) + '\n---\n# ' + n.name + '\n\n' + (n.note || '') + '\n';
  }
  function parseNpc(md) {
    var m = /^---\n([\s\S]*?)\n---/.exec(md || ''), out = {};
    if (!m) return null;
    m[1].split('\n').forEach(function (l) { var kv = /^(\w+):\s*(.*)$/.exec(l); if (kv) out[kv[1].toLowerCase()] = kv[2].trim(); });
    if (out.type !== 'npc' && out.dex == null) return null;
    var h = /^#\s+(.+)$/m.exec(md);
    return { name: h ? h[1].trim() : '', dex: +out.dex || 0, hp: out.hp === '' || out.hp == null ? null : +out.hp, wp: out.wp === '' || out.wp == null ? null : +out.wp, san: out.san === '' || out.san == null ? null : +out.san };
  }
  // Saves the NPC as a note (or updates its numbers) and returns its path.
  function npcNote(n, s) {
    var path = n.path || V().cleanPath(npcDir(s) + '/' + fileName(n.name));
    return V().load().catch(function () {}).then(function () {
      var cur = V().get(path);
      if (!cur) return V().save(path, npcMd(n));
      var md = cur.content || '', fm = /^---\n[\s\S]*?\n---\n?/.exec(md);
      var rest = fm ? md.slice(fm[0].length) : md;
      return V().save(path, npcMd({ name: n.name, dex: n.dex, hp: n.hp, wp: n.wp, san: n.san }).replace(/# [^\n]*\n\n\n$/, '') + (fm ? rest : '\n' + md));
    }).then(function () { return path; });
  }
  // The operation's NPCs (notes with an npc header) not already in the session.
  function folderNpcs(s) {
    var dir = npcDir(s) + '/', have = {};
    (s ? s.npcs : []).forEach(function (n) { if (n.path) have[n.path] = true; have[(n.name || '').toLowerCase()] = true; });
    return V().notes().filter(function (n) { return n.path.indexOf(dir) === 0; }).map(function (n) {
      var p = parseNpc(n.content);
      return p && p.name ? Object.assign(p, { path: n.path }) : null;
    }).filter(function (p) { return p && !have[p.path] && !have[p.name.toLowerCase()]; });
  }

  /* ── More ── */
  function moreSheet() {
    var w = sheet(modeSeg() + [
      ['music', 'Music', 'Tapes, the console, the library', 'tape'], ['vault', 'Notes', 'Your Obsidian vault', 'vault'], ['sheet', 'Sheet', 'Every Agent, every Cell', 'sheet'],
      ['cells', 'Cells', 'Cells, members, operations', 'cells'], ['ids', 'ID creator', 'An NPC\'s card, filed as evidence', 'idcard'], ['debrief', 'Debrief', 'After the game', 'debrief'],
      ['@radio', 'Tune in', 'Listen to a channel here', 'radio'], ['htmlpages', 'Uploaded pages', 'Session notes as HTML pages', 'template'], ['@desk', 'Computer layout', 'The folder and its tabs', 'grid'], ['@out', 'Clearance', 'Back to the start page', 'back']
    ].map(function (r) { return '<button type="button" class="acm-mrow" data-acm-go="' + r[0] + '">' + I(r[3]) + '<span><b>' + esc(r[1]) + '</b><small>' + esc(r[2]) + '</small></span></button>'; }).join(''), { cls: 'acm-more' });
    return w;
  }
  function modeSeg() {
    return '<div class="acm-seg acm-modes">' + [['prep', 'Prep'], ['play', 'Play'], ['debrief', 'Debrief']].map(function (m) {
      return '<button type="button" class="' + (st.mode === m[0] ? 'on' : '') + '" data-acm-mode="' + m[0] + '">' + m[1] + '</button>';
    }).join('') + '</div>';
  }

  /* ── Sessions ── */
  function sessionsSheet() {
    var list = S().list(), cur = sess(), ops = operations(), groups = {};
    list.forEach(function (s) { var k = s.operation_id || ''; (groups[k] = groups[k] || []).push(s); });
    var keys = Object.keys(groups).sort(function (a, b) { return (a ? 0 : 1) - (b ? 0 : 1); });
    var html = '<h2 class="acm-h">Sessions</h2>' + (list.length ? keys.map(function (k) {
      var o = ops.filter(function (x) { return x.operation_id === k; })[0];
      return lab(o ? o.name + ' · operation' : 'No operation') + '<div class="acm-card">' + groups[k].map(function (s) {
        var c = A.cell(s.cell_id);
        return '<button type="button" class="acm-row" data-acm="pick-session" data-id="' + esc(s.id) + '"><span class="acm-g"><b>' + esc(s.name) + '</b><small>' +
          esc([s.date, s.state === 'debriefed' ? 'debriefed' : s.state === 'played' ? 'played' : 'prep', c && (c.name || c.cell_id)].filter(Boolean).join(' · ')) + '</small></span>' +
          (cur && cur.id === s.id ? '<span class="acm-now">now</span>' : '') + '</button>';
      }).join('') + '</div>';
    }).join('') : '<p class="acm-none">No sessions yet.</p>') +
      '<div class="acm-g2">' + btn('New session', 'new-session', 'k') + btn('New operation', 'new-op') + '</div>';
    sheet(html);
  }
  function opSheet(cb) {
    var cs = A.cells(), s = sess();
    var w = sheet('<h2 class="acm-h">New operation</h2><form class="acm-form" data-form="op">' +
      '<label>Name<input name="name" required placeholder="Pale Lantern"></label>' +
      '<label>Cell<select name="cell">' + cs.map(function (c) { return '<option value="' + esc(c.cell_id) + '"' + (s && s.cell_id === c.cell_id ? ' selected' : '') + '>' + esc(c.name || c.cell_id) + '</option>'; }).join('') + '</select></label>' +
      '<p class="acm-note">Makes its Evidence folder in the Cell, and a folder in your vault: Sessions, NPCs, Locations and an overview note.</p>' +
      '<button class="acm-btn k w">Make the operation</button></form>', { hold: true });
    var f = w.querySelector('form');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = f.elements['name'].value.trim();
      if (!name || !f.cell.value) return;
      f.querySelector('button').disabled = true;
      createOperation(name, f.cell.value).then(function (op) { w.close(); toast('Operation made: ' + name); if (cb) cb(op); }, function (err) {
        f.querySelector('button').disabled = false; toast((err && err.message) || String(err));
      });
    });
  }

  /* ── Templates: vault notes in Templates/ named "Session — …" ── */
  var BUILTIN = [{ name: 'Investigation night', md: '# {{session}}\n\n## Briefing\n\n- [ ] \n\n## Investigation\n\n- [ ] \n\n## Complication\n\n- [ ] \n\n## Climax\n\n- [ ] \n\n## Aftermath\n\n- [ ] \n' },
    { name: 'One scene', md: '# {{session}}\n\n## Scene 1\n\n- [ ] \n' }];
  function templates() {
    var vt = V().notes().filter(function (n) { return /^Templates\/Session — .+\.md$/.test(n.path); }).map(function (n) {
      return { name: n.path.replace(/^Templates\/Session — /, '').replace(/\.md$/, ''), md: n.content || '', path: n.path };
    });
    var names = {};
    vt.forEach(function (t) { names[t.name] = true; });
    return vt.concat(BUILTIN.filter(function (t) { return !names[t.name]; }));
  }
  function scenesOf(md) { return (V().headings(md || '', 2) || []).map(function (h) { return h.title; }); }
  function saveTemplate(s, name) {
    var md = ((s.note_path && V().get(s.note_path)) || {}).content || '';
    var keep = md.split('\n').filter(function (l) { return /^#{1,6}\s/.test(l) || /^\s*- \[[ xX]\]/.test(l); }).map(function (l) {
      if (/^#\s/.test(l)) return '# {{session}}';
      return l.replace(/^(\s*- \[)[xX](\])/, '$1 $2');
    });
    var body = keep.join('\n').replace(/(\n?## )/g, '\n$1').replace(/^\n+/, '') + '\n';
    return V().save('Templates/Session — ' + fileName(name) + '.md', body);
  }

  /* New session: blank, from a template, or a copy of another. */
  screen('new-session', {
    render: function (arg) {
      var from = (arg && arg.from) || '', s0 = from ? S().get(from) : null, cs = A.cells(), ops = operations(), tpls = templates(), base = s0 || sess();
      var how = (arg && arg.how) || (s0 ? 'copy' : 'template');
      return {
        bar: { title: s0 ? 'Duplicate session' : 'New session', sub: base ? (A.cell(base.cell_id) || {}).name || '' : '', back: true },
        html: '<div class="acm-fold"><form class="acm-form" data-form="session">' +
          lab('Start from') + '<div class="acm-seg" data-seg="how">' + [['blank', 'Blank'], ['template', 'Template'], ['copy', 'Copy of…']].map(function (h) { return '<button type="button" class="' + (how === h[0] ? 'on' : '') + '" data-how="' + h[0] + '">' + h[1] + '</button>'; }).join('') + '</div>' +
          '<label data-show="template">Template<select name="tpl">' + tpls.map(function (t, i) { return '<option value="' + i + '">' + esc(t.name) + '</option>'; }).join('') + '</select><small class="acm-note" data-tplscenes></small></label>' +
          '<label data-show="copy">Copy of<select name="from">' + S().list().map(function (x) { return '<option value="' + esc(x.id) + '"' + (s0 && s0.id === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select><small class="acm-note">Its notes, scenes, NPCs and evidence; not what happened in play.</small></label>' +
          '<label>Name<input name="name" required value="' + esc(s0 ? s0.name + ' (copy)' : '') + '" placeholder="Session 5 — The lamp room"></label>' +
          '<label>Date<input name="date" type="date" value="' + esc(new Date().toISOString().slice(0, 10)) + '"></label>' +
          '<div class="acm-g2"><label>Cell<select name="cell"><option value="">— none yet —</option>' + cs.map(function (c) { return '<option value="' + esc(c.cell_id) + '"' + (base && base.cell_id === c.cell_id ? ' selected' : '') + '>' + esc(c.name || c.cell_id) + '</option>'; }).join('') + '</select></label>' +
          '<label>Operation<select name="op"><option value="">— none —</option>' + ops.map(function (o) { return '<option value="' + esc(o.operation_id) + '"' + (base && base.operation_id === o.operation_id ? ' selected' : '') + '>' + esc(o.name) + '</option>'; }).join('') + '</select></label></div>' +
          '<p class="acm-note" data-where></p><button class="acm-btn k w">Create the session</button></form></div>',
        after: function (el) {
          var f = el.querySelector('form');
          function sync() {
            var h = f.getAttribute('data-how') || how;
            Array.prototype.forEach.call(f.querySelectorAll('[data-show]'), function (x) { x.hidden = x.getAttribute('data-show') !== h; });
            Array.prototype.forEach.call(f.querySelectorAll('[data-how]'), function (b) { b.classList.toggle('on', b.getAttribute('data-how') === h); });
            var t = tpls[+f.tpl.value];
            f.querySelector('[data-tplscenes]').textContent = t ? 'Scenes: ' + scenesOf(t.md).join(' · ') : '';
            var dir = sessionsDir({ operation_id: f.op.value });
            f.querySelector('[data-where]').textContent = 'Its note: ' + dir + '/' + fileName(f.elements['name'].value || 'Session') + '.md' + (f.op.value ? ' · the operation\'s tapes come along.' : '');
          }
          f.setAttribute('data-how', how);
          f.addEventListener('click', function (e) { var b = e.target.closest('[data-how]'); if (b) { f.setAttribute('data-how', b.getAttribute('data-how')); sync(); } });
          f.addEventListener('input', sync); f.addEventListener('change', sync);
          sync();
          f.addEventListener('submit', function (e) {
            e.preventDefault();
            var h = f.getAttribute('data-how'), name = f.elements['name'].value.trim() || 'Untitled session';
            var fields = { name: name, date: f.date.value, cell_id: f.cell.value, operation_id: f.op.value };
            var src = h === 'copy' ? S().get(f.from.value) : null;
            if (src) ['evidence', 'npcs', 'pads', 'tracks'].forEach(function (k) { fields[k] = JSON.parse(JSON.stringify(src[k] || [])); });
            f.querySelector('button.k').disabled = true;
            var op = operations().filter(function (o) { return o.operation_id === f.op.value; })[0];
            (op ? ensureOpFolder(op).catch(function () {}) : Promise.resolve()).then(function () {
              var path = V().cleanPath(sessionsDir(fields) + '/' + fileName(name));
              var md;
              if (h === 'blank') md = '# ' + name + '\n\n## Scene 1\n\n';
              else if (h === 'template') md = (tpls[+f.tpl.value] || BUILTIN[0]).md.replace(/\{\{session\}\}/g, name);
              else md = (((src && src.note_path && V().get(src.note_path)) || {}).content || '# ' + name + '\n').replace(/^# .*$/m, '# ' + name);
              return V().load().catch(function () {}).then(function () { return V().get(path) ? null : V().save(path, md); }).then(function () {
                fields.note_path = path;
                return S().create(fields);
              });
            }).then(function () { toast('Session made: ' + name); go('desk', null, { replace: true }); }, function (err) {
              f.querySelector('button.k').disabled = false; toast((err && err.message) || String(err));
            });
          });
        }
      };
    }
  });

  function sessionActions(s) {
    if (!s) return;
    var w = sheet('<h2 class="acm-h">' + esc(s.name) + '</h2>' + [
      ['dup', 'Duplicate session', 'a copy with its notes, scenes, NPCs, evidence', 'copy'], ['tpl', 'Save as template', 'its scene headings and checklist, for new sessions', 'template'],
      ['rename', 'Rename, date, Cell', '', 'edit'], ['move', 'Move to another operation', (opOf(s) || {}).name || 'none', 'operation'],
      ['templates', 'Templates', templates().length + ' to start from', 'template'], ['del', 'Delete session', 'its note stays in the vault', 'trash']
    ].map(function (r) { return '<button type="button" class="acm-mrow' + (r[0] === 'del' ? ' red' : '') + '" data-sa="' + r[0] + '">' + I(r[3]) + '<span><b>' + esc(r[1]) + '</b><small>' + esc(r[2]) + '</small></span></button>'; }).join(''));
    w.addEventListener('click', function (e) {
      var b = e.target.closest('[data-sa]');
      if (!b) return;
      var a = b.getAttribute('data-sa');
      w.close();
      if (a === 'dup') go('new-session', { from: s.id, how: 'copy' });
      else if (a === 'tpl') nameSheet('Save as template', 'Template name', s.name.replace(/^Session \d+\s*[—-]\s*/, ''), function (n) { return saveTemplate(s, n).then(function () { toast('Template saved: Templates/Session — ' + fileName(n)); }); });
      else if (a === 'rename') A.editSession(s);
      else if (a === 'move') moveSheet(s);
      else if (a === 'templates') templatesSheet();
      else if (a === 'del') A.ask('Delete “' + s.name + '”? Its note stays in the vault.', 'Delete', 'Keep it').then(function (y) { if (y) { S().remove(s.id); go('session', null, { replace: true }); } });
    });
  }
  function nameSheet(title, label, val, done) {
    var w = sheet('<h2 class="acm-h">' + esc(title) + '</h2><form class="acm-form"><label>' + esc(label) + '<input name="v" required value="' + esc(val || '') + '"></label><button class="acm-btn k w">Save</button></form>', { hold: true });
    var f = w.querySelector('form');
    setTimeout(function () { f.v.focus(); f.v.select(); }, 50);
    f.addEventListener('submit', function (e) { e.preventDefault(); var v = f.v.value.trim(); if (!v) return; Promise.resolve(done(v)).then(function () { w.close(); }, function (err) { toast((err && err.message) || String(err)); }); });
  }
  function moveSheet(s) {
    var w = sheet('<h2 class="acm-h">Move to an operation</h2><div class="acm-card">' + operations().map(function (o) {
      return '<button type="button" class="acm-row" data-op="' + esc(o.operation_id) + '"><span class="acm-g"><b>' + esc(o.name) + '</b><small>' + esc((A.cell(o.cell_id) || {}).name || '') + '</small></span>' + (o.operation_id === s.operation_id ? '<span class="acm-now">now</span>' : '') + '</button>';
    }).join('') + '</div>' + btn('No operation', 'noop', 'w'));
    w.addEventListener('click', function (e) {
      var b = e.target.closest('[data-op],[data-acm="noop"]');
      if (!b) return;
      S().update(s.id, { operation_id: b.getAttribute('data-op') || '' });
      w.close(); toast('Moved.');
    });
  }
  function templatesSheet() {
    var w = sheet('<h2 class="acm-h">Session templates</h2><p class="acm-note">Notes in your vault named Templates/Session — …; edit them in Notes or in Obsidian.</p><div class="acm-card">' + templates().map(function (t) {
      return '<div class="acm-row"><span class="acm-g"><b>' + esc(t.name) + '</b><small>' + esc(scenesOf(t.md).join(' · ') || 'no scenes') + '</small></span>' + (t.path ? '<button type="button" class="acm-btn s" data-open="' + esc(t.path) + '">Open</button>' : '<span class="acm-note">built in</span>') + '</div>';
    }).join('') + '</div>');
    w.addEventListener('click', function (e) { var b = e.target.closest('[data-open]'); if (b) { w.close(); openNote(b.getAttribute('data-open')); } });
  }
  function openNote(path) { if (window.dgAcmNotes) window.dgAcmNotes.open(path); else A.openNote(path); }

  /* ── The add sheet: post-its ── */
  var PREP_ADD = [['ev', 'Add Evidence', 'photo, PDF or text, to a Cell', 'y'], ['cell', 'Add Cell', 'a group of Agents', 'bl'], ['op', 'Add Operation', 'evidence folders, sessions, tapes', 'gr'],
    ['anote', 'Agent Notes', 'into an Agent\'s file', 'pk'], ['snote', 'Session Notes', 'vault notes, Docs, pages for Play', 'or'], ['npc', 'NPCs', 'DEX · HP · WP · SAN', 'pu'],
    ['tape', 'Tape', 'Soundtrack (for session)', 'wh'], ['sess', 'New Session', 'blank, template or a copy', 'y']];
  var PLAY_ADD = [['qnote', 'Quick note', 'the session or an Agent', 'y'], ['qev', 'Add evidence', 'quickly, to the Cell and operation', 'gr'], ['rel', 'Release evidence', 'hand it to the players', 'or'], ['npc', 'NPC', 'into initiative', 'pu'],
    ['agent', 'Agent', 'their sheet, read only', 'pk'], ['console', 'Tape', 'the console: decks, tracks, loops', 'bl'], ['end', 'End the game', 'to Debrief', 'wh']];
  var ADD_ACTIONS = {};
  function addSheet() {
    var set = st.mode === 'play' ? PLAY_ADD : PREP_ADD;
    var rot = [-1.2, 1, 0.8, -0.7, -0.5, 1.1, 0.6, -1];
    var w = sheet('<h2 class="acm-h">' + (st.mode === 'play' ? 'During the game' : 'Add') + '</h2><div class="acm-pis">' + set.map(function (p, i) {
      return '<button type="button" class="acm-pi c-' + p[3] + '" style="--r:' + rot[i % rot.length] + 'deg" data-add="' + p[0] + '"><b>' + esc(p[1]) + '</b><small>' + esc(p[2]) + '</small></button>';
    }).join('') + '</div>', { cls: 'acm-addsheet', onClose: function () { fab.classList.remove('open'); } });
    fab.classList.add('open');
    w.addEventListener('click', function (e) {
      var b = e.target.closest('[data-add]');
      if (!b) return;
      w.close();
      var f = ADD_ACTIONS[b.getAttribute('data-add')];
      if (f) f();
    });
  }
  ADD_ACTIONS.ev = function () { go('evidence'); setTimeout(function () { if (E()) E().newItem(); }, 60); };
  ADD_ACTIONS.cell = function () { go('cells'); setTimeout(function () { var b = document.getElementById('cells-create-btn'); if (b) b.click(); }, 60); };
  ADD_ACTIONS.op = function () { opSheet(); };
  ADD_ACTIONS.anote = function () { agentNoteSheet(); };
  ADD_ACTIONS.snote = function () { var s = sess(); if (!s) { toast('Choose a session first.'); sessionsSheet(); return; } go('desk', { seg: 'notes' }); setTimeout(function () { noteSheet(s); }, 60); };
  ADD_ACTIONS.tape = function () {
    var s = sess(), op = opOf(s);
    if (!T()) return;
    T().create({ name: (op ? op.name : (s ? s.name : 'Session')) + ' · tape ' + ((op ? T().forOperation(op.operation_id).length : 0) + 1), scope: op ? 'operation' : 'cell', operation_id: op ? op.operation_id : '', cell_id: s ? s.cell_id : '' })
      .then(function (t) { go('music'); setTimeout(function () { if (window.dgAcLibrary) window.dgAcLibrary.openTape(t.id); }, 80); });
  };
  ADD_ACTIONS.sess = function () { go('new-session'); };
  ADD_ACTIONS.end = function () { setMode('debrief'); };
  ADD_ACTIONS.pads = function () { go('pads'); };
  // Tape (Play, 2026-10-30): the Music tab, at the console.
  ADD_ACTIONS.console = function () {
    go('music');
    setTimeout(function () { var c = document.getElementById('ac-console'); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'start' }); }, 120);
  };

  // A note on an Agent (or on the session), into their player file.
  function agentNoteSheet(code) {
    var s = sess(), ms = agentsByDex(s);
    var pick = code || (ms[0] ? ms[0].code : '');
    var w = sheet('<h2 class="acm-h">Agent note</h2><div class="acm-faces">' + ms.map(function (a) {
      return '<button type="button" class="acm-face' + (a.code === pick ? ' on' : '') + '" data-code="' + esc(a.code) + '">' + photo(a.code) + '<span>' + esc(a.name.split(' ').pop()) + '</span></button>';
    }).join('') + '</div><form class="acm-form"><textarea name="t" rows="3" required placeholder="What you noticed…"></textarea>' +
      '<p class="acm-note" data-to></p><button class="acm-btn k w">Save</button></form>', { hold: true, cls: 'acm-kb' });
    var f = w.querySelector('form');
    function to() { var a = A.agent(pick); f.querySelector('[data-to]').textContent = a ? 'Goes to ' + A.playerPath(a.name) + ' · Handler notes' : ''; }
    to();
    setTimeout(function () { f.t.focus(); }, 60);
    w.addEventListener('click', function (e) {
      var b = e.target.closest('.acm-face');
      if (!b) return;
      pick = b.getAttribute('data-code');
      Array.prototype.forEach.call(w.querySelectorAll('.acm-face'), function (x) { x.classList.toggle('on', x === b); });
      to();
    });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var t = f.t.value.trim(), P = window.dgAcPlayers;
      if (!t || !pick || !P) return;
      f.querySelector('button').disabled = true;
      P.ensureFile(pick).then(function (path) { return P.append(path, 'Handler notes', ['- ' + P.stamp(sess()) + ' · ' + t]); }).then(function () { w.close(); toast('Saved in their file.'); },
        function (err) { f.querySelector('button').disabled = false; toast((err && err.message) || String(err)); });
    });
  }

  // A new NPC: a note in the operation's NPCs folder, and (if asked) in the session / initiative.
  function npcSheet(opts) {
    opts = opts || {};
    var s = sess();
    var vals = { dex: 10, hp: 10, wp: 10, san: 0 };
    var w = sheet('<h2 class="acm-h">New NPC</h2><form class="acm-form"><input name="name" required placeholder="Name">' +
      ['dex', 'hp', 'wp', 'san'].map(function (k) { return '<div class="acm-step"><b>' + k.toUpperCase() + '</b><span><button type="button" data-st="' + k + '" data-d="-1">−</button><strong data-v="' + k + '">' + vals[k] + '</strong><button type="button" data-st="' + k + '" data-d="1">+</button></span></div>'; }).join('') +
      (s ? '<div class="acm-kv"><span><b>In ' + esc(s.name) + '</b><small>also a note in ' + esc(npcDir(s)) + '</small></span>' + sw(true, 'data-in') + '</div>' : '') +
      '<div class="acm-g2"><button class="acm-btn k" data-go="save">Save</button><button class="acm-btn" type="submit" data-go="init">Save + into initiative</button></div></form>', { hold: true });
    var f = w.querySelector('form'), how = 'save';
    w.addEventListener('click', function (e) {
      var b = e.target.closest('[data-st]');
      if (b) { var k = b.getAttribute('data-st'); vals[k] = Math.max(0, Math.min(99, vals[k] + +b.getAttribute('data-d'))); w.querySelector('[data-v="' + k + '"]').textContent = vals[k]; return; }
      var t = e.target.closest('[data-in]');
      if (t) { t.classList.toggle('on'); t.setAttribute('aria-checked', String(t.classList.contains('on'))); return; }
      var g = e.target.closest('[data-go]');
      if (g) how = g.getAttribute('data-go');
    });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = f.elements['name'].value.trim();
      if (!name) return;
      var inS = !s ? false : w.querySelector('[data-in]').classList.contains('on') || how === 'init';
      var npc = { name: name, dex: vals.dex, hp: vals.hp, wp: vals.wp, san: vals.san };
      Array.prototype.forEach.call(f.querySelectorAll('button'), function (b) { b.disabled = true; });
      npcNote(npc, s).then(function (path) {
        npc.path = path;
        if (inS) return S().update(s.id, { npcs: s.npcs.concat([npc]) });
      }).then(function () { w.close(); toast(inS ? name + ' is in ' + s.name + '.' : name + ' saved in ' + npcDir(s) + '.'); if (opts.done) opts.done(npc); },
        function (err) { Array.prototype.forEach.call(f.querySelectorAll('button'), function (b) { b.disabled = false; }); toast((err && err.message) || String(err)); });
    });
    setTimeout(function () { f.elements['name'].focus(); }, 60);
  }
  ADD_ACTIONS.npc = function () { npcSheet(); };

  /* ── The Session dashboard: blocks ── */
  var BLOCKS = [
    ['waiting', 'Waiting on you', 'what needs you before the game', true], ['cell', 'The Cell', 'the Agents, by DEX', true],
    ['session', 'This session', 'its checklist and scenes', true], ['shortcuts', 'Shortcuts', 'four buttons you choose', true],
    ['tape', 'Tapes in the decks', 'what each channel is playing', false], ['evidence', 'Evidence not released', 'release from here', false],
    ['notes', 'Recent notes', 'the last vault notes you touched', false], ['quick', 'Quick notes', 'from the last game', false],
    ['rolls', 'Live rolls', 'the Cell\'s dice', false], ['next', 'Next session', 'date and what\'s left to prep', false]
  ];
  var SHORTCUTS = { ev: ['Add evidence', function () { ADD_ACTIONS.ev(); }], snotes: ['Session notes', function () { go('desk'); }], sheet: ['Sheet', function () { go('sheet'); }], cells: ['Cells', function () { go('cells'); }],
    tapes: ['Tapes', function () { go('music'); }], console: ['Console', function () { go('music'); }], ids: ['ID creator', function () { go('ids'); }], vault: ['Vault', function () { go('vault'); }],
    agents: ['Agents', function () { go('agents'); }], play: ['Play', function () { setMode('play'); }] };
  function dash() {
    var d = A.store('dg_acm_dash', null) || {};
    var order = (d.order || []).filter(function (k) { return BLOCKS.some(function (b) { return b[0] === k; }); });
    BLOCKS.forEach(function (b) { if (order.indexOf(b[0]) < 0) order.push(b[0]); });
    var on = d.on || {};
    BLOCKS.forEach(function (b) { if (on[b[0]] == null) on[b[0]] = b[3]; });
    var sc = (d.shortcuts || ['ev', 'snotes', 'sheet', 'cells']).filter(function (k) { return SHORTCUTS[k]; });
    return { order: order, on: on, shortcuts: sc };
  }
  function saveDash(d) { A.keep('dg_acm_dash', d); }
  function noteTasks(s) {
    var n = s && s.note_path && V() && V().get(s.note_path);
    if (!n) return [];
    var out = [];
    (n.content || '').split('\n').forEach(function (l, i) { var m = /^\s*- \[([ xX])\]\s*(.*)$/.exec(l); if (m && m[2].trim()) out.push({ line: i, done: m[1] !== ' ', text: plain(m[2]) }); });
    return out;
  }
  function block(k, s) {
    var B = {
      waiting: function () {
        var rows = [];
        if (s && E()) {
          var un = s.evidence.map(function (id) { return E().find(id); }).filter(function (h) { return h && !h.released; });
          if (un.length) rows.push(['ev', un.length + ' evidence not released', un.map(function (h) { return h.title; }).slice(0, 3).join(' · '), 'Go']);
        }
        agentsByDex(s).forEach(function (a) { if (a.hpMax && a.hp != null && a.hp <= a.hpMax / 2) rows.push(['agent:' + a.code, a.name.split(' ').pop() + ' is wounded · ' + a.hp + '/' + a.hpMax, '', 'File']); });
        var D = T(), m = M();
        if (s && D && m && !m.state().tape) {
          var list = D.forOperation(s.operation_id).concat(D.forCell(s.cell_id));
          if (list.length) rows.push(['tape:' + list[0].id, 'No tape in CH ' + m.channel(), list[0].name + ' · ' + D.fmt(D.runtime(list[0])), 'Play']);
        }
        if (s && !S().notesOf(s).length) rows.push(['desk', 'No notes for this session yet', '', 'Add']);
        return rows.length ? '<div class="acm-card">' + rows.map(function (r) { return '<div class="acm-row"><span class="acm-g"><b>' + esc(r[1]) + '</b>' + (r[2] ? '<small>' + esc(r[2]) + '</small>' : '') + '</span>' + btn(esc(r[3]), 'w:' + r[0], 's') + '</div>'; }).join('') + '</div>'
          : '<p class="acm-none">Nothing waiting. Ready when you are.</p>';
      },
      cell: function () {
        var c = cellOf(s), ms = agentsByDex(s);
        if (!c) return '<p class="acm-none">No Cell for this session yet.</p>';
        return '<div class="acm-card acm-faces">' + ms.map(function (a) { return '<button type="button" class="acm-face" data-acm="agent" data-code="' + esc(a.code) + '">' + photo(a.code) + '<span>' + esc(a.name.split(' ').pop()) + '</span></button>'; }).join('') + '</div>';
      },
      session: function () {
        if (!s) return '<p class="acm-none">No session chosen.</p>';
        var md = ((s.note_path && V().get(s.note_path)) || {}).content || '', sc = scenesOf(md), tasks = noteTasks(s);
        return '<div class="acm-card">' + tasks.slice(0, 6).map(function (t) {
          return '<button type="button" class="acm-row acm-task" data-acm="task" data-line="' + t.line + '"><span class="acm-cb' + (t.done ? ' on' : '') + '"></span><span class="acm-g"><b>' + esc(t.text) + '</b></span></button>';
        }).join('') + '<button type="button" class="acm-row" data-acm="desk"><span class="acm-g"><b>' + sc.length + ' scene' + (sc.length === 1 ? '' : 's') + ' · ' + s.npcs.length + ' NPC' + (s.npcs.length === 1 ? '' : 's') + ' · ' + s.evidence.length + ' evidence</b><small>' + esc(sc.slice(0, 4).join(' · ') || 'no scenes yet') + '</small></span>' + I('chev') + '</button></div>';
      },
      shortcuts: function () {
        return '<div class="acm-g2">' + dash().shortcuts.map(function (k) { return btn(esc(SHORTCUTS[k][0]), 'sc:' + k); }).join('') + '</div>';
      },
      tape: function () {
        var m = M(), D = T();
        if (!m || !D) return '';
        // Every channel with a tape in its deck, as its cassette (2026-10-30).
        var ds = D.decks();
        return '<div class="acm-card">' + (ds.length ? ds.map(function (d) {
          // Tap the tape for that channel's console; x takes it out of the deck.
          return '<div class="acm-row acm-deckrow"><button type="button" class="acm-deckgo" data-acm="deck-console" data-ch="' + esc(d.ch) + '"><span class="acm-deckcas" aria-hidden="true">' + D.svg(d.tape, { meta: '' }) + '</span><span class="acm-g"><b>' + esc(d.tape.name || 'Tape') + '</b><small>CH ' + esc(d.ch) + (d.track ? ' · ' + esc(d.track) : '') + (d.paused ? ' · paused' : '') + '</small></span></button>' +
            btn(I('close'), 'deck-out', 's red', 'data-ch="' + esc(d.ch) + '" aria-label="Take the tape out of CH ' + esc(d.ch) + '"') + '</div>';
        }).join('') : '<p class="acm-none">No tape in any deck.</p>') + '</div>';
      },
      evidence: function () {
        if (!E()) return '';
        var items = E().items().filter(function (h) { return !h.released && (!s || !s.cell_id || h.cell_id === s.cell_id); }).slice(0, 5);
        return items.length ? '<div class="acm-card">' + items.map(function (h) { return '<div class="acm-row"><span class="acm-g"><b>' + esc(h.title || 'Untitled') + '</b><small>' + esc(E().opName ? E().opName(h.operation_id) || '' : '') + '</small></span>' + sw(false, 'data-acm="release" data-id="' + esc(h.evidence_id) + '"') + '</div>'; }).join('') + '</div>'
          : '<p class="acm-none">Everything is released.</p>';
      },
      notes: function () {
        var ns = V().notes().slice().sort(function (a, b) { return (b.updated_at || 0) - (a.updated_at || 0); }).slice(0, 4);
        return ns.length ? '<div class="acm-card">' + ns.map(function (n) { return '<button type="button" class="acm-row" data-acm="open-note" data-path="' + esc(n.path) + '"><span class="acm-g"><b>' + esc(V().title(n.path)) + '</b><small>' + esc(V().folderLabel(V().dirOf(n.path)) || 'vault') + '</small></span>' + I('chev') + '</button>'; }).join('') + '</div>' : '<p class="acm-none">The vault is empty.</p>';
      },
      quick: function () {
        var src = s && s.quick_notes.length ? s : S().list().filter(function (x) { return x.quick_notes.length; })[0];
        if (!src) return '<p class="acm-none">No quick notes yet.</p>';
        return '<div class="acm-card">' + src.quick_notes.slice(-4).map(function (q) { var a = q.code && A.agent(q.code); return '<div class="acm-row"><span class="acm-g"><b>' + esc(q.text) + '</b><small>' + esc((a ? a.name.split(' ').pop() + ' · ' : '') + src.name) + '</small></span></div>'; }).join('') + '</div>';
      },
      rolls: function () {
        var rows = (window.dgAcmRolls && window.dgAcmRolls.latest(4)) || [];
        if (window.dgAcmRolls) window.dgAcmRolls.start();
        return rows.length ? '<div class="acm-drp">' + rows.map(window.dgAcmRolls.row).join('') + '</div>' : '<p class="acm-none">No rolls yet.</p>';
      },
      next: function () {
        var today = new Date().toISOString().slice(0, 10);
        var n = S().list().filter(function (x) { return x.date && x.date >= today && x.state === 'prep'; }).sort(function (a, b) { return a.date.localeCompare(b.date); })[0];
        if (!n) return '<p class="acm-none">No session planned.</p>';
        var left = noteTasks(n).filter(function (t) { return !t.done; }).length;
        return '<div class="acm-card"><button type="button" class="acm-row" data-acm="pick-session" data-id="' + esc(n.id) + '"><span class="acm-g"><b>' + esc(n.name) + '</b><small>' + esc(n.date) + ' · ' + left + ' thing' + (left === 1 ? '' : 's') + ' left to prep</small></span>' + I('chev') + '</button></div>';
      }
    };
    return B[k] ? B[k]() : '';
  }
  screen('session', {
    tab: 'session',
    render: function () {
      var s = sess(), c = cellOf(s), d = dash();
      var titles = {};
      BLOCKS.forEach(function (b) { titles[b[0]] = b[1]; });
      return {
        bar: { title: s ? s.name : 'A-Cell', sub: s ? [c && (c.name || c.cell_id), (opOf(s) || {}).name, s.date].filter(Boolean).join(' · ') : 'No session chosen', right: [['swap', 'sessions', 'Switch session']] },
        html: modeSeg() + '<div class="acm-fold">' + (S().list().length ? '' : '<p class="acm-none">No sessions yet. A session gathers one night\'s play: the Cell, your notes, evidence, music.</p>' + btn('New session', 'go:new-session', 'k w')) +
          '<div class="acm-dashhd">' + lab('Your dashboard') + btn(I('edit') + 'Customise', 'go:customise', 's') + '</div>' +
          d.order.filter(function (k) { return d.on[k]; }).map(function (k) { return '<section class="acm-blk" data-blk="' + k + '">' + lab(k === 'cell' && c ? 'The Cell · ' + (c.name || c.cell_id) : k === 'session' && s ? s.name.split(/\s+[—-]\s+/)[0] + (s.date ? ' · ' + s.date : '') : titles[k]) + block(k, s) + '</section>'; }).join('') + '</div>'
      };
    }
  });
  screen('customise', {
    tab: 'session',
    render: function () {
      var d = dash();
      var byId = {};
      BLOCKS.forEach(function (b) { byId[b[0]] = b; });
      return {
        bar: { title: 'Customise', sub: 'Your dashboard', back: true },
        html: '<div class="acm-fold"><p class="acm-note">Switch a block on or off; drag one by its handle to change the order. Kept on this device.</p><div class="acm-wids">' +
          d.order.map(function (k) { var b = byId[k]; return '<div class="acm-wid' + (d.on[k] ? '' : ' off') + '" data-k="' + k + '"><span class="acm-handle" aria-label="Drag">' + I('handle') + '</span><span class="acm-g"><b>' + esc(b[1]) + '</b><small>' + esc(b[2]) + '</small></span>' + sw(d.on[k], 'data-acm="blk" data-k="' + k + '"') + '</div>'; }).join('') +
          '</div>' + lab('Shortcuts · pick four') + '<div class="acm-chips">' + Object.keys(SHORTCUTS).map(function (k) { return '<button type="button" class="acm-chip' + (d.shortcuts.indexOf(k) >= 0 ? ' on' : '') + '" data-acm="sc-pick" data-k="' + k + '">' + esc(SHORTCUTS[k][0]) + '</button>'; }).join('') + '</div>' +
          btn('Done', 'back', 'k w') + '</div>',
        after: function (el) {
          var list = el.querySelector('.acm-wids'), drag = null;
          list.addEventListener('pointerdown', function (e) {
            var h = e.target.closest('.acm-handle');
            if (!h) return;
            e.preventDefault();
            drag = h.closest('.acm-wid'); drag.classList.add('lift');
            try { h.setPointerCapture(e.pointerId); } catch (x) { /* old Safari */ }
          });
          list.addEventListener('pointermove', function (e) {
            if (!drag) return;
            var rows = Array.prototype.slice.call(list.children), y = e.clientY;
            rows.forEach(function (r) {
              if (r === drag) return;
              var b = r.getBoundingClientRect();
              if (y > b.top && y < b.bottom) { if (y < b.top + b.height / 2) list.insertBefore(drag, r); else list.insertBefore(drag, r.nextSibling); }
            });
          });
          function end() {
            if (!drag) return;
            drag.classList.remove('lift'); drag = null;
            var d2 = dash();
            d2.order = Array.prototype.map.call(list.children, function (r) { return r.getAttribute('data-k'); });
            saveDash(d2);
          }
          list.addEventListener('pointerup', end); list.addEventListener('pointercancel', end);
        }
      };
    }
  });

  /* ── The session desk: scenes, NPCs, evidence, music ── */
  screen('desk', {
    tab: 'session',
    render: function (arg) {
      var s = sess();
      if (!s) return { bar: { title: 'Session prep', back: true }, html: '<div class="acm-fold"><p class="acm-none">Choose a session first.</p>' + btn('Sessions', 'sessions', 'k w') + '</div>' };
      var seg = (arg && arg.seg) || A.store('dg_acm_deskseg', 'notes'), c = cellOf(s), op = opOf(s);
      var md = ((s.note_path && V().get(s.note_path)) || {}).content || '';
      var body = '';
      if (seg === 'scenes') seg = 'notes';
      if (seg === 'notes') {
        // The session's notes (2026-10-30): any vault notes, Google Docs and
        // uploaded HTML pages, in the order Play shows them.
        var nl = S().notesOf(s);
        body = lab(nl.length ? 'Ready for Play · in this order' : 'Notes for Play') + nl.map(function (n, i) {
          var inf = noteInfo(n);
          return '<div class="acm-scene acm-snote"><button type="button" class="acm-g" data-acm="note-open" data-i="' + i + '"><b>' + esc(inf.title) + '</b><small>' + esc(inf.sub + (i === 0 && nl.length > 1 ? ' · opens first in Play' : '')) + '</small></button>' +
            (i > 0 ? btn('&uarr;', 'note-up', 's', 'data-i="' + i + '" aria-label="Earlier"') : '') + btn(I('close'), 'note-rm', 's red', 'data-i="' + i + '" aria-label="Take off the session"') + '</div>';
        }).join('') +
          '<button type="button" class="acm-scene add" data-acm="note-add"><span class="n">+</span><span class="acm-g"><b>Add a note</b><small>from the vault, a Google Doc, or an uploaded HTML page</small></span></button>' +
          (nl.length ? '<p class="acm-note">Taking a note off the session leaves it where it is: in the vault, in Google Drive, in Uploaded pages.</p>' : '<div class="acm-g2">' + btn('New session note', 'new-note', 'k') + '</div>');
      } else if (seg === 'npcs') {
        var more = folderNpcs(s);
        body = lab('In ' + s.name) + (s.npcs.length ? '<div class="acm-card">' + s.npcs.map(function (n, i) {
          return '<div class="acm-row"><span class="acm-ph">' + esc(initials(n.name)) + '</span><span class="acm-g"><b>' + esc(n.name) + '</b><small>' + esc(['DEX ' + (n.dex || '—'), n.hp != null ? 'HP ' + n.hp : '', n.wp != null ? 'WP ' + n.wp : '', n.san != null ? 'SAN ' + n.san : ''].filter(Boolean).join(' · ')) + '</small></span>' +
            (n.path ? btn('Note', 'open-note', 's', 'data-path="' + esc(n.path) + '"') : '') + btn(I('close'), 'rm-npc', 's', 'data-i="' + i + '" aria-label="Take out of the session"') + '</div>';
        }).join('') + '</div>' : '<p class="acm-none">No NPCs in this session yet.</p>') +
          lab(npcDir(s) + ' · not in this session') + (more.length ? '<div class="acm-card">' + more.map(function (n) {
            return '<div class="acm-row"><span class="acm-ph">' + esc(initials(n.name)) + '</span><span class="acm-g"><b>' + esc(n.name) + '</b><small>DEX ' + (n.dex || '—') + '</small></span>' + btn('Add', 'add-npc', 's', 'data-path="' + esc(n.path) + '"') + '</div>';
          }).join('') + '</div>' : '<p class="acm-none">Nothing else in the folder.</p>') + btn('New NPC', 'new-npc', 'k w');
      } else if (seg === 'evidence') {
        var items = E() ? E().items() : [];
        if (E()) E().start();
        body = (s.evidence.length ? '<div class="acm-card">' + s.evidence.map(function (id) {
          var h = E() && E().find(id);
          return '<div class="acm-row"><span class="acm-g"><b>' + esc(h ? h.title || 'Untitled' : items.length ? '(deleted)' : 'Loading…') + '</b><small>' + (h ? (h.released ? 'released' : 'not released') : '') + '</small></span>' +
            (h ? sw(h.released, 'data-acm="release" data-id="' + esc(id) + '"') : '') + btn(I('close'), 'ev-out', 's', 'data-id="' + esc(id) + '" aria-label="Take off the session"') + '</div>';
        }).join('') + '</div>' : '<p class="acm-none">No evidence in this session yet.</p>');
        var have = {};
        s.evidence.forEach(function (id) { have[id] = 1; });
        var cand = items.filter(function (h) { return !have[h.evidence_id] && !h.released && (!s.cell_id || h.cell_id === s.cell_id); }).slice(0, 10);
        body += (cand.length ? lab('Not released yet · add to the session') + '<div class="acm-card">' + cand.map(function (h) { return '<div class="acm-row"><span class="acm-g"><b>' + esc(h.title || 'Untitled') + '</b></span>' + btn('Add', 'ev-in', 's', 'data-id="' + esc(h.evidence_id) + '"') + '</div>'; }).join('') + '</div>' : '') + btn('New evidence', 'add:ev', 'k w');
      } else {
        var D = T(), list = D ? D.forOperation(s.operation_id).concat(D.forCell(s.cell_id)) : [], deck = M() && M().state().tape;
        body = (list.length ? '<div class="acm-tapes">' + list.map(function (t) {
          return '<div class="acm-tapec"><button type="button" class="acm-tapebtn" data-acm="tape-open" data-id="' + esc(t.id) + '">' + window.dgAcmCass(t) + '</button><div class="acm-tapecap"><span>' + (deck && deck.id === t.id ? 'IN THE DECK' : '') + '</span>' + btn('Play tape', 'tape-play', 's', 'data-id="' + esc(t.id) + '"') + '</div></div>';
        }).join('') + '</div>' : '<p class="acm-none">' + (op ? 'No tapes for ' + esc(op.name) + ' yet.' : 'Pick the session\'s operation to use its tapes.') + '</p>') + btn('New tape', 'add:tape', 'k w');
      }
      return {
        bar: { title: 'Session prep', sub: s.name, back: true, right: [['more', 'session-actions', 'Session actions']] },
        html: '<div class="acm-fold"><div class="acm-card acm-shd"><span class="acm-g"><b>' + esc(s.name) + '</b><small>' + esc([s.date, c && (c.name || c.cell_id), op && op.name].filter(Boolean).join(' · ')) + '</small></span><span class="acm-tag">' + esc(s.state) + '</span></div>' +
          '<div class="acm-seg" data-seg="desk">' + [['notes', 'Notes ' + S().notesOf(s).length], ['npcs', 'NPCs ' + s.npcs.length], ['evidence', 'Evid. ' + s.evidence.length], ['music', 'Music']].map(function (x) { return '<button type="button" class="' + (seg === x[0] ? 'on' : '') + '" data-acm="seg" data-seg="' + x[0] + '">' + esc(x[1]) + '</button>'; }).join('') + '</div>' +
          body + '</div>'
      };
    }
  });

  /* ── The session's notes (2026-10-30) ── */
  function htmlPages() { return (window.dgSessionNotes && window.dgSessionNotes.notes()) || []; }
  function htmlLang(n) {
    var L = (window.dgSessionNotes && window.dgSessionNotes.langs) || [['en']];
    return n.file_en || n.url_en ? 'en' : (L.map(function (l) { return l[0]; }).filter(function (l) { return n['file_' + l] || n['url_' + l]; })[0] || 'en');
  }
  function noteInfo(n) {
    if (n.kind === 'vault') { var d = V().dirOf ? V().dirOf(n.path) : ''; return { title: V().title(n.path), sub: 'Vault' + (d ? ' · ' + d : '') }; }
    if (n.kind === 'gdoc') return { title: n.title || 'Google Doc', sub: 'Google Doc' };
    var h = htmlPages().filter(function (x) { return x.id === n.id; })[0];
    return { title: h ? h.title || h.id : 'HTML page', sub: 'Uploaded HTML page · ' + String(n.lang || 'en').toUpperCase() };
  }
  function openSessNote(n) {
    if (!n) return;
    if (n.kind === 'vault') { if (window.dgAcmNotes) window.dgAcmNotes.open(n.path); else openNote(n.path); return; }
    if (n.kind === 'gdoc') { window.open(n.url, '_blank', 'noopener'); return; }
    if (window.dgSessionNotes) window.dgSessionNotes.load().then(function () { window.dgSessionNotes.open(n.id, n.lang); });
  }
  // Add a note: the vault (search), a Google Doc (its link), an uploaded page.
  function noteSheet(s) {
    var tab = 'vault';
    var w = sheet('<h2 class="acm-h">Add a note to ' + esc(s.name) + '</h2><div class="acm-seg" data-nt>' + [['vault', 'Vault'], ['gdoc', 'Google Doc'], ['html', 'HTML page']].map(function (x) {
      return '<button type="button" data-k="' + x[0] + '"' + (x[0] === tab ? ' class="on"' : '') + '>' + x[1] + '</button>'; }).join('') + '</div><div data-body></div>', { hold: true, onClose: refresh });
    var bodyEl = w.querySelector('[data-body]');
    function has(n) { return S().notesOf(S().get(s.id)).some(function (x) { return S().sameNote(x, n); }); }
    function row(n, title, sub) {
      var on = has(n);
      return '<button type="button" class="acm-row" data-n="' + esc(JSON.stringify(n)) + '"' + (on ? ' disabled' : '') + '><span class="acm-g"><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></span>' + (on ? '<span class="acm-tag">Added</span>' : '') + '</button>';
    }
    function draw() {
      w.querySelectorAll('[data-nt] button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-k') === tab); });
      if (tab === 'vault') {
        bodyEl.innerHTML = '<input class="acm-in" placeholder="Search the vault" data-q autocomplete="off"><div class="acm-card" data-res></div>' + btn('New session note', 'new-note', 'w');
        var q = bodyEl.querySelector('[data-q]'), res = bodyEl.querySelector('[data-res]');
        var list = function () {
          var v = q.value.trim().toLowerCase(), all = V().notes();
          var hit = all.filter(function (x) { return !v || x.path.toLowerCase().indexOf(v) >= 0; }).sort(function (a, b) {
            var ta = V().title(a.path).toLowerCase().indexOf(v) === 0 ? 0 : 1, tb = V().title(b.path).toLowerCase().indexOf(v) === 0 ? 0 : 1;
            return ta - tb || (b.mtime || b.updated_at || 0) - (a.mtime || a.updated_at || 0);
          }).slice(0, 25);
          res.innerHTML = hit.length ? hit.map(function (x) { return row({ kind: 'vault', path: x.path }, V().title(x.path), V().dirOf ? V().dirOf(x.path) : x.path); }).join('') : '<p class="acm-none">' + (all.length ? 'No note matches.' : 'The vault is empty or still loading.') + '</p>';
        };
        q.addEventListener('input', list); list();
        V().load().then(list, function () {});
      } else if (tab === 'gdoc') {
        bodyEl.innerHTML = '<form class="acm-form" data-gdoc><input class="acm-in" type="url" name="url" placeholder="Paste the link (docs.google.com/…)" required><input class="acm-in" name="title" placeholder="Title (optional)"><button class="acm-btn k w">Add the Doc</button>' +
          '<p class="acm-note">Docs, Sheets and Slides. Play shows it read-only, if this browser\'s Google account can open it; Open in Google Docs always works.</p></form>';
        bodyEl.querySelector('[data-gdoc]').addEventListener('submit', function (e) {
          e.preventDefault();
          var f = e.target, url = f.elements['url'].value.trim(), title = f.elements['title'].value.trim();
          if (!/^https:\/\/(docs|drive)\.google\.com\//.test(url)) { toast('That is not a Google Docs link.'); return; }
          S().addNote(s.id, { kind: 'gdoc', url: url, title: title || 'Google Doc' }).then(function () { w.close(); toast('Added to the session.'); });
        });
      } else {
        bodyEl.innerHTML = '<div class="acm-card" data-res><p class="acm-none">Loading…</p></div>';
        var SN = window.dgSessionNotes;
        (SN ? SN.load() : Promise.resolve([])).catch(function () { return []; }).then(function () {
          var res = bodyEl.querySelector('[data-res]'), pages = htmlPages();
          if (!res) return;
          res.innerHTML = pages.length ? pages.map(function (h) { return row({ kind: 'html', id: h.id, lang: htmlLang(h) }, h.title || h.id, 'Uploaded HTML page'); }).join('') : '<p class="acm-none">No uploaded pages yet. Add them under More, Uploaded pages.</p>';
        });
      }
    }
    w.addEventListener('click', function (e) {
      var t = e.target.closest('[data-nt] button');
      if (t) { tab = t.getAttribute('data-k'); draw(); return; }
      var r = e.target.closest('[data-n]');
      if (r && !r.disabled) {
        var n = JSON.parse(r.getAttribute('data-n'));
        S().addNote(s.id, n).then(function () { r.disabled = true; r.insertAdjacentHTML('beforeend', '<span class="acm-tag">Added</span>'); toast('Added to the session.'); });
        return;
      }
      if (e.target.closest('[data-acm="new-note"]')) w.close();
    });
    draw();
  }

  /* ── Writing a scene: the session note, with a bar over the keyboard ── */
  screen('scene', {
    tab: 'session',
    render: function (arg) {
      var s = sess();
      if (!s || !s.note_path) return { bar: { title: 'Session notes', back: true }, html: '<div class="acm-fold"><p class="acm-none">This session has no note yet.</p>' + btn('New session note', 'new-note', 'k w') + '</div>' };
      var md = ((V().get(s.note_path)) || {}).content || '', hs = V().headings(md, 2), t = arg && arg.title;
      return {
        keep: true, writing: true,
        bar: { title: s.name, sub: 'Saves itself to ' + s.note_path, back: true, right: [['check', 'back', 'Done']] },
        html: '<div class="acm-fold acm-write"><div class="acm-chips acm-scenetabs">' + hs.map(function (h) { return '<button type="button" class="acm-chip' + (t === h.title ? ' on' : '') + '" data-acm="scene" data-t="' + esc(h.title) + '">' + esc(h.title) + '</button>'; }).join('') +
          '<button type="button" class="acm-chip' + (!t ? ' on' : '') + '" data-acm="scene" data-t="">Whole note</button></div><div class="acm-ed"></div></div>' +
          '<div class="acm-ktool"><button type="button" data-kt="ev">Evidence</button><button type="button" data-kt="npc">NPC</button><button type="button" data-kt="link">[[ ]]</button><button type="button" data-kt="scene">New scene</button><button type="button" data-kt="done">Done</button></div>',
        after: function (el) {
          var ed = V().editor(el.querySelector('.acm-ed'), s.note_path, { hideHead: true, mode: 'edit', grow: true, scene: t ? { title: t } : null });
          var tool = el.querySelector('.acm-ktool');
          function ta() { return el.querySelector('.vn-ta'); }
          function insert(text, sel) {
            var x = ta();
            if (!x) return;
            var a = x.selectionStart || 0, b = x.selectionEnd || 0;
            x.value = x.value.slice(0, a) + text + x.value.slice(b);
            x.selectionStart = x.selectionEnd = a + (sel == null ? text.length : sel);
            x.focus();
            x.dispatchEvent(new Event('input', { bubbles: true }));
          }
          tool.addEventListener('pointerdown', function (e) { if (e.target.closest('[data-kt]')) e.preventDefault(); });
          tool.addEventListener('click', function (e) {
            var b = e.target.closest('[data-kt]');
            if (!b) return;
            var k = b.getAttribute('data-kt');
            if (k === 'link') insert('[[]]', 2);
            else if (k === 'scene') insert('\n\n## New scene\n\n', 5);
            else if (k === 'done') { var x = ta(); if (x) x.blur(); back(); }
            else if (k === 'ev') pickList('Link evidence', ((E() && E().items()) || []).filter(function (h) { return !s.cell_id || h.cell_id === s.cell_id; }).map(function (h) { return h.title || 'Untitled'; }), function (v) { insert('[[' + v + ']]'); });
            else if (k === 'npc') pickList('Link an NPC', s.npcs.map(function (n) { return n.name; }).concat(folderNpcs(s).map(function (n) { return n.name; })), function (v) { insert('[[' + v + ']]'); });
          });
          // The bar rides on the keyboard.
          function place() { var vv = window.visualViewport; if (!vv) return; tool.style.bottom = Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + 'px'; }
          if (window.visualViewport) { window.visualViewport.addEventListener('resize', place); window.visualViewport.addEventListener('scroll', place); }
          place();
          return function () { ed.destroy(); if (window.visualViewport) { window.visualViewport.removeEventListener('resize', place); window.visualViewport.removeEventListener('scroll', place); } };
        }
      };
    }
  });
  function pickList(title, items, done) {
    var w = sheet('<h2 class="acm-h">' + esc(title) + '</h2>' + (items.length ? '<div class="acm-card">' + items.map(function (t) { return '<button type="button" class="acm-row" data-v="' + esc(t) + '"><span class="acm-g"><b>' + esc(t) + '</b></span></button>'; }).join('') + '</div>' : '<p class="acm-none">Nothing to link yet.</p>'));
    w.addEventListener('click', function (e) { var b = e.target.closest('[data-v]'); if (b) { w.close(); done(b.getAttribute('data-v')); } });
  }

  /* ── The desktop's own panels, full-screen in the frame ── */
  function panelScreen(name, panel, title, tab, extra) {
    screen(name, Object.assign({ panel: panel, tab: tab, render: function () { return { bar: { title: title, sub: (sess() || {}).name || '', back: tab !== name && !/^(evidence)$/.test(name) } }; } }, extra || {}));
  }
  panelScreen('evidence', 'evidence', 'Evidence', 'evidence', { after: evidenceBar });
  /* Evidence on a phone: New evidence and one Filter sheet (List or
     Gallery, status, Cell, operation) that works the panel's own controls. */
  function evidenceBar() {
    var pe = document.getElementById('panel-evidence');
    var bar = document.getElementById('acm-evbar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'acm-evbar';
      bar.className = 'acm-evbar';
      pe.insertBefore(bar, pe.firstChild);
      bar.addEventListener('click', function (e) {
        if (e.target.closest('[data-ev="new"]')) { var s = sess(); if (E()) E().newItem(s ? { cell_id: s.cell_id, operation_id: s.operation_id } : null); }
        else if (e.target.closest('[data-ev="filter"]')) evFilterSheet();
      });
    }
    var st0 = evFilterState();
    bar.innerHTML = '<button type="button" class="acm-btn k" data-ev="new">' + I('add') + 'New evidence</button><button type="button" class="acm-btn" data-ev="filter">' + I('filter') + 'Filter' + (st0.n ? ' · ' + st0.n : '') + '</button>' +
      (st0.labels.length ? '<div class="acm-chips">' + st0.labels.map(function (l) { return '<span class="acm-chip on">' + esc(l) + '</span>'; }).join('') + '</div>' : '');
  }
  function evFilterState() {
    var chip = document.querySelector('#ac-ev-chips .ac-chip.on'), cellSel = document.getElementById('evidence-cell-filter'), op = document.querySelector('.evidence-folder-item.active, .evidence-folder-item.on');
    var gallery = !!document.querySelector('#evidence-view-switch [data-gv-view="gallery"].on, #evidence-view-switch [data-gv-view="gallery"][aria-pressed="true"]');
    var labels = [];
    if (chip && chip.getAttribute('data-f') !== 'all') labels.push(chip.textContent.replace(/\s*·.*$/, ''));
    if (cellSel && cellSel.value) labels.push(cellSel.options[cellSel.selectedIndex].text);
    if (op && op.getAttribute('data-op')) labels.push(op.querySelector('.evidence-folder-name').textContent);
    if (gallery) labels.push('Gallery');
    return { n: labels.length, labels: labels, gallery: gallery };
  }
  function evFilterSheet() {
    var chips = document.querySelectorAll('#ac-ev-chips .ac-chip'), cellSel = document.getElementById('evidence-cell-filter'), folders = document.querySelectorAll('.evidence-folder-item'), fs = evFilterState();
    var w = sheet('<h2 class="acm-h">Filter</h2>' + lab('Show as') + '<div class="acm-seg"><button type="button" class="' + (fs.gallery ? '' : 'on') + '" data-v="list">List</button><button type="button" class="' + (fs.gallery ? 'on' : '') + '" data-v="gallery">Gallery</button></div>' +
      lab('Status') + '<div class="acm-chips">' + Array.prototype.map.call(chips, function (c) { return '<button type="button" class="acm-chip' + (c.classList.contains('on') ? ' on' : '') + '" data-f="' + c.getAttribute('data-f') + '">' + esc(c.textContent) + '</button>'; }).join('') + '</div>' +
      lab('Cell') + '<select class="acm-in" data-cell>' + (cellSel ? Array.prototype.map.call(cellSel.options, function (o) { return '<option value="' + esc(o.value) + '"' + (o.value === cellSel.value ? ' selected' : '') + '>' + esc(o.text) + '</option>'; }).join('') : '') + '</select>' +
      (folders.length ? lab('Operation') + '<div class="acm-card">' + Array.prototype.map.call(folders, function (f) {
        var on = f.classList.contains('active') || f.classList.contains('on');
        return '<button type="button" class="acm-row' + (on ? ' on' : '') + '" data-op="' + esc(f.getAttribute('data-op')) + '"><span class="acm-g"><b>' + esc(f.querySelector('.evidence-folder-name').textContent) + '</b></span>' + (on ? I('check') : '') + '</button>';
      }).join('') + '</div>' : '') +
      '<div class="acm-g2">' + btn('Clear', 'evf-clear') + btn('Show', 'evf-done', 'k') + '</div>', { hold: true });
    w.addEventListener('click', function (e) {
      var v = e.target.closest('[data-v]'), f = e.target.closest('[data-f]'), o = e.target.closest('[data-op]'), done = e.target.closest('[data-acm="evf-done"]'), clr = e.target.closest('[data-acm="evf-clear"]');
      if (v) { var sw0 = document.querySelector('#evidence-view-switch [data-gv-view="' + v.getAttribute('data-v') + '"]'); if (sw0) sw0.click(); }
      else if (f) { var c = document.querySelector('#ac-ev-chips .ac-chip[data-f="' + f.getAttribute('data-f') + '"]'); if (c) c.click(); }
      else if (o) { var fo = document.querySelector('.evidence-folder-item[data-op="' + o.getAttribute('data-op') + '"]'); if (fo) fo.click(); }
      else if (clr) { var all = document.querySelector('#ac-ev-chips .ac-chip[data-f="all"]'); if (all) all.click(); if (cellSel && cellSel.value) { cellSel.value = ''; cellSel.dispatchEvent(new Event('change', { bubbles: true })); } var l = document.querySelector('#evidence-view-switch [data-gv-view="list"]'); if (l) l.click(); }
      else if (!done) return;
      e.stopPropagation();
      w.close();
      evidenceBar();
      if (!done && !clr) evFilterSheet();
    }, true);
    w.querySelector('[data-cell]').addEventListener('change', function (e) {
      if (!cellSel) return;
      cellSel.value = e.target.value; cellSel.dispatchEvent(new Event('change', { bubbles: true }));
      w.close(); evidenceBar(); evFilterSheet();
    });
  }
  document.addEventListener('dg-acell-evidence', function () { if (st.on && st.name === 'evidence') evidenceBar(); });
  panelScreen('music', 'music', 'Music', '@more');
  panelScreen('htmlpages', 'notes', 'Uploaded pages', '@more');
  panelScreen('sheet', 'sheet', 'Sheet', '@more');
  panelScreen('cells', 'cells', 'Cells', '@more');
  panelScreen('ids', 'ids', 'ID creator', '@more');
  panelScreen('debrief', 'debrief', 'Debrief', 'session', { mode: 'debrief' });
  panelScreen('prep-panels', 'session', 'Session prep', 'session');

  /* ── Clicks ── */
  root.addEventListener('click', function (e) {
    var g = e.target.closest('[data-acm-go]');
    if (g) {
      var to = g.getAttribute('data-acm-go');
      if (to.charAt(0) === '@' && to !== '@more') { closeSheets(); special(to); return; }
      go(to); return;
    }
    var md = e.target.closest('[data-acm-mode]');
    if (md) { closeSheets(); setMode(md.getAttribute('data-acm-mode')); return; }
    var b = e.target.closest('[data-acm]');
    if (!b) return;
    var a = b.getAttribute('data-acm'), s = sess();
    if (a.indexOf('go:') === 0) { go(a.slice(3)); return; }
    if (a.indexOf('add:') === 0) { if (ADD_ACTIONS[a.slice(4)]) ADD_ACTIONS[a.slice(4)](); return; }
    if (a.indexOf('sc:') === 0) { SHORTCUTS[a.slice(3)][1](); return; }
    if (a.indexOf('w:') === 0) {
      var w = a.slice(2);
      if (w === 'ev') go('desk', { seg: 'evidence' });
      else if (w === 'desk') go('desk');
      else if (w.indexOf('agent:') === 0) go('agent', w.slice(6));
      else if (w.indexOf('tape:') === 0) T().insert(w.slice(5)).then(function () { toast('Playing on CH ' + M().channel() + '.'); });
      return;
    }
    switch (a) {
      case 'back': back(); return;
      case 'sessions': sessionsSheet(); return;
      case 'pick-session': closeSheets(); S().setCurrent(b.getAttribute('data-id')); go('session', null, { replace: true }); return;
      case 'new-session': closeSheets(); go('new-session'); return;
      case 'new-op': closeSheets(); opSheet(); return;
      case 'session-actions': sessionActions(s); return;
      case 'agent': go('agent', b.getAttribute('data-code')); return;
      case 'desk': go('desk'); return;
      case 'seg': A.keep('dg_acm_deskseg', b.getAttribute('data-seg')); go('desk', { seg: b.getAttribute('data-seg') }, { replace: true }); return;
      case 'scene': go('scene', { title: b.getAttribute('data-t') || null }, { replace: st.name === 'scene' }); return;
      case 'add-scene': {
        var md = (V().get(s.note_path) || {}).content || '', n = V().headings(md, 2).length + 1;
        V().save(s.note_path, md.replace(/\s*$/, '') + '\n\n## Scene ' + n + '\n\n').then(function () { go('scene', { title: 'Scene ' + n }); });
        return;
      }
      case 'new-note': {
        var path = V().cleanPath(sessionsDir(s) + '/' + fileName(s.name));
        V().load().catch(function () {}).then(function () { return V().get(path) ? null : V().save(path, '# ' + s.name + '\n\n## Scene 1\n\n'); })
          .then(function () { return S().addNote(s.id, { kind: 'vault', path: path }); }).then(function () { go('desk', { seg: 'notes' }, { replace: true }); });
        return;
      }
      case 'pick-note': case 'note-add': noteSheet(s); return;
      case 'note-open': openSessNote(S().notesOf(s)[+b.getAttribute('data-i')]); return;
      case 'note-up': S().moveNote(s.id, +b.getAttribute('data-i')); return;
      case 'note-rm': {
        var rn = S().notesOf(s)[+b.getAttribute('data-i')];
        if (rn) S().removeNote(s.id, +b.getAttribute('data-i')).then(function () { toast('Taken off the session.'); });
        return;
      }
      case 'open-html': if (s.html_note && window.dgSessionNotes) window.dgSessionNotes.load().then(function () { window.dgSessionNotes.open(s.html_note.id, s.html_note.lang); }); return;
      case 'open-note': openNote(b.getAttribute('data-path')); return;
      case 'task': {
        var nt = V().get(s.note_path);
        if (nt) V().save(s.note_path, V().toggleTask(nt.content || '', +b.getAttribute('data-line')));
        return;
      }
      case 'release': {
        var on = !b.classList.contains('on');
        b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
        E().release(b.getAttribute('data-id'), on).then(function () { toast(on ? 'Released.' : 'Taken back.'); }, function (err) { b.classList.toggle('on', !on); toast((err && err.message) || String(err)); });
        return;
      }
      case 'ev-in': case 'ev-out': S().toggleIn(s.id, 'evidence', b.getAttribute('data-id')); return;
      case 'rm-npc': { var i = +b.getAttribute('data-i'); S().update(s.id, { npcs: s.npcs.filter(function (x, k) { return k !== i; }) }); return; }
      case 'add-npc': {
        var p = b.getAttribute('data-path'), nn = parseNpc((V().get(p) || {}).content);
        if (nn) S().update(s.id, { npcs: s.npcs.concat([Object.assign(nn, { path: p })]) });
        return;
      }
      case 'new-npc': npcSheet(); return;
      case 'deck-console': { var dc = b.getAttribute('data-ch'); if (M()) M().setChannel(dc); go('music'); return; }
      case 'deck-out': T().ejectCh(b.getAttribute('data-ch')).then(function () { toast('Tape out of CH ' + b.getAttribute('data-ch') + '.'); }); return;
      case 'tape-open': go('music'); setTimeout(function () { if (window.dgAcLibrary) window.dgAcLibrary.openTape(b.getAttribute('data-id')); }, 60); return;
      case 'tape-play': T().insert(b.getAttribute('data-id')).then(function () { go('music'); }); return;
      case 'blk': {
        var d = dash(), k = b.getAttribute('data-k');
        d.on[k] = !d.on[k]; saveDash(d);
        b.classList.toggle('on', d.on[k]); b.closest('.acm-wid').classList.toggle('off', !d.on[k]);
        return;
      }
      case 'sc-pick': {
        var d2 = dash(), k2 = b.getAttribute('data-k'), at = d2.shortcuts.indexOf(k2);
        if (at >= 0) d2.shortcuts.splice(at, 1); else { d2.shortcuts.push(k2); if (d2.shortcuts.length > 4) d2.shortcuts.shift(); }
        saveDash(d2); render(); return;
      }
    }
    if (SCREEN_ACTIONS[a]) SCREEN_ACTIONS[a](b, e);
  });
  var SCREEN_ACTIONS = {};
  fab.addEventListener('click', function () { if (fab.classList.contains('open')) closeSheets(); else addSheet(); });
  function special(to) {
    if (to === '@desk') { A.keep('dg_acm_desktop', true); check(); return; }
    if (to === '@out') { location.href = 'index.html'; return; }
    if (to === '@radio') { document.body.classList.toggle('acm-radio'); toast(document.body.classList.contains('acm-radio') ? 'The radio is showing. Tune in from More again to hide it.' : 'Radio hidden.'); return; }
  }

  /* ── On a phone: in; wider: out ── */
  function hideOuterWidgets(on) {
    try {
      if (!window.frameElement || window.parent === window) return;
      var pd = window.parent.document;
      pd.body.classList.toggle('acm-host', on);
      if (on && !pd.getElementById('acm-host-css')) {
        var s = pd.createElement('style');
        s.id = 'acm-host-css';
        s.textContent = 'body.acm-host #dr-panel, body.acm-host #dg-radio{display:none!important}';
        pd.head.appendChild(s);
      }
    } catch (e) { /* not ours */ }
  }
  function on() {
    if (st.on) return;
    st.on = true;
    if (!root.parentNode) document.body.appendChild(root);
    document.body.classList.add('acm');
    hideOuterWidgets(true);
    var m = A.store('dg_acell_mode', 'prep');
    st.mode = m === 'play' ? 'play' : m === 'debrief' ? 'debrief' : 'prep';
    document.body.setAttribute('data-ac-mode', st.mode);
    if (st.mode === 'play') markStartSoon();
    st.hist = [];
    st.name = '';
    go(st.mode === 'play' ? 'pads' : st.mode === 'debrief' ? 'debrief' : 'session', null, { replace: true });
  }
  function off() {
    if (!st.on) return;
    st.on = false;
    closeSheets();
    if (st.cleanup) { try { st.cleanup(); } catch (e) { /* gone */ } st.cleanup = null; }
    document.body.classList.remove('acm', 'acm-panel');
    hideOuterWidgets(false);
    if (root.parentNode) root.parentNode.removeChild(root);
    window.dgAcellTab(st.mode === 'play' ? 'desk' : st.mode === 'debrief' ? 'debrief' : 'session');
  }
  var backBtn = null;
  function check() {
    var phone = MQ.matches, desk = A.store('dg_acm_desktop', false);
    if (phone && !desk) on(); else off();
    // On a phone in the computer layout: a way back.
    if (phone && desk && !backBtn) {
      backBtn = document.createElement('button');
      backBtn.type = 'button'; backBtn.className = 'acm-back'; backBtn.textContent = 'Phone layout';
      backBtn.addEventListener('click', function () { backBtn.remove(); backBtn = null; A.keep('dg_acm_desktop', false); check(); });
      document.body.appendChild(backBtn);
    } else if (backBtn && (!phone || !desk)) { backBtn.remove(); backBtn = null; }
  }
  if (MQ.addEventListener) MQ.addEventListener('change', check); else if (MQ.addListener) MQ.addListener(check);
  window.addEventListener('pagehide', function () { hideOuterWidgets(false); });

  // The desktop's tabs opening themselves (Play from the last visit, a link
  // to a note) while the phone frame is up: follow along in the frame.
  document.addEventListener('dg-acell-tab', function (e) {
    if (!st.on) return;
    var t = e.detail.tab;
    if (t === 'desk') { if (st.mode !== 'play') { st.mode = 'play'; go('pads', null, { replace: true }); } return; }
    var want = { evidence: 'evidence', music: 'music', notes: 'vault', sheet: 'sheet', cells: 'cells', ids: 'ids', debrief: 'debrief', play: 'agent-sheet' }[t];
    if (t === 'notes' && /^(vault|vnote|vsearch|htmlpages)$/.test(st.name)) return;
    var def = SCREENS[st.name];
    if (want && (!def || def.panel !== t) && SCREENS[want] && st.name !== want) { st.hist.push([st.name, st.arg]); st.name = want; st.arg = null; render(); }
  });

  ['dg-sessions', 'dg-acell-roster', 'dg-acell-evidence', 'dg-acell-music', 'dg-tapes', 'dg-vault', 'dg-acell-seen'].forEach(function (ev) {
    document.addEventListener(ev, function () {
      var def = SCREENS[st.name];
      if (!def || def.panel) { if (st.on) { drawBar((def && def.render && def.render(st.arg) || {}).bar || {}); } return; }
      if (st.name === 'scene' || st.name === 'new-session' || st.name === 'customise') return;
      // A screen with a sig() redraws only when that changes (an embedded
      // Google Doc must not reload on every quick note).
      if (def.sig && def.sig(st.arg) === st.sig) return;
      refresh();
    });
  });
  var started = false;
  function start() {
    if (started) return;
    started = true;
    var D = T();
    Promise.all([D ? D.load().catch(function () {}) : null, V() ? V().load().catch(function () {}) : null]).then(function () { backfillOps(); refresh(); });
  }
  window.addEventListener('dg-acell-handler-ready', start);
  if (sessionStorage.getItem('dg_acell_pw')) setTimeout(start, 0);

  window.dgAcm = {
    go: go, back: back, screen: screen, sheet: sheet, closeSheets: closeSheets, refresh: refresh, toast: toast,
    mode: function () { return st.mode; }, setMode: setMode, on: function () { return st.on; }, current: function () { return st.name; },
    icon: I, photo: photo, plain: plain, sw: sw, btn: btn, lab: lab, initials: initials, agentsByDex: agentsByDex, opOf: opOf, operations: operations,
    npcNote: npcNote, npcSheet: npcSheet, agentNoteSheet: agentNoteSheet, folderNpcs: folderNpcs, parseNpc: parseNpc, npcDir: npcDir,
    ensureOpFolder: ensureOpFolder, backfillOps: backfillOps, actions: SCREEN_ACTIONS, add: ADD_ACTIONS, templates: templates,
    enable: function () { A.keep('dg_acm_desktop', false); check(); }
  };
  // After the other phone screens (acell-mobile-*.js) have registered.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', check); else setTimeout(check, 0);
})();
