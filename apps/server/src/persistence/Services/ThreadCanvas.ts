/**
 * ThreadCanvasRepository - Repository interface for per-thread canvas documents.
 *
 * Owns persistence operations for the authoritative canvas document each
 * thread carries. The document column stays a raw JSON string at this
 * boundary — CanvasStore owns decoding, so canvas schema-version bumps
 * never break the SQL layer.
 *
 * @module ThreadCanvasRepository
 */
import { IsoDateTime, NonNegativeInt, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ThreadCanvasRepositoryError } from "../Errors.ts";

export const ThreadCanvasRow = Schema.Struct({
  threadId: ThreadId,
  /** Serialized CanvasDocument JSON, opaque at this layer. */
  doc: Schema.String,
  revision: NonNegativeInt,
  updatedAt: IsoDateTime,
});
export type ThreadCanvasRow = typeof ThreadCanvasRow.Type;

export const GetThreadCanvasInput = Schema.Struct({
  threadId: ThreadId,
});
export type GetThreadCanvasInput = typeof GetThreadCanvasInput.Type;

/**
 * ThreadCanvasRepositoryShape - Service API for thread canvas rows.
 */
export interface ThreadCanvasRepositoryShape {
  /**
   * Insert or replace a thread canvas row.
   *
   * Upserts by thread id.
   */
  readonly upsert: (row: ThreadCanvasRow) => Effect.Effect<void, ThreadCanvasRepositoryError>;

  /**
   * Read the canvas row for a thread.
   */
  readonly getByThreadId: (
    input: GetThreadCanvasInput,
  ) => Effect.Effect<Option.Option<ThreadCanvasRow>, ThreadCanvasRepositoryError>;
}

/**
 * ThreadCanvasRepository - Service tag for thread canvas persistence.
 */
export class ThreadCanvasRepository extends Context.Service<
  ThreadCanvasRepository,
  ThreadCanvasRepositoryShape
>()("t3/persistence/Services/ThreadCanvas/ThreadCanvasRepository") {}
