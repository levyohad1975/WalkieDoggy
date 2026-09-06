import React from 'react';
import { StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import { colors } from '../theme/colors';

export function EmptyState({ emoji = '🐾', title, subtitle }: { emoji?: string; title: string; subtitle?: string }) {
  return (
    <View style={styles.container}>
      <RtlText style={styles.emoji}>{emoji}</RtlText>
      <RtlText style={styles.title}>{title}</RtlText>
      {subtitle ? <RtlText style={styles.subtitle}>{subtitle}</RtlText> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.container}>
      <RtlText style={styles.emoji}>😕</RtlText>
      <RtlText style={styles.title}>{message}</RtlText>
      {onRetry ? (
        <RtlText style={styles.retry} onPress={onRetry}>
          נסה שוב
        </RtlText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, paddingHorizontal: 24 },
  emoji: { fontSize: 40, marginBottom: 12 },
  title: { fontSize: 17, fontWeight: '600', color: colors.textPrimary, textAlign: 'center' },
  subtitle: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginTop: 6 },
  retry: { marginTop: 16, fontSize: 15, fontWeight: '700', color: colors.primary },
});
