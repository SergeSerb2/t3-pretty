import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import * as HttpApiMiddleware from "effect/unstable/httpapi/HttpApiMiddleware";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";
import * as HttpApiSecurity from "effect/unstable/httpapi/HttpApiSecurity";
import * as OpenApi from "effect/unstable/httpapi/OpenApi";

import {
  AUTH_ACCESS_TOKEN_MAX_EXPIRES_IN_SECONDS,
  AUTH_CLIENT_LABEL_MAX_LENGTH,
  AUTH_CREDENTIAL_MAX_LENGTH,
  AuthClientLabel,
  AuthCredential,
  AuthIdentifier,
  AuthOAuthScope,
  AuthProofKeyThumbprint,
  AuthSubject,
} from "./auth.ts";
import { EnvironmentId, NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ExecutionEnvironmentDescriptor } from "./environment.ts";

export const SECURE_RELAY_URL_MAX_LENGTH = 8_192;
export const RELAY_PUBLIC_KEY_MAX_LENGTH = AUTH_CREDENTIAL_MAX_LENGTH;
export const RELAY_AUTHORIZATION_HEADER_MAX_LENGTH = AUTH_CREDENTIAL_MAX_LENGTH + 128;
export const RELAY_DPOP_PROOF_MAX_LENGTH = 64 * 1024;
export const RELAY_DEVICE_MAX_COUNT = 128;
export const RELAY_ENVIRONMENT_MAX_COUNT = 1_024;
export const RELAY_ACTIVITY_MAX_COUNT = 128;
// Project and thread activity titles originate in orchestration snapshots.
export const RELAY_TITLE_MAX_LENGTH = 8_192;
export const RELAY_DETAIL_MAX_LENGTH = 4_096;
export const RELAY_DEEP_LINK_MAX_LENGTH = 8_192;
export const RELAY_TRACE_ID_MAX_LENGTH = 256;
export const RELAY_PERSISTED_USER_ID_MAX_LENGTH = 191;
export const RELAY_ENVIRONMENT_ID_MAX_LENGTH = 191;
export const RELAY_THREAD_ID_MAX_LENGTH = 191;
export const RELAY_DEVICE_ID_MAX_LENGTH = 191;
export const RELAY_ENVIRONMENT_LABEL_MAX_LENGTH = AUTH_CLIENT_LABEL_MAX_LENGTH;
export const RELAY_APP_VERSION_MAX_LENGTH = 64;
export const RELAY_BUNDLE_ID_MAX_LENGTH = 255;
export const RELAY_MANAGED_RESOURCE_ID_MAX_LENGTH = 191;
export const RELAY_TIMESTAMP_MAX_LENGTH = 64;
export const RELAY_IOS_MAJOR_VERSION_MAX = 999;
export const RELAY_JWT_CLAIM_MAX_LENGTH = 8_192;
export const RELAY_JWT_ID_MAX_LENGTH = 4_096;

const RelayUrl = TrimmedNonEmptyString.check(Schema.isMaxLength(SECURE_RELAY_URL_MAX_LENGTH));
const RelayPublicKey = TrimmedNonEmptyString.check(Schema.isMaxLength(RELAY_PUBLIC_KEY_MAX_LENGTH));
const RelayJwt = TrimmedNonEmptyString.check(Schema.isMaxLength(RELAY_DPOP_PROOF_MAX_LENGTH));
const RelayTitle = TrimmedNonEmptyString.check(Schema.isMaxLength(RELAY_TITLE_MAX_LENGTH));
const RelayDetail = TrimmedNonEmptyString.check(Schema.isMaxLength(RELAY_DETAIL_MAX_LENGTH));
const RelayDeepLink = TrimmedNonEmptyString.check(Schema.isMaxLength(RELAY_DEEP_LINK_MAX_LENGTH));
const RelayTraceId = TrimmedNonEmptyString.check(Schema.isMaxLength(RELAY_TRACE_ID_MAX_LENGTH));
const canonicalRelayTimestamp = Schema.makeFilter((value: string) => {
  const parsed = DateTime.make(value);
  return (
    (Option.isSome(parsed) && DateTime.formatIso(parsed.value) === value) ||
    "Relay timestamps must use canonical UTC ISO-8601 format."
  );
});
const RelayTimestamp = TrimmedNonEmptyString.check(
  Schema.isMaxLength(RELAY_TIMESTAMP_MAX_LENGTH),
  canonicalRelayTimestamp,
);
const RelayJwtClaim = TrimmedNonEmptyString.check(Schema.isMaxLength(RELAY_JWT_CLAIM_MAX_LENGTH));
const RelayJwtId = TrimmedNonEmptyString.check(Schema.isMaxLength(RELAY_JWT_ID_MAX_LENGTH));
export const RelayCloudUserId = AuthSubject.check(
  Schema.isMaxLength(RELAY_PERSISTED_USER_ID_MAX_LENGTH),
);
export const RelayEnvironmentId = EnvironmentId.check(
  Schema.isMaxLength(RELAY_ENVIRONMENT_ID_MAX_LENGTH),
);
export const RelayThreadId = ThreadId.check(Schema.isMaxLength(RELAY_THREAD_ID_MAX_LENGTH));
export const RelayDeviceId = AuthIdentifier.check(Schema.isMaxLength(RELAY_DEVICE_ID_MAX_LENGTH));
const RelayAppVersion = AuthIdentifier.check(Schema.isMaxLength(RELAY_APP_VERSION_MAX_LENGTH));
const RelayBundleId = AuthIdentifier.check(Schema.isMaxLength(RELAY_BUNDLE_ID_MAX_LENGTH));
const RelayManagedResourceId = AuthIdentifier.check(
  Schema.isMaxLength(RELAY_MANAGED_RESOURCE_ID_MAX_LENGTH),
);

export const RelayAgentAwarenessPlatform = Schema.Literal("ios");
export type RelayAgentAwarenessPlatform = typeof RelayAgentAwarenessPlatform.Type;

export const RelayAgentAwarenessPhase = Schema.Literals([
  "starting",
  "running",
  "waiting_for_approval",
  "waiting_for_input",
  "completed",
  "failed",
  "stale",
]);
export type RelayAgentAwarenessPhase = typeof RelayAgentAwarenessPhase.Type;

export const RelayAgentAwarenessPreferences = Schema.Struct({
  liveActivitiesEnabled: Schema.Boolean,
  notificationsEnabled: Schema.Boolean,
  notifyOnApproval: Schema.Boolean,
  notifyOnInput: Schema.Boolean,
  notifyOnCompletion: Schema.Boolean,
  notifyOnFailure: Schema.Boolean,
});
export type RelayAgentAwarenessPreferences = typeof RelayAgentAwarenessPreferences.Type;

