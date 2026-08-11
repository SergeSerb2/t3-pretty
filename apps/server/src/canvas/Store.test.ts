import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { type CanvasImageInit, type CanvasNode, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { expect } from "vite-plus/test";

import { resolveAttachmentPathById } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ThreadCanvasRepositoryLive } from "../persistence/Layers/ThreadCanvas.ts";
import { ThreadCanvasRepository } from "../persistence/Services/ThreadCanvas.ts";
import * as CanvasStore from "./Store.ts";

/**
 * Each `it.effect` shares the live CanvasStore layer (and its in-memory
 * sqlite) across the whole `it.layer` block, so every test uses a unique
 * thread id to avoid bleeding state from earlier tests.
 */
let nextThreadId = 0;
const freshThreadId = () => ThreadId.make(`thread-canvas-${++nextThreadId}`);

const note = (id: string, text = "note"): CanvasNode => ({
  id,
  type: "note",
  x: 0,
  y: 0,
  text,
});

const imageInit = (id: string): CanvasImageInit => ({
  id,
  type: "image",
  x: 0,
  y: 0,
  width: 32,
  height: 32,
});

const pngDataUrl = (payload: string): string =>
  `data:image/png;base64,${Buffer.from(payload).toString("base64")}`;

const layer = it.layer(
  CanvasStore.layer.pipe(
    Layer.provideMerge(ThreadCanvasRepositoryLive),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-canvas-store-test-" })),
    Layer.provideMerge(NodeServices.layer),
  ),
);

