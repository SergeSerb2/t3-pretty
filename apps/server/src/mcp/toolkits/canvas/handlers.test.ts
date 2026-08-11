import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  type CanvasAgentState,
  EnvironmentId,
  McpCapabilityUnavailableError,
  type OrchestrationProjectShell,
  type OrchestrationThreadShell,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import { type CanvasApplyOptions, CanvasStore } from "../../../canvas/Store.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { canvasHandlers, computePlacedImageSize } from "./handlers.ts";
import { parseImageDimensions } from "./imageDimensions.ts";

const threadId = ThreadId.make("thread-canvas-mcp");
const projectId = ProjectId.make("project-canvas-mcp");

const makeScope = (
  capabilities: ReadonlyArray<McpInvocationContext.McpCapability>,
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment-canvas-mcp"),
  threadId,
  providerSessionId: "provider-session-canvas-mcp",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(capabilities),
  issuedAt: 1,
});

const agentState: CanvasAgentState = {
  document: { schemaVersion: 1, nodes: [] },
  revision: 3,
  selectedNodeIds: [],
  images: [],
};

const makeStoreStub = () => {
  const applies: Array<CanvasApplyOptions> = [];
  const agentStateThreadIds: Array<ThreadId> = [];
  const store = CanvasStore.of({
    get: () => Effect.die("unused"),
    apply: (input) => {
      applies.push(input);
      const appliedNodeIds = input.ops.map((op) =>
        op._tag === "add" || op._tag === "add-image" ? op.node.id : null,
      );
      return Effect.succeed({ revision: 7, appliedNodeIds });
    },
    updateSelection: () => Effect.die("unused"),
    subscribe: () => Stream.empty,
    getAgentState: (id) => {
      agentStateThreadIds.push(id);
      return Effect.succeed(agentState);
    },
  });
  return { store, applies, agentStateThreadIds };
};

const unusedProjectionMethods = {
  getCommandReadModel: () => Effect.die("unused"),
  getSnapshot: () => Effect.die("unused"),
  getShellSnapshot: () => Effect.die("unused"),
  listMergedPullRequestCandidates: () => Effect.die("unused"),
  getArchivedShellSnapshot: () => Effect.die("unused"),
  searchThreads: () => Effect.die("unused"),
  getSnapshotSequence: () => Effect.die("unused"),
  getCounts: () => Effect.die("unused"),
  getActiveProjectByWorkspaceRoot: () => Effect.die("unused"),
  getFirstActiveThreadIdByProjectId: () => Effect.die("unused"),
  getThreadCheckpointContext: () => Effect.die("unused"),
  getFullThreadDiffContext: () => Effect.die("unused"),
  getThreadDetailById: () => Effect.die("unused"),
  getThreadDetailSnapshot: () => Effect.die("unused"),
} as const;

/** Only worktreePath / projectId (and the project's workspaceRoot) are read. */
const makeProjectionLayer = (workspace: {
  readonly worktreePath: string | null;
  readonly workspaceRoot?: string;
}) =>
  Layer.succeed(ProjectionSnapshotQuery, {
    ...unusedProjectionMethods,
    getThreadShellById: (id: ThreadId) =>
      Effect.succeed(
        Option.some({
          id,
          projectId,
          worktreePath: workspace.worktreePath,
        } as unknown as OrchestrationThreadShell),
      ),
    getProjectShellById: () =>
      Effect.succeed(
        workspace.workspaceRoot === undefined
          ? Option.none<OrchestrationProjectShell>()
          : Option.some({
              id: projectId,
              workspaceRoot: workspace.workspaceRoot,
            } as unknown as OrchestrationProjectShell),
      ),
  });

/** Minimal-but-parseable PNG: signature + IHDR dimensions, no pixel data. */
const fakePng = (width: number, height: number): Buffer => {
  const bytes = Buffer.alloc(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
};

const pngDataUrl = (width: number, height: number): string =>
  `data:image/png;base64,${fakePng(width, height).toString("base64")}`;

describe("capability gate", () => {
  it.effect("fails with the canvas capability when the credential does not grant it", () => {
    const { store } = makeStoreStub();
    return Effect.gen(function* () {
      const error = yield* canvasHandlers
        .canvas_get_state()
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, makeScope(["preview"])),
          Effect.provideService(CanvasStore, store),
          Effect.flip,
        );
      expect(error).toBeInstanceOf(McpCapabilityUnavailableError);
      expect(error).toMatchObject({
        capability: "canvas",
        threadId,
        providerSessionId: "provider-session-canvas-mcp",
      });
    });
  });
});

