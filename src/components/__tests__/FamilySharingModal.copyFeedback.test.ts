import fs from 'fs';
import path from 'path';

/**
 * BATCH 4 (item E — Copy Family Code). Verifies the clear visual
 * success/failure feedback and the manual-copy fallback exist, via source
 * read (no RN component-rendering test infra in this repo).
 */
describe('FamilySharingModal — copy feedback + manual-copy fallback', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../FamilySharingModal.tsx'), 'utf8');

  it('shows "✓ הועתק" on success and a clear failure message (with a manual-copy hint) on error, never silently failing', () => {
    expect(source).toMatch(/copyFeedback === 'success' \? '✓ הועתק' : '⚠ ההעתקה נכשלה — ניתן להעתיק ידנית מהקוד למעלה'/);
  });

  it('the invite code text itself is selectable — a working manual-copy path independent of the Clipboard API', () => {
    expect(source).toMatch(/<RtlText style=\{\[styles\.codeText, styles\.ltrText\]\} selectable>/);
  });

  it('feedback is opt-in per render (idle shows nothing) and defaults to idle when the caller passes nothing', () => {
    expect(source).toMatch(/copyFeedback = 'idle'/);
    expect(source).toMatch(/\{copyFeedback !== 'idle' \? \(/);
  });
});
