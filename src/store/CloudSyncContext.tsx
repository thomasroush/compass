import { createContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { hydrateFromCloud, type HydratedCloudData } from '../sync/hydrateFromCloud';
import type { EntityCounts } from '../sync/hydration';
import { refreshFromCloud } from '../sync/refreshFromCloud';
import {
  getAccountMetadata,
  markEstablished,
  setLastSyncedAt,
  setRecordUpdatedAt,
  upsertAccountMetadata,
  type AccountSyncMetadata,
} from '../sync/metadata';
import { loadSyncMetadataStore, saveSyncMetadataStore } from '../sync/metadataStorage';
import { useApp } from './useApp';
import { useAuth } from './useAuth';

/**
 * Phase 5B2 — signed-in cloud hydration.
 *
 * This is the first place `src/sync/`'s Phase 5B1 groundwork is actually
 * wired into the running app. It only reads: on sign-in (or on startup when
 * already signed in) it calls `hydrateFromCloud`, and loads the result into
 * `AppContext` via the existing `LOAD` action only when that is the
 * unambiguous, safe case (`decision.kind === 'hydrate-from-cloud'` — cloud
 * has data and this device's local data was empty). Every other outcome
 * (signed out, cloud read failed, both empty, local-only awaiting Phase 5A's
 * migration, or both sides populated with no established link) leaves local
 * data exactly as it was; see `hydrateFromCloud` and `decideHydration` for
 * the full decision table.
 *
 * No cloud write is made anywhere in this file — only device-local sync
 * metadata (`src/sync/metadataStorage.ts`, a separate storage key from
 * `AppData`) is updated, and only after a successful hydration (or a
 * both-empty decision — see below), to record that this device is now
 * linked to the account and what server `updated_at` it has seen for each
 * record it just loaded. That bookkeeping is what Phase 5B3B's write-back
 * needs, both as the source of each record's guarded-update baseline and —
 * via the same `established` flag — as the account-linking gate that
 * `SyncEngineContext.tsx` requires before it will drain any local edit to
 * this account; it is never sent to Supabase.
 */

export type CloudSyncStatus =
  | 'idle'
  | 'loading'
  | 'hydrated'
  | 'up-to-date'
  | 'needs-choice'
  | 'error';

export interface CloudSyncState {
  status: CloudSyncStatus;
  message: string | null;
  localCounts: EntityCounts | null;
  cloudCounts: EntityCounts | null;
  /** Re-runs the last hydration attempt. Only meaningful while status is 'error'. */
  retry: () => void;
  /**
   * The user-initiated "Refresh from cloud" action. Unlike `retry`, this also
   * resolves any record that is dirty *and* stuck in conflict (its cloud
   * `updatedAt` no longer matches this device's known baseline, so the drain
   * loop's guarded update can never succeed against it): the server's
   * version is accepted, the local copy is updated, and the record is no
   * longer left dirty. A dirty record that is merely pending (not yet
   * conflicted) is still left alone for the normal drain loop.
   */
  refreshAcceptingServer: () => void;
}

export const CloudSyncContext = createContext<CloudSyncState | null>(null);

function updateMetadataAfterHydration(
  accountMetadata: AccountSyncMetadata,
  hydrated: HydratedCloudData,
): AccountSyncMetadata {
  let next = markEstablished(accountMetadata);
  next = setLastSyncedAt(next, new Date().toISOString());
  for (const project of hydrated.projects) {
    next = setRecordUpdatedAt(next, 'project', project.id, project.updatedAt);
  }
  for (const task of hydrated.tasks) {
    next = setRecordUpdatedAt(next, 'task', task.id, task.updatedAt);
  }
  for (const note of hydrated.dailyNotes) {
    next = setRecordUpdatedAt(next, 'dailyNote', note.id, note.updatedAt);
  }
  return next;
}

export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { state, dispatch } = useApp();
  const [status, setStatus] = useState<CloudSyncStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [localCounts, setLocalCounts] = useState<EntityCounts | null>(null);
  const [cloudCounts, setCloudCounts] = useState<EntityCounts | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Set by `refreshAcceptingServer` just before bumping `attempt`, and
  // consumed (then reset) the next time the effect below actually runs a
  // refresh — so an ordinary `retry()` (or a sign-in) never inherits it.
  const acceptConflictsRef = useRef(false);

  // Read inside the effect via a ref so a hydration in flight always applies
  // to the freshest local state without re-triggering the effect on every
  // local edit (it should only run again on sign-in/out or an explicit retry).
  const stateRef = useRef(state);
  stateRef.current = state;

  const userId = auth.isSupabaseConfigured ? (auth.user?.id ?? null) : null;

  useEffect(() => {
    if (auth.status !== 'ready') return;

    if (!userId) {
      setStatus('idle');
      setMessage(null);
      setLocalCounts(null);
      setCloudCounts(null);
      return;
    }

    let active = true;
    setStatus('loading');
    setMessage(null);

    (async () => {
      const metadataStore = loadSyncMetadataStore();
      const accountMetadata = getAccountMetadata(metadataStore, userId);

      const result = await hydrateFromCloud(stateRef.current, 'signedIn', accountMetadata.established);
      if (!active) return;

      setLocalCounts(result.localCounts ?? null);
      setCloudCounts(result.cloudCounts ?? null);

      switch (result.decision.kind) {
        case 'hydrate-from-cloud': {
          if (!result.hydrated) {
            // Should be unreachable — hydrateFromCloud always attaches
            // `hydrated` for this decision kind. Fail safe rather than
            // dispatch nothing silently: report it as recoverable and leave
            // local data untouched.
            setStatus('error');
            setMessage('Your account data could not be loaded. Local data on this device is unchanged.');
            return;
          }
          dispatch({ type: 'LOAD', data: result.hydrated.appData });
          const nextMetadata = updateMetadataAfterHydration(accountMetadata, result.hydrated);
          saveSyncMetadataStore(upsertAccountMetadata(metadataStore, nextMetadata));
          setStatus('hydrated');
          setMessage(null);
          return;
        }

        case 'sync-established': {
          // Requirement 3 (returning device): refresh only ever pulls
          // records this device has no unsynced edits for — see
          // refreshFromCloud's doc comment for why that alone is sufficient
          // to satisfy "never lose unsynced local work" without this
          // module needing its own drain-first sequencing or conflict
          // detection. The one exception is a record dirty *and* stuck in
          // conflict, which `acceptConflicts` resolves — but only when this
          // pass was triggered by the explicit "Refresh from cloud" action.
          const acceptConflicts = acceptConflictsRef.current;
          acceptConflictsRef.current = false;
          const refreshed = await refreshFromCloud(stateRef.current, accountMetadata, acceptConflicts);
          if (!active) return;
          if (refreshed.ok === false) {
            // A refresh failure is not fatal — this device is already
            // linked and has whatever it last synced. Report it but do not
            // block or clear existing data.
            setStatus('up-to-date');
            setMessage(`Could not refresh from your account just now: ${refreshed.message}`);
            return;
          }
          if (refreshed.changed) {
            dispatch({ type: 'APPLY_REMOTE_UPDATE', data: refreshed.appData });
          }
          const nextMetadata = setLastSyncedAt(refreshed.metadata, new Date().toISOString());
          saveSyncMetadataStore(upsertAccountMetadata(metadataStore, nextMetadata));
          setStatus('up-to-date');
          setMessage(null);
          return;
        }

        case 'require-explicit-choice':
          setStatus('needs-choice');
          setMessage(
            'This device and your account both have data, and this device has not been linked to your account yet. Automatic syncing is paused until that is resolved. Nothing on this device or in your account has been changed.',
          );
          return;

        case 'cloud-query-failed':
          setStatus('error');
          setMessage(result.decision.message);
          return;

        case 'both-empty': {
          // Nothing exists on either side, so there is nothing that could
          // conflict — safe to mark this device linked immediately rather
          // than leaving a brand-new account permanently unable to
          // auto-sync until it happens to run a migration with something to
          // migrate. One of the "another explicit account-link decision
          // defined by the plan" cases Phase 5B3B's linking gate allows.
          const nextMetadata = markEstablished(accountMetadata);
          saveSyncMetadataStore(upsertAccountMetadata(metadataStore, nextMetadata));
          setStatus('idle');
          setMessage(null);
          return;
        }

        case 'await-explicit-migration':
        case 'signed-out':
        default:
          setStatus('idle');
          setMessage(null);
          return;
      }
    })();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dispatch is stable; state is read via stateRef intentionally.
  }, [auth.status, userId, attempt]);

  const value: CloudSyncState = {
    status,
    message,
    localCounts,
    cloudCounts,
    retry: () => setAttempt((n) => n + 1),
    refreshAcceptingServer: () => {
      acceptConflictsRef.current = true;
      setAttempt((n) => n + 1);
    },
  };

  return <CloudSyncContext.Provider value={value}>{children}</CloudSyncContext.Provider>;
}
