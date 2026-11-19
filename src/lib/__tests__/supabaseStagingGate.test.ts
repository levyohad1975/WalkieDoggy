import { isAuthorizedWalkResolutionStagingUrl, isStagingDuplicateResolutionEnabled } from '../supabase';

describe('duplicate resolution Staging target gate', () => {
  it('accepts only HTTPS on the exact approved Supabase project host', () => {
    expect(isAuthorizedWalkResolutionStagingUrl('https://czbxhsoxyawprqehkfit.supabase.co')).toBe(true);
    expect(isAuthorizedWalkResolutionStagingUrl('https://czbxhsoxyawprqehkfit.supabase.co/')).toBe(true);
    expect(isAuthorizedWalkResolutionStagingUrl('http://czbxhsoxyawprqehkfit.supabase.co')).toBe(false);
    expect(isAuthorizedWalkResolutionStagingUrl('https://czbxhsoxyawprqehkfit.supabase.co.attacker.example')).toBe(false);
    expect(isAuthorizedWalkResolutionStagingUrl('https://other.supabase.co')).toBe(false);
    expect(isAuthorizedWalkResolutionStagingUrl('https://user@czbxhsoxyawprqehkfit.supabase.co')).toBe(false);
    expect(isAuthorizedWalkResolutionStagingUrl('not a url')).toBe(false);
  });

  it('also requires the explicit Staging-only opt-in; a matching URL alone is insufficient', () => {
    const url = 'https://czbxhsoxyawprqehkfit.supabase.co';
    expect(isStagingDuplicateResolutionEnabled(url, 'true')).toBe(true);
    expect(isStagingDuplicateResolutionEnabled(url, undefined)).toBe(false);
    expect(isStagingDuplicateResolutionEnabled(url, 'false')).toBe(false);
    expect(isStagingDuplicateResolutionEnabled('https://production.supabase.co', 'true')).toBe(false);
  });
});
