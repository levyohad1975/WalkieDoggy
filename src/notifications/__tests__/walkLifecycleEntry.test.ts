import { walkLifecycleOpenFromNotificationData } from '../walkLifecycleEntry';

describe('walk lifecycle notification app-open acknowledgment contract', () => {
  it('accepts only lifecycle payloads with valid notification IDs', () => {
    expect(walkLifecycleOpenFromNotificationData({
      type: 'walk_lifecycle', walkId: 'walk', notificationIds: ['1f7e6123-4567-489a-8abc-0123456789ab'],
    })).toEqual({ walkId: 'walk', notificationIds: ['1f7e6123-4567-489a-8abc-0123456789ab'] });
  });
  it('rejects missing IDs and unrelated notification payloads', () => {
    expect(walkLifecycleOpenFromNotificationData({ type: 'walk_lifecycle', walkId: 'walk' })).toBeNull();
    expect(walkLifecycleOpenFromNotificationData({ type: 'chat', walkId: 'walk', notificationIds: [] })).toBeNull();
    expect(walkLifecycleOpenFromNotificationData({ type: 'walk_lifecycle', walkId: 'walk', notificationIds: ['bad'] })).toBeNull();
  });
  it('deduplicates validated notification IDs', () => {
    const id = '1f7e6123-4567-489a-8abc-0123456789ab';
    expect(walkLifecycleOpenFromNotificationData({ type: 'walk_lifecycle', walkId: 'walk', notificationIds: [id, id] })?.notificationIds).toEqual([id]);
  });
});
