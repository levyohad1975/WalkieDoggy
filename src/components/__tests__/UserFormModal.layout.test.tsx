import React from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { render, within } from '@testing-library/react-native';
import { UserFormModal } from '../UserFormModal';
import type { FamilyUser } from '../../types';

const editingUser = {
  id: 'member-1',
  familyId: 'family-1',
  name: 'אבי',
  avatar: '👨',
  color: '#5B8DEF',
  photoUrl: 'https://example.test/member.jpg',
  createdAt: '2026-01-01T00:00:00.000Z',
} as FamilyUser;

function renderUserForm({ width = 390, bottomInset = 34 }: { width?: number; bottomInset?: number } = {}) {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width, height: 844 },
        insets: { top: 47, right: 0, bottom: bottomInset, left: 0 },
      }}
    >
      <UserFormModal
        visible
        editingUser={editingUser}
        familyId="family-1"
        onSave={jest.fn()}
        onClose={jest.fn()}
      />
    </SafeAreaProvider>,
  );
}

describe('UserFormModal responsive layout', () => {
  it('places photo replacement and removal controls side by side', () => {
    const { getByTestId } = renderUserForm();
    const photoActions = getByTestId('user-form-photo-actions');
    const style = StyleSheet.flatten(photoActions.props.style);

    expect(style.flexDirection).toBe('row');
    expect(style.direction).toBe('rtl');
    expect(within(photoActions).getByRole('button', { name: 'החלפת תמונה' })).toBeTruthy();
    expect(within(photoActions).getByRole('button', { name: 'הסר תמונה וחזור לסמל ברירת המחדל' })).toBeTruthy();
  });

  it('keeps the eight avatar choices in a four-column RTL grid', () => {
    const { getAllByTestId, getByTestId } = renderUserForm();
    const gridStyle = StyleSheet.flatten(getByTestId('user-form-avatar-grid').props.style);
    const options = getAllByTestId('user-form-avatar-option');

    expect(options).toHaveLength(8);
    expect(gridStyle.flexDirection).toBe('row');
    expect(gridStyle.flexWrap).toBe('wrap');
    expect(gridStyle.direction).toBe('rtl');
    expect(gridStyle.justifyContent).toBe('space-between');
    for (const option of options) {
      const style = StyleSheet.flatten(option.props.style);
      expect(style.width).toBe('22%');
      expect(style.maxWidth).toBe(64);
      expect(style.aspectRatio).toBe(1);
    }
  });

  it('uses a responsive sheet width and compact vertical spacing', () => {
    const { getByTestId, getByText } = renderUserForm({ width: 320, bottomInset: 0 });
    const sheetStyle = StyleSheet.flatten(getByTestId('user-form-sheet').props.style);
    const labelStyle = StyleSheet.flatten(getByText('שם').props.style);
    const actionsStyle = StyleSheet.flatten(getByTestId('user-form-actions').props.style);

    expect(sheetStyle.width).toBe('100%');
    expect(sheetStyle.maxWidth).toBe(560);
    expect(labelStyle.marginTop).toBe(12);
    expect(labelStyle.marginBottom).toBe(6);
    expect(actionsStyle.marginTop).toBe(16);
  });

  it('keeps save and cancel accessible and above the iPhone bottom safe area', () => {
    const { getByTestId } = renderUserForm({ bottomInset: 34 });
    const sheetStyle = StyleSheet.flatten(getByTestId('user-form-sheet').props.style);
    const actions = getByTestId('user-form-actions');
    const actionStyle = StyleSheet.flatten(actions.props.style);

    expect(sheetStyle.paddingBottom).toBe(34);
    expect(actionStyle.flexDirection).toBe('row');
    expect(actionStyle.direction).toBe('rtl');
    expect(within(actions).getByRole('button', { name: 'שמירת פרטי בן משפחה' })).toBeTruthy();
    expect(within(actions).getByRole('button', { name: 'ביטול עריכת בן משפחה' })).toBeTruthy();
  });
});
