import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(path.join(process.cwd(),'supabase/migrations/20261010170000_remote_gps_activation.sql'),'utf8');
const heartbeat = fs.readFileSync(path.join(process.cwd(),'supabase/migrations/20261010173000_remote_gps_heartbeat.sql'),'utf8');
const devicePicker = fs.readFileSync(path.join(process.cwd(),'supabase/migrations/20261010174500_remote_gps_device_picker.sql'),'utf8');
const pushBinding = fs.readFileSync(path.join(process.cwd(),'supabase/migrations/20261010180000_remote_gps_push_device_binding.sql'),'utf8');
const notify = fs.readFileSync(path.join(process.cwd(),'supabase/functions/remote-gps-notify/index.ts'),'utf8');
const preliminary = fs.readFileSync(path.join(process.cwd(),'supabase/migrations/0110_remote_gps_commands.sql'),'utf8');

describe('remote GPS activation security contract',()=>{
 it('requires independent family and profile opt-in, with admin-only family control',()=>{
  expect(sql).toMatch(/remote_gps_enabled boolean not null default false/);
  expect(sql).toMatch(/set_family_remote_gps_enabled[\s\S]*?not is_family_admin\(f\)/);
  expect(sql).toMatch(/set_remote_gps_consent\(p_enabled boolean\)/);
  expect(preliminary).toMatch(/target_auth_user_id = auth\.uid\(\)/);
 });
 it('validates admin, family, scheduled target and current consent on the server',()=>{
  expect(sql).toMatch(/not is_family_admin\(w\.family_id\)/);
  expect(sql).toMatch(/w\.family_id is distinct from current_family_id\(\)/);
  expect(devicePicker).toMatch(/s\.user_id=w\.responsible_user_id/);
  expect(sql).toMatch(/join remote_gps_consents[\s\S]*?c\.enabled/);
  expect(sql).toMatch(/join profile_auth_sessions[\s\S]*?s\.auth_user_id/);
 });
 it('makes duplicate starts idempotent and expires stale pending commands',()=>{
  expect(sql).toMatch(/remote_gps_commands_one_open_per_walk[\s\S]*?status in \('pending','tracking'\)/);
  expect(sql).toMatch(/where walk_id=p_walk_id and status='pending' and expires_at<=now\(\)/);
  expect(sql).toMatch(/return cid/);
 });
 it('allows only the target auth identity to receive commands and acknowledge GPS success',()=>{
  expect(sql).toMatch(/c\.target_auth_user_id=auth\.uid\(\)/);
  expect(sql).toMatch(/c\.target_user_id is distinct from real_current_profile_id\(\)/);
  expect(sql).toMatch(/acknowledge_remote_gps_start[\s\S]*?ok_consent is distinct from true or ok_family is distinct from true/);
  expect(sql).toMatch(/case when p_tracking then 'tracking' else 'failed' end/);
 });
 it('audits start, failure, stop, consent and family revocation without message/location content',()=>{
  expect(sql).toMatch(/create table if not exists remote_gps_audit/);
  expect(sql).toMatch(/'requested','tracking','failed','expired','stopped','consent_revoked','family_disabled'/);
  expect(sql).toMatch(/stop_remote_gps_tracking/);
  expect(sql).not.toMatch(/latitude|longitude|route_points|location_data/i);
 });
 it('expires tracking whose target foreground app stops heartbeating and binds heartbeats to the target session',()=>{
  expect(heartbeat).toMatch(/heartbeat_remote_gps_tracking/);
  expect(heartbeat).toMatch(/c\.target_auth_user_id is distinct from auth\.uid\(\)/);
  expect(heartbeat).toMatch(/acknowledged_at<now\(\)-interval '30 seconds'/);
  expect(heartbeat).toMatch(/failure_reason='target_inactive'/);
 });
 it('lets administrators choose an exact authorized device session and prevents cross-device command reuse',()=>{
  expect(devicePicker).toMatch(/returns table\(target_auth_user_id uuid,target_user_id uuid/);
  expect(devicePicker).toMatch(/s\.auth_user_id=p_target_auth_user_id/);
  expect(devicePicker).toMatch(/existing_auth is distinct from p_target_auth_user_id/);
  expect(devicePicker).toMatch(/target device has no active consent/);
 });
 it('binds Expo and Web Push registrations to auth.uid and sends only to the command target device',()=>{
  expect(pushBinding).toMatch(/auth_user_id uuid references auth\.users/);
  expect(pushBinding).toMatch(/auth_user_id=excluded\.auth_user_id/);
  expect(pushBinding).toMatch(/target_auth_user_id uuid,walk_id uuid/);
  expect(notify.match(/\.eq\('auth_user_id',targetAuthUserId\)/g)).toHaveLength(2);
 });
});
