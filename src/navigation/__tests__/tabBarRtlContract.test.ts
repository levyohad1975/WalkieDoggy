import fs from 'fs';
import path from 'path';

describe('bottom tab RTL contract', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../RootNavigator.tsx'), 'utf8');

  it('keeps React Navigation direction aligned with the app RTL direction', () => {
    expect(source).toContain('<NavigationContainer direction="rtl">');
  });

  it('declares routes in semantic RTL order so Home is rightmost and Settings leftmost', () => {
    const names = [...source.matchAll(/<Tab\.Screen name="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual(['Home', 'Schedule', 'Family', 'History', 'Statistics', 'Settings']);
  });


  it('uses a fixed physical LTR tab row with Settings left and Home right', () => {
    expect(source).toContain("const PHYSICAL_TAB_ORDER: (keyof RootTabParamList)[] = [");
    expect(source).toMatch(/'Settings',[\s\S]*'Statistics',[\s\S]*'History',[\s\S]*'Family',[\s\S]*'Schedule',[\s\S]*'Home'/);
    expect(source).toMatch(/flexDirection:\s*'row',[\s\S]*nativeDirection\('ltr'\)/);
    expect(source).toContain('tabBar={(props) => <FixedPhysicalTabBar {...props} canSeeHistoryTab={canSeeHistoryTab} canSeeStatisticsTab={canSeeStatisticsTab} />}');
  });

  it('starts on Home', () => {
    expect(source).toContain('initialRouteName="Home"');
  });
});


