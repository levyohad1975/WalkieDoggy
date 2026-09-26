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
  cancelWalk?: (walkId: string) => Promise<Walk | null>;
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
        try {
          const walk = await this.remote!.startWalk!(walkId);
          await this.local.saveWalk(walk);
          return walk;
        } catch (error) {
          // Recover legacy/stale local IDs by resolving the canonical server
          // occurrence through its schedule_entry_id, then retry exactly once.
          if (!(error instanceof Error) || !/walk not found/i.test(error.message)) throw error;
          const localWalks = await this.local.getWalks('');
          const stale = localWalks.find((walk) => walk.id === walkId);
          if (!stale?.scheduleEntryId) throw error;
          const remoteWalks = await this.remote!.getWalks(stale.familyId);
          const canonical = remoteWalks.find((walk) => walk.scheduleEntryId === stale.scheduleEntryId);
          if (!canonical) throw error;
          await this.local.deleteWalk(stale.id);
          await this.local.saveWalk(canonical);
          const walk = await this.remote!.startWalk!(canonical.id);
          await this.local.saveWalk(walk);
          return walk;
        }
      };
      this.cancelWalk = async (walkId: string) => {
        if (!(await this.isOnline())) {
          throw new Error('אין חיבור לשרת. כדי לבטל טיול פעיל יש להתחבר לאינטרנט.');
        }
        const result = await this.remote!.cancelWalk!(walkId);
        if (result) {
          await this.local.saveWalk(result);
        } else {
          await this.local.deleteWalk(walkId);
        }
        return result;
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

    await this.local.upsertUser(user);
    if (this.remote) {
      await this.queue.enqueue({ type: 'createUser', payload: user });
      await this.trySync();
    }
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
    await this.local.upsertDog(dog);
    if (this.remote) {
      // Make profile edits authoritative before another screen reloads the
      // dog. Queue-only writes could let Home immediately fetch the older
      // remote row and replace an optimistic photoUrl with a stale value.
      if (await this.isOnline()) {
        try {
          await this.remote.upsertDog(dog);
          return;
        } catch {
          // Preserve offline-first behaviour: retry through the sync queue.
        }
      }
      await this.queue.enqueue({ type: 'upsertDog', payload: dog });
      await this.trySync();
    }
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
    if (this.remote) {
      await this.queue.enqueue({ type: 'upsertScheduleRule', payload: rule });
      await this.trySync();
    }
  }

  async deleteScheduleRule(ruleId: string): Promise<void> {
    await this.local.deleteScheduleRule(ruleId);
    if (this.remote) {
      await this.queue.enqueue({ type: 'deleteScheduleRule', payload: { ruleId } });
      await this.trySync();
    }
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
    await this.local.addScheduleEntries(entries);
    if (this.remote) {
      await this.queue.enqueue({ type: 'addScheduleEntries', payload: entries });
      await this.trySync();
    }
  }

  async updateScheduleEntry(entry: ScheduleEntry): Promise<void> {
    await this.local.updateScheduleEntry(entry);
    if (this.remote) {
      await this.queue.enqueue({ type: 'updateScheduleEntry', payload: entry });
      await this.trySync();
    }
  }

  async deleteScheduleEntry(entryId: string): Promise<void> {
    await this.local.deleteScheduleEntry(entryId);
    if (this.remote) {
      await this.queue.enqueue({ type: 'deleteScheduleEntry', payload: { entryId } });
      await this.trySync();
    }
  }

  async getWalks(familyId: string): Promise<Walk[]> {
    if (await this.isOnline()) {
      try {
        // Remote is authoritative while online. Mirror it into the local
        // cache before returning so stale locally-generated walk IDs cannot
        // survive a refresh and later reach start_walk()/finish_walk().
        const remoteWalks = await this.remote!.getWalks(familyId);
        const remoteIds = new Set(remoteWalks.map((walk) => walk.id));
        const localWalks = await this.local.getWalks(familyId);

        for (const walk of remoteWalks) {
          await this.local.saveWalk(walk);
        }
        for (const walk of localWalks) {
          if (!remoteIds.has(walk.id) && !(await this.queue.hasPendingSaveWalk(walk.id))) {
            await this.local.deleteWalk(walk.id);
          }
        }
        return remoteWalks;
      } catch {
        /* fall through */
      }
    }
    return this.local.getWalks(familyId);
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

  async deleteWalk(walkId: string): Promise<void> {
    await this.local.deleteWalk?.(walkId);
    if (this.remote) {
      await this.queue.enqueue({ type: 'deleteWalk', payload: { walkId } });
      await this.trySync();
    }
  }

  async getNotificationSettings(familyId: string): Promise<NotificationSetting[]> {
    return this.local.getNotificationSettings(familyId);
  }
}
