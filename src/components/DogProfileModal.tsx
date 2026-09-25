import React, { useEffect, useState } from 'react';
import { Alert, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RtlText } from './RtlText';
import { WalkieMascot } from './WalkieMascot';
import { ConfirmModal } from './ConfirmModal';
import { useFamilyStore } from '../store/familyStore';
import { useAuthStore, useEffectiveFamilyRole } from '../store/authStore';
import { DEMO_FAMILY } from '../data/demoData';
import { pickAndUploadImage } from '../lib/uploadImage';
import { requestDogPhotoCutout } from '../lib/backgroundRemoval';
import { isSupabaseConfigured } from '../lib/supabase';
import { colors } from '../theme/colors';
import { breakpoints, radii, spacing, typography } from '../theme/tokens';
import { DOG_BACKGROUNDS, getDogBackground } from '../theme/dogBackgrounds';

export function DogProfileModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const dog = useFamilyStore((s) => s.dog);
  const saveDog = useFamilyStore((s) => s.saveDog);
  const familyId = useAuthStore((s) => s.familyId) ?? DEMO_FAMILY.id;
  const familyRole = useEffectiveFamilyRole();
  const systemObserverActive = useAuthStore((s) => s.systemObserverActive);
  const [uploading, setUploading] = useState(false);
  const [removeConfirmVisible, setRemoveConfirmVisible] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [photoLoadFailed, setPhotoLoadFailed] = useState(false);
  const [backgroundPickerVisible, setBackgroundPickerVisible] = useState(false);
  const [selectedBackground, setSelectedBackground] = useState<string | undefined>(undefined);

  useEffect(() => {
    setPhotoLoadFailed(false);
    setSelectedBackground(dog?.heroBackgroundId);
  }, [dog?.id, dog?.photoUrl, dog?.heroBackgroundId]);

  const changePhoto = async () => {
    if (!dog || familyRole !== 'admin' || systemObserverActive) return;
    setUploading(true);
    try {
      const uri = await pickAndUploadImage('dogs', familyId, dog.id);
      if (!uri) return;
      // Persist the new photo first and invalidate the old cutout. A cutout
      // belongs to a specific source image and must never survive a change.
      const updatedDog = { ...dog, photoUrl: uri, photoCutoutUrl: undefined };
      await saveDog(updatedDog);
      if (isSupabaseConfigured) {
        const cutoutUrl = await requestDogPhotoCutout(uri);
        if (cutoutUrl) await saveDog({ ...updatedDog, photoCutoutUrl: cutoutUrl });
      }
    } catch {
      Alert.alert('לא הצלחנו לשמור את התמונה', 'בדקו הרשאת תמונות וחיבור לאינטרנט ונסו שוב.');
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = () => {
    if (!dog || !dog.photoUrl || familyRole !== 'admin' || systemObserverActive) return;
    setRemoveConfirmVisible(true);
  };

  const confirmRemovePhoto = async () => {
    if (!dog || !dog.photoUrl || familyRole !== 'admin' || systemObserverActive || removing) return;
    setRemoving(true);
    try {
      await saveDog({ ...dog, photoUrl: undefined, photoCutoutUrl: undefined });
      setRemoveConfirmVisible(false);
    } catch {
      Alert.alert('לא הצלחנו להסיר את התמונה', 'נסו שוב בעוד רגע.');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.topBar}>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="סגירת פרופיל הכלב">
            <RtlText style={styles.close}>סגירה</RtlText>
          </Pressable>
          <RtlText style={styles.title} accessibilityRole="header">פרופיל הכלב</RtlText>
        </View>
        <ScrollView contentContainerStyle={[styles.content, Platform.OS === 'web' && styles.webContent]}>
          {dog ? (
            <>
              <View style={styles.photoWrap}>
                  {getDogBackground(selectedBackground) ? (
                    <Image source={{ uri: getDogBackground(selectedBackground)!.uri }} style={styles.previewBackground} resizeMode="cover" />
                  ) : null}
                {(dog.photoCutoutUrl || dog.photoUrl) && !photoLoadFailed ? (
                  <Image
                    source={{ uri: dog.photoCutoutUrl || dog.photoUrl }}
                    style={[styles.photo, dog.photoCutoutUrl ? styles.photoCutout : styles.photoScene]}
                    resizeMode={dog.photoCutoutUrl ? "contain" : "cover"}
                    accessibilityLabel={`תמונה של ${dog.name}`}
                    onError={() => setPhotoLoadFailed(true)}
                  />
                ) : (
                  <WalkieMascot
                    state="idle"
                    size={180}
                    accessibilityLabel="הכלב המונפש של Walkie Doggy"
                  />
                )}
              </View>
              <RtlText style={styles.name}>{dog.name}</RtlText>
              <RtlText style={styles.hint}>
                {(dog.photoCutoutUrl || dog.photoUrl) && !photoLoadFailed ? 'תמונה אישית' : 'תמונת הכלב אינה חובה — מוצג כלב Walkie Doggy כברירת מחדל'}
              </RtlText>
              {familyRole === 'admin' && !systemObserverActive ? (
                <View style={styles.actions}>
                  <Pressable onPress={changePhoto} disabled={uploading || removing} style={styles.primaryButton} accessibilityRole="button">
                    <RtlText style={styles.primaryText}>{uploading ? 'מעלה…' : dog.photoUrl ? 'החלפת תמונה' : 'הוספת תמונה'}</RtlText>
                  </Pressable>
                  {dog.photoUrl ? (
                    <Pressable onPress={removePhoto} disabled={uploading || removing} style={styles.removeButton} accessibilityRole="button">
                      <RtlText style={styles.removeText}>הסרת תמונה</RtlText>
                    </Pressable>
                  ) : null}
                  <Pressable onPress={() => setBackgroundPickerVisible((v) => !v)} style={styles.backgroundButton} accessibilityRole="button">
                    <RtlText style={styles.backgroundButtonText}>🎨 בחירת רקע לתמונת הכלב</RtlText>
                  </Pressable>
                  {backgroundPickerVisible ? (
                    <View style={styles.backgroundPicker}>
                      <RtlText style={styles.backgroundTitle}>בחרו רקע</RtlText>
                      <View style={styles.backgroundGrid}>
                        {DOG_BACKGROUNDS.map((item) => (
                          <Pressable
                            key={item.id}
                            onPress={() => {
                              if (!dog) return;
                              setSelectedBackground(item.id);
                              void saveDog({ ...dog, heroBackgroundId: item.id });
                            }}
                            style={[styles.backgroundTile, selectedBackground === item.id && styles.backgroundSelected]}
                            accessibilityRole="button"
                            accessibilityLabel={`בחירת רקע ${item.label}`}
                          >
                            <Image source={{ uri: item.uri }} style={styles.backgroundThumb} resizeMode="cover" />
                            <View style={styles.backgroundLabelWrap}>
                              <RtlText style={styles.backgroundLabel}>{item.label}</RtlText>
                            </View>
                            {selectedBackground === item.id ? <View style={styles.backgroundCheckBadge}><RtlText style={styles.backgroundCheck}>✓</RtlText></View> : null}
                          </Pressable>
                        ))}
                      </View>
                      <RtlText style={styles.backgroundHint}>הבחירה נשמרת למשפחה ומופיעה במסך הבית. אפשר להחליף בכל עת.</RtlText>
                    </View>
                  ) : null}
                </View>
              ) : null}
              <View style={styles.card}>
                <RtlText style={styles.cardTitle}>פרטי הכלב</RtlText>
                <RtlText style={styles.cardLine}>שם: {dog.name}</RtlText>
                {dog.sex ? <RtlText style={styles.cardLine}>מין: {dog.sex === 'male' ? 'זכר' : 'נקבה'}</RtlText> : null}
                {dog.notes ? <RtlText style={styles.cardLine}>הערות: {dog.notes}</RtlText> : null}
              </View>
            </>
          ) : (
            <RtlText style={styles.hint}>עדיין לא הוגדר פרופיל כלב למשפחה.</RtlText>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
    <ConfirmModal
      visible={removeConfirmVisible}
      title="הסרת תמונת הכלב"
      message="להסיר את התמונה ולחזור לכלב של Walkie Doggy?"
      confirmLabel="הסרה"
      cancelLabel="ביטול"
      onConfirm={() => void confirmRemovePhoto()}
      onCancel={() => !removing && setRemoveConfirmVisible(false)}
      loading={removing}
    />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: { minHeight: 64, paddingHorizontal: spacing.xl, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  close: { ...typography.body, color: colors.primaryDark, fontWeight: '800' },
  title: { ...typography.screenTitle, color: colors.textPrimary, textAlign: 'right' },
  content: { padding: spacing.xl, gap: spacing.md, alignItems: 'center', paddingBottom: spacing.xxxl },
  webContent: { maxWidth: breakpoints.desktopContent, alignSelf: 'center', width: '100%' },
  photoWrap: { marginTop: spacing.md, width: 280, height: 210, borderRadius: radii.xl, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted },
  previewBackground: { ...StyleSheet.absoluteFill, width: undefined, height: undefined },
  // The uploaded photo is shown as the complete preview scene. No secondary
  // background or visible frame is composited behind it.
  photo: { width: '100%', height: 210, borderRadius: 24, borderWidth: 0 },
  photoCutout: { position: 'absolute', zIndex: 2 },
  photoScene: { position: 'absolute', zIndex: 2 },
  name: { ...typography.screenTitle, color: colors.textPrimary, textAlign: 'center' },
  hint: { ...typography.meta, color: colors.textSecondary, textAlign: 'center' },
  actions: { width: '100%', maxWidth: 420, gap: spacing.sm, marginTop: spacing.sm },
  primaryButton: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.primaryDark, alignItems: 'center' },
  primaryText: { ...typography.body, color: colors.surface, fontWeight: '800' },
  backgroundButton: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.primaryDark, alignItems: 'center', backgroundColor: colors.surface },
  backgroundButtonText: { ...typography.body, color: colors.primaryDark, fontWeight: '800' },
  backgroundPicker: { width: '100%', padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  backgroundTitle: { ...typography.sectionTitle, color: colors.textPrimary, textAlign: 'right' },
  backgroundGrid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'space-between' },
  backgroundTile: { width: '48%', height: 100, borderRadius: radii.md, overflow: 'hidden', borderWidth: 3, borderColor: 'transparent', position: 'relative' },
  backgroundThumb: { ...StyleSheet.absoluteFill, width: undefined, height: undefined },
  backgroundSelected: { borderColor: colors.primaryDark },
  backgroundLabelWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#00000088', paddingVertical: 5, paddingHorizontal: 8 },
  backgroundLabel: { color: '#fff', fontSize: 13, fontWeight: '800', textAlign: 'center' },
  backgroundCheckBadge: { position: 'absolute', top: 6, right: 6, width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center' },
  backgroundCheck: { fontSize: 18, fontWeight: '900', color: '#fff' },
  backgroundHint: { ...typography.meta, color: colors.textSecondary, textAlign: 'center' },
  removeButton: { paddingVertical: spacing.sm, alignItems: 'center' },
  removeText: { ...typography.body, color: colors.statusOverdue, fontWeight: '700' },
  card: { width: '100%', maxWidth: 520, marginTop: spacing.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  cardTitle: { ...typography.sectionTitle, color: colors.textPrimary, textAlign: 'right' },
  cardLine: { ...typography.body, color: colors.textPrimary, textAlign: 'right' },
});
