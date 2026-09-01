import { useEffect, useState } from 'react';
import { useApp } from '../store/useApp';
import { useAuth } from '../store/useAuth';
import { useCloudSync } from '../store/useCloudSync';
import { exportJsonBackup } from '../storage/exportImport';
import {
  applyKeepLocalData,
  buildUseCloudData,
  compareForLinking,
  loadCloudBundle,
  type CloudBundle,
  type KeepLocalOutcome,
  type LinkingComparison,
} from '../sync/linkingChoice';
import { getAccountMetadata, markEstablished, upsertAccountMetadata } from '../sync/metadata';
import { loadSyncMetadataStore, saveSyncMetadataStore } from '../sync/metadataStorage';

type Choice = 'match' | 'use-cloud' | 'keep-local';

/**
 * Phase 5B3C — the blocking interstitial for `decideHydration`'s
 * `'require-explicit-choice'` decision: this device and this account both
 * have data, and this device has never linked to this account. Rendered as
 * a full-screen overlay (the app underneath is not usable) because editing
 * while this is unresolved could itself become one more thing to reconcile.
 *
 * Never guesses (decision 9) and never applies an unconditional overwrite to
 * a differing cloud record (decision 15) — see `src/sync/linkingChoice.ts`
 * for how each of the three choices is actually carried out.
 */
