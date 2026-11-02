-- Planner update 2: project emojis and colours, progress history for graphs,
-- and the word counter linked to a project.
-- Paste into Supabase > SQL Editor > New query, then press Run. Safe to run more than once.

alter table public.projects add column if not exists emoji text not null default '';
alter table public.projects add column if not exists color text not null default '';

-- A project can now measure its progress with the word counter.
alter table public.projects drop constraint if exists projects_progress_type_check;
alter table public.projects add constraint projects_progress_type_check
  check (progress_type in ('tasks', 'subgoals', 'number', 'percent', 'words'));

-- Every time a number or percentage is updated, the value is kept here for the progress graph.
create table if not exists public.progress_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  project_id uuid not null references public.projects on delete cascade,
  day date not null,
  value numeric not null,
  sort_order double precision not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists progress_log_project on public.progress_log (project_id, day);

-- Word counter settings: the monthly plan, days that never break the streak, and the start of the plan.
alter table public.wc_settings add column if not exists plan jsonb;
alter table public.wc_settings add column if not exists off_days integer[] not null default '{0,3,6}';
alter table public.wc_settings add column if not exists start_date date;

alter table public.progress_log enable row level security;
drop policy if exists "own rows" on public.progress_log;
create policy "own rows" on public.progress_log for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.progress_log to authenticated;
revoke all on public.progress_log from anon;
