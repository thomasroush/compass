// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ProjectsView } from './ProjectsView';
import { createEmptyAppData, type AppData } from '../types';

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
