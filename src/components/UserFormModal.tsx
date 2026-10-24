import React, { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
const USER_COLOR_LABELS: Record<string, string> = {
  '#5B8DEF': 'כחול',
  '#F2994A': 'כתום',
  '#27AE60': 'ירוק',
  '#BB6BD9': 'סגול',
  '#EB5757': 'אדום',
  '#2D9CDB': 'תכלת',
};

export function getUserColorLabel(color: string): string {
  return USER_COLOR_LABELS[color.toUpperCase()] ?? 'מותאם אישית';
}

interface UserFormModalProps {
  visible: boolean;
  editingUser: FamilyUser | null;
  /** Needed to build the Supabase Storage path ({familyId}/users/{userId}/...) — unused in local/demo mode. */
  familyId: string;
  onSave: (input: { name: string; avatar: string; color: string; photoUrl?: string }) => void | Promise<void>;
  onClose: () => void;
}

/** Add or edit a family member: name, emoji fallback, color, and a real photo from the gallery. */
export function UserFormModal({ visible, editingUser, familyId, onSave, onClose }: UserFormModalProps) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(EMOJI_OPTIONS[0]);
  const [color, setColor] = useState(userPalette[0]);
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [removingPhoto, setRemovingPhoto] = useState(false);
  const [pendingPhotoPick, setPendingPhotoPick] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveUserPhoto = useFamilyStore((s) => s.saveUserPhoto);
  // Keep latest values available while the hosted web cropper is open.
  // The upload effect must not restart/cancel just because the parent or form re-renders.
  const webPhotoSaveRef = useRef({ editingUser, name, avatar, color, onSave, onClose });
  webPhotoSaveRef.current = { editingUser, name, avatar, color, onSave, onClose };

  useEffect(() => {
    if (visible) {
      setSaveError(null);
      setSaving(false);
      setName(editingUser?.name ?? '');
      setAvatar(editingUser?.avatar ?? EMOJI_OPTIONS[0]);
      setColor(editingUser?.color ?? userPalette[0]);
      setPhotoUrl(editingUser?.photoUrl);
    }
  }, [visible, editingUser]);

  const submit = async () => {
    if (saving || !name.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({ name: name.trim(), avatar, color, photoUrl });
    } catch {
      setSaveError('לא הצלחנו לשמור את הפרטים. השינויים לא אושרו. בדקו את החיבור ונסו שוב.');
    } finally {
      setSaving(false);
    }
  };

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
    const latest = webPhotoSaveRef.current;
    void (latest.editingUser
      ? saveUserPhoto(latest.editingUser.id, familyId)
      : pickAndUploadImage('users', familyId, 'new'))
      .then((uri) => {
        if (!uri) return;
        setPhotoUrl(uri);
        if (latest.editingUser) {
          // saveUserPhoto() persists the uploaded image for refresh safety,
          // but it reads the currently stored member and therefore cannot
          // include draft name/avatar/color edits still open in this form.
          // Persist the complete latest draft before closing the hand-off.
          return Promise.resolve(latest.onSave({
            name: latest.name.trim(),
            avatar: latest.avatar,
            color: latest.color,
            photoUrl: uri,
          })).then(() => latest.onClose());
        }
      })
      .catch(() => {
        Alert.alert('לא הצלחנו להחליף תמונה', 'בדקו הרשאת תמונות וחיבור לאינטרנט ונסו שוב.');
      })
      .finally(() => {
        setUploading(false);
        setPendingPhotoPick(false);
      });
  }, [pendingPhotoPick, familyId, saveUserPhoto]);

  const removePhoto = async () => {
    if (!photoUrl || uploading || removingPhoto) return;
    setRemovingPhoto(true);
    try {
      // Existing members persist immediately, just like a photo replacement.
      // Passing undefined explicitly clears the stored photo_url.
      if (editingUser) {
        await onSave({ name: name.trim(), avatar, color, photoUrl: undefined });
      }
      setPhotoUrl(undefined);
    } catch {
      if (Platform.OS === 'web') window.alert('לא הצלחנו להסיר את התמונה. נסו שוב.');
      else Alert.alert('לא הצלחנו להסיר את התמונה', 'נסו שוב.');
    } finally {
      setRemovingPhoto(false);
    }
  };

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
          <Pressable
            testID="user-form-sheet"
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
            onPress={(e) => e.stopPropagation()}
          >
            <ScrollView keyboardShouldPersistTaps="handled">
              <RtlText style={styles.title} accessibilityRole="header">{editingUser ? 'עריכת בן משפחה' : 'הוספת בן משפחה'}</RtlText>

            <View style={styles.photoSection}>
              <Avatar emoji={avatar} color={color} photoUrl={photoUrl} size={68} />
              <View testID="user-form-photo-actions" style={styles.photoActions}>
                <Pressable
                  onPress={pickPhoto}
                  disabled={uploading || removingPhoto}
                  style={styles.photoButton}
                  accessibilityRole="button"
                  accessibilityLabel={photoUrl ? 'החלפת תמונה' : 'הוספת תמונה מהגלריה'}
                >
                  <RtlText style={styles.photoLink}>{uploading ? 'מעלה תמונה...' : photoUrl ? 'החלף תמונה' : 'הוסף תמונה מהגלריה'}</RtlText>
                </Pressable>
                {photoUrl ? (
                  <Pressable
                    onPress={() => void removePhoto()}
                    disabled={uploading || removingPhoto}
                    style={styles.photoButton}
                    accessibilityRole="button"
                    accessibilityLabel="הסר תמונה וחזור לסמל ברירת המחדל"
                  >
                    <RtlText style={styles.photoLink}>{removingPhoto ? 'מסיר תמונה...' : 'הסר תמונה'}</RtlText>
                  </Pressable>
                ) : null}
              </View>
            </View>

            <RtlText style={styles.label}>שם</RtlText>
            <TextInput
              value={name}
              onChangeText={setName}
              style={styles.input}
              placeholder="שם"
              keyboardType="default"
              autoCorrect={false}
              autoCapitalize="words"
              textAlign="right"
              accessibilityLabel="שם"
            />

            <RtlText style={styles.label}>דמות חלופית (תוצג כשאין תמונה)</RtlText>
            <View testID="user-form-avatar-grid" style={styles.avatarGrid}>
              {EMOJI_OPTIONS.map((e) => (
                <Pressable
                  key={e}
                  onPress={() => setAvatar(e)}
                  testID="user-form-avatar-option"
                  style={[styles.emojiChip, avatar === e && styles.emojiChipActive]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: avatar === e }}
                  accessibilityLabel={`סמל ${e}`}
                >
                  <RtlText style={styles.emojiText}>{e}</RtlText>
                  {avatar === e ? (
                    <View pointerEvents="none" accessible={false} style={styles.emojiSelectedMark}>
                      <RtlText style={styles.emojiSelectedMarkText}>✓</RtlText>
                    </View>
                  ) : null}
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
                  accessibilityLabel={`צבע ${getUserColorLabel(c)}`}
                >
                  {color === c ? (
                    <View pointerEvents="none" accessible={false} style={styles.colorSelectedMark}>
                      <RtlText style={styles.colorSelectedMarkText}>✓</RtlText>
                    </View>
                  ) : null}
                </Pressable>
              ))}
            </View>

            {saveError ? <RtlText style={styles.saveError} accessibilityRole="alert" accessibilityLiveRegion="polite">{saveError}</RtlText> : null}

            <View testID="user-form-actions" style={styles.actions}>
              <Button
                label="ביטול"
                onPress={onClose}
                variant="secondary"
                style={styles.flex}
                accessibilityLabel="ביטול עריכת בן משפחה"
              />
              <Button
                label={saving ? 'שומר…' : 'שמירה'}
                disabled={!name.trim() || saving}
                loading={saving}
                onPress={() => void submit()}
                style={styles.flex}
                accessibilityLabel="שמירת פרטי בן משפחה"
              />
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
  sheet: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 560,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: 20,
    paddingTop: 18,
    maxHeight: '92%',
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: 10 },
  photoSection: { alignItems: 'center', gap: 8, marginBottom: 4 },
  photoActions: { flexDirection: 'row', direction: 'rtl', gap: spacing.sm, width: '100%', maxWidth: 360 },
  photoButton: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: spacing.sm,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
  },
  photoLink: { color: colors.primaryDark, fontWeight: '600', fontSize: typography.cardTitle.fontSize },
  label: { fontSize: typography.meta.fontSize, fontWeight: '700', color: colors.textPrimary, marginTop: 12, marginBottom: 6, textAlign: 'right' },
  saveError: { color: colors.danger, textAlign: 'right', marginTop: spacing.md, lineHeight: 20 },
  input: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md, padding: 12, fontSize: typography.body.fontSize, color: colors.textPrimary },
  avatarGrid: { flexDirection: 'row', direction: 'rtl', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  emojiChip: {
    position: 'relative',
    width: '22%',
    maxWidth: 64,
    minWidth: 44,
    aspectRatio: 1,
    borderRadius: radii.xl,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  emojiChipActive: { borderColor: colors.primary },
  emojiText: { fontSize: typography.screenTitle.fontSize },
  emojiSelectedMark: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 18,
    height: 18,
    borderRadius: radii.round,
    backgroundColor: colors.primaryDark,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiSelectedMarkText: { color: colors.textInverse, fontSize: 10, lineHeight: 12, fontWeight: '800' },
  colorChip: { width: 44, height: 44, borderRadius: radii.round, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  colorChipActive: { borderColor: colors.textPrimary },
  colorSelectedMark: {
    width: 22,
    height: 22,
    borderRadius: radii.round,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorSelectedMarkText: { color: colors.textPrimary, fontSize: 14, lineHeight: 17, fontWeight: '800' },
  actions: { flexDirection: 'row', direction: 'rtl', gap: spacing.md, marginTop: 16 },
  flex: { flex: 1 },
});
