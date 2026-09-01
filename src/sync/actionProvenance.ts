import {
  countPrimaryTodayTasks,
  enforcePrimaryCap,
  getTasksByStatus,
  type AppAction,
} from '../store/reducer';
import type { AppData, Task, TaskStatus } from '../types';
import type { SyncEntity } from './metadata';

/**
 * Phase 5B3A, task 3 of 3 (see SUPABASE_IMPLEMENTATION_PLAN.md "Phase 5B3A"
 * and decision 14): a static, exhaustive classification of every `AppAction`
 * type into whether it represents a local user edit (dirty-producing) or a
 * sync-boundary action (LOAD, IMPORT, RESET, APPLY_REMOTE_UPDATE) that must
 * never be marked dirty, however state actually changed as a result.
 *
 * Deliberately a switch over `action.type` with a `never`-typed default, not
 * a diff of before/after state and not a runtime "sync in progress" flag —
 * per decision 14, both of those are timing-dependent and can silently
 * mis-classify an edit. Adding a new `AppAction` variant without adding a
 * case here fails the build (the `default` branch only type-checks when
 * every other case has been handled, narrowing `action` to `never`).
 */

export type ActionProvenance = 'user-edit' | 'sync-boundary';

function assertNeverAction(action: never): never {
  throw new Error(`Unhandled AppAction type in ACTION_PROVENANCE: ${JSON.stringify(action)}`);
}

export function classifyActionProvenance(action: AppAction): ActionProvenance {
  switch (action.type) {
    case 'ADD_TASK':
    case 'UPDATE_TASK':
    case 'COMPLETE_TASK':
    case 'UNCOMPLETE_TASK':
    case 'ARCHIVE_TASK':
    case 'SET_PRIMARY':
    case 'POSTPONE_DUE':
    case 'POSTPONE_TO_WEEK':
    case 'REORDER_TASK':
    case 'ADD_PROJECT':
    case 'UPDATE_PROJECT':
    case 'UPSERT_DAILY_NOTE':
      return 'user-edit';

    case 'LOAD':
    case 'IMPORT':
    case 'RESET':
    case 'APPLY_REMOTE_UPDATE':
      return 'sync-boundary';

    default:
      return assertNeverAction(action);
  }
}

export interface DirtyTarget {
  entity: SyncEntity;
  id: string;
}

/**
 * Given what a task's `status`/`isPrimary`/`archived` fields would become
 * (already computed by the caller, mirroring the reducer's own field-level
 * logic for the specific action being resolved — never by calling the
 * reducer), returns any *other* task ids `enforcePrimaryCap` would demote as
 * a side effect, by running the real, exported `enforcePrimaryCap` against a
 * shadow copy of `prevTasks` with only the acted-on task's fields patched.
 *
 * `enforcePrimaryCap` is a pure, deterministic, side-effect-free function
 * (no id/timestamp generation) — reusing it directly here is not "calling
 * the reducer speculatively" in the sense that matters (that concern is
 * specifically about `appReducer` itself, whose `ADD_TASK`/`ADD_PROJECT`/
 * `UPSERT_DAILY_NOTE` cases generate a fresh id/timestamp on every call, so
 * calling it twice for the same dispatch would silently produce two
 * different records — see AppContext.tsx). It is the single source of truth
 * for the demotion rule (which of more-than-3 primaries survive), so
 * reusing it directly avoids re-implementing that rule a second time here
 * where it could drift out of sync.
 *
 * Only ever called when the acted-on task is newly becoming a Today-primary
 * (see call sites below) — demoting an existing primary, or a task that was
 * already a Today-primary, can only ever *decrease* the primary count, which
 * can never trigger a new demotion.
 */
function primaryCapDemotions(
  prevTasks: Task[],
  actedTaskId: string,
  resultingStatus: TaskStatus,
  resultingIsPrimary: boolean,
  resultingArchived: boolean,
): DirtyTarget[] {
  const priorTask = prevTasks.find((t) => t.id === actedTaskId);
  if (!priorTask) return [];

  const wasPrimary = priorTask.status === 'Today' && priorTask.isPrimary && !priorTask.archived;
  const isPrimaryNow = resultingStatus === 'Today' && resultingIsPrimary && !resultingArchived;
  if (!isPrimaryNow || wasPrimary) return [];

  const shadow = prevTasks.map((t) =>
    t.id === actedTaskId
      ? { ...t, status: resultingStatus, isPrimary: resultingIsPrimary, archived: resultingArchived }
      : t,
  );
  const enforced = enforcePrimaryCap(shadow);

  const demoted: DirtyTarget[] = [];
  for (let i = 0; i < shadow.length; i++) {
    if (shadow[i].id !== actedTaskId && shadow[i].isPrimary && !enforced[i].isPrimary) {
      demoted.push({ entity: 'task', id: shadow[i].id });
    }
  }
  return demoted;
}

