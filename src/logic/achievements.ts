import type { AchievementScope, AchievementUnlock, Walk } from '../types';
import type { SwapRequestRow } from '../lib/requests';
import { filterWalksByPeriod, wasCompletedOnTime } from './statistics';
import { walkDateTime } from './nextWalk';

/**
 * PRD §9 gamification ("גביעים ועידוד משפחתי") — the catalog mirrors the
 * PRD's own example list (first walk, 10/25/50 walks, "תמיד בזמן", "עוזר
 * משפחתי", "טיול ארוך", "חודש מושלם", "החלפה הוגנת") rather than inventing
 * new achievement ideas. Every walk-based entry is derivable purely from
 * existing Walk data already used by Statistics; "החלפה הוגנת" (fair swap)
 * additionally draws on requestsStore's swap-request data (migration
 * 0005) — no new tracked state beyond the immutable unlock ledger itself
 * (0052) either way.
 *
 * Family achievements are preferred over kid-vs-kid ranking (PRD's own
 * framing) — this catalog has no cross-member comparison/leaderboard
 * achievement at all, only individual progress toward a personal goal and
 * shared family milestones.
 */
export interface AchievementDefinition {
  key: string;
  scope: AchievementScope;
  title: string;
  description: string;
  icon: string;
  /** A CELEBRATION_LIBRARY id (logic/walkCompletionCelebration.ts) reused for the unlock celebration — no second asset/copy set to maintain. */
  celebrationId: string;
}

export const ON_TIME_STREAK_TARGET = 5;
export const FAMILY_HELPER_TARGET = 3;
export const PERFECT_MONTH_MIN_RESOLVED = 10;
export const LONG_WALK_MINUTES = 45;
export const FAMILY_WALK_MILESTONES = [10, 25, 50] as const;
export const FAIR_SWAP_TARGET = 3;

export const ACHIEVEMENT_CATALOG: AchievementDefinition[] = [
  { key: 'family_first_walk', scope: 'family', title: 'הטיול הראשון', description: 'השלמתם את הטיול הראשון של המשפחה!', icon: '🐾', celebrationId: 'trophy-teaser' },
  { key: 'family_walks_10', scope: 'family', title: '10 טיולים', description: '10 טיולים משפחתיים הושלמו.', icon: '🏆', celebrationId: 'trophy-teaser' },
  { key: 'family_walks_25', scope: 'family', title: '25 טיולים', description: '25 טיולים משפחתיים הושלמו.', icon: '🏆', celebrationId: 'trophy-teaser' },
  { key: 'family_walks_50', scope: 'family', title: '50 טיולים', description: '50 טיולים משפחתיים הושלמו.', icon: '🏆', celebrationId: 'trophy-teaser' },
  { key: 'family_perfect_month', scope: 'family', title: 'חודש מושלם', description: `כל הטיולים ב-30 הימים האחרונים בוצעו, בלי אף אחד שהוחמץ (מתוך לפחות ${PERFECT_MONTH_MIN_RESOLVED}).`, icon: '🌟', celebrationId: 'trophy-teaser' },
  { key: 'personal_first_walk', scope: 'personal', title: 'הטיול הראשון שלך', description: 'השלמת את הטיול הראשון שלך!', icon: '🐕', celebrationId: 'trophy-teaser' },
  { key: 'personal_long_walk', scope: 'personal', title: 'טיול ארוך', description: `השלמת טיול של ${LONG_WALK_MINUTES} דקות ומעלה.`, icon: '⏱️', celebrationId: 'long-walk' },
  { key: 'personal_family_helper', scope: 'personal', title: 'עוזר/ת משפחתי/ת', description: `עזרת בטיול שלא היה תורך ${FAMILY_HELPER_TARGET} פעמים.`, icon: '🤝', celebrationId: 'trophy-teaser' },
  { key: 'personal_on_time_streak', scope: 'personal', title: 'תמיד בזמן', description: `${ON_TIME_STREAK_TARGET} טיולים ברצף בזמן.`, icon: '⏰', celebrationId: 'trophy-teaser' },
  { key: 'personal_fair_swap', scope: 'personal', title: 'החלפה הוגנת', description: `השתתפת ב-${FAIR_SWAP_TARGET} החלפות טיולים שאושרו בהצלחה.`, icon: '🔄', celebrationId: 'trophy-teaser' },
];

