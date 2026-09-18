-- Add calendar-only visibility flag for tasks
-- Daily Compass
--
-- PROPOSED MIGRATION — NOT EXECUTED. Run this against the live Supabase
-- project (SQL editor or `supabase db push`) to apply it.
--
-- Adds a single not-null column to public.tasks: calendar_only, defaulting to
-- false so every existing row is backfilled automatically with no manual
-- data migration. Mirrors the app's new Task.calendarOnly field
-- (src/types.ts) — a visibility/placement flag, not a workflow status; the
-- existing `status` check constraint (Inbox/This Week/Today/In
-- Progress/Waiting/Done) is unchanged, and calendar-only tasks keep whatever
-- status they already have. No RLS, trigger, or other schema change is
-- needed: the existing tasks_set_updated_at trigger and owner/member RLS
-- policies already cover this column since they operate on the whole row.
--
-- Deliberately no CHECK constraint tying calendar_only to due_date (unlike
-- the app-level rule enforced in TaskForm.tsx and defensively in
-- reducer.ts) — matches this table's existing convention of enforcing
-- due_date/due_time's cross-field relationship only in application code
-- (see mappers.ts's taskUpdatesToRow), not in the schema.

alter table public.tasks
  add column calendar_only boolean not null default false;

comment on column public.tasks.calendar_only is
  'When true, this task is hidden from the Board and Tasks/Inbox lists and shown only in the Calendar. Intended to always have due_date set (enforced in the app, not the schema). Independent of status.';
