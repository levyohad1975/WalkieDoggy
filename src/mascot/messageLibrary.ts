/**
 * Walkie Doggy mascot personality/message library (Batch 4, C4/C5/C7).
 *
 * A curated, hand-written Hebrew message library — NOT runtime-generated
 * (per the brief's explicit "do not use generative AI to write reminder
 * messages" requirement, C7). Organized by category so the selection engine
 * (messageEngine.ts) can pick a random, non-recently-used variant for a
 * given moment in the walk lifecycle.
 *
 * ============================================================================
 * BATCH 4 CORRECTION #1 (item 2) — GENDER-AWARE TEXT, NO SLASH-LANGUAGE
 * ============================================================================
 * A message's `text` field is either a plain string (when nothing in it
 * depends on the dog's sex — most "encouragement"/"weekend" copy, for
 * example), or a `GenderedText` object `{ male, female, neutral }` when the
 * dog's grammatical gender matters. messageEngine.ts's `renderMessageTemplate`
 * picks the right branch from `ctx.dogSex` BEFORE substituting the
 * `{placeholder}` variables below — so the selected branch is always
 * natural, real Hebrew, never "מוכן/ה" slash-notation. `dogSex: 'male'` gets
 * the `male` branch, `'female'` gets `female`, and anything else (missing,
 * null, or an unrecognized value) gets `neutral` — which is a genuinely
 * natural, independently-written sentence (per the brief's own example:
 * "{dogName} מוכן/ה לצאת" → neutral "הגיע הזמן לצאת לטיול עם {dogName}"),
 * never the male/female text with the ending chopped off.
 *
 * The family member's (`responsibleName`'s) gender is NOT tracked anywhere
 * in this app's data model, and this library never guesses it — every
 * message that used to read a person's gender (e.g. "אתה/את הכוכב/ת הבא/ה")
 * was rewritten to a single phrasing that is grammatically correct
 * regardless of who `{responsibleName}` turns out to be (second-person forms
 * using the "-ך"/"-ת" suffixes that are spelled identically for both
 * genders in unpointed Hebrew, plural/impersonal constructions like
 * "שכחו אותי", or restructuring around the person's name instead of a
 * gendered predicate adjective) — this never varies by dogSex, since it has
 * nothing to do with the dog.
 *
 * VARIABLES: a template may reference the following placeholders, all
 * substituted by messageEngine.ts's `renderMessageTemplate()`:
 *   {dogName}        — the family dog's real name (never hard-coded here).
 *   {dogNoun}         — "הכלב X" / "הכלבה X" / bare "X" — reuses
 *                        reminderMessages.ts's own dogNoun() so the mascot's
 *                        copy and the push-notification copy never disagree
 *                        on how a dog's sex is phrased. Always safe to use
 *                        standalone, in any gender context, since its
 *                        "unknown" case is a genuinely neutral bare name,
 *                        never a slash form.
 *   {responsibleName} — the family member responsible for this walk.
 *   {scheduledTime}   — "HH:mm".
 *   {completionTime}  — "HH:mm", only meaningful for completion-related
 *                        categories.
 * (A prior draft of this library also documented a `{wentOut}` token reusing
 * reminderMessages.ts's `wentOutForm()`. It was never actually used in any
 * shipped message text, and it's deliberately NOT offered here anymore: a
 * bare Hebrew past-tense verb has no natural gender-neutral single-word
 * form the way `{dogNoun}` does, so a standalone token for it can only ever
 * produce a slash form ("יצא/ה") for the unknown-sex case — exactly what
 * this correction removes. A future message needing "went out" phrasing
 * should be written as a full `GenderedText` with a properly rewritten
 * neutral sentence instead, the same way every message below handles it.)
 * A template must never assume every variable is available — the engine
 * falls back safely (see messageEngine.ts) rather than rendering broken
 * text ("undefined", empty gaps) when a variable the template asked for is
 * missing from the context.
 *
 * TONE (per the brief): warm, playful, clever, friendly, child-friendly,
 * occasionally cheeky. Humor never shames a child, never implies the dog is
 * suffering because of them, never threatens, never becomes a genuine
 * source of guilt or fear — see the T+30 "concerned" category especially:
 * dramatic-but-obviously-silly ("החטיפים אוזלים, שלחו עזרה"), never a real
 * accusation.
 *
 * C7 (future personality presets — architecture only): `presets` is an
 * optional tag on a template restricting which personality preset it
 * belongs to. Every template in this file is left untagged (undefined),
 * which the engine treats as "belongs to every preset" — so today's single
 * shipped 'default' preset sees the whole library. A future preset (e.g.
 * 'calm' favoring gentler phrasing, 'playful' leaning harder into the jokes)
 * can be introduced later purely by tagging a subset of templates and
 * filtering on it in the engine — no rewrite of this file's shape is
 * required for that. See personalityPresets.ts.
 */

import type { PersonalityPreset } from './personalityPresets';

export type MessageCategory =
  | 'excited' // T-15
  | 'ready' // T
  | 'waiting' // T+15
  | 'concerned' // T+30
  | 'success' // walk completed / celebration
  | 'earlyCompletion'
  | 'lateCompletion'
  | 'morning'
  | 'evening'
  | 'weekend'
  | 'encouragement';

/**
 * BATCH 4 CORRECTION #1 (item 2). Three independently-written, natural
 * Hebrew renderings of the same message — never a mechanical "chop the
 * ending off" of one gendered form. `neutral` is used whenever the dog's
 * sex is missing/unset/unrecognized.
 */
export interface GenderedText {
  male: string;
  female: string;
  neutral: string;
}

