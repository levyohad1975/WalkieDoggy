import React from 'react';
import { StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import type { WalkStatus } from '../types';
import { colors } from '../theme/colors';

// ✓/✕ glyphs are shown alongside every label so status is never conveyed by
// color alone (accessibility — Section 15).
const LABELS: Record<WalkStatus, string> = {
  pending: 'ממתין',
  done: 'בוצע',
  skipped: 'לא בוצע',
};

const GLYPHS: Partial<Record<WalkStatus, string>> = {
  done: '✓', // ✓
  skipped: '✕', // ✕
};

const STYLES: Record<WalkStatus, { bg: string; fg: string }> = {
  pending: { bg: colors.statusPendingBg, fg: colors.statusPending },
  done: { bg: colors.statusDoneBg, fg: colors.statusDone },
  skipped: { bg: colors.statusSkippedBg, fg: colors.statusSkipped },
};

export function StatusBadge({ status, overdue, glyphOnly = false }: { status: WalkStatus; overdue?: boolean; glyphOnly?: boolean }) {
  const isUnresolvedOverdue = overdue && status === 'pending';
  const palette = isUnresolvedOverdue ? { bg: colors.statusOverdueBg, fg: colors.statusOverdue } : STYLES[status];
  const label = isUnresolvedOverdue ? 'ממתין' : LABELS[status];
  const glyph = isUnresolvedOverdue ? '⏳' : GLYPHS[status];
  const visibleText = glyphOnly && glyph ? glyph : `${glyph ? `${glyph} ` : ''}${label}`;

  return (
    <View
      style={[styles.badge, { backgroundColor: palette.bg }]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      <RtlText style={[styles.text, { color: palette.fg }]} numberOfLines={1}>
        {visibleText}
      </RtlText>
    </View>
  );
}

/**
 * QA pass v3, issue 9 fix: on a narrow phone the row this badge sits in
 * (WalkRow's mainRow — a fixed-width time block, the avatar, this badge,
 * and a flex-shrinking `middle` name/meta column) could squeeze this Text
 * below its own natural width, and a single Hebrew word ("בוצע"/"לא בוצע")
 * has no good internal break point, so it wrapped character-by-character
 * instead of staying on one line. `numberOfLines={1}` above stops the wrap
 * outright (Yoga still won't shrink the badge's flexShrink:0 View below,
 * see `badge` below, so the label never gets clipped either — only
 * `middle`, which is deliberately the one flexible element in that row, is
 * meant to give up width first).
 */
const styles = StyleSheet.create({
  badge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, flexShrink: 0 },
  text: { fontSize: 13, fontWeight: '700' },
});
