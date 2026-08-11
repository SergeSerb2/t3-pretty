/**
 * Canvas MCP toolkit handlers.
 *
 * Every handler re-checks the invocation credential for the "canvas"
 * capability and operates strictly on the credential's thread. Mutations go
 * through the CanvasStore with origin "agent" and skipRevisionCheck, so agent
 * edits land on top of whatever the current document is instead of
 * conflicting with concurrent user edits.
 *
 * Workspace-file image sources are resolved here, not in the store: the MCP
 * credential is thread-scoped, so the requested path must resolve (after
 * realpath, to stop symlink escapes) inside the thread's workspace before the
 * bytes are read and forwarded to the store as a data URL payload.
 */
import Mime from "@effect/platform-node/Mime";
import {
  type CanvasImageInit,
  type CanvasImagePayload,
  CanvasImagePayloadError,
  CanvasLimitExceededError,
  type CanvasMutationResult,
  type CanvasNode,
  type CanvasNodeId,
  type CanvasOp,
  CanvasPersistenceError,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ThreadId,
} from "@t3tools/contracts";
import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { CanvasStore } from "../../../canvas/Store.ts";
import { parseBase64DataUrl, SAFE_IMAGE_FILE_EXTENSIONS } from "../../../imageMime.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { type ImageDimensions, parseImageDimensions } from "./imageDimensions.ts";
import { CanvasToolkit } from "./tools.ts";

/** Fallback placement when the image's intrinsic size is unknown. */
export const CANVAS_DEFAULT_IMAGE_WIDTH = 512;
export const CANVAS_DEFAULT_IMAGE_HEIGHT = 384;
/** Longest placed side when sizing from intrinsic dimensions. */
export const CANVAS_MAX_DEFAULT_IMAGE_DIMENSION = 640;

const mintNodeId = (): CanvasNodeId => NodeCrypto.randomUUID();

/**
 * Placed size for a new image node. Explicit sizes win; a single explicit
 * dimension keeps the intrinsic aspect ratio when it is known (default 4:3
 * otherwise); with nothing given, the intrinsic size is downscaled to fit
 * CANVAS_MAX_DEFAULT_IMAGE_DIMENSION on the longest side, never upscaled.
 */
export function computePlacedImageSize(
  input: { readonly width?: number | undefined; readonly height?: number | undefined },
  natural: ImageDimensions | null,
): { readonly width: number; readonly height: number } {
  if (input.width !== undefined && input.height !== undefined) {
    return { width: input.width, height: input.height };
  }
  const aspect = natural
    ? natural.width / natural.height
    : CANVAS_DEFAULT_IMAGE_WIDTH / CANVAS_DEFAULT_IMAGE_HEIGHT;
  if (input.width !== undefined) {
    return { width: input.width, height: input.width / aspect };
  }
  if (input.height !== undefined) {
    return { width: input.height * aspect, height: input.height };
  }
  if (!natural) {
    return { width: CANVAS_DEFAULT_IMAGE_WIDTH, height: CANVAS_DEFAULT_IMAGE_HEIGHT };
  }
  const scale = Math.min(
    1,
    CANVAS_MAX_DEFAULT_IMAGE_DIMENSION / Math.max(natural.width, natural.height),
  );
  return { width: natural.width * scale, height: natural.height * scale };
}

/**
 * The thread's working directory, mirroring how ws.ts resolves asset
 * workspace context: the worktree when the thread has one, otherwise the
 * project's workspace root.
 */
const resolveThreadCwd = Effect.fn("CanvasToolkit.resolveThreadCwd")(function* (
  threadId: ThreadId,
) {
  const projection = yield* ProjectionSnapshotQuery;
  const thread = yield* projection
    .getThreadShellById(threadId)
    .pipe(Effect.mapError((cause) => new CanvasPersistenceError({ threadId, cause })));
  // Without a resolvable workspace there is nothing to safely contain the
  // path in, so the request is refused rather than resolved elsewhere.
  if (Option.isNone(thread)) {
    return yield* new CanvasImagePayloadError({ threadId, reason: "path-outside-workspace" });
  }
  if (thread.value.worktreePath !== null) {
    return thread.value.worktreePath;
  }
  const project = yield* projection
    .getProjectShellById(thread.value.projectId)
    .pipe(Effect.mapError((cause) => new CanvasPersistenceError({ threadId, cause })));
  if (Option.isNone(project)) {
    return yield* new CanvasImagePayloadError({ threadId, reason: "path-outside-workspace" });
  }
  return project.value.workspaceRoot;
});

const escapesRoot = (path: Path.Path, root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
};

/**
 * Read a workspace image file into a data-URL payload the store can resolve.
 * The path must stay inside the thread's workspace both lexically and after
 * realpath (symlinks must not escape); the MCP credential is thread-scoped
 * and must not become an arbitrary-file read primitive.
 */