export interface MessageTemplate {
  /** Stable id, unique within its category — used by the anti-repetition window (messageEngine.ts). */
  id: string;
  category: MessageCategory;
  /** Plain string when nothing in the message depends on the dog's sex; GenderedText when it does — see the module doc comment above. */
  text: string | GenderedText;
  /** C7 architecture hook — omitted means "every preset". Not yet filtered on by any shipped UI. */
  presets?: PersonalityPreset[];
}

function t(category: MessageCategory, entries: [string, string | GenderedText][]): MessageTemplate[] {
  return entries.map(([id, text]) => ({ id: `${category}:${id}`, category, text }));
}

// ---------------------------------------------------------------------------
// T-15 — excited / approaching walk time
// ---------------------------------------------------------------------------
const EXCITED = t('excited', [
  ['1', '{responsibleName}, רק שתדע... אני כבר ליד הרצועה. לגמרי במקרה 😇🐾'],
  [
    '2',
    {
      male: 'עוד 15 דקות לטיול! אני רגוע. ממש רגוע. בכלל לא קופץ פה במקום.',
      female: 'עוד 15 דקות לטיול! אני רגועה. ממש רגועה. בכלל לא קופצת פה במקום.',
      neutral: 'עוד 15 דקות לטיול! הכל בשליטה. ממש בשליטה. אין שום קפיצות כאן, ממש לא.',
    },
  ],
  ['3', '{dogNoun} כבר עושה סיבובים ליד הדלת. עוד 15 דקות ל־{scheduledTime}!'],
  [
    '4',
    {
      male: 'שמעתי מישהו אומר "טיול"? לא? חבל, כי אני כבר מוכן 🐾',
      female: 'שמעתי מישהו אומר "טיול"? לא? חבל, כי אני כבר מוכנה 🐾',
      neutral: 'שמעתי מישהו אומר "טיול"? לא? חבל, כי כאן כבר הכל מוכן ליציאה 🐾',
    },
  ],
  [
    '5',
    {
      male: 'עוד קצת ו{dogNoun} יוצא לטיול של {scheduledTime}. הזנב כבר עובד שעות נוספות.',
      female: 'עוד קצת ו{dogNoun} יוצאת לטיול של {scheduledTime}. הזנב כבר עובד שעות נוספות.',
      neutral: 'עוד קצת ויוצאים לטיול של {scheduledTime} עם {dogNoun}. הזנב כבר עובד שעות נוספות.',
    },
  ],
  [
    '6',
    {
      male: '15 דקות. אני סופר. אני ממש סופר דקות עכשיו, {responsibleName}.',
      female: '15 דקות. אני סופרת. אני ממש סופרת דקות עכשיו, {responsibleName}.',
      neutral: '15 דקות. הספירה לאחור התחילה, ברצינות, {responsibleName}.',
    },
  ],
  ['7', 'טיול בעוד 15 דקות! זמן להתחיל להתרגש בשקט... או לא כל כך בשקט 🐕'],
  ['8', '{responsibleName} — הרצועה מתגעגעת אליך. עוד 15 דקות והיא תפגוש גם את {dogName}.'],
  [
    '9',
    {
      male: 'לא לחץ, אבל {dogName} כבר יושב ליד הדלת עם מבט של "עוד כמה זמן?"',
      female: 'לא לחץ, אבל {dogName} כבר יושבת ליד הדלת עם מבט של "עוד כמה זמן?"',
      neutral: 'לא לחץ, אבל ליד הדלת כבר מחכה מבט גדול שאומר "עוד כמה זמן?" (זה {dogName})',
    },
  ],
  [
    '10',
    {
      male: 'עוד 15 דקות לטיול של {scheduledTime}! מישהו כאן מתחיל להתרגש (זה אני. כן, אני מתכוון — אני).',
      female: 'עוד 15 דקות לטיול של {scheduledTime}! מישהו כאן מתחילה להתרגש (זו אני. כן, אני מתכוונת — אני).',
      neutral: 'עוד 15 דקות לטיול של {scheduledTime}! מישהו כאן כבר מתרגש (רמז: זה לא אתם).',
    },
  ],
  [
    '11',
    {
      male: 'תזכורת ידידותית: בעוד 15 דקות {dogName} הופך לגרסה הכי שמחה של עצמו.',
      female: 'תזכורת ידידותית: בעוד 15 דקות {dogName} הופכת לגרסה הכי שמחה של עצמה.',
      neutral: 'תזכורת ידידותית: בעוד 15 דקות מתחילה כאן הגרסה הכי שמחה של {dogName}.',
    },
  ],
  ['12', 'הספירה לאחור התחילה! 15 דקות ל־{scheduledTime}, וזנב אחד כבר מתחמם.'],
  ['13', '{responsibleName}, זו לא לחיצה. זו רק תזכורת עדינה שהטיול מתקרב 🐾😊'],
  [
    '14',
    {
      male: 'עוד 15 דקות ו{dogNoun} יוצא לטיול. אני כבר מתאמן על הבעת "אני ממש הופתעתי משמחה".',
      female: 'עוד 15 דקות ו{dogNoun} יוצאת לטיול. אני כבר מתאמנת על הבעת "אני ממש הופתעתי משמחה".',
      neutral: 'עוד 15 דקות ויוצאים לטיול עם {dogNoun}. כאן כבר מתאמנים על הבעת "וואו, איזו הפתעה!"',
    },
  ],
  ['15', 'שעון, שעון, שעון... עוד 15 דקות ל־{scheduledTime}! התרגשות באוויר, ולא רק אצל אחד.'],
  ['16', 'טיול בדרך! עוד 15 דקות ו{responsibleName} ו{dogName} יוצאים לכבוש את השכונה.'],
]);

