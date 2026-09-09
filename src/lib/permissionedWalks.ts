import { supabase, SupabaseNotConfiguredError } from './supabase';
import { toWalk } from '../data/supabaseRepository';
import type { Walk } from '../types';

/**
 * BATCH 3 CORRECTION #1, CORRECTED AGAIN in CORRECTION #2 (review #2) and
 * the final review correction — thin wrappers over migration 0027's
 * list_history_walks()/list_statistics_walks()/get_last_resolved_walk()
 * RPCs. Supabase-only (throws
 * SupabaseNotConfiguredError in local/demo mode, same convention as
 * lib/walkAdmin.ts/lib/permissions.ts — there is no per-member permission
 * concept in local/demo mode at all; every local/demo member simply gets
 * the role default and keeps using the existing unrestricted
 * repository.getWalks()/scheduleStore path).
 *
 * HistoryScreen.tsx/StatisticsScreen.tsx call these as the SERVER-
 * AUTHORITATIVE "am I actually allowed to see this, and here is the data"
 * call — a rejection here means the RPC itself denied access
 * (has_member_permission() was false), independent of whatever the
 * client's own (possibly stale/still-loading) familyStore.permissionOverrides
 * currently believes.
 *
 * CORRECTED (review #2): the resolved rows returned here ARE now each
 * screen's actual display/calculation dataset (historyDataset/
 * statisticsDataset), not a discarded allow/deny probe. This is required
 * because migration 0027 also tightened the raw `walks` table RLS policy to
 * a permission-independent operational window (today + pending only) — the
 * unrestricted historical read those screens used to fall back on via
 * scheduleStore.walks no longer exists for anyone, permitted or not. Each
 * screen keeps itself reasonably fresh by refetching here on every
 * useFocusEffect (tab focus) and immediately after any mutation it owns
 * (see HistoryScreen.tsx's refreshHistoryDataset()/
 * StatisticsScreen.tsx's refreshStatisticsDataset()), rather than
 * restoring unrestricted raw historical access just for reactivity.
 */
function requireSupabase() {
  if (!supabase) throw new SupabaseNotConfiguredError();
  return supabase;
}

/** Resolves with the caller's authorized History rows; rejects (server-side denial) if view_history is not allowed. See this file's own doc comment — these rows are HistoryScreen's actual display/calculation dataset. */
export async function fetchHistoryWalks(): Promise<Walk[]> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('list_history_walks');
  if (error) throw error;
  return ((data ?? []) as any[]).map(toWalk);
}

/** Resolves with the caller's authorized Statistics rows; rejects (server-side denial) if view_statistics is not allowed. See this file's own doc comment — these rows are StatisticsScreen's actual display/calculation dataset. */
export async function fetchStatisticsWalks(): Promise<Walk[]> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('list_statistics_walks');
  if (error) throw error;
  return ((data ?? []) as any[]).map(toWalk);
}

/**
 * BATCH 3 FINAL REVIEW CORRECTION — thin wrapper over migration 0027's
 * get_last_resolved_walk(). Restores HomeScreen's "last walk" card to its
 * pre-0027 fidelity (the single most recently resolved walk, regardless of
 * how many days ago) without reopening any bulk raw historical access: the
 * RPC itself enforces LIMIT 1 server-side and is NOT gated by
 * has_member_permission() at all — see 0027's own comment on why a single
 * operational-status row is not the kind of bulk/searchable data
 * view_history/view_statistics are meant to gate. Unlike fetchHistoryWalks/
 * fetchStatisticsWalks above, this never rejects for a permission reason
 * (every authenticated family member may call it) — it can still reject on
 * a genuine transport/auth failure, which the caller should treat as "we
 * don't know" rather than "there is no last walk". Resolves `null` when the
 * family genuinely has no resolved walk yet (zero rows, not an error).
 */
export async function fetchLastResolvedWalk(): Promise<Walk | null> {
  const client = requireSupabase();
  const { data, error } = await client.rpc('get_last_resolved_walk');
  if (error) throw error;
  const rows = (data ?? []) as any[];
  return rows.length > 0 ? toWalk(rows[0]) : null;
}
