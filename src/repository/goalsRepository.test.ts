import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Goal } from '../types';

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

import { createGoal, listGoals, updateGoal, updateGoalGuarded, upsertGoal } from './goalsRepository';

interface MockBuilder {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
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

describe('goalsRepository authentication requirement', () => {
  it('rejects listGoals without a session, and never queries the database', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const result = await listGoals();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('unauthenticated');
    expect(from).not.toHaveBeenCalled();
  });
});

describe('listGoals', () => {
  it('filters to the signed-in user and maps rows to the app shape', async () => {
    signIn('user-1');
    const builder = makeBuilder({
      data: [
        {
          id: 'g1',
          name: 'Ship it',
          description: null,
          due_date: null,
          priority: 'Normal',
          status: 'active',
          project_ids: [],
          updated_at: '2026-09-08T00:00:00.000Z',
        },
      ],
      error: null,
    });
    from.mockReturnValue(builder);

    const result = await listGoals();

    expect(from).toHaveBeenCalledWith('goals');
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(result).toEqual({
      ok: true,
      data: [
        {
          id: 'g1',
          name: 'Ship it',
          description: undefined,
          dueDate: undefined,
          priority: 'Normal',
          status: 'active',
          projectIds: [],
          updatedAt: '2026-09-08T00:00:00.000Z',
        },
      ],
    });
  });

  it('surfaces a database failure as a typed error rather than throwing', async () => {
    signIn();
    from.mockReturnValue(makeBuilder({ data: null, error: { message: 'permission denied' } }));
    const result = await listGoals();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('database');
  });
});

describe('createGoal', () => {
  const goal: Goal = { id: 'g1', name: 'Ship it', priority: 'Normal', status: 'active', projectIds: [] };

  it('inserts a row owned by the authenticated user', async () => {
    signIn('user-1');
    const builder = makeBuilder({
      data: {
        id: 'g1',
        name: 'Ship it',
        description: null,
        due_date: null,
        priority: 'Normal',
        status: 'active',
        project_ids: [],
        updated_at: 'ts',
      },
      error: null,
    });
    from.mockReturnValue(builder);

    const result = await createGoal(goal, 'user-1');

    expect(builder.insert).toHaveBeenCalledWith({
      id: 'g1',
      user_id: 'user-1',
      name: 'Ship it',
      description: null,
      due_date: null,
      priority: 'Normal',
      status: 'active',
      project_ids: [],
    });
    expect(result.ok).toBe(true);
  });

  it('classifies a unique-violation (Postgres code 23505) as a typed duplicate error', async () => {
    signIn();
    from.mockReturnValue(
      makeBuilder({ data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } }),
    );
    const result = await createGoal(goal, 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('duplicate');
  });

  it('fails closed with account-mismatch, and never queries the database, when the live session belongs to a different account', async () => {
    signIn('user-2');
    const result = await createGoal(goal, 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('account-mismatch');
    expect(from).not.toHaveBeenCalled();
  });
});

describe('updateGoal', () => {
  it('filters the update by both user_id and id, and sends only the changed field', async () => {
    signIn('user-1');
    const builder = makeBuilder({
      data: {
        id: 'g1',
        name: 'Renamed',
        description: null,
        due_date: null,
        priority: 'Normal',
        status: 'active',
        project_ids: [],
        updated_at: 'ts2',
      },
      error: null,
    });
    from.mockReturnValue(builder);

    const result = await updateGoal('g1', { name: 'Renamed' }, 'user-1');

    expect(builder.update).toHaveBeenCalledWith({ name: 'Renamed' });
    expect(builder.eq).toHaveBeenNthCalledWith(1, 'user_id', 'user-1');
    expect(builder.eq).toHaveBeenNthCalledWith(2, 'id', 'g1');
    expect(result.ok).toBe(true);
  });

  it('sends projectIds as project_ids', async () => {
    signIn('user-1');
    const builder = makeBuilder({
      data: {
        id: 'g1',
        name: 'Ship it',
        description: null,
        due_date: null,
        priority: 'Normal',
        status: 'active',
        project_ids: ['p1'],
        updated_at: 'ts2',
      },
      error: null,
    });
    from.mockReturnValue(builder);

    await updateGoal('g1', { projectIds: ['p1'] }, 'user-1');
    expect(builder.update).toHaveBeenCalledWith({ project_ids: ['p1'] });
  });
});

describe('upsertGoal', () => {
  it('upserts by (user_id, id)', async () => {
    signIn('user-1');
    const builder = makeBuilder({
      data: {
        id: 'g1',
        name: 'Ship it',
        description: null,
        due_date: null,
        priority: 'Normal',
        status: 'active',
        project_ids: [],
        updated_at: 'ts',
      },
      error: null,
    });
    from.mockReturnValue(builder);

    const goal: Goal = { id: 'g1', name: 'Ship it', priority: 'Normal', status: 'active', projectIds: [] };
    const result = await upsertGoal(goal, 'user-1');

    expect(builder.upsert).toHaveBeenCalledWith(
      {
        id: 'g1',
        user_id: 'user-1',
        name: 'Ship it',
        description: null,
        due_date: null,
        priority: 'Normal',
        status: 'active',
        project_ids: [],
      },
      { onConflict: 'user_id,id' },
    );
    expect(result.ok).toBe(true);
  });
});

describe('updateGoalGuarded', () => {
  it('applies the update when the expected updated_at still matches, filtering by user_id, id, and updated_at', async () => {
    signIn('user-1');
    const builder = makeBuilder({
      data: {
        id: 'g1',
        name: 'Renamed',
        description: null,
        due_date: null,
        priority: 'Normal',
        status: 'active',
        project_ids: [],
        updated_at: 'ts2',
      },
      error: null,
    });
    from.mockReturnValue(builder);

    const result = await updateGoalGuarded('g1', { name: 'Renamed' }, 'ts1', 'user-1');

    expect(builder.eq).toHaveBeenNthCalledWith(1, 'user_id', 'user-1');
    expect(builder.eq).toHaveBeenNthCalledWith(2, 'id', 'g1');
    expect(builder.eq).toHaveBeenNthCalledWith(3, 'updated_at', 'ts1');
    expect(result.ok).toBe(true);
  });

  it('reports a typed conflict when the row changed since it was last read', async () => {
    signIn('user-1');
    from.mockReturnValue(makeBuilder({ data: null, error: null }));
    const result = await updateGoalGuarded('g1', { name: 'Renamed' }, 'stale', 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('conflict');
  });
});
