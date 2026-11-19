-- Owner request 2026-11-12: "sometimes the family member is not available to
-- approve" a swap/give/take request on the weekly routine. The family admin
-- may now approve a request that still waits for the other member
-- ('pending_target'), not only one the member already accepted
-- ('pending_admin'). The admin could already reject it at that stage, and
-- edits the routine grid directly anyway, so this adds no new power.
--
-- Same body as 20261110090000_routine_change_requests, with approval allowed
-- from 'pending_target' too. target_responded_at stays null in that case, so
-- the record shows the member never answered. The caller checks are
-- unchanged: a real family admin of the request's family (not QA
-- impersonation, not a System Admin observer).

create or replace function public.admin_decide_routine_change_request(p_id uuid, p_approve boolean)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  r record;
begin
  select * into r from public.routine_change_requests where id = p_id for update;
  if r.id is null then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if auth.uid() is null
     or public.active_system_admin_observer_family() is not null
     or public.active_impersonation_target() is not null
     or public.current_family_id() is distinct from r.family_id
     or not public.is_real_family_admin(r.family_id) then
    raise exception 'family admin required' using errcode = '42501';
  end if;
  if r.status not in ('pending_target', 'pending_admin') then
    raise exception 'request is no longer open' using errcode = '22023';
  end if;
  update public.routine_change_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by_user_id = public.real_current_profile_id(),
         decided_at = now(),
         updated_at = now()
   where id = p_id;
end $$;
revoke all on function public.admin_decide_routine_change_request(uuid, boolean) from public, anon;
grant execute on function public.admin_decide_routine_change_request(uuid, boolean) to authenticated;
