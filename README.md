# NF-Blaze

סביבת פיתוח עם AI שרצה מקומית — בונה מערכות, אתרים ו-CRM בעברית, והקוד נשאר על המחשב שלך.

## מה כלול

- ממשק **עברית מלאה RTL**
- חיבור מפתחות API ל-**OpenAI / Anthropic (Claude) / Google Gemini / OpenRouter**
- **מודלים מקומיים** דרך Ollama / LM Studio — חינם, בלי מפתח
- בחירת מודל ספציפי (מעודכן ל-24/07/2026)
- **גישה לרשת לסוכן** — חיפוש וקריאת עמודים (web_search / web_fetch)
- כל פרויקט מקושר ל**תיקייה במחשב** — ייבוא פרויקט Node קיים או **שכפול ישיר מ-GitHub**
- **היסטוריית גרסאות** — שחזור הפרויקט לכל נקודה קודמת
- **«בסיס ירוק»** — אחרי כל סבב נבדק שמה שעבד עדיין עובד, ומדווח אם נשבר משהו
- **מטמון פרומפט** בשלושת הספקים — מפחית משמעותית את עלות ה-API
- **אכיפת מערכת עיצוב ו-RTL** בזמן כתיבה, לא בדיעבד
- צ׳אט AI שכותב קבצים לתיקיית הפרויקט
- תצוגה מקדימה של HTML + עץ קבצים
- מפתחות מוצפנים עם Electron `safeStorage`
- **ללא DB בענן** — הכל נשמר מקומית

## הרצה בפיתוח

```bash
npm install
npm run dev
```

## בדיקות, טיפוסים ולינט

```bash
npm run typecheck   # בדיקת טיפוסי TypeScript (main + renderer)
npm test            # כל סוויטות ה-Vitest (core + agent/tools + agent/index + providers)
npm run lint        # ESLint
npm run format:check  # בדיקת פורמט Prettier (npm run format כדי לתקן)
```

## רישוי

המערכת דורשת מפתח רישיון (14 יום ניסיון מההתקנה). הנפקת מפתח ללקוח:

```bash
npm run license:issue -- --name "שם הלקוח" --days 90
```

המפתח הפרטי נמצא ב-`secrets/` ואינו נכנס לגיט — **יש לגבות אותו**.
פרטים מלאים: [RELEASE.md](RELEASE.md).

## בניית מתקין Windows (EXE)

```bash
npm run dist
```

הקובץ ייווצר בתיקייה `release/` בשם `NF-Blaze-Setup-<version>.exe` (הגרסה נלקחת אוטומטית מ-`package.json`).

## חיבורים

### GitHub
1. צור [Fine-grained PAT](https://github.com/settings/tokens?type=beta) עם הרשאות Contents + Metadata
2. בהגדרות NF-Blaze או בכפתור החיבורים בפרויקט — הדבק את הטוקן (נשמר מוצפן)
3. צור ריפו חדש או קשר ריפו קיים, ואז **Push ל-GitHub**

### Supabase
1. מ-Dashboard → Settings → API: העתק Project URL + anon/publishable key
2. בפרויקט → חיבורים → Supabase → חבר וכתוב `.env`
3. `service_role` אופציונלי — נשמר רק ב-`.env.local` (לא בקליינט)
4. הסוכן מקבל הקשר על החיבור ומשתמש ב-RLS + `@supabase/supabase-js`
5. שתי התבניות (אתר ונתונים) מגיעות עם לקוח מוכן ב-`src/lib/supabase.ts` — auth, CRUD, Realtime ו-Storage עובדים מיד

### MCP servers
הסוכן תומך בשרתי [MCP](https://modelcontextprotocol.io) — אותו פורמט כמו Claude Desktop:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..." }
    }
  }
}
```

- **גלובלי:** `mcp.json` בתיקיית הנתונים של האפליקציה (`nf-blaze-data/mcp.json`)
- **פר-פרויקט:** `.nf-blaze/mcp.json` בתיקיית הפרויקט (גובר על הגלובלי)

כל כלי משרת מחובר נחשף לסוכן בשם `mcp_<שרת>_<כלי>`.
