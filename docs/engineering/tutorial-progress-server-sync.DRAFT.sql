-- DRAFT — NOT A MIGRATION. Do not copy into supabase/migrations/ or apply
-- to any hosted database without explicit owner approval (AGENTS.md 8–9).
--
-- Purpose: let the first-run tutorial decision follow a family member across
-- devices. The client already persists a per (family, profile) record locally
-- (src/lib/tutorialProgress.ts) and exposes setTutorialRemoteAdapter() for a
-- server-backed adapter; this sketch is the proposed server side.
--
-- Design notes
-- * One row per (family_id, family_user_id). No PII beyond existing ids.
-- * Writes only through a SECURITY DEFINER RPC that derives the caller's
--   family and claimed profile server-side (never trusts client ids), in the
--   same style as the existing claim/ownership checks.
-- * Monotonic: 'completed' never downgrades to 'dismissed'.
-- * No effect on walks, schedules, SyncQueue or authentication.

create table if not exists public.member_tutorial_progress (
  family_id uuid not null references public.families(id) on delete cascade,
  family_user_id uuid not null references public.family_users(id) on delete cascade,
  status text not null check (status in ('dismissed', 'completed')),
  updated_at timestamptz not null default now(),
  primary key (family_id, family_user_id)
);

alter table public.member_tutorial_progress enable row level security;

-- Read: only the caller's own claimed profile in the caller's current family.
-- (Exact helper names must be confirmed against the deployed schema before
-- this draft is turned into a real migration.)
-- create policy member_tutorial_progress_select_own on public.member_tutorial_progress
--   for select using (family_id = public.current_family_id() and family_user_id = public.current_profile_id());

-- create or replace function public.record_tutorial_progress(p_status text)
-- returns void language plpgsql security definer set search_path = public as $$
-- declare v_family uuid := public.current_family_id(); v_profile uuid := public.current_profile_id();
-- begin
--   if v_family is null or v_profile is null then raise exception 'not authorized'; end if;
--   if p_status not in ('dismissed', 'completed') then raise exception 'invalid status'; end if;
--   insert into public.member_tutorial_progress (family_id, family_user_id, status)
--   values (v_family, v_profile, p_status)
--   on conflict (family_id, family_user_id) do update
--     set status = case when member_tutorial_progress.status = 'completed' then 'completed' else excluded.status end,
--         updated_at = now();
-- end $$;
