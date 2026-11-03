import React from 'react';
import { AccessibilityInfo } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { TutorialOverlay, TUTORIAL_COPY } from '../tutorial/TutorialOverlay';
import { openTutorialFromHelp, useFirstRunTutorial } from '../tutorial/useFirstRunTutorial';
import { useAuthStore } from '../../store/authStore';
import { useFamilyStore } from '../../store/familyStore';
import { useTutorialStore } from '../../store/tutorialStore';
import { readTutorialRecord, recordTutorialDecision } from '../../lib/tutorialProgress';
import { setTutorialEnvOverride, type TutorialEnv } from '../../lib/tutorialConfig';
import type { FamilyUser } from '../../types';

/**
 * First-run tutorial, end to end through the gate hook and the overlay:
 * presentation, skip/completion persistence, creator vs member, profile and
 * family switching, offline/storage failure and the Help replay.
 */

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

function member(id: string, familyId = 'fam-1'): FamilyUser {
  return { id, familyId, name: id, avatar: '🙂', color: '#20A7B5', remindersEnabled: true, gamificationEnabled: true, createdAt: '2026-11-02T08:00:00Z' };
}

function Host({ platformOS = 'web', setupVisible = false, competing = false }: { platformOS?: string; setupVisible?: boolean; competing?: boolean }) {
  useFirstRunTutorial({ familySetupWizardVisible: setupVisible, competingOverlayVisible: competing, platformOS });
  return <TutorialOverlay />;
}

function renderHost(props: React.ComponentProps<typeof Host> = {}) {
  return render(<SafeAreaProvider initialMetrics={metrics}><Host {...props} /></SafeAreaProvider>);
}

function signIn({ familyId = 'fam-1', userId = 'parent', role = 'admin' as 'admin' | 'member' } = {}) {
  useAuthStore.setState({
    familyId,
    currentUserId: userId,
    familyRole: role,
    systemObserverActive: false,
    impersonatingUserId: null,
    testModeUserId: null,
  } as never);
  useFamilyStore.setState({
    family: { id: familyId, name: 'משפחת בדיקה', createdAt: '2026-11-01T00:00:00Z' },
    users: [member('parent', familyId), member('child', familyId)],
  } as never);
}

const flush = () => act(async () => {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setImmediate(resolve));
});

// Asserting the gate's own reason first makes a failure say WHY the
// invitation was withheld instead of only "element not found".
function expectOffered() {
  expect(useTutorialStore.getState().lastGateReason).toBe('offer');
}

// EXPO_PUBLIC_* values are compiled into the module, so configuration is
// injected through the config seam instead of being set at runtime.
let env: TutorialEnv;
function configure(patch: TutorialEnv) {
  env = { ...env, ...patch };
  setTutorialEnvOverride(env);
}

beforeEach(async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: jest.fn() } as never);
  env = { videoUrl: '/tutorial/all.mp4' };
  setTutorialEnvOverride(env);
  useTutorialStore.getState().reset();
  await AsyncStorage.clear();
});

afterEach(() => {
  setTutorialEnvOverride(null);
});

