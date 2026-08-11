"use client";

/**
 * Right-click menu for a canvas node plus the small rename popover it can
 * open. Both are controlled and anchored to the pointer position through a
 * virtual anchor, so they work identically in the browser and in Electron.
 */
import type { CanvasNode } from "@t3tools/contracts";
import { ArrowDownToLine, ArrowUpToLine, Camera, PenLine, Trash2 } from "lucide-react";
import { useMemo, useRef } from "react";

import { Input } from "~/components/ui/input";
import { Menu, MenuItem, MenuPopup, MenuSeparator } from "~/components/ui/menu";
import { Popover, PopoverPopup } from "~/components/ui/popover";

export interface CanvasContextMenuRequest {
  nodeId: string;
  nodeType: CanvasNode["type"];
  x: number;
  y: number;
}

export interface CanvasRenameRequest {
  nodeId: string;
  initialName: string;
  x: number;
  y: number;
}

const RENAMEABLE_TYPES = new Set<CanvasNode["type"]>(["note", "frame", "image"]);

const pointAnchor = (x: number, y: number) => ({
  getBoundingClientRect: () => DOMRect.fromRect({ x, y, width: 0, height: 0 }),
});

export function CanvasNodeContextMenu(props: {
  request: CanvasContextMenuRequest | null;
  onClose: () => void;
  onBringToFront: (nodeId: string) => void;
  onSendToBack: (nodeId: string) => void;
  onRename: (request: CanvasContextMenuRequest) => void;
  onDelete: (nodeId: string) => void;
  /** True when the node records a capture origin this build can refresh. */
  canRecapture?: ((nodeId: string) => boolean) | undefined;
  onRecapture?: ((nodeId: string) => void) | undefined;
}) {
  const { request, onClose } = props;
  const anchor = useMemo(
    () => (request === null ? null : pointAnchor(request.x, request.y)),
    [request],
  );
  return (
    <Menu
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      modal={false}
    >
      <MenuPopup
        anchor={anchor ?? undefined}
        side="bottom"
        align="start"
        sideOffset={2}
        className="w-44"
      >
        <MenuItem
          onClick={() => {
            if (request !== null) props.onBringToFront(request.nodeId);
          }}
        >
          <ArrowUpToLine />
          Bring to front
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (request !== null) props.onSendToBack(request.nodeId);
          }}
        >
          <ArrowDownToLine />
          Send to back
        </MenuItem>
        {request !== null &&
        props.onRecapture !== undefined &&
        (props.canRecapture?.(request.nodeId) ?? false) ? (
          <MenuItem
            onClick={() => {
              if (request !== null) props.onRecapture?.(request.nodeId);
            }}
          >
            <Camera />
            Re-capture
          </MenuItem>
        ) : null}
        {request !== null && RENAMEABLE_TYPES.has(request.nodeType) ? (
          <MenuItem onClick={() => props.onRename(request)}>
            <PenLine />
            Rename…
          </MenuItem>
        ) : null}
        <MenuSeparator />
        <MenuItem
          variant="destructive"
          onClick={() => {
            if (request !== null) props.onDelete(request.nodeId);
          }}
        >
          <Trash2 />
          Delete
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

export function CanvasRenamePopover(props: {
  request: CanvasRenameRequest | null;
  onClose: () => void;
  onSubmit: (nodeId: string, name: string) => void;
}) {
  const { request, onClose } = props;
  const anchor = useMemo(
    () => (request === null ? null : pointAnchor(request.x, request.y)),
    [request],
  );
  const submittedRef = useRef(false);
  return (
    <Popover
      open={request !== null}
      onOpenChange={(open) => {
        if (open) {
          submittedRef.current = false;
          return;
        }
        onClose();
      }}
      modal={false}
    >
      <PopoverPopup
        anchor={anchor ?? undefined}
        side="bottom"
        align="start"
        sideOffset={4}
        className="w-56 p-2"
      >
        {request !== null ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (submittedRef.current) return;
              submittedRef.current = true;
              const data = new FormData(event.currentTarget);
              props.onSubmit(request.nodeId, String(data.get("name") ?? "").trim());
              onClose();
            }}
          >
            <Input
              autoFocus
              name="name"
              defaultValue={request.initialName}
              placeholder="Name"
              aria-label="Node name"
              className="h-7 text-sm"
            />
          </form>
        ) : null}
      </PopoverPopup>
    </Popover>
  );
}
