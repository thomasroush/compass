import { getStorage } from '../storage/storage';
import { loadSyncMetadataFromString } from './metadataValidation';
import type { SyncMetadataStore } from './metadata';

/**
 * Deliberately separate from AppData's STORAGE_KEY ('daily-compass-v1') so
 * sync metadata is never touched by loadAppData/saveAppData, and never
 * appears in an Export JSON file or gets replaced by an Import.
 */
export const SYNC_METADATA_STORAGE_KEY = 'daily-compass-sync-v1';

export function loadSyncMetadataStore(): SyncMetadataStore {
  const storage = getStorage();
  const raw = storage.getItem(SYNC_METADATA_STORAGE_KEY);
  return loadSyncMetadataFromString(raw);
}

export function saveSyncMetadataStore(store: SyncMetadataStore): void {
  const storage = getStorage();
  storage.setItem(SYNC_METADATA_STORAGE_KEY, JSON.stringify(store));
}

export function clearSyncMetadataStore(): void {
  const storage = getStorage();
  storage.removeItem(SYNC_METADATA_STORAGE_KEY);
}
