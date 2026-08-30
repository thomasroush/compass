import { describe, expect, it, vi, beforeEach } from 'vitest';

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock('../lib/supabaseClient', () => ({
  supabase: { auth },
  isSupabaseConfigured: true,
}));

import { getAuthenticatedSession } from './session';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getAuthenticatedSession', () => {
  it('returns the signed-in user id and the client when a session exists', async () => {
    auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
      error: null,
    });

    const result = await getAuthenticatedSession();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.userId).toBe('user-1');
      expect(result.data.client).toBeDefined();
    }
  });

  it('returns a typed unauthenticated error when nobody is signed in', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });

    const result = await getAuthenticatedSession();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('unauthenticated');
      expect(result.error.message).not.toMatch(/token|jwt|key/i);
    }
  });

  it('returns a typed database error when Supabase itself fails, without exposing internals', async () => {
    auth.getSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'network error' },
    });

    const result = await getAuthenticatedSession();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('database');
      expect(result.error.message).toBe('network error');
    }
  });
});
