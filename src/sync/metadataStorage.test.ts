import { describe, expect, it, beforeEach } from 'vitest';
import { getStorage, resetMemoryStore } from '../storage/storage';
import { STORAGE_KEY } from '../types';
import {
  createEmptyAccountMetadata,
  createEmptySyncMetadataStore,
  getAccountMetadata,
  markEstablished,
  upsertAccountMetadata,
} from './metadata';
import {
  clearSyncMetadataStore,
  loadSyncMetadataStore,
  saveSyncMetadataStore,
  SYNC_METADATA_STORAGE_KEY,
} from './metadataStorage';

describe('sync metadata storage', () => {
  beforeEach(() => {
    resetMemoryStore();
  });

  it('returns an empty store when nothing has been saved yet', () => {
    expect(loadSyncMetadataStore()).toEqual(createEmptySyncMetadataStore());
  });

  it('round-trips a saved store', () => {
    let store = createEmptySyncMetadataStore();
    store = upsertAccountMetadata(store, markEstablished(createEmptyAccountMetadata('acct-1')));

    saveSyncMetadataStore(store);

    expect(loadSyncMetadataStore()).toEqual(store);
  });

  it('never mixes markers between two different accounts on the same device', () => {
    let store = createEmptySyncMetadataStore();
    store = upsertAccountMetadata(store, markEstablished(createEmptyAccountMetadata('acct-a')));
    saveSyncMetadataStore(store);

    // Simulate signing into a second, previously-unseen account on this device.
    const loaded = loadSyncMetadataStore();
    expect(getAccountMetadata(loaded, 'acct-a').established).toBe(true);
    expect(getAccountMetadata(loaded, 'acct-b').established).toBe(false);
    expect(getAccountMetadata(loaded, 'acct-b').dirty.task).toEqual([]);
  });

  it('returns an empty store, not a throw, for corrupted stored JSON', () => {
    getStorage().setItem(SYNC_METADATA_STORAGE_KEY, '{not json');
    expect(loadSyncMetadataStore()).toEqual(createEmptySyncMetadataStore());
  });

  it('is stored under its own key, independent of AppData', () => {
    expect(SYNC_METADATA_STORAGE_KEY).not.toBe(STORAGE_KEY);
  });

  it('is not touched when AppData is saved under its own key', () => {
    getStorage().setItem(STORAGE_KEY, JSON.stringify({ version: 1, tasks: [], projects: [], dailyNotes: [] }));
    expect(loadSyncMetadataStore()).toEqual(createEmptySyncMetadataStore());
  });

  it('clearSyncMetadataStore removes only the sync metadata key', () => {
    let store = createEmptySyncMetadataStore();
    store = upsertAccountMetadata(store, createEmptyAccountMetadata('acct-1'));
    saveSyncMetadataStore(store);
    const appDataJson = JSON.stringify({ version: 1, tasks: [], projects: [], dailyNotes: [] });
    getStorage().setItem(STORAGE_KEY, appDataJson);

    clearSyncMetadataStore();

    expect(loadSyncMetadataStore()).toEqual(createEmptySyncMetadataStore());
    expect(getStorage().getItem(STORAGE_KEY)).toBe(appDataJson);
  });
});
