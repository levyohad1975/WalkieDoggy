import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateId } from '../lib/id';
import type { Walk } from '../types';
import type { WalkCompletionDetails } from '../logic/walkActions';

// Lifecycle operations use a separate small journal. It deliberately does
// not read, migrate, rewrite, or enqueue anything in the legacy SyncQueue.
const STORAGE_KEY = '@walkie/walk-lifecycle-operation-ids-v1';
const OUTBOX_KEY = '@walkie/walk-lifecycle-outbox-v1';
type Action = 'start' | 'start_spontaneous' | 'finish' | 'resolve_duplicates';
type Journal = Record<string, string>;
export type WalkLifecycleIntent =
  | { action: 'start'; walkId: string; familyId: string; actorUserId: string; actualWalkerUserId: string; operationId: string; substitutionConfirmed: boolean; remoteStart: boolean; state: 'pending' | 'conflict'; error?: string }
  | { action: 'start_spontaneous'; walk: Walk; familyId: string; actorUserId: string; operationId: string; state: 'pending' | 'conflict'; error?: string }
  | { action: 'finish'; walkId: string; familyId: string; actorUserId: string; actualWalkerUserId: string; operationId: string; details: WalkCompletionDetails; state: 'pending' | 'conflict'; error?: string };
const pending = new Map<string, Promise<string>>();

function scope(action: Action, walkId: string, actorId: string): string {
  return `${action}:${actorId}:${walkId}`;
}

export async function getWalkLifecycleOperationId(action: Action, walkId: string, actorId: string): Promise<string> {
  const key = scope(action, walkId, actorId);
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const operation = (async () => {
    let journal: Journal = {};
    try {
      journal = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? '{}') as Journal;
      if (!journal || typeof journal !== 'object' || Array.isArray(journal)) throw new Error('Invalid lifecycle operation journal');
    } catch {
      if (action === 'resolve_duplicates') {
        // This action must fail closed if durable idempotency cannot be
        // guaranteed. Never send a fresh operation id after an uncertain RPC.
        throw new Error('Could not safely read the duplicate-resolution idempotency journal');
      }
      // A corrupt journal must not block the walk; a new id still gives the
      // server idempotency for this attempt, but cannot reconcile old work.
      journal = {};
    }
    const existing = journal[key];
    if (existing) return existing;
    const id = generateId('walk-operation');
    journal[key] = id;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(journal));
    return id;
  })();
  pending.set(key, operation);
  try {
    return await operation;
  } finally {
    pending.delete(key);
  }
}

export async function completeWalkLifecycleOperation(action: Action, walkId: string, actorId: string): Promise<void> {
  const key = scope(action, walkId, actorId);
  try {
    const journal = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? '{}') as Journal;
    if (!(key in journal)) return;
    delete journal[key];
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(journal));
  } catch {
    // Completion is already server-confirmed; a stale local key is safe and
    // the server will continue to deduplicate its operation id.
  }
}

/** Reads a previously persisted id without creating a new one. Used to offer
 * an explicit same-operation retry after an RPC response was lost. */
export async function getExistingWalkLifecycleOperationId(action: Action, walkId: string, actorId: string): Promise<string | undefined> {
  const key = scope(action, walkId, actorId);
  try {
    const value = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? '{}') as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid lifecycle operation journal');
    const id = (value as Journal)[key];
    return typeof id === 'string' && id ? id : undefined;
  } catch {
    if (action === 'resolve_duplicates') throw new Error('Could not safely read the duplicate-resolution idempotency journal');
    return undefined;
  }
}

async function readOutbox(): Promise<WalkLifecycleIntent[]> {
  try {
    const value = JSON.parse((await AsyncStorage.getItem(OUTBOX_KEY)) ?? '[]') as unknown;
    return Array.isArray(value) ? value as WalkLifecycleIntent[] : [];
  } catch {
    return [];
  }
}

async function writeOutbox(entries: WalkLifecycleIntent[]): Promise<void> {
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(entries));
}

export async function enqueueWalkLifecycleIntent(intent: WalkLifecycleIntent): Promise<void> {
  const entries = await readOutbox();
  const duplicate = entries.find((entry) => entry.action === intent.action && entry.operationId === intent.operationId);
  if (duplicate) return;
  entries.push(intent);
  await writeOutbox(entries);
}

export async function listWalkLifecycleIntents(): Promise<WalkLifecycleIntent[]> {
  return readOutbox();
}

export async function updateWalkLifecycleIntent(operationId: string, update: Partial<Pick<WalkLifecycleIntent, 'state' | 'error'>>): Promise<void> {
  const entries = await readOutbox();
  await writeOutbox(entries.map((entry) => entry.operationId === operationId ? { ...entry, ...update } as WalkLifecycleIntent : entry));
}

export async function removeWalkLifecycleIntent(operationId: string): Promise<void> {
  const entries = await readOutbox();
  await writeOutbox(entries.filter((entry) => entry.operationId !== operationId));
}
