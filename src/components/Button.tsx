import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, ViewStyle } from 'react-native';
import { RtlText } from './RtlText';
import { colors } from '../theme/colors';
import { layout, radii, spacing, typography } from '../theme/tokens';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  icon?: string;
  style?: ViewStyle;
  /**
   * Round 8, Fix 3: tighter horizontal padding + slightly smaller label so
   * a longer Hebrew label (e.g. "הפוך למנהל") fits on one line in a
   * narrower slot — a paired confirm/cancel button row, specifically —
   * instead of wrapping to 2-3 lines as seen on a real iPhone. General
   * purpose: any caller with a tight/paired button layout can opt in,
   * not just ConfirmModal's confirm/cancel row (its only current use).
   * Purely sizing — variant colors/behavior are unaffected.
   */
  compact?: boolean;
  /**
   * Round 6F: independent of `compact` — lets a long label shrink to fit on
   * one line at larger Dynamic Type sizes, WITHOUT also shrinking this
   * button's padding/base font size the way `compact` does. For a normal,
   * full-size, non-paired button whose label only risks truncating at
   * larger accessibility text sizes (`compact` is for the paired flex:1
   * row case instead — see its own doc comment above).
   */
  shrinkToFit?: boolean;
  /**
   * Final QA round, item B: opts a long label OUT of the hardcoded
   * `numberOfLines={1}` below, letting it wrap to 2+ lines instead of
   * truncating to "…" — for a full-width button whose label is
   * genuinely too long to shrink-to-fit legibly (e.g. Settings'
   * Management sheet's "🧑‍💻 בדיקה אמיתית: התחבר כבן משפחה אחר"), where
   * there's vertical room to spare rather than fighting for one line.
   * Independent of `compact`/`shrinkToFit` — every other existing call
   * site is unaffected (defaults to the original single-line behavior).
   */
  wrap?: boolean;
  /**
   * QA Guardian follow-up (accessibilityHint-on-destructive-actions):
   * an optional screen-reader hint for buttons whose action fires
   * immediately with no confirmation step (e.g. an irreversible reject/
   * remove action) — announced after the accessible name, same as
   * `accessibilityLabel` below. Omitted by every existing call site
   * (defaults to `undefined`, i.e. no behavior change).
   */
  accessibilityHint?: string;
  /**
   * Overrides the accessible name RN would otherwise derive from the
   * visible `label` text. Only needed when the visible label alone is
   * ambiguous out of context; every existing call site omits this and
   * keeps relying on the label-derived accessible name.
   */
  accessibilityLabel?: string;
}

/** Big, easy-to-tap button — minimum 52px tall, per the "buttons kids and adults can both tap" requirement. */
export function Button({ label, onPress, variant = 'primary', loading, disabled, icon, style, compact, shrinkToFit, wrap, accessibilityHint, accessibilityLabel }: ButtonProps) {
  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        compact && styles.baseCompact,
        isPrimary && styles.primary,
        variant === 'secondary' && styles.secondary,
        isDanger && styles.danger,
        (disabled || loading) && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary || isDanger ? colors.textInverse : colors.primary} />
      ) : (
        <RtlText
          style={[
            styles.label,
            compact && styles.labelCompact,
            (isPrimary || isDanger) && styles.labelInverse,
            wrap && styles.labelWrap,
          ]}
          numberOfLines={wrap ? undefined : 1}
          adjustsFontSizeToFit={!wrap && (compact || shrinkToFit)}
          minimumFontScale={0.85}
          maxFontSizeMultiplier={(compact || shrinkToFit) ? 1.35 : undefined}
        >
          {icon ? `${icon}  ${label}` : label}
        </RtlText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: Math.max(52, layout.minTouchTarget),
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    flexDirection: 'row',
  },
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border },
  danger: { backgroundColor: colors.statusOverdue },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  label: { ...typography.sectionTitle, fontSize: 17, color: colors.textPrimary, textAlign: 'center' },
  labelInverse: { color: colors.textInverse },
  labelWrap: { textAlign: 'center' },
  // Round 8, Fix 3 (see `compact` prop doc comment above).
  baseCompact: { paddingHorizontal: spacing.md, minHeight: layout.minTouchTarget },
  labelCompact: { fontSize: 16 },
});
