import { ComputerUseError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { ComputerUseService } from "../../../computerUse/ComputerUseService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { ComputerUseToolkit } from "./tools.ts";

const invoke = <A>(
  action: (service: ComputerUseService["Service"]) => Effect.Effect<A, ComputerUseError>,
) =>
  Effect.gen(function* () {
    yield* McpInvocationContext.requireComputerUseCapability();
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
