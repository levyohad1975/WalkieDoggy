-- Per-profile conversation clearing plus authenticated, atomic chat deletion.
-- Message content is erased in-place for deletes visible to the conversation;
-- per-member cleared_at only hides history for the requesting profile.

alter table chat_conversation_members
  add column if not exists cleared_at timestamptz;

-- A caller's clear marker is part of the message read boundary. Realtime uses
-- the same RLS predicate, so old rows are not sent to a profile after clear.
drop policy if exists "chat messages select accessible" on chat_messages;
create policy "chat messages select accessible" on chat_messages
  for select using (
    chat_can_access_conversation(conversation_id)
    and created_at > coalesce((
      select m.cleared_at
      from chat_conversation_members m
      where m.conversation_id = chat_messages.conversation_id
        and m.user_id = chat_actor_profile_id()
    ), '-infinity'::timestamptz)
  );

-- The own-membership read policy already protects this table; publish it so a
-- profile's other devices learn about clear-for-me and administrator clears.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'chat_conversation_members'
     ) then
    alter publication supabase_realtime add table public.chat_conversation_members;
  end if;
end;
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
    and msg.created_at > p_last_read_at
    and msg.created_at > coalesce((
      select m.cleared_at from chat_conversation_members m
      where m.conversation_id = p_conversation_id and m.user_id = p_user_id
    ), '-infinity'::timestamptz);
$$;

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
  if not found then return null; end if;

  select * into v_member from chat_conversation_members
  where conversation_id = p_conversation_id and user_id = p_actor;
  v_last_read := coalesce(v_member.last_read_at, now());

  select * into v_last from chat_messages
  where conversation_id = p_conversation_id
    and created_at > coalesce(v_member.cleared_at, '-infinity'::timestamptz)
  order by created_at desc, id desc limit 1;

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
    'can_moderate', v_conversation.kind = 'family'
      and active_impersonation_target() is null
      and is_real_family_admin(v_conversation.family_id),
    'last_activity_at', coalesce(v_last.created_at, v_conversation.created_at),
    'last_message', case when v_last.id is null then null else jsonb_build_object(
      'id', v_last.id,
      'sender_user_id', v_last.sender_user_id,
      'preview', case when v_last.deleted_at is not null then '' else left(regexp_replace(v_last.body, '\s+', ' ', 'g'), 140) end,
      'has_image', v_last.attachment_path is not null and v_last.deleted_at is null,
      'deleted', v_last.deleted_at is not null,
      'created_at', v_last.created_at
    ) end
  );
end;
$$;

-- Atomic bulk soft-delete; permissions are derived exclusively from the
-- authenticated profile. Direct chats remain sender-only and private to their
-- two members; family admins may moderate the family conversation.
create or replace function chat_delete_messages(p_message_ids uuid[])
returns setof chat_messages
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_conversation chat_conversations%rowtype;
  v_count integer;
  v_conversation_count integer;
  v_changed integer;
begin
  if auth.uid() is null then raise exception 'must be authenticated'; end if;
  if active_impersonation_target() is not null then raise exception 'chat is read-only while impersonating'; end if;
  v_actor := chat_actor_profile_id();
  if v_actor is null then raise exception 'no active profile found for this session'; end if;
  if p_message_ids is null or cardinality(p_message_ids) = 0 or cardinality(p_message_ids) > 100
     or array_position(p_message_ids, null) is not null then
    raise exception 'invalid chat message selection';
  end if;

  select count(distinct id), count(distinct conversation_id), min(conversation_id::text)::uuid
  into v_count, v_conversation_count, v_conversation.id
  from chat_messages where id = any(p_message_ids);
  if v_count <> (select count(distinct x) from unnest(p_message_ids) x) or v_count = 0 then
    raise exception 'chat message not found';
  end if;
  if v_conversation_count <> 1 then raise exception 'chat message selection must use one conversation'; end if;
  select * into v_conversation from chat_conversations where id = v_conversation.id;
  if not chat_can_access_conversation(v_conversation.id) then raise exception 'chat conversation not found'; end if;

  if v_conversation.kind = 'family' then
    if not is_real_family_admin(v_conversation.family_id) and exists (
      select 1 from chat_messages where id = any(p_message_ids)
        and sender_user_id is distinct from v_actor
    ) then raise exception 'only the sender can remove this message'; end if;
  elsif exists (
    select 1 from chat_messages where id = any(p_message_ids)
      and sender_user_id is distinct from v_actor
  ) then raise exception 'only the sender can remove this message';
  end if;

  insert into chat_attachment_deletions(path)
  select distinct attachment_path from chat_messages
  where id = any(p_message_ids) and deleted_at is null and attachment_path is not null
  on conflict(path) do nothing;

  update chat_messages set body = '', deleted_at = now(), deleted_by_user_id = v_actor,
    attachment_path = null, attachment_mime = null, attachment_width = null,
    attachment_height = null, attachment_size = null
  where id = any(p_message_ids) and deleted_at is null;
  get diagnostics v_changed = row_count;

  if v_conversation.kind = 'family' and is_real_family_admin(v_conversation.family_id) and v_changed > 0 then
    perform log_audit_event(v_conversation.family_id, v_actor,
      case when v_count = 1 then 'chat_message_deleted' else 'chat_messages_bulk_deleted' end,
      'chat_conversation', v_conversation.id,
      jsonb_build_object('conversation_id', v_conversation.id, 'count', v_changed));
  end if;

  return query select * from chat_messages where id = any(p_message_ids) order by created_at, id;
