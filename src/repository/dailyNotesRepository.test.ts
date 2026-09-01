import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DailyNote } from '../types';

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
const from = vi.hoisted(() => vi.fn());
const createClientMock = vi.hoisted(() => vi.fn(() => ({ from })));

vi.mock('../lib/supabaseClient', () => ({
  supabase: { auth, from },
  isSupabaseConfigured: true,
}));

vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@supabase/supabase-js')>();
  return { ...actual, createClient: createClientMock };
});

import {
  createDailyNote,
  deleteDailyNote,
  listDailyNotes,
  updateDailyNote,
  updateDailyNoteGuarded,
  upsertDailyNote,
} from './dailyNotesRepository';

interface MockBuilder {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise<unknown>;
}

function makeBuilder(result: { data: unknown; error: unknown }): MockBuilder {
  const builder = {} as MockBuilder;
  const self = () => builder;
  builder.select = vi.fn(self);
  builder.eq = vi.fn(self);
  builder.order = vi.fn(self);
  builder.insert = vi.fn(self);
  builder.update = vi.fn(self);
  builder.upsert = vi.fn(self);
  builder.delete = vi.fn(self);
  builder.single = vi.fn(self);
  builder.maybeSingle = vi.fn(self);
  builder.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

function signIn(userId = 'user-1') {
  auth.getSession.mockResolvedValue({
    data: { session: { user: { id: userId }, access_token: `token-${userId}` } },
    error: null,
  });
}

const sampleNote: DailyNote = { id: 'n1', date: '2026-08-30', morning: 'Plan', evening: 'Review' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('dailyNotesRepository authentication requirement', () => {
  it('rejects listDailyNotes without a session, and never queries the database', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const result = await listDailyNotes();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('unauthenticated');
    expect(from).not.toHaveBeenCalled();
  });
});

describe('listDailyNotes', () => {
  it('filters to the signed-in user, selects explicit columns, and maps rows', async () => {
    signIn('user-1');
    const builder = makeBuilder({
      data: [
        {
          id: 'n1',
          note_date: '2026-08-30',
          morning_notes: 'Plan',
          evening_notes: 'Review',
          updated_at: '2026-08-30T12:00:00.000Z',
        },
      ],
      error: null,
    });
    from.mockReturnValue(builder);

    const result = await listDailyNotes();

    expect(from).toHaveBeenCalledWith('daily_notes');
    expect(builder.select).toHaveBeenCalledWith(expect.not.stringContaining('*'));
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(result).toEqual({
      ok: true,
      data: [
        {
          id: 'n1',
          date: '2026-08-30',
          morning: 'Plan',
          evening: 'Review',
          updatedAt: '2026-08-30T12:00:00.000Z',
        },
      ],
    });
  });

  it('returns an empty list, not an error, when the user has no daily notes', async () => {
    signIn();
    from.mockReturnValue(makeBuilder({ data: [], error: null }));
    expect(await listDailyNotes()).toEqual({ ok: true, data: [] });
  });

  it('surfaces a database failure as a typed error', async () => {
    signIn();
    from.mockReturnValue(makeBuilder({ data: null, error: { message: 'permission denied' } }));
    const result = await listDailyNotes();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('database');
  });
});

describe('createDailyNote', () => {
  it('inserts a row owned by the authenticated user', async () => {
    signIn('user-1');
    const builder = makeBuilder({
      data: {
        id: 'n1',
        note_date: '2026-08-30',
        morning_notes: 'Plan',
        evening_notes: 'Review',
        updated_at: 'ts',
      },
      error: null,
    });
    from.mockReturnValue(builder);

    await createDailyNote(sampleNote, 'user-1');

    expect(builder.insert).toHaveBeenCalledWith({
      id: 'n1',
      user_id: 'user-1',
      note_date: '2026-08-30',
      morning_notes: 'Plan',
      evening_notes: 'Review',
    });
  });

  it('surfaces a duplicate-date failure (unique (user_id, note_date)) without a code as a generic typed error', async () => {
    signIn();
    from.mockReturnValue(
      makeBuilder({
        data: null,
        error: { message: 'duplicate key value violates unique constraint "daily_notes_user_date_unique"' },
      }),
    );
    const result = await createDailyNote(sampleNote, 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('database');
  });

  it('classifies a unique-violation (Postgres code 23505) as a typed duplicate error, not a generic database error', async () => {
    signIn();
    from.mockReturnValue(
      makeBuilder({
        data: null,
        error: { message: 'duplicate key value violates unique constraint "daily_notes_pkey"', code: '23505' },
      }),
    );
    const result = await createDailyNote(sampleNote, 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('duplicate');
  });

  it('fails closed with account-mismatch, and never queries the database, when the live session belongs to a different account', async () => {
    signIn('user-2');
    const result = await createDailyNote(sampleNote, 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('account-mismatch');
    expect(from).not.toHaveBeenCalled();
  });
});

describe('upsertDailyNote', () => {
  it('upserts by (user_id, id), preserving the given id', async () => {
    signIn('user-1');
    const builder = makeBuilder({
      data: {
        id: 'stable-note-1',
        note_date: '2026-08-30',
        morning_notes: 'Plan',
        evening_notes: 'Review',
        updated_at: 'ts',
      },
      error: null,
    });
    from.mockReturnValue(builder);

    const note: DailyNote = { ...sampleNote, id: 'stable-note-1' };
    const result = await upsertDailyNote(note, 'user-1');

    expect(builder.upsert).toHaveBeenCalledWith(
      { id: 'stable-note-1', user_id: 'user-1', note_date: '2026-08-30', morning_notes: 'Plan', evening_notes: 'Review' },
      { onConflict: 'user_id,id' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.id).toBe('stable-note-1');
  });

  it('rejects without a session, and never queries the database', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const result = await upsertDailyNote(sampleNote, 'user-1');
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it('surfaces a database failure (e.g. a colliding note_date) as a typed error', async () => {
    signIn();
    from.mockReturnValue(
      makeBuilder({ data: null, error: { message: 'duplicate key value violates unique constraint "daily_notes_user_date_unique"' } }),
    );
    const result = await upsertDailyNote(sampleNote, 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('database');
  });

  it('fails closed with account-mismatch, and never queries the database, when the live session belongs to a different account', async () => {
    signIn('user-2');
    const result = await upsertDailyNote(sampleNote, 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('account-mismatch');
    expect(from).not.toHaveBeenCalled();
  });
});

describe('updateDailyNote', () => {
  it('filters by both user_id and id, and sends only the changed field', async () => {
    signIn('user-1');
    const builder = makeBuilder({
      data: {
        id: 'n1',
        note_date: '2026-08-30',
        morning_notes: 'Plan',
        evening_notes: 'Updated',
        updated_at: 'ts2',
      },
      error: null,
    });
    from.mockReturnValue(builder);

    await updateDailyNote('n1', { evening: 'Updated' }, 'user-1');

    expect(builder.update).toHaveBeenCalledWith({ evening_notes: 'Updated' });
    expect(builder.eq).toHaveBeenNthCalledWith(1, 'user_id', 'user-1');
    expect(builder.eq).toHaveBeenNthCalledWith(2, 'id', 'n1');
  });

  it('surfaces a database failure as a typed error', async () => {
    signIn();
    from.mockReturnValue(makeBuilder({ data: null, error: { message: 'row not found' } }));
    const result = await updateDailyNote('missing', { morning: 'X' }, 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('database');
  });

  it('fails closed with account-mismatch, and never queries the database, when the live session belongs to a different account', async () => {
    signIn('user-2');
    const result = await updateDailyNote('n1', { evening: 'Updated' }, 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('account-mismatch');
    expect(from).not.toHaveBeenCalled();
  });
});

describe('updateDailyNoteGuarded', () => {
  it('applies the update when the expected updated_at still matches, filtering by user_id, id, and updated_at', async () => {
    signIn('user-1');
    const builder = makeBuilder({
      data: {
        id: 'n1',
        note_date: '2026-08-30',
        morning_notes: 'Plan',
        evening_notes: 'Updated',
        updated_at: 'ts2',
      },
      error: null,
    });
    from.mockReturnValue(builder);

    const result = await updateDailyNoteGuarded('n1', { evening: 'Updated' }, 'ts1', 'user-1');

    expect(builder.update).toHaveBeenCalledWith({ evening_notes: 'Updated' });
    expect(builder.eq).toHaveBeenNthCalledWith(1, 'user_id', 'user-1');
    expect(builder.eq).toHaveBeenNthCalledWith(2, 'id', 'n1');
    expect(builder.eq).toHaveBeenNthCalledWith(3, 'updated_at', 'ts1');
    expect(builder.maybeSingle).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('reports a typed conflict, not a database error, when the row changed since it was last read', async () => {
    signIn('user-1');
    // maybeSingle() resolves with no error and null data when zero rows match the filter.
    from.mockReturnValue(makeBuilder({ data: null, error: null }));

    const result = await updateDailyNoteGuarded('n1', { evening: 'Updated' }, 'stale-timestamp', 'user-1');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('conflict');
  });

  it('surfaces a real database failure distinctly from a conflict', async () => {
    signIn('user-1');
    from.mockReturnValue(makeBuilder({ data: null, error: { message: 'permission denied' } }));

    const result = await updateDailyNoteGuarded('n1', { evening: 'Updated' }, 'ts1', 'user-1');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('database');
  });

  it('rejects without a session, and never queries the database', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const result = await updateDailyNoteGuarded('n1', { evening: 'Updated' }, 'ts1', 'user-1');
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it('fails closed with account-mismatch, and never queries the database, when the live session belongs to a different account', async () => {
    signIn('user-2');
    const result = await updateDailyNoteGuarded('n1', { evening: 'Updated' }, 'ts1', 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('account-mismatch');
    expect(from).not.toHaveBeenCalled();
  });
});

describe('deleteDailyNote', () => {
  it('filters the delete by both user_id and id', async () => {
    signIn('user-1');
    const builder = makeBuilder({ data: null, error: null });
    from.mockReturnValue(builder);

    const result = await deleteDailyNote('n1', 'user-1');

    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenNthCalledWith(1, 'user_id', 'user-1');
    expect(builder.eq).toHaveBeenNthCalledWith(2, 'id', 'n1');
    expect(result).toEqual({ ok: true, data: undefined });
  });

  it('surfaces a database failure as a typed error', async () => {
    signIn();
    from.mockReturnValue(makeBuilder({ data: null, error: { message: 'permission denied' } }));
    const result = await deleteDailyNote('n1', 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('database');
  });

  it('fails closed with account-mismatch, and never queries the database, when the live session belongs to a different account', async () => {
    signIn('user-2');
    const result = await deleteDailyNote('n1', 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('account-mismatch');
    expect(from).not.toHaveBeenCalled();
  });
});
