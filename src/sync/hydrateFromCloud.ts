import type { AppData } from '../types';
import { listQuickNotes } from '../repository/quickNotesRepository';
import { listGoals } from '../repository/goalsRepository';
import { listProjects } from '../repository/projectsRepository';
import { listTargets } from '../repository/targetsRepository';
import { listTasks } from '../repository/tasksRepository';
import type { CloudQuickNote, CloudGoal, CloudProject, CloudTarget, CloudTask } from '../repository/types';
import { decideHydration, type EntityCounts, type HydrationDecision } from './hydration';

/**
 * Phase 5B2 — the first active (non-inactive) piece of `src/sync/`: reads a
 * signed-in user's cloud data through the existing repository layer and
 * decides, via Phase 5B1's `decideHydration`, whether it is safe to load it
 * into this device's local app state.
 *
 * This module only ever reads from Supabase. It never calls a create/update/
 * upsert/delete repository function, so it cannot write or overwrite a cloud
 * record. Like every function in `src/repository/`, it never accepts a user
 * id — `listProjects`/`listTasks`/`listQuickNotes` each resolve `user_id`
 * solely from the live Supabase session, so there is no parameter through
 * which a caller could request another user's data.
 */

export interface HydratedCloudData {
  appData: AppData;
  /** Raw cloud records (with `updatedAt`), for seeding device-local sync metadata. Never sent back to Supabase. */
  projects: CloudProject[];
  tasks: CloudTask[];
  quickNotes: CloudQuickNote[];
  goals: CloudGoal[];
  targets: CloudTarget[];
}

export interface HydrateFromCloudResult {
  decision: HydrationDecision;
  /** This device's current local counts, present whenever a local read happened (i.e. not 'signed-out'). */
  localCounts?: EntityCounts;
  /** Cloud counts, present whenever the cloud read succeeded (i.e. not 'signed-out' or 'cloud-query-failed'). */
  cloudCounts?: EntityCounts;
  /** Present only when `decision.kind === 'hydrate-from-cloud'` — the data that is safe to load. */
  hydrated?: HydratedCloudData;
  /**
   * Set when Quick Notes specifically could not be read, even though the
   * overall decision still succeeded from projects/tasks/goals/targets. A
   * Quick Notes outage must never block the rest of the account's data from
   * loading or refreshing (see this function's doc comment) — this field is
   * how that partial failure is still surfaced to the caller instead of
   * being silently swallowed.
   */
  quickNotesError?: string;
}

// Parameterized as `T & { updatedAt: string }` (matching src/sync/linkingChoice.ts's
// stripUpdatedAt), not `T extends { updatedAt: string }` -> `Omit<T, 'updatedAt'>` —
// the latter would infer T as the whole CloudTarget union and compute
// `Omit<CloudTarget, 'updatedAt'>`, which (per how TS's `Omit`/`keyof` handle
// unions) collapses to only the fields common to every Target variant,
// silently dropping type-specific fields like `taskIds`. This form infers T
// as `Target` directly, preserving the discriminated union.
function stripUpdatedAt<T>(record: T & { updatedAt: string }): T {
  const { updatedAt, ...rest } = record;
  void updatedAt;
  return rest as T;
}

/**
 * Local counts for the hydration decision, not the raw record counts Phase
 * 5A's migration display uses (`countLocalData` in `repository/migration.ts`).
 *
 * Every entity here has the same guarantee: `ADD_TASK`/`ADD_PROJECT`/
 * `ADD_QUICK_NOTE`/`ADD_GOAL`/`ADD_TARGET` all refuse to create a record with
 * blank, trimmed-empty required text, so anything that exists locally has
 * real user-entered content and is counted as-is — archived tasks and
 * archived Targets included (hidden from the default view by a filter, not
 * actually empty, so excluding them would risk genuine, silent data loss).
 * Soft-deleted Quick Notes (see `QuickNote.deleted`) are counted too, for the
 * same reason: they still hold real content and still exist as rows this
 * device must reconcile with the cloud, they are just hidden from the UI.
 *
 * Undercounting here is the dangerous direction: `hydrate-from-cloud`
 * wholesale-replaces local state via `LOAD` (see `decideHydration`), so a
 * device wrongly reported as "empty" would silently lose real local data.
 */
function meaningfulLocalCounts(local: AppData): EntityCounts {
  return {
    projects: local.projects.length,
    tasks: local.tasks.length,
    quickNotes: local.quickNotes.length,
    goals: local.goals.length,
    targets: local.targets.length,
  };
}

