/* The combat mat (2026-11-17): a shared drawing board on a dot grid.

   One mat per Cell, mats/{cellId} in Firestore (Handler writes, anyone
   reads, like radio/{channel}):
     { title, scale (metres per dot), shown, items: [...], bg, ruler,
       dots: 'black'|'white', agents_move (false: the Agents can't move
       their tokens), updated_at }
   and mats/{cellId}/moves/{agentCode}: { x, y, at } -- where an Agent
   dragged their own token in the notebook (2026-11-18). It overrides the
   token's spot on both sides until the Handler moves that token again
   (which deletes it).
   Everything is in dots (map units): an item is
     { id, t: 'path'|'rect'|'circle'|'text'|'token'|'agent', x, y, w, h,
       r (degrees), c (colour), sw (line width), pts: [[x, y], ...] (path),
       text, tok (token kind), code, name, photo (agent), label;
       an NPC from the session's Initiative (t: 'npc'): key (their name,
       lower case), name, photo, hid (hidden: the Handler's eyes only),
       out (down, or out of the order: greyed) }
   bg: { url, x, y, w, h, op (0..1), locked }.

   window.dgMat.editor(host, { cellId, members: [{ code, name, photo }] })
     -- A-Cell's Play desk: draw, place, measure, the background photo.
   window.dgMat.view(host, { cellId, code })
     -- the Agents' notebook: the same mat, live and read-only; they zoom,
     pan and measure on their own screen. Their own token is ringed.
   Both return { destroy() }. */