export function achievementDefinition(key: string): AchievementDefinition | undefined {
  return ACHIEVEMENT_CATALOG.find((a) => a.key === key);
}

export interface AchievementProgress {
  key: string;
  scope: AchievementScope;
  /** Set for 'personal' scope; undefined for 'family' scope — mirrors AchievementUnlock's own shape. */
  userId?: string;
  unlocked: boolean;
  current: number;
  target: number;
}

/** Same identity 0052's `dedupe_key` generated column uses server-side — a client never needs to special-case family vs. personal when checking "is this already unlocked". */
export function achievementDedupeKey(p: { key: string; userId?: string }): string {
  return `${p.key}:${p.userId ?? ''}`;
}

/**
 * The live walk list determines progress, but `achievement_unlocks` is an
 * immutable record of a milestone already earned. Deleting or correcting a
 * walk may lower current progress; it must never re-lock a past achievement.
 */
export function preserveUnlockedAchievements(
  progress: AchievementProgress[],
  unlocks: AchievementUnlock[]
): AchievementProgress[] {
  const unlockedKeys = new Set(unlocks.map((unlock) => achievementDedupeKey({ key: unlock.achievementKey, userId: unlock.userId })));
  return progress.map((item) => ({
    ...item,
    unlocked: item.unlocked || unlockedKeys.has(achievementDedupeKey(item)),
  }));
}

function milestoneProgress(key: string, doneCount: number, target: number): AchievementProgress {
  return { key, scope: 'family', unlocked: doneCount >= target, current: Math.min(doneCount, target), target };
}

/** Family-wide progress — every member's completed walks together, not scoped to any one person. */
export function computeFamilyAchievementProgress(walks: Walk[], now: Date = new Date()): AchievementProgress[] {
  const doneCount = walks.filter((w) => w.status === 'done').length;
  const progress: AchievementProgress[] = [
    { key: 'family_first_walk', scope: 'family', unlocked: doneCount >= 1, current: Math.min(doneCount, 1), target: 1 },
    ...FAMILY_WALK_MILESTONES.map((target) => milestoneProgress(`family_walks_${target}`, doneCount, target)),
  ];

  // "חודש מושלם" — every RESOLVED walk (done or skipped) in the last 30
  // days is done, with a minimum sample so a brand-new family with only 1
  // walk logged can't trivially unlock it on day one.
  const recentResolved = filterWalksByPeriod(walks, '30d', now).filter((w) => w.status === 'done' || w.status === 'skipped');
  const recentDone = recentResolved.filter((w) => w.status === 'done').length;
  const perfectMonthUnlocked = recentResolved.length >= PERFECT_MONTH_MIN_RESOLVED && recentDone === recentResolved.length;
  progress.push({
    key: 'family_perfect_month',
    scope: 'family',
    unlocked: perfectMonthUnlocked,
    current: Math.min(recentDone, PERFECT_MONTH_MIN_RESOLVED),
    target: PERFECT_MONTH_MIN_RESOLVED,
  });

  return progress;
}

/**
 * The longest CURRENT streak of this user's own on-time completions,
 * counting back from their most recent completed (planned) walk — a
 * single late completion resets it to 0, exactly like any ordinary streak
 * ("moderate", per the PRD, not a lifetime best-ever count). Unplanned
 * walks have no real "on time" to measure against (see
 * statistics.ts' wasCompletedOnTime) and are simply excluded, neither
 * breaking nor extending the streak.
 */
