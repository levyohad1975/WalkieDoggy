import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import type { FamilyUser, Walk } from '../types';
import { isOverdue, relativeTimeLabel, walkDateTime } from '../logic/nextWalk';
import { walkDateContextLabel } from '../logic/walkDateContext';
import { colors } from '../theme/colors';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { DogPhoto } from './DogPhoto';
import { Countdown } from './Countdown';

interface NextWalkCardProps {
  walk: Walk;
  responsible?: FamilyUser;
  currentUserId: string;
  dogName: string;
  dogPhotoUrl?: string;
  onMarkDone: () => void;
  /**
   * ✕ "לא בוצע" for an overdue-unresolved walk (Section 3). Only rendered
   * once the walk is actually overdue AND canResolve is true.
   */
  onMarkNotDone?: () => void;
  /**
   * AUTHORIZATION CORRECTION: ✓/✕ resolution is admin-or-currently-
   * responsible-user only (see migration 0012) — NOT "any member" as an
   * earlier pass had it. The caller computes this (effectiveRole==='admin'
   * || walk.responsibleUserId===effectiveUserId) since this component has
   * no role/family context of its own. Defaults to true so existing call
   * sites that don't pass it keep working, but every real call site in this
   * app now passes it explicitly.
   */
  canResolve?: boolean;
  /** Admin-only direct reassignment/edit ("לערוך" / "להחליף תור"). Omit entirely for a Member — see requirement 6. */
  onSwap?: () => void;
  onEdit?: () => void;
  /** Member-facing contextual actions (requirement 4) — approval-gated, never an immediate change. */
  onRequestSwap?: () => void;
  onRequestTimeChange?: () => void;
  /** One compact request status line for the current walk. */
  requestStatusLine?: string | null;
}

/**
 * The single most important thing on the Home screen: who's up next, when,
 * and a one-tap way to mark it done. Designed to be understood within a
 * second by someone who has never opened the app before.
 */
