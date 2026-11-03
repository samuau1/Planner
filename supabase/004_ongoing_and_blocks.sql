-- Planner update 4: ongoing tasks and project time blocks.
-- Paste into Supabase > SQL Editor > New query, then press Run. Safe to run more than once.

-- An ongoing task is ticked off "for today" and stays open for the next day.
alter table public.tasks add column if not exists ongoing boolean not null default false;

-- The days an ongoing task was worked on.
create table if not exists public.task_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  task_id uuid not null references public.tasks on delete cascade,
  day date not null,
  sort_order double precision not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists task_sessions_task on public.task_sessions (task_id, day);

-- Time on the day for a whole project, without naming a task.
create table if not exists public.time_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  project_id uuid not null references public.projects on delete cascade,
  day date not null,
  start_time time,
  block_minutes integer not null default 60,
  done boolean not null default false,
  note text not null default '',
  sort_order double precision not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists time_blocks_day on public.time_blocks (user_id, day);

do $$
declare t text;
begin
  foreach t in array array['task_sessions', 'time_blocks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
