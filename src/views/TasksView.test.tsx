// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { TasksView } from './TasksView';
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

describe('TasksView — project filter excludes archived projects', () => {
  it('only lists non-archived projects as filter options', () => {
    render(<TasksView />);
    const select = screen.getByLabelText('Project');
    expect(within(select).getByText('Website revamp')).toBeTruthy();
    expect(within(select).queryByText('Old newsletter')).toBeNull();
  });
});
