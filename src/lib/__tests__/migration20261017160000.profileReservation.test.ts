import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(process.cwd(), 'supabase/migrations/20261017160000_reserve_profiles_during_system_admin_qa.sql');
const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();

describe('migration 20261017160000 — server-side QA profile reservations', () => {
  it('is additive and idempotent, with private reservation storage', () => {
    expect(sql).toContain('create table if not exists public.family_profile_reservations');
    expect(sql).toContain('alter table public.family_profile_reservations enable row level security');
    expect(sql).toContain('revoke all on public.family_profile_reservations from public, anon, authenticated');
    expect(sql).not.toContain('on delete cascade');
    expect(sql).not.toMatch(/drop\s+table|truncate\s+table|delete\s+from\s+public\.users/i);
  });

  it('atomically creates and releases a reservation from the server-owned membership snapshot', () => {
    expect(sql).toContain('before insert on public.family_membership_snapshots');
    expect(sql).toContain('insert into public.family_profile_reservations(profile_id, auth_user_id, family_id, role)');
    expect(sql).toContain('before delete on public.family_membership_snapshots');
    expect(sql).toContain('original profile restoration is incomplete; reservation retained');
    expect(sql).toContain('only the snapshot owner may release its profile reservation');
    expect(sql).toContain('delete from public.family_profile_reservations r');
  });

  it('blocks claim reassignment through users and profile_auth_sessions, regardless of claim RPC path', () => {
    expect(sql).toContain('before update of id, auth_user_id, family_id or delete on public.users');
    expect(sql).toContain('before insert or update or delete on public.profile_auth_sessions');
    expect(sql).toContain('auth.uid() is distinct from v_owner');
    expect(sql).toContain("new.auth_user_id is distinct from v_owner");
    expect(sql).toContain('active system admin family snapshot is immutable');
    expect(sql).toContain('profile is reserved during system admin qa');
    expect(sql).toContain('reserved profile family cannot be reassigned');
    expect(sql).toContain('reserved profile identity cannot be reassigned');
    expect(sql).toContain('reserved profile session cannot be reassigned');
    expect(sql.match(/for update/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql.match(/security definer/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql.match(/set search_path = public, auth/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('fails migration rather than silently reserving an inconsistent or stolen profile', () => {
    expect(sql).toContain('family profile reservation backfill found inconsistent active snapshots');
    expect(sql).toContain('family profile reservation backfill found a profile already claimed by another auth identity');
  });
});
