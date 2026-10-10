import fs from 'fs';

/**
 * PRD §11: "ב-Home יש בחירת כלב קלה כאשר יש יותר מכלב אחד" — extracted from
 * SettingsScreen.tsx's own dog-selector chip row so a second screen (Home)
 * doesn't reimplement the identical widget from scratch. Source-scan
 * convention: this repo has no render-test harness for components.
 */
describe('DogSelectorRow (structural)', () => {
  const source = fs.readFileSync(require.resolve('../DogSelectorRow'), 'utf8').replace(/\r\n/g, '\n');

  it('renders one accessible, selection-stated chip per dog with a photo and name', () => {
    expect(source).toMatch(/dogs\.map\(\(d\) => \{/);
    expect(source).toMatch(/const isActive = d\.id === selectedDogId;/);
    expect(source).toMatch(/accessibilityState=\{\{ selected: isActive \}\}/);
    expect(source).toMatch(/<DogPhoto photoUrl=\{d\.photoUrl\} size=\{40\} \/>/);
  });

  it('tapping a chip calls onSelect with that dog\'s id', () => {
    expect(source).toMatch(/onPress=\{\(\) => onSelect\(d\.id\)\}/);
  });

  it('gives an active chip a distinguishable label from an inactive one, for screen readers', () => {
    expect(source).toMatch(/isActive \? `\$\{d\.name\}, הכלב הפעיל כעת` : `בחירת \$\{d\.name\} ככלב הפעיל`/);
  });
});
