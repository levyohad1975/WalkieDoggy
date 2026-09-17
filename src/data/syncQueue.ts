import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Dog, FamilyUser, ScheduleEntry, ScheduleRule, Walk } from '../types';
import type { DeleteFamilyMemberPayload, Repository } from './repository';

const QUEUE_KEY = 'dog-walk-family:sync-queue:v4';
// v3's storage shape (bare SyncOperation[], no owner tag at all) — kept
// around ONLY so load() can migrate a device that still has one on disk
// forward to v4 the first time it loads post-update. Never written to.
const LEGACY_QUEUE_KEY_V3 = 'dog-walk-family:sync-queue:v3';
const CONFLICTS_KEY = 'dog-walk-family:sync-conflicts:v1';
const QUARANTINE_KEY = 'dog-walk-family:sync-quarantine:v1';

/**
 * Lets the app wire this module to "whose profile is currently claimed on
 * this device" without a static import of authStore here (that would create
 * a store<->data circular import, since authStore.signIn() needs to call
 * back into this module's hasPendingForOtherUser() — see its doc comment).
 * App.tsx calls this once at startup — at module scope, so it is wired
 * before restoreSession()/trySync() ever run — with
 * `() => useAuthStore.getState().currentUserId`, read LIVE at each enqueue()
 * call rather than captured once, so it always reflects whichever profile
 * is actually claimed at that moment. Defaults to a getter that always
 * returns null, so enqueue() degrades to "untagged" (see
 * QueuedItem.claimedByUserId — untagged items block every future profile
 * switch, not just a different one) if this is never wired — e.g. in tests
 * that construct a SyncQueue directly.
 */
let getClaimedUserId: () => string | null = () => null;
export function setSyncQueueActorGetter(getter: () => string | null): void {
  getClaimedUserId = getter;
}

/**
 * A queued write, tagged with whichever profile was claimed on THIS DEVICE
 * at the moment it was enqueued — or `null` when that isn't reliably known
 * (a v3 item migrated forward by load() below, from before this tagging
 * existed at all; see its doc comment for why migration deliberately never
 * guesses a value here). This tag is a CLIENT-SIDE convenience only — it is
 * never sent to Supabase and never used to attribute the actual audit-log
 * entry (the server-side triggers in migrations/0005_*.sql always resolve
 * the actor from auth.uid()/current_profile_id() at the moment the write
 * reaches Postgres, never from anything the client supplies, exactly
 * because a client-supplied actor id cannot be trusted). What this tag DOES
 * do is let hasPendingForOtherUser() below stop authStore.signIn() from
 * re-claiming this device as a DIFFERENT family member while a previous
 *
 * COMPLETION PASS — 7E adversarial check: this same guard also covers
 * authStore.signInWithPin() (the new PIN-based claim-TRANSFER path, see
 * migrations/0016_*.sql's claim_family_profile_with_pin()) with no extra
 * code — both signIn() and signInWithPin() share one internal
 * __signInCore() implementation, and the trySync()+hasPendingForOtherUser()
 * guard runs BEFORE the branch that decides which claim RPC to call. So a
 * device with unflushed writes for its OLD profile is blocked from
 * transferring a DIFFERENT profile's claim onto itself exactly the same way
 * it's blocked from an ordinary re-claim — and because getClaimedUserId() is
 * read live at each enqueue() (not captured once), every write queued AFTER
 * a successful transfer is correctly tagged with the NEW profile's id, so a
 * later flush can never replay it under the superseded profile's identity.
 * member's writes (or writes of UNKNOWN authorship) are still sitting in
 * this queue — see that function's doc comment for the offline-replay
 * misattribution this prevents.
 */
interface QueuedItem {
  op: SyncOperation;
  claimedByUserId: string | null;
}

/**
 * A queued operation that failed PERMANENTLY (see isPermanentError below) and
 * was therefore dropped from the queue rather than retried forever. Kept so
 * the UI can surface "this change couldn't be applied" instead of silently
 * losing it, and so an operator/admin can see what happened.
 */
export interface SyncConflict {
  op: SyncOperation;
  code: string | undefined;
  message: string;
  failedAt: string;
}

