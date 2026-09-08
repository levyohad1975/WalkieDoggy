import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import type { FamilyLookupResult } from '../types';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

/**
 * True when EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY are set
 * (see .env.example). When false the app runs entirely on the local/demo
 * repository — no network calls are attempted — so it's usable out of the
 * box before anyone sets up a Supabase project.
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

// Both env vars are read from process.env (not hardcoded) as required —
// see .env.example for the keys and README "Configuring Supabase".
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;

/**
 * Every device needs *some* Supabase Auth session for Row Level Security to
 * evaluate at all (see supabase/schema.sql — `current_family_id()` reads
 * `auth.uid()`). Rather than build real sign-up/sign-in for a private
 * household app, each device signs in anonymously once; the session then
 * persists via AsyncStorage like any other Supabase session. This must be
 * called before any repository read/write, and requires "Anonymous Sign-Ins"
 * to be enabled in the Supabase Dashboard (Authentication → Sign In / Providers).
 */
export async function ensureAnonymousSession(): Promise<void> {
  if (!supabase) return;
  const { data } = await supabase.auth.getSession();
  if (data.session) return;
  const { error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
}

/**
 * "Claims" a family member profile for this device by linking the row's
 * auth_user_id to the current (anonymous) auth session — this is what lets
 * the RLS policies resolve `current_family_id()` for this device going
 * forward. Called from authStore.signIn() right after "pick your profile".
 * Safe to call again later (e.g. someone re-picks a profile on a new phone);
 * under migration 0020, the server records a per-device profile session;
 * another device already signed into the same profile is never displaced.
 *
 * This is a SECURITY DEFINER RPC (claim_family_profile, see
 * migrations/0004_*.sql), not a plain `.update()` on `users`. Claiming isn't
 * a "profile edit" — the general users UPDATE policy is scoped to
 * self-or-admin (see current_family_role/is_family_admin), and a device
 * claiming a profile for the first time has no "self" row yet, so it could
 * never satisfy that policy directly. The RPC does exactly one narrow
 * thing — set auth_user_id on an active user in the caller's own family —
 * and nothing else; it cannot be used to edit name/color/photo or to touch
 * removed_at.
 */
export async function claimFamilyProfile(userId: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc('claim_family_profile', { target_user_id: userId });
  if (error) throw error;
}

/**
 * QA/UX round, Part F1 (migrations/0016_*.sql): sets/changes/clears a
 * profile's PIN (used by claimFamilyProfileWithPin below to let another
 * device sign into the same profile without displacing existing devices). Pass `pin: null` to
 * clear an existing PIN. See the RPC's own doc comment for exactly who may
 * call this (the profile's own current device, or a family admin).
 *
 * COMPLETION PASS: now wired — see PinSetupModal.tsx (first-time setup /
 * change, reached from FamilyScreen's member row) and SettingsScreen.tsx.
 */
export async function setProfilePin(userId: string, pin: string | null): Promise<void> {
  if (!supabase) throw new SupabaseNotConfiguredError();
  const { error } = await supabase.rpc('set_profile_pin', { p_user_id: userId, p_pin: pin });
  if (error) throw error;
}

/**
 * QA/UX round, Part F1 (migrations/0016_*.sql): reclaims a profile ALREADY
 * claimed by a different device, verified by PIN — see
 * claim_family_profile_with_pin()'s own doc comment for the exact
 * original 0016 semantics were a transfer; migration 0020 changes this to
 * a simultaneous multi-device session while preserving the RPC signature. Distinct from claimFamilyProfile
 * above, which is unchanged and still refuses outright when the profile is
 * claimed by someone else.
 *
 * COMPLETION PASS: now wired — see authStore.signInWithPin() (calls this,
 * then reuses signIn()'s exact post-claim finalize sequence) and
 * PinEntryModal.tsx (the UI that collects the PIN and calls it).
 *
 * FINAL HARDENING PASS: the RPC's return shape changed from `void` to a
 * structured `jsonb` result for its two "expected, must-survive-the-
 * rejection" failure paths — wrong PIN and an active brute-force cooldown —
 * instead of raising for them directly. See claim_family_profile_with_pin()
 * in migrations/0016_*.sql for exactly why (in short: raising an exception
 * there would roll back the SAME transaction's PIN-attempt-counter write,
 * making server-side rate limiting a complete no-op). Every OTHER failure
 * (not authenticated, target not found, cross-family, removed profile, no
 * PIN configured) still comes back as a normal Postgres `error` and is
 * still handled by `if (error) throw error;` below, completely unchanged.
 * This function's own OBSERVABLE contract to every existing caller is
 * unchanged for the wrong-PIN case (still throws with 'incorrect PIN'
 * somewhere in the message) and adds one new, distinct rejection for the
 * cooldown case.
 */
export async function claimFamilyProfileWithPin(userId: string, pin: string): Promise<void> {
  if (!supabase) throw new SupabaseNotConfiguredError();
  const { data, error } = await supabase.rpc('claim_family_profile_with_pin', {
    p_target_user_id: userId,
    p_pin: pin,
  });
  if (error) throw error;

  const result = data as { success?: boolean; reason?: string } | null;
  if (result && result.success === false) {
    if (result.reason === 'cooldown') {
      // Distinct from 'incorrect PIN' — see errorMessages.ts's own rule for
      // this exact text (added this pass) and the RPC's own doc comment for
      // why this case must never leak whether the PIN presented would
      // otherwise have been correct.
      throw new Error('too many incorrect PIN attempts — try again in a few minutes');
    }
    // reason === 'wrong_pin' (the only other defined value). Preserves the
    // exact distinct text this RPC used to raise directly for a wrong PIN,
    // so every existing caller/test/error-mapping rule built on that text —
    // including the shared friendlyErrorMessage() rule for 'incorrect PIN'
    // — is unaffected by this pass's return-shape change.
    throw new Error('incorrect PIN');
  }
}

/**
 * Multi-device family membership (see supabase/migrations/0002_*.sql):
 * a device becomes a member of a family — before it has picked which
 * specific family member it is — either by creating one or by joining an
 * existing one with a short invite code. All four calls below are thin
 * wrappers over SECURITY DEFINER Postgres functions; the actual
 * authorization logic lives in the migration, not here.
 */

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super('Supabase is not configured — this call only works in backend mode');
  }
}