export const RelayApnsEnvironment = Schema.Literals(["sandbox", "production"]);
export type RelayApnsEnvironment = typeof RelayApnsEnvironment.Type;

export const RelayDeviceRegistrationRequest = Schema.Struct({
  deviceId: RelayDeviceId,
  label: AuthClientLabel,
  platform: RelayAgentAwarenessPlatform,
  iosMajorVersion: Schema.Int.check(
    Schema.isBetween({ minimum: 18, maximum: RELAY_IOS_MAJOR_VERSION_MAX }),
  ),
  appVersion: Schema.optional(RelayAppVersion),
  // APNs routing for this install: the topic must match the app's bundle id
  // (dev/preview/prod variants differ) and development-signed builds receive
  // sandbox tokens. Optional so older app builds keep registering; the relay
  // falls back to its configured defaults.
  bundleId: Schema.optional(RelayBundleId),
  apsEnvironment: Schema.optional(RelayApnsEnvironment),
  pushToken: Schema.optional(AuthCredential),
  pushToStartToken: Schema.optional(AuthCredential),
  preferences: RelayAgentAwarenessPreferences,
});
export type RelayDeviceRegistrationRequest = typeof RelayDeviceRegistrationRequest.Type;

export const RelayClientDeviceRecord = Schema.Struct({
  deviceId: RelayDeviceId,
  label: AuthClientLabel,
  platform: RelayAgentAwarenessPlatform,
  iosMajorVersion: Schema.Int.check(
    Schema.isBetween({ minimum: 18, maximum: RELAY_IOS_MAJOR_VERSION_MAX }),
  ),
  appVersion: Schema.NullOr(RelayAppVersion),
  notifications: Schema.Struct({
    enabled: Schema.Boolean,
    notifyOnApproval: Schema.Boolean,
    notifyOnInput: Schema.Boolean,
    notifyOnCompletion: Schema.Boolean,
    notifyOnFailure: Schema.Boolean,
  }),
  liveActivities: Schema.Struct({
    enabled: Schema.Boolean,
  }),
  updatedAt: RelayTimestamp,
});
export type RelayClientDeviceRecord = typeof RelayClientDeviceRecord.Type;

export const RelayListDevicesResponse = Schema.Struct({
  devices: Schema.Array(RelayClientDeviceRecord).check(Schema.isMaxLength(RELAY_DEVICE_MAX_COUNT)),
});
export type RelayListDevicesResponse = typeof RelayListDevicesResponse.Type;

export const RelayLiveActivityRegistrationRequest = Schema.Struct({
  deviceId: RelayDeviceId,
  activityPushToken: AuthCredential,
});
export type RelayLiveActivityRegistrationRequest = typeof RelayLiveActivityRegistrationRequest.Type;

export const RelayDeviceUnregistrationParams = Schema.Struct({
  deviceId: RelayDeviceId,
});
export type RelayDeviceUnregistrationParams = typeof RelayDeviceUnregistrationParams.Type;

export const RelayAgentActivityProgress = Schema.Number.check(
  Schema.isBetween({ minimum: 0, maximum: 1 }),
);

export const RelayAgentActivityState = Schema.Struct({
  environmentId: RelayEnvironmentId,
  threadId: RelayThreadId,
  projectTitle: RelayTitle,
  threadTitle: RelayTitle,
  phase: RelayAgentAwarenessPhase,
  headline: RelayTitle,
  detail: Schema.optional(RelayDetail),
  modelTitle: RelayTitle,
  updatedAt: RelayTimestamp,
  deepLink: RelayDeepLink,
  // Plan completion ratio for running work, so remote card updates carry the
  // same progress bar the phone paints from its own thread shells.
  progress: Schema.optional(RelayAgentActivityProgress),
  // When the in-flight turn started, so the Live Activity can render a
  // ticking elapsed timer that stays live between pushes. Absent for
  // waiting/terminal rows and for payloads from older servers.
  startedAt: Schema.optional(RelayTimestamp),
});
export type RelayAgentActivityState = typeof RelayAgentActivityState.Type;

export const RelayAgentActivityAggregateRow = Schema.Struct({
  environmentId: RelayEnvironmentId,
  threadId: RelayThreadId,
  projectTitle: RelayTitle,
  threadTitle: RelayTitle,
  modelTitle: RelayTitle,
  phase: RelayAgentAwarenessPhase,
  status: RelayTitle,
  updatedAt: RelayTimestamp,
  deepLink: RelayDeepLink,
  progress: Schema.optional(RelayAgentActivityProgress),
  startedAt: Schema.optional(RelayTimestamp),
});
export type RelayAgentActivityAggregateRow = typeof RelayAgentActivityAggregateRow.Type;

export const RelayAgentActivityAggregateState = Schema.Struct({
  title: RelayTitle,
  subtitle: RelayTitle,
  activeCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  updatedAt: RelayTimestamp,
  activities: Schema.Array(RelayAgentActivityAggregateRow).check(
    Schema.isMaxLength(RELAY_ACTIVITY_MAX_COUNT),
  ),
});
export type RelayAgentActivityAggregateState = typeof RelayAgentActivityAggregateState.Type;

export const RelayManagedEndpointProviderKind = Schema.Literals([
  "manual",
  "cloudflare_tunnel",
  "t3_relay",
]);
export type RelayManagedEndpointProviderKind = typeof RelayManagedEndpointProviderKind.Type;

export const RelayManagedEndpoint = Schema.Struct({
  httpBaseUrl: RelayUrl,
  wsBaseUrl: RelayUrl,
  providerKind: RelayManagedEndpointProviderKind,
});
export type RelayManagedEndpoint = typeof RelayManagedEndpoint.Type;

export const RelayManagedEndpointOrigin = Schema.Struct({
  localHttpHost: TrimmedNonEmptyString.check(Schema.isMaxLength(1_024)),
  localHttpPort: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(1),
    Schema.isLessThanOrEqualTo(65_535),
  ),
});
export type RelayManagedEndpointOrigin = typeof RelayManagedEndpointOrigin.Type;

export const RelayManagedEndpointRuntimeConfig = Schema.Struct({
  providerKind: RelayManagedEndpointProviderKind,
  connectorToken: AuthCredential,
  tunnelId: Schema.optional(RelayManagedResourceId),
  tunnelName: Schema.optional(AuthClientLabel),
});
export type RelayManagedEndpointRuntimeConfig = typeof RelayManagedEndpointRuntimeConfig.Type;

