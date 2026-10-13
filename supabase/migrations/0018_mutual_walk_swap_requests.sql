-- 0018_mutual_walk_swap_requests.sql
-- A swap request now names TWO exact pending walks. Approval exchanges the
-- responsible users on both walks and their backing schedule_entries in one
-- transaction. Existing one-sided pending requests cannot be safely inferred,
-- so they are closed as rejected during this migration; resolved history stays.

alter table walk_swap_requests
  add column if not exists expected_scheduled_time text,
  add column if not exists target_walk_id uuid references walks(id) on delete cascade,
  add column if not exists expected_target_responsible_user_id uuid,
  add column if not exists expected_target_status text,
  add column if not exists expected_target_scheduled_time text;

create index if not exists walk_swap_requests_target_walk_id_idx
  on walk_swap_requests(target_walk_id);

-- Legacy pending rows name a person but not a specific reciprocal walk.
update walk_swap_requests
set status = 'rejected', resolved_at = coalesce(resolved_at, now())
where status = 'pending' and target_walk_id is null;

-- Same SQL type signature as the old function, but the second UUID now means
-- target WALK rather than target USER. DROP is required because PostgreSQL
-- does not allow renaming an input parameter via CREATE OR REPLACE.
drop function if exists create_swap_request(uuid, uuid);

create function create_swap_request(p_walk_id uuid, p_target_walk_id uuid)
returns uuid as $$
declare
  me uuid;
  my_family uuid;
  source_w record;
  target_w record;
  new_id uuid;
begin
  me := current_profile_id();
  if me is null then
    raise exception 'no active profile claimed on this family';
  end if;
  my_family := current_family_id();

  if p_walk_id = p_target_walk_id then
    raise exception 'choose a different walk';
  end if;

  -- Deterministic lock order prevents inverse concurrent requests from
  -- deadlocking while both exact occurrences are validated.
  perform 1 from walks
  where id in (p_walk_id, p_target_walk_id)
  order by id
  for update;

  select * into source_w from walks where id = p_walk_id;
  select * into target_w from walks where id = p_target_walk_id;

  if source_w.id is null or source_w.family_id is distinct from my_family then
    raise exception 'walk not found in this family';
  end if;
  if target_w.id is null or target_w.family_id is distinct from my_family then
    raise exception 'target walk not found in this family';
  end if;
  if source_w.status <> 'pending' or target_w.status <> 'pending' then
    raise exception 'both walks must still be pending';
  end if;
  if source_w.responsible_user_id <> me then
    raise exception 'you can only request a swap for a walk you are responsible for';
  end if;
  if target_w.responsible_user_id = me then
    raise exception 'choose a walk assigned to a different family member';
  end if;
  if target_w.dog_id is distinct from source_w.dog_id then
    raise exception 'both walks must belong to the same dog';
  end if;
  if not exists (
    select 1 from users
    where id = target_w.responsible_user_id
      and family_id = my_family
      and removed_at is null
  ) then
    raise exception 'target member is not an active member of this family';
  end if;

  -- Neither exact walk may participate on either side of another pending swap.
  if exists (
    select 1 from walk_swap_requests r
    where r.status = 'pending'
      and (
        r.walk_id in (p_walk_id, p_target_walk_id)
        or r.target_walk_id in (p_walk_id, p_target_walk_id)
      )
  ) then
    raise exception 'a pending swap request already exists for one of these walks';
  end if;

  insert into walk_swap_requests (
    family_id, walk_id, target_walk_id, requested_by_user_id, target_user_id,
    expected_responsible_user_id, expected_status, expected_scheduled_time,
    expected_target_responsible_user_id, expected_target_status, expected_target_scheduled_time
  ) values (
    my_family, source_w.id, target_w.id, me, target_w.responsible_user_id,
    source_w.responsible_user_id, source_w.status, source_w.scheduled_time,
    target_w.responsible_user_id, target_w.status, target_w.scheduled_time
  ) returning id into new_id;

  perform log_audit_event(my_family, me, 'swap_request_created', 'walk', source_w.id,
    jsonb_build_object(
      'request_id', new_id,
      'source_walk_id', source_w.id,
      'target_walk_id', target_w.id,
      'target_user_id', target_w.responsible_user_id
    ));

  return new_id;
end;
$$ language plpgsql volatile security definer set search_path = public;

create or replace function approve_swap_request(p_request_id uuid)
returns void as $$
declare
  me uuid;
  req record;
  source_w record;
  target_w record;
