import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import { colors } from '../theme/colors';
import { nativeDirection } from '../theme/tokens';

function two(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * Live per-second HH:MM:SS countdown to `target`.
 *
 * Section 6.2 requires the segments to visually read, left-to-right on
 * screen, as HOURS - MINUTES - SECONDS even though the surrounding layout is
 * RTL. A single bidi string ("02:15:40") is NOT safe here — under RTL
 * paragraph direction a mixed LTR/RTL context can reorder or mirror
 * punctuation-separated numeric runs unpredictably depending on platform/
 * font. Instead each segment is rendered as its own manually-ordered Text
 * node inside a row container, and every segment is wrapped with explicit
 * LRM (U+200E) marks so each two-digit number itself always renders
 * left-to-right regardless of the ambient direction.
 *
 * RTL-ORDER BUG FIX: `flexDirection: 'row'` alone is NOT a physical
 * direction — it means "main axis runs start→end", and Yoga resolves
 * "start"/"end" against the container's inherited layout `direction`
 * (RTL by default here, since I18nManager is RTL for this Hebrew app).
 * With no `direction` pinned on the row itself, that resolution isn't
 * anchored to the row's own style — it's inherited top-down from
 * whichever ancestor last set an explicit direction, and can be
 * re-resolved per remeasure. Real-device QA confirmed exactly that
 * symptom: physically reversed (SS - MM - HH) at 100% Dynamic Type, but
 * physically correct (HH - MM - SS) at 160% — the SAME `flexDirection:
 * 'row'`, with two different physical results, because "row" was never
 * anchored to an explicit direction and different measured widths at
 * different font scales caused Yoga to resolve it differently. This is a
 * layout-determinism bug, not a bidi-string bug and not a data-order bug —
 * the hours/minutes/seconds values below are computed in, and passed to
 * the JSX in, hours→minutes→seconds order, unchanged by this fix.
 *
 * The fix: pin `direction: 'ltr'` explicitly on `wrapper` (which every
 * row inherits from) AND on `row`/`labelRow` themselves, so "row" always
 * means physical left-to-right, unconditionally — never inherited,
 * re-resolved, or width-dependent. Both rows share the identical
 * mechanism (same `direction: 'ltr'` + `flexDirection: 'row'` pairing),
 * so they can only ever move together, never drift relative to each
 * other at any font scale.
 *
 * WEB NOTE: `direction` is a real, correctly-typed RN `ViewStyle` property
 * (see react-native/Libraries/StyleSheet/StyleSheetTypes.d.ts) and is
 * required exactly as above on iOS/Android. react-native-web's own style
 * validator (exports/StyleSheet/validate.js) unconditionally rejects and
 * strips this specific property before it reaches the DOM — on web it has
 * always been a no-op, just a console.error on every render. `nativeDirection`
 * (theme/tokens.ts) scopes it to native-only, removing that warning with
 * zero behavior change on either platform (web already dropped the key;
 * native still gets it).
 */
export function Countdown({ target, now, compact = false }: { target: Date; now?: Date; compact?: boolean }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const current = now ?? new Date();
  const diffMs = Math.max(0, target.getTime() - current.getTime());
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const LRM = '‎';

  return (
    <View style={[styles.wrapper, compact && styles.compactWrapper]}>
      <View style={styles.row}>
        <RtlText style={[styles.segment, compact && styles.compactSegment]} maxFontSizeMultiplier={SEGMENT_MAX_FONT_SCALE}>
          {LRM}{two(hours)}{LRM}
        </RtlText>
        <RtlText style={[styles.colon, compact && styles.compactColon]} maxFontSizeMultiplier={SEGMENT_MAX_FONT_SCALE}>
          :
        </RtlText>
        <RtlText style={[styles.segment, compact && styles.compactSegment]} maxFontSizeMultiplier={SEGMENT_MAX_FONT_SCALE}>
          {LRM}{two(minutes)}{LRM}
        </RtlText>
        <RtlText style={[styles.colon, compact && styles.compactColon]} maxFontSizeMultiplier={SEGMENT_MAX_FONT_SCALE}>
          :
        </RtlText>
        <RtlText style={[styles.segment, compact && styles.compactSegment]} maxFontSizeMultiplier={SEGMENT_MAX_FONT_SCALE}>
          {LRM}{two(seconds)}{LRM}
        </RtlText>
      </View>
      {!compact ? <View style={styles.labelRow}>
        <RtlText style={styles.label} maxFontSizeMultiplier={LABEL_MAX_FONT_SCALE}>
          שעות
        </RtlText>
        <RtlText style={styles.label} maxFontSizeMultiplier={LABEL_MAX_FONT_SCALE}>
          דקות
        </RtlText>
        <RtlText style={styles.label} maxFontSizeMultiplier={LABEL_MAX_FONT_SCALE}>
          שניות
        </RtlText>
      </View> : null}
    </View>
  );
}

/**
 * Bug-fix pass (Dynamic Type @ 160%): the countdown is a fixed-format
 * HH:MM:SS info readout, not free-flowing text — at 100%/135% Dynamic Type
 * it read fine, but at 160% the unbounded scaling made the digit/colon/
 * label Text nodes wide enough to overlap or spill out of the Next-Walk
 * card's flex:1 timeBlock column.
 *
 * `maxFontSizeMultiplier` caps how far each Text can grow from the OS
 * scale factor, WITHOUT touching `allowFontScaling` (still true, so the
 * countdown keeps growing visibly between 100% and 135% exactly as QA
 * confirmed looked good) and without disabling scaling app-wide — every
 * other Text on Home keeps scaling normally.
 *
 * Values are chosen so a ~135%-equivalent OS multiplier is still UNDER the
 * cap (segments/colons keep growing normally through that range) while a
 * ~160%-equivalent multiplier gets clamped down to the cap — some extra
 * growth beyond 135% still shows (not "identical but tiny"), but it stops
 * short of the point where the digits would overflow their column:
 *   segment 22pt * 1.35 = 29.7pt  → two tabular-nums digits ≈ 1.2×em ≈ 35.6pt,
 *     fits inside the 42pt minWidth column below with room to spare.
 *   colon   20pt * 1.35 = 27pt    → a single ":" glyph, well under its margin.
 *   label   10pt * 1.30 = 13pt    → "שניות" (longest label, 5 chars) ≈ 37.5pt,
 *     fits inside the matching 42pt minWidth column.
 */
const SEGMENT_MAX_FONT_SCALE = 1.35;
const LABEL_MAX_FONT_SCALE = 1.3;

// Digit column width with the caps above applied (see comment on the
// scale constants). Segment and label share this width so the שעות/דקות/
// שניות captions stay aligned under their HH/MM/SS digits at every size.
const COLUMN_MIN_WIDTH = 42;

const styles = StyleSheet.create({
  // RTL-ORDER BUG FIX: pinned so every descendant row resolves "row" as
  // physical left-to-right unconditionally — see the fix explanation
  // above the component. Belt-and-suspenders with the same property on
  // `row`/`labelRow` themselves, since neither this wrapper's direction
  // nor a row's own direction alone should be trusted to be the single
  // place this can never regress from.
  wrapper: { ...nativeDirection('ltr') },
  compactWrapper: { marginTop: 1 },
  row: { flexDirection: 'row', ...nativeDirection('ltr'), alignItems: 'baseline', flexWrap: 'nowrap' },
  segment: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.textPrimary,
    minWidth: COLUMN_MIN_WIDTH,
    textAlign: 'center',
    flexShrink: 0,
    // Tabular (monospaced) figures so the digits don't visually jump/
    // reflow width every second as e.g. "1" and "8" trade places.
    fontVariant: ['tabular-nums'],
  },
  compactSegment: { fontSize: 18, minWidth: 34 },
  colon: { fontSize: 20, fontWeight: '700', color: colors.textSecondary, marginHorizontal: 1, flexShrink: 0 },
  compactColon: { fontSize: 17, marginHorizontal: 0 },
  // Same deterministic-LTR mechanism as `row` above, applied identically
  // so the labels row can never end up reversed relative to the digits
  // row it must stay aligned under.
  labelRow: { flexDirection: 'row', ...nativeDirection('ltr'), justifyContent: 'space-between', marginTop: 2 },
  label: {
    fontSize: 10,
    color: colors.textSecondary,
    minWidth: COLUMN_MIN_WIDTH,
    textAlign: 'center',
    flexShrink: 0,
  },
});
