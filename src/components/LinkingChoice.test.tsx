// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LinkingChoice } from './LinkingChoice';
import { getAccountMetadata } from '../sync/metadata';
import { loadSyncMetadataStore } from '../sync/metadataStorage';
import { createEmptyAppData, type AppData } from '../types';

type EntityKey = 'project' | 'task' | 'quickNote' | 'goal' | 'target';

interface LinkingComparison {
  localOnly: Record<EntityKey, string[]>;
  cloudOnly: Record<EntityKey, string[]>;
  differing: Record<EntityKey, string[]>;
  identical: boolean;
}

const mocks = vi.hoisted(() => ({
  appState: {
    state: {} as AppData,
    dispatch: vi.fn(),
  },
  authState: {
    user: null as { id: string; email: string } | null,
  },
  cloudSyncState: { retry: vi.fn() },
  linkingLib: {
    loadCloudBundle: vi.fn(),
    compareForLinking: vi.fn(),
    buildUseCloudData: vi.fn(),
    applyKeepLocalData: vi.fn(),
  },
  exportLib: { exportJsonBackup: vi.fn() },
}));
const { appState, authState, cloudSyncState, linkingLib, exportLib } = mocks;

vi.mock('../store/useApp', () => ({ useApp: () => mocks.appState }));
vi.mock('../store/useAuth', () => ({ useAuth: () => mocks.authState }));
vi.mock('../store/useCloudSync', () => ({ useCloudSync: () => mocks.cloudSyncState }));
vi.mock('../sync/linkingChoice', () => mocks.linkingLib);
vi.mock('../storage/exportImport', () => mocks.exportLib);

const cloudBundle = { projects: [], tasks: [], quickNotes: [], goals: [], targets: [] };

