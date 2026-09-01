import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AppData, DailyNote, Project, Task } from '../types';
import { createEmptyAppData } from '../types';
import type { CloudDailyNote, CloudProject, CloudTask, RepositoryResult } from '../repository/types';

const projectsRepo = vi.hoisted(() => ({ listProjects: vi.fn() }));
const tasksRepo = vi.hoisted(() => ({ listTasks: vi.fn() }));
const dailyNotesRepo = vi.hoisted(() => ({ listDailyNotes: vi.fn() }));

vi.mock('../repository/projectsRepository', () => projectsRepo);
vi.mock('../repository/tasksRepository', () => tasksRepo);
vi.mock('../repository/dailyNotesRepository', () => dailyNotesRepo);

import { hydrateFromCloud } from './hydrateFromCloud';

function ok<T>(data: T): RepositoryResult<T> {
  return { ok: true, data };
}
function err(type: 'unauthenticated' | 'unconfigured' | 'database', message: string): RepositoryResult<never> {
  return { ok: false, error: { type, message } };
}

const project: Project = { id: 'proj-1', name: 'Home', status: 'active' };
const task: Task = {
  id: 'task-1',
  title: 'Buy milk',
  status: 'Inbox',
  priority: 'Normal',
  createdAt: '2026-08-30T00:00:00.000Z',
  sortOrder: 0,
  isPrimary: false,
  archived: false,
};
const note: DailyNote = { id: 'note-1', date: '2026-08-30', morning: 'Plan', evening: 'Review' };

function cloudProject(overrides: Partial<CloudProject> = {}): CloudProject {
  return { ...project, updatedAt: '2026-08-30T01:00:00.000Z', ...overrides };
}
function cloudTask(overrides: Partial<CloudTask> = {}): CloudTask {
  return { ...task, updatedAt: '2026-08-30T01:00:00.000Z', ...overrides };
}
function cloudNote(overrides: Partial<CloudDailyNote> = {}): CloudDailyNote {
  return { ...note, updatedAt: '2026-08-30T01:00:00.000Z', ...overrides };
}

