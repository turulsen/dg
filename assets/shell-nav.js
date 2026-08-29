/* ══════════════════════════════════════════════
   SHELL NAV -- hub.html's persistent top nav (Phase 3 of the app-shell
   plan, docs/firebase-migration/ on this branch). Replaces the earlier
   manual test-swap buttons with the real thing: two destinations,
   Agent Hub and A-Cell, swapping #dg-shell-content's src the same way
   the old test buttons did (plain iframe.src assignment) -- the OUTER
   shell document, and everything hoisted in it (Table Radio, Dice
   Roller), is never touched by that, which is the entire point of the
   shell.

   Deep pages (a player's Agent File, Character Sheet, Notes) are
   reached the normal way: a relative <a href> inside whichever page is
   currently loaded navigates that iframe on its own, same-origin, no
   extra plumbing needed here. This nav only tracks the two top-level
   "which world am I in" destinations, and highlights whichever one the
   iframe's CURRENT page actually belongs to (Agent Hub's own sub-pages
   -- stats/, notes/, dg-agent-portal.html -- all still read as "Agent
   Hub"), however it got there: this nav's own click, or a link clicked
   from inside the loaded page itself.

   "Back to Clearance" links (index.html, outside this shell's own page
   set entirely) are a separate, one-line fix on each page itself
   (target="_top" on that one <a>) -- not this file's job. A plain
   relative link inside the loaded page already navigates correctly on
   its own; only leaving the shell's page set needs help. ══════════════════════════════════════════════ */
(function () {
  "use strict";
  var DESTINATIONS = [
    { id: 'agent-hub', label: 'Agent Hub', target: 'agent-hub.html' },
    { id: 'a-cell', label: 'A-Cell', target: 'a-cell.html' }
  ];

  // Which top-level destination a given iframe path "belongs to" --
  // plain substring checks, not an anchored regex, since this site may
  // be served under a subpath (e.g. a GitHub Pages project page) and a
  // leading-slash-anchored pattern would silently never match there.
  function classify(pathname) {
    if (pathname.indexOf('a-cell.html') !== -1) return 'a-cell';
    if (pathname.indexOf('agent-hub.html') !== -1 ||
        pathname.indexOf('dg-agent-portal.html') !== -1 ||
        pathname.indexOf('/stats/') !== -1 ||
        pathname.indexOf('/notes/') !== -1) return 'agent-hub';
    return null;
  }

  var nav = document.createElement('div');
  nav.id = 'dg-shell-nav';
  nav.innerHTML = DESTINATIONS.map(function (d) {
    return '<button type="button" data-target="' + d.target + '" data-nav-id="' + d.id + '">' + d.label + '</button>';
  }).join('');

  var header = document.getElementById('dg-shell-header');
  header.appendChild(nav);

  var iframe = document.getElementById('dg-shell-content');

  function setActive(activeId) {
    Array.prototype.forEach.call(nav.querySelectorAll('button'), function (btn) {
      btn.classList.toggle('dg-shell-nav-active', btn.getAttribute('data-nav-id') === activeId);
    });
  }

  nav.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-target]');
    if (!btn) return;
    iframe.src = btn.getAttribute('data-target');
  });

  iframe.addEventListener('load', function () {
    try {
      setActive(classify(iframe.contentWindow.location.pathname));
    } catch (e) { /* cross-origin somehow -- shouldn't happen, same-origin site */ }
  });

  // Initial state, for whatever src the iframe started on -- the load
  // listener above won't have fired yet for that first, already-loading
  // page, so this covers the very first paint.
  setActive(classify(iframe.getAttribute('src') || ''));
})();
