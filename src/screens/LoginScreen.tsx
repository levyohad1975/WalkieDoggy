import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { RtlText } from '../components/RtlText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFamilyStore } from '../store/familyStore';
import { useAuthStore } from '../store/authStore';
import { colors } from '../theme/colors';
import { breakpoints } from '../theme/tokens';
import { Button } from '../components/Button';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { UserFormModal } from '../components/UserFormModal';
import { PinEntryModal } from '../components/PinEntryModal';
import { DEMO_FAMILY } from '../data/demoData';
import { friendlyErrorMessage } from '../lib/errorMessages';

/**
 * Maps a claimFamilyProfile() rejection (see authStore.signIn /
 * claim_family_profile() in migrations/0004_*.sql) to a friendly Hebrew
 * message. Delegates to the centralized map (src/lib/errorMessages.ts, A5) —
 * kept as its own exported function (rather than inlining
 * friendlyErrorMessage at each call site) both for the two call sites below
 * and because authStore.test.ts imports it directly. `claim could not be
 * verified` gets its own more specific wording here (framed like a
 * connectivity hiccup, per authStore.signIn()'s post-claim whoami()
 * verification doc comment) rather than the shared table's generic version,
 * and the fallback is claim-flow-specific rather than the shared generic one.
 */
export function claimErrorMessage(err: unknown): string {
  return friendlyErrorMessage(
    err,
    [{ includes: 'claim could not be verified', message: 'לא הצלחנו לאמת את ההתחברות לפרופיל הזה. ודאו שיש חיבור לאינטרנט ונסו שוב.' }],
    'לא הצלחנו להתחבר לפרופיל הזה — נסו שוב.'
  );
}

/**
 * "Pick your profile" — the simple login called for in the MVP. Real
 * authentication can later replace `signIn` (see store/authStore.ts) without
 * touching this screen's layout.
 *
 * This screen must never dead-end: if there are no family members yet (first
 * run, or a family that deleted everyone), "הוספת בן משפחה" lets you create
 * one right here — no need to already be signed in to reach a Family/Settings
 * screen that itself requires being signed in first. That button is
 * admin-only (see is_family_admin()-backed "insert users" RLS policy).
 *
 * WORDING NOTE: the empty-state check below is `activeUsers.length === 0` —
 * i.e. no ACTIVE profiles exist at all (everyone is soft-deleted or none
 * were ever added). It is deliberately NOT "no CLAIMABLE profile" — this
 * screen has no way to tell, for a given active profile, whether it's
 * already claimed by a different device (that would require exposing
 * `users.auth_user_id`, which nothing in this client currently reads or
 * needs to). A Member can still tap an already-claimed active profile here;
 * the actual claim/anti-takeover decision is made server-side by
 * claim_family_profile() (migrations/0004_*.sql) when they do, and a
 * rejection surfaces via handleSignIn's claimError banner below — see
 * claimErrorMessage().
 */
