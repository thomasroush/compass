import { describe, it, expect, vi, beforeEach } from 'vitest';
import { refreshFromCloud } from './refreshFromCloud';
import { createEmptyAccountMetadata, markDirty, setRecordUpdatedAt, type AccountSyncMetadata } from './metadata';
import { createEmptyAppData, type AppData, type Project } from '../types';
import type { CloudProject, RepositoryResult } from '../repository/types';

const projectsRepo = vi.hoisted(() => ({ listProjects: vi.fn() }));
const tasksRepo = vi.hoisted(() => ({ listTasks: vi.fn() }));
const dailyNotesRepo = vi.hoisted(() => ({ listDailyNotes: vi.fn() }));

vi.mock('../repository/projectsRepository', () => projectsRepo);
vi.mock('../repository/tasksRepository', () => tasksRepo);
vi.mock('../repository/dailyNotesRepository', () => dailyNotesRepo);

function ok<T>(data: T): RepositoryResult<T> {
  return { ok: true, data };
}
function err(): RepositoryResult<never> {
  return { ok: false, error: { type: 'database', message: 'Network request failed.' } };
}

const project: Project = { id: 'proj-1', name: 'Home', status: 'active' };

function cloudProject(overrides: Partial<CloudProject> = {}): CloudProject {
  return { ...project, updatedAt: '2026-08-30T01:00:00.000Z', ...overrides };
}

function metadataWith(overrides: Partial<AccountSyncMetadata> = {}): AccountSyncMetadata {
  return { ...createEmptyAccountMetadata('user-1'), established: true, ...overrides };
}

function localWith(overrides: Partial<AppData> = {}): AppData {
  return { ...createEmptyAppData(), ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  tasksRepo.listTasks.mockResolvedValue(ok([]));
  dailyNotesRepo.listDailyNotes.mockResolvedValue(ok([]));
});

describe('refreshFromCloud — returning-device pull', () => {
  it('pulls down a record that changed in the cloud since this device last saw it (Device A write -> Device B startup load)', async () => {
    projectsRepo.listProjects.mockResolvedValue(ok([cloudProject({ name: 'Home (renamed)' })]));
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
    projectsRepo.listProjects.mockResolvedValue(ok([cloudProject()]));
    const local = localWith({ projects: [project] });
    const metadata = setRecordUpdatedAt(metadataWith(), 'project', 'proj-1', '2026-08-30T01:00:00.000Z');

    const result = await refreshFromCloud(local, metadata);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(false);
    expect(result.appData.projects).toEqual([project]);
  });

  it('never overwrites a record this device has unsynced local edits for (dirty) — pending local work is protected', async () => {
    projectsRepo.listProjects.mockResolvedValue(ok([cloudProject({ name: 'Cloud says something else' })]));
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
    projectsRepo.listProjects.mockResolvedValue(ok([cloudProject()]));
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
    projectsRepo.listProjects.mockResolvedValue(ok([cloudProject({ name: 'Cloud says something else' })]));
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
    projectsRepo.listProjects.mockResolvedValue(ok([cloudProject({ name: 'Created on another device' })]));
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
    projectsRepo.listProjects.mockResolvedValue(ok([]));
    const local = localWith({ projects: [project] });
    const metadata = setRecordUpdatedAt(metadataWith(), 'project', 'proj-1', '2026-08-30T01:00:00.000Z');

    const result = await refreshFromCloud(local, metadata);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(false);
    expect(result.appData.projects).toEqual([project]);
  });

  it('returns a typed failure instead of throwing when a cloud read fails, without mutating local data', async () => {
    projectsRepo.listProjects.mockResolvedValue(err());
    const local = localWith({ projects: [project] });

    const result = await refreshFromCloud(local, metadataWith());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe('Network request failed.');
  });
});
