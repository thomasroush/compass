import { describe, expect, it } from 'vitest';
import { decideHydration, type EntityCounts, type HydrationInput } from './hydration';

const emptyCounts: EntityCounts = { projects: 0, tasks: 0, dailyNotes: 0 };
const populatedCounts: EntityCounts = { projects: 4, tasks: 9, dailyNotes: 3 };

function baseInput(overrides: Partial<HydrationInput> = {}): HydrationInput {
  return {
    authStatus: 'signedIn',
    localCounts: emptyCounts,
    cloud: { ok: true, counts: emptyCounts },
    deviceEstablished: false,
    ...overrides,
  };
}

describe('decideHydration', () => {
  it('returns signed-out when not authenticated, regardless of any other input', () => {
    const decision = decideHydration(
      baseInput({
        authStatus: 'signedOut',
        deviceEstablished: true,
        localCounts: populatedCounts,
        cloud: { ok: true, counts: populatedCounts },
      }),
    );
    expect(decision).toEqual({ kind: 'signed-out' });
  });

  it('returns cloud-query-failed when the cloud read errors, before counts are ever compared', () => {
    const decision = decideHydration(
      baseInput({ cloud: { ok: false, error: { type: 'database', message: 'timeout' } } }),
    );
    expect(decision).toEqual({ kind: 'cloud-query-failed', errorType: 'database', message: 'timeout' });
  });

  it('propagates the specific error type on cloud query failure (e.g. unauthenticated)', () => {
    const decision = decideHydration(
      baseInput({
        cloud: { ok: false, error: { type: 'unauthenticated', message: 'session expired' } },
      }),
    );
    expect(decision).toEqual({
      kind: 'cloud-query-failed',
      errorType: 'unauthenticated',
      message: 'session expired',
    });
  });

  it('returns both-empty when neither side has any data', () => {
    expect(decideHydration(baseInput())).toEqual({ kind: 'both-empty' });
  });

  it('returns hydrate-from-cloud when cloud has data and local is empty', () => {
    const decision = decideHydration(baseInput({ cloud: { ok: true, counts: populatedCounts } }));
    expect(decision).toEqual({ kind: 'hydrate-from-cloud' });
  });

  it('returns await-explicit-migration when local has data and cloud is empty (Phase 5A territory)', () => {
    const decision = decideHydration(baseInput({ localCounts: populatedCounts }));
    expect(decision).toEqual({ kind: 'await-explicit-migration' });
  });

  it('treats partial local data (e.g. only a daily note) as populated, not empty', () => {
    const decision = decideHydration(
      baseInput({ localCounts: { projects: 0, tasks: 0, dailyNotes: 1 } }),
    );
    expect(decision).toEqual({ kind: 'await-explicit-migration' });
  });

  it('returns require-explicit-choice when both sides have data and the device has no established marker', () => {
    const decision = decideHydration(
      baseInput({
        localCounts: populatedCounts,
        cloud: { ok: true, counts: populatedCounts },
        deviceEstablished: false,
      }),
    );
    expect(decision).toEqual({ kind: 'require-explicit-choice' });
  });

  it('returns sync-established when both sides have data and the device already has an established marker', () => {
    const decision = decideHydration(
      baseInput({
        localCounts: populatedCounts,
        cloud: { ok: true, counts: populatedCounts },
        deviceEstablished: true,
      }),
    );
    expect(decision).toEqual({ kind: 'sync-established' });
  });

  it('ignores deviceEstablished when the two sides are not both populated', () => {
    const decision = decideHydration(
      baseInput({ cloud: { ok: true, counts: populatedCounts }, deviceEstablished: true }),
    );
    expect(decision).toEqual({ kind: 'hydrate-from-cloud' });
  });
});
