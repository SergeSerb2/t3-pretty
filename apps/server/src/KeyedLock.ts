import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";
import * as SynchronizedRef from "effect/SynchronizedRef";

interface LockEntry {
  readonly semaphore: Semaphore.Semaphore;
  readonly users: number;
}

export interface KeyedLock {
  readonly withLock: <A, E, R>(
    key: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  readonly entryCount: Effect.Effect<number>;
}

/**
 * Serializes effects per key while releasing idle semaphore entries. A user is
 * counted before it waits for the permit, so cleanup cannot split mutual
 * exclusion while another caller is queued on the old semaphore.
 */
export const make = Effect.gen(function* () {
  const entriesRef = yield* SynchronizedRef.make(new Map<string, LockEntry>());

  const acquire = (key: string) =>
    SynchronizedRef.modifyEffect(entriesRef, (current) => {
      const existing = current.get(key);
      if (existing !== undefined) {
        const next = new Map(current);
        next.set(key, { semaphore: existing.semaphore, users: existing.users + 1 });
        return Effect.succeed([existing.semaphore, next] as const);
      }
      return Semaphore.make(1).pipe(
        Effect.map((semaphore) => {
          const next = new Map(current);
          next.set(key, { semaphore, users: 1 });
          return [semaphore, next] as const;
        }),
      );
    });

  const release = (key: string, semaphore: Semaphore.Semaphore) =>
    SynchronizedRef.update(entriesRef, (current) => {
      const existing = current.get(key);
      if (existing === undefined || existing.semaphore !== semaphore) return current;
      const next = new Map(current);
      if (existing.users === 1) {
        next.delete(key);
      } else {
        next.set(key, { semaphore, users: existing.users - 1 });
      }
      return next;
    });

  const withLock: KeyedLock["withLock"] = (key, effect) =>
    Effect.acquireUseRelease(
      acquire(key),
      (semaphore) => semaphore.withPermit(effect),
      (semaphore) => release(key, semaphore),
    );

  return {
    withLock,
    entryCount: SynchronizedRef.get(entriesRef).pipe(Effect.map((entries) => entries.size)),
  } satisfies KeyedLock;
});
