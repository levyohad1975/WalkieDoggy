-- Remote GPS activation: consent is per profile and explicitly revocable.
-- A command is not evidence that GPS has started: only the target auth session
-- may acknowledge actual device tracking. No location coordinates in commands.
create table if not exists remote_gps_consents (
  family_id uuid not null references families(id) on delete cascade,
  user_id uuid primary key references users(id) on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table remote_gps_consents enable row level security;
-- No direct table writes: all changes are audited/authorized by RPCs.

create table if not exists remote_gps_commands (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  walk_id uuid not null references walks(id) on delete cascade,
  target_user_id uuid not null references users(id) on delete cascade,
  target_auth_user_id uuid not null references auth.users(id) on delete cascade,
  requested_by_user_id uuid not null references users(id),
  status text not null default 'pending'
    check (status in ('pending','tracking','failed','expired')),
  failure_reason text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 seconds'),
  acknowledged_at timestamptz
);
create index if not exists remote_gps_commands_target_idx
  on remote_gps_commands (target_auth_user_id, created_at desc);
create unique index if not exists remote_gps_commands_one_pending
  on remote_gps_commands (walk_id) where status = 'pending';
alter table remote_gps_commands enable row level security;
create policy "target can read own remote gps commands"
  on remote_gps_commands for select to authenticated
  using (target_auth_user_id = auth.uid() and family_id = current_family_id());
create policy "family admin can read remote gps commands"
  on remote_gps_commands for select to authenticated
  using (family_id = current_family_id() and is_family_admin(family_id));

create or replace function set_remote_gps_consent(p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := real_current_profile_id(); v_family uuid := current_family_id();
begin
  if v_user is null or v_family is null then raise exception 'active profile required'; end if;
  insert into remote_gps_consents(family_id,user_id,enabled,updated_at)
  values(v_family,v_user,p_enabled,now())
  on conflict(user_id) do update set enabled=excluded.enabled, updated_at=now();
  if not p_enabled then
    update remote_gps_commands set status='failed', failure_reason='consent_revoked'
    where target_user_id=v_user and status='pending';
  end if;
end; $$;
revoke all on function set_remote_gps_consent(boolean) from public;
grant execute on function set_remote_gps_consent(boolean) to authenticated;

create or replace function request_remote_gps_start(p_walk_id uuid, p_target_auth_user_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_walk walks; v_actor uuid := real_current_profile_id(); v_id uuid;
begin
  if v_actor is null then raise exception 'active profile required'; end if;
  select * into v_walk from walks where id=p_walk_id for update;
  if not found or v_walk.family_id is distinct from current_family_id() then raise exception 'walk not found'; end if;
  if not is_family_admin(v_walk.family_id) then raise exception 'admin required'; end if;
  if v_walk.status not in ('pending','in_progress') then raise exception 'walk unavailable'; end if;
  if not exists (
    select 1 from remote_gps_consents c
    join profile_auth_sessions s on s.user_id=c.user_id and s.family_id=c.family_id
    where c.enabled and c.user_id=v_walk.responsible_user_id
      and c.family_id=v_walk.family_id and s.auth_user_id=p_target_auth_user_id
  ) then raise exception 'target device has no active consent'; end if;
  update remote_gps_commands set status='expired'
    where walk_id=p_walk_id and status='pending' and expires_at <= now();
  insert into remote_gps_commands(family_id,walk_id,target_user_id,target_auth_user_id,requested_by_user_id)
    values(v_walk.family_id,p_walk_id,v_walk.responsible_user_id,p_target_auth_user_id,v_actor)
    returning id into v_id;
  return v_id;
end; $$;
revoke all on function request_remote_gps_start(uuid,uuid) from public;
grant execute on function request_remote_gps_start(uuid,uuid) to authenticated;

create or replace function acknowledge_remote_gps_start(p_command_id uuid, p_tracking boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_cmd remote_gps_commands; v_consent boolean;
begin
  select * into v_cmd from remote_gps_commands where id=p_command_id for update;
  if not found or v_cmd.target_auth_user_id is distinct from auth.uid()
     or v_cmd.target_user_id is distinct from real_current_profile_id()
     or v_cmd.family_id is distinct from current_family_id()
  then raise exception 'command not found'; end if;
  if v_cmd.status <> 'pending' or v_cmd.expires_at <= now() then
    raise exception 'command expired or already handled';
  end if;
  select enabled into v_consent from remote_gps_consents where user_id=v_cmd.target_user_id;
  if v_consent is distinct from true then raise exception 'consent revoked'; end if;
  update remote_gps_commands set status=case when p_tracking then 'tracking' else 'failed' end,
    failure_reason=case when p_tracking then null else left(coalesce(p_reason,'unavailable'),100) end,
    acknowledged_at=now() where id=p_command_id;
end; $$;
revoke all on function acknowledge_remote_gps_start(uuid,boolean,text) from public;
grant execute on function acknowledge_remote_gps_start(uuid,boolean,text) to authenticated;
