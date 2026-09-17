import {
  AppData,
  createEmptyAppData,
  GOAL_STATUSES,
  Goal,
  GoalStatus,
  PRIORITIES,
  PROJECT_STATUSES,
  Project,
  QuickNote,
  TARGET_TYPES,
  TARGET_VALUE_FORMATS,
  TASK_STATUSES,
  Target,
  TargetType,
  TargetValueFormat,
  Task,
  TaskStatus,
  generateId,
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
  if (t.dueTime !== undefined && !isString(t.dueTime)) return null;
  if (t.completedAt !== undefined && !isString(t.completedAt)) return null;
  // Backward compatibility: existing locally stored Tasks predate ownerId
  // and simply won't have the key at all — that must load exactly as before,
  // never be rejected. When present, it must be a plain string; an invalid
  // value is dropped (falls through to undefined) rather than failing the
  // whole record, since ownerId is provenance metadata, not something the
  // rest of the app depends on being correct to function.
  const ownerId = isString(t.ownerId) ? t.ownerId : undefined;

  return {
    id: t.id,
    title: t.title,
    notes: t.notes,
    status: t.status,
    projectId: t.projectId,
    priority: t.priority as Task['priority'],
    dueDate: t.dueDate,
    dueTime: t.dueTime,
    createdAt: t.createdAt,
    completedAt: t.completedAt,
    sortOrder: t.sortOrder,
    isPrimary: t.isPrimary,
    archived: t.archived,
    ownerId,
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
  // See validateTask's matching comment: same backward-compatibility and
  // lenient-drop-if-invalid handling, applied to Project.
  const ownerId = isString(p.ownerId) ? p.ownerId : undefined;

  return {
    id: p.id,
    name: p.name,
    description: p.description,
    status: p.status as Project['status'],
    priorityRank: p.priorityRank,
    ownerId,
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

function validateQuickNote(value: unknown): QuickNote | null {
  if (!value || typeof value !== 'object') return null;
  const n = value as Record<string, unknown>;
  if (!isString(n.id) || !n.id) return null;
  if (!isString(n.text)) return null;
  if (!isBoolean(n.completed)) return null;
  if (!isBoolean(n.deleted)) return null;
  if (!isString(n.createdAt)) return null;
  if (n.completedAt !== undefined && !isString(n.completedAt)) return null;

  return {
    id: n.id,
    text: n.text,
    completed: n.completed,
    deleted: n.deleted,
    createdAt: n.createdAt,
    completedAt: n.completedAt,
  };
}

/**
 * Best-effort, one-time conversion of the retired Daily Notes feature's
 * records (`{ id, date, morning, evening }`, keyed under the old `dailyNotes`
 * field) into the new Quick Notes shape, for a backup/localStorage payload
 * saved before this migration existed. Only runs when `quickNotes` itself is
 * absent — once a payload has been saved under the new shape, the old key is
 * never consulted again, even if still present. Blank (both fields empty)
 * daily notes carry no content and are dropped, matching how the retired
 * feature's own autosave-created blanks were never treated as real data
 * (see the former sync/hydrateFromCloud.ts isMeaningfulDailyNote). Every
 * migrated note starts unread in the active list (not completed, not
 * deleted) so the user notices and can act on it, rather than being silently
 * folded away.
 */
function migrateLegacyDailyNotes(rawNotes: unknown): QuickNote[] {
  if (!Array.isArray(rawNotes)) return [];
  const migrated: QuickNote[] = [];
  for (const value of rawNotes) {
    if (!value || typeof value !== 'object') continue;
    const n = value as Record<string, unknown>;
    const morning = isString(n.morning) ? n.morning.trim() : '';
    const evening = isString(n.evening) ? n.evening.trim() : '';
    if (!morning && !evening) continue;
    const text = [morning && `Morning: ${morning}`, evening && `Evening: ${evening}`]
      .filter(Boolean)
      .join(' / ');
    const date = isString(n.date) ? n.date : undefined;
    migrated.push({
      id: generateId(),
      text,
      completed: false,
      deleted: false,
      createdAt: date ? `${date}T00:00:00.000Z` : new Date().toISOString(),
    });
  }
  return migrated;
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

  // Backward compatibility: a payload saved before Quick Notes replaced Daily
  // Notes has no `quickNotes` key at all (only the retired `dailyNotes`
  // shape, converted below) — treat a missing key as "nothing saved under
  // the new shape yet", but still reject it when present with the wrong type.
  if (obj.quickNotes !== undefined && !Array.isArray(obj.quickNotes)) {
    return { ok: false, error: 'Quick notes must be an array.' };
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

  let quickNotes: QuickNote[];
  if (obj.quickNotes !== undefined) {
    quickNotes = [];
    for (let i = 0; i < (obj.quickNotes as unknown[]).length; i++) {
      const note = validateQuickNote((obj.quickNotes as unknown[])[i]);
      if (!note) {
        return { ok: false, error: `Invalid quick note at index ${i}.` };
      }
      quickNotes.push(note);
    }
  } else {
    quickNotes = migrateLegacyDailyNotes(obj.dailyNotes);
  }

  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) {
      return { ok: false, error: `Duplicate task id: ${task.id}.` };
    }
    ids.add(task.id);
  }

  const quickNoteIds = new Set<string>();
  for (const note of quickNotes) {
    if (quickNoteIds.has(note.id)) {
      return { ok: false, error: `Duplicate quick note id: ${note.id}.` };
    }
    quickNoteIds.add(note.id);
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
    data: { version: 1, tasks, projects, quickNotes, goals, targets },
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
