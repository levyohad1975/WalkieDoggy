import { Platform } from 'react-native';
import type { NotificationSetting, Walk } from '../types';
import { planWalkNotifications, shouldSendNotification } from '../logic/reminders';
import { mapExecutionEnvironment } from '../lib/expoRuntime';
// TYPE-ONLY import — fully erased at compile time (both tsc and babel strip
// `import type`), so this does NOT reintroduce the module-scope
// expo-notifications side effect this whole file exists to avoid. Used only
// to type getNotifications()'s return value; every actual runtime access
// goes through the lazy guarded `require('expo-notifications')` below.
import type * as ExpoNotifications from 'expo-notifications';

/**
 * P0 FIX — Android Expo Go 57 startup crash.
 *
 * Root cause: this file used to `import * as Notifications from
 * 'expo-notifications'` statically at module scope AND immediately called
 * `Notifications.setNotificationHandler(...)` at that same module scope —
 * before any screen mounted, before any permission was requested, before
 * anything could possibly guard it. As of Expo SDK 53, Expo Go's Android
 * build no longer ships the native module this touches; the very first
 * import of this file (which happens at app startup, since scheduleStore
 * imports it) threw:
 *   "[runtime not ready]: Error: expo-notifications: Android Push
 *    notifications ... functionality ... was removed from Expo Go with the
 *    release of SDK 53. Use a development build instead of Expo Go."
 * — a hard crash before the app could even render, on every Android Expo Go
 * launch, regardless of whether the user ever touched notifications.
 *
 * Fix: never import or touch `expo-notifications` at module scope. Every
 * exported function below goes through `getNotifications()`, which:
 *   1. Lazily imports the module only when actually needed (mirrors
 *      src/lib/pushTokens.ts's existing lazy-import pattern for the same
 *      native-module-availability reason).
 *   2. Uses `Constants.executionEnvironment` (via the SAME shared detector
 *      pushTokens.ts uses — src/lib/expoRuntime.ts's mapExecutionEnvironment
 *      — not a Platform.OS guess) to recognize Expo Go specifically, and
 *      returns `null` (a clean "unavailable" signal) instead of ever calling
 *      into the module there.
 *   3. Registers the notification handler exactly once, lazily, the first
 *      time it's actually safe to do so — never at import time.
 *
 * This deliberately does NOT delete or disable the notification system: in
 * a dev build or standalone build (where the native module IS present),
 * every function below behaves exactly as before this fix, byte-for-byte.
 * Only Expo Go is affected, and there it degrades to a silent no-op rather
 * than crashing — see each function's own guard below, and
 * decideNotificationCapability()'s doc comment for exactly which features
 * that covers.
 *
 * IMPORTANT SCOPE NOTE: this file only ever schedules LOCAL notifications
 * (walk reminders, computed from src/logic/reminders.ts). It has never sent
 * or received REMOTE push — that is a completely separate system
 * (src/lib/pushTokens.ts's registerPushToken()/sendRequestPush(), plus the
 * send-request-push Edge Function) with its own, already-existing Expo Go
 * guard. The two are independent: an Expo Go device can be fully unable to
 * schedule local walk reminders while remote request-push registration is
 * (separately) also unavailable there — see PROJECT status notes for the
 * full breakdown of what each requires.
 */
export type NotificationCapability = 'available' | 'unavailable';

/**
 * Pure decision rule — unit-testable without any native module. Expo Go
 * ('storeClient') can never reliably schedule/manage notifications on
 * Android post-SDK-53 (and remote push is unsupported there on every
 * platform) — treated as categorically unavailable, not a transient error.
 * Any other recognized or unrecognized environment (dev/standalone build,
 * or a detection failure) is treated as available, so a real working build
 * never loses functionality because of an overly-cautious guard.
 */
export function decideNotificationCapability(
  executionEnvironment: 'storeClient' | 'bareOrStandalone' | 'unknown'
): NotificationCapability {
  return executionEnvironment === 'storeClient' ? 'unavailable' : 'available';
}

