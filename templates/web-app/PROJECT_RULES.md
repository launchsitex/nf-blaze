# חוקי פרויקט — אתר / אפליקציה (Vite + React + TS + Tailwind + shadcn)

## ברירת מחדל: עברית ו-RTL
ברירת המחדל היא עברית ו-RTL.
השתמש ב-start/end ולא ב-left/right.
(למשל: `ms-4` / `me-4` / `ps-4` / `text-start` / `rounded-s` — לא `ml`/`mr`/`pl`/`text-left`).

## סטאק
- Vite + React 19 + TypeScript
- Tailwind CSS 3 + משתני עיצוב (CSS variables) בסגנון shadcn
- קומפוננטות UI תחת `src/components/ui` (shadcn-style)
- עזר `cn()` ב-`src/lib/utils.ts`
- כניסה: `src/main.tsx` → `src/App.tsx`
- `index.html`: `lang="he"` ו-`dir="rtl"`

## קונבנציות שמות
- קומפוננטות: PascalCase (`UserCard.tsx`)
- קבצי עזר / hooks: camelCase (`useUsers.ts`, `formatDate.ts`)
- תיקיות: kebab-case או לפי תחום (`components/ui`, `features/dashboard`)
- ייצוא: named exports לקומפוננטות UI; ברירת מחדל לקומפוננטת עמוד ראשית בלבד אם מקובל

## ספריית קומפוננטות מותרת
- **מותר:** `src/components/ui/*` (Button, Card, Input וכו'), `lucide-react` לאייקונים, הרחבות shadcn באותו סגנון
- **אסור:** להחליף את מערכת ה-UI בספרייה אחרת (MUI / Chakra / Ant) בלי בקשה מפורשת מהמשתמש
- העדף להרחיב קומפוננטה קיימת ב-`ui/` לפני יצירת סגנון מקביל

## חוקי עיצוב — רמה עולמית, לא גנרית
- **כיוון עיצובי ייחודי לכל פרויקט:** בחר פלטה, טיפוגרפיה ואופי פריסה שמתאימים לעסק הספציפי. אסור «מראה AI גנרי» (סגול זוהר, גרדיאנט סגול-ורוד, כרטיסים זהים בכל מקום)
- **תוכן אמיתי בעברית:** כותרות שמוכרות, תיאורים קונקרטיים לעסק, נתוני דוגמה ריאליים. לעולם לא lorem ipsum או «תכונה 1/2/3»
- טיפוגרפיה עברית (Heebo) — אל תחליף לגופן לטיני כברירת מחדל; סולם גדלים עקבי
- היררכיה ברורה: כותרת דומיננטית אחת, זרימה ויזואלית, ריווח בכפולות 4/8px, whitespace נדיב, רוחב תוכן מוגבל
- עומק וליטוש: צל/מסגרת עדינים, מצבי hover + focus לכל אלמנט אינטראקטיבי, מעברים 150-250ms
- ויזואליה בלי קבצים חיצוניים: גרדיאנטים, דוגמאות רקע ו-SVG inline — לא לינקים לתמונות שעלולים להישבר
- רספונסיבי כברירת מחדל: נראה נכון גם ב-375px וגם בדסקטופ
- צבעים דרך משתני CSS ב-`src/index.css` (`--background`, `--foreground`, `--primary`…)
- מצבי UI: loading / empty / error בכל רשימה או טבלה; ולידציה עם הודעות בעברית
- נגישות: ניגודיות קריאה, label לכל input, כותרות סמנטיות

## Supabase (אופציונלי)
- לקוח מוכן ב-`src/lib/supabase.ts` — פעיל רק כשמחברים Supabase (חיבורים ← Supabase) ונוצר `.env`
- בדוק `isSupabaseConfigured` לפני שימוש; אם לא מחובר — עבוד עם state מקומי
- רק `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` בקליינט; לעולם לא `service_role`
- הפעל RLS על כל טבלה ב-public

## קבצי קונפיג מוגנים
אסור לשנות בלי בקשה מפורשת מהמשתמש:
`vite.config.ts`, `tsconfig*.json`, `tailwind.config.cjs`, `postcss.config.cjs`, `components.json`, `eslint.config.*`, `plugins/nf-blaze-source/**`
שנה קוד אפליקציה תחת `src/` — לא את תשתית הבנייה.
