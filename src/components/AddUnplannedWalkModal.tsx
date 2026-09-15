import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { RtlText } from './RtlText';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import type { FamilyUser, Walk } from '../types';
import { colors } from '../theme/colors';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { toDateOnly } from '../logic/rotation';

export interface UnplannedWalkResult {
  performedByUserId: string;
  date: string;
  time: string;
  hadPee: boolean;
  hadPoop: boolean;
  note: string;
  durationMinutes?: number;
}

interface AddUnplannedWalkModalProps {
  visible: boolean;
  dogName: string;
  users: FamilyUser[];
  defaultUserId: string;
  /**
   * Whether the picker is shown at all. A regular Member logging a
   * spontaneous walk is automatically attributed to themselves — no picker,
   * no way to select someone else. Only Admin may correct/backfill history
   * by choosing a different active family member. Defaults to true so
   * existing (admin) call sites keep working unchanged.
   */
  canChooseUser?: boolean;
  /**
   * Section 2: when set, this modal opens in EDIT mode for an existing
   * unplanned walk instead of the default "log a new one" mode — same
   * form, prefilled, title/button text swapped, plus a delete option with
   * its own confirmation. Editing always saves back to the SAME record
   * (scheduleStore.editUnplannedWalk), never creates a duplicate.
   */
  editingWalk?: Walk | null;
  onDelete?: (walkId: string) => void;
  onConfirm: (result: UnplannedWalkResult) => void;
  onClose: () => void;
}

function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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

/**
 * "הוסף טיול שבוצע" — logs a spontaneous walk that already happened, with no
 * prior plan. Defaults to now/today so the common case is a couple of taps.
 * Never touches the rotation or future schedule.
 */
