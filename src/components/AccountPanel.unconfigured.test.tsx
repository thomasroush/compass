// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AccountPanel } from './AccountPanel';
import { AuthProvider } from '../store/AuthContext';

vi.mock('../lib/supabaseClient', () => ({
  supabase: null,
  isSupabaseConfigured: false,
}));

afterEach(() => {
  cleanup();
});

describe('AccountPanel when Supabase is not configured', () => {
  it('explains that cloud access is unavailable and shows no auth forms', () => {
    render(
      <AuthProvider>
        <AccountPanel />
      </AuthProvider>,
    );
    expect(screen.getByText(/not connected to Supabase/i)).toBeTruthy();
    expect(screen.queryByLabelText('Email')).toBeNull();
  });
});
