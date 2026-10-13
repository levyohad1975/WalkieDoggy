# Walkie Doggy Link — PRD מעודכן למוצר הסופי

**Product Requirements Document • גרסת מסירה ל-Claude • 22.09.2026**

> מסמך זה מהווה מירור בתוך הריפו של PRD שסופק ע"י בעל הפרויקט
> (`Walkie_Doggy_Link_PRD_Final_2026-09-22`), כדי שיהיה זמין לכל worker
> אוטונומי או session עתידי בלי תלות בנתיב קובץ מקומי. ראו
> `docs/product/PRD_GAP_ANALYSIS_PHASE0.md` לניתוח הפערים מול הקוד הנוכחי.

## 1. מטרת המסמך

מסמך זה מגדיר את Walkie Doggy Link כמוצר המשפחתי הסופי ולא כגרסת Demo. הוא מיועד לשמש מקור עבודה ישיר ל-Claude/סוכן פיתוח: להשלים פערים קיימים, לשמר יכולות שכבר עובדות, ולבנות חוויה שלמה, חמה, מודרנית ואמינה ב-iOS, Android ו-Web/PWA.

עקרון ביצוע: אין לכתוב מחדש מערכת שעובדת ללא צורך. יש לבצע Gap Analysis מול הקוד הנוכחי, לסמן Existing / Partial / Missing, ואז להשלים לפי סדר עדיפויות. אין לשנות Production, לבצע Production migration או פעולה הרסנית ללא אישור מפורש.

## 2. חזון המוצר

Walkie Doggy Link הוא מרכז המשפחה לטיפול בכלב: מי יוצא, מתי, מה קרה בטיול, האם בוצע, בריאות וטיפוח, תזכורות, הישגים וסטטיסטיקה. המוצר צריך להפחית ויכוחים ושכחה, לעודד אחריות משפחתית, ולהפוך את הטיפול בכלב לחוויה חיובית ומשותפת.

החוויה צריכה להרגיש כמו אפליקציה אמיתית ולא כמו דף אינטרנט: היררכיה ברורה, כרטיס מרכזי חי, שימוש בתמונת הכלב האמיתית, mascot כעוזר/מותג ולא כתחליף לכלב, RTL מלא, ומצבים ברורים לפני/בזמן/אחרי טיול.

## 3. משתמשים, תפקידים והרשאות

משפחה יכולה לכלול מספר מבוגרים/ילדים ומספר כלבים. תפקידי ליבה: Family Admin, Family Member, System Admin. הרשאות רגישות חייבות להיות נאכפות בצד השרת; הסתרת כפתור ב-UI אינה הרשאה.

Family Admin מנהל בני משפחה, כלבים, לו״ז, בקשות, בריאות/טיפוח והרשאות. Member מבצע ומדווח פעולות לפי הרשאותיו. System Admin הוא תפקיד פלטפורמה נפרד עם כניסה ייעודית, ניהול משפחות ובקרת סטטוס/אישור.

## 4. Onboarding, יצירת משפחה והצטרפות

Flow יעד: פתיחה → אימות Email/OTP → יצירת משפחה או הצטרפות → הוספת כלב → הוספת/הזמנת בני משפחה → Home. יש לתמוך בקוד, קישור ו-QR להזמנה ובתרחיש של מכשיר שני.

ב-PWA שהותקן למסך הבית אין לבלבל משתמש ולשלוח אותו ליצירת משפחה חדשה. יש שחזור משפחה בטוח דרך זהות מאומתת; מנהל משפחה יכול לאמת שוב את האימייל, וחבר משפחה מקבל מסלול ברור דרך הזמנה/שחזור. יש לשמור על Session באופן אמין ככל שמאפשרת הפלטפורמה.

במסכי onboarding יש להשתמש ב-mascot ובאנימציה קצרה שמעודדת הרשמה ושימוש, בלי להעמיס ובלי לפגוע ב-Reduced Motion.

## 5. Home — מרכז הפעילות

ה-Home בנוי סביב כרטיס הטיול המרכזי. תמונת הכלב האמיתית ושם הכלב משולבים בכרטיס; אין כרטיס ״הכלב שלנו״ גדול ונפרד. לחיצה על תמונה/שם פותחת פרופיל כלב.

