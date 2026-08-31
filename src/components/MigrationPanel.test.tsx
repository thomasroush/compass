// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createEmptyAppData, type AppData } from '../types';
import { MigrationPanel } from './MigrationPanel';

const appState = vi.hoisted(() => ({
  current: { version: 1, tasks: [], projects: [], dailyNotes: [] } as AppData,
  dispatch: vi.fn(),
}));
const authState = vi.hoisted(() => ({
  isSupabaseConfigured: true,
  user: null as { email: string } | null,
}));
const migration = vi.hoisted(() => ({
  countLocalData: vi.fn(),
  getCloudCounts: vi.fn(),
  runMigration: vi.fn(),
}));

vi.mock('../store/useApp', () => ({
  useApp: () => ({ state: appState.current, dispatch: appState.dispatch }),
}));
vi.mock('../store/useAuth', () => ({
  useAuth: () => ({
    isSupabaseConfigured: authState.isSupabaseConfigured,
    user: authState.user,
  }),
}));
vi.mock('../repository/migration', () => migration);

function seedLocalData(): AppData {
  return {
    ...createEmptyAppData(),
    projects: [{ id: 'p1', name: 'Home', status: 'active' }],
    tasks: [
      {
        id: 't1',
        title: 'Buy milk',
        status: 'Inbox',
        priority: 'Normal',
        createdAt: '2026-08-30T00:00:00.000Z',
        sortOrder: 0,
        isPrimary: false,
        archived: false,
      },
    ],
    dailyNotes: [{ id: 'n1', date: '2026-08-30', morning: 'Plan', evening: 'Review' }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.isSupabaseConfigured = true;
  authState.user = null;
  appState.current = seedLocalData();
  appState.dispatch = vi.fn();
  migration.countLocalData.mockImplementation((local: AppData) => ({
    projects: local.projects.length,
    tasks: local.tasks.length,
    dailyNotes: local.dailyNotes.length,
  }));
});

afterEach(() => {
  cleanup();
});

describe('MigrationPanel — no migration without authentication', () => {
  it('shows no migrate button and never checks cloud counts when signed out', () => {
    authState.user = null;
    render(<MigrationPanel />);

    expect(screen.getByText(/Sign in above/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Migrate this device/i })).toBeNull();
    expect(migration.getCloudCounts).not.toHaveBeenCalled();
  });

  it('renders nothing when Supabase is not configured', () => {
    authState.isSupabaseConfigured = false;
    const { container } = render(<MigrationPanel />);
    expect(container.textContent).toBe('');
  });
});

describe('MigrationPanel — no migration without explicit confirmation', () => {
  it('does not call runMigration just from opening the review step', async () => {
    authState.user = { email: 'person@example.com' };
    migration.getCloudCounts.mockResolvedValue({
      ok: true,
      data: { projects: 0, tasks: 0, dailyNotes: 0 },
    });

    render(<MigrationPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Migrate this device/i }));

    await waitFor(() => expect(screen.getByText(/Copy device data to your account/i)).toBeTruthy());
    expect(migration.runMigration).not.toHaveBeenCalled();

    // Cancelling must not migrate either.
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(migration.runMigration).not.toHaveBeenCalled();
  });

  it('only calls runMigration after the explicit "Copy data to cloud" confirmation', async () => {
    authState.user = { email: 'person@example.com' };
    migration.getCloudCounts.mockResolvedValue({
      ok: true,
      data: { projects: 2, tasks: 3, dailyNotes: 1 },
    });
    migration.runMigration.mockResolvedValue({
      ok: true,
      attempted: { projects: 1, tasks: 1, dailyNotes: 1 },
      uploaded: { projects: 1, tasks: 1, dailyNotes: 1 },
      uploadFailures: [],
      verification: {
        passed: true,
        cloudCountsAfter: { projects: 3, tasks: 4, dailyNotes: 2 },
        issues: [],
      },
    });

    render(<MigrationPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Migrate this device/i }));
    await waitFor(() => expect(screen.getByText(/Copy device data to your account/i)).toBeTruthy());

    expect(migration.runMigration).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Copy data to cloud/i }));

    await waitFor(() => expect(migration.runMigration).toHaveBeenCalledTimes(1));
    expect(migration.runMigration).toHaveBeenCalledWith(appState.current);
    await waitFor(() => expect(screen.getByText(/Migration complete and verified/i)).toBeTruthy());
  });
});

