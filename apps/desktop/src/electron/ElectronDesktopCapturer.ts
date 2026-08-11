import type { DesktopCapturePermissionStatus } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as Electron from "electron";

export class ElectronDesktopCapturerError extends Schema.TaggedErrorClass<ElectronDesktopCapturerError>()(
  "ElectronDesktopCapturerError",
  {
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Electron desktopCapturer.getSources failed.";
  }
}

export const isElectronDesktopCapturerError = Schema.is(ElectronDesktopCapturerError);

/**
 * Thin mockable seam over Electron's windowless desktop-capture surface:
 * `desktopCapturer.getSources` plus the macOS Screen Recording TCC status.
 */
export class ElectronDesktopCapturer extends Context.Service<
  ElectronDesktopCapturer,
  {
    readonly getSources: (
      options: Electron.SourcesOptions,
    ) => Effect.Effect<readonly Electron.DesktopCapturerSource[], ElectronDesktopCapturerError>;
    readonly getScreenAccessStatus: Effect.Effect<DesktopCapturePermissionStatus>;
  }
>()("@t3tools/desktop/electron/ElectronDesktopCapturer") {}

export const make = Effect.gen(function* () {
  const platform = yield* HostProcessPlatform;

  return ElectronDesktopCapturer.of({
    getSources: (options) =>
      Effect.tryPromise({
        try: () => Electron.desktopCapturer.getSources(options),
        catch: (cause) => new ElectronDesktopCapturerError({ cause }),
      }),
    getScreenAccessStatus: Effect.sync((): DesktopCapturePermissionStatus => {
      if (platform === "darwin") {
        return Electron.systemPreferences.getMediaAccessStatus("screen");
      }
      if (platform === "win32") {
        return "granted";
      }
      // Linux has no queryable status; the PipeWire portal prompts at
      // capture time.
      return "unknown";
    }),
  });
});

export const layer = Layer.effect(ElectronDesktopCapturer, make);
