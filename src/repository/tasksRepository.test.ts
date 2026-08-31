import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Task } from '../types';

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
const from = vi.hoisted(() => vi.fn());

vi.mock('../lib/supabaseClient', () => ({
  supabase: { auth, from },
  isSupabaseConfigured: true,
}));

import {
  createTask,
  deleteTask,
  listTasks,
  updateTask,
  updateTaskGuarded,
  upsertTask,
} from './tasksRepository';

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
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: userId } } }, error: null });
}

const sampleTask: Task = {
  id: 't1',
  title: 'Buy milk',
  status: 'Inbox',
  priority: 'Normal',
  createdAt: '2026-08-30T00:00:00.000Z',
  sortOrder: 0,
  isPrimary: false,
  archived: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('tasksRepository authentication requirement', () => {
  it('rejects listTasks without a session, and never queries the database', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const result = await listTasks();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('unauthenticated');
    expect(from).not.toHaveBeenCalled();
  });
});

describe('listTasks', () => {
  it('filters to the signed-in user, selects explicit columns, and maps rows', async () => {
    signIn('user-1');
    const builder = makeBuilder({
      data: [
        {
          id: 't1',
          title: 'Buy milk',
          notes: null,
          status: 'Inbox',
          project_id: null,
          priority: 'Normal',
          due_date: null,
          created_at: '2026-08-30T00:00:00.000Z',
          completed_at: null,
          sort_order: 0,
          is_primary: false,
          archived: false,
          updated_at: '2026-08-30T01:00:00.000Z',
        },
      ],
      error: null,
    });
    from.mockReturnValue(builder);

    const result = await listTasks();

    expect(from).toHaveBeenCalledWith('tasks');
    expect(builder.select).toHaveBeenCalledWith(expect.not.stringContaining('*'));
    expect(builder.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(result).toEqual({
      ok: true,
      data: [
        {
          id: 't1',
          title: 'Buy milk',
          notes: undefined,
          status: 'Inbox',
          projectId: undefined,
          priority: 'Normal',
          dueDate: undefined,
          createdAt: '2026-08-30T00:00:00.000Z',
          completedAt: undefined,
          sortOrder: 0,
          isPrimary: false,
          archived: false,
          updatedAt: '2026-08-30T01:00:00.000Z',
        },
      ],
    });
  });

  it('returns an empty list, not an error, when the user has no tasks', async () => {
    signIn();
    from.mockReturnValue(makeBuilder({ data: [], error: null }));
    expect(await listTasks()).toEqual({ ok: true, data: [] });
  });

  it('surfaces a database failure as a typed error', async () => {
    signIn();
    from.mockReturnValue(makeBuilder({ data: null, error: { message: 'permission denied' } }));
    const result = await listTasks();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('database');
  });
});

describe('createTask', () => {
  it('inserts a row owned by the authenticated user, preserving the client-generated id', async () => {
    signIn('user-1');
    const builder = makeBuilder({
      data: {
        id: 't1',
        title: 'Buy milk',
        notes: null,
        status: 'Inbox',
        project_id: null,
        priority: 'Normal',
        due_date: null,
        created_at: '2026-08-30T00:00:00.000Z',
        completed_at: null,
        sort_order: 0,
        is_primary: false,
        archived: false,
        updated_at: '2026-08-30T00:00:00.000Z',
      },
      error: null,
    });
    from.mockReturnValue(builder);

    await createTask(sampleTask);

    expect(builder.insert).toHaveBeenCalledWith({
      id: 't1',
      user_id: 'user-1',
      title: 'Buy milk',
      notes: null,
      status: 'Inbox',
      project_id: null,
      priority: 'Normal',
      due_date: null,
      created_at: '2026-08-30T00:00:00.000Z',
      completed_at: null,
      sort_order: 0,
      is_primary: false,
      archived: false,
    });
  });

  it('surfaces a foreign-key failure (task pointed at another user\'s project) as a typed error', async () => {
    signIn();
    from.mockReturnValue(
      makeBuilder({ data: null, error: { message: 'violates foreign key constraint "tasks_project_fk"' } }),
    );
    const result = await createTask(sampleTask);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('database');
  });
});

describe('upsertTask', () => {
  it('upserts by (user_id, id), preserving the given id', async () => {
    signIn('user-1');
    const builder = makeBuilder({
      data: {
        id: 'stable-id-1',
        title: 'Buy milk',
        notes: null,
        status: 'Inbox',
        project_id: null,
        priority: 'Normal',
        due_date: null,
        created_at: '2026-08-30T00:00:00.000Z',
        completed_at: null,
        sort_order: 0,
        is_primary: false,
        archived: false,
        updated_at: 'ts',
      },
      error: null,
    });
    from.mockReturnValue(builder);

    const task: Task = { ...sampleTask, id: 'stable-id-1' };
    const result = await upsertTask(task);

    expect(builder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'stable-id-1', user_id: 'user-1' }),
      { onConflict: 'user_id,id' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.id).toBe('stable-id-1');
  });

  it('rejects without a session, and never queries the database', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const result = await upsertTask(sampleTask);
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it('surfaces a database failure (e.g. a foreign-key violation) as a typed error', async () => {
    signIn();
    from.mockReturnValue(
      makeBuilder({ data: null, error: { message: 'violates foreign key constraint' } }),
    );
    const result = await upsertTask(sampleTask);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('database');
  });
});

describe('updateTask', () => {
  it('filters by both user_id and id, and sends only the changed fields', async () => {
    signIn('user-1');
    const builder = makeBuilder({
      data: {
        id: 't1',
        title: 'Buy milk',
        notes: null,
        status: 'Done',
        project_id: null,
        priority: 'Normal',
        due_date: null,
        created_at: '2026-08-30T00:00:00.000Z',
        completed_at: '2026-08-30T02:00:00.000Z',
        sort_order: 0,
        is_primary: false,
        archived: false,
        updated_at: '2026-08-30T02:00:00.000Z',
      },
      error: null,
    });
    from.mockReturnValue(builder);

    await updateTask('t1', { status: 'Done', completedAt: '2026-08-30T02:00:00.000Z' });

    expect(builder.update).toHaveBeenCalledWith({
      status: 'Done',
      completed_at: '2026-08-30T02:00:00.000Z',
    });
    expect(builder.eq).toHaveBeenNthCalledWith(1, 'user_id', 'user-1');
    expect(builder.eq).toHaveBeenNthCalledWith(2, 'id', 't1');
  });

  it('un-assigns a project by sending project_id: null when projectId is explicitly undefined', async () => {
    signIn('user-1');
    const builder = makeBuilder({
      data: { ...sampleTask, project_id: null, updated_at: 'ts' },
      error: null,
    });
    from.mockReturnValue(builder);

    await updateTask('t1', { projectId: undefined });

    expect(builder.update).toHaveBeenCalledWith({ project_id: null });
  });

  it('surfaces a database failure as a typed error', async () => {
    signIn();
    from.mockReturnValue(makeBuilder({ data: null, error: { message: 'row not found' } }));
    const result = await updateTask('missing', { title: 'X' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('database');
  });
});

describe('updateTaskGuarded', () => {
  it('applies the update when the expected updated_at still matches, filtering by user_id, id, and updated_at', async () => {
    signIn('user-1');
    const builder = makeBuilder({
      data: {
        id: 't1',
        title: 'Buy milk',
        notes: null,
        status: 'Done',
        project_id: null,
        priority: 'Normal',
        due_date: null,
        created_at: '2026-08-30T00:00:00.000Z',
        completed_at: '2026-08-30T02:00:00.000Z',
        sort_order: 0,
        is_primary: false,
        archived: false,
        updated_at: '2026-08-30T02:00:00.000Z',
      },
      error: null,
    });
    from.mockReturnValue(builder);

    const result = await updateTaskGuarded('t1', { status: 'Done' }, '2026-08-30T01:00:00.000Z');

    expect(builder.update).toHaveBeenCalledWith({ status: 'Done' });
    expect(builder.eq).toHaveBeenNthCalledWith(1, 'user_id', 'user-1');
    expect(builder.eq).toHaveBeenNthCalledWith(2, 'id', 't1');
    expect(builder.eq).toHaveBeenNthCalledWith(3, 'updated_at', '2026-08-30T01:00:00.000Z');
    expect(builder.maybeSingle).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('reports a typed conflict, not a database error, when the row changed since it was last read', async () => {
    signIn('user-1');
    // maybeSingle() resolves with no error and null data when zero rows match the filter.
    from.mockReturnValue(makeBuilder({ data: null, error: null }));

    const result = await updateTaskGuarded('t1', { status: 'Done' }, 'stale-timestamp');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('conflict');
  });

  it('surfaces a real database failure distinctly from a conflict', async () => {
    signIn('user-1');
    from.mockReturnValue(makeBuilder({ data: null, error: { message: 'permission denied' } }));

    const result = await updateTaskGuarded('t1', { status: 'Done' }, 'ts');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('database');
  });

  it('rejects without a session, and never queries the database', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const result = await updateTaskGuarded('t1', { status: 'Done' }, 'ts');
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });
});

describe('deleteTask', () => {
  it('filters the delete by both user_id and id', async () => {
    signIn('user-1');
    const builder = makeBuilder({ data: null, error: null });
    from.mockReturnValue(builder);

    const result = await deleteTask('t1');

    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenNthCalledWith(1, 'user_id', 'user-1');
    expect(builder.eq).toHaveBeenNthCalledWith(2, 'id', 't1');
    expect(result).toEqual({ ok: true, data: undefined });
  });

  it('surfaces a database failure as a typed error', async () => {
    signIn();
    from.mockReturnValue(makeBuilder({ data: null, error: { message: 'permission denied' } }));
    const result = await deleteTask('t1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('database');
  });
});
