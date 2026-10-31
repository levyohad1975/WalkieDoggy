import { isActiveWalk } from '../walkLifecycle';
import type { Walk } from '../../types';

describe('isActiveWalk', () => {
  const active = { status: 'in_progress' as const };

  it('keeps a canonical active walk active', () => {
    expect(isActiveWalk(active)).toBe(true);
  });

  it('excludes only active rows carrying an audit resolution marker', () => {
    expect(isActiveWalk({ ...active, duplicateResolutionGroupId: 'resolution-1' })).toBe(false);
    expect(isActiveWalk({ status: 'done' as Walk['status'] })).toBe(false);
    expect(isActiveWalk({ status: 'pending' as Walk['status'] })).toBe(false);
  });
});
