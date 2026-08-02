-- פורטל הרישיונות של NF-Blaze
-- מסד הנתונים שומר את הרישיונות שהונפקו. החתימה עצמה נעשית ב-Edge Function
-- עם המפתח הפרטי, שלעולם אינו מגיע לדפדפן.

create table if not exists public.nfb_licenses (
  id            uuid primary key default gen_random_uuid(),
  -- המזהה הקצר שנמצא בתוך המפתח עצמו (payload.id) — לקישור בין רשומה למפתח
  license_id    text not null unique,
  customer_name text not null,
  email         text,
  -- null = ללא הגבלת זמן
  expires_at    date,
  license_key   text not null,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users (id) on delete set null,
  -- שדות לשלב הבא (חסימת רישיון) — אין להם עדיין לוגיקה או ממשק
  revoked       boolean not null default false,
  revoked_at    timestamptz
);

comment on table public.nfb_licenses is
  'רישיונות NF-Blaze שהונפקו מהפורטל. המפתח הפרטי אינו נמצא כאן — רק התוצר החתום.';

create index if not exists nfb_licenses_created_at_idx
  on public.nfb_licenses (created_at desc);

alter table public.nfb_licenses enable row level security;

-- קריאה: רק משתמש מחובר (יש רק מנהל אחד). כתיבה נעשית ב-Edge Function
-- עם service_role, שעוקף RLS — כך שאי אפשר להזריק רשומות מהדפדפן.
drop policy if exists nfb_licenses_select_authenticated on public.nfb_licenses;
create policy nfb_licenses_select_authenticated
  on public.nfb_licenses
  for select
  to authenticated
  using (true);
