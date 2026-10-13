/**
 * Isolated coverage for `selectMessage()`'s zero-candidates fallback branch
 * (messageEngine.ts line ~158). The real MESSAGE_LIBRARY always has variants
 * for every category (see messageLibrary.test.ts / messageEngine.test.ts),
 * so this branch is unreachable through the real library — it only exists as
 * a config-drift guard for a future category/library mismatch. Exercising it
 * for real requires faking an empty library, which would corrupt the shared
 * `messageEngine.test.ts` suite's other (non-mocked) assertions if done in
 * the same file — hence a dedicated file with its own `jest.mock`.
 */
jest.mock('../messageLibrary', () => ({
  MESSAGE_LIBRARY: [] as unknown[],
}));

import { selectMessage, createAntiRepetitionHistory } from '../messageEngine';

describe('mascot/messageEngine — selectMessage zero-candidates fallback', () => {
  it('returns a stable id and a rendered, grammatical fallback message when no template matches the category', () => {
    const history = createAntiRepetitionHistory();
    const picked = selectMessage('excited', { dogName: 'רקסי' }, { history });
    expect(picked.id).toBe('excited:fallback');
    expect(picked.text).toBe('רקסי מחכה לטיול הבא.');
  });

  it('the fallback text still resolves the {dogName} placeholder to the safe default when no dog name is given', () => {
    const picked = selectMessage('morning', {}, { history: createAntiRepetitionHistory() });
    expect(picked.id).toBe('morning:fallback');
    expect(picked.text).toBe('הכלב או הכלבה שלכם מחכה לטיול הבא.');
  });
});

/**
 * Separate describe block, same file: a distinct mocked MESSAGE_LIBRARY
 * shape (one template restricted to a preset the caller isn't using) to
 * cover the `m.presets.includes(preset)` arm of selectMessage()'s category
 * filter — unreachable with the real library, since every real template
 * today declares no `presets` field at all (see messageEngine.test.ts's own
 * "every template in this batch is preset-agnostic" comment).
 */
describe('mascot/messageEngine — selectMessage category filter, presets mismatch', () => {
  it('excludes a template whose presets list does not include the active preset, falling back like an empty category', () => {
    jest.resetModules();
    jest.doMock('../messageLibrary', () => ({
      MESSAGE_LIBRARY: [
        { id: 'excited:other-preset-only', category: 'excited', presets: ['calm'], text: '{dogName} מוכן.' },
      ],
    }));
    const { selectMessage: selectMessageWithMock, createAntiRepetitionHistory: createHistoryWithMock } =
      require('../messageEngine');
    const picked = selectMessageWithMock(
      'excited',
      { dogName: 'רקסי' },
      { history: createHistoryWithMock(), preset: 'default' }
    );
    expect(picked.id).toBe('excited:fallback');
    expect(picked.text).toBe('רקסי מחכה לטיול הבא.');
  });
});
