self.addEventListener('push', (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {
      body: event.data ? event.data.text() : '',
    };
  }

  const title = payload.title || 'Walkie Doggy';
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/notification-badge.png',
    data: payload.data || {},
  };

  // Family Chat: the server tags every message uniquely, so a newer message
  // does not replace a still-visible notification for an earlier one. Pushes
  // without a tag (walk reminders, requests) behave exactly as before.
  if (typeof payload.tag === 'string' && payload.tag) {
    options.tag = payload.tag;
    options.renotify = true;
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Mascot-notification-experiences round: forward the tapped notification's
// own data (the exact payload supabase/functions/send-walk-reminders and
// send-request-push already attach to every push — never anything new
// generated here) into the app, so it can route to the right screen and
// play the matching mascot moment. An already-open client is focused AND
// sent the data via postMessage (src/lib/webNotificationEntry.ts listens
// for it); with no open client, a new window is opened with the same data
// carried in a `notif` query-string param, read once at cold-launch by
// that same module. Absent/empty data (or a notification from before this
// change) falls back to the original plain focus/openWindow('/') behavior
// — unchanged.
self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data;
  event.notification.close();

  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    }).then((clientList) => {
      let targetUrl = '/';
      if (data && typeof data === 'object') {
        try {
          targetUrl += '?notif=' + encodeURIComponent(JSON.stringify(data));
        } catch {
          // Invalid notification data falls back to opening the app normally.
        }
      }

      // `postMessage` alone is lossy when an installed PWA is resuming: its
      // React listener may not exist yet. Navigate the app client with the
      // notification payload so startup and background-resume use one path.
      const client = clientList.find((candidate) => candidate.url.startsWith(self.location.origin));
      if (client && 'navigate' in client) {
        const notificationUrl = new URL(targetUrl, self.location.origin).href;
        return client.navigate(notificationUrl).then((navigated) => {
          if (navigated && 'focus' in navigated) return navigated.focus();
          return clients.openWindow ? clients.openWindow(notificationUrl) : client.focus();
        }).catch(() => clients.openWindow ? clients.openWindow(notificationUrl) : client.focus());
      }

      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
