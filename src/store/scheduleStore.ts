import { create } from 'zustand';
import type { ScheduleEntry, ScheduleRule, UnplannedWalkInput, Walk } from '../types';
import { repository } from '../data';
import {
  generateRotationSchedule,
  planRuleDaysReconciliation,
  planStaleRuleEntryReconciliation,
  resolveResponsibleForDate,
  ruleNeedsEntryBackfill,
} from '../logic/rotation';
import { localDateOnly } from '../logic/dateFormat';
import { finalizeSupersededPendingWalks } from '../logic/nextWalk';
import { pickerDateToTime } from '../logic/timeInput';
import {
  editWalkDetails,
  markWalkDone,
  markWalkSkipped,
  swapWalk as swapWalkPure,
  swapWalksMutual,
  WalkActionError,
  type WalkCompletionDetails,
} from '../logic/walkActions';
import { generateId } from '../lib/id';
import { cancelWalkNotifications, reconcileWalkNotifications, scheduleWalkNotifications } from '../notifications/notificationService';
import { guardTestModeMutation } from '../lib/testModeGuard';
import { hasActiveRemoteReminderChannel } from '../lib/remoteReminderChannel';
import { deleteScheduleRuleWithOccurrences, isSupabaseConfigured } from '../lib/supabase';
import { adminRescheduleWalk, adminSwapWalks } from '../lib/walkAdmin';
import { appendRawDiagnostic, friendlyErrorMessage, rawMessageOf } from '../lib/errorMessages';
import { useGpsStore } from './gpsStore';
// TEMPORARY DIAGNOSTIC INSTRUMENTATION — see perfTrace.ts's own doc
// comment. Remove this import and every perfMark call in addRule()/
// updateRule() once the real ~10s Schedule-save bottleneck is confirmed
// fixed by an actual real-device measurement.
import { perfMark } from '../lib/perfTrace';

const GENERATE_DAYS_AHEAD = 14;

/**
 * Real-device QA fix (double-tap "שמירה" false-failure bug) — migration
 * 0099's schedule_rules_active_identity_uidx is a unique index on
 * (family_id, dog_id, time, days_of_week, rotation_user_ids,
 * rotation_anchor_date) where active = true, meant to stop a duplicate
 * active rule from generating duplicate future walk occurrences.
 * RuleFormModal.tsx now disables its own Save button for the duration of
 * addRule() (see its own `saving` state), which closes off the original
 * trigger — tapping Save twice before the first add had resolved used to
 * fire two independent addRule() calls with the SAME data (each gets its
 * own fresh rule id from generateId('rule') in ScheduleScreen.tsx, so the
 * id itself never collides — only this index's other columns do). The
 * FIRST insert always won; the SECOND hit this constraint and surfaced a
 * raw Postgres "duplicate key" error with no entry in errorMessages.ts's
 * table, falling back to the generic "לא הצלחנו להוסיף את שעת הטיול" for
 * a save that, from the end state's perspective, had already succeeded.
 * This check stays as defense-in-depth for any other path that could
 * still race two identical inserts (a retried network request, a future
 * caller that doesn't go through RuleFormModal) — see addRule()'s own use
 * of it below.
 */
function isDuplicateActiveScheduleRuleError(error: unknown): boolean {
  return rawMessageOf(error).includes('schedule_rules_active_identity_uidx');
}

// BUG FIX (duplicate schedule entries/walks) — see load()'s doc comment
// below for the full race-condition this guards against. Keyed by
// familyId so two different families' loads never block on each other.
const loadPromiseByFamilyId: Record<string, Promise<boolean>> = {};

interface ScheduleState {
  rules: ScheduleRule[];
  entries: ScheduleEntry[];
  walks: Walk[];
  loading: boolean;
  error: string | null;
  actionError: string | null;

  // Resolves true when fresh, authoritative data was loaded (walks/entries/
  // rules all reflect the repository as of this call) and false when the
  // load failed — in which case `error` is set (for screen-level display,
  // unchanged UX) and `walks`/`entries`/`rules` are left exactly as they
  // were (never cleared to empty on failure). Never rejects: every existing
  // screen-level caller that just does `await load(familyId)` and then reads
  // `error` off the store keeps working unmodified. Orchestration code
  // (App.tsx's runForegroundSync()) uses the boolean to decide whether it is
  // safe to reconcile notifications against `walks` as FRESH data.
  load: (familyId: string) => Promise<boolean>;

  // Time-slot (rule) management — "4 walks a day", editable/addable/removable.
  addRule: (rule: ScheduleRule) => Promise<void>;
  updateRule: (
    ruleId: string,
    patch: Partial<Pick<ScheduleRule, 'time' | 'label' | 'rotationUserIds' | 'daysOfWeek'>>
  ) => Promise<void>;
  deleteRule: (ruleId: string) => Promise<void>;
  reorderRules: (orderedRuleIds: string[]) => Promise<void>;

  // Single-occurrence edits — never touch the rule or future rotation.
  rescheduleWalk: (walkId: string, newTime: string) => Promise<void>;
  deleteEntry: (entryId: string) => Promise<void>;

  startWalk: (walkId: string) => Promise<boolean>;
  finishWalk: (walkId: string, completedByUserId: string, details?: WalkCompletionDetails) => Promise<boolean>;
  markDone: (walkId: string, completedByUserId: string, details?: WalkCompletionDetails) => Promise<boolean>;
  editDoneDetails: (walkId: string, details: WalkCompletionDetails) => Promise<void>;
  skip: (walkId: string) => Promise<void>;
  swap: (walkId: string, newUserId: string, swappedByUserId: string) => Promise<void>;
  swapTwoWalks: (walkAId: string, walkBId: string, swappedByUserId: string) => Promise<void>;
  addUnplannedWalk: (input: UnplannedWalkInput) => Promise<boolean>;
  /**
   * Gives a spontaneous walk the same live start_walk/finish_walk lifecycle
   * a planned walk gets ("case A" — see migration 0054), alongside (never
   * instead of) addUnplannedWalk's existing after-the-fact logging ("case
   * B", unchanged). Creates a brand-new `pending` walk row (isUnplanned,
   * no scheduleEntryId — never touches the rotation/schedule) attributed
   * to the caller, then immediately runs it through the existing
   * startWalk() action so it goes through the SAME start_walk RPC,
   * authorization, and GPS-tracking kickoff as any scheduled walk.
   * Server-side authorization for the initial insert is migration 0054's
   * trigger extension — any family member may insert their OWN pending,
   * not-yet-started/completed unplanned walk; the actual pending-
   * >in_progress->done transitions are only ever written by
   * start_walk()/finish_walk() themselves, never by this insert.
   * computeNextWalk() (see logic/nextWalk.ts) already picks the first
   * `in_progress` walk regardless of isUnplanned, so this needs no
   * Home-screen changes for the resulting walk to show up in the normal
   * "current walk" card with its normal "סיים טיול" action, wired to the
   * existing finishWalk(). Deliberately always attributed to the caller
   * (never a picker for someone else) — starting a walk is "I am doing
   * this right now", not a backfill.
   */
  startUnplannedWalk: (familyId: string, dogId: string, userId: string) => Promise<boolean>;
  isStartingUnplannedWalk: boolean;
  /**
   * Section 2: edits an existing unplanned/spontaneous walk IN PLACE — same
   * record, never a duplicate. `patch` may include any subset of the fields
   * the "add a walk that already happened" flow itself collects (time/date,
   * responsible member, duration, pee/poop, notes). Refuses (no-op, sets
   * actionError) for a walk that isn't actually unplanned — this action is
   * not a generic walk editor, EditWalkModal/editDoneDetails own that.
   */
  editUnplannedWalk: (
    walkId: string,
    patch: Partial<Pick<Walk, 'date' | 'scheduledTime' | 'responsibleUserId' | 'hadPee' | 'hadPoop' | 'note' | 'durationMinutes'>>
  ) => Promise<void>;
  /** Section 2: deletes an unplanned walk entered by mistake. The caller (the UI) is expected to confirm with the user first — see the ConfirmModal usage at the call site. */
  deleteUnplannedWalk: (walkId: string) => Promise<void>;

