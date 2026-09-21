// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ManageSharingDialog } from './ManageSharingDialog';
import type { ProjectInvitation, ProjectMember } from '../repository/types';
import type { Project } from '../types';

const authState = vi.hoisted(() => ({
  isSupabaseConfigured: true,
  user: null as { id: string; email?: string } | null,
}));
const invitationsRepo = vi.hoisted(() => ({
  createInvitation: vi.fn(),
  listInvitationsForProject: vi.fn(),
  normalizeInvitationEmail: (email: string) => email.trim().toLowerCase(),
  revokeInvitation: vi.fn(),
}));
const membersRepo = vi.hoisted(() => ({
  listMembers: vi.fn(),
  removeMember: vi.fn(),
}));

vi.mock('../store/useAuth', () => ({ useAuth: () => authState }));
vi.mock('../repository/projectInvitationsRepository', () => invitationsRepo);
vi.mock('../repository/projectMembersRepository', () => membersRepo);

function ok<T>(data: T) {
  return { ok: true as const, data };
}
function err(message: string) {
  return { ok: false as const, error: { type: 'database' as const, message } };
}

const project: Project = { id: 'proj-1', name: 'Marketing launch', status: 'active', ownerId: 'owner-1' };

const pendingInvitation: ProjectInvitation = {
  id: 'inv-1',
  ownerId: 'owner-1',
  projectId: 'proj-1',
  invitedEmail: 'editor@example.com',
  status: 'pending',
  createdAt: '2026-09-16T00:00:00.000Z',
};

const acceptedMember: ProjectMember = {
  ownerId: 'owner-1',
  projectId: 'proj-1',
  memberId: 'editor-1',
  memberEmail: 'editor@example.com',
  role: 'editor',
  createdAt: '2026-09-16T00:00:00.000Z',
};

function renderDialog(onClose = vi.fn()) {
  return render(<ManageSharingDialog project={project} accountId="owner-1" onClose={onClose} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.isSupabaseConfigured = true;
  authState.user = { id: 'owner-1', email: 'owner@example.com' };
  invitationsRepo.listInvitationsForProject.mockResolvedValue(ok([]));
  membersRepo.listMembers.mockResolvedValue(ok([]));
});

afterEach(() => {
  cleanup();
});

describe('ManageSharingDialog — loading and layout', () => {
  it('loads both invitations and members for the given Project on mount', async () => {
    renderDialog();
    await waitFor(() => expect(invitationsRepo.listInvitationsForProject).toHaveBeenCalledWith('proj-1'));
    expect(membersRepo.listMembers).toHaveBeenCalledWith('proj-1');
  });

  it('shows the explanation that GSD sends no invitation email', () => {
    renderDialog();
    expect(
      screen.getByText(/GSD does not send an invitation email yet\. Tell this person to sign in/),
    ).toBeTruthy();
  });

  it('has a labeled email input and an accessible Invite button', () => {
    renderDialog();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Invite' })).toBeTruthy();
  });

  it('ends the loading state and shows the normal empty state once both lists resolve with no results', async () => {
    invitationsRepo.listInvitationsForProject.mockResolvedValue(ok([]));
    membersRepo.listMembers.mockResolvedValue(ok([]));
    renderDialog();

    expect(await screen.findByText('No pending invitations.')).toBeTruthy();
    expect(screen.getByText('No collaborators yet.')).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
  });
});

describe('ManageSharingDialog — call discipline on open', () => {
  it('calls each list function exactly once when the dialog opens', async () => {
    renderDialog();
    await waitFor(() => expect(invitationsRepo.listInvitationsForProject).toHaveBeenCalledTimes(1));
    expect(membersRepo.listMembers).toHaveBeenCalledTimes(1);
  });

  it('does not re-call the list functions when the dialog re-renders with a new onClose identity (as happens every time its parent view re-renders)', async () => {
    const { rerender } = renderDialog();
    await screen.findByText('No pending invitations.');

    rerender(<ManageSharingDialog project={project} accountId="owner-1" onClose={vi.fn()} />);

    expect(invitationsRepo.listInvitationsForProject).toHaveBeenCalledTimes(1);
    expect(membersRepo.listMembers).toHaveBeenCalledTimes(1);
  });
});

