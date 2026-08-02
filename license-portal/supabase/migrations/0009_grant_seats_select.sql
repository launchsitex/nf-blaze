-- תיקון: הפורטל לא הצליח לטעון את רשימת הרישיונות.
--
-- ‏`permission denied for table nfb_licenses` בטאב «רישיונות».
--
-- **הסיבה:** מיגרציה `0003` שללה `select` ברמת הטבלה והעניקה **רשימת
-- עמודות מפורשת**, כדי ש-`license_key` לא ייחשף לדפדפן. העמודה `seats`
-- נוספה אחר כך ב-`0005` ומעולם לא נוספה לרשימה — כל עוד הפורטל לא ביקש
-- אותה זה לא הורגש. מ-1.66.1 הוא מציג מכסה ומאפשר לערוך אותה, ולכן
-- ה-select נכשל כולו.
--
-- ⚠️ **הלקח:** בטבלה עם הרשאות ברמת עמודה, כל עמודה חדשה חייבת grant מפורש.
-- שלילה ברמת הטבלה גוברת על ברירות המחדל של Supabase, ולכן `grant all on
-- all tables` לא מכסה כאן. אותו כלל חל על select ועל update כאחד.

grant select (seats) on public.nfb_licenses to authenticated;

-- הרשאות מפורשות על טבלת המושבים. הן קיימות בפועל דרך ברירות המחדל של
-- Supabase (הטבלה נוצרה בלי revoke), אבל עדיף מפורש מאשר תלוי בהגדרה
-- גלובלית שעלולה להשתנות — הפורטל צריך לקרוא ולשחרר מושבים.
grant select on public.nfb_license_seats to authenticated;
grant delete on public.nfb_license_seats to authenticated;

-- בדיקה עצמית: מה בפועל מוענק על nfb_licenses למשתמש מחובר.
-- צריך להופיע `seats` גם ב-SELECT וגם ב-UPDATE, ו-`license_key` בשום מקום.
--
--   select column_name, privilege_type
--     from information_schema.column_privileges
--    where table_name = 'nfb_licenses' and grantee = 'authenticated'
--    order by privilege_type, column_name;