end;
$$;

create or replace function chat_delete_message(p_message_id uuid)
returns chat_messages
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_message chat_messages%rowtype;
begin
  select * into v_message from chat_delete_messages(array[p_message_id]) limit 1;
  if not found then raise exception 'chat message not found'; end if;
  return v_message;
end;
$$;

create or replace function chat_clear_conversation_for_me(p_conversation_id uuid)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_family uuid;
  v_cleared_at timestamptz := clock_timestamp();
begin
  if auth.uid() is null then raise exception 'must be authenticated'; end if;
  if active_impersonation_target() is not null then raise exception 'chat is read-only while impersonating'; end if;
  v_actor := chat_actor_profile_id();
  if v_actor is null or not chat_can_access_conversation(p_conversation_id) then
    raise exception 'chat conversation not found';
  end if;
  select family_id into v_family from users where id = v_actor and removed_at is null;
  insert into chat_conversation_members(conversation_id, user_id, family_id, last_read_at, cleared_at)
  values (p_conversation_id, v_actor, v_family, v_cleared_at, v_cleared_at)
  on conflict(conversation_id, user_id) do update
    set last_read_at = excluded.last_read_at, cleared_at = excluded.cleared_at;
  return v_cleared_at;
end;
$$;

create or replace function chat_clear_family_conversation_for_everyone(
  p_conversation_id uuid,
  p_confirm boolean
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_conversation chat_conversations%rowtype;
  v_cleared_at timestamptz := clock_timestamp();
  v_count integer;
begin
  if auth.uid() is null then raise exception 'must be authenticated'; end if;
  if active_impersonation_target() is not null then raise exception 'chat is read-only while impersonating'; end if;
  v_actor := chat_actor_profile_id();
  if v_actor is null then raise exception 'no active profile found for this session'; end if;
  select * into v_conversation from chat_conversations where id = p_conversation_id for update;
  if not found or v_conversation.kind <> 'family'
     or not chat_can_access_conversation(p_conversation_id) then
    raise exception 'chat conversation not found';
  end if;
  if not is_real_family_admin(v_conversation.family_id) then raise exception 'admin permission required'; end if;
  if p_confirm is distinct from true then raise exception 'explicit conversation confirmation required'; end if;

  insert into chat_attachment_deletions(path)
  select distinct attachment_path from chat_messages
  where conversation_id = p_conversation_id and attachment_path is not null
  on conflict(path) do nothing;

  update chat_messages set body = '', deleted_at = coalesce(deleted_at, v_cleared_at),
    deleted_by_user_id = v_actor, attachment_path = null, attachment_mime = null,
    attachment_width = null, attachment_height = null, attachment_size = null
  where conversation_id = p_conversation_id and deleted_at is null;
  get diagnostics v_count = row_count;

  insert into chat_conversation_members(conversation_id, user_id, family_id, last_read_at, cleared_at)
  select p_conversation_id, u.id, u.family_id, v_cleared_at, v_cleared_at
  from users u
  where u.family_id = v_conversation.family_id and u.removed_at is null
  on conflict(conversation_id, user_id) do update
    set cleared_at = excluded.cleared_at, last_read_at = excluded.last_read_at;

  perform log_audit_event(v_conversation.family_id, v_actor,
    'chat_conversation_cleared_for_everyone', 'chat_conversation', p_conversation_id,
    jsonb_build_object('conversation_id', p_conversation_id, 'deleted_count', v_count));
  return v_count;
end;
$$;

revoke all on function chat_delete_messages(uuid[]) from public, anon;
revoke all on function chat_clear_conversation_for_me(uuid) from public, anon;
revoke all on function chat_clear_family_conversation_for_everyone(uuid, boolean) from public, anon;
grant execute on function chat_delete_messages(uuid[]) to authenticated;
grant execute on function chat_clear_conversation_for_me(uuid) to authenticated;
grant execute on function chat_clear_family_conversation_for_everyone(uuid, boolean) to authenticated;
