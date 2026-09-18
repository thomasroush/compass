// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProjectsView } from './ProjectsView';
import { createEmptyAppData, type AppData } from '../types';

function renderWithRouter() {
  return render(
    <MemoryRouter>
      <ProjectsView />
    </MemoryRouter>,
  );
}

const mocks = vi.hoisted(() => ({
  appState: {
    current: { version: 1, tasks: [], projects: [], quickNotes: [], goals: [], targets: [] } as AppData,
    dispatch: vi.fn(),
  },
  // Local-only by default (no Supabase account) — every project is "owned",
  // the Shared badge and Manage sharing button never appear, matching every
  // pre-existing test in this file exactly. Tests that need a signed-in
  // Owner or Editor set `mocks.authState` explicitly.
  authState: { isSupabaseConfigured: false, user: null as { id: string; email?: string } | null },
}));

vi.mock('../store/useApp', () => ({
  useApp: () => ({ state: mocks.appState.current, dispatch: mocks.appState.dispatch }),
}));
vi.mock('../store/useAuth', () => ({ useAuth: () => mocks.authState }));
// Each has its own dedicated test file — ProjectsView only needs to prove it
// renders/gates the trigger correctly, not re-test their internal behavior.
vi.mock('../components/PendingInvitationsPanel', () => ({
  PendingInvitationsPanel: () => <div data-testid="pending-invitations-panel-stub" />,
}));
vi.mock('../components/ManageSharingDialog', () => ({
  ManageSharingDialog: (props: { project: { name: string }; onClose: () => void }) => (
    <div data-testid="manage-sharing-dialog-stub">
      Managing {props.project.name}
      <button type="button" onClick={props.onClose}>
        Close
      </button>
    </div>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appState.current = {
    ...createEmptyAppData(),
    projects: [
      { id: 'active-1', name: 'Website revamp', status: 'active' },
      { id: 'archived-1', name: 'Old newsletter', status: 'archived' },
    ],
  };
  mocks.authState = { isSupabaseConfigured: false, user: null };
});

afterEach(() => {
  cleanup();
});

describe('ProjectsView — archived projects are hidden', () => {
  it('does not list archived projects among visible projects', () => {
    render(<ProjectsView />);
    expect(screen.getByText('Website revamp')).toBeTruthy();
    expect(screen.queryByText('Old newsletter')).toBeNull();
  });

  it('shows the empty state when every project is archived', () => {
    mocks.appState.current = {
      ...createEmptyAppData(),
      projects: [{ id: 'archived-1', name: 'Old newsletter', status: 'archived' }],
    };
    render(<ProjectsView />);
    expect(screen.getByText('No projects yet.')).toBeTruthy();
  });
});

describe('ProjectsView — archiving requires confirmation', () => {
  it('opens a confirmation dialog and does not dispatch until confirmed', () => {
    render(<ProjectsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    expect(mocks.appState.dispatch).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/Archive "Website revamp"\?/)).toBeTruthy();
  });

  it('cancelling the confirmation dialog does not archive the project', () => {
    render(<ProjectsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(mocks.appState.dispatch).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('confirming dispatches UPDATE_PROJECT with status archived for the right project', () => {
    render(<ProjectsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));

    expect(mocks.appState.dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_PROJECT',
      id: 'active-1',
      status: 'archived',
    });
  });
});

describe('ProjectsView — priority ranking', () => {
  it('shows ranked projects first in numeric order, then unranked projects alphabetically', () => {
    mocks.appState.current = {
      ...createEmptyAppData(),
      projects: [
        { id: 'p-zebra', name: 'Zebra', status: 'active' },
        { id: 'p-beta', name: 'Beta project', status: 'active', priorityRank: 2 },
        { id: 'p-apple', name: 'Apple', status: 'active' },
        { id: 'p-alpha', name: 'Alpha project', status: 'active', priorityRank: 1 },
      ],
    };
    render(<ProjectsView />);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Alpha project', 'Beta project', 'Apple', 'Zebra']);
  });

  it('shows a priority badge only for ranked projects', () => {
    mocks.appState.current = {
      ...createEmptyAppData(),
      projects: [
        { id: 'ranked', name: 'Ranked', status: 'active', priorityRank: 1 },
        { id: 'unranked', name: 'Unranked', status: 'active' },
      ],
    };
    render(<ProjectsView />);
    expect(screen.getByText('Priority 1')).toBeTruthy();
  });

  it('editing a project and setting a priority dispatches UPDATE_PROJECT with the numeric priorityRank', () => {
    mocks.appState.current = {
      ...createEmptyAppData(),
      projects: [{ id: 'active-1', name: 'Website revamp', status: 'active' }],
    };
    render(<ProjectsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Priority (optional)'), {
      target: { value: '3' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(mocks.appState.dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_PROJECT',
      id: 'active-1',
      name: 'Website revamp',
      description: '',
      priorityRank: 3,
    });
  });

  it('clearing the priority field dispatches priorityRank: null', () => {
    mocks.appState.current = {
      ...createEmptyAppData(),
      projects: [{ id: 'active-1', name: 'Website revamp', status: 'active', priorityRank: 2 }],
    };
    render(<ProjectsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Priority (optional)'), {
      target: { value: '' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(mocks.appState.dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_PROJECT',
      id: 'active-1',
      name: 'Website revamp',
      description: '',
      priorityRank: null,
    });
  });

  it('opening the edit dialog pre-fills the priority field from the project', () => {
    mocks.appState.current = {
      ...createEmptyAppData(),
      projects: [{ id: 'active-1', name: 'Website revamp', status: 'active', priorityRank: 5 }],
    };
    render(<ProjectsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByLabelText('Priority (optional)') as HTMLInputElement).value).toBe(
      '5',
    );
  });
});

describe('ProjectsView — linked goals (read-only)', () => {
  it('shows a linked goal, with its status and progress, only once the project is expanded', () => {
    mocks.appState.current = {
      ...createEmptyAppData(),
      projects: [{ id: 'active-1', name: 'Website revamp', status: 'active' }],
      goals: [
        {
          id: 'g1',
          name: 'Grow revenue',
          priority: 'Normal',
          status: 'active',
          projectIds: ['active-1'],
        },
      ],
      targets: [
        {
          id: 't1',
          goalId: 'g1',
          name: 'Milestone',
          sortOrder: 0,
          archived: false,
          type: 'yesno',
          achieved: true,
        },
      ],
    };
    renderWithRouter();

    expect(screen.queryByText('Grow revenue')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show tasks' }));

    const goalsSection = screen.getByText('Linked goals').closest('.project-goals') as HTMLElement;
    expect(within(goalsSection).getByText('Grow revenue')).toBeTruthy();
    expect(within(goalsSection).getByText('active')).toBeTruthy();
    expect(within(goalsSection).getByText('100%')).toBeTruthy();
  });

  it('links the goal name to its detail page', () => {
    mocks.appState.current = {
      ...createEmptyAppData(),
      projects: [{ id: 'active-1', name: 'Website revamp', status: 'active' }],
      goals: [{ id: 'g1', name: 'Grow revenue', priority: 'Normal', status: 'active', projectIds: ['active-1'] }],
    };
    renderWithRouter();
    fireEvent.click(screen.getByRole('button', { name: 'Show tasks' }));
    expect(screen.getByRole('link', { name: 'Grow revenue' }).getAttribute('href')).toBe('/goals/g1');
  });

  it('does not show a linked-goals section for a project with no linked goals', () => {
    mocks.appState.current = {
      ...createEmptyAppData(),
      projects: [{ id: 'active-1', name: 'Website revamp', status: 'active' }],
    };
    renderWithRouter();
    fireEvent.click(screen.getByRole('button', { name: 'Show tasks' }));
    expect(screen.queryByText('Linked goals')).toBeNull();
  });

  it('does not show any goal-editing controls (link/unlink) in the project view', () => {
    mocks.appState.current = {
      ...createEmptyAppData(),
      projects: [{ id: 'active-1', name: 'Website revamp', status: 'active' }],
      goals: [{ id: 'g1', name: 'Grow revenue', priority: 'Normal', status: 'active', projectIds: ['active-1'] }],
    };
    renderWithRouter();
    fireEvent.click(screen.getByRole('button', { name: 'Show tasks' }));
    expect(screen.queryByRole('button', { name: /Unlink/ })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});

describe('ProjectsView — pending invitations', () => {
  it('renders the pending-invitations panel near the top of the view', () => {
    render(<ProjectsView />);
    const panel = screen.getByTestId('pending-invitations-panel-stub');
    const heading = screen.getByRole('heading', { name: 'Projects' });
    // Same parent, appears right after the page header/before the project list.
    expect(heading.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('ProjectsView — shared Projects', () => {
  it('shows a Shared badge only for a Project owned by a different account', () => {
    mocks.authState = { isSupabaseConfigured: true, user: { id: 'me' } };
    mocks.appState.current = {
      ...createEmptyAppData(),
      projects: [
        { id: 'mine', name: 'My project', status: 'active', ownerId: 'me' },
        { id: 'theirs', name: 'Their project', status: 'active', ownerId: 'owner-x' },
      ],
    };
    render(<ProjectsView />);

    const mine = screen.getByText('My project').closest('.project-card') as HTMLElement;
    const theirs = screen.getByText('Their project').closest('.project-card') as HTMLElement;
    expect(within(mine).queryByText('Shared')).toBeNull();
    expect(within(theirs).getByText('Shared')).toBeTruthy();
  });

  it('does not show a Shared badge for a legacy Project with no ownerId at all', () => {
    mocks.authState = { isSupabaseConfigured: true, user: { id: 'me' } };
    mocks.appState.current = {
      ...createEmptyAppData(),
      projects: [{ id: 'legacy', name: 'Legacy project', status: 'active' }],
    };
    render(<ProjectsView />);
    expect(screen.queryByText('Shared')).toBeNull();
  });

  it('shows Manage sharing for a Project the signed-in account owns', () => {
    mocks.authState = { isSupabaseConfigured: true, user: { id: 'me' } };
    mocks.appState.current = {
      ...createEmptyAppData(),
      projects: [{ id: 'mine', name: 'My project', status: 'active', ownerId: 'me' }],
    };
    render(<ProjectsView />);
    expect(screen.getByRole('button', { name: 'Manage sharing' })).toBeTruthy();
  });

  it('hides Manage sharing, Mark completed, and Archive for a shared Project the signed-in account only edits', () => {
    mocks.authState = { isSupabaseConfigured: true, user: { id: 'editor-1' } };
    mocks.appState.current = {
      ...createEmptyAppData(),
      projects: [{ id: 'shared-1', name: 'Shared project', status: 'active', ownerId: 'owner-x' }],
    };
    render(<ProjectsView />);

    expect(screen.queryByRole('button', { name: 'Manage sharing' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark completed' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    // Ordinary editing and viewing remain available to an Editor.
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show tasks' })).toBeTruthy();
  });

  it('hides Mark active for an archived shared Project the signed-in account only edits', () => {
    mocks.authState = { isSupabaseConfigured: true, user: { id: 'editor-1' } };
    mocks.appState.current = {
      ...createEmptyAppData(),
      projects: [{ id: 'shared-1', name: 'Shared project', status: 'completed', ownerId: 'owner-x' }],
    };
    render(<ProjectsView />);
    expect(screen.queryByRole('button', { name: 'Mark active' })).toBeNull();
  });

  it('does not gate any controls when Supabase is not configured (local-only use)', () => {
    mocks.appState.current = {
      ...createEmptyAppData(),
      projects: [{ id: 'p1', name: 'Local project', status: 'active' }],
    };
    render(<ProjectsView />);
    expect(screen.getByRole('button', { name: 'Mark completed' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Manage sharing' })).toBeNull();
  });

  it("keeps every existing Task action available for a shared Project's Tasks (create/edit/complete/organize are all Task-level, unaffected by ownership)", () => {
    mocks.authState = { isSupabaseConfigured: true, user: { id: 'editor-1' } };
    mocks.appState.current = {
      ...createEmptyAppData(),
      projects: [{ id: 'shared-1', name: 'Shared project', status: 'active', ownerId: 'owner-x' }],
      tasks: [
        {
          id: 't1',
          title: 'Design the flyer',
          status: 'Inbox',
          priority: 'Normal',
          projectId: 'shared-1',
          ownerId: 'owner-x',
          createdAt: '2026-09-16T00:00:00.000Z',
          sortOrder: 0,
          isPrimary: false,
          archived: false,
          calendarOnly: false,
        },
      ],
    };
    render(<ProjectsView />);

    fireEvent.click(screen.getByRole('button', { name: 'Show tasks' }));

    expect(screen.getByText('Design the flyer')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Complete' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Edit' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Archive' })).toBeTruthy();
    expect(screen.getByLabelText('Move to')).toBeTruthy();
  });

  it('opens the Manage sharing dialog for the clicked Project, and closes it', () => {
    mocks.authState = { isSupabaseConfigured: true, user: { id: 'me' } };
    mocks.appState.current = {
      ...createEmptyAppData(),
      projects: [{ id: 'mine', name: 'My project', status: 'active', ownerId: 'me' }],
    };
    render(<ProjectsView />);

    fireEvent.click(screen.getByRole('button', { name: 'Manage sharing' }));
    expect(screen.getByTestId('manage-sharing-dialog-stub')).toBeTruthy();
    expect(screen.getByText('Managing My project')).toBeTruthy();

    fireEvent.click(within(screen.getByTestId('manage-sharing-dialog-stub')).getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('manage-sharing-dialog-stub')).toBeNull();
  });
});
