# Daily Compass — Claude Code Instructions

## Goal

Maintain and complete the existing Daily Compass application. This is an existing working project, not a new application to rebuild.

Daily Compass is a simple personal task-management website for one user. It should provide:

- quick task entry;
- a basic Kanban board;
- a Today view;
- simple projects;
- morning and evening notes;
- data that remains after the application is closed and reopened.

The application must remain non-AI and must not use an AI API, paid service, or analytics.

Cloud data storage and sync via Supabase — including Supabase authentication, which is required for it — is a permitted, in-progress exception to the app's original local-only design (approved 2026-08-29; authentication requirement made explicit 2026-08-29). See "Cloud Sync (Supabase)" below for the full rules governing that integration, and `SUPABASE_IMPLEMENTATION_PLAN.md` for the phased build plan. No other backend, database, login system, or cloud data service may be added.

## How Claude Code Should Work

Read this entire file and inspect the existing project before changing anything.

- Maintain and improve the existing application. Do not rebuild it from scratch.
- Preserve the existing framework, project structure, appearance, and working features unless a change is required by this file.
- Use the existing package manager and dependencies whenever practical.
- Use browser `localStorage` for persistence.
- Centralize application data under one versioned storage key.
- Preserve and migrate valid existing saved data whenever possible.
- Save immediately after every user-created data change.
- Validate saved and imported data before loading or replacing current data.
- The application must remain compatible with its existing static Vercel deployment.
- Data is specific to the browser and hostname. Ordinary Vercel redeployments on the same production hostname must not erase it.
- Do not add an AI feature or any external service other than the approved Supabase project. Supabase authentication (individual accounts, no anonymous access) is required for cloud sync — see "Cloud Sync (Supabase)".
- Do not deploy, publish, purchase anything, or connect outside accounts, other than the already-configured Supabase project.
- Do not delete unrelated files or use destructive Git commands.
- Keep changes focused and avoid unnecessary dependencies.
- Test important functions and fix errors before finishing.
- Keep `BUILD_STATUS.md` updated with completed work and the latest test results.
- Do not expand the project beyond the requirements in this file.

## Simplicity Rules

This application should look plain, mature, clean, and functional.

- No emojis anywhere in the interface or source copy.
- No mascots, illustrations, animations, gradients, decorative graphics, inspirational quotations, badges, points, streaks, confetti, or gamification.
- No AI coach, chatbot, recommendations, scoring system, or automated prioritization.
- No social features, collaboration, notifications, calendar integration, or email.
- No fake buttons or unfinished controls.
- No excessive settings, menus, pop-ups, abstractions, or dependencies.
- Use clear text labels, restrained colors, readable type, and generous spacing.
- Make it usable on desktop and mobile.
- Use accessible form labels, visible keyboard focus, and good contrast.

## Core Data

The exact storage structure is up to the model. At minimum, preserve:

### Tasks

- title;
- optional notes;
- status;
- optional project;
- priority;
- optional due date;
- created and completed dates;
- display order.

Task statuses:

- Inbox
- This Week
- Today
- In Progress
- Waiting
- Done

Priorities:

- Low
- Normal
- High

### Projects

- name;
- optional description;
- active, completed, or archived status.

### Daily Notes

- date;
- morning notes;
- evening notes.

Create stable IDs for saved records. Validate saved or imported data before replacing current data.

## Cloud Sync (Supabase)

Cloud storage and sync via a single, already-provisioned Supabase project is in progress, approved as an exception to the original local-only design (approved 2026-08-29; corrected 2026-08-29 — see `SUPABASE_IMPLEMENTATION_PLAN.md` for phased detail). Signed-in cloud sync is the intended architecture, supporting private cross-device access and, later, potentially additional users. These requirements are permanent, not phase-specific:

