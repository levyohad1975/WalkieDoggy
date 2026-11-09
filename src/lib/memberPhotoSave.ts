/** Error stages shown by the family-member photo flow. */
export type MemberPhotoSaveStage = 'upload' | 'profile';

export class MemberPhotoCommitError extends Error {
  readonly originalError: unknown;
  readonly cleanupFailed: boolean;

  constructor(originalError: unknown, cleanupFailed: boolean) {
    super('Member photo profile update failed');
    this.name = 'MemberPhotoCommitError';
    this.originalError = originalError;
    this.cleanupFailed = cleanupFailed;
  }
}

function errorText(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error ?? '').toLowerCase();
  const value = error as Record<string, unknown>;
  return [value.message, value.code, value.status, value.statusCode, value.name]
    .filter((part) => part !== undefined && part !== null)
    .join(' ')
    .toLowerCase();
}

/** Explain ordinary profile-save failures without mislabeling them as uploads. */
export function memberProfileErrorMessage(error: unknown): string {
  const text = errorText(error);
  if (/42501|403|permission denied|not authorized|row-level security|rls/.test(text)) {
    return 'אין הרשאה לשמור את פרטי בן המשפחה. רק מנהל המשפחה או בן המשפחה עצמו יכולים לעדכן פרטים אלה.';
  }
  if (/network|fetch|timeout|timed out|connection/.test(text)) {
    return 'שמירת הפרטים נכשלה בגלל בעיית חיבור. בדקו את האינטרנט ונסו שוב.';
  }
  return 'לא הצלחנו לשמור את פרטי בן המשפחה. השינויים לא אושרו; נסו שוב או בקשו ממנהל המשפחה לבדוק את ההרשאות.';
}

/** Translate only recognizable failures; never show raw server messages to families. */
export function memberPhotoErrorMessage(error: unknown, stage: MemberPhotoSaveStage): string {
  if (error instanceof MemberPhotoCommitError && error.cleanupFailed) {
    return 'הפרופיל לא השתנה, אך לא הצלחנו למחוק את קובץ התמונה שהועלה. בדקו את החיבור; אם הבעיה חוזרת, פנו לתמיכה.';
  }
  if (error instanceof MemberPhotoCommitError) error = error.originalError;
  const text = errorText(error);
  if (/42501|403|permission denied|not authorized|row-level security|rls/.test(text)) {
    return stage === 'upload'
      ? 'העלאת התמונה נדחתה בגלל הרשאה. התחברו מחדש לפרופיל המשפחה או בקשו ממנהל המשפחה לבדוק את ההרשאות.'
      : 'התמונה הועלתה, אך אין הרשאה לעדכן את הפרופיל הזה. בקשו ממנהל המשפחה לשמור את התמונה.';
  }
  if (/413|payload too large|file too large|entity too large/.test(text)) {
    return 'קובץ התמונה גדול מדי. בחרו תמונה קטנה יותר ונסו שוב.';
  }
  if (/network|fetch|timeout|timed out|connection/.test(text)) {
    return stage === 'upload'
      ? 'לא הצלחנו להעלות את התמונה. בדקו את חיבור האינטרנט ונסו שוב.'
      : 'התמונה הועלתה, אך עדכון הפרופיל לא אושר. בדקו את חיבור האינטרנט ונסו שוב.';
  }
  return stage === 'upload'
    ? 'לא הצלחנו להעלות את התמונה. נסו לבחור תמונה אחרת או נסו שוב מאוחר יותר.'
    : 'התמונה לא נשמרה בפרופיל. השינויים הקודמים נשארו; נסו שוב או בקשו ממנהל המשפחה לבדוק את ההרשאות.';
}

/**
 * Treat Storage upload + profile update as one user-visible operation. If the
 * row update fails, remove the new object and preserve the previous profile.
 */
export async function persistUploadedMemberPhoto(
  saveProfile: () => Promise<void> | void,
  removeUploadedObject: () => Promise<void>,
  onPersisted: () => void,
): Promise<void> {
  try {
    await saveProfile();
  } catch (error) {
    let cleanupFailed = false;
    try {
      await removeUploadedObject();
    } catch {
      cleanupFailed = true;
    }
    // The object path is constrained to this exact fresh upload and Storage
    // RLS remains authoritative. Preserve whether cleanup also failed so the
    // UI can explain that support may need to remove the orphan.
    throw cleanupFailed ? new MemberPhotoCommitError(error, true) : error;
  }
  onPersisted();
}
