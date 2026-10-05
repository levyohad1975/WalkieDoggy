import { useScheduleStore } from '../scheduleStore';
import { repository } from '../../data';
import type { Walk } from '../../types';

/**
 * P0 real-device fix — "Start" failed on a real iPhone PWA on an overdue,
 * perfectly normal-looking scheduled walk, always with only the generic
 * Hebrew "couldn't start the walk" message. Root-caused two independent,
 * real gaps (see errorMessages.ts's own doc comment and scheduleStore.ts's
 * startWalk for the full writeup):
 *
 * 1. start_walk()/finish_walk() (migrations/0048_walk_lifecycle.sql) had
 *    ZERO Hebrew error-message coverage at all — every one of their 6
 *    distinct raise-exception texts fell straight through to the generic
 *    fallback regardless of the real reason.
 * 2. loadScheduleForFamily's orphan-walk-repair calls
 *    queueWalksForBackgroundSync() without waiting for the server write to
 *    actually land; a PERMANENTLY rejected repair (e.g. a 23505
 *    unique-constraint hit) is silently dropped and recorded as a
 *    SyncConflict, never retried again — leaving a walk that exists only
 *    locally, which start_walk() can then only ever reject with an opaque
 *    "walk not found", forever. markDone() already had this exact check
 *    for the equivalent saveWalk case (see scheduleStore.markDoneConflict.
 *    test.ts); startWalk() now has the same check, proactively.
 *
 * ROUND 2 (real-device retest after the above): a `23505` conflict turned
 * out to be RECOVERABLE, not a dead end — it means a canonical row for
 * this schedule_entry_id already exists server-side under a different id.
 * OfflineFirstRepository.startWalk's resolveCanonicalWalkId (see its own
 * doc comment) now finds that row and reconciles before ever calling
 * start_walk, so this store-level check deliberately lets a `23505`
 * conflict THROUGH to repository.startWalk instead of hard-blocking it;
 * every other conflict code still blocks here as before (see
 * offlineFirstRepository.startWalkOrphanReconciliation.test.ts for the
 * repository-level reconciliation tests).
 */
jest.mock('../../data', () => ({
  repository: {
    startWalk: jest.fn(),
    getConflictForWalk: jest.fn(),
    getNotificationSettings: jest.fn().mockResolvedValue([]),
  },
}));

const mockedRepository = repository as unknown as {
  startWalk: jest.Mock;
  getConflictForWalk: jest.Mock;
};

