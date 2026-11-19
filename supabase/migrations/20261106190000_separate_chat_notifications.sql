-- Separate chat-message notifications from walk / reminder notifications.
--
-- Field report 2026-11-06: reminders_enabled was a single master switch for all
-- push. chat_push_recipients() filtered on `u.reminders_enabled`, so a member
-- who turned OFF walk reminders also stopped receiving chat notifications. Some
-- members want walk notifications off but chat notifications on.
--
-- Add a dedicated per-user chat preference. Walk / reminder / request / GPS
-- functions keep using reminders_enabled; only chat push moves to the new flag.
-- Per-conversation mute (chat_conversation_members.notifications_muted) still
-- applies on top of it.

alter table users
  add column if not exists chat_notifications_enabled boolean not null default true;

-- Preserve existing behaviour: a member who had everything off
-- (reminders_enabled = false) keeps chat off too, rather than suddenly starting
-- to receive chat pushes after this migration. New rows default to true, so a
-- new member gets both walk and chat notifications by default.
update users
  set chat_notifications_enabled = reminders_enabled
  where chat_notifications_enabled is distinct from reminders_enabled;

-- Same per-column client-write grant as reminders_enabled / gamification_enabled.
-- Table-wide UPDATE on users stays revoked from authenticated (migration 0016);
-- this flag is self-service (a member toggles their own, an admin any member's),
-- gated by the existing users UPDATE RLS policy (self-or-admin, active).
grant update (chat_notifications_enabled) on public.users to authenticated;

-- Chat push now gates on the chat preference instead of reminders_enabled. Body
-- is otherwise identical to the prior definition (signature, security,
-- search_path unchanged); only the `u.reminders_enabled` predicate changes to
-- `u.chat_notifications_enabled`.
create or replace function chat_push_recipients(p_message_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select u.id
  from chat_messages msg
  join chat_conversations c on c.id = msg.conversation_id
  join users u on u.family_id = c.family_id
    and (
      c.kind = 'family'
      or (c.kind = 'direct' and u.id in (c.direct_user_low, c.direct_user_high))
    )
  left join chat_conversation_members m
    on m.conversation_id = c.id and m.user_id = u.id
  where msg.id = p_message_id
    and msg.deleted_at is null
    and u.removed_at is null
    and u.id is distinct from msg.sender_user_id
    and u.chat_notifications_enabled
    and coalesce(m.notifications_muted, false) = false;
$function$;
