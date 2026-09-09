import { describe, expect, it } from 'vitest';
import { validateAppData } from './validation';

const BASE = { version: 1, tasks: [], projects: [], dailyNotes: [] };

const validGoal = {
  id: 'g1',
  name: 'Ship it',
  priority: 'Normal',
  status: 'active',
  projectIds: [],
};

const validNumericTarget = {
  id: 't1',
  goalId: 'g1',
  type: 'numeric',
  name: 'Revenue',
  sortOrder: 0,
  archived: false,
  startValue: 0,
  currentValue: 10,
  targetValue: 100,
};

const validYesNoTarget = {
  id: 't2',
  goalId: 'g1',
  type: 'yesno',
  name: 'Milestone',
  sortOrder: 1,
  archived: false,
  achieved: true,
};

const validLinkedTasksTarget = {
  id: 't3',
  goalId: 'g1',
  type: 'linked-tasks',
  name: 'Contract work',
  sortOrder: 2,
  archived: false,
  taskIds: ['task-1'],
};

describe('validateAppData — backward compatibility', () => {
  it('accepts a backup with no goals/targets keys at all, defaulting both to []', () => {
    const result = validateAppData(BASE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.goals).toEqual([]);
      expect(result.data.targets).toEqual([]);
    }
  });

  it('accepts explicit empty arrays', () => {
    const result = validateAppData({ ...BASE, goals: [], targets: [] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.goals).toEqual([]);
      expect(result.data.targets).toEqual([]);
    }
  });

  it('rejects goals present but not an array', () => {
    const result = validateAppData({ ...BASE, goals: 'nope' });
    expect(result).toEqual({ ok: false, error: 'Goals must be an array.' });
  });

  it('rejects targets present but not an array', () => {
    const result = validateAppData({ ...BASE, goals: [], targets: 'nope' });
    expect(result).toEqual({ ok: false, error: 'Targets must be an array.' });
  });
});

describe('validateAppData — goal shape', () => {
  it('accepts a fully valid goal, including optional fields', () => {
    const goal = { ...validGoal, description: 'Launch', dueDate: '2026-12-31' };
    const result = validateAppData({ ...BASE, goals: [goal] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.goals?.[0]).toEqual(goal);
  });

  it('rejects a goal with an invalid status', () => {
    const result = validateAppData({ ...BASE, goals: [{ ...validGoal, status: 'archived' }] });
    expect(result).toEqual({ ok: false, error: 'Invalid goal at index 0.' });
  });

  it('rejects a goal with an invalid priority', () => {
    const result = validateAppData({ ...BASE, goals: [{ ...validGoal, priority: 'Urgent' }] });
    expect(result.ok).toBe(false);
  });

  it('rejects a goal whose projectIds is not an array of strings', () => {
    const result = validateAppData({ ...BASE, goals: [{ ...validGoal, projectIds: [1, 2] }] });
    expect(result.ok).toBe(false);
  });

  it('rejects duplicate goal ids', () => {
    const result = validateAppData({ ...BASE, goals: [validGoal, validGoal] });
    expect(result).toEqual({ ok: false, error: 'Duplicate goal id: g1.' });
  });
});

describe('validateAppData — target shape', () => {
  it('accepts a valid numeric target and defaults valueFormat to number', () => {
    const result = validateAppData({ ...BASE, goals: [validGoal], targets: [validNumericTarget] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.targets?.[0]).toMatchObject({ type: 'numeric', valueFormat: 'number' });
  });

  it('accepts a valid yes/no target', () => {
    const result = validateAppData({ ...BASE, goals: [validGoal], targets: [validYesNoTarget] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.targets?.[0]).toEqual(validYesNoTarget);
  });

  it('accepts a valid linked-tasks target', () => {
    const result = validateAppData({ ...BASE, goals: [validGoal], targets: [validLinkedTasksTarget] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.targets?.[0]).toEqual(validLinkedTasksTarget);
  });

  it('rejects a numeric target missing a required numeric field', () => {
    const { targetValue: _drop, ...incomplete } = validNumericTarget;
    void _drop;
    const result = validateAppData({ ...BASE, goals: [validGoal], targets: [incomplete] });
    expect(result).toEqual({ ok: false, error: 'Invalid target at index 0.' });
  });

  it('rejects a yes/no target missing achieved', () => {
    const { achieved: _drop, ...incomplete } = validYesNoTarget;
    void _drop;
    const result = validateAppData({ ...BASE, goals: [validGoal], targets: [incomplete] });
    expect(result.ok).toBe(false);
  });

  it('rejects a linked-tasks target whose taskIds is not an array of strings', () => {
    const result = validateAppData({
      ...BASE,
      goals: [validGoal],
      targets: [{ ...validLinkedTasksTarget, taskIds: [1, 2] }],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown target type', () => {
    const result = validateAppData({
      ...BASE,
      goals: [validGoal],
      targets: [{ ...validYesNoTarget, type: 'currency' }],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects duplicate target ids', () => {
    const result = validateAppData({
      ...BASE,
      goals: [validGoal],
      targets: [validYesNoTarget, validYesNoTarget],
    });
    expect(result).toEqual({ ok: false, error: 'Duplicate target id: t2.' });
  });
});
