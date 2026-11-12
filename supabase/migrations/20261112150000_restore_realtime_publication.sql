-- Live updates were dead in production (found 2026-11-12).
--
-- The app subscribes to Supabase Realtime "postgres_changes" for the family's
-- tables (src/lib/realtime.ts) and for the chat (src/lib/chat.ts). Realtime
-- only streams tables that are members of the `supabase_realtime`
-- publication. Production's publication exists but has NO tables at all:
-- 0017_realtime_publication / 0108_family_chat / 20261010123756 added them,
-- but production's schema was not built from that history, so nothing was
-- streamed. Every device only learned about another device's change on its
-- next reload (a walk started on Android reached the admin's iPhone minutes
-- late; chat messages appeared only when the screen was reopened).
--
-- Add back exactly the tables the client subscribes to. Realtime delivers a
-- change to a subscriber only if that subscriber's session passes the
-- table's SELECT policy, and every table below has RLS enabled, so nothing
-- becomes visible that the caller cannot already read.
-- Idempotent: skips tables that are missing or already published.

do $$
declare
  t text;
  watched text[] := array[
    'users', 'dogs', 'schedule_rules', 'schedule_entries', 'walks',
    'walk_swap_requests', 'time_change_requests',
    'chat_messages', 'chat_conversation_members'
  ];
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'publication supabase_realtime does not exist; skipping';
    return;
  end if;
  foreach t in array watched loop
    if to_regclass(format('public.%I', t)) is null then
      raise notice 'table public.% does not exist; skipping', t;
      continue;
    end if;
    if not (select c.relrowsecurity from pg_class c where c.oid = to_regclass(format('public.%I', t))) then
      raise exception 'refusing to publish public.% without row level security', t;
    end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
