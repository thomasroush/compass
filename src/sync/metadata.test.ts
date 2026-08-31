import { describe, expect, it } from 'vitest';
import {
  clearDirty,
  createEmptyAccountMetadata,
  createEmptySyncMetadataStore,
  getAccountMetadata,
  getRecordUpdatedAt,
  isDirty,
  markDirty,
  markEstablished,
  setLastSyncedAt,
  setRecordUpdatedAt,
  upsertAccountMetadata,
} from './metadata';

describe('createEmptyAccountMetadata', () => {
  it('starts unestablished, unsynced, with no records or dirty ids', () => {
    expect(createEmptyAccountMetadata('acct-1')).toEqual({
      accountId: 'acct-1',
      established: false,
      lastSyncedAt: null,
      records: { project: {}, task: {}, dailyNote: {} },
      dirty: { project: [], task: [], dailyNote: [] },
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
});
