import { describe, expect, it } from 'vitest';
import { appReducer, sortProjectsByPriority } from './reducer';
import { createEmptyAppData, type AppData, type Project } from '../types';

function project(overrides: Partial<Project> = {}): Project {
  return { id: 'p1', name: 'Home', status: 'active', ...overrides };
}

function stateWith(projects: Project[]): AppData {
  return { ...createEmptyAppData(), projects };
}

describe('ADD_PROJECT with priorityRank', () => {
  it('creates a project with no priorityRank when none is given', () => {
    const state = appReducer(createEmptyAppData(), { type: 'ADD_PROJECT', name: 'Home' });
    expect(state.projects[0].priorityRank).toBeUndefined();
  });

  it('creates a project with the given priorityRank', () => {
    const state = appReducer(createEmptyAppData(), {
      type: 'ADD_PROJECT',
      name: 'Home',
      priorityRank: 1,
    });
    expect(state.projects[0].priorityRank).toBe(1);
  });
});

describe('UPDATE_PROJECT with priorityRank', () => {
  it('sets a priorityRank on a previously unranked project', () => {
    const state = stateWith([project()]);
    const next = appReducer(state, { type: 'UPDATE_PROJECT', id: 'p1', priorityRank: 2 });
    expect(next.projects[0].priorityRank).toBe(2);
  });

  it('clears priorityRank back to unranked when given null', () => {
    const state = stateWith([project({ priorityRank: 2 })]);
    const next = appReducer(state, { type: 'UPDATE_PROJECT', id: 'p1', priorityRank: null });
    expect(next.projects[0].priorityRank).toBeUndefined();
  });

  it('leaves priorityRank unchanged when the field is omitted entirely', () => {
    const state = stateWith([project({ priorityRank: 2 })]);
    const next = appReducer(state, { type: 'UPDATE_PROJECT', id: 'p1', status: 'completed' });
    expect(next.projects[0].priorityRank).toBe(2);
  });

  it('updating priorityRank does not touch name, description, or status', () => {
    const state = stateWith([
      project({ description: 'Keep me', status: 'active' }),
    ]);
    const next = appReducer(state, { type: 'UPDATE_PROJECT', id: 'p1', priorityRank: 1 });
    expect(next.projects[0]).toEqual({
      id: 'p1',
      name: 'Home',
      description: 'Keep me',
      status: 'active',
      priorityRank: 1,
    });
  });
});

describe('sortProjectsByPriority', () => {
  it('sorts ranked projects numerically ascending, ahead of every unranked project', () => {
    const projects = [
      project({ id: 'b', name: 'Beta', priorityRank: 3 }),
      project({ id: 'a', name: 'Alpha' }),
      project({ id: 'c', name: 'Gamma', priorityRank: 1 }),
    ];
    expect(sortProjectsByPriority(projects).map((p) => p.id)).toEqual(['c', 'b', 'a']);
  });

  it('sorts unranked projects alphabetically by name', () => {
    const projects = [
      project({ id: 'z', name: 'Zebra' }),
      project({ id: 'a', name: 'Apple' }),
      project({ id: 'm', name: 'Mango' }),
    ];
    expect(sortProjectsByPriority(projects).map((p) => p.id)).toEqual(['a', 'm', 'z']);
  });

  it('breaks a tie between equal priorityRanks alphabetically by name', () => {
    const projects = [
      project({ id: 'b', name: 'Beta', priorityRank: 1 }),
      project({ id: 'a', name: 'Alpha', priorityRank: 1 }),
    ];
    expect(sortProjectsByPriority(projects).map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('leaves existing (unranked) projects unaffected unless a priority is assigned', () => {
    const projects = [project({ id: 'a', name: 'Alpha' }), project({ id: 'b', name: 'Beta' })];
    expect(sortProjectsByPriority(projects).every((p) => p.priorityRank === undefined)).toBe(true);
  });
});
