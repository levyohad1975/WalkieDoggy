import { isSupabaseConfigured, supabase } from './supabase';

/**
 * Best-effort: asks the `remove-photo-background` Edge Function to produce
 * a transparent cutout of an already-uploaded dog photo (Home's mascot slot
 * prefers this over the raw photo). Returns null on ANY failure — missing
 * Supabase config, network error, provider outage — rather than throwing:
 * the cutout is a presentational enhancement, never a blocker. Callers must
 * keep working with the original `photoUrl` (and ultimately the animated
 * mascot) when this returns null.
 *
 * The actual background-removal provider (currently Hugging Face's
 * briaai/RMBG-1.4) is fully isolated server-side —
 * supabase/functions/remove-photo-background/provider.ts — so it can be
 * swapped for a self-hosted alternative later without any client change.
 */
export async function requestDogPhotoCutout(photoUrl: string): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase.functions.invoke('remove-photo-background', {
      body: { photoUrl },
    });
    if (error || !data?.cutoutUrl || typeof data.cutoutUrl !== 'string') return null;
    return data.cutoutUrl;
  } catch {
    return null;
  }
}
