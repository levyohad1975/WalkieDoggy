import fs from 'fs';
import path from 'path';

/**
 * Request-notifications repair — "zero eligible subscriptions must not be
 * reported as successfully delivered". Real-device QA + direct Staging
 * inspection found request_push_events rows marked 'sent' with zero
 * active push_tokens/web_push_subscriptions for the resolved recipients —
 * nothing was actually delivered. Source-scan convention: this Edge
 * Function runs only under Deno (`@ts-nocheck`, not bundled/type-checked
 * by this repo's own tsc/jest run — see its own header comment), so this
 * repo has no execution harness for it either; see migration0101/0102's
 * own source-scan tests for the same convention applied to SQL.
 */
describe('supabase/functions/send-request-push — zero-destination status (structural)', () => {
  const source = fs
    .readFileSync(path.join(__dirname, '..', '..', '..', 'supabase', 'functions', 'send-request-push', 'index.ts'), 'utf8')
    .replace(/\r\n/g, '\n');

  it('never marks a zero-destination event as "sent" — uses the distinct "no_destination" status instead', () => {
    const zeroDestIdx = source.indexOf('if (expoTokens.length === 0 && webSubscriptions.length === 0) {');
    expect(zeroDestIdx).toBeGreaterThan(-1);
    const block = source.slice(zeroDestIdx, zeroDestIdx + 450);
    expect(block).toMatch(/p_status: 'no_destination',/);
    expect(block).not.toMatch(/p_status: 'sent',/);
  });

  it('a genuine delivery (at least one destination succeeded) still marks "sent" — this fix is scoped only to the zero-destination case', () => {
    const successIdx = source.indexOf('if (totalSent > 0) {');
    expect(successIdx).toBeGreaterThan(-1);
    const block = source.slice(successIdx, successIdx + 300);
    expect(block).toMatch(/p_status: 'sent',/);
  });

  it('a send attempt where nothing succeeded still marks "failed" (retryable), unchanged', () => {
    const failIdx = source.lastIndexOf("p_status: 'failed',");
    expect(failIdx).toBeGreaterThan(-1);
  });
});
