import { friendlyErrorMessage, rawMessageOf } from '../errorMessages';

/**
 * Round 7, Part 3/5. Covers the new role-management rules added for the
 * multi-admin feature (set_member_role()/admin_delete_family_member(),
 * migrations/0007_multi_admin_roles.sql), plus the generic
 * "never show raw Postgres text" fallback contract.
 */
describe('friendlyErrorMessage — role management (0007)', () => {
  it('maps the last-admin DEMOTION rejection to a friendly Hebrew message', () => {
    const err = new Error('cannot demote the last admin of this family');
    expect(friendlyErrorMessage(err)).toBe(
      'לא ניתן להוריד את המנהל/ת האחרון/ה בתפקיד — חייב להישאר מנהל אחד לפחות במשפחה.'
    );
  });

  it('maps the last-admin REMOVAL rejection to a friendly Hebrew message (distinct from demotion)', () => {
    const err = new Error('cannot remove the last admin of this family');
    const message = friendlyErrorMessage(err);
    expect(message).toBe('לא ניתן להסיר את המנהל/ת האחרון/ה מהמשפחה — חייב להישאר מנהל אחד לפחות.');
    expect(message).not.toBe(friendlyErrorMessage(new Error('cannot demote the last admin of this family')));
  });

  it('maps a removed-member role-change rejection', () => {
    expect(friendlyErrorMessage(new Error('cannot change the role of a removed member'))).toBe(
      'לא ניתן לשנות תפקיד לבן משפחה שהוסר.'
    );
  });

  it('maps an invalid role value', () => {
    expect(friendlyErrorMessage(new Error('invalid role'))).toBe('תפקיד לא תקין.');
  });

  it('maps a missing/cross-family target user ("user not found")', () => {
    expect(friendlyErrorMessage(new Error('user not found'))).toBe(
      'לא נמצא בן/בת המשפחה המבוקש/ת. רעננו את המסך ונסו שוב.'
    );
  });

  it('maps the shared "admin permission required" rejection', () => {
    expect(friendlyErrorMessage(new Error('admin permission required'))).toBe('רק מנהל/ת יכולים לבצע פעולה זו.');
  });

  it('never shows raw technical text for an unrecognized error — falls back to the generic Hebrew message', () => {
    expect(friendlyErrorMessage(new Error('null value in column "auth_user_id" violates not-null constraint'))).toBe(
      'משהו השתבש, נסו שוב'
    );
  });

  it('a plain string error is also handled (rawMessageOf never throws)', () => {
    expect(rawMessageOf('cannot demote the last admin of this family')).toBe(
      'cannot demote the last admin of this family'
    );
  });

  it('rawMessageOf falls back to an empty string for a nullish error (thrown `null`/`undefined`, never a real Error/string/object)', () => {
    expect(rawMessageOf(null)).toBe('');
    expect(rawMessageOf(undefined)).toBe('');
  });
});

/**
 * Round 2. Covers the new family-invite rules added for lib/invites.ts
 * (migrations/0008_family_invites.sql). Every rejection text asserted here
 * is copied verbatim from 0008's own `raise exception` messages (see the
 * migration file and supabase/manual_tests/0008_family_invites_acl.sql).
 */
