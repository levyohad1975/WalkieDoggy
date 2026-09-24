import { shouldRunPendingWebPhotoPick } from '../UserFormModal';

describe('UserFormModal web photo crop handoff', () => {
  it('starts the hosted crop/upload after the web form hides for a pending pick', () => {
    expect(shouldRunPendingWebPhotoPick(true, 'web')).toBe(true);
  });

  it('does not start without a pending pick or on native', () => {
    expect(shouldRunPendingWebPhotoPick(false, 'web')).toBe(false);
    expect(shouldRunPendingWebPhotoPick(true, 'ios')).toBe(false);
    expect(shouldRunPendingWebPhotoPick(true, 'android')).toBe(false);
  });
});
