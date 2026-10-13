-- 0021_web_push_subscriptions.sql
-- Browser Web Push subscriptions.
-- A subscription belongs to the REAL profile signed in on this device,
-- never to a temporary QA impersonation target.

create table if not exists web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  family_id uuid not null references families(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  is_active boolean not null default true,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (endpoint)
);

create index if not exists web_push_subscriptions_user_id_idx
  on web_push_subscriptions(user_id);

create index if not exists web_push_subscriptions_family_id_idx
  on web_push_subscriptions(family_id);

alter table web_push_subscriptions enable row level security;

drop policy if exists "web push subscriptions select own" on web_push_subscriptions;
create policy "web push subscriptions select own"
  on web_push_subscriptions
  for select
  using (
    user_id = real_current_profile_id()
    and family_id = current_family_id()
  );

drop policy if exists "web push subscriptions delete own" on web_push_subscriptions;
create policy "web push subscriptions delete own"
  on web_push_subscriptions
  for delete
  using (
    user_id = real_current_profile_id()
    and family_id = current_family_id()
  );

-- Registration is intentionally done through an RPC instead of allowing
-- arbitrary client INSERT/UPDATE. The server derives both user_id and
-- family_id from the authenticated device session.
create or replace function upsert_web_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text
)
returns void as $$
declare
  actor uuid;
  fam uuid;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;

  actor := real_current_profile_id();
  fam := current_family_id();

  if actor is null or fam is null then
    raise exception 'no active profile found for this session';
  end if;

  if not exists (
    select 1
    from users
    where id = actor
      and family_id = fam
      and removed_at is null
  ) then
    raise exception 'active profile does not belong to current family';
  end if;

  if nullif(trim(p_endpoint), '') is null
     or nullif(trim(p_p256dh), '') is null
     or nullif(trim(p_auth), '') is null then
    raise exception 'invalid web push subscription';
  end if;

  insert into web_push_subscriptions (
    user_id,
    family_id,
    endpoint,
    p256dh,
    auth,
    is_active,
    last_error
  )
  values (
    actor,
    fam,
    p_endpoint,
    p_p256dh,
    p_auth,
    true,
    null
  )
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        family_id = excluded.family_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        is_active = true,
        last_error = null,
        updated_at = now();
end;
$$ language plpgsql volatile security definer set search_path = public;

revoke all on function upsert_web_push_subscription(text, text, text) from public;
grant execute on function upsert_web_push_subscription(text, text, text) to authenticated;