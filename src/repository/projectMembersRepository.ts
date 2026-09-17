import { projectMemberFromRow, type ProjectMemberRow } from './mappers';
import { getAuthenticatedSession, getAuthenticatedSessionFor } from './session';
import { makeError, type ProjectMember, type RepositoryResult } from './types';

/**
 * Owner-only access to a shared Project's collaborator roster
 * (`public.project_members` — see
 * supabase/migrations/20260916120000_add_shared_project_membership.sql).
 * There is no member-facing "projects shared with me" read here yet — that
 * is a Stage 3 UI concern, not part of this stage's repository foundation.
 */

const MEMBER_COLUMNS = 'owner_id,project_id,member_id,member_email,role,created_at';

/**
 * Lists the accepted collaborators on a Project the caller owns. Filtered by
 * both `owner_id` and `project_id` (never `project_id` alone) for the same
 * reason every other query in this app scopes by the full owner+id pair:
 * `project_id` is only unique per owner, not globally. `project_members`'
 * RLS (`project_members_select_owner`) independently enforces the same
 * boundary — this filter is defense in depth, not the only thing narrowing
 * the result.
 */
export async function listMembers(projectId: string): Promise<RepositoryResult<ProjectMember[]>> {
  const session = await getAuthenticatedSession();
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('project_members')
    .select(MEMBER_COLUMNS)
    .eq('owner_id', userId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: (data as unknown as ProjectMemberRow[]).map(projectMemberFromRow) };
}

/**
 * Removes a collaborator from a Project the caller owns. This is the only
 * way a membership ever ends in this MVP — there is no member-initiated
 * "leave" (see the migration's own comment on why no such policy exists).
 * See createProject's doc comment (projectsRepository.ts) for
 * `expectedAccountId`'s role.
 */
export async function removeMember(
  projectId: string,
  memberId: string,
  expectedAccountId: string,
): Promise<RepositoryResult<void>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { error } = await client
    .from('project_members')
    .delete()
    .eq('owner_id', userId)
    .eq('project_id', projectId)
    .eq('member_id', memberId);

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: undefined };
}
