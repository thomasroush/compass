import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AppData, DailyNote, Project, Task } from '../types';
import { createEmptyAppData } from '../types';
import type { CloudDailyNote, CloudProject, CloudTask, RepositoryResult } from '../repository/types';
import { resetMemoryStore } from '../storage/storage';
import {
  createEmptyAccountMetadata,
  getAccountMetadata,
  markDirty,
  setRecordUpdatedAt,
  upsertAccountMetadata,
} from './metadata';
import { clearSyncMetadataStore, loadSyncMetadataStore, saveSyncMetadataStore } from './metadataStorage';

const projectsRepo = vi.hoisted(() => ({
  createProject: vi.fn(),
  updateProjectGuarded: vi.fn(),
  listProjects: vi.fn(),
}));
const tasksRepo = vi.hoisted(() => ({
  createTask: vi.fn(),
  updateTaskGuarded: vi.fn(),
  listTasks: vi.fn(),
}));
const dailyNotesRepo = vi.hoisted(() => ({
  createDailyNote: vi.fn(),
  updateDailyNoteGuarded: vi.fn(),
  listDailyNotes: vi.fn(),
}));

vi.mock('../repository/projectsRepository', () => projectsRepo);
vi.mock('../repository/tasksRepository', () => tasksRepo);
vi.mock('../repository/dailyNotesRepository', () => dailyNotesRepo);

import { drainDirtyWork } from './drainSync';

const ACCOUNT = 'account-1';

function ok<T>(data: T): RepositoryResult<T> {
  return { ok: true, data };
}
function err(type: 'unauthenticated' | 'unconfigured' | 'database' | 'conflict' | 'account-mismatch' | 'duplicate', message: string): RepositoryResult<never> {
  return { ok: false, error: { type, message } };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Buy milk',
    status: 'Inbox',
    priority: 'Normal',
    createdAt: '2026-09-01T00:00:00.000Z',
    sortOrder: 0,
    isPrimary: false,
    archived: false,
    ...overrides,
  };
}
function cloudTask(base: Task = task(), overrides: Partial<CloudTask> = {}): CloudTask {
  return { ...base, updatedAt: '2026-09-01T01:00:00.000Z', ...overrides };
}
function project(overrides: Partial<Project> = {}): Project {
  return { id: 'p1', name: 'Home', status: 'active', ...overrides };
}
function cloudProject(base: Project = project(), overrides: Partial<CloudProject> = {}): CloudProject {
  return { ...base, updatedAt: '2026-09-01T01:00:00.000Z', ...overrides };
}
function note(overrides: Partial<DailyNote> = {}): DailyNote {
  return { id: 'n1', date: '2026-09-01', morning: 'Plan', evening: '', ...overrides };
}
function cloudNote(base: DailyNote = note(), overrides: Partial<CloudDailyNote> = {}): CloudDailyNote {
  return { ...base, updatedAt: '2026-09-01T01:00:00.000Z', ...overrides };
}

function localData(overrides: Partial<AppData> = {}): AppData {
  return { ...createEmptyAppData(), ...overrides };
}

function dirtyMetadata(mutate: (m: ReturnType<typeof createEmptyAccountMetadata>) => ReturnType<typeof createEmptyAccountMetadata>) {
  const store = loadSyncMetadataStore();
  const meta = mutate(getAccountMetadata(store, ACCOUNT));
  saveSyncMetadataStore(upsertAccountMetadata(store, meta));
}

const alwaysCurrent = () => true;

beforeEach(() => {
  vi.clearAllMocks();
  resetMemoryStore();
  clearSyncMetadataStore();
});

