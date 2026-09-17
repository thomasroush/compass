import type { Task } from '../types';
import {
  taskFromRow,
  taskFromRowWithOwner,
  taskToInsertRow,
  taskUpdatesToRow,
  type TaskRow,
  type TaskRowWithOwner,
} from './mappers';
import { getAuthenticatedSession, getAuthenticatedSessionFor } from './session';
import { makeError, type CloudTask, type RepositoryResult } from './types';

const TASK_COLUMNS =
  'id,title,notes,status,project_id,priority,due_date,due_time,created_at,completed_at,sort_order,is_primary,archived,updated_at';
const TASK_COLUMNS_WITH_OWNER =
  'id,user_id,title,notes,status,project_id,priority,due_date,due_time,created_at,completed_at,sort_order,is_primary,archived,updated_at';

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
 * Reads every Task visible to the signed-in user: their own, plus any Task
 * belonging to a shared Project they're an Editor on. See
 * `listVisibleProjects` (projectsRepository.ts) for the same rationale —
 * no `user_id` filter here either; `public.tasks`' RLS (`tasks_select_own`
 * OR `tasks_select_member`) is the sole boundary. `ownerId` is always the
 * row's real `user_id`, never assumed.
 *
 * Not called from anywhere yet — `listTasks` remains what
 * `hydrateFromCloud`/`refreshFromCloud`/`drainSync` use.
 */
export async function listVisibleTasks(): Promise<RepositoryResult<CloudTask[]>> {
  const session = await getAuthenticatedSession();
  if (!session.ok) return session;
  const { client } = session.data;

  const { data, error } = await client
    .from('tasks')
    .select(TASK_COLUMNS_WITH_OWNER)
    .order('created_at', { ascending: true });

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: (data as unknown as TaskRowWithOwner[]).map(taskFromRowWithOwner) };
}

/**
 * `expectedAccountId` is required (Phase 5B3A, task 2 of 3 — see
 * SUPABASE_IMPLEMENTATION_PLAN.md decision 13) and is routed through
 * `getAuthenticatedSessionFor`, which fails closed with a typed
 * `'account-mismatch'` error, before any table access, if the live session
 * no longer belongs to that account.
 *
 * `ownerId`, when given, is whose `user_id` the inserted row is stored
 * under — the shared Project's real Owner, for an Editor (verified as
 * `expectedAccountId`) creating a Task inside it — defaulting to the
 * caller's own id (today's private-Task behavior) when omitted. This keeps a
 * collaborative Task stored under the Project's Owner, exactly like every
 * Task that Owner creates themselves, rather than forking a second,
 * Editor-owned copy of it; `public.tasks`' `tasks_insert_member` policy (see
 * supabase/migrations/20260916120000_add_shared_project_membership.sql) is
 * what actually authorizes an Editor's insert under someone else's
 * `user_id` — this parameter only supplies which id to write, it grants no
 * privilege by itself. Not yet called with a real `ownerId` from anywhere.
 */
export async function createTask(
  task: Task,
  expectedAccountId: string,
  ownerId?: string,
): Promise<RepositoryResult<CloudTask>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('tasks')
    .insert(taskToInsertRow(ownerId ?? userId, task))
    .select(TASK_COLUMNS)
    .single();

  if (error) {
    // Postgres's own stable code for unique_violation — see RepositoryErrorType's doc comment.
    return { ok: false, error: makeError(error.code === '23505' ? 'duplicate' : 'database', error.message) };
  }
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

/**
 * See createTask's doc comment for `expectedAccountId`'s role, and for
 * `ownerId`'s role (same meaning here: targets a shared Task's real Owner
 * row for an Editor's update, via `tasks_update_member`; defaults to the
 * caller's own id otherwise).
 */
export async function updateTask(
  id: string,
  updates: Partial<Omit<Task, 'id' | 'createdAt'>>,
  expectedAccountId: string,
  ownerId?: string,
): Promise<RepositoryResult<CloudTask>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('tasks')
    .update(taskUpdatesToRow(updates))
    .eq('user_id', ownerId ?? userId)
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
 * for `expectedAccountId`'s role, and updateTask's for `ownerId`'s (the
 * compare-and-swap on `updated_at` and resulting `'conflict'` behavior are
 * unchanged either way).
 */
export async function updateTaskGuarded(
  id: string,
  updates: Partial<Omit<Task, 'id' | 'createdAt'>>,
  expectedUpdatedAt: string,
  expectedAccountId: string,
  ownerId?: string,
): Promise<RepositoryResult<CloudTask>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('tasks')
    .update(taskUpdatesToRow(updates))
    .eq('user_id', ownerId ?? userId)
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

/**
 * See createTask's doc comment for `expectedAccountId`'s role, and for
 * `ownerId`'s role (via `tasks_delete_member`, so an Editor's delete reaches
 * the shared Task's actual row).
 */
export async function deleteTask(
  id: string,
  expectedAccountId: string,
  ownerId?: string,
): Promise<RepositoryResult<void>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { error } = await client
    .from('tasks')
    .delete()
    .eq('user_id', ownerId ?? userId)
    .eq('id', id);

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: undefined };
}
