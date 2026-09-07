import { describe, expect, it } from 'vitest';
import { appReducer, createTaskForTest, getTriageTasks } from './reducer';
import { createEmptyAppData, type AppData, type Task } from '../types';

function stateWith(tasks: Task[]): AppData {
  return { ...createEmptyAppData(), tasks };
}

describe('getTriageTasks', () => {
  it('returns only active, unassigned, Normal-priority, Inbox tasks', () => {
    const inbox = createTaskForTest({ id: 'inbox', createdAt: '2026-01-01T00:00:00.000Z' });
    const withProject = createTaskForTest({ id: 'with-project', projectId: 'p1' });
    const lowPriority = createTaskForTest({ id: 'low', priority: 'Low' });
    const highPriority = createTaskForTest({ id: 'high', priority: 'High' });
    const inProgress = createTaskForTest({ id: 'in-progress', status: 'In Progress' });
    const archived = createTaskForTest({ id: 'archived', archived: true });

    const result = getTriageTasks([
      inbox,
      withProject,
      lowPriority,
      highPriority,
      inProgress,
      archived,
    ]);

    expect(result.map((t) => t.id)).toEqual(['inbox']);
  });

  it('sorts by createdAt descending, newest task first', () => {
    const oldest = createTaskForTest({ id: 'oldest', createdAt: '2026-01-01T00:00:00.000Z' });
    const newest = createTaskForTest({ id: 'newest', createdAt: '2026-01-03T00:00:00.000Z' });
    const middle = createTaskForTest({ id: 'middle', createdAt: '2026-01-02T00:00:00.000Z' });

    const result = getTriageTasks([oldest, newest, middle]);

    expect(result.map((t) => t.id)).toEqual(['newest', 'middle', 'oldest']);
  });
});

describe('triage inbox reacts to UPDATE_TASK', () => {
  it('removes a task from triage once a project is assigned, without deleting or archiving it', () => {
    const state = stateWith([createTaskForTest({ id: 't1' })]);
    const next = appReducer(state, {
      type: 'UPDATE_TASK',
      id: 't1',
      updates: { projectId: 'p1' },
    });

    expect(getTriageTasks(next.tasks)).toHaveLength(0);
    const task = next.tasks.find((t) => t.id === 't1');
    expect(task).toBeDefined();
    expect(task?.archived).toBe(false);
  });

  it('removes a task from triage when priority changes to Low', () => {
    const state = stateWith([createTaskForTest({ id: 't1' })]);
    const next = appReducer(state, {
      type: 'UPDATE_TASK',
      id: 't1',
      updates: { priority: 'Low' },
    });

    expect(getTriageTasks(next.tasks)).toHaveLength(0);
    expect(next.tasks.find((t) => t.id === 't1')?.archived).toBe(false);
  });

  it('removes a task from triage when priority changes to High', () => {
    const state = stateWith([createTaskForTest({ id: 't1' })]);
    const next = appReducer(state, {
      type: 'UPDATE_TASK',
      id: 't1',
      updates: { priority: 'High' },
    });

    expect(getTriageTasks(next.tasks)).toHaveLength(0);
    expect(next.tasks.find((t) => t.id === 't1')?.archived).toBe(false);
  });

  it('removes a task from triage when moved out of Inbox status', () => {
    const state = stateWith([createTaskForTest({ id: 't1' })]);
    const next = appReducer(state, {
      type: 'UPDATE_TASK',
      id: 't1',
      updates: { status: 'This Week' },
    });

    expect(getTriageTasks(next.tasks)).toHaveLength(0);
    const task = next.tasks.find((t) => t.id === 't1');
    expect(task).toBeDefined();
    expect(task?.archived).toBe(false);
  });

  it('keeps the task itself intact — still present, not deleted or archived', () => {
    const state = stateWith([createTaskForTest({ id: 't1', title: 'Survives triage change' })]);
    const next = appReducer(state, {
      type: 'UPDATE_TASK',
      id: 't1',
      updates: { projectId: 'p1', status: 'This Week', priority: 'High' },
    });

    expect(next.tasks).toHaveLength(1);
    expect(next.tasks[0]).toMatchObject({
      id: 't1',
      title: 'Survives triage change',
      archived: false,
    });
  });
});
