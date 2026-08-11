/**
 * CanvasStore - Authoritative per-thread canvas state.
 *
 * Holds each thread's canvas document in memory, lazily hydrated from the
 * ThreadCanvasRepository, and applies batched ops with optimistic-concurrency
 * revisions. Every mutation runs inside the SynchronizedRef lock: the
 * repository upsert happens before the in-memory state advances (a SQL
 * failure leaves memory and disk consistent), and events are published inside
 * the lock so observers see them in state order.
 *
 * Image payloads are resolved here, before the pure op engine runs: data URLs
 * are decoded into attachment files on disk and `add-image` ops are rewritten
 * to plain `add` ops carrying the attachment id, so subscribers never see
 * base64 payloads on the event stream.
 */
import {
  CANVAS_MAX_DOC_BYTES,
  CANVAS_MAX_OPS_PER_APPLY,
  type CanvasAgentImageRef,
  type CanvasAgentState,
  type CanvasApplyInput,
  type CanvasApplyResult,
  CanvasDocument,
  type CanvasError,
  type CanvasEvent,
  type CanvasGetInput,
  type CanvasImageNode,
  CanvasImagePayloadError,
  CanvasInvalidOpError,
  CanvasLimitExceededError,
  type CanvasNodeId,
  type CanvasOp,
  CanvasPersistenceError,
  CanvasRevisionConflictError,
  type CanvasState,
  type CanvasUpdateSelectionInput,
  emptyCanvasDocument,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ThreadId,
} from "@t3tools/contracts";
import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";

import {
  createAttachmentId,
  resolveAttachmentPath,
  resolveAttachmentPathById,
} from "../attachmentStore.ts";
import { ServerConfig } from "../config.ts";
import { parseBase64DataUrl } from "../imageMime.ts";
import { ThreadCanvasRepository } from "../persistence/Services/ThreadCanvas.ts";
import { applyCanvasOps, type ResolvedCanvasOp } from "./Ops.ts";

export interface CanvasApplyOptions extends CanvasApplyInput {
  /** Who initiated the mutation; forwarded on the applied event. */
  readonly origin: "client" | "agent";
  /**
   * Skip the optimistic-concurrency check. Agent mutations apply on top of
   * whatever the current document is instead of conflicting.
   */
  readonly skipRevisionCheck?: boolean | undefined;
}

export class CanvasStore extends Context.Service<
  CanvasStore,
  {
    readonly get: (input: CanvasGetInput) => Effect.Effect<CanvasState, CanvasPersistenceError>;
    readonly apply: (input: CanvasApplyOptions) => Effect.Effect<CanvasApplyResult, CanvasError>;
    readonly updateSelection: (
      input: CanvasUpdateSelectionInput,
    ) => Effect.Effect<void, CanvasPersistenceError>;
    /** Emits a snapshot event first, then live events for the thread. */
    readonly subscribe: (threadId: ThreadId) => Stream.Stream<CanvasEvent, CanvasPersistenceError>;
    readonly getAgentState: (
      threadId: ThreadId,
    ) => Effect.Effect<CanvasAgentState, CanvasPersistenceError>;
  }
>()("t3/canvas/Store/CanvasStore") {}

interface ThreadCanvasEntry {
  readonly document: CanvasDocument;
  readonly revision: number;
  readonly selectedNodeIds: ReadonlyArray<CanvasNodeId>;
}

type AddImageOp = Extract<CanvasOp, { readonly _tag: "add-image" }>;

const currentIsoTimestamp = DateTime.now.pipe(Effect.map(DateTime.formatIso));

const CanvasDocumentJson = Schema.fromJsonString(CanvasDocument);
const decodeStoredDocument = Schema.decodeEffect(CanvasDocumentJson);
const encodeStoredDocument = Schema.encodeEffect(CanvasDocumentJson);

