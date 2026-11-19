/**
 * Pure decision: should the automatic first-run tutorial invitation be
 * shown right now? Framework-agnostic so it can be unit-tested directly.
 *
 * Every branch fails closed (no invitation) when something is unknown —
 * the tutorial is optional and always reachable from Help, so missing an
 * invitation is cheap while a repeated or mistimed one is not.
 */

import type { TutorialReadResult } from '../lib/tutorialProgress';
import { TUTORIAL_MAX_AUTO_OFFERS } from '../lib/tutorialProgress';

export interface TutorialGateInput {
  /** A playable video is configured for this viewer's role. */
  videoConfigured: boolean;
  familyId: string | null;
  /** The real claimed profile (never an impersonated/test-mode id). */
  profileId: string | null;
  /** Id of the family whose member list is currently loaded, if any. */
  loadedFamilyId: string | null;
  /** createdAt of the claimed profile, from the loaded member list. */
  profileCreatedAt: string | null | undefined;
  /** False when the claimed profile is not in the loaded family list. */
  profileInLoadedFamily: boolean;
  systemObserverActive: boolean;
  impersonating: boolean;
  testMode: boolean;
  familySetupWizardVisible: boolean;
  /** Another first-run overlay (e.g. the iOS install prompt) is showing. */
  competingOverlayVisible: boolean;
  online: boolean;
  /** Optional rollout cutoff (epoch ms). */
  autoOfferSinceMs: number | null;
  stored: TutorialReadResult | null;
  /** This (family, profile) was already offered/decided in this app session. */
  handledThisSession: boolean;
}

export type TutorialGateReason =
  | 'offer'
  | 'no_video'
  | 'no_profile'
  | 'family_not_loaded'
  | 'observer_or_impersonation'
  | 'setup_in_progress'
  | 'competing_overlay'
  | 'offline'
  | 'before_rollout'
  | 'storage_unknown'
  | 'already_decided'
  | 'offer_cap_reached'
  | 'handled_this_session';

export function evaluateTutorialGate(input: TutorialGateInput): TutorialGateReason {
  if (!input.videoConfigured) return 'no_video';
  if (!input.familyId || !input.profileId) return 'no_profile';
  if (input.systemObserverActive || input.impersonating || input.testMode) return 'observer_or_impersonation';
  if (input.familySetupWizardVisible) return 'setup_in_progress';
  if (input.loadedFamilyId !== input.familyId || !input.profileInLoadedFamily) return 'family_not_loaded';
  if (input.handledThisSession) return 'handled_this_session';
  if (input.competingOverlayVisible) return 'competing_overlay';
  if (input.autoOfferSinceMs !== null) {
    const created = input.profileCreatedAt ? Date.parse(input.profileCreatedAt) : NaN;
    // Unknown creation time + an active cutoff: do not interrupt.
    if (!Number.isFinite(created) || created < input.autoOfferSinceMs) return 'before_rollout';
  }
  if (!input.stored || !input.stored.ok) return 'storage_unknown';
  const record = input.stored.record;
  if (record?.decision) return 'already_decided';
  if ((record?.offers ?? 0) >= TUTORIAL_MAX_AUTO_OFFERS) return 'offer_cap_reached';
  if (!input.online) return 'offline';
  return 'offer';
}

export function shouldAutoOfferTutorial(input: TutorialGateInput): boolean {
  return evaluateTutorialGate(input) === 'offer';
}

/** Stable per-context key used to reset the overlay on logout/switch/join. */
export function tutorialContextKey(familyId: string | null, profileId: string | null): string | null {
  return familyId && profileId ? `${familyId}:${profileId}` : null;
}
