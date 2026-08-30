import type { SupabaseClient } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import { makeError, type RepositoryResult } from './types';

const UNCONFIGURED_MESSAGE =
  'Cloud storage is unavailable because this app is not connected to Supabase.';
const UNAUTHENTICATED_MESSAGE = 'You must be signed in to access cloud data.';

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
