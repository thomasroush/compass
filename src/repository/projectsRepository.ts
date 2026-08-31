import type { Project } from '../types';
import {
  projectFromRow,
  projectToInsertRow,
  projectUpdatesToRow,
  type ProjectRow,
} from './mappers';
import { getAuthenticatedSession } from './session';
import { makeError, type CloudProject, type RepositoryResult } from './types';

const PROJECT_COLUMNS = 'id,name,description,status,updated_at';

export async function listProjects(): Promise<RepositoryResult<CloudProject[]>> {
  const session = await getAuthenticatedSession();
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('projects')
    .select(PROJECT_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: (data as unknown as ProjectRow[]).map(projectFromRow) };
}

export async function createProject(project: Project): Promise<RepositoryResult<CloudProject>> {
  const session = await getAuthenticatedSession();
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('projects')
    .insert(projectToInsertRow(userId, project))
    .select(PROJECT_COLUMNS)
    .single();

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: projectFromRow(data as unknown as ProjectRow) };
}

/**
 * Inserts or updates a project by its stable (user_id, id) identity — the same
 * composite primary key Phase 2's schema defines. Used for migrating existing
 * local records into the cloud with their ids preserved: a record that already
 * exists (same id, same authenticated user) is updated in place rather than
 * duplicated; a new one is inserted. Never accepts a user id from the caller —
 * it comes only from the live session, exactly like every other function here.
 */
export async function upsertProject(project: Project): Promise<RepositoryResult<CloudProject>> {
  const session = await getAuthenticatedSession();
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('projects')
    .upsert(projectToInsertRow(userId, project), { onConflict: 'user_id,id' })
    .select(PROJECT_COLUMNS)
    .single();

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: projectFromRow(data as unknown as ProjectRow) };
}

export async function updateProject(
  id: string,
  updates: Partial<Pick<Project, 'name' | 'description' | 'status'>>,
): Promise<RepositoryResult<CloudProject>> {
  const session = await getAuthenticatedSession();
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('projects')
    .update(projectUpdatesToRow(updates))
    .eq('user_id', userId)
    .eq('id', id)
    .select(PROJECT_COLUMNS)
    .single();

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: projectFromRow(data as unknown as ProjectRow) };
}

/**
 * Compare-and-swap update: applies `updates` only if the row's current
 * `updated_at` still equals `expectedUpdatedAt`. This is expressed as one
 * additional `.eq('updated_at', ...)` filter on the same UPDATE statement —
 * Postgres evaluates the WHERE clause and applies the write in a single
 * atomic operation, so there is no separate read-then-write step on the
 * client for another device's write to race against. See
 * SUPABASE_IMPLEMENTATION_PLAN.md Phase 5B1 for the full analysis of why this
 * does not require a database RPC. `expectedUpdatedAt` must be the exact
 * `updatedAt` string previously read for this record (from sync metadata),
 * not a reformatted or re-parsed date, so the comparison is exact.
 *
 * Not yet called from any UI or dispatch path — this is the guarded
 * primitive a future phase will wire in once live cloud writes are activated.
 */
export async function updateProjectGuarded(
  id: string,
  updates: Partial<Pick<Project, 'name' | 'description' | 'status'>>,
  expectedUpdatedAt: string,
): Promise<RepositoryResult<CloudProject>> {
  const session = await getAuthenticatedSession();
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('projects')
    .update(projectUpdatesToRow(updates))
    .eq('user_id', userId)
    .eq('id', id)
    .eq('updated_at', expectedUpdatedAt)
    .select(PROJECT_COLUMNS)
    .maybeSingle();

  if (error) return { ok: false, error: makeError('database', error.message) };
  if (!data) {
    return {
      ok: false,
      error: makeError(
        'conflict',
        'This project changed on the server since it was last read on this device.',
      ),
    };
  }
  return { ok: true, data: projectFromRow(data as unknown as ProjectRow) };
}

export async function deleteProject(id: string): Promise<RepositoryResult<void>> {
  const session = await getAuthenticatedSession();
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { error } = await client.from('projects').delete().eq('user_id', userId).eq('id', id);

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: undefined };
}
