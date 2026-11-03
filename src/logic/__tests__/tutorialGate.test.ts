import { evaluateTutorialGate, shouldAutoOfferTutorial, tutorialContextKey, type TutorialGateInput } from '../tutorialGate';
import { TUTORIAL_MAX_AUTO_OFFERS } from '../../lib/tutorialProgress';

function input(overrides: Partial<TutorialGateInput> = {}): TutorialGateInput {
  return {
    videoConfigured: true,
    familyId: 'fam-1',
    profileId: 'user-1',
    loadedFamilyId: 'fam-1',
    profileCreatedAt: '2026-11-02T08:00:00Z',
    profileInLoadedFamily: true,
    systemObserverActive: false,
    impersonating: false,
    testMode: false,
    familySetupWizardVisible: false,
    competingOverlayVisible: false,
    online: true,
    autoOfferSinceMs: null,
    stored: { ok: true, record: null },
    handledThisSession: false,
    ...overrides,
  };
}

describe('evaluateTutorialGate — first-run presentation', () => {
  it('offers to a new, claimed profile with a configured video', () => {
    expect(evaluateTutorialGate(input())).toBe('offer');
    expect(shouldAutoOfferTutorial(input())).toBe(true);
  });

  it('never offers before a profile is entered (verification/onboarding stay uninterrupted)', () => {
    expect(evaluateTutorialGate(input({ profileId: null }))).toBe('no_profile');
    expect(evaluateTutorialGate(input({ familyId: null }))).toBe('no_profile');
  });

  it('waits while the family setup wizard is visible', () => {
    expect(evaluateTutorialGate(input({ familySetupWizardVisible: true }))).toBe('setup_in_progress');
  });

  it('never stacks on another first-run overlay (iOS install prompt)', () => {
    expect(evaluateTutorialGate(input({ competingOverlayVisible: true }))).toBe('competing_overlay');
  });

  it('does not invite when no video is configured', () => {
    expect(evaluateTutorialGate(input({ videoConfigured: false }))).toBe('no_video');
  });

  it('excludes observer, impersonation and Test Mode sessions', () => {
    expect(evaluateTutorialGate(input({ systemObserverActive: true }))).toBe('observer_or_impersonation');
    expect(evaluateTutorialGate(input({ impersonating: true }))).toBe('observer_or_impersonation');
    expect(evaluateTutorialGate(input({ testMode: true }))).toBe('observer_or_impersonation');
  });
});

describe('evaluateTutorialGate — persistence and repeat protection', () => {
  it('does not replay after a skip or a completion', () => {
    expect(evaluateTutorialGate(input({ stored: { ok: true, record: { decision: 'dismissed', offers: 1, updatedAt: '' } } }))).toBe('already_decided');
    expect(evaluateTutorialGate(input({ stored: { ok: true, record: { decision: 'completed', offers: 0, updatedAt: '' } } }))).toBe('already_decided');
  });

  it('stops after the unanswered-offer cap', () => {
    const stored = { ok: true as const, record: { decision: null, offers: TUTORIAL_MAX_AUTO_OFFERS, updatedAt: '' } };
    expect(evaluateTutorialGate(input({ stored }))).toBe('offer_cap_reached');
    const below = { ok: true as const, record: { decision: null, offers: TUTORIAL_MAX_AUTO_OFFERS - 1, updatedAt: '' } };
    expect(evaluateTutorialGate(input({ stored: below }))).toBe('offer');
  });

  it('fails closed when storage cannot be read', () => {
    expect(evaluateTutorialGate(input({ stored: { ok: false } }))).toBe('storage_unknown');
    expect(evaluateTutorialGate(input({ stored: null }))).toBe('storage_unknown');
  });

  it('does not re-offer within the same session', () => {
    expect(evaluateTutorialGate(input({ handledThisSession: true }))).toBe('handled_this_session');
  });

  it('defers while offline', () => {
    expect(evaluateTutorialGate(input({ online: false }))).toBe('offline');
  });
});

describe('evaluateTutorialGate — family and profile switching', () => {
  it('waits until the active family member list is loaded', () => {
    expect(evaluateTutorialGate(input({ loadedFamilyId: null }))).toBe('family_not_loaded');
    expect(evaluateTutorialGate(input({ loadedFamilyId: 'fam-old' }))).toBe('family_not_loaded');
    expect(evaluateTutorialGate(input({ profileInLoadedFamily: false }))).toBe('family_not_loaded');
  });

  it('gives each (family, profile) context its own key', () => {
    expect(tutorialContextKey('fam-1', 'user-1')).toBe('fam-1:user-1');
    expect(tutorialContextKey('fam-2', 'user-1')).not.toBe(tutorialContextKey('fam-1', 'user-1'));
    expect(tutorialContextKey('fam-1', 'user-2')).not.toBe(tutorialContextKey('fam-1', 'user-1'));
    expect(tutorialContextKey(null, 'user-1')).toBeNull();
    expect(tutorialContextKey('fam-1', null)).toBeNull();
  });
});

describe('evaluateTutorialGate — rollout cutoff', () => {
  const cutoff = Date.parse('2026-11-01T00:00:00Z');

  it('offers only to profiles created on/after the cutoff', () => {
    expect(evaluateTutorialGate(input({ autoOfferSinceMs: cutoff, profileCreatedAt: '2026-11-01T00:00:00Z' }))).toBe('offer');
    expect(evaluateTutorialGate(input({ autoOfferSinceMs: cutoff, profileCreatedAt: '2026-06-01T00:00:00Z' }))).toBe('before_rollout');
  });

  it('does not interrupt when creation time is unknown and a cutoff is active', () => {
    expect(evaluateTutorialGate(input({ autoOfferSinceMs: cutoff, profileCreatedAt: undefined }))).toBe('before_rollout');
    expect(evaluateTutorialGate(input({ autoOfferSinceMs: cutoff, profileCreatedAt: 'garbage' }))).toBe('before_rollout');
  });
});
