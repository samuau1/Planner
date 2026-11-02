-- Planner: database tables and privacy rules.
-- Paste this whole file into Supabase > SQL Editor > New query, then press Run.
-- It is safe to run once on an empty project.

-- Areas: broad parts of life that group projects (Research, Teaching, Personal).
create table public.areas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  sort_order double precision not null default 0,
  created_at timestamptz not null default now()
);

-- Projects and subgoals. A subgoal is a project with a parent_id.
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  area_id uuid references public.areas on delete set null,
  parent_id uuid references public.projects on delete cascade,
  name text not null,
  description text not null default '',
  notes text not null default '',
  status text not null default 'active' check (status in ('active', 'on_hold', 'done')),
  start_date date,
  deadline date,
  progress_type text not null default 'tasks' check (progress_type in ('tasks', 'subgoals', 'number', 'percent')),
  progress_value numeric not null default 0,
  progress_target numeric,
  progress_unit text not null default '',
  collapsed boolean not null default false,
  sort_order double precision not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Tasks. No project = Inbox.
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  project_id uuid references public.projects on delete cascade,
  title text not null,
  notes text not null default '',
  planned_date date,
  deadline date,
  estimate_minutes integer,
  priority boolean not null default false,
  repeat_rule text check (repeat_rule in ('daily', 'weekdays', 'weekly', 'monthly')),
  start_time time,
  block_minutes integer,
  done boolean not null default false,
  done_at timestamptz,
  sort_order double precision not null default 0,
  created_at timestamptz not null default now()
);

create table public.subtasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  task_id uuid not null references public.tasks on delete cascade,
  title text not null,
  done boolean not null default false,
  sort_order double precision not null default 0,
  created_at timestamptz not null default now()
);

-- Working days and hours, set month by month (used from stage 2).
create table public.working_days (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,
  start_time time,
  end_time time,
  primary key (user_id, day)
);

-- Dissertation word counter (used from stage 4).
create table public.wc_chapters (
  id text not null,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  ord integer not null default 0,
  words integer not null default 0,
  trim_to integer,
  trimmed boolean not null default false,
  primary key (user_id, id)
);

create table public.wc_entries (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,
  words integer not null default 0,
  chapters jsonb not null default '{}'::jsonb,
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

create table public.wc_settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  baseline integer not null default 0,
  goal integer not null default 90000
);

create index on public.tasks (user_id, planned_date);
create index on public.tasks (project_id);
create index on public.projects (parent_id);
create index on public.subtasks (task_id);

-- Privacy: every table only shows and accepts the signed-in person's own rows.
do $$
declare t text;
begin
  foreach t in array array['areas', 'projects', 'tasks', 'subtasks', 'working_days', 'wc_chapters', 'wc_entries', 'wc_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "own rows" on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
