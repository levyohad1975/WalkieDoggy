import { create } from 'zustand';
import { isSupabaseConfigured } from '../lib/supabase';
import { guardTestModeMutation } from '../lib/testModeGuard';
import { useAuthStore } from './authStore';
import { useScheduleStore } from './scheduleStore';
import {
  approveSwapRequest,
  approveTimeChangeRequest,
  createSwapRequest,
  createTimeChangeRequest,
  listSwapRequests,
  listTimeChangeRequests,
  rejectSwapRequest,
  rejectTimeChangeRequest,
  type SwapRequestRow,
  type TimeChangeRequestRow,
} from '../lib/requests';
import { sendRequestPush } from '../lib/pushTokens';

/**
 * SECURITY CORRECTION: this client sends ONLY the minimal trigger context
 * (requestId, kind, event) to the send-request-push Edge Function — no
 * recipient list, no message title/body. Which user(s) get notified, and
 * with what content, is now derived ENTIRELY server-side by that function
 * from the caller's own verified auth token and the actual persisted
 * request row — never from anything this client claims. See
 * supabase/functions/send-request-push/index.ts's doc comment for the full
 * flow. Routing is now exclusively a server concern — the pure,
 * unit-tested routing/authorization rule the Edge Function's inline copy
 * mirrors is validateAndRoutePushEvent() in src/logic/pushRouting.ts.
 */
function notifyPushBestEffort(requestId: string, kind: 'swap' | 'timeChange', event: 'created' | 'approved' | 'rejected'): void {
  void sendRequestPush({ requestId, kind, event });
}

/** Best-effort: reload the schedule store (walks + notification reconciliation) after a request approval that mutated a walk server-side directly. Never throws — a failure here must not surface as a request-approval failure, since the approval itself already succeeded. */
async function reloadScheduleAndNotifications(): Promise<void> {
  const familyId = useAuthStore.getState().familyId;
  if (!familyId) return;
  try {
    await useScheduleStore.getState().load(familyId);
  } catch {
    /* best-effort */
  }
}

const DEMO_MODE_MESSAGE = 'בקשות החלפה ובקשות שינוי שעה זמינות רק כשהאפליקציה מחוברת ל-Supabase (לא במצב הדגמה מקומי).';

interface RequestsState {
  swapRequests: SwapRequestRow[];
  timeChangeRequests: TimeChangeRequestRow[];
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  createSwap: (walkId: string, targetWalkId: string) => Promise<void>;
  approveSwap: (requestId: string) => Promise<void>;
  rejectSwap: (requestId: string) => Promise<void>;
  createTimeChange: (walkId: string, proposedTime: string) => Promise<void>;
  approveTimeChange: (requestId: string) => Promise<void>;
  rejectTimeChange: (requestId: string) => Promise<void>;
  clearError: () => void;
}

/**
 * Maps a raw request-RPC rejection (create/approve/reject swap or
 * time-change — migrations/0005_requests_audit_presence.sql) to a friendly
 * Hebrew message. Mirrors LoginScreen's claimErrorMessage() pattern exactly
 * (see that file's doc comment): the RPC's error text is just whatever
 * `raise exception` said — not a stable, structured error code — so this is
 * a best-effort substring match, falling back to the previous generic
 * message for anything unrecognized. Part 2E requirement: duplicate/
 * conflict/stale-request rejections must surface a USEFUL Hebrew message,
 * not the raw English Postgres text.
 */
// Delegates to the centralized Hebrew error-message map (src/lib/errorMessages.ts,
// A5) — this store's rules used to be defined inline here; they now live in
// the shared table so other call sites (family role management, schedule
// mutations, etc.) can reuse the same mappings instead of re-inventing them.
import { friendlyErrorMessage } from '../lib/errorMessages';
function messageFor(error: unknown): string {
  return friendlyErrorMessage(error);
}

