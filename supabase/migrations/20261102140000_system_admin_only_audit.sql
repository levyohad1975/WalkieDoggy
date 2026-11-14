-- Owner decision 2026-11-02: activity logs are visible to the verified
-- System Admin only, and the System Admin sees everything in one place.
--
-- 1. Family admins lose their family activity log and remote-GPS log
--    (admin_list_audit_log and the SELECT policies on the log tables).
-- 2. Clients (anon/authenticated) hold no privileges on any audit table.
--    Every writer is SECURITY DEFINER or service_role, so logging continues.
-- 3. More changes are captured by the existing metadata-only trigger
--    capture_user_state_change(): it stores table, operation, ids and actor,
--    never row contents (no chat text, no notes).
-- 4. system_admin_list_global_audit() now requires a verified System Admin
--    and merges every audit source: family audit, system audit, state
--    changes, walk lifecycle, remote GPS, System Admin chat reads and
--    observer sessions.

-- 1. Family admins: no log access.
drop policy if exists "admin reads audit log" on public.audit_log;
drop policy if exists "family admins can view remote gps audit" on public.remote_gps_audit;
revoke all on function public.admin_list_audit_log(integer, integer) from public, anon, authenticated;

-- 2. No direct client privileges on audit tables.
revoke all on public.audit_log from anon, authenticated;
revoke all on public.system_audit_log from anon, authenticated;
revoke all on public.system_activity_audit_log from anon, authenticated;
revoke all on public.remote_gps_audit from anon, authenticated;
revoke all on public.system_admin_chat_access_audit from anon, authenticated;
revoke all on public.system_admin_observer_sessions from anon, authenticated;
revoke all on public.email_delivery_log from anon, authenticated;
revoke all on public.impersonation_sessions from anon, authenticated;
-- Walk lifecycle events are a log too; the app never reads their rows.
-- The SELECT grant itself stays: walk_lifecycle_server_capabilities()
-- (SECURITY INVOKER) checks has_table_privilege(..., 'select') to decide
-- whether Walk Lifecycle v1.1 is available. Without a policy RLS returns
-- no rows to clients.
-- Guarded: the CI full-chain rehearsal replays this file before the v1.1
-- migration that creates the table.
do $$
begin
  if to_regclass('public.walk_lifecycle_events') is not null then
    execute 'drop policy if exists "family members can read walk lifecycle events" on public.walk_lifecycle_events';
    execute 'revoke insert, update, delete, truncate, references, trigger on public.walk_lifecycle_events from anon, authenticated';
  end if;
end;
$$;

-- 3. Capture more changes (metadata only).
drop trigger if exists system_activity_audit_trigger on public.health_tasks;
create trigger system_activity_audit_trigger after insert or update or delete on public.health_tasks
  for each row execute function public.capture_user_state_change();

drop trigger if exists system_activity_audit_trigger on public.family_invites;
create trigger system_activity_audit_trigger after insert or update or delete on public.family_invites
  for each row execute function public.capture_user_state_change();

drop trigger if exists system_activity_audit_trigger on public.remote_gps_consents;
create trigger system_activity_audit_trigger after insert or update or delete on public.remote_gps_consents
  for each row execute function public.capture_user_state_change();

drop trigger if exists system_activity_audit_trigger on public.remote_gps_commands;
create trigger system_activity_audit_trigger after insert or update or delete on public.remote_gps_commands
  for each row execute function public.capture_user_state_change();

drop trigger if exists system_activity_audit_trigger on public.help_articles;
create trigger system_activity_audit_trigger after insert or update or delete on public.help_articles
  for each row execute function public.capture_user_state_change();

drop trigger if exists system_activity_audit_trigger on public.chat_conversations;
create trigger system_activity_audit_trigger after insert or delete on public.chat_conversations
  for each row execute function public.capture_user_state_change();

-- Messages: sent, deleted (soft or hard). Never the text.
drop trigger if exists system_activity_audit_trigger on public.chat_messages;
create trigger system_activity_audit_trigger after insert or delete on public.chat_messages
  for each row execute function public.capture_user_state_change();
drop trigger if exists system_activity_audit_soft_delete_trigger on public.chat_messages;
create trigger system_activity_audit_soft_delete_trigger after update on public.chat_messages
  for each row when (old.deleted_at is distinct from new.deleted_at)
  execute function public.capture_user_state_change();

-- Members: joined/left, muted, cleared. Not every read marker.
drop trigger if exists system_activity_audit_trigger on public.chat_conversation_members;
create trigger system_activity_audit_trigger after insert or delete on public.chat_conversation_members
  for each row execute function public.capture_user_state_change();
drop trigger if exists system_activity_audit_settings_trigger on public.chat_conversation_members;
create trigger system_activity_audit_settings_trigger after update on public.chat_conversation_members
  for each row when (old.left_at is distinct from new.left_at
    or old.notifications_muted is distinct from new.notifications_muted
    or old.cleared_at is distinct from new.cleared_at)
  execute function public.capture_user_state_change();

