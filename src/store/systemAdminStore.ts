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
  refresh: () => Promise<void>;
  reset: () => void;
}

export const useSystemAdminStore = create<SystemAdminState>((set, get) => ({
  isSystemAdmin: false,
  checked: false,
  checking: false,

  refresh: async () => {
    if (!isSupabaseConfigured) {
      // System Admin has no meaning in local/demo mode — never shown there.
      set({ isSystemAdmin: false, checked: true, checking: false });
      return;
    }
    if (get().checking) return;
    set({ checking: true });
    try {
      const result = await checkIsSystemAdmin();
      set({ isSystemAdmin: result, checked: true, checking: false });
    } catch {
      // Best-effort — a failed check must never crash app startup; simply
      // don't show the entry point for this session (fails closed).
      set({ isSystemAdmin: false, checked: true, checking: false });
    }
  },

  reset: () => set({ isSystemAdmin: false, checked: false, checking: false }),
}));
