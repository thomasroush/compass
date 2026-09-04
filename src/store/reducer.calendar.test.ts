import { describe, expect, it } from 'vitest';
import { createTaskForTest, getTasksGroupedByDueDate } from './reducer';

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
