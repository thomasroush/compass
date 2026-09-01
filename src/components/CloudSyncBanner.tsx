import { useCloudSync } from '../store/useCloudSync';

/**
 * Phase 5B2 safeguard banner (per SUPABASE_IMPLEMENTATION_PLAN.md's Phase 5B
 * decision 12): whenever cloud data has been loaded into this device's
 * editable app state without live cloud write activation, that must always
 * be visible to the user, not something that quietly drifts. Rendered once,
 * globally, in AppShell, so it shows on every view.
 */
export function CloudSyncBanner() {
  const sync = useCloudSync();

  if (sync.status === 'idle') return null;

  if (sync.status === 'loading') {
    return (
      <p className="message cloud-sync-banner" role="status">
        Loading your account&rsquo;s data&hellip;
      </p>
    );
  }

  if (sync.status === 'error') {
    return (
      <p className="message error cloud-sync-banner" role="alert">
        Could not load your account&rsquo;s data: {sync.message} Local data on this device is
        unchanged.{' '}
        <button type="button" className="secondary cloud-sync-retry" onClick={sync.retry}>
          Retry
        </button>
      </p>
    );
  }

  if (sync.status === 'needs-choice') {
    return (
      <p className="message cloud-sync-banner" role="status">
        {sync.message}
      </p>
    );
  }

  if (sync.status === 'hydrated' || sync.status === 'up-to-date') {
    return (
      <p className="message cloud-sync-banner" role="status">
        {sync.status === 'hydrated' ? "Loaded your account's data onto this device. " : ''}
        Changes you make are saved on this device only &mdash; cloud sync writes are not active
        yet.
      </p>
    );
  }

  return null;
}
