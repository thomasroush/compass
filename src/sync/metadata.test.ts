import { describe, expect, it } from 'vitest';
import {
  clearAllDirty,
  clearDirty,
  countDirty,
  createEmptyAccountMetadata,
  createEmptySyncMetadataStore,
  forgetRecord,
  getAccountMetadata,
  getRecordUpdatedAt,
  hasDirtyWork,
  isDirty,
  markDirty,
  markEstablished,
  setLastSyncedAt,
  setRecordUpdatedAt,
  SYNC_ENTITIES,
  upsertAccountMetadata,
} from './metadata';

describe('SYNC_ENTITIES', () => {
  it('includes goal and target alongside the original three entities', () => {
    expect(SYNC_ENTITIES).toEqual(['project', 'task', 'quickNote', 'goal', 'target']);
  });
});

describe('createEmptyAccountMetadata', () => {
  it('starts unestablished, unsynced, with no records or dirty ids', () => {
    expect(createEmptyAccountMetadata('acct-1')).toEqual({
      accountId: 'acct-1',
      established: false,
      lastSyncedAt: null,
      records: { project: {}, task: {}, quickNote: {}, goal: {}, target: {} },
      dirty: { project: [], task: [], quickNote: [], goal: [], target: [] },
    });
  });
});

describe('getAccountMetadata / upsertAccountMetadata', () => {
  it('returns a fresh empty record for an account the store has never seen', () => {
    const store = createEmptySyncMetadataStore();
    expect(getAccountMetadata(store, 'acct-1')).toEqual(createEmptyAccountMetadata('acct-1'));
  });

  it('round-trips a stored account without touching other accounts (account isolation)', () => {
    let store = createEmptySyncMetadataStore();
    store = upsertAccountMetadata(store, markEstablished(createEmptyAccountMetadata('acct-1')));
    store = upsertAccountMetadata(store, createEmptyAccountMetadata('acct-2'));

    expect(getAccountMetadata(store, 'acct-1').established).toBe(true);
    expect(getAccountMetadata(store, 'acct-2').established).toBe(false);
  });

  it('never mutates the original store object (pure update)', () => {
    const store = createEmptySyncMetadataStore();
    const next = upsertAccountMetadata(store, createEmptyAccountMetadata('acct-1'));
    expect(store.accounts).toEqual({});
    expect(next.accounts['acct-1']).toBeDefined();
  });
});

describe('record and dirty helpers', () => {
  it('sets and reads a per-record last-known updated_at, scoped by entity', () => {
    let metadata = createEmptyAccountMetadata('acct-1');
    metadata = setRecordUpdatedAt(metadata, 'task', 't1', '2026-08-31T00:00:00.000Z');

    expect(getRecordUpdatedAt(metadata, 'task', 't1')).toBe('2026-08-31T00:00:00.000Z');
    expect(getRecordUpdatedAt(metadata, 'task', 't2')).toBeUndefined();
    expect(getRecordUpdatedAt(metadata, 'project', 't1')).toBeUndefined();
  });

  it('marks and clears dirty ids without duplicating entries', () => {
    let metadata = createEmptyAccountMetadata('acct-1');
    metadata = markDirty(metadata, 'task', 't1');
    metadata = markDirty(metadata, 'task', 't1');

    expect(metadata.dirty.task).toEqual(['t1']);
    expect(isDirty(metadata, 'task', 't1')).toBe(true);
    expect(isDirty(metadata, 'project', 't1')).toBe(false);

    metadata = clearDirty(metadata, 'task', 't1');
    expect(metadata.dirty.task).toEqual([]);
    expect(isDirty(metadata, 'task', 't1')).toBe(false);
  });

  it('records the last successful sync time', () => {
    let metadata = createEmptyAccountMetadata('acct-1');
    metadata = setLastSyncedAt(metadata, '2026-08-31T12:00:00.000Z');
    expect(metadata.lastSyncedAt).toBe('2026-08-31T12:00:00.000Z');
  });

  it('clearAllDirty empties every entity at once (RESET/IMPORT)', () => {
    let metadata = createEmptyAccountMetadata('acct-1');
    metadata = markDirty(metadata, 'task', 't1');
    metadata = markDirty(metadata, 'project', 'p1');
    metadata = markDirty(metadata, 'quickNote', 'n1');
    metadata = markDirty(metadata, 'goal', 'g1');
    metadata = markDirty(metadata, 'target', 'tg1');

    metadata = clearAllDirty(metadata);

    expect(metadata.dirty).toEqual({ project: [], task: [], quickNote: [], goal: [], target: [] });
  });

  it('forgetRecord removes both the baseline and the dirty marker for a removed shared record', () => {
    let metadata = createEmptyAccountMetadata('acct-1');
    metadata = setRecordUpdatedAt(metadata, 'project', 'p1', '2026-09-16T00:00:00.000Z');
    metadata = markDirty(metadata, 'project', 'p1');

    metadata = forgetRecord(metadata, 'project', 'p1');

    expect(getRecordUpdatedAt(metadata, 'project', 'p1')).toBeUndefined();
    expect(isDirty(metadata, 'project', 'p1')).toBe(false);
    expect(metadata.records.project).not.toHaveProperty('p1');
  });

  it('forgetRecord on a record with only a baseline (never dirty) still removes the baseline', () => {
    let metadata = createEmptyAccountMetadata('acct-1');
    metadata = setRecordUpdatedAt(metadata, 'task', 't1', 'ts');

    metadata = forgetRecord(metadata, 'task', 't1');

    expect(getRecordUpdatedAt(metadata, 'task', 't1')).toBeUndefined();
  });

  it('forgetRecord leaves every other record and entity untouched', () => {
    let metadata = createEmptyAccountMetadata('acct-1');
    metadata = setRecordUpdatedAt(metadata, 'task', 't1', 'ts1');
    metadata = setRecordUpdatedAt(metadata, 'task', 't2', 'ts2');
    metadata = markDirty(metadata, 'task', 't2');
    metadata = setRecordUpdatedAt(metadata, 'project', 'p1', 'ts3');

    metadata = forgetRecord(metadata, 'task', 't1');

    expect(getRecordUpdatedAt(metadata, 'task', 't2')).toBe('ts2');
    expect(isDirty(metadata, 'task', 't2')).toBe(true);
    expect(getRecordUpdatedAt(metadata, 'project', 'p1')).toBe('ts3');
  });

  it('forgetRecord is a safe no-op for an id with no baseline and no dirty marker', () => {
    const metadata = createEmptyAccountMetadata('acct-1');
    expect(forgetRecord(metadata, 'task', 'never-existed')).toEqual(metadata);
  });

  it('hasDirtyWork/countDirty reflect the total across all entities', () => {
    let metadata = createEmptyAccountMetadata('acct-1');
    expect(hasDirtyWork(metadata)).toBe(false);
    expect(countDirty(metadata)).toBe(0);

    metadata = markDirty(metadata, 'task', 't1');
    metadata = markDirty(metadata, 'project', 'p1');

    expect(hasDirtyWork(metadata)).toBe(true);
    expect(countDirty(metadata)).toBe(2);
  });
});
