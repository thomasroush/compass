import { listQuickNotes } from '../repository/quickNotesRepository';
import { listGoals } from '../repository/goalsRepository';
import { listVisibleProjects } from '../repository/projectsRepository';
import { listTargets } from '../repository/targetsRepository';
import { listVisibleTasks } from '../repository/tasksRepository';
import type { RepositoryResult } from '../repository/types';
import type { AppData, QuickNote, Goal, Project, Target, Task } from '../types';
import {
  clearDirty,
  forgetRecord,
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
 * By default, never touches a record this device has unsynced local edits
 * for (`dirty`) — refreshing a dirty record here would silently discard
 * those edits (exactly what "do not silently replace valid local data" rules
 * out). Skipping it here is deliberate and sufficient for the automatic
 * (sign-in) refresh: once that record is eventually drained (cleared), a
 * later refresh naturally picks up whatever the cloud holds by then. If the
 * cloud version *also* changed in the meantime, the drain loop's own guarded
 * update will detect that as a typed `'conflict'` when it runs.
 *
 * `acceptConflicts` (only ever passed `true` by the user-initiated "Refresh
 * from cloud" action, never by the automatic sign-in refresh) opts a dirty
 * record into resolution instead of protection, but only when the cloud's
 * `updatedAt` no longer matches this device's known baseline for it — i.e.
 * only a record that is actually stuck in conflict (the drain loop's guarded
 * update can never succeed against a stale baseline). A dirty record whose
 * baseline still matches the cloud is merely pending, not conflicted, and is
 * still left alone for the normal drain loop to push. This is the explicit,
 * user-requested counterpart to "report a conflict rather than silently
 * picking a side" — it silently picks the server's side only when the user
 * asked it to.
 *
 * Never deletes a local *owned* record that is missing from the cloud list —
 * this app has no per-record deletion or tombstone concept (decision 8) for
 * an account's own data; a record absent from a fresh `listX` read is left
 * exactly as it is locally.
 *
 * A *shared* record (Task/Project whose `ownerId` is a different, valid
 * account than this one — see `isSharedRecord` below) is the deliberate
 * exception: it is never this account's own data to begin with, only ever a
 * view onto someone else's, granted through `project_members`. When that
 * membership is revoked, the row simply stops being returned by
 * `listVisibleProjects`/`listVisibleTasks` — RLS enforces this the same way
 * it enforces every other access rule in this app — and this function
 * reconciles this device's local cache to match: a previously-visible shared
 * Project or Task that is now missing is removed from local `AppData`, any
 * Task belonging to a removed shared Project is removed with it, and each
 * removed id's sync metadata (baseline + dirty flag) is forgotten via
 * `forgetRecord` so nothing can later try to push, pull, or resurrect it.
 * This applies whether or not the record happened to be dirty — an edit
 * pending against now-revoked access can never be pushed regardless, so
 * there is nothing left to protect by keeping it. It never applies to an
 * owned record, and never runs at all unless the projects/tasks reads both
 * succeeded (see the early failure return below) — a failed, partial, or
 * unauthenticated read leaves every local record, owned or shared, exactly
 * as it was.
 */

export interface RefreshOutcome {
  ok: true;
  /** True if any record actually changed — the caller should dispatch APPLY_REMOTE_UPDATE only then. */
  changed: boolean;
  appData: AppData;
  metadata: AccountSyncMetadata;
  /**
   * Set when Quick Notes specifically could not be read, even though the
   * refresh otherwise succeeded. A Quick Notes outage must never fail the
   * whole refresh — see this module's doc comment and hydrateFromCloud.ts's
   * matching `quickNotesError` field. Local Quick Notes are left exactly as
   * they were when this happens.
   */
  quickNotesError?: string;
}

export type RefreshFailure = { ok: false; message: string };

function refreshEntity<T extends { id: string }, C extends T & { updatedAt: string }>(
  entity: SyncEntity,
  localRecords: T[],
  cloudRecords: C[],
  metadata: AccountSyncMetadata,
  dirtyIds: string[],
  acceptConflicts: boolean,
): { records: T[]; metadata: AccountSyncMetadata; changed: boolean } {
  let changed = false;
  let nextMetadata = metadata;
  const localById = new Map(localRecords.map((r) => [r.id, r]));

  for (const cloudRecord of cloudRecords) {
    const knownUpdatedAt = getRecordUpdatedAt(metadata, entity, cloudRecord.id);
    const isDirty = dirtyIds.includes(cloudRecord.id);

    if (isDirty) {
      if (!acceptConflicts) continue; // protect pending local work
      if (knownUpdatedAt === cloudRecord.updatedAt) continue; // not actually conflicted — still just pending
    } else if (knownUpdatedAt === cloudRecord.updatedAt) {
      continue; // already current
    }

    const { updatedAt, ...content } = cloudRecord;
    void updatedAt;
    localById.set(cloudRecord.id, content as unknown as T);
    nextMetadata = setRecordUpdatedAt(nextMetadata, entity, cloudRecord.id, cloudRecord.updatedAt);
    if (isDirty) nextMetadata = clearDirty(nextMetadata, entity, cloudRecord.id);
    changed = true;
  }

  return { records: Array.from(localById.values()), metadata: nextMetadata, changed };
}

/**
 * True for a Project/Task this account can see only through shared-Project
 * membership — a real, different, known owner, never this account's own
 * legacy/private data. `ownerId === undefined` (an older local record that
 * predates `ownerId`, or one that has simply never round-tripped through
 * `listVisibleProjects`/`listVisibleTasks`) is deliberately treated as
 * *owned*, not shared — the existing, safe default this app has always used
 * for a record with no other owner information.
 */
function isSharedRecord(ownerId: string | undefined, accountId: string): boolean {
  return ownerId !== undefined && ownerId !== accountId;
}

/**
 * Removes locally cached shared Projects/Tasks that a fresh visible read no
 * longer returns (access revoked), cascading a removed shared Project's own
 * Tasks along with it, and forgets each removed id's sync metadata so
 * nothing can later try to push, pull, or resurrect it. Applies only to
 * `isSharedRecord` rows — an owned record is never touched here, regardless
 * of whether it happens to be missing from the (unrelated to it) shared
 * membership set. See this module's top doc comment for the full rationale.
 */
function reconcileSharedRemovals(
  accountId: string,
  projectRecords: Project[],
  taskRecords: Task[],
  visibleProjectIds: ReadonlySet<string>,
  visibleTaskIds: ReadonlySet<string>,
  metadata: AccountSyncMetadata,
): { projects: Project[]; tasks: Task[]; metadata: AccountSyncMetadata; changed: boolean } {
  const removedProjectIds = new Set(
    projectRecords
      .filter((p) => isSharedRecord(p.ownerId, accountId) && !visibleProjectIds.has(p.id))
      .map((p) => p.id),
  );

  const removedTaskIds = new Set(
    taskRecords
      .filter(
        (t) =>
          (isSharedRecord(t.ownerId, accountId) && !visibleTaskIds.has(t.id)) ||
          (t.projectId !== undefined && removedProjectIds.has(t.projectId)),
      )
      .map((t) => t.id),
  );

  if (removedProjectIds.size === 0 && removedTaskIds.size === 0) {
    return { projects: projectRecords, tasks: taskRecords, metadata, changed: false };
  }

  let nextMetadata = metadata;
  for (const id of removedProjectIds) nextMetadata = forgetRecord(nextMetadata, 'project', id);
  for (const id of removedTaskIds) nextMetadata = forgetRecord(nextMetadata, 'task', id);

  return {
    projects: projectRecords.filter((p) => !removedProjectIds.has(p.id)),
    tasks: taskRecords.filter((t) => !removedTaskIds.has(t.id)),
    metadata: nextMetadata,
    changed: true,
  };
}

export async function refreshFromCloud(
  local: AppData,
  metadata: AccountSyncMetadata,
  acceptConflicts = false,
): Promise<RefreshOutcome | RefreshFailure> {
  // Quick Notes is read independently of the other four entities — a Quick
  // Notes-specific outage must never fail this whole refresh (which would
  // otherwise silently stop projects/tasks/goals/targets from ever pulling
  // down changes made on another device, for as long as the outage lasts).
  // Failures in the other four remain hard failures, exactly as before.
  //
  // listVisibleProjects/listVisibleTasks (not listProjects/listTasks): reads
  // both this account's own rows and any shared Project/Task granted through
  // accepted membership, with RLS as the sole boundary — see
  // supabase/migrations/20260916120000_add_shared_project_membership.sql and
  // reconcileSharedRemovals below. Goals/Targets/Quick Notes are unaffected —
  // still the owner-only reads they have always been, so this account can
  // never see another account's Goals, Targets, or Quick Notes.
  const [projectsResult, tasksResult, goalsResult, targetsResult, notesResult] = await Promise.all([
    listVisibleProjects(),
    listVisibleTasks(),
    listGoals(),
    listTargets(),
    listQuickNotes(),
  ]);

  const failed = [projectsResult, tasksResult, goalsResult, targetsResult].find(
    (r): r is RepositoryResult<never> & { ok: false } => !r.ok,
  );
  if (failed) {
    return { ok: false, message: failed.error.message };
  }
  // Narrowed by the check above, but TS doesn't carry that through the array find.
  if (!projectsResult.ok || !tasksResult.ok || !goalsResult.ok || !targetsResult.ok) {
    return { ok: false, message: 'Could not read your account data.' };
  }

  const projects = refreshEntity<Project, (typeof projectsResult.data)[number]>(
    'project',
    local.projects,
    projectsResult.data,
    metadata,
    metadata.dirty.project,
    acceptConflicts,
  );
  const tasks = refreshEntity<Task, (typeof tasksResult.data)[number]>(
    'task',
    local.tasks,
    tasksResult.data,
    projects.metadata,
    metadata.dirty.task,
    acceptConflicts,
  );

  // Reconciliation only ever runs here, past both the early failure return
  // above and refreshEntity's own add/update pass — never on a failed,
  // partial, or unauthenticated read, and never before this account's own
  // dirty-protection logic has already had its say for still-visible
  // records.
  const reconciled = reconcileSharedRemovals(
    metadata.accountId,
    projects.records,
    tasks.records,
    new Set(projectsResult.data.map((p) => p.id)),
    new Set(tasksResult.data.map((t) => t.id)),
    tasks.metadata,
  );

  const goals = refreshEntity<Goal, (typeof goalsResult.data)[number]>(
    'goal',
    local.goals,
    goalsResult.data,
    reconciled.metadata,
    metadata.dirty.goal,
    acceptConflicts,
  );
  const targets = refreshEntity<Target, (typeof targetsResult.data)[number]>(
    'target',
    local.targets,
    targetsResult.data,
    goals.metadata,
    metadata.dirty.target,
    acceptConflicts,
  );

  // Only refreshed when the read actually succeeded — on failure, Quick
  // Notes are left exactly as they are locally (not cleared, not touched),
  // and the failure is reported via `quickNotesError` rather than aborting
  // the projects/tasks/goals/targets refresh above.
  const quickNotes = notesResult.ok
    ? refreshEntity<QuickNote, (typeof notesResult.data)[number]>(
        'quickNote',
        local.quickNotes,
        notesResult.data,
        targets.metadata,
        metadata.dirty.quickNote,
        acceptConflicts,
      )
    : { records: local.quickNotes, metadata: targets.metadata, changed: false };

  return {
    ok: true,
    changed:
      projects.changed ||
      tasks.changed ||
      reconciled.changed ||
      goals.changed ||
      targets.changed ||
      quickNotes.changed,
    appData: {
      ...local,
      projects: reconciled.projects,
      tasks: reconciled.tasks,
      quickNotes: quickNotes.records,
      goals: goals.records,
      targets: targets.records,
    },
    metadata: quickNotes.metadata,
    quickNotesError: notesResult.ok ? undefined : notesResult.error.message,
  };
}
