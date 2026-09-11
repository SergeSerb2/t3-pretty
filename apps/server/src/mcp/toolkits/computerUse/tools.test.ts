import { expect, it } from "@effect/vitest";
import { Tool } from "effect/unstable/ai";

import { ComputerUseToolkit } from "./tools.ts";

it("registers the complete native computer-control surface with safe annotations", () => {
  expect(Object.keys(ComputerUseToolkit.tools)).toEqual([
    "computer_screen_info",
    "computer_screenshot",
    "computer_click",
    "computer_move",
    "computer_type",
    "computer_key",
    "computer_scroll",
  ]);

  expect(Tool.getJsonSchema(ComputerUseToolkit.tools.computer_click).type).toBe("object");
  expect(
    Tool.getJsonSchemaFromSchema(ComputerUseToolkit.tools.computer_screenshot.successSchema).type,
  ).toBe("object");
});
