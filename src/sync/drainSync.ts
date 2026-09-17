import { createQuickNote, listQuickNotes, updateQuickNoteGuarded } from '../repository/quickNotesRepository';
import { createGoal, listGoals, updateGoalGuarded } from '../repository/goalsRepository';
import { createProject, listVisibleProjects, updateProjectGuarded } from '../repository/projectsRepository';
import { createTarget, listTargets, updateTargetGuarded } from '../repository/targetsRepository';
import { createTask, listVisibleTasks, updateTaskGuarded } from '../repository/tasksRepository';
import type { RepositoryError, RepositoryResult } from '../repository/types';
import type { AppData, QuickNote, Goal, Project, Target, Task } from '../types';
import {
  clearDirty,
  getAccountMetadata,
  getRecordUpdatedAt,
  setRecordUpdatedAt,
  upsertAccountMetadata,
  type AccountSyncMetadata,
  type SyncEntity,
  type SyncMetadataStore,
} from './metadata';
import { loadSyncMetadataStore, saveSyncMetadataStore } from './metadataStorage';

/**
 * Phase 5B3B — the drain loop's per-record body. Given a dirty (entity, id)
 * pair, pushes exactly one record to Supabase and durably updates
 * `daily-compass-sync-v1` to reflect the outcome, before moving on to the
 * next id. See `SUPABASE_IMPLEMENTATION_PLAN.md` → "Phase 5B3B" for the
 * governing design (bounded backoff, single-flight, generation checks) —
 * this module is the part that actually talks to Supabase; `SyncEngineContext.tsx`
 * owns the loop, single-flight guard, retry scheduling, and status.
 *
 * Every call here is a real cloud write, using only the account-scoped
 * repository functions from Phase 5B3A (`createX`/`updateXGuarded`, plus the
 * pre-existing `listX` reads used to resolve an ambiguous duplicate-id
 * response — see `resolveDuplicateCreate`) — never a new repository
 * function, never a value derived from the record itself or from
 * `localStorage` for `expectedAccountId`.
 */

export type DrainRecordOutcome =
  | { kind: 'synced' }
  /** Synced, but a newer local edit landed mid-flight — stays dirty for the next pass; `lastKnownUpdatedAt` is still advanced. */
  | { kind: 'synced-superseded' }
  | { kind: 'conflict'; message: string }
  /** The whole account context is currently invalid — the caller must stop the entire pass, not just skip this id. */
  | { kind: 'account-error'; errorType: RepositoryError['type']; message: string }
  /** A network-level failure (thrown/rejected, not a structured response) — the caller should stop the pass and schedule a bounded retry. */
  | { kind: 'network-error'; message: string }
  /** A structured, non-conflict database error (treated as not-blindly-retryable; left dirty for a future natural trigger). */
  | { kind: 'record-error'; message: string }
  /** Nothing to sync — the id no longer has a corresponding local record (e.g. after a RESET/IMPORT this dirty entry predates). */
  | { kind: 'skipped-missing' };

function isAccountLevelError(type: RepositoryError['type']): boolean {
  return type === 'unauthenticated' || type === 'unconfigured' || type === 'account-mismatch';
}

function sameContent<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Compares a cloud record's own persisted content against a local record, ignoring `updatedAt`. */
function cloudContentEquals<T>(cloud: T & { updatedAt: string }, local: T): boolean {
  const { updatedAt, ...cloudContent } = cloud;
  void updatedAt;
  return sameContent(cloudContent as T, local);
}

/**
 * Resolves a `createX` failure classified as `'duplicate'` (Postgres's own
 * `23505` unique-violation code — see `RepositoryErrorType`'s doc comment;
 * no message-pattern matching). A duplicate here is ambiguous by
 * construction — it could mean this exact create already succeeded on an
 * earlier attempt and only the response was lost (safe to recognize as
 * synced), or it could mean a *different* row already exists under this id
 * (e.g. from Phase 5A migration, or another device) with content this
 * device never wrote (never safe to overwrite automatically). The only way
 * to tell them apart is to look: re-read the existing row and compare its
 * actual persisted content to the local record, not to assume either
 * outcome from the duplicate alone.
 *
 * Never adopts the cloud `updated_at` as license for a guarded update when
 * content differs — per decision 15, an unconditional overwrite of a cloud
 * record whose value differs from local is never allowed; only the future
 * interactive linking/conflict UI (Phase 5B3C) may resolve that case. The
 * record stays dirty and is reported as a conflict, exactly like a
 * version-conflict from a guarded update, until then.
 */