const resolveWorkspaceImage = Effect.fn("CanvasToolkit.resolveWorkspaceImage")(function* (
  threadId: ThreadId,
  requestedPath: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cwd = yield* resolveThreadCwd(threadId);

  const absolutePath = path.resolve(cwd, requestedPath);
  if (escapesRoot(path, path.resolve(cwd), absolutePath)) {
    return yield* new CanvasImagePayloadError({ threadId, reason: "path-outside-workspace" });
  }
  const realCwd = yield* fileSystem
    .realPath(cwd)
    .pipe(
      Effect.mapError(
        () => new CanvasImagePayloadError({ threadId, reason: "path-outside-workspace" }),
      ),
    );
  const realTarget = yield* fileSystem
    .realPath(absolutePath)
    .pipe(
      Effect.mapError(() => new CanvasImagePayloadError({ threadId, reason: "file-not-found" })),
    );
  if (escapesRoot(path, realCwd, realTarget)) {
    return yield* new CanvasImagePayloadError({ threadId, reason: "path-outside-workspace" });
  }

  const extension = path.extname(realTarget).toLowerCase();
  const mimeType = Mime.getType(realTarget);
  if (!SAFE_IMAGE_FILE_EXTENSIONS.has(extension) || mimeType?.startsWith("image/") !== true) {
    return yield* new CanvasImagePayloadError({ threadId, reason: "not-an-image" });
  }

  const bytes = yield* fileSystem
    .readFile(realTarget)
    .pipe(
      Effect.mapError(() => new CanvasImagePayloadError({ threadId, reason: "file-not-found" })),
    );
  if (bytes.byteLength === 0) {
    return yield* new CanvasImagePayloadError({ threadId, reason: "not-an-image" });
  }
  if (bytes.byteLength > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
    return yield* new CanvasLimitExceededError({ threadId, limit: "imageBytes" });
  }

  return {
    payload: {
      kind: "dataUrl",
      dataUrl: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
    },
    natural: parseImageDimensions(bytes),
  } as const;
});

/**
 * Normalize a tool image source into a payload the CanvasStore accepts
 * (workspace files become data URLs) plus intrinsic dimensions when they are
 * cheaply sniffable. Attachment sources stay by-reference, so their intrinsic
 * size is unknown here.
 */
const resolveImageSource = Effect.fn("CanvasToolkit.resolveImageSource")(function* (
  threadId: ThreadId,
  source: CanvasImagePayload,
) {
  switch (source.kind) {
    case "dataUrl": {
      // Malformed data URLs pass through untouched: the store rejects them
      // with the precise CanvasImagePayloadError reason.
      const parsed = parseBase64DataUrl(source.dataUrl);
      const natural = parsed?.mimeType.startsWith("image/")
        ? parseImageDimensions(Buffer.from(parsed.base64, "base64"))
        : null;
      return { payload: source, natural } as const;
    }
    case "attachment":
      return { payload: source, natural: null } as const;
    case "workspace-file":
      return yield* resolveWorkspaceImage(threadId, source.path);
  }
});

const applySingleOp = Effect.fn("CanvasToolkit.applySingleOp")(function* (
  threadId: ThreadId,
  op: CanvasOp,
) {
  const store = yield* CanvasStore;
  const result = yield* store.apply({
    threadId,
    // skipRevisionCheck makes baseRevision inert: agent mutations apply on
    // top of the current document instead of conflicting with user edits.
    baseRevision: 0,
    ops: [op],
    origin: "agent",
    skipRevisionCheck: true,
  });
  const nodeId = result.appliedNodeIds.find((id): id is CanvasNodeId => id !== null);
  return {
    revision: result.revision,
    ...(nodeId === undefined ? {} : { nodeId }),
  } satisfies CanvasMutationResult;
});

export const canvasHandlers = {
  canvas_get_state: () =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.requireMcpCapability("canvas");
      const store = yield* CanvasStore;
      return yield* store.getAgentState(scope.threadId);
    }),
  canvas_add_image: (input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.requireMcpCapability("canvas");
      const threadId = scope.threadId;
      const { payload, natural } = yield* resolveImageSource(threadId, input.source);
      const size = computePlacedImageSize(input, natural);
      const node: CanvasImageInit = {
        id: mintNodeId(),
        type: "image",
        x: input.x ?? 0,
        y: input.y ?? 0,
        width: size.width,
        height: size.height,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
        ...(natural === null ? {} : { naturalWidth: natural.width, naturalHeight: natural.height }),
        sourceRef: {
          kind: "agent",
          ...(input.label === undefined ? {} : { label: input.label }),
        },
      };
      return yield* applySingleOp(threadId, { _tag: "add-image", node, image: payload });
    }),
  canvas_add_node: (input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.requireMcpCapability("canvas");
      const node: CanvasNode = { ...input.node, id: mintNodeId() };
      return yield* applySingleOp(scope.threadId, { _tag: "add", node });
    }),
  canvas_update_node: (input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.requireMcpCapability("canvas");
      return yield* applySingleOp(scope.threadId, {
        _tag: "update",
        id: input.nodeId,
        patch: input.patch,
      });
    }),
  canvas_remove_node: (input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.requireMcpCapability("canvas");
      return yield* applySingleOp(scope.threadId, { _tag: "remove", id: input.nodeId });
    }),
} satisfies Parameters<typeof CanvasToolkit.toLayer>[0];

export const CanvasToolkitHandlersLive = CanvasToolkit.toLayer(canvasHandlers);
