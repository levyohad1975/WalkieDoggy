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

  it('checks for a recorded sync conflict BEFORE attempting start_walk, and never calls it when one exists', async () => {
    mockedRepository.getConflictForWalk.mockResolvedValue({
      code: '23505',
      message: 'duplicate key value violates unique constraint',
      failedAt: '2026-01-01T00:00:00.000Z',
    });

    const started = await useScheduleStore.getState().startWalk('walk-x');
    expect(started).toBe(false);
    expect(mockedRepository.startWalk).not.toHaveBeenCalled();

    const { actionError } = useScheduleStore.getState();
    expect(actionError).toContain('לא נשמר בהצלחה בשרת');
    expect(actionError).toContain('code=23505');
    expect(actionError).toContain('duplicate key value violates unique constraint');
    expect(actionError).toContain('walkId=walk-x');
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
});
