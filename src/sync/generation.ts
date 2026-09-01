/**
 * Phase 5B3A, task 3 of 3 (see SUPABASE_IMPLEMENTATION_PLAN.md "Phase 5B3A"):
 * an in-memory, per-session monotonic generation counter. A future drain
 * loop (Phase 5B3B) will capture the current generation before starting a
 * batch of queued writes and check `isCurrent()` between — never during —
 * individual network calls, so it stops picking up *new* work promptly after
 * a sign-out or account switch without attempting to cancel a request
 * already sent (see the plan's "in-flight requests" analysis: a request
 * already sent cannot be un-sent, and nothing that happens to the generation
 * afterward changes what that request is attributed to).
 *
 * Stubbed here with no drain loop yet — nothing currently calls `current()`
 * or `isCurrent()` for a real purpose. `AppContext.tsx` calls `invalidate()`
 * on the four triggers this phase's plan calls out: an actual change in the
 * authenticated account id (which includes sign-out, since that changes the
 * id to null), a RESET action, an IMPORT action, and component teardown.
 *
 * Never persisted — a fresh instance starts at generation 0 every session,
 * matching every other piece of Phase 5B3A's inert scaffolding.
 */

export interface SyncGeneration {
  /** The current generation number. */
  current(): number;
  /** True if `generation` is still the current one. */
  isCurrent(generation: number): boolean;
  /** Bumps the generation, invalidating any generation captured before this call. Returns the new generation. */
  invalidate(): number;
}

export function createSyncGeneration(): SyncGeneration {
  let generation = 0;

  return {
    current: () => generation,
    isCurrent: (g: number) => g === generation,
    invalidate: () => {
      generation += 1;
      return generation;
    },
  };
}
