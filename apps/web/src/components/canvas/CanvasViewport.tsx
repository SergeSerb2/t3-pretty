"use client";

/**
 * Interactive infinite-canvas viewport.
 *
 * Owns the pan/zoom transform, the pointer gesture machine (select / move /
 * resize / marquee / ink / region / note), keyboard shortcuts, and the node
 * context menu. All coordinate math is delegated to the pure helpers in
 * canvasViewport.ts / canvasDocSync.ts; this component wires DOM events to the
 * canvas store. Gesture state lives in a ref and is mirrored into the store
 * once per animation frame, only when visual feedback needs a render.
 */
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  CANVAS_MAX_INK_POINTS,
  type CanvasDocument,
  type CanvasNode,
  type CanvasOp,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useDebouncedCallback } from "@tanstack/react-pacer";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from "react";

import {
  CANVAS_DEFAULT_NOTE_WIDTH,
  bringToFront,
  childrenOf,
  contentBounds,
  descendantIds,
  getNode,
  parentWorldOffset,
  pruneDescendantIds,
  sendToBack,
  worldRectOf,
  type CanvasMeasuredSizes,
} from "~/canvasDocSync";
import {
  selectThreadCanvasState,
  useCanvasStore,
  type CanvasGesture,
  type CanvasTool,
} from "~/canvasStore";
import {
  adaptiveGridStep,
  fitToContent,
  hitTestPoint,
  hitTestRect,
  rectFromPoints,
  screenToWorld,
  zoomAtPoint,
  zoomToScaleAtPoint,
  type CanvasPoint,
  type CanvasResizeHandle,
  type CanvasViewportTransform,
} from "~/canvasViewport";
import { randomUUID } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { canvasEnvironment } from "~/state/canvas";
import { useAtomCommand } from "~/state/use-atom-command";

import { CanvasJumpPillView } from "./CanvasJumpPill";
import { CanvasMeasuredSizesContext, createCanvasMeasuredSizesStore } from "./canvasMeasuredSizes";
import {
  canvasNodeContextMenuItems,
  CanvasRenamePopover,
  type CanvasRenameRequest,
} from "./CanvasNodeContextMenu";
import { resizeGesturePreviewRect } from "./canvasResizePreview";
import { CanvasSelectionBarAnchor } from "./CanvasSelectionBarAnchor";
import { CanvasSelectionOverlay } from "./CanvasSelectionOverlay";
import { normalizePoints } from "./canvasStroke";
import { CanvasNodeTree, type CanvasNodeRenderContext } from "./nodes/CanvasNodeView";
import type { CanvasInkStyle } from "./CanvasToolbar";

const CLICK_DRAG_THRESHOLD_PX = 3;
const ZOOM_STEP_FACTOR = 1.25;
const VIEWPORT_ANIMATION_MS = 200;
const REMOTE_HIGHLIGHT_MS = 1_200;
const JUMP_FIT_PADDING = 96;
/** Screen px an ink stroke must travel before another point is recorded. */
const INK_POINT_MIN_STEP_PX = 1.5;

const TOOL_SHORTCUTS: Record<string, CanvasTool> = {
  v: "select",
  h: "pan",
  p: "ink",
  r: "region",
  n: "note",
};

export interface CanvasViewportController {
  zoomIn: () => void;
  zoomOut: () => void;
  zoomTo: (scale: number) => void;
  zoomToFit: () => void;
  /** World point under the viewport center; where a capture should land. */
  worldCenter: () => CanvasPoint;
  /** Latest measured note sizes, for crop and bounds math outside the tree. */
  measuredSizes: () => CanvasMeasuredSizes;
  /** Select nodes AND report the selection to the server (agent context). */
  selectNodes: (ids: readonly string[]) => void;
}

/** Richer, ref-held sibling of the store's CanvasGesture. */
type PointerSession =
  | {
      kind: "pan";
      pointerId: number;
      lastScreen: CanvasPoint;
      startScreen: CanvasPoint;
      startViewport: CanvasViewportTransform;
    }
  | {
      kind: "maybe-move";
      pointerId: number;
      nodeId: string;
      startScreen: CanvasPoint;
      startWorld: CanvasPoint;
      additive: boolean;
      wasSelected: boolean;
    }
  | {
      kind: "move";
      pointerId: number;
      nodeIds: string[];
      startWorld: CanvasPoint;
      currentWorld: CanvasPoint;
      startPositions: Record<string, CanvasPoint>;
    }
  | {
      kind: "resize";
      pointerId: number;
      nodeId: string;
      nodeType: CanvasNode["type"];
      handle: CanvasResizeHandle;
      startWorld: CanvasPoint;
      currentWorld: CanvasPoint;
      startRect: { x: number; y: number; width: number; height: number };
      aspectLocked: boolean;
    }
  | {
      kind: "maybe-marquee";
      pointerId: number;
      startScreen: CanvasPoint;
      startWorld: CanvasPoint;
      additive: boolean;
    }
  | {
      kind: "marquee";
      pointerId: number;
      startWorld: CanvasPoint;
      currentWorld: CanvasPoint;
      additive: boolean;
    }
  | { kind: "ink"; pointerId: number; points: CanvasPoint[]; color: string; strokeWidth: number }
  | { kind: "region"; pointerId: number; startWorld: CanvasPoint; currentWorld: CanvasPoint };

