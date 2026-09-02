import { describe, expect, it } from 'vitest';
import { appReducer, createTaskForTest, getArchivedProjects, getVisibleProjects } from './reducer';
import { createEmptyAppData, type AppData, type Project } from '../types';

function project(overrides: Partial<Project> = {}): Project {
  return { id: 'p1', name: 'Home', status: 'active', ...overrides };
}

function stateWith(projects: Project[]): AppData {
  return { ...createEmptyAppData(), projects };
}

describe('getVisibleProjects / getArchivedProjects', () => {
  it('getVisibleProjects excludes archived projects but keeps active and completed ones', () => {
    const projects = [
      project({ id: 'active', status: 'active' }),
      project({ id: 'completed', status: 'completed' }),
      project({ id: 'archived', status: 'archived' }),
    ];
    const visible = getVisibleProjects(projects);
    expect(visible.map((p) => p.id).sort()).toEqual(['active', 'completed']);
  });

  it('getArchivedProjects returns only archived projects', () => {
    const projects = [
      project({ id: 'active', status: 'active' }),
      project({ id: 'archived-1', status: 'archived' }),
      project({ id: 'archived-2', status: 'archived' }),
    ];
    expect(getArchivedProjects(projects).map((p) => p.id).sort()).toEqual([
      'archived-1',
      'archived-2',
    ]);
  });

  it('returns empty arrays when there are no projects', () => {
    expect(getVisibleProjects([])).toEqual([]);
    expect(getArchivedProjects([])).toEqual([]);
  });
});

describe('project archive / restore via UPDATE_PROJECT', () => {
  it('archiving a project via UPDATE_PROJECT only changes its status, nothing else', () => {
    const state = stateWith([project({ id: 'p1', status: 'active', description: 'Keep me' })]);
    const next = appReducer(state, { type: 'UPDATE_PROJECT', id: 'p1', status: 'archived' });

    expect(next.projects).toEqual([
      { id: 'p1', name: 'Home', status: 'archived', description: 'Keep me' },
    ]);
    expect(getVisibleProjects(next.projects)).toEqual([]);
    expect(getArchivedProjects(next.projects)).toEqual(next.projects);
  });

  it('restoring an archived project via UPDATE_PROJECT makes it visible again', () => {
    const state = stateWith([project({ id: 'p1', status: 'archived' })]);
    const next = appReducer(state, { type: 'UPDATE_PROJECT', id: 'p1', status: 'active' });

    expect(next.projects[0].status).toBe('active');
    expect(getVisibleProjects(next.projects)).toEqual(next.projects);
    expect(getArchivedProjects(next.projects)).toEqual([]);
  });

  it('archiving a project leaves its tasks completely untouched', () => {
    const task = createTaskForTest({ id: 't1', projectId: 'p1', title: 'Still here' });
    const state: AppData = { ...stateWith([project({ id: 'p1' })]), tasks: [task] };

    const next = appReducer(state, { type: 'UPDATE_PROJECT', id: 'p1', status: 'archived' });

    expect(next.tasks).toEqual(state.tasks);
  });

  it('archiving a nonexistent project id is a no-op', () => {
    const state = stateWith([project({ id: 'p1' })]);
    const next = appReducer(state, { type: 'UPDATE_PROJECT', id: 'missing', status: 'archived' });
    expect(next).toEqual(state);
  });
});
