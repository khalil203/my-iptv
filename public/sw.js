// Small service worker: caches the app shell so it opens fast and installs as an app.
const CACHE = 'iptv-shell-v8';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/core.js', '/i18n.js', '/logos.js', '/site.js', '/icons.js', '/m3u.js', '/manifest.json', '/icon-192.png', '/logo.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname === '/proxy' || u.pathname.startsWith('/apk') || u.pathname === '/tv') return;
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then((r) => r || caches.match('/'))));
});
