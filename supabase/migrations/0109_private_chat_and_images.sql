-- ============================================================================
-- 0109_private_chat_and_images.sql
--
-- Chat, Phase 2 (same family only):
--   A. private one-to-one conversations between two members of one family;
--   B. image messages in the family conversation and in private ones;
--   C. a private Storage bucket for those images, readable only by members of
--      the conversation the image was sent in.
--
-- Builds on 0108_family_chat.sql, which is NOT edited. Existing conversations,
-- memberships and messages are untouched: no row is deleted, moved or
-- rewritten. Idempotent, like 0108.
--
-- WHAT CHANGES FOR EXISTING OBJECTS (all chat-owned, all introduced by 0108)
--   * chat_conversations: the Phase 1 guard (kind = 'family') is replaced by
--     kind in ('family', 'direct'); two columns record a private
--     conversation's fixed pair of participants.
--   * chat_messages: five nullable attachment columns; the body rule now also
--     accepts an image with no caption.
--   * Functions replaced (same signatures): chat_can_access_conversation,
--     chat_send_message, chat_delete_message, chat_push_context,
--     chat_push_recipients.
--
-- PRIVACY MODEL FOR PRIVATE CONVERSATIONS
--   Access to a private conversation is decided by ONE thing: being one of its
--   two recorded participants, as the caller's REAL profile.
--     - A family admin is not a participant, so has no access — there is no
--       admin branch anywhere in the private-conversation path, and an admin
--       cannot moderate one.
--     - An impersonating admin still resolves to their own real profile
--       (chat_actor_profile_id, 0108), so impersonating a member opens the
--       ADMIN's chats, never the member's.
--     - The System Admin hidden observer resolves to no profile at all.
--     - A removed member resolves to no profile at all.
--   The participants are stored on the conversation row itself and never
--   change, so membership cannot be granted by inserting a row somewhere.
--
-- CROSS-FAMILY MESSAGING REMAINS IMPOSSIBLE
--   Every conversation must have a family, both participants of a private
--   conversation must belong to it, and kind = 'group' is still rejected.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Conversations: allow same-family private conversations
-- ----------------------------------------------------------------------------

alter table chat_conversations
  add column if not exists direct_user_low uuid references users(id) on delete cascade,
  add column if not exists direct_user_high uuid references users(id) on delete cascade;

alter table chat_conversations drop constraint if exists chat_conversations_phase1_family_only;

alter table chat_conversations drop constraint if exists chat_conversations_same_family_kinds;
alter table chat_conversations add constraint chat_conversations_same_family_kinds
  check (kind in ('family', 'direct'));

-- No conversation without a family in this phase (0108 allowed null only for
-- the future cross-family kinds).
alter table chat_conversations drop constraint if exists chat_conversations_requires_family;
alter table chat_conversations add constraint chat_conversations_requires_family
  check (family_id is not null);

-- A private conversation has exactly two distinct participants, stored in a
-- canonical order so the pair (A, B) and the pair (B, A) are the same row.
alter table chat_conversations drop constraint if exists chat_conversations_direct_pair;
alter table chat_conversations add constraint chat_conversations_direct_pair check (
  (kind = 'direct' and direct_user_low is not null and direct_user_high is not null
     and direct_user_low < direct_user_high)
  or (kind <> 'direct' and direct_user_low is null and direct_user_high is null)
);

-- At most one private conversation per pair of members.
create unique index if not exists chat_conversations_direct_pair_idx
  on chat_conversations (direct_user_low, direct_user_high) where kind = 'direct';
create index if not exists chat_conversations_direct_high_idx
  on chat_conversations (direct_user_high) where kind = 'direct';

-- ----------------------------------------------------------------------------
-- 2. Messages: one optional image attachment
-- ----------------------------------------------------------------------------

alter table chat_messages
  add column if not exists attachment_path text,
  add column if not exists attachment_mime text,
  add column if not exists attachment_width integer,
  add column if not exists attachment_height integer,
  add column if not exists attachment_size integer;

-- A live message is text (1..2000), an image, or an image with a caption.
-- A removed message keeps its row but neither text nor attachment.
alter table chat_messages drop constraint if exists chat_messages_body_valid;
alter table chat_messages add constraint chat_messages_body_valid check (
  (deleted_at is not null and body = '' and attachment_path is null)
  or (
    deleted_at is null
    and char_length(body) <= 2000
    and (char_length(body) >= 1 or attachment_path is not null)
  )
);

