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
  getDailyNoteForDate,
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
    dailyNotes: [{ id: 'n1', date: '2026-08-28', morning: 'Focus', evening: 'Done' }],
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

describe('daily notes', () => {
  it('persist by date', () => {
    let state = createEmptyAppData();
    state = appReducer(state, {
      type: 'UPSERT_DAILY_NOTE',
      date: '2026-08-28',
      morning: 'Plan day',
      evening: 'Review',
    });

    const note = getDailyNoteForDate(state.dailyNotes, '2026-08-28');
    expect(note?.morning).toBe('Plan day');
    expect(note?.evening).toBe('Review');

    state = appReducer(state, {
      type: 'UPSERT_DAILY_NOTE',
      date: '2026-08-28',
      evening: 'Updated',
    });
    expect(getDailyNoteForDate(state.dailyNotes, '2026-08-28')?.evening).toBe('Updated');
  });

  it('does not create a record for a blank upsert with no existing note (e.g. visiting Daily Notes without typing)', () => {
    const before = createEmptyAppData();
    const state = appReducer(before, {
      type: 'UPSERT_DAILY_NOTE',
      date: '2026-08-31',
      morning: '',
      evening: '',
    });

    expect(state).toBe(before);
    expect(getDailyNoteForDate(state.dailyNotes, '2026-08-31')).toBeUndefined();
    expect(state.dailyNotes).toHaveLength(0);
  });

  it('does not create a record for a whitespace-only upsert with no existing note', () => {
    const before = createEmptyAppData();
    const state = appReducer(before, {
      type: 'UPSERT_DAILY_NOTE',
      date: '2026-08-31',
      morning: '   ',
      evening: '\n\t ',
    });

    expect(state).toBe(before);
    expect(state.dailyNotes).toHaveLength(0);
  });

  it('still creates a record normally when the upsert has real content', () => {
    const state = appReducer(createEmptyAppData(), {
      type: 'UPSERT_DAILY_NOTE',
      date: '2026-08-31',
      morning: 'Went for a run',
      evening: '',
    });

    const note = getDailyNoteForDate(state.dailyNotes, '2026-08-31');
    expect(note).toBeDefined();
    expect(note?.morning).toBe('Went for a run');
    expect(note?.evening).toBe('');
  });

  it('still allows clearing an existing note back to blank, without restoring or deleting it', () => {
    let state = appReducer(createEmptyAppData(), {
      type: 'UPSERT_DAILY_NOTE',
      date: '2026-08-31',
      morning: 'Went for a run',
      evening: 'Read a book',
    });
    expect(state.dailyNotes).toHaveLength(1);

    state = appReducer(state, {
      type: 'UPSERT_DAILY_NOTE',
      date: '2026-08-31',
      morning: '',
      evening: '',
    });

    // The existing record is updated in place (cleared), not deleted and not
    // left holding its old text.
    expect(state.dailyNotes).toHaveLength(1);
    const note = getDailyNoteForDate(state.dailyNotes, '2026-08-31');
    expect(note?.morning).toBe('');
    expect(note?.evening).toBe('');
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

  it('UPSERT_DAILY_NOTE uses a caller-supplied id for a new note, when given', () => {
    const state = appReducer(createEmptyAppData(), {
      type: 'UPSERT_DAILY_NOTE',
      id: 'preset-note-id',
      date: '2026-09-01',
      morning: 'Plan',
    });
    expect(state.dailyNotes[0].id).toBe('preset-note-id');
  });

  it('UPSERT_DAILY_NOTE ignores a caller-supplied id when updating an existing note (keeps the existing id)', () => {
    let state = appReducer(createEmptyAppData(), {
      type: 'UPSERT_DAILY_NOTE',
      id: 'first-id',
      date: '2026-09-01',
      morning: 'Plan',
    });
    state = appReducer(state, {
      type: 'UPSERT_DAILY_NOTE',
      id: 'a-different-id-that-should-be-ignored',
      date: '2026-09-01',
      evening: 'Review',
    });
    expect(state.dailyNotes).toHaveLength(1);
    expect(state.dailyNotes[0].id).toBe('first-id');
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
    expect(validateAppData({ version: 1, tasks: 'bad', projects: [], dailyNotes: [] }).ok).toBe(
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
});
