import * as Schema from "effect/Schema";

import { EnvironmentId, NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { RuntimeMode, ProviderInteractionMode } from "./providerPolicy.ts";

const REMOTE_CONTEXT_MAX_FILES = 8;
export const REMOTE_CONTEXT_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const REMOTE_CONTEXT_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
// Base64 plus bounded text, paths, and JSON framing. Enforce this before decoding.
export const REMOTE_CONTEXT_MAX_BODY_BYTES = 12 * 1024 * 1024;
export const REMOTE_CONTEXT_PROOF_TYP = "t3-remote-context+jwt";
export const REMOTE_CONTEXT_ROUTE = "/api/connect/thread-context";

const BoundedId = TrimmedNonEmptyString.check(Schema.isMaxLength(256));
const RelativeFilePath = TrimmedNonEmptyString.check(
  Schema.isMaxLength(1024),
  Schema.makeFilter((path) =>
    !path.includes("\\") &&
    !path.includes(":") &&
    !path.includes("\0") &&
    !path.startsWith("/") &&
    path
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== ".." && part.length <= 255)
      ? true
      : "Use a relative file path without parent segments.",
  ),
);
const Message = Schema.String.check(Schema.isMaxLength(32_000));

export const RemoteContextSendInput = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
  message: Message,
  files: Schema.optional(
    Schema.Array(RelativeFilePath).check(Schema.isMaxLength(REMOTE_CONTEXT_MAX_FILES)),
  ),
  maxBytes: Schema.optional(
    NonNegativeInt.check(Schema.isLessThanOrEqualTo(REMOTE_CONTEXT_MAX_TOTAL_BYTES)),
  ),
  clientRequestId: BoundedId,
});
export type RemoteContextSendInput = typeof RemoteContextSendInput.Type;

export const RemoteContextRequest = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("list"),
    query: Schema.String.check(Schema.isMaxLength(256)),
  }),
  Schema.Struct({
    action: Schema.Literal("send"),
    threadId: ThreadId,
    message: Message,
    clientRequestId: BoundedId,
    files: Schema.Array(
      Schema.Struct({
        path: RelativeFilePath,
        base64: Schema.String.check(
          Schema.isMaxLength(4 * Math.ceil(REMOTE_CONTEXT_MAX_FILE_BYTES / 3)),
          Schema.isPattern(/^[A-Za-z0-9+/]*={0,2}$/),
        ),
      }),
    ).check(Schema.isMaxLength(REMOTE_CONTEXT_MAX_FILES)),
  }),
]);
export type RemoteContextRequest = typeof RemoteContextRequest.Type;

export const RemoteContextAuthorization = Schema.Struct({
  environmentId: EnvironmentId,
  sourceThreadId: ThreadId,
  digest: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
});
export type RemoteContextAuthorization = typeof RemoteContextAuthorization.Type;

export const RemoteContextProof = Schema.Struct({
  ...RemoteContextAuthorization.fields,
  sourceEnvironmentId: EnvironmentId,
  iss: Schema.String,
  aud: Schema.String,
  sub: Schema.String,
  jti: Schema.String,
  iat: Schema.Int,
  exp: Schema.Int,
});
export type RemoteContextProof = typeof RemoteContextProof.Type;

export const RemoteContextPeers = Schema.Struct({
  environments: Schema.Array(Schema.Struct({ environmentId: EnvironmentId, label: Schema.String })),
});
export type RemoteContextPeers = typeof RemoteContextPeers.Type;
export const RemoteContextTicket = Schema.Struct({
  httpBaseUrl: Schema.String,
  proof: Schema.String,
});
export const RemoteContextResult = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("list"),
    threads: Schema.Array(
      Schema.Struct({
        threadId: ThreadId,
        title: Schema.String,
        runtimeMode: RuntimeMode,
        interactionMode: ProviderInteractionMode,
      }),
    ).check(Schema.isMaxLength(50)),
  }),
  Schema.Struct({
    action: Schema.Literal("send"),
    threadId: ThreadId,
    fileCount: NonNegativeInt,
    totalBytes: NonNegativeInt,
  }),
]);
export type RemoteContextResult = typeof RemoteContextResult.Type;
