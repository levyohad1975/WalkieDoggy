import NetInfo from '@react-native-community/netinfo';
import type {
  AchievementUnlock,
  Dog,
  Family,
  FamilyUser,
  HealthTask,
  NotificationSetting,
  ScheduleEntry,
  ScheduleRule,
  Walk,
  WalkGpsSession,
} from '../types';
import type { DeleteFamilyMemberPayload, Repository } from './repository';
import { LocalRepository } from './localRepository';
import { isPermanentSyncError, SyncQueue } from './syncQueue';
// TEMPORARY DIAGNOSTIC INSTRUMENTATION — see perfTrace.ts's own doc
// comment. Remove this import and every perfMark call in
// queueWalksForBackgroundSync() once the real ~10s Schedule-save
// bottleneck is confirmed fixed by an actual real-device measurement.
import { perfMark } from '../lib/perfTrace';
import { dedupeCanonicalWalks } from '../logic/nextWalk';
// TEMPORARY P0 DIAGNOSTIC (real-device QA round 5) — see
// walkPipelineDiagnostics.ts's own doc comment. Remove this import and
// debugWalksTrace() below, plus their call sites in HomeScreen.tsx /
// WalkPipelineDiagnosticsModal.tsx, once the round-5 symptom (a confirmed
// today's-later-occurrence missing from Home's next-walk selection) is
// root-caused and fixed.
import { dedupeTraceEntries, toWalkTraceEntry, type WalksDebugTrace } from '../logic/walkPipelineDiagnostics';

/**
 * The repository the app actually uses. Reads always come from the local
 * cache (instant, works offline); when a remote (Supabase) repository is
 * configured and a connection is available, reads are refreshed from it in
 * the background and writes are queued for sync. Without a remote
 * repository configured, this behaves exactly like `LocalRepository` alone
 * — that's the "demo mode" / first-run experience.
 */
export class OfflineFirstRepository implements Repository {
  private local = new LocalRepository();
  private queue = new SyncQueue();
  /** Serializes writes for one member so an earlier edit cannot finish after a newer photo. */
  private userWriteTails = new Map<string, Promise<void>>();

  // start_walk()/finish_walk() (0048) are server-authoritative,
  // authorization-checked RPCs (admin-or-responsible-member only) — the
  // same category deleteFamilyMember below is: no blind offline replay (a
  // rejection, e.g. "walk is not pending", must reach the caller, not be
  // silently swallowed by SyncQueue.flush()'s conflict recording). Assigned
  // conditionally in the constructor, not as ordinary class methods, so
  // `repository.startWalk`/`repository.finishWalk` are genuinely `undefined`
  // in local/demo mode (no remote configured) — scheduleStore.ts's own
  // `if (repository.startWalk)` capability check relies on that exact
  // absence to fall back to its in-memory-only demo behavior; a class method
  // that merely throws in demo mode would always be truthy and break that
  // fallback instead of triggering it.
  startWalk?: (walkId: string) => Promise<Walk>;
  finishWalk?: (
    walkId: string,
    actualWalkerId: string,
    details?: { hadPee?: boolean; hadPoop?: boolean; note?: string; completedAt?: string }
  ) => Promise<Walk>;

  constructor(private remote: Repository | null) {
    if (this.remote) {
      this.startWalk = async (walkId: string): Promise<Walk> => {
        if (!(await this.isOnline())) {
          throw new Error('אין חיבור לשרת. כדי להתחיל מעקב טיול יש להתחבר לאינטרנט.');
        }
        // Same-day generated occurrences may still be queued locally when
        // the user taps Start. Flush pending writes first so start_walk()
        // never races the occurrence's server upsert.
        await this.queue.flush(this.remote!);
        // P0 fix: resolve to the CANONICAL server row for this occurrence
        // BEFORE ever calling start_walk — see resolveCanonicalWalkId's own
        // doc comment for why `walkId` itself can be a permanent orphan
        // (never a row on the server at all) even though Home still shows
        // it as a normal, startable walk.
        const resolvedId = await this.resolveCanonicalWalkId(walkId);
        try {
          const walk = await this.remote!.startWalk!(resolvedId);
          await this.local.saveWalk(walk);
          return walk;
        } catch (error) {
          if (!(error instanceof Error) || !/walk not found/i.test(error.message)) throw error;
          // Defensive fallback only: resolveCanonicalWalkId above already
          // reconciles the known "duplicate local id for the same
          // schedule_entry_id" case before ever reaching here. This covers
          // the narrow remaining race where the canonical row is created
          // (e.g. by another family member's device) in between that
          // resolution and this call.
          const retryId = await this.resolveCanonicalWalkId(resolvedId);
          if (retryId === resolvedId) throw error;
          const walk = await this.remote!.startWalk!(retryId);
          await this.local.saveWalk(walk);
          return walk;
        }
      };
      this.finishWalk = async (walkId, actualWalkerId, details) => {
        if (!(await this.isOnline())) {
          throw new Error('אין חיבור לשרת. כדי לסיים מעקב טיול יש להתחבר לאינטרנט.');
        }
        const walk = await this.remote!.finishWalk!(walkId, actualWalkerId, details);
        await this.local.saveWalk(walk);
        return walk;
      };
    }
  }

