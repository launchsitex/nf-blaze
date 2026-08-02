# PROJECT_CONTEXT

## מהות

תוכנת דסקטופ Electron שבונה אפליקציות למשתמש.
קבצי הפרויקטים של המשתמש נשמרים מקומית על המחשב שלו.
אין sandbox מרוחק. לשרת יוצאות רק קריאות למודלים.

## סטאק

Electron + electron-vite + React 19 + TypeScript

## נקודת כניסה

`src/main/index.ts`

## ארכיטקטורות סוכן

### חדשה (ברירת המחדל מאז 1.36.0)

`agent/` + `providers/` דרך `src/main/services/ai/agent_bridge.ts`

- tool_use מקורי + streaming אמיתי
- אימות לפני כתיבה + הגנות כתיבה הרסנית + חסימת קבצי סוד
- `declare_scope`, `completion_check`, תיקון tsc, כיווץ הקשר
- זיכרון פרויקט (`save_memory` → `.nf-blaze/memory.md`)
- תוכנית בנייה בשלבים (`update_plan` → `.nf-blaze/plan.json`), כולל `acceptance`
- «בסיס ירוק» (`agent/health/`) — אחרי סבב כתיבה משווה את מצב האפליקציה
  ל-`.nf-blaze/health.json` (האחרון הידוע כתקין) ומדווח שבירה. דיווח בלבד.
- מפת פרויקט (`agent/repo_map/`) — גרף ייבוא + PageRank; גם ניתוח השפעה
  (`impactedFiles`) שקובע מה יכול להישבר משינוי נתון.
- מטמון פרומפט (`providers/cache.ts`) ותיקון ארגומנטים (`providers/repair.ts`).
- אכיפת מערכת עיצוב (`agent/tools/design_rules.ts`) — נאכפת ב-`validate_write`,
  לכל היותר פעמיים לקובץ כדי שלא ייווצר מבוי סתום.
- אמון מדורג (`src/main/services/trust.ts`) → `.nf-blaze/trust.json`.
- הריגת עץ תהליכים (`agent/process_tree.ts`) — חובה ב-Windows, אחרת
  `npm`/`vite` נשארים יתומים אחרי כל בדיקה.

### ישנה (fallback בלבד)

`src/main/services/ai/` — פורמט `nfblaze` JSON. נבחרת רק ידנית בהגדרות (`agentEngine: 'legacy'`).

### החלטה

הישנה תוסר בגרסה עתידית אחרי תקופת יציבות של החדשה.

## evals/

סוויטת משימות ייחוס עם בדיקות קבלה דטרמיניסטיות.
`npm run eval` (ב-PowerShell דרך `NF_EVAL_MODEL` / `NF_EVAL_KEY`);
`npm run test:evals` בודק את מנוע הבדיקות עצמו.

## חלון ואריזה

- **סרגל החלון הוא סרגל האפליקציה**: `titleBarStyle: 'hidden'` + `titleBarOverlay`
  ב-Windows, ותפריט Electron מוסר (`Menu.setApplicationMenu(null)`).
  גובה 56px מסונכרן בין `TITLE_BAR_HEIGHT` ב-`src/main/index.ts` ל-`.topbar` ב-CSS.
  ⚠️ בעברית Electron ממקם את כפתורי החלון **משמאל** — לכן ה-padding בסרגל לוגי ולא פיזי.
- **Chromium מצורף**: `src/main/services/browser-env.ts` מגדיר `PLAYWRIGHT_BROWSERS_PATH`
  בעליית האפליקציה. נארז ה-headless shell בלבד, ולכן כל הרצה חייבת להיות headless.

## מלכודות ידועות באינטגרציות

- **Supabase `/rest/v1/` מוגבל ל-`service_role`.** מפתח `anon` תקין נדחה שם.
  בדיקת חיבור משתמשת ב-`/auth/v1/health`; מיפוי טבלאות בסורק האבטחה משתמש
  ב-`service_role` ונופל חזרה ל-anon. **כשל מיפוי מדווח כאזהרה, לא כ«נקי»** —
  אחרת הסורק מאשר פרויקט שלא נבדק.
