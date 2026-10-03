import fs from 'fs';

/**
 * PRD §13 — Statistics/Reports. The daily-trend sparkline's bars are the
 * ONLY representation of each day's walk count (unlike the member-
 * distribution Bar, which sits beside a visible name/count RtlText and can
 * stay decorative) — a screen reader previously got nothing from this
 * chart at all. Source-scan convention: this repo has no render-test
 * harness for screens.
 */
describe('StatisticsScreen trend chart is accessible per data point (structural)', () => {
  const source = fs.readFileSync(require.resolve('../StatisticsScreen'), 'utf8').replace(/\r\n/g, '\n');

  it('imports formatHistoryDate for readable per-point labels', () => {
    expect(source).toMatch(/import \{ formatHistoryDate, localDateOnly \} from '\.\.\/logic\/dateFormat';/);
  });

  it('each trend bar wrap is its own accessible element with a date + count label', () => {
    const idx = source.indexOf('function TrendChart(');
    expect(idx).toBeGreaterThan(-1);
    const block = source.slice(idx, source.indexOf('\n}', idx));
    expect(block).toMatch(/style=\{styles\.trendBarWrap\}\s*\n\s*accessible\s*\n\s*accessibilityLabel=\{`\$\{formatHistoryDate\(p\.date\)\}: \$\{p\.count\} \$\{p\.count === 1 \? 'טיול' : 'טיולים'\}`\}/);
  });
});
