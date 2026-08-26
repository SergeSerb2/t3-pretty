// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalTimers:off - screenshot paths must expire independently of request scope.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";

import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import {
  type ComputerActionResult,
  type ComputerClickInput,
  type ComputerKeyInput,
  type ComputerKeyModifier,
  type ComputerKeyName,
  type ComputerMoveInput,
  ComputerScreenInfoResult,
  type ComputerScreenshotInput,
  type ComputerScreenshotResult,
  type ComputerScrollInput,
  type ComputerTypeInput,
  ComputerUseError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";

/**
 * ComputerUseService — macOS host automation behind the cross-provider
 * `computer_*` MCP tools.
 *
 * Every action shells out to a macOS system binary (`screencapture`, `sips`,
 * `osascript`) through the injectable {@link ComputerUseExecutor}
 * so tests can record argv and return canned output without spawning real
 * processes. All dynamic values travel as argv entries (never interpolated
 * into script source) except values drawn from closed enums (mouse button,
 * key modifiers), which are mapped to fixed script fragments here.
 */

export interface ComputerUseCommandInput {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly timeout?: Duration.Input | undefined;
}

export interface ComputerUseCommandOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

export class ComputerUseExecutor extends Context.Service<
  ComputerUseExecutor,
  {
    readonly run: (
      input: ComputerUseCommandInput,
    ) => Effect.Effect<ComputerUseCommandOutput, ComputerUseError>;
  }
>()("t3/computerUse/ComputerUseService/ComputerUseExecutor") {}

const makeExecutor = Effect.gen(function* () {
  const processRunner = yield* ProcessRunner.ProcessRunner;

  const run = Effect.fn("ComputerUseExecutor.run")(function* (input: ComputerUseCommandInput) {
    const result = yield* processRunner
      .run({
        command: input.command,
        args: input.args,
        ...(input.timeout !== undefined ? { timeout: input.timeout } : {}),
        timeoutBehavior: "error",
      })
      .pipe(
        Effect.mapError(
          (error) =>
            new ComputerUseError({
              reason: "action-failed",
              message: error.message,
            }),
        ),
      );

    if (result.code !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || "no output";
      return yield* new ComputerUseError({
        reason: "action-failed",
        message: `'${input.command}' exited with code ${result.code ?? "unknown"}: ${detail}`,
      });
    }

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code,
    } satisfies ComputerUseCommandOutput;
  });

  return ComputerUseExecutor.of({ run });
});

export const ComputerUseExecutorLive = Layer.effect(ComputerUseExecutor, makeExecutor);

export class ComputerUseService extends Context.Service<
  ComputerUseService,
  {
    readonly screenInfo: () => Effect.Effect<ComputerScreenInfoResult, ComputerUseError>;
    readonly screenshot: (
      input: ComputerScreenshotInput,
    ) => Effect.Effect<ComputerScreenshotResult, ComputerUseError>;
    readonly click: (
      input: ComputerClickInput,
    ) => Effect.Effect<ComputerActionResult, ComputerUseError>;
    readonly move: (
      input: ComputerMoveInput,
    ) => Effect.Effect<ComputerActionResult, ComputerUseError>;
    readonly typeText: (
      input: ComputerTypeInput,
    ) => Effect.Effect<ComputerActionResult, ComputerUseError>;
    readonly pressKey: (
      input: ComputerKeyInput,
    ) => Effect.Effect<ComputerActionResult, ComputerUseError>;
    readonly scroll: (
      input: ComputerScrollInput,
    ) => Effect.Effect<ComputerActionResult, ComputerUseError>;
  }
>()("t3/computerUse/ComputerUseService") {}

const KEY_CODES: Record<ComputerKeyName, number> = {
  return: 36,
  tab: 48,
  space: 49,
  delete: 51,
  escape: 53,
  leftArrow: 123,
  rightArrow: 124,
  downArrow: 125,
  upArrow: 126,
  home: 115,
  end: 119,
  pageUp: 116,
  pageDown: 121,
};

const MODIFIER_TOKENS: Record<ComputerKeyModifier, string> = {
  command: "command down",
  shift: "shift down",
  option: "option down",
  control: "control down",
};

const SCREEN_INFO_SCRIPT =
  'ObjC.import("AppKit"); ObjC.import("CoreGraphics"); var s = $.NSScreen.mainScreen; var f = $.CGDisplayBounds($.CGMainDisplayID()); JSON.stringify({ screenWidth: Number(f.size.width), screenHeight: Number(f.size.height), scaleFactor: Number(s.backingScaleFactor) })';

export const COMPUTER_SCREENSHOT_TTL_MS = 10 * 60_000;

export const scheduleScreenshotCleanup = (
  path: string,
  delayMs = COMPUTER_SCREENSHOT_TTL_MS,
): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => {
      NodeFS.rm(path, { force: true }, () => resolve());
    }, delayMs);
    timer.unref();
  });

const removeScreenshot = (path: string): Effect.Effect<void> =>
  Effect.promise(() => NodeFS.promises.rm(path, { force: true }).catch(() => undefined));

