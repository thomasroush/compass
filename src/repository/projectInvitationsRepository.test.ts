import { describe, expect, it, vi, beforeEach } from 'vitest';

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
const from = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
const createClientMock = vi.hoisted(() => vi.fn(() => ({ from, rpc })));

vi.mock('../lib/supabaseClient', () => ({
  supabase: { auth, from, rpc },
  isSupabaseConfigured: true,
}));

vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@supabase/supabase-js')>();
  return { ...actual, createClient: createClientMock };
});

import {
  acceptInvitation,
  createInvitation,
  declineInvitation,
  listInvitationsForProject,
  listPendingInvitationsForMe,
  normalizeInvitationEmail,
  revokeInvitation,
} from './projectInvitationsRepository';

interface MockBuilder {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  neq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise<unknown>;
}

function makeBuilder(result: { data: unknown; error: unknown }): MockBuilder {
  const builder = {} as MockBuilder;
  const self = () => builder;
  builder.select = vi.fn(self);
  builder.eq = vi.fn(self);
  builder.neq = vi.fn(self);
  builder.order = vi.fn(self);
  builder.insert = vi.fn(self);
  builder.update = vi.fn(self);
  builder.single = vi.fn(self);
  builder.maybeSingle = vi.fn(self);
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

const invitationRow = {
  id: 'inv-1',
  owner_id: 'owner-1',
  project_id: 'p1',
  invited_email: 'editor@example.com',
  status: 'pending',
  created_at: 'ts',
  responded_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('normalizeInvitationEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeInvitationEmail('  Editor@Example.com  ')).toBe('editor@example.com');
  });

  it('is idempotent on an already-normalized address', () => {
    expect(normalizeInvitationEmail('editor@example.com')).toBe('editor@example.com');
  });
});

describe('createInvitation', () => {
  it('inserts a normalized email under the caller as owner_id', async () => {
    signIn('owner-1');
    const builder = makeBuilder({ data: invitationRow, error: null });
    from.mockReturnValue(builder);

    const result = await createInvitation('p1', '  Editor@Example.com  ', 'owner-1');

    expect(from).toHaveBeenCalledWith('project_invitations');
    expect(builder.insert).toHaveBeenCalledWith({
      owner_id: 'owner-1',
      project_id: 'p1',
      invited_email: 'editor@example.com',
    });
    expect(result).toEqual({
      ok: true,
      data: {
        id: 'inv-1',
        ownerId: 'owner-1',
        projectId: 'p1',
        invitedEmail: 'editor@example.com',
        status: 'pending',
        createdAt: 'ts',
        respondedAt: undefined,
      },
    });
  });

  it('classifies a unique-violation (duplicate active pending invite) as a typed duplicate error', async () => {
    signIn('owner-1');
    from.mockReturnValue(
      makeBuilder({
        data: null,
        error: { message: 'duplicate key value violates unique constraint', code: '23505' },
      }),
    );
    const result = await createInvitation('p1', 'editor@example.com', 'owner-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('duplicate');
  });

  it('fails closed with account-mismatch, and never queries the database, when the live session belongs to a different account', async () => {
    signIn('someone-else');
    const result = await createInvitation('p1', 'editor@example.com', 'owner-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('account-mismatch');
    expect(from).not.toHaveBeenCalled();
  });
});

describe('listInvitationsForProject', () => {
  it('filters by both owner_id and project_id', async () => {
    signIn('owner-1');
    const builder = makeBuilder({ data: [invitationRow], error: null });
    from.mockReturnValue(builder);

    const result = await listInvitationsForProject('p1');

    expect(builder.eq).toHaveBeenNthCalledWith(1, 'owner_id', 'owner-1');
    expect(builder.eq).toHaveBeenNthCalledWith(2, 'project_id', 'p1');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toHaveLength(1);
  });

  it('rejects without a session, and never queries the database', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const result = await listInvitationsForProject('p1');
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });
});

describe('listPendingInvitationsForMe', () => {
  it('filters to pending status and excludes invitations the caller owns, never filtering by a client-supplied email', async () => {
    signIn('editor-1');
    const builder = makeBuilder({
      data: [{ ...invitationRow, owner_id: 'owner-1', invited_email: 'editor@example.com' }],
      error: null,
    });
    from.mockReturnValue(builder);

    const result = await listPendingInvitationsForMe();

    expect(builder.eq).toHaveBeenCalledWith('status', 'pending');
    expect(builder.neq).toHaveBeenCalledWith('owner_id', 'editor-1');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data[0].ownerId).toBe('owner-1');
  });

  it('returns an empty list, not an error, when there are no pending invitations', async () => {
    signIn();
    from.mockReturnValue(makeBuilder({ data: [], error: null }));
    expect(await listPendingInvitationsForMe()).toEqual({ ok: true, data: [] });
  });
});

