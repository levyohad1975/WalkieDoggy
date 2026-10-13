import fs from 'fs';

/**
 * PRD §14: "History displays ... with filtering AND SEARCH." History
 * previously had every filter chip (range/member/type) but no free-text
 * search at all. Source-scan convention: this repo has no render-test
 * harness for screens.
 */
describe('HistoryScreen wires free-text search over walk notes (structural)', () => {
  const source = fs.readFileSync(require.resolve('../HistoryScreen'), 'utf8').replace(/\r\n/g, '\n');

  it('imports walkMatchesHistorySearch and renders a TextInput bound to historySearchQuery state', () => {
    expect(source).toMatch(/import \{ isWalkEligibleForHistory, walkMatchesHistorySearch \} from '\.\.\/logic\/history';/);
    expect(source).toMatch(/const \[historySearchQuery, setHistorySearchQuery\] = useState\(''\);/);
    expect(source).toMatch(/<TextInput\s*\n\s*value=\{historySearchQuery\}\s*\n\s*onChangeText=\{setHistorySearchQuery\}/);
  });

  it('the search box is always visible, not hidden behind the "עוד" expandable section', () => {
    const inputIdx = source.indexOf('<TextInput');
    const toggleIdx = source.indexOf('filterToggleRow');
    expect(inputIdx).toBeGreaterThan(-1);
    expect(toggleIdx).toBeGreaterThan(-1);
    expect(inputIdx).toBeLessThan(toggleIdx);
  });

  it('the history list filter chain checks walkMatchesHistorySearch and depends on historySearchQuery', () => {
    const idx = source.indexOf('if (!walkMatchesHistorySearch(w, historySearchQuery)) return false;');
    expect(idx).toBeGreaterThan(-1);
    const depsIdx = source.indexOf('[allHistory, userFilter, planFilter, rangeFilter, rangeStartDate, customDate, todayString, historySearchQuery]');
    expect(depsIdx).toBeGreaterThan(idx);
  });
});
