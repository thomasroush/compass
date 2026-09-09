import { describe, expect, it } from 'vitest';
import {
  appReducer,
  getArchivedGoalTargets,
  getGoalProgress,
  getGoalTargets,
  getProjectGoals,
  getTargetProgress,
  getVisibleGoals,
  nextTargetSortOrder,
} from './reducer';
import { createEmptyAppData, type AppData, type Goal, type Target, type Task } from '../types';

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'g1',
    name: 'Reach $500k ARR',
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
    name: 'Revenue booked',
    sortOrder: 0,
    archived: false,
    type: 'numeric',
    startValue: 0,
    currentValue: 0,
    targetValue: 100,
    valueFormat: 'number',
    ...overrides,
  };
}

function yesNoTarget(overrides: Partial<Extract<Target, { type: 'yesno' }>> = {}): Target {
  return {
    id: 't2',
    goalId: 'g1',
    name: 'Case study published',
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
    name: 'Key contract tasks',
    sortOrder: 2,
    archived: false,
    type: 'linked-tasks',
    taskIds: [],
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Do the thing',
    status: 'Inbox',
    priority: 'Normal',
    createdAt: '2026-01-01T00:00:00.000Z',
    sortOrder: 0,
    isPrimary: false,
    archived: false,
    ...overrides,
  };
}

function stateWith(overrides: Partial<AppData> = {}): AppData {
  return { ...createEmptyAppData(), ...overrides };
}

describe('ADD_GOAL', () => {
  it('creates a goal with defaults when only a name is given', () => {
    const state = appReducer(createEmptyAppData(), { type: 'ADD_GOAL', name: 'Ship it' });
    expect(state.goals).toEqual([
      { id: expect.any(String), name: 'Ship it', priority: 'Normal', status: 'active', projectIds: [] },
    ]);
  });

  it('is a no-op for a blank/whitespace-only name', () => {
    const state = appReducer(createEmptyAppData(), { type: 'ADD_GOAL', name: '   ' });
    expect(state.goals).toEqual([]);
  });

  it('creates a goal with description, dueDate, and priority when given', () => {
    const state = appReducer(createEmptyAppData(), {
      type: 'ADD_GOAL',
      id: 'g1',
      name: 'Ship it',
      description: 'Launch the thing',
      dueDate: '2026-12-31',
      priority: 'High',
    });
    expect(state.goals?.[0]).toEqual({
      id: 'g1',
      name: 'Ship it',
      description: 'Launch the thing',
      dueDate: '2026-12-31',
      priority: 'High',
      status: 'active',
      projectIds: [],
    });
  });

  it('appends to any existing goals rather than replacing them', () => {
    const state = stateWith({ goals: [goal({ id: 'g0', name: 'Existing' })] });
    const next = appReducer(state, { type: 'ADD_GOAL', id: 'g1', name: 'New' });
    expect(next.goals?.map((g) => g.id)).toEqual(['g0', 'g1']);
  });
});

describe('UPDATE_GOAL', () => {
  it('updates name, description, priority, and status independently', () => {
    const state = stateWith({ goals: [goal()] });
    const next = appReducer(state, {
      type: 'UPDATE_GOAL',
      id: 'g1',
      name: 'Renamed',
      priority: 'High',
      status: 'paused',
    });
    expect(next.goals?.[0]).toMatchObject({ name: 'Renamed', priority: 'High', status: 'paused' });
  });

  it('leaves fields unchanged when omitted entirely', () => {
    const state = stateWith({ goals: [goal({ description: 'Keep me' })] });
    const next = appReducer(state, { type: 'UPDATE_GOAL', id: 'g1', status: 'achieved' });
    expect(next.goals?.[0].description).toBe('Keep me');
  });

  it('clears dueDate when given null, but leaves it when omitted', () => {
    const state = stateWith({ goals: [goal({ dueDate: '2026-12-31' })] });
    const cleared = appReducer(state, { type: 'UPDATE_GOAL', id: 'g1', dueDate: null });
    expect(cleared.goals?.[0].dueDate).toBeUndefined();

    const unchanged = appReducer(state, { type: 'UPDATE_GOAL', id: 'g1', name: 'X' });
    expect(unchanged.goals?.[0].dueDate).toBe('2026-12-31');
  });
});