async function resolveDuplicateCreate<T extends { id: string }>(
  entity: SyncEntity,
  id: string,
  accountId: string,
  localRecord: T,
  listFn: () => Promise<RepositoryResult<(T & { updatedAt: string })[]>>,
): Promise<DrainRecordOutcome> {
  const listed = await listFn();
  const existing = listed.ok ? listed.data.find((r) => r.id === id) : undefined;

  if (!existing) {
    // A duplicate-id error implies a row exists, but this read didn't find
    // it (a failed list call, or eventual-consistency lag) — stay dirty and
    // let a later pass try again rather than guessing either way.
    return {
      kind: 'record-error',
      message: 'A duplicate record was reported, but its contents could not be confirmed yet. Will retry.',
    };
  }

  if (cloudContentEquals(existing, localRecord)) {
    // "Create succeeded but the response was lost" — the cloud row already
    // holds exactly what this device wanted to write. Nothing was actually
    // left unsynced, so this is safe to recognize as synced.
    patchMetadata(accountId, (m) => clearDirty(setRecordUpdatedAt(m, entity, id, existing.updatedAt), entity, id));
    return { kind: 'synced' };
  }

  // Contents differ and there is no trusted baseline proving which version
  // is newer. Deliberately does not call setRecordUpdatedAt here either —
  // doing so would let the *next* pass silently attempt a guarded update
  // against this now-known baseline, which is exactly the "discovery as
  // permission to overwrite" this function must not do.
  return {
    kind: 'conflict',
    message:
      'A record with this id already exists in your account with different content. Resolving this needs this device to be linked to your account.',
  };
}

/**
 * Re-loads sync metadata fresh, applies `patch` to the current account's
 * bucket, and saves immediately — kept as small, single-record patches
 * (never a batch held across an `await`) so a concurrent dispatch-side
 * `markDirty` for a *different* id is never clobbered, and so a durable
 * confirmation is written the instant it is known, not deferred to the end
 * of the whole pass.
 */
function patchMetadata(
  accountId: string,
  patch: (metadata: AccountSyncMetadata) => AccountSyncMetadata,
): SyncMetadataStore {
  const store = loadSyncMetadataStore();
  const current = getAccountMetadata(store, accountId);
  const next = patch(current);
  const nextStore = upsertAccountMetadata(store, next);
  saveSyncMetadataStore(nextStore);
  return nextStore;
}

/**
 * A Task's `ownerId` for write purposes is always derived fresh from its
 * current parent Project — never trusted from the Task's own `ownerId`
 * field, which could in principle be stale or (for a brand-new Task) not
 * yet stamped at all. The Project is the one authoritative source, mirroring
 * both the database's own tasks_project_fk and reducer.ts's
 * deriveTaskOwnerId, which keeps the local cache consistent with this same
 * rule. A Task with no `projectId`, or whose Project carries no known
 * `ownerId` (a private Project, or one from before Stage 3), resolves to
 * `accountId` — unchanged, existing private-Task behavior.
 */
function resolveTaskOwnerId(task: Task, projects: Project[], accountId: string): string {
  if (!task.projectId) return accountId;
  return projects.find((p) => p.id === task.projectId)?.ownerId ?? accountId;
}

