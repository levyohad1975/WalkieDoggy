import { buildJoinLinkText, parseJoinInput } from '../familyJoinCode';

/**
 * Family Lifecycle repair, item 6 — the general family-wide sharing code
 * gets the same "real HTTPS link first, manual code as fallback" treatment
 * logic/familyInvites.ts already gives the personal invite, but on its own
 * `join` query param so the two mechanisms never collide or get mistaken
 * for one another (see this file's own doc comment).
 */
describe('buildJoinLinkText', () => {
  it('without an origin, falls back to the bare code', () => {
    expect(buildJoinLinkText('ABC123')).toBe('ABC123');
    expect(buildJoinLinkText('ABC123', null)).toBe('ABC123');
  });

  it('with a web origin, builds a real clickable HTTPS join URL carrying only the code', () => {
    expect(buildJoinLinkText('ABC123', 'https://walkie-doggy-staging.vercel.app')).toBe(
      'https://walkie-doggy-staging.vercel.app/?join=ABC123'
    );
  });

  it('percent-encodes the code in the HTTPS form', () => {
    expect(buildJoinLinkText('A B&C', 'https://example.com')).toBe('https://example.com/?join=A%20B%26C');
  });

  it('never uses the `invite` query param — the two mechanisms must stay distinguishable', () => {
    const link = buildJoinLinkText('ABC123', 'https://example.com');
    expect(link).not.toContain('invite=');
    expect(link).toContain('join=');
  });
});

describe('parseJoinInput', () => {
  it('returns a bare pasted code unchanged (trimmed)', () => {
    expect(parseJoinInput('  ABC123  ')).toBe('ABC123');
  });

  it('extracts the code from a full HTTPS join URL', () => {
    expect(parseJoinInput('https://walkie-doggy-staging.vercel.app/?join=ABC123')).toBe('ABC123');
  });

  it('extracts the code when the whole share message is pasted', () => {
    expect(
      parseJoinInput(`הצטרפו למשפחה שלנו באפליקציית Walkie Doggy!

https://walkie-doggy-staging.vercel.app/?join=ABC123`)
    ).toBe('ABC123');
  });

  it('decodes a percent-encoded code from the query string', () => {
    expect(parseJoinInput('https://example.com/?join=A%20B%26C')).toBe('A B&C');
  });

  it('returns null for empty/whitespace-only input', () => {
    expect(parseJoinInput('')).toBeNull();
    expect(parseJoinInput('   ')).toBeNull();
  });

  it('never matches an `invite=` query param as if it were a join code', () => {
    expect(parseJoinInput('https://example.com/?invite=some-personal-invite-token')).toBe(
      'https://example.com/?invite=some-personal-invite-token'
    );
  });

  it('round-trips through buildJoinLinkText -> parseJoinInput back to the original code', () => {
    const code = 'XYZ789';
    const link = buildJoinLinkText(code, 'https://walkie-doggy-staging.vercel.app');
    expect(parseJoinInput(link)).toBe(code);
  });
});
