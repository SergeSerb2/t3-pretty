// @effect-diagnostics nodeBuiltinImport:off - cleanup tests exercise the real temp-file boundary.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";

import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { ComputerScrollInput, ComputerUseError } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as ProcessRunner from "../processRunner.ts";
import {
  type ComputerUseCommandInput,
  ComputerUseExecutor,
  ComputerUseExecutorLive,
  ComputerUseService,
  make,
  scheduleScreenshotCleanup,
} from "./ComputerUseService.ts";

interface RecordedCall {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

/** Builds the real service over a recording executor that never spawns. */
const makeServiceHarness = (options?: {
  readonly stdoutFor?: (input: ComputerUseCommandInput) => string;
  readonly platform?: NodeJS.Platform;
}) => {
  const calls: Array<RecordedCall> = [];
  const executorLayer = Layer.succeed(ComputerUseExecutor, {
    run: (input) =>
      Effect.sync(() => {
        calls.push({ command: input.command, args: input.args });
        return {
          stdout: options?.stdoutFor?.(input) ?? "",
          stderr: "",
          exitCode: 0,
        };
      }),
  });
  const serviceLayer = Layer.effect(ComputerUseService, make).pipe(
    Layer.provide(executorLayer),
    Layer.provide(Layer.succeed(HostProcessPlatform, options?.platform ?? "darwin")),
  );
  const getService = ComputerUseService.pipe(Effect.provide(serviceLayer));
  return { calls, getService };
};

const scriptArgsAfterSeparator = (call: RecordedCall): ReadonlyArray<string> => {
  const separator = call.args.indexOf("--");
  assert.notEqual(separator, -1, "expected a '--' argv separator");
  return call.args.slice(separator + 1);
};

it.effect("computer_click passes coordinates, button, and click count via argv", () =>
  Effect.gen(function* () {
    const { calls, getService } = makeServiceHarness();
    const service = yield* getService;

    const result = yield* service.click({ x: 100, y: 200.5, button: "right", clickCount: 2 });
    assert.deepEqual(result, { ok: true });

    assert.equal(calls.length, 1);
    const call = calls[0]!;
    assert.equal(call.command, "osascript");
    assert.deepEqual(call.args.slice(0, 3), ["-l", "JavaScript", "-e"]);
    assert.include(call.args[3]!, "CGEventCreateMouseEvent(null,");
    assert.deepEqual(scriptArgsAfterSeparator(call), ["100", "200.5", "right", "2"]);
  }),
);

it.effect("computer_click defaults to a single left click", () =>
  Effect.gen(function* () {
    const { calls, getService } = makeServiceHarness();
    const service = yield* getService;

    yield* service.click({ x: 1, y: 2 });

    assert.deepEqual(scriptArgsAfterSeparator(calls[0]!), ["1", "2", "left", "1"]);
  }),
);

it.effect("computer_move passes coordinates via argv", () =>
  Effect.gen(function* () {
    const { calls, getService } = makeServiceHarness();
    const service = yield* getService;

    yield* service.move({ x: 42, y: 24 });

    assert.equal(calls.length, 1);
    assert.deepEqual(scriptArgsAfterSeparator(calls[0]!), ["42", "24"]);
  }),
);

it.effect("computer_type passes the text as an argv entry, never inside the script", () =>
  Effect.gen(function* () {
    const { calls, getService } = makeServiceHarness();
    const service = yield* getService;
    const payload = 'he"llo $pecial `chars`\nnew line & <b>markup</b>';

    yield* service.typeText({ text: payload });

    assert.equal(calls.length, 1);
    const call = calls[0]!;
    assert.equal(call.command, "osascript");
    assert.equal(call.args[0], "-e");
    const script = call.args[1]!;
    assert.isFalse(
      script.includes(payload),
      "typed text must not be interpolated into the AppleScript source",
    );
    assert.deepEqual(scriptArgsAfterSeparator(call), [payload]);
  }),
);

it.effect("computer_key maps key names to macOS key codes with modifiers", () =>
  Effect.gen(function* () {
    const { calls, getService } = makeServiceHarness();
    const service = yield* getService;

    yield* service.pressKey({ key: "return", modifiers: ["command", "shift"] });

    const call = calls[0]!;
    const script = call.args[1]!;
    assert.include(script, "using {command down, shift down}");
    assert.deepEqual(scriptArgsAfterSeparator(call), ["36"]);
  }),
);

it.effect("computer_key omits the using clause when no modifiers are given", () =>
  Effect.gen(function* () {
    const { calls, getService } = makeServiceHarness();
    const service = yield* getService;

    yield* service.pressKey({ key: "escape" });

    const call = calls[0]!;
    const script = call.args[1]!;
    assert.notInclude(script, "using");
    assert.deepEqual(scriptArgsAfterSeparator(call), ["53"]);
  }),
);

it.effect("computer_scroll passes line deltas and optional location via argv", () =>
  Effect.gen(function* () {
    const { calls, getService } = makeServiceHarness();
    const service = yield* getService;

    yield* service.scroll({ deltaY: -3, deltaX: 2, x: 10, y: 20 });
    assert.deepEqual(scriptArgsAfterSeparator(calls[0]!), ["-3", "2", "10", "20"]);

    yield* service.scroll({ deltaY: 5 });
    assert.deepEqual(scriptArgsAfterSeparator(calls[1]!), ["5", "0", "", ""]);
  }),
);

it.effect("computer_scroll rejects a partial location", () =>
  Effect.gen(function* () {
    const { calls, getService } = makeServiceHarness();
    const service = yield* getService;

    const error = yield* service.scroll({ deltaY: 1, x: 10 }).pipe(Effect.flip);

    assert.equal(error.reason, "action-failed");
    assert.include(error.message, "both x and y");
    assert.isFalse(Schema.is(ComputerScrollInput)({ deltaY: 1, x: 10 }));
    assert.equal(calls.length, 0);
  }),
);

it.effect("computer_screenshot builds screencapture argv and parses sips dimensions", () =>
  Effect.gen(function* () {
    const sipsOutput = "/tmp/shot.png\n  pixelWidth: 3024\n  pixelHeight: 1964\n";
    const { calls, getService } = makeServiceHarness({
      stdoutFor: (input) => (input.command === "sips" ? sipsOutput : ""),
    });
    const service = yield* getService;

    const result = yield* service.screenshot({});

    assert.equal(calls.length, 2);
    const capture = calls[0]!;
    assert.equal(capture.command, "screencapture");
    assert.equal(capture.args[0], "-x");
    assert.notInclude(capture.args, "-D");
    assert.notInclude(capture.args, "-R");
    const outputPath = capture.args[capture.args.length - 1]!;
    assert.match(outputPath, /t3code-screenshot-.+\.png$/u);

    const sips = calls[1]!;
    assert.equal(sips.command, "sips");
    assert.deepEqual(sips.args, ["-g", "pixelWidth", "-g", "pixelHeight", outputPath]);

    assert.deepEqual(result, { path: outputPath, width: 3024, height: 1964 });
  }),
);

it.effect("computer_screenshot honors display and region while using a temp path", () =>
  Effect.gen(function* () {
    const { calls, getService } = makeServiceHarness({
      stdoutFor: (input) =>
        input.command === "sips"
          ? "/tmp/generated.png\n  pixelWidth: 300\n  pixelHeight: 200\n"
          : "",
    });
    const service = yield* getService;

    const result = yield* service.screenshot({
      display: 2,
      region: { x: 10, y: 20, width: 300, height: 200 },
    });

    const capture = calls[0]!;
    assert.equal(capture.args[0], "-x");
    assert.deepEqual(capture.args.slice(0, 5), ["-x", "-D", "2", "-R", "10,20,300,200"]);
    const outputPath = capture.args[capture.args.length - 1]!;
    assert.match(outputPath, /t3code-screenshot-.+\.png$/u);
    assert.deepEqual(result, { path: outputPath, width: 300, height: 200 });
  }),
);

it.effect("computer_screenshot removes its temporary file after the documented TTL", () =>
  Effect.gen(function* () {
    const screenshotPath = `${NodeOS.tmpdir()}/t3code-screenshot-test-${NodeCrypto.randomUUID()}.png`;
    NodeFS.writeFileSync(screenshotPath, "png");

    yield* Effect.promise(() => scheduleScreenshotCleanup(screenshotPath, 0));

    assert.isFalse(NodeFS.existsSync(screenshotPath));
  }),
);

it.effect("computer_screenshot removes its temporary file when inspection fails", () =>
  Effect.gen(function* () {
    let screenshotPath: string | undefined;
    const { getService } = makeServiceHarness({
      stdoutFor: (input) => {
        if (input.command === "screencapture") {
          const path = input.args[input.args.length - 1];
          assert.isDefined(path);
          screenshotPath = path;
          NodeFS.writeFileSync(path, "png");
        }
        return "";
      },
    });
    const service = yield* getService;

    const error = yield* service.screenshot({}).pipe(Effect.flip);

    assert.equal(error.reason, "action-failed");
    assert.isDefined(screenshotPath);
    assert.isFalse(NodeFS.existsSync(screenshotPath));
  }),
);

it.effect("computer_screen_info uses Quartz display coordinates instead of backing pixels", () =>
  Effect.gen(function* () {
    const { calls, getService } = makeServiceHarness({
      stdoutFor: () => '{"screenWidth":1512,"screenHeight":982,"scaleFactor":2}\n',
    });
    const service = yield* getService;

    const result = yield* service.screenInfo();

    assert.deepEqual(result, { screenWidth: 1512, screenHeight: 982, scaleFactor: 2 });
    const call = calls[0]!;
    assert.equal(call.command, "osascript");
    assert.deepEqual(call.args.slice(0, 3), ["-l", "JavaScript", "-e"]);
    assert.include(call.args[3]!, "CGDisplayBounds($.CGMainDisplayID())");
    assert.notInclude(call.args[3]!, "CGDisplayPixelsWide");
    assert.notInclude(call.args[3]!, "CGDisplayPixelsHigh");
    assert.include(call.args[3]!, "Number(f.size.width)");
  }),
);

it.effect("computer actions fail with unsupported-platform off macOS", () =>
  Effect.gen(function* () {
    const { getService } = makeServiceHarness({ platform: "linux" });
    const service = yield* getService;

    const clickError = yield* service.click({ x: 1, y: 2 }).pipe(Effect.flip);
    assert.equal(clickError.reason, "unsupported-platform");

    const screenshotError = yield* service.screenshot({}).pipe(Effect.flip);
    assert.equal(screenshotError.reason, "unsupported-platform");
  }),
);

it.effect("non-zero process exit surfaces as action-failed with stderr detail", () =>
  Effect.gen(function* () {
    const processRunnerLayer = Layer.succeed(ProcessRunner.ProcessRunner, {
      run: (): Effect.Effect<ProcessRunner.ProcessRunOutput, ProcessRunner.ProcessRunError> =>
        Effect.succeed({
          stdout: "",
          stderr: "screencapture: could not create image from display",
          code: ChildProcessSpawner.ExitCode(3),
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdoutInvalidUtf8: false,
          stderrInvalidUtf8: false,
        }),
    });
    const executorLayer = ComputerUseExecutorLive.pipe(Layer.provide(processRunnerLayer));
    const serviceLayer = Layer.effect(ComputerUseService, make).pipe(
      Layer.provide(executorLayer),
      Layer.provide(Layer.succeed(HostProcessPlatform, "darwin")),
    );
    const service = yield* ComputerUseService.pipe(Effect.provide(serviceLayer));

    const error = yield* service.screenshot({}).pipe(Effect.flip);
    assert.isTrue(Schema.is(ComputerUseError)(error));
    assert.equal(error.reason, "action-failed");
    assert.include(error.message, "could not create image from display");
  }),
);
