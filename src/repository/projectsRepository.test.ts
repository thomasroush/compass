import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Project } from '../types';

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
  createProject,
  deleteProject,
  listProjects,
  updateProject,
  updateProjectGuarded,
  upsertProject,
} from './projectsRepository';

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('projectsRepository authentication requirement', () => {
  it('rejects listProjects without a session, and never queries the database', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const result = await listProjects();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('unauthenticated');
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects createProject without a session, and never queries the database', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const result = await createProject({ id: 'p1', name: 'Home', status: 'active' }, 'user-1');
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });
});

describe('listProjects', () => {
  it('filters to the signed-in user and maps rows to the app shape', async () => {
    signIn('user-1');
    const builder = makeBuilder({
      data: [
        {
          id: 'p1',
          name: 'Home',
          description: null,
          status: 'active',
          updated_at: '2026-08-30T00:00:00.000Z',
        },
      ],
      error: null,
    });
    from.mockReturnValue(builder);

    const result = await listProjects();

    expect(from).toHaveBeenCalledWith('projects');
    expect(builder.select).toHaveBeenCalledWith(expect.not.stringContaining('*'));
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(result).toEqual({
      ok: true,
      data: [
        {
          id: 'p1',
          name: 'Home',
          description: undefined,
          status: 'active',
          updatedAt: '2026-08-30T00:00:00.000Z',
        },
      ],
    });
  });

  it('returns an empty list, not an error, when the user has no projects', async () => {
    signIn();
    from.mockReturnValue(makeBuilder({ data: [], error: null }));
    const result = await listProjects();
    expect(result).toEqual({ ok: true, data: [] });
  });

  it('surfaces a database failure as a typed error rather than throwing', async () => {
    signIn();
    from.mockReturnValue(makeBuilder({ data: null, error: { message: 'permission denied' } }));
    const result = await listProjects();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('database');
      expect(result.error.message).toBe('permission denied');
    }
  });
});

