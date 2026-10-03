import fs from 'fs';
import path from 'path';

/**
 * Item 9 (final consolidated pass, real-iPhone QA): the היום/מחר/השבוע day
 * selector on לוח הזמנים rendered היום on the wrong (left) side. Root
 * cause: `tabs` used a plain `flexDirection: 'row'`, which lays out the
 * ['today','tomorrow','week'] array physically left-to-right on this web
 * build regardless of the app's RTL direction — the array's first entry
 * (today) should read first, i.e. sit RIGHTMOST in RTL. Fixed with
 * `row-reverse` — a real layout reversal, not a cosmetic transform, so
 * onPress stays bound to whichever element now sits in each visual slot.
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

  it('keeps today ("today") as the array\'s first entry — row-reverse alone puts it rightmost, matching RTL reading order', () => {
    expect(source).toMatch(/\(\['today', 'tomorrow', 'week'\] as RangeKey\[\]\)\.map/);
  });
});
