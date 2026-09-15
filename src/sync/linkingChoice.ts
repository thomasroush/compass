import { createQuickNote, listQuickNotes, updateQuickNoteGuarded } from '../repository/quickNotesRepository';
import { createGoal, listGoals, updateGoalGuarded } from '../repository/goalsRepository';
import { createProject, listProjects, updateProjectGuarded } from '../repository/projectsRepository';
import { createTarget, listTargets, updateTargetGuarded } from '../repository/targetsRepository';
import { createTask, listTasks, updateTaskGuarded } from '../repository/tasksRepository';
import type { CloudQuickNote, CloudGoal, CloudProject, CloudTarget, CloudTask } from '../repository/types';
import type { AppData, QuickNote, Goal, Project, Target, Task } from '../types';
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
  quickNotes: CloudQuickNote[];
  goals: CloudGoal[];
  targets: CloudTarget[];
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

export type CloudBundleResult =
  | {
      ok: true;
      data: CloudBundle;
      /**
       * Set when Quick Notes specifically could not be read, even though the
       * rest of the bundle loaded fine — a Quick Notes outage must never
       * block this whole screen (see this module's other isolation notes in
       * hydrateFromCloud.ts / refreshFromCloud.ts). `data.quickNotes` is `[]`
       * in that case; `compareForLinking`/`buildUseCloudData` both take an
       * explicit `quickNotesAvailable` flag so they never mistake that empty
       * array for "the cloud genuinely has no Quick Notes."
       */
      quickNotesError?: string;
    }
  | { ok: false; message: string };

/** The only place this module reads from Supabase — components call this instead of the repository directly (per AGENTS.md). */
export async function loadCloudBundle(): Promise<CloudBundleResult> {
  // Quick Notes is read independently of the other four entities — a Quick
  // Notes-specific outage must never block this screen, which exists to
  // resolve every other entity's account-linking choice too.
  const [projects, tasks, goals, targets, quickNotes] = await Promise.all([
    listProjects(),
    listTasks(),
    listGoals(),
    listTargets(),
    listQuickNotes(),
  ]);
  if (!projects.ok) return { ok: false, message: projects.error.message };
  if (!tasks.ok) return { ok: false, message: tasks.error.message };
  if (!goals.ok) return { ok: false, message: goals.error.message };
  if (!targets.ok) return { ok: false, message: targets.error.message };
  return {
    ok: true,
    data: {
      projects: projects.data,
      tasks: tasks.data,
      quickNotes: quickNotes.ok ? quickNotes.data : [],
      goals: goals.data,
      targets: targets.data,
    },
    quickNotesError: quickNotes.ok ? undefined : quickNotes.error.message,
  };
}

/**
 * Pure — no I/O. Given local state and a freshly-read cloud bundle,
 * classifies every record by id. `quickNotesAvailable` (default `true`,
 * matching every other call site's expectations) must be passed `false`
 * when `loadCloudBundle` reported a `quickNotesError` — `cloud.quickNotes`
 * is an empty placeholder in that case, not real "the cloud has none" data,
 * so comparing against it would wrongly report every local Quick Note as
 * local-only. Quick Notes is reported as having no differences at all
 * instead (never guessed) whenever it isn't available.
 */
export function compareForLinking(
  local: AppData,
  cloud: CloudBundle,
  quickNotesAvailable = true,
): LinkingComparison {
  const projects = compareEntity(local.projects, cloud.projects);
  const tasks = compareEntity(local.tasks, cloud.tasks);
  const quickNotes = quickNotesAvailable
    ? compareEntity(local.quickNotes, cloud.quickNotes)
    : { localOnly: [], cloudOnly: [], differing: [] };
  const goals = compareEntity(local.goals, cloud.goals);
  const targets = compareEntity(local.targets, cloud.targets);

  const identical =
    projects.localOnly.length === 0 &&
    projects.cloudOnly.length === 0 &&
    projects.differing.length === 0 &&
    tasks.localOnly.length === 0 &&
    tasks.cloudOnly.length === 0 &&
    tasks.differing.length === 0 &&
    quickNotes.localOnly.length === 0 &&
    quickNotes.cloudOnly.length === 0 &&
    quickNotes.differing.length === 0 &&
    goals.localOnly.length === 0 &&
    goals.cloudOnly.length === 0 &&
    goals.differing.length === 0 &&
    targets.localOnly.length === 0 &&
    targets.cloudOnly.length === 0 &&
    targets.differing.length === 0;

  return {
    localOnly: {
      project: projects.localOnly,
      task: tasks.localOnly,
      quickNote: quickNotes.localOnly,
      goal: goals.localOnly,
      target: targets.localOnly,
    },
    cloudOnly: {
      project: projects.cloudOnly,
      task: tasks.cloudOnly,
      quickNote: quickNotes.cloudOnly,
      goal: goals.cloudOnly,
      target: targets.cloudOnly,
    },
    differing: {
      project: projects.differing,
      task: tasks.differing,
      quickNote: quickNotes.differing,
      goal: goals.differing,
      target: targets.differing,
    },
    identical,
  };
}

