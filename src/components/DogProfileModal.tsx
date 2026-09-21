import React, { useState } from 'react';
import { Alert, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RtlText } from './RtlText';
import { WalkieMascot } from './WalkieMascot';
import { ConfirmModal } from './ConfirmModal';
import { useFamilyStore } from '../store/familyStore';
import { useAuthStore, useEffectiveFamilyRole } from '../store/authStore';
import { DEMO_FAMILY } from '../data/demoData';
import { pickAndUploadImage } from '../lib/uploadImage';
import { colors } from '../theme/colors';
import { breakpoints, radii, spacing, typography } from '../theme/tokens';

export function DogProfileModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const dog = useFamilyStore((s) => s.dog);
  const saveDog = useFamilyStore((s) => s.saveDog);
  const familyId = useAuthStore((s) => s.familyId) ?? DEMO_FAMILY.id;
  const familyRole = useEffectiveFamilyRole();
  const systemObserverActive = useAuthStore((s) => s.systemObserverActive);
  const [uploading, setUploading] = useState(false);
  const [removeConfirmVisible, setRemoveConfirmVisible] = useState(false);
  const [removing, setRemoving] = useState(false);

  const changePhoto = async () => {
    if (!dog || familyRole !== 'admin' || systemObserverActive) return;
    setUploading(true);
    try {
      const uri = await pickAndUploadImage('dogs', familyId, dog.id);
      if (uri) await saveDog({ ...dog, photoUrl: uri });
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
      await saveDog({ ...dog, photoUrl: undefined });
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
                {dog.photoUrl ? (
                  <Image
                    source={{ uri: dog.photoUrl }}
                    style={styles.photo}
                    resizeMode="cover"
                    accessibilityLabel={`תמונה של ${dog.name}`}
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
                {dog.photoUrl ? 'תמונה אישית' : 'תמונת הכלב אינה חובה — מוצג כלב Walkie Doggy כברירת מחדל'}
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
  photoWrap: { marginTop: spacing.md, width: 180, height: 180, alignItems: 'center', justifyContent: 'center' },
  photo: { width: 180, height: 180, borderRadius: 90, borderWidth: 3, borderColor: colors.surface },
  name: { ...typography.screenTitle, color: colors.textPrimary, textAlign: 'center' },
  hint: { ...typography.meta, color: colors.textSecondary, textAlign: 'center' },
  actions: { width: '100%', maxWidth: 420, gap: spacing.sm, marginTop: spacing.sm },
  primaryButton: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.primaryDark, alignItems: 'center' },
  primaryText: { ...typography.body, color: colors.surface, fontWeight: '800' },
  removeButton: { paddingVertical: spacing.sm, alignItems: 'center' },
  removeText: { ...typography.body, color: colors.statusOverdue, fontWeight: '700' },
  card: { width: '100%', maxWidth: 520, marginTop: spacing.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm },
  cardTitle: { ...typography.sectionTitle, color: colors.textPrimary, textAlign: 'right' },
  cardLine: { ...typography.body, color: colors.textPrimary, textAlign: 'right' },
});
