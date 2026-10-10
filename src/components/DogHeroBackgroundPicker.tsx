import React, { useEffect, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, View } from 'react-native';
import type { Dog } from '../types';
import { DOG_BACKGROUNDS, DEFAULT_DOG_BACKGROUND, getDogBackgroundImageSource } from '../theme/dogBackgrounds';
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
    } catch {
      Alert.alert('לא הצלחנו לשמור את הרקע', 'הרקע לא נשמר בשרת. בדקו את החיבור ונסו שוב.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container} testID="dog-hero-background-picker">
      <RtlText style={styles.title}>רקע למסך הבית</RtlText>
      <RtlText style={styles.hint}>בחרו רקע ואז לחצו שמור. הרקע משותף לכל המשפחה.</RtlText>
      <View style={styles.grid}>
        <Pressable
          onPress={() => setDraftId(undefined)}
          style={[styles.tile, styles.defaultTile, draftId === undefined && styles.selected]}
          accessibilityRole="button"
          accessibilityState={{ selected: draftId === undefined }}
          accessibilityLabel="בחירת פארק Walkie Doggy כברירת מחדל"
        >
          <Image source={getDogBackgroundImageSource(DEFAULT_DOG_BACKGROUND)} style={styles.thumb} resizeMode="cover" />
          <View style={styles.labelWrap}><RtlText style={styles.label}>ברירת מחדל · פארק</RtlText></View>
          {draftId === undefined ? <View style={styles.check}><RtlText style={styles.checkText}>✓</RtlText></View> : null}
        </Pressable>
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
  defaultTile: { backgroundColor: '#F8F4EA' },
  defaultPreview: { ...StyleSheet.absoluteFill, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  defaultSun: { position: 'absolute', width: 48, height: 48, borderRadius: 24, right: 18, top: 8, backgroundColor: '#FFF1C7' },
  defaultHillBack: { position: 'absolute', width: 170, height: 78, borderRadius: 85, left: -48, bottom: -40, backgroundColor: '#E8F1DF' },
  defaultHillFront: { position: 'absolute', width: 165, height: 74, borderRadius: 82, right: -48, bottom: -43, backgroundColor: '#DCEAD7' },
  defaultGround: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 16, backgroundColor: '#F2E4C9' },
  thumb: { ...StyleSheet.absoluteFill, width: undefined, height: undefined },
  labelWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#00000088', paddingVertical: 4, paddingHorizontal: 6 },
  label: { color: '#fff', fontSize: 12, fontWeight: '800', textAlign: 'center' },
  check: { position: 'absolute', top: 5, right: 5, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center' },
  checkText: { color: '#fff', fontSize: 16, fontWeight: '900' },
});
