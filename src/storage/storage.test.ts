import { describe, expect, it, beforeEach } from 'vitest';
import {
  clearAppData,
  flushSave,
  getStorage,
  loadAppData,
  resetMemoryStore,
  saveAppData,
} from '../storage/storage';
import { parseJsonAppData, validateAppData } from '../storage/validation';
import { exportToJson } from '../storage/exportImport';
import {
  appReducer,
  countPrimaryTodayTasks,
  createTaskForTest,
  getActiveQuickNotes,
  getRecentlyCompletedQuickNotes,
} from '../store/reducer';
import { createEmptyAppData, STORAGE_KEY, type AppData } from '../types';

function sampleData(): AppData {
  return {
    version: 1,
    tasks: [
      createTaskForTest({ id: 't1', title: 'First', status: 'Inbox', sortOrder: 0 }),
      createTaskForTest({ id: 't2', title: 'Second', status: 'Today', sortOrder: 1, isPrimary: true }),
    ],
    projects: [{ id: 'p1', name: 'Home', status: 'active' }],
    quickNotes: [
      { id: 'n1', text: 'Buy underwear', completed: false, deleted: false, createdAt: '2026-08-28T00:00:00.000Z' },
    ],
    // validateAppData now always normalizes goals/targets to [] when absent
    // (backward compatibility with pre-Goals/Targets backups) — included
    // here explicitly so round-trips through parseJsonAppData compare equal.
    goals: [],
    targets: [],
  };
}

describe('storage', () => {
  beforeEach(() => {
    resetMemoryStore();
    clearAppData();
  });

  it('saved data reloads correctly', () => {
    const data = sampleData();
    saveAppData(data);
    const loaded = loadAppData();
    expect(loaded).toEqual(data);
  });

  it('invalid stored data returns empty state safely', () => {
    getStorage().setItem(STORAGE_KEY, '{not json');
    const loaded = loadAppData();
    expect(loaded).toEqual(createEmptyAppData());
  });
});

describe('task lifecycle', () => {
  it('add, edit, move, complete, and archive', () => {
    let state = createEmptyAppData();

    state = appReducer(state, { type: 'ADD_TASK', title: 'Buy milk' });
    expect(state.tasks).toHaveLength(1);
    const id = state.tasks[0].id;

    state = appReducer(state, {
      type: 'UPDATE_TASK',
      id,
      updates: { notes: '2%', priority: 'High' },
    });
    expect(state.tasks[0].notes).toBe('2%');
    expect(state.tasks[0].priority).toBe('High');

    state = appReducer(state, {
      type: 'UPDATE_TASK',
      id,
      updates: { status: 'Today' },
    });
    expect(state.tasks[0].status).toBe('Today');

    state = appReducer(state, { type: 'COMPLETE_TASK', id });
    expect(state.tasks[0].status).toBe('Done');
    expect(state.tasks[0].completedAt).toBeTruthy();

    state = appReducer(state, { type: 'ARCHIVE_TASK', id });
    expect(state.tasks[0].archived).toBe(true);
  });
});

describe('primary task cap', () => {
  it('rejects a fourth primary task', () => {
    let state = createEmptyAppData();
    const ids: string[] = [];

    for (let i = 0; i < 4; i++) {
      state = appReducer(state, { type: 'ADD_TASK', title: `Task ${i}`, status: 'Today' });
      ids.push(state.tasks[i].id);
    }

    state = appReducer(state, { type: 'SET_PRIMARY', id: ids[0], isPrimary: true });
    state = appReducer(state, { type: 'SET_PRIMARY', id: ids[1], isPrimary: true });
    state = appReducer(state, { type: 'SET_PRIMARY', id: ids[2], isPrimary: true });
    expect(countPrimaryTodayTasks(state.tasks)).toBe(3);

    const before = state;
    state = appReducer(state, { type: 'SET_PRIMARY', id: ids[3], isPrimary: true });
    expect(state).toBe(before);
    expect(countPrimaryTodayTasks(state.tasks)).toBe(3);
  });
});