begin
  me := current_profile_id();
  if me is null then
    raise exception 'no active profile claimed on this family';
  end if;

  select * into req from walk_swap_requests where id = p_request_id for update;
  if req.id is null or req.family_id is distinct from current_family_id() then
    raise exception 'request not found in this family';
  end if;
  if req.target_user_id <> me then
    raise exception 'only the requested member can approve this swap';
  end if;

  if req.status = 'approved' then return; end if;
  if req.status = 'rejected' then raise exception 'this request was already rejected'; end if;
  if req.target_walk_id is null then
    raise exception 'legacy swap request has no target walk and can no longer be approved';
  end if;

  perform 1 from walks
  where id in (req.walk_id, req.target_walk_id)
  order by id
  for update;

  select * into source_w from walks where id = req.walk_id;
  select * into target_w from walks where id = req.target_walk_id;

  if source_w.id is null
     or source_w.family_id is distinct from req.family_id
     or source_w.status <> 'pending'
     or source_w.responsible_user_id is distinct from req.expected_responsible_user_id
     or source_w.scheduled_time is distinct from req.expected_scheduled_time then
    raise exception 'the source walk has changed since this request was created and can no longer be approved';
  end if;

  if target_w.id is null
     or target_w.family_id is distinct from req.family_id
     or target_w.status <> 'pending'
     or target_w.responsible_user_id is distinct from req.expected_target_responsible_user_id
     or target_w.scheduled_time is distinct from req.expected_target_scheduled_time then
    raise exception 'the target walk has changed since this request was created and can no longer be approved';
  end if;

  if source_w.dog_id is distinct from target_w.dog_id then
    raise exception 'both walks must belong to the same dog';
  end if;
  if req.requested_by_user_id is distinct from source_w.responsible_user_id
     or req.target_user_id is distinct from target_w.responsible_user_id then
    raise exception 'one of the walks has changed ownership since this request was created';
  end if;
  if not exists (select 1 from users where id = req.requested_by_user_id and family_id = req.family_id and removed_at is null)
     or not exists (select 1 from users where id = req.target_user_id and family_id = req.family_id and removed_at is null) then
    raise exception 'one of the swap members is no longer active in this family';
  end if;

  perform set_config('app.trusted_write', 'on', true);

  if source_w.schedule_entry_id is not null then
    update schedule_entries
    set responsible_user_id = req.target_user_id
    where id = source_w.schedule_entry_id and family_id = req.family_id;
  end if;
  if target_w.schedule_entry_id is not null then
    update schedule_entries
    set responsible_user_id = req.requested_by_user_id
    where id = target_w.schedule_entry_id and family_id = req.family_id;
  end if;

  update walks
  set responsible_user_id = req.target_user_id,
      swap_original_user_id = coalesce(source_w.swap_original_user_id, source_w.responsible_user_id),
      swap_new_user_id = req.target_user_id,
      swap_swapped_at = now(),
      swap_swapped_by_user_id = me,
      updated_at = now()
  where id = source_w.id;

  update walks
  set responsible_user_id = req.requested_by_user_id,
      swap_original_user_id = coalesce(target_w.swap_original_user_id, target_w.responsible_user_id),
      swap_new_user_id = req.requested_by_user_id,
      swap_swapped_at = now(),
      swap_swapped_by_user_id = me,
      updated_at = now()
  where id = target_w.id;

  perform set_config('app.trusted_write', 'off', true);

  update walk_swap_requests
  set status = 'approved', resolved_at = now(), resolved_by_user_id = me
  where id = p_request_id;

  perform log_audit_event(req.family_id, me, 'swap_request_approved', 'walk', source_w.id,
    jsonb_build_object(
      'request_id', p_request_id,
      'requested_by_user_id', req.requested_by_user_id,
      'source_walk_id', source_w.id,
      'target_walk_id', target_w.id
    ));
end;
$$ language plpgsql volatile security definer set search_path = public;

-- reject_swap_request keeps the same authorization/status behavior; include
-- both walk ids in the audit record for the new mutual-swap model.
create or replace function reject_swap_request(p_request_id uuid)
returns void as $$
declare
  me uuid;
  req record;
begin
  me := current_profile_id();
  if me is null then raise exception 'no active profile claimed on this family'; end if;

  select * into req from walk_swap_requests where id = p_request_id for update;
  if req.id is null or req.family_id is distinct from current_family_id() then
    raise exception 'request not found in this family';
  end if;
  if req.target_user_id <> me then
    raise exception 'only the requested member can reject this swap';
  end if;
  if req.status = 'rejected' then return; end if;
  if req.status = 'approved' then raise exception 'this request was already approved'; end if;

  update walk_swap_requests
  set status = 'rejected', resolved_at = now(), resolved_by_user_id = me
  where id = p_request_id;

  perform log_audit_event(req.family_id, me, 'swap_request_rejected', 'walk', req.walk_id,
    jsonb_build_object(
      'request_id', p_request_id,
      'requested_by_user_id', req.requested_by_user_id,
      'source_walk_id', req.walk_id,
      'target_walk_id', req.target_walk_id
    ));
end;
$$ language plpgsql volatile security definer set search_path = public;