export function LoginScreen() {
  const { family, users, loading, error, load, addUser } = useFamilyStore();
  const signIn = useAuthStore((s) => s.signIn);
  const signInWithPin = useAuthStore((s) => s.signInWithPin);
  // Single source of truth for admin/member permissions — see authStore.
  // Already resolved by the time this screen can render: Supabase mode
  // resolves it when this device creates/joins a family (before "pick your
  // profile" is ever shown), and local/demo mode is always 'admin'.
  const familyRole = useAuthStore((s) => s.familyRole);
  const isAdmin = familyRole === 'admin';
  // Resolved once this device has created/joined a family (Supabase mode)
  // or always the seeded demo family (local/demo mode) — App.tsx never
  // renders this screen before one of those is true.
  const familyId = useAuthStore((s) => s.familyId) ?? DEMO_FAMILY.id;

  const [formVisible, setFormVisible] = useState(false);
  const [signingInUserId, setSigningInUserId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  // Root-cause fix for "no active profile claimed on this family" (see
  // authStore.ts's checkClaimStillValid) — a one-time explanatory banner
  // for the specific case where this device's OWN session was detected as
  // stale (rather than an ordinary claim rejection from picking a name
  // below), so landing back here doesn't look like an unexplained sign-out.
  const staleClaimRecovered = useAuthStore((s) => s.staleClaimRecovered);
  const staleClaimUserId = useAuthStore((s) => s.staleClaimUserId);
  const clearStaleClaimNotice = useAuthStore((s) => s.clearStaleClaimNotice);
  // COMPLETION PASS — 7D: which profile the "התחבר מחדש כ-X" PIN flow below
  // targets. Set either from staleClaimRecovered's staleClaimUserId (this
  // device's OWN claim was superseded elsewhere) or from an ordinary
  // "already claimed by another device" rejection when tapping a name below
  // (someone picking up their profile on a new/different device) — same
  // underlying situation, two different ways of reaching it, one PIN flow.
  const [pinReclaimUserId, setPinReclaimUserId] = useState<string | null>(null);
  // A removed (soft-deleted) family member must never be selectable to sign
  // in as — see FamilyUser.removedAt's doc comment. They still exist in
  // `users` so History can resolve their name/avatar.
  const activeUsers = users.filter((u) => !u.removedAt);

  useEffect(() => {
    load(familyId);
  }, [load, familyId]);

  const handleSignIn = async (userId: string) => {
    setClaimError(null);
    setSigningInUserId(userId);
    try {
      await signIn(userId);
      // On success App.tsx swaps this screen out once currentUserId is set
      // — nothing else to do here, except clear the one-time stale-claim
      // notice so it doesn't linger into the next time this screen shows.
      clearStaleClaimNotice();
    } catch (err) {
      setClaimError(claimErrorMessage(err));
      // 7D: an ordinary claim rejected because it's already claimed
      // elsewhere is exactly the same situation as staleClaimRecovered
      // (just discovered a different way — by tapping the name, rather than
      // this device's own stale-session check) — offer the same PIN-reclaim
      // path rather than a dead end.
      const rawMessage = err instanceof Error ? err.message : (err && typeof err === 'object' && 'message' in err ? String((err as { message?: unknown }).message ?? '') : String(err ?? ''));
      if (rawMessage.includes('profile already claimed by another device')) {
        setPinReclaimUserId(userId);
      }
    } finally {
      setSigningInUserId(null);
    }
  };

  const staleClaimUser = staleClaimUserId ? users.find((u) => u.id === staleClaimUserId) : null;
  const pinReclaimUser = pinReclaimUserId ? users.find((u) => u.id === pinReclaimUserId) : null;

  const handlePinReclaim = async (pin: string) => {
    if (!pinReclaimUserId) return;
    try {
      await signInWithPin(pinReclaimUserId, pin);
    } catch (err) {
      // Re-throw as a friendly Hebrew message — PinEntryModal displays
      // whatever Error.message it catches directly, so translate here
      // rather than making the modal know about errorMessages.ts.
      throw new Error(claimErrorMessage(err));
    }
    // On success App.tsx swaps this screen out — clear every local notice
    // so nothing lingers into the next time LoginScreen shows.
    clearStaleClaimNotice();
    setClaimError(null);
    setPinReclaimUserId(null);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.center}>
        <ErrorState message={error} onRetry={() => load(familyId)} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.contentWrap, Platform.OS === 'web' && styles.webContent]}>
      <RtlText style={styles.emoji}>🐶</RtlText>
      <RtlText style={styles.title}>{family?.name ?? 'המשפחה שלנו'}</RtlText>
      <RtlText style={styles.subtitle}>מי אתה?</RtlText>

      {activeUsers.length === 0 ? (
        isAdmin ? (
          <EmptyState title="אין עדיין בני משפחה" subtitle="הוסיפו את בן המשפחה הראשון כדי להתחיל" />
        ) : (
          // A Member can't add a family member (server-side admin-only —
          // see "insert users (family admins only)" in schema.sql) and
          // there are no active profiles at all to pick from, so offering
          // "+ הוספת בן משפחה" here would just be an action the server is
          // guaranteed to reject. Tell them what's actually true instead.
          <EmptyState
            title="אין פרופיל פעיל לבחירה"
            subtitle="פנו למנהל המשפחה כדי להוסיף בן משפחה"
          />
        )
      ) : (
        <View style={styles.grid}>
          {activeUsers.map((u) => (
            <Button
              key={u.id}
              label={u.name}
              variant="secondary"
              onPress={() => handleSignIn(u.id)}
              disabled={signingInUserId !== null}
              loading={signingInUserId === u.id}
              style={styles.userButton}
              icon={u.avatar}
            />
          ))}
        </View>
      )}

      {staleClaimRecovered ? (
        <View style={styles.errorBanner}>
          <RtlText style={styles.errorText}>
            {staleClaimUser
              ? `הפרופיל ${staleClaimUser.name} הופעל במכשיר אחר.`
              : 'החיבור של המכשיר הזה פג — בחרו את הפרופיל שלכם שוב כדי להמשיך.'}
          </RtlText>
          {staleClaimUser ? (
            <RtlText
              style={styles.errorDismiss}
              onPress={() => setPinReclaimUserId(staleClaimUser.id)}
            >
              {`התחבר מחדש כ${staleClaimUser.name}`}
            </RtlText>
          ) : null}
          <RtlText style={styles.errorDismiss} onPress={clearStaleClaimNotice}>
            הבנתי
          </RtlText>
        </View>
      ) : null}

      {claimError ? (
        <View style={styles.errorBanner}>
          <RtlText style={styles.errorText}>{claimError}</RtlText>
          <RtlText style={styles.errorDismiss} onPress={() => setClaimError(null)}>
            הבנתי
          </RtlText>
        </View>
      ) : null}

      {isAdmin ? (
        <Button
          label="+ הוספת בן משפחה"
          variant={activeUsers.length === 0 ? 'primary' : 'secondary'}
          onPress={() => setFormVisible(true)}
          style={styles.addButton}
        />
      ) : null}

      <UserFormModal
        visible={formVisible}
        editingUser={null}
        familyId={familyId}
        onSave={async (input) => {
          const wasFirstUser = activeUsers.length === 0;
          const created = await addUser(input);
          setFormVisible(false);
          // First run: sign the very first family member straight in instead
          // of making them tap their own name on the next screen — one less
          // dead-end tap on an otherwise-empty screen. A brand-new user is
          // guaranteed unclaimed, so this claim cannot be rejected by the
          // "already claimed by another device" rule — but still surface it
          // rather than silently swallowing, in case of an unrelated failure
          // (network, etc.).
          if (wasFirstUser) {
            try {
              await signIn(created.id);
            } catch (err) {
              setClaimError(claimErrorMessage(err));
            }
          }
        }}
        onClose={() => setFormVisible(false)}
      />

      <PinEntryModal
        visible={pinReclaimUserId !== null}
        userName={pinReclaimUser?.name ?? ''}
        onSubmit={handlePinReclaim}
        onCancel={() => setPinReclaimUserId(null)}
      />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, alignItems: 'center', paddingTop: 80, paddingHorizontal: 24 },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  // width: '100%' preserves today's behavior on every platform (this box
  // previously WAS the container's only child, implicitly filling it); the
  // web-only maxWidth+alignSelf below layers HomeScreen's same desktop-
  // containment pattern on top, without touching `container`'s own
  // full-bleed background.
  contentWrap: { width: '100%', alignItems: 'center' },
  webContent: { maxWidth: breakpoints.desktopContent, alignSelf: 'center' },
  emoji: { fontSize: 64, marginBottom: 8 },
  title: { fontSize: 26, fontWeight: '800', color: colors.textPrimary },
  subtitle: { fontSize: 16, color: colors.textSecondary, marginTop: 4, marginBottom: 32 },
  grid: { width: '100%', gap: 14 },
  userButton: { width: '100%' },
  addButton: { width: '100%', marginTop: 20 },
  errorBanner: {
    width: '100%',
    marginTop: 20,
    backgroundColor: colors.statusOverdueBg,
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  errorText: { flex: 1, color: colors.statusOverdue, fontWeight: '600', textAlign: 'right' },
  errorDismiss: { color: colors.statusOverdue, fontWeight: '800' },
});
