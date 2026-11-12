/**
 * Owner request 2026-11-12: a member asked to take ONE walk (today's 13:30)
 * and the only option was the permanent routine "take", which moved every
 * Thursday. 'take_once' takes a single walk; the routine stays as it is.
 */
import fs from 'fs';
import path from 'path';
import {
  describeRoutineRequest,
  openRequestCellKeys,
  routineRequestState,
  routineRequestStatusText,
  routineRequestSteps,
  shortDateLabel,
  type RoutineChangeRequest,
} from '../routineRequests';

const takeOnce: RoutineChangeRequest = {
  id: 'r1', familyId: 'f', dogId: 'd', requesterUserId: 'hadar', targetUserId: 'maor', kind: 'take_once',
  myDay: null, myTime: null, theirDay: 4, theirTime: '13:30', newTime: null, note: null,
  status: 'pending_target', createdAt: '2026-11-12T10:00:00Z', decidedAt: null, walkId: 'w1', walkDate: '2026-11-19',
};
const users = { hadar: { name: 'הדר' }, maor: { name: 'מאור' } };

describe('one-off take request', () => {
  it('changes nothing in the routine (the server moves the one walk)', () => {
    expect(routineRequestSteps(takeOnce)).toEqual([]);
    expect(routineRequestState([], takeOnce)).toBe('ok');
    expect(openRequestCellKeys([takeOnce]).size).toBe(0);
  });

  it('says it is one-off, with the date', () => {
    expect(describeRoutineRequest(takeOnce, users)).toBe('הדר מבקש/ת לקחת ממאור רק את הטיול של חמישי 13:30 (19.11) · חד-פעמי');
    expect(routineRequestStatusText({ ...takeOnce, status: 'approved' }, users)).toBe('אושר — הטיול הועבר');
    expect(shortDateLabel('2026-11-05')).toBe('5.11');
    expect(shortDateLabel(null)).toBe('');
  });
});

describe('routine grid wording', () => {
  const grid = fs.readFileSync(path.join(__dirname, '../../components/RoutineGrid.tsx'), 'utf8');
  it('offers "just the next walk" first and labels the permanent options as permanent', () => {
    const once = grid.indexOf('לקחת רק את הטיול הקרוב');
    const permanent = grid.indexOf('(קבוע)');
    expect(once).toBeGreaterThan(-1);
    expect(permanent).toBeGreaterThan(once);
    expect(grid).toContain('שינוי קבוע: בכל יום ${DAY_LONG_LABELS[req.day]}, מעכשיו והלאה');
    expect(grid).not.toContain('"🙋 אני רוצה לקחת את הטיול הזה"');
  });
});

describe('migration 20261112110000_one_off_take_requests', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../../supabase/migrations/20261112110000_one_off_take_requests.sql'), 'utf8');

  it('the request names one exact walk and leaves the routine alone', () => {
    expect(sql).toContain("kind = 'take_once' and target_user_id is not null");
    expect(sql).toContain('walk_id is not null and walk_date is not null');
    expect(sql).not.toMatch(/update public\.schedule_rules/);
  });

  it('only a walk of another active member that is still pending can be asked for', () => {
    expect(sql).toContain("if w.status <> 'pending' or w.duplicate_resolution_group_id is not null then");
    expect(sql).toContain('w.responsible_user_id = v_me');
    expect(sql).toContain('u.removed_at is null');
  });

  it('applying re-checks the walk under a lock and moves only that walk', () => {
    const apply = sql.slice(sql.indexOf('create or replace function public.apply_walk_take_once'));
    expect(apply).toContain('from public.walks where id = r.walk_id for update');
    expect(apply).toContain('w.responsible_user_id is distinct from r.target_user_id');
    expect(apply).toContain('w.scheduled_time is distinct from r.their_time');
    expect(apply).toContain("set_config('app.trusted_write', 'on', true)");
    expect(apply).toContain("set_config('app.trusted_write', 'off', true)");
    expect(sql).toContain('revoke all on function public.apply_walk_take_once(uuid, uuid) from public, anon, authenticated;');
  });

  it('the walk member accepting applies it; the admin can approve without them', () => {
    expect(sql).toMatch(/if v_kind = 'take_once' and p_accept then\s+perform public\.apply_walk_take_once\(p_id, v_me\);/);
    expect(sql).toMatch(/if p_approve and r\.kind = 'take_once' then\s+perform public\.apply_walk_take_once/);
    expect(sql).toContain('not public.is_real_family_admin(r.family_id)');
  });
});
