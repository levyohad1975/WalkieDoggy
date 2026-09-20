import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import type { FamilyUser, Walk } from '../types';
import { isOverdue } from '../logic/nextWalk';
import { walkCompletionLine, walkHistoryTimingLine, walkMetadataLine } from '../logic/walkActions';
import { colors } from '../theme/colors';
import { nativeDirection } from '../theme/tokens';
import { Avatar } from './Avatar';
import { StatusBadge } from './StatusBadge';

interface WalkRowProps {
  walk: Walk;
  responsible?: FamilyUser;
  completedBy?: FamilyUser;
  isCurrent?: boolean;
  onPress?: () => void;
  /**
   * Member-facing contextual request actions (round-5, Part 2) — mirrors
   * NextWalkCard's onRequestSwap/onRequestTimeChange props exactly (same
   * link-row visual style, same "omit to hide" contract). ScheduleScreen
   * passes these only for a walk the viewer is eligible to request a change
   * for (see that screen's eligibility filter) — this component has no
   * eligibility logic of its own, purely rendering.
   */
  onRequestSwap?: () => void;
  onRequestTimeChange?: () => void;
  /**
   * Quick icon-only pee/poop toggles for a completed walk (Section 6.4) —
   * wired directly to scheduleStore.editDoneDetails by the caller, no modal.
   * Omit either to hide that toggle; both omitted hides the whole toggle row
   * (falls back to the compact done-details text — see the metadata line
   * below the status badge).
   */
  onTogglePee?: () => void;
  onTogglePoop?: () => void;
  /**
   * QA pass v3, issue 11 fix: HomeScreen's NextWalkCard only ever shows the
   * ✓/✕ overdue-resolution row for the SINGLE earliest overdue walk
   * (computeNextWalk's pick) — if a family has more than one overdue,
   * unresolved walk at once, every walk after the first had NO resolution
   * action anywhere in the app (this list's rows only ever wired
   * onRequestSwap/onRequestTimeChange/admin onPress, never a direct
   * done/not-done action). The caller (ScheduleScreen) passes these for
   * ANY `pending` walk that is both overdue and one the viewer is allowed
   * to resolve (admin, or the responsible member — same authorization as
   * NextWalkCard's `canResolve`, migration 0012) — omit both to hide the
   * row entirely, exactly like every other optional action here.
   */
  onMarkDone?: () => void;
  onMarkNotDone?: () => void;
  /**
   * P1 — compact request-status line (e.g. "🕐 שינוי ל־19:30 · ממתין",
   * "✓ שינוי ל־19:30 אושר"). Computed by the caller via
   * src/logic/walkRequestStatusLine.ts's computeWalkRequestStatusLine() —
   * this component has no store access and does no request-lifecycle logic
   * of its own, purely rendering exactly ONE line when passed. Omit to hide
   * — no nested request card/action panel/history is ever rendered here.
   */
  requestStatusLine?: string | null;
  /** History-only visual density: keep time prominent, soften identity text, and omit redundant completion copy. */
  historyCompact?: boolean;
  hidePendingStatus?: boolean;
}

/**
 * One compact row of the Home/Schedule/History list.
 *
 * QA/UX round, Part B REDESIGN — this component previously had three
 * confirmed real bugs, all fixed here:
 *   1. `adjustsFontSizeToFit`/`minimumFontScale` on the name text caused
 *      the SAME field ("אבא", "אמא", ...) to render at a visibly
 *      different size row-to-row depending on how much room the row
 *      happened to have that instant — never used again anywhere in this
 *      component now; every text element has ONE fixed font size and
 *      relies on `numberOfLines`/ellipsis for genuinely long content only.
 *   2. The "טיול ספונטני"/"הוחלף" metadata chips and the skipped-walk
 *      detail line could truncate to "הו…"/"טיול…" or wrap
 *      character-by-character on a narrow phone (fixed in the prior QA
 *      pass by pinning their own width; this redesign goes further and
 *      removes the competing full-width text/details "compartment"
 *      entirely, so there's no longer a squeeze to cause it).
 *   3. Row height varied by status (a done/skipped walk grew an extra
 *      full-width "doneDetails" block below the main row; a plain pending
 *      walk didn't) — `row` now has a fixed `minHeight` so every status
 *      renders the same card height. `תוכנן ל־HH:MM` (added in the
 *      immediately prior QA pass for the skipped state) is REMOVED here,
 *      not kept alongside the redesign — the scheduled time is now always
 *      shown prominently on the right regardless of status, so repeating
 *      it a second time below is exactly the redundancy that fix was
 *      trying (incompletely) to reduce.
 *
 * Layout (right-to-left reading order — this app runs under RTL
 * `I18nManager`, so a plain `flexDirection: 'row'` already places the
 * FIRST JSX child at the physical right edge and the LAST at the physical
 * left; nothing here forces layout direction beyond what the app already
 * relies on elsewhere — see Countdown.tsx's own note on this):
 *   RIGHT   — scheduled time (large, fixed size) + short date, never resized.
 *   CENTER  — avatar + member name (fixed size, one line, ellipsis only for
 *             a genuinely long name) + at most one metadata line
 *             ("טיול ספונטני" / "הוחלף" / both joined with " · " — always
 *             renders in full, on one line, never truncated: these are
 *             short fixed phrases, not user content).
 *   LEFT    — the status badge, and — only for a resolved walk, and only
 *             when there's no interactive pee/poop toggle taking that
 *             space instead — one compact completion line right under it
 *             (who + when, with the pee/poop emoji appended if present).
 *             No separate full-width "details" block any more.
 *
 * Request/resolve actions and the pee/poop toggle remain their own rows
 * below the fixed-height main row when the caller passes them — those are
 * interactive controls the viewer explicitly needs to reach, not passive
 * "detail" text, and are unaffected by this redesign beyond the metadata
 * change above.
 */
