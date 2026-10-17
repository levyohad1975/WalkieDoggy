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
import { generateDogPhotoCutout, regenerateInviteCode } from '../lib/supabase';
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
  onReturnToOriginalFamily?: () => void;
  returningToOriginalFamily?: boolean;
  returnFamilyError?: string | null;
}

export function FamilySetupWizard({ familyId, progress, onProgressChange, onComplete, onReturnToOriginalFamily, returningToOriginalFamily = false, returnFamilyError }: FamilySetupWizardProps) {
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
  const authFamilyId = useAuthStore((s) => s.familyId);
  const familyRole = useAuthStore((s) => s.familyRole);
  const signIn = useAuthStore((s) => s.signIn);
  const rules = useScheduleStore((s) => s.rules);
  const scheduleError = useScheduleStore((s) => s.error);
  const loadSchedule = useScheduleStore((s) => s.load);
  const addRule = useScheduleStore((s) => s.addRule);
  const deleteRule = useScheduleStore((s) => s.deleteRule);
  const deleteUser = useFamilyStore((s) => s.deleteUser);
  const getUserDeletionImpact = useFamilyStore((s) => s.getUserDeletionImpact);
  const [step, setStep] = useState<FamilySetupProgress['step']>(progress.step);
  const progressRef = useRef(progress);
  useEffect(() => {
    if (progressRef.current.familyId !== familyId) {
      // A System Admin can move between QA families without unmounting this
      // screen. Start fresh so a pending photo, selected dog, or manager draft
      // from the previous family cannot leak into the next one.
      progressRef.current = progress;
      setAdminName(progress.adminName ?? '');
      setPendingDogPhotoUrl(progress.pendingDogPhotoUrl);
      setDogSex(progress.pendingDogSex);
      setDogName('');
      setSetupDogId('');
      setScheduleDogId('');
      dogIdRef.current = progress.pendingDogPhotoDogId ?? generateId('dog');
      setMemberFormVisible(false);
      setEditingMember(null);
    } else {
      // Keep local writes made while the parent is processing its state
      // update; copying the previous prop during an unrelated render can
      // erase a photo draft before the dog profile is persisted.
      progressRef.current = { ...progressRef.current, ...progress };
    }
    setStep(progress.step);
  }, [progress, familyId]);
  const [initializing, setInitializing] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [dogSetupRetry, setDogSetupRetry] = useState<'save' | 'photo' | null>(null);
  const [dogName, setDogName] = useState('');
  const [dogSex, setDogSex] = useState<Dog['sex']>(progress.pendingDogSex);
  const [setupDogId, setSetupDogId] = useState(dog?.id ?? '');
  const [pendingDogPhotoUrl, setPendingDogPhotoUrl] = useState(progress.pendingDogPhotoUrl);
  const [selectedDogPhotoPreviewUrl, setSelectedDogPhotoPreviewUrl] = useState<string | undefined>();
  const dogIdRef = useRef<string>(progress.pendingDogPhotoDogId ?? generateId('dog'));
  const [additionalDogName, setAdditionalDogName] = useState('');
  const [adminName, setAdminName] = useState(progress.adminName ?? '');
  const adminProfileSaveRef = useRef(false);
  const adminAutoResumeAttemptedRef = useRef<string | null>(null);
  const [memberFormVisible, setMemberFormVisible] = useState(false);
  const [editingMember, setEditingMember] = useState<FamilyUser | null>(null);
  const [memberSaving, setMemberSaving] = useState(false);
  const [sharingVisible, setSharingVisible] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | undefined>(undefined);
  const [regeneratingInvite, setRegeneratingInvite] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<'idle' | 'success' | 'error'>('idle');
  const [newTime, setNewTime] = useState('08:00');
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [responsibleUserId, setResponsibleUserId] = useState(progress.adminUserId ?? '');
  const [scheduleDogId, setScheduleDogId] = useState(dog?.id ?? '');

  // A family switch can leave another family's members in the shared store briefly.
  // Only show and assign profiles that belong to this wizard's family.
  const activeUsers = useMemo(() => users.filter((user) => user.familyId === familyId && !user.removedAt), [users, familyId]);
  const setupDog = useMemo(() => dogs.find((item) => item.id === setupDogId) ?? dog, [dogs, setupDogId, dog]);
  const dogRules = useMemo(() => rules.filter((rule) => rule.dogId === scheduleDogId && rule.familyId === familyId && rule.active).sort((a, b) => a.time.localeCompare(b.time)), [rules, familyId, scheduleDogId]);
  const allDogRules = useMemo(() => rules.filter((rule) => dogs.some((item) => item.id === rule.dogId) && rule.familyId === familyId && rule.active).sort((a, b) => a.time.localeCompare(b.time)), [rules, dogs, familyId]);
  const usersById = useMemo(() => Object.fromEntries(activeUsers.map((user) => [user.id, user])), [activeUsers]);
  const scheduleFamilyContextValid = authFamilyId === familyId && family?.id === familyId;
  const scheduleDogAvailable = dogs.some((item) => item.id === scheduleDogId && item.familyId === familyId);
  const scheduleAssigneeEligible = activeUsers.some((user) => user.id === responsibleUserId);
  const missingSuggestedTimes = SUGGESTED_TIMES.filter((suggestion) =>
    !dogRules.some((rule) =>
      rule.time === suggestion.time &&
      rule.daysOfWeek.length === ALL_DAYS.length &&
      ALL_DAYS.every((day) => rule.daysOfWeek.includes(day))
    )
  );
  const managerProfileSaved = Boolean(currentUserId && progressRef.current.adminUserId === currentUserId && familyRole === 'admin' && activeUsers.some((user) => user.id === currentUserId));

  // Restoring an onboarding draft after a System Admin family switch may not
  // restore the prior device claim. Keep the saved manager when present; for
  // a one-manager family, safely choose its sole active family profile.
  useEffect(() => {
    setResponsibleUserId((current) => {
      if (activeUsers.some((user) => user.id === current)) return current;
      const savedAdmin = activeUsers.find((user) => user.id === progress.adminUserId);
      if (savedAdmin) return savedAdmin.id;
      const signedInMember = activeUsers.find((user) => user.id === currentUserId);
      if (signedInMember) return signedInMember.id;
      return activeUsers.length === 1 ? activeUsers[0].id : '';
    });
  }, [activeUsers, progress.adminUserId, currentUserId]);
  const showAction = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setDogSetupRetry(null);
    try {
      await action();
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : '';
      const blockedByPendingProfileSync = /pending sync from another profile on this device/i.test(detail);
      const message = blockedByPendingProfileSync
        ? 'פרופיל המנהל נשמר במשפחת הבדיקה, אך לא ניתן לחבר אותו למכשיר כי נשארו פעולות שממתינות לסנכרון מפרופיל אחר. חזרו למשפחה המקורית כשהמכשיר מחובר לאינטרנט, המתינו לסיום הסנכרון, ואז היכנסו שוב למשפחת הבדיקה ולחצו על ״שמירה והמשך״. השם נשמר ולא ייווצר פרופיל כפול.'
        : /[\u0590-\u05FF]/.test(detail) ? detail : step === 2 ? 'לא הצלחנו לשמור את פרטי הכלב/ה. בדקו את החיבור ונסו שוב.' : 'לא הצלחנו לשמור את השינוי. בדקו את החיבור ונסו שוב.';
      setError(message);
      setDogSetupRetry(step === 2 ? 'save' : null);
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
    if (!setupDogId && family?.id === familyId && dogs.length) {
      setSetupDogId(dog?.id ?? dogs[0].id);
      setScheduleDogId(dog?.id ?? dogs[0].id);
    }
  }, [dogs, dog?.id, setupDogId, family?.id, familyId]);

  useEffect(() => {
    if (setupDog) {
      dogIdRef.current = setupDog.id;
      setDogName(setupDog.name);
      setDogSex(setupDog.sex ?? (setupDog.id === dog?.id ? progress.pendingDogSex : undefined));
      setSelectedDogPhotoPreviewUrl(undefined);
    }
  }, [setupDog?.id]);

  useEffect(() => {
    if (family?.inviteCode) setInviteCode(family.inviteCode);
  }, [family?.inviteCode]);

  useEffect(() => {
    if (!adminProfileSaveRef.current && !currentUserId && progress.adminUserId && adminAutoResumeAttemptedRef.current !== progress.adminUserId && activeUsers.some((user) => user.id === progress.adminUserId)) {
      adminAutoResumeAttemptedRef.current = progress.adminUserId;
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
    const storedDog = useFamilyStore.getState().dogs.find((candidate) => candidate.id === dogIdRef.current);
    const currentDog = storedDog ?? (setupDog?.id === dogIdRef.current ? setupDog : null);
    // The database enforces dogs.walks_per_day > 0. New/legacy synthesized
    // profiles can carry 0, which made the first QA-family dog INSERT fail
    // with SQLSTATE 23514 even when family authorization was valid.
    const walksPerDay = currentDog && Number.isInteger(currentDog.walksPerDay) && currentDog.walksPerDay > 0
      ? currentDog.walksPerDay
      : 1;
    const photoChanged = photoUrl !== undefined && photoUrl !== currentDog?.photoUrl;
    const savedDog: Dog = currentDog
      ? { ...currentDog, name, walksPerDay, ...(sex ? { sex } : {}), ...(photoUrl !== undefined ? { photoUrl, ...(photoChanged ? { photoCutoutUrl: undefined } : {}) } : {}) }
      : { id: dogIdRef.current, familyId, name, walksPerDay, ...(sex ? { sex } : {}), ...(photoUrl ? { photoUrl } : {}) };
    const needsCutout = Boolean(photoUrl) && (!currentDog || photoChanged || !currentDog.photoCutoutUrl);
    const alreadySaved = currentDog
      && currentDog.name === savedDog.name
      && currentDog.sex === savedDog.sex
      && currentDog.photoUrl === savedDog.photoUrl
      && currentDog.photoCutoutUrl === savedDog.photoCutoutUrl;
    if (!alreadySaved) await saveDog(savedDog);
    if (!currentDog || useFamilyStore.getState().selectedDogId !== savedDog.id) await selectDog(savedDog.id);
    if (needsCutout) {
      // Upload/setup must use the same background-removal path as Settings.
      // Keep this off the onboarding save path: the original photo is already
      // persisted and remains available while the cutout is prepared.
      void generateDogPhotoCutout(savedDog.id)
        .then(() => loadFamily(familyId))
        .catch((cutoutError) => console.warn('Dog cutout generation failed; keeping source photo fallback:', cutoutError));
    }
  };

  const persistPendingDogPhoto = async (photoUrl: string) => {
    const next = { ...progressRef.current, familyId, pendingDogPhotoUrl: photoUrl, pendingDogPhotoDogId: dogIdRef.current };
    await saveFamilySetupProgress(next);
    progressRef.current = next;
    onProgressChange(next);
    setPendingDogPhotoUrl(photoUrl);
  };

  const pickDogPhoto = async (camera = false) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setDogSetupRetry(null);
    let uploadedPhotoUrl: string | null = null;
    try {
      const currentName = dogName.trim();
      const photoDog = dogs.find((item) => item.id === dogIdRef.current) ?? setupDog;
      // Invoke the Web picker synchronously from the tap. Once it resolves,
      // persist the name and uploaded photo together in one dog-profile write.
      const photoPromise = camera
        ? takeAndUploadImage('dogs', familyId, dogIdRef.current)
        : pickAndUploadImage('dogs', familyId, dogIdRef.current, (uri) => setSelectedDogPhotoPreviewUrl(uri ?? undefined));
      uploadedPhotoUrl = await photoPromise;
      if (uploadedPhotoUrl) {
        if (currentName || photoDog?.name) {
          await savePrimaryDog(currentName || photoDog?.name || '', uploadedPhotoUrl, dogSex);
        } else {
          await persistPendingDogPhoto(uploadedPhotoUrl);
        }
      } else if (currentName) {
        // Cancellation is not an error, but keep the entered name durable.
        await savePrimaryDog(currentName, undefined, dogSex);
      }
      setSelectedDogPhotoPreviewUrl(undefined);
    } catch {
      setSelectedDogPhotoPreviewUrl(undefined);
      // The upload may already have succeeded even if the dog-row write did
      // not. Keep that URL as a retryable onboarding draft instead of losing it.
      if (uploadedPhotoUrl) {
        try { await persistPendingDogPhoto(uploadedPhotoUrl); } catch { /* keep the original save error visible */ }
      }
      if (uploadedPhotoUrl) {
        setError('התמונה הועלתה, אך שמירת פרטי הכלב/ה נכשלה. נשמור את הבחירה וננסה שוב כשתמשיכו.');
        setDogSetupRetry('save');
      } else {
        setError('לא הצלחנו לבחור או להעלות את התמונה. אפשר לנסות שוב, או להמשיך בלי תמונה.');
        setDogSetupRetry('photo');
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const saveAdditionalDog = async () => {
    const name = additionalDogName.trim();
    if (!name) throw new Error('צריך להזין שם לכלב/ה הנוסף/ת.');
    const newDog: Dog = { id: generateId('dog'), familyId, name, walksPerDay: 1 };
    await saveDog(newDog);
    dogIdRef.current = newDog.id;
    setSetupDogId(newDog.id);
    setScheduleDogId(newDog.id);
    await selectDog(newDog.id);
    setDogName(newDog.name);
    setDogSex(undefined);
    setAdditionalDogName('');
  };

  const selectSetupDog = (dogId: string) => {
    if (dogId === setupDogId || busyRef.current) return;
    void showAction(async () => {
      if (setupDog && dogName.trim() && (setupDog.name !== dogName.trim() || setupDog.sex !== dogSex)) {
        await savePrimaryDog(dogName.trim(), undefined, dogSex);
      }
      dogIdRef.current = dogId;
      setSetupDogId(dogId);
      await selectDog(dogId);
    });
  };

  const chooseDogSex = async (sex: NonNullable<Dog['sex']>) => {
    setDogSex(sex);
    const next = { ...progressRef.current, familyId, pendingDogSex: sex };
    await saveFamilySetupProgress(next);
    progressRef.current = next;
    onProgressChange(next);
    if (setupDog || dogName.trim()) {
      await savePrimaryDog(dogName.trim() || setupDog?.name || '', undefined, sex);
    }
  };

  const continueDogStep = async () => {
    const name = dogName.trim();
    if (!name) {
      setError('צריך להזין את שם הכלב/ה כדי להמשיך.');
      return;
    }
    await showAction(async () => {
      await savePrimaryDog(name, progressRef.current.pendingDogPhotoDogId === dogIdRef.current ? pendingDogPhotoUrl : undefined, dogSex);
      await persistStep(3, { pendingDogPhotoUrl: undefined, pendingDogPhotoDogId: undefined, pendingDogSex: undefined });
      setPendingDogPhotoUrl(undefined);
    });
  };

  const createAdminProfile = async () => {
    if (adminProfileSaveRef.current) return;
    adminProfileSaveRef.current = true;
    try {
      const name = adminName.trim();
      if (!name) throw new Error('צריך להזין את השם שלכם כדי להמשיך.');
      if (familyRole !== 'admin') throw new Error('ההרשאה של מנהל המשפחה עדיין לא אומתה. נסו לטעון מחדש.');
      const userId = progress.adminUserId ?? generateId('user');
      // A failed explicit claim must stay a user-controlled retry. Otherwise
      // adding the profile row can immediately trigger the auto-resume effect
      // and issue a second claim behind the visible error.
      adminAutoResumeAttemptedRef.current = userId;
      const nextProgress = { ...progress, familyId, step: 3 as const, adminUserId: userId, adminName: name };
      // Save the stable profile id before the network write. A refresh after a
      // successful server insert can find and claim the same profile instead
      // of creating a duplicate administrator.
      await saveFamilySetupProgress(nextProgress);
      progressRef.current = nextProgress;
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
    } finally {
      adminProfileSaveRef.current = false;
    }
  };

  const saveMember = async (input: { name: string; avatar: string; color: string; photoUrl?: string }) => {
    setMemberSaving(true);
    try {
      if (editingMember) await updateUser({ ...editingMember, ...input, name: input.name.trim() });
      else await addUser(input);
      setMemberFormVisible(false);
      setEditingMember(null);
      await loadFamily(familyId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'לא הצלחנו לשמור את פרטי בן/בת המשפחה. נסו שוב.');
      throw cause;
    } finally {
      setMemberSaving(false);
    }
  };

  const confirmRemoveMember = (user: FamilyUser) => {
    if (!managerProfileSaved || user.id === progress.adminUserId || user.id === currentUserId) return;
    const impact = getUserDeletionImpact(user.id);
    const others = activeUsers.filter((item) => item.id !== user.id);
    const confirm = async () => {
      setMemberSaving(true);
      try {
        await deleteUser(user.id, impact.futureScheduleEntryCount + impact.rulesAffected.length + impact.directlyAssignedWalkCount > 0 ? (others[0]?.id ?? null) : null);
        await loadFamily(familyId);
        await loadSchedule(familyId);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'לא הצלחנו להסיר את בן/בת המשפחה. לא בוצע שינוי, אפשר לנסות שוב.');
      } finally { setMemberSaving(false); }
    };
    const message = impact.futureScheduleEntryCount + impact.rulesAffected.length + impact.directlyAssignedWalkCount > 0
      ? `הסרת ${user.name} תשאיר את ההיסטוריה שלו/ה ותעביר אחריות עתידית ל${others[0]?.name ?? 'אף אחד'}. להמשיך?`
      : `הפרופיל של ${user.name} יוסר מרשימת בני המשפחה. נתוני היסטוריה יישמרו. להמשיך?`;
    if (Platform.OS === 'web') {
      const confirmWeb = (globalThis as typeof globalThis & { confirm?: (copy: string) => boolean }).confirm;
      if (confirmWeb?.(message)) void confirm();
    } else {
      Alert.alert('הסרת בן/בת משפחה?', message, [
        { text: 'ביטול', style: 'cancel' },
        { text: 'הסרה', style: 'destructive', onPress: () => void confirm() },
      ]);
    }
  };

  const addRuleAt = async (time: string, label = '') => {
    if (!scheduleFamilyContextValid) throw new Error('המשפחה במסך אינה המשפחה הפעילה שאושרה בשרת. רעננו את משפחת הבדיקה ונסו שוב.');
    if (!scheduleDogAvailable || !scheduleAssigneeEligible) throw new Error('צריך לטעון כלב פעיל ולבחור אחראי/ת פעיל/ה במשפחה לפני שמירת הטיול.');
    const existing = useScheduleStore.getState().rules;
    const duplicate = existing.find((rule) => rule.active && rule.dogId === scheduleDogId && rule.time === time && rule.daysOfWeek.length === ALL_DAYS.length && ALL_DAYS.every((day) => rule.daysOfWeek.includes(day)));
    if (duplicate) return;
    const assignedDog = dogs.find((item) => item.id === scheduleDogId);
    if (!assignedDog || assignedDog.familyId !== familyId) throw new Error('צריך לבחור כלב פעיל במשפחה לפני שמירת הטיול.');
    const rule: ScheduleRule = {
      id: generateId('rule'), familyId, dogId: assignedDog.id, time, label: label || undefined,
      daysOfWeek: ALL_DAYS, rotationUserIds: [responsibleUserId], rotationAnchorDate: localDateOnly(new Date()),
      sortOrder: existing.filter((item) => item.dogId === assignedDog.id).length, active: true, createdAt: new Date().toISOString(),
    };
    await addRule(rule);
  };

  const addSuggestedSchedule = async () => {
    await showAction(async () => {
      for (const suggestion of missingSuggestedTimes) await addRuleAt(suggestion.time, suggestion.label);
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
      useScheduleStore.getState().clearActionError();
      await useScheduleStore.getState().updateRule(editingRuleId, { time: newTime, rotationUserIds: [responsibleUserId] });
      const saveError = useScheduleStore.getState().actionError;
      if (saveError) throw new Error(saveError);
      await loadSchedule(familyId);
      setEditingRuleId(null);
    });
  };

  const continueSchedule = async () => {
    await showAction(async () => {
      // The summary is a review of server-confirmed configuration, including
      // schedules changed on another device or during a retry.
      await loadSchedule(familyId);
      await persistStep(5);
    });
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
      <DogPhoto photoUrl={selectedDogPhotoPreviewUrl ?? setupDog?.photoUrl ?? (dogIdRef.current === progressRef.current.pendingDogPhotoDogId ? pendingDogPhotoUrl : undefined)} size={112} />
      <RtlText style={styles.muted}>{setupDog?.photoUrl || (dogIdRef.current === progressRef.current.pendingDogPhotoDogId && pendingDogPhotoUrl) ? `תמונת ${(setupDog?.name ?? dogName.trim()) || 'הכלב/ה'}` : 'אפשר להמשיך עם קמע Walkie Doggy ולהוסיף תמונה אחר כך'}</RtlText>
      <View style={styles.photoActions}>
        <Button label={busy ? 'מעלה תמונה…' : setupDog?.photoUrl ? 'החלפת תמונה מהגלריה' : 'בחירת תמונה מהגלריה'} variant="secondary" disabled={busy} onPress={() => void pickDogPhoto(false)} style={styles.flexButton} />
        {Platform.OS !== 'web' ? <Button label="צילום תמונה" variant="secondary" disabled={busy} onPress={() => void pickDogPhoto(true)} style={styles.flexButton} /> : null}
        {setupDog?.photoUrl || (dogIdRef.current === progressRef.current.pendingDogPhotoDogId && pendingDogPhotoUrl) ? <Button label="הסרת תמונה" variant="secondary" disabled={busy} onPress={() => {
          if (pendingDogPhotoUrl && pendingDogPhotoUrl !== setupDog?.photoUrl && dogIdRef.current === progressRef.current.pendingDogPhotoDogId) {
            const next = { ...progressRef.current, familyId, pendingDogPhotoUrl: undefined, pendingDogPhotoDogId: undefined };
            void saveFamilySetupProgress(next).then(() => { progressRef.current = next; onProgressChange(next); setPendingDogPhotoUrl(undefined); });
          } else if (setupDog) void showAction(async () => removeDogPhoto(setupDog.id));
        }} style={styles.flexButton} /> : null}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={[styles.shell, isDesktop && styles.desktopShell]}>
          <View style={styles.header}>
            {onReturnToOriginalFamily ? <Pressable style={styles.returnButton} onPress={onReturnToOriginalFamily} disabled={returningToOriginalFamily} accessibilityRole="button" accessibilityState={{ disabled: returningToOriginalFamily }} accessibilityLabel="חזרה למשפחה המקורית"><RtlText style={styles.returnButtonText}>{returningToOriginalFamily ? 'חוזרים…' : 'חזרה למשפחה המקורית'}</RtlText></Pressable> : null}
            {returnFamilyError ? <RtlText style={styles.returnError} accessibilityRole="alert">{returnFamilyError}</RtlText> : null}
            <View style={styles.progressRow} accessibilityLabel={`שלב ${step} מתוך 5`}>
              {[1, 2, 3, 4, 5].map((item) => <View key={item} style={[styles.progressSegment, item <= step && styles.progressActive]} />)}
            </View>
            <RtlText style={styles.stepCount}>שלב {step} מתוך 5</RtlText>
            <RtlText style={styles.heading} accessibilityRole="header">{stepTitle}</RtlText>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={[styles.body, width < 390 && styles.bodyNarrow]} keyboardShouldPersistTaps="handled">
            {step === 1 ? (
              <View style={styles.card}>
                <WalkieMascot state="success" size={96} accessibilityLabel="הקמע הרשמי של Walkie Doggy" />
                <RtlText style={styles.cardTitle}>{familyName}</RtlText>
                <RtlText style={styles.muted}>כתובת הדוא״ל של מנהל/ת המשפחה אומתה, והמשפחה נשמרה. ממשיכים יחד להגדרת הכלב, בני המשפחה והטיולים.</RtlText>
              </View>
            ) : null}

            {step === 2 ? (
              <>
                <RtlText style={styles.bodyCopy}>לכל כלב נשמור בנפרד שם, מין ותמונה. אפשר להוסיף כלבים עכשיו או בהמשך.</RtlText>
                {dogs.length > 1 ? <View style={styles.card}><RtlText style={styles.cardTitle}>בחירת כלב לעריכה</RtlText><View style={styles.memberChoiceRow}>{dogs.map((item) => <Pressable key={item.id} onPress={() => selectSetupDog(item.id)} style={[styles.memberChip, setupDogId === item.id && styles.memberChipActive]} accessibilityRole="button" accessibilityState={{ selected: setupDogId === item.id }} accessibilityLabel={`עריכת פרטי ${item.name}`}><RtlText style={[styles.memberChipText, setupDogId === item.id && styles.memberChipTextActive]}>{item.name}</RtlText></Pressable>)}</View></View> : null}
                <RtlText style={styles.label}>שם הכלב/ה *</RtlText>
                <TextInput value={dogName} onChangeText={setDogName} onBlur={() => { if (dogName.trim() && (setupDog?.name !== dogName.trim() || setupDog?.sex !== dogSex)) void showAction(() => savePrimaryDog(dogName.trim(), progressRef.current.pendingDogPhotoDogId === dogIdRef.current ? pendingDogPhotoUrl : undefined, dogSex)); }} placeholder="איך קוראים לו/לה?" placeholderTextColor={colors.textSecondary} style={styles.input} textAlign="right" accessibilityLabel="שם הכלב או הכלבה" autoCapitalize="words" returnKeyType="done" />
                <RtlText style={styles.label}>מין הכלב/ה</RtlText>
                <View style={styles.sexChoiceRow} accessibilityRole="radiogroup" accessibilityLabel="מין הכלב או הכלבה">
                  {([{ value: 'male', label: 'זכר' }, { value: 'female', label: 'נקבה' }] as const).map((option) => {
                    const selected = dogSex === option.value;
                    return <Pressable key={option.value} onPress={() => void showAction(() => chooseDogSex(option.value))} disabled={busy} style={[styles.sexChoice, selected && styles.sexChoiceActive]} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={option.label}><RtlText style={[styles.sexChoiceText, selected && styles.sexChoiceTextActive]}>{option.label}</RtlText></Pressable>;
                  })}
                </View>
                {familyPhotoSection}
                {dogs.length > 1 ? <View style={styles.card}>{dogs.map((item) => <Pressable key={item.id} onPress={() => selectSetupDog(item.id)} style={styles.summaryRow} accessibilityRole="button" accessibilityLabel={`עריכת ${item.name}`}><DogPhoto photoUrl={item.photoUrl} size={44} /><RtlText style={styles.rowTitle}>{item.name}{item.sex ? ` · ${item.sex === 'male' ? 'זכר' : 'נקבה'}` : ' · מין לא הוגדר'}</RtlText><RtlText style={styles.editRuleText}>עריכה</RtlText></Pressable>)}</View> : null}
                <View style={styles.card}>
                  <RtlText style={styles.cardTitle}>יש עוד כלב/ה במשפחה?</RtlText>
                  <RtlText style={styles.muted}>אחרי ההוספה אפשר לבחור אותו/ה למעלה ולהגדיר בנפרד מין ותמונה.</RtlText>
                  <TextInput value={additionalDogName} onChangeText={setAdditionalDogName} placeholder="שם הכלב/ה הנוסף/ת" placeholderTextColor={colors.textSecondary} style={styles.input} textAlign="right" accessibilityLabel="שם של כלב נוסף" />
                  <Button label="הוספת כלב נוסף" variant="secondary" disabled={busy || !additionalDogName.trim()} loading={busy} onPress={() => void showAction(saveAdditionalDog)} />
                </View>
              </>
            ) : null}

            {step === 3 ? (
              <>
                {!managerProfileSaved ? (
                  <View style={styles.card}>
                    <RtlText style={styles.cardTitle}>קודם נוסיף את פרופיל המנהל/ת</RtlText>
                    <RtlText style={styles.muted}>החשבון שלכם יקבל את הרשאת המנהל שאושרה בעת יצירת המשפחה.</RtlText>
                    <RtlText style={styles.label}>השם שיוצג למשפחה *</RtlText>
                    <TextInput value={adminName} onChangeText={setAdminName} placeholder="השם שלכם" placeholderTextColor={colors.textSecondary} style={styles.input} textAlign="right" accessibilityLabel="שם מנהל המשפחה" autoCapitalize="words" />
                    <Button label={busy ? 'שומר פרופיל…' : 'שמירת פרופיל המנהל'} onPress={() => void showAction(createAdminProfile)} disabled={busy || !adminName.trim()} loading={busy} />
                  </View>
                ) : <View style={styles.successBanner}><RtlText style={styles.successText} accessibilityLiveRegion="polite">✓ פרופיל המנהל/ת נוסף ונשמר</RtlText></View>}
                {managerProfileSaved ? <><View style={styles.card}>
                  <RtlText style={styles.cardTitle}>בני המשפחה</RtlText>
                  {activeUsers.map((user) => <View key={user.id} style={styles.memberRow}>
                    <Pressable onPress={() => { setEditingMember(user); setMemberFormVisible(true); }} style={styles.memberIdentity} accessibilityRole="button" accessibilityLabel={`עריכת ${user.name}`}>
                      <Avatar emoji={user.avatar} color={user.color} photoUrl={user.photoUrl} size={42} />
                      <RtlText style={styles.rowTitle}>{user.name}{user.id === progress.adminUserId ? ' · מנהל/ת' : ''}</RtlText>
                      <RtlText style={styles.editRuleText}>✎</RtlText>
                    </Pressable>
                    {user.id !== progress.adminUserId && user.id !== currentUserId ? <Pressable onPress={() => confirmRemoveMember(user)} style={styles.memberAction} accessibilityRole="button" accessibilityLabel={`הסרת ${user.name}`}><RtlText style={styles.removeRuleText}>×</RtlText></Pressable> : null}
                  </View>)}
                  <Button label="הוספת בן או בת משפחה" variant="secondary" onPress={() => { setEditingMember(null); setMemberFormVisible(true); }} disabled={memberSaving} />
                </View>
                {inviteCode ? <View style={styles.card}><RtlText style={styles.cardTitle}>הזמנה בקישור או בקוד QR</RtlText><RtlText style={styles.muted}>כל מי שיצטרף יראה את פרטי הכלב והטיולים של המשפחה, בלי להקים אותם מחדש.</RtlText><Button label="הצגת קישור וקוד QR" variant="secondary" onPress={() => setSharingVisible(true)} /></View> : null}</> : <RtlText style={styles.muted}>נציג את בני המשפחה ואת אפשרויות ההזמנה אחרי שנקבל אישור שהפרופיל נשמר במשפחה.</RtlText>}
              </>
            ) : null}

            {step === 4 ? (
              <>
                <RtlText style={styles.compactBodyCopy}>בחרו כלב, שעה ואחראי/ת. אפשר לערוך כל טיול או להמשיך בלי לוח זמנים.</RtlText>
                {dogs.length > 1 ? <View style={styles.dogScheduleSelector}><RtlText style={styles.label}>לוח זמנים עבור</RtlText><View style={styles.memberChoiceRow}>{dogs.map((item) => <Pressable key={item.id} onPress={() => { setScheduleDogId(item.id); setEditingRuleId(null); }} style={[styles.memberChip, scheduleDogId === item.id && styles.memberChipActive]} accessibilityRole="button" accessibilityState={{ selected: scheduleDogId === item.id }} accessibilityLabel={`לוח טיולים של ${item.name}`}><RtlText style={[styles.memberChipText, scheduleDogId === item.id && styles.memberChipTextActive]}>{item.name}</RtlText></Pressable>)}</View></View> : null}
                <View style={styles.card}>
                  <RtlText style={styles.cardTitle}>{dogs.length > 1 ? `טיולים בכל יום · ${dogs.find((item) => item.id === scheduleDogId)?.name ?? setupDog?.name ?? 'הכלב/ה'} (${dogRules.length})` : `טיולים בכל יום (${dogRules.length})`}</RtlText>
                  {editingRuleId ? <View style={styles.editorPanel} accessibilityLabel="עריכת טיול קבוע">
                    <RtlText style={styles.label}>עריכת שעה ואחראי/ת{dogs.length > 1 ? ' וכלב/ה' : ''}</RtlText>
                    <TimePickerField value={newTime} onChange={setNewTime} webLabel="בחירת שעת טיול" />
                    {dogs.length > 1 ? <RtlText style={styles.muted}>הטיול נשאר משויך ל{dogs.find((item) => item.id === useScheduleStore.getState().rules.find((rule) => rule.id === editingRuleId)?.dogId)?.name ?? 'הכלב/ה'}; כדי לשייך כלב אחר, הוסיפו עבורו טיול נפרד.</RtlText> : null}
                    <RtlText style={styles.label}>אחראי/ת</RtlText>
                    <View style={styles.memberChoiceRow}>{activeUsers.map((user) => <Pressable key={user.id} onPress={() => setResponsibleUserId(user.id)} style={[styles.memberChip, responsibleUserId === user.id && styles.memberChipActive]} accessibilityRole="button" accessibilityState={{ selected: responsibleUserId === user.id }}><RtlText style={[styles.memberChipText, responsibleUserId === user.id && styles.memberChipTextActive]}>{user.name}</RtlText></Pressable>)}</View>
                    <Button label="שמירת עדכון הטיול" variant="secondary" disabled={busy || !responsibleUserId} loading={busy} onPress={() => void editScheduleRule()} />
                    <Pressable onPress={() => setEditingRuleId(null)} style={styles.skipLink}><RtlText style={styles.skipText}>ביטול עריכה</RtlText></Pressable>
                  </View> : null}
                  {dogRules.map((rule) => <View key={rule.id} style={styles.ruleRow}><View style={styles.ruleInfo}><RtlText style={styles.rowTitle}>{rule.time}{rule.label ? ` · ${rule.label}` : ''}</RtlText><RtlText style={styles.muted}>באחריות {usersById[rule.rotationUserIds[0]]?.name ?? 'בן/בת המשפחה'}{dogs.length > 1 ? ` · ${dogs.find((item) => item.id === rule.dogId)?.name ?? ''}` : ''}</RtlText></View><View style={styles.ruleActions}><Pressable onPress={() => { setEditingRuleId(rule.id); setNewTime(rule.time); setScheduleDogId(rule.dogId); setResponsibleUserId(rule.rotationUserIds[0] ?? responsibleUserId); }} disabled={busy} accessibilityRole="button" accessibilityLabel={`עריכת טיול בשעה ${rule.time}`} style={styles.removeRule}><RtlText style={styles.editRuleText}>✎</RtlText></Pressable><Pressable onPress={() => void removeScheduleRule(rule.id)} disabled={busy} accessibilityRole="button" accessibilityLabel={`הסרת טיול בשעה ${rule.time}`} style={styles.removeRule}><RtlText style={styles.removeRuleText}>הסרה</RtlText></Pressable></View></View>)}
                  {!editingRuleId ? <RtlText style={styles.label}>שעת טיול נוספת</RtlText> : null}
                  {!editingRuleId ? <TimePickerField value={newTime} onChange={setNewTime} webLabel="בחירת שעת טיול" /> : null}
                  {!editingRuleId ? <RtlText style={styles.label}>אחראי/ת</RtlText> : null}
                  {activeUsers.length === 0 ? <RtlText style={styles.muted} accessibilityRole="alert">לא נמצא במשפחה פרופיל פעיל שאפשר לשייך לטיול. חזרו לשלב בני המשפחה ושמרו פרופיל מנהל, ואז נסו שוב.</RtlText> : null}
                  {!editingRuleId ? <View style={styles.memberChoiceRow}>{activeUsers.map((user) => <Pressable key={user.id} onPress={() => setResponsibleUserId(user.id)} style={[styles.memberChip, responsibleUserId === user.id && styles.memberChipActive]} accessibilityRole="button" accessibilityState={{ selected: responsibleUserId === user.id }}><RtlText style={[styles.memberChipText, responsibleUserId === user.id && styles.memberChipTextActive]}>{user.name}</RtlText></Pressable>)}</View> : null}
                  {!editingRuleId ? <Button label="הוספת שעה ללוח" variant="secondary" disabled={busy || !scheduleFamilyContextValid || !dogs.some((item) => item.id === scheduleDogId && item.familyId === familyId) || !scheduleAssigneeEligible} loading={busy} onPress={() => void addCustomSchedule()} /> : null}
                  {!editingRuleId && missingSuggestedTimes.length > 0 ? <Button
                    label={missingSuggestedTimes.length === SUGGESTED_TIMES.length
                      ? 'הוספת הצעה: בוקר, צהריים וערב'
                      : `השלמת הצעה: ${missingSuggestedTimes.map((suggestion) => suggestion.label.replace('טיול ', '')).join(' ו')}`}
                    variant="secondary"
                    disabled={busy || !scheduleFamilyContextValid || !scheduleDogAvailable || !scheduleAssigneeEligible}
                    onPress={() => void addSuggestedSchedule()}
                    style={styles.suggestButton}
                  /> : null}
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
                  {allDogRules.length ? allDogRules.map((rule) => <RtlText key={rule.id} style={styles.rowTitle}>{rule.time} · {usersById[rule.rotationUserIds[0]]?.name ?? 'אחראי/ת'}{dogs.length > 1 ? ` · ${dogs.find((item) => item.id === rule.dogId)?.name ?? 'כלב/ה'}` : ''}</RtlText>) : <RtlText style={styles.muted}>אפשר להגדיר טיולים קבועים גם בהמשך.</RtlText>}
                </View>
              </>
            ) : null}

          </ScrollView>

          <View style={styles.footer}>
            {error ? <View style={styles.errorBanner}><RtlText style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</RtlText><Pressable onPress={() => {
              if (step === 2 && dogSetupRetry === 'photo') void pickDogPhoto(false);
              else if (step === 2) void continueDogStep();
              else setError(null);
            }} accessibilityRole="button" accessibilityLabel={step === 2 ? 'ניסיון חוזר' : 'סגירת הודעת השגיאה'}><RtlText style={styles.errorDismiss}>{step === 2 ? 'נסו שוב' : 'סגירה'}</RtlText></Pressable></View> : null}
            {step === 1 ? <Button label="ממשיכים להגדרת הכלב" onPress={() => void showAction(() => persistStep(2))} disabled={busy} loading={busy} /> : null}
            {step === 2 ? <Button label="המשך לבני המשפחה" onPress={() => void continueDogStep()} disabled={busy} loading={busy} /> : null}
            {step === 3 && managerProfileSaved ? <>
              <Button label="המשך להגדרת הטיולים" onPress={() => void showAction(() => persistStep(4))} disabled={busy || familyRole !== 'admin'} loading={busy} />
              <Pressable onPress={() => void persistStep(4)} disabled={busy} style={styles.skipLink} accessibilityRole="button"><RtlText style={styles.skipText}>הזמנה אחר כך · המשך</RtlText></Pressable>
            </> : null}
            {step === 4 ? <>
              <Button label="המשך לסיכום" onPress={() => void continueSchedule()} disabled={busy} loading={busy} />
              <Pressable onPress={() => void continueSchedule()} disabled={busy} style={styles.skipLink} accessibilityRole="button"><RtlText style={styles.skipText}>אגדיר טיולים אחר כך</RtlText></Pressable>
            </> : null}
            {step === 5 ? <Button label="בואו נתחיל!" onPress={() => void showAction(onComplete)} disabled={busy} loading={busy} /> : null}
            {step > 1 ? <Pressable onPress={back} disabled={busy} style={styles.backButton} accessibilityRole="button"><RtlText style={styles.backText}>{step === 5 ? 'חזרה לעריכה' : 'חזרה'}</RtlText></Pressable> : null}
          </View>
        </View>
      </KeyboardAvoidingView>

      <UserFormModal visible={memberFormVisible} editingUser={editingMember} familyId={familyId} onSave={saveMember} onClose={() => { setMemberFormVisible(false); setEditingMember(null); }} />
      <FamilySharingModal visible={sharingVisible} isSupabaseConfigured={true} inviteCode={inviteCode} isAdmin={familyRole === 'admin'} regenerating={regeneratingInvite} copyFeedback={copyFeedback} onCopy={() => void copyFamilyLink()} onShare={() => void shareFamilyLink()} onRegenerate={regenerateFamilyCode} onClose={() => setSharingVisible(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, gap: spacing.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: spacing.xl },
  shell: { flex: 1, width: '100%', maxWidth: 620, alignSelf: 'center', minWidth: 0 },
  desktopShell: { maxWidth: breakpoints.desktopContent, paddingHorizontal: spacing.xl },
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.xs, alignItems: 'stretch', gap: spacing.xs },
  returnButton: { alignSelf: 'flex-end', minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radii.xl, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface, justifyContent: 'center' },
  returnButtonText: { color: colors.primaryDark, fontWeight: '700', fontSize: 13, textAlign: 'center' },
  returnError: { color: colors.danger, textAlign: 'right', fontSize: 13 },
  progressRow: { width: '100%', flexDirection: 'row-reverse', gap: 6, marginBottom: spacing.sm },
  progressSegment: { flex: 1, height: 5, borderRadius: 4, backgroundColor: colors.border },
  progressActive: { backgroundColor: colors.primary },
  stepCount: { ...typography.meta, color: colors.primaryDark, fontWeight: '700', marginBottom: spacing.xs },
  heading: { ...typography.screenTitle, color: colors.textPrimary, textAlign: 'right', fontSize: 24 },
  scroll: { flex: 1 },
  body: { paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.xl, gap: spacing.sm, alignItems: 'stretch' },
  bodyNarrow: { paddingHorizontal: spacing.sm },
  footer: { paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.sm, gap: 2, backgroundColor: colors.background },
  card: { width: '100%', minWidth: 0, alignSelf: 'stretch', backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  dogPhotoCard: { width: '100%', minWidth: 0, alignSelf: 'stretch', backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center', gap: spacing.sm },
  photoActions: { width: '100%', gap: spacing.xs },
  flexButton: { width: '100%', minWidth: 0, flexShrink: 1 },
  cardTitle: { ...typography.cardTitle, color: colors.textPrimary, textAlign: 'right' },
  sectionTitle: { ...typography.cardTitle, color: colors.textPrimary, textAlign: 'right' },
  bodyCopy: { ...typography.body, color: colors.textSecondary, textAlign: 'right', lineHeight: 24, flexShrink: 1, minWidth: 0 },
  compactBodyCopy: { ...typography.meta, color: colors.textSecondary, textAlign: 'right', lineHeight: 20, flexShrink: 1, minWidth: 0 },
  muted: { ...typography.meta, color: colors.textSecondary, textAlign: 'right', lineHeight: 21 },
  label: { ...typography.meta, color: colors.textPrimary, textAlign: 'right', fontWeight: '700', marginTop: spacing.xs },
  input: { minHeight: 50, alignSelf: 'stretch', minWidth: 0, borderRadius: radii.md, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, paddingHorizontal: spacing.md, color: colors.textPrimary, fontSize: 16, writingDirection: 'rtl' },
  sexChoiceRow: { flexDirection: 'row-reverse', gap: spacing.sm },
  sexChoice: { flex: 1, minHeight: 48, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  sexChoiceActive: { borderColor: colors.primary, backgroundColor: colors.statusCurrentBg },
  sexChoiceText: { color: colors.textSecondary, fontWeight: '600' },
  sexChoiceTextActive: { color: colors.primaryDark, fontWeight: '800' },
  summaryRow: { width: '100%', minWidth: 0, minHeight: 48, flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  memberRow: { width: '100%', minWidth: 0, minHeight: 52, flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: spacing.xs },
  memberIdentity: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.xs },
  memberAction: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, backgroundColor: colors.surfaceMuted },
  rowTitle: { ...typography.body, color: colors.textPrimary, textAlign: 'right', fontWeight: '700', flexShrink: 1, minWidth: 0 },
  ruleRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: spacing.sm },
  ruleInfo: { flex: 1, minWidth: 0, alignItems: 'flex-end', gap: 2 },
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
  dogScheduleSelector: { width: '100%', gap: spacing.xs },
  editorPanel: { width: '100%', minWidth: 0, padding: spacing.sm, borderRadius: radii.md, backgroundColor: colors.surfaceMuted, gap: spacing.xs },
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
