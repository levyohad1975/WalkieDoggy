import React from 'react';
import { Platform } from 'react-native';
import { render } from '@testing-library/react-native';
import { TimePickerField } from '../TimePickerField';

/**
 * Real-device QA fix — supersedes the previous
 * TimePickerField.autoBlurOnChange.test.tsx.
 *
 * That test guarded a workaround (blur the native <input type="time">
 * the moment a value was picked) for a973a98's "first tap on שמירה does
 * nothing, second tap works" bug: iOS Safari's own picker/keyboard stayed
 * open on a focused native input and consumed the first tap elsewhere to
 * dismiss it. A later real-iPhone screenshot found a second, worse
 * problem with that same native control: its picker overlay could cover
 * the middle of RuleFormModal (the assignee section and Save/Cancel
 * buttons) while open, regardless of the blur fix.
 *
 * TimePickerField.tsx's web branch now renders a plain button instead of
 * any native time-entry form element, and opens a fully custom picker
 * sheet (WebTimePickerSheet, covered in TimePickerField.web.test.tsx) —
 * there is no native control left to focus, show OS picker chrome for,
 * or need to blur. This guards that the underlying problem class (a
 * native form element driving this field on web) does not quietly come
 * back — it is no longer one specific workaround to re-verify.
 */
describe('TimePickerField on Web — no native time-entry element at all', () => {
  const originalOs = Platform.OS;

  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOs });
  });

  it('the visible field has no `type` prop (it is a Pressable, not a form control that could carry iOS Safari\'s native time/keyboard chrome)', () => {
    const screen = render(<TimePickerField value="08:00" onChange={() => undefined} webLabel="בחירת שעת טיול" />);
    const field = screen.getByLabelText('בחירת שעת טיול');
    expect(field.props.type).toBeUndefined();
  });
});
