/* Yalla Stock service worker: shows push notifications (new tasks, ready for printing, wholesale orders)
   with the phone's notification sound, and opens the right screen when one is tapped. No offline caching. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    // iPhone needs a visible notification for every push, so one is always shown
    await self.registration.showNotification(d.title || 'Yalla Stock', {
      body: d.body || '',
      icon: '/brand/icon-512.png',
      badge: '/brand/icon-512.png',
      tag: d.tag || undefined,
      renotify: !!d.tag,
      data: { url: d.url || '/' },
    });
    // an open app plays its own sound and refreshes
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    wins.forEach((w) => w.postMessage({ type: 'push', title: d.title, body: d.body, url: d.url }));
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).pathname === '/' && 'focus' in w) {
        w.postMessage({ type: 'open', url });
        return w.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
