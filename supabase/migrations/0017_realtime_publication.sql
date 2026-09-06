do $$
declare
  t text;
  watched_tables text[] := array[
    'users',
    'dogs',
    'schedule_rules',
    'schedule_entries',
    'walks',
    'walk_swap_requests',
    'time_change_requests'
  ];
begin
  if not exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    raise notice 'Publication supabase_realtime does not exist; skipping.';
    return;
  end if;

  foreach t in array watched_tables loop
    if to_regclass(format('public.%I', t)) is null then
      raise notice 'Table public.% does not exist; skipping.', t;
      continue;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        t
      );
    end if;
  end loop;
end
$$;