export function LinkingChoice() {
  const { state, dispatch } = useApp();
  const auth = useAuth();
  const cloudSync = useCloudSync();

  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [cloud, setCloud] = useState<CloudBundle | null>(null);
  const [comparison, setComparison] = useState<LinkingComparison | null>(null);
  const [confirming, setConfirming] = useState<Choice | null>(null);
  const [working, setWorking] = useState(false);
  const [deferredNote, setDeferredNote] = useState<KeepLocalOutcome['deferred'] | null>(null);

  const accountId = auth.user?.id ?? null;

  useEffect(() => {
    let active = true;
    setLoadState('loading');
    loadCloudBundle().then((result) => {
      if (!active) return;
      if (!result.ok) {
        setLoadState('error');
        setLoadError(result.message);
        return;
      }
      setCloud(result.data);
      setComparison(compareForLinking(state, result.data));
      setLoadState('ready');
    });
    return () => {
      active = false;
    };
    // Deliberately runs once per mount — this screen blocks the rest of the
    // app, so local `state` cannot change underneath it while it's open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!accountId) return null;

  function markLinked() {
    const store = loadSyncMetadataStore();
    const meta = markEstablished(getAccountMetadata(store, accountId!));
    saveSyncMetadataStore(upsertAccountMetadata(store, meta));
  }

  function finish() {
    markLinked();
    cloudSync.retry();
  }

  function confirmTheyMatch() {
    finish();
  }

  async function confirmUseCloudData() {
    // Re-read the cloud, rather than reusing the snapshot this screen first
    // rendered with — a genuinely destructive replace should act on the
    // freshest cloud state available at the moment it's confirmed, not on
    // whatever was current when the choice screen happened to mount.
    setWorking(true);
    const fresh = await loadCloudBundle();
    setWorking(false);
    if (!fresh.ok) {
      setLoadError(fresh.message);
      setLoadState('error');
      setConfirming(null);
      return;
    }
    dispatch({ type: 'APPLY_REMOTE_UPDATE', data: buildUseCloudData(fresh.data) });
    finish();
  }

  async function confirmKeepLocalData() {
    if (!cloud || !comparison || !accountId) return;
    setWorking(true);
    const store = loadSyncMetadataStore();
    const currentMetadata = getAccountMetadata(store, accountId);
    const outcome = await applyKeepLocalData(state, cloud, comparison, currentMetadata, accountId);
    dispatch({ type: 'APPLY_REMOTE_UPDATE', data: outcome.appData });
    saveSyncMetadataStore(upsertAccountMetadata(store, markEstablished(outcome.metadata)));
    setWorking(false);
    const hasDeferred =
      outcome.deferred.project.length > 0 || outcome.deferred.task.length > 0 || outcome.deferred.dailyNote.length > 0;
    if (hasDeferred) {
      setDeferredNote(outcome.deferred);
      return;
    }
    cloudSync.retry();
  }

  function closeAfterDeferred() {
    setDeferredNote(null);
    cloudSync.retry();
  }

  const counts = (c: LinkingComparison['localOnly']) => c.project.length + c.task.length + c.dailyNote.length;

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        className="dialog dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="linking-choice-title"
      >
        <h2 id="linking-choice-title">This device and your account both have data</h2>

        {loadState === 'loading' && <p>Comparing this device&rsquo;s data with your account&hellip;</p>}

        {loadState === 'error' && (
          <>
            <p className="message error" role="alert">
              Could not read your account&rsquo;s data: {loadError}
            </p>
            <div className="dialog-actions">
              <button type="button" onClick={() => setLoadState('loading')}>
                Retry
              </button>
            </div>
          </>
        )}

        {loadState === 'ready' && comparison && !confirming && !deferredNote && (
          <>
            <p>
              This device has never been linked to <strong>{auth.user?.email}</strong>. Nothing has
              been changed yet — choose how to resolve this before continuing.
            </p>
            <ul>
              <li>
                {counts(comparison.localOnly)} record{counts(comparison.localOnly) === 1 ? '' : 's'} only on this
                device
              </li>
              <li>
                {counts(comparison.cloudOnly)} record{counts(comparison.cloudOnly) === 1 ? '' : 's'} only in your
                account
              </li>
              <li>
                {counts(comparison.differing)} record{counts(comparison.differing) === 1 ? '' : 's'} that exist in
                both places with different content
              </li>
            </ul>

            <div className="dialog-actions">
              {comparison.identical && (
                <button type="button" onClick={() => setConfirming('match')}>
                  They match — link this device
                </button>
              )}
              <button type="button" className="secondary" onClick={() => setConfirming('use-cloud')}>
                Use my account&rsquo;s data
              </button>
              <button type="button" className="secondary" onClick={() => setConfirming('keep-local')}>
                Keep this device&rsquo;s data
              </button>
            </div>
          </>
        )}

        {confirming === 'match' && (
          <>
            <p>Every record matches. Linking this device does not change anything, on this device or in your account.</p>
            <div className="dialog-actions">
              <button type="button" className="secondary" onClick={() => setConfirming(null)}>
                Cancel
              </button>
              <button type="button" onClick={confirmTheyMatch}>
                Link this device
              </button>
            </div>
          </>
        )}

        {confirming === 'use-cloud' && (
          <>
            <p className="message error" role="alert">
              This replaces every task, project, and daily note on this device with what is
              currently in your account. Anything on this device that is not already in your
              account will be lost.
            </p>
            <div className="dialog-actions">
              <button type="button" className="secondary" onClick={() => exportJsonBackup(state)} disabled={working}>
                Export a backup first
              </button>
              <button type="button" className="secondary" onClick={() => setConfirming(null)} disabled={working}>
                Cancel
              </button>
              <button type="button" className="danger" onClick={confirmUseCloudData} disabled={working}>
                {working ? 'Loading your account…' : 'Use my account’s data'}
              </button>
            </div>
          </>
        )}

        {confirming === 'keep-local' && (
          <>
            <p>
              This device&rsquo;s data becomes the account&rsquo;s data for anything that differs.
              Records that only exist in your account are kept and added to this device — nothing
              in your account is deleted.
            </p>
            <div className="dialog-actions">
              <button type="button" className="secondary" onClick={() => setConfirming(null)} disabled={working}>
                Cancel
              </button>
              <button type="button" onClick={confirmKeepLocalData} disabled={working}>
                {working ? 'Applying…' : 'Keep this device’s data'}
              </button>
            </div>
          </>
        )}

        {deferredNote && (
          <>
            <p className="message" role="status">
              This device is now linked. Most records were saved to your account immediately;{' '}
              {deferredNote.project.length + deferredNote.task.length + deferredNote.dailyNote.length} could not be
              confirmed right away and will sync automatically the next time this device syncs.
            </p>
            <div className="dialog-actions">
              <button type="button" onClick={closeAfterDeferred}>
                Continue
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