// ---------------------------------------------------------------------------
// T — ready / walk time
// ---------------------------------------------------------------------------
const READY = t('ready', [
  [
    '1',
    {
      male: '{responsibleName}רר... השעה הגיעה. הרצועה מוכנה, אני מוכן, חסר לי רק בן אדם אחד 🤨',
      female: '{responsibleName}רר... השעה הגיעה. הרצועה מוכנה, אני מוכנה, חסר לי רק בן אדם אחד 🤨',
      neutral: '{responsibleName}רר... השעה הגיעה. הרצועה מוכנה, כאן הכל מוכן, חסר רק בן אדם אחד 🤨',
    },
  ],
  [
    '2',
    {
      male: 'השעה {scheduledTime}! {dogNoun} עומד ליד הדלת עם מבט של "נו, מה קורה?"',
      female: 'השעה {scheduledTime}! {dogNoun} עומדת ליד הדלת עם מבט של "נו, מה קורה?"',
      neutral: 'השעה {scheduledTime}! ליד הדלת מחכה מבט שאומר "נו, מה קורה?" (זה {dogNoun})',
    },
  ],
  [
    '3',
    {
      male: 'זה הזמן! הרצועה בפה (בהשאלה), הזנב בתנועה, {dogName} מוכן לצאת.',
      female: 'זה הזמן! הרצועה בפה (בהשאלה), הזנב בתנועה, {dogName} מוכנה לצאת.',
      neutral: 'זה הזמן! הרצועה בפה (בהשאלה), הזנב בתנועה — הגיע הרגע לצאת לטיול עם {dogName}.',
    },
  ],
  ['4', 'הגיע הזמן לטיול של {dogName}! {responsibleName}, עכשיו תורך לככב בהופעה הזאת 😄'],
  [
    '5',
    {
      male: 'תחנה: יציאה. שעה: {scheduledTime}. נוסע: {dogName}. מלווה: {responsibleName} (מקווים).',
      female: 'תחנה: יציאה. שעה: {scheduledTime}. נוסעת: {dogName}. מלווה: {responsibleName} (מקווים).',
      neutral: 'תחנה: יציאה. שעה: {scheduledTime}. על הרכבת: {dogName}. מלווה: {responsibleName} (מקווים).',
    },
  ],
  ['6', 'זהו זה, הגיע הרגע! {dogNoun} כבר בעמדת זינוק ליד הדלת.'],
  [
    '7',
    {
      male: 'השעון מראה {scheduledTime} — בדיוק הזמן שבו {dogName} הופך לגרסה הכי נלהבת של עצמו.',
      female: 'השעון מראה {scheduledTime} — בדיוק הזמן שבו {dogName} הופכת לגרסה הכי נלהבת של עצמה.',
      neutral: 'השעון מראה {scheduledTime} — בדיוק הזמן שבו מתחילה הגרסה הכי נלהבת של {dogName}.',
    },
  ],
  [
    '8',
    {
      male: 'זמן לצאת! {responsibleName}, {dogName} כבר סימן נוכחות ליד הדלת פי שלוש.',
      female: 'זמן לצאת! {responsibleName}, {dogName} כבר סימנה נוכחות ליד הדלת פי שלוש.',
      neutral: 'זמן לצאת! {responsibleName}, ליד הדלת כבר יש נוכחות מוצהרת, פי שלוש (זה {dogName}).',
    },
  ],
  ['9', 'הטיול של {scheduledTime} מתחיל עכשיו. {dogNoun} כבר במצב "בואו נזוז".'],
  ['10', 'תחנה אחת לפני הכיף: הדלת. {dogName} כבר שם, מחכה ל{responsibleName}.'],
  [
    '11',
    {
      male: 'רגע ההצדעה לרצועה הגיע. השעה {scheduledTime}, {dogNoun} מוכן. עכשיו התור שלכם.',
      female: 'רגע ההצדעה לרצועה הגיע. השעה {scheduledTime}, {dogNoun} מוכנה. עכשיו התור שלכם.',
      neutral: 'רגע ההצדעה לרצועה הגיע. השעה {scheduledTime}, הכל מוכן אצל {dogNoun}. עכשיו התור שלכם.',
    },
  ],
  [
    '12',
    {
      male: '{dogName} בודק את השעון (בעזרת מבט מאשים חמוד). זמן לטיול!',
      female: '{dogName} בודקת את השעון (בעזרת מבט מאשים חמוד). זמן לטיול!',
      neutral: 'השעון נבדק שוב (בעזרת מבט מאשים וחמוד במיוחד, מכיוונו של {dogName}). זמן לטיול!',
    },
  ],
  ['13', 'זהירות, מתקרב זנב מתנופף בקצב גבוה. הטיול של {scheduledTime} מתחיל עכשיו.'],
  [
    '14',
    'הכל מוכן: רצועה ✓ שקית ✓ מוטיבציה ✓✓✓ (זה {dogName}). מחכים רק ל{responsibleName}.',
  ],
  [
    '15',
    {
      male: 'זה הרגע! {dogNoun} כבר עומד בפוזיציית "אני ממש מוכן לצאת עכשיו, תודה".',
      female: 'זה הרגע! {dogNoun} כבר עומדת בפוזיציית "אני ממש מוכנה לצאת עכשיו, תודה".',
      neutral: 'זה הרגע! {dogNoun} כבר בפוזיציית "אפשר לצאת עכשיו בבקשה", ברור לגמרי.',
    },
  ],
  [
    '16',
    {
      male: 'טיק־טוק, {scheduledTime} כבר כאן. {dogName} שולח מבטים מלאי תקווה לעבר הדלת.',
      female: 'טיק־טוק, {scheduledTime} כבר כאן. {dogName} שולחת מבטים מלאי תקווה לעבר הדלת.',
      neutral: 'טיק־טוק, {scheduledTime} כבר כאן. לעבר הדלת נשלחים מבטים מלאי תקווה, מכיוונו של {dogName}.',
    },
  ],
]);

