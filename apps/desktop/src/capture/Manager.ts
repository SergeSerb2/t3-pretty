/**
 * Desktop-wide screen/window capture backed by Electron's desktopCapturer.
 *
 * desktopCapturer is windowless — every listed source is rendered off-screen
 * at the requested thumbnailSize, so the thumbnail IS the capture. Renderers
 * only ever receive data URLs; no window handoff is involved.
 */
import type {
  DesktopCaptureListSourcesInput,
  DesktopCapturePermissionStatus,
  DesktopCaptureResult,
  DesktopCaptureSource,
  DesktopCaptureSourceInput,
  DesktopCaptureSourceKind,
} from "@t3tools/contracts";
import { DesktopCapturePermissionStatusSchema } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Electron from "electron";

import * as ElectronDesktopCapturer from "../electron/ElectronDesktopCapturer.ts";

const DEFAULT_THUMBNAIL_MAX_DIMENSION = 320;
const MAX_THUMBNAIL_MAX_DIMENSION = 1024;
const DEFAULT_CAPTURE_MAX_DIMENSION = 2048;
const MAX_CAPTURE_MAX_DIMENSION = 8192;
const DEFAULT_SOURCE_KINDS: ReadonlyArray<DesktopCaptureSourceKind> = ["window", "screen"];

export class ScreenCapturePermissionError extends Schema.TaggedErrorClass<ScreenCapturePermissionError>()(
  "ScreenCapturePermissionError",
  { status: DesktopCapturePermissionStatusSchema },
) {
  override get message(): string {
    return `Screen capture is not permitted (screen access status: ${this.status}).`;
  }
}

export class ScreenCaptureSourceNotFoundError extends Schema.TaggedErrorClass<ScreenCaptureSourceNotFoundError>()(
  "ScreenCaptureSourceNotFoundError",
  { sourceId: Schema.String },
) {
  override get message(): string {
    return `Screen capture source not found: ${this.sourceId}`;
  }
}

export class ScreenCaptureOperationError extends Schema.TaggedErrorClass<ScreenCaptureOperationError>()(
  "ScreenCaptureOperationError",
  {
    operation: Schema.String,
    sourceId: Schema.NullOr(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    const source = this.sourceId === null ? "" : ` (source ${this.sourceId})`;
    return `Desktop screen capture operation failed: ${this.operation}${source}`;
  }
}

export const ScreenCaptureManagerError = Schema.Union([
  ScreenCapturePermissionError,
  ScreenCaptureSourceNotFoundError,
  ScreenCaptureOperationError,
]);
export type ScreenCaptureManagerError = typeof ScreenCaptureManagerError.Type;

export const isScreenCaptureManagerError = Schema.is(ScreenCaptureManagerError);

/** `window:123:0` → `"window"`; everything else is a screen/display source. */
const sourceKindFromId = (sourceId: string): DesktopCaptureSourceKind =>
  sourceId.startsWith("window:") ? "window" : "screen";

const clampDimension = (value: number | undefined, defaultValue: number, max: number): number =>
  Math.min(value ?? defaultValue, max);

export class ScreenCaptureManager extends Context.Service<
  ScreenCaptureManager,
  {
    readonly getPermissionStatus: Effect.Effect<DesktopCapturePermissionStatus>;
    readonly listSources: (
      input: DesktopCaptureListSourcesInput,
    ) => Effect.Effect<ReadonlyArray<DesktopCaptureSource>, ScreenCaptureManagerError>;
    readonly captureSource: (
      input: DesktopCaptureSourceInput,
    ) => Effect.Effect<DesktopCaptureResult, ScreenCaptureManagerError>;
  }
>()("@t3tools/desktop/capture/Manager/ScreenCaptureManager") {}

export const make = Effect.gen(function* ScreenCaptureManagerMake() {
  const capturer = yield* ElectronDesktopCapturer.ElectronDesktopCapturer;
  const platform = yield* HostProcessPlatform;
  const currentIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const listSources = Effect.fn("ScreenCaptureManager.listSources")(function* (
    input: DesktopCaptureListSourcesInput,
  ) {
    const dimension = clampDimension(
      input.thumbnailMaxDimension,
      DEFAULT_THUMBNAIL_MAX_DIMENSION,
      MAX_THUMBNAIL_MAX_DIMENSION,
    );
    const sources = yield* capturer
      .getSources({
        types: [...(input.kinds ?? DEFAULT_SOURCE_KINDS)],
        thumbnailSize: { width: dimension, height: dimension },
        fetchWindowIcons: true,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ScreenCaptureOperationError({
              operation: "listSources.getSources",
              sourceId: null,
              cause,
            }),
        ),
      );
    return sources.map((source): DesktopCaptureSource => {
      // Typed non-null, but null at runtime for screen sources (and windows
      // without an icon).
      const appIcon = source.appIcon as Electron.NativeImage | null;
      const thumbnailSize = source.thumbnail.getSize();
      return {
        sourceId: source.id,
        kind: sourceKindFromId(source.id),
        name: source.name,
        // Electron does not expose the owning application's name in v1.
        appName: null,
        appIconDataUrl: appIcon === null || appIcon.isEmpty() ? null : appIcon.toDataURL(),
        thumbnailDataUrl: source.thumbnail.toDataURL(),
        thumbnailWidth: thumbnailSize.width,
        thumbnailHeight: thumbnailSize.height,
        displayId: source.display_id || null,
      };
    });
  });

  const captureSource = Effect.fn("ScreenCaptureManager.captureSource")(function* (
    input: DesktopCaptureSourceInput,
  ) {
    const dimension = clampDimension(
      input.maxDimension,
      DEFAULT_CAPTURE_MAX_DIMENSION,
      MAX_CAPTURE_MAX_DIMENSION,
    );
    // Narrow the listing to the requested kind: desktopCapturer renders EVERY
    // listed source at thumbnailSize, so asking for both kinds here would
    // re-render every window/screen at hi-res just to keep one.
    const sources = yield* capturer
      .getSources({
        types: [sourceKindFromId(input.sourceId)],
        thumbnailSize: { width: dimension, height: dimension },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ScreenCaptureOperationError({
              operation: "captureSource.getSources",
              sourceId: input.sourceId,
              cause,
            }),
        ),
      );
    const source = sources.find((candidate) => candidate.id === input.sourceId);
    if (source === undefined) {
      return yield* new ScreenCaptureSourceNotFoundError({ sourceId: input.sourceId });
    }
    if (source.thumbnail.isEmpty() && platform === "darwin") {
      // macOS reports a missing Screen Recording permission as a silent
      // black/empty image, never as a rejected promise.
      const status = yield* capturer.getScreenAccessStatus;
      if (status !== "granted") {
        return yield* new ScreenCapturePermissionError({ status });
      }
    }
    const size = source.thumbnail.getSize();
    return {
      sourceId: input.sourceId,
      dataUrl: source.thumbnail.toDataURL(),
      width: size.width,
      height: size.height,
      capturedAt: yield* currentIso,
    };
  });

  return ScreenCaptureManager.of({
    getPermissionStatus: capturer.getScreenAccessStatus,
    listSources,
    captureSource,
  });
}).pipe(Effect.withSpan("ScreenCaptureManager.make"));

export const layer = Layer.effect(ScreenCaptureManager, make);
