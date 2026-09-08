import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';
import { RtlText } from '../components/RtlText';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFamilyStore } from '../store/familyStore';
import { useAuthStore, useEffectiveFamilyRole, useEffectiveUserId } from '../store/authStore';
import { colors } from '../theme/colors';
import { Button } from '../components/Button';
import { DogPhoto } from '../components/DogPhoto';
import { radii, spacing, typography } from '../theme/tokens';
import { pickAndUploadImage } from '../lib/uploadImage';
import {
  enterQaSandbox,
  exitQaSandbox,
  isSupabaseConfigured,
  qaResetData,
  qaResetFull,
  regenerateInviteCode,
} from '../lib/supabase';
import { friendlyErrorMessage } from '../lib/errorMessages';
import { DEMO_FAMILY } from '../data/demoData';
import type { Dog } from '../types';
import { UserPickerModal } from '../components/UserPickerModal';
import { PinEntryModal } from '../components/PinEntryModal';
import { AdminActivityModal } from '../components/AdminActivityModal';
import { AdminAuditLogModal } from '../components/AdminAuditLogModal';
import { DogDetailsModal } from '../components/DogDetailsModal';
import { RemindersModal } from '../components/RemindersModal';
import { FamilySharingModal } from '../components/FamilySharingModal';
import { guardTestModeMutation } from '../lib/testModeGuard';
import { decideChildModalToOpen, type SettingsChildModal } from '../logic/settingsModalTransitions';

