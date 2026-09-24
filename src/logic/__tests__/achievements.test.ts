import {
  achievementDedupeKey,
  achievementDefinition,
  ACHIEVEMENT_CATALOG,
  computeFairSwapCount,
  computeFamilyAchievementProgress,
  computeOnTimeStreak,
  computePersonalAchievementProgress,
  detectNewlyUnlocked,
  preserveUnlockedAchievements,
  FAIR_SWAP_TARGET,
  FAMILY_HELPER_TARGET,
  LONG_WALK_MINUTES,
  ON_TIME_STREAK_TARGET,
  PERFECT_MONTH_MIN_RESOLVED,
} from '../achievements';
import type { Walk } from '../../types';
import type { SwapRequestRow } from '../../lib/requests';

function makeSwap(overrides: Partial<SwapRequestRow>): SwapRequestRow {
  return {
    id: 'swap-1',
    family_id: 'family-1',
    walk_id: 'w1',
    requested_by_user_id: 'noam',
    target_user_id: 'dana',
    target_walk_id: 'w2',
    status: 'approved',
    created_at: new Date().toISOString(),
    resolved_at: new Date().toISOString(),
    requester_seen_at: null,
    expected_responsible_user_id: 'noam',
    expected_scheduled_time: new Date().toISOString(),
    expected_target_responsible_user_id: 'dana',
    expected_target_scheduled_time: new Date().toISOString(),
    ...overrides,
  };
}

