import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import { useAuthStore } from '../store/authStore';
import { colors } from '../theme/colors';
import { spacing, typography } from '../theme/tokens';

export function SystemObserverBanner() {
  const active = useAuthStore((s) => s.systemObserverActive);
  const familyName = useAuthStore((s) => s.systemObserverFamilyName);
  const endSystemObserver = useAuthStore((s) => s.endSystemObserver);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState(false);

  if (!active) return null;

  const exit = async () => {
    if (ending) return;
    setEnding(true);
    setError(false);
    try {
      await endSystemObserver();
    } catch {
      setError(true);
    } finally {
      setEnding(false);
    }
  };

  return (
    <View style={styles.container} accessibilityRole="summary">
      <View style={styles.textWrap}>
        <RtlText style={styles.title}>🕶️ צפייה נסתרת · {familyName ?? 'משפחה'}</RtlText>
        <RtlText style={styles.subtitle}>
          מצב מנהל משפחה לצפייה בלבד{error ? ' · לא הצלחנו לצאת, נסו שוב' : ''}
        </RtlText>
      </View>
      <Pressable onPress={exit} disabled={ending} style={styles.exit} accessibilityRole="button" accessibilityLabel="יציאה מצפייה נסתרת">
        {ending ? <ActivityIndicator size="small" color={colors.surface} /> : <RtlText style={styles.exitText}>יציאה</RtlText>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 54,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primaryDark,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  textWrap: { flex: 1, alignItems: 'flex-end' },
  title: { ...typography.meta, color: colors.surface, fontWeight: '800', textAlign: 'right' },
  subtitle: { ...typography.caption, color: colors.surface, opacity: 0.9, textAlign: 'right' },
  exit: { borderWidth: 1, borderColor: colors.surface, borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, minWidth: 58, alignItems: 'center' },
  exitText: { ...typography.meta, color: colors.surface, fontWeight: '800' },
});
