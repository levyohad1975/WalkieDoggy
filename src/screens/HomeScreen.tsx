Warning: truncated output (original token count: 27380)
Total output lines: 2077

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Image, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { RtlText } from '../components/RtlText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useFamilyStore } from '../store/familyStore';
import { useScheduleStore } from '../store/scheduleStore';
import { useAuthStore, useEffectiveFamilyRole, useEffectiveUserId } from '../store/authStore';
import { computeLastWalk, computeNextWalk, dailyWalkTimeline, isOverdue, upcomingWalks } from '../logic/nextWalk';
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
import { requestForegroundGpsPermission } from '../lib/gpsTracking';
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
  const [heroPhotoFailed, setHeroPhotoFailed] = useState(false);
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
    setHeroPhotoFailed(false);
    setHeroCutoutFailed(false);
  }, [dog?.id, dog?.photoUrl, dog?.photoCutoutUrl]);
  const showPersonalHero = Boolean(dog?.photoUrl) && !heroPhotoFailed;
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
  const gpsSessionsByWalkId = useGpsStore((s) => s.sessionsByWalkId);

  const [completeWalkId, setCompleteWalkId] = useState<string | null>(null);
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
    // run before…19380 tokens truncated… their
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
  dashboardHeroImage: { ...StyleSheet.absoluteFill, width: undefined, height: undefined },
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
  dashboardHeroMascot: { position: 'absolute', right: 4, bottom: 2, zIndex: 2 },
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
  dashboardHeroDogPhoto: { position: 'absolute', right: 4, bottom: -36, width: 136, height: 136, borderRadius: 22, zIndex: 2 },
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
