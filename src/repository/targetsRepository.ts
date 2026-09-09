import type { Target } from '../types';
import {
  targetFromRow,
  targetToInsertRow,
  targetUpdatesToRow,
  type TargetRow,
  type TargetRowUpdateInput,
} from './mappers';
import { getAuthenticatedSession, getAuthenticatedSessionFor } from './session';
import { makeError, type CloudTarget, type RepositoryResult } from './types';

/**
 * Mirrors src/repository/projectsRepository.ts exactly. No deleteTarget —
 * Targets use Archive/Restore only (an ordinary `archived` field update via
 * updateTarget/updateTargetGuarded), never a hard delete.
 *
 * Foundation-stage only: nothing in this app calls these functions yet.
 */

const TARGET_COLUMNS =
  'id,goal_id,type,name,sort_order,archived,start_value,current_value,target_value,unit,value_format,achieved,task_ids,updated_at';

/** Rows whose type-required fields fail their own DB constraint are dropped, not surfaced as invalid data — see targetFromRow's doc comment. */
function rowsToTargets(rows: TargetRow[]): CloudTarget[] {
  return rows.map(targetFromRow).filter((t): t is CloudTarget => t !== null);
}

export async function listTargets(): Promise<RepositoryResult<CloudTarget[]>> {
  const session = await getAuthenticatedSession();
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('targets')
    .select(TARGET_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: rowsToTargets(data as unknown as TargetRow[]) };
}

/** See projectsRepository.ts's createProject doc comment for `expectedAccountId`'s role. */
export async function createTarget(
  target: Target,
  expectedAccountId: string,
): Promise<RepositoryResult<CloudTarget>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('targets')
    .insert(targetToInsertRow(userId, target))
    .select(TARGET_COLUMNS)
    .single();

  if (error) {
    return { ok: false, error: makeError(error.code === '23505' ? 'duplicate' : 'database', error.message) };
  }
  const mapped = targetFromRow(data as unknown as TargetRow);
  if (!mapped) {
    return { ok: false, error: makeError('database', 'Server returned a target row with an unexpected shape.') };
  }
  return { ok: true, data: mapped };
}

/** Inserts or updates a target by its stable (user_id, id) identity. See projectsRepository.ts's upsertProject. */
export async function upsertTarget(
  target: Target,
  expectedAccountId: string,
): Promise<RepositoryResult<CloudTarget>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('targets')
    .upsert(targetToInsertRow(userId, target), { onConflict: 'user_id,id' })
    .select(TARGET_COLUMNS)
    .single();

  if (error) return { ok: false, error: makeError('database', error.message) };
  const mapped = targetFromRow(data as unknown as TargetRow);
  if (!mapped) {
    return { ok: false, error: makeError('database', 'Server returned a target row with an unexpected shape.') };
  }
  return { ok: true, data: mapped };
}

/** See projectsRepository.ts's createProject doc comment for `expectedAccountId`'s role. */
export async function updateTarget(
  id: string,
  updates: TargetRowUpdateInput,
  expectedAccountId: string,
): Promise<RepositoryResult<CloudTarget>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('targets')
    .update(targetUpdatesToRow(updates))
    .eq('user_id', userId)
    .eq('id', id)
    .select(TARGET_COLUMNS)
    .single();

  if (error) return { ok: false, error: makeError('database', error.message) };
  const mapped = targetFromRow(data as unknown as TargetRow);
  if (!mapped) {
    return { ok: false, error: makeError('database', 'Server returned a target row with an unexpected shape.') };
  }
  return { ok: true, data: mapped };
}

/**
 * Compare-and-swap update — see projectsRepository.ts's updateProjectGuarded
 * doc comment. Not yet called from anywhere (sync wiring for Goals/Targets is
 * a later, explicit stage). Archive/Restore push through this same function
 * (an ordinary `archived: true|false` field update) once sync is activated —
 * there is no separate delete path to wire.
 */
export async function updateTargetGuarded(
  id: string,
  updates: TargetRowUpdateInput,
  expectedUpdatedAt: string,
  expectedAccountId: string,
): Promise<RepositoryResult<CloudTarget>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('targets')
    .update(targetUpdatesToRow(updates))
    .eq('user_id', userId)
    .eq('id', id)
    .eq('updated_at', expectedUpdatedAt)
    .select(TARGET_COLUMNS)
    .maybeSingle();

  if (error) return { ok: false, error: makeError('database', error.message) };
  if (!data) {
    return {
      ok: false,
      error: makeError(
        'conflict',
        'This target changed on the server since it was last read on this device.',
      ),
    };
  }
  const mapped = targetFromRow(data as unknown as TargetRow);
  if (!mapped) {
    return { ok: false, error: makeError('database', 'Server returned a target row with an unexpected shape.') };
  }
  return { ok: true, data: mapped };
}