async function syncProject(
  id: string,
  accountId: string,
  getLocalState: () => AppData,
): Promise<DrainRecordOutcome> {
  const before = getLocalState().projects.find((p) => p.id === id);
  if (!before) {
    patchMetadata(accountId, (m) => clearDirty(m, 'project', id));
    return { kind: 'skipped-missing' };
  }

  const knownUpdatedAt = getRecordUpdatedAt(
    getAccountMetadata(loadSyncMetadataStore(), accountId),
    'project',
    id,
  );

  let result: RepositoryResult<{ updatedAt: string }>;
  if (knownUpdatedAt) {
    // `before.ownerId` — the real database owner this Project was last read
    // with — targets a shared Project's actual row when this account is an
    // Editor updating it (see updateProjectGuarded's own doc comment); it is
    // `undefined` for a private/legacy Project, which correctly falls back
    // to `accountId` itself, unchanged from before Stage 3.
    result = await updateProjectGuarded(
      id,
      {
        name: before.name,
        description: before.description,
        status: before.status,
        priorityRank: before.priorityRank,
      },
      knownUpdatedAt,
      accountId,
      before.ownerId,
    );
  } else {
    // Reaching here with a shared Project (ownerId set to someone else)
    // should not happen — only the Owner can ever create a Project, and a
    // shared Project only ever enters local state already-hydrated (with a
    // known baseline) via listVisibleProjects, never through ADD_PROJECT.
    // createProject has no ownerId parameter for exactly this reason: this
    // branch is reached only for a genuinely new, self-owned Project.
    result = await createProject(before, accountId);
    if (!result.ok && result.error.type === 'duplicate') {
      // listVisibleProjects, not listProjects: the conflicting row a
      // duplicate-id error implies could in principle belong to a different
      // owner than accountId (see listTasks's matching comment below) —
      // using the visible read here is strictly a superset of what the
      // owner-only read would find, so this is safe for the ordinary
      // private-Project case too.
      return resolveDuplicateCreate('project', id, accountId, before, listVisibleProjects);
    }
  }

  return finishOutcome('project', id, accountId, before, getLocalState().projects.find((p) => p.id === id), result);
}

async function syncTask(id: string, accountId: string, getLocalState: () => AppData): Promise<DrainRecordOutcome> {
  const before = getLocalState().tasks.find((t) => t.id === id);
  if (!before) {
    patchMetadata(accountId, (m) => clearDirty(m, 'task', id));
    return { kind: 'skipped-missing' };
  }

  const ownerId = resolveTaskOwnerId(before, getLocalState().projects, accountId);
  const knownUpdatedAt = getRecordUpdatedAt(getAccountMetadata(loadSyncMetadataStore(), accountId), 'task', id);

  let result: RepositoryResult<{ updatedAt: string }>;
  if (knownUpdatedAt) {
    const { id: _id, createdAt: _createdAt, ...updates } = before;
    void _id;
    void _createdAt;
    result = await updateTaskGuarded(id, updates, knownUpdatedAt, accountId, ownerId);
  } else {
    // A newly created Task inside a shared Project reaches here (unlike
    // Projects, Editors do create Tasks) — `ownerId` is the shared
    // Project's real owner, resolved above from the Project itself, never
    // from a value the Task happened to carry; createTask stores the new
    // row under that owner's user_id, matching every other Task the Owner
    // creates themselves, rather than forking a copy under this account.
    result = await createTask(before, accountId, ownerId);
    if (!result.ok && result.error.type === 'duplicate') {
      // listVisibleTasks, not listTasks: a duplicate-id error's existing row
      // could belong to a different owner (the shared Project's Owner) than
      // accountId — an owner-only read would never find it, silently
      // leaving this stuck as an unresolved conflict. listVisibleTasks is a
      // strict superset of the owner-only read, so this is equally correct
      // for an ordinary private Task's duplicate.
      return resolveDuplicateCreate('task', id, accountId, before, listVisibleTasks);
    }
  }

  return finishOutcome('task', id, accountId, before, getLocalState().tasks.find((t) => t.id === id), result);
}

