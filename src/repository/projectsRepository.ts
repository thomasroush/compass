import type { Project } from '../types';
import {
  projectFromRow,
  projectFromRowWithOwner,
  projectToInsertRow,
  projectUpdatesToRow,
  type ProjectRow,
  type ProjectRowWithOwner,
} from './mappers';
import { getAuthenticatedSession, getAuthenticatedSessionFor } from './session';
import { makeError, type CloudProject, type RepositoryResult } from './types';

const PROJECT_COLUMNS = 'id,name,description,status,priority_rank,updated_at';
const PROJECT_COLUMNS_WITH_OWNER = 'id,user_id,name,description,status,priority_rank,updated_at';

export async function listProjects(): Promise<RepositoryResult<CloudProject[]>> {
  const session = await getAuthenticatedSession();
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('projects')
    .select(PROJECT_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: (data as unknown as ProjectRow[]).map(projectFromRow) };
}

/**
 * Reads every Project visible to the signed-in user: their own, plus any
 * shared Project they've been added to as an Editor. Unlike `listProjects`,
 * this issues no `user_id` filter at all — `public.projects`' RLS
 * (`projects_select_own` OR `projects_select_member`, see
 * supabase/migrations/20260916120000_add_shared_project_membership.sql) is
 * the only thing narrowing the rows returned, which is the "RLS as the final
 * security boundary" this read is meant to rely on. Each row's real owner is
 * preserved as `ownerId`, mapped from that row's own `user_id` column — never
 * assumed to be the caller, so an owned Project can always be told apart from
 * a shared one.
 *
 * Not called from anywhere yet. `hydrateFromCloud`/`refreshFromCloud`/
 * `drainSync` keep using `listProjects`, unchanged, until a later stage wires
 * shared data into the sync engine.
 */
export async function listVisibleProjects(): Promise<RepositoryResult<CloudProject[]>> {
  const session = await getAuthenticatedSession();
  if (!session.ok) return session;
  const { client } = session.data;

  const { data, error } = await client
    .from('projects')
    .select(PROJECT_COLUMNS_WITH_OWNER)
    .order('created_at', { ascending: true });

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: (data as unknown as ProjectRowWithOwner[]).map(projectFromRowWithOwner) };
}

/**
 * `expectedAccountId` is required (Phase 5B3A, task 2 of 3 — see
 * SUPABASE_IMPLEMENTATION_PLAN.md decision 13) and is routed through
 * `getAuthenticatedSessionFor`, which fails closed with a typed
 * `'account-mismatch'` error, before any table access, if the live session
 * no longer belongs to that account.
 */
export async function createProject(
  project: Project,
  expectedAccountId: string,
): Promise<RepositoryResult<CloudProject>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('projects')
    .insert(projectToInsertRow(userId, project))
    .select(PROJECT_COLUMNS)
    .single();

  if (error) {
    // Postgres's own stable code for unique_violation — see RepositoryErrorType's doc comment.
    return { ok: false, error: makeError(error.code === '23505' ? 'duplicate' : 'database', error.message) };
  }
  return { ok: true, data: projectFromRow(data as unknown as ProjectRow) };
}

/**
 * Inserts or updates a project by its stable (user_id, id) identity — the same
 * composite primary key Phase 2's schema defines. Used by Phase 5A migration
 * (`repository/migration.ts`) to push existing local records into the cloud
 * with their ids preserved: a record that already exists (same id, same
 * authenticated user) is updated in place rather than duplicated; a new one
 * is inserted.
 *
 * `expectedAccountId` is required (Phase 5B3A, task 2 of 3 — see
 * SUPABASE_IMPLEMENTATION_PLAN.md decision 13) and is routed through
 * `getAuthenticatedSessionFor`, same as `createProject`. Migration passes the
 * account id its own authenticated flow already established (see
 * `migration.ts`'s `runMigration` and `MigrationPanel.tsx`), not a value read
 * from the records being migrated — a mismatch fails closed with a typed
 * `'account-mismatch'` error before any table access, exactly like every
 * other mutating function here.
 */
