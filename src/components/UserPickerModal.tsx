import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import type { FamilyUser } from '../types';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import { Avatar } from './Avatar';

interface UserPickerModalProps {
  visible: boolean;
  title: string;
  users: FamilyUser[];
  excludeUserId?: string;
  onSelect: (userId: string) => void;
  onClose: () => void;
}

export function UserPickerModal({ visible, title, users, excludeUserId, onSelect, onClose }: UserPickerModalProps) {
  const options = users.filter((u) => u.id !== excludeUserId);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={`סגירת ${title}`}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <RtlText style={styles.title} accessibilityRole="header">{title}</RtlText>
          {options.length === 0 ? (
            <RtlText style={styles.empty}>אין בני משפחה נוספים</RtlText>
          ) : (
            options.map((u) => (
              <Pressable key={u.id} style={styles.option} onPress={() => onSelect(u.id)}>
                <Avatar emoji={u.avatar} color={u.color} photoUrl={u.photoUrl} size={40} />
                <RtlText style={styles.optionName}>{u.name}</RtlText>
              </Pressable>
            ))
          )}
          <Pressable onPress={onClose} style={styles.cancel}>
            <RtlText style={styles.cancelText}>ביטול</RtlText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, padding: 24, gap: spacing.sm },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm, textAlign: 'center' },
  empty: { textAlign: 'center', color: colors.textSecondary, paddingVertical: spacing.lg },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  optionName: { fontSize: typography.body.fontSize, fontWeight: typography.body.fontWeight, color: colors.textPrimary },
  cancel: { marginTop: spacing.md, alignItems: 'center', paddingVertical: spacing.sm },
  cancelText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
});
