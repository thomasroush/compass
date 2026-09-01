// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { AppProvider } from './AppContext';
import { AuthProvider } from './AuthContext';
import { CloudSyncProvider } from './CloudSyncContext';
import { useApp } from './useApp';
import { useCloudSync } from './useCloudSync';
import { loadSyncMetadataStore, saveSyncMetadataStore } from '../sync/metadataStorage';
import { countDirty, getAccountMetadata, markEstablished, setRecordUpdatedAt, upsertAccountMetadata } from '../sync/metadata';
import type { AppData, DailyNote, Project, Task } from '../types';
import { createEmptyAppData } from '../types';
import type { CloudDailyNote, CloudProject, CloudTask, RepositoryResult } from '../repository/types';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}));

const projectsRepo = vi.hoisted(() => ({ listProjects: vi.fn() }));
const tasksRepo = vi.hoisted(() => ({ listTasks: vi.fn() }));
const dailyNotesRepo = vi.hoisted(() => ({ listDailyNotes: vi.fn() }));

vi.mock('../lib/supabaseClient', () => ({
  supabase: { auth },
  isSupabaseConfigured: true,
}));
vi.mock('../repository/projectsRepository', () => projectsRepo);
vi.mock('../repository/tasksRepository', () => tasksRepo);
vi.mock('../repository/dailyNotesRepository', () => dailyNotesRepo);

function ok<T>(data: T): RepositoryResult<T> {
  return { ok: true, data };
}
function err(type: 'unauthenticated' | 'unconfigured' | 'database', message: string): RepositoryResult<never> {
  return { ok: false, error: { type, message } };
}

const project: Project = { id: 'proj-1', name: 'Home', status: 'active' };
const task: Task = {
  id: 'task-1',
  title: 'Buy milk',
  status: 'Inbox',
  priority: 'Normal',
  createdAt: '2026-08-30T00:00:00.000Z',
  sortOrder: 0,
  isPrimary: false,
  archived: false,
};
const note: DailyNote = { id: 'note-1', date: '2026-08-30', morning: 'Plan', evening: 'Review' };

function cloudProject(overrides: Partial<CloudProject> = {}): CloudProject {
  return { ...project, updatedAt: '2026-08-30T01:00:00.000Z', ...overrides };
}
function cloudTask(overrides: Partial<CloudTask> = {}): CloudTask {
  return { ...task, updatedAt: '2026-08-30T01:00:00.000Z', ...overrides };
}
function cloudNote(overrides: Partial<CloudDailyNote> = {}): CloudDailyNote {
  return { ...note, updatedAt: '2026-08-30T01:00:00.000Z', ...overrides };
}

function populatedLocal(): AppData {
  return { ...createEmptyAppData(), projects: [project], tasks: [task], dailyNotes: [note] };
}

let authChangeCallback: (event: string, session: unknown) => void = () => {};

function signIn(userId = 'user-1', email = 'person@example.com') {
  act(() => {
    authChangeCallback('SIGNED_IN', { user: { id: userId, email } });
  });
}

function signOut() {
  act(() => {
    authChangeCallback('SIGNED_OUT', null);
  });
}

function TestConsumer() {
  const { state } = useApp();
  const sync = useCloudSync();
  return (
    <div>
      <div data-testid="status">{sync.status}</div>
      <div data-testid="message">{sync.message ?? ''}</div>
      <div data-testid="project-count">{state.projects.length}</div>
      <div data-testid="project-ids">{state.projects.map((p) => p.id).join(',')}</div>
      <div data-testid="project-names">{state.projects.map((p) => p.name).join(',')}</div>
      <div data-testid="task-count">{state.tasks.length}</div>
      <div data-testid="note-count">{state.dailyNotes.length}</div>
      <button type="button" onClick={sync.retry}>
        retry
      </button>
    </div>
  );
}

