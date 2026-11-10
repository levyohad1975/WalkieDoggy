import fs from 'fs';
import path from 'path';
import { shouldAutoSaveUploadedMemberPhoto } from '../UserFormModal';

/**
 * Production report 2026-11-05: a family member profile photo could not be
 * added on iPhone Safari. The member form deferred the picker launch to a
 * useEffect (to hide the form before the web cropper), which lost Safari's
 * transient user activation so the file dialog was blocked. The dog-photo
 * flow (changeDogPhoto) launches the picker directly from the tap and works;
 * the member flow now matches it (PhotoCropHost stacks the crop on top).
 */
describe('UserFormModal member photo pick', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../UserFormModal.tsx'), 'utf8');

  it('launches the picker synchronously from the tap (no deferred pending-pick)', () => {
    // pickPhoto itself awaits pickAndUploadImage — the picker is launched in
    // the tap handler, not from an effect.
    expect(source).toMatch(/const pickPhoto = async \(\) => \{[\s\S]*await pickAndUploadImage\('users', familyId, editingUser\?\.id \?\? 'new'\)/);
    // The gesture-losing deferral machinery is gone.
    expect(source).not.toContain('pendingPhotoPick');
    expect(source).not.toContain('setPendingPhotoPick');
    expect(source).not.toContain('shouldRunPendingWebPhotoPick');
    expect(source).not.toContain('webPhotoSaveRef');
  });

  it('still persists an existing member photo immediately, draft for a new member', () => {
    expect(source).toContain('if (shouldAutoSaveUploadedMemberPhoto(editingUser, uri)) {');
    // The profile write is confirmed (and a fresh upload is cleaned up on failure).
    expect(source).toContain('await persistUploadedMemberPhoto(');
    expect(source).toContain('() => onSave({ name: name.trim(), avatar, color, photoUrl: uri }),');
    // helper semantics unchanged
    expect(shouldAutoSaveUploadedMemberPhoto({ id: 'u' } as never, 'uri')).toBe(true);
    expect(shouldAutoSaveUploadedMemberPhoto(null, 'uri')).toBe(false);
    expect(shouldAutoSaveUploadedMemberPhoto({ id: 'u' } as never, null)).toBe(false);
  });
});
