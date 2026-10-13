create table if not exists public.email_verified(user_id uuid primary key references auth.users(id) on delete cascade, verified_at timestamptz not null default now());
create table if not exists public.email_verifications(id bigserial primary key, user_id uuid not null references auth.users(id) on delete cascade, token_hash text not null unique, expires_at timestamptz not null, created_at timestamptz not null default now());
alter table public.email_verified enable row level security;
alter table public.email_verifications enable row level security;
drop policy if exists own_verified_read on public.email_verified;
create policy own_verified_read on public.email_verified for select to authenticated using (user_id = auth.uid());
revoke all on public.email_verifications from anon, authenticated;
revoke insert, update, delete on public.email_verified from anon, authenticated;
