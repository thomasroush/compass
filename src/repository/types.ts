import type { DailyNote, Project, Task } from '../types';

/**
 * App-shaped records as read from Supabase, augmented with the database's
 * `updated_at`. The app's own Task/Project/DailyNote types stay unchanged —
 * `updatedAt` is cloud-only, kept for a later phase's conflict handling.
 */
export type CloudProject = Project & { updatedAt: string };
export type CloudTask = Task & { updatedAt: string };
export type CloudDailyNote = DailyNote & { updatedAt: string };

/**
 * 'conflict' is returned only by a guarded (compare-and-swap) update whose
 * expected `updated_at` no longer matches the server row — i.e. someone else
 * (another device) wrote to it first. It is distinct from 'database', which
 * means the query itself failed.
 */
export type RepositoryErrorType = 'unconfigured' | 'unauthenticated' | 'database' | 'conflict';

export interface RepositoryError {
  type: RepositoryErrorType;
  /** Plain, user-safe message. Never a token, key, or session detail. */
  message: string;
}

export type RepositoryResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: RepositoryError };

export function makeError(type: RepositoryErrorType, message: string): RepositoryError {
  return { type, message };
}
