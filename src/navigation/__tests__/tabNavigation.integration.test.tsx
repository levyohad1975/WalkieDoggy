import React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const initialSafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
function renderApp() {
  return render(
    <SafeAreaProvider initialMetrics={initialSafeAreaMetrics}>
      <RootNavigator />
    </SafeAreaProvider>
  );
}

/**
 * Real-iPhone QA (final consolidated pass, item 1) reported that tapping
 * Statistics/History still shows Home, DIRECTLY CONTRADICTING every
 * navigation "test" that existed before this file — every one of them
 * (tabBarRtlContract.test.ts, permissionVisibility.test.ts,
 * homeNavCentering.test.ts) is a source-text pattern match via
 * fs.readFileSync, never an actual render + tap. That blind spot is exactly
 * how a real regression could ship while every existing "test" stayed
 * green. This file renders the REAL RootNavigator (only the six leaf
 * screens are mocked, so the test is entirely about the navigation
 * mechanism itself) and simulates real presses on the fixed tab bar.
 */
jest.mock('../../screens/HomeScreen', () => {
  const { Text } = require('react-native');
  return { HomeScreen: () => <Text>HOME_SCREEN</Text> };
});
jest.mock('../../screens/ScheduleScreen', () => {
  const { Text } = require('react-native');
  return { ScheduleScreen: () => <Text>SCHEDULE_SCREEN</Text> };
});
jest.mock('../../screens/FamilyScreen', () => {
  const { Text } = require('react-native');
  return { FamilyScreen: () => <Text>FAMILY_SCREEN</Text> };
});
jest.mock('../../screens/HistoryScreen', () => {
  const { Text } = require('react-native');
  return { HistoryScreen: () => <Text>HISTORY_SCREEN</Text> };
});
jest.mock('../../screens/StatisticsScreen', () => {
  const { Text } = require('react-native');
  return { StatisticsScreen: () => <Text>STATISTICS_SCREEN</Text> };
});
jest.mock('../../screens/SettingsScreen', () => {
  const { Text } = require('react-native');
  return { SettingsScreen: () => <Text>SETTINGS_SCREEN</Text> };
});

// Best-effort multi-device sync — irrelevant to tab routing, and touches
// realtime/supabase wiring that has nothing to do with what this file tests.
jest.mock('../../lib/realtime', () => ({ subscribeToFamilyChanges: () => () => undefined }));

import { RootNavigator } from '../RootNavigator';
import { useAuthStore } from '../../store/authStore';
import { useFamilyStore } from '../../store/familyStore';

describe('bottom tab navigation — real render + tap (item 1 regression guard)', () => {
  beforeEach(() => {
    // Grant access to every gated tab so History/Statistics/Settings all
    // render as real, pressable buttons — the exact condition under which
    // real-iPhone QA found the bug (an admin with full access).
    useAuthStore.setState({
      currentUserId: 'user-aba',
      familyId: 'family-main',
      familyRole: 'admin',
      impersonatingUserId: null,
      testModeUserId: null,
      systemObserverActive: false,
    });
    useFamilyStore.setState({
      permissionOverrides: [],
      permissionOverridesStatus: 'loaded',
    });
  });

  it('starts on Home', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText('HOME_SCREEN')).toBeTruthy());
  });

  it('tapping Statistics actually renders the Statistics screen, not Home', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText('HOME_SCREEN')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('סטטיסטיקה'));

    await waitFor(() => expect(screen.getByText('STATISTICS_SCREEN')).toBeTruthy());
    expect(screen.queryByText('HOME_SCREEN')).toBeNull();
  });

  it('tapping History actually renders the History screen, not Home', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText('HOME_SCREEN')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('היסטוריה'));

    await waitFor(() => expect(screen.getByText('HISTORY_SCREEN')).toBeTruthy());
    expect(screen.queryByText('HOME_SCREEN')).toBeNull();
  });

  it('tapping Schedule, then Home again, returns to the real Home screen', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText('HOME_SCREEN')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('לוח זמנים'));
    await waitFor(() => expect(screen.getByText('SCHEDULE_SCREEN')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('בית'));
    await waitFor(() => expect(screen.getByText('HOME_SCREEN')).toBeTruthy());
  });

  it('tapping Settings actually renders Settings, not Home', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText('HOME_SCREEN')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('הגדרות'));

    await waitFor(() => expect(screen.getByText('SETTINGS_SCREEN')).toBeTruthy());
    expect(screen.queryByText('HOME_SCREEN')).toBeNull();
  });

  /**
   * The actual root cause (item 1, final consolidated pass): History/
   * Statistics/Settings each reload family data on their own mount/focus,
   * which resets familyStore's permissionOverridesStatus to 'loading' for
   * the duration of that reload — including while the user is standing on
   * that exact tab having just navigated there. canSeeHistoryTab (etc.)
   * fails closed during that window, and the old
   * `{canSeeXTab ? <Tab.Screen/> : null}` unmounted the CURRENTLY FOCUSED
   * route out from under the navigator, which fell back to Home (the first
   * declared screen). This reproduces exactly that sequence without
   * needing the real screens mounted — flipping permissionOverridesStatus
   * back to 'loading' right after navigating there, the same state change
   * HistoryScreen/StatisticsScreen's own reload effect would cause.
   */
  it('does not bounce back to Home when a permission-status reload happens WHILE the user is on History/Statistics', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText('HOME_SCREEN')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('היסטוריה'));
    await waitFor(() => expect(screen.getByText('HISTORY_SCREEN')).toBeTruthy());

    // Simulate the destination screen's own reload resetting the shared
    // permission-load signal mid-visit (familyStore.loadPermissionOverrides()
    // does this at the START of every reload, before the network round-trip
    // resolves).
    act(() => { useFamilyStore.setState({ permissionOverridesStatus: 'loading' }); });

    // Must still be on History — not bounced to Home just because its own
    // reload transiently made canSeeHistoryTab fail closed.
    expect(screen.queryByText('HISTORY_SCREEN')).toBeTruthy();
    expect(screen.queryByText('HOME_SCREEN')).toBeNull();

    // And once the reload resolves (status back to 'loaded', access still
    // granted), the tab bar's own button is still there too.
    act(() => { useFamilyStore.setState({ permissionOverridesStatus: 'loaded' }); });
    await waitFor(() => expect(screen.getByLabelText('היסטוריה')).toBeTruthy());
  });

  it('a genuinely revoked permission still hides the tab once the user navigates away from it', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByText('HOME_SCREEN')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('היסטוריה'));
    await waitFor(() => expect(screen.getByText('HISTORY_SCREEN')).toBeTruthy());

    // A REAL revocation this time — permissionOverridesStatus settles back
    // to 'loaded' with access genuinely denied (not just a transient blip).
    act(() => {
      useFamilyStore.setState({
        permissionOverridesStatus: 'loaded',
        permissionOverrides: [{ userId: 'user-aba', permissionKey: 'view_history', allowed: false }] as never,
      });
    });

    fireEvent.press(screen.getByLabelText('בית'));
    await waitFor(() => expect(screen.getByText('HOME_SCREEN')).toBeTruthy());

    expect(screen.queryByLabelText('היסטוריה')).toBeNull();
  });
});
