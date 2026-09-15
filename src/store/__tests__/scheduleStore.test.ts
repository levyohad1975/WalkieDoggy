import type { ScheduleRule, Walk } from '../../types';
import { computeNextWalk } from '../../logic/nextWalk';

/**
 * Regression tests for BUG 1 (round-2 bug report): a schedule rule added or
 * edited through the app must actually show up — the rule itself must
 * persist into store state, entries must be generated for it right away
 * (not only at some other load/generation time), and reloading the store
 * must never silently drop an active rule's entries.
 *
 * Each test resets the module registry so the singleton `repository`'s
 * in-memory LocalRepository cache — and the mocked AsyncStorage backing it —
 * both start from a clean, freshly-seeded demo store.
 */
describe('scheduleStore', () => {
  const FAMILY_ID = 'family-main';

  let useScheduleStore: typeof import('../scheduleStore').useScheduleStore;

  beforeEach(async () => {
    jest.resetModules();
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    ({ useScheduleStore } = require('../scheduleStore'));
  });

  it('creating a schedule rule adds it to state and immediately generates entries + walks for it', async () => {
    await useScheduleStore.getState().load(FAMILY_ID);
    const before = useScheduleStore.getState().rules.length;
    expect(before).toBeGreaterThan(0); // demo seed ships with 4 default rules

    const newRule: ScheduleRule = {
      id: 'rule-test-0900',
      familyId: FAMILY_ID,
      dogId: 'dog-topi',
      time: '09:00',
      label: 'טיול בדיקה',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      rotationUserIds: ['user-aba', 'user-ima'],
      rotationAnchorDate: '2026-08-27',
      sortOrder: before,
      active: true,
      createdAt: new Date().toISOString(),
    };

    await useScheduleStore.getState().addRule(newRule);

    const state = useScheduleStore.getState();
    expect(state.actionError).toBeNull();
    expect(state.rules).toHaveLength(before + 1);
    expect(state.rules.some((r) => r.id === 'rule-test-0900')).toBe(true);

    const entriesForRule = state.entries.filter((e) => e.ruleId === 'rule-test-0900');
    expect(entriesForRule.length).toBeGreaterThan(0);

    const walksForRule = state.walks.filter((w) => entriesForRule.some((e) => e.id === w.scheduleEntryId));
    expect(walksForRule).toHaveLength(entriesForRule.length);

    // A screen reading straight from the store (not re-fetching) must see it
    // without a manual reload — this is exactly what the Schedule screen does.
    const reread = useScheduleStore.getState();
    expect(reread.rules.some((r) => r.id === 'rule-test-0900')).toBe(true);
  });

  it('changing a rule updates its future pending entries/walks in place, without touching an already-completed walk or creating duplicates', async () => {
    await useScheduleStore.getState().load(FAMILY_ID);

    // rule-1230's walk for today is still 'pending' in the demo seed — this
    // is the case that must update. rule-0700's walk for today is already
    // 'done' in the demo seed (the dog was already walked at 07:00) — that
    // one must NOT change (requirement: a completed walk keeps its record).
    const pendingWalkBefore = useScheduleStore.getState().walks.find((w) => w.scheduleEntryId === 'entry-1230');
    expect(pendingWalkBefore?.status).toBe('pending');
    const doneWalkBefore = useScheduleStore.getState().walks.find((w) => w.scheduleEntryId === 'entry-0700');
    expect(doneWalkBefore?.status).toBe('done');

    await useScheduleStore.getState().updateRule('rule-1230', { time: '07:30' });

    const state = useScheduleStore.getState();
    expect(state.actionError).toBeNull();
    const updatedRule = state.rules.find((r) => r.id === 'rule-1230');
    expect(updatedRule?.time).toBe('07:30');

    const today = new Date().toISOString().slice(0, 10);
    const todaysEntry = state.entries.find((e) => e.ruleId === 'rule-1230' && e.date === today);
    expect(todaysEntry?.time).toBe('07:30');
    expect(todaysEntry?.id).toBe('entry-1230'); // scheduleEntryId is preserved, not replaced

    const todaysWalk = state.walks.find((w) => w.scheduleEntryId === todaysEntry?.id);
    expect(todaysWalk?.scheduledTime).toBe('07:30');
    expect(todaysWalk?.id).toBe(pendingWalkBefore?.id); // same walk record updated in place — no duplicate

    // No duplicate walk rows were created for this entry.
    const walksForEntry = state.walks.filter((w) => w.scheduleEntryId === 'entry-1230');
    expect(walksForEntry).toHaveLength(1);

    // The unrelated, already-completed walk must be completely untouched.
    const untouchedDoneWalk = state.walks.find((w) => w.scheduleEntryId === 'entry-0700');
    expect(untouchedDoneWalk?.status).toBe('done');
    expect(untouchedDoneWalk?.scheduledTime).toBe('07:00');
  });

  it('reload (load) self-heals: an active rule with no upcoming entries gets them backfilled instead of showing empty', async () => {
    await useScheduleStore.getState().load(FAMILY_ID);

    // Simulate a rule that exists in the repository but whose entries were
    // never generated (e.g. an interrupted save) — persist it directly,
    // bypassing addRule/its entry-generation step.
    const { repository } = require('../../data');
    const orphanRule: ScheduleRule = {
      id: 'rule-orphan',
      familyId: FAMILY_ID,
      dogId: 'dog-topi',
      time: '15:00',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      rotationUserIds: ['user-aba'],
      rotationAnchorDate: '2026-08-20',
      sortOrder: 99,
      active: true,
      createdAt: new Date().toISOString(),
    };
    await repository.upsertScheduleRule(orphanRule);

    // A fresh load (as the Schedule screen does on mount) must notice the
    // active rule has no matching entries and backfill them itself.
    await useScheduleStore.getState().load(FAMILY_ID);

    const state = useScheduleStore.getState();
    expect(state.rules.some((r) => r.id === 'rule-orphan')).toBe(true);
    const backfilledEntries = state.entries.filter((e) => e.ruleId === 'rule-orphan');
    expect(backfilledEntries.length).toBeGreaterThan(0);
    const backfilledWalks = state.walks.filter((w) => backfilledEntries.some((e) => e.id === w.scheduleEntryId));
    expect(backfilledWalks.length).toBe(backfilledEntries.length);
  });

  it('addRule surfaces a visible actionError instead of silently doing nothing when the repository write fails', async () => {
    await useScheduleStore.getState().load(FAMILY_ID);
    const { repository } = require('../../data');
    const spy = jest.spyOn(repository, 'upsertScheduleRule').mockRejectedValueOnce(new Error('boom'));

    const before = useScheduleStore.getState().rules.length;
    const badRule: ScheduleRule = {
      id: 'rule-will-fail',
      familyId: FAMILY_ID,
      dogId: 'dog-topi',
      time: '10:00',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      rotationUserIds: ['user-aba'],
      rotationAnchorDate: '2026-08-27',
      sortOrder: before,
      active: true,
      createdAt: new Date().toISOString(),
    };

    await useScheduleStore.getState().addRule(badRule);

    const state = useScheduleStore.getState();
    expect(state.rules).toHaveLength(before); // nothing added
    expect(state.actionError).toBeTruthy(); // but the failure is visible, not silent

    spy.mockRestore();
  });

  it('addUnplannedWalk (BUG 1: "טיול שבוצע" not saving) creates a done, unplanned walk, saves it, and reload still returns it', async () => {
    await useScheduleStore.getState().load(FAMILY_ID);
    const before = useScheduleStore.getState().walks.length;

    const saved = await useScheduleStore.getState().addUnplannedWalk({
      familyId: FAMILY_ID,
      dogId: 'dog-topi',
      performedByUserId: 'user-eidan',
      date: '2026-08-27',
      time: '16:00',
      hadPee: true,
      hadPoop: false,
      note: 'טיול קצר',
      durationMinutes: 15,
    });
    expect(saved).toBe(true);

    // 1) Appears in state immediately, no reload needed.
    const afterAdd = useScheduleStore.getState();
    expect(afterAdd.walks).toHaveLength(before + 1);
    expect(afterAdd.actionError).toBeNull();

    const added = afterAdd.walks.find((w) => w.isUnplanned && w.responsibleUserId === 'user-eidan');
    expect(added).toBeTruthy();
    expect(added?.status).toBe('done');
    expect(added?.isUnplanned).toBe(true);
    expect(added?.familyId).toBe(FAMILY_ID);
    expect(added?.dogId).toBe('dog-topi');
    expect(added?.date).toBe('2026-08-27');
    expect(added?.scheduledTime).toBe('16:00');
    expect(added?.completedByUserId).toBe('user-eidan');
    expect(added?.hadPee).toBe(true);
    expect(added?.hadPoop).toBe(false);
    expect(added?.note).toBe('טיול קצר');
    expect(added?.durationMinutes).toBe(15);
    expect(added?.id).toBeTruthy();

    // 2) It was actually persisted to the repository (not just in-memory state).
    const { repository } = require('../../data');
    const persisted = await repository.getWalks(FAMILY_ID);
    expect(persisted.some((w: Walk) => w.id === added?.id)).toBe(true);

    // 3) A fresh reload (as HistoryScreen/HomeScreen do on mount) still returns it.
    await useScheduleStore.getState().load(FAMILY_ID);
    const afterReload = useScheduleStore.getState();
    expect(afterReload.walks.some((w) => w.id === added?.id)).toBe(true);
  });

  it('addUnplannedWalk surfaces a visible actionError instead of silently doing nothing when the repository write fails', async () => {
    await useScheduleStore.getState().load(FAMILY_ID);
    const { repository } = require('../../data');
    const spy = jest.spyOn(repository, 'saveWalk').mockRejectedValueOnce(new Error('boom'));

    const before = useScheduleStore.getState().walks.length;
    const saved = await useScheduleStore.getState().addUnplannedWalk({
      familyId: FAMILY_ID,
      dogId: 'dog-topi',
      performedByUserId: 'user-maor',
      date: '2026-08-27',
      time: '18:00',
      hadPee: false,
      hadPoop: false,
    });
    expect(saved).toBe(false);

    const state = useScheduleStore.getState();
    expect(state.walks).toHaveLength(before); // optimistic add was rolled back
    expect(state.actionError).toBeTruthy(); // failure is visible, not silent

    spy.mockRestore();
  });
it('rescheduleWalk changes only the selected pending walk and its entry, without changing the rule', async () => {
  await useScheduleStore.getState().load(FAMILY_ID);

  const before = useScheduleStore.getState();

  const walk = before.walks.find(
    (w) => w.status === 'pending' && w.scheduleEntryId
  );

  expect(walk).toBeTruthy();

  const entry = before.entries.find(
    (e) => e.id === walk?.scheduleEntryId
  );

  expect(entry).toBeTruthy();

  const rule = before.rules.find(
    (r) => r.id === entry?.ruleId
  );

  expect(rule).toBeTruthy();

  const originalRuleTime = rule!.time;

  await useScheduleStore.getState().rescheduleWalk(walk!.id, '15:30');

  const after = useScheduleStore.getState();

  const updatedWalk = after.walks.find((w) => w.id === walk!.id);
  const updatedEntry = after.entries.find((e) => e.id === entry!.id);
  const unchangedRule = after.rules.find((r) => r.id === rule!.id);

  expect(updatedWalk?.scheduledTime).toBe('15:30');
  expect(updatedEntry?.time).toBe('15:30');
  expect(unchangedRule?.time).toBe(originalRuleTime);

  expect(
    after.walks.filter((w) => w.id === walk!.id)
  ).toHaveLength(1);
});
it('skip changes only the selected pending walk and leaves the rule and other walks untouched', async () => {
  await useScheduleStore.getState().load(FAMILY_ID);

  const before = useScheduleStore.getState();

  const walk = before.walks.find(
    (w) => w.status === 'pending' && w.scheduleEntryId
  );

  expect(walk).toBeTruthy();

  const entry = before.entries.find(
    (e) => e.id === walk?.scheduleEntryId
  );

  expect(entry).toBeTruthy();

  const rule = before.rules.find(
    (r) => r.id === entry?.ruleId
  );

  expect(rule).toBeTruthy();

  const originalRule = { ...rule! };
  const otherWalkIds = before.walks
    .filter((w) => w.id !== walk!.id)
    .map((w) => w.id);

  await useScheduleStore.getState().skip(walk!.id);

  const after = useScheduleStore.getState();

  const skippedWalk = after.walks.find((w) => w.id === walk!.id);
  const unchangedRule = after.rules.find((r) => r.id === rule!.id);

  expect(skippedWalk?.status).toBe('skipped');
  expect(unchangedRule).toEqual(originalRule);

  for (const id of otherWalkIds) {
    expect(after.walks.some((w) => w.id === id)).toBe(true);
  }
});

  it('A1 acceptance: marking the earliest of three future pending walks done leaves the others untouched and advances "next walk" to the correct one', async () => {
    await useScheduleStore.getState().load(FAMILY_ID);
    const { repository } = require('../../data');

    // Three future occurrences today, all pending, distinct responsible users.
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate() + 1).padStart(2, '0')}`;
    const walk0700: Walk = {
      id: 'walk-a1-0700', familyId: FAMILY_ID, dogId: 'dog-topi', date: dateStr, scheduledTime: '07:00',
      responsibleUserId: 'user-aba', status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const walk1400: Walk = {
      id: 'walk-a1-1400', familyId: FAMILY_ID, dogId: 'dog-topi', date: dateStr, scheduledTime: '14:00',
      responsibleUserId: 'user-omer', status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const walk1800: Walk = {
      id: 'walk-a1-1800', familyId: FAMILY_ID, dogId: 'dog-topi', date: dateStr, scheduledTime: '18:00',
      responsibleUserId: 'user-eidan', status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    for (const w of [walk0700, walk1400, walk1800]) await repository.saveWalk(w);
    await useScheduleStore.getState().load(FAMILY_ID);

    await useScheduleStore.getState().markDone('walk-a1-0700', 'user-aba', {});

    const state = useScheduleStore.getState();
    expect(state.actionError).toBeNull();

    const done0700 = state.walks.find((w) => w.id === 'walk-a1-0700');
    expect(done0700?.status).toBe('done');

    // The other two occurrences must be completely untouched.
    const untouched1400 = state.walks.find((w) => w.id === 'walk-a1-1400');
    expect(untouched1400).toEqual(walk1400);
    const untouched1800 = state.walks.find((w) => w.id === 'walk-a1-1800');
    expect(untouched1800).toEqual(walk1800);

    // "Next walk" must now be the 14:00 Omer occurrence, unchanged.
    //
    // markDone() ends by refetching ALL of this family's walks from the
    // repository (see scheduleStore.ts's markDone — it re-syncs from
    // repository.getWalks() once the write is confirmed resolved), so
    // state.walks here also contains the demo family's own seeded walks
    // (e.g. 'walk-1230', pending for today at 12:30) — entirely unrelated
    // to this test's own three occurrences. Depending on the wall-clock
    // time the suite happens to run at, that seeded walk can legitimately
    // sort earlier than tomorrow's test occurrences, which would make
    // computeNextWalk() correctly-but-irrelevantly return it instead of
    // this test's own walks. Scope the computation to just the three
    // occurrences this test created, so the assertion is deterministic
    // and isolated from whatever the demo seed happens to contain.
    const testWalkIds = new Set(['walk-a1-0700', 'walk-a1-1400', 'walk-a1-1800']);
    const nextWalk = computeNextWalk(state.walks.filter((w) => testWalkIds.has(w.id)));
    expect(nextWalk?.id).toBe('walk-a1-1400');
    expect(nextWalk?.responsibleUserId).toBe('user-omer');
  });

it('swapTwoWalks exchanges both walk owners and backing schedule-entry owners', async () => {
  await useScheduleStore.getState().load(FAMILY_ID);

  const before = useScheduleStore.getState();
  const walkA = before.walks.find((w) => w.id === 'walk-1230');
  const walkB = before.walks.find((w) => w.id === 'walk-1700');
  expect(walkA?.status).toBe('pending');
  expect(walkB?.status).toBe('pending');
  expect(walkA?.scheduleEntryId).toBeTruthy();
  expect(walkB?.scheduleEntryId).toBeTruthy();

  const userA = walkA!.responsibleUserId;
  const userB = walkB!.responsibleUserId;
  expect(userA).not.toBe(userB);

  await useScheduleStore.getState().swapTwoWalks(walkA!.id, walkB!.id, 'user-aba');

  const after = useScheduleStore.getState();
  expect(after.walks.find((w) => w.id === walkA!.id)?.responsibleUserId).toBe(userB);
  expect(after.walks.find((w) => w.id === walkB!.id)?.responsibleUserId).toBe(userA);
  expect(after.entries.find((e) => e.id === walkA!.scheduleEntryId)?.responsibleUserId).toBe(userB);
  expect(after.entries.find((e) => e.id === walkB!.scheduleEntryId)?.responsibleUserId).toBe(userA);

  const { repository } = require('../../data');
  const persistedEntries = await repository.getScheduleEntries(FAMILY_ID);
  expect(persistedEntries.find((e: { id: string }) => e.id === walkA!.scheduleEntryId)?.responsibleUserId).toBe(userB);
  expect(persistedEntries.find((e: { id: string }) => e.id === walkB!.scheduleEntryId)?.responsibleUserId).toBe(userA);
});

it('deleteRule removes the rule plus its future pending entries/walks, and leaves other rules untouched', async () => {
  await useScheduleStore.getState().load(FAMILY_ID);
  const before = useScheduleStore.getState();
  expect(before.rules.some((r) => r.id === 'rule-1700')).toBe(true);
  expect(before.entries.some((e) => e.id === 'entry-1700')).toBe(true);
  expect(before.walks.some((w) => w.id === 'walk-1700')).toBe(true);
  const otherRuleIds = before.rules.filter((r) => r.id !== 'rule-1700').map((r) => r.id);

  await useScheduleStore.getState().deleteRule('rule-1700');

  const after = useScheduleStore.getState();
  expect(after.actionError).toBeNull();
  expect(after.rules.some((r) => r.id === 'rule-1700')).toBe(false);
  expect(after.entries.some((e) => e.id === 'entry-1700')).toBe(false);
  expect(after.walks.some((w) => w.id === 'walk-1700')).toBe(false);
  for (const id of otherRuleIds) {
    expect(after.rules.some((r) => r.id === id)).toBe(true);
  }

  const { repository } = require('../../data');
  const persistedEntries = await repository.getScheduleEntries(FAMILY_ID);
  expect(persistedEntries.some((e: { id: string }) => e.id === 'entry-1700')).toBe(false);
});

it('deleteRule surfaces a visible actionError instead of silently doing nothing when the repository write fails', async () => {
  await useScheduleStore.getState().load(FAMILY_ID);
  const { repository } = require('../../data');
  const spy = jest.spyOn(repository, 'deleteScheduleRule').mockRejectedValueOnce(new Error('boom'));

  await useScheduleStore.getState().deleteRule('rule-1700');

  const state = useScheduleStore.getState();
  expect(state.actionError).toBeTruthy();
  expect(state.rules.some((r) => r.id === 'rule-1700')).toBe(true); // untouched — the failure happened before any set()

  spy.mockRestore();
});

it('reorderRules persists and applies only the sortOrder values that actually changed', async () => {
  await useScheduleStore.getState().load(FAMILY_ID);
  const { repository } = require('../../data');
  const spy = jest.spyOn(repository, 'upsertScheduleRule');

  const before = useScheduleStore.getState().rules;
  const reordered = ['rule-1700', 'rule-0700', 'rule-1230', 'rule-2130'];

  await useScheduleStore.getState().reorderRules(reordered);

  const state = useScheduleStore.getState();
  expect(state.actionError).toBeNull();
  expect(state.rules.find((r) => r.id === 'rule-1700')?.sortOrder).toBe(0);
  expect(state.rules.find((r) => r.id === 'rule-0700')?.sortOrder).toBe(1);
  expect(state.rules.find((r) => r.id === 'rule-1230')?.sortOrder).toBe(2);
  expect(state.rules.find((r) => r.id === 'rule-2130')?.sortOrder).toBe(3);
  // rule-2130 already had sortOrder 3 before this call — it must not be
  // re-persisted for a no-op position change.
  const persistedIds = spy.mock.calls.map((args) => (args[0] as { id: string }).id);
  expect(persistedIds).toEqual(expect.arrayContaining(['rule-1700', 'rule-0700', 'rule-1230']));
  expect(persistedIds).not.toContain('rule-2130');
  expect(before.find((r) => r.id === 'rule-2130')?.sortOrder).toBe(3);

  spy.mockRestore();
});

it('reorderRules surfaces a visible actionError instead of silently doing nothing when the repository write fails', async () => {
  await useScheduleStore.getState().load(FAMILY_ID);
  const { repository } = require('../../data');
  const spy = jest.spyOn(repository, 'upsertScheduleRule').mockRejectedValueOnce(new Error('boom'));

  await useScheduleStore.getState().reorderRules(['rule-1700', 'rule-0700', 'rule-1230', 'rule-2130']);

  const state = useScheduleStore.getState();
  expect(state.actionError).toBeTruthy();

  spy.mockRestore();
});

it('deleteEntry removes the entry and its backing walk together', async () => {
  await useScheduleStore.getState().load(FAMILY_ID);
  expect(useScheduleStore.getState().entries.some((e) => e.id === 'entry-1700')).toBe(true);
  expect(useScheduleStore.getState().walks.some((w) => w.id === 'walk-1700')).toBe(true);

  await useScheduleStore.getState().deleteEntry('entry-1700');

  const state = useScheduleStore.getState();
  expect(state.entries.some((e) => e.id === 'entry-1700')).toBe(false);
  expect(state.walks.some((w) => w.id === 'walk-1700')).toBe(false);
  // Unrelated entry/walk pairs are untouched.
  expect(state.entries.some((e) => e.id === 'entry-1230')).toBe(true);
  expect(state.walks.some((w) => w.id === 'walk-1230')).toBe(true);
});

it('editDoneDetails updates a resolved walk\'s recorded details', async () => {
  await useScheduleStore.getState().load(FAMILY_ID);
  const doneWalk = useScheduleStore.getState().walks.find((w) => w.id === 'walk-0700');
  expect(doneWalk?.status).toBe('done');

  await useScheduleStore.getState().editDoneDetails('walk-0700', { note: 'תיקון', hadPee: false });

  const state = useScheduleStore.getState();
  expect(state.actionError).toBeNull();
  const updated = state.walks.find((w) => w.id === 'walk-0700');
  expect(updated?.note).toBe('תיקון');
  expect(updated?.hadPee).toBe(false);
  expect(updated?.status).toBe('done'); // unaffected by the edit
});

it('editDoneDetails refuses (visible actionError) for a walk that is still pending', async () => {
  await useScheduleStore.getState().load(FAMILY_ID);
  const pendingWalk = useScheduleStore.getState().walks.find((w) => w.id === 'walk-1230');
  expect(pendingWalk?.status).toBe('pending');

  await useScheduleStore.getState().editDoneDetails('walk-1230', { note: 'לא אמור לעבוד' });

  const state = useScheduleStore.getState();
  expect(state.actionError).toBeTruthy();
  expect(state.walks.find((w) => w.id === 'walk-1230')?.note).toBeUndefined();
});

it('swap reassigns a single pending walk to a different family member', async () => {
  await useScheduleStore.getState().load(FAMILY_ID);
  const walk = useScheduleStore.getState().walks.find((w) => w.id === 'walk-1230');
  expect(walk?.responsibleUserId).toBe('user-ima');

  await useScheduleStore.getState().swap('walk-1230', 'user-eidan', 'user-ima');

  const state = useScheduleStore.getState();
  expect(state.actionError).toBeNull();
  expect(state.walks.find((w) => w.id === 'walk-1230')?.responsibleUserId).toBe('user-eidan');
});

it('swap refuses (visible actionError) when asked to swap a walk to its own current owner', async () => {
  await useScheduleStore.getState().load(FAMILY_ID);
  const walk = useScheduleStore.getState().walks.find((w) => w.id === 'walk-1230');
  const currentOwner = walk!.responsibleUserId;

  await useScheduleStore.getState().swap('walk-1230', currentOwner, currentOwner);

  const state = useScheduleStore.getState();
  expect(state.actionError).toBeTruthy();
  expect(state.walks.find((w) => w.id === 'walk-1230')?.responsibleUserId).toBe(currentOwner);
});

it('markDone refuses (visible actionError, returns false) for a walk that is already done', async () => {
  await useScheduleStore.getState().load(FAMILY_ID);
  const alreadyDone = useScheduleStore.getState().walks.find((w) => w.id === 'walk-0700');
  expect(alreadyDone?.status).toBe('done');

  const result = await useScheduleStore.getState().markDone('walk-0700', 'user-aba', {});

  expect(result).toBe(false);
  expect(useScheduleStore.getState().actionError).toBeTruthy();
});

it('deleteUnplannedWalk removes a previously-added unplanned walk, including from the repository', async () => {
  await useScheduleStore.getState().load(FAMILY_ID);
  const saved = await useScheduleStore.getState().addUnplannedWalk({
    familyId: FAMILY_ID,
    dogId: 'dog-topi',
    performedByUserId: 'user-aba',
    date: '2026-08-27',
    time: '11:00',
    hadPee: true,
    hadPoop: true,
  });
  expect(saved).toBe(true);
  const added = useScheduleStore.getState().walks.find((w) => w.isUnplanned && w.scheduledTime === '11:00');
  expect(added).toBeTruthy();

  await useScheduleStore.getState().deleteUnplannedWalk(added!.id);

  const state = useScheduleStore.getState();
  expect(state.actionError).toBeNull();
  expect(state.walks.some((w) => w.id === added!.id)).toBe(false);

  const { repository } = require('../../data');
  const persisted = await repository.getWalks(FAMILY_ID);
  expect(persisted.some((w: Walk) => w.id === added!.id)).toBe(false);
});

it('deleteUnplannedWalk refuses (visible actionError) for a regular scheduled walk', async () => {
  await useScheduleStore.getState().load(FAMILY_ID);
  expect(useScheduleStore.getState().walks.some((w) => w.id === 'walk-1230')).toBe(true);

  await useScheduleStore.getState().deleteUnplannedWalk('walk-1230');

  const state = useScheduleStore.getState();
  expect(state.actionError).toBeTruthy();
  expect(state.walks.some((w) => w.id === 'walk-1230')).toBe(true); // untouched
});

it('deleteScheduledWalkOccurrence removes a resolved (done) scheduled walk occurrence', async () => {
  await useScheduleStore.getState().load(FAMILY_ID);
  expect(useScheduleStore.getState().walks.some((w) => w.id === 'walk-0700')).toBe(true);

  await useScheduleStore.getState().deleteScheduledWalkOccurrence('walk-0700');

  const state = useScheduleStore.getState();
  expect(state.actionError).toBeNull();
  expect(state.walks.some((w) => w.id === 'walk-0700')).toBe(false);
});

it('deleteScheduledWalkOccurrence refuses (visible actionError) for a walk that is still pending', async () => {
  await useScheduleStore.getState().load(FAMILY_ID);
  expect(useScheduleStore.getState().walks.find((w) => w.id === 'walk-1230')?.status).toBe('pending');

  await useScheduleStore.getState().deleteScheduledWalkOccurrence('walk-1230');

  const state = useScheduleStore.getState();
  expect(state.actionError).toBeTruthy();
  expect(state.walks.some((w) => w.id === 'walk-1230')).toBe(true); // untouched
});

it('deleteScheduledWalkOccurrence refuses (visible actionError) for an unplanned walk (wrong door — use deleteUnplannedWalk)', async () => {
  await useScheduleStore.getState().load(FAMILY_ID);
  const saved = await useScheduleStore.getState().addUnplannedWalk({
    familyId: FAMILY_ID,
    dogId: 'dog-topi',
    performedByUserId: 'user-aba',
    date: '2026-08-27',
    time: '13:00',
    hadPee: true,
    hadPoop: true,
  });
  expect(saved).toBe(true);
  const added = useScheduleStore.getState().walks.find((w) => w.isUnplanned && w.scheduledTime === '13:00');
  expect(added).toBeTruthy();

  await useScheduleStore.getState().deleteScheduledWalkOccurrence(added!.id);

  const state = useScheduleStore.getState();
  expect(state.actionError).toBeTruthy();
  expect(state.walks.some((w) => w.id === added!.id)).toBe(true); // untouched
});

it('updateRule surfaces a visible actionError instead of silently doing nothing when the repository write fails', async () => {
  await useScheduleStore.getState().load(FAMILY_ID);
  const { repository } = require('../../data');
  const spy = jest.spyOn(repository, 'upsertScheduleRule').mockRejectedValueOnce(new Error('boom'));
  const originalTime = useScheduleStore.getState().rules.find((r) => r.id === 'rule-1230')?.time;

  await useScheduleStore.getState().updateRule('rule-1230', { time: '08:00' });

  const state = useScheduleStore.getState();
  expect(state.actionError).toBeTruthy();
  expect(state.rules.find((r) => r.id === 'rule-1230')?.time).toBe(originalTime);

  spy.mockRestore();
});

it('skip refuses (visible actionError) for a walk that is not pending', async () => {
  await useScheduleStore.getState().load(FAMILY_ID);
  expect(useScheduleStore.getState().walks.find((w) => w.id === 'walk-0700')?.status).toBe('done');

  await useScheduleStore.getState().skip('walk-0700');

  const state = useScheduleStore.getState();
  expect(state.actionError).toBeTruthy();
  expect(state.walks.find((w) => w.id === 'walk-0700')?.status).toBe('done'); // untouched
});

it('swapTwoWalks reverts both walks/entries and surfaces a visible actionError when the repository write fails', async () => {
  await useScheduleStore.getState().load(FAMILY_ID);
  const before = useScheduleStore.getState();
  const walkA = before.walks.find((w) => w.id === 'walk-1230')!;
  const walkB = before.walks.find((w) => w.id === 'walk-1700')!;

  const { repository } = require('../../data');
  const spy = jest.spyOn(repository, 'saveWalk').mockRejectedValueOnce(new Error('boom'));

  await useScheduleStore.getState().swapTwoWalks(walkA.id, walkB.id, 'user-aba');

  const state = useScheduleStore.getState();
  expect(state.actionError).toBeTruthy();
  expect(state.walks.find((w) => w.id === walkA.id)?.responsibleUserId).toBe(walkA.responsibleUserId);
  expect(state.walks.find((w) => w.id === walkB.id)?.responsibleUserId).toBe(walkB.responsibleUserId);

  spy.mockRestore();
});

it('editUnplannedWalk updates an existing unplanned walk in place, without creating a duplicate', async () => {
  await useScheduleStore.getState().load(FAMILY_ID);
  const saved = await useScheduleStore.getState().addUnplannedWalk({
    familyId: FAMILY_ID,
    dogId: 'dog-topi',
    performedByUserId: 'user-aba',
    date: '2026-08-27',
    time: '09:00',
    hadPee: true,
    hadPoop: false,
  });
  expect(saved).toBe(true);
  const added = useScheduleStore.getState().walks.find((w) => w.isUnplanned && w.scheduledTime === '09:00')!;
  const before = useScheduleStore.getState().walks.length;

  await useScheduleStore.getState().editUnplannedWalk(added.id, { note: 'עודכן', durationMinutes: 20 });

  const state = useScheduleStore.getState();
  expect(state.actionError).toBeNull();
  expect(state.walks).toHaveLength(before); // no duplicate
  const updated = state.walks.find((w) => w.id === added.id);
  expect(updated?.note).toBe('עודכן');
  expect(updated?.durationMinutes).toBe(20);
});

it('editUnplannedWalk refuses (visible actionError) for a regular scheduled walk', async () => {
  await useScheduleStore.getState().load(FAMILY_ID);

  await useScheduleStore.getState().editUnplannedWalk('walk-1230', { note: 'לא אמור לעבוד' });

  const state = useScheduleStore.getState();
  expect(state.actionError).toBeTruthy();
  expect(state.walks.find((w) => w.id === 'walk-1230')?.note).toBeUndefined();
});

it('editUnplannedWalk reverts the optimistic update and surfaces a visible actionError when the repository write fails', async () => {
  await useScheduleStore.getState().load(FAMILY_ID);
  const saved = await useScheduleStore.getState().addUnplannedWalk({
    familyId: FAMILY_ID,
    dogId: 'dog-topi',
    performedByUserId: 'user-aba',
    date: '2026-08-27',
    time: '10:00',
    hadPee: true,
    hadPoop: false,
  });
  expect(saved).toBe(true);
  const added = useScheduleStore.getState().walks.find((w) => w.isUnplanned && w.scheduledTime === '10:00')!;

  const { repository } = require('../../data');
  const spy = jest.spyOn(repository, 'saveWalk').mockRejectedValueOnce(new Error('boom'));

  await useScheduleStore.getState().editUnplannedWalk(added.id, { note: 'לא אמור להישמר' });

  const state = useScheduleStore.getState();
  expect(state.actionError).toBeTruthy();
  expect(state.walks.find((w) => w.id === added.id)?.note).toBeUndefined(); // reverted

  spy.mockRestore();
});

it('deleteUnplannedWalk restores the walk and surfaces a visible actionError when the repository delete fails', async () => {
  await useScheduleStore.getState().load(FAMILY_ID);
  const saved = await useScheduleStore.getState().addUnplannedWalk({
    familyId: FAMILY_ID,
    dogId: 'dog-topi',
    performedByUserId: 'user-aba',
    date: '2026-08-27',
    time: '14:00',
    hadPee: true,
    hadPoop: false,
  });
  expect(saved).toBe(true);
  const added = useScheduleStore.getState().walks.find((w) => w.isUnplanned && w.scheduledTime === '14:00')!;

  const { repository } = require('../../data');
  const spy = jest.spyOn(repository, 'deleteWalk').mockRejectedValueOnce(new Error('boom'));

  await useScheduleStore.getState().deleteUnplannedWalk(added.id);

  const state = useScheduleStore.getState();
  expect(state.actionError).toBeTruthy();
  expect(state.walks.some((w) => w.id === added.id)).toBe(true); // restored

  spy.mockRestore();
});

it('deleteScheduledWalkOccurrence restores the walk and surfaces a visible actionError when the repository delete fails', async () => {
  await useScheduleStore.getState().load(FAMILY_ID);
  expect(useScheduleStore.getState().walks.find((w) => w.id === 'walk-0700')?.status).toBe('done');

  const { repository } = require('../../data');
  const spy = jest.spyOn(repository, 'deleteWalk').mockRejectedValueOnce(new Error('boom'));

  await useScheduleStore.getState().deleteScheduledWalkOccurrence('walk-0700');

  const state = useScheduleStore.getState();
  expect(state.actionError).toBeTruthy();
  expect(state.walks.some((w) => w.id === 'walk-0700')).toBe(true); // restored

  spy.mockRestore();
});

it('clearActionError resets actionError back to null', async () => {
  await useScheduleStore.getState().load(FAMILY_ID);
  useScheduleStore.setState({ actionError: 'משהו נכשל' });

  useScheduleStore.getState().clearActionError();

  expect(useScheduleStore.getState().actionError).toBeNull();
});

});