let cachedCapability: NotificationCapability | null = null;
let notificationsModulePromise: Promise<typeof ExpoNotifications | null> | null = null;
let handlerRegistered = false;

async function detectCapability(): Promise<NotificationCapability> {
  if (cachedCapability) return cachedCapability;

  // expo-notifications local scheduling APIs are not supported on Web.
  // Web Push is handled separately; never load the native notification path here.
  if (Platform.OS === 'web') {
    cachedCapability = 'unavailable';
    return cachedCapability;
  }
  try {
    const constantsImport: any = require('expo-constants');
    const constantsModule = constantsImport?.default ?? constantsImport;
    const env = mapExecutionEnvironment(constantsModule);
    cachedCapability = decideNotificationCapability(env);
  } catch {
    // Detection itself failing (e.g. expo-constants unavailable in some
    // stripped-down environment) must never be treated as "Expo Go" — fail
    // OPEN toward the previous, working behavior rather than silently
    // disabling reminders in a real dev/standalone build.
    cachedCapability = 'available';
  }
  return cachedCapability;
}

/**
 * Lazily loads expo-notifications and registers the notification handler
 * exactly once — only ever reached after detectCapability() has already
 * confirmed we're not in Expo Go. Returns null if the module genuinely
 * can't be loaded (e.g. this test sandbox, or a bare RN environment with no
 * native modules at all) so callers can no-op instead of throwing.
 */
async function getNotifications(): Promise<typeof ExpoNotifications | null> {
  const capability = await detectCapability();
  if (capability === 'unavailable') return null;

  if (!notificationsModulePromise) {
    try {
      notificationsModulePromise = Promise.resolve(
        require('expo-notifications') as typeof ExpoNotifications
      );
    } catch {
      notificationsModulePromise = Promise.resolve(null);
    }
  }
  const Notifications = await notificationsModulePromise;
  if (!Notifications) return null;

  if (!handlerRegistered) {
    handlerRegistered = true;
    try {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
      });
    } catch {
      // Best-effort — a failure here must never block scheduling/cancelling
      // below (those calls are independently try/catch-guarded by the OS
      // API itself where it matters, e.g. cancelOrphanedWalkNotifications).
    }
  }
  return Notifications;
}

/**
 * Round 6D — Android 8+ requires a notification channel for reliable
 * delivery/behavior (heads-up, sound, a dedicated entry in the system
 * notification settings) rather than falling back to an implicit/default
 * channel. There is exactly one notification "kind" of urgency in this app
 * (walk reminders — both pre_walk_reminder and overdue_reminder share the
 * same importance), so a single dedicated channel is used rather than one
 * per kind. iOS has no channel concept, so ensureAndroidNotificationChannel()
 * is a no-op there — see below.
 */
const ANDROID_REMINDERS_CHANNEL_ID = 'walk-reminders';

/**
 * Creates (or updates, if already created) the "walk-reminders" Android
 * notification channel. No-op on iOS/other platforms, and no-op (rather
 * than a crash) in Expo Go — see getNotifications() above. Safe to call
 * repeatedly: Notifications.setNotificationChannelAsync with the same
 * channel id is itself idempotent on Android — it (re)applies these settings
 * to the existing channel rather than creating a duplicate.
 */
export async function ensureAndroidNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const Notifications = await getNotifications();
  if (!Notifications) return;
  await Notifications.setNotificationChannelAsync(ANDROID_REMINDERS_CHANNEL_ID, {
    name: 'תזכורות טיול',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
  });
}

/**
 * The full set of notification "kinds" a walk can ever have scheduled — see
 * src/logic/reminders.ts's planWalkNotifications(). Kept as an explicit list
 * (rather than derived at runtime) so cancelWalkNotifications() can always
 * compute the deterministic identifiers to cancel even for a walk it has no
 * other information about (e.g. one that no longer exists locally).
 */
