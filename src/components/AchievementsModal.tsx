import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { RtlText } from './RtlText';
import { Button } from './Button';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import { achievementDefinition, type AchievementProgress } from '../logic/achievements';

interface AchievementsModalProps {
  visible: boolean;
  familyProgress: AchievementProgress[];
  personalProgress: AchievementProgress[];
  gamificationEnabled: boolean;
  onSetGamificationEnabled: (enabled: boolean) => void;
  onClose: () => void;
}

function ProgressRow({ progress }: { progress: AchievementProgress }) {
  const def = achievementDefinition(progress.key);
  if (!def) return null;
  const percent = progress.target === 0 ? 0 : Math.max(0, Math.min(100, (progress.current / progress.target) * 100));
  return (
    <View style={[styles.row, progress.unlocked && styles.rowUnlocked]}>
      <RtlText style={styles.rowIcon}>{def.icon}</RtlText>
      <View style={styles.rowBody}>
        <View style={styles.rowTitleLine}>
          <RtlText style={styles.rowTitle} numberOfLines={1}>{def.title}</RtlText>
          {progress.unlocked ? <RtlText style={styles.unlockedBadge}>✓ הושג</RtlText> : null}
        </View>
        <RtlText style={styles.rowDescription}>{def.description}</RtlText>
        {!progress.unlocked ? (
          <>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${percent}%` }]} />
            </View>
            <RtlText style={[styles.progressText, styles.ltrText]}>
              {progress.current}/{progress.target}
            </RtlText>
          </>
        ) : null}
      </View>
    </View>
  );
}

/**
 * PRD §9 gamification ("גביעים ועידוד משפחתי") — read-only progress view,
 * opened from Settings. Deliberately shows every achievement (locked and
 * unlocked) with clear progress toward the next goal rather than hiding
 * locked ones, per the PRD's "no dark patterns, no punishment for missing
 * one" requirement — nothing here is presented as a penalty, only as a
 * next step.
 */
export function AchievementsModal({
  visible,
  familyProgress,
  personalProgress,
  gamificationEnabled,
  onSetGamificationEnabled,
  onClose,
}: AchievementsModalProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="סגירת הישגים">
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <RtlText style={styles.title} accessibilityRole="header">🏆 הישגים</RtlText>

          <View style={styles.toggleRow}>
            <Switch
              value={gamificationEnabled}
              onValueChange={onSetGamificationEnabled}
              accessibilityLabel="הצגת חגיגת הישג חדש"
            />
            <RtlText style={styles.toggleLabel}>הצגת חגיגה כשנפתח הישג חדש</RtlText>
          </View>

          <ScrollView style={styles.scroll}>
            <RtlText style={styles.sectionLabel}>הישגי המשפחה</RtlText>
            {familyProgress.map((p) => (
              <ProgressRow key={p.key} progress={p} />
            ))}

            {personalProgress.length > 0 ? (
              <>
                <RtlText style={styles.sectionLabel}>ההישגים שלי</RtlText>
                {personalProgress.map((p) => (
                  <ProgressRow key={p.key} progress={p} />
                ))}
              </>
            ) : null}
          </ScrollView>

          <Button label="סגור" variant="secondary" onPress={onClose} style={styles.closeButton} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, padding: radii.xl, maxHeight: '85%' },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.sm },
  toggleRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs, paddingHorizontal: spacing.xs },
  toggleLabel: { flex: 1, ...typography.meta, color: colors.textSecondary, textAlign: 'right' },
  scroll: { flexGrow: 0, flexShrink: 1 },
  sectionLabel: { ...typography.sectionTitle, fontSize: 15, color: colors.textPrimary, textAlign: 'right', marginTop: spacing.md, marginBottom: spacing.xs },
  row: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  rowUnlocked: { backgroundColor: colors.statusDoneBg },
  rowIcon: { fontSize: 22 },
  rowBody: { flex: 1, gap: 2 },
  rowTitleLine: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.xs },
  rowTitle: { flexShrink: 1, ...typography.body, fontSize: 15, fontWeight: '700', color: colors.textPrimary, textAlign: 'right' },
  unlockedBadge: { fontSize: 12, fontWeight: '700', color: colors.statusDone },
  rowDescription: { ...typography.meta, color: colors.textSecondary, textAlign: 'right' },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden', marginTop: 4 },
  barFill: { height: '100%', borderRadius: 4, backgroundColor: colors.primary },
  progressText: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, marginTop: 2 },
  ltrText: { writingDirection: 'ltr', textAlign: 'right' },
  closeButton: { marginTop: spacing.sm },
});