export function AddUnplannedWalkModal({
  visible,
  dogName,
  users,
  defaultUserId,
  canChooseUser = true,
  editingWalk = null,
  onDelete,
  onConfirm,
  onClose,
}: AddUnplannedWalkModalProps) {
  const isEditing = !!editingWalk;
  const [performedBy, setPerformedBy] = useState(defaultUserId);
  const [date, setDate] = useState(toDateOnly(new Date()));
  const [time, setTime] = useState(nowTime());
  // Round 6C-time: same pickerOpen convention as RequestTimeChangeModal.tsx —
  // always open (inline spinner) on iOS, closed until the "שנה שעה" button is
  // tapped on Android. The date field below is completely unaffected.
  const [pickerOpen, setPickerOpen] = useState(Platform.OS === 'ios');
  const [hadPee, setHadPee] = useState(false);
  const [hadPoop, setHadPoop] = useState(false);
  const [note, setNote] = useState('');
  const [duration, setDuration] = useState('');

  useEffect(() => {
    if (visible) {
      if (editingWalk) {
        setPerformedBy(editingWalk.responsibleUserId);
        setDate(editingWalk.date);
        setTime(editingWalk.scheduledTime);
        setHadPee(!!editingWalk.hadPee);
        setHadPoop(!!editingWalk.hadPoop);
        setNote(editingWalk.note ?? '');
        setDuration(editingWalk.durationMinutes ? String(editingWalk.durationMinutes) : '');
      } else {
        setPerformedBy(defaultUserId);
        setDate(toDateOnly(new Date()));
        setTime(nowTime());
        setHadPee(false);
        setHadPoop(false);
        setNote('');
        setDuration('');
      }
      setPickerOpen(Platform.OS === 'ios');
    }
  }, [visible, defaultUserId, editingWalk]);

  const valid = timeIsValid(time) && /^\d{4}-\d{2}-\d{2}$/.test(date);

  // Round 6C-time: native picker selection can't produce an invalid value,
  // so this just converts and stores it — the existing timeIsValid() gate
  // above (feeding `valid`) is left in place unchanged. Android dismissal
  // (event.type === 'dismissed') leaves `time` unchanged.
  const handleTimeChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setPickerOpen(false);
    if (event.type === 'dismissed') return;
    if (selected) setTime(dateToTimeString(selected));
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
          accessibilityLabel={isEditing ? `סגירת עריכת טיול ספונטני של ${dogName}` : `סגירת הוספת טיול ספונטני של ${dogName}`}
        >
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <RtlText style={styles.title}>
                {isEditing ? `עריכת טיול ספונטני של ${dogName}` : `הוספת טיול ספונטני של ${dogName}`}
              </RtlText>
            <RtlText style={styles.subtitle}>לטיול שכבר קרה, בלי לשנות את הסבב</RtlText>

            <RtlText style={styles.label}>מי טייל?</RtlText>
            {canChooseUser ? (
              <View style={styles.userRow}>
                {users.map((u) => (
                  <Pressable
                    key={u.id}
                    onPress={() => setPerformedBy(u.id)}
                    style={[styles.userChip, performedBy === u.id && styles.userChipActive]}
                  >
                    <Avatar emoji={u.avatar} color={u.color} photoUrl={u.photoUrl} size={40} />
                    <RtlText style={styles.userChipName} numberOfLines={1}>
                      {u.name}
                    </RtlText>
                  </Pressable>
                ))}
              </View>
            ) : (
              // A regular Member cannot log a spontaneous walk as anyone
              // but themselves — no picker, just a non-interactive
              // confirmation of who this will be attributed to.
              <View style={styles.selfRow}>
                {(() => {
                  const self = users.find((u) => u.id === defaultUserId);
                  return (
                    <>
                      <Avatar emoji={self?.avatar ?? '🙂'} color={self?.color ?? colors.primary} photoUrl={self?.photoUrl} size={40} />
                      <RtlText style={styles.selfRowName}>{self?.name ?? 'אתה'}</RtlText>
                    </>
                  );
                })()}
              </View>
            )}

            <View style={styles.row}>
              <View style={styles.flex}>
                <RtlText style={styles.label}>תאריך</RtlText>
                <TextInput value={date} onChangeText={setDate} style={styles.input} placeholder="YYYY-MM-DD" textAlign="center" />
              </View>
              <View style={styles.flex}>
                <RtlText style={styles.label}>שעה</RtlText>
                <RtlText style={[styles.input, styles.timeDisplay]}>{time}</RtlText>
              </View>
            </View>

            {/* Round 6C-time: date field above is unchanged (still a plain
                TextInput). Time is now picked via the native time picker —
                the trigger button opens it on Android; on iOS the picker is
                always shown inline below, mirroring
                RequestTimeChangeModal.tsx's platform split. */}
            {Platform.OS === 'android' ? (
              <Button
                label={`שנה שעה (${time})`}
                variant="secondary"
                onPress={() => setPickerOpen(true)}
                style={styles.timeButton}
              />
            ) : null}

            {pickerOpen ? (
              <DateTimePicker
                value={timeStringToDate(time)}
                mode="time"
                is24Hour
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={handleTimeChange}
              />
            ) : null}

            <View style={styles.toggleRow}>
              <Pressable
                onPress={() => setHadPee((v) => !v)}
                style={[styles.toggle, hadPee && styles.toggleActivePee]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: hadPee }}
                accessibilityLabel="סימון פיפי בטיול"
              >
                <RtlText style={styles.toggleEmoji}>💧</RtlText>
              </Pressable>
              <Pressable
                onPress={() => setHadPoop((v) => !v)}
                style={[styles.toggle, hadPoop && styles.toggleActivePoop]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: hadPoop }}
                accessibilityLabel="סימון קקי בטיול"
              >
                <RtlText style={styles.toggleEmoji}>💩</RtlText>
              </Pressable>
            </View>

            <RtlText style={styles.label}>משך (דקות, אופציונלי)</RtlText>
            <TextInput
              value={duration}
              onChangeText={setDuration}
              keyboardType="number-pad"
              placeholder="20"
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
              textAlign="center"
            />

            <RtlText style={styles.label}>הערה (אופציונלי)</RtlText>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="למשל: טיול קצר לפני השינה"
              placeholderTextColor={colors.textSecondary}
              style={styles.noteInput}
              multiline
              textAlign="right"
            />

            <View style={styles.actions}>
              <Button
                label={isEditing ? 'שמור שינויים' : 'שמור טיול'}
                disabled={!valid}
                onPress={() =>
                  onConfirm({
                    performedByUserId: performedBy,
                    date,
                    time,
                    hadPee,
                    hadPoop,
                    note: note.trim(),
                    durationMinutes: duration ? Number(duration) : undefined,
                  })
                }
                style={styles.flex}
              />
              <Button label="ביטול" onPress={onClose} variant="secondary" style={styles.flex} />
            </View>

            {isEditing && onDelete && editingWalk ? (
              <Button
                label="מחק טיול זה"
                variant="danger"
                style={styles.deleteButton}
                onPress={() => {
                  Alert.alert(
                    'למחוק את הטיול הזה?',
                    'הפעולה תמחק לצמיתות את הטיול הספונטני הזה ואת כל הפרטים שלו.',
                    [
                      { text: 'חזרה', style: 'cancel' },
                      { text: 'מחק', style: 'destructive', onPress: () => onDelete(editingWalk.id) },
                    ]
                  );
                }}
              />
            ) : null}
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
  subtitle: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginTop: 4, marginBottom: 8 },
  label: { width: '100%', fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginTop: 14, marginBottom: 8, textAlign: 'right', writingDirection: 'rtl' },
  row: { flexDirection: 'row', gap: 12 },
  flex: { flex: 1 },
  input: { backgroundColor: colors.surfaceMuted, borderRadius: 14, padding: 14, fontSize: 16, color: colors.textPrimary },
  timeDisplay: { textAlign: 'center', fontWeight: '700' },
  timeButton: { marginTop: 12 },
  userRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  userChip: { alignItems: 'center', minWidth: 68, gap: 4, opacity: 0.55 },
  userChipActive: { opacity: 1 },
  userChipName: { fontSize: 12, color: colors.textPrimary, fontWeight: '600' },
  selfRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  selfRowName: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  toggleRow: { width: '100%', flexDirection: 'row', gap: 12, marginTop: 4 },
  toggle: {
    flex: 1,
    minHeight: 64,
    borderRadius: 18,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  toggleActivePee: { backgroundColor: colors.statusCurrentBg, borderColor: colors.primary },
  toggleActivePoop: { backgroundColor: colors.statusSkippedBg, borderColor: colors.statusSkipped },
  toggleEmoji: { fontSize: 24 },
  toggleLabel: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  toggleLabelActive: { color: colors.textPrimary },
  noteInput: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 14,
    padding: 14,
    fontSize: 15,
    color: colors.textPrimary,
    minHeight: 56,
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  deleteButton: { marginTop: 12 },
});
