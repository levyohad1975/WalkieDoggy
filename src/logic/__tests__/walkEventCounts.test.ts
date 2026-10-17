import { getWalkEventCounts, summarizeWalkEvents, validWalkEventCount } from '../walkEventCounts';

describe('persisted walk event count compatibility', () => {
  it('counts two events on a single walk instead of one flagged walk', () => {
    expect(summarizeWalkEvents([{ hadPee: true, peeCount: 2, hadPoop: false, poopCount: 0 }])).toEqual({ pee: 2, poop: 0 });
  });
  it('retains historical boolean fallback when counts are absent', () => {
    expect(summarizeWalkEvents([{ hadPee: true }, { hadPee: true, hadPoop: true }])).toEqual({ pee: 2, poop: 1 });
  });
  it('prefers explicit zero to stale legacy true', () => {
    expect(getWalkEventCounts({ hadPee: true, hadPoop: true, peeCount: 0, poopCount: 0 })).toEqual({ pee: 0, poop: 0 });
  });
  it('rejects negative, fractional, unsafe and non-number values', () => {
    for (const value of [-1, 1.2, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '2', null]) {
      expect(validWalkEventCount(value)).toBe(false);
    }
  });
});