/**
 * A queued write that flush() refused to even ATTEMPT against Supabase,
 * because its `claimedByUserId` was `null` — an untagged/legacy operation
 * whose original actor is unknown (see QueuedItem's doc comment). Unlike
 * `SyncConflict` (a write that WAS attempted and the server permanently
 * rejected), a quarantined item never reaches the network at all: flushing
 * it under whichever profile is currently claimed would risk exactly the
 * audit misattribution this whole tagging scheme exists to prevent, and
 * there is no profile this can safely wait for instead (unlike a merely
 * wrong-profile-right-now tagged item — see flush()'s doc comment). It is
 * surfaced here for manual/admin review rather than silently discarded or
 * silently replayed; getQuarantined() below is how that review would read
 * it (no UI currently consumes this — see the Round 4 report for why that's
 * an intentional, separate follow-up rather than scope creep here).
 */
export interface QuarantinedItem {
  op: SyncOperation;
  quarantinedAt: string;
  reason: string;
}

/**
 * Whether a Postgres/PostgREST error is a PERMANENT failure — retrying the
 * exact same payload will never succeed, so continuing to block the entire
 * queue behind it (the previous behavior) is wrong. SQLSTATE class "23"
 * (integrity_constraint_violation: 23505 unique_violation, 23503
 * foreign_key_violation, 23502 not_null_violation, 23514 check_violation) is
 * the reliable, well-known signal for this. Anything else (network errors,
 * timeouts, 5xx, or an error with no recognizable Postgres code at all) is
 * treated as RETRYABLE, preserving the original break-and-retry behavior.
 *
 * Concretely, this is what fixes the real bug this round: a queued
 * `updateScheduleEntry` trying to move an 18:00 entry onto an already-taken
 * 22:00 slot fails with 23505 on `schedule_entries_dog_id_date_time_key`
 * forever — every retry hits the same conflict, so the old code blocked ALL
 * later queued operations (for any user, any feature) behind it permanently.
 *
 * QA PASS v3, ISSUE 2 FIX: also treat SQLSTATE class "42" (syntax_error /
 * access_rule_violation — in practice from this client this is always 42501
 * insufficient_privilege, i.e. an RLS policy rejection) and class "28"
 * (invalid_authorization_specification) as PERMANENT. Retrying the exact
 * same payload under the exact same policy can never succeed any more than
 * a 23xxx retry could — the request is authorization-shaped, not
 * connectivity-shaped — so before this fix a single RLS-rejected queued
 * write (e.g. the `upsertUser` 42501 bug this same pass fixes at the root)
 * permanently `break`s the whole flush loop and blocks every later queued
 * operation for every user and every feature behind it, exactly like the
 * 23xxx bug above did before Round 4's fix. Genuine connectivity/timeout/5xx
 * failures carry no Postgres code at all (or a network-layer one outside
 * these classes) and remain retryable, unaffected by this change.
 *
 * RC FIX: also treat SQLSTATE class "P0" (plpgsql_error — in practice from
 * this schema this is always P0001, the default code for a bare `raise
 * exception 'message'` with no `using errcode = ...`) as PERMANENT. Every
 * business-rule `raise exception` across every migration in this schema
 * (e.g. `enforce_walk_write_authorization()`'s "invalid status transition",
 * "reassigning a walk requires an approved swap request", etc.) uses this
 * bare form and therefore always raises P0001 — none of them override
 * errcode. Retrying the exact same payload against the exact same walk/
 * family state can never succeed any more than a 23xxx or 42xxx retry
 * could: the write is business-rule-shaped, not connectivity-shaped. This
 * is concretely reachable offline-first: e.g. a queued `saveWalk` resolving
 * a walk whose server-side status/owner has since diverged (another device
 * already resolved it, or a swap was approved, while this device was
 * offline) hits exactly this trigger and, before this fix, would `break`
 * the flush loop and block every later queued operation for this profile
 * forever, exactly like the 23xxx/42xxx bugs above did before their own
 * fixes.
 */
function isPermanentError(error: unknown): boolean {
  const code = (error as { code?: string } | null | undefined)?.code;
  if (typeof code !== 'string') return false;
  return code.startsWith('23') || code.startsWith('42') || code.startsWith('28') || code.startsWith('P0');
}

