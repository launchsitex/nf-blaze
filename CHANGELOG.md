# Changelog

## 1.45.0 - 2026-07-30

### Added — מערכת רישוי (מפתחות חתומים, בלי שרת)
- **המערכת דורשת מפתח רישיון:** 14 יום ניסיון מההתקנה, ואחריהם מסך הפעלה. המפתח נשמר מוצפן ומשויך למחשב שבו הופעל.
- **הנפקה בפקודה אחת אצל המפתח:** `npm run license:issue -- --name "לקוח" --days 90` מייצר מפתח חתום דיגיטלית (Ed25519) לשליחה ללקוח. גם `--forever` ו-`--email`. כל הנפקה נרשמת ביומן מקומי.
- אימות **אופליין לגמרי** — אין שרת, אין תלות באינטרנט. אף אחד לא יכול לייצר מפתחות בלי המפתח הפרטי (`secrets/`, מחוץ לגיט).
- כרטיס «רישיון» בהגדרות: סטטוס, הפעלה, הסרה. `npm run license:verify` לבדיקת מפתח.

### Changed — הקשחת קוד וקניין רוחני
- **הרישיון שונה מ-MIT ל-UNLICENSED** — עד היום כל אחד היה רשאי חוקית להעתיק ולמכור את המוצר. התקנון עודכן בהתאם: אסור להעתיק, להפיץ, לבצע הנדסה לאחור או לעקוף את הרישוי.
- **bytecode:** לוגיקת הסוכן מקומפלת ל-V8 bytecode בהתקנה (`index.jsc`) — לא קריאה כקוד מקור. בפיתוח כבוי כדי לא לפגוע ב-HMR.
- **פרומפט המערכת הוטמע בקוד** ואינו נשלח יותר כקובץ טקסט גלוי בהתקנה (`prompts/` הוסר מהחבילה; מקור האמת נשאר בריפו).

## 1.44.0 - 2026-07-30

### Fixed — «הסוכן תקוע» בזמן כתיבת קבצים ארוכים (נראות חיה כמו Dyad/bolt)
- **הבעיה:** כשהמודל כותב קובץ גדול (אתר שלם), התוכן זורם כ-tool-call — לא כטקסט — והמסך שתק לדקות ארוכות. נראה תקוע למרות שהוא עובד.
- **התיקון:** סטרימינג התקדמות מכל המתאמים (Anthropic + OpenAI/OpenRouter/מקומיים): שורת הסטטוס מציגה חי «כותב את src/App.tsx… (14.2K תווים)» עם עדכון כל רבע שנייה — רואים בדיוק איזה קובץ נכתב וכמה.
- **טיימר עבודה:** ליד הסטטוס החי מוצג «2:47» — כמה זמן הסוכן עובד על הבקשה. אין יותר תהייה אם הוא חי.

## 1.43.0 - 2026-07-30

### Fixed — הסוכן יכול להתקין חבילות
- **`npm install <חבילה>` נחסם לסוכן:** ה-allowlist התיר רק `npm install` ריק — כשהסוכן ניסה להתקין חבילה חדשה (למשל `@radix-ui/react-accordion`) הוא נחסם והקוד נשבר עם import חסר. עכשיו התקנת חבילות מותרת עם ולידציה קפדנית: שמות חבילה חוקיים בלבד (+scope וגרסה), דגלי שמירה בטוחים בלבד — בלי נתיבים, בלי git URLs ובלי דגלים מסוכנים. נוספו טסטים לשני הכיוונים.

### Added — תקנון בהתקנה + הסבר מלא בהפעלה ראשונה
- **דף תקנון ומדיניות באשף ההתקנה:** לפני ההתקנה המשתמש רואה ומאשר את תנאי השימוש בעברית — מהות התוכנה, פרטיות (הכל מקומי, מה נשלח לספק המודל), אחריות על מפתחות ותוכן שנוצר ב-AI, הרצת קוד מקומית, אינטגרציות, עדכונים ורישיון MIT. (`build/license_he.txt`)
- **מסך «ברוכים הבאים» בהפעלה הראשונה:** מדריך של 4 שלבים שמסביר את כל המערכת — מה זה NF-Blaze ואיך מתחילים (מפתח API / Ollama), איך עובדים (פרויקט, תצוגה חיה, סימון אלמנטים), השליטה בסוכן (אישור שינויים, diff, היסטוריה, טרמינל), ומה בודקים לפני פרסום (מכשירים, אבטחה, בדיקות). מוצג פעם אחת בלבד, עם דילוג ונקודות התקדמות.

## 1.42.0 - 2026-07-30

### Added — מסך פרויקט (כמו Dyad, בצבעי המערכת)
- **כניסה לפרויקט פותחת מסך פרויקט חדש:** שם הפרויקט עם עריכה במקום (עיפרון → Enter), תאריכי יצירה ועדכון, נתיב התיקייה עם פתיחה בסייר — וכפתור «פתח בצ׳אט» גדול.
- **כרטיס GitHub:** מצב חיבור עם קישור לריפו, **בורר ענף יעד** (רשימת הענפים האמיתית מהריפו), «סנכרן ל-GitHub» עם משוב חי, וניתוק. לא מחובר? כפתור שפותח את חלון החיבורים.
- **כרטיס Supabase:** שם הפרויקט המחובר, קישור ל-Dashboard, ניתוק — או חיבור אם עוד לא.
- כפתור חדש בסרגל הצ'אט חוזר למסך הפרויקט מכל מקום.

### Fixed — משוב חי לסריקת האבטחה
- לחיצה על «סרוק עכשיו» נראתה כאילו לא קורה כלום (הסריקה מסתיימת מהר מדי) — עכשיו יש אייקון מסתובב בזמן הסריקה וחותמת «סריקה אחרונה: HH:MM:SS» אחרי כל ריצה.

## 1.41.0 - 2026-07-30

### Added — סימון בתצוגה בדיוק כמו Dyad
- **תווית על כל אלמנט מסומן בתוך התצוגה עצמה:** שם הקומפוננטה/תג + נתיב הקובץ והשורה (או ה-selector), עם כפתור ✕ צף להסרת הסימון ישירות מהתצוגה — בדיוק כמו ב-Dyad, בצבעי המערכת. התוויות נצמדות לאלמנט גם בגלילה ושינוי גודל, וממוספרות בבחירה מרובה.

### Added — טאבי «אבטחה» ו«בדיקות» בטולבר
- **אבטחה:** סריקה לפי דרישה (רצה אוטומטית בכניסה הראשונה לטאב) — סודות בקוד, env בקבצי build, RLS מתירני וטבלאות Supabase פתוחות. כל ממצא עם חומרה (חסימה/אזהרה), הסבר, ו«תן לסוכן לתקן»; מונה אדום על הטאב כשיש ממצאים.
- **בדיקות:** הרצת `npm test` של הפרויקט בלחיצה, פלט חי, סטטוס ✓/✗, ו«תן לסוכן לתקן» שמעביר את הכשלים לסוכן.

