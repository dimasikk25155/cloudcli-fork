// Service Worker for Claude CLI PWA
// v6: notification click navigates the existing TWA window to the finished session.
// v5: sticky push — close-by-tag, Consigliere «Сделал», bot-dead click opens Server panel.
// v4: NO app caching. Earlier versions cached HTML/JS ("cache-first" assets),
// which kept serving stale bundles after a deploy — the source of endless
// "why do I still see the old version" pain. This worker now NEVER intercepts
// or caches app requests, so the browser always hits the network for the
// latest build. It stays registered only for push notifications.
const CACHE_NAME = 'claude-cli-v6-nocache';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.map(name => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('push', event => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Claude CLI', body: event.data.text() };
  }

  const tag = payload.data?.tag || `${payload.data?.sessionId || 'global'}:${payload.data?.code || 'default'}`;

  if (payload.close && tag) {
    event.waitUntil(
      self.registration.getNotifications({ tag }).then(notifications => {
        notifications.forEach(notification => notification.close());
      })
    );
    return;
  }

  const options = {
    body: payload.body || '',
    icon: '/logo-256.png',
    badge: '/logo-128.png',
    data: payload.data || {},
    tag,
    silent: payload.silent === true,
    renotify: payload.silent !== true,
    actions: Array.isArray(payload.actions) ? payload.actions : []
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Claude CLI', options)
  );
});

function openOrFocus(urlPath, data) {
  const dest = new URL(urlPath, self.location.origin).href;
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clientList => {
    for (const client of clientList) {
      if (!client.url.includes(self.location.origin)) continue;
      await client.focus();
      // TWA/PWA: focusing the existing window is not enough — the SPA stays on
      // whatever chat was already open. WindowClient.navigate loads the session URL.
      if (typeof client.navigate === 'function') {
        try {
          await client.navigate(dest);
        } catch {
          // ignore — postMessage below is the fallback
        }
      }
      client.postMessage({
        type: 'notification:navigate',
        sessionId: data?.sessionId || null,
        provider: data?.provider || null,
        urlPath,
        panel: data?.panel || null
      });
      return;
    }
    return self.clients.openWindow(dest);
  });
}

self.addEventListener('notificationclick', event => {
  const data = event.notification.data || {};

  if (event.action === 'done' && data.code === 'consigliere.task') {
    event.waitUntil(
      fetch('/api/sticky-push/done', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ row: data.row, sig: data.sig })
      })
        .catch(() => undefined)
        .then(() => event.notification.close())
    );
    return;
  }

  event.notification.close();

  const urlPath = data.urlPath;
  if (typeof urlPath === 'string' && /^https?:\/\//.test(urlPath)) {
    event.waitUntil(self.clients.openWindow(urlPath));
    return;
  }

  const sessionId = data.sessionId;
  const provider = data.provider || null;
  const path = typeof urlPath === 'string' && urlPath.startsWith('/')
    ? urlPath
    : (sessionId ? `/session/${sessionId}` : '/');

  event.waitUntil(openOrFocus(path, { sessionId, provider, panel: data.panel }));
});