const MOUSE_CLICK_SCRIPT = `function run(argv) {
  ObjC.import("CoreGraphics");
  var point = $.CGPointMake(Number(argv[0]), Number(argv[1]));
  var button = argv[2];
  var clickCount = parseInt(argv[3], 10);
  var downType = $.kCGEventLeftMouseDown;
  var upType = $.kCGEventLeftMouseUp;
  var cgButton = $.kCGMouseButtonLeft;
  if (button === "right") {
    downType = $.kCGEventRightMouseDown;
    upType = $.kCGEventRightMouseUp;
    cgButton = $.kCGMouseButtonRight;
  } else if (button === "middle") {
    downType = $.kCGEventOtherMouseDown;
    upType = $.kCGEventOtherMouseUp;
    cgButton = $.kCGMouseButtonCenter;
  }
  var down = $.CGEventCreateMouseEvent(null, downType, point, cgButton);
  $.CGEventSetIntegerValueField(down, $.kCGMouseEventClickState, clickCount);
  $.CGEventPost($.kCGHIDEventTap, down);
  var up = $.CGEventCreateMouseEvent(null, upType, point, cgButton);
  $.CGEventSetIntegerValueField(up, $.kCGMouseEventClickState, clickCount);
  $.CGEventPost($.kCGHIDEventTap, up);
}`;

const MOUSE_MOVE_SCRIPT = `function run(argv) {
  ObjC.import("CoreGraphics");
  var point = $.CGPointMake(Number(argv[0]), Number(argv[1]));
  var event = $.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, point, $.kCGMouseButtonLeft);
  $.CGEventPost($.kCGHIDEventTap, event);
}`;

const SCROLL_SCRIPT = `function run(argv) {
  ObjC.import("CoreGraphics");
  var event = $.CGEventCreateScrollWheelEvent(null, $.kCGScrollEventUnitLine, 2, parseInt(argv[0], 10), parseInt(argv[1], 10));
  if (argv[2] !== "" && argv[3] !== "") {
    $.CGEventSetLocation(event, $.CGPointMake(Number(argv[2]), Number(argv[3])));
  }
  $.CGEventPost($.kCGHIDEventTap, event);
}`;

/**
 * AppleScript argv style: the text travels strictly as `item 1 of argv` and is
 * never interpolated into the script source, so quotes/newlines/unicode in the
 * payload cannot break or inject into the script.
 */
const TYPE_TEXT_SCRIPT = `on run argv
  tell application "System Events" to keystroke (item 1 of argv)
end run`;

const keyCodeScript = (modifiers: ReadonlyArray<ComputerKeyModifier>): string => {
  const keyCodeExpression = "key code ((item 1 of argv) as integer)";
  const statement =
    modifiers.length === 0
      ? keyCodeExpression
      : `${keyCodeExpression} using {${modifiers.map((modifier) => MODIFIER_TOKENS[modifier]).join(", ")}}`;
  return `on run argv
  tell application "System Events" to ${statement}
end run`;
};

const formatCoordinate = (value: number): string => String(value);

const requireFiniteCoordinates = (
  values: ReadonlyArray<readonly [string, number]>,
): Effect.Effect<void, ComputerUseError> => {
  for (const [name, value] of values) {
    if (!Number.isFinite(value)) {
      return Effect.fail(
        new ComputerUseError({
          reason: "action-failed",
          message: `Coordinate '${name}' must be a finite number, received ${String(value)}.`,
        }),
      );
    }
  }
  return Effect.void;
};

const ScreenInfoJson = Schema.fromJsonString(ComputerScreenInfoResult);