describe('ManageSharingDialog — React 18 StrictMode (main.tsx wraps the whole app in it)', () => {
  it("still ends the loading state and shows the normal empty state under StrictMode's development mount→cleanup→remount of effects", async () => {
    render(
      <StrictMode>
        <ManageSharingDialog project={project} accountId="owner-1" onClose={vi.fn()} />
      </StrictMode>,
    );

    // Regression test for a real, previously-shipped bug: a `useRef` "is this
    // still mounted" flag, flipped by a separate mount-only effect's cleanup,
    // survives StrictMode's simulated remount (refs are not reset by it) —
    // so the *second* (real) invocation's results were silently discarded
    // forever, leaving both sections on "Loading…" indefinitely. This must
    // resolve to the normal empty state instead.
    expect(await screen.findByText('No pending invitations.')).toBeTruthy();
    expect(screen.getByText('No collaborators yet.')).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('still shows a repository error, not a stuck Loading state, under StrictMode', async () => {
    invitationsRepo.listInvitationsForProject.mockResolvedValue(err('Network request failed.'));

    render(
      <StrictMode>
        <ManageSharingDialog project={project} accountId="owner-1" onClose={vi.fn()} />
      </StrictMode>,
    );

    expect((await screen.findByRole('alert')).textContent).toBe('Network request failed.');
    expect(screen.queryByText('Loading…')).toBeNull();
  });
});

describe('ManageSharingDialog — inviting', () => {
  it('rejects an invalid email format without calling the repository', async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));

    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
    expect(invitationsRepo.createInvitation).not.toHaveBeenCalled();
  });

  it("rejects inviting the signed-in Owner's own email", async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'Owner@Example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));

    expect(await screen.findByText('You cannot invite your own email address.')).toBeTruthy();
    expect(invitationsRepo.createInvitation).not.toHaveBeenCalled();
  });

  it('invites via the repository with the normalized email, then clears the field and reloads the lists', async () => {
    invitationsRepo.createInvitation.mockResolvedValue(ok(pendingInvitation));
    renderDialog();
    await waitFor(() => expect(invitationsRepo.listInvitationsForProject).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: '  Editor@Example.com  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));

    await waitFor(() =>
      expect(invitationsRepo.createInvitation).toHaveBeenCalledWith('proj-1', 'Editor@Example.com', 'owner-1'),
    );
    await waitFor(() => expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe(''));
    await waitFor(() => expect(invitationsRepo.listInvitationsForProject).toHaveBeenCalledTimes(2));
  });

  it('shows a useful message for a duplicate pending invitation', async () => {
    invitationsRepo.createInvitation.mockResolvedValue({ ok: false, error: { type: 'duplicate', message: 'dup' } });
    renderDialog();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'editor@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));

    expect(await screen.findByText('This person already has a pending invitation to this Project.')).toBeTruthy();
  });
});

describe('ManageSharingDialog — pending invitations', () => {
  it('shows a pending invitation with its email and date, and hides non-pending ones', async () => {
    invitationsRepo.listInvitationsForProject.mockResolvedValue(
      ok([pendingInvitation, { ...pendingInvitation, id: 'inv-2', invitedEmail: 'declined@example.com', status: 'declined' }]),
    );
    renderDialog();

    expect(await screen.findByText('editor@example.com')).toBeTruthy();
    expect(screen.getByText(/Invited 2026-09-16/)).toBeTruthy();
    expect(screen.queryByText('declined@example.com')).toBeNull();
  });

  it('revoking calls the repository and reloads the lists, with no confirmation dialog', async () => {
    invitationsRepo.listInvitationsForProject.mockResolvedValue(ok([pendingInvitation]));
    invitationsRepo.revokeInvitation.mockResolvedValue(ok({ ...pendingInvitation, status: 'revoked' }));
    renderDialog();
    await screen.findByText('editor@example.com');

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));

    expect(screen.queryByRole('dialog', { name: /remove/i })).toBeNull();
    await waitFor(() => expect(invitationsRepo.revokeInvitation).toHaveBeenCalledWith('inv-1', 'owner-1'));
    await waitFor(() => expect(invitationsRepo.listInvitationsForProject).toHaveBeenCalledTimes(2));
  });
});