/**
 * Resolves an invite code to a family's id/name/dog-name — and NOTHING
 * else — without requiring the caller to already be a member of that
 * family. This is deliberately the only invite-code lookup exposed: it
 * cannot be used to browse/enumerate families (no other filter), and it
 * never returns member/schedule/walk data (see find_family_by_invite_code()
 * in the migration for the server-side guarantee this relies on).
 */
export async function findFamilyByInviteCode(code: string): Promise<FamilyLookupResult | null> {
  if (!supabase) throw new SupabaseNotConfiguredError();
  const { data, error } = await supabase.rpc('find_family_by_invite_code', { code });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return { id: row.id, name: row.name, dogName: row.dog_name ?? undefined };
}

/**
 * Joins the calling device to an existing family by invite code. Never
 * creates a `users` row — picking *which* family member this device is
 * happens afterward on the existing "pick your profile" screen via
 * claimFamilyProfile(), unchanged.
 */
export async function joinFamily(code: string): Promise<{ id: string; name: string }> {
  if (!supabase) throw new SupabaseNotConfiguredError();
  const { data, error } = await supabase.rpc('join_family', { code });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('לא נמצאה משפחה עם הקוד הזה');
  return { id: row.id, name: row.name };
}

/**
 * Creates a brand-new family (with a fresh random invite code) and makes
 * this device a member of it. `dogName` is optional — a real new family
 * must never be forced into "טופי" (that default only applies to
 * local/demo mode's seed data); omit it to create the family with no dog
 * yet and add one later from Settings.
 */
