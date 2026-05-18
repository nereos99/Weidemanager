/* Weidemanager Service Worker
   Strategie:
   - App-Shell (HTML, Manifest, Icons): cache-first
   - CDN-Libraries (Leaflet, Turf, Fonts): cache-first (versionierte URLs)
   - Map-Tiles: stale-while-revalidate (offline nutzbar, online aktuell)
   Cache-Version hochzählen bei Code-Änderungen erzwingt Update.
*/

const VERSION = 'v1.4.1';
const SHELL_CACHE = `weidemanager-shell-${VERSION}`;
const LIBS_CACHE  = `weidemanager-libs-${VERSION}`;
const TILES_CACHE = `weidemanager-tiles-v1`;
const ACTIVE_CACHES = new Set([SHELL_CACHE, LIBS_CACHE, TILES_CACHE]);
const CACHE_PREFIXES = ['weidemanager-', 'koppel-']; // 'koppel-' für Cleanup älterer Versionen

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png'
];

const LIB_HOSTS = [
  'unpkg.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];
const TILE_HOSTS = [
  'basemaps.cartocdn.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(c => c.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => CACHE_PREFIXES.some(p => k.startsWith(p)) && !ACTIVE_CACHES.has(k))
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Map-Tiles → stale-while-revalidate
  if (TILE_HOSTS.some(h => url.hostname.endsWith(h))) {
    event.respondWith(staleWhileRevalidate(req, TILES_CACHE));
    return;
  }

  // CDN-Libraries → cache-first
  if (LIB_HOSTS.some(h => url.hostname.endsWith(h))) {
    event.respondWith(cacheFirst(req, LIBS_CACHE));
    return;
  }

  // App-Shell (gleicher Origin) → cache-first, Fallback Netzwerk
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (e) {
    // Fallback: index.html für Navigations-Requests anbieten
    if (req.mode === 'navigate') {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }
    throw e;
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const networkPromise = fetch(req).then(res => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return cached || networkPromise || new Response('', { status: 504 });
}
