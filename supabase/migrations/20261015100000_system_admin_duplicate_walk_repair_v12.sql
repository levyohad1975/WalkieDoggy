-- System Admin duplicate-walk maintenance (Staging repair), v1.2 audit model.
--
-- ORDER: after 20261013164442_walk_duplicate_resolution_v12 (which it
-- builds on; that is the version recorded in the Staging ledger) and before
-- 20261015100100_walk_lifecycle_gps_v11 (which it unblocks). v1.1 fails
-- closed while any dog has more than one unresolved active walk, and the
-- existing resolve_duplicate_active_walks_v12() requires a Family Admin of
-- the affected family. On Staging the blocking family's admin is not
-- available, so a verified System Admin needs a narrowly scoped, audited way
-- to apply the SAME non-destructive marker.
--
-- Scope and safety:
-- * Nothing is deleted or rewritten. Walk status, timestamps, attribution,
--   GPS sessions and route points stay byte-for-byte unchanged; the walk only
--   gains duplicate_resolution_group_id, exactly like the v1.2 RPC. Each
--   original row is snapshotted into walk_duplicate_resolution_items.
-- * Only records named in an explicit maintenance authorization can be
--   touched. This migration seeds exactly one authorization: the two
--   2026-10-14 test-generated active walks of dog 62c6b367… in family
--   f806158f…, and only if those exact rows still exist, still belong to that
--   family and dog, and are still unresolved in_progress walks. On any other
--   database (Production, CI) the seed inserts nothing, so the RPC has
--   nothing it is allowed to act on.
-- * The authorization expires, is single-use, and is bound to one stable
--   operation id on first use; an identical retry returns the same audit
--   group, any other reuse is rejected.
-- * Caller must be a verified (non-anonymous, email-confirmed) System Admin
--   per is_system_admin(), not observing or impersonating a family.
-- * Every successful resolution writes an immutable system_audit_log row.
--   No client role can read, write or change the authorization table.

create table public.system_maintenance_duplicate_walk_authorizations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete restrict,
  dog_id uuid not null references public.dogs(id) on delete restrict,
  walk_ids uuid[] not null check (cardinality(walk_ids) >= 2),
  reason text not null check (length(btrim(reason)) between 10 and 1000),
  approval_reference text not null check (length(btrim(approval_reference)) between 5 and 300),
  expires_at timestamptz not null,
  consumed_group_id uuid references public.walk_duplicate_resolution_groups(id) on delete restrict,
  consumed_operation_id uuid,
  consumed_by_auth_user_id uuid references auth.users(id) on delete restrict,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (family_id, walk_ids),
  check ((consumed_group_id is null) = (consumed_at is null)
     and (consumed_group_id is null) = (consumed_operation_id is null)
     and (consumed_group_id is null) = (consumed_by_auth_user_id is null))
);

alter table public.system_maintenance_duplicate_walk_authorizations enable row level security;
revoke all on public.system_maintenance_duplicate_walk_authorizations from public, anon, authenticated;

comment on table public.system_maintenance_duplicate_walk_authorizations is
  'Owner-approved, single-use, expiring authorizations for a verified System Admin to mark specific active walks as resolved duplicates (marker only). No client access; only the guarded System Admin RPCs below read or consume it.';

-- Seed: Staging-only by construction (the exact rows exist nowhere else).
insert into public.system_maintenance_duplicate_walk_authorizations
  (family_id, dog_id, walk_ids, reason, approval_reference, expires_at)
select
  'f806158f-eee9-4a6e-87be-72c4a3d64f75'::uuid,
  '62c6b367-a253-4dad-9c83-0ae596f37461'::uuid,
  array['088a73c5-0dd9-47fd-9bd1-fb44bc739eb3', '2a495898-6936-487c-8da9-5fcaeb3b0b60']::uuid[],
  'Two test-generated active walks started ~4.5s apart on 2026-10-14 block Walk Lifecycle v1.1 uniqueness; owner approved resolving both as duplicates with no canonical walk.',
  'Product owner approval 2026-10-15 (PR #150, Staging repair)',
  timestamptz '2026-10-29 00:00:00+00'