export async function createFamily(
  familyName: string,
  dogName?: string
): Promise<{ id: string; name: string; inviteCode: string }> {
  if (!supabase) throw new SupabaseNotConfiguredError();
  const { data, error } = await supabase.rpc('create_family', {
    family_name: familyName,
    dog_name: dogName ?? null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('יצירת המשפחה נכשלה');
  return { id: row.id, name: row.name, inviteCode: row.invite_code };
}

/**
 * FINAL CORRECTION PASS — Deliverable 2 (QA sandbox, now genuinely
 * REVERSIBLE). Calls enter_qa_sandbox() (migrations/0016_*.sql), which
 * SNAPSHOTS this device's current real family_auth_members state (family,
 * role, claimed persona) before switching, so exitQaSandbox() below can
 * restore it automatically — no invite code, no manual DB edit. Replaces
 * the prior pass's createQaFamily(), which had no way back except rejoining
 * via invite code — see the migration's own Part 2 doc comment for the full
 * mechanism.
 */
export async function enterQaSandbox(
  familyName: string
): Promise<{ id: string; name: string; inviteCode: string }> {
  if (!supabase) throw new SupabaseNotConfiguredError();
  const { data, error } = await supabase.rpc('enter_qa_sandbox', { p_family_name: familyName });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('כניסה לסביבת ה-QA נכשלה');
  return { id: row.id, name: row.name, inviteCode: row.invite_code };
}

/**
 * FINAL CORRECTION PASS — Deliverable 2. Calls exit_qa_sandbox(), which
 * restores this device's real family_auth_members row (and re-claims
 * whichever persona it had before entering QA, best-effort) from the
 * snapshot enterQaSandbox() saved, then deletes the snapshot. Throws with a
 * distinct server message if this device isn't currently in a QA family, or
 * has no snapshot to restore (see the RPC's own doc comment).
 */
export async function exitQaSandbox(): Promise<{ id: string; name: string }> {
  if (!supabase) throw new SupabaseNotConfiguredError();
  const { data, error } = await supabase.rpc('exit_qa_sandbox');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('יציאה מסביבת ה-QA נכשלה');
  return { id: row.id, name: row.name };
}

/**
 * FINAL CORRECTION PASS — Deliverable 2. Reads current_family_is_qa()
 * (migrations/0016_*.sql) — used to render an obvious "you are in a QA
 * sandbox" indicator and to gate QA-only UI actions. Server-side is still
 * the real authority (qa_reset_data()/qa_reset_full() re-check is_qa
 * themselves) — this is UI-scoping only, never trusted as a security check.
 */
export async function getCurrentFamilyIsQa(): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('current_family_is_qa');
  if (error) throw error;
  return data === true;
}

/**
 * FINAL CORRECTION PASS — Deliverable 2. "איפוס נתוני QA": calls
 * qa_reset_data() — resets operational data (walks/schedule/requests/audit)
 * while KEEPING the QA family's dog and members/personas intact, for
 * retesting normal operation without redoing onboarding.
 */
export async function qaResetData(familyId: string): Promise<void> {
  if (!supabase) throw new SupabaseNotConfiguredError();
  const { error } = await supabase.rpc('qa_reset_data', { p_family_id: familyId, p_confirm: 'RESET' });
  if (error) throw error;
}

/**
 * FINAL CORRECTION PASS — Deliverable 2. "התחל סביבת QA חדשה": calls
 * qa_reset_full() — everything qaResetData() does PLUS deletes the dog and
 * every member/persona, a genuine blank slate identical to the state right
 * after enterQaSandbox() itself, so the app's existing onboarding flow can
 * be exercised again from true zero.
 */
export async function qaResetFull(familyId: string): Promise<void> {
  if (!supabase) throw new SupabaseNotConfiguredError();
  const { error } = await supabase.rpc('qa_reset_full', { p_family_id: familyId, p_confirm: 'RESET' });
  if (error) throw error;
}

/**
 * Rotates a family's invite code. Only a device that is already a member of
 * that family can do this (enforced server-side, not just by this check).
 * Devices that already joined stay members — only the code changes, so it
 * stops working for new joins.
 */
export type FamilyRole = 'admin' | 'member';

export async function getCurrentFamilyRole(): Promise<FamilyRole | null> {
  if (!supabase) return null;

  const { data, error } = await supabase.rpc('current_family_role');

  if (error) throw error;

  if (data === 'admin' || data === 'member') {
    return data;
  }

  return null;
}
export async function regenerateInviteCode(familyId: string): Promise<string> {
  if (!supabase) throw new SupabaseNotConfiguredError();
  const { data, error } = await supabase.rpc('regenerate_invite_code', { target_family_id: familyId });
  if (error) throw error;
  return data as string;
}

/**
 * One lightweight round trip combining everything authStore needs to (a)
 * detect a stale/orphaned local claim on restore (see the Idan
 * investigation in the final report) and (b) confirm/refresh impersonation
 * state after a foreground transition — see whoami() in
 * migrations/0006_qa_impersonation.sql. Returns null in local/demo mode or
 * if the call fails (offline, etc.) — callers must treat that as "unknown,
 * don't act on it" rather than "confirmed mismatch".
 */
export interface WhoAmI {
  profileId: string | null;
  realProfileId: string | null;
  familyRole: FamilyRole | null;
  isImpersonating: boolean;
  impersonatedUserId: string | null;
}

export async function getWhoAmI(): Promise<WhoAmI | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('whoami');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    profileId: row.profile_id ?? null,
    realProfileId: row.real_profile_id ?? null,
    familyRole: row.family_role === 'admin' || row.family_role === 'member' ? row.family_role : null,
    isImpersonating: Boolean(row.is_impersonating),
    impersonatedUserId: row.impersonated_user_id ?? null,
  };
}

/**
 * REAL ADMIN QA / IMPERSONATION MODE — see migrations/0006_qa_impersonation.sql
 * for the full server-side design. Only a real family admin may begin one
 * (server-checked via is_real_family_admin(), not trusted from the
 * client), and only for an active member of the caller's own family
 * (also server-checked) — this wrapper does no authorization itself, it
 * just forwards to the RPC and lets a rejection propagate as an error.
 */
export async function beginImpersonation(targetUserId: string): Promise<string> {
  if (!supabase) throw new SupabaseNotConfiguredError();
  const { data, error } = await supabase.rpc('begin_impersonation', { p_target_user_id: targetUserId });
  if (error) throw error;
  return data as string;
}

/**
 * Safe to call even when nothing is active (see end_impersonation()'s own
 * doc comment) — authStore.restoreSession() calls this unconditionally,
 * best-effort, on every cold start specifically so an app restart can never
 * leave a stale server-side session active while the client's own
 * (never-persisted) impersonation state has already reset to "not
 * impersonating".
 */
export async function endImpersonation(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc('end_impersonation');
  if (error) throw error;
}
