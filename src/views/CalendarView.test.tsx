// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CalendarView } from './CalendarView';
import { createEmptyAppData, type AppData } from '../types';
import { createTaskForTest as makeTask } from '../store/reducer';

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

describe('CalendarView', () => {
  it('shows only tasks with a due date, grouped under MM/DD/YYYY headings', () => {
    mocks.appState.current = {
      ...createEmptyAppData(),
      tasks: [
        makeTask({ id: 'dated', title: 'Dated task', dueDate: '2026-09-05' }),
        makeTask({ id: 'undated', title: 'Undated task' }),
      ],
    };
    render(<CalendarView />);
    expect(screen.getByText('09/05/2026')).toBeTruthy();
    expect(screen.getByText('Dated task')).toBeTruthy();
    expect(screen.queryByText('Undated task')).toBeNull();
  });

  it('lists dates in chronological order', () => {
    mocks.appState.current = {
      ...createEmptyAppData(),
      tasks: [
        makeTask({ id: 'later', title: 'Later task', dueDate: '2026-09-10' }),
        makeTask({ id: 'earlier', title: 'Earlier task', dueDate: '2026-09-01' }),
      ],
    };
    render(<CalendarView />);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings.indexOf('09/01/2026')).toBeLessThan(headings.indexOf('09/10/2026'));
  });

  it('visually marks a past due date as overdue', () => {
    mocks.appState.current = {
      ...createEmptyAppData(),
      tasks: [makeTask({ id: 'past', title: 'Past task', dueDate: '2000-01-01' })],
    };
    render(<CalendarView />);
    expect(screen.getByText('Overdue')).toBeTruthy();
  });

  it('excludes archived dated tasks', () => {
    mocks.appState.current = {
      ...createEmptyAppData(),
      tasks: [
        makeTask({ id: 'archived', title: 'Archived task', dueDate: '2026-09-05', archived: true }),
      ],
    };
    render(<CalendarView />);
    expect(screen.queryByText('Archived task')).toBeNull();
    expect(screen.getByText('No dated tasks yet.')).toBeTruthy();
  });
});
