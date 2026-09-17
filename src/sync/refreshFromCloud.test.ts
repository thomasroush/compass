import { describe, it, expect, vi, beforeEach } from 'vitest';
import { refreshFromCloud } from './refreshFromCloud';
import { createEmptyAccountMetadata, markDirty, setRecordUpdatedAt, type AccountSyncMetadata } from './metadata';
import { createEmptyAppData, type AppData, type Goal, type Project, type Task } from '../types';
import type { CloudGoal, CloudProject, CloudTask, RepositoryResult } from '../repository/types';

const projectsRepo = vi.hoisted(() => ({ listVisibleProjects: vi.fn() }));
const tasksRepo = vi.hoisted(() => ({ listVisibleTasks: vi.fn() }));
const quickNotesRepo = vi.hoisted(() => ({ listQuickNotes: vi.fn() }));
const goalsRepo = vi.hoisted(() => ({ listGoals: vi.fn() }));
const targetsRepo = vi.hoisted(() => ({ listTargets: vi.fn() }));

vi.mock('../repository/projectsRepository', () => projectsRepo);
vi.mock('../repository/tasksRepository', () => tasksRepo);
vi.mock('../repository/quickNotesRepository', () => quickNotesRepo);
vi.mock('../repository/goalsRepository', () => goalsRepo);
vi.mock('../repository/targetsRepository', () => targetsRepo);

function ok<T>(data: T): RepositoryResult<T> {
  return { ok: true, data };
}
function err(): RepositoryResult<never> {
  return { ok: false, error: { type: 'database', message: 'Network request failed.' } };
}

const project: Project = { id: 'proj-1', name: 'Home', status: 'active' };
const goal: Goal = { id: 'goal-1', name: 'Ship it', priority: 'Normal', status: 'active', projectIds: [] };

function cloudProject(overrides: Partial<CloudProject> = {}): CloudProject {
  return { ...project, updatedAt: '2026-08-30T01:00:00.000Z', ...overrides };
}
function cloudGoal(overrides: Partial<CloudGoal> = {}): CloudGoal {
  return { ...goal, updatedAt: '2026-08-30T01:00:00.000Z', ...overrides };
}

function cloudTask(base: Task, overrides: Partial<CloudTask> = {}): CloudTask {
  return { ...base, updatedAt: '2026-08-30T01:00:00.000Z', ...overrides };
}

function sharedTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'shared-task-1',
    title: 'Design the flyer',
    status: 'Inbox',
    priority: 'Normal',
    createdAt: '2026-08-30T00:00:00.000Z',
    sortOrder: 0,
    isPrimary: false,
    archived: false,
    projectId: 'shared-proj-1',
    ownerId: 'owner-x',
    ...overrides,
  };
}

function metadataWith(overrides: Partial<AccountSyncMetadata> = {}): AccountSyncMetadata {
  return { ...createEmptyAccountMetadata('user-1'), established: true, ...overrides };
}

function localWith(overrides: Partial<AppData> = {}): AppData {
  return { ...createEmptyAppData(), ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  tasksRepo.listVisibleTasks.mockResolvedValue(ok([]));
  quickNotesRepo.listQuickNotes.mockResolvedValue(ok([]));
  goalsRepo.listGoals.mockResolvedValue(ok([]));
  targetsRepo.listTargets.mockResolvedValue(ok([]));
});

