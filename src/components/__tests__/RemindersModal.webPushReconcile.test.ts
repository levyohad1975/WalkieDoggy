import fs from 'fs';

/**
 * Request-notifications repair — "refresh/reopen recovery". RemindersModal
 * previously called the read-only getWebPushStatus() on mount, which only
 * ever reports what the browser believes locally — never whether the
 * server still actually has a matching web_push_subscriptions row. Opening
 * this modal must repair a silently-broken subscription (see
 * reconcileWebPushSubscription()'s own doc comment in lib/webPush.ts), not
 * just redisplay its stale local status. Source-scan convention: this repo
 * has no render-test harness for modals.
 */
describe('RemindersModal Web Push reconcile wiring (structural)', () => {
  const source = fs.readFileSync(require.resolve('../RemindersModal'), 'utf8').replace(/\r\n/g, '\n');

  it('imports reconcileWebPushSubscription for its mount effect, and no longer imports the plain read-only getWebPushStatus', () => {
    expect(source).toMatch(/import \{ enableWebPush, reconcileWebPushSubscription, verifyServerSubscription, type WebPushStatus \} from '\.\.\/lib\/webPush';/);
  });

  it('calls reconcileWebPushSubscription (not a bare status read) inside the visible+web mount effect', () => {
    const idx = source.indexOf("if (!visible || Platform.OS !== 'web')");
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, idx + 1800);
    expect(block).toContain('void reconcileWebPushSubscription().then((status) => {');
    expect(block).toContain('setWebPushStatus(status);');
  });

  // Real-device QA fix — a persistence failure must be surfaced, not
  // silent: an 'error' result now sets the same webPushError text the
  // explicit "אפשר התראות" tap already uses, and is cleared on any other
  // result so a stale error message never survives a later success.
  it('surfaces a reconcile "error" result as a visible webPushError message, and clears it otherwise', () => {
    const idx = source.indexOf("if (!visible || Platform.OS !== 'web')");
    const block = source.slice(idx, idx + 2200);
    expect(block).toMatch(/setWebPushError\(\s*\n?\s*status === 'error'/);
    expect(block).toMatch(/:\s*null\s*\n\s*\);/);
  });

  it("renders a distinct status message and keeps the enable button available when status is 'error' (never conflated with 'subscribed')", () => {
    expect(source).toMatch(/webPushStatus === 'error'\s*\n\s*\?\s*'/);
    const buttonGuardIdx = source.indexOf("webPushStatus !== 'subscribed' &&");
    expect(buttonGuardIdx).toBeGreaterThan(-1);
    const buttonGuard = source.slice(buttonGuardIdx, buttonGuardIdx + 160);
    // 'error' is deliberately NOT excluded here — it's neither 'subscribed'
    // nor 'denied' nor 'unsupported', so the "אפשר התראות" button keeps
    // showing, letting the person retry.
    expect(buttonGuard).not.toContain("'error'");
  });
});