describe('createProject', () => {
  it('inserts a row owned by the authenticated user, ignoring no caller-supplied user id', async () => {
    signIn('user-1');
    const builder = makeBuilder({
      data: { id: 'p1', name: 'Home', description: 'desc', status: 'active', updated_at: 'ts' },
      error: null,
    });
    from.mockReturnValue(builder);

    const project: Project = { id: 'p1', name: 'Home', description: 'desc', status: 'active' };
    const result = await createProject(project, 'user-1');

    expect(builder.insert).toHaveBeenCalledWith({
      id: 'p1',
      user_id: 'user-1',
      name: 'Home',
      description: 'desc',
      status: 'active',
    });
    expect(result).toEqual({
      ok: true,
      data: { id: 'p1', name: 'Home', description: 'desc', status: 'active', updatedAt: 'ts' },
    });
  });

  it('surfaces a database failure (e.g. a duplicate id) as a typed error', async () => {
    signIn();
    from.mockReturnValue(
      makeBuilder({ data: null, error: { message: 'duplicate key value violates unique constraint' } }),
    );
    const result = await createProject({ id: 'p1', name: 'Home', status: 'active' }, 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('database');
  });

  it('fails closed with account-mismatch, and never queries the database, when the live session belongs to a different account', async () => {
    signIn('user-2');
    const result = await createProject({ id: 'p1', name: 'Home', status: 'active' }, 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('account-mismatch');
    expect(from).not.toHaveBeenCalled();
  });
});

describe('updateProject', () => {
  it('filters the update by both user_id and id, and sends only the changed field', async () => {
    signIn('user-1');
    const builder = makeBuilder({
      data: { id: 'p1', name: 'Renamed', description: null, status: 'active', updated_at: 'ts2' },
      error: null,
    });
    from.mockReturnValue(builder);

    const result = await updateProject('p1', { name: 'Renamed' }, 'user-1');

    expect(builder.update).toHaveBeenCalledWith({ name: 'Renamed' });
    expect(builder.eq).toHaveBeenNthCalledWith(1, 'user_id', 'user-1');
    expect(builder.eq).toHaveBeenNthCalledWith(2, 'id', 'p1');
    expect(result.ok).toBe(true);
  });

  it('surfaces a database failure as a typed error', async () => {
    signIn();
    from.mockReturnValue(makeBuilder({ data: null, error: { message: 'row not found' } }));
    const result = await updateProject('missing', { name: 'X' }, 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('database');
  });

  it('fails closed with account-mismatch, and never queries the database, when the live session belongs to a different account', async () => {
    signIn('user-2');
    const result = await updateProject('p1', { name: 'Renamed' }, 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('account-mismatch');
    expect(from).not.toHaveBeenCalled();
  });
});

describe('upsertProject', () => {
  it('upserts by (user_id, id), preserving the given id rather than generating a new one', async () => {
    signIn('user-1');
    const builder = makeBuilder({
      data: { id: 'existing-id-123', name: 'Home', description: null, status: 'active', updated_at: 'ts' },
      error: null,
    });
    from.mockReturnValue(builder);

    const project: Project = { id: 'existing-id-123', name: 'Home', status: 'active' };
    const result = await upsertProject(project, 'user-1');

    expect(builder.upsert).toHaveBeenCalledWith(
      { id: 'existing-id-123', user_id: 'user-1', name: 'Home', description: null, status: 'active' },
      { onConflict: 'user_id,id' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.id).toBe('existing-id-123');
  });

  it('rejects without a session, and never queries the database', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const result = await upsertProject({ id: 'p1', name: 'Home', status: 'active' }, 'user-1');
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it('surfaces a database failure as a typed error rather than throwing', async () => {
    signIn();
    from.mockReturnValue(makeBuilder({ data: null, error: { message: 'constraint violation' } }));
    const result = await upsertProject({ id: 'p1', name: 'Home', status: 'active' }, 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('database');
  });

  it('fails closed with account-mismatch, and never queries the database, when the live session belongs to a different account', async () => {
    signIn('user-2');
    const result = await upsertProject({ id: 'p1', name: 'Home', status: 'active' }, 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('account-mismatch');
    expect(from).not.toHaveBeenCalled();
  });
});

describe('updateProjectGuarded', () => {
  it('applies the update when the expected updated_at still matches, filtering by user_id, id, and updated_at', async () => {
    signIn('user-1');
    const builder = makeBuilder({
      data: { id: 'p1', name: 'Renamed', description: null, status: 'active', updated_at: 'ts2' },
      error: null,
    });
    from.mockReturnValue(builder);

    const result = await updateProjectGuarded('p1', { name: 'Renamed' }, 'ts1', 'user-1');

    expect(builder.update).toHaveBeenCalledWith({ name: 'Renamed' });
    expect(builder.eq).toHaveBeenNthCalledWith(1, 'user_id', 'user-1');
    expect(builder.eq).toHaveBeenNthCalledWith(2, 'id', 'p1');
    expect(builder.eq).toHaveBeenNthCalledWith(3, 'updated_at', 'ts1');
    expect(builder.maybeSingle).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('reports a typed conflict, not a database error, when the row changed since it was last read', async () => {
    signIn('user-1');
    // maybeSingle() resolves with no error and null data when zero rows match the filter.
    from.mockReturnValue(makeBuilder({ data: null, error: null }));

    const result = await updateProjectGuarded('p1', { name: 'Renamed' }, 'stale-timestamp', 'user-1');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('conflict');
  });

  it('surfaces a real database failure distinctly from a conflict', async () => {
    signIn('user-1');
    from.mockReturnValue(makeBuilder({ data: null, error: { message: 'permission denied' } }));

    const result = await updateProjectGuarded('p1', { name: 'Renamed' }, 'ts1', 'user-1');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('database');
  });

  it('rejects without a session, and never queries the database', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const result = await updateProjectGuarded('p1', { name: 'Renamed' }, 'ts1', 'user-1');
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it('fails closed with account-mismatch, and never queries the database, when the live session belongs to a different account', async () => {
    signIn('user-2');
    const result = await updateProjectGuarded('p1', { name: 'Renamed' }, 'ts1', 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('account-mismatch');
    expect(from).not.toHaveBeenCalled();
  });
});

describe('deleteProject', () => {
  it('filters the delete by both user_id and id', async () => {
    signIn('user-1');
    const builder = makeBuilder({ data: null, error: null });
    from.mockReturnValue(builder);

    const result = await deleteProject('p1', 'user-1');

    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenNthCalledWith(1, 'user_id', 'user-1');
    expect(builder.eq).toHaveBeenNthCalledWith(2, 'id', 'p1');
    expect(result).toEqual({ ok: true, data: undefined });
  });

  it('surfaces a database failure as a typed error', async () => {
    signIn();
    from.mockReturnValue(makeBuilder({ data: null, error: { message: 'permission denied' } }));
    const result = await deleteProject('p1', 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('database');
  });

  it('fails closed with account-mismatch, and never queries the database, when the live session belongs to a different account', async () => {
    signIn('user-2');
    const result = await deleteProject('p1', 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('account-mismatch');
    expect(from).not.toHaveBeenCalled();
  });
});
