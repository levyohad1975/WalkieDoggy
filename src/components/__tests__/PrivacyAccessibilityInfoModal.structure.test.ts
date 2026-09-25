import fs from 'fs';

/**
 * PRD §16: "Settings includes ... privacy/GPS, accessibility/Reduced
 * Motion." Both facts (foreground-only, aggregate-only GPS storage;
 * OS-driven Reduced Motion) previously had no informational entry point
 * anywhere in Settings at all. Source-scan convention: this repo has no
 * render-test harness for modals.
 */
describe('PrivacyAccessibilityInfoModal (structural)', () => {
  const source = fs.readFileSync(require.resolve('../PrivacyAccessibilityInfoModal'), 'utf8').replace(/\r\n/g, '\n');

  it('explains GPS is foreground-only and aggregate-only (no raw route/coordinates stored)', () => {
    expect(source).toMatch(/פועל רק בזמן טיול פעיל/);
    expect(source).toMatch(/רק את המרחק המחושב וכמות נקודות המדידה/);
    expect(source).toMatch(/לעולם לא את המסלול או קואורדינטות מדויקות/);
  });

  it('explains family members are not tracked relative to each other', () => {
    expect(source).toMatch(/בני המשפחה אינם עוקבים זה אחר זה/);
  });

  it('reads the live OS Reduced Motion status, fail-safe default true, and subscribes to changes', () => {
    expect(source).toMatch(/const \[reduceMotionEnabled, setReduceMotionEnabled\] = useState\(true\);/);
    expect(source).toMatch(/AccessibilityInfo\.isReduceMotionEnabled\(\)/);
    expect(source).toMatch(/AccessibilityInfo\.addEventListener\('reduceMotionChanged', setReduceMotionEnabled\)/);
    expect(source).toMatch(/subscription\?\.remove\?\.\(\);/);
  });

  it('only subscribes while the modal is actually visible', () => {
    const effectIdx = source.indexOf('useEffect(() => {');
    expect(source.slice(effectIdx, effectIdx + 80)).toMatch(/if \(!visible\) return undefined;/);
  });

  it('is a read-only explanation — no setter that would let the app override the device Reduced Motion preference', () => {
    expect(source).not.toMatch(/AccessibilityInfo\.setAccessibilityFocus/);
    expect(source).not.toMatch(/onToggle/);
  });
});