describe('quick notes', () => {
  it('adds a note to the active list', () => {
    let state = createEmptyAppData();
    state = appReducer(state, { type: 'ADD_QUICK_NOTE', text: 'Buy underwear' });

    const active = getActiveQuickNotes(state.quickNotes);
    expect(active).toHaveLength(1);
    expect(active[0].text).toBe('Buy underwear');
    expect(active[0].completed).toBe(false);
    expect(active[0].deleted).toBe(false);
  });

  it('shows active notes newest-first, by createdAt', () => {
    // Constructed directly (not via ADD_QUICK_NOTE) so the two createdAt
    // timestamps are guaranteed distinct, unlike two reducer calls that can
    // land in the same millisecond.
    const state: AppData = {
      ...createEmptyAppData(),
      quickNotes: [
        { id: 'n1', text: 'Buy underwear', completed: false, deleted: false, createdAt: '2026-09-07T00:00:00.000Z' },
        {
          id: 'n2',
          text: 'Add idea to pitch deck',
          completed: false,
          deleted: false,
          createdAt: '2026-09-07T00:00:05.000Z',
        },
      ],
    };

    const active = getActiveQuickNotes(state.quickNotes);
    expect(active.map((n) => n.text)).toEqual(['Add idea to pitch deck', 'Buy underwear']);
  });

  it('does not create a record for a blank or whitespace-only add', () => {
    const before = createEmptyAppData();
    let state = appReducer(before, { type: 'ADD_QUICK_NOTE', text: '' });
    expect(state).toBe(before);
    state = appReducer(before, { type: 'ADD_QUICK_NOTE', text: '   ' });
    expect(state).toBe(before);
    expect(state.quickNotes).toHaveLength(0);
  });

  it('completing a note removes it from the active list and surfaces it in recently completed', () => {
    let state = appReducer(createEmptyAppData(), { type: 'ADD_QUICK_NOTE', text: 'Buy underwear' });
    const id = state.quickNotes[0].id;

    state = appReducer(state, { type: 'COMPLETE_QUICK_NOTE', id });

    expect(getActiveQuickNotes(state.quickNotes)).toHaveLength(0);
    const completed = getRecentlyCompletedQuickNotes(state.quickNotes);
    expect(completed).toHaveLength(1);
    expect(completed[0].completed).toBe(true);
    expect(completed[0].completedAt).toBeTruthy();
  });

  it('recently completed only shows notes completed within the last 7 days', () => {
    let state = appReducer(createEmptyAppData(), { type: 'ADD_QUICK_NOTE', text: 'Old one' });
    const id = state.quickNotes[0].id;
    state = appReducer(state, { type: 'COMPLETE_QUICK_NOTE', id });
    const completedAt = new Date(state.quickNotes[0].completedAt!).getTime();

    const sixDaysLater = completedAt + 6 * 24 * 60 * 60 * 1000;
    const eightDaysLater = completedAt + 8 * 24 * 60 * 60 * 1000;

    expect(getRecentlyCompletedQuickNotes(state.quickNotes, sixDaysLater)).toHaveLength(1);
    expect(getRecentlyCompletedQuickNotes(state.quickNotes, eightDaysLater)).toHaveLength(0);
  });

  it('reopening a completed note (uncomplete) returns it to the active list', () => {
    let state = appReducer(createEmptyAppData(), { type: 'ADD_QUICK_NOTE', text: 'Buy underwear' });
    const id = state.quickNotes[0].id;
    state = appReducer(state, { type: 'COMPLETE_QUICK_NOTE', id });
    state = appReducer(state, { type: 'UNCOMPLETE_QUICK_NOTE', id });

    expect(getActiveQuickNotes(state.quickNotes)).toHaveLength(1);
    expect(getRecentlyCompletedQuickNotes(state.quickNotes)).toHaveLength(0);
    expect(state.quickNotes[0].completedAt).toBeUndefined();
  });

  it('deleting a note (from either list) removes it from both, permanently', () => {
    let state = appReducer(createEmptyAppData(), { type: 'ADD_QUICK_NOTE', text: 'Buy underwear' });
    const id = state.quickNotes[0].id;

    state = appReducer(state, { type: 'DELETE_QUICK_NOTE', id });

    expect(getActiveQuickNotes(state.quickNotes)).toHaveLength(0);
    expect(getRecentlyCompletedQuickNotes(state.quickNotes)).toHaveLength(0);
    // Soft-deleted for sync purposes (never truly vanishes from the array),
    // matching this app's existing archive-not-delete model, but is excluded
    // from every read path.
    expect(state.quickNotes.find((n) => n.id === id)?.deleted).toBe(true);
  });

  it('deleting a completed note removes it from the recently-completed section', () => {
    let state = appReducer(createEmptyAppData(), { type: 'ADD_QUICK_NOTE', text: 'Buy underwear' });
    const id = state.quickNotes[0].id;
    state = appReducer(state, { type: 'COMPLETE_QUICK_NOTE', id });
    state = appReducer(state, { type: 'DELETE_QUICK_NOTE', id });

    expect(getRecentlyCompletedQuickNotes(state.quickNotes)).toHaveLength(0);
  });

  it('a nonexistent or already-deleted id is a no-op for complete/uncomplete/delete', () => {
    const before = appReducer(createEmptyAppData(), { type: 'ADD_QUICK_NOTE', text: 'Buy underwear' });
    const missing = 'does-not-exist';

    expect(appReducer(before, { type: 'COMPLETE_QUICK_NOTE', id: missing })).toBe(before);
    expect(appReducer(before, { type: 'UNCOMPLETE_QUICK_NOTE', id: missing })).toBe(before);
    expect(appReducer(before, { type: 'DELETE_QUICK_NOTE', id: missing })).toBe(before);
  });

  it('persists through save/load like any other AppData field', () => {
    const state = appReducer(createEmptyAppData(), { type: 'ADD_QUICK_NOTE', text: 'Buy underwear' });
    resetMemoryStore();
    clearAppData();
    saveAppData(state);
    expect(loadAppData()).toEqual(state);
  });
});

