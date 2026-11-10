import fs from 'fs';
import path from 'path';

/**
 * Security review 2026-11-05, finding S1: the family-photos bucket's SELECT
 * policy allowed the `public` role to list every object (every family id +
 * photo filename). This migration scopes listing to authenticated members of
 * the owning family, without affecting public getPublicUrl() reads.
 */
const migration = fs.readFileSync(
  path.resolve(__dirname, '../../../supabase/migrations/20261105120000_restrict_family_photo_listing.sql'),
  'utf8',
);

describe('restrict family-photo listing migration', () => {
  it('replaces the permissive SELECT policy', () => {
    expect(migration).toMatch(/drop policy if exists "read family photos" on storage\.objects/i);
    expect(migration).toMatch(/create policy "read family photos"[\s\S]*for select[\s\S]*to authenticated/i);
  });

  it('scopes reads to the owning family and excludes observer sessions', () => {
    expect(migration).toMatch(/\(storage\.foldername\(name\)\)\[1\] = \(public\.current_family_id\(\)\)::text/);
    expect(migration).toMatch(/public\.active_system_admin_observer_family\(\) is null/);
    expect(migration).toMatch(/auth\.uid\(\) is not null/);
  });

  it('grants the policy to authenticated only, and does not redefine the system-admin policies', () => {
    expect(migration).not.toMatch(/\bto public\b/i);
    expect(migration).not.toMatch(/is_verified_system_admin/);
    expect(migration).not.toMatch(/create policy "System Admin/i);
  });
});