export const RelayManagedEndpointRuntimeStatus = Schema.Union([
  Schema.Struct({ status: Schema.Literal("disabled") }),
  Schema.Struct({
    status: Schema.Literal("failed"),
    providerKind: RelayManagedEndpointProviderKind,
    reason: RelayDetail,
    tunnelId: Schema.optional(RelayManagedResourceId),
    tunnelName: Schema.optional(AuthClientLabel),
  }),
  Schema.Struct({
    status: Schema.Literal("running"),
    providerKind: Schema.Literal("cloudflare_tunnel"),
    pid: NonNegativeInt,
    tunnelId: Schema.optional(RelayManagedResourceId),
    tunnelName: Schema.optional(AuthClientLabel),
  }),
  Schema.Struct({
    status: Schema.Literal("unsupported"),
    providerKind: RelayManagedEndpointProviderKind,
  }),
]);
export type RelayManagedEndpointRuntimeStatus = typeof RelayManagedEndpointRuntimeStatus.Type;

export const RelayLinkProofRequest = Schema.Struct({
  challenge: Schema.String.check(Schema.isMaxLength(AUTH_CREDENTIAL_MAX_LENGTH)),
  relayIssuer: RelayUrl,
  endpoint: RelayManagedEndpoint,
  origin: RelayManagedEndpointOrigin,
});
export type RelayLinkProofRequest = typeof RelayLinkProofRequest.Type;

export const RelayEnvironmentConfigRequest = Schema.Struct({
  relayUrl: RelayUrl,
  relayIssuer: Schema.optional(RelayUrl),
  cloudUserId: RelayCloudUserId,
  environmentCredential: AuthCredential,
  cloudMintPublicKey: RelayPublicKey,
  endpointRuntime: Schema.NullOr(RelayManagedEndpointRuntimeConfig),
});
export type RelayEnvironmentConfigRequest = typeof RelayEnvironmentConfigRequest.Type;

const RelaySignedJwtRegisteredClaims = {
  iss: RelayJwtClaim,
  aud: RelayJwtClaim,
  sub: RelayJwtClaim,
  jti: RelayJwtId,
  iat: NonNegativeInt,
  exp: NonNegativeInt,
} as const;

export const RelayAgentActivityPublishProofPayload = Schema.Struct({
  ...RelaySignedJwtRegisteredClaims,
  environmentId: RelayEnvironmentId,
  threadId: RelayThreadId,
  state: Schema.NullOr(RelayAgentActivityState),
});
export type RelayAgentActivityPublishProofPayload =
  typeof RelayAgentActivityPublishProofPayload.Type;
export type RelayAgentActivityPublishProof = string;

export const RelayAgentActivityPublishRequest = Schema.Struct({
  state: Schema.NullOr(RelayAgentActivityState).annotate({
    description: "Current agent-awareness state, or null to remove the published state.",
  }),
  proof: RelayJwt.annotate({
    description: "Environment-signed JWT covering this published activity state.",
  }),
}).annotate({ description: "Publishes a signed agent-awareness update from an environment." });
export type RelayAgentActivityPublishRequest = typeof RelayAgentActivityPublishRequest.Type;

export const RelayEnvironmentLinkScope = Schema.Literals([
  "agent_activity_notifications",
  "managed_tunnels",
]);
export type RelayEnvironmentLinkScope = typeof RelayEnvironmentLinkScope.Type;

export const RelayEnvironmentLinkProofPayload = Schema.Struct({
  ...RelaySignedJwtRegisteredClaims,
  challenge: AuthCredential,
  descriptor: ExecutionEnvironmentDescriptor,
  environmentId: RelayEnvironmentId,
  environmentPublicKey: RelayPublicKey,
  endpoint: RelayManagedEndpoint,
  origin: RelayManagedEndpointOrigin,
  scopes: Schema.Array(RelayEnvironmentLinkScope).check(Schema.isMaxLength(2)),
});
export type RelayEnvironmentLinkProofPayload = typeof RelayEnvironmentLinkProofPayload.Type;

export const RelayEnvironmentLinkProof = RelayJwt;
export type RelayEnvironmentLinkProof = typeof RelayEnvironmentLinkProof.Type;

export const RelayEnvironmentLinkChallengeRequest = Schema.Struct({
  notificationsEnabled: Schema.Boolean.annotate({
    description: "Whether this link may deliver push notifications.",
  }),
  liveActivitiesEnabled: Schema.Boolean.annotate({
    description: "Whether this link may update Live Activities.",
  }),
  managedTunnelsEnabled: Schema.Boolean.annotate({
    description: "Whether the relay should provision a managed tunnel for this environment.",
  }),
}).annotate({ description: "Requested capabilities for a new environment-link challenge." });
export type RelayEnvironmentLinkChallengeRequest = typeof RelayEnvironmentLinkChallengeRequest.Type;

export const RelayEnvironmentLinkChallengeResponse = Schema.Struct({
  challenge: AuthCredential,
  expiresAt: RelayTimestamp,
});
export type RelayEnvironmentLinkChallengeResponse =
  typeof RelayEnvironmentLinkChallengeResponse.Type;

export const RelayEnvironmentLinkRequest = Schema.Struct({
  deviceId: Schema.optional(
    RelayDeviceId.annotate({
      description: "Optional client device identifier associated with this link.",
    }),
  ),
  proof: RelayEnvironmentLinkProof.annotate({
    description: "Environment-signed proof bound to a previously issued link challenge.",
  }),
  notificationsEnabled: Schema.Boolean,
  liveActivitiesEnabled: Schema.Boolean,
  managedTunnelsEnabled: Schema.Boolean,
}).annotate({ description: "Links an authenticated cloud user to a T3 environment." });
export type RelayEnvironmentLinkRequest = typeof RelayEnvironmentLinkRequest.Type;

export const RelayEnvironmentLinkResponse = Schema.Struct({
  ok: Schema.Boolean,
  cloudUserId: RelayCloudUserId,
  environmentId: RelayEnvironmentId,
  endpoint: RelayManagedEndpoint,
  endpointRuntime: Schema.NullOr(RelayManagedEndpointRuntimeConfig),
  relayIssuer: RelayUrl,
  environmentCredential: AuthCredential,
  cloudMintPublicKey: RelayPublicKey,
});
export type RelayEnvironmentLinkResponse = typeof RelayEnvironmentLinkResponse.Type;

export const RelayEnvironmentLinkProofInvalidReason = Schema.Literals([
  "invalid_signature_or_scope",
  "descriptor_mismatch",
  "replayed_nonce",
  "challenge_invalid",
  "origin_not_allowed",
  "endpoint_not_secure",
]);
export type RelayEnvironmentLinkProofInvalidReason =
  typeof RelayEnvironmentLinkProofInvalidReason.Type;

export const RelayEnvironmentLinkFailedReason = Schema.Literals([
  "link_persistence_failed",
  "credential_persistence_failed",
  "replay_persistence_failed",
  "internal_error",
]);
export type RelayEnvironmentLinkFailedReason = typeof RelayEnvironmentLinkFailedReason.Type;

export const RelayEnvironmentLinkUnavailableReason = Schema.Literals([
  "managed_endpoint_not_configured",
  "managed_endpoint_provisioning_failed",
]);
export type RelayEnvironmentLinkUnavailableReason =
  typeof RelayEnvironmentLinkUnavailableReason.Type;