export function WalkRow({
  walk,
  responsible,
  completedBy,
  isCurrent,
  onPress,
  onRequestSwap,
  onRequestTimeChange,
  onTogglePee,
  onTogglePoop,
  onMarkDone,
  onMarkNotDone,
  requestStatusLine,
  historyCompact = false,
  hidePendingStatus = false,
}: WalkRowProps) {
  const overdue = isOverdue(walk);
  const metadataLine = historyCompact ? (walk.isUnplanned ? 'ספונטני' : 'מתוכנן') : walkMetadataLine(walk);
  const showToggles = !!(onTogglePee || onTogglePoop);
  const completionLine = walkCompletionLine(walk, completedBy, showToggles);
  // BATCH 4 (item F — completedAt UX): History previously showed ONLY the
  // scheduled-time headline (historyCompact suppresses `completionLine`
  // above entirely) — the Master Specification explicitly wants History to
  // distinguish planned vs. actual completion time ("תוכנן 07:00 · בוצע
  // 07:18"). Computed only in historyCompact mode; every other caller of
  // this component is unaffected.
  const historyTimingLine = historyCompact ? walkHistoryTimingLine(walk) : null;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[styles.row, isCurrent && styles.rowCurrent, walk.status === 'done' && styles.rowDone]}
    >
      <View style={styles.mainRow}>
        <View style={styles.dateTimeBlock}>
          <RtlText style={[styles.time, historyCompact && styles.timeHistory]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82} maxFontSizeMultiplier={WALK_ROW_DATE_TIME_MAX_SCALE}>
            {walk.scheduledTime}
          </RtlText>
          <RtlText style={styles.date} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78} maxFontSizeMultiplier={WALK_ROW_DATE_TIME_MAX_SCALE}>
            {`${new Date(`${walk.date}T00:00:00`).toLocaleDateString('he-IL', {
              weekday: 'short',
            })} · ${new Date(`${walk.date}T00:00:00`).toLocaleDateString('he-IL', {
              day: '2-digit',
              month: '2-digit',
            })}`}
          </RtlText>
        </View>

        {responsible ? (
          <Avatar emoji={responsible.avatar} color={responsible.color} photoUrl={responsible.photoUrl} size={32} />
        ) : null}

        <View style={styles.middle}>
          {/* Fixed size, one line, ellipsis only for a genuinely long name —
              never `adjustsFontSizeToFit` (that was the source of the
              inconsistent-font-size bug this redesign fixes). */}
          <RtlText style={[styles.name, historyCompact && styles.nameHistory]} numberOfLines={1} ellipsizeMode="tail">
            {responsible?.name ?? 'לא הוגדר'}
            {responsible?.removedAt ? ' (הוסר)' : ''}
          </RtlText>
          {metadataLine ? (
            <RtlText style={[styles.metadata, historyCompact && styles.metadataHistory]} numberOfLines={1}>
              {metadataLine}
            </RtlText>
          ) : null}
        </View>

        {hidePendingStatus && walk.status === 'pending' && !overdue ? null : (
          <View style={styles.leftBlock}>
            <StatusBadge status={walk.status} overdue={overdue} glyphOnly={historyCompact} />
            {completionLine && !historyCompact ? (
              <RtlText style={styles.completionText} numberOfLines={1} ellipsizeMode="tail">
                {completionLine}
              </RtlText>
            ) : null}
          </View>
        )}
      </View>

      {historyTimingLine ? (
        <RtlText style={styles.historyTimingLine} numberOfLines={1} ellipsizeMode="tail">
          {historyTimingLine}
        </RtlText>
      ) : null}

      {requestStatusLine ? (
        <RtlText style={[styles.requestStatusLine, requestStatusLine.startsWith('✓') && styles.requestStatusApproved]} numberOfLines={1} ellipsizeMode="tail">
          {requestStatusLine}
        </RtlText>
      ) : null}

      {showToggles ? (
        <View style={styles.quickToggleRow}>
          {onTogglePoop ? (
            <Pressable
              onPress={onTogglePoop}
              hitSlop={8}
              style={[styles.quickToggle, walk.hadPoop && styles.quickToggleActive]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: !!walk.hadPoop }}
              accessibilityLabel="סימון קקי בטיול"
            >
              <RtlText style={[styles.quickToggleEmoji, !walk.hadPoop && styles.quickToggleEmojiMuted]}>💩</RtlText>
            </Pressable>
          ) : null}
          {onTogglePee ? (
            <Pressable
              onPress={onTogglePee}
              hitSlop={8}
              style={[styles.quickToggle, walk.hadPee && styles.quickToggleActive]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: !!walk.hadPee }}
              accessibilityLabel="סימון פיפי בטיול"
            >
              <RtlText style={[styles.quickToggleEmoji, !walk.hadPee && styles.quickToggleEmojiMuted]}>💧</RtlText>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* QA pass v3, issue 11 fix — see onMarkDone/onMarkNotDone's doc comment
          above: a direct resolution action for ANY overdue-unresolved walk
          the viewer may resolve, not only whichever one HomeScreen's
          NextWalkCard happens to be showing. */}
      {onMarkDone || onMarkNotDone ? (
        <View style={styles.resolveRow}>
          {onMarkDone ? (
            <Pressable
              onPress={onMarkDone}
              style={[styles.resolveChip, styles.resolveChipDone]}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="סימון הטיול כבוצע"
            >
              <RtlText style={styles.resolveChipText} numberOfLines={1}>✓ בוצע</RtlText>
            </Pressable>
          ) : null}
          {onMarkNotDone ? (
            <Pressable
              onPress={onMarkNotDone}
              style={[styles.resolveChip, styles.resolveChipNotDone]}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="סימון הטיול כלא בוצע"
            >
              <RtlText style={[styles.resolveChipText, { color: colors.statusSkipped }]} numberOfLines={1}>✕ לא בוצע</RtlText>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {onRequestSwap || onRequestTimeChange ? (
        <View style={styles.linkRow}>
          {onRequestSwap ? (
            <RtlText style={styles.linkText} onPress={onRequestSwap}>
              בקש החלפה
            </RtlText>
          ) : null}
          {onRequestSwap && onRequestTimeChange ? <RtlText style={styles.linkDivider}>·</RtlText> : null}
          {onRequestTimeChange ? (
            <RtlText style={styles.linkText} onPress={onRequestTimeChange}>
              בקש שינוי שעה
            </RtlText>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

// Keep the fixed 92px date/time column readable under large iOS Dynamic Type.
// This cap is intentionally scoped only to scheduled time/date; names and other
// WalkRow content retain their existing scaling behavior.
const WALK_ROW_DATE_TIME_MAX_SCALE = 1.35;

const styles = StyleSheet.create({
  row: {
    gap: 7,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },

  // Part B fix: fixed minimum height for the identity/status row regardless
  // of walk status — no more "done"/"skipped" rows growing a taller card
  // than a plain "pending" one.
  mainRow: {
    width: '100%',
    minHeight: 48,
    flexDirection: 'row-reverse',
    ...nativeDirection('ltr'),
    alignItems: 'center',
    gap: 7,
  },

  rowCurrent: { borderColor: colors.primary, backgroundColor: colors.statusCurrentBg },
  rowDone: { opacity: 0.85 },

  time: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
    minWidth: 48,
    textAlign: 'center',
    flexShrink: 0,
  },

  dateTimeBlock: {
    width: 92,
    alignItems: 'center',
    flexShrink: 0,
  },

  date: {
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 2,
  },

  middle: {
    flex: 1,
    gap: 4,
    minWidth: 0,
    alignItems: 'flex-end',
  },
  timeHistory: { fontSize: 18 },
  nameHistory: { fontWeight: '500', fontSize: 15 },
  metadataHistory: { fontWeight: '400', fontSize: 12 },
  name: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'right',
    width: '100%',
  },
  metadata: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
    textAlign: 'right',
    alignSelf: 'flex-end',
    flexShrink: 0,
  },

  // LEFT column: status badge + (optional) compact completion line, capped
  // so a long name/time combo ellipsizes rather than pushing the row taller
  // or squeezing `middle`.
  leftBlock: {
    width: 118,
    alignItems: 'flex-end',
    flexShrink: 0,
    gap: 3,
  },
  completionText: {
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'right',
    maxWidth: 118,
  },

  historyTimingLine: {
    width: '100%',
    textAlign: 'right',
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 2,
  },
  requestStatusLine: {
    width: '100%',
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '600',
    color: colors.primaryDark,
    marginTop: 2,
  },
  requestStatusApproved: { color: colors.statusDone },
  linkRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  linkText: { color: colors.primaryDark, fontSize: 13, fontWeight: '600' },
  linkDivider: { color: colors.textSecondary },
  resolveRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 6,
  },
  resolveChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  resolveChipDone: {
    backgroundColor: colors.statusDoneBg,
    borderColor: colors.statusDone,
  },
  resolveChipNotDone: {
    backgroundColor: colors.surface,
    borderColor: colors.statusSkipped,
  },
  resolveChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.statusDone,
  },
  quickToggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  quickToggle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickToggleActive: {
    backgroundColor: colors.statusCurrentBg,
    borderColor: colors.primary,
  },
  quickToggleEmoji: {
    fontSize: 15,
  },
  quickToggleEmojiMuted: {
    opacity: 0.35,
  },
});

