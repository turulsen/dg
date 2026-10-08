/* Evidence viewer: a filed photo full-screen, with pinch-zoom, drag to
   pan, double-tap / double-click to zoom, mouse-wheel zoom and +/−
   buttons. Used wherever a player opens Evidence (the Field Notes
   notebook, Agent Hub's Handouts, Notes' evidence modal).

   Why its own zoom instead of the browser's: the notebook is a fixed,
   scaled overlay, and on iOS Safari pinching it zooms the whole page
   around a small thumbnail, so a filed document couldn't be read. The
   stage takes every touch itself (touch-action:none) and zooms the
   photo alone.

   PDFs aren't drawn here: pdfHref() gives a link Safari's own PDF
   viewer opens (and zooms) in a new tab. A raw data: PDF becomes a
   blob: URL first -- Safari silently blocks opening data: URIs (see
   BUGFIXES.md, "Evidence PDFs opened a blank tab").

   window.dgEvidenceViewer = { open(src, title), close(), isPdf(src), pdfHref(src) } */
(function () {
  'use strict';
  if (window.dgEvidenceViewer) return;

  function isPdf(src) {
    src = String(src || '');
    if (src.indexOf('data:application/pdf') === 0) return true;
    // Storage URLs keep the file's extension in their path, before ?alt=media&token=...
    return /\.pdf(\?|#|$)/i.test(src);
  }

  var blobCache = {};
  function pdfHref(src) {
    src = String(src || '');
    if (src.indexOf('data:') !== 0) return src;
    if (blobCache[src]) return blobCache[src];
    try {
      var parts = src.split(',');
      var mime = (parts[0].match(/data:([^;]+)/) || [])[1] || 'application/pdf';
      var bin = atob(parts[1]);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return (blobCache[src] = URL.createObjectURL(new Blob([bytes], { type: mime })));
    } catch (e) { return src; }
  }

  var CSS =
    '.dg-ev-viewer{position:fixed;inset:0;z-index:2147483000;background:rgba(6,5,2,.94);display:flex;flex-direction:column;' +
      'font-family:"Special Elite","Courier Prime",monospace;color:#e9e3ce;}' +
    '.dg-ev-bar{flex:none;display:flex;align-items:center;gap:8px;padding:calc(env(safe-area-inset-top,0px) + 10px) 12px 10px;}' +
    '.dg-ev-title{flex:1;min-width:0;font-size:13px;letter-spacing:.06em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
    '.dg-ev-btn{flex:none;font:inherit;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#e9e3ce;background:rgba(0,0,0,.5);' +
      'border:1px solid rgba(233,227,206,.4);padding:7px 12px;min-width:40px;min-height:36px;cursor:pointer;text-decoration:none;border-radius:0;margin:0;width:auto;box-shadow:none;}' +
    '.dg-ev-btn:hover{background:rgba(233,227,206,.12);}' +
    '.dg-ev-stage{position:relative;flex:1;overflow:hidden;touch-action:none;cursor:grab;-webkit-user-select:none;user-select:none;}' +
    '.dg-ev-stage.dg-ev-drag{cursor:grabbing;}' +
    '.dg-ev-stage img{position:absolute;left:0;top:0;transform-origin:0 0;max-width:none;max-height:none;-webkit-user-drag:none;' +
      'box-shadow:0 8px 40px rgba(0,0,0,.6);pointer-events:none;}' +
    '.dg-ev-hint{flex:none;text-align:center;font-size:11px;letter-spacing:.08em;color:rgba(233,227,206,.6);padding:8px 12px calc(env(safe-area-inset-bottom,0px) + 10px);}';

  var el = null, prevOverflow = '', keyHandler = null;

  function close() {
    if (!el) return;
    el.remove();
    el = null;
    document.documentElement.style.overflow = prevOverflow;
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    keyHandler = null;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function openHere(src, title) {
    close();
    if (!document.getElementById('dg-ev-viewer-css')) {
      var st = document.createElement('style');
      st.id = 'dg-ev-viewer-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    el = document.createElement('div');
    el.className = 'dg-ev-viewer';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', title || 'Evidence');
    el.innerHTML =
      '<div class="dg-ev-bar"><div class="dg-ev-title">' + esc(title || 'Evidence') + '</div>' +
        '<button type="button" class="dg-ev-btn" data-ev-z="out" aria-label="Zoom out">−</button>' +
        '<button type="button" class="dg-ev-btn" data-ev-z="in" aria-label="Zoom in">+</button>' +
        '<button type="button" class="dg-ev-btn" data-ev-z="fit">Fit</button>' +
        '<button type="button" class="dg-ev-btn" data-ev-close>Close</button></div>' +
      '<div class="dg-ev-stage"><img alt=""></div>' +
      '<div class="dg-ev-hint">Pinch or double-tap to zoom · drag to move</div>';
    document.body.appendChild(el);
    prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    var stage = el.querySelector('.dg-ev-stage');
    var img = stage.querySelector('img');
    var MAX = 8;
    // s: zoom relative to "fit to screen"; x/y: the photo's top-left on the stage.
    var v = { s: 1, x: 0, y: 0, fw: 0, fh: 0 };

    function size() { return { w: stage.clientWidth, h: stage.clientHeight }; }
    function clamp() {
      var z = size(), w = v.fw * v.s, h = v.fh * v.s;
      v.x = w <= z.w ? (z.w - w) / 2 : Math.min(0, Math.max(z.w - w, v.x));
      v.y = h <= z.h ? (z.h - h) / 2 : Math.min(0, Math.max(z.h - h, v.y));
    }
    function draw() {
      clamp();
      img.style.width = v.fw + 'px';
      img.style.height = v.fh + 'px';
      img.style.transform = 'translate(' + v.x + 'px,' + v.y + 'px) scale(' + v.s + ')';
      el.setAttribute('data-zoom', v.s.toFixed(2));
    }
    function fit() {
      var z = size(), nw = img.naturalWidth || 1, nh = img.naturalHeight || 1;
      var k = Math.min(z.w / nw, z.h / nh);
      // Small images aren't blown up past 2x their own size to start with.
      k = Math.min(k, 2);
      v.fw = nw * k; v.fh = nh * k; v.s = 1;
      v.x = (z.w - v.fw) / 2; v.y = (z.h - v.fh) / 2;
      draw();
    }
    function zoomAt(px, py, s) {
      s = Math.max(1, Math.min(MAX, s));
      v.x = px - (px - v.x) * (s / v.s);
      v.y = py - (py - v.y) * (s / v.s);
      v.s = s;
      draw();
    }
    function centre() { var z = size(); return [z.w / 2, z.h / 2]; }

    img.onload = fit;
    img.src = src;
    if (img.complete && img.naturalWidth) fit();

    // Pointer gestures: one finger pans, two pinch, a quick second tap zooms.
    var pts = {}, pinch = null, lastTap = 0, lastTapAt = null, moved = false;
    function local(e) { var r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    function two() { var k = Object.keys(pts); return k.length >= 2 ? [pts[k[0]], pts[k[1]]] : null; }
    stage.addEventListener('pointerdown', function (e) {
      if (stage.setPointerCapture) { try { stage.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ } }
      pts[e.pointerId] = local(e);
      moved = false;
      var p = two();
      if (p) pinch = { d: Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]) || 1, s: v.s, m: [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2] };
      stage.classList.add('dg-ev-drag');
      e.preventDefault();
    });
    stage.addEventListener('pointermove', function (e) {
      if (!pts[e.pointerId]) return;
      var prev = pts[e.pointerId], cur = local(e);
      pts[e.pointerId] = cur;
      if (Math.abs(cur[0] - prev[0]) + Math.abs(cur[1] - prev[1]) > 1) moved = true;
      var p = two();
      if (p && pinch) {
        var d = Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]) || 1;
        var m = [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2];
        v.x += m[0] - pinch.m[0]; v.y += m[1] - pinch.m[1];
        pinch.m = m;
        zoomAt(m[0], m[1], pinch.s * d / pinch.d);
      } else if (!p) {
        v.x += cur[0] - prev[0]; v.y += cur[1] - prev[1];
        draw();
      }
      e.preventDefault();
    });
    function up(e) {
      if (!pts[e.pointerId]) return;
      var at = pts[e.pointerId];
      delete pts[e.pointerId];
      if (!two()) pinch = null;
      if (!Object.keys(pts).length) stage.classList.remove('dg-ev-drag');
      if (e.type !== 'pointerup' || moved || Object.keys(pts).length) return;
      var now = Date.now();
      if (now - lastTap < 320 && lastTapAt && Math.abs(at[0] - lastTapAt[0]) + Math.abs(at[1] - lastTapAt[1]) < 30) {
        zoomAt(at[0], at[1], v.s > 1.05 ? 1 : 2.5);
        lastTap = 0;
      } else { lastTap = now; lastTapAt = at; }
    }
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      var p = local(e);
      zoomAt(p[0], p[1], v.s * Math.exp(-e.deltaY * 0.0025));
    }, { passive: false });
    // Older iOS fires its own pinch gesture events; keep them off the page.
    ['gesturestart', 'gesturechange'].forEach(function (t) { el.addEventListener(t, function (e) { e.preventDefault(); }); });

    el.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-ev-close')) { close(); return; }
      var z = b.getAttribute('data-ev-z'), c = centre();
      if (z === 'in') zoomAt(c[0], c[1], v.s * 1.6);
      else if (z === 'out') zoomAt(c[0], c[1], v.s / 1.6);
      else if (z === 'fit') fit();
    });
    keyHandler = function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      else if (e.key === '+' || e.key === '=') { var c = centre(); zoomAt(c[0], c[1], v.s * 1.6); }
      else if (e.key === '-') { var c2 = centre(); zoomAt(c2[0], c2[1], v.s / 1.6); }
    };
    document.addEventListener('keydown', keyHandler);
    window.addEventListener('resize', function onResize() { if (!el) { window.removeEventListener('resize', onResize); return; } fit(); });
    el.querySelector('[data-ev-close]').focus();
  }

  // From a page framed inside another of this site's pages (Notes inside
  // the notebook), open on the top page so the photo gets the whole screen.
  function open(src, title) {
    if (!src) return;
    try {
      if (window.top !== window && window.top.dgEvidenceViewer && window.top.location.origin === location.origin) {
        window.top.dgEvidenceViewer.openHere(src, title);
        return;
      }
    } catch (e) { /* cross-origin top: open here */ }
    openHere(src, title);
  }

  window.dgEvidenceViewer = { open: open, openHere: openHere, close: close, isPdf: isPdf, pdfHref: pdfHref };
})();
