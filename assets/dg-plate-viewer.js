/* The Face and Outfit Plates, full size (2026-11-19: "I want the photos to
   be able to open in big size from click and be downloadable").

   A tap on a plate -- Agent Hub's Appearance & photos drop-down
   (agent-file.js: img-face-ERA / img-outfit-ERA) or the notebook's
   Appearance & photos fold (agent-paper.js: .ap-plate-img) -- opens it
   over the page: the plate's name, the Agent and the era above it,
   Download and close. ‹ › (arrow keys, a swipe) step through every plate
   on that drop-down; a double tap or click zooms to 2x and the photo then
   scrolls; Esc, close, or a tap outside the photo shuts it.

   Download saves "<Agent> - Face Plate - 2020s.<ext>". On a phone that can
   share a file (an iPhone) it opens the share sheet, whose Save Image puts
   it in Photos; a file the browser can't read (no CORS) opens in a new
   tab instead, to be saved from there. */
(function () {
  'use strict';
  if (window.dgPlateViewer) return;

  var CSS = '' +
    '.dgpv{ position:fixed; inset:0; z-index:2147483000; background:#0b0b09; display:flex; flex-direction:column; color:#f4eed8; font-family:"Courier Prime",monospace; }' +
    '.dgpv[hidden]{ display:none; }' +
    '.dgpv-bar{ display:flex; align-items:center; gap:8px; padding:12px 12px 10px; padding-top:max(12px, env(safe-area-inset-top)); }' +
    '.dgpv-t{ flex:1; min-width:0; font-family:"Special Elite",monospace; font-size:16px; line-height:1.25; }' +
    '.dgpv-t small{ display:block; font-family:"Courier Prime",monospace; font-size:11px; color:#b8a878; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }' +
    '.dgpv-b{ font-family:"Special Elite",monospace; font-size:12px; letter-spacing:.1em; text-transform:uppercase; border:1.5px solid #f4eed8; color:#f4eed8; background:transparent; padding:8px 11px; cursor:pointer; border-radius:0; }' +
    '.dgpv-b.dgpv-dl{ background:#f4eed8; color:#1c1608; }' +
    '.dgpv-b:disabled{ opacity:.55; cursor:default; }' +
    '.dgpv-stage{ flex:1; position:relative; margin:0 12px; overflow:hidden; display:flex; align-items:center; justify-content:center; touch-action:pan-y pinch-zoom; }' +
    '.dgpv-stage.dgpv-zoom{ overflow:auto; display:block; touch-action:auto; }' +
    '.dgpv-img{ max-width:100%; max-height:100%; object-fit:contain; display:block; cursor:zoom-in; user-select:none; -webkit-user-drag:none; }' +
    '.dgpv-zoom .dgpv-img{ max-width:none; max-height:none; width:200%; cursor:zoom-out; }' +
    '.dgpv-arrow{ position:absolute; top:50%; transform:translateY(-50%); width:44px; height:60px; border:0; background:rgba(244,238,216,.15); color:#f4eed8; font-size:28px; cursor:pointer; z-index:2; border-radius:0; }' +
    '.dgpv-prev{ left:12px; } .dgpv-next{ right:12px; }' +
    '.dgpv-arrow[hidden]{ display:none; }' +
    '.dgpv-dots{ display:flex; justify-content:center; gap:8px; padding:12px; padding-bottom:max(12px, env(safe-area-inset-bottom)); }' +
    '.dgpv-dots i{ width:8px; height:8px; background:#5a5446; display:block; }' +
    '.dgpv-dots i.on{ background:#f4eed8; }' +
    '.dgpv-msg{ text-align:center; font-size:12px; color:#d8cba4; min-height:16px; padding:0 12px; }' +
    /* The plates say they open: a small magnifier in the corner. */
    '.dgpv-can{ position:relative; cursor:zoom-in; }' +
    '.dgpv-can::after{ content:""; position:absolute; right:6px; bottom:6px; width:26px; height:26px; pointer-events:none; background:rgba(28,22,8,.8) url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%23f4eed8%27 stroke-width=%272%27%3E%3Ccircle cx=%2710.5%27 cy=%2710.5%27 r=%276%27/%3E%3Cpath d=%27M15 15l5 5M10.5 8v5M8 10.5h5%27/%3E%3C/svg%3E") center/15px no-repeat; }' +
    '.ap-plate-img.dgpv-can::after{ bottom:16px; }';

  var root = null, items = [], at = 0, opener = null;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function build() {
    if (root) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    root = el('div', 'dgpv'); root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Photo');
    root.innerHTML = '<div class="dgpv-bar"><div class="dgpv-t"><span data-pv="title"></span><small data-pv="sub"></small></div>' +
      '<button type="button" class="dgpv-b dgpv-dl" data-pv="dl">Download</button><button type="button" class="dgpv-b" data-pv="x" aria-label="Close">✕</button></div>' +
      '<div class="dgpv-stage" data-pv="stage"><img class="dgpv-img" data-pv="img" alt=""><button type="button" class="dgpv-arrow dgpv-prev" data-pv="prev" aria-label="Previous">‹</button><button type="button" class="dgpv-arrow dgpv-next" data-pv="next" aria-label="Next">›</button></div>' +
      '<div class="dgpv-msg" data-pv="msg" aria-live="polite"></div><div class="dgpv-dots" data-pv="dots"></div>';
    document.body.appendChild(root);
    var stage = q('stage'), img = q('img');
    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pv]'), k = b && b.getAttribute('data-pv');
      if (k === 'x') return close();
      if (k === 'prev') return step(-1);
      if (k === 'next') return step(1);
      if (k === 'dl') return download();
      if (k === 'img') return;
      // A tap outside the photo (the dark around it) closes.
      if (e.target === root || e.target === stage || (k === 'dots' || k === 'msg')) close();
    });
    var lastTap = 0;
    img.addEventListener('click', function (e) {
      // A double tap (or a click on a desktop) zooms; a single tap on a phone does nothing.
      var now = Date.now(), touch = e.pointerType === 'touch' || (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents);
      if (touch && now - lastTap > 350) { lastTap = now; return; }
      lastTap = 0;
      zoom(!stage.classList.contains('dgpv-zoom'), e);
    });
    var sx = null, sy = 0;
    stage.addEventListener('touchstart', function (e) { sx = e.touches.length === 1 && !stage.classList.contains('dgpv-zoom') ? e.touches[0].clientX : null; sy = e.touches[0].clientY; }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      if (sx == null) return;
      var t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy; sx = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
    }, { passive: true });
    document.addEventListener('keydown', function (e) {
      if (root.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    }, true);
  }
  function q(k) { return root.querySelector('[data-pv="' + k + '"]'); }
  function zoom(on, e) {
    var stage = q('stage');
    stage.classList.toggle('dgpv-zoom', on);
    if (on && e) {
      var r = q('img').getBoundingClientRect();
      // Keep the tapped spot under the finger, roughly.
      var fx = (e.clientX - r.left) / (r.width || 1), fy = (e.clientY - r.top) / (r.height || 1);
      stage.scrollLeft = fx * stage.scrollWidth - stage.clientWidth / 2;
      stage.scrollTop = fy * stage.scrollHeight - stage.clientHeight / 2;
    }
  }
  function show() {
    var it = items[at];
    q('title').textContent = it.title || 'Photo';
    q('sub').textContent = [it.name, it.era].filter(Boolean).join(' · ');
    q('img').src = it.src;
    q('img').alt = it.title || 'Photo';
    q('msg').textContent = '';
    q('dl').disabled = false; q('dl').textContent = 'Download';
    zoom(false);
    q('prev').hidden = q('next').hidden = items.length < 2;
    q('dots').innerHTML = items.length < 2 ? '' : items.map(function (x, i) { return '<i' + (i === at ? ' class="on"' : '') + '></i>'; }).join('');
  }
  function step(d) { if (items.length < 2) return; at = (at + d + items.length) % items.length; show(); }
  function open(list, index) {
    list = (list || []).filter(function (x) { return x && x.src; });
    if (!list.length) return;
    build();
    items = list; at = Math.max(0, Math.min(index || 0, list.length - 1));
    opener = document.activeElement;
    root.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    show();
    q('x').focus();
  }
  function close() {
    if (!root || root.hidden) return;
    root.hidden = true;
    q('img').removeAttribute('src');
    document.documentElement.style.overflow = '';
    if (opener && opener.focus) try { opener.focus(); } catch (e) { /* gone */ }
  }

  function fileName(it, type) {
    var ext = ({ 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' })[type] || 'png';
    var base = [it.name, it.title, it.era].filter(Boolean).join(' - ') || 'Photo';
    return base.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim() + '.' + ext;
  }
  function blobOf(src) {
    if (/^data:/.test(src)) {
      var m = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(src);
      if (!m) return Promise.reject(new Error('bad data'));
      var raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3]), a = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) a[i] = raw.charCodeAt(i);
      return Promise.resolve(new Blob([a], { type: m[1] || 'image/png' }));
    }
    return fetch(src, { mode: 'cors' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); });
  }
  function download() {
    var it = items[at], btn = q('dl');
    if (!it) return;
    btn.disabled = true; btn.textContent = 'Saving…';
    blobOf(it.src).then(function (blob) {
      var name = fileName(it, blob.type), file = null;
      try { file = new File([blob], name, { type: blob.type || 'image/png' }); } catch (e) { file = null; }
      var phone = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
      if (phone && file && navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: name }).catch(function (err) { if (err && err.name !== 'AbortError') throw err; });
      }
      var url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      q('msg').textContent = 'Saved as ' + name;
    }).catch(function () {
      // The browser can't read the file itself (no CORS): open it to save from there.
      window.open(it.src, '_blank', 'noopener');
      q('msg').textContent = 'Opened in a new tab: save it from there.';
    }).then(function () { btn.disabled = false; btn.textContent = 'Download'; });
  }

  /* ── Where the plates are ── */
  var ERA = { '90s': '1990s', '00s': '2000s', '10s': '2010s', '20s': '2020s' };
  function srcOf(img) { return img && img.getAttribute('src') && img.complete !== false ? img.currentSrc || img.src : ''; }
  function hubName(node) {
    var f = document.getElementById('dg-form'), n = f && f.elements && f.elements.char_name && f.elements.char_name.value;
    if (n) return n.trim();
    var p = node.closest('[id^="panel-"]'), t = p && p.querySelector('.paper-title');
    return t ? t.textContent.trim() : '';
  }
  // Agent Hub's Appearance & photos: every era's Face and Outfit Plate.
  function hubItems(node) {
    var box = node.closest('#af-photos') || document, out = [];
    Array.prototype.forEach.call(box.querySelectorAll('img[id^="img-face-"], img[id^="img-outfit-"]'), function (img) {
      var s = srcOf(img); if (!s || img.style.display === 'none') return;
      var m = /^img-(face|outfit)-(.+)$/.exec(img.id);
      out.push({ src: s, img: img, title: m[1] === 'face' ? 'Face Plate' : 'Outfit Plate', era: ERA[m[2]] || '', name: hubName(node) });
    });
    return out;
  }
  // The notebook's fold: .ap-plate-img with its label and its era heading.
  function paperItems(node) {
    var box = node.closest('.ap-eradrop') || node.closest('.as-paper') || document, paper = node.closest('.as-paper');
    var nm = paper && paper.querySelector('.as-head .as-name'), out = [];
    Array.prototype.forEach.call(box.querySelectorAll('.ap-plate-img'), function (b) {
      var s = srcOf(b.querySelector('img')); if (!s) return;
      var era = b.closest('.ap-era'), et = era && era.querySelector('.ap-era-t'), lab = b.parentNode.querySelector('.ap-k');
      out.push({ src: s, img: b.querySelector('img'), title: lab ? lab.textContent.trim() : 'Photo', era: et && et.textContent.trim() !== 'Photos' ? et.textContent.trim() : '', name: nm ? nm.textContent.trim() : '' });
    });
    return out;
  }
  function plateAt(t) {
    var img = t.closest('img[id^="img-face-"], img[id^="img-outfit-"]');
    if (!img) { var w = t.closest('[id^="plate-face-"], [id^="plate-outfit-"]'); img = w && w.querySelector('img'); }
    if (img && srcOf(img)) return { kind: 'hub', img: img };
    var b = t.closest('.ap-plate-img');
    if (b && srcOf(b.querySelector('img'))) return { kind: 'paper', img: b.querySelector('img') };
    return null;
  }
  document.addEventListener('click', function (e) {
    if (root && root.contains(e.target)) return;
    var p = plateAt(e.target);
    if (!p) return;
    e.preventDefault();
    var list = p.kind === 'hub' ? hubItems(p.img) : paperItems(p.img);
    var i = 0; list.forEach(function (x, k) { if (x.img === p.img) i = k; });
    open(list, i);
  });
  // The magnifier on each plate with a photo, kept up as plates load.
  function mark() {
    Array.prototype.forEach.call(document.querySelectorAll('[id^="plate-face-"], [id^="plate-outfit-"], .ap-plate-img'), function (w) {
      var has = !!srcOf(w.querySelector('img')) && (w.querySelector('img').style.display !== 'none');
      w.classList.toggle('dgpv-can', has);
      if (has) { w.setAttribute('title', 'Open full size'); } else w.removeAttribute('title');
    });
  }
  function boot() {
    build();
    mark();
    var t = 0;
    new MutationObserver(function () { clearTimeout(t); t = setTimeout(mark, 120); })
      .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'style'] });
    document.addEventListener('load', function (e) { if (e.target && e.target.tagName === 'IMG') { clearTimeout(t); t = setTimeout(mark, 60); } }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.dgPlateViewer = { open: open, close: close, isOpen: function () { return !!root && !root.hidden; } };
})();
