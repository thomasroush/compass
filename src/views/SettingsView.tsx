import { ChangeEvent, useRef, useState } from 'react';
import { useApp } from '../store/useApp';
import { exportJsonBackup, exportMarkdownFile, readFileAsText } from '../storage/exportImport';
import { parseJsonAppData } from '../storage/validation';
import { clearAppData, flushSave } from '../storage/storage';
import { AccountPanel } from '../components/AccountPanel';
import { MigrationPanel } from '../components/MigrationPanel';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { STORAGE_KEY } from '../types';

export function SettingsView() {
  const { state, dispatch } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importConfirm, setImportConfirm] = useState<string | null>(null);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetText, setResetText] = useState('');
  const [message, setMessage] = useState('');

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

  function confirmImport() {
    if (!importConfirm) return;
    const result = parseJsonAppData(importConfirm);
    if (!result.ok) {
      showMsg(`Import failed: ${result.error}`);
      setImportConfirm(null);
      return;
    }
    dispatch({ type: 'IMPORT', data: result.data });
    flushSave(result.data);
    setImportConfirm(null);
    showMsg('Backup imported successfully.');
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
        <p>Import a JSON backup. This replaces all current data after confirmation.</p>
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
        <p>Permanently delete all tasks, projects, and notes.</p>
        <button type="button" className="danger" onClick={() => setResetConfirm(true)}>
          Reset all data
        </button>
      </section>

      <ConfirmDialog
        open={importConfirm !== null}
        title="Import backup"
        message="This will replace all current data with the backup. Continue?"
        confirmLabel="Import"
        onConfirm={confirmImport}
        onCancel={() => setImportConfirm(null)}
      />

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
