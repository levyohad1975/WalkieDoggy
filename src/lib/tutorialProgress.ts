import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * First-run tutorial decision, persisted per FAMILY + PROFILE.
 *
 * Keyed by both ids so a different family member on a shared device, or the
 * same person after joining another family, never inherits someone else's
 * decision. Stored beside (but separate from) familySetupProgress — this file
 * never reads or writes authentication, onboarding or offline-queue keys.
 *
 * Cross-device sync is a deliberate seam: setTutorialRemoteAdapter() lets a
 * future server-backed adapter (see docs/engineering/
 * tutorial-progress-server-sync.DRAFT.sql) merge in without changing callers.
 * No remote adapter is installed by default.
 */

export const TUTORIAL_PROGRESS_KEY_PREFIX = 'walkie-tutorial:v1:';
/** Unanswered presentations allowed before the automatic invitation stops. */
export const TUTORIAL_MAX_AUTO_OFFERS = 3;

export type TutorialDecision = 'dismissed' | 'completed';

export interface TutorialRecord {
  decision: TutorialDecision | null;
  /** Times the automatic invitation was shown without an answer. */
  offers: number;
  updatedAt: string;
}

export type TutorialReadResult =
  | { ok: true; record: TutorialRecord | null }
  | { ok: false };

export interface TutorialRemoteAdapter {
  read(familyId: string, profileId: string): Promise<TutorialDecision | null>;
  write(familyId: string, profileId: string, decision: TutorialDecision): Promise<void>;
}

let remoteAdapter: TutorialRemoteAdapter | null = null;

export function setTutorialRemoteAdapter(adapter: TutorialRemoteAdapter | null): void {
  remoteAdapter = adapter;
}

export function tutorialProgressKey(familyId: string, profileId: string): string {
  return `${TUTORIAL_PROGRESS_KEY_PREFIX}${familyId}:${profileId}`;
}

function parseRecord(raw: string | null): TutorialRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TutorialRecord>;
    const decision = parsed.decision === 'completed' || parsed.decision === 'dismissed' ? parsed.decision : null;
    const offers = Number.isFinite(parsed.offers) && Number(parsed.offers) > 0 ? Math.floor(Number(parsed.offers)) : 0;
    return { decision, offers, updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '' };
  } catch {
    // A corrupt value must not resurrect the invitation forever; treat it as
    // an unanswered single offer so the normal cap still applies.
    return { decision: null, offers: 1, updatedAt: '' };
  }
}

/** 'completed' always wins; a dismissal never downgrades a completion. */
export function mergeDecision(a: TutorialDecision | null, b: TutorialDecision | null): TutorialDecision | null {
  if (a === 'completed' || b === 'completed') return 'completed';
  if (a === 'dismissed' || b === 'dismissed') return 'dismissed';
  return null;
}

export async function readTutorialRecord(familyId: string, profileId: string): Promise<TutorialReadResult> {
  let local: TutorialRecord | null;
  try {
    local = parseRecord(await AsyncStorage.getItem(tutorialProgressKey(familyId, profileId)));
  } catch {
    return { ok: false };
  }
  if (!remoteAdapter) return { ok: true, record: local };
  try {
    const remote = await remoteAdapter.read(familyId, profileId);
    const decision = mergeDecision(local?.decision ?? null, remote);
    if (!local && !decision) return { ok: true, record: null };
    return { ok: true, record: { decision, offers: local?.offers ?? 0, updatedAt: local?.updatedAt ?? '' } };
  } catch {
    // Remote unavailable (offline, not deployed): local truth still applies.
    return { ok: true, record: local };
  }
}

async function writeLocal(familyId: string, profileId: string, record: TutorialRecord): Promise<boolean> {
  try {
    await AsyncStorage.setItem(tutorialProgressKey(familyId, profileId), JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/**
 * Records an explicit decision. Resolves true when the local write succeeded.
 * Never throws — a storage failure must not block the user from closing.
 */
export async function recordTutorialDecision(familyId: string, profileId: string, decision: TutorialDecision, now: Date = new Date()): Promise<boolean> {
  let existing: TutorialRecord | null = null;
  try {
    existing = parseRecord(await AsyncStorage.getItem(tutorialProgressKey(familyId, profileId)));
  } catch {
    existing = null;
  }
  const next: TutorialRecord = {
    decision: mergeDecision(existing?.decision ?? null, decision),
    offers: existing?.offers ?? 0,
    updatedAt: now.toISOString(),
  };
  const ok = await writeLocal(familyId, profileId, next);
  if (remoteAdapter && next.decision) {
    void remoteAdapter.write(familyId, profileId, next.decision).catch(() => undefined);
  }
  return ok;
}

/** Counts one automatic presentation that has not (yet) been answered. */
export async function recordTutorialOffer(familyId: string, profileId: string, now: Date = new Date()): Promise<boolean> {
  let existing: TutorialRecord | null = null;
  try {
    existing = parseRecord(await AsyncStorage.getItem(tutorialProgressKey(familyId, profileId)));
  } catch {
    return false;
  }
  return writeLocal(familyId, profileId, {
    decision: existing?.decision ?? null,
    offers: (existing?.offers ?? 0) + 1,
    updatedAt: now.toISOString(),
  });
}
