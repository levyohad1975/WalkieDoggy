/**
 * Structural guard (no RN rendering harness in this repo).
 *
 * Settings redesign 2026-11-02 (owner feedback on the iPhone app):
 * topic cards with dividers, a description on every row, icons before the
 * label (the 🏆 sat on the left of "הישגים"), real switches for the GPS
 * consent rows, and less empty space above the title.
 */
describe('Settings redesign', () => {
  const fs = require('fs');
  const settings: string = fs.readFileSync(require.resolve('../SettingsScreen'), 'utf8');
  const gps: string = fs.readFileSync(require.resolve('../../components/RemoteGpsPanel'), 'utf8');

  it('groups rows by topic in one card each', () => {
    // The dog's card has no title of its own: the dog card above names it.
    expect(settings).not.toContain("{dog?.name ?? 'הכלב'}</RtlText>");
    const dogIdx = settings.indexOf('<RtlText style={styles.hubLabel}>🩺 בריאות וטיפוח</RtlText>');
    const familyIdx = settings.indexOf('<RtlText style={styles.sectionTitle}>👨‍👩‍👧 משפחה</RtlText>');
    const notifIdx = settings.indexOf('<RtlText style={styles.sectionTitle}>🔔 התראות</RtlText>');
    expect(dogIdx).toBeGreaterThan(-1);
    expect(familyIdx).toBeGreaterThan(dogIdx);
    expect(notifIdx).toBeGreaterThan(familyIdx);
    expect(settings).toMatch(/groupCard: \{[^}]*borderRadius: radii\.md, overflow: 'hidden'/);
    expect(settings).toContain('<View style={styles.groupDivider} />');
  });

  it('puts every icon before its label, and gives every topic row a description', () => {
    expect(settings).not.toContain('הישגים 🏆');
    for (const label of ['🩺 בריאות וטיפוח', '🏆 הישגים', '🔗 שיתוף המשפחה', '⏰ תזכורות והתראות', '📍 מיקום, GPS ונגישות', '▶ סרטון הדרכה']) {
      const at = settings.indexOf(label);
      expect(at).toBeGreaterThan(-1);
      expect(settings.slice(at, at + 400)).toContain('styles.hubRowMeta');
    }
  });

  it('uses real switches with an explanation for the GPS consent rows', () => {
    expect(gps).toContain('<Switch value={settings.familyEnabled}');
    expect(gps).toContain('<Switch value={settings?.consentEnabled??false}');
    expect(gps).toContain('מאפשר למנהל המשפחה לבקש הפעלת GPS בטלפון של מי שמטייל');
    expect(gps).toContain('מאשר שמנהל המשפחה יבקש להפעיל GPS בטלפון שלי בזמן טיול');
    expect(gps).not.toContain("settings.familyEnabled?'פעיל':'כבוי'");
    expect(gps.match(/thumbColor="#FFFFFF"/g)?.length).toBe(2);
  });

  it('keeps less space above the title', () => {
    expect(settings).toContain('content: { padding: spacing.xl, paddingTop: spacing.sm,');
  });
});

describe('Settings redesign — bottom sections', () => {
  const settings: string = require('fs').readFileSync(require.resolve('../SettingsScreen'), 'utf8');

  it('privacy info and the tutorial share one help & privacy card', () => {
    const title = settings.indexOf('<RtlText style={styles.sectionTitle}>❓ עזרה ופרטיות</RtlText>');
    const privacy = settings.indexOf('onPress={() => setPrivacyAccessibilityModalVisible(true)}');
    const tutorial = settings.indexOf('testID="settings-tutorial-entry"');
    expect(title).toBeGreaterThan(-1);
    expect(privacy).toBeGreaterThan(title);
    expect(tutorial).toBeGreaterThan(privacy);
    expect(settings).not.toContain('🔒 פרטיות ונגישות');
  });

  it('admin rows say what they open, without repeating their section title', () => {
    expect(settings).toContain('<RtlText style={styles.hubLabel}>🖥️ מסוף הניהול</RtlText>');
    expect(settings).toContain('כל המשפחות, יומנים וכלי בדיקה');
    expect(settings).toContain('<RtlText style={styles.hubLabel}>⚙️ ניהול המשפחה</RtlText>');
  });
});
