import { create } from 'zustand';
import type { ScheduleEntry, ScheduleRule, UnplannedWalkInput, Walk } from '../types';
import { repository } from '../data';
import { generateRotationSchedule, resolveResponsibleForDate, ruleNeedsEntryBackfill, toDateOnly } from '../logic/rotation';
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
import { isSupabaseConfigured } from '../lib/supabase';
import { adminRescheduleWalk, adminSwapWalks } from '../lib/walkAdmin';
import { friendlyErrorMessage } from '../lib/errorMessages';

const GENERATE_DAYS_AHEAD = 14;

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

  markDone: (walkId: string, completedByUserId: string, details?: WalkCompletionDetails) => Promise<void>;
  editDoneDetails: (walkId: string, details: WalkCompletionDetails) => Promise<void>;
  skip: (walkId: string) => Promise<void>;
  swap: (walkId: string, newUserId: string, swappedByUserId: string) => Promise<void>;
  swapTwoWalks: (walkAId: string, walkBId: string, swappedByUserId: string) => Promise<void>;
  addUnplannedWalk: (input: UnplannedWalkInput) => Promise<void>;
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
  const { users, dog } = useFamilyStore.getState();
  const user = users.find((u) => u.id === walk.responsibleUserId);
  if (!user || !user.remindersEnabled || !dog) return;
  const settings = await repository.getNotificationSettings(walk.familyId);
  const setting = settings.find((s) => s.userId === user.id);
  if (!setting) return;
  await scheduleWalkNotifications(walk, setting, user.name, dog.name);
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
  const { users, dog } = useFamilyStore.getState();
  if (!dog) return;
  const usersById = new Map(users.map((u) => [u.id, u]));
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
    dog.name
  );
}

