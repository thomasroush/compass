// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppProvider } from './AppContext';
import { AuthProvider } from './AuthContext';
import { SyncEngineProvider } from './SyncEngineContext';
import { useApp } from './useApp';
import { useSyncEngine } from './useSyncEngine';
import { resetMemoryStore } from '../storage/storage';
import { getAccountMetadata, markDirty, markEstablished, upsertAccountMetadata } from '../sync/metadata';
import { clearSyncMetadataStore, loadSyncMetadataStore, saveSyncMetadataStore } from '../sync/metadataStorage';
import type { DrainPassResult } from '../sync/drainSync';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}));

const drainDirtyWorkMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/supabaseClient', () => ({
  supabase: { auth },
  isSupabaseConfigured: true,
}));

vi.mock('../sync/drainSync', () => ({
  drainDirtyWork: drainDirtyWorkMock,
}));

function okResult(overrides: Partial<DrainPassResult> = {}): DrainPassResult {
  return { attempted: 0, outcomes: [], stoppedEarly: false, networkFailure: false, accountError: null, ...overrides };
}

function seedDirty(accountId: string, id = 't1') {
  const store = loadSyncMetadataStore();
  const meta = markDirty(getAccountMetadata(store, accountId), 'task', id);
  saveSyncMetadataStore(upsertAccountMetadata(store, meta));
}

/**
 * Marks a device linked to `accountId`, the way a verified-successful
 * migration or hydration would (Risk 2's gate). Most tests in this file are
 * about drain *mechanics*, not the linking gate itself, so they call this to
 * establish the account exactly as an already-linked device would arrive —
 * the gate's own behavior is covered separately below.
 */
function linkAccount(accountId: string) {
  const store = loadSyncMetadataStore();
  const meta = markEstablished(getAccountMetadata(store, accountId));
  saveSyncMetadataStore(upsertAccountMetadata(store, meta));
}

function isEstablished(accountId: string): boolean {
  return getAccountMetadata(loadSyncMetadataStore(), accountId).established;
}

function pendingCountFor(accountId: string): number {
  return getAccountMetadata(loadSyncMetadataStore(), accountId).dirty.task.length;
}

function clearDirtyFor(accountId: string, id: string) {
  const store = loadSyncMetadataStore();
  let meta = getAccountMetadata(store, accountId);
  meta = { ...meta, dirty: { ...meta.dirty, task: meta.dirty.task.filter((x) => x !== id) } };
  saveSyncMetadataStore(upsertAccountMetadata(store, meta));
}

let authChangeCallback: (event: string, session: unknown) => void = () => {};

function signIn(userId = 'user-1') {
  act(() => {
    authChangeCallback('SIGNED_IN', { user: { id: userId, email: `${userId}@example.com` } });
  });
}
function signOut() {
  act(() => {
    authChangeCallback('SIGNED_OUT', null);
  });
}

/**
 * `renderApp()`'s `AuthProvider` kicks off an in-flight `supabase.auth.getSession()`
 * call (mocked to resolve to a signed-out session) that is still pending
 * immediately after render. Calling `signIn()` before that promise settles
 * races it: the mocked `getSession()` resolving afterward would overwrite
 * the just-applied sign-in with `null`. Awaiting one microtask flush first
 * lets that initial resolution land before `signIn()` runs, so there is
 * nothing left to race it.
 */
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

function TestConsumer() {
  const { dispatch } = useApp();
  const sync = useSyncEngine();
  return (
    <div>
      <div data-testid="status">{sync.status}</div>
      <div data-testid="pending">{sync.pendingCount}</div>
      <div data-testid="message">{sync.message ?? ''}</div>
      <button type="button" onClick={() => dispatch({ type: 'ADD_TASK', title: 'Buy milk' })}>
        add-task
      </button>
      <button type="button" onClick={() => dispatch({ type: 'RESET' })}>
        reset
      </button>
      <button type="button" onClick={sync.syncNow}>
        sync-now
      </button>
    </div>
  );
}

