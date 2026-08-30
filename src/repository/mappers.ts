import type { DailyNote, Priority, Project, ProjectStatus, Task, TaskStatus } from '../types';
import type { CloudDailyNote, CloudProject, CloudTask } from './types';

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  updated_at: string;
}

export function projectFromRow(row: ProjectRow): CloudProject {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

export interface ProjectInsertRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
}

export function projectToInsertRow(userId: string, project: Project): ProjectInsertRow {
  return {
    id: project.id,
    user_id: userId,
    name: project.name,
    description: project.description ?? null,
    status: project.status,
  };
}

export interface ProjectUpdateRow {
  name?: string;
  description?: string | null;
  status?: ProjectStatus;
}

export function projectUpdatesToRow(
  updates: Partial<Pick<Project, 'name' | 'description' | 'status'>>,
): ProjectUpdateRow {
  const row: ProjectUpdateRow = {};
  // `in` (not `!== undefined`) distinguishes "field omitted" (leave unchanged)
  // from "field explicitly set to undefined" (clear it to null in the db) —
  // both look identical under `!== undefined` since the key's value is the
  // same either way, but only `in` sees whether the key was provided at all.
  if ('name' in updates) row.name = updates.name;
  if ('description' in updates) row.description = updates.description ?? null;
  if ('status' in updates) row.status = updates.status;
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
