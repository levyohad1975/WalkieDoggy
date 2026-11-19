import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { SystemAdminFamilyChatsPanel } from '../SystemAdminFamilyChatsPanel';
import * as api from '../../lib/systemAdminChat';

jest.mock('../../lib/systemAdminChat', () => ({
  listAdminChatFamilies: jest.fn(), listAdminFamilyChats: jest.fn(), readAdminChatMessages: jest.fn(), getAdminChatAttachment: jest.fn(),
}));

const family = { id: 'f-1', name: 'לוי', status: 'active' } as api.AdminChatFamily;
const direct = { id: 'c-1', kind: 'direct', title: null, created_at: '2026-01-01T00:00:00Z', last_message_at: null, participants: [{ id: 'u-1', name: 'מאור' }] } as api.AdminChatConversation;
const live = { id: 'm-1', created_at: '2026-01-01T00:00:00Z', sender_user_id: 'u-1', sender_name: 'מאור', deleted_at: null, body: 'שלום', attachment_mime: null } as api.AdminChatMessage;

describe('SystemAdminFamilyChatsPanel', () => {
  beforeEach(() => { jest.clearAllMocks(); (api.listAdminChatFamilies as jest.Mock).mockResolvedValue([family]); });

  it('requires a reason before opening private contents and shows privacy notice', async () => {
    (api.listAdminFamilyChats as jest.Mock).mockResolvedValue([direct]);
    const screen = render(<SystemAdminFamilyChatsPanel />);
    fireEvent.press(await screen.findByLabelText(/פתיחת משפחת לוי/));
    fireEvent.press(await screen.findByText('שיחה פרטית'));
    expect(screen.getByText(/פתיחת תוכן מתועדת ביומן ביקורת/)).toBeTruthy();
    expect(api.readAdminChatMessages).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('פתיחה לצורך תמיכה'));
    await waitFor(() => expect(api.readAdminChatMessages).toHaveBeenCalledWith(expect.objectContaining({ familyId: 'f-1', conversationId: 'c-1', reason: 'support' })));
  });

  it('renders deleted messages as deleted and loads older pages without changing chat state', async () => {
    (api.listAdminFamilyChats as jest.Mock).mockResolvedValue([direct]);
    (api.readAdminChatMessages as jest.Mock).mockResolvedValueOnce([{ ...live, deleted_at: '2026-01-02T00:00:00Z', body: null }]).mockResolvedValueOnce([{ ...live, id: 'm-2' }]);
    const screen = render(<SystemAdminFamilyChatsPanel />);
    fireEvent.press(await screen.findByLabelText(/פתיחת משפחת לוי/));
    fireEvent.press(await screen.findByText('שיחה פרטית'));
    fireEvent.press(await screen.findByText('פתיחה לצורך בירור תקלה'));
    expect(await screen.findByText('ההודעה נמחקה')).toBeTruthy();
    fireEvent.press(screen.getByText('טעינת הודעות ישנות'));
    await waitFor(() => expect(api.readAdminChatMessages).toHaveBeenCalledTimes(2));
    expect(api.readAdminChatMessages).toHaveBeenLastCalledWith(expect.objectContaining({ before: expect.objectContaining({ id: 'm-1' }) }));
  });

  it('shows a safe actionable error when server authorization or the network fails', async () => {
    (api.listAdminChatFamilies as jest.Mock).mockRejectedValue(new Error('network'));
    const screen = render(<SystemAdminFamilyChatsPanel />);
    expect(await screen.findByText(/לא ניתן לטעון את הנתונים/)).toBeTruthy();
  });
});
