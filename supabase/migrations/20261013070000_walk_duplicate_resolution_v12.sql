-- Audited duplicate/test-start resolution. Run before the v1.1 active-walk
-- uniqueness migration. This migration changes schema only: it never edits
-- walk rows or GPS data by itself. A separate, reviewed RPC invocation is
-- required to mark selected records as resolved.

create table public.walk_duplicate_resolution_groups (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete restrict,
  dog_id uuid not null references public.dogs(id) on delete restrict,
  canonical_walk_id uuid references public.walks(id) on delete restrict,
  created_by_user_id uuid not null references public.users(id) on delete restrict,
  operation_id uuid not null,
  rationale text not null check (length(btrim(rationale)) between 10 and 1000),
  request_walk_ids uuid[] not null,
  created_at timestamptz not null default now(),
  unique (family_id, created_by_user_id, operation_id)
);

create table public.walk_duplicate_resolution_items (
  group_id uuid not null references public.walk_duplicate_resolution_groups(id) on delete restrict,
  walk_id uuid not null references public.walks(id) on delete restrict,
  original_walk jsonb not null,
  linked_gps_session_ids uuid[] not null default '{}',
  disposition text not null check (disposition in ('canonical','resolved_duplicate')),
  primary key (group_id, walk_id),
  unique (walk_id)
);

alter table public.walks
  add column duplicate_resolution_group_id uuid
  references public.walk_duplicate_resolution_groups(id) on delete restrict;

alter table public.walk_duplicate_resolution_groups enable row level security;
alter table public.walk_duplicate_resolution_items enable row level security;
create policy "family admins can inspect duplicate resolution groups"
  on public.walk_duplicate_resolution_groups for select to authenticated
  using (family_id = public.current_family_id() and public.is_family_admin(family_id));
create policy "family admins can inspect duplicate resolution items"
  on public.walk_duplicate_resolution_items for select to authenticated
  using (exists (
    select 1 from public.walk_duplicate_resolution_groups g
    where g.id = group_id and g.family_id = public.current_family_id()
      and public.is_family_admin(g.family_id)
  ));
revoke all on public.walk_duplicate_resolution_groups, public.walk_duplicate_resolution_items from public, anon;
revoke insert, update, delete on public.walk_duplicate_resolution_groups, public.walk_duplicate_resolution_items from authenticated;
grant select on public.walk_duplicate_resolution_groups, public.walk_duplicate_resolution_items to authenticated;

create function public.prevent_untrusted_duplicate_resolution_marker_change()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if old.duplicate_resolution_group_id is distinct from new.duplicate_resolution_group_id
     and current_user <> 'postgres' then
    raise exception 'duplicate resolution must use the audited administrator operation';
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_untrusted_duplicate_resolution_marker_change() from public, anon, authenticated;
create trigger walks_duplicate_resolution_marker_guard
  before update of duplicate_resolution_group_id on public.walks
  for each row execute function public.prevent_untrusted_duplicate_resolution_marker_change();

create function public.resolve_duplicate_active_walks_v12(
  p_walk_ids uuid[],
  p_canonical_walk_id uuid,
  p_rationale text,
  p_operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor uuid := public.real_current_profile_id();
  family uuid := public.current_family_id();
  dog uuid;
  existing public.walk_duplicate_resolution_groups;
  group_id uuid;
  requested_ids uuid[];
  affected integer;
begin
  if auth.uid() is null or actor is null or family is null then raise exception 'active profile required'; end if;
  if not public.is_family_admin(family) then raise exception 'family admin required'; end if;
  if p_operation_id is null or p_walk_ids is null or cardinality(p_walk_ids) < 2
     or array_position(p_walk_ids, null) is not null then
    raise exception 'at least two walk ids and an operation id are required';
  end if;
  select array_agg(x order by x) into requested_ids from (select distinct unnest(p_walk_ids) x) ids;
  if cardinality(requested_ids) <> cardinality(p_walk_ids) then raise exception 'duplicate walk ids are not allowed'; end if;
  if p_canonical_walk_id is not null and not (p_canonical_walk_id = any(requested_ids)) then
    raise exception 'canonical walk must be part of the resolution group';
  end if;
  if p_rationale is null or length(btrim(p_rationale)) not between 10 and 1000 then
    raise exception 'a 10-1000 character audit rationale is required';
  end if;

  -- Serialize by operation id; an identical retry returns the existing audit group.
  perform pg_advisory_xact_lock(hashtextextended(family::text || actor::text || p_operation_id::text, 0));
  select * into existing from public.walk_duplicate_resolution_groups g
    where g.family_id = family and g.created_by_user_id = actor and g.operation_id = p_operation_id for update;
  if found then
    if existing.request_walk_ids is distinct from requested_ids
       or existing.canonical_walk_id is distinct from p_canonical_walk_id
       or existing.rationale is distinct from btrim(p_rationale) then
      raise exception 'operation id reused with a different duplicate resolution request';
    end if;
    return existing.id;
  end if;

  -- Lock and validate every source row before creating any audit or marker data.
  perform 1 from public.walks w where w.id = any(requested_ids) and w.family_id = family
    and w.status = 'in_progress' and w.duplicate_resolution_group_id is null order by w.id for update;
  get diagnostics affected = row_count;
  if affected <> cardinality(requested_ids) then
    raise exception 'all selected walks must be unresolved active walks in the current family';
  end if;
  select w.dog_id into dog from public.walks w
    where w.id = any(requested_ids) and w.family_id = family limit 1;
  if not exists (select 1 from public.dogs d where d.id = dog and d.family_id = family) then
    raise exception 'selected walks must reference a dog in the current family';
  end if;
  if exists (select 1 from public.walks w where w.id = any(requested_ids) and w.family_id = family and w.dog_id <> dog) then
    raise exception 'all selected walks must belong to the same dog';
  end if;

  insert into public.walk_duplicate_resolution_groups(
    family_id,dog_id,canonical_walk_id,created_by_user_id,operation_id,rationale,request_walk_ids
  ) values (family,dog,p_canonical_walk_id,actor,p_operation_id,btrim(p_rationale),requested_ids)
  returning id into group_id;

  insert into public.walk_duplicate_resolution_items(group_id,walk_id,original_walk,linked_gps_session_ids,disposition)
  select group_id,w.id,to_jsonb(w),
    coalesce((select array_agg(s.id order by s.id) from public.walk_gps_sessions s where s.walk_id=w.id),'{}'),
    case when w.id=p_canonical_walk_id then 'canonical' else 'resolved_duplicate' end
  from public.walks w where w.id = any(requested_ids) and w.family_id = family;

  -- Only add the resolution marker. Status, all timestamps, attribution,
  -- GPS sessions, and route points remain byte-for-byte untouched.
  update public.walks set duplicate_resolution_group_id = group_id
    where id = any(requested_ids) and family_id = family and status = 'in_progress'
      and duplicate_resolution_group_id is null
      and (p_canonical_walk_id is null or id <> p_canonical_walk_id);
  get diagnostics affected = row_count;
  if affected <> cardinality(requested_ids) - case when p_canonical_walk_id is null then 0 else 1 end then
    raise exception 'walk set changed while resolving duplicates';
  end if;
  return group_id;
end;
$$;
revoke all on function public.resolve_duplicate_active_walks_v12(uuid[],uuid,text,uuid) from public, anon;
grant execute on function public.resolve_duplicate_active_walks_v12(uuid[],uuid,text,uuid) to authenticated;

comment on column public.walks.duplicate_resolution_group_id is
  'Admin-audited exclusion from active-walk lifecycle; original walk and GPS history remain unchanged.';
