-- 0020_multi_device_profile_sessions.sql
-- Walkie Doggy Link: allow one family persona to be signed in on multiple
-- phones/browsers at the same time without transferring users.auth_user_id.
-- Identity remains server-derived from auth.uid(); the client never supplies
-- an actor id for authorization/audit decisions.

-- 1) One active persona selection per authenticated device/session.
create table if not exists profile_auth_sessions (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  family_id uuid not null references families(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (auth_user_id, family_id)
);

create index if not exists profile_auth_sessions_user_id_idx
  on profile_auth_sessions(user_id);
create index if not exists profile_auth_sessions_family_id_idx
  on profile_auth_sessions(family_id);

alter table profile_auth_sessions enable row level security;
-- Intentionally no client RLS policies. All writes are through the narrow
-- SECURITY DEFINER claim RPCs below; identity reads are through helper RPCs.

-- Backfill every currently-valid legacy single-device claim so installed
-- mobile clients keep their identity immediately after this migration.
insert into profile_auth_sessions (auth_user_id, family_id, user_id)
select u.auth_user_id, u.family_id, u.id
from users u
join family_auth_members fam
  on fam.auth_user_id = u.auth_user_id
 and fam.family_id = u.family_id
where u.auth_user_id is not null
  and u.removed_at is null
on conflict (auth_user_id) do update
set family_id = excluded.family_id,
    user_id = excluded.user_id,
    updated_at = now();

-- 2) The real persona now resolves from the per-device/session mapping.
-- current_profile_id() from 0006 remains unchanged and still overlays QA
-- impersonation on top of this function.
create or replace function real_current_profile_id()
returns uuid as $$
  select u.id
  from profile_auth_sessions s
  join users u on u.id = s.user_id
  where s.auth_user_id = auth.uid()
    and s.family_id = current_family_id()
    and u.family_id = s.family_id
    and u.removed_at is null
  limit 1;
$$ language sql stable security definer set search_path = public;

-- 3) First claim remains PIN-less only while the persona has no active
-- session anywhere. Once any device is signed in as that persona, another
-- device must use the PIN path. Switching this SAME device to another
-- unclaimed persona replaces only this device's mapping; it never logs out
-- any other device.
create or replace function claim_family_profile(target_user_id uuid)
returns void as $$
declare
  target_family uuid;
  target_removed_at timestamptz;
  my_existing_user uuid;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  select family_id, removed_at
    into target_family, target_removed_at
  from users
  where id = target_user_id
  for update;

  if target_family is null then
    raise exception 'user not found';
  end if;
  if target_family is distinct from current_family_id() then
    raise exception 'not a member of this user''s family';
  end if;
  if target_removed_at is not null then
    raise exception 'cannot claim a removed profile';
  end if;

  select user_id into my_existing_user
  from profile_auth_sessions
  where auth_user_id = auth.uid();

  if my_existing_user = target_user_id then
    return;
  end if;

  if exists (
    select 1 from profile_auth_sessions
    where user_id = target_user_id
      and auth_user_id <> auth.uid()
  ) then
    -- Keep the existing client-visible text: LoginScreen uses it to open
    -- the PIN modal. Under 0020 this means "already active elsewhere",
    -- not "the other device will be displaced".
    raise exception 'profile already claimed by another device';
  end if;

  insert into profile_auth_sessions (auth_user_id, family_id, user_id, updated_at)
  values (auth.uid(), target_family, target_user_id, now())
  on conflict (auth_user_id) do update
    set family_id = excluded.family_id,
        user_id = excluded.user_id,
        updated_at = now();

  perform log_audit_event(target_family, target_user_id, 'profile_claimed', 'user', target_user_id,
    jsonb_build_object('multi_device', true));
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function claim_family_profile(uuid) from public;
grant execute on function claim_family_profile(uuid) to authenticated;

