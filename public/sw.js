// Small service worker: offline-first for the shell so the app always opens instantly.
const CACHE = 'iptv-shell-v103';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/core.js', '/i18n.js', '/logos.js', '/site.js', '/icons.js', '/m3u.js', '/manifest.json', '/icon-192.png', '/logo.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname === '/proxy' || u.pathname.startsWith('/apk') || u.pathname === '/tv') return;
  // Network-first with instant fallback to the cached shell — prevents both stalls and stale shells.
  e.respondWith(
    fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('/')))
  );
});

// ---- Notifications: a push only wakes this device; the notes are fetched from the server and shown. ----
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let notes = [];
    try {
      const sub = await self.registration.pushManager.getSubscription();
      const r = await fetch('/api/push/pull', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub ? sub.endpoint : '' }) });
      notes = (await r.json()).notes || [];
    } catch {}
    if (!notes.length) notes = [{ title: 'INTPROTO-TV', body: 'You have a new notification. Tap to open.', url: '/intprototv', tag: 'generic' }];
    for (const n of notes.slice(-5)) {
      await self.registration.showNotification(n.title || 'INTPROTO-TV', { body: n.body || '', tag: n.tag || n.id || undefined, renotify: !!n.tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: n.url || '/' }, timestamp: n.at || Date.now() });
    }
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) c.postMessage({ type: 'push', notes });
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if (c.url.startsWith(url) && 'focus' in c) return c.focus(); }
    for (const c of all) { if (new URL(c.url).origin === self.location.origin && 'navigate' in c) { await c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  })());
});
self.addEventListener('pushsubscriptionchange', (e) => { /* the app re-subscribes on next open */ });
