import fs from 'fs';
import path from 'path';

const migration = fs.readFileSync(
  path.resolve(__dirname, '../../../supabase/migrations/20261018141642_persist_walk_event_counts.sql'),
  'utf8',
);

describe('walk event count persistence migration', () => {
  it('adds nullable, nonnegative count columns and preserves legacy 0/1 history', () => {
    expect(migration).toMatch(/add column if not exists pee_count integer/i);
    expect(migration).toMatch(/add column if not exists poop_count integer/i);
    expect(migration).toMatch(/pee_count is null or pee_count >= 0/i);
    expect(migration).toMatch(/poop_count is null or poop_count >= 0/i);
    expect(migration).toMatch(/where status in \('done', 'skipped'\)/i);
    expect(migration).toMatch(/case when had_pee is true then 1 else 0 end/i);
    expect(migration).toMatch(/case when had_poop is true then 1 else 0 end/i);
  });

  it('records exact counts atomically with lifecycle completion and idempotency payload', () => {
    expect(migration).toMatch(/create or replace function public\.finish_walk_v12/i);
    expect(migration).toMatch(/'pee_count',p_pee_count/i);
    expect(migration).toMatch(/'poop_count',p_poop_count/i);
    expect(migration).toMatch(/operation id reused with a different finish request/i);
    expect(migration).toMatch(/pee_count=p_pee_count/i);
    expect(migration).toMatch(/poop_count=p_poop_count/i);
    expect(migration).toMatch(/update public\.walk_gps_ownership set fencing_epoch=fencing_epoch\+1/i);
  });

  it('validates caller, walker, confirmation, and capability before count-aware writes', () => {
    expect(migration).toMatch(/p_expected_actor_id is distinct from actor/i);
    expect(migration).toMatch(/actual walker or confirmed family admin required to finish/i);
    expect(migration).toMatch(/p_pee_count < 0/i);
    expect(migration).toMatch(/p_poop_count < 0/i);
    expect(migration).toMatch(/public\.finish_walk_v12\(uuid,uuid,uuid,uuid,boolean,boolean,text,timestamptz,boolean,integer,integer\)/i);
    expect(migration).toMatch(/column:public\.walks\.pee_count/i);
    expect(migration).toMatch(/column:public\.walks\.poop_count/i);
    expect(migration).not.toMatch(/delete\s+from\s+public\.walks/i);
  });
});
