import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import { Button } from './Button';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import type { QuarantinedItem, SyncConflict, SyncOperation } from '../data/syncQueue';

/** Human-readable Hebrew label per queued-write type — same "never raw technical action IDs" convention AdminAuditLogModal's ACTION_LABEL already established for the audit trail. */
const OP_LABEL: Record<SyncOperation['type'], string> = {
  createUser: 'הוספת בן משפחה',
  upsertUser: 'עדכון פרטי בן משפחה',
  deleteUser: 'הסרת בן משפחה',
  deleteFamilyMember: 'הסרת בן משפחה',
  upsertDog: 'עדכון פרטי כלב',
  upsertHealthTask: 'עדכון רשומת בריאות/טיפוח',
  upsertGpsSession: 'עדכון נתוני GPS',
  upsertAchievementUnlock: 'עדכון הישג',
  upsertScheduleRule: 'עדכון שעה קבועה',
  deleteScheduleRule: 'מחיקת שעה קבועה',
  addScheduleEntries: 'הוספת טיולים מתוכננים',
  updateScheduleEntry: 'עדכון טיול מתוכנן',
  deleteScheduleEntry: 'מחיקת טיול מתוכנן',
  saveWalk: 'עדכון טיול',
  deleteWalk: 'מחיקת טיול',
  updateUserReminderSetting: 'עדכון הגדרת תזכורות',
  updateUserGamificationSetting: 'עדכון הגדרת הישגים',
};

function opLabel(op: SyncOperation): string {
  return OP_LABEL[op.type] ?? op.type;
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

interface SyncIssuesModalProps {
  visible: boolean;
  conflicts: SyncConflict[];
  quarantined: QuarantinedItem[];
  onClearConflicts: () => void;
  onClose: () => void;
}

/**
 * PRD §20: "persistent queue conflicts must be visible, never silently
 * disappear." SyncQueue's getConflicts()/getQuarantined() were already
 * fully implemented and tested at the data layer but had no UI consumer
 * at all — this is that consumer. Opened from Settings, and only offered
 * there in the first place when there's actually something to show (see
 * SettingsScreen's own row-visibility guard).
 *
 * Conflicts (a write the server permanently rejected) can be dismissed
 * once reviewed — clearSyncConflicts() — since a person choosing to
 * dismiss what they've now seen is not the app silently hiding it.
 * Quarantined items (a queued write whose original actor is unknown —
 * see SyncQueue.QuarantinedItem's own doc comment) are deliberately
 * read-only here: there is no safe automated resolution for one, so this
 * screen only ever explains what's stuck, never offers a "discard" action
 * for it.
 */
export function SyncIssuesModal({ visible, conflicts, quarantined, onClearConflicts, onClose }: SyncIssuesModalProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="סגירת בעיות סנכרון">
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <RtlText style={styles.title} accessibilityRole="header">⚠️ בעיות סנכרון</RtlText>
          <RtlText style={styles.subtitle}>
            שינויים שנעשו במכשיר הזה ולא הצלחנו לשמור בשרת. שאר האפליקציה ממשיכה לעבוד כרגיל.
          </RtlText>

          <ScrollView style={styles.scroll}>
            <RtlText style={styles.sectionLabel}>שינויים שנדחו</RtlText>
            {conflicts.length === 0 ? (
              <RtlText style={styles.emptyHint}>אין שינויים שנדחו.</RtlText>
            ) : (
              conflicts.map((c, i) => (
                <View key={i} style={styles.row}>
                  <RtlText style={styles.rowTitle}>{opLabel(c.op)}</RtlText>
                  <RtlText style={styles.rowMeta}>{c.message}</RtlText>
                  <RtlText style={[styles.rowMeta, styles.ltrText]}>{formatTimestamp(c.failedAt)}</RtlText>
                </View>
              ))
            )}

            <RtlText style={[styles.sectionLabel, styles.sectionLabelSpaced]}>שינויים הממתינים לבדיקה</RtlText>
            {quarantined.length === 0 ? (
              <RtlText style={styles.emptyHint}>אין שינויים הממתינים לבדיקה.</RtlText>
            ) : (
              quarantined.map((q, i) => (
                <View key={i} style={styles.row}>
                  <RtlText style={styles.rowTitle}>{opLabel(q.op)}</RtlText>
                  <RtlText style={styles.rowMeta}>{q.reason}</RtlText>
                  <RtlText style={[styles.rowMeta, styles.ltrText]}>{formatTimestamp(q.quarantinedAt)}</RtlText>
                </View>
              ))
            )}
          </ScrollView>

          {conflicts.length > 0 ? (
            <Button label="הבנתי, נקה רשימת שינויים שנדחו" variant="secondary" onPress={onClearConflicts} style={styles.clearButton} />
          ) : null}
          <Button label="סגור" variant="secondary" onPress={onClose} style={styles.closeButton} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, padding: 24, maxHeight: '85%' },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.xs },
  subtitle: { ...typography.meta, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.sm },
  scroll: { flexGrow: 0, flexShrink: 1 },
  sectionLabel: { ...typography.sectionTitle, fontSize: 15, color: colors.textPrimary, textAlign: 'right', marginBottom: spacing.xs },
  sectionLabelSpaced: { marginTop: spacing.md },
  emptyHint: { ...typography.meta, color: colors.textSecondary, textAlign: 'right' },
  row: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
    gap: 2,
  },
  rowTitle: { ...typography.body, fontSize: 14, fontWeight: '700', color: colors.textPrimary, textAlign: 'right' },
  rowMeta: { ...typography.meta, color: colors.textSecondary, textAlign: 'right' },
  ltrText: { writingDirection: 'ltr', textAlign: 'right' },
  clearButton: { marginTop: spacing.sm },
  closeButton: { marginTop: spacing.xs },
});
