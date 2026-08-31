import type { RepositoryErrorType } from '../repository/types';

/**
 * Pure classification of what a device should do about cloud/local data on
 * sign-in or app startup. This module performs no I/O, reads no storage, and
 * calls nothing in src/repository — it only classifies a situation the
 * caller has already gathered the facts for. Wiring a caller that actually
 * gathers those facts (via src/repository's listX/getCloudCounts) and acts
 * on the decision is out of scope for Phase 5B1; see
 * SUPABASE_IMPLEMENTATION_PLAN.md Phase 5B1 for why activation is deferred.
 */

export interface EntityCounts {
  projects: number;
  tasks: number;
  dailyNotes: number;
}

function isEmptyCounts(counts: EntityCounts): boolean {
  return counts.projects === 0 && counts.tasks === 0 && counts.dailyNotes === 0;
}

export type CloudCountsResult =
  | { ok: true; counts: EntityCounts }
  | { ok: false; error: { type: RepositoryErrorType; message: string } };

export interface HydrationInput {
  authStatus: 'signedOut' | 'signedIn';
  /** Counts of this device's current local AppData. Always available — local data always loads synchronously. */
  localCounts: EntityCounts;
  /** Result of reading cloud counts for the signed-in account. Ignored when signed out. */
  cloud: CloudCountsResult;
  /**
   * Whether this device has an established sync relationship with the
   * signed-in account (AccountSyncMetadata.established). Ignored when
   * signed out or when the cloud read failed.
   */
  deviceEstablished: boolean;
}

export type HydrationDecision =
  | { kind: 'signed-out' }
  | { kind: 'cloud-query-failed'; errorType: RepositoryErrorType; message: string }
  | { kind: 'both-empty' }
  | { kind: 'hydrate-from-cloud' }
  | { kind: 'await-explicit-migration' }
  | { kind: 'require-explicit-choice' }
  | { kind: 'sync-established' };

/**
 * Classifies the startup/sign-in situation into exactly one decision:
 *  - signed-out                 -> do nothing; stay local-only.
 *  - cloud-query-failed         -> network/database error reading cloud counts; keep showing local data.
 *  - both-empty                 -> nothing to reconcile either way.
 *  - hydrate-from-cloud         -> cloud has data, local is empty; safe to pull down.
 *  - await-explicit-migration   -> local has data, cloud is empty; this is Phase 5A's existing migration prompt, not an auto-upload.
 *  - require-explicit-choice    -> both sides have data and this device has never linked to this account; never guess, ask.
 *  - sync-established           -> both sides have data and this device already has an established link; normal sync applies (not defined further here).
 */
export function decideHydration(input: HydrationInput): HydrationDecision {
  if (input.authStatus === 'signedOut') {
    return { kind: 'signed-out' };
  }

  if (!input.cloud.ok) {
    return {
      kind: 'cloud-query-failed',
      errorType: input.cloud.error.type,
      message: input.cloud.error.message,
    };
  }

  const cloudEmpty = isEmptyCounts(input.cloud.counts);
  const localEmpty = isEmptyCounts(input.localCounts);

  if (cloudEmpty && localEmpty) return { kind: 'both-empty' };
  if (!cloudEmpty && localEmpty) return { kind: 'hydrate-from-cloud' };
  if (cloudEmpty && !localEmpty) return { kind: 'await-explicit-migration' };

  return input.deviceEstablished ? { kind: 'sync-established' } : { kind: 'require-explicit-choice' };
}
