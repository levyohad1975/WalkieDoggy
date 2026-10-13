import fs from 'fs';

/**
 * PRD §16: "Settings includes ... privacy/GPS, accessibility/Reduced
 * Motion." Verifies SettingsScreen wires a real entry point to
 * PrivacyAccessibilityInfoModal, not just imports it unused. Source-scan
 * convention: this repo has no render-test harness for screens.
 */
describe('SettingsScreen wires the privacy/GPS + accessibility entry point (structural)', () => {
  const source = fs.readFileSync(require.resolve('../SettingsScreen'), 'utf8').replace(/\r\n/g, '\n');

  it('imports PrivacyAccessibilityInfoModal and holds its own visibility state', () => {
    expect(source).toMatch(/import \{ PrivacyAccessibilityInfoModal \} from '\.\.\/components\/PrivacyAccessibilityInfoModal';/);
    expect(source).toMatch(/const \[privacyAccessibilityModalVisible, setPrivacyAccessibilityModalVisible\] = useState\(false\);/);
  });

  it('renders a row that opens the modal', () => {
    const rowIdx = source.indexOf('setPrivacyAccessibilityModalVisible(true)');
    expect(rowIdx).toBeGreaterThan(-1);
    const before = source.slice(Math.max(0, rowIdx - 200), rowIdx);
    expect(before).toMatch(/onPress=\{\(\) =>/);
  });

  it('renders <PrivacyAccessibilityInfoModal> wired to that same state', () => {
    const modalIdx = source.indexOf('<PrivacyAccessibilityInfoModal');
    expect(modalIdx).toBeGreaterThan(-1);
    const block = source.slice(modalIdx, modalIdx + 200);
    expect(block).toMatch(/visible=\{privacyAccessibilityModalVisible\}/);
    expect(block).toMatch(/onClose=\{\(\) => setPrivacyAccessibilityModalVisible\(false\)\}/);
  });
});
