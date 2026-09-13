import { ThreadId, TurnId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ProjectionTurnRepository } from "../Services/ProjectionTurns.ts";
import { ProjectionTurnRepositoryLive } from "./ProjectionTurns.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  ProjectionTurnRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("ProjectionTurnRepository", (it) => {
  it.effect("settles running turns in storage while preserving the active turn", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionTurnRepository;
      const threadId = ThreadId.make("thread-settle-running");
      const activeTurnId = TurnId.make("turn-active");
      const staleTurnId = TurnId.make("turn-stale");
      const alreadyCompletedTurnId = TurnId.make("turn-already-completed");
      const baseRow = {
        threadId,
        pendingMessageId: null,
        sourceProposedPlanThreadId: null,
        sourceProposedPlanId: null,
        assistantMessageId: null,
        requestedAt: "2026-01-01T00:00:00.000Z",
        startedAt: "2026-01-01T00:00:01.000Z",
        checkpointTurnCount: null,
        checkpointRef: null,
        checkpointStatus: null,
        checkpointFiles: [],
      } as const;

      yield* repository.upsertByTurnId({
        ...baseRow,
        turnId: activeTurnId,
        state: "running",
        completedAt: null,
      });
      yield* repository.upsertByTurnId({
        ...baseRow,
        turnId: staleTurnId,
        state: "running",
        completedAt: null,
      });
      yield* repository.upsertByTurnId({
        ...baseRow,
        turnId: alreadyCompletedTurnId,
        state: "completed",
        completedAt: "2026-01-01T00:00:02.000Z",
      });

      const settledAt = "2026-01-01T00:00:03.000Z";
      yield* repository.settleRunningByThreadId({
        threadId,
        state: "completed",
        completedAt: settledAt,
        excludedTurnId: activeTurnId,
      });

      const active = Option.getOrThrow(
        yield* repository.getByTurnId({ threadId, turnId: activeTurnId }),
      );
      const stale = Option.getOrThrow(
        yield* repository.getByTurnId({ threadId, turnId: staleTurnId }),
      );
      const alreadyCompleted = Option.getOrThrow(
        yield* repository.getByTurnId({ threadId, turnId: alreadyCompletedTurnId }),
      );
      assert.equal(active.state, "running");
      assert.equal(active.completedAt, null);
      assert.equal(stale.state, "completed");
      assert.equal(stale.completedAt, settledAt);
      assert.equal(alreadyCompleted.completedAt, "2026-01-01T00:00:02.000Z");
    }),
  );
});
