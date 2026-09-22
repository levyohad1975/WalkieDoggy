import NetInfo from '@react-native-community/netinfo';
import type {
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
import { SyncQueue } from './syncQueue';

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
          throw new Error('startWalk requires an internet connection and cannot be queued offline');
        }
        const walk = await this.remote!.startWalk!(walkId);
        await this.local.saveWalk(walk);
        return walk;
      };
      this.finishWalk = async (walkId, actualWalkerId, details) => {
        if (!(await this.isOnline())) {
          throw new Error('finishWalk requires an internet connection and cannot be queued offline');
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
    if (this.remote) {
      await this.queue.enqueue({ type: 'upsertUser', payload: user });
      await this.trySync();
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
        return await this.remote!.getWalks(familyId);
      } catch {
        /* fall through */
      }
    }
    return this.local.getWalks(familyId);
  }

  /** Always writable offline: saved locally immediately, then queued/synced when possible. */
  async saveWalk(walk: Walk): Promise<void> {
    await this.local.saveWalk(walk);
    if (this.remote) {
      await this.queue.enqueue({ type: 'saveWalk', payload: walk });
      await this.trySync();
    }
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