where (
  select count(*) from public.walks w
  where w.id in ('088a73c5-0dd9-47fd-9bd1-fb44bc739eb3', '2a495898-6936-487c-8da9-5fcaeb3b0b60')
    and w.family_id = 'f806158f-eee9-4a6e-87be-72c4a3d64f75'
    and w.dog_id = '62c6b367-a253-4dad-9c83-0ae596f37461'
    and w.status = 'in_progress'
    and w.duplicate_resolution_group_id is null
) = 2
on conflict (family_id, walk_ids) do nothing;

-- Verified System Admin, acting as themselves (not observing/impersonating).
create function public.require_verified_system_admin_for_maintenance()
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_auth auth.users%rowtype;
begin
  select * into v_auth from auth.users where id = auth.uid();
  if v_auth.id is null or coalesce(v_auth.is_anonymous, true)
     or v_auth.email is null or v_auth.email_confirmed_at is null
     or public.is_system_admin() is not true then
    raise exception 'verified system admin required';
  end if;
  if public.active_system_admin_observer_family() is not null
     or public.active_impersonation_target() is not null then
    raise exception 'exit observation or impersonation before maintenance';
  end if;
  return v_auth.id;
end;
$$;
revoke all on function public.require_verified_system_admin_for_maintenance() from public, anon, authenticated;