export const RelayEnvironmentEndpointUnavailableReason = Schema.Literals([
  "endpoint_request_failed",
  "endpoint_response_invalid",
]);
export type RelayEnvironmentEndpointUnavailableReason =
  typeof RelayEnvironmentEndpointUnavailableReason.Type;

export const RelayAgentActivityPublishProofInvalidReason = Schema.Literals([
  "invalid_signature_or_payload",
  "replayed_nonce",
]);
export type RelayAgentActivityPublishProofInvalidReason =
  typeof RelayAgentActivityPublishProofInvalidReason.Type;

export const RelayAuthInvalidReason = Schema.Literals([
  "missing_bearer",
  "invalid_bearer",
  "invalid_dpop",
  "not_authorized",
]);
export type RelayAuthInvalidReason = typeof RelayAuthInvalidReason.Type;

export const RelayInternalErrorReason = Schema.Literals([
  "database_unavailable",
  "persistence_failed",
  "upstream_unavailable",
  "internal_error",
]);
export type RelayInternalErrorReason = typeof RelayInternalErrorReason.Type;

export class RelayAuthInvalidError extends Schema.TaggedErrorClass<RelayAuthInvalidError>()(
  "RelayAuthInvalidError",
  {
    code: Schema.Literal("auth_invalid"),
    reason: RelayAuthInvalidReason,
    traceId: RelayTraceId,
  },
  { httpApiStatus: 401 },
) {
  override get message(): string {
    return `Relay authentication failed: ${this.reason}`;
  }
}

export class RelayEnvironmentLinkProofExpiredError extends Schema.TaggedErrorClass<RelayEnvironmentLinkProofExpiredError>()(
  "RelayEnvironmentLinkProofExpiredError",
  {
    code: Schema.Literal("environment_link_proof_expired"),
    traceId: RelayTraceId,
  },
  { httpApiStatus: 401 },
) {
  override get message(): string {
    return "Relay environment link proof expired";
  }
}

export class RelayEnvironmentLinkProofInvalidError extends Schema.TaggedErrorClass<RelayEnvironmentLinkProofInvalidError>()(
  "RelayEnvironmentLinkProofInvalidError",
  {
    code: Schema.Literal("environment_link_proof_invalid"),
    reason: RelayEnvironmentLinkProofInvalidReason,
    traceId: RelayTraceId,
  },
  { httpApiStatus: 400 },
) {
  override get message(): string {
    return `Relay environment link proof is invalid: ${this.reason}`;
  }
}

export const RelayEnvironmentConnectNotAuthorizedReason = Schema.Literals([
  "client_proof_key_thumbprint_missing",
  "environment_link_not_found",
  "endpoint_provider_not_managed",
  "managed_endpoint_allocation_not_found",
  "managed_endpoint_base_domain_not_configured",
  "managed_endpoint_allocation_not_ready",
  "managed_endpoint_hostname_invalid",
  "managed_endpoint_mismatch",
]);
export type RelayEnvironmentConnectNotAuthorizedReason =
  typeof RelayEnvironmentConnectNotAuthorizedReason.Type;

export class RelayEnvironmentConnectNotAuthorizedError extends Schema.TaggedErrorClass<RelayEnvironmentConnectNotAuthorizedError>()(
  "RelayEnvironmentConnectNotAuthorizedError",
  {
    code: Schema.Literal("environment_connect_not_authorized"),
    // Optional so responses from relays deployed before the reason was
    // threaded through still decode.
    reason: Schema.optional(RelayEnvironmentConnectNotAuthorizedReason),
    traceId: RelayTraceId,
  },
  { httpApiStatus: 403 },
) {
  override get message(): string {
    return this.reason
      ? `Relay environment connection is not authorized: ${this.reason}`
      : "Relay environment connection is not authorized";
  }
}

export class RelayEnvironmentEndpointUnavailableError extends Schema.TaggedErrorClass<RelayEnvironmentEndpointUnavailableError>()(
  "RelayEnvironmentEndpointUnavailableError",
  {
    code: Schema.Literal("environment_endpoint_unavailable"),
    reason: RelayEnvironmentEndpointUnavailableReason,
    traceId: RelayTraceId,
  },
  { httpApiStatus: 502 },
) {
  override get message(): string {
    return `Relay environment endpoint is unavailable: ${this.reason}`;
  }
}

export class RelayEnvironmentEndpointTimedOutError extends Schema.TaggedErrorClass<RelayEnvironmentEndpointTimedOutError>()(
  "RelayEnvironmentEndpointTimedOutError",
  {
    code: Schema.Literal("environment_endpoint_timed_out"),
    traceId: RelayTraceId,
  },
  { httpApiStatus: 504 },
) {
  override get message(): string {
    return "Relay environment endpoint request timed out";
  }
}

export class RelayEnvironmentLinkFailedError extends Schema.TaggedErrorClass<RelayEnvironmentLinkFailedError>()(
  "RelayEnvironmentLinkFailedError",
  {
    code: Schema.Literal("environment_link_failed"),
    reason: RelayEnvironmentLinkFailedReason,
    traceId: RelayTraceId,
  },
  { httpApiStatus: 500 },
) {
  override get message(): string {
    return `Relay environment link failed: ${this.reason}`;
  }
}

export class RelayEnvironmentLinkUnavailableError extends Schema.TaggedErrorClass<RelayEnvironmentLinkUnavailableError>()(
  "RelayEnvironmentLinkUnavailableError",
  {
    code: Schema.Literal("environment_link_unavailable"),
    reason: RelayEnvironmentLinkUnavailableReason,
    traceId: RelayTraceId,
  },
  { httpApiStatus: 503 },
) {
  override get message(): string {
    return `Relay environment link is unavailable: ${this.reason}`;
  }
}

export class RelayEnvironmentLinkLimitExceededError extends Schema.TaggedErrorClass<RelayEnvironmentLinkLimitExceededError>()(
  "RelayEnvironmentLinkLimitExceededError",
  {
    code: Schema.Literal("environment_link_limit_exceeded"),
    maxTunnels: NonNegativeInt,
    traceId: RelayTraceId,
  },
  { httpApiStatus: 403 },
) {
  override get message(): string {
    return `Relay managed tunnel limit reached: this account allows at most ${this.maxTunnels} tunnels`;
  }
}

export class RelayAgentActivityPublishProofExpiredError extends Schema.TaggedErrorClass<RelayAgentActivityPublishProofExpiredError>()(
  "RelayAgentActivityPublishProofExpiredError",
  {
    code: Schema.Literal("agent_activity_publish_proof_expired"),
    traceId: RelayTraceId,
  },
  { httpApiStatus: 401 },
) {
  override get message(): string {
    return "Relay agent activity publish proof expired";
  }
}