describe('ManageSharingDialog — current collaborators', () => {
  it("shows the collaborator's email and a simple Editor role", async () => {
    membersRepo.listMembers.mockResolvedValue(ok([acceptedMember]));
    renderDialog();

    expect(await screen.findByText('editor@example.com')).toBeTruthy();
    expect(screen.getByText('Editor')).toBeTruthy();
  });

  it('shows "Unknown collaborator" instead of a UUID for a legacy membership with no memberEmail', async () => {
    membersRepo.listMembers.mockResolvedValue(ok([{ ...acceptedMember, memberEmail: undefined }]));
    renderDialog();

    expect(await screen.findByText('Unknown collaborator')).toBeTruthy();
    expect(screen.queryByText('editor-1')).toBeNull();
  });

  it('requires confirmation before removing a collaborator', async () => {
    membersRepo.listMembers.mockResolvedValue(ok([acceptedMember]));
    renderDialog();
    await screen.findByText('editor@example.com');

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(membersRepo.removeMember).not.toHaveBeenCalled();
    const confirmDialog = screen.getByRole('dialog', { name: 'Remove collaborator' });
    expect(within(confirmDialog).getByText(/Remove editor@example.com/)).toBeTruthy();
  });

  it('removes the collaborator only after confirming, then reloads the lists', async () => {
    membersRepo.listMembers.mockResolvedValue(ok([acceptedMember]));
    membersRepo.removeMember.mockResolvedValue(ok(undefined));
    renderDialog();
    await screen.findByText('editor@example.com');

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const confirmDialog = screen.getByRole('dialog', { name: 'Remove collaborator' });
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() =>
      expect(membersRepo.removeMember).toHaveBeenCalledWith('proj-1', 'editor-1', 'owner-1'),
    );
    await waitFor(() => expect(membersRepo.listMembers).toHaveBeenCalledTimes(2));
  });

  it('cancelling the confirmation does not remove the collaborator', async () => {
    membersRepo.listMembers.mockResolvedValue(ok([acceptedMember]));
    renderDialog();
    await screen.findByText('editor@example.com');

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const confirmDialog = screen.getByRole('dialog', { name: 'Remove collaborator' });
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Cancel' }));

    expect(membersRepo.removeMember).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Remove collaborator' })).toBeNull();
  });
});

describe('ManageSharingDialog — failures', () => {
  it('shows an error without crashing when loading invitations/members fails', async () => {
    invitationsRepo.listInvitationsForProject.mockResolvedValue(err('Network request failed.'));
    renderDialog();

    expect((await screen.findByRole('alert')).textContent).toBe('Network request failed.');
    expect(screen.getByRole('button', { name: 'Invite' })).toBeTruthy();
  });

  it('ends the loading state and shows an error instead of loading forever when a repository call throws instead of resolving', async () => {
    invitationsRepo.listInvitationsForProject.mockRejectedValue(new Error('Failed to fetch'));
    renderDialog();

    expect((await screen.findByRole('alert')).textContent).toBe('Failed to fetch');
    // Neither section is left stuck on "Loading…".
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.getByText('No pending invitations.')).toBeTruthy();
    expect(screen.getByText('No collaborators yet.')).toBeTruthy();
  });
});

describe('ManageSharingDialog — closing', () => {
  it('calls onClose when Close is clicked', () => {
    const onClose = vi.fn();
    renderDialog(onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