export const useScheduleStore = create<ScheduleState>((set, get) => ({
  rules: [],
  entries: [],
  walks: [],
  loading: false,
  error: null,
  actionError: null,

  load: async (familyId: string): Promise<boolean> => {
    set({ loading: true, error: null });
    try {
      const [rules, entries, walks] = await Promise.all([
        repository.getScheduleRules(familyId),
        repository.getScheduleEntries(familyId),
        repository.getWalks(familyId),
      ]);

      // Self-healing: an active rule with no upcoming entries (generation
      // never ran, was interrupted, or entries were wiped some other way)
      // must never just silently show an empty schedule — backfill it from
      // the rule itself, right here, before the screen ever renders.
      const today = toDateOnly(new Date());
      const endDate = toDateOnly(new Date(Date.now() + GENERATE_DAYS_AHEAD * 86400000));
      const rulesMissingEntries = rules.filter((r) => ruleNeedsEntryBackfill(r, entries, today));

      let finalEntries = entries;
      let finalWalks = walks;
      if (rulesMissingEntries.length > 0) {
        const generatedEntries = rulesMissingEntries.flatMap((r) =>
          generateRotationSchedule(r, today, endDate, () => generateId('entry'))
        );
        if (generatedEntries.length > 0) {
          await repository.addScheduleEntries(generatedEntries);
          const existingKeys = new Set(entries.map((e) => `${e.dogId}|${e.date}|${e.time}`));
          const trulyNew = generatedEntries.filter((e) => !existingKeys.has(`${e.dogId}|${e.date}|${e.time}`));
          const generatedWalks = trulyNew.map((e) => walkFromEntry(e, familyId));
          for (const w of generatedWalks) await repository.saveWalk(w);
          finalEntries = [...entries, ...trulyNew];
          finalWalks = [...walks, ...generatedWalks];
        }
      }

      set({ rules, entries: finalEntries, walks: finalWalks, loading: false });
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
      set({ error: e instanceof Error ? e.message : 'שגיאה בטעינת התורנויות', loading: false });
      return false;
    }
  },

  addRule: async (rule: ScheduleRule) => {
    if (!guardTestModeMutation()) return;
    try {
      await repository.upsertScheduleRule(rule);
      const today = toDateOnly(new Date());
      const endDate = toDateOnly(new Date(Date.now() + GENERATE_DAYS_AHEAD * 86400000));
      const newEntries = generateRotationSchedule(rule, today, endDate, () => generateId('entry'));
      await repository.addScheduleEntries(newEntries);

      const existingKeys = new Set(get().entries.map((e) => `${e.dogId}|${e.date}|${e.time}`));
      const trulyNew = newEntries.filter((e) => !existingKeys.has(`${e.dogId}|${e.date}|${e.time}`));
      const newWalks = trulyNew.map((e) => walkFromEntry(e, rule.familyId));
      for (const w of newWalks) await repository.saveWalk(w);

      set((s) => ({
        rules: [...s.rules.filter((r) => r.id !== rule.id), rule],
        entries: [...s.entries, ...trulyNew],
        walks: [...s.walks, ...newWalks],
        actionError: null,
      }));
      newWalks.forEach((w) => void scheduleNotificationsForWalk(w));
    } catch (e) {
      // A thrown error here (storage failure, bad data, etc.) must never
      // leave the new rule invisible with no explanation — surface it the
      // same way every other schedule action in this store does.
      set({ actionError: e instanceof Error ? e.message : 'לא הצלחנו להוסיף את שעת הטיול' });
    }
  },

  /**
   * Edits a time slot's time/label/rotation/days. Past and already-executed
   * occurrences are left untouched; only still-pending future occurrences
   * (today included) are regenerated against the new rule — this is what
   * "change the default time without losing history" means in practice.
   */
  updateRule: async (ruleId, patch) => {
    if (!guardTestModeMutation()) return;
    const rule = get().rules.find((r) => r.id === ruleId);
    if (!rule) return;
    try {
      const updatedRule: ScheduleRule = { ...rule, ...patch };
      await repository.upsertScheduleRule(updatedRule);

      const today = toDateOnly(new Date());
      const affectedEntries = get().entries.filter((e) => e.ruleId === ruleId && e.date >= today);
      const updatedEntries: ScheduleEntry[] = [];
      for (const entry of affectedEntries) {
        const responsibleUserId = resolveResponsibleForDate(updatedRule, entry.date);
        const updatedEntry: ScheduleEntry = { ...entry, time: updatedRule.time, responsibleUserId };
        await repository.updateScheduleEntry(updatedEntry);
        updatedEntries.push(updatedEntry);
      }

      const updatedWalks: Walk[] = [];
      for (const entry of updatedEntries) {
        const walk = get().walks.find((w) => w.scheduleEntryId === entry.id);
        if (!walk || walk.status !== 'pending') continue;
        const updatedWalk: Walk = { ...walk, scheduledTime: entry.time, responsibleUserId: entry.responsibleUserId, updatedAt: new Date().toISOString() };
        await repository.saveWalk(updatedWalk);
        updatedWalks.push(updatedWalk);
      }

      set((s) => ({
        rules: s.rules.map((r) => (r.id === ruleId ? updatedRule : r)),
        entries: s.entries.map((e) => updatedEntries.find((ue) => ue.id === e.id) ?? e),
        walks: s.walks.map((w) => updatedWalks.find((uw) => uw.id === w.id) ?? w),
        actionError: null,
      }));
      updatedWalks.forEach((w) => void scheduleNotificationsForWalk(w));
    } catch (e) {
      set({ actionError: e instanceof Error ? e.message : 'לא הצלחנו לעדכן את שעת הטיול' });
    }
  },

  /** Deletes a time slot. Future not-yet-done occurrences disappear from the schedule; history is kept. */
  deleteRule: async (ruleId: string) => {
    if (!guardTestModeMutation()) return;
    try {
      const today = toDateOnly(new Date());
      const { entries, walks } = get();
      const futureEntries = entries.filter((e) => e.ruleId === ruleId && e.date >= today);
      for (const entry of futureEntries) {
        const walk = walks.find((w) => w.scheduleEntryId === entry.id);
        if (walk && walk.status === 'pending') {
          await cancelWalkNotifications(walk.id);
          await repository.deleteScheduleEntry(entry.id);
        }
      }
      await repository.deleteScheduleRule(ruleId);
      const removedEntryIds = new Set(futureEntries.map((e) => e.id));
      set((s) => ({
        rules: s.rules.filter((r) => r.id !== ruleId),
        entries: s.entries.filter((e) => !removedEntryIds.has(e.id)),
        walks: s.walks.filter((w) => !(w.scheduleEntryId && removedEntryIds.has(w.scheduleEntryId))),
        actionError: null,
      }));
    } catch (e) {
      set({ actionError: e instanceof Error ? e.message : 'לא הצלחנו למחוק את שעת הטיול' });
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
      set({ actionError: e instanceof Error ? e.message : 'לא הצלחנו לשנות את סדר השעות' });
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
          if (entry) await repository.updateScheduleEntry({ ...entry, time: newTime });
        }
      }

      set((s) => ({
        walks: s.walks.map((w) => (w.id === walkId ? updatedWalk : w)),
        entries: s.entries.map((e) => (e.id === walk.scheduleEntryId ? { ...e, time: newTime } : e)),
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

  markDone: async (walkId: string, completedByUserId: string, details: WalkCompletionDetails = {}) => {
    if (!guardTestModeMutation()) return;
    const walk = get().walks.find((w) => w.id === walkId);
    if (!walk) return;
    try {
      const updated = markWalkDone(walk, completedByUserId, details);
      // Optimistic update so the Home screen reflects it within the "few seconds" UX goal.
      set((s) => ({ walks: s.walks.map((w) => (w.id === walkId ? updated : w)), actionError: null }));
      await repository.saveWalk(updated);
      await cancelWalkNotifications(walkId);

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
        return; // write is genuinely still in flight — don't touch state, don't refetch stale data
      }

      const conflict = await repository.getConflictForWalk?.(walkId);
      if (conflict) {
        // Revert the optimistic update — the server rejected the write —
        // and tell the user, rather than silently showing it as done.
        set((s) => ({
          walks: s.walks.map((w) => (w.id === walkId ? walk : w)),
          actionError: 'לא הצלחנו לשמור את הסימון בשרת. נסו לרענן ולסמן שוב.',
        }));
        return;
      }

      // Write is confirmed resolved (synced, or there was never a remote to
      // begin with) — now it's safe to re-sync from the repository in case a
      // concurrent completion by another family member won the race (see
      // repository.saveWalk docs).
      const fresh = await repository.getWalks(walk.familyId);
      set({ walks: fresh });
    } catch (e) {
      set({ actionError: e instanceof WalkActionError ? e.message : 'לא הצלחנו לסמן את הטיול כבוצע' });
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
      set({
        walks: before.walks,
        entries: before.entries,
        actionError:
          e instanceof WalkActionError
            ? e.message
            : e instanceof Error
              ? friendlyErrorMessage(e)
              : 'לא הצלחנו להחליף בין הטיולים',
      });
    }
  },

  /** Logs a walk that already happened with no prior plan — never touches the rotation. */
  addUnplannedWalk: async (input: UnplannedWalkInput) => {
    if (!guardTestModeMutation()) return;
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
    } catch (e) {
      set((s) => ({ walks: s.walks.filter((w) => w.id !== walk.id), actionError: 'לא הצלחנו לשמור את הטיול' }));
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


