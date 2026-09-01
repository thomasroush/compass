import { createDailyNote, listDailyNotes, updateDailyNoteGuarded } from '../repository/dailyNotesRepository';
import { createProject, listProjects, updateProjectGuarded } from '../repository/projectsRepository';
import { createTask, listTasks, updateTaskGuarded } from '../repository/tasksRepository';
import type { CloudDailyNote, CloudProject, CloudTask } from '../repository/types';
import type { AppData, DailyNote, Project, Task } from '../types';
import { markDirty, type AccountSyncMetadata, type SyncEntity } from './metadata';

/**
 * Phase 5B3C's interactive linking UI, for `decideHydration`'s
 * `'require-explicit-choice'` case (both local and cloud have data, and this
 * device has never linked to this account) — per decision 15, exactly the
 * three named, whole-device outcomes below, and never an unconditional
 * overwrite of a cloud record whose value differs from local.
 */

export interface CloudBundle {
  projects: CloudProject[];
  tasks: CloudTask[];
  dailyNotes: CloudDailyNote[];
}

export interface LinkingComparison {
  localOnly: Record<SyncEntity, string[]>;
  cloudOnly: Record<SyncEntity, string[]>;
  differing: Record<SyncEntity, string[]>;
  /** True only when there is no local-only, cloud-only, or differing id anywhere — "They match" may be offered only then. */
  identical: boolean;
}

function stripUpdatedAt<T>(record: T & { updatedAt: string }): T {
  const { updatedAt, ...rest } = record;
  void updatedAt;
  return rest as T;
}

function compareEntity<T extends { id: string }>(
  localRecords: T[],
  cloudRecords: (T & { updatedAt: string })[],
): { localOnly: string[]; cloudOnly: string[]; differing: string[] } {
  const localById = new Map(localRecords.map((r) => [r.id, r]));
  const cloudById = new Map(cloudRecords.map((r) => [r.id, r]));

  const localOnly = localRecords.filter((r) => !cloudById.has(r.id)).map((r) => r.id);
  const cloudOnly = cloudRecords.filter((r) => !localById.has(r.id)).map((r) => r.id);
  const differing = localRecords
    .filter((r) => {
      const cloud = cloudById.get(r.id);
      if (!cloud) return false;
      return JSON.stringify(r) !== JSON.stringify(stripUpdatedAt(cloud));
    })
    .map((r) => r.id);

  return { localOnly, cloudOnly, differing };
}

export type CloudBundleResult = { ok: true; data: CloudBundle } | { ok: false; message: string };

/** The only place this module reads from Supabase — components call this instead of the repository directly (per AGENTS.md). */
export async function loadCloudBundle(): Promise<CloudBundleResult> {
  const [projects, tasks, dailyNotes] = await Promise.all([listProjects(), listTasks(), listDailyNotes()]);
  if (!projects.ok) return { ok: false, message: projects.error.message };
  if (!tasks.ok) return { ok: false, message: tasks.error.message };
  if (!dailyNotes.ok) return { ok: false, message: dailyNotes.error.message };
  return { ok: true, data: { projects: projects.data, tasks: tasks.data, dailyNotes: dailyNotes.data } };
}

/** Pure — no I/O. Given local state and a freshly-read cloud bundle, classifies every record by id. */
export function compareForLinking(local: AppData, cloud: CloudBundle): LinkingComparison {
  const projects = compareEntity(local.projects, cloud.projects);
  const tasks = compareEntity(local.tasks, cloud.tasks);
  const dailyNotes = compareEntity(local.dailyNotes, cloud.dailyNotes);

  const identical =
    projects.localOnly.length === 0 &&
    projects.cloudOnly.length === 0 &&
    projects.differing.length === 0 &&
    tasks.localOnly.length === 0 &&
    tasks.cloudOnly.length === 0 &&
    tasks.differing.length === 0 &&
    dailyNotes.localOnly.length === 0 &&
    dailyNotes.cloudOnly.length === 0 &&
    dailyNotes.differing.length === 0;

  return {
    localOnly: { project: projects.localOnly, task: tasks.localOnly, dailyNote: dailyNotes.localOnly },
    cloudOnly: { project: projects.cloudOnly, task: tasks.cloudOnly, dailyNote: dailyNotes.cloudOnly },
    differing: { project: projects.differing, task: tasks.differing, dailyNote: dailyNotes.differing },
    identical,
  };
}

/**
 * "Use my account's data" — loads the cloud's own content wholesale, exactly
 * like an ordinary hydration. No cloud write. Local edits not reflected in
 * the cloud are discarded — the caller is responsible for the explicit
 * confirmation and export-first warning decision 15/11 call for; this
 * function only performs the already-confirmed action.
 */
export function buildUseCloudData(cloud: CloudBundle): AppData {
  return {
    version: 1,
    projects: cloud.projects.map(stripUpdatedAt),
    tasks: cloud.tasks.map(stripUpdatedAt),
    dailyNotes: cloud.dailyNotes.map(stripUpdatedAt),
  };
}