describe('LINK_GOAL_PROJECT / UNLINK_GOAL_PROJECT', () => {
  it('links a project, and does not add a duplicate on a second link', () => {
    const state = stateWith({ goals: [goal()] });
    const linked = appReducer(state, { type: 'LINK_GOAL_PROJECT', goalId: 'g1', projectId: 'p1' });
    expect(linked.goals?.[0].projectIds).toEqual(['p1']);

    const linkedAgain = appReducer(linked, { type: 'LINK_GOAL_PROJECT', goalId: 'g1', projectId: 'p1' });
    expect(linkedAgain.goals?.[0].projectIds).toEqual(['p1']);
  });

  it('unlinks a project', () => {
    const state = stateWith({ goals: [goal({ projectIds: ['p1', 'p2'] })] });
    const next = appReducer(state, { type: 'UNLINK_GOAL_PROJECT', goalId: 'g1', projectId: 'p1' });
    expect(next.goals?.[0].projectIds).toEqual(['p2']);
  });
});

describe('getVisibleGoals / getProjectGoals', () => {
  it('hides abandoned goals only', () => {
    const goals = [
      goal({ id: 'a', status: 'active' }),
      goal({ id: 'b', status: 'achieved' }),
      goal({ id: 'c', status: 'paused' }),
      goal({ id: 'd', status: 'abandoned' }),
    ];
    expect(getVisibleGoals(goals).map((g) => g.id)).toEqual(['a', 'b', 'c']);
  });

  it('finds goals linked to a given project', () => {
    const goals = [
      goal({ id: 'a', projectIds: ['p1'] }),
      goal({ id: 'b', projectIds: ['p2'] }),
      goal({ id: 'c', projectIds: ['p1', 'p2'] }),
    ];
    expect(getProjectGoals(goals, 'p1').map((g) => g.id)).toEqual(['a', 'c']);
  });
});

describe('ADD_TARGET', () => {
  it('creates a numeric target with the given fields', () => {
    const state = stateWith({ goals: [goal()] });
    const next = appReducer(state, {
      type: 'ADD_TARGET',
      id: 't1',
      goalId: 'g1',
      targetType: 'numeric',
      name: 'Revenue',
      startValue: 0,
      currentValue: 10,
      targetValue: 100,
      unit: '$',
      valueFormat: 'currency',
    });
    expect(next.targets?.[0]).toEqual({
      id: 't1',
      goalId: 'g1',
      name: 'Revenue',
      sortOrder: 0,
      archived: false,
      type: 'numeric',
      startValue: 0,
      currentValue: 10,
      targetValue: 100,
      unit: '$',
      valueFormat: 'currency',
    });
  });

  it('creates a yes/no target defaulting achieved to false', () => {
    const state = stateWith({ goals: [goal()] });
    const next = appReducer(state, {
      type: 'ADD_TARGET',
      id: 't1',
      goalId: 'g1',
      targetType: 'yesno',
      name: 'Milestone',
    });
    expect(next.targets?.[0]).toMatchObject({ type: 'yesno', achieved: false });
  });

  it('creates a linked-tasks target defaulting taskIds to an empty array', () => {
    const state = stateWith({ goals: [goal()] });
    const next = appReducer(state, {
      type: 'ADD_TARGET',
      id: 't1',
      goalId: 'g1',
      targetType: 'linked-tasks',
      name: 'Contract work',
    });
    expect(next.targets?.[0]).toMatchObject({ type: 'linked-tasks', taskIds: [] });
  });

  it('is a no-op for a blank name', () => {
    const state = stateWith({ goals: [goal()] });
    const next = appReducer(state, {
      type: 'ADD_TARGET',
      goalId: 'g1',
      targetType: 'yesno',
      name: '  ',
    });
    expect(next.targets).toEqual([]);
  });

  it('assigns increasing sortOrder within a goal, independent of other goals', () => {
    const state = stateWith({
      goals: [goal(), goal({ id: 'g2' })],
      targets: [numericTarget({ id: 't1', goalId: 'g1', sortOrder: 0 })],
    });
    const next = appReducer(state, {
      type: 'ADD_TARGET',
      id: 't2',
      goalId: 'g1',
      targetType: 'yesno',
      name: 'Second target',
    });
    expect(next.targets?.find((t) => t.id === 't2')?.sortOrder).toBe(1);

    const forOtherGoal = appReducer(state, {
      type: 'ADD_TARGET',
      id: 't3',
      goalId: 'g2',
      targetType: 'yesno',
      name: 'Other goal target',
    });
    expect(forOtherGoal.targets?.find((t) => t.id === 't3')?.sortOrder).toBe(0);
  });
});

