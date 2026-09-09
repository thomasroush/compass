import type {
  DailyNote,
  Goal,
  GoalStatus,
  Priority,
  Project,
  ProjectStatus,
  Target,
  TargetType,
  TargetValueFormat,
  Task,
  TaskStatus,
} from '../types';
import type { CloudDailyNote, CloudGoal, CloudProject, CloudTarget, CloudTask } from './types';

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  priority_rank: number | null;
  updated_at: string;
}

export function projectFromRow(row: ProjectRow): CloudProject {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status,
    priorityRank: row.priority_rank ?? undefined,
    updatedAt: row.updated_at,
  };
}

export interface ProjectInsertRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  priority_rank: number | null;
}

export function projectToInsertRow(userId: string, project: Project): ProjectInsertRow {
  return {
    id: project.id,
    user_id: userId,
    name: project.name,
    description: project.description ?? null,
    status: project.status,
    priority_rank: project.priorityRank ?? null,
  };
}

export interface ProjectUpdateRow {
  name?: string;
  description?: string | null;
  status?: ProjectStatus;
  priority_rank?: number | null;
}

export function projectUpdatesToRow(
  updates: Partial<Pick<Project, 'name' | 'description' | 'status' | 'priorityRank'>>,
): ProjectUpdateRow {
  const row: ProjectUpdateRow = {};
  // `in` (not `!== undefined`) distinguishes "field omitted" (leave unchanged)
  // from "field explicitly set to undefined" (clear it to null in the db) —
  // both look identical under `!== undefined` since the key's value is the
  // same either way, but only `in` sees whether the key was provided at all.
  if ('name' in updates) row.name = updates.name;
  if ('description' in updates) row.description = updates.description ?? null;
  if ('status' in updates) row.status = updates.status;
  if ('priorityRank' in updates) row.priority_rank = updates.priorityRank ?? null;
  return row;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export interface TaskRow {
  id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  project_id: string | null;
  priority: Priority;
  due_date: string | null;
  created_at: string;
  completed_at: string | null;
  sort_order: number;
  is_primary: boolean;
  archived: boolean;
  updated_at: string;
}

export function taskFromRow(row: TaskRow): CloudTask {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes ?? undefined,
    status: row.status,
    projectId: row.project_id ?? undefined,
    priority: row.priority,
    dueDate: row.due_date ?? undefined,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
    sortOrder: row.sort_order,
    isPrimary: row.is_primary,
    archived: row.archived,
    updatedAt: row.updated_at,
  };
}

export interface TaskInsertRow {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  project_id: string | null;
  priority: Priority;
  due_date: string | null;
  created_at: string;
  completed_at: string | null;
  sort_order: number;
  is_primary: boolean;
  archived: boolean;
}

export function taskToInsertRow(userId: string, task: Task): TaskInsertRow {
  return {
    id: task.id,
    user_id: userId,
    title: task.title,
    notes: task.notes ?? null,
    status: task.status,
    project_id: task.projectId ?? null,
    priority: task.priority,
    due_date: task.dueDate ?? null,
    created_at: task.createdAt,
    completed_at: task.completedAt ?? null,
    sort_order: task.sortOrder,
    is_primary: task.isPrimary,
    archived: task.archived,
  };
}

export interface TaskUpdateRow {
  title?: string;
  notes?: string | null;
  status?: TaskStatus;
  project_id?: string | null;
  priority?: Priority;
  due_date?: string | null;
  completed_at?: string | null;
  sort_order?: number;
  is_primary?: boolean;
  archived?: boolean;
}

export function taskUpdatesToRow(updates: Partial<Omit<Task, 'id' | 'createdAt'>>): TaskUpdateRow {
  const row: TaskUpdateRow = {};
  // See projectUpdatesToRow above: `in` distinguishes "omitted" from
  // "explicitly cleared" for the optional fields (notes, projectId, dueDate,
  // completedAt), which `?? null` then turns into a real db null — e.g. this
  // is how un-assigning a task's project (projectId: undefined) is expressed.
  if ('title' in updates) row.title = updates.title;
  if ('notes' in updates) row.notes = updates.notes ?? null;
  if ('status' in updates) row.status = updates.status;
  if ('projectId' in updates) row.project_id = updates.projectId ?? null;
  if ('priority' in updates) row.priority = updates.priority;
  if ('dueDate' in updates) row.due_date = updates.dueDate ?? null;
  if ('completedAt' in updates) row.completed_at = updates.completedAt ?? null;
  if ('sortOrder' in updates) row.sort_order = updates.sortOrder;
  if ('isPrimary' in updates) row.is_primary = updates.isPrimary;
  if ('archived' in updates) row.archived = updates.archived;
  return row;
}

