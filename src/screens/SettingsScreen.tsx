import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';
import { RtlText } from '../components/RtlText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFamilyStore } from '../store/familyStore';
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
import type { Dog } from '../types';
import { UserPickerModal } from '../components/UserPickerModal';
import { PinEntryModal } from '../components/PinEntryModal';
import { AdminAuditLogModal } from '../components/AdminAuditLogModal';
import { DogDetailsModal } from '../components/DogDetailsModal';
import { RemindersModal } from '../components/RemindersModal';
import { FamilySharingModal } from '../components/FamilySharingModal';
import { guardTestModeMutation } from '../lib/testModeGuard';
import { decideChildModalToOpen, type SettingsChildModal } from '../logic/settingsModalTransitions';
import { generateId } from '../lib/id';

export function SettingsScreen() {
  const { family, users, dog, dogs, selectedDogId, load: loadFamily, setReminderEnabled, saveDog, selectDog } = useFamilyStore();
  const { currentUserId, setFamilyId } = useAuthStore();
  const signInWithPin = useAuthStore((s) => s.signInWithPin);
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
  const [remindersModalVisible, setRemindersModalVisible] = useState(false);
  const [sharingModalVisible, setSharingModalVisible] = useState(false);
  const [managementVisible, setManagementVisible] = useState(false);
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
        {dogs.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.dogSelectorRow}
          >
            {dogs.map((d) => {
              const isActive = d.id === selectedDogId;
              return (
                <Pressable
                  key={d.id}
                  onPress={() => void selectDog(d.id)}
                  style={[styles.dogSelectorChip, isActive && styles.dogSelectorChipActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={isActive ? `${d.name}, הכלב הפעיל כעת` : `בחירת ${d.name} ככלב הפעיל`}
                >
                  <DogPhoto photoUrl={d.photoUrl} size={40} />
                  <RtlText style={[styles.dogSelectorChipName, isActive && styles.dogSelectorChipNameActive]} numberOfLines={1}>
                    {d.name}
                  </RtlText>
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => void handleAddDog()}
              disabled={addingDog}
              style={styles.dogSelectorAddChip}
              accessibilityRole="button"
              accessibilityLabel="הוספת כלב נוסף למשפחה"
              accessibilityState={{ disabled: addingDog }}
            >
              <RtlText style={styles.dogSelectorAddPlus}>＋</RtlText>
              <RtlText style={styles.dogSelectorAddText}>{addingDog ? 'מוסיף…' : 'הוספת כלב'}</RtlText>
            </Pressable>
          </ScrollView>
        ) : null}

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
  content: { padding: spacing.xl, gap: spacing.xxl, paddingBottom: spacing.xxxl },
  // Same desktop-containment pattern as HomeScreen's webContent: cap and
  // center the scroll content on web only — native is unaffected (RN's
  // ScrollView contentContainerStyle already renders full-width there, and
  // this repo's design intent is a bounded desktop column, not native).
  webContent: { maxWidth: breakpoints.desktopContent, alignSelf: 'center' },
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













