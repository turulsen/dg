/* ══════════════════════════════════════════════
   Delta Green Agent Hub -- offline app shell.

   Only the static shell (HTML/CSS/JS/images listed below) is cached.
   Everything else -- Firestore/Firebase traffic, the Drive image
   proxy, Google Fonts, YouTube/SoundCloud embeds -- is deliberately
   left alone (no respondWith) so it always goes straight to the
   network: caching a
   character sheet or Cells list here would mean serving stale Agent
   data offline and calling it a feature, which is worse than just
   failing normally when there's no signal.

   Strategy is stale-while-revalidate for everything in SHELL_FILES:
   answer instantly from cache (so the app opens with zero signal once
   it's been visited before), then fetch in the background to refresh
   the cache for next time. Bump CACHE_NAME on any shell file change so
   the activate handler below drops the old cache instead of pages
   being stuck on stale JS forever.

   Every URL in SHELL_FILES MUST actually exist -- caches.addAll() below
   is atomic and rejects the WHOLE install if even one entry 404s. That
   silently happened here for over a week: stats/dice-roller.js was
   moved to assets/dice-roller.js on Aug 27 (Phase 3) but this list
   still pointed at the old, now-gone path, so every install attempt
   since then failed. A failed install never replaces whatever service
   worker was already active, so any browser with a working SW from
   before that move got stuck on that exact cache forever, unable to
   ever pick up a newer CACHE_NAME -- while a browser with no SW yet, or
   one that happened to fail its very first install, just fell through
   to the network every time. That's why different browsers/devices
   were showing completely different, inconsistent states of the app
   through this whole migration -- not random flakiness, one bad path
   silently breaking the update mechanism itself.
   ══════════════════════════════════════════════ */
const CACHE_NAME = 'dg-hub-shell-v294';

