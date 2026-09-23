// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from './App';

/**
 * The login-first gate (`AuthGate` in App.tsx) is tested here purely as a
 * function of `useAuth()`/`useCloudSync()` — both mocked directly, the same
 * pattern `SyncStatusPanel.test.tsx` and `AccountPanel.test.tsx` already use
 * for a single hook. This sidesteps needing a real Supabase session or cloud
 * data for what is fundamentally "given this auth/cloud-sync state, what is
 * on screen" — `CloudSyncContext.test.tsx`, `LinkingChoice.test.tsx`, and
 * `AccountPanel.test.tsx` already cover how those states are *reached*.
 */

const authState = vi.hoisted(() => ({
  isSupabaseConfigured: true,
  status: 'ready' as 'loading' | 'ready',
  user: null as { id: string; email: string } | null,
  signOut: vi.fn(),
}));
const cloudSyncState = vi.hoisted(() => ({
  status: 'idle' as string,
}));

vi.mock('./store/useAuth', () => ({ useAuth: () => authState }));
vi.mock('./store/useCloudSync', () => ({ useCloudSync: () => cloudSyncState }));
vi.mock('./components/LinkingChoice', () => ({
  LinkingChoice: () => <div data-testid="linking-choice">linking choice</div>,
}));
// `useAuth` above is mocked, but `CloudSyncProvider` (rendered for real by
// App.tsx) still runs its own repository calls whenever the mocked auth
// state has a user — this must never reach a real Supabase project
// regardless of what `.env.local` in this repo happens to contain.
vi.mock('./lib/supabaseClient', () => ({ supabase: null, isSupabaseConfigured: false }));

afterEach(() => {
  cleanup();
  localStorage.clear();
  // BrowserRouter reads the real jsdom URL, so a test that navigates must not leak its route.
  window.history.pushState({}, '', '/');
  vi.clearAllMocks();
  authState.isSupabaseConfigured = true;
  authState.status = 'ready';
  authState.user = null;
  cloudSyncState.status = 'idle';
});

