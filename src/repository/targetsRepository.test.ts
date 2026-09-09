import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Target } from '../types';

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
  createTarget,
  listTargets,
  updateTarget,
  updateTargetGuarded,
  upsertTarget,
} from './targetsRepository';

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

const numericRow = {
  id: 't1',
  goal_id: 'g1',
  type: 'numeric',
  name: 'Revenue',
  sort_order: 0,
  archived: false,
  start_value: 0,
  current_value: 10,
  target_value: 100,
  unit: null,
  value_format: 'number',
  achieved: null,
  task_ids: [],
  updated_at: 'ts',
};

const numericTarget: Target = {
  id: 't1',
  goalId: 'g1',
  name: 'Revenue',
  sortOrder: 0,
  archived: false,
  type: 'numeric',
  startValue: 0,
  currentValue: 10,
  targetValue: 100,
  valueFormat: 'number',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('targetsRepository authentication requirement', () => {
  it('rejects listTargets without a session, and never queries the database', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const result = await listTargets();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('unauthenticated');
    expect(from).not.toHaveBeenCalled();
  });
});

describe('listTargets', () => {
  it('filters to the signed-in user and maps rows to the app shape', async () => {
    signIn('user-1');
    from.mockReturnValue(makeBuilder({ data: [numericRow], error: null }));

    const result = await listTargets();

    expect(from).toHaveBeenCalledWith('targets');
    expect(result).toEqual({ ok: true, data: [{ ...numericTarget, updatedAt: 'ts' }] });
  });

  it('drops a row that fails its own type-required-fields invariant rather than surfacing an error', async () => {
    signIn('user-1');
    from.mockReturnValue(
      makeBuilder({ data: [{ ...numericRow, start_value: null }], error: null }),
    );
    const result = await listTargets();
    expect(result).toEqual({ ok: true, data: [] });
  });

  it('surfaces a database failure as a typed error rather than throwing', async () => {
    signIn();
    from.mockReturnValue(makeBuilder({ data: null, error: { message: 'permission denied' } }));
    const result = await listTargets();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('database');
  });
});

describe('createTarget', () => {
  it('inserts a row owned by the authenticated user, with only the numeric columns populated', async () => {
    signIn('user-1');
    const builder = makeBuilder({ data: numericRow, error: null });
    from.mockReturnValue(builder);

    const result = await createTarget(numericTarget, 'user-1');

    expect(builder.insert).toHaveBeenCalledWith({
      id: 't1',
      user_id: 'user-1',
      goal_id: 'g1',
      type: 'numeric',
      name: 'Revenue',
      sort_order: 0,
      archived: false,
      start_value: 0,
      current_value: 10,
      target_value: 100,
      unit: null,
      value_format: 'number',
      achieved: null,
      task_ids: [],
    });
    expect(result.ok).toBe(true);
  });

  it('fails closed with account-mismatch, and never queries the database, when the live session belongs to a different account', async () => {
    signIn('user-2');
    const result = await createTarget(numericTarget, 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('account-mismatch');
    expect(from).not.toHaveBeenCalled();
  });
});

describe('updateTarget — archive/restore is an ordinary field update, no delete path', () => {
  it('sends archived: true for an archive', async () => {
    signIn('user-1');
    from.mockReturnValue(makeBuilder({ data: { ...numericRow, archived: true }, error: null }));

    await updateTarget('t1', { archived: true }, 'user-1');
    const builder = from.mock.results[0].value as MockBuilder;
    expect(builder.update).toHaveBeenCalledWith({ archived: true });
  });

  it('sends archived: false for a restore', async () => {
    signIn('user-1');
    from.mockReturnValue(makeBuilder({ data: numericRow, error: null }));

    await updateTarget('t1', { archived: false }, 'user-1');
    const builder = from.mock.results[0].value as MockBuilder;
    expect(builder.update).toHaveBeenCalledWith({ archived: false });
  });
});

describe('upsertTarget', () => {
  it('upserts by (user_id, id)', async () => {
    signIn('user-1');
    from.mockReturnValue(makeBuilder({ data: numericRow, error: null }));

    const result = await upsertTarget(numericTarget, 'user-1');
    const builder = from.mock.results[0].value as MockBuilder;
    expect(builder.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }), {
      onConflict: 'user_id,id',
    });
    expect(result.ok).toBe(true);
  });
});

describe('updateTargetGuarded', () => {
  it('applies the update when the expected updated_at still matches', async () => {
    signIn('user-1');
    from.mockReturnValue(makeBuilder({ data: { ...numericRow, updated_at: 'ts2' }, error: null }));

    const result = await updateTargetGuarded('t1', { currentValue: 50 }, 'ts1', 'user-1');
    const builder = from.mock.results[0].value as MockBuilder;
    expect(builder.eq).toHaveBeenNthCalledWith(1, 'user_id', 'user-1');
    expect(builder.eq).toHaveBeenNthCalledWith(2, 'id', 't1');
    expect(builder.eq).toHaveBeenNthCalledWith(3, 'updated_at', 'ts1');
    expect(result.ok).toBe(true);
  });

  it('reports a typed conflict when the row changed since it was last read', async () => {
    signIn('user-1');
    from.mockReturnValue(makeBuilder({ data: null, error: null }));
    const result = await updateTargetGuarded('t1', { currentValue: 50 }, 'stale', 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('conflict');
  });
});