-- GPS sessions: created, removed, distance corrected.
drop trigger if exists system_activity_audit_trigger on public.walk_gps_sessions;
create trigger system_activity_audit_trigger after insert or delete on public.walk_gps_sessions
  for each row execute function public.capture_user_state_change();
drop trigger if exists system_activity_audit_correction_trigger on public.walk_gps_sessions;
create trigger system_activity_audit_correction_trigger after update on public.walk_gps_sessions
  for each row when (old.corrected_distance_meters is distinct from new.corrected_distance_meters)
  execute function public.capture_user_state_change();

-- Devices registered for notifications (added/removed).
drop trigger if exists system_activity_audit_trigger on public.web_push_subscriptions;
create trigger system_activity_audit_trigger after insert or delete on public.web_push_subscriptions
  for each row execute function public.capture_user_state_change();
drop trigger if exists system_activity_audit_trigger on public.push_tokens;
create trigger system_activity_audit_trigger after insert or delete on public.push_tokens
  for each row execute function public.capture_user_state_change();

-- 4. One verified-System-Admin-only view over every source.
create or replace function public.system_admin_list_global_audit(p_limit integer default 200)
returns table(event_id uuid, source text, family_id uuid, family_name text, actor_user_id uuid, actor_name text,
  actor_auth_user_id uuid, actor_email text, action text, target_type text, target_id text, metadata jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = public, auth
as $$
begin
  if auth.uid() is null or not public.is_verified_system_admin() then
    raise exception 'verified system admin required' using errcode = '42501';
  end if;

  return query
  with events as (
    select a.id as event_id, 'family_audit'::text as source, a.family_id, a.actor_user_id,
      u.auth_user_id as actor_auth_user_id, a.action, a.target_type, a.target_id::text as target_id, a.metadata, a.created_at
    from public.audit_log a
    left join public.users u on u.id = a.actor_user_id

    union all
    select s.id, 'system_audit', case when s.target_type = 'family' then s.target_id else null end, null::uuid,
      s.actor_auth_user_id, s.action, s.target_type, s.target_id::text, s.metadata, s.created_at
    from public.system_audit_log s

    union all
    select x.id, 'state_change', x.family_id, x.actor_user_id, x.actor_auth_user_id, x.action,
      x.entity_type, x.entity_id, x.metadata, x.created_at
    from public.system_activity_audit_log x

    union all
    select md5('walk_lifecycle:' || e.id)::uuid, 'walk_lifecycle', e.family_id, e.actor_user_id, null::uuid,
      'walk_lifecycle.' || e.action, 'walk', e.walk_id::text,
      jsonb_strip_nulls(jsonb_build_object('dog_id', e.dog_id, 'actual_walker_user_id', e.actual_walker_user_id,
        'current_assignee_user_id', e.current_assignee_user_id, 'details', e.details)),
      e.created_at
    from public.walk_lifecycle_events e

    union all
    select g.id, 'remote_gps', g.family_id, g.actor_user_id, null::uuid,
      'remote_gps.' || g.action, 'walk', g.walk_id::text,
      jsonb_strip_nulls(jsonb_build_object('target_user_id', g.target_user_id)), g.created_at
    from public.remote_gps_audit g

    union all
    select md5('admin_chat_access:' || c.id)::uuid, 'admin_access', c.family_id, null::uuid, c.actor_auth_user_id,
      'system_admin.chat_' || c.access_type, 'chat_conversation', c.conversation_id::text,
      jsonb_build_object('reason', c.access_reason, 'conversation_kind', c.conversation_kind), c.accessed_at
    from public.system_admin_chat_access_audit c

    union all
    select o.id, 'admin_access', o.family_id, null::uuid, o.system_admin_auth_user_id,
      'system_observer.started', 'family', o.family_id::text,
      jsonb_strip_nulls(jsonb_build_object('target_user_id', o.target_user_id)), o.started_at
    from public.system_admin_observer_sessions o

    union all
    select md5('observer_end:' || o.id)::uuid, 'admin_access', o.family_id, null::uuid, o.system_admin_auth_user_id,
      'system_observer.ended', 'family', o.family_id::text,
      jsonb_strip_nulls(jsonb_build_object('reason', o.ended_reason)), o.ended_at
    from public.system_admin_observer_sessions o
    where o.ended_at is not null
  )
  select e.event_id, e.source, e.family_id, f.name, e.actor_user_id, u.name, e.actor_auth_user_id,
    coalesce(au.email::text, r.verified_email)::text, e.action, e.target_type, e.target_id, e.metadata, e.created_at
  from events e
  left join public.families f on f.id = e.family_id
  left join public.users u on u.id = e.actor_user_id
  left join auth.users au on au.id = e.actor_auth_user_id
  left join public.family_onboarding_requests r on r.family_id = e.family_id and r.auth_user_id = e.actor_auth_user_id
  order by e.created_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$$;
revoke all on function public.system_admin_list_global_audit(integer) from public, anon;
grant execute on function public.system_admin_list_global_audit(integer) to authenticated;
