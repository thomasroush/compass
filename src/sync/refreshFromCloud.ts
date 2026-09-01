import { listDailyNotes } from '../repository/dailyNotesRepository';
import { listProjects } from '../repository/projectsRepository';
import { listTasks } from '../repository/tasksRepository';
import type { RepositoryResult } from '../repository/types';
import type { AppData, DailyNote, Project, Task } from '../types';
import {
  getRecordUpdatedAt,
  setRecordUpdatedAt,
  type AccountSyncMetadata,
  type SyncEntity,
} from './metadata';

/**
 * The "returning device" half of cross-device sync: for an *already linked*
 * device with no durable pending work, pulls down whatever changed in the
 * cloud since this device last saw it — the counterpart to
 * `src/sync/drainSync.ts`, which pushes local changes up.
 *
 * Never touches a record this device has unsynced local edits for (`dirty`)
 * — refreshing a dirty record here would silently discard those edits
 * (exactly what "do not silently replace valid local data" rules out).
 * Skipping it here is deliberate and sufficient: once that record is
 * eventually drained (cleared), a later refresh naturally picks up whatever
 * the cloud holds by then. If the cloud version *also* changed in the
 * meantime, the drain loop's own guarded update will detect that as a typed
 * `'conflict'` when it runs — this module does not need its own conflict
 * detection to satisfy "report a conflict rather than silently picking a
 * side," it simply never creates the silent-overwrite scenario in the first
 * place by leaving dirty records alone.
 *
 * Never deletes a local record that is missing from the cloud list — this
 * app has no per-record deletion or tombstone concept (decision 8); a
 * record absent from a fresh `listX` read is left exactly as it is locally.
 */

export interface RefreshOutcome {
  ok: true;
  /** True if any record actually changed — the caller should dispatch APPLY_REMOTE_UPDATE only then. */
  changed: boolean;
  appData: AppData;
  metadata: AccountSyncMetadata;
}

export type RefreshFailure = { ok: false; message: string };

function refreshEntity<T extends { id: string }, C extends T & { updatedAt: string }>(
  entity: SyncEntity,
  localRecords: T[],
  cloudRecords: C[],
  metadata: AccountSyncMetadata,
  dirtyIds: string[],
): { records: T[]; metadata: AccountSyncMetadata; changed: boolean } {
  let changed = false;
  let nextMetadata = metadata;
  const localById = new Map(localRecords.map((r) => [r.id, r]));

  for (const cloudRecord of cloudRecords) {
    if (dirtyIds.includes(cloudRecord.id)) continue; // protect pending local work

    const knownUpdatedAt = getRecordUpdatedAt(metadata, entity, cloudRecord.id);
    if (knownUpdatedAt === cloudRecord.updatedAt) continue; // already current

    const { updatedAt, ...content } = cloudRecord;
    void updatedAt;
    localById.set(cloudRecord.id, content as unknown as T);
    nextMetadata = setRecordUpdatedAt(nextMetadata, entity, cloudRecord.id, cloudRecord.updatedAt);
    changed = true;
  }

  return { records: Array.from(localById.values()), metadata: nextMetadata, changed };
}

export async function refreshFromCloud(
  local: AppData,
  metadata: AccountSyncMetadata,
): Promise<RefreshOutcome | RefreshFailure> {
  const [projectsResult, tasksResult, notesResult] = await Promise.all([
    listProjects(),
    listTasks(),
    listDailyNotes(),
  ]);

  const failed = [projectsResult, tasksResult, notesResult].find(
    (r): r is RepositoryResult<never> & { ok: false } => !r.ok,
  );
  if (failed) {
    return { ok: false, message: failed.error.message };
  }
  // Narrowed by the check above, but TS doesn't carry that through the array find.
  if (!projectsResult.ok || !tasksResult.ok || !notesResult.ok) {
    return { ok: false, message: 'Could not read your account data.' };
  }

  const projects = refreshEntity<Project, (typeof projectsResult.data)[number]>(
    'project',
    local.projects,
    projectsResult.data,
    metadata,
    metadata.dirty.project,
  );
  const tasks = refreshEntity<Task, (typeof tasksResult.data)[number]>(
    'task',
    local.tasks,
    tasksResult.data,
    projects.metadata,
    metadata.dirty.task,
  );
  const dailyNotes = refreshEntity<DailyNote, (typeof notesResult.data)[number]>(
    'dailyNote',
    local.dailyNotes,
    notesResult.data,
    tasks.metadata,
    metadata.dirty.dailyNote,
  );

  return {
    ok: true,
    changed: projects.changed || tasks.changed || dailyNotes.changed,
    appData: { ...local, projects: projects.records, tasks: tasks.records, dailyNotes: dailyNotes.records },
    metadata: dailyNotes.metadata,
  };
}
