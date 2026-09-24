// supabase/functions/send-request-push/index.ts
//
// MEGA ROUND Section 10 + SECURITY CORRECTION.
//
// SECURITY MODEL (this is the whole point of this rewrite): this function
// runs with the project's SERVICE ROLE key, which bypasses RLS entirely.
// An earlier version of this function trusted client-supplied
// recipientUserIds/title/body/kind/event â€” a modified client could have
// used that to make this function push arbitrary content to arbitrary
// people. It now trusts NOTHING from the request body for authorization or
// content. The only thing the client sends that matters is `requestId`
// (plus an optional `kind` HINT purely to save one lookup â€” never trusted
// for authorization) â€” everything else is derived here, server-side, from:
//   1. The caller's identity, verified from their Authorization bearer
//      token against Supabase Auth (mirrors current_profile_id()'s
//      auth.uid()-based trust model already used throughout this schema â€”
//      see migrations/0005_requests_audit_presence.sql).
//   2. The actual persisted request row, loaded with the service-role
//      client AFTER that identity is verified.
//   3. src/logic/pushRouting.ts's validateAndRoutePushEvent() rule,
//      inlined below (Deno can't import that RN-project file at deploy
//      time â€” the canonical, unit-tested copy lives there; keep both in
//      sync if the rule ever changes).
//
// FLOW:
//   a. Extract the Authorization header from the incoming request and use
//      it to build a USER-SCOPED Supabase client (anon key + that header)
//      â€” queries through this client run AS the caller, under RLS, so
//      auth.uid()-based server functions (current_profile_id(),
//      is_family_admin()) resolve the REAL caller, never a client claim.
//   b. userClient.auth.getUser() verifies the token itself; reject with
//      401 if it's missing/invalid.
//   c. Resolve callerUserId (current_profile_id() RPC), callerFamilyId,
//      and callerIsAdmin (is_family_admin() RPC) â€” all via that
//      user-scoped, RLS-respecting client. NONE of this comes from the
//      request body.
//   d. ONLY NOW build the service-role client and load the actual request
//      row by requestId (checked against both request tables â€” `kind` from
//      the client, if sent, only picks which table to try FIRST, it is
//      never trusted as authorization).
//   e. Run validateAndRoutePushEvent(row, event, ctx) â€” rejects outright if
//      the caller isn't the party entitled to report this event, or if the
//      row's PERSISTED status doesn't actually match the claimed event
//      (e.g. can't fake an "approved" push for a still-pending request).
//   f. Re-confirm every resolved recipient's family_id via a service-role
//      `users` lookup (defense in depth, Requirement 7) before sending.
//   g. Build title/body from a small Hebrew template keyed by kind+event,
//      filled in with server-loaded names/times â€” never client text. Any
//      client-supplied `titleHint`/`bodyHint` is accepted but used ONLY as
//      a non-authoritative fallback if the template can't resolve a name
//      (e.g. a since-removed member), never verbatim beyond that.
//   h. IDEMPOTENCY (migration 0014_request_push_events.sql): only once
//      authorized, atomically claims a durable dedupe key
//      (kind:requestId:event) via claim_request_push_event() â€” a repeat
//      call for the same already-sent (or currently in-flight and fresh)
//      event returns { ok:true, sent:0, reason:"already sent" } without
//      touching the Expo API again. On success the claim is marked 'sent'
//      (permanent); on failure it's marked 'failed' (retryable by a later
//      legitimate call) rather than left stuck. See
//      src/logic/pushIdempotency.ts for the same claim/retry rule spelled
//      out as a small pure, unit-tested function, and that migration's own
//      comments for the atomicity guarantee itself.
//   i. Send via the Expo push API using tokens loaded for the validated
//      recipients only; deactivate tokens that report DeviceNotRegistered.
//
// Best-effort semantics preserved: nothing here can affect the
// already-committed request DB action that triggered this call â€” by
// construction this only ever runs AFTER that action already succeeded,
// and any failure in this function is caught and returned as a 200 with
// ok:false rather than surfaced as if the request action itself failed.