const NOTIFICATION_KINDS = ['pre_walk_reminder', 'overdue_reminder'] as const;
type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * STABLE, DETERMINISTIC notification id for a given walk occurrence + kind —
 * this is the actual fix for "notification shows wrong responsible person"
 * (round 6, priority A3).
 *
 * Root cause: the previous implementation tracked scheduled OS notification
 * ids in a plain in-memory `Map` (walkId -> [ids]), and relied on that map to
 * know what to cancel before rescheduling. That map is lost on every app
 * restart. expo-notifications' local notifications, however, are NOT lost on
 * restart — they keep firing at the OS level with whatever content they were
 * given when scheduled. So the sequence that produced the exact bug report
 * (06:45 reminder said "עומר" for the 07:00 walk, but the persisted walk was
 * "אבא") was:
 *   1. Walk is (re)assigned to עומר -> a local notification is scheduled with
 *      body text baked in at that moment ("עומר אחראי/ת...").
 *   2. App is killed/restarted (or simply not reopened) before that
 *      notification fires — the in-memory `scheduledIds` map is gone.
 *   3. Walk is reassigned again, this time to אבא (edit / approved swap /
 *      approved time-change). scheduleWalkNotifications() runs again, calls
 *      cancelWalkNotifications(walk.id) first — but with an empty in-memory
 *      map, there is nothing to look up, so the OLD "עומר" notification is
 *      never cancelled. A NEW "אבא" notification is scheduled alongside it.
 *   4. Both fire. The stale one (עומר) is the one the user saw.
 *
 * The fix: never rely on remembering what was previously scheduled. Instead
 * give every (walkId, kind) pair a STABLE identifier
 * (`notif:{walkId}:{kind}`) and always pass it as `identifier` to
 * scheduleNotificationAsync. Per expo-notifications, scheduling a
 * notification with an identifier that is already scheduled REPLACES the
 * existing one — so rescheduling is idempotent and correct even after a
 * restart wiped any in-memory bookkeeping, with no dependency on ever having
 * seen the walk before. cancelWalkNotifications() likewise cancels by the
 * deterministic id for every possible kind, not by looking anything up.
 */
function notificationIdentifier(walkId: string, kind: NotificationKind): string {
  return `notif:${walkId}:${kind}`;
}

/**
 * Requests OS notification permission. In Expo Go this now resolves to
 * `false` immediately (no crash, no permission prompt that could never
 * actually deliver anything there) instead of throwing.
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  // Round 6D: ensure the Android channel exists before requesting permission
  // — same existing getPermissionsAsync/requestPermissionsAsync flow below,
  // unchanged; this is not a second permission system, just an Android-only
  // prerequisite step that is a no-op on iOS.
  await ensureAndroidNotificationChannel();
  const Notifications = await getNotifications();
  if (!Notifications) return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

/**
 * Schedules (or reschedules) the pre-walk + overdue reminders for one walk,
 * per src/logic/reminders.ts. Call this whenever a walk is created, its
 * time/responsible person changes, or reminder settings change — content is
 * ALWAYS derived from the walk object passed in right now (the current
 * persisted occurrence), never recomputed from the schedule rule/rotation
 * later. Safe to call repeatedly / after a restart — see notificationIdentifier().
 * In Expo Go (or any environment where the native module is unavailable)
 * this is a silent no-op — see getNotifications().
 */
