/**
 * Canvas - Schemas for the per-thread collaborative canvas surface.
 *
 * The canvas is a shared spatial document (frames, images, ink, regions,
 * notes) that humans edit in the client and agents read/mutate over MCP. The
 * server owns the authoritative document and applies batched ops with
 * optimistic-concurrency revisions; clients and agents converge through the
 * canvas event stream.
 *
 * @module Canvas
 */
import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const CANVAS_SCHEMA_VERSION = 1;
export const CANVAS_MAX_NODES = 1024;
/** Serialized-document budget enforced server-side; there is no schema check. */
export const CANVAS_MAX_DOC_BYTES = 2 * 1024 * 1024;
export const CANVAS_MAX_INK_POINTS = 4096;
export const CANVAS_MAX_OPS_PER_APPLY = 256;
export const CANVAS_MAX_NOTE_TEXT_LENGTH = 10_000;

export const CanvasNodeId = TrimmedNonEmptyString.check(Schema.isMaxLength(64));
export type CanvasNodeId = typeof CanvasNodeId.Type;

const CanvasNodeName = Schema.String.check(Schema.isMaxLength(200));
const CanvasColor = Schema.String.check(Schema.isMaxLength(32));
const CanvasRegionLabel = Schema.String.check(Schema.isMaxLength(500));
const CanvasNoteText = Schema.String.check(Schema.isMaxLength(CANVAS_MAX_NOTE_TEXT_LENGTH));
const CanvasAttachmentId = TrimmedNonEmptyString.check(Schema.isMaxLength(256));

const CanvasNodeBaseFields = {
  id: CanvasNodeId.annotate({
    description: "Stable node identifier, unique within the document.",
  }),
  name: Schema.optional(
    CanvasNodeName.annotate({
      description: "Human-readable layer name shown in the canvas layer list.",
    }),
  ),
  parentId: Schema.optional(
    CanvasNodeId.annotate({
      description:
        "Frame this node belongs to. Absent means the node sits at the canvas root. Children position relative to their parent frame.",
    }),
  ),
  x: Schema.Finite.annotate({
    description:
      "X position in canvas units. Parent-relative when parentId is set, root-relative otherwise.",
  }),
  y: Schema.Finite.annotate({
    description:
      "Y position in canvas units. Parent-relative when parentId is set, root-relative otherwise.",
  }),
};

export const CanvasImageSourceRef = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("preview-tab").annotate({
      description: "Image captured from a collaborative browser preview tab.",
    }),
    tabId: Schema.optional(
      Schema.String.annotate({
        description: "Preview tab the image was captured from, when still known.",
      }),
    ),
    url: Schema.optional(Schema.String.annotate({ description: "Page URL at capture time." })),
  }),
  Schema.Struct({
    kind: Schema.Literal("window").annotate({
      description: "Image captured from a desktop window or screen.",
    }),
    sourceId: Schema.String.annotate({
      description:
        "Electron desktop-capturer source id such as window:123:0. Not stable across app restarts; clients re-match by appName and windowTitle.",
    }),
    appName: Schema.optional(
      Schema.String.annotate({ description: "Owning application name at capture time." }),
    ),
    windowTitle: Schema.optional(
      Schema.String.annotate({ description: "Window title at capture time." }),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal("agent").annotate({
      description: "Image placed on the canvas by an agent.",
    }),
    label: Schema.optional(
      Schema.String.annotate({ description: "Agent-chosen caption describing the image." }),
    ),
  }),
]);
export type CanvasImageSourceRef = typeof CanvasImageSourceRef.Type;

export const CanvasFrameNode = Schema.Struct({
  ...CanvasNodeBaseFields,
  type: Schema.Literal("frame"),
  width: Schema.Finite.annotate({ description: "Frame width in canvas units." }),
  height: Schema.Finite.annotate({ description: "Frame height in canvas units." }),
});
export type CanvasFrameNode = typeof CanvasFrameNode.Type;

/** CanvasImageNode without attachmentId; shared with CanvasImageInit. */
const CanvasImageNodeInitFields = {
  ...CanvasNodeBaseFields,
  type: Schema.Literal("image"),
  width: Schema.Finite.annotate({ description: "Placed width in canvas units." }),
  height: Schema.Finite.annotate({ description: "Placed height in canvas units." }),
  naturalWidth: Schema.optional(
    PositiveInt.annotate({ description: "Intrinsic image width in pixels." }),
  ),
  naturalHeight: Schema.optional(
    PositiveInt.annotate({ description: "Intrinsic image height in pixels." }),
  ),
  sourceRef: Schema.optional(
    CanvasImageSourceRef.annotate({ description: "Where the image was captured from." }),
  ),
};