describe('first-run tutorial — presentation', () => {
  it('shows the welcome screen with the exact Hebrew copy and both actions', async () => {
    signIn();
    renderHost();
    await flush();
    expectOffered();
    expect(screen.getByTestId('tutorial-welcome')).toBeTruthy();
    expect(screen.getByText(TUTORIAL_COPY.title)).toBeTruthy();
    expect(screen.getByText(TUTORIAL_COPY.description)).toBeTruthy();
    expect(screen.getByText(TUTORIAL_COPY.watch)).toBeTruthy();
    expect(screen.getByText(TUTORIAL_COPY.skip)).toBeTruthy();
    expect(TUTORIAL_COPY.title).toBe('ברוכים הבאים ל־Walkie Doggy!');
    expect(TUTORIAL_COPY.description).toBe('רוצים לראות איך מנהלים את הטיולים המשפחתיים בקלות? הכנו לכם הדרכה קצרה.');
  });

  it('labels the mascot as the brand mascot, never as the family dog', async () => {
    signIn();
    renderHost();
    await flush();
    expectOffered();
    expect(screen.getByLabelText(TUTORIAL_COPY.mascotLabel)).toBeTruthy();
    expect(JSON.stringify(screen.toJSON())).not.toContain('טופי');
  });

  it('is not offered when no video is configured', async () => {
    configure({ videoUrl: undefined });
    signIn();
    renderHost();
    await flush();
    expect(screen.queryByTestId('tutorial-overlay')).toBeNull();
  });

  it('is not offered on native builds, where no video player is bundled', async () => {
    signIn();
    renderHost({ platformOS: 'ios' });
    await flush();
    expect(screen.queryByTestId('tutorial-overlay')).toBeNull();
  });

  it('waits for the setup wizard and the iOS install prompt', async () => {
    signIn();
    const { rerender } = renderHost({ setupVisible: true });
    await flush();
    expect(screen.queryByTestId('tutorial-overlay')).toBeNull();
    rerender(<SafeAreaProvider initialMetrics={metrics}><Host competing /></SafeAreaProvider>);
    await flush();
    expect(screen.queryByTestId('tutorial-overlay')).toBeNull();
    rerender(<SafeAreaProvider initialMetrics={metrics}><Host /></SafeAreaProvider>);
    await flush();
    expectOffered();
    expect(screen.getByTestId('tutorial-overlay')).toBeTruthy();
  });

  it('is never offered to a System Admin observer or during impersonation', async () => {
    signIn();
    useAuthStore.setState({ systemObserverActive: true } as never);
    renderHost();
    await flush();
    expect(screen.queryByTestId('tutorial-overlay')).toBeNull();
    useAuthStore.setState({ systemObserverActive: false, impersonatingUserId: 'child' } as never);
    await flush();
    expect(screen.queryByTestId('tutorial-overlay')).toBeNull();
  });
});

describe('first-run tutorial — skip and completion persistence', () => {
  it('"דלג והתחל" closes, persists, and is not shown again on the next login', async () => {
    signIn();
    const first = renderHost();
    await flush();
    expectOffered();
    fireEvent.press(screen.getByText(TUTORIAL_COPY.skip));
    await flush();
    expect(screen.queryByTestId('tutorial-overlay')).toBeNull();
    expect((await readTutorialRecord('fam-1', 'parent')) as any).toMatchObject({ record: { decision: 'dismissed' } });

    first.unmount();
    useTutorialStore.getState().reset(); // a new app session
    renderHost();
    await flush();
    expect(screen.queryByTestId('tutorial-overlay')).toBeNull();
  });

  it('watch → ended → "יאללה, מתחילים!" persists a completion', async () => {
    signIn();
    renderHost();
    await flush();
    expectOffered();
    fireEvent.press(screen.getByText(TUTORIAL_COPY.watch));
    expect(screen.getByTestId('tutorial-player')).toBeTruthy();
    act(() => { useTutorialStore.getState().markEnded(); });
    expect(screen.getByTestId('tutorial-done')).toBeTruthy();
    expect(screen.getAllByText(TUTORIAL_COPY.start).length).toBeGreaterThan(0);
    fireEvent.press(screen.getAllByText(TUTORIAL_COPY.start).slice(-1)[0]);
    await flush();
    expect(screen.queryByTestId('tutorial-overlay')).toBeNull();
    expect((await readTutorialRecord('fam-1', 'parent')) as any).toMatchObject({ record: { decision: 'completed' } });
  });
});

describe('first-run tutorial — creator vs member', () => {
  it('a family creator/admin gets the admin cut and admin highlights', async () => {
    configure({ videoUrlAdmin: '/tutorial/admin.mp4' });
    signIn({ role: 'admin' });
    renderHost();
    await flush();
    expectOffered();
    expect(useTutorialStore.getState().context?.role).toBe('admin');
    fireEvent.press(screen.getByText(TUTORIAL_COPY.watch));
    // Jest renders the native fallback, which lists the role's highlights.
    expect(screen.getByText(/כמנהלים: מוסיפים בני משפחה/)).toBeTruthy();
    expect(screen.queryByText(/מגדירים מנהלי המשפחה/)).toBeNull();
  });

  it('a joining member gets the member cut and is told who manages the schedule', async () => {
    signIn({ userId: 'child', role: 'member' });
    renderHost({ platformOS: 'web' });
    await flush();
    expectOffered();
    expect(useTutorialStore.getState().context?.role).toBe('member');
    fireEvent.press(screen.getByText(TUTORIAL_COPY.watch));
    expect(screen.getByText(/מגדירים מנהלי המשפחה/)).toBeTruthy();
    expect(screen.queryByText(/כמנהלים: מוסיפים בני משפחה/)).toBeNull();
  });

  it('waits for the verified role before offering', async () => {
    signIn();
    useAuthStore.setState({ familyRole: null } as never);
    renderHost();
    await flush();
    expect(screen.queryByTestId('tutorial-overlay')).toBeNull();
  });
});

