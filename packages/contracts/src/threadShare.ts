import * as Schema from "effect/Schema";
import { ThreadId, IsoDateTime, NonNegativeInt } from "./baseSchemas.ts";

export const ThreadShareInput = Schema.Struct({ threadId: ThreadId });
export const ThreadSharePublishInput = Schema.Struct({
  threadId: ThreadId,
  publicBaseUrl: Schema.String.check(Schema.isMaxLength(2_048)),
});
export const ThreadShareInfo = Schema.Struct({
  url: Schema.String,
  publishedAt: IsoDateTime,
  messageCount: NonNegativeInt,
});
export type ThreadShareInfo = typeof ThreadShareInfo.Type;

export class ThreadShareError extends Schema.TaggedError<ThreadShareError>()("ThreadShareError", {
  reason: Schema.Literals(["invalid-url", "empty", "too-large", "unavailable", "storage"]),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    switch (this.reason) {
      case "invalid-url":
        return "Enter an HTTP or HTTPS server URL without credentials, a path, or query parameters.";
      case "empty":
        return "This thread has no messages to share.";
      case "too-large":
        return "This conversation exceeds the 2 MB sharing limit.";
      case "unavailable":
        return "The thread is unavailable.";
      case "storage":
        return "Could not save or read the shared conversation.";
    }
  }
}
