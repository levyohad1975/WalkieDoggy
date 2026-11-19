import fs from 'fs';
import path from 'path';

const sender = fs.readFileSync(path.resolve(__dirname, '../../../supabase/functions/send-walk-lifecycle-notification/index.ts'), 'utf8');
const repository = fs.readFileSync(path.resolve(__dirname, '../../data/supabaseRepository.ts'), 'utf8');

describe('walk lifecycle push delivery contract', () => {
  it('requires authenticated actor-scoped claims and filters destinations by family profile auth sessions', () => {
    expect(sender).toContain("caller.rpc('claim_walk_lifecycle_notifications_v11'");
    expect(sender).toContain("for (const notification of notifications)");
    expect(sender).toContain(".eq('family_id', notification.family_id).eq('user_id', notification.recipient_user_id)");
    expect(sender).toContain(".in('auth_user_id', authIds).eq('is_active', true)");
  });

  it('finalizes each recipient notification independently after provider acceptance or failure', () => {
    expect(sender).toContain("ticket.status === 'ok'");
    expect(sender).toContain("'no_registered_push_destinations'");
    expect(sender).toContain("'finish_walk_lifecycle_notification_delivery_v11'");
    expect(sender).toContain("p_notification_ids: [notification.notification_id]");
    expect(sender).toContain("claimedIds = claimedIds.filter");
    expect(repository).toContain("!data?.providerAccepted");
  });
});
