import { canResumeFamilySetupDraft, canShowFamilySetupWizard } from '../familySetupResume';

describe('family setup draft resume authorization', () => {
  it('does not restore a dormant QA draft while the server has returned to the original family', () => {
    expect(canResumeFamilySetupDraft('qa-family', 'original-family')).toBe(false);
  });

  it('resumes the draft after the server-authorized test-family switch', () => {
    expect(canResumeFamilySetupDraft('qa-family', 'qa-family')).toBe(true);
  });

  it('does not infer authorization when server family context is unknown', () => {
    expect(canResumeFamilySetupDraft('qa-family', null)).toBe(false);
  });

  it('does not render a stale QA wizard when both the local id and draft match but whoami confirms the original family', () => {
    expect(canShowFamilySetupWizard({
      progressFamilyId: 'qa-family',
      localFamilyId: 'qa-family',
      serverConfirmedFamilyId: 'original-family',
      ownerMatches: true,
      familyRole: 'admin',
    })).toBe(false);
  });

  it('fails closed if server confirmation is unavailable during refresh', () => {
    expect(canShowFamilySetupWizard({
      progressFamilyId: 'qa-family',
      localFamilyId: 'qa-family',
      serverConfirmedFamilyId: null,
      ownerMatches: true,
      familyRole: 'admin',
    })).toBe(false);
  });

  it('resumes only after the existing test-family switch is confirmed by the server', () => {
    expect(canShowFamilySetupWizard({
      progressFamilyId: 'qa-family',
      localFamilyId: 'qa-family',
      serverConfirmedFamilyId: 'qa-family',
      ownerMatches: true,
      familyRole: 'admin',
    })).toBe(true);
  });
});
