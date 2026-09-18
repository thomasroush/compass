// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TaskForm } from './TaskForm';
import { createEmptyAppData, type AppData } from '../types';
import { createTaskForTest } from '../store/reducer';

const mocks = vi.hoisted(() => ({
  appState: {
    current: { version: 1, tasks: [], projects: [], quickNotes: [], goals: [], targets: [] } as AppData,
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

describe('TaskForm — Calendar only', () => {
  it('cannot be submitted without a due date — shows an inline error and never dispatches', () => {
    const onClose = vi.fn();
    render(<TaskForm onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Dentist appointment' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'calendar-only' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));

    expect(screen.getByRole('alert').textContent).toBe('Calendar only requires a due date.');
    expect(mocks.appState.dispatch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('can be submitted once a due date is provided', () => {
    const onClose = vi.fn();
    render(<TaskForm onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Dentist appointment' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'calendar-only' } });
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-09-20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(mocks.appState.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ADD_TASK',
        title: 'Dentist appointment',
        status: 'Inbox',
        calendarOnly: true,
        dueDate: '2026-09-20',
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('shows Calendar only selected when editing an existing calendar-only task', () => {
    const task = createTaskForTest({
      id: 't1',
      title: 'Dentist appointment',
      dueDate: '2026-09-20',
      calendarOnly: true,
    });

    render(<TaskForm task={task} onClose={vi.fn()} />);

    expect((screen.getByLabelText('Status') as HTMLSelectElement).value).toBe('calendar-only');
  });

  it('selecting a normal workflow status moves the task out of Calendar only', () => {
    const task = createTaskForTest({
      id: 't1',
      title: 'Dentist appointment',
      dueDate: '2026-09-20',
      calendarOnly: true,
    });
    const onClose = vi.fn();

    render(<TaskForm task={task} onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'This Week' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(mocks.appState.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UPDATE_TASK',
        id: 't1',
        updates: expect.objectContaining({
          status: 'This Week',
          calendarOnly: false,
        }),
      }),
    );
  });
});