describe('drainDirtyWork — create path (unknown record)', () => {
  it('creates a new task, passing the exact accountId, and clears dirty on success', async () => {
    const t = task();
    dirtyMetadata((m) => markDirty(m, 'task', t.id));
    tasksRepo.createTask.mockResolvedValue(ok(cloudTask(t)));

    const result = await drainDirtyWork(ACCOUNT, alwaysCurrent, () => localData({ tasks: [t] }));

    expect(tasksRepo.createTask).toHaveBeenCalledWith(t, ACCOUNT);
    expect(tasksRepo.updateTaskGuarded).not.toHaveBeenCalled();
    expect(result.outcomes).toEqual([{ kind: 'synced' }]);

    const meta = getAccountMetadata(loadSyncMetadataStore(), ACCOUNT);
    expect(meta.dirty.task).toEqual([]);
    expect(meta.records.task[t.id]?.lastKnownUpdatedAt).toBe(cloudTask(t).updatedAt);
  });

  it('creates a new project and a new daily note, each with the exact accountId', async () => {
    const p = project();
    const n = note();
    dirtyMetadata((m) => markDirty(markDirty(m, 'project', p.id), 'dailyNote', n.id));
    projectsRepo.createProject.mockResolvedValue(ok(cloudProject(p)));
    dailyNotesRepo.createDailyNote.mockResolvedValue(ok(cloudNote(n)));

    await drainDirtyWork(ACCOUNT, alwaysCurrent, () => localData({ projects: [p], dailyNotes: [n] }));

    expect(projectsRepo.createProject).toHaveBeenCalledWith(p, ACCOUNT);
    expect(dailyNotesRepo.createDailyNote).toHaveBeenCalledWith(n, ACCOUNT);
  });
});

describe('drainDirtyWork — update path (known record) and full-record push', () => {
  it('uses updateTaskGuarded with the known expectedUpdatedAt and pushes every current field, never createTask', async () => {
    const t = task({ title: 'Renamed', status: 'Today', isPrimary: true, notes: 'a note' });
    dirtyMetadata((m) => markDirty(setRecordUpdatedAt(m, 'task', t.id, 'server-ts-1'), 'task', t.id));
    tasksRepo.updateTaskGuarded.mockResolvedValue(ok(cloudTask(t, { updatedAt: 'server-ts-2' })));

    await drainDirtyWork(ACCOUNT, alwaysCurrent, () => localData({ tasks: [t] }));

    expect(tasksRepo.createTask).not.toHaveBeenCalled();
    expect(tasksRepo.updateTaskGuarded).toHaveBeenCalledWith(
      t.id,
      expect.objectContaining({ title: 'Renamed', status: 'Today', isPrimary: true, notes: 'a note' }),
      'server-ts-1',
      ACCOUNT,
    );
    const meta = getAccountMetadata(loadSyncMetadataStore(), ACCOUNT);
    expect(meta.records.task[t.id]?.lastKnownUpdatedAt).toBe('server-ts-2');
    expect(meta.dirty.task).toEqual([]);
  });

  it('never mistakes a brand-new record for a guarded update requiring a nonexistent cloud version', async () => {
    // No prior setRecordUpdatedAt call at all — this id has never been seen as existing in the cloud.
    const t = task();
    dirtyMetadata((m) => markDirty(m, 'task', t.id));
    tasksRepo.createTask.mockResolvedValue(ok(cloudTask(t)));

    await drainDirtyWork(ACCOUNT, alwaysCurrent, () => localData({ tasks: [t] }));

    expect(tasksRepo.createTask).toHaveBeenCalledTimes(1);
    expect(tasksRepo.updateTaskGuarded).not.toHaveBeenCalled();
  });
});