// ---------------------------------------------------------------------------
// T+15 — waiting / playful reminder
// ---------------------------------------------------------------------------
const WAITING = t('waiting', [
  [
    '1',
    {
      male: 'אני לא אומר ש{responsibleName} שכחו אותי... אבל אני גם לא לא אומר את זה 👀',
      female: 'אני לא אומרת ש{responsibleName} שכחו אותי... אבל אני גם לא לא אומרת את זה 👀',
      neutral: 'יש כאן תחושה קטנה שאולי {responsibleName} שכחו... אבל זו רק תחושה. אולי. 👀',
    },
  ],
  [
    '2',
    {
      male: '{dogNoun} עדיין מסתכל לכיוון הדלת. אולי כדאי לבדוק מה קורה עם הטיול של {scheduledTime}?',
      female: '{dogNoun} עדיין מסתכלת לכיוון הדלת. אולי כדאי לבדוק מה קורה עם הטיול של {scheduledTime}?',
      neutral: 'המבט עדיין מופנה לכיוון הדלת (זה {dogNoun}). אולי כדאי לבדוק מה קורה עם הטיול של {scheduledTime}?',
    },
  ],
  ['3', 'עדכון מהשטח: עדיין מחכה. הזנב האט קצת, אבל התקווה עוד בעיצומה.'],
  ['4', 'סתם תזכורת קטנה וחביבה — הטיול של {scheduledTime} עדיין לא יצא לדרך 🐾'],
  [
    '5',
    {
      male: '{dogName} מסתובב בבית, מסתכל מבעד לחלון, מתחיל לחשוד שמשהו קורה שם בחוץ בלעדיו.',
      female: '{dogName} מסתובבת בבית, מסתכלת מבעד לחלון, מתחילה לחשוד שמשהו קורה שם בחוץ בלעדיה.',
      neutral: 'יש כאן סיבובים בבית, הצצות מבעד לחלון, וחשד גובר שמשהו קורה שם בחוץ בלי {dogName}.',
    },
  ],
  ['6', 'הראש קצת מוטה בצד, המבט קצת תוהה — {dogNoun} תוהה איפה {responsibleName}.'],
  [
    '7',
    {
      male: 'ממתין בסבלנות (יחסית). הטיול של {scheduledTime} עדיין על הכוונת.',
      female: 'ממתינה בסבלנות (יחסית). הטיול של {scheduledTime} עדיין על הכוונת.',
      neutral: 'יש כאן המתנה בסבלנות (יחסית). הטיול של {scheduledTime} עדיין על הכוונת.',
    },
  ],
  [
    '8',
    {
      male: 'שום דרמה. רק {dogNoun} שמסתכל על השעון (בעזרת עיניים גדולות ומבט תמים).',
      female: 'שום דרמה. רק {dogNoun} שמסתכלת על השעון (בעזרת עיניים גדולות ומבט תמים).',
      neutral: 'שום דרמה. רק מבט תמים ועיניים גדולות, מופנות לעבר השעון (זה {dogNoun}).',
    },
  ],
  [
    '9',
    {
      male: '{responsibleName}, {dogName} התחיל לספור על האצבעות (זה קצת קשה בלי אגודלים, אבל הוא מנסה).',
      female: '{responsibleName}, {dogName} התחילה לספור על האצבעות (זה קצת קשה בלי אגודלים, אבל היא מנסה).',
      neutral: '{responsibleName}, אצל {dogName} כבר מתחיל ניסיון לספור על האצבעות (קצת קשה בלי אגודלים, אבל יש מוטיבציה).',
    },
  ],
  [
    '10',
    {
      male: 'עדיין כאן, עדיין מחכה, עדיין הכי חמוד שיש. הטיול של {scheduledTime} מחכה גם הוא.',
      female: 'עדיין כאן, עדיין מחכה, עדיין הכי חמודה שיש. הטיול של {scheduledTime} מחכה גם הוא.',
      neutral: 'עדיין כאן, עדיין מחכים, עדיין באותה רמת חמידות בדיוק. הטיול של {scheduledTime} מחכה גם הוא.',
    },
  ],
  [
    '11',
    {
      male: '{dogNoun} עשה עוד סיבוב ליד הדלת. זה הסיבוב השלישי. מישהו סופר.',
      female: '{dogNoun} עשתה עוד סיבוב ליד הדלת. זה הסיבוב השלישי. מישהו סופר.',
      neutral: 'עוד סיבוב ליד הדלת, מכיוונו של {dogNoun}. זה הסיבוב השלישי. מישהו כאן סופר.',
    },
  ],
  ['12', 'מבט תוהה לעבר החלון, מבט תוהה לעבר {responsibleName}. הטיול עדיין מחכה שם, אולי?'],
  ['13', 'עוד קצת ואני אתחיל להביא לך את הרצועה ולהניח אותה ליד הרגליים שלך. רמז עדין.'],
  [
    '14',
    {
      male: 'הטיול משעה {scheduledTime} עדיין לא יצא לדרך. {dogName} שולח מבטים מלאי תקווה.',
      female: 'הטיול משעה {scheduledTime} עדיין לא יצא לדרך. {dogName} שולחת מבטים מלאי תקווה.',
      neutral: 'הטיול משעה {scheduledTime} עדיין לא יצא לדרך. מבטים מלאי תקווה נשלחים, מכיוונו של {dogName}.',
    },
  ],
  [
    '15',
    {
      male: '{dogNoun} מתחיל לתכנן מסלול לבד. בבדיחה. כמעט.',
      female: '{dogNoun} מתחילה לתכנן מסלול לבד. בבדיחה. כמעט.',
      neutral: 'אצל {dogNoun} כבר מתחיל תכנון מסלול עצמאי. בבדיחה. כמעט.',
    },
  ],
  ['16', 'תזכורת רכה: עדיין מחכים לטיול. אין לחץ, רק... זנב שמחכה בסבלנות מוגבלת.'],
]);

