// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ProjectsView } from './ProjectsView';
import { createEmptyAppData, type AppData } from '../types';

const mocks = vi.hoisted(() => ({
  appState: {
    current: { version: 1, tasks: [], projects: [], dailyNotes: [] } as AppData,
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
