import { CommandId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { SqlitePersistenceMemory } from "./Sqlite.ts";
import {
  ORCHESTRATION_COMMAND_RECEIPT_ERROR_MAX_CHARS,
  OrchestrationCommandReceiptRepositoryLive,
} from "./OrchestrationCommandReceipts.ts";
import { OrchestrationCommandReceiptRepository } from "../Services/OrchestrationCommandReceipts.ts";

const receiptsLayer = it.layer(
  OrchestrationCommandReceiptRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

receiptsLayer("OrchestrationCommandReceiptRepository", (it) => {
  it.effect("bounds persisted rejection diagnostics", () =>
    Effect.gen(function* () {
      const receipts = yield* OrchestrationCommandReceiptRepository;
      const commandId = CommandId.make("cmd-bounded-error");
      yield* receipts.upsert({
        commandId,
        aggregateKind: "thread",
        aggregateId: ThreadId.make("thread-1"),
        acceptedAt: "2026-01-01T00:00:00.000Z",
        resultSequence: 1,
        status: "rejected",
        error: "x".repeat(ORCHESTRATION_COMMAND_RECEIPT_ERROR_MAX_CHARS + 1_000),
      });

      const stored = yield* receipts.getByCommandId({ commandId });
      assert.equal(stored._tag, "Some");
      if (stored._tag === "Some") {
        assert.equal(stored.value.error?.length, ORCHESTRATION_COMMAND_RECEIPT_ERROR_MAX_CHARS);
      }
    }),
  );

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
