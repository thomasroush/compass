import { describe, expect, it } from 'vitest';
import { appReducer, createTaskForTest, getTasksGroupedByDueDate } from './reducer';
import { createEmptyAppData } from '../types';

describe('getTasksGroupedByDueDate', () => {
  it('excludes tasks without a due date', () => {
    const tasks = [
      createTaskForTest({ id: 'no-date' }),
      createTaskForTest({ id: 'dated', dueDate: '2026-09-05' }),
    ];
    const groups = getTasksGroupedByDueDate(tasks);
    expect(groups).toEqual([{ date: '2026-09-05', tasks: [tasks[1]] }]);
  });

  it('excludes archived tasks even when dated', () => {
    const tasks = [createTaskForTest({ id: 'archived', dueDate: '2026-09-05', archived: true })];
    expect(getTasksGroupedByDueDate(tasks)).toEqual([]);
  });

  it('groups tasks by date in chronological order regardless of input order', () => {
    const later = createTaskForTest({ id: 'later', dueDate: '2026-09-10' });
    const earlier = createTaskForTest({ id: 'earlier', dueDate: '2026-09-01' });
    const groups = getTasksGroupedByDueDate([later, earlier]);
    expect(groups.map((g) => g.date)).toEqual(['2026-09-01', '2026-09-10']);
  });

  it('preserves sortOrder within a date group', () => {
    const second = createTaskForTest({ id: 'second', dueDate: '2026-09-05', sortOrder: 2 });
    const first = createTaskForTest({ id: 'first', dueDate: '2026-09-05', sortOrder: 1 });
    const groups = getTasksGroupedByDueDate([second, first]);
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['first', 'second']);
  });

  it('includes a calendar-only task — the Calendar is the one place it must always appear', () => {
    const task = createTaskForTest({ id: 'cal-only', dueDate: '2026-09-05', calendarOnly: true });
    expect(getTasksGroupedByDueDate([task])).toEqual([{ date: '2026-09-05', tasks: [task] }]);
  });

  it('does not use createdAt, completedAt, or updatedAt to determine grouping', () => {
    const task = createTaskForTest({
      id: 'done-in-past',
      dueDate: '2026-09-05',
      status: 'Done',
      completedAt: '2026-09-06T00:00:00.000Z',
      createdAt: '2020-01-01T00:00:00.000Z',
    });
    expect(getTasksGroupedByDueDate([task])).toEqual([{ date: '2026-09-05', tasks: [task] }]);
  });
});

describe('archiving a dated task from the Calendar (ARCHIVE_TASK)', () => {
  it.each([
    ['a regular dated task', { dueDate: '2026-09-05' }],
    ['a calendar-only item', { dueDate: '2026-09-05', calendarOnly: true }],
    ['a project task', { dueDate: '2026-09-05', projectId: 'p1' }],
  ])('removes %s from the Calendar but keeps it in state as archived', (_label, overrides) => {
    const task = createTaskForTest({ id: 't', ...overrides });
    const state = { ...createEmptyAppData(), tasks: [task] };

    const next = appReducer(state, { type: 'ARCHIVE_TASK', id: 't' });

    expect(getTasksGroupedByDueDate(next.tasks)).toEqual([]);
    expect(next.tasks).toHaveLength(1);
    expect(next.tasks[0]).toMatchObject({ id: 't', archived: true, dueDate: '2026-09-05' });
  });

  it('is separate from completion: an open task stays open, a completed task stays completed', () => {
    const open = createTaskForTest({ id: 'open', dueDate: '2026-09-05', status: 'In Progress' });
    const done = createTaskForTest({
      id: 'done',
      dueDate: '2026-09-05',
      status: 'Done',
      completedAt: '2026-09-05T10:00:00.000Z',
    });
    let state = { ...createEmptyAppData(), tasks: [open, done] };

    state = appReducer(state, { type: 'ARCHIVE_TASK', id: 'open' });
    state = appReducer(state, { type: 'ARCHIVE_TASK', id: 'done' });

    const [nextOpen, nextDone] = state.tasks;
    expect(nextOpen.status).toBe('In Progress');
    expect(nextOpen.completedAt).toBeUndefined();
    expect(nextDone.status).toBe('Done');
    expect(nextDone.completedAt).toBe('2026-09-05T10:00:00.000Z');
  });

  it('can be undone by clearing `archived`, which returns the task to the Calendar', () => {
    const state = {
      ...createEmptyAppData(),
      tasks: [createTaskForTest({ id: 't', dueDate: '2026-09-05' })],
    };
    const archived = appReducer(state, { type: 'ARCHIVE_TASK', id: 't' });

    const restored = appReducer(archived, {
      type: 'UPDATE_TASK',
      id: 't',
      updates: { archived: false },
    });

    expect(getTasksGroupedByDueDate(restored.tasks).map((g) => g.date)).toEqual(['2026-09-05']);
  });
});
