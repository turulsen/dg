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

    navigator.serviceWorker.register(swPath).then(function (reg) {
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