create function public.system_admin_list_duplicate_walk_authorizations()
returns table (
  authorization_id uuid,
  family_id uuid,
  family_name text,
  dog_id uuid,
  dog_name text,
  walk_ids uuid[],
  unresolved_active_count integer,
  reason text,
  expires_at timestamptz,
  consumed_at timestamptz,
  consumed_group_id uuid
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.require_verified_system_admin_for_maintenance();
  return query
    select a.id, a.family_id, f.name, a.dog_id, d.name, a.walk_ids,
      (select count(*)::integer from public.walks w
        where w.id = any(a.walk_ids) and w.family_id = a.family_id and w.dog_id = a.dog_id
          and w.status = 'in_progress' and w.duplicate_resolution_group_id is null),
      a.reason, a.expires_at, a.consumed_at, a.consumed_group_id
    from public.system_maintenance_duplicate_walk_authorizations a
    join public.families f on f.id = a.family_id
    join public.dogs d on d.id = a.dog_id
    order by a.created_at desc;
end;
$$;
revoke all on function public.system_admin_list_duplicate_walk_authorizations() from public, anon;
grant execute on function public.system_admin_list_duplicate_walk_authorizations() to authenticated;

create function public.system_admin_resolve_authorized_duplicate_walks_v12(
  p_authorization_id uuid,
  p_operation_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_admin_auth uuid := public.require_verified_system_admin_for_maintenance();
  v_profile uuid := public.real_current_profile_id();
  v_auth public.system_maintenance_duplicate_walk_authorizations;
  v_requested uuid[];
  v_group uuid;
  v_affected integer;
begin
  if v_profile is null then raise exception 'system admin profile required'; end if;
  if p_authorization_id is null or p_operation_id is null then
    raise exception 'authorization id and operation id are required';
  end if;

  select * into v_auth from public.system_maintenance_duplicate_walk_authorizations
    where id = p_authorization_id for update;
  if not found then raise exception 'maintenance authorization not found'; end if;

  if v_auth.consumed_group_id is not null then
    -- Idempotent retry of the same operation returns the recorded result.
    if v_auth.consumed_operation_id = p_operation_id and v_auth.consumed_by_auth_user_id = v_admin_auth then
      return v_auth.consumed_group_id;
    end if;
    raise exception 'maintenance authorization was already used';
  end if;
  if v_auth.expires_at <= now() then raise exception 'maintenance authorization expired'; end if;

  select array_agg(x order by x) into v_requested from (select distinct unnest(v_auth.walk_ids) x) ids;

  -- Lock and re-validate every authorized row before writing anything.
  perform 1 from public.walks w
    where w.id = any(v_requested) and w.family_id = v_auth.family_id and w.dog_id = v_auth.dog_id
      and w.status = 'in_progress' and w.duplicate_resolution_group_id is null
    order by w.id for update;
  get diagnostics v_affected = row_count;
  if v_affected <> cardinality(v_requested) then
    raise exception 'authorized walks changed since approval; re-review required';
  end if;
  if not exists (select 1 from public.dogs d where d.id = v_auth.dog_id and d.family_id = v_auth.family_id) then
    raise exception 'authorized dog does not belong to the authorized family';
  end if;

  insert into public.walk_duplicate_resolution_groups(
    family_id, dog_id, canonical_walk_id, created_by_user_id, operation_id, rationale, request_walk_ids
  ) values (
    v_auth.family_id, v_auth.dog_id, null, v_profile, p_operation_id,
    'System Admin maintenance ' || v_auth.id::text || ': ' || btrim(v_auth.reason), v_requested
  ) returning id into v_group;

  insert into public.walk_duplicate_resolution_items(group_id, walk_id, original_walk, linked_gps_session_ids, disposition)
  select v_group, w.id, to_jsonb(w),
    coalesce((select array_agg(s.id order by s.id) from public.walk_gps_sessions s where s.walk_id = w.id), '{}'),
    'resolved_duplicate'
  from public.walks w
  where w.id = any(v_requested) and w.family_id = v_auth.family_id;

  -- Marker only. Runs as the function owner, which the v1.2 marker guard
  -- trigger accepts; status, timestamps, attribution and GPS are untouched.
  -- The caller is not a member of the affected family, so the per-family walk
  -- write trigger is bypassed for this one statement only, exactly as the
  -- server-authoritative lifecycle RPCs do, and switched off again after.
  perform set_config('app.trusted_write', 'on', true);
  update public.walks set duplicate_resolution_group_id = v_group
    where id = any(v_requested) and family_id = v_auth.family_id and dog_id = v_auth.dog_id
      and status = 'in_progress' and duplicate_resolution_group_id is null;
  get diagnostics v_affected = row_count;
  perform set_config('app.trusted_write', 'off', true);
  if v_affected <> cardinality(v_requested) then
    raise exception 'walk set changed while resolving duplicates';
  end if;

  update public.system_maintenance_duplicate_walk_authorizations
    set consumed_group_id = v_group, consumed_operation_id = p_operation_id,
        consumed_by_auth_user_id = v_admin_auth, consumed_at = now()
    where id = v_auth.id;

  insert into public.system_audit_log(actor_auth_user_id, action, target_type, target_id, metadata)
  values (v_admin_auth, 'system_admin_resolved_duplicate_active_walks', 'family', v_auth.family_id,
    jsonb_build_object(
      'authorization_id', v_auth.id,
      'resolution_group_id', v_group,
      'dog_id', v_auth.dog_id,
      'walk_ids', to_jsonb(v_requested),
      'operation_id', p_operation_id,
      'canonical_walk_id', null,
      'approval_reference', v_auth.approval_reference,
      'actor_profile_id', v_profile
    ));

  return v_group;
end;
$$;
revoke all on function public.system_admin_resolve_authorized_duplicate_walks_v12(uuid, uuid) from public, anon;
grant execute on function public.system_admin_resolve_authorized_duplicate_walks_v12(uuid, uuid) to authenticated;

comment on function public.system_admin_resolve_authorized_duplicate_walks_v12(uuid, uuid) is
  'Verified System Admin only. Applies the v1.2 duplicate-resolution marker (no canonical walk) to exactly the walks named in one unexpired, unused maintenance authorization; snapshots each row, writes system_audit_log, and is idempotent per operation id. Never deletes or rewrites walk or GPS data.';
