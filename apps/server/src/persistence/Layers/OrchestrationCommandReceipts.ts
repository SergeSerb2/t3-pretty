import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { toPersistenceSqlError } from "../Errors.ts";

import * as OrchestrationCommandReceipts from "../Services/OrchestrationCommandReceipts.ts";

export const ORCHESTRATION_COMMAND_RECEIPT_ERROR_MAX_CHARS = 8_192;

function boundReceiptError(error: string | null): string | null {
  if (error === null || error.length <= ORCHESTRATION_COMMAND_RECEIPT_ERROR_MAX_CHARS) {
    return error;
  }
  const truncated = error.slice(0, ORCHESTRATION_COMMAND_RECEIPT_ERROR_MAX_CHARS);
  const last = truncated.charCodeAt(truncated.length - 1);
  // String.slice is UTF-16; drop a dangling high surrogate so SQLite/JSON stay well-formed.
  return last >= 0xd800 && last <= 0xdbff ? truncated.slice(0, -1) : truncated;
}

const makeOrchestrationCommandReceiptRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertReceiptRow = SqlSchema.void({
    Request: OrchestrationCommandReceipts.OrchestrationCommandReceipt,
    execute: (receipt) =>
      sql`
        INSERT INTO orchestration_command_receipts (
          command_id,
          aggregate_kind,
          aggregate_id,
          command_type,
          accepted_at,
          result_sequence,
          status,
          error
        )
        VALUES (
          ${receipt.commandId},
          ${receipt.aggregateKind},
          ${receipt.aggregateId},
          ${receipt.commandType},
          ${receipt.acceptedAt},
          ${receipt.resultSequence},
          ${receipt.status},
          ${boundReceiptError(receipt.error)}
        )
        ON CONFLICT (command_id)
        DO UPDATE SET
          aggregate_kind = excluded.aggregate_kind,
            aggregate_id = excluded.aggregate_id,
            command_type = excluded.command_type,
          accepted_at = excluded.accepted_at,
          result_sequence = excluded.result_sequence,
          status = excluded.status,
          error = excluded.error
        WHERE NOT (
          orchestration_command_receipts.status = 'accepted'
          AND excluded.status = 'rejected'
        )
      `,
  });

  const findReceiptByCommandId = SqlSchema.findOneOption({
    Request: OrchestrationCommandReceipts.GetByCommandIdInput,
    Result: OrchestrationCommandReceipts.OrchestrationCommandReceipt,
    execute: ({ commandId }) =>
      sql`
        SELECT
          command_id AS "commandId",
          aggregate_kind AS "aggregateKind",
          aggregate_id AS "aggregateId",
          command_type AS "commandType",
          accepted_at AS "acceptedAt",
          result_sequence AS "resultSequence",
          status,
          error
        FROM orchestration_command_receipts
        WHERE command_id = ${commandId}
      `,
  });

  const upsert: OrchestrationCommandReceipts.OrchestrationCommandReceiptRepositoryShape["upsert"] =
    (receipt) =>
      upsertReceiptRow({ ...receipt, error: boundReceiptError(receipt.error) }).pipe(
        Effect.mapError(
          toPersistenceSqlError("OrchestrationCommandReceiptRepository.upsert:query"),
        ),
      );

  const insertIfAbsent: OrchestrationCommandReceipts.OrchestrationCommandReceiptRepositoryShape["insertIfAbsent"] =
    (receipt) =>
      sql<{ readonly command_id: string }>`
      INSERT INTO orchestration_command_receipts (
        command_id,
        aggregate_kind,
        aggregate_id,
        command_type,
        accepted_at,
        result_sequence,
        status,
        error
      )
      VALUES (
        ${receipt.commandId},
        ${receipt.aggregateKind},
        ${receipt.aggregateId},
        ${receipt.commandType},
        ${receipt.acceptedAt},
        ${receipt.resultSequence},
        ${receipt.status},
        ${boundReceiptError(receipt.error)}
      )
      ON CONFLICT(command_id) DO NOTHING
      RETURNING command_id
    `.pipe(
        Effect.map((rows) => rows.length === 1),
        Effect.mapError(
          toPersistenceSqlError("OrchestrationCommandReceiptRepository.insertIfAbsent:query"),
        ),
      );

  const getByCommandId: OrchestrationCommandReceipts.OrchestrationCommandReceiptRepositoryShape["getByCommandId"] =
    (input) =>
      findReceiptByCommandId(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("OrchestrationCommandReceiptRepository.getByCommandId:query"),
        ),
      );

  const pruneAcceptedBefore: OrchestrationCommandReceipts.OrchestrationCommandReceiptRepositoryShape["pruneAcceptedBefore"] = (
    input,
  ) =>
    sql<{ readonly command_id: string }>`
      DELETE FROM orchestration_command_receipts WHERE command_id IN (
        SELECT command_id FROM orchestration_command_receipts
        WHERE accepted_at < ${input.acceptedBefore}
        ORDER BY accepted_at, command_id LIMIT ${input.limit}
      ) RETURNING command_id
    `.pipe(
      Effect.map((rows) => rows.length),
      Effect.mapError(
        toPersistenceSqlError("OrchestrationCommandReceiptRepository.pruneAcceptedBefore:query"),
      ),
    );

  return {
    insertIfAbsent,
    upsert,
    getByCommandId,
    pruneAcceptedBefore,
  } satisfies OrchestrationCommandReceipts.OrchestrationCommandReceiptRepositoryShape;
});

export const OrchestrationCommandReceiptRepositoryLive = Layer.effect(
  OrchestrationCommandReceipts.OrchestrationCommandReceiptRepository,
  makeOrchestrationCommandReceiptRepository,
);