export async function scheduleWalkNotifications(
  walk: Walk,
  setting: NotificationSetting,
  responsibleName: string,
  dogName: string
): Promise<void> {
  const Notifications = await getNotifications();
  if (!Notifications) return;

  // NOTE: deliberately does NOT blanket-cancel this walk's existing
  // notifications before scheduling. scheduleNotificationAsync is called
  // below with the SAME deterministic identifier (see notificationIdentifier()
  // doc comment) every time, which the OS replaces in place — that is the
  // whole point of the deterministic-id scheme. A blanket cancel-then-
  // reschedule here would (and previously did) call
  // cancelScheduledNotificationAsync for a walk that is still perfectly
  // valid and pending, which is indistinguishable, from a caller's point of
  // view, from actually orphaning it — a real bug, since any caller (or
  // test) watching for "was this walk's notification cancelled?" would see
  // a false positive even though the walk was never removed. Only kinds
  // that are NOT part of the freshly (re)scheduled set below get cancelled,
  // so a kind that's no longer applicable (e.g. its computed fire time has
  // already passed) still gets cleaned up.
  if (!shouldSendNotification(walk)) {
    await cancelWalkNotifications(walk.id);
    return;
  }

  const plan = planWalkNotifications(walk, setting);
  const scheduledKinds = new Set<NotificationKind>();

  for (const item of plan) {
    const fireDate = new Date(item.fireAt);
    if (fireDate.getTime() <= Date.now()) continue; // don't schedule reminders in the past

    const title = item.kind === 'pre_walk_reminder' ? `🐶 עוד ${setting.minutesBefore} דקות לטיול` : `⏰ הטיול עדיין לא סומן כבוצע`;
    const body =
      item.kind === 'pre_walk_reminder'
        ? `${responsibleName} אחראי/ת על הטיול של ${dogName} בשעה ${walk.scheduledTime}`
        : `הטיול של ${dogName} בשעה ${walk.scheduledTime} עדיין ממתין. אפשר לסמן כבוצע באפליקציה.`;

    await Notifications.scheduleNotificationAsync({
      identifier: notificationIdentifier(walk.id, item.kind as NotificationKind),
      content: {
        title,
        body,
        data: { walkId: walk.id, kind: item.kind },
        // Round 6D: route to the dedicated Android channel — Android only,
        // so iOS notification content is byte-identical to before this round.
        ...(Platform.OS === 'android' ? { channelId: ANDROID_REMINDERS_CHANNEL_ID } : null),
      },
      trigger: Platform.select({
        default: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireDate },
      }) as any,
    });
    scheduledKinds.add(item.kind as NotificationKind);
  }

  const staleKinds = NOTIFICATION_KINDS.filter((kind) => !scheduledKinds.has(kind));
  await Promise.all(
    staleKinds.map((kind) => Notifications.cancelScheduledNotificationAsync(notificationIdentifier(walk.id, kind)))
  );
}

/**
 * Cancels every notification that could ever have been scheduled for this
 * walk, by deterministic id — no lookup of prior state needed (see
 * notificationIdentifier() doc comment). Safe to call for a walk that never
 * had anything scheduled (cancelling an unknown identifier is a no-op), and
 * a silent no-op in Expo Go.
 */
export async function cancelWalkNotifications(walkId: string): Promise<void> {
  const Notifications = await getNotifications();
  if (!Notifications) return;
  await Promise.all(
    NOTIFICATION_KINDS.map((kind) =>
      Notifications.cancelScheduledNotificationAsync(notificationIdentifier(walkId, kind))
    )
  );
}

/**
 * Identifies whether a scheduled OS notification is one THIS app scheduled
 * for a walk reminder (as opposed to some unrelated notification — a future
 * feature, or something another app/the OS itself put there) and, if so,
 * which walk + kind it belongs to. Prefers `content.data` (set at schedule
 * time — see scheduleWalkNotifications() above) and falls back to parsing
 * the deterministic `notif:{walkId}:{kind}` identifier (see
 * notificationIdentifier() doc comment) for a notification whose `data`
 * didn't round-trip for some reason. Returns null for anything that doesn't
 * match either shape — callers must never cancel those.
 */
function ownedWalkNotification(request: ExpoNotifications.NotificationRequest): { walkId: string; kind: NotificationKind } | null {
  const data = request.content?.data as { walkId?: unknown; kind?: unknown } | undefined;
  if (
    data &&
    typeof data.walkId === 'string' &&
    typeof data.kind === 'string' &&
    (NOTIFICATION_KINDS as readonly string[]).includes(data.kind)
  ) {
    return { walkId: data.walkId, kind: data.kind as NotificationKind };
  }

  const parts = request.identifier.split(':');
  if (parts.length === 3 && parts[0] === 'notif' && (NOTIFICATION_KINDS as readonly string[]).includes(parts[2])) {
    return { walkId: parts[1], kind: parts[2] as NotificationKind };
  }

  return null;
}

