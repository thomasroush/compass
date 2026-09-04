import { AppData, DailyNote, Priority, Project, Task, TaskStatus, todayDateString } from '../types';

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

export function getProjectTasks(tasks: Task[], projectId: string): Task[] {
  return tasks
    .filter((t) => t.projectId === projectId && !t.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getVisibleProjects(projects: Project[]): Project[] {
  return projects.filter((p) => p.status !== 'archived');
}

export function getArchivedProjects(projects: Project[]): Project[] {
  return projects.filter((p) => p.status === 'archived');
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
  | { type: 'ADD_PROJECT'; id?: string; name: string; description?: string }
  | { type: 'UPDATE_PROJECT'; id: string; name?: string; description?: string; status?: Project['status'] }
  | { type: 'UPSERT_DAILY_NOTE'; id?: string; date: string; morning?: string; evening?: string }
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

    case 'IMPORT':
      return action.data;

    case 'RESET':
      return { version: 1, tasks: [], projects: [], dailyNotes: [] };

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
