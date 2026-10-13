import type * as Electron from "electron";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { makeRotatingLogFileWriter } from "../app/DesktopObservability.ts";

export interface RendererIdentity {
  readonly surface: "main" | "preview" | "splash" | "picture-in-picture" | "devtools";
  readonly tabId?: string;
}

export type RendererErrorEvent =
  | "console-error"
  | "preload-error"
  | "window-error"
  | "unhandled-rejection"
  | "render-error";

export interface RendererErrorInput {
  readonly webContentsId?: number;
  readonly event: Exclude<RendererErrorEvent, "console-error" | "preload-error">;
  readonly message: string;
  readonly stack?: string;
}

export class DesktopRendererHistory extends Context.Service<
  DesktopRendererHistory,
  {
    readonly register: (
      webContents: Electron.WebContents,
      identity: RendererIdentity,
    ) => Effect.Effect<void>;
    readonly recordMetrics: (metrics: ReadonlyArray<Electron.ProcessMetric>) => Effect.Effect<void>;
    readonly recordError: (input: RendererErrorInput) => Effect.Effect<void>;
    readonly shutdown: Effect.Effect<void>;
  }
>()("@t3tools/desktop/telemetry/DesktopRendererHistory") {}

interface RendererMemory {
  readonly sampledAtUnixMs: number;
  // Electron reports process-wide working sets in KiB, not JavaScript heaps.
  readonly kind: "electron-process-working-set";
  readonly workingSetBytes: number;
  readonly peakWorkingSetBytes: number;
}

interface RendererRecord {
  readonly version: 1;
  readonly mainPid: number;
  readonly mainSessionStartedAtUnixMs: number;
  readonly timestampUnixMs: number;
  readonly event:
    | "created"
    | "identified"
    | "dom-ready"
    | "sample"
    | "render-process-gone"
    | "destroyed"
    | RendererErrorEvent;
  readonly webContentsId: number;
  readonly surface: RendererIdentity["surface"];
  readonly tabId?: string;
  readonly rendererPid: number | null;
  readonly rendererPidSource: "current" | "last-known" | "unavailable";
  readonly rendererCreationTimeMs: number | null;
  readonly memory: RendererMemory | null;
  readonly reason?: Electron.RenderProcessGoneDetails["reason"];
  readonly exitCode?: number;
  readonly message?: string;
  readonly stack?: string;
}

const MESSAGE_MAX = 1_024;
const STACK_MAX = 2_048;

// A substring can pin the full console message while queued behind disk IO.
const boundText = (value: string, max: number): string =>
  value.length <= max ? value : Buffer.from(value.slice(0, max), "utf16le").toString("utf16le");

function parseConsoleMessageArgs(args: ReadonlyArray<unknown>): {
  readonly level: string;
  readonly message: string;
} | null {
  const details = args[1];
  if (details !== null && typeof details === "object") {
    const message = Reflect.get(details, "message");
    if (typeof message === "string") {
      const level = Reflect.get(details, "level");
      return {
        level:
          typeof level === "string"
            ? level
            : typeof level === "number"
              ? (["debug", "info", "warning", "error"][level] ?? "info")
              : "info",
        message,
      };
    }
  }
  if (typeof args[2] === "string") {
    const level = args[1];
    return {
      level:
        typeof level === "number"
          ? (["debug", "info", "warning", "error"][level] ?? "info")
          : typeof level === "string"
            ? level
            : "info",
      message: args[2],
    };
  }
  return null;
}

interface TrackedRenderer {
  readonly webContents: Electron.WebContents;
  identity: RendererIdentity;
  pid: number | null;
  creationTimeMs: number | null;
  memory: RendererMemory | null;
  gone: boolean;
  readonly removeListeners: () => void;
}

const nonnegative = (value: number): number | null =>
  Number.isFinite(value) && value >= 0 ? Math.round(value) : null;

