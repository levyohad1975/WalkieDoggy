import React from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { RtlText } from './RtlText';
import { DogPhoto } from './DogPhoto';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import type { Dog } from '../types';

interface DogSelectorRowProps {
  dogs: Dog[];
  selectedDogId: string | null;
  onSelect: (dogId: string) => void;
}

/**
 * Compact horizontal dog-switcher chip strip — PRD §11: "ב-Home יש בחירת
 * כלב קלה כאשר יש יותר מכלב אחד" (Home needs an easy dog picker whenever
 * there's more than one dog). Extracted from SettingsScreen.tsx's own
 * dog-selector chip row (which keeps its own inline copy unchanged) so a
 * second screen needing the identical widget doesn't reimplement it from
 * scratch. Callers are expected to only render this when `dogs.length > 1`
 * — this component itself doesn't hide for exactly one dog, since a caller
 * might have its own reason to always show a single-dog chip (none
 * currently do).
 */
export function DogSelectorRow({ dogs, selectedDogId, onSelect }: DogSelectorRowProps) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {dogs.map((d) => {
        const isActive = d.id === selectedDogId;
        return (
          <Pressable
            key={d.id}
            onPress={() => onSelect(d.id)}
            style={[styles.chip, isActive && styles.chipActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={isActive ? `${d.name}, הכלב הפעיל כעת` : `בחירת ${d.name} ככלב הפעיל`}
          >
            <DogPhoto photoUrl={d.photoUrl} size={40} />
            <RtlText style={[styles.chipName, isActive && styles.chipNameActive]} numberOfLines={1}>
              {d.name}
            </RtlText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row-reverse', gap: spacing.sm, paddingBottom: spacing.xs },
  chip: {
    alignItems: 'center',
    gap: 4,
    width: 72,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipActive: { backgroundColor: colors.statusCurrentBg, borderColor: colors.primary },
  chipName: { ...typography.meta, fontSize: 12, color: colors.textSecondary, textAlign: 'center' },
  chipNameActive: { color: colors.primaryDark, fontWeight: '700' },
});
