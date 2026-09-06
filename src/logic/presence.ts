/**
 * Presence/"last seen" display logic (round 7, Part 2).
 *
 * Framework-agnostic (no React/React Native imports) so it can be unit
 * tested with plain Node/Jest, matching every other file in src/logic.
 * `now` is always injectable — never reads Date.now()/`new Date()`
 * internally without a caller-supplied default — so tests never depend on
 * wall-clock time (see dateFormat.ts's localDateOnly for the same pattern).
 *
 * Backed by the EXISTING presence infrastructure only:
 *   - touch_last_seen() (migrations/0005_*.sql, updated for impersonation in
 *     0006_qa_impersonation.sql) writes user_presence.last_seen_at on every
 *     app foreground (see App.tsx's runForegroundSync()).
 *   - admin_list_family_activity() (0005) is the only RPC that surfaces
 *     last_seen_at to a client, and it is Admin-only (raises for a non-admin
 *     caller) — see FamilyScreen.tsx's doc comment for why presence display
 *     stays Admin-only this round rather than being broadened.
 *
 * "Active now" threshold: 5 minutes. Chosen to match the boundary already
 * used by AdminActivityModal's own freshnessLabel() ("פחות מ-5 דקות") so the
 * app doesn't grow two different opinions about what "recent" means, and
 * sits within the 3-5 minute range this feature's requirements call for. A
 * foreground-only heartbeat (no background polling) means this can never
 * show a stale "active now" for long: the moment the app backgrounds,
 * last_seen_at stops advancing, and it ages out of the fresh window within
 * one threshold's worth of real time.
 */
export const PRESENCE_FRESH_MINUTES = 5;

export interface PresenceInfo {
  /** True when last_seen_at is within the fresh window (see PRESENCE_FRESH_MINUTES). */
  active: boolean;
  /**
   * Concise Hebrew label for display, or null when there is nothing safe/
   * useful to show (no data at all, or a timestamp old enough that none of
   * this feature's specified phrasings ["X דק' אago", "היום", "אתמול"] apply
   * — omitted cleanly rather than inventing a new phrasing this round).
   */
  label: string | null;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isLocalYesterday(candidate: Date, now: Date): boolean {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return isSameLocalDay(candidate, yesterday);
}

/**
 * Describes a member's presence for display. `lastSeenAt` is the raw
 * `last_seen_at` value from admin_list_family_activity() (an ISO timestamp,
 * or null when the member has never been recorded — e.g. never opened the
 * app since presence tracking shipped, or is a removed member with no
 * foreground activity). Never returns a misleading label for null input.
 */
export function describePresence(lastSeenAt: string | null | undefined, now: Date = new Date()): PresenceInfo {
  if (!lastSeenAt) return { active: false, label: null };

  const seen = new Date(lastSeenAt);
  if (Number.isNaN(seen.getTime())) return { active: false, label: null };

  const minutesAgo = Math.max(0, Math.round((now.getTime() - seen.getTime()) / 60000));

  if (minutesAgo < PRESENCE_FRESH_MINUTES) {
    return { active: true, label: 'פעיל עכשיו' };
  }

  if (minutesAgo < 60) {
    return { active: false, label: `נראה לפני ${minutesAgo} דק׳` };
  }

  if (isSameLocalDay(seen, now)) {
    return { active: false, label: `נראה היום ב-${formatTime(seen)}` };
  }

  if (isLocalYesterday(seen, now)) {
    return { active: false, label: `נראה אתמול ב-${formatTime(seen)}` };
  }

  // Older than yesterday — no phrasing specified for this round; omit
  // cleanly rather than invent one (same principle as the null case).
  return { active: false, label: null };
}

/**
 * Round 8, Fix 2: a SHORTER presence label for the Family screen's row
 * subtitle only ("role · presence"), where real-device QA found the full
 * describePresence() label ("נראה היום ב-14:32" etc.) combined with a role
 * word plus the row's avatar/action-icon overhead genuinely doesn't fit on
 * one line on a real iPhone and was truncating mid-word.
 *
 * Deliberately drops the "נראה" prefix and the exact clock time for the
 * same-day/yesterday cases — the row only needs to convey roughly how
 * recent, not the precise minute; the full precise last-seen detail
 * (including the exact time) is unchanged and still shown in full via
 * describePresence() inside MemberDetailsModal. Same active-window/threshold
 * rules as describePresence() — this is a display-string variant, not a
 * semantics change.
 */
export function describePresenceCompact(lastSeenAt: string | null | undefined, now: Date = new Date()): PresenceInfo {
  const full = describePresence(lastSeenAt, now);
  if (full.active || full.label === null) return full;

  const seen = new Date(lastSeenAt as string);
  const minutesAgo = Math.max(0, Math.round((now.getTime() - seen.getTime()) / 60000));

  // Round 8 Fix 2 follow-up: real-device QA showed 'נראה היום'/'נראה אתמול'
  // still truncated the row for inactive members once combined with a role
  // word ("בן משפחה") and the row's icon/avatar overhead — the leftover
  // "נראה" prefix (present on every branch below in the pre-fix version)
  // was the last bit of unnecessary width. Every branch is now prefix-free.
  // ~60 minutes is deliberately phrased as "לפני שעה" (not "לפני 60 דק'")
  // per the round's own required example ("בן משפחה · לפני שעה").
  if (minutesAgo < 60) {
    return { active: false, label: `לפני ${minutesAgo} דק׳` };
  }
  if (minutesAgo < 90) {
    return { active: false, label: 'לפני שעה' };
  }
  if (isSameLocalDay(seen, now)) {
    return { active: false, label: 'היום' };
  }
  if (isLocalYesterday(seen, now)) {
    return { active: false, label: 'אתמול' };
  }
  return full;
}