export const CanvasImageNode = Schema.Struct({
  ...CanvasImageNodeInitFields,
  attachmentId: CanvasAttachmentId.annotate({
    description: "Chat attachment holding the image bytes.",
  }),
});
export type CanvasImageNode = typeof CanvasImageNode.Type;

export const CanvasInkPoint = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
});
export type CanvasInkPoint = typeof CanvasInkPoint.Type;

export const CanvasInkNode = Schema.Struct({
  ...CanvasNodeBaseFields,
  type: Schema.Literal("ink"),
  points: Schema.Array(CanvasInkPoint).check(Schema.isMaxLength(CANVAS_MAX_INK_POINTS)).annotate({
    description: "Stroke points in node-relative coordinates (offsets from the node's x/y).",
  }),
  color: CanvasColor.annotate({ description: "CSS stroke color." }),
  strokeWidth: Schema.Finite.annotate({ description: "Stroke width in canvas units." }),
});
export type CanvasInkNode = typeof CanvasInkNode.Type;

export const CanvasRegionNode = Schema.Struct({
  ...CanvasNodeBaseFields,
  type: Schema.Literal("region"),
  width: Schema.Finite.annotate({ description: "Region width in canvas units." }),
  height: Schema.Finite.annotate({ description: "Region height in canvas units." }),
  label: Schema.optional(
    CanvasRegionLabel.annotate({ description: "Short callout text rendered with the region." }),
  ),
  color: Schema.optional(CanvasColor.annotate({ description: "CSS outline color." })),
});
export type CanvasRegionNode = typeof CanvasRegionNode.Type;

export const CanvasNoteNode = Schema.Struct({
  ...CanvasNodeBaseFields,
  type: Schema.Literal("note"),
  text: CanvasNoteText.annotate({ description: "Note body text." }),
  color: Schema.optional(CanvasColor.annotate({ description: "CSS note background color." })),
  width: Schema.optional(
    Schema.Finite.annotate({
      description: "Placed width in canvas units. Height follows the text.",
    }),
  ),
});
export type CanvasNoteNode = typeof CanvasNoteNode.Type;

export const CanvasNode = Schema.Union([
  CanvasFrameNode,
  CanvasImageNode,
  CanvasInkNode,
  CanvasRegionNode,
  CanvasNoteNode,
]);
export type CanvasNode = typeof CanvasNode.Type;

export const CanvasDocument = Schema.Struct({
  schemaVersion: Schema.Literal(CANVAS_SCHEMA_VERSION),
  /** Array order is sibling z-order: later nodes render above earlier ones. */
  nodes: Schema.Array(CanvasNode).check(Schema.isMaxLength(CANVAS_MAX_NODES)),
});
export type CanvasDocument = typeof CanvasDocument.Type;

export const emptyCanvasDocument = (): CanvasDocument => ({
  schemaVersion: CANVAS_SCHEMA_VERSION,
  nodes: [],
});

/**
 * Loose partial update. The server validates each field against the target
 * node's type and rejects fields the type doesn't carry. Ink `points` are
 * deliberately not patchable — strokes are immutable once drawn; replace the
 * node instead.
 */
/**
 * Partial node update. A key that is absent is left alone; on the keys that
 * are optional for the target node type, an explicit `null` clears it (JSON
 * cannot carry `undefined`, so clearing needs a sentinel — the same one
 * `parentId` already uses to mean "the canvas root").
 */
export const CanvasNodePatch = Schema.Struct({
  x: Schema.optional(Schema.Finite),
  y: Schema.optional(Schema.Finite),
  width: Schema.optional(
    Schema.NullOr(Schema.Finite).annotate({
      description: "Width. Null clears an optional width (notes only).",
    }),
  ),
  height: Schema.optional(Schema.Finite),
  name: Schema.optional(
    Schema.NullOr(CanvasNodeName).annotate({ description: "Name. Null clears it." }),
  ),
  parentId: Schema.optional(
    Schema.NullOr(CanvasNodeId).annotate({
      description: "New parent frame. Null moves the node to the canvas root.",
    }),
  ),
  text: Schema.optional(CanvasNoteText),
  color: Schema.optional(
    Schema.NullOr(CanvasColor).annotate({ description: "Color. Null restores the default." }),
  ),
  label: Schema.optional(
    Schema.NullOr(CanvasRegionLabel).annotate({ description: "Label. Null clears it." }),
  ),
  strokeWidth: Schema.optional(Schema.Finite),
  sourceRef: Schema.optional(
    Schema.NullOr(CanvasImageSourceRef).annotate({
      description: "Capture origin. Null clears it.",
    }),
  ),
  attachmentId: Schema.optional(CanvasAttachmentId),
  naturalWidth: Schema.optional(Schema.NullOr(PositiveInt)),
  naturalHeight: Schema.optional(Schema.NullOr(PositiveInt)),
});
export type CanvasNodePatch = typeof CanvasNodePatch.Type;

