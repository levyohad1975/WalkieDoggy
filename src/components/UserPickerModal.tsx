import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import type { FamilyUser } from '../types';
import { colors } from '../theme/colors';
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
          <RtlText style={styles.title}>{title}</RtlText>
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
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 8 },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginBottom: 8, textAlign: 'center' },
  empty: { textAlign: 'center', color: colors.textSecondary, paddingVertical: 16 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  optionName: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  cancel: { marginTop: 12, alignItems: 'center', paddingVertical: 8 },
  cancelText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
});
