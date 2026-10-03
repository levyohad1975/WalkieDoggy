import fs from 'fs';
import path from 'path';

/**
 * Item 9 (final consolidated pass, real-iPhone QA): the day/range selector
 * on לוח הזמנים rendered its first tab on the wrong (left) side. Root
 * cause: `tabs` used a plain `flexDirection: 'row'`, which lays out the
 * range-key array physically left-to-right on this web build regardless of
 * the app's RTL direction — the array's first entry should read first,
 * i.e. sit RIGHTMOST in RTL. Fixed with `row-reverse` — a real layout
 * reversal, not a cosmetic transform, so onPress stays bound to whichever
 * element now sits in each visual slot. (The range keys themselves were
 * later reworked, in parallel work on this same branch, from
 * today/tomorrow/week to week/routine — this test tracks the structural
 * fix, not the specific key names.)
 */
describe('ScheduleScreen day-range tabs — RTL order (item 9)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'ScheduleScreen.tsx'), 'utf8');

  it('uses row-reverse (a real layout reversal) for the tabs row, not a cosmetic mirror/transform', () => {
    expect(source).toMatch(/tabs:\s*\{\s*flexDirection:\s*'row-reverse'/);
    expect(source).not.toMatch(/tabs:\s*\{\s*flexDirection:\s*'row',/);
  });

  it('never fakes RTL with a scaleX mirror on the tabs row (visual-only flip would desync touch mapping from the visual order)', () => {
    const tabsBlock = source.slice(source.indexOf('tabs: {'), source.indexOf('tabs: {') + 200);
    expect(tabsBlock).not.toMatch(/scaleX/);
  });

  it('renders the range tabs from a RangeKey[] array via row-reverse, so the array order IS the RTL reading order', () => {
    expect(source).toMatch(/as RangeKey\[\]\)\.map/);
  });
});
