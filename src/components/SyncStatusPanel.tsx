import { useAuth } from '../store/useAuth';
import { useCloudSync } from '../store/useCloudSync';
import { useSyncEngine } from '../store/useSyncEngine';
import type { SyncStatus } from '../store/SyncEngineContext';

/**
 * Phase 5B3B — the minimal write-sync status this phase calls for, plus the
 * manual "Sync now" action decision 7 requires. Deliberately separate from
 * `CloudSyncBanner` (which covers the read/hydration side): this is about
 * whether *this device's own edits* have reached the account, not about
 * whether cloud data was loaded in. Shown only while signed in — there is
 * nothing to report while signed out or when Supabase isn't configured,
 * matching every other cloud-related panel in Settings.
 */
export function SyncStatusPanel() {
  const auth = useAuth();
  const sync = useSyncEngine();
  const cloudSync = useCloudSync();

  if (!auth.isSupabaseConfigured || !auth.user) return null;

  const statusText: Record<SyncStatus, string> = {
    idle: '',
    unlinked: 'This device is not yet linked to your account, so edits are not syncing automatically. Complete migration above to link it.',
    pending: 'Local changes pending — waiting to sync to your account.',
    syncing: 'Syncing changes to your account…',
    synced: 'All changes are synced to your account.',
    conflict: 'Some changes could not sync because the record changed on the server first.',
    offline: 'Could not reach the server. Changes are saved on this device and will sync when back online.',
    error: 'Some changes could not sync.',
  };

  const isProblem =
    sync.status === 'conflict' || sync.status === 'offline' || sync.status === 'error' || sync.status === 'unlinked';

  return (
    <section className="section settings-section">
      <h2>Sync status</h2>
      <p className={isProblem ? 'message error' : 'message'} role="status">
        {statusText[sync.status]}
        {isProblem && sync.status !== 'unlinked' && sync.message ? ` ${sync.message}` : ''}
      </p>
      {sync.pendingCount > 0 && (
        <p className="section-help">
          {sync.pendingCount} {sync.pendingCount === 1 ? 'change' : 'changes'} not yet confirmed in your account.
        </p>
      )}
      <div className="settings-actions">
        <button
          type="button"
          className="secondary"
          onClick={sync.syncNow}
          disabled={sync.status === 'syncing' || sync.status === 'unlinked'}
        >
          Sync now
        </button>
        <button
          type="button"
          className="secondary"
          onClick={cloudSync.refreshAcceptingServer}
          disabled={sync.status === 'unlinked' || cloudSync.status === 'loading'}
        >
          Refresh from cloud
        </button>
      </div>
    </section>
  );
}