describe('first-run tutorial — profile and family switching', () => {
  it('closes when the profile is switched or the device logs out, without recording a decision', async () => {
    signIn();
    renderHost();
    await flush();
    expectOffered();
    expect(screen.getByTestId('tutorial-overlay')).toBeTruthy();
    act(() => { useAuthStore.setState({ currentUserId: null } as never); });
    await flush();
    expect(screen.queryByTestId('tutorial-overlay')).toBeNull();
    expect((await readTutorialRecord('fam-1', 'parent')) as any).toMatchObject({ record: { decision: null } });
  });

  it('a different profile on the same device gets its own invitation', async () => {
    await recordTutorialDecision('fam-1', 'parent', 'completed');
    signIn({ userId: 'child', role: 'member' });
    renderHost();
    await flush();
    expectOffered();
    expect(screen.getByTestId('tutorial-overlay')).toBeTruthy();
  });

  it('joining another family is evaluated as a new context', async () => {
    await recordTutorialDecision('fam-1', 'parent', 'dismissed');
    signIn({ familyId: 'fam-2' });
    renderHost();
    await flush();
    expectOffered();
    expect(screen.getByTestId('tutorial-overlay')).toBeTruthy();
  });

  it('waits until the new family member list has loaded', async () => {
    signIn();
    useFamilyStore.setState({ family: { id: 'fam-old', name: 'x', createdAt: '' } } as never);
    renderHost();
    await flush();
    expect(screen.queryByTestId('tutorial-overlay')).toBeNull();
  });
});

describe('first-run tutorial — offline and storage failures', () => {
  it('defers while offline', async () => {
    if (!global.navigator) (global as unknown as { navigator: object }).navigator = {};
    const original = Object.getOwnPropertyDescriptor(global.navigator, 'onLine');
    Object.defineProperty(global.navigator, 'onLine', { value: false, configurable: true });
    try {
      signIn();
      renderHost();
      await flush();
      expect(screen.queryByTestId('tutorial-overlay')).toBeNull();
    } finally {
      if (original) Object.defineProperty(global.navigator, 'onLine', original);
      else delete (global.navigator as { onLine?: boolean }).onLine;
    }
  });

  it('does not offer when the stored decision cannot be read', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('storage blocked'));
    signIn();
    renderHost();
    await flush();
    expect(screen.queryByTestId('tutorial-overlay')).toBeNull();
  });
});

describe('Help / Settings replay', () => {
  it('opens the player directly, even after completion, and shows the fallback when the video is unavailable', async () => {
    await recordTutorialDecision('fam-1', 'parent', 'completed');
    configure({ videoUrl: undefined });
    signIn();
    renderHost({ platformOS: 'ios' });
    await flush();
    expect(screen.queryByTestId('tutorial-overlay')).toBeNull();
    act(() => { expect(openTutorialFromHelp()).toBe(true); });
    expect(screen.getByTestId('tutorial-player')).toBeTruthy();
    expect(screen.getByTestId('tutorial-fallback-unavailable')).toBeTruthy();
    fireEvent.press(screen.getByTestId('tutorial-player-close'));
    await flush();
    expect(screen.queryByTestId('tutorial-overlay')).toBeNull();
    expect((await readTutorialRecord('fam-1', 'parent')) as any).toMatchObject({ record: { decision: 'completed' } });
  });

  it('is a no-op without a claimed profile', () => {
    useAuthStore.setState({ familyId: null, currentUserId: null } as never);
    expect(openTutorialFromHelp()).toBe(false);
  });
});
