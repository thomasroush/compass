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
- [ ] **Deliberately deferred, not merely outstanding (reviewed 2026-09-01, still not performed as of Phase 5B3B below):** the manual cross-account verification pass (sign in as a second test account and confirm it cannot read/write the first account's rows, and that a signed-out request is rejected) called for in the plan's Phase 2 deliverables. The procedure itself was reviewed and documented (a Supabase SQL-editor session, simulating a second test account via `set local role authenticated; set local request.jwt.claim.sub = '<id>'`, plus a `set local role anon` signed-out check — no application code needed, no token ever handled) but **has not been executed against the live project**. Phase 5B3B (below) now activates real automatic cloud writes for ordinary signed-in edits, which makes this verification more important than ever — it remains explicitly scheduled as a manual, out-of-session step and was deliberately **not** run during 5B3B's implementation, per this session's own instruction. Do not read this as "already performed" — it has not been, and should be done against the live project before relying on RLS in production with real multi-device data.

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
5B3A is now complete (all three tasks); 5B3B and 5B3C are not started.

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

#### Phase 5B3A, task 2 of 3 — `expectedAccountId` required on mutating repository functions (complete)

`create*`/`update*`/`*Guarded`/`delete*` remain inert (zero application callers, as before).
`upsert*` is the one exception: it now has a real caller through Phase 5A's existing, already-
activated migration path — see the bundle-size note below. No other cloud-write path was
activated; migration's own behavior is unchanged, only *which account identity it pins to* is new.

- [x] `src/repository/projectsRepository.ts`, `tasksRepository.ts`, `dailyNotesRepository.ts` —
  `createX`, `updateX`, `updateXGuarded`, and `deleteX` now each take a required
  `expectedAccountId: string` parameter and resolve their session via
  `getAuthenticatedSessionFor(expectedAccountId)` instead of `getAuthenticatedSession()`. A
  mismatch between `expectedAccountId` and the live session now returns a typed
  `'account-mismatch'` error before any table access is attempted, for every one of these
  functions — fulfilling this session's fail-closed requirement for account identity.
- [x] `list*` functions are unchanged (read-only, per the plan's own scoping) and still use
  `getAuthenticatedSession()`.
- [x] **`upsertProject`/`upsertTask`/`upsertDailyNote` are now scoped too** — the earlier revision
  of this section excluded them because they are Phase 5A migration's only write path
  (`src/repository/migration.ts`), called synchronously within one user action, and changing their
  signature meant changing `migration.ts`'s calls. That exclusion has been closed: all three now
  require `expectedAccountId` and route through `getAuthenticatedSessionFor`, exactly like every
  other mutating function in this task. **No `upsert*` exception remains for Phase 5B3A task 2.**
- [x] `src/repository/migration.ts` — `runMigration(local, expectedAccountId)` now takes the
  account id as a required second parameter and passes it unchanged to every `upsertProject`/
  `upsertTask`/`upsertDailyNote` call. This is **not** re-derived from a fresh
  `getAuthenticatedSession()` call inside `migration.ts`, and **not** read from any field on the
  records being migrated — it is the exact account id the calling UI's own already-authenticated
  render established. The existing "stop immediately, don't touch the rest" behavior for
  `'unauthenticated'`/`'unconfigured'` upsert failures now also covers `'account-mismatch'`: if the
  live session no longer matches `expectedAccountId` partway through a multi-record migration (a
  sign-out/different sign-in racing the upload loop), the affected write never happens, migration
  stops there with `authError` set, and no verification re-read is attempted — matching the
  existing philosophy for every other auth-type failure, never a partial silent success.
- [x] `src/components/MigrationPanel.tsx` — the sole caller of `runMigration`, updated to pass
  `auth.user.id` (captured into a local `accountId` right after the panel's existing
  `if (!auth.user) return …` guard, so it's available inside the `confirmMigration` closure). This
  is the same identity the panel already displays and the user already confirmed against
  ("Signed in as {auth.user.email}") before this point — not a new lookup, not a value taken from
  local data. No other line in `MigrationPanel.tsx` changed: same steps (`idle` → `checking` →
  `confirming` → `migrating` → `result`), same eligibility gate, same dialog copy, same retry
  behavior (closing the result view and reopening the panel still re-runs the same flow), same
  `MigrationOutcome` shape consumed identically by the result view.
- [x] Confirmed no application code outside `src/repository/*.ts` and `migration.ts`/
  `MigrationPanel.tsx` (excluding tests) calls any of the now-scoped functions.
  `getAuthenticatedSessionFor` now has its **first** real application caller — via migration's
  `upsertX` calls — so, unlike every prior inert-primitive phase, the production bundle is **not**
  byte-for-byte unchanged this time: `npm run build` grew from 510.13 kB to 510.78 kB
  (`dist/assets/index-CIBzSJyq.js`). This is expected and correct: the pinned-client construction
  logic inside `getAuthenticatedSessionFor` (previously fully tree-shaken, since nothing imported
  it) is now reachable from the shipped app through `migration.ts`, which `MigrationPanel.tsx`
  already imports. No other application behavior changed — the size increase is attributable
  entirely to this one previously-dead code path becoming live.
- [x] Tests: each repository test file gained one `'account-mismatch'` case per changed function,
  including the three `upsert*` functions (15 new repository tests total, matching-account cases
  updated to pass `expectedAccountId`). `src/repository/migration.test.ts` gained a
  `'runMigration — account-affinity pinning'` describe block with two tests: the validated account
  id is passed to every `upsertX` call (never derived from the records) on a successful migration,
  and an account-mismatch on a later record stops the migration immediately (`authError` set,
  already-uploaded records still reported as uploaded, nothing after the mismatch attempted, no
  verification re-read) without discarding what already succeeded. `src/components/
  MigrationPanel.test.tsx`'s existing "only calls runMigration after explicit confirmation" test
  now also asserts the exact `(state, accountId)` arguments. 202 tests passing (up from 185 before
  Phase 5B3A task 2, 197 after its first slice, 202 now that the `upsert*` exception is closed).
- [ ] Not done (by design — deferred to 5B3A task 3 and 5B3B/5B3C): no dirty-tracking `markDirty`
  wiring or `ACTION_PROVENANCE` table; no sync-engine drain loop or generation/cancellation
  scaffold; no linking UI; still no cloud write of any kind beyond Phase 5A's existing migration
  path — `create*`/`update*`/`*Guarded`/`delete*` still have zero application callers, and
  migration's behavior, sequencing, UI, eligibility checks, and completion state are all unchanged.

#### Phase 5B3A, task 3 of 3 — dirty-tracking and sync-engine generation/cancellation scaffold (complete; inactive)

The last of 5B3A's three tasks: an exhaustive action-provenance classification, in-memory-only
dirty marking wired into `AppProvider`'s dispatch, and an in-memory generation/cancellation
counter. Lands the same way every other 5B3A piece did — built, wired to real dispatch (unlike
tasks 1–2, this one genuinely runs on every dispatch now, not just an inert unused function), and
tested — but produces **no cloud write of any kind**, no drain loop, no retry, no timer, no network
call, and no UI change. `localStorage` persistence (`flushSave` on every state change) is completely
unchanged and remains the sole thing that actually happens on a dispatch, behavior-wise.

- [x] `src/sync/actionProvenance.ts` — `classifyActionProvenance(action): 'user-edit' | 'sync-boundary'`,
  an exhaustive switch over every `AppAction['type']` with a `never`-typed `default` branch, so a
  new action type added later without a case here fails the build (decision 14's compile-time
  exhaustiveness guard). `ADD_TASK`/`UPDATE_TASK`/`COMPLETE_TASK`/`UNCOMPLETE_TASK`/`ARCHIVE_TASK`/
  `SET_PRIMARY`/`POSTPONE_DUE`/`POSTPONE_TO_WEEK`/`REORDER_TASK`/`ADD_PROJECT`/`UPDATE_PROJECT`/
  `UPSERT_DAILY_NOTE` are `'user-edit'`; `LOAD`/`IMPORT`/`RESET`/`APPLY_REMOTE_UPDATE` are
  `'sync-boundary'`.
- [x] `src/store/reducer.ts` — added `APPLY_REMOTE_UPDATE` (the fourth sync-boundary action decision
  14 calls for, the future counterpart to `LOAD` for pulled-down reconciliation once Phase 5B3B's
  drain loop exists; same "replace state wholesale" semantics as `LOAD`/`IMPORT`, not dispatched
  from anywhere yet). Also added an optional `id?: string` to `ADD_TASK`/`ADD_PROJECT`/
  `UPSERT_DAILY_NOTE` — when supplied, the reducer uses it instead of generating its own; when
  omitted (every existing call site, unchanged), behavior is byte-for-byte identical to before.
  This exists so `AppContext`'s dispatch wrapper can generate a record's id *before* dispatch and
  use that same id both for what gets persisted and for what gets marked dirty, rather than calling
  the reducer a second time to "peek" at a created id (which — a real bug caught during this task's
  design, not shipped — would silently produce two different records, since `ADD_TASK`/
  `ADD_PROJECT`/`UPSERT_DAILY_NOTE`'s id and timestamp generation is not actually a pure function of
  their arguments alone).
- [x] `src/sync/actionProvenance.ts` also exports `resolveDirtyTargets(action, prevState):
  { entity: SyncEntity; id: string }[]` — resolves which record(s) a `'user-edit'` action should
  mark dirty, using only the action's own fields (an id it already carries, or the id `AppContext`
  pre-generated for a creation action) and a same-tick read of `prevState`, never the reducer and
  never a before/after diff. Mirrors the reducer's own no-op guards (blank title/name/note content,
  and — for every id-targeting action — the id must already exist in `prevState`) so a refused edit
  is never marked dirty.
- [x] `src/sync/generation.ts` — `createSyncGeneration()`: a tiny in-memory monotonic counter
  (`current()`/`isCurrent(g)`/`invalidate()`). Stubbed — nothing calls `current()`/`isCurrent()` for
  a real purpose yet; Phase 5B3B's drain loop is what will actually check it between network calls.
- [x] `src/store/AppContext.tsx` — `AppProvider` now calls `useAuth()` (safe: `AuthProvider` already
  wraps `AppProvider` in `App.tsx`, and the only other place `AppProvider` is rendered,
  `CloudSyncContext.test.tsx`, already wraps it in `AuthProvider` too) and wraps `useReducer`'s raw
  dispatch in a stable (`useCallback`, empty deps, state/account read via refs — matching
  `CloudSyncContext`'s existing `stateRef` pattern so `dispatch`'s identity never changes) function
  that, per dispatched action:
  - Pre-generates an id for `ADD_TASK`/`ADD_PROJECT`/`UPSERT_DAILY_NOTE` when the caller didn't
    supply one (every existing call site), via the same `generateId()` already exported from
    `src/types.ts`, and injects it into the action before anything else runs.
  - Classifies the action via `classifyActionProvenance`. For `'user-edit'`: if signed in
    (`auth.isSupabaseConfigured ? auth.user?.id : null`, non-null), calls `resolveDirtyTargets` and
    `markDirty` (from the existing `src/sync/metadata.ts`) against that account's
    `AccountSyncMetadata` bucket in an **in-memory-only** `SyncMetadataStore` — never read from or
    written to `daily-compass-sync-v1` here, starts empty every session, so it cannot drift from or
    clobber what `CloudSyncContext`'s hydration flow separately persists there, and there is nothing
    to lose by keeping it in-memory at this stage since nothing yet drains it. Signed out is a
    structural no-op (the `if (currentAccountId)` guard, not a separate flag).
  - For `'sync-boundary'` actions: never calls `markDirty` — `LOAD`/`APPLY_REMOTE_UPDATE` (the
    cloud/hydration paths) are excluded from dirty-marking by construction, not by a runtime check,
    so they cannot create a feedback loop (mark dirty → drain loop pushes it back → hydration pulls
    it down → marked dirty again) even once a drain loop exists later.
  - Additionally invalidates the generation counter for `RESET` and `IMPORT` specifically (not every
    sync-boundary action — `LOAD`/`APPLY_REMOTE_UPDATE` are expected, first-class parts of the sync
    system's own flow and must not cancel themselves).
  - A separate `useEffect` keyed on the resolved account id invalidates the generation whenever it
    actually changes (covers both sign-out, which changes it to `null`, and switching to a
    different account) — skipping the initial mount so starting up already signed in isn't treated
    as a spurious "change."
  - A cleanup-only `useEffect` (empty deps) invalidates the generation on `AppProvider` teardown.
- [x] Confirmed no application path calls a repository `create`/`update`/`delete`/`upsert` function
  as a result of any of this — searched for new callers of those functions outside
  `src/repository/*.ts`, `migration.ts`, and their tests; only Phase 5A's migration path exists, as
  before. This task adds bookkeeping about *what would need to sync*, never a call that actually
  syncs it.
- [x] **Cascading-mutation correction (2026-09-01, before this task was ever committed):** the first
  pass of this task shipped two documented imprecisions — `REORDER_TASK`'s swap partner and
  `enforcePrimaryCap`'s demotions weren't separately marked dirty. Both are now fixed, in
  `src/sync/actionProvenance.ts`:
  - `REORDER_TASK` independently recomputes the reducer's own column/index/swap-partner logic
    (reusing the already-exported `getTasksByStatus`, never the reducer itself) directly from
    `prevState`, and marks both the acted-on task and its swap partner — or neither, when the
    reorder is at a column boundary and the reducer itself would no-op.
  - A new `primaryCapDemotions` helper reuses the reducer's own, now-exported `enforcePrimaryCap`
    (a pure, side-effect-free function — reusing it is safe in a way calling `appReducer` itself
    is not, since it generates no id or timestamp) against a shadow copy of `prevState.tasks` with
    only the acted-on task's resulting `status`/`isPrimary`/`archived` patched in, and marks any
    *other* task it demotes. Called only from `UPDATE_TASK` and `SET_PRIMARY`'s
    "task not currently Today" branch — the only two paths that can ever *increase* the
    Today-primary count (see the next bullet for why every other task action is provably safe
    without this check).
  - **Reviewed every user-edit action for other cascading changes; found none beyond these two.**
    `COMPLETE_TASK`/`UNCOMPLETE_TASK`/`ARCHIVE_TASK`/`POSTPONE_DUE`/`POSTPONE_TO_WEEK` each delegate
    to a fixed, hardcoded `UPDATE_TASK` payload that can only ever *remove* Today-primary status (or
    leave it unchanged) from the one task they name, never grant it to that task or touch any
    other — so none of them can trigger a demotion, by construction, not by observation. `ADD_TASK`
    always creates with `isPrimary: false`. `ADD_PROJECT`/`UPDATE_PROJECT` never touch `state.tasks`
    at all (project archival/completion does not cascade to its tasks in this reducer — there is no
    project-deletion action client-side to raise the schema's `on delete set null` concern either).
    `UPSERT_DAILY_NOTE` only ever touches the one note it names. This review is documented here so
    it doesn't need re-deriving if `resolveDirtyTargets` is revisited later.
  - Also fixed in the same pass: `SET_PRIMARY`'s exclusion rule now also refuses an archived target
    task, matching the reducer's own `if (!task || task.archived) return state;` guard (the prior
    version only checked existence, not archived status).
- [x] Tests (59 new; suite total 261, up from 202): `src/sync/actionProvenance.test.ts` (38) —
  every `AppAction` type's classification (including a test that the two lists partition all 16
  current variants with no overlap and no gap), dirty-target resolution for every user-edit action
  type (including the existing-note-reuses-its-own-id case for `UPSERT_DAILY_NOTE`), exclusion
  rules (blank title/name/note content, a target id absent from `prevState`, every sync-boundary
  action always resolving to no targets regardless of payload), and a dedicated cascading-changes
  group: both sides of an adjacent reorder marked; the correct column-adjacent partner found even
  when other-status tasks sit between the two in raw array order (proving the resolution isn't
  relying on array adjacency); a boundary reorder (no partner) excluded; a plain primary selection
  with no demotion needed; a fourth task promoted via `SET_PRIMARY` correctly demoting exactly the
  highest-sortOrder existing primary (not the other two, and not itself a second time); the same
  scenario reproduced via a direct `UPDATE_TASK` dispatch (proving the cascade isn't
  `SET_PRIMARY`-specific plumbing); no extra demotion when the cap isn't exceeded; `SET_PRIMARY`
  excluded at an already-full cap and on an archived task; and confirmation that
  `COMPLETE_TASK`/`ARCHIVE_TASK`/a status-only `UPDATE_TASK` never mark a second task even when
  other Today-primaries exist. `src/sync/generation.test.ts` (5) — starts at 0, `invalidate()`
  increments and returns the new value, a captured generation is no longer current after
  invalidation, monotonic across repeated invalidations, and two instances never interfere.
  `src/store/AppContext.test.tsx` (10, RTL, new file, `markDirty`/`createSyncGeneration`
  spy-wrapped over their real implementations so genuine behavior is preserved while calls are
  observable) — signed-out dispatch never marks anything dirty; a signed-in `ADD_TASK` marks
  exactly the id that actually lands in state dirty, once; `LOAD` never marks anything dirty even
  though it replaces all of state; `RESET`/`IMPORT` each invalidate the generation once; `LOAD` and
  an ordinary user edit do not; signing in, switching to
  a second account, and signing out each invalidate the generation; unmounting invalidates the
  generation. `src/storage/storage.test.ts` gained 6 cases for the reducer-level changes (a
  caller-supplied id is used for `ADD_TASK`/`ADD_PROJECT`/`UPSERT_DAILY_NOTE` when given, `ADD_TASK`
  still generates its own when not, an existing daily note keeps its own id rather than adopting a
  caller-supplied one meant only for the create case, and `APPLY_REMOTE_UPDATE` replaces state
  wholesale exactly like `LOAD`/`IMPORT`).
- [x] Confirmed via `npm run build`: `dist/assets/index-*.js` grew from 510.78 kB to 514.42 kB —
  expected, since this task's new modules (`src/sync/actionProvenance.ts`, `src/sync/generation.ts`)
  are genuinely imported by the shipped app for the first time (via `AppContext.tsx`, which every
  view already depends on), unlike tasks 1–2's previously-dead code becoming reachable. The
  cascading-mutation correction above added further reachable code to
  `src/sync/actionProvenance.ts` (up from 513.24 kB before that correction).
- [ ] Not done (by design — deferred to 5B3B/5B3C, per the approved revision): no drain loop, no
  retry/backoff, no timers, no network listeners, no "Sync now" UI, no cloud hydration change, no
  sync-status UI beyond what `CloudSyncBanner` already showed before this task, no persistence of
  dirty state to `daily-compass-sync-v1`, and — per this session's explicit instruction — the
  Phase 2 manual cross-account RLS verification remains un-executed, deliberately scheduled for
  immediately before 5B3B activates the first real write (see the Phase 2 section above).

### Phase 5B3B — account-bound cloud write-back (complete)

The first phase to activate real, automatic cloud writes for ordinary signed-in edits. Explicitly
scoped by this session to *not* include login gating or startup cloud hydration (5B2's existing
hydration is unchanged) and *not* to add Supabase Realtime — those, plus the interactive
`require-explicit-choice` linking UI and signed-in Import cloud-push, remain 5B3C's job.

**Architecture.** Two new layers, plus durable persistence added to the dispatch wrapper Phase
5B3A built:

- `src/sync/drainSync.ts` — `drainDirtyWork(accountId, isGenerationCurrent, getLocalState)`: one
  drain *pass* over every currently-dirty id for one account, in `project` -> `task` -> `dailyNote`
  order. For each id it re-loads `daily-compass-sync-v1` fresh, decides create-vs-update from
  whether a `records[entity][id].lastKnownUpdatedAt` is already known (unknown -> `createX`; known
  -> `updateXGuarded` with that exact value as `expectedUpdatedAt`), builds the payload from
  whatever the local record's fields currently are (never a stored per-operation diff), calls the
  matching Phase 5B3A account-scoped repository function, and durably patches metadata (one small
  read-patch-save, never a batch spanning an `await`) the instant the outcome is known — success
  clears dirty and advances `lastKnownUpdatedAt`; every other outcome leaves the record dirty.
  Checks `isGenerationCurrent()` before every id and stops the pass (without throwing) the instant
  it returns false, on any account-level error (`unauthenticated`/`unconfigured`/`account-mismatch`
  — the whole account context is suspect, so the rest of the pass is skipped too, not just that
  id), or on the first thrown/rejected (network-level) failure, which is caught here so one offline
  moment can't escape as an unhandled rejection.
- `src/store/SyncEngineContext.tsx` (`SyncEngineProvider`, via `src/store/useSyncEngine.ts`) — owns
  *when* to call `drainDirtyWork`: single-flight (an in-flight drain absorbs a concurrent trigger
  into one guaranteed rerun immediately after, rather than starting a second overlapping pass),
  bounded exponential backoff on a network-level failure (documented below), and the minimal
  `SyncStatus` (`'idle' | 'pending' | 'syncing' | 'synced' | 'conflict' | 'offline' | 'error'`)
  this phase calls for — always derived fresh from the durable dirty count for the signed-in
  account (never an independently-tracked boolean), so it structurally cannot claim `'synced'`
  while pending work remains. Triggers a drain automatically whenever local state changes while
  signed in (covers every accepted user edit) and whenever an authenticated session becomes
  available (covers sign-in with pre-existing dirty work, e.g. from a previous offline session).
  Exposes `syncNow()` — decision 7's manual "Sync now" action — which is a no-op while signed out
  and otherwise just calls the same `attemptDrain`, safely coalescing with the single-flight guard
  if one is already running.
- `src/components/SyncStatusPanel.tsx` — mounted in Settings, between `AccountPanel` and
  `MigrationPanel`. Plain text per status plus the pending count and the "Sync now" button; renders
  nothing while signed out or unconfigured, matching every other cloud panel in Settings. No
  emojis, no new colors or decorative elements — reuses the existing `message`/`message error`/
  `section-help` classes.
- `src/store/AppContext.tsx` — the dispatch wrapper's dirty-marking is now durable: it loads
  `daily-compass-sync-v1` fresh, marks dirty, and saves immediately on every dirty-producing
  dispatch (previously in-memory-only, per Phase 5B3A task 3's explicit "not at this stage" note —
  this is that later stage). `RESET`/`IMPORT` now also clear the *entire* dirty set for the
  currently-authenticated account (new `clearAllDirty` in `src/sync/metadata.ts`) — a wholesale
  local replacement leaves nothing meaningful behind for the old dirty ids to push, and doing this
  at the dispatch site (not the drain loop) keeps it correct even if no drain ever runs again. Only
  the *active* account's bucket is touched; a different account's dirty work is never affected by
  an action that happens while it isn't the signed-in account. `syncGeneration` (built inert in
  5B3A) is now exposed on `AppContextValue` so `SyncEngineContext` can check it.
