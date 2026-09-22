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

/** Payload for Repository.deleteFamilyMember — see its doc comment below. */
export interface DeleteFamilyMemberPayload {
  userId: string;
  updatedRules: ScheduleRule[];
  updatedEntries: ScheduleEntry[];
  updatedWalks: Walk[];
}

/**
 * Data-access abstraction. The rest of the app (stores, screens) only talks
 * to this interface — never to Supabase or AsyncStorage directly — so the
 * backend can change (or an offline cache can sit in front of it) without
 * touching UI or business-logic code.
 *
 * `OfflineFirstRepository` (offlineFirstRepository.ts) is the concrete
 * implementation used by the app: it always reads/writes the local cache
 * first (so the UI works with no connection) and syncs to Supabase via
 * `SyncQueue` when a connection is available. `LocalRepository` alone is
 * used for tests and the "no backend configured yet" demo mode.
 */
export interface Repository {
  getFamily(familyId: string): Promise<Family | undefined>;

  getUsers(familyId: string): Promise<FamilyUser[]>;
  /**
   * SECURITY FIX (QA pass v3, issue 1): creates a BRAND-NEW family member
   * row. Split out from the old single `upsertUser()` because Supabase's
   * RLS enforces two DIFFERENT policies for `users` — INSERT is
   * admin-only (supabase/migrations/0003_family_admin_roles.sql), UPDATE
   * is self-or-admin on an active profile
   * (supabase/migrations/0004_*.sql) — and a generic `.upsert()` sends a
   * single `INSERT ... ON CONFLICT DO UPDATE` statement that Postgres
   * evaluates against the INSERT policy's `with check` even for the
   * ON-CONFLICT-UPDATE branch, so a non-admin's legitimate self-profile
   * edit (an existing row) was being rejected with 42501 as if it were an
   * unauthorized insert. Callers: familyStore.addUser() only (a real new
   * row, gated admin-only in the UI, and re-checked server-side by the
   * INSERT policy regardless).
   */
  createUser(user: FamilyUser): Promise<void>;
  /**
   * Updates an EXISTING family member row only (self-profile edit, or an
   * admin editing another member) — see `createUser`'s doc comment above
   * for why this is now a real UPDATE, not an upsert, in Supabase mode.
   * The server's UPDATE policy (self OR admin, active profiles only) is
   * the actual security boundary; this client-side split is defense in
   * depth so the client never even ATTEMPTS the wrong statement shape for
   * an existing row, not a substitute for RLS.
   */
  upsertUser(user: FamilyUser): Promise<void>;
  /**
   * Permanently removes a family member row. NOT used by the app's actual
   * "delete a family member" flow (see deleteFamilyMember below) — kept
   * only for interface completeness. Do not call this for real family-
   * member removal: schedule_entries.responsible_user_id and
   * walks.responsible_user_id are `on delete restrict`, so in Supabase mode
   * this fails outright (foreign_key_violation) for any user with real
   * history, and even in local/demo mode it would silently orphan history's
   * name/avatar lookups.
   */
  deleteUser(userId: string): Promise<void>;
  /**
   * Admin-only, atomic family-member deletion: applies the rotation
   * reassignment computed by `planUserRemoval` (updated rules/entries/
   * pending future walks — completed walks and past entries are never
   * touched, so history is preserved) and then SOFT-deletes the user
   * (marks `removedAt`, never an actual row DELETE — see FamilyUser.
   * removedAt's doc comment for why), as a single operation. In Supabase
   * mode this is one SECURITY DEFINER RPC call (see
   * supabase/migrations/0004_*.sql `admin_delete_family_member`) so the
   * reassignment and the soft-delete can never be left half-applied, and
   * the server independently re-checks that the caller is an admin of this
   * user's family — the client-side admin check in familyStore/FamilyScreen
   * is a UX convenience, not the security boundary. In local/demo mode this
   * just performs the same writes sequentially (a single device has no
   * concurrent-write/partial-failure risk to guard against).
   */
  deleteFamilyMember(payload: DeleteFamilyMemberPayload): Promise<void>;
  updateUserReminderSetting(userId: string, enabled: boolean): Promise<void>;