describe('drainDirtyWork — coalescing rapid edits', () => {
  it('a create followed by rapid local updates before any drain pushes only the final state, once', async () => {
    // Simulates: ADD_TASK then several UPDATE_TASK dispatches, all before a
    // drain ever runs — dirty is a de-duplicated set (already true of
    // markDirty), and drain always reads the *current* local state, so the
    // final converged state is what gets pushed — no per-op replay needed.
    const finalTask = task({ title: 'Final title', status: 'Today', priority: 'High' });
    dirtyMetadata((m) => markDirty(m, 'task', finalTask.id));
    tasksRepo.createTask.mockResolvedValue(ok(cloudTask(finalTask)));

    await drainDirtyWork(ACCOUNT, alwaysCurrent, () => localData({ tasks: [finalTask] }));

    expect(tasksRepo.createTask).toHaveBeenCalledTimes(1);
    expect(tasksRepo.createTask).toHaveBeenCalledWith(finalTask, ACCOUNT);
  });

  it('coalesces repeated updates to an already-known record into one push of the final state', async () => {
    const t = task({ title: 'v3' });
    dirtyMetadata((m) => markDirty(setRecordUpdatedAt(m, 'task', t.id, 'server-ts-1'), 'task', t.id));
    tasksRepo.updateTaskGuarded.mockResolvedValue(ok(cloudTask(t)));

    await drainDirtyWork(ACCOUNT, alwaysCurrent, () => localData({ tasks: [t] }));

    expect(tasksRepo.updateTaskGuarded).toHaveBeenCalledTimes(1);
    expect(tasksRepo.updateTaskGuarded).toHaveBeenCalledWith(
      t.id,
      expect.objectContaining({ title: 'v3' }),
      'server-ts-1',
      ACCOUNT,
    );
  });

  it('an edit landing mid-flight is not lost: dirty stays set and the newer content is pushed on the next pass', async () => {
    const sentVersion = task({ title: 'sent-version' });
    const newerVersion = task({ title: 'newer-version-that-arrived-during-the-network-call' });
    let callCount = 0;
    const getLocalState = () => {
      callCount += 1;
      // First call builds the outgoing payload; every call after (i.e. once
      // the network call resolves) reflects a newer local edit.
      return localData({ tasks: [callCount === 1 ? sentVersion : newerVersion] });
    };

    dirtyMetadata((m) => markDirty(m, 'task', sentVersion.id));
    tasksRepo.createTask.mockResolvedValue(ok(cloudTask(sentVersion, { updatedAt: 'server-ts-1' })));

    const result = await drainDirtyWork(ACCOUNT, alwaysCurrent, getLocalState);

    expect(result.outcomes).toEqual([{ kind: 'synced-superseded' }]);
    const meta = getAccountMetadata(loadSyncMetadataStore(), ACCOUNT);
    // Still dirty — the newer content was never actually sent.
    expect(meta.dirty.task).toEqual([sentVersion.id]);
    // But the baseline is advanced, so the *next* pass can guarded-update from here.
    expect(meta.records.task[sentVersion.id]?.lastKnownUpdatedAt).toBe('server-ts-1');
  });
});

describe('drainDirtyWork — conflict', () => {
  it('leaves the record dirty and does not advance its known updatedAt on conflict', async () => {
    const t = task();
    dirtyMetadata((m) => markDirty(setRecordUpdatedAt(m, 'task', t.id, 'stale-ts'), 'task', t.id));
    tasksRepo.updateTaskGuarded.mockResolvedValue(
      err('conflict', 'This task changed on the server since it was last read on this device.'),
    );

    const result = await drainDirtyWork(ACCOUNT, alwaysCurrent, () => localData({ tasks: [t] }));

    expect(result.outcomes).toEqual([{ kind: 'conflict', message: expect.stringContaining('changed on the server') }]);
    const meta = getAccountMetadata(loadSyncMetadataStore(), ACCOUNT);
    expect(meta.dirty.task).toEqual([t.id]);
    expect(meta.records.task[t.id]?.lastKnownUpdatedAt).toBe('stale-ts');
  });

  it('continues to the next dirty id after a conflict rather than stopping the whole pass', async () => {
    const t1 = task({ id: 't1' });
    const t2 = task({ id: 't2' });
    dirtyMetadata((m) =>
      markDirty(markDirty(setRecordUpdatedAt(m, 'task', t1.id, 'ts1'), 'task', t1.id), 'task', t2.id),
    );
    tasksRepo.updateTaskGuarded.mockResolvedValue(err('conflict', 'conflict'));
    tasksRepo.createTask.mockResolvedValue(ok(cloudTask(t2)));

    const result = await drainDirtyWork(ACCOUNT, alwaysCurrent, () => localData({ tasks: [t1, t2] }));

    expect(result.stoppedEarly).toBe(false);
    expect(tasksRepo.createTask).toHaveBeenCalledWith(t2, ACCOUNT);
    expect(result.outcomes.map((o) => o.kind)).toEqual(['conflict', 'synced']);
  });
});