- **מפתחות `sb_publishable_` אינם JWT** ואסור לשלוח אותם ב-`Authorization: Bearer`.
- **גישת סוכן ל-DB (מ-1.61.0):** אם המשתמש מחבר Access Token, הסוכן מקבל את הכלי
  `run_sql` שמריץ SQL דרך ה-Management API (`/v1/projects/{ref}/database/query`),
  כמו Dyad. `src/main/services/integrations/supabase_management.ts`. פעולות
  הרסניות (DROP/DELETE/TRUNCATE) חסומות עד `confirm=true` אחרי אזהרת המשתמש.
  הכלי מוזרק ל-agent loop כ-`extraTools` (כמו MCP) ב-`agent_bridge.ts`.
- **חיבור חשבונות ב-OAuth (מ-1.63.0):** «התחבר עם GitHub/Supabase/Vercel» במקום הדבקת
  טוקן. `integrations/oauth.ts` (מאזין `127.0.0.1` בפורט אקראי + PKCE) ו-`oauth_connect.ts`
  (שמירה במקום שבו שאר הקוד כבר מצפה למצוא טוקן). ה-`client_secret` יושב **רק** ב-Edge
  Function `oauth` על פרויקט הרישוי — אפליקציית דסקטופ לא יכולה להחזיק סוד כזה.
  הטוקן חוזר ללולאה המקומית **מוצפן** במפתח שנגזר מה-challenge; רק מי שמחזיק את
  ה-verifier מקבל פענוח, ב-HTTPS. ‏Supabase: `supabase_account.ts` — בחירת פרויקט
  מרשימה, משיכת מפתחות אוטומטית, וחידוש טוקן (refresh חד-פעמי — לשמור תמיד את החדש).
  ‏Vercel: מסלול **Integration**, לא «Sign in with Vercel» (זהות בלבד).
  מדריך והגדרת סודות: `license-portal/OAUTH.md`. הזנה ידנית נשארה כ«מתקדם».
- **פרסום ל-GitHub (מ-1.61.0):** `publishToGithub`/`buildGithubPublishTool` ב-
  `integrations/github.ts`. פרויקט מקושר → ענף חדש (`nf-blaze-<hex>`); לא מקושר
  → ריפו חדש בחשבון. כלי `publish_github` לסוכן (מוזרק כשיש טוקן GitHub) + כפתורים
  ב-ProjectOverviewPage. הטוקן מוזרק ל-remote רק לרגע ה-push.
- **משוב מלקוחות (מ-1.66.0):** כפתור «משוב» באפליקציה → Edge Function
  `submit-feedback` → טבלת `nfb_user_feedback` → טאב «משוב ממשתמשים» בפורטל.
  ‏`src/main/services/feedback.ts`. **בעל רישיון לא מצהיר על שמו** — נשלח
  המפתח החתום, והשרת מחלץ ממנו את הזהות (כמו `validate-license`), אחרת אפשר
  היה לשלוח פניות בשם לקוח אחר. המפתח נקרא ב-`getStoredLicenseKey()` בתהליך
  הראשי בלבד ואינו חוצה IPC.
  ‏**גם בלי רישיון אפשר לשלוח** (מ-1.66.1, סוג «בקשת/חידוש רישיון»): הערוץ
  ב-`LICENSE_FREE_CHANNELS`, כי מי שתקוע בשער הרישיון אין לו דרך אחרת
  לפנות. אז שם ואימייל הם חובה, הפנייה נשמרת עם `verified=false` ומוצגת
  בפורטל עם תגית «לא מאומתת» — **אין להנפיק רישיון על סמכה בלי אימות חיצוני**.
  מגבלת קצב: פנייה אחת ל-3 שעות לכל IP, אטומית במסד
  (`nfb_feedback_throttle_check`), כי מגבלה בזיכרון לא שורדת מיחזור אינסטנס.
