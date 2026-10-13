-- 0053_walk_gps_route_points.sql
-- Retain the sanitized foreground route for the in-app walk preview.
-- No accuracy or device metadata is stored; RLS remains inherited from the
-- existing walk_gps_sessions family policies.

alter table walk_gps_sessions
  add column if not exists route_points jsonb;

comment on column walk_gps_sessions.route_points is
  'Sanitized [{latitude,longitude,timestamp}] route points for the family-only in-app preview.';
