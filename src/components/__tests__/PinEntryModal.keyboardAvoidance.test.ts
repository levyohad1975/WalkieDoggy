import fs from 'fs';
import path from 'path';

/**
 * QA Guardian sweep (keyboard-avoidance coverage on modals with TextInput):
 * PinEntryModal is a vertically-centered card (`justifyContent: 'center'`)
 * with a PIN TextInput and its action-button row, unlike every sibling
 * modal with a TextInput (DogDetailsModal, AddUnplannedWalkModal,
 * CompleteWalkModal, EditDoneDetailsModal, UserFormModal, RuleFormModal,
 * RequestTimeChangeModal, EditWalkModal) which already wraps its Modal
 * content in KeyboardAvoidingView. On shorter devices the number-pad
 * keyboard can cover the input/buttons since nothing shrinks the centered
 * card's available height. Verifies the same established pattern here.
 */
describe('PinEntryModal — keyboard avoidance', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../PinEntryModal.tsx'), 'utf8');

  it('imports KeyboardAvoidingView and Platform from react-native', () => {
    expect(source).toMatch(/import\s*\{[^}]*\bKeyboardAvoidingView\b[^}]*\}\s*from\s*'react-native'/);
    expect(source).toMatch(/import\s*\{[^}]*\bPlatform\b[^}]*\}\s*from\s*'react-native'/);
  });

  it('wraps the Modal content in a KeyboardAvoidingView using the same iOS/Android behavior split as sibling modals', () => {
    expect(source).toMatch(/<KeyboardAvoidingView[^>]*behavior=\{Platform\.OS === 'ios' \? 'padding' : 'height'\}[^>]*>/);
  });

  it('the KeyboardAvoidingView wraps the PIN TextInput', () => {
    const kavStart = source.indexOf('<KeyboardAvoidingView');
    const kavEnd = source.indexOf('</KeyboardAvoidingView>');
    expect(kavStart).toBeGreaterThan(-1);
    expect(kavEnd).toBeGreaterThan(kavStart);
    const kavBody = source.slice(kavStart, kavEnd);
    const textInputCount = (kavBody.match(/<TextInput/g) ?? []).length;
    expect(textInputCount).toBe(1);
  });
});
