/**
 * Canvas MCP toolkit - Tool schemas for agent access to the per-thread
 * collaborative canvas.
 *
 * All parameter schemas are flat structs (no root unions) so every MCP client
 * can render them; unions are nested under described fields. Handlers live in
 * `handlers.ts`.
 */
import {
  CanvasAgentState,
  CanvasError,
  CanvasFrameNode,
  CanvasImagePayload,
  CanvasMutationResult,
  CanvasNodePatch,
  CanvasNoteNode,
  CanvasRegionNode,
  McpCapabilityUnavailableError,
} from "@t3tools/contracts";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import { CanvasStore } from "../../../canvas/Store.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  CanvasStore,
  // Workspace-file image sources resolve the thread's cwd and read the file
  // inside the handler, so those services are handler dependencies too.
  ProjectionSnapshotQuery,
  FileSystem.FileSystem,
  Path.Path,
];

const CanvasToolFailure = Schema.Union([CanvasError, McpCapabilityUnavailableError]);

/**
 * Contract node-id schemas are trimmed-string transforms whose annotations do
 * not survive JSON-schema export, so parameter fields use a plain checked
 * string. Handlers still receive plain strings either way.
 */
const CanvasNodeIdParam = (description: string) =>
  Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(64)).annotate({ description });

/**
 * Baseline annotations shared by every canvas tool: they only touch the
 * thread-scoped canvas document (closed world). Per-tool overrides must be
 * chained after this wrapper — the last annotation for a key wins.
 */
const canvasTool = <T extends Tool.Any>(tool: T): T =>
  tool
    .annotate(Tool.OpenWorld, false)
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, false) as T;

export const CanvasGetStateTool = canvasTool(
  Tool.make("canvas_get_state", {
    description:
      "Read the user's shared canvas for this thread: the full node document (frames, images, ink strokes, regions, notes), the current revision, the user's live selection, and one entry per image node under images[]. Each images[].filePath is an absolute path you can open with the Read tool to view the image pixels. selectedNodeIds is what the user has selected right now, so treat it as the strongest hint for which nodes the user means by 'this' or 'here'. Node x/y coordinates are relative to the parent frame when parentId is set (root-relative otherwise), and document array order is z-order: later nodes render on top.",
    success: CanvasAgentState,
    failure: CanvasToolFailure,
    dependencies,
  }),
)
  .annotate(Tool.Title, "Read canvas state")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true);

const CanvasAddImageParams = Schema.Struct({
  source: CanvasImagePayload.annotate({
    description:
      "Where the image bytes come from: {kind:'dataUrl',dataUrl} for inline base64 image data, {kind:'attachment',attachmentId} for an existing chat attachment, or {kind:'workspace-file',path} for an image file inside this thread's workspace (relative paths resolve against the workspace root; the path must stay inside the workspace).",
  }),
  x: Schema.optional(
    Schema.Finite.annotate({
      description:
        "X position in canvas units, relative to the parent frame when parentId is set. Defaults to 0.",
    }),
  ),
  y: Schema.optional(
    Schema.Finite.annotate({
      description:
        "Y position in canvas units, relative to the parent frame when parentId is set. Defaults to 0.",
    }),
  ),
  width: Schema.optional(
    Schema.Finite.annotate({
      description:
        "Placed width in canvas units. When omitted, sized from the image's intrinsic dimensions (downscaled to fit 640 canvas units on the longest side); attachment sources have unknown intrinsic size and fall back to 512x384, so pass explicit sizes for those.",
    }),
  ),
  height: Schema.optional(
    Schema.Finite.annotate({
      description:
        "Placed height in canvas units. When omitted, derived the same way as width (intrinsic aspect ratio when known, otherwise a 512x384 fallback).",
    }),
  ),
  name: Schema.optional(
    Schema.String.check(Schema.isMaxLength(200)).annotate({
      description: "Human-readable layer name shown in the canvas layer list.",
    }),
  ),
  parentId: Schema.optional(
    CanvasNodeIdParam("Frame to place the image into. Omit to place it at the canvas root."),
  ),
  label: Schema.optional(
    Schema.String.check(Schema.isMaxLength(500)).annotate({
      description:
        "Caption describing the image, stored on the node's agent source reference and shown to the user.",
    }),
  ),
});

