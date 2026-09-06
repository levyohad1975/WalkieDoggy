import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { RtlText } from '../components/RtlText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useFamilyStore } from '../store/familyStore';
import { useScheduleStore } from '../store/scheduleStore';
import { useAuthStore, useEffectiveFamilyRole, useEffectiveUserId } from '../store/authStore';
import { computeLastWalk, computeNextWalk, isOverdue, upcomingWalks } from '../logic/nextWalk';
import { walkDateContextLabel } from '../logic/walkDateContext';
import { canDeleteScheduledWalk, canRequestChangeForWalk } from '../logic/walkActions';
import { colors } from '../theme/colors';
import { NextWalkCard } from '../components/NextWalkCard';
import { WalkRow } from '../components/WalkRow';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { ConfirmModal } from '../components/ConfirmModal';
import { UserPickerModal } from '../components/UserPickerModal';
import { SwapWalkPickerModal } from '../components/SwapWalkPickerModal';
import { CompleteWalkModal } from '../components/CompleteWalkModal';
import { EditWalkModal } from '../components/EditWalkModal';
import { AddUnplannedWalkModal, type UnplannedWalkResult } from '../components/AddUnplannedWalkModal';
import { EditDoneDetailsModal } from '../components/EditDoneDetailsModal';
import { RequestTimeChangeModal } from '../components/RequestTimeChangeModal';
import { RequestsInboxModal } from '../components/RequestsInboxModal';
import { Button } from '../components/Button';
import { DEMO_FAMILY } from '../data/demoData';
import { isSupabaseConfigured } from '../lib/supabase';
import { useRequestsStore } from '../store/requestsStore';
import { countActionableRequests } from '../logic/requestLifecycle';
import { computeWalkRequestStatusLine } from '../logic/walkRequestStatusLine';

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
    editDoneDetails,
    editUnplannedWalk,
    deleteUnplannedWalk,
    deleteScheduledWalkOccurrence,
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
  // Final QA round, item D: "הטיול האחרון" edit/delete. Two distinct flows,
  // reusing the SAME already-tested paths HistoryScreen.tsx already uses
  // for exactly this (see its own `editUnplannedWalkId`/`editWalkId`
  // state) rather than inventing new ones:
  //   - an UNPLANNED last walk opens AddUnplannedWalkModal in edit mode
  //     (already supports responsible/time/pee/poop/note edit AND delete,
  //     backed by migration 0011 — no schedule-regeneration risk since an
  //     unplanned walk is never (re)created by scheduleStore.load()'s
  //     rule-driven backfill).
  //   - a SCHEDULED (non-unplanned) last walk opens EditDoneDetailsModal
  //     (pee/poop/note as before, PLUS completedByUserId correction and
  //     delete, added in the v2 completion pass — backed by migration
  //     0015 and canDeleteScheduledWalk(); see migration 0015's own
  //     header comment and src/logic/rotation.ts's ruleNeedsEntryBackfill
  //     for the full audit trail on why a walk-row-only DELETE here is
  //     safe from scheduleStore.load()'s rule-driven backfill — that
  //     backfill only ever inspects schedule_entries, never walks, and
  //     this delete never touches the schedule_entry row).
  const [editingLastUnplannedWalkId, setEditingLastUnplannedWalkId] = useState<string | null>(null);
  const [editingLastDoneDetailsId, setEditingLastDoneDetailsId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [requestSwapWalkId, setRequestSwapWalkId] = useState<string | null>(null);
  const [requestSwapTargetUserId, setRequestSwapTargetUserId] = useState<string | null>(null);
  const [requestTimeChangeWalkId, setRequestTimeChangeWalkId] = useState<string | null>(null);
  const [requestsInboxVisible, setRequestsInboxVisible] = useState(false);

  useEffect(() => {
    loadFamily(familyId);
    loadSchedule(familyId);
    if (isSupabaseConfigured) loadRequests();
  }, [loadFamily, loadSchedule, loadRequests, familyId]);

  // Cross-device safety net: Realtime remains the fast path, but a tab can
  // miss an event during a transient reconnect. Every time Home becomes
  // active, refresh the authoritative family/schedule/request state so a
  // walk completed on another phone (including one reassigned by an
  // approved swap) is reflected immediately on returning Home.
  useFocusEffect(
    useCallback(() => {
      void loadFamily(familyId);
      void loadSchedule(familyId);
      if (isSupabaseConfigured) void loadRequests();
    }, [familyId, loadFamily, loadSchedule, loadRequests])
  );

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
  const [minuteTick, setMinuteTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setMinuteTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const nextWalk = useMemo(() => computeNextWalk(walks), [walks, minuteTick]);
  const lastWalk = useMemo(() => computeLastWalk(walks), [walks]);
  const upcoming = useMemo(
    () => upcomingWalks(walks).filter((w) => w.id !== nextWalk?.id),
    [walks, nextWalk, minuteTick]
  );
  const overduePending = useMemo(
    () =>
      walks
        .filter(
          (w) =>
            w.status === 'pending' &&
            w.id !== nextWalk?.id &&
            isOverdue(w) &&
            (effectiveRole === 'admin' || w.responsibleUserId === effectiveUserId)
        )
        .sort((a, b) =>
          `${a.date}T${a.scheduledTime}`.localeCompare(`${b.date}T${b.scheduledTime}`)
        ),
    [walks, nextWalk, minuteTick, effectiveRole, effectiveUserId]
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
  // Section 9: badge = ONLY actionable (pending, non-expired) requests —
  // an "expired" pending request (its walk already resolved another way)
  // no longer inflates the badge, even though the row itself isn't deleted.
  const pendingForMe =
    effectiveRole === 'admin'
      ? countActionableRequests(timeChangeRequests, walksById, () => true)
      : countActionableRequests(swapRequests, walksById, (r) => r.target_user_id === effectiveUserId);

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
      {/* QA/UX round, Part F2 fix: this used to be rendered here, only on
          Home — moved to a single persistent instance at the navigator
          root (RootNavigator.tsx's <ImpersonationBanner />) so it stays
          visible on every tab while impersonating, not just this one. See
          components/ImpersonationBanner.tsx's doc comment. */}
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.topRow}>
          <Image
            source={require('../../assets/walkie-doggy-link-wordmark.png')}
            style={styles.brandWordmark}
            resizeMode="contain"
            accessibilityLabel="Walkie Doggy Link"
          />
          {isSupabaseConfigured ? (
            <Pressable onPress={() => setRequestsInboxVisible(true)} style={styles.requestsBadgeRow}>
              <RtlText style={styles.requestsBadgeText}>בקשות</RtlText>
              {pendingForMe > 0 ? (
                <View style={styles.requestsCountBadge}>
                  <RtlText style={styles.requestsCountText}>{pendingForMe}</RtlText>
                </View>
              ) : null}
            </Pressable>
          ) : (
            <View />
          )}

          {/* Dog identity (Section 6.1) — layout leaves room for a future
              dog-selector affordance, but no multi-dog logic/DB exists. */}
          <View style={styles.dogIdentity}>
            <RtlText style={styles.dogIdentityText}>🐶 {dog?.name ?? 'הכלב/ה'}</RtlText>
          </View>
        </View>

        {nextWalk ? (
          <NextWalkCard
            walk={nextWalk}
            responsible={usersById[nextWalk.responsibleUserId]}
            currentUserId={effectiveUserId}
            dogName={dog?.name ?? 'הכלב/ה'}
            dogPhotoUrl={dog?.photoUrl}
            requestStatusLine={
              computeWalkRequestStatusLine(nextWalk, swapRequests, timeChangeRequests, walksById, new Date(), effectiveUserId)?.text
            }
            onMarkDone={() => setCompleteWalkId(nextWalk.id)}
            // AUTHORIZATION CORRECTION: ✓/✕ resolution is admin-or-
            // currently-responsible-user only (migration 0012) — not "any
            // member" as an earlier pass had it.
            onMarkNotDone={() => skip(nextWalk.id)}
            canResolve={effectiveRole === 'admin' || nextWalk.responsibleUserId === effectiveUserId}
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
          {/* P1 — Home today/tomorrow date ambiguity: without this, "הטיול
              הבא"/"הטיול האחרון" could both show the exact same "07:00" for
              two genuinely different days and read as duplicates. Same
              shared helper NextWalkCard uses. */}
          <RtlText style={styles.lastWalkDateContext} numberOfLines={1}>
            {walkDateContextLabel(lastWalk.date)}
          </RtlText>
          {lastWalk.status === 'skipped' ? (
            <RtlText style={styles.lastWalkSkippedBadge}>✕ לא בוצע</RtlText>
          ) : (
            <RtlText style={styles.lastWalkDoneBadge}>✓ בוצע</RtlText>
          )}
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

      {(() => {
        // AUTHORIZATION: matches migration 0012's non-status-change edit
        // check (old.responsible_user_id = actor) — admin, the walk's own
        // responsible member, or (for a self-logged spontaneous walk) its
        // own logger. Shared by the pee/poop quick toggles below AND the
        // edit/delete row (item D) so both use the exact same rule.
        const canEditLastWalk =
          effectiveRole === 'admin' ||
          lastWalk.responsibleUserId === effectiveUserId ||
          (lastWalk.isUnplanned && lastWalk.completedByUserId === effectiveUserId);
        return (
          <>
            {lastWalk.status === 'done' ? (
              // Icon-only quick toggles (Section 6.4) — no text labels, no
              // counters; wired directly to editDoneDetails, no modal needed.
              canEditLastWalk ? (
                <View style={styles.lastWalkDetails}>
                  <Pressable
                    onPress={() => editDoneDetails(lastWalk.id, { hadPoop: !lastWalk.hadPoop })}
                    hitSlop={8}
                    style={[styles.lastWalkToggle, lastWalk.hadPoop && styles.lastWalkToggleActive]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: !!lastWalk.hadPoop }}
                    accessibilityLabel="סימון קקי בטיול האחרון"
                  >
                    <RtlText style={[styles.lastWalkToggleEmoji, !lastWalk.hadPoop && styles.lastWalkToggleEmojiMuted]}>💩</RtlText>
                  </Pressable>
                  <Pressable
                    onPress={() => editDoneDetails(lastWalk.id, { hadPee: !lastWalk.hadPee })}
                    hitSlop={8}
                    style={[styles.lastWalkToggle, lastWalk.hadPee && styles.lastWalkToggleActive]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: !!lastWalk.hadPee }}
                    accessibilityLabel="סימון פיפי בטיול האחרון"
                  >
                    <RtlText style={[styles.lastWalkToggleEmoji, !lastWalk.hadPee && styles.lastWalkToggleEmojiMuted]}>💧</RtlText>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.lastWalkDetails}>
                  {lastWalk.hadPee ? <RtlText style={styles.lastWalkDetail}>💧</RtlText> : null}
                  {lastWalk.hadPoop ? <RtlText style={styles.lastWalkDetail}>💩</RtlText> : null}
                </View>
              )
            ) : null}

            {/*
              Item D (final QA round v2 — completed): edit/delete for
              "הטיול האחרון".
              - Unplanned: routes to AddUnplannedWalkModal in edit mode —
                the SAME already-tested edit+delete path HistoryScreen.tsx
                uses for an unplanned walk (responsible/time/pee/poop/note,
                plus delete, backed by migration 0011).
              - Scheduled: routes to EditDoneDetailsModal — pee/poop/note
                (same fields the quick toggles above already edit) PLUS
                who-actually-walked-the-dog (completedByUserId) and
                delete, both added in the v2 completion pass, backed by
                migration 0015 + canDeleteScheduledWalk() (see
                src/logic/walkActions.ts). responsibleUserId itself stays
                request-only (unchanged) — see EditDoneDetailsModal's own
                doc comment for why.
              Available whenever the last walk is resolved (done OR
              skipped) and the viewer passes canEditLastWalk — not only
              'done', since a skipped scheduled walk's note is still worth
              being able to fix, and a delete is exactly as relevant for a
              mis-logged unplanned walk regardless of done/skipped.
            */}
            {canEditLastWalk ? (
              <View style={styles.lastWalkEditRow}>
                <Pressable
                  onPress={() =>
                    lastWalk.isUnplanned
                      ? setEditingLastUnplannedWalkId(lastWalk.id)
                      : setEditingLastDoneDetailsId(lastWalk.id)
                  }
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="עריכת הטיול האחרון"
                >
                  <RtlText style={styles.lastWalkEditLink}>✏️ עריכה</RtlText>
                </Pressable>
              </View>
            ) : null}
          </>
        );
      })()}
    </View>
  </View>
) : null}

        {overduePending.length > 0 ? (
          <View style={styles.section}>
            <RtlText style={styles.sectionTitle}>ממתינים לעדכון</RtlText>
            <View style={styles.list}>
              {overduePending.map((w) => {
                const canResolve =
                  effectiveRole === 'admin' ||
                  w.responsibleUserId === effectiveUserId;

                return (
                  <WalkRow
                    key={w.id}
                    walk={w}
                    responsible={usersById[w.responsibleUserId]}
                    onMarkDone={
                      canResolve ? () => setCompleteWalkId(w.id) : undefined
                    }
                    onMarkNotDone={
                      canResolve ? () => skip(w.id) : undefined
                    }
                  />
                );
              })}
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
                  // QA/UX round, Part A fix: Home's upcoming-walks list had
                  // no request-action wiring at all — a Member had no way
                  // to request a swap/time-change for their OWN future
                  // walk from here, only from ScheduleScreen. Same shared
                  // predicate ScheduleScreen uses (logic/walkActions.ts),
                  // so eligibility is identical on both screens.
                  onRequestSwap={
                    canRequestChangeForWalk(w, effectiveUserId, effectiveRole, isSupabaseConfigured)
                      ? () => setRequestSwapWalkId(w.id)
                      : undefined
                  }
                  onRequestTimeChange={
                    canRequestChangeForWalk(w, effectiveUserId, effectiveRole, isSupabaseConfigured)
                      ? () => setRequestTimeChangeWalkId(w.id)
                      : undefined
                  }
                />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <CompleteWalkModal
        visible={!!completeWalkId}
        dogName={dog?.name ?? 'הכלב/ה'}
        scheduledTime={completeWalkId ? walksById[completeWalkId]?.scheduledTime : undefined}
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

      <SwapWalkPickerModal
        visible={!!swapWalkId}
        walk={swapWalkId ? walksById[swapWalkId] ?? null : null}
        options={walks
          .filter((w) => {
            const source = swapWalkId ? walksById[swapWalkId] : undefined;
            return Boolean(
              source &&
              w.id !== source.id &&
              w.status === 'pending' &&
              w.responsibleUserId !== source.responsibleUserId &&
              w.dogId === source.dogId &&
              new Date(`${w.date}T${w.scheduledTime}:00`).getTime() > Date.now()
            );
          })
          .sort((a, b) => `${a.date}T${a.scheduledTime}`.localeCompare(`${b.date}T${b.scheduledTime}`))
          .slice(0, 20)
          .map((w) => ({ walk: w, responsible: usersById[w.responsibleUserId] }))}
        onSelect={async (otherWalkId) => {
          const sourceWalkId = swapWalkId;
          setSwapWalkId(null);
          if (sourceWalkId) await swapTwoWalks(sourceWalkId, otherWalkId, currentUserId);
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

      {/* Item D: "הטיול האחרון" edit/delete for an UNPLANNED last walk —
          same edit+delete contract as HistoryScreen.tsx's own instance. */}
      <AddUnplannedWalkModal
        visible={!!editingLastUnplannedWalkId}
        dogName={dog?.name ?? 'הכלב/ה'}
        users={activeUsers}
        defaultUserId={effectiveUserId}
        canChooseUser={effectiveRole === 'admin'}
        editingWalk={editingLastUnplannedWalkId ? walks.find((w) => w.id === editingLastUnplannedWalkId) ?? null : null}
        onConfirm={async (result: UnplannedWalkResult) => {
          const walkId = editingLastUnplannedWalkId;
          setEditingLastUnplannedWalkId(null);
          if (walkId) {
            await editUnplannedWalk(walkId, {
              date: result.date,
              scheduledTime: result.time,
              responsibleUserId: result.performedByUserId,
              hadPee: result.hadPee,
              hadPoop: result.hadPoop,
              note: result.note || undefined,
              durationMinutes: result.durationMinutes,
            });
          }
        }}
        onDelete={async (walkId) => {
          setEditingLastUnplannedWalkId(null);
          await deleteUnplannedWalk(walkId);
        }}
        onClose={() => setEditingLastUnplannedWalkId(null)}
      />

      {/*
        Item D (completed, final QA round v2): "הטיול האחרון" edit for a
        SCHEDULED last walk — pee/poop/note (as before) PLUS, now, who
        actually walked the dog (completedByUserId — NOT responsibleUserId,
        which stays request-only, see EditDoneDetailsModal's own doc
        comment) and delete. `onDelete` is only passed when
        canDeleteScheduledWalk() (mirrors migration 0015's server-side
        rule exactly) says this viewer is eligible for THIS walk — History
        screen's own EditDoneDetailsModal usage is untouched and still
        gets neither prop, so its behavior is unaffected.
      */}
      {(() => {
        const editingLastScheduledWalk = editingLastDoneDetailsId
          ? walks.find((w) => w.id === editingLastDoneDetailsId) ?? null
          : null;
        const canDeleteThisWalk =
          !!editingLastScheduledWalk &&
          canDeleteScheduledWalk(editingLastScheduledWalk, effectiveUserId, effectiveRole === 'admin');
        return (
          <EditDoneDetailsModal
            visible={!!editingLastDoneDetailsId}
            walk={editingLastScheduledWalk}
            users={activeUsers}
            canReassignCompletedBy
            onSave={async (details) => {
              const walkId = editingLastDoneDetailsId;
              setEditingLastDoneDetailsId(null);
              if (walkId) await editDoneDetails(walkId, details);
            }}
            onDelete={
              canDeleteThisWalk
                ? async (walkId: string) => {
                    setEditingLastDoneDetailsId(null);
                    await deleteScheduledWalkOccurrence(walkId);
                  }
                : undefined
            }
            onClose={() => setEditingLastDoneDetailsId(null)}
          />
        );
      })()}

      <UserPickerModal
        visible={!!requestSwapWalk && !requestSwapTargetUserId}
        title="לבקש החלפה עם מי?"
        users={activeUsers}
        excludeUserId={requestSwapWalk?.responsibleUserId}
        onSelect={(userId) => setRequestSwapTargetUserId(userId)}
        onClose={() => {
          setRequestSwapTargetUserId(null);
          setRequestSwapWalkId(null);
        }}
      />

      <SwapWalkPickerModal
        visible={!!requestSwapWalk && !!requestSwapTargetUserId}
        walk={requestSwapWalk ?? null}
        options={walks
          .filter((w) =>
            w.id !== requestSwapWalkId &&
            w.status === 'pending' &&
            w.responsibleUserId === requestSwapTargetUserId &&
            (!requestSwapWalk || w.dogId === requestSwapWalk.dogId) &&
            new Date(`${w.date}T${w.scheduledTime}:00`).getTime() > Date.now()
          )
          .sort((a, b) => `${a.date}T${a.scheduledTime}`.localeCompare(`${b.date}T${b.scheduledTime}`))
          .slice(0, 20)
          .map((w) => ({ walk: w, responsible: usersById[w.responsibleUserId] }))}
        onSelect={async (targetWalkId) => {
          const sourceWalkId = requestSwapWalkId;
          setRequestSwapTargetUserId(null);
          setRequestSwapWalkId(null);
          if (sourceWalkId) await createSwapRequest(sourceWalkId, targetWalkId);
        }}
        onClose={() => {
          setRequestSwapTargetUserId(null);
          setRequestSwapWalkId(null);
        }}
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
  topRow: { position: 'relative', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 54 },
  brandWordmark: { position: 'absolute', left: '50%', marginLeft: -82, width: 164, height: 54 },
  dogIdentity: { flexDirection: 'row', alignItems: 'center' },
  dogIdentityText: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  requestsBadgeRow: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: colors.surfaceMuted, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 },
  requestsBadgeText: { fontSize: 12, fontWeight: '700', color: colors.textPrimary },
  requestsCountBadge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryDark },
  requestsCountText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  section: { gap: 10 },
  sectionTitle: { width: '100%', fontSize: 16, fontWeight: '700', color: colors.textPrimary, textAlign: 'right', writingDirection: 'rtl' },
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

lastWalkDateContext: {
  fontSize: 11,
  fontWeight: '600',
  color: colors.textSecondary,
  marginTop: 1,
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

lastWalkSkippedBadge: {
  marginTop: 6,
  fontSize: 14,
  fontWeight: '700',
  color: colors.statusSkipped,
  backgroundColor: colors.statusSkippedBg,
  paddingHorizontal: 12,
  paddingVertical: 5,
  borderRadius: 10,
},

lastWalkToggle: {
  width: 36,
  height: 36,
  borderRadius: 18,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: colors.background,
  borderWidth: 1,
  borderColor: colors.border,
},

lastWalkToggleActive: {
  backgroundColor: colors.statusCurrentBg,
  borderColor: colors.primary,
},

lastWalkToggleEmoji: {
  fontSize: 18,
},

lastWalkToggleEmojiMuted: {
  opacity: 0.35,
},

lastWalkEditRow: {
  flexDirection: 'row',
  justifyContent: 'flex-end',
  marginTop: 10,
},
lastWalkEditLink: {
  fontSize: 13,
  fontWeight: '700',
  color: colors.primaryDark,
},
});
