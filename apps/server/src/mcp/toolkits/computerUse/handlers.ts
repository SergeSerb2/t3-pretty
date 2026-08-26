import { ComputerUseError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { ComputerUseService } from "../../../computerUse/ComputerUseService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { ComputerUseToolkit } from "./tools.ts";

const requireComputerUse = Effect.fn("ComputerUseToolkit.requireComputerUse")(function* () {
  const invocation = yield* McpInvocationContext.McpInvocationContext;
  if (!invocation.capabilities.has("computer-use")) {
    return yield* new ComputerUseError({
      reason: "capability-unavailable",
      message: "This MCP credential does not grant computer control.",
    });
  }
});

const invoke = <A>(
  action: (service: ComputerUseService["Service"]) => Effect.Effect<A, ComputerUseError>,
) =>
  Effect.gen(function* () {
    yield* requireComputerUse();
    return yield* action(yield* ComputerUseService);
  });

export const computerUseToolkitHandlers = {
  computer_screen_info: () => invoke((service) => service.screenInfo()),
  computer_screenshot: (input) => invoke((service) => service.screenshot(input)),
  computer_click: (input) => invoke((service) => service.click(input)),
  computer_move: (input) => invoke((service) => service.move(input)),
  computer_type: (input) => invoke((service) => service.typeText(input)),
  computer_key: (input) => invoke((service) => service.pressKey(input)),
  computer_scroll: (input) => invoke((service) => service.scroll(input)),
} satisfies Parameters<typeof ComputerUseToolkit.toLayer>[0];

export const ComputerUseToolkitHandlersLive = ComputerUseToolkit.toLayer(
  computerUseToolkitHandlers,
);
