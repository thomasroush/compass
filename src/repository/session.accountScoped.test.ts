import { describe, expect, it, vi, beforeEach } from 'vitest';

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
const fromSpy = vi.hoisted(() => vi.fn());
const rpcSpy = vi.hoisted(() => vi.fn());
const ambientClient = vi.hoisted(() => ({ auth, from: fromSpy, rpc: rpcSpy }) as unknown);
const createClientMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/supabaseClient', () => ({
  supabase: ambientClient,
  isSupabaseConfigured: true,
}));

vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@supabase/supabase-js')>();
  return { ...actual, createClient: createClientMock };
});

import { getAuthenticatedSessionFor } from './session';

/** A minimal stand-in for a postgrest-js query/RPC builder: every chained
 * call (including `setHeader`) returns the same object, matching the real
 * library's fluent API closely enough to prove the pinning logic works
 * against it. */
function makeBuilder() {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  const self = () => builder;
  for (const method of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'single', 'maybeSingle', 'setHeader']) {
    builder[method] = vi.fn(self);
  }
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getAuthenticatedSessionFor', () => {
  it('succeeds without ever constructing a second Supabase client', async () => {
    auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' }, access_token: 'token-abc' } },
      error: null,
    });

    const result = await getAuthenticatedSessionFor('user-1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.userId).toBe('user-1');
    // The fix this test guards: no second `createClient(...)` call, and
    // therefore no second GoTrueClient ("Multiple GoTrueClient instances")
    // and no independently-sourced apikey/URL configuration.
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("pins the verified session's access token onto a .from(...) query, via the ambient client", async () => {
    auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' }, access_token: 'token-abc' } },
      error: null,
    });
    const builder = makeBuilder();
    fromSpy.mockReturnValue(builder);

    const result = await getAuthenticatedSessionFor('user-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    result.data.client.from('projects').update({ name: 'Renamed' }).eq('id', 'p1');

    // The query went through the ambient client's own `from`, never a
    // second client's.
    expect(fromSpy).toHaveBeenCalledWith('projects');
    expect(builder.update).toHaveBeenCalledWith({ name: 'Renamed' });
    expect(builder.setHeader).toHaveBeenCalledWith('Authorization', 'Bearer token-abc');
    expect(builder.eq).toHaveBeenCalledWith('id', 'p1');
  });

  it("pins the verified session's access token onto an .rpc(...) call, via the ambient client", async () => {
    auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' }, access_token: 'token-xyz' } },
      error: null,
    });
    const builder = makeBuilder();
    rpcSpy.mockReturnValue(builder);

    const result = await getAuthenticatedSessionFor('user-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    result.data.client.rpc('accept_project_invitation', { p_invitation_id: 'inv-1' });

    expect(rpcSpy).toHaveBeenCalledWith('accept_project_invitation', { p_invitation_id: 'inv-1' }, undefined);
    expect(builder.setHeader).toHaveBeenCalledWith('Authorization', 'Bearer token-xyz');
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('never constructs a second client across repeated calls', async () => {
    auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' }, access_token: 'token-abc' } },
      error: null,
    });
    fromSpy.mockReturnValue(makeBuilder());

    await getAuthenticatedSessionFor('user-1');
    await getAuthenticatedSessionFor('user-1');
    await getAuthenticatedSessionFor('user-1');

    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('returns account-mismatch and performs no table access when the live session belongs to a different account', async () => {
    auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-2' }, access_token: 'token-xyz' } },
      error: null,
    });

    const result = await getAuthenticatedSessionFor('user-1');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('account-mismatch');
    expect(result.error.message).not.toMatch(/token|jwt|key/i);

    expect(createClientMock).not.toHaveBeenCalled();
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('returns the existing unauthenticated result when there is no live session', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });

    const result = await getAuthenticatedSessionFor('user-1');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('unauthenticated');
    expect(result.error.message).not.toMatch(/token|jwt|key/i);
    expect(createClientMock).not.toHaveBeenCalled();
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('preserves the existing database-error result when Supabase itself fails, without exposing internals', async () => {
    auth.getSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'network error' },
    });

    const result = await getAuthenticatedSessionFor('user-1');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('database');
    expect(result.error.message).toBe('network error');
    expect(createClientMock).not.toHaveBeenCalled();
    expect(fromSpy).not.toHaveBeenCalled();
  });
});
