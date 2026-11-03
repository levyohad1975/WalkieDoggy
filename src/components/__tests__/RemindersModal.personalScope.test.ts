import fs from 'fs';

describe('RemindersModal personal notification scope', () => {
  const source = fs.readFileSync(require.resolve('../RemindersModal'), 'utf8').replace(/\r\n/g, '\n');

  it('shows only the current profile and labels the personal surface clearly', () => {
    expect(source).toContain("personalOnly ? '🔔 ההתראות שלי' : '🔔 תזכורות'");
    expect(source).toContain('!personalOnly || u.id === effectiveUserId');
  });

  it('cannot update another family member from personal notification settings', () => {
    expect(source).toContain('if (!personalOnly || u.id === effectiveUserId) onSetReminderEnabled(u.id, v);');
    expect(source).toContain("disabled={effectiveFamilyRole !== 'admin' && u.id !== effectiveUserId}");
  });

  it('retains the existing browser permission, retry/reconciliation, and server-verification flow', () => {
    expect(source).toContain('reconcileWebPushSubscription()');
    expect(source).toContain('verifyServerSubscription()');
    expect(source).toContain('onPress={handleEnableWebPush}');
    expect(source).toContain('serverVerified ?');
    expect(source).toContain("webPushStatus !== 'subscribed' &&");
    expect(source).toContain("webPushStatus === 'subscribed' && serverVerified === false");
    expect(source).toContain("serverVerified === false ? 'נסה שוב לרשום את המכשיר' : 'אפשר התראות'");
  });
});
