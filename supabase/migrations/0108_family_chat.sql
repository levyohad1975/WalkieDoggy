-- ============================================================================
-- 0108_family_chat.sql
--
-- Family Chat, Phase 1: one private group conversation per family.
--
-- ADDITIVE ONLY. No existing table, policy, function or trigger is altered
-- or dropped. Every statement is idempotent (`if not exists` /
-- `create or replace` / `drop policy if exists`), so re-running is safe.
--
-- SECURITY MODEL
--
--   * Clients can only SELECT. There is no INSERT/UPDATE/DELETE policy on any
--     chat table, and table privileges are reduced to SELECT, so every write
--     goes through a SECURITY DEFINER RPC below.
--   * The sender is ALWAYS derived server-side from auth.uid() via
--     real_current_profile_id(). No RPC accepts a sender id.
--   * Identity is the caller's REAL claimed profile, deliberately not
--     current_profile_id(): an admin who is impersonating a member must never
--     be able to post as that member, and a System Admin hidden observer must
--     never be able to read a family's private conversation. Both cases are
--     handled in chat_actor_profile_id() / the write RPCs.
--   * Family isolation is enforced by chat_can_access_conversation(), which
--     every SELECT policy and every RPC goes through. Supabase Realtime
--     evaluates the same SELECT policy per subscriber, so a postgres_changes
--     subscription cannot leak another family's rows either.
--
-- PHASE 2 READINESS (architecture only — nothing below is reachable yet)
--
--   Conversations are modelled independently of families:
--   chat_conversations.kind is 'family' | 'direct' | 'group', and
--   chat_conversation_members is an explicit per-profile membership table.
--   For kind = 'family', access is derived from live family membership (so a
--   member who joins or is removed needs no bookkeeping) and the membership
--   row only carries per-member state (read marker, mute). For the future
--   cross-family kinds, the membership row itself becomes the authorization
--   boundary — that branch already exists in chat_can_access_conversation().
--   chat_messages.family_id records the SENDER's family, which is what
--   cross-family attribution and per-family moderation will need.
--   A CHECK constraint keeps kind = 'family' until a Phase 2 migration
--   deliberately lifts it. See docs/engineering/FAMILY_CHAT_ARCHITECTURE.md.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------

create table if not exists chat_conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'family' check (kind in ('family', 'direct', 'group')),
  -- Owning family. Required for kind = 'family'; cross-family kinds (Phase 2)
  -- have no single owner and leave it null.
  family_id uuid references families(id) on delete cascade,
  title text check (title is null or char_length(title) <= 80),
  created_by_user_id uuid references users(id) on delete set null,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_conversations_family_kind_has_family
    check (kind <> 'family' or family_id is not null),
  -- Fail-closed Phase 1 guard: no cross-family conversation can exist, by any
  -- code path, until a Phase 2 migration drops this constraint on purpose.
  constraint chat_conversations_phase1_family_only check (kind = 'family')
);

-- Exactly one family conversation per family.
create unique index if not exists chat_conversations_one_per_family_idx
  on chat_conversations (family_id) where kind = 'family';

create table if not exists chat_conversation_members (
  conversation_id uuid not null references chat_conversations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  -- The member's own family (differs from the conversation's family only for
  -- Phase 2 cross-family conversations).
  family_id uuid not null references families(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  notifications_muted boolean not null default false,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (conversation_id, user_id)
);

create index if not exists chat_conversation_members_user_idx
  on chat_conversation_members (user_id);

create table if not exists chat_messages (
  -- Supplied by the sending client (a random uuid) and used as the
  -- idempotency key: retrying the same send can never create a second row.
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references chat_conversations(id) on delete cascade,
  -- The SENDER's family at send time.
  family_id uuid not null references families(id) on delete cascade,
  -- Nullable so a hard-deleted profile can never take the family's history
  -- with it. (Profiles are soft-deleted in practice, so this stays set.)
  sender_user_id uuid references users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by_user_id uuid references users(id) on delete set null,
  -- A live message has 1..2000 characters; a moderated message keeps its row
  -- (so the thread shows "message removed") but its text is erased.
  constraint chat_messages_body_valid check (
    (deleted_at is null and char_length(body) between 1 and 2000)
    or (deleted_at is not null and body = '')
  )
);

