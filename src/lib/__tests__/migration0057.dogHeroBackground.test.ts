import fs from 'fs';
import path from 'path';

describe('migration 0057 — family-shared dog hero background', () => {
  it('adds only the presentation column to dogs and leaves authorization to existing policies', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../../../supabase/migrations/0057_dog_hero_background.sql'), 'utf8');
    expect(sql).toContain('alter table public.dogs');
    expect(sql).toContain('add column if not exists hero_background_id text');
    expect(sql).not.toMatch(/create policy|security definer|grant /i);
  });
});
