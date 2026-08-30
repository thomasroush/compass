// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AccountPanel } from './AccountPanel';
import { AuthProvider } from '../store/AuthContext';

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

function renderPanel() {
  return render(
    <AuthProvider>
      <AccountPanel />
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.getSession.mockResolvedValue({ data: { session: null } });
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
});

afterEach(() => {
  cleanup();
});

describe('AccountPanel', () => {
  it('shows the sign-in form by default once the session check resolves', async () => {
    renderPanel();
    expect(await screen.findByLabelText('Email')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('signs in successfully and shows a plain success message', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    renderPanel();
    fireEvent.change(await screen.findByLabelText('Email'), {
      target: { value: 'a@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() =>
      expect(auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'a@example.com',
        password: 'secret123',
      }),
    );
    expect(await screen.findByText('Signed in.')).toBeTruthy();
  });

  it('shows the Supabase error message directly on failed sign-in', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    renderPanel();
    fireEvent.change(await screen.findByLabelText('Email'), {
      target: { value: 'a@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Invalid login credentials')).toBeTruthy();
  });

  it('switches to create-account mode and back without colliding button labels', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Create an account' }));
    expect(screen.getByRole('button', { name: 'Create account' })).toBeTruthy();
    expect(screen.queryByLabelText('Password')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('forgot-password mode hides the password field and requests a reset link', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Forgot password?' }));
    expect(screen.queryByLabelText('Password')).toBeNull();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    await waitFor(() =>
      expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(
        'a@example.com',
        expect.objectContaining({ redirectTo: expect.any(String) }),
      ),
    );
  });

  it('shows the signed-in email and signs out on request', async () => {
    auth.onAuthStateChange.mockImplementation((cb: (event: string, session: unknown) => void) => {
      setTimeout(() => cb('SIGNED_IN', { user: { id: 'u1', email: 'person@example.com' } }), 0);
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    auth.signOut.mockResolvedValue({ error: null });

    renderPanel();
    expect(await screen.findByText(/Signed in as/)).toBeTruthy();
    expect(screen.getByText('person@example.com')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(auth.signOut).toHaveBeenCalled());
  });
});