Header יעד: פעמון התראות בצד הפיזי השמאלי, wordmark במרכז, mascot קטן בצד הפיזי הימני. אין חפיפה בין mascot, פעמון או System Admin. כניסת System Admin צריכה להיות ברורה למורשה אך לא להתחרות בניווט הראשי.

מצבי כרטיס: Scheduled — גוון כחול/טורקיז וכפתור ▶ התחל טיול; Overdue — כל הכרטיס בגוון אדום עם איחור וכפתור ▶ התחל טיול עכשיו; In Progress — גוון ירוק, טיימר, מרחק/מצב GPS וכפתור ■ סיים טיול; Completed — סיכום זמן, משך, מרחק, עצירות, הערות/מסלול.

## 6. תכנון טיולים ותורנויות

אין לקבע 4 טיולים ביום. כל משפחה מגדירה מספר טיולים גמיש לפי כלב/יום, כולל פעם אחת, פעמיים, ארבע או יותר. יש לתמוך בתבניות שבועיות, שעות ברירת מחדל, שיוך בן משפחה, חריגים ליום מסוים, שינוי שעה והחלפת אחראי.

בקשות החלפה/שינוי שעה נשלחות למנהלים ולבן המשפחה שצריך לאשר. ההתראה חייבת לציין מה השתנה, מי ביקש ומי נדרש לאשר. יש סטטוס ברור Pending/Approved/Rejected/Cancelled והיסטוריית Audit.

יש לתמוך בטיול אד-הוק ללא תכנון. דיווח ״בוצע״ אפשרי גם אם המשתמש שכח ללחוץ Start; במקרה כזה ניתן להזין את השעה שבה הטיול באמת התרחש, ולא לכפות את זמן הדיווח הנוכחי.

## 7. Lifecycle של טיול ו-GPS

Start/End הם הפעולה הראשית. מנהל יכול להתחיל/לסיים עבור ילד ששכח. בזמן טיול נשמרים started_at, ended_at, duration, walker, dog, source, והיכן שמותר — נתוני מסלול/מרחק.

יעד GPS: המנגנון ילמד בהדרגה דפוסי טיול ויוכל להציע/לזהות התחלה וסיום על בסיס תנועה, מיקום, מסלולים חוזרים וזמנים. בשלב ראשון GPS הוא Assistive ולא מקור אמת יחיד: המשתמש יכול לאשר/לתקן. בהמשך ניתן להוסיף confidence score וליצור Auto-detected walk רק לפי סף ומדיניות פרטיות מוגדרים.

אין להסתמך על שבב זיהוי מושתל של כלב לצורך GPS — הוא אינו מקור מיקום רציף. אינטגרציה עתידית עם קולר/Tracker GPS חיצוני תוגדר דרך Adapter/Provider, ללא תלות בספק יחיד.

GPS חייב לכלול הרשאות ברורות, הסבר למה נדרש מיקום, מצבי denied/limited/background, צריכת סוללה סבירה, שמירת מינימום מידע נדרש, ומדיניות מחיקה/פרטיות. אין לעקוב אחרי בני משפחה מעבר לצורך המוצר.

## 8. תזכורות, Push ואנימציות mascot

מערכת תזכורות לפני ואחרי טיול: ברירת מחדל ניתנת להגדרה סביב T-15, בזמן הטיול, T+15 ו-T+30; יש למנוע כפילויות בין Native local, Expo Push ו-Web Push.

כל הודעה מהכלב יכולה להפעיל אנימציה קצרה בתוך האפליקציה: mascot נכנס למסך, מבצע pose/תגובה, ובועת טקסט עם משפט קצר ומתחלף. לפני טיול: עידוד/הכנה. באיחור: תזכורת נעימה ולא מאשימה. בסיום: חגיגה בהתאם להישג.

ב-Web/PWA, Push חיצוני צריך לעודד פתיחת האפליקציה כדי לראות את האנימציה. ב-iPhone יש flow התקנה ל-Home Screen והסבר להפעלת Notifications. Android מקבל flow מותאם לפלטפורמה.

יש לכבד Reduced Motion: fallback סטטי, ללא תנועה מהבהבת/אגרסיבית. ה-mascot חייב לשמור על ה-Master המאושר; אין להחליף זהות/פרופורציות/סמל הקולר באמצעות generation לא מבוקר.

## 9. Gamification — גביעים ועידוד משפחתי