export type SyncOperation =
  | { type: 'createUser'; payload: FamilyUser }
  | { type: 'upsertUser'; payload: FamilyUser }
  | { type: 'deleteUser'; payload: { userId: string } }
  | { type: 'deleteFamilyMember'; payload: DeleteFamilyMemberPayload }
  | { type: 'upsertDog'; payload: Dog }
  | { type: 'upsertScheduleRule'; payload: ScheduleRule }
  | { type: 'deleteScheduleRule'; payload: { ruleId: string } }
  | { type: 'addScheduleEntries'; payload: ScheduleEntry[] }
  | { type: 'updateScheduleEntry'; payload: ScheduleEntry }
  | { type: 'deleteScheduleEntry'; payload: { entryId: string } }
  | { type: 'saveWalk'; payload: Walk }
  | { type: 'deleteWalk'; payload: { walkId: string } }
  | { type: 'updateUserReminderSetting'; payload: { userId: string; enabled: boolean } };

/**
 * Persistent FIFO queue of writes that couldn't reach Supabase yet (no
 * connection, or Supabase not configured). `OfflineFirstRepository` enqueues
 * here immediately after writing to the local cache, and `flush()` replays
 * the queue against a real repository once connectivity returns — this is
 * the abstraction the "offline usefulness" requirement calls for even where
 * a full offline implementation is out of scope for the MVP.
 */
export class SyncQueue {
  private queue: QueuedItem[] | null = null;
  private conflicts: SyncConflict[] | null = null;
  private quarantined: QuarantinedItem[] | null = null;
  private flushing = false;

  private async load(): Promise<QueuedItem[]> {
    if (this.queue) return this.queue;

    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (raw !== null) {
      this.queue = await this.discardLegacyDeleteFamilyMember(JSON.parse(raw) as QueuedItem[]);
      return this.queue;
    }

    this.queue = await this.discardLegacyDeleteFamilyMember(await this.migrateLegacyV3Queue());
    return this.queue;
  }

  /**
   * ROUND 7 FIX (Part 3): `deleteFamilyMember` is no longer ever enqueued by
   * OfflineFirstRepository (it's now offline-exempt — see its own doc
   * comment), so from this version forward the queue should never contain
   * one. A device that already had one persisted from an OLDER app version
   * (queued under the previous optimistic-offline behavior, before this
   * fix shipped) is a different story — handled here, once, the first time
   * load() runs post-update.
   *
   * Chosen behavior: DISCARD any such legacy entry rather than blindly
   * replaying it against the server on the next flush(). Reasoning:
   *   - The local cache was already optimistically marked "removed" for
   *     this member back when the write was originally queued (that's the
   *     very bug this round fixes) — the entry sitting here is a stale
   *     record of a client-side state that already happened, not a pending
   *     action that still needs to happen.
   *   - Blindly replaying it risks acting on stale intent: by the time this
   *     runs, the member's real state on the server may have changed in
   *     ways the client has no way to know (re-added, promoted, already
   *     removed by someone else, family membership changed) — reissuing a
   *     destructive admin RPC call from months-old queued intent with no
   *     fresh confirmation is exactly the kind of blind replay this whole
   *     round is about eliminating for this operation.
   *   - Unlike other queued types, no reconciliation step is needed after
   *     discarding: getFamily()/getUsers() in OfflineFirstRepository always
   *     fetch fresh from `remote` whenever the device is online (see their
   *     own implementations) and only fall back to the local cache while
   *     offline — so the very next online read of family/user data
   *     naturally corrects whatever the local cache's stale optimistic
   *     removal got wrong, with no special-cased forced-reload plumbing
   *     needed here.
   *
   * Each discarded entry is recorded via quarantine() (same mechanism as an
   * untagged/unknown-owner item — see QuarantinedItem's doc comment) rather
   * than silently vanishing, so it stays visible for review. This never
   * touches conflicts or any other operation type, and never throws even if
   * the persisted queue is somehow malformed around this entry.
   */
  private async discardLegacyDeleteFamilyMember(items: QueuedItem[]): Promise<QueuedItem[]> {
    const legacy = items.filter((item) => item.op.type === 'deleteFamilyMember');
    if (legacy.length === 0) return items;

    const kept = items.filter((item) => item.op.type !== 'deleteFamilyMember');
    this.queue = kept;
    await this.persist();
    for (const item of legacy) {
      await this.quarantine(
        item,
        'legacy deleteFamilyMember entry from a pre-fix app version — discarded rather than blindly replayed; the next online family/user read will correct any local divergence'
      );
    }
    return kept;
  }

