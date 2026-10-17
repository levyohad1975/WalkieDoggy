import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import type { Walk } from '../types';
import { Button } from './Button';
import { RtlText } from './RtlText';
import { colors } from '../theme/colors';
import { radii, spacing } from '../theme/tokens';

interface Props {
  visible: boolean;
  dogName: string;
  candidates: Walk[];
  assigneeNames: Record<string, string>;
  onAssociate: (walk: Walk) => void;
  onSeparate: () => void;
  onCancel: () => void;
}

/** Explicit user choice; time proximity is only used to offer candidate occurrences. */
export function SpontaneousWalkAssociationModal({ visible, dogName, candidates, assigneeNames, onAssociate, onSeparate, onCancel }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} accessibilityRole="button" accessibilityLabel="ביטול בחירת שיוך הטיול">
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <RtlText style={styles.title} accessibilityRole="header">הטיול של {dogName} קרוב לשעה מתוכננת</RtlText>
          <RtlText style={styles.message}>טיול ספונטני יכול להחליף טיול מתוכנן עד שעתיים מראש. רק בחירה מפורשת תחליף אותו; אחרת הטיול המתוכנן יישאר כרגיל.</RtlText>
          {candidates.map((walk) => (
            <Button
              key={walk.id}
              label={`החלף את הטיול המתוכנן · ${walk.scheduledTime} · ${assigneeNames[walk.responsibleUserId] ?? 'בן משפחה'}`}
              onPress={() => onAssociate(walk)}
              variant="secondary"
              wrap
            />
          ))}
          <Button label="השאר את הטיול המתוכנן וצור טיול נפרד" onPress={onSeparate} />
          <Pressable onPress={onCancel} style={styles.cancel}><RtlText style={styles.cancelText}>ביטול</RtlText></Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, padding: spacing.xl, gap: spacing.md },
  title: { color: colors.textPrimary, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  message: { color: colors.textSecondary, fontSize: 14, textAlign: 'center' },
  cancel: { alignItems: 'center', padding: spacing.sm },
  cancelText: { color: colors.textSecondary, fontWeight: '700' },
});