/**
 * Client-side state for the swap-request (Member -> Member) and time-change-
 * request (Member -> Admin) approval workflows added in migration 0005.
 * Deliberately talks straight to Supabase (via lib/requests.ts) rather than
 * through Repository/OfflineFirstRepository/SyncQueue — see requests.ts's
 * doc comment for why these approval-sensitive actions must require a live
 * connection rather than being queued as an offline "it'll apply later"
 * illusion. In local/demo mode every action here surfaces a clear message
 * instead of silently doing nothing.
 */
export const useRequestsStore = create<RequestsState>((set, get) => ({
  swapRequests: [],
  timeChangeRequests: [],
  loading: false,
  error: null,

  load: async () => {
    if (!isSupabaseConfigured) return;
    set({ loading: true, error: null });
    try {
      const [swapRequests, timeChangeRequests] = await Promise.all([listSwapRequests(), listTimeChangeRequests()]);
      set({ swapRequests, timeChangeRequests, loading: false });
    } catch (error) {
      // Dev-only diagnostic — never logged in a production build, and
      // deliberately not shown to the person beyond the friendly
      // messageFor() text already set below. Note that `swapRequests`/
      // `timeChangeRequests` are intentionally left untouched here (no
      // `set({ swapRequests: [], ... })`): a failed reload — e.g. this
      // device's own foreground/background reload racing a flaky
      // connection — must never blank out the last successfully loaded
      // request list out from under someone looking at it.
      if (process.env.NODE_ENV !== 'production') {
        console.error('Requests load failed:', error);
      }
      set({ loading: false, error: messageFor(error) });
    }
  },

  createSwap: async (walkId, targetWalkId) => {
    if (!guardTestModeMutation()) return;
    if (!isSupabaseConfigured) {
      set({ error: DEMO_MODE_MESSAGE });
      return;
    }
    try {
      const requestId = await createSwapRequest(walkId, targetWalkId);
      await get().load();
      notifyPushBestEffort(requestId, 'swap', 'created');
    } catch (error) {
      set({ error: messageFor(error) });
    }
  },

  approveSwap: async (requestId) => {
    if (!guardTestModeMutation()) return;
    try {
      await approveSwapRequest(requestId);
      await get().load();
      // An approved swap changes a concrete walk's responsible user
      // server-side directly (not through scheduleStore's own actions), so
      // that store's cached walk list — and any notification scheduled from
      // it — would otherwise go stale. Reload it so both reflect the new
      // occurrence (A3's authoritative rule).
      await reloadScheduleAndNotifications();
      notifyPushBestEffort(requestId, 'swap', 'approved');
    } catch (error) {
      set({ error: messageFor(error) });
    }
  },

  rejectSwap: async (requestId) => {
    if (!guardTestModeMutation()) return;
    try {
      await rejectSwapRequest(requestId);
      await get().load();
      notifyPushBestEffort(requestId, 'swap', 'rejected');
    } catch (error) {
      set({ error: messageFor(error) });
    }
  },

  createTimeChange: async (walkId, proposedTime) => {
    if (!guardTestModeMutation()) return;
    if (!isSupabaseConfigured) {
      set({ error: DEMO_MODE_MESSAGE });
      return;
    }
    try {
      const requestId = await createTimeChangeRequest(walkId, proposedTime);
      await get().load();
      notifyPushBestEffort(requestId, 'timeChange', 'created');
    } catch (error) {
      set({ error: messageFor(error) });
    }
  },

  approveTimeChange: async (requestId) => {
    if (!guardTestModeMutation()) return;
    try {
      await approveTimeChangeRequest(requestId);
      await get().load();
      // Same reasoning as approveSwap above: the walk's scheduledTime
      // changed server-side directly.
      await reloadScheduleAndNotifications();
      notifyPushBestEffort(requestId, 'timeChange', 'approved');
    } catch (error) {
      set({ error: messageFor(error) });
    }
  },

  rejectTimeChange: async (requestId) => {
    if (!guardTestModeMutation()) return;
    try {
      await rejectTimeChangeRequest(requestId);
      await get().load();
      notifyPushBestEffort(requestId, 'timeChange', 'rejected');
    } catch (error) {
      set({ error: messageFor(error) });
    }
  },

  clearError: () => set({ error: null }),
}));