async function syncQuickNote(
  id: string,
  accountId: string,
  getLocalState: () => AppData,
): Promise<DrainRecordOutcome> {
  const before = getLocalState().quickNotes.find((n) => n.id === id);
  if (!before) {
    patchMetadata(accountId, (m) => clearDirty(m, 'quickNote', id));
    return { kind: 'skipped-missing' };
  }

  const knownUpdatedAt = getRecordUpdatedAt(
    getAccountMetadata(loadSyncMetadataStore(), accountId),
    'quickNote',
    id,
  );

  let result: RepositoryResult<{ updatedAt: string }>;
  if (knownUpdatedAt) {
    result = await updateQuickNoteGuarded(
      id,
      { text: before.text, completed: before.completed, deleted: before.deleted, completedAt: before.completedAt },
      knownUpdatedAt,
      accountId,
    );
  } else {
    result = await createQuickNote(before, accountId);
    if (!result.ok && result.error.type === 'duplicate') {
      return resolveDuplicateCreate('quickNote', id, accountId, before, listQuickNotes);
    }
  }

  return finishOutcome('quickNote', id, accountId, before, getLocalState().quickNotes.find((n) => n.id === id), result);
}

async function syncGoal(id: string, accountId: string, getLocalState: () => AppData): Promise<DrainRecordOutcome> {
  const before = getLocalState().goals.find((g) => g.id === id);
  if (!before) {
    patchMetadata(accountId, (m) => clearDirty(m, 'goal', id));
    return { kind: 'skipped-missing' };
  }

  const knownUpdatedAt = getRecordUpdatedAt(getAccountMetadata(loadSyncMetadataStore(), accountId), 'goal', id);

  let result: RepositoryResult<{ updatedAt: string }>;
  if (knownUpdatedAt) {
    result = await updateGoalGuarded(
      id,
      {
        name: before.name,
        description: before.description,
        dueDate: before.dueDate,
        priority: before.priority,
        status: before.status,
        projectIds: before.projectIds,
      },
      knownUpdatedAt,
      accountId,
    );
  } else {
    result = await createGoal(before, accountId);
    if (!result.ok && result.error.type === 'duplicate') {
      return resolveDuplicateCreate('goal', id, accountId, before, listGoals);
    }
  }

  return finishOutcome('goal', id, accountId, before, getLocalState().goals.find((g) => g.id === id), result);
}

/**
 * Targets are drained after Goals (see drainDirtyWork's entity order) —
 * targets.goal_id is a real foreign key to goals(user_id, id) (unlike
 * tasks.project_id, which is nullable), so a target's first create can only
 * succeed once its parent goal already exists in the cloud.
 *
 * Archive/Restore is an ordinary field update here (`archived: true|false`
 * as part of the same full-record push), never a delete — Targets have no
 * delete path in this app.
 */
async function syncTarget(id: string, accountId: string, getLocalState: () => AppData): Promise<DrainRecordOutcome> {
  const before = getLocalState().targets.find((t) => t.id === id);
  if (!before) {
    patchMetadata(accountId, (m) => clearDirty(m, 'target', id));
    return { kind: 'skipped-missing' };
  }

  const knownUpdatedAt = getRecordUpdatedAt(getAccountMetadata(loadSyncMetadataStore(), accountId), 'target', id);

  let result: RepositoryResult<{ updatedAt: string }>;
  if (knownUpdatedAt) {
    const { id: _id, goalId: _goalId, type: _type, ...updates } = before;
    void _id;
    void _goalId;
    void _type;
    result = await updateTargetGuarded(id, updates, knownUpdatedAt, accountId);
  } else {
    result = await createTarget(before, accountId);
    if (!result.ok && result.error.type === 'duplicate') {
      return resolveDuplicateCreate('target', id, accountId, before, listTargets);
    }
  }

  return finishOutcome('target', id, accountId, before, getLocalState().targets.find((t) => t.id === id), result);
}

