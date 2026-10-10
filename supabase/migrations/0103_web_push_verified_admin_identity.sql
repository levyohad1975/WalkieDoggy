-- Associate browser subscriptions with verified auth accounts, not only selected profiles.
alter table public.web_push_subscriptions add column if not exists auth_user_id uuid;
create index if not exists web_push_subscriptions_family_auth_active_idx
on public.web_push_subscriptions(family_id, auth_user_id) where is_active = true;
update public.web_push_subscriptions w
set auth_user_id = u.auth_user_id from public.users u
where w.user_id = u.id and w.family_id = u.family_id
and u.auth_user_id is not null and w.auth_user_id is null;
create or replace function public.stamp_web_push_verified_identity()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is not null then
    if not exists (select 1 from public.family_auth_members m
      where m.family_id = new.family_id and m.auth_user_id = auth.uid()) then
      raise exception 'authenticated account is not a member of subscription family';
    end if;
    new.auth_user_id := auth.uid();
  end if;
  return new;
end;
$$;
drop trigger if exists web_push_stamp_verified_identity on public.web_push_subscriptions;
create trigger web_push_stamp_verified_identity before insert or update
on public.web_push_subscriptions for each row execute function public.stamp_web_push_verified_identity();
