import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import { Button } from './Button';

interface RequestTimeChangeModalProps {
  visible: boolean;
  currentTime: string;
  onSubmit: (proposedTime: string) => void;
  onClose: () => void;
}

function timeIsValid(t: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

/** "HH:mm" -> a Date on an arbitrary fixed day, for feeding the native picker. */
function timeStringToDate(t: string): Date {
  const [h, m] = timeIsValid(t) ? t.split(':').map(Number) : [12, 0];
  const d = new Date(2000, 0, 1, h, m, 0, 0);
  return d;
}

function dateToTimeString(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function suggestedTimeFrom(currentTime: string): string {
  const d = timeStringToDate(currentTime);
  d.setMinutes(d.getMinutes() + 30);
  return dateToTimeString(d);
}

/**
 * "בקש שינוי שעה" — a Member proposes a new time for a walk they're
 * responsible for; the change only takes effect once an Admin approves it
 * (see requestsStore.createTimeChange / migration 0005's
 * create_time_change_request). This never edits the schedule directly.
 *
 * A5 (round 6): replaced the old manual "HH:MM" free-text entry (users could
 * type invalid values like "25:99" past the regex until submit, and typing
 * on a numeric keyboard for a time is generally worse UX than a native
 * picker) with @react-native-community/datetimepicker's real time-picker UI,
 * and added an explicit "07:00 → 08:30" before/after preview once a new time
 * is picked. The KeyboardAvoidingView wrapper is kept (no text field remains
 * in THIS modal today, but this sheet-style keyboard-avoidance pattern is
 * shared by other request modals in this codebase with a notes/reason field,
 * so removing it here would be an inconsistent regression if a note field is
 * added to this modal later).
 */
export function RequestTimeChangeModal({ visible, currentTime, onSubmit, onClose }: RequestTimeChangeModalProps) {
  const [time, setTime] = useState(() => suggestedTimeFrom(currentTime));
  const [pickerOpen, setPickerOpen] = useState(Platform.OS === 'ios');

  useEffect(() => {
    if (visible) {
      setTime(suggestedTimeFrom(currentTime));
      setPickerOpen(Platform.OS === 'ios');
    }
  }, [visible, currentTime]);

  const valid = timeIsValid(time) && time !== currentTime;

  const handleChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setPickerOpen(false);
    if (event.type === 'dismissed') return;
    if (selected) setTime(dateToTimeString(selected));
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.flexFull}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="סגירת בקשת שינוי שעה"
        >
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.sheetContent}
              showsVerticalScrollIndicator={false}
            >
              <RtlText style={styles.title} accessibilityRole="header">בקשת שינוי שעה</RtlText>
              <RtlText style={styles.subtitle}>הבקשה תישלח למנהל/ת המשפחה לאישור — השעה לא תשתנה מיד</RtlText>

              {/* "07:00 → 08:30" before/after preview */}
              <View style={styles.previewRow}>
                <RtlText style={styles.previewTime}>{timeIsValid(time) ? time : '--:--'}</RtlText>
                <RtlText style={styles.previewArrow}>←</RtlText>
                <RtlText style={styles.previewCurrent}>{currentTime}</RtlText>
              </View>

              {Platform.OS === 'web' ? React.createElement('input', {
                type: 'time',
                value: time,
                onChange: (event: any) => setTime(event.target.value),
                'aria-label': 'בחר שעה חדשה',
                style: {
                  width: '100%',
                  boxSizing: 'border-box',
                  marginTop: 12,
                  padding: 12,
                  fontSize: 20,
                  borderRadius: 12,
                  border: '1px solid #d0d0d0',
                  backgroundColor: '#ffffff',
                  textAlign: 'center',
                },
              }) : null}

              {Platform.OS === 'android' ? (
                <Button
                  label={`שנה שעה (${timeIsValid(time) ? time : currentTime})`}
                  variant="secondary"
                  onPress={() => setPickerOpen(true)}
                  style={styles.pickerButton}
                />
              ) : null}

              {pickerOpen ? (
                <DateTimePicker
                  value={timeStringToDate(time)}
                  mode="time"
                  is24Hour
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={handleChange}
                />
              ) : null}

              <View style={styles.actions}>
                <Button label="שלח בקשה" disabled={!valid} onPress={() => onSubmit(time)} style={styles.flex} />
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
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, maxHeight: '90%' },
  sheetContent: { padding: 24, gap: spacing.xs },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  subtitle: { fontSize: typography.meta.fontSize, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs, marginBottom: spacing.sm },
  previewRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 10, marginBottom: spacing.xs },
  previewCurrent: { fontSize: 20, fontWeight: '600', color: colors.textSecondary },
  previewArrow: { fontSize: 18, color: colors.textSecondary },
  previewTime: { fontSize: typography.statValue.fontSize, fontWeight: typography.statValue.fontWeight, color: colors.primary },
  pickerButton: { marginTop: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  flex: { flex: 1 },
});
