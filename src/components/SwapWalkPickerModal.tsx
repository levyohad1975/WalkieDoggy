import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import type { Walk } from '../types';
import { colors } from '../theme/colors';
import { Avatar } from './Avatar';
import { Button } from './Button';
import type { SwappableWalkOption } from './EditWalkModal';

interface SwapWalkPickerModalProps {
  visible: boolean;
  /** The walk being edited, shown as context ("להחליף את ... עם:"). */
  walk: Walk | null;
  options: SwappableWalkOption[];
  onSelect: (otherWalkId: string) => void;
  onClose: () => void;
}

function formatWalkDate(date: string): string {
  const today = new Date();
  const todayString =
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowString =
    `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

  if (date === todayString) return 'היום';
  if (date === tomorrowString) return 'מחר';

  const [year, month, day] = date.split('-');
  return `${day}.${month}`;
}

function weekdayLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('he-IL', { weekday: 'long' });
}

/**
 * Dedicated, full-size swap-candidate picker (Section 8) — extracted out of
 * EditWalkModal's cramped nested ScrollView so the list is comfortable to
 * browse and doesn't fight the sheet's own scroll gesture. Opened from
 * EditWalkModal's "🔁 בחר טיול" button; closing it (by selecting or by
 * "ביטול") returns to the edit sheet underneath, which stays open. Preserves
 * the exact same onSwapWithWalk(otherWalkId) business-logic contract — this
 * component is purely presentational routing back to that same callback.
 */
export function SwapWalkPickerModal({ visible, walk, options, onSelect, onClose }: SwapWalkPickerModalProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="סגירת בחירת טיול להחלפה"
      >
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <RtlText style={styles.title}>להחליף עם איזה טיול?</RtlText>
          {walk ? (
            <RtlText style={styles.subtitle}>
              הטיול של {walk.scheduledTime} יוחלף עם הטיול שתבחרו — שני הטיולים יתחלפו
            </RtlText>
          ) : null}

          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {options.length === 0 ? (
              <RtlText style={styles.emptyText}>אין טיולים אחרים זמינים להחלפה</RtlText>
            ) : (
              options.map(({ walk: other, responsible }) => (
                <Pressable
                  key={other.id}
                  style={styles.option}
                  onPress={() => onSelect(other.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`החלף עם הטיול של ${responsible?.name ?? 'לא הוגדר'} ב-${formatWalkDate(other.date)} בשעה ${other.scheduledTime}`}
                >
                  <Avatar
                    emoji={responsible?.avatar ?? '🙂'}
                    color={responsible?.color ?? colors.primary}
                    photoUrl={responsible?.photoUrl}
                    size={40}
                  />
                  <View style={styles.optionText}>
                    <RtlText style={styles.optionName} numberOfLines={1}>
                      {responsible?.name ?? 'לא הוגדר'}
                    </RtlText>
                    <RtlText style={styles.optionMeta}>
                      {weekdayLabel(other.date)} · {formatWalkDate(other.date)} · {other.scheduledTime}
                    </RtlText>
                  </View>
                </Pressable>
              ))
            )}
          </ScrollView>

          <Button label="ביטול" variant="secondary" onPress={onClose} style={styles.closeButton} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    height: '80%',
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  subtitle: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginTop: 6, marginBottom: 12 },
  list: { flex: 1, marginTop: 4 },
  emptyText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginTop: 24 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
  },
  optionText: { flex: 1, alignItems: 'flex-end', gap: 2 },
  optionName: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, textAlign: 'right' },
  optionMeta: { fontSize: 12, color: colors.textSecondary, textAlign: 'right' },
  closeButton: { marginTop: 12 },
});
