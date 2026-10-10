import fs from 'fs';
import path from 'path';
import { shouldRunPendingWebPhotoPick } from '../UserFormModal';

describe('UserFormModal web photo crop handoff', () => {
  it('starts the hosted crop/upload after the web form hides for a pending pick', () => {
    expect(shouldRunPendingWebPhotoPick(true, 'web')).toBe(true);
  });

  it('does not start without a pending pick or on native', () => {
    expect(shouldRunPendingWebPhotoPick(false, 'web')).toBe(false);
    expect(shouldRunPendingWebPhotoPick(true, 'ios')).toBe(false);
    expect(shouldRunPendingWebPhotoPick(true, 'android')).toBe(false);
  });

  it('persists the complete latest web edit draft with the new photo before closing', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../UserFormModal.tsx'), 'utf8');
    expect(source).toContain('saveUserPhoto(latest.editingUser.id, familyId)');
    expect(source).toContain('name: latest.name.trim(),');
    expect(source).toContain('avatar: latest.avatar,');
    expect(source).toContain('color: latest.color,');
    expect(source).toContain('photoUrl: uri,');
    expect(source).toContain('Promise.resolve(latest.onSave({');
    expect(source).toContain('})).then(() => latest.onClose());');
  });
});