מטרת הגיימיפיקציה היא עידוד אחריות ושיתוף פעולה, לא תחרות רעילה. יש להציג הישגים אישיים ומשפחתיים, streaks מתונים וגביעים, עם אפשרות לכיבוי.

דוגמאות: טיול ראשון, שבוע של עמידה בתורנויות, 10/25/50 טיולים, ״תמיד בזמן״, ״עוזר משפחתי״, ״טיול ארוך״, ״חודש מושלם״, ״החלפה הוגנת״. הישגים משפחתיים עדיפים על דירוג אגרסיבי בין ילדים.

בסיום הישג, mascot מציג celebration קצר. יש להציג Progress ברור ליעד הבא, אך לא להשתמש ב-dark patterns או ענישה על החמצה.

## 10. בריאות וטיפוח

יש להוסיף Hub של בריאות וטיפוח לכל כלב. זהו יומן וניהול משימות — לא כלי אבחון רפואי. מידע רפואי מוצג כפי שהוזן על ידי המשפחה/וטרינר, עם אפשרות לצרף הערות ומסמכים בעתיד.

קטגוריות ליבה: חיסונים, טיפולי תילוע/פרעושים/קרציות, תרופות, ביקורי וטרינר, משקל, אלרגיות/רגישויות, מזון והנחיות, טיפוח/ספר, מקלחת, ציפורניים, שיניים, אוזניים, ותזכורות מותאמות.

לכל פריט: dogId, category, title, due date, recurrence, completed date, responsible member, notes, optional attachment/reference, status. יש Timeline לכלב, Upcoming tasks, Overdue, Completed, וחיווי ברור בלי להפוך את האפליקציה למערכת רפואית.

תזכורות בריאות/טיפוח משתמשות באותה תשתית Notification אך נבדלות מתזכורות טיול. מנהלים יכולים ליצור/לערוך; הרשאות בני משפחה ניתנות להגדרה. Multi-dog מחייב סינון וייחוס ברור לכל כלב.

## 11. Multi-dog

המערכת חייבת לתמוך ביותר מכלב אחד במשפחה. כל טיול, תורנות, סטטיסטיקה, בריאות, טיפוח, תמונה, GPS והישג משויכים לכלב אחד או למספר כלבים כאשר המודל מאפשר טיול משותף.

ב-Home יש בחירת כלב קלה כאשר יש יותר מכלב אחד, בלי להעמיס על משפחה עם כלב יחיד. ברירת המחדל היא הכלב הפעיל/הרלוונטי לטיול הבא.

## 12. פרופילים ותמונות

לכלב ולבן משפחה ניתן להעלות תמונת פרופיל. עריכת תמונה צריכה לכלול crop, zoom, pan ומרכוז בדומה לחוויית תמונת פרופיל מוכרת. יש preview לפני שמירה ו-fallback מכובד.

תמונת הכלב האמיתית היא הדמות הראשית של המשפחה; mascot הוא דמות המותג/עוזר. אין להחליף ביניהם.

## 13. סטטיסטיקה — עיצוב מחדש מלא

מסך הסטטיסטיקה צריך להיבנות מחדש כמסך מודרני ומקצועי, ולא כרשימת נתונים ישנה. אין להשתמש במילים ״פיפי״ ו״קקי״ כ-KPI מרכזיים. אם נתוני צרכים נשמרים בהערות/פרטי טיול, הם משניים ואינם מוקד ה-dashboard.

מבנה מומלץ: Header עם טווח זמן וסינון; KPI cards — מספר טיולים, אחוז ביצוע בזמן, משך כולל/ממוצע, מרחק כולל/ממוצע; Trend chart; חלוקה לפי בני משפחה; חלוקה לפי כלבים; On-time vs Late; Planned vs Ad-hoc; הישגים/רצפים; תובנות קצרות.

Filters: היום/שבוע/חודש/טווח מותאם, כלב, בן משפחה, סוג טיול/סטטוס. פילטרים צריכים להיות touch-friendly בנייד ונוחים במקלדת/עכבר בדסקטופ. Charts חייבים RTL-aware, נגישים, עם labels/tooltips ואלטרנטיבה טקסטואלית לנתון.

אין צורך באזור ״השבוע שלנו״ אם הוא כפילות ללא ערך. הסטטיסטיקה צריכה לענות על שאלות אמיתיות: האם הטיולים מבוצעים, מי משתתף, האם יש איחורים, מה השתנה לאורך זמן, ומה ההתקדמות המשפחתית.

