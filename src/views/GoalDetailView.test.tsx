// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AppData, Goal, Target } from '../types';

const mocks = vi.hoisted(() => ({
  appState: {
    // Raw literal, not createEmptyAppData() — see GoalsView.test.tsx's note
    // on why calling an imported function inside vi.hoisted() is unsafe.
    current: { version: 1, tasks: [], projects: [], dailyNotes: [], goals: [], targets: [] } as AppData,
    dispatch: vi.fn(),
  },
}));

vi.mock('../store/useApp', () => ({
  useApp: () => ({ state: mocks.appState.current, dispatch: mocks.appState.dispatch }),
}));

// Imported after vi.mock/vi.hoisted — see GoalsView.test.tsx.
import { GoalDetailView } from './GoalDetailView';

function goalFixture(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'g1',
    name: 'Ship it',
    priority: 'Normal',
    status: 'active',
    projectIds: [],
    ...overrides,
  };
}

function numericTarget(overrides: Partial<Extract<Target, { type: 'numeric' }>> = {}): Target {
  return {
    id: 't1',
    goalId: 'g1',
    name: 'Revenue',
    sortOrder: 0,
    archived: false,
    type: 'numeric',
    startValue: 0,
    currentValue: 10,
    targetValue: 100,
    valueFormat: 'number',
    ...overrides,
  };
}

function yesNoTarget(overrides: Partial<Extract<Target, { type: 'yesno' }>> = {}): Target {
  return {
    id: 't2',
    goalId: 'g1',
    name: 'Milestone',
    sortOrder: 1,
    archived: false,
    type: 'yesno',
    achieved: false,
    ...overrides,
  };
}

function linkedTasksTarget(overrides: Partial<Extract<Target, { type: 'linked-tasks' }>> = {}): Target {
  return {
    id: 't3',
    goalId: 'g1',
    name: 'Contract work',
    sortOrder: 2,
    archived: false,
    type: 'linked-tasks',
    taskIds: [],
    ...overrides,
  };
}

function renderView(goalId = 'g1') {
  return render(
    <MemoryRouter initialEntries={[`/goals/${goalId}`]}>
      <Routes>
        <Route path="/goals/:id" element={<GoalDetailView />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appState.current = { version: 1, tasks: [], projects: [], dailyNotes: [], goals: [], targets: [] };
});

afterEach(() => {
  cleanup();
});

describe('GoalDetailView — rendering', () => {
  it('shows the goal not found message for an unknown id', () => {
    renderView('missing');
    expect(screen.getByText('This goal could not be found.')).toBeTruthy();
  });

  it('shows name, description, status, priority, due date, and linked projects', () => {
    mocks.appState.current = {
      ...mocks.appState.current,
      projects: [{ id: 'p1', name: 'Website revamp', status: 'active' }],
      goals: [
        goalFixture({
          description: 'Grow the business',
          status: 'paused',
          priority: 'High',
          dueDate: '2026-12-31',
          projectIds: ['p1'],
        }),
      ],
    };
    renderView();
    expect(screen.getByRole('heading', { name: 'Ship it' })).toBeTruthy();
    expect(screen.getByText('Grow the business')).toBeTruthy();
    expect(screen.getByText('paused')).toBeTruthy();
    expect(screen.getByText('High')).toBeTruthy();
    expect(screen.getByText('Due 2026-12-31')).toBeTruthy();
    expect(screen.getByText('Website revamp')).toBeTruthy();
  });

  it('renders Targets in their saved sortOrder', () => {
    mocks.appState.current = {
      ...mocks.appState.current,
      goals: [goalFixture()],
      targets: [
        yesNoTarget({ id: 't2', name: 'Second', sortOrder: 1 }),
        numericTarget({ id: 't1', name: 'First', sortOrder: 0 }),
      ],
    };
    renderView();
    const headings = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent);
    expect(headings).toEqual(['First', 'Second']);
  });

  it('shows overall progress as the average of its targets', () => {
    mocks.appState.current = {
      ...mocks.appState.current,
      goals: [goalFixture()],
      targets: [
        numericTarget({ startValue: 0, currentValue: 100, targetValue: 100 }), // 100%
        yesNoTarget({ achieved: false }), // 0%
      ],
    };
    renderView();
    expect(screen.getByText('50%')).toBeTruthy();
  });
});

