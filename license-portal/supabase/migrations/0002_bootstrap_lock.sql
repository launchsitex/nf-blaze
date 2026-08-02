-- 1. נעילת הרשמה קבועה
--
-- קודם הנעילה נגזרה מקיום משתמש ב-auth.users, ולכן מחיקת המשתמש פתחה את
-- ההרשמה מחדש. הדגל כאן נדלק פעם אחת בהרשמה הראשונה ולא מתאפס מעצמו לעולם.

create table if not exists public.nfb_portal_state (
  -- טבלת שורה יחידה: ה-check מונע יצירת שורה שנייה
  id                 boolean primary key default true check (id),
  admin_bootstrapped boolean not null default false,
  bootstrapped_at    timestamptz
);

insert into public.nfb_portal_state (id) values (true) on conflict (id) do nothing;

comment on table public.nfb_portal_state is
  'מצב הפורטל. admin_bootstrapped ננעל בהרשמה הראשונה ואינו מתאפס. '
  'לפתיחת הרשמה מחדש (למשל אם חשבון המנהל אבד): '
  'update public.nfb_portal_state set admin_bootstrapped = false;';

-- אין מדיניות כלל — רק service_role (ב-Edge Function) ניגש לטבלה הזו
alter table public.nfb_portal_state enable row level security;

-- אם כבר קיים מנהל בפועל, נועלים מיד כדי לא לפתוח חלון הרשמה
update public.nfb_portal_state
set admin_bootstrapped = true,
    bootstrapped_at    = now()
where admin_bootstrapped = false
  and exists (select 1 from auth.users);

-- 2. מפתח הרישיון מוצג פעם אחת בלבד — ברגע ההנפקה
--
-- הדפדפן לא אמור לקבל את license_key בשליפות הרשימה. שלילת ההרשאה ברמת
-- העמודה אוכפת את זה בשרת, לא רק בממשק: גם שאילתה ידנית עם הטוקן של המנהל
-- תיכשל אם תבקש את העמודה.
revoke select (license_key) on public.nfb_licenses from authenticated;
revoke select (license_key) on public.nfb_licenses from anon;
