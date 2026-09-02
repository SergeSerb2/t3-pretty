// @effect-diagnostics nodeBuiltinImport:off - pre-ready Electron setup reads persisted settings synchronously before app services are available.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Electron from "electron";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";

import * as DesktopEarlyElectronStartup from "./DesktopEarlyElectronStartup.ts";
import * as ElectronProtocol from "../electron/ElectronProtocol.ts";

export interface DesktopPreReadyCommandLineReader {
  readonly hasSwitch: (switchName: string) => boolean;
  readonly getSwitchValue: (switchName: string) => string;
}

export interface DesktopPreReadyCommandLineWriter {
  readonly appendSwitch: (switchName: string, value?: string) => void;
}

// Chromium's GPU sandbox plus the default crash-limit will exit the whole
// Windows app after a handful of GPU process deaths (Win11 25H2 sandbox,
// NVIDIA TDR, 50-series). Must be set before `app.whenReady`.
export const WINDOWS_GPU_STABILITY_SWITCHES: ReadonlyArray<readonly [string, string?]> = [
  ["disable-gpu-sandbox"],
  ["disable-gpu-process-crash-limit"],
  ["disable-features", "CalculateNativeWinOcclusion"],
];
const EARLY_DESKTOP_SETTINGS_MAX_BYTES = 1024 * 1024;

function readEarlyDesktopSettings(path: string): string {
  const descriptor = NodeFS.openSync(path, "r");
  try {
    const size = NodeFS.fstatSync(descriptor).size;
    if (size > EARLY_DESKTOP_SETTINGS_MAX_BYTES) {
      throw new Error("Desktop settings exceed the supported pre-ready size.");
    }

    const bytes = Buffer.allocUnsafe(size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const bytesRead = NodeFS.readSync(
        descriptor,
        bytes,
        offset,
        bytes.byteLength - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const probe = Buffer.allocUnsafe(1);
    if (NodeFS.readSync(descriptor, probe, 0, 1, offset) > 0) {
      throw new Error("Desktop settings changed during the pre-ready read.");
    }
    return bytes.subarray(0, offset).toString("utf8");
  } finally {
    NodeFS.closeSync(descriptor);
  }
}

export function applyWindowsGpuStabilitySwitches(
  commandLine: DesktopPreReadyCommandLineWriter,
): void {
  for (const [switchName, value] of WINDOWS_GPU_STABILITY_SWITCHES) {
    if (value === undefined) {
      commandLine.appendSwitch(switchName);
      continue;
    }
    commandLine.appendSwitch(switchName, value);
  }
}

export function readCommandLineSwitchValue(
  commandLine: DesktopPreReadyCommandLineReader,
  switchName: string,
): string | null {
  if (!commandLine.hasSwitch(switchName)) {
    return null;
  }

  const value = commandLine.getSwitchValue(switchName).trim();
  return value.length > 0 ? value : null;
}

export const resolveEarlyLinuxElectronOptionsFromProcess =
  (): DesktopEarlyElectronStartup.EarlyLinuxElectronOptions =>
    DesktopEarlyElectronStartup.resolveEarlyLinuxElectronOptions({
      env: process.env,
      homeDirectory: NodeOS.homedir(),
      joinPath: NodePath.posix.join,
      readFileString: readEarlyDesktopSettings,
    });

export class DesktopPreReadyElectronOptions extends Context.Service<
  DesktopPreReadyElectronOptions,
  {
    readonly linux: DesktopEarlyElectronStartup.EarlyLinuxElectronOptions | null;
    readonly linuxPasswordStoreCommandLine: string | null;
  }
>()("@t3tools/desktop/app/DesktopPreReadyPlatform/DesktopPreReadyElectronOptions") {}

export const make = Effect.gen(function* () {
  const platform = yield* HostProcessPlatform;
  return yield* Effect.sync((): DesktopPreReadyElectronOptions["Service"] => {
    const linuxPasswordStoreCommandLine =
      platform === "linux"
        ? readCommandLineSwitchValue(Electron.app.commandLine, "password-store")
        : null;
    const linux = platform === "linux" ? resolveEarlyLinuxElectronOptionsFromProcess() : null;

    if (linux !== null) {
      Electron.app.commandLine.appendSwitch("class", linux.linuxWmClass);
      if (linux.passwordStore !== null && linuxPasswordStoreCommandLine === null) {
        Electron.app.commandLine.appendSwitch("password-store", linux.passwordStore);
      }
    }

    if (platform === "win32") {
      applyWindowsGpuStabilitySwitches(Electron.app.commandLine);
    }

    return { linux, linuxPasswordStoreCommandLine };
  });
}).pipe(Effect.withSpan("desktop.electron.configureBeforeReady"));

// Keep Electron's strict pre-ready setup isolated so later runtime layers cannot
// observe app readiness before scheme privileges and command-line switches exist.
export const layer = Layer.mergeAll(
  ElectronProtocol.layerSchemePrivileges,
  Layer.effect(DesktopPreReadyElectronOptions, make),
);
