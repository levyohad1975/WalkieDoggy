import type { SupabaseClient } from '@supabase/supabase-js';
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
  WalkStartAuthorization,
  GpsRouteUpdate,
} from '../types';
import { defaultNotificationSetting } from '../logic/reminders';
import type { DeleteFamilyMemberPayload, DuplicateActiveWalkReviewRecord, Repository, ResolveDuplicateActiveWalksRequest, WalkDuplicateResolutionAudit } from './repository';
import { SUPABASE_CALL_TIMEOUT_MS, withTimeout } from '../lib/withTimeout';
// TEMPORARY DIAGNOSTIC INSTRUMENTATION — see perfTrace.ts's own doc
// comment. Remove this import and every perfMark call in
// upsertScheduleRule()/addScheduleEntries() once the real ~10s
// Schedule-save bottleneck is confirmed fixed by an actual real-device
// measurement.
import { perfMark } from '../lib/perfTrace';

/** Maps between the app's camelCase domain types and Supabase's snake_case rows. */

function toUser(row: any): FamilyUser {
  return {
    id: row.id,
    familyId: row.family_id,
    name: row.name,
    avatar: row.avatar,
    photoUrl: row.photo_url ?? undefined,
    color: row.color,
    remindersEnabled: row.reminders_enabled,
    gamificationEnabled: row.gamification_enabled,
    createdAt: row.created_at,
    removedAt: row.removed_at ?? undefined,
  };
}

function fromUser(user: FamilyUser) {
  return {
    id: user.id,
    family_id: user.familyId,
    name: user.name,
    avatar: user.avatar,
    photo_url: user.photoUrl ?? null,
    color: user.color,
    reminders_enabled: user.remindersEnabled,
    // Ordinary profile edits (name/photo/color) never go through this path
    // for a removed member — FamilyScreen filters them out of the roster —
    // but round-tripping removed_at here (rather than omitting it) means an
    // upsert can never accidentally clear it. Actual removal/undo is only
    // ever done via the admin_delete_family_member() RPC below.
    removed_at: user.removedAt ?? null,
  };
}

function toDog(row: any): Dog {
  return {
    id: row.id,
    familyId: row.family_id,
    name: row.name,
    photoUrl: row.photo_url ?? undefined,
    photoCutoutUrl: row.photo_cutout_url ?? undefined,
    heroBackgroundId: row.hero_background_id ?? undefined,
    walksPerDay: row.walks_per_day,
    notes: row.notes ?? undefined,
    sex: row.sex ?? undefined,
  };
}

function toRule(row: any): ScheduleRule {
  return {
    id: row.id,
    familyId: row.family_id,
    dogId: row.dog_id,
    time: row.time,
    label: row.label ?? undefined,
    daysOfWeek: row.days_of_week,
    rotationUserIds: row.rotation_user_ids,
    rotationAnchorDate: row.rotation_anchor_date,
    sortOrder: row.sort_order ?? 0,
    active: row.active,
    createdAt: row.created_at,
  };
}

function toEntry(row: any): ScheduleEntry {
  return {
    id: row.id,
    familyId: row.family_id,
    dogId: row.dog_id,
    ruleId: row.rule_id ?? undefined,
    date: row.date,
    time: row.time,
    responsibleUserId: row.responsible_user_id,
    createdAt: row.created_at,
    timeOverridden: row.time_overridden ?? false,
  };
}

/**
 * Exported (BATCH 3 CORRECTION #1): reused as-is by lib/permissionedWalks.ts
 * so the new list_history_walks()/list_statistics_walks() RPC wrappers map
 * rows through the exact same snake_case -> camelCase logic as every other
 * walks read in this app, rather than duplicating it.
 */
