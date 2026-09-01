import { describe, expect, it } from 'vitest';
import type { AppAction } from '../store/reducer';
import { createEmptyAppData, type AppData } from '../types';
import { classifyActionProvenance, resolveDirtyTargets } from './actionProvenance';

const USER_EDIT_ACTIONS: AppAction[] = [
  { type: 'ADD_TASK', id: 't1', title: 'Buy milk' },
  { type: 'UPDATE_TASK', id: 't1', updates: { title: 'X' } },
  { type: 'COMPLETE_TASK', id: 't1' },
  { type: 'UNCOMPLETE_TASK', id: 't1' },
  { type: 'ARCHIVE_TASK', id: 't1' },
  { type: 'SET_PRIMARY', id: 't1', isPrimary: true },
  { type: 'POSTPONE_DUE', id: 't1' },
  { type: 'POSTPONE_TO_WEEK', id: 't1' },
  { type: 'REORDER_TASK', id: 't1', direction: 'up' },
  { type: 'ADD_PROJECT', id: 'p1', name: 'Home' },
  { type: 'UPDATE_PROJECT', id: 'p1', name: 'X' },
  { type: 'UPSERT_DAILY_NOTE', id: 'n1', date: '2026-09-01', morning: 'Plan' },
];

const SYNC_BOUNDARY_ACTIONS: AppAction[] = [
  { type: 'LOAD', data: createEmptyAppData() },
  { type: 'IMPORT', data: createEmptyAppData() },
  { type: 'RESET' },
  { type: 'APPLY_REMOTE_UPDATE', data: createEmptyAppData() },
];

describe('classifyActionProvenance', () => {
  it.each(USER_EDIT_ACTIONS)('classifies $type as user-edit', (action) => {
    expect(classifyActionProvenance(action)).toBe('user-edit');
  });

  it.each(SYNC_BOUNDARY_ACTIONS)('classifies $type as sync-boundary', (action) => {
    expect(classifyActionProvenance(action)).toBe('sync-boundary');
  });

  it('covers every current AppAction type exactly once between the two lists', () => {
    const covered = [...USER_EDIT_ACTIONS, ...SYNC_BOUNDARY_ACTIONS].map((a) => a.type);
    expect(new Set(covered).size).toBe(covered.length);
    // 12 user-edit + 4 sync-boundary = 16 AppAction variants as of this task.
    expect(covered).toHaveLength(16);
  });
});

describe('resolveDirtyTargets — dirty marking', () => {
  it('marks the newly created task under the id the caller supplied', () => {
    const prev = createEmptyAppData();
    const targets = resolveDirtyTargets({ type: 'ADD_TASK', id: 'new-task', title: 'Buy milk' }, prev);
    expect(targets).toEqual([{ entity: 'task', id: 'new-task' }]);
  });

  it('marks the newly created project under the id the caller supplied', () => {
    const prev = createEmptyAppData();
    const targets = resolveDirtyTargets({ type: 'ADD_PROJECT', id: 'new-project', name: 'Home' }, prev);
    expect(targets).toEqual([{ entity: 'project', id: 'new-project' }]);
  });

  it('marks an existing task dirty by the id UPDATE_TASK/COMPLETE_TASK/etc. already carry', () => {
    const prev: AppData = { ...createEmptyAppData(), tasks: [taskFixture('t1')] };
    expect(resolveDirtyTargets({ type: 'UPDATE_TASK', id: 't1', updates: {} }, prev)).toEqual([
      { entity: 'task', id: 't1' },
    ]);
    expect(resolveDirtyTargets({ type: 'COMPLETE_TASK', id: 't1' }, prev)).toEqual([
      { entity: 'task', id: 't1' },
    ]);
    expect(resolveDirtyTargets({ type: 'ARCHIVE_TASK', id: 't1' }, prev)).toEqual([
      { entity: 'task', id: 't1' },
    ]);
  });

  it('marks an existing project dirty by its id', () => {
    const prev: AppData = { ...createEmptyAppData(), projects: [{ id: 'p1', name: 'Home', status: 'active' }] };
    expect(resolveDirtyTargets({ type: 'UPDATE_PROJECT', id: 'p1', name: 'Renamed' }, prev)).toEqual([
      { entity: 'project', id: 'p1' },
    ]);
  });

  it('marks the existing daily note by its own id when the date already has a note, ignoring any id on the action', () => {
    const prev: AppData = {
      ...createEmptyAppData(),
      dailyNotes: [{ id: 'existing-note', date: '2026-09-01', morning: 'Plan', evening: '' }],
    };
    const targets = resolveDirtyTargets(
      { type: 'UPSERT_DAILY_NOTE', id: 'ignored-id', date: '2026-09-01', evening: 'Review' },
      prev,
    );
    expect(targets).toEqual([{ entity: 'dailyNote', id: 'existing-note' }]);
  });

  it('marks a newly created daily note under the id the caller supplied', () => {
    const prev = createEmptyAppData();
    const targets = resolveDirtyTargets(
      { type: 'UPSERT_DAILY_NOTE', id: 'new-note', date: '2026-09-01', morning: 'Plan' },
      prev,
    );
    expect(targets).toEqual([{ entity: 'dailyNote', id: 'new-note' }]);
  });
});