function emptyLocal(): AppData {
  return createEmptyAppData();
}
function populatedLocal(): AppData {
  return { ...createEmptyAppData(), projects: [project], tasks: [task], dailyNotes: [note] };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hydrateFromCloud', () => {
  it('returns signed-out without calling any repository function when signed out', async () => {
    const result = await hydrateFromCloud(populatedLocal(), 'signedOut', false);
    expect(result.decision).toEqual({ kind: 'signed-out' });
    expect(result.localCounts).toBeUndefined();
    expect(result.cloudCounts).toBeUndefined();
    expect(result.hydrated).toBeUndefined();
    expect(projectsRepo.listProjects).not.toHaveBeenCalled();
    expect(tasksRepo.listTasks).not.toHaveBeenCalled();
    expect(dailyNotesRepo.listDailyNotes).not.toHaveBeenCalled();
  });

  it('successfully hydrates when the cloud has data and local is empty', async () => {
    projectsRepo.listProjects.mockResolvedValue(ok([cloudProject()]));
    tasksRepo.listTasks.mockResolvedValue(ok([cloudTask()]));
    dailyNotesRepo.listDailyNotes.mockResolvedValue(ok([cloudNote()]));

    const result = await hydrateFromCloud(emptyLocal(), 'signedIn', false);

    expect(result.decision).toEqual({ kind: 'hydrate-from-cloud' });
    expect(result.cloudCounts).toEqual({ projects: 1, tasks: 1, dailyNotes: 1 });
    expect(result.localCounts).toEqual({ projects: 0, tasks: 0, dailyNotes: 0 });
    expect(result.hydrated).toBeDefined();
    // The app-shaped data must not carry the cloud-only `updatedAt` field.
    expect(result.hydrated?.appData).toEqual({
      version: 1,
      projects: [project],
      tasks: [task],
      dailyNotes: [note],
    });
    // The raw cloud records (with updatedAt) are still available for sync metadata seeding.
    expect(result.hydrated?.projects[0].updatedAt).toBe('2026-08-30T01:00:00.000Z');
    expect(result.hydrated?.tasks[0].updatedAt).toBe('2026-08-30T01:00:00.000Z');
    expect(result.hydrated?.dailyNotes[0].updatedAt).toBe('2026-08-30T01:00:00.000Z');
  });

  it('reports both-empty and does not hydrate when both cloud and local have no data', async () => {
    projectsRepo.listProjects.mockResolvedValue(ok([]));
    tasksRepo.listTasks.mockResolvedValue(ok([]));
    dailyNotesRepo.listDailyNotes.mockResolvedValue(ok([]));

    const result = await hydrateFromCloud(emptyLocal(), 'signedIn', false);

    expect(result.decision).toEqual({ kind: 'both-empty' });
    expect(result.hydrated).toBeUndefined();
  });

  it('reports await-explicit-migration and does not hydrate when cloud is empty but local has data', async () => {
    projectsRepo.listProjects.mockResolvedValue(ok([]));
    tasksRepo.listTasks.mockResolvedValue(ok([]));
    dailyNotesRepo.listDailyNotes.mockResolvedValue(ok([]));

    const result = await hydrateFromCloud(populatedLocal(), 'signedIn', false);

    expect(result.decision).toEqual({ kind: 'await-explicit-migration' });
    expect(result.hydrated).toBeUndefined();
  });

  it('requires an explicit choice, and does not hydrate, when both sides have data and the device is not established', async () => {
    projectsRepo.listProjects.mockResolvedValue(ok([cloudProject()]));
    tasksRepo.listTasks.mockResolvedValue(ok([cloudTask()]));
    dailyNotesRepo.listDailyNotes.mockResolvedValue(ok([cloudNote()]));

    const result = await hydrateFromCloud(populatedLocal(), 'signedIn', false);

    expect(result.decision).toEqual({ kind: 'require-explicit-choice' });
    expect(result.hydrated).toBeUndefined();
  });

  it('reports sync-established, and does not re-hydrate, when both sides have data and the device is already established', async () => {
    projectsRepo.listProjects.mockResolvedValue(ok([cloudProject()]));
    tasksRepo.listTasks.mockResolvedValue(ok([cloudTask()]));
    dailyNotesRepo.listDailyNotes.mockResolvedValue(ok([cloudNote()]));

    const result = await hydrateFromCloud(populatedLocal(), 'signedIn', true);

    expect(result.decision).toEqual({ kind: 'sync-established' });
    expect(result.hydrated).toBeUndefined();
  });

  it('surfaces a repository failure as a recoverable cloud-query-failed decision without touching local data', async () => {
    projectsRepo.listProjects.mockResolvedValue(err('database', 'Network request failed.'));
    tasksRepo.listTasks.mockResolvedValue(ok([]));
    dailyNotesRepo.listDailyNotes.mockResolvedValue(ok([]));

    const result = await hydrateFromCloud(populatedLocal(), 'signedIn', false);

    expect(result.decision).toEqual({
      kind: 'cloud-query-failed',
      errorType: 'database',
      message: 'Network request failed.',
    });
    expect(result.hydrated).toBeUndefined();
    expect(result.cloudCounts).toBeUndefined();
    // Local counts are still reported (read before the cloud call), so a caller can show what is safely preserved.
    expect(result.localCounts).toEqual({ projects: 1, tasks: 1, dailyNotes: 1 });
  });

  it('surfaces an unauthenticated repository failure the same way as any other cloud-query-failed error', async () => {
    projectsRepo.listProjects.mockResolvedValue(ok([]));
    tasksRepo.listTasks.mockResolvedValue(err('unauthenticated', 'You must be signed in to access cloud data.'));
    dailyNotesRepo.listDailyNotes.mockResolvedValue(ok([]));

    const result = await hydrateFromCloud(emptyLocal(), 'signedIn', false);

    expect(result.decision).toEqual({
      kind: 'cloud-query-failed',
      errorType: 'unauthenticated',
      message: 'You must be signed in to access cloud data.',
    });
  });

  it('never accepts or forwards a user id, and never mixes results from different calls (no cross-user or stale bleed-through)', async () => {
    // First call: account A's cloud data.
    projectsRepo.listProjects.mockResolvedValueOnce(ok([cloudProject({ id: 'a-proj', name: 'Account A project' })]));
    tasksRepo.listTasks.mockResolvedValueOnce(ok([]));
    dailyNotesRepo.listDailyNotes.mockResolvedValueOnce(ok([]));

    const first = await hydrateFromCloud(emptyLocal(), 'signedIn', false);
    expect(first.decision.kind).toBe('hydrate-from-cloud');
    expect(first.hydrated?.appData.projects).toEqual([expect.objectContaining({ id: 'a-proj' })]);

    // Second call: account B's cloud data (a different mocked session). hydrateFromCloud
    // takes no user id parameter anywhere — the only way results can differ between calls
    // is via what the repository layer itself resolves from the live session, and this
    // call must reflect only the second mock, never a residue of the first.
    projectsRepo.listProjects.mockResolvedValueOnce(ok([cloudProject({ id: 'b-proj', name: 'Account B project' })]));
    tasksRepo.listTasks.mockResolvedValueOnce(ok([]));
    dailyNotesRepo.listDailyNotes.mockResolvedValueOnce(ok([]));

    const second = await hydrateFromCloud(emptyLocal(), 'signedIn', false);
    expect(second.decision.kind).toBe('hydrate-from-cloud');
    expect(second.hydrated?.appData.projects).toEqual([expect.objectContaining({ id: 'b-proj' })]);
    expect(second.hydrated?.appData.projects).not.toContainEqual(expect.objectContaining({ id: 'a-proj' }));

    // hydrateFromCloud's own signature has no user-id parameter to smuggle one through.
    expect(hydrateFromCloud.length).toBe(3);
  });
});
