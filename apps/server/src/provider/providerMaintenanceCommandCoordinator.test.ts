import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { makeProviderMaintenanceCommandCoordinator } from "./providerMaintenanceCommandCoordinator.ts";

it.effect("serializes distinct targets sharing a maintenance lock", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const coordinator = yield* makeProviderMaintenanceCommandCoordinator({
        makeAlreadyRunningError: (targetKey) => `already:${targetKey}`,
      });
      const firstEntered = yield* Deferred.make<void>();
      const releaseFirst = yield* Deferred.make<void>();
      const secondQueued = yield* Deferred.make<void>();
      const secondEntered = yield* Deferred.make<void>();

      const first = yield* coordinator
        .withCommandLock({
          targetKey: "provider-a",
          lockKey: "shared-install-root",
          run: Deferred.succeed(firstEntered, undefined).pipe(
            Effect.andThen(Deferred.await(releaseFirst)),
          ),
        })
        .pipe(Effect.forkScoped);
      yield* Deferred.await(firstEntered);

      const second = yield* coordinator
        .withCommandLock({
          targetKey: "provider-b",
          lockKey: "shared-install-root",
          onQueued: Deferred.succeed(secondQueued, undefined),
          run: Deferred.succeed(secondEntered, undefined),
        })
        .pipe(Effect.forkScoped);
      yield* Deferred.await(secondQueued);
      assert.isFalse(yield* Deferred.isDone(secondEntered));

      yield* Deferred.succeed(releaseFirst, undefined);
      yield* Deferred.await(secondEntered);
      yield* Fiber.join(first);
      yield* Fiber.join(second);
    }),
  ),
);

it.effect("releases a queued target when its maintenance command is interrupted", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const coordinator = yield* makeProviderMaintenanceCommandCoordinator({
        makeAlreadyRunningError: (targetKey) => `already:${targetKey}`,
      });
      const firstEntered = yield* Deferred.make<void>();
      const releaseFirst = yield* Deferred.make<void>();
      const secondQueued = yield* Deferred.make<void>();

      const first = yield* coordinator
        .withCommandLock({
          targetKey: "provider-a",
          lockKey: "shared-install-root",
          run: Deferred.succeed(firstEntered, undefined).pipe(
            Effect.andThen(Deferred.await(releaseFirst)),
          ),
        })
        .pipe(Effect.forkScoped);
      yield* Deferred.await(firstEntered);

      const queued = yield* coordinator
        .withCommandLock({
          targetKey: "provider-b",
          lockKey: "shared-install-root",
          onQueued: Deferred.succeed(secondQueued, undefined),
          run: Effect.void,
        })
        .pipe(Effect.forkScoped);
      yield* Deferred.await(secondQueued);
      yield* Fiber.interrupt(queued);

      const retry = yield* coordinator.withCommandLock({
        targetKey: "provider-b",
        lockKey: "independent-root",
        run: Effect.succeed("retried"),
      });
      assert.equal(retry, "retried");

      yield* Deferred.succeed(releaseFirst, undefined);
      yield* Fiber.join(first);
    }),
  ),
);

it.effect("rejects only the concurrently running target and accepts it again after release", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const coordinator = yield* makeProviderMaintenanceCommandCoordinator({
        makeAlreadyRunningError: (targetKey) => `already:${targetKey}`,
      });
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const running = yield* coordinator
        .withCommandLock({
          targetKey: "provider-a",
          lockKey: "root-a",
          run: Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
        })
        .pipe(Effect.forkScoped);
      yield* Deferred.await(entered);

      const duplicate = yield* coordinator
        .withCommandLock({
          targetKey: "provider-a",
          lockKey: "root-b",
          run: Effect.void,
        })
        .pipe(Effect.flip);
      assert.equal(duplicate, "already:provider-a");

      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(running);
      assert.equal(
        yield* coordinator.withCommandLock({
          targetKey: "provider-a",
          lockKey: "root-b",
          run: Effect.succeed("done"),
        }),
        "done",
      );
    }),
  ),
);