function makeWalk(overrides: Partial<Walk>): Walk {
  return {
    id: 'w',
    familyId: 'family-1',
    scheduleEntryId: 'e',
    dogId: 'dog-1',
    date: '2026-08-26',
    scheduledTime: '20:00',
    responsibleUserId: 'noam',
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const NOW = new Date('2026-08-26T18:00:00');

describe('ACHIEVEMENT_CATALOG', () => {
  it('has no duplicate keys', () => {
    const keys = ACHIEVEMENT_CATALOG.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('never includes a cross-member comparison/ranking achievement (PRD: family achievements over aggressive ranking)', () => {
    for (const a of ACHIEVEMENT_CATALOG) {
      expect(a.title).not.toMatch(/דירוג|תחרות/);
    }
  });

  it('achievementDefinition looks up by key and returns undefined for an unknown key', () => {
    expect(achievementDefinition('family_first_walk')?.title).toBe('הטיול הראשון');
    expect(achievementDefinition('nonexistent')).toBeUndefined();
  });
});

describe('achievementDedupeKey', () => {
  it('differs between a family-scope and a personal-scope entry with the same key text', () => {
    expect(achievementDedupeKey({ key: 'x' })).not.toBe(achievementDedupeKey({ key: 'x', userId: 'u1' }));
  });

  it('is stable for the same key+userId', () => {
    expect(achievementDedupeKey({ key: 'x', userId: 'u1' })).toBe(achievementDedupeKey({ key: 'x', userId: 'u1' }));
  });
});

describe('preserveUnlockedAchievements', () => {
  it('keeps an immutable ledger unlock visible even when a deleted walk lowers current progress', () => {
    const progress = computeFamilyAchievementProgress([], NOW);
    const preserved = preserveUnlockedAchievements(progress, [
      { id: 'unlock-1', familyId: 'family-1', achievementKey: 'family_first_walk', scope: 'family', unlockedAt: 'x', createdAt: 'x' },
    ]);
    expect(preserved.find((item) => item.key === 'family_first_walk')).toMatchObject({ current: 0, target: 1, unlocked: true });
  });

  it('does not apply another member\'s personal unlock to this member\'s progress', () => {
    const progress = computePersonalAchievementProgress([], 'noam');
    const preserved = preserveUnlockedAchievements(progress, [
      { id: 'unlock-2', familyId: 'family-1', achievementKey: 'personal_first_walk', scope: 'personal', userId: 'dana', unlockedAt: 'x', createdAt: 'x' },
    ]);
    expect(preserved.find((item) => item.key === 'personal_first_walk')?.unlocked).toBe(false);
  });
});

describe('computeFamilyAchievementProgress', () => {
  it('family_first_walk unlocks at exactly 1 completed walk', () => {
    const none = computeFamilyAchievementProgress([], NOW);
    expect(none.find((p) => p.key === 'family_first_walk')).toEqual({ key: 'family_first_walk', scope: 'family', unlocked: false, current: 0, target: 1 });

    const one = computeFamilyAchievementProgress([makeWalk({ status: 'done' })], NOW);
    expect(one.find((p) => p.key === 'family_first_walk')?.unlocked).toBe(true);
  });

  it('walks_10/25/50 track total done count, each capped at its own target, unlocked only once reached', () => {
    const walks = Array.from({ length: 12 }, (_, i) => makeWalk({ id: `w${i}`, status: 'done' }));
    const progress = computeFamilyAchievementProgress(walks, NOW);
    expect(progress.find((p) => p.key === 'family_walks_10')).toEqual({ key: 'family_walks_10', scope: 'family', unlocked: true, current: 10, target: 10 });
    expect(progress.find((p) => p.key === 'family_walks_25')).toEqual({ key: 'family_walks_25', scope: 'family', unlocked: false, current: 12, target: 25 });
    expect(progress.find((p) => p.key === 'family_walks_50')).toEqual({ key: 'family_walks_50', scope: 'family', unlocked: false, current: 12, target: 50 });
  });

  it('only counts DONE walks toward milestones, never pending/skipped', () => {
    const walks = [makeWalk({ status: 'done' }), makeWalk({ status: 'pending' }), makeWalk({ status: 'skipped' })];
    const progress = computeFamilyAchievementProgress(walks, NOW);
    expect(progress.find((p) => p.key === 'family_first_walk')?.current).toBe(1);
  });

  it('family_perfect_month unlocks when every resolved walk in the last 30 days is done, with the minimum sample met', () => {
    const walks = Array.from({ length: PERFECT_MONTH_MIN_RESOLVED }, (_, i) =>
      makeWalk({ id: `w${i}`, status: 'done', date: '2026-08-20' })
    );
    const progress = computeFamilyAchievementProgress(walks, NOW);
    expect(progress.find((p) => p.key === 'family_perfect_month')?.unlocked).toBe(true);
  });

  it('family_perfect_month does NOT unlock below the minimum sample, even with a 100% done rate', () => {
    const walks = [makeWalk({ status: 'done', date: '2026-08-20' }), makeWalk({ id: 'w2', status: 'done', date: '2026-08-21' })];
    const progress = computeFamilyAchievementProgress(walks, NOW);
    expect(progress.find((p) => p.key === 'family_perfect_month')?.unlocked).toBe(false);
  });

  it('family_perfect_month does NOT unlock if even one recent walk was skipped', () => {
    const walks = [
      ...Array.from({ length: PERFECT_MONTH_MIN_RESOLVED - 1 }, (_, i) => makeWalk({ id: `w${i}`, status: 'done', date: '2026-08-20' })),
      makeWalk({ id: 'skipped-one', status: 'skipped', date: '2026-08-21' }),
    ];
    const progress = computeFamilyAchievementProgress(walks, NOW);
    expect(progress.find((p) => p.key === 'family_perfect_month')?.unlocked).toBe(false);
  });

  it('family_perfect_month only looks at the last 30 days — an old skip outside the window does not block it', () => {
    const walks = [
      ...Array.from({ length: PERFECT_MONTH_MIN_RESOLVED }, (_, i) => makeWalk({ id: `w${i}`, status: 'done', date: '2026-08-20' })),
      makeWalk({ id: 'old-skip', status: 'skipped', date: '2026-01-01' }),
    ];
    const progress = computeFamilyAchievementProgress(walks, NOW);
    expect(progress.find((p) => p.key === 'family_perfect_month')?.unlocked).toBe(true);
  });
});

describe('computeOnTimeStreak', () => {
  it('is 0 when the user has no completed walks', () => {
    expect(computeOnTimeStreak([], 'noam')).toBe(0);
  });

  it('counts consecutive on-time completions, most-recent-first, stopping at the first late one', () => {
    const onTime = (id: string, date: string) =>
      makeWalk({ id, status: 'done', date, scheduledTime: '20:00', completedByUserId: 'noam', completedAt: new Date(`${date}T20:00:00`).toISOString() });
    const late = (id: string, date: string) =>
      makeWalk({ id, status: 'done', date, scheduledTime: '20:00', completedByUserId: 'noam', completedAt: new Date(`${date}T21:00:00`).toISOString() });

    const walks = [onTime('w1', '2026-08-20'), late('w2', '2026-08-21'), onTime('w3', '2026-08-22'), onTime('w4', '2026-08-23')];
    // Most recent (w4, w3) are on time; w2 (next back) is late -> streak stops there.
    expect(computeOnTimeStreak(walks, 'noam')).toBe(2);
  });

  it('excludes unplanned walks (no real "on time" to measure) without breaking the streak', () => {
    const onTime = (id: string, date: string) =>
      makeWalk({ id, status: 'done', date, scheduledTime: '20:00', completedByUserId: 'noam', completedAt: new Date(`${date}T20:00:00`).toISOString() });
    const walks = [
      onTime('w1', '2026-08-20'),
      makeWalk({ id: 'w2', status: 'done', date: '2026-08-21', isUnplanned: true, completedByUserId: 'noam', completedAt: new Date('2026-08-21T23:59:00').toISOString() }),
      onTime('w3', '2026-08-22'),
    ];
    expect(computeOnTimeStreak(walks, 'noam')).toBe(2);
  });

  it('only counts walks completed by the given user, not the whole family', () => {
    const walks = [makeWalk({ status: 'done', completedByUserId: 'someone-else', completedAt: new Date('2026-08-26T20:00:00').toISOString(), scheduledTime: '20:00' })];
    expect(computeOnTimeStreak(walks, 'noam')).toBe(0);
  });
});

describe('computePersonalAchievementProgress', () => {
  it('personal_first_walk unlocks once this user has completed any walk', () => {
    const progress = computePersonalAchievementProgress([makeWalk({ status: 'done', completedByUserId: 'noam' })], 'noam');
    expect(progress.find((p) => p.key === 'personal_first_walk')?.unlocked).toBe(true);
  });

  it('personal_long_walk unlocks only once this user completes a walk >= LONG_WALK_MINUTES', () => {
    const short = computePersonalAchievementProgress([makeWalk({ status: 'done', completedByUserId: 'noam', durationMinutes: 20 })], 'noam');
    expect(short.find((p) => p.key === 'personal_long_walk')?.unlocked).toBe(false);

    const long = computePersonalAchievementProgress([makeWalk({ status: 'done', completedByUserId: 'noam', durationMinutes: LONG_WALK_MINUTES })], 'noam');
    expect(long.find((p) => p.key === 'personal_long_walk')?.unlocked).toBe(true);
  });

  it('personal_family_helper counts only walks this user completed that were originally someone else\'s responsibility', () => {
    const walks = [
      makeWalk({ id: '1', status: 'done', completedByUserId: 'noam', responsibleUserId: 'dana' }),
      makeWalk({ id: '2', status: 'done', completedByUserId: 'noam', responsibleUserId: 'dana' }),
      makeWalk({ id: '3', status: 'done', completedByUserId: 'noam', responsibleUserId: 'noam' }), // own turn — doesn't count
    ];
    const progress = computePersonalAchievementProgress(walks, 'noam');
    const helper = progress.find((p) => p.key === 'personal_family_helper');
    expect(helper?.current).toBe(2);
    expect(helper?.unlocked).toBe(false); // target is FAMILY_HELPER_TARGET (3)

    const withThird = [...walks, makeWalk({ id: '4', status: 'done', completedByUserId: 'noam', responsibleUserId: 'dana' })];
    expect(computePersonalAchievementProgress(withThird, 'noam').find((p) => p.key === 'personal_family_helper')?.unlocked).toBe(true);
  });

  it('personal_on_time_streak unlocks at ON_TIME_STREAK_TARGET consecutive on-time completions', () => {
    const walks = Array.from({ length: ON_TIME_STREAK_TARGET }, (_, i) =>
      makeWalk({
        id: `w${i}`,
        status: 'done',
        date: `2026-08-${20 + i}`,
        scheduledTime: '20:00',
        completedByUserId: 'noam',
        completedAt: new Date(`2026-08-${20 + i}T20:00:00`).toISOString(),
      })
    );
    const progress = computePersonalAchievementProgress(walks, 'noam');
    expect(progress.find((p) => p.key === 'personal_on_time_streak')?.unlocked).toBe(true);
  });

  it('every entry carries the given userId (never another member\'s)', () => {
    const progress = computePersonalAchievementProgress([], 'noam');
    expect(progress.every((p) => p.userId === 'noam')).toBe(true);
  });

  it('personal_fair_swap defaults to 0/target when swapRequests is omitted (e.g. local/demo mode)', () => {
    const progress = computePersonalAchievementProgress([], 'noam');
    expect(progress.find((p) => p.key === 'personal_fair_swap')).toEqual({
      key: 'personal_fair_swap', scope: 'personal', userId: 'noam', unlocked: false, current: 0, target: FAIR_SWAP_TARGET,
    });
  });

  it('personal_fair_swap unlocks at FAIR_SWAP_TARGET approved swaps involving this user', () => {
    const swaps = Array.from({ length: FAIR_SWAP_TARGET }, (_, i) => makeSwap({ id: `s${i}`, requested_by_user_id: 'noam' }));
    const progress = computePersonalAchievementProgress([], 'noam', swaps);
    expect(progress.find((p) => p.key === 'personal_fair_swap')?.unlocked).toBe(true);
  });
});

describe('computeFairSwapCount', () => {
  it('counts approved swaps where the user is EITHER side (requester or target)', () => {
    const swaps = [
      makeSwap({ id: '1', status: 'approved', requested_by_user_id: 'noam', target_user_id: 'dana' }),
      makeSwap({ id: '2', status: 'approved', requested_by_user_id: 'dana', target_user_id: 'noam' }),
      makeSwap({ id: '3', status: 'approved', requested_by_user_id: 'other', target_user_id: 'someone' }),
    ];
    expect(computeFairSwapCount(swaps, 'noam')).toBe(2);
  });

  it('never counts a pending or rejected swap, even if this user is a party to it', () => {
    const swaps = [
      makeSwap({ id: '1', status: 'pending', requested_by_user_id: 'noam' }),
      makeSwap({ id: '2', status: 'rejected', requested_by_user_id: 'noam' }),
    ];
    expect(computeFairSwapCount(swaps, 'noam')).toBe(0);
  });

  it('is 0 for an empty list', () => {
    expect(computeFairSwapCount([], 'noam')).toBe(0);
  });
});

describe('detectNewlyUnlocked', () => {
  it('returns only unlocked entries not already in the given set', () => {
    const progress = [
      { key: 'a', scope: 'family' as const, unlocked: true, current: 1, target: 1 },
      { key: 'b', scope: 'family' as const, unlocked: false, current: 0, target: 1 },
      { key: 'c', scope: 'family' as const, unlocked: true, current: 1, target: 1 },
    ];
    const result = detectNewlyUnlocked(progress, new Set([achievementDedupeKey({ key: 'a' })]));
    expect(result.map((p) => p.key)).toEqual(['c']);
  });

  it('returns [] when nothing new crossed its threshold', () => {
    const progress = [{ key: 'a', scope: 'family' as const, unlocked: true, current: 1, target: 1 }];
    expect(detectNewlyUnlocked(progress, new Set([achievementDedupeKey({ key: 'a' })]))).toEqual([]);
  });

  it('distinguishes personal-scope entries by userId — one member\'s unlock never suppresses another\'s', () => {
    const progress = [
      { key: 'x', scope: 'personal' as const, userId: 'noam', unlocked: true, current: 1, target: 1 },
      { key: 'x', scope: 'personal' as const, userId: 'dana', unlocked: true, current: 1, target: 1 },
    ];
    const result = detectNewlyUnlocked(progress, new Set([achievementDedupeKey({ key: 'x', userId: 'noam' })]));
    expect(result).toEqual([{ key: 'x', scope: 'personal', userId: 'dana', unlocked: true, current: 1, target: 1 }]);
  });
});
