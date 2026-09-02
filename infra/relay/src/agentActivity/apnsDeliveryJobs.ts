import * as NodeCrypto from "node:crypto";

import { AUTH_CREDENTIAL_MAX_LENGTH } from "@t3tools/contracts";
import {
  RELAY_BUNDLE_ID_MAX_LENGTH,
  RELAY_DEVICE_ID_MAX_LENGTH,
  RELAY_ENVIRONMENT_ID_MAX_LENGTH,
  RELAY_PERSISTED_USER_ID_MAX_LENGTH,
  RELAY_THREAD_ID_MAX_LENGTH,
  RELAY_TIMESTAMP_MAX_LENGTH,
  RelayAgentActivityAggregateState,
  RelayAgentAwarenessPhase,
  type RelayDeliveryKind,
} from "@t3tools/contracts/relay";
import { stableStringify } from "@t3tools/shared/relaySigning";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

const MAX_JOB_AGE_MS = 10 * 60 * 1_000;
export const APNS_DELIVERY_JOB_SIGNING_ALGORITHM = "hmac-sha256";
export const APNS_DELIVERY_JOB_MAX_BYTES = 64 * 1024;

const APNS_DELIVERY_JOB_ID_MAX_LENGTH = 64;
const APNS_DELIVERY_TOKEN_MAX_LENGTH = AUTH_CREDENTIAL_MAX_LENGTH;
const APNS_DELIVERY_TEXT_MAX_LENGTH = 512;
const APNS_DELIVERY_DEEP_LINK_MAX_LENGTH = 512;
const APNS_DELIVERY_SIGNATURE_LENGTH = 43;

const ApnsDeliveryJobId = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(APNS_DELIVERY_JOB_ID_MAX_LENGTH),
);
const ApnsDeliveryUserId = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(RELAY_PERSISTED_USER_ID_MAX_LENGTH),
);
const ApnsDeliveryDeviceId = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(RELAY_DEVICE_ID_MAX_LENGTH),
);
const ApnsDeliveryToken = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(APNS_DELIVERY_TOKEN_MAX_LENGTH),
);
const ApnsDeliveryBundleId = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(RELAY_BUNDLE_ID_MAX_LENGTH),
);
const ApnsDeliveryEnvironmentId = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(RELAY_ENVIRONMENT_ID_MAX_LENGTH),
);
const ApnsDeliveryThreadId = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(RELAY_THREAD_ID_MAX_LENGTH),
);
const ApnsDeliveryTimestamp = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(RELAY_TIMESTAMP_MAX_LENGTH),
);
const ApnsDeliveryText = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(APNS_DELIVERY_TEXT_MAX_LENGTH),
);
const ApnsDeliveryDeepLink = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(APNS_DELIVERY_DEEP_LINK_MAX_LENGTH),
);

const ApnsDeliveryKindSchema = Schema.Literals([
  "live_activity_start",
  "live_activity_update",
  "live_activity_end",
  "push_notification",
]);
const LiveActivityStartOrUpdateKindSchema = Schema.Literals([
  "live_activity_start",
  "live_activity_update",
]);
const LiveActivityKindSchema = Schema.Literals([
  "live_activity_start",
  "live_activity_update",
  "live_activity_end",
]);

const ApnsDeliveryJobContext = {
  jobId: ApnsDeliveryJobId,
  userId: ApnsDeliveryUserId,
  deviceId: ApnsDeliveryDeviceId,
};

export const ApnsNotificationPayload = Schema.Struct({
  title: ApnsDeliveryText,
  body: ApnsDeliveryText,
  environmentId: ApnsDeliveryEnvironmentId,
  threadId: ApnsDeliveryThreadId,
  deepLink: ApnsDeliveryDeepLink,
  // Optional so delivery jobs queued by older relay builds still decode.
  // New jobs use these fields to avoid delivering a stale Done/attention
  // notification after the thread has moved to another phase.
  phase: Schema.optional(RelayAgentAwarenessPhase),
  updatedAt: Schema.optional(ApnsDeliveryTimestamp),
});
export type ApnsNotificationPayload = typeof ApnsNotificationPayload.Type;

