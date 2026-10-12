import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const screen = fs.readFileSync(path.join(root, 'src/screens/SettingsScreen.tsx'), 'utf8');

describe('Settings sync diagnostics refresh feedback', () => {
  it('shows a visible loading state and accessible success/error result for refresh', () => {
    expect(screen).toContain("setSyncDiagnosticsFeedback({ kind: 'loading', message: 'מרענן אבחון…' })");
    expect(screen).toContain('האבחון עודכן בהצלחה');
    expect(screen).toContain('רענון האבחון נכשל');
    expect(screen).toContain('accessibilityLiveRegion="polite"');
    expect(screen).toContain("syncDiagnosticsLoading ? 'מרענן אבחון…' : 'רענון אבחון'");
    expect(screen).toContain('onPress={() => void loadSyncDiagnostics()}');
  });

  it('reports allowlisted quarantine reason and operation aggregates without raw metadata', () => {
    expect(screen).toContain('summarizeSyncQuarantine(quarantined)');
    expect(screen).toContain('סיבת הסגר:');
    expect(screen).toContain('סוגי פעולות בהסגר:');
    expect(screen).toContain('אין שיוך לבעלים או למשפחה');
  });
});