## 14. History, Notes ו-Audit

History מציג טיולים שבוצעו/דולגו/אד-הוק עם סינון וחיפוש. ניתן לצפות בפרטי טיול, שעה מתוכננת מול בפועל, אחראי, משך, מרחק, מסלול אם קיים והערות.

הערות טיול יכולות לכלול מידע חופשי ומאפיינים שימושיים, אך אין להפוך אותם ל-KPI ראשי ללא צורך. Audit Trail צריך להציג ניסוחים אנושיים בעברית ולא מזהי action טכניים גולמיים.

## 15. בקשות, Inbox והתראות

פעמון ההתראות פותח Inbox מאוחד לבקשות החלפה, שינוי שעה, תוצאות אישור/דחייה, תזכורות חשובות ועדכוני מערכת רלוונטיים. Badge מציג unread count. כל פריט מסביר מה קרה ומה הפעולה הנדרשת.

יש להפריד בין Notification delivery לבין מקור האמת: החלטות והרשאות מאומתות בשרת; Push הוא ערוץ מסירה בלבד.

## 16. Settings וניהול משפחה

Settings כולל: פרטי משפחה, בני משפחה, תפקידים והרשאות, כלבים, תורנויות, תזכורות, בריאות/טיפוח, Push/Web Push, פרטיות/GPS, נגישות/Reduced Motion, תמיכה ויציאה.

מנהלים יכולים להוסיף/להסיר/לערוך בני משפחה מהנייד. מחיקה צריכה לשמר היסטוריה באמצעות soft-delete כאשר נדרש. יש תמיכה ב-profile claim/reclaim באופן בטוח.

יש לשמור ערוץ תמיכה ברור מתוך האפליקציה. פרטי כתובת התמיכה הסופית צריכים להגיע מקונפיגורציה ולא להיות מפוזרים בקוד.

## 17. System Admin

System Admin נפרד מ-Family Admin. הוא יכול לצפות ברשימת משפחות, סטטוס, פרטי audit נדרשים, לאשר/לדחות/להשבית לפי מדיניות, ולתמוך בתהליכי onboarding. הכניסה חייבת לעבוד גם אם למנהל המערכת אין משפחה פעילה.

מדיניות ניקוי/השבתת משפחות לא פעילות היא backlog עסקי שדורש החלטת retention לפני הפעלה אוטומטית. אין למחוק נתונים אוטומטית ללא מדיניות ואישור.

## 18. Design System, RTL ו-Responsive

Hebrew/RTL הוא first-class. כל מסך נבדק בקריאה מימין לשמאל, mixed Hebrew/English, מספרים, תאריכים, שעות, arrows/chevrons, charts וטפסים.

שפה חזותית: חמה, משפחתית, נקייה ומודרנית. צבעי מותג מרכזיים: turquoise #20A7B5 ו-cream #FBF8F3, תוך שמירה על contrast ונגישות. Desktop אינו mobile stretched: יש max-width, קומפוזיציה מותאמת, keyboard/mouse/focus. Mobile כולל touch targets, safe areas, orientation והתנהגות native.

Definition of Done חזותי: iOS + Android + Web/Desktop, RTL, responsive, navigation/gestures, touch targets, keyboard/mouse, screen sizes, accessibility, loading/error/empty/offline states, Reduced Motion ו-Visual QA.

## 19. Mascot ו-Animation System

יש להשתמש ב-Clean Master המאושר `assets/branding/walkie-doggy-mascot-clean.png` כ-reference identity. כל pose/frame חדש חייב לשמור על הפנים, האוזניים, הצבעים, הקולר וסמל ה-double-ring/link.

נדרש להשלים סט נכסי animation אמיתי — כיום קיימת ארכיטקטורת states/fallbacks אך לא סט final frame artwork מלא. מצבי יעד: idle, happy, reminder, overdue/concerned, walk-start, walking, walk-complete, achievement, long-walk, special-surprise.

כל animation קצר, קל משקל, לא חוסם פעולה, עם static fallback ל-Reduced Motion. Assets חדשים נשארים DRAFT עד Visual QA ואישור זהות/מותג.

## 20. Offline, Sync ואמינות

