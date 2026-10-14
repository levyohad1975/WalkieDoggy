import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, AppState, Image, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { RtlText } from '../components/RtlText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useFamilyStore } from '../store/familyStore';
import { useScheduleStore } from '../store/scheduleStore';
import { useAuthStore, useEffectiveFamilyRole, useEffectiveUserId } from '../store/authStore';
import { computeLastWalk, computeNextWalk, dailyWalkTimeline, isOverdue, nextWalkSelectionRefreshDelayMs, upcomingWalks, walkDateTime } from '../logic/nextWalk';
import { isActiveWalk } from '../logic/walkLifecycle';
import { resolvedWalkDateContextLabel, walkDateContextLabel } from '../logic/walkDateContext';
 import { repository } from '../data';
import { canRequestChangeForWalk, computeNextWalkCardActions, formatCompletedAtBadge } from '../logic/walkActions';
import { colors } from '../theme/colors';
import { breakpoints, elevation, nativeDirection, radii, spacing, typography } from '../theme/tokens';
import { NextWalkCard } from '../components/NextWalkCard';
import { WalkRow } from '../components/WalkRow';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { ConfirmModal } from '../components/ConfirmModal';
import { UserPickerModal } from '../components/UserPickerModal';
import { SwapWalkPickerModal } from '../components/SwapWalkPickerModal';
import { CompleteWalkModal } from '../components/CompleteWalkModal';
import { WalkStartFlowModal } from '../components/WalkStartFlowModal';
import { SpontaneousWalkAssociationModal } from '../components/SpontaneousWalkAssociationModal';
import { findSpontaneousAssociationCandidates, DEFAULT_SPONTANEOUS_ASSOCIATION_WINDOW_MINUTES } from '../logic/spontaneousWalkAssociation';
import { EditWalkModal } from '../components/EditWalkModal';
import { AddUnplannedWalkModal, type UnplannedWalkResult } from '../components/AddUnplannedWalkModal';
import { EditDoneDetailsModal } from '../components/EditDoneDetailsModal';
import { RequestTimeChangeModal } from '../components/RequestTimeChangeModal';
import { RequestsInboxModal } from '../components/RequestsInboxModal';
import { Button } from '../components/Button';
import { WalkCompletionCelebration } from '../components/WalkCompletionCelebration';
import { ReminderMascotPrompt } from '../components/ReminderMascotPrompt';
import { DogProfileModal } from '../components/DogProfileModal';
import { DogSelectorRow } from '../components/DogSelectorRow';
import { WalkieMascot } from '../components/WalkieMascot';
import { useSystemAdminStore } from '../store/systemAdminStore';
import { Avatar } from '../components/Avatar';
import { CELEBRATION_LIBRARY, selectWalkCompletionCelebration, type CompletionCelebration } from '../logic/walkCompletionCelebration';
import { achievementDefinition, type AchievementProgress } from '../logic/achievements';
import { useAchievementStore } from '../store/achievementStore';
import { DEMO_FAMILY } from '../data/demoData';
import { isSupabaseConfigured } from '../lib/supabase';
import { fetchLastResolvedWalk } from '../lib/permissionedWalks';
import { fetchHistoryWalks } from '../lib/permissionedWalks';
import { useRequestsStore } from '../store/requestsStore';
import {
  countPendingRequestsForViewer,
  countRecentlyResolvedRequestsForAdmin,
  countUnreadRequestResults,
  selectActionablePendingRequestsForViewer,
  walkHasActiveSwapRequest,
  walkHasActiveTimeChangeRequest,
} from '../logic/requestLifecycle';
import { PendingRequestsCard } from '../components/PendingRequestsCard';
import { computeWalkRequestStatusLine } from '../logic/walkRequestStatusLine';
import type { Walk, WalkGpsSession } from '../types';
import { renderMessageTemplate } from '../mascot/messageEngine';
import { subscribeToReminderOpens, type ReminderOpenEvent } from '../notifications/reminderEntry';
import { subscribeToRequestOpens, type RequestOpenEvent } from '../notifications/requestEntry';
import { consumeInitialWebNotificationParam, subscribeToWebNotificationClicks } from '../lib/webNotificationEntry';
import { reminderStageForNotificationKind } from '../logic/reminderAnimationLibrary';
import { reminderPromptTemplate } from '../logic/reminderPromptMessage';
import type { RootTabParamList } from '../navigation/RootNavigator';
import { useHealthStore } from '../store/healthStore';
import { getImportantHealthReminders, summarizeHealthTasksForHome } from '../logic/healthTasks';
import { getDogBackground, getDogBackgroundImageSource } from '../theme/dogBackgrounds';
import { useGpsStore } from '../store/gpsStore';
import { RemoteGpsPanel } from '../components/RemoteGpsPanel';

