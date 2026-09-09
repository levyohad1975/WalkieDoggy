import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from './src/store/authStore';
import { useSystemAdminStore } from './src/store/systemAdminStore';
import { RootNavigator } from './src/navigation/RootNavigator';
import { LoginScreen } from './src/screens/LoginScreen';
import { FamilyOnboardingScreen } from './src/screens/FamilyOnboardingScreen';
import { SystemAdminScreen } from './src/screens/SystemAdminScreen';
import { RtlText } from './src/components/RtlText';
import { colors } from './src/theme/colors';
import { requestNotificationPermissions } from './src/notifications/notificationService';
import { registerPushToken } from './src/lib/pushTokens';
import { repository, setSyncQueueActorGetter } from './src/data';
import { isSupabaseConfigured } from './src/lib/supabase';
import { touchLastSeen } from './src/lib/requests';
import { useRequestsStore } from './src/store/requestsStore';
import { useScheduleStore, reconcileScheduleNotifications } from './src/store/scheduleStore';

// Reconciles local notifications against the currently loaded schedule store
// state (A3's authoritative rule: notification content always comes from the
// current persisted walk occurrence). Best-effort/no-op if nothing has been
// loaded into the schedule store yet.
function reconcileNotificationsNow() {
  const { walks } = useScheduleStore.getState();
  const familyId = useAuthStore.getState().familyId;
  if (!familyId || walks.length === 0) return;
  void reconcileScheduleNotifications(familyId, walks).catch(() => undefined);
}

// BUG 1 FIX (foreground/cold-start orchestration), upgraded to a
// shared-promise guard: prevents two overlapping runs of
// runForegroundSync() (e.g. an AppState 'change' event firing again — some
// platforms fire it more than once per actual foreground transition — or
// performColdStart()'s own call racing an early foreground event) from
// starting a duplicate sync pipeline. A plain boolean guard (the original
// fix) would make the second caller an immediate no-op with no way to know
// when the in-flight run actually finishes — fine for the AppState listener
// (a fire-and-forget `void runForegroundSync()`), but wrong for a caller
// like performColdStart() that awaits runForegroundSync() as its own final
// step and needs "resolved" to genuinely mean "sync completed". Holding the
// in-flight run's own Promise here instead lets a concurrent caller await
// that same promise and be released only when the real orchestration
// finishes — same de-duplication as the boolean, but no caller is ever left
// unable to tell whether a sync it needs actually completed.
let foregroundSyncPromise: Promise<void> | null = null;

/**
 * The single, ordered "the app is now in front of a real user, with a claimed
 * profile" sync sequence — run once after cold-start's restoreSession()
 * resolves, and again on every AppState 'active' transition (see App()'s
 * effect below). Both call sites funnel through here so there is exactly one
 * place this ordering is defined.
 *
 * ORDER MATTERS (round-6 fix — see the final report's Device-B scenario):
 *   1. repository.trySync() — push this device's own queued writes first,
 *      so step 2's reload can see them reflected server-side too (and so a
 *      later step doesn't reconcile notifications against walks this device
 *      itself hasn't finished pushing yet).
 *   2. useScheduleStore.load(familyId) — reload walks/entries/rules from the
 *      authoritative repository. This is the fix for "Device B foregrounds
 *      and still shows a walk Device A already marked done": previously
 *      nothing on foreground ever reloaded the schedule store at all, so it
 *      kept showing whatever was last loaded (possibly hours stale), and
 *      Next Walk never advanced either.
 *   3. requestsStore.load() — reload swap/time-change requests, so one
 *      created on another device while this one was backgrounded shows up.
 *   4. reconcileNotificationsNow() — MUST run after step 2, not before: it
 *      reconciles against whatever useScheduleStore.getState().walks
 *      currently holds, and reconciling against pre-reload (stale) walks is
 *      exactly what let an orphaned/incorrect local notification survive a
 *      foreground transition. Step 2's load() reports success/failure via
 *      its resolved boolean (round-6 fix #2): if it FAILED, `walks` still
 *      holds stale leftovers (load() deliberately never clears them), so
 *      this step is SKIPPED entirely for this pass rather than reconciling
 *      against known-stale data — it will run correctly on the next
 *      foreground transition or pull-to-refresh once load() succeeds.
 *      Step 3 (requests) still runs regardless of step 2's outcome —
 *      requests/presence are independent subsystems with their own
 *      independent error handling, so a schedule failure alone must not
 *      block them.
 *   5. touchLastSeen() + revalidateClaim() — cheap presence/claim
 *      housekeeping; deliberately last, since neither affects what's shown
 *      on screen the way 1-4 do.
 *
 * A no-op (returns immediately, before touching anything) when there is no
 * claimed family/profile yet (LoginScreen/FamilyOnboardingScreen) — there is
 * nothing to sync/reload until both exist.
 */
