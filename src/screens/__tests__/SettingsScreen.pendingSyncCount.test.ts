import fs from 'fs';

/** Pending sync remains a repository concern and is deliberately not Settings UI. */
describe('SettingsScreen hides pending-sync count (structural)', () => {
  const source = fs.readFileSync(require.resolve('../SettingsScreen'), 'utf8').replace(/\r\n/g, '\n');

  it('does not render or load an internal pending-sync count', () => {
    expect(source).not.toContain('pendingSyncCount');
    expect(source).not.toContain('שינויים ממתינים לסנכרון עם השרת');
  });
});
