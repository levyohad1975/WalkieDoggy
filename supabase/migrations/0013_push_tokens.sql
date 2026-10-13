-- ----------------------------------------------------------------------------
-- 0013_push_tokens.sql
--
-- MEGA ROUND Section 10: storage for per-user, per-device Expo push tokens,
-- so a server-side Edge Function (supabase/functions/send-request-push) can
-- send a REAL remote push to the right recipient's device(s) when a
-- swap/time-change request is created or decided. No push-provider secret
-- and no service-role key are ever present on the RN client — this table
-- only stores tokens; the actual send happens in the Edge Function using
-- its own service-role context.
--
-- Design:
--   * One row per (user, device) — `token` is the natural per-device key
--     (a device's Expo push token is stable for that install), so a member
--     with two devices gets two rows and both receive a push.
--   * `family_id` is denormalized onto the row (copied from the owning
--     user at insert/update time) purely so the Edge Function's queries can
--     stay `family_id = ...` scoped like every other table in this schema,
--     without an extra join — it is NOT a separate source of truth and is
--     kept in sync by the trigger below rather than trusted from the client.
--   * RLS: a user may only see/manage their OWN tokens (auth-scoped via
--     current_profile_id(), the same helper 0005 already established) —
--     never another family member's. The Edge Function reads across the
--     whole family using its service-role key, which bypasses RLS
--     entirely (standard Supabase service-role behavior), so it can still
--     look up "everyone in this family with a token" despite this policy.
--   * `last_error`/`is_active` let the Edge Function mark a token inactive
--     after a delivery error (e.g. DeviceNotRegistered) instead of
--     retrying it forever or crashing — "stale/invalid token handling"
--     from the spec.
-- ----------------------------------------------------------------------------

create table if not exists push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  family_id uuid not null references families(id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('ios', 'android', 'web', 'unknown')),
  is_active boolean not null default true,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (token)
);

create index if not exists push_tokens_user_id_idx on push_tokens (user_id);
create index if not exists push_tokens_family_id_idx on push_tokens (family_id) where is_active;

alter table push_tokens enable row level security;

-- A user manages only their own token rows. current_profile_id() (0005)
-- already resolves "the active profile for this device's auth session" —
-- reused here rather than re-deriving it.
drop policy if exists push_tokens_self_select on push_tokens;
create policy push_tokens_self_select on push_tokens
  for select using (user_id = current_profile_id());

drop policy if exists push_tokens_self_insert on push_tokens;
create policy push_tokens_self_insert on push_tokens
  for insert with check (user_id = current_profile_id());

drop policy if exists push_tokens_self_update on push_tokens;
create policy push_tokens_self_update on push_tokens
  for update using (user_id = current_profile_id());

drop policy if exists push_tokens_self_delete on push_tokens;
create policy push_tokens_self_delete on push_tokens
  for delete using (user_id = current_profile_id());

-- Keeps family_id trustworthy without relying on the client to send it
-- correctly (it's still accepted from the client for convenience, but this
-- trigger overwrites it from the user's actual row regardless).
create or replace function set_push_token_family_id()
returns trigger as $$
begin
  select family_id into new.family_id from users where id = new.user_id;
  new.updated_at := now();
  return new;
end;
$$ language plpgsql volatile security definer set search_path = public;

drop trigger if exists push_tokens_set_family_id on push_tokens;
create trigger push_tokens_set_family_id
  before insert or update on push_tokens
  for each row execute function set_push_token_family_id();

-- Convenience upsert RPC the client calls after obtaining an Expo push
-- token — avoids the client needing to know whether a row for this exact
-- token already exists.
create or replace function upsert_push_token(p_token text, p_platform text)
returns void as $$
declare
  actor uuid;
  fam uuid;
begin
  actor := current_profile_id();
  if actor is null then
    raise exception 'no active profile found for this session';
  end if;
  select family_id into fam from users where id = actor;

  insert into push_tokens (user_id, family_id, token, platform, is_active, last_error)
  values (actor, fam, p_token, p_platform, true, null)
  on conflict (token) do update
    set user_id = excluded.user_id,
        family_id = excluded.family_id,
        platform = excluded.platform,
        is_active = true,
        last_error = null,
        updated_at = now();
end;
$$ language plpgsql volatile security definer set search_path = public;