describe('UPDATE_TARGET', () => {
  it('updates numeric fields without touching type', () => {
    const state = stateWith({ targets: [numericTarget()] });
    const next = appReducer(state, {
      type: 'UPDATE_TARGET',
      id: 't1',
      updates: { currentValue: 42 },
    });
    expect(next.targets?.[0]).toMatchObject({ type: 'numeric', currentValue: 42, startValue: 0, targetValue: 100 });
  });

  it('updates achieved on a yes/no target', () => {
    const state = stateWith({ targets: [yesNoTarget()] });
    const next = appReducer(state, { type: 'UPDATE_TARGET', id: 't2', updates: { achieved: true } });
    expect(next.targets?.[0]).toMatchObject({ type: 'yesno', achieved: true });
  });

  it('updates taskIds on a linked-tasks target', () => {
    const state = stateWith({ targets: [linkedTasksTarget()] });
    const next = appReducer(state, {
      type: 'UPDATE_TARGET',
      id: 't3',
      updates: { taskIds: ['task-1', 'task-2'] },
    });
    expect(next.targets?.[0]).toMatchObject({ type: 'linked-tasks', taskIds: ['task-1', 'task-2'] });
  });

  it('ignores fields that do not apply to the target type', () => {
    const state = stateWith({ targets: [yesNoTarget()] });
    const next = appReducer(state, {
      type: 'UPDATE_TARGET',
      id: 't2',
      updates: { currentValue: 999, taskIds: ['x'] },
    });
    expect(next.targets?.[0]).toEqual(yesNoTarget());
  });
});

describe('ARCHIVE_TARGET / RESTORE_TARGET', () => {
  it('archives and restores a target without deleting it', () => {
    const state = stateWith({ targets: [numericTarget()] });
    const archived = appReducer(state, { type: 'ARCHIVE_TARGET', id: 't1' });
    expect(archived.targets?.[0].archived).toBe(true);
    expect(archived.targets).toHaveLength(1);

    const restored = appReducer(archived, { type: 'RESTORE_TARGET', id: 't1' });
    expect(restored.targets?.[0].archived).toBe(false);
  });
});

describe('REORDER_TARGET', () => {
  it('swaps sortOrder with the adjacent non-archived sibling within the same goal', () => {
    const state = stateWith({
      targets: [
        numericTarget({ id: 't1', sortOrder: 0 }),
        yesNoTarget({ id: 't2', sortOrder: 1 }),
        linkedTasksTarget({ id: 't3', sortOrder: 2 }),
      ],
    });
    const next = appReducer(state, { type: 'REORDER_TARGET', id: 't2', direction: 'up' });
    const byId = Object.fromEntries((next.targets ?? []).map((t) => [t.id, t.sortOrder]));
    expect(byId).toEqual({ t1: 1, t2: 0, t3: 2 });
  });

  it('does nothing at the top/bottom boundary', () => {
    const state = stateWith({ targets: [numericTarget({ id: 't1', sortOrder: 0 })] });
    const next = appReducer(state, { type: 'REORDER_TARGET', id: 't1', direction: 'up' });
    expect(next).toEqual(state);
  });

  it('skips archived targets entirely — cannot reorder one, and it is not a swap candidate', () => {
    const state = stateWith({
      targets: [
        numericTarget({ id: 't1', sortOrder: 0, archived: true }),
        yesNoTarget({ id: 't2', sortOrder: 1 }),
      ],
    });
    const next = appReducer(state, { type: 'REORDER_TARGET', id: 't2', direction: 'up' });
    expect(next).toEqual(state);
  });
});