// deno-lint-ignore-file no-explicit-any
// @ts-nocheck -- Deno/Edge Function runtime globals (Deno.serve, Deno.env)
// are not available in this repo's Node/RN TypeScript project config; this
// file is only ever executed by `supabase functions deploy`, never bundled
// by Metro/tsc for the app.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT =
  Deno.env.get('VAPID_SUBJECT') ?? 'https://walkie-doggy-link.expo.app';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    VAPID_SUBJECT,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
}

type PushRequestKind = 'swap' | 'timeChange';
type PushRequestEvent = 'created' | 'approved' | 'rejected';
type PushRequestStatus = 'pending' | 'approved' | 'rejected';

interface RequestRowForPush {
  id: string;
  kind: PushRequestKind;
  familyId: string;
  status: PushRequestStatus;
  requestedByUserId: string;
  targetUserId?: string;
  proposedTime?: string; // time-change only, for the notification body
  walkId?: string;
  expectedTime?: string; // time-change only: the walk's time AS SNAPSHOTTED when the request was created — never the walk's live current time, which approval already changes
  // CONTENT ONLY, never authorization/routing — loaded purely to make the
  // push body name who/what is involved (Requirement: "who made the
  // request, who/what it concerns, requested change, result, relevant
  // walk/time"). None of these fields are read by
  // validateAndRoutePushEvent() above.
  requesterName?: string;
  targetName?: string; // swap only
  dogName?: string;
  walkDate?: string;
  walkScheduledTime?: string; // the walk's current scheduled time — stable context for a swap (time never changes); NOT used as the "before" time for a time-change (see expectedTime)
}

const STATUS_FOR_EVENT: Record<PushRequestEvent, PushRequestStatus> = {
  created: 'pending',
  approved: 'approved',
  rejected: 'rejected',
};

// Inlined copy of src/logic/pushRouting.ts's validateAndRoutePushEvent() â€”
// see that file for the canonical, unit-tested version and the reasoning
// behind every check. Kept deliberately identical in behavior.
function validateAndRoutePushEvent(
  row: RequestRowForPush,
  event: PushRequestEvent,
  ctx: {
    callerUserId: string;
    callerFamilyId: string;
    callerIsAdmin: boolean;
    familyAdminUserIds?: string[];
    recipientFamilyIds?: Record<string, string>;
  }
): { authorized: boolean; reason?: string; recipientUserIds: string[] } {
  const deny = (reason: string) => ({ authorized: false, reason, recipientUserIds: [] as string[] });

  if (ctx.callerFamilyId !== row.familyId) return deny("caller is not a member of the request's family");
  if (row.status !== STATUS_FOR_EVENT[event]) return deny("request's persisted status does not match the claimed event");

  let recipientUserIds: string[];

  if (event === 'approved' || event === 'rejected') {
    if (row.kind === 'swap') {
      if (ctx.callerUserId !== row.targetUserId) return deny('only the swap target may report a decision on this request');
    } else if (!ctx.callerIsAdmin) {
      return deny('only an admin may report a decision on a time-change request');
    }
    // Product decision: a decision push goes to the requester AND every
    // current admin (both kinds) — deduped, so a requester/actor who is
    // also an admin never gets two pushes for the same event.
    recipientUserIds = [...new Set([row.requestedByUserId, ...(ctx.familyAdminUserIds ?? [])].filter(Boolean))];
  } else {
    if (ctx.callerUserId !== row.requestedByUserId) return deny('only the requester may report a request as newly created');
    if (row.kind === 'swap') {
      if (!row.targetUserId) return deny('swap request has no target to notify');
      recipientUserIds = [row.targetUserId];
    } else {
      recipientUserIds = [...new Set((ctx.familyAdminUserIds ?? []).filter(Boolean))];
    }
  }

  if (ctx.recipientFamilyIds) {
    recipientUserIds = recipientUserIds.filter((id) => ctx.recipientFamilyIds![id] === row.familyId);
  }

  if (recipientUserIds.length === 0) return deny('no valid same-family recipient resolved');

  return { authorized: true, recipientUserIds };
}

