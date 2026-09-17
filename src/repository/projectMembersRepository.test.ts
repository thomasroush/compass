import { describe, expect, it, vi, beforeEach } from 'vitest';

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

import { listMembers, removeMember } from './projectMembersRepository';

interface MockBuilder {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise<unknown>;
}

function makeBuilder(result: { data: unknown; error: unknown }): MockBuilder {
  const builder = {} as MockBuilder;
  const self = () => builder;
  builder.select = vi.fn(self);
  builder.eq = vi.fn(self);
  builder.order = vi.fn(self);
  builder.delete = vi.fn(self);
  builder.setHeader = vi.fn(self);
  builder.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

function signIn(userId = 'owner-1') {
  auth.getSession.mockResolvedValue({
    data: { session: { user: { id: userId }, access_token: `token-${userId}` } },
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listMembers', () => {
  it('filters by both owner_id and project_id, selects member_email, and maps rows to the app shape', async () => {
    signIn('owner-1');
    const builder = makeBuilder({
      data: [
        {
          owner_id: 'owner-1',
          project_id: 'p1',
          member_id: 'editor-1',
          member_email: 'editor@example.com',
          role: 'editor',
          created_at: 'ts',
        },
      ],
      error: null,
    });
    from.mockReturnValue(builder);

    const result = await listMembers('p1');

    expect(from).toHaveBeenCalledWith('project_members');
    expect(builder.select).toHaveBeenCalledWith(expect.stringContaining('member_email'));
    expect(builder.eq).toHaveBeenNthCalledWith(1, 'owner_id', 'owner-1');
    expect(builder.eq).toHaveBeenNthCalledWith(2, 'project_id', 'p1');
    expect(result).toEqual({
      ok: true,
      data: [
        {
          ownerId: 'owner-1',
          projectId: 'p1',
          memberId: 'editor-1',
          memberEmail: 'editor@example.com',
          role: 'editor',
          createdAt: 'ts',
        },
      ],
    });
  });

  it('maps a null member_email (a membership row that predates this column) to undefined', async () => {
    signIn('owner-1');
    from.mockReturnValue(
      makeBuilder({
        data: [
          {
            owner_id: 'owner-1',
            project_id: 'p1',
            member_id: 'editor-1',
            member_email: null,
            role: 'editor',
            created_at: 'ts',
          },
        ],
        error: null,
      }),
    );

    const result = await listMembers('p1');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data[0].memberEmail).toBeUndefined();
  });

  it('returns an empty list, not an error, when the Project has no members', async () => {
    signIn();
    from.mockReturnValue(makeBuilder({ data: [], error: null }));
    expect(await listMembers('p1')).toEqual({ ok: true, data: [] });
  });

  it('rejects without a session, and never queries the database', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const result = await listMembers('p1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('unauthenticated');
    expect(from).not.toHaveBeenCalled();
  });

  it('surfaces a database failure as a typed error', async () => {
    signIn();
    from.mockReturnValue(makeBuilder({ data: null, error: { message: 'permission denied' } }));
    const result = await listMembers('p1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('database');
  });
});

describe('removeMember', () => {
  it('filters the delete by owner_id, project_id, and member_id', async () => {
    signIn('owner-1');
    const builder = makeBuilder({ data: null, error: null });
    from.mockReturnValue(builder);

    const result = await removeMember('p1', 'editor-1', 'owner-1');

    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenNthCalledWith(1, 'owner_id', 'owner-1');
    expect(builder.eq).toHaveBeenNthCalledWith(2, 'project_id', 'p1');
    expect(builder.eq).toHaveBeenNthCalledWith(3, 'member_id', 'editor-1');
    expect(result).toEqual({ ok: true, data: undefined });
  });

  it('fails closed with account-mismatch, and never queries the database, when the live session belongs to a different account', async () => {
    signIn('someone-else');
    const result = await removeMember('p1', 'editor-1', 'owner-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('account-mismatch');
    expect(from).not.toHaveBeenCalled();
  });

  it('surfaces a database failure as a typed error', async () => {
    signIn('owner-1');
    from.mockReturnValue(makeBuilder({ data: null, error: { message: 'permission denied' } }));
    const result = await removeMember('p1', 'editor-1', 'owner-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('database');
  });
});
