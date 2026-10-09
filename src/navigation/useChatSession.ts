import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
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
    let removeConnectivity: (() => void) | undefined;
    const setOnline = (online: boolean) => useChatStore.getState().setOnline(online);
    if (Platform.OS === 'web') {
      // The browser's own signal. NetInfo's web build listens only to the
      // Network Information API where it exists (Chrome/Android), which does
      // not reliably report going offline, and falls back to these same
      // events elsewhere (Safari) — so use them directly on every browser.
      if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
        const sync = () => setOnline(navigator.onLine !== false);
        sync();
        window.addEventListener('online', sync);
        window.addEventListener('offline', sync);
        removeConnectivity = () => {
          window.removeEventListener('online', sync);
          window.removeEventListener('offline', sync);
        };
      }
    } else {
      try {
        removeConnectivity = NetInfo.addEventListener((state) => {
          // `isInternetReachable` is null until first probed: treat only an
          // explicit `false` as offline.
          setOnline(state.isConnected !== false && state.isInternetReachable !== false);
        });
      } catch {
        // Connectivity detection unavailable: stay optimistic; failed sends
        // still surface as retryable bubbles.
      }
    }
    const appState = AppState.addEventListener('change', (state) => {
      // Realtime sockets are suspended in the background. On return, re-read
      // the latest page and the unread counter, and flush anything unsent.
      if (state === 'active') void useChatStore.getState().resync();
    });
    return () => {
      removeConnectivity?.();
      appState.remove();
    };
  }, []);
}
