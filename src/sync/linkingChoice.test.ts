import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  applyKeepLocalData,
  buildUseCloudData,
  compareForLinking,
  loadCloudBundle,
  type CloudBundle,
} from './linkingChoice';
import { createEmptyAccountMetadata, isDirty } from './metadata';
import { createEmptyAppData, type AppData, type Project } from '../types';
import type { CloudProject, RepositoryResult } from '../repository/types';

const projectsRepo = vi.hoisted(() => ({ listProjects: vi.fn(), createProject: vi.fn(), updateProjectGuarded: vi.fn() }));
const tasksRepo = vi.hoisted(() => ({ listTasks: vi.fn(), createTask: vi.fn(), updateTaskGuarded: vi.fn() }));
const dailyNotesRepo = vi.hoisted(() => ({
  listDailyNotes: vi.fn(),
  createDailyNote: vi.fn(),
  updateDailyNoteGuarded: vi.fn(),
}));

vi.mock('../repository/projectsRepository', () => projectsRepo);
vi.mock('../repository/tasksRepository', () => tasksRepo);
vi.mock('../repository/dailyNotesRepository', () => dailyNotesRepo);

function ok<T>(data: T): RepositoryResult<T> {
  return { ok: true, data };
}
function err(): RepositoryResult<never> {
  return { ok: false, error: { type: 'database', message: 'boom' } };
}

const localProject: Project = { id: 'proj-local', name: 'Local only', status: 'active' };
const sharedLocalProject: Project = { id: 'proj-shared', name: 'Local version', status: 'active' };
const cloudOnlyProject: CloudProject = {
  id: 'proj-cloud',
  name: 'Cloud only',
  status: 'active',
  updatedAt: '2026-08-30T00:00:00.000Z',
};
const sharedCloudProject: CloudProject = {
  id: 'proj-shared',
  name: 'Cloud version',
  status: 'active',
  updatedAt: '2026-08-30T00:00:00.000Z',
};

function localWith(overrides: Partial<AppData> = {}): AppData {
  return { ...createEmptyAppData(), ...overrides };
}

function emptyCloud(): CloudBundle {
  return { projects: [], tasks: [], dailyNotes: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadCloudBundle', () => {
  it('reads all three entity types and combines them', async () => {
    projectsRepo.listProjects.mockResolvedValue(ok([cloudOnlyProject]));
    tasksRepo.listTasks.mockResolvedValue(ok([]));
    dailyNotesRepo.listDailyNotes.mockResolvedValue(ok([]));

    const result = await loadCloudBundle();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.projects).toEqual([cloudOnlyProject]);
  });

  it('surfaces the first failure as a typed error', async () => {
    projectsRepo.listProjects.mockResolvedValue(err());
    tasksRepo.listTasks.mockResolvedValue(ok([]));
    dailyNotesRepo.listDailyNotes.mockResolvedValue(ok([]));

    const result = await loadCloudBundle();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe('boom');
  });
});

describe('compareForLinking', () => {
  it('classifies local-only, cloud-only, and differing records correctly, and identical is false when any differ', () => {
    const local = localWith({ projects: [localProject, sharedLocalProject] });
    const cloud: CloudBundle = { projects: [cloudOnlyProject, sharedCloudProject], tasks: [], dailyNotes: [] };

    const comparison = compareForLinking(local, cloud);

    expect(comparison.localOnly.project).toEqual(['proj-local']);
    expect(comparison.cloudOnly.project).toEqual(['proj-cloud']);
    expect(comparison.differing.project).toEqual(['proj-shared']);
    expect(comparison.identical).toBe(false);
  });

  it('reports identical: true only when every record on both sides matches exactly', () => {
    const local = localWith({ projects: [sharedLocalProject] });
    const cloud: CloudBundle = {
      projects: [{ ...sharedLocalProject, updatedAt: '2026-08-30T00:00:00.000Z' }],
      tasks: [],
      dailyNotes: [],
    };

    const comparison = compareForLinking(local, cloud);
    expect(comparison.identical).toBe(true);
  });

  it('both empty compares as identical', () => {
    expect(compareForLinking(localWith(), emptyCloud()).identical).toBe(true);
  });
});

