import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { RtlText } from './RtlText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFamilyStore } from '../store/familyStore';
import { useScheduleStore } from '../store/scheduleStore';
import { useAuthStore, useEffectiveFamilyRole, useEffectiveUserId } from '../store/authStore';
import { computeLastWalk, computeNextWalk, upcomingWalks } from '../logic/nextWalk';
import { colors } from '../theme/colors';
import { NextWalkCard } from '../components/NextWalkCard';
import { WalkRow } from '../components/WalkRow';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { ConfirmModal } from '../components/ConfirmModal';
import { UserPickerModal } from '../components/UserPickerModal';
import { CompleteWalkModal } from '../components/CompleteWalkModal';
import { EditWalkModal } from '../components/EditWalkModal';
import { AddUnplannedWalkModal, type UnplannedWalkResult } from '../components/AddUnplannedWalkModal';
import { RequestTimeChangeModal } from '../components/RequestTimeChangeModal';
import { RequestsInboxModal } from '../components/RequestsInboxModal';
import { Button } from '../components/Button';
import { DEMO_FAMILY } from '../data/demoData';
import { isSupabaseConfigured } from '../lib/supabase';
import { useRequestsStore } from '../store/requestsStore';

export function HomeScreen() {
  const currentUserId = useAuthStore((s) => s.currentUserId)!;
  const familyId = useAuthStore((s) => s.familyId) ?? DEMO_FAMILY.id;
  const effectiveRole = useEffectiveFamilyRole();
  // B1 (round 6): Test Mode's product UI (banner + entry button) has been
  // removed from this screen and from Settings — see SettingsScreen.tsx's
  // comment. clearTestModeIfInvalid() is still called below as a harmless
  // safety net (it only ever does anything if authStore's underlying
  // testModeUserId field is ever non-null, which nothing in the UI can
  // cause anymore).
  const clearTestModeIfInvalid = useAuthStore((s) => s.clearTestModeIfInvalid);
  const clearImpersonationIfInvalid = useAuthStore((s) => s.clearImpersonationIfInvalid);
  const impersonatingUserId = useAuthStore((s) => s.impersonatingUserId);
  const endImpersonation = useAuthStore((s) => s.endImpersonation);
  const [endingImpersonation, setEndingImpersonation] = useState(false);
  const [impersonationBannerError, setImpersonationBannerError] = useState<string | null>(null);
  const { users, dog, loading: familyLoading, error: familyError, load: loadFamily } = useFamilyStore();
  const {
    walks,
    loading: scheduleLoading,
    error: scheduleError,
    actionError,
    load: loadSchedule,
    markDone,
    swap,
    swapTwoWalks,
    rescheduleWalk,
    skip,
    addUnplannedWalk,
    clearActionError,
  } = useScheduleStore();

  const {
    swapRequests,
    timeChangeRequests,
    error: requestsError,
    load: loadRequests,
    createSwap: createSwapRequest,
    approveSwap,
    rejectSwap,
    createTimeChange: createTimeChangeRequest,
    approveTimeChange,
    rejectTimeChange,
    clearError: clearRequestsError,
  } = useRequestsStore();

  const [completeWalkId, setCompleteWalkId] = useState<string | null>(null);
  const [swapWalkId, setSwapWalkId] = useState<string | null>(null);
  const [editWalkId, setEditWalkId] = useState<string | null>(null);
  const [addUnplannedVisible, setAddUnplannedVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [requestSwapWalkId, setRequestSwapWalkId] = useState<string | null>(null);
  const [requestTimeChangeWalkId, setRequestTimeChangeWalkId] = useState<string | null>(null);
  const [requestsInboxVisible, setRequestsInboxVisible] = useState(false);

  useEffect(() => {
    loadFamily(familyId);
    loadSchedule(familyId);
    if (isSupabaseConfigured) loadRequests();
  }, [loadFamily, loadSchedule, loadRequests, familyId]);

  const usersById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users]);
  // Active-only — for pickers that assign NEW work (who's completing/
  // swapping/logging a walk): a removed member must never be offered here.
  // usersById above keeps the full set so already-recorded walks still
  // resolve a removed member's real name (see FamilyUser.removedAt).
  const activeUsers = useMemo(() => users.filter((u) => !u.removedAt), [users]);

  // ADMIN TEST MODE safety net: if the member being simulated stops being
  // active (removed, or the roster reloaded without them) exit test mode
  // automatically rather than leaving a confusing/unsafe stale simulation.
  // REAL IMPERSONATION gets the same treatment (round-3 cleanup-ordering
  // audit) — see clearImpersonationIfInvalid()'s doc comment: this is a
  // client-side UX cleanup for a stale banner, not the security boundary
  // (the server already fails closed independently of this ever running).
  useEffect(() => {
    if (users.length > 0) {
      clearTestModeIfInvalid(activeUsers.map((u) => u.id));
      clearImpersonationIfInvalid(activeUsers.map((u) => u.id));
    }
  }, [activeUsers, users.length, clearTestModeIfInvalid, clearImpersonationIfInvalid]);

  const impersonatingUser = impersonatingUserId ? users.find((u) => u.id === impersonatingUserId) : undefined;
  // effectiveRole/effectiveUserId (see authStore.ts) are 'member'/the
  // simulated member's id while simulating, regardless of the real
  // familyRole/currentUserId — shared across every screen (Family,
  // Settings, the requests inbox) so the simulated permission state and
  // identity are consistent everywhere, not just Home's own copy. The REAL
  // authenticated identity (currentUserId) and REAL familyRole never
  // change, and are never used for mutations/RLS/audit either way.
  const effectiveUserId = useEffectiveUserId()!; // HomeScreen only renders once currentUserId is set (see the `!` above)

  // Minute-level refresh so "עוד X שעות ו-Y דקות" doesn't go stale while this
  // screen stays open, without re-rendering more often than that (see
  // nextWalk.ts's relativeTimeLabel doc comment on why per-second is
  // unnecessary here).
  const [, setMinuteTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setMinuteTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const nextWalk = useMemo(() => computeNextWalk(walks), [walks]);
  const lastWalk = useMemo(() => computeLastWalk(walks), [walks]);
  const upcoming = useMemo(
    () => upcomingWalks(walks).filter((w) => w.id !== nextWalk?.id),
    [walks, nextWalk]
  );

  // ADMIN TEST MODE mutation-blocking (requirement 1) now lives centrally in
  // every store action itself (see src/lib/testModeGuard.ts's doc comment
  // for why) — scheduleStore, familyStore, and requestsStore each call
  // guardTestModeMutation() as their first line, so this screen no longer
  // needs its own copy, and no mutation/RPC anywhere can be reached while
  // testModeUserId is set, regardless of which button or screen triggers it.

  const walksById = useMemo(() => Object.fromEntries(walks.map((w) => [w.id, w])), [walks]);

  // Badge counts: for a Member, swap requests addressed to them awaiting
  // their approval; for an Admin, time-change requests awaiting theirs
  // (requirement 4's "בקשות ממתינות (N)").
  const pendingForMe =
    effectiveRole === 'admin'
      ? timeChangeRequests.filter((r) => r.status === 'pending').length
      : swapRequests.filter((r) => r.status === 'pending' && r.target_user_id === effectiveUserId).length;

  const requestSwapWalk = requestSwapWalkId ? walksById[requestSwapWalkId] : undefined;
  const requestTimeChangeWalk = requestTimeChangeWalkId ? walksById[requestTimeChangeWalkId] : undefined;

  const editingWalk = editWalkId ? walks.find((w) => w.id === editWalkId) ?? null : null;
  const otherPendingWalks = useMemo(() => {
  if (!editingWalk) return [];

  return upcomingWalks(walks, new Date(), 50)
    .filter((w) => w.id !== editingWalk.id)
    .slice(0, 12)
    .map((w) => ({
      walk: w,
      responsible: usersById[w.responsibleUserId],
    }));
}, [walks, editingWalk, usersById]);

  const loading = familyLoading || scheduleLoading;
  const error = familyError || scheduleError;

  const onRefresh = async () => {
  setRefreshing(true);

  await Promise.all([
    loadFamily(familyId),
    loadSchedule(familyId),
    ...(isSupabaseConfigured ? [loadRequests()] : []),
  ]);

  setRefreshing(false);
};

  if (loading && walks.length === 0) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.center}>
        <ErrorState message={error} onRetry={onRefresh} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {impersonatingUserId ? (
        // REAL ADMIN QA / IMPERSONATION banner — persistent, obvious, one
        // tap to exit (requirement 1). Deliberately visually distinct from
        // the Test Mode banner below (different color) so nobody confuses
        // "just a preview" with "this is really acting as that member" —
        // mutations here are REAL, unlike Test Mode's.
        <View style={styles.impersonationBanner}>
          <View style={styles.impersonationBannerTextWrap}>
            <RtlText style={styles.impersonationBannerText}>
              בדיקה אמיתית: מחובר כ-{impersonatingUser?.name ?? '—'}
            </RtlText>
            {impersonationBannerError ? (
              <RtlText style={styles.impersonationBannerError}>{impersonationBannerError}</RtlText>
            ) : null}
          </View>
          <Pressable
            onPress={async () => {
              setImpersonationBannerError(null);
              setEndingImpersonation(true);
              try {
                await endImpersonation();
              } catch {
                setImpersonationBannerError('אין חיבור לאינטרנט — נסו שוב');
              } finally {
                setEndingImpersonation(false);
              }
            }}
            style={styles.impersonationBannerButton}
            disabled={endingImpersonation}
          >
            <RtlText style={styles.impersonationBannerButtonText}>
              {endingImpersonation ? '...' : 'חזור למנהל'}
            </RtlText>
          </Pressable>
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {isSupabaseConfigured ? (
          <Pressable onPress={() => setRequestsInboxVisible(true)} style={styles.requestsBadgeRow}>
            <RtlText style={styles.requestsBadgeText}>בקשות</RtlText>
            {pendingForMe > 0 ? (
              <View style={styles.requestsCountBadge}>
                <RtlText style={styles.requestsCountText}>{pendingForMe}</RtlText>
              </View>
            ) : null}
          </Pressable>
        ) : null}

        {nextWalk ? (
          <NextWalkCard
            walk={nextWalk}
            responsible={usersById[nextWalk.responsibleUserId]}
            currentUserId={effectiveUserId}
            dogName={dog?.name ?? 'הכלב/ה'}
            dogPhotoUrl={dog?.photoUrl}
            onMarkDone={() => setCompleteWalkId(nextWalk.id)}
            // Direct reassignment/edit is Admin-only (requirement 6) — a
            // Member (real or simulated via test mode) gets the contextual
            // approval-based actions instead (requirement 4).
            onSwap={effectiveRole === 'admin' ? () => setSwapWalkId(nextWalk.id) : undefined}
            onEdit={effectiveRole === 'admin' ? () => setEditWalkId(nextWalk.id) : undefined}
            onRequestSwap={effectiveRole !== 'admin' ? () => setRequestSwapWalkId(nextWalk.id) : undefined}
            onRequestTimeChange={effectiveRole !== 'admin' ? () => setRequestTimeChangeWalkId(nextWalk.id) : undefined}
          />
        ) : (
          <View style={styles.emptyCard}>
            <EmptyState emoji="🎉" title="אין טיולים ממתינים" subtitle="אפשר להוסיף שעות טיול במסך לוח הזמנים" />
          </View>
        )}

        <Button
          label="+ הוסף טיול שבוצע"
          variant="secondary"
          onPress={() => setAddUnplannedVisible(true)}
          style={styles.unplannedButton}
          shrinkToFit
        />

        {lastWalk ? (
  <View style={styles.section}>
    <RtlText style={styles.sectionTitle}>הטיול האחרון</RtlText>

    <View style={styles.lastWalkCard}>
      <View style={styles.lastWalkTopRow}>
        <View style={styles.lastWalkTimeBlock}>
          <RtlText style={styles.lastWalkTime}>{lastWalk.scheduledTime}</RtlText>
          <RtlText style={styles.lastWalkDoneBadge}>בוצע</RtlText>
        </View>

        <View style={styles.lastWalkPerson}>
          <RtlText style={styles.lastWalkPersonName}>
            {lastWalk.completedByUserId
              ? usersById[lastWalk.completedByUserId]?.name ?? 'לא ידוע'
              : usersById[lastWalk.responsibleUserId]?.name ?? 'לא ידוע'}
          </RtlText>

          <RtlText style={styles.lastWalkMeta}>
            {lastWalk.isUnplanned ? 'טיול ספונטני' : 'טיול מתוכנן'}
          </RtlText>

        </View>
      </View>

      {(lastWalk.hadPee || lastWalk.hadPoop) ? (
        <View style={styles.lastWalkDetails}>
          {lastWalk.hadPee ? (
            <RtlText style={styles.lastWalkDetail}>💧 פיפי</RtlText>
          ) : null}

          {lastWalk.hadPoop ? (
            <RtlText style={styles.lastWalkDetail}>💩 קקי</RtlText>
          ) : null}
        </View>
      ) : null}
    </View>
  </View>
) : null}

        {upcoming.length > 0 ? (
          <View style={styles.section}>
            <RtlText style={styles.sectionTitle}>טיולים קרובים</RtlText>
            <View style={styles.list}>
              {upcoming.map((w) => (
                <WalkRow
                  key={w.id}
                  walk={w}
                  responsible={usersById[w.responsibleUserId]}
                  // Reaching EditWalkModal (the administrative edit flow) is
                  // Admin-only — see requirement 6. A Member still sees this
                  // list, just without the tap-to-edit affordance.
                  onPress={effectiveRole === 'admin' ? () => setEditWalkId(w.id) : undefined}
                />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <CompleteWalkModal
        visible={!!completeWalkId}
        dogName={dog?.name ?? 'הכלב/ה'}
        scheduledTime={nextWalk?.scheduledTime}
        users={activeUsers}
        defaultUserId={effectiveUserId}
        onConfirm={async ({ completedByUserId, hadPee, hadPoop, note }) => {
          const walkId = completeWalkId;
          setCompleteWalkId(null);
          if (!walkId) return;
          // markDone() itself refuses while Test Mode is active (see
          // scheduleStore.ts) — no separate guard needed here.
          await markDone(walkId, completedByUserId, { hadPee, hadPoop, note: note || undefined });
        }}
        onCancel={() => setCompleteWalkId(null)}
      />

      <UserPickerModal
        visible={!!swapWalkId}
        title="להחליף את התור עם מי?"
        users={activeUsers}
        excludeUserId={nextWalk?.responsibleUserId}
        onSelect={async (userId) => {
          if (swapWalkId) await swap(swapWalkId, userId, currentUserId);
          setSwapWalkId(null);
        }}
        onClose={() => setSwapWalkId(null)}
      />

      <EditWalkModal
        visible={!!editingWalk}
        walk={editingWalk}
        users={activeUsers}
        otherPendingWalks={otherPendingWalks}
        onChangeTime={async (newTime) => {
          if (editingWalk) await rescheduleWalk(editingWalk.id, newTime);
          setEditWalkId(null);
        }}
        onChangeResponsible={async (newUserId) => {
          if (editingWalk) await swap(editingWalk.id, newUserId, currentUserId);
          setEditWalkId(null);
        }}
        onSwapWithWalk={async (otherWalkId) => {
          if (editingWalk) await swapTwoWalks(editingWalk.id, otherWalkId, currentUserId);
          setEditWalkId(null);
        }}
        onCancelWalk={async () => {
          if (editingWalk) await skip(editingWalk.id);
          setEditWalkId(null);
        }}
        onClose={() => setEditWalkId(null)}
      />

      <AddUnplannedWalkModal
        visible={addUnplannedVisible}
        dogName={dog?.name ?? 'הכלב/ה'}
        users={activeUsers}
        defaultUserId={effectiveUserId}
        // A regular Member (real or admin-simulated) is always attributed
        // to themselves — only a real Admin may pick someone else
        // (requirement 5).
        canChooseUser={effectiveRole === 'admin'}
        onConfirm={async (result: UnplannedWalkResult) => {
          setAddUnplannedVisible(false);
          // addUnplannedWalk() itself refuses while Test Mode is active.
          if (dog) {
            await addUnplannedWalk({
              familyId: familyId,
              dogId: dog.id,
              performedByUserId: result.performedByUserId,
              date: result.date,
              time: result.time,
              hadPee: result.hadPee,
              hadPoop: result.hadPoop,
              note: result.note || undefined,
              durationMinutes: result.durationMinutes,
            });
          } else {
            // Must never fail silently: without a loaded dog we have no
            // dogId to attach the walk to, but the person already tapped
            // "שמור טיול" and needs to see *something*, not a modal that
            // quietly closes with the walk never saved.
            useScheduleStore.setState({
              actionError: 'עדיין טוענים את פרטי הכלב/ה — נסו שוב בעוד רגע',
            });
          }
        }}
        onClose={() => setAddUnplannedVisible(false)}
      />

      <UserPickerModal
        visible={!!requestSwapWalk}
        title="לבקש החלפה עם מי?"
        users={activeUsers}
        excludeUserId={requestSwapWalk?.responsibleUserId}
        onSelect={async (userId) => {
          const walkId = requestSwapWalkId;
          setRequestSwapWalkId(null);
          if (walkId) await createSwapRequest(walkId, userId);
        }}
        onClose={() => setRequestSwapWalkId(null)}
      />

      <RequestTimeChangeModal
        visible={!!requestTimeChangeWalk}
        currentTime={requestTimeChangeWalk?.scheduledTime ?? ''}
        onSubmit={async (proposedTime) => {
          const walkId = requestTimeChangeWalkId;
          setRequestTimeChangeWalkId(null);
          if (walkId) await createTimeChangeRequest(walkId, proposedTime);
        }}
        onClose={() => setRequestTimeChangeWalkId(null)}
      />

      <RequestsInboxModal
        visible={requestsInboxVisible}
        effectiveUserId={effectiveUserId}
        familyRole={effectiveRole}
        usersById={usersById}
        walksById={walksById}
        swapRequests={swapRequests}
        timeChangeRequests={timeChangeRequests}
        onApproveSwap={approveSwap}
        onRejectSwap={rejectSwap}
        onApproveTimeChange={approveTimeChange}
        onRejectTimeChange={rejectTimeChange}
        onClose={() => setRequestsInboxVisible(false)}
      />

      <ConfirmModal
        visible={!!actionError}
        title="אופס"
        message={actionError ?? ''}
        confirmLabel="הבנתי"
        onConfirm={clearActionError}
        onCancel={clearActionError}
      />

      <ConfirmModal
        visible={!!requestsError}
        title="אופס"
        message={requestsError ?? ''}
        confirmLabel="הבנתי"
        onConfirm={clearRequestsError}
        onCancel={clearRequestsError}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, gap: 20, paddingBottom: 48 },
  emptyCard: { backgroundColor: colors.surface, borderRadius: 28, borderWidth: 1, borderColor: colors.border },
  unplannedButton: { marginTop: -4 },
  testModeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.statusOverdue,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  testModeBannerText: { flex: 1, color: '#fff', fontWeight: '700', fontSize: 13, textAlign: 'right' },
  testModeBannerButton: { backgroundColor: '#ffffff33', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  testModeBannerButtonText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  impersonationBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primaryDark,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  impersonationBannerTextWrap: { flex: 1, gap: 2 },
  impersonationBannerText: { color: '#fff', fontWeight: '700', fontSize: 13, textAlign: 'right' },
  impersonationBannerError: { color: '#fff', fontWeight: '600', fontSize: 11, textAlign: 'right' },
  impersonationBannerButton: { backgroundColor: '#ffffff33', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  impersonationBannerButtonText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  requestsBadgeRow: { alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: colors.surfaceMuted, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 },
  requestsBadgeText: { fontSize: 12, fontWeight: '700', color: colors.textPrimary },
  requestsCountBadge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryDark },
  requestsCountText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  section: { gap: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, textAlign: 'right' },
  list: { gap: 10 },

lastWalkCard: {
  backgroundColor: colors.surface,
  borderRadius: 18,
  borderWidth: 1,
  borderColor: colors.border,
  padding: 16,
  gap: 14,
},

lastWalkTopRow: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 16,
},

lastWalkTimeBlock: {
  alignItems: 'center',
  flexShrink: 0,
},

lastWalkTime: {
  fontSize: 24,
  fontWeight: '800',
  color: colors.textPrimary,
},

lastWalkDoneBadge: {
  marginTop: 6,
  fontSize: 14,
  fontWeight: '700',
  color: '#2F9B72',
  backgroundColor: '#E8F7F1',
  paddingHorizontal: 12,
  paddingVertical: 5,
  borderRadius: 10,
},

lastWalkPerson: {
  flex: 1,
  alignItems: 'flex-end',
  minWidth: 0,
},

lastWalkPersonName: {
  fontSize: 18,
  fontWeight: '800',
  color: colors.textPrimary,
  textAlign: 'right',
},

lastWalkMeta: {
  fontSize: 13,
  color: colors.textSecondary,
  textAlign: 'right',
  marginTop: 3,
},

lastWalkDetails: {
  flexDirection: 'row',
  justifyContent: 'flex-end',
  gap: 10,
  flexWrap: 'wrap',
},

lastWalkDetail: {
  fontSize: 14,
  fontWeight: '600',
  color: colors.textPrimary,
  backgroundColor: colors.background,
  paddingHorizontal: 12,
  paddingVertical: 7,
  borderRadius: 12,
},
});
