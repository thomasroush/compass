import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AppData, DailyNote, Project, Task } from '../types';
import { createEmptyAppData } from '../types';
import type { CloudDailyNote, CloudProject, CloudTask, RepositoryResult } from './types';

const projectsRepo = vi.hoisted(() => ({
  listProjects: vi.fn(),
  upsertProject: vi.fn(),
}));
const tasksRepo = vi.hoisted(() => ({
  listTasks: vi.fn(),
  upsertTask: vi.fn(),
}));
const dailyNotesRepo = vi.hoisted(() => ({
  listDailyNotes: vi.fn(),
  upsertDailyNote: vi.fn(),
}));

vi.mock('./projectsRepository', () => projectsRepo);
vi.mock('./tasksRepository', () => tasksRepo);
vi.mock('./dailyNotesRepository', () => dailyNotesRepo);

import { countLocalData, getCloudCounts, runMigration } from './migration';

function ok<T>(data: T): RepositoryResult<T> {
  return { ok: true, data };
}
function err(type: 'unauthenticated' | 'unconfigured' | 'database', message: string): RepositoryResult<never> {
  return { ok: false, error: { type, message } };
}

const project: Project = { id: 'proj-stable-1', name: 'Home', status: 'active' };
const task: Task = {
  id: 'task-stable-1',
  title: 'Buy milk',
  status: 'Inbox',
  priority: 'Normal',
  projectId: 'proj-stable-1',
  createdAt: '2026-08-30T00:00:00.000Z',
  sortOrder: 0,
  isPrimary: false,
  archived: false,
};
const note: DailyNote = { id: 'note-stable-1', date: '2026-08-30', morning: 'Plan', evening: 'Review' };

function localData(overrides: Partial<AppData> = {}): AppData {
  return { ...createEmptyAppData(), projects: [project], tasks: [task], dailyNotes: [note], ...overrides };
}

function cloudProject(p: Project = project): CloudProject {
  return { ...p, updatedAt: 'ts' };
}
function cloudTask(t: Task = task): CloudTask {
  return { ...t, updatedAt: 'ts' };
}
function cloudNote(n: DailyNote = note): CloudDailyNote {
  return { ...n, updatedAt: 'ts' };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('countLocalData', () => {
  it('counts each entity independently', () => {
    const data = localData();
    expect(countLocalData(data)).toEqual({ projects: 1, tasks: 1, dailyNotes: 1 });
    expect(countLocalData(createEmptyAppData())).toEqual({ projects: 0, tasks: 0, dailyNotes: 0 });
  });
});

describe('getCloudCounts', () => {
  it('returns current cloud counts when authenticated', async () => {
    projectsRepo.listProjects.mockResolvedValue(ok([cloudProject()]));
    tasksRepo.listTasks.mockResolvedValue(ok([]));
    dailyNotesRepo.listDailyNotes.mockResolvedValue(ok([]));

    const result = await getCloudCounts();
    expect(result).toEqual({ ok: true, data: { projects: 1, tasks: 0, dailyNotes: 0 } });
  });

  it('fails without authentication, so the migration preview cannot be shown', async () => {
    projectsRepo.listProjects.mockResolvedValue(err('unauthenticated', 'You must be signed in to access cloud data.'));
    tasksRepo.listTasks.mockResolvedValue(ok([]));
    dailyNotesRepo.listDailyNotes.mockResolvedValue(ok([]));

    const result = await getCloudCounts();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.type).toBe('unauthenticated');
  });
});

describe('runMigration — authentication requirement', () => {
  it('does not migrate anything, and stops immediately, when not authenticated', async () => {
    projectsRepo.upsertProject.mockResolvedValue(err('unauthenticated', 'You must be signed in to access cloud data.'));

    const outcome = await runMigration(localData());

    expect(outcome.ok).toBe(false);
    expect(outcome.authError).toBe('You must be signed in to access cloud data.');
    expect(outcome.uploaded).toEqual({ projects: 0, tasks: 0, dailyNotes: 0 });
    // Tasks/notes must never be attempted once authentication fails, and no
    // verification re-read happens either.
    expect(tasksRepo.upsertTask).not.toHaveBeenCalled();
    expect(dailyNotesRepo.upsertDailyNote).not.toHaveBeenCalled();
    expect(projectsRepo.listProjects).not.toHaveBeenCalled();
  });
});

