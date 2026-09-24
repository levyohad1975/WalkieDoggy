import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { RtlText } from '../components/RtlText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFamilyStore } from '../store/familyStore';
import { useScheduleStore } from '../store/scheduleStore';
import { useAuthStore, useEffectiveFamilyRole, useEffectiveUserId } from '../store/authStore';
import { colors } from '../theme/colors';
import { Button } from '../components/Button';
import { DogPhoto } from '../components/DogPhoto';
import { breakpoints, nativeDirection, radii, spacing, typography } from '../theme/tokens';
import { pickAndUploadImage } from '../lib/uploadImage';
import {
  isSupabaseConfigured,
  regenerateInviteCode,
} from '../lib/supabase';
import { friendlyErrorMessage } from '../lib/errorMessages';
import { copyToClipboard } from '../lib/clipboard';
import { DEMO_FAMILY } from '../data/demoData';
import type { Dog, Walk } from '../types';
import { UserPickerModal } from '../components/UserPickerModal';
import { PinEntryModal } from '../components/PinEntryModal';
import { AdminAuditLogModal } from '../components/AdminAuditLogModal';
import { DogDetailsModal } from '../components/DogDetailsModal';
import { RemindersModal } from '../components/RemindersModal';
import { FamilySharingModal } from '../components/FamilySharingModal';
import { guardTestModeMutation } from '../lib/testModeGuard';
import { decideChildModalToOpen, type SettingsChildModal } from '../logic/settingsModalTransitions';
import { generateId } from '../lib/id';
import { useHealthStore } from '../store/healthStore';
import { HealthGroomingModal } from '../components/HealthGroomingModal';
import { useAchievementStore } from '../store/achievementStore';
import { AchievementsModal } from '../components/AchievementsModal';
import { computeFamilyAchievementProgress, computePersonalAchievementProgress } from '../logic/achievements';
import { fetchHistoryWalks } from '../lib/permissionedWalks';
import { listSwapRequests, type SwapRequestRow } from '../lib/requests';
import { PrivacyAccessibilityInfoModal } from '../components/PrivacyAccessibilityInfoModal';
import { useSystemAdminStore } from '../store/systemAdminStore';
import { SystemAdminScreen } from './SystemAdminScreen';
import { ScreenRecoveryBoundary } from '../components/ScreenRecoveryBoundary';

export function SettingsScreen() {
  return (
    <ScreenRecoveryBoundary screenName="הגדרות">
      <SettingsScreenContent />
    </ScreenRecoveryBoundary>
  );
}