create index if not exists chat_messages_conversation_created_idx
  on chat_messages (conversation_id, created_at desc, id desc);
create index if not exists chat_messages_sender_created_idx
  on chat_messages (sender_user_id, created_at desc);

-- Server-only push de-duplication ledger (one row per message), same
-- claim/mark shape as request_push_events (0014/0102).
create table if not exists chat_push_events (
  message_id uuid primary key references chat_messages(id) on delete cascade,
  status text not null default 'sending'
    check (status in ('sending', 'sent', 'failed', 'no_destination')),
  attempt_count int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 2. Identity and access helpers
-- ----------------------------------------------------------------------------

-- The caller's REAL claimed profile, or null. Null for a System Admin hidden
-- observer: a family's conversation is private to its members.
create or replace function chat_actor_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when active_system_admin_observer_family() is not null then null
    else real_current_profile_id()
  end;
$$;

-- The single authorization predicate for chat. Used by every SELECT policy
-- (and therefore by Realtime) and by every RPC.
create or replace function chat_can_access_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from chat_conversations c
    join users u on u.id = chat_actor_profile_id()
    where c.id = p_conversation_id
      and u.removed_at is null
      and (
        (
          c.kind = 'family'
          and c.family_id = u.family_id
          -- current_family_id() is already gated on an 'active' family.
          and c.family_id = current_family_id()
        )
        or (
          c.kind <> 'family'
          and exists (
            select 1
            from chat_conversation_members m
            where m.conversation_id = c.id
              and m.user_id = u.id
              and m.left_at is null
          )
        )
      )
  );
$$;

