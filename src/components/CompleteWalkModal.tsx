import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { RtlText } from './RtlText';
import type { FamilyUser } from '../types';
import { colors } from '../theme/colors';
import { Avatar } from './Avatar';
import { Button } from './Button';

interface CompleteWalkModalProps {
  visible: boolean;
  dogName: string;
  scheduledTime?: string;
  users: FamilyUser[];
  defaultUserId: string;
  onConfirm: (result: { completedByUserId: string; hadPee: boolean; hadPoop: boolean; note: string }) => void;
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

  useEffect(() => {
    if (visible) {
      setPerformedBy(defaultUserId);
      setHadPee(false);
      setHadPoop(false);
      setNote('');
    }
  }, [visible, defaultUserId]);

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
              <RtlText style={styles.title}>סימון הטיול של {dogName} כבוצע</RtlText>
            {scheduledTime ? <RtlText style={styles.subtitle}>מתוכנן לשעה {scheduledTime}</RtlText> : null}

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
            />

            <View style={styles.actions}>
              <Button
                label="בוצע ✓"
                onPress={() => onConfirm({ completedByUserId: performedBy, hadPee, hadPoop, note: note.trim() })}
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
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '88%' },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  subtitle: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginTop: 4, marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginTop: 16, marginBottom: 8, textAlign: 'right' },
  userRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  userChip: { alignItems: 'center', minWidth: 68, gap: 4, opacity: 0.55 },
  userChipActive: { opacity: 1 },
  userChipName: { fontSize: 12, color: colors.textPrimary, fontWeight: '600' },
  toggleRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  toggle: {
    flex: 1,
    minHeight: 72,
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
  toggleEmoji: { fontSize: 28 },
  toggleLabel: { fontSize: 14, fontWeight: '700', color: colors.textSecondary },
  toggleLabelActive: { color: colors.textPrimary },
  noteInput: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 14,
    padding: 14,
    fontSize: 15,
    color: colors.textPrimary,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row', gap: 12, marginTop: 22 },
  flex: { flex: 1 },
});
