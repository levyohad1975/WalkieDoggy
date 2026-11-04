import { REMOTE_GPS_STALE_AFTER_MS, localClockLabel, remoteGpsFreshness } from '../remoteGpsFreshness';

describe('remoteGpsFreshness', () => {
  const now = new Date('2026-11-04T11:22:00Z');

  it('reports none without a session or points', () => {
    expect(remoteGpsFreshness(null, now)).toEqual({ kind: 'none' });
    expect(remoteGpsFreshness({ pointCount: 0, updatedAt: now.toISOString() }, now)).toEqual({ kind: 'none' });
  });

  it('is fresh while the walker device heartbeats, even with no new points', () => {
    const session = { pointCount: 9, updatedAt: '2026-11-04T11:14:15Z', liveUpdatedAt: '2026-11-04T11:21:50Z' };
    expect(remoteGpsFreshness(session, now)).toEqual({ kind: 'fresh' });
  });

  it('turns stale once the walker device goes quiet (field report 2026-11-04)', () => {
    const session = { pointCount: 9, updatedAt: '2026-11-04T11:14:15Z', liveUpdatedAt: '2026-11-04T11:15:02Z' };
    const result = remoteGpsFreshness(session, now);
    expect(result.kind).toBe('stale');
    expect(result.kind === 'stale' && result.lastUpdateAt.toISOString()).toBe('2026-11-04T11:15:02.000Z');
  });

  it('falls back to the session write time and stays fresh at the threshold', () => {
    const at = new Date(now.getTime() - REMOTE_GPS_STALE_AFTER_MS).toISOString();
    expect(remoteGpsFreshness({ pointCount: 3, updatedAt: at }, now)).toEqual({ kind: 'fresh' });
  });

  it('treats an unreadable timestamp as fresh rather than alarming the family', () => {
    expect(remoteGpsFreshness({ pointCount: 3, updatedAt: '' }, now)).toEqual({ kind: 'fresh' });
  });

  it('formats a local HH:MM label', () => {
    expect(localClockLabel(new Date(2026, 10, 4, 9, 5))).toBe('09:05');
  });
});
