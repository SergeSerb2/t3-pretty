import {
  ComputerActionResult,
  ComputerClickInput,
  ComputerKeyInput,
  ComputerMoveInput,
  ComputerScreenInfoInput,
  ComputerScreenInfoResult,
  ComputerScreenshotInput,
  ComputerScreenshotResult,
  ComputerScrollInput,
  ComputerTypeInput,
  ComputerUseError,
} from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/unstable/ai";

import { ComputerUseService } from "../../../computerUse/ComputerUseService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [McpInvocationContext.McpInvocationContext, ComputerUseService];

const computerTool = <T extends Tool.Any>(tool: T, destructive: boolean): T =>
  tool.annotate(Tool.OpenWorld, true).annotate(Tool.Destructive, destructive) as T;

export const ComputerScreenInfoTool = computerTool(
  Tool.make("computer_screen_info", {
    description:
      "Get the main display size in Quartz global display coordinates and its backing pixel scale. Use the returned coordinates directly; do not multiply them by scaleFactor.",
    parameters: ComputerScreenInfoInput,
    success: ComputerScreenInfoResult,
    failure: ComputerUseError,
    dependencies,
  }).annotate(Tool.Title, "Get screen information"),
  false,
);

export const ComputerScreenshotTool = computerTool(
  Tool.make("computer_screenshot", {
    description:
      "Capture a PNG screenshot of the main display or a region, normalized so one image pixel equals one Quartz coordinate unit. Returns its temporary path and dimensions; read it promptly because it expires after 10 minutes.",
    parameters: ComputerScreenshotInput,
    success: ComputerScreenshotResult,
    failure: ComputerUseError,
    dependencies,
  }).annotate(Tool.Title, "Capture a screenshot"),
  false,
);

export const ComputerClickTool = computerTool(
  Tool.make("computer_click", {
    description:
      "Click in Quartz global display coordinates. Take a screenshot before choosing coordinates and after to verify the result.",
    parameters: ComputerClickInput,
    success: ComputerActionResult,
    failure: ComputerUseError,
    dependencies,
  }).annotate(Tool.Title, "Click the mouse"),
  true,
);

export const ComputerMoveTool = computerTool(
  Tool.make("computer_move", {
    description: "Move the pointer in Quartz global display coordinates without clicking.",
    parameters: ComputerMoveInput,
    success: ComputerActionResult,
    failure: ComputerUseError,
    dependencies,
  }).annotate(Tool.Title, "Move the mouse pointer"),
  true,
);

export const ComputerTypeTool = computerTool(
  Tool.make("computer_type", {
    description: "Type text into the currently focused application as keyboard input.",
    parameters: ComputerTypeInput,
    success: ComputerActionResult,
    failure: ComputerUseError,
    dependencies,
  }).annotate(Tool.Title, "Type text"),
  true,
);

export const ComputerKeyTool = computerTool(
  Tool.make("computer_key", {
    description: "Press a special key with optional command, shift, option, or control modifiers.",
    parameters: ComputerKeyInput,
    success: ComputerActionResult,
    failure: ComputerUseError,
    dependencies,
  }).annotate(Tool.Title, "Press a key"),
  true,
);

export const ComputerScrollTool = computerTool(
  Tool.make("computer_scroll", {
    description:
      "Scroll in line units, optionally at a specific pointer position. Positive deltaY scrolls content up.",
    parameters: ComputerScrollInput,
    success: ComputerActionResult,
    failure: ComputerUseError,
    dependencies,
  }).annotate(Tool.Title, "Scroll"),
  true,
);

export const ComputerUseToolkit = Toolkit.make(
  ComputerScreenInfoTool,
  ComputerScreenshotTool,
  ComputerClickTool,
  ComputerMoveTool,
  ComputerTypeTool,
  ComputerKeyTool,
  ComputerScrollTool,
);