### Added — ריבוי צ'אטים לפרויקט + «סכם לצ'אט חדש» (כמו Dyad)
- **כמה שיחות לכל פרויקט:** בורר צ'אטים בכותרת הצ'אט, צ'אט חדש בלחיצה, מחיקה (תמיד נשאר אחד), וכותרות אוטומטיות מההודעה הראשונה. שיחות ישנות עוברות מיגרציה שקטה.
- **«סכם לצ'אט חדש»:** מודל מהיר מסכם את השיחה (מה נבנה, החלטות, מה פתוח) ופותח צ'אט חדש שמתחיל מהסיכום — ממשיכים בהקשר נקי בלי לגרור היסטוריה כבדה.

## 1.40.0 - 2026-07-30

### Added — ממשק עבודה בסגנון Dyad (בצבעי המערכת)
- **טולבר תצוגה חדש:** טאבים מפולחים «תצוגה | קוד», שורת כתובת אמיתית (URL של התצוגה או נתיב הקובץ הפתוח, עם רענון מסתובב בזמן טעינה ונקודת «לא נשמר»), וכפתורי פעולה מסודרים — כמו בכלים המקצועיים.
- **סטטיסטיקת שינויים על כל קובץ:** צ'יפ הקובץ בהודעת הסוכן מציג עכשיו `‎+נוספו −נמחקו` בירוק/אדום (חישוב אמיתי מול ה-snapshot, בסגנון git --stat).
- מעברים חלקים (150ms) על טאבים וכפתורים.

