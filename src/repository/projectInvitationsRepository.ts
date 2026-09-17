import { projectInvitationFromRow, type ProjectInvitationRow } from './mappers';
import { getAuthenticatedSession, getAuthenticatedSessionFor } from './session';
import { makeError, type ProjectInvitation, type RepositoryResult } from './types';

/**
 * Invitation lifecycle for shared Projects
 * (`public.project_invitations` — see
 * supabase/migrations/20260916120000_add_shared_project_membership.sql).
 * No email is ever sent from here (out of scope for this MVP, per the
 * inspection report); these functions only manage the invitation row itself.
 */

const INVITATION_COLUMNS = 'id,owner_id,project_id,invited_email,status,created_at,responded_at';

/**
 * Same normalization the database performs on insert (and defends with a
 * check constraint) — applied client-side too, so what this device sends
 * already matches what gets stored, rather than relying solely on the
 * database to fix up a mismatched-case or padded address.
 */
export function normalizeInvitationEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Creates a pending invitation for a Project the caller owns. Whether
 * `invitedEmail` belongs to a registered Compass account is never checked
 * here — this app has no admin lookup capability, and does not need one: the
 * invited person's own next sign-in is what makes the invitation visible to
 * them (see `listPendingInvitationsForMe`), regardless of whether their
 * account already existed when this was created. See createProject's doc
 * comment (projectsRepository.ts) for `expectedAccountId`'s role.
 */
export async function createInvitation(
  projectId: string,
  invitedEmail: string,
  expectedAccountId: string,
): Promise<RepositoryResult<ProjectInvitation>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('project_invitations')
    .insert({
      owner_id: userId,
      project_id: projectId,
      invited_email: normalizeInvitationEmail(invitedEmail),
    })
    .select(INVITATION_COLUMNS)
    .single();

  if (error) {
    // Postgres's own stable code for unique_violation — the partial unique
    // index on (owner_id, project_id, invited_email) where status='pending'.
    return { ok: false, error: makeError(error.code === '23505' ? 'duplicate' : 'database', error.message) };
  }
  return { ok: true, data: projectInvitationFromRow(data as unknown as ProjectInvitationRow) };
}

/** Every invitation (any status) the caller has sent for a Project they own. */
export async function listInvitationsForProject(
  projectId: string,
): Promise<RepositoryResult<ProjectInvitation[]>> {
  const session = await getAuthenticatedSession();
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('project_invitations')
    .select(INVITATION_COLUMNS)
    .eq('owner_id', userId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: (data as unknown as ProjectInvitationRow[]).map(projectInvitationFromRow) };
}

/**
 * Pending invitations addressed to the caller — never filtered by a
 * client-supplied email; `project_invitations`' RLS
 * (`project_invitations_select_invited`) already restricts visibility to
 * rows matching the caller's own authenticated JWT email
 * (`invited_email = auth.email()`). `owner_id <> caller` distinguishes "sent
 * to me" from "sent by me" without needing to know the caller's own email
 * client-side at all: RLS only ever returns rows the caller is either the
 * owner of or the invited party for, so excluding rows the caller owns
 * leaves exactly the ones addressed to them (the rare case of inviting one's
 * own email is not a case this needs to handle specially).
 */
export async function listPendingInvitationsForMe(): Promise<RepositoryResult<ProjectInvitation[]>> {
  const session = await getAuthenticatedSession();
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('project_invitations')
    .select(INVITATION_COLUMNS)
    .eq('status', 'pending')
    .neq('owner_id', userId)
    .order('created_at', { ascending: true });

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: (data as unknown as ProjectInvitationRow[]).map(projectInvitationFromRow) };
}

/**
 * Accepts the caller's own pending invitation through the database's
 * `accept_project_invitation` function — never re-implemented as a plain
 * update here, so the insert-membership-then-mark-accepted sequence stays
 * atomic exactly as the migration designed it (see that function's own
 * comment). The function itself re-verifies the invitation belongs to the
 * caller's authenticated email; no email or invitation ownership is ever
 * asserted client-side. See createProject's doc comment for
 * `expectedAccountId`'s role.
 */
export async function acceptInvitation(
  invitationId: string,
  expectedAccountId: string,
): Promise<RepositoryResult<void>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { client } = session.data;

  const { error } = await client.rpc('accept_project_invitation', { p_invitation_id: invitationId });

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: undefined };
}

/**
 * Declines the caller's own pending invitation. A single UPDATE is already
 * atomic on its own (unlike accept, this never creates a membership row), so
 * no database function is needed — `project_invitations`' RLS
 * (`project_invitations_decline_own`) is what actually restricts this to the
 * caller's own pending invitation; the `.eq('status', 'pending')` filter
 * here only produces a clean "not found" instead of a silent no-op update.
 */
export async function declineInvitation(
  invitationId: string,
  expectedAccountId: string,
): Promise<RepositoryResult<ProjectInvitation>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { client } = session.data;

  const { data, error } = await client
    .from('project_invitations')
    .update({ status: 'declined', responded_at: new Date().toISOString() })
    .eq('id', invitationId)
    .eq('status', 'pending')
    .select(INVITATION_COLUMNS)
    .maybeSingle();

  if (error) return { ok: false, error: makeError('database', error.message) };
  if (!data) {
    return {
      ok: false,
      error: makeError(
        'conflict',
        'This invitation is no longer pending, or does not belong to your account.',
      ),
    };
  }
  return { ok: true, data: projectInvitationFromRow(data as unknown as ProjectInvitationRow) };
}

/**
 * Revokes a still-pending invitation the caller owns. `owner_id` is filtered
 * explicitly (in addition to `project_invitations_revoke_own`'s own RLS
 * check) for the same defense-in-depth reason every mutating function in
 * this app scopes its own filter, not only relying on RLS.
 */
export async function revokeInvitation(
  invitationId: string,
  expectedAccountId: string,
): Promise<RepositoryResult<ProjectInvitation>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('project_invitations')
    .update({ status: 'revoked' })
    .eq('owner_id', userId)
    .eq('id', invitationId)
    .eq('status', 'pending')
    .select(INVITATION_COLUMNS)
    .maybeSingle();

  if (error) return { ok: false, error: makeError('database', error.message) };
  if (!data) {
    return {
      ok: false,
      error: makeError('conflict', 'This invitation is no longer pending, or is not one of yours.'),
    };
  }
  return { ok: true, data: projectInvitationFromRow(data as unknown as ProjectInvitationRow) };
}