alter table chat_messages drop constraint if exists chat_messages_attachment_valid;
alter table chat_messages add constraint chat_messages_attachment_valid check (
  (
    attachment_path is null and attachment_mime is null and attachment_width is null
    and attachment_height is null and attachment_size is null
  )
  or (
    attachment_path is not null
    and attachment_mime in ('image/jpeg', 'image/png', 'image/webp')
    and attachment_width between 1 and 4096
    and attachment_height between 1 and 4096
    and attachment_size between 1 and 5242880
  )
);

-- A stored file belongs to at most one message.
create unique index if not exists chat_messages_attachment_path_idx
  on chat_messages (attachment_path) where attachment_path is not null;

-- Files waiting to be physically removed from Storage (their message was
-- deleted). Server-only: RLS on, no policy, no client privileges.
create table if not exists chat_attachment_deletions (
  path text primary key,
  requested_at timestamptz not null default now(),
  removed_at timestamptz,
  attempts integer not null default 0
);
alter table chat_attachment_deletions enable row level security;
revoke all on table chat_attachment_deletions from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. Access predicate (replaces 0108's body; same signature)
-- ----------------------------------------------------------------------------

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
      -- Same family, and it is the caller's current, approved family
      -- (current_family_id() is already gated on an 'active' family).
      and c.family_id = u.family_id
      and c.family_id = current_family_id()
      and (
        c.kind = 'family'
        -- Private: only the two recorded participants. Deliberately no admin
        -- branch.
        or (c.kind = 'direct' and u.id in (c.direct_user_low, c.direct_user_high))
      )
  );
$$;

-- ----------------------------------------------------------------------------
-- 4. Conversation state helpers and RPCs
-- ----------------------------------------------------------------------------

