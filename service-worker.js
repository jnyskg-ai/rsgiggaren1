const VERSION = '4.11.0';
const CACHE_PREFIX = 'rsg-coach-shell-';
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
const MEDIA_CACHE_NAME = 'rsg-coach-guide-media-v1';
const GUIDE_MEDIA_HOSTS = new Set(['raw.githubusercontent.com']);
const APP_SHELL = [
  './index.html',
  './Coash%201.0.html',
  './rest-alarm.js',
  './exercise-media.js',
  './workout-editor.js',
  './program-order.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

async function injectEnhancements(response) {
  if (!response || !response.ok) return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;
  const text = await response.text();
  const missingScripts = [
    text.includes('workout-editor.js') ? '' : '<script src="./workout-editor.js"></script>',
    text.includes('program-order.js') ? '' : '<script src="./program-order.js"></script>'
  ].join('');
  const html = !missingScripts
    ? text
    : text.includes('</body>')
      ? text.replace('</body>', `${missingScripts}</body>`)
      : `${text}${missingScripts}`;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => Promise.all(APP_SHELL.map(async url => {
      const response = await fetch(new Request(url, { cache: 'reload' }));
      if (!response.ok) throw new Error(`Kunde inte cacha ${url}`);
      const prepared = url.includes('Coash%201.0.html') ? await injectEnhancements(response) : response;
      await cache.put(url, prepared);
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

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload = {};
    try { payload = event.data?.json() || {}; } catch (_) {}
    if (payload.type !== 'rest-complete') return;

    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const appWindows = windows.filter(client => client.url.startsWith(self.registration.scope));
    const visibleWindow = appWindows.find(client => client.visibilityState === 'visible');
    if (visibleWindow) {
      visibleWindow.postMessage({
        type: 'REST_ALARM_FINISHED',
        timerId: payload.timerId,
        exercise: payload.exercise
      });
      return;
    }

    await self.registration.showNotification('Vilan är klar', {
      body: payload.exercise ? `Dags för nästa set efter ${payload.exercise}.` : 'Dags för nästa set.',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: `rsg-rest-${payload.timerId || 'timer'}`,
      renotify: true,
      silent: false,
      data: {
        timerId: payload.timerId || '',
        url: './Coash%201.0.html?restAlarm=finished'
      }
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || './Coash%201.0.html', self.registration.scope).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const appWindow = windows.find(client => client.url.startsWith(self.registration.scope));
    if (appWindow) {
      appWindow.postMessage({
        type: 'REST_ALARM_FINISHED',
        timerId: event.notification.data?.timerId || ''
      });
      await appWindow.focus();
      return appWindow.navigate(target);
    }
    return self.clients.openWindow(target);
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    if (request.destination !== 'image' || !GUIDE_MEDIA_HOSTS.has(url.hostname)) return;
    event.respondWith(
      caches.open(MEDIA_CACHE_NAME).then(async cache => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok || response.type === 'opaque') await cache.put(request, response.clone());
        return response;
      })
    );
    return;
  }

  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith((async () => {
      try {
        const response = await fetch(new Request(request, { cache: 'no-store' }));
        const prepared = await injectEnhancements(response);
        if (prepared.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, prepared.clone()));
        return prepared;
      } catch (_) {
        return (await caches.match(request)) || caches.match('./Coash%201.0.html');
      }
    })());
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
