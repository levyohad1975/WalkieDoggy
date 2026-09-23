import fs from 'fs';

/**
 * PRD §20 — SettingsScreen is where the "⚠️ בעיות סנכרון" entry point
 * lives. Source-scan convention: this repo has no render-test harness for
 * screens.
 */
describe('SettingsScreen wires sync-issue visibility (structural)', () => {
  const source = fs.readFileSync(require.resolve('../SettingsScreen'), 'utf8').replace(/\r\n/g, '\n');

  it('imports SyncIssuesModal and the repository-layer sync-conflict types', () => {
    expect(source).toMatch(/import \{ SyncIssuesModal \} from '\.\.\/components\/SyncIssuesModal';/);
    expect(source).toMatch(/import type \{ QuarantinedItem, SyncConflict \} from '\.\.\/data\/syncQueue';/);
  });

  it('re-checks sync conflicts/quarantine on every focus, not just once on mount', () => {
    const idx = source.indexOf('repository.getSyncConflicts?.()');
    expect(idx).toBeGreaterThan(-1);
    const before = source.slice(Math.max(0, idx - 300), idx);
    expect(before).toMatch(/useFocusEffect\(/);
  });

  it('the row only renders when there is genuinely something to show (never a blocking empty-by-default row)', () => {
    expect(source).toMatch(/const syncIssueCount = syncConflicts\.length \+ quarantinedSyncItems\.length;/);
    const rowIdx = source.indexOf('setSyncIssuesModalVisible(true)');
    expect(rowIdx).toBeGreaterThan(-1);
    const guardIdx = source.lastIndexOf('syncIssueCount > 0 ? (', rowIdx);
    expect(guardIdx).toBeGreaterThan(-1);
  });

  it('passes a real clear-conflicts handler into SyncIssuesModal, calling the repository, not a stub', () => {
    const modalIdx = source.indexOf('<SyncIssuesModal');
    expect(modalIdx).toBeGreaterThan(-1);
    const block = source.slice(modalIdx, modalIdx + 400);
    expect(block).toMatch(/onClearConflicts=\{\(\) => void handleClearSyncConflicts\(\)\}/);
    const fnIdx = source.indexOf('const handleClearSyncConflicts = async ()');
    expect(fnIdx).toBeGreaterThan(-1);
    expect(source.slice(fnIdx, fnIdx + 200)).toMatch(/repository\.clearSyncConflicts\?\.\(\)/);
  });
});
