import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Switch, View } from 'react-native';
import { RtlText } from './RtlText';
import { colors } from '../theme/colors';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { ConfirmModal } from './ConfirmModal';
import { InviteShareModal } from './InviteShareModal';
import { PinSetupModal } from './PinSetupModal';
import { setMemberRole, type FamilyRole } from '../lib/family';
import { createFamilyInvite, type CreatedFamilyInvite, type FamilyInviteListItem } from '../lib/invites';
import { isSupabaseConfigured, setProfilePin } from '../lib/supabase';
import { friendlyErrorMessage } from '../lib/errorMessages';
import { describePresence } from '../logic/presence';
import { createInviteButtonLabel, inviteStatusLabel } from '../logic/familyInvites';
import { resolveEffectivePermission, type MemberPermissionOverride, type PermissionKey } from '../logic/permissions';
import type { FamilyUser } from '../types';

/** BATCH 3 (Task 3) — the two currently customizable permissions, in display order, with their Hebrew labels. Must match migration 0023's CHECK constraint / logic/permissions.ts's PERMISSION_KEYS. */
const PERMISSION_ROWS: { key: PermissionKey; label: string }[] = [
  { key: 'view_history', label: 'היסטוריה' },
  { key: 'view_statistics', label: 'סטטיסטיקה' },
];

// Matches requestsStore.ts's own DEMO_MODE_MESSAGE convention (a dedicated,
// clear Hebrew message set BEFORE attempting the call) rather than relying
// only on createFamilyInvite()'s thrown SupabaseNotConfiguredError falling
// through friendlyErrorMessage()'s generic fallback. In practice this is
// unreachable through the UI — inviteEligible is already false in local/demo
// mode (see FamilyScreen's activityLoaded wiring / logic/familyInvites.ts's
// doc comment) — kept as defense-in-depth, same as
// SettingsScreen.confirmRegenerateInviteCode's own guardTestModeMutation()
// belt-and-suspenders check.
const INVITE_DEMO_MODE_MESSAGE = 'הזמנות להצטרפות זמינות רק כשהאפליקציה מחוברת ל-Supabase (לא במצב הדגמה מקומי).';

