import { describe, expect, it } from 'vitest';
import { createEmptyAccountMetadata, createEmptySyncMetadataStore } from './metadata';
import {
  loadSyncMetadataFromString,
  parseJsonSyncMetadata,
  validateSyncMetadataStore,
} from './metadataValidation';

describe('validateSyncMetadataStore', () => {
  it('accepts an empty, well-formed store', () => {
    expect(validateSyncMetadataStore(createEmptySyncMetadataStore())).toEqual({
      ok: true,
      data: createEmptySyncMetadataStore(),
    });
  });

  it('accepts a store with one valid account', () => {
    const store = { version: 1, accounts: { 'acct-1': createEmptyAccountMetadata('acct-1') } };
    expect(validateSyncMetadataStore(store)).toEqual({ ok: true, data: store });
  });

  it('rejects a non-object', () => {
    expect(validateSyncMetadataStore(null).ok).toBe(false);
    expect(validateSyncMetadataStore('nope').ok).toBe(false);
    expect(validateSyncMetadataStore(42).ok).toBe(false);
  });

  it('rejects an unsupported version', () => {
    expect(validateSyncMetadataStore({ version: 2, accounts: {} }).ok).toBe(false);
  });

  it('rejects when accounts is missing or not an object', () => {
    expect(validateSyncMetadataStore({ version: 1 }).ok).toBe(false);
    expect(validateSyncMetadataStore({ version: 1, accounts: 'nope' }).ok).toBe(false);
  });

  it('rejects a stored account whose accountId does not match its key (corruption/tampering guard)', () => {
    const store = { version: 1, accounts: { 'acct-1': createEmptyAccountMetadata('other-account') } };
    expect(validateSyncMetadataStore(store).ok).toBe(false);
  });

  it('rejects a malformed dirty field', () => {
    const bad = createEmptyAccountMetadata('acct-1') as unknown as Record<string, unknown>;
    bad.dirty = { project: 'not-an-array', task: [], dailyNote: [] };
    expect(validateSyncMetadataStore({ version: 1, accounts: { 'acct-1': bad } }).ok).toBe(false);
  });

  it('rejects a malformed records field', () => {
    const bad = createEmptyAccountMetadata('acct-1') as unknown as Record<string, unknown>;
    bad.records = { project: { p1: { lastKnownUpdatedAt: 123 } }, task: {}, dailyNote: {} };
    expect(validateSyncMetadataStore({ version: 1, accounts: { 'acct-1': bad } }).ok).toBe(false);
  });

  it('rejects a non-boolean established field', () => {
    const bad = createEmptyAccountMetadata('acct-1') as unknown as Record<string, unknown>;
    bad.established = 'yes';
    expect(validateSyncMetadataStore({ version: 1, accounts: { 'acct-1': bad } }).ok).toBe(false);
  });
});

describe('parseJsonSyncMetadata', () => {
  it('parses valid JSON matching the schema', () => {
    const json = JSON.stringify(createEmptySyncMetadataStore());
    expect(parseJsonSyncMetadata(json)).toEqual({ ok: true, data: createEmptySyncMetadataStore() });
  });

  it('rejects invalid JSON', () => {
    expect(parseJsonSyncMetadata('{not json')).toEqual({ ok: false, error: 'Invalid JSON.' });
  });
});

describe('loadSyncMetadataFromString', () => {
  it('returns an empty store for null (nothing stored yet)', () => {
    expect(loadSyncMetadataFromString(null)).toEqual(createEmptySyncMetadataStore());
  });

  it('returns an empty store, not a throw, for corrupted JSON', () => {
    expect(loadSyncMetadataFromString('{corrupt')).toEqual(createEmptySyncMetadataStore());
  });

  it('returns an empty store for well-formed JSON that fails schema validation', () => {
    expect(loadSyncMetadataFromString(JSON.stringify({ version: 99 }))).toEqual(
      createEmptySyncMetadataStore(),
    );
  });
});