  private async isOnline(): Promise<boolean> {
    if (!this.remote) return false;
    try {
      const state = await NetInfo.fetch();
      return Boolean(state.isConnected && state.isInternetReachable !== false);
    } catch {
      return false;
    }
  }

  /**
   * P0 real-device fix — root cause of "Start" permanently failing with an
   * opaque "walk not found" on an otherwise normal, overdue scheduled walk.
   *
   * `walks.schedule_entry_id` is UNIQUE (supabase/schema.sql) — there can
   * only ever be ONE canonical server row per schedule_entry. But a local
   * walk id for a given occurrence can still be minted more than once:
   * scheduleStore.loadScheduleForFamily's orphan-walk-repair generates a
   * brand-new `walkFromEntry()` (a fresh local id) for any future entry
   * that its OWN last-known walk list doesn't yet cover, and
   * queueWalksForBackgroundSync() hands that off via a fire-and-forget
   * trySync() rather than waiting for server confirmation. If a second
   * foreground reload runs before that first repair has actually reached
   * the server (closed app, flaky connection, etc.), getWalks() has no way
   * to know a walk for that entry is already on its way, so the repair can
   * run again and mint a SECOND local walk, under a DIFFERENT id, for the
   * exact same schedule_entry_id.
   *
   * Only one of the two can ever become the real server row (the unique
   * constraint settles it, with help from supabaseRepository.ts's own
   * saveWalk — it looks up any existing row for this schedule_entry_id
   * BEFORE inserting and reuses its id, so the second write silently
   * resolves into the first one's row instead of throwing). The LOSING
   * local id is never written anywhere as its own row, yet nothing ever
   * told the device's local cache or the Zustand store that the id it is
   * still showing on Home is not the real one — so start_walk(losingId)
   * can only ever and forever report "walk not found", however many times
   * it's retried, including after commit 47559ad's pre-flush (flush has
   * nothing to retry: the losing write already "succeeded" by quietly
   * writing into the OTHER row).
   *
   * This resolves `walkId` to whatever the server actually considers
   * canonical for its schedule_entry_id BEFORE any lifecycle RPC is ever
   * called with it, reconciling the local cache to match so the next
   * foreground reload sees the correct id and never mints a further
   * duplicate:
   *   - No schedule_entry_id at all (an unplanned/spontaneous walk, which
   *     this bug class cannot apply to): returns `walkId` unchanged.
   *   - A canonical row already exists under a DIFFERENT id: deletes the
   *     local orphan row and adopts the canonical one.
   *   - No canonical row exists yet at all (the repair's write never
   *     reached the server — the genuinely-missing-row case, not just a
   *     duplicate-id one): persists it now through the normal authorized
   *     saveWalk path, which itself becomes the canonical row.
   * A SyncConflict previously recorded against `walkId` (e.g. a genuine
   * 23505 unique_violation from two devices racing the same repair) is not
   * treated as unrecoverable here — by the time this runs, the row that
   * conflict refers to already exists under the OTHER device's write, and
   * the getWalks() lookup above finds it like any other canonical row.
   */
  private async resolveCanonicalWalkId(walkId: string): Promise<string> {
    const stale = await this.local.findWalkById(walkId);
    if (!stale?.scheduleEntryId) return walkId;

    const remoteWalks = await this.remote!.getWalks(stale.familyId);
    const canonical = remoteWalks.find((w) => w.scheduleEntryId === stale.scheduleEntryId);
    if (canonical) {
      if (canonical.id !== walkId) {
        await this.local.deleteWalk(walkId);
        await this.local.saveWalk(canonical);
      }
      return canonical.id;
    }

    // Genuinely missing server-side: persist it now. supabaseRepository.ts's
    // saveWalk still protects against a last-instant concurrent insert by
    // rewriting `stale.id` in place (same object reference) if one appears
    // between the getWalks() read above and this write.
    await this.remote!.saveWalk(stale);
    if (stale.id !== walkId) {
      await this.local.deleteWalk(walkId);
    }
    await this.local.saveWalk(stale);
    return stale.id;
  }

  /** Attempts to push any queued writes now; safe to call opportunistically (e.g. on app foreground). */
  async trySync(): Promise<void> {
    if (!this.remote) return;
    if (!(await this.isOnline())) return;
    await this.queue.flush(this.remote);
  }

  async pendingSyncCount(): Promise<number> {
    return this.queue.size();
  }

  async hasPendingForOtherUser(userId: string): Promise<boolean> {
    return this.queue.hasPendingForOtherUser(userId);
  }

  /** See SyncQueue.hasPendingSaveWalk's doc comment (A2 fix). */
  async hasPendingSaveWalk(walkId: string): Promise<boolean> {
    return this.queue.hasPendingSaveWalk(walkId);
  }

