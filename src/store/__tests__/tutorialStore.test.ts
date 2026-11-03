import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTutorialStore } from '../tutorialStore';
import { readTutorialRecord } from '../../lib/tutorialProgress';

const ADMIN_CTX = { familyId: 'fam-1', profileId: 'parent', role: 'admin' as const };
const MEMBER_CTX = { familyId: 'fam-1', profileId: 'child', role: 'member' as const };

// Drains every queued microtask (the in-memory AsyncStorage mock never does
// real I/O), so fire-and-forget persistence has settled.
const flush = async () => {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

beforeEach(async () => {
  useTutorialStore.getState().reset();
  await AsyncStorage.clear();
});

describe('tutorialStore — first-run flow', () => {
  it('opens on the welcome screen and counts one presentation', async () => {
    useTutorialStore.getState().offerFirstRun(MEMBER_CTX);
    expect(useTutorialStore.getState()).toMatchObject({ visible: true, origin: 'firstRun', mode: 'welcome' });
    await flush();
    expect((await readTutorialRecord('fam-1', 'child')) as any).toMatchObject({ record: { decision: null, offers: 1 } });
  });

  it('skip ("דלג והתחל") closes and persists a dismissal', async () => {
    useTutorialStore.getState().offerFirstRun(MEMBER_CTX);
    useTutorialStore.getState().dismiss();
    expect(useTutorialStore.getState().visible).toBe(false);
    await flush();
    expect((await readTutorialRecord('fam-1', 'child')) as any).toMatchObject({ record: { decision: 'dismissed' } });
  });

  it('watch → ended → "יאללה, מתחילים!" persists a completion', async () => {
    useTutorialStore.getState().offerFirstRun(ADMIN_CTX);
    useTutorialStore.getState().startPlayback();
    expect(useTutorialStore.getState().mode).toBe('player');
    useTutorialStore.getState().markEnded();
    expect(useTutorialStore.getState().mode).toBe('done');
    useTutorialStore.getState().finish();
    expect(useTutorialStore.getState().visible).toBe(false);
    await flush();
    expect((await readTutorialRecord('fam-1', 'parent')) as any).toMatchObject({ record: { decision: 'completed' } });
  });

  it('ignores a second offer while already visible', () => {
    useTutorialStore.getState().offerFirstRun(ADMIN_CTX);
    useTutorialStore.getState().offerFirstRun(MEMBER_CTX);
    expect(useTutorialStore.getState().context).toEqual(ADMIN_CTX);
  });
});

describe('tutorialStore — profile and family switching', () => {
  it('closes without recording a decision when the profile changes (switch/logout)', async () => {
    useTutorialStore.getState().offerFirstRun(MEMBER_CTX);
    await flush();
    useTutorialStore.getState().syncContext('fam-1', 'parent');
    expect(useTutorialStore.getState()).toMatchObject({ visible: false, context: null });
    await flush();
    expect((await readTutorialRecord('fam-1', 'child')) as any).toMatchObject({ record: { decision: null } });
  });

  it('closes when the device joins another family, and on logout', () => {
    useTutorialStore.getState().offerFirstRun(MEMBER_CTX);
    useTutorialStore.getState().syncContext('fam-2', 'child');
    expect(useTutorialStore.getState().visible).toBe(false);

    useTutorialStore.getState().offerFirstRun(ADMIN_CTX);
    useTutorialStore.getState().syncContext(null, null);
    expect(useTutorialStore.getState().visible).toBe(false);
  });

  it('keeps the overlay when the context is unchanged', () => {
    useTutorialStore.getState().offerFirstRun(MEMBER_CTX);
    useTutorialStore.getState().syncContext('fam-1', 'child');
    expect(useTutorialStore.getState().visible).toBe(true);
  });

  it('remembers handled contexts per session so a failed write never re-offers', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('offer write failed'));
    useTutorialStore.getState().offerFirstRun(MEMBER_CTX);
    await flush();
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('decision write failed'));
    useTutorialStore.getState().dismiss();
    await flush();
    expect(useTutorialStore.getState().handledKeys['fam-1:child']).toBe(true);
    expect(useTutorialStore.getState().lastWriteFailed).toBe(true);
  });
});

describe('tutorialStore — Settings / Help replay', () => {
  it('opens the player directly from Help', () => {
    useTutorialStore.getState().openFromHelp(ADMIN_CTX);
    expect(useTutorialStore.getState()).toMatchObject({ visible: true, origin: 'help', mode: 'player' });
  });

  it('closing a Help replay early never downgrades an earlier completion', async () => {
    useTutorialStore.getState().openFromHelp(ADMIN_CTX);
    useTutorialStore.getState().markEnded();
    useTutorialStore.getState().finish();
    await flush();
    useTutorialStore.getState().openFromHelp(ADMIN_CTX);
    useTutorialStore.getState().dismiss();
    await flush();
    expect((await readTutorialRecord('fam-1', 'parent')) as any).toMatchObject({ record: { decision: 'completed' } });
  });
});
