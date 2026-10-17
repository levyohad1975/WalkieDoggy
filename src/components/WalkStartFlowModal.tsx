import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import type { FamilyUser } from '../types';
import { Button } from './Button';
import { ConfirmModal } from './ConfirmModal';
import { RtlText } from './RtlText';
import { UserPickerModal } from './UserPickerModal';
import { colors } from '../theme/colors';
import { radii, spacing } from '../theme/tokens';

interface Props {
  visible: boolean;
  dogName: string;
  assignedName: string;
  currentUserId: string;
  users: FamilyUser[];
  canStartRemotely: boolean;
  onStart: (actualWalkerId: string, remote: boolean) => void;
  onClose: () => void;
}

/** Explicitly distinguishes self-substitution from a manager remote start. */
export function WalkStartFlowModal({ visible, dogName, assignedName, currentUserId, users, canStartRemotely, onStart, onClose }: Props) {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<FamilyUser | null>(null);
  const dismiss = () => { setSelecting(false); setSelected(null); onClose(); };
  return (
    <>
      <Modal visible={visible && !selecting && !selected} transparent animationType="fade" onRequestClose={dismiss}>
        <Pressable style={styles.backdrop} onPress={dismiss} accessibilityRole="button" accessibilityLabel="סגירת אפשרויות התחלת הטיול">
          <Pressable style={styles.card} onPress={(event) => event.stopPropagation()}>
            <RtlText style={styles.title} accessibilityRole="header">הטיול משובץ ל{assignedName}</RtlText>
            <RtlText style={styles.message}>מי יוצא עם {dogName}?</RtlText>
            <Button label="כן, אני יוצא" onPress={() => onStart(currentUserId, false)} />
            {canStartRemotely ? <Button label="מישהו אחר יוצא" variant="secondary" onPress={() => setSelecting(true)} /> : null}
            <Pressable onPress={dismiss} style={styles.cancel}><RtlText style={styles.cancelText}>ביטול</RtlText></Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <UserPickerModal
        visible={visible && selecting}
        title="מי יוצא לטיול?"
        users={users}
        excludeUserId={currentUserId}
        onClose={() => setSelecting(false)}
        onSelect={(id) => { setSelected(users.find((user) => user.id === id) ?? null); setSelecting(false); }}
      />
      <ConfirmModal
        visible={visible && Boolean(selected)}
        title={`להתחיל את הטיול עבור ${selected?.name ?? ''}?`}
        message={`${selected?.name ?? 'בן המשפחה'} יופיע/תופיע כמטייל/ת בפועל. מעקב GPS יופעל רק מהמכשיר שלו/ה.`}
        confirmLabel="כן, להתחיל מרחוק"
        onConfirm={() => { if (selected) onStart(selected.id, true); }}
        onCancel={() => setSelected(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000055', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  card: { width: '100%', maxWidth: 410, backgroundColor: colors.surface, borderRadius: radii.xl, padding: spacing.xl, gap: spacing.md },
  title: { color: colors.textPrimary, fontSize: 19, fontWeight: '800', textAlign: 'center' },
  message: { color: colors.textSecondary, fontSize: 15, textAlign: 'center' },
  cancel: { alignItems: 'center', padding: spacing.sm },
  cancelText: { color: colors.textSecondary, fontWeight: '700' },
});
