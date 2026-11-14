-- In-app "כתבו לנו" (owner request 2026-11-02): support requests go to the
-- System Admin console instead of the user's mail app, and the reply comes
-- back inside the app.
--
-- A request is personal, so it records who sent it (profile, family, Auth
-- session) — unlike help_questions, which stay anonymous. Only the sender
-- (their own requests) and the verified System Admin (everything) can read
-- it, and only through the RPCs below; the table has no client privileges.
-- Notification sends go through the support-notify Edge Function, which
-- claims each one here so it happens at most once.

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  auth_user_id uuid not null,
  topic text not null check (topic in ('bug','question','idea')),
  body text not null check (char_length(body) between 3 and 2000),
  context jsonb not null default '{}'::jsonb check (pg_column_size(context) <= 2048),
  status text not null default 'open' check (status in ('open','answered','closed')),
  admin_reply text check (admin_reply is null or char_length(admin_reply) between 1 and 2000),
  replied_at timestamptz,
  reply_seen_at timestamptz,
  admin_notified_at timestamptz,
  reply_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists support_tickets_status_idx on public.support_tickets(status, created_at desc);
create index if not exists support_tickets_user_idx on public.support_tickets(user_id, created_at desc);
alter table public.support_tickets enable row level security;
revoke all on public.support_tickets from public, anon, authenticated;

-- Metadata-only activity log entry (no text), like every other table.
drop trigger if exists system_activity_audit_trigger on public.support_tickets;
create trigger system_activity_audit_trigger after insert or update or delete on public.support_tickets
  for each row execute function public.capture_user_state_change();

-- ---------- Families ----------

create or replace function public.submit_support_ticket(p_topic text, p_body text, p_context jsonb default '{}'::jsonb)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_profile uuid := public.real_current_profile_id();
  v_family uuid := public.current_family_id();
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if auth.uid() is null or v_profile is null or v_family is null then
    raise exception 'active profile required' using errcode = '42501';
  end if;
  if p_topic is null or p_topic not in ('bug','question','idea') then
    raise exception 'invalid topic' using errcode = '22023';
  end if;
  if char_length(v_body) < 3 or char_length(v_body) > 2000 then
    raise exception 'message length must be 3 to 2000 characters' using errcode = '22023';
  end if;
  if (select count(*) from public.support_tickets t
      where t.auth_user_id = auth.uid() and t.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'too many requests, try again later' using errcode = '54000';
  end if;
  insert into public.support_tickets(family_id, user_id, auth_user_id, topic, body, context)
  values (v_family, v_profile, auth.uid(), p_topic, v_body,
          case when jsonb_typeof(p_context) = 'object' and pg_column_size(p_context) <= 2048 then p_context else '{}'::jsonb end)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.submit_support_ticket(text,text,jsonb) from public, anon;
grant execute on function public.submit_support_ticket(text,text,jsonb) to authenticated;

create or replace function public.list_my_support_tickets()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_profile uuid := public.real_current_profile_id();
  v_family uuid := public.current_family_id();
  result jsonb;
begin
  if auth.uid() is null or v_profile is null or v_family is null then
    return '[]'::jsonb;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'topic', t.topic, 'body', t.body, 'status', t.status,
      'admin_reply', t.admin_reply, 'replied_at', t.replied_at,
      'reply_unread', (t.replied_at is not null and (t.reply_seen_at is null or t.reply_seen_at < t.replied_at)),
      'created_at', t.created_at) order by t.created_at desc), '[]'::jsonb)
  into result
  from public.support_tickets t
  where t.user_id = v_profile and t.family_id = v_family;
  return result;
end $$;
revoke all on function public.list_my_support_tickets() from public, anon;
grant execute on function public.list_my_support_tickets() to authenticated;

create or replace function public.mark_my_support_replies_seen()
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_profile uuid := public.real_current_profile_id();
  v_family uuid := public.current_family_id();
begin
  if auth.uid() is null or v_profile is null or v_family is null then return; end if;
  update public.support_tickets t set reply_seen_at = now()
  where t.user_id = v_profile and t.family_id = v_family
    and t.replied_at is not null and (t.reply_seen_at is null or t.reply_seen_at < t.replied_at);
end $$;
revoke all on function public.mark_my_support_replies_seen() from public, anon;
grant execute on function public.mark_my_support_replies_seen() to authenticated;

-- ---------- System Admin ----------

create or replace function public.support_assert_system_admin()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_verified_system_admin() then
    raise exception 'verified system admin required' using errcode = '42501';
  end if;
end $$;
revoke all on function public.support_assert_system_admin() from public, anon, authenticated;