- Supabase authentication is required before any cloud task data can be read or written. There is no anonymous or single-shared-account mode.
- Each user must have an individual account and an authenticated user ID (`auth.uid()`).
- Every cloud data record must belong to an authenticated `user_id`.
- Row Level Security must restrict every table so a user can access only records whose `user_id` matches `auth.uid()`. No anonymous user may read, create, modify, or delete Compass data.
- The client must use only the publishable (anon) key. Never use a secret or `service_role` key in the browser or in any client-shipped code.
- `localStorage` remains the default and must keep working fully offline for a signed-out user — the app must never require Supabase to start, load, or save data while signed out. **Deliberate pivot (2026-09-01, login-first cross-device sync):** this now applies only when Supabase is *not configured* for the deployment (no `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY`) — that case is unchanged, and still opens straight into local-only use with no gate. When Supabase *is* configured, a signed-out visitor sees a login screen instead of the app (`src/App.tsx`'s `AuthGate`): there is a real account's private data to protect, so the app itself is what must never be shown before sign-in, not Supabase access that must never be required. `localStorage` is still the only place data is written before the first successful sign-in on a device, and still works fully offline once signed in.
- Existing `localStorage` data must remain untouched until the user signs in and explicitly approves a one-time import. Never migrate or upload it automatically.
- Cloud sync is the intended signed-in mode; `localStorage` may remain an offline cache and signed-out fallback, but it must never silently overwrite newer cloud data.
- Compass remains non-AI for now.
- Read Supabase credentials only from `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local`. Never hardcode, print, log, or commit their values.
- Use a single reusable client (`src/lib/supabaseClient.ts`). Do not create additional client instances elsewhere.
- Handle missing/misconfigured env vars gracefully: warn, don't crash, and fall back to local-only behavior.
- Build sync incrementally, in the phase order defined in `SUPABASE_IMPLEMENTATION_PLAN.md`, behind feature checks (e.g. `isSupabaseConfigured`) so the app degrades cleanly without Supabase configured.
- Keep `.env.local` git-ignored. Never display, copy, or commit its values.

## Required Application Views

### Today

Make Today the opening view.

- Show up to three primary tasks.
- Show other Today tasks below them.
- Show overdue tasks.
- Allow tasks to be completed, edited, postponed, or moved.
- Let the user choose which tasks are primary; do not calculate this with a hidden formula.

### Board

Show six columns: Inbox, This Week, Today, In Progress, Waiting, and Done.

- Allow tasks to move between columns.
- Drag-and-drop is optional. Simple movement buttons or a status selector are sufficient.
- Preserve task order.
- Provide a keyboard-accessible way to move tasks.

### Tasks

- Add a task using only a title.
- Edit its details.
- Search tasks.
- Filter by status, priority, or project.
- Archive rather than permanently delete ordinary tasks.

### Projects

- Add and edit projects.
- Mark projects completed or archived.
- Show the tasks belonging to a project.

### Daily Notes

Provide one simple page with morning and evening sections for the selected date.

Suggested morning prompts:

- What matters most today?
- What might get in the way?

Suggested evening prompts:

- What was accomplished?
- What should carry forward?

### Settings and Backup

Keep settings minimal.

- Export all data to one JSON file.
- Import a valid JSON backup after confirmation.
- Export active tasks as readable Markdown if easy to implement.
- Provide a strongly confirmed reset.
- Explain where the data is stored and that the user should export backups.

## Interface

Use a small desktop sidebar and compact mobile navigation with only:

- Today
- Board
- Tasks
- Projects
- Daily Notes
- Settings

Keep quick task entry available from the main screens. Use simple forms and confirmation messages. Do not create elaborate dashboards or charts.

## Build Order

1. Inspect or create the project and basic navigation.
2. Choose and implement the simplest persistence method.
3. Build task creation, editing, movement, filtering, and completion.
4. Build Today and the Kanban board.
5. Build projects and daily notes.
6. Add export, import, reset, responsive styling, and essential tests.
7. Run lint, type checking, tests, and a production build. Fix failures.
8. Finish `README.md` and `BUILD_STATUS.md`.

Do not stop between these steps unless there is a real blocker that cannot be resolved safely.

## Essential Tests

Keep tests limited to functions that could lose or corrupt data:

- saved data reloads correctly;
- a task can be added, edited, moved, completed, and archived;
- Today allows no more than three primary tasks;
- daily notes persist by date;
- export and import reproduce the saved data;
- invalid saved or imported data is rejected safely.

Do not add a large test framework or pursue a coverage target.

## Definition of Done

The application is finished when:

1. It starts locally using commands documented in `README.md`.
2. Today opens by default.
3. Tasks can be added, edited, moved, completed, searched, filtered, and archived.
4. The six-column board works on desktop and mobile.
5. Projects and dated morning/evening notes work.
6. Data survives closing and reopening the application.
7. Export, import, and reset work safely.
8. The design is clean and contains no emojis or extraneous features.
9. Lint, type checking, essential tests, and the production build pass.
10. No AI feature, paid service, external account, or cloud dependency is required.

## Final Handoff

When complete, report:

- what works;
- how to start it;
- test and build results;
- where the data is stored;
- how to back it up;
- any known limitations.

Do not claim unfinished features work, and do not add new features after these requirements are satisfied.
