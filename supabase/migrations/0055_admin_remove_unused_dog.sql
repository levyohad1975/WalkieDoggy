-- 0055_admin_remove_unused_dog.sql
-- Safely removes only an accidentally-created dog that has never acquired dependent data.
-- Historical dogs are deliberately non-deletable so walks/schedules/health/GPS can never be cascaded away.

create or replace function admin_remove_unused_dog(p_dog_id uuid)
returns void as $$
declare
  fam uuid;
  dog_family uuid;
begin
  if auth.uid() is null then raise exception 'must be authenticated'; end if;
  fam := current_family_id();
  if fam is null or not is_family_admin(fam) then raise exception 'admin permission required'; end if;

  select family_id into dog_family from dogs where id = p_dog_id;
  if dog_family is null or dog_family is distinct from fam then raise exception 'dog not found'; end if;

  if exists (select 1 from schedule_rules where dog_id = p_dog_id)
     or exists (select 1 from schedule_entries where dog_id = p_dog_id)
     or exists (select 1 from walks where dog_id = p_dog_id)
     or exists (select 1 from health_tasks where dog_id = p_dog_id) then
    raise exception 'dog has history and cannot be removed';
  end if;

  -- SECURITY DEFINER is the sole delete boundary. Migration 0042 intentionally
  -- leaves dogs without a client DELETE policy.
  delete from dogs where id = p_dog_id;
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function admin_remove_unused_dog(uuid) from public;
grant execute on function admin_remove_unused_dog(uuid) to authenticated;