// ---------------------------------------------------------------------------
// T+30 — concerned / humorous, never scary
// ---------------------------------------------------------------------------
const CONCERNED = t('concerned', [
  ['1', 'עדכון מהשטח: עדיין בבית. המצב קשה. החטיפים אוזלים. שלחו עזרה. 🐶'],
  [
    '2',
    {
      male: '{dogNoun} שוכב ליד הדלת במין פוזה דרמטית במיוחד. הוא בסדר, פשוט מפיק את זה.',
      female: '{dogNoun} שוכבת ליד הדלת במין פוזה דרמטית במיוחד. היא בסדר, פשוט מפיקה את זה.',
      neutral: 'ליד הדלת יש שכיבה בפוזה דרמטית במיוחד (זה {dogNoun}). הכל בסדר, זו פשוט הפקה.',
    },
  ],
  ['3', 'דיווח רשמי: הטיול משעה {scheduledTime} טרם יצא לדרך. האוזניים קצת צנחו, אבל הזנב עדיין מקווה.'],
  ['4', '{responsibleName}... אני כאן. עדיין. עם הרצועה. עם התקווה. עם קצת דרמה.'],
  [
    '5',
    {
      male: 'מצב דיווח: {dogNoun} שוכב בפוזת "נטוש" (מוגזמת בכוונה). הטיול עדיין מחכה.',
      female: 'מצב דיווח: {dogNoun} שוכבת בפוזת "נטושה" (מוגזמת בכוונה). הטיול עדיין מחכה.',
      neutral: 'מצב דיווח: פוזת "עזוב לנפשו" בעיצומה, מוגזמת בכוונה (זה {dogNoun}). הטיול עדיין מחכה.',
    },
  ],
  [
    '6',
    {
      male: '{dogName} שוקל לכתוב יומן. הפרק היום: "היום, שוב, חיכיתי לטיול".',
      female: '{dogName} שוקלת לכתוב יומן. הפרק היום: "היום, שוב, חיכיתי לטיול".',
      neutral: 'יש כאן מחשבה על כתיבת יומן (זה {dogName}). הפרק היום: "היום, שוב, חיכיתי לטיול".',
    },
  ],
  [
    '7',
    {
      male: 'המצב: דרמטי. המציאות: {dogNoun} ישן ליד הדלת חצי מהזמן ומקווה בחצי השני.',
      female: 'המצב: דרמטי. המציאות: {dogNoun} ישנה ליד הדלת חצי מהזמן ומקווה בחצי השני.',
      neutral: 'המצב: דרמטי. המציאות: חצי מהזמן שינה ליד הדלת, חצי מהזמן תקווה (זה {dogNoun}).',
    },
  ],
  [
    '8',
    {
      male: 'זה כבר חצי שעה מ{scheduledTime}. {dogName} מתחיל לתרגל את מבט ה"אני לא כועס, רק קצת מאוכזב".',
      female: 'זה כבר חצי שעה מ{scheduledTime}. {dogName} מתחילה לתרגל את מבט ה"אני לא כועסת, רק קצת מאוכזבת".',
      neutral: 'זה כבר חצי שעה מ{scheduledTime}. אצל {dogName} כבר מתאמן מבט ה"לא כועסים, רק קצת מאוכזבים".',
    },
  ],
  ['9', 'קול קורא מהחזית: יש כאן זנב שמחכה, אוזניים קצת נמוכות, ותקווה שעדיין לא איבדה תוקף.'],
  ['10', '{responsibleName}, הטיול של {scheduledTime} עדיין כאן, ממתין בסבלנות דרמטית משהו.'],
  [
    '11',
    {
      male: 'מבזק: {dogNoun} שוכב ליד הדלת ומביט בה במבט שאומר "בכל רגע עכשיו, נכון?"',
      female: 'מבזק: {dogNoun} שוכבת ליד הדלת ומביטה בה במבט שאומר "בכל רגע עכשיו, נכון?"',
      neutral: 'מבזק: שכיבה ליד הדלת, ומבט ישיר עליה שאומר "בכל רגע עכשיו, נכון?" (זה {dogNoun})',
    },
  ],
  [
    '12',
    {
      male: 'עדיין מחכה. עדיין חמוד. עדיין קצת פחות אנרגטי ממה שהיה לפני חצי שעה.',
      female: 'עדיין מחכה. עדיין חמודה. עדיין קצת פחות אנרגטית ממה שהייתה לפני חצי שעה.',
      neutral: 'עדיין מחכים. עדיין באותה רמת חמידות. עדיין קצת פחות אנרגיה מלפני חצי שעה.',
    },
  ],
  [
    '13',
    {
      male: '{dogName} כתב בקשה רשמית לטיול. היא מנוסחת בעיקר בזנב ובעיניים גדולות.',
      female: '{dogName} כתבה בקשה רשמית לטיול. היא מנוסחת בעיקר בזנב ובעיניים גדולות.',
      neutral: 'יש כאן בקשה רשמית לטיול (מטעם {dogName}), מנוסחת בעיקר בזנב ובעיניים גדולות.',
    },
  ],
  ['14', 'עדכון דרמטי (אבל לא ממש): הרצועה עדיין תלויה, {dogNoun} עדיין מחכה, הכל עוד יהיה בסדר.'],
]);

