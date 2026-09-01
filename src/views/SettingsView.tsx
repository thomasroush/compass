import { ChangeEvent, useRef, useState } from 'react';
import { useApp } from '../store/useApp';
import { useAuth } from '../store/useAuth';
import { useCloudSync } from '../store/useCloudSync';
import { exportJsonBackup, exportMarkdownFile, readFileAsText } from '../storage/exportImport';
import { parseJsonAppData } from '../storage/validation';
import { clearAppData, flushSave } from '../storage/storage';
import { AccountPanel } from '../components/AccountPanel';
import { MigrationPanel } from '../components/MigrationPanel';
import { SyncStatusPanel } from '../components/SyncStatusPanel';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { runMigration } from '../repository/migration';
import { getAccountMetadata, markEstablished, upsertAccountMetadata } from '../sync/metadata';
import { loadSyncMetadataStore, saveSyncMetadataStore } from '../sync/metadataStorage';
import { STORAGE_KEY } from '../types';

export function SettingsView() {
  const { state, dispatch } = useApp();
  const auth = useAuth();
  const cloudSync = useCloudSync();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importConfirm, setImportConfirm] = useState<string | null>(null);
  const [importPushing, setImportPushing] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetText, setResetText] = useState('');
  const [message, setMessage] = useState('');

  const signedInAccountId = auth.isSupabaseConfigured ? (auth.user?.id ?? null) : null;

  function showMsg(text: string) {
    setMessage(text);
    setTimeout(() => setMessage(''), 4000);
  }

  async function handleImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      const result = parseJsonAppData(text);
      if (!result.ok) {
        showMsg(`Import failed: ${result.error}`);
        return;
      }
      setImportConfirm(text);
    } catch {
      showMsg('Import failed: could not read file.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  /**
   * Requirement 5 / decision 10: IMPORT is always applied locally first (it
   * is classified as a sync-boundary action — see
   * `src/sync/actionProvenance.ts` — so it is never itself marked dirty and
   * never pushes anything on its own). When signed in, `pushToCloud` decides
   * whether that's the end of it (import stays local-only, matching every
   * other device that hasn't chosen to adopt it) or whether the caller has
   * explicitly also asked to copy the result to their account, reusing the
   * same verified upload path `MigrationPanel` uses. Never runs the push
   * silently.
   */
  async function confirmImport(pushToCloud: boolean): Promise<void> {
    if (!importConfirm) return;
    const result = parseJsonAppData(importConfirm);
    if (!result.ok) {
      showMsg(`Import failed: ${result.error}`);
      setImportConfirm(null);
      return;
    }
    dispatch({ type: 'IMPORT', data: result.data });
    flushSave(result.data);

    if (pushToCloud && signedInAccountId) {
      setImportPushing(true);
      const migrationOutcome = await runMigration(result.data, signedInAccountId);
      setImportPushing(false);
      if (migrationOutcome.ok) {
        const store = loadSyncMetadataStore();
        const nextMetadata = markEstablished(getAccountMetadata(store, signedInAccountId));
        saveSyncMetadataStore(upsertAccountMetadata(store, nextMetadata));
        cloudSync.retry();
        showMsg('Backup imported and copied to your account.');
      } else {
        showMsg(
          'Backup imported on this device, but copying it to your account had problems. Check Sync status below.',
        );
      }
    } else {
      showMsg('Backup imported on this device.');
    }

    setImportConfirm(null);
  }

  function confirmReset() {
    if (resetText !== 'RESET') return;
    dispatch({ type: 'RESET' });
    clearAppData();
    setResetConfirm(false);
    setResetText('');
    showMsg('All data has been reset.');
  }

  return (
    <div className="view">
      <header className="view-header">
        <h1>Settings</h1>
        <p className="subtitle">Backup, restore, and data management.</p>
      </header>

      {message && <p className="message" role="status">{message}</p>}

      <AccountPanel />
      <MigrationPanel />
      <SyncStatusPanel />

      <section className="section settings-section">
        <h2>Data storage</h2>
        <p>
          Your data is stored locally in this browser under the key{' '}
          <code>{STORAGE_KEY}</code>. It persists when you close the browser, but
          clearing site data will remove it. Export backups regularly.
        </p>
      </section>

      <section className="section settings-section">
        <h2>Export</h2>
        <div className="settings-actions">
          <button type="button" onClick={() => exportJsonBackup(state)}>
            Export JSON backup
          </button>
          <button type="button" className="secondary" onClick={() => exportMarkdownFile(state)}>
            Export active tasks (Markdown)
          </button>
        </div>
      </section>

      <section className="section settings-section">
        <h2>Import</h2>
        <p>Import a JSON backup. This replaces all current data on this device after confirmation.</p>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={handleImportFile}
          aria-label="Choose backup file"
        />
      </section>

      <section className="section settings-section danger-zone">
        <h2>Reset</h2>
        <p>
          Permanently delete all tasks, projects, and notes on this device.
          {signedInAccountId && ' Your account’s data in the cloud is not touched by this.'}
        </p>
        <button type="button" className="danger" onClick={() => setResetConfirm(true)}>
          Reset all data
        </button>
      </section>

      {importConfirm !== null && !signedInAccountId && (
        <ConfirmDialog
          open
          title="Import backup"
          message="This will replace all current data on this device with the backup. Continue?"
          confirmLabel="Import"
          onConfirm={() => confirmImport(false)}
          onCancel={() => setImportConfirm(null)}
        />
      )}

      {importConfirm !== null && signedInAccountId && (
        <div className="dialog-backdrop" role="presentation">
          <div className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="import-dialog-title">
            <h2 id="import-dialog-title">Import backup</h2>
            <p>
              This replaces all current data on this device with the backup. Choose whether to
              also copy the result to <strong>{auth.user?.email}</strong>, or keep it on this
              device only for now.
            </p>
            <div className="dialog-actions">
              <button type="button" className="secondary" onClick={() => setImportConfirm(null)} disabled={importPushing}>
                Cancel
              </button>
              <button type="button" className="secondary" onClick={() => confirmImport(false)} disabled={importPushing}>
                This device only
              </button>
              <button type="button" onClick={() => confirmImport(true)} disabled={importPushing}>
                {importPushing ? 'Copying to your account…' : 'This device and my account'}
              </button>
            </div>
          </div>
        </div>
      )}

      {resetConfirm && (
        <div className="dialog-backdrop" role="presentation" onClick={() => setResetConfirm(false)}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Reset all data</h2>
            <p>Type RESET to confirm permanent deletion of all data.</p>
            <div className="field">
              <label htmlFor="reset-confirm">Confirmation</label>
              <input
                id="reset-confirm"
                type="text"
                value={resetText}
                onChange={(e) => setResetText(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="dialog-actions">
              <button type="button" className="secondary" onClick={() => setResetConfirm(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="danger"
                disabled={resetText !== 'RESET'}
                onClick={confirmReset}
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
