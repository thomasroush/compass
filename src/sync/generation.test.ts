import { describe, expect, it } from 'vitest';
import { createSyncGeneration } from './generation';

describe('createSyncGeneration', () => {
  it('starts at generation 0, and that generation is current', () => {
    const gen = createSyncGeneration();
    expect(gen.current()).toBe(0);
    expect(gen.isCurrent(0)).toBe(true);
  });

  it('invalidate() increments the generation and returns the new value', () => {
    const gen = createSyncGeneration();
    expect(gen.invalidate()).toBe(1);
    expect(gen.current()).toBe(1);
  });

  it('a generation captured before invalidate() is no longer current afterward', () => {
    const gen = createSyncGeneration();
    const captured = gen.current();
    gen.invalidate();
    expect(gen.isCurrent(captured)).toBe(false);
    expect(gen.isCurrent(gen.current())).toBe(true);
  });

  it('multiple invalidations keep incrementing monotonically', () => {
    const gen = createSyncGeneration();
    gen.invalidate();
    gen.invalidate();
    gen.invalidate();
    expect(gen.current()).toBe(3);
  });

  it('two independent instances never interfere with each other', () => {
    const a = createSyncGeneration();
    const b = createSyncGeneration();
    a.invalidate();
    a.invalidate();
    expect(a.current()).toBe(2);
    expect(b.current()).toBe(0);
  });
});
