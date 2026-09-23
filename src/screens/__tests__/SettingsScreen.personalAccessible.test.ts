import fs from 'fs';
import path from 'path';

/**
 * BATCH 3 (Task 2 — personal vs. family/admin settings; Task 11's test
 * list: "Settings remains accessible to ordinary member" / "personal
 * notification settings remain accessible regardless of family permission
 * overrides"). Same source-text-scan convention as
 * SettingsScreen.switchUserFlow.test.ts (no React Native
 * component-rendering test infrastructure in this repo).
 */
describe('SettingsScreen — personal settings stay accessible to every member', () => {
  const settingsSource = fs.readFileSync(path.resolve(__dirname, '../SettingsScreen.tsx'), 'utf8');
  const remindersSource = fs.readFileSync(
    path.resolve(__dirname, '../../components/RemindersModal.tsx'),
    'utf8'
  );

  it('the ordinary settings sections (family / walks & reminders / switch user) are NOT wrapped in an admin-only role check', () => {
    // Statistics/Settings redesign batch: the single undifferentiated
    // "ordinary settings rows" block was split into several clearly
    // labeled <View style={styles.section}> areas (👪 משפחה, 🐾 טיולים
    // ותזכורות, 📱 החשבון שלי, plus the dog-gated 🏥 בריאות וטיפוח) — same
    // rows/handlers, purely reorganized. All of them must still open
    // BEFORE the admin-only conditional starts, i.e. none is nested
    // inside `familyRole === 'admin' ? (...)`.
    const sectionIdx = settingsSource.indexOf(
      '{/* Ordinary settings rows — organized into clearly labeled areas'
    );
    expect(sectionIdx).toBeGreaterThan(-1);
    const adminSectionIdx = settingsSource.indexOf("familyRole === 'admin' ? (");
    expect(adminSectionIdx).toBeGreaterThan(sectionIdx);
    const ordinarySectionOpenIdx = settingsSource.indexOf('<View style={styles.section}>', sectionIdx);
    expect(ordinarySectionOpenIdx).toBeGreaterThan(-1);
    expect(ordinarySectionOpenIdx).toBeLessThan(adminSectionIdx);
    // Every labeled area between the ordinary-section comment and the
    // admin conditional must itself sit before that conditional too.
    for (const title of ['👪 משפחה', '🐾 טיולים ותזכורות', '📱 החשבון שלי']) {
      const titleIdx = settingsSource.indexOf(title, sectionIdx);
      expect(titleIdx).toBeGreaterThan(-1);
      expect(titleIdx).toBeLessThan(adminSectionIdx);
    }
  });

  it('only the "🛠️ מתקדם" / admin management section is gated on familyRole === \'admin\' — 👥/📤/🔁 rows have no such gate', () => {
    // The reminders/sharing/switch-user Pressable rows must not themselves
    // be preceded by a role check between them and the ordinary section
    // opening (proving they render unconditionally within that section).
    const remindersRowIdx = settingsSource.indexOf("onPress={() => setRemindersModalVisible(true)}");
    const sharingRowIdx = settingsSource.indexOf('onPress={() => setSharingModalVisible(true)}');
    const switchUserRowIdx = settingsSource.indexOf('onPress={handleSwitchUser}');
    const adminSectionIdx = settingsSource.indexOf("familyRole === 'admin' ? (");
    expect(remindersRowIdx).toBeGreaterThan(-1);
    expect(sharingRowIdx).toBeGreaterThan(-1);
    expect(switchUserRowIdx).toBeGreaterThan(-1);
    expect(remindersRowIdx).toBeLessThan(adminSectionIdx);
    expect(sharingRowIdx).toBeLessThan(adminSectionIdx);
    expect(switchUserRowIdx).toBeLessThan(adminSectionIdx);
  });

  it("RemindersModal: a member can always toggle their OWN device's reminder switch, regardless of family role/permissions", () => {
    // disabled={effectiveFamilyRole !== 'admin' && u.id !== effectiveUserId}
    // — disabled only when BOTH not-admin AND not-self, i.e. never disabled
    // for your own row.
    expect(remindersSource).toMatch(
      /disabled=\{effectiveFamilyRole !== 'admin' && u\.id !== effectiveUserId\}/
    );
  });
});