- **אין לבלוע שגיאות של ספקים חיצוניים.** הודעה גנרית הסתירה כאן שני באגים,
  אחד מהם ביטל תכונת אבטחה שלמה.

## sandbox/

קוד E2B, לא בשימוש בתוכנה המקומית. מיועד למחיקה.

## גרסאות

- `package.json` — `1.66.2`
- `CHANGELOG.md` — `1.66.2`

## רישוי והגנת קוד

- **רישיון קנייני** (`UNLICENSED`) — לא MIT. התקנון ב-`build/license_he.txt`.
- **מפתחות רישיון**: Ed25519 חתום, אימות אופליין. שני מסלולי הנפקה — הפורטל
  (חותם ב-Edge Function עם הסוד `LICENSE_PRIVATE_KEY`) ו-`npm run license:issue`
  (חותם מקומית עם `secrets/license-private.pem`). טסט שומר סף מוודא שהמפתח
  הציבורי בקוד תואם.
- **מה קורה אם `secrets/license-private.pem` אובד — הניסוח המדויק:**
  רישיונות קיימים **ממשיכים לעבוד**. האימות באפליקציה נעשה מול המפתח
  **הציבורי** המוטמע בקוד (`LICENSE_PUBLIC_KEY_PEM`), והמפתח הפרטי נדרש
  לחתימה בלבד. גם הפורטל ממשיך להנפיק, כי יש לו עותק משלו ב-Supabase.
  מה שכן נשבר: הנפקה משורת הפקודה, ו**היכולת להתאושש אם העותק ב-Supabase
  יאבד** (סודות ב-Supabase הם לכתיבה בלבד — אי אפשר לקרוא אותם חזרה).
  ⚠️ בגרסאות קודמות של המסמך נכתב כאן «אובדנו = כל הרישיונות מפסיקים
  לעבוד» — זה **לא נכון** ואומת בקוד ב-01.08.2026.
- **הגנת שעון (anti-rollback, מקורות מרובים בסגנון Office/Adobe)**:
  `src/main/services/license.ts` בודק תפוגה מול «זמן אמין» = max על שעון +
  high-water (מוצפן+HMAC, `license-seen`) + `iat` חתום + mtime של קבצי
  האפליקציה (+ עוגן `.license-anchor`). ערך עתידי אבסורדי נחתך, חלון חסד
  לתיקוני NTP, והודעת מניפולציה מפורשת. תאריך התפוגה הוא היום האחרון בתוקף
  (`daysLeft <= 0` = פג). לוגיקה טהורה: `trustedEvaluationMs`/`nextHighWater`
  ב-`src/shared/license.ts`, נבדקת ב-tests.
- **אכיפה חיה ב-renderer**: `App.tsx` בודק סטטוס כל 30 שנ' + ב-visibilitychange;
  תפוגה/הסרה מחזירות לשער מיד. פופ-אפ «נשאר יום אחד» ב-`LicenseExpiryModal`.
  זו שכבת UX — הגבול האמיתי הוא שומר ה-IPC בתהליך הראשי.
- **ספירת מושבים** (מ-1.65.0): האפליקציה שולחת את `machineFingerprint()` ל-
  `validate-license`, שתופס מושב דרך `nfb_claim_seat()` (אטומי, `for update`)
  ואוכף מכסה (`nfb_licenses.seats`, ברירת מחדל 3). עד 1.64.0 **המפתח היה כרטיס
  נושא** — הקשירה למכונה הייתה מקומית בלבד ומחיקת `license-fingerprint` ביטלה
  אותה, כך שמפתח אחד עבד על מספר בלתי מוגבל של מחשבים והשרת לא ידע.
  ניהול המושבים והמכסה נעשה בטאב «רישיונות» בפורטל (מ-1.66.1).
