import React, { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { RtlText } from './RtlText';
import { Button } from './Button';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import { generateId } from '../lib/id';
import { HEALTH_TASK_CATEGORIES as CATEGORIES, HEALTH_TASK_CATEGORY_LABELS as CATEGORY_LABELS, getHealthTaskLifecycle } from '../logic/healthTasks';
import type { Dog, FamilyUser, HealthTask, HealthTaskCategory } from '../types';

interface HealthGroomingModalProps {
  visible: boolean;
  dog: Dog | null;
  tasks: HealthTask[];
  users: FamilyUser[];
  currentUserId: string | null | undefined;
  onSave: (task: HealthTask) => Promise<void>;
  onComplete: (taskId: string) => Promise<void>;
  onClose: () => void;
}

const LIFECYCLE_BADGE: Record<'upcoming' | 'due' | 'overdue', { label: string; color: string; bg: string }> = {
  upcoming: { label: 'קרוב', color: colors.statusPending, bg: colors.statusPendingBg },
  due: { label: 'היום', color: colors.statusCurrent, bg: colors.statusCurrentBg },
  overdue: { label: 'באיחור', color: colors.statusOverdue, bg: colors.statusOverdueBg },
};

/**
 * Phase 3 kickoff (PRD §10, בריאות וטיפוח) — a per-DOG journal + task list,
 * opened from SettingsScreen (per the PRD's own "Settings includes ...
 * health/grooming" line) for whichever dog is currently ACTIVE in
 * familyStore (see FamilyOnboarding's multi-dog selector) — never a
 * family-wide list, since every record is attributed to one specific dog
 * (supabase/migrations/0049_health_grooming_foundation.sql).
 */
export function HealthGroomingModal({ visible, dog, tasks, users, currentUserId, onSave, onComplete, onClose }: HealthGroomingModalProps) {
  const [formVisible, setFormVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<HealthTask | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);

  const { open, completed } = useMemo(() => {
    const open = tasks
      .filter((t) => !t.completedAt)
      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
    const completed = tasks
      .filter((t) => t.completedAt)
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
    return { open, completed };
  }, [tasks]);

  if (!dog) return null;

  const openAddForm = () => {
    setEditingTask(null);
    setFormVisible(true);
  };

  const openEditForm = (task: HealthTask) => {
    setEditingTask(task);
    setFormVisible(true);
  };

  const handleComplete = async (taskId: string) => {
    setCompletingId(taskId);
    try {
      await onComplete(taskId);
    } catch {
      Alert.alert('לא הצלחנו לעדכן', 'נסו שוב בעוד רגע.');
    } finally {
      setCompletingId(null);
    }
  };

  return (
    <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="סגירת בריאות וטיפוח">
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <RtlText style={styles.title} accessibilityRole="header">🏥 בריאות וטיפוח · {dog.name}</RtlText>
            <ScrollView style={styles.scroll}>
              <RtlText style={styles.sectionLabel}>משימות פתוחות</RtlText>
              {open.length === 0 ? (
                <RtlText style={styles.emptyHint}>אין משימות פתוחות כרגע.</RtlText>
              ) : (
                open.map((t) => {
                  const lifecycle = getHealthTaskLifecycle(t) as 'upcoming' | 'due' | 'overdue';
                  const badge = LIFECYCLE_BADGE[lifecycle];
                  const responsibleName = t.responsibleUserId ? users.find((u) => u.id === t.responsibleUserId)?.name : undefined;
                  return (
                    <View key={t.id} style={styles.row}>
                      <Pressable
                        style={styles.rowBody}
                        onPress={() => openEditForm(t)}
                        accessibilityRole="button"
                        accessibilityLabel={`עריכת ${t.title}, ${CATEGORY_LABELS[t.category]}, ${badge.label}`}
                      >
                        <View style={styles.rowTitleLine}>
                          <RtlText style={styles.rowTitle} numberOfLines={1}>{t.title}</RtlText>
                          <View style={[styles.lifecycleBadge, { backgroundColor: badge.bg }]}>
                            <RtlText style={[styles.lifecycleBadgeText, { color: badge.color }]}>{badge.label}</RtlText>
                          </View>
                        </View>
                        <RtlText style={styles.rowMeta}>
                          {CATEGORY_LABELS[t.category]}
                          {t.dueDate ? ` · יעד: ${t.dueDate}` : ''}
                          {responsibleName ? ` · אחראי/ת: ${responsibleName}` : ''}
                          {t.recurrenceIntervalDays ? ` · חוזר כל ${t.recurrenceIntervalDays} ימים` : ''}
                        </RtlText>
                      </Pressable>
                      <Pressable
                        onPress={() => void handleComplete(t.id)}
                        disabled={completingId === t.id}
                        style={styles.completeButton}
                        accessibilityRole="button"
                        accessibilityLabel={`סימון ${t.title} כבוצע`}
                      >
                        <RtlText style={styles.completeButtonText}>{completingId === t.id ? '…' : '✓ בוצע'}</RtlText>
                      </Pressable>
                    </View>
                  );
                })
              )}

              <RtlText style={styles.sectionLabel}>היסטוריה</RtlText>
              {completed.length === 0 ? (
                <RtlText style={styles.emptyHint}>אין רשומות עדיין.</RtlText>
              ) : (
                completed.map((t) => {
                  const completedByName = t.completedByUserId ? users.find((u) => u.id === t.completedByUserId)?.name : undefined;
                  return (
                    <Pressable
                      key={t.id}
                      style={styles.row}
                      onPress={() => openEditForm(t)}
                      accessibilityRole="button"
                      accessibilityLabel={`עריכת ${t.title}, ${CATEGORY_LABELS[t.category]}`}
                    >
                      <View style={styles.rowBody}>
                        <RtlText style={styles.rowTitle} numberOfLines={1}>{t.title}</RtlText>
                        <RtlText style={styles.rowMeta}>
                          {CATEGORY_LABELS[t.category]}
                          {t.category === 'weight' && t.weightKg != null ? ` · ${t.weightKg} ק"ג` : ''}
                          {t.completedAt ? ` · הושלם ${t.completedAt.slice(0, 10)}` : ''}
                          {completedByName ? ` · ע"י ${completedByName}` : ''}
                        </RtlText>
                      </View>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
            <Button label="+ הוספת רשומה" onPress={openAddForm} style={styles.addButton} />
            <Button label="סגור" variant="secondary" onPress={onClose} style={styles.closeButton} />
          </Pressable>
        </Pressable>
      </Modal>

      <HealthTaskFormModal
        visible={formVisible}
        dog={dog}
        task={editingTask}
        users={users}
        currentUserId={currentUserId}
        onSave={async (task) => {
          await onSave(task);
          setFormVisible(false);
        }}
        onClose={() => setFormVisible(false)}
      />
    </>
  );
}

interface HealthTaskFormModalProps {
  visible: boolean;
  dog: Dog;
  task: HealthTask | null;
  users: FamilyUser[];
  currentUserId: string | null | undefined;
  onSave: (task: HealthTask) => Promise<void>;
  onClose: () => void;
}

/**
 * Add/edit sheet for one record. Deliberately implicit about log-vs-task
 * (matching the PRD's "journal AND task list" duality without a separate
 * toggle): a due date left blank saves as a COMPLETED log entry (now); a
 * due date filled in saves as an OPEN task. Editing an already-completed
 * record preserves its existing completedAt — marking a record complete is
 * this modal's parent's dedicated "✓ בוצע" row action, not something this
 * form does.
 */
function HealthTaskFormModal({ visible, dog, task, users, currentUserId, onSave, onClose }: HealthTaskFormModalProps) {
  const [category, setCategory] = useState<HealthTaskCategory>('vaccination');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [responsibleUserId, setResponsibleUserId] = useState<string | undefined>(undefined);
  const [recurrenceDays, setRecurrenceDays] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setCategory(task?.category ?? 'vaccination');
    setTitle(task?.title ?? '');
    setNotes(task?.notes ?? '');
    setDueDate(task?.dueDate ?? '');
    setWeightKg(task?.weightKg != null ? String(task.weightKg) : '');
    setResponsibleUserId(task?.responsibleUserId);
    setRecurrenceDays(task?.recurrenceIntervalDays != null ? String(task.recurrenceIntervalDays) : '');
  }, [visible, task]);

  const handleSave = async () => {
    if (!title.trim()) {
      Alert.alert('חסר שם', 'יש להזין שם לרשומה.');
      return;
    }
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      Alert.alert('תאריך לא תקין', 'יש להזין תאריך בפורמט YYYY-MM-DD, או להשאיר ריק לרשומה שהושלמה כעת.');
      return;
    }
    const trimmedWeight = weightKg.trim();
    const parsedWeight = trimmedWeight ? Number(trimmedWeight) : undefined;
    if (category === 'weight' && trimmedWeight && (Number.isNaN(parsedWeight) || (parsedWeight as number) <= 0)) {
      Alert.alert('משקל לא תקין', 'יש להזין משקל חיובי בק"ג.');
      return;
    }
    const trimmedRecurrence = recurrenceDays.trim();
    const parsedRecurrence = trimmedRecurrence ? Number(trimmedRecurrence) : undefined;
    if (trimmedRecurrence && (!Number.isInteger(parsedRecurrence) || (parsedRecurrence as number) <= 0)) {
      Alert.alert('תדירות לא תקינה', 'יש להזין מספר ימים חיובי, או להשאיר ריק לרשומה חד-פעמית.');
      return;
    }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      // No due date, and this isn't already a completed record being
      // edited -> it's a brand-new LOG entry, completed now (see this
      // component's own doc comment).
      const logNow = !dueDate && !task?.completedAt;
      await onSave({
        id: task?.id ?? generateId('health-task'),
        familyId: dog.familyId,
        dogId: dog.id,
        category,
        title: title.trim(),
        notes: notes.trim() || undefined,
        weightKg: category === 'weight' ? parsedWeight : undefined,
        recurrenceIntervalDays: parsedRecurrence,
        dueDate: dueDate || undefined,
        completedAt: logNow ? now : task?.completedAt,
        completedByUserId: logNow ? currentUserId ?? undefined : task?.completedByUserId,
        responsibleUserId,
        createdByUserId: task?.createdByUserId ?? currentUserId ?? undefined,
        createdAt: task?.createdAt ?? now,
        updatedAt: now,
      });
    } catch {
      Alert.alert('לא הצלחנו לשמור', 'נסו שוב בעוד רגע.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.flexFull} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="סגירת טופס">
          <Pressable style={styles.formSheet} onPress={(e) => e.stopPropagation()}>
            <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
              <RtlText style={styles.title} accessibilityRole="header">{task ? 'עריכת רשומה' : 'רשומה חדשה'}</RtlText>

              <RtlText style={styles.label}>קטגוריה</RtlText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
                {CATEGORIES.map((c) => {
                  const selected = category === c;
                  return (
                    <Pressable
                      key={c}
                      onPress={() => setCategory(c)}
                      style={[styles.categoryChip, selected && styles.categoryChipActive]}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={CATEGORY_LABELS[c]}
                    >
                      <RtlText style={[styles.categoryChipText, selected && styles.categoryChipTextActive]}>{CATEGORY_LABELS[c]}</RtlText>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <RtlText style={styles.label}>שם</RtlText>
              <TextInput
                value={title}
                onChangeText={setTitle}
                style={styles.input}
                textAlign="right"
                placeholder="למשל: חיסון כלבת"
                placeholderTextColor={colors.textSecondary}
                accessibilityLabel="שם הרשומה"
              />

              {category === 'weight' ? (
                <>
                  <RtlText style={styles.label}>משקל (ק״ג)</RtlText>
                  <TextInput
                    value={weightKg}
                    onChangeText={setWeightKg}
                    style={styles.input}
                    textAlign="right"
                    keyboardType="decimal-pad"
                    accessibilityLabel="משקל בקילוגרם"
                  />
                </>
              ) : null}

              <RtlText style={styles.label}>תאריך יעד (ריק = רשומה שהושלמה כעת)</RtlText>
              <TextInput
                value={dueDate}
                onChangeText={setDueDate}
                style={styles.input}
                textAlign="right"
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textSecondary}
                accessibilityLabel="תאריך יעד"
              />

              <RtlText style={styles.label}>חוזר כל כמה ימים (ריק = חד-פעמי)</RtlText>
              <TextInput
                value={recurrenceDays}
                onChangeText={setRecurrenceDays}
                style={styles.input}
                textAlign="right"
                keyboardType="number-pad"
                placeholder="למשל: 30"
                placeholderTextColor={colors.textSecondary}
                accessibilityLabel="תדירות חזרה בימים"
              />

              <RtlText style={styles.label}>אחראי/ת (לא חובה)</RtlText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
                <Pressable
                  onPress={() => setResponsibleUserId(undefined)}
                  style={[styles.categoryChip, !responsibleUserId && styles.categoryChipActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: !responsibleUserId }}
                  accessibilityLabel="ללא אחראי/ת"
                >
                  <RtlText style={[styles.categoryChipText, !responsibleUserId && styles.categoryChipTextActive]}>ללא</RtlText>
                </Pressable>
                {users.filter((u) => !u.removedAt).map((u) => {
                  const selected = responsibleUserId === u.id;
                  return (
                    <Pressable
                      key={u.id}
                      onPress={() => setResponsibleUserId(u.id)}
                      style={[styles.categoryChip, selected && styles.categoryChipActive]}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={u.name}
                    >
                      <RtlText style={[styles.categoryChipText, selected && styles.categoryChipTextActive]}>{u.name}</RtlText>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <RtlText style={styles.label}>הערות</RtlText>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                style={[styles.input, styles.notesInput]}
                textAlign="right"
                multiline
                accessibilityLabel="הערות"
              />

              <Button label="שמירה" onPress={() => void handleSave()} loading={saving} style={styles.saveButton} />
              <Button label="ביטול" variant="secondary" onPress={onClose} style={styles.closeButton} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flexFull: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, padding: radii.xl, maxHeight: '85%' },
  formSheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, padding: radii.xl, maxHeight: '88%' },
  scroll: { flexGrow: 0, flexShrink: 1 },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.sm },
  sectionLabel: { ...typography.sectionTitle, fontSize: 15, color: colors.textPrimary, textAlign: 'right', marginTop: spacing.md, marginBottom: spacing.xs },
  emptyHint: { ...typography.meta, color: colors.textSecondary, textAlign: 'right' },
  row: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  rowBody: { flex: 1, gap: 2 },
  rowTitleLine: { flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.xs },
  rowTitle: { flexShrink: 1, ...typography.body, fontSize: 15, fontWeight: '700', color: colors.textPrimary, textAlign: 'right' },
  lifecycleBadge: { paddingVertical: 2, paddingHorizontal: spacing.xs, borderRadius: radii.round },
  lifecycleBadgeText: { fontSize: 11, fontWeight: '700' },
  rowMeta: { ...typography.meta, color: colors.textSecondary, textAlign: 'right' },
  completeButton: { paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radii.md, backgroundColor: colors.statusCurrentBg },
  completeButtonText: { ...typography.meta, color: colors.primaryDark, fontWeight: '700' },
  addButton: { marginTop: spacing.md },
  closeButton: { marginTop: spacing.sm },
  label: { fontSize: typography.meta.fontSize, fontWeight: '700', color: colors.textSecondary, marginTop: spacing.md, textAlign: 'right' },
  input: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md, padding: radii.md, fontSize: typography.body.fontSize, color: colors.textPrimary },
  notesInput: { minHeight: 72, textAlignVertical: 'top' },
  categoryRow: { flexDirection: 'row-reverse', gap: spacing.sm, paddingVertical: spacing.xs },
  categoryChip: { paddingVertical: radii.sm, paddingHorizontal: spacing.md, borderRadius: radii.round, backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: 'transparent' },
  categoryChipActive: { backgroundColor: colors.statusCurrentBg, borderColor: colors.primary },
  categoryChipText: { ...typography.meta, color: colors.textSecondary, fontWeight: '600' },
  categoryChipTextActive: { color: colors.primaryDark, fontWeight: '700' },
  saveButton: { marginTop: spacing.xl },
});
