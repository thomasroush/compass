import { describe, expect, it } from 'vitest';
import { appReducer } from './reducer';
import { createEmptyAppData, type AppData, type Project, type Task } from '../types';

function project(overrides: Partial<Project> = {}): Project {
  return { id: 'p1', name: 'Home', status: 'active', ...overrides };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Buy milk',
    status: 'Inbox',
    priority: 'Normal',
    createdAt: '2026-09-16T00:00:00.000Z',
    sortOrder: 0,
    isPrimary: false,
    archived: false,
    ...overrides,
  };
}

function stateWith(overrides: Partial<AppData> = {}): AppData {
  return { ...createEmptyAppData(), ...overrides };
}

describe('ADD_TASK — ownerId derived from the parent Project', () => {
  it("inherits a shared Project's ownerId when the new Task is assigned to it", () => {
    const state = stateWith({ projects: [project({ id: 'shared-proj', ownerId: 'owner-x' })] });

    const next = appReducer(state, {
      type: 'ADD_TASK',
      title: 'Design the flyer',
      projectId: 'shared-proj',
    });

    expect(next.tasks[0].ownerId).toBe('owner-x');
  });

  it('keeps existing private-Task behavior when the Project has no known ownerId', () => {
    const state = stateWith({ projects: [project({ id: 'p1' })] }); // no ownerId at all

    const next = appReducer(state, { type: 'ADD_TASK', title: 'Buy milk', projectId: 'p1' });

    expect(next.tasks[0].ownerId).toBeUndefined();
  });

  it('keeps existing private-Task behavior for a Task created outside any Project', () => {
    const state = stateWith();

    const next = appReducer(state, { type: 'ADD_TASK', title: 'Unassigned task' });

    expect(next.tasks[0].projectId).toBeUndefined();
    expect(next.tasks[0].ownerId).toBeUndefined();
  });

  it("does not stamp the acting device's own account onto a Task assigned to one of its own Projects with no ownerId set yet", () => {
    // A Project that has never round-tripped through the cloud repository
    // layer has no ownerId at all — a Task assigned to it must not have one
    // invented for it either, matching the Project's own "unknown" state.
    const state = stateWith({ projects: [project({ id: 'p1' })] });

    const next = appReducer(state, { type: 'ADD_TASK', title: 'Buy milk', projectId: 'p1' });

    expect(next.tasks[0].ownerId).toBeUndefined();
  });
});

describe('UPDATE_TASK — ownerId re-derived only when the Project assignment changes', () => {
  it('picks up the new ownerId when a Task is reassigned into a shared Project', () => {
    const state = stateWith({
      projects: [project({ id: 'shared-proj', ownerId: 'owner-x' })],
      tasks: [task({ projectId: undefined })],
    });

    const next = appReducer(state, {
      type: 'UPDATE_TASK',
      id: 't1',
      updates: { projectId: 'shared-proj' },
    });

    expect(next.tasks[0].ownerId).toBe('owner-x');
  });

  it('clears ownerId when a Task is unassigned from its Project', () => {
    const state = stateWith({
      projects: [project({ id: 'shared-proj', ownerId: 'owner-x' })],
      tasks: [task({ projectId: 'shared-proj', ownerId: 'owner-x' })],
    });

    const next = appReducer(state, {
      type: 'UPDATE_TASK',
      id: 't1',
      updates: { projectId: '' },
    });

    expect(next.tasks[0].projectId).toBeUndefined();
    expect(next.tasks[0].ownerId).toBeUndefined();
  });

  it('never overwrites an existing, valid ownerId when an unrelated field is updated', () => {
    const state = stateWith({
      projects: [project({ id: 'shared-proj', ownerId: 'owner-x' })],
      tasks: [task({ projectId: 'shared-proj', ownerId: 'owner-x' })],
    });

    const next = appReducer(state, {
      type: 'UPDATE_TASK',
      id: 't1',
      updates: { title: 'Renamed by editor' },
    });

    expect(next.tasks[0].title).toBe('Renamed by editor');
    expect(next.tasks[0].ownerId).toBe('owner-x');
  });

  it('re-derives ownerId when moved between two different shared Projects', () => {
    const state = stateWith({
      projects: [
        project({ id: 'shared-proj-a', ownerId: 'owner-x' }),
        project({ id: 'shared-proj-b', ownerId: 'owner-y' }),
      ],
      tasks: [task({ projectId: 'shared-proj-a', ownerId: 'owner-x' })],
    });

    const next = appReducer(state, {
      type: 'UPDATE_TASK',
      id: 't1',
      updates: { projectId: 'shared-proj-b' },
    });

    expect(next.tasks[0].ownerId).toBe('owner-y');
  });
});
