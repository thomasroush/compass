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

### Phase 5B1 — internal synchronization foundations (complete; inactive, not wired into the app)

Groundwork only, per the architecture decisions approved for Phase 5B (Supabase authoritative while authenticated; `localStorage` remains the immediate cache/offline/signed-out store; no `updatedAt` on exported `AppData` or client-clock conflict decisions; guarded writes required from the first activated cloud write, no interim unconditional-write phase; no Realtime/websockets; sync is event-driven via sign-in/startup and a manual "Sync now," not polling; no per-record hard deletion/tombstones yet; explicit choice required — never a guess or auto-upload — when a device has both local and cloud data with no established sync relationship). **Nothing in this phase changes visible application behavior.** The reducer, `AppContext`'s existing save behavior, `MigrationPanel`, Import, and Reset are all unchanged; no new code is imported from `src/App.tsx` or any view/component.

- [x] Confirmed `listProjects`/`listTasks`/`listDailyNotes` (Phase 4) already serve as the typed read-all operations Phase 5B's hydration path will need — no new repository read functions were required.
- [x] `src/sync/metadata.ts` — typed, pure, in-memory schema and helpers for device-local sync bookkeeping: `SyncMetadataStore` (`{ version: 1, accounts: Record<accountId, AccountSyncMetadata> }`) and `AccountSyncMetadata` (`established: boolean`, `lastSyncedAt: string | null`, `records: Record<SyncEntity, Record<id, { lastKnownUpdatedAt: string }>>`, `dirty: Record<SyncEntity, string[]>`, where `SyncEntity` is `'project' | 'task' | 'dailyNote'`). `getAccountMetadata(store, accountId)` is the single read path and always returns a fresh empty record rather than another account's data when the given account has never been seen — this is where account isolation lives. All mutation helpers (`upsertAccountMetadata`, `markEstablished`, `setLastSyncedAt`, `setRecordUpdatedAt`, `markDirty`, `clearDirty`) are pure, mirroring `appReducer`'s style.
- [x] `src/sync/metadataValidation.ts` — schema validation mirroring `storage/validation.ts`'s pattern exactly (`validateSyncMetadataStore`, `parseJsonSyncMetadata`, `loadSyncMetadataFromString`), including a corruption/tamper guard that rejects a stored account entry whose embedded `accountId` doesn't match the key it's filed under.
- [x] `src/sync/metadataStorage.ts` — load/save/clear against a new, separate storage key (`daily-compass-sync-v1`, distinct from `AppData`'s `daily-compass-v1`), reusing `storage/storage.ts`'s existing `getStorage()` (localStorage, or the same in-memory fallback) rather than duplicating it. Never read or written by `loadAppData`/`saveAppData`/Export/Import — confirmed by a dedicated test that saving `AppData` under its own key leaves sync metadata untouched and vice versa.
- [x] `src/sync/hydration.ts` — `decideHydration(input): HydrationDecision`, a pure function (no I/O, no repository calls) classifying exactly seven situations: signed out; cloud query failed (with the underlying `RepositoryErrorType` and message preserved); both cloud and local empty; cloud populated/local empty (safe to hydrate); cloud empty/local populated (Phase 5A's existing migration prompt territory, never an auto-upload); both populated with no established device/account marker (must ask, never guess); both populated with an established marker (ordinary sync applies, left undefined beyond this phase). Not called from anywhere yet — no orchestrator gathers real counts and feeds them in.
- [x] `src/repository/types.ts` — added `'conflict'` to `RepositoryErrorType` (alongside the existing `'unconfigured' | 'unauthenticated' | 'database'`), reusing the existing `RepositoryResult<T>` shape rather than introducing a parallel result type. Confirmed no existing code exhaustively switches on `RepositoryErrorType` (only `migration.ts`'s `if` checks for `'unauthenticated'`/`'unconfigured'`), so this is a non-breaking, additive change.
- [x] Guarded (compare-and-swap) update functions — `updateProjectGuarded`, `updateTaskGuarded`, `updateDailyNoteGuarded`, added to the existing repository files alongside (not replacing) `updateProject`/`updateTask`/`updateDailyNote`. Each takes an `expectedUpdatedAt` and adds one extra `.eq('updated_at', expectedUpdatedAt)` filter to the same conditional `UPDATE ... .select().maybeSingle()` call; a `null` result with no error (zero rows matched) is reported as a typed `'conflict'` error, distinct from a genuine `'database'` error. **Not called from any UI, dispatch path, or other repository function** — these exist so a future phase can activate guarded writes from the first moment cloud writes go live, per the approved decision to never deploy an interim unconditional-write version.
- [x] **Guarded-write mechanism analysis (required by this phase's scope, no RPC added):** a single PostgREST-issued `UPDATE ... WHERE user_id = ? AND id = ? AND updated_at = ? RETURNING ...` is one atomic SQL statement — Postgres evaluates the `WHERE` clause and applies the write together, under the same row lock/snapshot, so there is no client-visible read-then-write race window for another device's write to land in between. This is a real compare-and-swap, not an approximation of one, and needs no database RPC or SQL migration. Two implementation details make it correct: (1) the `expectedUpdatedAt` passed in must be the exact string a prior read returned for `updated_at` (never reformatted/re-parsed), since Postgres compares the cast `timestamptz` value, not raw text, and re-sending the identical string round-trips to the identical instant; (2) `.maybeSingle()` (not `.single()`) is required to read "zero rows matched" as `{ data: null, error: null }` rather than a thrown/error response, which is what distinguishes a conflict from a real database failure. An RPC would only become necessary for a multi-table atomic transaction or server-side field-merge logic — neither applies to this single-table, whole-row-replace guarded update.
- [x] Tests: `src/sync/metadata.test.ts` (7), `src/sync/metadataValidation.test.ts` (14, including the account-id/key-mismatch corruption guard and several malformed-shape cases), `src/sync/metadataStorage.test.ts` (7, including cross-account isolation and independence from `AppData`'s storage key), `src/sync/hydration.test.ts` (10, one per decision branch plus edge cases). `projectsRepository.test.ts`/`tasksRepository.test.ts`/`dailyNotesRepository.test.ts` each gained 4 tests for their new guarded-update function (success, typed conflict, typed database error, unauthenticated) — all against the existing mocked `../lib/supabaseClient` pattern, no live network calls. Total suite: 150 tests passing (up from 100 before this phase).

**Not done in 5B1, by design:** no hydration orchestrator (nothing calls `decideHydration` with real data yet), no wiring of the guarded-update functions into any dispatch path or UI, no new "Sync now" control, no changes to `AppContext`/the reducer, no SQL migration or RPC, no activation of any synchronization behavior a user could observe. `vite build`'s bundle size is unchanged from before this phase (503.40 kB), confirming `src/sync/*` is not imported from `src/App.tsx` or any view/component and is not pulled into the shipped app.

**Risks and open questions carried into 5B2/5B3 (not resolved here):** whether local `Task`/`Project`/`DailyNote` types eventually need their own client-stamped field for the rare fully-offline concurrent-edit tie-break, given decision #3 rules out using the client clock for conflict decisions generally (the guarded update above relies entirely on the server's `updated_at`, which resolves the common case; a purely-offline double-edit on two never-yet-synced devices has no server timestamp to compare against and is explicitly out of scope here); how large `dirty`/`records` can grow before a bounded/pruning strategy is needed (not a concern yet since nothing writes to them); and the still-unresolved Phase 5A-era question of whether `AppContext` will eventually call cloud sync directly or through an intermediate layer (this phase adds `src/sync/` as that intermediate layer's home without yet deciding how `AppContext` will invoke it).

### Phase 5B2 — signed-in cloud hydration (complete; read-only, no cloud writes activated)

Narrower than this phase's original description in `SUPABASE_IMPLEMENTATION_PLAN.md` (which
anticipated wiring in the guarded-update functions here too): this slice is deliberately
**read-only**. It activates `src/sync/` for the first time — the first code outside
`src/sync/*.test.ts` to import from it — but only to decide whether it is safe to pull a
signed-in user's cloud data into this device's local app state; it makes no cloud write of any
kind. Wiring the guarded-update functions in for real two-way sync remains 5B3's job.

- [x] `src/sync/hydrateFromCloud.ts` — the orchestrator. Given this device's current local
  `AppData`, whether the user is signed in, and whether this device already has an established
  sync link with that account (from `src/sync/metadata.ts`), it reads all three tables via the
  existing `listProjects`/`listTasks`/`listDailyNotes` (Phase 4/5B1 — no new repository code),
  computes cloud counts, and calls Phase 5B1's `decideHydration`. Only for the unambiguous
  `hydrate-from-cloud` decision (cloud has data, local is empty) does it return app-shaped data
  ready to load; every other decision returns no data, so a caller cannot accidentally apply one.
  Like every function in `src/repository/`, it takes no user id parameter at all — the signed-in
  user is resolved deep inside the repository layer from the live Supabase session, and this
  function only ever sees the current session's own data.
- [x] `src/store/CloudSyncContext.tsx` (`CloudSyncProvider`, via `src/store/useCloudSync.ts`) —
  the only piece of the app that calls `hydrateFromCloud`. Runs once per sign-in (and once on
  startup if already signed in), keyed on the authenticated user's id, gated on
  `auth.status === 'ready'` and `isSupabaseConfigured`. Acts on the result:
  - `hydrate-from-cloud`: dispatches the existing `LOAD` action into `AppContext` with the cloud
    data, then updates **device-local sync metadata only** (`markEstablished`,
    `setLastSyncedAt`, and `setRecordUpdatedAt` for every hydrated record, seeded from the
    `updatedAt` the repository layer returned) and persists it via
    `saveSyncMetadataStore`/`upsertAccountMetadata`. No Supabase call is made here — this is
    exactly the "how is `expectedUpdatedAt` first populated" open question BUILD_STATUS flagged
    for 5B1→5B2, answered without activating any write.
  - `cloud-query-failed`: local data is left completely untouched; status becomes `'error'` with
    the repository's own message, and a `retry()` re-runs the same attempt (exposed to
    `CloudSyncBanner`'s Retry button).
  - `require-explicit-choice` (both cloud and local have data, no established link — e.g. right
    after a Phase 5A migration, before this device is marked established): local data is left
    untouched; status becomes `'needs-choice'` with an explanatory message. Building the actual
    choice UI is out of scope here (`SUPABASE_IMPLEMENTATION_PLAN.md` already flagged this as
    undesigned) — this phase only guarantees it never guesses.
  - `sync-established` (both sides have data and this device was already established by a prior
    hydration): **not** re-hydrated automatically — re-pulling cloud data into local state on
    every open without any write-back could silently discard local edits made since the last
    hydration, which is exactly what "do not silently replace valid local data" rules out.
    Status becomes `'up-to-date'`; real reconciliation is 5B3's job.
  - `signed-out` / `both-empty` / `await-explicit-migration` (Phase 5A's existing migration
    territory): status `'idle'`, no dispatch, nothing else changes.
  - The effect is cancellation-guarded (`active` flag, matching `AuthContext`'s own pattern) so a
    hydration in flight when the component unmounts or the user changes again never applies late.
- [x] `src/components/CloudSyncBanner.tsx` — mounted once, globally, in `AppShell` (inside
  `main-content`, above every route's content). Renders nothing while idle; a loading message; a
  recoverable error with a Retry button; the needs-choice explanation; and — required by this
  plan's Phase 5B decision 12 ("hydration and live write activation must land together... or a
  prominent, visible safeguard") — a persistent notice shown whenever this device holds
  cloud-hydrated data without active write-back (`'hydrated'` or `'up-to-date'` status): *"Changes
  you make are saved on this device only — cloud sync writes are not active yet."* This is the
  concrete answer to decision 12 for this slice: rather than delay hydration until writes exist,
  hydration ships now with an always-visible safeguard.
- [x] Wired into `src/App.tsx` as `<CloudSyncProvider>` between `AppProvider` and `BrowserRouter`
  (it needs both `useApp()` and `useAuth()`, and both are already ancestors there).
  `AppContext`'s reducer, save behavior, `MigrationPanel`, Import, and Reset are all unchanged;
  Phase 5A's migration flow is untouched and still works exactly as before (including the
  now-realistic case where migration already ran and hydration correctly reports
  `require-explicit-choice` rather than re-uploading or re-downloading anything).
- [x] Tests: `src/sync/hydrateFromCloud.test.ts` (9 tests, repository functions mocked, no live
  network calls) — successful hydration with the cloud-only `updatedAt` correctly stripped from
  the applied `AppData` but preserved in the raw records returned for metadata seeding; both-empty;
  cloud-empty/local-populated (`await-explicit-migration`); both-populated without an established
  link (`require-explicit-choice`) and with one (`sync-established`) never returning hydrated
  data; a `database`-typed and an `unauthenticated`-typed repository failure both surfacing as
  `cloud-query-failed` without touching local data; and a dedicated test asserting the function
  takes no user-id parameter and never bleeds one mocked call's results into the next (stale/
  cross-user prevention). `src/store/CloudSyncContext.test.tsx` (6 tests, RTL, `AuthProvider` +
  `AppProvider` + `CloudSyncProvider` rendered together, Supabase auth and the three repository
  list functions mocked) — signed-out stays idle and never calls a repository function; a full
  successful hydration updates both `AppContext` state and device-local sync metadata
  (established + per-record `updatedAt`); both-empty does nothing; a cloud failure reports the
  error, leaves local data untouched, and Retry re-runs the attempt; both-populated/unestablished
  requires a choice without changing local data; and — the explicit cross-account case — signing
  into a second account on the same device, with the first account's data still local and no
  established link for the second account, never silently swaps in the second account's cloud
  data. `src/components/CloudSyncBanner.test.tsx` (6 tests) covers every status's rendered text,
  including that the local-only-edits safeguard appears for both `'hydrated'` and `'up-to-date'`.
  Total suite: 171 tests passing (up from 150 before this phase).
- [x] Confirmed via `npm run build`: `dist/assets/index-*.js` grew from 503.40 kB to 509.90 kB —
  expected and correct, since this is the first phase where `src/sync/` is actually imported by
  the shipped app (every prior phase confirmed the opposite: byte-for-byte no change).

**Not done in 5B2, by design/instruction:** no cloud write of any kind (no call to
`updateProjectGuarded`/`updateTaskGuarded`/`updateDailyNoteGuarded`, no `createX`/`upsertX` beyond
what Phase 5A's `MigrationPanel` already does); no "Sync now" manual action; no interactive
resolution UI for `require-explicit-choice`; no re-hydration/reconciliation once a device is
established; no per-record deletion/tombstones; no changes to the reducer, `storage.ts`,
Export/Import/Reset, or `MigrationPanel`.

**Manual verification still needed (cannot be done from this environment):** signing in with the
real, already-migrated production account (which — per the 2026-08-31 Phase 5A verification note
above — already has 4 projects, 9 tasks, and 3 daily notes in both places) and confirming the
banner shows the `'needs-choice'` message rather than silently reloading anything; and, separately,
creating a fresh test account with cloud data and an empty local browser profile to confirm the
`'hydrated'` path actually loads real data end-to-end against the production Supabase project.

### Phase 5B2 correction (2026-08-31, commit `bf7d967`) — previously undocumented

`DailyNotesView`'s autosave effect fires on mount regardless of whether the user has typed
anything, and `UPSERT_DAILY_NOTE` used to create a new record even when both fields were blank.
5B2's `hydrateFromCloud.ts` already worked around the *symptom* (a `meaningfulLocalCounts` filter
excluding blank notes from the hydration decision, so a residual blank note wouldn't wrongly make
a device look "populated" and block a safe cloud pull) — see the description under Phase 5B2 above.
This follow-up commit fixes the *cause* instead: `appReducer`'s `UPSERT_DAILY_NOTE` case now
returns `state` unchanged (no record created) when there is no existing note for that date and
both `morning`/`evening` are blank or whitespace-only. Clearing an *existing* note back to blank
remains a legitimate edit and is unaffected — only creating a new, still-blank record is refused.

- [x] `src/store/reducer.ts` — the no-op-on-blank-create guard described above.
- [x] Tests: `src/storage/storage.test.ts` gained 4 cases (blank upsert creates nothing;
  whitespace-only upsert creates nothing; a real-content upsert still creates normally; clearing an
  existing note back to blank still works and doesn't delete or restore it).
  `src/sync/hydrateFromCloud.test.ts` gained a regression test reproducing the reported scenario
  directly (a device whose only local data is a residual blank daily note still hydrates from a
  populated cloud account, rather than being treated as "both populated, needs a choice").
- [x] No change to `hydrateFromCloud.ts`'s own counting logic, `AppContext`, storage schema/version,
  or any other reducer action.

### Phase 5B3 — architecture revised; first sub-phase in progress

The single undifferentiated Phase 5B3 originally sketched below was superseded before any of it
was built: an architecture review identified that resolving the acting account from the live
Supabase session at call time (`getAuthenticatedSession()`, unchanged from Phase 4) leaves a real
window in which a queued write could be attributed to whichever account is live when it finally
runs, not the account whose edit it actually was. The approved revision splits 5B3 into three
sub-phases — 5B3A (account-affinity + provenance foundations, inert), 5B3B (manual "Sync now"
write-back, activated), 5B3C (interactive linking UI + signed-in Import cloud-push) — full
rationale in `SUPABASE_IMPLEMENTATION_PLAN.md` → "Phase 5B3". This section tracks 5B3A's progress;
5B3B and 5B3C are not started.

#### Phase 5B3A, task 1 of 3 — `getAuthenticatedSessionFor` account-affinity primitive (complete; inert)

The smallest independently-testable slice of 5B3A: the account-scoped session primitive itself,
added and tested in isolation, with **zero callers anywhere in the active application** — no
repository CRUD function was changed or rewired, no dirty tracking, provenance table, drain loop,
or UI was added. This mirrors 5B1's own pattern of landing a guarded primitive inert before any
later phase wires it in.

- [x] `src/repository/types.ts` — added `'account-mismatch'` to `RepositoryErrorType` (alongside
  the existing `'unconfigured' | 'unauthenticated' | 'database' | 'conflict'`). Confirmed (by
  search) that no code anywhere exhaustively switches on `RepositoryErrorType` — only `if
  (result.error.type === 'unauthenticated' || ... === 'unconfigured')`-style checks in
  `migration.ts` and `hydration.ts`'s `errorType` pass-through — so this is a non-breaking,
  additive change requiring no other update for type-safety.
- [x] `src/repository/session.ts` — added `getAuthenticatedSessionFor(expectedAccountId)` alongside
  (not replacing) the existing `getAuthenticatedSession()`. It reads the session exactly once via
  one `supabase.auth.getSession()` call, preserves the existing `unconfigured`/`database`/
  `unauthenticated` handling unchanged, and additionally compares the live session's `user.id`
  against `expectedAccountId` — a mismatch returns the new `'account-mismatch'` error before any
  table access is attempted. `expectedAccountId` is used for exactly one thing, that equality
  comparison; it is never sent to Supabase and never used to select or authorize an account —
  fail-closed, not fail-open.
  - **Why this closes the real gap, not just the obvious one:** a caller that checks "is the
    active account still A?" in React and then separately calls a repository function has a
    window between those two steps for a sign-out/different sign-in to land in — the repository
    function's own, later, independent session lookup would then resolve to the new account. The
    same gap exists one level deeper inside `supabase-js` itself: `auth.getSession()` and the
    token `postgrest-js` actually attaches to an outgoing request are two separate internal reads,
    moments apart. Comparing `expectedAccountId` against a session read is therefore not
    sufficient on its own — what closes the gap is that `getAuthenticatedSessionFor` returns an
    `AccountScopedSession.client`, a freshly constructed Supabase client (`createClient` with
    `global.headers.Authorization` pinned to the exact `access_token` from the one `getSession()`
    call just verified, and `auth: { persistSession: false, autoRefreshToken: false }` so it never
    persists to or reads from `localStorage` and never becomes a second, independently-mutating
    session). A later account-scoped repository call issued through that client cannot be
    re-pointed at a different account no matter what happens to the ambient `supabase` singleton's
    session afterward, because it never asks the ambient client for a token in the first place.
- [x] Tests: `src/repository/session.accountScoped.test.ts` (4 tests, `../lib/supabaseClient` and
  `@supabase/supabase-js`'s `createClient` both mocked, no live network calls) — matching account
  succeeds and returns a client that is a distinct object from the ambient mocked client, pinned
  to the verified `access_token` with `persistSession`/`autoRefreshToken` both `false`; a mismatched
  account returns `'account-mismatch'` and asserts neither `createClient` nor the ambient client's
  `from()` was ever called (no table/network access on mismatch); a missing session returns the
  existing `'unauthenticated'` result unchanged; a `getSession()` failure returns the existing
  `'database'` result unchanged. `src/repository/session.accountScoped.unconfigured.test.ts` (1
  test) — unconfigured Supabase returns the existing `'unconfigured'` result without attempting a
  network call, mirroring `session.unconfigured.test.ts`'s existing pattern.
- [x] Confirmed no active caller: `getAuthenticatedSessionFor` and `'account-mismatch'` each appear
  only in `session.ts`/`types.ts` and their own new test files (searched across `src/`) — nothing
  in `AppContext`, `CloudSyncContext`, any repository CRUD function, or any component references
  either. Confirmed via `npm run build`: `dist/assets/index-*.js` is **byte-for-byte identical**
  (same content hash, same 510,131 bytes) between a clean build of `bf7d967` and a clean build with
  this change applied — Rollup fully tree-shakes the new function, its message string, and its
  otherwise-unused `createClient`/pinned-client helper since nothing imports them, exactly like
  Phase 5B1's inert additions.
- [ ] Not done (by design — deferred to later 5B3A tasks and 5B3B/5B3C, per the approved
  revision): no repository CRUD function requires `expectedAccountId` yet; no dirty-tracking
  `markDirty` wiring or `ACTION_PROVENANCE` table; no sync-engine drain loop or generation/
  cancellation scaffold; no linking UI; no cloud write of any kind beyond what already exists.

### Phases 5B3B/5B3C, 6, 7 — not started

See `SUPABASE_IMPLEMENTATION_PLAN.md` for full detail. Phase 7's Vercel env var configuration and basic redirect verification are effectively done (see the production-auth confirmation note above); its "ordinary redeployment doesn't affect existing data" check is still open.

**Next recommended step (subject to review of this slice):** finish Phase 2's manual cross-account verification (still outstanding, independent of this work); manually verify 5B2 above against the production project; then continue 5B3A — requiring `expectedAccountId` on the mutating repository functions and adding the `ACTION_PROVENANCE`-driven dirty-marking, still inert — before 5B3B activates any write.

## Latest test results

```
npm run test
Test Files  23 passed (23)
Tests       185 passed (185)
```

(180 passed as of `bf7d967`, before this task's 5 new tests. The doc's previous "171 passed"
figure predated the `bf7d967` blank-note-fix commit's own 9 additional tests and was stale
independent of this task.)

## Latest build results

```
npm run build
tsc -b && vite build — success
dist/assets/index-Caou51tN.js   510.13 kB
```

(Confirmed byte-for-byte identical — same file hash, same 510,131 bytes — to a clean build of
`bf7d967` without this task's changes; see the 5B3A section above.)

## Lint

```
npm run lint — 0 errors (3 warnings: react-refresh/only-export-components on AppContext.tsx, AuthContext.tsx, and CloudSyncContext.tsx — all context+provider files by design)
```
