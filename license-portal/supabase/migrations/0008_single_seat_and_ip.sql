-- רישיון = מחשב אחד, וזיהוי המחשב בפורטל.
--
-- נתי ביקש (02.08.2026): «ברגע שמשתמש שם אצלו רישיון, המערכת צריכה לצרוב
-- אותו, ואם הוא יעביר את הרישיון למחשב אחר — שיקבל שגיאה שהרישיון כבר שומש».
--
-- ⚠️ **המזהה הוא טביעת אצבע של המכונה, לא כתובת IP.** כתובת IP מתחלפת
-- בכל אתחול ראוטר, בכל מעבר בין רשתות (בית/משרד/בית קפה), ומשותפת לכמה
-- לקוחות ב-CGNAT — כלומר היא הייתה נועלת לקוחות משלמים כל כמה ימים בלי
-- לעצור תוקף אמיתי. `machineFingerprint()` יציב ולא תלוי ברשת, והוא כבר
-- נצרב ב-`nfb_license_seats` מאז 1.65.0. כאן רק מכוונים את המכסה ל-1.
--
-- הכתובת **כן** נשמרת — אבל כמידע לזיהוי בפורטל («איזה מחשב זה?»), ולא
-- כמפתח אכיפה.

-- 1) רישיון חדש = מחשב אחד
alter table public.nfb_licenses
  alter column seats set default 1;

comment on column public.nfb_licenses.seats is
  'מספר המחשבים המרבי שהמפתח יכול לפעול בהם בו-זמנית. ברירת מחדל 1 מ-1.66.0. שינוי לערך גבוה = רישיון לכמה עמדות.';

-- ⚠️ **רישיונות קיימים נשארים על הערך שלהם (3).** שינוי ברירת המחדל אינו
-- נוגע בשורות קיימות, וזה מכוון: הורדה גורפת ל-1 הייתה נועלת מיד כל לקוח
-- שכרגע עובד על יותר ממחשב אחד. לצמצום ידני של לקוח מסוים — דרך הפורטל,
-- או:  update public.nfb_licenses set seats = 1 where license_id = '<id>';

-- 2) זיהוי המחשב בפורטל
alter table public.nfb_license_seats
  add column if not exists last_ip text;

comment on column public.nfb_license_seats.last_ip is
  'כתובת ה-IP מהאימות האחרון. לזיהוי בלבד («איזה מחשב זה?») — אינה משמשת לאכיפה.';

-- 3) עדכון המושב מקבל גם כתובת. פרמטר חדש **בסוף ועם ברירת מחדל**, כדי
-- שגרסת אפליקציה ישנה שקוראת לפונקציה עם שלושה ארגומנטים תמשיך לעבוד:
-- ‏PostgREST מתאים קריאה עם 3 פרמטרים בשם לפונקציה בעלת 4 שהרביעי בה
-- ברירת מחדל.
--
-- ⚠️ **חובה למחוק את הגרסה בת 3 הארגומנטים קודם.** ‏`create or replace`
-- אינו יכול לשנות חתימה — הוא יוצר **עומס-יתר נוסף**, ואז כל `comment on
-- function` / `revoke` בלי רשימת ארגומנטים נכשל ב-
-- `42725: function name is not unique`.
drop function if exists public.nfb_claim_seat(text, text, text);

create or replace function public.nfb_claim_seat(
  p_license_id  text,
  p_fingerprint text,
  p_hostname    text default null,
  p_ip          text default null
)
returns table (allowed boolean, used integer, max_seats integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max  integer;
  v_used integer;
begin
  select seats into v_max
    from public.nfb_licenses
   where license_id = p_license_id
   for update;

  -- אין רשומה: לא מחליטים כאן. `ok` בפונקציה כבר יטפל בזה, ואנחנו לא רוצים
  -- שתקלת מנהל תיראה כחריגת מושבים.
  if not found then
    return query select true, 0, 0;
    return;
  end if;

  -- כבר רשומה: רק מרעננים. אין כאן שאלה של מכסה.
  update public.nfb_license_seats
     set last_seen = now(),
         hostname_hint = coalesce(p_hostname, hostname_hint),
         last_ip = coalesce(p_ip, last_ip)
   where license_id = p_license_id and fingerprint = p_fingerprint;

  if found then
    select count(*) into v_used
      from public.nfb_license_seats where license_id = p_license_id;
    return query select true, v_used::integer, coalesce(v_max, 0);
    return;
  end if;

  select count(*) into v_used
    from public.nfb_license_seats where license_id = p_license_id;

  -- v_max הוא not null בפועל; שמור על ההתנהגות «0 או שלילי = ללא הגבלה»
  if v_max is null or v_max <= 0 or v_used < v_max then
    insert into public.nfb_license_seats (license_id, fingerprint, hostname_hint, last_ip)
         values (p_license_id, p_fingerprint, p_hostname, p_ip)
    on conflict (license_id, fingerprint) do update
       set last_seen = now(),
           last_ip = coalesce(excluded.last_ip, nfb_license_seats.last_ip);
    return query select true, (v_used + 1)::integer, coalesce(v_max, 0);
    return;
  end if;

  return query select false, v_used::integer, coalesce(v_max, 0);
end;
$$;

-- רשימת הארגומנטים מפורשת — בלעדיה השורה נשברת אם תיווצר אי-פעם חתימה נוספת
comment on function public.nfb_claim_seat(text, text, text, text) is
  'תופס/מרענן מושב למכונה. אטומי (for update) כדי ששתי בקשות מקבילות לא יחרגו מהמכסה.';

revoke all on function public.nfb_claim_seat(text, text, text, text) from public, anon, authenticated;

-- 4) עריכת מכסה מהפורטל. הטבלה פתוחה ל-select בלבד למשתמש מחובר, ולכן
-- צריך policy ל-update — אבל **רק על העמודה `seats`**. אין דרך להגביל
-- עמודות ב-RLS, ולכן ההגבלה נעשית ב-GRANT ברמת העמודה.
drop policy if exists nfb_licenses_update_authenticated on public.nfb_licenses;
create policy nfb_licenses_update_authenticated
  on public.nfb_licenses
  for update
  to authenticated
  using (true)
  with check (true);

-- ברירת המחדל של PostgreSQL היא הרשאה על כל העמודות; כאן מצמצמים ל-seats
-- בלבד, כך שהמנהל לא יכול לשנות מהדפדפן תאריך תפוגה, שם או את המפתח עצמו.
revoke update on public.nfb_licenses from authenticated;
grant update (seats) on public.nfb_licenses to authenticated;
