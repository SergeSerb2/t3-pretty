"use client";

/**
 * Recursive world-space node renderer for the canvas surface.
 *
 * `CanvasNodeTree` maps sibling nodes in document (z-) order; frames recurse
 * through their children so DOM paint order matches `hitTestPoint` traversal.
 * Each `CanvasNodeView` subscribes to the store only for gestures that involve
 * its own node, so pan/zoom and other nodes' drags never re-render it.
 */
import type {
  CanvasDocument,
  CanvasNode,
  EnvironmentId,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { useEffect, useState } from "react";

import {
  CANVAS_DEFAULT_NOTE_WIDTH,
  childrenOf,
  localRectOf,
  parentWorldOffset,
} from "~/canvasDocSync";
import { selectThreadCanvasState, useCanvasStore } from "~/canvasStore";
import { cn } from "~/lib/utils";

import { resizeGesturePreviewRect } from "../canvasResizePreview";
import { CanvasFrameNodeView } from "./CanvasFrameNode";
import { CanvasImageNodeView } from "./CanvasImageNode";
import { CanvasInkNodeView } from "./CanvasInkNode";
import { CanvasNoteNodeView } from "./CanvasNoteNode";
import { CanvasRegionNodeView } from "./CanvasRegionNode";

export interface CanvasNodeRenderContext {
  threadRef: ScopedThreadRef;
  environmentId: EnvironmentId;
  doc: CanvasDocument;
  /** Nodes recently added by the agent; wrappers flash a fading ring. */
  remoteRecentIds: ReadonlySet<string>;
  localImagePreviews: Record<string, string>;
  editingNoteId: string | null;
  onNoteEditCommit: (nodeId: string, text: string) => void;
  onNoteEditCancel: (nodeId: string) => void;
}

export function CanvasNodeTree(props: {
  nodes: readonly CanvasNode[];
  ctx: CanvasNodeRenderContext;
}) {
  return (
    <>
      {props.nodes.map((node) => (
        <CanvasNodeView key={node.id} node={node} ctx={props.ctx} />
      ))}
    </>
  );
}

function CanvasNodeView({ node, ctx }: { node: CanvasNode; ctx: CanvasNodeRenderContext }) {
  const { threadRef } = ctx;
  const moveGesture = useCanvasStore((state) => {
    const gesture = selectThreadCanvasState(state.byThreadKey, threadRef).gesture;
    return gesture !== null && gesture.kind === "move" && gesture.nodeIds.includes(node.id)
      ? gesture
      : null;
  });
  const resizeGesture = useCanvasStore((state) => {
    const gesture = selectThreadCanvasState(state.byThreadKey, threadRef).gesture;
    return gesture !== null && gesture.kind === "resize" && gesture.nodeId === node.id
      ? gesture
      : null;
  });

  let position = { x: node.x, y: node.y };
  let sizeOverride: { width: number; height: number } | null = null;
  if (resizeGesture !== null) {
    const world = resizeGesturePreviewRect(resizeGesture, node);
    const offset = parentWorldOffset(ctx.doc, node);
    position = { x: world.x - offset.x, y: world.y - offset.y };
    sizeOverride = { width: world.width, height: world.height };
  }
  const moveDelta =
    moveGesture !== null
      ? {
          x: moveGesture.currentWorld.x - moveGesture.startWorld.x,
          y: moveGesture.currentWorld.y - moveGesture.startWorld.y,
        }
      : null;

  return (
    <div
      data-node-id={node.id}
      className="absolute"
      style={{
        left: position.x,
        top: position.y,
        ...(moveDelta !== null
          ? { transform: `translate(${moveDelta.x}px, ${moveDelta.y}px)`, willChange: "transform" }
          : {}),
      }}
    >
      <CanvasNodeContent node={node} ctx={ctx} sizeOverride={sizeOverride} />
      {ctx.remoteRecentIds.has(node.id) ? <CanvasRemoteHighlight node={node} /> : null}
    </div>
  );
}

function CanvasNodeContent({
  node,
  ctx,
  sizeOverride,
}: {
  node: CanvasNode;
  ctx: CanvasNodeRenderContext;
  sizeOverride: { width: number; height: number } | null;
}) {
  switch (node.type) {
    case "frame": {
      const size = sizeOverride ?? { width: node.width, height: node.height };
      return (
        <CanvasFrameNodeView node={node} size={size}>
          <CanvasNodeTree nodes={childrenOf(ctx.doc, node.id)} ctx={ctx} />
        </CanvasFrameNodeView>
      );
    }
    case "image": {
      const size = sizeOverride ?? { width: node.width, height: node.height };
      return (
        <CanvasImageNodeView
          node={node}
          environmentId={ctx.environmentId}
          localPreviewUrl={ctx.localImagePreviews[node.id] ?? null}
          size={size}
        />
      );
    }
    case "ink":
      return <CanvasInkNodeView node={node} />;
    case "region": {
      const size = sizeOverride ?? { width: node.width, height: node.height };
      return <CanvasRegionNodeView node={node} size={size} />;
    }
    case "note":
      return (
        <CanvasNoteNodeView
          node={node}
          width={sizeOverride?.width ?? node.width ?? CANVAS_DEFAULT_NOTE_WIDTH}
          editing={ctx.editingNoteId === node.id}
          onEditCommit={ctx.onNoteEditCommit}
          onEditCancel={ctx.onNoteEditCancel}
        />
      );
  }
}

/** Fading accent ring around a node the agent just added. */
function CanvasRemoteHighlight({ node }: { node: CanvasNode }) {
  const [faded, setFaded] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setFaded(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  const local = localRectOf(node);
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute rounded-md ring-2 ring-primary/70 transition-opacity duration-1000 ease-out",
        faded ? "opacity-0" : "opacity-100",
      )}
      style={{
        left: local.x - node.x - 3,
        top: local.y - node.y - 3,
        width: local.width + 6,
        height: local.height + 6,
      }}
    />
  );
}
