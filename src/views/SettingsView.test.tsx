// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SettingsView } from './SettingsView';
import { createEmptyAppData, type AppData } from '../types';
import { getAccountMetadata } from '../sync/metadata';
import { loadSyncMetadataStore } from '../sync/metadataStorage';

const mocks = vi.hoisted(() => ({
  // Deliberately a plain literal, not `createEmptyAppData()` — vi.hoisted's
  // factory runs before this file's own imports are initialized, so calling
  // an imported function here would throw a TDZ ReferenceError. The real
  // value is set in beforeEach below, once imports are available.
  appState: {
    current: { version: 1, tasks: [], projects: [], dailyNotes: [] } as AppData,
    dispatch: vi.fn(),
  },
  authState: { isSupabaseConfigured: true, user: null as { id: string; email: string } | null },
  cloudSyncState: { retry: vi.fn() },
  exportImport: {
    exportJsonBackup: vi.fn(),
    exportMarkdownFile: vi.fn(),
    readFileAsText: vi.fn(),
  },
  validation: { parseJsonAppData: vi.fn() },
  migration: { runMigration: vi.fn() },
}));

vi.mock('../store/useApp', () => ({
  useApp: () => ({ state: mocks.appState.current, dispatch: mocks.appState.dispatch }),
}));
vi.mock('../store/useAuth', () => ({ useAuth: () => mocks.authState }));
vi.mock('../store/useCloudSync', () => ({ useCloudSync: () => mocks.cloudSyncState }));
vi.mock('../storage/exportImport', () => mocks.exportImport);
vi.mock('../storage/validation', () => mocks.validation);
vi.mock('../repository/migration', () => mocks.migration);
vi.mock('../components/AccountPanel', () => ({ AccountPanel: () => null }));
vi.mock('../components/MigrationPanel', () => ({ MigrationPanel: () => null }));
vi.mock('../components/SyncStatusPanel', () => ({ SyncStatusPanel: () => null }));

const importedData: AppData = {
  ...createEmptyAppData(),
  projects: [{ id: 'imported-proj', name: 'Imported', status: 'active' }],
};

async function chooseFile() {
  const file = new File(['{"fake":true}'], 'backup.json', { type: 'application/json' });
  const input = screen.getByLabelText('Choose backup file') as HTMLInputElement;
  await waitFor(() => {}); // no-op, keeps await pattern consistent below
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.appState.current = createEmptyAppData();
  mocks.authState.isSupabaseConfigured = true;
  mocks.authState.user = null;
  mocks.exportImport.readFileAsText.mockResolvedValue('{"fake":true}');
  mocks.validation.parseJsonAppData.mockReturnValue({ ok: true, data: importedData });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('SettingsView — Import (signed out or Supabase not configured)', () => {
  it('replaces local data with a single confirmation, with no cloud-push choice offered', async () => {
    mocks.authState.user = null;
    render(<SettingsView />);

    await chooseFile();
    expect(await screen.findByText('Import backup')).toBeTruthy();
    expect(screen.queryByText(/This device and my account/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() =>
      expect(mocks.appState.dispatch).toHaveBeenCalledWith({ type: 'IMPORT', data: importedData }),
    );
    expect(mocks.migration.runMigration).not.toHaveBeenCalled();
  });
});

describe('SettingsView — Import (signed in): decision 10 explicit choice', () => {
  beforeEach(() => {
    mocks.authState.user = { id: 'user-1', email: 'person@example.com' };
  });

  it('presents an explicit choice between this-device-only and this-device-and-my-account', async () => {
    render(<SettingsView />);
    await chooseFile();

    expect(await screen.findByText('Import backup')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'This device only' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /This device and my account/ })).toBeTruthy();
  });

  it('"This device only" imports locally and never pushes to the cloud', async () => {
    render(<SettingsView />);
    await chooseFile();
    fireEvent.click(await screen.findByRole('button', { name: 'This device only' }));

    await waitFor(() =>
      expect(mocks.appState.dispatch).toHaveBeenCalledWith({ type: 'IMPORT', data: importedData }),
    );
    expect(mocks.migration.runMigration).not.toHaveBeenCalled();
  });

  it('"This device and my account" imports locally and also pushes the result to the cloud, marking this device established', async () => {
    mocks.migration.runMigration.mockResolvedValue({ ok: true, uploaded: { projects: 1, tasks: 0, dailyNotes: 0 }, uploadFailures: [] });
    render(<SettingsView />);
    await chooseFile();
    fireEvent.click(await screen.findByRole('button', { name: /This device and my account/ }));

    await waitFor(() =>
      expect(mocks.appState.dispatch).toHaveBeenCalledWith({ type: 'IMPORT', data: importedData }),
    );
    await waitFor(() => expect(mocks.migration.runMigration).toHaveBeenCalledWith(importedData, 'user-1'));
    await waitFor(() => expect(cloudSyncRetryCalled()).toBe(true));
    expect(getAccountMetadata(loadSyncMetadataStore(), 'user-1').established).toBe(true);
  });

  function cloudSyncRetryCalled() {
    return mocks.cloudSyncState.retry.mock.calls.length > 0;
  }
});

describe('SettingsView — Reset', () => {
  it('warns cloud data is not touched when signed in', () => {
    mocks.authState.user = { id: 'user-1', email: 'person@example.com' };
    render(<SettingsView />);
    expect(screen.getByText(/cloud is not touched/)).toBeTruthy();
  });

  it('says nothing about cloud data when signed out (there is no account to reassure about)', () => {
    mocks.authState.user = null;
    render(<SettingsView />);
    expect(screen.queryByText(/cloud is not touched/)).toBeNull();
  });

  it('still requires typing RESET before the reset action is enabled, and never touches Supabase', () => {
    localStorage.setItem('daily-compass-v1', JSON.stringify(importedData));
    render(<SettingsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset all data' }));
    const confirmButton = screen.getByRole('button', { name: 'Reset' });
    expect(confirmButton).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByLabelText('Confirmation'), { target: { value: 'RESET' } });
    expect(confirmButton).toHaveProperty('disabled', false);

    fireEvent.click(confirmButton);
    expect(mocks.appState.dispatch).toHaveBeenCalledWith({ type: 'RESET' });
    expect(localStorage.getItem('daily-compass-v1')).toBeNull();
    expect(mocks.migration.runMigration).not.toHaveBeenCalled();
  });
});