describe('refreshFromCloud — returning-device pull', () => {
  it('pulls down a record that changed in the cloud since this device last saw it (Device A write -> Device B startup load)', async () => {
    projectsRepo.listVisibleProjects.mockResolvedValue(ok([cloudProject({ name: 'Home (renamed)' })]));
    const local = localWith({ projects: [project] });
    const metadata = setRecordUpdatedAt(metadataWith(), 'project', 'proj-1', '2026-08-29T00:00:00.000Z');

    const result = await refreshFromCloud(local, metadata);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    expect(result.appData.projects).toEqual([{ id: 'proj-1', name: 'Home (renamed)', status: 'active' }]);
    expect(result.metadata.records.project['proj-1']?.lastKnownUpdatedAt).toBe('2026-08-30T01:00:00.000Z');
  });

  it('reports no change and leaves local data untouched when the cloud record matches what this device already knows', async () => {
    projectsRepo.listVisibleProjects.mockResolvedValue(ok([cloudProject()]));
    const local = localWith({ projects: [project] });
    const metadata = setRecordUpdatedAt(metadataWith(), 'project', 'proj-1', '2026-08-30T01:00:00.000Z');

    const result = await refreshFromCloud(local, metadata);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(false);
    expect(result.appData.projects).toEqual([project]);
  });

  it('never overwrites a record this device has unsynced local edits for (dirty) — pending local work is protected', async () => {
    projectsRepo.listVisibleProjects.mockResolvedValue(ok([cloudProject({ name: 'Cloud says something else' })]));
    const local = localWith({ projects: [{ ...project, name: 'My unsaved local edit' }] });
    let metadata = metadataWith();
    metadata = setRecordUpdatedAt(metadata, 'project', 'proj-1', '2026-08-29T00:00:00.000Z');
    metadata = markDirty(metadata, 'project', 'proj-1');

    const result = await refreshFromCloud(local, metadata);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(false);
    expect(result.appData.projects).toEqual([{ id: 'proj-1', name: 'My unsaved local edit', status: 'active' }]);
    // The dirty record's last-known-updatedAt baseline is also left alone —
    // the drain engine's own guarded update owns advancing that once it
    // actually confirms a write, not a refresh that skipped the record.
    expect(result.metadata.records.project['proj-1']?.lastKnownUpdatedAt).toBe('2026-08-29T00:00:00.000Z');
  });

  it('with acceptConflicts, still protects a merely-pending dirty record whose baseline matches the cloud (nothing to resolve)', async () => {
    projectsRepo.listVisibleProjects.mockResolvedValue(ok([cloudProject()]));
    const local = localWith({ projects: [{ ...project, name: 'My unsaved local edit' }] });
    let metadata = metadataWith();
    metadata = setRecordUpdatedAt(metadata, 'project', 'proj-1', '2026-08-30T01:00:00.000Z');
    metadata = markDirty(metadata, 'project', 'proj-1');

    const result = await refreshFromCloud(local, metadata, true);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(false);
    expect(result.appData.projects).toEqual([{ id: 'proj-1', name: 'My unsaved local edit', status: 'active' }]);
  });

  it('with acceptConflicts, resolves a dirty record stuck in conflict by accepting the server version and clearing dirty', async () => {
    projectsRepo.listVisibleProjects.mockResolvedValue(ok([cloudProject({ name: 'Cloud says something else' })]));
    const local = localWith({ projects: [{ ...project, name: 'My stuck local edit' }] });
    let metadata = metadataWith();
    metadata = setRecordUpdatedAt(metadata, 'project', 'proj-1', '2026-08-29T00:00:00.000Z');
    metadata = markDirty(metadata, 'project', 'proj-1');

    const result = await refreshFromCloud(local, metadata, true);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    expect(result.appData.projects).toEqual([{ id: 'proj-1', name: 'Cloud says something else', status: 'active' }]);
    expect(result.metadata.records.project['proj-1']?.lastKnownUpdatedAt).toBe('2026-08-30T01:00:00.000Z');
    expect(result.metadata.dirty.project).toEqual([]);
  });

  it('with acceptConflicts, resolves a dirty record that was never synced (no baseline) but now also exists in the cloud under the same id', async () => {
    projectsRepo.listVisibleProjects.mockResolvedValue(ok([cloudProject({ name: 'Created on another device' })]));
    const local = localWith({ projects: [{ ...project, name: 'Created on this device' }] });
    const metadata = markDirty(metadataWith(), 'project', 'proj-1');

    const result = await refreshFromCloud(local, metadata, true);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    expect(result.appData.projects).toEqual([{ id: 'proj-1', name: 'Created on another device', status: 'active' }]);
    expect(result.metadata.dirty.project).toEqual([]);
  });

  it('never deletes a local record that is missing from a fresh cloud read (no tombstones)', async () => {
    projectsRepo.listVisibleProjects.mockResolvedValue(ok([]));
    const local = localWith({ projects: [project] });
    const metadata = setRecordUpdatedAt(metadataWith(), 'project', 'proj-1', '2026-08-30T01:00:00.000Z');

    const result = await refreshFromCloud(local, metadata);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(false);
    expect(result.appData.projects).toEqual([project]);
  });

  it('returns a typed failure instead of throwing when a cloud read fails, without mutating local data', async () => {
    projectsRepo.listVisibleProjects.mockResolvedValue(err());
    const local = localWith({ projects: [project] });

    const result = await refreshFromCloud(local, metadataWith());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe('Network request failed.');
  });

  it('pulls down a Goal that changed in the cloud, same as any other entity', async () => {
    projectsRepo.listVisibleProjects.mockResolvedValue(ok([]));
    goalsRepo.listGoals.mockResolvedValue(ok([cloudGoal({ name: 'Ship it (renamed)' })]));
    const local = localWith({ goals: [goal] });
    const metadata = setRecordUpdatedAt(metadataWith(), 'goal', 'goal-1', '2026-08-29T00:00:00.000Z');

    const result = await refreshFromCloud(local, metadata);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    expect(result.appData.goals).toEqual([{ ...goal, name: 'Ship it (renamed)' }]);
    expect(result.metadata.records.goal['goal-1']?.lastKnownUpdatedAt).toBe('2026-08-30T01:00:00.000Z');
  });

  it('never overwrites a Goal this device has an unsynced local edit for', async () => {
    projectsRepo.listVisibleProjects.mockResolvedValue(ok([]));
    goalsRepo.listGoals.mockResolvedValue(ok([cloudGoal({ name: 'Cloud says something else' })]));
    const local = localWith({ goals: [{ ...goal, name: 'My unsaved local edit' }] });
    let metadata = metadataWith();
    metadata = setRecordUpdatedAt(metadata, 'goal', 'goal-1', '2026-08-29T00:00:00.000Z');
    metadata = markDirty(metadata, 'goal', 'goal-1');

    const result = await refreshFromCloud(local, metadata);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.appData.goals).toEqual([{ ...goal, name: 'My unsaved local edit' }]);
  });

  it('a goals/targets read failure is surfaced the same way as any other entity failure', async () => {
    goalsRepo.listGoals.mockResolvedValue(err());
    const local = localWith();

    const result = await refreshFromCloud(local, metadataWith());

    expect(result.ok).toBe(false);
  });
});

