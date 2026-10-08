import fs from 'fs';
import path from 'path';

/**
 * Structural (source-scan, this repo's convention for components) guard
 * for the real-iPhone QA fix: ReminderMascotPrompt must position itself
 * through computeReminderPromptPlacement instead of centring on the whole
 * screen, and must keep using the approved mascot assets unchanged.
 */
describe('ReminderMascotPrompt — placement lane (structural)', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../ReminderMascotPrompt.tsx'), 'utf8').replace(/\r\n/g, '\n');

  it('accepts an avoid rect and derives its lane from computeReminderPromptPlacement', () => {
    expect(source).toContain('avoid?: ScreenRect | null;');
    expect(source).toContain('computeReminderPromptPlacement({');
    // The tab bar's own height token — the lane must end above the real bar.
    expect(source).toContain('tabBarHeight: layout.rowHeight,');
    expect(source).toContain('bottomInset: insets.bottom,');
    expect(source).toContain("import { useSafeAreaInsets } from 'react-native-safe-area-context';");
    expect(source).toContain('style={[styles.lane, { top: placement.top, bottom: placement.bottom }]}');
  });

  it('wraps the existing MascotSafeZone entrance in the lane without replacing it', () => {
    const lane = source.indexOf('testID="reminder-mascot-lane"');
    const zone = source.indexOf('<MascotSafeZone from="right" testID="reminder-mascot-safe-zone">');
    expect(lane).toBeGreaterThan(-1);
    expect(zone).toBeGreaterThan(lane);
  });

  it('the lane never intercepts taps, so the backdrop dismiss still works', () => {
    expect(source).toContain('<View pointerEvents="box-none" style={[styles.lane');
  });

  it('switches to the side-by-side compact layout when the lane is short', () => {
    expect(source).toContain('style={[styles.moment, placement.compact && styles.momentCompact]}');
    expect(source).toContain("momentCompact: { flexDirection: 'row', gap: spacing.sm },");
    expect(source).toContain('{placement.compact ? null : <View style={styles.tail} />}');
  });

  it('still renders only the approved mascot assets', () => {
    expect(source).toContain("require('../../assets/branding/walkie-doggy-mascot-transparent.png')");
    const requires = source.match(/require\('([^']+)'\)/g) ?? [];
    expect(requires.length).toBe(10);
    for (const r of requires) expect(r).toContain('../../assets/branding/walkie-');
  });
});
