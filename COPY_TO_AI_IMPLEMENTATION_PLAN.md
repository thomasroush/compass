# Daily Compass: Copy to AI Implementation Plan

## Purpose

Add a small, provider-neutral feature that lets a Compass user copy a clean summary of their own projects and tasks and paste it into ChatGPT, Claude, or another AI assistant.

This feature does **not** connect Compass to an AI service. It makes no network request, requires no API key, creates no AI cost for Compass, and does not allow an AI to change Compass data.

## Product principle

Compass remains useful without AI. “Copy to AI” is an optional bridge for a user who wants to discuss their Compass workload with an AI they already use.

## Required user experience

Add a clearly labeled **Copy to AI** action in a location that is easy to find but does not clutter the primary task workflow. Inspect the current navigation and views before choosing the exact placement. Prefer one reusable action rather than duplicate implementations.

When selected, open a small dialog or panel with:

1. A scope selector:
   - **Current work** — active, non-archived projects and their non-archived tasks.
   - **Today** — tasks currently shown as Today, plus enough project information to understand them.
   - **One project** — select one active project and include its non-archived tasks.
2. A preview of the exact text that will be copied.
3. A **Copy** button.
4. A **Cancel** button.
5. A brief privacy note: “Only the text shown here is copied. Compass does not send it anywhere.”

After copying, show a short success state such as **Copied to clipboard**. If clipboard access fails, keep the preview selectable and show a useful error instead of silently failing.

Do not add an AI-provider selector. The user chooses where to paste the text after it is copied.

## Snapshot format

Generate deterministic, readable Markdown/plain text. Do not generate JSON and do not include internal IDs, database fields, sync metadata, user IDs, timestamps used only for synchronization, or implementation details.

Use only fields that actually exist in the current Compass data model. Inspect the types before implementing; do not invent task fields.

Suggested structure:

```text
# Daily Compass Snapshot

Generated: September 7, 2026, 9:15 AM
Scope: Current work

## Instructions for my AI

Review this workload. Identify priority conflicts, overdue work, vague tasks,
missing next actions, and the three most important things I should do next.
Do not assume you can change Compass. Present proposed changes for my review.

## Project: SJE

Project priority: 1

- [ ] Finish vessel presentation | High | Due: 09/10/2026 | Status: In Progress
- [ ] Get John’s China-trip numbers | High | No due date | Status: Waiting

## Project: Compass

Project priority: Not ranked

- [ ] Test Calendar on phone | Normal | No due date | Status: This Week

## Unassigned tasks

- [ ] Call insurance company | Normal | Due: 09/08/2026 | Status: Today
```

Adapt labels to the application’s real statuses and fields. If project-priority ranking has not yet been implemented, omit that line cleanly rather than blocking this feature.

## Inclusion and ordering rules

- Respect the selected scope.
- Exclude archived projects by default.
- Exclude archived tasks.
- Exclude completed tasks from **Current work** unless the existing UI clearly treats recently completed work as active. If there is ambiguity, preserve the simplest behavior and document it.
- Include unassigned tasks in an explicit section when they are within scope.
- Sort ranked projects by project priority ascending, then sort unranked projects alphabetically. Until project priority exists, sort all projects alphabetically.
- Within each project, preserve the application’s existing task ordering rather than creating a second competing order.
- Format missing values explicitly and consistently, for example `No due date`.
- Use the user’s normal displayed date format.
- Ensure the same state and scope always produce the same content, except for the generated-at line.

## Suggested implementation shape

Keep generation pure and testable:

```ts
type CopyToAIScope =
  | { type: 'current-work' }
  | { type: 'today' }
  | { type: 'project'; projectId: string };

function buildAISnapshot(
  projects: Project[],
  tasks: Task[],
  scope: CopyToAIScope,
  generatedAt: Date,
): string;
```

Use the project’s existing state/context selectors. Do not create a second data store, bypass existing filtering rules, or query Supabase directly from the new component.

Use the browser Clipboard API with a graceful fallback. Do not add a dependency merely to copy text.

## Explicit non-goals

- No OpenAI, Anthropic, or other AI API calls.
- No API keys or secrets.
- No server function.
- No new Supabase table or migration.
- No conversation history.
- No automatic task creation from AI output.
- No import/paste-back system.
- No tracking which AI receives the copied text.
- No background process.
- No changes to cloud synchronization behavior.

## Security and privacy requirements

- Build the snapshot only from the currently authenticated account’s in-memory state.
- Never include authentication tokens, email addresses, user IDs, internal record IDs, sync metadata, or diagnostic information.
- Do not write snapshot contents to logs, analytics, localStorage, Supabase, or error reports.
- Do not copy until the user presses the final Copy button.
- The preview must exactly match the copied text.

## Accessibility and responsive behavior

- The action and dialog must be keyboard accessible.
- Give the dialog an accessible name and manage focus correctly.
- The preview must be readable and selectable on desktop and mobile.
- Buttons must use the existing Compass visual language and remain usable on a phone.

## Tests

Add focused tests for the pure formatter and the user interaction.

At minimum verify:

1. Current-work scope includes eligible active projects and tasks.
2. Today scope includes only the intended Today tasks.
3. Single-project scope cannot include tasks from another project.
4. Archived projects and tasks are excluded.
5. Unassigned tasks appear in the correct section.
6. Internal IDs and sync metadata never appear.
7. Ranked projects sort numerically and unranked projects sort alphabetically when ranking exists.
8. Clipboard success and failure states behave correctly.
9. Empty scopes produce a useful, valid snapshot rather than an error.
10. Existing sync, Board, Calendar, Projects, archive, and task interactions remain unchanged.

Run the full existing test, build, and lint commands after implementation. Do not weaken existing tests or silence new warnings.

## Implementation sequence for Claude Code

1. Read `AGENTS.md`, `BUILD_STATUS.md`, and the relevant project/task types and views.
2. Report the proposed files and exact UI placement before editing.
3. Implement the pure snapshot formatter and its tests.
4. Implement the dialog/action using existing components and styles where possible.
5. Add interaction tests.
6. Run the complete test/build/lint suite.
7. Update `BUILD_STATUS.md` only after the feature is verified.
8. Report the exact files changed, behavior added, tests run, and any assumptions.
9. Stop for review. Do not commit, push, deploy, alter Supabase, or begin an AI connection.

## Acceptance criteria

The feature is complete when an authenticated user can choose a supported scope, see the exact snapshot, copy it reliably, paste it into any AI assistant, and be confident that Compass itself transmitted nothing and changed no stored data.

