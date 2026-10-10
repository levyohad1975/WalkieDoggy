import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import { Button } from './Button';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';

interface PrivacyAccessibilityInfoModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * PRD §16: Settings must include "פרטיות/GPS" and "נגישות/Reduced Motion"
 * as their own entries. Both are policy/behavior FACTS about this app —
 * foreground-only GPS with aggregate-only storage (see
 * supabase/migrations/0051_walk_gps_sessions.sql's own doc comment: only
 * distance + point count are ever persisted, never a raw route), and
 * OS-driven Reduced Motion (see MascotFrameAnimation.tsx's
 * AccessibilityInfo usage) — not settings a user configures from inside
 * this app, so this is a read-only explanation, not a toggle screen.
 * Reduced Motion in particular is controlled by the DEVICE's own
 * accessibility setting; this modal only reports the current status and
 * points to where to change it, exactly like every other screen in this
 * app already reads it (never a local override).
 */
export function PrivacyAccessibilityInfoModal({ visible, onClose }: PrivacyAccessibilityInfoModalProps) {
  // Fail-safe default true (same convention as MascotFrameAnimation.tsx/
  // WalkCompletionCelebration.tsx): assume the more restrictive/likely-off
  // state until the real async result resolves, so an in-flight query
  // never briefly reports the OPPOSITE of a screen reader / reduced-motion
  // user's actual device setting.
  const [reduceMotionEnabled, setReduceMotionEnabled] = useState(true);

  useEffect(() => {
    if (!visible) return undefined;
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => mounted && setReduceMotionEnabled(!!enabled))
      .catch(() => mounted && setReduceMotionEnabled(true));
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotionEnabled);
    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="סגירת פרטיות ונגישות">
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <RtlText style={styles.title} accessibilityRole="header">🔒 פרטיות ונגישות</RtlText>

          <ScrollView style={styles.scroll}>
            <RtlText style={styles.sectionLabel}>🛰️ מיקום ו-GPS</RtlText>
            <RtlText style={styles.paragraph}>
              מעקב מיקום פועל רק בזמן טיול פעיל, ורק במכשיר שמבצע אותו — האפליקציה אינה עוקבת אחרי מיקום ברקע, ולא בין טיולים.
            </RtlText>
            <RtlText style={styles.paragraph}>
              אנחנו שומרים רק את המרחק המחושב וכמות נקודות המדידה, ולעולם לא את המסלול או קואורדינטות מדויקות. אפשר תמיד לאשר או לתקן את המרחק שנמדד.
            </RtlText>
            <RtlText style={styles.paragraph}>בני המשפחה אינם עוקבים זה אחר זה — נתוני GPS משויכים לטיול עצמו בלבד.</RtlText>

            <RtlText style={[styles.sectionLabel, styles.sectionLabelSpaced]}>♿ נגישות ותנועה מופחתת</RtlText>
            <RtlText style={styles.paragraph}>
              האפליקציה מכבדת את הגדרת "הפחתת תנועה" של המכשיר: כשהיא פעילה, אנימציות הקאמע מוחלפות בתמונה סטטית, ללא הבהוב או תנועה אגרסיבית.
            </RtlText>
            <View style={styles.statusRow}>
              <RtlText style={styles.statusValue}>{reduceMotionEnabled ? 'פעילה במכשיר זה' : 'כבויה במכשיר זה'}</RtlText>
              <RtlText style={styles.statusLabel}>סטטוס נוכחי:</RtlText>
            </View>
            <RtlText style={styles.paragraph}>
              ניתן לשנות זאת בהגדרות הנגישות של המכשיר (iOS: הגדרות ← נגישות ← תנועה; Android: הגדרות ← נגישות).
            </RtlText>
          </ScrollView>

          <Button label="סגור" variant="secondary" onPress={onClose} style={styles.closeButton} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, padding: 24, maxHeight: '85%' },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.sm },
  scroll: { flexGrow: 0, flexShrink: 1 },
  sectionLabel: { ...typography.sectionTitle, fontSize: 15, color: colors.textPrimary, textAlign: 'right', marginBottom: spacing.xs },
  sectionLabelSpaced: { marginTop: spacing.md },
  paragraph: { ...typography.meta, color: colors.textSecondary, textAlign: 'right', marginBottom: spacing.xs, lineHeight: 19 },
  statusRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  statusLabel: { ...typography.meta, color: colors.textSecondary },
  statusValue: { ...typography.body, fontSize: 14, fontWeight: '700', color: colors.primaryDark },
  closeButton: { marginTop: spacing.sm },
});