export const CanvasAddImageTool = canvasTool(
  Tool.make("canvas_add_image", {
    description:
      "Place an image on the user's shared canvas for this thread. The image bytes are persisted as a chat attachment and every collaborator sees the new node immediately. Returns the new revision and the created nodeId.",
    parameters: CanvasAddImageParams,
    success: CanvasMutationResult,
    failure: CanvasToolFailure,
    dependencies,
  }),
).annotate(Tool.Title, "Add image to canvas");

// Node init schemas are the contract node schemas minus `id`: the server
// mints node ids so agents cannot collide with (or forge) existing ones.
const { id: _frameId, ...frameInitFields } = CanvasFrameNode.fields;
const { id: _regionId, ...regionInitFields } = CanvasRegionNode.fields;
const { id: _noteId, ...noteInitFields } = CanvasNoteNode.fields;

const CanvasNodeInit = Schema.Union([
  Schema.Struct(noteInitFields),
  Schema.Struct(frameInitFields),
  Schema.Struct(regionInitFields),
]).annotate({
  description:
    "Node to create, discriminated by its type field: 'note' (sticky text callout with a text body), 'frame' (sized container other nodes can be parented into), or 'region' (labelled rectangle outline for calling out an area). Positions are parent-relative when parentId is set.",
});

const CanvasAddNodeParams = Schema.Struct({
  node: CanvasNodeInit,
});

export const CanvasAddNodeTool = canvasTool(
  Tool.make("canvas_add_node", {
    description:
      "Add a note, frame, or region node to the user's shared canvas for this thread. The server assigns the node id. Use notes for text callouts, frames to group nodes, and regions to outline an area; ink strokes cannot be created by agents. Returns the new revision and the created nodeId.",
    parameters: CanvasAddNodeParams,
    success: CanvasMutationResult,
    failure: CanvasToolFailure,
    dependencies,
  }),
).annotate(Tool.Title, "Add node to canvas");

const CanvasUpdateNodeParams = Schema.Struct({
  nodeId: CanvasNodeIdParam("Id of the node to update, as reported by canvas_get_state."),
  patch: CanvasNodePatch.annotate({
    description:
      "Fields to change on the node. Only include fields the node's type carries (for example text for notes, label for regions); the server rejects mismatched fields. parentId: null moves the node to the canvas root. Ink stroke points cannot be patched.",
  }),
});

export const CanvasUpdateNodeTool = canvasTool(
  Tool.make("canvas_update_node", {
    description:
      "Update an existing node on the user's shared canvas for this thread: move or resize it, rename it, re-parent it, or edit type-specific fields such as note text, region label, or colors. Applying the same patch twice leaves the same result.",
    parameters: CanvasUpdateNodeParams,
    success: CanvasMutationResult,
    failure: CanvasToolFailure,
    dependencies,
  }),
)
  .annotate(Tool.Title, "Update canvas node")
  .annotate(Tool.Idempotent, true);

const CanvasRemoveNodeParams = Schema.Struct({
  nodeId: CanvasNodeIdParam("Id of the node to remove, as reported by canvas_get_state."),
});

export const CanvasRemoveNodeTool = canvasTool(
  Tool.make("canvas_remove_node", {
    description:
      "Remove a node from the user's shared canvas for this thread. Removing a frame cascades: every node inside the frame (and nested frames) is removed with it, so read the canvas first if you are unsure what a frame contains.",
    parameters: CanvasRemoveNodeParams,
    success: CanvasMutationResult,
    failure: CanvasToolFailure,
    dependencies,
  }),
)
  .annotate(Tool.Title, "Remove canvas node")
  .annotate(Tool.Destructive, true);

export const CanvasToolkit = Toolkit.make(
  CanvasGetStateTool,
  CanvasAddImageTool,
  CanvasAddNodeTool,
  CanvasUpdateNodeTool,
  CanvasRemoveNodeTool,
);
