// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TasksView } from './TasksView';
import { createEmptyAppData, type AppData, type Task } from '../types';
import { createTaskForTest } from '../store/reducer';

const mocks = vi.hoisted(() => ({
  appState: {
    current: { version: 1, tasks: [], projects: [], dailyNotes: [] } as AppData,
    dispatch: vi.fn(),
  },
}));

vi.mock('../store/useApp', () => ({
  useApp: () => ({ state: mocks.appState.current, dispatch: mocks.appState.dispatch }),
}));

function setTasks(tasks: Task[]) {
  mocks.appState.current = { ...createEmptyAppData(), tasks };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appState.current = createEmptyAppData();
});

afterEach(() => {
  cleanup();
});

describe('TasksView — triage inbox', () => {
  it('shows only untriaged tasks: no project, Normal priority, Inbox status', () => {
    setTasks([
      createTaskForTest({ id: 'untriaged', title: 'Untriaged task', createdAt: '2026-01-01T00:00:00.000Z' }),
      createTaskForTest({ id: 'has-project', title: 'Has project', projectId: 'p1', createdAt: '2026-01-02T00:00:00.000Z' }),
      createTaskForTest({ id: 'low-priority', title: 'Low priority', priority: 'Low', createdAt: '2026-01-03T00:00:00.000Z' }),
      createTaskForTest({ id: 'high-priority', title: 'High priority', priority: 'High', createdAt: '2026-01-04T00:00:00.000Z' }),
      createTaskForTest({ id: 'in-progress', title: 'In progress', status: 'In Progress', createdAt: '2026-01-05T00:00:00.000Z' }),
    ]);

    render(<TasksView />);

    expect(screen.getByText('Untriaged task')).toBeTruthy();
    expect(screen.queryByText('Has project')).toBeNull();
    expect(screen.queryByText('Low priority')).toBeNull();
    expect(screen.queryByText('High priority')).toBeNull();
    expect(screen.queryByText('In progress')).toBeNull();
  });

  it('sorts untriaged tasks by creation date, newest first', () => {
    setTasks([
      createTaskForTest({ id: 'oldest', title: 'Oldest', createdAt: '2026-01-01T00:00:00.000Z' }),
      createTaskForTest({ id: 'newest', title: 'Newest', createdAt: '2026-01-03T00:00:00.000Z' }),
      createTaskForTest({ id: 'middle', title: 'Middle', createdAt: '2026-01-02T00:00:00.000Z' }),
    ]);

    render(<TasksView />);

    const titles = screen.getAllByRole('heading', { level: 3 }).map((el) => el.textContent);
    expect(titles).toEqual(['Newest', 'Middle', 'Oldest']);
  });

  it('excludes archived tasks even when otherwise untriaged', () => {
    setTasks([
      createTaskForTest({ id: 'archived', title: 'Archived task', archived: true }),
    ]);

    render(<TasksView />);

    expect(screen.queryByText('Archived task')).toBeNull();
    expect(screen.getByText('Inbox is clear — no untriaged tasks.')).toBeTruthy();
  });
});
