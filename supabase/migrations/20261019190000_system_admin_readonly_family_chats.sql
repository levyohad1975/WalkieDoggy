-- Audited, read-only System Admin access to family chat history.
-- No chat RLS policy is widened and no read markers or message rows are updated.

create table if not exists public.system_admin_chat_access_audit (
  id bigint generated always as identity primary key,
  actor_auth_user_id uuid not null,
  family_id uuid not null,
  conversation_id uuid not null,
  conversation_kind text not null check (conversation_kind in ('family','direct','group')),
  access_reason text not null check (access_reason in ('support','incident','policy_review')),
  accessed_at timestamptz not null default now(),
  access_type text not null default 'messages' check (access_type in ('messages','attachment'))
);
create index if not exists system_admin_chat_access_audit_family_time_idx
  on public.system_admin_chat_access_audit(family_id, accessed_at desc);
alter table public.system_admin_chat_access_audit enable row level security;
revoke all on public.system_admin_chat_access_audit from public, anon, authenticated;

create or replace function public.system_admin_chat_assert_access()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_verified_system_admin() then
    raise exception 'verified system admin required' using errcode='42501';
  end if;
  if public.active_system_admin_observer_family() is not null
     or public.active_impersonation_target() is not null then
    raise exception 'exit observer or impersonation mode' using errcode='42501';
  end if;
end;
$$;
revoke all on function public.system_admin_chat_assert_access() from public, anon, authenticated;

create or replace function public.system_admin_list_chat_families(p_search text default null, p_limit integer default 100, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.system_admin_chat_assert_access();
  select coalesce(jsonb_agg(to_jsonb(x) order by x.name, x.id), '[]'::jsonb) into result
  from (
    select f.id, f.name, f.approval_status as status
    from public.families f
    where p_search is null or f.name ilike '%' || left(p_search,100) || '%'
      or f.id::text ilike '%' || left(p_search,100) || '%'
    order by f.name, f.id
    limit greatest(1, least(coalesce(p_limit,100),200)) offset greatest(0,coalesce(p_offset,0))
  ) x;
  return result;
end $$;
revoke all on function public.system_admin_list_chat_families(text,integer,integer) from public, anon;
grant execute on function public.system_admin_list_chat_families(text,integer,integer) to authenticated;

create or replace function public.system_admin_list_family_chats(p_family_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.system_admin_chat_assert_access();
  if not exists(select 1 from public.families f where f.id=p_family_id) then
    raise exception 'family not found' using errcode='P0002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'kind',c.kind,'title',c.title,'created_at',c.created_at,
    'last_message_at',c.last_message_at,'participants',coalesce(p.names,'[]'::jsonb)
  ) order by c.last_message_at desc nulls last,c.id), '[]'::jsonb) into result
  from public.chat_conversations c
  left join lateral (
    select jsonb_agg(jsonb_build_object('id',u.id,'name',u.name) order by u.name,u.id) names
    from public.chat_conversation_members m join public.users u on u.id=m.user_id
    where m.conversation_id=c.id and m.left_at is null and u.removed_at is null
  ) p on true
  where c.family_id=p_family_id;
  return result;
end $$;
revoke all on function public.system_admin_list_family_chats(uuid) from public, anon;
grant execute on function public.system_admin_list_family_chats(uuid) to authenticated;

create or replace function public.system_admin_read_chat_messages(
  p_family_id uuid,p_conversation_id uuid,p_reason text,p_before_created_at timestamptz default null,
  p_before_id uuid default null,p_limit integer default 40
) returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_kind text; result jsonb;
begin
  perform public.system_admin_chat_assert_access();
  if p_reason is null or p_reason not in ('support','incident','policy_review') then raise exception 'access reason required' using errcode='22023'; end if;
  if (p_before_created_at is null) <> (p_before_id is null) then raise exception 'pagination cursor is incomplete' using errcode='22023'; end if;
  select c.kind into v_kind from public.chat_conversations c where c.id=p_conversation_id and c.family_id=p_family_id;
  if v_kind is null then raise exception 'conversation not found' using errcode='P0002'; end if;
  insert into public.system_admin_chat_access_audit(actor_auth_user_id,family_id,conversation_id,conversation_kind,access_reason)
    values(auth.uid(),p_family_id,p_conversation_id,v_kind,p_reason);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]'::jsonb) into result from (
    select m.id,m.created_at,m.sender_user_id,u.name sender_name,m.deleted_at,
      case when m.deleted_at is null then m.body else null end body,
      case when m.deleted_at is null then m.attachment_mime else null end attachment_mime
    from public.chat_messages m left join public.users u on u.id=m.sender_user_id
    where m.family_id=p_family_id and m.conversation_id=p_conversation_id
      and (p_before_created_at is null or (m.created_at,m.id)<(p_before_created_at,p_before_id))
    order by m.created_at desc,m.id desc limit greatest(1,least(coalesce(p_limit,40),100))
  ) x;
  return result;
end $$;
revoke all on function public.system_admin_read_chat_messages(uuid,uuid,text,timestamptz,uuid,integer) from public, anon;
grant execute on function public.system_admin_read_chat_messages(uuid,uuid,text,timestamptz,uuid,integer) to authenticated;

create or replace function public.system_admin_prepare_chat_attachment(p_family_id uuid,p_conversation_id uuid,p_message_id uuid,p_reason text)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare v_kind text; v_path text;
begin
  perform public.system_admin_chat_assert_access();
  if p_reason is null or p_reason not in ('support','incident','policy_review') then raise exception 'access reason required' using errcode='22023'; end if;
  select c.kind,m.attachment_path into v_kind,v_path from public.chat_conversations c
    join public.chat_messages m on m.conversation_id=c.id and m.family_id=c.family_id
    where c.id=p_conversation_id and c.family_id=p_family_id and m.id=p_message_id and m.deleted_at is null;
  if v_kind is null or v_path is null then raise exception 'attachment unavailable' using errcode='P0002'; end if;
  insert into public.system_admin_chat_access_audit(actor_auth_user_id,family_id,conversation_id,conversation_kind,access_reason,access_type)
    values(auth.uid(),p_family_id,p_conversation_id,v_kind,p_reason,'attachment');
  return v_path;
end $$;
revoke all on function public.system_admin_prepare_chat_attachment(uuid,uuid,uuid,text) from public, anon;
grant execute on function public.system_admin_prepare_chat_attachment(uuid,uuid,uuid,text) to authenticated;

comment on table public.system_admin_chat_access_audit is 'Metadata-only audit of verified System Admin read-only chat access; intentionally no foreign keys so family deletion does not erase audit history.';
