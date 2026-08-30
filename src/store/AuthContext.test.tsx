// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { AuthProvider, type AuthResult } from './AuthContext';
import { useAuth } from './useAuth';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock('../lib/supabaseClient', () => ({
  supabase: { auth },
  isSupabaseConfigured: true,
}));

let authChangeCallback: (event: string, session: unknown) => void = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  auth.onAuthStateChange.mockImplementation((cb: (event: string, session: unknown) => void) => {
    authChangeCallback = cb;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
});

afterEach(() => {
  cleanup();
});

function renderAuth() {
  return renderHook(() => useAuth(), { wrapper: AuthProvider });
}

describe('AuthContext', () => {
  it('starts loading then becomes ready with no session', async () => {
    let resolveSession: (value: { data: { session: null } }) => void = () => {};
    auth.getSession.mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve;
      }),
    );

    const { result } = renderAuth();
    expect(result.current.status).toBe('loading');

    await act(async () => {
      resolveSession({ data: { session: null } });
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.user).toBeNull();
  });

  it('reflects a session established via onAuthStateChange', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.status).toBe('ready'));

    const fakeSession = { user: { id: 'u1', email: 'person@example.com' } };
    act(() => {
      authChangeCallback('SIGNED_IN', fakeSession);
    });

    expect(result.current.user?.email).toBe('person@example.com');
  });

  it('marks password recovery on PASSWORD_RECOVERY and keeps it set through a successful update', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    auth.updateUser.mockResolvedValue({ error: null });
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => {
      authChangeCallback('PASSWORD_RECOVERY', { user: { id: 'u1', email: 'x@example.com' } });
    });
    expect(result.current.isPasswordRecovery).toBe(true);

    await act(async () => {
      const outcome = await result.current.updatePassword('newpassword1');
      expect(outcome.ok).toBe(true);
    });
    // The dialog keeps showing the success message until the caller explicitly
    // dismisses it via cancelPasswordRecovery (e.g. clicking "Continue").
    expect(result.current.isPasswordRecovery).toBe(true);

    act(() => {
      result.current.cancelPasswordRecovery();
    });
    expect(result.current.isPasswordRecovery).toBe(false);
  });

  it('returns a plain error message when sign-in fails, without throwing', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    auth.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let outcome: AuthResult | undefined;
    await act(async () => {
      outcome = await result.current.signIn('a@example.com', 'wrong');
    });
    expect(outcome).toEqual({ ok: false, message: 'Invalid login credentials' });
  });

  it('reports a check-your-email message on sign-up without an immediate session', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    auth.signUp.mockResolvedValue({ data: { session: null, user: { id: 'u2' } }, error: null });
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let outcome: AuthResult | undefined;
    await act(async () => {
      outcome = await result.current.signUp('a@example.com', 'password123');
    });
    expect(outcome?.ok).toBe(true);
    expect(outcome?.message).toMatch(/confirm/i);
  });
});
