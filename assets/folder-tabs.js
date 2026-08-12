/* ══════════════════════════════════════════════
   FOLDER TABS -- computes the rounded, tab-shaped clip-path for each
   .tw ear-tab and the matching seam-free manila texture positioning
   for .folder-body, from real measured pixel positions rather than a
   value authored for one canvas size.

   Why this has to be measured, not hand-authored: the Agent Hub's tab
   count and label widths are real roster data (however many Agents,
   whatever their names are), and the folder itself is a fluid-width
   element (phones through desktop) -- neither the number of tabs nor
   the available width is known at author time. A hand-written
   clip-path baked to one canvas size breaks (misaligned corners, a
   visible seam between the active tab and the folder body) at any
   other width or tab count, which is exactly what happened before
   this was made to measure itself.

   Call window.dgFolderTabs.layout(folderEl) any time a .folder's tabs
   change (a new one added, the roster re-rendered, etc). Every
   .folder present at load is laid out automatically, and re-laid-out
   on resize.

   The shared coordinate frame every tab's clip-path is built against is
   the tab-strip's full CONTENT width (scrollWidth), not its visible
   clientWidth -- .tab-strip scrolls horizontally (nowrap) rather than
   wrapping onto multiple rows when a roster has more tabs than fit,
   since a wrapped second row would measure offsetLeft relative to that
   row and collide with a same-x tab on the first row.
   ══════════════════════════════════════════════ */
(function () {
  "use strict";

  var R_TAB = 8;    // corner radius at the top of each tab
  var R_BODY = 8;   // corner radius where the tab's shoulder meets the folder's own top edge
  var CANVAS_H = 1200; // matches assets/manila-texture.jpg's native height -- avoids vertical stretch

  function capPath(x1, x2, W, capH, tabH) {
    var rTab = Math.max(0, Math.min(R_TAB, tabH / 2, (x2 - x1) / 2));
    var rBody = Math.max(0, Math.min(R_BODY, capH - tabH));
    return (
      "M " + (x1 + rTab) + " 0" +
      " L " + (x2 - rTab) + " 0" +
      " A " + rTab + " " + rTab + " 0 0 1 " + x2 + " " + rTab +
      " L " + x2 + " " + tabH +
      " L " + (W - rBody) + " " + tabH +
      " A " + rBody + " " + rBody + " 0 0 1 " + W + " " + (tabH + rBody) +
      " L " + W + " " + capH +
      " L 0 " + capH +
      " L 0 " + (tabH + rBody) +
      " A " + rBody + " " + rBody + " 0 0 1 " + rBody + " " + tabH +
      " L " + x1 + " " + tabH +
      " L " + x1 + " " + rTab +
      " A " + rTab + " " + rTab + " 0 0 1 " + (x1 + rTab) + " 0" +
      " Z"
    );
  }

  function layout(folderEl) {
    if (!folderEl) return;
    var tabStrip = folderEl.querySelector(".tab-strip");
    var folderBody = folderEl.querySelector(".folder-body");
    if (!tabStrip) return; // pages with a folder but no tabs (e.g. index.html)
    var tabs = Array.prototype.slice.call(tabStrip.querySelectorAll(".tw"));
    if (!tabs.length) return;

    // A tab's clip-path has to span the tab-strip's FULL width, not
    // just its own label's width -- the "shoulder" (the flat run from
    // this tab's own edge out to the folder's edge, which is what
    // makes it read as one continuous folder rather than a floating
    // label) can only be drawn by an element that's actually that
    // wide. So every .tw is switched to position:absolute, full-strip-
    // sized, and clipped down to its own window into that space.
    // Their NATURAL width (from their own label) has to be measured
    // first, in normal flex flow, before that switch -- a positioned,
    // full-width tab no longer reflects it. Reverting first makes this
    // correct on every call, not just the first one (a previous
    // layout() call may have already positioned these tabs).
    tabs.forEach(function (tab) { tab.classList.remove("dgft-positioned"); });

    // W is the strip's full CONTENT width, not clientWidth -- with
    // flex-wrap:nowrap a roster with more tabs than fit overflows and
    // scrolls rather than wrapping, so the shared clip-path frame has to
    // span that full (possibly-wider-than-visible) content width for
    // every tab's coordinates to land inside it.
    var W = Math.max(tabStrip.clientWidth, tabStrip.scrollWidth);
    var capH = tabStrip.clientHeight;
    // The notch step isn't measured separately -- it's always exactly
    // R_BODY above the strip's own bottom edge, so it tracks whatever
    // capH ends up being (the 560px-wide breakpoint shrinks the strip's
    // own height, and this follows without a second value to keep in sync).
    var tabH = Math.max(0, capH - R_BODY);
    if (!W || !capH) return; // not laid out yet (display:none, etc) -- try again next call

    var positions = tabs.map(function (tab) {
      return { x1: tab.offsetLeft, x2: tab.offsetLeft + tab.offsetWidth };
    });

    tabs.forEach(function (tab, i) {
      var pos = positions[i];
      tab.classList.add("dgft-positioned");
      tab.style.width = W + "px";
      tab.style.clipPath = "path('" + capPath(pos.x1, pos.x2, W, capH, tabH) + "')";
      tab.style.backgroundSize = "auto, " + W + "px " + CANVAS_H + "px";
      tab.style.backgroundPosition = "0 0, 0 0";
      var span = tab.querySelector("span");
      if (span) {
        span.style.left = pos.x1 + "px";
        span.style.width = (pos.x2 - pos.x1) + "px";
      }
    });

    if (folderBody) {
      folderBody.style.backgroundSize = "auto, " + W + "px " + CANVAS_H + "px";
      folderBody.style.backgroundPosition = "0 0, 0 -" + capH + "px";
    }
  }

  function layoutAll() {
    Array.prototype.forEach.call(document.querySelectorAll(".folder"), layout);
  }

  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layoutAll, 60);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", layoutAll);
  } else {
    layoutAll();
  }
  window.addEventListener("load", layoutAll); // fonts finishing late can shift tab widths

  window.dgFolderTabs = { layout: layout, layoutAll: layoutAll };
})();
