import fs from 'fs';
import path from 'path';

/**
 * Source-text-scan test (same convention as this repo's Edge Function and
 * SQL migration coverage) — public/sw.js runs only inside a Service Worker
 * context, which this Jest/RN project has no execution harness for.
 *
 * Mascot-notification-experiences round: `notificationclick` previously
 * only focused/opened a window with no way for the app to know WHICH
 * notification was tapped — src/lib/webNotificationEntry.ts now needs that
 * data via either a postMessage (app already open) or a `notif` URL param
 * (app closed). This asserts the handler forwards the SAME data the push
 * already carried (never invents new fields) through both paths, and that
 * the original plain fallback is preserved when there is no data at all.
 */
describe('public/sw.js — notificationclick forwards notification data (structural)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'public', 'sw.js'), 'utf8').replace(/\r\n/g, '\n');

  it('reads event.notification.data before closing the notification', () => {
    const closeIdx = source.indexOf('event.notification.close();');
    const dataIdx = source.indexOf('const data = event.notification.data;');
    expect(dataIdx).toBeGreaterThan(-1);
    expect(closeIdx).toBeGreaterThan(dataIdx);
  });

  it('postMessages the exact tapped data to an existing client, using the agreed "walkie-notification-click" source marker', () => {
    expect(source).toContain("client.postMessage({ source: 'walkie-notification-click', data });");
  });

  it('never postMessages when there is no data, preserving the original plain-focus fallback', () => {
    const postIdx = source.indexOf('client.postMessage');
    const guardBlock = source.slice(postIdx - 80, postIdx);
    expect(guardBlock).toMatch(/if\s*\(data\s*&&/);
  });

  it('opening a NEW window (no existing client) carries the data as a `notif` query param, never anything regenerated here', () => {
    expect(source).toContain("'/?notif=' + encodeURIComponent(JSON.stringify(data))");
  });

  it('still falls back to opening a bare "/" when there is no data at all', () => {
    const openWindowCalls = [...source.matchAll(/clients\.openWindow\(([^)]*)\)/g)].map((m) => m[1].trim());
    expect(openWindowCalls).toContain("'/'");
  });

  it('the push event handler itself is unchanged — still shows a notification exactly from the server payload', () => {
    expect(source).toContain("self.registration.showNotification(title, options)");
    expect(source).toContain("icon: '/icon-192.png'");
    expect(source).toContain("badge: '/notification-badge.png'");
  });
});
