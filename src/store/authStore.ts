import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import {
  beginImpersonation as beginImpersonationRpc,
  claimFamilyProfile,
  claimFamilyProfileWithPin,
  endImpersonation as endImpersonationRpc,
  ensureAnonymousSession,
  getCurrentFamilyIsQa,
  getCurrentFamilyRole,
  getWhoAmI,
  isSupabaseConfigured,
  type FamilyRole,
} from '../lib/supabase';
import { DEMO_FAMILY } from '../data/demoData';
import { repository } from '../data';

const CURRENT_USER_KEY = 'dog-walk-family:current-user-id';
// Device-local: which family THIS device belongs to. Deliberately separate
// from currentUserId (which family MEMBER this device is signed in as) —
// requirement is that currentUserId stays device-local and is never shared
// between phones, while familyId is what every device of the same family
// must agree on (established once via create/join, see
// FamilyOnboardingScreen). In local/demo mode this is always the single
// seeded demo family and the onboarding screen never shows.
const FAMILY_ID_KEY = 'dog-walk-family:current-family-id';

/**
 * Round 4 — invited-user redemption. Holds ONLY the two plain, non-secret
 * ids redeem_family_invite() itself returned (family_id, target_user_id) —
 * NEVER the raw invite token, the invite link, or token_hash (that raw
 * token is already out of scope by the time this is written; see
 * FamilyOnboardingScreen.tsx's redeem-mode). This is deliberately NOT the
 * same thing as "signed in" — writing here never sets/persists
 * familyId/currentUserId (see completeInviteRedemption's doc comment for
 * the full ordering rationale: this only exists so a transient whoami()
 * failure immediately after a successful server-side redemption is
 * recoverable — by retrying verification, never by resubmitting the
 * already-consumed token — including across an app restart via
 * restoreSession() below.
 */
const PENDING_REDEMPTION_KEY = 'dog-walk-family:pending-invite-redemption';

interface PendingInviteRedemption {
  familyId: string;
  targetUserId: string;
}

/**
 * Simple "pick your profile" auth for the MVP (no password — a family app
 * used by trusted household members). When Supabase is configured, picking a
 * profile also "claims" it for this device (see lib/supabase.ts) so Row
 * Level Security can scope this device's requests to the family — that's
 * what makes the same data show up on everyone's phone. In local/demo mode
 * (no Supabase configured) this is skipped entirely and behavior is
 * unchanged from before.
 */
