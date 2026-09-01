import { useState } from 'react';
import { useApp } from '../store/useApp';
import { useAuth } from '../store/useAuth';
import {
  countLocalData,
  getCloudCounts,
  runMigration,
  type MigrationCounts,
  type MigrationOutcome,
} from '../repository/migration';

type Step = 'idle' | 'checking' | 'confirming' | 'migrating' | 'result';

function CountsRow({ label, counts }: { label: string; counts: MigrationCounts }) {
  return (
    <div className="migration-counts-row">
      <span className="migration-counts-label">{label}</span>
      <span>{counts.projects} projects</span>
      <span>{counts.tasks} tasks</span>
      <span>{counts.dailyNotes} daily notes</span>
    </div>
  );
}

/**
 * Phase 5A: a controlled, explicit, one-time push of this device's existing
 * localStorage data into the signed-in user's Supabase account. Never runs
 * automatically — the user must open this panel, review the counts, and
 * confirm. See src/repository/migration.ts for the upload/verification logic
 * itself; this component only presents it and never touches Supabase
 * directly (AGENTS.md: don't duplicate cloud CRUD logic in components).
 */
export function MigrationPanel() {
  const { state } = useApp();
  const auth = useAuth();
  const [step, setStep] = useState<Step>('idle');
  const [cloudBefore, setCloudBefore] = useState<MigrationCounts | null>(null);
  const [checkError, setCheckError] = useState('');
  const [outcome, setOutcome] = useState<MigrationOutcome | null>(null);

  if (!auth.isSupabaseConfigured) {
    return null; // AccountPanel already explains cloud access is unavailable.
  }

  if (!auth.user) {
    return (
      <section className="section settings-section">
        <h2>Move this device&rsquo;s data to your account</h2>
        <p>Sign in above to copy the tasks, projects, and daily notes stored in this browser to your account.</p>
      </section>
    );
  }

  const localCounts = countLocalData(state);
  // Captured here (not read as `auth.user.id` inside confirmMigration below)
  // so it's the exact account id this already-authenticated render verified
  // — the same identity displayed in the confirmation dialog as "Signed in
  // as {auth.user.email}" just above.
  const accountId = auth.user.id;

  async function startCheck() {
    setCheckError('');
    setStep('checking');
    const result = await getCloudCounts();
    if (!result.ok) {
      setCheckError(result.error.message);
      setStep('idle');
      return;
    }
    setCloudBefore(result.data);
    setStep('confirming');
  }

  function cancelConfirm() {
    setStep('idle');
    setCloudBefore(null);
  }

  async function confirmMigration() {
    setStep('migrating');
    const result = await runMigration(state, accountId);
    setOutcome(result);
    setStep('result');
  }

  function closeResult() {
    setOutcome(null);
    setCloudBefore(null);
    setStep('idle');
  }

  return (
    <section className="section settings-section">
      <h2>Move this device&rsquo;s data to your account</h2>
      <p className="section-help">
        Signed in as <strong>{auth.user.email}</strong>. This copies the tasks, projects, and
        daily notes currently stored in this browser to your Supabase account. Nothing on this
        device is deleted or changed, and nothing is uploaded until you confirm.
      </p>

      {checkError && (
        <p className="message error" role="alert">
          {checkError}
        </p>
      )}

      {(step === 'idle' || step === 'checking') && (
        <button type="button" onClick={startCheck} disabled={step === 'checking'}>
          {step === 'checking' ? 'Checking your account…' : 'Migrate this device’s data'}
        </button>
      )}

      {step === 'confirming' && cloudBefore && (
        <div className="dialog-backdrop" role="presentation" onClick={cancelConfirm}>
          <div
            className="dialog dialog-wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="migration-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="migration-dialog-title">Copy device data to your account?</h2>
            <p>
              Signed in as <strong>{auth.user.email}</strong>. This will copy the data below from
              this device to that account. Existing local data will not be deleted or changed.
              Cloud records that already share an id with a local record will be updated to match
              this device&rsquo;s copy.
            </p>
            <div className="migration-counts" role="table" aria-label="Data to migrate">
              <CountsRow label="This device (local)" counts={localCounts} />
              <CountsRow label="Your account (cloud, now)" counts={cloudBefore} />
            </div>
            <div className="dialog-actions">
              <button type="button" className="secondary" onClick={cancelConfirm}>
                Cancel
              </button>
              <button type="button" onClick={confirmMigration}>
                Copy data to cloud
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 'migrating' && (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog dialog-wide" role="dialog" aria-modal="true">
            <h2>Migrating…</h2>
            <p>Copying your device&rsquo;s data to your account. This may take a moment.</p>
          </div>
        </div>
      )}

      {step === 'result' && outcome && (
        <div className="migration-result">
          {outcome.authError ? (
            <p className="message error" role="alert">
              Migration could not start: {outcome.authError}
            </p>
          ) : (
            <>
              <p className={outcome.ok ? 'message' : 'message error'} role="status">
                {outcome.ok
                  ? `Migration complete and verified: ${outcome.uploaded.projects} projects, ${outcome.uploaded.tasks} tasks, and ${outcome.uploaded.dailyNotes} daily notes were copied to your account.`
                  : 'Migration finished with problems. Do not assume your data is fully in the cloud — see details below.'}
              </p>

              {outcome.uploadFailures.length > 0 && (
                <div className="settings-section" role="alert">
                  <h3>Records that failed to upload ({outcome.uploadFailures.length})</h3>
                  <ul>
                    {outcome.uploadFailures.map((f) => (
                      <li key={`${f.entity}-${f.id}`}>
                        {f.entity} &ldquo;{f.label}&rdquo;: {f.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {outcome.verification && !outcome.verification.passed && (
                <div className="settings-section" role="alert">
                  <h3>Verification found problems</h3>
                  {outcome.verification.issues.map((issue, i) => (
                    <p key={`${issue.entity}-${issue.id}-${i}`}>
                      {issue.label ? `${issue.entity} "${issue.label}"` : 'Verification'}:{' '}
                      {issue.reason}
                    </p>
                  ))}
                </div>
              )}

              {outcome.verification && outcome.verification.passed && (
                <p>
                  Verified against your account: {outcome.verification.cloudCountsAfter.projects}{' '}
                  projects, {outcome.verification.cloudCountsAfter.tasks} tasks,{' '}
                  {outcome.verification.cloudCountsAfter.dailyNotes} daily notes now in the cloud.
                </p>
              )}

              <p className="section-help">
                Local data in this browser has not been deleted or changed.
              </p>
            </>
          )}

          <button type="button" className="secondary" onClick={closeResult}>
            Close
          </button>
        </div>
      )}
    </section>
  );
}