### Fixed — ההדגשות בתצוגה נשארות
- **הבחירה שרדה רענון:** אחרי כל שינוי של הסוכן התצוגה נטענת מחדש וההדגשות הירוקות נעלמו (בעוד הצ'יפים נשארו) — עכשיו הבחירה משוחזרת אוטומטית לפי selector אחרי כל טעינה, כולל מצב הבחירה עצמו.
- **הדגשה בולטת בהרבה:** מסגרת עבה + גוון ירקרק על האלמנט + עיגול מספר גדול עם צל — רואים ברור מה מסומן גם בדפים עמוסים.

## 1.39.2 - 2026-07-30

### Added — בחירה מרובה של אלמנטים בתצוגה
- **בוחרים כמה אלמנטים שרוצים:** במצב בחירה, כל לחיצה מוסיפה אלמנט (עם עיגול ממוספר ירוק על האלמנט בתצוגה), לחיצה חוזרת מסירה, ומצב הבחירה נשאר פעיל עד שמכבים אותו. ליד שורת הכתיבה מופיע צ'יפ ממוספר לכל אלמנט (עם X להסרה) ו«נקה הכל».
- **הסוכן מקבל את כולם:** ההקשר כולל רשימה ממוספרת של כל האלמנטים (קובץ+שורה או selector+טקסט), עם הנחיה מפורשת לעבור על כולם — והמספור בצ'אט («הראשון», «השני») תואם לעיגולים בתצוגה.
- מונה בחירה על כפתור הבחירה; אחרי שליחה הכל מתנקה אוטומטית. תאימות מלאה לפרויקטים עם plugin ישן (בחירה בודדת).

### Fixed
- **שמירת מפתח OpenRouter נחסמה:** ולידציה ישנה ב-IPC הרשתה רק openai/anthropic/gemini — «שמור» על מפתח OpenRouter זרק «ספק לא חוקי».

## 1.39.1 - 2026-07-30

### Fixed — «npm לא נמצא» בהתקנה נקייה (תקלת אריזה של Node המצורף)
- electron-builder סינן בכוח את תיקיית `node_modules` של npm מתוך ה-runtime המצורף — `npm.cmd` נארז בלי npm עצמו, ומשתמשים קיבלו מסך «נדרש Node.js» גם אחרי התקנת Node ידנית. נוסף hook `afterPack` שמעתיק את npm לחבילה; אומת שה-npm הארוז רץ (`10.9.2`).
- **עמידות כפולה:** אם ה-runtime המצורף פגום מכל סיבה, האפליקציה נופלת אוטומטית ל-Node המותקן במערכת — «בדיקה מחדש» אחרי התקנת Node תעבוד תמיד.
- תוקן ציטוט נתיבים עם רווחים (Program Files) בבדיקת הסביבה.

## 1.39.0 - 2026-07-30

הכנה לעלייה לאוויר: Node מצורף להתקנה, עדכונים אוטומטיים, תשתית חתימת קוד, ותיקוני ביצועים לתקיעות UI.

### Added — מוכנות שחרור
- **Node.js מצורף להתקנה (v22.14.0):** משתמשי קצה בלי Node מותקן עובדים מהרגע הראשון — אין יותר מסך «נדרש Node». (~98MB ב-`resources/runtime`, נארז אוטומטית.)
- **עדכונים אוטומטיים (electron-updater):** האפליקציה בודקת עדכון בעלייה וכל 4 שעות, מורידה ברקע ומציעה «התקן והפעל מחדש». בטוח-כשל — בלי שרת עדכונים אין שום הפרעה. שרת היעד: `build.publish` ב-package.json (generic, כל אחסון סטטי).
- **תשתית חתימת קוד מוכנה:** `npm run dist` חותם אוטומטית כשמוגדרים `CSC_LINK` + `CSC_KEY_PASSWORD`.
- **`RELEASE.md` חדש:** מדריך שחרור מלא — רכישת תעודה וחיבורה, פרסום עדכונים (שלושה קבצים לשרת סטטי), וצ'קליסט QA למכונה נקייה.

### Fixed — תקיעות UI (ביצועים)
- **סטרימינג:** כל טוקן מהמודל גרם לרנדר מלא של המסך + פרסור מחדש של כל הטקסט החי (O(n²)) — עכשיו הטוקנים נצברים ונשטפים כל ~80ms, וכל הודעות ההיסטוריה עטופות ב-React.memo כך שלא מתרנדרות מחדש בכל טוקן.
- **קונסול/טרמינל:** פלט שרת הפיתוח והפקודות נערם בלי תקרה וגרם להאטה מצטברת עד תקיעה אחרי שימוש ממושך — עכשיו נשמרות עד 400 שורות אחרונות בכל פאנל.

## 1.38.0 - 2026-07-30

השלמת פערים מול Dyad / bolt.new / Lovable / Base44 אחרי מיפוי תכונות מעמיק: היסטוריית גרסאות עם שחזור לכל נקודה, וייבוא פרויקטים קיימים.

### Added — פאנל תחתון מקצועי (בסגנון VS Code)
- **הטרמינל עבר לפאנל תחתון** שנפרס מתחת לתצוגה ולעץ הקבצים, עם שלוש לשוניות: **טרמינל** (אינטראקטיבי — המשתמש מקליד ומריץ פקודות npm/pnpm/yarn בתוך הפרויקט, עם שורת `$` ופלט חי), **קונסול** (פלט שרת הפיתוח + כל פקודה שהסוכן מריץ), ו**בעיות** (שגיאות ריצה וקומפילציה מהתצוגה עם מונה אדום ו«תן לסוכן לתקן» לכל בעיה). הפאנל מתכווץ בלחיצה.
- הטרמינל נשאר מאובטח: רק מנהלי חבילות בתוך תיקיית הפרויקט; פקודות ארוכות-ריצה (dev/start) חסומות עם הפניה לתצוגה החיה.
- **הקלדה בטרמינל:** שורת הפקודה מקבלת פוקוס אוטומטית כשפותחים את הטרמינל וכשפקודה מסתיימת, לחיצה בכל מקום בפאנל ממקדת אותה (כמו טרמינל אמיתי), וה-prompt מתחלף ל-… בזמן ריצה במקום לנעול את השדה.

### Added — תצוגת מכשירים (מובייל / טאבלט / מחשב)
- **סרגל מכשירים מעל התצוגה המקדימה:** מחשב מלא, או דגם ספציפי — iPhone SE / 15 / 15 Pro Max, Samsung Galaxy S24, Google Pixel 8, iPad, iPad Pro — עם viewport מדויק, מסגרת מכשיר, כפתור סיבוב לרוחב, ותצוגת מידות + אחוז סקייל. המסגרת מתכווצת אוטומטית להיכנס לשטח הזמין.

### Fixed — בוחר האלמנטים בתצוגה
- **בחירה עובדת על כל אלמנט:** גם בפרויקטים מיובאים / HTML סטטי בלי תיוג `data-nf-*` — הבחירה נופלת ל-CSS selector + קטע טקסט, והסוכן מונחה לאתר את האלמנט עם grep.
- **רואים מה נבחר:** ריחוף מסמן בכתום, האלמנט הנבחר נשאר מודגש בירוק בתצוגה עצמה, והצ'יפ ליד שורת הכתיבה מציג עכשיו גם את הטקסט של האלמנט. אחרי שליחה ההדגשה מתנקה אוטומטית (קודם נשארה תקועה).

### Added — אנימציה מקצועית למסך הראשי
- שלוש הילות צבע מרחפות ברקע (כתום, סגול, כחול — blur עם תנועה מתמדת), שם המותג עם shimmer גרדיאנט, כניסה מדורגת לכל אלמנטי ההירו וכרטיסי הפרויקטים, פעימת הילה עדינה על כפתור «התחל פרויקט חדש», והילת ריחוף משודרגת על הכרטיסים. הכל CSS בלבד.
- תוקן: ההילות נחתכו ע"י `overflow` וחסימת `prefers-reduced-motion` כיבתה את הכל במחשבי Windows עם «הצג אנימציות» כבוי — האנימציה רצה עכשיו תמיד ואומתה ב-Web Animations API (12 אנימציות פעילות).

### Changed — הסוכן בונה ברמה עולמית, לא גנרית (כל הספקים: Claude/GPT/Gemini)
- **פרומפט המערכת קיבל סעיף «הבן את הלקוח ובנה ברמה עולמית»:** חילוץ כוונה מלאה מהבקשה (תחום, קהל יעד, מטרה, טון), הצהרת הנחות בתוכנית במקום שאלות מיותרות, מחקר רשת כשהתחום לא מוכר, ותוכן עברי אמיתי שמוכר — בלי lorem ipsum ובלי «תכונה 1/2/3».
- **רף עיצוב מוגדר:** כיוון ייחודי לכל פרויקט (בלי מראה AI גנרי), היררכיה וריווח שיטתיים, hover/focus ומעברים לכל אלמנט, ויזואליה מ-CSS/SVG בלי תמונות חיצוניות שבורות, רספונסיביות 375px-דסקטופ, מצבי loading/empty/error, נגישות — וסיום רק אחרי בדיקה עצמית «האם זה עובר סקירה של מעצב בכיר?».
- **בדיקת הדפדפן בודקת גם איכות מוצר:** תת-סוכן ה-QA מדווח כ«שבור» גם placeholder טקסט, אלמנטים חופפים, טקסט לא קריא ועמודים חצי-גמורים — לא רק שגיאות תפקוד.
- **PROJECT_RULES בשתי התבניות** שודרגו עם אותו רף איכות.

### Fixed — באגים שנמצאו בסריקת קוד
- **הגדרות Vercel Team ID נעלמו אחרי הפעלה מחדש:** `SETTINGS_GET` לא החזיר את `vercelTeamId` / `vercelPlatformTeamId` — המשתמש ראה שדה ריק למרות שההגדרה נשמרה.
- **פרויקטים קיימים לא קיבלו תיקונים לבוחר האלמנטים:** ה-plugin של NF-Blaze בפרויקט מסונכרן עכשיו אוטומטית לגרסה העדכנית בכל עליית תצוגה חיה (`syncNfSourcePlugin`).
- **«בטל» מסרגל הכלים השאיר סרגל אישור מיותם:** אחרי ביטול הסבב האחרון, ההודעה מסומנת «השינויים בוטלו» ולא מציעה יותר «בטל שינויים» על snapshot שכבר נמחק.
- **תווית כיוון הפוכה בחלון ה-diff:** «לפני» מוצג משמאל, לא מימין.
- **שגיאות MCP סתומות:** כששרת MCP נופל בעלייה, הודעת השגיאה כוללת עכשיו את סוף ה-stderr שלו במקום «השרת נסגר» גנרי.

### Added — היסטוריית גרסאות עם שחזור לכל נקודה (כמו Dyad/Lovable)
- **כפתור «היסטוריה» חדש בסרגל הצ'אט:** רשימת כל נקודות השחזור (עד 30, נוצרות אוטומטית בכל סבב שהסוכן משנה קבצים) עם תאריך, קטע מהבקשה שהתחילה את הסבב ומספר הקבצים — ו«שחזר לכאן» שמחזיר את הפרויקט למצב שלפני אותה נקודה. השחזור מצטבר (מחיל את כל הנקודות מהחדשה ועד היעד), כך שגם קבצים שנוצרו בסבבים מאוחרים נמחקים כראוי.
- «בטל» הקיים ממשיך לעבוד וגם מתעדכן אחרי שחזור.

### Added — אישור שינויים + תצוגת diff לכל סבב (כמו bolt/Cursor)
- **«לשמור את השינויים?» בסוף כל סבב:** אחרי שהסוכן מסיים סבב עם שינויי קבצים, מופיעים על ההודעה כפתורי «אשר» / «בטל שינויים». ביטול משחזר את כל קבצי הסבב למצב הקודם; ההחלטה נשמרת על ההודעה (✓ אושרו / ✗ בוטלו) גם אחרי סגירת האפליקציה. שליחת הודעה חדשה בלי להחליט = הישארות עם השינויים (לא חוסם).
- **«הצג שינויים» על כל הודעת סוכן:** תצוגת diff מלאה (Monaco, לפני מול אחרי, זיהוי שפה אוטומטי) לכל קובץ שהשתנה בסבב — כולל סימון קבצים שנוצרו ושנמחקו. מוצגים רק קבצים שבאמת השתנו.
- **שחזור מכל הודעה:** לכל סבב בהיסטוריית הצ'אט יש נקודת שחזור משלו (דרך פאנל «היסטוריה» או ביטול הסבב האחרון).

### Added — ייבוא פרויקט קיים (כמו Dyad)
- **מסך «פרויקט חדש» קיבל מצב «ייבוא פרויקט קיים»:** בוחרים תיקייה עם פרויקט Node/JavaScript (React, Vite, Next...), NF-Blaze מתקין תלויות אם חסרות, מרים תצוגה חיה אם זה פרויקט Vite — ולא נוגע באף קובץ קיים. הסוכן ממשיך לעבוד על הקוד שלך עם כל היכולות (אינדקס פרויקט, זיכרון, תוכניות).
- הגנות: נדרש package.json, ותיקייה שכבר מקושרת לפרויקט לא תיובא פעמיים.

## 1.37.0 - 2026-07-30

הסוכן קיבל גישה לרשת, סיום משימות מלא בלי «כתוב המשך», תמיכה במודלים מקומיים (Ollama / LM Studio) ו-OpenRouter, שרתי MCP ו-Supabase מלא בכל התבניות.

### Added — גישה לרשת לסוכן
- **כלי `web_search`:** חיפוש ברשת (DuckDuckGo, בלי מפתח API) — כשמבקשים מהסוכן «בדוק ברשת» (השראה לעיצוב, תוכן, תיעוד ספריות) הוא באמת מחפש, במקום לענות שאין לו גישה לאינטרנט.
- **כלי `web_fetch`:** טעינת עמוד לפי URL והמרתו לטקסט קריא (כולל קישורים להמשך מעקב). זמינים בכל המצבים (שאלה / תכנון / ביצוע).

### Fixed — סיום משימות מלא (בלי «כתוב המשך»)
- **המשך אוטומטי:** תקרת 40 האיטרציות הפכה לתקציב סבב «רך» — כשמשימה גדולה מגיעה אליו, הסוכן ממשיך אוטומטית מאותה נקודה (עם כיווץ הקשר ותזכורת מיקוד לתוכנית), עד תקרת בטיחות של 160 איטרציות. ההודעה «הגעתי לתקרת האיטרציות — כתוב המשך» נעלמה; במקומה סטטוס «ממשיך אוטומטית (סבב N)».

### Added — מודלים מקומיים ו-OpenRouter (בהשראת dyad)
- **Ollama (מקומי):** בחר ספק «Ollama» והרץ מודלים חינם על המחשב — בלי מפתח API. מזוהה לפי קידומת `ollama:` במזהה המודל; ברירת מחדל `http://127.0.0.1:11434/v1` (ניתן לעקוף עם `OLLAMA_BASE_URL`).
- **LM Studio (מקומי):** אותו דבר דרך שרת LM Studio (`http://127.0.0.1:1234/v1`, עקיפה עם `LMSTUDIO_BASE_URL`).
- **OpenRouter:** מפתח אחד למאות מודלים (DeepSeek, Qwen, Llama, Kimi...). נשמר מוצפן כמו שאר המפתחות.
- מתאם OpenAI אוחד ל-factory תואם-OpenAI אחד (`createOpenAICompatAdapter`) שמשרת את כולם — סטרימינג, tool_use וטיפול בשגיאות זהים.
- בהגדרות: ספקים מקומיים מוצגים עם «לא נדרש מפתח — רץ מקומית» וקישור הורדה במקום שדה מפתח.

### Added — MCP servers (כמו Dyad Pro)
- **הסוכן תומך בשרתי MCP:** קובץ `mcp.json` בפורמט המוכר של Claude Desktop/Dyad — גלובלי (`%APPDATA%/nf-blaze/nf-blaze-data/mcp.json`) או פר-פרויקט (`.nf-blaze/mcp.json`, גובר על הגלובלי). כל כלי משרת מחובר נחשף לסוכן כ-`mcp_<שרת>_<כלי>` וזמין בכל המצבים.
- לקוח MCP מינימלי (stdio, JSON-RPC) בלי תלות חיצונית: `agent/mcp/`. שרתים נשארים חיים בין הודעות; שרת שנופל מדווח כסטטוס ולא מפיל את הבקשה; כל השרתים נסגרים ביציאה מהאפליקציה.
- **מסך ניהול MCP בהגדרות:** כרטיס «שרתי MCP» — הוספה/עריכה/מחיקה של שרתים (פקודה, ארגומנטים, משתני סביבה), הפעלה/השבתה, וכפתור «בדוק» שמרים את השרת ומציג את רשימת הכלים שלו. הקונפיג נכתב לאותו `mcp.json` גלובלי.

### Added — Supabase מלא בכל התבניות
- **תבנית «אתר/אפליקציה» (web-app) קיבלה חיווט Supabase מלא** כמו data-app: תלות `@supabase/supabase-js`, לקוח מוכן ב-`src/lib/supabase.ts` (עם `isSupabaseConfigured`), `.env.example`, טיפוסי env, וסעיף Supabase ב-PROJECT_RULES — חיבור Supabase עובד מיד בכל פרויקט חדש.
- **הקשר הסוכן הועשר:** כש-Supabase מחובר, הסוכן מקבל מדריך עבודה מלא — auth (`signUp`/`signInWithPassword`/`onAuthStateChange`), CRUD, Realtime, Storage, חובת RLS עם policies, והנחיה לכתוב SQL מלא למשתמש להרצה ב-SQL Editor.

### Changed
- **נוסח חדש למסך הבית:** תיאור המערכת עודכן כך שהוא מתאר את NF-Blaze עצמה — סביבת פיתוח עם AI שרצה מקומית, הקוד והמפתחות נשארים על המחשב — במקום השוואה למוצרים אחרים. הוסרו אזכורי מוצרים מתחרים גם מ-`README.md`, `prompts/system.md`, מודאל «פרויקט חדש» ומהערות בקוד.

## 1.36.0 - 2026-07-30

שדרוג משמעותי ביכולות הבנייה של הסוכן: המנוע החדש (tool_use עם הגנות) הפך לברירת המחדל לכל המשתמשים, עם זיכרון פרויקט מתמשך, תוכנית בנייה בשלבים שחיה בין הודעות, streaming אמיתי, ומשוב שגיאות ריצה מהתצוגה.

### Changed — המנוע החדש הוא ברירת המחדל
- **`agentEngine: 'new'` לכל המשתמשים** (מיגרציה חד-פעמית; בחירה ידנית ב«ישן» אחרי המיגרציה נשמרת). המשתמשים מקבלים עכשיו: `declare_scope`, אימות לפני כתיבה, תיקון tsc אוטומטי, בדיקת השלמה, כיווץ הקשר, ו-QA דפדפן.
- לפני ההחלפה נסגרו כל פערי החסימה שנמצאו במיפוי מלא של שני המנועים:

### Added — זיכרון ותוכנית (בנייה בשלבים)
- **כלי `update_plan`:** הסוכן שומר תוכנית שלבים ב-`.nf-blaze/plan.json`, מעדכן סטטוסים תוך כדי, וממשיך ממנה בהודעה הבאה («המשך»). רצועת התקדמות חדשה מעל שורת הכתיבה מציגה `תוכנית · 2/4` עם השלבים.
- **כלי `save_memory`:** זיכרון פרויקט ב-`.nf-blaze/memory.md` (עד 6K תווים) — החלטות ארכיטקטורה/סכמות/מוסכמות שמוזרקות לכל בקשה עתידית ושורדות כיווץ הקשר.
- **הקשר מלא בפרומפט המערכת** (פער מול המנוע הישן שנסגר): עץ קבצים, אינטגרציות מחוברות (Supabase/GitHub), קובץ פתוח בעורך, PROJECT_RULES, זיכרון ותוכנית.
- **משוב שגיאות ריצה מהתצוגה:** ‏window.onerror + unhandledrejection בתוך ה-iframe מדווחים ל-NF-Blaze; באנר אדום עם «תן לסוכן לתקן» שולח את השגיאה המלאה לסוכן.

### Fixed — פערי המנוע החדש שנסגרו לפני ההחלפה
- **סטרימינג אמיתי:** הלולאה עברה מ-`call()` (שהחזיר הכל בסוף) ל-`stream()` עם אירוע `model_delta` — טקסט זורם למשתמש תוך כדי יצירה, עם הפרדה בין איטרציות.
- **אבטחה — קבצי סוד:** ‏`read_file`/`grep` חוסמים `.env*`, מפתחות ו-credentials (החרגה: `.env.example`); כתיבה אליהם חסומה גם כן. במנוע החדש לא היה שום סינון.
- **Undo שלם:** snapshot יחיד לסבב שמורחב בכל קובץ חדש (`extendSnapshot`) — «בטל» משחזר את כל קבצי הסבב; קודם קבצים מהרחבת scope לא היו ניתנים לשחזור וה-undo החזיר רק snapshot אחרון חלקי.
- **הגנות כתיבה הרסנית:** חסימת ריקון קובץ קיים, כיווץ קטסטרופלי של קבצי config קריטיים, ו-package.json לא-JSON.
- **היסטוריית שיחה חסומה ל-28 הודעות** (הייתה בלתי מוגבלת — סיכון חריגת הקשר).
- **שגיאת ספק לא מוחקת את הסבב:** ההודעות נשמרות ל-chat.json ומוחזרת תשובה עם השגיאה (קודם — throw שאיבד גם את הודעת המשתמש).
- **תקרת 40 איטרציות מדווחת למשתמש** («כתוב המשך») במקום להיראות כהצלחה.
- **clarify במצב תכנון:** שאלות הבהרה מוצגות ככרטיס מובנה במקום JSON גולמי בצ׳אט.
- **maxTokens הועלה ל-16384** (ברירת מחדל האדפטרים 8192 קטעה קומפוננטות גדולות).
- **`npm run dev/start/preview` חסומים ב-run_command** (תהליכים ארוכים שחסמו את הלולאה 5 דקות).
- **אותו באג FORCE_COLOR מ-1.35.0 תוקן גם בשכבת הסוכן:** worker הבדיקות, run_command ו-browser QA עברו ל-NO_COLOR + ניקוי ANSI ב-parseTscOutput (בלעדיו זיהוי שגיאות build נכשל).
- **ביטול אמיתי ב-Gemini:** ה-signal מועבר ל-SDK (קודם ביטול תפס רק בין chunks); הוסרה קריאת abort כפולה שיצרה אירוע «בוטל» מיותר בתחילת כל סבב.
- **Gemini 3 — ‏thought signatures (נמצא בבדיקת E2E):** מודלי Gemini 3 מחזירים `thoughtSignature` על כל functionCall ו**דוחים ב-400** כל בקשה שמחזירה functionCall בהיסטוריה בלעדיו. החתימה מועברת עכשיו בכל השרשרת (ToolCall ← tool_use ← Gemini parts), כולל עקיפת באג ב-SDK של גוגל שמוחק את השדה באגרגציית ה-stream — החתימות נלכדות מה-chunks הגולמיים וממוזגות חזרה לפי סדר הקריאות. בלי זה המנוע החדש נשבר עם Gemini אחרי האיטרציה הראשונה.
- **`run_command` נכשל ב-`spawn EINVAL` על Windows:** הרצת `npm.cmd` עם `shell:false` נחסמת ב-Node מעודכן (תיקון CVE-2024-27980) — עכשיו רץ עם shell כמו שאר שכבות ההרצה.
- **QA דפדפן בלי Chromium מותקן מדלג בשקט** במקום להוסיף הודעת כישלון לכל תשובה (רלוונטי לגרסה הארוזה).
- **מד ההקשר מדויק למנוע החדש** (קודם חושב לפי קבצי המפתח שהמנוע הישן הזריק).
- **סקריפט select/שגיאות-ריצה נארז ב-EXE** (`packages/vite-plugin-nf-source/src`) ותוקן נתיב הטעינה בגרסה ארוזה.

### Tests
- ‏11 בדיקות חדשות: חסימת קבצי סוד, הגנות כתיבה הרסנית, חסימת סקריפטים ארוכים, `update_plan`/`save_memory`. סה"כ 72 בדיקות עוברות.

## 1.35.0 - 2026-07-30

נמצא בבדיקת E2E מלאה (יצירת פרויקט CRM כמשתמש אמיתי דרך ה-UI): התצוגה החיה מעולם לא עלתה — כל פרויקט נפל למצב גיבוי סטטי שהוצג כמסך לבן.

### Fixed
- **שרת הפיתוח תמיד נפל למצב גיבוי (הבאג המרכזי):** `getRuntimeSpawnEnv` הגדיר `FORCE_COLOR: '0'` — אבל picocolors (ספריית הצבעים של Vite) בודק רק אם המשתנה *קיים* ומדליק צבעים גם על `'0'`. קודי ה-ANSI פיצלו את ה-URL בפלט (`http://localhost:` ‏← `ESC[1m` ‏← `5173`), `extractLocalUrl` תפס `http://localhost` בלי פורט, בדיקת ה-HTTP נכשלה — ונפלנו לגיבוי סטטי בכל יצירת פרויקט. תוקן: `NO_COLOR=1` במקום `FORCE_COLOR` (שנמחק מהסביבה), ניקוי ANSI מכל פלט (`stripAnsi`), וזיהוי ה-URL רץ על הלוג המצטבר כדי לא לפספס URL שהתפצל בין chunks.
- **מצב הגיבוי הסטטי הציג מסך לבן:** ‏`vite build` ברירת מחדל מפיק נתיבי `/assets/...` אבסולוטיים, שתחת `nfblaze://preview/<projectId>/dist/` מתפרשים כ-projectId ומחזירים 404. תוקן: בניית הגיבוי מזהה פרויקט Vite ומעבירה `--base=./` (נתיבים יחסיים).
- **באנר «מצב גיבוי» וטרמינל ריקים אחרי יצירת פרויקט:** ה-workspace הניח ש-URL חם מיצירת הפרויקט הוא תמיד `live` ולא הציג לא באנר ולא לוג. תוקן: IPC חדש `preview:live-status` שמחזיר את המצב האמיתי (live/fallback) + לוג ההרצה, וה-workspace מציג אותם בעלייה.
- **שינויי סוכן לא הופיעו במצב גיבוי:** אחרי שהסוכן כתב קבצים במצב גיבוי, התצוגה המשיכה להציג build ישן (אין HMR). תוקן: בסיום סבב עם שינויים במצב גיבוי מופעלת «הפעל מחדש תצוגה» — שגם בונה מחדש וגם נותנת לשרת הפיתוח הזדמנות נוספת.
- **CSP לא תקין בקונסולה:** ‏`http://[::1]:*` אינו מקור חוקי ב-`frame-src` (שגיאה בכל טעינה). הוסר.

### Changed
- **תבניות `web-app`/`data-app` — יישור ל-shadcn המלא:** ל-`button.tsx` נוספו `variant: destructive/secondary/link` ו-`size: icon` (+ tokens ב-Tailwind וב-CSS) — הסוכן כותב קוד לפי ה-API הסטנדרטי של shadcn וקיבל `TS2322` על `size="icon"` בבדיקה בפועל.
- **תבניות — ‏`noUnusedLocals`/`noUnusedParameters` כובו ב-`tsconfig.app.json`:** משתנה לא-בשימוש הוא תוצר שכיח וזניח של קוד שנוצר על ידי AI (נצפה בפועל: `setDeals`), והוא הפיל את `npm run build` של מצב הגיבוי בלי שום באג אמיתי.

## 1.34.0 - 2026-07-25

### Fixed
- **תצוגה מקדימה נכשלת בפרויקטי React חדשים:** לתבניות `web-app`/`data-app` חסרה תלות `@types/node` ו-`"types": ["node"]` ב-`tsconfig.node.json`, מה שגרם ל-`vite.config.ts` (שמשתמש ב-`node:url`/`import.meta.url` ל-alias של `@`) להיכשל ב-`tsc -b` עם `TS2307`/`TS2339` — בדיוק השגיאות שהוצגו למשתמש כשמצב הגיבוי (`npm run build`) הופעל. אומת עם בנייה מלאה + הרצת `npm run dev` אמיתית על שני התבניות אחרי התיקון.

### Added
- **קונסולת שרת פיתוח בטאב «טרמינל»:** פלט ה-`npm run dev` (התקנה → הרמה → מוכן/קרס/גיבוי) מוזרם עכשיו לטאב הטרמינל הקיים בזמן אמת — כמו ב-bolt.new/lovable — ולא רק כ-12 שורות זמניות מעל התצוגה בזמן עלייה. נורית ירוקה פועמת על הטאב «טרמינל» כשהשרת פעיל.

## 1.33.0 - 2026-07-25

### Fixed
- **`npm run typecheck` נכשל בפועל:** ל-`tsconfig.node.json`/`tsconfig.web.json` לא הוגדר `target`, מה שגרם לקבצי `agent/`+`providers/` (שנטענים דרך main) להיבדק מול ES ישן וליפול על עשרות שגיאות איטרציה של `Set`/`Map`/`RegExp`
- **באג טיפוסים אמיתי ב-`agent/loop.ts`:** מנגנון תיקון ה-tsc (`tscRepair`) קרס ל-`never` אחרי `await` בתוך הלולאה (מגבלת control-flow narrowing של TS למשתנה מוטבע שמשתנה מתוך closures) — נפתר עם פונקציית קריאה מפורשת שמשמרת את הטיפוס
- **דליפת גרסה:** מספר הגרסה בכותרת האפליקציה ובקובץ ה-README כבר לא קבוע (hardcoded) — נלקח דינמית מ-`package.json` דרך IPC חדש (`app:get-version`)
- **אזהרת הצפנה חסרה:** אם `safeStorage` לא זמין במערכת ההפעלה, המפתחות נשמרים כטקסט גלוי — כעת מוצגת אזהרה ברורה במסך ההגדרות + לוג אזהרה ב-main

### Added
- **React Error Boundary** סביב כל האפליקציה — מסך שגיאה ידידותי בעברית במקום מסך לבן בקריסת רינדור
- **תשתית איכות קוד:** ESLint (flat config) + Prettier + `npm run lint`/`format`; `npm test` מריץ עכשיו את כל סוויטות ה-Vitest (core + agent/tools + agent/index + providers) בפקודה אחת
- **CI:** GitHub Actions להרצת typecheck/lint/test בכל push ו-PL

### Security
- עדכון `playwright` לתיקון עקיפת אימות SSL בהורדת דפדפנים (`npm audit fix`)
- הסרת תלות מתה (`zustand`, לא היה בשימוש בקוד האפליקציה)

## 1.32.0 - 2026-07-25

### Fixed
- **תצוגה חיה מיד אחרי יצירת פרויקט:** אחרי העתקת תבנית + npm install — הרמת Vite לפני פתיחת ה-workspace (כמו bolt)
- **לחיצה על index.html בפרויקט React:** כבר לא מחליפה ל-`nfblaze://` סטטי (מסך ריק); נשארת על שרת הפיתוח
- **עריכת קבצי מקור:** לא מוחקת את URL התצוגה החיה; מעבר חזרה ל«תצוגה» עובד
- **Strict Mode / מעבר פרויקט:** עצירת שרת עם השהיה קצרה כדי לא להרוג תצוגה שחוממה ביצירה

## 1.31.0 - 2026-07-24

### Added
- **בדיקת סביבת Node בהפעלה:** זיהוי node/npm וגרסה; אם חסר או מתחת ל־18 — מסך חסימה בעברית עם קישור להורדה ו«בדיקה מחדש» (בלי להתחיל לבנות ולכשל)
- **סטטוס סביבה בהגדרות** + כפתור בדיקה מחדש
- **שכבת הרצה:** העדפת Node מצורף מ־`resources/runtime` (נארז ב־extraResources) על פני Node של המערכת; shell / תצוגה חיה / התקנת תבניות משתמשים בו

## 1.30.0 - 2026-07-24

### Added
- **תצוגה מקדימה דרך שרת פיתוח:** פרויקטים עם `package.json` + סקריפט `dev` מרימים `npm run dev` (התקנה אוטומטית אם חסר `node_modules`), קוראים URL מהפלט, וממתינים לתגובת השרת לפני הצגת ה-iframe
- **מצבי תצוגה חיים:** «מתקין תלויות» → «מרים שרת» → «מוכן»; כפתור «הפעל מחדש תצוגה»; שגיאות/קריסה בעברית באזור התצוגה + «תן לסוכן לתקן»
- **גיבוי סטטי:** אם השרת לא עולה תוך 60ש׳ — `npm run build` והגשת הפלט דרך `nfblaze://` עם באנר «מצב גיבוי בלי עדכון חי»
- **CSP:** `frame-src` / `connect-src` ל-localhost כדי לאפשר iframe + HMR

### Fixed
- פרויקטי React/Vite כבר לא נשארים עם מסך ריק מ-HTML סטטי בלבד

## 1.29.0 - 2026-07-24

### Fixed
- **Gemini tool schemas:** ניקוי רקורסיבי (whitelist) לפני שליחה — מסיר `additionalProperties` ושדות JSON Schema שאינם נתמכים; כלי בלי פרמטרים נשלח בלי שדה `parameters` ריק
- **שגיאת 400 מ-Gemini:** הודעה קצרה בעברית במקום JSON גולמי

## 1.28.0 - 2026-07-24

### Fixed
- **זיהום היסטוריה ב-ASK/PLAN:** בלוקי פעולה (`nfblaze`) מנוקים מההיסטוריה שנשלחת למודל — נשאר רק טקסט
- **מצב אוטומטי:** זיהוי כוונה אמיתי דרך מודל מהיר (`{"intent":"ASK"|"PLAN"|"BUILD"}`); ספק → ASK; בחירה ידנית תמיד גוברת; בנתיב legacy דרך `callLlm` עם אותו ספק

### Added
- **תג מצב על כל תשובה** בממשק (שאלה / תכנון / ביצוע, כולל «אוטומטי · …» כשזוהה)
- **שאלות הבהרה במצב תכנון:** בלוק `clarify` נפרד, כרטיס UI עם אפשרויות + «אחר» / «תחליט אתה»; JSON גולמי מוסתר בסטרימינג; clarify אינו פעולת כתיבה ואינו נחסם; clarify+כתיבה → רק שאלות

## 1.27.0 - 2026-07-24

### Fixed
- **אכיפת מצב עבודה (שאלה / תכנון / ביצוע)** — שלוש שכבות:
  1. המצב נשלח ב-IPC, נשמר על הודעת המשתמש בהיסטוריה; מצב חסר → שאלה (לא ברירת מחדל שקטה ל-auto/ביצוע)
  2. במצב שאלה/תכנון פרומפט המערכת לא כולל פורמט `nfblaze` בכלל; במקום זה הנחיה מפורשת לא לשנות קבצים (תכנון = תוכנית ממוספרת בלי קוד)
  3. בנקודת יישום הפעולות — חסימה מוחלטת של כתיבה ב-ASK/PLAN; בלוק כתיבה מוסתר; בממשק הודעה + כפתור «עבור לביצוע והרץ»
  - נתיב legacy (`src/main/services/ai/agent.ts`) ונתיב חדש (`agent/loop.ts` + `agent_bridge`)

## 1.26.0 - 2026-07-24

### Added
- **ניהול הקשר בלולאת הסוכן** (`agent/context_compact.ts` + `agent/loop.ts` + מד הקשר):
  - כיווץ אוטומטי סביב ~60% מחלון המודל הנבחר — רק בין סבבים שהושלמו (לא באמצע משימת tsc פתוחה)
  - נשמרים: מה נבנה, קבצים שננגעו, החלטות, מה פתוח; נזרקים תוכן קבצים גולמי ופלטי כלים ארוכים
  - פלטי כלים ארוכים נשמרים ב-`.nf-blaze/tool_results/` עם מזהה קצר בהקשר
  - במד ההקשר: סימון «כווץ» + באנר מתי בוצע הכיווץ

## 1.25.0 - 2026-07-24

### Added
- **שער אבטחה לפני פרסום Vercel** (`src/main/services/security/` + שכבת הפרסום + UI):
  - חסימה מוחלטת (לא אזהרה) על: service_role/סוד ב-bundle, קובץ `.env` בפרסום, סודות מקודדים קשיח, טבלת Supabase שנקראת עם anon בלי אימות (כולל SQL לתיקון)
  - אזהרה חזקה על מדיניות RLS שמתירה הכול (`USING (true)` / טבלה פתוחה)
  - בממשק בעברית: מה נמצא, למה מסוכן, «תן לסוכן לתקן», ועקיפה ידנית רק אחרי סימון + הקלדת משפט אישור מפורש
  - קבצי `.env` גם מסוננים מחבילת `source.tgz` כהגנה נוספת

## 1.24.0 - 2026-07-24

### Added
- **תת-סוכן בדיקת דפדפן** (`agent/browser_qa/` + `agent/loop.ts`):
  - אחרי בנייה מוצלחת (completion + tsc) — הרמת תצוגה + Playwright מקומי (Chromium headed)
  - הקשר נפרד: בקשת משתמש + מפת מסכים; לולאה עם לחיצה / הקלדה / ניווט / צילום / שגיאות קונסול בלבד (בלי כלי כתיבה)
  - מחזיר לסוכן הראשי סיכום קצר בלבד; תיקון + בדיקה שנייה אחת בלבד
  - רץ רק כשהשתנה מספיק (BUILD + קבצים משמעותיים), לא אחרי כל הודעה
  - בממשק: תג חי «דפדפן פועל» עם הפעולה הנוכחית

## 1.23.0 - 2026-07-24

### Added
- **שכבת תיקון לפני דיסק** (`agent/correct/` + `agent/loop.ts`):
  - **שלב א׳ (דטרמיניסטי):** תיקון import של אייקונים/קומפוננטות מול ייצוא אמיתי של החבילה המותקנת (fuzzy), ותיקון/סימון ייבוא מקומי חסר — לפני `write_file` / `edit_file`
  - **שלב ב׳ (אחרי הסטרימינג):** עטיפת providers ל-hooks, הוספת תלויות חסרות ל-`package.json`, ותיקוני JSX/TS נפוצים (כולל AST דרך `@babel/*` של פרויקט המשתמש כשזמין)
  - המשתמש לא רואה את המצב השגוי — התיקון רץ לפני הכתיבה/תצוגה
  - מדד מרכזי: אחוז בקשות BUILD עם תצוגה מקדימה תקינה בניסיון הראשון → `.nf-blaze/preview_metrics.json`

## 1.22.0 - 2026-07-24

### Changed
- **tsc/build ב-worker נפרד** (`agent/workers/project_check_worker.mjs` + `agent/completion_check.ts`):
  - בדיקות רצות ב-`worker_threads` על תיקיית המשתמש בלבד (נתיב מוחלט — לא `process.cwd()`)
  - לולאת הסוכן / תהליך Electron הראשי לא נחסמים; אפשר לבטל בדיקה שרצה (כולל ביטול צ׳אט)
  - אינדיקציה חיה בממשק: בודק / עבר / נכשל (+ מספר שגיאות), timeout / בוטל
  - תוצאות ממשיכות להזין את לולאת תיקון tsc כשהן מוכנות
  - אם הבדיקה לא מסתיימת ב־90 שניות — ביטול + אזהרה בעברית

## 1.21.0 - 2026-07-24

### Added
- **Preview element pick → agent** (`packages/vite-plugin-nf-source` + templates + preview UI):
  - Vite plugin (dev/`serve` only) tags JSX with `data-nf-file` / `data-nf-line` / `data-nf-component`
  - Injects select-mode client; templates include the plugin under `plugins/nf-blaze-source`
  - Workspace: select mode (hover outline, click), chip above chat (removable)
  - Selection sent with the user instruction as agent context (path + line + component)
  - Vite projects: live preview via `npm run dev` so tagged elements are available

## 1.20.0 - 2026-07-24

### Added
- **Starter templates with PROJECT_RULES** (`templates/` + create flow):
  - `web-app` — Vite + React + TS + Tailwind + shadcn-style UI (Hebrew RTL built-in)
  - `data-app` — same base + ready Supabase client
  - Each template ships `PROJECT_RULES.md` (stack, naming, allowed UI lib, design rules, RTL: start/end not left/right) — injected into the system prompt every request (legacy + new engine bridge)
  - New project modal: pick template → copy into empty user folder → `npm install` → only then workspace opens for the agent
  - Legacy agent blocks writes/edits to template config files unless the user explicitly asks; rules also warn the new engine

## 1.19.0 - 2026-07-24

### Added
- **Vercel publishing from the app** (integrations layer + Settings + Workspace):
  - **Path A — instant (no user account):** pack project to `.vercel/source.tgz` (excludes `node_modules` / `.git`), upload via `POST /v2/files` + `POST /v13/deployments`, show live URL + **claim URL**, Hebrew explanation of claim
  - **Path B — user account:** Vercel token in Settings (encrypted `safeStorage`), deploy to existing or new project
  - Framework detection from `package.json` → Vercel `projectSettings`
  - Supabase env vars injected automatically when connected
  - After deploy: URL saved on project; Workspace shows **«פרסם עדכון»**
  - Build failure: pull Vercel log, show in Hebrew, **«תן לסוכן לתקן»** feeds the log into chat (BUILD)

## 1.18.0 - 2026-07-24

### Added
- **Work modes for the new agent engine** (`agent/intent.ts` + `agent/loop.ts` + UI):
  - Auto-detect via a short fast-model call → `{ intent: ASK | PLAN | BUILD }` (doubt → ASK)
  - ASK / PLAN: only `read_file`, `list_dir`, `grep` are sent to the model
  - BUILD: full tool set
  - Manual picker in Workspace (אוטומטי / שאלה / תכנון / ביצוע) overrides detection
  - After ASK/PLAN: «בצע את זה» re-runs in BUILD with history — never automatic

## 1.17.0 - 2026-07-24

### Added
- **Project convention index wired to Electron**:
  - On project open / create: `ensureProjectIndex` → `.nf-blaze/project-index.json`
  - Service: `src/main/services/project_index.ts` + IPC ensure/refresh/get
  - Workspace UI: index status + manual refresh
  - New engine bridge refreshes the index after a write round; `runAgentLoop` still injects conventions into the system prompt each request

## 1.16.0 - 2026-07-24

### Added
- **New agent engine behind a settings flag** (default: legacy):
  - Settings → «מנוע סוכן» — `legacy` (nfblaze) / `new` (`agent/loop` + `providers`)
  - Bridge: `src/main/services/ai/agent_bridge.ts` — routes chat to `runAgentLoop` with `project.folderPath` as root
  - UI stream events: `scope`, `tool`, `tsc_fix`, `completion_check` (plus existing status/token/file/undo/preview/context meter)
  - Snapshot before writes on declare_scope; Undo unchanged

## 1.15.0 - 2026-07-24

### Fixed
- **tsc/build run only on the user project** (`agent/completion_check.ts` + `agent/loop.ts`):
  - `rootDir` must be an absolute user-project path (`requireUserProjectRoot`) — no `process.cwd()` fallback
  - Skip tsc silently when no `tsconfig.json` / `jsconfig.json`; skip build when no `scripts.build`
  - Hard timeout 90s (`PROJECT_CHECK_TIMEOUT_MS`) — on timeout emit `check_warning` and continue (do not hang)

## 1.14.0 - 2026-07-24

### Changed
- Updated `prompts/system.md` to match live `agent/` tools and guards:
  `declare_scope`, read-before-edit, intentional `edit_file` uniqueness errors (retry via re-read, not `write_file`), pre-write import/package checks, and completion-gate before declaring done

## 1.13.0 - 2026-07-24

### Added
- **Structured tsc repair** (`/agent/completion_check.ts` + `/agent/loop.ts`):
  1. Parse `tsc` output into file / line / message — never send raw logs to the agent
  2. Group errors by file; fix one file per round
  3. Prompt includes that file's errors + content + `תקן רק את השגיאות האלה. אל תיגע בשום דבר אחר.`
  4. Re-run after each fix; if error count rises, restore the last fix and ask for another approach
  5. After 3 failed attempts — stop with `tsc_unresolved` and show remaining errors (never report success while broken)

## 1.12.0 - 2026-07-24

### Added
- **Completion gate** (`/agent/completion_check.ts` + `/agent/loop.ts`):
  - When the agent stops calling tools after writing files, the loop runs completion checks before accepting "done"
  - Checks: `npx tsc --noEmit`, project `build`, no TODO/FIXME/placeholder, no Lorem/`כאן יבוא`, list UIs have loading+empty+error, imports resolve
  - On failure, injects: `עוד לא סיימת. חסר: [התנאי]. תקן רק את זה.` and continues the loop (emits `completion_blocked`)

## 1.11.0 - 2026-07-24

### Added
- **Session guards** in `/agent/tools` (+ wiring in `/agent/loop`):
  1. `declare_scope` — before first `edit_file` / `write_file`, agent must declare intended files; out-of-scope edits fail with a fixed Hebrew message
  2. `edit_file` requires a prior `read_file` in the same request session
  3. Scope expansion via a new `declare_scope` call with required `reason` — recorded and emitted as a `scope` loop event for the user UI

## 1.10.0 - 2026-07-24

### Added
- **Pre-write validation** in `/agent/tools` for `edit_file` / `write_file`:
  1. External imports must exist in `package.json` (else: package not installed)
  2. Local imports must resolve to a real file (else: lists files in the directory)
  3. Project component JSX props must match the component signature index (else: returns real signature)
- Failures are intentional so the agent can self-correct from the tool error

## 1.9.0 - 2026-07-24

### Added
- **Project convention index** (`/agent/index`):
  - On project open: `ensureProjectIndex(rootDir)` scans exports, file naming, state, styling, error handling, TypeScript/`any`
  - Cached under `{project}/.nf-blaze/project-index.json` (+ memory) - not rescanned every request
  - Injected into the system prompt on every agent run via `systemPromptForProject` / `runAgentLoop`
  - Instruction: match existing code; do not impose another style
- Updated `/prompts/system.md` with the match-existing-code rule

### Notes
- Index + prompt injection only; tools/providers untouched.

## 1.8.0 - 2026-07-24

### Added
- **Agent loop** (`/agent/loop.ts`) over the unified `/providers` `call()` adapter (40-iteration tool loop)

## 1.7.0 - 2026-07-24

### Added
- **Agent tools** under `/agent/tools` - JSON Schema + executors

## 1.6.0 - 2026-07-24

### Added
- Unified provider adapter layer under `/providers`

## 1.5.0 - 2026-07-24

### Added
- E2B session runtime under `/sandbox`
