import type { DailyNote } from '../types';
import {
  dailyNoteFromRow,
  dailyNoteToInsertRow,
  dailyNoteUpdatesToRow,
  type DailyNoteRow,
} from './mappers';
import { getAuthenticatedSession } from './session';
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

export async function createDailyNote(note: DailyNote): Promise<RepositoryResult<CloudDailyNote>> {
  const session = await getAuthenticatedSession();
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('daily_notes')
    .insert(dailyNoteToInsertRow(userId, note))
    .select(DAILY_NOTE_COLUMNS)
    .single();

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: dailyNoteFromRow(data as unknown as DailyNoteRow) };
}

export async function updateDailyNote(
  id: string,
  updates: Partial<Pick<DailyNote, 'morning' | 'evening'>>,
): Promise<RepositoryResult<CloudDailyNote>> {
  const session = await getAuthenticatedSession();
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

export async function deleteDailyNote(id: string): Promise<RepositoryResult<void>> {
  const session = await getAuthenticatedSession();
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { error } = await client.from('daily_notes').delete().eq('user_id', userId).eq('id', id);

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: undefined };
}
