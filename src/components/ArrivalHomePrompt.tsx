import React from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import { Button } from './Button';
import { WalkieMascot } from './WalkieMascot';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';

interface ArrivalHomePromptProps {
  visible: boolean;
  dogName: string;
  /** "HH:mm" of the arrival home. */
  arrivalTime: string;
  estimated: boolean;
  onEnd: () => void;
  onContinue: () => void;
}

/**
 * Owner request 2026-11-03: the walker came back home but the walk is still
 * running — ask whether it ended, with the arrival time as the end time.
 */
export function ArrivalHomePrompt({ visible, dogName, arrivalTime, estimated, onEnd, onContinue }: ArrivalHomePromptProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onContinue}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <WalkieMascot state="success" size={84} accessibilityLabel="הקמע הרשמי של Walkie Doggy" />
          <RtlText style={styles.title} accessibilityRole="header">🏠 חזרתם הביתה?</RtlText>
          <RtlText style={styles.text}>
            {`נראה שהגעתם הביתה ${estimated ? 'בערך ב-' : 'ב-'}${arrivalTime}, והטיול של ${dogName} עדיין פעיל. לסיים אותו?`}
          </RtlText>
          <Button label={`■ סיום הטיול (${arrivalTime})`} onPress={onEnd} style={styles.endButton} />
          <Button label="עדיין מטיילים" variant="secondary" onPress={onContinue} style={styles.button} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000055', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: colors.surface, borderRadius: radii.xl, padding: 24, width: '100%', maxWidth: 400, alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, textAlign: 'center', marginTop: spacing.sm },
  text: { fontSize: typography.cardTitle.fontSize, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm, lineHeight: 21 },
  endButton: { width: '100%', marginTop: spacing.lg, backgroundColor: colors.statusOverdue },
  button: { width: '100%', marginTop: spacing.md },
});
