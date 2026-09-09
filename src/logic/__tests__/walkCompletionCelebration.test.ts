import { selectWalkCompletionCelebration } from '../walkCompletionCelebration';

describe('selectWalkCompletionCelebration', () => {
  it('uses a gentle night-time reaction for late walks', () => {
    expect(selectWalkCompletionCelebration(new Date(2026, 8, 9, 22, 15)).reaction).toBe('sleepy');
  });

  it('selects daytime reactions from a stable random input', () => {
    expect(selectWalkCompletionCelebration(new Date(2026, 8, 9, 13), () => 0).reaction).toBe('heart');
    expect(selectWalkCompletionCelebration(new Date(2026, 8, 9, 13), () => 0.99).reaction).toBe('trophy');
  });
});