export const make = Effect.gen(function* CanvasStoreMake() {
  const repository = yield* ThreadCanvasRepository;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig;

  const serverEpoch = NodeCrypto.randomUUID();
  const stateRef = yield* SynchronizedRef.make<ReadonlyMap<ThreadId, ThreadCanvasEntry>>(new Map());
  // Unbounded PubSub is fine here — events are small (ops, never image
  // payloads) and we don't want to block publishers on a slow subscriber.
  const eventsPubSub = yield* PubSub.unbounded<CanvasEvent>();

  const loadEntry = Effect.fn("CanvasStore.loadEntry")(function* (threadId: ThreadId) {
    const row = yield* repository
      .getByThreadId({ threadId })
      .pipe(Effect.mapError((cause) => new CanvasPersistenceError({ threadId, cause })));
    if (Option.isNone(row)) {
      return {
        document: emptyCanvasDocument(),
        revision: 0,
        selectedNodeIds: [],
      } satisfies ThreadCanvasEntry;
    }
    // A doc that no longer decodes (corruption, schema-version drift) falls
    // back to an empty canvas instead of bricking the thread. The persisted
    // revision is kept so the next apply still writes past the stored row.
    const document = yield* decodeStoredDocument(row.value.doc).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Stored canvas document failed to decode; using an empty canvas", {
          threadId,
          cause,
        }).pipe(Effect.as(emptyCanvasDocument())),
      ),
    );
    return {
      document,
      revision: row.value.revision,
      selectedNodeIds: [],
    } satisfies ThreadCanvasEntry;
  });

  /**
   * Atomic read-modify-write over one thread's entry, hydrating from the
   * repository on first touch. The mutator runs under the SynchronizedRef
   * lock; a failure leaves the in-memory map untouched. Events must be
   * published inside the mutator so observers see them in state order.
   */
  const mutateEntry = <A, E>(
    threadId: ThreadId,
    mutator: (
      entry: ThreadCanvasEntry,
    ) => Effect.Effect<{ readonly next: ThreadCanvasEntry; readonly result: A }, E>,
  ): Effect.Effect<A, E | CanvasPersistenceError> =>
    SynchronizedRef.modifyEffect(stateRef, (state) =>
      Effect.gen(function* () {
        const entry = state.get(threadId) ?? (yield* loadEntry(threadId));
        const { next, result } = yield* mutator(entry);
        const nextState = new Map(state);
        nextState.set(threadId, next);
        return [result, nextState] as const;
      }),
    );

  const getEntry = (threadId: ThreadId): Effect.Effect<ThreadCanvasEntry, CanvasPersistenceError> =>
    mutateEntry(threadId, (entry) => Effect.succeed({ next: entry, result: entry }));

  /**
   * Resolve an `add-image` op into a complete image node. Data URLs are
   * decoded and persisted as attachment files (mirroring Normalizer's
   * attachment handling); a failure later in the same apply may orphan the
   * file, which is harmless — attachments are content-addressed by fresh ids.
   */
  const resolveAddImage = Effect.fn("CanvasStore.resolveAddImage")(function* (
    threadId: ThreadId,
    op: AddImageOp,
    opIndex: number,
  ) {
    const image = op.image;
    switch (image.kind) {
      case "dataUrl": {
        const parsed = parseBase64DataUrl(image.dataUrl);
        if (!parsed) {
          return yield* new CanvasImagePayloadError({ threadId, reason: "invalid-data-url" });
        }
        if (!parsed.mimeType.startsWith("image/")) {
          return yield* new CanvasImagePayloadError({ threadId, reason: "not-an-image" });
        }
        const bytes = Buffer.from(parsed.base64, "base64");
        if (bytes.byteLength === 0) {
          return yield* new CanvasImagePayloadError({ threadId, reason: "invalid-data-url" });
        }
        if (bytes.byteLength > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
          return yield* new CanvasLimitExceededError({ threadId, limit: "imageBytes" });
        }
        const attachmentId = createAttachmentId(threadId);
        if (!attachmentId) {
          return yield* new CanvasImagePayloadError({
            threadId,
            reason: "attachment-id-unavailable",
          });
        }
        const trimmedName = op.node.name?.trim() ?? "";
        const attachmentPath = resolveAttachmentPath({
          attachmentsDir: serverConfig.attachmentsDir,
          attachment: {
            type: "image",
            id: attachmentId,
            name: trimmedName.length > 0 ? trimmedName : "canvas-image",
            mimeType: parsed.mimeType,
            sizeBytes: bytes.byteLength,
          },
        });
        if (!attachmentPath) {
          return yield* new CanvasImagePayloadError({
            threadId,
            reason: "attachment-id-unavailable",
          });
        }
        yield* fileSystem
          .makeDirectory(path.dirname(attachmentPath), { recursive: true })
          .pipe(Effect.mapError((cause) => new CanvasPersistenceError({ threadId, cause })));
        yield* fileSystem
          .writeFile(attachmentPath, bytes)
          .pipe(Effect.mapError((cause) => new CanvasPersistenceError({ threadId, cause })));
        return { ...op.node, attachmentId } satisfies CanvasImageNode;
      }
      case "attachment": {
        const existingPath = resolveAttachmentPathById({
          attachmentsDir: serverConfig.attachmentsDir,
          attachmentId: image.attachmentId,
        });
        if (!existingPath) {
          return yield* new CanvasImagePayloadError({ threadId, reason: "attachment-not-found" });
        }
        return { ...op.node, attachmentId: image.attachmentId } satisfies CanvasImageNode;
      }
      case "workspace-file": {
        // The MCP handler resolves workspace paths (and their sandboxing)
        // before reaching the store.
        return yield* new CanvasInvalidOpError({
          threadId,
          opIndex,
          reason: "workspace-file payload must be resolved by the caller",
        });
      }
    }
  });

  const get: CanvasStore["Service"]["get"] = Effect.fn("CanvasStore.get")(function* (input) {
    const entry = yield* getEntry(input.threadId);
    return {
      threadId: input.threadId,
      document: entry.document,
      revision: entry.revision,
      serverEpoch,
      selectedNodeIds: entry.selectedNodeIds,
    };
  });

  const apply: CanvasStore["Service"]["apply"] = Effect.fn("CanvasStore.apply")(function* (input) {
    return yield* mutateEntry(
      input.threadId,
      Effect.fn("CanvasStore.applyOps")(function* (entry) {
        if (input.skipRevisionCheck !== true && input.baseRevision !== entry.revision) {
          return yield* new CanvasRevisionConflictError({
            threadId: input.threadId,
            baseRevision: input.baseRevision,
            currentRevision: entry.revision,
          });
        }
        if (input.ops.length > CANVAS_MAX_OPS_PER_APPLY) {
          return yield* new CanvasLimitExceededError({ threadId: input.threadId, limit: "ops" });
        }

        const resolvedOps: Array<ResolvedCanvasOp> = [];
        for (const [opIndex, op] of input.ops.entries()) {
          if (op._tag !== "add-image") {
            resolvedOps.push(op);
            continue;
          }
          const node = yield* resolveAddImage(input.threadId, op, opIndex);
          resolvedOps.push(
            op.index === undefined ? { _tag: "add", node } : { _tag: "add", node, index: op.index },
          );
        }

        const applied = applyCanvasOps(input.threadId, entry.document, resolvedOps);
        if (Result.isFailure(applied)) {
          return yield* applied.failure;
        }
        const { document, appliedNodeIds } = applied.success;

        const doc = yield* encodeStoredDocument(document).pipe(
          Effect.mapError(
            (cause) => new CanvasPersistenceError({ threadId: input.threadId, cause }),
          ),
        );
        if (Buffer.byteLength(doc, "utf8") > CANVAS_MAX_DOC_BYTES) {
          return yield* new CanvasLimitExceededError({
            threadId: input.threadId,
            limit: "docBytes",
          });
        }

        const revision = entry.revision + 1;
        const updatedAt = yield* currentIsoTimestamp;
        // Persist before advancing memory: an upsert failure aborts the
        // whole mutateEntry, so the in-memory entry never runs ahead of disk.
        yield* repository
          .upsert({ threadId: input.threadId, doc, revision, updatedAt })
          .pipe(
            Effect.mapError(
              (cause) => new CanvasPersistenceError({ threadId: input.threadId, cause }),
            ),
          );
        yield* PubSub.publish(eventsPubSub, {
          type: "applied",
          threadId: input.threadId,
          serverEpoch,
          revision,
          ops: resolvedOps,
          origin: input.origin,
        });

        const result: CanvasApplyResult = { revision, appliedNodeIds };
        return {
          next: { document, revision, selectedNodeIds: entry.selectedNodeIds },
          result,
        };
      }),
    );
  });

  const updateSelection: CanvasStore["Service"]["updateSelection"] = Effect.fn(
    "CanvasStore.updateSelection",
  )(function* (input) {
    yield* mutateEntry(
      input.threadId,
      Effect.fn("CanvasStore.updateSelectionEntry")(function* (entry) {
        const knownIds = new Set(entry.document.nodes.map((node) => node.id));
        const selectedNodeIds = input.selectedNodeIds.filter((id) => knownIds.has(id));
        // Selection is ephemeral presence state: no revision bump, no
        // persistence — just the in-memory entry and a broadcast.
        yield* PubSub.publish(eventsPubSub, {
          type: "selection",
          threadId: input.threadId,
          serverEpoch,
          revision: entry.revision,
          selectedNodeIds,
        });
        return { next: { ...entry, selectedNodeIds }, result: undefined as void };
      }),
    );
  });

  const subscribe: CanvasStore["Service"]["subscribe"] = (threadId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Subscribe BEFORE reading the snapshot so nothing published while
        // the snapshot loads is lost. An apply that lands in between shows
        // up both in the snapshot and as an event; subscribers drop events
        // whose revision is not past their snapshot's.
        const subscription = yield* PubSub.subscribe(eventsPubSub);
        const entry = yield* getEntry(threadId);
        const snapshot: CanvasEvent = {
          type: "snapshot",
          threadId,
          serverEpoch,
          revision: entry.revision,
          document: entry.document,
          selectedNodeIds: entry.selectedNodeIds,
        };
        return Stream.concat(
          Stream.make(snapshot),
          Stream.fromSubscription(subscription).pipe(
            Stream.filter((event) => event.threadId === threadId),
          ),
        );
      }),
    );

  const getAgentState: CanvasStore["Service"]["getAgentState"] = Effect.fn(
    "CanvasStore.getAgentState",
  )(function* (threadId) {
    const entry = yield* getEntry(threadId);
    const images: Array<CanvasAgentImageRef> = [];
    for (const node of entry.document.nodes) {
      if (node.type !== "image") continue;
      // Images whose backing file has gone missing stay in the document but
      // are dropped from `images` — the agent only gets readable paths.
      const filePath = resolveAttachmentPathById({
        attachmentsDir: serverConfig.attachmentsDir,
        attachmentId: node.attachmentId,
      });
      if (!filePath) continue;
      images.push({
        nodeId: node.id,
        attachmentId: node.attachmentId,
        filePath,
        ...(node.naturalWidth !== undefined ? { naturalWidth: node.naturalWidth } : {}),
        ...(node.naturalHeight !== undefined ? { naturalHeight: node.naturalHeight } : {}),
      });
    }
    return {
      document: entry.document,
      revision: entry.revision,
      selectedNodeIds: entry.selectedNodeIds,
      images,
    };
  });

  return CanvasStore.of({
    get,
    apply,
    updateSelection,
    subscribe,
    getAgentState,
  });
}).pipe(Effect.withSpan("CanvasStore.make"));

export const layer = Layer.effect(CanvasStore, make);