- **A real bug found and fixed during this phase's own testing:** the account-change
  generation-invalidation effect (5B3A) originally invalidated on *any* transition, including
  signing in from signed-out (`null` -> a real account). Since `SyncEngineContext`'s own
  auto-drain-on-sign-in effect fires from that exact same transition, in the same render, the
  freshly-started drain's own captured generation was invalidated by the sign-in that triggered it,
  self-cancelling every automatic post-sign-in drain before it could apply its result. Fixed to
  invalidate only when there *was* an active account whose work could be stale — a real
  account-to-different-account switch, or a real account to signed-out — never on sign-in itself,
  since nothing runs while signed out for there to protect against. `AppContext.test.tsx`'s
  generation test for this case was itself testing the old, buggy expectation and has been
  corrected alongside the fix.

**Durable sync-metadata format.** Unchanged from Phase 5B1/5B3A's `SyncMetadataStore` under
`daily-compass-sync-v1` — no schema migration needed. `AccountSyncMetadata.dirty: Record<SyncEntity,
string[]>` remains a de-duplicated *set* of ids per entity, not a queue of operations: this is
deliberate and is what makes coalescing free — a record dirtied by several rapid edits appears once,
and because the drain loop always reads the record's *current* local content immediately before
sending (never a stored snapshot from when it was first marked dirty), whatever the latest,
converged local state is at drain time is exactly what gets pushed, with no separate merge or
replay logic required. `AccountSyncMetadata.records: Record<SyncEntity, Record<id,
{lastKnownUpdatedAt}>>` is what distinguishes "never confirmed to exist in the cloud" (id absent —
`createX`) from "confirmed cloud version known" (id present — `updateXGuarded`), so a brand-new
local record is never mistaken for a guarded update against a row that doesn't exist yet.

