import {
  AppData,
  createEmptyAppData,
  DailyNote,
  PRIORITIES,
  PROJECT_STATUSES,
  Project,
  TASK_STATUSES,
  Task,
  TaskStatus,
} from '../types';

export type ValidationResult =
  | { ok: true; data: AppData }
  | { ok: false; error: string };

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value);
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return isString(value) && (TASK_STATUSES as readonly string[]).includes(value);
}

function validateTask(value: unknown): Task | null {
  if (!value || typeof value !== 'object') return null;
  const t = value as Record<string, unknown>;
  if (!isString(t.id) || !t.id) return null;
  if (!isString(t.title)) return null;
  if (!isTaskStatus(t.status)) return null;
  if (!isString(t.priority) || !(PRIORITIES as readonly string[]).includes(t.priority))
    return null;
  if (!isString(t.createdAt)) return null;
  if (!isNumber(t.sortOrder)) return null;
  if (!isBoolean(t.isPrimary)) return null;
  if (!isBoolean(t.archived)) return null;
  if (!isOptionalString(t.notes)) return null;
  if (t.projectId !== undefined && !isString(t.projectId)) return null;
  if (t.dueDate !== undefined && !isString(t.dueDate)) return null;
  if (t.completedAt !== undefined && !isString(t.completedAt)) return null;

  return {
    id: t.id,
    title: t.title,
    notes: t.notes,
    status: t.status,
    projectId: t.projectId,
    priority: t.priority as Task['priority'],
    dueDate: t.dueDate,
    createdAt: t.createdAt,
    completedAt: t.completedAt,
    sortOrder: t.sortOrder,
    isPrimary: t.isPrimary,
    archived: t.archived,
  };
}

function validateProject(value: unknown): Project | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (!isString(p.id) || !p.id) return null;
  if (!isString(p.name)) return null;
  if (!isString(p.status) || !(PROJECT_STATUSES as readonly string[]).includes(p.status))
    return null;
  if (p.description !== undefined && !isString(p.description)) return null;

  return {
    id: p.id,
    name: p.name,
    description: p.description,
    status: p.status as Project['status'],
  };
}

function validateDailyNote(value: unknown): DailyNote | null {
  if (!value || typeof value !== 'object') return null;
  const n = value as Record<string, unknown>;
  if (!isString(n.id) || !n.id) return null;
  if (!isString(n.date)) return null;
  if (!isString(n.morning)) return null;
  if (!isString(n.evening)) return null;

  return {
    id: n.id,
    date: n.date,
    morning: n.morning,
    evening: n.evening,
  };
}

export function validateAppData(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Data must be an object.' };
  }

  const obj = raw as Record<string, unknown>;

  if (obj.version !== 1) {
    return { ok: false, error: 'Unsupported data version.' };
  }

  if (!Array.isArray(obj.tasks)) {
    return { ok: false, error: 'Tasks must be an array.' };
  }

  if (!Array.isArray(obj.projects)) {
    return { ok: false, error: 'Projects must be an array.' };
  }

  if (!Array.isArray(obj.dailyNotes)) {
    return { ok: false, error: 'Daily notes must be an array.' };
  }

  const tasks: Task[] = [];
  for (let i = 0; i < obj.tasks.length; i++) {
    const task = validateTask(obj.tasks[i]);
    if (!task) {
      return { ok: false, error: `Invalid task at index ${i}.` };
    }
    tasks.push(task);
  }

  const projects: Project[] = [];
  for (let i = 0; i < obj.projects.length; i++) {
    const project = validateProject(obj.projects[i]);
    if (!project) {
      return { ok: false, error: `Invalid project at index ${i}.` };
    }
    projects.push(project);
  }

  const dailyNotes: DailyNote[] = [];
  for (let i = 0; i < obj.dailyNotes.length; i++) {
    const note = validateDailyNote(obj.dailyNotes[i]);
    if (!note) {
      return { ok: false, error: `Invalid daily note at index ${i}.` };
    }
    dailyNotes.push(note);
  }

  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) {
      return { ok: false, error: `Duplicate task id: ${task.id}.` };
    }
    ids.add(task.id);
  }

  return {
    ok: true,
    data: { version: 1, tasks, projects, dailyNotes },
  };
}

export function parseJsonAppData(json: string): ValidationResult {
  try {
    const parsed: unknown = JSON.parse(json);
    return validateAppData(parsed);
  } catch {
    return { ok: false, error: 'Invalid JSON.' };
  }
}

export function loadFromStorageString(raw: string | null): AppData {
  if (!raw) return createEmptyAppData();
  const result = parseJsonAppData(raw);
  if (!result.ok) {
    console.warn('Stored data invalid:', result.error);
    return createEmptyAppData();
  }
  return result.data;
}