  /**
   * ONE-TIME v3 -> v4 MIGRATION, run the first time load() finds no v4 key.
   * v3 stored bare `SyncOperation[]` (no owner tag at all — that concept
   * didn't exist yet); v4 wraps each in `{ op, claimedByUserId }`. A device
   * that still has a v3 queue on disk (it was never flushed before this
   * update shipped) must not have those pending offline writes silently
   * abandoned just because the storage key changed underneath it.
   *
   * Each migrated item is tagged `claimedByUserId: null` — DELIBERATELY
   * never "whichever profile happens to be signed in right now" (or any
   * other guess). v3 predates this tagging entirely, so there is no
   * reliable record of who actually enqueued a given v3 item; stamping it
   * with the CURRENT session's user would be exactly the "pretend an
   * arbitrary actor is known" this must not do — doubly so given that
   * load() can itself be reached very early during app startup (App.tsx
   * calls restoreSession() and repository.trySync() close together), before
   * currentUserId is even guaranteed to have been restored yet. Reading it
   * here would risk tagging someone else's queued write with whatever
   * profile (or lack of one) happened to be in the store at that instant.
   * `null` sidesteps this entirely: hasPendingForOtherUser() below treats a
   * null-tagged item as blocking EVERY profile switch (not just a
   * different one) until it is actually flushed or surfaced as a conflict
   * — see that function's doc comment.
   *
   * Ordering matters for safety: v4 is persisted FIRST, and the v3 key is
   * only removed once that succeeded. If persist() throws (e.g. storage
   * full), the v3 data is left exactly as it was so the next load() call
   * can retry the migration, rather than the data being gone from both
   * places.
   */
  private async migrateLegacyV3Queue(): Promise<QueuedItem[]> {
    const legacyRaw = await AsyncStorage.getItem(LEGACY_QUEUE_KEY_V3);
    if (legacyRaw === null) {
      return [];
    }

    let migrated: QueuedItem[];
    try {
      const legacyOps = JSON.parse(legacyRaw) as SyncOperation[];
      migrated = legacyOps.map((op) => ({ op, claimedByUserId: null }));
    } catch (error) {
      // Corrupt/unreadable legacy data: nothing safe to recover from it.
      // Log it (so it's at least visible, e.g. in a bug report) and start
      // v4 empty rather than throwing and breaking every future load().
      console.error('SyncQueue: failed to parse legacy v3 queue, discarding it', error);
      migrated = [];
    }

    this.queue = migrated;
    await this.persist();
    await AsyncStorage.removeItem(LEGACY_QUEUE_KEY_V3);
    return migrated;
  }

