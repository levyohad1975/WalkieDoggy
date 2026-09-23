import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ImageBackground, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Pressable, TextInput, View, useWindowDimensions } from 'react-native';
import { RtlText } from '../components/RtlText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../store/authStore';
import { colors } from '../theme/colors';
import { breakpoints, radii, spacing, typography } from '../theme/tokens';
import { Button } from '../components/Button';
import { ensureAnonymousSession, findFamilyByInviteCode, joinFamily } from '../lib/supabase';
import {
  createVerifiedFamily,
  getMyFamilyOnboardingStatus,
  getVerifiedAdminIdentity,
  requestAdminEmailVerification,
  verifyAdminEmailOtp,
} from '../lib/verifiedAdminOnboarding';
import { inspectFamilyInviteDetail, redeemFamilyInvite, type FamilyInvitePreviewDetail } from '../lib/invites';
import { formatInviteExpiry, inviteStatusLabel, parseInviteInput } from '../logic/familyInvites';
import { friendlyErrorMessage } from '../lib/errorMessages';
import { Avatar } from '../components/Avatar';
import { DogPhoto } from '../components/DogPhoto';
import { WalkieMascot } from '../components/WalkieMascot';
import type { FamilyLookupResult } from '../types';

type Mode = 'choose' | 'pwaChoice' | 'recover' | 'create' | 'join' | 'redeem';

/**
 * Shown once per device, only in Supabase (backend) mode, before this device
 * has created or joined a family — i.e. before authStore.familyId is set.
 * Local/demo mode never reaches this screen (App.tsx always has a familyId
 * there: the single seeded demo family).
 *
 * After creating or joining, this screen just calls setFamilyId() and stops
 * rendering — App.tsx then shows LoginScreen for the (now-known) family,
 * which already handles both "no members yet, add the first one" (a brand
 * new family) and "pick who you are" (an existing family being joined) with
 * no changes needed here.
 */
