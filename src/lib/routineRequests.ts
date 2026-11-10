/**
 * Routine change requests — data access (migration
 * 20261110090000_routine_change_requests and the routine-request-notify Edge
 * Function). Every transition is an RPC that re-authorizes the caller on the
 * server; after each one the device asks the Edge Function to push the next
 * person (best effort: the request is visible in the app either way).
 */
import { supabase, SupabaseNotConfiguredError } from './supabase';
import type { RoutineChangeRequest, RoutineRequestKind } from '../logic/routineRequests';

function client() {
  if (!supabase) throw new SupabaseNotConfiguredError();
  return supabase;
}

function notify(requestId: string) {
  void client().functions.invoke('routine-request-notify', { body: { requestId } }).catch(() => undefined);
}

function toRequest(row: any): RoutineChangeRequest {
  return {
    id: row.id,
    familyId: row.family_id,
    dogId: row.dog_id,
    requesterUserId: row.requester_user_id,
    targetUserId: row.target_user_id ?? null,
    kind: row.kind,
    myDay: row.my_day ?? null,
    myTime: row.my_time ?? null,
    theirDay: row.their_day ?? null,
    theirTime: row.their_time ?? null,
    newTime: row.new_time ?? null,
    note: row.note ?? null,
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? null,
  };
}

/** Open requests plus the ones decided in the last week. */
export async function listRoutineChangeRequests(familyId: string): Promise<RoutineChangeRequest[]> {
  if (!supabase) return [];
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data, error } = await client()
    .from('routine_change_requests')
    .select('*')
    .eq('family_id', familyId)
    .or(`status.in.(pending_target,pending_admin),updated_at.gte.${since}`)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []).map(toRequest);
}

export interface NewRoutineRequest {
  dogId: string;
  kind: RoutineRequestKind;
  myDay?: number;
  myTime?: string;
  targetUserId?: string;
  theirDay?: number;
  theirTime?: string;
  newTime?: string;
  note?: string;
}

export async function createRoutineChangeRequest(input: NewRoutineRequest): Promise<string> {
  const { data, error } = await client().rpc('create_routine_change_request', {
    p_dog_id: input.dogId,
    p_kind: input.kind,
    p_my_day: input.myDay ?? null,
    p_my_time: input.myTime ?? null,
    p_target_user_id: input.targetUserId ?? null,
    p_their_day: input.theirDay ?? null,
    p_their_time: input.theirTime ?? null,
    p_new_time: input.newTime ?? null,
    p_note: input.note ?? null,
  });
  if (error) throw error;
  const id = data as string;
  notify(id);
  return id;
}

export async function cancelRoutineChangeRequest(id: string): Promise<void> {
  const { error } = await client().rpc('cancel_routine_change_request', { p_id: id });
  if (error) throw error;
}

export async function respondRoutineChangeRequest(id: string, accept: boolean): Promise<void> {
  const { error } = await client().rpc('respond_routine_change_request', { p_id: id, p_accept: accept });
  if (error) throw error;
  notify(id);
}

export async function decideRoutineChangeRequest(id: string, approve: boolean): Promise<void> {
  const { error } = await client().rpc('admin_decide_routine_change_request', { p_id: id, p_approve: approve });
  if (error) throw error;
  notify(id);
}

/** Hebrew text for the errors the RPCs raise on purpose. */
export function routineRequestErrorMessage(error: unknown): string {
  const text = String((error as any)?.message ?? error ?? '');
  // Messages the app itself wrote in Hebrew are already user-facing.
  if (/[\u0590-\u05FF]/.test(text)) return text;
  if (/not yours/.test(text)) return 'המשבצת הזו כבר לא שלך. רעננו את המסך ונסו שוב.';
  if (/changed, refresh/.test(text)) return 'המשבצת השתנתה בינתיים. רעננו את המסך ונסו שוב.';
  if (/already a walk at that time/.test(text)) return 'יש כבר טיול בשעה הזו ביום הזה. בחרו שעה אחרת.';
  if (/different time/.test(text)) return 'בחרו שעה אחרת מהשעה הנוכחית.';
  if (/another family member/.test(text)) return 'בחרו בן משפחה אחר.';
  if (/too many requests/.test(text)) return 'נשלחו הרבה בקשות היום. נסו שוב מחר.';
  if (/no longer open|not waiting/.test(text)) return 'הבקשה כבר טופלה. רעננו את המסך.';
  if (/admin required|read-only|no active profile/.test(text)) return 'אין הרשאה לפעולה הזו.';
  if (/network|fetch|timeout/i.test(text)) return 'אין חיבור כרגע. בדקו את האינטרנט ונסו שוב.';
  return 'הפעולה לא הצליחה. נסו שוב.';
}
