import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { RtlText } from '../components/RtlText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../store/authStore';
import { colors } from '../theme/colors';
import { breakpoints } from '../theme/tokens';
import { Button } from '../components/Button';
import { createFamily, ensureAnonymousSession, findFamilyByInviteCode, joinFamily } from '../lib/supabase';
import {
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

type Mode = 'choose' | 'create' | 'join' | 'redeem';

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
  const [mode, setMode] = useState<Mode>('choose');

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

  const submitCreate = async () => {
    if (!familyName.trim() || !verifiedAdminEmail) return;
    setCreating(true);
    setCreateError(null);
    try {
      const identity = await getVerifiedAdminIdentity();
      if (identity.email !== verifiedAdminEmail) {
        throw new Error('יש לאמת מחדש את כתובת הדוא״ל לפני יצירת המשפחה');
      }
      const family = await createFamily(familyName.trim(), dogName.trim() || undefined);
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

  if (mode === 'choose' && pendingInviteRedemption) {
    // Round 4 — a redemption already succeeded server-side but this device
    // hasn't confirmed it yet (see authStore.ts). Deliberately NOT the
    // ordinary paste form — retrying with the same token would replay an
    // already-consumed invite and (correctly, but confusingly) fail with
    // "ההזמנה הזו כבר נוצלה". Only whoami() verification is retried.
    return (
      <SafeAreaView style={styles.container}>
        <RtlText style={styles.emoji}>⏳</RtlText>
        <RtlText style={styles.title}>ממתין לאימות</RtlText>
        <RtlText style={styles.subtitle}>
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
      <SafeAreaView style={styles.container}>
        {/* BATCH 4 (item C — branding/onboarding): before a family exists,
            Walkie Doggy IS the brand — the official mascot (see the Batch 4
            report for the source asset) replaces the generic 🐶 emoji that
            was here before. Given an explicit accessibilityLabel since this
            IS the meaningful content on this screen, not a decorative
            corner badge. */}
        <WalkieMascot state="idle" size={128} accessibilityLabel="הקמע של Walkie Doggy Link" testID="onboarding-mascot" />
        <RtlText style={styles.title}>ברוכים הבאים</RtlText>
        <RtlText style={styles.subtitle}>יצירת משפחה חדשה, או הצטרפות למשפחה קיימת עם קוד הזמנה</RtlText>

        <Button label="יצירת משפחה חדשה" onPress={() => setMode('create')} style={styles.wideButton} />
        <Button label="הצטרפות למשפחה קיימת" variant="secondary" onPress={() => setMode('join')} style={styles.wideButton} />
        <Button
          label="יש לי הזמנה"
          variant="secondary"
          onPress={() => {
            resetRedeemMode();
            setMode('redeem');
          }}
          style={styles.wideButton}
        />
      </SafeAreaView>
    );
  }

  if (mode === 'create') {
    return (
      <SafeAreaView style={styles.formSafeArea}>
        <KeyboardAvoidingView style={styles.flexFull} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.formScrollContent} keyboardShouldPersistTaps="handled">
            <RtlText style={styles.title}>יצירת משפחה חדשה</RtlText>
            <RtlText style={styles.subtitle}>אחרי היצירה תוכלו להוסיף את בני המשפחה</RtlText>

            <View style={styles.form}>
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

              <RtlText style={styles.label}>שם המשפחה</RtlText>
              <TextInput
                value={familyName}
                onChangeText={setFamilyName}
                placeholder="למשל: המשפחה שלנו"
                placeholderTextColor={colors.textSecondary}
                style={styles.input}
                textAlign="right"
                editable={Boolean(verifiedAdminEmail)}
              />

              <RtlText style={styles.label}>שם הכלב/ה (אופציונלי)</RtlText>
              <TextInput
                value={dogName}
                onChangeText={setDogName}
                placeholder="אפשר להוסיף גם אחר כך בהגדרות"
                placeholderTextColor={colors.textSecondary}
                style={styles.input}
                textAlign="right"
                editable={Boolean(verifiedAdminEmail)}
              />

              {createError ? <RtlText style={styles.error}>{createError}</RtlText> : null}

              <Button
                label={creating ? 'יוצר משפחה...' : 'יצירת המשפחה'}
                onPress={submitCreate}
                disabled={!familyName.trim() || !verifiedAdminEmail || creating}
                loading={creating}
                style={styles.wideButton}
              />
              <Button label="חזרה" variant="secondary" onPress={() => setMode('choose')} style={styles.wideButton} />
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
            <RtlText style={styles.title}>יש לי הזמנה</RtlText>
            <RtlText style={styles.subtitle}>הדביקו את קישור ההזמנה, או את קוד ההזמנה עצמו, שקיבלתם מבן/בת המשפחה</RtlText>

            <View style={styles.form}>
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
                style={styles.input}
                textAlign="right"
                autoCapitalize="none"
                autoCorrect={false}
              />

              {inspecting ? <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} /> : null}
              {inspectError ? <RtlText style={styles.error}>{inspectError}</RtlText> : null}

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

                  {redeemError ? <RtlText style={styles.error}>{redeemError}</RtlText> : null}

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
                  setMode('choose');
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
          <RtlText style={styles.title}>הצטרפות למשפחה קיימת</RtlText>
          <RtlText style={styles.subtitle}>הקלידו את קוד ההזמנה שקיבלתם מבן/בת המשפחה</RtlText>

          <View style={styles.form}>
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
              style={[styles.input, styles.codeInput]}
              textAlign="center"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={8}
            />

            {looking ? <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} /> : null}
            {joinError ? <RtlText style={styles.error}>{joinError}</RtlText> : null}

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

            <Button label="חזרה" variant="secondary" onPress={() => setMode('choose')} style={styles.wideButton} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, alignItems: 'center', paddingTop: 80, paddingHorizontal: 24 },
  formSafeArea: { flex: 1, backgroundColor: colors.background },
  flexFull: { flex: 1 },
  formScrollContent: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 24 },
  emoji: { fontSize: 64, marginBottom: 8 },
  title: { fontSize: 24, fontWeight: '800', color: colors.textPrimary, textAlign: 'center' },
  subtitle: { fontSize: 15, color: colors.textSecondary, marginTop: 8, marginBottom: 28, textAlign: 'center' },
  wideButton: { width: '100%', marginTop: 12 },
  form: { width: '100%', maxWidth: breakpoints.readingColumn, alignSelf: 'center' },
  label: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginTop: 14, marginBottom: 8, textAlign: 'right' },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
    fontSize: 16,
    color: colors.textPrimary,
  },
  codeInput: { fontSize: 24, fontWeight: '800', letterSpacing: 4 },
  error: { fontSize: 13, color: colors.statusOverdue, fontWeight: '600', marginTop: 10, textAlign: 'right' },
  foundCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 16,
    marginTop: 14,
  },
  foundTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, textAlign: 'right' },
  foundSubtitle: { fontSize: 14, color: colors.textSecondary, marginTop: 4, textAlign: 'right' },
  previewDogRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, marginBottom: 10 },
  previewDogName: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  previewMembersRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12, justifyContent: 'flex-end' },
  previewMember: { alignItems: 'center', width: 56, gap: 4 },
  previewMemberName: { fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
});
