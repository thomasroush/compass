// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ArchivedProjectsPanel } from './ArchivedProjectsPanel';
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
  mocks.appState.current = createEmptyAppData();
});

afterEach(() => {
  cleanup();
});

describe('ArchivedProjectsPanel', () => {
  it('shows an empty state when there are no archived projects', () => {
    mocks.appState.current = {
      ...createEmptyAppData(),
      projects: [{ id: 'active-1', name: 'Website revamp', status: 'active' }],
    };
    render(<ArchivedProjectsPanel />);
    expect(screen.getByText('No archived projects.')).toBeTruthy();
    expect(screen.queryByText('Website revamp')).toBeNull();
  });

  it('lists archived projects, ignoring active/completed ones', () => {
    mocks.appState.current = {
      ...createEmptyAppData(),
      projects: [
        { id: 'active-1', name: 'Website revamp', status: 'active' },
        { id: 'archived-1', name: 'Old newsletter', status: 'archived', description: 'Retired' },
      ],
    };
    render(<ArchivedProjectsPanel />);
    expect(screen.getByText('Old newsletter')).toBeTruthy();
    expect(screen.getByText('Retired')).toBeTruthy();
    expect(screen.queryByText('Website revamp')).toBeNull();
  });

  it('restoring an archived project dispatches UPDATE_PROJECT with status active', () => {
    mocks.appState.current = {
      ...createEmptyAppData(),
      projects: [{ id: 'archived-1', name: 'Old newsletter', status: 'archived' }],
    };
    render(<ArchivedProjectsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

    expect(mocks.appState.dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_PROJECT',
      id: 'archived-1',
      status: 'active',
    });
  });
});
