-- ============================================================================
-- 0003_family_admin_roles.sql
--
-- Adds device-level family roles.
-- The device that creates a family becomes admin.
-- Devices that join via invite code become regular members.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Role column on family_auth_members
-- ----------------------------------------------------------------------------

alter table family_auth_members
add column if not exists role text not null default 'member';

alter table family_auth_members
drop constraint if exists family_auth_members_role_check;

alter table family_auth_members
add constraint family_auth_members_role_check
check (role in ('admin', 'member'));

-- Existing families: promote the earliest membership in each family to admin.
with ranked_members as (
  select
    auth_user_id,
    family_id,
    row_number() over (
      partition by family_id
      order by created_at asc, auth_user_id asc
    ) as rn
  from family_auth_members
)
update family_auth_members fam
set role = 'admin'
from ranked_members ranked
where fam.auth_user_id = ranked.auth_user_id
  and fam.family_id = ranked.family_id
  and ranked.rn = 1;

-- ----------------------------------------------------------------------------
-- 2. Helper functions
-- ----------------------------------------------------------------------------

create or replace function current_family_role()
returns text as $$
  select role
  from family_auth_members
  where auth_user_id = auth.uid()
  limit 1;
$$ language sql stable security definer;

create or replace function is_family_admin(target_family_id uuid)
returns boolean as $$
  select exists (
    select 1
    from family_auth_members
    where auth_user_id = auth.uid()
      and family_id = target_family_id
      and role = 'admin'
  );
$$ language sql stable security definer;

-- ----------------------------------------------------------------------------
-- 3. create_family()
-- Creator becomes admin.
-- ----------------------------------------------------------------------------

create or replace function create_family(
  family_name text,
  dog_name text default null
)
returns table (id uuid, name text, invite_code text) as $$
declare
  new_family_id uuid;
  new_code text;
  attempts int := 0;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated to create a family';
  end if;

  if family_name is null or length(trim(family_name)) = 0 then
    raise exception 'family_name is required';
  end if;

  loop
    new_code := generate_invite_code();
    attempts := attempts + 1;

    begin
      insert into families (name, invite_code)
      values (trim(family_name), new_code)
      returning families.id into new_family_id;

      exit;
    exception when unique_violation then
      if attempts > 20 then
        raise exception 'could not generate a unique invite_code';
      end if;
    end;
  end loop;

  insert into family_auth_members (
    auth_user_id,
    family_id,
    role
  )
  values (
    auth.uid(),
    new_family_id,
    'admin'
  )
  on conflict (auth_user_id)
  do update set
    family_id = excluded.family_id,
    role = 'admin';

  if dog_name is not null and length(trim(dog_name)) > 0 then
    insert into dogs (family_id, name)
    values (new_family_id, trim(dog_name));
  end if;

  return query
  select f.id, f.name, f.invite_code
  from families f
  where f.id = new_family_id;
end;
$$ language plpgsql volatile security definer;

-- ----------------------------------------------------------------------------
-- 4. join_family()
-- Joining devices become members.
-- If the device is already admin of this same family, keep admin.
-- ----------------------------------------------------------------------------

create or replace function join_family(code text)
returns table (id uuid, name text) as $$
declare
  target_family_id uuid;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated to join a family';
  end if;

  select f.id
  into target_family_id
  from families f
  where upper(f.invite_code) = upper(code)
  limit 1;

  if target_family_id is null then
    raise exception 'invalid invite code';
  end if;

  insert into family_auth_members (
    auth_user_id,
    family_id,
    role
  )
  values (
    auth.uid(),
    target_family_id,
    'member'
  )
  on conflict (auth_user_id)
  do update set
    family_id = excluded.family_id,
    role =
      case
        when family_auth_members.family_id = excluded.family_id
         and family_auth_members.role = 'admin'
          then 'admin'
        else 'member'
      end;

  return query
  select f.id, f.name
  from families f
  where f.id = target_family_id;
end;
$$ language plpgsql volatile security definer;

-- ----------------------------------------------------------------------------
-- 5. Invite-code rotation is admin-only.
-- ----------------------------------------------------------------------------

create or replace function regenerate_invite_code(target_family_id uuid)
returns text as $$
declare
  new_code text;
  attempts int := 0;
begin
  if not is_family_admin(target_family_id) then
    raise exception 'admin permission required';
  end if;

  loop
    new_code := generate_invite_code();
    attempts := attempts + 1;

    begin
      update families
      set invite_code = new_code
      where id = target_family_id;

      exit;
    exception when unique_violation then
      if attempts > 20 then
        raise exception 'could not generate a unique invite_code';
      end if;
    end;
  end loop;

  return new_code;
end;
$$ language plpgsql volatile security definer;

-- ----------------------------------------------------------------------------
-- 6. User-management policies
--
-- For now:
-- - all family members may read users
-- - all family members may update users (keeps existing profile-edit behavior)
-- - only admins may add new users
-- - direct client DELETE is disabled entirely
--
-- Deleting users will be reintroduced later through an admin-only atomic RPC,
-- because deletion also rewrites schedule rules / entries / pending walks.
-- ----------------------------------------------------------------------------

drop policy if exists "insert users in own family" on users;

create policy "insert users (family admins only)" on users
  for insert with check (
    family_id = current_family_id()
    and is_family_admin(family_id)
  );

drop policy if exists "delete users (own family)" on users;
drop policy if exists "delete users (family admins only)" on users;

-- Intentionally no DELETE policy on users.
-- Direct client deletion is therefore blocked by RLS.