/**
 * BUG 4 FIX (orphaned notification for a remotely-deleted walk): cancels
 * every app-owned walk-reminder notification currently scheduled on the
 * device whose walk id is NOT in `currentWalkIds`. reconcileWalkNotifications()
 * below only ever VISITS the walks it's given — a walk deleted on another
 * device (and therefore absent from the fresh `walks` array after a reload)
 * was previously never visited at all, so its stale reminder was never
 * cancelled. This instead enumerates what's ACTUALLY scheduled on the OS
 * (`getAllScheduledNotificationsAsync`), so an id no longer present anywhere
 * in the current authoritative walk set is caught regardless of why it's
 * missing (deleted entirely, not just marked done/skipped — those are
 * already handled per-walk below since the walk is still present with a
 * non-pending status).
 *
 * Only ever cancels a notification `ownedWalkNotification` recognizes as
 * this app's own walk-reminder scheme — anything else scheduled on the
 * device (unrelated feature, another app) is left strictly alone. No-op in
 * Expo Go.
 */
async function cancelOrphanedWalkNotifications(currentWalkIds: Set<string>): Promise<void> {
  const Notifications = await getNotifications();
  if (!Notifications) return;

  let scheduled: ExpoNotifications.NotificationRequest[];
  try {
    scheduled = await Notifications.getAllScheduledNotificationsAsync();
  } catch {
    return; // best-effort — must never break the rest of reconciliation
  }

  const toCancel = scheduled
    .map((request) => ({ request, owned: ownedWalkNotification(request) }))
    .filter(({ owned }) => owned && !currentWalkIds.has(owned.walkId))
    .map(({ request }) => request.identifier);

  await Promise.all(toCancel.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
}

/**
 * Reconciliation pass: brings the OS-scheduled notification set back in line
 * with the CURRENTLY PERSISTED walk occurrences, in one call. Must be run at:
 * app startup, app foreground, schedule reload (scheduleStore.load()),
 * schedule edit, approved time-change, approved swap — see A3's authoritative
 * rule that notification content always comes from the current persisted
 * occurrence, never a stale snapshot.
 *
 * For every walk still pending (and whose responsible user has reminders
 * enabled), (re)schedules from its current data — deterministic ids make
 * this a safe no-op when nothing actually changed, and a correct replace
 * when something did. For every walk that is NOT pending (done/skipped),
 * cancels its notifications outright, so a stale reminder for a
 * since-completed/changed walk can never survive a reload. Finally (bug 4
 * fix), cancels any app-owned walk-reminder notification actually scheduled
 * on the device whose walk id doesn't appear in `walks` AT ALL — covering a
 * walk deleted on another device, which this loop (only visiting the walks
 * it's given) can never otherwise reach.
 *
 * In Expo Go every underlying call above is already a no-op, so this whole
 * pass degrades to "does nothing, returns normally" — safe to call
 * unconditionally from every call site without an Expo-Go check at each one.
 */
export async function reconcileWalkNotifications(
  walks: Walk[],
  getSetting: (userId: string) => Promise<NotificationSetting | undefined>,
  getUserName: (userId: string) => string | undefined,
  dogName: string
): Promise<void> {
  for (const walk of walks) {
    if (walk.status !== 'pending') {
      await cancelWalkNotifications(walk.id);
      continue;
    }
    const setting = await getSetting(walk.responsibleUserId);
    const userName = getUserName(walk.responsibleUserId);
    if (!setting || !setting.enabled || !userName) {
      await cancelWalkNotifications(walk.id);
      continue;
    }
    await scheduleWalkNotifications(walk, setting, userName, dogName);
  }

  await cancelOrphanedWalkNotifications(new Set(walks.map((w) => w.id)));
}

/**
 * Test-only hook: clears the memoized capability/module cache between tests
 * so each test can simulate a fresh app launch under a different
 * environment. Not used by production code paths.
 */
export function __resetNotificationCapabilityCacheForTests(): void {
  cachedCapability = null;
  notificationsModulePromise = null;
  handlerRegistered = false;
}

