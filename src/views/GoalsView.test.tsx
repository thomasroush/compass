// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createEmptyAppData, type AppData, type Goal, type Target } from '../types';

const mocks = vi.hoisted(() => ({
  appState: {
    // A raw literal, not createEmptyAppData() — vi.hoisted()'s callback runs
    // before regular (non-hoisted) imports evaluate, so calling an imported
    // function here hits a TDZ ("Cannot access '__vi_import_N__' before
    // initialization"). Mirrors ProjectsView.test.tsx's exact fixture shape.
    current: { version: 1, tasks: [], projects: [], dailyNotes: [], goals: [], targets: [] } as AppData,
    dispatch: vi.fn(),
  },
}));

vi.mock('../store/useApp', () => ({
  useApp: () => ({ state: mocks.appState.current, dispatch: mocks.appState.dispatch }),
}));

// Imported after vi.mock (not merely reordered for style): GoalsView pulls in
// react-router-dom, and importing it before the mock/hoisted setup above
// triggers a Vitest hoisting TDZ ("Cannot access '__vi_import_N__' before
// initialization") when a mocked module's dependency graph includes
// react-router-dom. Import order here is load-bearing.
import { GoalsView } from './GoalsView';

function renderView() {
  return render(
    <MemoryRouter>
      <GoalsView />
    </MemoryRouter>,
  );
}

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

function yesNoTarget(overrides: Partial<Extract<Target, { type: 'yesno' }>> = {}): Target {
  return {
    id: 't1',
    goalId: 'g1',
    name: 'Milestone',
    sortOrder: 0,
    archived: false,
    type: 'yesno',
    achieved: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appState.current = createEmptyAppData();
});

afterEach(() => {
  cleanup();
});

describe('GoalsView — visibility', () => {
  it('shows active, achieved, and paused goals by default, hiding abandoned', () => {
    mocks.appState.current = {
      ...createEmptyAppData(),
      goals: [
        goalFixture({ id: 'a', name: 'Active goal', status: 'active' }),
        goalFixture({ id: 'b', name: 'Achieved goal', status: 'achieved' }),
        goalFixture({ id: 'c', name: 'Paused goal', status: 'paused' }),
        goalFixture({ id: 'd', name: 'Abandoned goal', status: 'abandoned' }),
      ],
    };
    renderView();
    expect(screen.getByText('Active goal')).toBeTruthy();
    expect(screen.getByText('Achieved goal')).toBeTruthy();
    expect(screen.getByText('Paused goal')).toBeTruthy();
    expect(screen.queryByText('Abandoned goal')).toBeNull();
  });

  it('reveals abandoned goals via the "Show abandoned goals" control', () => {
    mocks.appState.current = {
      ...createEmptyAppData(),
      goals: [goalFixture({ id: 'd', name: 'Abandoned goal', status: 'abandoned' })],
    };
    renderView();
    expect(screen.queryByText('Abandoned goal')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: /Show abandoned goals/ }));
    expect(screen.getByText('Abandoned goal')).toBeTruthy();
  });

  it('shows the empty state when there are no visible goals', () => {
    renderView();
    expect(screen.getByText('No goals yet.')).toBeTruthy();
  });
});

describe('GoalsView — card content', () => {
  it('shows name, status, priority, due date, progress, target count, and linked project names', () => {
    mocks.appState.current = {
      ...createEmptyAppData(),
      projects: [{ id: 'p1', name: 'Website revamp', status: 'active' }],
      goals: [
        goalFixture({
          id: 'g1',
          name: 'Ship it',
          status: 'active',
          priority: 'High',
          dueDate: '2026-12-31',
          projectIds: ['p1'],
        }),
      ],
      targets: [
        yesNoTarget({ id: 't1', achieved: true }),
        yesNoTarget({ id: 't2', achieved: false }),
      ],
    };
    renderView();
    expect(screen.getByRole('link', { name: 'Ship it' })).toBeTruthy();
    expect(screen.getByText('active')).toBeTruthy();
    expect(screen.getByText('High')).toBeTruthy();
    expect(screen.getByText('Due 2026-12-31')).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByText('1 of 2 targets complete')).toBeTruthy();
    expect(screen.getByText('Website revamp')).toBeTruthy();
  });

  it('shows "No targets yet" instead of a percentage when a goal has no active targets', () => {
    mocks.appState.current = { ...createEmptyAppData(), goals: [goalFixture()] };
    renderView();
    expect(screen.getByText('No targets yet')).toBeTruthy();
    expect(screen.getByText('0 of 0 targets complete')).toBeTruthy();
  });

  it('links the goal name to its detail page', () => {
    mocks.appState.current = { ...createEmptyAppData(), goals: [goalFixture({ id: 'g1', name: 'Ship it' })] };
    renderView();
    expect(screen.getByRole('link', { name: 'Ship it' }).getAttribute('href')).toBe('/goals/g1');
  });
});

describe('GoalsView — creating a goal', () => {
  it('opens the New Goal dialog and dispatches ADD_GOAL with the entered name', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'New goal' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Reach $500k ARR' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add goal' }));

    expect(mocks.appState.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ADD_GOAL', name: 'Reach $500k ARR' }),
    );
  });

  it('linking multiple projects at creation dispatches LINK_GOAL_PROJECT for each selected project', () => {
    mocks.appState.current = {
      ...createEmptyAppData(),
      projects: [
        { id: 'p1', name: 'Alpha', status: 'active' },
        { id: 'p2', name: 'Beta', status: 'active' },
      ],
    };
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'New goal' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Multi-project goal' } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Alpha' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Beta' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add goal' }));

    const addGoalCall = mocks.appState.dispatch.mock.calls.find(
      (c: unknown[]) => (c[0] as { type: string }).type === 'ADD_GOAL',
    );
    expect(addGoalCall).toBeDefined();
    const newGoalId = (addGoalCall![0] as { id: string }).id;
    expect(mocks.appState.dispatch).toHaveBeenCalledWith({
      type: 'LINK_GOAL_PROJECT',
      goalId: newGoalId,
      projectId: 'p1',
    });
    expect(mocks.appState.dispatch).toHaveBeenCalledWith({
      type: 'LINK_GOAL_PROJECT',
      goalId: newGoalId,
      projectId: 'p2',
    });
  });

  it('does not show a Status field when creating a new goal', () => {
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'New goal' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByLabelText('Status')).toBeNull();
  });
});
