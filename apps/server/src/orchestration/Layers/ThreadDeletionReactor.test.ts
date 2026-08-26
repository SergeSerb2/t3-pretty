import { ThreadId, type OrchestrationEvent } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { it as effectIt } from "@effect/vitest";
import { describe, expect, it } from "vite-plus/test";

import {
  logCleanupCauseUnlessInterrupted,
  runThreadDeletionCleanup,
} from "./ThreadDeletionReactor.ts";

type ThreadDeletedEvent = Extract<OrchestrationEvent, { type: "thread.deleted" }>;

describe("logCleanupCauseUnlessInterrupted", () => {
  const threadId = ThreadId.make("thread-deletion-reactor-test");

  it("swallows ordinary cleanup failures", async () => {
    const exit = await Effect.runPromiseExit(
      logCleanupCauseUnlessInterrupted({
        effect: Effect.fail("cleanup failed"),
        message: "thread deletion cleanup skipped provider session stop",
        threadId,
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("preserves interrupt causes", async () => {
    const exit = await Effect.runPromiseExit(
      logCleanupCauseUnlessInterrupted({
        effect: Effect.interrupt,
        message: "thread deletion cleanup skipped provider session stop",
        threadId,
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
  });
});

describe("runThreadDeletionCleanup", () => {
  effectIt.effect("closes every thread-owned runtime surface", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("thread-deletion-reactor-test");
      const calls: string[] = [];
      const event = {
        type: "thread.deleted",
        payload: { threadId },
      } as ThreadDeletedEvent;

      yield* runThreadDeletionCleanup(event, {
        stopProviderSession: (receivedThreadId) =>
          Effect.sync(() => calls.push(`provider:${receivedThreadId}`)).pipe(Effect.asVoid),
        closeThreadTerminals: (receivedThreadId) =>
          Effect.sync(() => calls.push(`terminal:${receivedThreadId}`)).pipe(Effect.asVoid),
        closeThreadPreviews: (receivedThreadId) =>
          Effect.sync(() => calls.push(`preview:${receivedThreadId}`)).pipe(Effect.asVoid),
      });

      expect(calls).toEqual([
        `provider:${threadId}`,
        `terminal:${threadId}`,
        `preview:${threadId}`,
      ]);
    }),
  );
});
