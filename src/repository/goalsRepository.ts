import type { Goal } from '../types';
import { goalFromRow, goalToInsertRow, goalUpdatesToRow, type GoalRow } from './mappers';
import { getAuthenticatedSession, getAuthenticatedSessionFor } from './session';
import { makeError, type CloudGoal, type RepositoryResult } from './types';

/**
 * Mirrors src/repository/projectsRepository.ts exactly (same auth pattern,
 * same RepositoryResult/error shapes, same list/create/upsert/update/
 * updateGuarded shape). No deleteGoal — Goals are never hard-deleted, only
 * moved to the 'abandoned' status, same as Projects use 'archived'.
 *
 * Foundation-stage only: nothing in this app calls these functions yet (no
 * UI, no sync wiring) — see src/sync/actionProvenance.ts's doc comment on
 * why Goal/Target edits are not yet marked dirty for the drain loop to push.
 */

const GOAL_COLUMNS = 'id,name,description,due_date,priority,status,project_ids,updated_at';

export async function listGoals(): Promise<RepositoryResult<CloudGoal[]>> {
  const session = await getAuthenticatedSession();
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('goals')
    .select(GOAL_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: (data as unknown as GoalRow[]).map(goalFromRow) };
}

/** See projectsRepository.ts's createProject doc comment for `expectedAccountId`'s role. */
export async function createGoal(
  goal: Goal,
  expectedAccountId: string,
): Promise<RepositoryResult<CloudGoal>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('goals')
    .insert(goalToInsertRow(userId, goal))
    .select(GOAL_COLUMNS)
    .single();

  if (error) {
    return { ok: false, error: makeError(error.code === '23505' ? 'duplicate' : 'database', error.message) };
  }
  return { ok: true, data: goalFromRow(data as unknown as GoalRow) };
}

/** Inserts or updates a goal by its stable (user_id, id) identity. See projectsRepository.ts's upsertProject. */
export async function upsertGoal(
  goal: Goal,
  expectedAccountId: string,
): Promise<RepositoryResult<CloudGoal>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('goals')
    .upsert(goalToInsertRow(userId, goal), { onConflict: 'user_id,id' })
    .select(GOAL_COLUMNS)
    .single();

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: goalFromRow(data as unknown as GoalRow) };
}

/** See projectsRepository.ts's createProject doc comment for `expectedAccountId`'s role. */
export async function updateGoal(
  id: string,
  updates: Partial<Pick<Goal, 'name' | 'description' | 'dueDate' | 'priority' | 'status' | 'projectIds'>>,
  expectedAccountId: string,
): Promise<RepositoryResult<CloudGoal>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('goals')
    .update(goalUpdatesToRow(updates))
    .eq('user_id', userId)
    .eq('id', id)
    .select(GOAL_COLUMNS)
    .single();

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: goalFromRow(data as unknown as GoalRow) };
}

/**
 * Compare-and-swap update — see projectsRepository.ts's updateProjectGuarded
 * doc comment. Not yet called from anywhere (sync wiring for Goals/Targets is
 * a later, explicit stage).
 */
export async function updateGoalGuarded(
  id: string,
  updates: Partial<Pick<Goal, 'name' | 'description' | 'dueDate' | 'priority' | 'status' | 'projectIds'>>,
  expectedUpdatedAt: string,
  expectedAccountId: string,
): Promise<RepositoryResult<CloudGoal>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('goals')
    .update(goalUpdatesToRow(updates))
    .eq('user_id', userId)
    .eq('id', id)
    .eq('updated_at', expectedUpdatedAt)
    .select(GOAL_COLUMNS)
    .maybeSingle();

  if (error) return { ok: false, error: makeError('database', error.message) };
  if (!data) {
    return {
      ok: false,
      error: makeError(
        'conflict',
        'This goal changed on the server since it was last read on this device.',
      ),
    };
  }
  return { ok: true, data: goalFromRow(data as unknown as GoalRow) };
}