const SHELL_FILES = [
  './',
  'index.html',
  'hub.html',
  'agent-hub.html',
  'a-cell.html',
  'dg-agent-portal.html',
  'field-id.html',
  'dg-id-creator.html',
  'requisition.html',
  'rules-reference.html',
  'the-incursion.html',
  'friendly.html',
  // Friendly pregens (scripts/pregens/build.js output) -- cached so a
  // one-shot table with bad signal still plays; rebuilding it counts as
  // a shell change like any other (bump CACHE_NAME).
  'friendly/pregens.json',
  'manifest.json',
  'assets/theme-folder.css',
  'assets/table-radio.js',
  'assets/dice-roller.js',
  'assets/shell-nav.js',
  'assets/sw-update.js',
  'assets/js-error-banner.js',
  'assets/storage-guard.js',
  'assets/agent-code.js',
  'assets/dg-store.js',
  'assets/field-notes.js',
  'assets/field-notes.css',
  'assets/evidence-viewer.js',
  'assets/evidence-md.js',
  'assets/tour.js',
  'assets/agencies.js',
  'assets/forge-cards.js',
  'assets/acell-ids.js',
  'assets/acell-vault.js',
  'assets/acell-vault.css',
  'assets/acell-sessions.js',
  'assets/acell-shell.js',
  'assets/acell-shell.css',
  'assets/acell-library.js',
  'assets/acell-console.js',
  'assets/acell-tapes.js',
  'assets/acell-icons.js',
  'assets/acell-mobile.js',
  'assets/acell-mobile-play.js',
  'assets/acell-mobile-agents.js',
  'assets/acell-mobile-notes.js',
  'assets/acell-mobile.css',
  'assets/acell-players.js',
  'assets/acell-play.js',
  'assets/acell-play.css',
  'assets/acell-debrief.js',
  'assets/disorders.js',
  'assets/agent-sheet.js',
  'assets/agent-file.js',
  'assets/agent-file.css',
  'assets/appearance-gen.js',
  'assets/agent-sheet.css',
  'assets/agent-rules.js',
  'assets/agent-live.js',
  'assets/agent-paper.js',
  'assets/agent-paper.css',
  'assets/agent-wear.css',
  'assets/field-id-cards.js',
  'assets/incursion.js',
  'assets/recruit-data.js',
  'assets/recruit-wizard.js',
  'assets/recruit-wizard.css',
  'assets/agent-import.js',
  'assets/mars-tech-seal.png',
  'assets/mors-scientia-seal.png',
  'assets/restricted-stamp.png',
  'assets/delta-green-triangle.png',
  'assets/delta-green-wordmark-white.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-192-maskable.png',
  'assets/icons/icon-512-maskable.png',
  // The Agent File's data tables and the DD Form 315 / spreadsheet
  // readers, loaded on first use by New Recruit and the Agent File.
  'assets/data/professions.js',
  'assets/data/bonds.js',
  'assets/data/bio.js',
  'assets/data/equipment-data.js',
  'assets/sheet-io/pdf-export.js',
  'assets/sheet-io/sheets-import.js',
  // Notes was never actually added to this list -- isShellRequest()'s
  // own basename fallback (matching 'index.html' against the root
  // entry above) accidentally pulled notes/index.html into the
  // stale-while-revalidate path anyway, while notes/notes.js and
  // notes/notes.css matched nothing and got no offline caching or
  // version-bump discipline at all. Listed properly now so all three
  // (and Editor.js's own vendored bundles) get real offline support
  // and get refreshed on the same CACHE_NAME bump as everything else.
  'notes/index.html',
  'notes/notes.js',
  'notes/notes.css',
  'notes/vendor/editorjs.umd.js',
  'notes/vendor/editorjs-header.umd.js',
  'notes/vendor/editorjs-list.umd.js',
  'notes/vendor/editorjs-delimiter.umd.js',
  'notes/vendor/editorjs-marker.umd.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // cache: 'reload' skips the browser's own HTTP cache: Firebase served
      // CSS with a default hour-long max-age, so a new install could store
      // an hour-old stylesheet beside fresh JS (2026-10-30: new markup, old
      // styles, on an iPhone and an iPad).
      .then((cache) => cache.addAll(SHELL_FILES.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

function isShellRequest(url) {
  if (url.origin !== self.location.origin) return false;
  // Navigations (HTML pages) may carry query params (?code=, ?recruit=)
  // that the page's own JS reads client-side -- match on path only so
  // e.g. agent-hub.html?code=OWEN-CS12 still hits the cached
  // agent-hub.html rather than falling through to the network.
  //
  // The site's own subpath (GitHub Pages project sites serve from
  // /<repo-name>/, which has been "/dg/" and, before that, other names
  // as the repo got renamed) used to be hardcoded here as a literal
  // regex -- correct only until the next rename, silently wrong for
  // every other place this same sw.js runs (a bare-origin Firebase
  // preview channel, a local dev server). self.registration.scope is
  // the one source of truth for that prefix everywhere this worker is
  // ever registered, so strip that instead of guessing a literal.
  const scopePath = new URL(self.registration.scope).pathname;
  let path = url.pathname;
  if (path.startsWith(scopePath)) path = path.slice(scopePath.length);
  path = path.replace(/^\//, '');
  return SHELL_FILES.includes(path) || SHELL_FILES.includes(path.split('/').pop());
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (!isShellRequest(url)) return; // let the browser handle it natively

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      // Revalidate in the background regardless of whether this response
      // came from cache -- event.waitUntil keeps it alive past the point
      // respondWith resolves, since the fetch event's lifecycle would
      // otherwise let the browser kill an unawaited promise right after.
      // Ask the server, not the browser's HTTP cache (pages already say no-cache).
      const network = fetch(req.mode === 'navigate' ? req : new Request(req, { cache: 'no-cache' })).then((res) => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      event.waitUntil(network);
      if (cached) return cached;
      const fresh = await network;
      return fresh || Response.error();
    })
  );
});
