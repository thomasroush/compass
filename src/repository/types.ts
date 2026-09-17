import type { QuickNote, Goal, Project, Target, Task } from '../types';

/**
 * App-shaped records as read from Supabase, augmented with the database's
 * `updated_at`. The app's own Task/Project/QuickNote/Goal/Target types stay
 * unchanged — `updatedAt` is cloud-only, kept for a later phase's conflict
 * handling.
 */
export type CloudProject = Project & { updatedAt: string };
export type CloudTask = Task & { updatedAt: string };
export type CloudQuickNote = QuickNote & { updatedAt: string };
export type CloudGoal = Goal & { updatedAt: string };
export type CloudTarget = Target & { updatedAt: string };

/**
 * Shared-Projects collaboration types. These mirror
 * supabase/migrations/20260916120000_add_shared_project_membership.sql
 * exactly (same field set, same allowed values) and deliberately live here
 * rather than in src/types.ts: unlike Task/Project/Goal/etc., a membership or
 * invitation is never part of the offline-first `AppData` model — it is
 * always read live from Supabase, never cached in localStorage or synced
 * through hydrateFromCloud/refreshFromCloud/drainSync.
 *
 * 'editor' is the only Project role this MVP's database defines
 * (`project_members.role check (role = 'editor')`) — do not add another
 * value here without a matching migration.
 */
export const PROJECT_ROLES = ['editor'] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

/** Matches `project_invitations.status`'s check constraint exactly. */
export const INVITATION_STATUSES = ['pending', 'accepted', 'declined', 'revoked'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/**
 * Mirrors public.project_members. `ownerId` is the Project Owner's user_id
 * (the Project's implicit owner); `memberId` is the accepted Editor.
 * `memberEmail` is the collaborator's normalized email at the time they
 * accepted (recorded by `accept_project_invitation`, from their own
 * authenticated JWT — never a client-supplied value) — `undefined` only for
 * a membership row that predates this field
 * (20260917120000_add_member_email_to_project_members.sql).
 */
export interface ProjectMember {
  ownerId: string;
  projectId: string;
  memberId: string;
  memberEmail?: string;
  role: ProjectRole;
  createdAt: string;
}

/** Mirrors public.project_invitations. `invitedEmail` is always the normalized (trimmed, lowercased) form the database itself stores. */
export interface ProjectInvitation {
  id: string;
  ownerId: string;
  projectId: string;
  invitedEmail: string;
  status: InvitationStatus;
  createdAt: string;
  /** Set only once the invited user accepts or declines — never set by a revoke. See the migration's own comment on this column. */
  respondedAt?: string;
}

/**
 * 'conflict' is returned only by a guarded (compare-and-swap) update whose
 * expected `updated_at` no longer matches the server row — i.e. someone else
 * (another device) wrote to it first. It is distinct from 'database', which
 * means the query itself failed.
 *
 * 'account-mismatch' is returned only by `getAuthenticatedSessionFor` (see
 * repository/session.ts) when the live Supabase session belongs to a
 * different account than the one a caller expected — e.g. a queued write
 * whose owning account signed out and a different account signed in before
 * the write ran. It is distinct from 'unauthenticated' (nobody signed in at
 * all) and is fail-closed: it is never used to select or authorize an
 * account, only to refuse acting on behalf of the wrong one.
 *
 * 'duplicate' is returned only by `createX` when the insert violates a
 * unique constraint — detected from Postgres's own stable SQLSTATE code
 * (`23505`, `unique_violation`) on the returned `PostgrestError`, not by
 * matching the error's free-text message. Most commonly this means a row
 * with this id already exists for this user (e.g. from Phase 5A migration,
 * or a "create succeeded but the response was lost" retry) — the caller is
 * expected to re-read the existing row and decide how to proceed, never to
 * treat the duplicate itself as permission to overwrite.
 */
export type RepositoryErrorType =
  | 'unconfigured'
  | 'unauthenticated'
  | 'database'
  | 'conflict'
  | 'account-mismatch'
  | 'duplicate';

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