function finishOutcome<T extends Project | Task | QuickNote | Goal | Target>(
  entity: SyncEntity,
  id: string,
  accountId: string,
  sentSnapshot: T,
  currentLocal: T | undefined,
  result: RepositoryResult<{ updatedAt: string }>,
): DrainRecordOutcome {
  if (result.ok) {
    const stillFresh = !!currentLocal && sameContent(sentSnapshot, currentLocal);
    patchMetadata(accountId, (m) => {
      let next = setRecordUpdatedAt(m, entity, id, result.data.updatedAt);
      if (stillFresh) next = clearDirty(next, entity, id);
      return next;
    });
    return stillFresh ? { kind: 'synced' } : { kind: 'synced-superseded' };
  }

  const { type, message } = result.error;
  if (isAccountLevelError(type)) {
    return { kind: 'account-error', errorType: type, message };
  }
  if (type === 'conflict') {
    return { kind: 'conflict', message };
  }
  // 'database' and any other structured (non-thrown) response: the server
  // itself responded with a rejection, which — unlike a thrown/rejected
  // network failure — is treated as not blindly retryable. Left dirty.
  return { kind: 'record-error', message };
}

/**
 * One drain pass: attempts every currently-dirty id for `accountId`, in
 * project -> task -> quickNote -> goal -> target order. Project/task/
 * quickNote ordering matches migration's own project-before-task rationale,
 * though this loop never actually depends on that ordering the way
 * migration's foreign-key concern does. Goal-before-target is a real
 * dependency, not just convention: see syncTarget's doc comment.
 *
 * Stops early — without throwing — the instant `isGenerationCurrent()`
 * returns false (checked between every network operation, never during
 * one), on any account-level error, or on the first thrown/rejected
 * (network-level) failure. A thrown exception from a repository call is
 * caught here specifically so a single offline moment cannot escape as an
 * unhandled rejection and crash the caller's effect.
 */
export interface DrainPassResult {
  attempted: number;
  outcomes: DrainRecordOutcome[];
  stoppedEarly: boolean;
  networkFailure: boolean;
  accountError: { errorType: RepositoryError['type']; message: string } | null;
}

export async function drainDirtyWork(
  accountId: string,
  isGenerationCurrent: () => boolean,
  getLocalState: () => AppData,
): Promise<DrainPassResult> {
  const outcomes: DrainRecordOutcome[] = [];
  let stoppedEarly = false;
  let networkFailure = false;
  let accountError: DrainPassResult['accountError'] = null;
  let attempted = 0;

  // Goal before Target: targets.goal_id is a real foreign key to
  // goals(user_id, id) (see drainSync's syncTarget doc comment), so a
  // target's first create can only succeed once its goal already exists in
  // the cloud — mirrors migration.ts's "projects before tasks" rationale.
  entityLoop: for (const entity of ['project', 'task', 'quickNote', 'goal', 'target'] as const) {
    const snapshot = getAccountMetadata(loadSyncMetadataStore(), accountId).dirty[entity].slice();

    for (const id of snapshot) {
      if (!isGenerationCurrent()) {
        stoppedEarly = true;
        break entityLoop;
      }

      attempted += 1;
      let outcome: DrainRecordOutcome;
      try {
        outcome =
          entity === 'project'
            ? await syncProject(id, accountId, getLocalState)
            : entity === 'task'
              ? await syncTask(id, accountId, getLocalState)
              : entity === 'quickNote'
                ? await syncQuickNote(id, accountId, getLocalState)
                : entity === 'goal'
                  ? await syncGoal(id, accountId, getLocalState)
                  : await syncTarget(id, accountId, getLocalState);
      } catch (thrown) {
        outcome = { kind: 'network-error', message: thrown instanceof Error ? thrown.message : String(thrown) };
      }

      outcomes.push(outcome);

      if (!isGenerationCurrent()) {
        stoppedEarly = true;
        break entityLoop;
      }

      if (outcome.kind === 'network-error') {
        networkFailure = true;
        stoppedEarly = true;
        break entityLoop;
      }
      if (outcome.kind === 'account-error') {
        accountError = { errorType: outcome.errorType, message: outcome.message };
        stoppedEarly = true;
        break entityLoop;
      }
      // 'synced' / 'synced-superseded' / 'conflict' / 'record-error' /
      // 'skipped-missing' all continue on to the next dirty id.
    }
  }

  return { attempted, outcomes, stoppedEarly, networkFailure, accountError };
}
