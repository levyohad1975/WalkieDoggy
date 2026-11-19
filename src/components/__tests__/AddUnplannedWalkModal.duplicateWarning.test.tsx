import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { AddUnplannedWalkModal } from '../AddUnplannedWalkModal';
import type { Walk } from '../../types';

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

const completedWalk = (date: string, time: string, id = 'existing'): Walk => ({
  id,
  familyId: 'family',
  dogId: 'dog',
  date,
  scheduledTime: time,
  responsibleUserId: 'walker',
  actualWalkerUserId: 'walker',
  status: 'done',
  createdAt: `${date}T${time}:00.000Z`,
  updatedAt: `${date}T${time}:00.000Z`,
});

describe('AddUnplannedWalkModal duplicate warning', () => {
  it('does not identify the optimistic save row as a prior duplicate while persistence is pending', async () => {
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    let resolveSave!: () => void;
    const onConfirm = jest.fn(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
    const view = render(
      <AddUnplannedWalkModal
        visible
        dogName="בוקי"
        dogId="dog"
        users={[]}
        defaultUserId="walker"
        existingWalks={[]}
        onConfirm={onConfirm}
        onClose={jest.fn()}
      />
    );

    fireEvent.press(view.getByRole('button', { name: 'שמור טיול' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    view.rerender(
      <AddUnplannedWalkModal
        visible
        dogName="בוקי"
        dogId="dog"
        users={[]}
        defaultUserId="walker"
        existingWalks={[completedWalk(date, time, 'optimistic-new-walk')]}
        onConfirm={onConfirm}
        onClose={jest.fn()}
      />
    );

    expect(view.queryByText(/נמצא טיול קיים לכלב\/ה ולמטייל\/ת/)).toBeNull();
    expect(view.getAllByRole('button').some((button) => button.props.accessibilityState?.busy)).toBe(true);

    await act(async () => {
      resolveSave();
    });
    view.rerender(
      <AddUnplannedWalkModal
        visible={false}
        dogName="בוקי"
        dogId="dog"
        users={[]}
        defaultUserId="walker"
        existingWalks={[completedWalk(date, time, 'optimistic-new-walk')]}
        onConfirm={onConfirm}
        onClose={jest.fn()}
      />
    );
    expect(view.queryByText(/נמצא טיול קיים לכלב\/ה ולמטייל\/ת/)).toBeNull();
  });

  it('keeps the two-step warning for a genuinely existing overlapping completed walk', () => {
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const view = render(
      <AddUnplannedWalkModal
        visible
        dogName="בוקי"
        dogId="dog"
        users={[]}
        defaultUserId="walker"
        existingWalks={[completedWalk(date, time)]}
        onConfirm={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(view.getByText(/נמצא טיול קיים לכלב\/ה ולמטייל\/ת/)).toBeTruthy();
  });
});
