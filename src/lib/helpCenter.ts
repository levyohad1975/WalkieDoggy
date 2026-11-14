/**
 * Help & Support content (replaces the never-recorded tutorial video entry).
 *
 * Plain text only: no media, no network, no external service — it adds a
 * few KB to the bundle. Answers name the exact on-screen labels so a user
 * can follow them; keep them in sync when those labels change.
 */

export interface HelpItem {
  id: string;
  question: string;
  answer: string;
  /** Extra words people may search with that are not in the text itself. */
  keywords?: string[];
}

export interface HelpCategory {
  id: string;
  title: string;
  items: HelpItem[];
}

export const HELP_CATEGORIES: HelpCategory[] = [
  {
    id: 'start',
    title: '🏠 התחלה ומשפחה',
    items: [
      {
        id: 'install',
        question: 'איך מתקינים את האפליקציה על הטלפון?',
        answer:
          'באייפון: פותחים את walkielink.co.il ב-Safari, לוחצים על כפתור השיתוף ובוחרים "הוסף למסך הבית". באנדרואיד: פותחים ב-Chrome, לוחצים על תפריט שלוש הנקודות ובוחרים "התקנת אפליקציה" או "הוספה למסך הבית". מעכשיו פותחים את האפליקציה מהאייקון במסך הבית.',
        keywords: ['התקנה', 'אייקון', 'מסך הבית', 'קיצור דרך', 'safari', 'chrome', 'אנדרואיד', 'אייפון'],
      },
      {
        id: 'join',
        question: 'איך מצרפים בן משפחה?',
        answer:
          'מנהל המשפחה מוסיף אותו בלשונית "משפחה" ← "+ הוספת בן משפחה", ואז משתף את קוד המשפחה: הגדרות ← "🔗 שיתוף המשפחה" ← "שתף קוד". בן המשפחה פותח את walkielink.co.il, בוחר "הצטרפות עם קוד משפחה", מזין את הקוד ובוחר את השם שלו.',
        keywords: ['הזמנה', 'קוד', 'הצטרפות', 'להוסיף', 'בן משפחה', 'הזמין'],
      },
      {
        id: 'new-device',
        question: 'נכנסתי ממכשיר חדש ומבקשים ממני קוד PIN',
        answer:
          'כשפרופיל כבר מחובר במכשיר אחר, צריך את קוד ה-PIN של הפרופיל כדי להתחבר אליו גם במכשיר החדש. אם שכחתם את הקוד, פנו למנהל המשפחה.',
        keywords: ['פין', 'סיסמה', 'מכשיר חדש', 'טלפון חדש', 'התחברות'],
      },
      {
        id: 'roles',
        question: 'מה ההבדל בין מנהל משפחה לבן משפחה?',
        answer:
          'מנהל המשפחה מגדיר את בני המשפחה, הכלבים ושגרת הטיולים הקבועה, מאשר בקשות שינוי שעה וקובע מה כל אחד רואה. בני המשפחה יוצאים לטיולים, מסמנים אותם, מבקשים החלפות ומשתמשים בצ׳אט.',
        keywords: ['הרשאות', 'מנהל', 'אדמין', 'תפקיד'],
      },
    ],
  },
  {
    id: 'walks',
    title: '🚶 טיולים',
    items: [
      {
        id: 'start-walk',
        question: 'איך מתחילים ומסיימים טיול?',
        answer:
          'במסך הבית, בכרטיס הטיול הבא, לוחצים "התחל טיול" ובוחרים מי יוצא. בזמן הטיול אפשר לסמן פיפי וקקי בכפתורים שבכרטיס. בסוף לוחצים "סיים טיול".',
        keywords: ['להתחיל', 'לסיים', 'יציאה', 'פיפי', 'קקי'],
      },
      {
        id: 'unplanned',
        question: 'יצאתי לטיול שלא היה בלו״ז',
        answer: 'במסך הבית לוחצים "הוסף טיול" ומזינים את הפרטים. הטיול יירשם בהיסטוריה כמו כל טיול אחר.',
        keywords: ['לא מתוכנן', 'ספונטני', 'טיול נוסף', 'להוסיף טיול'],
      },
      {
        id: 'forgot-mark',
        question: 'שכחתי לסמן טיול, או סימנתי בטעות',
        answer:
          'בלשונית "לו״ז" בוחרים את היום, ובטיול עצמו מסמנים "✓" (בוצע) או "✕ לא בוצע". את הטיול האחרון אפשר גם לערוך ממסך הבית.',
        keywords: ['לתקן', 'טעות', 'עריכה', 'בוצע', 'לא בוצע', 'ממתין לעדכון'],
      },
      {
        id: 'routine',
        question: 'איך קובעים טיולים קבועים?',
        answer:
          'מנהל המשפחה נכנס ללשונית "לו״ז" ← "ניהול שגרה" ← "הוספת טיול קבוע", בוחר שעה, ימים ומי אחראי. הטיולים ייווצרו אוטומטית בכל שבוע.',
        keywords: ['שגרה', 'קבוע', 'לוח זמנים', 'שבועי', 'שעה קבועה'],
      },
    ],
  },
  {
    id: 'requests',
    title: '🔄 החלפות ובקשות',
    items: [
      {
        id: 'swap',
        question: 'איך מבקשים להחליף טיול עם מישהו?',
        answer:
          'בלשונית "לו״ז", בטיול שלכם, לוחצים "בקש החלפה" ובוחרים עם איזה טיול להחליף. בן המשפחה השני מקבל בקשה, ואם הוא מאשר שני הטיולים מתחלפים.',
        keywords: ['החלפה', 'להתחלף', 'לא יכול', 'תור'],
      },
      {
        id: 'time-change',
        question: 'איך מבקשים לשנות שעה של טיול?',
        answer:
          'בלשונית "לו״ז", בטיול שלכם, לוחצים "בקש שינוי שעה", בוחרים שעה חדשה ושולחים. הבקשה מגיעה למנהל המשפחה לאישור, והשעה משתנה רק אחרי שהוא מאשר.',
        keywords: ['שינוי שעה', 'להזיז', 'לדחות', 'מאוחר', 'מוקדם'],
      },
      {
        id: 'pending',
        question: 'איפה רואים בקשות שמחכות לי?',
        answer: 'בקשות שמחכות לתשובה מופיעות בכרטיס בראש מסך הבית, ושם אפשר לאשר או לדחות. כל הבקשות, כולל אלה שכבר טופלו, נמצאות בפעמון הצהוב בפינה העליונה של מסך הבית.',
        keywords: ['פעמון', 'בקשות', 'ממתין', 'אישור'],
      },
    ],
  },
  {
    id: 'notifications',
    title: '🔔 התראות',
    items: [
      {
        id: 'enable',
        question: 'איך מפעילים התראות?',
        answer:
          'במסך הבית לוחצים "🔔 ההתראות שלי" (או בהגדרות ← "⏰ תזכורות והתראות") ← "אפשר התראות", ומאשרים את הבקשה של הטלפון. באייפון ההתראות עובדות רק כשהאפליקציה מותקנת במסך הבית ונפתחת משם.',
        keywords: ['פוש', 'תזכורת', 'להפעיל', 'notification'],
      },
      {
        id: 'not-arriving',
        question: 'ההתראות לא מגיעות',
        answer:
          'כדאי לבדוק: (1) שהאפליקציה מותקנת במסך הבית ונפתחת משם; (2) בהגדרות הטלפון ← עדכונים / התראות ← Walkie Doggy — שההתראות מותרות; (3) ש"נא לא להפריע" או מצב ריכוז לא פעילים; (4) באפליקציה, ב"🔔 ההתראות שלי", שכתוב שהמכשיר רשום להתראות. אם לא, לוחצים שוב "אפשר התראות".',
        keywords: ['לא מקבל', 'פוש', 'לא עובד', 'שקט', 'ריכוז'],
      },
      {
        id: 'mute-chat',
        question: 'איך משתיקים התראות של שיחה בצ׳אט?',
        answer: 'בתוך השיחה פותחים את "אפשרויות שיחה" ומכבים את ההתראות על הודעות חדשות בשיחה הזו.',
        keywords: ['השתקה', 'להשתיק', 'צאט', 'רעש'],
      },
    ],
  },
  {
    id: 'gps',
    title: '📍 GPS ומיקום',
    items: [
      {
        id: 'gps-how',
        question: 'איך עובד ה-GPS בטיול?',
        answer:
          'ה-GPS נאסף רק בזמן טיול פעיל, ורק בטלפון של מי שיוצא לטיול. צריך לאשר לאפליקציה גישה למיקום, ומומלץ להשאיר אותה פתוחה בזמן הטיול כדי שהמרחק יימדד במלואו.',
        keywords: ['מיקום', 'מפה', 'מרחק', 'מסלול', 'מעקב'],
      },
      {
        id: 'gps-remote',
        question: 'מה זה הפעלת GPS מרחוק?',
        answer:
          'כשבן משפחה יוצא לטיול, אפשר לבקש מהטלפון שלו להתחיל לאסוף GPS. כדי שזה יעבוד, מנהל המשפחה מאפשר את זה בהגדרות ← "🛰️ GPS ומעקב מרחוק", וכל בן משפחה מסמן שם שהוא מסכים. הבקשה נשלחת להתראה בטלפון שלו, והמעקב מתחיל רק אחרי שהוא מאשר.',
        keywords: ['מרחוק', 'הסכמה', 'בקשת gps'],
      },
      {
        id: 'gps-error',
        question: 'קיבלתי הודעת שגיאה על GPS בסוף טיול',
        answer:
          'הטיול עצמו נשמר. ההודעה אומרת רק שנתוני המיקום לא נשמרו במלואם, לרוב בגלל חיבור חלש. אם ההודעה חוזרת, שלחו לנו את הקוד שמופיע בה (למשל GPS-N).',
        keywords: ['שגיאה', 'אופס', 'קוד', 'נכשל'],
      },
    ],
  },
  {
    id: 'chat',
    title: '💬 צ׳אט',
    items: [
      {
        id: 'chat-basics',
        question: 'מה יש בצ׳אט?',
        answer:
          'בלשונית "צ׳אט" יש את הצ׳אט המשפחתי, שכל המשפחה רואה, ושיחות פרטיות בין שני בני משפחה. אפשר לשלוח הודעות ותמונות מהגלריה או מהמצלמה.',
        keywords: ['הודעה', 'תמונה', 'פרטי', 'שיחה'],
      },
      {
        id: 'chat-delete',
        question: 'איך מוחקים הודעה?',
        answer:
          'לוחצים לחיצה ארוכה על ההודעה ובוחרים מחיקה. הודעה שנמחקה נעלמת אצל כולם. אפשר גם לנקות את ההיסטוריה רק אצלכם, דרך "אפשרויות שיחה".',
        keywords: ['למחוק', 'מחיקה', 'לנקות'],
      },
    ],
  },
  {
    id: 'account',
    title: '🔐 חשבון ופרטיות',
    items: [
      {
        id: 'privacy',
        question: 'מי רואה את המידע שלנו?',
        answer:
          'רק בני המשפחה שלכם. בני משפחה אחרים לא רואים אתכם, ומיקום נאסף רק בזמן טיול פעיל. פרטים נוספים בהגדרות ← "📍 מיקום, GPS ונגישות".',
        keywords: ['פרטיות', 'אבטחה', 'מידע', 'מיקום'],
      },
    ],
  },
];

/** Hebrew-aware fold: drops niqqud and punctuation, unifies geresh/quote marks, lower-cases Latin. */
export function normalizeHelpText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '')
    .replace(/[׳'`´״"“”]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface HelpSearchResult {
  categoryTitle: string;
  item: HelpItem;
}

/**
 * Every word of the query must appear (as a substring) somewhere in the
 * item's question, answer or keywords. Question hits rank first.
 */
export function searchHelp(query: string, categories: HelpCategory[] = HELP_CATEGORIES): HelpSearchResult[] {
  const words = normalizeHelpText(query).split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const scored: Array<HelpSearchResult & { score: number }> = [];
  for (const category of categories) {
    for (const item of category.items) {
      const question = normalizeHelpText(item.question);
      const haystack = `${question} ${normalizeHelpText(item.answer)} ${normalizeHelpText((item.keywords ?? []).join(' '))}`;
      if (!words.every((word) => haystack.includes(word))) continue;
      const score = words.filter((word) => question.includes(word)).length;
      scored.push({ categoryTitle: category.title, item, score });
    }
  }
  return scored.sort((a, b) => b.score - a.score).map(({ categoryTitle, item }) => ({ categoryTitle, item }));
}
