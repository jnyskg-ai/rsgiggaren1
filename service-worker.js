const VERSION = '4.12.0';
const CACHE_PREFIX = 'rsg-coach-shell-';
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
const MEDIA_CACHE_NAME = 'rsg-coach-guide-media-v1';
const REST_STATE_CACHE = 'rsg-coach-rest-state-v1';
const REST_STATE_URL = new URL('./__rest_state__', self.location.href).href;
const GUIDE_MEDIA_HOSTS = new Set(['raw.githubusercontent.com']);

const APP_SHELL = [
  './index.html',
  './Coash%201.0.html',
  './exercise-media.js',
  './workout-editor.js',
  './program-order.js',
  './notifications.js',
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
    text.includes('program-order.js') ? '' : '<script src="./program-order.js"></script>',
    text.includes('notifications.js') ? '' : '<script src="./notifications.js"></script>'
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

function notificationPayload(event) {
  if (!event.data) return {};
  try { return event.data.json(); }
  catch (_) {
    try { return { body: event.data.text() }; }
    catch (_) { return {}; }
  }
}

function showRestNotification(payload = {}) {
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  return self.registration.showNotification(payload.title || 'Vilan är klar', {
    body: payload.body || 'Kör nästa set.',
    icon: payload.icon || './icon-192.png',
    badge: payload.badge || './icon-192.png',
    tag: payload.tag || 'rsg-rest-timer',
    renotify: true,
    silent: false,
    requireInteraction: false,
    data: { url: './Coash%201.0.html#train', kind: 'rest-timer', ...data }
  });
}

async function saveRestState(state) {
  const cache = await caches.open(REST_STATE_CACHE);
  await cache.put(REST_STATE_URL, new Response(JSON.stringify(state), {
    headers: { 'Content-Type': 'application/json' }
  }));
}

async function readRestState() {
  try {
    const cache = await caches.open(REST_STATE_CACHE);
    const response = await cache.match(REST_STATE_URL);
    return response ? await response.json() : null;
  } catch (_) {
    return null;
  }
}

async function clearRestState() {
  const cache = await caches.open(REST_STATE_CACHE);
  await cache.delete(REST_STATE_URL);
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
  self.skipWaiting();
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
  if (event.data?.type === 'SHOW_REST_NOTIFICATION') {
    event.waitUntil(showRestNotification(event.data.payload || {}));
  }
  if (event.data?.type === 'SET_ACTIVE_REST_SCHEDULE') {
    event.waitUntil(saveRestState({
      scheduleId: event.data.scheduleId || '',
      endAt: Number(event.data.endAt) || 0,
      exercise: event.data.exercise || 'Nästa set'
    }));
  }
  if (event.data?.type === 'CLEAR_ACTIVE_REST_SCHEDULE') {
    event.waitUntil(clearRestState());
  }
});

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    const payload = notificationPayload(event);
    const incomingScheduleId = payload?.data?.scheduleId || '';
    if (incomingScheduleId) {
      const active = await readRestState();
      if (!active?.scheduleId || active.scheduleId !== incomingScheduleId) return;
      await clearRestState();
    }
    await showRestNotification(payload);
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const requestedUrl = event.notification.data?.url || './Coash%201.0.html#train';
  const targetUrl = new URL(requestedUrl, self.location.href).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        if ('navigate' in client) await client.navigate(targetUrl);
        return client.focus();
      }
    }
    return self.clients.openWindow(targetUrl);
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.href === REST_STATE_URL) return;

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
