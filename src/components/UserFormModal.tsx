import React, { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { RtlText } from './RtlText';
import type { FamilyUser } from '../types';
import { colors, userPalette } from '../theme/colors';
import { radii, spacing, typography } from '../theme/tokens';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { pickAndUploadImage } from '../lib/uploadImage';
import { useFamilyStore } from '../store/familyStore';

export function shouldRunPendingWebPhotoPick(pendingPhotoPick: boolean, platform: string): boolean {
  return pendingPhotoPick && platform === 'web';
}

export function shouldAutoSaveUploadedMemberPhoto(editingUser: FamilyUser | null, uri: string | null): boolean {
  return Boolean(editingUser && uri);
}

const EMOJI_OPTIONS = ['🧑', '👨', '👩', '🧒', '👦', '👧', '👴', '👵'];

interface UserFormModalProps {
  visible: boolean;
  editingUser: FamilyUser | null;
  /** Needed to build the Supabase Storage path ({familyId}/users/{userId}/...) — unused in local/demo mode. */
  familyId: string;
  onSave: (input: { name: string; avatar: string; color: string; photoUrl?: string }) => void;
  onClose: () => void;
}

/** Add or edit a family member: name, emoji fallback, color, and a real photo from the gallery. */
export function UserFormModal({ visible, editingUser, familyId, onSave, onClose }: UserFormModalProps) {
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(EMOJI_OPTIONS[0]);
  const [color, setColor] = useState(userPalette[0]);
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [pendingPhotoPick, setPendingPhotoPick] = useState(false);
  const persistExistingMemberPhoto = useFamilyStore((s) => s.updateUser);
  // Keep latest values available while the hosted web cropper is open.
  // The upload effect must not restart/cancel just because the parent or form re-renders.
  const webPhotoSaveRef = useRef({ editingUser, name, avatar, color, onSave, onClose });
  webPhotoSaveRef.current = { editingUser, name, avatar, color, onSave, onClose };

  useEffect(() => {
    if (visible) {
      setName(editingUser?.name ?? '');
      setAvatar(editingUser?.avatar ?? EMOJI_OPTIONS[0]);
      setColor(editingUser?.color ?? userPalette[0]);
      setPhotoUrl(editingUser?.photoUrl);
    }
  }, [visible, editingUser]);

  const pickPhoto = async () => {
    // On Web, the crop UI is hosted above this form modal. Hide the form
    // first so the cropper is never trapped behind a React-Native-Web Modal.
    // Native uses the OS editor and does not need this hand-off.
    if (Platform.OS === 'web') {
      setPendingPhotoPick(true);
      return;
    }
    setUploading(true);
    try {
      const uri = await pickAndUploadImage('users', familyId, editingUser?.id ?? 'new');
      if (uri) {
        setPhotoUrl(uri);
        // Existing member photo uploads are complete mutations, not drafts.
        // Persist immediately so a refresh cannot discard a successfully
        // uploaded Storage object just because the user did not press the
        // separate form Save button afterwards.
        if (shouldAutoSaveUploadedMemberPhoto(editingUser, uri)) {
          await onSave({ name: name.trim(), avatar, color, photoUrl: uri });
        }
      }
    } catch {
      Alert.alert('לא הצלחנו להחליף תמונה', 'בדקו הרשאת תמונות וחיבור לאינטרנט ונסו שוב.');
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    if (!shouldRunPendingWebPhotoPick(pendingPhotoPick, Platform.OS)) return;
    setUploading(true);
    void pickAndUploadImage('users', familyId, editingUser?.id ?? 'new')
      .then((uri) => {
        if (!uri) return;
        const latest = webPhotoSaveRef.current;
        // Once Storage accepted the image, modal lifecycle changes must not
        // cancel the authoritative users.photo_url write.
        if (shouldAutoSaveUploadedMemberPhoto(latest.editingUser, uri)) {
          return persistExistingMemberPhoto({
            ...latest.editingUser!,
            name: latest.name.trim(),
            avatar: latest.avatar,
            color: latest.color,
            photoUrl: uri,
          }).then(() => {
            setPhotoUrl(uri);
            latest.onClose();
          });
        }
        setPhotoUrl(uri);
      })
      .catch(() => {
        Alert.alert('לא הצלחנו להחליף תמונה', 'בדקו הרשאת תמונות וחיבור לאינטרנט ונסו שוב.');
      })
      .finally(() => {
        setUploading(false);
        setPendingPhotoPick(false);
      });
  }, [pendingPhotoPick, familyId, persistExistingMemberPhoto]);

  if (pendingPhotoPick && Platform.OS === 'web') return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Round 6C1: same KeyboardAvoidingView pattern already proven in
          RequestTimeChangeModal.tsx — wraps the existing backdrop/sheet/
          ScrollView structure unchanged. */}
      <KeyboardAvoidingView style={styles.flexFull} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={editingUser ? 'סגירת עריכת בן משפחה' : 'סגירת הוספת בן משפחה'}
        >
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <RtlText style={styles.title} accessibilityRole="header">{editingUser ? 'עריכת בן משפחה' : 'הוספת בן משפחה'}</RtlText>

            <View style={styles.photoRow}>
              <Avatar emoji={avatar} color={color} photoUrl={photoUrl} size={72} />
              <Pressable
                onPress={pickPhoto}
                disabled={uploading}
                style={styles.photoButton}
                accessibilityRole="button"
                accessibilityLabel={photoUrl ? 'החלפת תמונה' : 'הוספת תמונה מהגלריה'}
              >
                <RtlText style={styles.photoLink}>{uploading ? 'מעלה תמונה...' : photoUrl ? 'החלף תמונה' : 'הוסף תמונה מהגלריה'}</RtlText>
              </Pressable>
            </View>

            <RtlText style={styles.label}>שם</RtlText>
            <TextInput
              value={name}
              onChangeText={setName}
              style={styles.input}
              placeholder="שם"
              textAlign="right"
              accessibilityLabel="שם"
            />

            <RtlText style={styles.label}>סמל (אם אין תמונה)</RtlText>
            <View style={styles.optionRow}>
              {EMOJI_OPTIONS.map((e) => (
                <Pressable
                  key={e}
                  onPress={() => setAvatar(e)}
                  style={[styles.emojiChip, avatar === e && styles.emojiChipActive]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: avatar === e }}
                  accessibilityLabel={`סמל ${e}`}
                >
                  <RtlText style={styles.emojiText}>{e}</RtlText>
                </Pressable>
              ))}
            </View>

            <RtlText style={styles.label}>צבע</RtlText>
            <View style={styles.optionRow}>
              {userPalette.map((c) => (
                <Pressable
                  key={c}
                  onPress={() => setColor(c)}
                  style={[styles.colorChip, { backgroundColor: c }, color === c && styles.colorChipActive]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: color === c }}
                  accessibilityLabel={`צבע ${c}`}
                />
              ))}
            </View>

            <View style={styles.actions}>
              <Button
                label="שמירה"
                disabled={!name.trim()}
                onPress={() => onSave({ name: name.trim(), avatar, color, photoUrl })}
                style={styles.flex}
              />
              <Button label="ביטול" onPress={onClose} variant="secondary" style={styles.flex} />
            </View>
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
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, padding: 24, maxHeight: '88%' },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.lg },
  photoRow: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  photoButton: { paddingVertical: 10, paddingHorizontal: spacing.lg, borderRadius: 12, backgroundColor: colors.surfaceMuted },
  photoLink: { color: colors.primaryDark, fontWeight: '600', fontSize: typography.cardTitle.fontSize },
  label: { fontSize: typography.meta.fontSize, fontWeight: '700', color: colors.textSecondary, marginTop: spacing.lg, marginBottom: spacing.sm, textAlign: 'right' },
  input: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md, padding: 14, fontSize: typography.body.fontSize, color: colors.textPrimary },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  emojiChip: {
    width: 48,
    height: 48,
    borderRadius: radii.xl,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  emojiChipActive: { borderColor: colors.primary },
  emojiText: { fontSize: typography.screenTitle.fontSize },
  colorChip: { width: 36, height: 36, borderRadius: radii.lg, borderWidth: 2, borderColor: 'transparent' },
  colorChipActive: { borderColor: colors.textPrimary },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: 22 },
  flex: { flex: 1 },
});
