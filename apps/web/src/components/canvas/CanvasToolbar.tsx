"use client";

/**
 * Floating canvas toolbar: tool switcher, contextual ink style controls,
 * undo/redo, and the zoom menu. `captureSlot` / `selectionSlot` are reserved
 * mount points for the capture and add-to-chat workstreams.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Hand, MousePointer2, Pen, Redo2, SquareDashed, StickyNote, Undo2 } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import { selectThreadCanvasState, useCanvasStore, type CanvasTool } from "~/canvasStore";
import { Button } from "~/components/ui/button";
import { Kbd } from "~/components/ui/kbd";
import { Menu, MenuItem, MenuPopup, MenuShortcut, MenuTrigger } from "~/components/ui/menu";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

export interface CanvasInkStyle {
  color: string;
  strokeWidth: number;
}

export const CANVAS_INK_COLORS: readonly { id: string; value: string; label: string }[] = [
  { id: "accent", value: "#4f46e5", label: "Indigo" },
  { id: "red", value: "#ef4444", label: "Red" },
  { id: "amber", value: "#f59e0b", label: "Amber" },
  { id: "green", value: "#22c55e", label: "Green" },
  { id: "sky", value: "#0ea5e9", label: "Sky" },
  // Adapts to the theme foreground wherever the stroke renders.
  { id: "ink", value: "currentColor", label: "Ink" },
];

export const CANVAS_INK_WIDTHS: readonly { id: string; value: number; label: string }[] = [
  { id: "s", value: 2, label: "Thin" },
  { id: "m", value: 4, label: "Medium" },
  { id: "l", value: 7, label: "Thick" },
];

export const DEFAULT_CANVAS_INK_STYLE: CanvasInkStyle = {
  color: CANVAS_INK_COLORS[0]!.value,
  strokeWidth: CANVAS_INK_WIDTHS[1]!.value,
};

const TOOLS: readonly {
  tool: CanvasTool;
  label: string;
  shortcut: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { tool: "select", label: "Select", shortcut: "V", icon: MousePointer2 },
  { tool: "pan", label: "Pan", shortcut: "H", icon: Hand },
  { tool: "ink", label: "Draw", shortcut: "P", icon: Pen },
  { tool: "region", label: "Region", shortcut: "R", icon: SquareDashed },
  { tool: "note", label: "Note", shortcut: "N", icon: StickyNote },
];

const ZOOM_LEVELS = [0.5, 1, 2] as const;

function ToolbarDivider() {
  return <div aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-border" />;
}

export function CanvasToolbar(props: {
  threadRef: ScopedThreadRef;
  inkStyle: CanvasInkStyle;
  onInkStyleChange: (style: CanvasInkStyle) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomToFit: () => void;
  onZoomTo: (scale: number) => void;
  /** Reserved slot for the capture menu workstream. */
  captureSlot?: ReactNode;
  /** Reserved slot for the selection ("Add to chat") workstream. */
  selectionSlot?: ReactNode;
}) {
  const { threadRef } = props;
  const tool = useCanvasStore(
    (state) => selectThreadCanvasState(state.byThreadKey, threadRef).tool,
  );
  const canUndo = useCanvasStore(
    (state) => selectThreadCanvasState(state.byThreadKey, threadRef).undoStack.length > 0,
  );
  const canRedo = useCanvasStore(
    (state) => selectThreadCanvasState(state.byThreadKey, threadRef).redoStack.length > 0,
  );
  const scale = useCanvasStore(
    (state) => selectThreadCanvasState(state.byThreadKey, threadRef).viewport.scale,
  );

  return (
    <div className="pointer-events-none absolute top-3 left-1/2 z-30 flex w-full -translate-x-1/2 justify-center px-3">
      <div className="pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-xl border border-border/80 bg-card/95 p-1 shadow-lg/5 backdrop-blur-md dark:border-transparent dark:shadow-none dark:inset-ring-1 dark:inset-ring-white/10">
        <ToggleGroup
          value={[tool]}
          onValueChange={(groupValue) => {
            const next = groupValue[0];
            if (typeof next === "string") {
              useCanvasStore.getState().setTool(threadRef, next as CanvasTool);
            }
          }}
          aria-label="Canvas tools"
        >
          {TOOLS.map((entry) => {
            const Icon = entry.icon;
            return (
              <Tooltip key={entry.tool}>
                <TooltipTrigger
                  render={
                    <Toggle value={entry.tool} size="xs" aria-label={entry.label}>
                      <Icon className="size-3.5" />
                    </Toggle>
                  }
                />
                <TooltipPopup side="bottom">
                  <span className="inline-flex items-center gap-1.5">
                    {entry.label}
                    <Kbd className="bg-transparent">{entry.shortcut}</Kbd>
                  </span>
                </TooltipPopup>
              </Tooltip>
            );
          })}
        </ToggleGroup>

        {tool === "ink" ? (
          <>
            <ToolbarDivider />
            <div className="flex items-center gap-1 px-0.5" role="group" aria-label="Ink color">
              {CANVAS_INK_COLORS.map((color) => (
                <button
                  key={color.id}
                  type="button"
                  aria-label={`${color.label} ink`}
                  aria-pressed={props.inkStyle.color === color.value}
                  onClick={() => props.onInkStyleChange({ ...props.inkStyle, color: color.value })}
                  className={cn(
                    "cursor-pointer rounded-full p-0.5 ring-1 transition-shadow",
                    props.inkStyle.color === color.value
                      ? "ring-primary"
                      : "ring-transparent hover:ring-border",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "block size-3.5 rounded-full",
                      color.value === "currentColor" && "bg-foreground",
                    )}
                    style={
                      color.value === "currentColor" ? undefined : { backgroundColor: color.value }
                    }
                  />
                </button>
              ))}
            </div>
            <div className="flex items-center gap-0.5" role="group" aria-label="Stroke width">
              {CANVAS_INK_WIDTHS.map((width) => (
                <Tooltip key={width.id}>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={`${width.label} stroke`}
                        aria-pressed={props.inkStyle.strokeWidth === width.value}
                        onClick={() =>
                          props.onInkStyleChange({ ...props.inkStyle, strokeWidth: width.value })
                        }
                        className={cn(
                          "flex size-6 cursor-pointer items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent",
                          props.inkStyle.strokeWidth === width.value && "bg-input/64",
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className="rounded-full bg-current"
                          style={{ width: width.value + 2, height: width.value + 2 }}
                        />
                      </button>
                    }
                  />
                  <TooltipPopup side="bottom">{width.label}</TooltipPopup>
                </Tooltip>
              ))}
            </div>
          </>
        ) : null}

        <ToolbarDivider />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Undo"
                disabled={!canUndo}
                onClick={() => useCanvasStore.getState().undo(threadRef)}
              >
                <Undo2 />
              </Button>
            }
          />
          <TooltipPopup side="bottom">
            <span className="inline-flex items-center gap-1.5">
              Undo
              <Kbd className="bg-transparent">⌘Z</Kbd>
            </span>
          </TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Redo"
                disabled={!canRedo}
                onClick={() => useCanvasStore.getState().redo(threadRef)}
              >
                <Redo2 />
              </Button>
            }
          />
          <TooltipPopup side="bottom">
            <span className="inline-flex items-center gap-1.5">
              Redo
              <Kbd className="bg-transparent">⇧⌘Z</Kbd>
            </span>
          </TooltipPopup>
        </Tooltip>

        <ToolbarDivider />
        <Menu>
          <MenuTrigger
            render={
              <Button variant="ghost" size="xs" aria-label="Zoom" className="min-w-12 tabular-nums">
                {Math.round(scale * 100)}%
              </Button>
            }
          />
          <MenuPopup side="bottom" align="center" className="w-44">
            <MenuItem onClick={props.onZoomIn}>
              Zoom in
              <MenuShortcut>⌘+</MenuShortcut>
            </MenuItem>
            <MenuItem onClick={props.onZoomOut}>
              Zoom out
              <MenuShortcut>⌘−</MenuShortcut>
            </MenuItem>
            <MenuItem onClick={props.onZoomToFit}>
              Zoom to fit
              <MenuShortcut>⌘0</MenuShortcut>
            </MenuItem>
            {ZOOM_LEVELS.map((level) => (
              <MenuItem key={level} onClick={() => props.onZoomTo(level)}>
                {Math.round(level * 100)}%
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>

        {props.captureSlot !== undefined && props.captureSlot !== null ? (
          <>
            <ToolbarDivider />
            {props.captureSlot}
          </>
        ) : null}
        {props.selectionSlot !== undefined && props.selectionSlot !== null ? (
          <>
            <ToolbarDivider />
            {props.selectionSlot}
          </>
        ) : null}
      </div>
    </div>
  );
}
