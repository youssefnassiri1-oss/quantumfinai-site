-- Refused sign-up attempts: reason code, time, hashed IP and hashed device ID only. Service role only; purged after 90 days.
create table if not exists public.signup_refusals(
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  reason text not null,
  http_status int,
  detail text,
  ip_hash text,
  device_hash text
);
create index if not exists signup_refusals_created_idx on public.signup_refusals(created_at);
alter table public.signup_refusals enable row level security;
revoke all on public.signup_refusals from anon, authenticated;
grant select, insert, delete on public.signup_refusals to service_role;

-- privacy_retention_cleanup() also runs: delete from signup_refusals where created_at<now()-interval '90 days';
