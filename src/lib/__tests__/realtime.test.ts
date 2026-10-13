const ORIGINAL_ENV = process.env;

/**
 * Same client-call-shape-only scope/rationale as supabaseFamily.test.ts:
 * verifies subscribeToFamilyChanges() wires up the right channel/table/event
 * filters and debounces onChange, not the server-side Realtime delivery
 * itself (that needs a real Supabase project with the publication configured
 * — see 0017_realtime_publication.sql).
 */
function mockConfiguredSupabase() {
  const onMock = jest.fn();
  const subscribeMock = jest.fn();
  const channel = { on: onMock, subscribe: subscribeMock };
  const channelMock = jest.fn(() => channel);
  const removeChannelMock = jest.fn().mockResolvedValue(undefined);

  jest.doMock('@supabase/supabase-js', () => ({
    createClient: jest.fn(() => ({
      auth: {
        getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
        signInAnonymously: jest.fn().mockResolvedValue({ error: null }),
      },
      rpc: jest.fn(),
      from: jest.fn(),
      storage: { from: jest.fn() },
      channel: channelMock,
      removeChannel: removeChannelMock,
    })),
  }));

  return { channel, channelMock, onMock, subscribeMock, removeChannelMock };
}

describe('lib/realtime — subscribeToFamilyChanges', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env = ORIGINAL_ENV;
  });

  it('no-ops and returns a no-op unsubscribe when Supabase is not configured', () => {
    process.env = { ...ORIGINAL_ENV, EXPO_PUBLIC_SUPABASE_URL: '', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '' };
    const { channelMock } = mockConfiguredSupabase();
    const { subscribeToFamilyChanges } = require('../realtime');

    const onChange = jest.fn();
    const unsubscribe = subscribeToFamilyChanges('family-1', onChange);
    unsubscribe();

    expect(channelMock).not.toHaveBeenCalled();
  });

  it('subscribes to every watched table with the family filter and calls subscribe()', () => {
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
    };
    const { channelMock, onMock, subscribeMock } = mockConfiguredSupabase();
    const { subscribeToFamilyChanges } = require('../realtime');

    subscribeToFamilyChanges('family-1', jest.fn());

    expect(channelMock).toHaveBeenCalledWith('family-changes:family-1');
    expect(subscribeMock).toHaveBeenCalledTimes(1);
    const tables = onMock.mock.calls.map((call) => call[1].table);
    expect(tables).toEqual([
      'users',
      'dogs',
      'schedule_rules',
      'schedule_entries',
      'walks',
      'walk_swap_requests',
      'time_change_requests',
    ]);
    for (const call of onMock.mock.calls) {
      expect(call[0]).toBe('postgres_changes');
      expect(call[1]).toMatchObject({ event: '*', schema: 'public', filter: 'family_id=eq.family-1' });
      expect(typeof call[2]).toBe('function');
    }
  });

  it('debounces onChange: rapid row changes within 500ms collapse into a single call', () => {
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
    };
    const { onMock } = mockConfiguredSupabase();
    const { subscribeToFamilyChanges } = require('../realtime');

    const onChange = jest.fn();
    subscribeToFamilyChanges('family-1', onChange);
    const handler = onMock.mock.calls[0][2];

    handler();
    jest.advanceTimersByTime(200);
    handler();
    jest.advanceTimersByTime(499);
    expect(onChange).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe clears a pending debounce timer and removes the channel', () => {
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
    };
    const { channel, onMock, removeChannelMock } = mockConfiguredSupabase();
    const { subscribeToFamilyChanges } = require('../realtime');

    const onChange = jest.fn();
    const unsubscribe = subscribeToFamilyChanges('family-1', onChange);
    const handler = onMock.mock.calls[0][2];

    handler();
    unsubscribe();
    jest.advanceTimersByTime(1000);

    expect(onChange).not.toHaveBeenCalled();
    expect(removeChannelMock).toHaveBeenCalledWith(channel);
  });

  it('unsubscribe is a no-op for the timer/channel if never triggered and subscribe() throws', () => {
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
    };
    const { subscribeMock, removeChannelMock } = mockConfiguredSupabase();
    subscribeMock.mockImplementation(() => {
      throw new Error('Realtime not enabled on this project');
    });
    const { subscribeToFamilyChanges } = require('../realtime');

    const unsubscribe = subscribeToFamilyChanges('family-1', jest.fn());

    expect(() => unsubscribe()).not.toThrow();
    expect(removeChannelMock).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe skips removeChannel() when the channel itself was never created', () => {
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
    };
    const { channelMock, removeChannelMock } = mockConfiguredSupabase();
    channelMock.mockImplementation(() => {
      throw new Error('Realtime not enabled on this project');
    });
    const { subscribeToFamilyChanges } = require('../realtime');

    const unsubscribe = subscribeToFamilyChanges('family-1', jest.fn());

    expect(() => unsubscribe()).not.toThrow();
    expect(removeChannelMock).not.toHaveBeenCalled();
  });

  it('swallows a rejected removeChannel() promise', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon-key',
    };
    const { removeChannelMock } = mockConfiguredSupabase();
    removeChannelMock.mockRejectedValue(new Error('network error'));
    const { subscribeToFamilyChanges } = require('../realtime');

    const unsubscribe = subscribeToFamilyChanges('family-1', jest.fn());
    expect(() => unsubscribe()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });
});