export class RelayAgentActivityPublishProofInvalidError extends Schema.TaggedErrorClass<RelayAgentActivityPublishProofInvalidError>()(
  "RelayAgentActivityPublishProofInvalidError",
  {
    code: Schema.Literal("agent_activity_publish_proof_invalid"),
    reason: RelayAgentActivityPublishProofInvalidReason,
    traceId: RelayTraceId,
  },
  { httpApiStatus: 401 },
) {
  override get message(): string {
    return `Relay agent activity publish proof is invalid: ${this.reason}`;
  }
}

export class RelayInternalError extends Schema.TaggedErrorClass<RelayInternalError>()(
  "RelayInternalError",
  {
    code: Schema.Literal("internal_error"),
    reason: RelayInternalErrorReason,
    traceId: RelayTraceId,
  },
  { httpApiStatus: 500 },
) {
  override get message(): string {
    return `Relay internal error: ${this.reason}`;
  }
}

export const RelayProtectedError = Schema.Union([
  RelayAuthInvalidError,
  RelayEnvironmentLinkProofExpiredError,
  RelayEnvironmentLinkProofInvalidError,
  RelayEnvironmentConnectNotAuthorizedError,
  RelayEnvironmentEndpointUnavailableError,
  RelayEnvironmentEndpointTimedOutError,
  RelayEnvironmentLinkFailedError,
  RelayEnvironmentLinkUnavailableError,
  RelayEnvironmentLinkLimitExceededError,
  RelayAgentActivityPublishProofExpiredError,
  RelayAgentActivityPublishProofInvalidError,
  RelayInternalError,
]);
export type RelayProtectedError = typeof RelayProtectedError.Type;

const RelayAuthAndInternalErrors = [RelayAuthInvalidError, RelayInternalError] as const;

const RelayEnvironmentLinkErrors = [
  RelayAuthInvalidError,
  RelayEnvironmentLinkProofExpiredError,
  RelayEnvironmentLinkProofInvalidError,
  RelayEnvironmentLinkUnavailableError,
  RelayEnvironmentLinkLimitExceededError,
  RelayEnvironmentLinkFailedError,
  RelayInternalError,
] as const;

const RelayEnvironmentConnectErrors = [
  RelayAuthInvalidError,
  RelayEnvironmentConnectNotAuthorizedError,
  RelayEnvironmentEndpointUnavailableError,
  RelayEnvironmentEndpointTimedOutError,
  RelayInternalError,
] as const;

const RelayAgentActivityPublishErrors = [
  RelayAuthInvalidError,
  RelayAgentActivityPublishProofExpiredError,
  RelayAgentActivityPublishProofInvalidError,
  RelayInternalError,
] as const;

export class RelayClientPrincipal extends Context.Service<
  RelayClientPrincipal,
  {
    readonly userId: string;
    readonly token: string;
    readonly proofKeyThumbprint?: string;
    readonly dpopScopes?: ReadonlyArray<RelayDpopAccessTokenScope>;
  }
>()("@t3tools/contracts/relay/RelayClientPrincipal") {}

export class RelayEnvironmentPrincipal extends Context.Service<
  RelayEnvironmentPrincipal,
  {
    readonly environmentId: string;
    readonly environmentPublicKey: string;
  }
>()("@t3tools/contracts/relay/RelayEnvironmentPrincipal") {}

const RelayClientBearerAuthorization = HttpApiSecurity.http({ scheme: "bearer" }).pipe(
  HttpApiSecurity.annotate(
    OpenApi.Description,
    "Clerk session or OAuth bearer token for the signed-in Surge Connect user.",
  ),
);

export class RelayClientAuth extends HttpApiMiddleware.Service<
  RelayClientAuth,
  { provides: RelayClientPrincipal }
>()("RelayClientAuth", {
  error: RelayAuthInvalidError,
  security: { clientBearer: RelayClientBearerAuthorization },
}) {}

const RelayEnvironmentBearerAuthorization = HttpApiSecurity.http({ scheme: "bearer" }).pipe(
  HttpApiSecurity.annotate(
    OpenApi.Description,
    "Relay-issued environment credential installed when the environment is linked.",
  ),
);

export class RelayEnvironmentAuth extends HttpApiMiddleware.Service<
  RelayEnvironmentAuth,
  { provides: RelayEnvironmentPrincipal }
>()("RelayEnvironmentAuth", {
  error: [RelayAuthInvalidError, RelayInternalError],
  security: { environmentBearer: RelayEnvironmentBearerAuthorization },
}) {}

const RelayDpopAuthorization = HttpApiSecurity.http({ scheme: "DPoP" }).pipe(
  HttpApiSecurity.annotate(
    OpenApi.Description,
    "DPoP-bound access token. Requests must also include the DPoP proof JWT header.",
  ),
);

export class RelayDpopClientAuth extends HttpApiMiddleware.Service<
  RelayDpopClientAuth,
  { provides: RelayClientPrincipal }
>()("RelayDpopClientAuth", {
  error: RelayAuthInvalidError,
  security: { relayDpop: RelayDpopAuthorization },
}) {}

export const RelayClientEnvironmentRecord = Schema.Struct({
  environmentId: RelayEnvironmentId,
  label: AuthClientLabel,
  endpoint: RelayManagedEndpoint,
  linkedAt: RelayTimestamp,
});
export type RelayClientEnvironmentRecord = typeof RelayClientEnvironmentRecord.Type;

export const RelayListEnvironmentsResponse = Schema.Struct({
  environments: Schema.Array(RelayClientEnvironmentRecord).check(
    Schema.isMaxLength(RELAY_ENVIRONMENT_MAX_COUNT),
  ),
});
export type RelayListEnvironmentsResponse = typeof RelayListEnvironmentsResponse.Type;

export const RelayEnvironmentConnectRequest = Schema.Struct({
  deviceId: Schema.optional(
    RelayDeviceId.annotate({
      description: "Optional client device identifier requesting the connection.",
    }),
  ),
  clientKeyThumbprint: Schema.optional(
    AuthProofKeyThumbprint.annotate({
      description: "Deprecated alias for clientProofKeyThumbprint.",
    }),
  ),
  clientProofKeyThumbprint: Schema.optional(
    AuthProofKeyThumbprint.annotate({
      description: "JWK thumbprint that the minted environment credential must be bound to.",
    }),
  ),
}).annotate({ description: "Requests a short-lived credential for connecting to an environment." });
export type RelayEnvironmentConnectRequest = typeof RelayEnvironmentConnectRequest.Type;

