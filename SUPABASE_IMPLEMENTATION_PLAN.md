# Supabase Implementation Plan

This plan governs adding authenticated cloud sync to Daily Compass via Supabase. It supersedes any earlier, undocumented assumption that a personal Supabase project would not need authentication — see `AGENTS.md` → "Cloud Sync (Supabase)" for the permanent rules this plan must satisfy.

Each phase below is a separate, reviewable unit of work. **Do not start a phase before the previous one is complete and verified.** Only Phase 1 has been implemented; this document describes Phases 2–7 without executing any SQL or writing any of their code yet.

## Guiding constraints (apply to every phase)

- No cloud data may be read or written by an unauthenticated user.
- Every cloud record belongs to exactly one `auth.uid()`, enforced by Row Level Security, not just application code.
- The browser only ever holds the publishable (anon) key. The `service_role` key is never generated into client code, never committed, never referenced from the browser.
- `localStorage` keeps working, offline, for a signed-out user. It is never required to be empty, migrated, or touched without the user's explicit action.
- Existing `localStorage` data is never uploaded, merged, or overwritten automatically — only via a one-time, user-approved import after sign-in.
- Compass stays non-AI.

---

## Phase 1 — Supabase client connection (complete)

- Installed `@supabase/supabase-js`.
- Added `src/lib/supabaseClient.ts`: single reusable client built from `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`. Exports `supabase` (`SupabaseClient | null`) and `isSupabaseConfigured`. Missing env vars produce a `console.warn` and a `null` client rather than a crash.
- `.env.local` confirmed git-ignored; no credential values displayed, copied, or committed.
- No tables, auth, or sync logic exists yet. The client is created but not imported anywhere else in the app.

## Phase 2 — Database schema and Row Level Security

Design and document (but do not execute) the schema needed for authenticated, per-user cloud storage.

**Proposed schema** (Postgres, one table per Compass entity, mirroring `src/types.ts`):

```sql
-- Illustrative only — not executed in this phase.

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  notes text,
  status text not null check (status in ('inbox','this_week','today','in_progress','waiting','done')),
  project_id uuid references public.projects(id) on delete set null,
  priority text not null check (priority in ('low','normal','high')),
  due_date date,
  is_primary boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  status text not null check (status in ('active','completed','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.daily_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  note_date date not null,
  morning_notes text,
  evening_notes text,
  updated_at timestamptz not null default now(),
  unique (user_id, note_date)
);

-- Row Level Security: enable, then restrict every operation to the owning user.
alter table public.tasks enable row level security;
alter table public.projects enable row level security;
alter table public.daily_notes enable row level security;

create policy "tasks_owner_all" on public.tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "projects_owner_all" on public.projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "daily_notes_owner_all" on public.daily_notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

Notes on the proposal:

- `updated_at` on every table is required input for the Phase 4 conflict strategy (last-write-wins by timestamp — see below).
- No default/permissive policy is created anywhere; `for all using/with check (auth.uid() = user_id)` is the only access path, which also implicitly blocks anonymous (`auth.uid() is null`) access since `null = user_id` is never true.
- Foreign keys cascade on `auth.users` deletion so removing a Supabase user cleans up their rows.

**Deliverables for this phase (when it starts):** finalized SQL migration file(s) under version control, RLS policies applied in the Supabase project, and a manual verification pass (as a second, unrelated test account) confirming that account A cannot read, insert, update, or delete account B's rows, and that a signed-out request is rejected.

## Phase 3 — Authentication and login interface

- Add Supabase Auth to Compass (email/password and/or magic link — exact method to be confirmed with the user before building).
- Individual accounts only; no anonymous or shared-account mode.
- A minimal sign-in / sign-up / sign-out UI, consistent with the app's existing plain, non-decorative style (`AGENTS.md` → Simplicity Rules) — no social login buttons, no third-party identity branding beyond what Supabase Auth UI strictly requires.
- Signed-out users see the existing local-only app unchanged; a sign-in entry point is added to Settings.
- Session persistence via Supabase's client-side session handling; no custom token storage.

## Phase 4 — Cloud repository / synchronization layer

- A repository layer that mirrors the existing `src/storage` interface but reads/writes Supabase instead of (or alongside) `localStorage`, gated entirely behind `isSupabaseConfigured` and an active session.
- **Conflict strategy (proposed):** last-write-wins by `updated_at`. On sync, a record is only overwritten if the incoming version's `updated_at` is strictly newer than the local/cloud version being replaced. Local writes always stamp a fresh `updated_at` before syncing. This is intentionally simple (no CRDT/merge) — appropriate for a single user's own devices, but must be re-examined before real multi-user sharing (as opposed to multi-user *isolation*) is ever considered.
- Cloud sync becomes the intended behavior while signed in; `localStorage` continues to be written as an offline cache so the app keeps working if the network drops mid-session.
- `localStorage` must never be silently overwritten by an older cloud snapshot, and vice versa — the timestamp check above governs both directions.

## Phase 5 — User-confirmed localStorage migration

- On first sign-in on a device with existing local data, detect it and show an explicit, describable choice (e.g. "Import N tasks / M projects from this device into your account?") — never an automatic upload.
- Import is one-time and reversible in the sense that it doesn't delete the local copy; it only pushes it to the cloud once approved.
- Declining import leaves local data local and untouched; the user can re-trigger the prompt later from Settings.

## Phase 6 — Cross-device, security, offline, and conflict testing

- Cross-device: sign in on two clients/browsers with the same account, confirm changes propagate.
- Security: confirm (as in Phase 2) that RLS actually blocks cross-account access, and that no `service_role` key or secret is present anywhere in shipped client code or network requests.
- Offline: confirm the app remains fully usable signed-out and with no network, using `localStorage` only.
- Conflict: simulate two devices editing the same record while one is offline, then reconnecting, and confirm the last-write-wins rule behaves as documented and doesn't silently drop data.

## Phase 7 — Vercel environment configuration and deployment verification

- Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the Vercel project's environment variables (production and any preview environments), without ever printing their values in logs or committing them.
- Verify the deployed build behaves identically to local dev: signed-out/local-only mode works with no config surprises, and signed-in cloud sync works against the real Supabase project.
- Confirm ordinary redeployments on the existing production hostname do not affect either `localStorage` data or cloud data (`AGENTS.md` requirement).

---

## Status

| Phase | Status |
|---|---|
| 1. Supabase client connection | Complete |
| 2. Database schema and Row Level Security | Not started (proposed schema above; no SQL executed) |
| 3. Authentication and login interface | Not started |
| 4. Cloud repository / synchronization layer | Not started |
| 5. User-confirmed localStorage migration | Not started |
| 6. Cross-device, security, offline, and conflict testing | Not started |
| 7. Vercel environment configuration and deployment verification | Not started |
