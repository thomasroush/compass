import {
  AppData,
  createEmptyAppData,
  DailyNote,
  GOAL_STATUSES,
  Goal,
  GoalStatus,
  PRIORITIES,
  PROJECT_STATUSES,
  Project,
  TARGET_TYPES,
  TARGET_VALUE_FORMATS,
  TASK_STATUSES,
  Target,
  TargetType,
  TargetValueFormat,
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
  if (p.priorityRank !== undefined && (!isNumber(p.priorityRank) || p.priorityRank <= 0))
    return null;

  return {
    id: p.id,
    name: p.name,
    description: p.description,
    status: p.status as Project['status'],
    priorityRank: p.priorityRank,
  };
}

function isGoalStatus(value: unknown): value is GoalStatus {
  return isString(value) && (GOAL_STATUSES as readonly string[]).includes(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function validateGoal(value: unknown): Goal | null {
  if (!value || typeof value !== 'object') return null;
  const g = value as Record<string, unknown>;
  if (!isString(g.id) || !g.id) return null;
  if (!isString(g.name)) return null;
  if (!isString(g.priority) || !(PRIORITIES as readonly string[]).includes(g.priority)) return null;
  if (!isGoalStatus(g.status)) return null;
  if (!isOptionalString(g.description)) return null;
  if (g.dueDate !== undefined && !isString(g.dueDate)) return null;
  if (!isStringArray(g.projectIds)) return null;

  return {
    id: g.id,
    name: g.name,
    description: g.description,
    dueDate: g.dueDate as string | undefined,
    priority: g.priority as Goal['priority'],
    status: g.status,
    projectIds: g.projectIds,
  };
}

function isTargetType(value: unknown): value is TargetType {
  return isString(value) && (TARGET_TYPES as readonly string[]).includes(value);
}

function isTargetValueFormat(value: unknown): value is TargetValueFormat {
  return isString(value) && (TARGET_VALUE_FORMATS as readonly string[]).includes(value);
}

function validateTarget(value: unknown): Target | null {
  if (!value || typeof value !== 'object') return null;
  const t = value as Record<string, unknown>;
  if (!isString(t.id) || !t.id) return null;
  if (!isString(t.goalId) || !t.goalId) return null;
  if (!isString(t.name)) return null;
  if (!isNumber(t.sortOrder)) return null;
  if (!isBoolean(t.archived)) return null;
  if (!isTargetType(t.type)) return null;

  const base = { id: t.id, goalId: t.goalId, name: t.name, sortOrder: t.sortOrder, archived: t.archived };

  if (t.type === 'numeric') {
    if (!isNumber(t.startValue) || !isNumber(t.currentValue) || !isNumber(t.targetValue)) return null;
    if (!isOptionalString(t.unit)) return null;
    if (t.valueFormat !== undefined && !isTargetValueFormat(t.valueFormat)) return null;
    return {
      ...base,
      type: 'numeric',
      startValue: t.startValue,
      currentValue: t.currentValue,
      targetValue: t.targetValue,
      unit: t.unit,
      valueFormat: (t.valueFormat as TargetValueFormat | undefined) ?? 'number',
    };
  }

  if (t.type === 'yesno') {
    if (!isBoolean(t.achieved)) return null;
    return { ...base, type: 'yesno', achieved: t.achieved };
  }

  // 'linked-tasks'
  if (!isStringArray(t.taskIds)) return null;
  return { ...base, type: 'linked-tasks', taskIds: t.taskIds };
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

  // Backward compatibility: a backup taken before Goals/Targets existed has
  // no `goals`/`targets` key at all — treat that as an empty array, but
  // still reject the key when present with the wrong shape.
  if (obj.goals !== undefined && !Array.isArray(obj.goals)) {
    return { ok: false, error: 'Goals must be an array.' };
  }
  if (obj.targets !== undefined && !Array.isArray(obj.targets)) {
    return { ok: false, error: 'Targets must be an array.' };
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

  const rawGoals = Array.isArray(obj.goals) ? obj.goals : [];
  const goals: Goal[] = [];
  for (let i = 0; i < rawGoals.length; i++) {
    const goal = validateGoal(rawGoals[i]);
    if (!goal) {
      return { ok: false, error: `Invalid goal at index ${i}.` };
    }
    goals.push(goal);
  }

  const rawTargets = Array.isArray(obj.targets) ? obj.targets : [];
  const targets: Target[] = [];
  for (let i = 0; i < rawTargets.length; i++) {
    const target = validateTarget(rawTargets[i]);
    if (!target) {
      return { ok: false, error: `Invalid target at index ${i}.` };
    }
    targets.push(target);
  }

  const goalIds = new Set<string>();
  for (const goal of goals) {
    if (goalIds.has(goal.id)) {
      return { ok: false, error: `Duplicate goal id: ${goal.id}.` };
    }
    goalIds.add(goal.id);
  }

  const targetIds = new Set<string>();
  for (const target of targets) {
    if (targetIds.has(target.id)) {
      return { ok: false, error: `Duplicate target id: ${target.id}.` };
    }
    targetIds.add(target.id);
  }

  return {
    ok: true,
    data: { version: 1, tasks, projects, dailyNotes, goals, targets },
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
