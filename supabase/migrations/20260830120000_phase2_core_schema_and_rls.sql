-- Phase 2 — Database schema and Row Level Security
-- Daily Compass (see AGENTS.md "Cloud Sync (Supabase)" and SUPABASE_IMPLEMENTATION_PLAN.md, Phase 2)
--
-- PROPOSED MIGRATION — NOT EXECUTED.
-- This file is prepared for review only. Do not run it against the Supabase project until
-- it has been approved and Phase 2's manual cross-account verification is planned.
--
-- Scope: schema and Row Level Security only. No authentication, sync, or application code.
-- Uses only the schema owner's normal migration privileges — no service_role, no
-- SECURITY DEFINER functions, no permissive/public-access policies. Every table below holds
-- per-user data and is locked to its owning `auth.uid()`; anonymous (`anon`) access is
-- explicitly revoked in addition to being excluded by RLS.
--
-- Derived directly from src/types.ts (Task, Project, DailyNote) as of Phase 2 authoring:
--   TASK_STATUSES = ['Inbox','This Week','Today','In Progress','Waiting','Done']
--   PRIORITIES    = ['Low','Normal','High']
--   PROJECT_STATUSES = ['active','completed','archived']
--
-- Record ids: the app already generates stable string ids client-side via generateId()
-- (crypto.randomUUID() when available, otherwise a non-UUID `${timestamp}-${random}`
-- fallback string — see src/types.ts). `id` columns here are therefore `text`, not `uuid`,
-- so any existing locally-generated id can be preserved verbatim on import in a later phase.
--
-- Tenant isolation is enforced structurally, not only by RLS:
--   * Every table's primary key is the composite (user_id, id), not id alone. `id` is only
--     required to be unique *within* one user's rows — it is never a global namespace, so a
--     row identity can never collide with, or be confused for, another user's row of the
--     same id. RLS is still enabled and is the runtime access-control layer; the composite
--     key is what makes cross-tenant row identity structurally impossible in the first
--     place, independent of RLS or application code.
--   * tasks.project_id is enforced by a composite foreign key on (user_id, project_id)
--     referencing projects (user_id, id) — see "Cross-tenant references" below. A task can
--     only ever reference a project owned by that same task's user_id; the database rejects
--     any attempt to point a task at another user's project, regardless of what application
--     code sends.
--
-- Postgres version dependency: the tasks -> projects foreign key uses the column-specific
-- `ON DELETE SET NULL (project_id)` action list, which requires PostgreSQL 15 or later
-- (see "Cross-tenant references" below for why, and what to do if the target project turns
-- out to be older).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.projects (
  id text not null default gen_random_uuid()::text,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_pkey primary key (user_id, id)
);

comment on table public.projects is 'Daily Compass projects, one row per user-owned project. Primary key is (user_id, id): ids are unique per user, not globally.';

create table public.tasks (
  id text not null default gen_random_uuid()::text,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  notes text,
  status text not null check (
    status in ('Inbox', 'This Week', 'Today', 'In Progress', 'Waiting', 'Done')
  ),
  project_id text,
  priority text not null check (priority in ('Low', 'Normal', 'High')),
  due_date date,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  archived boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint tasks_pkey primary key (user_id, id),
  -- Cross-tenant references: a task's project (if any) must be owned by the same
  -- user_id as the task itself. Because the FK is on the pair (user_id, project_id) and
  -- references projects' composite primary key (user_id, id), Postgres can only satisfy
  -- it with a projects row that has that exact user_id — a task can never be pointed at
  -- another user's project, structurally, not just by RLS or application code.
  --
  -- Column-specific ON DELETE SET NULL (project_id) — PostgreSQL 15+ only — clears just
  -- project_id when the referenced project is deleted, leaving user_id (and the rest of
  -- the row) untouched, matching "deleting a project detaches its tasks rather than
  -- deleting them." A plain (pre-15) composite ON DELETE SET NULL would null out *all*
  -- FK columns, including user_id, which is not null on this table — that would make the
  -- delete fail outright (constraint violation) rather than detach cleanly, and is not an
  -- acceptable substitute. If the target Supabase project turns out to run PostgreSQL
  -- older than 15, this clause will fail to apply and the migration should not be run
  -- as-is; the safest fix at that point is to keep the composite FK (for the structural
  -- ownership guarantee) but drop its ON DELETE action, and instead detach tasks from a
  -- deleted project via a short, explicit application-level step (e.g. the deletion flow
  -- first sets project_id = null on that user's affected tasks, then deletes the
  -- project, both scoped to auth.uid() and covered by the existing RLS policies) rather
  -- than relying on a database-side cascade. That is an application-code change for a
  -- later phase, not something to add to this schema migration.
  constraint tasks_project_fk
    foreign key (user_id, project_id)
    references public.projects (user_id, id)
    on delete set null (project_id)
);

