import {
  AppData,
  DailyNote,
  Goal,
  GoalStatus,
  Priority,
  Project,
  Target,
  TargetValueFormat,
  Task,
  TaskStatus,
  todayDateString,
} from '../types';

export function isOverdue(task: Task, today = todayDateString()): boolean {
  if (task.archived || task.status === 'Done' || !task.dueDate) return false;
  return task.dueDate < today;
}

export function getActiveTasks(tasks: Task[]): Task[] {
  return tasks.filter((t) => !t.archived);
}

export function getTodayPrimaryTasks(tasks: Task[]): Task[] {
  return getActiveTasks(tasks)
    .filter((t) => t.status === 'Today' && t.isPrimary)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getTodayOtherTasks(tasks: Task[]): Task[] {
  return getActiveTasks(tasks)
    .filter((t) => t.status === 'Today' && !t.isPrimary)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getOverdueTasks(tasks: Task[], today = todayDateString()): Task[] {
  return getActiveTasks(tasks)
    .filter((t) => isOverdue(t, today))
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
}

export function getTasksByStatus(tasks: Task[], status: TaskStatus): Task[] {
  return getActiveTasks(tasks)
    .filter((t) => t.status === status)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Tasks still awaiting triage: active, unassigned to any project, at the
 * default Normal priority, and still sitting in Inbox status. A task drops
 * out the moment any one of those changes (project assigned, priority set
 * away from Normal, or status moved off Inbox) — it isn't deleted or
 * archived, just no longer "untriaged". Sorted newest-created first.
 */
export function getTriageTasks(tasks: Task[]): Task[] {
  return getActiveTasks(tasks)
    .filter((t) => !t.projectId && t.priority === 'Normal' && t.status === 'Inbox')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getProjectTasks(tasks: Task[], projectId: string): Task[] {
  return tasks
    .filter((t) => t.projectId === projectId && !t.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getVisibleProjects(projects: Project[]): Project[] {
  return projects.filter((p) => p.status !== 'archived');
}

/**
 * Projects with a priorityRank sort first, numerically ascending; projects
 * without one follow, sorted alphabetically by name.
 */
export function sortProjectsByPriority(projects: Project[]): Project[] {
  const ranked = projects.filter((p) => p.priorityRank !== undefined);
  const unranked = projects.filter((p) => p.priorityRank === undefined);
  ranked.sort((a, b) => (a.priorityRank! - b.priorityRank!) || a.name.localeCompare(b.name));
  unranked.sort((a, b) => a.name.localeCompare(b.name));
  return [...ranked, ...unranked];
}

export function getArchivedProjects(projects: Project[]): Project[] {
  return projects.filter((p) => p.status === 'archived');
}

/** Goals hide 'abandoned' from the default list view, mirroring getVisibleProjects. */
export function getVisibleGoals(goals: Goal[]): Goal[] {
  return goals.filter((g) => g.status !== 'abandoned');
}

export function getProjectGoals(goals: Goal[], projectId: string): Goal[] {
  return goals.filter((g) => g.projectIds.includes(projectId));
}

/** A Goal's non-archived Targets, in display/reorder order. Archived Targets are excluded. */
export function getGoalTargets(targets: Target[], goalId: string): Target[] {
  return targets
    .filter((t) => t.goalId === goalId && !t.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** A Goal's archived Targets — surfaced only for the "show archived targets" restore UI. */
export function getArchivedGoalTargets(targets: Target[], goalId: string): Target[] {
  return targets.filter((t) => t.goalId === goalId && t.archived);
}

export function nextTargetSortOrder(targets: Target[], goalId: string): number {
  const inGoal = targets.filter((t) => t.goalId === goalId && !t.archived);
  if (inGoal.length === 0) return 0;
  return Math.max(...inGoal.map((t) => t.sortOrder)) + 1;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * A single Target's progress, 0-100. Numeric direction (increasing vs.
 * decreasing) is inferred from startValue vs. targetValue rather than stored
 * separately. Linked-tasks progress is completed/total among tasks that
 * still exist locally (a stale/missing id is silently dropped from both);
 * an archived-but-linked task still counts by its current status — archiving
 * is a visibility flag elsewhere in this app, never a deletion, so it must
 * not silently change a Target's denominator. A reopened (Done -> other
 * status) task drops out of the completed count automatically on the next
 * call, since this is always computed live, never cached.
 */
export function getTargetProgress(target: Target, tasks: Task[]): number {
  switch (target.type) {
    case 'numeric': {
      const { startValue, currentValue, targetValue } = target;
      if (targetValue === startValue) {
        return currentValue >= targetValue ? 100 : 0;
      }
      const raw =
        targetValue > startValue
          ? (currentValue - startValue) / (targetValue - startValue)
          : (startValue - currentValue) / (startValue - targetValue);
      return clamp01(raw) * 100;
    }
    case 'yesno':
      return target.achieved ? 100 : 0;
    case 'linked-tasks': {
      const linked = target.taskIds
        .map((id) => tasks.find((t) => t.id === id))
        .filter((t): t is Task => t !== undefined);
      if (linked.length === 0) return 0;
      const completed = linked.filter((t) => t.status === 'Done').length;
      return (completed / linked.length) * 100;
    }
  }
}

/**
 * Equal-weight average of a Goal's non-archived Targets' progress, or `null`
 * (not 0) when it has none yet — a Goal with zero (visible) Targets has no
 * progress to report, not zero progress. Never stored; always derived, like
 * every other aggregate in this file.
 */
export function getGoalProgress(goal: Goal, targets: Target[], tasks: Task[]): number | null {
  const visible = getGoalTargets(targets, goal.id);
  if (visible.length === 0) return null;
  const sum = visible.reduce((acc, t) => acc + getTargetProgress(t, tasks), 0);
  return clamp01(sum / visible.length / 100) * 100;
}

function formatWithCommas(n: number): string {
  const sign = n < 0 ? '-' : '';
  const digits = String(Math.round(Math.abs(n)));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Displays a numeric Target's value per its own format/unit — shared by the
 * Goals UI and the Copy to AI formatter (src/ai/aiSnapshot.ts) so value
 * display isn't duplicated. Deliberately hand-rolled rather than
 * `toLocaleString`, matching aiSnapshot.ts's own determinism requirement
 * (identical output regardless of host locale) — this function must stay
 * safe to call from there.
 */
export function formatTargetValue(value: number, target: Extract<Target, { type: 'numeric' }>): string {
  if (target.valueFormat === 'currency') {
    return `$${formatWithCommas(value)}`;
  }
  const rounded = Math.round(value * 100) / 100;
  const display = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
  return target.unit ? `${display} ${target.unit}` : display;
}

export function getDailyNoteForDate(notes: DailyNote[], date: string): DailyNote | undefined {
  return notes.find((n) => n.date === date);
}

export function countPrimaryTodayTasks(tasks: Task[]): number {
  return getActiveTasks(tasks).filter((t) => t.status === 'Today' && t.isPrimary).length;
}

export interface DueDateGroup {
  date: string;
  tasks: Task[];
}

/**
 * Groups active tasks that carry a user-assigned due date by that date,
 * in chronological order. Undated and archived tasks are excluded.
 */
export function getTasksGroupedByDueDate(tasks: Task[]): DueDateGroup[] {
  const groups = new Map<string, Task[]>();
  for (const task of getActiveTasks(tasks)) {
    if (!task.dueDate) continue;
    const group = groups.get(task.dueDate);
    if (group) group.push(task);
    else groups.set(task.dueDate, [task]);
  }
  return Array.from(groups.keys())
    .sort()
    .map((date) => ({
      date,
      tasks: groups.get(date)!.sort((a, b) => a.sortOrder - b.sortOrder),
    }));
}

export function nextSortOrder(tasks: Task[], status: TaskStatus): number {
  const inStatus = tasks.filter((t) => t.status === status && !t.archived);
  if (inStatus.length === 0) return 0;
  return Math.max(...inStatus.map((t) => t.sortOrder)) + 1;
}

export type TaskUpdate = Partial<
  Pick<
    Task,
    | 'title'
    | 'notes'
    | 'status'
    | 'projectId'
    | 'priority'
    | 'dueDate'
    | 'isPrimary'
    | 'archived'
    | 'sortOrder'
    | 'completedAt'
  >
>;

/**
 * Fields updatable on an existing Target via UPDATE_TARGET. `type` itself is
 * fixed at creation (not editable) — only the fields valid for that target's
 * own type have any effect; the reducer ignores fields that don't apply.
 * `archived` is deliberately excluded here — see ARCHIVE_TARGET/RESTORE_TARGET.
 */
export type TargetUpdate = Partial<{
  name: string;
  startValue: number;
  currentValue: number;
  targetValue: number;
  unit: string | undefined;
  valueFormat: TargetValueFormat;
  achieved: boolean;
  taskIds: string[];
}>;

export type AppAction =
  | { type: 'LOAD'; data: AppData }
  | { type: 'ADD_TASK'; id?: string; title: string; status?: TaskStatus; notes?: string; priority?: Priority; projectId?: string; dueDate?: string }
  | { type: 'UPDATE_TASK'; id: string; updates: TaskUpdate }
  | { type: 'COMPLETE_TASK'; id: string }
  | { type: 'UNCOMPLETE_TASK'; id: string }
  | { type: 'ARCHIVE_TASK'; id: string }
  | { type: 'SET_PRIMARY'; id: string; isPrimary: boolean }
  | { type: 'POSTPONE_DUE'; id: string; days?: number }
  | { type: 'POSTPONE_TO_WEEK'; id: string }
  | { type: 'REORDER_TASK'; id: string; direction: 'up' | 'down' }
  | { type: 'ADD_PROJECT'; id?: string; name: string; description?: string; priorityRank?: number }
  | {
      type: 'UPDATE_PROJECT';
      id: string;
      name?: string;
      description?: string;
      status?: Project['status'];
      /** `undefined` leaves it unchanged; `null` clears it back to unranked. */
      priorityRank?: number | null;
    }
  | { type: 'UPSERT_DAILY_NOTE'; id?: string; date: string; morning?: string; evening?: string }
  | { type: 'ADD_GOAL'; id?: string; name: string; description?: string; dueDate?: string; priority?: Priority }
  | {
      type: 'UPDATE_GOAL';
      id: string;
      name?: string;
      description?: string;
      /** `undefined` leaves it unchanged; `null` clears it. */
      dueDate?: string | null;
      priority?: Priority;
      status?: GoalStatus;
    }
  | { type: 'LINK_GOAL_PROJECT'; goalId: string; projectId: string }
  | { type: 'UNLINK_GOAL_PROJECT'; goalId: string; projectId: string }
  | { type: 'ADD_TARGET'; id?: string; goalId: string; targetType: 'numeric'; name: string; startValue: number; currentValue: number; targetValue: number; unit?: string; valueFormat?: TargetValueFormat }
  | { type: 'ADD_TARGET'; id?: string; goalId: string; targetType: 'yesno'; name: string; achieved?: boolean }
  | { type: 'ADD_TARGET'; id?: string; goalId: string; targetType: 'linked-tasks'; name: string; taskIds?: string[] }
  | { type: 'UPDATE_TARGET'; id: string; updates: TargetUpdate }
  | { type: 'ARCHIVE_TARGET'; id: string }
  | { type: 'RESTORE_TARGET'; id: string }
  | { type: 'REORDER_TARGET'; id: string; direction: 'up' | 'down' }
  | { type: 'IMPORT'; data: AppData }
  | { type: 'RESET' }
  /**
   * Phase 5B3A scaffold (see SUPABASE_IMPLEMENTATION_PLAN.md "Phase 5B3A" and
   * decision 14): the sync-boundary counterpart to LOAD for a future pulled-
   * down reconciliation write, once a real drain loop exists (Phase 5B3B).
   * Same "replace state with authoritative data" semantics as LOAD/IMPORT.
   * Not dispatched from anywhere yet.
   */
  | { type: 'APPLY_REMOTE_UPDATE'; data: AppData };

function updateTaskList(tasks: Task[], id: string, updater: (t: Task) => Task): Task[] {
  return tasks.map((t) => (t.id === id ? updater(t) : t));
}

export function enforcePrimaryCap(tasks: Task[]): Task[] {
  const primaries = getActiveTasks(tasks)
    .filter((t) => t.status === 'Today' && t.isPrimary)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  if (primaries.length <= 3) return tasks;

  const demoteIds = new Set(primaries.slice(3).map((t) => t.id));
  return tasks.map((t) => (demoteIds.has(t.id) ? { ...t, isPrimary: false } : t));
}

function applyTargetUpdate(target: Target, updates: TargetUpdate): Target {
  const name = updates.name !== undefined ? updates.name.trim() : target.name;
  if (name === '') return target;
  const base = { ...target, name };
  switch (base.type) {
    case 'numeric':
      return {
        ...base,
        startValue: updates.startValue ?? base.startValue,
        currentValue: updates.currentValue ?? base.currentValue,
        targetValue: updates.targetValue ?? base.targetValue,
        unit: 'unit' in updates ? updates.unit : base.unit,
        valueFormat: updates.valueFormat ?? base.valueFormat,
      };
    case 'yesno':
      return { ...base, achieved: updates.achieved ?? base.achieved };
    case 'linked-tasks':
      return { ...base, taskIds: updates.taskIds ?? base.taskIds };
  }
}

export function appReducer(state: AppData, action: AppAction): AppData {
  switch (action.type) {
    case 'LOAD':
      return action.data;

    case 'ADD_TASK': {
      const status = action.status ?? 'Inbox';
      const task: Task = {
        id: action.id ?? (crypto.randomUUID?.() ?? `${Date.now()}`),
        title: action.title.trim(),
        notes: action.notes?.trim() || undefined,
        status,
        priority: action.priority ?? 'Normal',
        projectId: action.projectId || undefined,
        dueDate: action.dueDate || undefined,
        createdAt: new Date().toISOString(),
        sortOrder: nextSortOrder(state.tasks, status),
        isPrimary: false,
        archived: false,
      };
      if (!task.title) return state;
      return { ...state, tasks: [...state.tasks, task] };
    }

    case 'UPDATE_TASK': {
      const { id, updates } = action;
      let tasks = updateTaskList(state.tasks, id, (t) => {
        const next: Task = { ...t, ...updates };
        if (updates.projectId === '') next.projectId = undefined;
        if (updates.status && updates.status !== 'Today' && t.isPrimary) {
          next.isPrimary = false;
        }
        if (updates.status === 'Done' && !next.completedAt) {
          next.completedAt = new Date().toISOString();
        }
        if (updates.status && updates.status !== 'Done') {
          next.completedAt = undefined;
        }
        return next;
      });
      tasks = enforcePrimaryCap(tasks);
      return { ...state, tasks };
    }

    case 'COMPLETE_TASK':
      return appReducer(state, {
        type: 'UPDATE_TASK',
        id: action.id,
        updates: { status: 'Done', completedAt: new Date().toISOString() },
      });

    case 'UNCOMPLETE_TASK':
      return appReducer(state, {
        type: 'UPDATE_TASK',
        id: action.id,
        updates: { status: 'Inbox', completedAt: undefined },
      });

    case 'ARCHIVE_TASK':
      return appReducer(state, {
        type: 'UPDATE_TASK',
        id: action.id,
        updates: { archived: true, isPrimary: false },
      });

    case 'SET_PRIMARY': {
      const task = state.tasks.find((t) => t.id === action.id);
      if (!task || task.archived) return state;

      if (action.isPrimary) {
        if (task.status !== 'Today') {
          return appReducer(state, {
            type: 'UPDATE_TASK',
            id: action.id,
            updates: { status: 'Today', isPrimary: true },
          });
        }
        const count = countPrimaryTodayTasks(state.tasks);
        if (count >= 3 && !task.isPrimary) return state;
      }

      let tasks = updateTaskList(state.tasks, action.id, (t) => ({
        ...t,
        isPrimary: action.isPrimary,
        status: action.isPrimary ? 'Today' : t.status,
      }));
      tasks = enforcePrimaryCap(tasks);
      return { ...state, tasks };
    }

    case 'POSTPONE_DUE': {
      const task = state.tasks.find((t) => t.id === action.id);
      if (!task?.dueDate) {
        const tomorrow = todayDateString();
        const [y, m, d] = tomorrow.split('-').map(Number);
        const next = new Date(y, m - 1, d + (action.days ?? 1));
        const dateStr = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
        return appReducer(state, {
          type: 'UPDATE_TASK',
          id: action.id,
          updates: { dueDate: dateStr },
        });
      }
      const days = action.days ?? 1;
      const [y, m, d] = task.dueDate.split('-').map(Number);
      const next = new Date(y, m - 1, d + days);
      const dateStr = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
      return appReducer(state, {
        type: 'UPDATE_TASK',
        id: action.id,
        updates: { dueDate: dateStr },
      });
    }

    case 'POSTPONE_TO_WEEK':
      return appReducer(state, {
        type: 'UPDATE_TASK',
        id: action.id,
        updates: { status: 'This Week', isPrimary: false },
      });

    case 'REORDER_TASK': {
      const task = state.tasks.find((t) => t.id === action.id);
      if (!task) return state;
      const column = getTasksByStatus(state.tasks, task.status);
      const idx = column.findIndex((t) => t.id === action.id);
      const swapIdx = action.direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= column.length) return state;

      const other = column[swapIdx];
      const tasks = state.tasks.map((t) => {
        if (t.id === task.id) return { ...t, sortOrder: other.sortOrder };
        if (t.id === other.id) return { ...t, sortOrder: task.sortOrder };
        return t;
      });
      return { ...state, tasks };
    }

    case 'ADD_PROJECT': {
      const name = action.name.trim();
      if (!name) return state;
      const project: Project = {
        id: action.id ?? (crypto.randomUUID?.() ?? `${Date.now()}`),
        name,
        description: action.description?.trim() || undefined,
        status: 'active',
        priorityRank: action.priorityRank,
      };
      return { ...state, projects: [...state.projects, project] };
    }

    case 'UPDATE_PROJECT':
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.id
            ? {
                ...p,
                ...(action.name !== undefined ? { name: action.name.trim() } : {}),
                ...(action.description !== undefined
                  ? { description: action.description.trim() || undefined }
                  : {}),
                ...(action.status !== undefined ? { status: action.status } : {}),
                ...(action.priorityRank !== undefined
                  ? { priorityRank: action.priorityRank === null ? undefined : action.priorityRank }
                  : {}),
              }
            : p,
        ),
      };

    case 'UPSERT_DAILY_NOTE': {
      const existing = state.dailyNotes.find((n) => n.date === action.date);
      if (existing) {
        // Clearing an existing note back to blank is a legitimate edit and
        // must stay possible here — only creating a new, still-blank record
        // below is refused.
        return {
          ...state,
          dailyNotes: state.dailyNotes.map((n) =>
            n.date === action.date
              ? {
                  ...n,
                  morning: action.morning ?? n.morning,
                  evening: action.evening ?? n.evening,
                }
              : n,
          ),
        };
      }
      const morning = action.morning ?? '';
      const evening = action.evening ?? '';
      // A blank/whitespace-only save with nothing to attach it to (e.g.
      // DailyNotesView's autosave firing on mount before the user has typed
      // anything) must not create a record — an empty note is indistinguishable
      // from no note in the UI, so silently persisting one has no benefit and
      // only pollutes local data (and, in turn, cloud-hydration decisions).
      if (!morning.trim() && !evening.trim()) return state;
      const note: DailyNote = {
        id: action.id ?? (crypto.randomUUID?.() ?? `${Date.now()}`),
        date: action.date,
        morning,
        evening,
      };
      return { ...state, dailyNotes: [...state.dailyNotes, note] };
    }

    case 'ADD_GOAL': {
      const name = action.name.trim();
      if (!name) return state;
      const goal: Goal = {
        id: action.id ?? (crypto.randomUUID?.() ?? `${Date.now()}`),
        name,
        description: action.description?.trim() || undefined,
        dueDate: action.dueDate || undefined,
        priority: action.priority ?? 'Normal',
        status: 'active',
        projectIds: [],
      };
      return { ...state, goals: [...state.goals, goal] };
    }

    case 'UPDATE_GOAL': {
      const goals = state.goals;
      return {
        ...state,
        goals: goals.map((g) =>
          g.id === action.id
            ? {
                ...g,
                ...(action.name !== undefined ? { name: action.name.trim() } : {}),
                ...(action.description !== undefined
                  ? { description: action.description.trim() || undefined }
                  : {}),
                ...(action.dueDate !== undefined
                  ? { dueDate: action.dueDate === null ? undefined : action.dueDate }
                  : {}),
                ...(action.priority !== undefined ? { priority: action.priority } : {}),
                ...(action.status !== undefined ? { status: action.status } : {}),
              }
            : g,
        ),
      };
    }

    case 'LINK_GOAL_PROJECT': {
      const goals = state.goals;
      return {
        ...state,
        goals: goals.map((g) =>
          g.id === action.goalId && !g.projectIds.includes(action.projectId)
            ? { ...g, projectIds: [...g.projectIds, action.projectId] }
            : g,
        ),
      };
    }

    case 'UNLINK_GOAL_PROJECT': {
      const goals = state.goals;
      return {
        ...state,
        goals: goals.map((g) =>
          g.id === action.goalId
            ? { ...g, projectIds: g.projectIds.filter((id) => id !== action.projectId) }
            : g,
        ),
      };
    }

    case 'ADD_TARGET': {
      const name = action.name.trim();
      if (!name) return state;
      const targets = state.targets;
      const base = {
        id: action.id ?? (crypto.randomUUID?.() ?? `${Date.now()}`),
        goalId: action.goalId,
        name,
        sortOrder: nextTargetSortOrder(targets, action.goalId),
        archived: false,
      };
      let target: Target;
      if (action.targetType === 'numeric') {
        target = {
          ...base,
          type: 'numeric',
          startValue: action.startValue,
          currentValue: action.currentValue,
          targetValue: action.targetValue,
          unit: action.unit,
          valueFormat: action.valueFormat ?? 'number',
        };
      } else if (action.targetType === 'yesno') {
        target = { ...base, type: 'yesno', achieved: action.achieved ?? false };
      } else {
        target = { ...base, type: 'linked-tasks', taskIds: action.taskIds ?? [] };
      }
      return { ...state, targets: [...targets, target] };
    }

    case 'UPDATE_TARGET': {
      const targets = state.targets;
      return {
        ...state,
        targets: targets.map((t) => (t.id === action.id ? applyTargetUpdate(t, action.updates) : t)),
      };
    }

    case 'ARCHIVE_TARGET': {
      const targets = state.targets;
      return {
        ...state,
        targets: targets.map((t) => (t.id === action.id ? { ...t, archived: true } : t)),
      };
    }

    case 'RESTORE_TARGET': {
      const targets = state.targets;
      return {
        ...state,
        targets: targets.map((t) => (t.id === action.id ? { ...t, archived: false } : t)),
      };
    }

    case 'REORDER_TARGET': {
      const targets = state.targets;
      const target = targets.find((t) => t.id === action.id);
      if (!target || target.archived) return state;
      const siblings = getGoalTargets(targets, target.goalId);
      const idx = siblings.findIndex((t) => t.id === action.id);
      const swapIdx = action.direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= siblings.length) return state;

      const other = siblings[swapIdx];
      return {
        ...state,
        targets: targets.map((t) => {
          if (t.id === target.id) return { ...t, sortOrder: other.sortOrder };
          if (t.id === other.id) return { ...t, sortOrder: target.sortOrder };
          return t;
        }),
      };
    }

    case 'IMPORT':
      return action.data;

    case 'RESET':
      return { version: 1, tasks: [], projects: [], dailyNotes: [], goals: [], targets: [] };

    case 'APPLY_REMOTE_UPDATE':
      return action.data;

    default:
      return state;
  }
}

export function createTaskForTest(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Test task',
    status: 'Inbox',
    priority: 'Normal' as Priority,
    createdAt: '2026-01-01T00:00:00.000Z',
    sortOrder: 0,
    isPrimary: false,
    archived: false,
    ...overrides,
  };
}
