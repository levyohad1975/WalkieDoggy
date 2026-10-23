import React, { useEffect, useRef, useState } from 'react';
import { Alert, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RtlText } from './RtlText';
import { WalkieMascot } from './WalkieMascot';
import { useFamilyStore } from '../store/familyStore';
import { useAuthStore, useEffectiveFamilyRole } from '../store/authStore';
import { DEMO_FAMILY } from '../data/demoData';
import { pickAndUploadImage } from '../lib/uploadImage';
import { describeDogCutoutJob, runDogCutoutJob, type DogCutoutFeedback } from '../lib/dogCutoutJob';
import { useCutoutVerdict } from '../lib/cutoutVerification';
import { colors } from '../theme/colors';
import { breakpoints, radii, spacing, typography } from '../theme/tokens';
import { DEFAULT_DOG_BACKGROUND, getDogBackground, getDogBackgroundImageSource } from '../theme/dogBackgrounds';
import { DogHeroBackgroundPicker } from './DogHeroBackgroundPicker';
import { Button } from './Button';
import { getCurrentReliableGpsFix } from '../lib/gpsTracking';
import { GPS_CURRENT_FIX_MAX_ACCURACY_METERS } from '../logic/gpsReconstruction';

export function DogProfileModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const dog = useFamilyStore((s) => s.dog);
  const saveDog = useFamilyStore((s) => s.saveDog);
  const loadFamily = useFamilyStore((s) => s.load);
  const clearDogPhoto = useFamilyStore((s) => s.removeDogPhoto);
  const familyId = useAuthStore((s) => s.familyId) ?? DEMO_FAMILY.id;
  const familyRole = useEffectiveFamilyRole();
  const systemObserverActive = useAuthStore((s) => s.systemObserverActive);
  const currentUserId = useAuthStore((s) => s.currentUserId);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [savingHomeLocation, setSavingHomeLocation] = useState(false);
  const [processingCutout, setProcessingCutout] = useState(false);
  const [photoLoadFailed, setPhotoLoadFailed] = useState(false);
  const [pendingPhotoUrl, setPendingPhotoUrl] = useState<string | null>(null);
  const [cutoutPreviewUrl, setCutoutPreviewUrl] = useState<string | null>(null);
  // An existing cutout without real transparency is treated like a missing
  // one: Home hides it, and the admin is offered background removal again.
  const cutoutVerdict = useCutoutVerdict(dog?.photoCutoutUrl);
  const previewVerdict = useCutoutVerdict(cutoutPreviewUrl);
  const [cutoutFeedback, setCutoutFeedback] = useState<DogCutoutFeedback | null>(null);
  // Guards the job synchronously: a fast double tap fires before the
  // `processingCutout` re-render disables the button.
  const cutoutJobInFlight = useRef(false);

  useEffect(() => {
    setPhotoLoadFailed(false);
    setPendingPhotoUrl(null);
    setCutoutPreviewUrl(null);
    setCutoutFeedback(null);
  }, [dog?.id, dog?.photoUrl]);

  const changePhoto = async () => {
    if (!dog || familyRole !== 'admin' || systemObserverActive) return;
    setUploading(true);
    try {
      const uri = await pickAndUploadImage('dogs', familyId, dog.id, setPendingPhotoUrl);
      if (uri) setPendingPhotoUrl(uri);
    } catch {
      setPendingPhotoUrl(null);
      Alert.alert('לא הצלחנו לשמור את התמונה', 'בדקו תמיכת דפדפן, הרשאת תמונות וחיבור לאינטרנט ונסו שוב.');
    } finally {
      setUploading(false);
    }
  };

  const requestDogCutout = async (dogId: string) => {
    if (cutoutJobInFlight.current) return;
    cutoutJobInFlight.current = true;
    setProcessingCutout(true);
    setCutoutFeedback(null);
    try {
      const result = await runDogCutoutJob(dogId);
      if (result.status === 'failed') {
        console.warn('Dog cutout generation failed; keeping source photo fallback:', result.error);
      } else {
        setCutoutPreviewUrl(result.cutoutUrl);
        await loadFamily(familyId).catch(() => {});
      }
      const feedback = describeDogCutoutJob(result);
      setCutoutFeedback(feedback);
      Alert.alert(feedback.title, feedback.message);
    } finally {
      cutoutJobInFlight.current = false;
      setProcessingCutout(false);
    }
  };

  const confirmRemovePhoto = async () => {
    if (!dog || !dog.photoUrl || familyRole !== 'admin' || systemObserverActive || removing) return;
    setRemoving(true);
    try {
      // Removal is an explicit destructive action: persist it immediately.
      // Do not leave the user in a hidden draft state that requires a second
      // "save photo" tap and makes the old photo reappear after refresh.
      await clearDogPhoto(dog.id);
      setPendingPhotoUrl(null);
      setPhotoLoadFailed(false);
    } catch {
      Alert.alert('לא הצלחנו להסיר את התמונה', 'בדקו את החיבור ונסו שוב.');
    } finally {
      setRemoving(false);
    }
  };

  const displayedPhotoUrl = pendingPhotoUrl === null ? dog?.photoUrl : (pendingPhotoUrl || undefined);
  const photoDirty = pendingPhotoUrl !== null;
  const savePhoto = async () => {
    if (!dog || !photoDirty || removing || uploading) return;
    const photoUrlToProcess = pendingPhotoUrl || undefined;
    setRemoving(true);
    try {
      if (photoUrlToProcess) await saveDog({ ...dog, photoUrl: photoUrlToProcess, photoCutoutUrl: undefined });
      else await clearDogPhoto(dog.id);
      setPendingPhotoUrl(null);
      setPhotoLoadFailed(false);
      if (photoUrlToProcess) {
        // Keep the persisted source and prepare its transparent derivative
        // without delaying the user's photo-save action.
        void requestDogCutout(dog.id);
      }
    } catch {
      Alert.alert('לא הצלחנו לשמור את התמונה', 'נסו שוב בעוד רגע.');
    } finally {
      setRemoving(false);
    }
  };

  const verifyHomeLocation = async () => {
    if (!dog || !currentUserId || familyRole !== 'admin' || systemObserverActive || savingHomeLocation) return;
    setSavingHomeLocation(true);
    try {
      const fix = await getCurrentReliableGpsFix();
      if (fix.accuracy == null || fix.accuracy > GPS_CURRENT_FIX_MAX_ACCURACY_METERS) {
        Alert.alert('המיקום אינו מדויק מספיק', 'נסו שוב במקום פתוח. נדרש דיוק של עד 25 מטרים.');
        return;
      }
      await saveDog({
        ...dog,
        homeLocation: {
          latitude: fix.latitude,
          longitude: fix.longitude,
          accuracyMeters: fix.accuracy,
          verifiedAt: new Date().toISOString(),
          verifiedByUserId: currentUserId,
        },
      });
      Alert.alert('מיקום הבית נשמר', 'הנקודה נשמרה למכשירי המשפחה ותשמש רק כנקודת ייחוס למסלולים.');
    } catch (error) {
      Alert.alert('לא הצלחנו לשמור מיקום בית', error instanceof Error && /permission/i.test(error.message) ? 'יש לאפשר גישה למיקום ולנסות שוב.' : 'בדקו את חיבור המיקום והאינטרנט ונסו שוב.');
    } finally {
      setSavingHomeLocation(false);
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
                  {getDogBackground(dog.heroBackgroundId) && !dog.photoUrl ? (
                    <Image source={getDogBackgroundImageSource(getDogBackground(dog.heroBackgroundId)!)} style={styles.previewBackground} resizeMode="cover" />
                  ) : null}
                {displayedPhotoUrl && !photoLoadFailed ? (
                  <Image
                    source={{ uri: displayedPhotoUrl }}
                    style={styles.photo}
                    resizeMode="cover"
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
                {displayedPhotoUrl && !photoLoadFailed ? 'תמונה אישית' : 'תמונת הכלב אינה חובה — מוצג כלב Walkie Doggy כברירת מחדל'}
              </RtlText>
              {processingCutout ? <RtlText style={styles.hint}>התמונה נשמרה; מסירים את הרקע…</RtlText> : null}
              {!processingCutout && cutoutFeedback ? (
                <RtlText
                  style={[styles.hint, cutoutFeedback.tone === 'error' && styles.cutoutError]}
                  accessibilityLiveRegion="polite"
                >
                  {cutoutFeedback.title}: {cutoutFeedback.message}
                </RtlText>
              ) : null}
              {!processingCutout && !cutoutFeedback && dog.photoCutoutUrl && cutoutVerdict === 'opaque' ? (
                <RtlText style={styles.hint}>הרקע לא הוסר מהתמונה, ולכן במסך הבית מוצג כרגע הקמע.</RtlText>
              ) : null}
              {cutoutPreviewUrl && previewVerdict === 'transparent' ? (
                <View style={styles.cutoutPreview} accessibilityLabel="תצוגה מקדימה של הכלב על הרקע שנבחר">
                  <Image
                    source={getDogBackgroundImageSource(getDogBackground(dog.heroBackgroundId) ?? DEFAULT_DOG_BACKGROUND)}
                    style={styles.cutoutPreviewBackground}
                    resizeMode="cover"
                  />
                  <Image
                    source={{ uri: cutoutPreviewUrl }}
                    style={styles.cutoutPreviewDog}
                    resizeMode="contain"
                  />
                  <View style={styles.cutoutPreviewCaption}>
                    <RtlText style={styles.cutoutPreviewCaptionText}>תצוגה מקדימה על הרקע שנבחר</RtlText>
                  </View>
                </View>
              ) : null}
              {familyRole === 'admin' && !systemObserverActive ? (
                <View style={styles.actions}>
                  <Pressable onPress={changePhoto} disabled={uploading || removing} style={styles.primaryButton} accessibilityRole="button">
                    <RtlText style={styles.primaryText}>{uploading ? 'מעלה…' : displayedPhotoUrl ? 'החלפת תמונה' : 'הוספת תמונה'}</RtlText>
                  </Pressable>
                  {displayedPhotoUrl ? (
                    <Pressable onPress={() => void confirmRemovePhoto()} disabled={uploading || removing} style={styles.removeButton} accessibilityRole="button">
                      <RtlText style={styles.removeText}>הסרת תמונה</RtlText>
                    </Pressable>
                  ) : null}
                  {photoDirty ? <Button label={removing ? 'שומר…' : 'שמור תמונה'} onPress={() => void savePhoto()} disabled={removing || uploading} /> : null}
                  {/* Always offered while a saved source photo exists — also when a
                      cutout is already stored — so the family can explicitly
                      reprocess. Hidden only while an unsaved replacement is
                      pending (saving it starts processing automatically). */}
                  {dog.photoUrl && !photoDirty ? (
                    <Pressable
                      onPress={() => void requestDogCutout(dog.id)}
                      disabled={processingCutout || uploading || removing}
                      style={[styles.removeButton, processingCutout && styles.buttonBusy]}
                      accessibilityRole="button"
                      accessibilityLabel={dog.photoCutoutUrl ? 'שפר חיתוך רקע' : 'הסרת רקע מהתמונה'}
                      accessibilityState={{ disabled: processingCutout || uploading || removing, busy: processingCutout }}
                    >
                      <RtlText style={styles.removeText}>{processingCutout ? 'משפרים את חיתוך הרקע…' : dog.photoCutoutUrl ? 'שפר חיתוך רקע' : 'הסרת רקע מהתמונה'}</RtlText>
                    </Pressable>
                  ) : null}
                  <DogHeroBackgroundPicker dog={dog} onSave={(patch) => saveDog({ ...dog, ...patch })} />
                  <View style={styles.card}>
                    <RtlText style={styles.cardTitle}>מיקום הבית למסלולי GPS</RtlText>
                    <RtlText style={styles.backgroundHint}>
                      {dog.homeLocation ? 'מיקום הבית מאומת. הנקודה המדויקת משותפת רק לבני המשפחה.' : 'סמנו מיקום זה רק כשאתם נמצאים בבית. בלי אימות, לא ננחש את נקודת הבית.'}
                    </RtlText>
                    <Button label={savingHomeLocation ? 'בודקים ושומרים…' : dog.homeLocation ? 'עדכון מיקום הבית' : 'אימות מיקום הבית'} onPress={() => void verifyHomeLocation()} disabled={savingHomeLocation} />
                  </View>
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
  cutoutPreview: { width: '100%', maxWidth: 420, height: 220, borderRadius: radii.xl, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted },
  cutoutPreviewBackground: { ...StyleSheet.absoluteFill, width: undefined, height: undefined },
  cutoutPreviewDog: { width: 190, height: 184, position: 'absolute', right: 16, bottom: 26 },
  cutoutPreviewCaption: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFFD9' },
  cutoutPreviewCaptionText: { ...typography.meta, color: colors.textPrimary, fontWeight: '700' },
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
  buttonBusy: { opacity: 0.6 },
  cutoutError: { color: colors.statusOverdue },
  removeText: { ...typography.body, color: colors.statusOverdue, fontWeight: '700' },
  card: { width: '100%', maxWidth: 520, marginTop: spacing.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  cardTitle: { ...typography.sectionTitle, color: colors.textPrimary, textAlign: 'right' },
  cardLine: { ...typography.body, color: colors.textPrimary, textAlign: 'right' },
});