- **🔴 חיבור לאינטרנט הוא דרישה (מ-1.66.1). חלון החסד: 15 דקות** — היה 48
  שעות. נתי החליט (02.08.2026) שהמערכת תדרוש חיבור קבוע, בנימוק שהיא ממילא
  עובדת מול מודלי AI מרוחקים. האימות רץ כל 5 דקות
  (`LICENSE_REVALIDATE_INTERVAL_MS`) — שלושה ניסיונות לפני חסימה — ובעלייה.
  ⚠️ **הערך אינו יכול להיות 0**: הבדיקה היא `now - anchor > grace` והפרש
  שעונים קיים תמיד. ⚠️ **ההשלכות שהוצגו והוחלט לקבל:** תקלה ב-Supabase
  משביתה את כל הלקוחות למשך התקלה (מתקן את עצמו — «בדוק שוב» מחזיר גישה),
  ומודלים מקומיים (Ollama / LM Studio) שעובדים אופליין כפופים לאותה דרישה.
  קיים **מתג חירום**: `LICENSE_GRACE_OVERRIDE_MS` בפרויקט הרישוי מאריך את
  החלון בתשובה חתומה (`gr`), נחתך ב-`MAX_SERVER_GRACE_MS` = 30 יום בלקוח —
  אבל הוא עצמו מגיע דרך Supabase, ולכן לא עוזר כשהיא למטה.
- **רישיון = מחשב אחד (מ-1.66.1):** ברירת המחדל של `nfb_licenses.seats`
  ירדה מ-3 ל-1. ⚠️ **רישיונות קיימים נשארו על 3** — שינוי ברירת מחדל אינו
  נוגע בשורות קיימות, והורדה גורפת הייתה נועלת מיד לקוחות שעובדים על יותר
  ממחשב אחד. הזיהוי הוא `machineFingerprint()` ולא כתובת IP: כתובת מתחלפת
  בכל אתחול ראוטר ומשותפת ב-CGNAT, כלומר הייתה נועלת לקוחות משלמים בלי
  לעצור תוקף. הכתובת כן נשמרת ב-`nfb_license_seats.last_ip` — **לזיהוי
  בפורטל בלבד**. ניהול המחשבים והמכסה נעשה בטאב «רישיונות» בפורטל.
- **אימות מקוון + ביטול מרחוק** (מ-1.60.0): Edge Function `validate-license`
  ב-Supabase מחזירה תשובה חתומה Ed25519 (מאומתת מול המפתח הציבורי המוטמע,
  עם nonce נגד replay). `revalidateOnline()` ב-`license.ts` רץ בעלייה + כל 6ש',
  מעדכן עוגן זמן אמין ומצב ביטול (`license-online`, HMAC, קשור למזהה). חלון
  חסד 30 יום; מעבר לזה → `needs_revalidation` (מסך «בדוק שוב» ב-LicenseGate).
  URL+anon מוטמעים (לא סוד); המפתח הפרטי לחתימה רק ב-Secrets של Supabase.
- **bytecode**: `bytecodePlugin` מקמפל את ה-main בהתקנה (כבוי בפיתוח).
- **Electron Fuses** (מ-1.57.0, `build.electronFuses`): ‏runAsNode/NODE_OPTIONS/inspect
  חסומים, אימות שלמות asar — עריכת קוד האפליקציה מונעת עלייה. DevTools כבויים בארוז.
  ⚠️ לא להפעיל `grantFileProtocolExtraPrivileges: false` — שובר את טעינת ה-renderer.
  ⚠️ **נעילת ה-inspector חוסמת את Playwright מלנהוג את הגרסה הארוזה.** אימות ויזואלי
  על החבילה הבנויה: הרצה ישירה + `PrintWindow` דרך PowerShell. פיתוח לא הושפע.
  אימות שלמות ה-asar הוא ברמת קובץ ובעצלתיים — נאכף כשהקובץ נקרא בפועל.
- **פרומפט המערכת**: `prompts/system.md` הוא מקור האמת; `scripts/embed-prompt.cjs`
  מטמיע אותו ב-bundle לפני כל build, והוא לא נשלח כקובץ בהתקנה.
