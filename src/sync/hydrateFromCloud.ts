import type { AppData } from '../types';
import { listDailyNotes } from '../repository/dailyNotesRepository';
import { listProjects } from '../repository/projectsRepository';
import { listTasks } from '../repository/tasksRepository';
import { countLocalData } from '../repository/migration';
import type { CloudDailyNote, CloudProject, CloudTask } from '../repository/types';
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

function stripUpdatedAt<T extends { updatedAt: string }>(record: T): Omit<T, 'updatedAt'> {
  const { updatedAt, ...rest } = record;
  void updatedAt;
  return rest;
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

  const localCounts = countLocalData(local);

  const [projectsResult, tasksResult, notesResult] = await Promise.all([
    listProjects(),
    listTasks(),
    listDailyNotes(),
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

  const cloudCounts: EntityCounts = {
    projects: projectsResult.data.length,
    tasks: tasksResult.data.length,
    dailyNotes: notesResult.data.length,
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

  const appData: AppData = {
    version: 1,
    projects: projectsResult.data.map(stripUpdatedAt),
    tasks: tasksResult.data.map(stripUpdatedAt),
    dailyNotes: notesResult.data.map(stripUpdatedAt),
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
    },
  };
}
