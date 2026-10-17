import { resolveAutoOfferSince, resolveTutorialSource, sanitizeTutorialUrl } from '../tutorialConfig';

describe('sanitizeTutorialUrl', () => {
  it('accepts https URLs and same-origin absolute paths', () => {
    expect(sanitizeTutorialUrl('https://cdn.example.com/t.mp4')).toBe('https://cdn.example.com/t.mp4');
    expect(sanitizeTutorialUrl('  /tutorial/t.mp4 ')).toBe('/tutorial/t.mp4');
  });

  it('treats blank, insecure, protocol-relative and script URLs as not configured', () => {
    for (const value of [undefined, null, '', '   ', 'http://x.example/t.mp4', '//x.example/t.mp4', 'javascript:alert(1)', 'data:video/mp4;base64,AA', 'tutorial.mp4']) {
      expect(sanitizeTutorialUrl(value as string | undefined)).toBeNull();
    }
  });
});

describe('resolveTutorialSource', () => {
  it('returns no video when nothing is configured (never invents a URL)', () => {
    expect(resolveTutorialSource('admin', {})).toEqual({ role: 'admin', videoUrl: null, captionsUrl: null, posterUrl: null });
  });

  it('uses role-specific cuts for creators/admins and members', () => {
    const env = {
      videoUrl: 'https://v.example/generic.mp4',
      videoUrlAdmin: 'https://v.example/admin.mp4',
      videoUrlMember: 'https://v.example/member.mp4',
      captionsUrlAdmin: 'https://v.example/admin.vtt',
      captionsUrlMember: 'https://v.example/member.vtt',
      captionsUrl: 'https://v.example/generic.vtt',
    };
    expect(resolveTutorialSource('admin', env)).toMatchObject({ role: 'admin', videoUrl: 'https://v.example/admin.mp4', captionsUrl: 'https://v.example/admin.vtt' });
    expect(resolveTutorialSource('member', env)).toMatchObject({ role: 'member', videoUrl: 'https://v.example/member.mp4', captionsUrl: 'https://v.example/member.vtt' });
  });

  it('falls back to the generic video with the generic captions track', () => {
    const env = { videoUrl: '/tutorial/all.mp4', captionsUrl: '/tutorial/all.he.vtt', captionsUrlAdmin: '/tutorial/admin.vtt' };
    expect(resolveTutorialSource('admin', env)).toMatchObject({ videoUrl: '/tutorial/all.mp4', captionsUrl: '/tutorial/all.he.vtt' });
  });

  it('treats an unknown role as member', () => {
    expect(resolveTutorialSource(null, { videoUrlMember: '/m.mp4' }).role).toBe('member');
    expect(resolveTutorialSource(null, { videoUrlMember: '/m.mp4' }).videoUrl).toBe('/m.mp4');
  });
});

describe('resolveAutoOfferSince', () => {
  it('parses an ISO cutoff and ignores blank/invalid values', () => {
    expect(resolveAutoOfferSince({ autoOfferSince: '2026-11-01T00:00:00Z' })).toBe(Date.parse('2026-11-01T00:00:00Z'));
    expect(resolveAutoOfferSince({ autoOfferSince: '' })).toBeNull();
    expect(resolveAutoOfferSince({ autoOfferSince: 'soon' })).toBeNull();
    expect(resolveAutoOfferSince({})).toBeNull();
  });
});
