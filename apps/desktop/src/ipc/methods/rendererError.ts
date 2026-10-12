import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopIpc from "../DesktopIpc.ts";
import { REPORT_RENDERER_ERROR_CHANNEL } from "../channels.ts";
import * as DesktopRendererHistory from "../../telemetry/DesktopRendererHistory.ts";

const RendererErrorReport = Schema.Struct({
  source: Schema.Literals(["window-error", "unhandled-rejection", "render-error"]),
  message: Schema.String.check(Schema.isMaxLength(2_048)),
  stack: Schema.optional(Schema.String.check(Schema.isMaxLength(4_096))),
});

export const reportRendererError = DesktopIpc.makeIpcMethod({
  channel: REPORT_RENDERER_ERROR_CHANNEL,
  payload: RendererErrorReport,
  result: Schema.Void,
  handler: (report, event) =>
    Effect.gen(function* () {
      const history = yield* DesktopRendererHistory.DesktopRendererHistory;
      yield* history.recordError({
        ...(event === undefined ? {} : { webContentsId: event.sender.id }),
        event: report.source,
        message: report.message,
        ...(report.stack === undefined ? {} : { stack: report.stack }),
      });
    }),
});
