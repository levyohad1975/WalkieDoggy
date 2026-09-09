import fs from 'fs';
import path from 'path';

/**
 * BATCH 4 (item F — Complete Walk UI). No RN component-rendering test infra
 * exists in this repo, so this is verified via source read, per the
 * established convention (see e.g. StatisticsScreen.permissionGate.test.ts).
 * The requirement is specific: the visible pee/poop toggle labels must be
 * emoji-only (no "פיפי"/"קקי" WORDS rendered), while the accessibility
 * labels — which are never visually shown — retain the real Hebrew words so
 * screen-reader users aren't left with only "💧"/"💩".
 */
describe('CompleteWalkModal — pee/poop toggles are emoji-only, not word labels (accessibility label retained)', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../CompleteWalkModal.tsx'), 'utf8');

  it('never renders the literal word "פיפי" or "קקי" as VISIBLE text content (only inside accessibilityLabel strings)', () => {
    // Strip every accessibilityLabel="..." attribute value (and comments)
    // before scanning — what's left is what a sighted user actually sees.
    const visibleOnly = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/accessibilityLabel="[^"]*"/g, '');
    expect(visibleOnly).not.toMatch(/פיפי/);
    expect(visibleOnly).not.toMatch(/קקי/);
  });

  it('each toggle has a real accessibilityRole="checkbox", accessibilityState reflecting its own boolean, and a proper Hebrew accessibilityLabel', () => {
    expect(source).toMatch(/onPress=\{\(\) => setHadPee\(\(v\) => !v\)\}[\s\S]{0,120}accessibilityRole="checkbox"[\s\S]{0,80}accessibilityState=\{\{ checked: hadPee \}\}[\s\S]{0,80}accessibilityLabel="סימון פיפי בטיול"/);
    expect(source).toMatch(/onPress=\{\(\) => setHadPoop\(\(v\) => !v\)\}[\s\S]{0,120}accessibilityRole="checkbox"[\s\S]{0,80}accessibilityState=\{\{ checked: hadPoop \}\}[\s\S]{0,80}accessibilityLabel="סימון קקי בטיול"/);
  });

  it('the toggle body renders only the emoji, no RtlText word sibling', () => {
    expect(source).toMatch(/<RtlText style=\{styles\.toggleEmoji\}>💧<\/RtlText>/);
    expect(source).toMatch(/<RtlText style=\{styles\.toggleEmoji\}>💩<\/RtlText>/);
  });
});