function gestureFromSession(session: PointerSession): CanvasGesture | null {
  switch (session.kind) {
    case "pan":
      return {
        kind: "pan",
        startScreen: session.startScreen,
        startViewport: session.startViewport,
      };
    case "move":
      return {
        kind: "move",
        nodeIds: session.nodeIds,
        startWorld: session.startWorld,
        currentWorld: session.currentWorld,
        startPositions: session.startPositions,
      };
    case "resize":
      return {
        kind: "resize",
        nodeId: session.nodeId,
        handle: session.handle,
        startWorld: session.startWorld,
        currentWorld: session.currentWorld,
        startRect: session.startRect,
        aspectLocked: session.aspectLocked,
      };
    case "marquee":
      return {
        kind: "marquee",
        startWorld: session.startWorld,
        currentWorld: session.currentWorld,
        additive: session.additive,
      };
    case "ink":
      return {
        kind: "ink",
        points: [...session.points],
        color: session.color,
        strokeWidth: session.strokeWidth,
      };
    case "region":
      return { kind: "region", startWorld: session.startWorld, currentWorld: session.currentWorld };
    case "maybe-move":
    case "maybe-marquee":
      return null;
  }
}

export function CanvasViewport(props: {
  threadRef: ScopedThreadRef;
  doc: CanvasDocument;
  inkStyle: CanvasInkStyle;
  controllerRef?: Ref<CanvasViewportController | null>;
  /** Re-capture an image node from the origin it recorded (desktop only). */
  onRecaptureNode?: ((nodeId: string) => void) | undefined;
  canRecaptureNode?: ((nodeId: string) => boolean) | undefined;
  /** Rendered over the selection when one exists and no gesture is running. */
  renderSelectionBar?: ((input: { selectedIds: readonly string[] }) => ReactNode) | undefined;
}) {
  const { doc, inkStyle } = props;
  const { environmentId, threadId } = props.threadRef;
  const threadRef: ScopedThreadRef = { environmentId, threadId };

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [measuredStore] = useState(createCanvasMeasuredSizesStore);
  const sessionRef = useRef<PointerSession | null>(null);
  const gestureRafRef = useRef<number | null>(null);
  const viewportPendingRef = useRef<CanvasViewportTransform | null>(null);
  const viewportRafRef = useRef<number | null>(null);
  const animationRef = useRef<number | null>(null);
  const spaceHeldRef = useRef(false);
  const pinchStartScaleRef = useRef<number | null>(null);
  const autoFitKeyRef = useRef<string | null>(null);

  const [spaceHeld, setSpaceHeld] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [renameRequest, setRenameRequest] = useState<CanvasRenameRequest | null>(null);

  const viewport = useCanvasStore(
    (state) => selectThreadCanvasState(state.byThreadKey, threadRef).viewport,
  );
  const tool = useCanvasStore(
    (state) => selectThreadCanvasState(state.byThreadKey, threadRef).tool,
  );
  const gestureKind = useCanvasStore(
    (state) => selectThreadCanvasState(state.byThreadKey, threadRef).gesture?.kind ?? null,
  );
  const recentRemoteNodeIds = useCanvasStore(
    (state) => selectThreadCanvasState(state.byThreadKey, threadRef).recentRemoteNodeIds,
  );
  const jumpPill = useCanvasStore(
    (state) => selectThreadCanvasState(state.byThreadKey, threadRef).jumpPill,
  );
  const localImagePreviews = useCanvasStore(
    (state) => selectThreadCanvasState(state.byThreadKey, threadRef).localImagePreviews,
  );
  const hasSnapshot = useCanvasStore(
    (state) => selectThreadCanvasState(state.byThreadKey, threadRef).serverDoc !== null,
  );

  const runUpdateSelection = useAtomCommand(canvasEnvironment.updateSelection, {
    reportFailure: false,
  });
  const syncSelection = useDebouncedCallback(
    (ids: readonly string[]) => {
      void runUpdateSelection({
        environmentId,
        input: { threadId, selectedNodeIds: [...ids] },
      });
    },
    { wait: 300 },
  );

  // ---- store access helpers (handlers/effects only) -------------------------

  const threadState = () =>
    selectThreadCanvasState(useCanvasStore.getState().byThreadKey, threadRef);

  const commitOps = (ops: readonly CanvasOp[]): void => {
    useCanvasStore.getState().commitLocalOps(threadRef, ops);
  };

  const applySelection = (ids: readonly string[]): void => {
    if (useCanvasStore.getState().setSelection(threadRef, ids)) syncSelection(ids);
  };

  // ---- viewport transform plumbing ------------------------------------------

  const currentTransform = (): CanvasViewportTransform =>
    viewportPendingRef.current ?? threadState().viewport;

  const cancelViewportAnimation = (): void => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  };

  /** RAF-batched viewport update; wheel bursts collapse into one render. */
  const applyViewportUpdate = (
    updater: (current: CanvasViewportTransform) => CanvasViewportTransform,
  ): void => {
    cancelViewportAnimation();
    viewportPendingRef.current = updater(currentTransform());
    if (viewportRafRef.current !== null) return;
    viewportRafRef.current = requestAnimationFrame(() => {
      viewportRafRef.current = null;
      const pending = viewportPendingRef.current;
      viewportPendingRef.current = null;
      if (pending !== null) useCanvasStore.getState().setViewport(threadRef, pending);
    });
  };

  const viewportSize = (): { width: number; height: number } => {
    const element = containerRef.current;
    return element !== null
      ? { width: element.clientWidth, height: element.clientHeight }
      : { width: 800, height: 600 };
  };

  /** rAF lerp of the store viewport; transform transitions would blur text. */
  const animateViewportTo = (target: CanvasViewportTransform): void => {
    cancelViewportAnimation();
    viewportPendingRef.current = null;
    const from = threadState().viewport;
    const startTime = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - startTime) / VIEWPORT_ANIMATION_MS);
      const eased = 1 - (1 - t) ** 3;
      useCanvasStore.getState().setViewport(threadRef, {
        tx: from.tx + (target.tx - from.tx) * eased,
        ty: from.ty + (target.ty - from.ty) * eased,
        scale: from.scale + (target.scale - from.scale) * eased,
      });
      animationRef.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    animationRef.current = requestAnimationFrame(step);
  };

  const viewportCenter = (): CanvasPoint => {
    const size = viewportSize();
    return { x: size.width / 2, y: size.height / 2 };
  };

  const zoomByFactor = (factor: number): void => {
    const current = threadState().viewport;
    animateViewportTo(zoomToScaleAtPoint(current, viewportCenter(), current.scale * factor));
  };

  const zoomToFit = (): void => {
    const bounds = contentBounds(doc, measuredStore.getSnapshot());
    animateViewportTo(fitToContent(bounds, viewportSize()));
  };

  useImperativeHandle(props.controllerRef, () => ({
    zoomIn: () => zoomByFactor(ZOOM_STEP_FACTOR),
    zoomOut: () => zoomByFactor(1 / ZOOM_STEP_FACTOR),
    zoomTo: (scale: number) => {
      animateViewportTo(zoomToScaleAtPoint(threadState().viewport, viewportCenter(), scale));
    },
    zoomToFit,
    worldCenter: () => screenToWorld(threadState().viewport, viewportCenter()),
    measuredSizes: () => measuredStore.getSnapshot(),
    selectNodes: applySelection,
  }));

  // ---- gesture mirroring ----------------------------------------------------

  const mirrorGesture = (): void => {
    if (gestureRafRef.current !== null) return;
    gestureRafRef.current = requestAnimationFrame(() => {
      gestureRafRef.current = null;
      const session = sessionRef.current;
      useCanvasStore
        .getState()
        .setGesture(threadRef, session !== null ? gestureFromSession(session) : null);
    });
  };

  const clearSession = (): void => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (gestureRafRef.current !== null) {
      cancelAnimationFrame(gestureRafRef.current);
      gestureRafRef.current = null;
    }
    useCanvasStore.getState().setGesture(threadRef, null);
    if (session !== null) {
      try {
        containerRef.current?.releasePointerCapture(session.pointerId);
      } catch {
        // Capture may already be gone.
      }
    }
  };

  // ---- geometry helpers -----------------------------------------------------

  const screenPointOf = (event: { clientX: number; clientY: number }): CanvasPoint => {
    const element = containerRef.current;
    if (element === null) return { x: event.clientX, y: event.clientY };
    const rect = element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const hitOptionsFor = (scale: number) => ({
    measuredSizes: measuredStore.getSnapshot(),
    tolerance: 8 / scale,
    frameLabelBand: 20 / scale,
  });

  // ---- wheel + Safari pinch -------------------------------------------------

  useEffect(() => {
    const element = containerRef.current;
    if (element === null) return;
    const onWheel = (event: WheelEvent): void => {
      // Always ours: stops browser page zoom and history swipes.
      event.preventDefault();
      const lineFactor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1;
      if (event.ctrlKey || event.metaKey) {
        const point = screenPointOf(event);
        applyViewportUpdate((current) => zoomAtPoint(current, point, event.deltaY * lineFactor));
        return;
      }
      applyViewportUpdate((current) => ({
        ...current,
        tx: current.tx - event.deltaX * lineFactor,
        ty: current.ty - event.deltaY * lineFactor,
      }));
    };
    // Safari trackpad pinch arrives as proprietary gesture events.
    const onGestureStart = (event: Event): void => {
      event.preventDefault();
      pinchStartScaleRef.current = currentTransform().scale;
    };
    const onGestureChange = (event: Event): void => {
      event.preventDefault();
      const startScale = pinchStartScaleRef.current;
      const gestureEvent = event as Event & { scale?: number; clientX?: number; clientY?: number };
      if (startScale === null || typeof gestureEvent.scale !== "number") return;
      const point = screenPointOf({
        clientX: gestureEvent.clientX ?? 0,
        clientY: gestureEvent.clientY ?? 0,
      });
      applyViewportUpdate((current) =>
        zoomToScaleAtPoint(current, point, startScale * gestureEvent.scale!),
      );
    };
    const onGestureEnd = (event: Event): void => {
      event.preventDefault();
      pinchStartScaleRef.current = null;
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("gesturestart", onGestureStart);
    element.addEventListener("gesturechange", onGestureChange);
    element.addEventListener("gestureend", onGestureEnd);
    return () => {
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("gesturestart", onGestureStart);
      element.removeEventListener("gesturechange", onGestureChange);
      element.removeEventListener("gestureend", onGestureEnd);
    };
  }, [applyViewportUpdate, currentTransform, screenPointOf]);

  // ---- pointer machine ------------------------------------------------------

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button === 2) return; // handled by onContextMenu
    const element = containerRef.current;
    if (element === null || sessionRef.current !== null) return;
    element.focus({ preventScroll: true });
    cancelViewportAnimation();

    const transform = currentTransform();
    const scale = transform.scale;
    const screen = screenPointOf(event);
    const world = screenToWorld(transform, screen);
    const store = useCanvasStore.getState();

    const beginSession = (session: PointerSession): void => {
      sessionRef.current = session;
      element.setPointerCapture(event.pointerId);
    };

    const panIntent = event.button === 1 || tool === "pan" || spaceHeldRef.current;
    if (panIntent && (event.button === 0 || event.button === 1)) {
      beginSession({
        kind: "pan",
        pointerId: event.pointerId,
        lastScreen: screen,
        startScreen: screen,
        startViewport: transform,
      });
      store.setGesture(threadRef, {
        kind: "pan",
        startScreen: screen,
        startViewport: transform,
      });
      return;
    }
    if (event.button !== 0) return;

    if (tool === "ink") {
      beginSession({
        kind: "ink",
        pointerId: event.pointerId,
        points: [world],
        color: inkStyle.color,
        strokeWidth: inkStyle.strokeWidth,
      });
      store.setGesture(threadRef, {
        kind: "ink",
        points: [world],
        color: inkStyle.color,
        strokeWidth: inkStyle.strokeWidth,
      });
      return;
    }
    if (tool === "region") {
      beginSession({
        kind: "region",
        pointerId: event.pointerId,
        startWorld: world,
        currentWorld: world,
      });
      mirrorGesture();
      return;
    }
    if (tool === "note") {
      const id = randomUUID();
      commitOps([
        {
          _tag: "add",
          node: {
            id,
            type: "note",
            text: "",
            x: world.x,
            y: world.y,
            width: CANVAS_DEFAULT_NOTE_WIDTH,
          },
        },
      ]);
      applySelection([id]);
      setEditingNoteId(id);
      store.setTool(threadRef, "select");
      return;
    }

    // Select tool. Resize handles live in the screen-space overlay.
    const handleElement =
      event.target instanceof Element ? event.target.closest("[data-canvas-handle]") : null;
    if (handleElement instanceof HTMLElement) {
      const nodeId = handleElement.dataset["nodeId"];
      const handle = handleElement.dataset["canvasHandle"] as CanvasResizeHandle | undefined;
      const node = nodeId !== undefined ? getNode(doc, nodeId) : null;
      const startRect =
        nodeId !== undefined ? worldRectOf(doc, nodeId, measuredStore.getSnapshot()) : null;
      if (node !== null && startRect !== null && handle !== undefined) {
        beginSession({
          kind: "resize",
          pointerId: event.pointerId,
          nodeId: node.id,
          nodeType: node.type,
          handle,
          startWorld: world,
          currentWorld: world,
          startRect,
          aspectLocked: node.type === "image" && !event.shiftKey,
        });
        mirrorGesture();
        return;
      }
    }

    const hit = hitTestPoint(doc, world, hitOptionsFor(scale));
    if (hit !== null) {
      const selectedNodeIds = threadState().selectedNodeIds;
      const wasSelected = selectedNodeIds.includes(hit.id);
      if (!wasSelected) {
        applySelection(event.shiftKey ? [...selectedNodeIds, hit.id] : [hit.id]);
      }
      beginSession({
        kind: "maybe-move",
        pointerId: event.pointerId,
        nodeId: hit.id,
        startScreen: screen,
        startWorld: world,
        additive: event.shiftKey,
        wasSelected,
      });
      return;
    }
    beginSession({
      kind: "maybe-marquee",
      pointerId: event.pointerId,
      startScreen: screen,
      startWorld: world,
      additive: event.shiftKey,
    });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const session = sessionRef.current;
    if (session === null || event.pointerId !== session.pointerId) return;
    const screen = screenPointOf(event);
    switch (session.kind) {
      case "pan": {
        const dx = screen.x - session.lastScreen.x;
        const dy = screen.y - session.lastScreen.y;
        session.lastScreen = screen;
        applyViewportUpdate((current) => ({
          ...current,
          tx: current.tx + dx,
          ty: current.ty + dy,
        }));
        return;
      }
      case "maybe-move": {
        if (
          Math.hypot(screen.x - session.startScreen.x, screen.y - session.startScreen.y) <
          CLICK_DRAG_THRESHOLD_PX
        ) {
          return;
        }
        const selectedNodeIds = threadState().selectedNodeIds;
        const baseIds = selectedNodeIds.includes(session.nodeId)
          ? selectedNodeIds
          : [session.nodeId];
        const nodeIds = pruneDescendantIds(doc, baseIds);
        const startPositions: Record<string, CanvasPoint> = {};
        for (const id of nodeIds) {
          const node = getNode(doc, id);
          if (node !== null) startPositions[id] = { x: node.x, y: node.y };
        }
        sessionRef.current = {
          kind: "move",
          pointerId: session.pointerId,
          nodeIds,
          startWorld: session.startWorld,
          currentWorld: screenToWorld(currentTransform(), screen),
          startPositions,
        };
        mirrorGesture();
        return;
      }
      case "move":
      case "region": {
        session.currentWorld = screenToWorld(currentTransform(), screen);
        mirrorGesture();
        return;
      }
      case "resize": {
        session.currentWorld = screenToWorld(currentTransform(), screen);
        if (session.nodeType === "image") session.aspectLocked = !event.shiftKey;
        mirrorGesture();
        return;
      }
      case "maybe-marquee": {
        if (
          Math.hypot(screen.x - session.startScreen.x, screen.y - session.startScreen.y) <
          CLICK_DRAG_THRESHOLD_PX
        ) {
          return;
        }
        sessionRef.current = {
          kind: "marquee",
          pointerId: session.pointerId,
          startWorld: session.startWorld,
          currentWorld: screenToWorld(currentTransform(), screen),
          additive: session.additive,
        };
        mirrorGesture();
        return;
      }
      case "marquee": {
        session.currentWorld = screenToWorld(currentTransform(), screen);
        mirrorGesture();
        return;
      }
      case "ink": {
        const transform = currentTransform();
        const world = screenToWorld(transform, screen);
        const last = session.points[session.points.length - 1];
        if (
          last !== undefined &&
          Math.hypot(world.x - last.x, world.y - last.y) * transform.scale < INK_POINT_MIN_STEP_PX
        ) {
          return;
        }
        if (session.points.length < CANVAS_MAX_INK_POINTS) session.points.push(world);
        mirrorGesture();
        return;
      }
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const session = sessionRef.current;
    if (session === null || event.pointerId !== session.pointerId) return;
    const transform = currentTransform();
    const scale = transform.scale;
    const world = screenToWorld(transform, screenPointOf(event));

    switch (session.kind) {
      case "pan":
        break;
      case "maybe-move": {
        // Click without drag: collapse (or shift-toggle) an already-selected node.
        if (session.wasSelected) {
          const selectedNodeIds = threadState().selectedNodeIds;
          applySelection(
            session.additive
              ? selectedNodeIds.filter((id) => id !== session.nodeId)
              : [session.nodeId],
          );
        }
        break;
      }
      case "move": {
        const dx = world.x - session.startWorld.x;
        const dy = world.y - session.startWorld.y;
        if (dx !== 0 || dy !== 0) {
          const ops = session.nodeIds.flatMap((id): CanvasOp[] => {
            const start = session.startPositions[id];
            if (start === undefined) return [];
            return [{ _tag: "update", id, patch: { x: start.x + dx, y: start.y + dy } }];
          });
          commitOps(ops);
        }
        break;
      }
      case "resize": {
        const node = getNode(doc, session.nodeId);
        if (node !== null) {
          const rect = resizeGesturePreviewRect(
            {
              kind: "resize",
              nodeId: session.nodeId,
              handle: session.handle,
              startWorld: session.startWorld,
              currentWorld: world,
              startRect: session.startRect,
              aspectLocked: session.aspectLocked,
            },
            node,
          );
          const offset = parentWorldOffset(doc, node);
          const patch =
            node.type === "note"
              ? { x: rect.x - offset.x, width: rect.width }
              : {
                  x: rect.x - offset.x,
                  y: rect.y - offset.y,
                  width: rect.width,
                  height: rect.height,
                };
          commitOps([{ _tag: "update", id: session.nodeId, patch }]);
        }
        break;
      }
      case "maybe-marquee": {
        if (!session.additive) applySelection([]);
        break;
      }
      case "marquee": {
        const rect = rectFromPoints(session.startWorld, world);
        const ids = hitTestRect(doc, rect, { measuredSizes: measuredStore.getSnapshot() });
        if (session.additive) {
          const merged = [...threadState().selectedNodeIds];
          for (const id of ids) if (!merged.includes(id)) merged.push(id);
          applySelection(merged);
        } else {
          applySelection(ids);
        }
        break;
      }
      case "ink": {
        const { points, origin } = normalizePoints(session.points);
        if (points.length > 0) {
          commitOps([
            {
              _tag: "add",
              node: {
                id: randomUUID(),
                type: "ink",
                x: origin.x,
                y: origin.y,
                points,
                color: session.color,
                strokeWidth: session.strokeWidth,
              },
            },
          ]);
        }
        break;
      }
      case "region": {
        const rect = rectFromPoints(session.startWorld, world);
        if (rect.width * scale >= 8 && rect.height * scale >= 8) {
          commitOps([
            {
              _tag: "add",
              node: {
                id: randomUUID(),
                type: "region",
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
              },
            },
          ]);
        }
        break;
      }
    }
    clearSession();
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const session = sessionRef.current;
    if (session === null || event.pointerId !== session.pointerId) return;
    clearSession();
  };

  // ---- clicks ---------------------------------------------------------------

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (tool !== "select" && tool !== "pan") return;
    const transform = threadState().viewport;
    const screen = screenPointOf(event);
    const world = screenToWorld(transform, screen);
    const hit = hitTestPoint(doc, world, hitOptionsFor(transform.scale));
    if (hit !== null) {
      if (hit.type === "note" && tool === "select") {
        applySelection([hit.id]);
        setEditingNoteId(hit.id);
      }
      return;
    }
    // Empty space: toggle between 100% at the cursor and fit-to-content.
    if (Math.abs(transform.scale - 1) > 0.05) {
      animateViewportTo(zoomToScaleAtPoint(transform, screen, 1));
      return;
    }
    const bounds = contentBounds(doc, measuredStore.getSnapshot());
    if (bounds !== null) animateViewportTo(fitToContent(bounds, viewportSize()));
  };

  const onContextMenu = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const transform = threadState().viewport;
    const world = screenToWorld(transform, screenPointOf(event));
    const hit = hitTestPoint(doc, world, hitOptionsFor(transform.scale));
    if (hit === null) return;
    if (!threadState().selectedNodeIds.includes(hit.id)) applySelection([hit.id]);

    const api = readLocalApi();
    if (api === undefined) return;
    const position = { x: event.clientX, y: event.clientY };
    const canRecapture =
      props.onRecaptureNode !== undefined && (props.canRecaptureNode?.(hit.id) ?? false);
    void api.contextMenu
      .show(canvasNodeContextMenuItems({ nodeType: hit.type, canRecapture }), position)
      .then((action) => {
        if (action === "bring-to-front") {
          commitOps(bringToFront(doc, [hit.id]));
          return;
        }
        if (action === "send-to-back") {
          commitOps(sendToBack(doc, [hit.id]));
          return;
        }
        if (action === "recapture") {
          props.onRecaptureNode?.(hit.id);
          return;
        }
        if (action === "rename") {
          const node = getNode(doc, hit.id);
          setRenameRequest({
            nodeId: hit.id,
            initialName: node?.name ?? "",
            x: position.x,
            y: position.y,
          });
          return;
        }
        if (action === "delete") {
          const removed = new Set([hit.id, ...descendantIds(doc, hit.id)]);
          commitOps([{ _tag: "remove", id: hit.id }]);
          applySelection(threadState().selectedNodeIds.filter((id) => !removed.has(id)));
        }
      })
      .catch(() => {
        // Same as other right-click menus: a failed show already ate the gesture.
      });
  };

  // ---- keyboard -------------------------------------------------------------

  const removeSelection = (): void => {
    const targets = pruneDescendantIds(doc, threadState().selectedNodeIds);
    if (targets.length === 0) return;
    commitOps(targets.map((id): CanvasOp => ({ _tag: "remove", id })));
    applySelection([]);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest("input, textarea, [contenteditable]") !== null
    ) {
      return;
    }
    const meta = event.metaKey || event.ctrlKey;
    const key = event.key;
    if (meta && key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) useCanvasStore.getState().redo(threadRef);
      else useCanvasStore.getState().undo(threadRef);
      return;
    }
    if (meta && key === "0") {
      event.preventDefault();
      zoomToFit();
      return;
    }
    if (meta && (key === "=" || key === "+")) {
      event.preventDefault();
      zoomByFactor(ZOOM_STEP_FACTOR);
      return;
    }
    if (meta && (key === "-" || key === "_")) {
      event.preventDefault();
      zoomByFactor(1 / ZOOM_STEP_FACTOR);
      return;
    }
    if (meta) return;
    if (key === "Escape") {
      if (sessionRef.current !== null) {
        event.preventDefault();
        clearSession();
        return;
      }
      if (threadState().selectedNodeIds.length > 0) {
        event.preventDefault();
        applySelection([]);
      }
      return;
    }
    if (key === "Delete" || key === "Backspace") {
      event.preventDefault();
      removeSelection();
      return;
    }
    if (key === " ") {
      event.preventDefault();
      if (!spaceHeldRef.current) {
        spaceHeldRef.current = true;
        setSpaceHeld(true);
      }
      return;
    }
    if (event.altKey) return;
    const toolForKey = TOOL_SHORTCUTS[key.toLowerCase()];
    if (toolForKey !== undefined) {
      useCanvasStore.getState().setTool(threadRef, toolForKey);
    }
  };

  const onKeyUp = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === " ") {
      spaceHeldRef.current = false;
      setSpaceHeld(false);
    }
  };

  const onBlur = (): void => {
    spaceHeldRef.current = false;
    setSpaceHeld(false);
  };

  // ---- note editing ---------------------------------------------------------

  const handleNoteEditCommit = (nodeId: string, text: string): void => {
    setEditingNoteId((current) => (current === nodeId ? null : current));
    const node = getNode(doc, nodeId);
    if (node === null || node.type !== "note") return;
    if (node.text === "" && text.trim() === "") {
      // A fresh note abandoned empty leaves no residue.
      commitOps([{ _tag: "remove", id: nodeId }]);
      applySelection(threadState().selectedNodeIds.filter((id) => id !== nodeId));
      return;
    }
    if (text !== node.text) {
      commitOps([{ _tag: "update", id: nodeId, patch: { text } }]);
    }
    containerRef.current?.focus({ preventScroll: true });
  };

  const handleNoteEditCancel = (nodeId: string): void => {
    setEditingNoteId((current) => (current === nodeId ? null : current));
    const node = getNode(doc, nodeId);
    if (node !== null && node.type === "note" && node.text === "") {
      commitOps([{ _tag: "remove", id: nodeId }]);
      applySelection(threadState().selectedNodeIds.filter((id) => id !== nodeId));
    }
    containerRef.current?.focus({ preventScroll: true });
  };

  const handleRenameSubmit = (nodeId: string, name: string): void => {
    const node = getNode(doc, nodeId);
    if (node === null) return;
    if (name === (node.name ?? "")) return;
    commitOps([{ _tag: "update", id: nodeId, patch: { name } }]);
  };

  // ---- jump pill ------------------------------------------------------------

  const handleJump = (): void => {
    const pill = threadState().jumpPill;
    if (pill === null) return;
    animateViewportTo(fitToContent(pill.bounds, viewportSize(), JUMP_FIT_PADDING));
    useCanvasStore.getState().dismissJumpPill(threadRef);
  };

  const handleDismissJumpPill = (): void => {
    useCanvasStore.getState().dismissJumpPill(threadRef);
  };

  // ---- effects --------------------------------------------------------------

  useEffect(() => {
    return () => {
      void readLocalApi()?.contextMenu.close();
    };
  }, [environmentId, threadId]);

  // Expire remote-add highlights shortly after the oldest one ages out.
  useEffect(() => {
    if (recentRemoteNodeIds.length === 0) return;
    const oldestAt = recentRemoteNodeIds.reduce(
      (oldest, entry) => Math.min(oldest, entry.at),
      Number.POSITIVE_INFINITY,
    );
    const delay = Math.max(0, oldestAt + REMOTE_HIGHLIGHT_MS - Date.now()) + 32;
    const timer = setTimeout(() => {
      useCanvasStore.getState().clearRecentRemote(threadRef, REMOTE_HIGHLIGHT_MS);
    }, delay);
    return () => clearTimeout(timer);
  }, [recentRemoteNodeIds, threadRef]);

  // Fit existing content once per thread when the first snapshot lands and the
  // viewport is still at its identity default.
  useEffect(() => {
    if (!hasSnapshot) return;
    const key = scopedThreadKey(threadRef);
    if (autoFitKeyRef.current === key) return;
    autoFitKeyRef.current = key;
    const state = threadState();
    const { tx, ty, scale } = state.viewport;
    if (tx !== 0 || ty !== 0 || scale !== 1 || doc.nodes.length === 0) return;
    const bounds = contentBounds(doc, measuredStore.getSnapshot());
    if (bounds !== null) {
      useCanvasStore.getState().setViewport(threadRef, fitToContent(bounds, viewportSize()));
    }
  }, [hasSnapshot, doc, threadRef, measuredStore, threadState, viewportSize]);

  // Cancel outstanding animation frames on unmount.
  useEffect(
    () => () => {
      if (gestureRafRef.current !== null) cancelAnimationFrame(gestureRafRef.current);
      if (viewportRafRef.current !== null) cancelAnimationFrame(viewportRafRef.current);
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    },
    [],
  );

  // ---- render ---------------------------------------------------------------

  const cursor =
    gestureKind === "pan"
      ? "grabbing"
      : tool === "pan" || spaceHeld
        ? "grab"
        : tool === "ink" || tool === "region"
          ? "crosshair"
          : tool === "note"
            ? "copy"
            : "default";

  const gridStep = adaptiveGridStep(viewport.scale);
  const labelScale = Math.min(8, Math.max(0.125, 1 / viewport.scale));

  const renderCtx: CanvasNodeRenderContext = {
    threadRef,
    environmentId,
    doc,
    remoteRecentIds: new Set(recentRemoteNodeIds.map((entry) => entry.id)),
    localImagePreviews,
    editingNoteId,
    onNoteEditCommit: handleNoteEditCommit,
    onNoteEditCancel: handleNoteEditCancel,
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="application"
      aria-label="Canvas"
      className="relative h-full min-h-0 flex-1 select-none overflow-hidden outline-none"
      style={{
        contain: "strict",
        touchAction: "none",
        cursor,
        backgroundImage:
          "radial-gradient(circle, color-mix(in srgb, var(--color-foreground) 10%, transparent) 1px, transparent 1px)",
        backgroundSize: `${gridStep}px ${gridStep}px`,
        backgroundPosition: `${viewport.tx % gridStep}px ${viewport.ty % gridStep}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={onBlur}
      onMouseDown={(event) => {
        // Middle-click autoscroll would fight the pan gesture.
        if (event.button === 1) event.preventDefault();
      }}
    >
      <div
        className="pointer-events-none absolute top-0 left-0 will-change-transform"
        style={
          {
            transform: `translate3d(${viewport.tx}px, ${viewport.ty}px, 0) scale(${viewport.scale})`,
            transformOrigin: "0 0",
            "--canvas-label-scale": `${labelScale}`,
          } as CSSProperties
        }
      >
        <CanvasMeasuredSizesContext value={measuredStore}>
          <CanvasNodeTree nodes={childrenOf(doc, null)} ctx={renderCtx} />
        </CanvasMeasuredSizesContext>
      </div>
      <CanvasSelectionOverlay
        threadRef={threadRef}
        doc={doc}
        viewport={viewport}
        measuredStore={measuredStore}
      />
      {props.renderSelectionBar !== undefined ? (
        <CanvasSelectionBarAnchor
          threadRef={threadRef}
          doc={doc}
          viewport={viewport}
          measuredStore={measuredStore}
          render={props.renderSelectionBar}
        />
      ) : null}
      {jumpPill !== null ? (
        <CanvasJumpPillView pill={jumpPill} onJump={handleJump} onDismiss={handleDismissJumpPill} />
      ) : null}
      <CanvasRenamePopover
        request={renameRequest}
        onClose={() => setRenameRequest(null)}
        onSubmit={handleRenameSubmit}
      />
    </div>
  );
}