**Create / update / conflict / retry behavior.**
- *Create*: unknown record -> `createX(record, accountId)`. If it fails with a database error whose
  message matches a duplicate-key pattern (the realistic case: a record already pushed by Phase 5A
  migration, edited before this device ever hydrated/learned its cloud `updatedAt`) — falls back to
  the existing `listX()` read (not a new repository function; `list*` was already exempt from
  Phase 5B3A's `expectedAccountId` requirement), adopts the found row's `updatedAt` into
  `records[entity][id]`, and leaves the record dirty so the *next* pass correctly takes the
  guarded-update path instead of failing the same way forever.
- *Update*: known record -> `updateXGuarded(id, updates, expectedUpdatedAt, accountId)` with
  `expectedUpdatedAt` taken verbatim from `records[entity][id].lastKnownUpdatedAt` and `updates`
  built from every current mutable field (a full-record push), not a stored diff.
- *Conflict*: `updateXGuarded` returning a typed `'conflict'` leaves the record dirty and does
  **not** advance `lastKnownUpdatedAt` (so a stale guarded update is never silently retried against
  the same stale baseline) and does **not** force an unconditional overwrite — matches decision 15
  exactly. The pass continues to the next dirty id rather than stopping; a `'conflict'` status is
  reported, and resolving it is 5B3C's interactive-linking job, out of scope here.
- *Retry*: only a thrown/rejected (network-level) failure schedules an automatic retry — a
  structured `{ok:false, error:{type:'database'}}` response (the server itself responded) is
  treated as not blindly retryable and is left for the next *natural* trigger (another edit,
  sign-in, or "Sync now"), never a timer. **Bounded backoff policy** (`SyncEngineContext.tsx`):
  `2000ms * 2^attempt`, capped at `30000ms`, for up to 5 consecutive network failures; the attempt
  counter resets to zero the moment any pass completes without one. After 5, automatic retry stops
  — never an infinite rapid loop — and only a natural trigger tries again.

**Account-switch and cancellation guarantees.** Every repository call still goes through Phase
5B3A's `getAuthenticatedSessionFor(expectedAccountId)` — `expectedAccountId` is always the account
the dirty work is durably filed under (`daily-compass-sync-v1`'s own keying), never derived from a
record or read back from `localStorage` as authority. The drain loop checks the generation between
every network operation (never during one) and stops promptly — without attempting to cancel a
request already sent — on sign-out, an account switch, `RESET`, `IMPORT` (all bump the generation
in `AppContext.tsx`), or `SyncEngineProvider`'s own teardown (which also clears any scheduled retry
timer directly, independent of generation). A stale drain's result is discarded, not applied, if
the generation moved on while it was in flight (checked again immediately after the drain resolves,
before touching any UI state). Two accounts' dirty queues never cross-contaminate: each is a
separate bucket in the same durable store, and a drain for account A only ever reads/writes A's
bucket.

**Status visible to the user.** `SyncStatusPanel` in Settings, signed-in only: *"Local changes
pending — waiting to sync to your account,"* *"Syncing changes to your account…,"* *"All changes
are synced to your account,"* a conflict/offline/error message (with the pending count shown
whenever it's nonzero), and a "Sync now" button (disabled only while actively syncing). No
emojis, no progress bars, no per-record UI — the minimal set this phase calls for.
`CloudSyncBanner`'s pre-existing "changes are saved on this device only" safeguard (Phase 5B2,
governed by decision 12) is removed for the `'hydrated'`/`'up-to-date'` states: it would now be
false, since write-sync is live for a signed-in device. Decision 12 required hydration and write
activation to land together or the safeguard to stay — they have now landed together.

