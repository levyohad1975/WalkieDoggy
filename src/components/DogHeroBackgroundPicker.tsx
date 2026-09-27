import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import type { Dog } from '../types';
import { DOG_BACKGROUNDS } from '../theme/dogBackgrounds';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import { RtlText } from './RtlText';
import { Button } from './Button';

/**
 * Shared background picker. Selection is deliberately a draft until the
 * explicit Save button is pressed — changing a visual preference should
 * never silently persist just because a thumbnail was tapped.
 */
export function DogHeroBackgroundPicker({ dog, onSave }: { dog: Dog; onSave: (patch: Partial<Dog>) => void | Promise<void> }) {
  const [draftId, setDraftId] = useState<string | undefined>(dog.heroBackgroundId);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraftId(dog.heroBackgroundId), [dog.id, dog.heroBackgroundId]);

  const dirty = draftId !== dog.heroBackgroundId;
  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      await onSave({ heroBackgroundId: draftId });
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container} testID="dog-hero-background-picker">
      <RtlText style={styles.title}>רקע למסך הבית</RtlText>
      <RtlText style={styles.hint}>בחרו רקע ואז לחצו שמור. הרקע משותף לכל המשפחה.</RtlText>
      <View style={styles.grid}>
        {DOG_BACKGROUNDS.map((item) => {
          const selected = draftId === item.id;
          return (
            <Pressable
              key={item.id}
              onPress={() => setDraftId(item.id)}
              style={[styles.tile, selected && styles.selected]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`בחירת רקע ${item.label}`}
            >
              <Image source={{ uri: item.uri }} style={styles.thumb} resizeMode="cover" />
              <View style={styles.labelWrap}><RtlText style={styles.label}>{item.label}</RtlText></View>
              {selected ? <View style={styles.check}><RtlText style={styles.checkText}>✓</RtlText></View> : null}
            </Pressable>
          );
        })}
      </View>
      <Button label={saving ? 'שומר…' : 'שמור רקע'} onPress={() => void save()} disabled={!dirty || saving} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', gap: spacing.xs, marginTop: spacing.md },
  title: { ...typography.sectionTitle, color: colors.textPrimary, textAlign: 'right' },
  hint: { ...typography.meta, color: colors.textSecondary, textAlign: 'right' },
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'space-between' },
  tile: { width: '48%', height: 88, borderRadius: radii.md, overflow: 'hidden', borderWidth: 3, borderColor: 'transparent', position: 'relative' },
  selected: { borderColor: colors.primaryDark },
  thumb: { ...StyleSheet.absoluteFill, width: undefined, height: undefined },
  labelWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#00000088', paddingVertical: 4, paddingHorizontal: 6 },
  label: { color: '#fff', fontSize: 12, fontWeight: '800', textAlign: 'center' },
  check: { position: 'absolute', top: 5, right: 5, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center' },
  checkText: { color: '#fff', fontSize: 16, fontWeight: '900' },
});
