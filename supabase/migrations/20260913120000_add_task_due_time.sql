-- Add optional due time for tasks
-- Daily Compass
--
-- PROPOSED MIGRATION — NOT EXECUTED. Run this against the live Supabase
-- project (SQL editor or `supabase db push`) to apply it.
--
-- Adds a single nullable column to public.tasks: due_time. Mirrors the app's
-- new optional Task.dueTime field (src/types.ts) — unset means "no specific
-- time, all-day." No RLS, trigger, or other schema change is needed: the
-- existing tasks_set_updated_at trigger and owner-only RLS policies already
-- cover this column since they operate on the whole row, and no new table or
-- relationship is introduced.

alter table public.tasks
  add column due_time time;

comment on column public.tasks.due_time is
  'Optional time-of-day paired with due_date. Null means the task has no specific time (all-day).';
