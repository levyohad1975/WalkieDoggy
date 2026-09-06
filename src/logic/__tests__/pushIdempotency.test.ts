import { decideClaimOutcome, shouldSend, type ExistingPushEventRow } from '../pushIdempotency';

const NOW = new Date('2026-09-02T12:00:00Z');

describe('decideClaimOutcome', () => {
  it('claims when there is no prior row at all (first "created" attempt)', () => {
    expect(decideClaimOutcome(null, NOW)).toBe('claim');
  });

  it('refuses a duplicate once a prior send already completed (duplicate "created"/"approved"/"rejected" -> only one send)', () => {
    const sent: ExistingPushEventRow = { status: 'sent', updatedAt: NOW.toISOString() };
    expect(decideClaimOutcome(sent, NOW)).toBe('already_sent');
    expect(shouldSend(decideClaimOutcome(sent, NOW))).toBe(false);
  });

  it('refuses a duplicate while a prior attempt is still in flight and fresh', () => {
    const sending: ExistingPushEventRow = {
      status: 'sending',
      updatedAt: new Date(NOW.getTime() - 1000).toISOString(), // 1s old, well under the 30s staleness window
    };
    expect(decideClaimOutcome(sending, NOW)).toBe('already_sending');
    expect(shouldSend(decideClaimOutcome(sending, NOW))).toBe(false);
  });

  it('allows a retry once a failed send is retried (a failed send remains retryable)', () => {
    const failed: ExistingPushEventRow = { status: 'failed', updatedAt: NOW.toISOString() };
    const outcome = decideClaimOutcome(failed, NOW);
    expect(outcome).toBe('claim');
    expect(shouldSend(outcome)).toBe(true);
  });

  it('reclaims a "sending" row stuck by a crashed invocation once it is older than the staleness window', () => {
    const stuck: ExistingPushEventRow = {
      status: 'sending',
      updatedAt: new Date(NOW.getTime() - 31_000).toISOString(), // 31s old > 30s default window
    };
    const outcome = decideClaimOutcome(stuck, NOW);
    expect(outcome).toBe('reclaim_stale');
    expect(shouldSend(outcome)).toBe(true);
  });

  it('respects a custom staleness window', () => {
    const row: ExistingPushEventRow = { status: 'sending', updatedAt: new Date(NOW.getTime() - 5000).toISOString() };
    expect(decideClaimOutcome(row, NOW, 10_000)).toBe('already_sending'); // 5s < 10s window
    expect(decideClaimOutcome(row, NOW, 1000)).toBe('reclaim_stale'); // 5s > 1s window
  });
});

describe('shouldSend', () => {
  it('is true only for claim and reclaim_stale', () => {
    expect(shouldSend('claim')).toBe(true);
    expect(shouldSend('reclaim_stale')).toBe(true);
    expect(shouldSend('already_sent')).toBe(false);
    expect(shouldSend('already_sending')).toBe(false);
  });
});
