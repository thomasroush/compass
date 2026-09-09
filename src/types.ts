export const TASK_STATUSES = [
  'Inbox',
  'This Week',
  'Today',
  'In Progress',
  'Waiting',
  'Done',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PRIORITIES = ['Low', 'Normal', 'High'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PROJECT_STATUSES = ['active', 'completed', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export interface Task {
  id: string;
  title: string;
  notes?: string;
  status: TaskStatus;
  projectId?: string;
  priority: Priority;
  dueDate?: string;
  createdAt: string;
  completedAt?: string;
  sortOrder: number;
  isPrimary: boolean;
  archived: boolean;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  status: ProjectStatus;
  /** Optional manual ordering rank (1, 2, 3, ...). Unset means unranked. */
  priorityRank?: number;
}

export interface DailyNote {
  id: string;
  date: string;
  morning: string;
  evening: string;
}

export const GOAL_STATUSES = ['active', 'achieved', 'paused', 'abandoned'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export interface Goal {
  id: string;
  name: string;
  description?: string;
  dueDate?: string;
  /** Reuses the existing Task priority scale rather than a separate Goal-specific one. */
  priority: Priority;
  status: GoalStatus;
  /** Ids of Projects (owned by the same user) this Goal contributes to. */
  projectIds: string[];
}

export const TARGET_TYPES = ['numeric', 'yesno', 'linked-tasks'] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

export const TARGET_VALUE_FORMATS = ['number', 'currency'] as const;
export type TargetValueFormat = (typeof TARGET_VALUE_FORMATS)[number];

interface TargetBase {
  id: string;
  goalId: string;
  name: string;
  sortOrder: number;
  /** Archived Targets are excluded from their Goal's progress calculation but never deleted. */
  archived: boolean;
}

export type Target =
  | (TargetBase & {
      type: 'numeric';
      startValue: number;
      currentValue: number;
      targetValue: number;
      unit?: string;
      valueFormat: TargetValueFormat;
    })
  | (TargetBase & { type: 'yesno'; achieved: boolean })
  | (TargetBase & { type: 'linked-tasks'; taskIds: string[] });

export interface AppData {
  version: 1;
  tasks: Task[];
  projects: Project[];
  dailyNotes: DailyNote[];
  /**
   * Optional (not required) specifically so that AppData literals built by
   * code that predates Goals/Targets — the live cloud hydration/refresh path
   * in src/sync/, in particular — continue to compile and behave exactly as
   * before without modification. Every code path this app's own reducer and
   * validation own always populates these as concrete arrays; only a LOAD
   * dispatched from unmodified hydration code could leave them undefined.
   * Treat as `Goal[] | []`/`Target[] | []` everywhere, never assume defined.
   */
  goals?: Goal[];
  targets?: Target[];
}

export const STORAGE_KEY = 'daily-compass-v1';

export function createEmptyAppData(): AppData {
  return {
    version: 1,
    tasks: [],
    projects: [],
    dailyNotes: [],
    goals: [],
    targets: [],
  };
}

export function todayDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDaysToDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  const ny = date.getFullYear();
  const nm = String(date.getMonth() + 1).padStart(2, '0');
  const nd = String(date.getDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
