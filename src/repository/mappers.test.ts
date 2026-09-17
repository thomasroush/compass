import { describe, expect, it } from 'vitest';
import type { Goal, Project, QuickNote, Target, Task } from '../types';
import {
  quickNoteFromRow,
  quickNoteToInsertRow,
  quickNoteUpdatesToRow,
  goalFromRow,
  goalToInsertRow,
  goalUpdatesToRow,
  projectFromRow,
  projectFromRowWithOwner,
  projectInvitationFromRow,
  projectMemberFromRow,
  projectToInsertRow,
  projectUpdatesToRow,
  targetFromRow,
  targetToInsertRow,
  targetUpdatesToRow,
  taskFromRow,
  taskFromRowWithOwner,
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
      priority_rank: 2,
      updated_at: '2026-08-30T00:00:00.000Z',
    });
    expect(cloud).toEqual({
      id: 'p1',
      name: 'Home',
      description: 'Household tasks',
      status: 'active',
      priorityRank: 2,
      updatedAt: '2026-08-30T00:00:00.000Z',
    });
  });

  it('maps a null description to undefined, not null', () => {
    const cloud = projectFromRow({
      id: 'p1',
      name: 'Home',
      description: null,
      status: 'active',
      priority_rank: null,
      updated_at: 'ts',
    });
    expect(cloud.description).toBeUndefined();
  });

  it('maps a null priority_rank to undefined, not null', () => {
    const cloud = projectFromRow({
      id: 'p1',
      name: 'Home',
      description: null,
      status: 'active',
      priority_rank: null,
      updated_at: 'ts',
    });
    expect(cloud.priorityRank).toBeUndefined();
  });

  it('builds an insert row scoped to the given user id, with an undefined description/priorityRank as null', () => {
    const project: Project = { id: 'p1', name: 'Home', status: 'active' };
    expect(projectToInsertRow('user-1', project)).toEqual({
      id: 'p1',
      user_id: 'user-1',
      name: 'Home',
      description: null,
      status: 'active',
      priority_rank: null,
    });
  });

  it('builds an insert row carrying priorityRank through as priority_rank', () => {
    const project: Project = { id: 'p1', name: 'Home', status: 'active', priorityRank: 1 };
    expect(projectToInsertRow('user-1', project).priority_rank).toBe(1);
  });

  it('builds an update row containing only the fields that were provided', () => {
    expect(projectUpdatesToRow({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
    expect(projectUpdatesToRow({ status: 'archived' })).toEqual({ status: 'archived' });
    expect(projectUpdatesToRow({})).toEqual({});
  });

  it('maps priorityRank updates to priority_rank, and an explicit undefined to null (clearing it)', () => {
    expect(projectUpdatesToRow({ priorityRank: 3 })).toEqual({ priority_rank: 3 });
    expect(projectUpdatesToRow({ priorityRank: undefined })).toEqual({ priority_rank: null });
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
      due_time: '14:30:00',
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
      dueTime: '14:30',
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
      due_time: null,
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
    expect(cloud.dueTime).toBeUndefined();
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
      due_time: null,
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
    expect(taskUpdatesToRow({ dueTime: undefined })).toEqual({ due_time: null });
  });

  it('clears dueTime along with dueDate when dueDate is cleared without an explicit dueTime', () => {
    expect(taskUpdatesToRow({ dueDate: undefined })).toEqual({ due_date: null, due_time: null });
  });

  it('lets an explicit dueTime override the dueDate-clears-dueTime default in the same update', () => {
    expect(taskUpdatesToRow({ dueDate: '2026-09-20', dueTime: '09:00' })).toEqual({
      due_date: '2026-09-20',
      due_time: '09:00',
    });
  });
});

describe('quick note mapping', () => {
  it('maps text/completed/deleted/timestamps columns to the app shape, preserving updated_at', () => {
    const cloud = quickNoteFromRow({
      id: 'n1',
      text: 'Buy underwear',
      completed: false,
      deleted: false,
      created_at: '2026-08-30T00:00:00.000Z',
      completed_at: null,
      updated_at: '2026-08-30T12:00:00.000Z',
    });
    expect(cloud).toEqual({
      id: 'n1',
      text: 'Buy underwear',
      completed: false,
      deleted: false,
      createdAt: '2026-08-30T00:00:00.000Z',
      completedAt: undefined,
      updatedAt: '2026-08-30T12:00:00.000Z',
    });
  });

  it('maps a non-null completed_at through to completedAt', () => {
    const cloud = quickNoteFromRow({
      id: 'n1',
      text: 'Done thing',
      completed: true,
      deleted: false,
      created_at: '2026-08-30T00:00:00.000Z',
      completed_at: '2026-08-31T00:00:00.000Z',
      updated_at: 'ts',
    });
    expect(cloud.completedAt).toBe('2026-08-31T00:00:00.000Z');
  });

  it('builds an insert row scoped to the given user id', () => {
    const note: QuickNote = {
      id: 'n1',
      text: 'Buy underwear',
      completed: false,
      deleted: false,
      createdAt: '2026-08-30T00:00:00.000Z',
    };
    expect(quickNoteToInsertRow('user-1', note)).toEqual({
      id: 'n1',
      user_id: 'user-1',
      text: 'Buy underwear',
      completed: false,
      deleted: false,
      created_at: '2026-08-30T00:00:00.000Z',
      completed_at: null,
    });
  });

  it('builds an insert row carrying a completedAt through as completed_at', () => {
    const note: QuickNote = {
      id: 'n1',
      text: 'Done thing',
      completed: true,
      deleted: false,
      createdAt: '2026-08-30T00:00:00.000Z',
      completedAt: '2026-08-31T00:00:00.000Z',
    };
    expect(quickNoteToInsertRow('user-1', note).completed_at).toBe('2026-08-31T00:00:00.000Z');
  });

  it('builds an update row containing only the fields that were provided', () => {
    expect(quickNoteUpdatesToRow({ completed: true })).toEqual({ completed: true });
    expect(quickNoteUpdatesToRow({ text: 'Updated' })).toEqual({ text: 'Updated' });
    expect(quickNoteUpdatesToRow({})).toEqual({});
  });

  it('maps an explicit undefined completedAt to null (clearing it, e.g. on reopen)', () => {
    expect(quickNoteUpdatesToRow({ completedAt: undefined })).toEqual({ completed_at: null });
  });

  it('maps deleted through for the soft-delete path', () => {
    expect(quickNoteUpdatesToRow({ deleted: true })).toEqual({ deleted: true });
  });
});

describe('goal mapping', () => {
  it('maps a full row to the app shape, preserving updated_at', () => {
    const cloud = goalFromRow({
      id: 'g1',
      name: 'Ship it',
      description: 'Launch the thing',
      due_date: '2026-12-31',
      priority: 'High',
      status: 'active',
      project_ids: ['p1', 'p2'],
      updated_at: '2026-09-08T00:00:00.000Z',
    });
    expect(cloud).toEqual({
      id: 'g1',
      name: 'Ship it',
      description: 'Launch the thing',
      dueDate: '2026-12-31',
      priority: 'High',
      status: 'active',
      projectIds: ['p1', 'p2'],
      updatedAt: '2026-09-08T00:00:00.000Z',
    });
  });

  it('maps null description/due_date to undefined, not null', () => {
    const cloud = goalFromRow({
      id: 'g1',
      name: 'Ship it',
      description: null,
      due_date: null,
      priority: 'Normal',
      status: 'active',
      project_ids: [],
      updated_at: 'ts',
    });
    expect(cloud.description).toBeUndefined();
    expect(cloud.dueDate).toBeUndefined();
  });

  it('builds an insert row scoped to the given user id, with undefined description/dueDate as null', () => {
    const goal: Goal = { id: 'g1', name: 'Ship it', priority: 'Normal', status: 'active', projectIds: ['p1'] };
    expect(goalToInsertRow('user-1', goal)).toEqual({
      id: 'g1',
      user_id: 'user-1',
      name: 'Ship it',
      description: null,
      due_date: null,
      priority: 'Normal',
      status: 'active',
      project_ids: ['p1'],
    });
  });

  it('builds an update row containing only the fields that were provided, with an explicit undefined as null', () => {
    expect(goalUpdatesToRow({ status: 'achieved' })).toEqual({ status: 'achieved' });
    expect(goalUpdatesToRow({ description: undefined })).toEqual({ description: null });
    expect(goalUpdatesToRow({})).toEqual({});
  });
});

describe('target mapping', () => {
  it('maps a numeric row to the app shape', () => {
    const cloud = targetFromRow({
      id: 't1',
      goal_id: 'g1',
      type: 'numeric',
      name: 'Revenue',
      sort_order: 0,
      archived: false,
      start_value: 0,
      current_value: 10,
      target_value: 100,
      unit: '$',
      value_format: 'currency',
      achieved: null,
      task_ids: [],
      updated_at: 'ts',
    });
    expect(cloud).toEqual({
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
      updatedAt: 'ts',
    });
  });

  it('maps a null unit/value_format to undefined/"number" respectively', () => {
    const cloud = targetFromRow({
      id: 't1',
      goal_id: 'g1',
      type: 'numeric',
      name: 'Weight',
      sort_order: 0,
      archived: false,
      start_value: 170,
      current_value: 168,
      target_value: 165,
      unit: null,
      value_format: null,
      achieved: null,
      task_ids: [],
      updated_at: 'ts',
    });
    expect(cloud?.type === 'numeric' && cloud.unit).toBeUndefined();
    expect(cloud?.type === 'numeric' && cloud.valueFormat).toBe('number');
  });

  it('returns null for a numeric row missing a required numeric field (defends against a constraint violation)', () => {
    const cloud = targetFromRow({
      id: 't1',
      goal_id: 'g1',
      type: 'numeric',
      name: 'Revenue',
      sort_order: 0,
      archived: false,
      start_value: null,
      current_value: 10,
      target_value: 100,
      unit: null,
      value_format: null,
      achieved: null,
      task_ids: [],
      updated_at: 'ts',
    });
    expect(cloud).toBeNull();
  });

  it('maps a yes/no row to the app shape', () => {
    const cloud = targetFromRow({
      id: 't2',
      goal_id: 'g1',
      type: 'yesno',
      name: 'Milestone',
      sort_order: 1,
      archived: true,
      start_value: null,
      current_value: null,
      target_value: null,
      unit: null,
      value_format: null,
      achieved: true,
      task_ids: [],
      updated_at: 'ts',
    });
    expect(cloud).toEqual({
      id: 't2',
      goalId: 'g1',
      name: 'Milestone',
      sortOrder: 1,
      archived: true,
      type: 'yesno',
      achieved: true,
      updatedAt: 'ts',
    });
  });

  it('maps a linked-tasks row to the app shape', () => {
    const cloud = targetFromRow({
      id: 't3',
      goal_id: 'g1',
      type: 'linked-tasks',
      name: 'Contract work',
      sort_order: 2,
      archived: false,
      start_value: null,
      current_value: null,
      target_value: null,
      unit: null,
      value_format: null,
      achieved: null,
      task_ids: ['task-1', 'task-2'],
      updated_at: 'ts',
    });
    expect(cloud).toEqual({
      id: 't3',
      goalId: 'g1',
      name: 'Contract work',
      sortOrder: 2,
      archived: false,
      type: 'linked-tasks',
      taskIds: ['task-1', 'task-2'],
      updatedAt: 'ts',
    });
  });

  it('builds an insert row with only the current type\'s columns populated, others null', () => {
    const target: Target = {
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
    };
    expect(targetToInsertRow('user-1', target)).toEqual({
      id: 't1',
      user_id: 'user-1',
      goal_id: 'g1',
      type: 'numeric',
      name: 'Revenue',
      sort_order: 0,
      archived: false,
      start_value: 0,
      current_value: 10,
      target_value: 100,
      unit: null,
      value_format: 'number',
      achieved: null,
      task_ids: [],
    });
  });

  it('builds an update row containing only the fields that were provided', () => {
    expect(targetUpdatesToRow({ archived: true })).toEqual({ archived: true });
    expect(targetUpdatesToRow({ currentValue: 42 })).toEqual({ current_value: 42 });
    expect(targetUpdatesToRow({})).toEqual({});
  });
});

describe('project mapping — with owner', () => {
  it('maps user_id to ownerId, alongside every field projectFromRow already maps', () => {
    const cloud = projectFromRowWithOwner({
      id: 'p1',
      user_id: 'owner-1',
      name: 'Shared project',
      description: null,
      status: 'active',
      priority_rank: null,
      updated_at: 'ts',
    });
    expect(cloud.ownerId).toBe('owner-1');
    expect(cloud).toEqual({
      id: 'p1',
      name: 'Shared project',
      description: undefined,
      status: 'active',
      priorityRank: undefined,
      updatedAt: 'ts',
      ownerId: 'owner-1',
    });
  });

  it('never assumes ownerId equals any particular id — it is exactly the row\'s own user_id', () => {
    const cloud = projectFromRowWithOwner({
      id: 'p1',
      user_id: 'someone-elses-id',
      name: 'Shared project',
      description: null,
      status: 'active',
      priority_rank: null,
      updated_at: 'ts',
    });
    expect(cloud.ownerId).toBe('someone-elses-id');
  });
});

describe('task mapping — with owner', () => {
  it('maps user_id to ownerId, alongside every field taskFromRow already maps', () => {
    const cloud = taskFromRowWithOwner({
      id: 't1',
      user_id: 'owner-1',
      title: 'Buy milk',
      notes: null,
      status: 'Inbox',
      project_id: 'p1',
      priority: 'Normal',
      due_date: null,
      due_time: null,
      created_at: 'ts',
      completed_at: null,
      sort_order: 0,
      is_primary: false,
      archived: false,
      updated_at: 'ts',
    });
    expect(cloud.ownerId).toBe('owner-1');
    expect(cloud.projectId).toBe('p1');
  });
});

describe('project member mapping', () => {
  it('maps a full row to the app shape, including member_email', () => {
    const member = projectMemberFromRow({
      owner_id: 'owner-1',
      project_id: 'p1',
      member_id: 'editor-1',
      member_email: 'editor@example.com',
      role: 'editor',
      created_at: '2026-09-16T00:00:00.000Z',
    });
    expect(member).toEqual({
      ownerId: 'owner-1',
      projectId: 'p1',
      memberId: 'editor-1',
      memberEmail: 'editor@example.com',
      role: 'editor',
      createdAt: '2026-09-16T00:00:00.000Z',
    });
  });

  it('maps a null member_email to undefined, not null (a membership row that predates this column)', () => {
    const member = projectMemberFromRow({
      owner_id: 'owner-1',
      project_id: 'p1',
      member_id: 'editor-1',
      member_email: null,
      role: 'editor',
      created_at: 'ts',
    });
    expect(member.memberEmail).toBeUndefined();
  });
});

describe('project invitation mapping', () => {
  it('maps a full row to the app shape, preserving responded_at', () => {
    const invitation = projectInvitationFromRow({
      id: 'inv-1',
      owner_id: 'owner-1',
      project_id: 'p1',
      invited_email: 'editor@example.com',
      status: 'accepted',
      created_at: '2026-09-16T00:00:00.000Z',
      responded_at: '2026-09-16T01:00:00.000Z',
    });
    expect(invitation).toEqual({
      id: 'inv-1',
      ownerId: 'owner-1',
      projectId: 'p1',
      invitedEmail: 'editor@example.com',
      status: 'accepted',
      createdAt: '2026-09-16T00:00:00.000Z',
      respondedAt: '2026-09-16T01:00:00.000Z',
    });
  });

  it('maps a null responded_at to undefined, not null (still pending, or a revoke)', () => {
    const invitation = projectInvitationFromRow({
      id: 'inv-1',
      owner_id: 'owner-1',
      project_id: 'p1',
      invited_email: 'editor@example.com',
      status: 'pending',
      created_at: 'ts',
      responded_at: null,
    });
    expect(invitation.respondedAt).toBeUndefined();
  });
});
