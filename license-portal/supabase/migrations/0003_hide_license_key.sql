-- הסתרת license_key מהדפדפן — אכיפה אמיתית ברמת המסד.
--
-- ב-0002 נוסתה שלילה ברמת העמודה בלבד, וזו לא השפיעה: הרשאת SELECT ברמת
-- הטבלה מכסה את כל העמודות וגוברת עליה. הדרך הנכונה היא לשלול את ההרשאה
-- ברמת הטבלה ואז להעניק במפורש רק את העמודות המותרות.

revoke select on public.nfb_licenses from authenticated, anon;

grant select (
  id,
  license_id,
  customer_name,
  email,
  expires_at,
  created_at,
  created_by,
  revoked,
  revoked_at
) on public.nfb_licenses to authenticated;

-- מכאן ואילך `select=*` ייכשל ב-42501 גם עם הטוקן של המנהל, ובקשה מפורשת
-- של license_key תיכשל גם היא. המפתח נגיש רק ל-service_role — כלומר ל-Edge
-- Function ברגע ההנפקה, ולבעלים דרך ה-SQL Editor.
