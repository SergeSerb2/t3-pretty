import { assert, describe, it } from "@effect/vitest";
import type { DesktopCapturePermissionStatus } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Electron from "electron";
import { vi } from "vite-plus/test";

vi.mock("electron", () => ({}));

import * as ElectronDesktopCapturer from "../electron/ElectronDesktopCapturer.ts";
import * as ScreenCaptureManager from "./Manager.ts";

const makeImage = (input: {
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
  readonly empty?: boolean;
}): Electron.NativeImage =>
  ({
    isEmpty: () => input.empty === true,
    getSize: () => ({ width: input.width, height: input.height }),
    toDataURL: () => input.dataUrl,
  }) as unknown as Electron.NativeImage;

const makeSource = (input: {
  readonly id: string;
  readonly name: string;
  readonly displayId?: string;
  readonly thumbnail: Electron.NativeImage;
  readonly appIcon?: Electron.NativeImage | null;
}): Electron.DesktopCapturerSource =>
  ({
    id: input.id,
    name: input.name,
    display_id: input.displayId ?? "",
    thumbnail: input.thumbnail,
    appIcon: input.appIcon ?? null,
  }) as unknown as Electron.DesktopCapturerSource;

const emptyThumbnailScreenSource = () =>
  makeSource({
    id: "screen:1:0",
    name: "Display 1",
    displayId: "1",
    thumbnail: makeImage({ dataUrl: "data:image/png;base64,", width: 0, height: 0, empty: true }),
  });

const managerLayer = (input: {
  readonly getSources: (
    options: Electron.SourcesOptions,
  ) => readonly Electron.DesktopCapturerSource[];
  readonly status?: DesktopCapturePermissionStatus;
  readonly platform?: NodeJS.Platform;
}) =>
  ScreenCaptureManager.layer.pipe(
    Layer.provide(
      Layer.succeed(
        ElectronDesktopCapturer.ElectronDesktopCapturer,
        ElectronDesktopCapturer.ElectronDesktopCapturer.of({
          getSources: (options) => Effect.sync(() => input.getSources(options)),
          getScreenAccessStatus: Effect.sync(() => input.status ?? "granted"),
        }),
      ),
    ),
    Layer.provide(Layer.succeed(HostProcessPlatform, input.platform ?? "darwin")),
  );