function comparisonWith(overrides: Partial<LinkingComparison> = {}): LinkingComparison {
  return {
    localOnly: { project: [], task: [], quickNote: [], goal: [], target: [] },
    cloudOnly: { project: [], task: [], quickNote: [], goal: [], target: [] },
    differing: { project: [], task: [], quickNote: [], goal: [], target: [] },
    identical: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  appState.state = createEmptyAppData();
  authState.user = { id: 'user-1', email: 'person@example.com' };
  linkingLib.loadCloudBundle.mockResolvedValue({ ok: true, data: cloudBundle });
  linkingLib.compareForLinking.mockReturnValue(comparisonWith());
  linkingLib.buildUseCloudData.mockReturnValue(createEmptyAppData());
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('LinkingChoice', () => {
  it('shows a loading state while comparing, then the three choices with record counts', async () => {
    linkingLib.compareForLinking.mockReturnValue(
      comparisonWith({
        localOnly: { project: ['p1'], task: [], quickNote: [], goal: [], target: [] },
        cloudOnly: { project: [], task: ['t1'], quickNote: [], goal: [], target: [] },
      }),
    );
    render(<LinkingChoice />);

    expect(screen.getByText(/Comparing/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/1 record only on this device/)).toBeTruthy());
    expect(screen.getByText(/1 record only in your account/)).toBeTruthy();
  });

  it('offers "They match" only when the comparison is identical', async () => {
    linkingLib.compareForLinking.mockReturnValue(comparisonWith({ identical: true }));
    render(<LinkingChoice />);
    await waitFor(() => expect(screen.getByRole('button', { name: /They match/ })).toBeTruthy());
  });

  it('does not offer "They match" when records differ', async () => {
    linkingLib.compareForLinking.mockReturnValue(comparisonWith({ identical: false }));
    render(<LinkingChoice />);
    await screen.findByRole('button', { name: /Use my account.s data/ });
    expect(screen.queryByRole('button', { name: /They match/ })).toBeNull();
  });

  it('shows a retry option when the cloud bundle fails to load', async () => {
    linkingLib.loadCloudBundle.mockResolvedValue({ ok: false, message: 'network down' });
    render(<LinkingChoice />);
    expect(await screen.findByText(/network down/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('"They match" links the device without dispatching any data change', async () => {
    linkingLib.compareForLinking.mockReturnValue(comparisonWith({ identical: true }));
    render(<LinkingChoice />);

    fireEvent.click(await screen.findByRole('button', { name: /They match/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Link this device' }));

    expect(appState.dispatch).not.toHaveBeenCalled();
    await waitFor(() => expect(cloudSyncState.retry).toHaveBeenCalledTimes(1));
    expect(getAccountMetadata(loadSyncMetadataStore(), 'user-1').established).toBe(true);
  });

  it('"Use my account\'s data" offers an export-first backup, then dispatches the cloud data wholesale on confirm', async () => {
    const cloudData = { ...createEmptyAppData(), projects: [{ id: 'x', name: 'From cloud', status: 'active' as const }] };
    linkingLib.buildUseCloudData.mockReturnValue(cloudData);
    render(<LinkingChoice />);

    fireEvent.click(await screen.findByRole('button', { name: /Use my account.s data/ }));
    expect(screen.getByText(/replaces every task, project, quick note, goal, and target/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Export a backup first' }));
    expect(exportLib.exportJsonBackup).toHaveBeenCalledWith(appState.state);

    fireEvent.click(screen.getByRole('button', { name: /Use my account.s data/ }));

    // Re-reads the cloud at confirm time rather than reusing the snapshot
    // this screen first rendered with (decision 15) — an extra loadCloudBundle call.
    await waitFor(() => expect(linkingLib.loadCloudBundle).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(appState.dispatch).toHaveBeenCalledWith({ type: 'APPLY_REMOTE_UPDATE', data: cloudData }),
    );
    await waitFor(() => expect(cloudSyncState.retry).toHaveBeenCalledTimes(1));
    expect(getAccountMetadata(loadSyncMetadataStore(), 'user-1').established).toBe(true);
  });

  it('"Keep this device\'s data" applies the merge outcome and continues immediately when nothing was deferred', async () => {
    const mergedData = { ...createEmptyAppData(), projects: [{ id: 'kept', name: 'Kept', status: 'active' as const }] };
    linkingLib.applyKeepLocalData.mockResolvedValue({
      appData: mergedData,
      metadata: getAccountMetadata(loadSyncMetadataStore(), 'user-1'),
      deferred: { project: [], task: [], quickNote: [], goal: [], target: [] },
    });
    render(<LinkingChoice />);

    fireEvent.click(await screen.findByRole('button', { name: /Keep this device.s data/ }));
    fireEvent.click(screen.getByRole('button', { name: /Keep this device.s data/ }));

    await waitFor(() =>
      expect(appState.dispatch).toHaveBeenCalledWith({ type: 'APPLY_REMOTE_UPDATE', data: mergedData }),
    );
    await waitFor(() => expect(cloudSyncState.retry).toHaveBeenCalledTimes(1));
    expect(getAccountMetadata(loadSyncMetadataStore(), 'user-1').established).toBe(true);
  });

  it('"Keep this device\'s data" reports deferred records instead of silently dropping them, and only retries after the user continues', async () => {
    linkingLib.applyKeepLocalData.mockResolvedValue({
      appData: createEmptyAppData(),
      metadata: getAccountMetadata(loadSyncMetadataStore(), 'user-1'),
      deferred: { project: ['p1'], task: [], quickNote: [], goal: [], target: [] },
    });
    render(<LinkingChoice />);

    fireEvent.click(await screen.findByRole('button', { name: /Keep this device.s data/ }));
    fireEvent.click(screen.getByRole('button', { name: /Keep this device.s data/ }));

    expect(await screen.findByText(/1 could not be confirmed right away/)).toBeTruthy();
    expect(cloudSyncState.retry).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(cloudSyncState.retry).toHaveBeenCalledTimes(1);
  });

  it('record counts include Goals and Targets, not just project/task/quickNote', async () => {
    linkingLib.compareForLinking.mockReturnValue(
      comparisonWith({
        localOnly: { project: [], task: [], quickNote: [], goal: ['g1'], target: [] },
        cloudOnly: { project: [], task: [], quickNote: [], goal: [], target: ['tg1', 'tg2'] },
      }),
    );
    render(<LinkingChoice />);

    await waitFor(() => expect(screen.getByText(/1 record only on this device/)).toBeTruthy());
    expect(screen.getByText(/2 records only in your account/)).toBeTruthy();
  });

  it('the deferred-count summary includes deferred Goals and Targets', async () => {
    linkingLib.applyKeepLocalData.mockResolvedValue({
      appData: createEmptyAppData(),
      metadata: getAccountMetadata(loadSyncMetadataStore(), 'user-1'),
      deferred: { project: [], task: [], quickNote: [], goal: ['g1'], target: ['tg1'] },
    });
    render(<LinkingChoice />);

    fireEvent.click(await screen.findByRole('button', { name: /Keep this device.s data/ }));
    fireEvent.click(screen.getByRole('button', { name: /Keep this device.s data/ }));

    expect(await screen.findByText(/2 could not be confirmed right away/)).toBeTruthy();
  });

  describe('a Quick Notes-specific read failure never leaves this screen stuck', () => {
    // Regression coverage for the exact production bug this was written to
    // fix: loadCloudBundle used to fail its entire read (surfacing only a
    // "Retry" button, with no way to actually resolve project/task/goal/
    // target linking) whenever Quick Notes alone could not be read (e.g. its
    // table not existing yet). It must now still reach the normal three-
    // choice screen, with Quick Notes simply excluded and called out.

    it('still reaches the three-choice screen, with a scoped notice, instead of the loadState-error dead end', async () => {
      linkingLib.loadCloudBundle.mockResolvedValue({
        ok: true,
        data: cloudBundle,
        quickNotesError: "Could not find the table 'public.quick_notes'",
      });
      render(<LinkingChoice />);

      await waitFor(() => expect(screen.getByRole('button', { name: /Use my account.s data/ })).toBeTruthy());
      expect(screen.getByRole('button', { name: /Keep this device.s data/ })).toBeTruthy();
      expect(screen.getByText(/Quick Notes could not be compared/)).toBeTruthy();
      expect(screen.getByText(/public\.quick_notes/)).toBeTruthy();
      // The old dead-end never shows alongside the real screen.
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    });

    it('passes quickNotesAvailable=false through to compareForLinking when the read failed', async () => {
      linkingLib.loadCloudBundle.mockResolvedValue({
        ok: true,
        data: cloudBundle,
        quickNotesError: 'table missing',
      });
      render(<LinkingChoice />);

      await waitFor(() => expect(linkingLib.compareForLinking).toHaveBeenCalled());
      expect(linkingLib.compareForLinking).toHaveBeenCalledWith(appState.state, cloudBundle, false);
    });

    it('passes quickNotesAvailable=true through to compareForLinking when Quick Notes read normally', async () => {
      linkingLib.loadCloudBundle.mockResolvedValue({ ok: true, data: cloudBundle });
      render(<LinkingChoice />);

      await waitFor(() => expect(linkingLib.compareForLinking).toHaveBeenCalled());
      expect(linkingLib.compareForLinking).toHaveBeenCalledWith(appState.state, cloudBundle, true);
      expect(screen.queryByText(/Quick Notes could not be compared/)).toBeNull();
    });

    it('"Use my account\'s data" still passes quickNotesAvailable through to buildUseCloudData on confirm', async () => {
      linkingLib.loadCloudBundle.mockResolvedValue({
        ok: true,
        data: cloudBundle,
        quickNotesError: 'table missing',
      });
      render(<LinkingChoice />);

      fireEvent.click(await screen.findByRole('button', { name: /Use my account.s data/ }));
      fireEvent.click(screen.getByRole('button', { name: /Use my account.s data/ }));

      await waitFor(() =>
        expect(linkingLib.buildUseCloudData).toHaveBeenCalledWith(cloudBundle, appState.state, false),
      );
    });
  });
});
