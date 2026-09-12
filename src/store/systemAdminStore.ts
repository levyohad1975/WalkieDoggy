import { create } from 'zustand';
import { isSupabaseConfigured } from '../lib/supabase';
import { checkIsSystemAdmin } from '../lib/systemAdmin';

/**
 * BATCH 4 (item A — System Admin V1). Deliberately tiny and deliberately
 * SEPARATE from authStore: System Admin is a platform identity, not a
 * family membership/role — this store's `isSystemAdmin` answers "is the
 * underlying auth identity (auth.uid()) on the system_admins roster",
 * independent of `familyId`/`currentUserId`/`familyRole` entirely. App.tsx
 * refreshes this once auth is hydrated (i.e. once an anonymous Supabase
 * session is guaranteed to exist — see App.tsx's own comment), regardless
 * of whether this device has a family yet.
 *
 * UI HIDING IS NOT AUTHORIZATION: `isSystemAdmin` here only decides whether
 * to SHOW the "🛡️ ניהול מערכת" entry point. Every actual read (family list,
 * family detail) is re-authorized server-side by is_system_admin() inside
 * the RPCs themselves (migration 0029) — this client-side flag being wrong
 * or stale can never grant access to data it shouldn't.
 */
interface SystemAdminState {
  isSystemAdmin: boolean;
  checked: boolean;
  checking: boolean;
  refresh: (options?: { retryOnce?: boolean }) => Promise<void>;
  reset: () => void;
}

let refreshVersion = 0;

export const useSystemAdminStore = create<SystemAdminState>((set) => ({
  isSystemAdmin: false,
  checked: false,
  checking: false,

  refresh: async (options) => {
    const version = ++refreshVersion;
    if (!isSupabaseConfigured) {
      set({ isSystemAdmin: false, checked: true, checking: false });
      return;
    }

    set({ checking: true });
    const attempts = options?.retryOnce ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const result = await checkIsSystemAdmin();
        // A session-changing refresh supersedes any older anonymous-session
        // request that may still be in flight.
        if (version === refreshVersion) {
          set({ isSystemAdmin: result, checked: true, checking: false });
        }
        return;
      } catch {
        if (attempt + 1 < attempts) continue;
        if (version === refreshVersion) {
          // Fail closed after the bounded retry.
          set({ isSystemAdmin: false, checked: true, checking: false });
        }
      }
    }
  },

  reset: () => {
    refreshVersion += 1;
    set({ isSystemAdmin: false, checked: false, checking: false });
  },
}));
