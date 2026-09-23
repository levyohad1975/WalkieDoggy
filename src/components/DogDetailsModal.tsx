import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { RtlText } from './RtlText';
import { colors } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import { DogPhoto } from './DogPhoto';
import { Button } from './Button';
import type { Dog } from '../types';

const SEX_OPTIONS: { value: Dog['sex'] | undefined; label: string }[] = [
  { value: 'male', label: 'זכר' },
  { value: 'female', label: 'נקבה' },
  { value: undefined, label: 'לא מוגדר' },
];

interface DogDetailsModalProps {
  visible: boolean;
  dog: Dog | null;
  uploadingPhoto: boolean;
  onChangePhoto: () => void;
  onRemovePhoto: () => void;
  onSave: (patch: Partial<Dog>) => void;
  onClose: () => void;
}

export function DogDetailsModal({ visible, dog, uploadingPhoto, onChangePhoto, onRemovePhoto, onSave, onClose }: DogDetailsModalProps) {
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
      <KeyboardAvoidingView style={styles.flexFull} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={`סגירת פרטי ${dog.name}`}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
              <RtlText style={styles.title} accessibilityRole="header">🐶 פרטי {dog.name}</RtlText>
              <View style={styles.photoRow}>
                <DogPhoto photoUrl={dog.photoUrl} size={88} />
                <View style={styles.photoActions}>
                  <Pressable onPress={onChangePhoto} disabled={uploadingPhoto} style={styles.photoButton} accessibilityRole="button" accessibilityLabel="החלפת תמונת הכלב">
                    <RtlText style={styles.photoLink}>{uploadingPhoto ? 'מעלה תמונה...' : dog.photoUrl ? 'החלף תמונה' : 'הוסף תמונה מהגלריה'}</RtlText>
                  </Pressable>
                  {dog.photoUrl ? (
                    <Pressable onPress={onRemovePhoto} disabled={uploadingPhoto} style={styles.removePhotoButton} accessibilityRole="button" accessibilityLabel="מחיקת תמונת הכלב וחזרה למסקוט">
                      <RtlText style={styles.removePhotoLink}>הסר תמונה וחזור למסקוט</RtlText>
                    </Pressable>
                  ) : null}
                </View>
              </View>
              <RtlText style={styles.label}>שם</RtlText>
              <TextInput value={name} onChangeText={setName} onBlur={() => name.trim() && onSave({ name: name.trim() })} style={styles.input} textAlign="right" accessibilityLabel="שם הכלב" />
              <RtlText style={styles.label}>מין הכלב/ה</RtlText>
              <View style={styles.sexRow}>
                {SEX_OPTIONS.map((opt) => {
                  const selected = (dog.sex ?? undefined) === opt.value;
                  return (
                    <Pressable
                      key={opt.value ?? 'unset'}
                      onPress={() => onSave({ sex: opt.value })}
                      style={[styles.sexChip, selected && styles.sexChipActive]}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={opt.label}
                    >
                      <RtlText style={[styles.sexChipText, selected && styles.sexChipTextActive]}>{opt.label}</RtlText>
                    </Pressable>
                  );
                })}
              </View>
              <RtlText style={styles.label}>הערות</RtlText>
              <TextInput value={notes} onChangeText={setNotes} onBlur={() => onSave({ notes: notes.trim() || undefined })} style={styles.input} textAlign="right" placeholder="למשל: אוהב להריח כל עמוד" placeholderTextColor={colors.textSecondary} accessibilityLabel="הערות" />
              <RtlText style={styles.hint}>{dog.walksPerDay} טיולים ביום · שינוי בלוח זמנים</RtlText>
              <Button label="סגור" variant="secondary" onPress={onClose} style={styles.closeButton} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flexFull: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, padding: radii.xl, maxHeight: '88%' },
  scroll: { flexGrow: 0, flexShrink: 1 },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.sm },
  photoRow: { alignItems: 'center', gap: spacing.sm, marginVertical: spacing.sm },
  photoActions: { alignItems: 'center', gap: spacing.xs },
  photoButton: { paddingVertical: radii.sm, paddingHorizontal: spacing.lg, borderRadius: spacing.md, backgroundColor: colors.surfaceMuted },
  photoLink: { color: colors.primaryDark, fontWeight: '600', fontSize: typography.cardTitle.fontSize },
  removePhotoButton: { paddingVertical: spacing.xs, paddingHorizontal: spacing.md },
  removePhotoLink: { color: colors.statusOverdue, fontWeight: '600', fontSize: typography.meta.fontSize },
  label: { fontSize: typography.meta.fontSize, fontWeight: '700', color: colors.textSecondary, marginTop: spacing.md, textAlign: 'right' },
  sexRow: { flexDirection: 'row', gap: spacing.sm, marginTop: 6 },
  sexChip: { flex: 1, paddingVertical: radii.sm, borderRadius: spacing.md, alignItems: 'center', backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: 'transparent' },
  sexChipActive: { backgroundColor: colors.statusCurrentBg, borderColor: colors.primary },
  sexChipText: { fontSize: typography.meta.fontSize, fontWeight: '600', color: colors.textSecondary },
  sexChipTextActive: { color: colors.primaryDark, fontWeight: '700' },
  input: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md, padding: radii.md, fontSize: typography.body.fontSize, color: colors.textPrimary },
  hint: { fontSize: 12, color: colors.textSecondary, textAlign: 'right', marginTop: radii.sm, lineHeight: 18 },
  closeButton: { marginTop: spacing.xl },
});