interface MemberDetailsModalProps {
  visible: boolean;
  user: FamilyUser | null;
  /**
   * This member's role, or null when it isn't known to the current viewer.
   * Only ever populated from admin_list_family_activity() (Admin-only, see
   * FamilyScreen.tsx's doc comment) or, for the viewer's OWN row, their own
   * authStore.familyRole — never guessed/defaulted, since a non-admin
   * viewer genuinely has no way to know another member's role under this
   * app's RLS (family_auth_members is self-select-only).
   */
  role: FamilyRole | null;
  /** Raw last_seen_at from admin_list_family_activity(), or undefined when presence data isn't available to this viewer at all (see role's doc comment — same Admin-only source). */
  lastSeenAt?: string | null;
  /**
   * True only for the REAL admin, outside any impersonation session — see
   * FamilyScreen.tsx's isRealAdmin. Gates the entire "תפקיד" management
   * section: a normal member, and an impersonated member even though the
   * real admin is impersonating them, must never see role-management
   * controls (Part 1's requirement).
   */
  canManageRoles: boolean;
  /** True when this member is currently the family's only active admin — used only to disable the "make member" option as a UX nicety; the server (set_member_role()) is the actual last-admin boundary regardless. */
  isLastAdmin: boolean;
  /**
   * Round 3: whether the invite-creation affordance should be offered for
   * THIS member right now — precomputed by FamilyScreen via
   * logic/familyInvites.ts's isMemberInviteEligible() (real admin, active,
   * unclaimed, and admin_list_family_activity() has actually loaded — see
   * that function's own doc comment for why each condition matters,
   * especially never guessing "unclaimed" from data that hasn't loaded).
   */
  inviteEligible: boolean;
  /**
   * The most recent invite for this member from list_family_invites()
   * (metadata only — never a raw token or token_hash, see lib/invites.ts),
   * or null if none exists yet. Used only for the status label and the
   * create-vs-regenerate button wording; never treated as containing
   * anything recoverable.
   */
  existingInvite: FamilyInviteListItem | null;
  /** Called after an invite is created or revoked, so the caller can refresh list_family_invites() metadata. */
  onInviteListChanged: () => void;
  onClose: () => void;
  /**
   * Called after a role change actually succeeds server-side (setMemberRole
   * resolved without throwing), with the id of the member whose role just
   * changed, so the caller can reload the authoritative role/activity list
   * AND — when that id is the current device's own real signed-in user —
   * refresh authStore's familyRole (see FamilyScreen's wiring and
   * authStore.refreshOwnRoleAfterChange's doc comment; round 7, Part 2).
   * Awaited here so `saving` stays true (and the confirm dialog's spinner
   * keeps showing) until that follow-up refresh has actually settled, and
   * so a failure surfaces through the same catch/friendly-error path below
   * rather than looking like it silently completed.
   */
  onRoleChanged: (userId: string) => void | Promise<void>;
  /**
   * COMPLETION PASS — 7C. True when this member IS the current device's own
   * signed-in profile. Gates the "קוד PIN" section together with
   * canManageRoles below (self, or admin-for-a-non-admin-member — mirrors
   * set_profile_pin()'s own server-side authorization; see migrations/
   * 0016_*.sql). The RPC is the real authority — this flag only decides
   * whether the button is worth showing at all, never a security boundary
   * by itself.
   */
  isOwnProfile: boolean;
  /**
   * BATCH 3 (Task 3): every override row the current viewer can see
   * (familyStore.permissionOverrides — 0023's RLS already scopes this to a
   * real admin's whole-family view). Used only to compute THIS member's own
   * effective view_history/view_statistics state and whether an explicit
   * override already exists for them (vs. "using the role default") — see
   * logic/permissions.ts's resolveEffectivePermission().
   */
  permissionOverrides: MemberPermissionOverride[];
  /** Family-Admin-only, enforced server-side (set_member_permission_override, 0023) — never trust canManageRoles alone as the security boundary. */
  onSetPermissionOverride: (userId: string, permissionKey: PermissionKey, allowed: boolean) => Promise<void>;
  /** Family-Admin-only, enforced server-side (clear_member_permission_override, 0023) — reverts to the role default. */
  onClearPermissionOverride: (userId: string, permissionKey: PermissionKey) => Promise<void>;
}

/**
 * Member details — Part 1A. Deliberately does NOT add a role-edit control to
 * every row in FamilyScreen's list; this modal is the only place a role can
 * be changed, opened by tapping a member's row.
 */