/**
 * CanvasImageNode minus attachmentId. Used by add-image ops, where the server
 * resolves the image payload into an attachment id.
 */
export const CanvasImageInit = Schema.Struct(CanvasImageNodeInitFields);
export type CanvasImageInit = typeof CanvasImageInit.Type;

export const CanvasImagePayload = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("dataUrl"),
    dataUrl: Schema.String.annotate({ description: "data: URL carrying the image bytes." }),
  }),
  Schema.Struct({
    kind: Schema.Literal("attachment"),
    attachmentId: CanvasAttachmentId.annotate({
      description: "Existing chat attachment to place on the canvas.",
    }),
  }),
  Schema.Struct({
    kind: Schema.Literal("workspace-file"),
    path: TrimmedNonEmptyString.check(Schema.isMaxLength(1024)).annotate({
      description: "Image file path inside the thread's workspace.",
    }),
  }),
]);
export type CanvasImagePayload = typeof CanvasImagePayload.Type;

const CanvasOpIndex = Schema.optional(
  NonNegativeInt.annotate({
    description: "Insertion index among the parent's children. Appends when omitted.",
  }),
);

export const CanvasOp = Schema.Union([
  Schema.TaggedStruct("add", {
    node: CanvasNode,
    index: CanvasOpIndex,
  }),
  Schema.TaggedStruct("add-image", {
    node: CanvasImageInit,
    image: CanvasImagePayload,
    index: CanvasOpIndex,
  }),
  Schema.TaggedStruct("update", {
    id: CanvasNodeId,
    patch: CanvasNodePatch,
  }),
  Schema.TaggedStruct("remove", {
    id: CanvasNodeId,
  }).annotate({
    description: "Removes the node. Removing a frame cascades through its descendants.",
  }),
  Schema.TaggedStruct("reorder", {
    parentId: Schema.NullOr(CanvasNodeId).annotate({
      description: "Frame whose children to reorder; null targets the canvas root.",
    }),
    childIds: Schema.Array(CanvasNodeId).annotate({
      description:
        "New sibling z-order, bottom to top. Must be a permutation of that parent's current children.",
    }),
  }),
]);
export type CanvasOp = typeof CanvasOp.Type;

export const CanvasGetInput = Schema.Struct({
  threadId: ThreadId,
});
export type CanvasGetInput = typeof CanvasGetInput.Type;

export const CanvasState = Schema.Struct({
  threadId: ThreadId,
  document: CanvasDocument,
  /** Monotonic server state revision used to reject stale apply requests. */
  revision: NonNegativeInt,
  /** Identifies the current server process so revision resets are safe. */
  serverEpoch: TrimmedNonEmptyString,
  selectedNodeIds: Schema.Array(CanvasNodeId),
});
export type CanvasState = typeof CanvasState.Type;

export const CanvasApplyInput = Schema.Struct({
  threadId: ThreadId,
  /** Revision the ops were computed against; mismatches conflict. */
  baseRevision: NonNegativeInt,
  ops: Schema.Array(CanvasOp).check(Schema.isMaxLength(CANVAS_MAX_OPS_PER_APPLY)),
});
export type CanvasApplyInput = typeof CanvasApplyInput.Type;

export const CanvasApplyResult = Schema.Struct({
  revision: PositiveInt,
  /** Aligned with the input ops; null for ops that don't create a node. */
  appliedNodeIds: Schema.Array(Schema.NullOr(CanvasNodeId)),
});
export type CanvasApplyResult = typeof CanvasApplyResult.Type;

export const CanvasUpdateSelectionInput = Schema.Struct({
  threadId: ThreadId,
  selectedNodeIds: Schema.Array(CanvasNodeId).check(Schema.isMaxLength(CANVAS_MAX_NODES)),
});
export type CanvasUpdateSelectionInput = typeof CanvasUpdateSelectionInput.Type;

export const CanvasSubscribeInput = Schema.Struct({
  threadId: ThreadId,
});
export type CanvasSubscribeInput = typeof CanvasSubscribeInput.Type;

const CanvasEventBaseFields = {
  threadId: ThreadId,
  /** Identifies the server process that emitted this event. */
  serverEpoch: TrimmedNonEmptyString,
  /** Monotonic server state revision shared with CanvasState. */
  revision: NonNegativeInt,
};

const CanvasSnapshotEvent = Schema.Struct({
  ...CanvasEventBaseFields,
  type: Schema.Literal("snapshot"),
  document: CanvasDocument,
  selectedNodeIds: Schema.Array(CanvasNodeId),
});

