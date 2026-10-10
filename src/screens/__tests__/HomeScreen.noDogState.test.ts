import fs from 'fs';
import path from 'path';

/**
 * PRD §25's "no dog" state. A dog is genuinely optional at family creation
 * (FamilyOnboardingScreen), so an admin can land on Home with a fully
 * loaded, dogless family — previously this silently fell through to the
 * generic "אין טיולים ממתינים" (no pending walks) empty state, which
 * misleads a dogless family into thinking walks exist somewhere rather
 * than that there is nothing to walk at all yet. Source-scan convention:
 * this repo has no render-test harness for screens.
 */
describe('HomeScreen "no dog" state (structural)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'HomeScreen.tsx'), 'utf8');

  it('renders a dedicated EmptyState + CTA into Settings when there is no dog, gated on family load finishing', () => {
    const idx = source.indexOf('if (!dog && !familyLoading) {');
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, source.indexOf('return (\n    <SafeAreaView style={styles.container}', idx));
    expect(block).toContain('עדיין אין כלב במשפחה');
    expect(block).toContain("<Button label=\"הוספת כלב\" onPress={() => navigation.navigate('Settings')}");
  });

  it('this check comes AFTER the loading and error gates, never before (must not flash before real family data loads, and a real fetch error still takes priority)', () => {
    const loadingIdx = source.indexOf('if (loading && walks.length === 0) {');
    const errorIdx = source.indexOf('if (error) {');
    const noDogIdx = source.indexOf('if (!dog && !familyLoading) {');
    expect(loadingIdx).toBeGreaterThan(-1);
    expect(errorIdx).toBeGreaterThan(loadingIdx);
    expect(noDogIdx).toBeGreaterThan(errorIdx);
  });
});
