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

  it('finishes walks that were active before v1.1 without trusting a NULL walker', () => {
    const finish = migration.slice(migration.indexOf('create or replace function public.finish_walk_v11'), migration.indexOf('create or replace function public.acquire_walk_gps_ownership_v11'));
    expect(finish).toMatch(/walker:=coalesce\(w\.actual_walker_user_id,w\.responsible_user_id\)/i);
    expect(finish).toMatch(/walker is null or p_actual_walker_id is distinct from walker/i);
    expect(finish).toMatch(/if actor <> walker and not/i);
    expect(finish).not.toMatch(/actor <> p_actual_walker_id/i);
    expect(finish).not.toMatch(/update public\.walks set[^;]*actual_walker_user_id/i);
  });

  it('fences GPS ownership and route ingestion to the current device epoch', () => {
    expect(migration).toMatch(/fencing_epoch bigint/i);
    expect(migration).toMatch(/p_confirm_transfer/i);
    expect(migration).toMatch(/current GPS owner must release tracking or its lease must expire before transfer/i);
    expect(migration).toMatch(/release_walk_gps_ownership_v11/i);
    expect(migration).toMatch(/owner_auth_user_id\s+is distinct from auth\.uid\(\)[\s\S]*?fencing_epoch\s+is distinct from p_fencing_epoch/i);
    expect(migration).toMatch(/jsonb_array_length\(p_points\)>250/i);
    expect(migration).toMatch(/walk_lifecycle_notifications/i);
    expect(migration).toMatch(/delivery_state='sending'/i);
    expect(migration).toMatch(/finish_walk_lifecycle_notification_delivery_v11/i);
    expect(migration).toMatch(/acknowledge_walk_lifecycle_notifications_v11/i);
    expect(migration).toMatch(/duplicate active walks require owner-reviewed resolution/i);
    expect(migration).toMatch(/create unique index if not exists walks_one_active_per_dog_uidx/i);
  });
  it('blocks direct client writes to actual_walker_user_id on every legacy write path', () => {
    expect(migration).toMatch(/create or replace function public\.prevent_untrusted_actual_walker_change/i);
    expect(migration).toMatch(/current_user in \('authenticated', 'anon'\)/i);
    expect(migration).toMatch(/new\.actual_walker_user_id is distinct from old\.actual_walker_user_id/i);
    expect(migration).toMatch(/create trigger walks_actual_walker_guard\s+before insert or update of actual_walker_user_id on public\.walks/i);
    expect(migration).toMatch(/revoke all on function public\.prevent_untrusted_actual_walker_change\(\) from public, anon, authenticated/i);
  });

  it('treats the responsible user as the walker for walks that were active before v1.1', () => {
    const lease = migration.slice(migration.search(/function public\.acquire_walk_gps_ownership_v11/i));
    expect(lease).toMatch(/coalesce\(w\.actual_walker_user_id,\s*w\.responsible_user_id\)/i);
    expect(migration).not.toMatch(/w\.actual_walker_user_id\s+is distinct from auth\.uid\(\)/i);
  });

  it('records an ownership-change audit event only when the owning device actually changes', () => {
    expect(migration).toMatch(/had_owner/i);
    expect(migration).toMatch(/owner_changed/i);
    expect(migration).toMatch(/if owner_changed then[\s\S]*?gps_owner_changed/i);
  });

  it('bounds a reported completion time and never stores one in the future', () => {
    expect(migration).toMatch(/p_completed_at > now\(\) \+ interval '15 minutes'/i);
    expect(migration).toMatch(/completion time cannot be in the future/i);
    expect(migration).toMatch(/p_completed_at < w\.started_at - interval '7 days'/i);
    expect(migration).toMatch(/completion time is too far before the walk started/i);
    expect(migration).toMatch(/least\(coalesce\(p_completed_at,\s*now\(\)\),\s*now\(\)\)/i);
  });

  it('never lets a delivery result erase a recorded provider acceptance', () => {
    expect(migration).toMatch(/provider_accepted_at\s*=\s*case when p_provider_accepted then coalesce\(n\.provider_accepted_at,\s*now\(\)\) else n\.provider_accepted_at end/i);
  });
});
