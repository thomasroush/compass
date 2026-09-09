-- Add optional project priority ranking
-- Daily Compass
--
-- APPLIED 2026-09-07. This migration has been executed against the live
-- Supabase project — see BUILD_STATUS.md's "Optional project priority
-- ranking" entry. Kept here as the historical record of what was run; do
-- not re-run it. (An earlier revision of this comment read "PROPOSED
-- MIGRATION — NOT EXECUTED" — that was true only before this migration was
-- applied and was never updated afterward.)
--
-- Adds a single nullable column to public.projects: priority_rank. Mirrors the app's
-- new optional Project.priorityRank field (src/types.ts) — unset means "unranked."
-- No RLS, trigger, or other schema change is needed: the existing projects_set_updated_at
-- trigger and owner-only RLS policies already cover this column since they operate on
-- the whole row, and no new table or relationship is introduced.

alter table public.projects
  add column priority_rank integer;

alter table public.projects
  add constraint projects_priority_rank_positive
  check (priority_rank is null or priority_rank > 0);

comment on column public.projects.priority_rank is
  'Optional manual ordering rank (1, 2, 3, ...) a user assigns to a project. Null means unranked.';