**Every application path that can now write to Supabase:** exactly one — `SyncEngineContext`'s
`attemptDrain` -> `drainDirtyWork` -> the Phase 5B3A account-scoped `createX`/`updateXGuarded`
functions, triggered only by (a) a dirty-producing dispatch while signed in, (b) an authenticated
session becoming available, or (c) the "Sync now" button. Phase 5A's migration path
(`upsertX`, gated behind its own explicit user confirmation) is unchanged and independent.
`create*`(unguarded)/`update*`(unguarded)/`delete*`/`*Guarded`-for-conflict-resolution and the
`deleteX` functions still have no application caller — no per-record deletion or tombstone sync
exists (decision 8), matching the app's existing archive-only "remove" gesture.

**Tests (98 new across the initial implementation and the correction above; suite total 325, up
from 261):** `src/sync/drainSync.test.ts` (23) — create path with the exact `accountId`; update
path with the known `expectedUpdatedAt` and a full-record payload; never mistaking a new record for
a guarded update; coalescing (a create-then-rapid-updates scenario, a known-record rapid-updates
scenario, and an edit landing mid-flight that keeps the record dirty while still advancing the
baseline); conflict (leaves dirty, doesn't advance the baseline, continues to the next id); every
account-level error type stopping the whole pass immediately with no further ids attempted; a
thrown network failure classified distinctly, stopping the pass, leaving the record dirty; one
record's database error never falsely clearing an unrelated record's dirty flag; a missing local
record cleared instead of retried forever; the generation check stopping before the next id;
durability across a simulated reload; project-before-task-before-dailyNote ordering; and, from the
Risk 1 correction, the full duplicate-create resolution table (identical content clears dirty and
adopts the real `updated_at`; different content stays dirty, reports a conflict, and never adopts a
baseline; an unconfirmable duplicate stays dirty without guessing; the same resolution applied to
projects and daily notes; and a generic `'database'` error with duplicate-sounding text is *not*
misclassified, proving the typed check replaced the message match rather than supplementing it).
`src/store/SyncEngineContext.test.tsx` (19) — automatic draining on session-available and on a
signed-in edit, never while signed out; single-flight; bounded retry; status never reporting
`'synced'` with pending work still durable; cancellation on sign-out/`RESET`/unmount; manual "Sync
now" as a no-op while signed out; and, from the Risk 2 correction, a full account-linking-gate
group: an unlinked signed-in device never calls `drainDirtyWork` even with pending work and reports
`'unlinked'`; dirty-marking still saves durably while unlinked; "Sync now" cannot bypass the gate;
becoming linked (e.g. by a simulated completed migration) makes the device eligible without needing
to sign out and back in; switching to a different, unestablished account requires that account's
own linkage; and a previously-established account's linkage is confirmed to never authorize a
different, currently signed-in account's writes. `src/components/SyncStatusPanel.test.tsx` (14, new
file) — visibility while signed out/unconfigured; every status's wording, with particular attention
to `'unlinked'`'s distinct copy; the pending count; and that the "Sync now" button is disabled (not
just functionally refused) while unlinked or already syncing, and enabled once linked and idle.
`src/components/MigrationPanel.test.tsx` gained the migration-side half of the linking gate (+2): a
fully verified migration marks the account established; a partial failure does not.
`src/store/CloudSyncContext.test.tsx`'s both-empty test was extended to also assert established
becomes true (no new test, updated assertion). `src/repository/*Repository.test.ts` each gained a
typed-`'duplicate'`-classification test (+3) alongside their existing generic-database-error test
(retitled for clarity, not behavior). `src/store/AppContext.test.tsx` gained the
sign-in-vs-account-switch generation split described above (net +1). `src/sync/metadata.test.ts`
gained `clearAllDirty`/`hasDirtyWork`/`countDirty` coverage (+2).

