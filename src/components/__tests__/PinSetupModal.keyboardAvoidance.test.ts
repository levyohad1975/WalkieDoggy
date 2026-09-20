import fs from 'fs';
import path from 'path';

/**
 * QA Guardian sweep (keyboard-avoidance coverage on modals with TextInput):
 * PinSetupModal is a vertically-centered card (`justifyContent: 'center'`)
 * with TWO PIN TextInputs (new + confirm) and its action-button row —
 * the same missing-KeyboardAvoidingView gap as PinEntryModal, worse here
 * since the card is taller. Verifies the same established pattern used
 * across every sibling modal with a TextInput.
 */
describe('PinSetupModal — keyboard avoidance', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../PinSetupModal.tsx'), 'utf8');

  it('imports KeyboardAvoidingView and Platform from react-native', () => {
    expect(source).toMatch(/import\s*\{[^}]*\bKeyboardAvoidingView\b[^}]*\}\s*from\s*'react-native'/);
    expect(source).toMatch(/import\s*\{[^}]*\bPlatform\b[^}]*\}\s*from\s*'react-native'/);
  });

  it('wraps the Modal content in a KeyboardAvoidingView using the same iOS/Android behavior split as sibling modals', () => {
    expect(source).toMatch(/<KeyboardAvoidingView[^>]*behavior=\{Platform\.OS === 'ios' \? 'padding' : 'height'\}[^>]*>/);
  });

  it('the KeyboardAvoidingView wraps both the "pin" and "confirmPin" TextInputs', () => {
    const kavStart = source.indexOf('<KeyboardAvoidingView');
    const kavEnd = source.indexOf('</KeyboardAvoidingView>');
    expect(kavStart).toBeGreaterThan(-1);
    expect(kavEnd).toBeGreaterThan(kavStart);
    const kavBody = source.slice(kavStart, kavEnd);
    const textInputCount = (kavBody.match(/<TextInput/g) ?? []).length;
    expect(textInputCount).toBe(2);
  });
});