// ---------------------------------------------------------------------------
// success — walk completed / celebration
// ---------------------------------------------------------------------------
const SUCCESS = t('success', [
  [
    '1',
    {
      male: 'כל הכבוד! עוד טיול הושלם. אני הייתי מצוין, כמובן. 🏆🐾',
      female: 'כל הכבוד! עוד טיול הושלם. אני הייתי מצוינת, כמובן. 🏆🐾',
      neutral: 'כל הכבוד! עוד טיול הושלם. הביצועים כאן היו מצוינים, כמובן. 🏆🐾',
    },
  ],
  [
    '2',
    {
      male: '{dogName} חזר מהטיול עם זנב מתנופף וגאווה בעיניים. משימה הושלמה!',
      female: '{dogName} חזרה מהטיול עם זנב מתנופף וגאווה בעיניים. משימה הושלמה!',
      neutral: 'חזרה מהטיול, זנב מתנופף, גאווה בעיניים (זה {dogName}). משימה הושלמה!',
    },
  ],
  [
    '3',
    'טיול הושלם בהצלחה! {responsibleName}, היום אתם הגיבורים (וגם אצל {dogName} יש בהחלט הרגשה דומה).',
  ],
  ['4', 'ניצחון! הטיול הסתיים, הרגליים עייפות (של {dogName}, לא שלך), הלב שמח.'],
  [
    '5',
    {
      male: '🎉 הטיול הושלם! {dogNoun} כבר מתכנן את הטיול הבא, כי כן, זה ככה עובד.',
      female: '🎉 הטיול הושלם! {dogNoun} כבר מתכננת את הטיול הבא, כי כן, זה ככה עובד.',
      neutral: '🎉 הטיול הושלם! כבר יש תכנון בעיצומו לטיול הבא (זה {dogNoun}), כי כן, זה ככה עובד.',
    },
  ],
  [
    '6',
    {
      male: 'משימה הושלמה בהצלחה מרשימה. {dogName} מבקש להודיע שהיה כלב מצוין בטיול.',
      female: 'משימה הושלמה בהצלחה מרשימה. {dogName} מבקשת להודיע שהייתה כלבה מצוינת בטיול.',
      neutral: 'משימה הושלמה בהצלחה מרשימה. יש כאן הודעה רשמית: הטיול הזה היה מצוין, בזכות {dogName}.',
    },
  ],
  ['7', 'טיול ✓ הליכה ✓ ריחות חדשים שנבדקו בקפידה ✓. יום מוצלח ל{dogName}.'],
  ['8', '{responsibleName} ו{dogName} חוזרים מהטיול כמו צוות מנצח. כל הכבוד לשניכם!'],
  [
    '9',
    {
      male: 'עוד טיול נכנס לספר השיאים המשפחתי (של {dogName}, שמנהל אותו בקפידה).',
      female: 'עוד טיול נכנס לספר השיאים המשפחתי (של {dogName}, שמנהלת אותו בקפידה).',
      neutral: 'עוד טיול נכנס לספר השיאים המשפחתי, מתועד בקפידה רבה (באחריות {dogName}).',
    },
  ],
  ['10', 'הטיול הסתיים בהצלחה! עכשיו מגיע הזמן החשוב באמת — מנוחה ומים.'],
  [
    '11',
    {
      male: '🐾 סיום מוצלח! {dogNoun} כבר מסתכל על השעון וסופר עד הטיול הבא.',
      female: '🐾 סיום מוצלח! {dogNoun} כבר מסתכלת על השעון וסופרת עד הטיול הבא.',
      neutral: '🐾 סיום מוצלח! השעון כבר נבדק, והספירה לטיול הבא התחילה (זה {dogNoun}).',
    },
  ],
  ['12', 'טיול הושלם! תיעוד רשמי: זנב מאושר, ריח של חוץ, וחיוך גדול (כן, גם לכלבים יש).'],
  [
    '13',
    {
      male: 'איזה טיול! {dogName} חוזר הביתה מרוצה, ו{responsibleName} זוכים בנקודות זכות רשמיות.',
      female: 'איזה טיול! {dogName} חוזרת הביתה מרוצה, ו{responsibleName} זוכים בנקודות זכות רשמיות.',
      neutral: 'איזה טיול! חזרה הביתה מרוצה (זה {dogName}), ו{responsibleName} זוכים בנקודות זכות רשמיות.',
    },
  ],
  [
    '14',
    {
      male: 'משימה הושלמה: הטיול, כן. הכיף, גם. {dogNoun} מדרג את הטיול הזה ב-5 מתוך 5 זנבות.',
      female: 'משימה הושלמה: הטיול, כן. הכיף, גם. {dogNoun} מדרגת את הטיול הזה ב-5 מתוך 5 זנבות.',
      neutral: 'משימה הושלמה: הטיול, כן. הכיף, גם. הדירוג הרשמי (מטעם {dogNoun}): 5 מתוך 5 זנבות.',
    },
  ],
  ['15', 'הטיול נגמר, אבל הזיכרון (וכמה ריחות מעניינים) נשארים. כל הכבוד!'],
  [
    '16',
    {
      male: 'עוד ניצחון קטן ליומן: הטיול הושלם, {dogName} מאושר, והבית שקט לעוד כמה שעות.',
      female: 'עוד ניצחון קטן ליומן: הטיול הושלם, {dogName} מאושרת, והבית שקט לעוד כמה שעות.',
      neutral: 'עוד ניצחון קטן ליומן: הטיול הושלם, האושר ניכר (זה {dogName}), והבית שקט לעוד כמה שעות.',
    },
  ],
]);