export const RelayEnvironmentConnectScope = "environment:connect" as const;
export const RelayEnvironmentStatusScope = "environment:status" as const;
export const RelayMobileRegistrationScope = "mobile:registration" as const;
export const RelayDpopAccessTokenScope = Schema.Literals([
  RelayEnvironmentConnectScope,
  RelayEnvironmentStatusScope,
  RelayMobileRegistrationScope,
]);
export type RelayDpopAccessTokenScope = typeof RelayDpopAccessTokenScope.Type;

export const RelayDpopTokenExchangeGrantType =
  "urn:ietf:params:oauth:grant-type:token-exchange" as const;
export const RelayJwtSubjectTokenType = "urn:ietf:params:oauth:token-type:jwt" as const;
export const RelayAccessTokenType = "urn:ietf:params:oauth:token-type:access_token" as const;
export const RelayPublicClientId = Schema.Literals(["t3-mobile", "t3-web"]);
export type RelayPublicClientId = typeof RelayPublicClientId.Type;
export const RelayMobileClientId = "t3-mobile" as const;
export const RelayWebClientId = "t3-web" as const;

export const RelayDpopAccessTokenRequest = Schema.Struct({
  grant_type: Schema.Literal(RelayDpopTokenExchangeGrantType),
  subject_token: AuthCredential.annotate({
    description: "Clerk bearer token for the signed-in cloud user.",
  }),
  subject_token_type: Schema.Literal(RelayJwtSubjectTokenType),
  requested_token_type: Schema.Literal(RelayAccessTokenType),
  resource: RelayUrl.annotate({
    description: "Relay issuer URL that will receive the DPoP-bound access token.",
  }),
  scope: AuthOAuthScope.annotate({
    description: "Space-separated relay scopes requested by the client.",
  }),
  client_id: RelayPublicClientId,
})
  .annotate({ description: "OAuth token exchange request for a DPoP-bound relay access token." })
  .pipe(HttpApiSchema.asFormUrlEncoded());
export type RelayDpopAccessTokenRequest = typeof RelayDpopAccessTokenRequest.Type;

export const RelayDpopAccessTokenResponse = Schema.Struct({
  access_token: AuthCredential,
  issued_token_type: Schema.Literal(RelayAccessTokenType),
  token_type: Schema.Literal("DPoP"),
  expires_in: NonNegativeInt.check(
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(AUTH_ACCESS_TOKEN_MAX_EXPIRES_IN_SECONDS),
  ),
  scope: AuthOAuthScope,
});
export type RelayDpopAccessTokenResponse = typeof RelayDpopAccessTokenResponse.Type;

const RelayAuthorizationHeader = TrimmedNonEmptyString.check(
  Schema.isMaxLength(RELAY_AUTHORIZATION_HEADER_MAX_LENGTH),
);
const RelayDpopProofHeader = TrimmedNonEmptyString.check(
  Schema.isMaxLength(RELAY_DPOP_PROOF_MAX_LENGTH),
);

export const RelayBearerRequestHeaders = Schema.Struct({
  authorization: RelayAuthorizationHeader,
});

export const RelayDpopProofRequestHeaders = Schema.Struct({
  dpop: RelayDpopProofHeader,
});

export const RelayDpopRequestHeaders = Schema.Struct({
  authorization: RelayAuthorizationHeader,
  dpop: RelayDpopProofHeader,
});

export const RelayAuthorizationServerMetadata = Schema.Struct({
  issuer: RelayUrl,
  token_endpoint: RelayUrl,
  grant_types_supported: Schema.Array(Schema.Literal(RelayDpopTokenExchangeGrantType)).check(
    Schema.isMaxLength(8),
  ),
  token_endpoint_auth_methods_supported: Schema.Array(Schema.Literal("none")).check(
    Schema.isMaxLength(8),
  ),
  dpop_signing_alg_values_supported: Schema.Array(Schema.Literal("ES256")).check(
    Schema.isMaxLength(8),
  ),
  scopes_supported: Schema.Array(RelayDpopAccessTokenScope).check(Schema.isMaxLength(8)),
});

export const RelayProtectedResourceMetadata = Schema.Struct({
  resource: RelayUrl,
  authorization_servers: Schema.Array(RelayUrl).check(Schema.isMaxLength(8)),
  scopes_supported: Schema.Array(RelayDpopAccessTokenScope).check(Schema.isMaxLength(8)),
  dpop_bound_access_tokens_required: Schema.Boolean,
  dpop_signing_alg_values_supported: Schema.Array(Schema.Literal("ES256")).check(
    Schema.isMaxLength(8),
  ),
});

export const RelayEnvironmentUnlinkParams = Schema.Struct({
  environmentId: RelayEnvironmentId,
});
export type RelayEnvironmentUnlinkParams = typeof RelayEnvironmentUnlinkParams.Type;

export const RelayEnvironmentConnectResponse = Schema.Struct({
  environmentId: RelayEnvironmentId,
  endpoint: RelayManagedEndpoint,
  credential: AuthCredential,
  expiresAt: RelayTimestamp,
});
export type RelayEnvironmentConnectResponse = typeof RelayEnvironmentConnectResponse.Type;

export const RelayEnvironmentStatusValue = Schema.Literals(["online", "offline"]);
export type RelayEnvironmentStatusValue = typeof RelayEnvironmentStatusValue.Type;

export const RelayEnvironmentStatusResponse = Schema.Struct({
  environmentId: RelayEnvironmentId,
  endpoint: RelayManagedEndpoint,
  status: RelayEnvironmentStatusValue,
  checkedAt: RelayTimestamp,
  descriptor: Schema.optional(ExecutionEnvironmentDescriptor),
  error: Schema.optional(RelayDetail),
  traceId: Schema.optional(RelayTraceId),
});
export type RelayEnvironmentStatusResponse = typeof RelayEnvironmentStatusResponse.Type;

export const RelayCloudMintCredentialProofPayload = Schema.Struct({
  ...RelaySignedJwtRegisteredClaims,
  environmentId: RelayEnvironmentId,
  clientProofKeyThumbprint: AuthProofKeyThumbprint,
  cnf: Schema.Struct({
    jkt: AuthProofKeyThumbprint,
  }),
  deviceId: Schema.optional(RelayDeviceId),
  nonce: AuthCredential,
  scope: Schema.Array(Schema.Literal("environment:connect")).check(Schema.isMaxLength(1)),
});
export type RelayCloudMintCredentialProofPayload = typeof RelayCloudMintCredentialProofPayload.Type;

export const RelayCloudMintCredentialProof = RelayJwt;
export type RelayCloudMintCredentialProof = typeof RelayCloudMintCredentialProof.Type;

export const RelayCloudMintCredentialRequest = Schema.Struct({
  proof: RelayCloudMintCredentialProof,
});
export type RelayCloudMintCredentialRequest = typeof RelayCloudMintCredentialRequest.Type;

