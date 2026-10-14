import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { AddUnplannedWalkModal } from '../AddUnplannedWalkModal';

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

describe('AddUnplannedWalkModal live start feedback', () => {
  it('shows an actionable inline error when the start handler rejects', async () => {
    const onStartNow = jest.fn().mockRejectedValue(new Error('network timeout'));
    const view = render(
      <AddUnplannedWalkModal
        visible
        dogName="בוקי"
        users={[]}
        defaultUserId="manager"
        onConfirm={jest.fn()}
        onStartNow={onStartNow}
        onClose={jest.fn()}
      />
    );

    fireEvent.press(view.getByRole('button', { name: 'התחל טיול עכשיו' }));

    expect(await view.findByText('לא הצלחנו להתחיל את הטיול. בדקו חיבור ונסו שוב.')).toBeTruthy();
    expect(onStartNow).toHaveBeenCalledTimes(1);
  });
});
