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
- תוכנית בנייה בשלבים (`update_plan` → `.nf-blaze/plan.json`)

### ישנה (fallback בלבד)

`src/main/services/ai/` — פורמט `nfblaze` JSON. נבחרת רק ידנית בהגדרות (`agentEngine: 'legacy'`).

### החלטה

הישנה תוסר בגרסה עתידית אחרי תקופת יציבות של החדשה.

## sandbox/

קוד E2B, לא בשימוש בתוכנה המקומית. מיועד למחיקה.

## גרסאות

- `package.json` — `1.45.0`
- `CHANGELOG.md` — `1.45.0`

## רישוי והגנת קוד

- **רישיון קנייני** (`UNLICENSED`) — לא MIT. התקנון ב-`build/license_he.txt`.
- **מפתחות רישיון**: Ed25519 חתום, אימות אופליין. הנפקה: `npm run license:issue`.
  המפתח הפרטי ב-`secrets/` — **מחוץ לגיט, חייב גיבוי**.
- **bytecode**: `bytecodePlugin` מקמפל את ה-main בהתקנה (כבוי בפיתוח).
- **פרומפט המערכת**: `prompts/system.md` הוא מקור האמת; `scripts/embed-prompt.cjs`
  מטמיע אותו ב-bundle לפני כל build, והוא לא נשלח כקובץ בהתקנה.
- מדריך תפעולי מלא: `RELEASE.md`.

## מוסכמות לעבודה על הפרויקט

- כל שינוי מינימלי
- אסור להרחיב היקף מעבר למה שביקשו
- אחרי כל שינוי לעדכן `CHANGELOG.md`