// ---------------------------------------------------------------------------
// early completion — marked done well before the scheduled overdue window
// ---------------------------------------------------------------------------
const EARLY_COMPLETION = t('earlyCompletion', [
  [
    '1',
    {
      male: 'וואו, מהיר! {dogName} בקושי הספיק להתרגש וכבר הכל הושלם.',
      female: 'וואו, מהירה! {dogName} בקושי הספיקה להתרגש וכבר הכל הושלם.',
      neutral: 'וואו, איזו מהירות! בקושי היה זמן להתרגש (זה {dogName}), וכבר הכל הושלם.',
    },
  ],
  ['2', 'טיול מהיר ויעיל! {responsibleName}, זה קצב של אלופים.'],
  ['3', 'זה מה שנקרא "לא לבזבז זמן". טיול הושלם מוקדם מהצפוי!'],
  [
    '4',
    {
      male: '{dogNoun} עוד לא הספיק לספור זנבות והטיול כבר הסתיים. יעילות מרשימה!',
      female: '{dogNoun} עוד לא הספיקה לספור זנבות והטיול כבר הסתיים. יעילות מרשימה!',
      neutral: 'עוד לא היה זמן לספור זנבות (זה {dogNoun}) והטיול כבר הסתיים. יעילות מרשימה!',
    },
  ],
  ['5', 'טיול חטוף אבל אפקטיבי — {dogName} כבר בבית ומרוצה.'],
  ['6', 'מהירות ברק! הטיול הושלם עוד לפני שהספקתי לעצבן אתכם עם תזכורת נוספת.'],
  ['7', 'כל הכבוד על היוזמה — הטיול הושלם מוקדם, ו{dogName} כבר במנוחה.'],
  ['8', 'מהיר, יעיל, ומלא אהבה. בדיוק ככה טיולים אמורים להיראות.'],
]);

// ---------------------------------------------------------------------------
// late completion — resolved after real delay/escalation
// ---------------------------------------------------------------------------
const LATE_COMPLETION = t('lateCompletion', [
  [
    '1',
    {
      male: 'הגענו! מאוחר, אבל הגענו. {dogName} סולח (בעיקר כי יש עכשיו טיול).',
      female: 'הגענו! מאוחר, אבל הגענו. {dogName} סולחת (בעיקר כי יש עכשיו טיול).',
      neutral: 'הגענו! מאוחר, אבל הגענו. הסליחה כבר בדרך (בעיקר כי יש עכשיו טיול, מטעם {dogName}).',
    },
  ],
  ['2', 'טוב מאוחר מאשר אף פעם — הטיול הושלם, וגם הדרמה הקטנה הסתיימה בטוב.'],
  [
    '3',
    {
      male: '{responsibleName}, תודה שהגעת! {dogNoun} כבר התחיל לתכנן נאום תודה.',
      female: '{responsibleName}, תודה שהגעת! {dogNoun} כבר התחילה לתכנן נאום תודה.',
      neutral: '{responsibleName}, תודה שהגעת! אצל {dogNoun} כבר מתחיל להתגבש נאום תודה.',
    },
  ],
  ['4', 'איחור קטן, סיום גדול. הטיול הושלם, וכולם מרוצים (אולי קצת יותר {dogName}).'],
  [
    '5',
    {
      male: 'הטיול קרה בסוף! {dogName} כבר שוכח מהר מאוד את ההמתנה ופשוט נהנה עכשיו.',
      female: 'הטיול קרה בסוף! {dogName} כבר שוכחת מהר מאוד את ההמתנה ופשוט נהנית עכשיו.',
      neutral: 'הטיול קרה בסוף! ההמתנה כבר נשכחת, ונשארת רק ההנאה מהרגע (זה {dogName}).',
    },
  ],
  ['6', 'זה לקח קצת זמן, אבל הטיול הושלם וכולם יכולים לנשום לרווחה.'],
  ['7', 'הדרמה של קודם? נשכחה. יש עכשיו טיול, ו{dogName} מרוצה מאוד.'],
  [
    '8',
    {
      male: 'סוף טוב הכל טוב! הטיול קרה, {dogName} מאושר, והסיפור מסתיים בטוב.',
      female: 'סוף טוב הכל טוב! הטיול קרה, {dogName} מאושרת, והסיפור מסתיים בטוב.',
      neutral: 'סוף טוב הכל טוב! הטיול קרה, האושר ניכר (זה {dogName}), והסיפור מסתיים בטוב.',
    },
  ],
]);

