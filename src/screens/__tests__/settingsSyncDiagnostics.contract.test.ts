import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const screen = fs.readFileSync(path.join(root, 'src/screens/SettingsScreen.tsx'), 'utf8');
const actionButton = fs.readFileSync(path.join(root, 'src/components/SyncDiagnosticsActionButton.tsx'), 'utf8');

describe('Settings sync diagnostics refresh feedback', () => {
  it('shows a visible loading state and accessible success/error result for refresh', () => {
    expect(screen).toContain("setSyncDiagnosticsFeedback({ kind: 'loading', message: 'מרענן אבחון…' })");
    expect(screen).toContain('האבחון עודכן בהצלחה');
    expect(screen).toContain('רענון האבחון נכשל');
    expect(actionButton).toContain('accessibilityLiveRegion="polite"');
    expect(actionButton).toContain('busy && loadingLabel ? loadingLabel : label');
    expect(screen).toContain('onPressIn={() => setSyncDiagnosticsFeedback({ kind: \'loading\', message: \'הלחיצה נקלטה; מרענן אבחון…\' })}');
    expect(screen).not.toContain('syncDiagnosticsFeedback ? <RtlText');
    expect(actionButton).toContain('{feedback ? (');
    expect(screen).toContain('<SyncDiagnosticsActionButton label="רענון אבחון"');
    expect(screen).toContain('feedback={syncDiagnosticsFeedback}');
    expect(screen).toContain('onPress={() => void loadSyncDiagnostics()}');
    expect(screen.indexOf('onPress={() => void retrySyncNow()}')).toBeLessThan(screen.indexOf('<SyncDiagnosticsActionButton label="רענון אבחון"'));
    expect(screen).toContain('SYNC-REFRESH-FEEDBACK-20261012-B');
    expect(screen).toContain("const syncDiagnosticsBuildId = 'SYNC-REFRESH-FEEDBACK-20261012-B'");
    expect(screen).toContain('מצב כפתור הרענון:');
    expect(screen).toContain('בדיקת מגע עצמאית:');
    expect(screen).toContain('testID="sync-diagnostics-touch-probe"');
    expect(screen).toContain("onPressIn={() => setTouchProbeFeedback('נקלט onPressIn')}");
    expect(screen).toContain('style={styles.syncDiagnosticsCard}');
    expect(screen).toContain('feedback={syncDiagnosticsFeedback}');
  });

  it('reports allowlisted quarantine reason and operation aggregates without raw metadata', () => {
    expect(screen).toContain('summarizeSyncQuarantine(quarantined)');
    expect(screen).toContain('summarizeSyncConflicts(conflicts)');
    expect(screen).toContain('קודי כשל קבוע:');
    expect(screen).toContain('סיבת הסגר:');
    expect(screen).toContain('סוגי פעולות בהסגר:');
    expect(screen).toContain('אין שיוך לבעלים או למשפחה');
  });
});
