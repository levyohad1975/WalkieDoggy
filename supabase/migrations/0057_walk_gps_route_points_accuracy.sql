-- 0057_walk_gps_route_points_accuracy.sql
-- Documentation-only: walk_gps_sessions.route_points (jsonb, added in 0053)
-- needs no column/schema change to hold an extra key per point — jsonb is
-- schemaless. The application layer (src/logic/gpsDistance.ts,
-- src/store/gpsStore.ts) now carries each accepted fix's own device-reported
-- `accuracy` (meters) through into the stored route alongside
-- latitude/longitude/timestamp, instead of stripping it before persistence.
-- This migration only updates the column comment to match; no data is
-- touched, no existing row's shape changes (older rows simply have no
-- `accuracy` key per point, same as any other optional jsonb field).

comment on column walk_gps_sessions.route_points is
  'Sanitized [{latitude,longitude,timestamp,accuracy}] route points for the family-only in-app preview and future auto-detection signal — accuracy in meters, device-reported, optional (older rows predate it).';
