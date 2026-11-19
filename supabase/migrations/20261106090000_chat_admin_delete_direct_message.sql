-- Chat: a family admin could not delete another member's message in a DIRECT
-- conversation (e.g. a parent admin deleting a child's photo in their 1:1 chat).
--
-- Field report 2026-11-06: Omer sent a photo in his direct chat with the admin
-- ("אבא"), and the admin could not delete it. Diagnosed against production:
-- chat_conversation_state already reports can_moderate = true for a family
-- admin who is a participant in a direct conversation, so the UI offers the
-- delete — but chat_delete_messages' direct branch allowed ONLY the sender,
-- raising "only the sender can remove this message" (reproduced as the admin).
-- The server authorization lagged behind the moderation capability the client
-- is told it has.
--
-- Fix: in the direct branch, allow deleting another participant's message when
-- the actor can moderate the direct conversation — the SAME condition
-- chat_conversation_state uses for can_moderate: the actor is one of the two
-- direct participants AND is a real family admin of the family they share with
-- the other participant (both members active). The family-chat branch,
-- impersonation guard (already rejected at the top), attachment-deletion
-- bookkeeping and audit logging are unchanged. A non-admin, non-sender still
-- cannot delete.
--
-- Signature, security, search_path and grants are unchanged from
-- 20261010123756; only the direct-branch authorization is widened.

create or replace function chat_delete_messages(p_message_ids uuid[])
returns setof chat_messages
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    )
    -- Widened: a family admin who is a participant in this direct conversation
    -- may moderate it, matching chat_conversation_state.can_moderate. Otherwise
    -- only the sender may remove their own message.
    and not (
      v_conversation.direct_user_low is not null
      and v_conversation.direct_user_high is not null
      and v_actor in (v_conversation.direct_user_low, v_conversation.direct_user_high)
      and exists (
        select 1 from users me
        join users other_member on other_member.id = case
          when me.id = v_conversation.direct_user_low then v_conversation.direct_user_high
          else v_conversation.direct_user_low end
        where me.id = v_actor and me.family_id = other_member.family_id
          and me.removed_at is null and other_member.removed_at is null
          and is_real_family_admin(me.family_id)
      )
    )
  then raise exception 'only the sender can remove this message';
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
$function$;

revoke all on function chat_delete_messages(uuid[]) from public, anon;
grant execute on function chat_delete_messages(uuid[]) to authenticated;
