import fs from 'fs';
import path from 'path';

/**
 * Request-notifications repair — "refresh/reopen recovery" wiring. Mirrors
 * the EXISTING registerPushTokenAndReconcile() effect (native remote push)
 * exactly, for the Web Push counterpart: reconcileWebPushSubscription() is
 * silent/best-effort and must run on every app launch once a profile is
 * claimed, not only when the person happens to open Reminders. Source-scan
 * convention: this repo has no render-test harness for App.tsx's effects
 * (see App.test.ts's own unit tests, which exercise the exported
 * registerPushTokenAndReconcile() function directly rather than rendering
 * the component).
 */
describe('App.tsx — Web Push reconcile wiring (structural)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8').replace(/\r\n/g, '\n');

  it('imports reconcileWebPushSubscription from lib/webPush', () => {
    expect(source).toMatch(/import \{ reconcileWebPushSubscription \} from '\.\/src\/lib\/webPush';/);
  });

  it('calls it from a web-only effect gated the same way as registerPushTokenAndReconcile (currentUserId set, not a System Admin observer)', () => {
    const effectStart = source.indexOf("if (Platform.OS === 'web' && currentUserId && !systemObserverActive)");
    expect(effectStart).toBeGreaterThan(-1);
    const effectBlock = source.slice(effectStart, effectStart + 200);
    expect(effectBlock).toMatch(/void reconcileWebPushSubscription\(\);/);
  });

  it('is a separate effect from registerPushTokenAndReconcile — never piggybacks on or replaces the native push wiring', () => {
    const nativeIdx = source.indexOf('void registerPushTokenAndReconcile();');
    const webIdx = source.indexOf('void reconcileWebPushSubscription();');
    expect(nativeIdx).toBeGreaterThan(-1);
    expect(webIdx).toBeGreaterThan(nativeIdx);
  });
});