layer("CanvasStore", (it) => {
  it.effect("bootstraps an empty document on first get", () =>
    Effect.gen(function* () {
      const store = yield* CanvasStore.CanvasStore;
      const threadId = freshThreadId();
      const state = yield* store.get({ threadId });
      expect(state.threadId).toBe(threadId);
      expect(state.revision).toBe(0);
      expect(state.document.nodes).toEqual([]);
      expect(state.selectedNodeIds).toEqual([]);
      expect(state.serverEpoch.length).toBeGreaterThan(0);
    }),
  );

  it.effect("applies ops, bumps the revision, and persists across store instances", () =>
    Effect.gen(function* () {
      const store = yield* CanvasStore.CanvasStore;
      const threadId = freshThreadId();
      const result = yield* store.apply({
        threadId,
        baseRevision: 0,
        origin: "client",
        ops: [{ _tag: "add", node: note("n1") }],
      });
      expect(result.revision).toBe(1);
      expect(result.appliedNodeIds).toEqual(["n1"]);

      // A fresh store instance hydrates from the shared sqlite row.
      const rehydrated = yield* CanvasStore.make;
      const state = yield* rehydrated.get({ threadId });
      expect(state.revision).toBe(1);
      expect(state.document.nodes.map((node) => node.id)).toEqual(["n1"]);
    }),
  );

  it.effect("rejects a stale baseRevision and persists nothing", () =>
    Effect.gen(function* () {
      const store = yield* CanvasStore.CanvasStore;
      const threadId = freshThreadId();
      const error = yield* Effect.flip(
        store.apply({
          threadId,
          baseRevision: 5,
          origin: "client",
          ops: [{ _tag: "add", node: note("n1") }],
        }),
      );
      expect(error._tag).toBe("CanvasRevisionConflictError");
      if (error._tag === "CanvasRevisionConflictError") {
        expect(error.baseRevision).toBe(5);
        expect(error.currentRevision).toBe(0);
      }

      const rehydrated = yield* CanvasStore.make;
      const state = yield* rehydrated.get({ threadId });
      expect(state.revision).toBe(0);
      expect(state.document.nodes).toEqual([]);
    }),
  );

  it.effect("skipRevisionCheck applies agent ops over a stale base", () =>
    Effect.gen(function* () {
      const store = yield* CanvasStore.CanvasStore;
      const threadId = freshThreadId();
      yield* store.apply({
        threadId,
        baseRevision: 0,
        origin: "client",
        ops: [{ _tag: "add", node: note("n1") }],
      });
      const result = yield* store.apply({
        threadId,
        baseRevision: 0,
        origin: "agent",
        skipRevisionCheck: true,
        ops: [{ _tag: "add", node: note("n2") }],
      });
      expect(result.revision).toBe(2);
      const state = yield* store.get({ threadId });
      expect(state.document.nodes.map((node) => node.id)).toEqual(["n1", "n2"]);
    }),
  );

  it.effect("resolves add-image data URLs to attachment files and rewritten events", () =>
    Effect.gen(function* () {
      const store = yield* CanvasStore.CanvasStore;
      const fs = yield* FileSystem.FileSystem;
      const config = yield* ServerConfig.ServerConfig;
      const threadId = freshThreadId();
      const payload = "canvas-store-test-image-bytes";

      yield* Effect.scoped(
        Effect.gen(function* () {
          const pull = yield* Stream.toPull(store.subscribe(threadId));
          const first = yield* pull;
          expect(first.map((event) => event.type)).toEqual(["snapshot"]);
          expect(first[0].revision).toBe(0);

          const result = yield* store.apply({
            threadId,
            baseRevision: 0,
            origin: "client",
            ops: [
              {
                _tag: "add-image",
                node: imageInit("img-1"),
                image: { kind: "dataUrl", dataUrl: pngDataUrl(payload) },
              },
            ],
          });
          expect(result.appliedNodeIds).toEqual(["img-1"]);

          const second = yield* pull;
          const applied = second[0];
          if (applied.type !== "applied") throw new Error("expected an applied event");
          expect(applied.origin).toBe("client");
          expect(applied.revision).toBe(1);
          const op = applied.ops[0];
          if (op?._tag !== "add" || op.node.type !== "image") {
            throw new Error("expected the add-image op rewritten to add with an image node");
          }
          // The event carries the resolved node, never the base64 payload.
          expect("image" in op).toBe(false);
          expect(op.node.attachmentId.length).toBeGreaterThan(0);

          const attachmentPath = resolveAttachmentPathById({
            attachmentsDir: config.attachmentsDir,
            attachmentId: op.node.attachmentId,
          });
          if (attachmentPath === null) throw new Error("expected a resolvable attachment path");
          const bytes = yield* fs.readFile(attachmentPath);
          expect(Buffer.from(bytes).toString()).toBe(payload);
        }),
      );

      const state = yield* store.get({ threadId });
      const nodeInDoc = state.document.nodes[0];
      if (nodeInDoc?.type !== "image") throw new Error("expected an image node in the document");
      expect(nodeInDoc.attachmentId.length).toBeGreaterThan(0);
    }),
  );

  it.effect("rejects unknown attachment and unresolved workspace-file payloads", () =>
    Effect.gen(function* () {
      const store = yield* CanvasStore.CanvasStore;
      const threadId = freshThreadId();

      const attachmentError = yield* Effect.flip(
        store.apply({
          threadId,
          baseRevision: 0,
          origin: "agent",
          ops: [
            {
              _tag: "add-image",
              node: imageInit("img-1"),
              image: { kind: "attachment", attachmentId: "no-such-attachment" },
            },
          ],
        }),
      );
      expect(attachmentError._tag).toBe("CanvasImagePayloadError");
      if (attachmentError._tag === "CanvasImagePayloadError") {
        expect(attachmentError.reason).toBe("attachment-not-found");
      }

      const workspaceFileError = yield* Effect.flip(
        store.apply({
          threadId,
          baseRevision: 0,
          origin: "agent",
          ops: [
            {
              _tag: "add-image",
              node: imageInit("img-2"),
              image: { kind: "workspace-file", path: "images/pic.png" },
            },
          ],
        }),
      );
      expect(workspaceFileError._tag).toBe("CanvasInvalidOpError");
    }),
  );

  it.effect("rejects documents past the byte budget without advancing state", () =>
    Effect.gen(function* () {
      const store = yield* CanvasStore.CanvasStore;
      const threadId = freshThreadId();
      const bigText = "x".repeat(10_000);
      const error = yield* Effect.flip(
        store.apply({
          threadId,
          baseRevision: 0,
          origin: "client",
          ops: Array.from({ length: 250 }, (_, index) => ({
            _tag: "add" as const,
            node: note(`note-${index}`, bigText),
          })),
        }),
      );
      expect(error._tag).toBe("CanvasLimitExceededError");
      if (error._tag === "CanvasLimitExceededError") {
        expect(error.limit).toBe("docBytes");
      }

      const state = yield* store.get({ threadId });
      expect(state.revision).toBe(0);
      expect(state.document.nodes).toEqual([]);
    }),
  );

  it.effect("subscribe emits a snapshot first, then live applied events", () =>
    Effect.gen(function* () {
      const store = yield* CanvasStore.CanvasStore;
      const threadId = freshThreadId();
      yield* store.apply({
        threadId,
        baseRevision: 0,
        origin: "client",
        ops: [{ _tag: "add", node: note("n1") }],
      });

      yield* Effect.scoped(
        Effect.gen(function* () {
          const pull = yield* Stream.toPull(store.subscribe(threadId));
          const first = yield* pull;
          const snapshot = first[0];
          if (snapshot.type !== "snapshot") throw new Error("expected a snapshot event first");
          expect(snapshot.revision).toBe(1);
          expect(snapshot.document.nodes.map((node) => node.id)).toEqual(["n1"]);

          yield* store.apply({
            threadId,
            baseRevision: 1,
            origin: "agent",
            ops: [{ _tag: "add", node: note("n2") }],
          });
          const second = yield* pull;
          const applied = second[0];
          if (applied.type !== "applied") throw new Error("expected an applied event");
          expect(applied.revision).toBe(2);
          expect(applied.origin).toBe("agent");
        }),
      );
    }),
  );

  it.effect("selection updates filter unknown ids and never bump the revision", () =>
    Effect.gen(function* () {
      const store = yield* CanvasStore.CanvasStore;
      const threadId = freshThreadId();
      yield* store.apply({
        threadId,
        baseRevision: 0,
        origin: "client",
        ops: [{ _tag: "add", node: note("n1") }],
      });

      yield* Effect.scoped(
        Effect.gen(function* () {
          const pull = yield* Stream.toPull(store.subscribe(threadId));
          yield* pull; // snapshot
          yield* store.updateSelection({ threadId, selectedNodeIds: ["n1", "ghost"] });
          const events = yield* pull;
          const selection = events[0];
          if (selection.type !== "selection") throw new Error("expected a selection event");
          expect(selection.selectedNodeIds).toEqual(["n1"]);
          expect(selection.revision).toBe(1);
        }),
      );

      const state = yield* store.get({ threadId });
      expect(state.revision).toBe(1);
      expect(state.selectedNodeIds).toEqual(["n1"]);

      // Selection is in-memory only: a fresh store starts unselected.
      const rehydrated = yield* CanvasStore.make;
      const rehydratedState = yield* rehydrated.get({ threadId });
      expect(rehydratedState.selectedNodeIds).toEqual([]);
    }),
  );

  it.effect("falls back to an empty document when the stored JSON is corrupt", () =>
    Effect.gen(function* () {
      const store = yield* CanvasStore.CanvasStore;
      const repository = yield* ThreadCanvasRepository;
      const threadId = freshThreadId();
      yield* repository.upsert({
        threadId,
        doc: "{definitely-not-json",
        revision: 7,
        updatedAt: "2026-08-10T00:00:00.000Z",
      });

      const state = yield* store.get({ threadId });
      expect(state.document.nodes).toEqual([]);
      // The persisted revision survives so the next apply writes past it.
      expect(state.revision).toBe(7);
    }),
  );

  it.effect("getAgentState resolves image files and drops missing ones", () =>
    Effect.gen(function* () {
      const store = yield* CanvasStore.CanvasStore;
      const fs = yield* FileSystem.FileSystem;
      const config = yield* ServerConfig.ServerConfig;
      const threadId = freshThreadId();
      yield* store.apply({
        threadId,
        baseRevision: 0,
        origin: "client",
        ops: [
          {
            _tag: "add-image",
            node: imageInit("img-ok"),
            image: { kind: "dataUrl", dataUrl: pngDataUrl("agent-state-image") },
          },
          // A node whose attachment file does not exist stays in the
          // document but is dropped from `images`.
          {
            _tag: "add",
            node: {
              id: "img-missing",
              type: "image",
              x: 0,
              y: 0,
              width: 4,
              height: 4,
              attachmentId: "missing-attachment-id",
            },
          },
        ],
      });

      const agentState = yield* store.getAgentState(threadId);
      expect(agentState.revision).toBe(1);
      expect(agentState.document.nodes.map((node) => node.id)).toEqual(["img-ok", "img-missing"]);
      expect(agentState.images.map((image) => image.nodeId)).toEqual(["img-ok"]);
      const imageRef = agentState.images[0];
      if (imageRef === undefined) throw new Error("expected a resolved image ref");
      expect(imageRef.filePath.startsWith(config.attachmentsDir)).toBe(true);
      expect(yield* fs.exists(imageRef.filePath)).toBe(true);
    }),
  );
});