- **פורטל רישיונות** (`license-portal/`): אתר סטטי + Supabase (`ilsidpixxkfwowsnkntg`)
  להנפקת מפתחות וניהול לקוחות. חשבון מנהל יחיד (ההרשמה נחסמת אחרי הראשון),
  חתימה ב-Edge Function עם הסוד `LICENSE_PRIVATE_KEY`. הוראות: `license-portal/README.md`.
- מדריך תפעולי מלא: `RELEASE.md`.

## משאבים שאינם בגיט (חובה לפני build)

- `resources/runtime/` — Node v22.14.0 + npm פורטבילי (~98MB)
- `resources/playwright/` — Chromium headless shell (~270MB), מועתק מ-`ms-playwright`
- `secrets/` — מפתח חתימת הרישיונות

## מוסכמות לעבודה על הפרויקט

- כל שינוי מינימלי
- אסור להרחיב היקף מעבר למה שביקשו
- **🔴 חובה: כל פעולה או שינוי מתועדים ב-`CHANGELOG.md`.** בלי יוצא מן
  הכלל — קוד, הגדרות, תשתית, פריסות, סקריפטים, תיעוד ואתר. אין «שינוי
  קטן מדי». אין git בפרויקט, ולכן זה הזיכרון היחיד של מה נעשה ולמה.
  התיעוד נעשה **בסוף כל שינוי**, ולפני «סיימתי» בודקים אילו קבצים השתנו
  מאז הערך האחרון — כי כבר קרה שנכתב ערך, העבודה נמשכה, והתוספת לא נרשמה.
  כל ערך אומר מה השתנה, **למה**, ואיך אומת.
- **🔴 אין לחשוף פגמים או סודות של המערכת למשתמשים.** ‏`CHANGELOG.md` פנימי
  ומפורט; מה שמגיע ללקוח (פופ-אפ «מה חדש», ממשק, הודעות שגיאה, האתר) עובר
  דרך `src/shared/release_notes.ts` ו-`src/shared/help.ts` בלבד ומנוסח
  בלשון תועלת. אסור לתאר
  פרצה שנסגרה, נתיבי קבצים, ערוצי IPC, כתובות שרת או מגבלות ידועות —
  תיאור של תיקון אבטחה מלמד תוקף מה לחפש בגרסאות ישנות שעדיין מותקנות.
  הכלל המלא בראש `CHANGELOG.md`, ונאכף ב-`tests/update_gate.test.ts`
  וב-`tests/help_content.test.ts`.

## עדכוני גרסה

- `build.publish` מצביע ל-`https://nf-blaze.dev/download` (אחסון סטטי).
- **עדכון חובה:** `src/main/services/app_updates.ts` קורא `version.json`
  מהאחסון ומחליט לפי `decideUpdate` (`src/shared/version.ts`).
  ‏`mandatory: true` היא ברירת המחדל — כל גרסה חדשה חוסמת עד להתקנה.
  ‏`minVersion` גובר עליה ומאפשר חיוב חלקי; שינוי הקובץ על השרת ל-`false`
  משחרר חסימה של גרסה תקולה בלי גרסה מתקנת.
- ⚠️ **בטוח-כשל לכיוון הפתוח:** מניפסט חסר/פגום/לא נגיש **לא** נועל את
  המשתמש. תקלת אחסון היא בעיה שלנו, לא של הלקוח. חסימה קורית רק על תשובה
  תקינה שאומרת במפורש שהגרסה לא נתמכת. ההפך מהתנהגות הרישוי (fail-closed).
- האכיפה היא בשומר ה-IPC (`UPDATE_FREE_CHANNELS` ב-`src/main/index.ts`) —
  שער ה-renderer הוא UX בלבד. אחרי שני כשלונות הורדה מוצעת הורדה ידנית,
  כדי שלקוח לא יישאר תקוע.
- פרסום: `npm run release` (או `release:optional`) → מייצר
  `release/upload/` עם exe + blockmap + latest.yml + version.json + .htaccess.
  **מעלים את `latest.yml` ו-`version.json` אחרונים**, אחרת לקוח מקבל הודעה
  על גרסה שהקובץ שלה עוד לא באוויר.
