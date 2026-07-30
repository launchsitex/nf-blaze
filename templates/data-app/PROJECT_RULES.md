# חוקי פרויקט — אפליקציה עם נתונים (Vite + React + TS + Tailwind + shadcn + Supabase)

## ברירת מחדל: עברית ו-RTL
ברירת המחדל היא עברית ו-RTL.
השתמש ב-start/end ולא ב-left/right.
(למשל: `ms-4` / `me-4` / `ps-4` / `text-start` / `rounded-s` — לא `ml`/`mr`/`pl`/`text-left`).

## סטאק
- Vite + React 19 + TypeScript
- Tailwind CSS 3 + משתני עיצוב (CSS variables) בסגנון shadcn
- קומפוננטות UI תחת `src/components/ui`
- לקוח Supabase ב-`src/lib/supabase.ts` — משתני סביבה מ-`.env` / `.env.local`
- כניסה: `src/main.tsx` → `src/App.tsx`
- `index.html`: `lang="he"` ו-`dir="rtl"`

## קונבנציות שמות
- קומפוננטות: PascalCase (`OrdersTable.tsx`)
- hooks / שירותים: camelCase (`useOrders.ts`, `ordersApi.ts`)
- טבלאות/עמודות DB: snake_case כמקובל ב-Postgres
- תיקיות: לפי תחום (`features/`, `components/ui`)

## ספריית קומפוננטות מותרת
- **מותר:** `src/components/ui/*`, `lucide-react`, `@supabase/supabase-js`
- **אסור:** להחליף UI stack או ORM בלי בקשה מפורשת
- כל גישה לנתונים דרך הלקוח ב-`src/lib/supabase.ts` (או שכבת API שעוטפת אותו)

## חוקי עיצוב — רמה עולמית, לא גנרית
- **כיוון עיצובי ייחודי לכל פרויקט** שמתאים לעסק — אסור מראה AI גנרי (סגול זוהר, כרטיסים זהים)
- **תוכן אמיתי בעברית** ונתוני דוגמה ריאליים — לעולם לא lorem ipsum או «תכונה 1/2/3»
- טיפוגרפיה עברית (Heebo), היררכיה ברורה, ריווח בכפולות 4/8px
- מצבי loading / empty / error בכל מסך נתונים; ולידציה עם הודעות בעברית
- hover + focus לכל אלמנט אינטראקטיבי; מעברים 150-250ms
- רספונסיבי (375px עד דסקטופ); צבעים דרך משתני CSS ב-`src/index.css`
- נגישות: ניגודיות קריאה, label לכל input, כותרות סמנטיות

## Supabase ואבטחה
- רק `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` בקליינט
- לעולם אל תשים `service_role` בקוד קליינט
- הפעל RLS על כל טבלה ב-public
- סודות רק ב-`.env.local` — לא ב-git

## קבצי קונפיג מוגנים
אסור לשנות בלי בקשה מפורשת מהמשתמש:
`vite.config.ts`, `tsconfig*.json`, `tailwind.config.cjs`, `postcss.config.cjs`, `components.json`, `eslint.config.*`, `plugins/nf-blaze-source/**`
שנה קוד אפליקציה תחת `src/` — לא את תשתית הבנייה.