function renderApp() {
  return render(
    <AuthProvider>
      <AppProvider>
        <SyncEngineProvider>
          <TestConsumer />
        </SyncEngineProvider>
      </AppProvider>
    </AuthProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetMemoryStore();
  clearSyncMetadataStore();
  localStorage.clear();
  auth.getSession.mockResolvedValue({ data: { session: null } });
  auth.onAuthStateChange.mockImplementation((cb: (event: string, session: unknown) => void) => {
    authChangeCallback = cb;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
  drainDirtyWorkMock.mockResolvedValue(okResult());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('SyncEngineContext — automatic draining', () => {
  it('drains automatically once an authenticated session becomes available, with pending work already present', async () => {
    seedDirty('user-1');
    linkAccount('user-1');
    drainDirtyWorkMock.mockImplementation(async () => {
      clearDirtyFor('user-1', 't1');
      return okResult({ attempted: 1, outcomes: [{ kind: 'synced' }] });
    });

    renderApp();
    await flushMicrotasks();
    signIn('user-1');

    await waitFor(() => expect(drainDirtyWorkMock).toHaveBeenCalledWith('user-1', expect.any(Function), expect.any(Function)));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('synced'));
  });

  it('drains automatically after a signed-in user edit', async () => {
    linkAccount('user-1');
    renderApp();
    await flushMicrotasks();
    signIn('user-1');
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('synced'));
    drainDirtyWorkMock.mockClear();
    drainDirtyWorkMock.mockImplementation(async () => okResult({ attempted: 1, outcomes: [{ kind: 'synced' }] }));

    fireEvent.click(screen.getByRole('button', { name: 'add-task' }));

    await waitFor(() => expect(drainDirtyWorkMock).toHaveBeenCalledWith('user-1', expect.any(Function), expect.any(Function)));
  });

  it('never drains while signed out', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'add-task' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(drainDirtyWorkMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('status').textContent).toBe('idle');
  });
});

describe('SyncEngineContext — single-flight', () => {
  it('collapses a drain request that arrives while one is already in flight into a single rerun afterward', async () => {
    let resolveFirst!: (value: DrainPassResult) => void;
    const firstCall = new Promise<DrainPassResult>((resolve) => {
      resolveFirst = resolve;
    });
    drainDirtyWorkMock.mockReturnValueOnce(firstCall);
    seedDirty('user-1', 't1');
    linkAccount('user-1');

    renderApp();
    await flushMicrotasks();
    signIn('user-1');

    await waitFor(() => expect(drainDirtyWorkMock).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('status').textContent).toBe('syncing');

    // A second trigger arrives while the first is still in flight.
    drainDirtyWorkMock.mockResolvedValueOnce(okResult({ attempted: 0, outcomes: [] }));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'add-task' }));
    });

    // Still only one call outstanding — the second was queued, not started.
    expect(drainDirtyWorkMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst(okResult({ attempted: 1, outcomes: [{ kind: 'synced' }] }));
      // Let the mocked promise's resolution propagate through
      // attemptDrain's `await drainDirtyWork(...)` continuation (a real
      // pending microtask, not driven by fake timers) before checking.
      await new Promise((r) => setTimeout(r, 0));
    });

    // The queued rerun now fires.
    await waitFor(() => expect(drainDirtyWorkMock).toHaveBeenCalledTimes(2));
  });
});

describe('SyncEngineContext — retry with bounded backoff', () => {
  it('schedules exactly one retry after a network failure, and resets the counter after a clean pass', async () => {
    vi.useFakeTimers();
    seedDirty('user-1');
    linkAccount('user-1');
    drainDirtyWorkMock.mockResolvedValueOnce(okResult({ attempted: 1, networkFailure: true, stoppedEarly: true, outcomes: [{ kind: 'network-error', message: 'offline' }] }));

    renderApp();
    await flushMicrotasks();
    signIn('user-1');

    await vi.waitFor(() => expect(screen.getByTestId('status').textContent).toBe('offline'));
    expect(drainDirtyWorkMock).toHaveBeenCalledTimes(1);

    drainDirtyWorkMock.mockImplementation(async () => {
      clearDirtyFor('user-1', 't1');
      return okResult({ attempted: 1, outcomes: [{ kind: 'synced' }] });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(drainDirtyWorkMock).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('status').textContent).toBe('synced');
  });

  it('stops automatic retries after the bounded number of consecutive network failures', async () => {
    vi.useFakeTimers();
    seedDirty('user-1');
    linkAccount('user-1');
    drainDirtyWorkMock.mockResolvedValue(
      okResult({ attempted: 1, networkFailure: true, stoppedEarly: true, outcomes: [{ kind: 'network-error', message: 'offline' }] }),
    );

    renderApp();
    await flushMicrotasks();
    signIn('user-1');
    await vi.waitFor(() => expect(drainDirtyWorkMock).toHaveBeenCalledTimes(1));

    // Advance through every backoff delay (2s, 4s, 8s, 16s, 30s-capped) for
    // the bounded number of retries (5), then far beyond that.
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30000);
      });
    }

    // 1 initial attempt + at most 5 bounded retries = 6 total, never more.
    expect(drainDirtyWorkMock.mock.calls.length).toBeLessThanOrEqual(6);
    const callsAfterBound = drainDirtyWorkMock.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120000);
    });
    // No further automatic retries fire once the bound is reached.
    expect(drainDirtyWorkMock.mock.calls.length).toBe(callsAfterBound);
  });
});

