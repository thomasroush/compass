// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import { AppProvider } from './AppContext';
import { AuthProvider } from './AuthContext';
import { useApp } from './useApp';

/**
 * Wiring-level tests for Phase 5B3A, task 3 of 3 — proves `AppContext.tsx`
 * actually calls the pure primitives in `src/sync/actionProvenance.ts` and
 * `src/sync/generation.ts` at the right moments, on top of
 * `actionProvenance.test.ts`/`generation.test.ts`'s thorough coverage of
 * those primitives in isolation.
 */

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}));

const markDirtySpy = vi.hoisted(() => vi.fn());
const generationInvalidateSpy = vi.hoisted(() => vi.fn());

vi.mock('../lib/supabaseClient', () => ({
  supabase: { auth },
  isSupabaseConfigured: true,
}));

vi.mock('../sync/metadata', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sync/metadata')>();
  markDirtySpy.mockImplementation(actual.markDirty);
  return { ...actual, markDirty: markDirtySpy };
});

vi.mock('../sync/generation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sync/generation')>();
  return {
    ...actual,
    createSyncGeneration: () => {
      const real = actual.createSyncGeneration();
      generationInvalidateSpy.mockImplementation(real.invalidate);
      return { current: real.current, isCurrent: real.isCurrent, invalidate: generationInvalidateSpy };
    },
  };
});

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

function TestConsumer() {
  const { state, dispatch } = useApp();
  return (
    <div>
      <div data-testid="task-count">{state.tasks.length}</div>
      <div data-testid="task-id">{state.tasks[0]?.id ?? ''}</div>
      <button type="button" onClick={() => dispatch({ type: 'ADD_TASK', title: 'Buy milk' })}>
        add-task
      </button>
      <button
        type="button"
        onClick={() =>
          dispatch({
            type: 'LOAD',
            data: { version: 1, tasks: [], projects: [], dailyNotes: [] },
          })
        }
      >
        load
      </button>
      <button type="button" onClick={() => dispatch({ type: 'RESET' })}>
        reset
      </button>
      <button
        type="button"
        onClick={() =>
          dispatch({
            type: 'IMPORT',
            data: { version: 1, tasks: [], projects: [], dailyNotes: [] },
          })
        }
      >
        import
      </button>
    </div>
  );
}

function renderApp() {
  return render(
    <AuthProvider>
      <AppProvider>
        <TestConsumer />
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
});

afterEach(() => {
  cleanup();
});

describe('AppContext dispatch wrapper — dirty marking', () => {
  it('does not mark anything dirty for a user edit while signed out', async () => {
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'add-task' }));
    await screen.findByText('1');
    expect(markDirtySpy).not.toHaveBeenCalled();
  });

  it('marks the newly created task dirty, under the exact id that lands in state, once signed in', async () => {
    renderApp();
    signIn('user-1');

    fireEvent.click(screen.getByRole('button', { name: 'add-task' }));
    await screen.findByText('1');

    const createdId = screen.getByTestId('task-id').textContent;
    expect(createdId).toBeTruthy();
    expect(markDirtySpy).toHaveBeenCalledTimes(1);
    expect(markDirtySpy).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'user-1' }),
      'task',
      createdId,
    );
  });

  it('never marks anything dirty for a sync-boundary action (LOAD), even while signed in and even though state changes', async () => {
    renderApp();
    signIn('user-1');

    fireEvent.click(screen.getByRole('button', { name: 'load' }));

    expect(markDirtySpy).not.toHaveBeenCalled();
  });
});

describe('AppContext dispatch wrapper — generation invalidation', () => {
  it('invalidates the generation on RESET', () => {
    renderApp();
    generationInvalidateSpy.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'reset' }));

    expect(generationInvalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('invalidates the generation on IMPORT', () => {
    renderApp();
    generationInvalidateSpy.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'import' }));

    expect(generationInvalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('does not invalidate the generation on LOAD', () => {
    renderApp();
    generationInvalidateSpy.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'load' }));

    expect(generationInvalidateSpy).not.toHaveBeenCalled();
  });

  it('does not invalidate the generation for an ordinary user edit', () => {
    renderApp();
    generationInvalidateSpy.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'add-task' }));

    expect(generationInvalidateSpy).not.toHaveBeenCalled();
  });

  it('does not invalidate the generation on sign-in (nothing was running while signed out, so there is nothing to protect against)', () => {
    renderApp();
    generationInvalidateSpy.mockClear();

    signIn('user-1');

    expect(generationInvalidateSpy).not.toHaveBeenCalled();
  });

  it('invalidates the generation when switching to a different authenticated account', () => {
    renderApp();
    signIn('user-1');
    generationInvalidateSpy.mockClear();

    signIn('user-2');

    expect(generationInvalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('invalidates the generation on sign-out', () => {
    renderApp();
    signIn('user-1');
    generationInvalidateSpy.mockClear();

    signOut();

    expect(generationInvalidateSpy).toHaveBeenCalledTimes(1);
  });

  it('invalidates the generation on teardown (unmount)', () => {
    renderApp();
    generationInvalidateSpy.mockClear();

    cleanup();

    expect(generationInvalidateSpy).toHaveBeenCalledTimes(1);
  });
});
