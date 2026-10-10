import {
  publishRequestOpen,
  subscribeToRequestOpens,
  requestOpenFromNotificationData,
  __resetRequestEntryForTests,
} from '../requestEntry';

/**
 * Mascot-notification-experiences round — the swap/time-change counterpart
 * to reminderEntry.test.ts. requestOpenFromNotificationData() must match
 * the exact payload supabase/functions/send-request-push/index.ts sends:
 * `{ type: 'request', requestId, kind: 'swap' | 'timeChange', event:
 * 'created' | 'approved' | 'rejected' }`.
 */
describe('request notification entry', () => {
  beforeEach(() => {
    __resetRequestEntryForTests();
  });

  describe('requestOpenFromNotificationData (payload parsing)', () => {
    it.each(['swap', 'timeChange'] as const)('accepts a genuine %s request payload for every event', (kind) => {
      for (const event of ['created', 'approved', 'rejected'] as const) {
        expect(requestOpenFromNotificationData({ type: 'request', requestId: 'req-1', kind, event })).toEqual({
          requestId: 'req-1',
          kind,
          event,
        });
      }
    });

    it('rejects a walk-reminder payload (the OTHER real payload shape)', () => {
      expect(
        requestOpenFromNotificationData({ type: 'walkReminder', requestId: 'req-1', kind: 'swap', event: 'approved' })
      ).toBeNull();
    });

    it('rejects a missing/wrong type, missing requestId, or an unrecognized kind/event', () => {
      expect(requestOpenFromNotificationData({ requestId: 'req-1', kind: 'swap', event: 'approved' })).toBeNull();
      expect(requestOpenFromNotificationData({ type: 'request', kind: 'swap', event: 'approved' })).toBeNull();
      expect(requestOpenFromNotificationData({ type: 'request', requestId: 'req-1', kind: 'other', event: 'approved' })).toBeNull();
      expect(requestOpenFromNotificationData({ type: 'request', requestId: 'req-1', kind: 'swap', event: 'other' })).toBeNull();
      expect(requestOpenFromNotificationData(null)).toBeNull();
      expect(requestOpenFromNotificationData('not an object')).toBeNull();
    });
  });

  describe('publishRequestOpen / subscribeToRequestOpens', () => {
    it('delivers a published event to an already-subscribed listener', () => {
      const received: unknown[] = [];
      const unsubscribe = subscribeToRequestOpens((event) => received.push(event));

      publishRequestOpen({ requestId: 'req-1', kind: 'swap', event: 'approved' });

      expect(received).toEqual([{ requestId: 'req-1', kind: 'swap', event: 'approved' }]);
      unsubscribe();
    });

    it('replays the last published event to a LATE subscriber — the cold-launch case, where the publish happens before HomeScreen has mounted its listener', () => {
      publishRequestOpen({ requestId: 'req-2', kind: 'timeChange', event: 'approved' });

      const received: unknown[] = [];
      subscribeToRequestOpens((event) => received.push(event));

      expect(received).toEqual([{ requestId: 'req-2', kind: 'timeChange', event: 'approved' }]);
    });

    it('a duplicate publish of the exact same event within the dedupe window is dropped, never delivered twice', () => {
      const received: unknown[] = [];
      const unsubscribe = subscribeToRequestOpens((event) => received.push(event));

      publishRequestOpen({ requestId: 'req-3', kind: 'swap', event: 'approved' });
      publishRequestOpen({ requestId: 'req-3', kind: 'swap', event: 'approved' });

      expect(received).toHaveLength(1);
      unsubscribe();
    });

    it('a different requestId or event is never suppressed as a duplicate of an unrelated one', () => {
      const received: unknown[] = [];
      const unsubscribe = subscribeToRequestOpens((event) => received.push(event));

      publishRequestOpen({ requestId: 'req-4', kind: 'swap', event: 'approved' });
      publishRequestOpen({ requestId: 'req-5', kind: 'swap', event: 'approved' });

      expect(received).toHaveLength(2);
      unsubscribe();
    });
  });
});
