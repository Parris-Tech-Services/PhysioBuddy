// Offline support and reminder-notification actions for the physio app.
// App files are served network-first (so updates arrive promptly) with the
// cached copy as the offline fallback.
const CACHE = 'physio-v1';
const SHELL = [
  './index.html', './styles.css', './manifest.webmanifest',
  './js/app.js', './js/data.js', './js/session.js', './js/schedule.js', './js/progress.js', './js/store.js',
  './js/figures.js', './js/report.js', './js/function.js', './js/milestones.js', './js/voice.js', './js/commands.js', './js/docs.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('physio-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith(new URL('./', self.registration.scope).pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req.mode === 'navigate' ? './index.html' : req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req.mode === 'navigate' ? './index.html' : req, { ignoreSearch: true });
      return hit || Response.error();
    }
  })());
});

// Notification buttons: hand the action to an open app window, or open one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const action = event.action || 'start';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = all.find((c) => new URL(c.url).pathname.startsWith(new URL('./', self.registration.scope).pathname));
    if (client) {
      client.postMessage({ type: 'reminder-action', action });
      return client.focus();
    }
    return self.clients.openWindow(new URL(`./?action=${encodeURIComponent(action)}#/home`, self.registration.scope).href);
  })());
});