export function runForegroundSync(): Promise<void> {
  if (foregroundSyncPromise) return foregroundSyncPromise;
  foregroundSyncPromise = (async () => {
    try {
      await runForegroundSyncOnce();
    } finally {
      foregroundSyncPromise = null;
    }
  })();
  return foregroundSyncPromise;
}

async function runForegroundSyncOnce(): Promise<void> {
  const { familyId, currentUserId } = useAuthStore.getState();
  if (!familyId || !currentUserId) return;

  // 1. Push this device's own queued writes.
  await repository.trySync?.().catch(() => undefined);

  // 2. Reload the authoritative schedule/walks — see doc comment above.
  //    load() now resolves false (and leaves `error` set + `walks`
  //    untouched) rather than throwing when the reload fails, so we can
  //    tell fresh data from stale leftovers before deciding whether to
  //    reconcile notifications against them.
  const scheduleLoadedFresh = await useScheduleStore.getState().load(familyId);

  // 3. Reload requests (Supabase mode only — see requestsStore.ts).
  //    DESIGN DECISION: this runs regardless of step 2's outcome. Requests
  //    and schedule/walks are independent subsystems with their own
  //    independent failure handling (requestsStore.load() already sets its
  //    own `error` on failure) — a schedule reload failure has no bearing
  //    on whether requests data is safe to refresh, so it must not block it.
  if (isSupabaseConfigured) {
    await useRequestsStore.getState().load();
  }

  // 4. Reconcile notifications from the FRESH walks just loaded in step 2
  //    — but ONLY if step 2 actually succeeded. If it failed, `walks` in
  //    the store is stale leftover data from before this foreground pass,
  //    and reconciling against it would defeat the very guarantee this
  //    ordering exists to provide. Skip it entirely for this pass; the
  //    next successful foreground transition or pull-to-refresh will
  //    reconcile against genuinely fresh data instead.
  if (scheduleLoadedFresh) {
    reconcileNotificationsNow();
  }

  // 5. Presence + claim housekeeping.
  await touchLastSeen().catch(() => undefined);
  await useAuthStore.getState().revalidateClaim();
}

/**
 * BUG 2 FIX (cold-start sync race): the exact "device just started up" call
 * order — restoreSession() awaited to COMPLETION first, then the same
 * ordered runForegroundSync() sequence every later foreground transition
 * uses. Extracted to a standalone, exported function (rather than an inline
 * closure inside App()'s effect) specifically so this ordering is directly
 * unit-testable without rendering the React component tree — see
 * App.test.ts's "cold-start sync race" tests.
 */
export async function performColdStart(restoreSession: () => Promise<void>): Promise<void> {
  await restoreSession();
  await runForegroundSync();
}

