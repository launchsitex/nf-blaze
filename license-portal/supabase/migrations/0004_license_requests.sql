-- בקשות רישיון מהטופס ב-nf-blaze.dev
--
-- הבקשות נכתבות על ידי Edge Function ב-service_role בלבד — לא מהדפדפן.
-- המנהל המחובר לפורטל קורא ומעדכן סטטוס; אנונימי לא רואה כלום.

create table if not exists public.nfb_license_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  full_name text not null,
  email text not null,
  -- איך המבקש הגיע אלינו — לצורכי שיווק
  source text not null check (source in ('facebook', 'google', 'referral', 'other')),
  message text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_at timestamptz
);

alter table public.nfb_license_requests enable row level security;

-- קריאה ועדכון רק למשתמש מחובר (חשבון המנהל היחיד של הפורטל)
drop policy if exists nfb_license_requests_admin_read on public.nfb_license_requests;
create policy nfb_license_requests_admin_read
  on public.nfb_license_requests for select
  to authenticated using (true);

drop policy if exists nfb_license_requests_admin_update on public.nfb_license_requests;
create policy nfb_license_requests_admin_update
  on public.nfb_license_requests for update
  to authenticated using (true) with check (true);

-- אין policy ל-insert בכוונה: הכנסה אפשרית רק ב-service_role, שעוקף RLS.
-- כך אי אפשר להזריק בקשות ישירות מהדפדפן עם המפתח הציבורי.
revoke insert, delete on public.nfb_license_requests from anon, authenticated;

create index if not exists nfb_license_requests_created_idx
  on public.nfb_license_requests (created_at desc);
create index if not exists nfb_license_requests_status_idx
  on public.nfb_license_requests (status);

-- מחיקת בקשה — למנהל המחובר בלבד. בלי זה תיבת הבקשות מתמלאת בספאם
-- ואין דרך לנקות אותה.
drop policy if exists nfb_license_requests_admin_delete on public.nfb_license_requests;
create policy nfb_license_requests_admin_delete
  on public.nfb_license_requests for delete
  to authenticated using (true);

grant delete on public.nfb_license_requests to authenticated;
