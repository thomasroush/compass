import type { QuickNote } from '../types';
import {
  quickNoteFromRow,
  quickNoteToInsertRow,
  quickNoteUpdatesToRow,
  type QuickNoteRow,
} from './mappers';
import { getAuthenticatedSession, getAuthenticatedSessionFor } from './session';
import { makeError, type CloudQuickNote, type RepositoryResult } from './types';

const QUICK_NOTE_COLUMNS = 'id,text,completed,deleted,created_at,completed_at,updated_at';

export async function listQuickNotes(): Promise<RepositoryResult<CloudQuickNote[]>> {
  const session = await getAuthenticatedSession();
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('quick_notes')
    .select(QUICK_NOTE_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: (data as unknown as QuickNoteRow[]).map(quickNoteFromRow) };
}

/**
 * `expectedAccountId` is required (mirrors createProject/createTask/
 * createDailyNote's own rationale — see SUPABASE_IMPLEMENTATION_PLAN.md
 * decision 13) and is routed through `getAuthenticatedSessionFor`, which
 * fails closed with a typed `'account-mismatch'` error, before any table
 * access, if the live session no longer belongs to that account.
 */
export async function createQuickNote(
  note: QuickNote,
  expectedAccountId: string,
): Promise<RepositoryResult<CloudQuickNote>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('quick_notes')
    .insert(quickNoteToInsertRow(userId, note))
    .select(QUICK_NOTE_COLUMNS)
    .single();

  if (error) {
    // Postgres's own stable code for unique_violation — see RepositoryErrorType's doc comment.
    return { ok: false, error: makeError(error.code === '23505' ? 'duplicate' : 'database', error.message) };
  }
  return { ok: true, data: quickNoteFromRow(data as unknown as QuickNoteRow) };
}

/**
 * Inserts or updates a quick note by its stable (user_id, id) identity. See
 * upsertProject for why this exists and its safety notes.
 *
 * See createQuickNote's doc comment for `expectedAccountId`'s role.
 */
export async function upsertQuickNote(
  note: QuickNote,
  expectedAccountId: string,
): Promise<RepositoryResult<CloudQuickNote>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('quick_notes')
    .upsert(quickNoteToInsertRow(userId, note), { onConflict: 'user_id,id' })
    .select(QUICK_NOTE_COLUMNS)
    .single();

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: quickNoteFromRow(data as unknown as QuickNoteRow) };
}

/** See createQuickNote's doc comment for `expectedAccountId`'s role. */
export async function updateQuickNote(
  id: string,
  updates: Partial<Pick<QuickNote, 'text' | 'completed' | 'deleted' | 'completedAt'>>,
  expectedAccountId: string,
): Promise<RepositoryResult<CloudQuickNote>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('quick_notes')
    .update(quickNoteUpdatesToRow(updates))
    .eq('user_id', userId)
    .eq('id', id)
    .select(QUICK_NOTE_COLUMNS)
    .single();

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: quickNoteFromRow(data as unknown as QuickNoteRow) };
}

/**
 * Compare-and-swap update: see updateProjectGuarded's doc comment for the
 * full mechanism and why a single conditional UPDATE (no RPC) is sufficient.
 * `expectedUpdatedAt` must be the exact `updatedAt` string previously read
 * for this note (from sync metadata), never a reformatted date.
 *
 * See createQuickNote's doc comment for `expectedAccountId`'s role.
 */
export async function updateQuickNoteGuarded(
  id: string,
  updates: Partial<Pick<QuickNote, 'text' | 'completed' | 'deleted' | 'completedAt'>>,
  expectedUpdatedAt: string,
  expectedAccountId: string,
): Promise<RepositoryResult<CloudQuickNote>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('quick_notes')
    .update(quickNoteUpdatesToRow(updates))
    .eq('user_id', userId)
    .eq('id', id)
    .eq('updated_at', expectedUpdatedAt)
    .select(QUICK_NOTE_COLUMNS)
    .maybeSingle();

  if (error) return { ok: false, error: makeError('database', error.message) };
  if (!data) {
    return {
      ok: false,
      error: makeError(
        'conflict',
        'This quick note changed on the server since it was last read on this device.',
      ),
    };
  }
  return { ok: true, data: quickNoteFromRow(data as unknown as QuickNoteRow) };
}