/**
 * BATCH 2 REVIEW CORRECTION (native cold-start registration race):
 *
 * PROBLEM: registerPushToken() runs fire-and-forget from its own effect
 * below, fully independent of performColdStart()/runForegroundSync(). On a
 * fresh native launch there is no ordering guarantee between the two: the
 * cold-start reconciliation pass (runForegroundSync() step 4, via
 * reconcileNotificationsNow()) can run and schedule local walk reminders
 * BEFORE registerPushToken() resolves — at that moment
 * getExpoPushTokenIfKnown() (src/lib/pushTokens.ts) is still null, so
 * hasActiveRemoteReminderChannel() correctly (and necessarily) falls back to
 * local scheduling, since this device's remote reachability genuinely isn't
 * known yet. Once registerPushToken() later succeeds, this device DOES have
 * an active server-reachable channel — but nothing re-ran reconciliation to
 * cancel the local reminders scheduled moments earlier, so both a server
 * push and a stale local notification can fire for the same walk.
 *
 * FIX: registerPushToken()'s own effect now awaits it and then re-runs the
 * exact same reconciliation pass used everywhere else
 * (reconcileNotificationsNow() — already defined above, already the single
 * place that re-derives the channel gate fresh via
 * hasActiveRemoteReminderChannel() and cancels/reschedules local reminders
 * accordingly). This is intentionally the SMALLEST fix: no new plumbing, no
 * boolean success/failure signal threaded out of registerPushToken() (a
 * reconciliation pass that finds nothing changed, or finds the schedule
 * store not loaded yet, is already a correct, cheap no-op — see
 * reconcileNotificationsNow()'s own doc comment above), and no change to
 * pushTokens.ts/remoteReminderChannel.ts/scheduleStore.ts at all. Extracted
 * to a standalone, exported function for the same testability reason as
 * performColdStart() above — see App.test.ts's "native registration race"
 * tests.
 *
 * Ordering after this fix, for every interleaving:
 *   - registerPushToken() resolves BEFORE the schedule store has any walks
 *     loaded yet (fires very early in a cold start): this call's
 *     reconcileNotificationsNow() is a no-op (nothing loaded), but the
 *     token is already known by the time runForegroundSync()'s own
 *     reconciliation (step 4) runs later in the same cold start — so THAT
 *     pass sees the up-to-date channel and never schedules a
 *     now-redundant local reminder in the first place.
 *   - registerPushToken() resolves AFTER runForegroundSync() has already
 *     reconciled once (the exact race described above): this call's
 *     reconcileNotificationsNow() runs again, now with the token known,
 *     and cancels whichever local reminders the earlier pass scheduled
 *     under "no channel known yet".
 *   - registerPushToken() fails, no-ops (Expo Go), or this device never
 *     gets a token at all: getExpoPushTokenIfKnown() stays null,
 *     hasActiveRemoteReminderChannel() keeps returning false, and this
 *     extra reconciliation pass is a correct no-op — the local fallback
 *     is never weakened.
 * In every case, the LAST reconciliation pass to actually run always sees
 * this device's current, real channel state — never a stale one.
 */
export async function registerPushTokenAndReconcile(): Promise<void> {
  await registerPushToken();
  reconcileNotificationsNow();
}

// Wires the offline SyncQueue to "whose profile is currently claimed on this
// device" — module scope, once, so every enqueue() from here on is tagged
// with the right owner (see syncQueue.ts's setSyncQueueActorGetter doc
// comment and authStore.signIn()'s pending-queue guard for why this matters:
// it's what stops a profile switch on a shared device from letting another
// member's queued offline action get audited under the WRONG member once it
// finally reaches Supabase). Deliberately not a static import cycle —
// App.tsx already imports both authStore and the data layer, so it's the
// natural place to introduce this one-directional wiring.
setSyncQueueActorGetter(() => useAuthStore.getState().currentUserId);

