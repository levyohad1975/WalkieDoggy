-- 0034_email_delivery_log.sql
--
-- Issue #3 Batch 2 follow-up: email delivery observability.
-- REPOSITORY ONLY: applying this migration is a separate production action.
-- Additive only -- no existing table, RPC, grant, or RLS policy is changed.
--
-- create-verified-family (0032) sends a best-effort welcome email and a
-- best-effort system-owner email but previously left no durable record of
-- whether either send succeeded, failed, or was later bounced/complained by
-- the provider. This migration adds that record plus the two RPCs that
-- populate and update it: record_email_delivery_attempt() (called by the
-- Edge Function right after each send attempt) and
-- update_email_delivery_status() (called by the new provider webhook
-- function as delivery events arrive). Both are service-role-only, mirroring
-- create_verified_family()'s own trust model.

create table if not exists email_delivery_log (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references families(id) on delete set null,
  auth_user_id uuid references auth.users(id) on delete set null,
  message_type text not null
    check (message_type in ('family_welcome', 'system_owner_new_family')),
  recipient_email text not null,
  provider text not null default 'resend',
  provider_message_id text,
  status text not null default 'queued'
    check (status in (
      'queued', 'sent', 'failed', 'delivered', 'bounced', 'complained',
      'opened', 'clicked'
    )),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_delivery_log_family_id_idx
  on email_delivery_log (family_id);
create index if not exists email_delivery_log_created_at_idx
  on email_delivery_log (created_at desc);
-- Webhook lookups key off (provider, provider_message_id); most rows never
-- get a provider id (e.g. a failed send before the provider accepted it), so
-- this stays a partial index rather than a plain unique constraint.
create unique index if not exists email_delivery_log_provider_message_id_idx
  on email_delivery_log (provider, provider_message_id)
  where provider_message_id is not null;

comment on table email_delivery_log is
  'Delivery observability for transactional email sent by create-verified-family. Populated by record_email_delivery_attempt() and updated by update_email_delivery_status() from the provider webhook. No client policies -- service-role and the system-admin read RPC below are the only supported surfaces.';

alter table email_delivery_log enable row level security;
-- No client policies -- same reasoning as system_audit_log (0024) and
-- family_onboarding_requests (0032): only a service-role connection, or the
-- admin-gated read RPC below, can ever see this table's contents.

create or replace function record_email_delivery_attempt(
  p_family_id uuid,
  p_auth_user_id uuid,
  p_message_type text,
  p_recipient_email text,
  p_status text,
  p_provider text default 'resend',
  p_provider_message_id text default null,
  p_error text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;

  insert into email_delivery_log (
    family_id, auth_user_id, message_type, recipient_email,
    status, provider, provider_message_id, error
  ) values (
    p_family_id, p_auth_user_id, p_message_type, p_recipient_email,
    p_status, p_provider, p_provider_message_id, p_error
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function record_email_delivery_attempt(uuid, uuid, text, text, text, text, text, text) from public;
revoke all on function record_email_delivery_attempt(uuid, uuid, text, text, text, text, text, text) from anon;
revoke all on function record_email_delivery_attempt(uuid, uuid, text, text, text, text, text, text) from authenticated;
grant execute on function record_email_delivery_attempt(uuid, uuid, text, text, text, text, text, text) to service_role;

create or replace function update_email_delivery_status(
  p_provider text,
  p_provider_message_id text,
  p_status text,
  p_error text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;

  -- Intentionally a silent no-op when no row matches (e.g. a replayed or
  -- out-of-order webhook event, or a provider id from before this table
  -- existed) -- the caller (the webhook function) always responds 200
  -- either way so the provider does not retry indefinitely.
  update email_delivery_log
  set status = p_status,
      error = coalesce(p_error, error),
      updated_at = now()
  where provider = p_provider
    and provider_message_id = p_provider_message_id;
end;
$$;

revoke all on function update_email_delivery_status(text, text, text, text) from public;
revoke all on function update_email_delivery_status(text, text, text, text) from anon;
revoke all on function update_email_delivery_status(text, text, text, text) from authenticated;
grant execute on function update_email_delivery_status(text, text, text, text) to service_role;

create or replace function system_admin_list_email_delivery_log(p_limit integer default 50)
returns setof email_delivery_log
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_system_admin() then
    raise exception 'system admin permission required';
  end if;

  return query
  select *
  from email_delivery_log
  order by created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke all on function system_admin_list_email_delivery_log(integer) from public;
grant execute on function system_admin_list_email_delivery_log(integer) to authenticated;