export function NextWalkCard({
  walk,
  responsible,
  currentUserId,
  dogName,
  dogPhotoUrl,
  onMarkDone,
  onMarkNotDone,
  canResolve = true,
  onSwap,
  onEdit,
  onRequestSwap,
  onRequestTimeChange,
  requestStatusLine,
}: NextWalkCardProps) {
  const overdue = isOverdue(walk);
  const isMine = walk.responsibleUserId === currentUserId;
  const isWeb = Platform.OS === 'web';

  return (
    <View style={[styles.card, isWeb && styles.webCard, overdue && styles.cardOverdue]}>
      <View style={[styles.eyebrowRow, isWeb && styles.webEyebrowRow]}>
        <DogPhoto photoUrl={dogPhotoUrl} size={isWeb ? 60 : 72} />
        <RtlText style={styles.eyebrow} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>
          הטיול הבא של {dogName}
        </RtlText>
      </View>

      <View style={[styles.mainRow, isWeb && styles.webMainRow]}>
        <View style={styles.timeBlock}>
          <RtlText
            style={styles.time}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            maxFontSizeMultiplier={TIME_MAX_FONT_SCALE}
          >
            {walk.scheduledTime}
          </RtlText>
          {/* P1 — Home today/tomorrow date ambiguity: the countdown/overdue
              text below already implies "soon", but for a walk further out
              (e.g. tomorrow morning shown tonight) it doesn't say WHICH day
              — this one compact label removes that ambiguity, using the
              same shared helper the last-walk card below uses. */}
          <RtlText style={styles.dateContext} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>
            {walkDateContextLabel(walk.date)}
          </RtlText>
          {overdue ? (
            <RtlText style={[styles.relative, styles.relativeOverdue]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>ממתין לעדכון · {relativeTimeLabel(walk)}</RtlText>
          ) : (
            <Countdown target={walkDateTime(walk)} />
          )}
        </View>

        <View style={styles.personBlock}>
          {responsible ? (
            <Avatar emoji={responsible.avatar} color={responsible.color} photoUrl={responsible.photoUrl} size={isWeb ? 50 : 56} />
          ) : null}
          <RtlText style={styles.personName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>
            {responsible?.name ?? '—'}
          </RtlText>
          {!isMine ? (
            <RtlText style={styles.responsibleLabel} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>
              באחריות {responsible?.name}
            </RtlText>
          ) : null}
        </View>
      </View>

      {requestStatusLine && !requestStatusLine.startsWith('✓') && !requestStatusLine.startsWith('✕') ? (
        <RtlText style={styles.requestStatusLine} numberOfLines={1} ellipsizeMode="tail" adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>
          {requestStatusLine}
        </RtlText>
      ) : null}

      {!canResolve ? (
        // Not the responsible member (and not an admin) — ✓/✕ is not
        // theirs to resolve. Shown as plain informational text, never a
        // disabled-but-visible button (would look like a bug), matching
        // the "request system, not direct action" story for members.
        <RtlText style={styles.notMineNote} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>
          {overdue ? 'ממתין לעדכון ע״י ' : 'רק '}
          {responsible?.name ?? 'האחראי/ת'} יכול/ה לסמן את הטיול הזה
        </RtlText>
      ) : overdue && onMarkNotDone ? (
        <View style={styles.resolveRow}>
          <Button label="✓ בוצע" onPress={onMarkDone} style={styles.resolveButton} compact shrinkToFit />
          <Button
            label="✕ לא בוצע"
            variant="secondary"
            onPress={onMarkNotDone}
            style={styles.resolveButton}
            compact
            shrinkToFit
          />
        </View>
      ) : (
        <Button label="סמן כבוצע" icon="✓" onPress={onMarkDone} style={styles.doneButton} shrinkToFit />
      )}
      {onEdit || onSwap ? (
        <View style={styles.linkRow}>
          {onEdit ? (
            <RtlText style={styles.linkText} onPress={onEdit} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>
              לערוך
            </RtlText>
          ) : null}
          {onEdit && onSwap ? <RtlText style={styles.linkDivider} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>·</RtlText> : null}
          {onSwap ? (
            <RtlText style={styles.linkText} onPress={onSwap} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>
              להחליף תור
            </RtlText>
          ) : null}
        </View>
      ) : null}
      {onRequestSwap || onRequestTimeChange ? (
        <View style={styles.linkRow}>
          {onRequestSwap ? (
            <RtlText style={styles.linkText} onPress={onRequestSwap} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>
              בקש החלפה
            </RtlText>
          ) : null}
          {onRequestSwap && onRequestTimeChange ? <RtlText style={styles.linkDivider} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>·</RtlText> : null}
          {onRequestTimeChange ? (
            <RtlText style={styles.linkText} onPress={onRequestTimeChange} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>
              בקש שינוי שעה
            </RtlText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Bug-fix pass (Dynamic Type @ 160%): `time` already has
 * `adjustsFontSizeToFit`/`minimumFontScale`, which self-protects against
 * clipping by shrinking back down to fit `timeBlock`'s width — so it can't
 * overflow or clip today. Left unbounded, though, the OS scale factor would
 * push it up to `30 * 1.6 = 48pt` first and then rely entirely on that
 * shrink-to-fit pass to claw it back down (potentially all the way to its
 * 0.7 floor, i.e. ~21pt — smaller than the 135% case looked). Capping the
 * multiplier keeps the starting point reasonable (30 * 1.35 = 40.5pt) so
 * the shrink-to-fit pass has less work to do and the result stays close to
 * what 135% QA already confirmed looks right, while still growing visibly
 * off its 100% baseline.
 */
const TIME_MAX_FONT_SCALE = 1.35;
const CARD_MAX_FONT_SCALE = 1.35;

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.statusCurrentBg,
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingVertical: 24,
    borderWidth: 1.5,
    borderColor: colors.primary + '33',
  },
  webCard: { borderRadius: 22, paddingHorizontal: 28, paddingVertical: 18 },
  cardOverdue: { backgroundColor: colors.statusOverdueBg, borderColor: colors.statusOverdue + '44' },
  eyebrowRow: { flexDirection: 'row-reverse', direction: 'ltr', alignItems: 'center', gap: 8, marginBottom: 12 },
  webEyebrowRow: { marginBottom: 4 },
  eyebrow: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.textSecondary, textAlign: 'right' },
  // Round 6F correction: timeBlock/personBlock each get an explicit, equal
  // `flex` share of the row instead of sizing themselves to their own text's
  // rendered width. Box widths are now a fixed proportion of the row —
  // independent of Dynamic Type/system font-size — so neither block's
  // on-screen position drifts as text metrics change; only the content
  // centered inside each fixed-width box can shift by a few px.
  mainRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 12 },
  webMainRow: { marginBottom: 10, minHeight: 74 },
  timeBlock: { flex: 1, alignItems: 'flex-start', minWidth: 0 },
  // Reduced from 44 (BUG report: too large, wrapped to two lines on a
  // narrow iPhone and dwarfed the rest of the card). Still the single
  // biggest element on the card, so it stays the clear visual anchor next
  // to the responsible person's name (18) and "סמן כבוצע" button.
  time: { fontSize: 30, fontWeight: '800', color: colors.textPrimary, textAlign: 'left' },
  dateContext: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginTop: 1 },
  relative: { fontSize: 16, fontWeight: '600', color: colors.primary, marginTop: 2 },
  relativeOverdue: { color: colors.statusOverdue },
  personBlock: { flex: 1, alignItems: 'center', gap: 4, minWidth: 0 },
  personName: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'right' },
  responsibleLabel: { fontSize: 13, color: colors.textSecondary, textAlign: 'right' },
  doneButton: { marginTop: 4 },
  resolveRow: { flexDirection: 'row', gap: 8, marginTop: 4, width: '100%' },
  resolveButton: { flex: 1, minWidth: 0 },
  notMineNote: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginTop: 6 },
  requestStatusLine: {
    width: '100%',
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '600',
    color: colors.primaryDark,
    marginTop: 4,
  },
  requestStatusApproved: { color: colors.statusDone },
  linkRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 14 },
  linkText: { color: colors.primaryDark, fontSize: 14, fontWeight: '600' },
  linkDivider: { color: colors.textSecondary },
});
