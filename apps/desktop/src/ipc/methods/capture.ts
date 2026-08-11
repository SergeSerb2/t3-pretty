import {
  DesktopCaptureListSourcesInputSchema,
  DesktopCapturePermissionStatusSchema,
  DesktopCaptureResultSchema,
  DesktopCaptureSourceInputSchema,
  DesktopCaptureSourceSchema,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as ScreenCaptureManager from "../../capture/Manager.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const getPermissionStatus = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.CAPTURE_GET_PERMISSION_STATUS_CHANNEL,
  payload: Schema.Void,
  result: DesktopCapturePermissionStatusSchema,
  handler: Effect.fn("desktop.ipc.capture.getPermissionStatus")(function* () {
    const manager = yield* ScreenCaptureManager.ScreenCaptureManager;
    return yield* manager.getPermissionStatus;
  }),
});

export const listSources = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.CAPTURE_LIST_SOURCES_CHANNEL,
  // The bridge's input is optional; renderers may invoke with no payload.
  payload: Schema.UndefinedOr(DesktopCaptureListSourcesInputSchema),
  result: Schema.Array(DesktopCaptureSourceSchema),
  handler: Effect.fn("desktop.ipc.capture.listSources")(function* (input) {
    const manager = yield* ScreenCaptureManager.ScreenCaptureManager;
    return yield* manager.listSources(input ?? {});
  }),
});

export const captureSource = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.CAPTURE_SOURCE_CHANNEL,
  payload: DesktopCaptureSourceInputSchema,
  result: DesktopCaptureResultSchema,
  handler: Effect.fn("desktop.ipc.capture.captureSource")(function* (input) {
    const manager = yield* ScreenCaptureManager.ScreenCaptureManager;
    return yield* manager.captureSource(input);
  }),
});

export const methods = [getPermissionStatus, listSources, captureSource] as const;