describe('runMigration — successful migration', () => {
  it('uploads projects before tasks, preserves stable ids, and verifies by re-reading', async () => {
    const callOrder: string[] = [];
    projectsRepo.upsertProject.mockImplementation(async (p: Project) => {
      callOrder.push('upsertProject');
      return ok(cloudProject(p));
    });
    tasksRepo.upsertTask.mockImplementation(async (t: Task) => {
      callOrder.push('upsertTask');
      return ok(cloudTask(t));
    });
    dailyNotesRepo.upsertDailyNote.mockImplementation(async (n: DailyNote) => {
      callOrder.push('upsertDailyNote');
      return ok(cloudNote(n));
    });
    projectsRepo.listProjects.mockResolvedValue(ok([cloudProject()]));
    tasksRepo.listTasks.mockResolvedValue(ok([cloudTask()]));
    dailyNotesRepo.listDailyNotes.mockResolvedValue(ok([cloudNote()]));

    const outcome = await runMigration(localData());

    // Stable IDs preserved: the repository was called with the exact same records.
    expect(projectsRepo.upsertProject).toHaveBeenCalledWith(project);
    expect(tasksRepo.upsertTask).toHaveBeenCalledWith(task);
    expect(dailyNotesRepo.upsertDailyNote).toHaveBeenCalledWith(note);

    // Projects uploaded before tasks.
    expect(callOrder.indexOf('upsertProject')).toBeLessThan(callOrder.indexOf('upsertTask'));

    expect(outcome.ok).toBe(true);
    expect(outcome.uploaded).toEqual({ projects: 1, tasks: 1, dailyNotes: 1 });
    expect(outcome.uploadFailures).toEqual([]);
    expect(outcome.verification?.passed).toBe(true);
    expect(outcome.verification?.cloudCountsAfter).toEqual({ projects: 1, tasks: 1, dailyNotes: 1 });
  });
});

describe('runMigration — partial failure reporting', () => {
  it('reports which specific record failed without abandoning the others', async () => {
    const secondTask: Task = { ...task, id: 'task-stable-2', title: 'Second task' };
    projectsRepo.upsertProject.mockResolvedValue(ok(cloudProject()));
    tasksRepo.upsertTask.mockImplementation(async (t: Task) => {
      if (t.id === 'task-stable-2') {
        return err('database', 'violates foreign key constraint');
      }
      return ok(cloudTask(t));
    });
    dailyNotesRepo.upsertDailyNote.mockResolvedValue(ok(cloudNote()));
    projectsRepo.listProjects.mockResolvedValue(ok([cloudProject()]));
    tasksRepo.listTasks.mockResolvedValue(ok([cloudTask()]));
    dailyNotesRepo.listDailyNotes.mockResolvedValue(ok([cloudNote()]));

    const outcome = await runMigration(localData({ tasks: [task, secondTask] }));

    expect(outcome.ok).toBe(false);
    expect(outcome.uploaded.tasks).toBe(1);
    expect(outcome.uploadFailures).toEqual([
      { entity: 'task', id: 'task-stable-2', label: 'Second task', message: 'violates foreign key constraint' },
    ]);
    // The successful task is still reported as migrated and verified.
    expect(outcome.verification?.passed).toBe(true);
  });
});

describe('runMigration — verification failure reporting', () => {
  it('does not report success when a re-read after upload does not confirm the record', async () => {
    projectsRepo.upsertProject.mockResolvedValue(ok(cloudProject()));
    tasksRepo.upsertTask.mockResolvedValue(ok(cloudTask()));
    dailyNotesRepo.upsertDailyNote.mockResolvedValue(ok(cloudNote()));
    // Re-read "loses" the task — e.g. eventual consistency or replication lag.
    projectsRepo.listProjects.mockResolvedValue(ok([cloudProject()]));
    tasksRepo.listTasks.mockResolvedValue(ok([]));
    dailyNotesRepo.listDailyNotes.mockResolvedValue(ok([cloudNote()]));

    const outcome = await runMigration(localData());

    expect(outcome.ok).toBe(false);
    expect(outcome.uploaded.tasks).toBe(1); // the upload itself reported success...
    expect(outcome.verification?.passed).toBe(false);
    expect(outcome.verification?.issues).toEqual([
      { entity: 'task', id: 'task-stable-1', label: 'Buy milk', reason: 'not found in Supabase after migration' },
    ]);
  });

  it('flags a field mismatch between the local record and what verification reads back', async () => {
    projectsRepo.upsertProject.mockResolvedValue(ok(cloudProject()));
    tasksRepo.upsertTask.mockResolvedValue(ok(cloudTask()));
    dailyNotesRepo.upsertDailyNote.mockResolvedValue(ok(cloudNote()));
    projectsRepo.listProjects.mockResolvedValue(ok([cloudProject()]));
    tasksRepo.listTasks.mockResolvedValue(ok([cloudTask()]));
    // Re-read shows different content than what was migrated.
    dailyNotesRepo.listDailyNotes.mockResolvedValue(ok([{ ...cloudNote(), evening: 'Something else' }]));

    const outcome = await runMigration(localData());

    expect(outcome.ok).toBe(false);
    expect(outcome.verification?.passed).toBe(false);
    expect(outcome.verification?.issues).toEqual([
      {
        entity: 'dailyNote',
        id: 'note-stable-1',
        label: '2026-08-30',
        reason: 'content does not match the local record',
      },
    ]);
  });
});
