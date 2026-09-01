import type { AppData } from '../types';
import { listDailyNotes, upsertDailyNote } from './dailyNotesRepository';
import { listProjects, upsertProject } from './projectsRepository';
import { listTasks, upsertTask } from './tasksRepository';
import type { RepositoryResult } from './types';

/**
 * Phase 5A — controlled, explicit, one-time migration of this device's
 * existing localStorage data into the signed-in user's Supabase account.
 *
 * This module only ever pushes local data to the cloud; it never reads a
 * cloud record back into local state, deletes anything, or runs on its own.
 *
 * `runMigration` takes `expectedAccountId` — the account id the calling UI's
 * already-authenticated session established (see `MigrationPanel.tsx`, which
 * only renders the migrate action once `useAuth()` reports a signed-in
 * `user`, and passes that same `user.id` through unchanged). It is never
 * derived from the local records being migrated, and it is never used to
 * select or authorize an account: it is passed straight to every repository
 * `upsertX` call (Phase 5B3A, task 2 of 3 — see
 * SUPABASE_IMPLEMENTATION_PLAN.md decision 13), which independently
 * re-verifies it against the live Supabase session on every call and fails
 * closed with a typed `'account-mismatch'` error — without writing anything
 * — if the session no longer matches. This closes the gap where a
 * long-running, multi-record migration could otherwise have its later writes
 * silently attributed to a different account if the session changed
 * mid-migration.
 */

export interface MigrationCounts {
  projects: number;
  tasks: number;
  dailyNotes: number;
}

function zeroCounts(): MigrationCounts {
  return { projects: 0, tasks: 0, dailyNotes: 0 };
}

export function countLocalData(local: AppData): MigrationCounts {
  return {
    projects: local.projects.length,
    tasks: local.tasks.length,
    dailyNotes: local.dailyNotes.length,
  };
}

/**
 * Current cloud record counts for the signed-in user, for display in the
 * migration confirmation step. Fails (typed error) if nobody is signed in or
 * Supabase isn't configured — the caller should not offer migration at all
 * in that case, but this is checked independently regardless.
 */
export async function getCloudCounts(): Promise<RepositoryResult<MigrationCounts>> {
  const [projectsResult, tasksResult, notesResult] = await Promise.all([
    listProjects(),
    listTasks(),
    listDailyNotes(),
  ]);

  if (!projectsResult.ok) return projectsResult;
  if (!tasksResult.ok) return tasksResult;
  if (!notesResult.ok) return notesResult;

  return {
    ok: true,
    data: {
      projects: projectsResult.data.length,
      tasks: tasksResult.data.length,
      dailyNotes: notesResult.data.length,
    },
  };
}

export type MigrationEntity = 'project' | 'task' | 'dailyNote';

export interface MigrationRecordFailure {
  entity: MigrationEntity;
  id: string;
  /** A human-readable label for the record (name/title/date) — never raw internal ids alone. */
  label: string;
  message: string;
}

export interface MigrationVerificationIssue {
  entity: MigrationEntity;
  id: string;
  label: string;
  reason: string;
}

export interface MigrationVerification {
  passed: boolean;
  cloudCountsAfter: MigrationCounts;
  issues: MigrationVerificationIssue[];
}

export interface MigrationOutcome {
  /** True only when every record uploaded successfully AND re-read verification passed. */
  ok: boolean;
  attempted: MigrationCounts;
  uploaded: MigrationCounts;
  uploadFailures: MigrationRecordFailure[];
  /** Null only when migration was aborted before any upload was attempted (e.g. not authenticated). */
  verification: MigrationVerification | null;
  /** Set when migration could not start at all (not signed in, Supabase not configured). */
  authError?: string;
}

/**
 * Uploads this device's local data to the signed-in user's Supabase account,
 * then re-reads the cloud tables to verify the result. Requirements enforced
 * here (see AGENTS.md / SUPABASE_IMPLEMENTATION_PLAN.md Phase 5):
 *  - projects are uploaded before tasks, so task -> project references stay valid;
 *  - every record is upserted by its existing stable id (never re-generated);
 *  - a failure on one record does not stop the others — failures are collected
 *    and reported, never silently swallowed;
 *  - local data is never read from here except to upload it — nothing is
 *    deleted, cleared, or overwritten locally.
 *
 * `expectedAccountId` — see this module's top-level doc comment — is passed
 * unchanged to every `upsertX` call below.
 */