-- One conversation as the caller sees it. Internal: callers have already
-- established access.
create or replace function chat_conversation_state(p_conversation_id uuid, p_actor uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_conversation chat_conversations%rowtype;
  v_member chat_conversation_members%rowtype;
  v_last chat_messages%rowtype;
  v_last_read timestamptz;
  v_other uuid;
begin
  select * into v_conversation from chat_conversations where id = p_conversation_id;
  if not found then
    return null;
  end if;

  select * into v_member
  from chat_conversation_members
  where conversation_id = p_conversation_id and user_id = p_actor;
  -- No membership row yet (a family member who has not opened the family
  -- chat): nothing is unread until they do, exactly like 0108.
  v_last_read := coalesce(v_member.last_read_at, now());

  select * into v_last
  from chat_messages
  where conversation_id = p_conversation_id
  order by created_at desc, id desc
  limit 1;

  if v_conversation.kind = 'direct' then
    v_other := case when v_conversation.direct_user_low = p_actor
      then v_conversation.direct_user_high else v_conversation.direct_user_low end;
  end if;

  return jsonb_build_object(
    'conversation_id', v_conversation.id,
    'kind', v_conversation.kind,
    'family_id', v_conversation.family_id,
    'user_id', p_actor,
    'other_user_id', v_other,
    'last_read_at', v_last_read,
    'notifications_muted', coalesce(v_member.notifications_muted, false),
    'unread_count', chat_unread_count(p_conversation_id, p_actor, v_last_read),
    -- Only the family conversation has moderators. Nobody moderates a
    -- private conversation.
    'can_moderate',
      v_conversation.kind = 'family'
      and active_impersonation_target() is null
      and is_real_family_admin(v_conversation.family_id),
    'last_activity_at', coalesce(v_conversation.last_message_at, v_conversation.created_at),
    'last_message', case when v_last.id is null then null else jsonb_build_object(
      'id', v_last.id,
      'sender_user_id', v_last.sender_user_id,
      'preview', left(regexp_replace(v_last.body, '\s+', ' ', 'g'), 140),
      'has_image', v_last.attachment_path is not null,
      'deleted', v_last.deleted_at is not null,
      'created_at', v_last.created_at
    ) end
  );
end;
$$;

-- Opens (creating if needed) the private conversation between the caller and
-- another active member of the caller's own family. Calling it again — from
-- either side — returns the same conversation.
create or replace function chat_open_direct_conversation(p_other_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_family uuid;
  v_low uuid;
  v_high uuid;
  v_conversation uuid;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  v_actor := chat_actor_profile_id();
  if v_actor is null then
    raise exception 'no active profile found for this session';
  end if;

  select family_id into v_family from users where id = v_actor and removed_at is null;
  if v_family is null or v_family is distinct from current_family_id() then
    raise exception 'no active profile found for this session';
  end if;

  if p_other_user_id is null or p_other_user_id = v_actor then
    raise exception 'choose another family member';
  end if;

  -- The same answer for "does not exist", "another family" and "removed":
  -- nothing about other families can be learned here.
  if not exists (
    select 1 from users
    where id = p_other_user_id and family_id = v_family and removed_at is null
  ) then
    raise exception 'chat member not found';
  end if;

  v_low := least(v_actor, p_other_user_id);
  v_high := greatest(v_actor, p_other_user_id);

  select id into v_conversation
  from chat_conversations
  where kind = 'direct' and direct_user_low = v_low and direct_user_high = v_high;

  if v_conversation is null then
    -- Creating is a write: not while impersonating.
    if active_impersonation_target() is not null then
      raise exception 'chat is read-only while impersonating';
    end if;

    insert into chat_conversations (kind, family_id, created_by_user_id, direct_user_low, direct_user_high)
    values ('direct', v_family, v_actor, v_low, v_high)
    on conflict (direct_user_low, direct_user_high) where kind = 'direct' do nothing;

    select id into v_conversation
    from chat_conversations
    where kind = 'direct' and direct_user_low = v_low and direct_user_high = v_high;

    insert into chat_conversation_members (conversation_id, user_id, family_id)
    values (v_conversation, v_low, v_family), (v_conversation, v_high, v_family)
    on conflict (conversation_id, user_id) do nothing;
  end if;

  return chat_conversation_state(v_conversation, v_actor);
end;
$$;

-- Everything the Chats screen lists for the caller: the family conversation
-- (created on first use, as in 0108) and the caller's private conversations,
-- most recently active first. A private conversation nobody has written in
-- yet is listed only for the member who opened it.
create or replace function chat_list_conversations()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_family uuid;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  v_actor := chat_actor_profile_id();
  if v_actor is null then
    raise exception 'no active profile found for this session';
  end if;

  -- Ensures the family conversation and the caller's membership row exist,
  -- with 0108's exact semantics (first open marks history as read).
  perform chat_open_family_conversation();

  select family_id into v_family from users where id = v_actor;

  select coalesce(jsonb_agg(state order by (state->>'last_activity_at')::timestamptz desc), '[]'::jsonb)
  into v_result
  from (
    select chat_conversation_state(c.id, v_actor) as state
    from chat_conversations c
    where c.family_id = v_family
      and (
        c.kind = 'family'
        or (
          c.kind = 'direct'
          and v_actor in (c.direct_user_low, c.direct_user_high)
          and (c.last_message_at is not null or c.created_by_user_id = v_actor)
        )
      )
  ) listed;

  return v_result;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Attachment path rules
--
-- Path: <conversation id>/<uploader profile id>/<message id>.<jpg|png|webp>
-- The conversation segment is what read access is checked against; the
-- uploader segment is what stops one member attaching another's upload.
-- ----------------------------------------------------------------------------

create or replace function chat_attachment_path_parts(p_name text)
returns uuid[]
language sql
immutable
set search_path = public
as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    then array[
      split_part(p_name, '/', 1)::uuid,
      split_part(p_name, '/', 2)::uuid,
      split_part(split_part(p_name, '/', 3), '.', 1)::uuid
    ]
    else null
  end;
$$;

-- May the caller upload this object? Only into a conversation they can
-- access, only under their own real profile, never while impersonating.
create or replace function chat_attachment_uploadable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select parts[2] = chat_actor_profile_id()
       and active_impersonation_target() is null
       and chat_can_access_conversation(parts[1])
    from (select chat_attachment_path_parts(p_name) as parts) p
    where parts is not null
  ), false);
$$;

