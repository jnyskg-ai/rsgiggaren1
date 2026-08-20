const VERSION = '4.7.0';
const CACHE_PREFIX = 'rsg-coach-shell-';
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
const APP_SHELL = [
  './Coash%201.0.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => Promise.all(APP_SHELL.map(async url => {
      const response = await fetch(new Request(url, { cache: 'reload' }));
      if (!response.ok) throw new Error(`Kunde inte cacha ${url}`);
      await cache.put(url, response);
    })))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'GET_VERSION') event.source?.postMessage({ type: 'APP_VERSION', version: VERSION });
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(new Request(request, { cache: 'no-store' }))
        .then(response => {
          if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
          return response;
        })
        .catch(async () => (await caches.match(request)) || caches.match('./Coash%201.0.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request)
        .then(response => {
          if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
