// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SyncStatusPanel } from './SyncStatusPanel';
import type { SyncStatus } from '../store/SyncEngineContext';

const authState = vi.hoisted(() => ({
  isSupabaseConfigured: true,
  user: null as { id: string; email: string } | null,
}));
const syncState = vi.hoisted(() => ({
  status: 'idle' as SyncStatus,
  pendingCount: 0,
  message: null as string | null,
  syncNow: vi.fn(),
}));
const cloudSyncState = vi.hoisted(() => ({
  status: 'idle',
  retry: vi.fn(),
}));

vi.mock('../store/useAuth', () => ({ useAuth: () => authState }));
vi.mock('../store/useSyncEngine', () => ({ useSyncEngine: () => syncState }));
vi.mock('../store/useCloudSync', () => ({ useCloudSync: () => cloudSyncState }));

function setSync(overrides: Partial<typeof syncState>) {
  Object.assign(syncState, { status: 'idle', pendingCount: 0, message: null, ...overrides });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  cloudSyncState.status = 'idle';
});

describe('SyncStatusPanel — visibility', () => {
  it('renders nothing while signed out', () => {
    authState.isSupabaseConfigured = true;
    authState.user = null;
    const { container } = render(<SyncStatusPanel />);
    expect(container.textContent).toBe('');
  });

  it('renders nothing when Supabase is not configured', () => {
    authState.isSupabaseConfigured = false;
    authState.user = { id: 'user-1', email: 'person@example.com' };
    const { container } = render(<SyncStatusPanel />);
    expect(container.textContent).toBe('');
  });
});

describe('SyncStatusPanel — status wording communicates whether writes are safe', () => {
  beforeEach(() => {
    authState.isSupabaseConfigured = true;
    authState.user = { id: 'user-1', email: 'person@example.com' };
  });

  it('unlinked: explains this device is not yet linked and edits are not syncing automatically — the load-bearing distinction from every other status', () => {
    setSync({ status: 'unlinked', pendingCount: 2 });
    render(<SyncStatusPanel />);

    const notice = screen.getByRole('status');
    expect(notice.textContent).toMatch(/not yet linked/i);
    expect(notice.textContent).toMatch(/not syncing automatically/i);
  });

  it('pending: explains changes are waiting to sync', () => {
    setSync({ status: 'pending', pendingCount: 1 });
    render(<SyncStatusPanel />);
    expect(screen.getByRole('status').textContent).toMatch(/pending.*waiting to sync/i);
  });

  it('syncing: explains a sync is in progress', () => {
    setSync({ status: 'syncing' });
    render(<SyncStatusPanel />);
    expect(screen.getByRole('status').textContent).toMatch(/syncing/i);
  });

  it("synced: confirms everything reached the account (SyncEngineContext's own contract keeps this from ever being shown with pending work — this panel just renders whatever status it is given)", () => {
    setSync({ status: 'synced', pendingCount: 0 });
    render(<SyncStatusPanel />);
    expect(screen.getByRole('status').textContent).toMatch(/all changes are synced/i);
    expect(screen.queryByText(/not yet confirmed/i)).toBeNull();
  });

  it('conflict: shows the conflict explanation and the underlying message', () => {
    setSync({ status: 'conflict', message: 'A record with this id already exists with different content.' });
    render(<SyncStatusPanel />);
    const notice = screen.getByRole('status');
    expect(notice.textContent).toMatch(/could not sync because the record changed/i);
    expect(notice.textContent).toMatch(/already exists with different content/);
  });

  it('offline: shows the offline explanation', () => {
    setSync({ status: 'offline' });
    render(<SyncStatusPanel />);
    expect(screen.getByRole('status').textContent).toMatch(/could not reach the server/i);
  });

  it('error: shows a generic error explanation plus the underlying message', () => {
    setSync({ status: 'error', message: 'violates check constraint' });
    render(<SyncStatusPanel />);
    const notice = screen.getByRole('status');
    expect(notice.textContent).toMatch(/some changes could not sync/i);
    expect(notice.textContent).toMatch(/violates check constraint/);
  });

  it('shows the pending count whenever it is nonzero, regardless of status', () => {
    setSync({ status: 'pending', pendingCount: 3 });
    render(<SyncStatusPanel />);
    expect(screen.getByText(/3 changes not yet confirmed/i)).toBeTruthy();
  });
});

describe('SyncStatusPanel — "Sync now" cannot bypass the linking gate', () => {
  beforeEach(() => {
    authState.isSupabaseConfigured = true;
    authState.user = { id: 'user-1', email: 'person@example.com' };
  });

  it('disables the Sync now button while unlinked', () => {
    setSync({ status: 'unlinked' });
    render(<SyncStatusPanel />);
    expect(screen.getByRole('button', { name: /Sync now/i })).toHaveProperty('disabled', true);
  });

  it('disables the Sync now button while a sync is already in progress', () => {
    setSync({ status: 'syncing' });
    render(<SyncStatusPanel />);
    expect(screen.getByRole('button', { name: /Sync now/i })).toHaveProperty('disabled', true);
  });

  it('enables the Sync now button once linked and idle, and clicking it calls syncNow', () => {
    setSync({ status: 'synced' });
    render(<SyncStatusPanel />);

    const button = screen.getByRole('button', { name: /Sync now/i });
    expect(button).toHaveProperty('disabled', false);

    fireEvent.click(button);
    expect(syncState.syncNow).toHaveBeenCalledTimes(1);
  });

  it('clicking Sync now while unlinked (a disabled button) never calls syncNow', () => {
    setSync({ status: 'unlinked' });
    render(<SyncStatusPanel />);

    fireEvent.click(screen.getByRole('button', { name: /Sync now/i }));
    expect(syncState.syncNow).not.toHaveBeenCalled();
  });
});

describe('SyncStatusPanel — "Refresh from cloud" (the pull-side counterpart to "Sync now")', () => {
  beforeEach(() => {
    authState.isSupabaseConfigured = true;
    authState.user = { id: 'user-1', email: 'person@example.com' };
  });

  it('clicking it calls the cloud-sync retry action', () => {
    setSync({ status: 'synced' });
    render(<SyncStatusPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh from cloud' }));
    expect(cloudSyncState.retry).toHaveBeenCalledTimes(1);
  });

  it('is disabled while this device is unlinked', () => {
    setSync({ status: 'unlinked' });
    render(<SyncStatusPanel />);
    expect(screen.getByRole('button', { name: 'Refresh from cloud' })).toHaveProperty('disabled', true);
  });
});
