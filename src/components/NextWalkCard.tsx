import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { RtlText } from './RtlText';
import type { Dog, FamilyUser, Walk } from '../types';
import { isOverdue, relativeTimeLabel, walkDateTime } from '../logic/nextWalk';
import { isWalkRequiringAttention } from '../logic/walkAttention';
import { walkDateContextLabel } from '../logic/walkDateContext';
import { colors } from '../theme/colors';
import { nativeDirection, radii } from '../theme/tokens';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { DogPhoto } from './DogPhoto';
import { Countdown } from './Countdown';
import { WalkieMascot } from './WalkieMascot';
import { deriveMascotMoment } from '../mascot/mascotStage';
import { selectMessage } from '../mascot/messageEngine';
import { formatDistanceMeters } from '../logic/gpsDistance';

interface NextWalkCardProps {
  walk: Walk;
  responsible?: FamilyUser;
  currentUserId: string;
  dogName: string;
  dogPhotoUrl?: string;
  /** Home's photo-led hero already carries the real dog identity; hide the duplicate thumbnail there. */
  showDogPhoto?: boolean;
  /** Home's large hero already carries the mascot/photo; avoid repeating the brand character in the action card. */
  showMascot?: boolean;
  /** BATCH 4 (item B/C8) — feeds the mascot message engine's dogNoun/wentOut Hebrew gendering. Omit/undefined uses the same neutral fallback as everywhere else in the app. */
  dogSex?: Dog['sex'] | null;
  onMarkDone: () => void;
  /** Primary lifecycle action. When omitted the legacy completion action remains available. */
  onStartWalk?: () => void;
  onEndWalk?: () => void;
  activeStartedAt?: string | null;
  /**
   * Phase 4 (GPS foundation, PRD §7 — "In Progress" card state: "מרחק/מצב
   * GPS"). Only ever rendered while the walk is active (isActive); omit
   * entirely for a caller with no GPS integration (every other call site
   * of this component) — a fully backward-compatible addition.
   */
  liveDistanceMeters?: number | null;
  /** Number of accepted location fixes in the current active session. Lets
   * the card distinguish a healthy zero-distance start from a stalled GPS. */
  gpsPointCount?: number | null;
  /** null/undefined = tracking hasn't reported a status yet (e.g. still requesting permission) — distinct from 'denied'/'unavailable', which show an explanatory note instead of a bare "0 מ'". */
  gpsStatus?: 'granted' | 'denied' | 'unavailable' | null;
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
  /** Overdue primary cards are status decisions, not "next" walks. */
  primaryLabel?: string;
  /** Home uses a richer surface so the dashboard does not flatten into white cards. */
  tone?: 'default' | 'dashboard';
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
  showDogPhoto = true,
  showMascot = true,
  dogSex,
  onMarkDone,
  onStartWalk,
  onEndWalk,
  activeStartedAt,
  liveDistanceMeters,
  gpsPointCount,
  gpsStatus,
  onMarkNotDone,
  canResolve = true,
  onSwap,
  onEdit,
  onRequestSwap,
  onRequestTimeChange,
  requestStatusLine,
  primaryLabel,
  tone = 'default',
}: NextWalkCardProps) {
  const overdue = isOverdue(walk);
  // Batch 2, requirement 7 ("walk requires attention" in-app state) — see
  // src/logic/walkAttention.ts for why this is a pure, derived read rather
  // than any new persisted flag.
  const requiresAttention = isWalkRequiringAttention(walk);
  const isMine = walk.responsibleUserId === currentUserId;
  const isWeb = Platform.OS === 'web';
  // Status is authoritative for the lifecycle. Some remote responses omit
  // startedAt even though start_walk succeeded; the card must still expose
  // the active-walk/GPS state in that case.
  const isActive = walk.status === 'in_progress' || Boolean(activeStartedAt);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const walkerBob = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isActive || !activeStartedAt) {
      setElapsedSeconds(0);
      walkerBob.stopAnimation();
      walkerBob.setValue(0);
      return;
    }

    const updateElapsed = () => {
      const startedAtMs = new Date(activeStartedAt).getTime();
      setElapsedSeconds(Number.isFinite(startedAtMs) ? Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)) : 0);
    };
    updateElapsed();
    const timer = setInterval(updateElapsed, 1000);
    const bob = Animated.loop(
      Animated.sequence([
        Animated.timing(walkerBob, { toValue: -3, duration: 350, useNativeDriver: true }),
        Animated.timing(walkerBob, { toValue: 0, duration: 350, useNativeDriver: true }),
      ])
    );
    bob.start();
    return () => {
      clearInterval(timer);
      bob.stop();
      walkerBob.stopAnimation();
    };
  }, [activeStartedAt, isActive, walkerBob]);

  const elapsedLabel = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:${String(elapsedSeconds % 60).padStart(2, '0')}`;

  // BATCH 4 (C2/C3/C8) — the Walkie Doggy mascot + a matching personality
  // message, centrally derived (mascotStage.ts) from how far `walk` is from
  // its scheduled time. Memoized on the walk's identity/stage/context so a
  // re-render doesn't reroll a new random message every frame — only a
  // genuine stage change (or a different walk) picks a new one. Recomputing
  // `now` only at render time (not on an interval) is a deliberate, small
  // scope choice: the stage advances whenever this card next re-renders
  // (focus/pull-to-refresh, same cadence the rest of Home already uses),
  // not via a dedicated per-second timer — see the Batch 4 report.
  const { mascotState, message } = useMemo(() => {
    const moment = deriveMascotMoment(walk, new Date());
    const picked = selectMessage(moment.messageCategory, {
      dogName,
      dogSex,
      responsibleName: responsible?.name,
      scheduledTime: walk.scheduledTime,
    });
    return { mascotState: moment.mascotState, message: picked.text };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walk.id, walk.scheduledTime, walk.date, walk.status, dogName, dogSex, responsible?.name]);

  return (
    <View style={[styles.card, tone === 'dashboard' && styles.cardDashboard, isWeb && styles.webCard, isActive && styles.cardActive, overdue && !isActive && styles.cardOverdue]}>
      {tone === 'dashboard' && !isActive && !overdue ? (
        <View pointerEvents="none" style={styles.dashboardTexture}>
          <Svg width="100%" height="100%" viewBox="0 0 360 420" preserveAspectRatio="none">
            <Circle cx="34" cy="40" r="118" fill="#E7E3FF" />
            <Circle cx="350" cy="86" r="138" fill="#E1E9FF" />
            <Circle cx="105" cy="420" r="154" fill="#F0E9FF" />
            <Circle cx="330" cy="360" r="92" fill="#E9E5FF" />
          </Svg>
        </View>
      ) : null}
      <View style={[styles.eyebrowRow, isWeb && styles.webEyebrowRow]}>
        {showDogPhoto ? <DogPhoto photoUrl={dogPhotoUrl} size={isWeb ? 60 : 72} /> : null}
        <RtlText style={styles.eyebrow} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>
          {isActive ? `בזמן טיול · ${dogName}` : (primaryLabel ?? `הטיול הבא של ${dogName}`)}
        </RtlText>
        {/* The Walkie Doggy MASCOT (brand character) — deliberately separate
            from DogPhoto above (the family's REAL dog), never interchanged,
            per the Batch 4 brief's explicit distinction.
            Home-card-only size bump (+50%, from 40/46): the mascot read as a
            small decorative icon at the old size. 60 (web) / 69 (native) is
            capped at DogPhoto's own size in this row (60/72) so the taller
            side of the row never grows and nothing here collides with the
            eyebrow title or card edge. Other WalkieMascot call sites
            (onboarding, reminder, celebration) are untouched. */}
        {showMascot ? <WalkieMascot state={mascotState} size={isWeb ? 52 : 58} testID="next-walk-mascot" /> : null}
      </View>

      {/* An overdue card is an operational decision, not a greeting. Keeping
          the mascot copy out of that state gives the time, assignee and the
          two resolution actions enough calm, predictable room on a phone. */}
      {!overdue && !isActive ? (
        <RtlText style={styles.mascotMessage} numberOfLines={1} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>
          {message}
        </RtlText>
      ) : null}

      {isActive ? (
        <View style={styles.activeWalkBanner} accessibilityRole="timer" accessibilityLabel={`משך הטיול ${elapsedLabel}`}>
          <Animated.Text style={[styles.walkerEmoji, { transform: [{ translateY: walkerBob }] }]}>🚶‍♂️‍➡️🐕‍🦺</Animated.Text>
          <View style={styles.activeWalkCopy}>
            <RtlText style={styles.activeWalkTitle}>מטיילים עכשיו</RtlText>
            <RtlText style={styles.activeWalkSubtitle}>מטיילים יחד ברצועה</RtlText>
          </View>
          <View style={styles.elapsedBlock}>
            <RtlText style={styles.elapsedLabel}>זמן</RtlText>
            <RtlText style={styles.elapsedTime}>{elapsedLabel}</RtlText>
          </View>
        </View>
      ) : null}

      {/* 'unavailable' (no permission API at all, e.g. some sandboxed
          environments) is silently skipped — a persistent "GPS unavailable"
          line for every such device would be clutter with no action the
          person can take, unlike 'denied' (a real, correctable state). */}
      {isActive ? (
        <RtlText style={styles.gpsStatusLine} numberOfLines={1} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>
          {gpsStatus === 'granted'
            ? `📍 ${liveDistanceMeters != null && liveDistanceMeters > 0
              ? formatDistanceMeters(liveDistanceMeters)
              : gpsPointCount != null && gpsPointCount > 0
                ? 'GPS פעיל — ממתין לתנועה'
                : 'ממתין לנתוני GPS…'}`
            : gpsStatus === 'denied'
              ? '📍 מיקום לא זמין — אפשר להפעיל בהגדרות המכשיר'
              : gpsStatus === 'unavailable'
                ? '📍 לא התקבל מיקום — ודאו ששירותי מיקום פעילים'
              : '📍 מפעיל GPS…'}
        </RtlText>
      ) : null}

      <View style={[styles.mainRow, tone === 'dashboard' && styles.dashboardMainRow, isWeb && styles.webMainRow]}>
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
          {!overdue ? (
            <Countdown target={walkDateTime(walk)} />
          ) : null}
        </View>

        <View style={styles.personBlock}>
          {responsible ? (
            <Avatar emoji={responsible.avatar} color={responsible.color} photoUrl={responsible.photoUrl} size={isWeb ? 50 : 56} />
          ) : null}
          <RtlText style={styles.personName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>
            {responsible?.name ?? '—'}
          </RtlText>
          {overdue ? (
            <RtlText style={styles.responsibleLabel} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>
              באחריות {responsible?.name}
            </RtlText>
          ) : null}
        </View>
      </View>

      {overdue ? (
        <RtlText style={[styles.relative, styles.relativeOverdue]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>
          {requiresAttention ? '🚨 דורש תשומת לב · ' : 'ממתין לעדכון · '}
          {relativeTimeLabel(walk)}
        </RtlText>
      ) : null}

      {requestStatusLine && !requestStatusLine.startsWith('✓') && !requestStatusLine.startsWith('✕') ? (
        <RtlText style={styles.requestStatusLine} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>
          {requestStatusLine}
        </RtlText>
      ) : null}

      {!canResolve ? (
        <RtlText style={styles.notMineNote} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>
          {isActive ? 'הטיול בתהליך · ' : overdue ? 'ממתין לעדכון ע״י ' : 'רק '}
          {responsible?.name ?? 'האחראי/ת'}
        </RtlText>
      ) : isActive && onEndWalk ? (
        <Button label="סיים טיול" icon="■" onPress={onEndWalk} style={styles.endWalkButton} shrinkToFit />
      ) : onStartWalk ? (
        <>
          <Button label={tone === 'dashboard' ? 'התחל טיול' : 'התחל טיול עכשיו'} icon="▶" onPress={onStartWalk} style={tone === 'dashboard' ? styles.dashboardStartButton : styles.doneButton} shrinkToFit />
          {overdue && onMarkNotDone ? (
            <View style={styles.resolveRow}>
              <Button
                label="✓ בוצע"
                variant="secondary"
                onPress={onMarkDone}
                style={styles.resolveButton}
                compact
                shrinkToFit
              />
              <Button
                label="לא בוצע"
                variant="secondary"
                onPress={onMarkNotDone}
                style={styles.resolveButton}
                compact
                shrinkToFit
              />
            </View>
          ) : (
            <Button
              label="בוצע"
              variant="secondary"
              onPress={onMarkDone}
              style={tone === 'dashboard' ? styles.dashboardMarkDoneButton : styles.markDoneFallbackButton}
              compact
              shrinkToFit
            />
          )}
        </>
      ) : overdue && onMarkNotDone ? (
        <View style={styles.resolveRow}>
          <Button label="✓ בוצע" onPress={onMarkDone} style={styles.resolveButton} compact shrinkToFit />
          <Button label="לא בוצע" variant="secondary" onPress={onMarkNotDone} style={styles.resolveButton} compact shrinkToFit />
        </View>
      ) : (
        <Button label="בוצע" icon="✓" onPress={onMarkDone} style={styles.doneButton} shrinkToFit />
      )}
      {onEdit || onSwap ? (
        <View style={styles.linkRow}>
          {onEdit ? (
            <RtlText style={styles.linkText} onPress={onEdit} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>
              עריכה
            </RtlText>
          ) : null}
          {onEdit && onSwap ? <RtlText style={styles.linkDivider} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>·</RtlText> : null}
          {onSwap ? (
            <RtlText style={styles.linkText} onPress={onSwap} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>
              החלפה
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
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  cardDashboard: { backgroundColor: '#F7F6FF', borderColor: '#DEDDF5', borderRadius: 28, shadowOpacity: 0.12, shadowRadius: 16, elevation: 4, paddingVertical: 6, overflow: 'hidden' },
  dashboardTexture: { ...StyleSheet.absoluteFillObject, opacity: 0.72 },
  webCard: { borderRadius: radii.xl, paddingHorizontal: 24, paddingVertical: 18 },
  cardActive: { backgroundColor: colors.successSoft, borderColor: colors.success + '55' },
  cardOverdue: { backgroundColor: colors.statusOverdueBg, borderColor: colors.statusOverdue + '44' },
  eyebrowRow: { flexDirection: 'row-reverse', ...nativeDirection('ltr'), alignItems: 'center', gap: 8, marginBottom: 6 },
  webEyebrowRow: { marginBottom: 2 },
  eyebrow: { flex: 1, fontSize: 15, fontWeight: '800', color: '#2E3170', textAlign: 'right' },
  mascotMessage: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primaryDark,
    textAlign: 'right',
    marginBottom: 7,
  },
  gpsStatusLine: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'right',
    marginBottom: 8,
  },
  activeWalkBanner: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    backgroundColor: colors.success + '18',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  walkerEmoji: { fontSize: 30 },
  activeWalkCopy: { flex: 1, alignItems: 'flex-end' },
  activeWalkTitle: { fontSize: 15, fontWeight: '800', color: colors.textPrimary, textAlign: 'right' },
  activeWalkSubtitle: { fontSize: 12, color: colors.textSecondary, textAlign: 'right', marginTop: 2 },
  elapsedBlock: { minWidth: 72, alignItems: 'center' },
  elapsedLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: '700' },
  elapsedTime: { fontSize: 22, color: colors.success, fontWeight: '900', fontVariant: ['tabular-nums'] },
  // The row follows the reading direction: the scheduled time anchors the
  // right edge and the responsible person sits opposite it. Fixed halves
  // prevent a long status from pushing either item into a third column.
  mainRow: { flexDirection: 'row-reverse', alignItems: 'center', marginBottom: 14, gap: 12 },
  webMainRow: { marginBottom: 8, minHeight: 68 },
  timeBlock: { flex: 1, alignItems: 'flex-start', minWidth: 0 },
  // Reduced from 44 (BUG report: too large, wrapped to two lines on a
  // narrow iPhone and dwarfed the rest of the card). Still the single
  // biggest element on the card, so it stays the clear visual anchor next
  // to the responsible person's name (18) and "סמן כבוצע" button.
  time: { fontSize: 32, fontWeight: '800', color: colors.textPrimary, textAlign: 'right' },
  dateContext: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginTop: 1 },
  relative: { width: '100%', fontSize: 14, fontWeight: '700', color: colors.primary, marginTop: 4, textAlign: 'right' },
  relativeOverdue: { color: colors.statusOverdue },
  // Keep the family-member circle visually separated from the large time on
  // the dashboard, especially on narrow phones.
  // Use an intentionally wider central gutter and inset both columns so the
  // assignee circle reads as its own block instead of touching the time.
  dashboardMainRow: { gap: 28, paddingHorizontal: 8, marginBottom: 4 },
  personBlock: { flex: 1, alignItems: 'flex-end', gap: 3, minWidth: 0 },
  personName: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'left' },
  responsibleLabel: { fontSize: 13, color: colors.textSecondary, textAlign: 'left' },
  doneButton: { marginTop: 2 },
  dashboardStartButton: { marginTop: 0, backgroundColor: '#4A43B6', borderColor: '#4A43B6' },
  markDoneFallbackButton: { marginTop: 8, borderWidth: 1.5, borderColor: colors.primaryDark },
  dashboardMarkDoneButton: { marginTop: 4, minHeight: 32, paddingVertical: 3, borderWidth: 1.5, borderColor: '#4A43B6' },
  endWalkButton: { marginTop: 4, backgroundColor: colors.statusOverdue },
  resolveRow: { flexDirection: 'row-reverse', gap: 8, marginTop: 8, width: '100%' },
  resolveButton: { flex: 1, minWidth: 0 },
  notMineNote: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginTop: 6 },
  requestStatusLine: {
    width: '100%',
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '600',
    color: colors.primaryDark,
    marginTop: 4,
    lineHeight: 18,
  },
  requestStatusApproved: { color: colors.statusDone },
  linkRow: { flexDirection: 'row-reverse', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 6 },
  linkText: { color: colors.primaryDark, fontSize: 14, fontWeight: '600' },
  linkDivider: { color: colors.textSecondary },
});