export const RelayCloudEnvironmentHealthProofPayload = Schema.Struct({
  ...RelaySignedJwtRegisteredClaims,
  environmentId: RelayEnvironmentId,
  nonce: AuthCredential,
  scope: Schema.Array(Schema.Literal("environment:status")).check(Schema.isMaxLength(1)),
});
export type RelayCloudEnvironmentHealthProofPayload =
  typeof RelayCloudEnvironmentHealthProofPayload.Type;

export const RelayCloudEnvironmentHealthProof = RelayJwt;
export type RelayCloudEnvironmentHealthProof = typeof RelayCloudEnvironmentHealthProof.Type;

export const RelayCloudEnvironmentHealthRequest = Schema.Struct({
  proof: RelayCloudEnvironmentHealthProof,
});
export type RelayCloudEnvironmentHealthRequest = typeof RelayCloudEnvironmentHealthRequest.Type;

export const RelayEnvironmentHealthResponseProofPayload = Schema.Struct({
  ...RelaySignedJwtRegisteredClaims,
  environmentId: RelayEnvironmentId,
  requestNonce: AuthCredential,
  status: Schema.Literal("online"),
  descriptor: ExecutionEnvironmentDescriptor,
  checkedAt: RelayTimestamp,
});
export type RelayEnvironmentHealthResponseProofPayload =
  typeof RelayEnvironmentHealthResponseProofPayload.Type;

export const RelayEnvironmentHealthResponse = Schema.Struct({
  environmentId: RelayEnvironmentId,
  status: Schema.Literal("online"),
  descriptor: ExecutionEnvironmentDescriptor,
  checkedAt: RelayTimestamp,
  proof: RelayJwt,
});
export type RelayEnvironmentHealthResponse = typeof RelayEnvironmentHealthResponse.Type;

export const RelayEnvironmentMintResponseProofPayload = Schema.Struct({
  ...RelaySignedJwtRegisteredClaims,
  environmentId: RelayEnvironmentId,
  clientProofKeyThumbprint: AuthProofKeyThumbprint,
  requestNonce: AuthCredential,
  credential: AuthCredential,
});
export type RelayEnvironmentMintResponseProofPayload =
  typeof RelayEnvironmentMintResponseProofPayload.Type;

export const RelayEnvironmentMintResponse = Schema.Struct({
  credential: AuthCredential,
  expiresAt: RelayTimestamp,
  proof: RelayJwt,
});
export type RelayEnvironmentMintResponse = typeof RelayEnvironmentMintResponse.Type;

export const RelayDeliveryKind = Schema.Literals([
  "live_activity_start",
  "live_activity_update",
  "live_activity_end",
  "push_notification",
]);
export type RelayDeliveryKind = typeof RelayDeliveryKind.Type;

export const RelayDeliveryResult = Schema.Struct({
  deviceId: RelayDeviceId,
  kind: RelayDeliveryKind,
  ok: Schema.Boolean,
  queued: Schema.optional(Schema.Boolean),
  apnsStatus: Schema.NullOr(NonNegativeInt),
  apnsReason: Schema.NullOr(Schema.String.check(Schema.isMaxLength(RELAY_DETAIL_MAX_LENGTH))),
  apnsId: Schema.NullOr(Schema.String.check(Schema.isMaxLength(RELAY_TRACE_ID_MAX_LENGTH))),
});
export type RelayDeliveryResult = typeof RelayDeliveryResult.Type;

export const RelayOkResponse = Schema.Struct({
  ok: Schema.Boolean,
});
export type RelayOkResponse = typeof RelayOkResponse.Type;

export const RelayPublishResponse = Schema.Struct({
  ok: Schema.Boolean,
  deliveries: Schema.Array(RelayDeliveryResult).check(Schema.isMaxLength(RELAY_DEVICE_MAX_COUNT)),
});
export type RelayPublishResponse = typeof RelayPublishResponse.Type;

export const RelayHealthResponse = Schema.Struct({
  ok: Schema.Boolean,
  service: Schema.Literal("relay"),
});
export type RelayHealthResponse = typeof RelayHealthResponse.Type;

export const RelayHealthGroup = HttpApiGroup.make("health")
  .add(
    HttpApiEndpoint.get("health", "/health", {
      success: RelayHealthResponse,
      error: RelayInternalError,
    }).annotate(OpenApi.Summary, "Check relay health"),
  )
  .annotate(OpenApi.Description, "Service health and readiness.");

export const RelayMetadataGroup = HttpApiGroup.make("metadata")
  .add(
    HttpApiEndpoint.get("authorizationServer", "/.well-known/oauth-authorization-server", {
      success: RelayAuthorizationServerMetadata,
    }).annotate(OpenApi.Summary, "Read OAuth authorization-server metadata"),
    HttpApiEndpoint.get("protectedResource", "/.well-known/oauth-protected-resource", {
      success: RelayProtectedResourceMetadata,
    }).annotate(OpenApi.Summary, "Read OAuth protected-resource metadata"),
  )
  .annotate(OpenApi.Description, "OAuth and DPoP discovery metadata.");

export const RelayRegisterDeviceEndpoint = HttpApiEndpoint.post(
  "registerDevice",
  "/v1/mobile/devices",
  {
    headers: RelayDpopRequestHeaders,
    payload: RelayDeviceRegistrationRequest,
    success: RelayOkResponse,
    error: RelayAuthAndInternalErrors,
  },
).annotate(OpenApi.Summary, "Register or update a mobile device");

export const RelayRegisterLiveActivityEndpoint = HttpApiEndpoint.post(
  "registerLiveActivity",
  "/v1/mobile/live-activities",
  {
    headers: RelayDpopRequestHeaders,
    payload: RelayLiveActivityRegistrationRequest,
    success: RelayOkResponse,
    error: RelayAuthAndInternalErrors,
  },
).annotate(OpenApi.Summary, "Register a Live Activity push token");

export const RelayAgentActivitySnapshotResponse = Schema.Struct({
  aggregate: Schema.NullOr(RelayAgentActivityAggregateState),
});
export type RelayAgentActivitySnapshotResponse = typeof RelayAgentActivitySnapshotResponse.Type;

// Lets the app decide whether arming a Live Activity is worthwhile before
// creating one (no empty lock-screen card when nothing is running) and seed
// the card with the real aggregate instead of a placeholder.
export const RelayAgentActivitySnapshotEndpoint = HttpApiEndpoint.get(
  "getAgentActivitySnapshot",
  "/v1/mobile/agent-activity",
  {
    headers: RelayDpopRequestHeaders,
    success: RelayAgentActivitySnapshotResponse,
    error: RelayAuthAndInternalErrors,
  },
).annotate(OpenApi.Summary, "Read the current Live Activity aggregate");

export const RelayUnregisterDeviceEndpoint = HttpApiEndpoint.delete(
  "unregisterDevice",
  "/v1/mobile/devices/:deviceId",
  {
    headers: RelayDpopRequestHeaders,
    params: RelayDeviceUnregistrationParams,
    success: RelayOkResponse,
    error: RelayAuthAndInternalErrors,
  },
).annotate(OpenApi.Summary, "Unregister a mobile device");

