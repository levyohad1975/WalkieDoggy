import fs from 'fs';
import path from 'path';

const migration = fs.readFileSync(
  path.resolve(__dirname, '../../../supabase/migrations/20261013074334_walk_lifecycle_gps_v11.sql'),
  'utf8',
);

describe('Walk Lifecycle & GPS v1.1 additive migration contract', () => {
  it('fails closed before uniqueness if existing data has multiple active walks for a dog', () => {
    expect(migration).toMatch(/having count\(\*\) > 1/i);
    expect(migration).toMatch(/duplicate active walks require owner-reviewed resolution/i);
    expect(migration).toMatch(/create unique index if not exists walks_one_active_per_dog_uidx[\s\S]+where status = 'in_progress'/i);
    expect(migration).not.toMatch(/delete\s+from\s+public\.walks/i);
  });

  it('serializes starts, validates the expected actor, and writes actual-walker audit data', () => {
    expect(migration).toMatch(/pg_advisory_xact_lock\(hashtextextended\(w\.dog_id::text, 0\)\)/i);
    expect(migration).toMatch(/p_expected_actor_id is distinct from actor/i);
    expect(migration).toMatch(/actual_walker_user_id = p_actual_walker_id/i);
    expect(migration).toMatch(/walk_lifecycle_events/i);
  });

  it('fences GPS ownership and route ingestion to the current device epoch', () => {
    expect(migration).toMatch(/fencing_epoch bigint/i);
    expect(migration).toMatch(/p_confirm_transfer/i);
    expect(migration).toMatch(/owner_auth_user_id\s+is distinct from auth\.uid\(\)[\s\S]*?fencing_epoch\s+is distinct from p_fencing_epoch/i);
    expect(migration).toMatch(/jsonb_array_length\(p_points\)>250/i);
    expect(migration).toMatch(/walk_lifecycle_notifications/i);
    expect(migration).toMatch(/delivery_state='sending'/i);
    expect(migration).toMatch(/finish_walk_lifecycle_notification_delivery_v11/i);
  });
});
