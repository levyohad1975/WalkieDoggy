import fs from 'fs';
import path from 'path';

/**
 * Source-text-scan test (same convention as this repo's Edge Function and
 * SQL migration coverage) — public/sw.js runs only inside a Service Worker
 * context, which this Jest/RN project has no execution harness for.
 *
 * Mascot-notification-experiences round: `notificationclick` previously
 * used a one-shot postMessage for an existing client; if an installed PWA
 * was still resuming, React had no listener and silently lost the tap. The
 * click must navigate an existing client or open a new one with the exact
 * data in `notif`, so startup handles both cold launch and resume.
 */
describe('public/sw.js — notificationclick forwards notification data (structural)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'public', 'sw.js'), 'utf8').replace(/\r\n/g, '\n');

  it('reads event.notification.data before closing the notification', () => {
    const closeIdx = source.indexOf('event.notification.close();');
    const dataIdx = source.indexOf('const data = event.notification.data;');
    expect(dataIdx).toBeGreaterThan(-1);
    expect(closeIdx).toBeGreaterThan(dataIdx);
  });

  it('puts the exact notification data in a URL consumed on startup', () => {
    expect(source).toContain("targetUrl += '?notif=' + encodeURIComponent(JSON.stringify(data));");
  });

  it('navigates and focuses an existing installed-PWA client instead of relying on a lossy message event', () => {
    expect(source).toContain('client.navigate(notificationUrl)');
    expect(source).toContain('const notificationUrl = new URL(targetUrl, self.location.origin).href;');
    expect(source).toContain("if (navigated && 'focus' in navigated) return navigated.focus();");
  });

  it('opening a NEW window also carries the data as a `notif` query param', () => {
    expect(source).toContain('if (clients.openWindow) return clients.openWindow(targetUrl);');
  });

  it('falls back to the app root when there is no valid data', () => {
    expect(source).toContain("let targetUrl = '/';");
  });

  it('the push event handler itself is unchanged — still shows a notification exactly from the server payload', () => {
    expect(source).toContain("self.registration.showNotification(title, options)");
    expect(source).toContain("icon: '/icon-192.png'");
    expect(source).toContain("badge: '/notification-badge.png'");
  });
});
