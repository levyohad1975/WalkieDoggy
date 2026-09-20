import { generateId } from '../id';

describe('generateId', () => {
  it('generates a UUID v4 compatible identifier when called with no prefix argument', () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('never includes the prefix argument in the returned value', () => {
    const id = generateId('walk');
    expect(id).not.toContain('walk');
  });

  it('generates unique values across calls', () => {
    expect(generateId()).not.toBe(generateId());
  });
});
