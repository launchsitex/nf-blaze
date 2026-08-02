-- משוב ודיווחי תקלות ממשתמשי NF-Blaze
--
-- הפניות נכתבות על ידי Edge Function ב-service_role בלבד — לא מהדפדפן ולא
-- מהאפליקציה ישירות. הפונקציה מאמתת את חתימת מפתח הרישיון ומחלצת ממנו את
-- זהות השולח, ולכן `license_id` ו-`customer_name` הם קביעה של השרת ולא
-- הצהרה של הלקוח: אי אפשר לשלוח משוב בשם לקוח אחר.

create table if not exists public.nfb_user_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- מזהה הרישיון (payload.id של המפתח) — לקישור לשורה ב-nfb_licenses
  license_id text not null,
  -- שם בעל הרישיון בזמן השליחה. נשמר כתמונת מצב ולא כ-join, כדי שהפנייה
  -- תישאר קריאה גם אחרי שינוי שם או מחיקת הרישיון.
  customer_name text not null,
  -- אימייל שהמשתמש הזין לחזרה (לא חובה)
  email text,
  kind text not null check (kind in ('bug', 'feature', 'feedback', 'question')),
  title text not null,
  message text not null,
  -- גרסת האפליקציה ומערכת ההפעלה — לשחזור תקלה בלי לחזור ללקוח
  app_version text,
  os text,
  status text not null default 'new' check (status in ('new', 'in_progress', 'done')),
  handled_at timestamptz
);

comment on table public.nfb_user_feedback is
  'משוב ודיווחי תקלות מהאפליקציה. השיוך לבעל הרישיון נקבע בשרת מתוך המפתח החתום.';

alter table public.nfb_user_feedback enable row level security;

-- קריאה, עדכון סטטוס ומחיקה — רק למשתמש מחובר (חשבון המנהל היחיד של הפורטל)
drop policy if exists nfb_user_feedback_admin_read on public.nfb_user_feedback;
create policy nfb_user_feedback_admin_read
  on public.nfb_user_feedback for select
  to authenticated using (true);

drop policy if exists nfb_user_feedback_admin_update on public.nfb_user_feedback;
create policy nfb_user_feedback_admin_update
  on public.nfb_user_feedback for update
  to authenticated using (true) with check (true);

drop policy if exists nfb_user_feedback_admin_delete on public.nfb_user_feedback;
create policy nfb_user_feedback_admin_delete
  on public.nfb_user_feedback for delete
  to authenticated using (true);

-- אין policy ל-insert בכוונה: הכנסה אפשרית רק ב-service_role, שעוקף RLS.
-- כך אי אפשר להזריק פניות ישירות מהדפדפן עם המפתח הציבורי.
revoke insert on public.nfb_user_feedback from anon, authenticated;
grant delete on public.nfb_user_feedback to authenticated;

create index if not exists nfb_user_feedback_created_idx
  on public.nfb_user_feedback (created_at desc);
create index if not exists nfb_user_feedback_status_idx
  on public.nfb_user_feedback (status);
create index if not exists nfb_user_feedback_kind_idx
  on public.nfb_user_feedback (kind);