describe('reducer id pass-through and APPLY_REMOTE_UPDATE (Phase 5B3A scaffold)', () => {
  it('ADD_TASK uses a caller-supplied id instead of generating one, when given', () => {
    const state = appReducer(createEmptyAppData(), {
      type: 'ADD_TASK',
      id: 'preset-task-id',
      title: 'Buy milk',
    });
    expect(state.tasks[0].id).toBe('preset-task-id');
  });

  it('ADD_TASK still generates its own id when none is supplied', () => {
    const state = appReducer(createEmptyAppData(), { type: 'ADD_TASK', title: 'Buy milk' });
    expect(state.tasks[0].id).toBeTruthy();
  });

  it('ADD_PROJECT uses a caller-supplied id instead of generating one, when given', () => {
    const state = appReducer(createEmptyAppData(), {
      type: 'ADD_PROJECT',
      id: 'preset-project-id',
      name: 'Home',
    });
    expect(state.projects[0].id).toBe('preset-project-id');
  });

  it('ADD_QUICK_NOTE uses a caller-supplied id instead of generating one, when given', () => {
    const state = appReducer(createEmptyAppData(), {
      type: 'ADD_QUICK_NOTE',
      id: 'preset-note-id',
      text: 'Buy underwear',
    });
    expect(state.quickNotes[0].id).toBe('preset-note-id');
  });

  it('ADD_QUICK_NOTE still generates its own id when none is supplied', () => {
    const state = appReducer(createEmptyAppData(), { type: 'ADD_QUICK_NOTE', text: 'Buy underwear' });
    expect(state.quickNotes[0].id).toBeTruthy();
  });

  it('APPLY_REMOTE_UPDATE replaces state wholesale, exactly like LOAD/IMPORT', () => {
    const before = appReducer(createEmptyAppData(), { type: 'ADD_TASK', title: 'Local only' });
    const remote = sampleData();
    const state = appReducer(before, { type: 'APPLY_REMOTE_UPDATE', data: remote });
    expect(state).toEqual(remote);
  });
});

describe('export and import', () => {
  it('reproduces saved data', () => {
    const data = sampleData();
    const json = exportToJson(data);
    const result = parseJsonAppData(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(data);
    }
  });

  it('round-trips through storage flush', () => {
    const data = sampleData();
    saveAppData(data);
    flushSave(data);
    expect(loadAppData()).toEqual(data);
  });
});

describe('validation', () => {
  it('rejects invalid imported data', () => {
    expect(parseJsonAppData('not json').ok).toBe(false);
    expect(validateAppData({ version: 2 }).ok).toBe(false);
    expect(validateAppData({ version: 1, tasks: 'bad', projects: [], quickNotes: [] }).ok).toBe(
      false,
    );
  });

  it('does not mutate store on invalid import attempt', () => {
    const data = sampleData();
    saveAppData(data);
    const result = parseJsonAppData('{ "version": 1, "tasks": null }');
    expect(result.ok).toBe(false);
    expect(loadAppData()).toEqual(data);
  });

  it('accepts a project with a valid positive-integer priorityRank', () => {
    const data = {
      ...sampleData(),
      projects: [{ id: 'p1', name: 'Home', status: 'active', priorityRank: 2 }],
    };
    const result = validateAppData(data);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.projects[0].priorityRank).toBe(2);
  });

  it('accepts a project with no priorityRank at all', () => {
    const result = validateAppData(sampleData());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.projects[0].priorityRank).toBeUndefined();
  });

  it('rejects a project with a zero, negative, or non-numeric priorityRank', () => {
    const base = sampleData();
    expect(
      validateAppData({ ...base, projects: [{ id: 'p1', name: 'Home', status: 'active', priorityRank: 0 }] }).ok,
    ).toBe(false);
    expect(
      validateAppData({ ...base, projects: [{ id: 'p1', name: 'Home', status: 'active', priorityRank: -1 }] }).ok,
    ).toBe(false);
    expect(
      validateAppData({ ...base, projects: [{ id: 'p1', name: 'Home', status: 'active', priorityRank: '1' }] }).ok,
    ).toBe(false);
  });
});
