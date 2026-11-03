-- Planner update 3: a place for your own settings, such as your usual working hours.
-- Paste into Supabase > SQL Editor > New query, then press Run. Safe to run more than once.

create table if not exists public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;
drop policy if exists "own rows" on public.user_settings;
create policy "own rows" on public.user_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.user_settings to authenticated;
revoke all on public.user_settings from anon;