// Alert copy attached to a Live Activity update/end push. Its presence makes
// the update "alerting": iOS wakes the screen, plays the haptic, and briefly
// expands the Dynamic Island instead of silently redrawing.
export const ApnsLiveActivityAlert = Schema.Struct({
  title: ApnsDeliveryText,
  body: ApnsDeliveryText,
});
export type ApnsLiveActivityAlert = typeof ApnsLiveActivityAlert.Type;

export const ApnsDeliveryJobPayload = Schema.Struct({
  version: Schema.Literal(1),
  jobId: ApnsDeliveryJobId,
  kind: ApnsDeliveryKindSchema,
  target: Schema.Struct({
    userId: ApnsDeliveryUserId,
    deviceId: ApnsDeliveryDeviceId,
    token: ApnsDeliveryToken,
    // Per-device APNs routing; absent on jobs queued by older relay builds,
    // which fall back to the configured defaults.
    bundleId: Schema.optional(Schema.NullOr(ApnsDeliveryBundleId)),
    apsEnvironment: Schema.optional(Schema.NullOr(Schema.Literals(["sandbox", "production"]))),
  }),
  aggregate: Schema.NullOr(RelayAgentActivityAggregateState),
  notification: Schema.NullOr(ApnsNotificationPayload),
  // Optional so jobs queued by older relay builds still decode.
  alert: Schema.optional(Schema.NullOr(ApnsLiveActivityAlert)),
  // Phase/count/row-set changes ship at APNs priority 10 so the card moves
  // the moment work transitions; cosmetic status ticks stay at the
  // budget-friendly low priority. Optional for jobs from older relay builds.
  urgent: Schema.optional(Schema.Boolean),
  createdAt: ApnsDeliveryTimestamp,
  expiresAt: ApnsDeliveryTimestamp,
});
export type ApnsDeliveryJobPayload = typeof ApnsDeliveryJobPayload.Type;

const SignedApnsDeliveryJobStruct = Schema.Struct({
  algorithm: Schema.Literal(APNS_DELIVERY_JOB_SIGNING_ALGORITHM),
  payload: ApnsDeliveryJobPayload,
  signature: Schema.String.check(
    Schema.isMinLength(APNS_DELIVERY_SIGNATURE_LENGTH),
    Schema.isMaxLength(APNS_DELIVERY_SIGNATURE_LENGTH),
    Schema.isPattern(/^[a-z0-9_-]+$/iu),
  ),
});
const signedApnsDeliveryJobSize = Schema.makeFilter(
  (job: typeof SignedApnsDeliveryJobStruct.Type) =>
    Buffer.byteLength(stableStringify(job), "utf8") <= APNS_DELIVERY_JOB_MAX_BYTES ||
    `Signed APNs delivery job must not exceed ${APNS_DELIVERY_JOB_MAX_BYTES} bytes.`,
);
export const SignedApnsDeliveryJob = SignedApnsDeliveryJobStruct.check(signedApnsDeliveryJobSize);
export type SignedApnsDeliveryJob = typeof SignedApnsDeliveryJob.Type;

