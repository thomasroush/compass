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
}

export interface DailyNote {
  id: string;
  date: string;
  morning: string;
  evening: string;
}

export interface AppData {
  version: 1;
  tasks: Task[];
  projects: Project[];
  dailyNotes: DailyNote[];
}

export const STORAGE_KEY = 'daily-compass-v1';

export function createEmptyAppData(): AppData {
  return {
    version: 1,
    tasks: [],
    projects: [],
    dailyNotes: [],
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
