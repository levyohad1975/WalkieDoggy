import { isSupabaseConfigured, supabase } from './supabase';

/**
 * Field report 2026-11-12: a family member started a walk on Android and the
 * admin's iPhone showed it only minutes later. Home relies on Realtime for
 * that, and an iPhone web app often comes back from the background with a
 * dead Realtime socket; the existing 6 s reconcile only runs while this
 * device already shows an active walk. This is the cheap safety net: one row
 * (the family's most recent walk change), polled while Home is in front.
 *
 * Returns the latest `walks.updated_at` for the family, or null when unknown
 * (offline, local mode, no walks).
 */
export async function fetchLatestFamilyWalkChange(familyId: string): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase || !familyId) return null;
  const { data, error } = await supabase
    .from('walks')
    .select('updated_at')
    .eq('family_id', familyId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return typeof (data as { updated_at?: unknown }).updated_at === 'string' ? (data as { updated_at: string }).updated_at : null;
}

/** How often Home checks for a walk change made on another device. */
export const FAMILY_WALK_PULSE_MS = 10_000;
