// Service Worker for Claude CLI PWA
// v4: NO app caching. Earlier versions cached HTML/JS ("cache-first" assets),
// which kept serving stale bundles after a deploy — the source of endless
// "why do I still see the old version" pain. This worker now NEVER intercepts
// or caches app requests, so the browser always hits the network for the
// latest build. It stays registered only for push notifications.
const CACHE_NAME = 'claude-cli-v4-nocache';

// Install: take over immediately, precache nothing.
self.addEventListener('install', () => {
  self.skipWaiting();
});

// Activate: purge every cache any previous version created, then claim clients
// so this no-cache worker controls open tabs right away.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.map(name => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

// No 'fetch' handler on purpose: every request goes straight to the network,
// so a fresh deploy is picked up on the next load with no cache to bust.

// Push notification event
self.addEventListener('push', event => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Claude CLI', body: event.data.text() };
  }

  const options = {
    body: payload.body || '',
    icon: '/logo-256.png',
    badge: '/logo-128.png',
    data: payload.data || {},
    tag: payload.data?.tag || `${payload.data?.sessionId || 'global'}:${payload.data?.code || 'default'}`,
    renotify: true
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Claude CLI', options)
  );
});

// Notification click event
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const sessionId = event.notification.data?.sessionId;
  const provider = event.notification.data?.provider || null;
  const urlPath = sessionId ? `/session/${sessionId}` : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin)) {
          await client.focus();
          client.postMessage({
            type: 'notification:navigate',
            sessionId: sessionId || null,
            provider,
            urlPath
          });
          return;
        }
      }
      return self.clients.openWindow(urlPath);
    })
  );
});
