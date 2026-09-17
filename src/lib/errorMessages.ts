/**
 * Centralized Hebrew error-message mapping (round 6, priority A5).
 *
 * Before this file, each screen/store re-implemented its own "raw Postgres/
 * RPC error text -> friendly Hebrew string" substring-match table
 * (LoginScreen's claimErrorMessage, requestsStore's messageFor). That worked
 * but meant every NEW call site (family role management, schedule mutation
 * errors, generic network failures) would either duplicate the pattern again
 * or — worse — just show the raw English error to the user, which is exactly
 * the A5 repro bug ("a member attempting to create a change request for
 * another member's walk currently shows a raw English error").
 *
 * This file is the single place new substring rules get added. Existing
 * call sites (LoginScreen.claimErrorMessage, requestsStore.messageFor) now
 * delegate to friendlyErrorMessage() with their own table appended after the
 * shared one, rather than duplicating the shared rules — see each file's
 * own comment. Prefer adding a rule HERE over adding a new ad-hoc mapping
 * table in a new screen/store.
 *
 * A raw technical error is still logged via console.error at the call site
 * (dev-only) — this file only ever controls what's shown in a user-facing
 * alert/modal, never suppresses the underlying diagnostic.
 */

export function rawMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }
  return String(error ?? '');
}

export interface ErrorRule {
  /** Substring to match (case-sensitive, matching this codebase's existing RPC error text) against the raw error message. */
  includes: string;
  message: string;
}

/**
 * Rules shared across every call site. Order matters: first match wins, so
 * a more specific rule should come before a broader one that could also
 * match the same text.
 */
