-- "הטיול האחרון" should be the last walk that was actually PERFORMED.
--
-- Owner request 2026-11-05: the Home "last walk" card must show the last walk
-- the dog actually went out on (so the family can tell how long it has been
-- since she last went out for needs). A skipped walk means she did NOT go out,
-- so it must never be presented as the last walk.
--
-- get_last_resolved_walk() is the single-row server fallback the Home card uses
-- when nothing was resolved locally today (migration 0027). It previously
-- returned the most recent walk with status in ('done','skipped'); narrow it to
-- 'done' only. The client's computeLastWalk() is narrowed the same way.
--
-- Signature, security, search_path and grants are unchanged from 0027/0028; only
-- the status filter changes. Read-only SELECT function; no security impact.

create or replace function get_last_resolved_walk()
returns setof walks as $$
declare
  v_family_id uuid;
begin
  v_family_id := current_family_id();
  if v_family_id is null then
    return; -- no active family/profile: fail closed, zero rows.
  end if;

  return query
    select w.*
    from walks w
    join families f on f.id = w.family_id
    where w.family_id = v_family_id
      and w.status = 'done'
      and coalesce(
            w.completed_at,
            ((w.date::text || ' ' || w.scheduled_time || ':00')::timestamp at time zone f.timezone)
          ) <= now()
    order by coalesce(
               w.completed_at,
               ((w.date::text || ' ' || w.scheduled_time || ':00')::timestamp at time zone f.timezone)
             ) desc
    limit 1;
end;
$$ language plpgsql stable security definer set search_path = public;

revoke all on function get_last_resolved_walk() from public, anon;
grant execute on function get_last_resolved_walk() to authenticated;

comment on function get_last_resolved_walk() is
  'Single-row Home "last walk" fallback. Returns the most recent PERFORMED (done) walk for the current family (2026-11-05: narrowed from done/skipped to done only — a skipped walk was not performed and must not show as the last walk). Family-scoped, fail-closed.';