describe("ScreenCaptureManager", () => {
  it.effect("delegates getPermissionStatus to the capturer seam", () =>
    Effect.gen(function* () {
      const manager = yield* ScreenCaptureManager.ScreenCaptureManager;
      const status = yield* manager.getPermissionStatus;
      assert.strictEqual(status, "restricted");
    }).pipe(Effect.provide(managerLayer({ getSources: () => [], status: "restricted" }))),
  );

  it.effect("maps sources, infers kinds from the id prefix, and clamps the thumbnail size", () => {
    const getSources = vi.fn((_options: Electron.SourcesOptions) => [
      makeSource({
        id: "window:12:0",
        name: "Editor — Manager.ts",
        thumbnail: makeImage({ dataUrl: "data:image/png;base64,window", width: 320, height: 200 }),
        appIcon: makeImage({ dataUrl: "data:image/png;base64,icon", width: 32, height: 32 }),
      }),
      makeSource({
        id: "screen:1:0",
        name: "Display 1",
        displayId: "42",
        thumbnail: makeImage({ dataUrl: "data:image/png;base64,screen", width: 320, height: 180 }),
        // Screens (and windows without icons) yield an empty appIcon.
        appIcon: makeImage({
          dataUrl: "data:image/png;base64,x",
          width: 0,
          height: 0,
          empty: true,
        }),
      }),
    ]);

    return Effect.gen(function* () {
      const manager = yield* ScreenCaptureManager.ScreenCaptureManager;
      const sources = yield* manager.listSources({ thumbnailMaxDimension: 5000 });

      assert.deepEqual(getSources.mock.calls[0], [
        {
          types: ["window", "screen"],
          thumbnailSize: { width: 1024, height: 1024 },
          fetchWindowIcons: true,
        },
      ]);
      assert.deepEqual(sources, [
        {
          sourceId: "window:12:0",
          kind: "window",
          name: "Editor — Manager.ts",
          appName: null,
          appIconDataUrl: "data:image/png;base64,icon",
          thumbnailDataUrl: "data:image/png;base64,window",
          thumbnailWidth: 320,
          thumbnailHeight: 200,
          displayId: null,
        },
        {
          sourceId: "screen:1:0",
          kind: "screen",
          name: "Display 1",
          appName: null,
          appIconDataUrl: null,
          thumbnailDataUrl: "data:image/png;base64,screen",
          thumbnailWidth: 320,
          thumbnailHeight: 180,
          displayId: "42",
        },
      ]);
    }).pipe(Effect.provide(managerLayer({ getSources })));
  });

  it.effect("uses the default thumbnail dimension and forwards requested kinds", () => {
    const getSources = vi.fn((_options: Electron.SourcesOptions) => []);

    return Effect.gen(function* () {
      const manager = yield* ScreenCaptureManager.ScreenCaptureManager;
      const sources = yield* manager.listSources({ kinds: ["screen"] });

      assert.deepEqual(sources, []);
      assert.deepEqual(getSources.mock.calls[0], [
        {
          types: ["screen"],
          thumbnailSize: { width: 320, height: 320 },
          fetchWindowIcons: true,
        },
      ]);
    }).pipe(Effect.provide(managerLayer({ getSources })));
  });

  it.effect("captures a found source, narrowing types by the id prefix and clamping size", () => {
    const getSources = vi.fn((_options: Electron.SourcesOptions) => [
      makeSource({
        id: "window:12:0",
        name: "Editor",
        thumbnail: makeImage({ dataUrl: "data:image/png;base64,cap", width: 1600, height: 900 }),
      }),
    ]);

    return Effect.gen(function* () {
      const manager = yield* ScreenCaptureManager.ScreenCaptureManager;
      const result = yield* manager.captureSource({
        sourceId: "window:12:0",
        maxDimension: 10_000,
      });

      assert.deepEqual(getSources.mock.calls[0], [
        { types: ["window"], thumbnailSize: { width: 8192, height: 8192 } },
      ]);
      assert.strictEqual(result.sourceId, "window:12:0");
      assert.strictEqual(result.dataUrl, "data:image/png;base64,cap");
      assert.strictEqual(result.width, 1600);
      assert.strictEqual(result.height, 900);
      assert.isFalse(Number.isNaN(Date.parse(result.capturedAt)));
    }).pipe(Effect.provide(managerLayer({ getSources })));
  });

  it.effect("fails with ScreenCaptureSourceNotFoundError when the source disappeared", () =>
    Effect.gen(function* () {
      const manager = yield* ScreenCaptureManager.ScreenCaptureManager;
      const error = yield* manager.captureSource({ sourceId: "screen:9:0" }).pipe(Effect.flip);

      assert.instanceOf(error, ScreenCaptureManager.ScreenCaptureSourceNotFoundError);
      assert.isTrue(ScreenCaptureManager.isScreenCaptureManagerError(error));
      assert.strictEqual(error.sourceId, "screen:9:0");
      assert.strictEqual(error.message, "Screen capture source not found: screen:9:0");
    }).pipe(Effect.provide(managerLayer({ getSources: () => [] }))),
  );

  it.effect("maps a silent empty capture to a permission error on non-granted darwin", () =>
    Effect.gen(function* () {
      const manager = yield* ScreenCaptureManager.ScreenCaptureManager;
      const error = yield* manager.captureSource({ sourceId: "screen:1:0" }).pipe(Effect.flip);

      assert.instanceOf(error, ScreenCaptureManager.ScreenCapturePermissionError);
      assert.isTrue(ScreenCaptureManager.isScreenCaptureManagerError(error));
      assert.strictEqual(error.status, "denied");
    }).pipe(
      Effect.provide(
        managerLayer({
          getSources: () => [emptyThumbnailScreenSource()],
          status: "denied",
          platform: "darwin",
        }),
      ),
    ),
  );

  it.effect("returns an empty capture as a result when screen access is granted on darwin", () =>
    Effect.gen(function* () {
      const manager = yield* ScreenCaptureManager.ScreenCaptureManager;
      const result = yield* manager.captureSource({ sourceId: "screen:1:0" });
      assert.strictEqual(result.dataUrl, "data:image/png;base64,");
    }).pipe(
      Effect.provide(
        managerLayer({
          getSources: () => [emptyThumbnailScreenSource()],
          status: "granted",
          platform: "darwin",
        }),
      ),
    ),
  );

  it.effect("skips the darwin permission probe entirely on other platforms", () =>
    Effect.gen(function* () {
      const manager = yield* ScreenCaptureManager.ScreenCaptureManager;
      const result = yield* manager.captureSource({ sourceId: "screen:1:0" });
      assert.strictEqual(result.sourceId, "screen:1:0");
      assert.strictEqual(result.width, 0);
      assert.strictEqual(result.height, 0);
    }).pipe(
      Effect.provide(
        managerLayer({
          getSources: () => [emptyThumbnailScreenSource()],
          status: "unknown",
          platform: "linux",
        }),
      ),
    ),
  );
});
