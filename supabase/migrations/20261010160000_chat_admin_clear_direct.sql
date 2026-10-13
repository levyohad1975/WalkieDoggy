-- Extend admin clear-for-everyone to direct conversations between two members of the same family.
-- Only a real family admin who participates in that direct conversation may clear it.
-- Reuse the existing RPC signature and double-confirmation client flow.

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
    'can_moderate', active_impersonation_target() is null
      and ((v_conversation.kind = 'family' and is_real_family_admin(v_conversation.family_id))
        or (v_conversation.kind = 'direct' and v_conversation.direct_user_low is not null
          and v_conversation.direct_user_high is not null
          and p_actor in (v_conversation.direct_user_low, v_conversation.direct_user_high)
          and exists (select 1 from users me join users other_member
            on other_member.id = case when me.id = v_conversation.direct_user_low
              then v_conversation.direct_user_high else v_conversation.direct_user_low end
            where me.id = p_actor and me.family_id = other_member.family_id
              and me.removed_at is null and other_member.removed_at is null
              and is_real_family_admin(me.family_id)))),
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
  if not found or v_conversation.kind not in ('family', 'direct')
     or not chat_can_access_conversation(p_conversation_id) then
    raise exception 'chat conversation not found';
  end if;
  if v_conversation.kind = 'family' then
    if not is_real_family_admin(v_conversation.family_id) then raise exception 'admin permission required'; end if;
  else
    if v_actor not in (v_conversation.direct_user_low, v_conversation.direct_user_high)
       or not exists (select 1 from users me join users other_member
          on other_member.id = case when me.id = v_conversation.direct_user_low
            then v_conversation.direct_user_high else v_conversation.direct_user_low end
          where me.id = v_actor and me.family_id = other_member.family_id
            and me.removed_at is null and other_member.removed_at is null
            and is_real_family_admin(me.family_id)) then
      raise exception 'admin permission required for private conversation';
    end if;
  end if;
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
  where u.removed_at is null and (
    (v_conversation.kind = 'family' and u.family_id = v_conversation.family_id)
    or (v_conversation.kind = 'direct' and u.id in (v_conversation.direct_user_low, v_conversation.direct_user_high))
  )
  on conflict(conversation_id, user_id) do update
    set cleared_at = excluded.cleared_at, last_read_at = excluded.last_read_at;

  perform log_audit_event((select family_id from users where id = v_actor), v_actor,
    'chat_conversation_cleared_for_everyone', 'chat_conversation', p_conversation_id,
    jsonb_build_object('conversation_id', p_conversation_id, 'deleted_count', v_count));
  return v_count;
end;
$$;


