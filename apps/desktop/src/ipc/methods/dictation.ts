import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import type { DesktopDictationEvent } from "@t3tools/contracts";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as ElectronApp from "../../electron/ElectronApp.ts";
import {
  resolveMacDictationHelperCandidates,
  startMacDictation,
  type MacDictationSession,
} from "../../dictation/MacDictation.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as IpcChannels from "../channels.ts";

export class DesktopDictationError extends Schema.TaggedError<DesktopDictationError>()(
  "DesktopDictationError",
  {
    message: Schema.String,
  },
) {}

const DictationStartRequest = Schema.Struct({
  locale: Schema.optionalKey(Schema.String),
});

type ActiveDictation = {
  readonly session: MacDictationSession;
  readonly senderId: number;
};

let active: ActiveDictation | null = null;

function sendDictationEvent(senderId: number, event: DesktopDictationEvent) {
  const contents = Electron.webContents.fromId(senderId);
  if (!contents || contents.isDestroyed()) return;
  contents.send(IpcChannels.DICTATION_EVENT_CHANNEL, event);
}

const stopActive = Effect.fn("desktop.ipc.dictation.stopActive")(function* (
  command: "stop" | "cancel",
) {
  const current = active;
  active = null;
  if (!current) return;
  if (command === "cancel") yield* Effect.promise(() => current.session.cancel());
  else yield* Effect.promise(() => current.session.stop());
});

export const startDictation = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.START_DICTATION_CHANNEL,
  payload: DictationStartRequest,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.dictation.start")(function* (input, event) {
    if (event === undefined) return;
    yield* stopActive("cancel");
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    if (environment.platform !== "darwin") {
      return yield* new DesktopDictationError({
        message: "On-device dictation is available on macOS only.",
      });
    }
    const fileSystem = yield* FileSystem.FileSystem;
    const execDir = environment.path.dirname(Electron.app.getPath("exe"));
    const candidates = resolveMacDictationHelperCandidates({
      platform: environment.platform,
      isPackaged: environment.isPackaged,
      execDir,
      rootDir: environment.rootDir,
      processArch: environment.processArch,
      resourcesPath: environment.resourcesPath,
    });
    let helperPath: string | undefined;
    for (const candidate of candidates) {
      if (yield* fileSystem.exists(candidate)) {
        helperPath = candidate;
        break;
      }
    }
    if (helperPath === undefined) {
      return yield* new DesktopDictationError({
        message: "macOS speech recognition is not available in this desktop build.",
      });
    }
    const app = yield* ElectronApp.ElectronApp;
    const locale = input.locale?.trim() || (yield* app.systemLocale) || "en-US";
    const senderId = event.sender.id;
    const session = yield* Effect.tryPromise({
      try: () =>
        startMacDictation({
          helperPath,
          locale,
          onEvent: (dictationEvent) => {
            sendDictationEvent(senderId, dictationEvent);
            if (dictationEvent.type === "ended" && active?.senderId === senderId) {
              active = null;
            }
          },
        }),
      catch: (cause) =>
        new DesktopDictationError({
          message: cause instanceof Error ? cause.message : "macOS speech recognition failed.",
        }),
    });
    active = { session, senderId };
  }),
});

export const stopDictation = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.STOP_DICTATION_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.dictation.stop")(function* () {
    yield* stopActive("stop");
  }),
});

export const cancelDictation = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.CANCEL_DICTATION_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.dictation.cancel")(function* () {
    yield* stopActive("cancel");
  }),
});
