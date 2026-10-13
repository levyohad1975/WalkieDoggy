import { Platform } from 'react-native';
import { consumeInitialWebNotificationParam, subscribeToWebNotificationClicks } from '../webNotificationEntry';
import { subscribeToReminderOpens, __resetReminderEntryForTests } from '../../notifications/reminderEntry';
import { subscribeToRequestOpens, __resetRequestEntryForTests } from '../../notifications/requestEntry';

const originalPlatformOS = Platform.OS;

function setPlatformOS(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
}

function setWindowLocation(search: string) {
  const historyState: { search: string } = { search };
  (global as any).window = {
    location: { href: `https://staging.walkielink.co.il/${search}`, search, pathname: '/', hash: '' },
    history: {
      replaceState: jest.fn((_state: unknown, _title: string, url: string) => {
        const [, query] = url.split('?');
        historyState.search = query ? `?${query}` : '';
      }),
    },
  };
  return historyState;
}

function clearBrowserGlobals() {
  delete (global as any).window;
  delete (global as any).navigator;
}

/**
 * Mascot-notification-experiences round — the web (PWA) counterpart to
 * native's notification-response listener. Both entry points funnel into
 * the exact same publishReminderOpen()/publishRequestOpen() channels a
 * native notification tap already uses, observed here the same way
 * reminderEntry.test.ts/requestEntry.test.ts observe them.
 */
