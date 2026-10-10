-- Fix recurring schedule deletion authorization after is_family_admin was
-- standardized to require an explicit family id.
create or replace function public.admin_delete_schedule_rule(p_rule_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  fid uuid;
  deleted_entries integer;
begin
  fid := current_family_id();
  if fid is null or not is_family_admin(fid) then
    raise exception 'family admin required';
  end if;

  if not exists (
    select 1 from schedule_rules where id = p_rule_id and family_id = fid
  ) then
    raise exception 'schedule rule not found';
  end if;

  update walks w
     set schedule_entry_id = null
   where w.family_id = fid
     and w.status <> 'pending'
     and exists (
       select 1 from schedule_entries e
       where e.id = w.schedule_entry_id and e.rule_id = p_rule_id
     );

  delete from walks w
   where w.family_id = fid
     and w.status = 'pending'
     and exists (
       select 1 from schedule_entries e
       where e.id = w.schedule_entry_id and e.rule_id = p_rule_id
     );

  delete from schedule_entries where family_id = fid and rule_id = p_rule_id;
  get diagnostics deleted_entries = row_count;

  delete from schedule_rules where id = p_rule_id and family_id = fid;

  return jsonb_build_object('ok', true, 'deleted_entries', deleted_entries);
end;
$$;

revoke all on function public.admin_delete_schedule_rule(uuid) from public, anon;
grant execute on function public.admin_delete_schedule_rule(uuid) to authenticated;