describe('resolveDirtyTargets — cascading changes', () => {
  it('marks both sides of an adjacent reorder dirty', () => {
    const t1 = taskFixture('t1', { status: 'Inbox', sortOrder: 0 });
    const t2 = taskFixture('t2', { status: 'Inbox', sortOrder: 1 });
    const prev: AppData = { ...createEmptyAppData(), tasks: [t1, t2] };

    const targets = resolveDirtyTargets({ type: 'REORDER_TASK', id: 't2', direction: 'up' }, prev);

    expect(targets).toEqual([
      { entity: 'task', id: 't2' },
      { entity: 'task', id: 't1' },
    ]);
  });

  it('marks the correct column-adjacent partner for a reorder, even when other-status tasks sit between them in raw array order', () => {
    // Physical array order interleaves an unrelated status between the two
    // tasks that are actually adjacent within the 'Today' column by sortOrder.
    const a = taskFixture('a', { status: 'Today', sortOrder: 0 });
    const x = taskFixture('x', { status: 'Inbox', sortOrder: 0 });
    const b = taskFixture('b', { status: 'Today', sortOrder: 1 });
    const y = taskFixture('y', { status: 'Inbox', sortOrder: 1 });
    const c = taskFixture('c', { status: 'Today', sortOrder: 2 });
    const prev: AppData = { ...createEmptyAppData(), tasks: [a, x, b, y, c] };

    const targets = resolveDirtyTargets({ type: 'REORDER_TASK', id: 'b', direction: 'up' }, prev);

    expect(targets).toEqual([
      { entity: 'task', id: 'b' },
      { entity: 'task', id: 'a' },
    ]);
  });

  it('excludes a reorder at the boundary of its column (no partner to swap with)', () => {
    const a = taskFixture('a', { status: 'Today', sortOrder: 0 });
    const b = taskFixture('b', { status: 'Today', sortOrder: 1 });
    const prev: AppData = { ...createEmptyAppData(), tasks: [a, b] };

    expect(resolveDirtyTargets({ type: 'REORDER_TASK', id: 'a', direction: 'up' }, prev)).toEqual([]);
    expect(resolveDirtyTargets({ type: 'REORDER_TASK', id: 'b', direction: 'down' }, prev)).toEqual([]);
  });

  it('marks a newly selected primary task (SET_PRIMARY, no demotion needed)', () => {
    const t1 = taskFixture('t1', { status: 'Today', isPrimary: false });
    const prev: AppData = { ...createEmptyAppData(), tasks: [t1] };

    const targets = resolveDirtyTargets({ type: 'SET_PRIMARY', id: 't1', isPrimary: true }, prev);

    expect(targets).toEqual([{ entity: 'task', id: 't1' }]);
  });

  it('marks a task automatically demoted by enforcePrimaryCap when SET_PRIMARY promotes a fourth task', () => {
    // Three existing Today-primary tasks, ascending sortOrder. A fourth task
    // (not currently Today) has a *lower* sortOrder, so once promoted it
    // sorts ahead of the three existing ones, and the highest-sortOrder
    // existing primary ('c') is the one enforcePrimaryCap demotes.
    const a = taskFixture('a', { status: 'Today', isPrimary: true, sortOrder: 1 });
    const b = taskFixture('b', { status: 'Today', isPrimary: true, sortOrder: 2 });
    const c = taskFixture('c', { status: 'Today', isPrimary: true, sortOrder: 3 });
    const d = taskFixture('d', { status: 'Inbox', isPrimary: false, sortOrder: 0 });
    const prev: AppData = { ...createEmptyAppData(), tasks: [a, b, c, d] };

    const targets = resolveDirtyTargets({ type: 'SET_PRIMARY', id: 'd', isPrimary: true }, prev);

    // Exactly the promoted task and the demoted one — not 'a' or 'b', which
    // are unaffected by the cap.
    expect(targets).toEqual([
      { entity: 'task', id: 'd' },
      { entity: 'task', id: 'c' },
    ]);
  });

  it('marks a task automatically demoted by enforcePrimaryCap when a direct UPDATE_TASK promotes a fourth task', () => {
    const a = taskFixture('a', { status: 'Today', isPrimary: true, sortOrder: 1 });
    const b = taskFixture('b', { status: 'Today', isPrimary: true, sortOrder: 2 });
    const c = taskFixture('c', { status: 'Today', isPrimary: true, sortOrder: 3 });
    const d = taskFixture('d', { status: 'Inbox', isPrimary: false, sortOrder: 0 });
    const prev: AppData = { ...createEmptyAppData(), tasks: [a, b, c, d] };

    const targets = resolveDirtyTargets(
      { type: 'UPDATE_TASK', id: 'd', updates: { status: 'Today', isPrimary: true } },
      prev,
    );

    expect(targets).toEqual([
      { entity: 'task', id: 'd' },
      { entity: 'task', id: 'c' },
    ]);
  });

  it('does not mark anything extra when promoting a task does not exceed the primary cap', () => {
    const a = taskFixture('a', { status: 'Today', isPrimary: true, sortOrder: 1 });
    const d = taskFixture('d', { status: 'Inbox', isPrimary: false, sortOrder: 0 });
    const prev: AppData = { ...createEmptyAppData(), tasks: [a, d] };

    const targets = resolveDirtyTargets({ type: 'SET_PRIMARY', id: 'd', isPrimary: true }, prev);

    expect(targets).toEqual([{ entity: 'task', id: 'd' }]);
  });

  it('excludes SET_PRIMARY on an already-at-cap Today task (the reducer itself refuses it)', () => {
    const a = taskFixture('a', { status: 'Today', isPrimary: true, sortOrder: 1 });
    const b = taskFixture('b', { status: 'Today', isPrimary: true, sortOrder: 2 });
    const c = taskFixture('c', { status: 'Today', isPrimary: true, sortOrder: 3 });
    const d = taskFixture('d', { status: 'Today', isPrimary: false, sortOrder: 4 });
    const prev: AppData = { ...createEmptyAppData(), tasks: [a, b, c, d] };

    expect(resolveDirtyTargets({ type: 'SET_PRIMARY', id: 'd', isPrimary: true }, prev)).toEqual([]);
  });

  it('excludes SET_PRIMARY on an archived task, matching the reducer', () => {
    const t1 = taskFixture('t1', { archived: true });
    const prev: AppData = { ...createEmptyAppData(), tasks: [t1] };
    expect(resolveDirtyTargets({ type: 'SET_PRIMARY', id: 't1', isPrimary: true }, prev)).toEqual([]);
  });

  it('never marks a different task dirty for actions that can only remove Today-primary status', () => {
    const a = taskFixture('a', { status: 'Today', isPrimary: true, sortOrder: 1 });
    const b = taskFixture('b', { status: 'Today', isPrimary: true, sortOrder: 2 });
    const prev: AppData = { ...createEmptyAppData(), tasks: [a, b] };

    expect(resolveDirtyTargets({ type: 'COMPLETE_TASK', id: 'a' }, prev)).toEqual([{ entity: 'task', id: 'a' }]);
    expect(resolveDirtyTargets({ type: 'ARCHIVE_TASK', id: 'a' }, prev)).toEqual([{ entity: 'task', id: 'a' }]);
    expect(
      resolveDirtyTargets({ type: 'UPDATE_TASK', id: 'a', updates: { status: 'Done' } }, prev),
    ).toEqual([{ entity: 'task', id: 'a' }]);
  });
});

