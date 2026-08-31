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

export async function deleteProject(id: string): Promise<RepositoryResult<void>> {
  const session = await getAuthenticatedSession();
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { error } = await client.from('projects').delete().eq('user_id', userId).eq('id', id);

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: undefined };
}