describe('friendlyErrorMessage — family invites (0008)', () => {
  it('maps a removed-target create rejection', () => {
    expect(friendlyErrorMessage(new Error('cannot invite a removed profile'))).toBe(
      'לא ניתן להזמין בן משפחה שהוסר.'
    );
  });

  it('maps an already-claimed-target create rejection', () => {
    expect(friendlyErrorMessage(new Error('profile is already claimed'))).toBe(
      'הפרופיל הזה כבר בשימוש במכשיר אחר.'
    );
  });

  it('maps an invalid/unknown invite (inspect or redeem)', () => {
    expect(friendlyErrorMessage(new Error('invite not found'))).toBe('ההזמנה לא נמצאה או אינה תקפה.');
  });

  it('maps a revoked-invite redemption rejection', () => {
    expect(friendlyErrorMessage(new Error('invite was revoked'))).toBe('ההזמנה הזו בוטלה.');
  });

  it('maps an already-used (sequential replay) redemption rejection', () => {
    expect(friendlyErrorMessage(new Error('invite already used'))).toBe('ההזמנה הזו כבר נוצלה.');
  });

  it('maps an expired-invite redemption rejection', () => {
    expect(friendlyErrorMessage(new Error('invite expired'))).toBe('ההזמנה הזו פגה. יש לבקש הזמנה חדשה.');
  });

  it('maps a target-no-longer-available redemption rejection', () => {
    expect(friendlyErrorMessage(new Error('target profile is not available for this invite'))).toBe(
      'הפרופיל המוזמן כבר אינו זמין להצטרפות. יש לבקש הזמנה חדשה.'
    );
  });

  it('maps a different-family collision rejection', () => {
    expect(friendlyErrorMessage(new Error('account already belongs to a different family'))).toBe(
      'המכשיר הזה כבר שייך למשפחה אחרת.'
    );
  });

  it('maps an already-has-a-claimed-profile collision rejection', () => {
    expect(friendlyErrorMessage(new Error('account already has a claimed profile'))).toBe(
      'למכשיר הזה כבר יש פרופיל משויך במשפחה.'
    );
  });

  it('maps "this device is not a member of a family" (create/list/redeem when the caller has no family yet)', () => {
    expect(friendlyErrorMessage(new Error('this device is not a member of a family'))).toBe(
      'המכשיר הזה אינו חבר במשפחה כרגע.'
    );
  });

  it('reuses the shared "admin permission required" rule for invite create/revoke/list', () => {
    expect(friendlyErrorMessage(new Error('admin permission required'))).toBe('רק מנהל/ת יכולים לבצע פעולה זו.');
  });

  // ROUND-2 FIX REGRESSION COVERAGE: these three 0008 strings each share a
  // substring with an older, broader rule further up SHARED_ERROR_RULES
  // ('removed profile' / 'already claimed' / 'not a member') that used to
  // match first and shadow the invite-specific wording below it. The three
  // older rules were narrowed to their real exact source strings (see the
  // ROUND-2 FIX comments in errorMessages.ts) rather than reordering the
  // array, so this also re-confirms the original claim-flow rules still
  // match their own real strings unchanged.
  it('does not let the broader claim-flow "removed profile" rule shadow the invite-specific one', () => {
    expect(friendlyErrorMessage(new Error('cannot invite a removed profile'))).not.toBe(
      'הפרופיל הזה הוסר ולא ניתן להתחבר איתו.'
    );
  });

  it('does not let the broader claim-flow "already claimed" rule shadow the invite-specific one', () => {
    expect(friendlyErrorMessage(new Error('profile is already claimed'))).not.toBe(
      'הפרופיל הזה כבר בשימוש במכשיר אחר. אם זה הפרופיל שלך, התחברו מהמכשיר המקורי, או בקשו ממנהל המשפחה עזרה.'
    );
  });

  it('does not let the broader "not a member" rule shadow the invite-specific "not a member of a family" one', () => {
    expect(friendlyErrorMessage(new Error('this device is not a member of a family'))).not.toBe(
      'הפרופיל הזה לא שייך למשפחה הזו.'
    );
  });

  it('the original claim-flow rules still match their own real, unrelated source strings unchanged', () => {
    expect(friendlyErrorMessage(new Error('cannot claim a removed profile'))).toBe(
      'הפרופיל הזה הוסר ולא ניתן להתחבר איתו.'
    );
    expect(friendlyErrorMessage(new Error('profile already claimed by another device'))).toBe(
      'הפרופיל הזה כבר בשימוש במכשיר אחר. אם זה הפרופיל שלך, התחברו מהמכשיר המקורי, או בקשו ממנהל המשפחה עזרה.'
    );
    expect(friendlyErrorMessage(new Error('not a member of this family'))).toBe('הפרופיל הזה לא שייך למשפחה הזו.');
    expect(friendlyErrorMessage(new Error("not a member of this user's family"))).toBe(
      'הפרופיל הזה לא שייך למשפחה הזו.'
    );
  });

  it('never shows raw Postgres/RPC text for an unrecognized invite error', () => {
    expect(
      friendlyErrorMessage(new Error('duplicate key value violates unique constraint "family_invites_token_hash_key"'))
    ).toBe('משהו השתבש, נסו שוב');
  });
});

/**
 * COMPLETION PASS — Priority 1 (7B/7C/7D PIN reclaim). Covers the new rules
 * added for set_profile_pin()/claim_family_profile_with_pin()
 * (migrations/0016_*.sql), matched against the RPCs' exact raised strings.
 */