// Real names/times fill these in when the content-only enrichment lookup
// (Step 4b above) resolved them; a generic, gender-neutral term ("\u05d1\u05df/\u05d1\u05ea
// \u05d4\u05de\u05e9\u05e4\u05d7\u05d4", "\u05d4\u05db\u05dc\u05d1/\u05d4") stands in for anything that couldn't be resolved
// (e.g. a since-removed member, or a walk/dog that no longer exists) \u2014
// the push is never sent with a literal "undefined" in it.
const FALLBACK_PERSON = '\u05d1\u05df/\u05d1\u05ea \u05d4\u05de\u05e9\u05e4\u05d7\u05d4'; // \u05d1\u05df/\u05d1\u05ea \u05d4\u05de\u05e9\u05e4\u05d7\u05d4
const FALLBACK_DOG = '\u05d4\u05db\u05dc\u05d1/\u05d4'; // \u05d4\u05db\u05dc\u05d1/\u05d4

// Inlined copy of src/logic/dateFormat.ts's formatHistoryDate() \u2014 same
// "YYYY-MM-DD" -> "\u05d4\u05d9\u05d5\u05dd" or "DD-MM-YYYY" convention the rest of the app
// already uses for viewer-facing dates. Deno can't import that RN-project
// file at deploy time (same limitation as pushRouting.ts's own inlined
// copy above); kept deliberately identical in behavior.
function formatWalkDate(isoDate: string): string {
  const now = new Date();
  const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (isoDate === localToday) return '\u05d4\u05d9\u05d5\u05dd'; // \u05d4\u05d9\u05d5\u05dd
  const [year, month, day] = isoDate.split('-');
  return `${day}-${month}-${year}`;
}

function walkContext(row: RequestRowForPush): string {
  const dog = row.dogName ?? FALLBACK_DOG;
  const time = row.walkScheduledTime;
  const date = row.walkDate ? formatWalkDate(row.walkDate) : undefined;
  if (time && date) return `${dog}, ${date} \u05d1\u05e9\u05e2\u05d4 ${time}`; // "{dog}, {date} \u05d1\u05e9\u05e2\u05d4 {time}"
  if (time) return `${dog} \u05d1\u05e9\u05e2\u05d4 ${time}`; // "{dog} \u05d1\u05e9\u05e2\u05d4 {time}"
  return dog;
}

