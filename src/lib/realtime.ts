import type { RealtimeChannel } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './supabase';

// P0 FIX — stale request status across devices: `walk_swap_requests` and
// `time_change_requests` (migrations/0005_requests_audit_presence.sql) were
// missing from this list entirely, so creating/approving/rejecting a
// request on one device never triggered a reload on any OTHER device — the
// admin's pending badge, the member's walk-card status, everything stayed
// stale until a manual pull-to-refresh. Added here so requestsStore.load()
// (wired in via RootNavigator's onChange callback) gets the same
// "refetch on any relevant change" live sync as users/dogs/schedule/walks
// already had. See supabase/migrations/0017_realtime_publication.sql for
// the SERVER-SIDE half of this fix — Supabase Realtime only streams changes
// for tables actually added to the `supabase_realtime` publication, and no
// prior migration in this project ever added ANY table to it (client-side
// subscriptions alone are not sufficient).
const WATCHED_TABLES = [
  'users',
  'dogs',
  'schedule_rules',
  'schedule_entries',
  'walks',
  'walk_swap_requests',
  'time_change_requests',
] as const;

/**
 * Best-effort multi-device live sync: when another device changes users,
 * the dog, schedule_rules, schedule_entries, walks, or a swap/time-change
 * request for this family, `onChange` fires (debounced) so the caller can
 * reload from the repository — no manual pull-to-refresh needed. This is
 * intentionally "refetch on change" rather than merging the changed row
 * client-side: the app's stores already have a single `load(familyId)` (or,
 * for requests, `load()`) that re-derives everything correctly (including
 * the schedule self-healing logic), so reusing it here is both simpler and
 * safer than a second code path.
 *
 * No-ops entirely in local/demo mode. If the realtime connection itself
 * fails (e.g. Realtime not enabled on the project, or offline), this fails
 * silently — the app still works via pull-to-refresh / refresh-on-load,
 * which every screen already has regardless of this subscription.
 *
 * Returns an unsubscribe function; always call it (e.g. on sign-out or
 * family change) to avoid leaking a channel subscribed to the wrong family.
 */
export function subscribeToFamilyChanges(familyId: string, onChange: () => void): () => void {
  if (!isSupabaseConfigured || !supabase) return () => undefined;

  let debounceHandle: ReturnType<typeof setTimeout> | null = null;
  const debouncedOnChange = () => {
    if (debounceHandle) clearTimeout(debounceHandle);
    // A rule edit can cascade into several entries/walks updates in quick
    // succession (see scheduleStore.updateRule) — coalesce those into one
    // reload instead of one per row.
    debounceHandle = setTimeout(onChange, 500);
  };

  let channel: RealtimeChannel | null = null;
  try {
    channel = supabase.channel(`family-changes:${familyId}`);
    for (const table of WATCHED_TABLES) {
      channel.on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table, filter: `family_id=eq.${familyId}` },
        debouncedOnChange
      );
    }
    channel.subscribe();
  } catch {
    // Realtime not available (not enabled on the project, or a transient
    // connection issue) — the rest of the app still works without it.
  }

  return () => {
    if (debounceHandle) clearTimeout(debounceHandle);
    if (channel) supabase?.removeChannel(channel).catch(() => undefined);
  };
}
