-- 0033_verified_family_onboarding_cutover.sql
--
-- Issue #3 / Batch 2: contract/cutover phase.
-- Apply only after migration 0032, create-verified-family, and the compatible
-- client have been validated. This phase intentionally disables anonymous
-- family creation and makes pending/rejected families fail closed.

create or replace function current_family_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.family_id
  from family_auth_members m
  join families f on f.id = m.family_id
  where m.auth_user_id = auth.uid()
    and f.approval_status = 'active'
  limit 1;
$$;

create or replace function current_family_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role
  from family_auth_members m
  join families f on f.id = m.family_id
  where m.auth_user_id = auth.uid()
    and f.approval_status = 'active'
  limit 1;
$$;

create or replace function is_family_admin(target_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from family_auth_members m
    join families f on f.id = m.family_id
    where m.auth_user_id = auth.uid()
      and m.family_id = target_family_id
      and m.role = 'admin'
      and f.approval_status = 'active'
  );
$$;

-- The legacy RPC accepted anonymous sessions and could bypass manual approval.
-- PostgreSQL grants function EXECUTE to PUBLIC by default, so revoking only
-- anon/authenticated would leave an inherited bypass open.
-- The compatible client now uses the Edge Function instead.
revoke all on function create_family(text, text) from public;
revoke execute on function create_family(text, text) from anon;
revoke execute on function create_family(text, text) from authenticated;

create or replace function find_family_by_invite_code(code text)
returns table (id uuid, name text, dog_name text)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.name, d.name
  from families f
  left join dogs d on d.family_id = f.id
  where upper(f.invite_code) = upper(code)
    and f.approval_status = 'active'
  limit 1;
$$;

create or replace function join_family(code text)
returns table (id uuid, name text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_family_id uuid;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated to join a family';
  end if;

  select f.id into v_family_id
  from families f
  where upper(f.invite_code) = upper(code)
    and f.approval_status = 'active'
  limit 1;

  if v_family_id is null then
    raise exception 'invalid invite code';
  end if;

  insert into family_auth_members (auth_user_id, family_id, role)
  values (auth.uid(), v_family_id, 'member')
  on conflict (auth_user_id) do update set
    family_id = excluded.family_id,
    role = case
      when family_auth_members.family_id = excluded.family_id
       and family_auth_members.role = 'admin'
      then 'admin' else 'member' end;

  return query select f.id, f.name from families f where f.id = v_family_id;
end;
$$;
