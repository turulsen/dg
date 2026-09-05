/* ══════════════════════════════════════════════
   Delta Green Agent Hub -- offline app shell.

   Only the static shell (HTML/CSS/JS/images listed below) is cached.
   Everything else -- script.google.com JSONP calls, Google Fonts,
   YouTube/SoundCloud embeds -- is deliberately left alone (no
   respondWith) so it always goes straight to the network: caching a
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
const CACHE_NAME = 'dg-hub-shell-v64';

const SHELL_FILES = [
  './',
  'index.html',
  'hub.html',
  'agent-hub.html',
  'a-cell.html',
  'dg-agent-portal.html',
  'dg-id-creator.html',
  'manifest.json',
  'assets/theme-folder.css',
  'assets/table-radio.js',
  'assets/dice-roller.js',
  'assets/shell-nav.js',
  'assets/sw-update.js',
  'assets/agent-code.js',
  'assets/mars-tech-seal.png',
  'assets/restricted-stamp.png',
  'assets/delta-green-triangle.png',
  'assets/delta-green-wordmark-white.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-192-maskable.png',
  'assets/icons/icon-512-maskable.png',
  'stats/index.html',
  'stats/styles.css',
  'stats/assets/art/logo.png',
  'stats/professions.js',
  'stats/bonds.js',
  'stats/bio.js',
  'stats/scripts.js',
  'stats/printable-sheet.js',
  'stats/pdf-export.js',
  'stats/sheets-export.js',
  'stats/sheets-import.js',
  'stats/save-load.js',
  'stats/agent-portal-export.js',
  'stats/cloud-sync.js',
  'stats/equipment-data.js',
  'stats/equipment-picker.js',
  'stats/wizard.js',
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
      .then((cache) => cache.addAll(SHELL_FILES))
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
  // Navigations (HTML pages) may carry query params (?load=, ?theme=,
  // ?code=) that the page's own JS reads client-side -- match on path
  // only so e.g. stats/index.html?load=OWEN-CS12 still hits the cached
  // stats/index.html rather than falling through to the network.
  const path = url.pathname.replace(/^\/dg-campaign\//, '').replace(/^\//, '');
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
      const network = fetch(req).then((res) => {
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