  /** @deprecated Returns an arbitrary one of the family's dogs once more than one exists (kept only for the single-dog call sites that predate multi-dog support). New code should use getDogs. */
  getDog(familyId: string): Promise<Dog | undefined>;
  /**
   * Every dog belonging to this family. The `dogs` table has no uniqueness
   * constraint on family_id, and schedule_rules/schedule_entries/walks
   * already carry their own dog_id (see supabase/schema.sql) — this is the
   * multi-dog-safe read; prefer it over getDog for any new code.
   */
  getDogs(familyId: string): Promise<Dog[]>;
  /** Upserts by dog.id — safe to call for any of a family's dogs, not just a single "the" dog. */
  upsertDog(dog: Dog): Promise<void>;

  /** Every health/grooming record (log entries + due tasks, PRD §10) for one specific dog — never the whole family, since these are always per-dog. */
  getHealthTasks(dogId: string): Promise<HealthTask[]>;
  /** Upserts by task.id — covers both creating a new log/task entry and marking one complete (patch + save). No delete: see 0049's migration comment for why a health record is never client-erasable. */
  upsertHealthTask(task: HealthTask): Promise<void>;

  /** The GPS session for one walk (PRD §7), if any tracking was attempted — undefined if the walk has no session at all. */
  getGpsSession(walkId: string): Promise<WalkGpsSession | undefined>;
  /** Upserts by session.walkId (one session per walk — see 0051's unique constraint). Covers creating the initial device-computed reading AND recording a correction. No delete: same "history record" posture as health tasks/dogs. */
  upsertGpsSession(session: WalkGpsSession): Promise<void>;

  getScheduleRules(familyId: string): Promise<ScheduleRule[]>;
  upsertScheduleRule(rule: ScheduleRule): Promise<void>;
  deleteScheduleRule(ruleId: string): Promise<void>;

  getScheduleEntries(familyId: string): Promise<ScheduleEntry[]>;
  addScheduleEntries(entries: ScheduleEntry[]): Promise<void>;
  /** Updates a single generated slot (e.g. a one-off time change or reassignment) without touching the rule it came from. */
  updateScheduleEntry(entry: ScheduleEntry): Promise<void>;
  deleteScheduleEntry(entryId: string): Promise<void>;

  getWalks(familyId: string): Promise<Walk[]>;
  saveWalk(walk: Walk): Promise<void>;
  /** Server-authoritative lifecycle operations; Supabase persists actor/time atomically. */
  startWalk?(walkId: string): Promise<Walk>;
  finishWalk?(walkId: string, actualWalkerId: string, details?: { hadPee?: boolean; hadPoop?: boolean; note?: string; completedAt?: string }): Promise<Walk>;
  /**
   * Section 2: permanently deletes an unplanned/spontaneous walk entered by
   * mistake. Callers (scheduleStore.deleteUnplannedWalk) must only call this
   * for `isUnplanned` walks — the Supabase implementation additionally
   * relies on the DB-layer trigger to enforce that server-side (a non-admin
   * DELETE on a non-unplanned or not-self-attributed walk is rejected there
   * regardless of what the client sends).
   */
  deleteWalk?(walkId: string): Promise<void>;

  getNotificationSettings(familyId: string): Promise<NotificationSetting[]>;

  /** Optional: implemented by offline-capable repositories to push queued writes when back online. No-op otherwise. */
  trySync?(): Promise<void>;
  /**
   * Optional: true when this device still has queued offline writes tagged
   * with a DIFFERENT claimed profile than `userId` (see
   * SyncQueue.hasPendingForOtherUser's doc comment for the audit-attribution
   * risk this guards against). Implemented by offline-capable repositories;
   * repositories with no queue (LocalRepository, a bare SupabaseRepository)
   * have nothing to flag, so this is safe to leave unimplemented — callers
   * treat a missing implementation the same as `false`.
   */
  hasPendingForOtherUser?(userId: string): Promise<boolean>;
  /** Optional (A2 fix): true if a saveWalk write for this walk id is still queued, not yet reconciled with the server. See SyncQueue.hasPendingSaveWalk's doc comment. */
  hasPendingSaveWalk?(walkId: string): Promise<boolean>;
  /** Optional (A2 fix): the most recent permanent-failure sync conflict recorded for this walk's saveWalk write, if any. */
  getConflictForWalk?(walkId: string): Promise<{ message: string; failedAt: string } | undefined>;
}

export class RepositoryError extends Error {}