-- 4) PIN login now ADDS this authenticated device as another session for
-- the persona. It never clears another device's mapping. Rate limiting and
-- PIN verification preserve 0016's transaction-safe behavior.
create or replace function claim_family_profile_with_pin(p_target_user_id uuid, p_pin text)
returns jsonb as $$
declare
  target_family uuid;
  target_removed_at timestamptz;
  target_pin_hash text;
  v_fail_count int;
  v_locked_until timestamptz;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  select family_id, removed_at, pin_hash
    into target_family, target_removed_at, target_pin_hash
  from users
  where id = p_target_user_id
  for update;

  if target_family is null then
    raise exception 'user not found';
  end if;
  if target_family is distinct from current_family_id() then
    raise exception 'not a member of this user''s family';
  end if;
  if target_removed_at is not null then
    raise exception 'cannot claim a removed profile';
  end if;

  if exists (
    select 1 from profile_auth_sessions
    where auth_user_id = auth.uid() and user_id = p_target_user_id
  ) then
    return jsonb_build_object('success', true);
  end if;

  if target_pin_hash is null then
    raise exception 'no PIN set for this profile — ask your family admin to set one, or reclaim from the original device';
  end if;

  select fail_count, locked_until
    into v_fail_count, v_locked_until
  from profile_pin_attempts
  where auth_user_id = auth.uid()
    and target_user_id = p_target_user_id
  for update;

  if v_locked_until is not null and v_locked_until > now() then
    return jsonb_build_object('success', false, 'reason', 'cooldown');
  end if;

  if p_pin is null or extensions.crypt(p_pin, target_pin_hash) is distinct from target_pin_hash then
    insert into profile_pin_attempts (auth_user_id, target_user_id, fail_count, locked_until, updated_at)
    values (auth.uid(), p_target_user_id, 1, null, now())
    on conflict (auth_user_id, target_user_id) do update
      set fail_count = case
            when profile_pin_attempts.locked_until is not null
             and profile_pin_attempts.locked_until <= now() then 1
            else profile_pin_attempts.fail_count + 1
          end,
          locked_until = case
            when (case
                    when profile_pin_attempts.locked_until is not null
                     and profile_pin_attempts.locked_until <= now() then 1
                    else profile_pin_attempts.fail_count + 1
                  end) >= 5
              then now() + interval '15 minutes'
            else null
          end,
          updated_at = now();
    return jsonb_build_object('success', false, 'reason', 'wrong_pin');
  end if;

  delete from profile_pin_attempts
  where auth_user_id = auth.uid()
    and target_user_id = p_target_user_id;

  insert into profile_auth_sessions (auth_user_id, family_id, user_id, updated_at)
  values (auth.uid(), target_family, p_target_user_id, now())
  on conflict (auth_user_id) do update
    set family_id = excluded.family_id,
        user_id = excluded.user_id,
        updated_at = now();

  perform log_audit_event(target_family, p_target_user_id, 'profile_claim_transferred', 'user', p_target_user_id,
    jsonb_build_object('multi_device', true, 'other_sessions_preserved', true));

  return jsonb_build_object('success', true);
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function claim_family_profile_with_pin(uuid, text) from public;
grant execute on function claim_family_profile_with_pin(uuid, text) to authenticated;

-- 5) Self profile edits must work from every valid session, not only the
-- one legacy users.auth_user_id value. Admin behavior is unchanged.
drop policy if exists "update users (self or admin, active profiles only)" on users;
create policy "update users (self or admin, active profiles only)" on users
  for update using (
    family_id = current_family_id()
    and removed_at is null
    and (id = real_current_profile_id() or is_family_admin(family_id))
  )
  with check (
    family_id = current_family_id()
    and removed_at is null
    and (id = real_current_profile_id() or is_family_admin(family_id))
  );

-- 6) PIN ownership check also follows the real persona mapping. Using
-- real_current_profile_id() deliberately prevents QA impersonation from
-- changing another person's PIN as if it were self.
create or replace function set_profile_pin(p_user_id uuid, p_pin text)
returns void as $$
declare
  target_family uuid;
  target_removed_at timestamptz;
  target_role text;
  caller_profile uuid;
begin
  if auth.uid() is null then raise exception 'must be authenticated'; end if;

  select family_id, removed_at, role
    into target_family, target_removed_at, target_role
  from users where id = p_user_id;

  if target_family is null then raise exception 'user not found'; end if;
  if target_family is distinct from current_family_id() then
    raise exception 'not a member of this user''s family';
  end if;
  if target_removed_at is not null then
    raise exception 'cannot set a PIN for a removed profile';
  end if;

  caller_profile := real_current_profile_id();
  if caller_profile is distinct from p_user_id then
    if target_role = 'admin' then
      raise exception 'an admin''s own PIN can only be set by that admin themselves';
    end if;
    if not is_family_admin(target_family) then
      raise exception 'only the profile''s own device or a family admin may set its PIN';
    end if;
  end if;

  if p_pin is null then
    perform set_config('app.trusted_write', 'on', true);
    update users set pin_hash = null where id = p_user_id;
    perform set_config('app.trusted_write', 'off', true);
    perform log_audit_event(target_family, caller_profile, 'profile_pin_cleared', 'user', p_user_id, '{}'::jsonb);
    return;
  end if;

  if p_pin !~ '^[0-9]{4,6}$' then
    raise exception 'PIN must be 4 to 6 digits';
  end if;

  perform set_config('app.trusted_write', 'on', true);
  update users set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')) where id = p_user_id;
  perform set_config('app.trusted_write', 'off', true);
  perform log_audit_event(target_family, caller_profile, 'profile_pin_set', 'user', p_user_id, '{}'::jsonb);
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function set_profile_pin(uuid, text) from public;
grant execute on function set_profile_pin(uuid, text) to authenticated;

-- No change is required to current_profile_id(), whoami(), current_family_role(),
-- is_family_admin(), request RPCs, presence, or audit triggers: all of those
-- already route through real_current_profile_id()/current_profile_id() in the
-- final schema, so they automatically pick up the multi-device identity.
