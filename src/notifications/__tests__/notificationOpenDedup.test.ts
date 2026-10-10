import { isDuplicateNotificationOpen, __resetNotificationOpenDedupForTests } from '../notificationOpenDedup';

describe('notificationOpenDedup', () => {
  beforeEach(() => {
    __resetNotificationOpenDedupForTests();
  });

  it('the first occurrence of a key is never a duplicate', () => {
    expect(isDuplicateNotificationOpen('reminder:walk-1:T-15', 1000)).toBe(false);
  });

  it('the exact same key seen again within the dedupe window is a duplicate', () => {
    expect(isDuplicateNotificationOpen('reminder:walk-1:T-15', 1000)).toBe(false);
    expect(isDuplicateNotificationOpen('reminder:walk-1:T-15', 1500)).toBe(true);
    expect(isDuplicateNotificationOpen('reminder:walk-1:T-15', 3999)).toBe(true);
  });

  it('the same key seen again AFTER the dedupe window elapses is a genuine new event, not a duplicate', () => {
    expect(isDuplicateNotificationOpen('reminder:walk-1:T-15', 1000)).toBe(false);
    expect(isDuplicateNotificationOpen('reminder:walk-1:T-15', 5001)).toBe(false);
  });

  it('a different key is never treated as a duplicate of the previous one, even immediately after', () => {
    expect(isDuplicateNotificationOpen('reminder:walk-1:T-15', 1000)).toBe(false);
    expect(isDuplicateNotificationOpen('reminder:walk-2:T', 1001)).toBe(false);
  });

  it('defaults to Date.now() when no explicit `now` is passed', () => {
    expect(isDuplicateNotificationOpen('reminder:walk-1:T-15')).toBe(false);
    expect(isDuplicateNotificationOpen('reminder:walk-1:T-15')).toBe(true);
  });
});
