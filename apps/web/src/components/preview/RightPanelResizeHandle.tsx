import type { ResizableWidthHandlers } from "~/hooks/useResizableWidth";
import { cn } from "~/lib/utils";

interface Props {
  handlers: ResizableWidthHandlers;
  width: number;
  minWidth: number;
  maxWidth: number;
  className?: string;
}

/**
 * Hit target for resizing a right-anchored panel via its left edge.
 *
 * - Sits on top of the panel's border with a 4px overlap on each side so the
 *   user can grab a few pixels off the edge without aiming.
 * - Visual indicator is a 1px line that lights up on hover/active to mirror
 *   VS Code / Cursor.
 */
export function RightPanelResizeHandle({ handlers, width, minWidth, maxWidth, className }: Props) {
  return (
    <div
      role="separator"
      aria-label="Resize panel"
      aria-orientation="vertical"
      aria-valuemax={maxWidth}
      aria-valuemin={minWidth}
      aria-valuenow={width}
      tabIndex={0}
      className={cn(
        "group absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize select-none focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-1",
        className,
      )}
      {...handlers}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors duration-150 group-hover:bg-border group-focus-visible:bg-primary/60 group-active:bg-primary/60"
      />
    </div>
  );
}