export const SHARED_ERROR_RULES: ErrorRule[] = [
  // ---- Requests (swap / time-change) — migrations/0005_*.sql ----
  { includes: 'a pending swap request already exists for this walk', message: 'כבר קיימת בקשת החלפה ממתינה עבור הטיול הזה.' },
  { includes: 'a pending swap request already exists for one of these walks', message: 'אחד משני הטיולים כבר משתתף בבקשת החלפה ממתינה.' },
  { includes: 'the source walk has changed since this request was created', message: 'הטיול שלך השתנה מאז יצירת הבקשה ולכן אי אפשר לאשר אותה.' },
  { includes: 'the target walk has changed since this request was created', message: 'הטיול שנבחר להחלפה השתנה מאז יצירת הבקשה ולכן אי אפשר לאשר אותה.' },
  { includes: 'both walks must still be pending', message: 'אחד הטיולים כבר אינו ממתין ולכן אי אפשר ליצור את ההחלפה.' },
  { includes: 'a pending time-change request already exists for this walk', message: 'כבר קיימת בקשת שינוי שעה ממתינה עבור הטיול הזה.' },
  { includes: 'the walk has changed since this request was created and can no longer be approved', message: 'הטיול השתנה מאז שהבקשה נוצרה, ולכן לא ניתן לאשר אותה יותר. רעננו את המסך ונסו שוב אם צריך.' },
  { includes: 'that time is already taken by another scheduled walk', message: 'השעה המבוקשת כבר תפוסה על ידי טיול אחר.' },
  { includes: 'walk is no longer pending', message: 'הטיול הזה כבר אינו ממתין (בוצע, דולג או בוטל) — לא ניתן לבקש עבורו שינוי.' },
  // A5 repro case, exact spec wording: a member tried to request a change
  // for a walk that isn't theirs — the RPC's raw text is "you can only
  // request a {swap,time change} for a walk you are responsible for".
  { includes: 'you can only request a swap for a walk you are responsible for', message: 'ניתן להגיש בקשה לשינוי רק עבור טיול שמשויך אליך.' },
  { includes: 'you can only request a time change for a walk you are responsible for', message: 'ניתן להגיש בקשה לשינוי רק עבור טיול שמשויך אליך.' },
  { includes: 'target member is not an active member of this family', message: 'בן/בת המשפחה שנבחר/ה אינם חברים פעילים במשפחה יותר.' },
  { includes: 'choose a different family member', message: 'יש לבחור בן משפחה אחר להחלפה.' },
  { includes: "that is already this walk's time", message: 'זו כבר השעה הנוכחית של הטיול.' },
  { includes: 'this request was already rejected', message: 'הבקשה הזו כבר נדחתה.' },
  { includes: 'this request was already approved', message: 'הבקשה הזו כבר אושרה.' },
  { includes: 'only the requested member can approve this swap', message: 'רק בן/בת המשפחה שאליהם נשלחה הבקשה יכולים להגיב לה.' },
  { includes: 'only the requested member can reject this swap', message: 'רק בן/בת המשפחה שאליהם נשלחה הבקשה יכולים להגיב לה.' },

  // ---- Family roles / admin — migrations/0007_multi_admin_roles.sql ----
  { includes: 'cannot demote the last admin of this family', message: 'לא ניתן להוריד את המנהל/ת האחרון/ה בתפקיד — חייב להישאר מנהל אחד לפחות במשפחה.' },
  { includes: 'cannot remove the last admin of this family', message: 'לא ניתן להסיר את המנהל/ת האחרון/ה מהמשפחה — חייב להישאר מנהל אחד לפחות.' },
  { includes: 'cannot change the role of a removed member', message: 'לא ניתן לשנות תפקיד לבן משפחה שהוסר.' },
  { includes: 'target member has no linked auth session', message: 'לא ניתן לשנות תפקיד לבן המשפחה הזה כרגע.' },
  { includes: 'invalid role', message: 'תפקיד לא תקין.' },
  // set_member_role()/admin_delete_family_member() both raise this exact
  // text when the target user id doesn't resolve within the caller's own
  // family (not found at all, or found but in a different family) — see
  // 0007's doc comment on why it's the same generic message for both cases
  // (never confirm/deny whether an id from another family exists at all).
  { includes: 'user not found', message: 'לא נמצא בן/בת המשפחה המבוקש/ת. רעננו את המסך ונסו שוב.' },

  // ---- Offline-exempt actions (server-authoritative, never queued — see
  // lib/requests.ts's doc comment for the established precedent, and
  // offlineFirstRepository.ts's deleteFamilyMember for this exact case) ----
  { includes: 'deleteFamilyMember requires an internet connection and cannot be queued offline', message: 'לא ניתן להסיר בן משפחה ללא חיבור לאינטרנט. התחברו לרשת ונסו שוב.' },

  // ---- Admin / permission (shared across several RPCs) ----
  { includes: 'admin permission required', message: 'רק מנהל/ת יכולים לבצע פעולה זו.' },
  { includes: 'no active profile claimed on this family', message: 'לא ניתן לזהות את הפרופיל הפעיל שלכם במשפחה הזו. נסו להתחבר מחדש.' },
  { includes: 'you are no longer an active member of this family', message: 'לא ניתן לזהות את הפרופיל הפעיל שלכם במשפחה הזו. נסו להתחבר מחדש.' },

  // ---- History/Statistics server-side permission gate — migrations/0027_*.sql
  // (Batch 3 correction #1). Same Hebrew copy as HistoryScreen.tsx/
  // StatisticsScreen.tsx's own client-side blocked EmptyState, so a denial
  // reads the same whether the client guard caught it locally or this RPC
  // rejection is what actually caught it.
  { includes: 'view_history permission required', message: 'אין לך גישה להיסטוריה. פנו למנהל/ת המשפחה אם לדעתכם זו טעות.' },
  { includes: 'view_statistics permission required', message: 'אין לך גישה לסטטיסטיקה. פנו למנהל/ת המשפחה אם לדעתכם זו טעות.' },

  // ---- Impersonation / device claim — migrations/0004_admin_permissions_and_member_deletion.sql,
  // 0006_qa_impersonation.sql ----
  // ROUND-2 FIX: these two rules used to match on the loose substrings
  // 'already claimed' / 'removed profile', which are also substrings of
  // 0008's unrelated 'profile is already claimed' (create_family_invite)
  // and 'cannot invite a removed profile' (create_family_invite) — so an
  // admin creating an invite for a claimed/removed target was incorrectly
  // shown this claim-flow wording ("log in from the original device"),
  // which doesn't fit the invite-creation context at all. Narrowed to the
  // exact server strings claim_family_profile() actually raises (0004) so
  // this still matches every real caller (claimErrorMessage() in
  // LoginScreen.tsx, authStore.signIn()) with no behavior change, while
  // leaving room for 0008's own distinct strings below to match instead.
  { includes: 'profile already claimed by another device', message: 'הפרופיל הזה כבר בשימוש במכשיר אחר. אם זה הפרופיל שלך, התחברו מהמכשיר המקורי, או בקשו ממנהל המשפחה עזרה.' },
  { includes: 'cannot claim a removed profile', message: 'הפרופיל הזה הוסר ולא ניתן להתחבר איתו.' },

  // ---- PIN-based reclaim / PIN management — migrations/0016_*.sql (completion pass) ----
  { includes: 'no PIN set for this profile', message: 'לא הוגדר קוד PIN לפרופיל הזה. יש לפנות למנהל/ת המשפחה כדי להגדיר אחד, או להתחבר מהמכשיר המקורי.' },
  // FINAL HARDENING PASS: server-side PIN attempt limiting
  // (migrations/0016_*.sql's profile_pin_attempts table). Must come BEFORE
  // the generic 'incorrect PIN' rule below — the cooldown case is a
  // distinct client-thrown message ('too many incorrect PIN attempts —
  // ...', see claimFamilyProfileWithPin() in lib/supabase.ts) that does not
  // itself contain the substring 'incorrect PIN' as its own rule text, so
  // there is no actual overlap risk, but it is kept here, right alongside
  // the PIN rules it is conceptually part of, for readability.
  { includes: 'too many incorrect PIN attempts', message: 'יותר מדי ניסיונות קוד שגויים. נסו שוב בעוד מספר דקות.' },
  { includes: 'incorrect PIN', message: 'קוד ה-PIN שגוי. נסו שוב.' },
  { includes: 'claim failed — profile may have been removed or changed family', message: 'לא ניתן היה להתחבר לפרופיל הזה כרגע. נסו שוב.' },
  { includes: 'PIN must be 4 to 6 digits', message: 'קוד ה-PIN חייב להיות בן 4 עד 6 ספרות.' },
  { includes: 'cannot set a PIN for a removed profile', message: 'לא ניתן להגדיר קוד PIN לבן משפחה שהוסר.' },
  { includes: "an admin's own PIN can only be set by that admin themselves", message: 'רק המנהל/ת עצמו/ה יכולים להגדיר או לשנות את קוד ה-PIN שלו/ה.' },
  { includes: "only the profile's own device or a family admin may set its PIN", message: 'רק בעל/ת הפרופיל או מנהל/ת המשפחה יכולים להגדיר את קוד ה-PIN.' },

  // ---- QA sandbox — migrations/0016_*.sql (final correction pass) ----
  { includes: 'refusing to reset a non-QA family', message: 'אי אפשר לאפס משפחה אמיתית — פעולה זו זמינה רק בתוך סביבת QA.' },
  { includes: 'only a family admin may reset this family', message: 'רק מנהל/ת סביבת ה-QA יכולים לאפס אותה.' },
  { includes: 'not currently in a QA sandbox', message: 'אינכם נמצאים כרגע בתוך סביבת QA.' },
  { includes: 'no real family to return to on this device', message: 'למכשיר הזה אין משפחה אמיתית שמורה לחזור אליה — הוא נכנס לסביבת QA בלי משפחה קודמת.' },
  // ROUND-2 FIX: narrowed from the loose 'not a member' (which is also a
  // substring of 0008's unrelated 'this device is not a member of a
  // family') to 'not a member of this', which still matches both real
  // source strings this rule targets — 'not a member of this family'
  // (0002) and "not a member of this user's family" (0004/0005/0007) —
  // with no behavior change for either, while no longer shadowing 0008's
  // own distinct wording below.
  { includes: 'not a member of this', message: 'הפרופיל הזה לא שייך למשפחה הזו.' },
  { includes: 'pending sync from another profile', message: 'למכשיר הזה יש פעולות ממתינות לסנכרון של בן משפחה אחר. יש להתחבר לאינטרנט כדי לסיים את הסנכרון ואז לנסות שוב.' },
  { includes: 'claim could not be verified', message: 'לא ניתן היה לאמת את ההתחברות. נסו שוב.' },

  // ---- Family invites — migrations/0008_family_invites.sql (Round 2) ----
  // Order matters here too: the more specific invite-lifecycle messages
  // must come before the generic 'user not found' rule above would ever be
  // reached (they're distinct strings so there's no actual overlap, but
  // kept together here for readability).
  { includes: 'cannot invite a removed profile', message: 'לא ניתן להזמין בן משפחה שהוסר.' },
  { includes: 'profile is already claimed', message: 'הפרופיל הזה כבר בשימוש במכשיר אחר.' },
  { includes: 'invite not found', message: 'ההזמנה לא נמצאה או אינה תקפה.' },
  { includes: 'invite was revoked', message: 'ההזמנה הזו בוטלה.' },
  { includes: 'invite already used', message: 'ההזמנה הזו כבר נוצלה.' },
  { includes: 'invite expired', message: 'ההזמנה הזו פגה. יש לבקש הזמנה חדשה.' },
  { includes: 'target profile is not available for this invite', message: 'הפרופיל המוזמן כבר אינו זמין להצטרפות. יש לבקש הזמנה חדשה.' },
  { includes: 'account already belongs to a different family', message: 'המכשיר הזה כבר שייך למשפחה אחרת.' },
  { includes: 'account already has a claimed profile', message: 'למכשיר הזה כבר יש פרופיל משויך במשפחה.' },
  { includes: 'this device is not a member of a family', message: 'המכשיר הזה אינו חבר במשפחה כרגע.' },
  { includes: 'must be authenticated', message: 'יש להתחבר כדי לבצע פעולה זו.' },

  // ---- Verified-admin family creation — create-verified-family Edge
  // Function (supabase/functions/create-verified-family/index.ts). These are
  // the exact reason strings that function returns in its JSON error body;
  // verifiedAdminOnboarding.ts's createVerifiedFamily() recovers them from
  // the otherwise-generic FunctionsHttpError before this table ever sees
  // them. 'verified email identity required' is the reachable, actionable
  // case (an anonymous or lapsed OTP session) — same wording
  // FamilyOnboardingScreen.tsx's own submitCreate() already throws for the
  // sibling email-mismatch case, so the two paths read identically.
  { includes: 'verified email identity required', message: 'יש לאמת מחדש את כתובת הדוא״ל לפני יצירת המשפחה.' },
  { includes: 'familyName is required', message: 'יש להזין שם למשפחה.' },

  // ---- Generic network failure — never show a raw fetch/TypeError string ----
  { includes: 'Network request failed', message: 'אין חיבור לאינטרנט. בדקו את החיבור ונסו שוב.' },
  { includes: 'Failed to fetch', message: 'אין חיבור לאינטרנט. בדקו את החיבור ונסו שוב.' },
  { includes: 'NetworkError', message: 'אין חיבור לאינטרנט. בדקו את החיבור ונסו שוב.' },
];

/**
 * Maps a raw thrown error to a friendly Hebrew message using the shared
 * rules plus any call-site-specific `extraRules` (checked first, so a
 * call site can override/specialize a shared rule if it ever needs to).
 * Falls back to `fallback` (default: a generic "something went wrong").
 */
export function friendlyErrorMessage(
  error: unknown,
  extraRules: ErrorRule[] = [],
  fallback = 'משהו השתבש, נסו שוב'
): string {
  const raw = rawMessageOf(error);
  for (const rule of [...extraRules, ...SHARED_ERROR_RULES]) {
    if (raw.includes(rule.includes)) return rule.message;
  }
  return fallback;
}
