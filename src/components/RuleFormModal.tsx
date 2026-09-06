import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { RtlText } from './RtlText';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import type { FamilyUser, ScheduleRule } from '../types';
import { colors } from '../theme/colors';
import { Avatar } from '../components/Avatar';
import { Button } from './Button';

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

function timeIsValid(t: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

// Round 6C-time: same local HH:mm <-> Date conversion already proven in
// RequestTimeChangeModal.tsx, copied (not imported/shared) per this round's
// explicit "no shared helper" scope rule.
/** "HH:mm" -> a Date on an arbitrary fixed day, for feeding the native picker. */
function timeStringToDate(t: string): Date {
  const [h, m] = timeIsValid(t) ? t.split(':').map(Number) : [12, 0];
  const d = new Date(2000, 0, 1, h, m, 0, 0);
  return d;
}

function dateToTimeString(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Add or edit one of the family's daily walk time slots: time, optional label, active days, and who rotates through it. */
export function RuleFormModal({ visible, editingRule, users, onSave, onClose }: RuleFormModalProps) {
  const [time, setTime] = useState('08:00');
  // Round 6C-time: same pickerOpen convention as RequestTimeChangeModal.tsx —
  // always open (inline spinner) on iOS, closed until the "שנה שעה" button is
  // tapped on Android.
  const [pickerOpen, setPickerOpen] = useState(Platform.OS === 'ios');
  const [label, setLabel] = useState('');
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [rotation, setRotation] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setTime(editingRule?.time ?? '08:00');
      setPickerOpen(Platform.OS === 'ios');
      setLabel(editingRule?.label ?? '');
      setDays(editingRule?.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6]);
      setRotation(editingRule?.rotationUserIds ?? []);
      setError(null);
    }
  }, [visible, editingRule]);

  // Round 6C-time: native picker selection can't produce an invalid value
  // (e.g. "25:99"), so this just converts and stores it — the existing
  // timeIsValid() gate in submit() below is left in place unchanged (no
  // unrelated validation refactor), it simply always passes now for time.
  // Android dismissal (event.type === 'dismissed') leaves `time` unchanged.
  const handleTimeChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setPickerOpen(false);
    if (event.type === 'dismissed') return;
    if (selected) setTime(dateToTimeString(selected));
  };

  const toggleDay = (d: number) => setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  const toggleRotationUser = (id: string) =>
    setRotation((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const usersById = Object.fromEntries(users.map((u) => [u.id, u]));

  const submit = () => {
    if (!timeIsValid(time)) return setError('שעה לא תקינה — פורמט HH:mm, למשל 08:00');
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
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <RtlText style={styles.title}>{editingRule ? 'עריכת שעת טיול' : 'הוספת שעת טיול'}</RtlText>

            <RtlText style={styles.label}>שעה</RtlText>
            <View style={styles.timeRow}>
              <RtlText style={styles.timeValue}>{time}</RtlText>
              {/* Round 6C-time: opens the native time picker on Android —
                  mirrors RequestTimeChangeModal.tsx's platform split. On iOS
                  the picker is always shown inline below. */}
              {Platform.OS === 'android' ? (
                <Button
                  label="שנה שעה"
                  variant="secondary"
                  onPress={() => setPickerOpen(true)}
                  style={styles.timeButton}
                />
              ) : null}
            </View>

            {pickerOpen ? (
              <DateTimePicker
                value={timeStringToDate(time)}
                mode="time"
                is24Hour
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={handleTimeChange}
              />
            ) : null}

            <RtlText style={styles.label}>שם (אופציונלי)</RtlText>
            <TextInput value={label} onChangeText={setLabel} placeholder="למשל: טיול בוקר" style={styles.input} textAlign="right" />

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
                {rotation.map((id) => usersById[id]?.name).join(' → ')}
                {rotation.length > 1 ? ` → ${usersById[rotation[0]]?.name} ...` : ''}
              </RtlText>
            ) : null}

            {error ? <RtlText style={styles.error}>{error}</RtlText> : null}

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
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '90%' },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  label: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginTop: 14, marginBottom: 8, textAlign: 'right' },
  input: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 14,
    padding: 14,
    fontSize: 16,
    color: colors.textPrimary,
  },
  timeRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  timeValue: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 14,
    padding: 14,
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  timeButton: { flex: 1.25 },
  dayRow: { flexDirection: 'row', gap: 6 },
  dayChip: { flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.surfaceMuted, alignItems: 'center' },
  dayChipActive: { backgroundColor: colors.primary },
  dayChipText: { fontWeight: '700', color: colors.textSecondary },
  dayChipTextActive: { color: colors.textInverse },
  rotationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  rotationChip: { alignItems: 'center', minWidth: 64 },
  rotationName: { fontSize: 12, color: colors.textPrimary, marginTop: 4 },
  rotationBadge: {
    position: 'absolute',
    top: -4,
    end: -4,
    backgroundColor: colors.primary,
    color: colors.textInverse,
    fontSize: 11,
    fontWeight: '800',
    width: 18,
    height: 18,
    borderRadius: 9,
    textAlign: 'center',
    lineHeight: 18,
    overflow: 'hidden',
  },
  rotationPreview: { fontSize: 13, color: colors.primaryDark, fontWeight: '600', marginTop: 8, textAlign: 'right' },
  error: { fontSize: 13, color: colors.statusOverdue, fontWeight: '600', marginTop: 10, textAlign: 'right' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  flex: { flex: 1 },
});
