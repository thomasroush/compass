import { describe, expect, it } from 'vitest';
import type { DailyNote, Project, Task } from '../types';
import {
  dailyNoteFromRow,
  dailyNoteToInsertRow,
  dailyNoteUpdatesToRow,
  projectFromRow,
  projectToInsertRow,
  projectUpdatesToRow,
  taskFromRow,
  taskToInsertRow,
  taskUpdatesToRow,
} from './mappers';

describe('project mapping', () => {
  it('maps a full row to the app shape, preserving updated_at', () => {
    const cloud = projectFromRow({
      id: 'p1',
      name: 'Home',
      description: 'Household tasks',
      status: 'active',
      updated_at: '2026-08-30T00:00:00.000Z',
    });
    expect(cloud).toEqual({
      id: 'p1',
      name: 'Home',
      description: 'Household tasks',
      status: 'active',
      updatedAt: '2026-08-30T00:00:00.000Z',
    });
  });

  it('maps a null description to undefined, not null', () => {
    const cloud = projectFromRow({
      id: 'p1',
      name: 'Home',
      description: null,
      status: 'active',
      updated_at: 'ts',
    });
    expect(cloud.description).toBeUndefined();
  });

  it('builds an insert row scoped to the given user id, with an undefined description as null', () => {
    const project: Project = { id: 'p1', name: 'Home', status: 'active' };
    expect(projectToInsertRow('user-1', project)).toEqual({
      id: 'p1',
      user_id: 'user-1',
      name: 'Home',
      description: null,
      status: 'active',
    });
  });

  it('builds an update row containing only the fields that were provided', () => {
    expect(projectUpdatesToRow({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
    expect(projectUpdatesToRow({ status: 'archived' })).toEqual({ status: 'archived' });
    expect(projectUpdatesToRow({})).toEqual({});
  });
});

describe('task mapping', () => {
  it('maps a full row to the app shape, preserving updated_at', () => {
    const cloud = taskFromRow({
      id: 't1',
      title: 'Buy milk',
      notes: 'Whole milk',
      status: 'Today',
      project_id: 'p1',
      priority: 'High',
      due_date: '2026-09-01',
      created_at: '2026-08-30T00:00:00.000Z',
      completed_at: null,
      sort_order: 2,
      is_primary: true,
      archived: false,
      updated_at: '2026-08-30T01:00:00.000Z',
    });
    expect(cloud).toEqual({
      id: 't1',
      title: 'Buy milk',
      notes: 'Whole milk',
      status: 'Today',
      projectId: 'p1',
      priority: 'High',
      dueDate: '2026-09-01',
      createdAt: '2026-08-30T00:00:00.000Z',
      completedAt: undefined,
      sortOrder: 2,
      isPrimary: true,
      archived: false,
      updatedAt: '2026-08-30T01:00:00.000Z',
    });
  });

  it('maps every nullable column to undefined, never null, in the app shape', () => {
    const cloud = taskFromRow({
      id: 't1',
      title: 'Buy milk',
      notes: null,
      status: 'Inbox',
      project_id: null,
      priority: 'Normal',
      due_date: null,
      created_at: 'ts',
      completed_at: null,
      sort_order: 0,
      is_primary: false,
      archived: false,
      updated_at: 'ts',
    });
    expect(cloud.notes).toBeUndefined();
    expect(cloud.projectId).toBeUndefined();
    expect(cloud.dueDate).toBeUndefined();
    expect(cloud.completedAt).toBeUndefined();
  });

  it('builds an insert row scoped to the given user id, preserving the client-generated id and createdAt', () => {
    const task: Task = {
      id: 't1',
      title: 'Buy milk',
      status: 'Inbox',
      priority: 'Normal',
      createdAt: '2026-08-30T00:00:00.000Z',
      sortOrder: 0,
      isPrimary: false,
      archived: false,
    };
    expect(taskToInsertRow('user-1', task)).toEqual({
      id: 't1',
      user_id: 'user-1',
      title: 'Buy milk',
      notes: null,
      status: 'Inbox',
      project_id: null,
      priority: 'Normal',
      due_date: null,
      created_at: '2026-08-30T00:00:00.000Z',
      completed_at: null,
      sort_order: 0,
      is_primary: false,
      archived: false,
    });
  });

  it('builds an update row containing only the fields that were provided', () => {
    expect(taskUpdatesToRow({ status: 'Done', completedAt: '2026-08-30T00:00:00.000Z' })).toEqual({
      status: 'Done',
      completed_at: '2026-08-30T00:00:00.000Z',
    });
    expect(taskUpdatesToRow({})).toEqual({});
  });

  it('treats an explicitly-undefined optional field as "clear it", distinct from omitting the key', () => {
    // projectId: undefined means "un-assign this task's project" (-> project_id: null);
    // omitting the key entirely (the case above) means "leave project_id unchanged".
    expect(taskUpdatesToRow({ projectId: undefined })).toEqual({ project_id: null });
    expect(taskUpdatesToRow({ notes: undefined })).toEqual({ notes: null });
    expect(taskUpdatesToRow({ dueDate: undefined })).toEqual({ due_date: null });
  });
});

describe('daily note mapping', () => {
  it('maps date/morning/evening columns to the app shape, preserving updated_at', () => {
    const cloud = dailyNoteFromRow({
      id: 'n1',
      note_date: '2026-08-30',
      morning_notes: 'Focus on X',
      evening_notes: 'Done with X',
      updated_at: '2026-08-30T12:00:00.000Z',
    });
    expect(cloud).toEqual({
      id: 'n1',
      date: '2026-08-30',
      morning: 'Focus on X',
      evening: 'Done with X',
      updatedAt: '2026-08-30T12:00:00.000Z',
    });
  });

  it('builds an insert row scoped to the given user id', () => {
    const note: DailyNote = { id: 'n1', date: '2026-08-30', morning: 'Plan', evening: 'Review' };
    expect(dailyNoteToInsertRow('user-1', note)).toEqual({
      id: 'n1',
      user_id: 'user-1',
      note_date: '2026-08-30',
      morning_notes: 'Plan',
      evening_notes: 'Review',
    });
  });

  it('builds an update row containing only the fields that were provided', () => {
    expect(dailyNoteUpdatesToRow({ evening: 'Updated' })).toEqual({ evening_notes: 'Updated' });
    expect(dailyNoteUpdatesToRow({})).toEqual({});
  });
});
