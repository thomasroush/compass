-- Replace Daily Notes with Quick Notes
-- Daily Compass
--
-- PROPOSED MIGRATION — NOT EXECUTED. Run this in the Supabase SQL Editor for
-- this project, then let the app know it's been applied.
--
-- Scope: retires public.daily_notes (morning/evening reflections, one row
-- per user per date) and replaces it with public.quick_notes (short,
-- unstructured reminders — no date, no morning/evening split, many per
-- user). The two shapes are different enough (see
-- src/views/DailyNotesView.tsx vs. the new Quick Notes feature) that
-- reusing daily_notes's columns would not stay clean or understandable —
-- this migration creates a focused new table instead, following exactly
-- the schema conventions established by
-- 20260830120000_phase2_core_schema_and_rls.sql (composite (user_id, id)
-- primary keys, text ids, RLS + explicit anon revoke, the shared
-- public.set_updated_at() trigger).
--
-- Data preservation: every non-blank daily_notes row is copied into
-- quick_notes as one note (see the INSERT ... SELECT below) before
-- daily_notes is dropped, so existing user data is not silently deleted —
-- it is migrated into the new shape, unstarted (not completed, not
-- deleted), so the user notices it and can act on it. A blank daily note
-- (both morning and evening empty — e.g. a row created just by visiting
-- the old Daily Notes page) carries no content and is not migrated,
-- mirroring how the retired feature's own client code never treated a
-- blank note as real data.
--
-- Derived directly from src/types.ts's QuickNote as of this migration's
-- authoring:
--   QuickNote { id, text, completed, deleted, createdAt, completedAt? }
-- `deleted` is a soft-delete flag, not a real row removal — this app has no
-- per-record deletion/tombstone concept anywhere else either (see
-- src/sync/refreshFromCloud.ts), so Quick Notes follow the same
-- archive-not-delete model as Tasks (`archived`) and Targets (`archived`)
-- rather than introducing one.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.quick_notes (
  id text not null default gen_random_uuid()::text,
  user_id uuid not null references auth.users (id) on delete cascade,
  text text not null,
  completed boolean not null default false,
  -- Soft delete — see header comment. Excluded from every read path at the
  -- application layer; never a real DELETE.
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint quick_notes_pkey primary key (user_id, id)
);

comment on table public.quick_notes is 'Daily Compass quick notes, one row per user-owned reminder. Primary key is (user_id, id): ids are unique per user, not globally.';

-- ---------------------------------------------------------------------------
-- updated_at mechanism — reuses the existing public.set_updated_at()
-- function created by 20260830120000_phase2_core_schema_and_rls.sql.
-- ---------------------------------------------------------------------------

create trigger quick_notes_set_updated_at
  before update on public.quick_notes
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security — identical four-policy-per-table pattern as every
-- other table in this app: auth.uid() = user_id on select/insert/update/
-- delete, anon explicitly revoked before granting authenticated the
-- privileges RLS further restricts.
-- ---------------------------------------------------------------------------

alter table public.quick_notes enable row level security;

revoke all on public.quick_notes from anon;

grant select, insert, update, delete on public.quick_notes to authenticated;

create policy quick_notes_select_own
  on public.quick_notes
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy quick_notes_insert_own
  on public.quick_notes
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy quick_notes_update_own
  on public.quick_notes
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy quick_notes_delete_own
  on public.quick_notes
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Data migration: copy every non-blank daily_notes row into quick_notes,
-- combining morning/evening into one text field, before dropping the old
-- table. Ownership (user_id) and creation time (created_at) are preserved;
-- every migrated note starts unread (not completed, not deleted).
-- ---------------------------------------------------------------------------

insert into public.quick_notes (user_id, text, completed, deleted, created_at)
select
  user_id,
  concat_ws(
    ' / ',
    nullif('Morning: ' || nullif(trim(morning_notes), ''), 'Morning: '),
    nullif('Evening: ' || nullif(trim(evening_notes), ''), 'Evening: ')
  ),
  false,
  false,
  created_at
from public.daily_notes
where trim(morning_notes) <> '' or trim(evening_notes) <> '';

-- ---------------------------------------------------------------------------
-- Retire the old table. Its content has already been copied forward above.
-- ---------------------------------------------------------------------------

drop table public.daily_notes;
