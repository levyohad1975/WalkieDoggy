import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { RtlText } from './RtlText';
import type { FamilyUser, ScheduleRule } from '../types';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import { Avatar } from '../components/Avatar';
import { Button } from './Button';
import { TimePickerField } from './TimePickerField';
import { is24HourTime } from '../logic/timeInput';
import { previewRotation } from '../logic/rotation';

const DAY_LABELS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
// Round 6F: full spoken day names for the day chips' accessibilityLabel —
// the visible DAY_LABELS above (single-letter initials) stay unchanged;
// this is additive, assistive-tech-only information, same index order.
const DAY_ACCESSIBILITY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export interface RuleFormResult {
  time: string;
  label: string;
  daysOfWeek: number[];
  rotationUserIds: string[];
}

interface RuleFormModalProps {
  visible: boolean;
  editingRule: ScheduleRule | null;
  users: FamilyUser[];
  onSave: (result: RuleFormResult) => void;
  onClose: () => void;
}

/** Add or edit one of the family's daily walk time slots: time, optional label, active days, and who rotates through it. */
export function RuleFormModal({ visible, editingRule, users, onSave, onClose }: RuleFormModalProps) {
  const [time, setTime] = useState('08:00');
  const [label, setLabel] = useState('');
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [rotation, setRotation] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setTime(editingRule?.time ?? '08:00');
      setLabel(editingRule?.label ?? '');
      setDays(editingRule?.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6]);
      setRotation(editingRule?.rotationUserIds ?? []);
      setError(null);
    }
  }, [visible, editingRule]);

  const toggleDay = (d: number) => setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  const toggleRotationUser = (id: string) =>
    setRotation((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const usersById = Object.fromEntries(users.map((u) => [u.id, u]));

  const submit = () => {
    if (!is24HourTime(time)) return setError('שעה לא תקינה — פורמט HH:mm, למשל 08:00');
    if (days.length === 0) return setError('יש לבחור לפחות יום אחד');
    if (rotation.length === 0) return setError('יש לבחור לפחות בן משפחה אחד לתורנות');
    onSave({ time, label: label.trim(), daysOfWeek: days, rotationUserIds: rotation });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Round 6C1: same KeyboardAvoidingView pattern already proven in
          RequestTimeChangeModal.tsx — wraps the existing backdrop/sheet/
          ScrollView structure unchanged. */}
      <KeyboardAvoidingView style={styles.flexFull} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={editingRule ? 'סגירת עריכת שעת טיול' : 'סגירת הוספת שעת טיול'}
        >
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <RtlText style={styles.title} accessibilityRole="header">{editingRule ? 'עריכת שעת טיול' : 'הוספת שעת טיול'}</RtlText>

            <RtlText style={styles.label}>שעה</RtlText>
            <TimePickerField value={time} onChange={setTime} webLabel="בחירת שעת טיול" />

            <RtlText style={styles.label}>שם (אופציונלי)</RtlText>
            <TextInput
              value={label}
              onChangeText={setLabel}
              placeholder="למשל: טיול בוקר"
              style={styles.input}
              textAlign="right"
              accessibilityLabel="שם (אופציונלי)"
            />

            <RtlText style={styles.label}>ימים</RtlText>
            <View style={styles.dayRow}>
              {DAY_LABELS.map((l, idx) => (
                <Pressable
                  key={idx}
                  onPress={() => toggleDay(idx)}
                  style={[styles.dayChip, days.includes(idx) && styles.dayChipActive]}
                  // Round 6F: selection here is currently conveyed only via
                  // background color (dayChipActive) — accessibilityState
                  // exposes that same selected/unselected state to assistive
                  // tech, and the full day name replaces the ambiguous
                  // single-letter visible label for the accessible name only
                  // (the visible letter itself is unchanged).
                  accessibilityRole="button"
                  accessibilityState={{ selected: days.includes(idx) }}
                  accessibilityLabel={DAY_ACCESSIBILITY_NAMES[idx]}
                >
                  <RtlText style={[styles.dayChipText, days.includes(idx) && styles.dayChipTextActive]}>{l}</RtlText>
                </Pressable>
              ))}
            </View>

            <RtlText style={styles.label}>סבב משפחתי (לחיצה לפי סדר)</RtlText>
            <View style={styles.rotationRow}>
              {users.map((u) => {
                const idx = rotation.indexOf(u.id);
                return (
                  <Pressable
                    key={u.id}
                    onPress={() => toggleRotationUser(u.id)}
                    style={styles.rotationChip}
                    // Round 6F: the order-number badge below is otherwise the
                    // ONLY thing conveying "in rotation, and at what
                    // position" — a small floating number a screen reader
                    // can't meaningfully interpret on its own.
                    // accessibilityState.selected exposes membership in the
                    // rotation, and the label spells out the position in
                    // words using the same idx already computed above (no
                    // rotation-logic change).
                    accessibilityRole="button"
                    accessibilityState={{ selected: idx >= 0 }}
                    accessibilityLabel={idx >= 0 ? `${u.name}, מספר ${idx + 1} בסבב` : u.name}
                  >
                    <Avatar emoji={u.avatar} color={u.color} photoUrl={u.photoUrl} size={40} />
                    <RtlText style={styles.rotationName} numberOfLines={1}>
                      {u.name}
                    </RtlText>
                    {idx >= 0 ? <RtlText style={styles.rotationBadge}>{idx + 1}</RtlText> : null}
                  </Pressable>
                );
              })}
            </View>
            {rotation.length > 0 ? (
              <RtlText style={styles.rotationPreview}>
                {previewRotation(
                  rotation.map((id) => usersById[id]?.name ?? '?'),
                  rotation.length > 1 ? rotation.length + 1 : rotation.length
                )}
              </RtlText>
            ) : null}

            {error ? (
              <RtlText style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
                {error}
              </RtlText>
            ) : null}

            <View style={styles.actions}>
              <Button label="שמירה" onPress={submit} style={styles.flex} />
              <Button label="ביטול" onPress={onClose} variant="secondary" style={styles.flex} />
            </View>
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
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, padding: 24, maxHeight: '90%' },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  label: { fontSize: typography.meta.fontSize, fontWeight: '700', color: colors.textSecondary, marginTop: 14, marginBottom: spacing.sm, textAlign: 'right' },
  input: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    padding: 14,
    fontSize: typography.body.fontSize,
    color: colors.textPrimary,
  },
  dayRow: { flexDirection: 'row', gap: 6 },
  dayChip: { flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.surfaceMuted, alignItems: 'center' },
  dayChipActive: { backgroundColor: colors.primary },
  dayChipText: { fontWeight: '700', color: colors.textSecondary },
  dayChipTextActive: { color: colors.textInverse },
  rotationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  rotationChip: { alignItems: 'center', minWidth: 64 },
  rotationName: { fontSize: 12, color: colors.textPrimary, marginTop: spacing.xs },
  rotationBadge: {
    position: 'absolute',
    top: -4,
    end: -4,
    backgroundColor: colors.primary,
    color: colors.textInverse,
    fontSize: typography.caption.fontSize,
    fontWeight: '800',
    width: 18,
    height: 18,
    borderRadius: 9,
    textAlign: 'center',
    lineHeight: 18,
    overflow: 'hidden',
  },
  rotationPreview: { fontSize: typography.meta.fontSize, color: colors.primaryDark, fontWeight: '600', marginTop: spacing.sm, textAlign: 'right' },
  error: { fontSize: typography.meta.fontSize, color: colors.statusOverdue, fontWeight: '600', marginTop: 10, textAlign: 'right' },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  flex: { flex: 1 },
});