describe("thread-scoped store routing", () => {
  it.effect("reads agent state for the credential's thread", () => {
    const { store, agentStateThreadIds } = makeStoreStub();
    return Effect.gen(function* () {
      const state = yield* canvasHandlers
        .canvas_get_state()
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, makeScope(["canvas"])),
          Effect.provideService(CanvasStore, store),
        );
      expect(state).toEqual(agentState);
      expect(agentStateThreadIds).toEqual([threadId]);
    });
  });

  it.effect("adds nodes with a server-minted id, agent origin, and no revision gate", () => {
    const { store, applies } = makeStoreStub();
    return Effect.gen(function* () {
      const result = yield* canvasHandlers
        .canvas_add_node({ node: { type: "note", x: 10, y: 20, text: "todo" } })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, makeScope(["canvas"])),
          Effect.provideService(CanvasStore, store),
        );
      expect(applies).toHaveLength(1);
      const apply = applies[0]!;
      expect(apply.threadId).toBe(threadId);
      expect(apply.origin).toBe("agent");
      expect(apply.skipRevisionCheck).toBe(true);
      expect(apply.ops).toHaveLength(1);
      const op = apply.ops[0]!;
      expect(op._tag).toBe("add");
      if (op._tag !== "add") return;
      expect(op.node.type).toBe("note");
      expect(op.node.id.length).toBeGreaterThan(0);
      expect(result).toEqual({ revision: 7, nodeId: op.node.id });
    });
  });

  it.effect("updates and removes nodes by id for the credential's thread", () => {
    const { store, applies } = makeStoreStub();
    return Effect.gen(function* () {
      const provideScope = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, makeScope(["canvas"])),
          Effect.provideService(CanvasStore, store),
        );
      const updated = yield* provideScope(
        canvasHandlers.canvas_update_node({ nodeId: "n1", patch: { x: 5, text: "edited" } }),
      );
      expect(updated).toEqual({ revision: 7 });
      const removed = yield* provideScope(canvasHandlers.canvas_remove_node({ nodeId: "n2" }));
      expect(removed).toEqual({ revision: 7 });
      expect(applies.map((apply) => apply.ops[0])).toEqual([
        { _tag: "update", id: "n1", patch: { x: 5, text: "edited" } },
        { _tag: "remove", id: "n2" },
      ]);
      expect(applies.every((apply) => apply.threadId === threadId)).toBe(true);
      expect(applies.every((apply) => apply.origin === "agent")).toBe(true);
    });
  });
});

describe("canvas_add_image sizing", () => {
  it.effect("sizes data-url images from intrinsic dimensions, capped at 640", () => {
    const { store, applies } = makeStoreStub();
    return Effect.gen(function* () {
      const dataUrl = pngDataUrl(1280, 800);
      const result = yield* canvasHandlers
        .canvas_add_image({ source: { kind: "dataUrl", dataUrl }, label: "hero shot" })
        .pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, makeScope(["canvas"])),
          Effect.provideService(CanvasStore, store),
          Effect.provide(
            Layer.mergeAll(makeProjectionLayer({ worktreePath: null }), NodeServices.layer),
          ),
        );
      expect(result.nodeId).toBeDefined();
      const op = applies[0]!.ops[0]!;
      expect(op._tag).toBe("add-image");
      if (op._tag !== "add-image") return;
      expect(op.image).toEqual({ kind: "dataUrl", dataUrl });
      expect(op.node).toMatchObject({
        type: "image",
        x: 0,
        y: 0,
        width: 640,
        height: 400,
        naturalWidth: 1280,
        naturalHeight: 800,
        sourceRef: { kind: "agent", label: "hero shot" },
      });
    });
  });

  it("falls back to 512x384 and honors explicit or partial sizes", () => {
    expect(computePlacedImageSize({}, null)).toEqual({ width: 512, height: 384 });
    expect(computePlacedImageSize({ width: 100, height: 50 }, { width: 9, height: 9 })).toEqual({
      width: 100,
      height: 50,
    });
    expect(computePlacedImageSize({ width: 200 }, { width: 1000, height: 500 })).toEqual({
      width: 200,
      height: 100,
    });
    expect(computePlacedImageSize({ height: 300 }, null)).toEqual({ width: 400, height: 300 });
    // Small images are never upscaled to the 640 budget.
    expect(computePlacedImageSize({}, { width: 64, height: 32 })).toEqual({
      width: 64,
      height: 32,
    });
  });
});

