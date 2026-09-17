// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ArchivedProjectsPanel } from './ArchivedProjectsPanel';
import { createEmptyAppData, type AppData } from '../types';

const mocks = vi.hoisted(() => ({
  appState: {
    current: { version: 1, tasks: [], projects: [], quickNotes: [], goals: [], targets: [] } as AppData,
    dispatch: vi.fn(),
  },
  authState: { isSupabaseConfigured: false, user: null as { id: string } | null },
}));

vi.mock('../store/useApp', () => ({
  useApp: () => ({ state: mocks.appState.current, dispatch: mocks.appState.dispatch }),
}));
vi.mock('../store/useAuth', () => ({ useAuth: () => mocks.authState }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appState.current = createEmptyAppData();
  mocks.authState = { isSupabaseConfigured: false, user: null };
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

  it('hides Restore, and shows a Shared badge, for an archived Project owned by a different account', () => {
    mocks.authState = { isSupabaseConfigured: true, user: { id: 'editor-1' } };
    mocks.appState.current = {
      ...createEmptyAppData(),
      projects: [{ id: 'shared-1', name: 'Shared project', status: 'archived', ownerId: 'owner-x' }],
    };
    render(<ArchivedProjectsPanel />);

    expect(screen.getByText('Shared')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
  });

  it('still shows Restore for an archived Project the signed-in account owns', () => {
    mocks.authState = { isSupabaseConfigured: true, user: { id: 'owner-1' } };
    mocks.appState.current = {
      ...createEmptyAppData(),
      projects: [{ id: 'mine', name: 'My project', status: 'archived', ownerId: 'owner-1' }],
    };
    render(<ArchivedProjectsPanel />);
    expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy();
  });
});
