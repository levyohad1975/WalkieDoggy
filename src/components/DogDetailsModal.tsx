import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { RtlText } from './RtlText';
import { colors } from '../theme/colors';
import { DogPhoto } from './DogPhoto';
import { Button } from './Button';
import type { Dog } from '../types';

interface DogDetailsModalProps {
  visible: boolean;
  dog: Dog | null;
  uploadingPhoto: boolean;
  onChangePhoto: () => void;
  onSave: (patch: Partial<Dog>) => void;
  onClose: () => void;
}

/**
 * Section 12: "🐶 פרטי טופי" — dog name/photo/notes editing, moved out of
 * the main Settings list into its own focused sub-screen (a modal, matching
 * this app's existing navigation pattern — every other focused editing flow
 * in this repo is a modal sheet, not a pushed stack screen).
 */
export function DogDetailsModal({ visible, dog, uploadingPhoto, onChangePhoto, onSave, onClose }: DogDetailsModalProps) {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (visible && dog) {
      setName(dog.name);
      setNotes(dog.notes ?? '');
    }
  }, [visible, dog]);

  if (!dog) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
            <RtlText style={styles.title}>🐶 פרטי {dog.name}</RtlText>

            <View style={styles.photoRow}>
              <DogPhoto photoUrl={dog.photoUrl} size={88} />
              <Pressable
                onPress={onChangePhoto}
                disabled={uploadingPhoto}
                style={styles.photoButton}
                accessibilityRole="button"
                accessibilityLabel="החלפת תמונת הכלב"
              >
                <RtlText style={styles.photoLink}>{uploadingPhoto ? 'מעלה תמונה...' : dog.photoUrl ? 'החלף תמונה' : 'הוסף תמונה מהגלריה'}</RtlText>
              </Pressable>
            </View>

            <RtlText style={styles.label}>שם</RtlText>
            <TextInput
              value={name}
              onChangeText={setName}
              onBlur={() => name.trim() && onSave({ name: name.trim() })}
              style={styles.input}
              textAlign="right"
            />

            <RtlText style={styles.label}>הערות</RtlText>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              onBlur={() => onSave({ notes: notes.trim() || undefined })}
              style={styles.input}
              textAlign="right"
              placeholder="למשל: אוהב להריח כל עמוד"
              placeholderTextColor={colors.textSecondary}
            />

            <RtlText style={styles.hint}>{dog.walksPerDay} טיולים ביום · שינוי בלוח זמנים</RtlText>

            <Button label="סגור" variant="secondary" onPress={onClose} style={styles.closeButton} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '88%' },
  // BUG FIX (real-device regression): `flex: 1` here overrides RN's own
  // ScrollView default outer-view style (`flexGrow: 0, flexShrink: 1,
  // flexBasis: 'auto'`) with `flexGrow: 1, flexShrink: 1, flexBasis: 0`.
  // `sheet` above has no fixed/definite height of its own — only a
  // `maxHeight` cap on an otherwise auto (hug-content) column — and a
  // flex-basis-0 child inside an auto-height parent has nothing concrete
  // to grow into, so Yoga resolves it (and therefore the whole sheet) down
  // toward 0/near-0 height instead of sizing to content. `flexGrow: 0,
  // flexShrink: 1` restores content-hugging sizing (no forced fill) while
  // still allowing the ScrollView to be compressed down to `sheet`'s
  // maxHeight cap once content actually exceeds it, at which point it
  // scrolls internally instead of the sheet collapsing.
  scroll: { flexGrow: 0, flexShrink: 1 },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: 8 },
  photoRow: { alignItems: 'center', gap: 8, marginVertical: 8 },
  photoButton: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, backgroundColor: colors.surfaceMuted },
  photoLink: { color: colors.primaryDark, fontWeight: '600', fontSize: 14 },
  label: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginTop: 12, textAlign: 'right' },
  input: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 14,
    padding: 14,
    fontSize: 16,
    color: colors.textPrimary,
  },
  hint: { fontSize: 12, color: colors.textSecondary, textAlign: 'right', marginTop: 10, lineHeight: 18 },
  closeButton: { marginTop: 20 },
});
