import type { Walk, ScheduleEntry } from '../../types';

/**
 * BATCH 3 (Task 6 — direct admin time edit). Isolated from
 * scheduleStore.test.ts (which deliberately runs in local/demo mode) so
 * this file can freely mock Supabase-mode-only collaborators
 * (lib/supabase's isSupabaseConfigured, lib/walkAdmin's
 * adminRescheduleWalk) without disturbing that file's local-repository
 * assumptions or the demo seed data it relies on.
 *
 * CORRECTED (Batch 3 correction #3, post-review): the original version of
 * this file's first test asserted that repository.saveWalk() DID run after
 * a successful admin_reschedule_walk() RPC call ("rpc" then "local-save",
 * in that order) — the review correctly flagged that as a duplicate write:
 * admin_reschedule_walk (migration 0026) already updates BOTH
 * walks.scheduled_time and the linked schedule_entries.time server-side,
 * so a second raw repository.saveWalk()/updateScheduleEntry() call after it
 * succeeds was redundant at best and, on a partial failure of that SECOND
 * write, could make the UI report failure even though the authoritative
 * server-side change had already happened. This file now proves the
 * opposite: in Supabase mode, the RPC is the ONLY server mutation — no
 * repository.saveWalk()/updateScheduleEntry() call follows it at all — and
 * a separate describe block proves local/demo mode is completely
 * unaffected (repository.saveWalk()/updateScheduleEntry() remain the sole,
 * unchanged mutation there, since no RPC exists to defer to in that mode).
 * The RPC's own server-side authorization/collision-check/audit-logging
 * behavior is covered by migration 0026_admin_reschedule_walk.sql's own
 * doc comment and can only be verified against a real Supabase project.
 */

