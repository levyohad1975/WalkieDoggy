-- ============================================================================
-- 0036_atomic_family_approval_transition.sql
--
-- Release-candidate hardening: approval is a one-way decision from pending.
-- The row lock makes concurrent System Admin decisions deterministic. A
-- missing family and an already-decided family intentionally produce
-- different errors so the client can refresh instead of offering a stale
-- repeated action.
-- ============================================================================

create or replace function system_admin_set_family_approval(
  p_family_id uuid,
  p_approval_status text
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_current_status text;
begin
  if not is_system_admin() then
    raise exception 'system admin permission required';
  end if;
  if p_approval_status not in ('active', 'rejected') then
    raise exception 'invalid approval status';
  end if;

  select approval_status
  into v_current_status
  from families
  where id = p_family_id
  for update;

  if not found then
    raise exception 'family not found';
  end if;
  if v_current_status <> 'pending' then
    raise exception 'family approval is no longer pending';
  end if;

  update families
  set approval_status = p_approval_status
  where id = p_family_id
    and approval_status = 'pending';

  if not found then
    raise exception 'family approval changed concurrently';
  end if;

  insert into system_audit_log (
    actor_auth_user_id, action, target_type, target_id, metadata
  ) values (
    auth.uid(),
    'family.approval_changed',
    'family',
    p_family_id,
    jsonb_build_object(
      'from_approval_status', 'pending',
      'approval_status', p_approval_status
    )
  );
end;
$$;

revoke all on function system_admin_set_family_approval(uuid, text) from public;
grant execute on function system_admin_set_family_approval(uuid, text) to authenticated;