(function () {
  if (window.dgMat) return;
  var NS = 'http://www.w3.org/2000/svg';
  var COLORS = ['#2a2418', '#a3221c', '#2f6b8f', '#3f7a3a', '#c9a227', '#ffffff'];
  var WIDTHS = [0.12, 0.3, 0.9, 2.2];
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function uid() { return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function r2(n) { return Math.round(n * 100) / 100; }
  function initials(n) { return String(n || '?').split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase(); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ── Tokens: drawn here, so nothing to license. Size in metres; each is
     drawn in a box from (0,0) to (w,h). ── */
  function car(body, glass) {
    return function (w, h) {
      return '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="' + body + '" stroke="#1c120a" stroke-width=".08"/>' +
        '<rect x="' + w * .14 + '" y="' + h * .2 + '" width="' + w * .72 + '" height="' + h * .2 + '" fill="' + glass + '" stroke="#1c120a" stroke-width=".05"/>' +
        '<rect x="' + w * .14 + '" y="' + h * .68 + '" width="' + w * .72 + '" height="' + h * .14 + '" fill="' + glass + '" stroke="#1c120a" stroke-width=".05"/>';
    };
  }
  function person(fill) {
    return function (w, h) { return '<circle cx="' + w / 2 + '" cy="' + h / 2 + '" r="' + Math.min(w, h) * .42 + '" fill="' + fill + '" stroke="#1c120a" stroke-width=".07"/><circle cx="' + w / 2 + '" cy="' + h / 2 + '" r="' + Math.min(w, h) * .16 + '" fill="#1c120a" opacity=".55"/>'; };
  }
  var TOKENS = {
    sedan: { name: 'Sedan', w: 2, h: 4.5, draw: car('#7a1f1a', '#cfe0ea') },
    van: { name: 'Van', w: 2.2, h: 5.2, draw: function (w, h) { return car('#d9d2c0', '#cfe0ea')(w, h) + '<rect x="0" y="' + h * .45 + '" width="' + w + '" height="' + h * .2 + '" fill="#bdb49c"/>'; } },
    police: { name: 'Police car', w: 2, h: 4.6, draw: function (w, h) { return car('#1f2a3a', '#cfe0ea')(w, h) + '<rect x="' + w * .2 + '" y="' + h * .45 + '" width="' + w * .3 + '" height="' + h * .07 + '" fill="#c0392b"/><rect x="' + w * .5 + '" y="' + h * .45 + '" width="' + w * .3 + '" height="' + h * .07 + '" fill="#2e6fd1"/>'; } },
    motorbike: { name: 'Motorbike', w: 0.8, h: 2.1, draw: function (w, h) { return '<rect x="' + w * .3 + '" y="0" width="' + w * .4 + '" height="' + h + '" fill="#2a2418"/><rect x="0" y="' + h * .2 + '" width="' + w + '" height="' + h * .08 + '" fill="#2a2418"/><circle cx="' + w / 2 + '" cy="' + h * .55 + '" r="' + w * .32 + '" fill="#7a1f1a"/>'; } },
    person: { name: 'Person', w: 1, h: 1, draw: person('#e9dfbf') },
    enemy: { name: 'Enemy', w: 1, h: 1, draw: person('#a3221c') },
    civilian: { name: 'Civilian', w: 1, h: 1, draw: person('#8fae7a') },
    door: { name: 'Door', w: 1.2, h: 0.3, draw: function (w, h) { return '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="#8b5a2b" stroke="#1c120a" stroke-width=".05"/><path d="M0 ' + h + ' A ' + w + ' ' + w + ' 0 0 1 ' + w + ' ' + (h - w) + '" fill="none" stroke="#1c120a" stroke-width=".04" stroke-dasharray=".1 .08"/>'; } },
    crate: { name: 'Crate', w: 1, h: 1, draw: function (w, h) { return '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="#b38a4f" stroke="#1c120a" stroke-width=".07"/><path d="M0 0 L' + w + ' ' + h + ' M' + w + ' 0 L0 ' + h + '" stroke="#6b4a22" stroke-width=".06"/>'; } },
    tree: { name: 'Tree', w: 3, h: 3, draw: function (w, h) { return '<circle cx="' + w / 2 + '" cy="' + h / 2 + '" r="' + w * .48 + '" fill="#4f6b3c" opacity=".85"/><circle cx="' + w * .4 + '" cy="' + h * .4 + '" r="' + w * .22 + '" fill="#62804c"/><circle cx="' + w / 2 + '" cy="' + h / 2 + '" r="' + w * .07 + '" fill="#5a3d22"/>'; } },
    lamp: { name: 'Lamp post', w: 0.6, h: 0.6, draw: function (w, h) { return '<circle cx="' + w / 2 + '" cy="' + h / 2 + '" r="' + w * .5 + '" fill="#f2d98a" opacity=".55"/><circle cx="' + w / 2 + '" cy="' + h / 2 + '" r="' + w * .18 + '" fill="#2a2418"/>'; } }
  };

  function fb() { return window.firebase; }
  function signedIn() { var A = window.dgAcellApi; return A && A.signedIn ? A.signedIn() : A.handler(); }
  function matRef(cellId) { return fb().firestore().collection('mats').doc(cellId); }
  function movesRef(cellId) { return matRef(cellId).collection('moves'); }
  var DOTS = { black: '#1c120a', white: '#ffffff' };
  function readMoves(snap) {
    var out = {};
    snap.forEach(function (d) { var v = d.data() || {}; if (typeof v.x === 'number' && typeof v.y === 'number') out[d.id] = { x: v.x, y: v.y, at: v.at || 0 }; });
    return out;
  }
  // An Agent's token where they last dragged it (moves/{code}), if they did.
  function placed(it, moves) {
    var m = it.t === 'agent' && moves && moves[it.code];
    return m ? Object.assign({}, it, { x: m.x, y: m.y }) : it;
  }

  /* ── Drawing the mat (both sides) ── */
  function itemSvg(it, opts) {
    var c = it.c || '#2a2418', sw = it.sw || 0.12, tr = it.r ? ' transform="rotate(' + it.r + ' ' + (it.x + it.w / 2) + ' ' + (it.y + it.h / 2) + ')"' : '';
    var data = ' data-id="' + esc(it.id) + '"';
    if (it.t === 'path') {
      if (!it.pts || it.pts.length < 2) return '';
      var d = 'M' + it.pts.map(function (p) { return p[0] + ' ' + p[1]; }).join(' L');
      return '<path' + data + ' d="' + d + '" fill="none" stroke="' + c + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round"' + (sw >= 1 ? ' opacity=".55"' : '') + '/>';
    }
    if (it.t === 'rect') return '<rect' + data + tr + ' x="' + it.x + '" y="' + it.y + '" width="' + it.w + '" height="' + it.h + '" fill="' + (it.fill || 'rgba(205,191,152,.55)') + '" stroke="' + c + '" stroke-width="' + Math.max(.06, sw) + '"/>' +
      (it.label ? '<text x="' + (it.x + .3) + '" y="' + (it.y + .9) + '" font-size=".75" font-family="Courier Prime,monospace" fill="#2a2418"' + tr + '>' + esc(it.label) + '</text>' : '');
    if (it.t === 'circle') return '<ellipse' + data + ' cx="' + (it.x + it.w / 2) + '" cy="' + (it.y + it.h / 2) + '" rx="' + it.w / 2 + '" ry="' + it.h / 2 + '" fill="' + (it.fill || 'rgba(217,207,178,.55)') + '" stroke="' + c + '" stroke-width="' + Math.max(.06, sw) + '"/>' +
      (it.label ? '<text x="' + (it.x + it.w / 2) + '" y="' + (it.y + it.h / 2 + .25) + '" text-anchor="middle" font-size=".75" font-family="Courier Prime,monospace" fill="#2a2418">' + esc(it.label) + '</text>' : '');
    if (it.t === 'text') return '<text' + data + tr + ' x="' + it.x + '" y="' + (it.y + (it.size || 1)) + '" font-size="' + (it.size || 1) + '" font-family="Courier Prime,monospace" font-weight="700" fill="' + c + '">' + esc(it.text) + '</text>';
    if (it.t === 'token') {
      var T = TOKENS[it.tok] || TOKENS.crate;
      return '<g' + data + ' transform="translate(' + it.x + ' ' + it.y + ')' + (it.r ? ' rotate(' + it.r + ' ' + it.w / 2 + ' ' + it.h / 2 + ')' : '') + '">' + T.draw(it.w, it.h) +
        '<rect x="0" y="0" width="' + it.w + '" height="' + it.h + '" fill="transparent"/></g>' +
        (it.label ? '<text x="' + (it.x + it.w / 2) + '" y="' + (it.y + it.h + .75) + '" text-anchor="middle" font-size=".6" font-family="Courier Prime,monospace" fill="#2a2418" paint-order="stroke" stroke="#efe6cc" stroke-width=".15">' + esc(it.label) + '</text>' : '');
    }
    if (it.t === 'npc') {
      var nx = it.x + it.w / 2, ny = it.y + it.h / 2, nr = Math.min(it.w, it.h) / 2, nclip = 'cl' + it.id;
      var col = it.out ? '#7a7a7a' : '#a3221c';
      var nface = /^(https?:|data:)/.test(it.photo || '') && !it.hid
        ? '<clipPath id="' + nclip + '"><circle cx="' + nx + '" cy="' + ny + '" r="' + nr * .9 + '"/></clipPath><image href="' + esc(it.photo) + '" x="' + (nx - nr) + '" y="' + (ny - nr) + '" width="' + nr * 2 + '" height="' + nr * 2 + '" preserveAspectRatio="xMidYMid slice" clip-path="url(#' + nclip + ')"' + (it.out ? ' opacity=".5"' : '') + '/>'
        : '<text x="' + nx + '" y="' + (ny + nr * .3) + '" text-anchor="middle" font-size="' + nr * .8 + '" font-family="Courier Prime,monospace" font-weight="700" fill="' + (it.hid ? col : '#fff') + '">' + esc(initials(it.name)) + '</text>';
      return '<g' + data + ' class="mt-npc' + (it.hid ? ' mt-hid' : '') + (it.out ? ' mt-out' : '') + '"' + (it.out ? ' opacity=".7"' : '') + '><circle cx="' + nx + '" cy="' + ny + '" r="' + nr + '" fill="' + (it.hid ? 'rgba(239,230,204,.6)' : col) + '" stroke="' + col + '" stroke-width="' + nr * .2 + '"' + (it.hid ? ' stroke-dasharray="' + nr * .35 + ' ' + nr * .25 + '"' : '') + '/>' + nface +
        '<text x="' + nx + '" y="' + (ny + nr + .7) + '" text-anchor="middle" font-size=".55" font-family="Courier Prime,monospace" fill="#2a2418" paint-order="stroke" stroke="#efe6cc" stroke-width=".15">' + esc(it.name || '') + '</text></g>';
    }
    if (it.t === 'agent') {
      var cx = it.x + it.w / 2, cy = it.y + it.h / 2, rr = Math.min(it.w, it.h) / 2, clip = 'cl' + it.id;
      var mine = opts && opts.code && it.code === opts.code;
      var face = /^(https?:|data:)/.test(it.photo || '')
        ? '<clipPath id="' + clip + '"><circle cx="' + cx + '" cy="' + cy + '" r="' + rr * .9 + '"/></clipPath><image href="' + esc(it.photo) + '" x="' + (cx - rr) + '" y="' + (cy - rr) + '" width="' + rr * 2 + '" height="' + rr * 2 + '" preserveAspectRatio="xMidYMid slice" clip-path="url(#' + clip + ')"/>'
        : '<text x="' + cx + '" y="' + (cy + rr * .3) + '" text-anchor="middle" font-size="' + rr * .8 + '" font-family="Courier Prime,monospace" font-weight="700" fill="#fff">' + esc(initials(it.name)) + '</text>';
      return '<g' + data + ' class="mt-agent' + (mine ? ' mt-mine' : '') + '"><circle cx="' + cx + '" cy="' + cy + '" r="' + rr + '" fill="#2f6b8f" stroke="' + (it.down ? '#777' : '#2f6b8f') + '" stroke-width="' + rr * .2 + '"/>' + face +
        (mine ? '<circle cx="' + cx + '" cy="' + cy + '" r="' + rr * 1.35 + '" fill="none" stroke="#c9a227" stroke-width=".18"/>' : '') +
        '<text x="' + cx + '" y="' + (cy + rr + .7) + '" text-anchor="middle" font-size=".55" font-family="Courier Prime,monospace" fill="#2a2418" paint-order="stroke" stroke="#efe6cc" stroke-width=".15">' + esc(String(it.name || '').split(/\s+/)[0]) + '</text></g>';
    }
    return '';
  }
  function dist(a, b) { return Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1])); }
  function fmtM(m) { return (m < 10 ? Math.round(m * 10) / 10 : Math.round(m)) + ' m'; }
  function rulerSvg(a, b, scale, col) {
    if (!a || !b) return '';
    var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, lbl = fmtM(dist(a, b) * scale);
    return '<g class="mt-ruler" pointer-events="none"><line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '" stroke="' + (col || '#c9a227') + '" stroke-width=".18" stroke-dasharray=".5 .25"/>' +
      '<circle cx="' + a[0] + '" cy="' + a[1] + '" r=".2" fill="' + (col || '#c9a227') + '"/><circle cx="' + b[0] + '" cy="' + b[1] + '" r=".2" fill="' + (col || '#c9a227') + '"/>' +
      '<rect x="' + (mx - 1.6) + '" y="' + (my - 1.5) + '" width="3.2" height="1.1" fill="#1c120a"/><text x="' + mx + '" y="' + (my - .67) + '" text-anchor="middle" font-size=".75" font-family="Courier Prime,monospace" font-weight="700" fill="#f2d98a">' + lbl + '</text></g>';
  }

  // The board: an <svg> with its own view (pan/zoom are per screen).
  function Board(host, opts) {
    var self = this;
    this.host = host; this.opts = opts || {};
    this.doc = { scale: 1, items: [], bg: null, shown: false };
    this.moves = {};     // mats/{cell}/moves: where the Agents put their tokens
    this.view = { x: -1, y: -1, w: 40, h: 26 };
    host.innerHTML = '<div class="mt-board"><svg class="mt-svg" xmlns="' + NS + '"></svg><div class="mt-scale"></div></div>';
    this.svg = host.querySelector('.mt-svg');
    this.scaleEl = host.querySelector('.mt-scale');
    this.local = null;   // this screen's own ruler
    this.extra = '';     // the editor's overlays (selection, drafts)
    // Pan with a drag on empty mat (the editor decides when), zoom with the wheel.
    // Two fingers: pinch to zoom, drag to pan (a phone). A tool's own
    // one-finger action is called off (onMulti) when the second lands.
    this.ptrs = {}; this.multi = null;
    var svg = this.svg;
    function cnt() { return Object.keys(self.ptrs).length; }
    function pair() { var k = Object.keys(self.ptrs); return [self.ptrs[k[0]], self.ptrs[k[1]]]; }
    svg.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      self.ptrs[e.pointerId] = [e.clientX, e.clientY];
      if (cnt() === 2) {
        var pr = pair(), r = svg.getBoundingClientRect();
        var mid = [(pr[0][0] + pr[1][0]) / 2, (pr[0][1] + pr[1][1]) / 2];
        var v = self.view;
        self.multi = { v: clone(v), d: Math.max(10, dist(pr[0], pr[1])), mid: mid, wp: [v.x + (mid[0] - r.left) / r.width * v.w, v.y + (mid[1] - r.top) / r.height * v.h] };
        if (self.onMulti) self.onMulti();
        e.stopImmediatePropagation();
      } else if (self.multi) e.stopImmediatePropagation();
    }, true);
    svg.addEventListener('pointermove', function (e) {
      if (!self.ptrs[e.pointerId]) return;
      self.ptrs[e.pointerId] = [e.clientX, e.clientY];
      if (!self.multi || cnt() < 2) return;
      e.stopImmediatePropagation();
      var m = self.multi, pr = pair(), r = svg.getBoundingClientRect();
      var mid = [(pr[0][0] + pr[1][0]) / 2, (pr[0][1] + pr[1][1]) / 2];
      var k = m.d / Math.max(10, dist(pr[0], pr[1])), w = Math.max(6, Math.min(400, m.v.w * k)), h = m.v.h * (w / m.v.w);
      self.view = { x: m.wp[0] - (mid[0] - r.left) / r.width * w, y: m.wp[1] - (mid[1] - r.top) / r.height * h, w: w, h: h };
      self.draw();
    }, true);
    function lift(e) {
      if (!self.ptrs[e.pointerId]) return;
      delete self.ptrs[e.pointerId];
      if (self.multi) { e.stopImmediatePropagation(); if (!cnt()) self.multi = null; }
    }
    svg.addEventListener('pointerup', lift, true);
    svg.addEventListener('pointercancel', lift, true);
    this.svg.addEventListener('wheel', function (e) {
      e.preventDefault();
      var p = self.pt(e), f = e.deltaY > 0 ? 1.12 : 1 / 1.12;
      self.zoomAt(p, f);
    }, { passive: false });
  }
  Board.prototype.pt = function (e) {
    var m = this.svg.getScreenCTM();
    if (!m) return [0, 0];
    var p = this.svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    var q = p.matrixTransform(m.inverse());
    return [q.x, q.y];
  };
  Board.prototype.zoomAt = function (p, f) {
    var v = this.view, nw = Math.max(6, Math.min(400, v.w * f)), k = nw / v.w;
    v.x = p[0] - (p[0] - v.x) * k; v.y = p[1] - (p[1] - v.y) * k; v.w = nw; v.h = v.h * k;
    this.draw();
  };
  Board.prototype.fit = function () {
    var xs = [], ys = [];
    (this.doc.items || []).forEach(function (it) {
      it = placed(it, this.moves);
      if (it.pts) it.pts.forEach(function (p) { xs.push(p[0]); ys.push(p[1]); });
      else { xs.push(it.x, it.x + (it.w || 0)); ys.push(it.y, it.y + (it.h || 0)); }
    }, this);
    var bg = this.doc.bg;
    if (bg && bg.url) { xs.push(bg.x, bg.x + bg.w); ys.push(bg.y, bg.y + bg.h); }
    var r = this.svg.getBoundingClientRect(), asp = r.width && r.height ? r.height / r.width : .65;
    if (!xs.length) { this.view = { x: -1, y: -1, w: 40, h: 40 * asp }; this.draw(); return; }
    var x0 = Math.min.apply(null, xs) - 2, x1 = Math.max.apply(null, xs) + 2, y0 = Math.min.apply(null, ys) - 2, y1 = Math.max.apply(null, ys) + 2;
    var cw = Math.max(10, x1 - x0), ch = Math.max(8, y1 - y0), w = cw, h = ch;
    if (h / w > asp) w = h / asp; else h = w * asp;
    // Centred: the spare room split on both sides.
    this.view = { x: x0 - (w - cw) / 2, y: y0 - (h - ch) / 2, w: w, h: h };
    this.draw();
  };
  Board.prototype.draw = function () {
    var d = this.doc, v = this.view, o = this.opts;
    var r = this.svg.getBoundingClientRect();
    if (r.width && r.height) v.h = v.w * r.height / r.width;
    this.svg.setAttribute('viewBox', v.x + ' ' + v.y + ' ' + v.w + ' ' + v.h);
    var s = '<defs><pattern id="mtdots' + (o.uid || '') + '" width="1" height="1" patternUnits="userSpaceOnUse"><circle cx=".5" cy=".5" r=".055" fill="' + (DOTS[d.dots] || DOTS.black) + '"/></pattern></defs>';
    s += '<rect x="' + (v.x - 2) + '" y="' + (v.y - 2) + '" width="' + (v.w + 4) + '" height="' + (v.h + 4) + '" fill="#efe6cc"/>';
    if (d.bg && d.bg.url) s += '<image class="mt-bg" href="' + esc(d.bg.url) + '" x="' + d.bg.x + '" y="' + d.bg.y + '" width="' + d.bg.w + '" height="' + d.bg.h + '" preserveAspectRatio="none" opacity="' + (d.bg.op == null ? .6 : d.bg.op) + '"/>';
    s += '<rect x="' + (v.x - 2) + '" y="' + (v.y - 2) + '" width="' + (v.w + 4) + '" height="' + (v.h + 4) + '" fill="url(#mtdots' + (o.uid || '') + ')" pointer-events="none"/>';
    var mv = this.moves;
    var items = (d.items || []).filter(function (it) { return !(o.readOnly && it.hid); }).map(function (it) { return placed(it, mv); });
    var order = { path: 0, rect: 1, circle: 1, text: 2, token: 3, npc: 4, agent: 4 };
    items.slice().sort(function (a, b) { return (order[a.t] || 0) - (order[b.t] || 0); }).forEach(function (it) { s += itemSvg(it, o); });
    if (d.ruler && d.ruler.a) s += rulerSvg(d.ruler.a, d.ruler.b, d.scale || 1);
    if (this.local) s += rulerSvg(this.local.a, this.local.b, d.scale || 1, '#2f6b8f');
    s += this.extra || '';
    this.svg.innerHTML = s;
    if (!o.editScale) this.scaleEl.textContent = '1 dot = ' + (d.scale || 1) + ' m';
  };

  /* ── The Agents' view: live, read-only ── */
  function view(host, opts) {
    host.innerHTML = '<div class="mt-pview"><div class="mt-pbar"><span class="mt-live"><i></i>LIVE</span><b class="mt-title"></b><span class="mt-sp"></span>' +
      '<button type="button" class="mt-pb" data-mv="out" aria-label="Zoom out">−</button><button type="button" class="mt-pb" data-mv="in" aria-label="Zoom in">+</button>' +
      '<button type="button" class="mt-pb" data-mv="fit">Fit</button><button type="button" class="mt-pb" data-mv="ruler">Ruler</button><button type="button" class="mt-pb mt-exit" data-mv="exit">Exit</button></div>' +
      '<div class="mt-hint" hidden>Drag your token (ringed) to move it.</div>' +
      '<div class="mt-host"></div><div class="mt-none" hidden>No map on the table.</div></div>';
    var root = host.firstChild, bh = root.querySelector('.mt-host');
    var b = new Board(bh, { readOnly: true, code: opts.code, uid: 'p' });
    var ruler = false, drag = null, fitted = false, unsub = null, unsubM = null, sendT = null, lastSent = 0;
    // Their own token: on the mat, and the Handler lets them move it.
    function mine() { return (b.doc.items || []).filter(function (it) { return it.t === 'agent' && it.code === opts.code; })[0] || null; }
    function canMove() { return !!(opts.code && b.doc.shown && b.doc.agents_move !== false && mine()); }
    function hint() { root.querySelector('.mt-hint').hidden = !canMove(); }
    // Sent while dragging (a few times a second, so the table sees it move)
    // and once more where it lands.
    function sendMove(x, y, now) {
      clearTimeout(sendT);
      var go = function () {
        lastSent = Date.now();
        try { movesRef(opts.cellId).doc(opts.code).set({ x: x, y: y, at: lastSent }).catch(function () { /* the Handler turned it off */ }); } catch (e) { /* offline */ }
      };
      if (now || Date.now() - lastSent > 180) go(); else sendT = setTimeout(go, 180);
    }
    root.addEventListener('click', function (e) {
      var k = e.target.closest('[data-mv]');
      if (!k) return;
      var a = k.getAttribute('data-mv'), v = b.view, c = [v.x + v.w / 2, v.y + v.h / 2];
      if (a === 'in') b.zoomAt(c, 1 / 1.25); else if (a === 'out') b.zoomAt(c, 1.25); else if (a === 'fit') b.fit();
      else if (a === 'ruler') { ruler = !ruler; k.classList.toggle('on', ruler); if (!ruler) { b.local = null; b.draw(); } }
      else if (a === 'exit') { root.classList.add('mt-nofull'); portal(); }
    });
    // Sideways on a phone the mat leaves the notebook for the whole screen
    // (the notebook's frame would keep a fixed element inside it); Exit,
    // or the phone upright again, puts it back.
    var home = null, mq = window.matchMedia(FULL_MQ);
    function portal() {
      var full = mq.matches && !root.classList.contains('mt-nofull');
      if (full && !root.classList.contains('mt-portal')) { home = root.parentNode; document.body.appendChild(root); root.classList.add('mt-portal'); }
      else if (!full && root.classList.contains('mt-portal')) { root.classList.remove('mt-portal'); if (home && home.isConnected) home.appendChild(root); else if (root.parentNode) root.parentNode.removeChild(root); }
      setTimeout(function () { b.fit(); }, 120);
    }
    var stopRot = fullScreenRotate(root, b, portal);
    b.svg.addEventListener('pointerdown', function (e) {
      var p = b.pt(e), own = !ruler && canMove() && e.target.closest && e.target.closest('.mt-mine');
      if (own) {
        var at = placed(mine(), b.moves);
        drag = { tok: true, off: [p[0] - at.x, p[1] - at.y] };
        try { b.svg.setPointerCapture(e.pointerId); } catch (err) { /* old Safari */ }
        return;
      }
      drag = { p: p, cx: e.clientX, cy: e.clientY, v: clone(b.view), ruler: ruler };
      if (ruler) b.local = { a: p, b: p };
      try { b.svg.setPointerCapture(e.pointerId); } catch (err) { /* old Safari */ }
    });
    b.svg.addEventListener('pointermove', function (e) {
      if (!drag) return;
      if (drag.tok) {
        var q = b.pt(e), nx = r2(q[0] - drag.off[0]), ny = r2(q[1] - drag.off[1]);
        b.moves[opts.code] = { x: nx, y: ny, at: Date.now() }; b.draw();
        sendMove(nx, ny);
        return;
      }
      if (drag.ruler) { b.local.b = b.pt(e); b.draw(); return; }
      var r = b.svg.getBoundingClientRect(), k = drag.v.w / r.width;
      b.view.x = drag.v.x - (e.clientX - drag.cx) * k; b.view.y = drag.v.y - (e.clientY - drag.cy) * k; b.draw();
    });
    b.svg.addEventListener('pointerup', function () {
      var d = drag; drag = null;
      if (d && d.tok && b.moves[opts.code]) {
        // It lands on the nearest half-dot.
        var m = b.moves[opts.code], sx = Math.round(m.x * 2) / 2, sy = Math.round(m.y * 2) / 2;
        b.moves[opts.code] = { x: sx, y: sy, at: Date.now() }; b.draw();
        sendMove(sx, sy, true);
      }
    });
    b.svg.addEventListener('pointercancel', function () { drag = null; });
    function apply(d) {
      var none = !d || !d.shown;
      root.querySelector('.mt-none').hidden = !none;
      bh.hidden = none;
      if (none) { b.doc = d || b.doc; hint(); return; }
      b.doc = d;
      if (drag && drag.tok && !canMove()) drag = null;
      hint();
      root.querySelector('.mt-title').textContent = d.title || 'The mat';
      if (!fitted) { fitted = true; setTimeout(function () { b.fit(); }, 0); } else b.draw();
    }
    try {
      unsub = matRef(opts.cellId).onSnapshot(function (snap) { apply(snap.exists ? snap.data() : null); }, function () { apply(null); });
      unsubM = movesRef(opts.cellId).onSnapshot(function (snap) {
        var m = readMoves(snap);
        // Mid-drag, this screen's own token stays under the finger.
        if (drag && drag.tok && b.moves[opts.code]) m[opts.code] = b.moves[opts.code];
        b.moves = m; if (b.doc && b.doc.shown) b.draw();
      }, function () { /* moves are extra; the mat still shows */ });
    } catch (e) { apply(null); }
    return { destroy: function () { stopRot(); clearTimeout(sendT); if (unsub) unsub(); if (unsubM) unsubM(); unsub = unsubM = null; if (root.parentNode) root.parentNode.removeChild(root); host.innerHTML = ''; }, board: b };
  }
  // Sideways on a phone the mat takes the screen (CSS); Exit leaves that
  // until the phone is turned upright again. The board redraws for its
  // new shape either way.
  var FULL_MQ = '(orientation: landscape) and (max-height: 520px) and (pointer: coarse)';
  function fullScreenRotate(root, b, after) {
    var land = null;
    function on() {
      var l = window.innerWidth > window.innerHeight;
      var turned = land !== null && l !== land;
      if (turned && !l) root.classList.remove('mt-nofull');
      land = l;
      // Turned: the map refits its new shape; resized otherwise: just redrawn.
      if (after) { after(); return; }
      setTimeout(function () { if (turned) b.fit(); else b.draw(); }, 120);
    }
    on();
    window.addEventListener('resize', on);
    return function () { window.removeEventListener('resize', on); };
  }

  /* ── The Handler's editor ── */
  function editor(host, opts) {
    var cellId = opts.cellId;
    host.innerHTML = '<div class="mt-ed' + (opts.phone ? ' mt-phone' : '') + '">' +
      '<div class="mt-bar">' +
        '<button type="button" class="mt-ph mt-exit" data-mt="exit">Exit</button>' +
        '<span class="mt-lab">Map</span><input class="mt-name" type="text" maxlength="60" placeholder="Name this map">' +
        '<span class="mt-sep"></span><label class="mt-sw"><input type="checkbox" data-mt="shown"> Shown to the Agents</label>' +
        '<span class="mt-sep"></span><span class="mt-dots"><span class="mt-lab">Dots</span><span class="mt-seg"><button type="button" data-mt="dots" data-v="black">Black</button><button type="button" data-mt="dots" data-v="white">White</button></span></span>' +
        '<label class="mt-sw mt-sw2"><input type="checkbox" data-mt="amove"> Agents move their own tokens</label>' +
        '<span class="mt-sep"></span><button type="button" data-mt="undo">Undo</button><button type="button" class="mt-ph" data-mt="more" aria-label="More">⋯</button><button type="button" data-mt="redo">Redo</button>' +
        '<button type="button" data-mt="fit">Fit</button><button type="button" class="mt-red" data-mt="clear">Clear the mat</button>' +
        '<span class="mt-sep"></span><span class="mt-lab">Background</span><label class="mt-btn">Upload photo…<input type="file" accept="image/*" hidden data-mt="bgfile"></label>' +
        '<span class="mt-bgctl" hidden><span class="mt-lab">Fade</span><input type="range" min="10" max="100" value="60" data-mt="bgop">' +
        '<button type="button" data-mt="tool" data-tool="scale">Set the scale</button><button type="button" data-mt="tool" data-tool="bgmove">Move photo</button>' +
        '<button type="button" data-mt="bglock">Lock</button><button type="button" data-mt="bgdel">Remove</button></span>' +
        '<span class="mt-status"></span>' +
      '</div>' +
      '<div class="mt-row"><div class="mt-tools">' +
        '<span class="mt-lab">Tools</span>' +
        [['select', 'Select / move'], ['marker', 'Marker'], ['rect', 'Rectangle'], ['circle', 'Circle'], ['text', 'Text label'], ['ruler', 'Ruler'], ['eraser', 'Eraser']].map(function (t) {
          return '<button type="button" class="mt-tool" data-mt="tool" data-tool="' + t[0] + '">' + t[1] + '</button>';
        }).join('') +
        '<button type="button" class="mt-tool mt-ph" data-mt="kit">Tokens</button>' +
        '<div class="mt-kit"><div class="mt-kith mt-ph"><b>Tokens &amp; pen</b><button type="button" data-mt="kit">✕</button></div>' +
        '<span class="mt-lab">Colour</span><div class="mt-sws">' + COLORS.map(function (c, i) { return '<button type="button" class="mt-col" data-mt="col" data-i="' + i + '" style="background:' + c + '" aria-label="Colour ' + (i + 1) + '"></button>'; }).join('') + '</div>' +
        '<span class="mt-lab">Width</span><div class="mt-sws">' + WIDTHS.map(function (w, i) { return '<button type="button" class="mt-wid" data-mt="wid" data-i="' + i + '" aria-label="Width ' + (i + 1) + '"><i style="height:' + [2, 4, 8, 13][i] + 'px"></i></button>'; }).join('') + '</div>' +
        '<span class="mt-lab">Tokens</span><div class="mt-tray">' + Object.keys(TOKENS).map(function (k) {
          var T = TOKENS[k], s = Math.max(T.w, T.h);
          return '<button type="button" class="mt-tok" data-mt="tool" data-tool="tok:' + k + '" title="' + esc(T.name) + '"><svg viewBox="' + (-(s - T.w) / 2 - .1) + ' ' + (-(s - T.h) / 2 - .1) + ' ' + (s + .2) + ' ' + (s + .2) + '">' + T.draw(T.w, T.h) + '</svg><small>' + esc(T.name) + '</small></button>';
        }).join('') + '</div>' +
        '<span class="mt-lab">Agents</span><div class="mt-tray mt-agents"></div>' +
        '<span class="mt-lab">NPCs · this session\'s Initiative</span><div class="mt-npcs"></div></div>' +
      '</div><div class="mt-stage"></div></div>' +
      '<div class="mt-sel" hidden></div><div class="mt-ask" hidden></div></div>';
    var root = host.firstChild, stage = root.querySelector('.mt-stage');
    var b = new Board(stage, { uid: 'h' + Math.random().toString(36).slice(2, 6), editScale: true });
    var st = { tool: 'select', col: 0, wid: 1, sel: '', drag: null, undo: [], redo: [], dirty: false, lastWrite: 0, fitted: false, pending: null };
    var unsub = null, unsubM = null, saveT = null, rulerT = null;

    function members() { return (opts.members && opts.members()) || []; }
    // The session's NPCs: [{ key, name, photo, dex, hidden, out, down }].
    function npcs() { return (opts.npcs && opts.npcs()) || []; }
    function drawNpcTray() {
      var box = root.querySelector('.mt-npcs');
      box.innerHTML = npcs().map(function (n) {
        var on = (b.doc.items || []).some(function (it) { return it.t === 'npc' && it.key === n.key; });
        var face = /^(https?:|data:)/.test(n.photo || '') ? '<img src="' + esc(n.photo) + '" alt="">' : '<b>' + esc(initials(n.name)) + '</b>';
        var note = on ? 'on the mat' : n.hidden ? 'hidden' : n.down ? 'down' : n.out ? 'not in the order' : n.dex ? 'DEX ' + n.dex : '';
        return '<button type="button" class="mt-npc' + (n.hidden ? ' hid' : '') + (n.out || n.down ? ' out' : '') + '" data-mt="tool" data-tool="npc:' + esc(n.key) + '" title="' + esc(n.name) + (on ? ' (on the mat: tap, then tap where they go)' : '') + '">' + face + '<span>' + esc(n.name) + '</span><small>' + esc(note) + '</small></button>';
      }).join('') || '<span class="mt-none2">No NPCs in this session.</span>';
    }
    // An NPC's token follows Initiative: hidden there, hidden from the
    // Agents here; down or out of the order, greyed.
    function syncNpcs() {
      var list = npcs(), by = {}, changed = false;
      if (!list.length) return;
      list.forEach(function (n) { by[n.key] = n; });
      (b.doc.items || []).forEach(function (it) {
        var n = it.t === 'npc' && by[it.key];
        if (!n) return;
        var hid = !!n.hidden, out = !!(n.out || n.down), photo = n.photo || '';
        if (!!it.hid !== hid || !!it.out !== out || (it.photo || '') !== photo || it.name !== n.name) { it.hid = hid; it.out = out; it.photo = photo; it.name = n.name; changed = true; }
      });
      // Saved once the mat is loaded (or already edited here), so a mat
      // not yet in can't be overwritten.
      if (changed) { redraw(); if (st.loaded) save(); }
    }
    // The Agents' own moves (mats/{cell}/moves/{code}) end when the Handler
    // moves or removes that token.
    function dropMoves(codes) {
      codes.forEach(function (code) {
        if (!b.moves[code]) return;
        delete b.moves[code];
        signedIn().then(function () { return movesRef(cellId).doc(code).delete(); }).catch(function () { /* already gone */ });
      });
    }
    function agentCodes(items) { return (items || []).filter(function (x) { return x.t === 'agent'; }).map(function (x) { return x.code; }); }
    // Folds an Agent's own move into the token before the Handler handles it.
    function settle(it) {
      var m = it && it.t === 'agent' && b.moves[it.code];
      if (!m) return;
      it.x = m.x; it.y = m.y;
      dropMoves([it.code]);
    }
    function drawAgentsTray() {
      root.querySelector('.mt-agents').innerHTML = members().map(function (m) {
        var on = (b.doc.items || []).some(function (it) { return it.t === 'agent' && it.code === m.code; });
        var face = /^(https?:|data:)/.test(m.photo || '') ? '<img src="' + esc(m.photo) + '" alt="">' : '<b>' + esc(initials(m.name)) + '</b>';
        return '<button type="button" class="mt-ag' + (on ? ' on' : '') + '" data-mt="tool" data-tool="ag:' + esc(m.code) + '" title="' + esc(m.name) + (on ? ' (on the mat: tap, then tap where they go)' : '') + '">' + face + '<small>' + esc(String(m.name).split(/\s+/)[0]) + '</small></button>';
      }).join('') || '<span class="mt-none2">No Agents in this Cell.</span>';
    }
    // The scale, bottom right: tap to change it (live for the Agents).
    function drawScale() {
      var sc = b.doc.scale || 1;
      b.scaleEl.innerHTML = '<label>1 dot = <input type="number" min="0.1" max="1000" step="0.5" value="' + sc + '" data-mt="scale" aria-label="Metres per dot"> m</label>';
    }
    function marks() {
      Array.prototype.forEach.call(root.querySelectorAll('[data-mt="tool"]'), function (x) { x.classList.toggle('on', x.getAttribute('data-tool') === st.tool); });
      Array.prototype.forEach.call(root.querySelectorAll('.mt-col'), function (x, i) { x.classList.toggle('on', i === st.col); });
      Array.prototype.forEach.call(root.querySelectorAll('.mt-wid'), function (x, i) { x.classList.toggle('on', i === st.wid); });
      var bg = b.doc.bg;
      root.querySelector('.mt-bgctl').hidden = !(bg && bg.url);
      if (bg && bg.url) {
        root.querySelector('[data-mt="bgop"]').value = Math.round((bg.op == null ? .6 : bg.op) * 100);
        root.querySelector('[data-mt="bglock"]').textContent = bg.locked ? 'Unlock' : 'Lock';
      }
      root.querySelector('[data-mt="shown"]').checked = !!b.doc.shown;
      root.querySelector('[data-mt="amove"]').checked = b.doc.agents_move !== false;
      Array.prototype.forEach.call(root.querySelectorAll('[data-mt="dots"]'), function (x) { x.classList.toggle('on', x.getAttribute('data-v') === (b.doc.dots || 'black')); });
      var nm = root.querySelector('.mt-name');
      if (document.activeElement !== nm) nm.value = b.doc.title || '';
      stage.className = 'mt-stage mt-t-' + st.tool.split(':')[0];
    }
    function selected() { return (b.doc.items || []).filter(function (x) { return x.id === st.sel; })[0] || null; }
    function drawSel() {
      var it = selected(), box = root.querySelector('.mt-sel');
      b.extra = '';
      if (!it) { box.hidden = true; return; }
      var pl = placed(it, b.moves), bb = it.t === 'path' ? bounds(it.pts) : { x: pl.x, y: pl.y, w: it.w || 1, h: it.h || 1 };
      b.extra = '<rect x="' + (bb.x - .3) + '" y="' + (bb.y - .3) + '" width="' + (bb.w + .6) + '" height="' + (bb.h + .6) + '" fill="none" stroke="#2f6b8f" stroke-width=".1" stroke-dasharray=".35 .2" pointer-events="none"/>' +
        (it.t !== 'path' && it.t !== 'text' && it.t !== 'agent' && it.t !== 'npc' ? '<rect class="mt-handle" x="' + (bb.x + bb.w - .1) + '" y="' + (bb.y + bb.h - .1) + '" width=".7" height=".7" fill="#c9a227" stroke="#1c120a" stroke-width=".06"/>' : '');
      var name = it.t === 'token' ? (TOKENS[it.tok] || {}).name : it.t === 'agent' || it.t === 'npc' ? it.name : { path: 'Marker line', rect: 'Rectangle', circle: 'Circle', text: 'Text' }[it.t];
      var sc = b.doc.scale || 1;
      box.hidden = false;
      box.innerHTML = '<b>' + esc(name) + '</b>' +
        (it.t !== 'path' && it.t !== 'text' ? '<span>' + r2((it.w || 0) * sc) + ' × ' + r2((it.h || 0) * sc) + ' m</span>' : '') +
        (it.t === 'token' || it.t === 'rect' || it.t === 'circle' ? '<input type="text" maxlength="40" placeholder="Label" data-mt="label" value="' + esc(it.label || '') + '">' : '') +
        (it.t === 'text' ? '<input type="text" maxlength="80" data-mt="text" value="' + esc(it.text || '') + '">' : '') +
        (it.t === 'token' || it.t === 'rect' || it.t === 'text' ? '<button type="button" data-mt="rot" data-d="-90">⟲ 90°</button><button type="button" data-mt="rot" data-d="90">⟳ 90°</button>' : '') +
        (it.t !== 'agent' && it.t !== 'npc' ? '<button type="button" data-mt="recol">Use this colour</button>' : '') +
        '<button type="button" data-mt="front">Bring to front</button><button type="button" class="mt-red" data-mt="del">Delete</button>';
    }
    function bounds(pts) {
      var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
      var x = Math.min.apply(null, xs), y = Math.min.apply(null, ys);
      return { x: x, y: y, w: Math.max.apply(null, xs) - x, h: Math.max.apply(null, ys) - y };
    }
    function redraw() { drawSel(); b.draw(); marks(); drawAgentsTray(); drawNpcTray(); }
    function status(t) { root.querySelector('.mt-status').textContent = t || ''; }

    // Every change: undo point, draw, save (debounced).
    function snapshot() { return clone({ items: b.doc.items || [], bg: b.doc.bg || null }); }
    function change(fn) {
      st.undo.push(snapshot()); if (st.undo.length > 60) st.undo.shift(); st.redo = [];
      fn();
      redraw(); save();
    }
    function save() {
      st.dirty = true; st.loaded = true;
      clearTimeout(saveT);
      saveT = setTimeout(function () {
        var d = b.doc, now = Date.now();
        st.lastWrite = now;
        var out = { title: d.title || '', scale: d.scale || 1, shown: !!d.shown, items: d.items || [], bg: d.bg || null, dots: d.dots || 'black', agents_move: d.agents_move !== false, updated_at: now };
        signedIn().then(function () { return matRef(cellId).set(out, { merge: true }); })
          .then(function () { st.dirty = false; status(''); })
          .catch(function (e) { status('Not saved: ' + ((e && e.message) || e)); });
      }, 250);
    }
    function sendRuler(r) {
      clearTimeout(rulerT);
      rulerT = setTimeout(function () {
        signedIn().then(function () { return matRef(cellId).set({ ruler: r || null }, { merge: true }); }).catch(function () { /* a ruler is fleeting */ });
      }, r ? 120 : 0);
    }

    function hitItem(e) {
      var t = e.target.closest && e.target.closest('[data-id]');
      return t ? t.getAttribute('data-id') : '';
    }
    function snap(v) { return Math.round(v * 2) / 2; }
    function place(kind, p) {
      if (kind.indexOf('tok:') === 0) {
        var k = kind.slice(4), T = TOKENS[k], sc = b.doc.scale || 1;
        var w = Math.max(.3, T.w / sc), h = Math.max(.3, T.h / sc);
        change(function () { b.doc.items.push({ id: uid(), t: 'token', tok: k, x: r2(snap(p[0] - w / 2)), y: r2(snap(p[1] - h / 2)), w: r2(w), h: r2(h), r: 0 }); });
        return;
      }
      if (kind.indexOf('npc:') === 0) {
        var key = kind.slice(4), n = npcs().filter(function (x) { return x.key === key; })[0] || { key: key, name: key };
        var nex = b.doc.items.filter(function (x) { return x.t === 'npc' && x.key === key; })[0];
        var nsz = Math.max(1.2, 1.4 / (b.doc.scale || 1));
        change(function () {
          if (nex) { nex.x = r2(snap(p[0] - nex.w / 2)); nex.y = r2(snap(p[1] - nex.h / 2)); }
          else b.doc.items.push({ id: uid(), t: 'npc', key: key, name: n.name || key, photo: n.photo || '', hid: !!n.hidden, out: !!(n.out || n.down), x: r2(snap(p[0] - nsz / 2)), y: r2(snap(p[1] - nsz / 2)), w: nsz, h: nsz });
        });
        return;
      }
      if (kind.indexOf('ag:') === 0) {
        var code = kind.slice(3), m = members().filter(function (x) { return x.code === code; })[0] || { code: code, name: code };
        var ex = b.doc.items.filter(function (x) { return x.t === 'agent' && x.code === code; })[0];
        var sz = Math.max(1.2, 1.4 / (b.doc.scale || 1));
        dropMoves([code]);
        change(function () {
          if (ex) { ex.x = r2(snap(p[0] - ex.w / 2)); ex.y = r2(snap(p[1] - ex.h / 2)); ex.photo = m.photo || ex.photo || ''; ex.name = m.name || ex.name; }
          else b.doc.items.push({ id: uid(), t: 'agent', code: code, name: m.name || code, photo: m.photo || '', x: r2(snap(p[0] - sz / 2)), y: r2(snap(p[1] - sz / 2)), w: sz, h: sz });
        });
      }
    }

    b.onMulti = function () {
      var d = st.drag;
      if (!d) return;
      st.drag = null;
      if (d.kind === 'move' || d.kind === 'size' || d.kind === 'bg') { var u = st.undo.pop(); if (u && d.moved !== false) { b.doc.items = u.items; b.doc.bg = u.bg; } }
      if (d.kind === 'ruler') sendRuler(null);
      b.local = null; b.extra = ''; redraw();
    };
    var stopRot = fullScreenRotate(root, b);
    // Pointer: what each tool does.
    b.svg.addEventListener('pointerdown', function (e) {
      if (e.button && e.button !== 0) return;
      var p = b.pt(e), tool = st.tool, id = hitItem(e);
      try { b.svg.setPointerCapture(e.pointerId); } catch (err) { /* old Safari */ }
      // Placing, erasing and text happen when the finger lifts (a tap), so
      // the first finger of a pinch never places or erases anything.
      if (tool.indexOf('tok:') === 0 || tool.indexOf('ag:') === 0 || tool.indexOf('npc:') === 0 || tool === 'eraser' || tool === 'text') { st.drag = { kind: 'tap', tool: tool, p: p, id: id, cx: e.clientX, cy: e.clientY }; return; }
      if (tool === 'ruler') { st.drag = { kind: 'ruler', a: p }; b.local = { a: p, b: p }; b.draw(); return; }
      if (tool === 'scale') { st.drag = { kind: 'scale', a: p }; b.local = { a: p, b: p }; b.draw(); return; }
      if (tool === 'bgmove') { var bg = b.doc.bg; if (bg && !bg.locked) { st.undo.push(snapshot()); st.drag = { kind: 'bg', p: p, x: bg.x, y: bg.y }; } return; }
      if (tool === 'marker') { st.drag = { kind: 'path', it: { id: uid(), t: 'path', c: COLORS[st.col], sw: WIDTHS[st.wid], pts: [[r2(p[0]), r2(p[1])]] } }; return; }
      if (tool === 'rect' || tool === 'circle') { st.drag = { kind: 'box', a: [snap(p[0]), snap(p[1])], it: { id: uid(), t: tool, c: COLORS[st.col], sw: WIDTHS[Math.min(st.wid, 1)], x: snap(p[0]), y: snap(p[1]), w: 0, h: 0 } }; return; }
      // select: the yellow handle sizes; an item moves; empty mat pans.
      if (e.target.classList && e.target.classList.contains('mt-handle')) { var s0 = selected(); if (s0) { st.undo.push(snapshot()); st.drag = { kind: 'size', it: s0 }; } return; }
      if (id) {
        st.sel = id; var it = selected();
        st.undo.push(snapshot()); st.redo = [];
        settle(it);
        st.drag = { kind: 'move', it: it, p: p, moved: false, o: it.t === 'path' ? clone(it.pts) : [it.x, it.y] };
        redraw(); return;
      }
      if (st.sel) { st.sel = ''; redraw(); }
      st.drag = { kind: 'pan', cx: e.clientX, cy: e.clientY, v: clone(b.view) };
    });
    b.svg.addEventListener('pointermove', function (e) {
      var d = st.drag; if (!d) return;
      var p = b.pt(e);
      if (d.kind === 'pan') { var r = b.svg.getBoundingClientRect(), k = d.v.w / r.width; b.view.x = d.v.x - (e.clientX - d.cx) * k; b.view.y = d.v.y - (e.clientY - d.cy) * k; b.draw(); return; }
      if (d.kind === 'ruler' || d.kind === 'scale') { b.local.b = p; b.draw(); if (d.kind === 'ruler') sendRuler({ a: b.local.a, b: p }); return; }
      if (d.kind === 'bg') { b.doc.bg.x = r2(d.x + p[0] - d.p[0]); b.doc.bg.y = r2(d.y + p[1] - d.p[1]); b.draw(); return; }
      if (d.kind === 'path') { var last = d.it.pts[d.it.pts.length - 1]; if (dist(last, p) > .15) d.it.pts.push([r2(p[0]), r2(p[1])]); b.extra = itemSvg(d.it); b.draw(); return; }
      if (d.kind === 'box') {
        var x0 = Math.min(d.a[0], snap(p[0])), y0 = Math.min(d.a[1], snap(p[1]));
        d.it.x = x0; d.it.y = y0; d.it.w = Math.abs(snap(p[0]) - d.a[0]); d.it.h = Math.abs(snap(p[1]) - d.a[1]);
        b.extra = itemSvg(d.it); b.draw(); return;
      }
      if (d.kind === 'size') { d.it.w = Math.max(.3, r2(snap(p[0]) - d.it.x)); d.it.h = Math.max(.3, r2(snap(p[1]) - d.it.y)); drawSel(); b.draw(); return; }
      if (d.kind === 'move') {
        var dx = p[0] - d.p[0], dy = p[1] - d.p[1];
        if (!d.moved && Math.abs(dx) + Math.abs(dy) < .2) return;
        d.moved = true;
        if (d.it.t === 'path') d.it.pts = d.o.map(function (q) { return [r2(q[0] + dx), r2(q[1] + dy)]; });
        else { d.it.x = r2(snap(d.o[0] + dx)); d.it.y = r2(snap(d.o[1] + dy)); }
        drawSel(); b.draw();
      }
    });
    b.svg.addEventListener('pointerup', function (e) {
      var d = st.drag; st.drag = null;
      if (!d) return;
      if (d.kind === 'tap') {
        if (Math.abs(e.clientX - d.cx) + Math.abs(e.clientY - d.cy) > 12) return;
        var t = d.tool, id0 = d.id;
        if (t === 'eraser') { if (id0) change(function () { dropMoves(agentCodes(b.doc.items.filter(function (x) { return x.id === id0; }))); b.doc.items = b.doc.items.filter(function (x) { return x.id !== id0; }); if (st.sel === id0) st.sel = ''; }); }
        else if (t === 'text') askText(d.p);
        else { place(t, d.p); if (t.indexOf('ag:') === 0 || t.indexOf('npc:') === 0) st.tool = 'select'; marks(); }
        return;
      }
      if (d.kind === 'ruler') { b.local = null; b.draw(); sendRuler(null); return; }
      if (d.kind === 'scale') { askScale(b.local.a, b.local.b); return; }
      if (d.kind === 'bg') { redraw(); save(); return; }
      if (d.kind === 'path') { b.extra = ''; if (d.it.pts.length > 1) change(function () { b.doc.items.push(d.it); }); else b.draw(); return; }
      if (d.kind === 'box') { b.extra = ''; if (d.it.w >= .5 && d.it.h >= .5) change(function () { b.doc.items.push(d.it); st.sel = d.it.id; }); else b.draw(); return; }
      if (d.kind === 'size') { st.redo = []; redraw(); save(); return; }
      if (d.kind === 'move') { if (d.moved) { st.redo = []; redraw(); save(); } else st.undo.pop(); }
    });
    b.svg.addEventListener('pointercancel', function () { st.drag = null; b.local = null; b.extra = ''; redraw(); });

    // A small question under the mat (text to place; what a scale line measures).
    function ask(html, onOk) {
      var box = root.querySelector('.mt-ask');
      box.hidden = false;
      box.innerHTML = html + '<button type="button" data-ask="ok">OK</button><button type="button" data-ask="x">Cancel</button>';
      var inp = box.querySelector('input');
      setTimeout(function () { if (inp) inp.focus(); }, 30);
      function done(ok) {
        box.hidden = true; box.onclick = null; if (inp) inp.onkeydown = null;
        if (ok) onOk(inp ? inp.value : ''); else { b.local = null; b.draw(); }
        box.innerHTML = '';
      }
      box.onclick = function (e) { var k = e.target.getAttribute('data-ask'); if (k) done(k === 'ok'); };
      if (inp) inp.onkeydown = function (e) { if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); };
    }
    function askText(p) {
      ask('<span>Text at this spot:</span><input type="text" maxlength="80" class="mt-askin">', function (t) {
        t = String(t || '').trim();
        if (t) change(function () { b.doc.items.push({ id: uid(), t: 'text', text: t, x: r2(p[0]), y: r2(p[1] - 1), w: Math.max(1, t.length * .6), h: 1, size: 1, c: COLORS[st.col] }); });
      });
    }
    // Set the scale: the line drawn over the photo's scale bar is M metres;
    // the photo is resized (from the line's start) so that is M dots' worth.
    function askScale(a, z) {
      var L = dist(a, z);
      if (!b.doc.bg || !b.doc.bg.url || L < .3) { b.local = null; b.draw(); status(b.doc.bg && b.doc.bg.url ? '' : 'Upload a photo first.'); return; }
      ask('<span>This line is</span><input type="number" min="0.1" step="any" class="mt-askin" value="10"><span>m long</span>', function (v) {
        var m = parseFloat(v);
        b.local = null;
        if (!(m > 0)) { b.draw(); return; }
        var f = (m / (b.doc.scale || 1)) / L;
        change(function () {
          var g = b.doc.bg;
          g.x = r2(a[0] + (g.x - a[0]) * f); g.y = r2(a[1] + (g.y - a[1]) * f); g.w = r2(g.w * f); g.h = r2(g.h * f);
        });
        st.tool = 'select'; marks();
        status('The photo is to scale: ' + m + ' m = ' + r2(m / (b.doc.scale || 1)) + ' dots.');
      });
    }

    // The bar and the side.
    root.addEventListener('click', function (e) {
      var k = e.target.closest('[data-mt]');
      if (!k) return;
      var a = k.getAttribute('data-mt'), it = selected();
      if (a === 'tool') { var t = k.getAttribute('data-tool'); st.tool = st.tool === t && t !== 'select' ? 'select' : t; if (st.tool !== 'select') st.sel = ''; redraw(); }
      else if (a === 'col') { st.col = +k.getAttribute('data-i'); marks(); }
      else if (a === 'wid') { st.wid = +k.getAttribute('data-i'); marks(); }
      else if (a === 'undo') { if (st.undo.length) { st.redo.push(snapshot()); var u = st.undo.pop(); b.doc.items = u.items; b.doc.bg = u.bg; st.sel = ''; redraw(); save(); } }
      else if (a === 'redo') { if (st.redo.length) { st.undo.push(snapshot()); var r = st.redo.pop(); b.doc.items = r.items; b.doc.bg = r.bg; st.sel = ''; redraw(); save(); } }
      else if (a === 'fit') { b.fit(); root.classList.remove('mt-more'); }
      else if (a === 'more') root.classList.toggle('mt-more');
      else if (a === 'kit') root.classList.toggle('mt-kit-open');
      else if (a === 'exit') { root.classList.add('mt-nofull'); setTimeout(function () { b.draw(); }, 50); }
      else if (a === 'clear') {
        var go = window.dgAc && window.dgAc.ask ? window.dgAc.ask('Clear everything off the mat? The photo stays. (Undo brings it back.)', 'Clear it', 'Keep it') : Promise.resolve(window.confirm('Clear the mat?'));
        go.then(function (ok) { if (ok) change(function () { dropMoves(agentCodes(b.doc.items)); b.doc.items = []; st.sel = ''; }); });
      }
      else if (a === 'bglock') change(function () { b.doc.bg.locked = !b.doc.bg.locked; if (b.doc.bg.locked && st.tool === 'bgmove') st.tool = 'select'; });
      else if (a === 'bgdel') change(function () { b.doc.bg = null; st.tool = 'select'; });
      else if (a === 'rot' && it) change(function () { it.r = ((it.r || 0) + +k.getAttribute('data-d') + 360) % 360; });
      else if (a === 'recol' && it) change(function () { it.c = COLORS[st.col]; });
      else if (a === 'front' && it) change(function () { b.doc.items = b.doc.items.filter(function (x) { return x !== it; }).concat([it]); });
      else if (a === 'dots') { b.doc.dots = k.getAttribute('data-v'); redraw(); save(); }
      else if (a === 'del' && it) change(function () { dropMoves(agentCodes([it])); b.doc.items = b.doc.items.filter(function (x) { return x !== it; }); st.sel = ''; });
    });
    root.addEventListener('change', function (e) {
      var k = e.target.getAttribute && e.target.getAttribute('data-mt'), it = selected();
      if (k === 'shown') { b.doc.shown = !!e.target.checked; save(); }
      else if (k === 'amove') { b.doc.agents_move = !!e.target.checked; save(); }
      else if (k === 'bgop' && b.doc.bg) { b.doc.bg.op = (+e.target.value || 60) / 100; b.draw(); save(); }
      else if (k === 'scale') { var v = parseFloat(e.target.value); if (v > 0) { b.doc.scale = v; redraw(); drawScale(); save(); } }
      else if (k === 'label' && it) change(function () { it.label = e.target.value.trim(); });
      else if (k === 'text' && it) change(function () { it.text = e.target.value.trim() || it.text; });
      else if (k === 'bgfile' && e.target.files && e.target.files[0]) upload(e.target.files[0]);
    });
    root.addEventListener('input', function (e) {
      if (e.target.classList.contains('mt-name')) { b.doc.title = e.target.value; save(); }
      else if (e.target.getAttribute('data-mt') === 'bgop' && b.doc.bg) { b.doc.bg.op = (+e.target.value || 60) / 100; b.draw(); }
    });
    root.addEventListener('keydown', function (e) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && st.sel && !/INPUT|TEXTAREA/.test((e.target.tagName || ''))) { e.preventDefault(); var it = selected(); if (it) change(function () { dropMoves(agentCodes([it])); b.doc.items = b.doc.items.filter(function (x) { return x !== it; }); st.sel = ''; }); }
    });
    root.tabIndex = -1;

    // The background photo: into Storage (mats/{cell}/...), then under the mat.
    function upload(file) {
      status('Uploading the photo…');
      var ext = (/\.(png|jpe?g|webp|gif)$/i.exec(file.name || '') || [, 'png'])[1].toLowerCase();
      window.dgAcellApi.handler().then(function (F) {
        return F.storage().ref('mats/' + cellId + '/bg-' + Date.now() + '.' + ext).put(file, { contentType: file.type || 'image/' + ext });
      }).then(function (snap) { return snap.ref.getDownloadURL(); }).then(function (url) {
        var img = new Image();
        img.onload = function () { setBg(url, img.naturalWidth, img.naturalHeight); };
        img.onerror = function () { setBg(url, 4, 3); };
        img.src = url;
      }).catch(function (e) { status('Upload failed: ' + ((e && e.message) || e)); });
    }
    function setBg(url, nw, nh) {
      var v = b.view, w = Math.min(60, v.w * .9), h = w * nh / nw;
      change(function () { b.doc.bg = { url: url, x: r2(v.x + v.w * .05), y: r2(v.y + v.h * .05), w: r2(w), h: r2(h), op: .6, locked: false }; });
      st.tool = 'scale'; marks();
      status('Now draw a line along the photo\'s scale bar (or anything you know the length of) to set its scale.');
    }
    window.dgMat._setBg = setBg;   // for tests: a photo without Storage

    // Live: the mat as saved; this tab's own unsaved changes win.
    function apply(d) {
      d = d || {};
      if (st.dirty || st.drag) return;
      b.doc = { title: d.title || '', scale: d.scale || 1, shown: !!d.shown, items: Array.isArray(d.items) ? d.items : [], bg: d.bg || null, ruler: null, dots: d.dots === 'white' ? 'white' : 'black', agents_move: d.agents_move !== false };
      if (st.sel && !selected()) st.sel = '';
      st.loaded = true; syncNpcs();
      drawScale();
      if (!st.fitted) { st.fitted = true; setTimeout(function () { b.fit(); redraw(); }, 0); } else redraw();
    }
    signedIn().then(function () {
      unsub = matRef(cellId).onSnapshot(function (snap) { apply(snap.exists ? snap.data() : null); }, function (e) { status('Could not load the mat: ' + ((e && e.message) || e)); });
      // The Agents moving their own tokens: shown here as they drag, with
      // a word in the bar about who moved.
      unsubM = movesRef(cellId).onSnapshot(function (snap) {
        var m = readMoves(snap), who = [];
        Object.keys(m).forEach(function (c) { var o = b.moves[c]; if (!o || o.x !== m[c].x || o.y !== m[c].y) who.push(c); });
        b.moves = m;
        if (st.drag && st.drag.kind === 'move') return;
        drawSel(); b.draw();
        if (who.length) {
          var names = who.map(function (c) { var t = (b.doc.items || []).filter(function (x) { return x.t === 'agent' && x.code === c; })[0]; return t ? String(t.name || c).split(/\s+/)[0] : ''; }).filter(Boolean);
          if (names.length) { status(names.join(', ') + ' moved.'); clearTimeout(st.movedT); st.movedT = setTimeout(function () { status(''); }, 4000); }
        }
      }, function () { /* moves are extra */ });
    }).catch(function (e) { apply(null); status('Not signed in as Handler: ' + ((e && e.message) || e)); });
    drawScale(); redraw();
    return {
      destroy: function () { stopRot(); if (unsub) unsub(); if (unsubM) unsubM(); unsub = unsubM = null; clearTimeout(saveT); clearTimeout(st.movedT); if (st.dirty) save(); host.innerHTML = ''; },
      board: b, state: st,
      // The desk redraws: the Agents and the session's NPCs (and their
      // Initiative state on the mat).
      refreshAgents: function () { drawAgentsTray(); drawNpcTray(); syncNpcs(); }
    };
  }

  // A session's NPCs as the mat's NPC tray lists them (keyed by name).
  function npcsOf(s) {
    return ((s && s.npcs) || []).filter(function (n) { return n && String(n.name || '').trim(); }).map(function (n) {
      return { key: String(n.name).trim().toLowerCase(), name: String(n.name).trim(), photo: /^(https?:|data:)/.test(n.photo || '') ? n.photo : '', dex: n.dex || '',
        hidden: !!n.hidden, out: n.init === false, down: n.hp != null && n.hp !== '' && +n.hp <= 0 };
    });
  }
  window.dgMat = { editor: editor, view: view, tokens: TOKENS, itemSvg: itemSvg, npcsOf: npcsOf };
})();