/**
 * Reads this signed-in user's cloud projects/tasks/quick notes and decides
 * what, if anything, this device should do with them.
 *
 * - Never called with, or able to derive, another user's id — `authStatus`
 *   only says whether *the current session* is signed in; the actual
 *   identity is resolved deep inside the repository layer from the live
 *   Supabase session, exactly as it is for every other repository call.
 * - Never mutates `local` or any cloud record. On any ambiguous or failed
 *   outcome, the caller is expected to leave local data exactly as it was —
 *   this function does not touch storage itself, it only reports a decision.
 */
export async function hydrateFromCloud(
  local: AppData,
  authStatus: 'signedOut' | 'signedIn',
  deviceEstablished: boolean,
): Promise<HydrateFromCloudResult> {
  if (authStatus === 'signedOut') {
    return { decision: { kind: 'signed-out' } };
  }

  const localCounts = meaningfulLocalCounts(local);

  // Quick Notes is read independently of the other four entities. A Quick
  // Notes-specific outage (e.g. its table not existing yet in a given
  // Supabase project) must never prevent projects/tasks/goals/targets from
  // hydrating or refreshing normally — see HydrateFromCloudResult.quickNotesError.
  // Failures in the other four remain hard failures, exactly as before: they
  // are core account data and this function still refuses to guess about
  // them.
  const [projectsResult, tasksResult, goalsResult, targetsResult, notesResult] = await Promise.all([
    listProjects(),
    listTasks(),
    listGoals(),
    listTargets(),
    listQuickNotes(),
  ]);

  // Checked in a fixed order (matching migration.ts's getCloudCounts) so the
  // reported error is deterministic when more than one read fails. Quick
  // Notes is deliberately not part of this hard-fail chain.
  if (!projectsResult.ok) {
    return {
      decision: { kind: 'cloud-query-failed', errorType: projectsResult.error.type, message: projectsResult.error.message },
      localCounts,
    };
  }
  if (!tasksResult.ok) {
    return {
      decision: { kind: 'cloud-query-failed', errorType: tasksResult.error.type, message: tasksResult.error.message },
      localCounts,
    };
  }
  if (!goalsResult.ok) {
    return {
      decision: { kind: 'cloud-query-failed', errorType: goalsResult.error.type, message: goalsResult.error.message },
      localCounts,
    };
  }
  if (!targetsResult.ok) {
    return {
      decision: { kind: 'cloud-query-failed', errorType: targetsResult.error.type, message: targetsResult.error.message },
      localCounts,
    };
  }

  const quickNotesError = notesResult.ok ? undefined : notesResult.error.message;

  // When Quick Notes could not be read, its cloud count is unknown — mirror
  // this device's own local count on both sides of the comparison instead of
  // guessing. That can never make local look "more empty" than it truly is
  // (the local side always uses the real local count), so it can never
  // trigger an unsafe unattended overwrite of real local Quick Notes; at
  // worst it makes the Quick Notes side of the comparison a no-op.
  const cloudCounts: EntityCounts = {
    projects: projectsResult.data.length,
    tasks: tasksResult.data.length,
    quickNotes: notesResult.ok ? notesResult.data.length : localCounts.quickNotes,
    goals: goalsResult.data.length,
    targets: targetsResult.data.length,
  };

  const decision = decideHydration({
    authStatus,
    localCounts,
    cloud: { ok: true, counts: cloudCounts },
    deviceEstablished,
  });

  if (decision.kind !== 'hydrate-from-cloud') {
    return { decision, localCounts, cloudCounts, quickNotesError };
  }

  // Goals/targets are always included, even when empty (listX already
  // returns [] for zero rows, never undefined) — a device hydrating from a
  // cloud account with no Goals/Targets yet must not end up with the field
  // missing/undefined now that AppData requires it. Quick Notes falls back
  // to this device's own current local notes, unchanged, when the cloud
  // read failed — there is no cloud truth to replace them with, and (per the
  // mirroring above) local Quick Notes can only be empty here anyway when
  // that read failed, so this is never silent data loss.
  const appData: AppData = {
    version: 1,
    projects: projectsResult.data.map(stripUpdatedAt),
    tasks: tasksResult.data.map(stripUpdatedAt),
    quickNotes: notesResult.ok ? notesResult.data.map(stripUpdatedAt) : local.quickNotes,
    goals: goalsResult.data.map(stripUpdatedAt),
    targets: targetsResult.data.map(stripUpdatedAt),
  };

  return {
    decision,
    localCounts,
    cloudCounts,
    quickNotesError,
    hydrated: {
      appData,
      projects: projectsResult.data,
      tasks: tasksResult.data,
      quickNotes: notesResult.ok ? notesResult.data : [],
      goals: goalsResult.data,
      targets: targetsResult.data,
    },
  };
}