// ---------------------------------------------------------------------------
// time-of-day / context flavor — not tied to a specific reminder stage
// ---------------------------------------------------------------------------
const MORNING = t('morning', [
  [
    '1',
    {
      male: 'בוקר טוב! {dogName} כבר ער ומלא מרץ (הרבה יותר מכל אחד אחר בבית כרגע).',
      female: 'בוקר טוב! {dogName} כבר ערה ומלאת מרץ (הרבה יותר מכל אחד אחר בבית כרגע).',
      neutral: 'בוקר טוב! אצל {dogName} כבר יש ערות מלאה ומרץ בשפע (הרבה יותר מכל אחד אחר בבית כרגע).',
    },
  ],
  ['2', 'שמש, קפה (לכם), מים (ל{dogName}) — בוקר טוב ויום טוב לכולם!'],
  ['3', 'הטיול הראשון של היום מתקרב! {dogNoun} כבר במצב "בוקר נהדר, בואו נצא".'],
  [
    '4',
    {
      male: 'בוקר טוב למשפחה! {dogName} מבקש להזכיר שהיום הכי טוב מתחיל בטיול בוקר.',
      female: 'בוקר טוב למשפחה! {dogName} מבקשת להזכיר שהיום הכי טוב מתחיל בטיול בוקר.',
      neutral: 'בוקר טוב למשפחה! תזכורת ידידותית (מטעם {dogName}): היום הכי טוב מתחיל בטיול בוקר.',
    },
  ],
  ['5', 'עוד יום, עוד טיולים, עוד הרפתקאות קטנות. בוקר טוב מ{dogName}!'],
  [
    '6',
    {
      male: 'בוקר של אנרגיה טרייה — {dogNoun} כבר מוכן ליום שלם של כיף.',
      female: 'בוקר של אנרגיה טרייה — {dogNoun} כבר מוכנה ליום שלם של כיף.',
      neutral: 'בוקר של אנרגיה טרייה — הכל כבר מוכן ליום שלם של כיף (זה {dogNoun}).',
    },
  ],
]);

const EVENING = t('evening', [
  ['1', 'ערב נעים! עוד טיול אחד קטן, ואז מנוחה מגיעה לכולם.'],
  [
    '2',
    {
      male: 'השמש שוקעת, {dogName} עדיין מלא מרץ — טיול ערב, מישהו?',
      female: 'השמש שוקעת, {dogName} עדיין מלאת מרץ — טיול ערב, מישהו?',
      neutral: 'השמש שוקעת, המרץ עדיין כאן במלואו (זה {dogName}) — טיול ערב, מישהו?',
    },
  ],
  ['3', 'סוף היום מתקרב, וגם עוד הזדמנות אחת ל{dogName} לרוץ קצת אוויר.'],
  ['4', 'ערב טוב! זה הזמן המושלם לטיול רגוע וסיכום יום.'],
  ['5', 'היום כמעט נגמר, אבל עוד טיול אחד קטן תמיד שווה את זה.'],
  ['6', 'ערב שקט, טיול קצר, ואז — כרית וחלומות על ריחות מהיום.'],
]);

const WEEKEND = t('weekend', [
  ['1', 'סוף שבוע! זה אומר יותר זמן, יותר טיולים, ויותר זנב מתנופף.'],
  ['2', 'יום חופש למשפחה — אבל {dogName} עדיין מצפה לטיול, כמו תמיד.'],
  ['3', 'סוף שבוע נהדר להתחיל בטיול איטי ונעים, בלי לחץ של שעון.'],
  ['4', 'אין בית ספר, אין עבודה, יש רק טיול נחמד עם {dogName} — סוף שבוע מושלם.'],
  [
    '5',
    {
      male: '{dogNoun} כבר יודע שזה סוף שבוע — משהו בזנב מרגיש את זה קודם.',
      female: '{dogNoun} כבר יודעת שזה סוף שבוע — משהו בזנב מרגיש את זה קודם.',
      neutral: 'אצל {dogNoun} כבר יש ידיעה ברורה שזה סוף שבוע — משהו בזנב מרגיש את זה קודם.',
    },
  ],
  ['6', 'סוף שבוע = יותר זמן משפחה, יותר טיולים, יותר כיף לכולם.'],
]);

const ENCOURAGEMENT = t('encouragement', [
  ['1', 'אתם עושים עבודה נהדרת עם {dogName}! כל טיול קטן חשוב.'],
  ['2', 'המשפחה הזו יודעת לדאוג ל{dogNoun}. כל הכבוד על העקביות!'],
  [
    '3',
    {
      male: '{dogName} הכי בר מזל שיש לו משפחה כזאת שדואגת לטיולים.',
      female: '{dogName} הכי ברת מזל שיש לה משפחה כזאת שדואגת לטיולים.',
      neutral: 'אצל {dogName} יש הרבה מזל במשפחה כזאת שדואגת לטיולים.',
    },
  ],
  ['4', 'כל טיול, גם הקצר ביותר, עושה את היום של {dogName} טוב יותר. תודה שאכפת לכם.'],
  ['5', 'זו לא רק חובה — זה זמן איכות עם {dogName}. תיהנו מזה!'],
  ['6', 'משפחה שמטיילת ביחד עם {dogNoun} — יש בזה משהו מיוחד.'],
  [
    '7',
    {
      male: 'תודה שממשיכים לדאוג ל{dogName} כל יום. זה לא נראה לו מובן מאליו.',
      female: 'תודה שממשיכים לדאוג ל{dogName} כל יום. זה לא נראה לה מובן מאליו.',
      neutral: 'תודה שממשיכים לדאוג ל{dogName} כל יום. זו לא הנחה מובנת מאליה.',
    },
  ],
  ['8', 'כל טיול הוא סימן קטן לאהבה גדולה. תמשיכו ככה!'],
]);

export const MESSAGE_LIBRARY: MessageTemplate[] = [
  ...EXCITED,
  ...READY,
  ...WAITING,
  ...CONCERNED,
  ...SUCCESS,
  ...EARLY_COMPLETION,
  ...LATE_COMPLETION,
  ...MORNING,
  ...EVENING,
  ...WEEKEND,
  ...ENCOURAGEMENT,
];

export const MESSAGE_COUNT_BY_CATEGORY: Record<MessageCategory, number> = MESSAGE_LIBRARY.reduce(
  (acc, m) => {
    acc[m.category] = (acc[m.category] ?? 0) + 1;
    return acc;
  },
  {} as Record<MessageCategory, number>
);