describe('resolveDirtyTargets — exclusion rules', () => {
  it('excludes a blank-title ADD_TASK (the reducer refuses to create a record)', () => {
    const targets = resolveDirtyTargets({ type: 'ADD_TASK', id: 'x', title: '   ' }, createEmptyAppData());
    expect(targets).toEqual([]);
  });

  it('excludes a blank-name ADD_PROJECT', () => {
    const targets = resolveDirtyTargets({ type: 'ADD_PROJECT', id: 'x', name: '' }, createEmptyAppData());
    expect(targets).toEqual([]);
  });

  it('excludes a blank/whitespace-only UPSERT_DAILY_NOTE for a date with no existing note', () => {
    const targets = resolveDirtyTargets(
      { type: 'UPSERT_DAILY_NOTE', id: 'x', date: '2026-09-01', morning: '  ', evening: '\n' },
      createEmptyAppData(),
    );
    expect(targets).toEqual([]);
  });

  it('excludes an id-targeting action whose id does not exist in prevState', () => {
    const prev = createEmptyAppData();
    expect(resolveDirtyTargets({ type: 'UPDATE_TASK', id: 'missing', updates: {} }, prev)).toEqual([]);
    expect(resolveDirtyTargets({ type: 'ARCHIVE_TASK', id: 'missing' }, prev)).toEqual([]);
    expect(resolveDirtyTargets({ type: 'UPDATE_PROJECT', id: 'missing' }, prev)).toEqual([]);
  });

  it('never marks anything dirty for a sync-boundary action, regardless of its payload', () => {
    const populated: AppData = { ...createEmptyAppData(), tasks: [taskFixture('t1')] };
    expect(resolveDirtyTargets({ type: 'LOAD', data: populated }, createEmptyAppData())).toEqual([]);
    expect(resolveDirtyTargets({ type: 'IMPORT', data: populated }, createEmptyAppData())).toEqual([]);
    expect(resolveDirtyTargets({ type: 'RESET' }, populated)).toEqual([]);
    expect(resolveDirtyTargets({ type: 'APPLY_REMOTE_UPDATE', data: populated }, createEmptyAppData())).toEqual(
      [],
    );
  });
});

function taskFixture(
  id: string,
  overrides: Partial<{
    status: AppData['tasks'][number]['status'];
    sortOrder: number;
    isPrimary: boolean;
    archived: boolean;
  }> = {},
) {
  return {
    id,
    title: 'Task',
    status: 'Inbox' as const,
    priority: 'Normal' as const,
    createdAt: '2026-09-01T00:00:00.000Z',
    sortOrder: 0,
    isPrimary: false,
    archived: false,
    ...overrides,
  };
}
