-- One-time sign-up device check (explicit opt-in box on the sign-up form).
-- Rows are written only by the signup edge function (service role) and removed with the account.
create table if not exists public.signup_devices(
  user_id uuid primary key references auth.users(id) on delete cascade,
  device_hash text not null,
  fp_hash text,
  hw_hash text,
  ip_hash text,
  created_at timestamptz not null default now()
);
create unique index if not exists signup_devices_device_hash_key on public.signup_devices(device_hash);
create index if not exists signup_devices_ip_idx on public.signup_devices(ip_hash);
alter table public.signup_devices enable row level security;
revoke all on public.signup_devices from anon, authenticated;