-- May the caller read this object? Only while a LIVE message in a
-- conversation they can access points at it — so removing a message revokes
-- the image at once, before the file itself is cleaned up — or while it is
-- their own upload that has not been attached to a message yet.
create or replace function chat_attachment_readable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from chat_messages m
    where m.attachment_path = p_name
      and m.deleted_at is null
      and chat_can_access_conversation(m.conversation_id)
  )
  or coalesce((
    select parts[2] = chat_actor_profile_id()
       and chat_can_access_conversation(parts[1])
       and not exists (select 1 from chat_messages m where m.attachment_path = p_name)
       and not exists (select 1 from chat_attachment_deletions d where d.path = p_name)
    from (select chat_attachment_path_parts(p_name) as parts) p
    where parts is not null
  ), false);
$$;

-- May the caller delete this object? Only their own upload that never became
-- a message (a cancelled or failed send). Files of real messages are removed
-- by the server-side cleanup only.
create or replace function chat_attachment_removable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select parts[2] = chat_actor_profile_id()
       and chat_can_access_conversation(parts[1])
       and not exists (select 1 from chat_messages m where m.attachment_path = p_name)
    from (select chat_attachment_path_parts(p_name) as parts) p
    where parts is not null
  ), false);
$$;

-- ----------------------------------------------------------------------------
-- 6. Sending
-- ----------------------------------------------------------------------------

