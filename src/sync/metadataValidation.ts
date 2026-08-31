import {
  createEmptySyncMetadataStore,
  SYNC_ENTITIES,
  type AccountSyncMetadata,
  type EntitySyncRecord,
  type SyncMetadataStore,
} from './metadata';

export type SyncMetadataValidationResult =
  | { ok: true; data: SyncMetadataStore }
  | { ok: false; error: string };

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function validateEntityRecordMap(value: unknown): Record<string, EntitySyncRecord> | null {
  if (!value || typeof value !== 'object') return null;
  const out: Record<string, EntitySyncRecord> = {};
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') return null;
    const record = entry as Record<string, unknown>;
    if (!isString(record.lastKnownUpdatedAt)) return null;
    out[id] = { lastKnownUpdatedAt: record.lastKnownUpdatedAt };
  }
  return out;
}

function validateRecordsField(value: unknown): AccountSyncMetadata['records'] | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const result = {} as AccountSyncMetadata['records'];
  for (const entity of SYNC_ENTITIES) {
    const map = validateEntityRecordMap(obj[entity]);
    if (!map) return null;
    result[entity] = map;
  }
  return result;
}

function validateDirtyField(value: unknown): AccountSyncMetadata['dirty'] | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const result = {} as AccountSyncMetadata['dirty'];
  for (const entity of SYNC_ENTITIES) {
    const list = obj[entity];
    if (!Array.isArray(list) || !list.every(isString)) return null;
    result[entity] = list;
  }
  return result;
}

function validateAccountMetadata(value: unknown, expectedAccountId: string): AccountSyncMetadata | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  // The accountId inside the record must match the key it's stored under —
  // a mismatch means the store was hand-edited or corrupted in a way that
  // could otherwise leak one account's markers under another account's key.
  if (!isString(obj.accountId) || obj.accountId !== expectedAccountId) return null;
  if (!isBoolean(obj.established)) return null;
  if (obj.lastSyncedAt !== null && !isString(obj.lastSyncedAt)) return null;

  const records = validateRecordsField(obj.records);
  if (!records) return null;
  const dirty = validateDirtyField(obj.dirty);
  if (!dirty) return null;

  return {
    accountId: obj.accountId,
    established: obj.established,
    lastSyncedAt: obj.lastSyncedAt,
    records,
    dirty,
  };
}

export function validateSyncMetadataStore(raw: unknown): SyncMetadataValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Sync metadata must be an object.' };
  }

  const obj = raw as Record<string, unknown>;

  if (obj.version !== 1) {
    return { ok: false, error: 'Unsupported sync metadata version.' };
  }

  if (!obj.accounts || typeof obj.accounts !== 'object') {
    return { ok: false, error: 'Sync metadata accounts must be an object.' };
  }

  const accounts: SyncMetadataStore['accounts'] = {};
  for (const [accountId, value] of Object.entries(obj.accounts as Record<string, unknown>)) {
    const metadata = validateAccountMetadata(value, accountId);
    if (!metadata) {
      return { ok: false, error: `Invalid sync metadata for account ${accountId}.` };
    }
    accounts[accountId] = metadata;
  }

  return { ok: true, data: { version: 1, accounts } };
}

export function parseJsonSyncMetadata(json: string): SyncMetadataValidationResult {
  try {
    const parsed: unknown = JSON.parse(json);
    return validateSyncMetadataStore(parsed);
  } catch {
    return { ok: false, error: 'Invalid JSON.' };
  }
}

export function loadSyncMetadataFromString(raw: string | null): SyncMetadataStore {
  if (!raw) return createEmptySyncMetadataStore();
  const result = parseJsonSyncMetadata(raw);
  if (!result.ok) {
    console.warn('Stored sync metadata invalid:', result.error);
    return createEmptySyncMetadataStore();
  }
  return result.data;
}
