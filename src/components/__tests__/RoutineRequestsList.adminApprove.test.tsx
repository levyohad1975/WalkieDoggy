/**
 * Owner request 2026-11-12: the other member is sometimes not available to
 * answer a routine request; the family admin can approve it without them
 * (server side: 20261112100000_admin_approve_routine_request_without_target).
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { RoutineRequestsList } from '../RoutineRequestsList';
import type { RoutineChangeRequest } from '../../logic/routineRequests';

const request: RoutineChangeRequest = {
  id: 'req-1',
  familyId: 'fam',
  dogId: 'dog',
  requesterUserId: 'omer',
  targetUserId: 'maor',
  kind: 'take',
  myDay: null,
  myTime: null,
  theirDay: 4,
  theirTime: '13:30',
  newTime: null,
  note: null,
  status: 'pending_target',
  createdAt: '2026-11-12T10:56:05Z',
  decidedAt: null,
};
const usersById = {
  omer: { id: 'omer', name: 'עומר' },
  maor: { id: 'maor', name: 'מאור' },
  dad: { id: 'dad', name: 'אבא' },
} as any;

const renderList = (currentUserId: string, isAdmin: boolean) => {
  const onDecide = jest.fn();
  const view = render(
    <RoutineRequestsList
      requests={[request]}
      usersById={usersById}
      currentUserId={currentUserId}
      isAdmin={isAdmin}
      busyId={null}
      onRespond={jest.fn()}
      onDecide={onDecide}
      onCancel={jest.fn()}
    />,
  );
  return { view, onDecide };
};

describe('RoutineRequestsList — admin approves without waiting for the other member', () => {
  it('lets the admin approve a request the other member has not answered yet', () => {
    const { view, onDecide } = renderList('dad', true);
    fireEvent.press(view.getByText('אישור בלי לחכות למאור'));
    expect(onDecide).toHaveBeenCalledWith(request, true);
    fireEvent.press(view.getByText('דחייה'));
    expect(onDecide).toHaveBeenCalledWith(request, false);
  });

  it('a member who is not the admin cannot', () => {
    const { view } = renderList('omer', false);
    expect(view.queryByText('אישור בלי לחכות למאור')).toBeNull();
    expect(view.getByText('ביטול הבקשה')).toBeTruthy();
  });

  it('the database accepts approval while the request still waits for the member', () => {
    const sql = fs.readFileSync(
      path.join(__dirname, '../../../supabase/migrations/20261112100000_admin_approve_routine_request_without_target.sql'),
      'utf8',
    );
    expect(sql).toContain("if r.status not in ('pending_target', 'pending_admin') then");
    expect(sql).not.toContain('request is not waiting for the admin');
    // Caller checks are unchanged.
    expect(sql).toContain('not public.is_real_family_admin(r.family_id)');
    expect(sql).toContain('public.active_impersonation_target() is not null');
  });
});
