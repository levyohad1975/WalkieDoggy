import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import type { FamilyUser, UserDeletionImpact } from '../types';
import { colors } from '../theme/colors';
import { Avatar } from './Avatar';
import { Button } from './Button';

interface DeleteUserModalProps {
  visible: boolean;
  user: FamilyUser | null;
  impact: UserDeletionImpact | null;
  otherUsers: FamilyUser[];
  onConfirm: (replacementUserId: string | null) => void;
  onClose: () => void;
}

/**
 * "Can't delete someone without breaking the rotation" safety check: shows
 * how many future turns/rules are affected and — if there's an impact —
 * requires picking who takes over before deletion is allowed to proceed.
 */
export function DeleteUserModal({ visible, user, impact, otherUsers, onConfirm, onClose }: DeleteUserModalProps) {
  const [replacement, setReplacement] = useState<string | null>(null);

  useEffect(() => {
    if (visible) setReplacement(otherUsers[0]?.id ?? null);
  }, [visible, otherUsers]);

  if (!user) return null;
  const hasImpact = Boolean(impact && (impact.futureScheduleEntryCount > 0 || impact.rulesAffected.length > 0));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <ScrollView>
            <RtlText style={styles.title}>למחוק את {user.name}?</RtlText>

            {hasImpact ? (
              <>
                <RtlText style={styles.warning}>
                  ל{user.name} יש {impact!.futureScheduleEntryCount} טיולים עתידיים ו-{impact!.rulesAffected.length} סבבים
                  פעילים. כדי למחוק בבטחה, יש לבחור מי ימשיך את התורות שלו:
                </RtlText>
                {otherUsers.length === 0 ? (
                  <RtlText style={styles.blocked}>אין בן משפחה אחר שיכול להחליף — הוסיפו קודם בן משפחה נוסף.</RtlText>
                ) : (
                  <View style={styles.userList}>
                    {otherUsers.map((u) => (
                      <Pressable
                        key={u.id}
                        onPress={() => setReplacement(u.id)}
                        hitSlop={4}
                        style={[styles.userChip, replacement === u.id && styles.userChipActive]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: replacement === u.id }}
                      >
                        <Avatar emoji={u.avatar} color={u.color} photoUrl={u.photoUrl} size={40} />
                        <RtlText
                          style={[styles.userChipName, replacement === u.id && styles.userChipNameActive]}
                          numberOfLines={1}
                        >
                          {u.name}
                        </RtlText>
                        <View style={[styles.radioDot, replacement === u.id && styles.radioDotActive]} />
                      </Pressable>
                    ))}
                  </View>
                )}
              </>
            ) : (
              <RtlText style={styles.message}>אין ל{user.name} טיולים עתידיים או סבבים פעילים — אפשר למחוק בבטחה.</RtlText>
            )}

            {/* Round 8, Fix 4: a visual divider + extra top margin keeps the
                destructive "מחק" action clearly separated from the
                replacement-picker list above it, rather than sitting right
                against the last option. */}
            <View style={styles.divider} />
            <View style={styles.actions}>
              <Button
                label="מחק"
                variant="danger"
                disabled={hasImpact && !replacement}
                accessibilityHint="המחיקה מיידית ואינה ניתנת לביטול"
                onPress={() => onConfirm(hasImpact ? replacement : null)}
                style={styles.flex}
                compact
              />
              <Button label="ביטול" onPress={onClose} variant="secondary" style={styles.flex} compact />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000055', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: colors.surface, borderRadius: 24, padding: 24, width: '100%', maxWidth: 420, maxHeight: '80%' },
  title: { fontSize: 19, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  message: { fontSize: 15, color: colors.textSecondary, textAlign: 'center', marginTop: 12 },
  warning: { fontSize: 14, color: colors.textPrimary, textAlign: 'right', marginTop: 12, lineHeight: 20 },
  blocked: { fontSize: 14, color: colors.statusOverdue, textAlign: 'right', marginTop: 10, fontWeight: '600' },
  // Round 8, Fix 4: replaced the cramped wrapping avatar-only chip grid with
  // a plain vertical list — one full-width row per candidate, each with a
  // comfortable minimum touch target (52px, matching Button's own minimum)
  // and clear spacing between rows. Stays readable/scrollable at 4-5
  // members without the card needing to grow past its existing maxHeight.
  userList: { gap: 8, marginTop: 12 },
  userChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  userChipActive: { borderColor: colors.primary, backgroundColor: colors.statusCurrentBg },
  userChipName: { flex: 1, fontSize: 15, color: colors.textPrimary, fontWeight: '600', textAlign: 'right' },
  userChipNameActive: { color: colors.primaryDark, fontWeight: '700' },
  radioDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  radioDotActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  divider: { height: 1, backgroundColor: colors.border, marginTop: 20 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  flex: { flex: 1 },
});