/**
 * Resolves which record(s), if any, a `'user-edit'` action should mark
 * dirty, given the local state *before* the action is applied.
 *
 * Never calls the reducer (`appReducer`) and never compares full before/
 * after state — `id` for a newly-created record must already be present on
 * the action (the caller, `AppContext`'s dispatch wrapper, generates it up
 * front and injects it into the action before this runs and before the real
 * dispatch, so the same id is both what gets persisted and what gets marked
 * dirty; see the `primaryCapDemotions` doc comment above for why re-running
 * `appReducer` here to "peek" at a created id would be unsafe).
 *
 * Mirrors the reducer's own no-op guards (blank title/name/note, an
 * archived or nonexistent target task, and — for every id-targeting action
 * — the target id must already exist in `prevState`) so a refused edit is
 * never marked dirty, and its own cascading-mutation rules (REORDER_TASK's
 * adjacent swap partner; `enforcePrimaryCap`'s demotions triggered by
 * UPDATE_TASK or SET_PRIMARY newly promoting a task to Today-primary) so
 * every record whose *persisted* value actually changes is marked, not only
 * the one the action names. This is a deliberate, explicit duplication of
 * the reducer's field-level logic (not the reducer's id/timestamp
 * generation, and not a diff of its output) — if the reducer's own logic
 * for these cases ever changes, this must be kept in sync.
 */
export function resolveDirtyTargets(action: AppAction, prevState: AppData): DirtyTarget[] {
  switch (action.type) {
    case 'ADD_TASK': {
      if (!action.title.trim() || !action.id) return [];
      return [{ entity: 'task', id: action.id }];
    }

    case 'UPDATE_TASK': {
      const task = prevState.tasks.find((t) => t.id === action.id);
      if (!task) return [];

      const { updates } = action;
      const resultingStatus = updates.status ?? task.status;
      let resultingIsPrimary = updates.isPrimary ?? task.isPrimary;
      if (updates.status && updates.status !== 'Today' && task.isPrimary) {
        resultingIsPrimary = false;
      }
      const resultingArchived = updates.archived ?? task.archived;

      return [
        { entity: 'task', id: action.id },
        ...primaryCapDemotions(prevState.tasks, action.id, resultingStatus, resultingIsPrimary, resultingArchived),
      ];
    }

    // These three delegate internally to UPDATE_TASK with a fixed `updates`
    // shape that can only ever remove this task's own Today-primary status
    // (or leave it unchanged) — never grant it — so they can never cause
    // `enforcePrimaryCap` to demote a *different* task:
    //  - COMPLETE_TASK:   { status: 'Done' }     — non-Today status.
    //  - UNCOMPLETE_TASK: { status: 'Inbox' }    — non-Today status.
    //  - ARCHIVE_TASK:    { archived: true, isPrimary: false } — explicit.
    // Only the acted-on task itself can change.
    case 'COMPLETE_TASK':
    case 'UNCOMPLETE_TASK':
    case 'ARCHIVE_TASK': {
      const exists = prevState.tasks.some((t) => t.id === action.id);
      return exists ? [{ entity: 'task', id: action.id }] : [];
    }

    // POSTPONE_DUE only ever changes `dueDate`; POSTPONE_TO_WEEK moves the
    // task to 'This Week' with isPrimary explicitly false — neither can ever
    // grant Today-primary status, so neither can trigger a demotion.
    case 'POSTPONE_DUE':
    case 'POSTPONE_TO_WEEK': {
      const exists = prevState.tasks.some((t) => t.id === action.id);
      return exists ? [{ entity: 'task', id: action.id }] : [];
    }

    case 'SET_PRIMARY': {
      const task = prevState.tasks.find((t) => t.id === action.id);
      if (!task || task.archived) return [];

      if (action.isPrimary && task.status === 'Today') {
        // Matches the reducer's own upfront cap check for a task already in
        // Today: refused before anything changes, so nothing is dirty. Since
        // this check already prevents exceeding the cap, promoting here can
        // never trigger enforcePrimaryCap to demote a different task.
        const count = countPrimaryTodayTasks(prevState.tasks);
        if (count >= 3 && !task.isPrimary) return [];
        return [{ entity: 'task', id: action.id }];
      }

      if (action.isPrimary) {
        // task.status !== 'Today': the reducer delegates to an internal
        // UPDATE_TASK with { status: 'Today', isPrimary: true }, bypassing
        // the cap check above entirely — enforcePrimaryCap is what actually
        // keeps this safe, and it can demote a different task here.
        return [
          { entity: 'task', id: action.id },
          ...primaryCapDemotions(prevState.tasks, action.id, 'Today', true, task.archived),
        ];
      }

      // Removing primary status can only decrease the primary count.
      return [{ entity: 'task', id: action.id }];
    }

    case 'REORDER_TASK': {
      const task = prevState.tasks.find((t) => t.id === action.id);
      if (!task) return [];

      const column = getTasksByStatus(prevState.tasks, task.status);
      const idx = column.findIndex((t) => t.id === action.id);
      const swapIdx = action.direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= column.length) return [];

      const other = column[swapIdx];
      return [
        { entity: 'task', id: action.id },
        { entity: 'task', id: other.id },
      ];
    }

    case 'ADD_PROJECT': {
      if (!action.name.trim() || !action.id) return [];
      return [{ entity: 'project', id: action.id }];
    }

    case 'UPDATE_PROJECT': {
      const exists = prevState.projects.some((p) => p.id === action.id);
      return exists ? [{ entity: 'project', id: action.id }] : [];
    }

    case 'UPSERT_DAILY_NOTE': {
      const existing = prevState.dailyNotes.find((n) => n.date === action.date);
      if (existing) return [{ entity: 'dailyNote', id: existing.id }];
      const morning = action.morning ?? '';
      const evening = action.evening ?? '';
      if ((!morning.trim() && !evening.trim()) || !action.id) return [];
      return [{ entity: 'dailyNote', id: action.id }];
    }

    case 'LOAD':
    case 'IMPORT':
    case 'RESET':
    case 'APPLY_REMOTE_UPDATE':
      return [];

    default:
      return assertNeverAction(action);
  }
}
