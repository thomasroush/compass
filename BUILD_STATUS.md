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

### Phases 4–7 — not started

See `SUPABASE_IMPLEMENTATION_PLAN.md` for the full detail on each: cloud repository/synchronization layer (includes a proposed last-write-wins conflict strategy), user-confirmed localStorage migration, cross-device/security/offline/conflict testing, and Vercel environment configuration and deployment verification.

**Next recommended step:** finish Phase 2's manual cross-account verification (see above), then start Phase 4 — the cloud repository/synchronization layer gated behind `isSupabaseConfigured` and an active session.

## Latest test results

```
npm run test
Test Files  5 passed (5)
Tests       26 passed (26)
```

## Latest build results

```
npm run build
tsc -b && vite build — success
dist/assets/index-CaxIaUZv.js   492.23 kB
```

## Lint

```
npm run lint — 0 errors (2 pre-existing warnings: react-refresh/only-export-components on AppContext.tsx and AuthContext.tsx, both context+provider files by design)
```
