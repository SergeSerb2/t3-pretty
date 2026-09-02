import { EnvironmentId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { assertTrue } from "@effect/vitest/utils";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ServerLifecycleEvents from "./serverLifecycleEvents.ts";

it.effect(
  "publishes lifecycle events without subscribers and snapshots the latest welcome/ready",
  () =>
    Effect.gen(function* () {
      const lifecycleEvents = yield* ServerLifecycleEvents.ServerLifecycleEvents;
      const environment = {
        environmentId: EnvironmentId.make("environment-test"),
        label: "Test environment",
        platform: { os: "darwin" as const, arch: "arm64" as const },
        serverVersion: "0.0.0-test",
        capabilities: { repositoryIdentity: true },
      };

      const welcome = yield* lifecycleEvents
        .publish({
          version: 1,
          type: "welcome",
          payload: {
            environment,
            cwd: "/tmp/project",
            projectName: "project",
          },
        })
        .pipe(Effect.timeoutOption("50 millis"));
      assertTrue(Option.isSome(welcome));
      assert.equal(welcome.value.sequence, 1);

      const ready = yield* lifecycleEvents
        .publish({
          version: 1,
          type: "ready",
          payload: {
            at: "2026-01-01T00:00:00.000Z",
            environment,
          },
        })
        .pipe(Effect.timeoutOption("50 millis"));
      assertTrue(Option.isSome(ready));
      assert.equal(ready.value.sequence, 2);

      const snapshot = yield* lifecycleEvents.snapshot;
      assert.equal(snapshot.sequence, 2);
      assert.deepEqual(snapshot.events.map((event) => event.type).toSorted(), ["ready", "welcome"]);
    }).pipe(Effect.provide(ServerLifecycleEvents.layer)),
);

it.effect("subscribes atomically after the retained lifecycle snapshot", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const lifecycleEvents = yield* ServerLifecycleEvents.ServerLifecycleEvents;
      const environment = {
        environmentId: EnvironmentId.make("environment-subscribe-test"),
        label: "Subscribe test environment",
        platform: { os: "darwin" as const, arch: "arm64" as const },
        serverVersion: "0.0.0-test",
        capabilities: { repositoryIdentity: true },
      };

      yield* lifecycleEvents.publish({
        version: 1,
        type: "welcome",
        payload: { environment, cwd: "/tmp/project", projectName: "project" },
      });
      const subscription = yield* lifecycleEvents.subscribe;
      yield* lifecycleEvents.publish({
        version: 1,
        type: "ready",
        payload: { at: "2026-01-01T00:00:00.000Z", environment },
      });

      assert.equal(subscription.snapshot.sequence, 1);
      const next = yield* subscription.changes.pipe(Stream.take(1), Stream.runHead);
      assert.equal(next._tag, "Some");
      if (next._tag === "Some") {
        assert.equal(next.value.sequence, 2);
        assert.equal(next.value.type, "ready");
      }
    }).pipe(Effect.provide(ServerLifecycleEvents.layer)),
  ),
);