export const RelayMobileGroup = HttpApiGroup.make("mobile")
  .add(
    RelayRegisterDeviceEndpoint,
    RelayRegisterLiveActivityEndpoint,
    RelayAgentActivitySnapshotEndpoint,
    RelayUnregisterDeviceEndpoint,
  )
  .annotate(OpenApi.Description, "Mobile push-notification and Live Activity registration.")
  .middleware(RelayDpopClientAuth);

export const RelayClientGroup = HttpApiGroup.make("client")
  .add(
    HttpApiEndpoint.get("listEnvironments", "/v1/environments", {
      headers: RelayBearerRequestHeaders,
      success: RelayListEnvironmentsResponse,
      error: RelayAuthAndInternalErrors,
    }).annotate(OpenApi.Summary, "List linked environments"),
    HttpApiEndpoint.get("listDevices", "/v1/client/devices", {
      headers: RelayBearerRequestHeaders,
      success: RelayListDevicesResponse,
      error: RelayAuthAndInternalErrors,
    }).annotate(OpenApi.Summary, "List registered mobile devices"),
    HttpApiEndpoint.post("linkEnvironment", "/v1/client/environment-links", {
      headers: RelayBearerRequestHeaders,
      payload: RelayEnvironmentLinkRequest,
      success: RelayEnvironmentLinkResponse,
      error: RelayEnvironmentLinkErrors,
    }).annotate(OpenApi.Summary, "Link an environment"),
    HttpApiEndpoint.post(
      "createEnvironmentLinkChallenge",
      "/v1/client/environment-link-challenges",
      {
        headers: RelayBearerRequestHeaders,
        payload: RelayEnvironmentLinkChallengeRequest,
        success: RelayEnvironmentLinkChallengeResponse,
        error: RelayAuthAndInternalErrors,
      },
    ).annotate(OpenApi.Summary, "Create an environment-link challenge"),
    HttpApiEndpoint.delete("unlinkEnvironment", "/v1/client/environment-links/:environmentId", {
      headers: RelayBearerRequestHeaders,
      params: RelayEnvironmentUnlinkParams,
      success: RelayOkResponse,
      error: RelayAuthAndInternalErrors,
    }).annotate(OpenApi.Summary, "Unlink an environment"),
    HttpApiEndpoint.delete(
      "releaseEnvironmentTunnel",
      "/v1/client/environment-links/:environmentId/tunnel",
      {
        headers: RelayBearerRequestHeaders,
        params: RelayEnvironmentUnlinkParams,
        success: RelayOkResponse,
        error: RelayAuthAndInternalErrors,
      },
    )
      .annotate(OpenApi.Summary, "Release an environment's managed tunnel")
      .annotate(
        OpenApi.Description,
        "Deletes the provisioned Cloudflare tunnel while keeping the environment link and its hostname reservation, so a later link re-provisions the tunnel under the same URL. Environments call this when they shut down; Cloudflare bills per provisioned tunnel, so idle tunnels should not outlive their environment.",
      ),
  )
  .annotate(OpenApi.Description, "Cloud-user environment links and registered devices.")
  .middleware(RelayClientAuth);

export const RelayExchangeDpopAccessTokenEndpoint = HttpApiEndpoint.post(
  "exchangeDpopAccessToken",
  "/v1/client/dpop-token",
  {
    headers: RelayDpopProofRequestHeaders,
    payload: RelayDpopAccessTokenRequest,
    success: RelayDpopAccessTokenResponse,
    error: RelayAuthAndInternalErrors,
  },
)
  .annotate(OpenApi.Summary, "Exchange a Clerk token for a DPoP access token")
  .annotate(
    OpenApi.Description,
    "Bootstrap endpoint. Send the DPoP proof JWT in the dpop header and the Clerk token in subject_token. The returned access token is bound to the proof key.",
  );

export const RelayTokenGroup = HttpApiGroup.make("token")
  .add(RelayExchangeDpopAccessTokenEndpoint)
  .annotate(OpenApi.Description, "OAuth token exchange for DPoP-bound client access.");

export const RelayConnectEnvironmentEndpoint = HttpApiEndpoint.post(
  "connectEnvironment",
  "/v1/environments/:environmentId/connect",
  {
    headers: RelayDpopRequestHeaders,
    params: Schema.Struct({
      environmentId: RelayEnvironmentId,
    }),
    payload: RelayEnvironmentConnectRequest,
    success: RelayEnvironmentConnectResponse,
    error: RelayEnvironmentConnectErrors,
  },
).annotate(OpenApi.Summary, "Connect to an environment");

export const RelayGetEnvironmentStatusEndpoint = HttpApiEndpoint.post(
  "getEnvironmentStatus",
  "/v1/environments/:environmentId/status",
  {
    headers: RelayDpopRequestHeaders,
    params: Schema.Struct({
      environmentId: RelayEnvironmentId,
    }),
    success: RelayEnvironmentStatusResponse,
    error: RelayEnvironmentConnectErrors,
  },
).annotate(OpenApi.Summary, "Check environment status");

export const RelayDpopClientGroup = HttpApiGroup.make("dpopClient")
  .add(RelayConnectEnvironmentEndpoint, RelayGetEnvironmentStatusEndpoint)
  .annotate(OpenApi.Description, "DPoP-authenticated client access to linked environments.")
  .middleware(RelayDpopClientAuth);

export const RelayServerGroup = HttpApiGroup.make("server")
  .add(
    HttpApiEndpoint.post(
      "publishAgentActivity",
      "/v1/environments/:environmentId/threads/:threadId/agent-activity",
      {
        params: Schema.Struct({
          environmentId: RelayEnvironmentId,
          threadId: RelayThreadId,
        }),
        payload: RelayAgentActivityPublishRequest,
        success: RelayPublishResponse,
        error: RelayAgentActivityPublishErrors,
      },
    ).annotate(OpenApi.Summary, "Publish agent activity"),
  )
  .annotate(OpenApi.Description, "Environment-authenticated activity publication.")
  .middleware(RelayEnvironmentAuth);

export const RelayApi = HttpApi.make("RelayApi")
  .add(
    RelayHealthGroup,
    RelayMetadataGroup,
    RelayMobileGroup,
    RelayClientGroup,
    RelayTokenGroup,
    RelayDpopClientGroup,
    RelayServerGroup,
  )
  .annotate(OpenApi.Title, "T3 Code Relay API")
  .annotate(OpenApi.Version, "1.0.0")
  .annotate(
    OpenApi.Description,
    "Control-plane API for linking T3 environments, connecting authorized clients, and publishing agent activity.",
  );
export type RelayApi = typeof RelayApi;