export function HomeScreen() {
  const navigation = useNavigation<BottomTabNavigationProp<RootTabParamList, 'Home'>>();
  const [dogProfileVisible, setDogProfileVisible] = useState(false);
  const isSystemAdmin = useSystemAdminStore((s) => s.isSystemAdmin);
  const requestOpenSystemAdmin = useSystemAdminStore((s) => s.requestOpen);
  const mascotTapCountRef = useRef(0);
  const mascotTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleHeaderMascotPress = useCallback(() => {
    if (!isSystemAdmin) {
      setDogProfileVisible(true);
      return;
    }
    mascotTapCountRef.current += 1;
    if (mascotTapTimerRef.current) clearTimeout(mascotTapTimerRef.current);
    if (mascotTapCountRef.current >= 3) {
      mascotTapCountRef.current = 0;
      requestOpenSystemAdmin();
      return;
    }
    mascotTapTimerRef.current = setTimeout(() => {
      mascotTapCountRef.current = 0;
      mascotTapTimerRef.current = null;
    }, 700);
  }, [isSystemAdmin, requestOpenSystemAdmin]);

  useEffect(() => () => {
    if (mascotTapTimerRef.current) clearTimeout(mascotTapTimerRef.current);
  }, []);
  const [heroCutoutFailed, setHeroCutoutFailed] = useState(false);
  const currentUserId = useAuthStore((s) => s.currentUserId)!;
  const familyId = useAuthStore((s) => s.familyId) ?? DEMO_FAMILY.id;
  const effectiveRole = useEffectiveFamilyRole();
  const actualFamilyRole = useAuthStore((s) => s.familyRole);
  // B1 (round 6): Test Mode's product UI (banner + entry button) has been
  // removed from this screen and from Settings — see SettingsScreen.tsx's
  // comment. clearTestModeIfInvalid() is still called below as a harmless
  // safety net (it only ever does anything if authStore's underlying
  // testModeUserId field is ever non-null, which nothing in the UI can
  // cause anymore).
  const clearTestModeIfInvalid = useAuthStore((s) => s.clearTestModeIfInvalid);
  const clearImpersonationIfInvalid = useAuthStore((s) => s.clearImpersonationIfInvalid);
  const { family, users, dog, dogs, selectedDogId, selectDog, loading: familyLoading, error: familyError, load: loadFamily } = useFamilyStore();
  // Use the established coastal photo as the default instead of the flat placeholder scene.
  // Explicit family background choices always take precedence.
  const heroBackground = getDogBackground(dog?.heroBackgroundId);
  useEffect(() => {
    setHeroCutoutFailed(false);
  }, [dog?.id, dog?.photoUrl, dog?.photoCutoutUrl]);
  const showDogCutout = Boolean(dog?.photoCutoutUrl) && !heroCutoutFailed;
  const [guestReactionPlaying, setGuestReactionPlaying] = useState(false);
  const guestReactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleHeroMascotPress = useCallback(() => {
    // A short reaction plays for both uploaded dog photos and the default mascot.
    if (dogProfileVisible || guestReactionPlaying) return;
    AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (reduceMotion) {
        setDogProfileVisible(true);
        return;
      }
      setGuestReactionPlaying(true);
      if (guestReactionTimerRef.current) clearTimeout(guestReactionTimerRef.current);
      guestReactionTimerRef.current = setTimeout(() => {
        setGuestReactionPlaying(false);
        setDogProfileVisible(true);
        guestReactionTimerRef.current = null;
      }, 5100);
    }).catch(() => setDogProfileVisible(true));
  }, [dogProfileVisible, guestReactionPlaying]);
  useEffect(() => () => {
    if (guestReactionTimerRef.current) clearTimeout(guestReactionTimerRef.current);
  }, []);

  const {
    walks,
    loading: scheduleLoading,
    error: scheduleError,
    actionError,
    isStartingUnplannedWalk,
    startingWalkIds,
    load: loadSchedule,
    startWalk,
    finishWalk,
    markDone,
    swap,
    swapTwoWalks,
    rescheduleWalk,
    skip,
    addUnplannedWalk,
    startUnplannedWalk,
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

  const healthTasks = useHealthStore((s) => s.tasks);
  const loadHealthTasks = useHealthStore((s) => s.load);
  const requestOpenHealthModal = useHealthStore((s) => s.requestOpen);
  const healthSummary = useMemo(() => summarizeHealthTasksForHome(healthTasks), [healthTasks]);
  // PRD §15's "תזכורות חשובות" inbox item type — the same active-dog
  // health tasks the Home summary pill already reads, just as a real list
  // for the Inbox rather than a count.
  const healthReminders = useMemo(() => getImportantHealthReminders(healthTasks), [healthTasks]);

  // Phase 4 (GPS foundation, PRD §7) — live tracking state for whichever
  // walk gpsStore is currently tracking. NextWalkCard below only ever
  // shows these when THIS card's own walk is the one being tracked (see
  // its liveDistanceMeters/gpsStatus wiring) — a different in-progress
  // walk elsewhere (shouldn't normally happen; at most one walk is active
  // at a time) would simply show nothing extra.
  const gpsTrackingWalkId = useGpsStore((s) => s.trackingWalkId);
  const gpsDistanceMeters = useGpsStore((s) => s.distanceMeters);
  const gpsPointCount = useGpsStore((s) => s.pointCount);
  const gpsRoutePoints = useGpsStore((s) => s.routePoints);
  const gpsPermissionStatus = useGpsStore((s) => s.permissionStatus);
  const gpsTrackingStatus = useGpsStore((s) => s.trackingStatus);
  const gpsSessionsByWalkId = useGpsStore((s) => s.sessionsByWalkId);

  const [completeWalkId, setCompleteWalkId] = useState<string | null>(null);
  const [remoteFinishRequest, setRemoteFinishRequest] = useState<{ walkId: string; walkerId: string; hadPee: boolean; hadPoop: boolean; note?: string; completedAt?: string } | null>(null);
  const [gpsTransferWalk, setGpsTransferWalk] = useState<Walk | null>(null);
  const [startWalkFlowId, setStartWalkFlowId] = useState<string | null>(null);
  const [spontaneousAssociationWalks, setSpontaneousAssociationWalks] = useState<Walk[]>([]);
  const [spontaneousAssociationVisible, setSpontaneousAssociationVisible] = useState(false);
  // BATCH 4 (C2/C3/C8) — brief "success" mascot + message shown right after
  // a walk is marked done. Purely presentational local state: never blocks
  // navigation or the completion action itself (markDone already resolved
  // by the time this is set), auto-dismisses on its own.
  const [celebration, setCelebration] = useState<CompletionCelebration | null>(null);
  const lastWalkMascotLaneRef = useRef<View>(null);
  const [lastWalkMascotAnchor, setLastWalkMascotAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const measureLastWalkMascotLane = useCallback(() => {
    requestAnimationFrame(() => {
      lastWalkMascotLaneRef.current?.measureInWindow((x, y, width, height) => {
        if (width > 0 && height > 0) setLastWalkMascotAnchor({ x, y, width, height });
      });
    });
  }, []);
  // Real-iPhone QA: the notification-open mascot moment must not cover the
  // next-walk card / Start Walk button. Measure that card's existing
  // wrapper (no layout change) so ReminderMascotPrompt can sit below it.
  const nextWalkCardRef = useRef<View>(null);
  const [nextWalkCardRect, setNextWalkCardRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const measureNextWalkCard = useCallback(() => {
    requestAnimationFrame(() => {
      nextWalkCardRef.current?.measureInWindow((x, y, width, height) => {
        if (width > 0 && height > 0) setNextWalkCardRect({ x, y, width, height });
      });
    });
  }, []);
  const suppressAchievementPopupRef = useRef(false);
  const [recentCelebrationIds, setRecentCelebrationIds] = useState<string[]>([]);
  // A notification response can arrive before Home's family/schedule data is
  // ready on a cold start. Keep the validated event, not a prematurely built
  // string, so the prompt is only shown after its current pending walk and
  // dynamic dog data can be confirmed below.
  const [reminderPrompt, setReminderPrompt] = useState<ReminderOpenEvent | null>(null);
  // Mascot-notification-experiences round — "swap/time-change approved"
  // happy-confirmation mascot moment, triggered only for the 'approved'
  // event (never 'created'/'rejected' — a rejection must never look
  // celebratory). See the subscribeToRequestOpens effect below.
  const [requestPrompt, setRequestPrompt] = useState<RequestOpenEvent | null>(null);
  const showWalkCompletionCelebration = useCallback((durationMinutes?: number) => {
    try {
      const picked = selectWalkCompletionCelebration({
        completedAt: new Date(),
        durationMinutes,
        recentIds: recentCelebrationIds,
      });
      suppressAchievementPopupRef.current = true;
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
    // PRD §9 gamification — loads the family's persisted unlock ledger so
    // checkForNewUnlocks() has a real "already unlocked" baseline to check
    // against (see achievementStore's own doc comment on why it refuses to
    // run before this resolves).
    void useAchievementStore.getState().load(familyId);
  }, [loadFamily, loadSchedule, loadRequests, familyId]);

  // Health & Grooming summary badge below needs this dog's tasks loaded —
  // eagerly, on mount and whenever the ACTIVE dog changes (unlike Settings'
  // Health sheet, which loads lazily only once opened), since the badge
  // itself must be visible without the member ever opening that sheet.
  useEffect(() => {
    if (dog) void loadHealthTasks(dog.id);
  }, [dog?.id, loadHealthTasks]);

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

  // Mobile Safari may miss Realtime while another member finishes a remote-started walk.
  // Reconcile active walks while Home is focused, even without tab navigation.
  useFocusEffect(
    useCallback(() => {
      if (!isSupabaseConfigured || !familyId) return;
      let disposed = false;
      let refreshing = false;
      const reconcile = async () => {
        if (disposed || refreshing) return;
        if (!useScheduleStore.getState().walks.some(
          (entry) => entry.familyId === familyId && isActiveWalk(entry)
        )) return;
        refreshing = true;
        try {
          await useScheduleStore.getState().load(familyId);
        } catch (error) {
          console.warn('Active walk reconciliation failed', error);
        } finally {
          refreshing = false;
        }
      };
      const interval = setInterval(() => { void reconcile(); }, 6000);
      return () => { disposed = true; clearInterval(interval); };
    }, [familyId])
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

  const startWalkAs = useCallback((walk: Walk, actualWalkerUserId: string, remoteStart: boolean) => {
    // iPhone Safari requires location permission to be requested in the
    // original user gesture. Remote starts never ask the manager's device.
    if (!remoteStart) void useGpsStore.getState().startTracking(walk).catch(() => undefined);
    void startWalk(walk.id, {
      startGps: false,
      actorUserId: currentUserId,
      actualWalkerUserId,
      substitutionConfirmed: !remoteStart && actualWalkerUserId !== walk.responsibleUserId,
      remoteStart,
    }).then((started) => {
      if (!started && !remoteStart) void useGpsStore.getState().stopTracking(walk, currentUserId);
    }, () => {
      if (!remoteStart) void useGpsStore.getState().stopTracking(walk, currentUserId);
    });
  }, [currentUserId, startWalk]);

  // PRD §9 gamification — an unlocked achievement reuses the SAME
  // celebration modal/state as an ordinary walk-completion celebration
  // (`celebration`/`setCelebration` above), sequenced through it rather
  // than a second overlay: showNextAchievementCelebration() is called both
  // from the walk-completion celebration's own onDismiss (so an
  // achievement unlocked by that same walk shows right after) AND from the
  // effect below (so one that resolves asynchronously, after the walk
  // celebration was already dismissed, still gets shown instead of being
  // silently lost). gamificationEnabled is this member's own PRD §9
  // off-switch — an opted-out member still contributes to (and can later
  // still open, via Settings) the family's shared achievement ledger; they
  // just never see the popup.
  const gamificationEnabled = usersById[effectiveUserId]?.gamificationEnabled ?? true;
  const buildAchievementCelebration = useCallback((progress: AchievementProgress): CompletionCelebration => {
    const definition = achievementDefinition(progress.key);
    const base = CELEBRATION_LIBRARY.find((c) => c.id === (definition?.celebrationId ?? 'trophy-teaser')) ?? CELEBRATION_LIBRARY[0];
    return {
      ...base,
      eyebrow: 'הישג חדש! 🏆',
      title: definition?.title ?? base.title,
      message: definition?.description ?? base.message,
      reaction: definition?.icon ?? base.accent,
    };
  }, []);
  const showNextAchievementCelebration = useCallback(() => {
    if (!gamificationEnabled) {
      // Opted out of the popup — drain the queue silently rather than
      // leaving it to surface unexpectedly if the setting is re-enabled
      // later mid-session.
      while (useAchievementStore.getState().consumeNextUnlocked()) {
        /* drain */
      }
      return;
    }
    const next = useAchievementStore.getState().consumeNextUnlocked();
    if (next) setCelebration(buildAchievementCelebration(next));
  }, [gamificationEnabled, buildAchievementCelebration]);
  const newlyUnlockedAchievementCount = useAchievementStore((s) => s.newlyUnlocked.length);
  useEffect(() => {
    if (celebration || newlyUnlockedAchievementCount === 0) return;
    if (suppressAchievementPopupRef.current) {
      // A walk-completion animation is the only automatic post-walk overlay.
      // Drain achievements unlocked by that walk silently; they remain in the
      // achievement ledger but must not immediately open a second modal.
      while (useAchievementStore.getState().consumeNextUnlocked()) {
        /* drain */
      }
      suppressAchievementPopupRef.current = false;
      return;
    }
    showNextAchievementCelebration();
  }, [newlyUnlockedAchievementCount, celebration, showNextAchievementCelebration]);

  /**
   * The achievement catalog's family-wide milestones (e.g. 10/25/50 total
   * walks) need the family's FULL history, not scheduleStore's own `walks`
   * (RLS-restricted to an operational window — see StatisticsScreen.tsx's
   * matching doc comment). Reuses fetchHistoryWalks() (migration 0027) —
   * the same permissioned bulk-historical read HistoryScreen already
   * relies on — rather than introducing a third one. Best-effort: a
   * denied/offline/local-demo caller simply skips this check for now
   * (falling back to scheduleStore's own walks in local/demo mode, where
   * there is no such RLS window to begin with) — achievement detection is
   * a bonus layered on top of the walk flow, never a reason to block or
   * degrade it.
   */
  const fetchAchievementWalks = useCallback(async (): Promise<Walk[]> => {
    if (!isSupabaseConfigured) return useScheduleStore.getState().walks;
    try {
      return await fetchHistoryWalks();
    } catch {
      return [];
    }
  }, []);
  const checkForNewAchievementUnlocks = useCallback(() => {
    void (async () => {
      const achievementWalks = await fetchAchievementWalks();
      if (achievementWalks.length === 0) return;
      // swapRequests is already loaded by the mount effect above
      // (`if (isSupabaseConfigured) loadRequests();`) — read fresh from
      // the store rather than a possibly-stale closed-over value, same
      // convention as fetchAchievementWalks itself.
      await useAchievementStore.getState().checkForNewUnlocks(familyId, achievementWalks, effectiveUserId, useRequestsStore.getState().swapRequests);
    })();
  }, [fetchAchievementWalks, familyId, effectiveUserId]);

  const [minuteTick, setMinuteTick] = useState(0);

  // PRD §11: multi-dog families must see only the SELECTED dog's walks on
  // this screen (next/last/upcoming/overdue) — `walks` itself is the raw,
  // family-wide store, unfiltered by dog. Scope the supplied pool here so
  // the pure selectors remain reusable; computeNextWalk applies the family-
  // local schedule-slot rule to this selected dog's walks. A single-dog
  // family (dogs.length <= 1) sees all of the current family's walks.
  // Walk lookups BY ID (walksById, walks.find(id)) stay on the unfiltered
  // `walks` on purpose: those resolve one already-known walk regardless of
  // which dog is selected (e.g. a modal opened before a dog switch).
  const visibleWalks = useMemo(() => {
    const familyWalks = walks.filter((walk) => walk.familyId === familyId);
    return dogs.length > 1 && dog ? familyWalks.filter((walk) => walk.dogId === dog.id) : familyWalks;
  }, [walks, familyId, dogs.length, dog?.id]);
  const scheduleTimezone = family?.id === familyId ? family.timezone : undefined;

  // Recompute at the next family-local walk boundary (and local minute for
  // countdown copy), not a drifting 60-second interval. Foregrounding also
  // refreshes immediately after Safari/app timer throttling.
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const scheduleRefresh = () => {
      if (disposed) return;
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        setMinuteTick((tick) => tick + 1);
        scheduleRefresh();
      }, nextWalkSelectionRefreshDelayMs(visibleWalks, new Date(), scheduleTimezone));
    };
    scheduleRefresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      setMinuteTick((tick) => tick + 1);
      scheduleRefresh();
    });
    return () => {
      disposed = true;
      if (timeout) clearTimeout(timeout);
      subscription.remove();
    };
  }, [visibleWalks, scheduleTimezone]);

  const nextWalk = useMemo(
    () => computeNextWalk(visibleWalks, new Date(), scheduleTimezone),
    [visibleWalks, minuteTick, scheduleTimezone]
  );
  // Keep one visible row per dog when legacy duplicates exist. The duplicate
  // admin review panel exposes every exact ID; home must not repeat cards.
  const activeSpontaneousWalkGroups = useMemo(() => {
    const groups = new Map<string, Walk[]>();
    visibleWalks.filter((walk) => walk.isUnplanned && isActiveWalk(walk) && walk.id !== nextWalk?.id
      && (actualFamilyRole === 'admin' || walk.actualWalkerUserId === currentUserId
        || (!walk.actualWalkerUserId && walk.responsibleUserId === currentUserId)))
      .forEach((walk) => groups.set(walk.dogId, [...(groups.get(walk.dogId) ?? []), walk]));
    return [...groups.entries()].map(([dogId, walks]) => ({ dogId, walks }));
  }, [visibleWalks, nextWalk?.id, actualFamilyRole, currentUserId]);
  // Planned walks may be started from 30 minutes before their scheduled time.
  // Spontaneous walks keep their separate always-available flow.
  const nextWalkStartGate = useMemo(() => {
    if (!nextWalk || nextWalk.status !== 'pending' || nextWalk.isUnplanned) return { disabled: false, label: undefined as string | undefined };
    const scheduledAt = walkDateTime(nextWalk, scheduleTimezone);
    const unlockAt = scheduledAt.getTime() - 30 * 60 * 1000;
    if (!Number.isFinite(unlockAt) || Date.now() >= unlockAt) return { disabled: false, label: undefined as string | undefined };
    const unlock = new Date(unlockAt);
    const hh = String(unlock.getHours()).padStart(2, '0');
    const mm = String(unlock.getMinutes()).padStart(2, '0');
    return { disabled: true, label: `ניתן להתחיל את הטיול החל מ־${hh}:${mm}` };
  }, [nextWalk, minuteTick]);
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
  // Mascot-notification-experiences round — the swap/time-change
  // counterpart to the reminder-open effect above: a genuine notification
  // tap always opens the requests inbox (never a dead end), and only an
  // 'approved' outcome also shows the happy-confirmation mascot moment —
  // a 'created'/'rejected' tap opens the inbox silently, matching the
  // ordinary bell-tap behavior it reuses (openRequestsInbox, defined below
  // in this component — safe to reference here: this callback only runs
  // after the full render, by which point it is already initialized).
  useEffect(
    () =>
      subscribeToRequestOpens((event) => {
        navigation.navigate('Home');
        openRequestsInbox();
        if (event.event === 'approved') setRequestPrompt(event);
      }),
    [navigation]
  );
  // Mascot-notification-experiences round — web (PWA) counterpart to
  // native's notification-response listener; both funnel into the same
  // subscribeToReminderOpens/subscribeToRequestOpens channels above. A
  // no-op on native. Runs once per mount: the cold-launch URL param is
  // consumed a single time, and the service-worker message listener stays
  // subscribed for the lifetime of this screen.
  useEffect(() => {
    consumeInitialWebNotificationParam();
    return subscribeToWebNotificationClicks();
  }, []);
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
  const [lastWalkGps, setLastWalkGps] = useState<WalkGpsSession | null>(null);
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
    const resolvedToday = computeLastWalk(visibleWalks);
    if (resolvedToday) return resolvedToday;
    if (!isSupabaseConfigured) return undefined;
    // The family-scoped gate: a fetched row is only ever usable when it was
    // fetched for the family currently being viewed. This is what makes
    // this fix a true fix rather than a narrower "block the fetch" patch —
    // even a row that legitimately made it into state can never be
    // displayed for the wrong family.
    if (!serverLastResolvedWalk || serverLastResolvedWalk.familyId !== familyId) return undefined;
    // NOTE (multi-dog, PRD §11): unlike resolvedToday above, this server
    // fallback (get_last_resolved_walk()) is family-wide, not dog-scoped —
    // it only kicks in when NOTHING was resolved today for ANY dog, so a
    // multi-dog family could very rarely see another dog's last resolved
    // walk here specifically in that edge case. Narrowing it further needs
    // an RPC signature change (a new migration), out of scope for this
    // client-only pass.
    return serverLastResolvedWalk.walk ?? undefined;
  }, [visibleWalks, serverLastResolvedWalk, familyId]);
  useEffect(() => {
    if (!lastWalk || lastWalk.status !== 'done') {
      setLastWalkGps(null);
      return;
    }
    // A just-finished walk can publish its GPS session a fraction after the
    // walk row flips to done. Prefer the gpsStore cache when it arrives so
    // the summary refreshes immediately instead of getting stuck on the
    // first repository read that raced the final GPS persistence.
    const cachedSession = gpsSessionsByWalkId[lastWalk.id];
    if (cachedSession) {
      setLastWalkGps(cachedSession);
      return;
    }
    let cancelled = false;
    void repository.getGpsSessionsForWalkIds([lastWalk.id]).then((sessions) => {
      if (!cancelled) setLastWalkGps(sessions[0] ?? null);
    }).catch(() => {
      if (!cancelled) setLastWalkGps(null);
    });
    return () => { cancelled = true; };
  }, [lastWalk?.id, lastWalk?.status, gpsSessionsByWalkId]);

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
  // Keep the server fallback interactive when the same resolved walk is available
  // through the authorized history RPC but falls outside the operational walks window.
  // Home hydrates that one row into the local schedule store so the existing
  // editDoneDetails quick toggles keep their offline-first mutation semantics.
  const lastWalkIsEditable = !isSupabaseConfigured || (!!lastWalk && walks.some((w) => w.id === lastWalk.id));

  useEffect(() => {
    if (!isSupabaseConfigured || !lastWalk || lastWalk.status !== 'done' || lastWalkIsEditable) return;
    let cancelled = false;
    void fetchHistoryWalks()
      .then((history) => {
        if (cancelled) return;
        const authorized = history.find((w) => w.id === lastWalk.id);
        if (!authorized) return;
        useScheduleStore.setState((state) =>
          state.walks.some((w) => w.id === authorized.id)
            ? state
            : { walks: [...state.walks, authorized] }
        );
      })
      .catch(() => {
        // History permission can legitimately be absent; the fallback card then
        // remains read-only rather than widening access client-side.
      });
    return () => {
      cancelled = true;
    };
  }, [lastWalk?.id, lastWalk?.status, lastWalkIsEditable]);
  const upcoming = useMemo(
    () => upcomingWalks(visibleWalks).filter((w) => w.id !== nextWalk?.id),
    [visibleWalks, nextWalk, minuteTick]
  );
  // The compact Home timeline is a Dashboard summary, not a list of only
  // the walks *after* the primary card. Including the next walk means the
  // section remains useful (and visibly present) on a day with one walk.
  const dashboardTimelineWalks = useMemo(() => {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const timeline = dailyWalkTimeline(visibleWalks, now);
    // Home is a forward-looking summary, not today's full history. Keep the
    // unresolved/current walk visible, then only the nearest future walks.
    // This also makes the dashboard resilient to large volumes of Staging
    // test walks without squeezing dozens of stops into one phone width.
    return timeline
      .filter((walk) => {
        if (isActiveWalk(walk)) return true;
        if (walk.status !== 'pending') return false;
        const [hour, minute] = walk.scheduledTime.split(':').map(Number);
        return hour * 60 + minute >= nowMinutes;
      })
      .slice(0, 4);
  }, [visibleWalks, minuteTick]);
  const dashboardTimelineProgress = useMemo(() => {
    if (dashboardTimelineWalks.length < 2) return dashboardTimelineWalks.length === 1 ? 0 : 0;
    const now = new Date();
    const minutesNow = now.getHours() * 60 + now.getMinutes();
    const toMinutes = (time: string) => {
      const [h, m] = time.split(':').map(Number);
      return h * 60 + m;
    };
    const first = toMinutes(dashboardTimelineWalks[0].scheduledTime);
    const last = toMinutes(dashboardTimelineWalks[dashboardTimelineWalks.length - 1].scheduledTime);
    if (last <= first) return 0;
    return Math.max(0, Math.min(1, (minutesNow - first) / (last - first)));
  }, [dashboardTimelineWalks, minuteTick]);
  const overduePending = useMemo(
    () =>
      visibleWalks
        .filter(
          (w) =>
            w.status === 'pending' &&
            w.id !== nextWalk?.id &&
            isOverdue(w, new Date(), scheduleTimezone) &&
            (effectiveRole === 'admin' || w.responsibleUserId === effectiveUserId)
        )
        .sort((a, b) =>
          `${a.date}T${a.scheduledTime}`.localeCompare(`${b.date}T${b.scheduledTime}`)
        ),
    [visibleWalks, nextWalk, minuteTick, effectiveRole, effectiveUserId, scheduleTimezone]
  );

  // ADMIN TEST MODE mutation-blocking (requirement 1) now lives centrally in
  // every store action itself (see src/lib/testModeGuard.ts's doc comment
  // for why) — scheduleStore, familyStore, and requestsStore each call
  // guardTestModeMutation() as their first line, so this screen no longer
  // needs its own copy, and no mutation/RPC anywhere can be reached while
  // testModeUserId is set, regardless of which button or screen triggers it.

  const walksById = useMemo(() => Object.fromEntries(walks.map((w) => [w.id, w])), [walks]);
  useEffect(() => {
    const trackedWalk = gpsTrackingWalkId ? walksById[gpsTrackingWalkId] : undefined;
    if (trackedWalk?.duplicateResolutionGroupId) {
      // A fresh server resolution invalidates the active timer/watch. This
      // only closes the in-memory foreground watcher; saved GPS sessions and
      // route data are deliberately left untouched.
      useGpsStore.getState().cancelTracking(trackedWalk.id);
    }
  }, [gpsTrackingWalkId, walksById]);
  const reminderPromptMessage = useMemo(() => {
    if (!reminderPrompt) return null;
    const walk = walksById[reminderPrompt.walkId];
    if (!walk || walk.status !== 'pending') return null;
    // Multi-dog (PRD §11): a reminder can fire for ANY of the family's
    // dogs, regardless of which one is currently selected in the UI — look
    // the walk's actual dog up by walk.dogId rather than assuming it's the
    // globally active `dog`. Falls back to the active dog only if the walk
    // somehow references a dog no longer in `dogs` (shouldn't normally
    // happen), so a genuinely resolvable prompt is never dropped.
    const walkDog = dogs.find((d) => d.id === walk.dogId) ?? dog;
    if (!walkDog) return null;

    return renderMessageTemplate(reminderPromptTemplate(reminderPrompt.kind, walk.date, walk.scheduledTime), {
      dogName: walkDog.name,
      dogSex: walkDog.sex,
      responsibleName: usersById[walk.responsibleUserId]?.name,
    });
  }, [dog, dogs, reminderPrompt, usersById, walksById]);
  // Mascot-notification-experiences round — selects the stage-appropriate
  // mascot animation (T-15 excited, T playful-invitation, T+15 waiting,
  // T+30 waiting-escalated) instead of ReminderMascotPrompt's previous
  // unfiltered random pick; see reminderStageForNotificationKind's own doc
  // comment for the server-payload-vocabulary mapping.
  // The card's on-screen position changes with scrolling, so re-measure at
  // the moment a notification-open mascot moment is about to appear.
  useEffect(() => {
    if (reminderPrompt || requestPrompt) measureNextWalkCard();
  }, [measureNextWalkCard, reminderPrompt, requestPrompt]);
  const reminderPromptStage = useMemo(
    () => (reminderPrompt ? reminderStageForNotificationKind(reminderPrompt.kind) : undefined),
    [reminderPrompt]
  );
  // Mascot-notification-experiences round — a short, always-available
  // happy-confirmation message for an approved swap/time-change (never
  // personalized by name/time, so it never depends on a request still
  // being present in a possibly-not-yet-loaded local store — a stale or
  // not-yet-loaded request still gets a correct, generic confirmation).
  const requestPromptMessage = useMemo(() => {
    if (!requestPrompt) return null;
    return requestPrompt.kind === 'swap' ? 'בקשת ההחלפה אושרה! 🎉' : 'בקשת שינוי השעה אושרה! 🎉';
  }, [requestPrompt]);

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

  // Request-notifications repair, item B — the actual actionable items for
  // the Home Dashboard pending-request card (PendingRequestsCard), using
  // the exact same authorization filters as pendingForMe above so the
  // count and the detailed cards can never disagree.
  const actionablePendingRequests = selectActionablePendingRequestsForViewer(
    swapRequests,
    timeChangeRequests,
    walksById,
    effectiveUserId,
    effectiveRole === 'admin'
  );

  const unreadResultsForMe =
    countUnreadRequestResults(swapRequests, walksById, effectiveUserId) +
    countUnreadRequestResults(timeChangeRequests, walksById, effectiveUserId) +
    (effectiveRole === 'admin'
      ? countRecentlyResolvedRequestsForAdmin(swapRequests, walksById, effectiveUserId) +
        countRecentlyResolvedRequestsForAdmin(timeChangeRequests, walksById, effectiveUserId)
      : 0);
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

  // Multi-dog (PRD §11): a swap target must belong to the SAME dog as the
  // walk being edited — matching the dogId filter both SwapWalkPickerModal
  // call sites below already apply. Without this, a multi-dog family could
  // be offered to "swap" one dog's walk with a completely different dog's
  // occurrence.
  return upcomingWalks(walks, new Date(), 50)
    .filter((w) => w.id !== editingWalk.id && w.dogId === editingWalk.dogId)
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

  // PRD §25's "no dog" state — a dog is genuinely optional at family
  // creation (FamilyOnboardingScreen), so an admin can land here with a
  // fully-loaded, dogless family. Previously this fell through to the
  // generic "אין טיולים ממתינים" (no pending walks) empty state below,
  // which misleadingly implies walks exist but happen to be scheduled
  // elsewhere, rather than that there is nothing to walk at all yet.
  // Gated on !familyLoading so this never flashes before the real family
  // data (and its dog, if any) has actually loaded.
  if (!dog && !familyLoading) {
    return (
      <SafeAreaView style={styles.center}>
        <WalkieMascot
          state="excited"
          size={150}
          accessibilityLabel="Walkie Doggy מזמין אתכם להוסיף את הכלב הראשון"
          testID="no-dog-mascot"
        />
        <RtlText style={styles.noDogTitle}>עדיין אין כלב במשפחה</RtlText>
        <RtlText style={styles.noDogSubtitle}>בואו נכיר את החבר החדש שלנו. הוסיפו את הכלב הראשון כדי להתחיל לטייל עם Walkie Doggy</RtlText>
        <Button label="הוספת כלב" onPress={() => navigation.navigate('Settings')} style={styles.addFirstDogButton} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      {/* QA/UX round, Part F2 fix: this used to be rendered here, only on
          Home — moved to a single persistent instance at the navigator
          root (RootNavigator.tsx's <ImpersonationBanner />) so it stays
          visible on every tab while impersonating, not just this one. See
          components/ImpersonationBanner.tsx's doc comment. */}
      <ScrollView
        // The dashboard contains real, variable family data. It must remain
        // reachable on Safari too: the bottom tab bar is fixed, so disabling
        // Web scrolling cuts the schedule/approval cards off below it.
        scrollEnabled
        contentContainerStyle={[styles.content, Platform.OS === 'web' && styles.webContent]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.dashboardHeroShell}>
          <View pointerEvents="none" style={styles.dashboardHeroBackdrop}>
            {heroBackground ? (
              <Image source={getDogBackgroundImageSource(heroBackground)} style={styles.dashboardHeroImage} resizeMode="cover" />
            ) : (
              <>
                <View style={styles.dashboardHeroDefaultSun} />
                <View style={styles.dashboardHeroDefaultHillBack} />
                <View style={styles.dashboardHeroDefaultHillFront} />
                <View style={styles.dashboardHeroDefaultGround} />
              </>
            )}
            <Svg
              pointerEvents="none"
              width="100%"
              height={44}
              viewBox="0 0 100 44"
              preserveAspectRatio="none"
              style={styles.dashboardHeroFade}
            >
              <Defs>
                <LinearGradient id="dashboardHeroCreamFade" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={colors.background} stopOpacity={0} />
                  <Stop offset="1" stopColor={colors.background} stopOpacity={1} />
                </LinearGradient>
              </Defs>
              <Rect x="0" y="0" width="100" height="44" fill="url(#dashboardHeroCreamFade)" />
            </Svg>
          </View>
          <View style={[styles.topRow, styles.dashboardTopRow]}>
            <Image
              source={require('../../assets/walkie-doggy-link-wordmark-transparent.png')}
              style={styles.brandWordmark}
              resizeMode="contain"
              accessibilityLabel="Walkie Doggy Link"
            />
            <Pressable
              onPress={handleHeaderMascotPress}
              style={[styles.mascotHeaderButton, celebration && styles.homeMascotSuppressed]}
              accessibilityRole="button"
              accessibilityLabel="פתיחת פרופיל הכלב"
              accessibilityElementsHidden={!!celebration}
              importantForAccessibility={celebration ? 'no-hide-descendants' : 'auto'}
              pointerEvents={celebration ? 'none' : 'auto'}
            >
              <WalkieMascot state="idle" size={38} accessibilityLabel="Walkie Doggy" />
            </Pressable>
            <Pressable
              onPress={openRequestsInbox}
              style={styles.notificationButton}
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
          </View>

          {/* Issue #145: the approved calm composition remains the default;
              a manager-selected family scene replaces it and a transparent dog
              cutout is composited over it when one exists. */}
          <Pressable
            onPress={handleHeroMascotPress}
            style={styles.dashboardHero}
            accessibilityRole="button"
            accessibilityLabel={`פתיחת פרופיל ${dog?.name ?? 'הכלב/ה'}`}
          >
            {showDogCutout ? <Image source={{ uri: dog!.photoCutoutUrl! }} style={styles.dashboardHeroDogCutout} resizeMode="contain" onError={() => setHeroCutoutFailed(true)} /> : null}
            {!showDogCutout ? (
              <View
                style={[styles.dashboardHeroMascot, celebration && styles.dashboardHeroMascotCelebrating]}
                pointerEvents="none"
                accessibilityElementsHidden={!!celebration}
                importantForAccessibility={celebration ? 'no-hide-descendants' : 'auto'}
              >
                {/* Keep the hero slot mounted so the approved Dashboard geometry never
                    jumps, but suppress the default mascot while the dedicated completion
                    mascot owns the stage. Uploaded family-dog imagery above is untouched. */}
                <WalkieMascot state={guestReactionPlaying ? 'excited' : 'idle'} size={158} accessibilityLabel="הקמע הרשמי של Walkie Doggy" />
              </View>
            ) : null}
            {dog?.heroBackgroundId === 'walkie-park' && !showDogCutout ? (
              <View pointerEvents="none" style={styles.dashboardHeroForeground}>
                <View style={styles.dashboardHeroForegroundLeft} />
                <View style={styles.dashboardHeroForegroundMid} />
                <View style={styles.dashboardHeroForegroundDogBase} />
                <View style={styles.dashboardHeroForegroundRight} />
              </View>
            ) : null}
          </Pressable>
        </View>

        {/* PRD §11: "ב-Home יש בחירת כלב קלה כאשר יש יותר מכלב אחד" — an
            easy dog picker on Home whenever there's more than one dog.
            Selecting a chip makes that dog active (selectDog(), persisted),
            which visibleWalks above (and every card below) then reflects.
            Hidden entirely for a single-dog family — no change there. */}
        {dogs.length > 1 ? (
          <DogSelectorRow dogs={dogs} selectedDogId={selectedDogId} onSelect={(dogId) => void selectDog(dogId)} />
        ) : null}

        {/*
          Health & Grooming summary (PRD §10) — deliberately a single slim,
          dismissible-feeling pill, never a full list here: this screen's
          job is the walk experience, so the badge only ever tells the
          member "something needs attention" and hands off to Settings'
          Health sheet (via healthStore.requestOpen(), a cross-tab signal —
          see that store's own doc comment) for the actual list. Rendered
          only when there's genuinely something to flag, so a family with no
          open tasks — or none due/overdue yet — sees nothing extra at all.
        */}
        {healthSummary.overdueCount + healthSummary.dueSoonCount > 0 ? (
          <Pressable
            style={[styles.healthSummaryPill, healthSummary.overdueCount > 0 && styles.healthSummaryPillOverdue]}
            onPress={() => {
              requestOpenHealthModal();
              navigation.navigate('Settings');
            }}
            accessibilityRole="button"
            accessibilityLabel={
              healthSummary.overdueCount > 0
                ? `${healthSummary.overdueCount} משימות בריאות וטיפוח באיחור, מעבר להגדרות`
                : `${healthSummary.dueSoonCount} משימות בריאות וטיפוח קרובות, מעבר להגדרות`
            }
          >
            <RtlText style={styles.healthSummaryIcon}>🏥</RtlText>
            <RtlText style={styles.healthSummaryText}>
              {healthSummary.overdueCount > 0
                ? `${healthSummary.overdueCount} משימות בריאות באיחור`
                : `${healthSummary.dueSoonCount} משימות בריאות קרובות`}
            </RtlText>
            <RtlText style={styles.healthSummaryChevron}>‹</RtlText>
          </Pressable>
        ) : null}

        {activeSpontaneousWalkGroups.length > 0 ? (
          <View style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
            {activeSpontaneousWalkGroups.map(({ dogId, walks: spontaneousWalks }) => spontaneousWalks.length > 1 ? (
              <View key={`spontaneous-duplicate-${dogId}`} style={{ padding: 12, borderRadius: 12, backgroundColor: '#FFF4E5' }}>
                <RtlText style={{ fontWeight: '700', marginBottom: 6 }}>נמצאו {spontaneousWalks.length} רשומות של טיול ספונטני פעיל · נדרשת בדיקת מנהל/ת</RtlText>
                {spontaneousWalks.map((walk) => <RtlText key={walk.id} style={{ marginBottom: 4 }}>{walk.id} · {usersById[walk.responsibleUserId]?.name ?? 'בן משפחה'} · {walk.startedAt ?? walk.createdAt}</RtlText>)}
                <RtlText>לא ניתן להתחיל טיול נוסף לכלב זה עד לסיום או לפתרון הרשומות הכפולות.</RtlText>
              </View>
            ) : spontaneousWalks.map((spontaneous) => (
              <View key={spontaneous.id} style={{ padding: 12, borderRadius: 12, backgroundColor: '#F1F8F3' }}>
                <RtlText style={{ fontWeight: '700', marginBottom: 6 }}>
                  טיול ספונטני פעיל · {usersById[spontaneous.responsibleUserId]?.name ?? 'בן משפחה'}
                </RtlText>
                <RemoteGpsPanel
                  walk={spontaneous}
                  currentUserId={currentUserId}
                  familyRole={actualFamilyRole}
                  ready={!familyLoading && !scheduleLoading && Boolean(family)}
                />
                {(spontaneous.actualWalkerUserId ?? spontaneous.responsibleUserId) === currentUserId ? (
                  <Button label="סיים טיול" onPress={() => setCompleteWalkId(spontaneous.id)} style={{ marginTop: 8 }} />
                ) : null}
              </View>
            )))}
          </View>
        ) : null}

        <View ref={nextWalkCardRef} onLayout={measureNextWalkCard} collapsable={false} style={styles.nextWalkLift}>
          {nextWalk ? (
          <NextWalkCard
            walk={nextWalk}
            responsible={usersById[nextWalk.responsibleUserId]}
            currentUserId={effectiveUserId}
            dogName={dog?.name ?? 'הכלב/ה'}
            dogPhotoUrl={dog?.photoUrl}
            showDogPhoto={false}
            showMascot={false}
            dogSex={dog?.sex}
            scheduleTimezone={scheduleTimezone}
            requestStatusLine={
              computeWalkRequestStatusLine(nextWalk, swapRequests, timeChangeRequests, walksById, new Date(), effectiveUserId)?.text
            }
            primaryLabel={isOverdue(nextWalk, new Date(), scheduleTimezone) ? 'ממתין לעדכון' : undefined}
            tone="dashboard"
            remoteGpsAction={<RemoteGpsPanel walk={nextWalk} currentUserId={currentUserId} familyRole={actualFamilyRole} ready={!familyLoading && !scheduleLoading && Boolean(family)} />}
            onMarkDone={() => setCompleteWalkId(nextWalk.id)}
            activeStartedAt={isActiveWalk(nextWalk) ? nextWalk.startedAt ?? null : null}
            liveDistanceMeters={gpsTrackingWalkId === nextWalk.id ? gpsDistanceMeters : null}
            gpsPointCount={gpsTrackingWalkId === nextWalk.id ? gpsPointCount : null}
            liveRoutePoints={gpsTrackingWalkId === nextWalk.id ? gpsRoutePoints : undefined}
            gpsStatus={gpsTrackingWalkId === nextWalk.id ? gpsPermissionStatus : null}
            gpsTrackingStatus={gpsTrackingWalkId === nextWalk.id ? gpsTrackingStatus : null}
            onRetryGps={() => {
              if (gpsTrackingStatus === 'interrupted') {
                setGpsTransferWalk(nextWalk);
                return;
              }
              void useGpsStore.getState().startTracking(nextWalk).then(() => useGpsStore.getState().attachGpsOwnership(nextWalk)).catch(() => undefined);
            }}
            onStartWalk={() => {
              if (nextWalk.responsibleUserId === currentUserId) startWalkAs(nextWalk, currentUserId, false);
              else setStartWalkFlowId(nextWalk.id);
            }}
            startWalkDisabled={nextWalkStartGate.disabled}
            startWalkPending={startingWalkIds.includes(nextWalk.id)}
            startWalkAvailableLabel={nextWalkStartGate.label}
            onEndWalk={
              isActiveWalk(nextWalk) && (actualFamilyRole === 'admin' || nextWalk.actualWalkerUserId === currentUserId || (!nextWalk.actualWalkerUserId && nextWalk.responsibleUserId === currentUserId))
                ? () => setCompleteWalkId(nextWalk.id)
                : undefined
            }
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
            //
            // onEdit/onSwap below also require `nextWalk.status ===
            // 'pending'` — an admin editing/swapping a walk that's already
            // in_progress/done doesn't make sense.
            onEdit={effectiveRole === 'admin' && nextWalk.status === 'pending' ? () => setEditWalkId(nextWalk.id) : undefined}
            onSwap={effectiveRole === 'admin' && nextWalk.status === 'pending' ? () => setSwapWalkId(nextWalk.id) : undefined}
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
            <WalkieMascot state="ready" size={72} accessibilityLabel="Walkie Doggy מוכן לטיול" />
            <RtlText style={styles.onDemandTitle}>יוצאים לטיול?</RtlText>
            <RtlText style={styles.onDemandSubtitle}>לא חייבים לקבוע לו״ז מראש. אפשר להתחיל עכשיו ו-Walkie Doggy יתעד את הטיול וה-GPS.</RtlText>
            <Button label="התחל טיול" icon="▶" onPress={() => setAddUnplannedVisible(true)} style={styles.onDemandStartButton} shrinkToFit />
          </View>
        )}
        </View>


        {/* Real-device QA fix — an actionable swap/time-change request is
            urgent and must be visible the moment Home opens, without
            scrolling past lower-priority sections (last walk, add walk,
            the daily timeline, further upcoming walks) to find it. Moved
            directly under the next-walk hero, which is itself always the
            first thing on the Dashboard. PendingRequestsCard renders
            nothing (see its own `items.length === 0 -> return null`) when
            there is nothing actionable, so this never reserves empty
            space on an otherwise-quiet Home. */}
        <PendingRequestsCard
          items={actionablePendingRequests}
          usersById={usersById}
          walksById={walksById}
          dogName={dog?.name}
          onApproveSwap={approveSwap}
          onRejectSwap={rejectSwap}
          onApproveTimeChange={approveTimeChange}
          onRejectTimeChange={rejectTimeChange}
          onOpenInbox={openRequestsInbox}
        />

        {lastWalk ? (() => {
          const canEditLastWalk =
            lastWalkIsEditable &&
            (effectiveRole === 'admin' ||
              lastWalk.responsibleUserId === effectiveUserId ||
              (lastWalk.isUnplanned && lastWalk.completedByUserId === effectiveUserId));
          const completedByName =
            usersById[lastWalk.completedByUserId ?? lastWalk.responsibleUserId]?.name ?? 'בן משפחה';
          const actualCompletedTime = lastWalk.completedAt
            ? new Date(lastWalk.completedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
            : lastWalk.scheduledTime;
          return (
            <View style={styles.dashboardSection}>
              <View style={styles.dashboardExternalHeading}>
                <RtlText style={styles.dashboardExternalTitle}>הטיול האחרון</RtlText>
                <RtlText style={styles.dashboardLastWalkDate}>{resolvedWalkDateContextLabel(lastWalk)}</RtlText>
              </View>
              <View style={styles.dashboardLastWalk}>
                <View style={styles.dashboardLastWalkRow}>
                <View style={styles.dashboardLastWalkTimeBlock}>
                  <RtlText style={styles.dashboardLastWalkTime}>{actualCompletedTime}</RtlText>
                  <RtlText style={styles.dashboardLastWalkDone}>✓ בוצע {actualCompletedTime}</RtlText>
                </View>
                <View style={styles.dashboardLastWalkActions}>
                  {canEditLastWalk ? (
                    <Pressable
                      onPress={() => lastWalk.isUnplanned ? setEditingLastUnplannedWalkId(lastWalk.id) : setEditingLastDoneDetailsId(lastWalk.id)}
                      accessibilityRole="button"
                      accessibilityLabel="עריכת הטיול האחרון"
                      style={styles.dashboardLastWalkEdit}
                    >
                      <RtlText style={styles.dashboardLastWalkEditIcon}>✏️</RtlText>
                    </Pressable>
                  ) : null}
                  <View
                    ref={lastWalkMascotLaneRef}
                    onLayout={measureLastWalkMascotLane}
                    pointerEvents="none"
                    style={styles.dashboardLastWalkMascotLane}
                    testID="last-walk-mascot-lane"
                  />
                  {lastWalk.status !== 'skipped' ? (
                    <View style={styles.dashboardLastWalkNeeds}>
                      <Pressable
                        onPress={canEditLastWalk ? () => void editDoneDetails(lastWalk.id, { hadPee: !lastWalk.hadPee }) : undefined}
                        disabled={!canEditLastWalk}
                        hitSlop={6}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: !!lastWalk.hadPee, disabled: !canEditLastWalk }}
                        accessibilityLabel="סימון פיפי בטיול האחרון"
                        style={styles.dashboardLastWalkNeedButton}
                      >
                        <RtlText style={[styles.dashboardLastWalkNeed, !lastWalk.hadPee && styles.dashboardLastWalkNeedMuted]}>💧</RtlText>
                      </Pressable>
                      <Pressable
                        onPress={canEditLastWalk ? () => void editDoneDetails(lastWalk.id, { hadPoop: !lastWalk.hadPoop }) : undefined}
                        disabled={!canEditLastWalk}
                        hitSlop={6}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: !!lastWalk.hadPoop, disabled: !canEditLastWalk }}
                        accessibilityLabel="סימון קקי בטיול האחרון"
                        style={styles.dashboardLastWalkNeedButton}
                      >
                        <RtlText style={[styles.dashboardLastWalkNeed, !lastWalk.hadPoop && styles.dashboardLastWalkNeedMuted]}>💩</RtlText>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
                <View style={styles.dashboardLastWalkPerson}>
                  <RtlText style={styles.dashboardLastWalkPersonLabel}>בוצע ע״י</RtlText>
                  <RtlText style={styles.dashboardLastWalkPersonName}>{completedByName}</RtlText>
                </View>
              </View>
                {lastWalkGps ? (
                  <RtlText style={styles.dashboardLastWalkGps}>
                    {[
                      lastWalk.durationMinutes ? `${lastWalk.durationMinutes} דק׳` : null,
                      (lastWalkGps.correctedDistanceMeters ?? lastWalkGps.distanceMeters) != null
                        ? `${((lastWalkGps.correctedDistanceMeters ?? lastWalkGps.distanceMeters ?? 0) / 1000).toFixed(1)} ק״מ`
                        : null,
                    ].filter(Boolean).join(' · ')}
                  </RtlText>
                ) : null}
              </View>
            </View>
          );
        })() : null}

        <Pressable
          onPress={() => setAddUnplannedVisible(true)}
          style={styles.dashboardAddWalk}
          accessibilityRole="button"
          accessibilityLabel="הוסף טיול"
        >
          <RtlText style={styles.dashboardAddWalkIcon}>＋</RtlText>
          <View style={styles.dashboardAddWalkCopy}>
            <RtlText style={styles.dashboardAddWalkTitle}>הוסף טיול</RtlText>
            <RtlText style={styles.dashboardAddWalkSubtitle}>טיול ספונטני עכשיו או הזנת טיול שבוצע</RtlText>
          </View>
          <RtlText style={styles.dashboardAddWalkChevron}>⌄</RtlText>
        </Pressable>

        <View style={styles.dashboardSection}>
          <View style={styles.dashboardExternalHeading}>
            <RtlText style={styles.dashboardExternalTitle}>
              {dashboardTimelineWalks.length > 0
                ? `בהמשך היום · ${dashboardTimelineWalks.length === 1 ? 'טיול אחד' : `${dashboardTimelineWalks.length} טיולים`}`
                : 'בהמשך היום'}
            </RtlText>
            <RtlText style={styles.dashboardTimelineChevron}>‹</RtlText>
          </View>
          <Pressable style={styles.dashboardTimeline} onPress={() => navigation.navigate('Schedule')} accessibilityRole="button" accessibilityLabel="פתיחת המשך הטיולים של היום בלוח הזמנים">
          {dashboardTimelineWalks.length === 1 ? (
            <View style={styles.dashboardSingleUpcoming}>
              <Avatar emoji={usersById[dashboardTimelineWalks[0].responsibleUserId]?.avatar ?? '👤'} color={usersById[dashboardTimelineWalks[0].responsibleUserId]?.color ?? colors.primary} photoUrl={usersById[dashboardTimelineWalks[0].responsibleUserId]?.photoUrl} size={34} />
              <View style={styles.dashboardSingleUpcomingText}>
                <RtlText style={styles.dashboardSingleUpcomingTime}>{dashboardTimelineWalks[0].scheduledTime}</RtlText>
                <RtlText style={styles.dashboardSingleUpcomingName}>{usersById[dashboardTimelineWalks[0].responsibleUserId]?.name ?? 'בן משפחה'}</RtlText>
              </View>
              <RtlText style={styles.dashboardSingleUpcomingHint}>הטיול הבא היום</RtlText>
            </View>
          ) : dashboardTimelineWalks.length > 1 ? (
            <View style={styles.dashboardTimelineStops}>
              <View style={styles.dashboardTimelinePeople}>
                {dashboardTimelineWalks.map((walk) => (
                  <View key={walk.id} style={[styles.dashboardTimelineStop, walk.status === 'done' && styles.dashboardTimelineStopDone, walk.status === 'skipped' && styles.dashboardTimelineStopSkipped, isActiveWalk(walk) && styles.dashboardTimelineStopActive]}>
                    <Avatar emoji={usersById[walk.responsibleUserId]?.avatar ?? '👤'} color={usersById[walk.responsibleUserId]?.color ?? colors.primary} photoUrl={usersById[walk.responsibleUserId]?.photoUrl} size={22} />
                  </View>
                ))}
              </View>
              <View style={styles.dashboardTimelineTrack} pointerEvents="none">
                <View style={[styles.dashboardTimelineProgress, { width: `${dashboardTimelineProgress * 100}%` }]} />
                {dashboardTimelineWalks.map((walk) => <View key={`dot-${walk.id}`} style={[styles.dashboardTimelineDot, walk.status === 'done' && styles.dashboardTimelineDotDone, walk.status === 'skipped' && styles.dashboardTimelineDotSkipped, isActiveWalk(walk) && styles.dashboardTimelineDotActive]} />)}
              </View>
              <View style={styles.dashboardTimelineLabels}>
                {dashboardTimelineWalks.map((walk) => (
                  <View key={`label-${walk.id}`} style={styles.dashboardTimelineLabel}>
                    <RtlText style={[styles.dashboardTimelineTime, walk.status === 'done' && styles.dashboardTimelineTimeDone, walk.status === 'skipped' && styles.dashboardTimelineTimeSkipped, isActiveWalk(walk) && styles.dashboardTimelineTimeActive]}>{walk.status === 'done' ? `✓ ${walk.scheduledTime}` : walk.status === 'skipped' ? `– ${walk.scheduledTime}` : isActiveWalk(walk) ? `• ${walk.scheduledTime}` : walk.scheduledTime}</RtlText>
                    <RtlText style={styles.dashboardTimelineName} numberOfLines={1}>{usersById[walk.responsibleUserId]?.name ?? 'בן משפחה'}</RtlText>
                  </View>
                ))}
              </View>
            </View>
          ) : <RtlText style={styles.dashboardTimelineEmpty}>אין טיולים מתוכננים היום · לפתיחת לוח הזמנים</RtlText>}
          </Pressable>
        </View>

        <View style={styles.dashboardOverflow}>
        {/* Keep only unresolved overdue walks here. Future walks are already
            represented by the compact "בהמשך היום" timeline above; rendering
            them again as "טיולים קרובים" duplicated the same information and
            unnecessarily lengthened Home. */}
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

        </View>
      </ScrollView>

      <CompleteWalkModal
        visible={!!completeWalkId}
        dogName={dog?.name ?? 'הכלב/ה'}
        scheduledTime={completeWalkId ? walksById[completeWalkId]?.scheduledTime : undefined}
        users={completeWalkId && walksById[completeWalkId]?.status === 'in_progress'
          ? activeUsers.filter((u) => u.id === (walksById[completeWalkId]?.actualWalkerUserId ?? walksById[completeWalkId]?.responsibleUserId))
          : activeUsers}
        defaultUserId={completeWalkId && walksById[completeWalkId]?.status === 'in_progress'
          ? (walksById[completeWalkId]?.actualWalkerUserId ?? walksById[completeWalkId]?.responsibleUserId ?? effectiveUserId)
          : effectiveUserId}
        onConfirm={async ({ completedByUserId, hadPee, hadPoop, note, completedAt }) => {
          const walkId = completeWalkId;
          const walkBeingCompleted = walkId ? walksById[walkId] : undefined;
          setCompleteWalkId(null);
          if (!walkId) return;
          if (walkBeingCompleted?.status === 'in_progress' && completedByUserId !== currentUserId && actualFamilyRole === 'admin') {
            setRemoteFinishRequest({ walkId, walkerId: completedByUserId, hadPee, hadPoop, note: note || undefined, completedAt });
            return;
          }
          // markDone() itself refuses while Test Mode is active (see
          // scheduleStore.ts) — no separate guard needed here.
          const completed = walkBeingCompleted?.status === 'in_progress'
            ? await finishWalk(walkId, completedByUserId, { hadPee, hadPoop, note: note || undefined, completedAt, actorUserId: currentUserId })
            : await markDone(walkId, completedByUserId, { hadPee, hadPoop, note: note || undefined, completedAt });
          // BATCH 4 (C2/C3/C8) — success mascot + message, best-effort only:
          // if anything about the walk/dog/user lookups above is somehow
          // unavailable, selectMessage()'s own safe fallbacks (see
          // messageEngine.ts) still produce a grammatical message, and this
          // is purely cosmetic — never re-thrown, never blocks markDone's
          // own error handling.
          if (completed) {
            showWalkCompletionCelebration(walkBeingCompleted?.durationMinutes);
            checkForNewAchievementUnlocks();
          }
        }}
        onCancel={() => setCompleteWalkId(null)}
      />

      <ConfirmModal
        visible={Boolean(gpsTransferWalk)}
        title="להעביר את מעקב ה-GPS למכשיר הזה?"
        message="אם מכשיר אחר עדיין עוקב, הוא יפסיק לשלוח נקודות חדשות. ההעברה תירשם ביומן הטיול."
        confirmLabel="כן, להעביר מעקב"
        onCancel={() => setGpsTransferWalk(null)}
        onConfirm={() => {
          const walk = gpsTransferWalk;
          setGpsTransferWalk(null);
          if (walk) void useGpsStore.getState().startTracking(walk).then(() => useGpsStore.getState().attachGpsOwnership(walk, true)).catch(() => undefined);
        }}
      />

      <ConfirmModal
        visible={Boolean(remoteFinishRequest)}
        title={`לסיים את הטיול של ${usersById[remoteFinishRequest?.walkerId ?? '']?.name ?? 'בן המשפחה'}?`}
        message="אתה עומד לסיים את הטיול עבורו/ה. האם להמשיך?"
        confirmLabel="כן, לסיים את הטיול"
        onCancel={() => setRemoteFinishRequest(null)}
        onConfirm={() => {
          const request = remoteFinishRequest;
          setRemoteFinishRequest(null);
          if (request) void finishWalk(request.walkId, request.walkerId, {
            hadPee: request.hadPee,
            hadPoop: request.hadPoop,
            note: request.note,
            completedAt: request.completedAt,
            remoteConfirmation: true,
            actorUserId: currentUserId,
          });
        }}
      />

      <WalkStartFlowModal
        visible={Boolean(startWalkFlowId && startWalkFlowId === nextWalk?.id)}
        dogName={dog?.name ?? 'הכלב/ה'}
        assignedName={startWalkFlowId ? (usersById[walksById[startWalkFlowId]?.responsibleUserId ?? '']?.name ?? 'בן משפחה') : 'בן משפחה'}
        currentUserId={currentUserId}
        users={activeUsers}
        canStartRemotely={actualFamilyRole === 'admin'}
        onClose={() => setStartWalkFlowId(null)}
        onStart={(actualWalkerUserId, remote) => {
          const target = startWalkFlowId ? walksById[startWalkFlowId] : undefined;
          setStartWalkFlowId(null);
          if (target) startWalkAs(target, actualWalkerUserId, remote);
        }}
      />

      <WalkCompletionCelebration
        celebration={celebration}
        anchor={lastWalkMascotAnchor}
        onDismiss={() => {
          // A walk completion is one brief, self-closing moment. Do not
          // chain another mascot overlay from the dismiss action.
          setCelebration(null);
        }}
      />

      <ReminderMascotPrompt
        visible={!!reminderPromptMessage}
        message={reminderPromptMessage ?? ''}
        stage={reminderPromptStage}
        avoid={nextWalkCardRect}
        onDismiss={() => setReminderPrompt(null)}
      />
      {/* Mascot-notification-experiences round — a distinct, celebratory
          moment for an approved swap/time-change notification tap. Reuses
          the identical approved mascot component/identity, varied only by
          message + a fixed happy animationId (never filtered by
          `stage`, since this isn't a walk-reminder stage at all). */}
      <ReminderMascotPrompt
        visible={!!requestPromptMessage}
        message={requestPromptMessage ?? ''}
        animationId="high-five"
        avoid={nextWalkCardRect}
        onDismiss={() => setRequestPrompt(null)}
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
          if (sourceWalkId) await swapTwoWalks(sourceWalkId, otherWalkId, effectiveUserId);
        }}
        onClose={() => setSwapWalkId(null)}
      />

      <EditWalkModal
        visible={!!editingWalk}
        walk={editingWalk}
        users={activeUsers}
        otherPendingWalks={otherPendingWalks}
        occupiedTimes={walks.filter((w) => w.id !== editingWalk?.id && w.date === editingWalk?.date && w.status === 'pending').map((w) => w.scheduledTime)}
        onChangeTime={async (newTime) => {
          if (editingWalk) await rescheduleWalk(editingWalk.id, newTime);
          setEditWalkId(null);
        }}
        onChangeResponsible={async (newUserId) => {
          if (editingWalk) await swap(editingWalk.id, newUserId, currentUserId);
          // Keep the editor open so the same one-off edit can continue
          // (for example, change the responsible member and then the time).
        }}
        onSwapWithWalk={async (otherWalkId) => {
          if (editingWalk) await swapTwoWalks(editingWalk.id, otherWalkId, currentUserId);
          setEditWalkId(null);
        }}
        onRemoveRecurringRule={(() => {
          const entry = useScheduleStore.getState().entries.find((e) => e.id === editingWalk?.scheduleEntryId);
          const rule = entry && useScheduleStore.getState().rules.find((r) => r.id === entry.ruleId);
          return effectiveRole === 'admin' && rule ? async () => {
            await useScheduleStore.getState().deleteRule(rule.id);
            setEditWalkId(null);
          } : undefined;
        })()}
        onCancelWalk={async () => {
          if (editingWalk) await skip(editingWalk.id);
          setEditWalkId(null);
        }}
        onClose={() => setEditWalkId(null)}
      />

      <AddUnplannedWalkModal
        visible={addUnplannedVisible}
        dogName={dog?.name ?? 'הכלב/ה'}
        dogId={dog?.id}
        existingWalks={walks}
        users={activeUsers}
        defaultUserId={effectiveUserId}
        // A regular Member (real or admin-simulated) is always attributed
        // to themselves — only a real Admin may pick someone else
        // (requirement 5).
        canChooseUser={effectiveRole === 'admin'}
        startingNow={isStartingUnplannedWalk}
        onStartNow={async () => {
          if (!dog) {
            useScheduleStore.setState({ actionError: 'עדיין טוענים את פרטי הכלב/ה — נסו שוב בעוד רגע' });
            return;
          }
          const candidates = findSpontaneousAssociationCandidates(
            walks,
            dog.id,
            new Date(),
            family?.timezone,
            family?.spontaneousAssociationWindowMinutes ?? DEFAULT_SPONTANEOUS_ASSOCIATION_WINDOW_MINUTES,
          );
          if (candidates.length) {
            setSpontaneousAssociationWalks(candidates);
            setAddUnplannedVisible(false);
            setSpontaneousAssociationVisible(true);
            return;
          }
          const started = await startUnplannedWalk(familyId, dog.id, effectiveUserId);
          if (started) setAddUnplannedVisible(false);
        }}
        onConfirm={async (result: UnplannedWalkResult) => {
          // Keep the form visible until persistence succeeds. Closing it before
          // awaiting save made a successful tap look like "nothing happened"
          // and made failures impossible to correct without re-entering data.
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
            if (saved) {
              setAddUnplannedVisible(false);
              showWalkCompletionCelebration(result.durationMinutes);
              checkForNewAchievementUnlocks();
            }
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

      <SpontaneousWalkAssociationModal
        visible={spontaneousAssociationVisible}
        dogName={dog?.name ?? 'הכלב/ה'}
        candidates={spontaneousAssociationWalks}
        assigneeNames={Object.fromEntries(activeUsers.map((user) => [user.id, user.name]))}
        onAssociate={(walk) => {
          setSpontaneousAssociationVisible(false);
          setSpontaneousAssociationWalks([]);
          startWalkAs(walk, currentUserId, false);
        }}
        onSeparate={async () => {
          const started = dog ? await startUnplannedWalk(familyId, dog.id, currentUserId) : false;
          setSpontaneousAssociationVisible(false);
          setSpontaneousAssociationWalks([]);
          if (started) setAddUnplannedVisible(false);
        }}
        onCancel={() => {
          setSpontaneousAssociationVisible(false);
          setSpontaneousAssociationWalks([]);
          setAddUnplannedVisible(true);
        }}
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
        onDelete={
          effectiveRole === 'admin'
            ? async (walkId) => {
                setEditingLastUnplannedWalkId(null);
                await deleteUnplannedWalk(walkId);
              }
            : undefined
        }
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
        const canDeleteThisWalk = !!editingLastScheduledWalk && effectiveRole === 'admin';
        return (
          <EditDoneDetailsModal
            visible={!!editingLastDoneDetailsId}
            walk={editingLastScheduledWalk}
            users={activeUsers}
            canReassignCompletedBy
            currentUserId={effectiveUserId}
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
        healthReminders={healthReminders}
        dogName={dog?.name}
        onOpenHealthReminders={() => {
          setRequestsInboxVisible(false);
          requestOpenHealthModal();
          navigation.navigate('Settings');
        }}
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
      <DogProfileModal visible={dogProfileVisible} onClose={() => setDogProfileVisible(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  noDogTitle: { fontSize: 24, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginTop: spacing.sm },
  noDogSubtitle: { maxWidth: 360, fontSize: 15, fontWeight: '400', lineHeight: 22, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm, marginBottom: spacing.lg, paddingHorizontal: spacing.lg },
  onDemandTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginTop: 0 },
  onDemandSubtitle: { fontSize: 13, fontWeight: '400', lineHeight: 18, color: colors.textSecondary, textAlign: 'center', marginTop: 2, marginBottom: 8, paddingHorizontal: 12 },
  onDemandStartButton: { width: '100%', minHeight: 46, backgroundColor: '#12A5AB', borderColor: '#12A5AB' },
  container: { flex: 1, backgroundColor: '#FBF8F3' },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  addFirstDogButton: { marginTop: spacing.md },
  // Leaves the final card clear of the persistent bottom tab bar on phones
  // and in Safari/PWA, instead of letting it end underneath the navigation.
  content: { flexGrow: 1, paddingHorizontal: spacing.md, paddingTop: 0, gap: 7, paddingBottom: 96, width: '100%', backgroundColor: '#FBF8F3' },
  webContent: { maxWidth: breakpoints.desktopContent, alignSelf: 'center', paddingTop: 0, gap: 7 },
  emptyCard: { backgroundColor: colors.surface, borderRadius: radii.xl, borderWidth: 1, borderColor: colors.border, paddingVertical: 10, paddingHorizontal: 10 },
  // Item 6 (mobile polish): -42 (was -48) — the hero above is now 20px
  // shorter, so keeping the same -48 overlap would push this card up
  // further into the (shorter) hero than before; easing it to -42 nets a
  // modest ~14px higher start overall while keeping roughly the same
  // visual overlap relationship with the hero as before.
  nextWalkLift: { marginTop: -34, zIndex: 1, paddingHorizontal: spacing.xs },
  testModeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.statusOverdue,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  testModeBannerText: { flex: 1, color: colors.textInverse, fontWeight: '700', fontSize: typography.meta.fontSize, textAlign: 'right' },
  testModeBannerButton: { backgroundColor: '#ffffff33', borderRadius: radii.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  testModeBannerButtonText: { color: colors.textInverse, fontWeight: '700', fontSize: 12 },
  dashboardHeroShell: { marginHorizontal: -spacing.md, marginTop: Platform.OS === 'web' ? 'calc(-1 * env(safe-area-inset-top, 0px))' as any : -56, paddingTop: Platform.OS === 'web' ? 'env(safe-area-inset-top, 0px)' as any : 56, backgroundColor: '#F7F3E9', overflow: 'hidden' },
  dashboardHeroBackdrop: { ...StyleSheet.absoluteFill, bottom: 0 },
  topRow: { position: 'relative', minHeight: 54, alignItems: 'center', justifyContent: 'center' },
  // Item 6 (mobile polish): trimmed from 58/6 — a shorter header row so the
  // Dashboard's real content (Next Walk, timeline) starts higher on screen.
  dashboardTopRow: { minHeight: 48, paddingHorizontal: spacing.md, paddingTop: Platform.OS === 'web' ? 0 : 4, zIndex: 4 },
  brandWordmark: { width: 132, height: 42 },
  mascotHeaderButton: { position: 'absolute', left: spacing.md, top: 7, width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  dashboardHero: {
    width: '100%',
    // Item 6 (mobile polish): reduced from 176 — a shorter hero band so
    // less of the screen is spent before the Next Walk card. The dog
    // cutout/mascot below are shifted up by the SAME 20px delta (see their
    // own comments) so this crops only a little more off their bottom
    // (paws/tail), never their face/head — see docs/design/MASCOT_SPEC.md's
    // identity rules on what must stay recognizable in every frame.
    height: 148,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 34,
    // The scene is rendered once by dashboardHeroBackdrop across the entire top shell.
    // Keep the hero transparent so it cannot mask that full-bleed scene.
    backgroundColor: 'transparent',
    overflow: 'hidden',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
  },
  dashboardHeroImage: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  dashboardHeroFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 44, zIndex: 1 },
  dashboardHeroDefaultSun: { position: 'absolute', width: 86, height: 86, borderRadius: 43, right: 30, top: 18, backgroundColor: '#FFF1C7' },
  dashboardHeroDefaultHillBack: { position: 'absolute', width: 330, height: 150, borderRadius: 165, left: -95, bottom: -88, backgroundColor: '#E8F1DF' },
  dashboardHeroDefaultHillFront: { position: 'absolute', width: 320, height: 142, borderRadius: 160, right: -98, bottom: -94, backgroundColor: '#DCEAD7' },
  dashboardHeroDefaultGround: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 32, backgroundColor: '#F2E4C9' },
  dashboardHeroBloomOne: { position: 'absolute', width: 270, height: 270, borderRadius: 135, left: -112, bottom: -174, backgroundColor: '#E8F3E8' },
  dashboardHeroBloomTwo: { position: 'absolute', width: 250, height: 250, borderRadius: 125, right: -104, top: -132, backgroundColor: '#DDEFE8' },
  dashboardHeroGlow: { position: 'absolute', width: 260, height: 92, borderRadius: 130, left: 24, bottom: 16, backgroundColor: '#FFFDF2A8', transform: [{ rotate: '-8deg' }] },
  dashboardHeroShade: { ...StyleSheet.absoluteFill, backgroundColor: '#FFFFFF22' },
  dashboardHeroGreeting: { position: 'absolute', top: 10, left: spacing.md, right: '42%', alignItems: 'flex-end', zIndex: 2, backgroundColor: '#FFFDF0CC', borderRadius: 14, paddingHorizontal: 8, paddingVertical: 5 },
  dashboardHeroGreetingTitle: { width: '100%', flexShrink: 1, fontSize: 21, lineHeight: 26, color: '#142B50', fontWeight: '900', textAlign: 'right' },
  dashboardHeroGreetingSubtitle: { width: '100%', marginTop: 2, fontSize: 12, lineHeight: 17, color: '#344A62', fontWeight: '700', textAlign: 'right' },
  // bottom offsets shifted up by 20 (the dashboardHero height reduction)
  // so each image's TOP edge — where the mascot/dog's face/head sits —
  // renders at the exact same position as before; only extra bottom
  // (paws/tail) bleed is newly clipped by the shorter frame.
  // The approved raster ends in a flat opaque baseline. Sink it just below the
  // clipped hero edge so that edge cannot read as a white strip over the scene.
  dashboardHeroMascot: { position: 'absolute', right: 4, bottom: -14, zIndex: 2 },
  // Preserve the hero mascot's mounted layout slot during a completion moment,
  // but make only its pixels disappear so there is never a second mascot.
  dashboardHeroMascotCelebrating: { opacity: 0 },
  // During a completion celebration the dedicated celebration mascot is the
  // single mascot on Home. Keep other mascot slots mounted to avoid layout jumps.
  homeMascotSuppressed: { opacity: 0 },
  dashboardHeroForeground: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 52, zIndex: 3, overflow: 'hidden' },
  dashboardHeroForegroundLeft: { position: 'absolute', left: -22, bottom: -23, width: 126, height: 52, borderRadius: 63, backgroundColor: '#C5E2B7', opacity: 0.72, transform: [{ rotate: '-4deg' }] },
  dashboardHeroForegroundMid: { position: 'absolute', right: 118, bottom: -31, width: 106, height: 48, borderRadius: 53, backgroundColor: '#D6EBC8', opacity: 0.78, transform: [{ rotate: '5deg' }] },
  dashboardHeroForegroundDogBase: { position: 'absolute', right: -2, bottom: -25, width: 182, height: 58, borderRadius: 91, backgroundColor: '#D1E8C4', opacity: 0.94, transform: [{ rotate: '-2deg' }] },
  dashboardHeroForegroundRight: { position: 'absolute', right: -42, bottom: -17, width: 104, height: 46, borderRadius: 52, backgroundColor: '#BFDDB1', opacity: 0.86, transform: [{ rotate: '7deg' }] },
  dashboardHeroDogCutout: { position: 'absolute', right: 4, bottom: 2, width: 166, height: 158, zIndex: 2 },
  dashboardHeroCopy: { width: '52%', alignItems: 'flex-end', alignSelf: 'flex-start', paddingTop: 38, paddingHorizontal: spacing.md, zIndex: 2 },
  dashboardHeroEyebrow: { fontSize: 16, color: '#27376F', fontWeight: '700', textAlign: 'right' },
  dashboardHeroName: { fontSize: 30, lineHeight: 36, color: '#16245B', fontWeight: '900', textAlign: 'right' },
  dashboardAddWalk: { minHeight: 46, borderRadius: 22, backgroundColor: '#F0FAF8', borderWidth: 1, borderColor: '#D5EEE9', paddingHorizontal: spacing.md, flexDirection: 'row-reverse', alignItems: 'center', gap: spacing.sm },
  dashboardAddWalkIcon: { width: 34, height: 34, borderRadius: 17, textAlign: 'center', lineHeight: 34, fontSize: 25, fontWeight: '500', color: '#FFFFFF', backgroundColor: '#12A5AB' },
  dashboardAddWalkCopy: { flex: 1, alignItems: 'flex-end' },
  dashboardAddWalkTitle: { fontSize: 17, lineHeight: 21, fontWeight: '700', color: '#0E7E84', textAlign: 'right' },
  dashboardAddWalkSubtitle: { marginTop: 1, fontSize: 11, lineHeight: 15, fontWeight: '500', color: colors.textSecondary, textAlign: 'right' },
  dashboardAddWalkChevron: { fontSize: 22, color: '#0E7E84' },
  dashboardSection: { gap: 3 },
  dashboardExternalHeading: { minHeight: 24, paddingHorizontal: 4, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  dashboardExternalTitle: { fontSize: 17, fontWeight: '800', color: '#17345B', textAlign: 'right' },
  dashboardLastWalk: { minHeight: 76, borderRadius: 24, backgroundColor: '#F4FAFD', borderWidth: 1, borderColor: '#DCECF2', paddingHorizontal: spacing.md, paddingVertical: 5, shadowColor: '#6A5D45', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  dashboardLastWalkHeader: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  dashboardLastWalkTitle: { fontSize: 17, fontWeight: '700', color: '#17345B', textAlign: 'right' },
  dashboardLastWalkDate: { fontSize: 11, fontWeight: '500', color: colors.textSecondary },
  dashboardLastWalkRow: { flexDirection: 'row', ...nativeDirection('ltr'), alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  dashboardLastWalkTimeBlock: { width: 104, alignItems: 'flex-start', flexShrink: 0 },
  dashboardLastWalkTime: { fontSize: 24, lineHeight: 29, fontWeight: '700', color: '#17345B' },
  dashboardLastWalkDone: { marginTop: 1, fontSize: 12, lineHeight: 16, fontWeight: '600', color: '#15966D' },
  // Fixed physical lanes. Do not let RTL/flex negotiation move the relief
  // controls outside the compact iPhone card: edit is pinned left, pee/poop
  // pinned right, and the mascot anchor occupies only the centre.
  dashboardLastWalkActions: { position: 'relative', flex: 1, minWidth: 108, height: 52 },
  dashboardLastWalkEdit: { position: 'absolute', left: 0, top: 4, alignItems: 'center', justifyContent: 'center', width: 30, height: 44 },
  dashboardLastWalkMascotLane: { position: 'absolute', left: 32, right: 56, top: 0, height: 52 },
  dashboardLastWalkNeeds: { position: 'absolute', right: 0, top: 4, width: 54, height: 44, flexDirection: 'row', ...nativeDirection('ltr'), alignItems: 'center', justifyContent: 'space-between' },
  dashboardLastWalkNeedButton: { width: 26, height: 44, alignItems: 'center', justifyContent: 'center' },
  dashboardLastWalkEditIcon: { fontSize: 17, color: '#E6B422' },
  dashboardLastWalkEditText: { fontSize: 11, fontWeight: '600', color: '#17345B' },
  dashboardLastWalkNeed: { fontSize: 18 },
  dashboardLastWalkNeedMuted: { opacity: 0.28 },
  dashboardLastWalkPerson: { width: 86, alignItems: 'flex-end', flexShrink: 0 },
  dashboardLastWalkPersonLabel: { fontSize: 10, fontWeight: '500', color: colors.textSecondary, textAlign: 'right' },
  dashboardLastWalkPersonName: { marginTop: 1, fontSize: 15, fontWeight: '700', color: '#17345B', textAlign: 'right' },
  dashboardLastWalkGps: { marginTop: 5, fontSize: 10, fontWeight: '600', color: '#2F7F75', textAlign: 'left' },
  dashboardTimeline: { minHeight: 52, borderRadius: 22, backgroundColor: '#F5F9FC', borderWidth: 1, borderColor: '#DCECF2', paddingHorizontal: spacing.md, paddingTop: 6, paddingBottom: 4, gap: 2 },
  dashboardTimelineHeader: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  dashboardTimelineTitle: { fontSize: 16, fontWeight: '700', color: '#17345B', textAlign: 'right' },
  dashboardTimelineChevron: { fontSize: 24, color: '#129EA5', writingDirection: 'ltr' },
  dashboardSingleUpcoming: { minHeight: 46, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 2 },
  dashboardSingleUpcomingText: { alignItems: 'flex-end', minWidth: 54 },
  dashboardSingleUpcomingTime: { fontSize: 17, fontWeight: '800', color: '#17345B' },
  dashboardSingleUpcomingName: { fontSize: 11, fontWeight: '600', color: colors.textSecondary },
  dashboardSingleUpcomingHint: { fontSize: 11, fontWeight: '600', color: '#129EA5', marginRight: 8 },
  dashboardTimelineStops: { position: 'relative', gap: 2, paddingTop: 0 },
  dashboardTimelinePeople: { flexDirection: 'row-reverse', justifyContent: 'space-around', marginBottom: 0 },
  dashboardTimelineStop: { flex: 1, alignItems: 'center' },
  dashboardTimelineStopDone: { opacity: 0.72 },
  dashboardTimelineStopSkipped: { opacity: 0.48 },
  dashboardTimelineStopActive: { transform: [{ scale: 1.06 }] },
  dashboardTimelineTrack: { height: 2, marginHorizontal: '8%', borderRadius: 1, backgroundColor: '#D4D4CF', overflow: 'visible', flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  dashboardTimelineProgress: { position: 'absolute', right: 0, top: 0, bottom: 0, borderRadius: 1, backgroundColor: '#12A5AB' },
  dashboardTimelineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#12A5AB', zIndex: 1 },
  dashboardTimelineDotDone: { backgroundColor: colors.success, borderColor: colors.success },
  dashboardTimelineDotSkipped: { backgroundColor: colors.statusPendingBg, borderColor: colors.statusPending },
  dashboardTimelineDotActive: { backgroundColor: colors.info, borderColor: colors.info },
  dashboardTimelineLabels: { flexDirection: 'row-reverse', justifyContent: 'space-around', marginTop: 2 },
  dashboardTimelineLabel: { flex: 1, alignItems: 'center', minWidth: 0 },
  dashboardTimelineTime: { fontSize: 12, fontWeight: '700', color: '#17345B' },
  dashboardTimelineTimeDone: { color: colors.success },
  dashboardTimelineTimeSkipped: { color: colors.textSecondary, textDecorationLine: 'line-through' },
  dashboardTimelineTimeActive: { color: colors.info },
  dashboardTimelineName: { fontSize: 10, fontWeight: '500', color: colors.textSecondary, maxWidth: 72, textAlign: 'center' },
  dashboardTimelineEmpty: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, textAlign: 'right', paddingBottom: 2 },
  // Real-device QA fix: this used to be `{ display: 'none' }`, unconditionally
  // hiding everything inside it — including "ממתינים לעדכון" (overdue walks)
  // and "טיולים קרובים" (further upcoming walks), neither of which is shown
  // anywhere else on Home. See the JSX comment at this wrapper's usage.
  dashboardOverflow: {},
  notificationButton: { position: 'absolute', right: spacing.md, top: 7, width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  notificationIcon: { fontSize: 18 },
  requestsCountBadge: { minWidth: spacing.xl, height: spacing.xl, borderRadius: radii.sm, paddingHorizontal: spacing.xs, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryDark },
  requestsCountText: { fontSize: 11, fontWeight: '800', color: colors.textInverse },
  healthSummaryPill: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-end',
    marginTop: spacing.sm,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.round,
    backgroundColor: colors.statusCurrentBg,
  },
  dashboardShortcutAdd: {
    backgroundColor: '#E9E1F5',
  },
  healthSummaryPillOverdue: { backgroundColor: colors.statusOverdueBg },
  healthSummaryIcon: { fontSize: 14 },
  healthSummaryText: { ...typography.meta, fontSize: 12, fontWeight: '700', color: colors.textPrimary },
  healthSummaryChevron: { fontSize: 14, color: colors.textSecondary, writingDirection: 'ltr' },
  section: { gap: spacing.sm },
  sectionTitlePhysicalRight: {
    width: '100%',
    ...nativeDirection('ltr'),
    alignItems: 'flex-end',
  },
  upcomingHeader: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  showMoreLink: { fontSize: 15, fontWeight: '800', color: colors.primary, writingDirection: 'rtl' },
  sectionTitle: {
    alignSelf: 'flex-end',
    ...typography.sectionTitle,
    color: colors.textPrimary,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  list: { gap: spacing.sm },

lastWalkCard: {
  backgroundColor: '#FFF7E8',
  borderRadius: radii.lg,
  borderWidth: 1,
  borderColor: colors.border,
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.md,
  minHeight: 126,
},

lastWalkDetails: {
  borderTopWidth: 1,
  borderTopColor: colors.border,
  marginTop: spacing.sm,
  paddingTop: spacing.sm,
  gap: spacing.sm,
},
lastWalkDetailChips: {
  flexDirection: 'row-reverse',
  flexWrap: 'wrap',
  gap: spacing.sm,
},
lastWalkDetailChip: {
  minHeight: 30,
  paddingHorizontal: spacing.sm,
  borderRadius: radii.md,
  backgroundColor: colors.surface,
  alignItems: 'center',
  justifyContent: 'center',
},
lastWalkDetailChipText: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
lastWalkNote: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.sm, gap: 2 },
lastWalkNoteLabel: { fontSize: 11, fontWeight: '600', color: colors.textSecondary, textAlign: 'right' },
lastWalkNoteText: { fontSize: 13, color: colors.textPrimary, textAlign: 'right', lineHeight: 19 },

lastWalkTopRow: {
  flexDirection: 'row',
  ...nativeDirection('ltr'),
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
  fontWeight: '700',
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
  fontWeight: '600',
  color: '#2F9B72',
},

lastWalkSkippedBadge: {
  marginTop: 2,
  fontSize: 12,
  fontWeight: '700',
  color: colors.statusSkipped,
},

lastWalkActions: {
  width: 174,
  flexDirection: 'row',
  ...nativeDirection('ltr'),
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
  ...nativeDirection('ltr'),
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
  fontWeight: '700',
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
