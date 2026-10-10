type CropHandler = (uri: string) => Promise<string | null>;

let handler: CropHandler | null = null;

/**
 * Registered once by PhotoCropHost (mounted near App.tsx's root) so that
 * uploadImage.ts — which has no JSX tree of its own to render a crop Modal
 * from — can still trigger one. Same imperative-bridge shape as other
 * module-level singletons in this codebase (e.g. pushTokens.ts).
 * Passing `null` unregisters (host unmount / native no-op).
 */
export function registerPhotoCropHandler(fn: CropHandler | null): void {
  handler = fn;
}

/**
 * Requests a crop/zoom/pan pass over `uri` from whatever crop host is
 * currently mounted. Resolves to the cropped image's local URI, or the
 * original `uri` unchanged if no host is registered yet (fail-open so a
 * caller never hangs waiting on a host that isn't mounted). Resolves to
 * `null` only when the user explicitly cancels the crop step — callers
 * should treat that exactly like a picker cancellation.
 */
export async function requestPhotoCrop(uri: string): Promise<string | null> {
  if (!handler) return uri;
  return handler(uri);
}