export function FamilyOnboardingScreen() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 900;
  const setFamilyId = useAuthStore((s) => s.setFamilyId);
  // Round 4 — set only when a redemption already succeeded server-side but
  // this device couldn't yet confirm it via whoami() (see authStore.ts's
  // completeInviteRedemption/restoreSession doc comments). Checked on mount
  // (including right after a cold start, since restoreSession() already
  // attempted recovery before this screen ever renders) so a returning
  // device sees the dedicated verification-pending state instead of the
  // ordinary choose screen.
  const pendingInviteRedemption = useAuthStore((s) => s.pendingInviteRedemption);
  const completeInviteRedemption = useAuthStore((s) => s.completeInviteRedemption);
  const retryPendingInviteRedemptionVerification = useAuthStore(
    (s) => s.retryPendingInviteRedemptionVerification
  );
  const isInstalledWebApp = Platform.OS === 'web' && typeof window !== 'undefined' && Boolean(window.matchMedia?.('(display-mode: standalone)').matches || (typeof navigator !== 'undefined' && (navigator as typeof navigator & { standalone?: boolean }).standalone === true));
  // An installed PWA launch is ambiguous -- it's exactly as true for a
  // returning device reopening the icon as for a brand-new install that
  // just added the icon during setup (no reliable synchronous client-side
  // signal distinguishes them; even a brand-new device already has an
  // anonymous Supabase session by the time this screen renders). Previously
  // this defaulted straight into 'recover', silently assuming "returning"
  // for every case including first-time installs. Show a neutral 3-way
  // choice instead and let the device tell us which it is.
  const [mode, setMode] = useState<Mode>(isInstalledWebApp ? 'pwaChoice' : 'choose');
  const [showWelcomeWink, setShowWelcomeWink] = useState(false);

  useEffect(() => {
    if (mode !== 'choose') return;
    let winkTimer: ReturnType<typeof setTimeout> | undefined;
    const interval = setInterval(() => {
      setShowWelcomeWink(true);
      winkTimer = setTimeout(() => setShowWelcomeWink(false), 320);
    }, 4200);
    return () => {
      clearInterval(interval);
      if (winkTimer) clearTimeout(winkTimer);
    };
  }, [mode]);

  // --- create ---
  const [familyName, setFamilyName] = useState('');
  const [dogName, setDogName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [adminEmail, setAdminEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationSent, setVerificationSent] = useState(false);
  const [verifiedAdminEmail, setVerifiedAdminEmail] = useState<string | null>(null);
  const [verifyingEmail, setVerifyingEmail] = useState(false);
  const [pendingApprovalFamilyName, setPendingApprovalFamilyName] = useState<string | null>(null);
  // Set when get_my_family_onboarding_status() reports 'rejected' -- a
  // System Admin declined this device's family-creation request.
  // create_verified_family() (migration 0032) is idempotent per
  // auth_user_id: once family_onboarding_requests has a row, it always
  // returns that same family regardless of approval_status, so without
  // surfacing this the device would otherwise be stuck silently back on
  // the plain "choose" screen with no way to understand what happened.
  const [rejectedFamilyName, setRejectedFamilyName] = useState<string | null>(null);

  // Recovers an already-verified device's pending/active/rejected family-
  // creation request after an app restart (e.g. it closed while awaiting
  // System Admin approval). A device only has one if it already completed
  // OTP verification and submitted create at least once, so this is a safe,
  // side-effect-free no-op for every other case (demo/local mode, an
  // anonymous session, or a device that never tried creating a family) --
  // get_my_family_onboarding_status() simply returns no row.
  useEffect(() => {
    getMyFamilyOnboardingStatus()
      .then((status) => {
        if (!status) return;
        if (status.approvalStatus === 'active') {
          setFamilyId(status.familyId);
        } else if (status.approvalStatus === 'pending') {
          setMode('create');
          setPendingApprovalFamilyName(status.familyName);
        } else if (status.approvalStatus === 'rejected') {
          setMode('create');
          setRejectedFamilyName(status.familyName);
        }
      })
      .catch(() => {
        // Best-effort recovery only -- the ordinary choose screen is
        // already the correct fallback (offline, demo mode, etc.).
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendAdminVerification = async () => {
    setVerifyingEmail(true);
    setCreateError(null);
    try {
      const normalizedEmail = await requestAdminEmailVerification(adminEmail);
      setAdminEmail(normalizedEmail);
      setVerificationSent(true);
      setVerificationCode('');
    } catch (e) {
      setCreateError(friendlyErrorMessage(e));
    } finally {
      setVerifyingEmail(false);
    }
  };

  const confirmAdminVerification = async () => {
    setVerifyingEmail(true);
    setCreateError(null);
    try {
      const identity = await verifyAdminEmailOtp(adminEmail, verificationCode);
      setVerifiedAdminEmail(identity.email);
    } catch (e) {
      setCreateError(friendlyErrorMessage(e));
    } finally {
      setVerifyingEmail(false);
    }
  };

  const recoverExistingFamily = async () => {
    setVerifyingEmail(true);
    setCreateError(null);
    try {
      const identity = await verifyAdminEmailOtp(adminEmail, verificationCode);
      setVerifiedAdminEmail(identity.email);
      const status = await getMyFamilyOnboardingStatus();
      if (status?.approvalStatus === 'active') {
        await setFamilyId(status.familyId);
        return;
      }
      if (status?.approvalStatus === 'pending') {
        setMode('create');
        setPendingApprovalFamilyName(status.familyName);
        return;
      }
      throw new Error('לא נמצאה משפחה פעילה המקושרת לכתובת הזו. אם הצטרפתם כבן משפחה, השתמשו בקוד או בקישור ההזמנה.');
    } catch (e) {
      setCreateError(friendlyErrorMessage(e));
    } finally {
      setVerifyingEmail(false);
    }
  };

  const submitCreate = async () => {
    if (!familyName.trim() || !verifiedAdminEmail) return;
    setCreating(true);
    setCreateError(null);
    try {
      const identity = await getVerifiedAdminIdentity();
      if (identity.email !== verifiedAdminEmail) {
        throw new Error('יש לאמת מחדש את כתובת הדוא״ל לפני יצירת המשפחה');
      }
      const family = await createVerifiedFamily(familyName.trim(), dogName.trim() || undefined);
      if (family.approvalStatus === 'pending') {
        setPendingApprovalFamilyName(family.name);
        return;
      }
      await setFamilyId(family.id);
    } catch (e) {
      setCreateError(friendlyErrorMessage(e));
    } finally {
      setCreating(false);
    }
  };

  // --- join ---
  const [code, setCode] = useState('');
  const [looking, setLooking] = useState(false);
  const [joining, setJoining] = useState(false);
  const [found, setFound] = useState<FamilyLookupResult | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  const lookup = async () => {
    const trimmed = code.trim();
    if (trimmed.length < 4) return;
    setLooking(true);
    setJoinError(null);
    setFound(null);
    try {
      // Family lookup is an authenticated RPC in backend mode. On a fresh
      // browser/device there may be no Supabase session yet, so establish the
      // persisted anonymous device session before looking up the invite code.
      // confirmJoin() already did this, but lookup happens one step earlier.
      await ensureAnonymousSession();
      const result = await findFamilyByInviteCode(trimmed);
      if (!result) setJoinError('לא נמצאה משפחה עם הקוד הזה — בדקו שהקוד הוקלד נכון');
      else setFound(result);
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : 'לא הצלחנו לחפש את הקוד');
    } finally {
      setLooking(false);
    }
  };

  const confirmJoin = async () => {
    if (!found) return;
    setJoining(true);
    setJoinError(null);
    try {
      await ensureAnonymousSession();
      const family = await joinFamily(code.trim());
      await setFamilyId(family.id);
    } catch (e) {
      setJoinError(friendlyErrorMessage(e));
      setFound(null);
    } finally {
      setJoining(false);
    }
  };

  // --- redeem (Round 4 — invited-user redemption via manual link/token paste) ---
  //
  // TOKEN SAFETY: `redeemInput`/the derived parsed token live ONLY in this
  // component's local state, for exactly as long as it takes to call
  // inspectFamilyInvite()/redeemFamilyInvite() (src/lib/invites.ts — neither
  // logs or persists it, unchanged since Round 2). Nothing here ever passes
  // either value to AsyncStorage, the Zustand store, LocalRepository,
  // SyncQueue, or an error message. `clearRedeemToken()` drops it the
  // instant redeemFamilyInvite() resolves successfully — the raw token is
  // never needed again after that point (see authStore.completeInviteRedemption,
  // which only ever receives the plain familyId/targetUserId the RPC
  // returned, never the token itself).
  const [redeemInput, setRedeemInput] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [preview, setPreview] = useState<FamilyInvitePreviewDetail | null>(null);
  const [redeemToken, setRedeemToken] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const clearRedeemToken = () => setRedeemToken(null);

  const resetRedeemMode = () => {
    setRedeemInput('');
    setInspectError(null);
    setPreview(null);
    clearRedeemToken();
    setRedeemError(null);
  };

  const inspectInvite = async () => {
    const parsed = parseInviteInput(redeemInput);
    if (!parsed) return;
    setInspecting(true);
    setInspectError(null);
    setPreview(null);
    try {
      const result = await inspectFamilyInviteDetail(parsed);
      setPreview(result);
      setRedeemToken(parsed);
    } catch (e) {
      setInspectError(friendlyErrorMessage(e));
    } finally {
      setInspecting(false);
    }
  };

  const confirmRedeem = async () => {
    if (!redeemToken) return;
    setRedeeming(true);
    setRedeemError(null);
    try {
      await ensureAnonymousSession();
      const result = await redeemFamilyInvite(redeemToken);
      // Redemption succeeded server-side — the token has done its only job
      // and is never needed again from here on (see the doc comment above).
      clearRedeemToken();
      // CORRECTED ORDERING (approved Round 4 design): familyId/currentUserId
      // are committed inside completeInviteRedemption only after its own
      // whoami() verification confirms the match — never here, and never
      // via setFamilyId()/claimFamilyProfile()/joinFamily().
      const outcome = await completeInviteRedemption({
        familyId: result.familyId,
        targetUserId: result.targetUserId,
      });
      if (outcome === 'mismatch') {
        setRedeemError('אירעה שגיאה באימות ההצטרפות. נסו שוב עם הזמנה חדשה, או פנו למנהל המשפחה.');
      }
      // 'verified' -> App.tsx swaps to RootNavigator automatically once
      // familyId/currentUserId are set; nothing further to do here.
      // 'unverified' -> authStore's own pendingInviteRedemption state now
      // reflects this, and the render branch below shows the dedicated
      // "ממתין לאימות" UI instead of this form.
    } catch (e) {
      setRedeemError(friendlyErrorMessage(e));
    } finally {
      setRedeeming(false);
    }
  };

  const retryVerification = async () => {
    setVerifying(true);
    try {
      await retryPendingInviteRedemptionVerification();
    } finally {
      setVerifying(false);
    }
  };

  if (mode === 'pwaChoice') {
    return (
      <SafeAreaView style={styles.container}>
        <WalkieMascot state="ready" size={128} testID="onboarding-mascot-pwa-choice" />
        <RtlText style={[styles.title, isDesktop && styles.titleDesktop]} accessibilityRole="header">רגע לפני שממשיכים</RtlText>
        <RtlText style={[styles.subtitle, isDesktop && styles.subtitleDesktop]}>
          פתחתם את Walkie Doggy מהאייקון שנוסף למסך הבית. כדי לחבר את המכשיר הזה נכון, ספרו לנו קודם באיזה שלב אתם.
        </RtlText>
        <Button
          label="המשפחה שלי כבר קיימת"
          variant="secondary"
          onPress={() => setMode('recover')}
          style={styles.wideButton}
        />
        <Button
          label="יש לי הזמנה"
          variant="secondary"
          onPress={() => setMode('redeem')}
          style={styles.wideButton}
        />
        <Button
          label="יצירת משפחה חדשה"
          variant="secondary"
          onPress={() => setMode('create')}
          style={styles.wideButton}
        />
      </SafeAreaView>
    );
  }

  if (mode === 'recover') {
    return (
      <SafeAreaView style={styles.container}>
        <WalkieMascot state="waiting" size={128} testID="onboarding-mascot-recover" />
        <RtlText style={[styles.title, isDesktop && styles.titleDesktop]} accessibilityRole="header">מחברים אותך למשפחה…</RtlText>
        <RtlText style={[styles.subtitle, isDesktop && styles.subtitleDesktop]}>
          פתחת את Walkie Doggy מהאייקון החדש. אין צורך ליצור את המשפחה מחדש. אם אתם מנהלי המשפחה, אמתו את כתובת הדוא״ל ששימשה ליצירתה ונשחזר את החיבור.
        </RtlText>
        <TextInput
          value={adminEmail}
          onChangeText={setAdminEmail}
          placeholder="כתובת הדוא״ל של מנהל המשפחה"
          accessibilityLabel="כתובת הדוא״ל של מנהל המשפחה"
          keyboardType="email-address"
          autoCapitalize="none"
          style={styles.input}
          textAlign="right"
        />
        {!verificationSent ? (
          <Button label={verifyingEmail ? 'שולח קוד…' : 'שלחו לי קוד אימות'} onPress={sendAdminVerification} disabled={verifyingEmail || !adminEmail.trim()} loading={verifyingEmail} style={styles.wideButton} />
        ) : (
          <>
            <TextInput value={verificationCode} onChangeText={setVerificationCode} placeholder="קוד האימות שקיבלתם במייל" accessibilityLabel="קוד האימות שקיבלתם במייל" keyboardType="number-pad" style={styles.input} textAlign="right" />
            <Button label={verifyingEmail ? 'מחבר למשפחה…' : 'המשך למשפחה שלי'} onPress={recoverExistingFamily} disabled={verifyingEmail || !verificationCode.trim()} loading={verifyingEmail} style={styles.wideButton} />
          </>
        )}
        {createError ? <RtlText style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">{createError}</RtlText> : null}
        <Button label="אני בן משפחה — יש לי הזמנה" variant="secondary" onPress={() => setMode('redeem')} style={styles.wideButton} />
        <Button label="זו באמת משפחה חדשה" variant="secondary" onPress={() => setMode('create')} style={styles.wideButton} />
      </SafeAreaView>
    );
  }

  if (mode === 'choose' && pendingInviteRedemption) {
    // Round 4 — a redemption already succeeded server-side but this device
    // hasn't confirmed it yet (see authStore.ts). Deliberately NOT the
    // ordinary paste form — retrying with the same token would replay an
    // already-consumed invite and (correctly, but confusingly) fail with
    // "ההזמנה הזו כבר נוצלה". Only whoami() verification is retried.
    return (
      <SafeAreaView style={styles.container}>
        <WalkieMascot state="waiting" size={128} testID="onboarding-mascot-verifying" />
        <RtlText style={[styles.title, isDesktop && styles.titleDesktop]} accessibilityRole="header">ממתין לאימות</RtlText>
        <RtlText style={[styles.subtitle, isDesktop && styles.subtitleDesktop]}>
          ההצטרפות למשפחה כבר בוצעה בהצלחה, אך לא הצלחנו לאמת זאת במכשיר הזה כרגע — כנראה בעיית חיבור. אין
          צורך להזין את ההזמנה מחדש.
        </RtlText>
        <Button
          label={verifying ? 'מאמת...' : 'נסה שוב לאמת'}
          onPress={retryVerification}
          disabled={verifying}
          loading={verifying}
          style={styles.wideButton}
          />
      </SafeAreaView>
    );
  }

  if (mode === 'choose') {
    return (
      <View style={styles.welcomeContainer}>
        <ImageBackground
          source={require("../../assets/onboarding-welcome-final.png")}
          style={[styles.referenceHero, isDesktop && styles.referenceHeroDesktop]}
          imageStyle={[styles.referenceHeroImage, isDesktop && styles.referenceHeroImageDesktop]}
          resizeMode={isDesktop ? "contain" : "cover"}
          accessibilityLabel="מסך הפתיחה של Walkie Doggy"
        >
          {showWelcomeWink ? (
            <Image
              source={require("../../assets/onboarding-welcome-wink.png")}
              style={styles.winkFrame}
              resizeMode="cover"
              accessibilityElementsHidden
            />
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="יצירת משפחה חדשה"
            onPress={() => setMode('create')}
            style={[styles.createHotspot, isDesktop && styles.createHotspotDesktop]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="הצטרפות למשפחה קיימת"
            onPress={() => setMode('join')}
            style={[styles.joinHotspot, isDesktop && styles.joinHotspotDesktop]}
          />
        </ImageBackground>
      </View>
    );
  }

  if (mode === 'create') {
    if (rejectedFamilyName) {
      return (
        <SafeAreaView style={styles.container}>
          <WalkieMascot state="concerned" size={128} testID="onboarding-mascot-rejected" />
          <RtlText style={[styles.title, isDesktop && styles.titleDesktop]} accessibilityRole="header">הבקשה נדחתה</RtlText>
          <RtlText style={[styles.subtitle, isDesktop && styles.subtitleDesktop]}>
            הבקשה ליצירת {rejectedFamilyName} נדחתה על ידי מנהל המערכת. לפרטים נוספים, פנו לתמיכה.
          </RtlText>
          <Button label="חזרה" variant="secondary" onPress={() => setMode(isInstalledWebApp ? 'pwaChoice' : 'choose')} style={styles.wideButton} />
        </SafeAreaView>
      );
    }

    if (pendingApprovalFamilyName) {
      return (
        <SafeAreaView style={styles.container}>
          <WalkieMascot state="waiting" size={128} testID="onboarding-mascot-pending" />
          <RtlText style={[styles.title, isDesktop && styles.titleDesktop]} accessibilityRole="header">המשפחה ממתינה לאישור</RtlText>
          <RtlText style={[styles.subtitle, isDesktop && styles.subtitleDesktop]}>
            הבקשה ליצירת {pendingApprovalFamilyName} התקבלה. נשלח עדכון לאחר אישור מנהל המערכת.
          </RtlText>
          <Button label="חזרה" variant="secondary" onPress={() => setMode(isInstalledWebApp ? 'pwaChoice' : 'choose')} style={styles.wideButton} />
        </SafeAreaView>
      );
    }

    return (
      <SafeAreaView style={styles.formSafeArea}>
        <KeyboardAvoidingView style={styles.flexFull} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.formScrollContent} keyboardShouldPersistTaps="handled">
            <View style={[styles.formHero, isDesktop && styles.formHeroDesktop]}>
              <WalkieMascot state="excited" size={86} />
              <View style={styles.formSpeech}><RtlText style={styles.formSpeechText}>בואו נקים למשפחה שלכם בית חדש 🐾</RtlText></View>
            </View>
            <RtlText style={[styles.title, isDesktop && styles.titleDesktop]} accessibilityRole="header">יצירת משפחה חדשה</RtlText>
            <RtlText style={[styles.subtitle, isDesktop && styles.subtitleDesktop]}>כמה פרטים קצרים ומתחילים לטייל יחד</RtlText>

            <View style={[styles.form, isDesktop && styles.formDesktop]}>
              <RtlText style={styles.label}>דוא״ל של מנהל/ת המשפחה</RtlText>
              <TextInput
                value={adminEmail}
                onChangeText={(value) => {
                  setAdminEmail(value);
                  setVerificationSent(false);
                  setVerifiedAdminEmail(null);
                  setVerificationCode('');
                  setCreateError(null);
                }}
                placeholder="name@example.com"
                placeholderTextColor={colors.textSecondary}
                style={styles.input}
                textAlign="left"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                editable={!verifyingEmail && !verifiedAdminEmail}
                accessibilityLabel="דוא״ל של מנהל/ת המשפחה"
              />

              {!verificationSent && !verifiedAdminEmail ? (
                <Button
                  label={verifyingEmail ? 'שולח קוד...' : 'שליחת קוד אימות'}
                  onPress={sendAdminVerification}
                  disabled={!adminEmail.trim() || verifyingEmail}
                  loading={verifyingEmail}
                  style={styles.wideButton}
                />
              ) : null}

              {verificationSent && !verifiedAdminEmail ? (
                <>
                  <RtlText style={styles.label}>קוד האימות שקיבלת בדוא״ל</RtlText>
                  <TextInput
                    value={verificationCode}
                    onChangeText={setVerificationCode}
                    placeholder="123456"
                    placeholderTextColor={colors.textSecondary}
                    style={[styles.input, styles.codeInput]}
                    textAlign="center"
                    keyboardType="number-pad"
                    autoCorrect={false}
                    maxLength={8}
                    accessibilityLabel="קוד האימות שקיבלת בדוא״ל"
                  />
                  <Button
                    label={verifyingEmail ? 'מאמת...' : 'אימות הדוא״ל'}
                    onPress={confirmAdminVerification}
                    disabled={!verificationCode.trim() || verifyingEmail}
                    loading={verifyingEmail}
                    style={styles.wideButton}
                  />
                  <Button
                    label="שליחת קוד חדש"
                    variant="secondary"
                    onPress={sendAdminVerification}
                    disabled={verifyingEmail}
                    style={styles.wideButton}
                  />
                </>
              ) : null}

              {verifiedAdminEmail ? (
                <RtlText style={styles.foundSubtitle}>✓ הדוא״ל אומת: {verifiedAdminEmail}</RtlText>
              ) : null}

              {verifiedAdminEmail ? (
                <>
                  <RtlText style={styles.stepHint}>מעולה! עכשיו רק נותנים למשפחה שם 🐾</RtlText>
                  <RtlText style={styles.label}>שם המשפחה</RtlText>
                  <TextInput
                    value={familyName}
                    onChangeText={setFamilyName}
                    placeholder="למשל: המשפחה שלנו"
                    placeholderTextColor={colors.textSecondary}
                    style={styles.input}
                    textAlign="right"
                    accessibilityLabel="שם המשפחה"
                  />

                  <RtlText style={styles.label}>שם הכלב/ה (אופציונלי)</RtlText>
                  <TextInput
                    value={dogName}
                    onChangeText={setDogName}
                    placeholder="אפשר להוסיף גם אחר כך בהגדרות"
                    placeholderTextColor={colors.textSecondary}
                    style={styles.input}
                    textAlign="right"
                    accessibilityLabel="שם הכלב/ה (אופציונלי)"
                  />

                  <Button
                    label={creating ? 'יוצר משפחה...' : 'יצירת המשפחה'}
                    onPress={submitCreate}
                    disabled={!familyName.trim() || creating}
                    loading={creating}
                    style={styles.wideButton}
                  />
                </>
              ) : null}

              {createError ? (
                <RtlText style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
                  {createError}
                </RtlText>
              ) : null}
              <Button label="חזרה" variant="secondary" onPress={() => setMode(isInstalledWebApp ? 'pwaChoice' : 'choose')} style={styles.wideButton} />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  if (mode === 'redeem') {
    return (
      <SafeAreaView style={styles.formSafeArea}>
        <KeyboardAvoidingView style={styles.flexFull} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.formScrollContent} keyboardShouldPersistTaps="handled">
            <RtlText style={[styles.title, isDesktop && styles.titleDesktop]} accessibilityRole="header">יש לי הזמנה</RtlText>
            <RtlText style={[styles.subtitle, isDesktop && styles.subtitleDesktop]}>הדביקו את קישור ההזמנה, או את קוד ההזמנה עצמו, שקיבלתם מבן/בת המשפחה</RtlText>

            <View style={[styles.form, isDesktop && styles.formDesktop]}>
              <RtlText style={styles.label}>קישור או קוד הזמנה</RtlText>
              <TextInput
                value={redeemInput}
                onChangeText={(v) => {
                  setRedeemInput(v);
                  setPreview(null);
                  clearRedeemToken();
                  setInspectError(null);
                  setRedeemError(null);
                }}
                placeholder="dogwalkfamily://invite/... או הקוד עצמו"
                placeholderTextColor={colors.textSecondary}
                style={[styles.input, styles.ltrInput]}
                textAlign="left"
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="קישור או קוד הזמנה"
              />

              {inspecting ? <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} accessibilityLabel="טוען…" /> : null}
              {inspectError ? (
                <RtlText style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
                  {inspectError}
                </RtlText>
              ) : null}

              {preview ? (
                <View style={styles.foundCard}>
                  {/* BATCH 4 (item D — existing family join UX): after a
                      VALID, server-verified invite token, show the real dog
                      photo and real member list/photos — not just plain
                      text. `preview.dogPhotoUrl`/`preview.members` are only
                      populated for a still-pending, unexpired token (see
                      migration 0028) — for any other status these render
                      nothing extra, identical to the pre-Batch-4 preview. */}
                  {preview.dogName || preview.dogPhotoUrl ? (
                    <View style={styles.previewDogRow}>
                      <DogPhoto photoUrl={preview.dogPhotoUrl ?? undefined} size={56} />
                      {preview.dogName ? <RtlText style={styles.previewDogName}>{preview.dogName}</RtlText> : null}
                    </View>
                  ) : null}

                  <RtlText style={styles.foundTitle}>{preview.familyName}</RtlText>
                  <RtlText style={styles.foundSubtitle}>ההזמנה עבור: {preview.targetName}</RtlText>
                  <RtlText style={styles.foundSubtitle}>סטטוס: {inviteStatusLabel(preview.status)}</RtlText>
                  {formatInviteExpiry(preview.expiresAt) ? (
                    <RtlText style={styles.foundSubtitle}>בתוקף עד {formatInviteExpiry(preview.expiresAt)}</RtlText>
                  ) : null}

                  {preview.members && preview.members.length > 0 ? (
                    <View style={styles.previewMembersRow}>
                      {preview.members.map((m, idx) => (
                        <View key={`${m.name}-${idx}`} style={styles.previewMember}>
                          {/* Avatar/emoji fallback only when a real photo is missing — Avatar's own contract. */}
                          <Avatar emoji={m.avatar} color={colors.primary} photoUrl={m.photoUrl ?? undefined} size={40} />
                          <RtlText style={styles.previewMemberName} numberOfLines={1}>
                            {m.name}
                          </RtlText>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  {redeemError ? (
                    <RtlText style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
                      {redeemError}
                    </RtlText>
                  ) : null}

                  <Button
                    label={redeeming ? 'מצטרף...' : 'הצטרפות'}
                    onPress={confirmRedeem}
                    disabled={redeeming || preview.status !== 'pending'}
                    loading={redeeming}
                    style={styles.wideButton}
                  />
                </View>
              ) : (
                <Button
                  label={inspecting ? 'בודק...' : 'בדיקת ההזמנה'}
                  onPress={inspectInvite}
                  disabled={!parseInviteInput(redeemInput) || inspecting}
                  loading={inspecting}
                  style={styles.wideButton}
                />
              )}

              <Button
                label="חזרה"
                variant="secondary"
                onPress={() => {
                  resetRedeemMode();
                  setMode(isInstalledWebApp ? 'pwaChoice' : 'choose');
                }}
                style={styles.wideButton}
              />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // mode === 'join'
  return (
    <SafeAreaView style={styles.formSafeArea}>
      <KeyboardAvoidingView style={styles.flexFull} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.formScrollContent} keyboardShouldPersistTaps="handled">
          <View style={[styles.formHero, isDesktop && styles.formHeroDesktop]}>
            <WalkieMascot state="excited" size={86} />
            <View style={styles.formSpeech}><RtlText style={styles.formSpeechText}>קיבלתם קוד? בואו נמצא את המשפחה 🐾</RtlText></View>
          </View>
          <RtlText style={[styles.title, styles.joinTitle, isDesktop && styles.titleDesktop]} accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit>הצטרפות למשפחה קיימת</RtlText>
          <RtlText style={[styles.subtitle, isDesktop && styles.subtitleDesktop]}>הקלידו את קוד ההזמנה שקיבלתם מבן/בת המשפחה</RtlText>

          <View style={[styles.form, isDesktop && styles.formDesktop]}>
            <RtlText style={styles.label}>קוד הזמנה</RtlText>
            <TextInput
              value={code}
              onChangeText={(v) => {
                setCode(v.toUpperCase());
                setFound(null);
                setJoinError(null);
              }}
              placeholder="ABC123"
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, styles.codeInput, styles.ltrInput]}
              textAlign="center"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={8}
              accessibilityLabel="קוד הזמנה"
            />

            {looking ? <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} accessibilityLabel="טוען…" /> : null}
            {joinError ? (
              <RtlText style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
                {joinError}
              </RtlText>
            ) : null}

            {found ? (
              <View style={styles.foundCard}>
                <RtlText style={styles.foundTitle}>{found.name}</RtlText>
                {found.dogName ? <RtlText style={styles.foundSubtitle}>הכלב/ה: {found.dogName}</RtlText> : null}
                <Button
                  label={joining ? 'מצטרף...' : 'זו המשפחה שלי — הצטרפות'}
                  onPress={confirmJoin}
                  disabled={joining}
                  loading={joining}
                  style={styles.wideButton}
                />
              </View>
            ) : (
              <Button
                label={looking ? 'מחפש...' : 'חיפוש משפחה'}
                onPress={lookup}
                disabled={code.trim().length < 4 || looking}
                loading={looking}
                style={styles.wideButton}
              />
            )}

            <Button label="חזרה" variant="secondary" onPress={() => setMode(isInstalledWebApp ? 'pwaChoice' : 'choose')} style={styles.wideButton} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#173A36', overflow: 'hidden' },
  welcomeContainer: { flex: 1, backgroundColor: '#173A36', overflow: 'hidden' },
  winkFrame: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%' },
  createHotspot: { position: 'absolute', left: '12%', right: '12%', top: '72%', height: '7.5%', zIndex: 2 },
  joinHotspot: { position: 'absolute', left: '12%', right: '12%', top: '80%', height: '7.5%', zIndex: 2 },
  // On desktop the reference image is contained inside a much wider ImageBackground.
  // Percentage hotspots relative to that wide box land outside the visible phone artwork,
  // so clicks appear dead. Keep the interactive areas centered on the 560px artwork.
  createHotspotDesktop: { left: '12%', right: '12%', top: '72%' },
  joinHotspotDesktop: { left: '12%', right: '12%', top: '80%' },
  referenceHero: { flex: 1, width: '100%', minHeight: '100%' },
  referenceHeroDesktop: { alignSelf: 'center', width: 560, maxWidth: '100%', backgroundColor: '#173A36' },
  referenceHeroImage: { width: '100%', height: '100%' },
  referenceHeroImageDesktop: { resizeMode: 'contain' },
  referenceOverlay: { flex: 1, justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 12, paddingBottom: 18 },
  referenceTopRow: { minHeight: 170, alignItems: 'center', justifyContent: 'center' },
  languagePill: { position: 'absolute', right: 0, top: 0, backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: 28, paddingHorizontal: 18, paddingVertical: 11 },
  languageText: { color: '#102A5A', fontWeight: '800', fontSize: 14 },
  referenceBrand: { alignItems: 'center' },
  referenceLogo: { color: '#09295B', fontSize: 42, lineHeight: 35, fontWeight: '900', textAlign: 'center', textShadowColor: 'rgba(255,255,255,0.7)', textShadowRadius: 8 },
  referenceTagline: { color: '#0B2248', fontSize: 10, lineHeight: 14, letterSpacing: 2.4, fontWeight: '800', textAlign: 'center', marginTop: 8 },
  handwritten: { position: 'absolute', left: 0, top: 52, color: '#0A2454', fontSize: 18, lineHeight: 23, fontWeight: '800', transform: [{rotate:'-8deg'}], textAlign: 'center' },
  mascotStage: { flex: 1, minHeight: 250, alignItems: 'center', justifyContent: 'center' },
  speechBubble: { position: 'absolute', left: 0, bottom: 24, width: 150, minHeight: 105, borderRadius: 60, backgroundColor: 'rgba(255,255,255,0.96)', borderWidth: 4, borderColor: '#28A7B8', alignItems: 'center', justifyContent: 'center', padding: 14 },
  speechText: { color: '#102A5A', fontSize: 18, lineHeight: 23, fontWeight: '800', textAlign: 'center' },
  referenceBottom: { width: '100%', alignItems: 'center', gap: 10 },
  referenceButton: { width: '88%', minHeight: 58, borderRadius: 30, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  referencePrimary: { backgroundColor: '#1288ED' },
  referenceSecondary: { backgroundColor: 'rgba(255,255,255,0.96)' },
  referencePrimaryText: { color: '#FFFFFF', fontSize: 20, fontWeight: '900', textAlign: 'center' },
  referenceSecondaryText: { color: '#102A5A', fontSize: 18, fontWeight: '900', textAlign: 'center' },
  featureCircles: { width: '90%', flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: 2 },
  featureCircle: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', padding: 4 },
  featureIcon: { color: '#102A5A', fontSize: 20, fontWeight: '900', lineHeight: 22 },
  featureLabel: { color: '#102A5A', fontSize: 10, lineHeight: 11, fontWeight: '800', textAlign: 'center' },
  smallWalks: { color: '#FFFFFF', fontSize: 13, lineHeight: 16, letterSpacing: 1.2, fontWeight: '700', textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 5 },
  formSafeArea: { flex: 1, backgroundColor: '#DFF5EE' },
  formHero: { width: '100%', maxWidth: 560, minHeight: 82, borderRadius: 24, backgroundColor: '#BFE8DA', flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 14, marginBottom: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#CBE9DF' },
  formHeroDesktop: { maxWidth: 680, minHeight: 104 },
  formSpeech: { flex: 1, maxWidth: 330, backgroundColor: '#FFFFFF', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 2, borderColor: '#2AA7B8' },
  formSpeechText: { color: '#102A5A', fontSize: 16, lineHeight: 22, fontWeight: '800', textAlign: 'center' },
  flexFull: { flex: 1 },
  formScrollContent: { alignItems: 'center', paddingTop: 14, paddingHorizontal: 18, paddingBottom: 34, minHeight: '100%', backgroundColor: '#DFF5EE' },
  formScrollContentDesktop: { paddingTop: 28, paddingHorizontal: 32, paddingBottom: 48 },

  eyebrow: { ...typography.caption, letterSpacing: 3.2, color: colors.primaryDark, fontWeight: '900', textAlign: 'center', marginBottom: spacing.md },
  heroTitle: { fontSize: 34, lineHeight: 42, fontWeight: '900', color: colors.textPrimary, textAlign: 'center', maxWidth: 360 },
  heroTitleOnPhoto: { textShadowColor: 'rgba(255,255,255,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 8 },
  heroSubtitle: { ...typography.body, color: '#55706C', textAlign: 'center', maxWidth: 430, marginTop: spacing.md, marginBottom: spacing.xl, fontSize: 17, lineHeight: 26 },
  heroSubtitleOnPhoto: { color: '#284D48' },
  heroTitleDesktop: { textAlign: 'right', alignSelf: 'stretch', maxWidth: 480, fontSize: 52, lineHeight: 60 },
  heroSubtitleDesktop: { textAlign: 'right', alignSelf: 'stretch', maxWidth: 480, fontSize: 18, lineHeight: 29 },
  textRight: { textAlign: 'right', alignSelf: 'stretch' },
  benefitRow: { width: '100%', maxWidth: breakpoints.readingColumn, flexDirection: 'row-reverse', gap: spacing.sm, marginBottom: spacing.md },
  benefitPill: { flex: 1, minHeight: 46, borderRadius: radii.round, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, borderWidth: 1, borderColor: '#D5ECE8' },
  benefitText: { ...typography.meta, color: colors.primaryDark, fontWeight: '800', textAlign: 'center' },
  actionCard: { width: '100%', maxWidth: breakpoints.readingColumn, backgroundColor: '#FFFFFF', borderRadius: 28, padding: spacing.lg, borderWidth: 1, borderColor: '#DDEBE8', shadowColor: '#123B36', shadowOpacity: 0.08, shadowRadius: 28, shadowOffset: { width: 0, height: 12 }, elevation: 3 },
  title: { ...typography.screenTitle, color: '#173A36', textAlign: 'center', fontSize: 30, lineHeight: 35, fontWeight: '900', maxWidth: 520 },
  titleDesktop: { fontSize: 42, lineHeight: 48 },
  joinTitle: { width: '100%', maxWidth: 620, fontSize: 27, lineHeight: 33 },
  subtitle: { fontSize: 14, lineHeight: 20, color: colors.textSecondary, marginTop: 4, marginBottom: 12, textAlign: 'center', maxWidth: 520 },
  subtitleDesktop: { fontSize: 16, marginBottom: 20 },
  wideButton: { width: '100%', marginTop: 8 },
  form: { width: '100%', maxWidth: 560, alignSelf: 'center', backgroundColor: '#FDFBF4', borderRadius: 24, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 18, borderWidth: 1, borderColor: '#B8DCCF', shadowColor: '#173A36', shadowOpacity: 0.08, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  formDesktop: { maxWidth: 680, paddingHorizontal: 28, paddingTop: 18, paddingBottom: 24 },
  label: { ...typography.meta, fontWeight: '800', color: '#6E675C', marginTop: 8, marginBottom: 5, textAlign: 'right' },
  stepHint: { fontSize: 14, lineHeight: 20, color: '#173A36', fontWeight: '800', textAlign: 'right', marginTop: 10, marginBottom: 2 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    minHeight: 54,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.textPrimary,
  },
  codeInput: { fontSize: 24, fontWeight: '800', letterSpacing: 4 },
  ltrInput: { writingDirection: 'ltr' },
  error: { fontSize: 13, color: colors.statusOverdue, fontWeight: '600', marginTop: 10, textAlign: 'right' },
  foundCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginTop: spacing.md,
  },
  foundTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, textAlign: 'right' },
  foundSubtitle: { fontSize: 14, color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'right' },
  previewDogRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, marginBottom: 10 },
  previewDogName: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  previewMembersRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.md, justifyContent: 'flex-end' },
  previewMember: { alignItems: 'center', width: 56, gap: spacing.xs },
  previewMemberName: { fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
});