describe('GoalDetailView — editing the goal and linking projects', () => {
  it('opens the edit dialog pre-filled and dispatches UPDATE_GOAL on save', () => {
    mocks.appState.current = { ...mocks.appState.current, goals: [goalFixture()] };
    renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Edit goal' }));
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('Ship it');

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Ship it faster' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(mocks.appState.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UPDATE_GOAL', id: 'g1', name: 'Ship it faster', status: 'active' }),
    );
  });

  it('linking an additional project from the edit dialog dispatches LINK_GOAL_PROJECT for only the newly checked project', () => {
    mocks.appState.current = {
      ...mocks.appState.current,
      projects: [
        { id: 'p1', name: 'Already linked', status: 'active' },
        { id: 'p2', name: 'Newly linked', status: 'active' },
      ],
      goals: [goalFixture({ projectIds: ['p1'] })],
    };
    renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Edit goal' }));
    const dialog = screen.getByRole('dialog');
    const alreadyLinked = within(dialog).getByRole('checkbox', { name: 'Already linked' }) as HTMLInputElement;
    expect(alreadyLinked.checked).toBe(true);

    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Newly linked' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(mocks.appState.dispatch).toHaveBeenCalledWith({
      type: 'LINK_GOAL_PROJECT',
      goalId: 'g1',
      projectId: 'p2',
    });
    expect(mocks.appState.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UNLINK_GOAL_PROJECT' }),
    );
  });

  it('unchecking a linked project dispatches UNLINK_GOAL_PROJECT', () => {
    mocks.appState.current = {
      ...mocks.appState.current,
      projects: [{ id: 'p1', name: 'Linked project', status: 'active' }],
      goals: [goalFixture({ projectIds: ['p1'] })],
    };
    renderView();

    fireEvent.click(screen.getByRole('button', { name: 'Edit goal' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Linked project' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(mocks.appState.dispatch).toHaveBeenCalledWith({
      type: 'UNLINK_GOAL_PROJECT',
      goalId: 'g1',
      projectId: 'p1',
    });
  });
});

describe('GoalDetailView — creating each Target type', () => {
  beforeEach(() => {
    mocks.appState.current = { ...mocks.appState.current, goals: [goalFixture()] };
  });

  it('creates a numeric target with start/current/target values and format', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Add target' }));
    const dialog = screen.getByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Revenue booked' } });
    fireEvent.change(within(dialog).getByLabelText('Starting value'), { target: { value: '0' } });
    fireEvent.change(within(dialog).getByLabelText('Current value'), { target: { value: '250000' } });
    fireEvent.change(within(dialog).getByLabelText('Target value'), { target: { value: '500000' } });
    fireEvent.change(within(dialog).getByLabelText('Display'), { target: { value: 'currency' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add target' }));

    expect(mocks.appState.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ADD_TARGET',
        goalId: 'g1',
        targetType: 'numeric',
        name: 'Revenue booked',
        startValue: 0,
        currentValue: 250000,
        targetValue: 500000,
        valueFormat: 'currency',
      }),
    );
  });

  it('creates a yes/no target', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Add target' }));
    const dialog = screen.getByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Case study published' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Yes/No' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add target' }));

    expect(mocks.appState.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ADD_TARGET',
        goalId: 'g1',
        targetType: 'yesno',
        name: 'Case study published',
        achieved: false,
      }),
    );
  });

  it('creates a linked-tasks target with the selected tasks', () => {
    mocks.appState.current = {
      ...mocks.appState.current,
      tasks: [
        { id: 'task-1', title: 'Draft contract', status: 'Inbox', priority: 'Normal', createdAt: 'x', sortOrder: 0, isPrimary: false, archived: false },
        { id: 'task-2', title: 'Sign contract', status: 'Inbox', priority: 'Normal', createdAt: 'x', sortOrder: 1, isPrimary: false, archived: false },
      ],
    };
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Add target' }));
    const dialog = screen.getByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Contract tasks' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Linked tasks' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Draft contract' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add target' }));

    expect(mocks.appState.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ADD_TARGET',
        goalId: 'g1',
        targetType: 'linked-tasks',
        name: 'Contract tasks',
        taskIds: ['task-1'],
      }),
    );
  });
});

