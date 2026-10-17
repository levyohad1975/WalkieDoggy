import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  mergeDecision,
  readTutorialRecord,
  recordTutorialDecision,
  recordTutorialOffer,
  setTutorialRemoteAdapter,
  tutorialProgressKey,
  type TutorialRemoteAdapter,
} from '../tutorialProgress';

const FAMILY_A = 'family-a';
const FAMILY_B = 'family-b';
const PARENT = 'profile-parent';
const CHILD = 'profile-child';

// Failures are injected with one-shot mockRejectedValueOnce on the shared
// AsyncStorage jest mock; never restore it (that would strip its in-memory
// implementation for every other suite in the same worker).
beforeEach(async () => {
  setTutorialRemoteAdapter(null);
  await AsyncStorage.clear();
});

describe('tutorialProgress — per family + profile persistence', () => {
  it('starts with no record', async () => {
    await expect(readTutorialRecord(FAMILY_A, PARENT)).resolves.toEqual({ ok: true, record: null });
  });

  it('isolates decisions per profile on a shared device and per family for the same person', async () => {
    await recordTutorialDecision(FAMILY_A, PARENT, 'dismissed');
    expect((await readTutorialRecord(FAMILY_A, PARENT)) as any).toMatchObject({ ok: true, record: { decision: 'dismissed' } });
    await expect(readTutorialRecord(FAMILY_A, CHILD)).resolves.toEqual({ ok: true, record: null });
    await expect(readTutorialRecord(FAMILY_B, PARENT)).resolves.toEqual({ ok: true, record: null });
  });

  it('never downgrades a completion to a dismissal (Settings replay closed early)', async () => {
    await recordTutorialDecision(FAMILY_A, PARENT, 'completed');
    await recordTutorialDecision(FAMILY_A, PARENT, 'dismissed');
    expect((await readTutorialRecord(FAMILY_A, PARENT)) as any).toMatchObject({ record: { decision: 'completed' } });
  });

  it('counts unanswered presentations and keeps them through a later decision', async () => {
    await recordTutorialOffer(FAMILY_A, CHILD);
    await recordTutorialOffer(FAMILY_A, CHILD);
    expect((await readTutorialRecord(FAMILY_A, CHILD)) as any).toMatchObject({ record: { decision: null, offers: 2 } });
    await recordTutorialDecision(FAMILY_A, CHILD, 'completed');
    expect((await readTutorialRecord(FAMILY_A, CHILD)) as any).toMatchObject({ record: { decision: 'completed', offers: 2 } });
  });

  it('treats a corrupt stored value as one unanswered offer, not as a fresh user', async () => {
    await AsyncStorage.setItem(tutorialProgressKey(FAMILY_A, PARENT), '{not json');
    expect((await readTutorialRecord(FAMILY_A, PARENT)) as any).toMatchObject({ ok: true, record: { decision: null, offers: 1 } });
  });

  it('reports a storage read failure as unknown instead of throwing', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('quota / private mode'));
    await expect(readTutorialRecord(FAMILY_A, PARENT)).resolves.toEqual({ ok: false });
  });

  it('reports a storage write failure without throwing', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('write failed'));
    await expect(recordTutorialDecision(FAMILY_A, PARENT, 'dismissed')).resolves.toBe(false);
  });

  it('does not touch authentication, onboarding or SyncQueue keys', async () => {
    await recordTutorialDecision(FAMILY_A, PARENT, 'completed');
    await recordTutorialOffer(FAMILY_A, CHILD);
    const keys = await AsyncStorage.getAllKeys();
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key.startsWith('walkie-tutorial:v1:')).toBe(true);
  });
});

describe('tutorialProgress — remote adapter seam', () => {
  it('merges a remote completion into the local record', async () => {
    const remote: TutorialRemoteAdapter = { read: jest.fn().mockResolvedValue('completed'), write: jest.fn().mockResolvedValue(undefined) };
    setTutorialRemoteAdapter(remote);
    expect((await readTutorialRecord(FAMILY_A, PARENT)) as any).toMatchObject({ ok: true, record: { decision: 'completed' } });
  });

  it('falls back to local truth when the remote is unavailable (offline)', async () => {
    await recordTutorialDecision(FAMILY_A, PARENT, 'dismissed');
    setTutorialRemoteAdapter({ read: jest.fn().mockRejectedValue(new Error('offline')), write: jest.fn().mockRejectedValue(new Error('offline')) });
    expect((await readTutorialRecord(FAMILY_A, PARENT)) as any).toMatchObject({ ok: true, record: { decision: 'dismissed' } });
    await expect(recordTutorialDecision(FAMILY_A, PARENT, 'completed')).resolves.toBe(true);
  });
});

describe('mergeDecision', () => {
  it('prefers completed, then dismissed, then nothing', () => {
    expect(mergeDecision(null, null)).toBeNull();
    expect(mergeDecision('dismissed', null)).toBe('dismissed');
    expect(mergeDecision('dismissed', 'completed')).toBe('completed');
    expect(mergeDecision('completed', 'dismissed')).toBe('completed');
  });
});
