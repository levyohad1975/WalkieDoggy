import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { RtlText } from '../components/RtlText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useFamilyStore } from '../store/familyStore';
import { useScheduleStore } from '../store/scheduleStore';
import { useAuthStore, useEffectiveFamilyRole, useEffectiveUserId } from '../store/authStore';
import { computeLastWalk, computeNextWalk, isOverdue, upcomingWalks } from '../logic/nextWalk';
import { walkDateContextLabel } from '../logic/walkDateContext';
import { canDeleteScheduledWalk, canRequestChangeForWalk, computeNextWalkCardActions, formatCompletedAtBadge } from '../logic/walkActions';
import { colors } from '../theme/colors';
import { breakpoints, radii, spacing, typography } from '../theme/tokens';
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
import { WalkCompletionCelebration } from '../components/WalkCompletionCelebration';
import { ReminderMascotPrompt } from '../components/ReminderMascotPrompt';
import { selectWalkCompletionCelebration, type CompletionCelebration } from '../logic/walkCompletionCelebration';
import { DEMO_FAMILY } from '../data/demoData';
import { isSupabaseConfigured } from '../lib/supabase';
import { fetchLastResolvedWalk } from '../lib/permissionedWalks';
import { useRequestsStore } from '../store/requestsStore';
import {
  countPendingRequestsForViewer,
  countUnreadRequestResults,
  walkHasActiveSwapRequest,
  walkHasActiveTimeChangeRequest,
} from '../logic/requestLifecycle';
import { computeWalkRequestStatusLine } from '../logic/walkRequestStatusLine';
import type { Walk } from '../types';
import { renderMessageTemplate } from '../mascot/messageEngine';
import { subscribeToReminderOpens, type ReminderOpenEvent } from '../notifications/reminderEntry';
import type { RootTabParamList } from '../navigation/RootNavigator';

