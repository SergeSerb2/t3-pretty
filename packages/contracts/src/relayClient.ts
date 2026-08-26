import * as Schema from "effect/Schema";

export const RELAY_CLIENT_PATH_MAX_LENGTH = 32 * 1024;
export const RELAY_CLIENT_VERSION_MAX_LENGTH = 256;
export const RELAY_CLIENT_PLATFORM_MAX_LENGTH = 128;
export const RELAY_CLIENT_ERROR_MAX_LENGTH = 8_192;

export const RelayClientStatusSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    executablePath: Schema.String.check(Schema.isMaxLength(RELAY_CLIENT_PATH_MAX_LENGTH)),
    source: Schema.Literals(["override", "managed", "path"]),
    version: Schema.String.check(Schema.isMaxLength(RELAY_CLIENT_VERSION_MAX_LENGTH)),
  }),
  Schema.Struct({
    status: Schema.Literal("missing"),
    version: Schema.String.check(Schema.isMaxLength(RELAY_CLIENT_VERSION_MAX_LENGTH)),
  }),
  Schema.Struct({
    status: Schema.Literal("unsupported"),
    platform: Schema.String.check(Schema.isMaxLength(RELAY_CLIENT_PLATFORM_MAX_LENGTH)),
    arch: Schema.String.check(Schema.isMaxLength(RELAY_CLIENT_PLATFORM_MAX_LENGTH)),
    version: Schema.String.check(Schema.isMaxLength(RELAY_CLIENT_VERSION_MAX_LENGTH)),
  }),
]);
export type RelayClientStatus = typeof RelayClientStatusSchema.Type;

export const RelayClientInstallProgressStageSchema = Schema.Literals([
  "checking",
  "waiting_for_lock",
  "downloading",
  "verifying",
  "installing",
  "validating",
  "activating",
]);
export type RelayClientInstallProgressStage = typeof RelayClientInstallProgressStageSchema.Type;

export const RelayClientInstallProgressEventSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("progress"),
    stage: RelayClientInstallProgressStageSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("complete"),
    status: RelayClientStatusSchema,
  }),
]);
export type RelayClientInstallProgressEvent = typeof RelayClientInstallProgressEventSchema.Type;

export const RelayClientInstallFailureReasonSchema = Schema.Literals([
  "download_failed",
  "invalid_checksum",
  "install_locked",
  "override_missing",
  "unsupported_platform",
  "validation_failed",
  "write_failed",
]);
export type RelayClientInstallFailureReason = typeof RelayClientInstallFailureReasonSchema.Type;

export class RelayClientInstallFailedError extends Schema.TaggedErrorClass<RelayClientInstallFailedError>()(
  "RelayClientInstallFailedError",
  {
    reason: RelayClientInstallFailureReasonSchema,
    message: Schema.String.check(Schema.isMaxLength(RELAY_CLIENT_ERROR_MAX_LENGTH)),
  },
) {}
