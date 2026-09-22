/**
 * Domain types shared across the app (UI, business logic, and data layer).
 * Keep this file framework-agnostic (no React/React Native imports) so the
 * business logic in src/logic can be unit-tested with plain Node.
 */

export type WalkStatus = 'pending' | 'in_progress' | 'done' | 'skipped';

export interface Family {
  id: string;
  name: string;
  inviteCode?: string; // short join code (Supabase mode only — absent/unused in local/demo mode)
  /**
   * Authoritative IANA timezone (e.g. "Asia/Jerusalem") this family's walk
   * scheduling and reminder-time calculations run on. Optional at the type
   * level — not every code path (notably local/demo-mode data cached before
   * this field existed) is guaranteed to have it — but Supabase mode's
   * `families.timezone` column is NOT NULL with a safe default, so any
   * family read from Supabase will always have a real value here. Business
   * logic that depends on this must have an explicit fallback for the
   * `undefined` case rather than assuming it's always present. A future
   * per-user *display* layer may show a different local time without ever
   * changing this authoritative value. See
   * supabase/migrations/0022_family_timezone_and_dog_sex.sql.
   */
  timezone?: string;
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
  /**
   * Used by the (future) Message Template Engine to produce grammatically
   * correct Hebrew reminder wording (זכר/נקבה) instead of hard-coded text.
   * Undefined for a dog whose sex hasn't been recorded yet (e.g. every
   * existing dog as of this field's introduction) — business logic must
   * fall back to neutral phrasing rather than assuming a value. See
   * supabase/migrations/0022_family_timezone_and_dog_sex.sql.
   */
  sex?: 'male' | 'female';
}

/** The PRD §10 core category list for a health/grooming record. */
export type HealthTaskCategory =
  | 'vaccination'
  | 'parasite_prevention'
  | 'medication'
  | 'vet_visit'
  | 'weight'
  | 'allergy'
  | 'food'
  | 'grooming'
  | 'bath'
  | 'nails'
  | 'teeth'
  | 'ears'
  | 'other';

/**
 * A single row in a dog's health/grooming hub (PRD §10) — a journal entry
 * AND task list unified onto one shape, exactly like `Walk` already unifies
 * planned/unplanned. A record is a LOG entry once `completedAt` is set (e.g.
 * "gave the heartworm pill today", a weight reading), a DUE task while
 * `dueDate` is set and `completedAt` isn't (e.g. "next vet visit"), or both
 * (a due task marked done keeps its dueDate). See
 * supabase/migrations/0049_health_grooming_foundation.sql for the full
 * rationale, and 0050_health_task_recurrence.sql for `recurrenceIntervalDays`.
 */
export interface HealthTask {
  id: string;
  familyId: string;
  dogId: string;
  category: HealthTaskCategory;
  title: string;
  notes?: string;
  /** Only meaningful for category 'weight' — a weight-log entry's reading, in kg. */
  weightKg?: number;
  /**
   * When set on a task, completing it auto-generates the NEXT occurrence
   * (same category/title/notes/responsibleUserId/recurrenceIntervalDays,
   * dueDate = this completion's date + this many days) — see
   * healthStore.completeTask(). Undefined/absent = a one-off record, exactly
   * today's behavior. See supabase/migrations/0050_health_task_recurrence.sql.
   */
  recurrenceIntervalDays?: number;
  dueDate?: string; // "YYYY-MM-DD"
  completedAt?: string; // ISO timestamp
  completedByUserId?: string;
  responsibleUserId?: string;
  createdByUserId?: string;
  createdAt: string;
  updatedAt: string;
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
  startedAt?: string; // ISO timestamp when Start walk was pressed
  startedByUserId?: string; // profile that pressed Start (admin may differ from responsible)
  completedAt?: string; // ISO timestamp
  completedByUserId?: string; // who actually walked the dog — may differ from responsibleUserId
  endedByUserId?: string; // profile that pressed End (admin may differ from actual walker)
  hadPee?: boolean;
  hadPoop?: boolean;
  note?: string;
  durationMinutes?: number;
  isUnplanned?: boolean; // true for a walk logged via "add a walk that already happened", never generated from a rule
  swap?: WalkSwap;
  createdAt: string;
  updatedAt: string;
}

/**
 * PRD §7 (Phase 4, GPS foundation) — an optional, per-walk GPS distance
 * capture. Deliberately holds only a DERIVED aggregate (distance + point
 * count), never raw lat/lng history — the device computes distance from an
 * in-memory position stream it never persists anywhere (see
 * lib/gpsTracking.ts) — see supabase/migrations/0051_walk_gps_sessions.sql
 * for the full privacy-by-design rationale. `distanceMeters` is the
 * original device-computed reading; `correctedDistanceMeters`, once a
 * family member sets it (the PRD's required "assistive, not sole source of
 * truth" correction flow), is authoritative for display/statistics instead.
 */
export interface WalkGpsSession {
  id: string;
  walkId: string;
  familyId: string;
  dogId: string;
  distanceMeters?: number;
  pointCount: number;
  correctedDistanceMeters?: number;
  correctedByUserId?: string;
  startedAt?: string; // ISO timestamp
  endedAt?: string; // ISO timestamp
  /** 'device_gps' today (this device's own foreground tracking) — an open list so a future external collar/tracker adapter adds a value here, not a schema rewrite. */
  source: 'device_gps';
  createdByUserId?: string;
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
  // Pending, not-yet-past walks directly assigned to this user (e.g. via a
  // one-off swap, or an unplanned walk) whose linked schedule entry, if any,
  // is NOT also owned by this user. planUserRemoval() can only resolve these
  // via the given replacement user — it has no rotation/entry fallback for
  // them — so without a replacement they are silently left referencing a
  // soft-deleted user forever.
  directlyAssignedWalkCount: number;
}