export default function App() {
  const { currentUserId, familyId, hydrated, restoreSession } = useAuthStore();
  // In Supabase (backend) mode, a device with no familyId yet hasn't
  // created/joined a family — show that onboarding before anything else.
  // Local/demo mode always has a familyId (the seeded demo family) and
  // never reaches this branch.
  const needsFamilyOnboarding = isSupabaseConfigured && !familyId;

  // BATCH 4 (item A — System Admin V1): "System Admin is a platform
  // identity, NOT automatically a Family Admin/member" (the brief's own
  // words) — so this check, and the entry point it gates, is deliberately
  // rendered OUTSIDE the needsFamilyOnboarding/currentUserId/LoginScreen
  // branching above: a system admin with no family yet (or no claimed
  // family persona on this device) must still be able to reach
  // "🛡️ ניהול מערכת". am_i_system_admin() only needs an authenticated
  // Supabase session (restoreSession() above already guarantees the
  // anonymous session exists once `hydrated` is true — see
  // ensureAnonymousSession()'s call site in authStore.ts) — never a
  // familyId or currentUserId. This never sets/reads familyId itself, so it
  // cannot affect which family this device is a member of.
  const isSystemAdmin = useSystemAdminStore((s) => s.isSystemAdmin);
  const refreshSystemAdmin = useSystemAdminStore((s) => s.refresh);
  const [systemAdminOpen, setSystemAdminOpen] = useState(false);
  useEffect(() => {
    if (hydrated) void refreshSystemAdmin();
  }, [hydrated, refreshSystemAdmin]);

  // Section 10: remote request-push token registration — completely
  // separate from requestNotificationPermissions() below (that's the
  // LOCAL scheduled-walk-reminder permission flow / Android
  // "walk-reminders" channel, untouched). Only meaningful once a real
  // profile is claimed (currentUserId set) since a token is stored
  // per-user. registerPushToken() is fully self-guarded (try/catch,
  // feature-detects device/permission availability) so this can never
  // crash or block sign-in/navigation.
  //
  // Batch 2 review correction (native cold-start registration race): calls
  // registerPushTokenAndReconcile() rather than registerPushToken()
  // directly — see that function's doc comment above for the race this
  // closes (a local reminder scheduled before this device's remote channel
  // was known could otherwise survive, undeleted, once registration
  // completed).
  useEffect(() => {
    if (currentUserId) {
      void registerPushTokenAndReconcile();
    }
  }, [currentUserId]);

  useEffect(() => {
    // BUG 2 FIX (cold-start sync race): restoreSession() is now fully
    // AWAITED — including its own claim re-validation (see
    // authStore.ts's checkClaimStillValid doc comment) — before this device
    // does ANY sync/reload. Previously trySync() ran fire-and-forget
    // alongside restoreSession() rather than after it, so it could (and, on
    // a cold start with a queued offline write, reliably would) run while
    // useAuthStore.getState().currentUserId was still null/stale — and
    // SyncQueue.flush()'s ownership check (see its doc comment) correctly
    // refuses to replay an item under "no profile claimed yet", so that
    // write was silently skipped with no guaranteed retry until the NEXT
    // foreground transition. performColdStart() (above) awaits
    // restoreSession() first, then runs the same ordered sync/reload
    // sequence used on every later foreground transition — the first sync
    // attempt after a cold start always sees the real, restored (and
    // claim-validated) profile.
    void performColdStart(restoreSession);

    // Independent of session restore — never blocks/blocked by it.
    requestNotificationPermissions().catch(() => undefined);

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        // MULTI-DEVICE VISIBILITY (requirement: "when the admin/member
        // returns to the app from background/foreground, reload relevant
        // state so changes made on another device are not silently
        // missed") — see runForegroundSync()'s doc comment for the full
        // ordering rationale (schedule/walks, then requests, then
        // notification reconciliation against the FRESH walks, then
        // presence/claim housekeeping). Deliberately foreground-only, not a
        // poll timer — realtime/push are the better fit for "notify even
        // while the app isn't open" and remain out of scope for this round.
        void runForegroundSync();
      }
    });
    return () => sub.remove();
  }, [restoreSession]);

  // SafeAreaProvider must wrap every branch — SafeAreaView (and any screen
  // using useSafeAreaInsets) throws if it renders before a provider ancestor
  // exists, and `hydrated` is false on every cold start until the async
  // session restore resolves.
  return (
    <SafeAreaProvider>
      {!hydrated ? (
        <SafeAreaView style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </SafeAreaView>
      ) : (
        <>
          <StatusBar style="dark" />
          {needsFamilyOnboarding ? (
            <FamilyOnboardingScreen />
          ) : currentUserId ? (
            <RootNavigator />
          ) : (
            <LoginScreen />
          )}

          {/* BATCH 4 (item A) — see the isSystemAdmin comment above for why
              this sits outside every other branch. A small, unobtrusive
              corner entry point; NEVER shown unless
              useSystemAdminStore().isSystemAdmin resolved true, and that in
              turn only ever came from am_i_system_admin() — a fresh,
              server-side check of the real auth identity, not a locally
              cached/guessed value. */}
          {isSystemAdmin ? (
            <Pressable
              onPress={() => setSystemAdminOpen(true)}
              style={styles.systemAdminEntry}
              accessibilityRole="button"
              accessibilityLabel="ניהול מערכת"
            >
              <RtlText style={styles.systemAdminEntryText}>🛡️</RtlText>
            </Pressable>
          ) : null}
          <SystemAdminScreen visible={systemAdminOpen} onClose={() => setSystemAdminOpen(false)} />
        </>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  systemAdminEntry: {
    position: 'absolute',
    bottom: 18,
    left: 18,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  systemAdminEntryText: { fontSize: 20 },
});
