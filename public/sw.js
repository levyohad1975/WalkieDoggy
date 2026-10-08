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
      for (const client of clientList) {
        if ('focus' in client) {
          const focused = client.focus();
          if (data && 'postMessage' in client) {
            client.postMessage({ source: 'walkie-notification-click', data });
          }
          return focused;
        }
      }

      if (clients.openWindow) {
        if (data) {
          try {
            const url = '/?notif=' + encodeURIComponent(JSON.stringify(data));
            return clients.openWindow(url);
          } catch {
            // Fall through to the plain-open fallback below.
          }
        }
        return clients.openWindow('/');
      }
    })
  );
});
