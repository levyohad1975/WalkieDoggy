import { canResumeFamilySetupDraft } from '../familySetupResume';

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
});