  /** See SyncQueue.getConflictForWalk's doc comment (A2 fix). */
  async getConflictForWalk(walkId: string) {
    return this.queue.getConflictForWalk(walkId);
  }

  /** See Repository.getSyncConflicts's doc comment (PRD §20). */
  async getSyncConflicts() {
    return this.queue.getConflicts();
  }

  async getQuarantinedSyncItems() {
    return this.queue.getQuarantined();
  }

  async clearSyncConflicts(): Promise<void> {
    await this.queue.clearConflicts();
  }

  async getFamily(familyId: string): Promise<Family | undefined> {
    if (await this.isOnline()) {
      try {
        const fresh = await this.remote!.getFamily(familyId);
        return fresh;
      } catch {
        /* fall through to local */
      }
    }
    return this.local.getFamily(familyId);
  }

  async getUsers(familyId: string): Promise<FamilyUser[]> {
    if (await this.isOnline()) {
      try {
        return await this.remote!.getUsers(familyId);
      } catch {
        /* fall through */
      }
    }
    return this.local.getUsers(familyId);
  }

  /**
   * SECURITY FIX (QA pass v3, issue 1): a brand-new family member row — see
   * Repository.createUser's doc comment. Locally this writes into the same
   * cache as `upsertUser` (LocalRepository doesn't need the split), but the
   * queued sync op is tagged `createUser` distinctly so `SyncQueue.apply()`
   * replays it via `remote.createUser()` (INSERT, admin-only) rather than
   * `remote.upsertUser()` (UPDATE-only as of this fix).
   */
  async createUser(user: FamilyUser): Promise<void> {
    // Before the first profile is claimed, a queued create has no owner and
    // must be quarantined. Confirm the INSERT before LoginScreen can claim
    // this profile. Server RLS still decides whether bootstrap is authorized.
    if (this.remote && !this.queue.hasClaimedActor()) {
      if (!(await this.isOnline())) {
        throw new Error('Network request failed: creating an unclaimed profile requires an internet connection');
      }
      await this.remote.createUser(user);
      await this.local.upsertUser(user);
      return;
    }

    if (!this.remote) {
      await this.local.upsertUser(user);
      return;
    }

    // A new member is an admin-authorized server operation. Do not report
    // success merely because a local optimistic row and queue item exist:
    // SyncQueue deliberately records permanent RLS/constraint failures and
    // returns, which used to make a rejected INSERT look successful until the
    // next reload. Confirm the INSERT while online; queue only connectivity
    // failures so the caller can roll back on real authorization/data errors.
    if (await this.isOnline()) {
      try {
        await this.remote.createUser(user);
        await this.local.upsertUser(user);
        return;
      } catch (error) {
        if (isPermanentSyncError(error)) throw error;
      }
    }

    await this.local.upsertUser(user);
    await this.queue.enqueue({ type: 'createUser', payload: user });
    await this.trySync();
  }

