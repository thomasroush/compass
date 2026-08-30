# Supabase Implementation Plan

This plan governs adding authenticated cloud sync to Daily Compass via Supabase. It supersedes any earlier, undocumented assumption that a personal Supabase project would not need authentication — see `AGENTS.md` → "Cloud Sync (Supabase)" for the permanent rules this plan must satisfy.

Each phase below is a separate, reviewable unit of work. **Do not start a phase before the previous one is complete and verified.** Phases 1–3 have been implemented (Phase 2's manual cross-account verification is still outstanding — see that section). Phases 4–7 are still just described below, with no code written and no further SQL executed.

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

**Proposed migration:** `supabase/migrations/20260830120000_phase2_core_schema_and_rls.sql` (prepared, not executed). It supersedes the illustrative sketch that previously lived in this section — see below for what changed and why.

Tables (one per Compass entity, mirroring `src/types.ts` exactly): `public.projects`, `public.tasks`, `public.daily_notes` (unique on `(user_id, note_date)`). Every table has a non-null `user_id uuid references auth.users(id) on delete cascade`, RLS enabled, four separate owner-only policies (`select`/`insert`/`update`/`delete`, each `to authenticated` and keyed on `auth.uid() = user_id`, with `with check` on insert/update so `user_id` can't be reassigned), and an explicit `revoke ... from anon` plus `grant ... to authenticated` per table so anonymous access is denied at the privilege level, not only by RLS. A plain (non-`SECURITY DEFINER`) trigger function stamps `updated_at` on every update.

**Tenant isolation is structural, not just RLS.** Every table's primary key is the composite `(user_id, id)`, not `id` alone — `id` is only unique within one user's rows, so two different users' rows can never collide in, or be confused for, the same identity. `tasks.project_id` is enforced by a composite foreign key on `(user_id, project_id)` referencing `projects (user_id, id)`, so a task can only reference a project owned by that same task's `user_id`; the database rejects any attempt (however it arrives — app bug, compromised client, a future admin script) to point a task at another user's project. This was a deliberate revision after an initial draft used single-column `id` primary keys and a plain `tasks.project_id -> projects.id` foreign key, which relied entirely on RLS and application code, not the schema itself, to keep tasks and projects within one tenant.

**Deletion behavior:** deleting a project must detach its tasks (`project_id` cleared) without deleting them, and without disturbing `user_id`. The migration does this with PostgreSQL 15's column-specific foreign-key action syntax, `on delete set null (project_id)`, which clears only `project_id` and leaves the rest of the row — including `user_id` — untouched. A plain (pre-15) composite `on delete set null` would null out *every* FK column, including `user_id`, which is `not null` on `tasks`; that would make a project deletion fail outright rather than detach cleanly, so it isn't used. **This is a Postgres-version dependency to confirm before ever executing the migration** — Supabase's current managed Postgres offerings are 15+, but the actual target project's version should be checked (e.g. `select version();`) rather than assumed. If it turns out to be older than 15, the fallback is to keep the composite FK for the structural ownership guarantee, drop its `on delete` action, and instead detach a project's tasks via an explicit, RLS-scoped application step (set `project_id = null` on that user's affected tasks, then delete the project) — not a database trigger that queries across tables, and not a cross-user-unsafe foreign key.

**Other corrections versus the earlier illustrative sketch**, made while turning it into the actual migration:

- Status/priority `check` constraints now use the app's real, case-sensitive string values — `'Inbox' | 'This Week' | 'Today' | 'In Progress' | 'Waiting' | 'Done'` and `'Low' | 'Normal' | 'High'` (from `TASK_STATUSES` / `PRIORITIES` in `src/types.ts`) — not the earlier placeholder `'inbox' | 'this_week' | ...` snake_case guesses.
- `id` columns are `text`, not `uuid`. The app's `generateId()` prefers `crypto.randomUUID()` but falls back to a non-UUID `${timestamp}-${random}` string when `crypto.randomUUID` is unavailable; a `uuid` column would reject that fallback shape and any such existing id, so preserving stable ids (a hard requirement) rules out `uuid` as the column type. `gen_random_uuid()::text` is kept only as a default for rows the database itself might originate.
- Each table has four separate `select`/`insert`/`update`/`delete` policies instead of one combined `for all` policy, so each operation's ownership check is independently auditable.
- Anonymous access is denied by explicit `revoke`/`grant` in addition to RLS, rather than relying solely on `auth.uid() is null` never matching `user_id`.
- `tasks.archived` (boolean) is included — it's part of the current `Task` type and is how the app implements "archive rather than delete" — and wasn't in the earlier sketch.
- `daily_notes` columns are `morning_notes` / `evening_notes`, both `not null default ''` (the app already treats them as always-present strings, never optional).
- Indexes were adjusted for the composite-key design: `(user_id, id)` primary keys already provide a leading-`user_id` index on every table, so the separate single-column `user_id` indexes from the first draft were dropped as redundant; `tasks (user_id, status)` and `tasks (user_id, project_id)` remain (the latter also serves as the index on the referencing side of `tasks_project_fk`).

**Design choices carried forward as-is:** `updated_at` on every table (still anticipatory input for the Phase 4 last-write-wins strategy — the current `Task`/`Project`/`DailyNote` TypeScript types don't yet have `updatedAt` fields; Phase 4 will need to decide whether to surface them client-side or let the DB trigger be the sole source of truth). `user_id` foreign keys to `auth.users` still cascade on delete so removing a Supabase user cleans up their rows.

**Deliverables for this phase:** the migration file above reviewed, approved, and applied in the Supabase project (done — confirmed target Postgres version 17.6, well past the 15+ dependency for the tasks→projects `on delete set null (project_id)` clause). Confirmed by direct inspection that all three tables have RLS enabled and exactly four owner-only policies each, matching this file with no drift. **Still outstanding:** the manual verification pass (as a second, unrelated test account) confirming that account A cannot read, insert, update, or delete account B's rows, and that a signed-out request is rejected — not yet done, since no application code touches these tables until Phase 4. This should happen either directly (SQL editor/API, signed in as two different test accounts) or as part of exercising Phase 4's repository layer once it exists — either way, before Phase 4 is considered complete.

## Phase 3 — Authentication and login interface (complete)

- Added Supabase Auth to Compass using email/password only (the two methods enabled in the Supabase project: email/password provider, email confirmation on, new sign-ups on). No magic link, no social login.
- Individual accounts only; no anonymous or shared-account mode. The client uses only the existing `src/lib/supabaseClient.ts` — no second client was created.
- `src/store/AuthContext.tsx` (`AuthProvider`, consumed via `src/store/useAuth.ts`) initializes the session with `supabase.auth.getSession()` and subscribes to `supabase.auth.onAuthStateChange` on mount, exposing a `status: 'loading' | 'ready'` state so the UI has a clear initial-loading moment before the first session check resolves (immediately `'ready'`, with no spinner, when Supabase isn't configured — there's nothing to wait for).
- `src/components/AccountPanel.tsx`, embedded in `SettingsView`, provides sign in, create account, forgot password, sign out, and the signed-in email display — one shared form switched between three modes by plain-text buttons, consistent with the app's existing plain settings-section style (`AGENTS.md` → Simplicity Rules). When Supabase isn't configured it shows an explanatory message instead of forms, so the local-only app's behavior and messaging stay honest about what's actually available.
- `src/components/PasswordRecoveryDialog.tsx`, mounted globally in `AppShell.tsx`, opens automatically on Supabase's `PASSWORD_RECOVERY` auth event (fired after a user follows a password-recovery email link) and lets the user set a new password, with client-side validation and a persistent success message that only dismisses when the user acts (Continue/Cancel) — it does not auto-close.
- Email-confirmation and password-recovery redirects both use `window.location.origin` (via `emailRedirectTo` on `signUp` and `redirectTo` on `resetPasswordForEmail`), which resolves correctly to `http://localhost:5173` and `https://compass-beige-nine.vercel.app` without any environment branching, relying on `supabase-js`'s default URL-based session/event detection plus the wildcard redirect URLs already configured in Supabase Authentication.
- All error/success messaging is Supabase's own plain-language message text (e.g. "Invalid login credentials", "Password updated.") — no token, session, or other technical/credential detail is ever displayed.
- Signed-out users see the existing local-only app completely unchanged: `AppProvider` and localStorage persistence don't depend on auth `status` in any way, and no Supabase table (`projects`, `tasks`, `daily_notes`) is read or written anywhere in this phase — sync is out of scope until Phase 4.
- Session persistence uses Supabase's own client-side session handling (the default client configuration — `persistSession`/`autoRefreshToken`/`detectSessionInUrl` all default `true`); no custom token storage was added.
- Tested with `src/store/AuthContext.test.tsx`, `src/components/AccountPanel.test.tsx`, `src/components/AccountPanel.unconfigured.test.tsx`, and `src/components/PasswordRecoveryDialog.test.tsx`, all against a mocked `../lib/supabaseClient` (never the live project). **Still needed:** manual end-to-end testing of the real email flows (account creation + confirmation email, password reset + recovery email) on both localhost and the deployed Vercel URL — that can't be exercised from this environment.

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
| 2. Database schema and Row Level Security | Applied (Postgres 17.6 confirmed; RLS/policy inventory verified against all three tables). Manual cross-account verification (as a second test account) still outstanding — see Phase 2 above |
| 3. Authentication and login interface | Complete (email/password sign-up, sign-in, sign-out, forgot-password, and recovery-redirect password reset all implemented and tested with a mocked Supabase client). Manual end-to-end testing of the real confirmation/recovery emails on localhost and Vercel still outstanding |
| 4. Cloud repository / synchronization layer | Not started |
| 5. User-confirmed localStorage migration | Not started |
| 6. Cross-device, security, offline, and conflict testing | Not started |
| 7. Vercel environment configuration and deployment verification | Not started |