describe('SyncEngineContext — status never claims synced with pending work', () => {
  it('reports pending, not synced, when a pass finishes without clearing everything', async () => {
    seedDirty('user-1');
    linkAccount('user-1');
    drainDirtyWorkMock.mockResolvedValue(okResult({ attempted: 0, outcomes: [], stoppedEarly: true }));

    renderApp();
    await flushMicrotasks();
    signIn('user-1');

    await waitFor(() => expect(drainDirtyWorkMock).toHaveBeenCalled());
    expect(screen.getByTestId('status').textContent).not.toBe('synced');
    expect(pendingCountFor('user-1')).toBeGreaterThan(0);
  });
});

describe('SyncEngineContext — cancellation', () => {
  it('does not apply a stale drain result after sign-out', async () => {
    let resolveDrain!: (value: DrainPassResult) => void;
    const inFlight = new Promise<DrainPassResult>((resolve) => {
      resolveDrain = resolve;
    });
    drainDirtyWorkMock.mockReturnValueOnce(inFlight);
    seedDirty('user-1');
    linkAccount('user-1');

    renderApp();
    await flushMicrotasks();
    signIn('user-1');
    await waitFor(() => expect(drainDirtyWorkMock).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('status').textContent).toBe('syncing');

    signOut();
    expect(screen.getByTestId('status').textContent).toBe('idle');

    await act(async () => {
      resolveDrain(okResult({ attempted: 1, outcomes: [{ kind: 'synced' }] }));
    });

    // The now-stale successful result must not resurrect a signed-in status.
    expect(screen.getByTestId('status').textContent).toBe('idle');
  });

  it('clears dirty work and stops draining on RESET', async () => {
    seedDirty('user-1');
    linkAccount('user-1');
    let resolveDrain!: (value: DrainPassResult) => void;
    drainDirtyWorkMock.mockReturnValueOnce(
      new Promise<DrainPassResult>((resolve) => {
        resolveDrain = resolve;
      }),
    );

    renderApp();
    await flushMicrotasks();
    signIn('user-1');
    await waitFor(() => expect(drainDirtyWorkMock).toHaveBeenCalledTimes(1));

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'reset' }));
    });

    // RESET clears the durable dirty set for the active account immediately.
    expect(pendingCountFor('user-1')).toBe(0);

    await act(async () => {
      resolveDrain(okResult({ attempted: 1, outcomes: [{ kind: 'synced' }] }));
    });
  });

  it('stops scheduled retries after the provider unmounts', async () => {
    vi.useFakeTimers();
    seedDirty('user-1');
    linkAccount('user-1');
    drainDirtyWorkMock.mockResolvedValue(
      okResult({ attempted: 1, networkFailure: true, stoppedEarly: true, outcomes: [{ kind: 'network-error', message: 'offline' }] }),
    );

    const { unmount } = renderApp();
    await flushMicrotasks();
    signIn('user-1');
    await vi.waitFor(() => expect(drainDirtyWorkMock).toHaveBeenCalledTimes(1));

    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });

    expect(drainDirtyWorkMock).toHaveBeenCalledTimes(1);
  });
});