  /**
   * Existing-row edit only (self-profile edit, or an admin editing another
   * member) — see Repository.upsertUser's doc comment. Any ALREADY-QUEUED
   * legacy `upsertUser` sync item from before this fix shipped (which may
   * represent what was, at the time, a create) is still replayed through
   * `remote.upsertUser()` on the next flush — see that method's own
   * backward-compat fallback doc comment in supabaseRepository.ts for why
   * that's safe.
   */
  async upsertUser(user: FamilyUser): Promise<void> {
    await this.local.upsertUser(user);
    if (!this.remote) return;

    // A queued pre-photo profile edit can be actively flushing here. The
    // direct write introduced for refresh safety used to race that older
    // operation, allowing its late completion to restore a stale photo_url.
    const previous = this.userWriteTails.get(user.id) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      if (await this.isOnline()) {
        if (await this.queue.hasPendingUpsertUser(user.id)) {
          await this.queue.flush(this.remote!);
          // A retryable older edit may still be queued after flush(). It is
          // superseded by this complete newer row and must not replay later.
          await this.queue.discardPendingUpsertUser(user.id);
        }
        try {
          await this.remote!.upsertUser(user);
          return;
        } catch (error) {
          // A rejected RLS/business-rule write is not an offline write. If
          // we enqueue it, the UI reports success while the later flush
          // drops it as a conflict — exactly how a successfully uploaded
          // member photo could disappear after refresh. Surface permanent
          // server rejections to familyStore so it rolls back and informs
          // the user; keep only genuinely transient failures offline-first.
          if (isPermanentSyncError(error)) throw error;
          // Preserve offline-first behaviour for connectivity/timeouts.
        }
      }
      await this.queue.enqueue({ type: 'upsertUser', payload: user });
      await this.trySync();
    });
    this.userWriteTails.set(user.id, current);
    try {
      await current;
    } finally {
      if (this.userWriteTails.get(user.id) === current) this.userWriteTails.delete(user.id);
    }
  }

  async deleteUser(userId: string): Promise<void> {
    await this.local.deleteUser(userId);
    if (this.remote) {
      await this.queue.enqueue({ type: 'deleteUser', payload: { userId } });
      await this.trySync();
    }
  }

  async deleteFamilyMember(payload: DeleteFamilyMemberPayload): Promise<void> {
    // ROUND 7 FIX (Part 1E / 4): admin_delete_family_member() (0004,
    // extended by 0007 with the last-admin-removal guard) is an admin-only,
    // business-rule-sensitive server operation — exactly the category
    // lib/family.ts's setMemberRole()/lib/requests.ts's approval RPCs are
    // deliberately kept OUT of this queue for (see their own doc comments):
    // a server rejection must never be silently swallowed into "queued for
    // later" while the local cache already shows the member as removed.
    // The old code here applied the soft-delete to the local cache FIRST,
    // then enqueued + trySync()'d — but SyncQueue.flush() catches and
    // records each item's failure internally rather than rethrowing to an
    // awaiting caller (see its own doc comment on permanent-error
    // handling), so a genuine rejection (e.g. "cannot remove the last admin
    // of this family") was never surfaced here at all: the caller's `await`
    // resolved successfully, familyStore.deleteUser marked the member
    // removed in the UI, and the family was left with an admin removed
    // server-side... except it wasn't, silently leaving local/server state
    // diverged with no error shown to the admin who tried it.
    //
    // Fix: when a remote repository exists and this device is online, call
    // it DIRECTLY first, still awaited, so a rejection propagates untouched
    // to the caller and the local cache is only touched once the server has
    // actually confirmed the removal. The OFFLINE case (remote configured
    // but no connection) had the exact same silent-divergence bug and is
    // fixed below in the same round — see that branch's own comment.
    // Local/demo mode (no remote at all) is unaffected either way: Repository's
    // own doc comment already treats it identically (no concurrent-write/
    // partial-failure risk to guard against there).
    if (this.remote) {
      // ROUND 7 FIX (Part 2): the OFFLINE branch used to mirror every other
      // write here — apply to the local cache immediately, then enqueue for
      // later replay. For a server-authoritative, business-rule-sensitive
      // action like this one, that is exactly as wrong offline as it was
      // online: the local cache would show the member removed straight
      // away, and only much later — when the queue actually flushed against
      // Supabase — would admin_delete_family_member() possibly reject it
      // (e.g. "cannot remove the last admin of this family"). SyncQueue.
      // flush() records that rejection as a conflict rather than rethrowing
      // it anywhere the UI would see, so local and server state would be
      // left silently diverged, same failure mode as the online bug this
      // fixed last round.
      //
      // Fixed to match lib/requests.ts's established precedent for this
      // category of action (see its module doc comment): never queued for
      // blind offline replay. When offline, this throws immediately with no
      // local mutation and no enqueue at all — errorMessages.ts maps this
      // exact message to a friendly "no connection" Hebrew string so the
      // caller (familyStore.deleteUser) surfaces it the same way as any
      // other rejection, and the local cache/UI are left completely
      // untouched, exactly as if the call had never been made.
      if (!(await this.isOnline())) {
        throw new Error('deleteFamilyMember requires an internet connection and cannot be queued offline');
      }
      await this.remote.deleteFamilyMember(payload);
      await this.local.deleteFamilyMember(payload);
      return;
    }
    // Local/demo mode: no remote repository at all, so no server invariant
    // to protect — behaves exactly as before.
    await this.local.deleteFamilyMember(payload);
  }

  async updateUserReminderSetting(userId: string, enabled: boolean): Promise<void> {
    await this.local.updateUserReminderSetting(userId, enabled);
    if (this.remote) {
      await this.queue.enqueue({ type: 'updateUserReminderSetting', payload: { userId, enabled } });
      await this.trySync();
    }
  }

  async updateUserGamificationSetting(userId: string, enabled: boolean): Promise<void> {
    await this.local.updateUserGamificationSetting(userId, enabled);
    if (this.remote) {
      await this.queue.enqueue({ type: 'updateUserGamificationSetting', payload: { userId, enabled } });
      await this.trySync();
    }
  }

  async getDog(familyId: string): Promise<Dog | undefined> {
    if (await this.isOnline()) {
      try {
        return await this.remote!.getDog(familyId);
      } catch {
        /* fall through */
      }
    }
    return this.local.getDog(familyId);
  }

  async getDogs(familyId: string): Promise<Dog[]> {
    if (await this.isOnline()) {
      try {
        return await this.remote!.getDogs(familyId);
      } catch {
        /* fall through */
      }
    }
    return this.local.getDogs(familyId);
  }

  async upsertDog(dog: Dog): Promise<void> {
    if (!this.remote) {
      await this.local.upsertDog(dog);
      return;
    }

    // Dog profile/background/photo changes must be confirmed by Staging
    // before the local cache is mutated. Otherwise an RLS/server rejection
    // looks successful until the next reload, which is exactly the failure
    // mode users see as a background that "doesn't save" or a removed photo
    // that immediately comes back.
    if (!(await this.isOnline())) {
      throw new Error('dog profile changes require an internet connection and cannot be queued offline');
    }

    await this.remote.upsertDog(dog);
    await this.local.upsertDog(dog);
  }

  async getHealthTasks(dogId: string): Promise<HealthTask[]> {
    if (await this.isOnline()) {
      try {
        return await this.remote!.getHealthTasks(dogId);
      } catch {
        /* fall through */
      }
    }
    return this.local.getHealthTasks(dogId);
  }

  async deleteHealthTask(taskId: string): Promise<void> {
    if (!this.remote) return this.local.deleteHealthTask(taskId);
    if (!(await this.isOnline())) throw new Error('health task deletion requires an internet connection');
    await this.remote.deleteHealthTask(taskId);
    await this.local.deleteHealthTask(taskId);
  }

  async upsertHealthTask(task: HealthTask): Promise<void> {
    await this.local.upsertHealthTask(task);
    if (this.remote) {
      if (await this.isOnline()) {
        try {
          await this.remote.upsertHealthTask(task);
          return;
        } catch {
          // Preserve offline-first behaviour: retry through the sync queue.
        }
      }
      await this.queue.enqueue({ type: 'upsertHealthTask', payload: task });
      await this.trySync();
    }
  }

  async getGpsSession(walkId: string): Promise<WalkGpsSession | undefined> {
    if (await this.isOnline()) {
      try {
        return await this.remote!.getGpsSession(walkId);
      } catch {
        /* fall through */
      }
    }
    return this.local.getGpsSession(walkId);
  }

  async upsertGpsSession(session: WalkGpsSession): Promise<void> {
    await this.local.upsertGpsSession(session);
    if (this.remote) {
      if (await this.isOnline()) {
        try {
          await this.remote.upsertGpsSession(session);
          return;
        } catch {
          // Preserve offline-first behaviour: retry through the sync queue.
        }
      }
      await this.queue.enqueue({ type: 'upsertGpsSession', payload: session });
      await this.trySync();
    }
  }

  async getGpsSessionsForWalkIds(walkIds: string[]): Promise<WalkGpsSession[]> {
    if (await this.isOnline()) {
      try {
        return await this.remote!.getGpsSessionsForWalkIds(walkIds);
      } catch {
        /* fall through */
      }
    }
    return this.local.getGpsSessionsForWalkIds(walkIds);
  }

  async getAchievementUnlocks(familyId: string): Promise<AchievementUnlock[]> {
    if (await this.isOnline()) {
      try {
        return await this.remote!.getAchievementUnlocks(familyId);
      } catch {
        /* fall through */
      }
    }
    return this.local.getAchievementUnlocks(familyId);
  }

  async upsertAchievementUnlock(unlock: AchievementUnlock): Promise<void> {
    await this.local.upsertAchievementUnlock(unlock);
    if (this.remote) {
      if (await this.isOnline()) {
        try {
          await this.remote.upsertAchievementUnlock(unlock);
          return;
        } catch {
          // Preserve offline-first behaviour: retry through the sync queue.
        }
      }
      await this.queue.enqueue({ type: 'upsertAchievementUnlock', payload: unlock });
      await this.trySync();
    }
  }

  async getScheduleRules(familyId: string): Promise<ScheduleRule[]> {
    if (await this.isOnline()) {
      try {
        return await this.remote!.getScheduleRules(familyId);
      } catch {
        /* fall through */
      }
    }
    return this.local.getScheduleRules(familyId);
  }

  async upsertScheduleRule(rule: ScheduleRule): Promise<void> {
    await this.local.upsertScheduleRule(rule);
    if (!this.remote) return;

    // Schedule changes are a shared, user-visible setting. When the device
    // is online, wait for Supabase to accept the write so an RLS/schema
    // rejection is not presented as a successful edit until the next refresh.
    if (await this.isOnline()) {
      await this.remote.upsertScheduleRule(rule);
      return;
    }

    // Offline remains supported: persist locally and replay when a network
    // connection returns. This path is deliberately reserved for a genuine
    // offline state, not for an online server-side rejection.
    await this.queue.enqueue({ type: 'upsertScheduleRule', payload: rule });
  }

  async deleteScheduleRule(ruleId: string): Promise<void> {
    if (!this.remote) {
      await this.local.deleteScheduleRule(ruleId);
      return;
    }

    // A fixed walk time is shared schedule configuration, not a best-effort
    // activity log.  Previously this mutation was always applied locally and
    // then hidden in SyncQueue.  If Supabase/RLS rejected it, the app looked
    // empty until the next remote load, which still found the active rule;
    // scheduleStore's legitimate missing-entry backfill then generated every
    // occurrence again.  When online, wait for the authoritative delete
    // first so a refusal reaches the confirmation UI and the local cache is
    // never allowed to claim that a schedule was removed when it was not.
    if (await this.isOnline()) {
      await this.remote.deleteScheduleRule(ruleId);
      // Supabase is authoritative online. A local cache cleanup failure after
      // the server has already confirmed the delete must not turn a successful
      // user action into a false error modal; the next online read re-mirrors
      // authoritative remote state anyway.
      try {
        await this.local.deleteScheduleRule(ruleId);
      } catch {
        // Best-effort cache cleanup only after confirmed remote success.
      }
      return;
    }

    // Genuine offline edits still retain the existing offline-first contract:
    // local state is updated and replayed in the original order on reconnect.
    await this.local.deleteScheduleRule(ruleId);
    await this.queue.enqueue({ type: 'deleteScheduleRule', payload: { ruleId } });
  }

  async getScheduleEntries(familyId: string): Promise<ScheduleEntry[]> {
    if (await this.isOnline()) {
      try {
        return await this.remote!.getScheduleEntries(familyId);
      } catch {
        /* fall through */
      }
    }
    return this.local.getScheduleEntries(familyId);
  }

  async addScheduleEntries(entries: ScheduleEntry[]): Promise<void> {
    if (entries.length === 0) return;

    if (!this.remote) {
      await this.local.addScheduleEntries(entries);
      return;
    }

    // Schedule entries are FK parents of planned walks. While online they
    // must exist on the server before saveWalk() is allowed to persist a
    // walk that references them. Queueing the entries and immediately
    // continuing used to let a failed/unfinished queue replay race the walk
    // insert, producing walks_schedule_entry_id_fkey (23503) in Staging.
    if (await this.isOnline()) {
      await this.remote.addScheduleEntries(entries);
      await this.local.addScheduleEntries(entries);
      return;
    }

    await this.local.addScheduleEntries(entries);
    await this.queue.enqueue({ type: 'addScheduleEntries', payload: entries });
  }

  async updateScheduleEntry(entry: ScheduleEntry): Promise<void> {
    await this.local.updateScheduleEntry(entry);
    if (this.remote) {
      await this.queue.enqueue({ type: 'updateScheduleEntry', payload: entry });
      await this.trySync();
    }
  }

  async deleteScheduleEntry(entryId: string): Promise<void> {
    if (!this.remote) {
      await this.local.deleteScheduleEntry(entryId);
      return;
    }

    // Keep schedule deletions consistent with deleteScheduleRule above: an
    // online rejection must not be swallowed into the queue and later look
    // like the user intentionally removed every generated occurrence.
    if (await this.isOnline()) {
      await this.remote.deleteScheduleEntry(entryId);
      // Do not surface a false delete failure when only the disposable local
      // cache cleanup fails after Supabase already deleted the occurrence.
      try {
        await this.local.deleteScheduleEntry(entryId);
      } catch {
        // Best-effort cache cleanup only after confirmed remote success.
      }
      return;
    }

    await this.local.deleteScheduleEntry(entryId);
    await this.queue.enqueue({ type: 'deleteScheduleEntry', payload: { entryId } });
  }

  async getWalks(familyId: string): Promise<Walk[]> {
    if (await this.isOnline()) {
      try {
        // Remote is authoritative while online. Mirror it into the local
        // cache before returning so stale locally-generated walk IDs cannot
        // survive a refresh and later reach start_walk()/finish_walk().
        const remoteWalks = await this.remote!.getWalks(familyId);
        const remoteIds = new Set(remoteWalks.map((walk) => walk.id));
        const remoteEntryIds = new Set(
          remoteWalks.map((walk) => walk.scheduleEntryId).filter((id): id is string => Boolean(id))
        );
        const localWalks = await this.local.getWalks(familyId);

        for (const walk of remoteWalks) {
          await this.local.saveWalk(walk);
        }
        // P0 fix: a walk still sitting in the sync queue (its
        // queueWalksForBackgroundSync() write hasn't landed yet — see
        // resolveCanonicalWalkId's doc comment) must stay visible in the
        // returned list, not just survive in the local cache. Dropping it
        // here left scheduleStore.loadScheduleForFamily's orphan-repair
        // unable to see that this occurrence already has a walk on the
        // way, so a second foreground reload before the first write landed
        // minted ANOTHER local walk for the same schedule_entry_id — the
        // exact duplicate-id race resolveCanonicalWalkId now has to clean
        // up after the fact. Excluded once remoteWalks already carries a
        // row for the same schedule_entry_id (under either id), so a
        // confirmed occurrence is never shown twice.
        const pendingLocalOnly: Walk[] = [];
        for (const walk of localWalks) {
          if (remoteIds.has(walk.id)) continue;
          if (await this.queue.hasPendingSaveWalk(walk.id)) {
            if (!walk.scheduleEntryId || !remoteEntryIds.has(walk.scheduleEntryId)) {
              pendingLocalOnly.push(walk);
            }
            continue;
          }
          await this.local.deleteWalk(walk.id);
        }
        return await this.pruneAndDedupeCanonicalWalks([...remoteWalks, ...pendingLocalOnly]);
      } catch {
        /* fall through */
      }
    }
    return await this.pruneAndDedupeCanonicalWalks(await this.local.getWalks(familyId));
  }

  /**
   * P0 real-device fix — a scheduled occurrence's Walk was legitimately
   * finished, then reappeared as a second, separately startable pending
   * Walk. See dedupeCanonicalWalks's own doc comment (src/logic/
   * nextWalk.ts) for the full mechanism: this device's local cache can
   * end up holding a stale PENDING duplicate for a schedule_entry_id whose
   * canonical row has since moved on to in_progress/done — most sharply
   * when getWalks() falls back to the raw local cache (isOnline() false
   * right after foregrounding, before connectivity is confirmed), which
   * has no deduplication of its own.
   *
   * Applied on EVERY getWalks() return (not just when a duplicate is
   * suspected) so this invariant — one schedule_entry_id, one canonical
   * Walk — holds everywhere this repository is read from, not only
   * scheduleStore.loadScheduleForFamily. Any local-only loser this
   * collapses is also deleted from the local cache (best-effort — a
   * failure here never fails the read) so it does not keep resurfacing on
   * every subsequent call; it was never a row on the server anyway.
   */
  private async pruneAndDedupeCanonicalWalks(walks: Walk[]): Promise<Walk[]> {
    const deduped = dedupeCanonicalWalks(walks);
    if (deduped.length === walks.length) return deduped;
    const kept = new Set(deduped.map((w) => w.id));
    const losers = walks.filter((w) => !kept.has(w.id));
    await Promise.all(
      losers.map((loser) =>
        this.local.deleteWalk(loser.id).catch(() => {
          /* best-effort cache cleanup only */
        })
      )
    );
    return deduped;
  }

  /**
   * TEMPORARY P0 DIAGNOSTIC (real-device QA round 5) — see
   * walkPipelineDiagnostics.ts's own doc comment for why this exists.
   * Read-only: mirrors getWalks()'s own online/offline merge logic EXACTLY
   * (duplicated, not refactored into a shared helper, so this instrument
   * can never change getWalks()'s real behavior) but returns every
   * intermediate stage instead of just the final list, annotated with
   * origin/queue/conflict state, so a real-device report can show exactly
   * where a specific occurrence's walk stopped being visible. Never
   * mutates local/remote state beyond what getWalks() itself already does
   * (mirroring remote into the local cache) — no pruning/deletion here.
   */
  async debugWalksTrace(familyId: string): Promise<WalksDebugTrace> {
    const fetchedAt = new Date().toISOString();
    const online = await this.isOnline();
    let remoteWalksRaw: Walk[] = [];
    let remoteFetchError: string | undefined;
    if (online && this.remote) {
      try {
        remoteWalksRaw = await this.remote.getWalks(familyId);
      } catch (error) {
        remoteFetchError = error instanceof Error ? error.message : String(error);
      }
    }
    const localWalksRaw = await this.local.getWalks(familyId);
    const remoteIds = new Set(remoteWalksRaw.map((w) => w.id));

    const annotate = async (walk: Walk, origin: 'remote' | 'local-only') => {
      const pending = await this.queue.hasPendingSaveWalk(walk.id);
      const conflict = await this.queue.getConflictForWalk(walk.id);
      return toWalkTraceEntry(walk, origin, pending, conflict ? { code: conflict.code, message: conflict.message, failedAt: conflict.failedAt } : undefined);
    };

    const remoteWalks = await Promise.all(remoteWalksRaw.map((w) => annotate(w, 'remote')));
    const localOnlyRaw = localWalksRaw.filter((w) => !remoteIds.has(w.id));
    const localWalks = await Promise.all(localWalksRaw.map((w) => annotate(w, remoteIds.has(w.id) ? 'remote' : 'local-only')));

    let mergedBeforeDedupe: WalksDebugTrace['mergedBeforeDedupe'];
    if (remoteFetchError || !online) {
      // Mirrors getWalks()'s offline/failed-fetch fallback: the raw local cache, no merge.
      mergedBeforeDedupe = localWalks;
    } else {
      const remoteEntryIds = new Set(remoteWalksRaw.map((w) => w.scheduleEntryId).filter((id): id is string => Boolean(id)));
      const pendingLocalOnly: WalksDebugTrace['mergedBeforeDedupe'] = [];
      for (const w of localOnlyRaw) {
        const pending = await this.queue.hasPendingSaveWalk(w.id);
        if (pending && (!w.scheduleEntryId || !remoteEntryIds.has(w.scheduleEntryId))) {
          pendingLocalOnly.push(await annotate(w, 'local-only'));
        }
      }
      mergedBeforeDedupe = [...remoteWalks, ...pendingLocalOnly];
    }
    const afterDedupe = dedupeTraceEntries(mergedBeforeDedupe);

    return {
      familyId,
      fetchedAt,
      isOnline: online,
      remoteFetchError,
      remoteWalks,
      localWalks,
      mergedBeforeDedupe,
      afterDedupe,
    };
  }

  /**
   * Saves locally immediately. When online, persist the walk to Supabase
   * before returning so lifecycle RPCs (start_walk/finish_walk) can never
   * race a still-queued creation and fail with "walk not found".
   * Transient failures keep the normal offline-first queue fallback.
   */
  async saveWalk(walk: Walk): Promise<void> {
    await this.local.saveWalk(walk);
    if (!this.remote) return;

    if (await this.isOnline()) {
      try {
        await this.remote.saveWalk(walk);
        return;
      } catch (error) {
        // A permanent server rejection must reach the caller; queueing the
        // exact same invalid write would only hide the failure and make a
        // later lifecycle RPC operate on a row that was never created.
        if (isPermanentSyncError(error)) throw error;
        // Connectivity/transient failure: preserve offline-first behaviour.
      }
    }

    await this.queue.enqueue({ type: 'saveWalk', payload: walk });
    await this.trySync();
  }

  /**
   * Real-device QA fix — "Schedule save spinner lingers ~10s". Real-iPhone
   * measurement: addRule() for a full-week rule (GENERATE_DAYS_AHEAD = 14
   * generated occurrences) awaited one saveWalk() call per walk IN
   * SEQUENCE — each itself up to two network round trips (a lookup, then
   * an upsert) — roughly 28 sequential round trips just for the walks,
   * on top of the rule + schedule-entries writes. At ~300-350ms per round
   * trip on a real mobile connection that is the whole ~10s the Save
   * button's spinner was stuck showing, for a write the person had
   * already effectively finished (the rule itself, and its entries, are
   * both confirmed server-side by the time this is ever called).
   *
   * Unlike saveWalk() above — which deliberately waits for the online
   * write so a lifecycle RPC (start_walk/finish_walk) moments later can
   * never race a still-queued creation — these are FUTURE occurrences
   * nobody can start/finish yet, so that race does not apply here. This
   * writes each walk to the LOCAL cache and the SyncQueue (both fast,
   * AsyncStorage-only operations — no network wait) so the data is
   * DURABLE — safe against the PWA being closed a moment later — the
   * instant this resolves, then kicks off ONE best-effort trySync() to
   * opportunistically flush to the server immediately on good
   * connectivity, WITHOUT the caller waiting for that network activity.
   * This is not a new sync path: it reuses the exact same queue/flush/
   * retry/conflict machinery every other queued offline write already
   * goes through (reliable, retryable, idempotent — a walk already
   * enqueued or already persisted is never re-applied twice, same
   * dedup guarantees saveWalk() always had).
   *
   * ROUND 2 FIX: real-device instrumentation after the above still
   * measured ~10s proved THIS function's own local-write loop was the
   * actual dominant cost, not the network round trips this doc comment
   * originally targeted — LocalRepository.saveWalk() does a FULL
   * read-modify-write of the entire single-blob local cache on every
   * call (see its own and saveWalks()'s doc comments), so calling it once
   * per walk here re-serialized and rewrote that whole blob up to
   * GENERATE_DAYS_AHEAD times in a row. Now calls the batched
   * saveWalks() once for the whole array instead — one local persist
   * total, regardless of how many walks are in the batch.
   */
  async queueWalksForBackgroundSync(walks: Walk[]): Promise<void> {
    perfMark(`OFR.queueWalksForBackgroundSync: local batch write start (${walks.length} walks)`);
    await this.local.saveWalks(walks);
    perfMark('OFR.queueWalksForBackgroundSync: local batch write end');
    if (!this.remote) return;
    perfMark('OFR.queueWalksForBackgroundSync: SyncQueue enqueue start');
    for (const walk of walks) {
      await this.queue.enqueue({ type: 'saveWalk', payload: walk });
    }
    perfMark('OFR.queueWalksForBackgroundSync: SyncQueue enqueue end');
    perfMark('OFR.queueWalksForBackgroundSync: calling trySync (void, not awaited)');
    void this.trySync();
    perfMark('OFR.queueWalksForBackgroundSync: returning (confirms trySync did not block)');
  }

  async deleteWalk(walkId: string): Promise<void> {
    if (!this.remote) {
      await this.local.deleteWalk?.(walkId);
      return;
    }

    // Walks linked to schedule entries must be removed authoritatively while
    // online. Queueing the delete and immediately continuing lets the parent
    // schedule entry disappear first, so a later queued child mutation can
    // fail and surface a false "schedule delete failed" message even though
    // the rule/entries were successfully removed.
    if (await this.isOnline()) {
      await this.remote.deleteWalk?.(walkId);
      // Same authoritative-online contract as schedule entry/rule deletion:
      // once the server confirms deletion, local cache cleanup cannot make
      // the whole action report failure to the user.
      try {
        await this.local.deleteWalk?.(walkId);
      } catch {
        // Best-effort cache cleanup only after confirmed remote success.
      }
      return;
    }

    await this.local.deleteWalk?.(walkId);
    await this.queue.enqueue({ type: 'deleteWalk', payload: { walkId } });
  }

  async getNotificationSettings(familyId: string): Promise<NotificationSetting[]> {
    return this.local.getNotificationSettings(familyId);
  }
}
