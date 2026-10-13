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

  it('calls it from a web-only effect gated the same way as registerPushTokenAndReconcile (currentUserId set, not a System Admin observer) — covers identity becoming available after the initial render, e.g. completing onboarding without a full reload', () => {
    const effectStart = source.indexOf("if (Platform.OS === 'web' && currentUserId && !systemObserverActive)");
    expect(effectStart).toBeGreaterThan(-1);
    const effectBlock = source.slice(effectStart, effectStart + 300);
    expect(effectBlock).toMatch(/void reconcileWebPushSubscription\(\)\.then/);
  });

  it('is a separate effect from registerPushTokenAndReconcile — never piggybacks on or replaces the native push wiring', () => {
    const nativeIdx = source.indexOf('void registerPushTokenAndReconcile();');
    const webIdx = source.indexOf('void reconcileWebPushSubscription()');
    expect(nativeIdx).toBeGreaterThan(-1);
    expect(webIdx).toBeGreaterThan(nativeIdx);
  });

  // REAL-DEVICE QA FIX — "recovery after refresh/reopen": the mount-time
  // effect above only ever fires once, when currentUserId transitions from
  // null to set. Reopening an already-signed-in installed PWA resumes the
  // SAME app instance with no remount — currentUserId never changes — so a
  // persistence failure on the very first attempt had no other automatic
  // retry point. reconcileWebPushSubscription()'s own doc comment already
  // claimed "every app launch/foreground"; this is what actually makes
  // that true, by wiring it into the SAME foreground pipeline
  // registerPushTokenAndReconcile() (native) and the schedule/requests
  // reload already use on every AppState 'active' transition.
  it('also runs from runForegroundSyncOnce (the shared cold-start + every-foreground-transition pipeline), web-gated, logging (never throwing) on failure', () => {
    const fnStart = source.indexOf('async function runForegroundSyncOnce()');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = source.slice(fnStart, fnStart + 4000);
    expect(fnBody).toMatch(/if \(Platform\.OS === 'web'\) \{\s*\n\s*const webPushStatus = await reconcileWebPushSubscription\(\);/);
    expect(fnBody).toMatch(/if \(webPushStatus === 'error'\) \{/);
    expect(fnBody).toContain("console.error('[webPush] foreground reconcile failed to persist this device\\'s subscription');");
  });
});
