import fs from 'fs';
import path from 'path';

/**
 * QA Guardian sweep (keyboard-avoidance coverage on modals with TextInput):
 * DogDetailsModal is a bottom-anchored sheet (`justifyContent: 'flex-end'`,
 * `maxHeight: '88%'`) with a full-text keyboard on its "name"/"notes"
 * fields near the bottom, unlike every sibling modal with a TextInput
 * (AddUnplannedWalkModal, CompleteWalkModal, EditDoneDetailsModal,
 * UserFormModal, RuleFormModal) which already wraps its Modal content in
 * KeyboardAvoidingView. Verifies the same pattern here, per the
 * established source-scan convention for RN components this repo can't
 * render-test directly.
 */
describe('DogDetailsModal — keyboard avoidance', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../DogDetailsModal.tsx'), 'utf8');

  it('imports KeyboardAvoidingView and Platform from react-native', () => {
    expect(source).toMatch(/import\s*\{[^}]*\bKeyboardAvoidingView\b[^}]*\}\s*from\s*'react-native'/);
    expect(source).toMatch(/import\s*\{[^}]*\bPlatform\b[^}]*\}\s*from\s*'react-native'/);
  });

  it('wraps the Modal content in a KeyboardAvoidingView using the same iOS/Android behavior split as sibling modals', () => {
    expect(source).toMatch(/<KeyboardAvoidingView[^>]*behavior=\{Platform\.OS === 'ios' \? 'padding' : 'height'\}[^>]*>/);
  });

  it('the KeyboardAvoidingView wraps both the "name" and "notes" TextInputs', () => {
    const kavStart = source.indexOf('<KeyboardAvoidingView');
    const kavEnd = source.indexOf('</KeyboardAvoidingView>');
    expect(kavStart).toBeGreaterThan(-1);
    expect(kavEnd).toBeGreaterThan(kavStart);
    const kavBody = source.slice(kavStart, kavEnd);
    const textInputCount = (kavBody.match(/<TextInput/g) ?? []).length;
    expect(textInputCount).toBe(2);
  });
});
