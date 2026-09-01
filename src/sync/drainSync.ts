import { createDailyNote, listDailyNotes, updateDailyNoteGuarded } from '../repository/dailyNotesRepository';
import { createProject, listProjects, updateProjectGuarded } from '../repository/projectsRepository';
import { createTask, listTasks, updateTaskGuarded } from '../repository/tasksRepository';
import type { RepositoryError, RepositoryResult } from '../repository/types';
import type { AppData, DailyNote, Project, Task } from '../types';
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
    result = await updateProjectGuarded(
      id,
      { name: before.name, description: before.description, status: before.status },
      knownUpdatedAt,
      accountId,
    );
  } else {
    result = await createProject(before, accountId);
    if (!result.ok && result.error.type === 'duplicate') {
      return resolveDuplicateCreate('project', id, accountId, before, listProjects);
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

  const knownUpdatedAt = getRecordUpdatedAt(getAccountMetadata(loadSyncMetadataStore(), accountId), 'task', id);

  let result: RepositoryResult<{ updatedAt: string }>;
  if (knownUpdatedAt) {
    const { id: _id, createdAt: _createdAt, ...updates } = before;
    void _id;
    void _createdAt;
    result = await updateTaskGuarded(id, updates, knownUpdatedAt, accountId);
  } else {
    result = await createTask(before, accountId);
    if (!result.ok && result.error.type === 'duplicate') {
      return resolveDuplicateCreate('task', id, accountId, before, listTasks);
    }
  }

  return finishOutcome('task', id, accountId, before, getLocalState().tasks.find((t) => t.id === id), result);
}

async function syncDailyNote(
  id: string,
  accountId: string,
  getLocalState: () => AppData,
): Promise<DrainRecordOutcome> {
  const before = getLocalState().dailyNotes.find((n) => n.id === id);
  if (!before) {
    patchMetadata(accountId, (m) => clearDirty(m, 'dailyNote', id));
    return { kind: 'skipped-missing' };
  }

  const knownUpdatedAt = getRecordUpdatedAt(
    getAccountMetadata(loadSyncMetadataStore(), accountId),
    'dailyNote',
    id,
  );

  let result: RepositoryResult<{ updatedAt: string }>;
  if (knownUpdatedAt) {
    result = await updateDailyNoteGuarded(id, { morning: before.morning, evening: before.evening }, knownUpdatedAt, accountId);
  } else {
    result = await createDailyNote(before, accountId);
    if (!result.ok && result.error.type === 'duplicate') {
      return resolveDuplicateCreate('dailyNote', id, accountId, before, listDailyNotes);
    }
  }

  return finishOutcome('dailyNote', id, accountId, before, getLocalState().dailyNotes.find((n) => n.id === id), result);
}

function finishOutcome<T extends Project | Task | DailyNote>(
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
 * project -> task -> dailyNote order (matching migration's own
 * project-before-task rationale, though this loop never actually depends on
 * cross-entity ordering the way migration's foreign-key concern does).
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

  entityLoop: for (const entity of ['project', 'task', 'dailyNote'] as const) {
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
              : await syncDailyNote(id, accountId, getLocalState);
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
