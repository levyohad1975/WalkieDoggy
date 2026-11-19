/**
 * Release guard (incident 2026-11-09/10: a production deploy from a branch
 * that lacked 21 live fixes rolled them all back).
 */
const { decideRelease, RELEASE_BRANCH } = require('../release-guard');

const live = 'a'.repeat(40);
const next = 'b'.repeat(40);

describe('release guard', () => {
  it('never blocks preview or local builds', () => {
    expect(decideRelease({ vercelEnv: 'preview', ref: 'some/branch', sha: next }).ok).toBe(true);
    expect(decideRelease({ vercelEnv: undefined }).ok).toBe(true);
  });

  it('blocks a production build from any branch but the release branch', () => {
    const d = decideRelease({ vercelEnv: 'production', ref: 'fix/gps-resume-live-pee', sha: next, liveSha: live });
    expect(d.ok).toBe(false);
    expect(d.message).toContain(RELEASE_BRANCH);
  });

  it('blocks a production build that does not contain what is live, and lists what is missing', () => {
    for (const status of ['behind', 'diverged']) {
      const d = decideRelease({
        vercelEnv: 'production', ref: RELEASE_BRANCH, sha: next, liveSha: live,
        compare: { status, behind_by: 21, commits: ['0883710 fix(walk): share pee taps live'] },
      });
      expect(d.ok).toBe(false);
      expect(d.message).toContain('BLOCKED');
      expect(d.message).toContain('share pee taps live');
    }
  });

  it('passes a production build that contains what is live', () => {
    expect(decideRelease({ vercelEnv: 'production', ref: RELEASE_BRANCH, sha: next, liveSha: live, compare: { status: 'ahead' } }).ok).toBe(true);
    expect(decideRelease({ vercelEnv: 'production', ref: RELEASE_BRANCH, sha: live, liveSha: live }).ok).toBe(true);
  });

  it('does not take the site hostage when the live version or GitHub cannot be read', () => {
    expect(decideRelease({ vercelEnv: 'production', ref: RELEASE_BRANCH, sha: next, liveSha: null }).ok).toBe(true);
    expect(decideRelease({ vercelEnv: 'production', ref: RELEASE_BRANCH, sha: next, liveSha: live, compare: null }).ok).toBe(true);
  });

  it('an explicit override skips the checks for one deployment', () => {
    expect(decideRelease({ vercelEnv: 'production', ref: 'other', sha: next, override: true }).ok).toBe(true);
  });
});
