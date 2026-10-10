import fs from 'fs';
import path from 'path';

/**
 * Item 8 regression: Home must sit at the exact geometric center of the
 * bottom nav bar, independent of how many of the OTHER destinations happen
 * to be visible on either side (History/Statistics/Settings are each
 * permission-gated and can be hidden independently — see
 * canSeeHistoryTab/canSeeStatisticsTab/canSeeSettingsTab in RootNavigator).
 * A per-item `flex: 1` row (the old design) has no exact center slot once
 * an even number of buttons is visible, and shifts Home's apparent position
 * whenever a side tab is hidden/shown. The fix splits the non-Home
 * destinations into two independent flex groups and centers Home with
 * `left: '50%'` — this test locks in that structure via a source read
 * (matches this codebase's existing pattern for bar-layout contracts, see
 * tabBarRtlContract.test.ts).
 */
describe('bottom nav — Home centering (item 8)', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../RootNavigator.tsx'), 'utf8');

  it('renders the non-Home destinations as two independent flex groups flanking a reserved center slot', () => {
    expect(source).toContain('const homeIndex = PHYSICAL_TAB_ORDER.indexOf(\'Home\');');
    expect(source).toContain('const leftButtons = PHYSICAL_TAB_ORDER.slice(0, homeIndex).filter(isVisible).map(renderTabButton);');
    expect(source).toContain('const rightButtons = PHYSICAL_TAB_ORDER.slice(homeIndex + 1).filter(isVisible).map(renderTabButton);');
    // Each side is its own flex:1 row — never a single shared flex row split
    // by item count, which is what let a hidden/shown side tab shift Home.
    expect(source).toMatch(/<View style=\{\{ flex: 1, flexDirection: 'row' \}\}>\{leftButtons\}<\/View>/);
    expect(source).toMatch(/<View style=\{\{ flex: 1, flexDirection: 'row' \}\}>\{rightButtons\}<\/View>/);
  });

  it('positions Home absolutely at left: 50%, decoupled from the two side groups entirely', () => {
    expect(source).toContain("left: '50%'");
    expect(source).toContain('marginLeft: -(HOME_SLOT_WIDTH / 2)');
    expect(source).toContain("position: 'absolute'");
  });

  it('keeps Home\'s raised turquoise circular styling and full tap target', () => {
    expect(source).toContain('HOME_BUTTON_SIZE');
    expect(source).toMatch(/width: HOME_BUTTON_SIZE, height: HOME_BUTTON_SIZE, borderRadius: HOME_BUTTON_SIZE \/ 2, backgroundColor: colors\.primary/);
    expect(source).toContain('transform: [{ translateY: -10 }]');
  });

  it('never reintroduces swipe-based tab navigation', () => {
    expect(source).not.toMatch(/swipeEnabled\s*:\s*true/);
    expect(source).not.toContain('PanGestureHandler');
  });
});