describe('drainDirtyWork — account-level errors stop the whole pass', () => {
  it.each(['unauthenticated', 'unconfigured', 'account-mismatch'] as const)(
    'stops immediately on a %s error, never attempting the remaining dirty ids',
    async (errorType) => {
      const t1 = task({ id: 't1' });
      const t2 = task({ id: 't2' });
      dirtyMetadata((m) => markDirty(markDirty(m, 'task', t1.id), 'task', t2.id));
      tasksRepo.createTask.mockResolvedValue(err(errorType, 'account problem'));

      const result = await drainDirtyWork(ACCOUNT, alwaysCurrent, () => localData({ tasks: [t1, t2] }));

      expect(tasksRepo.createTask).toHaveBeenCalledTimes(1);
      expect(result.stoppedEarly).toBe(true);
      expect(result.accountError).toEqual({ errorType, message: 'account problem' });

      // Neither task's dirty flag was falsely cleared.
      const meta = getAccountMetadata(loadSyncMetadataStore(), ACCOUNT);
      expect(meta.dirty.task).toEqual(expect.arrayContaining([t1.id, t2.id]));
    },
  );
});

describe('drainDirtyWork — network-level (thrown) failures', () => {
  it('classifies a thrown exception as a network failure, stops the pass, and leaves the record dirty', async () => {
    const t1 = task({ id: 't1' });
    const t2 = task({ id: 't2' });
    dirtyMetadata((m) => markDirty(markDirty(m, 'task', t1.id), 'task', t2.id));
    tasksRepo.createTask.mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await drainDirtyWork(ACCOUNT, alwaysCurrent, () => localData({ tasks: [t1, t2] }));

    expect(result.networkFailure).toBe(true);
    expect(result.stoppedEarly).toBe(true);
    expect(result.outcomes).toEqual([{ kind: 'network-error', message: 'Failed to fetch' }]);
    // Second task never attempted once the network looked down.
    expect(tasksRepo.createTask).toHaveBeenCalledTimes(1);

    const meta = getAccountMetadata(loadSyncMetadataStore(), ACCOUNT);
    expect(meta.dirty.task).toEqual(expect.arrayContaining([t1.id, t2.id]));
  });
});

describe('drainDirtyWork — a record error does not falsely affect unrelated targets', () => {
  it('a database error on one task leaves only that task dirty and still syncs the other', async () => {
    const t1 = task({ id: 't1' });
    const t2 = task({ id: 't2' });
    dirtyMetadata((m) => markDirty(markDirty(m, 'task', t1.id), 'task', t2.id));
    tasksRepo.createTask.mockImplementation(async (t: Task) =>
      t.id === 't1' ? err('database', 'violates check constraint') : ok(cloudTask(t)),
    );

    const result = await drainDirtyWork(ACCOUNT, alwaysCurrent, () => localData({ tasks: [t1, t2] }));

    expect(result.outcomes.map((o) => o.kind)).toEqual(['record-error', 'synced']);
    const meta = getAccountMetadata(loadSyncMetadataStore(), ACCOUNT);
    expect(meta.dirty.task).toEqual(['t1']);
  });
});

