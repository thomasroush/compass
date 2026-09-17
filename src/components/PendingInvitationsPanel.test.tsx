// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PendingInvitationsPanel } from './PendingInvitationsPanel';
import type { ProjectInvitation } from '../repository/types';

const authState = vi.hoisted(() => ({
  isSupabaseConfigured: true,
  user: null as { id: string } | null,
}));
const cloudSyncState = vi.hoisted(() => ({ refreshAcceptingServer: vi.fn() }));
const invitationsRepo = vi.hoisted(() => ({
  listPendingInvitationsForMe: vi.fn(),
  acceptInvitation: vi.fn(),
  declineInvitation: vi.fn(),
}));

vi.mock('../store/useAuth', () => ({ useAuth: () => authState }));
vi.mock('../store/useCloudSync', () => ({ useCloudSync: () => cloudSyncState }));
vi.mock('../repository/projectInvitationsRepository', () => invitationsRepo);

function ok<T>(data: T) {
  return { ok: true as const, data };
}
function err(message: string) {
  return { ok: false as const, error: { type: 'database' as const, message } };
}

const invitation: ProjectInvitation = {
  id: 'inv-1',
  ownerId: 'owner-1',
  projectId: 'proj-1',
  invitedEmail: 'me@example.com',
  status: 'pending',
  createdAt: '2026-09-16T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  authState.isSupabaseConfigured = true;
  authState.user = { id: 'me' };
  invitationsRepo.listPendingInvitationsForMe.mockResolvedValue(ok([]));
});

afterEach(() => {
  cleanup();
});

describe('PendingInvitationsPanel — visibility', () => {
  it('renders nothing when signed out', async () => {
    authState.user = null;
    const { container } = render(<PendingInvitationsPanel />);
    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(invitationsRepo.listPendingInvitationsForMe).not.toHaveBeenCalled();
  });

  it('renders nothing when Supabase is not configured', async () => {
    authState.isSupabaseConfigured = false;
    authState.user = { id: 'me' };
    const { container } = render(<PendingInvitationsPanel />);
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('renders nothing while there are no pending invitations', async () => {
    invitationsRepo.listPendingInvitationsForMe.mockResolvedValue(ok([]));
    const { container } = render(<PendingInvitationsPanel />);
    await waitFor(() => expect(invitationsRepo.listPendingInvitationsForMe).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });

  it('appears with a generic "Project invitation" label and a date once there is a pending invitation', async () => {
    invitationsRepo.listPendingInvitationsForMe.mockResolvedValue(ok([invitation]));
    render(<PendingInvitationsPanel />);

    expect(await screen.findByText('Project invitation')).toBeTruthy();
    expect(screen.getByText(/Invited 2026-09-16/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy();
    // Never a raw owner or Project id anywhere in the row.
    expect(screen.queryByText('owner-1')).toBeNull();
    expect(screen.queryByText('proj-1')).toBeNull();
  });

  it('quietly renders nothing when the load itself fails (no error banner without a section to put it in)', async () => {
    invitationsRepo.listPendingInvitationsForMe.mockResolvedValue(err('network down'));
    const { container } = render(<PendingInvitationsPanel />);
    await waitFor(() => expect(invitationsRepo.listPendingInvitationsForMe).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });
});

describe('PendingInvitationsPanel — accept', () => {
  it('accepts, removes the invitation from the list, and triggers a cloud refresh', async () => {
    invitationsRepo.listPendingInvitationsForMe.mockResolvedValue(ok([invitation]));
    invitationsRepo.acceptInvitation.mockResolvedValue(ok(undefined));
    render(<PendingInvitationsPanel />);
    await screen.findByText('Project invitation');

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    await waitFor(() => expect(invitationsRepo.acceptInvitation).toHaveBeenCalledWith('inv-1', 'me'));
    await waitFor(() => expect(screen.queryByText('Project invitation')).toBeNull());
    expect(cloudSyncState.refreshAcceptingServer).toHaveBeenCalledTimes(1);
  });

  it('shows an error and keeps the invitation when accepting fails, without crashing the view', async () => {
    invitationsRepo.listPendingInvitationsForMe.mockResolvedValue(ok([invitation]));
    invitationsRepo.acceptInvitation.mockResolvedValue(err('Could not reach the server.'));
    render(<PendingInvitationsPanel />);
    await screen.findByText('Project invitation');

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Could not reach the server.');
    expect(screen.getByText('Project invitation')).toBeTruthy();
    expect(cloudSyncState.refreshAcceptingServer).not.toHaveBeenCalled();
  });
});

describe('PendingInvitationsPanel — decline', () => {
  it('declines and removes the invitation from the list, without triggering a cloud refresh', async () => {
    invitationsRepo.listPendingInvitationsForMe.mockResolvedValue(ok([invitation]));
    invitationsRepo.declineInvitation.mockResolvedValue(ok(undefined));
    render(<PendingInvitationsPanel />);
    await screen.findByText('Project invitation');

    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));

    await waitFor(() => expect(invitationsRepo.declineInvitation).toHaveBeenCalledWith('inv-1', 'me'));
    await waitFor(() => expect(screen.queryByText('Project invitation')).toBeNull());
    expect(cloudSyncState.refreshAcceptingServer).not.toHaveBeenCalled();
  });

  it('shows an error and keeps the invitation when declining fails', async () => {
    invitationsRepo.listPendingInvitationsForMe.mockResolvedValue(ok([invitation]));
    invitationsRepo.declineInvitation.mockResolvedValue(err('This invitation is no longer pending.'));
    render(<PendingInvitationsPanel />);
    await screen.findByText('Project invitation');

    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));

    expect((await screen.findByRole('alert')).textContent).toBe('This invitation is no longer pending.');
    expect(screen.getByText('Project invitation')).toBeTruthy();
  });
});
