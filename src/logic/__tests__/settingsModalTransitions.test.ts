import { decideChildModalToOpen } from '../settingsModalTransitions';

describe('decideChildModalToOpen', () => {
  it('does nothing when no child modal was requested', () => {
    expect(
      decideChildModalToOpen({ managementVisible: true, pendingChildModal: null }, 'ios-native-dismiss')
    ).toBeNull();
    expect(
      decideChildModalToOpen({ managementVisible: false, pendingChildModal: null }, 'visibility-effect')
    ).toBeNull();
  });

  it('iOS: opens the pending child the moment the native dismiss callback fires', () => {
    expect(
      decideChildModalToOpen({ managementVisible: false, pendingChildModal: 'activity' }, 'ios-native-dismiss')
    ).toBe('activity');
    expect(
      decideChildModalToOpen({ managementVisible: false, pendingChildModal: 'auditLog' }, 'ios-native-dismiss')
    ).toBe('auditLog');
  });

  it('non-iOS: does NOT open the child while Management is still reported visible', () => {
    expect(
      decideChildModalToOpen({ managementVisible: true, pendingChildModal: 'activity' }, 'visibility-effect')
    ).toBeNull();
    expect(
      decideChildModalToOpen({ managementVisible: true, pendingChildModal: 'auditLog' }, 'visibility-effect')
    ).toBeNull();
  });

  it('non-iOS: opens the pending child once Management has actually become invisible', () => {
    expect(
      decideChildModalToOpen({ managementVisible: false, pendingChildModal: 'activity' }, 'visibility-effect')
    ).toBe('activity');
    expect(
      decideChildModalToOpen({ managementVisible: false, pendingChildModal: 'auditLog' }, 'visibility-effect')
    ).toBe('auditLog');
    expect(
      decideChildModalToOpen({ managementVisible: false, pendingChildModal: 'auditLog' }, 'visibility-effect')
    ).toBe('auditLog');
  });
});