export async function upsertProject(
  project: Project,
  expectedAccountId: string,
): Promise<RepositoryResult<CloudProject>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('projects')
    .upsert(projectToInsertRow(userId, project), { onConflict: 'user_id,id' })
    .select(PROJECT_COLUMNS)
    .single();

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: projectFromRow(data as unknown as ProjectRow) };
}

/**
 * See createProject's doc comment for `expectedAccountId`'s role.
 *
 * `ownerId` targets a shared Project's real Owner row when the caller
 * (verified as `expectedAccountId`) is an Editor updating it, not the Owner —
 * defaults to the caller's own id, i.e. today's private-Project behavior,
 * when omitted. This is not an identity override: `expectedAccountId` is
 * still the only thing that decides *who* this write is authenticated as,
 * exactly as before; `ownerId` only changes *which row* the `user_id` filter
 * targets, so an Editor's update reaches the shared Project's actual row
 * instead of (incorrectly) looking for one under the Editor's own id.
 * `public.projects`' RLS (`projects_update_own` OR `projects_update_member`)
 * is what actually authorizes or refuses the write either way. Not yet
 * called with a real `ownerId` from anywhere — `drainSync` still calls this
 * with only private, self-owned Projects.
 */
export async function updateProject(
  id: string,
  updates: Partial<Pick<Project, 'name' | 'description' | 'status' | 'priorityRank'>>,
  expectedAccountId: string,
  ownerId?: string,
): Promise<RepositoryResult<CloudProject>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('projects')
    .update(projectUpdatesToRow(updates))
    .eq('user_id', ownerId ?? userId)
    .eq('id', id)
    .select(PROJECT_COLUMNS)
    .single();

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: projectFromRow(data as unknown as ProjectRow) };
}

/**
 * Compare-and-swap update: applies `updates` only if the row's current
 * `updated_at` still equals `expectedUpdatedAt`. This is expressed as one
 * additional `.eq('updated_at', ...)` filter on the same UPDATE statement —
 * Postgres evaluates the WHERE clause and applies the write in a single
 * atomic operation, so there is no separate read-then-write step on the
 * client for another device's write to race against. See
 * SUPABASE_IMPLEMENTATION_PLAN.md Phase 5B1 for the full analysis of why this
 * does not require a database RPC. `expectedUpdatedAt` must be the exact
 * `updatedAt` string previously read for this record (from sync metadata),
 * not a reformatted or re-parsed date, so the comparison is exact.
 *
 * Not yet called from any UI or dispatch path — this is the guarded
 * primitive a future phase will wire in once live cloud writes are activated.
 * See createProject's doc comment for `expectedAccountId`'s role, and
 * updateProject's doc comment for `ownerId`'s role (same meaning here —
 * targets a shared Project's real Owner row for an Editor's guarded update,
 * defaults to the caller's own id otherwise; the compare-and-swap on
 * `updated_at` and the resulting `'conflict'` behavior are unchanged either
 * way).
 */
export async function updateProjectGuarded(
  id: string,
  updates: Partial<Pick<Project, 'name' | 'description' | 'status' | 'priorityRank'>>,
  expectedUpdatedAt: string,
  expectedAccountId: string,
  ownerId?: string,
): Promise<RepositoryResult<CloudProject>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { data, error } = await client
    .from('projects')
    .update(projectUpdatesToRow(updates))
    .eq('user_id', ownerId ?? userId)
    .eq('id', id)
    .eq('updated_at', expectedUpdatedAt)
    .select(PROJECT_COLUMNS)
    .maybeSingle();

  if (error) return { ok: false, error: makeError('database', error.message) };
  if (!data) {
    return {
      ok: false,
      error: makeError(
        'conflict',
        'This project changed on the server since it was last read on this device.',
      ),
    };
  }
  return { ok: true, data: projectFromRow(data as unknown as ProjectRow) };
}

/** See createProject's doc comment for `expectedAccountId`'s role. */
export async function deleteProject(
  id: string,
  expectedAccountId: string,
): Promise<RepositoryResult<void>> {
  const session = await getAuthenticatedSessionFor(expectedAccountId);
  if (!session.ok) return session;
  const { userId, client } = session.data;

  const { error } = await client.from('projects').delete().eq('user_id', userId).eq('id', id);

  if (error) return { ok: false, error: makeError('database', error.message) };
  return { ok: true, data: undefined };
}
