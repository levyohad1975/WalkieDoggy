/**
 * Serializes queued replay with operations that can change this device's
 * server-side profile/family identity. This is an in-process race guard; the
 * authoritative identity check remains the server whoami() call.
 */
let tail: Promise<void> = Promise.resolve();

export async function withSyncIdentityFence<T>(operation: () => Promise<T>): Promise<T> {
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}
