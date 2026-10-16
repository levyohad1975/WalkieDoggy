import { supabase, SupabaseNotConfiguredError } from './supabase';
import { repository } from '../data';
import { completeWalkLifecycleOperation, getWalkLifecycleOperationId } from '../data/walkLifecycleOperationIds';

/**
 * BATCH 4 (item A — System Admin V1, read-only). Thin client wrappers over
 * migration 0029's two RPCs, mirroring every other Supabase-only module in
 * this repo (lib/invites.ts, lib/requests.ts, ...): all real authorization
 * (is_system_admin(), never trusting client-side UI hiding) lives
 * server-side inside the RPCs, never here. Supabase-only by construction —
 * System Admin has no meaning in local/demo mode.
 */

function requireSupabase() {
  if (!supabase) throw new SupabaseNotConfiguredError();
  return supabase;
}

export interface SystemAdminFamilyListItem {
  familyId: string;
  familyName: string;
  /** Distinguishing identifier — family names are NOT unique (Master Specification §1/§12); the invite code is. */
  inviteCode: string;
  createdAt: string;
  memberCount: number;
  adminNames: string[];
  dogName: string | null;
  status: string;
  verifiedEmail: string | null;
}

export interface SystemAdminTestFamily {
  familyId: string;
  familyName: string;
  inviteCode: string;
  createdAt: string;
  dogName: string | null;
  /** Client-only trace token; contains no account or family data. */
  diagnosticId?: string;
}

export type TestFamilyReentryStage =
  | 'client_setup'
  | 'sync_preflight'
  | 'auth_session'
  | 'rpc'
  | 'rpc_response'
  | 'identity_validation'
  | 'onboarding_state'
  | 'family_selection'
  | 'onboarding_resume';