-- The single place a message row is created. Internal (not executable by
-- clients); the two public RPCs below are thin wrappers. Behaviour for text
-- is identical to 0108's chat_send_message.
create or replace function chat_post_message(
  p_conversation_id uuid,
  p_client_id uuid,
  p_body text,
  p_attachment_path text,
  p_attachment_width integer,
  p_attachment_height integer
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
  v_conversation chat_conversations%rowtype;
  v_other uuid;
  v_parts uuid[];
  v_object_meta jsonb;
  v_mime text;
  v_size integer;
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

  select * into v_conversation from chat_conversations where id = p_conversation_id;
  select family_id into v_family from users where id = v_actor;

  if v_conversation.kind = 'direct' then
    v_other := case when v_conversation.direct_user_low = v_actor
      then v_conversation.direct_user_high else v_conversation.direct_user_low end;
    if not exists (
      select 1 from users
      where id = v_other and family_id = v_conversation.family_id and removed_at is null
    ) then
      raise exception 'chat recipient is no longer in the family';
    end if;
  end if;

  -- Strip control characters (keeping tab/newline), then trim.
  v_body := regexp_replace(coalesce(p_body, ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g');
  v_body := replace(v_body, E'\r\n', E'\n');
  v_body := btrim(v_body, E' \t\n\r');

  if char_length(v_body) = 0 and p_attachment_path is null then
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

  if p_attachment_path is not null then
    v_parts := chat_attachment_path_parts(p_attachment_path);
    -- The file must sit in THIS conversation's folder, under THIS sender's
    -- own profile, and be named after THIS message.
    if v_parts is null
       or v_parts[1] is distinct from p_conversation_id
       or v_parts[2] is distinct from v_actor
       or v_parts[3] is distinct from v_id then
      raise exception 'chat attachment is not valid';
    end if;

    -- It must really have been uploaded, by this session.
    select o.metadata into v_object_meta
    from storage.objects o
    where o.bucket_id = 'chat-attachments'
      and o.name = p_attachment_path
      and o.owner_id = auth.uid()::text;
    if not found then
      raise exception 'chat attachment was not uploaded';
    end if;

    -- Type and size come from what Storage recorded, not from the client.
    v_mime := v_object_meta->>'mimetype';
    v_size := nullif(v_object_meta->>'size', '')::integer;
    if v_mime is null or v_mime not in ('image/jpeg', 'image/png', 'image/webp') then
      raise exception 'chat attachment type is not supported';
    end if;
    if v_size is null or v_size < 1 or v_size > 5242880 then
      raise exception 'chat attachment is too large';
    end if;
    if p_attachment_width is null or p_attachment_height is null
       or p_attachment_width not between 1 and 4096
       or p_attachment_height not between 1 and 4096 then
      raise exception 'chat attachment dimensions are not supported';
    end if;
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
    insert into chat_messages (
      id, conversation_id, family_id, sender_user_id, body,
      attachment_path, attachment_mime, attachment_width, attachment_height, attachment_size
    )
    values (
      v_id, p_conversation_id, v_family, v_actor, v_body,
      p_attachment_path,
      case when p_attachment_path is null then null else v_mime end,
      case when p_attachment_path is null then null else p_attachment_width end,
      case when p_attachment_path is null then null else p_attachment_height end,
      case when p_attachment_path is null then null else v_size end
    )
    returning * into v_message;
  exception when unique_violation then
    -- Two concurrent retries of the same id: return the row that won.
    select * into v_message from chat_messages where id = v_id;
    if found and v_message.sender_user_id = v_actor and v_message.conversation_id = p_conversation_id then
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

-- Text message. Same signature and behaviour as 0108.
create or replace function chat_send_message(
  p_conversation_id uuid,
  p_client_id uuid,
  p_body text
)
returns chat_messages
language sql
volatile
security definer
set search_path = public
as $$
  select * from chat_post_message(p_conversation_id, p_client_id, p_body, null, null, null);
$$;

-- Image message (optionally with a caption). The file must already be in the
-- chat-attachments bucket at
-- <conversation>/<my profile>/<p_client_id>.<ext>. A message id is required:
-- it names the file.
create or replace function chat_send_image_message(
  p_conversation_id uuid,
  p_client_id uuid,
  p_attachment_path text,
  p_width integer,
  p_height integer,
  p_body text default ''
)
returns chat_messages
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if p_client_id is null or p_attachment_path is null then
    raise exception 'chat attachment is not valid';
  end if;
  return chat_post_message(p_conversation_id, p_client_id, p_body, p_attachment_path, p_width, p_height);
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Removing a message
--
--   family conversation  -> a real family admin (unchanged from 0108)
--   private conversation -> the sender of that message, and nobody else
--
-- Either way the text and the attachment reference are erased immediately
-- (which also revokes read access to the file, see chat_attachment_readable)
-- and the file is queued for physical removal from Storage.
-- ----------------------------------------------------------------------------

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
  v_path text;
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

  if v_conversation.kind = 'family' then
    if not is_real_family_admin(v_conversation.family_id) then
      raise exception 'admin permission required';
    end if;
  elsif v_message.sender_user_id is distinct from v_actor then
    raise exception 'only the sender can remove this message';
  end if;

  if v_message.deleted_at is not null then
    return v_message;
  end if;

  v_path := v_message.attachment_path;

  update chat_messages
  set body = '',
      deleted_at = now(),
      deleted_by_user_id = v_actor,
      attachment_path = null,
      attachment_mime = null,
      attachment_width = null,
      attachment_height = null,
      attachment_size = null
  where id = p_message_id
  returning * into v_message;

  if v_path is not null then
    insert into chat_attachment_deletions (path)
    values (v_path)
    on conflict (path) do nothing;
  end if;

  -- Moderation of the FAMILY conversation is audited, as in 0108 (never the
  -- text). A member removing their own private message is not: the family's
  -- admins, who read the audit log, are not a party to that conversation.
  if v_conversation.kind = 'family' then
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
  end if;

  return v_message;
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. Push (used only by the send-chat-push Edge Function)
-- ----------------------------------------------------------------------------

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
  v_kind text;
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
  select kind into v_kind from chat_conversations where id = v_message.conversation_id;

  return jsonb_build_object(
    'message_id', v_message.id,
    'conversation_id', v_message.conversation_id,
    'conversation_kind', v_kind,
    'family_id', v_message.family_id,
    'sender_user_id', v_message.sender_user_id,
    'sender_name', v_sender_name,
    'body', v_message.body,
    'has_image', v_message.attachment_path is not null
  );
end;
$$;

-- family  -> every active member of the family except the sender
-- private -> the other participant, and only them
-- minus anyone who turned notifications off or muted the conversation.
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
    and u.reminders_enabled
    and coalesce(m.notifications_muted, false) = false;
$$;

-- ----------------------------------------------------------------------------
-- 9. Storage cleanup and monitoring (server side)
-- ----------------------------------------------------------------------------

-- Files the cleanup job should remove now: attachments of removed messages,
-- and uploads that never became a message and are older than a day
-- (a cancelled or crashed send the device did not clean up itself).
create or replace function chat_attachment_cleanup_batch(p_limit integer default 100)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  (
    select d.path
    from chat_attachment_deletions d
    where d.removed_at is null
    order by d.requested_at
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  )
  union
  (
    select o.name
    from storage.objects o
    where o.bucket_id = 'chat-attachments'
      and o.created_at < now() - interval '24 hours'
      and not exists (select 1 from chat_messages m where m.attachment_path = o.name)
    order by o.created_at
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  );
$$;

create or replace function chat_attachment_mark_removed(p_paths text[])
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  -- Never record a file as removed while a live message still points at it.
  update chat_attachment_deletions d
  set removed_at = now(), attempts = d.attempts + 1
  where d.path = any (p_paths)
    and d.removed_at is null
    and not exists (select 1 from chat_messages m where m.attachment_path = d.path);
  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- Storage growth, for a System Admin: counts and bytes per family, and what
-- is still waiting for cleanup. No message text, no file paths.
create or replace function chat_storage_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_system_admin() then
    raise exception 'system admin permission required';
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'total_messages', (select count(*) from chat_messages),
    'total_images', (select count(*) from chat_messages where attachment_path is not null),
    'total_image_bytes', (select coalesce(sum(attachment_size), 0) from chat_messages),
    'pending_cleanup_files', (select count(*) from chat_attachment_deletions where removed_at is null),
    'families', coalesce((
      select jsonb_agg(jsonb_build_object(
        'family_id', f.family_id,
        'messages', f.messages,
        'images', f.images,
        'image_bytes', f.image_bytes,
        'images_last_30_days_bytes', f.recent_bytes
      ) order by f.image_bytes desc)
      from (
        select m.family_id,
               count(*) as messages,
               count(m.attachment_path) as images,
               coalesce(sum(m.attachment_size), 0) as image_bytes,
               coalesce(sum(m.attachment_size) filter (where m.created_at > now() - interval '30 days'), 0) as recent_bytes
        from chat_messages m
        group by m.family_id
      ) f
    ), '[]'::jsonb)
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 10. Function privileges
-- ----------------------------------------------------------------------------

revoke all on function chat_conversation_state(uuid, uuid) from public, anon, authenticated;
revoke all on function chat_post_message(uuid, uuid, text, text, integer, integer) from public, anon, authenticated;
revoke all on function chat_attachment_cleanup_batch(integer) from public, anon, authenticated;
revoke all on function chat_attachment_mark_removed(text[]) from public, anon, authenticated;

revoke all on function chat_open_direct_conversation(uuid) from public, anon;
revoke all on function chat_list_conversations() from public, anon;
revoke all on function chat_send_image_message(uuid, uuid, text, integer, integer, text) from public, anon;
revoke all on function chat_attachment_path_parts(text) from public, anon;
revoke all on function chat_attachment_uploadable(text) from public, anon;
revoke all on function chat_attachment_readable(text) from public, anon;
revoke all on function chat_attachment_removable(text) from public, anon;
revoke all on function chat_storage_usage() from public, anon;

grant execute on function chat_open_direct_conversation(uuid) to authenticated;
grant execute on function chat_list_conversations() to authenticated;
grant execute on function chat_send_image_message(uuid, uuid, text, integer, integer, text) to authenticated;
-- Needed by the Storage policies below.
grant execute on function chat_attachment_path_parts(text) to authenticated;
grant execute on function chat_attachment_uploadable(text) to authenticated;
grant execute on function chat_attachment_readable(text) to authenticated;
grant execute on function chat_attachment_removable(text) to authenticated;
grant execute on function chat_storage_usage() to authenticated;

grant execute on function chat_attachment_cleanup_batch(integer) to service_role;
grant execute on function chat_attachment_mark_removed(text[]) to service_role;

-- ----------------------------------------------------------------------------
-- 11. Storage: private bucket + policies
--
-- PRIVATE bucket: there is no public URL for these files. A file is served
-- only through the authenticated Storage API or a short-lived signed URL,
-- and creating a signed URL itself requires passing the SELECT policy.
-- The bucket enforces the size and type limits on upload.
--
-- These policies are scoped to bucket_id = 'chat-attachments' and do not
-- touch the existing 'family-photos' policies.
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-attachments', 'chat-attachments', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "chat attachments read" on storage.objects;
create policy "chat attachments read" on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-attachments' and chat_attachment_readable(name));

drop policy if exists "chat attachments upload" on storage.objects;
create policy "chat attachments upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-attachments' and chat_attachment_uploadable(name));

drop policy if exists "chat attachments remove unsent" on storage.objects;
create policy "chat attachments remove unsent" on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-attachments' and chat_attachment_removable(name));

-- Intentionally no UPDATE policy: a chat image is never overwritten or moved.