interface AuthState {
  currentUserId: string | null;
  /** null in Supabase mode until this device creates/joins a family (see FamilyOnboardingScreen). Always DEMO_FAMILY.id in local/demo mode. */
  familyId: string | null;
  /**
   * This device's role within its family — 'admin' (created the family) or
   * 'member' (joined via invite code). This is the SINGLE source of truth
   * for admin/member permission checks across the app (ScheduleScreen,
   * FamilyScreen, SettingsScreen) — screens read it from here rather than
   * each independently calling getCurrentFamilyRole(). Always 'admin' in
   * local/demo mode (a single device fully controls its own demo family;
   * there is no multi-device concept to restrict). null while unknown
   * (Supabase mode, not yet resolved) or before hydration.
   */
  familyRole: FamilyRole | null;
  /**
   * FINAL CORRECTION PASS — Deliverable 2. Whether the CURRENTLY active
   * family (real or QA — current_family_id() resolves to whichever this
   * device's family_auth_members row currently points at) is a QA sandbox.
   * Refreshed alongside familyRole (same round trip, see refreshFamilyRole)
   * — always false in local/demo mode. UI-only: gates which QA actions
   * render and shows the "you are in a QA sandbox" indicator; the server
   * independently re-checks is_qa on every QA reset RPC regardless of what
   * this says.
   */
  isQaFamily: boolean;
  hydrated: boolean;
  restoreSession: () => Promise<void>;
  signIn: (userId: string) => Promise<void>;
  /**
   * COMPLETION PASS — 7B/7D (single-claim-at-a-time reclaim). Same
   * server-authoritative guarantees as signIn() (claim_family_profile_with_pin()
   * is the real gate — self-membership + bcrypt PIN verification happen
   * DB-side, never here), but used when the target profile is currently
   * claimed by a DIFFERENT device and the person switching devices knows its
   * PIN. Shares signIn()'s exact post-claim finalize sequence (queue flush
   * guard, whoami() verification, stale-impersonation cleanup, persisting
   * CURRENT_USER_KEY) via the private finalizeClaimedSignIn() helper below —
   * this is not a second implementation of that logic. The PIN itself is
   * passed straight through to the RPC call and is never assigned to any
   * store field, logged, or persisted — see claimFamilyProfileWithPin() in
   * lib/supabase.ts.
   */
  signInWithPin: (userId: string, pin: string) => Promise<void>;
  /** Internal — shared implementation behind signIn()/signInWithPin(). Not for outside callers. */
  __signInCore: (userId: string, mode: 'plain' | 'pin', pin?: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Called once this device has created or joined a family (Supabase mode only). */
  setFamilyId: (familyId: string) => Promise<void>;
  /** Re-resolves familyRole from the server (Supabase mode) or 'admin' (local/demo mode). Safe to call anytime; failures leave familyRole null rather than throwing. */
  refreshFamilyRole: () => Promise<void>;

  /**
   * Round 7, Part 2 — see the final report's "self role change leaves
   * familyRole stale" investigation. MemberDetailsModal's onRoleChanged
   * (wired from FamilyScreen) calls this AFTER set_member_role() has
   * already succeeded server-side for `changedUserId` — never on a failed
   * role-change RPC, since the caller only reaches this after its own
   * await of setMemberRole() resolves without throwing.
   */
  roleRefreshNotice: string | null;
  refreshOwnRoleAfterChange: (changedUserId: string) => Promise<void>;
  clearRoleRefreshNotice: () => void;

  /**
   * ADMIN TEST MODE — lets an Admin see the Home screen the way a chosen
   * regular member would, WITHOUT actually becoming that member.
   *
   * Deliberately in-memory only (not persisted to AsyncStorage): an app
   * restart always comes back up as the real Admin, so test mode can never
   * silently survive across a cold start. `currentUserId` (the REAL,
   * authenticated identity used by claim_family_profile()/RLS) is never
   * touched by this — `testModeUserId` is a purely additive, UI-layer
   * overlay read by screens that choose to honor it.
   *
   * Design decision (see final report): this is UI-SIMULATION-ONLY, not an
   * auditable "admin acting on behalf of" feature. Screens that render
   * member-facing UI may read `testModeUserId` to decide what to SHOW, but
   * every mutating action (mark done, add a spontaneous walk, request a
   * swap, etc.) must keep using the REAL `currentUserId` for who it
   * attributes the change to — never `testModeUserId`. This is the safer
   * default given the existing architecture has no concept of an
   * auditable on-behalf-of actor; it avoids a member ever waking up to a
   * walk or request they didn't actually create.
   */
  testModeUserId: string | null;
  /** Admin-only; throws if the caller is not currently resolved as admin. */
  enterTestMode: (userId: string) => void;
  exitTestMode: () => void;
  /**
   * Safety net for "must not survive confusingly/unsafely": call after the
   * family roster changes (a member removed, a member reload) with the
   * current list of active user ids. If the currently-simulated member is
   * no longer active/present, test mode is silently exited.
   */
  clearTestModeIfInvalid: (activeUserIds: string[]) => void;

  /**
   * REAL ADMIN QA / IMPERSONATION MODE ("בדיקה אמיתית כמשתמש") — a SEPARATE,
   * more powerful feature from Admin Test Mode above. See
   * migrations/0006_qa_impersonation.sql for the full design. Unlike
   * testModeUserId, this is NOT display-only: while impersonatingUserId is
   * set, the SERVER's own current_profile_id()/is_family_admin() (used by
   * every RLS policy and RPC) resolve as the target member — real requests,
   * real RLS visibility, real RPC authorization — via a server-tracked
   * session keyed to this device's own auth.uid(), never a client-supplied
   * actor id. Deliberately in-memory only, exactly like testModeUserId, for
   * the same restart-safety reason: restoreSession() below always calls
   * endImpersonationRpc() best-effort BEFORE resolving anything else, so a
   * killed/restarted app can never resume a session the UI doesn't show a
   * banner for (see beginImpersonation/endImpersonation below).
   */
  impersonatingUserId: string | null;
  /**
   * ROUND-5 RACE FIX: true synchronously from the moment beginImpersonation()
   * has passed its initial guards until its RPC call (and the subsequent
   * commit/defensive-recheck) has fully settled, in a try/finally so it is
   * ALWAYS reset to false no matter how that call ends. This exists purely
   * to close the window where `impersonatingUserId` is still null (the RPC
   * hasn't resolved yet) but a real impersonation is already IN FLIGHT — a
   * window during which the OLD code let a concurrent enterTestMode() call
   * pass its `impersonatingUserId` guard and set `testModeUserId`, so that
   * when the RPC later resolved, BOTH ended up set at once (an invalid
   * state). enterTestMode() now also rejects while this is true. In-memory
   * only, like testModeUserId/impersonatingUserId — never persisted.
   */
  impersonationStarting: boolean;
  /** Admin-only; throws if the caller is not a REAL admin, or on any server-side rejection (cross-family, removed, self). */
  beginImpersonation: (userId: string) => Promise<void>;
  endImpersonation: () => Promise<void>;
  /**
   * Safety net mirroring clearTestModeIfInvalid() above, for REAL
   * impersonation (round-3 cleanup-ordering audit): call after the family
   * roster changes with the current list of active user ids. If the member
   * currently being impersonated is no longer active/present (removed by
   * another device mid-session), the local banner/state is cleared here
   * too, best-effort ending the server-side session in the background.
   * This is a UX/hygiene cleanup, not the security boundary — the server's
   * own active_impersonation_target() (0006) already fails closed the
   * moment the target's removed_at is set, independent of whether this
   * ever runs — but without it, this device's banner would otherwise keep
   * showing "בדיקה אמיתית: מחובר כ-<שם שהוסר>" until a manual exit or an
   * app restart, which is exactly the kind of stale/confusing UI state
   * this feature's own requirements call out.
   */
  clearImpersonationIfInvalid: (activeUserIds: string[]) => void;

  /**
   * Root-cause fix for "no active profile claimed on this family" (see
   * final report): true for exactly one restoreSession() after this device
   * detected that its locally-cached currentUserId no longer matches the
   * server's own record of which profile this device's auth session has
   * claimed, and recovered by clearing it. LoginScreen shows a one-time
   * explanatory banner instead of the person just silently landing back on
   * "pick your profile" with no idea why. Cleared via
   * clearStaleClaimNotice() once shown.
   */
  staleClaimRecovered: boolean;
  /**
   * COMPLETION PASS — 7D. Which profile was lost, captured alongside
   * staleClaimRecovered by both restoreSession() and revalidateClaim()
   * BEFORE currentUserId is cleared, so LoginScreen can name the profile
   * ("הפרופיל עידן הופעל במכשיר אחר") and offer a direct "התחבר מחדש כעידן"
   * PIN-reclaim action instead of the generic wording alone. null whenever
   * staleClaimRecovered is false; cleared together with it.
   */
  staleClaimUserId: string | null;
  clearStaleClaimNotice: () => void;
  /**
   * Same check as restoreSession()'s, but callable anytime (e.g. on
   * foreground — see App.tsx) to catch a claim going stale WHILE the app
   * is already open, not just at cold start. Safe to call frequently: it's
   * one lightweight read-only RPC, and a no-op (no sign-out) whenever the
   * claim is still valid or the check itself couldn't complete (offline).
   */
  revalidateClaim: () => Promise<void>;

  /**
   * Round 4 — invited-user redemption (manual link/token entry, see
   * FamilyOnboardingScreen.tsx's 'redeem' mode). Non-null exactly when a
   * redeem_family_invite() call has succeeded SERVER-SIDE but this device
   * has not yet been able to confirm it via whoami() (e.g. offline right
   * after redeeming). Never the raw token — see PendingInviteRedemption's
   * own doc comment above. Lets FamilyOnboardingScreen show a dedicated
   * "ממתין לאימות" state (with a retry-verification action) on next mount —
   * including right after a cold start, once restoreSession() below has
   * had a chance to recover it — instead of the ordinary create/join/redeem
   * choices.
   */
  pendingInviteRedemption: PendingInviteRedemption | null;
  /**
   * Round 4 — the ONLY entry point that commits a successful invite
   * redemption into this device's authoritative state. Call this
   * immediately after `redeemFamilyInvite(token)` (src/lib/invites.ts)
   * resolves, passing its result. Never calls claimFamilyProfile() or
   * joinFamily() — redeem_family_invite() (migrations/0008/0009) already
   * performed the equivalent of both, atomically, server-side; this action
   * only verifies that and wires the now-verified result into familyId/
   * currentUserId. See its own doc comment below for the full ordering.
   */
  completeInviteRedemption: (result: {
    familyId: string;
    targetUserId: string;
  }) => Promise<'verified' | 'unverified' | 'mismatch'>;
  /**
   * Round 4 — retries ONLY the whoami() verification step for an existing
   * pending redemption (see pendingInviteRedemption above) — never calls
   * redeemFamilyInvite()/any lib/invites.ts function, so an already-
   * consumed invite token is never resubmitted. Returns 'none' if there is
   * no pending redemption to retry.
   */
  retryPendingInviteRedemptionVerification: () => Promise<'verified' | 'unverified' | 'mismatch' | 'none'>;
}
function isUuid(value: string | null): value is string {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

/**
 * ROOT-CAUSE FIX for "no active profile claimed on this family" (see final
 * report's Idan investigation). Both restoreSession() and revalidateClaim()
 * used to (and, for foreground, never did at all) trust the
 * AsyncStorage-cached currentUserId with NO server round-trip to confirm
 * this device's claim is actually still valid. If this device's underlying
 * Supabase auth identity and the server's record of who claimed this
 * profile have ever diverged for ANY reason — the anonymous session being
 * silently replaced after its refresh token expired or was revoked (this
 * app does not wire supabase.auth.startAutoRefresh()/stopAutoRefresh() to
 * AppState, a documented React Native requirement, which makes losing the
 * session while backgrounded more likely than it should be); the app's
 * storage being cleared/reinstalled and the profile re-claimed from a
 * fresh identity while the OLD claim silently persists server-side; a
 * device rejoining a different family — the app would previously show as
 * "signed in" while every server-side write silently failed deep inside an
 * RPC with this exact message, and a plain sign-out/sign-in would NOT fix
 * it: signOut() never touches the underlying Supabase session or
 * re-validates anything, it only clears the local currentUserId, and
 * signing back in as the SAME cached profile from the SAME (already
 * broken) local state reproduces the identical failure.
 *
 * Returns true (claim confirmed valid), false (confirmed STALE — the
 * server's real_profile_id no longer matches), or null (couldn't tell —
 * offline or the RPC itself failed; callers must treat this as "no
 * information", never as a mismatch).
 */
async function checkClaimStillValid(cachedUserId: string): Promise<boolean | null> {
  try {
    const who = await getWhoAmI();
    if (!who) return null;
    return who.realProfileId === cachedUserId;
  } catch {
    return null;
  }
}

/**
 * Round 4 — the single place the corrected redeem-invite ordering lives,
 * shared by completeInviteRedemption(), retryPendingInviteRedemptionVerification(),
 * and restoreSession()'s own restart-recovery check below, so this exact
 * sequence exists in exactly one place:
 *
 *   1. getWhoAmI() — a fresh, server-authoritative read. NEVER
 *      claimFamilyProfile()/joinFamily() — redeem_family_invite() (0008/
 *      0009) already performed their equivalent atomically, server-side;
 *      calling either again here would be redundant at best and, at worst,
 *      a second, independent (and therefore possibly diverging) claim
 *      attempt.
 *   2. Three-way outcome, mirroring checkClaimStillValid()'s own
 *      true/false/null convention:
 *      - realProfileId === pending.targetUserId -> COMMIT: only now does
 *        familyId/currentUserId ever get written (AsyncStorage + store),
 *        and only now is the pending marker cleared. refreshFamilyRole()
 *        runs LAST, after the commit, so it resolves against the
 *        already-verified family_id.
 *      - realProfileId resolves to something else -> confirmed mismatch:
 *        clear the pending marker (nothing left to recover), never commit.
 *      - getWhoAmI() throws or returns null -> "couldn't tell" (offline/RPC
 *        failure): leave the pending marker exactly as it was, never
 *        commit, never clear it — the caller (UI or restoreSession) can
 *        retry later with no need to resubmit the already-consumed token.
 *
 * Deliberately never touches testModeUserId/impersonatingUserId beyond the
 * same reset setFamilyId() already does on a genuine family change — a
 * device reaching this action came from FamilyOnboardingScreen (no prior
 * familyId), so neither could have been set yet in practice, but resetting
 * them on COMMIT keeps this action's own state transition self-contained
 * rather than assuming that invariant holds forever.
 */
async function verifyAndCommitPendingRedemption(
  pending: PendingInviteRedemption,
  set: (partial: Partial<AuthState>) => void,
  get: () => AuthState
): Promise<'verified' | 'unverified' | 'mismatch'> {
  let who: Awaited<ReturnType<typeof getWhoAmI>>;
  try {
    who = await getWhoAmI();
  } catch {
    who = null;
  }

  if (!who) {
    // Couldn't tell — leave the marker in place, do not touch familyId/currentUserId.
    return 'unverified';
  }

  if (who.realProfileId !== pending.targetUserId) {
    // Confirmed mismatch — clear the now-unrecoverable marker; never commit.
    await AsyncStorage.removeItem(PENDING_REDEMPTION_KEY);
    if (get().pendingInviteRedemption) set({ pendingInviteRedemption: null });
    return 'mismatch';
  }

  // Verified — COMMIT. Only from this point does familyId/currentUserId
  // ever get written for this redemption.
  await AsyncStorage.setItem(FAMILY_ID_KEY, pending.familyId);
  await AsyncStorage.setItem(CURRENT_USER_KEY, pending.targetUserId);
  await AsyncStorage.removeItem(PENDING_REDEMPTION_KEY);
  set({
    familyId: pending.familyId,
    currentUserId: pending.targetUserId,
    testModeUserId: null,
    impersonatingUserId: null,
    pendingInviteRedemption: null,
  });
  await get().refreshFamilyRole();
  return 'verified';
}

export const useAuthStore = create<AuthState>((set, get) => ({
  currentUserId: null,
  familyId: null,
  familyRole: null,
  isQaFamily: false,
  hydrated: false,
  testModeUserId: null,
  impersonatingUserId: null,
  impersonationStarting: false,
  staleClaimRecovered: false,
  staleClaimUserId: null,
  roleRefreshNotice: null,
  pendingInviteRedemption: null,

  restoreSession: async () => {
    if (isSupabaseConfigured) {
      await ensureAnonymousSession().catch(() => undefined);
      // RESTART SAFETY (requirement: "App restart/session restoration must
      // not accidentally leave an ambiguous or unsafe impersonation
      // state"): impersonatingUserId is never persisted (see its doc
      // comment above) — it always starts false on a cold start. But the
      // SERVER-side session (impersonation_sessions) is tracked
      // independently and would otherwise survive an app kill with no
      // client-visible banner, silently leaving current_profile_id()/
      // is_family_admin() resolved as the impersonated member on THIS
      // device with nothing in the UI to show it. Ending it here,
      // unconditionally and best-effort, on every restore guarantees the
      // two can never drift apart. end_impersonation() is a safe no-op
      // when nothing is active (see its own doc comment), so this costs
      // nothing on the overwhelmingly common case.
      await endImpersonationRpc().catch(() => undefined);
    }
    const [savedUser, savedFamily] = await Promise.all([
      AsyncStorage.getItem(CURRENT_USER_KEY),
      AsyncStorage.getItem(FAMILY_ID_KEY),
    ]);
    const familyId = isSupabaseConfigured ? savedFamily : DEMO_FAMILY.id;

    let currentUserId = savedUser;

    if (isSupabaseConfigured && savedUser && !isUuid(savedUser)) {
      await AsyncStorage.removeItem(CURRENT_USER_KEY);
      currentUserId = null;
    }

    // ROOT-CAUSE FIX for "no active profile claimed on this family" (see
    // final report's Idan investigation) — see revalidateClaim()'s own doc
    // comment below for the full explanation. currentUserId/familyId are
    // not yet in the store at this point in restoreSession(), so this
    // passes them explicitly rather than reading get().
    let staleClaimRecovered = false;
    let staleClaimUserId: string | null = null;
    if (isSupabaseConfigured && currentUserId && familyId) {
      const stillValid = await checkClaimStillValid(currentUserId);
      if (stillValid === false) {
        // Capture WHICH profile was lost before clearing currentUserId (7D)
        // so LoginScreen can name it and offer a direct PIN-reclaim action.
        staleClaimUserId = currentUserId;
        await AsyncStorage.removeItem(CURRENT_USER_KEY);
        currentUserId = null;
        staleClaimRecovered = true;
      }
      // stillValid === null means "couldn't tell" (offline/RPC failure) —
      // don't punish someone for being offline; leave currentUserId as-is.
      // The next successful revalidateClaim() call (foreground, see
      // App.tsx) will catch a real mismatch once connectivity returns.
    }

    set({ currentUserId, familyId, hydrated: true, staleClaimRecovered, staleClaimUserId });
    if (familyId) await get().refreshFamilyRole();

    // Round 4 — restart recovery for an invite redemption that succeeded
    // server-side but whose whoami() verification never completed on this
    // device (e.g. the app was killed/lost connectivity right after
    // redeemFamilyInvite() resolved — see completeInviteRedemption's doc
    // comment). Only relevant when this device did NOT just restore an
    // existing currentUserId above — a device with an already-committed
    // profile has nothing pending to recover. Reuses the exact same
    // verify-and-commit helper (and its three-way outcome) as
    // completeInviteRedemption/retryPendingInviteRedemptionVerification, so
    // this is not a second implementation of that logic.
    if (isSupabaseConfigured && !get().currentUserId) {
      const rawPending = await AsyncStorage.getItem(PENDING_REDEMPTION_KEY);
      if (rawPending) {
        let pending: PendingInviteRedemption | null = null;
        try {
          const parsed = JSON.parse(rawPending);
          if (parsed && typeof parsed.familyId === 'string' && typeof parsed.targetUserId === 'string') {
            pending = { familyId: parsed.familyId, targetUserId: parsed.targetUserId };
          }
        } catch {
          pending = null;
        }
        if (pending) {
          const outcome = await verifyAndCommitPendingRedemption(pending, set, get);
          if (outcome === 'unverified') {
            // Couldn't tell yet (offline/RPC failure) — surface it so
            // FamilyOnboardingScreen shows the "ממתין לאימות" state instead
            // of the ordinary choose screen; the marker itself is untouched.
            set({ pendingInviteRedemption: pending });
          }
          // 'verified'/'mismatch' already updated familyId/currentUserId/
          // pendingInviteRedemption (or left them at their resolved values)
          // inside the helper — nothing further to do here.
        } else {
          // Corrupted/unparseable marker — drop it rather than retry forever.
          await AsyncStorage.removeItem(PENDING_REDEMPTION_KEY);
        }
      }
    }
  },

  clearStaleClaimNotice: () => set({ staleClaimRecovered: false, staleClaimUserId: null }),

  revalidateClaim: async () => {
    const { currentUserId } = get();
    if (!isSupabaseConfigured || !currentUserId) return;
    const stillValid = await checkClaimStillValid(currentUserId);
    if (stillValid === false) {
      // Capture which profile was lost (7D) BEFORE signOut() clears it.
      const lostUserId = currentUserId;
      // Re-use signOut()'s exact effect (clears currentUserId + any
      // impersonation) rather than duplicating it, then surface the same
      // one-time explanatory notice restoreSession() would have shown had
      // this drift been caught at cold start instead of mid-session (e.g.
      // this device's anonymous session's refresh token expiring/being
      // revoked hours into an already-open app — see restoreSession()'s
      // comment for why that's realistic here).
      await get().signOut();
      set({ staleClaimRecovered: true, staleClaimUserId: lostUserId });
    }
  },

  setFamilyId: async (familyId: string) => {
    // CLIENT/SERVER DRIFT FIX (security review, round 2): this device's
    // family is changing (create/join), so any server-side impersonation
    // session tied to the OLD family must not be left dangling. The
    // server-side re-validation added to active_impersonation_target()
    // (0006) already makes a stale session fail closed the moment
    // current_family_id() no longer matches it, so this call is not the
    // thing preventing a security issue — but without it, an orphaned
    // 'ended_at is null' row would sit in impersonation_sessions
    // indefinitely (never cleaned up, confusing for anyone reading the
    // table), and the unique partial index would then block this admin
    // device from ever starting a fresh session in its NEW family until
    // that old row is closed. Best-effort, mirroring restoreSession()/
    // signIn()'s own best-effort end_impersonation() calls.
    if (isSupabaseConfigured) {
      await endImpersonationRpc().catch(() => undefined);
    }
    await AsyncStorage.setItem(FAMILY_ID_KEY, familyId);
    // impersonationStarting is deliberately NOT reset here: setFamilyId() is
    // only ever called from the create/join onboarding flow, which can never
    // race with beginImpersonation() (there is no impersonation UI before a
    // family exists). If a future call site changed that, the try/finally in
    // beginImpersonation() below is still the thing that guarantees this
    // flag never sticks — see its own comment.
    set({ familyId, testModeUserId: null, impersonatingUserId: null });
    await get().refreshFamilyRole();

    // FINAL CORRECTION PASS — Deliverable 2 (QA sandbox enter/exit). Until
    // this pass, setFamilyId() was only ever called with currentUserId
    // already null (the very first create/join onboarding, before any
    // profile has ever been claimed on this device) — a genuine no-op for
    // this step. enter_qa_sandbox()/exit_qa_sandbox() are the FIRST callers
    // that switch familyId while currentUserId is ALREADY set: the cached
    // persona from the OLD family (real or QA) is meaningless — possibly
    // even actively wrong — under the NEW one. Resolve it from the server's
    // own authoritative whoami() (real_current_profile_id(), the exact
    // thing claim_family_profile()/..._with_pin() set) rather than guessing
    // client-side: exit_qa_sandbox() may have already re-claimed the
    // original persona server-side (best-effort), in which case this picks
    // it right back up with no extra tap; enter_qa_sandbox() always leaves
    // nothing claimed yet, in which case this correctly clears
    // currentUserId so LoginScreen's ordinary "pick your profile" (or "add
    // your first family member" for a brand-new QA family) shows, instead
    // of App.tsx routing into RootNavigator under a stale, no-longer-valid
    // persona id from the family just left.
    if (isSupabaseConfigured) {
      try {
        const verification = await getWhoAmI();
        if (verification?.realProfileId) {
          await AsyncStorage.setItem(CURRENT_USER_KEY, verification.realProfileId);
          set({ currentUserId: verification.realProfileId });
        } else {
          await AsyncStorage.removeItem(CURRENT_USER_KEY);
          set({ currentUserId: null });
        }
      } catch {
        // Offline/RPC failure right after a family switch — unlike
        // restoreSession()'s ordinary stale-claim check (where leaving a
        // POSSIBLY-still-valid currentUserId alone is the safer default),
        // here the family itself just changed, so the cached currentUserId
        // is guaranteed stale at best. Fail closed: clear it rather than
        // risk any screen querying under a persona id that belongs to a
        // family this device just left.
        await AsyncStorage.removeItem(CURRENT_USER_KEY);
        set({ currentUserId: null });
      }
    }
  },

  refreshFamilyRole: async () => {
    if (!isSupabaseConfigured) {
      // A single device is the whole "family" locally — always fully in
      // control, there's no other member to restrict it relative to. Local
      // mode has no QA-sandbox concept either.
      set({ familyRole: 'admin', isQaFamily: false });
      return;
    }
    try {
      const role = await getCurrentFamilyRole();
      set({ familyRole: role });
    } catch {
      set({ familyRole: null });
    }
    // Best-effort, separate try/catch: a failure here must never mask a
    // successful familyRole refresh above (the two are independent reads),
    // and must never leave a STALE isQaFamily=true showing after moving to
    // a different family — fail closed to false, matching familyRole's own
    // fail-closed-to-null discipline.
    try {
      const isQa = await getCurrentFamilyIsQa();
      set({ isQaFamily: isQa });
    } catch {
      set({ isQaFamily: false });
    }
  },

  /**
   * Round 7, Part 2 fix — see this action's own doc comment in AuthState
   * above for the full "self role change leaves familyRole stale" context.
   *
   * No-op (never touches familyRole, never calls the server) unless
   * `changedUserId` is THIS device's own REAL currentUserId — comparing
   * against the real, not effective/impersonated, id is deliberate:
   * role-management UI is already unreachable while impersonating (see
   * isRealFamilyAdmin() below), so in practice this only ever actually
   * does anything for a genuine self-role-change by the real signed-in
   * user. Changing ANOTHER member's role reloads the activity list
   * (FamilyScreen's own loadActivity(), called separately) but must never
   * re-derive or touch THIS device's familyRole — there's nothing stale
   * about it in that case.
   *
   * When it IS the current user's own role: awaits a fresh
   * refreshFamilyRole() read — never guesses/optimistically applies the
   * new role (setMemberRole() is server-authoritative; see lib/family.ts)
   * — so familyRole reflects the change immediately (covers BOTH
   * self-promotion and self-demotion symmetrically, since neither this nor
   * the RPC that triggers it distinguishes direction) rather than waiting
   * on some unrelated future refresh.
   *
   * refreshFamilyRole() already fails closed on its own (sets familyRole
   * to null on any error rather than leaving the OLD, now-possibly-wrong
   * role sitting there looking authoritative — see its own doc comment
   * above). This wraps that with `roleRefreshNotice`, a one-time
   * user-facing flag for exactly that residual case: the role change DID
   * succeed server-side (this function is only ever reached after it did),
   * but this device could not confirm its own new permissions afterwards —
   * familyRole is null (admin-only UI correctly hides itself, same as any
   * other refreshFamilyRole failure) and the person is told to manually
   * refresh, rather than the UI silently trusting either the stale old
   * role or a guessed new one.
   */
  refreshOwnRoleAfterChange: async (changedUserId: string) => {
    const { currentUserId } = get();
    if (changedUserId !== currentUserId) return;
    await get().refreshFamilyRole();
    set({
      roleRefreshNotice:
        get().familyRole === null
          ? 'השינוי בוצע בהצלחה, אך אירעה שגיאה ברענון ההרשאות. אנא רעננו את המסך.'
          : null,
    });
  },

  clearRoleRefreshNotice: () => set({ roleRefreshNotice: null }),

  signIn: async (userId: string) => {
    await get().__signInCore(userId, 'plain');
  },

  signInWithPin: async (userId: string, pin: string) => {
    await get().__signInCore(userId, 'pin', pin);
  },

  // Private (not part of the public AuthState surface an outside caller
  // should reach for — deliberately not listed in the interface above)
  // shared implementation for signIn()/signInWithPin(). Both must perform
  // the exact same post-claim finalize sequence (queue-flush guard, whoami()
  // verification, stale-impersonation cleanup, persisting CURRENT_USER_KEY,
  // clearing impersonatingUserId) — the ONLY difference is which RPC
  // performs the actual claim (claim_family_profile() — self-or-unclaimed
  // only — vs claim_family_profile_with_pin() — family-membership + PIN
  // verified, used to take over a claim already held by another device).
  // Kept as one function (rather than two independent copies) specifically
  // so this finalize sequence can never drift between the two entry points.
  __signInCore: async (userId: string, mode: 'plain' | 'pin', pin?: string) => {
    // IMPORTANT: claimFamilyProfile() is the secure, server-side gate on
    // "can this device actually become this profile" (self-or-unclaimed
    // only — see claim_family_profile() in migrations/0004_*.sql, which
    // rejects a profile already claimed by a different device). This must
    // be allowed to throw: swallowing the error here would let a device
    // "sign in" locally (persist currentUserId) even though the server
    // refused the claim, which defeats that whole protection. Only persist
    // currentUserId — and only update the in-memory store — once the claim
    // has actually succeeded. On failure, currentUserId is left exactly as
    // it was (unchanged, not set), and the caller (LoginScreen) is
    // responsible for surfacing the rejection to the person.
    if (isSupabaseConfigured) {
      // AUDIT-INTEGRITY GUARD (see SyncQueue.hasPendingForOtherUser's doc
      // comment for the full scenario): this device may still have offline
      // writes queued under whichever member was claimed here BEFORE this
      // call — e.g. they marked a walk done while offline, it's sitting in
      // SyncQueue, and connectivity hasn't returned yet. If claimFamilyProfile
      // below succeeded now, a LATER flush of that queued write would reach
      // Supabase under `userId`'s claim, and the audit_walk_change() /
      // audit_schedule_rule_change() / audit_user_profile_change() triggers
      // (migrations/0005_*.sql) resolve the actor from auth.uid()/
      // current_profile_id() at THAT moment — crediting/blaming the WRONG
      // family member for an action they never took. Rather than silently
      // accepting that misattribution (or trusting a client-supplied actor id,
      // which the triggers correctly never do), first try to flush now, while
      // the OLD claim is still active — if the device is online this
      // resolves the whole thing before it can ever become a problem. Only if
      // writes for a different member are still stuck queued afterwards
      // (i.e. still offline) do we refuse the profile switch outright: no
      // amount of client-side bookkeeping can make a client-supplied actor id
      // trustworthy, so blocking is the correct failure mode, not a
      // workaround.
      await repository.trySync?.().catch(() => undefined);
      const blockedByOtherUsersQueue = await repository.hasPendingForOtherUser?.(userId);
      if (blockedByOtherUsersQueue) {
        throw new Error(
          'pending sync from another profile on this device — connect to the internet and try again'
        );
      }
      if (mode === 'pin') {
        await claimFamilyProfileWithPin(userId, pin as string);
      } else {
        await claimFamilyProfile(userId);
      }

      // POST-CLAIM VERIFICATION (security review, round 2 — see the final
      // report's Idan investigation): claim_family_profile() resolving
      // without error only proves the UPDATE it ran affected a row at THAT
      // moment. It is not, by itself, proof that this device's authoritative
      // identity resolves back to `userId` for every subsequent call — the
      // two are normally the same auth.uid() and should always agree, but
      // this device blindly trusting "the RPC didn't throw" and persisting
      // currentUserId regardless is exactly the gap a claim/resolution
      // disagreement (whatever its root cause) would hide behind, and is why
      // a previous sign-out/sign-in cycle could not have self-healed it:
      // nothing ever checked the two actually agreed. whoami() is the same
      // authoritative, server-side lookup every RLS policy and RPC actually
      // uses (real_current_profile_id()), so asking it to confirm
      // real_profile_id === userId right here closes the gap regardless of
      // which underlying mechanism would otherwise have caused it. Failing
      // this check must behave exactly like a rejected claim: the error
      // propagates, currentUserId is never persisted, and the caller
      // (LoginScreen) surfaces it — see claimErrorMessage()'s
      // 'claim could not be verified' branch.
      const verification = await getWhoAmI();
      if (!verification || verification.realProfileId !== userId) {
        throw new Error(
          'claim could not be verified — claim_family_profile succeeded but whoami did not confirm this profile'
        );
      }

      // RESTART-SAFETY, PART 2: restoreSession() ends any stale server-side
      // impersonation session for THIS device on every cold start, but a
      // sign-out followed by a sign-in (no app restart in between) never
      // goes through restoreSession() again. Without this, a lingering
      // active session from before the sign-out would keep
      // current_profile_id() resolving to the OLD impersonated target
      // rather than the profile just claimed above — best-effort, since a
      // failure here does not expose anything unsafe (there is no
      // impersonation banner on LoginScreen to mislead anyone; the next
      // restoreSession() or endImpersonation() call closes it for real).
      await endImpersonationRpc().catch(() => undefined);
    }
    await AsyncStorage.setItem(CURRENT_USER_KEY, userId);
    set({ currentUserId: userId, impersonatingUserId: null });

    // FINAL CORRECTION PASS — THE core fix (persona-vs-authorization bug):
    // admin/member ROLE is now anchored to the CLAIMED PERSONA server-side
    // (users.role — see migrations/0016_*.sql's Part 0), not to this
    // device's permanent family_auth_members row. That means familyRole
    // (this store's single source of truth for every admin-only UI gate —
    // see its own doc comment above) can genuinely be DIFFERENT after this
    // claim than it was before — a device that was admin under its OLD
    // persona may now be a member under the NEWLY claimed one, or vice
    // versa. Without this refresh, familyRole would keep showing the STALE
    // pre-claim value until the next unrelated refreshFamilyRole() call
    // (e.g. an app restart) — precisely the persona-vs-authorization gap
    // this pass exists to close, just moved into the client's own cache
    // instead of the server. Best-effort: refreshFamilyRole() already fails
    // closed into familyRole=null on any error (never leaves a STALE
    // elevated value sitting around), so a failure here is safe, not silent
    // privilege retention.
    await get().refreshFamilyRole();
  },

  signOut: async () => {
    // ORDERING FIX (round 3 security review): an earlier draft checked
    // `get().impersonatingUserId !== null` AFTER the `set({ ...,
    // impersonatingUserId: null })` below — a bug that made the condition
    // unconditionally false (impersonatingUserId had already been cleared
    // to null by the very statement right before the check), so
    // end_impersonation() was NEVER actually attempted by signOut(),
    // contradicting this function's own doc/comment claiming it was
    // best-effort ending the session. Reading it here, BEFORE any local
    // state is touched, is what actually makes the server-side cleanup
    // happen when there is something to clean up.
    //
    // FAIL-SAFE CONTRACT (explicit, per requirement): local sign-out always
    // proceeds regardless of whether this RPC succeeds, fails, or the
    // device is offline — `.catch(() => undefined)` guarantees a network
    // failure here can never block someone from signing out of their own
    // device. This does intentionally leave a POSSIBILITY that the
    // server-side session outlives this local sign-out if the device is
    // offline right now — that is not a safety gap: active_impersonation_
    // target() (0006) is re-validated on every server call regardless of
    // any client state, current_profile_id() only ever resolves to the
    // impersonated member for THIS SAME admin device's own auth.uid()
    // (never for whoever signs in next locally), and restoreSession()
    // unconditionally re-attempts this exact cleanup on the next cold
    // start as the durable backstop — so the worst case is a redundant
    // no-op session sitting in impersonation_sessions until then, never a
    // security exposure or a UI state that misrepresents who mutations are
    // being attributed to.
    const wasImpersonating = isSupabaseConfigured && get().impersonatingUserId !== null;
    if (wasImpersonating) {
      await endImpersonationRpc().catch(() => undefined);
    }

    await AsyncStorage.removeItem(CURRENT_USER_KEY);
    // impersonationStarting included defensively (round-5 race fix): if
    // signOut() is somehow called while a beginImpersonation() call is
    // mid-flight, this guarantees no lingering local state blocks
    // enterTestMode() forever afterwards. The try/finally in
    // beginImpersonation() will still separately reset it to false when its
    // own await settles (a no-op set at that point).
    set({
      currentUserId: null,
      testModeUserId: null,
      impersonatingUserId: null,
      impersonationStarting: false,
    });
    // Deliberately does NOT clear familyId — signing out re-shows "pick
    // your profile" for this device's already-joined family, not the
    // create/join onboarding again.
  },

  enterTestMode: (userId: string) => {
    const { familyRole, currentUserId, impersonatingUserId, impersonationStarting } = get();
    if (familyRole !== 'admin') {
      throw new Error('רק מנהל יכול להיכנס למצב בדיקה');
    }
    if (impersonatingUserId || impersonationStarting) {
      // Mutually exclusive with real impersonation — see beginImpersonation().
      // impersonationStarting (round-5 race fix) is what closes the window
      // where a real impersonation is already in flight (RPC not yet
      // resolved) but impersonatingUserId is still null — without this
      // check, that window used to let enterTestMode() through and end up
      // with both testModeUserId and impersonatingUserId set at once.
      throw new Error('סיימו קודם את מצב הבדיקה האמיתית לפני מעבר למצב בדיקה רגיל');
    }
    if (userId === currentUserId) {
      // Simulating yourself is meaningless and just adds confusing UI state.
      return;
    }
    set({ testModeUserId: userId });
  },

  exitTestMode: () => set({ testModeUserId: null }),

  clearTestModeIfInvalid: (activeUserIds: string[]) => {
    const { testModeUserId } = get();
    if (testModeUserId && !activeUserIds.includes(testModeUserId)) {
      set({ testModeUserId: null });
    }
  },

  clearImpersonationIfInvalid: (activeUserIds: string[]) => {
    // Same ordering principle as the signOut() fix above: read
    // impersonatingUserId and decide whether server cleanup is needed
    // BEFORE clearing local state, not after. Fire-and-forget (not
    // awaited) — this is called synchronously from a roster-reload effect
    // (see HomeScreen.tsx), mirroring clearTestModeIfInvalid()'s own
    // sync signature; the RPC failing here is not a safety concern (see
    // this action's own doc comment) and restoreSession() remains the
    // durable backstop regardless.
    const { impersonatingUserId } = get();
    if (impersonatingUserId && !activeUserIds.includes(impersonatingUserId)) {
      if (isSupabaseConfigured) {
        endImpersonationRpc().catch(() => undefined);
      }
      set({ impersonatingUserId: null });
    }
  },

  beginImpersonation: async (userId: string) => {
    const { familyRole, testModeUserId, impersonatingUserId, impersonationStarting } = get();
    // Client-side check is a UX nicety only (fast, friendly rejection
    // before a round trip) — the SERVER independently re-checks
    // is_real_family_admin() itself in begin_impersonation() and is the
    // actual authorization boundary; see migrations/0006_qa_impersonation.sql.
    if (familyRole !== 'admin') {
      throw new Error('רק מנהל יכול להתחיל בדיקה אמיתית כמשתמש');
    }
    if (testModeUserId) {
      // Mutually exclusive with the UI-simulation Test Mode.
      throw new Error('סיימו קודם את מצב הבדיקה הרגיל לפני התחלת בדיקה אמיתית');
    }
    // DOUBLE-TAP / RE-ENTRANCY GUARD (round-5): reject cleanly rather than
    // firing a second concurrent RPC if a begin is already in flight, or if
    // impersonation is already active (same or different target).
    if (impersonationStarting || impersonatingUserId) {
      throw new Error('כבר מתבצעת התחלה של בדיקה אמיתית — יש להמתין');
    }
    // ROUND-5 RACE FIX: set this synchronously, BEFORE the await below, so
    // enterTestMode() called anytime between now and the RPC settling sees
    // impersonationStarting and rejects — closing the window that used to
    // let both testModeUserId and impersonatingUserId end up set at once.
    // impersonatingUserId itself is deliberately NOT set optimistically
    // here — only after the RPC actually succeeds, below.
    set({ impersonationStarting: true });
    try {
      // Let a rejection (not admin, cross-family, removed, self) propagate —
      // the caller (SettingsScreen) is responsible for surfacing it. The
      // finally block below still resets impersonationStarting in this case.
      await beginImpersonationRpc(userId);

      // DEFENSE IN DEPTH: re-read testModeUserId AFTER the RPC resolves,
      // not the stale value captured before the await. The lock above
      // should make this impossible, but if the invariant were ever
      // violated anyway, fail closed rather than committing an invalid
      // local state — and clean up the now-orphaned server-side session
      // rather than leaving it dangling.
      if (get().testModeUserId) {
        try {
          await endImpersonationRpc();
        } catch (cleanupErr) {
          // eslint-disable-next-line no-console
          console.warn('beginImpersonation: cleanup after conflict failed', cleanupErr);
        }
        throw new Error('אירעה התנגשות בין מצב בדיקה לבדיקה אמיתית, נסו שוב');
      }

      set({ impersonatingUserId: userId });
    } finally {
      set({ impersonationStarting: false });
    }
  },

  endImpersonation: async () => {
    if (get().impersonatingUserId === null) return;
    // MUST await success before clearing local state: "Exiting must
    // reliably restore Admin identity/effective permissions" means the
    // BANNER must never disappear before the server-side session is
    // actually gone — clearing it optimistically (then failing offline)
    // would show "Admin" in the UI while current_profile_id()/
    // is_family_admin() are still server-resolved as the impersonated
    // member for any write this device makes until connectivity returns.
    // Let a failure propagate so the caller (SettingsScreen) can tell the
    // admin to check their connection and try again — the banner staying
    // up in that case is the CORRECT, safe behavior, not a bug.
    await endImpersonationRpc();
    set({ impersonatingUserId: null });
  },

  /**
   * Round 4 — call this immediately after redeemFamilyInvite(token)
   * (src/lib/invites.ts) resolves, passing its result. CORRECTED ORDERING
   * (see the approved Round 4 design report): persists ONLY the non-secret
   * pending marker first, THEN verifies via whoami(), and ONLY on a
   * confirmed match does familyId/currentUserId ever get written — never
   * the reverse. Never calls claimFamilyProfile()/joinFamily()/
   * setFamilyId() — redeem_family_invite() (0008/0009) already performed
   * their equivalent atomically, server-side.
   */
  completeInviteRedemption: async (result: { familyId: string; targetUserId: string }) => {
    const pending: PendingInviteRedemption = { familyId: result.familyId, targetUserId: result.targetUserId };
    await AsyncStorage.setItem(PENDING_REDEMPTION_KEY, JSON.stringify(pending));
    const outcome = await verifyAndCommitPendingRedemption(pending, set, get);
    if (outcome === 'unverified') {
      // Couldn't verify yet (offline/RPC failure) — surface the pending
      // state so the UI can show the dedicated "ממתין לאימות" state with a
      // retry-verification action, per the approved design. The marker
      // itself is already persisted (step 1 above) and untouched by the
      // helper in this outcome.
      set({ pendingInviteRedemption: pending });
    }
    return outcome;
  },

  /**
   * Round 4 — retries ONLY the whoami() verification for an existing
   * pending redemption. Never calls redeemFamilyInvite() or any other
   * lib/invites.ts function — an already-consumed invite token must never
   * be resubmitted (replaying it would correctly, but confusingly, return
   * "invite already used" even though redemption already succeeded).
   */
  retryPendingInviteRedemptionVerification: async () => {
    const rawPending = await AsyncStorage.getItem(PENDING_REDEMPTION_KEY);
    if (!rawPending) return 'none';
    let pending: PendingInviteRedemption;
    try {
      const parsed = JSON.parse(rawPending);
      if (!parsed || typeof parsed.familyId !== 'string' || typeof parsed.targetUserId !== 'string') {
        await AsyncStorage.removeItem(PENDING_REDEMPTION_KEY);
        set({ pendingInviteRedemption: null });
        return 'none';
      }
      pending = { familyId: parsed.familyId, targetUserId: parsed.targetUserId };
    } catch {
      await AsyncStorage.removeItem(PENDING_REDEMPTION_KEY);
      set({ pendingInviteRedemption: null });
      return 'none';
    }
    const outcome = await verifyAndCommitPendingRedemption(pending, set, get);
    if (outcome === 'unverified') {
      set({ pendingInviteRedemption: pending });
    }
    return outcome;
  },
}));

/**
 * The role every MEMBER-FACING permission check in the app should use:
 * 'member' while Admin Test Mode is simulating one (regardless of the real
 * familyRole), the real familyRole otherwise. A single shared selector so
 * every screen (Home, Schedule, Family, Settings) renders a CONSISTENT
 * simulated permission state instead of each screen growing its own
 * `testModeUserId ? 'member' : familyRole` copy — that inconsistency is
 * exactly how the original Home-only wiring ended up with Schedule/Family
 * still showing full Admin controls while Test Mode was active.
 *
 * Do NOT use this for the Test Mode entry/exit controls themselves (the
 * picker that starts a simulation, the "חזור למנהל" banner/button, or the
 * Admin-only activity/audit screens) — those must stay keyed to the REAL
 * `familyRole` so an Admin can always manage/exit a simulation they started.
 *
 * Also returns 'member' while REAL impersonation (impersonatingUserId) is
 * active — the two are mutually exclusive (beginImpersonation()/
 * enterTestMode() each refuse to start while the other is active), so the
 * precedence between them here never actually matters in practice, but
 * impersonation is checked first for clarity. Unlike Test Mode, this is not
 * merely cosmetic during impersonation: is_family_admin() is ALSO
 * server-side suppressed while impersonating (see
 * migrations/0006_qa_impersonation.sql), so this selector and the server's
 * own authorization actually agree during a session, not just during Test
 * Mode's (server-unaware) UI simulation.
 */
export function useEffectiveFamilyRole(): FamilyRole | null {
  return useAuthStore((s) => (s.impersonatingUserId || s.testModeUserId ? 'member' : s.familyRole));
}

/**
 * The user id every MEMBER-FACING rendering/filtering decision should use:
 * the simulated member's id while Admin Test Mode is active, the REAL
 * currentUserId otherwise. A single shared selector for the same reason as
 * useEffectiveFamilyRole above — Home already computed this inline
 * (`testModeUserId ?? currentUserId`) but Family/Settings/the requests
 * inbox each need the identical value, and recreating the expression in
 * every screen is exactly how FamilyScreen ended up showing the REAL
 * admin's row as "self-editable" while simulating a different member.
 *
 * DISPLAY-ONLY WITH RESPECT TO testModeUserId: never pass THAT half of this
 * value to a mutation/RPC argument — every mutating store action already
 * refuses outright while testModeUserId is set (see testModeGuard.ts), and
 * server-side authorization always uses auth.uid()/current_profile_id(),
 * never a client-supplied value, regardless.
 *
 * DIFFERENT for impersonatingUserId: during a REAL impersonation session,
 * this IS the id the server will actually authorize writes as (via
 * current_profile_id(), see migrations/0006_qa_impersonation.sql), so a
 * screen constructing a write while impersonating (e.g. "who completed
 * this walk") should use this value — it will match what the server
 * independently derives. It is still never trusted as authorization by
 * itself; the server re-derives and validates the effective profile from
 * auth.uid() + the session table on every call, exactly as if this value
 * had never been sent.
 */
export function useEffectiveUserId(): string | null {
  return useAuthStore((s) => s.impersonatingUserId ?? s.testModeUserId ?? s.currentUserId);
}

/**
 * "Is the CURRENT VIEWER a real Admin, right now" — round 7, Part 1's exact
 * gate for role-management controls (FamilyScreen's "תפקיד" section). This
 * is deliberately NOT useEffectiveFamilyRole(): that selector reads as
 * 'member' during both Test Mode AND real impersonation, which is correct
 * for ordinary member-facing UI, but role management needs the REAL
 * familyRole (an admin mid-Test-Mode-simulation must still be able to
 * manage roles, exactly like SettingsScreen's "ניהול (מנהל בלבד)" section
 * stays keyed to the real role) while STILL being unavailable during real
 * impersonation specifically — a member being impersonated by the real
 * admin must never see role controls just because the underlying device is
 * admin-owned. A plain `familyRole === 'admin'` check alone would miss that
 * second case, since familyRole itself is never changed by impersonation
 * (only what the SERVER's is_family_admin()/current_profile_id() resolve to
 * is — see migrations/0006_qa_impersonation.sql); this helper is what makes
 * the CLIENT side of that distinction match the server's, so role-
 * management RPC calls that would fail server-side are never even offered.
 *
 * Extracted as a plain, directly-testable function (rather than inlined in
 * FamilyScreen) so this exact security-relevant decision has its own unit
 * tests independent of any component-rendering setup.
 */
export function isRealFamilyAdmin(familyRole: FamilyRole | null, impersonatingUserId: string | null): boolean {
  return familyRole === 'admin' && impersonatingUserId === null;
}
