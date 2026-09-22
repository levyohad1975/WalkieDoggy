import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Dog,
  Family,
  FamilyUser,
  HealthTask,
  NotificationSetting,
  ScheduleEntry,
  ScheduleRule,
  Walk,
} from '../types';
import { defaultNotificationSetting } from '../logic/reminders';
import type { DeleteFamilyMemberPayload, Repository } from './repository';

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

function fromDog(dog: Dog) {
  return {
    id: dog.id,
    family_id: dog.familyId,
    name: dog.name,
    photo_url: dog.photoUrl ?? null,
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
    const { error } = await this.client.from('dogs').upsert(fromDog(dog));
    if (error) throw error;
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

  async getScheduleRules(familyId: string): Promise<ScheduleRule[]> {
    const { data, error } = await this.client.from('schedule_rules').select('*').eq('family_id', familyId);
    if (error) throw error;
    return (data ?? []).map(toRule);
  }

  async upsertScheduleRule(rule: ScheduleRule): Promise<void> {
    const { error } = await this.client.from('schedule_rules').upsert(fromRule(rule));
    if (error) throw error;
  }

  async deleteScheduleRule(ruleId: string): Promise<void> {
    const { error } = await this.client.from('schedule_rules').delete().eq('id', ruleId);
    if (error) throw error;
  }

  async getScheduleEntries(familyId: string): Promise<ScheduleEntry[]> {
    const { data, error } = await this.client.from('schedule_entries').select('*').eq('family_id', familyId);
    if (error) throw error;
    return (data ?? []).map(toEntry);
  }

  async addScheduleEntries(entries: ScheduleEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const { error } = await this.client.from('schedule_entries').upsert(entries.map(fromEntry), {
      onConflict: 'dog_id,date,time',
      ignoreDuplicates: true,
    });
    if (error) throw error;
  }

  async updateScheduleEntry(entry: ScheduleEntry): Promise<void> {
    const { error } = await this.client.from('schedule_entries').upsert(fromEntry(entry));
    if (error) throw error;
  }

  async deleteScheduleEntry(entryId: string): Promise<void> {
    const { error } = await this.client.from('schedule_entries').delete().eq('id', entryId);
    if (error) throw error;
  }

  async getWalks(familyId: string): Promise<Walk[]> {
    const { data, error } = await this.client.from('walks').select('*').eq('family_id', familyId);
    if (error) throw error;
    return (data ?? []).map(toWalk);
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

  async saveWalk(walk: Walk): Promise<void> {
    if (walk.status === 'done') {
      const { data, error } = await this.client
        .from('walks')
        .update(fromWalk(walk))
        .eq('id', walk.id)
        .eq('status', 'pending')
        .select('id');
      if (error) throw error;
      if (data && data.length > 0) return; // updated the existing pending walk

      // No pending row matched — two possibilities: (a) this is a brand-new
      // walk logged as already-done (an unplanned walk never has a 'pending'
      // row to update), or (b) someone else already completed it first. An
      // upsert with ignoreDuplicates handles both: inserts if the id is new,
      // and is a harmless no-op if it already exists (never overwrites the
      // other person's completion).
      const { error: insertError } = await this.client
        .from('walks')
        .upsert(fromWalk(walk), { onConflict: 'id', ignoreDuplicates: true });
      if (insertError) throw insertError;
      return;
    }
    const { error } = await this.client.from('walks').upsert(fromWalk(walk));
    if (error) throw error;
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