describe('getGoalTargets / getArchivedGoalTargets / nextTargetSortOrder', () => {
  it('returns only non-archived targets for a goal, sorted by sortOrder', () => {
    const targets = [
      numericTarget({ id: 't2', sortOrder: 1 }),
      numericTarget({ id: 't1', sortOrder: 0 }),
      numericTarget({ id: 't3', sortOrder: 2, archived: true }),
      numericTarget({ id: 'other-goal', goalId: 'g2', sortOrder: 0 }),
    ];
    expect(getGoalTargets(targets, 'g1').map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('returns only archived targets for getArchivedGoalTargets', () => {
    const targets = [
      numericTarget({ id: 't1', archived: false }),
      numericTarget({ id: 't2', archived: true }),
    ];
    expect(getArchivedGoalTargets(targets, 'g1').map((t) => t.id)).toEqual(['t2']);
  });

  it('nextTargetSortOrder ignores archived targets and other goals', () => {
    const targets = [
      numericTarget({ id: 't1', sortOrder: 5 }),
      numericTarget({ id: 't2', sortOrder: 9, archived: true }),
      numericTarget({ id: 't3', goalId: 'g2', sortOrder: 20 }),
    ];
    expect(nextTargetSortOrder(targets, 'g1')).toBe(6);
    expect(nextTargetSortOrder([], 'g1')).toBe(0);
  });
});

describe('getTargetProgress — numeric', () => {
  it('computes progress for an increasing target ($0 -> $500,000)', () => {
    const t = numericTarget({ startValue: 0, currentValue: 250000, targetValue: 500000 });
    expect(getTargetProgress(t, [])).toBe(50);
  });

  it('computes progress for a decreasing target (170 lb -> 165 lb)', () => {
    const t = numericTarget({ startValue: 170, currentValue: 167.5, targetValue: 165 });
    expect(getTargetProgress(t, [])).toBe(50);
  });

  it('clamps overshoot past the target to 100', () => {
    const increasing = numericTarget({ startValue: 0, currentValue: 600000, targetValue: 500000 });
    expect(getTargetProgress(increasing, [])).toBe(100);

    const decreasing = numericTarget({ startValue: 170, currentValue: 160, targetValue: 165 });
    expect(getTargetProgress(decreasing, [])).toBe(100);
  });

  it('clamps undershoot past the start value to 0', () => {
    const t = numericTarget({ startValue: 100, currentValue: 50, targetValue: 200 });
    expect(getTargetProgress(t, [])).toBe(0);
  });

  it('treats startValue === targetValue as instantly 0% or 100%, never dividing by zero', () => {
    const notYet = numericTarget({ startValue: 100, currentValue: 50, targetValue: 100 });
    expect(getTargetProgress(notYet, [])).toBe(0);

    const reached = numericTarget({ startValue: 100, currentValue: 100, targetValue: 100 });
    expect(getTargetProgress(reached, [])).toBe(100);
  });
});

describe('getTargetProgress — yes/no', () => {
  it('is 0 when not achieved and 100 when achieved', () => {
    expect(getTargetProgress(yesNoTarget({ achieved: false }), [])).toBe(0);
    expect(getTargetProgress(yesNoTarget({ achieved: true }), [])).toBe(100);
  });
});

describe('getTargetProgress — linked tasks', () => {
  it('is completed/total among the linked tasks', () => {
    const tasks = [task({ id: 'a', status: 'Done' }), task({ id: 'b', status: 'Inbox' })];
    const t = linkedTasksTarget({ taskIds: ['a', 'b'] });
    expect(getTargetProgress(t, tasks)).toBe(50);
  });

  it('is 0 for an empty linked set', () => {
    expect(getTargetProgress(linkedTasksTarget({ taskIds: [] }), [])).toBe(0);
  });

  it('silently drops a stale/missing task id from both numerator and denominator', () => {
    const tasks = [task({ id: 'a', status: 'Done' })];
    const t = linkedTasksTarget({ taskIds: ['a', 'does-not-exist'] });
    expect(getTargetProgress(t, tasks)).toBe(100);
  });

  it('counts an archived-but-Done linked task as complete', () => {
    const tasks = [task({ id: 'a', status: 'Done', archived: true }), task({ id: 'b', status: 'Inbox' })];
    const t = linkedTasksTarget({ taskIds: ['a', 'b'] });
    expect(getTargetProgress(t, tasks)).toBe(50);
  });

  it('counts an archived-and-not-done linked task as incomplete, not excluded', () => {
    const tasks = [task({ id: 'a', status: 'Inbox', archived: true })];
    const t = linkedTasksTarget({ taskIds: ['a'] });
    expect(getTargetProgress(t, tasks)).toBe(0);
  });

  it('a reopened task (Done -> another status) drops out of the completed count on the next call', () => {
    const doneTasks = [task({ id: 'a', status: 'Done' })];
    const t = linkedTasksTarget({ taskIds: ['a'] });
    expect(getTargetProgress(t, doneTasks)).toBe(100);

    const reopenedTasks = [task({ id: 'a', status: 'Inbox' })];
    expect(getTargetProgress(t, reopenedTasks)).toBe(0);
  });
});

describe('getGoalProgress', () => {
  it('returns null for a goal with no targets', () => {
    expect(getGoalProgress(goal(), [], [])).toBeNull();
  });

  it('returns null when a goal only has archived targets', () => {
    const targets = [numericTarget({ archived: true, currentValue: 100, targetValue: 100 })];
    expect(getGoalProgress(goal(), targets, [])).toBeNull();
  });

  it('is the equal-weight average of its non-archived targets', () => {
    const targets = [
      numericTarget({ id: 't1', startValue: 0, currentValue: 50, targetValue: 100 }), // 50
      yesNoTarget({ id: 't2', achieved: true }), // 100
    ];
    expect(getGoalProgress(goal(), targets, [])).toBe(75);
  });

  it('excludes archived targets from the average', () => {
    const targets = [
      numericTarget({ id: 't1', startValue: 0, currentValue: 100, targetValue: 100 }), // 100
      yesNoTarget({ id: 't2', achieved: false, archived: true }), // would drag the average to 50 if counted
    ];
    expect(getGoalProgress(goal(), targets, [])).toBe(100);
  });

  it('only averages targets belonging to this goal', () => {
    const targets = [
      numericTarget({ id: 't1', goalId: 'g1', startValue: 0, currentValue: 100, targetValue: 100 }), // 100
      numericTarget({ id: 't2', goalId: 'g2', startValue: 0, currentValue: 0, targetValue: 100 }), // 0, other goal
    ];
    expect(getGoalProgress(goal({ id: 'g1' }), targets, [])).toBe(100);
  });
});

describe('RESET clears goals and targets', () => {
  it('empties goals and targets along with tasks/projects/dailyNotes', () => {
    const state = stateWith({ goals: [goal()], targets: [numericTarget()] });
    const next = appReducer(state, { type: 'RESET' });
    expect(next).toEqual({ version: 1, tasks: [], projects: [], dailyNotes: [], goals: [], targets: [] });
  });
});