describe('drainDirtyWork — duplicate-create resolution (Risk 1)', () => {
  it('a typed duplicate error (not a message match) triggers resolution — createTask returning a generic "database" error, even with duplicate-sounding text, is left as a plain record-error instead', async () => {
    const t = task();
    dirtyMetadata((m) => markDirty(m, 'task', t.id));
    // Old, fragile behavior would have pattern-matched this message; the
    // typed classification must not, since the repository layer itself
    // decides 'duplicate' vs 'database' from the Postgres error code.
    tasksRepo.createTask.mockResolvedValue(err('database', 'duplicate key value violates unique constraint'));

    const result = await drainDirtyWork(ACCOUNT, alwaysCurrent, () => localData({ tasks: [t] }));

    expect(result.outcomes).toEqual([{ kind: 'record-error', message: expect.any(String) }]);
    expect(tasksRepo.listTasks).not.toHaveBeenCalled();
    const meta = getAccountMetadata(loadSyncMetadataStore(), ACCOUNT);
    expect(meta.dirty.task).toEqual([t.id]);
  });

  it('lost-success retry: identical cloud/local content is recognized as synced and clears dirty, adopting the real cloud updatedAt', async () => {
    const t = task({ title: 'Buy milk', notes: 'skim' });
    dirtyMetadata((m) => markDirty(m, 'task', t.id));
    tasksRepo.createTask.mockResolvedValue(err('duplicate', 'duplicate key value violates unique constraint "tasks_pkey"'));
    // The cloud row already holds exactly what this device wanted to write —
    // the earlier create actually succeeded, only its response was lost.
    tasksRepo.listTasks.mockResolvedValue(ok([cloudTask(t, { updatedAt: 'cloud-ts' })]));

    const result = await drainDirtyWork(ACCOUNT, alwaysCurrent, () => localData({ tasks: [t] }));

    expect(result.outcomes).toEqual([{ kind: 'synced' }]);
    const meta = getAccountMetadata(loadSyncMetadataStore(), ACCOUNT);
    expect(meta.dirty.task).toEqual([]);
    expect(meta.records.task[t.id]?.lastKnownUpdatedAt).toBe('cloud-ts');
  });

  it('duplicate with different content: stays dirty, reports a conflict, and never adopts the cloud updatedAt as license for a future guarded overwrite', async () => {
    const local = task({ title: 'My local title' });
    const cloud = cloudTask(task({ title: 'Someone else already wrote this' }), { updatedAt: 'cloud-ts' });
    dirtyMetadata((m) => markDirty(m, 'task', local.id));
    tasksRepo.createTask.mockResolvedValue(err('duplicate', 'duplicate key value violates unique constraint "tasks_pkey"'));
    tasksRepo.listTasks.mockResolvedValue(ok([cloud]));

    const result = await drainDirtyWork(ACCOUNT, alwaysCurrent, () => localData({ tasks: [local] }));

    expect(result.outcomes).toEqual([{ kind: 'conflict', message: expect.stringContaining('different content') }]);
    const meta = getAccountMetadata(loadSyncMetadataStore(), ACCOUNT);
    // Still dirty — never silently discarded or treated as synced.
    expect(meta.dirty.task).toEqual([local.id]);
    // Crucially, the cloud timestamp was NOT adopted: a later pass must not
    // be able to take the "known updatedAt" guarded-update path against a
    // baseline that was only ever discovered, never confirmed as this
    // device's own prior write.
    expect(meta.records.task[local.id]).toBeUndefined();
  });

  it('a duplicate whose existing row cannot be confirmed (list fails or omits it) stays dirty and reports a record-error, guessing neither way', async () => {
    const t = task();
    dirtyMetadata((m) => markDirty(m, 'task', t.id));
    tasksRepo.createTask.mockResolvedValue(err('duplicate', 'duplicate key value violates unique constraint "tasks_pkey"'));
    tasksRepo.listTasks.mockResolvedValue(ok([])); // existing row not found in this read

    const result = await drainDirtyWork(ACCOUNT, alwaysCurrent, () => localData({ tasks: [t] }));

    expect(result.outcomes).toEqual([{ kind: 'record-error', message: expect.any(String) }]);
    const meta = getAccountMetadata(loadSyncMetadataStore(), ACCOUNT);
    expect(meta.dirty.task).toEqual([t.id]);
    expect(meta.records.task[t.id]).toBeUndefined();
  });

  it('applies the same identical-content-safe / different-content-conflict resolution for projects and daily notes', async () => {
    const p = project({ name: 'Home' });
    dirtyMetadata((m) => markDirty(m, 'project', p.id));
    projectsRepo.createProject.mockResolvedValue(err('duplicate', 'duplicate key'));
    projectsRepo.listProjects.mockResolvedValue(ok([cloudProject(p, { updatedAt: 'p-ts' })]));

    const projectResult = await drainDirtyWork(ACCOUNT, alwaysCurrent, () => localData({ projects: [p] }));
    expect(projectResult.outcomes).toEqual([{ kind: 'synced' }]);

    const n = note({ morning: 'Plan' });
    dirtyMetadata((m) => markDirty(m, 'dailyNote', n.id));
    dailyNotesRepo.createDailyNote.mockResolvedValue(err('duplicate', 'duplicate key'));
    dailyNotesRepo.listDailyNotes.mockResolvedValue(
      ok([cloudNote({ ...n, morning: 'Different content' }, { updatedAt: 'n-ts' })]),
    );

    const noteResult = await drainDirtyWork(ACCOUNT, alwaysCurrent, () => localData({ dailyNotes: [n] }));
    expect(noteResult.outcomes).toEqual([{ kind: 'conflict', message: expect.stringContaining('different content') }]);
  });
});

