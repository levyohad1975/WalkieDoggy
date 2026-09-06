/**
 * Domain types shared across the app (UI, business logic, and data layer).
 * Keep this file framework-agnostic (no React/React Native imports) so the
 * business logic in src/logic can be unit-tested with plain Node.
 */

export type WalkStatus = 'pending' | 'done' | 'skipped';

export interface Family {
  id: string;
  name: string;
  inviteCode?: string; // short join code (Supabase mode only — absent/unused in local/demo mode)
  createdAt: string;
}

/** Minimal, non-sensitive info returned by an invite-code lookup, before joining. */
export interface FamilyLookupResult {
  id: string;
  name: string;
  dogName?: string;
}

export interface FamilyUser {
  id: string;
  familyId: string;
  name: string;
  avatar: string; // emoji fallback, always shown if photoUrl is missing/fails to load
  photoUrl?: string; // real profile photo (device URI in demo mode, Supabase Storage URL when configured)
  color: string; // hex, personal color used across the UI
  remindersEnabled: boolean;
  createdAt: string;
  /**
   * Set when an admin "deletes" this family member. The row is never
   * actually removed — schedule_entries.responsible_user_id and
   * walks.responsible_user_id are `on delete restrict`, specifically so
   * historical data can never silently lose who was responsible — so
   * "deleting" a member soft-deletes instead: this timestamp is set, the
   * member disappears from active pickers/rosters (family list, rotation
   * assignment, reminders), but their name/avatar keep resolving correctly
   * everywhere history is shown. See admin_delete_family_member() in
   * supabase/migrations/0004_*.sql.
   */
  removedAt?: string;
}

export interface Dog {
  id: string;
  familyId: string;
  name: string;
  photoUrl?: string;
  walksPerDay: number;
  notes?: string;
}

/**
 * A recurring rule used to auto-generate schedule_entries.
 * e.g. "every day at 07:00/14:00/20:00, rotating danny -> yael -> noam"
 * Each rule represents one of the family's daily walk time slots — the "4
 * walks a day" requirement is simply 4 active rules for the same dog, and
 * adding/editing/deleting a time slot is CRUD on this list.
 */
export interface ScheduleRule {
  id: string;
  familyId: string;
  dogId: string;
  time: string; // "HH:mm"
  label?: string; // optional friendly name, e.g. "טיול בוקר"
  daysOfWeek: number[]; // 0=Sunday..6=Saturday
  rotationUserIds: string[]; // ordered rotation; single id = fixed responsible person
  rotationAnchorDate: string; // ISO date the rotation index starts counting from
  sortOrder: number; // display order among the family's time slots (independent of `time`)
  active: boolean;
  createdAt: string;
}

/** A single generated slot on the schedule, independent of whether a walk exists yet. */
export interface ScheduleEntry {
  id: string;
  familyId: string;
  dogId: string;
  ruleId?: string; // present if generated from a rule
  date: string; // ISO date "YYYY-MM-DD"
  time: string; // "HH:mm" — editable per-entry without touching the rule (single-occurrence time change)
  responsibleUserId: string;
  createdAt: string;
}

export interface WalkSwap {
  originalUserId: string;
  newUserId: string;
  swappedAt: string;
  swappedByUserId: string;
}

/** The actual walk record: status + who/when it was executed. */
export interface Walk {
  id: string;
  familyId: string;
  scheduleEntryId?: string; // absent for unplanned/spontaneous walks
  dogId: string;
  date: string; // "YYYY-MM-DD"
  scheduledTime: string; // "HH:mm"
  responsibleUserId: string; // who is/was officially responsible (post-swap if swapped)
  status: WalkStatus;
  completedAt?: string; // ISO timestamp
  completedByUserId?: string; // who actually walked the dog — may differ from responsibleUserId
  hadPee?: boolean;
  hadPoop?: boolean;
  note?: string;
  durationMinutes?: number;
  isUnplanned?: boolean; // true for a walk logged via "add a walk that already happened", never generated from a rule
  swap?: WalkSwap;
  createdAt: string;
  updatedAt: string;
}

export type NotificationKind = 'pre_walk_reminder' | 'overdue_reminder';

export interface NotificationSetting {
  userId: string;
  minutesBefore: number; // default 15
  overdueMinutesAfter: number; // default 10
  enabled: boolean;
}

export interface ScheduledNotification {
  id: string;
  familyId: string;
  walkId: string;
  userId: string;
  kind: NotificationKind;
  fireAt: string; // ISO timestamp
  sent: boolean;
  canceledReason?: 'walk_completed' | 'walk_skipped' | 'rescheduled';
}

/** Composite view used by the Home screen. */
export interface WalkWithDetails extends Walk {
  responsibleUser?: FamilyUser;
  completedByUser?: FamilyUser;
  dog?: Dog;
}

/** Input for logging a walk that already happened, with no prior schedule entry. */
export interface UnplannedWalkInput {
  familyId: string;
  dogId: string;
  performedByUserId: string;
  date: string; // "YYYY-MM-DD"
  time: string; // "HH:mm"
  hadPee: boolean;
  hadPoop: boolean;
  note?: string;
  durationMinutes?: number;
}

/** Input for creating a new family member. */
export interface NewFamilyUserInput {
  familyId: string;
  name: string;
  avatar: string;
  photoUrl?: string;
  color: string;
}

/** Result of checking whether a user can be safely deleted. */
export interface UserDeletionImpact {
  futureScheduleEntryCount: number; // future schedule_entries where this user is responsible
  rulesAffected: string[]; // schedule_rule ids whose rotation includes this user
}