export function computeOnTimeStreak(walks: Walk[], userId: string): number {
  const own = walks
    .filter((w) => w.status === 'done' && w.completedByUserId === userId && !w.isUnplanned)
    .slice()
    .sort((a, b) => walkDateTime(b).getTime() - walkDateTime(a).getTime()); // most recent first

  let streak = 0;
  for (const w of own) {
    if (wasCompletedOnTime(w)) streak++;
    else break;
  }
  return streak;
}

/** One member's own progress — never another member's, keeping this a personal, not comparative, view (PRD's "not aggressive ranking"). */
/**
 * "החלפה הוגנת" (fair swap) — counts APPROVED swaps this user actually
 * completed on either side (the one who asked, or the one who agreed to
 * swap), since both sides equally reflect the cooperative behavior the
 * PRD is pointing at. A pending/rejected request never counts — this
 * rewards swaps that genuinely went through, not just requesting one.
 */
export function computeFairSwapCount(swapRequests: SwapRequestRow[], userId: string): number {
  return swapRequests.filter(
    (r) => r.status === 'approved' && (r.requested_by_user_id === userId || r.target_user_id === userId)
  ).length;
}

/** One member's own progress — never another member's, keeping this a personal, not comparative, view (PRD's "not aggressive ranking"). `swapRequests` is optional/best-effort: omitting it (e.g. local/demo mode, where swap requests don't exist server-side — see lib/requests.ts's own doc comment) simply leaves personal_fair_swap at 0/target rather than failing. */
export function computePersonalAchievementProgress(
  walks: Walk[],
  userId: string,
  swapRequests: SwapRequestRow[] = []
): AchievementProgress[] {
  const ownDone = walks.filter((w) => w.status === 'done' && w.completedByUserId === userId);
  const longWalkUnlocked = ownDone.some((w) => typeof w.durationMinutes === 'number' && w.durationMinutes >= LONG_WALK_MINUTES);
  const helperCount = ownDone.filter((w) => w.responsibleUserId !== userId).length;
  const streak = computeOnTimeStreak(walks, userId);
  const fairSwapCount = computeFairSwapCount(swapRequests, userId);

  return [
    { key: 'personal_first_walk', scope: 'personal', userId, unlocked: ownDone.length >= 1, current: Math.min(ownDone.length, 1), target: 1 },
    { key: 'personal_long_walk', scope: 'personal', userId, unlocked: longWalkUnlocked, current: longWalkUnlocked ? 1 : 0, target: 1 },
    { key: 'personal_family_helper', scope: 'personal', userId, unlocked: helperCount >= FAMILY_HELPER_TARGET, current: Math.min(helperCount, FAMILY_HELPER_TARGET), target: FAMILY_HELPER_TARGET },
    { key: 'personal_on_time_streak', scope: 'personal', userId, unlocked: streak >= ON_TIME_STREAK_TARGET, current: Math.min(streak, ON_TIME_STREAK_TARGET), target: ON_TIME_STREAK_TARGET },
    { key: 'personal_fair_swap', scope: 'personal', userId, unlocked: fairSwapCount >= FAIR_SWAP_TARGET, current: Math.min(fairSwapCount, FAIR_SWAP_TARGET), target: FAIR_SWAP_TARGET },
  ];
}

/** Which of `progress` just crossed their threshold and aren't in `alreadyUnlockedKeys` yet (built from persisted AchievementUnlock rows via achievementDedupeKey) — exactly the ones the caller should both persist and celebrate. Never re-reports one already in the set, so a reload/refocus can safely recompute progress every time without re-celebrating. */
export function detectNewlyUnlocked(progress: AchievementProgress[], alreadyUnlockedKeys: Set<string>): AchievementProgress[] {
  return progress.filter((p) => p.unlocked && !alreadyUnlockedKeys.has(achievementDedupeKey(p)));
}
