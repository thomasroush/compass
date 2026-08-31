# Build Status

## Completed

- [x] Vite + React + TypeScript scaffold
- [x] React Router with six views (Today default)
- [x] localStorage persistence with validation
- [x] Task CRUD, search, filter, archive, primary cap (max 3)
- [x] Today view (primary, other today, overdue)
- [x] Board view (six columns, status select, reorder)
- [x] Projects view
- [x] Daily Notes view
- [x] Settings (export JSON, import, Markdown export, reset)
- [x] Responsive layout (sidebar + mobile nav)
- [x] Essential Vitest tests
- [x] README
- [x] Immediate (non-debounced) save on every dispatched data change

## Maintenance log

- Reviewed the app against the updated AGENTS.md (existing-project maintenance instructions). Confirmed data model, storage/validation, and all six views already met requirements.
- Fixed one gap: ordinary edits were persisted via a 300ms `debouncedSave`, not immediately as required. `AppContext.tsx` now calls `flushSave` (synchronous `localStorage` write) on every state change; the unused debounce timer was removed from `storage.ts`. Import/reset already used `flushSave` and were unaffected.

## Supabase integration — direction corrected (2026-08-29)

Cloud sync via Supabase is an approved, in-progress feature. The full phased plan now lives in `SUPABASE_IMPLEMENTATION_PLAN.md`; `AGENTS.md` → "Cloud Sync (Supabase)" holds the permanent rules.

**Correction:** an earlier version of `AGENTS.md` incorrectly stated that a personal single-user Supabase project would not need authentication. That has been reversed. Authentication is now a hard, permanent requirement: no cloud data may be read or written by an unauthenticated user, every cloud record must belong to an authenticated `user_id`, and Row Level Security must enforce `user_id = auth.uid()` on every table. This supports the intended architecture — private cross-device access now, and potentially additional users later.

### Phase 1 — Supabase client connection (complete)

- [x] Installed `@supabase/supabase-js`.
- [x] Added `src/lib/supabaseClient.ts` — single reusable client read from `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`. Exports `supabase` (typed `SupabaseClient | null`) and `isSupabaseConfigured`. If either env var is missing, the client is `null` and a `console.warn` explains that the app is running localStorage-only — it does not throw or block startup.
- [x] Typed the two env vars in `src/vite-env.d.ts` (`ImportMetaEnv`).
- [x] Confirmed `.env.local` is still git-ignored (`git check-ignore -v .env.local` → matched by `.gitignore:5:.env.local`). No env values were displayed, copied, or committed.
- [ ] Not done yet (by design): no database tables, auth screens, or sync logic. `supabaseClient.ts` is created but not imported anywhere else in the app — the client exists but is inert.

Current status: app behavior and localStorage persistence are unchanged. No code was added or modified in this correction pass — only `AGENTS.md`, this file, and the new `SUPABASE_IMPLEMENTATION_PLAN.md`.

### Phase 2 — Database schema and Row Level Security (applied)

