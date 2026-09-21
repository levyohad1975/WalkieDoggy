import fs from 'fs';
import path from 'path';

describe('durable walk lifecycle contract', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'supabase', 'migrations', '0048_walk_lifecycle.sql'), 'utf8');
  const home = fs.readFileSync(path.join(__dirname, '..', 'HomeScreen.tsx'), 'utf8');

  it('persists start/end actors and in-progress state', () => {
    expect(migration).toContain("status in ('pending','in_progress','done','skipped')");
    expect(migration).toContain('started_by_user_id');
    expect(migration).toContain('ended_by_user_id');
    expect(migration).toContain('create or replace function start_walk');
    expect(migration).toContain('create or replace function finish_walk');
  });

  it('allows family admins while restricting ordinary members to their assigned walk', () => {
    expect(migration).toContain('not is_family_admin(w.family_id)');
    expect(migration).toContain('w.responsible_user_id is distinct from actor');
  });

  it('renders lifecycle from persisted walk state, not component-local session state', () => {
    expect(home).toContain("nextWalk.status === 'in_progress'");
    expect(home).toContain('void startWalk(nextWalk.id)');
    expect(home).toContain('await finishWalk(walkId, completedByUserId');
    expect(home).not.toContain('activeWalkSession');
  });
});
