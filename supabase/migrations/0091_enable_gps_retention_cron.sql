-- Enable the daily scheduler that enforces the product's 7-day raw GPS retention.
create extension if not exists pg_cron;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'walkie-prune-gps-routes') then
    perform cron.schedule(
      'walkie-prune-gps-routes',
      '17 3 * * *',
      'select public.prune_expired_gps_routes();'
    );
  end if;
end $$;
