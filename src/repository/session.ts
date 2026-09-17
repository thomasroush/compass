import type { Session, SupabaseClient } from '@supabase/supabase-js';
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

/**
 * The only two methods any repository function ever calls on
 * `AccountScopedSession.client` (verified across every file in
 * src/repository/*.ts) — narrowed to exactly this surface, rather than the
 * full `SupabaseClient`, so that surface is the only thing
 * `pinAuthorizationHeader` below needs to implement.
 */
export type QueryCapableClient = Pick<SupabaseClient, 'from' | 'rpc'>;

export interface AccountScopedSession {
  userId: string;
  /**
   * The shared ambient Supabase client (`../lib/supabaseClient`) — never a
   * second, independently constructed `SupabaseClient` — with every request
   * built through `.from(...)`/`.rpc(...)` carrying a fixed `Authorization`
   * header pinned to the access token this call already verified belongs to
   * `expectedAccountId`. See `pinAuthorizationHeader`'s doc comment for why
   * this closes the same race a second client used to, without the cost
   * (and the bug) a second client brought with it.
   */
  client: QueryCapableClient;
}

/**
 * A postgrest-js query/RPC builder, once `.select()`/`.insert()`/`.update()`/
 * `.upsert()`/`.delete()`/`.rpc()` has been called, exposes `setHeader(name,
 * value)` — a documented escape hatch ("passing a custom Authorization for a
 * single query," see `@supabase/postgrest-js`'s `PostgrestBuilder`) that
 * overrides one header on that one request and returns the same builder for
 * further chaining. This is the only method `pinAuthorizationHeader` needs
 * from that builder.
 */
interface HeaderSettable {
  setHeader(name: string, value: string): HeaderSettable;
}

/**
 * `client.from(table)` returns a `PostgrestQueryBuilder`; calling one of
 * these on it constructs a *new* `PostgrestFilterBuilder` object (it does not
 * inherit anything set on the query builder itself) — this is the exact list
 * of methods whose return value needs the pinned header applied. Every other
 * chained call after one of these (`.eq()`, `.order()`, `.single()`, ...)
 * already returns that same, now-pinned builder instance in postgrest-js's
 * fluent API, so nothing further needs wrapping.
 */
const PINNABLE_QUERY_METHODS = ['select', 'insert', 'update', 'upsert', 'delete'] as const;

/**
 * Wraps the ambient Supabase client so every request issued through the
 * returned object's `.from(...)`/`.rpc(...)` carries a fixed `Authorization:
 * Bearer <accessToken>` header — the exact token this call already verified
 * belongs to `expectedAccountId` — regardless of what the *live* session
 * happens to be by the time the request actually goes out. This is what
 * closes the race `getAuthenticatedSessionFor` exists for (see its own doc
 * comment), without constructing a second `SupabaseClient`.
 *
 * A second client was the previous approach here, and it was a real, live
 * bug: every `SupabaseClient` also constructs its own internal GoTrue
 * (auth) client, and since this one was never given a distinct storage key,
 * it shared the ambient client's default one — `@supabase/auth-js` detects
 * that as "Multiple GoTrueClient instances" and warns, but the deeper
 * problem is that there is now more than one client, and more than one
 * place `VITE_SUPABASE_PUBLISHABLE_KEY` could end up wired in incorrectly,
 * for no benefit `setHeader` doesn't already provide. There is now exactly
 * one `SupabaseClient` in the whole app, exactly one place its URL/key are
 * read, and this function only ever asks that one client to attach one
 * extra header to one request.
 *
 * Uses a `Proxy` around the `PostgrestQueryBuilder` `client.from(table)`
 * returns, rather than copying its properties, because that builder is a
 * real class instance whose methods close over private instance state via
 * `this` — `Reflect.get`/`.apply(target, ...)`/`.bind(target)` preserve that
 * exactly; a plain object spread would not.
 */
function pinAuthorizationHeader(client: SupabaseClient, accessToken: string): QueryCapableClient {
  const authorization = `Bearer ${accessToken}`;

  const from: SupabaseClient['from'] = ((relation: Parameters<SupabaseClient['from']>[0]) => {
    const queryBuilder = client.from(relation);
    return new Proxy(queryBuilder as object, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== 'function') return value;
        if ((PINNABLE_QUERY_METHODS as readonly (string | symbol)[]).includes(prop)) {
          return (...args: unknown[]) =>
            (value as (...a: unknown[]) => HeaderSettable)
              .apply(target, args)
              .setHeader('Authorization', authorization);
        }
        return value.bind(target);
      },
    }) as ReturnType<SupabaseClient['from']>;
  }) as SupabaseClient['from'];

  const rpc: SupabaseClient['rpc'] = ((fn: string, args?: object, options?: object) =>
    (client.rpc as (...a: unknown[]) => HeaderSettable)(fn, args, options).setHeader(
      'Authorization',
      authorization,
    )) as SupabaseClient['rpc'];

  return { from, rpc };
}

/**
 * Like `getAuthenticatedSession`, but additionally verifies that the live
 * session belongs to `expectedAccountId` before returning anything usable,
 * and returns a client whose every request carries that verified session's
 * access token — see `pinAuthorizationHeader` — rather than the ambient,
 * mutable session state a plain call could otherwise race against.
 *
 * This exists to close a real gap `getAuthenticatedSession` has: a caller
 * that checks "is the current account still A?" and then separately calls a
 * repository function has a window between those two steps in which a
 * sign-out or a different sign-in can land — the repository function's own
 * (separate) session lookup would then act on the new account, not the one
 * the caller verified. Folding the check and the credential into one
 * function call, backed by a pinned header that cannot drift after this call
 * returns, removes that window rather than merely narrowing it.
 *
 * `expectedAccountId` is used for exactly one thing: an equality comparison
 * against the live session's user id. It is never sent to Supabase, never
 * used to construct a filter, and never used to select or authorize which
 * account is acted on — a mismatch fails closed, before any table access is
 * attempted, rather than acting on `expectedAccountId`'s behalf.
 *
 * Reads the session exactly once.
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
    data: { userId: session.user.id, client: pinAuthorizationHeader(supabase, session.access_token) },
  };
}