export interface KeepLocalOutcome {
  appData: AppData;
  metadata: AccountSyncMetadata;
  /** Ids that could not be written now and were left dirty for the normal drain engine to retry/resolve later — never silently dropped. */
  deferred: Record<SyncEntity, string[]>;
}

/**
 * "Keep this device's data" — per decision 15, every differing id is written
 * through the existing guarded (compare-and-swap) update, using the
 * `updatedAt` from *this same read* as the expected baseline, never a plain
 * unconditional upsert. A guarded-update or create failure here is not
 * retried inline: the id is simply left dirty, deferring to
 * `src/sync/drainSync.ts`'s already-tested create/guarded-update/duplicate
 * resolution the next time it runs (an unknown-baseline retry there
 * correctly re-derives whatever actually happened, including recognizing a
 * lost-success duplicate) rather than re-implementing that logic here.
 * Cloud-only records are pulled down, never deleted.
 */
export async function applyKeepLocalData(
  local: AppData,
  cloud: CloudBundle,
  comparison: LinkingComparison,
  metadata: AccountSyncMetadata,
  accountId: string,
): Promise<KeepLocalOutcome> {
  let nextMetadata = metadata;
  const deferred: Record<SyncEntity, string[]> = { project: [], task: [], dailyNote: [] };

  async function resolveDiffering<T extends { id: string }>(
    entity: SyncEntity,
    ids: string[],
    localRecords: T[],
    cloudRecords: (T & { updatedAt: string })[],
    guardedUpdate: (id: string, record: T, expectedUpdatedAt: string) => Promise<{ ok: boolean }>,
  ) {
    const cloudById = new Map(cloudRecords.map((r) => [r.id, r]));
    for (const id of ids) {
      const localRecord = localRecords.find((r) => r.id === id);
      const cloudRecord = cloudById.get(id);
      if (!localRecord || !cloudRecord) continue;
      const result = await guardedUpdate(id, localRecord, cloudRecord.updatedAt);
      if (!result.ok) {
        nextMetadata = markDirty(nextMetadata, entity, id);
        deferred[entity].push(id);
      }
    }
  }

  async function resolveLocalOnly<T extends { id: string }>(
    entity: SyncEntity,
    ids: string[],
    localRecords: T[],
    create: (record: T) => Promise<{ ok: boolean }>,
  ) {
    for (const id of ids) {
      const localRecord = localRecords.find((r) => r.id === id);
      if (!localRecord) continue;
      const result = await create(localRecord);
      if (!result.ok) {
        nextMetadata = markDirty(nextMetadata, entity, id);
        deferred[entity].push(id);
      }
    }
  }

  await resolveDiffering<Project>('project', comparison.differing.project, local.projects, cloud.projects, (id, r, ts) =>
    updateProjectGuarded(id, { name: r.name, description: r.description, status: r.status }, ts, accountId),
  );
  await resolveDiffering<Task>('task', comparison.differing.task, local.tasks, cloud.tasks, (id, r, ts) => {
    const { id: _id, createdAt: _createdAt, ...updates } = r as Task;
    void _id;
    void _createdAt;
    return updateTaskGuarded(id, updates, ts, accountId);
  });
  await resolveDiffering<DailyNote>('dailyNote', comparison.differing.dailyNote, local.dailyNotes, cloud.dailyNotes, (id, r, ts) =>
    updateDailyNoteGuarded(id, { morning: r.morning, evening: r.evening }, ts, accountId),
  );

  await resolveLocalOnly<Project>('project', comparison.localOnly.project, local.projects, (r) =>
    createProject(r, accountId),
  );
  await resolveLocalOnly<Task>('task', comparison.localOnly.task, local.tasks, (r) => createTask(r, accountId));
  await resolveLocalOnly<DailyNote>('dailyNote', comparison.localOnly.dailyNote, local.dailyNotes, (r) =>
    createDailyNote(r, accountId),
  );

  // Cloud-only records: pull down, never delete. Local records that were
  // written above keep their existing local content (the write only
  // affected the cloud copy) — nothing here changes local values.
  const pulledProjects = cloud.projects.filter((p) => comparison.cloudOnly.project.includes(p.id)).map(stripUpdatedAt);
  const pulledTasks = cloud.tasks.filter((t) => comparison.cloudOnly.task.includes(t.id)).map(stripUpdatedAt);
  const pulledNotes = cloud.dailyNotes
    .filter((n) => comparison.cloudOnly.dailyNote.includes(n.id))
    .map(stripUpdatedAt);

  const appData: AppData = {
    ...local,
    projects: [...local.projects, ...pulledProjects],
    tasks: [...local.tasks, ...pulledTasks],
    dailyNotes: [...local.dailyNotes, ...pulledNotes],
  };

  return { appData, metadata: nextMetadata, deferred };
}