**Confirmed via `npm run build`:** the bundle grew from 514.42 kB to 524.07 kB (523.69 kB before the
correction below) — expected, since this phase's new modules (`drainSync.ts`,
`SyncEngineContext.tsx`, `SyncStatusPanel.tsx`) are genuinely imported by the shipped app for the
first time, and Phase 5B3A's previously-dead `createX`/`updateXGuarded` functions become reachable
for the first time too.

**Correction (2026-09-01, before this phase was ever committed) — two correctness gaps found and
fixed during focused review, before acceptance:**

- **Risk 1, duplicate-create recovery.** The original implementation detected a duplicate-id
  `createX` failure by regexing the error's free-text message, then unconditionally adopted the
  cloud row's `updated_at` and left the record dirty for "a guarded update next time" — without
  ever checking whether the cloud row's *content* actually matched what this device wanted to
  write. That would have let a genuinely different pre-existing cloud record (e.g. from Phase 5A
  migration, containing another device's edits this device never saw) silently become the baseline
  for a *future* guarded overwrite, which is exactly the unconditional-overwrite decision 15
  forbids — discovering a timestamp is not permission to use it. Fixed in `src/sync/drainSync.ts`:
  - The repository layer now classifies a `createX` failure as a typed `'duplicate'`
    `RepositoryErrorType` from Postgres's own stable `23505` (`unique_violation`) error code (added
    to `RepositoryErrorType`; `createProject`/`createTask`/`createDailyNote` in
    `src/repository/*Repository.ts` each check `error.code === '23505'`), replacing the fragile
    message-pattern match entirely — not layered alongside it.
  - A new `resolveDuplicateCreate` re-reads the existing cloud row (via the pre-existing `listX`,
    still no new repository function) and compares its *actual content* (ignoring `updated_at`) to
    the current local record. Identical content — the realistic "create succeeded but the response
    was lost" case — is now safely recognized as synced: the real `updated_at` is adopted and dirty
    is cleared, because nothing was actually left unsynced. Different content leaves the record
    dirty, reports a `'conflict'` outcome, and — critically — never calls `setRecordUpdatedAt`, so
    no future pass can take the "known baseline" guarded-update path against a timestamp that was
    only ever discovered, never confirmed as this device's own prior write. Resolving that case is
    explicitly left to Phase 5B3C's future linking/conflict UI.
