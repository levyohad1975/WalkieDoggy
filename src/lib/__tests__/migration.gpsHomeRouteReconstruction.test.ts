import fs from 'fs';
import path from 'path';

const migration = fs.readFileSync(path.resolve(__dirname, '../../../supabase/migrations/20261023100000_gps_home_route_reconstruction.sql'), 'utf8');

describe('verified home and GPS reconstruction migration contract', () => {
  it('adds nullable home and estimate fields without rewriting walk history', () => {
    expect(migration).toMatch(/add column if not exists home_latitude/i);
    expect(migration).toMatch(/add column if not exists home_longitude/i);
    expect(migration).toMatch(/add column if not exists reconstruction jsonb/i);
    expect(migration).not.toMatch(/update\s+public\.(walks|walk_gps_sessions|walk_gps_route_samples_v11)/i);
    expect(migration).not.toMatch(/delete\s+from\s+public\.(walks|walk_gps_sessions|walk_gps_route_samples_v11)/i);
  });

  it('requires a complete, accuracy-bounded explicitly verified home coordinate', () => {
    expect(migration).toMatch(/home_accuracy_meters between 0 and 25/i);
    expect(migration).toMatch(/home_verified_at is not null and home_verified_by_user_id is not null/i);
    expect(migration).toMatch(/family admin required to verify dog home location/i);
    expect(migration).toMatch(/family admin required to change dog home location/i);
    expect(migration).toMatch(/home location verifier must be the current family profile/i);
    expect(migration).toMatch(/new.home_verified_by_user_id is distinct from public.real_current_profile_id()/i);
    expect(migration).toMatch(/public\.is_family_admin\(new\.family_id\) is distinct from true/i);
    expect(migration).toMatch(/older\/offline dog objects can omit newly added fields[\s\S]+new\.home_latitude := old\.home_latitude/i);
  });

  it('replays only idempotent estimate metadata and authorizes the claimed actual walker', () => {
    expect(migration).toMatch(/create or replace function public\.save_walk_gps_reconstruction_v1/i);
    expect(migration).toMatch(/coalesce\(w\.actual_walker_user_id,w\.responsible_user_id\) = public\.real_current_profile_id\(\)/i);
    expect(migration).toMatch(/w\.dog_id = target\.dog_id and w\.status = 'done'/i);
    expect(migration).toMatch(/routePoints[\s\S]+timestamp[\s\S]+<> 0/i);
    expect(migration).toMatch(/on conflict\(walk_id\) do update set reconstruction = coalesce\(public\.walk_gps_sessions\.reconstruction, excluded\.reconstruction\)/i);
    const rpc = migration.slice(migration.indexOf('create or replace function public.save_walk_gps_reconstruction_v1'));
    expect(rpc).not.toMatch(/set\s+distance_meters\s*=|set\s+point_count\s*=|set\s+route_points\s*=/i);
    expect(migration).toMatch(/revoke all on function public\.save_walk_gps_reconstruction_v1\(uuid,jsonb\) from public, anon/i);
  });
});