create or replace function chat_unread_count(
  p_conversation_id uuid,
  p_user_id uuid,
  p_last_read_at timestamptz
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from chat_messages msg
  where msg.conversation_id = p_conversation_id
    and msg.deleted_at is null
    and msg.sender_user_id is distinct from p_user_id
    and msg.created_at > p_last_read_at;
$$;

-- ----------------------------------------------------------------------------
-- 3. Row Level Security — read-only for clients
-- ----------------------------------------------------------------------------

alter table chat_conversations enable row level security;
alter table chat_conversation_members enable row level security;
alter table chat_messages enable row level security;
alter table chat_push_events enable row level security;

drop policy if exists "chat conversations select accessible" on chat_conversations;
create policy "chat conversations select accessible" on chat_conversations
  for select using (chat_can_access_conversation(id));

drop policy if exists "chat messages select accessible" on chat_messages;
create policy "chat messages select accessible" on chat_messages
  for select using (chat_can_access_conversation(conversation_id));

-- A member sees only their own membership row (read marker / mute).
drop policy if exists "chat members select own" on chat_conversation_members;
create policy "chat members select own" on chat_conversation_members
  for select using (
    user_id = chat_actor_profile_id()
    and chat_can_access_conversation(conversation_id)
  );

-- Intentionally NO insert/update/delete policy on any chat table, and no
-- policy at all on chat_push_events.

revoke all on table chat_conversations from public, anon, authenticated;
revoke all on table chat_conversation_members from public, anon, authenticated;
revoke all on table chat_messages from public, anon, authenticated;
revoke all on table chat_push_events from public, anon, authenticated;
grant select on table chat_conversations to authenticated;
grant select on table chat_conversation_members to authenticated;
grant select on table chat_messages to authenticated;

-- ----------------------------------------------------------------------------
-- 4. RPCs
-- ----------------------------------------------------------------------------

-- Opens (lazily creating) the caller's family conversation and returns its
-- per-member state. Safe to call repeatedly; this is also the unread-badge
-- refresh call. A member's first call marks existing history as read, so the
-- feature rollout never greets anyone with a wall of "unread" old messages.
create or replace function chat_open_family_conversation()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_family uuid;
  v_conversation uuid;
  v_member chat_conversation_members%rowtype;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  v_actor := chat_actor_profile_id();
  if v_actor is null then
    raise exception 'no active profile found for this session';
  end if;

  select family_id into v_family
  from users
  where id = v_actor and removed_at is null;

  if v_family is null or v_family is distinct from current_family_id() then
    raise exception 'no active profile found for this session';
  end if;

  insert into chat_conversations (kind, family_id, created_by_user_id)
  values ('family', v_family, v_actor)
  on conflict (family_id) where kind = 'family' do nothing;

  select id into v_conversation
  from chat_conversations
  where family_id = v_family and kind = 'family';

  insert into chat_conversation_members (conversation_id, user_id, family_id)
  values (v_conversation, v_actor, v_family)
  on conflict (conversation_id, user_id) do nothing;

  select * into v_member
  from chat_conversation_members
  where conversation_id = v_conversation and user_id = v_actor;

  return jsonb_build_object(
    'conversation_id', v_conversation,
    'family_id', v_family,
    'user_id', v_actor,
    'last_read_at', v_member.last_read_at,
    'notifications_muted', v_member.notifications_muted,
    'unread_count', chat_unread_count(v_conversation, v_actor, v_member.last_read_at),
    'can_moderate',
      active_impersonation_target() is null and is_real_family_admin(v_family),
    'server_time', now()
  );
end;
$$;

-- Sends a message as the caller's real profile. p_client_id is the
-- idempotency key generated by the sending device.
create or replace function chat_send_message(
  p_conversation_id uuid,
  p_client_id uuid,
  p_body text
)
returns chat_messages
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_family uuid;
  v_body text;
  v_id uuid;
  v_recent int;
  v_message chat_messages%rowtype;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  if active_impersonation_target() is not null then
    raise exception 'chat is read-only while impersonating';
  end if;

  v_actor := chat_actor_profile_id();
  if v_actor is null then
    raise exception 'no active profile found for this session';
  end if;

  if p_conversation_id is null or not chat_can_access_conversation(p_conversation_id) then
    raise exception 'chat conversation not found';
  end if;

  select family_id into v_family from users where id = v_actor;

  -- Strip control characters (keeping tab/newline), then trim.
  v_body := regexp_replace(coalesce(p_body, ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g');
  v_body := replace(v_body, E'\r\n', E'\n');
  v_body := btrim(v_body, E' \t\n\r');

  if char_length(v_body) = 0 then
    raise exception 'chat message is empty';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'chat message is too long';
  end if;

  v_id := coalesce(p_client_id, gen_random_uuid());

  -- Idempotent retry: the same device re-sending the same message id gets
  -- the original row back. Anyone else's id is never disclosed or reused.
  select * into v_message from chat_messages where id = v_id;
  if found then
    if v_message.sender_user_id = v_actor and v_message.conversation_id = p_conversation_id then
      return v_message;
    end if;
    raise exception 'chat message id conflict';
  end if;

  -- Simple abuse guard: at most 20 messages per minute per sender.
  select count(*) into v_recent
  from chat_messages
  where sender_user_id = v_actor
    and created_at > now() - interval '60 seconds';
  if v_recent >= 20 then
    raise exception 'chat messages are being sent too quickly';
  end if;

  begin
    insert into chat_messages (id, conversation_id, family_id, sender_user_id, body)
    values (v_id, p_conversation_id, v_family, v_actor, v_body)
    returning * into v_message;
  exception when unique_violation then
    -- Two concurrent retries of the same id: return the row that won.
    select * into v_message from chat_messages where id = v_id;
    if v_message.sender_user_id = v_actor and v_message.conversation_id = p_conversation_id then
      return v_message;
    end if;
    raise exception 'chat message id conflict';
  end;

  update chat_conversations
  set last_message_at = v_message.created_at, updated_at = now()
  where id = p_conversation_id;

  -- Sending implies having read everything up to this point.
  insert into chat_conversation_members (conversation_id, user_id, family_id, last_read_at)
  values (p_conversation_id, v_actor, v_family, v_message.created_at)
  on conflict (conversation_id, user_id) do update
    set last_read_at = greatest(chat_conversation_members.last_read_at, excluded.last_read_at);

  return v_message;
end;
$$;

-- Moderation: a family admin removes a message. The row stays (so the thread
-- can show that something was removed, and by whom) but the text is erased.
create or replace function chat_delete_message(p_message_id uuid)
returns chat_messages
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_message chat_messages%rowtype;
  v_conversation chat_conversations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  if active_impersonation_target() is not null then
    raise exception 'chat is read-only while impersonating';
  end if;

  v_actor := chat_actor_profile_id();
  if v_actor is null then
    raise exception 'no active profile found for this session';
  end if;

  select * into v_message from chat_messages where id = p_message_id for update;
  if not found or not chat_can_access_conversation(v_message.conversation_id) then
    raise exception 'chat message not found';
  end if;

  select * into v_conversation from chat_conversations where id = v_message.conversation_id;

  -- Phase 1: the conversation's family admins moderate it. (Phase 2 will
  -- moderate cross-family conversations per sender family — see the
  -- architecture document.)
  if v_conversation.family_id is null or not is_real_family_admin(v_conversation.family_id) then
    raise exception 'admin permission required';
  end if;

  if v_message.deleted_at is not null then
    return v_message;
  end if;

  update chat_messages
  set body = '', deleted_at = now(), deleted_by_user_id = v_actor
  where id = p_message_id
  returning * into v_message;

  -- Message text is deliberately NOT copied into the audit log.
  perform log_audit_event(
    v_conversation.family_id,
    v_actor,
    'chat_message_deleted',
    'chat_message',
    v_message.id,
    jsonb_build_object(
      'conversation_id', v_message.conversation_id,
      'sender_user_id', v_message.sender_user_id
    )
  );

  return v_message;
end;
$$;

-- Advances the caller's read marker (never moves it backwards, never into
-- the future) and returns the remaining unread count.
create or replace function chat_mark_read(
  p_conversation_id uuid,
  p_read_at timestamptz default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_family uuid;
  v_read_at timestamptz;
  v_last_read timestamptz;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  v_actor := chat_actor_profile_id();
  if v_actor is null then
    raise exception 'no active profile found for this session';
  end if;

  if p_conversation_id is null or not chat_can_access_conversation(p_conversation_id) then
    raise exception 'chat conversation not found';
  end if;

  select family_id into v_family from users where id = v_actor;
  v_read_at := least(coalesce(p_read_at, now()), now());

  insert into chat_conversation_members (conversation_id, user_id, family_id, last_read_at)
  values (p_conversation_id, v_actor, v_family, v_read_at)
  on conflict (conversation_id, user_id) do update
    set last_read_at = greatest(chat_conversation_members.last_read_at, excluded.last_read_at)
  returning last_read_at into v_last_read;

  return chat_unread_count(p_conversation_id, v_actor, v_last_read);
end;
$$;

-- The caller's own chat-notification preference for one conversation.
create or replace function chat_set_notifications_muted(
  p_conversation_id uuid,
  p_muted boolean
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_family uuid;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  v_actor := chat_actor_profile_id();
  if v_actor is null then
    raise exception 'no active profile found for this session';
  end if;

  if p_conversation_id is null or not chat_can_access_conversation(p_conversation_id) then
    raise exception 'chat conversation not found';
  end if;

  select family_id into v_family from users where id = v_actor;

  insert into chat_conversation_members (conversation_id, user_id, family_id, notifications_muted)
  values (p_conversation_id, v_actor, v_family, coalesce(p_muted, false))
  on conflict (conversation_id, user_id) do update
    set notifications_muted = excluded.notifications_muted;

  return coalesce(p_muted, false);
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Push support (used only by the send-chat-push Edge Function)
-- ----------------------------------------------------------------------------

-- Called AS THE SENDER (user-scoped client). Returns the notification context
-- only when the caller really is the author of a recent, live message —
-- otherwise null, and the Edge Function sends nothing. Nothing the client
-- says about recipients or content is ever used.
create or replace function chat_push_context(p_message_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_message chat_messages%rowtype;
  v_sender_name text;
begin
  if auth.uid() is null then
    return null;
  end if;

  v_actor := chat_actor_profile_id();
  if v_actor is null then
    return null;
  end if;

  select * into v_message from chat_messages where id = p_message_id;
  if not found
     or v_message.sender_user_id is distinct from v_actor
     or v_message.deleted_at is not null
     or v_message.created_at < now() - interval '10 minutes'
     or not chat_can_access_conversation(v_message.conversation_id) then
    return null;
  end if;

  select name into v_sender_name from users where id = v_actor;

  return jsonb_build_object(
    'message_id', v_message.id,
    'conversation_id', v_message.conversation_id,
    'family_id', v_message.family_id,
    'sender_user_id', v_message.sender_user_id,
    'sender_name', v_sender_name,
    'body', v_message.body
  );
end;
$$;

-- Who should be notified about a message: every active member of the
-- conversation except the sender, minus anyone who turned notifications off
-- (users.reminders_enabled, the existing per-member switch) or muted this
-- conversation.
create or replace function chat_push_recipients(p_message_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id
  from chat_messages msg
  join chat_conversations c on c.id = msg.conversation_id
  join users u on (
    (c.kind = 'family' and u.family_id = c.family_id)
    or (
      c.kind <> 'family'
      and exists (
        select 1 from chat_conversation_members pm
        where pm.conversation_id = c.id and pm.user_id = u.id and pm.left_at is null
      )
    )
  )
  left join chat_conversation_members m
    on m.conversation_id = c.id and m.user_id = u.id
  where msg.id = p_message_id
    and msg.deleted_at is null
    and u.removed_at is null
    and u.id is distinct from msg.sender_user_id
    and u.reminders_enabled
    and coalesce(m.notifications_muted, false) = false;
$$;

-- Returns true exactly once per message (or again only after a failed /
-- stale attempt), so a retried or duplicated trigger can never notify twice.
create or replace function claim_chat_push_event(
  p_message_id uuid,
  p_stale_seconds int default 30
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  affected int;
begin
  insert into chat_push_events (message_id, status, attempt_count)
  values (p_message_id, 'sending', 1)
  on conflict (message_id) do update
    set status = 'sending',
        updated_at = now(),
        attempt_count = chat_push_events.attempt_count + 1
    where chat_push_events.status = 'failed'
       or (chat_push_events.status = 'sending'
           and chat_push_events.updated_at < now() - make_interval(secs => p_stale_seconds));
  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

create or replace function mark_chat_push_event(p_message_id uuid, p_status text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if p_status not in ('sent', 'failed', 'no_destination') then
    raise exception 'invalid chat_push_events status: %', p_status;
  end if;
  update chat_push_events
  set status = p_status, updated_at = now()
  where message_id = p_message_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Function privileges
-- ----------------------------------------------------------------------------

revoke all on function chat_actor_profile_id() from public, anon;
revoke all on function chat_can_access_conversation(uuid) from public, anon;
revoke all on function chat_unread_count(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function chat_open_family_conversation() from public, anon;
revoke all on function chat_send_message(uuid, uuid, text) from public, anon;
revoke all on function chat_delete_message(uuid) from public, anon;
revoke all on function chat_mark_read(uuid, timestamptz) from public, anon;
revoke all on function chat_set_notifications_muted(uuid, boolean) from public, anon;
revoke all on function chat_push_context(uuid) from public, anon;
revoke all on function chat_push_recipients(uuid) from public, anon, authenticated;
revoke all on function claim_chat_push_event(uuid, int) from public, anon, authenticated;
revoke all on function mark_chat_push_event(uuid, text) from public, anon, authenticated;

-- Needed by the SELECT policies (and therefore by Realtime).
grant execute on function chat_actor_profile_id() to authenticated;
grant execute on function chat_can_access_conversation(uuid) to authenticated;
grant execute on function chat_open_family_conversation() to authenticated;
grant execute on function chat_send_message(uuid, uuid, text) to authenticated;
grant execute on function chat_delete_message(uuid) to authenticated;
grant execute on function chat_mark_read(uuid, timestamptz) to authenticated;
grant execute on function chat_set_notifications_muted(uuid, boolean) to authenticated;
grant execute on function chat_push_context(uuid) to authenticated;

grant execute on function chat_push_recipients(uuid) to service_role;
grant execute on function claim_chat_push_event(uuid, int) to service_role;
grant execute on function mark_chat_push_event(uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- 7. Realtime
--
-- Same guarded shape as 0017_realtime_publication.sql. Only chat_messages is
-- published: new messages (INSERT) and moderation (UPDATE) are the only
-- changes other devices need to hear about.
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'Publication supabase_realtime does not exist; skipping.';
    return;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end
$$;
