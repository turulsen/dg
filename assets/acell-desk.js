/* A-Cell's Desk (v3.11.0): A-Cell's tabs as panels side by side, so the
   Handler can read a session note with the Agents' stats beside it.

   The panels are the real tab panels (#panel-play, #panel-music, …),
   moved onto the Desk, not copies: music keeps playing, Evidence files as
   usual. A session note opens docked (window.dgSessionNotes.open with a
   host). Every panel is placed absolutely inside the grid and never moved
   in the DOM after it's put down: moving an iframe reloads it, and the
   session note is one.

   Layout: { cols: [{ w, panes: [{ id, h }] }] }, widths and heights in
   per cent of the column/grid. A pane id is a tab ('play', 'music', …,
   'notes' for the Session Notes list) or 'note:<id>:<lang>' for an open
   page; only one page is open at a time. Kept on this device
   (localStorage dg_desk_v1), with named layouts beside the two built in.

   On a phone the panes stack: the first on top, the rest under it behind
   little tabs, with the divider between them. */
(function () {
  if (window.dgDesk) return;
  var KEY = 'dg_desk_v1';
  var TABS = {
    play: 'Play', cells: 'Cells', evidence: 'Evidence', sheet: 'Sheet',
    music: 'Music', notes: 'Session notes', ids: 'ID Creator'
  };
  var PRESETS = {
    Session: { cols: [{ w: 58, panes: [{ id: 'notes', h: 100 }] }, { w: 42, panes: [{ id: 'play', h: 62 }, { id: 'music', h: 38 }] }] },
    Prep: { cols: [{ w: 55, panes: [{ id: 'evidence', h: 100 }] }, { w: 45, panes: [{ id: 'cells', h: 100 }] }] }
  };
  var PHONE = 720;
  var suppressClick = false;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function store() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  function keep() { try { localStorage.setItem(KEY, JSON.stringify({ name: S.name, layout: S.layout, saved: S.saved, top: S.top, under: S.under })); } catch (e) { /* private mode */ } }

  var st0 = store();
  var S = {
    name: st0.name || 'Session',
    layout: st0.layout && st0.layout.cols ? st0.layout : clone(PRESETS.Session),
    saved: st0.saved || {},
    top: st0.top || 55,          // phone: the top slot's share
    under: st0.under || '',      // phone: which pane shows in the bottom slot
    max: '',                     // the pane filling the Desk (⤢)
    saving: false, menu: false
  };
  var root, grid, bar, awayEl, panes = {};   // panes[id] = element

  function isNote(id) { return id.indexOf('note:') === 0; }
  function noteParts(id) { var p = id.split(':'); return { id: p[1], lang: p[2] }; }
  function allIds() { var out = []; S.layout.cols.forEach(function (c) { c.panes.forEach(function (p) { out.push(p.id); }); }); return out; }
  function has(id) { return allIds().indexOf(id) >= 0; }
  function phone() { return window.innerWidth <= PHONE; }
  function titleOf(id) {
    if (!isNote(id)) return TABS[id] || id;
    var np = noteParts(id), n = ((window.dgSessionNotes && window.dgSessionNotes.notes()) || []).filter(function (x) { return x.id === np.id; })[0];
    return 'Session notes · ' + ((n && n.title) || '…') + ' · ' + np.lang.toUpperCase();
  }

  /* ── Panes ── */
  function paneEl(id) {
    if (panes[id]) return panes[id];
    var el = document.createElement('section');
    el.className = 'dk-pane';
    el.setAttribute('data-pane', id);
    el.innerHTML = '<div class="dk-ph"><span class="dk-grip" title="Drag to move" aria-hidden="true">&#10303;</span>' +
      '<span class="dk-tt"></span>' +
      '<button type="button" class="dk-ic" data-dk="max" title="Fill the Desk" aria-label="Fill the Desk">&#10530;</button>' +
      '<button type="button" class="dk-ic" data-dk="close" title="Take it off the Desk" aria-label="Take it off the Desk">&#10005;</button></div>' +
      '<div class="dk-pb"></div>';
    grid.appendChild(el);
    panes[id] = el;
    var body = el.querySelector('.dk-pb');
    if (isNote(id)) {
      var np = noteParts(id);
      body.classList.add('dk-note');
      body.innerHTML = '<div class="dk-wait">Opening…</div>';
      window.dgSessionNotes.load().then(function () {
        if (panes[id] !== el) return;
        body.innerHTML = '';
        if (!window.dgSessionNotes.open(np.id, np.lang, body)) body.innerHTML = '<div class="dk-wait">Could not open that page. ✕, then pick it again under Session notes.</div>';
        el.querySelector('.dk-tt').textContent = titleOf(id);
      });
    } else {
      var panel = document.getElementById('panel-' + id);
      if (panel) {
        panel.classList.add('active', 'dk-hosted');
        body.appendChild(panel);
      }
      document.dispatchEvent(new CustomEvent('dg-acell-tab', { detail: { tab: id, desk: true } }));
    }
    return el;
  }
  // Off the Desk: a tab's panel goes back into the folder (shown only on
  // its own tab); a session note closes.
  function dropPane(id) {
    var el = panes[id];
    if (!el) return;
    delete panes[id];
    if (isNote(id)) {
      var cur = window.dgSessionNotes && window.dgSessionNotes.current();
      if (cur && cur.docked && 'note:' + cur.id + ':' + cur.lang === id) window.dgSessionNotes.close();
    } else {
      var panel = document.getElementById('panel-' + id), body = document.querySelector('.folder-body');
      if (panel && body) {
        panel.classList.remove('dk-hosted');
        var tab = document.querySelector('#acell-tab-strip .tw[data-tab="' + id + '"]');
        panel.classList.toggle('active', !!(tab && tab.classList.contains('active')));
        body.appendChild(panel);
      }
    }
    el.remove();
  }

  /* ── Layout ── */
  function normalize() {
    var cols = S.layout.cols.filter(function (c) { return c.panes.length; });
    if (!cols.length) cols = [];
    var tw = cols.reduce(function (a, c) { return a + (c.w || 1); }, 0) || 1;
    cols.forEach(function (c) {
      c.w = (c.w || 1) * 100 / tw;
      var th = c.panes.reduce(function (a, p) { return a + (p.h || 1); }, 0) || 1;
      c.panes.forEach(function (p) { p.h = (p.h || 1) * 100 / th; });
    });
    S.layout.cols = cols;
  }
  // live: a divider is being dragged -- move the dividers that are there
  // (the one under the pointer must stay the same element) and save later.
  var live = false, liveN = 0;
  function place(isLive) {
    normalize();
    var ids = allIds();
    live = !!isLive; liveN = 0;
    if (live) { if (phone()) placePhone(ids); else placeCols(); live = false; return; }
    Object.keys(panes).forEach(function (id) { if (ids.indexOf(id) < 0) dropPane(id); });
    ids.forEach(paneEl);
    Array.prototype.forEach.call(grid.querySelectorAll('.dk-split, .dk-ptabs'), function (n) { n.remove(); });
    grid.classList.toggle('dk-phone', phone());
    grid.classList.toggle('dk-has-max', !!S.max && has(S.max));
    var empty = root.querySelector('.dk-empty');
    empty.hidden = ids.length > 0;
    if (phone()) placePhone(ids); else placeCols();
    ids.forEach(function (id) {
      var el = panes[id];
      el.classList.toggle('dk-max', S.max === id);
      el.querySelector('.dk-tt').textContent = titleOf(id);
      var mx = el.querySelector('[data-dk="max"]');
      mx.innerHTML = S.max === id ? '&#10529;' : '&#10530;';
      mx.title = S.max === id ? 'Back to the layout' : 'Fill the Desk';
    });
    renderBar();
    keep();
  }
  function setBox(el, l, t, w, h) { el.style.left = l + '%'; el.style.top = t + '%'; el.style.width = w + '%'; el.style.height = h + '%'; el.hidden = false; }
  function placeCols() {
    var x = 0;
    S.layout.cols.forEach(function (c, ci) {
      var y = 0;
      c.panes.forEach(function (p, pi) {
        setBox(panes[p.id], x, y, c.w, p.h);
        if (pi < c.panes.length - 1) split('h', ci, pi, x, y + p.h, c.w);
        y += p.h;
      });
      x += c.w;
      if (ci < S.layout.cols.length - 1) split('v', ci, -1, x, 0, 0);
    });
  }
  function placePhone(ids) {
    if (ids.length === 1) { setBox(panes[ids[0]], 0, 0, 100, 100); return; }
    var top = Math.max(20, Math.min(80, S.top)), rest = ids.slice(1);
    if (rest.indexOf(S.under) < 0) S.under = rest[0];
    setBox(panes[ids[0]], 0, 0, 100, top);
    split('p', -1, -1, 0, top, 100);
    var tabs = live ? grid.querySelector('.dk-ptabs') : document.createElement('div');
    if (!live) {
      tabs.className = 'dk-ptabs';
      tabs.innerHTML = rest.map(function (id) { return '<button type="button" data-dk-under="' + esc(id) + '" class="' + (id === S.under ? 'on' : '') + '">' + esc(isNote(id) ? 'Notes' : TABS[id]) + '</button>'; }).join('');
      grid.appendChild(tabs);
    }
    if (tabs) tabs.style.top = 'calc(' + top + '% + 14px)';
    rest.forEach(function (id) {
      var el = panes[id];
      el.hidden = id !== S.under;
      el.style.left = '0%'; el.style.width = '100%';
      el.style.top = 'calc(' + top + '% + 46px)'; el.style.height = 'calc(' + (100 - top) + '% - 46px)';
    });
  }

  /* ── Dividers ── */
  function split(kind, ci, pi, x, y, w) {
    if (live) {
      var old = grid.querySelectorAll('.dk-split')[liveN++];
      if (old) { old.style.left = x + '%'; if (kind !== 'v') { old.style.top = y + '%'; old.style.width = w + '%'; } }
      return;
    }
    var d = document.createElement('div');
    d.className = 'dk-split dk-split-' + kind;
    d.setAttribute('role', 'separator');
    if (kind === 'v') { d.style.left = x + '%'; }
    else { d.style.left = x + '%'; d.style.top = y + '%'; d.style.width = w + '%'; }
    d.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      var r = grid.getBoundingClientRect(), cols = S.layout.cols;
      d.setPointerCapture(e.pointerId);
      grid.classList.add('dk-resizing');
      function move(ev) {
        if (kind === 'v') {
          var a = cols[ci], b = cols[ci + 1], left = cols.slice(0, ci).reduce(function (s, c) { return s + c.w; }, 0);
          var px = (ev.clientX - r.left) / r.width * 100, tot = a.w + b.w;
          a.w = Math.max(15, Math.min(tot - 15, px - left)); b.w = tot - a.w;
        } else if (kind === 'h') {
          var col = cols[ci], above = col.panes.slice(0, pi).reduce(function (s, p) { return s + p.h; }, 0);
          var py = (ev.clientY - r.top) / r.height * 100, pa = col.panes[pi], pb = col.panes[pi + 1], t2 = pa.h + pb.h;
          pa.h = Math.max(12, Math.min(t2 - 12, py - above)); pb.h = t2 - pa.h;
        } else {
          S.top = Math.max(20, Math.min(80, (ev.clientY - r.top) / r.height * 100));
        }
        place(true);
      }
      function up() { grid.classList.remove('dk-resizing'); place(); d.removeEventListener('pointermove', move); d.removeEventListener('pointerup', up); d.removeEventListener('pointercancel', up); }
      d.addEventListener('pointermove', move); d.addEventListener('pointerup', up); d.addEventListener('pointercancel', up);
    });
    grid.appendChild(d);
  }

  /* ── Moving a pane: drag it by its grip onto another pane's edge ── */
  function where(id) {
    var out = null;
    S.layout.cols.forEach(function (c, ci) { c.panes.forEach(function (p, pi) { if (p.id === id) out = { ci: ci, pi: pi }; }); });
    return out;
  }
  function take(id) {
    var w = where(id);
    if (!w) return null;
    var p = S.layout.cols[w.ci].panes.splice(w.pi, 1)[0];
    return p;
  }
  // zone: 'left' | 'right' (a new column beside the target's) or 'top' | 'bottom' (in its column)
  function moveTo(id, target, zone) {
    if (id === target) return;
    var p = take(id);
    if (!p) return;
    var t = where(target);
    if (!t) { S.layout.cols.push({ w: 30, panes: [p] }); place(); return; }
    var col = S.layout.cols[t.ci];
    if (zone === 'left' || zone === 'right') {
      var half = col.w / 2; col.w = half;
      p.h = 100;
      S.layout.cols.splice(t.ci + (zone === 'right' ? 1 : 0), 0, { w: half, panes: [p] });
    } else {
      var tp = col.panes[t.pi]; p.h = tp.h / 2; tp.h = tp.h / 2;
      col.panes.splice(t.pi + (zone === 'bottom' ? 1 : 0), 0, p);
    }
    place();
  }
  // Phone: the stack shows only two panes, so a drop swaps the two.
  function swap(a, b) {
    if (a === b) return;
    var wa = where(a), wb = where(b);
    if (!wa || !wb) return;
    S.layout.cols[wa.ci].panes[wa.pi].id = b;
    S.layout.cols[wb.ci].panes[wb.pi].id = a;
    var first = allIds()[0];
    // Whichever of the two went under shows in the bottom slot.
    S.under = first === a ? b : first === b ? a : S.under;
    place();
  }
  function zoneAt(el, x, y) {
    var r = el.getBoundingClientRect(), fx = (x - r.left) / r.width, fy = (y - r.top) / r.height;
    if (phone()) return fy < .5 ? 'top' : 'bottom';
    if (fx < .25) return 'left';
    if (fx > .75) return 'right';
    return fy < .5 ? 'top' : 'bottom';
  }
  // By the boxes, not elementFromPoint: the Radio pill and the Dice
  // Roller float over the Desk, and an iframe would answer for its pane.
  function hitAt(x, y) {
    var els = Array.prototype.slice.call(grid.querySelectorAll('.dk-ptabs [data-dk-under], .dk-pane:not([hidden])'));
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      if (r.width && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return els[i];
    }
    return null;
  }
  function startDrag(id, e) {
    var src = panes[id], ghost = null, drop = root.querySelector('.dk-drop'), target = null, zone = '';
    var sx = e.clientX, sy = e.clientY, moved = false;
    function move(ev) {
      if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 6) return;
      if (!moved) {
        moved = true;
        ghost = document.createElement('div');
        ghost.className = 'dk-ghost';
        ghost.textContent = titleOf(id);
        document.body.appendChild(ghost);
        src.classList.add('dk-lifted');
        // An iframe under the pointer would swallow the moves.
        document.documentElement.classList.add('dk-dragging');
      }
      ghost.style.left = ev.clientX + 12 + 'px'; ghost.style.top = ev.clientY + 8 + 'px';
      var over = hitAt(ev.clientX, ev.clientY);
      target = over && over !== src ? (over.getAttribute('data-pane') || over.getAttribute('data-dk-under')) : null;
      if (target === id) target = null;
      if (!target) { drop.hidden = true; return; }
      zone = phone() ? 'swap' : zoneAt(over, ev.clientX, ev.clientY);
      var r = over.getBoundingClientRect(), g = grid.getBoundingClientRect(), b = { l: r.left - g.left, t: r.top - g.top, w: r.width, h: r.height };
      if (zone === 'left') b.w /= 2; else if (zone === 'right') { b.l += b.w / 2; b.w /= 2; } else if (zone === 'top') b.h /= 2; else if (zone === 'bottom') { b.t += b.h / 2; b.h /= 2; }
      drop.style.left = b.l + 'px'; drop.style.top = b.t + 'px'; drop.style.width = b.w + 'px'; drop.style.height = b.h + 'px';
      drop.textContent = { left: 'Beside it, left', right: 'Beside it, right', top: 'Above it', bottom: 'Under it', swap: 'Swap places' }[zone];
      drop.hidden = false;
    }
    function up() {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up);
      if (ghost) ghost.remove();
      src.classList.remove('dk-lifted');
      document.documentElement.classList.remove('dk-dragging');
      drop.hidden = true;
      if (moved) suppressClick = true;
      if (moved && target) { if (zone === 'swap') swap(id, target); else moveTo(id, target, zone); }
    }
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
  }

  /* ── Adding, opening, layouts ── */
  function add(id) {
    if (has(id)) { flash(id); return; }
    var cols = S.layout.cols;
    if (!cols.length) cols.push({ w: 100, panes: [] });
    // Into the column with the fewest panes.
    var c = cols.slice().sort(function (a, b) { return a.panes.length - b.panes.length; })[0];
    c.panes.push({ id: id, h: c.panes.length ? 100 / c.panes.length : 100 });
    S.max = '';
    place();
  }
  function flash(id) { var el = panes[id]; if (!el) return; el.classList.remove('dk-flash'); void el.offsetWidth; el.classList.add('dk-flash'); }
  // A session note on the Desk: in place of the one already open, else of
  // the Session notes list, else added. Opens the Desk.
  function openNote(id, lang) {
    var nid = 'note:' + id + ':' + lang, swap = allIds().filter(isNote)[0] || (has('notes') ? 'notes' : '');
    if (swap && swap !== nid) {
      S.layout.cols.forEach(function (c) { c.panes.forEach(function (p) { if (p.id === swap) p.id = nid; }); });
      dropPane(swap);
    } else if (!swap) add(nid);
    show();
    place();
  }
  function useLayout(name) {
    var l = PRESETS[name] || S.saved[name];
    if (!l) return;
    // A layout that holds the Session notes list keeps the page that's open.
    var openNoteId = allIds().filter(isNote)[0];
    S.layout = clone(l);
    if (openNoteId) S.layout.cols.forEach(function (c) { c.panes.forEach(function (p) { if (p.id === 'notes') p.id = openNoteId; }); });
    S.name = name; S.max = '';
    place();
  }
  function show() {
    var t = document.querySelector('#acell-tab-strip .tw[data-tab="desk"]');
    if (t && !t.classList.contains('active')) t.click();
  }

  /* ── The bar ── */
  function renderBar() {
    var names = Object.keys(PRESETS).concat(Object.keys(S.saved));
    var addable = Object.keys(TABS).filter(function (k) { return !has(k); });
    bar.innerHTML = '<span class="dk-lbl">Layout</span>' +
      names.map(function (n) { return '<button type="button" class="paper-btn dk-lay' + (n === S.name ? ' dk-on' : '') + '" data-dk-lay="' + esc(n) + '">' + esc(n) + '</button>'; }).join('') +
      (S.saving ? '<input type="text" class="dk-name" maxlength="24" placeholder="Name this layout" aria-label="Name this layout"><button type="button" class="paper-btn" data-dk="save-ok">Save</button><button type="button" class="paper-btn" data-dk="save-no">Cancel</button>'
        : '<button type="button" class="paper-btn" data-dk="save">+ Save as…</button>') +
      (S.saved[S.name] ? '<button type="button" class="paper-btn" data-dk="forget" title="Forget this layout">Forget</button>' : '') +
      '<span class="dk-sp"></span>' +
      '<span class="dk-addw"><button type="button" class="paper-btn primary" data-dk="add" aria-expanded="' + S.menu + '">+ Add panel &#9662;</button>' +
      (S.menu ? '<div class="dk-menu" role="menu">' + Object.keys(TABS).map(function (k) {
        return '<button type="button" role="menuitem" data-dk-add="' + k + '"' + (addable.indexOf(k) < 0 ? ' disabled' : '') + '>' + esc(TABS[k]) + (addable.indexOf(k) < 0 ? ' <i>(on the Desk)</i>' : '') + '</button>';
      }).join('') + '</div>' : '') + '</span>' +
      '<button type="button" class="paper-btn" data-dk="reset" title="Back to the Session layout">&#10226; Reset</button>';
    if (S.saving) { var i = bar.querySelector('.dk-name'); if (i) i.focus(); }
  }
  function saveAs() {
    var i = bar.querySelector('.dk-name'), n = i ? i.value.trim() : '';
    if (!n || PRESETS[n]) { if (i) i.focus(); return; }
    S.saved[n] = clone(S.layout); S.name = n; S.saving = false;
    place();
  }

  /* ── The away note on a tab that's on the Desk ── */
  function onTab(e) {
    var id = e.detail.tab;
    if (e.detail.desk) return;
    document.documentElement.classList.toggle('dk-desk-on', id === 'desk');
    if (id === 'desk') { place(); return; }
    var away = !!panes[id] && !document.querySelector('.folder-body > #panel-' + id);
    awayEl.classList.toggle('active', away);
    if (away) awayEl.querySelector('.dk-away-t').textContent = TABS[id] + ' is on the Desk.';
    awayEl.setAttribute('data-away', away ? id : '');
  }

  function init() {
    var strip = document.getElementById('acell-tab-strip'), body = document.querySelector('.folder-body');
    if (!strip || !body) return;
    root = document.getElementById('panel-desk');
    if (!root) return;
    root.innerHTML = '<div class="dk-bar"></div><div class="dk-grid"><div class="dk-drop" hidden></div>' +
      '<div class="dk-empty" hidden>The Desk is empty. <b>+ Add panel</b> puts a tab here, or pick a layout.</div></div>';
    bar = root.querySelector('.dk-bar'); grid = root.querySelector('.dk-grid');
    awayEl = document.createElement('div');
    awayEl.className = 'tab-panel dk-away';
    awayEl.innerHTML = '<p class="dk-away-t"></p><div class="dk-away-b"><button type="button" class="paper-btn primary" data-dk-away="go">&#9638; Open the Desk</button>' +
      '<button type="button" class="paper-btn" data-dk-away="back">Take it back</button></div>';
    body.appendChild(awayEl);
    awayEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-dk-away]'), id = awayEl.getAttribute('data-away');
      if (!b || !id) return;
      if (b.getAttribute('data-dk-away') === 'go') { show(); return; }
      take(id); place();
      var t = strip.querySelector('.tw[data-tab="' + id + '"]'); if (t) t.click();
    });
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var a = b.getAttribute('data-dk');
      if (b.hasAttribute('data-dk-lay')) { useLayout(b.getAttribute('data-dk-lay')); return; }
      if (b.hasAttribute('data-dk-add')) { S.menu = false; add(b.getAttribute('data-dk-add')); return; }
      if (a === 'add') { S.menu = !S.menu; renderBar(); return; }
      if (a === 'save') { S.saving = true; renderBar(); return; }
      if (a === 'save-no') { S.saving = false; renderBar(); return; }
      if (a === 'save-ok') { saveAs(); return; }
      if (a === 'forget') { delete S.saved[S.name]; S.name = 'Session'; place(); return; }
      if (a === 'reset') { useLayout('Session'); return; }
    });
    bar.addEventListener('keydown', function (e) {
      if (e.target.classList.contains('dk-name') && e.key === 'Enter') { e.preventDefault(); saveAs(); }
      if (e.key === 'Escape') { S.menu = false; S.saving = false; renderBar(); }
    });
    document.addEventListener('click', function (e) {
      if (S.menu && bar && !e.target.closest('.dk-addw')) { S.menu = false; renderBar(); }
    });
    grid.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var under = b.getAttribute('data-dk-under');
      if (under) { S.under = under; place(); return; }
      var pane = b.closest('.dk-pane');
      if (!pane || !b.closest('.dk-ph')) return;
      var id = pane.getAttribute('data-pane'), a = b.getAttribute('data-dk');
      if (a === 'max') { S.max = S.max === id ? '' : id; place(); }
      if (a === 'close') { take(id); if (S.max === id) S.max = ''; place(); }
    });
    // A pane moves by its whole title bar (the grip was too small a
    // target for a finger), and on a phone by its little tab too.
    grid.addEventListener('pointerdown', function (e) {
      if (e.button > 0) return;
      var u = e.target.closest('[data-dk-under]');
      if (u) { startDrag(u.getAttribute('data-dk-under'), e); return; }
      var h = e.target.closest('.dk-ph');
      if (!h || e.target.closest('button')) return;
      e.preventDefault();
      startDrag(h.closest('.dk-pane').getAttribute('data-pane'), e);
    });
    // A drag that ends on a tab mustn't also count as a tap on it.
    grid.addEventListener('click', function (e) {
      if (suppressClick) { suppressClick = false; e.stopPropagation(); e.preventDefault(); }
    }, true);
    grid.addEventListener('pointerdown', function () { suppressClick = false; }, true);
    // A docked page closed from its own bar comes off the Desk.
    document.addEventListener('dg-sn-closed', function (e) {
      var id = 'note:' + e.detail.id + ':' + e.detail.lang;
      if (!panes[id]) return;
      S.layout.cols.forEach(function (c) { c.panes.forEach(function (p) { if (p.id === id) p.id = 'notes'; }); });
      var el = panes[id]; delete panes[id]; el.remove();
      place();
    });
    document.addEventListener('dg-acell-tab', onTab);
    var t;
    window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(function () { if (root.classList.contains('active')) place(); }, 120); });
    if (root.classList.contains('active')) place();
  }

  window.dgDesk = {
    openNote: openNote, add: add, useLayout: useLayout, moveTo: moveTo,
    layout: function () { return clone(S.layout); }, panes: function () { return allIds(); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