describe('friendlyErrorMessage — PIN reclaim / PIN management (0016)', () => {
  it('maps "no PIN set" distinctly from "incorrect PIN"', () => {
    const noPin = friendlyErrorMessage(new Error('no PIN set for this profile — ask your family admin to set one, or reclaim from the original device'));
    const wrongPin = friendlyErrorMessage(new Error('incorrect PIN'));
    expect(noPin).toContain('לא הוגדר קוד PIN');
    expect(wrongPin).toBe('קוד ה-PIN שגוי. נסו שוב.');
    expect(noPin).not.toBe(wrongPin);
  });

  it('maps PIN-length validation', () => {
    expect(friendlyErrorMessage(new Error('PIN must be 4 to 6 digits'))).toBe(
      'קוד ה-PIN חייב להיות בן 4 עד 6 ספרות.'
    );
  });

  it('maps the admin-target PIN-change restriction distinctly from the general self-or-admin rule', () => {
    const adminTarget = friendlyErrorMessage(
      new Error("an admin's own PIN can only be set by that admin themselves")
    );
    const generalRestriction = friendlyErrorMessage(
      new Error("only the profile's own device or a family admin may set its PIN")
    );
    expect(adminTarget).not.toBe(generalRestriction);
    expect(adminTarget).toContain('המנהל/ת עצמו/ה');
  });

  it('maps a removed-profile PIN-set rejection', () => {
    expect(friendlyErrorMessage(new Error('cannot set a PIN for a removed profile'))).toBe(
      'לא ניתן להגדיר קוד PIN לבן משפחה שהוסר.'
    );
  });

  it('maps the generic post-transfer claim failure', () => {
    expect(
      friendlyErrorMessage(new Error('claim failed — profile may have been removed or changed family; try again'))
    ).toBe('לא ניתן היה להתחבר לפרופיל הזה כרגע. נסו שוב.');
  });

  /**
   * FINAL HARDENING PASS — server-side PIN attempt limiting
   * (migrations/0016_*.sql's profile_pin_attempts table). Confirms the new
   * cooldown message is distinct from, and does not get shadowed by, the
   * pre-existing generic 'incorrect PIN' rule — even though the cooldown
   * error's own text ('too many incorrect PIN attempts — ...') itself
   * contains the substring 'incorrect PIN', which is exactly why ordering
   * (the more specific rule first) matters here, not just presence.
   */
  it('maps the PIN-cooldown rejection distinctly from a plain wrong-PIN rejection', () => {
    const cooldown = friendlyErrorMessage(
      new Error('too many incorrect PIN attempts — try again in a few minutes')
    );
    const wrongPin = friendlyErrorMessage(new Error('incorrect PIN'));
    expect(cooldown).toBe('יותר מדי ניסיונות קוד שגויים. נסו שוב בעוד מספר דקות.');
    expect(wrongPin).toBe('קוד ה-PIN שגוי. נסו שוב.');
    expect(cooldown).not.toBe(wrongPin);
  });
});

/**
 * FINAL CORRECTION PASS — Deliverable 2 (QA sandbox reversibility). Covers
 * the new rules for enter_qa_sandbox()/exit_qa_sandbox()/qa_reset_data()/
 * qa_reset_full()'s raised strings (migrations/0016_*.sql).
 */
describe('friendlyErrorMessage — QA sandbox (0016)', () => {
  it('maps a reset attempted against a non-QA (real) family', () => {
    expect(friendlyErrorMessage(new Error('refusing to reset a non-QA family'))).toBe(
      'אי אפשר לאפס משפחה אמיתית — פעולה זו זמינה רק בתוך סביבת QA.'
    );
  });

  it('maps exit_qa_sandbox() called while not actually in a QA family', () => {
    expect(friendlyErrorMessage(new Error('not currently in a QA sandbox'))).toBe(
      'אינכם נמצאים כרגע בתוך סביבת QA.'
    );
  });

  it('maps exit_qa_sandbox() called on a device with no saved real-family snapshot', () => {
    expect(
      friendlyErrorMessage(new Error('no real family to return to on this device — it entered QA with no prior real family membership'))
    ).toBe('למכשיר הזה אין משפחה אמיתית שמורה לחזור אליה — הוא נכנס לסביבת QA בלי משפחה קודמת.');
  });
});

/**
 * BATCH 3 CORRECTION #1 (post-review) — the two new server-side denial
 * messages migration 0027's list_history_walks()/list_statistics_walks()
 * raise, mapped to the same Hebrew copy HistoryScreen.tsx/
 * StatisticsScreen.tsx's own client-side blocked EmptyState already shows,
 * so a denial reads identically whether the client guard or this RPC
 * rejection actually caught it.
 */
describe('friendlyErrorMessage — History/Statistics server-side permission gate (0027)', () => {
  it('maps a view_history denial', () => {
    expect(friendlyErrorMessage(new Error('view_history permission required'))).toBe(
      'אין לך גישה להיסטוריה. פנו למנהל/ת המשפחה אם לדעתכם זו טעות.'
    );
  });

  it('maps a view_statistics denial (distinct from the history one)', () => {
    const message = friendlyErrorMessage(new Error('view_statistics permission required'));
    expect(message).toBe('אין לך גישה לסטטיסטיקה. פנו למנהל/ת המשפחה אם לדעתכם זו טעות.');
    expect(message).not.toBe(friendlyErrorMessage(new Error('view_history permission required')));
  });
});

/**
 * create-verified-family Edge Function reason strings, recovered from an
 * otherwise-generic FunctionsHttpError by
 * verifiedAdminOnboarding.ts's createVerifiedFamily() (see its own comment).
 */
describe('friendlyErrorMessage — create-verified-family Edge Function', () => {
  it('maps a lapsed/anonymous verified-identity session', () => {
    expect(friendlyErrorMessage(new Error('verified email identity required'))).toBe(
      'יש לאמת מחדש את כתובת הדוא״ל לפני יצירת המשפחה.'
    );
  });

  it('maps a missing family name', () => {
    expect(friendlyErrorMessage(new Error('familyName is required'))).toBe(
      'יש להזין שם למשפחה.'
    );
  });
});