describe('lib/webNotificationEntry', () => {
  beforeEach(() => {
    __resetReminderEntryForTests();
    __resetRequestEntryForTests();
  });

  afterEach(() => {
    setPlatformOS(originalPlatformOS);
    clearBrowserGlobals();
  });

  describe('consumeInitialWebNotificationParam (cold-launch URL param)', () => {
    it('is a no-op on native platforms, even with a window somehow present', () => {
      setPlatformOS('ios');
      setWindowLocation('?notif=' + encodeURIComponent(JSON.stringify({ type: 'walkReminder', walkId: 'w1', stage: 'T-15' })));
      const received: unknown[] = [];
      subscribeToReminderOpens((e) => received.push(e));

      consumeInitialWebNotificationParam();

      expect(received).toEqual([]);
    });

    it('parses a valid walk-reminder `notif` param and publishes a reminder-open event', () => {
      setPlatformOS('web');
      setWindowLocation('?notif=' + encodeURIComponent(JSON.stringify({ type: 'walkReminder', walkId: 'w1', stage: 'T-15' })));
      const received: unknown[] = [];
      subscribeToReminderOpens((e) => received.push(e));

      consumeInitialWebNotificationParam();

      expect(received).toEqual([{ walkId: 'w1', kind: 'T-15' }]);
    });

    it('parses a valid request `notif` param and publishes a request-open event', () => {
      setPlatformOS('web');
      setWindowLocation('?notif=' + encodeURIComponent(JSON.stringify({ type: 'request', requestId: 'r1', kind: 'swap', event: 'approved' })));
      const received: unknown[] = [];
      subscribeToRequestOpens((e) => received.push(e));

      consumeInitialWebNotificationParam();

      expect(received).toEqual([{ requestId: 'r1', kind: 'swap', event: 'approved' }]);
    });

    it('removes the `notif` param from the URL after consuming it, so a later refresh never replays it', () => {
      setPlatformOS('web');
      const locationState = setWindowLocation(
        '?notif=' + encodeURIComponent(JSON.stringify({ type: 'walkReminder', walkId: 'w1', stage: 'T' })) + '&other=1'
      );

      consumeInitialWebNotificationParam();

      expect((global as any).window.history.replaceState).toHaveBeenCalled();
      expect(locationState.search).not.toContain('notif=');
      expect(locationState.search).toContain('other=1');
    });

    it('does nothing when no `notif` param is present', () => {
      setPlatformOS('web');
      setWindowLocation('');
      const received: unknown[] = [];
      subscribeToReminderOpens((e) => received.push(e));
      subscribeToRequestOpens((e) => received.push(e));

      expect(() => consumeInitialWebNotificationParam()).not.toThrow();
      expect(received).toEqual([]);
    });

    it('a malformed `notif` param (not valid JSON) is ignored, never throws, and still cleans up the URL', () => {
      setPlatformOS('web');
      const locationState = setWindowLocation('?notif=not-json%7B');

      expect(() => consumeInitialWebNotificationParam()).not.toThrow();
      expect(locationState.search).not.toContain('notif=');
    });

    it('a well-formed but unrecognized payload (neither reminder nor request shape) publishes nothing', () => {
      setPlatformOS('web');
      setWindowLocation('?notif=' + encodeURIComponent(JSON.stringify({ type: 'somethingElse' })));
      const received: unknown[] = [];
      subscribeToReminderOpens((e) => received.push(e));
      subscribeToRequestOpens((e) => received.push(e));

      consumeInitialWebNotificationParam();

      expect(received).toEqual([]);
    });
  });

  describe('subscribeToWebNotificationClicks (app already open/backgrounded)', () => {
    function setServiceWorker() {
      const listeners: Record<string, (event: unknown) => void> = {};
      const serviceWorker = {
        addEventListener: jest.fn((type: string, handler: (event: unknown) => void) => {
          listeners[type] = handler;
        }),
        removeEventListener: jest.fn(),
      };
      (global as any).navigator = { serviceWorker };
      return { serviceWorker, listeners };
    }

    it('is a no-op on native platforms and returns a safe unsubscribe function', () => {
      setPlatformOS('ios');
      const unsubscribe = subscribeToWebNotificationClicks();
      expect(() => unsubscribe()).not.toThrow();
    });

    it('is a no-op when navigator.serviceWorker is unavailable', () => {
      setPlatformOS('web');
      delete (global as any).navigator;
      const unsubscribe = subscribeToWebNotificationClicks();
      expect(() => unsubscribe()).not.toThrow();
    });

    it('dispatches a service-worker postMessage carrying a reminder payload to publishReminderOpen', () => {
      setPlatformOS('web');
      const { listeners } = setServiceWorker();
      const received: unknown[] = [];
      subscribeToReminderOpens((e) => received.push(e));
      subscribeToWebNotificationClicks();

      listeners['message']({ data: { source: 'walkie-notification-click', data: { type: 'walkReminder', walkId: 'w2', stage: 'T+15' } } });

      expect(received).toEqual([{ walkId: 'w2', kind: 'T+15' }]);
    });

    it('dispatches a service-worker postMessage carrying a request payload to publishRequestOpen', () => {
      setPlatformOS('web');
      const { listeners } = setServiceWorker();
      const received: unknown[] = [];
      subscribeToRequestOpens((e) => received.push(e));
      subscribeToWebNotificationClicks();

      listeners['message']({ data: { source: 'walkie-notification-click', data: { type: 'request', requestId: 'r2', kind: 'timeChange', event: 'approved' } } });

      expect(received).toEqual([{ requestId: 'r2', kind: 'timeChange', event: 'approved' }]);
    });

    it('ignores a message whose `source` is not the expected marker — never reacts to an unrelated postMessage', () => {
      setPlatformOS('web');
      const { listeners } = setServiceWorker();
      const received: unknown[] = [];
      subscribeToReminderOpens((e) => received.push(e));
      subscribeToWebNotificationClicks();

      listeners['message']({ data: { source: 'some-other-origin', data: { type: 'walkReminder', walkId: 'w3', stage: 'T' } } });

      expect(received).toEqual([]);
    });

    it('the returned unsubscribe function removes the underlying listener', () => {
      setPlatformOS('web');
      const { serviceWorker } = setServiceWorker();
      const unsubscribe = subscribeToWebNotificationClicks();

      unsubscribe();

      expect(serviceWorker.removeEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    });
  });
});