function renderApp() {
  return render(
    <AuthProvider>
      <AppProvider>
        <CloudSyncProvider>
          <TestConsumer />
        </CloudSyncProvider>
      </AppProvider>
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  auth.getSession.mockResolvedValue({ data: { session: null } });
  auth.onAuthStateChange.mockImplementation((cb: (event: string, session: unknown) => void) => {
    authChangeCallback = cb;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
  projectsRepo.listProjects.mockResolvedValue(ok([]));
  tasksRepo.listTasks.mockResolvedValue(ok([]));
  dailyNotesRepo.listDailyNotes.mockResolvedValue(ok([]));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('CloudSyncProvider', () => {
  it('stays idle and never touches local data while signed out', async () => {
    localStorage.setItem('daily-compass-v1', JSON.stringify(populatedLocal()));
    renderApp();

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('idle'));
    expect(screen.getByTestId('project-count').textContent).toBe('1');
    expect(projectsRepo.listProjects).not.toHaveBeenCalled();
  });

  it('hydrates local state from the cloud when signed in with cloud data and empty local storage', async () => {
    projectsRepo.listProjects.mockResolvedValue(ok([cloudProject()]));
    tasksRepo.listTasks.mockResolvedValue(ok([cloudTask()]));
    dailyNotesRepo.listDailyNotes.mockResolvedValue(ok([cloudNote()]));

    renderApp();
    await waitFor(() => expect(screen.getByTestId('status').textContent).not.toBe('loading'));
    signIn('user-1');

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('hydrated'));
    expect(screen.getByTestId('project-count').textContent).toBe('1');
    expect(screen.getByTestId('task-count').textContent).toBe('1');
    expect(screen.getByTestId('note-count').textContent).toBe('1');

    // Sync metadata now records this device as established for this account,
    // with the server updatedAt seeded for every hydrated record.
    const metadata = getAccountMetadata(loadSyncMetadataStore(), 'user-1');
    expect(metadata.established).toBe(true);
    expect(metadata.records.project['proj-1']?.lastKnownUpdatedAt).toBe('2026-08-30T01:00:00.000Z');
    expect(metadata.records.task['task-1']?.lastKnownUpdatedAt).toBe('2026-08-30T01:00:00.000Z');
    expect(metadata.records.dailyNote['note-1']?.lastKnownUpdatedAt).toBe('2026-08-30T01:00:00.000Z');
  });

  it('does nothing to local data when both cloud and local are empty, but does mark this device linked (nothing exists to conflict)', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByTestId('status').textContent).not.toBe('loading'));
    signIn('user-1');

    await waitFor(() => expect(projectsRepo.listProjects).toHaveBeenCalled());
    expect(screen.getByTestId('status').textContent).toBe('idle');
    expect(screen.getByTestId('project-count').textContent).toBe('0');

    // Risk 2 (Phase 5B3B account-linking gate): both-empty is one of the
    // plan's approved link decisions — there is nothing on either side that
    // could conflict, so it's safe to mark this device established
    // immediately rather than leaving a brand-new account stuck unable to
    // auto-sync until it happens to run a migration with something in it.
    expect(getAccountMetadata(loadSyncMetadataStore(), 'user-1').established).toBe(true);
  });

  it('reports a recoverable error and leaves local data untouched when the cloud read fails', async () => {
    localStorage.setItem('daily-compass-v1', JSON.stringify(populatedLocal()));
    projectsRepo.listProjects.mockResolvedValue(err('database', 'Network request failed.'));

    renderApp();
    await waitFor(() => expect(screen.getByTestId('status').textContent).not.toBe('loading'));
    signIn('user-1');

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'));
    expect(screen.getByTestId('message').textContent).toBe('Network request failed.');
    expect(screen.getByTestId('project-count').textContent).toBe('1');

    // Retry re-runs the same attempt.
    projectsRepo.listProjects.mockResolvedValue(ok([cloudProject()]));
    tasksRepo.listTasks.mockResolvedValue(ok([cloudTask()]));
    dailyNotesRepo.listDailyNotes.mockResolvedValue(ok([cloudNote()]));
    act(() => {
      screen.getByRole('button', { name: 'retry' }).click();
    });

    // Local was already populated, and cloud now also has data with no
    // established link yet -> require-explicit-choice, not a silent overwrite.
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('needs-choice'));
    expect(screen.getByTestId('project-count').textContent).toBe('1');
  });

  it('requires an explicit choice, without changing local data, when both sides have data and no established link exists', async () => {
    localStorage.setItem('daily-compass-v1', JSON.stringify(populatedLocal()));
    projectsRepo.listProjects.mockResolvedValue(ok([cloudProject({ id: 'other-proj' })]));

    renderApp();
    await waitFor(() => expect(screen.getByTestId('status').textContent).not.toBe('loading'));
    signIn('user-1');

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('needs-choice'));
    expect(screen.getByTestId('project-count').textContent).toBe('1');
    expect(screen.getByTestId('message').textContent).toMatch(/has not been linked/);
  });

  it('never silently swaps in a second account\'s cloud data over a first account\'s data still present on this device', async () => {
    projectsRepo.listProjects.mockResolvedValueOnce(ok([cloudProject({ id: 'a-proj', name: 'Account A' })]));
    tasksRepo.listTasks.mockResolvedValueOnce(ok([]));
    dailyNotesRepo.listDailyNotes.mockResolvedValueOnce(ok([]));

    renderApp();
    await waitFor(() => expect(screen.getByTestId('status').textContent).not.toBe('loading'));
    signIn('user-a');
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('hydrated'));
    expect(screen.getByTestId('project-count').textContent).toBe('1');

    const metadataStore = loadSyncMetadataStore();
    const metaA = getAccountMetadata(metadataStore, 'user-a');
    expect(metaA.established).toBe(true);
    expect(metaA.records.project['a-proj']).toBeDefined();

    // A different user signs in on the same device without clearing local
    // data first (device-clearing is a separate, later-phase control).
    // Account A's data is still local, and this device has no established
    // link with account B, so cloud data must not be auto-loaded over it.
    signOut();
    projectsRepo.listProjects.mockResolvedValueOnce(ok([cloudProject({ id: 'b-proj', name: 'Account B' })]));
    tasksRepo.listTasks.mockResolvedValueOnce(ok([]));
    dailyNotesRepo.listDailyNotes.mockResolvedValueOnce(ok([]));
    signIn('user-b');

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('needs-choice'));
    // Local data is still account A's — never silently overwritten with account B's.
    expect(screen.getByTestId('project-count').textContent).toBe('1');

    // Account B was never marked established, and its cloud project id was
    // never written into account A's isolated metadata bucket.
    const finalStore = loadSyncMetadataStore();
    const finalMetaA = getAccountMetadata(finalStore, 'user-a');
    const metaB = getAccountMetadata(finalStore, 'user-b');
    expect(finalMetaA.records.project['b-proj']).toBeUndefined();
    expect(metaB.established).toBe(false);
    expect(metaB.records.project['b-proj']).toBeUndefined();
  });

  it('never lets a stale in-flight request overwrite the result of a newer retry, regardless of resolution order', async () => {
    let resolveStale: ((result: RepositoryResult<CloudProject[]>) => void) | undefined;
    let resolveFresh: ((result: RepositoryResult<CloudProject[]>) => void) | undefined;

    projectsRepo.listProjects
      .mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFresh = resolve; }));
    tasksRepo.listTasks.mockResolvedValue(ok([]));
    dailyNotesRepo.listDailyNotes.mockResolvedValue(ok([]));

    renderApp();
    await waitFor(() => expect(screen.getByTestId('status').textContent).not.toBe('loading'));
    signIn('user-1');

    // First attempt is now in flight (its listProjects call is parked on resolveStale).
    await waitFor(() => expect(projectsRepo.listProjects).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('status').textContent).toBe('loading');

    // Retry before the first attempt resolves. This must cancel the first
    // attempt (via its effect cleanup) before starting the second.
    act(() => {
      screen.getByRole('button', { name: 'retry' }).click();
    });
    await waitFor(() => expect(projectsRepo.listProjects).toHaveBeenCalledTimes(2));

    // The newer (second) request resolves first, with the "fresh" project.
    await act(async () => {
      resolveFresh?.(ok([cloudProject({ id: 'fresh-proj' })]));
    });
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('hydrated'));
    expect(screen.getByTestId('project-ids').textContent).toBe('fresh-proj');

    // The older (first, cancelled) request resolves late, with a different
    // "stale" project. Its own effect's cleanup already set its `active`
    // flag to false when retry fired, so this must be a no-op: it must not
    // replace, append to, or otherwise touch the already-applied fresh result.
    await act(async () => {
      resolveStale?.(ok([cloudProject({ id: 'stale-proj' })]));
    });
    expect(screen.getByTestId('status').textContent).toBe('hydrated');
    expect(screen.getByTestId('project-ids').textContent).toBe('fresh-proj');
    expect(screen.getByTestId('project-count').textContent).toBe('1');
  });
});

