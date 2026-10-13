import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { RtlText } from './RtlText';
import type { FamilyUser } from '../types';
import { colors } from '../theme/colors';
import { radii, spacing } from '../theme/tokens';
import { Avatar } from './Avatar';
import { Button } from './Button';

interface CompleteWalkModalProps {
  visible: boolean;
  dogName: string;
  scheduledTime?: string;
  users: FamilyUser[];
  defaultUserId: string;
  onConfirm: (result: { completedByUserId: string; hadPee: boolean; hadPoop: boolean; note: string; completedAt?: string }) => void;
  onCancel: () => void;
}

/**
 * One-handed "mark done" sheet: big pee/poop toggles (no typing required),
 * an optional free-text note, and a "who actually walked" picker — since the
 * person who did it isn't always who was scheduled.
 */
export function CompleteWalkModal({
  visible,
  dogName,
  scheduledTime,
  users,
  defaultUserId,
  onConfirm,
  onCancel,
}: CompleteWalkModalProps) {
  const [performedBy, setPerformedBy] = useState(defaultUserId);
  const [hadPee, setHadPee] = useState(false);
  const [hadPoop, setHadPoop] = useState(false);
  const [note, setNote] = useState('');
  const [useCustomTime, setUseCustomTime] = useState(false);
  const [actualTime, setActualTime] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (visible) {
      setPerformedBy(defaultUserId);
      setHadPee(false);
      setHadPoop(false);
      setNote('');
      setUseCustomTime(false);
      setActualTime(new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false }));
      setPickerOpen(false);
    }
  }, [visible, defaultUserId]);

  const timeToDate = (value: string) => {
    const [hours, minutes] = /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value.split(':').map(Number) : [new Date().getHours(), new Date().getMinutes()];
    return new Date(2000, 0, 1, hours, minutes, 0, 0);
  };
  const handleTimeChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setPickerOpen(false);
    if (event.type !== 'dismissed' && selected) {
      setActualTime(`${String(selected.getHours()).padStart(2, '0')}:${String(selected.getMinutes()).padStart(2, '0')}`);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      {/* Round 6C1: same KeyboardAvoidingView pattern already proven in
          RequestTimeChangeModal.tsx — wraps the existing backdrop/sheet/
          ScrollView structure unchanged. */}
      <KeyboardAvoidingView style={styles.flexFull} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable
          style={styles.backdrop}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel={`סגירת סימון הטיול של ${dogName} כבוצע`}
        >
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <RtlText style={styles.title} accessibilityRole="header">סימון הטיול של {dogName} כבוצע</RtlText>
            {scheduledTime ? <RtlText style={styles.subtitle}>מתוכנן לשעה {scheduledTime}</RtlText> : null}


            <RtlText style={styles.label}>מתי הטיול בוצע?</RtlText>
            <View style={styles.timeChoiceRow}>
              <Pressable onPress={() => setUseCustomTime(false)} style={[styles.timeChoice, !useCustomTime && styles.timeChoiceActive]}>
                <RtlText style={styles.timeChoiceText}>עכשיו</RtlText>
              </Pressable>
              <Pressable onPress={() => setUseCustomTime(true)} style={[styles.timeChoice, useCustomTime && styles.timeChoiceActive]}>
                <RtlText style={styles.timeChoiceText}>שעה אחרת</RtlText>
              </Pressable>
            </View>
            {useCustomTime ? (
              Platform.OS === 'web' ? React.createElement('input', {
                type: 'time', value: actualTime, step: 60,
                'aria-label': 'שעת ביצוע הטיול בפועל',
                onChange: (event: { target: { value: string } }) => setActualTime(event.target.value),
                style: webTimeInputStyle,
              }) : (
                <>
                  <Pressable onPress={() => setPickerOpen(true)} style={styles.timePickerTrigger} accessibilityRole="button" accessibilityLabel="בחירת שעת ביצוע הטיול">
                    <RtlText style={styles.timePickerValue}>{actualTime}</RtlText>
                    <RtlText style={styles.timePickerHint}>בחירת שעה</RtlText>
                  </Pressable>
                  {pickerOpen ? <DateTimePicker value={timeToDate(actualTime)} mode="time" is24Hour display={Platform.OS === 'ios' ? 'spinner' : 'default'} onChange={handleTimeChange} /> : null}
                </>
              )
            ) : null}

            <RtlText style={styles.label}>מי טייל בפועל?</RtlText>
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

            {/*
              BATCH 4 (item F — Complete Walk UI): emoji-only, no visible
              "פיפי"/"קקי" words — the Master Specification's explicit
              requirement — while keeping a proper accessibilityLabel for
              screen readers, mirroring WalkRow.tsx's own already-correct
              quick-toggle pattern (accessibilityRole="checkbox" +
              accessibilityState + a real Hebrew label) exactly, rather than
              inventing a new convention.
            */}
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

            <RtlText style={styles.label}>הערה (אופציונלי)</RtlText>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="למשל: פגשנו כלב חדש בפארק"
              placeholderTextColor={colors.textSecondary}
              style={styles.noteInput}
              multiline
              textAlign="right"
              accessibilityLabel="הערה (אופציונלי)"
            />

            <View style={styles.actions}>
              <Button
                label="בוצע ✓"
                onPress={() => {
                  let completedAt: string | undefined;
                  if (useCustomTime && /^([01]\\d|2[0-3]):[0-5]\\d$/.test(actualTime)) {
                    const [hours, minutes] = actualTime.split(':').map(Number);
                    const actual = new Date();
                    actual.setHours(hours, minutes, 0, 0);
                    if (actual.getTime() > Date.now()) actual.setDate(actual.getDate() - 1);
                    completedAt = actual.toISOString();
                  }
                  onConfirm({ completedByUserId: performedBy, hadPee, hadPoop, note: note.trim(), completedAt });
                }}
                style={styles.flex}
              />
              <Button label="ביטול" onPress={onCancel} variant="secondary" style={styles.flex} />
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
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, padding: 24, maxHeight: '88%' },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  subtitle: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs, marginBottom: spacing.md },
  label: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginTop: spacing.lg, marginBottom: spacing.sm, textAlign: 'right' },
  timeChoiceRow: { flexDirection: 'row', gap: spacing.sm },
  timeChoice: { flex: 1, paddingVertical: 10, borderRadius: radii.md, backgroundColor: colors.surfaceMuted, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  timeChoiceActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  timeChoiceText: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  timeInput: { marginTop: spacing.sm, backgroundColor: colors.surfaceMuted, borderRadius: radii.md, padding: 12, fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  timePickerTrigger: { marginTop: spacing.sm, backgroundColor: colors.surfaceMuted, borderRadius: radii.md, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  timePickerValue: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  timePickerHint: { marginTop: 2, fontSize: 12, color: colors.textSecondary },
  userRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  userChip: { alignItems: 'center', minWidth: 68, gap: spacing.xs, opacity: 0.55 },
  userChipActive: { opacity: 1 },
  userChipName: { fontSize: 12, color: colors.textPrimary, fontWeight: '600' },
  toggleRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
  toggle: {
    flex: 1,
    minHeight: 72,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  toggleActivePee: { backgroundColor: colors.statusCurrentBg, borderColor: colors.primary },
  toggleActivePoop: { backgroundColor: colors.statusSkippedBg, borderColor: colors.statusSkipped },
  toggleEmoji: { fontSize: 28 },
  toggleLabel: { fontSize: 14, fontWeight: '700', color: colors.textSecondary },
  toggleLabelActive: { color: colors.textPrimary },
  noteInput: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    padding: 14,
    fontSize: 15,
    color: colors.textPrimary,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: 22 },
  flex: { flex: 1 },
});

const webTimeInputStyle = {
  display: 'block', width: '100%', minHeight: 52, boxSizing: 'border-box', padding: 12,
  fontSize: 18, fontWeight: '700', borderRadius: radii.md, border: `1px solid ${colors.border}`,
  backgroundColor: colors.surfaceMuted, color: colors.textPrimary, textAlign: 'center', direction: 'ltr', cursor: 'pointer',
};