const CanvasAppliedEvent = Schema.Struct({
  ...CanvasEventBaseFields,
  type: Schema.Literal("applied"),
  ops: Schema.Array(CanvasOp),
  origin: Schema.Literals(["client", "agent"]),
});

const CanvasSelectionEvent = Schema.Struct({
  ...CanvasEventBaseFields,
  type: Schema.Literal("selection"),
  selectedNodeIds: Schema.Array(CanvasNodeId),
});

export const CanvasEvent = Schema.Union([
  CanvasSnapshotEvent,
  CanvasAppliedEvent,
  CanvasSelectionEvent,
]);
export type CanvasEvent = typeof CanvasEvent.Type;

export class CanvasRevisionConflictError extends Schema.TaggedErrorClass<CanvasRevisionConflictError>()(
  "CanvasRevisionConflictError",
  {
    threadId: ThreadId,
    baseRevision: NonNegativeInt,
    currentRevision: NonNegativeInt,
  },
) {
  override get message(): string {
    return `Canvas apply was based on revision ${this.baseRevision}, but the current revision is ${this.currentRevision}.`;
  }
}

export class CanvasNodeNotFoundError extends Schema.TaggedErrorClass<CanvasNodeNotFoundError>()(
  "CanvasNodeNotFoundError",
  {
    threadId: ThreadId,
    nodeId: CanvasNodeId,
  },
) {
  override get message(): string {
    return `Canvas node ${this.nodeId} was not found.`;
  }
}

export class CanvasInvalidOpError extends Schema.TaggedErrorClass<CanvasInvalidOpError>()(
  "CanvasInvalidOpError",
  {
    threadId: ThreadId,
    opIndex: NonNegativeInt,
    reason: Schema.String,
  },
) {
  override get message(): string {
    return `Canvas op at index ${this.opIndex} is invalid: ${this.reason}`;
  }
}

export class CanvasLimitExceededError extends Schema.TaggedErrorClass<CanvasLimitExceededError>()(
  "CanvasLimitExceededError",
  {
    threadId: ThreadId,
    limit: Schema.Literals(["nodes", "docBytes", "inkPoints", "ops", "imageBytes"]),
  },
) {
  override get message(): string {
    return `Canvas ${this.limit} limit was exceeded.`;
  }
}

export class CanvasImagePayloadError extends Schema.TaggedErrorClass<CanvasImagePayloadError>()(
  "CanvasImagePayloadError",
  {
    threadId: ThreadId,
    reason: Schema.Literals([
      "invalid-data-url",
      "not-an-image",
      "too-large",
      "attachment-not-found",
      "file-not-found",
      "path-outside-workspace",
      "attachment-id-unavailable",
    ]),
  },
) {
  override get message(): string {
    return `Canvas image payload was rejected (${this.reason}).`;
  }
}

export class CanvasPersistenceError extends Schema.TaggedErrorClass<CanvasPersistenceError>()(
  "CanvasPersistenceError",
  {
    threadId: ThreadId,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to persist the canvas for thread ${this.threadId}.`;
  }
}

export const CanvasError = Schema.Union([
  CanvasRevisionConflictError,
  CanvasNodeNotFoundError,
  CanvasInvalidOpError,
  CanvasLimitExceededError,
  CanvasImagePayloadError,
  CanvasPersistenceError,
]);
export type CanvasError = typeof CanvasError.Type;

export const isCanvasError = Schema.is(CanvasError);

export const CanvasAgentImageRef = Schema.Struct({
  nodeId: CanvasNodeId,
  attachmentId: CanvasAttachmentId,
  filePath: Schema.String.annotate({
    description: "Absolute path to the decoded image file. The agent may Read it directly.",
  }),
  naturalWidth: Schema.optional(PositiveInt),
  naturalHeight: Schema.optional(PositiveInt),
});
export type CanvasAgentImageRef = typeof CanvasAgentImageRef.Type;

export const CanvasAgentState = Schema.Struct({
  document: CanvasDocument,
  revision: NonNegativeInt,
  selectedNodeIds: Schema.Array(CanvasNodeId),
  /** One entry per image node, resolved to a readable file on disk. */
  images: Schema.Array(CanvasAgentImageRef),
});
export type CanvasAgentState = typeof CanvasAgentState.Type;

export const CanvasMutationResult = Schema.Struct({
  revision: PositiveInt,
  nodeId: Schema.optional(
    CanvasNodeId.annotate({
      description: "Node the mutation created, when it created one.",
    }),
  ),
});
export type CanvasMutationResult = typeof CanvasMutationResult.Type;