describe('AuthGate — signed out (Supabase configured)', () => {
  it('shows a loading screen, not the app, while the initial session check is in flight', () => {
    authState.status = 'loading';
    render(<App />);

    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Today' })).toBeNull();
  });

  it('shows the login screen, not the app, once signed-out is confirmed', () => {
    authState.status = 'ready';
    authState.user = null;
    render(<App />);

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Today' })).toBeNull();
  });

  it('never renders project/task/note/nav content while signed out', () => {
    authState.status = 'ready';
    authState.user = null;
    render(<App />);

    // The landing page's marketing copy legitimately mentions feature names
    // like "Projects" and "Calendar" in prose, so assert on the actual nav
    // affordances (links/headings), not on plain text matches.
    expect(screen.queryByRole('link', { name: 'Today' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Board' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Projects' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Calendar' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Main navigation' })).toBeNull();
  });

  it('shows the public landing page: brand, marketing copy, and no app chrome', () => {
    authState.status = 'ready';
    authState.user = null;
    render(<App />);

    expect(screen.getByAltText('GSD')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'GSD (Get S$$T Done)' })).toBeTruthy();
    expect(screen.getByText(/brings your goals, projects, tasks/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /export/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull();
  });

  it('puts Log in and Create account calls to action near the top', () => {
    authState.status = 'ready';
    authState.user = null;
    render(<App />);

    expect(screen.getAllByRole('button', { name: 'Log in' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Create account' }).length).toBeGreaterThan(0);
  });

  it('the top Log in / Create account buttons switch the embedded account form', () => {
    authState.status = 'ready';
    authState.user = null;
    render(<App />);

    // Sign-in is the default tab.
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Create account' })[0]);
    expect(screen.getByRole('heading', { name: 'Create an account' })).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Log in' })[0]);
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy();
  });
});

describe('AuthGate — signed in (Supabase configured)', () => {
  it('shows the app shell and nav once signed in', () => {
    authState.status = 'ready';
    authState.user = { id: 'user-1', email: 'person@example.com' };
    cloudSyncState.status = 'idle';
    render(<App />);

    expect(screen.getAllByRole('link', { name: 'Today' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Settings' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });

  it('shows an icon beside every desktop sidebar label, in the existing order, with the active section marked', () => {
    authState.status = 'ready';
    authState.user = { id: 'user-1', email: 'person@example.com' };
    cloudSyncState.status = 'idle';
    render(<App />);

    const sidebar = screen.getByRole('complementary', { name: 'Main navigation' });
    const links = within(sidebar).getAllByRole('link');

    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Today', '/'],
      ['Board', '/board'],
      ['Tasks', '/tasks'],
      ['Projects', '/projects'],
      ['Goals', '/goals'],
      ['Calendar', '/calendar'],
      ['About', '/about'],
      ['Settings', '/settings'],
    ]);
    for (const link of links) {
      const icon = link.querySelector('svg');
      expect(icon).not.toBeNull();
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
    }

    // Today is the active section on first load; its icon lives inside the active link.
    expect(within(sidebar).getByRole('link', { name: 'Today' }).className).toContain('active');
    fireEvent.click(within(sidebar).getByRole('link', { name: 'Calendar' }));
    const calendar = within(sidebar).getByRole('link', { name: 'Calendar' });
    expect(calendar.className).toContain('active');
    expect(calendar.querySelector('svg')).not.toBeNull();
    expect(within(sidebar).getByRole('link', { name: 'Today' }).className).not.toContain('active');
  });

  it('blocks the app behind LinkingChoice while an explicit account-link choice is pending', () => {
    authState.status = 'ready';
    authState.user = { id: 'user-1', email: 'person@example.com' };
    cloudSyncState.status = 'needs-choice';
    render(<App />);

    expect(screen.getByTestId('linking-choice')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Today' })).toBeNull();
  });

  it('clicking the Tasks nav link actually navigates to the Tasks view (regression: a Quick Notes cloud error must never block routing)', () => {
    authState.status = 'ready';
    authState.user = { id: 'user-1', email: 'person@example.com' };
    cloudSyncState.status = 'idle';
    render(<App />);

    // Today's content is showing by default.
    expect(screen.getByText('Primary tasks')).toBeTruthy();
    expect(screen.queryByText(/Untriaged inbox/)).toBeNull();

    fireEvent.click(screen.getAllByRole('link', { name: 'Tasks' })[0]);

    expect(screen.getByText(/Untriaged inbox/)).toBeTruthy();
    expect(screen.queryByText('Primary tasks')).toBeNull();
  });

  it('returns to the landing page immediately after sign-out', () => {
    authState.status = 'ready';
    authState.user = { id: 'user-1', email: 'person@example.com' };
    const { rerender } = render(<App />);
    expect(screen.getAllByRole('link', { name: 'Today' }).length).toBeGreaterThan(0);

    authState.user = null;
    rerender(<App />);

    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Today' })).toBeNull();
  });

  it('shows a Log out control in the top bar from every page, and it calls the existing sign-out logic', () => {
    authState.status = 'ready';
    authState.user = { id: 'user-1', email: 'person@example.com' };
    cloudSyncState.status = 'idle';
    render(<App />);

    expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy();

    fireEvent.click(screen.getAllByRole('link', { name: 'Calendar' })[0]);
    expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(authState.signOut).toHaveBeenCalled();
  });
});

describe('AuthGate — Supabase not configured', () => {
  it('renders the app directly, with no gate, exactly as before login-first sync existed', () => {
    authState.isSupabaseConfigured = false;
    authState.status = 'ready';
    authState.user = null;
    render(<App />);

    expect(screen.getAllByRole('link', { name: 'Today' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });

  it('never shows a Log out control when Supabase is not configured (nothing to sign out of)', () => {
    authState.isSupabaseConfigured = false;
    authState.status = 'ready';
    authState.user = null;
    render(<App />);

    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull();
  });
});
