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
    expect(source).toMatch(/import \{ enableWebPush, reconcileWebPushSubscription, type WebPushStatus \} from '\.\.\/lib\/webPush';/);
  });

  it('calls reconcileWebPushSubscription (not a bare status read) inside the visible+web mount effect', () => {
    const idx = source.indexOf("if (!visible || Platform.OS !== 'web')");
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, idx + 1200);
    expect(block).toContain('void reconcileWebPushSubscription().then(setWebPushStatus);');
  });
});
