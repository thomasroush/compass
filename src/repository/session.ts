import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import { makeError, type RepositoryResult } from './types';

const UNCONFIGURED_MESSAGE =
  'Cloud storage is unavailable because this app is not connected to Supabase.';
const UNAUTHENTICATED_MESSAGE = 'You must be signed in to access cloud data.';
const ACCOUNT_MISMATCH_MESSAGE =
  'This operation was blocked because the signed-in account changed before it completed. No data was written.';

export interface AuthenticatedSession {
  userId: string;
  client: SupabaseClient;
}

/**
 * Resolves the current user id from the live Supabase session — never from a
 * caller-supplied value — so repository functions can't be pointed at
 * another user's data. Returns a typed error instead of throwing when
 * Supabase isn't configured or nobody is signed in.
 */
export async function getAuthenticatedSession(): Promise<RepositoryResult<AuthenticatedSession>> {
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, error: makeError('unconfigured', UNCONFIGURED_MESSAGE) };
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    return { ok: false, error: makeError('database', error.message) };
  }

  const userId = data.session?.user.id;
  if (!userId) {
    return { ok: false, error: makeError('unauthenticated', UNAUTHENTICATED_MESSAGE) };
  }

  return { ok: true, data: { userId, client: supabase } };
}

export interface AccountScopedSession {
  userId: string;
  /**
   * A freshly constructed Supabase client whose Authorization header is
   * pinned to the exact access token read by this call's single
   * `auth.getSession()` lookup — never the shared ambient `supabase`
   * singleton. That client's session can change (sign-out, sign-in as a
   * different account) after this function returns and before a caller's
   * subsequent `await` resumes; a client built from an ambient lookup taken
   * at that later moment could therefore authenticate as a different
   * account than the one this call verified. This client cannot: its
   * identity was fixed the instant it was constructed, from a token already
   * proven to belong to `expectedAccountId`, and it is configured not to
   * persist or refresh that session, so it never drifts to reflect a later
   * sign-in/out either.
   */
  client: SupabaseClient;
}

const pinnedClientUrl = import.meta.env.VITE_SUPABASE_URL as string;
const pinnedClientKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

function createPinnedClient(accessToken: string): SupabaseClient {
  return createClient(pinnedClientUrl, pinnedClientKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    // Never persists to or reads from localStorage, and never attempts a
    // background token refresh — this client exists only to make the one
    // call it was pinned for, using exactly the token verified below, and
    // must not become a second, independently-mutating session of its own.
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Like `getAuthenticatedSession`, but additionally verifies that the live
 * session belongs to `expectedAccountId` before returning anything usable,
 * and returns a client pinned to that verified session's access token
 * rather than the ambient, mutable `supabase` singleton.
 *
 * This exists to close a real gap `getAuthenticatedSession` has: a caller
 * that checks "is the current account still A?" and then separately calls a
 * repository function has a window between those two steps in which a
 * sign-out or a different sign-in can land — the repository function's own
 * (separate) session lookup would then act on the new account, not the one
 * the caller verified. Folding the check and the credential into one
 * function call, backed by a client whose credential cannot drift after
 * this call returns, removes that window rather than merely narrowing it.
 *
 * `expectedAccountId` is used for exactly one thing: an equality comparison
 * against the live session's user id. It is never sent to Supabase, never
 * used to construct a filter, and never used to select or authorize which
 * account is acted on — a mismatch fails closed, before any table access is
 * attempted, rather than acting on `expectedAccountId`'s behalf.
 *
 * Reads the session exactly once. Not yet called from anywhere — a later
 * phase wires this into account-scoped repository writes.
 */
export async function getAuthenticatedSessionFor(
  expectedAccountId: string,
): Promise<RepositoryResult<AccountScopedSession>> {
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, error: makeError('unconfigured', UNCONFIGURED_MESSAGE) };
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    return { ok: false, error: makeError('database', error.message) };
  }

  const session: Session | null = data.session;
  if (!session) {
    return { ok: false, error: makeError('unauthenticated', UNAUTHENTICATED_MESSAGE) };
  }

  if (session.user.id !== expectedAccountId) {
    return { ok: false, error: makeError('account-mismatch', ACCOUNT_MISMATCH_MESSAGE) };
  }

  return {
    ok: true,
    data: { userId: session.user.id, client: createPinnedClient(session.access_token) },
  };
}
