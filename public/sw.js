// Minimal offline support: pages are network-first (so deploys show up straight away), other
// same-origin assets are served from cache and refreshed in the background.
const CACHE = 'coil-timer-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  const fetchAndCache = () =>
    fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
      }
      return response;
    });

  if (request.mode === 'navigate') {
    event.respondWith(fetchAndCache().catch(() => caches.match(request)));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const fresh = fetchAndCache();
      if (cached) {
        fresh.catch(() => {});
        return cached;
      }
      return fresh;
    }),
  );
});
