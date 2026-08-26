import {
  type ComputerActionResult,
  type ComputerScreenInfoResult,
  type ComputerScreenshotResult,
  ComputerUseError,
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ComputerUseService } from "../../../computerUse/ComputerUseService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { computerUseToolkitHandlers } from "./handlers.ts";

const makeScope = (
  capabilities: ReadonlySet<McpInvocationContext.McpCapability>,
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("env-test"),
  threadId: ThreadId.make("thread-computer-use"),
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities,
  issuedAt: 0,
});

interface ServiceCalls {
  readonly screenshots: Array<unknown>;
  readonly clicks: Array<unknown>;
  readonly moves: Array<unknown>;
  readonly types: Array<unknown>;
  readonly keys: Array<unknown>;
  readonly scrolls: Array<unknown>;
}

const makeComputerUseMock = () => {
  const calls: ServiceCalls = {
    screenshots: [],
    clicks: [],
    moves: [],
    types: [],
    keys: [],
    scrolls: [],
  };
  const ok: ComputerActionResult = { ok: true };
  const service = ComputerUseService.of({
    screenInfo: () =>
      Effect.succeed({
        screenWidth: 1512,
        screenHeight: 982,
        scaleFactor: 2,
      } satisfies ComputerScreenInfoResult),
    screenshot: (input) =>
      Effect.as(
        Effect.sync(() => void calls.screenshots.push(input)),
        { path: "/tmp/shot.png", width: 100, height: 80 } satisfies ComputerScreenshotResult,
      ),
    click: (input) =>
      Effect.as(
        Effect.sync(() => void calls.clicks.push(input)),
        ok,
      ),
    move: (input) =>
      Effect.as(
        Effect.sync(() => void calls.moves.push(input)),
        ok,
      ),
    typeText: (input) =>
      Effect.as(
        Effect.sync(() => void calls.types.push(input)),
        ok,
      ),
    pressKey: (input) =>
      Effect.as(
        Effect.sync(() => void calls.keys.push(input)),
        ok,
      ),
    scroll: (input) =>
      Effect.as(
        Effect.sync(() => void calls.scrolls.push(input)),
        ok,
      ),
  });
  return { calls, service };
};

const runHandler = <A>(
  effect: Effect.Effect<
    A,
    ComputerUseError,
    McpInvocationContext.McpInvocationContext | ComputerUseService
  >,
  input: {
    readonly scope?: McpInvocationContext.McpInvocationScope;
    readonly computerUse?: ComputerUseService["Service"];
  } = {},
) =>
  effect.pipe(
    Effect.provideService(
      McpInvocationContext.McpInvocationContext,
      input.scope ?? makeScope(new Set(["computer-use"])),
    ),
    Effect.provideService(ComputerUseService, input.computerUse ?? makeComputerUseMock().service),
  );

it.effect("rejects invocations without the computer-use capability", () =>
  Effect.gen(function* () {
    const { calls, service } = makeComputerUseMock();
    const error = yield* runHandler(computerUseToolkitHandlers.computer_click({ x: 1, y: 2 }), {
      scope: makeScope(new Set()),
      computerUse: service,
    }).pipe(Effect.flip);

    assert.isTrue(Schema.is(ComputerUseError)(error));
    assert.equal(error.reason, "capability-unavailable");
    assert.deepEqual(calls.clicks, []);
  }),
);

it.effect("delegates computer tools to the host service", () =>
  Effect.gen(function* () {
    const { calls, service } = makeComputerUseMock();
    const provide = { computerUse: service };

    assert.deepEqual(
      yield* runHandler(computerUseToolkitHandlers.computer_screen_info(), provide),
      { screenWidth: 1512, screenHeight: 982, scaleFactor: 2 },
    );
    const screenshotInput = { display: 2, region: { x: 1, y: 2, width: 3, height: 4 } };
    assert.deepEqual(
      yield* runHandler(computerUseToolkitHandlers.computer_screenshot(screenshotInput), provide),
      { path: "/tmp/shot.png", width: 100, height: 80 },
    );
    yield* runHandler(computerUseToolkitHandlers.computer_click({ x: 10, y: 20 }), provide);
    yield* runHandler(computerUseToolkitHandlers.computer_move({ x: 5, y: 6 }), provide);
    yield* runHandler(computerUseToolkitHandlers.computer_type({ text: "hello" }), provide);
    yield* runHandler(
      computerUseToolkitHandlers.computer_key({ key: "return", modifiers: ["command"] }),
      provide,
    );
    yield* runHandler(computerUseToolkitHandlers.computer_scroll({ deltaY: 3 }), provide);

    assert.deepEqual(calls, {
      screenshots: [screenshotInput],
      clicks: [{ x: 10, y: 20 }],
      moves: [{ x: 5, y: 6 }],
      types: [{ text: "hello" }],
      keys: [{ key: "return", modifiers: ["command"] }],
      scrolls: [{ deltaY: 3 }],
    });
  }),
);