export async function runMigration(
  local: AppData,
  expectedAccountId: string,
): Promise<MigrationOutcome> {
  const attempted = countLocalData(local);

  const uploaded = zeroCounts();
  const uploadFailures: MigrationRecordFailure[] = [];
  const migratedProjectIds = new Set<string>();
  const migratedTaskIds = new Set<string>();
  const migratedNoteIds = new Set<string>();

  // Projects first, so tasks referencing them can be validated by the
  // database's foreign key once they're uploaded.
  // A caller-supplied expectedAccountId that turns out not to match the live
  // session is reported the same way as "not authenticated at all" — the
  // migration stops immediately, rather than continuing to write records
  // under a session that no longer matches the account the caller verified.
  const isAuthFailure = (type: string) =>
    type === 'unauthenticated' || type === 'unconfigured' || type === 'account-mismatch';

  for (const project of local.projects) {
    const result = await upsertProject(project, expectedAccountId);
    if (result.ok) {
      uploaded.projects += 1;
      migratedProjectIds.add(project.id);
    } else {
      if (isAuthFailure(result.error.type)) {
        return {
          ok: false,
          attempted,
          uploaded,
          uploadFailures,
          verification: null,
          authError: result.error.message,
        };
      }
      uploadFailures.push({
        entity: 'project',
        id: project.id,
        label: project.name,
        message: result.error.message,
      });
    }
  }

  for (const task of local.tasks) {
    const result = await upsertTask(task, expectedAccountId);
    if (result.ok) {
      uploaded.tasks += 1;
      migratedTaskIds.add(task.id);
    } else {
      if (isAuthFailure(result.error.type)) {
        return {
          ok: false,
          attempted,
          uploaded,
          uploadFailures,
          verification: null,
          authError: result.error.message,
        };
      }
      uploadFailures.push({
        entity: 'task',
        id: task.id,
        label: task.title,
        message: result.error.message,
      });
    }
  }

  for (const note of local.dailyNotes) {
    const result = await upsertDailyNote(note, expectedAccountId);
    if (result.ok) {
      uploaded.dailyNotes += 1;
      migratedNoteIds.add(note.id);
    } else {
      if (isAuthFailure(result.error.type)) {
        return {
          ok: false,
          attempted,
          uploaded,
          uploadFailures,
          verification: null,
          authError: result.error.message,
        };
      }
      uploadFailures.push({
        entity: 'dailyNote',
        id: note.id,
        label: note.date,
        message: result.error.message,
      });
    }
  }

  // Re-read from Supabase and verify: every record we believe we uploaded
  // must actually be present, with matching key fields. Do not report
  // success unless this passes.
  const [projectsResult, tasksResult, notesResult] = await Promise.all([
    listProjects(),
    listTasks(),
    listDailyNotes(),
  ]);

  if (!projectsResult.ok || !tasksResult.ok || !notesResult.ok) {
    const failed = !projectsResult.ok ? projectsResult : !tasksResult.ok ? tasksResult : notesResult;
    const message = !failed.ok ? failed.error.message : 'unknown verification error';
    return {
      ok: false,
      attempted,
      uploaded,
      uploadFailures,
      verification: {
        passed: false,
        cloudCountsAfter: zeroCounts(),
        issues: [
          {
            entity: 'project',
            id: '',
            label: '',
            reason: `Could not re-read Supabase to verify the migration: ${message}`,
          },
        ],
      },
    };
  }

  const cloudProjects = projectsResult.data;
  const cloudTasks = tasksResult.data;
  const cloudNotes = notesResult.data;

  const projectById = new Map(cloudProjects.map((p) => [p.id, p]));
  const taskById = new Map(cloudTasks.map((t) => [t.id, t]));
  const noteById = new Map(cloudNotes.map((n) => [n.id, n]));

  const issues: MigrationVerificationIssue[] = [];

  for (const project of local.projects) {
    if (!migratedProjectIds.has(project.id)) continue;
    const cloud = projectById.get(project.id);
    if (!cloud) {
      issues.push({
        entity: 'project',
        id: project.id,
        label: project.name,
        reason: 'not found in Supabase after migration',
      });
    } else if (cloud.name !== project.name || cloud.status !== project.status) {
      issues.push({
        entity: 'project',
        id: project.id,
        label: project.name,
        reason: 'name or status does not match the local record',
      });
    }
  }

  for (const task of local.tasks) {
    if (!migratedTaskIds.has(task.id)) continue;
    const cloud = taskById.get(task.id);
    if (!cloud) {
      issues.push({
        entity: 'task',
        id: task.id,
        label: task.title,
        reason: 'not found in Supabase after migration',
      });
    } else if (cloud.title !== task.title || cloud.status !== task.status) {
      issues.push({
        entity: 'task',
        id: task.id,
        label: task.title,
        reason: 'title or status does not match the local record',
      });
    }
  }

  for (const note of local.dailyNotes) {
    if (!migratedNoteIds.has(note.id)) continue;
    const cloud = noteById.get(note.id);
    if (!cloud) {
      issues.push({
        entity: 'dailyNote',
        id: note.id,
        label: note.date,
        reason: 'not found in Supabase after migration',
      });
    } else if (
      cloud.date !== note.date ||
      cloud.morning !== note.morning ||
      cloud.evening !== note.evening
    ) {
      issues.push({
        entity: 'dailyNote',
        id: note.id,
        label: note.date,
        reason: 'content does not match the local record',
      });
    }
  }

  const verificationPassed = issues.length === 0;

  return {
    ok: uploadFailures.length === 0 && verificationPassed,
    attempted,
    uploaded,
    uploadFailures,
    verification: {
      passed: verificationPassed,
      cloudCountsAfter: {
        projects: cloudProjects.length,
        tasks: cloudTasks.length,
        dailyNotes: cloudNotes.length,
      },
      issues,
    },
  };
}