function SettingsScreenContent() {
  const { family, users, dog, dogs, selectedDogId, load: loadFamily, setReminderEnabled, setGamificationEnabled, saveDog, selectDog, deleteUnusedDog } = useFamilyStore();
  const healthTasks = useHealthStore((s) => s.tasks);
  const loadHealthTasks = useHealthStore((s) => s.load);
  const saveHealthTask = useHealthStore((s) => s.saveTask);
  const completeHealthTask = useHealthStore((s) => s.completeTask);
  const { currentUserId, setFamilyId } = useAuthStore();
  const signInWithPin = useAuthStore((s) => s.signInWithPin);
  const signOut = useAuthStore((s) => s.signOut);
  const familyId = useAuthStore((s) => s.familyId) ?? DEMO_FAMILY.id;
  // Single source of truth for admin/member permissions — see authStore.
  // REAL role — deliberately NOT the effective/simulated one. This gates
  // the "ניהול (מנהל בלבד)" section below (test-mode entry/exit, activity,
  // audit), which must stay usable by the real Admin even while a
  // simulation is active, so they can always get back out of it.
  const familyRole = useAuthStore((s) => s.familyRole);
  // Effective role — 'member' while simulating one — for every OTHER,
  // ordinary member-facing permission check on this screen (reminders
  // toggle, invite-code regeneration), so Settings renders consistently
  // with Home/Schedule/Family during a simulation.
  const effectiveFamilyRole = useEffectiveFamilyRole();
  // Effective, not raw, for the reminders-toggle disabled check below — an
  // ordinary member-facing control, so it should read as the SIMULATED
  // member's own row being enabled, not the real Admin's row (same bug
  // class as FamilyScreen's self-edit affordance). Display-only —
  // setReminderEnabled() itself is still blocked in Test Mode either way.
  const effectiveUserId = useEffectiveUserId();
  // Legacy Test Mode state remains in authStore for compatibility; no Settings UI exposes it.
  const testModeUserId = useAuthStore((s) => s.testModeUserId);
  const [auditLogModalVisible, setAuditLogModalVisible] = useState(false);
  // Section 12: Settings is now a concise hub — each focused area opens as
  // its own sub-screen (modal, matching this app's existing navigation
  // pattern) instead of all being visible on the main list at once.
  const [dogModalVisible, setDogModalVisible] = useState(false);
  const [addingDog, setAddingDog] = useState(false);
  const [deletingDog, setDeletingDog] = useState(false);
  const [healthModalVisible, setHealthModalVisible] = useState(false);
  const [achievementsModalVisible, setAchievementsModalVisible] = useState(false);
  // PRD §9 gamification — the same permissioned bulk-historical read
  // HomeScreen's checkForNewAchievementUnlocks() uses (see that file's own
  // doc comment on why family-wide milestones need this instead of
  // scheduleStore's RLS-windowed `walks`). Loaded lazily, only once the
  // Achievements sheet is actually opened — same convention as
  // healthModalVisible/loadHealthTasks below.
  const [achievementWalks, setAchievementWalks] = useState<Walk[]>([]);
  // "החלפה הוגנת" (fair swap) needs approved swap history — Supabase-only,
  // same posture as achievementWalks above; simply stays empty in
  // local/demo mode (lib/requests.ts's own doc comment: no swap-request
  // concept exists there at all) rather than failing.
  const [achievementSwapRequests, setAchievementSwapRequests] = useState<SwapRequestRow[]>([]);
  const [privacyAccessibilityModalVisible, setPrivacyAccessibilityModalVisible] = useState(false);
  const [remindersModalVisible, setRemindersModalVisible] = useState(false);
  const [sharingModalVisible, setSharingModalVisible] = useState(false);
  const [managementVisible, setManagementVisible] = useState(false);
  const isSystemAdmin = useSystemAdminStore((state) => state.isSystemAdmin);
  const systemObserverActive = useAuthStore((state) => state.systemObserverActive);
  const [systemAdminVisible, setSystemAdminVisible] = useState(false);
  // NESTED-MODAL LIFECYCLE FIX (final QA round) — see
  // logic/settingsModalTransitions.ts's doc comment for the full mechanism.
  // "יומן פעילות" used to open its own Modal directly while the Management
  // Modal stayed visible=true; it instead sets this pending flag and closes
  // Management first — the child only actually opens once Management's
  // dismissal has genuinely completed (see the onDismiss/useEffect wiring
  // below).
  //
  // BATCH 3 (Task 1): "👥 מי משתמש במערכת" (which used the SAME
  // pending-child mechanism, target 'activity') was removed from this
  // screen — member/presence management is now centralized in FamilyScreen
  // (its member list already shows role + presence, sourced from the same
  // adminListFamilyActivity() RPC AdminActivityModal used). This mechanism
  // itself, and settingsModalTransitions.ts's SettingsChildModal type
  // (still `'activity' | 'auditLog'`), are left exactly as they were —
  // only this screen's own producers of 'activity' are removed below, so a
  // future re-add doesn't require touching that shared logic file again.
  const [pendingChildModal, setPendingChildModal] = useState<SettingsChildModal | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | undefined>(undefined);
  const [regenerating, setRegenerating] = useState(false);
  // NARROW CLIENT-FLOW FIX ("switch user"): "החלף משתמש" is a real,
  // server-verified profile SWITCH from the very first tap, not a
  // sign-out-then-hope-plain-claim-works flow (see handleSwitchUser's own
  // doc comment below for the full before/after). Two-step local UI state:
  // pick a target from switchUserPickerVisible's UserPickerModal, then
  // ALWAYS verify via switchTargetUserId's PinEntryModal — never a plain
  // claim attempt first, regardless of whether the target happens to be
  // currently unclaimed or claimed by another device. currentUserId itself
  // is deliberately never touched by any of this until signInWithPin()
  // actually succeeds.
  const [switchUserPickerVisible, setSwitchUserPickerVisible] = useState(false);
  const [switchTargetUserId, setSwitchTargetUserId] = useState<string | null>(null);

  useEffect(() => {
    loadFamily(familyId);
  }, [loadFamily, familyId]);

  useEffect(() => {
    setInviteCode(family?.inviteCode);
  }, [family?.inviteCode]);

  // Health/grooming records are per-DOG (0049) — only load once the modal
  // is actually opened, and reload whenever the active dog changes while
  // it's open (switching dogs via the selector strip above while this sheet
  // is up must not keep showing the previous dog's records).
  useEffect(() => {
    if (healthModalVisible && dog) {
      void loadHealthTasks(dog.id);
    }
  }, [healthModalVisible, dog?.id, loadHealthTasks]);

  useEffect(() => {
    if (!achievementsModalVisible) return;
    void useAchievementStore.getState().load(familyId);
    if (!isSupabaseConfigured) {
      setAchievementWalks(useScheduleStore.getState().walks);
      setAchievementSwapRequests([]);
      return;
    }
    fetchHistoryWalks()
      .then(setAchievementWalks)
      .catch(() => setAchievementWalks([]));
    listSwapRequests()
      .then(setAchievementSwapRequests)
      .catch(() => setAchievementSwapRequests([]));
  }, [achievementsModalVisible, familyId]);

  // Cross-tab "open Health & Grooming" signal from Home's summary badge —
  // see healthStore's pendingOpenRequest doc comment. Consumed (and
  // cleared) only while this tab actually has focus, so it can never fire
  // while Settings merely happens to be mounted in the background.
  useFocusEffect(
    useCallback(() => {
      if (useHealthStore.getState().consumePendingOpenRequest()) {
        setHealthModalVisible(true);
      }
    }, [])
  );

  // NESTED-MODAL LIFECYCLE FIX (final QA round), non-iOS path: Modal's
  // onDismiss is iOS-only, so on Android (or any other platform) there is
  // no native "dismissal actually finished" callback to wait for — the
  // ordinary state-driven signal is `managementVisible` itself having
  // become false. See logic/settingsModalTransitions.ts's doc comment for
  // why iOS uses onDismiss instead (handled below, not here).
  useEffect(() => {
    if (Platform.OS === 'ios') return; // iOS uses Modal's own onDismiss instead — see below.
    const toOpen = decideChildModalToOpen(
      { managementVisible, pendingChildModal },
      'visibility-effect'
    );
    if (!toOpen) return;
    setPendingChildModal(null);
    // Explicit per-value branch — this screen no longer ever produces
    // 'activity' (Task 1), but the check stays explicit rather than a
    // generic else/default so a future real 'activity' re-add can't be
    // silently misrouted.
    if (toOpen === 'auditLog') setAuditLogModalVisible(true);
}, [managementVisible, pendingChildModal]);

  /** Request Management to close and, once it genuinely has, open `child`. */
  const openChildAfterManagementCloses = (child: SettingsChildModal) => {
    setPendingChildModal(child);
    setManagementVisible(false);
  };

  /** iOS path: wired to the Management Modal's own onDismiss prop below. */
  const handleManagementDismissed = () => {
    const toOpen = decideChildModalToOpen(
      { managementVisible: false, pendingChildModal },
      'ios-native-dismiss'
    );
    if (!toOpen) return;
    setPendingChildModal(null);
    // See the visibility-effect above's identical comment.
    if (toOpen === 'auditLog') setAuditLogModalVisible(true);
};

  // CRASH BUG FIX (final QA round): this file used to also have
  // `useEffect(() => { if (dog) { setDogName(dog.name); setDogNotes(...); }
  // }, [dog])` here — leftover from before the Section 12 refactor moved
  // dog name/notes editing state into DogDetailsModal itself. `setDogName`/
  // `setDogNotes` were never defined anywhere in this file (no local
  // `useState` for them, no import) — the effect threw a ReferenceError
  // every time `dog` became truthy, i.e. on essentially every load of this
  // screen once family data arrived. An error thrown inside a `useEffect`
  // is an uncaught render-phase error with no boundary here, which is a
  // very plausible concrete explanation for "Settings can become
  // non-interactive" independent of any modal-geometry issue. Removed
  // outright rather than reintroducing the two setters: DogDetailsModal
  // already owns this exact state via its own `useEffect(() => { if
  // (visible && dog) { setName(dog.name); setNotes(...) } }, [visible,
  // dog])`, so nothing here needs replacing.
  const currentUser = currentUserId ? users.find((u) => u.id === currentUserId) : undefined;
  const gamificationEnabled = currentUser?.gamificationEnabled ?? true;
  const familyAchievementProgress = useMemo(() => computeFamilyAchievementProgress(achievementWalks), [achievementWalks]);
  const personalAchievementProgress = useMemo(
    () => (currentUserId ? computePersonalAchievementProgress(achievementWalks, currentUserId, achievementSwapRequests) : []),
    [achievementWalks, currentUserId, achievementSwapRequests]
  );

  const persistDog = async (patch: Partial<Dog>) => {
    if (!dog) return;
    await saveDog({ ...dog, ...patch });
  };

  const changeDogPhoto = async () => {
    if (!dog) return;
    setUploadingPhoto(true);
    try {
      const uri = await pickAndUploadImage('dogs', familyId, dog.id);
      if (uri) await persistDog({ photoUrl: uri });
    } catch {
      Alert.alert('לא הצלחנו להחליף תמונה', 'בדקו הרשאת תמונות וחיבור לאינטרנט ונסו שוב.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  // Arbitrary-N multi-dog foundation (Phase 1B): creates a new dog for this
  // family, selects it (so the existing dog card below — and every other
  // dog-dependent screen reading `dog` from the store — immediately reflects
  // it), and opens the same edit sheet used for any dog so the admin can
  // rename it right away instead of living with a placeholder name.
  const handleAddDog = async () => {
    if (!guardTestModeMutation()) return;
    setAddingDog(true);
    try {
      const newDog: Dog = {
        id: generateId('dog'),
        familyId,
        name: 'כלב חדש',
        walksPerDay: 4,
      };
      await saveDog(newDog);
      await selectDog(newDog.id);
      setDogModalVisible(true);
    } catch {
      Alert.alert('לא הצלחנו להוסיף כלב', 'נסו שוב בעוד רגע.');
    } finally {
      setAddingDog(false);
    }
  };

  const confirmDeleteDog = () => {
    if (!dog || effectiveFamilyRole !== 'admin' || systemObserverActive || deletingDog) return;
    const remove = async () => {
      setDeletingDog(true);
      try {
        await deleteUnusedDog(dog.id);
        setDogModalVisible(false);
      } catch (e) {
        Alert.alert('לא ניתן למחוק את הכלב', friendlyErrorMessage(e) || 'אפשר למחוק רק כלב שנוסף בטעות ושעדיין אין לו טיולים, לוח זמנים או היסטוריה.');
      } finally {
        setDeletingDog(false);
      }
    };
    const message = 'למחוק את הכלב מהמשפחה? ניתן למחוק רק כלב ללא טיולים, לוח זמנים או היסטוריה.';
    if (Platform.OS === 'web') {
      const confirm = (globalThis as typeof globalThis & { confirm?: (message?: string) => boolean }).confirm;
      if (confirm?.(message)) void remove();
      return;
    }
    Alert.alert('מחיקת כלב', message, [
      { text: 'ביטול', style: 'cancel' },
      { text: 'מחיקה', style: 'destructive', onPress: () => void remove() },
    ]);
  };

  const removeDogPhoto = () => {
    if (!dog?.photoUrl) return;
    const remove = async () => {
      try {
        await persistDog({ photoUrl: undefined });
      } catch {
        Alert.alert('לא הצלחנו להסיר את התמונה', 'נסו שוב בעוד רגע.');
      }
    };

    // React Native's Alert is not reliably presented by the Safari Web
    // build. Use the browser confirmation there, so the visible control
    // actually removes the photo instead of appearing unresponsive.
    if (Platform.OS === 'web') {
      const confirm = (globalThis as typeof globalThis & { confirm?: (message?: string) => boolean }).confirm;
      if (confirm?.('להסיר את תמונת הכלב?')) void remove();
      return;
    }

    Alert.alert(
      'להסיר את תמונת הכלב?',
      'התמונה תוסר והמסקוט של Walkie Doggy יוצג שוב במקום תמונת הכלב.',
      [
        { text: 'ביטול', style: 'cancel' },
        {
          text: 'הסר תמונה',
          style: 'destructive',
          onPress: () => void remove(),
        },
      ]
    );
  };

  // BATCH 4 (item E — Copy Family Code). `copyFeedback` drives the inline
  // "✓ הועתק" success state FamilySharingModal renders next to the button
  // (in addition to, not instead of, the existing Alert — belt and
  // suspenders for something people rely on to actually work). On genuine
  // clipboard failure, shows clear failure feedback rather than silently
  // doing nothing, AND still leaves the code plainly visible/selectable in
  // the modal's code card as a manual-copy fallback (FamilySharingModal
  // renders the code inside a selectable Text/TextInput — see that file).
  const [copyFeedback, setCopyFeedback] = useState<'idle' | 'success' | 'error'>('idle');
  const copyInviteCode = async () => {
    if (!inviteCode) return;
    const ok = await copyToClipboard(inviteCode);
    if (ok) {
      setCopyFeedback('success');
      Alert.alert('הקוד הועתק', `קוד המשפחה ${inviteCode} הועתק ללוח.`);
    } else {
      setCopyFeedback('error');
      Alert.alert(
        'לא הצלחנו להעתיק',
        `אפשר להעתיק ידנית — לחצו לחיצה ארוכה על הקוד (${inviteCode}) כדי לבחור ולהעתיק אותו.`
      );
    }
    setTimeout(() => setCopyFeedback('idle'), 2200);
  };

  const shareInviteCode = async () => {
    if (!inviteCode) return;
    try {
      await Share.share({
        message: `הצטרפו למשפחה שלנו באפליקציית Walkie Doggy Link! קוד ההצטרפות: ${inviteCode}`,
      });
    } catch {
      // best-effort — sharing is a convenience, not critical
    }
  };

  const confirmRegenerateInviteCode = () => {
    if (!familyId) return;
    // regenerateInviteCode() is a direct lib/supabase.ts RPC call, not a
    // familyStore action, so it isn't covered by the centralized store-level
    // guard (scheduleStore/familyStore/requestsStore) — guard it here too,
    // defense-in-depth alongside the button already being hidden while
    // simulating (effectiveFamilyRole above).
    if (!guardTestModeMutation()) return;
    Alert.alert(
      'להחליף את קוד ההצטרפות?',
      'הקוד הישן יפסיק לעבוד להצטרפות חדשה. מכשירים שכבר הצטרפו ימשיכו לעבוד כרגיל.',
      [
        { text: 'ביטול', style: 'cancel' },
        {
          text: 'החלפה',
          style: 'destructive',
          onPress: async () => {
            setRegenerating(true);
            try {
              const newCode = await regenerateInviteCode(familyId);
              setInviteCode(newCode);
            } catch {
              Alert.alert('אופס', 'לא הצלחנו להחליף את הקוד — נסו שוב');
            } finally {
              setRegenerating(false);
            }
          },
        },
      ]
    );
  };



  // "החלף משתמש" — NARROW CLIENT-FLOW FIX.
  //
  // OLD (buggy) sequence: tap "החלף משתמש" -> authStore.signOut() (clears
  // ONLY local currentUserId, never touches the server-side claim) ->
  // App.tsx's `currentUserId ? <RootNavigator/> : <LoginScreen/>` branch
  // drops to LoginScreen -> tapping a name there calls plain signIn(userId)
  // -> claim_family_profile(). For a same-device switch (this device's OLD
  // persona, e.g. Dad, is STILL server-claimed — signOut() never released
  // it), claim_family_profile()'s guarded UPDATE can collide with the
  // UNIQUE constraint on users.auth_user_id (Dad's row still holds THIS
  // device's auth.uid() when the plain claim tries to also give Idan's row
  // the same auth.uid()). LoginScreen only routes to PinEntryModal when it
  // sees the SPECIFIC 'profile already claimed by another device' string —
  // a same-device unique-constraint failure doesn't match that condition,
  // so the person could get stuck with a raw claim error and no obvious way
  // to actually complete the switch, on top of already having been dropped
  // out to a signed-out LoginScreen state for no good reason.
  //
  // NEW sequence: tap "החלף משתמש" -> a target picker (this device's OWN
  // signOut()/LoginScreen are never invoked) -> PIN entry for the CHOSEN
  // target, unconditionally (never a plain claim attempt first — this IS a
  // switch-away-from-a-currently-active-identity flow, not a bootstrap/
  // unclaimed-profile flow, so it always goes through the same atomic,
  // PIN-verified claim_family_profile_with_pin() regardless of whether the
  // target happens to be currently unclaimed or held by another device) ->
  // on success, signInWithPin() (authStore.ts, unchanged this pass) has
  // already atomically released this device's old claim and claimed the
  // new one server-side, verified it via whoami(), refreshed familyRole,
  // and set currentUserId — done. A wrong PIN or Cancel leaves
  // currentUserId (and the server-side claim) completely untouched, because
  // nothing above ever calls signOut() or otherwise clears currentUserId
  // before the PIN actually succeeds — so the user never leaves their
  // current profile/RootNavigator, and there is no intermediate signed-out
  // LoginScreen state at all for this flow.
  const handleSwitchUser = () => {
    setSwitchUserPickerVisible(true);
  };

  const handleSwitchUserPinSubmit = async (pin: string) => {
    if (!switchTargetUserId) return;
    try {
      await signInWithPin(switchTargetUserId, pin);
    } catch (err) {
      // Re-throw as a friendly Hebrew message — PinEntryModal displays
      // whatever Error.message it catches directly (same pattern as
      // LoginScreen's handlePinReclaim).
      throw new Error(friendlyErrorMessage(err));
    }
    setSwitchTargetUserId(null);
  };

  // PRD §16: "keep a clear support channel from within the app; the final
  // support address should come from configuration, not be scattered in
  // code." The row itself is hidden entirely (see the section below) when
  // this isn't set — never a broken mailto: link to a placeholder.
  const supportEmail = process.env.EXPO_PUBLIC_SUPPORT_EMAIL;
  const handleContactSupport = async () => {
    if (!supportEmail) return;
    try {
      await Linking.openURL(`mailto:${supportEmail}`);
    } catch {
      Alert.alert('לא הצלחנו לפתוח את האימייל', `אפשר לפנות ידנית לכתובת ${supportEmail}.`);
    }
  };

  // PRD §16 pairs "תמיכה ויציאה" (support AND sign-out) in the same
  // sentence — a genuine full sign-out, distinct from "החלף משתמש" (which
  // only ever switches to another profile, never leaves the app signed
  // out entirely). authStore.signOut() already has its own fail-safe
  // contract (always completes locally even offline/on RPC failure) — see
  // its own doc comment — so this just needs the confirmation.
  const handleSignOut = () => {
    const performSignOut = () => void signOut();

    // React Native's Alert is not reliably surfaced in the Safari Web
    // build, which made the visible row appear inert. Use the browser's
    // confirmation there; native iOS/Android retain the platform dialog.
    if (Platform.OS === 'web') {
      const confirm = (globalThis as typeof globalThis & { confirm?: (message?: string) => boolean }).confirm;
      if (confirm?.('להתנתק מהמכשיר הזה? תצטרכו להזין קוד PIN כדי להתחבר שוב.')) performSignOut();
      return;
    }

    Alert.alert('להתנתק מהמכשיר הזה?', 'תצטרכו להזין קוד PIN כדי להתחבר שוב.', [
      { text: 'ביטול', style: 'cancel' },
      { text: 'התנתקות', style: 'destructive', onPress: performSignOut },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.content, Platform.OS === 'web' && styles.webContent]}
        keyboardShouldPersistTaps="handled"
      >
        <RtlText style={styles.header} accessibilityRole="header" maxFontSizeMultiplier={1.35}>הגדרות</RtlText>

        {/*
          FINAL CORRECTION PASS — Deliverable 3C, the approved Design 3
          hybrid: a dog card up top (identity-first — this is a dog-walking
          app, the dog leads), then ordinary grouped settings rows (family management already has its
          own bottom tab, so Settings does not duplicate it), with admin/QA kept as its own
          clearly separate advanced area (unchanged Management sheet below)
          rather than mixed into these rows.
        */}
        {/*
          Arbitrary-N multi-dog foundation (Phase 1B): a compact selector
          strip above the existing dog card — tapping a chip makes that dog
          the ACTIVE one (selectDog(), persisted so it survives a restart),
          which the card right below (and Home's dog card, next-walk
          creation, etc. — every screen that reads `dog` from the store)
          then reflects with no further change. Editing a specific dog is
          "select it, then tap the card below" rather than a second edit
          affordance per chip, to keep this one coherent interaction instead
          of duplicating the edit entry point.
        */}
        {dog ? (
          <Pressable
            style={styles.dogCard}
            onPress={() => setDogModalVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={`פרטי ${dog.name}, לעריכה`}
          >
            <RtlText style={styles.hubChevron}>‹</RtlText>
            <View style={styles.dogCardBody}>
              <RtlText style={styles.dogCardName} numberOfLines={1}>
                {dog.name}
              </RtlText>
              <RtlText style={styles.dogCardMeta}>לחצו לעריכת פרטי הכלב</RtlText>
            </View>
            <DogPhoto photoUrl={dog.photoUrl} size={64} />
          </Pressable>
        ) : null}



        {/* Ordinary settings rows — organized into clearly labeled areas
            (family, walks & reminders, health & grooming, my account)
            instead of one long undifferentiated list, so the growing
            feature set stays scannable. Same rows/handlers/modals as
            before this reorganization — purely grouped and labeled, no
            admin/QA tools mixed in here (those stay their own separate
            "⚙️ ניהול" advanced area below). */}
        <View style={styles.section}>
          <RtlText style={styles.sectionTitle}>👪 משפחה</RtlText>
          <Pressable style={styles.hubRow} onPress={() => setSharingModalVisible(true)} accessibilityRole="button" accessibilityLabel="שיתוף המשפחה">
            <RtlText style={styles.hubChevron}>‹</RtlText>
            <RtlText style={styles.hubLabel}>📤 שיתוף המשפחה</RtlText>
          </Pressable>
        </View>

        <View style={styles.section}>
          <RtlText style={styles.sectionTitle}>🐾 טיולים ותזכורות</RtlText>
          <Pressable style={styles.hubRow} onPress={() => setRemindersModalVisible(true)} accessibilityRole="button" accessibilityLabel="תזכורות">
            <RtlText style={styles.hubChevron}>‹</RtlText>
            <RtlText style={styles.hubLabel}>🔔 תזכורות</RtlText>
          </Pressable>
        </View>

        {dog ? (
          <View style={styles.section}>
            <RtlText style={styles.sectionTitle}>בריאות וטיפוח</RtlText>
            <Pressable style={styles.hubRow} onPress={() => setHealthModalVisible(true)} accessibilityRole="button" accessibilityLabel={`בריאות וטיפוח, ${dog.name}`}>
              <RtlText style={styles.hubChevron}>‹</RtlText>
              <RtlText style={styles.hubLabel}>🏥 בריאות וטיפוח</RtlText>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.section}>
          <Pressable style={styles.hubRow} onPress={() => setAchievementsModalVisible(true)} accessibilityRole="button" accessibilityLabel="הישגים">
            <RtlText style={styles.hubChevron}>‹</RtlText>
            <RtlText style={styles.hubLabel}>הישגים 🏆</RtlText>
          </Pressable>
        </View>

        {/* PRD §16: Settings must include "פרטיות/GPS, נגישות/Reduced
            Motion" as their own entries — both are informational facts
            about this app's behavior (see PrivacyAccessibilityInfoModal's
            own doc comment), not settings configured here, so this is a
            single small entry point rather than a toggle-filled section. */}
        <View style={styles.section}>
          <RtlText style={styles.sectionTitle}>🔒 פרטיות ונגישות</RtlText>
          <Pressable
            style={styles.hubRow}
            onPress={() => setPrivacyAccessibilityModalVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="פרטיות ו-GPS, נגישות ותנועה מופחתת"
          >
            <RtlText style={styles.hubChevron}>‹</RtlText>
            <RtlText style={styles.hubLabel}>🛰️ מיקום, GPS ונגישות</RtlText>
          </Pressable>
        </View>

        {familyRole === 'admin' ? (
          <View style={styles.section}>
            <RtlText style={styles.sectionTitle}>🛠️ מתקדם</RtlText>
            <Pressable style={styles.hubRow} onPress={() => setManagementVisible(true)} accessibilityRole="button" accessibilityLabel="ניהול, למנהל בלבד">
              <RtlText style={styles.hubChevron}>‹</RtlText>
              <View style={styles.hubLabelWithMeta}>
                <RtlText style={styles.hubLabel}>⚙️ ניהול</RtlText>
                <RtlText style={styles.hubRowMeta}>יומן פעילות</RtlText>
              </View>
            </Pressable>
          </View>
        ) : null}

      </ScrollView>
      </KeyboardAvoidingView>

      {isSystemAdmin && !systemObserverActive ? (
        <Pressable
          style={styles.systemAdminFab}
          onPress={() => setSystemAdminVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="ניהול מערכת"
        >
          <RtlText style={styles.systemAdminFabText}>🛡️</RtlText>
        </Pressable>
      ) : null}

      <SystemAdminScreen visible={systemAdminVisible} onClose={() => setSystemAdminVisible(false)} />

      <UserPickerModal
        visible={switchUserPickerVisible}
        title="להתחבר כמי?"
        users={users.filter((u) => !u.removedAt)}
        excludeUserId={currentUserId ?? undefined}
        onSelect={(userId) => {
          setSwitchUserPickerVisible(false);
          // Always route to PIN verification next — never a plain
          // claim_family_profile() attempt first. See handleSwitchUser's
          // doc comment above for exactly why.
          setSwitchTargetUserId(userId);
        }}
        onClose={() => setSwitchUserPickerVisible(false)}
      />

      <PinEntryModal
        visible={switchTargetUserId !== null}
        userName={users.find((u) => u.id === switchTargetUserId)?.name ?? ''}
        subtitle="הזינו את קוד ה-PIN של הפרופיל הזה כדי לעבור אליו במכשיר הזה."
        onSubmit={handleSwitchUserPinSubmit}
        onCancel={() => setSwitchTargetUserId(null)}
      />

      <AdminAuditLogModal visible={auditLogModalVisible} onClose={() => setAuditLogModalVisible(false)} />

      <DogDetailsModal
        visible={dogModalVisible}
        dog={dog ?? null}
        uploadingPhoto={uploadingPhoto}
        onChangePhoto={changeDogPhoto}
        onRemovePhoto={removeDogPhoto}
        onAddDog={() => void handleAddDog()}
        onDeleteDog={effectiveFamilyRole === 'admin' && !systemObserverActive ? confirmDeleteDog : undefined}
        deletingDog={deletingDog}
        onSave={persistDog}
        onClose={() => setDogModalVisible(false)}
      />

      <HealthGroomingModal
        visible={healthModalVisible}
        dog={dog ?? null}
        tasks={healthTasks}
        users={users}
        currentUserId={currentUserId}
        onSave={saveHealthTask}
        onComplete={(taskId) => completeHealthTask(taskId, currentUserId ?? '')}
        onClose={() => setHealthModalVisible(false)}
      />

      <AchievementsModal
        visible={achievementsModalVisible}
        familyProgress={familyAchievementProgress}
        personalProgress={personalAchievementProgress}
        gamificationEnabled={gamificationEnabled}
        onSetGamificationEnabled={(enabled) => {
          if (currentUserId) void setGamificationEnabled(currentUserId, enabled);
        }}
        onClose={() => setAchievementsModalVisible(false)}
      />

      <PrivacyAccessibilityInfoModal
        visible={privacyAccessibilityModalVisible}
        onClose={() => setPrivacyAccessibilityModalVisible(false)}
      />

      <RemindersModal
        visible={remindersModalVisible}
        users={users}
        effectiveFamilyRole={effectiveFamilyRole}
        effectiveUserId={effectiveUserId}
        onSetReminderEnabled={setReminderEnabled}
        onClose={() => setRemindersModalVisible(false)}
      />

      <FamilySharingModal
        visible={sharingModalVisible}
        isSupabaseConfigured={isSupabaseConfigured}
        inviteCode={inviteCode}
        isAdmin={effectiveFamilyRole === 'admin'}
        regenerating={regenerating}
        copyFeedback={copyFeedback}
        onCopy={copyInviteCode}
        onShare={shareInviteCode}
        onRegenerate={confirmRegenerateInviteCode}
        onClose={() => setSharingModalVisible(false)}
      />
      <Modal
        visible={managementVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setManagementVisible(false)}
        // iOS-only; ignored on other platforms (see the visibility-effect
        // above, which covers those instead). Fires once the native
        // dismissal animation has genuinely finished — the real completion
        // signal, not a guessed delay.
        onDismiss={handleManagementDismissed}
      >
        <Pressable style={styles.backdrop} onPress={() => setManagementVisible(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <ScrollView style={styles.sheetScroll} keyboardShouldPersistTaps="handled">
              <RtlText style={styles.title} accessibilityRole="header">⚙️ ניהול</RtlText>

              {/*
                BATCH 3 (Task 1): "👥 מי משתמש במערכת" removed from here —
                member list + role + presence management is now centralized
                in the Family tab (FamilyScreen.tsx), which already shows
                exactly this information per-member (see that screen's
                activity loading, sourced from the same
                adminListFamilyActivity() RPC AdminActivityModal used).
              */}
              {isSupabaseConfigured ? (
                <Button label="📋 יומן פעילות" variant="secondary" onPress={() => openChildAfterManagementCloses('auditLog')} style={styles.addButton} />
              ) : (
                <RtlText style={styles.dogMeta}>יומן פעילות זמין רק כשהאפליקציה מחוברת ל-Supabase.</RtlText>
              )}
              {supportEmail ? (
                <Button label="✉️ פנייה לתמיכה" variant="secondary" onPress={() => void handleContactSupport()} style={styles.addButton} />
              ) : null}
              <Button label="🚪 ניתוק המכשיר" variant="secondary" onPress={handleSignOut} style={styles.addButton} />

              <Button label="סגור" variant="secondary" onPress={() => setManagementVisible(false)} style={styles.addButton} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  systemAdminFab: { position: 'absolute', right: spacing.lg, bottom: spacing.xl, width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, elevation: 6 },
  systemAdminFabText: { fontSize: 25 },
  flex: { flex: 1 },
  content: { padding: spacing.xl, gap: spacing.xxl, paddingBottom: spacing.xxxl },
  // Same desktop-containment pattern as HomeScreen's webContent: cap and
  // center the scroll content on web only — native is unaffected (RN's
  // ScrollView contentContainerStyle already renders full-width there, and
  // this repo's design intent is a bounded desktop column, not native).
  // `alignSelf: center` alone lets the Web ScrollView content shrink to its
  // intrinsic width on a phone. Keep the desktop cap, but explicitly fill
  // the mobile viewport so every settings card matches the other screens.
  webContent: { width: '100%', maxWidth: breakpoints.desktopContent, alignSelf: 'center' },
  header: { width: '100%', ...typography.screenTitle, color: colors.textPrimary, textAlign: 'right', writingDirection: 'rtl' },
  section: { gap: spacing.sm },
  sectionTitle: { width: '100%', ...typography.sectionTitle, fontSize: 18, color: colors.textPrimary, textAlign: 'right', writingDirection: 'rtl' },
  dogMeta: { fontSize: 14, color: colors.textSecondary, textAlign: 'right' },
  addButton: { marginTop: spacing.xs },
  // Settings hub rows — consistent min-height (tokens.layout.rowHeight)
  // across every row, whether it has a subtitle (hubLabelWithMeta) or not.
  hubRow: {
    flexDirection: 'row',
    ...nativeDirection('ltr'),
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: 56,
  },
  hubLabel: { flex: 1, ...typography.body, fontSize: 16, color: colors.textPrimary, textAlign: 'right' },
  hubLabelWithMeta: { flex: 1, gap: 2, alignItems: 'stretch' },
  hubRowMeta: { ...typography.meta, color: colors.textSecondary, textAlign: 'right' },
  hubChevron: { fontSize: 20, color: colors.textSecondary, writingDirection: 'ltr' }, // RTL: chevron points left toward the row's leading (right) edge
  // Same footprint as hubChevron, for a non-tappable informational row that
  // still needs its label aligned with the actionable rows around it.
  hubChevronSpacer: { width: 20, height: 20 },
  // Deliverable 3C — dog card (identity-first, top of screen) and the
  // compact "המשפחה שלי" summary card right below it.
  dogCard: {
    flexDirection: 'row',
    ...nativeDirection('ltr'),
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  dogCardBody: { flex: 1, gap: 2 },
  dogCardName: { ...typography.sectionTitle, fontSize: 18, color: colors.textPrimary, textAlign: 'right' },
  dogCardMeta: { ...typography.meta, color: colors.textSecondary, textAlign: 'right' },
  // Multi-dog selector strip — same horizontal-filter-chip pattern as
  // SystemAdminScreen's auditFamilyFilters (row-reverse content, no
  // nativeDirection override: a horizontal ScrollView already flips its
  // own scroll direction under RTL, so reversing the row keeps chip order
  // matching natural reading order instead of double-flipping).
  dogSelectorRow: { flexDirection: 'row-reverse', gap: spacing.sm, paddingBottom: spacing.xs },
  dogSelectorChip: {
    alignItems: 'center',
    gap: 4,
    width: 72,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  dogSelectorChipActive: { backgroundColor: colors.statusCurrentBg, borderColor: colors.primary },
  dogSelectorChipName: { ...typography.meta, fontSize: 12, color: colors.textSecondary, textAlign: 'center' },
  dogSelectorChipNameActive: { color: colors.primaryDark, fontWeight: '700' },
  dogSelectorAddChip: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    width: 72,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  dogSelectorAddPlus: { fontSize: 20, color: colors.primaryDark, fontWeight: '700' },
  dogSelectorAddText: { ...typography.meta, fontSize: 12, color: colors.primaryDark, fontWeight: '700', textAlign: 'center' },
  familyCardHeader: { flexDirection: 'row', ...nativeDirection('ltr'), alignItems: 'center', justifyContent: 'space-between' },
  familyCardTitle: { ...typography.sectionTitle, fontSize: 17, color: colors.textPrimary, textAlign: 'right' },
  familyCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  familyAvatarRow: { flexDirection: 'row-reverse', ...nativeDirection('ltr'), alignItems: 'center', gap: spacing.xs },
  familyCount: { ...typography.meta, color: colors.textSecondary, marginRight: spacing.sm },
  // "ניהול" management sheet.
  backdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '85%' },
  // BUG FIX (real-device regression) — see DogDetailsModal.tsx's matching
  // comment for the full mechanism: `flex: 1` forced the ScrollView's
  // flex-basis to 0 inside a `sheet` whose height is auto (capped only by
  // maxHeight, no definite size of its own), collapsing the whole sheet.
  // `flexGrow: 0, flexShrink: 1` restores content-hugging sizing while
  // still letting it scroll/shrink down to the maxHeight cap for the
  // admin/audit-log button list.
  sheetScroll: { flexGrow: 0, flexShrink: 1 },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: 8 },
});










