/* ══════════════════════════════════════════════
   Delta Green Agent Hub -- service worker registration +
   "Update available" banner.

   sw.js activates new versions immediately (skipWaiting +
   clients.claim), but a tab left open across a deploy keeps running
   the JS it already loaded in memory until it's reloaded -- there was
   previously no signal that this had happened, just silently stale
   behavior until someone thought to hard-refresh. This registers the
   worker and shows a small dismissible banner the moment a new version
   has taken control of the current tab, with a Reload button.

   Self-contained inline styling (not a stylesheet rule) since this
   script is shared verbatim across pages with otherwise unrelated
   themes (folder/paper look, A-Cell terminal look, stats sheet look).
   ══════════════════════════════════════════════ */
(function () {
  if (!('serviceWorker' in navigator)) return;
  // hub.html's shell loads every other page into #dg-shell-content, an
  // iframe -- and this script runs independently in BOTH the outer shell
  // document and whatever page is loaded inside that iframe, since it's
  // included on every page. Both detect the same service-worker update
  // (one scope covers the whole origin) and each shows its OWN
  // position:fixed banner within its own document, stacking as two
  // separate banners on screen -- reported live as "double banner on
  // top of screen" with the lower one's Reload button unreachable/
  // inert-feeling (it only reloads the iframe's own src, not the whole
  // page, so tapping it looked like nothing happened). The outer shell's
  // own instance is the only one that needs to run: its Reload does a
  // real full-page reload, which re-navigates the iframe fresh too.
  if (window.frameElement && window.frameElement.id === 'dg-shell-content') return;

  var swPath = (document.currentScript && document.currentScript.getAttribute('data-sw')) || 'sw.js';

  function showUpdateBanner() {
    if (document.getElementById('dg-update-banner')) return;
    var bar = document.createElement('div');
    bar.id = 'dg-update-banner';
    // Anchored to the top, not the bottom -- the table-radio widget
    // (assets/table-radio.js) already lives fixed at the bottom-right on
    // every page and a bottom banner would sit right on top of it.
    Object.assign(bar.style, {
      position: 'fixed', left: '0', right: '0', top: '0', zIndex: '99999',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px',
      padding: '10px 16px', background: '#1a1f16', color: '#d9d2b8',
      borderBottom: '1px solid #6a7a4f', fontFamily: "'Courier Prime', monospace",
      fontSize: '13px', boxShadow: '0 2px 10px rgba(0,0,0,.4)'
    });

    var label = document.createElement('span');
    label.textContent = 'An update is available.';

    var reloadBtn = document.createElement('button');
    reloadBtn.type = 'button';
    reloadBtn.textContent = 'Reload';
    Object.assign(reloadBtn.style, {
      background: '#4a5a34', color: '#ecead8', border: '1px solid #6a7a4f',
      padding: '4px 12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit'
    });
    reloadBtn.addEventListener('click', function () { window.location.reload(); });

    var dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.textContent = '×';
    dismissBtn.setAttribute('aria-label', 'Dismiss');
    Object.assign(dismissBtn.style, {
      background: 'transparent', color: '#8a8266', border: 'none',
      cursor: 'pointer', fontSize: '18px', lineHeight: '1', padding: '0 4px'
    });
    dismissBtn.addEventListener('click', function () { bar.remove(); });

    bar.appendChild(label);
    bar.appendChild(reloadBtn);
    bar.appendChild(dismissBtn);
    document.body.appendChild(bar);
  }

  window.addEventListener('load', function () {
    // sw.js calls clients.claim(), which fires 'controllerchange' even on
    // a page's very first-ever visit -- an until-now-uncontrolled page
    // becoming controlled for the first time isn't an update (this page's
    // own resources already came straight from the network, nothing
    // stale to reload). Track whether a controller already existed when
    // this page loaded; only a change *after* that counts as real.
    var hadController = !!navigator.serviceWorker.controller;
    var seenFirstChange = false;

    // { updateViaCache: 'none' } -- without this, the browser's own
    // update check for sw.js ITSELF can be answered from ordinary HTTP
    // cache instead of hitting the network, on top of GitHub Pages'
    // own Cache-Control on static files. sw.js bumping CACHE_NAME on
    // every shell change means nothing if the browser never actually
    // re-fetches sw.js to notice the byte it changed -- this is the
    // one call that has to always hit the network, every time.
    navigator.serviceWorker.register(swPath, { updateViaCache: 'none' }).then(function (reg) {
      // A worker already waiting when we register means an update landed
      // while this page had no active controller yet to notice it.
      if (reg.waiting && hadController) showUpdateBanner();

      reg.addEventListener('updatefound', function () {
        var installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', function () {
          if (installing.state === 'installed' && hadController) {
            showUpdateBanner();
          }
        });
      });

      // The other half of the gap: a page that's opened once and left
      // open (exactly how this app gets used at a live table, or during
      // a testing session) never re-checks for a new deploy on its own
      // -- browsers only check for a new sw.js on navigation, and this
      // tab isn't navigating anywhere. A live report: several fixes
      // shipped in a row, and a phone that had A-Cell open from before
      // any of them kept running the old JS indefinitely, reload
      // included, since reloading a page doesn't re-fetch the service
      // worker file itself on every load either, only on the browser's
      // own update schedule. Explicitly poking reg.update() on an
      // interval, and whenever the tab becomes visible again (the
      // common iPad case: Safari backgrounded mid-session, then
      // switched back to), closes both gaps without waiting on the
      // browser's own timing.
      function pokeForUpdate() { reg.update().catch(function () {}); }
      setInterval(pokeForUpdate, 5 * 60 * 1000);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') pokeForUpdate();
      });
    }).catch(function () {});

    // The reliable signal: this tab was being served by one worker and is
    // now being served by a different one -- sw.js's own skipWaiting() +
    // clients.claim() makes this fire shortly after any deploy.
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController && !seenFirstChange) {
        seenFirstChange = true;
        hadController = true; // page is controlled now; any later change is real
        return;
      }
      showUpdateBanner();
    });
  });
})();
