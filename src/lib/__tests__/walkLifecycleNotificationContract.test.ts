import fs from 'fs';
import path from 'path';

const sender = fs.readFileSync(path.resolve(__dirname, '../../../supabase/functions/send-walk-lifecycle-notification/index.ts'), 'utf8');
const repository = fs.readFileSync(path.resolve(__dirname, '../../data/supabaseRepository.ts'), 'utf8');

describe('walk lifecycle push delivery contract', () => {
  it('requires authenticated actor-scoped claims and filters destinations by family profile auth sessions', () => {
    expect(sender).toContain("caller.rpc('claim_walk_lifecycle_notifications_v11'");
    expect(sender).toContain(".eq('family_id', context.family_id).eq('user_id', context.recipient_user_id)");
    expect(sender).toContain(".in('auth_user_id', authIds).eq('is_active', true)");
  });

  it('records provider acceptance only after a provider reports acceptance and records failures', () => {
    expect(sender).toContain("ticket.status === 'ok'");
    expect(sender).toContain("'no_registered_push_destinations'");
    expect(sender).toContain("'finish_walk_lifecycle_notification_delivery_v11'");
    expect(repository).toContain("!data?.providerAccepted");
  });
});
