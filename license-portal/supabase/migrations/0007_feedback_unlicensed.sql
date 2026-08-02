-- משוב גם ממי שאין לו רישיון + מגבלת קצב לפי IP.
--
-- הרקע: מי שתקוע בשער הרישיון (פג תוקף, חריגת מושבים, אין מפתח) לא יכול
-- לפנות אלינו בשום דרך מתוך המערכת — כלומר דווקא במצב שבו הוא הכי צריך
-- אותנו. מכאן ואילך אפשר לשלוח גם בלי מפתח, במחיר שתי הגנות:
--
--   1. **הפנייה מסומנת `verified = false`** — השם והאימייל בה מוצהרים על
--      ידי השולח ולא נגזרו ממפתח חתום. בפורטל היא מוצגת עם תגית «לא
--      מאומתת», כדי שלא תיראה זהה לפנייה של לקוח אמיתי. בלי ההפרדה הזו
--      כל אחד היה יכול לכתוב שם של לקוח קיים והמסך היה נראה אותו דבר.
--   2. **מגבלת קצב לפי IP** — פנייה אחת לכל 3 שעות, נשמרת במסד ולא
--      בזיכרון של האינסטנס. מגבלה בזיכרון לא שורדת מיחזור אינסטנס, ולכן
--      לחלון של 3 שעות היא חסרת ערך.

-- 1) סוג פנייה חדש: בקשת/חידוש רישיון
alter table public.nfb_user_feedback
  drop constraint if exists nfb_user_feedback_kind_check;

alter table public.nfb_user_feedback
  add constraint nfb_user_feedback_kind_check
  check (kind in ('bug', 'feature', 'feedback', 'question', 'license'));

-- 2) פנייה בלי רישיון: אין license_id, והזהות מוצהרת ולא מאומתת
alter table public.nfb_user_feedback
  alter column license_id drop not null;

alter table public.nfb_user_feedback
  add column if not exists verified boolean not null default false;

comment on column public.nfb_user_feedback.verified is
  'true = הזהות נגזרה ממפתח רישיון חתום. false = השולח הצהיר על שמו בעצמו — אין להסתמך עליו.';

-- רשומות שנוצרו לפני המיגרציה הגיעו כולן עם מפתח מאומת
update public.nfb_user_feedback
   set verified = true
 where license_id is not null;

create index if not exists nfb_user_feedback_verified_idx
  on public.nfb_user_feedback (verified);

-- 3) מגבלת קצב מתמשכת לפי IP
--
-- נשמר **גיבוב** של הכתובת ולא הכתובת עצמה: למגבלת קצב מספיק מזהה יציב,
-- ואין סיבה להחזיק כתובות IP של פונים במסד.
create table if not exists public.nfb_feedback_throttle (
  ip_hash text primary key,
  last_at timestamptz not null default now(),
  -- כמה פניות התקבלו מהכתובת הזו — לזיהוי ניצול לרעה
  hits integer not null default 1
);

comment on table public.nfb_feedback_throttle is
  'מגבלת קצב לשליחת משוב, לפי גיבוב כתובת IP. נכתב רק ב-service_role מתוך submit-feedback.';

alter table public.nfb_feedback_throttle enable row level security;

-- קריאה למנהל המחובר בלבד (לאבחון ניצול לרעה). כתיבה — service_role בלבד.
drop policy if exists nfb_feedback_throttle_admin_read on public.nfb_feedback_throttle;
create policy nfb_feedback_throttle_admin_read
  on public.nfb_feedback_throttle for select
  to authenticated using (true);

revoke insert, update, delete on public.nfb_feedback_throttle from anon, authenticated;

create index if not exists nfb_feedback_throttle_last_idx
  on public.nfb_feedback_throttle (last_at desc);

-- בדיקה **אטומית** של המגבלה: ה-INSERT תופס נעילה על המפתח, וה-DO UPDATE
-- מתבצע רק אם החלון עבר. שתי בקשות מקבילות מאותה כתובת יסתדרו בתור, והשנייה
-- לא תקבל שורה חזרה — כלומר תיחסם. גרסה עם SELECT ואז INSERT הייתה מאפשרת
-- לשתיהן לעבור.
create or replace function public.nfb_feedback_throttle_check(
  p_ip_hash         text,
  p_window_seconds  integer default 10800
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed boolean;
begin
  if p_ip_hash is null or length(p_ip_hash) = 0 then
    -- אין כתובת לזהות לפיה — לא חוסמים. תקלת רשת/פרוקסי היא הבעיה שלנו,
    -- והשכבות האחרות (אימות קלט, אורכים, חובת אימייל) עדיין בתוקף.
    return true;
  end if;

  insert into public.nfb_feedback_throttle as t (ip_hash, last_at, hits)
       values (p_ip_hash, now(), 1)
  on conflict (ip_hash) do update
          set last_at = now(),
              hits    = t.hits + 1
        where t.last_at <= now() - make_interval(secs => p_window_seconds)
    returning true into v_allowed;

  return coalesce(v_allowed, false);
end;
$$;

comment on function public.nfb_feedback_throttle_check is
  'מחזיר true אם מותר לשלוח משוב מהכתובת הזו כרגע, ומסמן את הזמן. אטומי.';

revoke all on function public.nfb_feedback_throttle_check(text, integer)
  from public, anon, authenticated;
