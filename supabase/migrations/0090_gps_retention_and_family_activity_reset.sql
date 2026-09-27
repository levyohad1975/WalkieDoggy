-- Product retention + family activity reset.
-- Detailed route coordinates are retained for 7 days; aggregate GPS summary stays.
-- Family reset is admin-only and deliberately preserves family/users/dogs/schedule.

create or replace function prune_expired_gps_routes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare affected integer;
begin
  update walk_gps_sessions
     set route_points = null,
         updated_at = now()
   where route_points is not null
     and coalesce(ended_at, created_at) < now() - interval '7 days';
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function prune_expired_gps_routes() from public, anon, authenticated;

-- Run daily when pg_cron is available (Supabase hosted projects support it).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'walkie-prune-gps-routes') then
      perform cron.schedule('walkie-prune-gps-routes', '17 3 * * *', 'select public.prune_expired_gps_routes();');
    end if;
  end if;
end $$;

create or replace function admin_reset_family_activity()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  fid uuid;
  deleted_walks integer;
begin
  fid := current_family_id();
  if fid is null or not is_family_admin() then
    raise exception 'family admin required';
  end if;

  -- walk_gps_sessions cascade through walks. Schedule rules/entries, family,
  -- users, dogs and health/grooming records intentionally survive.
  delete from walks where family_id = fid;
  get diagnostics deleted_walks = row_count;

  return jsonb_build_object('ok', true, 'deleted_walks', deleted_walks);
end;
$$;

revoke all on function admin_reset_family_activity() from public, anon;
grant execute on function admin_reset_family_activity() to authenticated;