function fakeWalk(overrides: Partial<Walk> = {}): Walk {
  return {
    id: 'walk-x',
    familyId: 'family-main',
    dogId: 'dog-1',
    date: '2000-01-01', // far in the past — never blocked by the 30-minute early-start gate
    scheduledTime: '07:00',
    responsibleUserId: 'user-a',
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('scheduleStore.startWalk — surfaces the real reason instead of a generic fallback', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    useScheduleStore.setState({ walks: [fakeWalk()], actionError: null });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('checks for a recorded sync conflict BEFORE attempting start_walk, and never calls it for an unrecoverable (non-23505) conflict', async () => {
    mockedRepository.getConflictForWalk.mockResolvedValue({
      code: '23503',
      message: 'insert or update on table "walks" violates foreign key constraint',
      failedAt: '2026-01-01T00:00:00.000Z',
    });

    const started = await useScheduleStore.getState().startWalk('walk-x');
    expect(started).toBe(false);
    expect(mockedRepository.startWalk).not.toHaveBeenCalled();

    const { actionError } = useScheduleStore.getState();
    expect(actionError).toContain('לא נשמר בהצלחה בשרת');
    expect(actionError).toContain('code=23503');
    expect(actionError).toContain('insert or update on table "walks" violates foreign key constraint');
    expect(actionError).toContain('walkId=walk-x');
  });

  it('lets a 23505 (unique_violation) conflict pass through to repository.startWalk, since its own canonical-id reconciliation resolves it — never a dead end', async () => {
    mockedRepository.getConflictForWalk.mockResolvedValue({
      code: '23505',
      message: 'duplicate key value violates unique constraint "walks_schedule_entry_id_key"',
      failedAt: '2026-01-01T00:00:00.000Z',
    });
    const inProgress = { ...fakeWalk({ id: 'walk-canonical' }), status: 'in_progress' as const, startedAt: new Date().toISOString() };
    mockedRepository.startWalk.mockResolvedValue(inProgress);

    const started = await useScheduleStore.getState().startWalk('walk-x');
    expect(mockedRepository.startWalk).toHaveBeenCalledWith('walk-x');
    expect(started).toBe(true);
    expect(useScheduleStore.getState().actionError).toBeNull();
  });

  it('proceeds to call start_walk normally when there is no recorded conflict', async () => {
    mockedRepository.getConflictForWalk.mockResolvedValue(undefined);
    const inProgress = { ...fakeWalk(), status: 'in_progress' as const, startedAt: new Date().toISOString() };
    mockedRepository.startWalk.mockResolvedValue(inProgress);

    const started = await useScheduleStore.getState().startWalk('walk-x');
    expect(started).toBe(true);
    expect(mockedRepository.startWalk).toHaveBeenCalledWith('walk-x');
    expect(useScheduleStore.getState().actionError).toBeNull();
  });

  it('shows the specific mapped Hebrew message (no raw debug noise) for a known start_walk rejection reason', async () => {
    mockedRepository.getConflictForWalk.mockResolvedValue(undefined);
    mockedRepository.startWalk.mockRejectedValue({ message: 'walk is not pending', code: 'P0001' });

    const started = await useScheduleStore.getState().startWalk('walk-x');
    expect(started).toBe(false);

    const { actionError } = useScheduleStore.getState();
    expect(actionError).toBe('הטיול הזה כבר אינו ממתין להתחלה (ייתכן שכבר התחיל, הסתיים או דולג). רעננו את המסך ונסו שוב.');
    expect(actionError).not.toContain('[DEBUG]');
  });

  it('appends the raw PostgREST code/message/details/hint when start_walk fails with an UNMAPPED reason', async () => {
    mockedRepository.getConflictForWalk.mockResolvedValue(undefined);
    mockedRepository.startWalk.mockRejectedValue({
      message: 'permission denied for table walks',
      code: '42501',
      details: 'some detail',
      hint: 'Grant the required privileges',
    });

    const started = await useScheduleStore.getState().startWalk('walk-x');
    expect(started).toBe(false);

    const { actionError } = useScheduleStore.getState();
    expect(actionError).toContain('לא הצלחנו להתחיל את הטיול');
    expect(actionError).toContain('[DEBUG]');
    expect(actionError).toContain('code=42501');
    expect(actionError).toContain('message=permission denied for table walks');
    expect(actionError).toContain('details=some detail');
    expect(actionError).toContain('hint=Grant the required privileges');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[startWalk] failed',
      expect.objectContaining({ walkId: 'walk-x', localStatus: 'pending', responsibleUserId: 'user-a' })
    );
  });

  it('the 30-minute early-start gate is unchanged by this fix — a walk scheduled more than 30 minutes in the future is still blocked, before any conflict check or RPC call', async () => {
    const farFuture = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours from now
    const yyyy = farFuture.getFullYear();
    const mm = String(farFuture.getMonth() + 1).padStart(2, '0');
    const dd = String(farFuture.getDate()).padStart(2, '0');
    const hh = String(farFuture.getHours()).padStart(2, '0');
    const min = String(farFuture.getMinutes()).padStart(2, '0');
    useScheduleStore.setState({
      walks: [fakeWalk({ date: `${yyyy}-${mm}-${dd}`, scheduledTime: `${hh}:${min}` })],
      actionError: null,
    });

    const started = await useScheduleStore.getState().startWalk('walk-x');
    expect(started).toBe(false);
    expect(mockedRepository.getConflictForWalk).not.toHaveBeenCalled();
    expect(mockedRepository.startWalk).not.toHaveBeenCalled();
    expect(useScheduleStore.getState().actionError).toContain('ניתן להתחיל את הטיול החל מ־');
  });
});
