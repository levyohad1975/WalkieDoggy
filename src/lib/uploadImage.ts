import * as ImagePicker from 'expo-image-picker';
import { Alert, Linking } from 'react-native';
import { isSupabaseConfigured, supabase } from './supabase';
import { guardTestModeMutation } from './testModeGuard';

export type PhotoKind = 'dogs' | 'users';

/**
 * Opens the device photo library, and — if Supabase Storage is configured —
 * uploads the picked image to the `family-photos` bucket, returning a public
 * URL that syncs to every family member's device. Without Supabase
 * configured, returns the local file URI instead (demo mode: the photo only
 * shows up on this device, same as the rest of demo mode).
 *
 * `familyId` is required whenever Supabase is configured: the upload path is
 * `{familyId}/dog/...` or `{familyId}/users/{userId}/...`, and the Storage
 * RLS policies (supabase/migrations/0002_*.sql) check exactly that first
 * path segment against the caller's own family — a family that doesn't own
 * the folder can't upload/overwrite/delete into it.
 *
 * Returns `null` if the user cancels, permission is denied, or Admin Test
 * Mode is currently active (see guardTestModeMutation's doc comment) — this
 * is the ONE real Supabase Storage mutation that happens outside
 * scheduleStore/familyStore/requestsStore (it's called directly from
 * UserFormModal/SettingsScreen, before their later store.saveDog()/
 * updateUser() call), so it needs its own guard rather than relying on the
 * store call that happens afterwards. Checked FIRST, before even asking for
 * photo-library permission — no point opening a picker for an upload that
 * can never be saved.
 */
export async function pickAndUploadImage(kind: PhotoKind, familyId: string, id: string): Promise<string | null> {
  if (!guardTestModeMutation()) return null;

  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

  const hasPhotoAccess =
    permission.granted ||
    permission.accessPrivileges === 'all' ||
    permission.accessPrivileges === 'limited';

  if (!hasPhotoAccess) {
    if (!permission.canAskAgain) {
      Alert.alert(
        'נדרשת הרשאה לתמונות',
        'הגישה לתמונות חסומה בהגדרות המכשיר. אפשרו גישה לתמונות כדי לבחור תמונה.',
        [
          { text: 'ביטול', style: 'cancel' },
          {
            text: 'פתח הגדרות',
            onPress: () => {
              void Linking.openSettings();
            },
          },
        ],
      );
    } else {
      Alert.alert(
        'נדרשת הרשאה לתמונות',
        'אפשרו לאפליקציה גישה לספריית התמונות כדי לבחור תמונה.',
      );
    }

    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.7,
  });
  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0];

  if (isSupabaseConfigured && supabase) {
    const folder = kind === 'dogs' ? 'dog' : `users/${id}`;
    const path = `${familyId}/${folder}/${Date.now()}.jpg`;
    // SDK 57 / iOS does not guarantee ImagePicker base64 payloads. Read the
    // selected local URI as binary instead, which works for both iOS and
    // Android and avoids silently falling back to a device-only file URI.
    const response = await fetch(asset.uri);
    const bytes = await response.arrayBuffer();
    const contentType = asset.mimeType ?? 'image/jpeg';
    const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
    const finalPath = path.replace(/\.jpg$/, `.${extension}`);
    const { error } = await supabase.storage
      .from('family-photos')
      .upload(finalPath, bytes, { contentType, upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from('family-photos').getPublicUrl(finalPath);
    return data.publicUrl;
  }

  return asset.uri;
}
