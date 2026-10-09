import { useEffect } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useAuthStore } from '../store/authStore';
import { useChatStore } from '../store/chatStore';
import { DEMO_FAMILY } from '../data/demoData';

/**
 * Owns the Family Chat session for as long as the signed-in navigator is
 * mounted, so the unread badge is live on every tab — not only while the
 * chat screen is open.
 *
 * The session is keyed by family + real profile (+ whether the admin is
 * impersonating, which changes what the server allows). Whenever any of
 * those change — switching family, switching profile, signing out, entering
 * the System Admin observer — the effect cleanup stops the previous session
 * (releasing its Realtime channel and discarding its messages) before a new
 * one starts. Nothing from one family can outlive a switch to another.
 */
export function useChatSession(): void {
  const familyId = useAuthStore((s) => s.familyId) ?? DEMO_FAMILY.id;
  const currentUserId = useAuthStore((s) => s.currentUserId);
  const impersonatingUserId = useAuthStore((s) => s.impersonatingUserId);
  const systemObserverActive = useAuthStore((s) => s.systemObserverActive);

  useEffect(() => {
    // A System Admin observer has no access to a family's conversation
    // (enforced server-side); do not even ask.
    if (!currentUserId || systemObserverActive) return undefined;
    const store = useChatStore.getState();
    void store.start(`${familyId}:${currentUserId}:${impersonatingUserId ? 'impersonating' : 'self'}`);
    return () => useChatStore.getState().stop();
  }, [familyId, currentUserId, impersonatingUserId, systemObserverActive]);

  useEffect(() => {
    let removeNetInfo: (() => void) | undefined;
    try {
      removeNetInfo = NetInfo.addEventListener((state) => {
        // `isInternetReachable` is null until first probed: treat only an
        // explicit `false` as offline.
        useChatStore.getState().setOnline(state.isConnected !== false && state.isInternetReachable !== false);
      });
    } catch {
      // Connectivity detection unavailable: stay optimistic; failed sends
      // still surface as retryable bubbles.
    }
    const appState = AppState.addEventListener('change', (state) => {
      // Realtime sockets are suspended in the background. On return, re-read
      // the latest page and the unread counter, and flush anything unsent.
      if (state === 'active') void useChatStore.getState().resync();
    });
    return () => {
      removeNetInfo?.();
      appState.remove();
    };
  }, []);
}