export function toWalk(row: any): Walk {
  return {
    id: row.id,
    familyId: row.family_id,
    scheduleEntryId: row.schedule_entry_id ?? undefined,
    dogId: row.dog_id,
    date: row.date,
    scheduledTime: row.scheduled_time,
    responsibleUserId: row.responsible_user_id,
    status: row.status,
    startedAt: row.started_at ?? undefined,
    startedByUserId: row.started_by_user_id ?? undefined,
    actualWalkerUserId: row.actual_walker_user_id ?? row.completed_by_user_id ?? undefined,
    duplicateResolutionGroupId: row.duplicate_resolution_group_id ?? undefined,
    completedAt: row.completed_at ?? undefined,
    completedByUserId: row.completed_by_user_id ?? undefined,
    endedByUserId: row.ended_by_user_id ?? undefined,
    hadPee: row.had_pee ?? undefined,
    hadPoop: row.had_poop ?? undefined,
    note: row.note ?? undefined,
    durationMinutes: row.duration_minutes ?? undefined,
    isUnplanned: row.is_unplanned ?? undefined,
    swap: row.swap_new_user_id
      ? {
          originalUserId: row.swap_original_user_id,
          newUserId: row.swap_new_user_id,
          swappedAt: row.swap_swapped_at,
          swappedByUserId: row.swap_swapped_by_user_id,
        }
      : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function isUuid(value?: string | null): value is string {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}
function fromWalk(walk: Walk) {
  return {
    id: walk.id,
    family_id: walk.familyId,
    schedule_entry_id: walk.scheduleEntryId ?? null,
    dog_id: walk.dogId,
    date: walk.date,
    scheduled_time: walk.scheduledTime,
    responsible_user_id: walk.responsibleUserId,
    status: walk.status,
    started_at: walk.startedAt ?? null,
    started_by_user_id: walk.startedByUserId ?? null,
    duplicate_resolution_group_id: walk.duplicateResolutionGroupId ?? null,
    completed_at: walk.completedAt ?? null,
    completed_by_user_id: walk.completedByUserId ?? null,
    ended_by_user_id: walk.endedByUserId ?? null,
    had_pee: walk.hadPee ?? null,
    had_poop: walk.hadPoop ?? null,
    note: walk.note ?? null,
    duration_minutes: walk.durationMinutes ?? null,
    is_unplanned: walk.isUnplanned ?? false,
    swap_original_user_id: walk.swap?.originalUserId ?? null,
    swap_new_user_id: walk.swap?.newUserId ?? null,
    swap_swapped_at: walk.swap?.swappedAt ?? null,
    swap_swapped_by_user_id: isUuid(walk.swap?.swappedByUserId)
  ? walk.swap.swappedByUserId
  : null,
  };
}

function fromRule(rule: ScheduleRule) {
  return {
    id: rule.id,
    family_id: rule.familyId,
    dog_id: rule.dogId,
    time: rule.time,
    label: rule.label ?? null,
    days_of_week: rule.daysOfWeek,
    rotation_user_ids: rule.rotationUserIds,
    rotation_anchor_date: rule.rotationAnchorDate,
    sort_order: rule.sortOrder,
    active: rule.active,
  };
}

function fromEntry(entry: ScheduleEntry) {
  return {
    id: entry.id,
    family_id: entry.familyId,
    dog_id: entry.dogId,
    rule_id: entry.ruleId ?? null,
    date: entry.date,
    time: entry.time,
    responsible_user_id: entry.responsibleUserId,
    time_overridden: entry.timeOverridden ?? false,
  };
}

function toHealthTask(row: any): HealthTask {
  return {
    id: row.id,
    familyId: row.family_id,
    dogId: row.dog_id,
    category: row.category,
    title: row.title,
    notes: row.notes ?? undefined,
    weightKg: row.weight_kg ?? undefined,
    recurrenceIntervalDays: row.recurrence_interval_days ?? undefined,
    dueDate: row.due_date ?? undefined,
    completedAt: row.completed_at ?? undefined,
    completedByUserId: row.completed_by_user_id ?? undefined,
    responsibleUserId: row.responsible_user_id ?? undefined,
    createdByUserId: row.created_by_user_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fromHealthTask(task: HealthTask) {
  return {
    id: task.id,
    family_id: task.familyId,
    dog_id: task.dogId,
    category: task.category,
    title: task.title,
    notes: task.notes ?? null,
    weight_kg: task.weightKg ?? null,
    recurrence_interval_days: task.recurrenceIntervalDays ?? null,
    due_date: task.dueDate ?? null,
    completed_at: task.completedAt ?? null,
    completed_by_user_id: task.completedByUserId ?? null,
    responsible_user_id: task.responsibleUserId ?? null,
    created_by_user_id: task.createdByUserId ?? null,
  };
}

function toGpsSession(row: any): WalkGpsSession {
  return {
    id: row.id,
    walkId: row.walk_id,
    familyId: row.family_id,
    dogId: row.dog_id,
    distanceMeters: row.distance_meters ?? undefined,
    pointCount: row.point_count,
    routePoints: Array.isArray(row.route_points) ? row.route_points : undefined,
    correctedDistanceMeters: row.corrected_distance_meters ?? undefined,
    correctedByUserId: row.corrected_by_user_id ?? undefined,
    startedAt: row.started_at ?? undefined,
    endedAt: row.ended_at ?? undefined,
    source: row.source,
    createdByUserId: row.created_by_user_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fromGpsSession(session: WalkGpsSession) {
  return {
    id: session.id,
    walk_id: session.walkId,
    family_id: session.familyId,
    dog_id: session.dogId,
    distance_meters: session.distanceMeters ?? null,
    point_count: session.pointCount,
    route_points: session.routePoints ?? null,
    corrected_distance_meters: session.correctedDistanceMeters ?? null,
    corrected_by_user_id: session.correctedByUserId ?? null,
    started_at: session.startedAt ?? null,
    ended_at: session.endedAt ?? null,
    source: session.source,
    created_by_user_id: session.createdByUserId ?? null,
  };
}

function toAchievementUnlock(row: any): AchievementUnlock {
  return {
    id: row.id,
    familyId: row.family_id,
    achievementKey: row.achievement_key,
    scope: row.scope,
    userId: row.user_id ?? undefined,
    unlockedAt: row.unlocked_at,
    createdAt: row.created_at,
  };
}

function fromAchievementUnlock(unlock: AchievementUnlock) {
  return {
    id: unlock.id,
    family_id: unlock.familyId,
    achievement_key: unlock.achievementKey,
    scope: unlock.scope,
    user_id: unlock.userId ?? null,
    unlocked_at: unlock.unlockedAt,
  };
}

function fromDog(dog: Dog) {
  return {
    id: dog.id,
    family_id: dog.familyId,
    name: dog.name,
    photo_url: dog.photoUrl ?? null,
    photo_cutout_url: dog.photoCutoutUrl ?? null,
    hero_background_id: dog.heroBackgroundId ?? null,
    walks_per_day: dog.walksPerDay,
    notes: dog.notes ?? null,
    sex: dog.sex ?? null,
  };
}

/**
 * Talks to Supabase directly. Row Level Security (see supabase/schema.sql)
 * scopes every query to the caller's own family — this class never needs to
 * (and never should) pass an arbitrary family_id from the client as a
 * security boundary; it's used for display/filtering only.
 */
export class SupabaseRepository implements Repository {
  constructor(private client: SupabaseClient) {}

  async getFamily(familyId: string): Promise<Family | undefined> {
    const { data, error } = await this.client.from('families').select('*').eq('id', familyId).maybeSingle();
    if (error) throw error;
    return data
      ? {
          id: data.id,
          name: data.name,
          inviteCode: data.invite_code ?? undefined,
          timezone: data.timezone ?? undefined,
          spontaneousAssociationWindowMinutes: data.spontaneous_association_window_minutes ?? undefined,
          createdAt: data.created_at,
        }
      : undefined;
  }

  async getUsers(familyId: string): Promise<FamilyUser[]> {
    const { data, error } = await this.client.from('users').select('*').eq('family_id', familyId);
    if (error) throw error;
    return (data ?? []).map(toUser);
  }

  /**
   * INSERT-only (see Repository.createUser's doc comment) — a brand-new
   * family member row. RLS (0003_family_admin_roles.sql) requires the
   * caller to be a family admin; a non-admin attempting this gets a real
   * 42501 here, which is correct (not the bug this pass fixes — the bug
   * was an existing-row UPDATE incorrectly going through this same
   * INSERT-checked path via `.upsert()`).
   */
  async createUser(user: FamilyUser): Promise<void> {
    const { error } = await this.client.from('users').insert(fromUser(user));
    if (error) throw error;
  }

  /**
   * UPDATE-only (see Repository.upsertUser's doc comment) — an EXISTING
   * family member row. Previously `.upsert()`, which sends a single
   * `INSERT ... ON CONFLICT DO UPDATE` that Postgres checks against the
   * INSERT policy even on the update branch — that policy is admin-only,
   * so a member's own legitimate self-profile edit (existing row) was
   * rejected with 42501. `.update().eq('id', ...)` is checked against the
   * UPDATE policy instead (self OR admin, active profiles only), which is
   * the policy that actually applies here. `fromUser()` does round-trip
   * `removed_at` (see its own comment — deliberately, so an ordinary
   * profile-edit upsert can never silently omit/clear it by accident),
   * but the UPDATE policy's `with check (... removed_at is null ...)`
   * means any attempt where the row's `removed_at` isn't (and stays) null
   * fails the statement outright rather than succeeding with a changed
   * value — this method still can't actually set or clear it, just via
   * the whole write being rejected rather than the column being silently
   * dropped.
   *
   * BACKWARD-COMPAT FALLBACK (QA pass v3, issue 1): a device that queued an
   * `upsertUser` SyncQueue item BEFORE this fix shipped may have queued it
   * for what was, at the time, a brand-new row (offline-created member
   * awaiting first sync) — `syncQueue.ts` still replays those legacy items
   * through this same method (see its `apply()`/SyncOperation doc comments)
   * rather than trying to reclassify them, since there is no reliable way to
   * tell create-intent from update-intent after the fact from the payload
   * alone. `.update()` on a row `id` that doesn't exist yet is NOT an error
   * — PostgREST just reports zero rows affected — so without this fallback
   * that legacy create would silently vanish (no thrown error, no row
   * written). `.select('id')` reports which rows were actually matched;
   * when none were, this falls back to a real `.insert()` (checked against
   * the admin-only INSERT policy, exactly like `createUser` above — a
   * legacy self-queued "create" for a non-admin's own new row would still
   * correctly fail here if that's genuinely not allowed, which matches
   * `createUser`'s own documented behavior).
   */
  async upsertUser(user: FamilyUser): Promise<void> {
    const { data, error } = await this.client
      .from('users')
      .update(fromUser(user))
      .eq('id', user.id)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) {
      const { error: insertError } = await this.client.from('users').insert(fromUser(user));
      if (insertError) throw insertError;
    }
  }

  /**
   * Direct client DELETE on `users` is blocked by RLS as of
   * supabase/migrations/0003_family_admin_roles.sql — this will always fail
   * server-side. Kept only to satisfy the Repository interface; real
   * deletion goes through deleteFamilyMember() below.
   */
  async deleteUser(userId: string): Promise<void> {
    const { error } = await this.client.from('users').delete().eq('id', userId);
    if (error) throw error;
  }

  /**
   * Admin-only, atomic deletion via the `admin_delete_family_member`
   * SECURITY DEFINER RPC (supabase/migrations/0004_*.sql). The RPC
   * re-verifies the caller is an admin of this user's family and applies
   * the rotation reassignment + the user delete as one transaction — the
   * client never gets a state where reassignment succeeded but the user
   * wasn't removed (or vice versa).
   */
  async deleteFamilyMember({ userId, updatedRules, updatedEntries, updatedWalks }: DeleteFamilyMemberPayload): Promise<void> {
    const { error } = await this.client.rpc('admin_delete_family_member', {
      target_user_id: userId,
      rule_updates: updatedRules.map((r) => ({ id: r.id, rotation_user_ids: r.rotationUserIds })),
      entry_updates: updatedEntries.map((e) => ({ id: e.id, responsible_user_id: e.responsibleUserId })),
      walk_updates: updatedWalks.map((w) => ({ id: w.id, responsible_user_id: w.responsibleUserId })),
    });
    if (error) throw error;
  }

  async updateUserReminderSetting(userId: string, enabled: boolean): Promise<void> {
    const { error } = await this.client.from('users').update({ reminders_enabled: enabled }).eq('id', userId);
    if (error) throw error;
  }

  async updateUserGamificationSetting(userId: string, enabled: boolean): Promise<void> {
    const { error } = await this.client.from('users').update({ gamification_enabled: enabled }).eq('id', userId);
    if (error) throw error;
  }

  async getDog(familyId: string): Promise<Dog | undefined> {
    const { data, error } = await this.client.from('dogs').select('*').eq('family_id', familyId).maybeSingle();
    if (error) throw error;
    return data ? toDog(data) : undefined;
  }

  async getDogs(familyId: string): Promise<Dog[]> {
    const { data, error } = await this.client.from('dogs').select('*').eq('family_id', familyId);
    if (error) throw error;
    return (data ?? []).map(toDog);
  }

  async upsertDog(dog: Dog): Promise<void> {
    // Existing dog profile edits (including the shared Home background) are
    // UPDATEs, not INSERTs. Using UPSERT here made every edit also require
    // the table's INSERT policy; on staging that can reject an otherwise
    // valid admin edit, leaving OfflineFirstRepository to queue it while a
    // subsequent online reload fetches the old background again.
    const row = fromDog(dog);
    const { data, error: updateError } = await this.client
      .from('dogs')
      .update(row)
      .eq('id', dog.id)
      .select('id');
    if (updateError) throw updateError;
    if ((data ?? []).length > 0) return;

    // No existing row: this is genuinely a newly-added dog.
    const { error: insertError } = await this.client.from('dogs').insert(row);
    if (insertError) throw insertError;
  }

  async getHealthTasks(dogId: string): Promise<HealthTask[]> {
    const { data, error } = await this.client.from('health_tasks').select('*').eq('dog_id', dogId);
    if (error) throw error;
    return (data ?? []).map(toHealthTask);
  }

  async upsertHealthTask(task: HealthTask): Promise<void> {
    const { error } = await this.client.from('health_tasks').upsert(fromHealthTask(task));
    if (error) throw error;
  }

  async deleteHealthTask(taskId: string): Promise<void> {
    const { data, error } = await this.client.from('health_tasks').delete().eq('id', taskId).is('completed_at', null).select('id');
    if (error) throw error;
    if ((data ?? []).length !== 1) throw new Error('Open health task was not deleted or is no longer authorized');
  }

  async getGpsSession(walkId: string): Promise<WalkGpsSession | undefined> {
    const { data, error } = await this.client.from('walk_gps_sessions').select('*').eq('walk_id', walkId).maybeSingle();
    if (error) throw error;
    const { data: owner, error: ownerError } = await this.client.from('walk_gps_ownership').select('distance_meters,point_count,route_started_at,route_ended_at').eq('walk_id', walkId).maybeSingle();
    if (ownerError) throw ownerError;
    if (!data && !owner) return undefined;
    const session = data ? toGpsSession(data) : {
      id: walkId, walkId, familyId: '', dogId: '', pointCount: 0, source: 'device_gps' as const, createdAt: '', updatedAt: '',
    };
    if (!owner) return session;
    const { data: points, error: pointsError } = await this.client.from('walk_gps_route_samples_v11').select('latitude,longitude,point_timestamp_ms').eq('walk_id', walkId).order('point_timestamp_ms', { ascending: true });
    if (pointsError) throw pointsError;
    return {
      ...session,
      distanceMeters: owner.distance_meters == null ? undefined : Number(owner.distance_meters),
      pointCount: Number(owner.point_count ?? 0),
      startedAt: owner.route_started_at ?? session.startedAt,
      endedAt: owner.route_ended_at ?? session.endedAt,
      // Once v1.1 owns this walk's session, render only fenced v1.1 points;
      // a legacy direct session upsert cannot inject coordinates into it.
      routePoints: (points ?? []).map((point: any) => ({ latitude: Number(point.latitude), longitude: Number(point.longitude), timestamp: Number(point.point_timestamp_ms) })),
    };
  }

  async upsertGpsSession(session: WalkGpsSession): Promise<void> {
    // Conflict target is walk_id (its own unique constraint, 0051), not the
    // primary key `id` — a re-save (e.g. recording a correction after the
    // initial device-computed reading) must update the SAME row for this
    // walk rather than erroring on walk_id's uniqueness with a fresh id.
    const { error } = await this.client.from('walk_gps_sessions').upsert(fromGpsSession(session), { onConflict: 'walk_id' });
    if (error) throw error;
  }

  async getGpsSessionsForWalkIds(walkIds: string[]): Promise<WalkGpsSession[]> {
    if (walkIds.length === 0) return [];
    const { data, error } = await this.client.from('walk_gps_sessions').select('*').in('walk_id', walkIds);
    if (error) throw error;
    const sessions = new Map<string, WalkGpsSession>((data ?? []).map((row: any) => [row.walk_id, toGpsSession(row)]));
    const { data: owners, error: ownerError } = await this.client.from('walk_gps_ownership')
      .select('walk_id,family_id,dog_id,distance_meters,point_count,route_started_at,route_ended_at').in('walk_id', walkIds);
    if (ownerError) throw ownerError;
    if (!owners?.length) return [...sessions.values()];
    const ownerIds = owners.map((owner: any) => owner.walk_id);
    const { data: points, error: pointsError } = await this.client.from('walk_gps_route_samples_v11')
      .select('walk_id,latitude,longitude,point_timestamp_ms').in('walk_id', ownerIds).order('point_timestamp_ms', { ascending: true });
    if (pointsError) throw pointsError;
    const pointsByWalk = new Map<string, Array<{ latitude: number; longitude: number; timestamp: number }>>();
    for (const point of points ?? []) {
      const route = pointsByWalk.get(point.walk_id) ?? [];
      route.push({ latitude: Number(point.latitude), longitude: Number(point.longitude), timestamp: Number(point.point_timestamp_ms) });
      pointsByWalk.set(point.walk_id, route);
    }
    for (const owner of owners) {
      const existing = sessions.get(owner.walk_id);
      sessions.set(owner.walk_id, {
        id: existing?.id ?? owner.walk_id,
        walkId: owner.walk_id,
        familyId: existing?.familyId ?? owner.family_id,
        dogId: existing?.dogId ?? owner.dog_id,
        distanceMeters: owner.distance_meters == null ? undefined : Number(owner.distance_meters),
        pointCount: Number(owner.point_count ?? 0),
        routePoints: pointsByWalk.get(owner.walk_id) ?? [],
        startedAt: owner.route_started_at ?? existing?.startedAt,
        endedAt: owner.route_ended_at ?? existing?.endedAt,
        correctedDistanceMeters: existing?.correctedDistanceMeters,
        correctedByUserId: existing?.correctedByUserId,
        source: existing?.source ?? 'device_gps',
        createdByUserId: existing?.createdByUserId,
        createdAt: existing?.createdAt ?? owner.route_started_at ?? '',
        updatedAt: existing?.updatedAt ?? owner.route_ended_at ?? owner.route_started_at ?? '',
      });
    }
    return [...sessions.values()];
  }

  async getAchievementUnlocks(familyId: string): Promise<AchievementUnlock[]> {
    const { data, error } = await this.client.from('achievement_unlocks').select('*').eq('family_id', familyId);
    if (error) throw error;
    return (data ?? []).map(toAchievementUnlock);
  }

  async upsertAchievementUnlock(unlock: AchievementUnlock): Promise<void> {
    // Conflict target is (family_id, dedupe_key) — 0052's generated column +
    // unique constraint — so a duplicate unlock attempt (two devices
    // crossing the same threshold, or a retried write) is silently a no-op
    // rather than a constraint-violation error.
    const { error } = await this.client
      .from('achievement_unlocks')
      .upsert(fromAchievementUnlock(unlock), { onConflict: 'family_id,dedupe_key', ignoreDuplicates: true });
    if (error) throw error;
  }

  async getScheduleRules(familyId: string): Promise<ScheduleRule[]> {
    const { data, error } = await this.client.from('schedule_rules').select('*').eq('family_id', familyId);
    if (error) throw error;
    return (data ?? []).map(toRule);
  }

  async upsertScheduleRule(rule: ScheduleRule): Promise<void> {
    // Editing an existing rule must only require UPDATE permission. UPSERT
    // also exercises INSERT policy and could therefore make a valid edit
    // appear saved locally, then disappear after the next server reload.
    // Real-device QA fix — see withTimeout.ts's own doc comment: a stalled
    // call here must reject (and surface/queue like any other transient
    // failure), never hang the caller's `saving` state forever.
    const row = fromRule(rule);
    perfMark('SR.upsertScheduleRule: update request start');
    const { data, error: updateError } = await withTimeout(
      this.client.from('schedule_rules').update(row).eq('id', rule.id).select('id'),
      SUPABASE_CALL_TIMEOUT_MS,
      'schedule_rules update'
    );
    perfMark('SR.upsertScheduleRule: update request complete');
    if (updateError) throw updateError;
    if ((data ?? []).length > 0) return;

    perfMark('SR.upsertScheduleRule: insert request start');
    const { error: insertError } = await withTimeout(
      this.client.from('schedule_rules').insert(row),
      SUPABASE_CALL_TIMEOUT_MS,
      'schedule_rules insert'
    );
    perfMark('SR.upsertScheduleRule: insert request complete');
    if (insertError) throw insertError;
  }

  async deleteScheduleRule(ruleId: string): Promise<void> {
    // DELETE ... RETURNING hides both absent rows and rows outside the
    // caller's RLS scope. The RPC checks the authenticated active family,
    // resolves only globally absent rules as idempotent, and delegates an
    // existing same-family rule to the existing admin deletion workflow.
    const { data, error, status } = await this.client.rpc('delete_schedule_rule_idempotent', {
      p_rule_id: ruleId,
    });
    if (error) {
      const enrichedError: Error & { code?: string; status?: number; syncQueueRetryable?: boolean } = Object.assign(
        new Error(error.message || 'Schedule rule delete failed'),
        error,
        { status: status ?? (error as { status?: number }).status }
      );
      // Keep family/admin context failures in FIFO for a safe retry; never
      // report an authorization failure as a successful deletion.
      if (error.code === '42501') enrichedError.syncQueueRetryable = true;
      throw enrichedError;
    }
    if (data !== 'deleted' && data !== 'already_absent') {
      throw new Error('Schedule rule delete returned an unrecognized result');
    }
  }

  async getScheduleEntries(familyId: string): Promise<ScheduleEntry[]> {
    const { data, error } = await this.client.from('schedule_entries').select('*').eq('family_id', familyId);
    if (error) throw error;
    return (data ?? []).map(toEntry);
  }

  async addScheduleEntries(entries: ScheduleEntry[]): Promise<void> {
    if (entries.length === 0) return;
    // Real-device QA fix — see withTimeout.ts's own doc comment. This is
    // called once per addRule()/updateRule(), but is itself two sequential
    // network calls — either one stalling with no timeout is one of the
    // concrete hang points identified in that bug.
    const rows = entries.map(fromEntry);
    perfMark(`SR.addScheduleEntries: upsert request start (${rows.length} rows)`);
    const { error } = await withTimeout(
      this.client.from('schedule_entries').upsert(rows, {
        onConflict: 'dog_id,date,time',
        ignoreDuplicates: true,
      }),
      SUPABASE_CALL_TIMEOUT_MS,
      'schedule_entries upsert'
    );
    perfMark('SR.addScheduleEntries: upsert request complete');
    if (error) throw error;

    // The unique key is (dog_id,date,time), so ignoreDuplicates can keep an
    // already-existing canonical row whose id differs from the locally
    // generated id. A dependent walk must reference that canonical server id,
    // not the discarded generated id. Re-read the touched keys and copy the
    // authoritative ids back into the caller's entry objects before
    // scheduleStore creates child walks from them.
    const dogIds = [...new Set(rows.map((row) => row.dog_id))];
    const dates = [...new Set(rows.map((row) => row.date))];
    const times = [...new Set(rows.map((row) => row.time))];
    perfMark('SR.addScheduleEntries: canonical-id read-back start');
    const { data: canonicalRows, error: readError } = await withTimeout(
      this.client
        .from('schedule_entries')
        .select('id,dog_id,date,time')
        .in('dog_id', dogIds)
        .in('date', dates)
        .in('time', times),
      SUPABASE_CALL_TIMEOUT_MS,
      'schedule_entries canonical-id read-back'
    );
    perfMark('SR.addScheduleEntries: canonical-id read-back complete');
    if (readError) throw readError;

    const canonicalByKey = new Map(
      (canonicalRows ?? []).map((row) => [`${row.dog_id}|${row.date}|${row.time}`, row.id])
    );
    for (const entry of entries) {
      const canonicalId = canonicalByKey.get(`${entry.dogId}|${entry.date}|${entry.time}`);
      if (!canonicalId) throw new Error('Schedule entry was not persisted authoritatively');
      entry.id = canonicalId;
    }
  }

  async updateScheduleEntry(entry: ScheduleEntry): Promise<void> {
    const { error } = await this.client.from('schedule_entries').upsert(fromEntry(entry));
    if (error) throw error;
  }

  async deleteScheduleEntry(entryId: string): Promise<void> {
    // DELETE ... RETURNING can yield an empty representation both when the
    // entry is already gone and when RLS hides it. Let the server distinguish
    // those cases atomically under the authenticated active-family context.
    const { data, error, status } = await this.client.rpc('delete_schedule_entry_idempotent', {
      p_entry_id: entryId,
    });
    if (error) {
      const enrichedError: Error & { code?: string; status?: number; syncQueueRetryable?: boolean } = Object.assign(
        new Error(error.message || 'Schedule entry delete failed'),
        error,
        { status: status ?? (error as { status?: number }).status }
      );
      // Keep authorization/context failures in FIFO for safe retry after the
      // correct family context is restored; they are never treated as deletes.
      if (error.code === '42501') enrichedError.syncQueueRetryable = true;
      throw enrichedError;
    }
    if (data !== 'deleted' && data !== 'already_absent') {
      throw new Error('Schedule entry delete returned an unrecognized result');
    }
  }

  async getWalks(familyId: string): Promise<Walk[]> {
    const { data, error } = await this.client.from('walks').select('*').eq('family_id', familyId);
    if (error) throw error;
    return (data ?? []).map(toWalk);
  }

  async getWalkDuplicateResolutionAudit(familyId: string): Promise<WalkDuplicateResolutionAudit[]> {
    const { data, error } = await this.client.from('walk_duplicate_resolution_groups')
      .select('id,created_at,created_by_user_id,dog_id,canonical_walk_id,rationale,walk_duplicate_resolution_items(walk_id,disposition,original_walk,linked_gps_session_ids)')
      .eq('family_id', familyId).order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((group: any) => ({
      id: group.id,
      createdAt: group.created_at,
      createdByUserId: group.created_by_user_id,
      dogId: group.dog_id,
      canonicalWalkId: group.canonical_walk_id ?? null,
      rationale: group.rationale,
      items: (group.walk_duplicate_resolution_items ?? []).map((item: any) => ({
        walkId: item.walk_id,
        disposition: item.disposition,
        originalWalk: item.original_walk,
        linkedGpsSessionIds: item.linked_gps_session_ids ?? [],
      })),
    }));
  }

  async getDuplicateActiveWalkReview(familyId: string, walkIds: string[]): Promise<DuplicateActiveWalkReviewRecord[]> {
    if (walkIds.length === 0) return [];
    const { data: walks, error: walkError } = await this.client.from('walks')
      .select('id,family_id,dog_id,status,started_at,started_by_user_id,actual_walker_user_id,responsible_user_id,duplicate_resolution_group_id')
      .eq('family_id', familyId).in('id', walkIds);
    if (walkError) throw walkError;
    const rows = walks ?? [];
    if (rows.length === 0) return [];
    const returnedWalkIds = rows.map((row: any) => row.id);
    const { data: sessions, error: sessionError } = await this.client.from('walk_gps_sessions')
      .select('id,walk_id,point_count,distance_meters,started_at,ended_at,created_by_user_id')
      .eq('family_id', familyId).in('walk_id', returnedWalkIds);
    if (sessionError) throw sessionError;
    const sessionsByWalk = new Map<string, DuplicateActiveWalkReviewRecord['gpsSessions']>();
    for (const session of sessions ?? []) {
      const list = sessionsByWalk.get(session.walk_id) ?? [];
      list.push({
        id: session.id,
        pointCount: Number(session.point_count ?? 0),
        distanceMeters: session.distance_meters == null ? undefined : Number(session.distance_meters),
        startedAt: session.started_at ?? undefined,
        endedAt: session.ended_at ?? undefined,
        createdByUserId: session.created_by_user_id ?? undefined,
      });
      sessionsByWalk.set(session.walk_id, list);
    }
    const rowsById = new Map<string, any>(rows.map((row: any) => [row.id, row]));
    return walkIds.flatMap((walkId) => {
      const row = rowsById.get(walkId);
      return row ? [{
        walkId: row.id,
        familyId: row.family_id,
        dogId: row.dog_id,
        status: row.status,
        startedAt: row.started_at ?? undefined,
        startedByUserId: row.started_by_user_id ?? undefined,
        actualWalkerUserId: row.actual_walker_user_id ?? undefined,
        responsibleUserId: row.responsible_user_id,
        duplicateResolutionGroupId: row.duplicate_resolution_group_id ?? undefined,
        gpsSessions: sessionsByWalk.get(row.id) ?? [],
      }] : [];
    });
  }

  async resolveDuplicateActiveWalksV12(request: ResolveDuplicateActiveWalksRequest): Promise<string> {
    const { data, error } = await this.client.rpc('resolve_duplicate_active_walks_v12', {
      p_walk_ids: request.walkIds,
      p_canonical_walk_id: request.canonicalWalkId,
      p_rationale: request.rationale,
      p_operation_id: request.operationId,
    });
    if (error) throw error;
    if (typeof data !== 'string' || !data) throw new Error('Duplicate resolution RPC returned an invalid audit group id');
    return data;
  }

  /**
   * Handles the "two people mark done at once" race atomically: the update
   * is conditioned on the row still being 'pending' server-side, so whichever
   * request lands second simply affects 0 rows instead of overwriting the
   * first person's completion.
   */
  async startWalk(walkId: string): Promise<Walk> {
    const { data, error } = await this.client.rpc('start_walk', { target_walk_id: walkId });
    if (error) throw error;
    return toWalk(data);
  }

  private async dispatchWalkLifecycleNotification(walkId: string): Promise<void> {
    if (!this.client.functions?.invoke) return;
    try {
      const { data, error } = await this.client.functions.invoke('send-walk-lifecycle-notification', { body: { walkId } });
      if (error || !data?.providerAccepted) {
        // Lifecycle success is independent from push delivery. The outbox
        // records a failed/pending send; never report delivery as successful.
        console.warn('[walkLifecycle] notification was not provider-confirmed', { walkId, reason: error?.message ?? data?.reason });
      }
    } catch (error) {
      console.warn('[walkLifecycle] notification dispatch failed', { walkId, error });
    }
  }

  async startWalkV11(walkId: string, authorization: WalkStartAuthorization): Promise<Walk> {
    const { data, error } = await this.client.rpc('start_walk_v11', {
      p_walk_id: walkId,
      p_expected_actor_id: authorization.actorUserId ?? authorization.actualWalkerUserId,
      p_actual_walker_id: authorization.actualWalkerUserId,
      p_operation_id: authorization.operationId,
      p_substitution_confirmed: authorization.substitutionConfirmed ?? false,
      p_remote_start: authorization.remoteStart ?? false,
    });
    if (error) throw error;
    const walk = toWalk(data);
    if (authorization.remoteStart) await this.dispatchWalkLifecycleNotification(walk.id);
    return walk;
  }

  async startSpontaneousWalkV11(walk: Walk, operationId: string, actorUserId = walk.responsibleUserId): Promise<Walk> {
    const { data, error } = await this.client.rpc('start_spontaneous_walk_v11', {
      p_walk_id: walk.id,
      p_family_id: walk.familyId,
      p_dog_id: walk.dogId,
      p_date: walk.date,
      p_scheduled_time: walk.scheduledTime,
      p_expected_actor_id: actorUserId,
      p_operation_id: operationId,
    });
    if (error) throw error;
    return toWalk(data);
  }

  async finishWalk(walkId: string, actualWalkerId: string, details: { hadPee?: boolean; hadPoop?: boolean; note?: string; completedAt?: string } = {}): Promise<Walk> {
    const { data, error } = await this.client.rpc('finish_walk', {
      target_walk_id: walkId,
      actual_walker_id: actualWalkerId,
      p_had_pee: details.hadPee ?? null,
      p_had_poop: details.hadPoop ?? null,
      p_note: details.note ?? null,
      p_completed_at: details.completedAt ?? null,
    });
    if (error) throw error;
    return toWalk(data);
  }

  async finishWalkV11(walkId: string, actualWalkerId: string, operationId: string, details: { hadPee?: boolean; hadPoop?: boolean; note?: string; completedAt?: string; remoteConfirmation?: boolean; actorUserId?: string } = {}): Promise<Walk> {
    const { data, error } = await this.client.rpc('finish_walk_v11', {
      p_walk_id: walkId,
      p_expected_actor_id: details.actorUserId ?? actualWalkerId,
      p_actual_walker_id: actualWalkerId,
      p_operation_id: operationId,
      p_had_pee: details.hadPee ?? null,
      p_had_poop: details.hadPoop ?? null,
      p_note: details.note ?? null,
      p_completed_at: details.completedAt ?? null,
      p_remote_confirmation: details.remoteConfirmation ?? false,
    });
    if (error) throw error;
    const walk = toWalk(data);
    if (details.remoteConfirmation) await this.dispatchWalkLifecycleNotification(walk.id);
    return walk;
  }

  async acquireGpsOwnershipV11(walkId: string, confirmTransfer = false): Promise<{ fencingEpoch: number; expiresAt: string }> {
    const { data, error } = await this.client.rpc('acquire_walk_gps_ownership_v11', { p_walk_id: walkId, p_confirm_transfer: confirmTransfer });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.fencing_epoch !== 'number' || typeof row.expires_at !== 'string') throw new Error('GPS ownership response was invalid');
    return { fencingEpoch: row.fencing_epoch, expiresAt: row.expires_at };
  }

  async heartbeatGpsOwnershipV11(walkId: string, fencingEpoch: number): Promise<string> {
    const { data, error } = await this.client.rpc('heartbeat_walk_gps_ownership_v11', { p_walk_id: walkId, p_fencing_epoch: fencingEpoch });
    if (error) throw error;
    if (typeof data !== 'string') throw new Error('GPS ownership heartbeat response was invalid');
    return data;
  }

  async releaseGpsOwnershipV11(walkId: string, fencingEpoch: number): Promise<void> {
    const { error } = await this.client.rpc('release_walk_gps_ownership_v11', { p_walk_id: walkId, p_fencing_epoch: fencingEpoch });
    if (error) throw error;
  }

  async appendGpsRouteV11(update: GpsRouteUpdate): Promise<WalkGpsSession> {
    const { data, error } = await this.client.rpc('append_walk_gps_route_v11', {
      p_walk_id: update.walkId,
      p_fencing_epoch: update.fencingEpoch,
      p_points: update.points,
      p_distance_meters: update.distanceMeters,
      p_point_count: update.pointCount,
      p_started_at: update.startedAt ?? null,
      p_ended_at: update.endedAt ?? null,
    });
    if (error) throw error;
    return (await this.getGpsSession(update.walkId)) ?? toGpsSession(data);
  }

  async saveWalk(walk: Walk): Promise<void> {
    // Keep the queued source object untouched until the server confirms the
    // write. This lets a transient failure retry with the original payload.
    const walkToPersist: Walk = { ...walk };

    // A schedule edit/removal on another device can leave a locally queued
    // walk pointing at a schedule_entries row that no longer exists. The FK
    // then rejects the entire walk write (23503). Preserve the walk's history
    // fields and stable id, but persist it as a standalone walk when the
    // optional schedule relation is genuinely absent in this family.
    if (walkToPersist.scheduleEntryId) {
      const scheduleEntryAbort = new AbortController();
      const scheduleEntryQuery = this.client
        .from('schedule_entries')
        .select('id')
        .eq('id', walkToPersist.scheduleEntryId)
        .eq('family_id', walkToPersist.familyId);
      // The timeout must also cancel the underlying fetch. Racing only the
      // promise leaves a dead request occupying the browser's connection
      // pool while the offline queue retries this same FIFO item later.
      const abortableScheduleEntryQuery =
        typeof scheduleEntryQuery.abortSignal === 'function'
          ? scheduleEntryQuery.abortSignal(scheduleEntryAbort.signal)
          : scheduleEntryQuery;
      const { data: scheduleEntry, error: scheduleEntryError, status: scheduleEntryStatus } = await withTimeout(
        abortableScheduleEntryQuery.maybeSingle(),
        SUPABASE_CALL_TIMEOUT_MS,
        'schedule_entries lookup for queued walk',
        () => scheduleEntryAbort.abort()
      );
      if (scheduleEntryError) throw Object.assign(scheduleEntryError, { status: scheduleEntryStatus });
      if (!scheduleEntry) walkToPersist.scheduleEntryId = undefined;
    }

    // Real-device QA fix — see withTimeout.ts's own doc comment.
    // addRule()/updateRule() call this once PER generated occurrence (up
    // to GENERATE_DAYS_AHEAD of them), each itself up to two sequential
    // network calls below — this is the single highest-probability hang
    // point identified for "the Save spinner never stops" on a real
    // mobile connection, since it is the one call site in that chain that
    // can run many times in a row.
    if (walkToPersist.status === 'done') {
      const { data, error, status } = await withTimeout(
        this.client.from('walks').update(fromWalk(walkToPersist)).eq('id', walkToPersist.id).eq('status', 'pending').select('id'),
        SUPABASE_CALL_TIMEOUT_MS,
        'walks update (done)'
      );
      if (error) throw Object.assign(error, { status });
      if (data && data.length > 0) return; // updated the existing pending walk

      // No pending row matched — two possibilities: (a) this is a brand-new
      // walk logged as already-done (an unplanned walk never has a 'pending'
      // row to update), or (b) someone else already completed it first. An
      // upsert with ignoreDuplicates handles both: inserts if the id is new,
      // and is a harmless no-op if it already exists (never overwrites the
      // other person's completion).
      const { error: insertError, status: insertStatus } = await withTimeout(
        this.client.from('walks').upsert(fromWalk(walkToPersist), { onConflict: 'id', ignoreDuplicates: true }),
        SUPABASE_CALL_TIMEOUT_MS,
        'walks upsert (done, no pending match)'
      );
      if (insertError) throw Object.assign(insertError, { status: insertStatus });
      return;
    }
    if (walkToPersist.scheduleEntryId) {
      const walksLookupAbort = new AbortController();
      const walksLookupQuery = this.client
        .from('walks')
        .select('id, status')
        .eq('schedule_entry_id', walkToPersist.scheduleEntryId);
      const abortableWalksLookup =
        typeof walksLookupQuery.abortSignal === 'function'
          ? walksLookupQuery.abortSignal(walksLookupAbort.signal)
          : walksLookupQuery;
      const { data: existing, error: lookupError, status: lookupStatus } = await withTimeout(
        abortableWalksLookup.maybeSingle(),
        SUPABASE_CALL_TIMEOUT_MS,
        'walks lookup by schedule_entry_id',
        () => walksLookupAbort.abort()
      );
      if (lookupError) throw Object.assign(lookupError, { status: lookupStatus });
      if (existing) {
        walkToPersist.id = existing.id;
        if (existing.status === 'done') return;
      }
    }
    const { error, status } = await withTimeout(
      this.client.from('walks').upsert(fromWalk(walkToPersist)),
      SUPABASE_CALL_TIMEOUT_MS,
      'walks upsert'
    );
    if (error) throw Object.assign(error, { status });
  }

  /**
   * Section 2: deletes an unplanned/spontaneous walk. The DB-layer
   * enforce_walk_write_authorization() trigger (see migration 0011) is the
   * real security boundary — it only allows a non-admin DELETE when the row
   * is is_unplanned and self-attributed, so a plain `.delete()` here is
   * safe to expose: an unauthorized delete is rejected server-side, not
   * merely hidden client-side.
   */
  async deleteWalk(walkId: string): Promise<void> {
    const { error } = await this.client.from('walks').delete().eq('id', walkId);
    if (error) throw error;
  }

  async getNotificationSettings(familyId: string): Promise<NotificationSetting[]> {
    const users = await this.getUsers(familyId);
    return users.map((u) => ({ ...defaultNotificationSetting(u.id), enabled: u.remindersEnabled }));
  }
}