export function HomeScreen() {
  const navigation = useNavigation<BottomTabNavigationProp<RootTabParamList, 'Home'>>();
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
    markResultsSeen,
    clearError: clearRequestsError,
  } = useRequestsStore();

  const [completeWalkId, setCompleteWalkId] = useState<string | null>(null);
  // BATCH 4 (C2/C3/C8) — brief "success" mascot + message shown right after
  // a walk is marked done. Purely presentational local state: never blocks
  // navigation or the completion action itself (markDone already resolved
  // by the time this is set), auto-dismisses on its own.
  const [celebration, setCelebration] = useState<CompletionCelebration | null>(null);
  const [recentCelebrationIds, setRecentCelebrationIds] = useState<string[]>([]);
  // A notification response can arrive before Home's family/schedule data is
  // ready on a cold start. Keep the validated event, not a prematurely built
  // string, so the prompt is only shown after its current pending walk and
  // dynamic dog data can be confirmed below.
  const [reminderPrompt, setReminderPrompt] = useState<ReminderOpenEvent | null>(null);
  const showWalkCompletionCelebration = useCallback((durationMinutes?: number) => {
    try {
      const picked = selectWalkCompletionCelebration({
        completedAt: new Date(),
        durationMinutes,
        recentIds: recentCelebrationIds,
      });
      setCelebration(picked);
      setRecentCelebrationIds((previous) => [picked.id, ...previous.filter((id) => id !== picked.id)].slice(0, 3));
    } catch {
      // Purely cosmetic — never block or interrupt a successfully saved walk.
    }
  }, [recentCelebrationIds]);
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
  useEffect(
    () =>
      subscribeToReminderOpens((event) => {
        // A genuine reminder tap should always return the person to the
        // primary actionable walk. Ordinary Home visits never publish an
        // event, so they cannot trigger this mascot moment.
        navigation.navigate('Home');
        setReminderPrompt(event);
      }),
    [navigation]
  );
  // BATCH 3 (Task 5): the single source of truth for the top Action Card's
  // four action flags — see computeNextWalkCardActions's own doc comment
  // in logic/walkActions.ts for the exact rule and the regression this
  // replaces (an inline `effectiveRole !== 'admin'` check that showed
  // request actions to any non-admin member, not only the walk's own
  // responsible member).
  const nextWalkCardActions = useMemo(
    () =>
      nextWalk ? computeNextWalkCardActions(nextWalk, effectiveUserId, effectiveRole, isSupabaseConfigured, new Date()) : null,
    [nextWalk, effectiveUserId, effectiveRole, minuteTick]
  );
  // BATCH 3 FINAL REVIEW CORRECTION — restores this card's pre-0027
  // fidelity (the single most recently resolved walk, regardless of how
  // many days ago) in Supabase mode, without reopening any bulk raw
  // historical access. Migration 0027's operational-window `walks` RLS
  // policy only exposes today's resolved walks (plus pending, any date)
  // through scheduleStore — computeLastWalk(walks) alone can therefore
  // only ever find a walk resolved TODAY. get_last_resolved_walk() (a
  // narrow, single-row, unrestricted-by-view_history/view_statistics RPC —
  // see 0027's own comment) is the fallback for "nothing resolved yet
  // today", covering an older walk.
  //
  // Priority order is deliberately "today first, server second" rather
  // than the other way around: computeLastWalk(walks), whenever it finds
  // something, is BY CONSTRUCTION always at least as recent as whatever the
  // server RPC would return (nothing can be more recent than "today"), so
  // it is always safe to trust instantly and reflects this screen's own
  // just-completed optimistic updates immediately (no round-trip needed for
  // the common case). serverLastResolvedWalk is consulted only when
  // nothing was resolved today at all.
  // BATCH 4 REVIEW CORRECTION #2 — restores the FINAL approved Batch 3
  // architecture, which this screen had regressed away from. The fetched
  // row is stored TOGETHER WITH the familyId it was fetched for, and is
  // only ever read back out when that stored familyId still matches the
  // CURRENT familyId (see the lastWalk memo below) — never a bare
  // `Walk | null`. This is a stronger guarantee than "clear it and hope a
  // pending fetch doesn't land before the clear runs": with the familyId
  // carried on the value itself, there is no render — before, during, or
  // after any family-change effect — where a family-B screen can ever read
  // a family-A row, because the read path itself refuses a mismatched
  // familyId, not just the write path.
  const [serverLastResolvedWalk, setServerLastResolvedWalk] = useState<{
    familyId: string;
    walk: Walk | null;
  } | null>(null);
  // lastResolvedWalkRequestIdRef is a COMPLEMENTARY protection, not a
  // substitute for the familyId-scoped shape above: it guards against
  // out-of-order responses for the *same* family (e.g. A → B → A in quick
  // succession issues two requests for family A; without this, the older
  // of the two could resolve last and overwrite the newer one, and the
  // familyId check alone wouldn't catch that, since both rows do carry
  // familyId "A"). Bumped on every familyId change; a response is only
  // ever applied if the generation is still current when it resolves.
  const lastResolvedWalkRequestIdRef = useRef(0);
  useEffect(() => {
    lastResolvedWalkRequestIdRef.current += 1;
  }, [familyId]);
  const refreshServerLastResolvedWalk = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const requestId = lastResolvedWalkRequestIdRef.current;
    // Captured at call time, not read again after the await: this is the
    // family the request was actually issued for, regardless of whatever
    // familyId the screen has moved on to by the time it resolves.
    const requestedFamilyId = familyId;
    try {
      const walk = await fetchLastResolvedWalk();
      // Stale response — a family change (or another refresh for the same
      // family) has already moved past this request's generation. Never
      // apply it, success or not.
      if (lastResolvedWalkRequestIdRef.current !== requestId) return;
      setServerLastResolvedWalk({ familyId: requestedFamilyId, walk });
    } catch (e) {
      if (lastResolvedWalkRequestIdRef.current !== requestId) return;
      // Best-effort, same convention as loadPermissionOverrides() — leaves
      // serverLastResolvedWalk as whatever it was. That can never be a
      // WRONG family's row being newly exposed: a stored row is only ever
      // read back out when its own familyId matches the current familyId
      // (see the lastWalk memo below), so an untouched previous value is
      // either null, or a row already correctly scoped to a family — never
      // silently reinterpreted as belonging to whichever family is current
      // now.
    }
  }, [familyId]);
  useFocusEffect(
    useCallback(() => {
      void refreshServerLastResolvedWalk();
    }, [refreshServerLastResolvedWalk, familyId])
  );
  const lastWalk = useMemo(() => {
    const resolvedToday = computeLastWalk(walks);
    if (resolvedToday) return resolvedToday;
    if (!isSupabaseConfigured) return undefined;
    // The family-scoped gate: a fetched row is only ever usable when it was
    // fetched for the family currently being viewed. This is what makes
    // this fix a true fix rather than a narrower "block the fetch" patch —
    // even a row that legitimately made it into state can never be
    // displayed for the wrong family.
    if (!serverLastResolvedWalk || serverLastResolvedWalk.familyId !== familyId) return undefined;
    return serverLastResolvedWalk.walk ?? undefined;
  }, [walks, serverLastResolvedWalk, familyId]);
  // Whether `lastWalk` is present in the local, operational-window-limited
  // `walks` state — true for anything resolved today (or always, in
  // local/demo mode, where `walks` is unrestricted). Every mutation this
  // card can trigger (skip/markDone/editDoneDetails/editUnplannedWalk/
  // deleteUnplannedWalk/deleteScheduledWalkOccurrence, all in
  // scheduleStore.ts) looks the walk up via `get().walks.find(id)` first
  // and silently no-ops if it isn't found — an older lastWalk surfaced only
  // via get_last_resolved_walk() above would otherwise let a member tap
  // "edit"/toggle 💩💧, appear to work, and silently do nothing. Rather than
  // widen every scheduleStore mutation to accept an out-of-window walk
  // (unverified, out of this correction's scope), this card stays
  // read-only for that specific case — the display-fidelity requirement
  // ("show the most recent resolved walk even when older than today") is
  // met; edit/delete remain exactly where they can safely work.
  const lastWalkIsEditable = !isSupabaseConfigured || (!!lastWalk && walks.some((w) => w.id === lastWalk.id));
  const upcoming = useMemo(
    () => upcomingWalks(walks).filter((w) => w.id !== nextWalk?.id),
    [walks, nextWalk, minuteTick]
  );
  const weeklyStats = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const inWeek = walks.filter((w) => {
      const d = new Date(`${w.date}T12:00:00`);
      return d >= start && d < end;
    });
    const done = inWeek.filter((w) => w.status === 'done');
    const minutes = done.reduce((sum, w) => sum + (w.durationMinutes ?? 0), 0);
    return { done: done.length, planned: inWeek.length, minutes };
  }, [walks, minuteTick]);

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
  const reminderPromptMessage = useMemo(() => {
    if (!reminderPrompt || !dog) return null;
    const walk = walksById[reminderPrompt.walkId];
    if (!walk || walk.status !== 'pending') return null;

    return renderMessageTemplate('{responsibleName}, הגיע הזמן לטייל עם {dogNoun} 🐾', {
      dogName: dog.name,
      dogSex: dog.sex,
      responsibleName: usersById[walk.responsibleUserId]?.name,
    });
  }, [dog, reminderPrompt, usersById, walksById]);

  // Badge counts: swap requests addressed to the viewer (a swap target can
  // be ANY active member, including one who also holds the Admin role —
  // see countPendingRequestsForViewer's own doc comment), plus, for an
  // Admin, every pending time-change request awaiting their approval
  // (requirement 4's "בקשות ממתינות (N)").
  // Section 9: badge = ONLY actionable (pending, non-expired) requests —
  // an "expired" pending request (its walk already resolved another way)
  // no longer inflates the badge, even though the row itself isn't deleted.
  const pendingForMe = countPendingRequestsForViewer(
    swapRequests,
    timeChangeRequests,
    walksById,
    effectiveUserId,
    effectiveRole === 'admin'
  );

  const unreadResultsForMe =
    countUnreadRequestResults(swapRequests, walksById, effectiveUserId) +
    countUnreadRequestResults(timeChangeRequests, walksById, effectiveUserId);
  const bellBadgeCount = pendingForMe + unreadResultsForMe;

  const openRequestsInbox = () => {
    setRequestsInboxVisible(true);
    // Only the real profile may persist read-state. During Admin
    // impersonation/test display, effectiveUserId differs from currentUserId;
    // opening the simulated inbox must not mutate anybody's read receipts.
    if (effectiveUserId === currentUserId && unreadResultsForMe > 0) {
      void markResultsSeen();
    }
  };

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
        <ActivityIndicator size="large" color={colors.primary} accessibilityLabel="טוען…" />
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
        contentContainerStyle={[styles.content, Platform.OS === 'web' && styles.webContent]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.topRow}>
          <Image
            source={require('../../assets/walkie-doggy-link-wordmark-transparent.png')}
            style={styles.brandWordmark}
            resizeMode="contain"
            accessibilityLabel="Walkie Doggy Link"
          />
          {isSupabaseConfigured ? (
            <Pressable
              onPress={openRequestsInbox}
              style={[styles.notificationButton, Platform.OS === 'web' && styles.webNotificationButton]}
              accessibilityRole="button"
              accessibilityLabel={bellBadgeCount > 0 ? `התראות בקשות: ${bellBadgeCount}` : 'בקשות'}
            >
              <RtlText style={styles.notificationIcon}>🔔</RtlText>
              {bellBadgeCount > 0 ? (
                <View style={styles.requestsCountBadge}>
                  <RtlText style={styles.requestsCountText}>{bellBadgeCount}</RtlText>
                </View>
              ) : null}
            </Pressable>
          ) : null}
        </View>

        <View style={styles.dogHero}>
          {dog?.photoUrl ? (
            <Image source={{ uri: dog.photoUrl }} style={styles.dogHeroImage} resizeMode="cover" accessibilityLabel={`תמונה של ${dog.name}`} />
          ) : (
            <View style={styles.dogHeroPlaceholder}>
              <RtlText style={styles.dogHeroEmoji}>🐶</RtlText>
              <RtlText style={styles.dogHeroPlaceholderText}>כאן תופיע התמונה של {dog?.name ?? 'הכלב/ה'}</RtlText>
            </View>
          )}
          <View style={styles.dogHeroShade}>
            <RtlText style={styles.dogHeroName}>{dog?.name ?? 'הכלב/ה'}</RtlText>
          </View>
        </View>

        {nextWalk ? (
          <NextWalkCard
            walk={nextWalk}
            responsible={usersById[nextWalk.responsibleUserId]}
            currentUserId={effectiveUserId}
            dogName={dog?.name ?? 'הכלב/ה'}
            dogPhotoUrl={dog?.photoUrl}
            dogSex={dog?.sex}
            requestStatusLine={
              computeWalkRequestStatusLine(nextWalk, swapRequests, timeChangeRequests, walksById, new Date(), effectiveUserId)?.text
            }
            primaryLabel={isOverdue(nextWalk) ? 'ממתין לעדכון' : undefined}
            onMarkDone={() => setCompleteWalkId(nextWalk.id)}
            // AUTHORIZATION CORRECTION: ✓/✕ resolution is admin-or-
            // currently-responsible-user only (migration 0012) — not "any
            // member" as an earlier pass had it.
            onMarkNotDone={() => skip(nextWalk.id)}
            canResolve={effectiveRole === 'admin' || nextWalk.responsibleUserId === effectiveUserId}
            // Direct reassignment/edit is Admin-only (requirement 6) — a
            // Member (real or simulated via test mode) gets the contextual
            // approval-based actions instead (requirement 4).
            //
            // BATCH 3 FIX (Task 5 — walk-card action authority): this used
            // to compute `effectiveRole === 'admin'`/`effectiveRole !==
            // 'admin'` inline, which meant ANY non-admin member saw "בקש
            // שינוי שעה"/"בקש החלפה" for the top Action Card, even for a
            // walk they are not responsible for. Now driven by
            // nextWalkCardActions (computeNextWalkCardActions in
            // logic/walkActions.ts), the same rule ScheduleScreen's lower
            // list already used — see that function's doc comment for the
            // full "responsible member / non-responsible member /
            // non-responsible admin" rule and its own unit tests.
            onSwap={nextWalkCardActions?.canSwapDirect ? () => setSwapWalkId(nextWalk.id) : undefined}
            onEdit={nextWalkCardActions?.canEditDirect ? () => setEditWalkId(nextWalk.id) : undefined}
            onRequestSwap={
              nextWalkCardActions?.canRequestSwap && !walkHasActiveSwapRequest(nextWalk.id, swapRequests, walksById)
                ? () => setRequestSwapWalkId(nextWalk.id)
                : undefined
            }
            onRequestTimeChange={
              nextWalkCardActions?.canRequestTimeChange &&
              !walkHasActiveTimeChangeRequest(nextWalk.id, timeChangeRequests, walksById)
                ? () => setRequestTimeChangeWalkId(nextWalk.id)
                : undefined
            }
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

        <View style={styles.weeklyCard}>
          <View style={styles.weeklyHeader}>
            <RtlText style={styles.sectionTitle}>השבוע שלנו</RtlText>
            <RtlText style={styles.weeklyPaw}>🐾</RtlText>
          </View>
          <View style={styles.weeklyStatsRow}>
            <View style={styles.weeklyStat}>
              <RtlText style={styles.weeklyStatValue}>{weeklyStats.done}</RtlText>
              <RtlText style={styles.weeklyStatLabel}>טיולים בוצעו</RtlText>
            </View>
            <View style={styles.weeklyDivider} />
            <View style={styles.weeklyStat}>
              <RtlText style={styles.weeklyStatValue}>{weeklyStats.planned}</RtlText>
              <RtlText style={styles.weeklyStatLabel}>טיולים השבוע</RtlText>
            </View>
            <View style={styles.weeklyDivider} />
            <View style={styles.weeklyStat}>
              <RtlText style={styles.weeklyStatValue}>{weeklyStats.minutes}</RtlText>
              <RtlText style={styles.weeklyStatLabel}>דקות טיול</RtlText>
            </View>
          </View>
        </View>

        {lastWalk ? (
          <View style={styles.section}>
            <View style={styles.sectionTitlePhysicalRight}>
              <RtlText style={styles.sectionTitle}>היסטוריה אחרונה</RtlText>
            </View>

            {(() => {
              const canEditLastWalk =
                lastWalkIsEditable &&
                (effectiveRole === 'admin' ||
                  lastWalk.responsibleUserId === effectiveUserId ||
                  (lastWalk.isUnplanned && lastWalk.completedByUserId === effectiveUserId));

              return (
                <View style={styles.lastWalkCard}>
                  <View style={styles.lastWalkTopRow}>
                    <View style={styles.lastWalkTimeBlock}>
                      <RtlText style={styles.lastWalkTime} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78} maxFontSizeMultiplier={1.35}>
                        {lastWalk.scheduledTime}
                      </RtlText>
                      <RtlText style={styles.lastWalkDateContext} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78} maxFontSizeMultiplier={1.35}>
                        {walkDateContextLabel(lastWalk.date)}
                      </RtlText>
                      {lastWalk.status === 'skipped' ? (
                        <RtlText style={styles.lastWalkSkippedBadge} numberOfLines={1} maxFontSizeMultiplier={1.35}>✕ לא בוצע</RtlText>
                      ) : (
                        // BATCH 4 (item F — completedAt UX): show the actual
                        // completion-click time, not just the label — the
                        // Master Specification's exact example is
                        // "✓ בוצע · 07:18". formatCompletedAtBadge() falls
                        // back to the plain label alone for legacy data with
                        // no recorded completedAt.
                        <RtlText style={styles.lastWalkDoneBadge} numberOfLines={1} maxFontSizeMultiplier={1.35}>
                          {formatCompletedAtBadge(lastWalk)}
                        </RtlText>
                      )}
                    </View>

                    <View style={styles.lastWalkActions}>
                      <View style={styles.lastWalkEditGroup}>
                        {canEditLastWalk ? (
                          <Pressable
                            onPress={() =>
                              lastWalk.isUnplanned
                                ? setEditingLastUnplannedWalkId(lastWalk.id)
                                : setEditingLastDoneDetailsId(lastWalk.id)
                            }
                            hitSlop={8}
                            style={styles.lastWalkEditAction}
                            accessibilityRole="button"
                            accessibilityLabel="עריכת הטיול האחרון"
                          >
                            <RtlText style={styles.lastWalkEditLink} numberOfLines={1} maxFontSizeMultiplier={1.25}>עריכה ✏️</RtlText>
                          </Pressable>
                        ) : null}
                      </View>

                      <View style={styles.lastWalkNeedsGroup}>
                        {lastWalk.status === 'done' ? (
                          canEditLastWalk ? (
                            <>
                              <Pressable
                                onPress={() => editDoneDetails(lastWalk.id, { hadPoop: !lastWalk.hadPoop })}
                                hitSlop={8}
                                style={styles.lastWalkNeedAction}
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked: !!lastWalk.hadPoop }}
                                accessibilityLabel="סימון קקי בטיול האחרון"
                              >
                                <RtlText style={[styles.lastWalkActionEmoji, !lastWalk.hadPoop && styles.lastWalkToggleEmojiMuted]} maxFontSizeMultiplier={1.15}>💩</RtlText>
                              </Pressable>
                              <Pressable
                                onPress={() => editDoneDetails(lastWalk.id, { hadPee: !lastWalk.hadPee })}
                                hitSlop={8}
                                style={styles.lastWalkNeedAction}
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked: !!lastWalk.hadPee }}
                                accessibilityLabel="סימון פיפי בטיול האחרון"
                              >
                                <RtlText style={[styles.lastWalkActionEmoji, !lastWalk.hadPee && styles.lastWalkToggleEmojiMuted]} maxFontSizeMultiplier={1.15}>💧</RtlText>
                              </Pressable>
                            </>
                          ) : (
                            <>
                              {lastWalk.hadPoop ? <View style={styles.lastWalkNeedAction}><RtlText style={styles.lastWalkActionEmoji}>💩</RtlText></View> : null}
                              {lastWalk.hadPee ? <View style={styles.lastWalkNeedAction}><RtlText style={styles.lastWalkActionEmoji}>💧</RtlText></View> : null}
                            </>
                          )
                        ) : null}
                      </View>
                    </View>
                    <View style={styles.lastWalkPerson}>
                      <RtlText style={styles.lastWalkPersonName} numberOfLines={1} ellipsizeMode="tail" maxFontSizeMultiplier={1.35}>
                        {lastWalk.completedByUserId
                          ? usersById[lastWalk.completedByUserId]?.name ?? 'לא ידוע'
                          : usersById[lastWalk.responsibleUserId]?.name ?? 'לא ידוע'}
                      </RtlText>
                      <RtlText style={styles.lastWalkMeta} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78} maxFontSizeMultiplier={1.35}>
                        {lastWalk.isUnplanned ? 'ספונטני' : 'מתוכנן'}
                      </RtlText>
                    </View>
                  </View>
                </View>
              );
            })()}
          </View>
        ) : null}

        {overduePending.length > 0 ? (
          <View style={styles.section}>
            <RtlText style={styles.sectionTitle}>ממתינים לעדכון</RtlText>
            <View style={styles.list}>
              {overduePending.map((w) => (
                <WalkRow
                  key={w.id}
                  walk={w}
                  responsible={usersById[w.responsibleUserId]}
                  onMarkDone={() => setCompleteWalkId(w.id)}
                  onMarkNotDone={() => skip(w.id)}
                />
              ))}
            </View>
          </View>
        ) : null}

        {upcoming.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionTitlePhysicalRight}>
              <RtlText style={styles.sectionTitle}>טיולים קרובים</RtlText>
            </View>
            <View style={styles.list}>
              {upcoming.map((w) => (
                <WalkRow
                  key={w.id}
                  walk={w}
                  hidePendingStatus
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
                    canRequestChangeForWalk(w, effectiveUserId, effectiveRole, isSupabaseConfigured) &&
                    !walkHasActiveSwapRequest(w.id, swapRequests, walksById)
                      ? () => setRequestSwapWalkId(w.id)
                      : undefined
                  }
                  onRequestTimeChange={
                    canRequestChangeForWalk(w, effectiveUserId, effectiveRole, isSupabaseConfigured) &&
                    !walkHasActiveTimeChangeRequest(w.id, timeChangeRequests, walksById)
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
          const walkBeingCompleted = walkId ? walksById[walkId] : undefined;
          setCompleteWalkId(null);
          if (!walkId) return;
          // markDone() itself refuses while Test Mode is active (see
          // scheduleStore.ts) — no separate guard needed here.
          const completed = await markDone(walkId, completedByUserId, { hadPee, hadPoop, note: note || undefined });
          // BATCH 4 (C2/C3/C8) — success mascot + message, best-effort only:
          // if anything about the walk/dog/user lookups above is somehow
          // unavailable, selectMessage()'s own safe fallbacks (see
          // messageEngine.ts) still produce a grammatical message, and this
          // is purely cosmetic — never re-thrown, never blocks markDone's
          // own error handling.
          if (completed) showWalkCompletionCelebration(walkBeingCompleted?.durationMinutes);
        }}
        onCancel={() => setCompleteWalkId(null)}
      />

      <WalkCompletionCelebration
        celebration={celebration}
        onDismiss={() => setCelebration(null)}
      />

      <ReminderMascotPrompt visible={!!reminderPromptMessage} message={reminderPromptMessage ?? ''} onDismiss={() => setReminderPrompt(null)} />

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
            const saved = await addUnplannedWalk({
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
            if (saved) showWalkCompletionCelebration(result.durationMinutes);
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
            new Date(`${w.date}T${w.scheduledTime}:00`).getTime() > Date.now() &&
            !walkHasActiveSwapRequest(w.id, swapRequests, walksById)
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
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.lg, paddingBottom: spacing.xxxl, width: '100%' },
  webContent: { maxWidth: breakpoints.desktopContent, alignSelf: 'center', paddingTop: spacing.md, gap: spacing.lg },
  emptyCard: { backgroundColor: colors.surface, borderRadius: radii.xl, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.sm },
  unplannedButton: { marginTop: -4 },
  testModeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.statusOverdue,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  testModeBannerText: { flex: 1, color: '#fff', fontWeight: '700', fontSize: typography.meta.fontSize, textAlign: 'right' },
  testModeBannerButton: { backgroundColor: '#ffffff33', borderRadius: radii.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  testModeBannerButtonText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  topRow: { position: 'relative', minHeight: 46, alignItems: 'center', justifyContent: 'center' },
  brandWordmark: { width: 150, height: 44 },
  dogHero: { width: '100%', height: 230, borderRadius: 28, overflow: 'hidden', backgroundColor: '#DFF5EE', position: 'relative' },
  dogHeroImage: { width: '100%', height: '100%' },
  dogHeroPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  dogHeroEmoji: { fontSize: 64 },
  dogHeroPlaceholderText: { fontSize: 15, fontWeight: '700', color: colors.textSecondary, textAlign: 'center' },
  dogHeroShade: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingVertical: 12, backgroundColor: '#173A3688' },
  dogHeroName: { color: '#fff', fontSize: 24, lineHeight: 30, fontWeight: '900', textAlign: 'right' },
  weeklyCard: { backgroundColor: colors.surface, borderRadius: radii.xl, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.md },
  weeklyHeader: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  weeklyPaw: { fontSize: 22 },
  weeklyStatsRow: { flexDirection: 'row-reverse', alignItems: 'stretch', justifyContent: 'space-between' },
  weeklyStat: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  weeklyStatValue: { fontSize: 25, lineHeight: 31, fontWeight: '900', color: colors.primaryDark },
  weeklyStatLabel: { fontSize: 12, lineHeight: 17, fontWeight: '700', color: colors.textSecondary, textAlign: 'center' },
  weeklyDivider: { width: 1, backgroundColor: colors.border, marginVertical: 3 },
  notificationButton: { position: 'absolute', right: 0, top: 11, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted },
  webNotificationButton: { left: 0, right: undefined },
  notificationIcon: { fontSize: 18 },
  requestsCountBadge: { minWidth: spacing.xl, height: spacing.xl, borderRadius: radii.sm, paddingHorizontal: spacing.xs, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryDark },
  requestsCountText: { fontSize: 11, fontWeight: '800', color: '#fff' },
  section: { gap: spacing.sm },
  sectionTitlePhysicalRight: {
    width: '100%',
    direction: 'ltr',
    alignItems: 'flex-end',
  },
  sectionTitle: {
    alignSelf: 'flex-end',
    ...typography.sectionTitle,
    color: colors.textPrimary,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  list: { gap: spacing.sm },

lastWalkCard: {
  backgroundColor: colors.surface,
  borderRadius: radii.lg,
  borderWidth: 1,
  borderColor: colors.border,
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
},

lastWalkTopRow: {
  flexDirection: 'row',
  direction: 'ltr',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: spacing.sm,
  minHeight: 74,
},

lastWalkTimeBlock: {
  width: 104,
  alignItems: 'center',
  flexShrink: 0,
},

lastWalkTime: {
  fontSize: 20,
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
  marginTop: 2,
  fontSize: 12,
  fontWeight: '700',
  color: '#2F9B72',
},

lastWalkSkippedBadge: {
  marginTop: 2,
  fontSize: 12,
  fontWeight: '700',
  color: colors.statusSkipped,
},

lastWalkActions: {
  width: 154,
  flexDirection: 'row',
  direction: 'ltr',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 18,
  flexShrink: 1,
},

lastWalkEditGroup: {
  flexShrink: 0,
},

lastWalkEditAction: {
  minHeight: 36,
  alignItems: 'center',
  justifyContent: 'center',
},

lastWalkNeedsGroup: {
  flexDirection: 'row',
  direction: 'ltr',
  alignItems: 'center',
  gap: 4,
  flexShrink: 0,
},

lastWalkNeedAction: {
  width: 30,
  minHeight: 36,
  alignItems: 'center',
  justifyContent: 'center',
},

lastWalkActionEmoji: {
  fontSize: 15,
},

lastWalkToggleEmojiMuted: {
  opacity: 0.35,
},

lastWalkEditLink: {
  fontSize: 12,
  fontWeight: '700',
  color: colors.primaryDark,
},

lastWalkPerson: {
  flex: 1,
  alignItems: 'flex-end',
  minWidth: 76,
},

lastWalkPersonName: {
  fontSize: 17,
  fontWeight: '800',
  color: colors.textPrimary,
  textAlign: 'right',
},

lastWalkMeta: {
  fontSize: 13,
  color: colors.textSecondary,
  textAlign: 'right',
  marginTop: 2,
},
});