const WALK: Walk = {
  id: 'walk-1',
  familyId: 'family-1',
  scheduleEntryId: 'entry-1',
  dogId: 'dog-1',
  date: '2026-09-11',
  scheduledTime: '09:00',
  responsibleUserId: 'noam',
  status: 'pending',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const ENTRY: ScheduleEntry = {
  id: 'entry-1',
  familyId: 'family-1',
  ruleId: 'rule-1',
  dogId: 'dog-1',
  date: '2026-09-11',
  time: '09:00',
  responsibleUserId: 'noam',
  createdAt: new Date().toISOString(),
};

function mockNotificationCollaborators() {
  // Short-circuits scheduleNotificationsForWalk straight to
  // cancelWalkNotifications (see that function in scheduleStore.ts) so
  // these tests never need to also stand up familyStore/notification
  // settings — irrelevant to what this file is actually verifying.
  jest.doMock('../../lib/remoteReminderChannel', () => ({ hasActiveRemoteReminderChannel: jest.fn().mockResolvedValue(true) }));
  jest.doMock('../../notifications/notificationService', () => ({
    cancelWalkNotifications: jest.fn().mockResolvedValue(undefined),
    reconcileWalkNotifications: jest.fn().mockResolvedValue(undefined),
    scheduleWalkNotifications: jest.fn().mockResolvedValue(undefined),
  }));
}

describe('scheduleStore.rescheduleWalk — Supabase mode: the admin RPC is the SOLE server mutation (correction #3)', () => {
  let saveWalk: jest.Mock;
  let updateScheduleEntry: jest.Mock;
  let adminRescheduleWalk: jest.Mock;
  let useScheduleStore: typeof import('../scheduleStore').useScheduleStore;

  beforeEach(() => {
    jest.resetModules();

    saveWalk = jest.fn().mockResolvedValue(undefined);
    updateScheduleEntry = jest.fn().mockResolvedValue(undefined);
    adminRescheduleWalk = jest.fn().mockResolvedValue(undefined);

    jest.doMock('../../data', () => ({
      repository: {
        saveWalk,
        updateScheduleEntry,
      },
    }));
    jest.doMock('../../lib/supabase', () => ({ isSupabaseConfigured: true }));
    jest.doMock('../../lib/walkAdmin', () => ({ adminRescheduleWalk }));
    jest.doMock('../../lib/testModeGuard', () => ({ guardTestModeMutation: () => true }));
    mockNotificationCollaborators();

    ({ useScheduleStore } = require('../scheduleStore'));
    useScheduleStore.setState({ walks: [WALK], entries: [ENTRY], actionError: null });
  });

  it('calls admin_reschedule_walk exactly once, and does NOT subsequently call repository.saveWalk/updateScheduleEntry (no duplicate raw mutation)', async () => {
    await useScheduleStore.getState().rescheduleWalk('walk-1', '19:30');

    expect(adminRescheduleWalk).toHaveBeenCalledTimes(1);
    expect(adminRescheduleWalk).toHaveBeenCalledWith('walk-1', '19:30');
    expect(saveWalk).not.toHaveBeenCalled();
    expect(updateScheduleEntry).not.toHaveBeenCalled();
  });

  it('a successful RPC still results in the correct final local state (walks AND the linked schedule entry), synchronized locally rather than re-fetched via a second write', async () => {
    await useScheduleStore.getState().rescheduleWalk('walk-1', '19:30');

    expect(useScheduleStore.getState().walks.find((w) => w.id === 'walk-1')?.scheduledTime).toBe('19:30');
    expect(useScheduleStore.getState().entries.find((e) => e.id === 'entry-1')?.time).toBe('19:30');
    expect(useScheduleStore.getState().actionError).toBeNull();
  });

  it('a server-side rejection (e.g. time collision) surfaces as actionError and never touches local state (no optimistic update to the new time)', async () => {
    adminRescheduleWalk.mockRejectedValue(new Error('that time is already taken by another scheduled walk'));

    await useScheduleStore.getState().rescheduleWalk('walk-1', '19:30');

    expect(saveWalk).not.toHaveBeenCalled();
    expect(updateScheduleEntry).not.toHaveBeenCalled();
    expect(useScheduleStore.getState().walks.find((w) => w.id === 'walk-1')?.scheduledTime).toBe('09:00');
    expect(useScheduleStore.getState().entries.find((e) => e.id === 'entry-1')?.time).toBe('09:00');
    expect(useScheduleStore.getState().actionError).toBe('השעה המבוקשת כבר תפוסה על ידי טיול אחר.');
  });

  it('a non-admin/impersonation rejection ("admin permission required") surfaces as actionError and never touches local state', async () => {
    adminRescheduleWalk.mockRejectedValue(new Error('admin permission required'));

    await useScheduleStore.getState().rescheduleWalk('walk-1', '19:30');

    expect(saveWalk).not.toHaveBeenCalled();
    expect(useScheduleStore.getState().walks.find((w) => w.id === 'walk-1')?.scheduledTime).toBe('09:00');
    expect(useScheduleStore.getState().actionError).toBe('רק מנהל/ת יכולים לבצע פעולה זו.');
  });
});

describe('scheduleStore.rescheduleWalk — local/demo mode: unchanged from before correction #3', () => {
  let saveWalk: jest.Mock;
  let updateScheduleEntry: jest.Mock;
  let adminRescheduleWalk: jest.Mock;
  let useScheduleStore: typeof import('../scheduleStore').useScheduleStore;

  beforeEach(() => {
    jest.resetModules();

    saveWalk = jest.fn().mockResolvedValue(undefined);
    updateScheduleEntry = jest.fn().mockResolvedValue(undefined);
    // Present but must never be called in this mode — asserted below.
    adminRescheduleWalk = jest.fn().mockResolvedValue(undefined);

    jest.doMock('../../data', () => ({
      repository: {
        saveWalk,
        updateScheduleEntry,
      },
    }));
    jest.doMock('../../lib/supabase', () => ({ isSupabaseConfigured: false }));
    jest.doMock('../../lib/walkAdmin', () => ({ adminRescheduleWalk }));
    jest.doMock('../../lib/testModeGuard', () => ({ guardTestModeMutation: () => true }));
    mockNotificationCollaborators();

    ({ useScheduleStore } = require('../scheduleStore'));
    useScheduleStore.setState({ walks: [WALK], entries: [ENTRY], actionError: null });
  });

  it('performs the existing local repository mutation (saveWalk + updateScheduleEntry) — no RPC exists to defer to in this mode', async () => {
    await useScheduleStore.getState().rescheduleWalk('walk-1', '19:30');

    expect(adminRescheduleWalk).not.toHaveBeenCalled();
    expect(saveWalk).toHaveBeenCalledTimes(1);
    expect(saveWalk).toHaveBeenCalledWith(expect.objectContaining({ id: 'walk-1', scheduledTime: '19:30' }));
    expect(updateScheduleEntry).toHaveBeenCalledTimes(1);
    expect(updateScheduleEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 'entry-1', time: '19:30' }));
    expect(useScheduleStore.getState().walks.find((w) => w.id === 'walk-1')?.scheduledTime).toBe('19:30');
    expect(useScheduleStore.getState().actionError).toBeNull();
  });

  it('a local repository failure surfaces as actionError and never optimistically updates local state', async () => {
    saveWalk.mockRejectedValue(new Error('offline'));

    await useScheduleStore.getState().rescheduleWalk('walk-1', '19:30');

    expect(useScheduleStore.getState().walks.find((w) => w.id === 'walk-1')?.scheduledTime).toBe('09:00');
    // A plain Error with no matching friendlyErrorMessage() rule falls back
    // to that helper's own generic default — not the raw 'offline' text.
    expect(useScheduleStore.getState().actionError).toBe('משהו השתבש, נסו שוב');
  });
});