/**
 * "Use my account's data" — loads the cloud's own content wholesale, exactly
 * like an ordinary hydration. No cloud write. Local edits not reflected in
 * the cloud are discarded — the caller is responsible for the explicit
 * confirmation and export-first warning decision 15/11 call for; this
 * function only performs the already-confirmed action.
 *
 * `quickNotesAvailable` (default `true`) must be passed `false` when
 * `loadCloudBundle` reported a `quickNotesError` for this same `cloud` —
 * `cloud.quickNotes` is an empty placeholder in that case, not real cloud
 * content, so replacing local Quick Notes with it would silently delete
 * them. `local` is used only for that fallback; every other entity still
 * replaces wholesale from `cloud` exactly as before.
 */
export function buildUseCloudData(cloud: CloudBundle, local: AppData, quickNotesAvailable = true): AppData {
  return {
    version: 1,
    projects: cloud.projects.map(stripUpdatedAt),
    tasks: cloud.tasks.map(stripUpdatedAt),
    quickNotes: quickNotesAvailable ? cloud.quickNotes.map(stripUpdatedAt) : local.quickNotes,
    goals: cloud.goals.map(stripUpdatedAt),
    targets: cloud.targets.map(stripUpdatedAt),
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
  const deferred: Record<SyncEntity, string[]> = { project: [], task: [], quickNote: [], goal: [], target: [] };

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
    updateProjectGuarded(
      id,
      { name: r.name, description: r.description, status: r.status, priorityRank: r.priorityRank },
      ts,
      accountId,
    ),
  );
  await resolveDiffering<Task>('task', comparison.differing.task, local.tasks, cloud.tasks, (id, r, ts) => {
    const { id: _id, createdAt: _createdAt, ...updates } = r as Task;
    void _id;
    void _createdAt;
    return updateTaskGuarded(id, updates, ts, accountId);
  });
  await resolveDiffering<QuickNote>('quickNote', comparison.differing.quickNote, local.quickNotes, cloud.quickNotes, (id, r, ts) =>
    updateQuickNoteGuarded(
      id,
      { text: r.text, completed: r.completed, deleted: r.deleted, completedAt: r.completedAt },
      ts,
      accountId,
    ),
  );
  // Goal before Target: a target's guarded update can reference a goal_id
  // that must already exist in the cloud (real foreign key, unlike tasks'
  // nullable project_id) — see drainSync.ts's syncTarget doc comment.
  await resolveDiffering<Goal>('goal', comparison.differing.goal, local.goals, cloud.goals, (id, r, ts) =>
    updateGoalGuarded(
      id,
      { name: r.name, description: r.description, dueDate: r.dueDate, priority: r.priority, status: r.status, projectIds: r.projectIds },
      ts,
      accountId,
    ),
  );
  await resolveDiffering<Target>('target', comparison.differing.target, local.targets, cloud.targets, (id, r, ts) => {
    const { id: _id, goalId: _goalId, type: _type, ...updates } = r as Target;
    void _id;
    void _goalId;
    void _type;
    return updateTargetGuarded(id, updates, ts, accountId);
  });

  await resolveLocalOnly<Project>('project', comparison.localOnly.project, local.projects, (r) =>
    createProject(r, accountId),
  );
  await resolveLocalOnly<Task>('task', comparison.localOnly.task, local.tasks, (r) => createTask(r, accountId));
  await resolveLocalOnly<QuickNote>('quickNote', comparison.localOnly.quickNote, local.quickNotes, (r) =>
    createQuickNote(r, accountId),
  );
  // Goal before Target, same foreign-key reason as above.
  await resolveLocalOnly<Goal>('goal', comparison.localOnly.goal, local.goals, (r) => createGoal(r, accountId));
  await resolveLocalOnly<Target>('target', comparison.localOnly.target, local.targets, (r) =>
    createTarget(r, accountId),
  );

  // Cloud-only records: pull down, never delete. Local records that were
  // written above keep their existing local content (the write only
  // affected the cloud copy) — nothing here changes local values.
  const pulledProjects = cloud.projects.filter((p) => comparison.cloudOnly.project.includes(p.id)).map(stripUpdatedAt);
  const pulledTasks = cloud.tasks.filter((t) => comparison.cloudOnly.task.includes(t.id)).map(stripUpdatedAt);
  const pulledNotes = cloud.quickNotes
    .filter((n) => comparison.cloudOnly.quickNote.includes(n.id))
    .map(stripUpdatedAt);
  const pulledGoals = cloud.goals.filter((g) => comparison.cloudOnly.goal.includes(g.id)).map(stripUpdatedAt);
  const pulledTargets = cloud.targets.filter((t) => comparison.cloudOnly.target.includes(t.id)).map(stripUpdatedAt);

  const appData: AppData = {
    ...local,
    projects: [...local.projects, ...pulledProjects],
    tasks: [...local.tasks, ...pulledTasks],
    quickNotes: [...local.quickNotes, ...pulledNotes],
    goals: [...local.goals, ...pulledGoals],
    targets: [...local.targets, ...pulledTargets],
  };

  return { appData, metadata: nextMetadata, deferred };
}
