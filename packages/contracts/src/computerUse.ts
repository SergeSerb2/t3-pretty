/**
 * Computer-use contracts: cross-provider host automation tool schemas.
 *
 * The MCP tools defined here are exposed to opted-in provider sessions through
 * the in-house `t3-code-computer` MCP server (toolkit lives in
 * `apps/server/src/mcp/toolkits/computerUse/`, host automation in
 * `apps/server/src/computerUse/`).
 *
 * Keep this module schema-only; the runtime lives in `apps/server`.
 */
import * as Schema from "effect/Schema";

export const ComputerUseErrorReason = Schema.Literals([
  "capability-unavailable",
  "unsupported-platform",
  "action-failed",
]);
export type ComputerUseErrorReason = typeof ComputerUseErrorReason.Type;

export class ComputerUseError extends Schema.TaggedErrorClass<ComputerUseError>()(
  "ComputerUseError",
  {
    reason: ComputerUseErrorReason,
    message: Schema.String,
  },
) {}

const QuartzCoordinate = Schema.Number.annotate({
  description:
    "Coordinate in Quartz global display space, origin at the top-left of the main display. Use screen-info coordinates directly; do not multiply by scaleFactor.",
});

export const ComputerScreenInfoInput = Schema.Struct({});
export type ComputerScreenInfoInput = typeof ComputerScreenInfoInput.Type;

export const ComputerScreenInfoResult = Schema.Struct({
  screenWidth: Schema.Number.annotate({
    description: "Main display width in Quartz global display coordinates.",
  }),
  screenHeight: Schema.Number.annotate({
    description: "Main display height in Quartz global display coordinates.",
  }),
  scaleFactor: Schema.Number.annotate({
    description:
      "Native backing pixel scale. Computer screenshots are normalized to Quartz coordinates, so do not apply it to input coordinates.",
  }),
});
export type ComputerScreenInfoResult = typeof ComputerScreenInfoResult.Type;

export const ComputerScreenshotRegion = Schema.Struct({
  x: QuartzCoordinate,
  y: QuartzCoordinate,
  width: Schema.Int.check(Schema.isGreaterThan(0)),
  height: Schema.Int.check(Schema.isGreaterThan(0)),
});
export type ComputerScreenshotRegion = typeof ComputerScreenshotRegion.Type;

export const ComputerScreenshotInput = Schema.Struct({
  display: Schema.optional(
    Schema.Literal(1).annotate({
      description: "Main display selector. Defaults to 1 and cannot be combined with region.",
      default: 1,
    }),
  ),
  region: Schema.optional(
    ComputerScreenshotRegion.annotate({
      description:
        "Optional screen region in Quartz global display coordinates. Cannot be combined with display.",
    }),
  ),
}).check(
  Schema.makeFilter(
    (input) =>
      input.display === undefined ||
      input.region === undefined ||
      "Screenshot capture accepts either display or region, not both.",
  ),
);
export type ComputerScreenshotInput = typeof ComputerScreenshotInput.Type;

export const ComputerScreenshotResult = Schema.Struct({
  path: Schema.String.annotate({
    description:
      "Absolute path of the captured PNG. Read/view it promptly; the temporary file expires after 10 minutes.",
  }),
  width: Schema.Number.annotate({
    description: "Image width in normalized pixels; one pixel is one Quartz coordinate unit.",
  }),
  height: Schema.Number.annotate({
    description: "Image height in normalized pixels; one pixel is one Quartz coordinate unit.",
  }),
});
export type ComputerScreenshotResult = typeof ComputerScreenshotResult.Type;

export const ComputerMouseButton = Schema.Literals(["left", "right", "middle"]);
export type ComputerMouseButton = typeof ComputerMouseButton.Type;

export const ComputerClickInput = Schema.Struct({
  x: QuartzCoordinate,
  y: QuartzCoordinate,
  button: Schema.optional(
    ComputerMouseButton.annotate({ description: "Mouse button to click.", default: "left" }),
  ),
  clickCount: Schema.optional(
    Schema.Literals([1, 2]).annotate({
      description: "1 for a single click, 2 for a double click.",
      default: 1,
    }),
  ),
});
export type ComputerClickInput = typeof ComputerClickInput.Type;

export const ComputerMoveInput = Schema.Struct({
  x: QuartzCoordinate,
  y: QuartzCoordinate,
});
export type ComputerMoveInput = typeof ComputerMoveInput.Type;

export const ComputerTypeInput = Schema.Struct({
  text: Schema.String.annotate({
    description: "Text to type as keyboard input, exactly as if the user typed it.",
  }),
});
export type ComputerTypeInput = typeof ComputerTypeInput.Type;

export const ComputerKeyName = Schema.Literals([
  "return",
  "tab",
  "space",
  "delete",
  "escape",
  "leftArrow",
  "rightArrow",
  "downArrow",
  "upArrow",
  "home",
  "end",
  "pageUp",
  "pageDown",
]);
export type ComputerKeyName = typeof ComputerKeyName.Type;

export const ComputerKeyModifier = Schema.Literals(["command", "shift", "option", "control"]);
export type ComputerKeyModifier = typeof ComputerKeyModifier.Type;

export const ComputerKeyInput = Schema.Struct({
  key: ComputerKeyName,
  modifiers: Schema.optional(
    Schema.Array(ComputerKeyModifier).annotate({
      description: 'Modifier keys held while pressing the key (e.g. ["command"] for Cmd+key).',
    }),
  ),
});
export type ComputerKeyInput = typeof ComputerKeyInput.Type;

export const ComputerScrollInput = Schema.Struct({
  deltaY: Schema.Int.annotate({
    description:
      "Vertical scroll amount in line units. Positive values scroll the content up (wheel down); negative values scroll content down (wheel up).",
  }),
  deltaX: Schema.optional(
    Schema.Int.annotate({
      description: "Horizontal scroll amount in line units. Defaults to 0.",
      default: 0,
    }),
  ),
  x: Schema.optional(
    QuartzCoordinate.annotate({
      description:
        "Optional pointer x position to scroll at. Supply x and y together; omit both to use the current pointer.",
    }),
  ),
  y: Schema.optional(
    QuartzCoordinate.annotate({
      description:
        "Optional pointer y position to scroll at. Supply x and y together; omit both to use the current pointer.",
    }),
  ),
}).check(
  Schema.makeFilter(
    (input) =>
      (input.x === undefined) === (input.y === undefined) ||
      "Scroll location requires both x and y coordinates.",
  ),
);
export type ComputerScrollInput = typeof ComputerScrollInput.Type;

export const ComputerActionResult = Schema.Struct({
  ok: Schema.Literal(true),
});
export type ComputerActionResult = typeof ComputerActionResult.Type;
