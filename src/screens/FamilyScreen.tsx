import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { RtlText } from '../components/RtlText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFamilyStore } from '../store/familyStore';
import { isRealFamilyAdmin, useAuthStore, useEffectiveFamilyRole, useEffectiveUserId } from '../store/authStore';
import { colors } from '../theme/colors';
import { breakpoints } from '../theme/tokens';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { UserFormModal } from '../components/UserFormModal';
import { DeleteUserModal } from '../components/DeleteUserModal';
import { MemberDetailsModal } from '../components/MemberDetailsModal';
import { DEMO_FAMILY } from '../data/demoData';
import { isSupabaseConfigured } from '../lib/supabase';
import { adminListFamilyActivity, touchLastSeen, type FamilyActivityRow } from '../lib/requests';
import { listFamilyInvites, type FamilyInviteListItem } from '../lib/invites';
import { describePresence, describePresenceCompact } from '../logic/presence';
import {
  handleLastAdminGuardedPress,
  isLastActiveAdminMember,
  shouldReloadActivityAfterRoleChange,
} from '../logic/familyManagement';
import { isMemberInviteEligible, latestInviteByTarget } from '../logic/familyInvites';
import type { FamilyUser, UserDeletionImpact } from '../types';

export function FamilyScreen() {
  const {
    users,
    dog,
    load,
    addUser,
    updateUser,
    getUserDeletionImpact,
    deleteUser,
    actionError,
    clearActionError,
    permissionOverrides,
    setPermissionOverride,
    clearPermissionOverride,
  } = useFamilyStore();
  const familyId = useAuthStore((s) => s.familyId) ?? DEMO_FAMILY.id;
  // Single source of truth for admin/member permissions — see authStore.
  // Effective, not raw: 'member' while Admin Test Mode is simulating one, so
  // this screen's admin-only add/delete/edit-others controls are hidden
  // consistently with Home's, rather than still showing full Admin controls
  // during a simulation.
  const familyRole = useEffectiveFamilyRole();
  // Effective, not raw, for the SAME reason: the self-edit ✏️ affordance
  // below must belong to whichever member is being viewed as "self" — the
  // simulated member while Test Mode is active, the real signed-in user
  // otherwise — not the real Admin's own row regardless of simulation
  // (that was the bug: familyRole flipped to 'member' but currentUserId
  // stayed the real Admin's id, so the Admin's own row looked self-editable
  // instead of the simulated member's). Display-only — updateUser() itself
  // still refuses any write while Test Mode is active either way.
  const effectiveUserId = useEffectiveUserId();
  // REAL role/identity + impersonation state (deliberately NOT the
  // effective/simulated ones) — Part 1's "current viewer is a real Admin"
  // check. Mirrors SettingsScreen's own "ניהול (מנהל בלבד)" section, which
  // keys off the same real familyRole so an admin can always manage things
  // even mid-simulation — but role MANAGEMENT specifically must also be
  // unavailable while impersonating (impersonatingUserId !== null): a
  // member being impersonated by the real admin must never see role
  // controls just because the underlying device is admin-owned. Test Mode
  // (testModeUserId) does not need a separate check here — it already
  // forces useEffectiveFamilyRole() to 'member' everywhere else in this
  // screen, but role management is gated on the REAL role/impersonation
  // pair on purpose, matching the requirement's exact wording.
  const realFamilyRole = useAuthStore((s) => s.familyRole);
  const realCurrentUserId = useAuthStore((s) => s.currentUserId);
  const impersonatingUserId = useAuthStore((s) => s.impersonatingUserId);
  const isRealAdmin = isRealFamilyAdmin(realFamilyRole, impersonatingUserId);

  const [formVisible, setFormVisible] = useState(false);
  const [editingUser, setEditingUser] = useState<FamilyUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FamilyUser | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<UserDeletionImpact | null>(null);
  const [detailsTarget, setDetailsTarget] = useState<FamilyUser | null>(null);

  // Role + presence (Parts 1F / 2) — sourced ENTIRELY from
  // admin_list_family_activity() (migrations/0005_*.sql), the same
  // Admin-only RPC AdminActivityModal already uses. Deliberately not
  // fetched (and so not shown) for a non-admin viewer: family_auth_members'
  // RLS only lets a device read its OWN role row, and this RPC itself
  // raises 'admin permission required' for anyone else — there is no
  // existing, already-permitted path to show every member's role/presence
  // to a normal member without broadening RLS, which this round's
  // instructions explicitly say not to do. A normal member's list row
  // therefore shows just the name, exactly as before this round.
  const [activity, setActivity] = useState<FamilyActivityRow[]>([]);
  // ROUND 3: whether admin_list_family_activity() has successfully loaded at
  // least once for the current viewer/family — see
  // logic/familyInvites.ts's isMemberInviteEligible() doc comment for why
  // this (not just `activity.length > 0`) is what gates the invite
  // affordance: it's what tells "confirmed nobody is unclaimed" apart from
  // "haven't checked yet / it failed", so the invite action never appears
  // based on a guess. Always false in local/demo mode (this data is
  // Supabase-only), which is exactly what keeps the invite affordance out
  // of demo mode without a separate demo-mode-specific check.
  const [activityLoaded, setActivityLoaded] = useState(false);
  // ROUND 3: invite metadata for the current family (admin-only, same
  // gating as activity above) — list_family_invites() (migrations/
  // 0008_family_invites.sql) never returns a raw token or token_hash, only
  // status/expiry/target metadata (see lib/invites.ts).
  const [invites, setInvites] = useState<FamilyInviteListItem[]>([]);

  const loadActivity = useCallback(() => {
    if (!isRealAdmin || !isSupabaseConfigured) return;
    adminListFamilyActivity()
      .then((rows) => {
        setActivity(rows);
        setActivityLoaded(true);
      })
      .catch((e) => {
        // Non-critical, supplementary data — the family roster itself
        // (users list) already loaded independently above; never block or
        // error-banner the whole screen just because this extra layer
        // failed (e.g. offline). activityLoaded deliberately stays
        // whatever it already was rather than being forced true here — a
        // failed reload must never make the invite affordance appear as if
        // claim status were freshly confirmed.
        // eslint-disable-next-line no-console
        console.error('FamilyScreen: failed to load family activity', e);
      });
  }, [isRealAdmin]);

  // ROUND 3: mirrors loadActivity's own shape/gating exactly — same
  // admin-only, Supabase-only condition, same "non-critical supplementary
  // data" failure handling (the invite affordance simply won't show an
  // existing-invite status if this fails; it never blocks or error-banners
  // the screen, matching every other admin-only supplementary fetch here).
  const loadInvites = useCallback(() => {
    if (!isRealAdmin || !isSupabaseConfigured) return;
    listFamilyInvites()
      .then(setInvites)
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.error('FamilyScreen: failed to load family invites', e);
      });
  }, [isRealAdmin]);

  useEffect(() => {
    load(familyId);
  }, [load, familyId]);

  useEffect(() => {
    loadActivity();
    loadInvites();
  }, [loadActivity, loadInvites]);

  // Round 7, Part 3 (bug A fix): the moment the current viewer stops being a
  // real admin — a self-demotion just landed via handleRoleChanged below, or
  // any other reason isRealAdmin flips false — drop the cached activity
  // array immediately. Without this, the family list and MemberDetailsModal
  // (which reads role/presence from `activityByUserId`, derived from this
  // state below) could keep rendering Admin-only role/presence data fetched
  // while the viewer WAS still an admin, even though they no longer are and
  // could no longer re-fetch it if asked. This is the deterministic backstop
  // for that case; handleRoleChanged also clears activity directly and
  // synchronously for the self-demotion case specifically (see its own
  // comment) rather than relying solely on this effect's scheduling.
  useEffect(() => {
    if (!isRealAdmin) {
      setActivity([]);
      // ROUND 3: same backstop for invite metadata/eligibility — losing
      // real-admin status must immediately hide the invite affordance
      // (isMemberInviteEligible requires activityLoaded=true) and drop any
      // cached invite metadata, not just activity/role/presence.
      setActivityLoaded(false);
      setInvites([]);
    }
  }, [isRealAdmin]);

  // Round 7, Part 3 (bug B fix): a role change's effect on THIS activity
  // list depends entirely on whether the CURRENT VIEWER is still a real
  // admin afterwards — so the authoritative role refresh must be awaited
  // FIRST, and the reload/clear decision made only once it has settled.
  // refreshOwnRoleAfterChange() is a safe no-op (never touches familyRole,
  // never calls the server) unless `changedUserId` is this device's own REAL
  // currentUserId (see its own doc comment in authStore.ts) — so awaiting it
  // unconditionally, for BOTH "changed someone else's role" and "changed my
  // own role", is deliberate and correct, not just a self-change special
  // case: for another member's role change it resolves immediately having
  // done nothing, leaving familyRole exactly as it was (already 'admin' in
  // every reachable case, since role management is only ever shown to a real
  // admin — see isRealFamilyAdmin()), so shouldReloadActivityAfterRoleChange
  // below still correctly decides to reload.
  //
  // For a genuine SELF role change: only once refreshOwnRoleAfterChange has
  // fully settled do we read familyRole fresh and decide — 'admin' (a
  // self-promotion, or a refresh that still resolved admin) reloads the
  // authoritative list; 'member' or null (self-demotion succeeded, or the
  // post-success refresh itself failed closed into roleRefreshNotice) clears
  // activity directly instead of firing an admin_list_family_activity() call
  // that would just get rejected — deterministic, not fire-and-forget, and
  // not dependent on the isRealAdmin effect above's scheduling (though that
  // effect also covers this same transition as a backstop).
  const handleRoleChanged = useCallback(
    async (changedUserId: string) => {
      await useAuthStore.getState().refreshOwnRoleAfterChange(changedUserId);
      const refreshedFamilyRole = useAuthStore.getState().familyRole;
      if (shouldReloadActivityAfterRoleChange(refreshedFamilyRole)) {
        loadActivity();
        loadInvites();
      } else {
        setActivity([]);
        setActivityLoaded(false);
        setInvites([]);
      }
    },
    [loadActivity, loadInvites]
  );

  const roleRefreshNotice = useAuthStore((s) => s.roleRefreshNotice);

  // Refresh presence on foreground while this screen is mounted — reuses
  // the same AppState 'active' signal App.tsx's runForegroundSync() listens
  // for (Part 2D).
  //
  // PRESENCE BUG FIX: this listener used to call loadActivity() directly on
  // 'active', racing App.tsx's OWN separate 'active' listener, which calls
  // touch_last_seen() (via runForegroundSync()) as the LAST of several
  // awaited steps (sync push, schedule reload, requests reload, THEN
  // presence). Both listeners fire off the same AppState event with no
  // ordering between them, so this screen's own read could — and per
  // real-device QA, reliably did — reach admin_list_family_activity()
  // before this device's own foreground heartbeat write had landed,
  // showing the current user's own row as however-stale it was BEFORE this
  // foreground transition instead of "now". Awaiting the same
  // touchLastSeen() primitive (the exact write App.tsx's pipeline already
  // performs — no new heartbeat mechanism invented) before reloading
  // guarantees this device's own presence is fresh in the DB before this
  // screen re-reads it, regardless of whatever order the two independent
  // listeners actually fire in.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        touchLastSeen()
          .catch(() => undefined) // presence is best-effort, same failure handling as App.tsx's own call site
          .then(() => {
            loadActivity();
            loadInvites();
          });
      }
    });
    return () => sub.remove();
  }, [loadActivity, loadInvites]);

  // While the Family screen stays open, keep the current device's own
  // presence fresh. Foreground-only updates age out after five minutes,
  // which made an actively-used device appear as "לפני 6 דק׳".
  useEffect(() => {
    if (!isRealAdmin || !isSupabaseConfigured) return;
    const refresh = () => {
      touchLastSeen()
        .catch(() => undefined)
        .then(() => loadActivity());
    };
    refresh();
    const timer = setInterval(refresh, 2 * 60 * 1000);
    return () => clearInterval(timer);
  }, [isRealAdmin, loadActivity]);

  const activityByUserId = new Map(activity.map((row) => [row.user_id, row]));
  // ROUND 3: reduces list_family_invites()'s full history to the single
  // most-recent invite per target member — see
  // logic/familyInvites.ts's latestInviteByTarget() doc comment.
  const latestInvitesByTarget = latestInviteByTarget(invites);

  const openAdd = () => {
    setEditingUser(null);
    setFormVisible(true);
  };

  const openEdit = (user: FamilyUser) => {
    setEditingUser(user);
    setFormVisible(true);
  };

  const openDelete = (user: FamilyUser) => {
    setDeleteImpact(getUserDeletionImpact(user.id));
    setDeleteTarget(user);
  };

  const openDetails = (user: FamilyUser) => setDetailsTarget(user);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={[styles.content, Platform.OS === 'web' && styles.webContent]}>
        <RtlText style={styles.header}>בני המשפחה</RtlText>
        {/* BATCH 4 (item B — dog profile completion): was hard-coded
            "טופי" regardless of the family's actual dog — now interpolates
            the real, authoritative dog.name, with a neutral fallback while
            family data is still loading. */}
        <RtlText style={styles.subheader}>ניהול מי משתתף בסבב הטיולים של {dog?.name ?? 'הכלב/ה'}</RtlText>

        <View style={styles.list}>
          {users.filter((u) => !u.removedAt).map((u) => {
            const row = activityByUserId.get(u.id);
            const roleLabel = row ? (row.role === 'admin' ? 'מנהל' : 'בן משפחה') : null;
            // Round 8, Fix 2: the row uses the SHORT compact presence label
            // (see describePresenceCompact's doc comment) — the full precise
            // last-seen text is still shown in MemberDetailsModal via plain
            // describePresence(), unchanged. `presence.active` (the 5-minute
            // freshness flag itself) is identical between both variants, so
            // the presence dot below is unaffected.
            const presence = u.id === realCurrentUserId ? { active: true, label: 'מחובר עכשיו' } : row ? describePresenceCompact(row.last_seen_at) : null;
            const subtitle = [roleLabel, presence?.label].filter(Boolean).join(' · ');
            // Round 8, Fix 1: reuses the exact same last-active-admin rule
            // MemberDetailsModal's demotion control already disables on —
            // see isLastActiveAdminMember's doc comment. Purely a client UX
            // guard; admin_delete_family_member() (0007) remains the
            // authoritative last-admin boundary regardless.
            const isLastAdmin = isLastActiveAdminMember(u.id, activity);
            return (
              <Pressable key={u.id} onPress={() => openDetails(u)} style={styles.row}>
                <View style={styles.avatarWrap}>
                  <Avatar emoji={u.avatar} color={u.color} photoUrl={u.photoUrl} size={52} />
                  {presence?.active ? <View style={styles.presenceDot} /> : null}
                </View>
                <View style={styles.nameWrap}>
                  <RtlText style={styles.name} numberOfLines={1}>
                    {u.name}
                  </RtlText>
                  {subtitle ? (
                    <RtlText style={styles.subtitle} numberOfLines={2} ellipsizeMode="tail">
                      {subtitle}
                    </RtlText>
                  ) : null}
                </View>
                {familyRole === 'admin' || u.id === effectiveUserId ? (
                  <Pressable
                    onPress={() => openEdit(u)}
                    style={styles.iconButton}
                    hitSlop={8}
                    // Round 6F: mirrors the delete icon's existing pattern
                    // below — an emoji-only Pressable gives VoiceOver/TalkBack
                    // no reliable spoken content and no indication of which
                    // member it edits without this.
                    accessibilityRole="button"
                    accessibilityLabel={`עריכת ${u.name}`}
                  >
                    <RtlText style={styles.iconText}>✏️</RtlText>
                  </Pressable>
                ) : null}
                {familyRole === 'admin' ? (
                  // Round 8, Fix 1: deliberately NOT using Pressable's
                  // `disabled` prop here. Root cause of the real-device bug
                  // ("disabled" trash icon still opened MemberDetailsModal):
                  // a `disabled` Pressable declines to become the touch
                  // responder at all (its onStartShouldSetResponder returns
                  // false), so RN's responder negotiation lets the request
                  // bubble UP to the next ancestor that WILL claim it — this
                  // row's own outer Pressable — which then fires its own
                  // onPress and opens the member's details. The icon looked
                  // disabled (opacity via iconButtonDisabled) but never
                  // actually captured/consumed the touch, so the tap fell
                  // through to the row underneath it.
                  //
                  // Fix: keep this Pressable enabled so it always claims the
                  // responder and fully consumes the touch (stopping it from
                  // ever reaching the row's onPress), and push the "last
                  // admin -> no-op" decision entirely into its own onPress
                  // via handleLastAdminGuardedPress — a plain early return,
                  // so tapping it while isLastAdmin is true calls nothing at
                  // all (no openDelete, no openDetails). Visual disabled
                  // state (opacity) and accessibility state (screen readers)
                  // are unaffected — accessibilityState={{ disabled }} alone
                  // does not change touch capture, only assistive-tech
                  // semantics.
                  <Pressable
                    onPress={() => handleLastAdminGuardedPress(isLastAdmin, () => openDelete(u))}
                    style={[styles.iconButton, isLastAdmin && styles.iconButtonDisabled]}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: isLastAdmin }}
                    accessibilityLabel={
                      isLastAdmin
                        ? 'לא ניתן למחוק את המנהל האחרון במשפחה. יש להגדיר מנהל נוסף תחילה.'
                        : `מחיקת ${u.name}`
                    }
                  >
                    <RtlText style={styles.iconText}>🗑️</RtlText>
                  </Pressable>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        {familyRole === 'admin' ? (
  <Button
    label="+ הוספת בן משפחה"
    onPress={openAdd}
    variant="secondary"
    style={styles.addButton}
  />
) : null}
      </ScrollView>

      <UserFormModal
        visible={formVisible}
        editingUser={editingUser}
        familyId={familyId}
        onSave={async (input) => {
          if (editingUser) await updateUser({ ...editingUser, ...input });
          else await addUser(input);
          setFormVisible(false);
        }}
        onClose={() => setFormVisible(false)}
      />

      <MemberDetailsModal
        visible={!!detailsTarget}
        user={detailsTarget}
        role={
          (detailsTarget && activityByUserId.get(detailsTarget.id)?.role) ??
          (detailsTarget?.id === realCurrentUserId ? realFamilyRole : null)
        }
        lastSeenAt={detailsTarget ? activityByUserId.get(detailsTarget.id)?.last_seen_at : undefined}
        canManageRoles={isRealAdmin}
        isLastAdmin={!!detailsTarget && isLastActiveAdminMember(detailsTarget.id, activity)}
        inviteEligible={
          !!detailsTarget &&
          isMemberInviteEligible({
            isRealAdmin,
            targetRemovedAt: detailsTarget.removedAt,
            targetRole: activityByUserId.get(detailsTarget.id)?.role,
            activityLoaded,
          })
        }
        existingInvite={(detailsTarget && latestInvitesByTarget.get(detailsTarget.id)) ?? null}
        onInviteListChanged={loadInvites}
        onClose={() => setDetailsTarget(null)}
        onRoleChanged={handleRoleChanged}
        isOwnProfile={!!detailsTarget && detailsTarget.id === realCurrentUserId}
        permissionOverrides={permissionOverrides}
        onSetPermissionOverride={setPermissionOverride}
        onClearPermissionOverride={clearPermissionOverride}
      />

      <DeleteUserModal
        visible={!!deleteTarget}
        user={deleteTarget}
        impact={deleteImpact}
        otherUsers={users.filter((u) => u.id !== deleteTarget?.id && !u.removedAt)}
        onConfirm={async (replacementUserId) => {
          if (deleteTarget) await deleteUser(deleteTarget.id, replacementUserId);
          setDeleteTarget(null);
          setDeleteImpact(null);
        }}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteImpact(null);
        }}
      />

      {actionError ? (
        <View style={styles.errorBanner}>
          <RtlText style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="polite">
            {actionError}
          </RtlText>
          <RtlText style={styles.errorDismiss} onPress={clearActionError}>
            הבנתי
          </RtlText>
        </View>
      ) : null}

      {roleRefreshNotice ? (
        <View style={styles.errorBanner}>
          <RtlText style={styles.errorText} accessibilityRole="alert" accessibilityLiveRegion="polite">
            {roleRefreshNotice}
          </RtlText>
          <RtlText
            style={styles.errorDismiss}
            onPress={() => useAuthStore.getState().clearRoleRefreshNotice()}
          >
            הבנתי
          </RtlText>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 16, paddingBottom: 48 },
  webContent: { maxWidth: breakpoints.desktopContent, alignSelf: 'center', width: '100%' },
  header: { width: '100%', fontSize: 22, fontWeight: '800', color: colors.textPrimary, textAlign: 'right', writingDirection: 'rtl' },
  subheader: { width: '100%', fontSize: 14, color: colors.textSecondary, textAlign: 'right', writingDirection: 'rtl', marginTop: -8 },
  list: { gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    // Round 8, Fix 2 (retry): was 12, then 8 — still truncated on real
    // iPhone. Trimmed further to 6; the icon buttons' own hitSlop (8) keeps
    // their tap target comfortable despite the tighter visual gap. With up
    // to 4 row children (avatar, nameWrap, edit icon, delete icon) this
    // alone reclaims up to 3 * 2 = 6pt versus the previous 8 gap.
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    // Round 8, Fix 2 (retry): was 12 — trimmed to 10, reclaiming another
    // 4pt of width for nameWrap (2 * 2pt, left+right).
    padding: 10,
  },
  avatarWrap: { position: 'relative' },
  presenceDot: {
    position: 'absolute',
    bottom: 0,
    end: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.statusDone,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  // Round 8, Fix 2: flexShrink so this column can never be pushed past the
  // row's remaining width by the avatar/icons — flex: 1 alone already gives
  // it the remaining space; flexShrink: 1 (RN's flex:1 shorthand already
  // implies this, kept explicit here since this is the exact column real
  // iPhone QA found truncating) is what lets the Text children's own
  // numberOfLines={1} ellipsis kick in at the true available width instead
  // of overflowing the row.
  nameWrap: { flex: 1, flexShrink: 1, gap: 2 },
  name: { fontSize: 17, fontWeight: '700', color: colors.textPrimary, textAlign: 'right' },
  subtitle: { fontSize: 12, color: colors.textSecondary, textAlign: 'right' },
  // Round 8, Fix 2 (retry): was padding 8, then 6 — still truncated.
  // Trimmed to 4 (2 icons * 2 sides * 2pt = 8pt reclaimed vs. the previous
  // round). hitSlop={8} on these Pressables (unchanged) keeps the actual
  // touch target comfortable: visual box ~ iconText glyph (~22pt at
  // fontSize 18, see below) + padding 4*2 = 8 -> ~30pt, plus hitSlop 8 on
  // every side -> ~46pt effective touch target, still clears Apple HIG's
  // 44pt minimum despite the smaller visual footprint.
  iconButton: { padding: 4 },
  iconButtonDisabled: { opacity: 0.35 },
  // Round 8, Fix 2 (retry): was 20 — trimmed to 18. Small, but on top of the
  // gap/padding trims above this reclaims another ~4pt (2pt * 2 icons) of
  // fixed-width footprint for nameWrap without making the icons hard to see
  // or tap (hitSlop still covers the touch target, see iconButton above).
  iconText: { fontSize: 18 },
  addButton: { marginTop: 4 },
  errorBanner: {
    position: 'absolute',
    bottom: 24,
    start: 20,
    end: 20,
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
