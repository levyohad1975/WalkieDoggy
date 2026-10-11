import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RtlText } from '../components/RtlText';
import { WalkieMascot } from '../components/WalkieMascot';
import { DogPhoto } from '../components/DogPhoto';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { TimePickerField } from '../components/TimePickerField';
import { UserFormModal } from '../components/UserFormModal';
import { FamilySharingModal } from '../components/FamilySharingModal';
import { useAuthStore } from '../store/authStore';
import { useFamilyStore } from '../store/familyStore';
import { useScheduleStore } from '../store/scheduleStore';
import { colors, userPalette } from '../theme/colors';
import { breakpoints, radii, spacing, typography } from '../theme/tokens';
import { pickAndUploadImage, takeAndUploadImage } from '../lib/uploadImage';
import { generateId } from '../lib/id';
import { localDateOnly } from '../logic/dateFormat';
import { copyToClipboard } from '../lib/clipboard';
import { buildJoinLinkText } from '../logic/familyJoinCode';
import { regenerateInviteCode } from '../lib/supabase';
import { type FamilySetupProgress, saveFamilySetupProgress } from '../lib/familySetupProgress';
import type { Dog, FamilyUser, ScheduleRule } from '../types';

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const SUGGESTED_TIMES = [
  { time: '08:00', label: 'טיול בוקר' },
  { time: '14:00', label: 'טיול צהריים' },
  { time: '20:00', label: 'טיול ערב' },
];

interface FamilySetupWizardProps {
  familyId: string;
  progress: FamilySetupProgress;
  onProgressChange: (next: FamilySetupProgress) => void;
  onComplete: () => Promise<void>;
}