export const make = Effect.gen(function* () {
  const executor = yield* ComputerUseExecutor;
  const platform = yield* HostProcessPlatform;

  const requireDarwin = Effect.fn("ComputerUseService.requireDarwin")(function* () {
    if (platform !== "darwin") {
      return yield* new ComputerUseError({
        reason: "unsupported-platform",
        message: `Computer use actions are only supported on macOS (current platform: ${platform}).`,
      });
    }
  });

  const runJxa = (script: string, args: ReadonlyArray<string>) =>
    executor.run({ command: "osascript", args: ["-l", "JavaScript", "-e", script, "--", ...args] });

  const runAppleScript = (script: string, args: ReadonlyArray<string>) =>
    executor.run({ command: "osascript", args: ["-e", script, "--", ...args] });

  const screenInfo = Effect.fn("ComputerUseService.screenInfo")(function* () {
    yield* requireDarwin();
    const result = yield* executor.run({
      command: "osascript",
      args: ["-l", "JavaScript", "-e", SCREEN_INFO_SCRIPT],
    });
    return yield* Schema.decodeUnknownEffect(ScreenInfoJson)(result.stdout).pipe(
      Effect.mapError(
        () =>
          new ComputerUseError({
            reason: "action-failed",
            message: `Could not parse screen info output: ${result.stdout.trim()}`,
          }),
      ),
    );
  });

  const screenshot = Effect.fn("ComputerUseService.screenshot")(function* (
    input: ComputerScreenshotInput,
  ) {
    yield* requireDarwin();
    // Keep the dedicated screenshot write primitive confined to the OS temp
    // directory; callers can copy the returned file with their normal tools.
    const screenshotPath = `${NodeOS.tmpdir()}/t3code-screenshot-${NodeCrypto.randomUUID()}.png`;
    const result = yield* Effect.gen(function* () {
      const captureArgs = ["-x"];
      if (input.display !== undefined && input.region !== undefined) {
        return yield* new ComputerUseError({
          reason: "action-failed",
          message: "Screenshot capture accepts either display or region, not both.",
        });
      }
      if (input.region !== undefined) {
        const { x, y, width, height } = input.region;
        yield* requireFiniteCoordinates([
          ["x", x],
          ["y", y],
          ["width", width],
          ["height", height],
        ]);
        captureArgs.push(
          "-R",
          `${formatCoordinate(x)},${formatCoordinate(y)},${formatCoordinate(width)},${formatCoordinate(height)}`,
        );
      } else {
        captureArgs.push("-D", String(input.display ?? 1));
      }
      captureArgs.push(screenshotPath);
      yield* executor.run({ command: "screencapture", args: captureArgs });

      const sips = yield* executor.run({
        command: "sips",
        args: ["-g", "pixelWidth", "-g", "pixelHeight", screenshotPath],
      });
      const widthMatch = sips.stdout.match(/pixelWidth:\s*(\d+)/);
      const heightMatch = sips.stdout.match(/pixelHeight:\s*(\d+)/);
      if (!widthMatch || !heightMatch) {
        return yield* new ComputerUseError({
          reason: "action-failed",
          message: `Could not parse screenshot dimensions from sips output: ${sips.stdout.trim()}`,
        });
      }
      return {
        path: screenshotPath,
        width: Number.parseInt(widthMatch[1] ?? "0", 10),
        height: Number.parseInt(heightMatch[1] ?? "0", 10),
      } satisfies ComputerScreenshotResult;
    }).pipe(Effect.tapError(() => removeScreenshot(screenshotPath)));

    yield* Effect.sync(() => {
      void scheduleScreenshotCleanup(screenshotPath);
    });
    return result;
  });

  const click = Effect.fn("ComputerUseService.click")(function* (input: ComputerClickInput) {
    yield* requireDarwin();
    yield* requireFiniteCoordinates([
      ["x", input.x],
      ["y", input.y],
    ]);
    const button = input.button ?? "left";
    const clickCount = input.clickCount ?? 1;
    yield* runJxa(MOUSE_CLICK_SCRIPT, [
      formatCoordinate(input.x),
      formatCoordinate(input.y),
      button,
      String(clickCount),
    ]);
    return { ok: true as const } satisfies ComputerActionResult;
  });

  const move = Effect.fn("ComputerUseService.move")(function* (input: ComputerMoveInput) {
    yield* requireDarwin();
    yield* requireFiniteCoordinates([
      ["x", input.x],
      ["y", input.y],
    ]);
    yield* runJxa(MOUSE_MOVE_SCRIPT, [formatCoordinate(input.x), formatCoordinate(input.y)]);
    return { ok: true as const } satisfies ComputerActionResult;
  });

  const typeText = Effect.fn("ComputerUseService.typeText")(function* (input: ComputerTypeInput) {
    yield* requireDarwin();
    yield* runAppleScript(TYPE_TEXT_SCRIPT, [input.text]);
    return { ok: true as const } satisfies ComputerActionResult;
  });

  const pressKey = Effect.fn("ComputerUseService.pressKey")(function* (input: ComputerKeyInput) {
    yield* requireDarwin();
    const modifiers = input.modifiers ?? [];
    yield* runAppleScript(keyCodeScript(modifiers), [String(KEY_CODES[input.key])]);
    return { ok: true as const } satisfies ComputerActionResult;
  });

  const scroll = Effect.fn("ComputerUseService.scroll")(function* (input: ComputerScrollInput) {
    yield* requireDarwin();
    if ((input.x === undefined) !== (input.y === undefined)) {
      return yield* new ComputerUseError({
        reason: "action-failed",
        message: "Scroll location requires both x and y coordinates.",
      });
    }
    const deltaX = input.deltaX ?? 0;
    yield* requireFiniteCoordinates([
      ["deltaY", input.deltaY],
      ["deltaX", deltaX],
      ...(input.x !== undefined ? [["x", input.x] as const] : []),
      ...(input.y !== undefined ? [["y", input.y] as const] : []),
    ]);
    yield* runJxa(SCROLL_SCRIPT, [
      String(input.deltaY),
      String(deltaX),
      input.x !== undefined ? formatCoordinate(input.x) : "",
      input.y !== undefined ? formatCoordinate(input.y) : "",
    ]);
    return { ok: true as const } satisfies ComputerActionResult;
  });

  return ComputerUseService.of({
    screenInfo,
    screenshot,
    click,
    move,
    typeText,
    pressKey,
    scroll,
  });
});

export const layer = Layer.effect(ComputerUseService, make).pipe(
  Layer.provide(ComputerUseExecutorLive),
  Layer.provide(ProcessRunner.layer),
);
