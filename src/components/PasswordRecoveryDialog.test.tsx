// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PasswordRecoveryDialog } from './PasswordRecoveryDialog';
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

let authChangeCallback: (event: string, session: unknown) => void = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  auth.getSession.mockResolvedValue({ data: { session: null } });
  auth.onAuthStateChange.mockImplementation((cb: (event: string, session: unknown) => void) => {
    authChangeCallback = cb;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
});

afterEach(() => {
  cleanup();
});

function renderDialog() {
  return render(
    <AuthProvider>
      <PasswordRecoveryDialog />
    </AuthProvider>,
  );
}

function triggerRecovery() {
  act(() => {
    authChangeCallback('PASSWORD_RECOVERY', { user: { id: 'u1', email: 'x@example.com' } });
  });
}

describe('PasswordRecoveryDialog', () => {
  it('renders nothing until a password-recovery event occurs', async () => {
    renderDialog();
    await waitFor(() => expect(auth.getSession).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('rejects a too-short password before calling Supabase', async () => {
    renderDialog();
    await waitFor(() => expect(auth.getSession).toHaveBeenCalled());
    triggerRecovery();

    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: '123' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/at least 6 characters/i);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('rejects mismatched passwords before calling Supabase', async () => {
    renderDialog();
    await waitFor(() => expect(auth.getSession).toHaveBeenCalled());
    triggerRecovery();

    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'newpassword1' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'newpassword2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/do not match/i);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('updates the password and dismisses after Continue', async () => {
    auth.updateUser.mockResolvedValue({ error: null });
    renderDialog();
    await waitFor(() => expect(auth.getSession).toHaveBeenCalled());
    triggerRecovery();

    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'newpassword1' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'newpassword1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));

    await waitFor(() =>
      expect(auth.updateUser).toHaveBeenCalledWith({ password: 'newpassword1' }),
    );
    await screen.findByText('Password updated.');

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cancel dismisses without updating the password', async () => {
    renderDialog();
    await waitFor(() => expect(auth.getSession).toHaveBeenCalled());
    triggerRecovery();

    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});