describe('MigrationPanel — reporting outcomes', () => {
  async function openAndConfirm() {
    authState.user = { email: 'person@example.com' };
    migration.getCloudCounts.mockResolvedValue({
      ok: true,
      data: { projects: 0, tasks: 0, dailyNotes: 0 },
    });
    render(<MigrationPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Migrate this device/i }));
    await waitFor(() => expect(screen.getByText(/Copy device data to your account/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Copy data to cloud/i }));
  }

  it('reports partial upload failures clearly, and does not claim success', async () => {
    migration.runMigration.mockResolvedValue({
      ok: false,
      attempted: { projects: 1, tasks: 1, dailyNotes: 1 },
      uploaded: { projects: 1, tasks: 0, dailyNotes: 1 },
      uploadFailures: [
        { entity: 'task', id: 't1', label: 'Buy milk', message: 'violates foreign key constraint' },
      ],
      verification: {
        passed: true,
        cloudCountsAfter: { projects: 1, tasks: 0, dailyNotes: 1 },
        issues: [],
      },
    });

    await openAndConfirm();

    await waitFor(() => expect(screen.getByText(/finished with problems/i)).toBeTruthy());
    expect(screen.getByText(/violates foreign key constraint/)).toBeTruthy();
    expect(screen.queryByText(/Migration complete and verified/i)).toBeNull();
  });

  it('reports verification failures clearly, and does not claim success', async () => {
    migration.runMigration.mockResolvedValue({
      ok: false,
      attempted: { projects: 1, tasks: 1, dailyNotes: 1 },
      uploaded: { projects: 1, tasks: 1, dailyNotes: 1 },
      uploadFailures: [],
      verification: {
        passed: false,
        cloudCountsAfter: { projects: 1, tasks: 0, dailyNotes: 1 },
        issues: [
          { entity: 'task', id: 't1', label: 'Buy milk', reason: 'not found in Supabase after migration' },
        ],
      },
    });

    await openAndConfirm();

    await waitFor(() => expect(screen.getByText(/finished with problems/i)).toBeTruthy());
    expect(screen.getByText(/not found in Supabase after migration/)).toBeTruthy();
    expect(screen.queryByText(/Migration complete and verified/i)).toBeNull();
  });

  it('reports an authentication failure without claiming any upload happened', async () => {
    migration.runMigration.mockResolvedValue({
      ok: false,
      attempted: { projects: 1, tasks: 1, dailyNotes: 1 },
      uploaded: { projects: 0, tasks: 0, dailyNotes: 0 },
      uploadFailures: [],
      verification: null,
      authError: 'You must be signed in to access cloud data.',
    });

    await openAndConfirm();

    await waitFor(() =>
      expect(screen.getByText(/Migration could not start: You must be signed in/i)).toBeTruthy(),
    );
  });
});

describe('MigrationPanel — local data retained', () => {
  it('never dispatches a local data change, even after a successful migration', async () => {
    authState.user = { email: 'person@example.com' };
    migration.getCloudCounts.mockResolvedValue({
      ok: true,
      data: { projects: 0, tasks: 0, dailyNotes: 0 },
    });
    migration.runMigration.mockResolvedValue({
      ok: true,
      attempted: { projects: 1, tasks: 1, dailyNotes: 1 },
      uploaded: { projects: 1, tasks: 1, dailyNotes: 1 },
      uploadFailures: [],
      verification: {
        passed: true,
        cloudCountsAfter: { projects: 1, tasks: 1, dailyNotes: 1 },
        issues: [],
      },
    });

    render(<MigrationPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Migrate this device/i }));
    await waitFor(() => expect(screen.getByText(/Copy device data to your account/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Copy data to cloud/i }));
    await waitFor(() => expect(screen.getByText(/Migration complete and verified/i)).toBeTruthy());

    expect(screen.getByText(/Local data in this browser has not been deleted or changed/i)).toBeTruthy();
    expect(appState.dispatch).not.toHaveBeenCalled();
  });
});