comment on table public.tasks is 'Daily Compass tasks, one row per user-owned task. Primary key is (user_id, id); project_id is constrained to a project owned by the same user_id.';

create table public.daily_notes (
  id text not null default gen_random_uuid()::text,
  user_id uuid not null references auth.users (id) on delete cascade,
  note_date date not null,
  morning_notes text not null default '',
  evening_notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_notes_pkey primary key (user_id, id),
  constraint daily_notes_user_date_unique unique (user_id, note_date)
);

comment on table public.daily_notes is 'Daily Compass morning/evening notes, one row per user per date. Primary key is (user_id, id); (user_id, note_date) stays unique so each user has at most one note row per date.';

-- ---------------------------------------------------------------------------
-- Indexes
--
-- The composite primary keys above already provide a leading-user_id index on each
-- table (user_id is the first column of every primary key), which covers ordinary
-- "this user's rows" lookups. The indexes below add the specific multi-column access
-- patterns the app needs beyond that:
--   * tasks by user + board status (Board/Today views)
--   * tasks by user + project (Projects view: "tasks belonging to a project"), which is
--     also the natural index for the referencing side of tasks_project_fk
-- daily_notes_user_date_unique above already covers user_id + note_date lookups, so no
-- extra index is added for daily_notes.
-- ---------------------------------------------------------------------------

create index tasks_user_id_status_idx on public.tasks (user_id, status);
create index tasks_user_id_project_id_idx on public.tasks (user_id, project_id);

-- ---------------------------------------------------------------------------
-- updated_at mechanism
-- Plain (non-SECURITY DEFINER) trigger function, runs with the invoking role's
-- privileges, and simply stamps the current time on every row update. It reads and
-- writes only the row being updated — it never queries another table (in particular,
-- it never looks up another user's project), so it adds no relationship of its own.
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_set_updated_at
  before update on public.projects
  for each row
  execute function public.set_updated_at();

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row
  execute function public.set_updated_at();

create trigger daily_notes_set_updated_at
  before update on public.daily_notes
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.daily_notes enable row level security;

-- Belt-and-suspenders: explicitly remove any default grants to `anon` (Supabase
-- projects commonly grant table privileges to anon/authenticated by default via
-- ALTER DEFAULT PRIVILEGES), then grant only `authenticated` the privileges RLS
-- will further restrict to each row's own user_id. Anonymous requests are denied
-- at the privilege level, before RLS is even evaluated.

revoke all on public.projects from anon;
revoke all on public.tasks from anon;
revoke all on public.daily_notes from anon;

grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;
grant select, insert, update, delete on public.daily_notes to authenticated;

-- projects ----------------------------------------------------------------

create policy projects_select_own
  on public.projects
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy projects_insert_own
  on public.projects
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy projects_update_own
  on public.projects
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy projects_delete_own
  on public.projects
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- tasks ---------------------------------------------------------------------

create policy tasks_select_own
  on public.tasks
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy tasks_insert_own
  on public.tasks
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy tasks_update_own
  on public.tasks
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy tasks_delete_own
  on public.tasks
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- daily_notes -----------------------------------------------------------------

create policy daily_notes_select_own
  on public.daily_notes
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy daily_notes_insert_own
  on public.daily_notes
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy daily_notes_update_own
  on public.daily_notes
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy daily_notes_delete_own
  on public.daily_notes
  for delete
  to authenticated
  using (auth.uid() = user_id);
