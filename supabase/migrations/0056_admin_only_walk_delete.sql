-- Walk deletion is a manager correction tool only.
-- This guard is additive: it runs alongside the existing walk write-authorization trigger
-- and prevents regular members from deleting either planned or spontaneous history.
create or replace function enforce_admin_only_walk_delete()
returns trigger as $$
begin
  if coalesce(current_setting('app.trusted_write', true), '') = 'on' then
    return old;
  end if;

  if not is_family_admin(old.family_id) then
    raise exception 'only a family admin may delete a walk';
  end if;

  return old;
end;
$$ language plpgsql volatile security definer set search_path = public;

drop trigger if exists walks_admin_only_delete on walks;
create trigger walks_admin_only_delete
before delete on walks
for each row execute function enforce_admin_only_walk_delete();