- [x] `supabase/migrations/20260830120000_phase2_core_schema_and_rls.sql` has been executed against the Supabase project. `public.projects`, `public.tasks`, and `public.daily_notes` all exist, each with composite `(user_id, id)` primary keys, RLS enabled, and four separate owner-only policies (`select`/`insert`/`update`/`delete`, each scoped to `auth.uid() = user_id`).
- [x] Confirmed the target Postgres version is 17.6 — well past the 15+ requirement the migration's column-specific `on delete set null (project_id)` clause depends on, so the tasks→projects foreign key applied as designed (detaches a deleted project's tasks without touching `user_id`).
- [x] RLS inventory verified directly against the applied schema: all three tables have `rowsecurity = true` and exactly four policies each (owner-only, `to authenticated`), matching the migration file with no drift.
- [ ] Not yet done: the manual cross-account verification pass (sign in as a second test account and confirm it cannot read/write the first account's rows, and that a signed-out request is rejected) called for in the plan's Phase 2 deliverables. No application code reads or writes these tables yet (that begins in Phase 4), so this check should happen either now via the Supabase SQL editor/API directly, or once Phase 4 adds a repository layer to exercise it end to end.

### Phase 3 — Authentication and login interface (complete)

- [x] `src/store/AuthContext.tsx` — new `AuthProvider`/`useAuth` (via `src/store/useAuth.ts`) built on the existing `src/lib/supabaseClient.ts` (no second client created). On mount it calls `supabase.auth.getSession()` and subscribes to `supabase.auth.onAuthStateChange`, exposing `status: 'loading' | 'ready'` so the UI has a clear, distinct initial-loading state before the session check resolves. When Supabase isn't configured, `status` is `'ready'` immediately (nothing to wait for) and every action returns a clear "cloud account access is unavailable" result instead of attempting a network call.
- [x] Exposes `signUp`, `signIn`, `signOut`, `requestPasswordReset`, `updatePassword`, and `cancelPasswordRecovery`, each returning a plain `{ ok, message }` result built from Supabase's own error/success messages (e.g. "Invalid login credentials", "Password updated.") — never a token, session object, or other technical detail.
- [x] `src/components/AccountPanel.tsx` — the account UI embedded in Settings (`src/views/SettingsView.tsx`), consistent with the app's existing plain settings-section styling: sign in, create account, forgot password (three modes sharing one form, switched by plain-text buttons with non-colliding labels), sign out, and the signed-in email display. When Supabase isn't configured it shows an explanatory message and no forms; while the session check is loading it shows "Checking your session…".
- [x] `src/components/PasswordRecoveryDialog.tsx` — a modal (mounted globally in `AppShell.tsx`, so it appears regardless of route) that opens automatically when Supabase fires a `PASSWORD_RECOVERY` auth event, lets the user set and confirm a new password (client-side length/match validation before calling Supabase), shows a plain success message, and only closes when the user dismisses it (Cancel, or Continue after success) — it does not auto-dismiss on a successful update, so the confirmation is always visible.
- [x] Both `signUp` and `requestPasswordReset` pass `redirectTo`/`emailRedirectTo: window.location.origin`, so email-confirmation and password-recovery links redirect correctly on both `http://localhost:5173` and `https://compass-beige-nine.vercel.app` without any environment-specific branching — this relies on `supabase-js`'s default `detectSessionInUrl` behavior to parse the redirect and fire the corresponding auth event.
- [x] The existing signed-out, localStorage-only app is unchanged: `AppProvider`/local task data render and function exactly as before regardless of auth `status`, and no Supabase table (`projects`, `tasks`, `daily_notes`) is read from or written to anywhere in this phase.
- [x] Tests: `src/store/AuthContext.test.tsx`, `src/components/AccountPanel.test.tsx`, `src/components/AccountPanel.unconfigured.test.tsx`, `src/components/PasswordRecoveryDialog.test.tsx` — all mock `../lib/supabaseClient` (via `vi.mock`/`vi.hoisted`) and never contact the live Supabase project. Cover: the loading→ready transition, session state reflecting `onAuthStateChange` events, sign-in/sign-up/sign-out success and error messaging, the "Supabase not configured" fallback UI, mode switching in the account form, and the recovery dialog's validation, success, and cancel paths.
- [x] Added `@testing-library/react` and `jsdom` as dev dependencies to support these component tests; existing tests keep running under the `node` environment (unchanged `vitest.config.ts`), the four new RTL test files opt into `jsdom` per-file via a `// @vitest-environment jsdom` pragma.

**Manual testing still needed (cannot be done from this environment):** exercising the real email flows — creating an account and confirming via the actual confirmation email, and requesting/completing a password reset via the actual recovery email — on both `http://localhost:5173` and the deployed Vercel URL, to confirm Supabase's redirect handling behaves as expected outside of the mocked test environment.

Production authentication confirmed working end-to-end (2026-08-30): the `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` env vars were added to the Vercel project and it was rebuilt, and account creation, email confirmation, sign-in, sign-out, and password recovery were all manually verified — both on `http://localhost:5173` and `https://compass-beige-nine.vercel.app`. (This anticipates part of Phase 7's deployment verification, done opportunistically here since Phase 3's manual testing needed it anyway — the rest of Phase 7, i.e. confirming redeployments don't affect existing data, is still pending.)

### Phase 4 — Cloud repository layer (repository code complete; not activated)

Built and tested in isolation under `src/repository/`. **Deliberately not wired into `AppContext` or any view yet** — no import of anything under `src/repository/` exists anywhere else in `src/` (confirmed by search), so this phase changes no runtime behavior of the shipped app; `tsc` type-checks the new files but Vite's bundle is byte-for-byte the same size as before, confirming they're not pulled into the built app.

- [x] `src/repository/types.ts` — `CloudProject`/`CloudTask`/`CloudDailyNote` (the app's own `Project`/`Task`/`DailyNote` types, unmodified, plus a cloud-only `updatedAt: string` carried through from the database's `updated_at` for later conflict handling), and a `RepositoryResult<T> = { ok: true; data: T } | { ok: false; error: RepositoryError }` result shape (`RepositoryError` has a `type: 'unconfigured' | 'unauthenticated' | 'database'` and a plain `message` — Supabase's own error text, never a token, key, or session detail).
- [x] `src/repository/session.ts` — `getAuthenticatedSession()` is the single place that resolves `user_id`: it reads the live Supabase session via `supabase.auth.getSession()` and returns the session's own `user.id`. No repository function takes a `userId` parameter, so the UI has no way to hand in another user's id, by construction, not just convention. Returns a typed `unconfigured` error immediately (no network call) when Supabase isn't configured, and a typed `unauthenticated` error when nobody is signed in.
- [x] `src/repository/mappers.ts` — pure, individually-tested camelCase ↔ snake_case mapping functions per entity (`projectFromRow`/`taskFromRow`/`dailyNoteFromRow` for reads; `*ToInsertRow` for creates; `*UpdatesToRow` for partial updates). Notably: `dueDate` ↔ `due_date`, `projectId` ↔ `project_id`, `isPrimary` ↔ `is_primary`, `sortOrder` ↔ `sort_order`, `completedAt` ↔ `completed_at`, `date`/`morning`/`evening` ↔ `note_date`/`morning_notes`/`evening_notes`. A deliberate mapping decision: the update mappers check `'field' in updates` rather than `updates.field !== undefined`, so that omitting an optional field (leave unchanged) is distinguishable from explicitly setting it to `undefined` (clear it to `null` in the database) — e.g. `updateTask(id, { projectId: undefined })` un-assigns a task's project, while `updateTask(id, { title: 'X' })` leaves `project_id` untouched. `!== undefined` can't tell those apart because both look identical once the key's value is read.
- [x] `src/repository/projectsRepository.ts`, `tasksRepository.ts`, `dailyNotesRepository.ts` — `listX()`, `createX()`, `updateX(id, updates)`, `deleteX(id)` for each of the three tables. Every query explicitly filters `.eq('user_id', userId)` in addition to relying on RLS (defense in depth against an application bug, not a substitute for it), and update/delete additionally filter `.eq('id', id)` — matching the schema's composite `(user_id, id)` identity model. All reads use an explicit column list (e.g. `'id,title,notes,status,project_id,priority,due_date,created_at,completed_at,sort_order,is_primary,archived,updated_at'`), never `select('*')`. Creates preserve the app's client-generated `id` (and, for tasks, the client-set `createdAt`) rather than letting the database assign one, so a record's identity survives an eventual cloud round-trip. `updated_at` is selected and returned on every read/write/create so a later phase's last-write-wins logic has it. Tasks' `project_id` is passed through as given; the composite foreign key added in Phase 2 is what actually rejects a task pointed at another user's project — the repository doesn't duplicate that check client-side.
- [x] Tests (all against a mocked `../lib/supabaseClient`, no live network calls): `mappers.test.ts` (12 tests, pure field-mapping including the explicit-undefined-clears-the-field cases), `session.test.ts` + `session.unconfigured.test.ts` (4 tests: authenticated / unauthenticated / database-error-from-getSession / unconfigured), `projectsRepository.test.ts` (11), `tasksRepository.test.ts` (11, including the foreign-key-violation and project-unassignment cases), `dailyNotesRepository.test.ts` (10, including the unique-`(user_id, note_date)`-violation case), and `repository.unconfigured.test.ts` (1 test covering all three `listX` functions at once). Each repository's tests cover: the authentication requirement (no session ⇒ typed error, `from()` never called), ownership-safe filters (asserting the exact `eq('user_id', …)` / `eq('id', …)` calls), empty-result lists, and database failures surfaced as typed errors instead of thrown exceptions.
- [ ] Not done (by design, per this phase's scope): no connection to `AppContext`, no sync/merge logic, no last-write-wins conflict resolution (that's still Phase 4's *synchronization* half, deferred). `upsertProject`/`upsertTask`/`upsertDailyNote` were added in Phase 5A below (still inside `src/repository/`, following the exact same authentication/ownership pattern as the rest of this layer) to support the one-time migration; no other Phase 4 behavior changed.

**Design decisions carried forward, not yet resolved:** the proposed last-write-wins-by-`updated_at` conflict strategy from this file's Phase 4 section is still just proposed — this pass built the read/write primitives it would need (`updatedAt` on every returned record) but didn't implement the comparison/merge logic itself, since activating two-way sync is explicitly out of scope until a future phase. Also still open: whether `AppContext` will eventually call this repository directly or through an intermediate sync-orchestration layer — deferred to whichever future phase actually activates two-way sync.

### Phase 5A — controlled, explicit local-to-cloud migration (complete)

A one-time, user-initiated push of a device's existing `localStorage` data into that user's Supabase account. This is deliberately narrower than "Phase 5" as originally scoped in `SUPABASE_IMPLEMENTATION_PLAN.md` (which anticipated pull-down/two-way behavior later) — 5A is upload-only, manual, and does not touch local data. `AppContext`, `storage.ts`, Export, Import, and Reset are all unchanged.

- [x] `src/repository/projectsRepository.ts`, `tasksRepository.ts`, `dailyNotesRepository.ts` — added `upsertProject`/`upsertTask`/`upsertDailyNote`. Each upserts on `{ onConflict: 'user_id,id' }`, matching the Phase 2 schema's composite `(user_id, id)` primary key, so a record with an id that already exists in the cloud is updated in place instead of duplicated, and a new id is inserted. Built on the existing `*ToInsertRow` mappers — no new mapping logic. `user_id` is resolved the same way as every other repository function: only from `getAuthenticatedSession()`, never a parameter.
- [x] `src/repository/migration.ts` — the migration orchestration, built entirely on the repository layer above (no direct Supabase calls, per AGENTS.md's "don't duplicate cloud CRUD logic" rule):
  - `countLocalData(local)` — pure counts of local projects/tasks/daily notes, for display.
  - `getCloudCounts()` — current cloud counts for the signed-in user (fails with a typed `unauthenticated`/`unconfigured` error if there's no session, exactly like every other repository read).
  - `runMigration(local)` — uploads all local projects, then all local tasks, then all local daily notes (in that order, so task→project references stay valid), one record at a time via the upsert functions above. A single record's failure is collected and reported, not thrown, and does not stop the rest. If authentication itself fails partway (e.g. the session expires mid-migration), migration stops immediately rather than continuing to write with no verified owner. After all uploads, it re-reads `listProjects`/`listTasks`/`listDailyNotes` and, for every record it believes it uploaded, confirms the id is present and its key fields (name/title/status, note content) match the local copy. `runMigration` never reports `ok: true` unless every upload succeeded and every one of them was confirmed present and correct on re-read.
- [x] `src/components/MigrationPanel.tsx` — the UI, embedded in Settings below the existing `AccountPanel`. Shown only when Supabase is configured; when signed out it explains that signing in enables migration and shows no button (nothing is checked or uploaded). When signed in: a single "Migrate this device's data" button first fetches cloud counts (no upload yet) and opens a confirmation dialog showing the signed-in email, local counts, and current cloud counts side by side, with an explicit explanation that this copies device data to the account and does not delete or change anything locally. Only the dialog's "Copy data to cloud" button calls `runMigration`. The result view reports uploaded/verified counts on success, or the specific failing records and/or verification issues on failure — and always reiterates that local data was not changed. `MigrationPanel` never imports `storage.ts` or dispatches to `AppContext`, so it structurally cannot clear or alter local data.
- [x] Tests: `src/repository/migration.test.ts` (8 tests, repository functions mocked) — no migration without authentication (stops immediately, no task/note upload attempted, no verification re-read), a full successful migration (projects before tasks, stable ids preserved via `toHaveBeenCalledWith` on the original record, verification passes), partial upload failure reporting (one of two tasks fails; the other still migrates and verifies), and two verification-failure cases (a migrated record missing on re-read; a migrated record whose re-read content doesn't match). `src/components/MigrationPanel.test.tsx` (8 tests, RTL, hooks mocked) — no migrate button and no cloud check when signed out, opening the review step never calls `runMigration` (including after Cancel), `runMigration` fires only after the explicit confirm button, partial-failure and verification-failure outcomes are rendered without a success message, an auth failure is reported plainly, and — after a full successful run — `dispatch` was never called (local data untouched).
- [x] Existing `projectsRepository.test.ts`/`tasksRepository.test.ts`/`dailyNotesRepository.test.ts` each gained 3 tests for their new `upsertX` function (stable-id upsert payload and `onConflict` target, the authentication requirement, and a typed database-error case).

**Not done (out of scope for 5A, by design):** no automatic upload on sign-in, no pull-down of cloud data into local state, no two-way sync, no deletion or clearing of `localStorage` at any point, no repeat-migration dedupe logic beyond the upsert-by-id behavior itself (running migration again from the same device re-upserts the same ids, which is safe but not specially detected/labeled as a "re-run").

**Manually verified against the production Supabase project (2026-08-31):** with the Windows clock resynchronized and a fresh authentication session established, the migration preview correctly showed 4 local projects, 9 local tasks, and 3 local daily notes against 0 cloud projects, 0 cloud tasks, and 0 cloud daily notes. Migration completed successfully. Application verification after migration confirmed 4 projects, 9 tasks, and 3 daily notes, and local data remained intact after a refresh. Direct inspection of the production database confirmed the same record counts and no orphaned project-task relationships. Production constraints were directly confirmed on the live schema: `projects` `primary key (user_id, id)`, `tasks` `primary key (user_id, id)`, `tasks`' composite project foreign key, `daily_notes` `primary key (user_id, id)`, and `daily_notes` `unique (user_id, note_date)`.

### Phases 5B–7 — not started (pull-down/two-way sync, cross-device/security/offline/conflict testing, remaining deployment verification)

See `SUPABASE_IMPLEMENTATION_PLAN.md` for full detail. Phase 7's Vercel env var configuration and basic redirect verification are effectively done (see the production-auth confirmation note above); its "ordinary redeployment doesn't affect existing data" check is still open.

**Next recommended step:** finish Phase 2's manual cross-account verification (still outstanding), then decide whether/how to build two-way sync (last-write-wins conflict logic, wiring the repository into `AppContext`) before Phase 6's cross-device/security/offline/conflict testing.

## Latest test results

```
npm run test
Test Files  14 passed (14)
Tests       100 passed (100)
```

## Latest build results

```
npm run build
tsc -b && vite build — success
dist/assets/index-D18Xz1EY.js   503.40 kB
```

## Lint

```
npm run lint — 0 errors (2 pre-existing warnings: react-refresh/only-export-components on AppContext.tsx and AuthContext.tsx, both context+provider files by design)
```