describe('CloudSyncProvider — returning device (already established)', () => {
  function seedEstablished(local: AppData, seenUpdatedAt: string) {
    localStorage.setItem('daily-compass-v1', JSON.stringify(local));
    let metadata = markEstablished(getAccountMetadata(loadSyncMetadataStore(), 'user-1'));
    metadata = setRecordUpdatedAt(metadata, 'project', 'proj-1', seenUpdatedAt);
    saveSyncMetadataStore(upsertAccountMetadata(loadSyncMetadataStore(), metadata));
  }

  it('safely refreshes when the cloud is newer (Device A write reaches Device B on startup)', async () => {
    seedEstablished(populatedLocal(), '2026-08-29T00:00:00.000Z');
    projectsRepo.listProjects.mockResolvedValue(ok([cloudProject({ name: 'Renamed on Device A' })]));

    renderApp();
    await waitFor(() => expect(screen.getByTestId('status').textContent).not.toBe('loading'));
    signIn('user-1');

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('up-to-date'));
    expect(screen.getByTestId('project-count').textContent).toBe('1');

    // Applied via APPLY_REMOTE_UPDATE — never marked dirty, so this device
    // does not mistake a remote-applied change for a local edit that itself
    // needs to be pushed back.
    const metadata = getAccountMetadata(loadSyncMetadataStore(), 'user-1');
    expect(countDirty(metadata)).toBe(0);
    expect(metadata.records.project['proj-1']?.lastKnownUpdatedAt).toBe('2026-08-30T01:00:00.000Z');
  });

  it('reports up-to-date with nothing changed when the cloud matches what this device already has', async () => {
    seedEstablished(populatedLocal(), '2026-08-30T01:00:00.000Z');
    projectsRepo.listProjects.mockResolvedValue(ok([cloudProject()]));

    renderApp();
    await waitFor(() => expect(screen.getByTestId('status').textContent).not.toBe('loading'));
    signIn('user-1');

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('up-to-date'));
    expect(screen.getByTestId('project-count').textContent).toBe('1');
    expect(screen.getByTestId('project-ids').textContent).toBe('proj-1');
  });

  it('protects unsynced local work: a dirty record is never overwritten by an established-device refresh', async () => {
    const local = populatedLocal();
    localStorage.setItem('daily-compass-v1', JSON.stringify(local));
    let metadata = markEstablished(getAccountMetadata(loadSyncMetadataStore(), 'user-1'));
    metadata = setRecordUpdatedAt(metadata, 'project', 'proj-1', '2026-08-29T00:00:00.000Z');
    metadata = { ...metadata, dirty: { ...metadata.dirty, project: ['proj-1'] } };
    saveSyncMetadataStore(upsertAccountMetadata(loadSyncMetadataStore(), metadata));

    projectsRepo.listProjects.mockResolvedValue(ok([cloudProject({ name: 'Cloud disagrees' })]));

    renderApp();
    await waitFor(() => expect(screen.getByTestId('status').textContent).not.toBe('loading'));
    signIn('user-1');

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('up-to-date'));
    // This device's own (unsynced) name survives — the refresh skipped the dirty record.
    expect(screen.getByTestId('project-names').textContent).toBe('Home');
  });
});
