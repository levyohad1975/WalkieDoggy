import React from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import { colors } from '../theme/colors';
import { radii, spacing } from '../theme/tokens';
import { Button } from './Button';

interface ConfirmModalProps {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

/** Short confirmation before marking a walk done — quick, one tap to confirm. */
export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel = 'אישור',
  cancelLabel = 'ביטול',
  onConfirm,
  onCancel,
  loading,
}: ConfirmModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <RtlText style={styles.title} accessibilityRole="header">{title}</RtlText>
          {message ? <RtlText style={styles.message}>{message}</RtlText> : null}
          <View style={styles.actions}>
            {/* Round 8, Fix 3: compact — a paired flex:1 row is the exact
                narrow-slot case that was wrapping a longer label like
                "הפוך למנהל" onto 2-3 lines on a real iPhone (see Button's
                `compact` prop doc comment). Applied to BOTH buttons, so
                they stay the same size as each other — no lopsided
                confirm/cancel pair. */}
            <Button label={confirmLabel} onPress={onConfirm} loading={loading} style={styles.flex} compact />
            <Button label={cancelLabel} onPress={onCancel} variant="secondary" style={styles.flex} compact />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000055', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: 24, width: '100%', maxWidth: 400 },
  title: { fontSize: 19, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  message: { fontSize: 15, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  flex: { flex: 1 },
});
