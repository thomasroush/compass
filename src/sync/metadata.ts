/**
 * Device-local synchronization metadata — bookkeeping this device keeps
 * about what it has already synchronized with a signed-in Supabase account.
 *
 * This is entirely separate from `AppData` (src/types.ts): it holds no
 * task/project/note content, only per-record server timestamps and sync
 * state, lives under its own storage key (see metadataStorage.ts), and is
 * never included in Export/Import or validated as part of AppData.
 *
 * Scoped by authenticated account id (`auth.uid()`) so that signing into a
 * different account on the same device never reads or reuses another
 * account's markers (see getAccountMetadata below).
 */

export const SYNC_ENTITIES = ['project', 'task', 'dailyNote'] as const;
export type SyncEntity = (typeof SYNC_ENTITIES)[number];

export interface EntitySyncRecord {
  /** The server-generated `updated_at` this device last observed for this record. */
  lastKnownUpdatedAt: string;
}

export interface AccountSyncMetadata {
  accountId: string;
  /**
   * True once this device has completed an explicit hydration/link decision
   * for this account (see src/sync/hydration.ts). Until then, a device with
   * both local and cloud data must not guess how to reconcile them.
   */
  established: boolean;
  /** ISO timestamp of the last successful full sync pass, or null if this device has never completed one. */
  lastSyncedAt: string | null;
  /** Per-entity-type map of stable record id -> last known server state. */
  records: Record<SyncEntity, Record<string, EntitySyncRecord>>;
  /** Per-entity-type list of record ids with local edits not yet confirmed pushed to the cloud. */
  dirty: Record<SyncEntity, string[]>;
}

export interface SyncMetadataStore {
  version: 1;
  /** Keyed by accountId. Never read across accounts. */
  accounts: Record<string, AccountSyncMetadata>;
}

export function createEmptySyncMetadataStore(): SyncMetadataStore {
  return { version: 1, accounts: {} };
}

export function createEmptyAccountMetadata(accountId: string): AccountSyncMetadata {
  return {
    accountId,
    established: false,
    lastSyncedAt: null,
    records: { project: {}, task: {}, dailyNote: {} },
    dirty: { project: [], task: [], dailyNote: [] },
  };
}

/**
 * Returns this account's metadata, or a fresh empty one if this device has
 * none yet. Never returns another account's data — this is the one function
 * that should be used to read metadata for "the currently signed-in
 * account", so account isolation lives in one place.
 */
export function getAccountMetadata(store: SyncMetadataStore, accountId: string): AccountSyncMetadata {
  return store.accounts[accountId] ?? createEmptyAccountMetadata(accountId);
}

/** Immutably replaces one account's metadata in the store, leaving every other account's entry untouched. */
export function upsertAccountMetadata(
  store: SyncMetadataStore,
  metadata: AccountSyncMetadata,
): SyncMetadataStore {
  return { ...store, accounts: { ...store.accounts, [metadata.accountId]: metadata } };
}

export function markEstablished(metadata: AccountSyncMetadata): AccountSyncMetadata {
  return { ...metadata, established: true };
}

export function setLastSyncedAt(metadata: AccountSyncMetadata, iso: string): AccountSyncMetadata {
  return { ...metadata, lastSyncedAt: iso };
}

export function setRecordUpdatedAt(
  metadata: AccountSyncMetadata,
  entity: SyncEntity,
  id: string,
  updatedAt: string,
): AccountSyncMetadata {
  return {
    ...metadata,
    records: {
      ...metadata.records,
      [entity]: { ...metadata.records[entity], [id]: { lastKnownUpdatedAt: updatedAt } },
    },
  };
}

export function getRecordUpdatedAt(
  metadata: AccountSyncMetadata,
  entity: SyncEntity,
  id: string,
): string | undefined {
  return metadata.records[entity][id]?.lastKnownUpdatedAt;
}

export function markDirty(metadata: AccountSyncMetadata, entity: SyncEntity, id: string): AccountSyncMetadata {
  if (metadata.dirty[entity].includes(id)) return metadata;
  return { ...metadata, dirty: { ...metadata.dirty, [entity]: [...metadata.dirty[entity], id] } };
}

export function clearDirty(metadata: AccountSyncMetadata, entity: SyncEntity, id: string): AccountSyncMetadata {
  if (!metadata.dirty[entity].includes(id)) return metadata;
  return {
    ...metadata,
    dirty: { ...metadata.dirty, [entity]: metadata.dirty[entity].filter((existing) => existing !== id) },
  };
}

export function isDirty(metadata: AccountSyncMetadata, entity: SyncEntity, id: string): boolean {
  return metadata.dirty[entity].includes(id);
}
