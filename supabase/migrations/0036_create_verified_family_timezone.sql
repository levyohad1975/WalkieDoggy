-- ----------------------------------------------------------------------------
-- 0036_create_verified_family_timezone.sql
--
-- BUG FIX -- 0022's own header explicitly warned that its 'Asia/Jerusalem'
-- default on families.timezone "DOES NOT EXTEND TO FUTURE FAMILIES" and that
-- "family creation/onboarding (later batch work) must explicitly determine
-- each NEW family's real timezone at creation time... rather than silently
-- inheriting this column's default." 0032's create_verified_family() -- and,
-- after 0033's cutover, the ONLY way to create a family in this app -- never
-- did: it inserts into families without ever mentioning timezone, so every
-- family created since verified onboarding shipped silently falls through to
-- the 'Asia/Jerusalem' default regardless of where its members actually
-- live, with no way to correct it afterward.
--
-- This corrupts two already-shipped, timezone-authoritative systems for any
-- non-Israel family: the walk reminder scheduler (0025), whose fire_at is
-- computed as `(date || ' ' || scheduled_time) at time zone f.timezone` (so
-- a 07:00-local walk fires its T-15/T/T+15/T+30 reminders at 07:00 ISRAEL
-- time instead); and current_family_local_date() (0027), used for
-- History/Statistics "today" boundaries and the raw walks RLS operational
-- window (so a walk resolved late in the local evening can be mis-bucketed
-- across the day boundary).
--
-- FIX: create_verified_family() gains an optional p_timezone parameter,
-- added at the END with a default of null so any existing caller that omits
-- it keeps today's Asia/Jerusalem-default behavior unchanged. When provided,
-- it is validated against is_valid_timezone() (0022) -- an invalid/garbage
-- value from a misbehaving client falls back to the schema default rather
-- than raising, since a bad timezone string is not a reason to fail family
-- creation outright. DROP is required (not CREATE OR REPLACE) because
-- PostgreSQL only replaces a function whose argument types match exactly;
-- adding a parameter changes the signature (same reasoning as 0018's
-- `drop function if exists create_swap_request(uuid, uuid)`).
--
-- Deliberately NOT in scope here: correcting families already created before
-- this fix (their timezone stays whatever was silently defaulted) -- letting
-- an admin change an existing family's timezone, whether via self-service UI
-- or a system-admin action, is a separate product/UX decision, not something
-- to assume unilaterally.
-- ----------------------------------------------------------------------------

drop function if exists create_verified_family(uuid, text, text, boolean);

create function create_verified_family(
  p_auth_user_id uuid,
  p_family_name text,
  p_dog_name text default null,
  p_auto_approve boolean default true,
  p_timezone text default null
)
returns table (
  id uuid,
  name text,
  invite_code text,
  approval_status text,
  created boolean
)
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  v_auth_user auth.users%rowtype;
  v_existing_family families%rowtype;
  v_family_id uuid;
  v_code text;
  v_status text;
  v_timezone text;
  v_attempts integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required';
  end if;

  select * into v_auth_user from auth.users where auth.users.id = p_auth_user_id;
  if v_auth_user.id is null
     or coalesce(v_auth_user.is_anonymous, true)
     or v_auth_user.email is null
     or v_auth_user.email_confirmed_at is null then
    raise exception 'verified email identity required';
  end if;

  select f.* into v_existing_family
  from family_onboarding_requests r
  join families f on f.id = r.family_id
  where r.auth_user_id = p_auth_user_id;

  if v_existing_family.id is not null then
    return query
    select v_existing_family.id, v_existing_family.name,
           v_existing_family.invite_code, v_existing_family.approval_status,
           false;
    return;
  end if;

  if p_family_name is null or length(trim(p_family_name)) = 0 then
    raise exception 'family_name is required';
  end if;

  v_status := case when p_auto_approve then 'active' else 'pending' end;
  v_timezone := case
    when p_timezone is not null and is_valid_timezone(p_timezone) then p_timezone
    else 'Asia/Jerusalem'
  end;

  loop
    v_code := generate_invite_code();
    v_attempts := v_attempts + 1;
    begin
      insert into families (
        name, invite_code, approval_status, created_by_auth_user_id, timezone
      ) values (
        trim(p_family_name), v_code, v_status, p_auth_user_id, v_timezone
      ) returning families.id into v_family_id;
      exit;
    exception when unique_violation then
      if v_attempts > 20 then
        raise exception 'could not generate a unique invite_code';
      end if;
    end;
  end loop;

  insert into family_auth_members (auth_user_id, family_id, role)
  values (p_auth_user_id, v_family_id, 'admin');

  if p_dog_name is not null and length(trim(p_dog_name)) > 0 then
    insert into dogs (family_id, name)
    values (v_family_id, trim(p_dog_name));
  end if;

  insert into family_onboarding_requests (
    auth_user_id, family_id, verified_email
  ) values (
    p_auth_user_id, v_family_id, lower(v_auth_user.email)
  );

  insert into system_audit_log (
    actor_auth_user_id, action, target_type, target_id, metadata
  ) values (
    p_auth_user_id,
    'family.created',
    'family',
    v_family_id,
    jsonb_build_object(
      'approval_status', v_status,
      'verified_identity', true,
      'timezone', v_timezone
    )
  );

  return query
  select f.id, f.name, f.invite_code, f.approval_status, true
  from families f
  where f.id = v_family_id;
end;
$$;

comment on function create_verified_family(uuid, text, text, boolean, text) is
  'Batch 2 verified family creation (0032), extended in 0036 to accept an optional client-supplied IANA timezone (falls back to the Asia/Jerusalem compatibility default from 0022 when omitted or invalid) -- see this migration''s header for why omitting it silently corrupted the walk reminder scheduler (0025) and current_family_local_date() (0027) for any non-Israel family.';

revoke all on function create_verified_family(uuid, text, text, boolean, text) from public;
revoke all on function create_verified_family(uuid, text, text, boolean, text) from anon;
revoke all on function create_verified_family(uuid, text, text, boolean, text) from authenticated;
grant execute on function create_verified_family(uuid, text, text, boolean, text) to service_role;
