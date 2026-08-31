import type { Task } from '../types';
import { taskFromRow, taskToInsertRow, taskUpdatesToRow, type TaskRow } from './mappers';
import { getAuthenticatedSession } from './session';
import { makeError, type CloudTask, type RepositoryResult } from './types';

const TASK_COLUMNS =
  'id,title,notes,status,project_id,priority,due_date,created_at,completed_at,sort_order,is_primary,archived,updated_at';

export async function listTasks(): Promise<RepositoryResult<CloudTask[]>> {
  const session = await getAuthenticatedSession();
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('tasks')
    .select(TASK_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: (data as unknown as TaskRow[]).map(taskFromRow) };
}

export async function createTask(task: Task): Promise<RepositoryResult<CloudTask>> {
  const session = await getAuthenticatedSession();
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('tasks')
    .insert(taskToInsertRow(userId, task))
    .select(TASK_COLUMNS)
    .single();

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: taskFromRow(data as unknown as TaskRow) };
}

/**
 * Inserts or updates a task by its stable (user_id, id) identity. See
 * upsertProject for why this exists (migration of existing local records with
 * ids preserved) and its safety notes — the same apply here.
 */
export async function upsertTask(task: Task): Promise<RepositoryResult<CloudTask>> {
  const session = await getAuthenticatedSession();
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('tasks')
    .upsert(taskToInsertRow(userId, task), { onConflict: 'user_id,id' })
    .select(TASK_COLUMNS)
    .single();

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: taskFromRow(data as unknown as TaskRow) };
}

export async function updateTask(
  id: string,
  updates: Partial<Omit<Task, 'id' | 'createdAt'>>,
): Promise<RepositoryResult<CloudTask>> {
  const session = await getAuthenticatedSession();
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('tasks')
    .update(taskUpdatesToRow(updates))
    .eq('user_id', userId)
    .eq('id', id)
    .select(TASK_COLUMNS)
    .single();

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: taskFromRow(data as unknown as TaskRow) };
}

export async function deleteTask(id: string): Promise<RepositoryResult<void>> {
  const session = await getAuthenticatedSession();
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { error } = await client.from('tasks').delete().eq('user_id', userId).eq('id', id);

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: undefined };
}