describe('drainDirtyWork — missing local record', () => {
  it('clears a dirty id with no corresponding local record instead of erroring or looping forever', async () => {
    dirtyMetadata((m) => markDirty(m, 'task', 'ghost-id'));

    const result = await drainDirtyWork(ACCOUNT, alwaysCurrent, () => localData());

    expect(result.outcomes).toEqual([{ kind: 'skipped-missing' }]);
    expect(tasksRepo.createTask).not.toHaveBeenCalled();
    expect(tasksRepo.updateTaskGuarded).not.toHaveBeenCalled();
    const meta = getAccountMetadata(loadSyncMetadataStore(), ACCOUNT);
    expect(meta.dirty.task).toEqual([]);
  });
});

describe('drainDirtyWork — generation check between operations', () => {
  it('stops before starting the next id once the generation is no longer current', async () => {
    const t1 = task({ id: 't1' });
    const t2 = task({ id: 't2' });
    dirtyMetadata((m) => markDirty(markDirty(m, 'task', t1.id), 'task', t2.id));
    tasksRepo.createTask.mockResolvedValue(ok(cloudTask(t1)));

    let calls = 0;
    const isGenerationCurrent = () => {
      calls += 1;
      return calls <= 1; // current for the first check, stale afterward
    };

    const result = await drainDirtyWork(ACCOUNT, isGenerationCurrent, () => localData({ tasks: [t1, t2] }));

    expect(result.stoppedEarly).toBe(true);
    expect(tasksRepo.createTask).toHaveBeenCalledTimes(1);
  });
});

describe('drainDirtyWork — durability across a simulated reload', () => {
  it('a dirty mark and its later clearing both survive re-loading the store fresh', async () => {
    const t = task();
    dirtyMetadata((m) => markDirty(m, 'task', t.id));

    // Simulate "reload": read fresh from the same underlying storage, as a
    // brand-new call site would after a browser refresh.
    const reloaded = getAccountMetadata(loadSyncMetadataStore(), ACCOUNT);
    expect(reloaded.dirty.task).toEqual([t.id]);

    tasksRepo.createTask.mockResolvedValue(ok(cloudTask(t)));
    await drainDirtyWork(ACCOUNT, alwaysCurrent, () => localData({ tasks: [t] }));

    const afterSync = getAccountMetadata(loadSyncMetadataStore(), ACCOUNT);
    expect(afterSync.dirty.task).toEqual([]);
  });
});

describe('drainDirtyWork — ordering', () => {
  it('processes projects before tasks before daily notes', async () => {
    const callOrder: string[] = [];
    const p = project();
    const t = task();
    const n = note();
    dirtyMetadata((m) =>
      markDirty(markDirty(markDirty(m, 'dailyNote', n.id), 'task', t.id), 'project', p.id),
    );
    projectsRepo.createProject.mockImplementation(async (proj: Project) => {
      callOrder.push('project');
      return ok(cloudProject(proj));
    });
    tasksRepo.createTask.mockImplementation(async (task_: Task) => {
      callOrder.push('task');
      return ok(cloudTask(task_));
    });
    dailyNotesRepo.createDailyNote.mockImplementation(async (note_: DailyNote) => {
      callOrder.push('dailyNote');
      return ok(cloudNote(note_));
    });

    await drainDirtyWork(ACCOUNT, alwaysCurrent, () => localData({ projects: [p], tasks: [t], dailyNotes: [n] }));

    expect(callOrder).toEqual(['project', 'task', 'dailyNote']);
  });
});