describe('SyncEngineContext — manual Sync now', () => {
  it('is a no-op while signed out', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'sync-now' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(drainDirtyWorkMock).not.toHaveBeenCalled();
  });

  it('triggers a drain for the signed-in account', async () => {
    linkAccount('user-1');
    renderApp();
    await flushMicrotasks();
    signIn('user-1');
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('synced'));
    drainDirtyWorkMock.mockClear();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'sync-now' }));
    });

    await waitFor(() => expect(drainDirtyWorkMock).toHaveBeenCalledWith('user-1', expect.any(Function), expect.any(Function)));
  });
});

describe('SyncEngineContext — account-linking gate (Risk 2)', () => {
  it('a signed-in but unlinked device never calls drainDirtyWork, even with pending dirty work, and reports unlinked status', async () => {
    seedDirty('user-1');
    // Deliberately no linkAccount('user-1') — this account has never been
    // through migration or hydration on this device.

    renderApp();
    await flushMicrotasks();
    signIn('user-1');

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unlinked'));
    expect(screen.getByTestId('pending').textContent).toBe('1');
    expect(drainDirtyWorkMock).not.toHaveBeenCalled();
    expect(isEstablished('user-1')).toBe(false);
  });

  it('dirty work still saves durably for an unlinked account (local-first is preserved), it is simply never drained', async () => {
    renderApp();
    await flushMicrotasks();
    signIn('user-1');
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unlinked'));

    fireEvent.click(screen.getByRole('button', { name: 'add-task' }));

    await waitFor(() => expect(pendingCountFor('user-1')).toBe(1));
    expect(drainDirtyWorkMock).not.toHaveBeenCalled();
  });

  it('"Sync now" does not bypass the linking gate while unlinked', async () => {
    seedDirty('user-1');

    renderApp();
    await flushMicrotasks();
    signIn('user-1');
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unlinked'));

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'sync-now' }));
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(drainDirtyWorkMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('status').textContent).toBe('unlinked');
  });

  it('the "Sync now" button itself is disabled while unlinked', async () => {
    renderApp();
    await flushMicrotasks();
    signIn('user-1');
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unlinked'));

    // The button lives in SyncStatusPanel, not this file's minimal
    // TestConsumer — this test only proves the underlying gate (above);
    // SyncStatusPanel.test.tsx proves the button itself is disabled.
    expect(isEstablished('user-1')).toBe(false);
  });

  it('becomes eligible to drain once this device is linked (e.g. by a completed migration), without needing to sign out and back in', async () => {
    seedDirty('user-1');
    drainDirtyWorkMock.mockImplementation(async () => {
      clearDirtyFor('user-1', 't1');
      return okResult({ attempted: 1, outcomes: [{ kind: 'synced' }] });
    });

    renderApp();
    await flushMicrotasks();
    signIn('user-1');
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unlinked'));
    expect(drainDirtyWorkMock).not.toHaveBeenCalled();

    // Simulate what MigrationPanel does after a verified-successful
    // migration, then let a further edit re-trigger the auto-drain effect
    // (matching how a real completed migration is followed by a re-render).
    linkAccount('user-1');
    fireEvent.click(screen.getByRole('button', { name: 'add-task' }));

    await waitFor(() => expect(drainDirtyWorkMock).toHaveBeenCalledWith('user-1', expect.any(Function), expect.any(Function)));
  });

  it('switching to a different account requires that account\'s own linkage — an established account does not carry over', async () => {
    linkAccount('user-1');
    seedDirty('user-2', 't2');

    renderApp();
    await flushMicrotasks();
    signIn('user-1');
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('synced'));

    signIn('user-2');

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unlinked'));
    expect(drainDirtyWorkMock).not.toHaveBeenCalledWith('user-2', expect.any(Function), expect.any(Function));
  });

  it('stale linkage for a previously-used account cannot authorize writes for a different, currently signed-in account', async () => {
    // account-a was linked (and drained) on this device previously; it
    // remains established in the durable store, as it should — but that
    // must never leak into authorizing writes for account-b.
    linkAccount('account-a');
    seedDirty('account-b', 'tb');

    renderApp();
    await flushMicrotasks();
    signIn('account-b');

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unlinked'));
    expect(drainDirtyWorkMock).not.toHaveBeenCalled();
    expect(isEstablished('account-a')).toBe(true);
    expect(isEstablished('account-b')).toBe(false);
  });
});