יש לשמר את OfflineFirstRepository + SyncQueue. פעולות רגילות נתמכות local-first ומסתנכרנות. פעולות הרשאה/אישור רגישות נשארות server-authoritative. אין לעקוף repository ולדבר ישירות עם Supabase מתוך מסכים.

יש להציג מצבי offline/sync/conflict באופן אנושי. אין להציג הצלחה מרוחקת רק כי UI מקומי השתנה. queue conflicts קבועים חייבים להיות גלויים ולא להיעלם.

## 21. Security & Privacy

Family הוא tenant boundary. RLS/RPC/SECURITY DEFINER, membership, claims, roles, System Admin, invite redemption, GPS ו-notification routing הם security-sensitive. Client state אינו מקור הרשאה.

יש לאסוף מינימום נתוני מיקום נדרש, להסביר הרשאות, ולאפשר מחיקה/כיבוי בהתאם למדיניות. אין לחשוף מסלול/מיקום לבן משפחה שאינו מורשה. כל שינוי DB נעשה במיגרציה חדשה — לעולם לא עורכים migration שכבר הוחל.

## 22. Accessibility

יעד: WCAG 2.2 רלוונטי ל-Web + APIs נגישים של React Native. נדרשים labels, roles, focus, contrast, non-color-only status, target sizes, error messaging, keyboard navigation, screen reader semantics ו-Reduced Motion.

צבעי Scheduled/Overdue/In Progress אינם האינדיקציה היחידה: תמיד יש טקסט/אייקון/סטטוס מפורש.

## 23. Email ותקשורת

יש להשלים הודעות welcome/onboarding ומיילים מערכתיים לפי הצורך, עם From/domain תקינים, תיעוד delivery, webhook/provider events ו-copy מותגי. אין לשלוח מידע רגיש שאינו נדרש.

התראות Push, Web Push, Email ו-In-App צריכות להשתמש באותה שפה מוצרית, אך כל ערוץ מותאם למגבלותיו.

## 24. Analytics מוצרי ותפעולי

יש למדוד אירועים מוצריים ללא מידע מיקום עודף: onboarding completion, family created/joined, invite redeemed, walk started/completed/ad-hoc, reminder opened, notification enabled, health task completed, achievement unlocked, GPS suggestion accepted/corrected.

יש להפריד analytics אנונימי/תפעולי ממידע משפחתי פרטי ולהגדיר retention לפני Production.

## 25. מצבי מערכת שחייבים להיות מעוצבים

Loading, empty family, no dog, no upcoming walk, offline, sync pending, sync conflict, permission denied, notifications disabled, GPS unavailable, PWA not installed, invite expired, OTP error, pending family approval, account/session recovery, no statistics data, no health tasks, and server error.

כל מצב צריך CTA ברור ולא מסך מת. הודעות צריכות להיות בעברית טבעית, קצרה ולא טכנית.

## 26. Acceptance Criteria מרכזיים

משפחה חדשה יכולה להשלים E2E: OTP → create family → add dog → invite → second member join → Home. משתמש PWA חוזר אינו נשלח בטעות ליצירת משפחה חדשה.

מספר הטיולים ביום גמיש. Start/End נשמרים. Active walk נשאר הכרטיס המרכזי. Overdue אדום, In Progress ירוק, Scheduled כחול/טורקיז. ניתן להשלים בדיעבד עם actual time.

בקשת החלפה/שעה מגיעה לגורמים הנכונים ומציינת מה השתנה ומי צריך לאשר. הרשאה נאכפת בשרת.

Native/Web reminders אינם מוכפלים; PWA install/notification guidance עובד; mascot animation מוצג בתוך האפליקציה עם Reduced Motion fallback.

Health & Grooming תומך recurring tasks, due/overdue/completed, dog assignment, responsible member ו-reminders.

Statistics מציג dashboard חדש, filters, charts ו-KPIs ללא ״פיפי/קקי״ כמדדי ליבה, ועובד ב-RTL ובדסקטופ.

Multi-dog עובד לכל flows הרלוונטיים. תמונות פרופיל ניתנות crop/zoom/pan. System Admin יכול להיכנס ללא family persona.

כל שינוי עובר `npx tsc --noEmit` ו-`npm test -- --runInBand`, בנוסף לבדיקות E2E/visual/device הרלוונטיות.

## 27. סדר ביצוע מומלץ ל-Claude

