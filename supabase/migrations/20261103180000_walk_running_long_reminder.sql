-- Walk still running long after it started (owner request 2026-11-03).
--
-- A walker who forgets to tap "סיים טיול" and locks the phone gets no
-- in-app prompt (iPhone suspends web apps), so a walk ran 113 minutes. The
-- send-walk-reminders cron (every minute) now also finds walks that have
-- been in progress for 30 minutes (a typical walk is 10–20) and pushes the
-- walker once: "הטיול עדיין פעיל — סיימתם?". Opening the app at home then
-- offers to end the walk at the arrival time.
--
-- claim_walks_running_long() returns each due walk exactly once: it records
-- the notice before returning it, so concurrent or repeated cron runs never
-- send twice. Server-only: no client can call it or read the table.

create table if not exists public.walk_running_long_notices (
  walk_id uuid primary key references public.walks(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  recipient_user_id uuid references public.users(id) on delete set null,
  notified_at timestamptz not null default now()
);
alter table public.walk_running_long_notices enable row level security;
revoke all on public.walk_running_long_notices from public, anon, authenticated;

create or replace function public.claim_walks_running_long(p_minutes integer default 30)
returns table(walk_id uuid, family_id uuid, recipient_user_id uuid, dog_name text, minutes_running integer)
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
begin
  return query
  with due as (
    select w.id as due_walk_id, w.family_id as due_family_id,
           coalesce(w.actual_walker_user_id, w.responsible_user_id) as due_recipient,
           d.name as due_dog_name,
           floor(extract(epoch from (now() - w.started_at)) / 60)::integer as due_minutes
    from public.walks w
    left join public.dogs d on d.id = w.dog_id
    where w.status = 'in_progress'
      and w.started_at is not null
      and w.started_at <= now() - make_interval(mins => greatest(coalesce(p_minutes, 30), 10))
      and w.started_at > now() - interval '6 hours'
  ), claimed as (
    insert into public.walk_running_long_notices (walk_id, family_id, recipient_user_id)
    select due_walk_id, due_family_id, due_recipient from due
    on conflict (walk_id) do nothing
    returning walk_running_long_notices.walk_id as claimed_walk_id
  )
  select due.due_walk_id, due.due_family_id, due.due_recipient, due.due_dog_name, due.due_minutes
  from due join claimed on claimed.claimed_walk_id = due.due_walk_id;
end $$;
revoke all on function public.claim_walks_running_long(integer) from public, anon, authenticated;
grant execute on function public.claim_walks_running_long(integer) to service_role;

comment on table public.walk_running_long_notices is 'One "walk still running" push per walk (send-walk-reminders). Server-only.';