describe('refreshFromCloud — Quick Notes read in isolation from the other four entities', () => {
  it('still refreshes projects/goals when Quick Notes alone fails to read, and reports quickNotesError', async () => {
    projectsRepo.listVisibleProjects.mockResolvedValue(ok([cloudProject({ name: 'Home (renamed)' })]));
    goalsRepo.listGoals.mockResolvedValue(ok([cloudGoal({ name: 'Ship it (renamed)' })]));
    quickNotesRepo.listQuickNotes.mockResolvedValue({ ok: false, error: { type: 'database', message: 'table missing' } });
    const local = localWith({ projects: [project], goals: [goal] });
    let metadata = metadataWith();
    metadata = setRecordUpdatedAt(metadata, 'project', 'proj-1', '2026-08-29T00:00:00.000Z');
    metadata = setRecordUpdatedAt(metadata, 'goal', 'goal-1', '2026-08-29T00:00:00.000Z');

    const result = await refreshFromCloud(local, metadata);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    expect(result.appData.projects).toEqual([{ id: 'proj-1', name: 'Home (renamed)', status: 'active' }]);
    expect(result.appData.goals).toEqual([{ ...goal, name: 'Ship it (renamed)' }]);
    expect(result.quickNotesError).toBe('table missing');
  });

  it("leaves this device's local Quick Notes exactly as they were when the cloud read fails", async () => {
    const localNote = { id: 'n1', text: 'Only on this device', completed: false, deleted: false, createdAt: 'ts' };
    quickNotesRepo.listQuickNotes.mockResolvedValue({ ok: false, error: { type: 'database', message: 'table missing' } });
    const local = localWith({ quickNotes: [localNote] });

    const result = await refreshFromCloud(local, metadataWith());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.appData.quickNotes).toEqual([localNote]);
    expect(result.quickNotesError).toBe('table missing');
  });

  it('a failing Quick Notes read never fails the whole refresh on its own', async () => {
    projectsRepo.listVisibleProjects.mockResolvedValue(ok([]));
    quickNotesRepo.listQuickNotes.mockResolvedValue({ ok: false, error: { type: 'database', message: 'table missing' } });

    const result = await refreshFromCloud(localWith(), metadataWith());

    expect(result.ok).toBe(true);
  });

  it('reports no quickNotesError once Quick Notes reads successfully again', async () => {
    projectsRepo.listVisibleProjects.mockResolvedValue(ok([]));
    quickNotesRepo.listQuickNotes.mockResolvedValue(ok([]));

    const result = await refreshFromCloud(localWith(), metadataWith());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quickNotesError).toBeUndefined();
  });

  it('a projects/tasks/goals/targets failure remains a hard failure even when Quick Notes succeeds', async () => {
    projectsRepo.listVisibleProjects.mockResolvedValue(err());
    quickNotesRepo.listQuickNotes.mockResolvedValue(ok([]));

    const result = await refreshFromCloud(localWith(), metadataWith());

    expect(result.ok).toBe(false);
  });
});