export function SettingsScreen() {
  const { family, users, dog, load: loadFamily, setReminderEnabled, saveDog } = useFamilyStore();
  const { currentUserId, setFamilyId } = useAuthStore();
  const signInWithPin = useAuthStore((s) => s.signInWithPin);
  const isQaFamily = useAuthStore((s) => s.isQaFamily);
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
  // B1 (round 6): Test Mode's product UI (the "🧪 מצב בדיקה" section that
  // used to live here) has been removed — Real Impersonation ("בדיקה אמיתית
  // כמשתמש" below) is now the only Admin-facing "act as another member"
  // mechanism. testModeUserId is still read here ONLY to keep the reminders
  // toggle's disabled-check below correct for as long as authStore's
  // now-unreachable testMode state field exists at all (see authStore.ts /
  // B1's final-report note on why that underlying field was left in place
  // rather than removed outright in this pass) — it is always null/undefined
  // in practice since nothing sets it anymore.
  const testModeUserId = useAuthStore((s) => s.testModeUserId);
  const impersonatingUserId = useAuthStore((s) => s.impersonatingUserId);
  // ROUND-5 RACE FIX: synchronous in-flight flag (see authStore.ts) — used
  // here purely for UI feedback/double-tap protection, never as an
  // authorization decision (the store itself already refuses a second
  // concurrent beginImpersonation()/enterTestMode() call regardless of what
  // this screen does).
  const impersonationStarting = useAuthStore((s) => s.impersonationStarting);
  const beginImpersonation = useAuthStore((s) => s.beginImpersonation);
  const endImpersonation = useAuthStore((s) => s.endImpersonation);
  const [impersonationPickerVisible, setImpersonationPickerVisible] = useState(false);
  const [impersonationError, setImpersonationError] = useState<string | null>(null);
  const [endingImpersonation, setEndingImpersonation] = useState(false);
  const [activityModalVisible, setActivityModalVisible] = useState(false);
  const [auditLogModalVisible, setAuditLogModalVisible] = useState(false);
  // Section 12: Settings is now a concise hub — each focused area opens as
  // its own sub-screen (modal, matching this app's existing navigation
  // pattern) instead of all being visible on the main list at once.
  const [dogModalVisible, setDogModalVisible] = useState(false);
  const [remindersModalVisible, setRemindersModalVisible] = useState(false);
  const [sharingModalVisible, setSharingModalVisible] = useState(false);
  const [managementVisible, setManagementVisible] = useState(false);
  // NESTED-MODAL LIFECYCLE FIX (final QA round) — see
  // logic/settingsModalTransitions.ts's doc comment for the full mechanism.
  // "מי משתמש במערכת"/"יומן פעילות" used to open their own Modal directly
  // while the Management Modal stayed visible=true; now they instead set
  // this pending flag and close Management first — the child only actually
  // opens once Management's dismissal has genuinely completed (see the
  // onDismiss/useEffect wiring below).
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
  // COMPLETION PASS — Priority 7 (QA sandbox app-side entry point). Kept
  // deliberately minimal: a name field + two actions, both admin-only
  // (reachable only inside this already admin-gated Management sheet).
  // Server-side (migrations/0016_*.sql) is the real authority for every
  // guarantee here (is_qa-only reset, admin-of-that-family-only, RESET
  // confirmation) — this UI only surfaces the entry points and their
  // required confirmations, never re-implements the guards itself.
  const [qaFamilyName, setQaFamilyName] = useState('');
  const [qaBusy, setQaBusy] = useState<'entering' | 'resettingData' | 'resettingFull' | 'exiting' | null>(null);
  const [qaSandboxError, setQaSandboxError] = useState<string | null>(null);

  useEffect(() => {
    loadFamily(familyId);
  }, [loadFamily, familyId]);

  useEffect(() => {
    setInviteCode(family?.inviteCode);
  }, [family?.inviteCode]);

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
    // Explicit per-value branches — no generic else/default that could
    // silently misroute a future fourth child modal.
    if (toOpen === 'activity') setActivityModalVisible(true);
    else if (toOpen === 'auditLog') setAuditLogModalVisible(true);
    else if (toOpen === 'impersonation') setImpersonationPickerVisible(true);
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
    // Explicit per-value branches — no generic else/default that could
    // silently misroute a future fourth child modal.
    if (toOpen === 'activity') setActivityModalVisible(true);
    else if (toOpen === 'auditLog') setAuditLogModalVisible(true);
    else if (toOpen === 'impersonation') setImpersonationPickerVisible(true);
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

  const copyInviteCode = async () => {
  if (!inviteCode) return;

  await Clipboard.setStringAsync(inviteCode);

  Alert.alert(
    'הקוד הועתק',
    `קוד המשפחה ${inviteCode} הועתק ללוח.`
  );
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

  // COMPLETION PASS — Priority 7. "כניסה לסביבת QA": creates a fresh
  // is_qa=true family via create_qa_family() (migrations/0016_*.sql), then
  // hands off to setFamilyId() — the SAME store action the real
  // create/join-family onboarding flow already uses (FamilyOnboardingScreen)
  // — so the app's existing "no users yet -> add first member -> add a dog
  // -> add schedule rules" onboarding takes over unmodified from here.
  // FINAL CORRECTION PASS — Deliverable 2: enterQaSandbox() now SNAPSHOTS
  // this device's real family membership server-side before switching, so
  // "יציאה מסביבת QA" below returns to it automatically — no invite code,
  // no manual DB edit, no data loss. The warning here is softened
  // accordingly (no longer claims the real family is "lost").
  const confirmEnterQaSandbox = () => {
    if (!isSupabaseConfigured) {
      setQaSandboxError('סביבת QA זמינה רק כשהאפליקציה מחוברת ל-Supabase.');
      return;
    }
    const name = qaFamilyName.trim() || `QA Sandbox ${new Date().toISOString().slice(0, 16)}`;
    Alert.alert(
      'כניסה לסביבת QA?',
      'המכשיר הזה יעבור זמנית למשפחת בדיקה נפרדת ומבודדת. אפשר לחזור למשפחה האמיתית בכל רגע דרך "יציאה מסביבת QA" — אין צורך בקוד הזמנה.',
      [
        { text: 'ביטול', style: 'cancel' },
        {
          text: 'כניסה לסביבת QA',
          onPress: async () => {
            setQaBusy('entering');
            setQaSandboxError(null);
            try {
              const created = await enterQaSandbox(name);
              await setFamilyId(created.id);
              setQaFamilyName('');
            } catch (err) {
              setQaSandboxError(friendlyErrorMessage(err));
            } finally {
              setQaBusy(null);
            }
          },
        },
      ]
    );
  };

  // "איפוס נתוני QA": resets operational data ONLY (walks/schedule/
  // requests/audit) — dog and members/personas stay intact. Only ever
  // succeeds server-side against a family with is_qa=true that the caller
  // administers (qa_reset_data() — see its own doc comment); this button
  // does not duplicate that check, only surfaces the rejection if misused.
  const confirmResetQaData = () => {
    if (!familyId) return;
    Alert.alert(
      'איפוס נתוני QA?',
      'כל הטיולים, לוח הזמנים, הבקשות ויומן הפעילות של סביבת ה-QA הזו יימחקו לצמיתות. בני המשפחה והכלב יישארו. פעולה זו מצליחה רק על משפחת QA — לא על משפחה אמיתית.',
      [
        { text: 'ביטול', style: 'cancel' },
        {
          text: 'איפוס',
          style: 'destructive',
          onPress: async () => {
            setQaBusy('resettingData');
            setQaSandboxError(null);
            try {
              await qaResetData(familyId);
              await loadFamily(familyId);
            } catch (err) {
              setQaSandboxError(friendlyErrorMessage(err));
            } finally {
              setQaBusy(null);
            }
          },
        },
      ]
    );
  };

  // "התחל סביבת QA חדשה": a true blank slate — dog AND members/personas are
  // also wiped, identical to the state right after entering QA. The tester
  // goes through the app's EXISTING onboarding flow again from zero.
  const confirmResetQaFull = () => {
    if (!familyId) return;
    Alert.alert(
      'התחלת סביבת QA חדשה?',
      'כל הנתונים, הכלב ובני המשפחה של סביבת ה-QA הזו יימחקו לצמיתות — תתחילו מאפס דרך תהליך ההרשמה הרגיל. פעולה זו מצליחה רק על משפחת QA — לא על משפחה אמיתית.',
      [
        { text: 'ביטול', style: 'cancel' },
        {
          text: 'התחלה מחדש',
          style: 'destructive',
          onPress: async () => {
            setQaBusy('resettingFull');
            setQaSandboxError(null);
            try {
              await qaResetFull(familyId);
              await loadFamily(familyId);
              setManagementVisible(false);
            } catch (err) {
              setQaSandboxError(friendlyErrorMessage(err));
            } finally {
              setQaBusy(null);
            }
          },
        },
      ]
    );
  };

  // "יציאה מסביבת QA": restores this device's real family membership from
  // the server-side snapshot enterQaSandbox() saved (exit_qa_sandbox()) —
  // the actual Deliverable 2 fix. No confirmation dialog: exiting is
  // non-destructive (QA data is untouched, just left behind) and is the
  // expected, frequent end of a QA session, not a rare/dangerous action.
  const handleExitQaSandbox = async () => {
    setQaBusy('exiting');
    setQaSandboxError(null);
    try {
      const restored = await exitQaSandbox();
      await setFamilyId(restored.id);
      setManagementVisible(false);
    } catch (err) {
      setQaSandboxError(friendlyErrorMessage(err));
    } finally {
      setQaBusy(null);
    }
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

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <RtlText style={styles.header} maxFontSizeMultiplier={1.35}>הגדרות</RtlText>

        {/*
          FINAL CORRECTION PASS — Deliverable 3C, the approved Design 3
          hybrid: a dog card up top (identity-first — this is a dog-walking
          app, the dog leads), then ordinary grouped settings rows (family management already has its
          own bottom tab, so Settings does not duplicate it), with admin/QA kept as its own
          clearly separate advanced area (unchanged Management sheet below)
          rather than mixed into these rows.
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



        {/* Ordinary settings rows — grouped, consistent row height/icon/
            chevron, no admin/QA tools mixed in here (those live in the
            separate "⚙️ ניהול" advanced area below). */}
        <View style={styles.section}>
          <Pressable style={styles.hubRow} onPress={() => setRemindersModalVisible(true)} accessibilityRole="button" accessibilityLabel="תזכורות">
            <RtlText style={styles.hubChevron}>‹</RtlText>
            <RtlText style={styles.hubLabel}>🔔 תזכורות</RtlText>
          </Pressable>

          <Pressable style={styles.hubRow} onPress={() => setSharingModalVisible(true)} accessibilityRole="button" accessibilityLabel="שיתוף המשפחה">
            <RtlText style={styles.hubChevron}>‹</RtlText>
            <RtlText style={styles.hubLabel}>📤 שיתוף המשפחה</RtlText>
          </Pressable>

          <Pressable style={styles.hubRow} onPress={handleSwitchUser} accessibilityRole="button" accessibilityLabel="החלף משתמש, מעבר לפרופיל אחר במכשיר הזה">
            <RtlText style={styles.hubChevron}>‹</RtlText>
            <View style={styles.hubLabelWithMeta}>
              <RtlText style={styles.hubLabel}>🔁 החלף משתמש</RtlText>
              <RtlText style={styles.hubRowMeta}>מעבר לפרופיל אחר במשפחה במכשיר הזה</RtlText>
            </View>
          </Pressable>
        </View>

        {/* Admin / advanced area — CLEARLY SEPARATE (its own heading, its own
            distinct entry point) from the ordinary rows above. "ניהול" opens
            the Management sheet, which itself keeps "החלף משתמש"'s sibling
            real-impersonation flow ("בדיקה אמיתית") and the QA sandbox area
            visibly distinct from one another — see the sheet's own comments. */}
        {familyRole === 'admin' ? (
          <View style={styles.section}>
            <RtlText style={styles.sectionTitle}>🛠️ מתקדם</RtlText>
            <Pressable style={styles.hubRow} onPress={() => setManagementVisible(true)} accessibilityRole="button" accessibilityLabel="ניהול, למנהל בלבד">
              <RtlText style={styles.hubChevron}>‹</RtlText>
              <View style={styles.hubLabelWithMeta}>
                <RtlText style={styles.hubLabel}>⚙️ ניהול</RtlText>
                <RtlText style={styles.hubRowMeta}>מי משתמש, יומן פעילות, בדיקה אמיתית, סביבת QA</RtlText>
              </View>
            </Pressable>
          </View>
        ) : null}

      </ScrollView>
      </KeyboardAvoidingView>

      <UserPickerModal
        visible={impersonationPickerVisible}
        title="להתחבר בדיקה אמיתית כמי?"
        users={users.filter((u) => !u.removedAt)}
        excludeUserId={currentUserId ?? undefined}
        onSelect={async (userId) => {
          setImpersonationPickerVisible(false);
          setImpersonationError(null);
          try {
            await beginImpersonation(userId);
          } catch (err) {
            const message =
              err instanceof Error
                ? err.message
                : typeof err === 'object' && err !== null && 'message' in err
                  ? String((err as { message?: unknown }).message)
                  : 'לא הצלחנו להתחיל בדיקה אמיתית — נסו שוב';
            setImpersonationError(message);
          }
        }}
        onClose={() => setImpersonationPickerVisible(false)}
      />

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

      <AdminActivityModal visible={activityModalVisible} onClose={() => setActivityModalVisible(false)} />
      <AdminAuditLogModal visible={auditLogModalVisible} onClose={() => setAuditLogModalVisible(false)} />

      <DogDetailsModal
        visible={dogModalVisible}
        dog={dog ?? null}
        uploadingPhoto={uploadingPhoto}
        onChangePhoto={changeDogPhoto}
        onSave={persistDog}
        onClose={() => setDogModalVisible(false)}
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
        onCopy={copyInviteCode}
        onShare={shareInviteCode}
        onRegenerate={confirmRegenerateInviteCode}
        onClose={() => setSharingModalVisible(false)}
      />

      {/* Section 12: "ניהול" — admin-only hub for "מי משתמש במערכת" /
          "יומן פעילות" plus the relocated (not deleted) real-impersonation
          testing block, kept out of regular members' reach entirely (this
          whole modal only opens from a button that's itself gated on
          familyRole === 'admin' above). */}
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
              <RtlText style={styles.title}>⚙️ ניהול</RtlText>

              {isSupabaseConfigured ? (
                <>
                  <Button label="👥 מי משתמש במערכת" variant="secondary" onPress={() => openChildAfterManagementCloses('activity')} style={styles.addButton} />
                  <Button label="📋 יומן פעילות" variant="secondary" onPress={() => openChildAfterManagementCloses('auditLog')} style={styles.addButton} />
                </>
              ) : (
                <RtlText style={styles.dogMeta}>מי-בשימוש ויומן פעילות זמינים רק כשהאפליקציה מחוברת ל-Supabase.</RtlText>
              )}

              {/*
                REAL ADMIN QA / IMPERSONATION — relocated here (Section 12)
                from the main Settings list, not deleted: still a SEPARATE,
                more powerful feature from Test Mode. Test Mode is a UI-only
                preview that blocks every mutation; this actually
                authenticates server-side authorization-sensitive flows
                (request creation, RLS visibility, RPC authorization) as the
                chosen member — see migrations/0006_qa_impersonation.sql.
                Only shown in Supabase mode.
              */}
              {isSupabaseConfigured ? (
                <View style={styles.managementSubsection}>
                  <RtlText style={styles.sectionTitle}>🧑‍💻 בדיקה אמיתית כמשתמש</RtlText>
                  <RtlText style={styles.dogMeta}>
                    בשונה ממצב בדיקה, כאן פעולות שנעשות בפועל — כולל בקשות החלפה
                    ובקשות שינוי שעה — מתבצעות באמת בשם בן/בת המשפחה שנבחר/ה, בלי
                    להתחבר בפועל למכשיר שלהם ובלי לגעת בחיבור שלהם. כל פעולה כזו
                    מתועדת ביומן הפעילות גם בשם המנהל האמיתי.
                  </RtlText>
                  {impersonatingUserId ? (
                    <Button
                      label={endingImpersonation ? 'חוזר למנהל...' : 'חזור למנהל (סיום בדיקה אמיתית)'}
                      variant="secondary"
                      wrap
                      loading={endingImpersonation}
                      disabled={endingImpersonation}
                      onPress={async () => {
                        setImpersonationError(null);
                        setEndingImpersonation(true);
                        try {
                          await endImpersonation();
                        } catch (err) {
                          setImpersonationError(
                            'לא הצלחנו לחזור למנהל — בדקו את החיבור לאינטרנט ונסו שוב. עד אז המצב הנוכחי ממשיך.'
                          );
                        } finally {
                          setEndingImpersonation(false);
                        }
                      }}
                      style={styles.addButton}
                    />
                  ) : (
                    <Button
                      label={impersonationStarting ? 'מתחיל...' : '🧑‍💻 בדיקה אמיתית: התחבר כבן משפחה אחר'}
                      variant="secondary"
                      wrap
                      // BUG FIX (patch: real-impersonation nested-modal
                      // freeze): this used to open the picker directly
                      // (setImpersonationPickerVisible(true)) while
                      // Management stayed visible={true} underneath — two
                      // RN Modals presented at once, bypassing the same
                      // close-Management-first lifecycle already used for
                      // 'activity'/'auditLog' just above. Routes through
                      // the identical safe helper now.
                      onPress={() => openChildAfterManagementCloses('impersonation')}
                      disabled={
                        testModeUserId !== null ||
                        impersonationStarting ||
                        users.filter((u) => !u.removedAt && u.id !== currentUserId).length === 0
                      }
                      loading={impersonationStarting}
                      style={styles.addButton}
                    />
                  )}
                  {impersonationError ? <RtlText style={styles.impersonationError}>{impersonationError}</RtlText> : null}
                </View>
              ) : null}

              {/*
                FINAL CORRECTION PASS — Deliverable 2. QA sandbox tools: a
                CLEARLY SEPARATE subsection from ordinary settings/admin rows
                above (own heading, own divider spacing, own obvious visual
                indicator when active) — never mixed into the regular rows.
              */}
              {isSupabaseConfigured ? (
                <View style={[styles.managementSubsection, isQaFamily && styles.qaActiveSubsection]}>
                  <RtlText style={styles.sectionTitle}>🧪 סביבת QA</RtlText>
                  {isQaFamily ? (
                    <View style={styles.qaActiveBadge}>
                      <RtlText style={styles.qaActiveBadgeText}>
                        🧪 אתם כרגע בתוך סביבת QA — זו לא המשפחה האמיתית שלכם
                      </RtlText>
                    </View>
                  ) : null}
                  <RtlText style={styles.dogMeta}>
                    {isQaFamily
                      ? 'ניתן לאפס את נתוני הבדיקה, להתחיל סביבת QA חדשה, או לצאת בחזרה למשפחה האמיתית — ללא קוד הזמנה.'
                      : 'כניסה למשפחת בדיקה נפרדת ומבודדת (is_qa) לצורך בדיקות. לא משפיע על המשפחה האמיתית שלכם, וניתן לחזור אליה בכל רגע.'}
                  </RtlText>

                  {!isQaFamily ? (
                    <>
                      <TextInput
                        style={styles.qaNameInput}
                        value={qaFamilyName}
                        onChangeText={setQaFamilyName}
                        placeholder="שם משפחת QA (אופציונלי)"
                        placeholderTextColor={colors.textSecondary}
                        textAlign="right"
                      />
                      <Button
                        label={qaBusy === 'entering' ? 'נכנס לסביבת QA...' : '🧪 כניסה לסביבת QA'}
                        variant="secondary"
                        wrap
                        loading={qaBusy === 'entering'}
                        disabled={qaBusy !== null}
                        onPress={confirmEnterQaSandbox}
                        style={styles.addButton}
                      />
                    </>
                  ) : (
                    <>
                      <Button
                        label={qaBusy === 'resettingData' ? 'מאפס נתונים...' : '🔄 איפוס נתוני QA'}
                        variant="secondary"
                        wrap
                        loading={qaBusy === 'resettingData'}
                        disabled={qaBusy !== null}
                        onPress={confirmResetQaData}
                        style={styles.addButton}
                      />
                      <Button
                        label={qaBusy === 'resettingFull' ? 'מתחיל מחדש...' : '🆕 התחל סביבת QA חדשה'}
                        variant="secondary"
                        wrap
                        loading={qaBusy === 'resettingFull'}
                        disabled={qaBusy !== null}
                        onPress={confirmResetQaFull}
                        style={styles.addButton}
                      />
                      <Button
                        label={qaBusy === 'exiting' ? 'יוצא...' : '🚪 יציאה מסביבת QA'}
                        variant="secondary"
                        wrap
                        loading={qaBusy === 'exiting'}
                        disabled={qaBusy !== null}
                        onPress={handleExitQaSandbox}
                        style={styles.addButton}
                      />
                    </>
                  )}
                  {qaSandboxError ? <RtlText style={styles.impersonationError}>{qaSandboxError}</RtlText> : null}
                </View>
              ) : null}

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
  flex: { flex: 1 },
  content: { padding: 20, gap: 28, paddingBottom: 64 },
  header: { width: '100%', fontSize: 22, fontWeight: '800', color: colors.textPrimary, textAlign: 'right', writingDirection: 'rtl' },
  section: { gap: 10 },
  sectionTitle: { width: '100%', fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'right', writingDirection: 'rtl' },
  dogMeta: { fontSize: 14, color: colors.textSecondary, textAlign: 'right' },
  impersonationError: { fontSize: 13, color: colors.statusOverdue, textAlign: 'right', marginTop: 4 },
  addButton: { marginTop: 6 },
  // Settings hub rows — consistent min-height (tokens.layout.rowHeight)
  // across every row, whether it has a subtitle (hubLabelWithMeta) or not.
  hubRow: {
    flexDirection: 'row',
    direction: 'ltr',
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
  // Deliverable 3C — dog card (identity-first, top of screen) and the
  // compact "המשפחה שלי" summary card right below it.
  dogCard: {
    flexDirection: 'row',
    direction: 'ltr',
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
  familyCardHeader: { flexDirection: 'row', direction: 'ltr', alignItems: 'center', justifyContent: 'space-between' },
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
  familyAvatarRow: { flexDirection: 'row-reverse', direction: 'ltr', alignItems: 'center', gap: spacing.xs },
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
  managementSubsection: { marginTop: 20, gap: 6 },
  qaNameInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    color: colors.textPrimary,
    marginTop: 4,
  },
  // FINAL CORRECTION PASS — Deliverable 2: an obvious, hard-to-miss visual
  // cue that the device is currently inside a QA sandbox, not its real
  // family — a dashed accent border on the whole subsection plus a filled
  // badge line, using the same amber/red accent this app already uses for
  // "needs attention" states (statusOverdue*) rather than inventing a new
  // color for a one-off case.
  qaActiveSubsection: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.statusOverdue,
    borderRadius: 16,
    padding: 12,
  },
  qaActiveBadge: {
    backgroundColor: colors.statusOverdueBg,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  qaActiveBadgeText: { color: colors.statusOverdue, fontWeight: '700', fontSize: 13, textAlign: 'right' },
});
