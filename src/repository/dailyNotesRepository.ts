import type { DailyNote } from '../types';
import {
  dailyNoteFromRow,
  dailyNoteToInsertRow,
  dailyNoteUpdatesToRow,
  type DailyNoteRow,
} from './mappers';
import { getAuthenticatedSession, getAuthenticatedSessionFor } from './session';
import { makeError, type CloudDailyNote, type RepositoryResult } from './types';

const DAILY_NOTE_COLUMNS = 'id,note_date,morning_notes,evening_notes,updated_at';

export async function listDailyNotes(): Promise<RepositoryResult<CloudDailyNote[]>> {
  const session = await getAuthenticatedSession();
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('daily_notes')
    .select(DAILY_NOTE_COLUMNS)
    .eq('user_id', userId)
    .order('note_date', { ascending: true });

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: (data as unknown as DailyNoteRow[]).map(dailyNoteFromRow) };
}

/**
 * `expectedAccountId` is required (Phase 5B3A, task 2 of 3 — see
 * SUPABASE_IMPLEMENTATION_PLAN.md decision 13) and is routed through
 * `getAuthenticatedSessionFor`, which fails closed with a typed
 * `'account-mismatch'` error, before any table access, if the live session
 * no longer belongs to that account.
 */
export async function createDailyNote(
  note: DailyNote,
  expectedAccountId: string,
): Promise<RepositoryResult<CloudDailyNote>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('daily_notes')
    .insert(dailyNoteToInsertRow(userId, note))
    .select(DAILY_NOTE_COLUMNS)
    .single();

  if (error) {
    // Postgres's own stable code for unique_violation — see RepositoryErrorType's doc comment.
    // Note: this table also has a unique (user_id, note_date) constraint independent of id,
    // so a 'duplicate' here doesn't always mean *this id* already exists — callers that look
    // the id up afterward and don't find it are expected to treat that as unresolved, not assume it.
    return { ok: false, error: makeError(error.code === '23505' ? 'duplicate' : 'database', error.message) };
  }
  return { ok: true, data: dailyNoteFromRow(data as unknown as DailyNoteRow) };
}

/**
 * Inserts or updates a daily note by its stable (user_id, id) identity. See
 * upsertProject for why this exists and its safety notes. Note: `daily_notes`
 * also has a unique (user_id, note_date) constraint independent of id — if a
 * local note's date collides with a different existing cloud note id, this
 * call fails with a database error (reported per-record by the migration
 * caller) rather than silently overwriting the other record.
 *
 * See upsertProject (projectsRepository.ts) for `expectedAccountId`'s role —
 * the same rationale and safety notes apply here.
 */
export async function upsertDailyNote(
  note: DailyNote,
  expectedAccountId: string,
): Promise<RepositoryResult<CloudDailyNote>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('daily_notes')
    .upsert(dailyNoteToInsertRow(userId, note), { onConflict: 'user_id,id' })
    .select(DAILY_NOTE_COLUMNS)
    .single();

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: dailyNoteFromRow(data as unknown as DailyNoteRow) };
}

/** See createDailyNote's doc comment for `expectedAccountId`'s role. */
export async function updateDailyNote(
  id: string,
  updates: Partial<Pick<DailyNote, 'morning' | 'evening'>>,
  expectedAccountId: string,
): Promise<RepositoryResult<CloudDailyNote>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('daily_notes')
    .update(dailyNoteUpdatesToRow(updates))
    .eq('user_id', userId)
    .eq('id', id)
    .select(DAILY_NOTE_COLUMNS)
    .single();

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: dailyNoteFromRow(data as unknown as DailyNoteRow) };
}

/**
 * Compare-and-swap update: see updateProjectGuarded's doc comment for the
 * full mechanism and why a single conditional UPDATE (no RPC) is sufficient.
 * `expectedUpdatedAt` must be the exact `updatedAt` string previously read
 * for this note (from sync metadata), never a reformatted date.
 *
 * Not yet called from any UI or dispatch path. See createDailyNote's doc
 * comment for `expectedAccountId`'s role.
 */
export async function updateDailyNoteGuarded(
  id: string,
  updates: Partial<Pick<DailyNote, 'morning' | 'evening'>>,
  expectedUpdatedAt: string,
  expectedAccountId: string,
): Promise<RepositoryResult<CloudDailyNote>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('daily_notes')
    .update(dailyNoteUpdatesToRow(updates))
    .eq('user_id', userId)
    .eq('id', id)
    .eq('updated_at', expectedUpdatedAt)
    .select(DAILY_NOTE_COLUMNS)
    .maybeSingle();

  if (error) return { ok: false, error: makeError('database', error.message) };
  if (!data) {
    return {
      ok: false,
      error: makeError(
        'conflict',
        'This daily note changed on the server since it was last read on this device.',
      ),
    };
  }
  return { ok: true, data: dailyNoteFromRow(data as unknown as DailyNoteRow) };
}

/** See createDailyNote's doc comment for `expectedAccountId`'s role. */
export async function deleteDailyNote(
  id: string,
  expectedAccountId: string,
): Promise<RepositoryResult<void>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { error } = await client.from('daily_notes').delete().eq('user_id', userId).eq('id', id);

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: undefined };
}