describe('buildUseCloudData ("Use my account\'s data")', () => {
  it('replaces local content wholesale with the cloud bundle, stripping updatedAt, and never calls any repository write', () => {
    const cloud: CloudBundle = { projects: [cloudOnlyProject], tasks: [], dailyNotes: [] };
    const result = buildUseCloudData(cloud);

    expect(result.projects).toEqual([{ id: 'proj-cloud', name: 'Cloud only', status: 'active' }]);
    expect(projectsRepo.createProject).not.toHaveBeenCalled();
    expect(projectsRepo.updateProjectGuarded).not.toHaveBeenCalled();
  });
});

describe('applyKeepLocalData ("Keep this device\'s data")', () => {
  it('pushes differing records with the guarded update, creates local-only records, and pulls down cloud-only records without deleting anything', async () => {
    projectsRepo.updateProjectGuarded.mockResolvedValue(ok({} as CloudProject));
    projectsRepo.createProject.mockResolvedValue(ok({} as CloudProject));

    const local = localWith({ projects: [localProject, sharedLocalProject] });
    const cloud: CloudBundle = { projects: [cloudOnlyProject, sharedCloudProject], tasks: [], dailyNotes: [] };
    const comparison = compareForLinking(local, cloud);
    const metadata = createEmptyAccountMetadata('user-1');

    const outcome = await applyKeepLocalData(local, cloud, comparison, metadata, 'user-1');

    expect(projectsRepo.updateProjectGuarded).toHaveBeenCalledWith(
      'proj-shared',
      { name: 'Local version', description: undefined, status: 'active' },
      '2026-08-30T00:00:00.000Z',
      'user-1',
    );
    expect(projectsRepo.createProject).toHaveBeenCalledWith(localProject, 'user-1');

    // Cloud-only pulled down, nothing deleted, local-authored content kept.
    const ids = outcome.appData.projects.map((p) => p.id).sort();
    expect(ids).toEqual(['proj-cloud', 'proj-local', 'proj-shared']);
    const shared = outcome.appData.projects.find((p) => p.id === 'proj-shared');
    expect(shared?.name).toBe('Local version');

    expect(outcome.deferred.project).toEqual([]);
    expect(outcome.deferred.task).toEqual([]);
    expect(outcome.deferred.dailyNote).toEqual([]);
  });

  it('defers to the drain engine on a write failure: marks the record dirty and reports it, never retries or resolves conflicts inline', async () => {
    projectsRepo.updateProjectGuarded.mockResolvedValue(
      err(),
    );

    const local = localWith({ projects: [sharedLocalProject] });
    const cloud: CloudBundle = { projects: [sharedCloudProject], tasks: [], dailyNotes: [] };
    const comparison = compareForLinking(local, cloud);
    const metadata = createEmptyAccountMetadata('user-1');

    const outcome = await applyKeepLocalData(local, cloud, comparison, metadata, 'user-1');

    expect(outcome.deferred.project).toEqual(['proj-shared']);
    expect(isDirty(outcome.metadata, 'project', 'proj-shared')).toBe(true);
  });

  it('never invokes a repository write for a record identical on both sides', async () => {
    const local = localWith({ projects: [sharedLocalProject] });
    const cloud: CloudBundle = {
      projects: [{ ...sharedLocalProject, updatedAt: '2026-08-30T00:00:00.000Z' }],
      tasks: [],
      dailyNotes: [],
    };
    const comparison = compareForLinking(local, cloud);
    expect(comparison.identical).toBe(true);

    await applyKeepLocalData(local, cloud, comparison, createEmptyAccountMetadata('user-1'), 'user-1');

    expect(projectsRepo.updateProjectGuarded).not.toHaveBeenCalled();
    expect(projectsRepo.createProject).not.toHaveBeenCalled();
  });
});
