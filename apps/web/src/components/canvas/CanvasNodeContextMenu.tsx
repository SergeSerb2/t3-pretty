"use client";

/**
 * Canvas node right-click actions and the rename popover they can open.
 * The menu itself goes through `localApi.contextMenu` so it uses the same
 * Electron/browser path as every other right-click in the app.
 */
import type { CanvasNode, ContextMenuItem } from "@t3tools/contracts";
import { useMemo, useRef } from "react";

import { Input } from "~/components/ui/input";
import { Popover, PopoverPopup } from "~/components/ui/popover";

export type CanvasNodeContextMenuAction =
  | "bring-to-front"
  | "send-to-back"
  | "recapture"
  | "rename"
  | "delete";

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

export function canvasNodeContextMenuItems(input: {
  nodeType: CanvasNode["type"];
  canRecapture: boolean;
}): ContextMenuItem<CanvasNodeContextMenuAction>[] {
  const items: ContextMenuItem<CanvasNodeContextMenuAction>[] = [
    { id: "bring-to-front", label: "Bring to front" },
    { id: "send-to-back", label: "Send to back" },
  ];
  if (input.canRecapture) {
    items.push({ id: "recapture", label: "Re-capture" });
  }
  if (RENAMEABLE_TYPES.has(input.nodeType)) {
    items.push({ id: "rename", label: "Rename…", icon: "pencil" });
  }
  items.push({ id: "delete", label: "Delete", destructive: true, icon: "trash" });
  return items;
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