export function MemberDetailsModal({
  visible,
  user,
  role,
  lastSeenAt,
  canManageRoles,
  isLastAdmin,
  inviteEligible,
  existingInvite,
  onInviteListChanged,
  onClose,
  onRoleChanged,
  isOwnProfile,
  permissionOverrides,
  onSetPermissionOverride,
  onClearPermissionOverride,
}: MemberDetailsModalProps) {
  const [pendingRole, setPendingRole] = useState<FamilyRole | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // BATCH 3 (Task 3): which permission row is mid-save/clear right now, if
  // any — disables just that row's Switch/reset link rather than the whole
  // sheet, and its own inline error line (separate from the role section's
  // `error` above, so a permission-save failure never gets hidden behind an
  // unrelated role-change error or vice versa).
  const [permissionSavingKey, setPermissionSavingKey] = useState<PermissionKey | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  // COMPLETION PASS — 7C: first-time PIN setup / change. Whether an admin
  // targeting an admin's own profile would even reach this button is
  // already impossible — canManageRoles/isOwnProfile below never both cover
  // "another admin's profile" — but set_profile_pin() itself is still the
  // real, final authority (see its doc comment in migrations/0016_*.sql).
  const [pinModalVisible, setPinModalVisible] = useState(false);

  // ROUND 3: the just-created invite, RAW TOKEN INCLUDED, held ONLY in this
  // component's own in-memory state — never AsyncStorage, the Zustand
  // store, LocalRepository, or SyncQueue (see lib/invites.ts's/
  // InviteShareModal's own doc comments). Closing InviteShareModal
  // (handleInviteModalClose below) sets this back to null, which both
  // unmounts/hides that modal AND drops the only reference to the raw
  // token this screen ever held — after that it is intentionally
  // unrecoverable; regenerating is the only way to get a new one.
  const [createdInvite, setCreatedInvite] = useState<CreatedFamilyInvite | null>(null);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Reset transient state whenever a different member's details are opened
  // (or the modal is closed/reopened) — never carry a stale confirm dialog
  // or error message from the previously-viewed member into this one.
  useEffect(() => {
    setPendingRole(null);
    setSaving(false);
    setError(null);
    setCreatedInvite(null);
    setCreatingInvite(false);
    setInviteError(null);
    setPinModalVisible(false);
    setPermissionSavingKey(null);
    setPermissionError(null);
  }, [visible, user?.id]);

  if (!user) return null;

  const roleLabel = role === 'admin' ? 'מנהל' : role === 'member' ? 'בן משפחה' : null;

  const confirmCopy =
    pendingRole === 'admin'
      ? {
          title: 'הפיכת בן המשפחה למנהל',
          message: `${user.name} יקבל הרשאות ניהול למשפחה, כולל ניהול בני משפחה ואישור בקשות.`,
          confirmLabel: 'הפוך למנהל',
        }
      : {
          title: 'הסרת הרשאת ניהול',
          message: `${user.name} יאבד/תאבד הרשאות ניהול ויהפוך/תהפוך לבן/בת משפחה רגיל/ה.`,
          confirmLabel: 'הפוך לבן משפחה',
        };

  async function applyRoleChange() {
    if (!user || !pendingRole) return;
    setSaving(true);
    setError(null);
    try {
      // Server-authoritative — see lib/family.ts's setMemberRole() doc
      // comment: never applied optimistically. Only on success do we ask
      // the caller to reload the real server-confirmed role (onRoleChanged
      // below); on failure the `role` prop this modal was given is left
      // completely untouched, so the displayed role can never silently
      // drift from what the server actually has.
      await setMemberRole(user.id, pendingRole);
      setPendingRole(null);
      // Awaited (round 7, Part 2): when this changed the CURRENT device's
      // own role, the caller's onRoleChanged also awaits a fresh
      // authStore.refreshFamilyRole() read before this resolves — see this
      // prop's doc comment above and authStore.refreshOwnRoleAfterChange's.
      // That follow-up step never throws (it fails closed into
      // authStore.roleRefreshNotice/familyRole itself, surfaced as its own
      // screen-level banner by FamilyScreen — see FamilyScreen.tsx) — the
      // role change this modal is responsible for has already fully
      // succeeded by this point regardless of how that follow-up read goes.
      await onRoleChanged(user.id);
    } catch (e) {
      // Dismiss the confirm dialog back to the details sheet on failure too
      // — otherwise the error text below (in the "תפקיד" section) would sit
      // hidden behind the still-open confirm dialog where the admin can't
      // actually see it.
      setPendingRole(null);
      setError(friendlyErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateInvite() {
    if (!user) return;
    if (!isSupabaseConfigured) {
      setInviteError(INVITE_DEMO_MODE_MESSAGE);
      return;
    }
    setCreatingInvite(true);
    setInviteError(null);
    try {
      // Server-authoritative (0008's create_family_invite) — see
      // lib/invites.ts's own doc comment. Regenerating for a member with an
      // existing pending invite is the SAME call; the server transparently
      // supersedes/revokes the old one (logic/familyInvites.ts's
      // shouldOfferRegenerate is wording-only, not a different code path).
      const created = await createFamilyInvite(user.id);
      setCreatedInvite(created);
      onInviteListChanged();
    } catch (e) {
      setInviteError(friendlyErrorMessage(e));
    } finally {
      setCreatingInvite(false);
    }
  }

  // Closes ONLY the InviteShareModal layered on top of this one (this modal
  // itself, `visible`, is unaffected) — dropping this component's only
  // reference to the raw token. See createdInvite's own doc comment above.
  function handleInviteModalClose() {
    setCreatedInvite(null);
  }

  function handleInviteRevoked() {
    setCreatedInvite(null);
    onInviteListChanged();
  }

  async function handleTogglePermission(permissionKey: PermissionKey, allowed: boolean) {
    if (!user) return;
    setPermissionSavingKey(permissionKey);
    setPermissionError(null);
    try {
      await onSetPermissionOverride(user.id, permissionKey, allowed);
    } catch (e) {
      setPermissionError(friendlyErrorMessage(e));
    } finally {
      setPermissionSavingKey(null);
    }
  }

  async function handleResetPermission(permissionKey: PermissionKey) {
    if (!user) return;
    setPermissionSavingKey(permissionKey);
    setPermissionError(null);
    try {
      await onClearPermissionOverride(user.id, permissionKey);
    } catch (e) {
      setPermissionError(friendlyErrorMessage(e));
    } finally {
      setPermissionSavingKey(null);
    }
  }

  const presence = describePresence(lastSeenAt ?? null);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={`סגירת פרטי ${user.name}`}
      >
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Avatar emoji={user.avatar} color={user.color} photoUrl={user.photoUrl} size={72} />
            <RtlText style={styles.name}>{user.name}</RtlText>
            {roleLabel ? <RtlText style={styles.roleBadge}>{roleLabel}</RtlText> : null}
            {presence.label ? (
              <RtlText style={styles.presenceText}>
                {presence.active ? '🟢 ' : ''}
                {presence.label}
              </RtlText>
            ) : null}
          </View>

          {canManageRoles && role && !user.removedAt ? (
            <View style={styles.roleSection}>
              <RtlText style={styles.sectionTitle}>תפקיד</RtlText>
              <View style={styles.roleOptions}>
                <Pressable
                  onPress={() => {
                    if (role !== 'member') {
                      setError(null);
                      setPendingRole('member');
                    }
                  }}
                  disabled={role === 'admin' && isLastAdmin}
                  style={[
                    styles.roleOption,
                    role === 'member' && styles.roleOptionActive,
                    role === 'admin' && isLastAdmin && styles.roleOptionDisabled,
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: role === 'member' }}
                >
                  <RtlText style={[styles.roleOptionText, role === 'member' && styles.roleOptionTextActive]}>
                    בן משפחה
                  </RtlText>
                </Pressable>
                <Pressable
                  onPress={() => {
                    if (role !== 'admin') {
                      setError(null);
                      setPendingRole('admin');
                    }
                  }}
                  style={[styles.roleOption, role === 'admin' && styles.roleOptionActive]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: role === 'admin' }}
                >
                  <RtlText style={[styles.roleOptionText, role === 'admin' && styles.roleOptionTextActive]}>מנהל</RtlText>
                </Pressable>
              </View>
              {role === 'admin' && isLastAdmin ? (
                <RtlText style={styles.hint}>לא ניתן להסיר הרשאת מנהל מהמנהל האחרון במשפחה.</RtlText>
              ) : null}
              {error ? <RtlText style={styles.error}>{error}</RtlText> : null}
            </View>
          ) : null}

          {/*
            BATCH 3 (Task 3) — per-member permission overrides. Same
            visibility gate as the role section above (real admin, active
            member): "Family Admin can set/clear the supported override
            values ... Regular members cannot change family permissions."
            The RPCs (0023) are the actual security boundary — this gate
            only decides whether the controls are worth rendering at all.
          */}
          {canManageRoles && !user.removedAt ? (
            <View style={styles.roleSection}>
              <RtlText style={styles.sectionTitle}>הרשאות</RtlText>
              {PERMISSION_ROWS.map(({ key, label }) => {
                const override = permissionOverrides.find((o) => o.userId === user.id && o.permissionKey === key);
                const effective = resolveEffectivePermission(key, user.id, permissionOverrides);
                const rowBusy = permissionSavingKey === key;
                return (
                  <View key={key} style={styles.permissionRow}>
                    <View style={styles.permissionLabelWrap}>
                      <RtlText style={styles.permissionLabel}>{label}</RtlText>
                      <RtlText style={styles.hint}>
                        {override
                          ? override.allowed
                            ? 'הותאם אישית: מותר'
                            : 'הותאם אישית: חסום'
                          : 'לפי ברירת המחדל של התפקיד (מותר)'}
                      </RtlText>
                    </View>
                    <Switch
                      value={effective}
                      disabled={rowBusy}
                      onValueChange={(v) => handleTogglePermission(key, v)}
                      accessibilityLabel={`הרשאת ${label} עבור ${user.name}`}
                    />
                    {override ? (
                      <Pressable
                        disabled={rowBusy}
                        onPress={() => handleResetPermission(key)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`איפוס הרשאת ${label} עבור ${user.name}`}
                      >
                        <RtlText style={[styles.resetLink, rowBusy && styles.resetLinkDisabled]}>איפוס</RtlText>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
              {permissionError ? <RtlText style={styles.error}>{permissionError}</RtlText> : null}
            </View>
          ) : null}

          {inviteEligible ? (
            <View style={styles.inviteSection}>
              <RtlText style={styles.sectionTitle}>הזמנה להצטרפות</RtlText>
              <RtlText style={styles.hint}>
                {existingInvite
                  ? `יש כרגע הזמנה (${inviteStatusLabel(existingInvite.status)}) עבור בן/בת המשפחה הזה/זו.`
                  : 'עדיין אין הזמנה עבור בן/בת המשפחה הזה/זו.'}
              </RtlText>
              <Button
                label={creatingInvite ? 'יוצר הזמנה...' : createInviteButtonLabel(existingInvite)}
                variant="secondary"
                loading={creatingInvite}
                disabled={creatingInvite}
                onPress={handleCreateInvite}
              />
              {inviteError ? <RtlText style={styles.error}>{inviteError}</RtlText> : null}
            </View>
          ) : null}

          {(isOwnProfile || (canManageRoles && role !== 'admin')) && !user.removedAt ? (
            <View style={styles.inviteSection}>
              <RtlText style={styles.sectionTitle}>קוד PIN</RtlText>
              <RtlText style={styles.hint}>
                קוד ה-PIN מאפשר להעביר את הפרופיל הזה למכשיר אחר בביטחון.
              </RtlText>
              <Button
                label="הגדרת / שינוי קוד PIN"
                variant="secondary"
                onPress={() => setPinModalVisible(true)}
              />
            </View>
          ) : null}

          <Button label="סגור" variant="secondary" onPress={onClose} style={styles.closeButton} />
        </Pressable>
      </Pressable>

      <ConfirmModal
        visible={pendingRole !== null}
        title={confirmCopy.title}
        message={confirmCopy.message}
        confirmLabel={confirmCopy.confirmLabel}
        cancelLabel="ביטול"
        loading={saving}
        onConfirm={applyRoleChange}
        onCancel={() => {
          if (saving) return;
          setPendingRole(null);
        }}
      />

      <InviteShareModal
        visible={createdInvite !== null}
        targetName={user.name}
        invite={createdInvite}
        onRevoked={handleInviteRevoked}
        onClose={handleInviteModalClose}
      />

      <PinSetupModal
        visible={pinModalVisible}
        userName={user.name}
        onSave={async (pin) => {
          try {
            await setProfilePin(user.id, pin);
            setPinModalVisible(false);
          } catch (e) {
            // Re-throw as a friendly Hebrew message — PinSetupModal displays
            // whatever Error.message it catches directly inline, so
            // translate here rather than making it know about errorMessages.ts.
            throw new Error(friendlyErrorMessage(e));
          }
        }}
        onClose={() => setPinModalVisible(false)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  header: { alignItems: 'center', gap: 6, marginBottom: 16 },
  name: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, marginTop: 8 },
  roleBadge: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primaryDark,
    backgroundColor: colors.statusCurrentBg,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  presenceText: { fontSize: 13, color: colors.textSecondary },
  roleSection: { gap: 8, marginBottom: 12 },
  inviteSection: { gap: 8, marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, textAlign: 'right' },
  roleOptions: { flexDirection: 'row', gap: 10 },
  roleOption: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  roleOptionActive: { borderColor: colors.primary, backgroundColor: colors.statusCurrentBg },
  roleOptionDisabled: { opacity: 0.5 },
  roleOptionText: { fontSize: 15, fontWeight: '700', color: colors.textSecondary },
  roleOptionTextActive: { color: colors.primaryDark },
  hint: { fontSize: 12, color: colors.textSecondary, textAlign: 'right' },
  error: { fontSize: 13, color: colors.statusOverdue, textAlign: 'right' },
  closeButton: { marginTop: 4 },
  permissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  permissionLabelWrap: { flex: 1, gap: 2 },
  permissionLabel: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, textAlign: 'right' },
  resetLink: { fontSize: 12, fontWeight: '700', color: colors.primaryDark },
  resetLinkDisabled: { opacity: 0.5 },
});