describe("workspace-file containment", () => {
  const setupWorkspace = Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "canvas-mcp-test-" });
    const cwd = path.join(baseDir, "workspace");
    yield* fileSystem.makeDirectory(path.join(cwd, "shots"), { recursive: true });
    const insideBytes = fakePng(64, 32);
    yield* fileSystem.writeFile(path.join(cwd, "shots", "inside.png"), insideBytes);
    const outsidePath = path.join(baseDir, "outside.png");
    yield* fileSystem.writeFile(outsidePath, fakePng(8, 8));
    return { fileSystem, path, baseDir, cwd, insideBytes, outsidePath };
  });

  const addImageFromWorkspace = (
    filePath: string,
    workspace: { readonly worktreePath: string | null; readonly workspaceRoot?: string },
    store: ReturnType<typeof makeStoreStub>["store"],
  ) =>
    canvasHandlers
      .canvas_add_image({ source: { kind: "workspace-file", path: filePath } })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, makeScope(["canvas"])),
        Effect.provideService(CanvasStore, store),
        Effect.provide(makeProjectionLayer(workspace)),
      );

  it.effect("resolves an inside-workspace file into a data-url payload", () => {
    const { store, applies } = makeStoreStub();
    return Effect.scoped(
      Effect.gen(function* () {
        const { cwd, insideBytes } = yield* setupWorkspace;
        const result = yield* addImageFromWorkspace(
          "shots/inside.png",
          { worktreePath: cwd },
          store,
        );
        expect(result.nodeId).toBeDefined();
        const op = applies[0]!.ops[0]!;
        expect(op._tag).toBe("add-image");
        if (op._tag !== "add-image") return;
        expect(op.image).toEqual({
          kind: "dataUrl",
          dataUrl: `data:image/png;base64,${insideBytes.toString("base64")}`,
        });
        expect(op.node).toMatchObject({
          width: 64,
          height: 32,
          naturalWidth: 64,
          naturalHeight: 32,
        });
      }),
    ).pipe(Effect.provide(NodeServices.layer));
  });

  it.effect("falls back to the project workspace root when the thread has no worktree", () => {
    const { store, applies } = makeStoreStub();
    return Effect.scoped(
      Effect.gen(function* () {
        const { cwd } = yield* setupWorkspace;
        yield* addImageFromWorkspace(
          "shots/inside.png",
          { worktreePath: null, workspaceRoot: cwd },
          store,
        );
        expect(applies).toHaveLength(1);
      }),
    ).pipe(Effect.provide(NodeServices.layer));
  });

  it.effect("rejects ../ escapes and absolute paths outside the workspace", () => {
    const { store, applies } = makeStoreStub();
    return Effect.scoped(
      Effect.gen(function* () {
        const { cwd, outsidePath } = yield* setupWorkspace;
        const relativeEscape = yield* addImageFromWorkspace(
          "../outside.png",
          { worktreePath: cwd },
          store,
        ).pipe(Effect.flip);
        expect(relativeEscape).toMatchObject({
          _tag: "CanvasImagePayloadError",
          reason: "path-outside-workspace",
        });
        const absoluteEscape = yield* addImageFromWorkspace(
          outsidePath,
          { worktreePath: cwd },
          store,
        ).pipe(Effect.flip);
        expect(absoluteEscape).toMatchObject({
          _tag: "CanvasImagePayloadError",
          reason: "path-outside-workspace",
        });
        expect(applies).toHaveLength(0);
      }),
    ).pipe(Effect.provide(NodeServices.layer));
  });

  it.effect("rejects symlinks that resolve outside the workspace", () => {
    const { store, applies } = makeStoreStub();
    return Effect.scoped(
      Effect.gen(function* () {
        const { fileSystem, path, cwd, outsidePath } = yield* setupWorkspace;
        yield* fileSystem.symlink(outsidePath, path.join(cwd, "sneaky.png"));
        const error = yield* addImageFromWorkspace("sneaky.png", { worktreePath: cwd }, store).pipe(
          Effect.flip,
        );
        expect(error).toMatchObject({
          _tag: "CanvasImagePayloadError",
          reason: "path-outside-workspace",
        });
        expect(applies).toHaveLength(0);
      }),
    ).pipe(Effect.provide(NodeServices.layer));
  });

  it.effect("reports missing files and non-image extensions distinctly", () => {
    const { store } = makeStoreStub();
    return Effect.scoped(
      Effect.gen(function* () {
        const { fileSystem, path, cwd } = yield* setupWorkspace;
        const missing = yield* addImageFromWorkspace(
          "shots/missing.png",
          { worktreePath: cwd },
          store,
        ).pipe(Effect.flip);
        expect(missing).toMatchObject({
          _tag: "CanvasImagePayloadError",
          reason: "file-not-found",
        });
        yield* fileSystem.writeFileString(path.join(cwd, "notes.txt"), "not an image");
        const notImage = yield* addImageFromWorkspace(
          "notes.txt",
          { worktreePath: cwd },
          store,
        ).pipe(Effect.flip);
        expect(notImage).toMatchObject({
          _tag: "CanvasImagePayloadError",
          reason: "not-an-image",
        });
      }),
    ).pipe(Effect.provide(NodeServices.layer));
  });
});

describe("parseImageDimensions", () => {
  it("reads container headers and rejects unknown bytes", () => {
    expect(parseImageDimensions(fakePng(640, 480))).toEqual({ width: 640, height: 480 });
    const gif = Buffer.alloc(10);
    gif.write("GIF89a", 0);
    gif.writeUInt16LE(320, 6);
    gif.writeUInt16LE(200, 8);
    expect(parseImageDimensions(gif)).toEqual({ width: 320, height: 200 });
    expect(parseImageDimensions(Buffer.from("definitely not an image"))).toBeNull();
    expect(parseImageDimensions(Buffer.alloc(0))).toBeNull();
  });
});
