-- Chat: read messages kept showing as unread (millisecond vs microsecond).
--
-- Field report 2026-11-06: chat messages that had been read still appeared as
-- unread (the tab badge never cleared). Root cause is a timestamp-precision
-- mismatch, confirmed against production:
--   * chat_messages.created_at is stored at microsecond precision, e.g.
--     2026-11-05 18:19:11.843978+00.
--   * The client marks a conversation read using the newest message's own
--     createdAt, but that value has round-tripped through a JavaScript Date,
--     which only keeps millisecond precision — so chat_mark_read persists
--     last_read_at = 2026-11-05 18:19:11.843 (the .978µs tail is lost).
--   * chat_unread_count then compares `msg.created_at > p_last_read_at`, i.e.
--     .843978 > .843000 => TRUE, so the very message the user just read is
--     counted as unread forever. Every message whose createdAt carries sub-
--     millisecond microseconds hits this.
--
-- Fix: compare both sides at millisecond granularity (date_trunc to
-- 'milliseconds'), matching the precision the client can actually supply. A
-- message read "up to millisecond T" is then correctly treated as read. The
-- only behavioural change is a sub-millisecond boundary: a message arriving in
-- the exact same millisecond as the read marker is treated as read — a <1ms
-- window with no practical effect.
--
-- chat_unread_count is an internal helper (execute revoked from everyone; only
-- the SECURITY DEFINER chat_* functions call it), so this transparently fixes
-- both the conversation-list badge (chat_conversation_state) and the value
-- returned by chat_mark_read. No data backfill is needed — the stored
-- last_read_at values become correct the moment the comparison is millisecond-
-- aware. Signature, security, search_path and the revoke are unchanged.

create or replace function chat_unread_count(
  p_conversation_id uuid,
  p_user_id uuid,
  p_last_read_at timestamptz
)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select count(*)::integer
  from chat_messages msg
  where msg.conversation_id = p_conversation_id
    and msg.deleted_at is null
    and msg.sender_user_id is distinct from p_user_id
    and date_trunc('milliseconds', msg.created_at) > date_trunc('milliseconds', p_last_read_at)
    and date_trunc('milliseconds', msg.created_at) > coalesce((
      select date_trunc('milliseconds', m.cleared_at)
      from chat_conversation_members m
      where m.conversation_id = p_conversation_id and m.user_id = p_user_id
    ), '-infinity'::timestamptz);
$function$;

-- Keep it internal (mirrors 0108): callers are other SECURITY DEFINER chat_*
-- functions, never the client directly.
revoke all on function chat_unread_count(uuid, uuid, timestamptz) from public, anon, authenticated;
