import fs from 'fs';
import path from 'path';

describe('personal notifications are available to family members from Home', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'HomeScreen.tsx'), 'utf8');

  it('exposes a clearly named Home entry without navigating through Settings', () => {
    expect(source).toContain('🔔 ההתראות שלי');
    expect(source).toContain('onPress={() => setPersonalNotificationsVisible(true)}');
    expect(source).not.toContain("navigation.navigate('Settings')\n              }}\n              accessibilityRole=\"button\"\n              accessibilityLabel=\"🔔 ההתראות שלי\"");
  });

  it('mounts a personal-only notification surface and allows writes only for the authenticated profile', () => {
    expect(source).toContain('personalOnly');
    expect(source).toContain('effectiveUserId={currentUserId}');
    expect(source).toContain('userId === currentUserId');
    expect(source).toContain('void setReminderEnabled(userId, enabled)');
  });

  it('does not expose personal settings in impersonation, observer, or test-mode sessions', () => {
    expect(source).toContain('s.systemObserverActive || s.impersonatingUserId || s.impersonationStarting || s.testModeUserId');
    expect(source).toContain('!personalNotificationsReadOnly && effectiveUserId === currentUserId');
  });
});