describe('GoalDetailView — automatic progress display', () => {
  it('shows completed/total for a linked-tasks target, derived from current task statuses', () => {
    mocks.appState.current = {
      ...mocks.appState.current,
      goals: [goalFixture()],
      targets: [linkedTasksTarget({ taskIds: ['a', 'b'] })],
      tasks: [
        { id: 'a', title: 'Done task', status: 'Done', priority: 'Normal', createdAt: 'x', sortOrder: 0, isPrimary: false, archived: false },
        { id: 'b', title: 'Open task', status: 'Inbox', priority: 'Normal', createdAt: 'x', sortOrder: 1, isPrimary: false, archived: false },
      ],
    };
    renderView();
    expect(screen.getByText('1 of 2 linked tasks complete')).toBeTruthy();
  });

  it('has no quick-update control for a linked-tasks target (read-only progress)', () => {
    mocks.appState.current = {
      ...mocks.appState.current,
      goals: [goalFixture()],
      targets: [linkedTasksTarget()],
    };
    renderView();
    expect(screen.queryByLabelText('Current value')).toBeNull();
    expect(screen.queryByLabelText('Achieved')).toBeNull();
  });
});

describe('GoalDetailView — quick updates', () => {
  it('updating a numeric target\'s current value dispatches UPDATE_TARGET', () => {
    mocks.appState.current = {
      ...mocks.appState.current,
      goals: [goalFixture()],
      targets: [numericTarget()],
    };
    renderView();
    fireEvent.change(screen.getByLabelText('Current value'), { target: { value: '42' } });
    expect(mocks.appState.dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_TARGET',
      id: 't1',
      updates: { currentValue: 42 },
    });
  });

  it('toggling a yes/no target\'s achieved checkbox dispatches UPDATE_TARGET', () => {
    mocks.appState.current = {
      ...mocks.appState.current,
      goals: [goalFixture()],
      targets: [yesNoTarget({ achieved: false })],
    };
    renderView();
    fireEvent.click(screen.getByLabelText('Achieved'));
    expect(mocks.appState.dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_TARGET',
      id: 't2',
      updates: { achieved: true },
    });
  });
});

describe('GoalDetailView — reorder, archive, and restore', () => {
  it('clicking Down on the first target dispatches REORDER_TARGET', () => {
    mocks.appState.current = {
      ...mocks.appState.current,
      goals: [goalFixture()],
      targets: [numericTarget({ id: 't1', sortOrder: 0 }), yesNoTarget({ id: 't2', sortOrder: 1 })],
    };
    renderView();
    const downButtons = screen.getAllByRole('button', { name: 'Move down' });
    fireEvent.click(downButtons[0]);
    expect(mocks.appState.dispatch).toHaveBeenCalledWith({ type: 'REORDER_TARGET', id: 't1', direction: 'down' });
  });

  it('archiving a target dispatches ARCHIVE_TARGET and removes it from the active list', () => {
    mocks.appState.current = {
      ...mocks.appState.current,
      goals: [goalFixture()],
      targets: [numericTarget({ name: 'Revenue' })],
    };
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(mocks.appState.dispatch).toHaveBeenCalledWith({ type: 'ARCHIVE_TARGET', id: 't1' });
  });

  it('an archived target is hidden by default, shown via "Show archived targets", and restorable', () => {
    mocks.appState.current = {
      ...mocks.appState.current,
      goals: [goalFixture()],
      targets: [numericTarget({ name: 'Archived revenue target', archived: true })],
    };
    renderView();
    expect(screen.queryByText('Archived revenue target')).toBeNull();
    expect(screen.getByText('Show archived targets (1)')).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: /Show archived targets/ }));
    expect(screen.getByText('Archived revenue target')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(mocks.appState.dispatch).toHaveBeenCalledWith({ type: 'RESTORE_TARGET', id: 't1' });
  });

  it('an archived target is excluded from the goal\'s progress and from "No targets yet"', () => {
    mocks.appState.current = {
      ...mocks.appState.current,
      goals: [goalFixture()],
      targets: [numericTarget({ archived: true, currentValue: 100, targetValue: 100 })],
    };
    renderView();
    expect(screen.getByText('No targets yet')).toBeTruthy();
    expect(screen.getByText('No targets yet.')).toBeTruthy();
  });
});