function templateFor(kind: PushRequestKind, event: PushRequestEvent, row: RequestRowForPush): { title: string; body: string } {
  const requester = row.requesterName ?? FALLBACK_PERSON;
  const target = row.targetName ?? FALLBACK_PERSON;
  const walk = walkContext(row);

  if (kind === 'swap') {
    if (event === 'created') {
      return {
        title: '\u05d1\u05e7\u05e9\u05ea \u05d4\u05d7\u05dc\u05e4\u05ea \u05ea\u05d5\u05e8', // \u05d1\u05e7\u05e9\u05ea \u05d4\u05d7\u05dc\u05e4\u05ea \u05ea\u05d5\u05e8
        // "{requester} \u05d1\u05d9\u05e7\u05e9/\u05d4 \u05dc\u05d4\u05d7\u05dc\u05d9\u05e3 \u05d0\u05d9\u05ea\u05da \u05d0\u05ea \u05d4\u05d8\u05d9\u05d5\u05dc \u05e9\u05dc {walk} \u2014 \u05d9\u05e9 \u05dc\u05d0\u05e9\u05e8 \u05d0\u05d5 \u05dc\u05d3\u05d7\u05d5\u05ea"
        body: `${requester} \u05d1\u05d9\u05e7\u05e9/\u05d4 \u05dc\u05d4\u05d7\u05dc\u05d9\u05e3 \u05d0\u05d9\u05ea\u05da \u05d0\u05ea \u05d4\u05d8\u05d9\u05d5\u05dc \u05e9\u05dc ${walk} \u2014 \u05d9\u05e9 \u05dc\u05d0\u05e9\u05e8 \u05d0\u05d5 \u05dc\u05d3\u05d7\u05d5\u05ea`,
      };
    }
    const resultWord = event === 'approved'
      ? '\u05d0\u05d5\u05e9\u05e8\u05d4' // \u05d0\u05d5\u05e9\u05e8\u05d4
      : '\u05e0\u05d3\u05d7\u05ea\u05d4'; // \u05e0\u05d3\u05d7\u05ea\u05d4
    return {
      title: event === 'approved'
        ? '\u05d1\u05e7\u05e9\u05ea \u05d4\u05d7\u05dc\u05e4\u05d4 \u05d0\u05d5\u05e9\u05e8\u05d4' // \u05d1\u05e7\u05e9\u05ea \u05d4\u05d7\u05dc\u05e4\u05d4 \u05d0\u05d5\u05e9\u05e8\u05d4
        : '\u05d1\u05e7\u05e9\u05ea \u05d4\u05d7\u05dc\u05e4\u05d4 \u05e0\u05d3\u05d7\u05ea\u05d4', // \u05d1\u05e7\u05e9\u05ea \u05d4\u05d7\u05dc\u05e4\u05d4 \u05e0\u05d3\u05d7\u05ea\u05d4
      // "{target} {\u05d0\u05d9\u05e9\u05e8/\u05d4 \u05d0\u05d5 \u05d3\u05d7\u05d4/\u05ea\u05d4} \u05d0\u05ea \u05d1\u05e7\u05e9\u05ea {requester} \u05dc\u05d4\u05d7\u05dc\u05e4\u05ea \u05d4\u05d8\u05d9\u05d5\u05dc \u05e9\u05dc {walk}"
      body: `${target} ${event === 'approved' ? '\u05d0\u05d9\u05e9\u05e8/\u05d4' : '\u05d3\u05d7\u05d4/\u05ea\u05d4'} \u05d0\u05ea \u05d1\u05e7\u05e9\u05ea ${requester} \u05dc\u05d4\u05d7\u05dc\u05e4\u05ea \u05d4\u05d8\u05d9\u05d5\u05dc \u05e9\u05dc ${walk} \u2014 \u05d4\u05d1\u05e7\u05e9\u05d4 ${resultWord}`,
    };
  }

  // time-change \u2014 "from" is the request's own snapshotted expected_time,
  // NEVER the walk's live scheduled_time (approval already updates that to
  // the new value, which would make "from X to X" nonsensical here).
  const fromTo = row.proposedTime && row.expectedTime
    ? `\u05de-${row.expectedTime} \u05dc-${row.proposedTime}` // "\u05de-{old} \u05dc-{new}"
    : row.proposedTime
      ? `\u05dc-${row.proposedTime}` // "\u05dc-{new}" \u2014 the old time is unknown, so don't show one at all
      : undefined;

  if (event === 'created') {
    return {
      title: '\u05d1\u05e7\u05e9\u05ea \u05e9\u05d9\u05e0\u05d5\u05d9 \u05e9\u05e2\u05d4', // \u05d1\u05e7\u05e9\u05ea \u05e9\u05d9\u05e0\u05d5\u05d9 \u05e9\u05e2\u05d4
      // "{requester} \u05d1\u05d9\u05e7\u05e9/\u05d4 \u05dc\u05e9\u05e0\u05d5\u05ea \u05d0\u05ea \u05e9\u05e2\u05ea \u05d4\u05d8\u05d9\u05d5\u05dc \u05e9\u05dc {dog} ({date}) \u05de-{old} \u05dc-{new} \u2014 \u05d9\u05e9 \u05dc\u05d0\u05e9\u05e8 \u05d0\u05d5 \u05dc\u05d3\u05d7\u05d5\u05ea"
      body: `${requester} \u05d1\u05d9\u05e7\u05e9/\u05d4 \u05dc\u05e9\u05e0\u05d5\u05ea \u05d0\u05ea \u05e9\u05e2\u05ea \u05d4\u05d8\u05d9\u05d5\u05dc \u05e9\u05dc ${row.dogName ?? FALLBACK_DOG}${row.walkDate ? ` (${formatWalkDate(row.walkDate)})` : ''}${fromTo ? ` ${fromTo}` : ''} \u2014 \u05d9\u05e9 \u05dc\u05d0\u05e9\u05e8 \u05d0\u05d5 \u05dc\u05d3\u05d7\u05d5\u05ea`,
    };
  }

  const resultWord = event === 'approved'
    ? '\u05d0\u05d5\u05e9\u05e8\u05d4' // \u05d0\u05d5\u05e9\u05e8\u05d4
    : '\u05e0\u05d3\u05d7\u05ea\u05d4'; // \u05e0\u05d3\u05d7\u05ea\u05d4
  return {
    title: event === 'approved'
      ? '\u05d1\u05e7\u05e9\u05ea \u05e9\u05d9\u05e0\u05d5\u05d9 \u05e9\u05e2\u05d4 \u05d0\u05d5\u05e9\u05e8\u05d4' // \u05d1\u05e7\u05e9\u05ea \u05e9\u05d9\u05e0\u05d5\u05d9 \u05e9\u05e2\u05d4 \u05d0\u05d5\u05e9\u05e8\u05d4
      : '\u05d1\u05e7\u05e9\u05ea \u05e9\u05d9\u05e0\u05d5\u05d9 \u05e9\u05e2\u05d4 \u05e0\u05d3\u05d7\u05ea\u05d4', // \u05d1\u05e7\u05e9\u05ea \u05e9\u05d9\u05e0\u05d5\u05d9 \u05e9\u05e2\u05d4 \u05e0\u05d3\u05d7\u05ea\u05d4
    // "\u05d1\u05e7\u05e9\u05ea {requester} \u05dc\u05e9\u05e0\u05d5\u05ea \u05d0\u05ea \u05e9\u05e2\u05ea \u05d4\u05d8\u05d9\u05d5\u05dc \u05e9\u05dc {dog} ({date}) \u05de-{old} \u05dc-{new} {\u05d0\u05d5\u05e9\u05e8\u05d4/\u05e0\u05d3\u05d7\u05ea\u05d4}"
    body: `\u05d1\u05e7\u05e9\u05ea ${requester} \u05dc\u05e9\u05e0\u05d5\u05ea \u05d0\u05ea \u05e9\u05e2\u05ea \u05d4\u05d8\u05d9\u05d5\u05dc \u05e9\u05dc ${row.dogName ?? FALLBACK_DOG}${row.walkDate ? ` (${formatWalkDate(row.walkDate)})` : ''}${fromTo ? ` ${fromTo}` : ''} ${resultWord}`,
  };
}
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    // ---- Step 1: authenticate the caller from their own bearer token ----
    const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, error: 'missing Authorization header' }), { status: 401 });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // User-scoped client: runs AS the caller under RLS â€” auth.uid()-based
    // server functions below resolve the REAL, verified caller. This is
    // the equivalent of current_profile_id()'s trust model, applied here
    // via an actual authenticated PostgREST/RPC call rather than a raw JWT
    // decode, so an expired/tampered/revoked token is rejected the exact
    // same way Supabase Auth already rejects it everywhere else.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData?.user) {
      return new Response(JSON.stringify({ ok: false, error: 'invalid or expired session' }), { status: 401 });
    }

    // ---- Step 2: resolve caller profile/family/admin-status server-side ----
    const { data: callerUserId, error: profileError } = await userClient.rpc('current_profile_id');
    if (profileError || !callerUserId) {
      return new Response(JSON.stringify({ ok: false, error: 'no active profile for this session' }), { status: 403 });
    }

    const { data: callerRow, error: callerRowError } = await userClient
      .from('users')
      .select('family_id')
      .eq('id', callerUserId)
      .single();
    if (callerRowError || !callerRow) {
      return new Response(JSON.stringify({ ok: false, error: 'could not resolve caller family' }), { status: 403 });
    }
    const callerFamilyId = callerRow.family_id as string;

    const { data: callerIsAdmin } = await userClient.rpc('is_family_admin', { target_family_id: callerFamilyId });

    // ---- Step 3: parse the request body â€” ONLY a trigger hint, never authorization ----
    const body = await req.json();
    const requestId: string | undefined = body?.requestId;
    const event: PushRequestEvent | undefined = body?.event;
    const kindHint: PushRequestKind | undefined = body?.kind;

    if (!requestId || !event || !['created', 'approved', 'rejected'].includes(event)) {
      return new Response(JSON.stringify({ ok: false, error: 'requestId and a valid event are required' }), { status: 400 });
    }

    // ---- Step 4: load the ACTUAL persisted request row, service-role, now that identity is verified ----
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    async function loadRow(kind: PushRequestKind): Promise<RequestRowForPush | null> {
      if (kind === 'swap') {
        const { data } = await serviceClient
          .from('walk_swap_requests')
          .select('id, family_id, status, requested_by_user_id, target_user_id, walk_id')
          .eq('id', requestId)
          .maybeSingle();
        if (!data) return null;
        return {
          id: data.id,
          kind: 'swap',
          familyId: data.family_id,
          status: data.status,
          requestedByUserId: data.requested_by_user_id,
          targetUserId: data.target_user_id,
          walkId: data.walk_id,
        };
      }
      const { data } = await serviceClient
        .from('time_change_requests')
        .select('id, family_id, status, requested_by_user_id, proposed_time, expected_time, walk_id')
        .eq('id', requestId)
        .maybeSingle();
      if (!data) return null;
      return {
        id: data.id,
        kind: 'timeChange',
        familyId: data.family_id,
        status: data.status,
        requestedByUserId: data.requested_by_user_id,
        proposedTime: data.proposed_time,
        expectedTime: data.expected_time,
        walkId: data.walk_id,
      };
    }

    let row = kindHint ? await loadRow(kindHint) : null;
    if (!row) row = (await loadRow('swap')) ?? (await loadRow('timeChange'));
    if (!row) {
      return new Response(JSON.stringify({ ok: false, error: 'request not found' }), { status: 404 });
    }

    // ---- Step 4b: CONTENT-ONLY enrichment (names/walk/time for the push
    // body) — never used for authorization/routing, only for wording.
    // Best-effort: any lookup that comes back empty just falls back to a
    // generic term in templateFor() below rather than failing the send.
    {
      const nameIds = [row.requestedByUserId, row.targetUserId].filter(Boolean) as string[];
      const [walkResult, namesResult] = await Promise.all([
        row.walkId
          ? serviceClient.from('walks').select('date, scheduled_time, dog_id').eq('id', row.walkId).maybeSingle()
          : Promise.resolve({ data: null }),
        nameIds.length > 0
          ? serviceClient.from('users').select('id, name').in('id', nameIds)
          : Promise.resolve({ data: [] }),
      ]);
      const walkRow = (walkResult as any)?.data;
      row.walkDate = walkRow?.date ?? undefined;
      row.walkScheduledTime = walkRow?.scheduled_time ?? undefined;
      if (walkRow?.dog_id) {
        const { data: dogRow } = await serviceClient.from('dogs').select('name').eq('id', walkRow.dog_id).maybeSingle();
        row.dogName = dogRow?.name ?? undefined;
      }
      const names: Record<string, string> = Object.fromEntries(
        ((namesResult as any)?.data ?? []).map((u: any) => [u.id, u.name])
      );
      row.requesterName = names[row.requestedByUserId];
      row.targetName = row.targetUserId ? names[row.targetUserId] : undefined;
    }

    // ---- Step 5: server-side admin roster ----
    // Needed for a time-change 'created' fan-out (unchanged), and now also
    // for EVERY 'approved'/'rejected' decision event on either kind
    // (product decision: every current admin sees every resolution,
    // alongside the requester — see validateAndRoutePushEvent above).
    let familyAdminUserIds: string[] | undefined;
    if ((row.kind === 'timeChange' && event === 'created') || event === 'approved' || event === 'rejected') {
      // family_auth_members is keyed by auth_user_id (a DEVICE's auth
      // identity), not by users.id (a family-member PROFILE) â€” users.
      // auth_user_id is the join. See schema.sql's own comment on this
      // distinction.
      const { data: adminAuthRows } = await serviceClient
        .from('family_auth_members')
        .select('auth_user_id')
        .eq('family_id', row.familyId)
        .eq('role', 'admin');
      const adminAuthIds = (adminAuthRows ?? []).map((a: any) => a.auth_user_id).filter(Boolean);
      if (adminAuthIds.length > 0) {
        const { data: adminProfiles } = await serviceClient
          .from('users')
          .select('id')
          .eq('family_id', row.familyId)
          .in('auth_user_id', adminAuthIds)
          .is('removed_at', null);
        familyAdminUserIds = [...new Set((adminProfiles ?? []).map((u: any) => u.id).filter(Boolean))];
      } else {
        familyAdminUserIds = [];
      }
    }

    // ---- Step 6: candidate recipients' family membership (Requirement 7, defense in depth) ----
    // .is('removed_at', null) excludes a since-removed member from
    // recipientFamilyIds entirely, so validateAndRoutePushEvent()'s filter
    // below drops them even if the row that triggered this event still
    // names them (e.g. a time-change request whose requester was removed
    // from the family before an admin approved/rejected it) — a removed
    // member's push_tokens/web_push_subscriptions are also deactivated at
    // removal time (migration 0037), so this is belt-and-suspenders, not
    // the only guard.
    const candidateIds = new Set<string>();
    if (row.targetUserId) candidateIds.add(row.targetUserId);
    candidateIds.add(row.requestedByUserId);
    (familyAdminUserIds ?? []).forEach((id) => candidateIds.add(id));

    let recipientFamilyIds: Record<string, string> | undefined;
    if (candidateIds.size > 0) {
      const { data: candidateRows } = await serviceClient
        .from('users')
        .select('id, family_id')
        .in('id', [...candidateIds])
        .is('removed_at', null);
      recipientFamilyIds = Object.fromEntries((candidateRows ?? []).map((u: any) => [u.id, u.family_id]));
    }

    // ---- Step 7: the authorization + routing decision itself ----
    const routing = validateAndRoutePushEvent(row, event, {
      callerUserId,
      callerFamilyId,
      callerIsAdmin: !!callerIsAdmin,
      familyAdminUserIds,
      recipientFamilyIds,
    });

    if (!routing.authorized) {
      // Not an error the client did anything observably wrong with (from
      // its own point of view it just asked "tell people about my
      // request") â€” respond 200/ok:false so this never surfaces as if the
      // already-committed request action failed.
      return new Response(JSON.stringify({ ok: false, sent: 0, reason: routing.reason }), { status: 200 });
    }

    // ---- Step 8: IDEMPOTENCY CLAIM â€” strictly AFTER authorization, never before ----
    // Only an already-`routing.authorized` call reaches this point, so an
    // unauthorized caller can never create/touch a request_push_events row
    // at all (verified by this ordering â€” see the final report for how
    // this was checked, since the Deno handler itself isn't unit-testable
    // in this environment). buildDedupeKey() mirrors
    // src/logic/pushRouting.ts's version exactly (same "kind:id:event"
    // shape â€” see that file's doc comment on keeping both in sync).
    const dedupeKey = `${row.kind}:${row.id}:${event}`;
    const { data: claimed, error: claimError } = await serviceClient.rpc('claim_request_push_event', {
      p_dedupe_key: dedupeKey,
      p_kind: row.kind,
      p_request_id: row.id,
      p_event: event,
    });
    if (claimError) throw claimError;
    if (!claimed) {
      // Someone else already sent this exact (kind, requestId, event), or
      // is currently sending it and that attempt isn't stale yet â€” the
      // atomic DB claim (not this check) is what actually prevents a race;
      // this is just reporting its outcome.
      return new Response(JSON.stringify({ ok: true, sent: 0, reason: 'already sent' }), { status: 200 });
    }

    // ---- Step 9: template the content server-side â€” never forward client text ----
    const { title, body: pushBody } = templateFor(row.kind, event, row);

    try {
      // ---- Step 10: load all active delivery targets BEFORE sending ----
      const { data: tokenRows, error: tokenError } = await serviceClient
        .from('push_tokens')
        .select('id, user_id, token')
        .in('user_id', routing.recipientUserIds)
        .eq('is_active', true);
      if (tokenError) throw tokenError;

      const { data: webPushRows, error: webPushError } = await serviceClient
        .from('web_push_subscriptions')
        .select('id, user_id, endpoint, p256dh, auth')
        .in('user_id', routing.recipientUserIds)
        .eq('is_active', true);
      if (webPushError) throw webPushError;

      const expoTokens = tokenRows ?? [];
      const webSubscriptions = webPushRows ?? [];

      if (expoTokens.length === 0 && webSubscriptions.length === 0) {
        await serviceClient.rpc('mark_request_push_event', {
          p_dedupe_key: dedupeKey,
          p_status: 'sent',
        });

        return new Response(
          JSON.stringify({
            ok: true,
            sent: 0,
            expoSent: 0,
            webSent: 0,
            reason: 'no active push destinations',
          }),
          { status: 200 }
        );
      }

      let expoSent = 0;
      let webSent = 0;
      const deliveryErrors: string[] = [];

      // ---- Expo Push ----
      if (expoTokens.length > 0) {
        try {
          const messages = expoTokens.map((r: any) => ({
            to: r.token,
            title,
            body: pushBody,
            data: {
              type: 'request',
              requestId: row.id,
              kind: row.kind,
              event,
            },
            sound: 'default',
            priority: 'high',
          }));

          const expoResponse = await fetch(EXPO_PUSH_URL, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json',
            },
            body: JSON.stringify(messages),
          });

          if (!expoResponse.ok) {
            throw new Error(`Expo Push HTTP ${expoResponse.status}`);
          }

          const expoResult = await expoResponse.json();

          const tickets = Array.isArray(expoResult?.data)
            ? expoResult.data
            : [];

          const deactivations: Promise<any>[] = [];

          tickets.forEach((ticket: any, i: number) => {
            const tokenRow = expoTokens[i];
            if (!tokenRow) return;

            if (ticket?.status === 'ok') {
              expoSent += 1;
              return;
            }

            if (ticket?.status === 'error') {
              const isPermanent =
                ticket?.details?.error === 'DeviceNotRegistered';

              deactivations.push(
                serviceClient
                  .from('push_tokens')
                  .update({
                    is_active: !isPermanent,
                    last_error: String(
                      ticket.message ??
                        ticket.details?.error ??
                        'unknown error'
                    ),
                  })
                  .eq('id', tokenRow.id)
              );
            }
          });

          if (deactivations.length > 0) {
            await Promise.allSettled(deactivations);
          }
        } catch (expoErr) {
          console.error('Expo Push failed', expoErr);
          deliveryErrors.push(`expo: ${String(expoErr)}`);
        }
      }

      // ---- Web Push ----
      if (webSubscriptions.length > 0) {
        if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
          deliveryErrors.push('web: VAPID keys are not configured');
        } else {
          const payload = JSON.stringify({
            title,
            body: pushBody,
            data: {
              type: 'request',
              requestId: row.id,
              kind: row.kind,
              event,
            },
          });

          const webResults = await Promise.allSettled(
            webSubscriptions.map(async (subscriptionRow: any) => {
              try {
                await webpush.sendNotification(
                  {
                    endpoint: subscriptionRow.endpoint,
                    keys: {
                      p256dh: subscriptionRow.p256dh,
                      auth: subscriptionRow.auth,
                    },
                  },
                  payload
                );

                webSent += 1;

                await serviceClient
                  .from('web_push_subscriptions')
                  .update({
                    is_active: true,
                    last_error: null,
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', subscriptionRow.id);
              } catch (pushErr: any) {
                const statusCode =
                  pushErr?.statusCode ?? pushErr?.status ?? null;

                const isPermanent =
                  statusCode === 404 || statusCode === 410;

                await serviceClient
                  .from('web_push_subscriptions')
                  .update({
                    is_active: !isPermanent,
                    last_error: String(
                      pushErr?.message ?? pushErr ?? 'unknown Web Push error'
                    ),
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', subscriptionRow.id);

                throw pushErr;
              }
            })
          );

          for (const result of webResults) {
            if (result.status === 'rejected') {
              deliveryErrors.push(`web: ${String(result.reason)}`);
            }
          }
        }
      }

      const totalSent = expoSent + webSent;

      // If at least one destination succeeded, do not retry the whole event:
      // that could duplicate a notification on a channel that already succeeded.
      if (totalSent > 0) {
        await serviceClient.rpc('mark_request_push_event', {
          p_dedupe_key: dedupeKey,
          p_status: 'sent',
        });

        return new Response(
          JSON.stringify({
            ok: true,
            sent: totalSent,
            expoSent,
            webSent,
            deliveryErrors,
          }),
          { status: 200 }
        );
      }

      // Nothing succeeded, so allow a later legitimate retry.
      console.error('Push delivery failed', { dedupeKey, expoSent, webSent, deliveryErrors });
      await serviceClient.rpc('mark_request_push_event', {
        p_dedupe_key: dedupeKey,
        p_status: 'failed',
      });

      return new Response(
        JSON.stringify({
          ok: false,
          sent: 0,
          expoSent: 0,
          webSent: 0,
          deliveryErrors,
        }),
        { status: 200 }
      );
    } catch (sendErr) {
      console.error('Push send block failed', sendErr);
      await serviceClient.rpc('mark_request_push_event', {
        p_dedupe_key: dedupeKey,
        p_status: 'failed',
      });

      return new Response(
        JSON.stringify({
          ok: false,
          error: String(sendErr),
        }),
        { status: 200 }
      );
    }
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 200 });
  }
});



