import { MemberPhotoCommitError, memberPhotoErrorMessage, memberProfileErrorMessage, persistUploadedMemberPhoto } from '../memberPhotoSave';

describe('persistUploadedMemberPhoto', () => {
  it('updates the profile before publishing the photo to UI state', async () => {
    const saveProfile = jest.fn().mockResolvedValue(undefined);
    const removeObject = jest.fn().mockResolvedValue(undefined);
    const publishPhoto = jest.fn();

    await persistUploadedMemberPhoto(saveProfile, removeObject, publishPhoto);

    expect(saveProfile).toHaveBeenCalledTimes(1);
    expect(publishPhoto).toHaveBeenCalledTimes(1);
    expect(removeObject).not.toHaveBeenCalled();
  });

  it('removes the fresh object and leaves UI state unchanged when the profile update fails', async () => {
    const profileError = Object.assign(new Error('new row violates row-level security policy'), { code: '42501' });
    const saveProfile = jest.fn().mockRejectedValue(profileError);
    const removeObject = jest.fn().mockResolvedValue(undefined);
    const publishPhoto = jest.fn();

    await expect(persistUploadedMemberPhoto(saveProfile, removeObject, publishPhoto)).rejects.toBe(profileError);

    expect(removeObject).toHaveBeenCalledTimes(1);
    expect(publishPhoto).not.toHaveBeenCalled();
  });

  it('preserves the profile error when storage cleanup also fails', async () => {
    const profileError = new Error('profile update failed');
    const saveProfile = jest.fn().mockRejectedValue(profileError);
    const removeObject = jest.fn().mockRejectedValue(new Error('delete denied'));
    const publishPhoto = jest.fn();

    let caught: unknown;
    try {
      await persistUploadedMemberPhoto(saveProfile, removeObject, publishPhoto);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      name: 'MemberPhotoCommitError',
      originalError: profileError,
      cleanupFailed: true,
    });
    expect(publishPhoto).not.toHaveBeenCalled();
    expect(caught).toBeInstanceOf(MemberPhotoCommitError);
  });
});

describe('memberPhotoErrorMessage', () => {
  it('explains an upload permission failure separately from a profile permission failure', () => {
    const error = { statusCode: 403, message: 'permission denied' };
    expect(memberPhotoErrorMessage(error, 'upload')).toContain('העלאת התמונה נדחתה בגלל הרשאה');
    expect(memberPhotoErrorMessage(error, 'profile')).toContain('אין הרשאה לעדכן את הפרופיל');
  });

  it('distinguishes an upload network error from a profile update network error', () => {
    const error = new Error('Network request failed');
    expect(memberPhotoErrorMessage(error, 'upload')).toContain('לא הצלחנו להעלות');
    expect(memberPhotoErrorMessage(error, 'profile')).toContain('עדכון הפרופיל לא אושר');
  });

  it('gives an actionable size message for an oversized image', () => {
    expect(memberPhotoErrorMessage({ status: 413 }, 'upload')).toContain('קובץ התמונה גדול מדי');
  });

  it('warns when the profile write and new-object cleanup both fail', () => {
    expect(memberPhotoErrorMessage(new MemberPhotoCommitError(new Error('denied'), true), 'profile'))
      .toContain('לא הצלחנו למחוק את קובץ התמונה שהועלה');
  });
});

describe('memberProfileErrorMessage', () => {
  it('identifies authorization failures and states who can make the change', () => {
    expect(memberProfileErrorMessage({ code: '42501', message: 'new row violates row-level security policy' }))
      .toContain('רק מנהל המשפחה או בן המשפחה עצמו');
  });

  it('identifies network failures without claiming that permissions caused them', () => {
    expect(memberProfileErrorMessage(new Error('Network request failed')))
      .toContain('בעיית חיבור');
    expect(memberProfileErrorMessage(new Error('Network request failed')))
      .not.toContain('אין הרשאה');
  });
});
