import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { toPersistenceSqlError } from "../Errors.ts";

import {
  ThreadCanvasRepository,
  type ThreadCanvasRepositoryShape,
  GetThreadCanvasInput,
  ThreadCanvasRow,
} from "../Services/ThreadCanvas.ts";

const makeThreadCanvasRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertThreadCanvasRow = SqlSchema.void({
    Request: ThreadCanvasRow,
    execute: (row) =>
      sql`
        INSERT INTO thread_canvas (
          thread_id,
          doc,
          revision,
          updated_at
        )
        VALUES (
          ${row.threadId},
          ${row.doc},
          ${row.revision},
          ${row.updatedAt}
        )
        ON CONFLICT (thread_id)
        DO UPDATE SET
          doc = excluded.doc,
          revision = excluded.revision,
          updated_at = excluded.updated_at
      `,
  });

  const getThreadCanvasRow = SqlSchema.findOneOption({
    Request: GetThreadCanvasInput,
    Result: ThreadCanvasRow,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          doc,
          revision,
          updated_at AS "updatedAt"
        FROM thread_canvas
        WHERE thread_id = ${threadId}
      `,
  });

  const upsert: ThreadCanvasRepositoryShape["upsert"] = (row) =>
    upsertThreadCanvasRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ThreadCanvasRepository.upsert:query")),
    );

  const getByThreadId: ThreadCanvasRepositoryShape["getByThreadId"] = (input) =>
    getThreadCanvasRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ThreadCanvasRepository.getByThreadId:query")),
    );

  return {
    upsert,
    getByThreadId,
  } satisfies ThreadCanvasRepositoryShape;
});

export const ThreadCanvasRepositoryLive = Layer.effect(
  ThreadCanvasRepository,
  makeThreadCanvasRepository,
);
