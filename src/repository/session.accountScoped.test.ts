import { describe, expect, it, vi, beforeEach } from 'vitest';

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
const fromSpy = vi.hoisted(() => vi.fn());
const ambientClient = vi.hoisted(() => ({ auth, from: fromSpy }) as unknown);
const pinnedClientSentinel = vi.hoisted(() => ({ __pinned: true }) as unknown);
const createClientMock = vi.hoisted(() => vi.fn(() => pinnedClientSentinel));

type PinnedClientOptions = {
  global: { headers: { Authorization: string } };
  auth: { persistSession: boolean; autoRefreshToken: boolean };
};

vi.mock('../lib/supabaseClient', () => ({
  supabase: ambientClient,
  isSupabaseConfigured: true,
}));

vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@supabase/supabase-js')>();
  return { ...actual, createClient: createClientMock };
});

import { getAuthenticatedSessionFor } from './session';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getAuthenticatedSessionFor', () => {
  it('succeeds and returns a client pinned to the verified session, not the ambient client, when the account matches', async () => {
    auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' }, access_token: 'token-abc' } },
      error: null,
    });

    const result = await getAuthenticatedSessionFor('user-1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.userId).toBe('user-1');
    // Pinned client is a distinct object from the ambient mocked `supabase`
    // client — proving the returned client does not depend on ambient state.
    expect(result.data.client).toBe(pinnedClientSentinel);
    expect(result.data.client).not.toBe(ambientClient);

    expect(createClientMock).toHaveBeenCalledTimes(1);
    const [, , options] = createClientMock.mock.calls[0] as unknown as [
      string,
      string,
      PinnedClientOptions,
    ];
    expect(options.global.headers.Authorization).toBe('Bearer token-abc');
    expect(options.auth).toEqual({ persistSession: false, autoRefreshToken: false });

    expect(auth.getSession).toHaveBeenCalledTimes(1);
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

    // No pinned client was built and no table method was ever reached.
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
