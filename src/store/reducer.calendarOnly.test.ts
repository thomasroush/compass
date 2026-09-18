import { describe, expect, it } from 'vitest';
import {
  appReducer,
  createTaskForTest,
  getOverdueTasks,
  getTasksByStatus,
  getTodayOtherTasks,
  getTodayPrimaryTasks,
} from './reducer';
import { createEmptyAppData, type AppData, type Task } from '../types';

function stateWith(tasks: Task[]): AppData {
  return { ...createEmptyAppData(), tasks };
}

describe('Calendar Only — Board/Tasks/Today filtering', () => {
  it('excludes a calendar-only task from getTasksByStatus, even when its status matches', () => {
    const calendarOnly = createTaskForTest({
      id: 'cal-only',
      status: 'Inbox',
      dueDate: '2026-09-05',
      calendarOnly: true,
    });
    const ordinary = createTaskForTest({ id: 'ordinary', status: 'Inbox' });

    expect(getTasksByStatus([calendarOnly, ordinary], 'Inbox').map((t) => t.id)).toEqual(['ordinary']);
  });

  it('excludes a calendar-only task from the Today dashboard\'s Primary/Other/Overdue sections', () => {
    const primary = createTaskForTest({
      id: 'cal-primary',
      status: 'Today',
      isPrimary: true,
      dueDate: '2026-09-05',
      calendarOnly: true,
    });
    const other = createTaskForTest({
      id: 'cal-other',
      status: 'Today',
      isPrimary: false,
      dueDate: '2026-09-05',
      calendarOnly: true,
    });
    const overdue = createTaskForTest({
      id: 'cal-overdue',
      status: 'Inbox',
      dueDate: '2020-01-01',
      calendarOnly: true,
    });

    expect(getTodayPrimaryTasks([primary])).toEqual([]);
    expect(getTodayOtherTasks([other])).toEqual([]);
    expect(getOverdueTasks([overdue], '2026-09-17')).toEqual([]);
  });
});

describe('Calendar Only — due-date coercion (ADD_TASK)', () => {
  it('stores calendarOnly: true when a due date is provided in the same action', () => {
    const state = stateWith([]);
    const next = appReducer(state, {
      type: 'ADD_TASK',
      title: 'Dentist appointment',
      dueDate: '2026-09-20',
      calendarOnly: true,
    });
    expect(next.tasks[0].calendarOnly).toBe(true);
    expect(next.tasks[0].dueDate).toBe('2026-09-20');
  });

  it('coerces calendarOnly back to false when no due date is provided — never an invisible task', () => {
    const state = stateWith([]);
    const next = appReducer(state, {
      type: 'ADD_TASK',
      title: 'Dentist appointment',
      calendarOnly: true,
    });
    expect(next.tasks[0].calendarOnly).toBe(false);
  });
});

describe('Calendar Only — due-date coercion (UPDATE_TASK)', () => {
  it('sets calendarOnly: true when the task already has a due date', () => {
    const task = createTaskForTest({ id: 't1', dueDate: '2026-09-20' });
    const state = stateWith([task]);
    const next = appReducer(state, {
      type: 'UPDATE_TASK',
      id: 't1',
      updates: { calendarOnly: true },
    });
    expect(next.tasks[0].calendarOnly).toBe(true);
  });

  it('sets calendarOnly: true when a due date is supplied in the same update', () => {
    const task = createTaskForTest({ id: 't1' });
    const state = stateWith([task]);
    const next = appReducer(state, {
      type: 'UPDATE_TASK',
      id: 't1',
      updates: { calendarOnly: true, dueDate: '2026-09-20' },
    });
    expect(next.tasks[0].calendarOnly).toBe(true);
  });

  it('coerces calendarOnly back to false when the task has no due date at all', () => {
    const task = createTaskForTest({ id: 't1' });
    const state = stateWith([task]);
    const next = appReducer(state, {
      type: 'UPDATE_TASK',
      id: 't1',
      updates: { calendarOnly: true },
    });
    expect(next.tasks[0].calendarOnly).toBe(false);
  });

  it('coerces calendarOnly back to false when dueDate is cleared in the same update that sets calendarOnly: true', () => {
    const task = createTaskForTest({ id: 't1', dueDate: '2026-09-20' });
    const state = stateWith([task]);
    const next = appReducer(state, {
      type: 'UPDATE_TASK',
      id: 't1',
      updates: { calendarOnly: true, dueDate: undefined },
    });
    expect(next.tasks[0].calendarOnly).toBe(false);
  });

  it('drops an already-calendar-only task back to false if a later update clears its due date without touching calendarOnly', () => {
    const task = createTaskForTest({ id: 't1', dueDate: '2026-09-20', calendarOnly: true });
    const state = stateWith([task]);
    const next = appReducer(state, {
      type: 'UPDATE_TASK',
      id: 't1',
      updates: { dueDate: undefined },
    });
    expect(next.tasks[0].calendarOnly).toBe(false);
  });
});

describe('Calendar Only — Complete/Reopen preserve placement', () => {
  it('COMPLETE_TASK preserves calendarOnly: true while moving status to Done', () => {
    const task = createTaskForTest({ id: 't1', dueDate: '2026-09-20', calendarOnly: true });
    const state = stateWith([task]);
    const next = appReducer(state, { type: 'COMPLETE_TASK', id: 't1' });
    expect(next.tasks[0].calendarOnly).toBe(true);
    expect(next.tasks[0].status).toBe('Done');
  });

  it('UNCOMPLETE_TASK preserves calendarOnly: true while moving status back to Inbox', () => {
    const task = createTaskForTest({
      id: 't1',
      dueDate: '2026-09-20',
      calendarOnly: true,
      status: 'Done',
      completedAt: '2026-09-18T00:00:00.000Z',
    });
    const state = stateWith([task]);
    const next = appReducer(state, { type: 'UNCOMPLETE_TASK', id: 't1' });
    expect(next.tasks[0].calendarOnly).toBe(true);
    expect(next.tasks[0].status).toBe('Inbox');
  });
});

describe('Calendar Only — moving back to the Board', () => {
  it('UPDATE_TASK with calendarOnly: false and a real status moves it back onto the Board', () => {
    const task = createTaskForTest({ id: 't1', dueDate: '2026-09-20', calendarOnly: true });
    const state = stateWith([task]);
    const next = appReducer(state, {
      type: 'UPDATE_TASK',
      id: 't1',
      updates: { calendarOnly: false, status: 'This Week' },
    });
    expect(next.tasks[0].calendarOnly).toBe(false);
    expect(getTasksByStatus(next.tasks, 'This Week').map((t) => t.id)).toEqual(['t1']);
  });
});
