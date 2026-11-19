/**
 * Owner request 2026-11-16: close a walk left running (an hour, and no
 * activity for 30 minutes), so it never blocks the next start.
 */
import fs from 'fs';
import path from 'path';
import { toWalk } from '../../data/supabaseRepository';

const root = path.join(__dirname, '../../..');
const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261116090000_auto_close_forgotten_walks.sql'), 'utf8');
const cron = fs.readFileSync(path.join(root, 'supabase/functions/send-walk-reminders/index.ts'), 'utf8');

describe('auto_close_forgotten_walks', () => {
  it('closes only after an hour AND 30 idle minutes (GPS points, heartbeats and taps all count as activity)', () => {
    expect(sql).toContain('p_min_age_minutes integer default 60');
    expect(sql).toContain('p_idle_minutes integer default 30');
    expect(sql).toContain('from public.walk_gps_route_samples_v11 s where s.walk_id = w0.id');
    expect(sql).toContain('from public.walk_gps_ownership o where o.walk_id = w0.id');
    expect(sql).toContain('w0.updated_at');
    expect(sql).toContain("w0.status = 'in_progress'");
    expect(sql).toContain('w0.duplicate_resolution_group_id is null');
  });

  it('re-checks under a row lock and finishes as the walker, at the last activity (at least 20 minutes, never in the future)', () => {
    expect(sql).toContain('for update skip locked');
    expect(sql).toContain("if not found or w.status <> 'in_progress' then continue; end if;");
    expect(sql).toContain("least(now(), greatest(c.last_activity, w.started_at + interval '20 minutes'))");
    expect(sql).toContain('completed_by_user_id = v_walker');
    expect(sql).toContain('auto_closed_at = now()');
    expect(sql).toContain("'auto_finished'");
  });

  it('only the cron (service role) can call it', () => {
    expect(sql).toContain('revoke all on function public.auto_close_forgotten_walks(integer, integer) from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.auto_close_forgotten_walks(integer, integer) to service_role;');
  });

  it('the cron closes them and pushes the walker once', () => {
    expect(cron).toContain("serviceClient.rpc('auto_close_forgotten_walks'");
    expect(cron).toContain('const WALK_AUTO_CLOSE_AFTER_MINUTES = 60;');
    expect(cron).toContain('const WALK_AUTO_CLOSE_IDLE_MINUTES = 30;');
    expect(cron).toContain('נסגר אוטומטית');
  });

  it('the app reads the marker', () => {
    expect(toWalk({ id: 'w', family_id: 'f', dog_id: 'd', date: '2026-11-15', scheduled_time: '18:00', responsible_user_id: 'u', status: 'done', auto_closed_at: '2026-11-15T20:42:00Z' }).autoClosedAt)
      .toBe('2026-11-15T20:42:00Z');
  });
});