export class ApnsDeliveryJobQueuePayloadInvalid extends Schema.TaggedErrorClass<ApnsDeliveryJobQueuePayloadInvalid>()(
  "ApnsDeliveryJobQueuePayloadInvalid",
  {
    receivedType: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Invalid APNs delivery queue job with ${this.receivedType} payload.`;
  }
}

export class ApnsDeliveryJobLiveActivityAggregateMissing extends Schema.TaggedErrorClass<ApnsDeliveryJobLiveActivityAggregateMissing>()(
  "ApnsDeliveryJobLiveActivityAggregateMissing",
  {
    ...ApnsDeliveryJobContext,
    kind: LiveActivityStartOrUpdateKindSchema,
  },
) {
  override get message(): string {
    return `APNs ${this.kind.replaceAll("_", " ")} job ${this.jobId} requires an aggregate.`;
  }
}

export class ApnsDeliveryJobLiveActivityNotificationUnexpected extends Schema.TaggedErrorClass<ApnsDeliveryJobLiveActivityNotificationUnexpected>()(
  "ApnsDeliveryJobLiveActivityNotificationUnexpected",
  {
    ...ApnsDeliveryJobContext,
    kind: LiveActivityKindSchema,
  },
) {
  override get message(): string {
    return `APNs ${this.kind.replaceAll("_", " ")} job ${this.jobId} must not carry a push notification payload.`;
  }
}

export class ApnsDeliveryJobPushNotificationMissing extends Schema.TaggedErrorClass<ApnsDeliveryJobPushNotificationMissing>()(
  "ApnsDeliveryJobPushNotificationMissing",
  ApnsDeliveryJobContext,
) {
  override get message(): string {
    return `APNs push notification job ${this.jobId} requires a notification payload.`;
  }
}

export class ApnsDeliveryJobPushNotificationAggregateUnexpected extends Schema.TaggedErrorClass<ApnsDeliveryJobPushNotificationAggregateUnexpected>()(
  "ApnsDeliveryJobPushNotificationAggregateUnexpected",
  ApnsDeliveryJobContext,
) {
  override get message(): string {
    return `APNs push notification job ${this.jobId} must not carry aggregate state.`;
  }
}

export class ApnsDeliveryJobCreatedAtInvalid extends Schema.TaggedErrorClass<ApnsDeliveryJobCreatedAtInvalid>()(
  "ApnsDeliveryJobCreatedAtInvalid",
  {
    ...ApnsDeliveryJobContext,
    kind: ApnsDeliveryKindSchema,
    createdAt: Schema.String,
  },
) {
  override get message(): string {
    return `APNs delivery job ${this.jobId} has invalid creation time ${this.createdAt}.`;
  }
}

export class ApnsDeliveryJobExpiresAtInvalid extends Schema.TaggedErrorClass<ApnsDeliveryJobExpiresAtInvalid>()(
  "ApnsDeliveryJobExpiresAtInvalid",
  {
    ...ApnsDeliveryJobContext,
    kind: ApnsDeliveryKindSchema,
    expiresAt: Schema.String,
  },
) {
  override get message(): string {
    return `APNs delivery job ${this.jobId} has invalid expiry ${this.expiresAt}.`;
  }
}

export class ApnsDeliveryJobTimeWindowInvalid extends Schema.TaggedErrorClass<ApnsDeliveryJobTimeWindowInvalid>()(
  "ApnsDeliveryJobTimeWindowInvalid",
  {
    ...ApnsDeliveryJobContext,
    kind: ApnsDeliveryKindSchema,
    createdAt: Schema.String,
    expiresAt: Schema.String,
  },
) {
  override get message(): string {
    return `APNs delivery job ${this.jobId} has invalid time window ${this.createdAt} to ${this.expiresAt}.`;
  }
}

export class ApnsDeliveryJobTimeWindowTooLong extends Schema.TaggedErrorClass<ApnsDeliveryJobTimeWindowTooLong>()(
  "ApnsDeliveryJobTimeWindowTooLong",
  {
    ...ApnsDeliveryJobContext,
    kind: ApnsDeliveryKindSchema,
    createdAt: Schema.String,
    expiresAt: Schema.String,
  },
) {
  override get message(): string {
    return `APNs delivery job ${this.jobId} time window ${this.createdAt} to ${this.expiresAt} is too long.`;
  }
}

export class ApnsDeliveryJobSignatureInvalid extends Schema.TaggedErrorClass<ApnsDeliveryJobSignatureInvalid>()(
  "ApnsDeliveryJobSignatureInvalid",
  {
    ...ApnsDeliveryJobContext,
    kind: ApnsDeliveryKindSchema,
  },
) {
  override get message(): string {
    return `Invalid signature for APNs delivery job ${this.jobId}.`;
  }
}

export const ApnsDeliveryJobInvalid = Schema.Union([
  ApnsDeliveryJobQueuePayloadInvalid,
  ApnsDeliveryJobLiveActivityAggregateMissing,
  ApnsDeliveryJobLiveActivityNotificationUnexpected,
  ApnsDeliveryJobPushNotificationMissing,
  ApnsDeliveryJobPushNotificationAggregateUnexpected,
  ApnsDeliveryJobCreatedAtInvalid,
  ApnsDeliveryJobExpiresAtInvalid,
  ApnsDeliveryJobTimeWindowInvalid,
  ApnsDeliveryJobTimeWindowTooLong,
  ApnsDeliveryJobSignatureInvalid,
]);
export type ApnsDeliveryJobInvalid = typeof ApnsDeliveryJobInvalid.Type;

export class ApnsDeliveryJobExpired extends Schema.TaggedErrorClass<ApnsDeliveryJobExpired>()(
  "ApnsDeliveryJobExpired",
  {
    ...ApnsDeliveryJobContext,
    kind: ApnsDeliveryKindSchema,
    expiresAt: Schema.String,
  },
) {
  override get message(): string {
    return `APNs delivery job ${this.jobId} expired at ${this.expiresAt}.`;
  }
}

export const ApnsDeliveryJobVerificationError = Schema.Union([
  ApnsDeliveryJobInvalid,
  ApnsDeliveryJobExpired,
]);
export type ApnsDeliveryJobVerificationError = typeof ApnsDeliveryJobVerificationError.Type;

export const isApnsDeliveryJobVerificationError = Schema.is(ApnsDeliveryJobVerificationError);

export function makeApnsDeliveryJobPayload(input: {
  readonly kind: RelayDeliveryKind;
  readonly userId: string;
  readonly deviceId: string;
  readonly token: string;
  readonly bundleId?: string | null | undefined;
  readonly apsEnvironment?: "sandbox" | "production" | null | undefined;
  readonly aggregate: ApnsDeliveryJobPayload["aggregate"];
  readonly notification?: ApnsNotificationPayload | null;
  readonly alert?: ApnsLiveActivityAlert | null | undefined;
  readonly urgent?: boolean | undefined;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly jobId: string;
}): ApnsDeliveryJobPayload {
  return {
    version: 1,
    jobId: input.jobId,
    kind: input.kind,
    target: {
      userId: input.userId,
      deviceId: input.deviceId,
      token: input.token,
      ...(input.bundleId ? { bundleId: input.bundleId } : {}),
      ...(input.apsEnvironment ? { apsEnvironment: input.apsEnvironment } : {}),
    },
    aggregate: input.aggregate,
    notification: input.notification ?? null,
    // Omitted (not null) when absent so signatures stay identical to jobs from
    // relay builds that predate the field.
    ...(input.alert ? { alert: input.alert } : {}),
    ...(input.urgent ? { urgent: true } : {}),
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
  };
}

export function expiresAtForJob(createdAtMs: number): string {
  return DateTime.formatIso(Option.getOrThrow(DateTime.make(createdAtMs + MAX_JOB_AGE_MS)));
}

function validatePayloadShape(payload: ApnsDeliveryJobPayload): ApnsDeliveryJobInvalid | null {
  switch (payload.kind) {
    case "live_activity_start":
    case "live_activity_update":
      if (payload.aggregate === null) {
        return new ApnsDeliveryJobLiveActivityAggregateMissing({
          jobId: payload.jobId,
          kind: payload.kind,
          userId: payload.target.userId,
          deviceId: payload.target.deviceId,
        });
      }
      if (payload.notification !== null) {
        return new ApnsDeliveryJobLiveActivityNotificationUnexpected({
          jobId: payload.jobId,
          kind: payload.kind,
          userId: payload.target.userId,
          deviceId: payload.target.deviceId,
        });
      }
      return null;
    case "live_activity_end":
      if (payload.notification !== null) {
        return new ApnsDeliveryJobLiveActivityNotificationUnexpected({
          jobId: payload.jobId,
          kind: payload.kind,
          userId: payload.target.userId,
          deviceId: payload.target.deviceId,
        });
      }
      return null;
    case "push_notification":
      if (payload.notification === null) {
        return new ApnsDeliveryJobPushNotificationMissing({
          jobId: payload.jobId,
          userId: payload.target.userId,
          deviceId: payload.target.deviceId,
        });
      }
      if (payload.aggregate !== null) {
        return new ApnsDeliveryJobPushNotificationAggregateUnexpected({
          jobId: payload.jobId,
          userId: payload.target.userId,
          deviceId: payload.target.deviceId,
        });
      }
      return null;
  }
}

function signatureForPayload(input: {
  readonly secret: Redacted.Redacted<string>;
  readonly payload: ApnsDeliveryJobPayload;
}): string {
  return NodeCrypto.createHmac("sha256", Redacted.value(input.secret))
    .update(stableStringify(input.payload))
    .digest("base64url");
}

function timingSafeEqualBase64Url(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "base64url");
  const rightBuffer = Buffer.from(right, "base64url");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return NodeCrypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function signApnsDeliveryJob(input: {
  readonly secret: Redacted.Redacted<string>;
  readonly payload: ApnsDeliveryJobPayload;
}): SignedApnsDeliveryJob {
  return {
    algorithm: APNS_DELIVERY_JOB_SIGNING_ALGORITHM,
    payload: input.payload,
    signature: signatureForPayload(input),
  };
}

export function verifySignedApnsDeliveryJob(input: {
  readonly secret: Redacted.Redacted<string>;
  readonly job: SignedApnsDeliveryJob;
  readonly nowMs: number;
}): ApnsDeliveryJobPayload | ApnsDeliveryJobVerificationError {
  const payload = input.job.payload;
  const invalidPayload = validatePayloadShape(payload);
  if (invalidPayload !== null) {
    return invalidPayload;
  }
  const createdAt = DateTime.make(payload.createdAt);
  if (Option.isNone(createdAt)) {
    return new ApnsDeliveryJobCreatedAtInvalid({
      jobId: payload.jobId,
      kind: payload.kind,
      userId: payload.target.userId,
      deviceId: payload.target.deviceId,
      createdAt: payload.createdAt,
    });
  }
  const expiresAt = DateTime.make(payload.expiresAt);
  if (Option.isNone(expiresAt)) {
    return new ApnsDeliveryJobExpiresAtInvalid({
      jobId: payload.jobId,
      kind: payload.kind,
      userId: payload.target.userId,
      deviceId: payload.target.deviceId,
      expiresAt: payload.expiresAt,
    });
  }
  const createdAtMs = createdAt.value.epochMilliseconds;
  const expiresAtMs = expiresAt.value.epochMilliseconds;
  if (expiresAtMs <= createdAtMs) {
    return new ApnsDeliveryJobTimeWindowInvalid({
      jobId: payload.jobId,
      kind: payload.kind,
      userId: payload.target.userId,
      deviceId: payload.target.deviceId,
      createdAt: payload.createdAt,
      expiresAt: payload.expiresAt,
    });
  }
  if (expiresAtMs - createdAtMs > MAX_JOB_AGE_MS) {
    return new ApnsDeliveryJobTimeWindowTooLong({
      jobId: payload.jobId,
      kind: payload.kind,
      userId: payload.target.userId,
      deviceId: payload.target.deviceId,
      createdAt: payload.createdAt,
      expiresAt: payload.expiresAt,
    });
  }
  if (expiresAtMs <= input.nowMs) {
    return new ApnsDeliveryJobExpired({
      jobId: payload.jobId,
      kind: payload.kind,
      userId: payload.target.userId,
      deviceId: payload.target.deviceId,
      expiresAt: payload.expiresAt,
    });
  }
  const expected = signatureForPayload({
    secret: input.secret,
    payload,
  });
  if (!timingSafeEqualBase64Url(input.job.signature, expected)) {
    return new ApnsDeliveryJobSignatureInvalid({
      jobId: payload.jobId,
      kind: payload.kind,
      userId: payload.target.userId,
      deviceId: payload.target.deviceId,
    });
  }
  return payload;
}