export function createTestFamilyReentryDiagnosticId(): string {
  return `qa-reentry-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeDiagnosticReason(error: unknown): string | undefined {
  const value = error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : error instanceof Error ? error.message : '';
  if (!value) return undefined;
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[token]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[id]')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\s+/g, ' ')
    .slice(0, 240);
}

function diagnosticErrorFields(error: unknown): { code?: string; httpStatus?: number; reason?: string } {
  const item = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const code = typeof item.code === 'string' ? item.code.slice(0, 32) : undefined;
  const status = typeof item.status === 'number' ? item.status : undefined;
  const reason = safeDiagnosticReason(error);
  return { ...(code ? { code } : {}), ...(status ? { httpStatus: status } : {}), ...(reason ? { reason } : {}) };
}

/** Structured, PII-minimized browser diagnostic for the Staging iPhone reproduction. */
export function recordTestFamilyReentryDiagnostic(args: {
  diagnosticId: string;
  familyId: string;
  stage: TestFamilyReentryStage;
  outcome: 'started' | 'succeeded' | 'failed';
  error?: unknown;
}): void {
  const stagingHost = typeof window !== 'undefined'
    && window.location?.hostname?.toLowerCase() === 'staging.walkielink.co.il';
  if (process.env.NODE_ENV !== 'test' && !stagingHost) return;
  const details = args.error ? diagnosticErrorFields(args.error) : {};
  // Never log family/auth IDs, names, emails, tokens, queue payloads, or photo data.
  console.info('[test-family-reentry]', JSON.stringify({
    diagnosticId: args.diagnosticId,
    stage: args.stage,
    outcome: args.outcome,
    ...details,
  }));
}

export class TestFamilyReentryError extends Error {
  readonly code?: string;
  readonly httpStatus?: number;
  readonly reason?: string;

  constructor(
    readonly stage: TestFamilyReentryStage,
    readonly diagnosticId: string,
    readonly familyId: string,
    readonly userMessage: string,
    cause: unknown
  ) {
    super(userMessage);
    this.name = 'TestFamilyReentryError';
    const details = diagnosticErrorFields(cause);
    this.code = details.code;
    this.httpStatus = details.httpStatus;
    this.reason = details.reason;
  }
}

function rowOrThrow<T>(data: T[] | T | null, message: string): T {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error(message);
  return row as T;
}

/**
 * Profile claims must not switch the audit actor while writes from the
 * currently active family are still queued. Drain and verify the queue
 * before the server changes this System Admin device's family context.
 * The server RPC remains the authorization boundary.
 */
export async function flushBeforeSystemAdminTestFamilySwitch(): Promise<void> {
  if (!repository.trySync || !repository.pendingSyncCount) {
    throw new Error('לא ניתן לוודא שהפעולות במכשיר סונכרנו, ולכן לא עברנו למשפחת הבדיקה.');
  }

  try {
    await repository.trySync();
    const pendingCount = await repository.pendingSyncCount();
    if (pendingCount > 0) {
      let details = '';
      try {
        const queue = await repository.getPendingSyncDiagnostics?.();
        if (queue) {
          const operations = Object.entries(queue.byOperation).sort((a, b) => b[1] - a[1])
            .map(([type, count]) => `${type}: ${count}`).join(', ') || 'לא זוהו סוגי פעולות';
          const owners = queue.ownerIds.slice(0, 3).map(({ id, count }) => `${id}: ${count}`).join(', ') || 'אין מזהה פרופיל';
          const families = queue.familyIds.slice(0, 3).map(({ id, count }) => `${id}: ${count}`).join(', ') || 'אין מזהה משפחה';
          const failures = Object.entries(queue.lastErrorCodes).map(([code, count]) => `${code}: ${count}`).join(', ') || 'אין קוד שגיאה שמור';
          const oldest = queue.oldestEnqueuedAt ?? 'לא נשמר זמן יצירה ברשומות הישנות';
          const preflight = queue.syncPreflight ? `${queue.syncPreflight.outcome} (${queue.syncPreflight.at ?? 'ללא זמן'})` : 'לא זמין';
          const flush = queue.lastFlush
            ? `עובדו: ${queue.lastFlush.attempted}; דולגו בשל בעלות של פרופיל אחר: ${queue.lastFlush.skippedOtherProfile}; נשמרו: ${queue.lastFlush.succeeded}; נדחו לצורך בדיקה: ${queue.lastFlush.conflicted}; הועברו להסגר: ${queue.lastFlush.quarantined}; נותרו אחרי הסנכרון: ${queue.lastFlush.remaining}; נעצר בכשל זמני: ${queue.lastFlush.stoppedOnRetryableFailure ? 'כן' : 'לא'}.`
            : 'לא נשמר סיכום של ניסיון הסנכרון האחרון.';
          const firstFailure = queue.firstRetryableFailure
            ? `כשל ראשון: ${queue.firstRetryableFailure.operationType} · מזהה בטוח ${queue.firstRetryableFailure.safeOperationId} · מיקום ${queue.firstRetryableFailure.queuePosition} · יעד ${queue.firstRetryableFailure.endpoint} · HTTP ${queue.firstRetryableFailure.httpStatus ?? 'לא ידוע'} · קוד ${queue.firstRetryableFailure.errorCode ?? 'לא ידוע'} · ${queue.firstRetryableFailure.category} · ${queue.firstRetryableFailure.errorMessage}.`
            : 'לא נשמר כשל זמני ראשון.';
          details = `\nפירוט מקומי (ללא תוכן הפעולות): ${operations}. בעלים: הפרופיל הנוכחי ${queue.ownerCounts.activeProfile}, פרופילים אחרים ${queue.ownerCounts.otherProfile}, לא ידוע ${queue.ownerCounts.unknown}. מזהי פרופיל: ${owners}. משפחות: ${families}; פעולות ללא familyId בפayload: ${queue.withoutFamilyId}. בדיקת רשת/סנכרון: ${preflight}. תוצאת ניסיון אחרון: ${flush} ${firstFailure} תאריך ההוספה הישן ביותר הידוע: ${oldest}; רשומות ישנות ללא תאריך: ${queue.missingEnqueueTime}. ניסיון אחרון: ${queue.latestAttemptAt ?? 'לא נשמר'}. ממתינות ללא ניסיון: ${queue.neverAttempted}; ניסיון קודם ללא SQLSTATE: ${queue.attemptedWithUnknownOutcome}; שגיאות SQLSTATE: ${failures}.`;
        }
      } catch {
        // Diagnostics are best-effort and must never change the safety gate.
      }
      throw new Error(
        `לא ניתן לעבור למשפחת בדיקה: נותרו ${pendingCount} פעולות שממתינות לסנכרון. הנתונים לא שונו. בדקו את פירוט התור שמופיע כאן, חזרו לפרופיל שמופיע כבעל הפעולות ונסו שוב לאחר הסנכרון.${details}`
      );
    }
  } catch (cause) {
    if (cause instanceof Error && /[\u0590-\u05FF]/.test(cause.message)) throw cause;
    throw new Error('לא הצלחנו לסנכרן את הפעולות במשפחה הפעילה. לא עברנו למשפחת הבדיקה; בדקו את החיבור ונסו שוב.');
  }
}

/** Creates an isolated QA family and snapshots the caller's current family/profile. */
export async function createSystemAdminTestFamily(familyName: string): Promise<SystemAdminTestFamily> {
  const client = requireSupabase();
  await flushBeforeSystemAdminTestFamilySwitch();
  const { data, error } = await client.rpc('system_admin_enter_test_family', { p_family_name: familyName.trim() });
  if (error) throw error;
  const row = rowOrThrow(data as Array<{ id: string; name: string; invite_code: string }> | null, 'יצירת משפחת הבדיקה נכשלה');
  return { familyId: row.id, familyName: row.name, inviteCode: row.invite_code, createdAt: new Date().toISOString(), dogName: null };
}

/** Re-enters an existing QA family without replacing the original membership snapshot. */
export async function switchToSystemAdminTestFamily(familyId: string): Promise<SystemAdminTestFamily> {
  const diagnosticId = createTestFamilyReentryDiagnosticId();
  let client: NonNullable<typeof supabase>;
  try {
    client = requireSupabase();
  } catch (error) {
    recordTestFamilyReentryDiagnostic({ diagnosticId, familyId, stage: 'client_setup', outcome: 'failed', error });
    throw new TestFamilyReentryError(
      'client_setup', diagnosticId, familyId,
      'שירות הבדיקה אינו זמין כרגע. רעננו את המסך ונסו שוב.', error
    );
  }
  recordTestFamilyReentryDiagnostic({ diagnosticId, familyId, stage: 'sync_preflight', outcome: 'started' });
  try {
    await flushBeforeSystemAdminTestFamilySwitch();
    recordTestFamilyReentryDiagnostic({ diagnosticId, familyId, stage: 'sync_preflight', outcome: 'succeeded' });
  } catch (error) {
    const pending = error instanceof Error && error.message.includes('נותרו');
    const stage: TestFamilyReentryStage = 'sync_preflight';
    recordTestFamilyReentryDiagnostic({ diagnosticId, familyId, stage, outcome: 'failed', error });
    throw new TestFamilyReentryError(
      stage, diagnosticId, familyId,
      pending
        ? error instanceof Error ? error.message : 'יש פעולות שממתינות לסנכרון. סנכרנו ונסו שוב.'
        : 'לא הצלחנו לסנכרן את הפעולות במשפחה הפעילה. לא עברנו למשפחת הבדיקה; בדקו את החיבור ונסו שוב.',
      error
    );
  }

  recordTestFamilyReentryDiagnostic({ diagnosticId, familyId, stage: 'auth_session', outcome: 'started' });
  try {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData.session) throw new Error('no authenticated session');
    recordTestFamilyReentryDiagnostic({ diagnosticId, familyId, stage: 'auth_session', outcome: 'succeeded' });
  } catch (error) {
    recordTestFamilyReentryDiagnostic({ diagnosticId, familyId, stage: 'auth_session', outcome: 'failed', error });
    throw new TestFamilyReentryError(
      'auth_session', diagnosticId, familyId,
      'פג תוקף החיבור למערכת. התחברו מחדש ונסו להמשיך בבדיקה.', error
    );
  }

  recordTestFamilyReentryDiagnostic({ diagnosticId, familyId, stage: 'rpc', outcome: 'started' });
  let data: unknown;
  try {
    const result = await client.rpc('system_admin_switch_test_family', { p_family_id: familyId });
    if (result.error) throw result.error;
    data = result.data;
    recordTestFamilyReentryDiagnostic({ diagnosticId, familyId, stage: 'rpc', outcome: 'succeeded' });
  } catch (error) {
    recordTestFamilyReentryDiagnostic({ diagnosticId, familyId, stage: 'rpc', outcome: 'failed', error });
    throw new TestFamilyReentryError(
      'rpc', diagnosticId, familyId,
      'השרת לא אישר את המעבר למשפחת הבדיקה. בדקו את החיבור והרשאת מנהל המערכת ונסו שוב.', error
    );
  }

  try {
    const row = rowOrThrow(data as Array<{ id: string; name: string; invite_code: string }> | null, 'empty response');
    recordTestFamilyReentryDiagnostic({ diagnosticId, familyId, stage: 'rpc_response', outcome: 'succeeded' });
    return { familyId: row.id, familyName: row.name, inviteCode: row.invite_code, createdAt: new Date().toISOString(), dogName: null, diagnosticId };
  } catch (error) {
    recordTestFamilyReentryDiagnostic({ diagnosticId, familyId, stage: 'rpc_response', outcome: 'failed', error });
    throw new TestFamilyReentryError(
      'rpc_response', diagnosticId, familyId,
      'השרת אישר את המעבר אך לא החזיר את פרטי המשפחה. רעננו את המסך לפני ניסיון נוסף.', error
    );
  }
}

/** Re-enters an existing family, then resumes its local onboarding state. */
export async function reenterExistingSystemAdminTestFamily(
  familyId: string,
  resumeOnboarding?: (familyId: string, diagnosticId?: string) => Promise<void>
): Promise<SystemAdminTestFamily> {
  const entered = await switchToSystemAdminTestFamily(familyId);
  const diagnosticId = entered.diagnosticId ?? createTestFamilyReentryDiagnosticId();
  recordTestFamilyReentryDiagnostic({ diagnosticId, familyId, stage: 'onboarding_resume', outcome: 'started' });
  try {
    await resumeOnboarding?.(familyId, diagnosticId);
    recordTestFamilyReentryDiagnostic({ diagnosticId, familyId, stage: 'onboarding_resume', outcome: 'succeeded' });
    return entered;
  } catch (error) {
    recordTestFamilyReentryDiagnostic({ diagnosticId, familyId, stage: 'onboarding_resume', outcome: 'failed', error });
    if (error instanceof TestFamilyReentryError) throw error;
    throw new TestFamilyReentryError(
      'onboarding_resume', diagnosticId, familyId,
      'המעבר למשפחת הבדיקה הצליח, אך חידוש ההגדרה נכשל. הנתונים נשמרו; רעננו את המסך ונסו שוב.', error
    );
  }
}

export async function listSystemAdminTestFamilies(): Promise<SystemAdminTestFamily[]> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('system_admin_list_test_families');
  if (error) throw error;
  return ((data ?? []) as Array<{ family_id: string; family_name: string; invite_code: string; created_at: string; dog_name: string | null }>).map((row) => ({
    familyId: row.family_id,
    familyName: row.family_name,
    inviteCode: row.invite_code,
    createdAt: row.created_at,
    dogName: row.dog_name,
  }));
}

export async function getActiveSystemAdminTestFamily(): Promise<{ familyId: string; familyName: string } | null> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('system_admin_get_active_test_family');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row?.family_id && row?.family_name ? { familyId: row.family_id, familyName: row.family_name } : null;
}

export interface SystemAdminFamilyDeletionImpact {
  familyId: string;
  familyName: string;
  inviteCode: string;
  approvalStatus: string;
  state: 'ready' | 'deleting' | 'deleted';
  counts: Record<string, number>;
  totalRows: number;
  storageObjects: number;
}

export async function getSystemAdminFamilyDeletionImpact(familyId: string): Promise<SystemAdminFamilyDeletionImpact> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('system_admin_family_deletion_impact', { p_family_id: familyId });
  if (error) throw error;
  const row = rowOrThrow<Record<string, unknown>>(data as Record<string, unknown> | null, 'לא התקבל פירוט השפעת המחיקה');
  return {
    familyId: String(row.family_id ?? row.familyId ?? familyId),
    familyName: String(row.family_name ?? row.familyName ?? ''),
    inviteCode: String(row.invite_code ?? row.inviteCode ?? ''),
    approvalStatus: String(row.approval_status ?? row.approvalStatus ?? ''),
    state: (row.state === 'deleting' || row.state === 'deleted' ? row.state : 'ready'),
    counts: (row.counts && typeof row.counts === 'object' ? row.counts : {}) as Record<string, number>,
    totalRows: Number(row.total_rows ?? row.totalRows ?? 0),
    storageObjects: Number(row.storage_objects ?? row.storageObjects ?? 0),
  };
}

/** Opaque yes/no check used to clear this device's cache after a server-confirmed deletion. */
export async function wasFamilyPermanentlyDeleted(familyId: string): Promise<boolean> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('was_family_permanently_deleted', { p_family_id: familyId });
  if (error) throw error;
  return data === true;
}

/**
 * Server-authorized, resumable family purge. SQL freezes family writes and
 * verifies both confirmations; the authenticated Storage API then removes
 * tenant-prefixed objects; the final RPC purges the relational graph in one
 * transaction. No service-role credential is present in the client.
 */
export async function permanentlyDeleteSystemAdminFamily(
  impact: SystemAdminFamilyDeletionImpact,
  confirmedFamilyName: string
): Promise<void> {
  const client = requireSupabase();
  const { error: beginError } = await client.rpc('system_admin_begin_family_deletion', {
    p_family_id: impact.familyId,
    p_confirmation_name: confirmedFamilyName,
    p_confirmation_phrase: 'DELETE FAMILY PERMANENTLY',
    p_expected_counts: impact.counts,
  });
  if (beginError) throw beginError;

  const { data: objectRows, error: listError } = await client.rpc('system_admin_list_family_deletion_storage_objects', {
    p_family_id: impact.familyId,
  });
  if (listError) throw listError;
  const objects = (objectRows ?? []) as Array<{ bucket_id: string; object_name: string }>;
  const byBucket = new Map<string, string[]>();
  for (const item of objects) {
    if (!item.object_name || !['family-photos', 'chat-attachments'].includes(item.bucket_id)) continue;
    const bucketPaths = byBucket.get(item.bucket_id) ?? [];
    bucketPaths.push(item.object_name);
    byBucket.set(item.bucket_id, bucketPaths);
  }
  for (const [bucket, paths] of byBucket) {
    for (let offset = 0; offset < paths.length; offset += 1000) {
      const { error } = await client.storage.from(bucket).remove(paths.slice(offset, offset + 1000));
      if (error) throw error;
    }
  }

  const { error: finalizeError } = await client.rpc('system_admin_finalize_family_deletion', {
    p_family_id: impact.familyId,
  });
  if (finalizeError) throw finalizeError;
}

/** Leaves the active QA family and restores the original family/profile snapshot. */
export async function exitSystemAdminTestFamily(): Promise<{ id: string; name: string }> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('system_admin_exit_test_family');
  if (error) throw error;
  const row = rowOrThrow(data as Array<{ id: string; name: string }> | null, 'החזרה למשפחה המקורית נכשלה');
  return row;
}

export interface SystemAdminFamilyMember {
  id: string;
  name: string;
  avatar: string;
  photoUrl: string | null;
  role: 'admin' | 'member';
  removedAt: string | null;
  claimed: boolean;
}

export interface SystemAdminWalkSummary {
  id: string;
  date: string;
  scheduledTime: string;
  status: 'pending' | 'done' | 'skipped';
  responsibleUserId: string;
  completedAt: string | null;
  isUnplanned: boolean;
}

export type SystemAdminActiveRequest =
  | { kind: 'swap'; id: string; walkId: string; requestedByUserId: string; targetUserId: string; status: string; createdAt: string }
  | { kind: 'time_change'; id: string; walkId: string; requestedByUserId: string; proposedTime: string; status: string; createdAt: string };

export interface SystemAdminAuditEntry {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
}

export interface SystemAdminFamilyDetail {
  family: { id: string; name: string; inviteCode: string; createdAt: string; approvalStatus: string } | null;
  dog: { id: string; name: string; photoUrl: string | null; sex: 'male' | 'female' | null; walksPerDay: number } | null;
  members: SystemAdminFamilyMember[];
  walks: SystemAdminWalkSummary[];
  activeRequests: SystemAdminActiveRequest[];
  recentAudit: SystemAdminAuditEntry[];
}

export interface SystemAdminGlobalAuditEntry {
  id: string;
  source: 'family_audit' | 'system_audit' | 'state_change';
  familyId: string | null;
  familyName: string | null;
  actorUserId: string | null;
  actorName: string | null;
  actorAuthUserId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface SystemAdminEmailDeliveryLogEntry {
  id: string;
  familyId: string | null;
  authUserId: string | null;
  messageType: 'family_welcome' | 'system_owner_new_family';
  recipientEmail: string;
  provider: string;
  providerMessageId: string | null;
  status: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}


export interface SystemAdminObserverSession {
  familyId: string;
  familyName: string;
  targetUserId: string | null;
}

export async function beginSystemAdminObserver(familyId: string): Promise<SystemAdminObserverSession> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('begin_system_admin_observer', { p_family_id: familyId });
  if (error) throw error;
  const row = (data ?? {}) as { family_id?: string; family_name?: string; target_user_id?: string | null };
  if (!row.family_id || !row.family_name) throw new Error('observer session could not be established');
  return { familyId: row.family_id, familyName: row.family_name, targetUserId: row.target_user_id ?? null };
}

export async function endSystemAdminObserver(): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('end_system_admin_observer');
  if (error) throw error;
}

/**
 * Safe to call for ANY authenticated session — resolves the caller's own
 * System Admin status only (never anyone else's), used to decide whether to
 * show the "🛡️ ניהול מערכת" entry point at all. UI hiding based on this is
 * never the authorization boundary — every RPC below re-checks
 * is_system_admin() itself.
 */
export async function checkIsSystemAdmin(): Promise<boolean> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('am_i_system_admin');
  if (error) throw error;
  return data === true;
}

export async function listSystemAdminFamilies(search?: string): Promise<SystemAdminFamilyListItem[]> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('system_admin_list_families_v2', { p_search: search?.trim() || null });
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    family_id: string;
    family_name: string;
    invite_code: string;
    created_at: string;
    member_count: number;
    admin_names: string[] | null;
    dog_name: string | null;
    status: string;
    verified_email: string | null;
  }>;
  return rows.map((r) => ({
    familyId: r.family_id,
    familyName: r.family_name,
    inviteCode: r.invite_code,
    createdAt: r.created_at,
    memberCount: r.member_count,
    adminNames: r.admin_names ?? [],
    dogName: r.dog_name,
    status: r.status,
    verifiedEmail: r.verified_email,
  }));
}

export async function getSystemAdminGlobalAudit(limit = 200): Promise<SystemAdminGlobalAuditEntry[]> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('system_admin_list_global_audit', { p_limit: limit });
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    event_id: string; source: 'family_audit' | 'system_audit' | 'state_change';
    family_id: string | null; family_name: string | null; actor_user_id: string | null;
    actor_name: string | null; actor_auth_user_id: string | null; actor_email: string | null;
    action: string; target_type: string | null; target_id: string | null;
    metadata: Record<string, unknown> | null; created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.event_id, source: r.source, familyId: r.family_id, familyName: r.family_name,
    actorUserId: r.actor_user_id, actorName: r.actor_name, actorAuthUserId: r.actor_auth_user_id,
    actorEmail: r.actor_email, action: r.action, targetType: r.target_type, targetId: r.target_id,
    metadata: r.metadata ?? {}, createdAt: r.created_at,
  }));
}

/**
 * Wraps migration 0032's system_admin_set_family_approval(), the only
 * server-side way to move a family out of 'pending'/'rejected' into 'active'
 * (or vice versa into 'rejected'). Until this wrapper + its SystemAdminScreen
 * call site, this RPC was defined and granted but never called from any
 * client code — with AUTO_APPROVE_NEW_FAMILIES=false a pending family had no
 * in-app path to ever become active. Throws (never silently no-ops) on a
 * denial or an invalid target status, matching every other RPC wrapper here.
 */
export async function setSystemAdminFamilyApproval(
  familyId: string,
  approvalStatus: 'active' | 'rejected'
): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('system_admin_set_family_approval', {
    p_family_id: familyId,
    p_approval_status: approvalStatus,
  });
  if (error) throw error;
}

export async function getSystemAdminFamilyDetail(familyId: string): Promise<SystemAdminFamilyDetail> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('system_admin_get_family_detail', { p_family_id: familyId });
  if (error) throw error;
  const detail = (data ?? {}) as Partial<SystemAdminFamilyDetail>;
  return {
    family: detail.family ?? null,
    dog: detail.dog ?? null,
    members: detail.members ?? [],
    walks: detail.walks ?? [],
    activeRequests: detail.activeRequests ?? [],
    recentAudit: detail.recentAudit ?? [],
  };
}

/**
 * Migration 0034's read-only counterpart to record_email_delivery_attempt()/
 * update_email_delivery_status() (both service-role-only, called from the
 * Edge Function and the Resend webhook function respectively) — this is the
 * "admin-gated read RPC" 0034's own table comment refers to as the only
 * client-reachable way to see email_delivery_log. p_limit is clamped
 * server-side to [1, 200]; omit to get the server's own default of 50.
 */
export async function getSystemAdminEmailDeliveryLog(limit?: number): Promise<SystemAdminEmailDeliveryLogEntry[]> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('system_admin_list_email_delivery_log', { p_limit: limit ?? null });
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    id: string;
    family_id: string | null;
    auth_user_id: string | null;
    message_type: 'family_welcome' | 'system_owner_new_family';
    recipient_email: string;
    provider: string;
    provider_message_id: string | null;
    status: string;
    error: string | null;
    created_at: string;
    updated_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    familyId: r.family_id,
    authUserId: r.auth_user_id,
    messageType: r.message_type,
    recipientEmail: r.recipient_email,
    provider: r.provider,
    providerMessageId: r.provider_message_id,
    status: r.status,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

/**
 * Staging maintenance (PR #150): owner-approved, single-use authorizations
 * for a verified System Admin to mark specific test-generated active walks
 * as resolved duplicates. Marker only — nothing is deleted. See
 * supabase/migrations/20261015100000_system_admin_duplicate_walk_repair_v12.sql.
 */
export interface DuplicateWalkMaintenanceAuthorization {
  authorizationId: string;
  familyId: string;
  familyName: string;
  dogId: string;
  dogName: string;
  walkIds: string[];
  unresolvedActiveCount: number;
  reason: string;
  expiresAt: string;
  consumedAt: string | null;
  consumedGroupId: string | null;
}

export async function listDuplicateWalkMaintenanceAuthorizations(): Promise<DuplicateWalkMaintenanceAuthorization[]> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('system_admin_list_duplicate_walk_authorizations');
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    authorization_id: string; family_id: string; family_name: string; dog_id: string; dog_name: string;
    walk_ids: string[]; unresolved_active_count: number; reason: string; expires_at: string;
    consumed_at: string | null; consumed_group_id: string | null;
  }>;
  return rows.map((r) => ({
    authorizationId: r.authorization_id, familyId: r.family_id, familyName: r.family_name,
    dogId: r.dog_id, dogName: r.dog_name, walkIds: r.walk_ids ?? [],
    unresolvedActiveCount: Number(r.unresolved_active_count ?? 0), reason: r.reason,
    expiresAt: r.expires_at, consumedAt: r.consumed_at, consumedGroupId: r.consumed_group_id,
  }));
}

/**
 * Applies one authorization. The operation id is persisted per authorization
 * before the request, so a retry after a lost response reuses it and the
 * server returns the same audit group instead of failing.
 */
export async function resolveDuplicateWalkMaintenanceAuthorization(authorizationId: string): Promise<string> {
  const client = requireSupabase();
  const operationId = await getWalkLifecycleOperationId('resolve_duplicates', `system-maintenance:${authorizationId}`, 'system-admin');
  const { data, error } = await client.rpc('system_admin_resolve_authorized_duplicate_walks_v12', {
    p_authorization_id: authorizationId,
    p_operation_id: operationId,
  });
  if (error) throw error;
  if (typeof data !== 'string' || !data) throw new Error('Maintenance RPC returned an invalid audit group id');
  await completeWalkLifecycleOperation('resolve_duplicates', `system-maintenance:${authorizationId}`, 'system-admin');
  return data;
}
