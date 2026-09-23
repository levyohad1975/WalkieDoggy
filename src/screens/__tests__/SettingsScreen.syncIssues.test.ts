import fs from 'fs';

/** Settings no longer exposes background synchronization diagnostics to family users. */
describe('SettingsScreen hides sync diagnostics (structural)', () => {
  const source = fs.readFileSync(require.resolve('../SettingsScreen'), 'utf8').replace(/\r\n/g, '\n');

  it('does not render or import the internal sync-conflict UI', () => {
    expect(source).not.toContain('SyncIssuesModal');
    expect(source).not.toContain('getSyncConflicts');
    expect(source).not.toContain('clearSyncConflicts');
  });
});
