import type { Task } from '../types';
import { taskFromRow, taskToInsertRow, taskUpdatesToRow, type TaskRow } from './mappers';
import { getAuthenticatedSession, getAuthenticatedSessionFor } from './session';
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

/**
 * `expectedAccountId` is required (Phase 5B3A, task 2 of 3 — see
 * SUPABASE_IMPLEMENTATION_PLAN.md decision 13) and is routed through
 * `getAuthenticatedSessionFor`, which fails closed with a typed
 * `'account-mismatch'` error, before any table access, if the live session
 * no longer belongs to that account.
 */
export async function createTask(
  task: Task,
  expectedAccountId: string,
): Promise<RepositoryResult<CloudTask>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
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
 * upsertProject (projectsRepository.ts) for why this exists (migration of
 * existing local records with ids preserved) and for `expectedAccountId`'s
 * role — the same rationale and safety notes apply here.
 */
export async function upsertTask(
  task: Task,
  expectedAccountId: string,
): Promise<RepositoryResult<CloudTask>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
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

/** See createTask's doc comment for `expectedAccountId`'s role. */
export async function updateTask(
  id: string,
  updates: Partial<Omit<Task, 'id' | 'createdAt'>>,
  expectedAccountId: string,
): Promise<RepositoryResult<CloudTask>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
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

/**
 * Compare-and-swap update: see updateProjectGuarded's doc comment for the
 * full mechanism and why a single conditional UPDATE (no RPC) is sufficient.
 * `expectedUpdatedAt` must be the exact `updatedAt` string previously read
 * for this task (from sync metadata), never a reformatted date.
 *
 * Not yet called from any UI or dispatch path. See createTask's doc comment
 * for `expectedAccountId`'s role.
 */
export async function updateTaskGuarded(
  id: string,
  updates: Partial<Omit<Task, 'id' | 'createdAt'>>,
  expectedUpdatedAt: string,
  expectedAccountId: string,
): Promise<RepositoryResult<CloudTask>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('tasks')
    .update(taskUpdatesToRow(updates))
    .eq('user_id', userId)
    .eq('id', id)
    .eq('updated_at', expectedUpdatedAt)
    .select(TASK_COLUMNS)
    .maybeSingle();

  if (error) return { ok: false, error: makeError('database', error.message) };
  if (!data) {
    return {
      ok: false,
      error: makeError(
        'conflict',
        'This task changed on the server since it was last read on this device.',
      ),
    };
  }
  return { ok: true, data: taskFromRow(data as unknown as TaskRow) };
}

/** See createTask's doc comment for `expectedAccountId`'s role. */
export async function deleteTask(
  id: string,
  expectedAccountId: string,
): Promise<RepositoryResult<void>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { error } = await client.from('tasks').delete().eq('user_id', userId).eq('id', id);

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: undefined };
}
