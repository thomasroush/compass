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

The application must remain non-AI and must not use an AI API, paid service, login system, analytics, database, backend, or cloud data service.

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
- Do not add a backend, database, login, AI feature, or external data service.
- Do not deploy, publish, purchase anything, or connect outside accounts.
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