describe('acceptInvitation', () => {
  it('calls the database function by id, never re-implementing the accept logic as a plain update', async () => {
    signIn('editor-1');
    rpc.mockReturnValue(makeBuilder({ data: null, error: null }));

    const result = await acceptInvitation('inv-1', 'editor-1');

    expect(rpc).toHaveBeenCalledWith('accept_project_invitation', { p_invitation_id: 'inv-1' }, undefined);
    expect(result).toEqual({ ok: true, data: undefined });
  });

  it('surfaces the function raising (e.g. no matching pending invitation for this account) as a typed error', async () => {
    signIn('editor-1');
    rpc.mockReturnValue(
      makeBuilder({ data: null, error: { message: 'No pending invitation for this account with that id.' } }),
    );

    const result = await acceptInvitation('inv-1', 'editor-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('database');
  });

  it('fails closed with account-mismatch, and never calls the database function, when the live session belongs to a different account', async () => {
    signIn('someone-else');
    const result = await acceptInvitation('inv-1', 'editor-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('account-mismatch');
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('declineInvitation', () => {
  it('updates status to declined and sets responded_at, filtered to a still-pending invitation', async () => {
    signIn('editor-1');
    const builder = makeBuilder({
      data: { ...invitationRow, status: 'declined', responded_at: '2026-09-16T00:00:00.000Z' },
      error: null,
    });
    from.mockReturnValue(builder);

    const result = await declineInvitation('inv-1', 'editor-1');

    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'declined', responded_at: expect.any(String) }),
    );
    expect(builder.eq).toHaveBeenNthCalledWith(1, 'id', 'inv-1');
    expect(builder.eq).toHaveBeenNthCalledWith(2, 'status', 'pending');
    expect(result.ok).toBe(true);
  });

  it('reports a typed conflict, not a database error, when no matching pending invitation is found (wrong account or already resolved)', async () => {
    signIn('editor-1');
    from.mockReturnValue(makeBuilder({ data: null, error: null }));

    const result = await declineInvitation('inv-1', 'editor-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('conflict');
  });
});

describe('revokeInvitation', () => {
  it('updates status to revoked, filtered by owner_id and a still-pending invitation, and never sets responded_at', async () => {
    signIn('owner-1');
    const builder = makeBuilder({ data: { ...invitationRow, status: 'revoked' }, error: null });
    from.mockReturnValue(builder);

    const result = await revokeInvitation('inv-1', 'owner-1');

    expect(builder.update).toHaveBeenCalledWith({ status: 'revoked' });
    expect(builder.eq).toHaveBeenNthCalledWith(1, 'owner_id', 'owner-1');
    expect(builder.eq).toHaveBeenNthCalledWith(2, 'id', 'inv-1');
    expect(builder.eq).toHaveBeenNthCalledWith(3, 'status', 'pending');
    expect(result.ok).toBe(true);
  });

  it('reports a typed conflict when no matching pending invitation of the caller\'s is found', async () => {
    signIn('owner-1');
    from.mockReturnValue(makeBuilder({ data: null, error: null }));

    const result = await revokeInvitation('inv-1', 'owner-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('conflict');
  });

  it('fails closed with account-mismatch, and never queries the database, when the live session belongs to a different account', async () => {
    signIn('someone-else');
    const result = await revokeInvitation('inv-1', 'owner-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('account-mismatch');
    expect(from).not.toHaveBeenCalled();
  });
});
