import { HELP_CATEGORIES, normalizeHelpText, searchHelp } from '../helpCenter';

describe('Help & Support content', () => {
  it('has unique ids and non-empty questions and answers', () => {
    const ids = HELP_CATEGORIES.flatMap((c) => c.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const category of HELP_CATEGORIES) {
      expect(category.items.length).toBeGreaterThan(0);
      for (const item of category.items) {
        expect(item.question.trim().length).toBeGreaterThan(5);
        expect(item.answer.trim().length).toBeGreaterThan(20);
      }
    }
  });

  it('stays small and text-only (no media, no links to fetch)', () => {
    const source: string = require('fs').readFileSync(require.resolve('../helpCenter'), 'utf8');
    expect(source.length).toBeLessThan(20_000);
    expect(source).not.toMatch(/\.(mp4|webm|png|jpe?g|gif|webp)\b/i);
    expect(source).not.toMatch(/https?:\/\//);
    expect(source).not.toMatch(/[🐶🐕🦮🐩🐾🦴]/u);
  });
});

describe('searchHelp', () => {
  it('ignores geresh/gershayim differences', () => {
    expect(normalizeHelpText('צ׳אט')).toBe(normalizeHelpText("צ'אט"));
    expect(normalizeHelpText('לו״ז')).toBe(normalizeHelpText('לו"ז'));
  });

  it('finds by a word in the question, the answer, or the keywords', () => {
    expect(searchHelp('החלפה').map((r) => r.item.id)).toContain('swap');
    expect(searchHelp('פוש').map((r) => r.item.id)).toContain('not-arriving');
    expect(searchHelp('safari').map((r) => r.item.id)).toContain('install');
  });

  it('requires every word and ranks question matches first', () => {
    const ids = searchHelp('התראות לא מגיעות').map((r) => r.item.id);
    expect(ids[0]).toBe('not-arriving');
    expect(searchHelp('זברה')).toEqual([]);
    expect(searchHelp('   ')).toEqual([]);
  });
});
