import { useScheduleStore } from '../scheduleStore';
import { repository } from '../../data';
import type { Walk } from '../../types';

/**
 * Bug 3 regression (scheduleStore-level): markDone() must reflect only the
 * CURRENT resolved state of a walk's saveWalk write — never a stale,
 * historical conflict left over from an earlier, since-superseded attempt.
 * See syncQueue.test.ts's "a later successful saveWalk clears a stale
 * historical conflict" describe block for the queue-level fix this exercises
 * through the repository contract markDone() actually depends on.
 */
jest.mock('../../data', () => ({
  repository: {
    saveWalk: jest.fn(),
    getWalks: jest.fn(),
    hasPendingSaveWalk: jest.fn(),
    getConflictForWalk: jest.fn(),
    getNotificationSettings: jest.fn().mockResolvedValue([]),
  },
}));

const mockedRepository = repository as unknown as {
  saveWalk: jest.Mock;
  getWalks: jest.Mock;
  hasPendingSaveWalk: jest.Mock;
  getConflictForWalk: jest.Mock;
};

function fakeWalk(overrides: Partial<Walk> = {}): Walk {
  return {
    id: 'walk-x',
    familyId: 'family-main',
    dogId: 'dog-1',
    date: '2026-08-31',
    scheduledTime: '07:00',
    responsibleUserId: 'user-a',
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('scheduleStore.markDone — reflects only the CURRENT conflict/pending state (bug 3 fix)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useScheduleStore.setState({ walks: [fakeWalk()], actionError: null });
  });

  it('stays done and reports no error once the write has resolved with no conflict (the post-fix contract: a stale historical conflict is never returned once a later attempt succeeded)', async () => {
    mockedRepository.saveWalk.mockResolvedValue(undefined);
    mockedRepository.hasPendingSaveWalk.mockResolvedValue(false);
    mockedRepository.getConflictForWalk.mockResolvedValue(undefined);
    mockedRepository.getWalks.mockResolvedValue([
      fakeWalk({ status: 'done', completedByUserId: 'user-a', completedAt: new Date().toISOString() }),
    ]);

    const completed = await useScheduleStore.getState().markDone('walk-x', 'user-a');
    expect(completed).toBe(true);

    const state = useScheduleStore.getState();
    expect(state.actionError).toBeNull();
    expect(state.walks.find((w) => w.id === 'walk-x')?.status).toBe('done');
    expect(mockedRepository.getWalks).toHaveBeenCalledWith('family-main');
  });

  it('still correctly reverts + surfaces an error when getConflictForWalk reports a REAL, current conflict for this walk', async () => {
    mockedRepository.saveWalk.mockResolvedValue(undefined);
    mockedRepository.hasPendingSaveWalk.mockResolvedValue(false);
    mockedRepository.getConflictForWalk.mockResolvedValue({
      op: { type: 'saveWalk', payload: fakeWalk({ status: 'done' }) },
      code: '23505',
      message: 'duplicate',
      failedAt: new Date().toISOString(),
    });

    const completed = await useScheduleStore.getState().markDone('walk-x', 'user-a');
    expect(completed).toBe(false);

    const state = useScheduleStore.getState();
    expect(state.actionError).toBeTruthy();
    // Reverted back to the original (pre-markDone) walk, not left as 'done'.
    expect(state.walks.find((w) => w.id === 'walk-x')?.status).toBe('pending');
    expect(mockedRepository.getWalks).not.toHaveBeenCalled();
  });

  it('leaves the optimistic done state untouched while the write is still genuinely pending', async () => {
    mockedRepository.saveWalk.mockResolvedValue(undefined);
    mockedRepository.hasPendingSaveWalk.mockResolvedValue(true);

    const completed = await useScheduleStore.getState().markDone('walk-x', 'user-a');
    expect(completed).toBe(true);

    const state = useScheduleStore.getState();
    expect(state.actionError).toBeNull();
    expect(state.walks.find((w) => w.id === 'walk-x')?.status).toBe('done'); // optimistic, not reverted
    expect(mockedRepository.getConflictForWalk).not.toHaveBeenCalled();
    expect(mockedRepository.getWalks).not.toHaveBeenCalled();
  });
});
