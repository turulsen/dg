/* A-Cell's icons (v3.13.0): one family drawn for A-Cell -- a 24px grid,
   1.6 stroke, square ends; filled shapes carry class "f". No emoji
   anywhere in A-Cell's phone layout.

     window.dgIcons.svg(name, cls) -> '<svg class="ic cls">…</svg>'
     window.dgIcons.names() */
(function () {
  'use strict';
  if (window.dgIcons) return;
  var P = {
    session: '<path d="M3 6h6l2 2h10v11H3z"/><path d="M3 11h18"/>',
    agents: '<rect x="3" y="5" width="18" height="14"/><rect x="6" y="8.5" width="5" height="7"/><path d="M14 10h4M14 13h4M14 16h2"/>',
    add: '<path d="M12 5v14M5 12h14"/>',
    evidence: '<path d="M6 3h12v18H6z"/><path d="M6 7h12"/><rect x="9" y="11" width="6" height="5"/>',
    more: '<rect class="f" x="4.5" y="11" width="3" height="3"/><rect class="f" x="10.5" y="11" width="3" height="3"/><rect class="f" x="16.5" y="11" width="3" height="3"/>',
    pads: '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><circle cx="8" cy="16" r="3"/><circle cx="16" cy="16" r="3"/>',
    initiative: '<rect x="8" y="4" width="12" height="9"/><path d="M5 8v11h12"/><path d="M11 8h6"/>',
    notes: '<rect x="6" y="3" width="13" height="18"/><path d="M3.5 7h4M3.5 12h4M3.5 17h4M10 8h6M10 12h6M10 16h4"/>',
    dice: '<rect x="4" y="4" width="16" height="16"/><rect class="f" x="7" y="7" width="2.6" height="2.6"/><rect class="f" x="10.7" y="10.7" width="2.6" height="2.6"/><rect class="f" x="14.4" y="14.4" width="2.6" height="2.6"/>',
    tape: '<rect x="2.5" y="5.5" width="19" height="13"/><circle cx="8.5" cy="11" r="2"/><circle cx="15.5" cy="11" r="2"/><path d="M6.5 18.5l1.5-3h8l1.5 3"/>',
    play: '<path class="f" d="M8 5l11 7-11 7z"/>',
    pause: '<rect class="f" x="7" y="5" width="3.4" height="14"/><rect class="f" x="13.6" y="5" width="3.4" height="14"/>',
    stop: '<rect class="f" x="6" y="6" width="12" height="12"/>',
    prev: '<path class="f" d="M19 6l-9 6 9 6z"/><rect class="f" x="5" y="6" width="2.6" height="12"/>',
    next: '<path class="f" d="M5 6l9 6-9 6z"/><rect class="f" x="16.4" y="6" width="2.6" height="12"/>',
    loop: '<path d="M4 12V8h13"/><path d="M14 5l3 3-3 3"/><path d="M20 12v4H7"/><path d="M10 19l-3-3 3-3"/>',
    eject: '<path class="f" d="M12 5l7 8H5z"/><rect class="f" x="5" y="16" width="14" height="2.6"/>',
    back: '<path d="M20 12H5"/><path d="M11 6l-6 6 6 6"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
    swap: '<path d="M8 19V5"/><path d="M4.5 8.5L8 5l3.5 3.5"/><path d="M16 5v14"/><path d="M12.5 15.5L16 19l3.5-3.5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
    edit: '<path d="M4 20l1-4.5L15.5 5 19 8.5 8.5 19z"/><path d="M13 7.5l3.5 3.5"/>',
    camera: '<rect x="3" y="7" width="18" height="13"/><path d="M8 7l1.5-3h5L16 7"/><circle cx="12" cy="13.5" r="3.5"/>',
    filter: '<path d="M4 5h16l-6 7.5V19l-4 1.5v-8z"/>',
    handle: '<path d="M6 8h12M6 12h12M6 16h12"/>',
    chev: '<path d="M9 5l7 7-7 7"/>',
    caret: '<path d="M7 10l5 5 5-5"/>',
    eye: '<path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.8"/>',
    hide: '<path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><path d="M4 4l16 16"/>',
    vault: '<rect x="4" y="3" width="16" height="18"/><path d="M4 9h16M4 15h16M10 6h4M10 12h4M10 18h4"/>',
    sheet: '<rect x="3" y="5" width="18" height="14"/><path d="M3 10h18M3 14.5h18M9 5v14"/>',
    cells: '<rect x="3" y="9" width="8" height="11"/><rect x="13" y="9" width="8" height="11"/><path d="M3 9l1.5-3H8l1 3M13 9l1.5-3H18l1 3"/>',
    mixer: '<path d="M6 4v16M12 4v16M18 4v16"/><rect x="4" y="13" width="4" height="3"/><rect x="10" y="7" width="4" height="3"/><rect x="16" y="15" width="4" height="3"/>',
    idcard: '<rect x="5" y="3" width="14" height="18"/><rect x="9" y="6" width="6" height="7"/><path d="M8 16h8M8 18.5h5"/>',
    upload: '<path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 20h16"/>',
    trash: '<path d="M5 7h14M9.5 7V4h5v3M7 7l1 13h8l1-13"/>',
    copy: '<rect x="8" y="8" width="12" height="12"/><path d="M4 16V4h12"/>',
    debrief: '<rect x="5" y="4" width="14" height="17"/><rect x="9" y="2.5" width="6" height="3"/><path d="M8 10h8M8 13.5h8M8 17h5"/>',
    radio: '<rect x="3" y="9" width="18" height="11"/><path d="M6 9l11-5"/><circle cx="9" cy="14.5" r="2.6"/><path d="M14.5 13h3.5M14.5 16h3.5"/>',
    link: '<path d="M9 4H5v16h4M15 4h4v16h-4"/><path d="M8 8v8M16 8v8" stroke-width="1.2"/>',
    sort: '<path d="M7 4v15"/><path d="M4 16l3 3 3-3"/><path d="M13 6h7M13 11h5M13 16h3"/>',
    person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-4 3.6-6 7-6s6.2 2 7 6"/>',
    pin: '<path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/>',
    grid: '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12"/><rect class="f" x="3.5" y="5" width="2" height="2"/><rect class="f" x="3.5" y="11" width="2" height="2"/><rect class="f" x="3.5" y="17" width="2" height="2"/>',
    template: '<path d="M5 3h10l4 4v14H5z"/><path d="M15 3v4h4"/><path d="M8 11h8M8 14.5h8M8 18h5" stroke-dasharray="2 1.5"/>',
    operation: '<path d="M4 20V4l8 3 8-3v16l-8 3-8-3z" /><path d="M12 7v16"/>',
    scene: '<path d="M4 6h16M4 12h10M4 18h13"/><path d="M18 9v6M15 12h6"/>',
    npc: '<circle cx="12" cy="9" r="4.5"/><path d="M9.5 8.5h1M13.5 8.5h1"/><path d="M5 21c1-4 3.8-6 7-6s6 2 7 6"/><path d="M10 11.8h4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>'
  };
  function svg(n, cls) { return '<svg class="ic ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (P[n] || '') + '</svg>'; }
  window.dgIcons = { svg: svg, names: function () { return Object.keys(P); } };
})();