  private async persist(): Promise<void> {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(this.queue ?? []));
  }

  private async loadConflicts(): Promise<SyncConflict[]> {
    if (this.conflicts) return this.conflicts;
    const raw = await AsyncStorage.getItem(CONFLICTS_KEY);
    this.conflicts = raw ? (JSON.parse(raw) as SyncConflict[]) : [];
    return this.conflicts;
  }

  private async persistConflicts(): Promise<void> {
    await AsyncStorage.setItem(CONFLICTS_KEY, JSON.stringify(this.conflicts ?? []));
  }

  /** Permanently-failed operations that were dropped from the queue — see isPermanentError. */
  async getConflicts(): Promise<SyncConflict[]> {
    return [...(await this.loadConflicts())];
  }

  async clearConflicts(): Promise<void> {
    this.conflicts = [];
    await AsyncStorage.removeItem(CONFLICTS_KEY);
  }

  private async loadQuarantined(): Promise<QuarantinedItem[]> {
    if (this.quarantined) return this.quarantined;
    const raw = await AsyncStorage.getItem(QUARANTINE_KEY);
    this.quarantined = raw ? (JSON.parse(raw) as QuarantinedItem[]) : [];
    return this.quarantined;
  }

  private async persistQuarantined(): Promise<void> {
    await AsyncStorage.setItem(QUARANTINE_KEY, JSON.stringify(this.quarantined ?? []));
  }

  private async quarantine(item: QueuedItem, reason: string): Promise<void> {
    const list = await this.loadQuarantined();
    list.push({ op: item.op, quarantinedAt: new Date().toISOString(), reason });
    await this.persistQuarantined();
  }

  /**
   * Legacy/untagged operations flush() refused to auto-replay — see
   * QuarantinedItem's doc comment. Read-only for now: resolving one (apply
   * it manually once its real actor is somehow confirmed, or discard it
   * deliberately) is a follow-up this round didn't build a UI for, not
   * something this method does on its own.
   */
  async getQuarantined(): Promise<QuarantinedItem[]> {
    return [...(await this.loadQuarantined())];
  }

  async enqueue(op: SyncOperation): Promise<void> {
    const q = await this.load();
    q.push({ op, claimedByUserId: getClaimedUserId() });
    await this.persist();
  }

  async size(): Promise<number> {
    return (await this.load()).length;
  }

  /** Live routing hint only; never grants server authority or an owner to queued items. */
  hasClaimedActor(): boolean {
    return getClaimedUserId() !== null;
  }

  /**
   * True if a `saveWalk` write for this exact walk id is still sitting in
   * the queue (not yet flushed to the server). Used by scheduleStore.markDone
   * (A2 fix) to avoid immediately overwriting the just-applied optimistic
   * local state with a stale remote read: if the write hasn't reached the
   * server yet, refetching from the server right now would read pre-write
   * data and silently revert the completion in the UI with no error shown —
   * exactly the "completion not syncing correctly" symptom this guards
   * against. See flush()'s ordering: a queued item is removed the moment it
   * either succeeds or is dropped as a permanent conflict, so once this
   * returns false the write has been resolved one way or the other.
   */
  async hasPendingSaveWalk(walkId: string): Promise<boolean> {
    const q = await this.load();
    return q.some((item) => item.op.type === 'saveWalk' && item.op.payload.id === walkId);
  }

  /**
   * Most recent recorded permanent-failure conflict for a `saveWalk` write of
   * this walk id, if any (see isPermanentError). Reflects only the CURRENT
   * state for this walk — see flush()'s call to clearConflictForWalk() below,
   * which removes any stored conflict for a walk id the moment a LATER
   * saveWalk for that same id succeeds, so this never returns a stale
   * historical conflict from a since-superseded attempt (bug 3 fix).
   */
  async getConflictForWalk(walkId: string): Promise<SyncConflict | undefined> {
    const conflicts = await this.loadConflicts();
    return [...conflicts].reverse().find((c) => c.op.type === 'saveWalk' && c.op.payload.id === walkId);
  }

  /**
   * BUG 3 FIX: removes every previously recorded conflict for `saveWalk`
   * writes of this exact walk id. Called by flush() the moment a `saveWalk`
   * for that walk id is confirmed to have actually succeeded — see the call
   * site's doc comment for why this is the safe/correct point to do it.
   * Never touches conflicts for any other walk id or operation type.
   */
  private async clearConflictForWalk(walkId: string): Promise<void> {
    const conflicts = await this.loadConflicts();
    const filtered = conflicts.filter((c) => !(c.op.type === 'saveWalk' && c.op.payload.id === walkId));
    if (filtered.length === conflicts.length) return; // nothing to clear
    this.conflicts = filtered;
    await this.persistConflicts();
  }

  /**
   * True when this device still has queued writes tagged with a DIFFERENT
   * claimed profile than `userId`. This is the check authStore.signIn()
   * makes (after first attempting a flush) before letting this device
   * re-claim itself as a different family member: flushing these now would
   * reach Supabase under `userId`'s claim, and audit_walk_change() /
   * audit_schedule_rule_change() / audit_user_profile_change() (migrations/
   * 0005_*.sql) would then resolve the actor as `userId` via
   * current_profile_id() — even though a DIFFERENT member originally
   * performed the queued action while offline. Blocking the claim here (or
   * flushing first, so nothing is left to misattribute) is the fix; letting
   * the switch proceed and hoping for the best is exactly the silent
   * misattribution this must not do.
   *
   * Items with `claimedByUserId === null` — a v3 item migrateLegacyV3Queue()
   * brought forward with no reliable owner, or (in principle) one enqueued
   * before setSyncQueueActorGetter was ever wired — are treated as blocking
   * EVERY switch, including back to the profile currently signed in, not
   * just a different one: with no record of who actually queued it, there
   * is no `userId` this can safely say "yes, definitely them." This is
   * deliberately more conservative than the tagged case (QueuedItem's doc
   * comment, and migrateLegacyV3Queue()'s). It does not, however, stay stuck
   * forever: authStore.signIn() tries a flush before ever calling this, and
   * flush() itself (see its doc comment) quarantines a null-tagged item
   * immediately rather than attempting it — quarantining also removes it
   * from the queue, so it stops blocking the moment that happens. What must
   * never happen is replaying it silently under whichever profile's claim
   * simply because no switch was attempted while it sat here.
   */
  async hasPendingForOtherUser(userId: string): Promise<boolean> {
    const q = await this.load();
    return q.some((item) => item.claimedByUserId == null || item.claimedByUserId !== userId);
  }

  /**
   * Replays queued operations against `remote` — but ONLY those actually
   * owned by whichever profile is claimed on this device RIGHT NOW (Round 4
   * gap fix). Before this, flush() applied every queued item unconditionally
   * regardless of `claimedByUserId`, so App.tsx's automatic startup/
   * foreground trySync() call could replay a DIFFERENT member's — or an
   * unknown legacy actor's — queued write under whoever happens to be
   * signed in at that moment, which is exactly the audit misattribution the
   * tagging design (hasPendingForOtherUser()/authStore.signIn()) was meant
   * to prevent; that guard only stops a PROFILE SWITCH, it never gated
   * flush() itself.
   *
   * For each queued item, `getClaimedUserId()` (the same live getter
   * enqueue() reads) is checked fresh:
   *   - `claimedByUserId === null` (a v3-migrated or otherwise untagged
   *     item): NEVER attempted, under any profile, ever automatically —
   *     there is no owner to compare against, so no `currentUserId` can be
   *     called safe. It is removed from the live queue and recorded in
   *     `quarantined` for manual/admin review instead of being silently
   *     discarded or silently replayed (getQuarantined()'s doc comment).
   *   - `claimedByUserId` set but DIFFERENT from the current profile (or no
   *     profile is currently claimed at all — see the startup-ordering note
   *     below): left in the queue UNTOUCHED and skipped over, so it doesn't
   *     block whoever IS currently signed in; it becomes eligible again the
   *     next time flush() runs while its own owner is the claimed profile.
   *   - `claimedByUserId` matching the current profile: handled exactly as
   *     before — a RETRYABLE failure (network/timeout/anything without a
   *     recognizable Postgres integrity-violation code) stops the flush
   *     there; a PERMANENT failure (SQLSTATE 23xxx — see isPermanentError)
   *     is dropped and recorded in `conflicts`, and the flush continues past
   *     it so one stale/conflicting write can't wedge every other queued
   *     operation forever.
   *
   * Startup-ordering note (App.tsx calls restoreSession() and
   * repository.trySync() close together, so trySync() can run before
   * currentUserId has actually been restored): this needs no special
   * handling here — `getClaimedUserId()` simply returns whatever
   * currentUserId happens to be at that instant (possibly still `null`
   * pre-restore), and a `null`-vs-anything comparison never matches a real
   * `claimedByUserId`, so an owned item is correctly left queued (not
   * flushed) rather than ever being flushed under a wrong/absent profile.
   * The worst case is a harmlessly delayed flush, retried on the next
   * foreground/mutation once restoreSession() has resolved — never a wrong
   * actor.
   */
  async flush(remote: Repository): Promise<{ succeeded: number; remaining: number; conflicted: number; quarantined: number }> {
    if (this.flushing) {
      return { succeeded: 0, remaining: (await this.load()).length, conflicted: 0, quarantined: 0 };
    }
    this.flushing = true;
    try {
      const q = await this.load();
      let succeeded = 0;
      let conflicted = 0;
      let quarantinedCount = 0;
      let i = 0;
      while (i < q.length) {
        const item = q[i];

        if (item.claimedByUserId == null) {
          q.splice(i, 1);
          await this.persist();
          await this.quarantine(item, 'legacy/untagged operation — original actor unknown, never auto-replayed');
          quarantinedCount++;
          continue; // the next item has shifted into index i
        }

        if (item.claimedByUserId !== getClaimedUserId()) {
          i++; // known owner, not currently claimed — skip, don't block others
          continue;
        }

        try {
          await this.apply(remote, item.op);
          q.splice(i, 1);
          succeeded++;
          await this.persist();
          // BUG 3 FIX (historical SyncConflict falsely breaking a later
          // success): a `saveWalk` for this exact walk id has now actually
          // SUCCEEDED — any conflict previously recorded for this same walk
          // id (from an earlier, since-superseded attempt) is stale and must
          // not keep being returned by getConflictForWalk(). Without this,
          // scheduleStore.markDone()'s sequence (saveWalk -> hasPendingSaveWalk
          // (now false) -> getConflictForWalk) would see hasPendingSaveWalk
          // false (correct — nothing's queued anymore) but getConflictForWalk
          // still return Attempt-1's old permanent-failure record, and wrongly
          // revert THIS successful completion. Clearing here — the moment a
          // later write for the same walk id is confirmed to have landed — is
          // the safest point to do it: it can never race ahead of a
          // still-in-flight attempt (this only runs once `apply` above has
          // actually resolved), and it only ever clears conflicts for the
          // SAME walk id, never anything unrelated.
          if (item.op.type === 'saveWalk') {
            await this.clearConflictForWalk(item.op.payload.id);
          }
          // don't advance i — the next item has shifted into this slot
        } catch (error) {
          // QA pass v3, issue 3 fix: a queued write failing here is an
          // EXPECTED, HANDLED outcome either way — a permanent failure is
          // recorded as a conflict (below) and a retryable one simply stays
          // queued for the next flush — never an unhandled crash. `console.
          // error` triggers React Native's red LogBox overlay, which was
          // popping up for these routine, already-handled cases (most
          // visibly the RLS/23xxx conflicts this same pass's issue 2 fix
          // stopped from blocking the rest of the queue) and made a normal,
          // recoverable sync outcome look like an app crash. `console.warn`
          // still puts the failure in the log (Metro console, device logs,
          // any crash-reporting integration that taps console output) for
          // diagnosis, it just doesn't take over the screen for something
          // the queue is already correctly handling.
          console.warn(
            'SyncQueue: operation failed (handled — recorded as a conflict or left queued for retry):',
            item.op.type,
            JSON.stringify(item.op.payload),
            error
          );
          if (isPermanentError(error)) {
            q.splice(i, 1);
            await this.persist();
            const conflicts = await this.loadConflicts();
            conflicts.push({
              op: item.op,
              code: (error as { code?: string } | null | undefined)?.code,
              message: error instanceof Error ? error.message : String(error),
              failedAt: new Date().toISOString(),
            });
            await this.persistConflicts();
            conflicted++;
            continue; // don't let a permanent conflict block unrelated later ops
          }
          break; // retryable: keep it queued, try again on next flush
        }
      }
      return { succeeded, remaining: q.length, conflicted, quarantined: quarantinedCount };
    } finally {
      this.flushing = false;
    }
  }

  private async apply(remote: Repository, op: SyncOperation): Promise<void> {
    switch (op.type) {
      case 'createUser':
        return remote.createUser(op.payload);
      case 'upsertUser':
        return remote.upsertUser(op.payload);
      case 'deleteUser':
        return remote.deleteUser(op.payload.userId);
      case 'deleteFamilyMember':
        return remote.deleteFamilyMember(op.payload);
      case 'upsertDog':
        return remote.upsertDog(op.payload);
      case 'upsertScheduleRule':
        return remote.upsertScheduleRule(op.payload);
      case 'deleteScheduleRule':
        return remote.deleteScheduleRule(op.payload.ruleId);
      case 'addScheduleEntries':
        return remote.addScheduleEntries(op.payload);
      case 'updateScheduleEntry':
        return remote.updateScheduleEntry(op.payload);
      case 'deleteScheduleEntry':
        return remote.deleteScheduleEntry(op.payload.entryId);
      case 'saveWalk':
        return remote.saveWalk(op.payload);
      case 'deleteWalk':
        return remote.deleteWalk?.(op.payload.walkId);
      case 'updateUserReminderSetting':
        return remote.updateUserReminderSetting(op.payload.userId, op.payload.enabled);
    }
  }
}
