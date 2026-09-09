import type { AppData, DailyNote } from '../types';
import { listDailyNotes } from '../repository/dailyNotesRepository';
import { listGoals } from '../repository/goalsRepository';
import { listProjects } from '../repository/projectsRepository';
import { listTargets } from '../repository/targetsRepository';
import { listTasks } from '../repository/tasksRepository';
import type { CloudDailyNote, CloudGoal, CloudProject, CloudTarget, CloudTask } from '../repository/types';
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
 * id — `listProjects`/`listTasks`/`listDailyNotes` each resolve `user_id`
 * solely from the live Supabase session, so there is no parameter through
 * which a caller could request another user's data.
 */

export interface HydratedCloudData {
  appData: AppData;
  /** Raw cloud records (with `updatedAt`), for seeding device-local sync metadata. Never sent back to Supabase. */
  projects: CloudProject[];
  tasks: CloudTask[];
  dailyNotes: CloudDailyNote[];
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

function isMeaningfulDailyNote(note: DailyNote): boolean {
  return note.morning.trim() !== '' || note.evening.trim() !== '';
}

/**
 * Local counts for the hydration decision, not the raw record counts Phase
 * 5A's migration display uses (`countLocalData` in `repository/migration.ts`
 * — left untouched, since a blank note is still harmless to *offer* to
 * migrate under an explicit, user-confirmed action).
 *
 * `DailyNotesView` autosaves a placeholder daily-note record (blank
 * `morning`/`evening`) purely from visiting the page — its debounce effect
 * fires on mount regardless of whether the user typed anything, and the
 * reducer's `UPSERT_DAILY_NOTE` creates a new record even when both fields
 * are empty strings. That record is indistinguishable from "no note" in the
 * UI and carries no content, so on its own it must not make this device
 * look "populated" and block a safe, unattended cloud pull (`LOAD` replaces
 * local state entirely — see `decideHydration`'s `hydrate-from-cloud` case
 * — so getting this wrong in the other direction, by undercounting real
 * data, would silently destroy it).
 *
 * Projects and tasks have no equivalent loophole: `ADD_PROJECT`/`ADD_TASK`
 * both refuse to create a record with a blank, trimmed-empty name/title, so
 * every project/task that exists has real user-entered content and is
 * counted as-is — archived tasks included. An archived task still holds a
 * real title; it is only hidden from the default view by a filter, not
 * actually empty, so excluding it would risk a genuine, silent data loss.
 *
 * Goals and Targets are the same as Projects/Tasks in this respect —
 * `ADD_GOAL`/`ADD_TARGET` both refuse a blank, trimmed-empty name — so they
 * are counted as-is too, archived Targets included. This is also what closes
 * the hydration data-loss window Goals/Targets previously exposed: before
 * this, a device with real local Goals/Targets but zero tasks/projects/notes
 * would have been misreported as "local is empty," and `hydrateFromCloud`
 * would wholesale-replace local state (via `LOAD`) with cloud data that, at
 * the time, could not carry Goals/Targets forward — silently deleting them.
 * Counting them here means such a device is now correctly reported as
 * populated, so `decideHydration` calls for an explicit choice (or
 * await-explicit-migration) instead of an unattended overwrite.
 */
function meaningfulLocalCounts(local: AppData): EntityCounts {
  return {
    projects: local.projects.length,
    tasks: local.tasks.length,
    dailyNotes: local.dailyNotes.filter(isMeaningfulDailyNote).length,
    goals: local.goals.length,
    targets: local.targets.length,
  };
}

/**
 * Reads this signed-in user's cloud projects/tasks/daily notes and decides
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

  const [projectsResult, tasksResult, notesResult, goalsResult, targetsResult] = await Promise.all([
    listProjects(),
    listTasks(),
    listDailyNotes(),
    listGoals(),
    listTargets(),
  ]);

  // Checked in a fixed order (matching migration.ts's getCloudCounts) so the
  // reported error is deterministic when more than one read fails.
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
  if (!notesResult.ok) {
    return {
      decision: { kind: 'cloud-query-failed', errorType: notesResult.error.type, message: notesResult.error.message },
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

  const cloudCounts: EntityCounts = {
    projects: projectsResult.data.length,
    tasks: tasksResult.data.length,
    dailyNotes: notesResult.data.length,
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
    return { decision, localCounts, cloudCounts };
  }

  // Goals/targets are always included, even when empty (listX already
  // returns [] for zero rows, never undefined) — a device hydrating from a
  // cloud account with no Goals/Targets yet must not end up with the field
  // missing/undefined now that AppData requires it.
  const appData: AppData = {
    version: 1,
    projects: projectsResult.data.map(stripUpdatedAt),
    tasks: tasksResult.data.map(stripUpdatedAt),
    dailyNotes: notesResult.data.map(stripUpdatedAt),
    goals: goalsResult.data.map(stripUpdatedAt),
    targets: targetsResult.data.map(stripUpdatedAt),
  };

  return {
    decision,
    localCounts,
    cloudCounts,
    hydrated: {
      appData,
      projects: projectsResult.data,
      tasks: tasksResult.data,
      dailyNotes: notesResult.data,
      goals: goalsResult.data,
      targets: targetsResult.data,
    },
  };
}
