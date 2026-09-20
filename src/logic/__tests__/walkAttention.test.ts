import { isWalkRequiringAttention, ATTENTION_MINUTES_AFTER } from '../walkAttention';
import type { Walk } from '../../types';

function makeWalk(overrides: Partial<Walk> = {}): Pick<Walk, 'status' | 'date' | 'scheduledTime'> {
  return {
    date: '2026-08-26',
    scheduledTime: '20:00',
    status: 'pending',
    ...overrides,
  };
}

describe('isWalkRequiringAttention', () => {
  it('is false well before the scheduled time', () => {
    const walk = makeWalk();
    const now = new Date('2026-08-26T19:00:00');
    expect(isWalkRequiringAttention(walk, now)).toBe(false);
  });

  it('is false just under the T+30 threshold', () => {
    const walk = makeWalk();
    const now = new Date('2026-08-26T20:29:59');
    expect(isWalkRequiringAttention(walk, now)).toBe(false);
  });

  it('is true exactly at the T+30 threshold', () => {
    const walk = makeWalk();
    const now = new Date(new Date('2026-08-26T20:00:00').getTime() + ATTENTION_MINUTES_AFTER * 60000);
    expect(isWalkRequiringAttention(walk, now)).toBe(true);
  });

  it('is true well after the threshold', () => {
    const walk = makeWalk();
    const now = new Date('2026-08-26T22:00:00');
    expect(isWalkRequiringAttention(walk, now)).toBe(true);
  });

  it('is false for a walk already marked done, no matter how late', () => {
    const walk = makeWalk({ status: 'done' });
    const now = new Date('2026-08-27T00:00:00');
    expect(isWalkRequiringAttention(walk, now)).toBe(false);
  });

  it('is false for a walk already marked skipped', () => {
    const walk = makeWalk({ status: 'skipped' });
    const now = new Date('2026-08-27T00:00:00');
    expect(isWalkRequiringAttention(walk, now)).toBe(false);
  });

  it('defaults to the real current moment when called with no `now` argument', () => {
    const walk = makeWalk({ status: 'done' });
    expect(isWalkRequiringAttention(walk)).toBe(false);
  });
});