export function FamilySetupWizard({ familyId, progress, onProgressChange, onComplete }: FamilySetupWizardProps) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 900;
  const family = useFamilyStore((s) => s.family);
  const dog = useFamilyStore((s) => s.dog);
  const dogs = useFamilyStore((s) => s.dogs);
  const users = useFamilyStore((s) => s.users);
  const familyLoading = useFamilyStore((s) => s.loading);
  const familyError = useFamilyStore((s) => s.error);
  const loadFamily = useFamilyStore((s) => s.load);
  const saveDog = useFamilyStore((s) => s.saveDog);
  const removeDogPhoto = useFamilyStore((s) => s.removeDogPhoto);
  const addUser = useFamilyStore((s) => s.addUser);
  const updateUser = useFamilyStore((s) => s.updateUser);
  const selectDog = useFamilyStore((s) => s.selectDog);
  const currentUserId = useAuthStore((s) => s.currentUserId);
  const familyRole = useAuthStore((s) => s.familyRole);
  const signIn = useAuthStore((s) => s.signIn);
  const rules = useScheduleStore((s) => s.rules);
  const scheduleError = useScheduleStore((s) => s.error);
  const loadSchedule = useScheduleStore((s) => s.load);
  const addRule = useScheduleStore((s) => s.addRule);
  const deleteRule = useScheduleStore((s) => s.deleteRule);
  const [step, setStep] = useState<FamilySetupProgress['step']>(progress.step);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const [initializing, setInitializing] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [dogName, setDogName] = useState('');
  const [dogSex, setDogSex] = useState<Dog['sex']>(progress.pendingDogSex);
  const [pendingDogPhotoUrl, setPendingDogPhotoUrl] = useState(progress.pendingDogPhotoUrl);
  const [selectedDogPhotoPreviewUrl, setSelectedDogPhotoPreviewUrl] = useState<string | undefined>();
  const dogIdRef = useRef<string>(generateId('dog'));
  const [additionalDogName, setAdditionalDogName] = useState('');
  const [adminName, setAdminName] = useState(progress.adminName ?? '');
  const [memberFormVisible, setMemberFormVisible] = useState(false);
  const [sharingVisible, setSharingVisible] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | undefined>(undefined);
  const [regeneratingInvite, setRegeneratingInvite] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<'idle' | 'success' | 'error'>('idle');
  const [newTime, setNewTime] = useState('08:00');
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [responsibleUserId, setResponsibleUserId] = useState(progress.adminUserId ?? '');

  const activeUsers = useMemo(() => users.filter((user) => !user.removedAt), [users]);
  const dogRules = useMemo(() => rules.filter((rule) => rule.dogId === dog?.id && rule.active).sort((a, b) => a.time.localeCompare(b.time)), [rules, dog?.id]);
  const usersById = useMemo(() => Object.fromEntries(activeUsers.map((user) => [user.id, user])), [activeUsers]);
  const showAction = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'לא הצלחנו לשמור את השינוי. בדקו את החיבור ונסו שוב.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const refreshData = async () => {
    setInitializing(true);
    setError(null);
    await Promise.all([loadFamily(familyId), loadSchedule(familyId)]);
    setInitializing(false);
  };

  useEffect(() => {
    let mounted = true;
    Promise.all([loadFamily(familyId), loadSchedule(familyId)]).finally(() => {
      if (mounted) setInitializing(false);
    });
    return () => { mounted = false; };
  }, [familyId, loadFamily, loadSchedule]);

  useEffect(() => {
    if (dog) {
      dogIdRef.current = dog.id;
      setDogName(dog.name);
      setDogSex(dog.sex ?? progress.pendingDogSex);
    }
  }, [dog?.id]);

  useEffect(() => {
    if (family?.inviteCode) setInviteCode(family.inviteCode);
  }, [family?.inviteCode]);

  useEffect(() => {
    if (!currentUserId && progress.adminUserId && activeUsers.some((user) => user.id === progress.adminUserId)) {
      void signIn(progress.adminUserId).catch((cause) => setError(cause instanceof Error ? cause.message : 'לא הצלחנו להתחבר לפרופיל המנהל.'));
    }
  }, [currentUserId, progress.adminUserId, activeUsers, signIn]);

  const persistStep = async (nextStep: FamilySetupProgress['step'], patch: Partial<FamilySetupProgress> = {}) => {
    const next = { ...progressRef.current, ...patch, familyId, step: nextStep };
    await saveFamilySetupProgress(next);
    progressRef.current = next;
    onProgressChange(next);
    setStep(nextStep);
  };

  const savePrimaryDog = async (name: string, photoUrl?: string, sex: Dog['sex'] = dog?.sex ?? dogSex) => {
    const savedDog: Dog = dog
      ? { ...dog, name, ...(sex ? { sex } : {}), ...(photoUrl !== undefined ? { photoUrl, photoCutoutUrl: undefined } : {}) }
      : { id: dogIdRef.current, familyId, name, walksPerDay: 0, ...(sex ? { sex } : {}), ...(photoUrl ? { photoUrl } : {}) };
    await saveDog(savedDog);
    if (!dog) await selectDog(savedDog.id);
  };

  const pickDogPhoto = async (camera = false) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const currentName = dogName.trim();
      // Start the Web gallery picker before any awaited persistence call so
      // Safari still has the tap's transient user activation. Saving the typed
      // name concurrently keeps it durable even if the picker is canceled.
      const photoPromise = camera
        ? takeAndUploadImage('dogs', familyId, dogIdRef.current)
        : pickAndUploadImage('dogs', familyId, dogIdRef.current, (uri) => setSelectedDogPhotoPreviewUrl(uri ?? undefined));
      const saveNamePromise = currentName ? savePrimaryDog(currentName) : Promise.resolve();
      const [uri] = await Promise.all([photoPromise, saveNamePromise]);
      if (uri) {
        if (currentName || dog?.name) await savePrimaryDog(currentName || dog?.name || '', uri);
        else {
          const next = { ...progressRef.current, familyId, pendingDogPhotoUrl: uri };
          await saveFamilySetupProgress(next);
          progressRef.current = next;
          onProgressChange(next);
          setPendingDogPhotoUrl(uri);
        }
        setSelectedDogPhotoPreviewUrl(undefined);
      } else {
        setSelectedDogPhotoPreviewUrl(undefined);
      }
    } catch {
      setSelectedDogPhotoPreviewUrl(undefined);
      setError('לא הצלחנו לפתוח את הגלריה או לשמור את התמונה. בדקו את תמיכת הדפדפן, הרשאת התמונות והחיבור ונסו שוב.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const saveAdditionalDog = async () => {
    const name = additionalDogName.trim();
    if (!name) throw new Error('צריך להזין שם לכלב/ה הנוסף/ת.');
    const newDog: Dog = { id: generateId('dog'), familyId, name, walksPerDay: 0 };
    await saveDog(newDog);
    setAdditionalDogName('');
  };

  const chooseDogSex = async (sex: NonNullable<Dog['sex']>) => {
    setDogSex(sex);
    const next = { ...progressRef.current, familyId, pendingDogSex: sex };
    await saveFamilySetupProgress(next);
    progressRef.current = next;
    onProgressChange(next);
    if (dog || dogName.trim()) {
      await savePrimaryDog(dogName.trim() || dog?.name || '', undefined, sex);
    }
  };

  const continueDogStep = async () => {
    const name = dogName.trim();
    if (!name) {
      setError('צריך להזין את שם הכלב/ה כדי להמשיך.');
      return;
    }
    await showAction(async () => {
      await savePrimaryDog(name, pendingDogPhotoUrl, dogSex);
      await persistStep(3, { pendingDogPhotoUrl: undefined, pendingDogSex: undefined });
      setPendingDogPhotoUrl(undefined);
    });
  };

  const createAdminProfile = async () => {
    const name = adminName.trim();
    if (!name) throw new Error('צריך להזין את השם שלכם כדי להמשיך.');
    if (familyRole !== 'admin') throw new Error('ההרשאה של מנהל המשפחה עדיין לא אומתה. נסו לטעון מחדש.');
    const userId = progress.adminUserId ?? generateId('user');
    const nextProgress = { ...progress, familyId, step: 3 as const, adminUserId: userId, adminName: name };
    // Save the stable profile id before the network write. A refresh after a
    // successful server insert can find and claim the same profile instead
    // of creating a duplicate administrator.
    await saveFamilySetupProgress(nextProgress);
    onProgressChange(nextProgress);
    // Re-read the authoritative remote list before retrying the INSERT.
    // If the server committed but the client lost the response, reusing the
    // stable id as a fresh create would hit the INSERT-only RLS path again.
    await loadFamily(familyId);
    const existing = useFamilyStore.getState().users.find((user) => user.id === userId);
    if (!existing) {
      await addUser({ id: userId, name, avatar: '🧑', color: userPalette[0] });
    } else if (existing.name !== name) {
      await updateUser({ ...existing, name });
    }
    await signIn(userId);
    setResponsibleUserId(userId);
  };

  const saveMember = async (input: { name: string; avatar: string; color: string; photoUrl?: string }) => {
    await addUser(input);
    setMemberFormVisible(false);
  };

  const addRuleAt = async (time: string, label = '') => {
    if (!dog || !responsibleUserId) throw new Error('צריך לבחור כלב/ה ואחראי/ת לפני שמירת הטיול.');
    const existing = useScheduleStore.getState().rules;
    const duplicate = existing.find((rule) => rule.active && rule.dogId === dog.id && rule.time === time && rule.daysOfWeek.length === ALL_DAYS.length && ALL_DAYS.every((day) => rule.daysOfWeek.includes(day)));
    if (duplicate) return;
    const rule: ScheduleRule = {
      id: generateId('rule'), familyId, dogId: dog.id, time, label: label || undefined,
      daysOfWeek: ALL_DAYS, rotationUserIds: [responsibleUserId], rotationAnchorDate: localDateOnly(new Date()),
      sortOrder: existing.filter((item) => item.dogId === dog.id).length, active: true, createdAt: new Date().toISOString(),
    };
    await addRule(rule);
  };

  const addSuggestedSchedule = async () => {
    await showAction(async () => {
      for (const suggestion of SUGGESTED_TIMES) await addRuleAt(suggestion.time, suggestion.label);
      await loadSchedule(familyId);
    });
  };

  const addCustomSchedule = async () => {
    await showAction(async () => {
      await addRuleAt(newTime);
      await loadSchedule(familyId);
    });
  };

  const removeScheduleRule = async (ruleId: string) => {
    await showAction(async () => {
      await deleteRule(ruleId);
      await loadSchedule(familyId);
    });
  };

  const editScheduleRule = async () => {
    if (!editingRuleId || !responsibleUserId) return;
    await showAction(async () => {
      await useScheduleStore.getState().updateRule(editingRuleId, { time: newTime, rotationUserIds: [responsibleUserId] });
      await loadSchedule(familyId);
      setEditingRuleId(null);
    });
  };

  const continueSchedule = async () => {
    await showAction(() => persistStep(5));
  };

  const copyFamilyLink = async () => {
    if (!inviteCode) return;
    const origin = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : null;
    const ok = await copyToClipboard(buildJoinLinkText(inviteCode, origin));
    setCopyFeedback(ok ? 'success' : 'error');
    Alert.alert(ok ? 'הקישור הועתק' : 'לא הצלחנו להעתיק', ok ? 'קישור ההצטרפות למשפחה הועתק.' : `אפשר להעתיק ידנית את הקוד ${inviteCode}.`);
  };

  const shareFamilyLink = async () => {
    if (!inviteCode) return;
    const origin = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : null;
    try { await Share.share({ message: `הצטרפו למשפחה שלנו ב־Walkie Doggy!\n\n${buildJoinLinkText(inviteCode, origin)}` }); } catch { /* optional share */ }
  };

  const regenerateFamilyCode = () => {
    if (!familyId || regeneratingInvite) return;
    const replace = async () => {
      setRegeneratingInvite(true);
      try {
        const next = await regenerateInviteCode(familyId);
        setInviteCode(next);
        setCopyFeedback('idle');
      } catch {
        Alert.alert('לא הצלחנו להחליף את הקוד', 'נסו שוב בעוד רגע.');
      } finally { setRegeneratingInvite(false); }
    };
    if (Platform.OS === 'web') {
      const confirm = (globalThis as typeof globalThis & { confirm?: (message: string) => boolean }).confirm;
      if (confirm?.('הקוד הישן יפסיק לעבוד להצטרפות חדשה. להחליף אותו?')) void replace();
    } else {
      Alert.alert('להחליף את קוד ההצטרפות?', 'הקוד הישן יפסיק לעבוד להצטרפות חדשה.', [
        { text: 'ביטול', style: 'cancel' }, { text: 'החלפה', style: 'destructive', onPress: () => void replace() },
      ]);
    }
  };

  const back = () => {
    if (step > 1) void showAction(() => persistStep((step - 1) as FamilySetupProgress['step']));
  };

  if (initializing || familyLoading) {
    return <SafeAreaView style={styles.center}><WalkieMascot state="waiting" size={110} accessibilityLabel="Walkie Doggy טוען את ההקמה" /><ActivityIndicator size="large" color={colors.primary} accessibilityLabel="טוענים את פרטי המשפחה" /><RtlText style={styles.muted}>טוענים את הפרטים ששמרתם…</RtlText></SafeAreaView>;
  }

  if (familyError || scheduleError) {
    return <SafeAreaView style={styles.center}><WalkieMascot state="concerned" size={100} accessibilityLabel="Walkie Doggy ממתין לחיבור" /><RtlText style={styles.heading}>לא הצלחנו לטעון את ההקמה</RtlText><RtlText style={styles.muted}>{familyError ?? scheduleError}</RtlText><Button label="נסו שוב" onPress={() => void refreshData()} /></SafeAreaView>;
  }

  const stepTitle = step === 1 ? 'המשפחה נוצרה' : step === 2 ? 'הכירו את הכלב שלכם' : step === 3 ? 'מי יוצא לטייל עם הכלב?' : step === 4 ? 'מתי יוצאים לטיול?' : 'המשפחה שלכם מוכנה!';
  const familyName = family?.name ?? 'המשפחה שלכם';
  const familyPhotoSection = (
    <View style={styles.dogPhotoCard}>
      <DogPhoto photoUrl={selectedDogPhotoPreviewUrl ?? dog?.photoUrl ?? pendingDogPhotoUrl} size={128} />
      <RtlText style={styles.muted}>{dog?.photoUrl || pendingDogPhotoUrl ? 'תמונת הכלב/ה שלכם' : 'כאן יופיע הקמע הרשמי של Walkie Doggy עד שתוסיפו תמונה'}</RtlText>
      <View style={styles.photoActions}>
        <Button label={busy ? 'מעלה תמונה…' : dog?.photoUrl ? 'החלפת תמונה מהגלריה' : 'בחירת תמונה מהגלריה'} variant="secondary" disabled={busy} onPress={() => void pickDogPhoto(false)} style={styles.flexButton} />
        {Platform.OS !== 'web' ? <Button label="צילום תמונה" variant="secondary" disabled={busy} onPress={() => void pickDogPhoto(true)} style={styles.flexButton} /> : null}
        {dog?.photoUrl || pendingDogPhotoUrl ? <Button label="הסרת תמונה" variant="secondary" disabled={busy} onPress={() => {
          if (pendingDogPhotoUrl && pendingDogPhotoUrl !== dog?.photoUrl) {
            const next = { ...progressRef.current, familyId, pendingDogPhotoUrl: undefined };
            void saveFamilySetupProgress(next).then(() => { progressRef.current = next; onProgressChange(next); setPendingDogPhotoUrl(undefined); });
          } else if (dog) void showAction(async () => removeDogPhoto(dog.id));
        }} style={styles.flexButton} /> : null}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={[styles.shell, isDesktop && styles.desktopShell]}>
          <View style={styles.header}>
            <View style={styles.progressRow} accessibilityLabel={`שלב ${step} מתוך 5`}>
              {[1, 2, 3, 4, 5].map((item) => <View key={item} style={[styles.progressSegment, item <= step && styles.progressActive]} />)}
            </View>
            <RtlText style={styles.stepCount}>שלב {step} מתוך 5</RtlText>
            <RtlText style={styles.heading} accessibilityRole="header">{stepTitle}</RtlText>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {step === 1 ? (
              <View style={styles.card}>
                <WalkieMascot state="success" size={96} accessibilityLabel="הקמע הרשמי של Walkie Doggy" />
                <RtlText style={styles.cardTitle}>{familyName}</RtlText>
                <RtlText style={styles.muted}>כתובת הדוא״ל של מנהל/ת המשפחה אומתה, והמשפחה נשמרה. ממשיכים יחד להגדרת הכלב, בני המשפחה והטיולים.</RtlText>
              </View>
            ) : null}

            {step === 2 ? (
              <>
                <RtlText style={styles.bodyCopy}>נשמור את תמונת הכלב במשפחה, והיא תופיע גם בפרופיל וגם במסך הבית.</RtlText>
                <RtlText style={styles.label}>שם הכלב/ה *</RtlText>
                <TextInput value={dogName} onChangeText={setDogName} placeholder="איך קוראים לו/לה?" placeholderTextColor={colors.textSecondary} style={styles.input} textAlign="right" accessibilityLabel="שם הכלב או הכלבה" autoCapitalize="words" returnKeyType="done" />
                <RtlText style={styles.label}>מין הכלב/ה</RtlText>
                <View style={styles.sexChoiceRow} accessibilityRole="radiogroup" accessibilityLabel="מין הכלב או הכלבה">
                  {([{ value: 'male', label: 'זכר' }, { value: 'female', label: 'נקבה' }] as const).map((option) => {
                    const selected = dogSex === option.value;
                    return <Pressable key={option.value} onPress={() => void showAction(() => chooseDogSex(option.value))} disabled={busy} style={[styles.sexChoice, selected && styles.sexChoiceActive]} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={option.label}><RtlText style={[styles.sexChoiceText, selected && styles.sexChoiceTextActive]}>{option.label}</RtlText></Pressable>;
                  })}
                </View>
                {familyPhotoSection}
                {dogs.length > 1 ? <View style={styles.card}>{dogs.map((item) => <View key={item.id} style={styles.summaryRow}><DogPhoto photoUrl={item.photoUrl} size={44} /><RtlText style={styles.rowTitle}>{item.name}</RtlText></View>)}</View> : null}
                <View style={styles.card}>
                  <RtlText style={styles.cardTitle}>יש עוד כלב/ה במשפחה?</RtlText>
                  <RtlText style={styles.muted}>אפשר להוסיף שם נוסף עכשיו; תמונה אפשר להוסיף גם בהמשך מפרופיל הכלב.</RtlText>
                  <TextInput value={additionalDogName} onChangeText={setAdditionalDogName} placeholder="שם הכלב/ה הנוסף/ת" placeholderTextColor={colors.textSecondary} style={styles.input} textAlign="right" accessibilityLabel="שם של כלב נוסף" />
                  <Button label="הוספת כלב נוסף" variant="secondary" disabled={busy || !additionalDogName.trim()} loading={busy} onPress={() => void showAction(saveAdditionalDog)} />
                </View>
              </>
            ) : null}

            {step === 3 ? (
              <>
                {!currentUserId ? (
                  <View style={styles.card}>
                    <RtlText style={styles.cardTitle}>קודם נוסיף את פרופיל המנהל/ת</RtlText>
                    <RtlText style={styles.muted}>החשבון שלכם יקבל את הרשאת המנהל שאושרה בעת יצירת המשפחה.</RtlText>
                    <RtlText style={styles.label}>השם שיוצג למשפחה *</RtlText>
                    <TextInput value={adminName} onChangeText={setAdminName} placeholder="השם שלכם" placeholderTextColor={colors.textSecondary} style={styles.input} textAlign="right" accessibilityLabel="שם מנהל המשפחה" autoCapitalize="words" />
                    <Button label="שמירת פרופיל המנהל" onPress={() => void showAction(createAdminProfile)} disabled={busy || !adminName.trim()} loading={busy} />
                  </View>
                ) : <View style={styles.successBanner}><RtlText style={styles.successText}>✓ פרופיל המנהל/ת נוסף ונשמר</RtlText></View>}
                <View style={styles.card}>
                  <RtlText style={styles.cardTitle}>בני המשפחה</RtlText>
                  {activeUsers.map((user) => <View key={user.id} style={styles.summaryRow}><Avatar emoji={user.avatar} color={user.color} photoUrl={user.photoUrl} size={42} /><RtlText style={styles.rowTitle}>{user.name}{user.id === progress.adminUserId ? ' · מנהל/ת' : ''}</RtlText></View>)}
                  {currentUserId ? <Button label="הוספת בן או בת משפחה" variant="secondary" onPress={() => setMemberFormVisible(true)} /> : null}
                </View>
                {currentUserId && inviteCode ? <View style={styles.card}><RtlText style={styles.cardTitle}>הזמנה בקישור או בקוד QR</RtlText><RtlText style={styles.muted}>כל מי שיצטרף יראה את פרטי הכלב והטיולים של המשפחה, בלי להקים אותם מחדש.</RtlText><Button label="הצגת קישור וקוד QR" variant="secondary" onPress={() => setSharingVisible(true)} /></View> : null}
                {!currentUserId ? <RtlText style={styles.muted}>אפשר לדלג כרגע על בני משפחה נוספים. פרופיל המנהל נדרש להמשך.</RtlText> : null}
              </>
            ) : null}

            {step === 4 ? (
              <>
                <RtlText style={styles.bodyCopy}>הוסיפו שעה לכל טיול קבוע. לכל שעה אפשר לבחור מי אחראי/ת; אפשר גם להמשיך בלי לוח זמנים.</RtlText>
                <View style={styles.card}>
                  <RtlText style={styles.cardTitle}>טיולים בכל יום ({dogRules.length})</RtlText>
                  {dogRules.map((rule) => <View key={rule.id} style={styles.ruleRow}><View style={styles.ruleInfo}><RtlText style={styles.rowTitle}>{rule.time}{rule.label ? ` · ${rule.label}` : ''}</RtlText><RtlText style={styles.muted}>באחריות {usersById[rule.rotationUserIds[0]]?.name ?? 'בן/בת המשפחה'}</RtlText></View><View style={styles.ruleActions}><Pressable onPress={() => { setEditingRuleId(rule.id); setNewTime(rule.time); setResponsibleUserId(rule.rotationUserIds[0] ?? responsibleUserId); }} disabled={busy} accessibilityRole="button" accessibilityLabel={`עריכת טיול בשעה ${rule.time}`} style={styles.removeRule}><RtlText style={styles.editRuleText}>עריכה</RtlText></Pressable><Pressable onPress={() => void removeScheduleRule(rule.id)} disabled={busy} accessibilityRole="button" accessibilityLabel={`הסרת טיול בשעה ${rule.time}`} style={styles.removeRule}><RtlText style={styles.removeRuleText}>הסרה</RtlText></Pressable></View></View>)}
                  {editingRuleId ? <RtlText style={styles.label}>עריכת שעה ואחראי/ת</RtlText> : <RtlText style={styles.label}>שעת טיול נוספת</RtlText>}
                  <TimePickerField value={newTime} onChange={setNewTime} webLabel="בחירת שעת טיול" />
                  <RtlText style={styles.label}>אחראי/ת</RtlText>
                  <View style={styles.memberChoiceRow}>{activeUsers.map((user) => <Pressable key={user.id} onPress={() => setResponsibleUserId(user.id)} style={[styles.memberChip, responsibleUserId === user.id && styles.memberChipActive]} accessibilityRole="button" accessibilityState={{ selected: responsibleUserId === user.id }}><RtlText style={[styles.memberChipText, responsibleUserId === user.id && styles.memberChipTextActive]}>{user.name}</RtlText></Pressable>)}</View>
                  {editingRuleId ? <><Button label="שמירת עדכון הטיול" variant="secondary" disabled={busy || !responsibleUserId} loading={busy} onPress={() => void editScheduleRule()} /><Pressable onPress={() => setEditingRuleId(null)} style={styles.skipLink}><RtlText style={styles.skipText}>ביטול עריכה</RtlText></Pressable></> : <Button label="הוספת שעה ללוח" variant="secondary" disabled={busy || !dog || !responsibleUserId} loading={busy} onPress={() => void addCustomSchedule()} />}
                  {dogRules.length === 0 ? <Button label="הוספת הצעה: בוקר, צהריים וערב" variant="secondary" disabled={busy || !dog || !responsibleUserId} onPress={() => void addSuggestedSchedule()} style={styles.suggestButton} /> : null}
                </View>
              </>
            ) : null}

            {step === 5 ? (
              <>
                <View style={styles.readyHero}><WalkieMascot state="success" size={116} accessibilityLabel="הקמע הרשמי של Walkie Doggy חוגג" /><RtlText style={styles.cardTitle}>{familyName}</RtlText></View>
                <View style={styles.card}>
                  <RtlText style={styles.sectionTitle}>הכלב/ה</RtlText>
                  {dogs.map((item) => <View key={item.id} style={styles.summaryRow}><DogPhoto photoUrl={item.photoUrl} size={56} /><RtlText style={styles.rowTitle}>{item.name}</RtlText></View>)}
                  {dogs.length === 0 ? <View style={styles.summaryRow}><DogPhoto size={56} /><RtlText style={styles.rowTitle}>{dogName}</RtlText></View> : null}
                </View>
                <View style={styles.card}>
                  <RtlText style={styles.sectionTitle}>בני המשפחה</RtlText>
                  {activeUsers.length ? activeUsers.map((user) => <View key={user.id} style={styles.summaryRow}><Avatar emoji={user.avatar} color={user.color} photoUrl={user.photoUrl} size={40} /><RtlText style={styles.rowTitle}>{user.name}</RtlText></View>) : <RtlText style={styles.muted}>אפשר להוסיף בני משפחה בהמשך דרך קישור ההזמנה.</RtlText>}
                </View>
                <View style={styles.card}>
                  <RtlText style={styles.sectionTitle}>טיולים ראשוניים</RtlText>
                  {dogRules.length ? dogRules.map((rule) => <RtlText key={rule.id} style={styles.rowTitle}>{rule.time} · {usersById[rule.rotationUserIds[0]]?.name ?? 'אחראי/ת'}</RtlText>) : <RtlText style={styles.muted}>אפשר להגדיר טיולים קבועים גם בהמשך.</RtlText>}
                </View>
              </>
            ) : null}

            {error ? <View style={styles.errorBanner}><RtlText style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</RtlText><Pressable onPress={() => setError(null)} accessibilityRole="button"><RtlText style={styles.errorDismiss}>הבנתי</RtlText></Pressable></View> : null}
          </ScrollView>

          <View style={styles.footer}>
            {step === 1 ? <Button label="ממשיכים להגדרת הכלב" onPress={() => void showAction(() => persistStep(2))} disabled={busy} loading={busy} /> : null}
            {step === 2 ? <Button label="המשך לבני המשפחה" onPress={() => void continueDogStep()} disabled={busy} loading={busy} /> : null}
            {step === 3 ? <>
              <Button label={currentUserId ? 'המשך להגדרת הטיולים' : 'שמירה והמשך'} onPress={() => void showAction(async () => { if (!currentUserId) await createAdminProfile(); await persistStep(4); })} disabled={busy || (familyRole !== 'admin') || (!currentUserId && !adminName.trim())} loading={busy} />
              {currentUserId ? <Pressable onPress={() => void persistStep(4)} disabled={busy} style={styles.skipLink} accessibilityRole="button"><RtlText style={styles.skipText}>הזמנה אחר כך · המשך</RtlText></Pressable> : null}
            </> : null}
            {step === 4 ? <>
              <Button label="המשך לסיכום" onPress={() => void continueSchedule()} disabled={busy} loading={busy} />
              <Pressable onPress={() => void showAction(() => persistStep(5))} disabled={busy} style={styles.skipLink} accessibilityRole="button"><RtlText style={styles.skipText}>אגדיר טיולים אחר כך</RtlText></Pressable>
            </> : null}
            {step === 5 ? <Button label="בואו נתחיל!" onPress={() => void showAction(onComplete)} disabled={busy} loading={busy} /> : null}
            {step > 1 ? <Pressable onPress={back} disabled={busy} style={styles.backButton} accessibilityRole="button"><RtlText style={styles.backText}>{step === 5 ? 'חזרה לעריכה' : 'חזרה'}</RtlText></Pressable> : null}
          </View>
        </View>
      </KeyboardAvoidingView>

      <UserFormModal visible={memberFormVisible} editingUser={null} familyId={familyId} onSave={saveMember} onClose={() => setMemberFormVisible(false)} />
      <FamilySharingModal visible={sharingVisible} isSupabaseConfigured={true} inviteCode={inviteCode} isAdmin={familyRole === 'admin'} regenerating={regeneratingInvite} copyFeedback={copyFeedback} onCopy={() => void copyFamilyLink()} onShare={() => void shareFamilyLink()} onRegenerate={regenerateFamilyCode} onClose={() => setSharingVisible(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, gap: spacing.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: spacing.xl },
  shell: { flex: 1, width: '100%', maxWidth: 620, alignSelf: 'center' },
  desktopShell: { maxWidth: breakpoints.desktopContent, paddingHorizontal: spacing.xl },
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.sm, alignItems: 'flex-end' },
  progressRow: { width: '100%', flexDirection: 'row-reverse', gap: 6, marginBottom: spacing.sm },
  progressSegment: { flex: 1, height: 5, borderRadius: 4, backgroundColor: colors.border },
  progressActive: { backgroundColor: colors.primary },
  stepCount: { ...typography.meta, color: colors.primaryDark, fontWeight: '700', marginBottom: spacing.xs },
  heading: { ...typography.screenTitle, color: colors.textPrimary, textAlign: 'right', fontSize: 24 },
  scroll: { flex: 1 },
  body: { padding: spacing.xl, paddingTop: spacing.sm, gap: spacing.md },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.md, gap: spacing.xs, backgroundColor: colors.background },
  card: { width: '100%', backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  dogPhotoCard: { backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, alignItems: 'center', gap: spacing.sm },
  photoActions: { width: '100%', gap: spacing.xs },
  flexButton: { width: '100%' },
  cardTitle: { ...typography.cardTitle, color: colors.textPrimary, textAlign: 'right' },
  sectionTitle: { ...typography.cardTitle, color: colors.textPrimary, textAlign: 'right' },
  bodyCopy: { ...typography.body, color: colors.textSecondary, textAlign: 'right', lineHeight: 24 },
  muted: { ...typography.meta, color: colors.textSecondary, textAlign: 'right', lineHeight: 21 },
  label: { ...typography.meta, color: colors.textPrimary, textAlign: 'right', fontWeight: '700', marginTop: spacing.xs },
  input: { minHeight: 50, width: '100%', borderRadius: radii.md, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, paddingHorizontal: spacing.md, color: colors.textPrimary, fontSize: 16, writingDirection: 'rtl' },
  sexChoiceRow: { flexDirection: 'row-reverse', gap: spacing.sm },
  sexChoice: { flex: 1, minHeight: 48, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  sexChoiceActive: { borderColor: colors.primary, backgroundColor: colors.statusCurrentBg },
  sexChoiceText: { color: colors.textSecondary, fontWeight: '600' },
  sexChoiceTextActive: { color: colors.primaryDark, fontWeight: '800' },
  summaryRow: { width: '100%', minHeight: 48, flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  rowTitle: { ...typography.body, color: colors.textPrimary, textAlign: 'right', fontWeight: '700' },
  ruleRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: spacing.sm },
  ruleInfo: { flex: 1, alignItems: 'flex-end', gap: 2 },
  ruleActions: { flexDirection: 'row-reverse', gap: spacing.xs },
  removeRule: { minWidth: 64, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  removeRuleText: { color: colors.statusOverdue, fontWeight: '700' },
  editRuleText: { color: colors.primaryDark, fontWeight: '700' },
  memberChoiceRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: spacing.xs },
  memberChip: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: 22, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceMuted, justifyContent: 'center' },
  memberChipActive: { borderColor: colors.primary, backgroundColor: colors.statusCurrentBg },
  memberChipText: { color: colors.textPrimary, fontWeight: '600' },
  memberChipTextActive: { color: colors.primaryDark, fontWeight: '800' },
  suggestButton: { marginTop: spacing.xs },
  successBanner: { padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.statusDoneBg },
  successText: { color: colors.statusDone, fontWeight: '800', textAlign: 'right' },
  readyHero: { backgroundColor: colors.surface, borderRadius: radii.lg, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  errorBanner: { width: '100%', flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.statusOverdueBg },
  errorText: { flex: 1, color: colors.statusOverdue, textAlign: 'right', fontWeight: '600' },
  errorDismiss: { minHeight: 40, textAlignVertical: 'center', color: colors.statusOverdue, fontWeight: '800' },
  skipLink: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  skipText: { color: colors.primaryDark, fontWeight: '700', textAlign: 'center' },
  backButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  backText: { color: colors.textSecondary, fontWeight: '700' },
});