describe('refreshFromCloud — shared record reconciliation (revocation)', () => {
  const sharedProject: Project = { id: 'shared-proj-1', name: 'Marketing launch', status: 'active', ownerId: 'owner-x' };

  it('removes a locally cached shared Project no longer returned by a fresh visible read', async () => {
    projectsRepo.listVisibleProjects.mockResolvedValue(ok([]));
    const local = localWith({ projects: [sharedProject] });
    const metadata = setRecordUpdatedAt(metadataWith(), 'project', sharedProject.id, '2026-08-30T01:00:00.000Z');

    const result = await refreshFromCloud(local, metadata);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    expect(result.appData.projects).toEqual([]);
    expect(result.metadata.records.project[sharedProject.id]).toBeUndefined();
  });

  it('removes a shared Task belonging to a removed shared Project (cascade), even though the Task itself is not in the stale local cache\'s known-missing set', async () => {
    const task1 = sharedTask({ id: 'shared-task-1', projectId: sharedProject.id, ownerId: sharedProject.ownerId });
    projectsRepo.listVisibleProjects.mockResolvedValue(ok([]));
    tasksRepo.listVisibleTasks.mockResolvedValue(ok([]));
    const local = localWith({ projects: [sharedProject], tasks: [task1] });
    let metadata = setRecordUpdatedAt(metadataWith(), 'project', sharedProject.id, 'ts');
    metadata = setRecordUpdatedAt(metadata, 'task', task1.id, 'ts');

    const result = await refreshFromCloud(local, metadata);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.appData.projects).toEqual([]);
    expect(result.appData.tasks).toEqual([]);
    expect(result.metadata.records.task[task1.id]).toBeUndefined();
  });

  it('removes a shared Task directly (revoked or deleted) while its Project remains visible', async () => {
    const stillVisibleTask = sharedTask({ id: 'still-here', projectId: sharedProject.id, ownerId: sharedProject.ownerId });
    const removedTask = sharedTask({ id: 'removed-one', projectId: sharedProject.id, ownerId: sharedProject.ownerId });
    projectsRepo.listVisibleProjects.mockResolvedValue(ok([cloudProject({ ...sharedProject, updatedAt: 'ts' })]));
    tasksRepo.listVisibleTasks.mockResolvedValue(ok([cloudTask(stillVisibleTask)]));
    const local = localWith({ projects: [sharedProject], tasks: [stillVisibleTask, removedTask] });
    let metadata = setRecordUpdatedAt(metadataWith(), 'project', sharedProject.id, 'ts');
    metadata = setRecordUpdatedAt(metadata, 'task', stillVisibleTask.id, 'ts');
    metadata = setRecordUpdatedAt(metadata, 'task', removedTask.id, 'ts');

    const result = await refreshFromCloud(local, metadata);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.appData.tasks.map((t) => t.id)).toEqual([stillVisibleTask.id]);
    expect(result.metadata.records.task[removedTask.id]).toBeUndefined();
    expect(result.metadata.records.task[stillVisibleTask.id]).toBeDefined();
  });

  it('never removes an owned Project or Task via this reconciliation, even when ownerId equals the authenticated account', async () => {
    const ownedProject: Project = { ...project, ownerId: 'user-1' };
    projectsRepo.listVisibleProjects.mockResolvedValue(ok([])); // simulates a transient/incomplete read, not a real absence
    const local = localWith({ projects: [ownedProject] });
    const metadata = setRecordUpdatedAt(metadataWith(), 'project', ownedProject.id, 'ts');

    const result = await refreshFromCloud(local, metadata);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.appData.projects).toEqual([ownedProject]);
    expect(result.metadata.records.project[ownedProject.id]).toBeDefined();
  });

  it('never removes an owned Project/Task when ownerId was never set at all (legacy local data)', async () => {
    // `project` (module-level fixture) has no ownerId — the existing
    // "never deletes a local record missing from a fresh cloud read" test
    // above already covers this; this asserts the same guarantee explicitly
    // under the new reconciliation logic, not just the untouched refreshEntity path.
    projectsRepo.listVisibleProjects.mockResolvedValue(ok([]));
    const local = localWith({ projects: [project] });
    const metadata = setRecordUpdatedAt(metadataWith(), 'project', project.id, 'ts');

    const result = await refreshFromCloud(local, metadata);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.appData.projects).toEqual([project]);
  });

  it('never removes any record when the visible-projects read fails', async () => {
    projectsRepo.listVisibleProjects.mockResolvedValue(err());
    const local = localWith({ projects: [sharedProject] });

    const result = await refreshFromCloud(local, metadataWith());

    expect(result.ok).toBe(false);
    // Caller only ever dispatches APPLY_REMOTE_UPDATE from a successful
    // result's appData — an `ok: false` result carries no appData at all,
    // so nothing can be removed off the back of this failed read.
  });

  it('never removes any record when the visible-tasks read fails', async () => {
    projectsRepo.listVisibleProjects.mockResolvedValue(ok([cloudProject({ ...sharedProject, updatedAt: 'ts' })]));
    tasksRepo.listVisibleTasks.mockResolvedValue(err());
    const local = localWith({ projects: [sharedProject], tasks: [sharedTask()] });

    const result = await refreshFromCloud(local, metadataWith());

    expect(result.ok).toBe(false);
  });

  it('clears a removed shared Project\'s dirty marker along with its baseline (an edit pending against now-revoked access is never left stuck)', async () => {
    projectsRepo.listVisibleProjects.mockResolvedValue(ok([]));
    const local = localWith({ projects: [sharedProject] });
    let metadata = setRecordUpdatedAt(metadataWith(), 'project', sharedProject.id, 'ts');
    metadata = markDirty(metadata, 'project', sharedProject.id);

    const result = await refreshFromCloud(local, metadata);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.appData.projects).toEqual([]);
    expect(result.metadata.dirty.project).toEqual([]);
    expect(result.metadata.records.project[sharedProject.id]).toBeUndefined();
  });

  it('clears a cascade-removed shared Task\'s dirty marker along with its baseline', async () => {
    const task1 = sharedTask({ id: 'shared-task-1', projectId: sharedProject.id, ownerId: sharedProject.ownerId });
    projectsRepo.listVisibleProjects.mockResolvedValue(ok([]));
    tasksRepo.listVisibleTasks.mockResolvedValue(ok([]));
    const local = localWith({ projects: [sharedProject], tasks: [task1] });
    let metadata = setRecordUpdatedAt(metadataWith(), 'project', sharedProject.id, 'ts');
    metadata = setRecordUpdatedAt(metadata, 'task', task1.id, 'ts');
    metadata = markDirty(metadata, 'task', task1.id);

    const result = await refreshFromCloud(local, metadata);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.metadata.dirty.task).toEqual([]);
    expect(result.metadata.records.task[task1.id]).toBeUndefined();
  });
});