// ---------------------------------------------------------------------------
// Daily notes
// ---------------------------------------------------------------------------

export interface DailyNoteRow {
  id: string;
  note_date: string;
  morning_notes: string;
  evening_notes: string;
  updated_at: string;
}

export function dailyNoteFromRow(row: DailyNoteRow): CloudDailyNote {
  return {
    id: row.id,
    date: row.note_date,
    morning: row.morning_notes,
    evening: row.evening_notes,
    updatedAt: row.updated_at,
  };
}

export interface DailyNoteInsertRow {
  id: string;
  user_id: string;
  note_date: string;
  morning_notes: string;
  evening_notes: string;
}

export function dailyNoteToInsertRow(userId: string, note: DailyNote): DailyNoteInsertRow {
  return {
    id: note.id,
    user_id: userId,
    note_date: note.date,
    morning_notes: note.morning,
    evening_notes: note.evening,
  };
}

export interface DailyNoteUpdateRow {
  morning_notes?: string;
  evening_notes?: string;
}

export function dailyNoteUpdatesToRow(
  updates: Partial<Pick<DailyNote, 'morning' | 'evening'>>,
): DailyNoteUpdateRow {
  const row: DailyNoteUpdateRow = {};
  if ('morning' in updates) row.morning_notes = updates.morning;
  if ('evening' in updates) row.evening_notes = updates.evening;
  return row;
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export interface GoalRow {
  id: string;
  name: string;
  description: string | null;
  due_date: string | null;
  priority: Priority;
  status: GoalStatus;
  project_ids: string[];
  updated_at: string;
}

export function goalFromRow(row: GoalRow): CloudGoal {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    dueDate: row.due_date ?? undefined,
    priority: row.priority,
    status: row.status,
    projectIds: row.project_ids,
    updatedAt: row.updated_at,
  };
}

export interface GoalInsertRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  due_date: string | null;
  priority: Priority;
  status: GoalStatus;
  project_ids: string[];
}

export function goalToInsertRow(userId: string, goal: Goal): GoalInsertRow {
  return {
    id: goal.id,
    user_id: userId,
    name: goal.name,
    description: goal.description ?? null,
    due_date: goal.dueDate ?? null,
    priority: goal.priority,
    status: goal.status,
    project_ids: goal.projectIds,
  };
}

export interface GoalUpdateRow {
  name?: string;
  description?: string | null;
  due_date?: string | null;
  priority?: Priority;
  status?: GoalStatus;
  project_ids?: string[];
}

export function goalUpdatesToRow(
  updates: Partial<Pick<Goal, 'name' | 'description' | 'dueDate' | 'priority' | 'status' | 'projectIds'>>,
): GoalUpdateRow {
  const row: GoalUpdateRow = {};
  if ('name' in updates) row.name = updates.name;
  if ('description' in updates) row.description = updates.description ?? null;
  if ('dueDate' in updates) row.due_date = updates.dueDate ?? null;
  if ('priority' in updates) row.priority = updates.priority;
  if ('status' in updates) row.status = updates.status;
  if ('projectIds' in updates) row.project_ids = updates.projectIds;
  return row;
}

// ---------------------------------------------------------------------------
// Targets
//
// The domain type (Target) is a discriminated union; the database row is a
// single flat table with nullable per-type columns (matching this codebase's
// existing flat-table style — see targets_type_fields_check in the schema).
// targetFromRow returns null for a row whose type-required fields are
// unexpectedly null (should never happen given that DB constraint, but the
// mapper does not trust it blindly either — mirrors validateTarget's
// defensive style in src/storage/validation.ts) — callers filter nulls out.
// ---------------------------------------------------------------------------

