import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { RtlText } from './RtlText';
import type { FamilyUser, Walk } from '../types';
import { colors } from '../theme/colors';
import { Button } from './Button';
import { Avatar } from './Avatar';

interface EditDoneDetailsModalProps {
  visible: boolean;
  walk: Walk | null;
  onSave: (details: { hadPee: boolean; hadPoop: boolean; note: string; completedByUserId?: string }) => void;
  onClose: () => void;
  /**
   * Final QA round v2 (item D completion): both new, OPT-IN, and
   * backward-compatible — HistoryScreen.tsx's existing usage passes
   * neither, so its behavior (pee/poop/note only, no delete, no
   * completedByUserId in the onSave payload at all) is completely
   * unchanged. Only a caller that passes `users` AND
   * `canReassignCompletedBy` gets the "who actually walked the dog"
   * picker; only a caller that passes `onDelete` gets the delete button.
   */
  users?: FamilyUser[];
  canReassignCompletedBy?: boolean;
  onDelete?: (walkId: string) => void;
}

/** Lets you fix up the pee/poop/note (and, for an opted-in caller, who-actually-walked-the-dog / delete) details of a walk after it's already been resolved. */
export function EditDoneDetailsModal({
  visible,
  walk,
  onSave,
  onClose,
  users,
  canReassignCompletedBy,
  onDelete,
}: EditDoneDetailsModalProps) {
  const [hadPee, setHadPee] = useState(false);
  const [hadPoop, setHadPoop] = useState(false);
  const [note, setNote] = useState('');
  const [completedByUserId, setCompletedByUserId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (visible && walk) {
      setHadPee(Boolean(walk.hadPee));
      setHadPoop(Boolean(walk.hadPoop));
      setNote(walk.note ?? '');
      setCompletedByUserId(walk.completedByUserId ?? walk.responsibleUserId);
    }
  }, [visible, walk]);

  if (!walk) return null;

  const showCompletedByPicker = canReassignCompletedBy && users && users.length > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Round 6C1: same KeyboardAvoidingView pattern already proven in
          RequestTimeChangeModal.tsx — wraps the existing backdrop/sheet/
          ScrollView structure unchanged. */}
      <KeyboardAvoidingView style={styles.flexFull} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <RtlText style={styles.title}>עריכת פרטי הטיול</RtlText>
            <RtlText style={styles.subtitle}>
              {walk.date} · {walk.scheduledTime}
            </RtlText>

            <View style={styles.toggleRow}>
              <Pressable onPress={() => setHadPee((v) => !v)} style={[styles.toggle, hadPee && styles.toggleActivePee]}>
                <RtlText style={styles.toggleEmoji}>💧</RtlText>
                <RtlText style={[styles.toggleLabel, hadPee && styles.toggleLabelActive]}>פיפי</RtlText>
              </Pressable>
              <Pressable onPress={() => setHadPoop((v) => !v)} style={[styles.toggle, hadPoop && styles.toggleActivePoop]}>
                <RtlText style={styles.toggleEmoji}>💩</RtlText>
                <RtlText style={[styles.toggleLabel, hadPoop && styles.toggleLabelActive]}>קקי</RtlText>
              </Pressable>
            </View>

            {showCompletedByPicker ? (
              <>
                {/*
                  Final QA round v2: corrects WHO actually walked the dog
                  (completedByUserId), deliberately NOT the walk's
                  responsibleUserId (rotation assignment) — see
                  WalkCompletionDetails' own doc comment in
                  src/logic/walkActions.ts for why reassigning
                  responsibleUserId stays out of this modal entirely.
                */}
                <RtlText style={styles.label}>מי הוציא/ה בפועל</RtlText>
                <View style={styles.memberRow}>
                  {users!.map((u) => (
                    <Pressable
                      key={u.id}
                      onPress={() => setCompletedByUserId(u.id)}
                      style={[styles.memberChip, completedByUserId === u.id && styles.memberChipActive]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: completedByUserId === u.id }}
                      accessibilityLabel={u.name}
                    >
                      <Avatar emoji={u.avatar} color={u.color} photoUrl={u.photoUrl} size={32} />
                      <RtlText style={styles.memberChipName} numberOfLines={1}>
                        {u.name}
                      </RtlText>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}

            <RtlText style={styles.label}>הערה</RtlText>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="הערה חופשית"
              placeholderTextColor={colors.textSecondary}
              style={styles.noteInput}
              multiline
              textAlign="right"
            />

            <View style={styles.actions}>
              <Button
                label="שמירה"
                onPress={() =>
                  onSave({
                    hadPee,
                    hadPoop,
                    note: note.trim(),
                    // Only included when this caller opted into the
                    // picker — History's existing call site (no `users`/
                    // `canReassignCompletedBy` passed) never sends this
                    // field, so its behavior is byte-identical to before.
                    ...(showCompletedByPicker ? { completedByUserId } : {}),
                  })
                }
                style={styles.flex}
              />
              <Button label="ביטול" onPress={onClose} variant="secondary" style={styles.flex} />
            </View>

            {onDelete ? (
              <Button
                label="🗑️ מחיקת הטיול"
                variant="danger"
                onPress={() =>
                  Alert.alert('למחוק את הטיול?', 'הפעולה תסיר את הטיול הזה לצמיתות. אי אפשר לבטל.', [
                    { text: 'ביטול', style: 'cancel' },
                    { text: 'מחק', style: 'destructive', onPress: () => onDelete(walk.id) },
                  ])
                }
                style={styles.deleteButton}
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
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '80%' },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  subtitle: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginTop: 4, marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginTop: 16, marginBottom: 8, textAlign: 'right' },
  toggleRow: { flexDirection: 'row', gap: 12 },
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
  memberRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  memberChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  memberChipActive: { borderColor: colors.primary, backgroundColor: colors.statusCurrentBg },
  memberChipName: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, maxWidth: 90 },
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
  deleteButton: { marginTop: 12 },
});
