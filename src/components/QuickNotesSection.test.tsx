// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QuickNotesSection } from './QuickNotesSection';
import { createEmptyAppData, type AppData, type QuickNote } from '../types';

const mocks = vi.hoisted(() => ({
  appState: {
    current: { version: 1, tasks: [], projects: [], quickNotes: [], goals: [], targets: [] } as AppData,
    dispatch: vi.fn(),
  },
  cloudSyncState: {
    quickNotesError: null as string | null,
  },
}));

vi.mock('../store/useApp', () => ({
  useApp: () => ({ state: mocks.appState.current, dispatch: mocks.appState.dispatch }),
}));

vi.mock('../store/useCloudSync', () => ({
  useCloudSync: () => ({ quickNotesError: mocks.cloudSyncState.quickNotesError }),
}));

function note(overrides: Partial<QuickNote> = {}): QuickNote {
  return {
    id: 'n1',
    text: 'Buy underwear',
    completed: false,
    deleted: false,
    createdAt: '2026-09-07T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appState.current = createEmptyAppData();
  mocks.cloudSyncState.quickNotesError = null;
});

afterEach(() => {
  cleanup();
});

describe('QuickNotesSection — active list', () => {
  it('shows an empty state when there are no quick notes', () => {
    render(<QuickNotesSection />);
    expect(screen.getByText('No quick notes yet.')).toBeTruthy();
  });

  it('lists active quick notes with a checkbox and Convert to Task, and no separate Delete control', () => {
    mocks.appState.current = { ...createEmptyAppData(), quickNotes: [note()] };
    render(<QuickNotesSection />);

    expect(screen.getByText('Buy underwear')).toBeTruthy();
    expect(screen.getByRole('checkbox')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Convert to Task' })).toBeTruthy();
    // The checkbox is the only completion/removal control now — no separate Delete button.
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('never lists a completed or deleted note among the checkbox rows — both vanish from the UI entirely (there is no Recently completed section to hold them)', () => {
    mocks.appState.current = {
      ...createEmptyAppData(),
      quickNotes: [
        note({ id: 'active', text: 'Still active' }),
        note({ id: 'done', text: 'Already done', completed: true, completedAt: new Date().toISOString() }),
        note({ id: 'gone', text: 'Already deleted', deleted: true }),
      ],
    };
    render(<QuickNotesSection />);

    // Only the truly-active note has a checkbox row.
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByText('Still active')).toBeTruthy();
    // Completed and deleted notes are both excluded from the UI entirely.
    expect(screen.queryByText('Already done')).toBeNull();
    expect(screen.queryByText('Already deleted')).toBeNull();
    expect(screen.queryByText(/Recently completed/)).toBeNull();
  });
});

describe('QuickNotesSection — checkbox (complete)', () => {
  it('checking a note dispatches COMPLETE_QUICK_NOTE with that note\'s id, and nothing else', () => {
    mocks.appState.current = { ...createEmptyAppData(), quickNotes: [note()] };
    render(<QuickNotesSection />);

    fireEvent.click(screen.getByRole('checkbox'));

    expect(mocks.appState.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.appState.dispatch).toHaveBeenCalledWith({ type: 'COMPLETE_QUICK_NOTE', id: 'n1' });
  });

  it('checking one note among several only affects that note\'s id — no cross-row mixup', () => {
    mocks.appState.current = {
      ...createEmptyAppData(),
      quickNotes: [
        note({ id: 'first', text: 'First note', createdAt: '2026-09-07T00:00:02.000Z' }),
        note({ id: 'second', text: 'Second note', createdAt: '2026-09-07T00:00:01.000Z' }),
        note({ id: 'third', text: 'Third note', createdAt: '2026-09-07T00:00:00.000Z' }),
      ],
    };
    render(<QuickNotesSection />);

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(3);
    fireEvent.click(checkboxes[1]);

    expect(mocks.appState.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.appState.dispatch).toHaveBeenCalledWith({ type: 'COMPLETE_QUICK_NOTE', id: 'second' });
  });

  it('the checkbox click never also dispatches DELETE_QUICK_NOTE (no bubbling into a sibling control)', () => {
    mocks.appState.current = { ...createEmptyAppData(), quickNotes: [note()] };
    render(<QuickNotesSection />);

    fireEvent.click(screen.getByRole('checkbox'));

    const deleteDispatches = mocks.appState.dispatch.mock.calls.filter(([action]) => action.type === 'DELETE_QUICK_NOTE');
    expect(deleteDispatches).toHaveLength(0);
  });
});

describe('QuickNotesSection — no Recently completed section', () => {
  it('never renders a "Recently completed" section, or a Reopen control, for a completed note — checking a note removes it from the UI for good', () => {
    mocks.appState.current = {
      ...createEmptyAppData(),
      quickNotes: [note({ completed: true, completedAt: new Date().toISOString() })],
    };
    render(<QuickNotesSection />);

    expect(screen.queryByText(/Recently completed/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull();
    expect(screen.queryByText('Buy underwear')).toBeNull();
  });

  it('a note completed just now and a note completed 8 days ago are both equally absent from the UI', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    mocks.appState.current = {
      ...createEmptyAppData(),
      quickNotes: [
        note({ id: 'recent', text: 'Just completed', completed: true, completedAt: new Date().toISOString() }),
        note({ id: 'old', text: 'Completed a while ago', completed: true, completedAt: eightDaysAgo }),
      ],
    };
    render(<QuickNotesSection />);

    expect(screen.queryByText('Just completed')).toBeNull();
    expect(screen.queryByText('Completed a while ago')).toBeNull();
    expect(screen.queryByText(/Recently completed/)).toBeNull();
  });
});

describe('QuickNotesSection — Convert to Task', () => {
  it('opens the task form pre-filled with the note\'s text', () => {
    mocks.appState.current = { ...createEmptyAppData(), quickNotes: [note({ text: 'Call the plumber' })] };
    render(<QuickNotesSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Convert to Task' }));

    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Call the plumber');
  });

  it('on successful submit, creates the task and then deletes the source quick note (in that order)', () => {
    mocks.appState.current = { ...createEmptyAppData(), quickNotes: [note({ text: 'Call the plumber' })] };
    render(<QuickNotesSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Convert to Task' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));

    const calls = mocks.appState.dispatch.mock.calls.map(([action]) => action.type);
    expect(calls).toEqual(['ADD_TASK', 'DELETE_QUICK_NOTE']);
    expect(mocks.appState.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ADD_TASK', title: 'Call the plumber' }),
    );
    expect(mocks.appState.dispatch).toHaveBeenCalledWith({ type: 'DELETE_QUICK_NOTE', id: 'n1' });
  });

  it('cancelling the task form never deletes the quick note, and never creates a task', () => {
    mocks.appState.current = { ...createEmptyAppData(), quickNotes: [note({ text: 'Call the plumber' })] };
    render(<QuickNotesSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Convert to Task' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mocks.appState.dispatch).not.toHaveBeenCalled();
    // The quick note is still in the active list — conversion never happened.
    expect(screen.getByText('Call the plumber')).toBeTruthy();
  });

  it('submitting a blank title never deletes the quick note (task creation did not happen)', () => {
    mocks.appState.current = { ...createEmptyAppData(), quickNotes: [note({ text: 'Call the plumber' })] };
    render(<QuickNotesSection />);

    fireEvent.click(screen.getByRole('button', { name: 'Convert to Task' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));

    expect(mocks.appState.dispatch).not.toHaveBeenCalled();
  });
});

describe('QuickNotesSection — Quick Notes sync error', () => {
  it('shows a scoped error message when the cloud sync layer reports a Quick Notes failure', () => {
    mocks.cloudSyncState.quickNotesError = "Could not find the table 'public.quick_notes'";
    render(<QuickNotesSection />);
    expect(screen.getByRole('alert').textContent).toContain("Could not find the table 'public.quick_notes'");
  });

  it('shows no error message when Quick Notes synced successfully', () => {
    mocks.cloudSyncState.quickNotesError = null;
    render(<QuickNotesSection />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