- **Risk 2, pre-link automatic writes.** The original implementation drained any signed-in
  account's dirty work automatically, with no check that this device had ever been through an
  approved account-link decision first — meaning a browser that merely signed in, with pre-existing
  local data never confirmed to belong to that account, could have had that data auto-created in
  the cloud with no user confirmation, contradicting decision 9 ("never guess, never auto-upload")
  as directly as an unconditional overwrite would. Fixed by adding a durable account-linking gate
  that reuses `AccountSyncMetadata.established` — the exact flag Phase 5B1/5B2 already defined and
  Phase 5B2's hydration already sets on a successful `'hydrate-from-cloud'` — rather than inventing
  a new format:
  - `src/components/MigrationPanel.tsx` now also marks the account established immediately after a
    **fully successful and verified** migration (`result.ok`, never a partial failure) — completed
    migration is one of the plan's own approved link decisions.
  - `src/store/CloudSyncContext.tsx` now also marks established on the `'both-empty'` hydration
    decision — nothing exists on either side to conflict, so it is safe to link immediately rather
    than leaving a brand-new account permanently unable to auto-sync until it happens to run a
    migration with something in it (one of "another explicit account-link decision defined by the
    plan").
  - `src/store/SyncEngineContext.tsx`'s `attemptDrain` — the single point every trigger funnels
    through, including `syncNow()` — now checks `established` for the exact signed-in account
    first, before anything else, and refuses (no `drainDirtyWork` call, status `'unlinked'`) if it
    is not true. Local edits still save immediately and still mark dirty durably while unlinked
    (local-first is preserved; nothing about dirty-tracking itself makes a network call), they are
    simply never drained until linked. A new `'unlinked'` `SyncStatus` reports this distinctly from
    `'synced'`; `SyncStatusPanel`'s "Sync now" button is disabled while unlinked, on top of the
    functional gate, so the UI itself never offers a control that would silently do nothing.
  - Because `established` is keyed per-account in the existing `SyncMetadataStore`, switching to a
    *different* signed-in account on the same device automatically requires that account's own
    linkage — a previous account's established flag never leaks into authorizing a different
    account's writes; no additional cross-account logic was needed.

**Not done in 5B3B, by design/instruction:** no login gating, no startup cloud hydration change
beyond the `'both-empty'` linking addition above, no Supabase Realtime, no interactive
conflict/linking UI (5B3C — this is exactly what a `'conflict'` status from either a guarded-update
version conflict or a duplicate-content conflict is left waiting for), no signed-in Import
cloud-push (5B3C), no per-record deletion or tombstone sync (decision 8), and no manual two-account
RLS verification against the live project (deliberately left deferred and undone — see the Phase 2
section above).

**Manual verification still needed (cannot be done from this environment):** the Phase 2
cross-account RLS check (see above); and, once that's done, exercising a real signed-in edit ->
automatic sync -> second-device confirmation end-to-end against the production Supabase project.

**Next recommended step (subject to review of this slice):** Phase 5B3B, including the Risk 1/Risk 2
correction above, is complete and ready for acceptance review. Run the Phase 2 manual cross-account
RLS verification against the production project before relying on this in a multi-device setting;
then begin Phase 5B3C (interactive `require-explicit-choice` linking UI, decision 15's three-choice
resolution, and signed-in Import cloud-push — this is also where an actual duplicate-content
conflict, or a version conflict, gets a real resolution path instead of staying dirty indefinitely)
— or, per this session's stated broader goal, the login-gating and startup-hydration work
explicitly out of scope for 5B3B.

### Phase 5B3C — Login-first gate + cross-device cloud sync (complete)

Built directly on 5B3B's write engine and 5B2's hydration/decision table, with no parallel systems:
the account-linking gate (`AccountSyncMetadata.established`), `decideHydration`'s decision table, and
`drainDirtyWork`'s conflict/duplicate resolution are all reused unchanged.

- **Login-first gate.** `src/App.tsx`'s new `AuthGate` wraps the existing route tree: while Supabase
  is configured, `auth.status === 'loading'` renders `LoadingScreen`, a signed-out user renders
  `LoginScreen` (the existing `AccountPanel` sign-in/up/reset form, unchanged), and only a signed-in
  user with no pending linking choice reaches the app shell/routes. `cloudSync.status ===
  'needs-choice'` renders `LinkingChoice` instead, blocking the app the same way. When Supabase is
  *not* configured, the gate is skipped entirely — this is the deliberate AGENTS.md pivot documented
  there under "Cloud Sync (Supabase)": the "never require Supabase while signed out" rule now applies
  only to the unconfigured case, since a configured deployment has a real account's private data to
  protect. Providers (`AuthProvider`/`AppProvider`/`CloudSyncProvider`/`SyncEngineProvider`) still wrap
  everything unconditionally — only the route tree itself is gated.
- **`require-explicit-choice` resolution (decision 15).** `src/sync/linkingChoice.ts` (pure comparison
  + guarded-write orchestration, no component-level Supabase calls per AGENTS.md) and
  `src/components/LinkingChoice.tsx` (the blocking dialog) implement exactly the plan's three named
  outcomes: "They match" (offered only when `compareForLinking` finds zero local-only/cloud-only/
  differing ids — a no-op link), "Use my account's data" (cloud loaded wholesale via the existing
  `APPLY_REMOTE_UPDATE` sync-boundary action, never dirty; offers an export-first backup via the
  existing `exportJsonBackup` before the irreversible replace), and "Keep this device's data" (every
  differing id pushed through the *existing* `updateXGuarded`/`createX` repository functions — never a
  plain unconditional upsert — with a write failure marked dirty and left for `drainDirtyWork` to
  resolve on its next natural run, rather than re-implementing conflict/duplicate handling a second
  time here; cloud-only records are pulled down, nothing is ever deleted). All three mark
  `established` afterward and call the existing `cloudSync.retry()` to force `decideHydration` to
  re-evaluate now that this device is linked — no new context API surface was added for this.
- **Returning-device safe refresh (`sync-established`).** `src/sync/refreshFromCloud.ts` is the pull
  counterpart to `drainSync.ts`: for an already-linked device, it re-reads all three entity lists and
  applies only the records whose cloud `updated_at` differs from what this device last saw —
  *skipping every id in `AccountSyncMetadata.dirty`* unconditionally. That one skip is the entire
  safety mechanism for "pending changes exist -> drain first, before accepting cloud replacement": a
  dirty record is never touched by refresh, so there is no silent-overwrite scenario to detect in the
  first place; if the cloud version of a dirty record *also* changed, the drain loop's own guarded
  update surfaces that as a typed `'conflict'` when it eventually runs, with zero new conflict-
  detection code needed here. Wired into `CloudSyncContext.tsx`'s `'sync-established'` branch,
  dispatching the existing `APPLY_REMOTE_UPDATE` only when something actually changed. This is also
  the Device-A-writes/Device-B-loads-on-startup path: a plain returning-device app open/refresh (no
  explicit action) now pulls in another device's already-synced changes.
- **Manual pull control.** `SyncStatusPanel` gained a "Refresh from cloud" button beside the existing
  "Sync now", both reusing existing actions (`cloudSync.retry()` / `sync.syncNow()` respectively) —
  no new engine code. `CloudSyncBanner` shows a non-fatal, retryable notice when a `sync-established`
  refresh attempt itself fails (this device keeps whatever it last synced; nothing is blocked).
- **Signed-in Import (decision 10).** `IMPORT` remains a sync-boundary action (never dirty, never
  auto-pushed) exactly as before — `SettingsView.tsx` now additionally asks a signed-in user to choose
  "This device only" (unchanged behavior) or "This device and my account" (applies `IMPORT` locally,
  then reuses `runMigration` — the same verified upload path `MigrationPanel` already uses — and marks
  `established` on success). A signed-out or unconfigured user still gets the single original
  confirmation, with no choice to make.
- **Reset.** Unchanged behavior (still local-only, decision 8 — no cloud deletion path exists to call);
  the confirmation copy now explicitly says a signed-in user's cloud data is not touched, so "Reset"
  can't be misread as a cloud wipe.
- **Sign-out / account-switch isolation.** No new code was needed: `AppContext.tsx`'s per-account
  dirty-set and generation invalidation, `SyncEngineContext.tsx`'s accountId-scoped effects, and
  `CloudSyncContext.tsx`'s accountId-keyed hydration effect (all Phase 5B3A/5B3B) already stop stale
  work and re-evaluate cleanly on sign-out or a different account signing in — verified with a
  dedicated account-isolation test rather than re-implemented.
- **`MigrationPanel` retained**, unchanged: it still serves `await-explicit-migration` (local-only +
  empty cloud) and is now also the upload path signed-in Import's cloud-push choice reuses — not
  retired, and no interface change was needed.

**Not done in 5B3C, by design/instruction:** no Supabase Realtime (per this session's explicit
exclusion — cross-device sync is login/startup/manual-refresh only, not live push), no AI features, no
per-record deletion or tombstone sync (decision 8, unchanged), no unrelated refactors.

**Real-world cross-device verification (2026-09-02):** a task created on a phone appeared on a
desktop within seconds, and a task created on the desktop appeared on the phone within seconds,
confirming the full round trip — signed-in write, `drainDirtyWork` push, and the returning device's
`refreshFromCloud` pull — against the live production Supabase project on two physically separate
devices. This closes out the manual cross-device check called for at the end of 5B3B/5B3C.

## Migration status: complete

The Supabase cloud migration (Phases 1 through 5B3C) is done and closed. Authentication, cloud
persistence, and account-bound cross-device synchronization are all active in the shipped app and
have been verified in production, including the real-device round trip above. `npm run lint`,
`npm run test`, and `npm run build` all pass (see **Latest test results**, **Latest build results**,
and **Lint** below). Phase 2's manual cross-account RLS check remains the one item still worth
running against the live project before onboarding additional accounts (see the Phase 2 section
above); it does not block this migration, which was scoped to a single private account across that
account's own devices. Phase 6/7 polish items below are optional follow-up, not part of this
migration's scope.

### Phase 6, 7 — not started

See `SUPABASE_IMPLEMENTATION_PLAN.md` for full detail. Phase 7's Vercel env var configuration and basic redirect verification are effectively done (see the production-auth confirmation note above); its "ordinary redeployment doesn't affect existing data" check is still open.

## Latest test results

```
npm run test
Test Files  34 passed (34)
Tests       368 passed (368)
```

(185 passed as of commit `c2ec2a7`; 197 after Phase 5B3A task 2's first slice — `create*`/
`update*`/`*Guarded`/`delete*` scoped; 202 once `upsert*` was scoped too and migration's tests were
extended; 251 once Phase 5B3A task 3's provenance/dirty-marking/generation scaffold and its tests
first landed; 261 once the REORDER_TASK/enforcePrimaryCap cascading-mutation correction landed,
before task 3 was ever committed; 295 once Phase 5B3B's drain loop, sync engine, and durable dirty
tracking first landed; 325 once the Risk 1 (duplicate-create) and Risk 2 (account-linking gate)
correction landed with its own tests, before 5B3B was committed (commit `3d2086b`); 368 now that
Phase 5B3C's login gate, `LinkingChoice`/`linkingChoice.ts`, `refreshFromCloud.ts`, the signed-in
Import choice, and every test file touched by them (`App.test.tsx` new; `CloudSyncContext.test.tsx`,
`SyncStatusPanel.test.tsx`, `CloudSyncBanner.test.tsx`, `SettingsView.test.tsx` extended) has
landed.)

## Latest build results

```
npm run build
tsc -b && vite build — success
dist/assets/index-BFqOAtxU.js   535.11 kB
```

(Grew from 514.42 kB to 523.69 kB with 5B3B's initial implementation — expected, since
`src/sync/drainSync.ts`, `src/store/SyncEngineContext.tsx`, and `src/components/SyncStatusPanel.tsx`
are genuinely imported by the shipped app for the first time, and Phase 5B3A's previously-dead
`createX`/`updateXGuarded` functions become reachable for the first time too. Grew to 524.07 kB with
the Risk 1/Risk 2 correction — the new duplicate-resolution and account-linking-gate logic. Grew
again to 534.96 kB with Phase 5B3C — `LinkingChoice.tsx`/`linkingChoice.ts`, `refreshFromCloud.ts`,
`LoginScreen.tsx`/`LoadingScreen.tsx`, and `App.tsx`'s gate are all genuinely reachable from the
shipped entry point for the first time. Cloud writes are live for signed-in, *linked* ordinary
edits, and the app itself is now gated behind sign-in whenever Supabase is configured — the first
phase where both are true.)

## Lint

```
npm run lint — 0 errors (4 warnings: react-refresh/only-export-components on AppContext.tsx, AuthContext.tsx, CloudSyncContext.tsx, and SyncEngineContext.tsx — all context+provider files by design, unchanged by Phase 5B3C)
```