/** Small restart-surviving PID history; never reads URLs or page content. */
const make = Effect.fn("DesktopRendererHistory.make")(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const path = yield* Path.Path;
  const clock = yield* Clock.Clock;
  const context = yield* Effect.context<never>();
  const runFork = Effect.runForkWith(context);
  const mainSessionStartedAtUnixMs = clock.currentTimeMillisUnsafe();
  const records = yield* Queue.sliding<RendererRecord>(256);
  const active = new Map<number, TrackedRenderer>();
  let accepting = true;
  const writer = yield* makeRotatingLogFileWriter({
    filePath: path.join(environment.logDir, "renderer-history.ndjson"),
    maxBytes: 256 * 1024,
    maxFiles: 2,
  }).pipe(
    Effect.catch(() =>
      Effect.logWarning("Renderer incident history could not be opened.").pipe(
        Effect.as({ writeText: (_chunk: string) => Effect.void }),
      ),
    ),
  );

  // Error logs share the bounded incident queue. A guest's console burst must
  // not fork an independent logger fiber for every event it produces.
  const writeRecord = (record: RendererRecord) =>
    writer.writeText(`${JSON.stringify(record)}\n`).pipe(
      Effect.ignore,
      Effect.andThen(
        record.message === undefined
          ? Effect.void
          : Effect.logError("Renderer error").pipe(
              Effect.annotateLogs({
                event: record.event,
                surface: record.surface,
                webContentsId: record.webContentsId,
                message: record.message,
              }),
            ),
      ),
    );
  const writerFiber = yield* Effect.forever(
    Effect.uninterruptibleMask((restore) =>
      restore(Queue.take(records)).pipe(Effect.flatMap(writeRecord)),
    ).pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterrupts(cause),
        () => Effect.void,
      ),
    ),
  ).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        while (Queue.sizeUnsafe(records) > 0) {
          const pending = yield* Queue.takeAll(records);
          yield* Effect.forEach(pending, writeRecord, { discard: true });
        }
      }),
    ),
    Effect.forkScoped,
  );

  const readPid = (renderer: TrackedRenderer): RendererRecord["rendererPidSource"] => {
    try {
      if (!renderer.gone && !renderer.webContents.isDestroyed()) {
        const pid = renderer.webContents.getOSProcessId();
        if (Number.isInteger(pid) && pid > 0) {
          if (pid !== renderer.pid) {
            renderer.pid = pid;
            renderer.creationTimeMs = null;
            renderer.memory = null;
          }
          return "current";
        }
      }
    } catch {
      // Electron can remove a guest before its destruction callback runs.
    }
    return renderer.pid === null ? "unavailable" : "last-known";
  };
  const record = (
    renderer: TrackedRenderer,
    event: RendererRecord["event"],
    extras?: {
      readonly details?: Electron.RenderProcessGoneDetails;
      readonly message?: string;
      readonly stack?: string;
    },
  ): void => {
    const rendererPidSource = readPid(renderer);
    Queue.offerUnsafe(records, {
      version: 1,
      mainPid: process.pid,
      mainSessionStartedAtUnixMs,
      timestampUnixMs: clock.currentTimeMillisUnsafe(),
      event,
      webContentsId: renderer.webContents.id,
      ...renderer.identity,
      rendererPid: renderer.pid,
      rendererPidSource,
      rendererCreationTimeMs: renderer.creationTimeMs,
      memory: renderer.memory,
      ...(extras?.details === undefined
        ? {}
        : {
            reason: extras.details.reason,
            ...(Number.isFinite(extras.details.exitCode)
              ? { exitCode: Math.round(extras.details.exitCode) }
              : {}),
          }),
      ...(extras?.message === undefined ? {} : { message: boundText(extras.message, MESSAGE_MAX) }),
      ...(extras?.stack === undefined ? {} : { stack: boundText(extras.stack, STACK_MAX) }),
    });
  };

  const logRendererError = (
    renderer: TrackedRenderer,
    event: RendererErrorEvent,
    extras: { readonly message: string; readonly stack?: string },
  ) => {
    record(renderer, event, extras);
  };

  const register = (webContents: Electron.WebContents, identity: RendererIdentity) =>
    Effect.sync(() => {
      if (!accepting || webContents.isDestroyed()) return;
      const boundedIdentity: RendererIdentity = {
        surface: identity.surface,
        ...(identity.tabId === undefined ? {} : { tabId: identity.tabId.slice(0, 128) }),
      };
      const existing = active.get(webContents.id);
      if (existing !== undefined) {
        if (
          existing.identity.surface !== boundedIdentity.surface ||
          existing.identity.tabId !== boundedIdentity.tabId
        ) {
          existing.identity = boundedIdentity;
          record(existing, "identified");
        }
        return;
      }
      const onDomReady = () => {
        if (renderer.gone) {
          renderer.pid = null;
          renderer.creationTimeMs = null;
          renderer.memory = null;
          renderer.gone = false;
        }
        record(renderer, "dom-ready");
      };
      const onDevToolsOpened = () => {
        const tools = webContents.devToolsWebContents;
        if (tools)
          runFork(
            register(tools, {
              surface: "devtools",
              ...(renderer.identity.tabId === undefined ? {} : { tabId: renderer.identity.tabId }),
            }),
          );
      };
      const onGone = (_event: Electron.Event, details: Electron.RenderProcessGoneDetails) => {
        readPid(renderer);
        renderer.gone = true;
        record(renderer, "render-process-gone", { details });
      };
      const onConsoleMessage = (...args: unknown[]) => {
        const parsed = parseConsoleMessageArgs(args);
        if (parsed === null || parsed.level !== "error") return;
        logRendererError(renderer, "console-error", { message: parsed.message });
      };
      const onPreloadError = (_event: unknown, _preloadPath: unknown, error: unknown) => {
        const message = error instanceof Error ? error.message : String(error ?? "preload failed");
        logRendererError(renderer, "preload-error", {
          message,
          ...(error instanceof Error && error.stack !== undefined ? { stack: error.stack } : {}),
        });
      };
      const onDestroyed = () => {
        record(renderer, "destroyed");
        active.delete(webContents.id);
        renderer.removeListeners();
      };
      const renderer: TrackedRenderer = {
        webContents,
        identity: boundedIdentity,
        pid: null,
        creationTimeMs: null,
        memory: null,
        gone: false,
        removeListeners: () => {
          webContents.removeListener("dom-ready", onDomReady);
          webContents.removeListener("devtools-opened", onDevToolsOpened);
          webContents.removeListener("render-process-gone", onGone);
          webContents.removeListener("console-message", onConsoleMessage as never);
          webContents.removeListener("preload-error", onPreloadError as never);
          webContents.removeListener("destroyed", onDestroyed);
        },
      };
      active.set(webContents.id, renderer);
      webContents.on("dom-ready", onDomReady);
      webContents.on("devtools-opened", onDevToolsOpened);
      webContents.on("render-process-gone", onGone);
      webContents.on("console-message", onConsoleMessage as never);
      webContents.on("preload-error", onPreloadError as never);
      webContents.once("destroyed", onDestroyed);
      record(renderer, "created");
    }).pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterrupts(cause),
        () => Effect.void,
      ),
    );

  let lastSampledAtUnixMs = -Infinity;
  const recordMetrics = (metrics: ReadonlyArray<Electron.ProcessMetric>) =>
    Effect.sync(() => {
      if (!accepting) return;
      const sampledAtUnixMs = clock.currentTimeMillisUnsafe();
      if (sampledAtUnixMs - lastSampledAtUnixMs < 30_000) return;
      lastSampledAtUnixMs = sampledAtUnixMs;
      const byPid = new Map(metrics.map((metric) => [metric.pid, metric]));
      for (const renderer of active.values()) {
        const pidSource = readPid(renderer);
        // A last-known PID may already have been reused by another process.
        const metric =
          pidSource !== "current" || renderer.pid === null ? undefined : byPid.get(renderer.pid);
        if (metric !== undefined) {
          renderer.creationTimeMs = nonnegative(metric.creationTime);
          renderer.memory = {
            sampledAtUnixMs,
            kind: "electron-process-working-set",
            workingSetBytes: nonnegative(metric.memory.workingSetSize * 1024) ?? 0,
            peakWorkingSetBytes: nonnegative(metric.memory.peakWorkingSetSize * 1024) ?? 0,
          };
        }
        // A process can host multiple contents; these rows must not be summed.
        record(renderer, "sample");
      }
    }).pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterrupts(cause),
        () => Effect.void,
      ),
    );
  const recordError = (input: RendererErrorInput) =>
    Effect.sync(() => {
      if (!accepting) return;
      const renderer =
        input.webContentsId === undefined
          ? ([...active.values()].find((candidate) => candidate.identity.surface === "main") ??
            [...active.values()][0])
          : active.get(input.webContentsId);
      if (renderer === undefined) {
        Queue.offerUnsafe(records, {
          version: 1,
          mainPid: process.pid,
          mainSessionStartedAtUnixMs,
          timestampUnixMs: clock.currentTimeMillisUnsafe(),
          event: input.event,
          webContentsId: input.webContentsId ?? -1,
          surface: "main",
          rendererPid: null,
          rendererPidSource: "unavailable",
          rendererCreationTimeMs: null,
          memory: null,
          message: boundText(input.message, MESSAGE_MAX),
          ...(input.stack === undefined ? {} : { stack: boundText(input.stack, STACK_MAX) }),
        });
        return;
      }
      logRendererError(renderer, input.event, {
        message: input.message,
        ...(input.stack === undefined ? {} : { stack: input.stack }),
      });
    }).pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterrupts(cause),
        () => Effect.void,
      ),
    );
  const shutdown = Effect.sync(() => {
    accepting = false;
    for (const renderer of active.values()) renderer.removeListeners();
    active.clear();
  }).pipe(Effect.andThen(Fiber.interrupt(writerFiber)), Effect.asVoid);
  yield* Effect.addFinalizer(() => shutdown);

  return DesktopRendererHistory.of({ register, recordMetrics, recordError, shutdown });
});

export const layer = Layer.effect(DesktopRendererHistory, make());
