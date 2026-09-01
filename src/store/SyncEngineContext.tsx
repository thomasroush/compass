import { createContext, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { drainDirtyWork, type DrainRecordOutcome } from '../sync/drainSync';
import { countDirty, getAccountMetadata } from '../sync/metadata';
import { loadSyncMetadataStore } from '../sync/metadataStorage';
import { useApp } from './useApp';
import { useAuth } from './useAuth';

/**
 * Phase 5B3B — the drain loop's React wrapper. Owns single-flight
 * scheduling, bounded retry-on-network-failure, the account-linking gate,
 * and the minimal sync status this phase calls for. `src/sync/drainSync.ts`
 * owns the actual per-record Supabase calls; this file only decides *when*
 * it is safe to call it and reflects the outcome as status.
 *
 * Bounded backoff policy (documented here and in
 * SUPABASE_IMPLEMENTATION_PLAN.md — "Phase 5B3B"): a drain pass that stops
 * early because of a network-level failure (a thrown/rejected repository
 * call, not a structured error response) schedules exactly one retry of the
 * whole pass, after `BASE_RETRY_DELAY_MS * 2^attempt`, capped at
 * `MAX_RETRY_DELAY_MS`, up to `MAX_RETRY_ATTEMPTS` consecutive network
 * failures. After that many, automatic retry stops — the next *natural*
 * trigger (a further edit, sign-in, or "Sync now") tries again, rather than
 * retrying forever on a fixed timer. The attempt counter resets to zero the
 * moment any drain pass completes without a network failure.
 *
 * **Account-linking gate.** Signing in is not, by itself, authorization to
 * treat whatever this browser already has in `localStorage` as belonging to
 * the signed-in account (SUPABASE_IMPLEMENTATION_PLAN.md decision 9: "never
 * guess, never auto-upload"). This device must first have gone through one
 * of the plan's approved account-link decisions for *this* account — a
 * verified-successful Phase 5A migration, or Phase 5B2 hydration reaching
 * `'hydrate-from-cloud'` or the safe `'both-empty'` case — each of which
 * sets the existing `AccountSyncMetadata.established` flag (reused
 * unchanged from Phase 5B1/5B2; no new format). `attemptDrain` checks this
 * itself, as the single point of enforcement — not just the effect that
 * calls it — so `syncNow()` inherits the same gate with no separate check to
 * keep in sync, and cannot bypass it. Until established, dirty-marking
 * still happens (`AppContext.tsx` — safe, no network call), but no
 * repository mutation is ever attempted, and status reports `'unlinked'`,
 * never `'synced'`.
 */

const BASE_RETRY_DELAY_MS = 2000;
const MAX_RETRY_DELAY_MS = 30000;
const MAX_RETRY_ATTEMPTS = 5;

export type SyncStatus =
  | 'idle'
  | 'unlinked'
  | 'pending'
  | 'syncing'
  | 'synced'
  | 'conflict'
  | 'offline'
  | 'error';

export interface SyncEngineState {
  status: SyncStatus;
  /** Durable pending-record count for the signed-in account, read fresh from `daily-compass-sync-v1`. */
  pendingCount: number;
  message: string | null;
  /** Safe to call any time — while signed out it is a no-op, while already syncing it queues one more pass. */
  syncNow: () => void;
}

export const SyncEngineContext = createContext<SyncEngineState | null>(null);

function outcomeMessage(outcome: DrainRecordOutcome): string | null {
  switch (outcome.kind) {
    case 'conflict':
      return outcome.message;
    case 'account-error':
      return outcome.message;
    case 'network-error':
      return 'Could not reach the server. Changes are saved on this device and will sync when back online.';
    case 'record-error':
      return outcome.message;
    default:
      return null;
  }
}

export function SyncEngineProvider({ children }: { children: ReactNode }) {
  const { state, syncGeneration } = useApp();
  const auth = useAuth();

  const [status, setStatus] = useState<SyncStatus>('idle');
  const [pendingCount, setPendingCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const stateRef = useRef(state);
  stateRef.current = state;

  const isDrainingRef = useRef(false);
  const pendingRerunRef = useRef(false);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);

  const accountId = auth.isSupabaseConfigured ? (auth.user?.id ?? null) : null;
  const accountIdRef = useRef(accountId);
  accountIdRef.current = accountId;

  const clearScheduledRetry = useCallback(() => {
    if (retryTimeoutRef.current !== null) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  const refreshIdleStatus = useCallback(
    (forAccountId: string | null) => {
      if (!forAccountId) {
        setStatus('idle');
        setPendingCount(0);
        return;
      }
      const meta = getAccountMetadata(loadSyncMetadataStore(), forAccountId);
      const pending = countDirty(meta);
      setPendingCount(pending);
      if (!meta.established) {
        setStatus('unlinked');
        return;
      }
      setStatus(pending === 0 ? 'synced' : 'pending');
    },
    [],
  );

  const attemptDrain = useCallback(
    async (forAccountId: string) => {
      if (isDrainingRef.current) {
        pendingRerunRef.current = true;
        return;
      }

      // The account-linking gate — see this file's top doc comment. Checked
      // here, not only by the calling effect, so `syncNow()` (which calls
      // `attemptDrain` directly) inherits the same enforcement and cannot
      // bypass it. No repository mutation is reachable past this point
      // without `established` being true for this exact account.
      const preCheck = getAccountMetadata(loadSyncMetadataStore(), forAccountId);
      if (!preCheck.established) {
        setStatus('unlinked');
        setPendingCount(countDirty(preCheck));
        setMessage(null);
        return;
      }

      isDrainingRef.current = true;
      setStatus('syncing');
      const myGeneration = syncGeneration.current();

      const result = await drainDirtyWork(
        forAccountId,
        () => syncGeneration.isCurrent(myGeneration),
        () => stateRef.current,
      );

      isDrainingRef.current = false;

      // The account (or generation) may have moved on while this pass was
      // in flight — never apply this pass's status/UI outcome to a world
      // that has since changed; a fresh check below will reflect reality.
      if (!syncGeneration.isCurrent(myGeneration)) {
        if (accountIdRef.current) refreshIdleStatus(accountIdRef.current);
        return;
      }

      const lastOutcome = result.outcomes[result.outcomes.length - 1];
      const meta = getAccountMetadata(loadSyncMetadataStore(), forAccountId);
      const pending = countDirty(meta);
      setPendingCount(pending);

      if (result.networkFailure) {
        setStatus(pending > 0 ? 'offline' : 'synced');
        setMessage(lastOutcome ? outcomeMessage(lastOutcome) : null);
        retryAttemptRef.current += 1;
        if (retryAttemptRef.current <= MAX_RETRY_ATTEMPTS) {
          const delay = Math.min(BASE_RETRY_DELAY_MS * 2 ** (retryAttemptRef.current - 1), MAX_RETRY_DELAY_MS);
          clearScheduledRetry();
          retryTimeoutRef.current = setTimeout(() => {
            retryTimeoutRef.current = null;
            if (syncGeneration.isCurrent(myGeneration) && accountIdRef.current === forAccountId) {
              void attemptDrain(forAccountId);
            }
          }, delay);
        }
      } else if (result.accountError) {
        retryAttemptRef.current = 0;
        setStatus(pending > 0 ? 'error' : 'synced');
        setMessage(result.accountError.message);
      } else {
        retryAttemptRef.current = 0;
        const hadConflict = result.outcomes.some((o) => o.kind === 'conflict');
        const hadRecordError = result.outcomes.some((o) => o.kind === 'record-error');
        if (pending === 0) {
          setStatus('synced');
          setMessage(null);
        } else if (hadConflict) {
          setStatus('conflict');
          setMessage(lastOutcome ? outcomeMessage(lastOutcome) : null);
        } else if (hadRecordError) {
          setStatus('error');
          setMessage(lastOutcome ? outcomeMessage(lastOutcome) : null);
        } else {
          setStatus('pending');
          setMessage(null);
        }
      }

      if (pendingRerunRef.current && syncGeneration.isCurrent(myGeneration) && accountIdRef.current === forAccountId) {
        pendingRerunRef.current = false;
        void attemptDrain(forAccountId);
      }
    },
    [syncGeneration, clearScheduledRetry, refreshIdleStatus],
  );

  // Automatic draining: after a valid signed-in user edit (state changes),
  // and once an authenticated session becomes available (accountId changes
  // from null), whenever there is durable pending work for this account.
  useEffect(() => {
    if (auth.status !== 'ready') return;
    if (!accountId) {
      setStatus('idle');
      setPendingCount(0);
      setMessage(null);
      return;
    }
    const meta = getAccountMetadata(loadSyncMetadataStore(), accountId);
    if (meta.established && countDirty(meta) > 0) {
      void attemptDrain(accountId);
    } else if (!isDrainingRef.current) {
      refreshIdleStatus(accountId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- attemptDrain/refreshIdleStatus are stable; state is read via stateRef intentionally.
  }, [state, accountId, auth.status]);

  // Sign-out, account switch, and teardown: stop promptly. The generation
  // bump itself (AppContext.tsx) already makes any in-flight drain stop
  // between operations; here we also clear/reset this provider's own
  // scheduled retry and backoff counters so a stale timer never fires a
  // drain for an account that is no longer active.
  useEffect(() => {
    return () => {
      clearScheduledRetry();
      retryAttemptRef.current = 0;
      pendingRerunRef.current = false;
    };
  }, [accountId, clearScheduledRetry]);

  useEffect(() => {
    return () => {
      clearScheduledRetry();
    };
  }, [clearScheduledRetry]);

  const syncNow = useCallback(() => {
    const currentAccountId = accountIdRef.current;
    if (!currentAccountId) return;
    retryAttemptRef.current = 0;
    clearScheduledRetry();
    void attemptDrain(currentAccountId);
  }, [attemptDrain, clearScheduledRetry]);

  const value: SyncEngineState = { status, pendingCount, message, syncNow };

  return <SyncEngineContext.Provider value={value}>{children}</SyncEngineContext.Provider>;
}
