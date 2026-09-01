# Supabase Implementation Plan

This plan governs adding authenticated cloud sync to Daily Compass via Supabase. It supersedes any earlier, undocumented assumption that a personal Supabase project would not need authentication — see `AGENTS.md` → "Cloud Sync (Supabase)" for the permanent rules this plan must satisfy.

Each phase below is a separate, reviewable unit of work. **Do not start a phase before the previous one is complete and verified.** Phases 1–3 have been implemented (Phase 2's manual cross-account verification is still outstanding — see that section); Phase 3's production auth flows have since been manually confirmed end-to-end on both localhost and the deployed Vercel URL. Phase 4's repository layer (the read/write primitives) is built and tested, and is now activated for two purposes — Phase 5A's explicit, user-confirmed local-to-cloud migration, manually verified against the production Supabase project (2026-08-31), and Phase 5B2's read-only cloud hydration — while still making no cloud write outside of those two explicit, narrow paths. Phase 5B (two-way synchronization) is staged as 5B1–5B3 under its own approved architecture decisions; 5B1 (internal foundations only, no user-visible change) and 5B2 (signed-in cloud hydration, read-only) are both complete. 5B3 was revised (see decisions 13–15 and the "Phase 5B3" section below) into 5B3A/5B3B/5B3C; 5B3A's first, inert task is complete and the rest of 5B3A, 5B3B, 5B3C, and Phases 6–7 are still just described below.

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
- Tested with `src/store/AuthContext.test.tsx`, `src/components/AccountPanel.test.tsx`, `src/components/AccountPanel.unconfigured.test.tsx`, and `src/components/PasswordRecoveryDialog.test.tsx`, all against a mocked `../lib/supabaseClient` (never the live project).
- **Manually verified end-to-end (2026-08-30):** `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` were added to the Vercel project's environment variables and the production deployment was rebuilt; account creation, the real confirmation email, sign-in, sign-out, and password recovery via the real recovery email were all manually tested and confirmed working on both `http://localhost:5173` and `https://compass-beige-nine.vercel.app`.

## Phase 4 — Cloud repository / synchronization layer

This phase has two halves: the repository layer itself (the typed read/write primitives), and the synchronization logic that would actually call it from the running app. **Only the first half is done.**

### Repository layer (complete, inactive)

- `src/repository/` — `listX()`/`createX()`/`updateX(id, updates)`/`deleteX(id)` for `projects`, `tasks`, and `daily_notes`, built directly on `src/lib/supabaseClient.ts` (no second client). Each function:
  - resolves `user_id` itself from the live Supabase session (`src/repository/session.ts`, `getAuthenticatedSession()`) — it is never accepted as a parameter, so there is no code path where a caller can pass another user's id;
  - filters every query by `.eq('user_id', userId)`, and update/delete additionally by `.eq('id', id)` — matching the schema's composite `(user_id, id)` primary key from Phase 2, and acting as defense-in-depth alongside (not instead of) RLS;
  - selects an explicit column list, never `select('*')`;
  - maps camelCase app fields to snake_case database columns and back (`src/repository/mappers.ts`), keeping the app's own `Task`/`Project`/`DailyNote` types in `src/types.ts` completely unchanged;
  - returns a typed `RepositoryResult<T>` (`{ ok: true, data: T } | { ok: false, error: { type, message } }`) built from Supabase's own error text — never a token, key, or session detail — instead of throwing;
  - returns the database's `updated_at` on every read/write, via a cloud-only `CloudProject`/`CloudTask`/`CloudDailyNote` type (the app type plus `updatedAt: string`), so it survives to be used by the conflict strategy below once that's implemented.
- Tested in `src/repository/*.test.ts` (mapping, session/auth requirements, per-repository CRUD, ownership filters, empty results, database failures) — all against a mocked Supabase client, never the live project. See `BUILD_STATUS.md` for the full file/test inventory.
- **Not connected to `AppContext` or general app data flow.** As of this phase, no file outside `src/repository/` imported it, and `AppContext`, `src/storage/`, and every view were byte-for-byte unchanged. Phase 5A below later added the first (and still only) caller — `src/components/MigrationPanel.tsx`, via `src/repository/migration.ts` — for the single, explicit, one-time migration action; `AppContext`, `src/storage/`, and Export/Import/Reset remain unchanged.

### Synchronization logic (not started)

- Actually calling the repository from the running app, gated behind `isSupabaseConfigured` and an active session — most likely from `AppContext` or an intermediate sync layer between it and `src/repository/` (not yet decided; see "open design decisions" below).
- **Conflict strategy (still just proposed, unimplemented):** last-write-wins by `updated_at`. On sync, a record is only overwritten if the incoming version's `updated_at` is strictly newer than the local/cloud version being replaced. Local writes always stamp a fresh `updated_at` before syncing. This is intentionally simple (no CRDT/merge) — appropriate for a single user's own devices, but must be re-examined before real multi-user sharing (as opposed to multi-user *isolation*) is ever considered.
- Cloud sync becomes the intended behavior while signed in; `localStorage` continues to be written as an offline cache so the app keeps working if the network drops mid-session.
- `localStorage` must never be silently overwritten by an older cloud snapshot, and vice versa — the timestamp check above governs both directions.
- **Open design decision:** whether sync logic lives directly in `AppContext`, or in a new layer between `AppContext` and `src/repository/`. Deferred to when this half is actually built.

## Phase 5A — Controlled, explicit local-to-cloud migration (complete)

Built as a narrower, manual-only slice of what this section originally described: an explicit,
Settings-initiated push of a device's existing local data to the signed-in account, with no
automatic trigger on sign-in and no pull-down of cloud data. See `BUILD_STATUS.md` → "Phase 5A"
for the full file-by-file detail; summarized here:

- No automatic upload on sign-in — migration only starts when the user opens Settings and clicks
  "Migrate this device's data," which itself only fetches counts (no upload yet).
- Before any upload, the user sees the signed-in account's email, current local counts
  (projects/tasks/daily notes), and current cloud counts for that account, plus an explicit
  explanation that this copies device data to the cloud account and does not delete or change
  anything locally. Only a second, explicit "Copy data to cloud" confirmation in that dialog
  starts the upload.
- Uses the existing repository layer's new `upsertProject`/`upsertTask`/`upsertDailyNote`
  functions (`{ onConflict: 'user_id,id' }`, matching Phase 2's composite primary key) — existing
  local ids are preserved, never regenerated, and a record that already exists in the cloud under
  that id is updated in place rather than duplicated. `user_id` is still resolved only from the
  live session, never accepted as a parameter anywhere in this flow.
- Projects are uploaded before tasks so task → project references stay valid against the Phase 2
  foreign key. A single record's upload failure is collected and reported, not thrown, and does
  not stop the rest.
- After uploading, the migration re-reads `listProjects`/`listTasks`/`listDailyNotes` and confirms
  every uploaded record is present with matching key fields before reporting success — a
  partial-failure or failed-verification result is always reported as such, never as success.
- `localStorage` is never read for anything other than the upload itself, and is never cleared,
  overwritten, or otherwise touched by this flow — Export, Import, and Reset are unchanged.
- Declining/closing the review dialog leaves local data untouched and cloud data unmodified; the
  user can reopen the same panel later from Settings to try again (e.g. after fixing whatever
  caused a partial failure).

**Not built in 5A, intentionally:** any automatic trigger, any pull-down of cloud data into local
state, and any two-way sync or conflict resolution — those remain a later phase's scope (see
Phase 5B below, folded into the original Phase 4 "synchronization" description).

**Manually verified against the production Supabase project (2026-08-31):** with the Windows
clock resynchronized and a fresh authentication session established, the migration preview
correctly showed 4 local projects, 9 local tasks, and 3 local daily notes against 0 cloud
projects, 0 cloud tasks, and 0 cloud daily notes; migration completed successfully; application
verification afterward confirmed 4 projects, 9 tasks, and 3 daily notes, with local data intact
after a refresh; and direct inspection of the production database confirmed the same record
counts, no orphaned project-task relationships, and the expected constraints in place —
`projects` and `tasks` and `daily_notes` each `primary key (user_id, id)`, `tasks`' composite
project foreign key, and `daily_notes` `unique (user_id, note_date)`. See `BUILD_STATUS.md` →
"Phase 5A" for the full detail.

## Phase 5B — Two-way synchronization

This is the "synchronization logic" half described under Phase 4 above (wiring the repository
into `AppContext`, cloud-vs-local reconciliation) — not yet activated. Phase 5A's one-time,
upload-only migration does not require or imply this; it is a separate, larger decision, now
governed by the architecture decisions below and staged across three sub-phases so every commit
stays independently deployable.

**Approved architecture decisions (govern every 5B sub-phase):**

1. Supabase is authoritative while authenticated.
2. `localStorage` remains the immediate cache, offline fallback, and signed-out datastore.
3. No `updatedAt` field is added to exported `AppData`, and the client clock is never used for
   conflict decisions — only the database's own server-generated `updated_at` is authoritative.
4. Each record's last-known server `updated_at` is kept in separate, device-local sync metadata,
   never in `AppData`.
5. Authenticated cloud updates are guarded against stale server timestamps from the first moment
   cloud writes are activated. There is no interim unconditional-write phase deployed at any point.
6. No Supabase Realtime or websockets — synchronization is event-driven, not subscription-based.
7. Synchronization runs on sign-in/startup and via a manual "Sync now" action. A later
   focus/reconnect check may be added, but is not required for 5B's initial scope.
8. No per-record hard deletion or tombstones are added. Existing archive behavior (a field flip,
   not a removal) remains the only "remove" gesture in the app.
9. If cloud and local both contain data and this device has no established sync relationship with
   that account, the app must require an explicit user choice — never guess, never auto-upload.
10. Import stays local-only by default. A separately confirmed cloud push may add/update cloud
    records but must never delete cloud records the imported file doesn't mention.
11. "Clear this device" and "delete cloud data" are separate controls, built in a later sub-phase,
    each with its own confirmation.
12. Production must never reach a state where cloud records are hydrated into an editable UI while
    subsequent edits remain local-only without a prominent, visible safeguard — hydration and live
    write activation must land together from the user's perspective, not silently drift apart.
13. (Added by the Phase 5B3 architecture revision, superseding an earlier undifferentiated 5B3
    sketch — see "Phase 5B3" below for the full rationale.) Every mutating repository function
    must verify the live Supabase session against an explicit `expectedAccountId` immediately
    before acting, using a client pinned to that verified session's access token rather than the
    ambient, mutable client — never resolve "which account" from the ambient session at call time
    with no caller-supplied expectation. A queued/dirty write is permanently associated with the
    account that owned the local state when the edit occurred, never the account active when the
    write is later drained.
14. Mutation provenance (dirty-marking) is determined by a static, exhaustive classification of
    each dispatched action type, checked at the dispatch call itself — never by diffing
    before/after application state, and never by a runtime "sync in progress" suppression flag,
    both of which are timing-dependent in ways that can silently mis-classify an edit.
15. The "require-explicit-choice" resolution (decision 9) offers exactly three named, whole-device
    outcomes — "Keep this device's data," "Use my account's data," and, only when local and cloud
    are fully equivalent, "They match — link this device" — and never applies an unconditional
    overwrite (e.g. Phase 5A's plain `upsertX`) to a cloud record whose value differs from local;
    such a record is only ever written through the existing guarded (compare-and-swap) update.

### Phase 5B1 — internal synchronization foundations (complete; inactive)

Internal groundwork only — no user-visible synchronization, no cloud hydration, and no automatic
cloud writes were activated in this sub-phase. See `BUILD_STATUS.md` → "Phase 5B1" for the full
file-by-file detail; summarized here:

- Confirmed `listProjects`/`listTasks`/`listDailyNotes` (Phase 4) already serve as the typed
  read-all operations 5B's hydration path needs; no new repository read functions were required.
- Added `src/sync/metadata.ts` — a typed, pure schema for device-local sync bookkeeping
  (`SyncMetadataStore` keyed by authenticated account id; each `AccountSyncMetadata` tracks
  per-record last-known server `updated_at`, dirty ids awaiting sync, whether this device has an
  established sync relationship with that account, and the last successful sync time). Reading is
  always scoped through `getAccountMetadata(store, accountId)`, which returns a fresh empty record
  rather than another account's data for any account this device hasn't seen — this is where
  cross-account isolation is enforced, tested explicitly.
- Added `src/sync/metadataValidation.ts` and `src/sync/metadataStorage.ts` — schema validation and
  corruption fallback mirroring `storage/validation.ts`'s existing pattern, persisted under a new,
  separate storage key (`daily-compass-sync-v1`) that Export, Import, and `AppData`'s own
  load/save code never touch.
- Added `src/sync/hydration.ts` — a pure `decideHydration()` function classifying the seven
  startup/sign-in situations this decision governs: signed out; cloud query failed; both
  cloud and local empty; cloud populated/local empty (safe to hydrate); cloud empty/local
  populated (Phase 5A's existing migration prompt, never an auto-upload, per decision 9); both
  populated with no established marker (must ask, per decision 9); both populated with an
  established marker (ordinary sync applies). Performs no I/O and calls nothing in
  `src/repository` — a future phase supplies the real inputs and acts on the decision.
- Added `updateProjectGuarded`/`updateTaskGuarded`/`updateDailyNoteGuarded` to the existing
  repository files, implementing the compare-and-swap mechanism decision 5 requires from the
  first activated cloud write — **not called from any UI or dispatch path yet.** Each adds one
  `.eq('updated_at', expectedUpdatedAt)` filter to the same conditional `UPDATE ...
  .select().maybeSingle()` call already used elsewhere in the repository layer; Postgres executes
  the filtered update as one atomic statement, so this is a real compare-and-swap requiring no
  database RPC or SQL migration (see `BUILD_STATUS.md` → "Phase 5B1" for the full mechanism
  analysis, including why `.maybeSingle()` rather than `.single()` is required to distinguish a
  conflict from a genuine database error).
- Added `'conflict'` to `RepositoryErrorType`, reusing the existing `RepositoryResult<T>` shape
  rather than introducing a parallel result type.
- 50 new automated tests (metadata account isolation, validation/corruption fallback, the full
  hydration decision table, and the new guarded-update functions) — suite total 150 tests passing.
- Confirmed unchanged: the reducer, `AppContext`'s save behavior, `MigrationPanel`, Import, Reset,
  and the production bundle size (byte-for-byte identical, confirming `src/sync/*` is not imported
  anywhere in the shipped app).

### Phase 5B2 — Signed-in cloud hydration (complete; read-only, no cloud writes activated)

Narrower than this section originally described: this sub-phase wires `decideHydration` up to
real cloud/local data and, only for the safe `hydrate-from-cloud` case, loads it into `AppContext`
— but does **not** call any guarded-update function or otherwise write to Supabase. Wiring the
guarded-update functions into a real write path is deferred to 5B3, so this phase answers the
"how is `expectedUpdatedAt` first populated" question a different way: by seeding it, read-only,
from what hydration itself just read. See `BUILD_STATUS.md` → "Phase 5B2" for the full
file-by-file detail; summarized here:

- Added `src/sync/hydrateFromCloud.ts`, which reads a signed-in user's cloud data via the
  existing `listProjects`/`listTasks`/`listDailyNotes` and feeds the resulting counts through
  `decideHydration()`. It never calls a create/update/upsert/delete repository function, so it
  cannot write or overwrite a cloud record, and — like every function in `src/repository/` — it
  takes no user id parameter; the acting user is resolved only from the live Supabase session,
  deep inside the repository layer.
- Added `src/store/CloudSyncContext.tsx` (`CloudSyncProvider`), the first caller of
  `src/sync/hydrateFromCloud.ts` and the first thing outside `src/sync/*.test.ts` to import from
  `src/sync/` at all. Runs once per sign-in/startup. Acts on the decision:
  - `hydrate-from-cloud` (cloud has data, local is empty — the only unambiguous case): dispatches
    the existing `LOAD` action with the cloud data, then records this device as established for
    that account and seeds each hydrated record's `updatedAt` into device-local sync metadata
    only (`markEstablished`/`setLastSyncedAt`/`setRecordUpdatedAt`, saved via
    `saveSyncMetadataStore`) — no Supabase call.
  - `cloud-query-failed`: local data untouched; a recoverable error state with a Retry action.
  - `require-explicit-choice` (decision 9's case — both sides have data, no established link,
    e.g. right after a Phase 5A migration): local data untouched; an explanatory message is shown.
    The actual interactive choice UI decision 9 anticipates is still undesigned and deferred to
    5B3 — this phase only guarantees the app never guesses.
  - `sync-established`: **not** re-hydrated automatically on every open — doing so with no
    write-back path yet could silently discard local edits made since the last hydration, which
    "do not silently replace valid local data" rules out. Real reconciliation is 5B3's job.
  - `signed-out` / `both-empty` / `await-explicit-migration`: no change, matching each case's
    existing meaning.
- Added `src/components/CloudSyncBanner.tsx`, mounted globally in `AppShell`. This is the
  concrete implementation of decision 12 for this phase: since hydration now loads cloud records
  into the same editable UI that local edits use, and write-back is not active yet, the banner
  shows a persistent, always-visible notice — *"Changes you make are saved on this device only —
  cloud sync writes are not active yet"* — for as long as this device holds cloud-hydrated data
  without active write-back, rather than either skipping hydration entirely or hydrating silently.
- 21 new automated tests (`hydrateFromCloud.test.ts`, `CloudSyncContext.test.tsx`,
  `CloudSyncBanner.test.tsx`) covering successful hydration, empty cloud data, the unauthenticated/
  database-failure cases, both-populated with and without an established link, and an explicit
  cross-account case (a second account signing in on a device that still has a first account's
  local data must never have its cloud data silently swapped in) — suite total 171 tests passing.
- Confirmed via `npm run build`: the production bundle grew from 503.40 kB to 509.90 kB — expected
  for the first phase that actually imports `src/sync/` from the shipped app (every prior phase
  confirmed a byte-for-byte unchanged bundle instead).

**Not done in 5B2, by design:** no cloud write of any kind beyond what Phase 5A's `MigrationPanel`
already does; no "Sync now" action; no interactive resolution for `require-explicit-choice`; no
reconciliation once a device is established; no per-record deletion/tombstones.

### Phase 5B3 — Account-affinity-safe write-back, conflict/linking, and offline handling

**Superseded design note:** this phase was originally sketched as a single undifferentiated step
(see the earlier revision of this section, preserved in version control). An architecture review
before any of it was built identified a real gap: every repository function resolves the acting
user from the *live* Supabase session at call time (`getAuthenticatedSession()`), with no
caller-supplied expectation of which account a given operation belongs to. Because a dirty write
can be queued under one account and only actually sent to Supabase later — after a debounce, after
a manual "Sync now" click, after the device was closed and reopened — a session change (sign-out,
sign-in as a different account) between when an edit was queued and when it is drained could
attribute that write to whichever account happens to be live at drain time, not the account whose
edit it actually was. Decisions 13–15 above are the governing fix; this section reflects the
revised, three-sub-phase sequence.

#### Phase 5B3A — Account-affinity and mutation-provenance foundations (inert; in progress)

No cloud write is activated in this sub-phase; every piece lands the same way 5B1's guarded-update
functions did — built, tested in isolation, and confirmed to have zero callers in the active app,
so `vite build`'s bundle stays byte-for-byte identical throughout.

- Add `getAuthenticatedSessionFor(expectedAccountId)` to `src/repository/session.ts` and
  `'account-mismatch'` to `RepositoryErrorType` — per decision 13, verifies the live session
  against the caller's expectation and returns a client pinned to the verified session's access
  token, immune to any later change in the ambient client's session. **Complete** — see
  `BUILD_STATUS.md` → "Phase 5B3A, task 1 of 3" for full detail, mechanism analysis, and tests.
  Not yet called from anywhere.
- Require `expectedAccountId` on every mutating repository function (`create*`, `update*`,
  `upsert*`, `*Guarded`, `delete*`), routed through `getAuthenticatedSessionFor`. `list*`
  (read-only) functions are unaffected. **Complete** — see `BUILD_STATUS.md` → "Phase 5B3A, task 2
  of 3" for full detail. This includes `upsertProject`/`upsertTask`/`upsertDailyNote`: an earlier
  slice of this task deferred them because they are Phase 5A migration's only write path and
  changing their signature meant changing `migration.ts`'s calls; that has since been done as a
  narrow, additive change — `runMigration(local, expectedAccountId)` now takes the account id its
  caller's already-authenticated session established (`MigrationPanel.tsx`'s `auth.user.id`, never
  derived from the records being migrated) and passes it unchanged to every `upsertX` call.
  Migration's sequencing, UI, eligibility checks, local-data handling, retry behavior, and
  completion state are all otherwise unchanged. No `upsert*` exception remains.
- Add an exhaustive `ACTION_PROVENANCE` classification of every `AppAction` type into
  `'user-edit'` (dirty-producing) or `'sync-boundary'` (`LOAD`, `IMPORT`, `RESET`, and a new
  `APPLY_REMOTE_UPDATE` for pulled-down reconciliation), checked with a compile-time
  exhaustiveness guard so a new action type added later without being classified fails the build —
  per decision 14. Wire `AppProvider`'s dispatch to call `markDirty` only for `'user-edit'`
  actions, against the currently authenticated account's `AccountSyncMetadata` bucket (a no-op
  when signed out). **Not started.**
- Add a sync-engine generation/cancellation scaffold (a monotonic counter bumped whenever the live
  `user.id` actually changes) that a later drain loop checks between — never during — network
  calls, so it stops starting new work promptly on sign-out/account switch without attempting to
  cancel a request already sent (see the in-flight-request analysis below). Stubbed with no drain
  behavior yet. **Not started.**

**In-flight requests — what changing accounts can and cannot affect:** a request already sent
cannot be un-sent, and Postgres RLS evaluates `auth.uid()` from the JWT actually attached to that
specific request, not from whatever the ambient client's session says afterward. Once
`getAuthenticatedSessionFor`'s pinned client has dispatched a write, nothing that happens to the
*ambient* session next (sign-out, a different sign-in) changes what that write is attributed to.
"Stop dequeuing immediately" on sign-out therefore means not starting the *next* queued item, not
retroactively affecting one already in flight — and no attempt is made to flush a queue on
sign-out, since rushing a best-effort write at that exact moment would reintroduce the same kind
of race this design removes. A queued write's completion always updates its *own* account's sync
metadata bucket, never whichever account happens to be active when the response arrives.

#### Phase 5B3B — Manual "Sync now" write-back (not started)

Implements the drain loop body against 5B3A's scaffold: for each dirty id under a given account,
call the matching `*Guarded` function with `expectedAccountId` pinned to that account's bucket and
`expectedUpdatedAt` from sync metadata; success clears dirty and updates metadata, a `'conflict'`
leaves it dirty (cloud wins, matching the existing conflict philosophy). Wires the loop to the
manual "Sync now" action (decision 7) and to startup/sign-in once a device is established. Adds a
brief "reconciling account" interstitial disabling edits between an auth account change and its
corresponding hydration/linking decision resolving, now load-bearing since write-back is live.
Tests deliberately switch sessions immediately before and during a queued write (mocking the
Supabase client to swap the resolved session inside the guard's own `await`) to confirm the write
is still attributed to the account it was queued for, never silently dropped, and never
cross-attributed to a different account — and that two accounts' dirty queues on one device never
cross-contaminate through a shared drain loop.

#### Phase 5B3C — Interactive linking UI and signed-in Import cloud-push (not started)

Builds the three-choice UI for 5B2's `require-explicit-choice` state per decision 15 and points
11–14 of the architecture review: an equivalence check (same id sets, identical values) gates
whether "They match — link this device" is offered. "Keep this device's data" performs a guarded,
confirmed overwrite per differing id (never a plain `upsertX`), pulls down cloud-only ids without
deleting anything, and inserts local-only ids. "Use my account's data" requires an explicit
confirmation naming what will be discarded and a *freshly re-read* cloud state at confirm time
(not the counts shown when the choice screen first rendered) before applying. "They match" writes
nothing and only marks the device established. Also adds the signed-in Import cloud-push option
(decision 10, add/update only, still never delete, per decision 8's "no per-record deletion" and
decision 11's separate-controls requirement). This is also the point at which Phase 6 below
becomes fully exercisable, since it needs real writes, conflicts, and offline behavior all present
to test meaningfully.

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
| 3. Authentication and login interface | Complete, including manual end-to-end verification on localhost and production Vercel (real confirmation email, sign-in/out, real recovery email) |
| 4. Cloud repository / synchronization layer | Repository layer (typed CRUD + mapping, tested, plus Phase 5A's `upsertX` additions) complete and now activated (Settings → migration; Phase 5B2 → read-only hydration). Two-way (write) synchronization logic not started |
| 5A. Controlled, explicit local-to-cloud migration | Complete, including manual verification against the production Supabase project (2026-08-31) — see `BUILD_STATUS.md` |
| 5B1. Synchronization foundations (metadata, hydration-decision logic, guarded-update primitives) | Complete — internal only, inactive, no visible app change. See `BUILD_STATUS.md` |
| 5B2. Signed-in cloud hydration | Complete — read-only; no cloud write activated. First activation of `src/sync/` in the shipped app. Manual verification against the production project still outstanding — see `BUILD_STATUS.md`. A follow-up fix (commit `bf7d967`) closed a related gap at the reducer level — see `BUILD_STATUS.md` → "Phase 5B2 correction" |
| 5B3A. Account-affinity + mutation-provenance foundations | In progress — `getAuthenticatedSessionFor` account-affinity primitive complete; `expectedAccountId` now required on every mutating repository function including `upsert*` (task 2 of 3 fully complete, no exception remaining) — `create*`/`update*`/`*Guarded`/`delete*` still have zero application callers, but `upsert*` now does via Phase 5A's migration, so the bundle grew slightly (510.13 kB → 510.78 kB) for the first time in this phase; `ACTION_PROVENANCE` dirty-marking and the sync-engine scaffold not yet started — see `BUILD_STATUS.md` |
| 5B3B. Manual "Sync now" write-back | Not started |
| 5B3C. Interactive linking UI + signed-in Import cloud-push | Not started |
| 6. Cross-device, security, offline, and conflict testing | Not started |
| 7. Vercel environment configuration and deployment verification | Env vars added and production rebuilt, redirect behavior confirmed working (done as part of Phase 3's manual verification). Confirming ordinary redeployments don't affect existing data still outstanding |
