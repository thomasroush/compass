-- Add Goals and Targets
-- Daily Compass
--
-- APPLIED. This migration has been executed against the live Supabase
-- project, confirmed by the user. public.goals and public.targets now
-- exist in production. Kept here as the historical record of what was
-- run; do not re-run it.
--
-- Scope: two new tables only — public.goals and public.targets — following
-- exactly the schema conventions established by
-- 20260830120000_phase2_core_schema_and_rls.sql (composite (user_id, id)
-- primary keys, text ids, RLS + explicit anon revoke, the shared
-- public.set_updated_at() trigger). No change to public.projects,
-- public.tasks, or public.daily_notes.
--
-- Derived directly from src/types.ts (Goal, Target) as of this migration's
-- authoring:
--   GOAL_STATUSES        = ['active','achieved','paused','abandoned']
--   TARGET_TYPES          = ['numeric','yesno','linked-tasks']
--   TARGET_VALUE_FORMATS  = ['number','currency']
--   Goal.priority reuses the existing PRIORITIES = ['Low','Normal','High']
--
-- Goal<->Project linking (goals.project_ids) and a linked-tasks Target's
-- task references (targets.task_ids) are plain text[] array columns, not
-- join tables — deliberately, because every view in this app queries the
-- fully-loaded in-memory AppData, never live SQL per render, so a join
-- table's indexed-reverse-lookup benefit is moot here; see the Goals and
-- Targets implementation plan for the full rationale. This means array
-- elements are NOT enforced by a database foreign key — an accepted
-- tradeoff, since neither goals nor projects are ever hard-deleted in this
-- app (only status-changed), so a dangling reference is not reachable via
-- the app's own code paths today.
--
-- Targets use Archive/Restore only (the `archived` column below), never a
-- hard delete — consistent with this app's existing data-preservation
-- model (Tasks: `archived` boolean; Projects: `status = 'archived'`).
-- Archived Targets are excluded from their Goal's progress calculation at
-- the application layer (src/store/reducer.ts's getGoalTargets/
-- getGoalProgress); no database-level enforcement of that rule is needed.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.goals (
  id text not null default gen_random_uuid()::text,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  due_date date,
  priority text not null default 'Normal' check (priority in ('Low', 'Normal', 'High')),
  status text not null default 'active'
    check (status in ('active', 'achieved', 'paused', 'abandoned')),
  -- Ids of Projects (owned by the same user) this Goal contributes to. See
  -- the header comment above for why this is a plain array rather than a
  -- join table, and why the missing per-element foreign key is an accepted
  -- tradeoff.
  project_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goals_pkey primary key (user_id, id)
);

comment on table public.goals is 'Daily Compass goals, one row per user-owned goal. Primary key is (user_id, id): ids are unique per user, not globally.';

create table public.targets (
  id text not null default gen_random_uuid()::text,
  user_id uuid not null references auth.users (id) on delete cascade,
  goal_id text not null,
  type text not null check (type in ('numeric', 'yesno', 'linked-tasks')),
  name text not null,
  sort_order integer not null default 0,
  -- Archive/Restore only — see header comment. Never combined with a delete.
  archived boolean not null default false,
  -- numeric fields (used only when type = 'numeric')
  start_value numeric,
  current_value numeric,
  target_value numeric,
  unit text,
  value_format text check (value_format in ('number', 'currency')),
  -- yes/no field (used only when type = 'yesno')
  achieved boolean,
  -- linked-tasks field (used only when type = 'linked-tasks'); same
  -- no-database-foreign-key tradeoff as goals.project_ids, same rationale —
  -- see header comment.
  task_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint targets_pkey primary key (user_id, id),
  -- Unlike tasks_project_fk (ON DELETE SET NULL — a task survives its
  -- project's deletion), a Target has no independent meaning without its
  -- Goal, so this cascades: deleting a Goal deletes its Targets. (Goals are
  -- not deleted by any current application code path — only moved to
  -- 'abandoned' — so this is a defensive/structural guarantee, not
  -- something the app relies on triggering today.)
  constraint targets_goal_fk
    foreign key (user_id, goal_id)
    references public.goals (user_id, id)
    on delete cascade,
  -- Defensive, matching this table's flat-nullable-column style: each type
  -- must carry the fields that type actually needs. src/repository/mappers.ts's
  -- targetFromRow additionally guards against this at the application layer
  -- rather than trusting the constraint blindly.
  constraint targets_type_fields_check check (
    (type = 'numeric' and start_value is not null and current_value is not null and target_value is not null)
    or (type = 'yesno' and achieved is not null)
    or (type = 'linked-tasks')
  )
);

comment on table public.targets is 'Daily Compass targets, one row per user-owned target, always attached to a goal. Primary key is (user_id, id).';

-- ---------------------------------------------------------------------------
-- Indexes
--
-- The composite primary keys above already provide a leading-user_id index
-- on each table. The indexes below add the specific access patterns this
-- app's repository layer needs beyond that, mirroring
-- tasks_user_id_status_idx / tasks_user_id_project_id_idx from the Phase 2
-- migration:
--   * goals by user + status (a future "hide abandoned" list query)
--   * targets by user + goal (the natural index for "this goal's targets",
--     and for the referencing side of targets_goal_fk)
-- ---------------------------------------------------------------------------

create index goals_user_id_status_idx on public.goals (user_id, status);
create index targets_user_id_goal_id_idx on public.targets (user_id, goal_id);

-- ---------------------------------------------------------------------------
-- updated_at mechanism — reuses the existing public.set_updated_at()
-- function created by 20260830120000_phase2_core_schema_and_rls.sql. No new
-- trigger function is defined here.
-- ---------------------------------------------------------------------------

create trigger goals_set_updated_at
  before update on public.goals
  for each row
  execute function public.set_updated_at();

create trigger targets_set_updated_at
  before update on public.targets
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Identical four-policy-per-table pattern as projects/tasks/daily_notes:
-- auth.uid() = user_id on select/insert/update/delete, anon explicitly
-- revoked before granting authenticated the privileges RLS further
-- restricts. This is what keeps each user's Goals and Targets private —
-- no policy here ever references another user's row, and there is no
-- SECURITY DEFINER function or service_role usage anywhere in this file.
-- ---------------------------------------------------------------------------

alter table public.goals enable row level security;
alter table public.targets enable row level security;

revoke all on public.goals from anon;
revoke all on public.targets from anon;

grant select, insert, update, delete on public.goals to authenticated;
grant select, insert, update, delete on public.targets to authenticated;

-- goals ----------------------------------------------------------------

create policy goals_select_own
  on public.goals
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy goals_insert_own
  on public.goals
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy goals_update_own
  on public.goals
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy goals_delete_own
  on public.goals
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- targets ----------------------------------------------------------------

create policy targets_select_own
  on public.targets
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy targets_insert_own
  on public.targets
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy targets_update_own
  on public.targets
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy targets_delete_own
  on public.targets
  for delete
  to authenticated
  using (auth.uid() = user_id);
