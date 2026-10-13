import {
  __resetChatEntryForTests,
  chatOpenFromNotificationData,
  consumePendingChatOpen,
  publishChatOpen,
  subscribeToChatOpens,
} from '../chatEntry';
import { __resetNotificationOpenDedupForTests } from '../notificationOpenDedup';
import { requestOpenFromNotificationData } from '../requestEntry';

describe('chatEntry — chat notification opens', () => {
  beforeEach(() => {
    __resetChatEntryForTests();
    __resetNotificationOpenDedupForTests();
  });

  it('accepts exactly the payload send-chat-push attaches', () => {
    expect(chatOpenFromNotificationData({ type: 'chat', conversationId: 'c1', messageId: 'm1' })).toEqual({
      conversationId: 'c1',
      messageId: 'm1',
    });
    expect(chatOpenFromNotificationData({ type: 'chat', conversationId: 'c1' })).toEqual({
      conversationId: 'c1',
      messageId: undefined,
    });
  });

  it('rejects foreign or malformed payloads', () => {
    expect(chatOpenFromNotificationData(null)).toBeNull();
    expect(chatOpenFromNotificationData('chat')).toBeNull();
    expect(chatOpenFromNotificationData({ type: 'request', requestId: 'r1', kind: 'swap', event: 'created' })).toBeNull();
    expect(chatOpenFromNotificationData({ type: 'chat' })).toBeNull();
    expect(chatOpenFromNotificationData({ type: 'chat', conversationId: '' })).toBeNull();
    expect(chatOpenFromNotificationData({ type: 'chat', conversationId: 42 })).toBeNull();
  });

  it('does not collide with the request-notification payload shape', () => {
    expect(requestOpenFromNotificationData({ type: 'chat', conversationId: 'c1', messageId: 'm1' })).toBeNull();
  });

  it('delivers to a live subscriber and suppresses a duplicate tap', () => {
    const listener = jest.fn();
    subscribeToChatOpens(listener);
    publishChatOpen({ conversationId: 'c1', messageId: 'm1' });
    publishChatOpen({ conversationId: 'c1', messageId: 'm1' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('replays a cold-launch open to a subscriber that mounts later, once', () => {
    publishChatOpen({ conversationId: 'c1', messageId: 'm1' });
    const first = jest.fn();
    subscribeToChatOpens(first);
    expect(first).toHaveBeenCalledWith({ conversationId: 'c1', messageId: 'm1' });
    const second = jest.fn();
    subscribeToChatOpens(second);
    expect(second).not.toHaveBeenCalled();
  });

  it('an open handled live is not replayed after the handler consumes it', () => {
    const unsubscribe = subscribeToChatOpens(() => consumePendingChatOpen());
    publishChatOpen({ conversationId: 'c1', messageId: 'm2' });
    unsubscribe();
    const late = jest.fn();
    subscribeToChatOpens(late);
    expect(late).not.toHaveBeenCalled();
  });
});
