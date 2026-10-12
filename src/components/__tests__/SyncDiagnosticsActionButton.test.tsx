import React, { useState } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SyncDiagnosticsActionButton, type SyncDiagnosticsFeedback } from '../../components/SyncDiagnosticsActionButton';

describe('SyncDiagnosticsActionButton native/web Pressable interaction', () => {
  it('shows touch acknowledgement beside the button and invokes refresh on press', () => {
    const refresh = jest.fn();
    function Harness() {
      const [feedback, setFeedback] = useState<SyncDiagnosticsFeedback | null>(null);
      return (
        <SyncDiagnosticsActionButton
          label="רענון אבחון"
          accessibilityLabel="רענון אבחון"
          testID="sync-diagnostics-refresh"
          feedback={feedback}
          onPressIn={() => setFeedback({ kind: 'loading', message: 'הלחיצה נקלטה; מרענן אבחון…' })}
          onPress={() => {
            refresh();
            setFeedback({ kind: 'success', message: 'האבחון עודכן בהצלחה · 12:34:56' });
          }}
        />
      );
    }

    const screen = render(<Harness />);
    const button = screen.getByTestId('sync-diagnostics-refresh');
    fireEvent.pressIn(button);
    expect(screen.getByText('הלחיצה נקלטה; מרענן אבחון…')).toBeTruthy();
    fireEvent.press(button);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText('האבחון עודכן בהצלחה · 12:34:56')).toBeTruthy();
  });

  it('uses the same enabled Pressable path when diagnostics are idle', () => {
    const onPress = jest.fn();
    const screen = render(
      <SyncDiagnosticsActionButton
        label="רענון אבחון"
        accessibilityLabel="רענון אבחון"
        onPress={onPress}
        disabled={false}
        busy={false}
      />
    );
    fireEvent.press(screen.getByRole('button', { name: 'רענון אבחון' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
