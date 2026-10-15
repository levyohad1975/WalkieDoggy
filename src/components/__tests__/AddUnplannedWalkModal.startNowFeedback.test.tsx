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

  /**
   * P0 real-user report (2026-10-15): a legitimate refusal (most commonly
   * "an active walk already exists for this dog" — see
   * HomeScreen.walkLifecycle.test.ts's matching source-scan test) must show
   * its OWN specific Hebrew reason inline, not the generic network-sounding
   * fallback above. HomeScreen tags that case `knownReason: true` on the
   * thrown Error; this is the one hook AddUnplannedWalkModal has into that
   * contract, verified at the component level.
   */
  it('shows the caller\'s own specific reason inline when the refusal is tagged knownReason (e.g. an already-active walk for this dog)', async () => {
    const reason = 'כבר יש טיול פעיל לכלב הזה. סיימו אותו לפני שמתחילים טיול נוסף.';
    const onStartNow = jest.fn().mockImplementation(() => {
      const error = new Error(reason);
      (error as Error & { knownReason?: boolean }).knownReason = true;
      return Promise.reject(error);
    });
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

    expect(await view.findByText(reason)).toBeTruthy();
    expect(view.queryByText('לא הצלחנו להתחיל את הטיול. בדקו חיבור ונסו שוב.')).toBeNull();
  });

  it('still falls back to the generic message for an UNTAGGED rejection, even with a Hebrew-looking message (no regression from the knownReason change)', async () => {
    const onStartNow = jest.fn().mockRejectedValue(new Error('שגיאת רשת לא צפויה'));
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
    expect(view.queryByText('שגיאת רשת לא צפויה')).toBeNull();
  });
});
