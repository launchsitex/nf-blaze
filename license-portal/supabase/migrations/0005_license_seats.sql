-- ספירת מושבים לרישיון NF-Blaze.
--
-- הבעיה שזה סוגר: עד כה מפתח רישיון היה למעשה «כרטיס נושא» — האפליקציה
-- קשרה אותו למחשב **מקומית בלבד** (קובץ license-fingerprint), והשרת לא ראה
-- את טביעת האצבע ולא ספר הפעלות. כלומר לקוח יכול היה להעביר מחרוזת אחת
-- לעשרות אנשים, כולם היו מפעילים בהצלחה, ואנחנו לא היינו יודעים.
--
-- מכאן ואילך `validate-license` רושם כל מכונה כמושב ואוכף מכסה.

-- מכסת מושבים לרישיון. ברירת המחדל 3 — מחשב עבודה, נייד, וגיבוי; מספיק
-- ללקוח אמיתי וצר מדי לשיתוף. null = ללא הגבלה (רישיון אתר/פנימי).
alter table public.nfb_licenses
  add column if not exists seats integer not null default 3;

comment on column public.nfb_licenses.seats is
  'מספר המחשבים המרבי שהמפתח יכול לפעול בהם בו-זמנית. שינוי לערך גבוה = רישיון אתר.';

create table if not exists public.nfb_license_seats (
  id           uuid primary key default gen_random_uuid(),
  -- payload.id של המפתח. לא מפתח זר ל-nfb_licenses.id כדי שרישום מושב
  -- לא יישבר אם רשומת הרישיון נמחקת ידנית; האכיפה נעשית בפונקציה.
  license_id   text not null,
  -- machineFingerprint() מהאפליקציה: sha256(hostname|user|platform|arch) חתוך ל-32
  fingerprint  text not null,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  -- לזיהוי המכונה בפורטל כשצריך לשחרר מושב ידנית
  hostname_hint text,
  unique (license_id, fingerprint)
);

comment on table public.nfb_license_seats is
  'מכונות שבהן מפתח רישיון פעיל. מושב נתפס באימות המקוון הראשון של אותה מכונה.';

create index if not exists nfb_license_seats_license_idx
  on public.nfb_license_seats (license_id, last_seen desc);

alter table public.nfb_license_seats enable row level security;

-- קריאה למנהל המחובר (כדי לראות ולשחרר מושבים בפורטל); מחיקה למנהל.
-- הכנסה/עדכון נעשים אך ורק ב-service_role — כלומר מתוך ה-Edge Function.
-- בלי זה לקוח היה יכול לרשום לעצמו מושבים מהדפדפן עם המפתח הציבורי.
drop policy if exists nfb_license_seats_select_authenticated on public.nfb_license_seats;
create policy nfb_license_seats_select_authenticated
  on public.nfb_license_seats
  for select
  to authenticated
  using (true);

drop policy if exists nfb_license_seats_delete_authenticated on public.nfb_license_seats;
create policy nfb_license_seats_delete_authenticated
  on public.nfb_license_seats
  for delete
  to authenticated
  using (true);

-- מושב נתפס אטומית: או שהמכונה כבר רשומה (מעדכנים last_seen), או שיש מקום
-- פנוי (מכניסים), או שהמכסה מלאה (דוחים). הכל בטרנזקציה אחת כדי ששתי
-- בקשות במקביל לא יעברו יחד את הבדיקה ויחרגו מהמכסה.
create or replace function public.nfb_claim_seat(
  p_license_id  text,
  p_fingerprint text,
  p_hostname    text default null
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
         hostname_hint = coalesce(p_hostname, hostname_hint)
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
    insert into public.nfb_license_seats (license_id, fingerprint, hostname_hint)
         values (p_license_id, p_fingerprint, p_hostname)
    on conflict (license_id, fingerprint) do update set last_seen = now();
    return query select true, (v_used + 1)::integer, coalesce(v_max, 0);
    return;
  end if;

  return query select false, v_used::integer, coalesce(v_max, 0);
end;
$$;

comment on function public.nfb_claim_seat is
  'תופס/מרענן מושב למכונה. אטומי (for update) כדי ששתי בקשות מקבילות לא יחרגו מהמכסה.';

revoke all on function public.nfb_claim_seat(text, text, text) from public, anon, authenticated;
