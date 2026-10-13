import * as Clipboard from 'expo-clipboard';

/**
 * BATCH 4 (item E — Copy Family Code). A single, tested clipboard helper so
 * every "copy" action in the app (family code, invite link) shares the same
 * try/catch-guarded behavior instead of each call site re-implementing its
 * own (the two pre-Batch-4 call sites — SettingsScreen.copyInviteCode and
 * InviteShareModal.copyLink — had NO try/catch at all: a rejected
 * `Clipboard.setStringAsync` would have surfaced as an unhandled promise
 * rejection with no user-facing failure feedback whatsoever).
 *
 * `expo-clipboard`'s `setStringAsync` already works on Web/PWA (backed by
 * the browser Clipboard API where available) and native iOS/Android — this
 * wrapper doesn't special-case Platform.OS, it only adds the missing
 * success/failure signal every caller needs to show real UI feedback.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    await Clipboard.setStringAsync(text);
    return true;
  } catch {
    return false;
  }
}
