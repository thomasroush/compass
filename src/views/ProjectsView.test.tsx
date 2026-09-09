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
    current: { version: 1, tasks: [], projects: [], dailyNotes: [], goals: [], targets: [] } as AppData,
    dispatch: vi.fn(),
  },
}));

vi.mock('../store/useApp', () => ({
  useApp: () => ({ state: mocks.appState.current, dispatch: mocks.appState.dispatch }),
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