export interface TargetRow {
  id: string;
  goal_id: string;
  type: TargetType;
  name: string;
  sort_order: number;
  archived: boolean;
  start_value: number | null;
  current_value: number | null;
  target_value: number | null;
  unit: string | null;
  value_format: TargetValueFormat | null;
  achieved: boolean | null;
  task_ids: string[];
  updated_at: string;
}

export function targetFromRow(row: TargetRow): CloudTarget | null {
  const base = {
    id: row.id,
    goalId: row.goal_id,
    name: row.name,
    sortOrder: row.sort_order,
    archived: row.archived,
    updatedAt: row.updated_at,
  };

  if (row.type === 'numeric') {
    if (row.start_value === null || row.current_value === null || row.target_value === null) return null;
    return {
      ...base,
      type: 'numeric',
      startValue: row.start_value,
      currentValue: row.current_value,
      targetValue: row.target_value,
      unit: row.unit ?? undefined,
      valueFormat: row.value_format ?? 'number',
    };
  }

  if (row.type === 'yesno') {
    if (row.achieved === null) return null;
    return { ...base, type: 'yesno', achieved: row.achieved };
  }

  return { ...base, type: 'linked-tasks', taskIds: row.task_ids };
}

export interface TargetInsertRow {
  id: string;
  user_id: string;
  goal_id: string;
  type: TargetType;
  name: string;
  sort_order: number;
  archived: boolean;
  start_value: number | null;
  current_value: number | null;
  target_value: number | null;
  unit: string | null;
  value_format: TargetValueFormat | null;
  achieved: boolean | null;
  task_ids: string[];
}

export function targetToInsertRow(userId: string, target: Target): TargetInsertRow {
  return {
    id: target.id,
    user_id: userId,
    goal_id: target.goalId,
    type: target.type,
    name: target.name,
    sort_order: target.sortOrder,
    archived: target.archived,
    start_value: target.type === 'numeric' ? target.startValue : null,
    current_value: target.type === 'numeric' ? target.currentValue : null,
    target_value: target.type === 'numeric' ? target.targetValue : null,
    unit: target.type === 'numeric' ? (target.unit ?? null) : null,
    value_format: target.type === 'numeric' ? target.valueFormat : null,
    achieved: target.type === 'yesno' ? target.achieved : null,
    task_ids: target.type === 'linked-tasks' ? target.taskIds : [],
  };
}

export interface TargetUpdateRow {
  name?: string;
  sort_order?: number;
  archived?: boolean;
  start_value?: number | null;
  current_value?: number | null;
  target_value?: number | null;
  unit?: string | null;
  value_format?: TargetValueFormat | null;
  achieved?: boolean | null;
  task_ids?: string[];
}

/**
 * Repository-layer update input, independent of the reducer's own
 * `TargetUpdate` (src/store/reducer.ts) — this module must not depend on the
 * store layer. Includes `archived`/`sortOrder`, which the reducer models as
 * separate dedicated actions (ARCHIVE_TARGET/RESTORE_TARGET/REORDER_TARGET)
 * rather than part of its own TargetUpdate, but which are still ordinary
 * column updates from the database's point of view.
 */
export type TargetRowUpdateInput = Partial<{
  name: string;
  sortOrder: number;
  archived: boolean;
  startValue: number;
  currentValue: number;
  targetValue: number;
  unit: string | undefined;
  valueFormat: TargetValueFormat;
  achieved: boolean;
  taskIds: string[];
}>;

export function targetUpdatesToRow(updates: TargetRowUpdateInput): TargetUpdateRow {
  const row: TargetUpdateRow = {};
  if ('name' in updates) row.name = updates.name;
  if ('sortOrder' in updates) row.sort_order = updates.sortOrder;
  if ('archived' in updates) row.archived = updates.archived;
  if ('startValue' in updates) row.start_value = updates.startValue ?? null;
  if ('currentValue' in updates) row.current_value = updates.currentValue ?? null;
  if ('targetValue' in updates) row.target_value = updates.targetValue ?? null;
  if ('unit' in updates) row.unit = updates.unit ?? null;
  if ('valueFormat' in updates) row.value_format = updates.valueFormat ?? null;
  if ('achieved' in updates) row.achieved = updates.achieved ?? null;
  if ('taskIds' in updates) row.task_ids = updates.taskIds;
  return row;
}