create or replace function public.system_admin_list_support_tickets(p_status text default 'open')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.support_assert_system_admin();
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'topic', t.topic, 'body', t.body, 'status', t.status, 'context', t.context,
      'admin_reply', t.admin_reply, 'replied_at', t.replied_at, 'reply_seen_at', t.reply_seen_at,
      'created_at', t.created_at,
      'user_name', u.name,
      'family_id', f.id, 'family_name', f.name, 'invite_code', f.invite_code,
      'verified_email', (select r.verified_email from public.family_onboarding_requests r
        where r.family_id = f.id and r.verified_email is not null order by r.requested_at desc limit 1),
      'admin_names', (select coalesce(jsonb_agg(distinct u2.name), '[]'::jsonb) from public.users u2
        where u2.family_id = f.id and u2.removed_at is null
          and exists (select 1 from public.family_auth_members fam
            where fam.family_id = f.id and fam.role = 'admin'
              and (fam.auth_user_id = u2.auth_user_id
                or exists (select 1 from public.profile_auth_sessions pas
                  where pas.family_id = f.id and pas.user_id = u2.id and pas.auth_user_id = fam.auth_user_id)))),
      'dog_names', (select coalesce(jsonb_agg(d.name order by d.created_at), '[]'::jsonb) from public.dogs d where d.family_id = f.id)
    ) order by t.created_at desc), '[]'::jsonb)
  into result
  from public.support_tickets t
  join public.families f on f.id = t.family_id
  left join public.users u on u.id = t.user_id
  where p_status is null or t.status = p_status;
  return result;
end $$;
revoke all on function public.system_admin_list_support_tickets(text) from public, anon;
grant execute on function public.system_admin_list_support_tickets(text) to authenticated;

create or replace function public.system_admin_reply_support_ticket(p_id uuid, p_reply text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_reply text := btrim(coalesce(p_reply, ''));
begin
  perform public.support_assert_system_admin();
  if char_length(v_reply) < 1 or char_length(v_reply) > 2000 then
    raise exception 'reply length must be 1 to 2000 characters' using errcode = '22023';
  end if;
  update public.support_tickets
    set admin_reply = v_reply, status = 'answered', replied_at = now(), reply_notified_at = null, updated_at = now()
    where id = p_id;
  if not found then raise exception 'ticket not found' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.system_admin_reply_support_ticket(uuid,text) from public, anon;
grant execute on function public.system_admin_reply_support_ticket(uuid,text) to authenticated;

create or replace function public.system_admin_set_support_ticket_status(p_id uuid, p_status text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public.support_assert_system_admin();
  if p_status is null or p_status not in ('open','answered','closed') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  update public.support_tickets set status = p_status, updated_at = now() where id = p_id;
end $$;
revoke all on function public.system_admin_set_support_ticket_status(uuid,text) from public, anon;
grant execute on function public.system_admin_set_support_ticket_status(uuid,text) to authenticated;

-- ---------- Notification claims (called by support-notify as the caller) ----------

-- The sender's own fresh request, once: returns what the System Admin email
-- and push need, or null (not the sender / too old / already notified).
create or replace function public.claim_support_ticket_admin_notice(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then return null; end if;
  update public.support_tickets t set admin_notified_at = now()
  where t.id = p_id and t.auth_user_id = auth.uid() and t.admin_notified_at is null
    and t.created_at > now() - interval '15 minutes';
  if not found then return null; end if;
  select jsonb_build_object(
      'id', t.id, 'topic', t.topic, 'body', t.body, 'context', t.context, 'created_at', t.created_at,
      'user_name', u.name, 'family_name', f.name, 'invite_code', f.invite_code,
      'verified_email', (select r.verified_email from public.family_onboarding_requests r
        where r.family_id = f.id and r.verified_email is not null order by r.requested_at desc limit 1))
  into result
  from public.support_tickets t join public.families f on f.id = t.family_id left join public.users u on u.id = t.user_id
  where t.id = p_id;
  return result;
end $$;
revoke all on function public.claim_support_ticket_admin_notice(uuid) from public, anon;
grant execute on function public.claim_support_ticket_admin_notice(uuid) to authenticated;

-- The System Admin's latest reply, once: returns the recipient profile.
create or replace function public.claim_support_reply_notice(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.support_assert_system_admin();
  update public.support_tickets t set reply_notified_at = now()
  where t.id = p_id and t.replied_at is not null and t.reply_notified_at is null
  returning jsonb_build_object('id', t.id, 'user_id', t.user_id, 'family_id', t.family_id) into result;
  return result;
end $$;
revoke all on function public.claim_support_reply_notice(uuid) from public, anon;
grant execute on function public.claim_support_reply_notice(uuid) to authenticated;

comment on table public.support_tickets is 'In-app support requests ("כתבו לנו"). Readable only by the sender (own requests, via RPC) and the verified System Admin.';
