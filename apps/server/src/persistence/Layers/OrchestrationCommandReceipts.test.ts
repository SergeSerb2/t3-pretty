import { CommandId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "./OrchestrationCommandReceipts.ts";
import { OrchestrationCommandReceiptRepository } from "../Services/OrchestrationCommandReceipts.ts";

const receiptsLayer = it.layer(
  OrchestrationCommandReceiptRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

receiptsLayer("OrchestrationCommandReceiptRepository", (it) => {
  it.effect("prunes old receipts in bounded batches and keeps recent ones", () =>
    Effect.gen(function* () {
      const receipts = yield* OrchestrationCommandReceiptRepository;
      const receipt = (commandId: string, acceptedAt: string) =>
        receipts.upsert({
          commandId: CommandId.make(commandId),
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-1"),
          acceptedAt,
          resultSequence: 1,
          status: "accepted",
          error: null,
        });

      yield* receipt("cmd-old-1", "2026-01-01T00:00:00.000Z");
      yield* receipt("cmd-old-2", "2026-01-02T00:00:00.000Z");
      yield* receipt("cmd-recent", "2026-01-10T00:00:00.000Z");

      const acceptedBefore = "2026-01-05T00:00:00.000Z";
      assert.equal(yield* receipts.pruneAcceptedBefore({ acceptedBefore, limit: 1 }), 1);
      assert.equal(yield* receipts.pruneAcceptedBefore({ acceptedBefore, limit: 1 }), 1);
      assert.equal(yield* receipts.pruneAcceptedBefore({ acceptedBefore, limit: 1 }), 0);

      assert.isTrue(
        Option.isNone(yield* receipts.getByCommandId({ commandId: CommandId.make("cmd-old-1") })),
      );
      assert.isTrue(
        Option.isSome(yield* receipts.getByCommandId({ commandId: CommandId.make("cmd-recent") })),
      );
    }),
  );
});