Phase 0 — Gap Analysis בלבד: לקרוא AGENTS.md, PROJECT_ENGINEERING_BRAIN.md, PRODUCT_CONTEXT.md, BRAND_BIBLE.md, MASCOT_SPEC.md ו-CREATIVE_AGENT_CHARTER.md; לבדוק את הקוד בפועל; להפיק מטריצה Existing / Partial / Missing / Risk. Current repository evidence גובר על מסמכים ישנים.

Phase 1 — Stabilize current Staging: deployment trigger, PWA recovery, header mascot/bell/System Admin, active/overdue lifecycle, migration drift סביב walk lifecycle, last-walk correctness.

Phase 2 — Core product completeness: flexible schedule, requests/inbox, ad-hoc + actual time, multi-dog, profile photo editor, Settings/admin mobile flows.

Phase 3 — Health & Grooming: data model, repository, Supabase/RLS/RPC, reminders, screens, timeline, recurring tasks, multi-dog.

Phase 4 — GPS foundation: permissions, session tracking, route/distance, correction flow, privacy; לאחר מכן pattern-learning/confidence והכנה ל-GPS collar adapters.

Phase 5 — Engagement: mascot animation assets/states, reminder presentation, achievements/trophies, progress, family-positive gamification.

Phase 6 — Statistics redesign: new information architecture, filters, accessible charts, insights, responsive desktop/mobile.

Phase 7 — Release hardening: offline/conflicts, accessibility, RTL, real iPhone + Android + Web/Desktop E2E, push delivery, scheduler, email, visual QA, performance, security review.

Phase 8 — Production gate: לעצור. להציג Evidence Pack ורשימת migrations/deployments/secrets. אין Production deploy/migration ללא אישור מפורש.

## 28. הנחיית עבודה ישירה ל-Claude

פעל כצוות משולב Product/UX → Engineering → Creative QA. אל תשאל שאלות מיקרו כאשר ניתן לבחור ברירת מחדל בטוחה והפיכה. אל תמציא מצב קיים: בדוק קוד, migrations, tests ו-environment evidence. שמור על שינויים קיימים ואל תבצע rewrite רחב ללא הצדקה.

בכל משימה: (1) Inspect, (2) Plan קטן, (3) Implement, (4) Tests/typecheck, (5) Visual/RTL/accessibility QA כאשר רלוונטי, (6) Evidence, (7) Next. אם נתקלת בחסם שאינו דורש החלטת מוצר/Production — טפל בו והמשך.

אל תערוך migration שכבר הוחל. צור migration חדש. אל תעקוף RLS/authorization. אל תפגע ב-native notifications כאשר מוסיפים Web Push. אל תחליף Mascot Master ללא אישור.

מסירת כל Batch חייבת לכלול: מה השתנה, קבצים, migrations/RPCs/functions, בדיקות ותוצאות, screenshots/visual evidence כאשר UI השתנה, סיכונים שנותרו, ומה דורש אישור Production.

## 29. Definition of Final Product

המוצר נחשב מוכן כאשר משפחה אמיתית יכולה להשתמש בו יום-יום ללא מחשב פיתוח: להצטרף, לנהל כלב/ים ובני משפחה, לתכנן ולהחליף תורנויות, לקבל תזכורות, להתחיל/לסיים או לדווח בדיעבד, לראות היסטוריה וסטטיסטיקה, לנהל בריאות וטיפוח, לקבל עידוד/הישגים, ולהשתמש ב-GPS בהתאם להרשאות — באותה רמת איכות ב-iPhone, Android ו-Web/PWA.

החוויה הסופית צריכה להיות מזוהה מיד כ-Walkie Doggy Link: תמונת הכלב במרכז, mascot עקבי וחי, RTL טבעי, עיצוב חם ומקצועי, ומערכת אמינה שמונעת בלבול במקום לייצר אותו.

## 30. נקודות שדורשות החלטה/אימות לפני Production

יש לאמת live: migrations בפועל בכל סביבת Supabase, scheduler/cron לתזכורות, Web Push subscription אמיתי, VAPID/secrets, email provider/webhook, GPS background capabilities לכל פלטפורמה, retention של location/health data, ו-store/PWA requirements עדכניים.

מדיניות מחיקת/השבתת משפחות לא פעילות, retention של GPS/health/analytics, אינטגרציית GPS collar ספציפית, והיקף attachments רפואיים הם החלטות מוצר/פרטיות שדורשות סגירה לפני Production.