  /**
   * Final QA round v2 (item D completion): deletes a resolved (done or
   * skipped) SCHEDULED walk OCCURRENCE — a correction of a mis-recorded
   * entry, never a still-pending walk and never the recurring rule/its
   * other occurrences. Mirrors deleteUnplannedWalk's own optimistic-
   * update/revert-on-failure shape exactly; server-side authorization is
   * migration 0015's DELETE branch (admin OR the walk's own responsible
   * member). See src/logic/walkActions.ts's canDeleteScheduledWalk() for
   * the client-side mirror of that same rule (used for UI gating only —
   * this action itself does not re-check identity, matching every other
   * action in this store, which all rely on the screen already having
   * gated the affordance plus the DB trigger as the real enforcement).
   * Deliberately does NOT touch the walk's schedule_entry_id row — see
   * migration 0015's own header comment for why that is what makes this
   * safe from scheduleStore.load()'s rule-based backfill.
   */
  deleteScheduledWalkOccurrence: (walkId: string) => Promise<void>;

  clearActionError: () => void;
}

function walkFromEntry(entry: ScheduleEntry, familyId: string): Walk {
  const now = new Date().toISOString();
  return {
    id: generateId('walk'),
    familyId,
    scheduleEntryId: entry.id,
    dogId: entry.dogId,
    date: entry.date,
    scheduledTime: entry.time,
    responsibleUserId: entry.responsibleUserId,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
}

async function scheduleNotificationsForWalk(walk: Walk) {
  // Batch 2 / Decision 4 (channel-selection/dedup policy — see
  // src/lib/remoteReminderChannel.ts): once this device has an active
  // remote push channel, the server-side scheduler is authoritative for
  // this profile's reminders — local scheduling is skipped (and any
  // already-scheduled local reminder for this exact walk is cancelled)
  // rather than risk a duplicate buzz from both systems.
  if (await hasActiveRemoteReminderChannel()) {
    await cancelWalkNotifications(walk.id);
    return;
  }
  const { useFamilyStore } = require('./familyStore') as typeof import('./familyStore');
  const { users, dog: activeDog, dogs } = useFamilyStore.getState();
  const user = users.find((u) => u.id === walk.responsibleUserId);
  // Multi-dog (PRD §11): resolve THIS walk's own dog by walk.dogId, never
  // the globally-selected active dog — a walk being (re)scheduled can
  // belong to any of the family's dogs regardless of which one is
  // currently active in the UI. Falls back to the active dog only if
  // walk.dogId somehow isn't in `dogs` (shouldn't normally happen), so a
  // genuinely schedulable reminder is never silently dropped.
  const dog = dogs.find((d) => d.id === walk.dogId) ?? activeDog;
  if (!user || !user.remindersEnabled || !dog) return;
  const settings = await repository.getNotificationSettings(walk.familyId);
  const setting = settings.find((s) => s.userId === user.id);
  if (!setting) return;
  await scheduleWalkNotifications(walk, setting, user.name, dog.name, dog.sex);
}

/**
 * Full reconciliation of ALL of this family's notifications against the
 * CURRENTLY PERSISTED walk occurrences (A3's authoritative rule) — cancels
 * anything stale for a non-pending/removed walk, (re)schedules everything
 * still pending from its current data. Exported so App.tsx can also run it
 * on startup/foreground, independent of a full schedule reload.
 */
export async function reconcileScheduleNotifications(familyId: string, walks: Walk[]): Promise<void> {
  // Batch 2 / Decision 4 — see scheduleNotificationsForWalk()'s identical
  // gate just above for the full reasoning. Cancel rather than reconcile:
  // any local reminder left over from before this profile had a remote
  // channel must not survive alongside the now-authoritative server sends.
  if (await hasActiveRemoteReminderChannel()) {
    await Promise.all(walks.map((w) => cancelWalkNotifications(w.id)));
    return;
  }
  const { useFamilyStore } = require('./familyStore') as typeof import('./familyStore');
  const { users, dog: activeDog, dogs } = useFamilyStore.getState();
  if (!activeDog && dogs.length === 0) return;
  const usersById = new Map(users.map((u) => [u.id, u]));
  // Multi-dog (PRD §11): per-walk dog resolution, same reasoning as
  // scheduleNotificationsForWalk() above — this reconciliation pass runs
  // over the family's WHOLE walk set, which can span every one of its
  // dogs, not just whichever one is currently active.
  const dogsById = new Map(dogs.map((d) => [d.id, d]));
  const settings = await repository.getNotificationSettings(familyId);
  const settingsByUserId = new Map(settings.map((s) => [s.userId, s]));
  await reconcileWalkNotifications(
    walks,
    async (userId) => {
      const user = usersById.get(userId);
      if (!user || !user.remindersEnabled) return undefined;
      return settingsByUserId.get(userId);
    },
    (userId) => usersById.get(userId)?.name,
    (dogId) => dogsById.get(dogId) ?? activeDog ?? undefined
  );
}

/**
 * The actual body of load() — fetches this family's rules/entries/walks and
 * self-heals any rule that's missing its upcoming entries. Extracted to a
 * standalone function so load() itself can wrap a single in-flight call per
 * familyId behind a promise guard (see load()'s doc comment) instead of
 * re-running this whole fetch+backfill for every concurrent caller.
 */
async function loadScheduleForFamily(
  familyId: string,
  set: (partial: Partial<ScheduleState> | ((s: ScheduleState) => Partial<ScheduleState>)) => void
): Promise<boolean> {
  set({ loading: true, error: null });
  try {
    const [rules, entries, walks] = await Promise.all([
      repository.getScheduleRules(familyId),
      repository.getScheduleEntries(familyId),
      repository.getWalks(familyId),
    ]);

    // Recurring rules are configuration and survive an activity reset. Rebuild
    // only the FUTURE occurrence horizon when a surviving active rule has no
    // upcoming entries, so Home can still resolve "next walk" after reset.
    // Existing future entries are never duplicated; the repository/DB identity
    // constraints remain the final concurrency guard.
    let finalEntries = entries;
    let finalWalks = walks;
    const today = localDateOnly(new Date());
    const endDate = localDateOnly(new Date(Date.now() + GENERATE_DAYS_AHEAD * 86400000));
    const rulesNeedingFuture = rules.filter((rule) => ruleNeedsEntryBackfill(rule, finalEntries, today));
    for (const rule of rulesNeedingFuture) {
      const generated = generateRotationSchedule(rule, today, endDate, () => generateId('entry'));
      if (generated.length === 0) continue;
      await repository.addScheduleEntries(generated);
      const existingKeys = new Set(finalEntries.map((e) => `${e.dogId}|${e.date}|${e.time}`));
      const trulyNew = generated.filter((e) => !existingKeys.has(`${e.dogId}|${e.date}|${e.time}`));
      const generatedWalks = trulyNew.map((e) => walkFromEntry(e, rule.familyId));
      for (const walk of generatedWalks) await repository.saveWalk(walk);
      finalEntries = [...finalEntries, ...trulyNew];
      finalWalks = [...finalWalks, ...generatedWalks];
    }

    // Activity reset deliberately preserves recurring schedule entries. That can
    // leave a valid today/future entry without its derived walk row. Treat that
    // as a repairable derived-data gap: Home renders walks, not bare entries.
    // Recreate only occurrences in the active horizon and only when no walk
    // already references the canonical schedule-entry id.
    const activeRules = rules.filter((rule) => rule.active);
    const activeRuleIds = new Set(activeRules.map((rule) => rule.id));
    const walkEntryIds = new Set(
      finalWalks.map((walk) => walk.scheduleEntryId).filter((id): id is string => Boolean(id))
    );
    const entryBelongsToActiveRule = (entry: ScheduleEntry): boolean => {
      if (entry.ruleId) return activeRuleIds.has(entry.ruleId);
      // Legacy/preserved schedule entries can predate rule_id linkage. They are
      // still canonical occurrences after Activity Reset, so recover them by
      // the active rule identity instead of dropping today's walk from Home.
      return activeRules.some((rule) => {
        const days = rule.daysOfWeek.length > 0 ? rule.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
        const day = new Date(`${entry.date}T00:00:00Z`).getUTCDay();
        return rule.dogId === entry.dogId && rule.time === entry.time && days.includes(day);
      });
    };
    const orphanFutureEntries = finalEntries.filter(
      (entry) =>
        entry.date >= today &&
        entry.date <= endDate &&
        entryBelongsToActiveRule(entry) &&
        !walkEntryIds.has(entry.id)
    );
    if (orphanFutureEntries.length > 0) {
      const repairedWalks = orphanFutureEntries.map((entry) => walkFromEntry(entry, familyId));
      if (repository.queueWalksForBackgroundSync) {
        await repository.queueWalksForBackgroundSync(repairedWalks);
      } else {
        for (const walk of repairedWalks) await repository.saveWalk(walk);
      }
      finalWalks = [...finalWalks, ...repairedWalks];
    }

    // P0 real-device self-heal: a rule edit made BEFORE 807e4db's
    // updateScheduleEntry/planRuleDaysReconciliation fix (or any other path
    // that changed schedule_rules.time without reconciling
    // schedule_entries) can have left entries permanently stuck at a stale
    // time, with no further rule edit ever correcting them. Runs on every
    // load — see planStaleRuleEntryReconciliation's own doc comment for the
    // exact per-(rule,date) semantics (mutate an open stale entry in
    // place; regenerate a fresh occurrence only when every existing entry
    // is already resolved AND the rule's time for that date hasn't passed
    // yet; never touch an already-resolved entry's recorded time).
    // Idempotent — a (rule, date) already correctly represented is a
    // complete no-op on every subsequent load.
    const staleReconciliation = planStaleRuleEntryReconciliation(
      activeRules,
      finalEntries,
      finalWalks,
      today,
      endDate,
      new Date(),
      () => generateId('entry')
    );
    if (staleReconciliation.toUpdate.length > 0) {
      for (const entry of staleReconciliation.toUpdate) {
        await repository.updateScheduleEntry(entry);
      }
      const staleUpdatedWalks: Walk[] = [];
      for (const entry of staleReconciliation.toUpdate) {
        const walk = finalWalks.find((w) => w.scheduleEntryId === entry.id);
        if (!walk || walk.status !== 'pending') continue;
        const updatedWalk: Walk = { ...walk, scheduledTime: entry.time, responsibleUserId: entry.responsibleUserId, updatedAt: new Date().toISOString() };
        await repository.saveWalk(updatedWalk);
        staleUpdatedWalks.push(updatedWalk);
      }
      finalEntries = finalEntries.map((e) => staleReconciliation.toUpdate.find((ue) => ue.id === e.id) ?? e);
      finalWalks = finalWalks.map((w) => staleUpdatedWalks.find((uw) => uw.id === w.id) ?? w);
    }
    if (staleReconciliation.toRegenerate.length > 0) {
      await repository.addScheduleEntries(staleReconciliation.toRegenerate);
      const regeneratedWalks = staleReconciliation.toRegenerate.map((e) => walkFromEntry(e, familyId));
      const todayRegeneratedWalks = regeneratedWalks.filter((w) => w.date === today);
      const futureRegeneratedWalks = regeneratedWalks.filter((w) => w.date !== today);
      for (const w of todayRegeneratedWalks) await repository.saveWalk(w);
      if (futureRegeneratedWalks.length > 0) {
        if (repository.queueWalksForBackgroundSync) {
          await repository.queueWalksForBackgroundSync(futureRegeneratedWalks);
        } else {
          for (const w of futureRegeneratedWalks) await repository.saveWalk(w);
        }
      }
      finalEntries = [...finalEntries, ...staleReconciliation.toRegenerate];
      finalWalks = [...finalWalks, ...regeneratedWalks];
    }

    // Once a later planned occurrence for the same dog is due, older
    // unresolved planned walks are no longer actionable questions. Close
    // them as "not done" so History contains final facts instead of an
    // ever-growing pending backlog. In-progress/unplanned walks are excluded
    // by the pure helper. Persist best-effort: every client derives the same
    // display state immediately, while an authorized online client also
    // makes the final status authoritative on the server.
    const reconciledWalks = finalizeSupersededPendingWalks(finalWalks, new Date());
    const autoSkipped = reconciledWalks.filter((walk) => {
      const before = finalWalks.find((candidate) => candidate.id === walk.id);
      return before?.status === 'pending' && walk.status === 'skipped';
    });
    finalWalks = reconciledWalks;
    set({ rules, entries: finalEntries, walks: finalWalks, loading: false });
    void Promise.allSettled(
      autoSkipped.map(async (walk) => {
        await repository.saveWalk(walk);
        await cancelWalkNotifications(walk.id);
      })
    );

    // Full reconciliation (A3): cancels anything stale for a
    // done/skipped/removed walk and (re)schedules everything still
    // pending from its CURRENT persisted data — not just "schedule the
    // pending ones", which would leave a stale notification alive for a
    // walk that is no longer pending after this reload.
    void reconcileScheduleNotifications(familyId, finalWalks);
    return true;
  } catch (e) {
    // Deliberately does NOT touch rules/entries/walks here — the previous,
    // still-displayed schedule stays visible rather than being wiped out
    // by a failed reload. Only `error`/`loading` change.
    // NOTE: intentionally NOT friendlyErrorMessage() here (unlike the
    // actionError sites below) — this field is the initial-load failure
    // banner, and existing callers/tests rely on the raw Error.message
    // surfacing unchanged (e.g. a real network failure reason), not a
    // substring-mapped/generic Hebrew fallback.
    set({ error: e instanceof Error ? e.message : 'שגיאה בטעינת התורנויות', loading: false });
    return false;
  }
}

export const useScheduleStore = create<ScheduleState>((set, get) => ({
  rules: [],
  entries: [],
  walks: [],
  loading: false,
  error: null,
  actionError: null,
  isStartingUnplannedWalk: false,

  load: async (familyId: string): Promise<boolean> => {
    // BUG FIX (duplicate schedule entries/walks): load() is called from
    // several independent, unsynchronized places — ScheduleScreen's mount
    // effect, RootNavigator's realtime-subscription callback, App.tsx's
    // runForegroundSync, requestsStore's reloadScheduleAndNotifications —
    // any of which can fire close together on a real device (app
    // foregrounding right as a screen mounts, or a realtime event landing
    // mid-navigation). Without a shared in-flight guard, two concurrent
    // calls each fetch the same stale rules/entries snapshot, each
    // independently decide the same rule "needs backfill", and each
    // generate + save their own entry/walk for the same dog/date/time — the
    // DB's unique(dog_id,date,time) constraint dedupes the schedule_entry
    // row, but each call's own distinct client-generated Walk id still gets
    // saved locally, producing a real, visible duplicate. Mirrors App.tsx's
    // runForegroundSync in-flight-promise guard, keyed by familyId so two
    // different families' loads never block on each other.
    const inFlight = loadPromiseByFamilyId[familyId];
    if (inFlight) return inFlight;
    const promise = loadScheduleForFamily(familyId, set);
    loadPromiseByFamilyId[familyId] = promise;
    try {
      return await promise;
    } finally {
      delete loadPromiseByFamilyId[familyId];
    }
  },

  addRule: async (rule: ScheduleRule) => {
    perfMark('A0 addRule entered');
    if (!guardTestModeMutation()) return;
    perfMark('A1 local validation complete');
    try {
      perfMark('A2 upsertScheduleRule start');
      await repository.upsertScheduleRule(rule);
      perfMark('A3 upsertScheduleRule complete');
      // Local calendar day, not UTC — `entries`/`walks` dates are the
      // family's local "today" (see dateFormat.ts), and a UTC-anchored
      // "today" would be wrong for a few hours after local midnight for
      // anyone ahead of UTC (e.g. Israel), generating a day-early entry.
      const today = localDateOnly(new Date());
      const endDate = localDateOnly(new Date(Date.now() + GENERATE_DAYS_AHEAD * 86400000));
      const newEntries = generateRotationSchedule(rule, today, endDate, () => generateId('entry'));
      perfMark('A4 addScheduleEntries start');
      await repository.addScheduleEntries(newEntries);
      perfMark('A6 addScheduleEntries complete (upsert + canonical-id readback)');

      const existingKeys = new Set(get().entries.map((e) => `${e.dogId}|${e.date}|${e.time}`));
      const trulyNew = newEntries.filter((e) => !existingKeys.has(`${e.dogId}|${e.date}|${e.time}`));
      const newWalks = trulyNew.map((e) => walkFromEntry(e, rule.familyId));
      // Real-device QA fix — "Save spinner lingers ~10s": this used to be
      // `for (const w of newWalks) await repository.saveWalk(w);` — up to
      // GENERATE_DAYS_AHEAD (14) SEQUENTIAL network round trips (each
      // saveWalk() itself up to two calls), measured at ~10s on a real
      // iPhone for a full-week rule. The rule itself and its schedule
      // entries (the two awaited calls above) are the only parts of this
      // save the person is actually watching; these generated FUTURE
      // occurrence walks are a derived background effect. See
      // queueWalksForBackgroundSync()'s own doc comment
      // (offlineFirstRepository.ts) for why this is a durable queue
      // handoff, never a bare fire-and-forget: both the local write and
      // the SyncQueue enqueue happen here, so the data survives a PWA
      // restart even if the opportunistic trySync() it kicks off hasn't
      // reached the server yet — exactly like any other queued offline
      // write already behaves. Falls back to the original sequential
      // await for any Repository implementation that doesn't provide
      // this optional method (none in production — repository is always
      // OfflineFirstRepository — only a hypothetical bare test double).
      perfMark(`A7 handing off ${newWalks.length} generated walks for background sync`);
      // Today's occurrence is immediately user-visible on Home. Persist it
      // authoritatively before returning so a foreground reload cannot replace
      // it with the still-stale remote snapshot while the background queue is
      // catching up. Future occurrences remain safe to hand off in bulk.
      const todayWalks = newWalks.filter((w) => w.scheduleEntryId && trulyNew.some((e) => e.id === w.scheduleEntryId && e.date === today));
      const futureWalks = newWalks.filter((w) => !w.scheduleEntryId || !trulyNew.some((e) => e.id === w.scheduleEntryId && e.date === today));
      for (const w of todayWalks) await repository.saveWalk(w);
      if (futureWalks.length > 0) {
        if (repository.queueWalksForBackgroundSync) {
          await repository.queueWalksForBackgroundSync(futureWalks);
        } else {
          for (const w of futureWalks) await repository.saveWalk(w);
        }
      }
      perfMark('A8 generated walks persisted/queued');

      set((s) => {
        // saveWalk() may replace a freshly generated local walk id with the
        // canonical server id when this occurrence already exists remotely.
        // Never append that canonical occurrence beside the stale/local copy:
        // one schedule_entry_id represents exactly one planned walk.
        const newEntryIds = new Set(trulyNew.map((entry) => entry.id));
        const newWalkIds = new Set(newWalks.map((walk) => walk.id));
        const newWalkEntryIds = new Set(
          newWalks.map((walk) => walk.scheduleEntryId).filter((id): id is string => Boolean(id))
        );
        return {
          rules: [...s.rules.filter((r) => r.id !== rule.id), rule],
          entries: [
            ...s.entries.filter(
              (entry) =>
                !newEntryIds.has(entry.id) &&
                !trulyNew.some(
                  (fresh) => fresh.dogId === entry.dogId && fresh.date === entry.date && fresh.time === entry.time
                )
            ),
            ...trulyNew,
          ],
          walks: [
            ...s.walks.filter(
              (walk) =>
                !newWalkIds.has(walk.id) &&
                !(walk.scheduleEntryId && newWalkEntryIds.has(walk.scheduleEntryId))
            ),
            ...newWalks,
          ],
          actionError: null,
        };
      });
      newWalks.forEach((w) => void scheduleNotificationsForWalk(w));
      perfMark('A11 addRule returning (success)');
    } catch (e) {
      // A thrown error here (storage failure, bad data, etc.) must never
      // leave the new rule invisible with no explanation — surface it the
      // same way every other schedule action in this store does.
      // BUG FIX: offlineFirstRepository.saveWalk() deliberately rethrows a
      // PERMANENT sync failure as the raw Postgrest error object it got
      // from supabase-js — a plain {message,details,hint,code}, NOT an
      // `instanceof Error`. The old `e instanceof Error ? e.message :
      // '<generic fallback>'` check here always took the generic branch for
      // exactly that case, discarding the one piece of information (the
      // real Postgres/RLS rejection reason) that would let anyone diagnose
      // why the add failed. friendlyErrorMessage()'s own rawMessageOf()
      // already handles both shapes.
      //
      // Real-device QA fix: a duplicate-active-rule constraint violation
      // (see isDuplicateActiveScheduleRuleError's own doc comment above)
      // means this exact time slot already exists — most likely a racing
      // duplicate of a call that already succeeded. Reload from the
      // server and report success; never show a scary "couldn't add"
      // error for a save whose end state is already correct.
      if (isDuplicateActiveScheduleRuleError(e)) {
        perfMark('A9 load() start (duplicate-constraint recovery path)');
        await get().load(rule.familyId);
        perfMark('A10 load() complete');
        set({ actionError: null });
        perfMark('A11 addRule returning (duplicate-constraint recovery)');
        return;
      }
      perfMark('A11 addRule returning (error)');
      set({ actionError: friendlyErrorMessage(e, [], 'לא הצלחנו להוסיף את שעת הטיול') });
    }
  },

  /**
   * Edits a time slot's time/label/rotation/days. Past and already-executed
   * occurrences are left untouched; only still-pending future occurrences
   * (today included) are regenerated against the new rule — this is what
   * "change the default time without losing history" means in practice.
   *
   * If `daysOfWeek` itself changes, this also reconciles which days have
   * entries at all: a day dropped from the rule has its still-pending
   * future entries/walks removed (a disabled day must stop showing and
   * reminding — e.g. an admin turning off Saturday for Shabbat), and a day
   * newly added to the rule gets entries generated for it within the same
   * window `addRule`/`load` use, instead of silently waiting up to
   * `GENERATE_DAYS_AHEAD` days for the rule's entries to run out. See
   * `planRuleDaysReconciliation` (logic/rotation.ts) for why this is scoped
   * to just-changed days rather than every matching day.
   */
  updateRule: async (ruleId, patch) => {
    if (!guardTestModeMutation()) return;
    const rule = get().rules.find((r) => r.id === ruleId);
    if (!rule) return;
    try {
      const updatedRule: ScheduleRule = { ...rule, ...patch };
      await repository.upsertScheduleRule(updatedRule);

      // Local calendar day, not UTC — `entries`/`walks` dates are the
      // family's local "today" (see dateFormat.ts), and a UTC-anchored
      // "today" would be wrong for a few hours after local midnight for
      // anyone ahead of UTC (e.g. Israel), generating a day-early entry.
      const today = localDateOnly(new Date());
      const endDate = localDateOnly(new Date(Date.now() + GENERATE_DAYS_AHEAD * 86400000));
      // P0 real-device fix: `get().walks` lets planRuleDaysReconciliation
      // tell a freely-mutable entry (pending, or no walk yet) apart from a
      // LOCKED one (done/in_progress/skipped) per date — see its own doc
      // comment. Without this, a rule time edit after today's occurrence
      // was already completed either silently rewrote that completed
      // walk's historical time, or (since the walk-side update below only
      // ever touches 'pending' walks) left the entry and its done walk
      // disagreeing on time with no new actionable occurrence for today at
      // all — exactly the real-device symptom this fixes.
      const { toRemove, toUpdate, toAdd, toRegenerate } = planRuleDaysReconciliation(
        rule,
        updatedRule,
        get().entries,
        today,
        endDate,
        () => generateId('entry'),
        get().walks
      );

      // Days dropped from the rule: only a still-pending occurrence is
      // actually removed (its entry + walk, via FK cascade) — matches
      // deleteRule's own history-preserving behavior for a done/skipped
      // walk's entry.
      const removedEntryIds = new Set<string>();
      for (const entry of toRemove) {
        const walk = get().walks.find((w) => w.scheduleEntryId === entry.id);
        if (walk && walk.status === 'pending') {
          await cancelWalkNotifications(walk.id);
          await repository.deleteScheduleEntry(entry.id);
          removedEntryIds.add(entry.id);
        }
      }

      for (const entry of toUpdate) {
        await repository.updateScheduleEntry(entry);
      }
      const updatedWalks: Walk[] = [];
      for (const entry of toUpdate) {
        const walk = get().walks.find((w) => w.scheduleEntryId === entry.id);
        if (!walk || walk.status !== 'pending') continue;
        const updatedWalk: Walk = { ...walk, scheduledTime: entry.time, responsibleUserId: entry.responsibleUserId, updatedAt: new Date().toISOString() };
        await repository.saveWalk(updatedWalk);
        updatedWalks.push(updatedWalk);
      }

      // Days newly added to the rule, OR a date whose only existing
      // entry is locked by an already-resolved walk (toRegenerate — see
      // planRuleDaysReconciliation's doc comment): generate entries/walks
      // for them now, same as addRule. Real-device QA fix — same
      // deferred-background handoff as addRule() uses for its own newly
      // generated walks (see that function's own comment and
      // queueWalksForBackgroundSync()'s doc comment in
      // offlineFirstRepository.ts): a rule edit that adds several days
      // back would otherwise hit the exact same sequential-network-
      // round-trips bottleneck this fix targets. The OLD (locked) entry
      // and its already-resolved walk are never touched — they remain
      // exactly as they were, preserved as history.
      const allNewEntries = [...toAdd, ...toRegenerate];
      if (allNewEntries.length > 0) await repository.addScheduleEntries(allNewEntries);
      const newWalks = allNewEntries.map((e) => walkFromEntry(e, updatedRule.familyId));
      const todayNewWalks = newWalks.filter((w) => w.scheduleEntryId && allNewEntries.some((e) => e.id === w.scheduleEntryId && e.date === today));
      const futureNewWalks = newWalks.filter((w) => !w.scheduleEntryId || !allNewEntries.some((e) => e.id === w.scheduleEntryId && e.date === today));
      for (const w of todayNewWalks) await repository.saveWalk(w);
      if (futureNewWalks.length > 0) {
        if (repository.queueWalksForBackgroundSync) {
          await repository.queueWalksForBackgroundSync(futureNewWalks);
        } else {
          for (const w of futureNewWalks) await repository.saveWalk(w);
        }
      }

      set((s) => ({
        rules: s.rules.map((r) => (r.id === ruleId ? updatedRule : r)),
        entries: [
          ...s.entries.filter((e) => !removedEntryIds.has(e.id)).map((e) => toUpdate.find((ue) => ue.id === e.id) ?? e),
          ...allNewEntries,
        ],
        walks: [
          ...s.walks
            .filter((w) => !(w.scheduleEntryId && removedEntryIds.has(w.scheduleEntryId)))
            .map((w) => updatedWalks.find((uw) => uw.id === w.id) ?? w),
          ...newWalks,
        ],
        actionError: null,
      }));
      updatedWalks.forEach((w) => void scheduleNotificationsForWalk(w));
      newWalks.forEach((w) => void scheduleNotificationsForWalk(w));
    } catch (e) {
      set({ actionError: friendlyErrorMessage(e, [], 'לא הצלחנו לעדכן את שעת הטיול') });
    }
  },

  /** Deletes a time slot. Future not-yet-done occurrences disappear from the schedule; history is kept. */
  deleteRule: async (ruleId: string) => {
    if (!guardTestModeMutation()) return;
    try {
      const { entries, walks } = get();
      const removedEntryIds = new Set(entries.filter((e) => e.ruleId === ruleId).map((e) => e.id));

      if (isSupabaseConfigured) {
        // One server transaction owns the FK-sensitive delete ordering.
        await deleteScheduleRuleWithOccurrences(ruleId);
      } else {
        const today = localDateOnly(new Date());
        const futureEntries = entries.filter((e) => e.ruleId === ruleId && e.date >= today);
        for (const entry of futureEntries) {
          const walk = walks.find((w) => w.scheduleEntryId === entry.id);
          if (walk?.status === 'pending') await repository.deleteWalk?.(walk.id);
          await repository.deleteScheduleEntry(entry.id);
        }
        await repository.deleteScheduleRule(ruleId);
      }

      set((s) => ({
        rules: s.rules.filter((r) => r.id !== ruleId),
        entries: s.entries.filter((e) => !removedEntryIds.has(e.id)),
        walks: s.walks.filter((w) => !(w.scheduleEntryId && removedEntryIds.has(w.scheduleEntryId) && w.status === 'pending')),
        actionError: null,
      }));
    } catch (e) {
      set({ actionError: friendlyErrorMessage(e, [], 'לא הצלחנו למחוק את שעת הטיול') });
    }
  },

  reorderRules: async (orderedRuleIds: string[]) => {
    if (!guardTestModeMutation()) return;
    try {
      const { rules } = get();
      const updated: ScheduleRule[] = [];
      orderedRuleIds.forEach((id, index) => {
        const rule = rules.find((r) => r.id === id);
        if (rule && rule.sortOrder !== index) updated.push({ ...rule, sortOrder: index });
      });
      for (const rule of updated) await repository.upsertScheduleRule(rule);
      set((s) => ({ rules: s.rules.map((r) => updated.find((ur) => ur.id === r.id) ?? r), actionError: null }));
    } catch (e) {
      set({ actionError: friendlyErrorMessage(e, [], 'לא הצלחנו לשנות את סדר השעות') });
    }
  },

  /**
   * Moves a single occurrence to a different time, without touching the
   * rule or any other day.
   *
   * BATCH 3 (Task 6 — direct admin time edit): this action is only ever
   * reached from the admin-only EditWalkModal (HomeScreen.tsx gates
   * `onEdit`/`onChangeTime` on `effectiveRole === 'admin'`; a member gets
   * `onRequestTimeChange` — the request/approval flow — instead, see
   * logic/walkActions.ts's canRequestChangeForWalk). So in Supabase mode
   * this is always a Family Admin DIRECT edit, never a request. It is now
   * routed through the server-authoritative admin_reschedule_walk RPC
   * (migration 0026) FIRST, before any local write: that RPC is where
   * authorization is actually enforced (is_family_admin() — never a
   * client-supplied flag, and already false while impersonating), where
   * the schedule_entries time-collision check happens, and where the
   * walk_admin_rescheduled audit event is written. A rejection there (not
   * an admin, walk no longer pending, time collision, ...) throws and is
   * caught below exactly like any other action error in this store — no
   * local state is touched on failure.
   *
   * CORRECTED (Batch 3 correction #3, post-review): admin_reschedule_walk
   * (migration 0026) already updates BOTH walks.scheduled_time and the
   * linked schedule_entries.time server-side, collision-checked and
   * audited, in one transaction. The original Batch 3 version of this
   * action then ALSO ran repository.saveWalk()/repository.updateScheduleEntry()
   * unconditionally afterward — in Supabase mode that was a second, raw
   * client mutation of the exact same rows through
   * enforce_walk_write_authorization() again: redundant when it also
   * succeeded, and a real risk of a split outcome when it didn't (the RPC's
   * server-side change had already happened, but the UI would still report
   * failure because this second write failed). So the RPC is now the SOLE
   * authoritative server mutation in Supabase mode: once it resolves, this
   * action only synchronizes local Zustand state (`set()` below) — no
   * second network write of data the RPC already wrote.
   *
   * Local/demo mode (no Supabase configured, adminRescheduleWalk() never
   * called) is UNCHANGED from before this correction: repository.saveWalk()
   * + repository.updateScheduleEntry() remain the one and only mutation
   * there, exactly as they always were — there is no server RPC to defer to
   * in that mode, so the local repository write is still the authoritative
   * one, keeping this action fully usable offline/in demo mode and keeping
   * scheduleNotificationsForWalk / reconcileScheduleNotifications working
   * unchanged (they read from this store's own `walks`, not from the
   * server).
   *
   * Either branch: a rejection (not an admin, walk no longer pending, time
   * collision, a local repository failure, ...) throws and is caught below
   * exactly like any other action error in this store, BEFORE the `set()`
   * call — so local state is never optimistically left at the new time on
   * failure.
   */
  rescheduleWalk: async (walkId: string, newTime: string) => {
    if (!guardTestModeMutation()) return;
    const walk = get().walks.find((w) => w.id === walkId);
    if (!walk) return;
    try {
      if (walk.status !== 'pending') throw new WalkActionError('אפשר לשנות שעה רק לטיול שממתין');

      const updatedWalk: Walk = { ...walk, scheduledTime: newTime, updatedAt: new Date().toISOString() };

      if (isSupabaseConfigured) {
        // admin_reschedule_walk (0026) is the SOLE authoritative write here
        // — it already updates walks.scheduled_time AND the linked
        // schedule_entries.time server-side. No second raw
        // repository.saveWalk()/updateScheduleEntry() call follows it; only
        // local state is synchronized once it succeeds.
        await adminRescheduleWalk(walkId, newTime);
      } else {
        // Local/demo mode: no RPC exists to defer to (adminRescheduleWalk
        // would throw SupabaseNotConfiguredError) — the repository mutation
        // IS the authoritative write here, unchanged from before this
        // correction.
        await repository.saveWalk(updatedWalk);
        if (walk.scheduleEntryId) {
          const entry = get().entries.find((e) => e.id === walk.scheduleEntryId);
          // P0 FIX: mark this entry as a deliberate one-off override — see
          // ScheduleEntry.timeOverridden's doc comment. Without this,
          // planStaleRuleEntryReconciliation() (src/logic/rotation.ts),
          // which runs on every schedule load, could not tell this edit
          // apart from a stale pre-807e4db leftover and silently reverted
          // it back to the rule's time on the very next load.
          if (entry) await repository.updateScheduleEntry({ ...entry, time: newTime, timeOverridden: true });
        }
      }

      set((s) => ({
        walks: s.walks.map((w) => (w.id === walkId ? updatedWalk : w)),
        entries: s.entries.map((e) => (e.id === walk.scheduleEntryId ? { ...e, time: newTime, timeOverridden: true } : e)),
        actionError: null,
      }));
      await scheduleNotificationsForWalk(updatedWalk);
    } catch (e) {
      set({
        actionError:
          e instanceof WalkActionError ? e.message : e instanceof Error ? friendlyErrorMessage(e) : 'לא הצלחנו לשנות את השעה',
      });
    }
  },

  deleteEntry: async (entryId: string) => {
    if (!guardTestModeMutation()) return;
    const walk = get().walks.find((w) => w.scheduleEntryId === entryId);
    if (walk) await cancelWalkNotifications(walk.id);
    await repository.deleteScheduleEntry(entryId);
    set((s) => ({
      entries: s.entries.filter((e) => e.id !== entryId),
      walks: s.walks.filter((w) => w.scheduleEntryId !== entryId),
    }));
  },

  startWalk: async (walkId: string) => {
    if (!guardTestModeMutation()) return false;
    const walk = get().walks.find((w) => w.id === walkId);
    if (!walk) return false;
    // Defense in depth: the Home button is disabled before this point, but
    // no other caller may start a planned walk more than 30 minutes early.
    // Unplanned/spontaneous walks are intentionally exempt.
    if (!walk.isUnplanned && walk.status === 'pending') {
      const scheduledAt = new Date(`${walk.date}T${walk.scheduledTime}:00`).getTime();
      const unlockAt = scheduledAt - 30 * 60 * 1000;
      if (Number.isFinite(unlockAt) && Date.now() < unlockAt) {
        const unlock = new Date(unlockAt);
        const hh = String(unlock.getHours()).padStart(2, '0');
        const mm = String(unlock.getMinutes()).padStart(2, '0');
        set({ actionError: `ניתן להתחיל את הטיול החל מ־${hh}:${mm}` });
        return false;
      }
    }
    // Real-device QA fix — if an EARLIER background sync for this exact
    // walk (e.g. loadScheduleForFamily's orphan-walk-repair, which calls
    // queueWalksForBackgroundSync() without waiting for the server write to
    // actually land) was permanently rejected, SyncQueue drops it and
    // records a conflict instead of retrying forever (see syncQueue.ts's
    // isPermanentSyncError doc comment). markDone() below already
    // established this exact check (see its own doc comment) for the
    // equivalent saveWalk case; this is the same check for startWalk,
    // proactive rather than after-the-fact since there is no optimistic
    // local write to protect here.
    //
    // P0 FOLLOW-UP: a `23505` (unique_violation) conflict specifically
    // means a walk for this schedule_entry_id already exists server-side
    // under a DIFFERENT id — not an unrecoverable state. OfflineFirstRepo
    // sitory.startWalk's resolveCanonicalWalkId now reconciles exactly
    // this case (finds the canonical row, adopts its id, retries) before
    // ever calling start_walk, so a 23505 conflict is deliberately let
    // through to that normal path instead of being hard-blocked here. Any
    // OTHER recorded code (RLS rejection, a business-rule raise, etc.) is
    // not something id-reconciliation can fix, so those still stop here.
    const startConflict = await repository.getConflictForWalk?.(walkId);
    if (startConflict && startConflict.code !== '23505') {
      set({
        actionError: appendRawDiagnostic(
          'הטיול הזה לא נשמר בהצלחה בשרת בעבר ולכן אי אפשר להתחיל אותו. רעננו את המסך ונסו שוב — אם זה חוזר, יש לדווח לתמיכה.',
          { message: startConflict.message, code: startConflict.code },
          { walkId, conflictFailedAt: startConflict.failedAt }
        ),
      });
      return false;
    }
    try {
      let updated: Walk;
      if (repository.startWalk) updated = await repository.startWalk(walkId);
      else updated = { ...walk, status: 'in_progress', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      set((s) => ({ walks: s.walks.map((w) => (w.id === walkId ? updated : w)), actionError: null }));
      await cancelWalkNotifications(walkId);
      // Phase 4 (GPS foundation, PRD §7): best-effort, fire-and-forget —
      // GPS is assistive, never a precondition for the walk lifecycle
      // itself (permission denial/unavailability must never fail or delay
      // Start). See gpsStore.startTracking's own doc comment.
      void useGpsStore.getState().startTracking(updated);
      return true;
    } catch (e) {
      // TEMPORARY P0 DIAGNOSTIC — real-device QA: "Start" failed on a real
      // iPhone PWA with only the generic Hebrew fallback below, which hid
      // the actual server rejection. console.error the full raw error here
      // (this call site previously logged nothing at all, despite
      // errorMessages.ts's own doc comment claiming every call site does).
      // See appendRawDiagnostic's doc comment for why the shown message
      // also gets the raw code/message/details/hint appended, but ONLY
      // when friendlyErrorMessage() still fell through to the generic
      // fallback — a rule that already matched means the real reason is
      // already known and shown, so there is nothing to add.
      console.error('[startWalk] failed', { walkId, localStatus: walk.status, responsibleUserId: walk.responsibleUserId, error: e });
      const fallback = 'לא הצלחנו להתחיל את הטיול';
      const friendly = friendlyErrorMessage(e, [], fallback);
      const shown = friendly === fallback
        ? appendRawDiagnostic(friendly, e, { walkId, localStatus: walk.status, responsibleUserId: walk.responsibleUserId })
        : friendly;
      set({ actionError: shown });
      return false;
    }
  },

  finishWalk: async (walkId: string, completedByUserId: string, details: WalkCompletionDetails = {}) => {
    if (!guardTestModeMutation()) return false;
    const walk = get().walks.find((w) => w.id === walkId);
    if (!walk) return false;
    try {
      let updated: Walk;
      if (repository.finishWalk) updated = await repository.finishWalk(walkId, completedByUserId, details);
      else updated = markWalkDone(walk, completedByUserId, details);
      set((s) => ({ walks: s.walks.map((w) => (w.id === walkId ? updated : w)), actionError: null }));
      await cancelWalkNotifications(walkId);
      // Best-effort, mirrors startWalk above — stops tracking (a no-op if
      // this walk was never being tracked) and persists whatever distance
      // was captured.
      void useGpsStore.getState().stopTracking(updated, completedByUserId);
      return true;
    } catch (e) {
      set({ actionError: friendlyErrorMessage(e, [], 'לא הצלחנו לסיים את הטיול') });
      return false;
    }
  },

  markDone: async (walkId: string, completedByUserId: string, details: WalkCompletionDetails = {}) => {
    if (!guardTestModeMutation()) return false;
    const walk = get().walks.find((w) => w.id === walkId);
    if (!walk) return false;
    try {
      const updated = markWalkDone(walk, completedByUserId, details);
      // Optimistic update so the Home screen reflects it within the "few seconds" UX goal.
      set((s) => ({ walks: s.walks.map((w) => (w.id === walkId ? updated : w)), actionError: null }));
      await repository.saveWalk(updated);
      await cancelWalkNotifications(walkId);
      // markDone is the "✓ סמן כבוצע" fallback path someone might use
      // instead of the formal "סיים טיול" action — stop tracking here too
      // (a no-op if this walk was never being tracked, e.g. it was marked
      // done without ever being started) so a GPS watch started via
      // startWalk can never keep running past a walk that's already done.
      void useGpsStore.getState().stopTracking(updated, completedByUserId);

      // A2 fix: OfflineFirstRepository.saveWalk() never throws even when the
      // remote write ultimately failed — it always writes locally first
      // (so the app stays usable offline) and pushes to the server
      // best-effort via the SyncQueue, which swallows failures internally
      // (retryable ones stay queued for the next sync; permanent ones are
      // recorded as a conflict and dropped — see syncQueue.ts). Naively
      // refetching from the server right after `saveWalk()` resolved used to
      // silently REVERT the optimistic "done" state back to whatever the
      // server still had — with no error shown — whenever that write hadn't
      // actually landed yet (a slow/transient network, or a permanent
      // conflict). That is the concrete "completion not syncing correctly"
      // bug: the checkmark would flash and then disappear.
      //
      // Fix: only trust a server refetch once we know THIS walk's write has
      // actually been resolved (succeeded or permanently failed) — i.e. it
      // is no longer sitting in the queue. While it's still queued
      // (retryable network failure), keep the optimistic local state as-is;
      // it will reconcile correctly on the next successful sync. If it was
      // dropped as a permanent conflict, surface that as a real failure
      // instead of silently presenting the reverted state as success.
      const stillPending = await repository.hasPendingSaveWalk?.(walkId);
      if (stillPending) {
        return true; // locally saved and queued; keep the optimistic completion intact
      }

      const conflict = await repository.getConflictForWalk?.(walkId);
      if (conflict) {
        // Revert the optimistic update — the server rejected the write —
        // and tell the user, rather than silently showing it as done.
        set((s) => ({
          walks: s.walks.map((w) => (w.id === walkId ? walk : w)),
          actionError: 'לא הצלחנו לשמור את הסימון בשרת. נסו לרענן ולסמן שוב.',
        }));
        return false;
      }

      // Write is confirmed resolved (synced, or there was never a remote to
      // begin with) — now it's safe to re-sync from the repository in case a
      // concurrent completion by another family member won the race (see
      // repository.saveWalk docs).
      const fresh = await repository.getWalks(walk.familyId);
      set({ walks: fresh });
      return true;
    } catch (e) {
      set({ actionError: e instanceof WalkActionError ? e.message : 'לא הצלחנו לסמן את הטיול כבוצע' });
      return false;
    }
  },

  editDoneDetails: async (walkId: string, details: WalkCompletionDetails) => {
    if (!guardTestModeMutation()) return;
    const walk = get().walks.find((w) => w.id === walkId);
    if (!walk) return;
    try {
      const updated = editWalkDetails(walk, details);
      set((s) => ({ walks: s.walks.map((w) => (w.id === walkId ? updated : w)), actionError: null }));
      await repository.saveWalk(updated);
    } catch (e) {
      set({ actionError: e instanceof WalkActionError ? e.message : 'לא הצלחנו לעדכן את פרטי הטיול' });
    }
  },

  skip: async (walkId: string) => {
    if (!guardTestModeMutation()) return;
    const walk = get().walks.find((w) => w.id === walkId);
    if (!walk) return;
    try {
      const updated = markWalkSkipped(walk);
      set((s) => ({ walks: s.walks.map((w) => (w.id === walkId ? updated : w)), actionError: null }));
      await repository.saveWalk(updated);
      await cancelWalkNotifications(walkId);
    } catch (e) {
      set({ actionError: e instanceof WalkActionError ? e.message : 'לא הצלחנו לדלג על הטיול' });
    }
  },

  swap: async (walkId: string, newUserId: string, swappedByUserId: string) => {
    if (!guardTestModeMutation()) return;
    const walk = get().walks.find((w) => w.id === walkId);
    if (!walk) return;
    try {
      const updated = swapWalkPure(walk, newUserId, swappedByUserId);
      set((s) => ({ walks: s.walks.map((w) => (w.id === walkId ? updated : w)), actionError: null }));
      await repository.saveWalk(updated);
      await scheduleNotificationsForWalk(updated);
    } catch (e) {
      set({ actionError: e instanceof WalkActionError ? e.message : 'לא הצלחנו להחליף את התור' });
    }
  },

  /**
   * Real two-way exchange between two specific walks. Keep BOTH execution
   * rows (`walks`) and their backing schedule occurrences (`schedule_entries`)
   * in sync, otherwise a later reload/backfill can re-assert the old owner on
   * one side of the exchange. The offline-first repository persists each
   * changed entry/walk locally immediately and queues the same writes for the
   * server, so the four writes converge together when connectivity returns.
   */
  swapTwoWalks: async (walkAId: string, walkBId: string, swappedByUserId: string) => {
    if (!guardTestModeMutation()) return;
    const before = get();
    const walkA = before.walks.find((w) => w.id === walkAId);
    const walkB = before.walks.find((w) => w.id === walkBId);
    if (!walkA || !walkB) return;

    const entryA = walkA.scheduleEntryId ? before.entries.find((e) => e.id === walkA.scheduleEntryId) : undefined;
    const entryB = walkB.scheduleEntryId ? before.entries.find((e) => e.id === walkB.scheduleEntryId) : undefined;

    try {
      const [updatedA, updatedB] = swapWalksMutual(walkA, walkB, swappedByUserId);
      const updatedEntryA = entryA ? { ...entryA, responsibleUserId: updatedA.responsibleUserId } : undefined;
      const updatedEntryB = entryB ? { ...entryB, responsibleUserId: updatedB.responsibleUserId } : undefined;

      if (isSupabaseConfigured) {
        // admin_swap_walks (0031) is the sole authoritative Supabase write.
        // It exchanges both walk owners and both linked schedule entries in
        // one server transaction. Do not follow it with raw repository writes.
        await adminSwapWalks(walkAId, walkBId);
      } else {
        // Local/demo mode has no RPC, so preserve the repository behavior.
        if (updatedEntryA) await repository.updateScheduleEntry(updatedEntryA);
        if (updatedEntryB) await repository.updateScheduleEntry(updatedEntryB);
        await repository.saveWalk(updatedA);
        await repository.saveWalk(updatedB);
      }

      set((s) => ({
        walks: s.walks.map((w) => (w.id === walkAId ? updatedA : w.id === walkBId ? updatedB : w)),
        entries: s.entries.map((e) =>
          updatedEntryA && e.id === updatedEntryA.id ? updatedEntryA : updatedEntryB && e.id === updatedEntryB.id ? updatedEntryB : e
        ),
        actionError: null,
      }));

      await scheduleNotificationsForWalk(updatedA);
      await scheduleNotificationsForWalk(updatedB);
    } catch (e) {
      // Revert only the two specific walks/entries back to their pre-swap
      // values, merged against whatever the CURRENT state is — never a raw
      // overwrite of the whole `walks`/`entries` arrays from the `before`
      // closure. A realtime reload (see src/lib/realtime.ts) can land
      // between the snapshot above and this catch firing (e.g. another
      // family member's device marks an unrelated walk done while this
      // RPC is in flight), and that legitimate concurrent update must not
      // be silently discarded. Every sibling action in this file (markDone,
      // skip, swap, editDoneDetails) already reverts this way; this was the
      // one outlier.
      set((s) => ({
        walks: s.walks.map((w) => (w.id === walkAId ? walkA : w.id === walkBId ? walkB : w)),
        entries: s.entries.map((e) =>
          entryA && e.id === entryA.id ? entryA : entryB && e.id === entryB.id ? entryB : e
        ),
        actionError:
          e instanceof WalkActionError
            ? e.message
            : e instanceof Error
              ? friendlyErrorMessage(e)
              : 'לא הצלחנו להחליף בין הטיולים',
      }));
    }
  },

  /** Logs a walk that already happened with no prior plan — never touches the rotation. */
  addUnplannedWalk: async (input: UnplannedWalkInput) => {
    if (!guardTestModeMutation()) return false;
    const now = new Date().toISOString();
    const completedAt = new Date(`${input.date}T${input.time}:00`).toISOString();
    const walk: Walk = {
      id: generateId('walk'),
      familyId: input.familyId,
      dogId: input.dogId,
      date: input.date,
      scheduledTime: input.time,
      responsibleUserId: input.performedByUserId,
      status: 'done',
      completedAt,
      completedByUserId: input.performedByUserId,
      hadPee: input.hadPee,
      hadPoop: input.hadPoop,
      note: input.note,
      durationMinutes: input.durationMinutes,
      isUnplanned: true,
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ walks: [...s.walks, walk], actionError: null }));
    try {
      await repository.saveWalk(walk);
      return true;
    } catch (e) {
      set((s) => ({ walks: s.walks.filter((w) => w.id !== walk.id), actionError: 'לא הצלחנו לשמור את הטיול' }));
      return false;
    }
  },

  startUnplannedWalk: async (familyId: string, dogId: string, userId: string) => {
    if (!guardTestModeMutation()) return false;
    // A second tap can arrive before the first async save has created its
    // in-progress row. Keep this client-side guard until the action settles.
    if (get().isStartingUnplannedWalk) return false;
    set({ isStartingUnplannedWalk: true });
    try {
      const now = new Date().toISOString();
      const walk: Walk = {
        id: generateId('walk'),
        familyId,
        dogId,
        date: localDateOnly(new Date()),
        scheduledTime: pickerDateToTime(new Date()),
        responsibleUserId: userId,
        status: 'pending',
        isUnplanned: true,
        createdAt: now,
        updatedAt: now,
      };
    // Optimistic, like addUnplannedWalk above — reverted below if the
    // initial save fails. startWalk() (called next) does its own
    // optimistic update/rollback for the pending->in_progress step, so
    // this action only owns getting the new row to exist at all.
      set((s) => ({ walks: [...s.walks, walk], actionError: null }));
      try {
        await repository.saveWalk(walk);
      } catch (e) {
        set((s) => ({ walks: s.walks.filter((w) => w.id !== walk.id), actionError: 'לא הצלחנו להתחיל את הטיול' }));
        return false;
      }
      const started = await get().startWalk(walk.id);
      if (!started) {
      // startWalk() already set its own actionError (e.g. offline —
      // startWalk/finishWalk are server-authoritative RPCs with no blind
      // offline replay, same as a scheduled walk). Remove the now-orphaned
      // pending row rather than leaving a phantom walk that would compete
      // with the real next-scheduled-walk card — best-effort; if this also
      // fails, the member can still remove it manually like any other
      // unplanned walk (deleteUnplannedWalk).
        try {
          await repository.deleteWalk?.(walk.id);
        } catch {
          // Already-surfaced actionError from startWalk() above stands.
        }
        set((s) => ({ walks: s.walks.filter((w) => w.id !== walk.id) }));
      }
      return started;
    } finally {
      set({ isStartingUnplannedWalk: false });
    }
  },

  editUnplannedWalk: async (walkId, patch) => {
    if (!guardTestModeMutation()) return;
    const walk = get().walks.find((w) => w.id === walkId);
    if (!walk) return;
    if (!walk.isUnplanned) {
      set({ actionError: 'אפשר לערוך כך רק טיול ספונטני' });
      return;
    }
    const updated: Walk = { ...walk, ...patch, updatedAt: new Date().toISOString() };
    set((s) => ({ walks: s.walks.map((w) => (w.id === walkId ? updated : w)), actionError: null }));
    try {
      await repository.saveWalk(updated);
    } catch (e) {
      // Revert the optimistic update on failure, same pattern as every
      // other mutating action in this store.
      set((s) => ({ walks: s.walks.map((w) => (w.id === walkId ? walk : w)), actionError: 'לא הצלחנו לעדכן את הטיול הספונטני' }));
    }
  },

  deleteUnplannedWalk: async (walkId) => {
    if (!guardTestModeMutation()) return;
    const walk = get().walks.find((w) => w.id === walkId);
    if (!walk) return;
    if (!walk.isUnplanned) {
      set({ actionError: 'אפשר למחוק כך רק טיול ספונטני' });
      return;
    }
    set((s) => ({ walks: s.walks.filter((w) => w.id !== walkId), actionError: null }));
    try {
      await repository.deleteWalk?.(walkId);
    } catch (e) {
      // Restore the walk locally — the delete didn't actually succeed.
      set((s) => ({ walks: [...s.walks, walk], actionError: 'לא הצלחנו למחוק את הטיול הספונטני' }));
    }
  },

  deleteScheduledWalkOccurrence: async (walkId) => {
    if (!guardTestModeMutation()) return;
    const walk = get().walks.find((w) => w.id === walkId);
    if (!walk) return;
    if (walk.isUnplanned) {
      // Wrong door — an unplanned walk has its own deleteUnplannedWalk
      // above, matching editUnplannedWalk's identical guard shape.
      set({ actionError: 'אפשר למחוק כך רק טיול מתוכנן' });
      return;
    }
    if (walk.status !== 'done' && walk.status !== 'skipped') {
      set({ actionError: 'אפשר למחוק רק טיול שהסתיים' });
      return;
    }
    set((s) => ({ walks: s.walks.filter((w) => w.id !== walkId), actionError: null }));
    try {
      // Deliberately reuses the SAME repository.deleteWalk?.() every layer
      // (local/offline-first/Supabase/syncQueue) already implements for
      // deleteUnplannedWalk — the only thing distinguishing this from that
      // path is server-side authorization (migration 0015's new DELETE
      // branch), not a different client-side mechanism.
      await repository.deleteWalk?.(walkId);
    } catch (e) {
      // Restore the walk locally — the delete didn't actually succeed
      // (most commonly: the DB trigger rejected it, e.g. the walk was
      // reassigned to someone else between this screen loading and the
      // delete being attempted).
      set((s) => ({ walks: [...s.walks, walk], actionError: 'לא הצלחנו למחוק את הטיול' }));
    }
  },

  clearActionError: () => set({ actionError: null }),
}));
