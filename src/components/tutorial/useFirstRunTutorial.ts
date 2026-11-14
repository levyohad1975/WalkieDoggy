import { useEffect } from 'react';
import { Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useAuthStore } from '../../store/authStore';
import { useFamilyStore } from '../../store/familyStore';
import { useTutorialStore } from '../../store/tutorialStore';
import { resolveAutoOfferSince, resolveTutorialSource } from '../../lib/tutorialConfig';
import { readTutorialRecord } from '../../lib/tutorialProgress';
import { evaluateTutorialGate, tutorialContextKey } from '../../logic/tutorialGate';

export async function isLikelyOnline(platformOS: string = Platform.OS): Promise<boolean> {
  if (platformOS === 'web') {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  }
  try {
    const state = await NetInfo.fetch();
    return state.isConnected !== false && state.isInternetReachable !== false;
  } catch {
    return false;
  }
}

/**
 * Evaluates the automatic first-run invitation for the signed-in
 * (family, profile) and opens the overlay when every rule in
 * logic/tutorialGate.ts allows it. Also closes the overlay immediately when
 * the context changes (logout, profile switch, joining another family).
 *
 * Read-only with respect to authentication, family data and the offline queue.
 */
export function useFirstRunTutorial({ familySetupWizardVisible, competingOverlayVisible, platformOS = Platform.OS }: {
  familySetupWizardVisible: boolean;
  competingOverlayVisible: boolean;
  /** Test seam; defaults to Platform.OS. Only web has a video player today. */
  platformOS?: string;
}): void {
  const familyId = useAuthStore((s) => s.familyId);
  const currentUserId = useAuthStore((s) => s.currentUserId);
  const familyRole = useAuthStore((s) => s.familyRole);
  const systemObserverActive = useAuthStore((s) => s.systemObserverActive);
  const impersonatingUserId = useAuthStore((s) => s.impersonatingUserId);
  const testModeUserId = useAuthStore((s) => s.testModeUserId);
  const loadedFamilyId = useFamilyStore((s) => s.family?.id ?? null);
  const users = useFamilyStore((s) => s.users);
  const handledKeys = useTutorialStore((s) => s.handledKeys);

  useEffect(() => {
    useTutorialStore.getState().syncContext(familyId, currentUserId);
  }, [familyId, currentUserId]);

  const profile = currentUserId ? users.find((u) => u.id === currentUserId && u.familyId === familyId) : undefined;
  const key = tutorialContextKey(familyId, currentUserId);
  const handledThisSession = key ? Boolean(handledKeys[key]) : false;

  useEffect(() => {
    const report = useTutorialStore.getState().setGateReason;
    if (!familyId || !currentUserId) { report('no_profile'); return; }
    // Already offered/decided this session: keep the reason that led here.
    if (handledThisSession) return;
    // Wait for the verified role so admins never receive the member cut.
    if (!familyRole) { report('role_unknown'); return; }
    let cancelled = false;
    void (async () => {
      const source = resolveTutorialSource(familyRole);
      const base = {
        videoConfigured: Boolean(source.videoUrl) && platformOS === 'web',
        familyId,
        profileId: currentUserId,
        loadedFamilyId,
        profileCreatedAt: profile?.createdAt,
        profileInLoadedFamily: Boolean(profile),
        systemObserverActive,
        impersonating: Boolean(impersonatingUserId),
        testMode: Boolean(testModeUserId),
        familySetupWizardVisible,
        competingOverlayVisible,
        autoOfferSinceMs: resolveAutoOfferSince(),
        handledThisSession: false,
      };
      // Cheap synchronous rules first, so storage/network are only touched
      // when an invitation is actually possible.
      const pre = evaluateTutorialGate({ ...base, online: true, stored: { ok: true, record: null } });
      if (pre !== 'offer') { report(pre); return; }
      const stored = await readTutorialRecord(familyId, currentUserId);
      const online = await isLikelyOnline(platformOS);
      if (cancelled) return;
      const decision = evaluateTutorialGate({ ...base, online, stored });
      report(decision);
      if (decision !== 'offer') return;
      const auth = useAuthStore.getState();
      // Context may have changed while awaiting storage/network.
      if (auth.familyId !== familyId || auth.currentUserId !== currentUserId) return;
      useTutorialStore.getState().offerFirstRun({ familyId, profileId: currentUserId, role: familyRole === 'admin' ? 'admin' : 'member' });
    })();
    return () => { cancelled = true; };
  }, [
    familyId,
    currentUserId,
    familyRole,
    loadedFamilyId,
    profile,
    systemObserverActive,
    impersonatingUserId,
    testModeUserId,
    familySetupWizardVisible,
    competingOverlayVisible,
    handledThisSession,
    platformOS,
  ]);
}

/** Opens the tutorial player from Help (Settings / Family). */
export function openTutorialFromHelp(): boolean {
  const { familyId, currentUserId, familyRole } = useAuthStore.getState();
  if (!familyId || !currentUserId) return false;
  useTutorialStore.getState().openFromHelp({ familyId, profileId: currentUserId, role: familyRole === 'admin' ? 'admin' : 'member' });
  return true;
}
